import test from "node:test";
import assert from "node:assert/strict";
import { metaTemplate } from "../src/metaTemplate.js";
import { whatsappTemplates } from "../server/templates.mjs";
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
  let writes=0;
  await assert.rejects(whatsappTemplates(async()=>{writes++;throw Error("timeout");},scope,input),/timeout/);
  assert.equal(writes,1);
  await assert.rejects(whatsappTemplates(async()=>({}),scope),/lista/);
  await assert.rejects(whatsappTemplates(async()=>({}),scope,input),/Criação não confirmada/);
  await assert.rejects(whatsappTemplates(async()=>({messageTemplates:[],after:"repeated"}),scope),/Paginação/);
  await assert.rejects(whatsappTemplates(async()=>{throw Error("must not call");},{...scope,integrationId:"../invalid"}),/Configure/);
});
