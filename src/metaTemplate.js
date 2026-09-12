import { templateTypes, variables } from './templateTypes.js';
import { shorthand, catalogMatch, templateLanguage } from './domain.js';
const required = (v,max,label) => {
  if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(`${label}: preencha até ${max} caracteres.`);
  return v;
};
function textComponent(type,text,examples,format,max){
  required(text,max,type==='HEADER'?'Cabeçalho':'Mensagem');
  const ids=variables(text);
  if(/[{}]/.test(text.replace(/\{\{([a-z_][a-z_0-9]*|[1-9]\d*)\}\}/g,'')))throw Error('Confira o formato das variáveis.');
  if(format==='NAMED'?ids.some(id=>!/^[a-z_][a-z_0-9]*$/.test(id)):ids.some((id,i)=>id!==String(i+1)))throw Error(format==='NAMED'?'Use nomes de variáveis, como {{nome}}.':'Use variáveis em sequência: {{1}}, {{2}}.');
  if(type==='HEADER'&&ids.length>1)throw Error('O cabeçalho aceita uma variável.');
  const values=ids.map((id,i)=>required(Array.isArray(examples)?examples[i]:examples?.[id],max,`Exemplo de ${id}`));
  if(Array.isArray(examples)&&examples.length!==ids.length)throw Error('Preencha exemplos para todas as variáveis.');
  const key=type==='HEADER'?'header_text':'body_text';
  return {type,...(type==='HEADER'?{format:'TEXT'}:{}),text,...(ids.length?{example:format==='NAMED'?{[`${key}_named_params`]:ids.map((id,i)=>({param_name:id,example:values[i]}))}:{[key]:type==='HEADER'?values:[values]}}:{})};
}
function safeUrl(value){
  required(value,2000,'Endereço do botão');let url;
  try{url=new URL(value.replace('{{1}}','sample'));}catch{throw Error('Informe um endereço completo para o botão.');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Informe um endereço HTTP ou HTTPS sem credenciais.');
  return value;
}
function buttonComponents(buttons=[],max=10){
  if(!Array.isArray(buttons)||buttons.length>max)throw Error(`Use até ${max} botões.`);
  const counts={};const result=buttons.map(b=>{
    counts[b.type]=(counts[b.type]||0)+1;const text=required(b.text,25,'Texto do botão');
    if(b.type==='QUICK_REPLY')return {type:b.type,text};
    if(b.type==='PHONE_NUMBER'){
      if(counts[b.type]>1||!/^\+[1-9]\d{6,14}$/.test(b.phone||''))throw Error('Use um único botão de telefone com DDI (ex.: +5511999999999).');
      return {type:b.type,text,phone_number:b.phone};
    }
    if(b.type==='URL'){
      if(counts[b.type]>2)throw Error('Use até dois botões de site.');const url=safeUrl(b.url);
      if(/[{}]/.test(url.replace(/\{\{1\}\}$/,'')))throw Error('O endereço aceita apenas {{1}}, no final.');
      return {type:b.type,text,url,...(url.endsWith('{{1}}')?{example:[safeUrl(b.example)]}:{})};
    }
    throw Error('Tipo de botão inválido.');
  });
  if(/Q.*A.*Q|A.*Q.*A/.test(result.map(b=>b.type==='QUICK_REPLY'?'Q':'A').join('')))throw Error('Agrupe as respostas rápidas antes ou depois dos outros botões.');
  return result;
}
function mediaHeader(header){
  if(!['IMAGE','VIDEO','DOCUMENT'].includes(header?.format))throw Error('Escolha imagem, vídeo ou documento.');
  required(header.handle,4096,'Arquivo de exemplo');
  if(!/^\d+:/.test(header.handle))throw Error('Envie o arquivo de exemplo antes de continuar.');
  return {type:'HEADER',format:header.format,example:{header_handle:[header.handle]}};
}
export function metaTemplate(input){
  const {name,language,body,examples=[],header={},footer='',buttons=[]}=input;
  if(!/^[a-z0-9_]{1,512}$/.test(name||'')||!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language||''))throw Error('Confira nome e idioma do template.');
  const kind=input.kind||'standard',type=templateTypes.find(t=>t.id===kind);
  if(!type||type.external)throw Error('Este formato depende da configuração de pagamentos no Gerenciador do WhatsApp.');
  if(!type.categories.includes(input.category))throw Error('Categoria incompatível com o tipo de template.');
  const format=input.parameterFormat||'POSITIONAL';if(!['POSITIONAL','NAMED'].includes(format))throw Error('Formato de variáveis inválido.');
  const components=[],result={name,language,category:input.category,components};
  if(format==='NAMED')result.parameter_format=format;
  if(kind==='authentication'){
    const a=input.auth||{},mode=a.mode||'COPY_CODE';
    if(!['COPY_CODE','ONE_TAP','ZERO_TAP'].includes(mode))throw Error('Escolha como o cliente receberá o código.');
    components.push({type:'BODY',add_security_recommendation:a.security!==false});
    if(a.expiration!==''&&a.expiration!=null){const n=Number(a.expiration);if(!Number.isInteger(n)||n<1||n>90)throw Error('Validade do código: de 1 a 90 minutos.');components.push({type:'FOOTER',code_expiration_minutes:n});}
    const button={type:'OTP',otp_type:mode,text:required(a.text||'Copiar código',25,'Texto do botão')};
    if(mode!=='COPY_CODE'){
      if(!Array.isArray(a.apps)||!a.apps.length||a.apps.length>5)throw Error('Informe de 1 a 5 aplicativos Android.');
      button.supported_apps=a.apps.map(app=>{
        if(!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(app.package||'')||app.package.length>224||!/^[a-zA-Z0-9+/=]{11}$/.test(app.hash||''))throw Error('Confira o pacote e a assinatura de 11 caracteres do aplicativo Android.');
        return {package_name:app.package,signature_hash:app.hash};
      });
      button.autofill_text=required(a.autofill||'Preencher código',25,'Texto de preenchimento');
      if(mode==='ZERO_TAP'){if(a.terms!==true)throw Error('Confirme os termos de preenchimento automático.');button.zero_tap_terms_accepted=true;}
    }
    components.push({type:'BUTTONS',buttons:[button]});return result;
  }
  if(kind==='location')components.push({type:'HEADER',format:'LOCATION'});
  else if(kind==='product')components.push({type:'HEADER',format:'PRODUCT'});
  else if(!['catalog','productCarousel','carousel','callPermission'].includes(kind)&&header.format&&header.format!=='NONE')components.push(header.format==='TEXT'?textComponent('HEADER',header.text,header.examples||{},format,60):mediaHeader(header));
  if(kind==='offer'){
    if(footer)throw Error('Ofertas por tempo limitado não aceitam rodapé.');
    if(header.format&&!['NONE','IMAGE','VIDEO'].includes(header.format))throw Error('A oferta aceita imagem ou vídeo no cabeçalho.');
    components.push({type:'LIMITED_TIME_OFFER',limited_time_offer:{text:required(input.offerText,16,'Título da oferta'),has_expiration:input.hasExpiration!==false}});
  }
  components.push(textComponent('BODY',body,examples,format,kind==='offer'?600:1024));
  if(footer){if(/[{}]/.test(footer))throw Error('O rodapé não aceita variáveis.');components.push({type:'FOOTER',text:required(footer,60,'Rodapé')});}
  let actions=buttonComponents(buttons);
  if(kind==='coupon'||kind==='offer'&&input.coupon)actions.unshift({type:'COPY_CODE',example:required(input.coupon,20,'Exemplo de cupom')});
  if(kind==='offer'&&(actions.filter(b=>b.type==='URL').length!==1||actions.some(b=>!['COPY_CODE','URL'].includes(b.type))))throw Error('A oferta precisa de um botão de site e aceita apenas site e cupom.');
  if(kind==='catalog')actions=[{type:'CATALOG',text:'View catalog'}];
  if(kind==='product')actions=[{type:'SPM',text:'View'}];
  if(kind==='products'){if(header.format!=='TEXT')throw Error('Informe um cabeçalho de texto para a lista de produtos.');actions=[{type:'MPM',text:'View items'}];}
  if(kind==='voiceCall')actions.unshift({type:'VOICE_CALL',text:required(input.callText||'Ligar',25,'Texto do botão')});
  if(kind==='flow'){
    const f=input.flow||{};if(!/^\d+$/.test(f.id||''))throw Error('Informe o ID de um Flow publicado.');
    if(!['navigate','data_exchange'].includes(f.action))throw Error('Escolha a ação do formulário.');
    if(f.action==='navigate')required(f.screen,80,'Tela inicial do Flow');
    actions.unshift({type:'FLOW',text:required(f.text||'Abrir formulário',25,'Texto do botão'),flow_id:f.id,flow_action:f.action,...(f.action==='navigate'?{navigate_screen:f.screen}:{})});
  }
  if(kind==='callPermission'){
    if(actions.length||footer||header.format&&header.format!=='NONE')throw Error('O pedido de permissão usa apenas mensagem e autorização de ligação.');components.push({type:'CALL_PERMISSION_REQUEST'});
  }
  if(kind==='carousel'||kind==='productCarousel'){
    if(footer||actions.length)throw Error('Configure os botões nos cartões do carrossel.');
    if(!Array.isArray(input.cards)||input.cards.length<2||input.cards.length>10)throw Error('O carrossel precisa de 2 a 10 cartões.');
    if(kind==='productCarousel'&&input.cards.length!==2)throw Error('Cadastre dois cartões de exemplo; os produtos são definidos no envio.');
    const shapes=new Set();
    components.push({type:'CAROUSEL',cards:input.cards.map(card=>{
      if(kind==='productCarousel')return {components:[{type:'HEADER',format:'PRODUCT'},{type:'BUTTONS',buttons:[{type:'SPM',text:'View'}]}]};
      if(!['IMAGE','VIDEO'].includes(card.header?.format))throw Error('Cada cartão precisa de imagem ou vídeo.');
      const cs=[mediaHeader(card.header)];
      if(card.body)cs.push(textComponent('BODY',card.body,card.examples||{},format,160));
      const bs=buttonComponents(card.buttons,2);if(!bs.length)throw Error('Adicione pelo menos um botão em cada cartão.');
      cs.push({type:'BUTTONS',buttons:bs});shapes.add(JSON.stringify([card.header.format,!!card.body,bs.map(b=>b.type)]));return {components:cs};
    })});if(shapes.size>1)throw Error('Use o mesmo formato de mídia e os mesmos tipos de botões em todos os cartões.');
  }else if(actions.length){if(actions.length>10)throw Error('Use até 10 botões no total.');components.push({type:'BUTTONS',buttons:actions});}
  return result;
}

