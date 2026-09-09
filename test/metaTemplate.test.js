import test from "node:test";
import assert from "node:assert/strict";
import { metaTemplate, catalogEntry } from "../src/metaTemplate.js";
import { whatsappTemplates } from "../src/sunshineTemplates.js";
test("Meta template builds text examples and rejects incomplete or unsupported submissions",()=>{
  const input={name:"agendamento",language:"pt_BR",category:"UTILITY",body:"Olá {{1}}",examples:["Ana"]};
  assert.deepEqual(metaTemplate(input).components[0].example.body_text,[["Ana"]]);
  for(const change of [{examples:[]},{body:"Olá {{2}}"},{body:"Olá {{nome}}"},{category:"AUTHENTICATION"},{name:"Nome inválido"},{body:"a".repeat(1025)}])assert.throws(()=>metaTemplate({...input,...change}));
});

test("Sunshine templates paginate, submit the validated body once and reject incomplete responses",async()=>{
  const scope={appId:"a".repeat(24),integrationId:"b".repeat(24)};
  const calls=[];
  const first={id:"1",name:"primeiro",language:"pt_BR",status:"APPROVED",components:[{type:"BODY",text:"Olá"}]};
  const result=await whatsappTemplates(async(path)=>{
    calls.push(path);
    return calls.length===1?{messageTemplates:[first],after:"cursor+/?"}:{messageTemplates:[]};
  },scope);
  assert.deepEqual(result.data,[first]);
  assert.ok(calls[1].endsWith("?after=cursor%2B%2F%3F"));
  assert.ok(calls[0].includes(`/integrations/${scope.integrationId}/messageTemplates`));
  const input={name:"agendamento",language:"pt_BR",category:"UTILITY",body:"Olá {{1}}",examples:["Ana"]};
  const created=await whatsappTemplates(async(path,method,payload)=>{
    assert.equal(method,"POST");assert.deepEqual(payload,metaTemplate(input));
    return {messageTemplate:{...first,status:"PENDING"}};
  },scope,input);
  assert.equal(created.status,"PENDING");
  await whatsappTemplates(async(path,method,payload)=>{
    const button=payload.components.at(-1).buttons[0];
    assert.equal(button.phoneNumber,'+5511999999999');
    assert.equal(button.phone_number,undefined);
    return {messageTemplate:{...first,status:'PENDING'}};
  },scope,{...input,buttons:[{type:'PHONE_NUMBER',text:'Ligar',phone:'+5511999999999'}]});
  let writes=0;
  await assert.rejects(whatsappTemplates(async()=>{writes++;throw Error("timeout");},scope,input),/timeout/);
  assert.equal(writes,1);
  await assert.rejects(whatsappTemplates(async()=>({}),scope),/lista/);
  await assert.rejects(whatsappTemplates(async()=>({}),scope,input),/Criação não confirmada/);
  await assert.rejects(whatsappTemplates(async()=>({messageTemplates:[],after:"repeated"}),scope),/Paginação/);
  await assert.rejects(whatsappTemplates(async()=>{throw Error("must not call");},{...scope,integrationId:"../invalid"}),/Configure/);
});

import { requiresMeta } from '../src/templateTypes.js';
import { templateMetaAccess, uploadTemplateSample, providerError } from '../server/templateMeta.mjs';
test('advanced template families produce category-specific components and enforce limits',()=>{
  const base={name:'exemplo',language:'pt_BR',category:'MARKETING',body:'Olá {{1}}',examples:{1:'Ana'}};
  const build=patch=>metaTemplate({...base,...patch});
  assert.equal(build({header:{format:'TEXT',text:'Pedido {{1}}',examples:{1:'123'}},footer:'Obrigado',buttons:[{type:'PHONE_NUMBER',text:'Ligar',phone:'+5511999999999'}]}).components[3].buttons[0].phone_number,'+5511999999999');
  const named=build({parameterFormat:'NAMED',body:'Olá {{nome}}',examples:{nome:'Ana'}});
  assert.equal(named.components[0].example.body_text_named_params[0].param_name,'nome');
  assert.throws(()=>build({body:'Olá {{2}}',examples:{2:'Ana'}}));
  assert.throws(()=>build({buttons:[{type:'URL',text:'Abrir',url:'javascript:alert(1)'}]}));
  assert.throws(()=>build({buttons:[{type:'URL',text:'Abrir',url:'https://example.org/{{2}}'}]}));
  assert.throws(()=>build({footer:'Olá {{1}}'}));
  assert.throws(()=>build({header:{format:'VIDEO',handle:'https://example.org/a.mp4'}}));
  assert.equal(build({kind:'location'}).components[0].format,'LOCATION');
  assert.equal(build({kind:'flow',flow:{id:'123',action:'navigate',screen:'WELCOME',text:'Agendar'}}).components.at(-1).buttons[0].navigate_screen,'WELCOME');
  assert.equal(build({kind:'coupon',coupon:'BEMVINDO'}).components.at(-1).buttons[0].type,'COPY_CODE');
  assert.equal(build({kind:'offer',offerText:'Só hoje',coupon:'PROMO',buttons:[{type:'URL',text:'Comprar',url:'https://example.org'}]}).components[0].type,'LIMITED_TIME_OFFER');
  assert.throws(()=>build({kind:'offer',offerText:'Só hoje',coupon:'PROMO',footer:'x'}));
  assert.equal(build({kind:'offer',offerText:'Só hoje',buttons:[{type:'URL',text:'Comprar',url:'https://example.org'}]}).components.at(-1).buttons.length,1);
  for(const [kind,button]of [['catalog','CATALOG'],['product','SPM'],['products','MPM'],['voiceCall','VOICE_CALL']])assert.equal(build({kind,...(kind==='products'?{header:{format:'TEXT',text:'Produtos'}}:{})}).components.at(-1).buttons[0].type,button);
  assert.equal(build({kind:'callPermission'}).components.at(-1).type,'CALL_PERMISSION_REQUEST');
  const card={header:{format:'IMAGE',handle:'4:sample'},body:'Produto',buttons:[{type:'URL',text:'Ver',url:'https://example.org'}]};
  assert.equal(build({kind:'carousel',cards:[card,card]}).components[1].cards.length,2);
  assert.throws(()=>build({kind:'carousel',cards:[card,{...card,header:{format:'VIDEO',handle:'4:sample'}}]}));
  assert.equal(build({kind:'productCarousel',cards:[{},{}]}).components[1].cards[0].components[0].format,'PRODUCT');
  for(const mode of ['COPY_CODE','ONE_TAP','ZERO_TAP']){
    const auth={mode,apps:[{package:'br.com.example',hash:'K8a/AINcGX7'}],terms:mode==='ZERO_TAP',expiration:5};
    assert.equal(build({kind:'authentication',category:'AUTHENTICATION',auth}).components.at(-1).buttons[0].otp_type,mode);
  }
  assert.throws(()=>build({kind:'authentication',category:'AUTHENTICATION',auth:{mode:'ZERO_TAP',apps:[{package:'br.com.example',hash:'K8a/AINcGX7'}]}}));
  assert.throws(()=>build({kind:'orderDetails',category:'UTILITY'}));
  assert.equal(requiresMeta(base),false);assert.equal(requiresMeta({...base,kind:'coupon'}),true);assert.equal(requiresMeta({...base,header:{format:'IMAGE'}}),true);
});

test('media management stays on the connected WABA and uploads checked sample bytes',async()=>{
  const env={META_ACCESS_TOKEN:'test',META_WABA_ID:'123',META_GRAPH_VERSION:'v25.0',META_APP_ID:'456'};
  assert.equal(await templateMetaAccess(env,{appId:'a',integrationId:'b'},async()=>({integration:{type:'whatsapp',accountId:'other'}})),false);
  assert.equal(await templateMetaAccess(env,{appId:'a',integrationId:'b'},async()=>({integration:{type:'whatsapp',accountId:'123'}})),true);
  const calls=[];const fetcher=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>calls.length===1?{id:'upload:test_session?sig=test_sig'}:{h:'4:handle'}};};
  const input={name:'sample.pdf',type:'application/pdf',data:Buffer.from('%PDF-sample').toString('base64')};
  assert.deepEqual(await uploadTemplateSample(env,input,fetcher),{handle:'4:handle'});
  assert.equal(calls[1].options.headers.file_offset,'0');assert.equal(calls[1].options.headers.Authorization,'OAuth test');
  assert.ok(Buffer.isBuffer(calls[1].options.body));
  assert.equal(calls[1].url,'https://graph.facebook.com/v25.0/upload:test_session?sig=test_sig');
  await assert.rejects(uploadTemplateSample(env,{...input,data:Buffer.from('invalid').toString('base64')},fetcher),/conteúdo/);
  await assert.rejects(uploadTemplateSample(env,{...input,type:'text/html'},fetcher),/JPG/);
  let attempts=0;await assert.rejects(uploadTemplateSample(env,input,async()=>{attempts++;throw Error('timeout');}),/timeout/);assert.equal(attempts,1);
});