function isFlowButton(button) {
  return ["FLOW"].includes(String(button?.type ?? button?.sub_type ?? button?.subType ?? "").toUpperCase());
}

function flowButtons(component) {
  const buttons = component?.buttons ?? [];
  return buttons.length > 0 && buttons.every(isFlowButton);
}

// Catálogo de envio: um template da Meta vira macro do Zendesk. Quem chama decide
// se a macro entra ativa (só templates aprovados podem ser enviados). O envio
// cobre corpo/cabeçalho de texto e um botão Flow; mídia, outros botões e carrossel
// ficam fora até o transporte cobri-los.
export function catalogEntry(item) {
  const components = Array.isArray(item?.components) ? item.components : [];
  const type = c => String(c?.type ?? '').toUpperCase();
  const body = components.find(c => type(c) === 'BODY');
  const header = components.find(c => type(c) === 'HEADER');
  const buttons = components.find(c => type(c) === 'BUTTONS');
  if (!body?.text) throw Error('Este template não tem corpo de texto para enviar.');
  if (header && String(header.format ?? '').toUpperCase() !== 'TEXT')
    throw Error('Cabeçalhos de mídia ainda não podem ser enviados pelo catálogo.');
  if (components.some(c => ['CAROUSEL', 'LIMITED_TIME_OFFER'].includes(type(c)))
      || (buttons && !flowButtons(buttons)))
    throw Error('Templates com botões ou carrossel ainda não podem ser enviados pelo catálogo.');
  const examples = component => {
    const example = component?.example ?? {};
    const named = example.body_text_named_params ?? example.header_text_named_params;
    if (Array.isArray(named)) return named.map(p => String(p?.example ?? ''));
    const positional = example.body_text ?? example.header_text;
    const values = Array.isArray(positional?.[0]) ? positional[0] : positional;
    return Array.isArray(values) ? values.map(v => String(v ?? '')) : [];
  };
  const fill = (text, values) => {
    const ids = variables(text);
    return ids.map((id, i) => {
      const value = values[i];
      if (typeof value === 'string' && value.trim()) return value;
      return /^[1-9]\d*$/.test(id) ? `exemplo${id}` : id;
    });
  };
  const parameters = fill(body.text, examples(body));
  const headerValues = header ? fill(header.text ?? '', examples(header)) : [];
  const resolve = (text, values) => variables(text).reduce((out, id, i) => out.split(`{{${id}}}`).join(values[i]), text);
  return {
    name: item.name,
    language: templateLanguage(item),
    fallback: resolve(body.text, parameters),
    parameters,
    headerType: header ? 'text' : '',
    headerValue: header ? resolve(header.text ?? '', headerValues) : '',
    flow: !!buttons,
  };
}

// Envio ativo só lê macros WhatsApp::. Templates aprovados e enviáveis viram
// ações de criar/ativar essa macro; mídia, botões que não são Flow e pendentes ficam de fora.
export function sendCatalogActions(items = [], entries = []) {
  const actions = [];
  const taken = new Set((entries ?? []).map(e => e.label));
  for (const item of items ?? []) {
    if (String(item?.status ?? '').toUpperCase() !== 'APPROVED') continue;
    let text;
    try { text = shorthand(catalogEntry(item)); }
    catch { continue; }
    const entry = catalogMatch(entries, item);
    if (entry) {
      const needsFlow = /flow=\[\[1\]\]/.test(text) && !entry.flow;
      if (!entry.active || needsFlow) actions.push({
        type: 'activate', macroId: entry.id, title: entry.label, text,
        groupIds: entry.groupIds ?? [], description: entry.useCase ?? '',
      });
      continue;
    }
    let title = item.name;
    if (!title || taken.has(title)) title = `${item.name} · ${item.language}`;
    taken.add(title);
    actions.push({ type: 'create', title, text });
  }
  return actions;
}

export function catalogSendLabel(item, entry) {
  try { shorthand(catalogEntry(item)); }
  catch { return 'Não enviável'; }
  if (String(item?.status ?? '').toUpperCase() !== 'APPROVED') return 'Aguardando Meta';
  return entry?.active ? 'No envio' : 'Publicar';
}