test('provider errors expose validation details without credentials or response dumps',()=>{
  assert.match(providerError(400,{errors:[{code:'bad_request',description:'components[0].example is invalid'}]}).message,/components\[0\]\.example/);
  const error=providerError(400,{error:{message:'token secret-token-value Bearer abc123',request:{password:'never-display'}}},['secret-token-value']);
  assert.doesNotMatch(error.message,/secret-token-value|abc123|never-display/);
  assert.equal(providerError(502,null).message,'API recusou a operação (HTTP 502).');
});

import { shorthand, macroTemplate, catalogMacro, catalogMatch } from "../src/domain.js";
import { parseTemplate } from "../src/outbound.js";
test("catalog entry turns an approved template into a sendable macro text",()=>{
  const item={name:"aviso_atraso",language:"pt_BR",status:"APPROVED",components:[
    {type:"HEADER",format:"TEXT",text:"Olá {{1}}",example:{header_text:["Ana"]}},
    {type:"BODY",text:"Seu boleto de {{1}} vence em {{2}}.",example:{body_text:[["R$ 100","10/09"]]}}]};
  const entry=catalogEntry(item);
  assert.deepEqual(entry.parameters,["R$ 100","10/09"]);
  assert.equal(entry.fallback,"Seu boleto de R$ 100 vence em 10/09.");
  assert.equal(entry.headerValue,"Olá Ana");
  // O texto publicado precisa voltar pelo caminho de envio sem perder nada.
  const sent=parseTemplate(shorthand(entry),["R$ 250","12/09"]);
  assert.equal(sent.message.template.name,"aviso_atraso");
  assert.deepEqual(sent.message.template.components.at(-1).parameters.map(p=>p.text),["R$ 250","12/09"]);
  // Status não invalida a entrada: quem publica decide se a macro entra ativa.
  assert.equal(catalogEntry({...item,status:"PENDING"}).name,"aviso_atraso");
  for(const change of [{components:[{type:"BODY",text:"oi"},{type:"BUTTONS",buttons:[]}]},
    {components:[{type:"HEADER",format:"IMAGE"},{type:"BODY",text:"oi"}]},{components:[{type:"HEADER",format:"TEXT",text:"oi"}]},
    {components:[{type:"BODY",text:"Olá {{1}}"}]}])assert.throws(()=>catalogEntry({...item,...change}));
  // Nome de exibição e caso de uso vêm do título e da descrição da macro.
  const macro=macroTemplate({title:"WhatsApp::Aviso de atraso",description:"Boleto vencido há mais de um dia.",active:true,
    actions:[{field:"comment_value",value:shorthand(entry)}],restriction:{type:"Group",ids:[7]}});
  assert.equal(macro.label,"Aviso de atraso");
  assert.equal(macro.useCase,"Boleto vencido há mais de um dia.");
  assert.deepEqual(macro.groupIds,[7]);
  assert.equal(macroTemplate({title:"WhatsApp::Sem descrição",active:true,actions:[{field:"comment_value",value:shorthand(entry)}]}).useCase,"");
  // Painel do administrador: macro inativa continua visível e casa com o template da Meta.
  const pending={id:9,title:"WhatsApp::Aviso de atraso",description:"d",active:false,actions:[{field:"comment_value",value:shorthand(entry)}]};
  assert.equal(macroTemplate(pending),null);
  assert.deepEqual(catalogMacro(pending),{id:9,label:"Aviso de atraso",useCase:"d",groupIds:[],active:false,template:"aviso_atraso",language:"pt_BR"});
  assert.equal(catalogMatch([catalogMacro(pending)],item).id,9);
  assert.equal(catalogMatch([catalogMacro(pending)],{...item,language:"en_US"}),null);
  assert.equal(catalogMacro({title:"Outra macro",active:true,actions:[]}),null);
});
