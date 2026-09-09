import React, { useEffect, useRef, useState } from 'react';
import { Button, Anchor } from '@zendeskgarden/react-buttons';
import { Field, Label, Hint, Input, Textarea, Select, Checkbox } from '@zendeskgarden/react-forms';
import { Tabs } from '@zendeskgarden/react-tabs';
import { Table } from '@zendeskgarden/react-tables';
import { Stepper } from '@zendeskgarden/react-accordions';
import { Notice } from './GardenUI.jsx';
import { metaTemplate, catalogEntry } from './metaTemplate.js';
import { shorthand, catalogMatch } from './domain.js';
import { templateTypes, variables, sampleText, requiresMeta } from './templateTypes.js';

const WABA_TEMPLATES_URL='https://business.facebook.com/wa/manage/message-templates/';
const statuses={APPROVED:'Aprovado',PENDING:'Em análise',REJECTED:'Rejeitado',PAUSED:'Pausado',DISABLED:'Desativado'};
const categoryNames={UTILITY:'Utilidade',MARKETING:'Marketing',AUTHENTICATION:'Autenticação'};
const statusLabel=s=>statuses[s]||s||'Status não informado';
const blankCard=()=>({header:{format:'IMAGE'},body:'',examples:{},buttons:[{type:'URL',text:'Saiba mais',url:''}]});
function newDraft(kind='standard'){
  const t=templateTypes.find(t=>t.id===kind);
  return {kind,name:'',category:t.categories[0],language:'pt_BR',parameterFormat:'POSITIONAL',body:'',examples:{},
    header:{format:kind==='products'?'TEXT':'NONE',text:'',examples:{}},footer:'',buttons:kind==='offer'?[{type:'URL',text:'Ver oferta',url:''}]:[],
    coupon:'',offerText:'Oferta especial',hasExpiration:true,flow:{id:'',action:'navigate',screen:'',text:'Abrir formulário'},
    auth:{mode:'COPY_CODE',security:true,expiration:5,text:'Copiar código',autofill:'Preencher código',apps:[{package:'',hash:''}],terms:false},cards:[blankCard(),blankCard()]};
}
function FormField({label,hint,children}){return <Field className="tm-field"><Label>{label}</Label>{children}{hint&&<Hint>{hint}</Hint>}</Field>;}
function TextField({label,value,onChange,hint,...props}){return <FormField label={label} hint={hint}><Input value={value??''} onChange={e=>onChange(e.target.value)} {...props}/></FormField>;}
function Choice({label,value,onChange,options,hint,...props}){return <FormField label={label} hint={hint}><Select value={value} onChange={e=>onChange(e.target.value)} {...props}>{options.map(([v,l])=><option key={v} value={v}>{l}</option>)}</Select></FormField>;}
function Check({label,checked,onChange}){return <Field className="tm-check"><Checkbox checked={checked} onChange={e=>onChange(e.target.checked)}><Label>{label}</Label></Checkbox></Field>;}
function TextEditor({label,value='',examples={},onChange,onExamples,format,max=1024}){
  const ids=variables(value);
  return <div><FormField label={label}><Textarea rows={4} maxLength={max} value={value} onChange={e=>onChange(e.target.value)}/></FormField>
    <div className="tm-between tm-counter"><Button size="small" isBasic onClick={()=>{const id=format==='NAMED'?`variavel_${ids.length+1}`:String(ids.length+1);onChange(`${value}${value?' ':''}{{${id}}}`);}}>Adicionar variável</Button><span>{value.length}/{max}</span></div>
    {!!ids.length&&<div className="tm-examples"><h3>Exemplos para aprovação</h3>{ids.map(id=><TextField key={id} label={`Exemplo de {{${id}}}`} value={examples[id]} onChange={v=>onExamples({...examples,[id]:v})}/>)}</div>}
  </div>;
}
function ButtonsEditor({value=[],onChange,max=10}){
  const change=(i,patch)=>onChange(value.map((b,j)=>j===i?{...b,...patch}:b));
  return <div className="tm-buttons-editor">{value.map((b,i)=><div className="tm-button-row" key={i}>
    <div className="tm-between"><h3>Botão {i+1}</h3><Button size="small" isBasic onClick={()=>onChange(value.filter((_,j)=>j!==i))}>Remover</Button></div>
    <div className="tm-grid"><Choice label="Ação" value={b.type} onChange={type=>change(i,{type})} options={[["QUICK_REPLY","Resposta rápida"],["URL","Abrir site"],["PHONE_NUMBER","Ligar para telefone"]]}/>
    <TextField label="Texto do botão" value={b.text} maxLength={25} onChange={text=>change(i,{text})}/></div>
    {b.type==='URL'&&<><TextField label="Endereço do site" value={b.url} placeholder="https://suaempresa.com.br" onChange={url=>change(i,{url})}/>{b.url?.includes('{{1}}')&&<TextField label="Exemplo do endereço completo" value={b.example} onChange={example=>change(i,{example})}/>}</>}
    {b.type==='PHONE_NUMBER'&&<TextField label="Telefone com DDI" value={b.phone} placeholder="+55 11 99999-9999" onChange={v=>change(i,{phone:v.replace(/[\s()-]/g,'')})}/>}
  </div>)}<Button size="small" isBasic disabled={value.length>=max} onClick={()=>onChange([...value,{type:'QUICK_REPLY',text:''}])}>Adicionar botão</Button></div>;
}
function MediaField({header,onChange,api,available,onBusy}){
  const [error,setError]=useState(''),[uploading,setUploading]=useState(false);
  const accept={IMAGE:'image/png,image/jpeg',VIDEO:'video/mp4',DOCUMENT:'application/pdf'}[header.format];
  const picker=useRef(null);
  // The native input stays focusable but visually hidden; the Garden button is the
  // visible control and shows the focus ring through .tm-file:focus-within.
  return <FormField label="Arquivo de exemplo" hint="O exemplo será enviado à Meta para analisar o template.">
    <div className="tm-file">
    <Button size="small" isBasic tabIndex={-1} disabled={!available||uploading}
      onClick={()=>picker.current?.click()}>{header.fileName?'Trocar arquivo':'Escolher arquivo'}</Button>
    <input ref={picker} className="tm-file-input" type="file" accept={accept} aria-label="Arquivo de exemplo"
      disabled={!available||uploading} onChange={async e=>{
      const file=e.target.files?.[0];if(!file)return;
      setError('');onChange({...header,handle:undefined,fileName:undefined,preview:undefined});
      const allowed=accept.split(',');const max=header.format==='IMAGE'?5:16;
      if(!allowed.includes(file.type)||file.size>max*1024**2){setError(`Escolha um arquivo compatível de até ${max} MB.`);return;}
      setUploading(true);onBusy(true);
      try{
        const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Não foi possível ler o arquivo.'));reader.readAsDataURL(file);});
        const result=await api.metaTemplates({name:file.name,type:file.type,data:data.split(',')[1]},'media');
        onChange({...header,handle:result.handle,fileName:file.name,preview:header.format==='IMAGE'?data:undefined});
      }catch(e){setError(e.message);}finally{setUploading(false);onBusy(false);}
    }}/>
    </div>
    {!available&&<p className="tm-muted">O envio de arquivos precisa da conexão de gerenciamento avançado da conta WhatsApp.</p>}
    {uploading&&<p role="status">Enviando arquivo…</p>}{header.fileName&&<p>{header.fileName} ✓</p>}{error&&<p role="alert" className="tm-error">{error}</p>}
  </FormField>;
}
function Preview({draft,item}){
  const auth=draft?.kind==='authentication',h=draft?.header||{},kind=draft?.kind;
  const mediaLabel={IMAGE:'Imagem',VIDEO:'Vídeo',DOCUMENT:'Documento',LOCATION:'Localização',PRODUCT:'Produto'};
  const renderHeader=(format,preview,key)=><div key={key} className="tm-media">{preview?<img src={preview} alt="Exemplo do cabeçalho"/>:<>{mediaLabel[format]||format}</>}</div>;
  const renderComponents=cs=><>{cs?.map((c,i)=>c.type?.toUpperCase()==='HEADER'&&c.format?.toUpperCase()!=='TEXT'?renderHeader(c.format?.toUpperCase(),null,i):c.text?<div className={c.type?.toUpperCase()==='FOOTER'?'tm-bubble-footer':''} key={i}>{c.text}</div>:c.type?.toUpperCase()==='BUTTONS'?c.buttons?.map((b,j)=><div key={`${i}:${j}`} className="tm-bubble-button">{b.text||b.type}</div>):c.type?.toUpperCase()==='CAROUSEL'?<div className="tm-cards-preview" key={i}>{c.cards.map((card,j)=><div key={j} className="tm-card-preview">{renderComponents(card.components)}</div>)}</div>:null)}</>;
  const fixed={catalog:'Ver catálogo',product:'Ver produto',products:'Ver itens',productCarousel:'Ver produto',flow:draft?.flow?.text||'Abrir formulário',callPermission:'Permitir ligação',voiceCall:draft?.callText||'Ligar pelo WhatsApp'};
  return <aside className="tm-preview"><div className="tm-preview-title"><h3>Prévia da mensagem</h3><span>WhatsApp</span></div><div className="tm-phone"><div className="tm-phone-header"><div><strong>Sua empresa</strong><small>Conta comercial</small></div></div><div className="tm-chat"><div className="tm-bubble">
    {item?renderComponents(item.components):<>
      {['location','product'].includes(kind)?renderHeader(kind==='location'?'LOCATION':'PRODUCT'):h.format==='TEXT'?<strong>{sampleText(h.text,h.examples)||'Cabeçalho'}</strong>:['IMAGE','VIDEO','DOCUMENT'].includes(h.format)?renderHeader(h.format,h.preview):null}
      {kind==='offer'&&<strong className="tm-offer">{draft.offerText||'Oferta especial'}{draft.hasExpiration&&' · por tempo limitado'}</strong>}
      <div className="tm-bubble-body">{auth?<><strong>123456</strong> é seu código de verificação.{draft.auth.security&&' Para sua segurança, não compartilhe este código.'}</>:sampleText(draft?.body,draft?.examples)||'Sua mensagem aparecerá aqui.'}</div>
      {(draft?.footer||auth&&draft.auth.expiration)&&<div className="tm-bubble-footer">{auth?`Este código expira em ${draft.auth.expiration} minutos.`:draft.footer}</div>}
      <small className="tm-time">12:00</small>
      {(kind==='coupon'||kind==='offer'&&draft.coupon)&&<div className="tm-bubble-button">Copiar código</div>}
      {auth&&<div className="tm-bubble-button">{draft.auth.mode==='COPY_CODE'?draft.auth.text:draft.auth.autofill}</div>}
      {fixed[kind]&&kind!=='productCarousel'&&<div className="tm-bubble-button">{fixed[kind]}</div>}
      {draft?.buttons.map((b,i)=><div className="tm-bubble-button" key={i}>{b.text||'Texto do botão'}</div>)}
      {['carousel','productCarousel'].includes(kind)&&<div className="tm-cards-preview">{draft.cards.map((card,i)=><div className="tm-card-preview" key={i}>{renderHeader(kind==='productCarousel'?'PRODUCT':card.header.format,card.header.preview)}<p>{sampleText(card.body,card.examples)||`Cartão ${i+1}`}</p>{kind==='productCarousel'?<div className="tm-bubble-button">Ver produto</div>:card.buttons.map((b,j)=><div className="tm-bubble-button" key={j}>{b.text||'Botão'}</div>)}</div>)}</div>}
    </>}
  </div></div></div></aside>;
}

// Catálogo de envio: o agente escolhe pelo nome de exibição e pela descrição, não
// pelo nome técnico da Meta. A macro fica inativa (fora do envio) até a Meta aprovar.
function CatalogPublish({item,entry,groups,api,busy,run,onSaved}){
  const [label,setLabel]=useState(''),[useCase,setUseCase]=useState(''),[groupIds,setGroupIds]=useState([]);
  const [error,setError]=useState(''),[saved,setSaved]=useState('');
  useEffect(()=>{
    setLabel(entry?.label??'');setUseCase(entry?.useCase??'');setGroupIds(entry?.groupIds??[]);
    setError('');setSaved('');
  },[item,entry]);
  // Formato não enviável ainda pode ter nome, descrição e grupo salvos: a macro fica
  // inativa e guarda só a identificação do template até o envio cobrir o formato.
  let text='',unsupported='';
  try{text=shorthand(catalogEntry(item));}
  catch(e){
    unsupported=e.message;
    const body=(item?.components||[]).find(c=>String(c?.type??'').toUpperCase()==='BODY')?.text;
    try{text=shorthand({name:item?.name,language:item?.language,fallback:(body||item?.name||'').replace(/\{\{[^}]*\}\}/g,'…').trim()||'Mensagem do WhatsApp',parameters:[]});}
    catch{text='';}
  }
  const approved=String(item?.status??'').toUpperCase()==='APPROVED';
  const blocked=text?'':unsupported;
  const toggle=id=>setGroupIds(ids=>ids.includes(id)?ids.filter(v=>v!==id):[...ids,id]);
  return <section className="tm-panel tm-catalog" aria-label="Catálogo de envio">
    <h2>{entry?'Mensagem no catálogo':'Publicar no catálogo da equipe'}</h2>
    {blocked?<Notice>{blocked}</Notice>:<>
      <p className="tm-muted">O nome de exibição e a descrição aparecem para o agente na hora de escolher a mensagem.</p>
      {!approved&&<Notice>Enquanto a Meta não aprovar, a mensagem fica guardada aqui e não aparece para os agentes.</Notice>}
      {unsupported&&<Notice>{unsupported} O nome e o grupo ficam salvos, mas a mensagem não entra no catálogo de envio.</Notice>}
      <TextField label="Nome de exibição" value={label} maxLength={80} placeholder="Aviso de atraso" onChange={setLabel}/>
      <FormField label="Descrição breve" hint="Explique em uma frase quando usar esta mensagem.">
        <Textarea rows={3} maxLength={255} value={useCase} onChange={e=>setUseCase(e.target.value)}/>
      </FormField>
      <fieldset className="tm-groups">
        <legend>Grupos</legend>
        <div className="tm-groups-grid">{groups.length?groups.map(g=><Field className="tm-check" key={g.id}>
          <Checkbox checked={groupIds.includes(g.id)} onChange={()=>toggle(g.id)}><Label>{g.name}</Label></Checkbox>
        </Field>):<p className="tm-muted">Nenhum grupo disponível nesta conta.</p>}</div>
        <p className="tm-muted">Sem grupo marcado, a mensagem fica disponível para toda a equipe.</p>
      </fieldset>
      {error&&<Notice danger>{error}</Notice>}
      {saved&&<Notice type="success"><strong>{saved}</strong></Notice>}
      <Button isPrimary disabled={busy||!label.trim()} onClick={()=>run(async()=>{
        setError('');setSaved('');
        try{
          const active=approved&&!unsupported;
          await api.saveCatalogEntry({macroId:entry?.id,title:label.trim(),description:useCase.trim(),groupIds,text,active});
          setSaved(active?'Mensagem disponível para os agentes.'
            :unsupported?'Nome e grupo salvos. O envio deste formato ainda não é suportado.'
            :'Mensagem guardada. Volte quando a Meta aprovar.');
          await onSaved?.();
        }catch(e){setError(e.message);}
      })}>{entry?'Salvar alterações':'Publicar no catálogo'}</Button>
    </>}
  </section>;
}

export function MetaTemplates({api,busy,run,groups=[]}){
  const [mode,setMode]=useState('list'),[draft,setDraft]=useState(newDraft),[items,setItems]=useState(null),[caps,setCaps]=useState({advanced:false,media:false});
  const [error,setError]=useState(''),[loading,setLoading]=useState(true),[attempted,setAttempted]=useState(false),[uploading,setUploading]=useState(false),[created,setCreated]=useState(null);
  const [search,setSearch]=useState(''),[filter,setFilter]=useState(''),[selected,setSelected]=useState(null);
  const [typeCategory,setTypeCategory]=useState('UTILITY'),[catalog,setCatalog]=useState([]);
  const loadCatalog=async()=>{try{setCatalog(await api.catalogEntries());}catch{setCatalog([]);}};
  const heading=useRef(null);const type=templateTypes.find(t=>t.id===draft.kind),locked=busy||attempted||uploading;
  const update=patch=>{setDraft(d=>({...d,...patch}));setError('');};
  const load=async()=>{setLoading(true);setError('');try{const [list,capabilities]=await Promise.all([api.metaTemplates(),api.metaTemplates(undefined,'capabilities')]);setItems(list.data);setCaps(capabilities);}catch(e){setError(e.message);}finally{setLoading(false);}};
  useEffect(()=>{let active=true;Promise.all([api.metaTemplates(),api.metaTemplates(undefined,'capabilities')]).then(([list,c])=>{if(active){setItems(list.data);setCaps(c);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[api]);
  useEffect(()=>{let active=true;api.catalogEntries().then(list=>{if(active)setCatalog(list);}).catch(()=>{if(active)setCatalog([]);});return()=>{active=false;};},[api]);
  useEffect(()=>{heading.current?.focus();},[mode]);
  const choose=kind=>{setDraft(newDraft(kind));setAttempted(false);setCreated(null);setError('');setMode('edit');};
  const blocked=type.external||requiresMeta(draft)&&!caps.advanced;
  const catalogType=['catalog','product','products','productCarousel'].includes(draft.kind);
  const showHeader=['standard','flow','coupon','offer','products','voiceCall'].includes(draft.kind);
  const showFooter=!['authentication','offer','carousel','productCarousel','callPermission'].includes(draft.kind);
  const showButtons=['standard','location','flow','coupon','offer','voiceCall'].includes(draft.kind);
  const visible=(items||[]).filter(t=>{
    const e=catalogMatch(catalog,t);
    return (!filter||t.status===filter)&&`${e?.label??''} ${e?.useCase??''} ${t.name} ${t.language}`.toLowerCase().includes(search.toLowerCase());
  });
  return <section className="tm-workspace">
    <header className="tm-page-header"><div><h1 ref={heading} tabIndex={-1}>{mode==='list'?'Templates do WhatsApp':mode==='choose'?'Novo template':mode==='review'?'Revisar template':mode==='catalog'?selected?.name:type.name}</h1>{mode==='catalog'&&<p className="tm-muted">{selected?.language} · {statusLabel(selected?.status)}</p>}</div>
      {mode==='list'?<div className="tm-actions"><Button disabled={busy||loading} onClick={load}>Atualizar</Button><Button isPrimary disabled={busy} onClick={()=>{setMode('choose');setSelected(null);setError('');}}>Criar template</Button></div>:<Button disabled={busy||uploading} isBasic onClick={()=>{if(!attempted&&mode==='review')setMode('edit');else if(mode==='edit')setMode('choose');else{setMode('list');setSelected(null);}setError('');}}>{mode==='review'&&!attempted?'Editar':'Voltar'}</Button>}
    </header>
    {error&&<Notice danger>{error}</Notice>}
    {mode==='list'&&<>
      <div className="tm-toolbar"><TextField label="Buscar templates" value={search} onChange={setSearch} placeholder="Buscar pelo nome"/><Choice label="Status" value={filter} onChange={setFilter} options={[["","Todos os status"],...Object.entries(statuses)]}/></div>
      {loading?<div className="tm-empty" role="status">Carregando templates…</div>:!error&&!visible.length?<div className="tm-empty"><h2>{items?.length?'Nenhum resultado':'Nenhum template cadastrado'}</h2><p>{items?.length?'Tente outro nome ou status.':''}</p>{!items?.length&&<Button isPrimary onClick={()=>setMode('choose')}>Criar template</Button>}</div>:!error&&<div className="tm-list-layout"><div className="tm-table-wrap"><Table><Table.Head><Table.HeaderRow><Table.HeaderCell>Mensagem</Table.HeaderCell><Table.HeaderCell>Categoria</Table.HeaderCell><Table.HeaderCell>Status</Table.HeaderCell></Table.HeaderRow></Table.Head><Table.Body>{visible.map(t=><Table.Row key={`${t.id}:${t.language}`} isSelected={selected?.name===t.name&&selected?.language===t.language}><Table.Cell>{(e=><>
  <button className="tm-link" onClick={()=>{setSelected(t);setMode('catalog');setError('');}}>{e?.label||t.name}</button>
  {e?.useCase&&<small className="tm-row-use-case">{e.useCase}</small>}
  <small>{e?`${t.name} · ${t.language}`:t.language}</small>
</>)(catalogMatch(catalog,t))}</Table.Cell><Table.Cell>{categoryNames[t.category]||t.category}</Table.Cell><Table.Cell><span className={`tm-status ${t.status?.toLowerCase()}`}>{statusLabel(t.status)}</span></Table.Cell></Table.Row>)}</Table.Body></Table></div></div>}
      {!!items?.length&&<p className="tm-footnote">Atualizações de status podem levar até duas horas para aparecer.</p>}
    </>}
    {mode==='catalog'&&selected&&<div className="tm-editor-layout">
      <div className="tm-form"><CatalogPublish item={selected} entry={catalogMatch(catalog,selected)} groups={groups} api={api} busy={busy} run={run} onSaved={loadCatalog}/></div>
      <Preview item={selected}/>
    </div>}
    {mode==='choose'&&<div className="tm-type-groups"><Tabs selectedItem={typeCategory} onChange={setTypeCategory} className="tm-category-tabs"><Tabs.TabList aria-label="Categoria do template">{Object.entries(categoryNames).map(([id,label])=><Tabs.Tab key={id} item={id}>{label}</Tabs.Tab>)}</Tabs.TabList><Tabs.TabPanel item={typeCategory}>{Object.entries(categoryNames).filter(([category])=>category===typeCategory).map(([category,label])=><section key={category}><h2>{label}</h2><p className="tm-muted">{{UTILITY:'Avisos sobre pedidos, serviços e atendimentos.',MARKETING:'Ofertas, novidades e recomendações.',AUTHENTICATION:'Códigos de acesso e confirmação de identidade.'}[category]}</p><div className="tm-type-grid">{templateTypes.filter(t=>t.categories.includes(category)).map(t=>{
        // Formato que o app não cria hoje deixa de ser um cartão clicável: em vez de
        // avisar o que falta, leva direto ao Gerenciador do WhatsApp, onde dá para criar.
        const unavailable=t.external||t.advanced&&!caps.advanced;
        if(unavailable)return <div key={t.id} className="tm-type-card tm-type-card-external">
          <strong>{t.name}</strong><span>{t.description}</span>
          <Anchor href={WABA_TEMPLATES_URL} isExternal externalIconLabel="abre em nova aba">Criar no Gerenciador do WhatsApp</Anchor>
        </div>;
        return <button key={t.id} className="tm-type-card" onClick={()=>{choose(t.id);setDraft(d=>({...d,category}));}}>
          <strong>{t.name}</strong><span>{t.description}</span>
          {t.advanced&&<small>Gerenciamento avançado</small>}
        </button>;
      })}</div></section>)}</Tabs.TabPanel></Tabs></div>}
    {['edit','review'].includes(mode)&&<>
      <Stepper isHorizontal activeIndex={mode==='edit'?1:2} style={{marginBottom:32}} className="tm-stepper" aria-label="Etapas">{['Tipo','Conteúdo','Revisão'].map(label=><Stepper.Step key={label}><Stepper.Label>{label}</Stepper.Label></Stepper.Step>)}</Stepper>
      <div className="tm-editor-layout"><div className="tm-form">
        {blocked&&<Notice type="warning"><strong>{type.external?'Este tipo exige habilitação de pagamentos':'Conexão adicional para este formato'}</strong><p>{type.external?'A disponibilidade depende do país e da conta. Configure e crie esse formato no Gerenciador do WhatsApp.':'Conecte o gerenciamento avançado nas configurações para enviar este formato.'}</p><Anchor href={WABA_TEMPLATES_URL} isExternal externalIconLabel="abre em nova aba">Abrir Gerenciador do WhatsApp</Anchor></Notice>}
        {mode==='review'?<section className="tm-panel"><h2>Confira antes de enviar</h2><dl className="tm-review"><dt>Nome</dt><dd>{draft.name}</dd><dt>Tipo</dt><dd>{type.name}</dd><dt>Categoria</dt><dd>{categoryNames[draft.category]}</dd><dt>Idioma</dt><dd>{draft.language}</dd></dl><p>O template será enviado à Meta para aprovação.</p>{created&&<Notice type="success"><strong>Template cadastrado</strong><p>{statusLabel(created.status)}</p><Button onClick={()=>{setMode('list');setCreated(null);}}>Ver templates</Button></Notice>}</section>:!type.external&&<fieldset className="tm-fieldset" disabled={locked}>
          <section className="tm-panel"><h2>Identificação</h2><div className="tm-grid"><TextField label="Nome do template" value={draft.name} maxLength={512} onChange={name=>update({name})} hint="Letras minúsculas, números e sublinhado." placeholder="confirmacao_agendamento"/><Choice label="Idioma" value={draft.language} onChange={language=>update({language})} options={[["pt_BR","Português (Brasil)"],["pt_PT","Português (Portugal)"],["en_US","Inglês (EUA)"],["en_GB","Inglês (Reino Unido)"],["es","Espanhol"],["es_AR","Espanhol (Argentina)"],["es_MX","Espanhol (México)"],["fr","Francês"],["de","Alemão"],["it","Italiano"]]}/></div></section>
          {draft.kind==='authentication'?<section className="tm-panel"><h2>Código de verificação</h2><Choice label="Como preencher o código" value={draft.auth.mode} onChange={mode=>update({auth:{...draft.auth,mode,terms:false}})} options={[["COPY_CODE","Copiar código"],["ONE_TAP","Preencher com um toque (Android)"],["ZERO_TAP","Preencher automaticamente (Android)"]]}/><p className="tm-muted">O texto da mensagem é definido e traduzido pela Meta.</p><Check label="Incluir aviso para não compartilhar o código" checked={draft.auth.security} onChange={security=>update({auth:{...draft.auth,security}})}/><div className="tm-grid"><TextField label="Validade em minutos (opcional)" type="number" min={1} max={90} value={draft.auth.expiration} onChange={expiration=>update({auth:{...draft.auth,expiration}})}/><TextField label="Texto para copiar" value={draft.auth.text} onChange={text=>update({auth:{...draft.auth,text}})}/></div>
            {draft.auth.mode!=='COPY_CODE'&&<><TextField label="Texto de preenchimento" value={draft.auth.autofill} onChange={autofill=>update({auth:{...draft.auth,autofill}})}/>{draft.auth.apps.map((app,i)=><div className="tm-grid" key={i}><TextField label={`Pacote Android ${i+1}`} value={app.package} placeholder="br.com.suaempresa.app" onChange={value=>update({auth:{...draft.auth,apps:draft.auth.apps.map((a,j)=>i===j?{...a,package:value}:a)}})}/><TextField label="Assinatura do aplicativo" value={app.hash} maxLength={11} onChange={value=>update({auth:{...draft.auth,apps:draft.auth.apps.map((a,j)=>i===j?{...a,hash:value}:a)}})}/></div>)}<Button size="small" isBasic disabled={draft.auth.apps.length>=5} onClick={()=>update({auth:{...draft.auth,apps:[...draft.auth.apps,{package:'',hash:''}]}})}>Aplicativo Android</Button></>}
            {draft.auth.mode==='ZERO_TAP'&&<Check label="Confirmo os termos da Meta e que meus clientes esperam o preenchimento automático do código." checked={draft.auth.terms} onChange={terms=>update({auth:{...draft.auth,terms}})}/>}
          </section>:<>
            <section className="tm-panel"><h2>Conteúdo da mensagem</h2>
              <Choice label="Variáveis" value={draft.parameterFormat} onChange={parameterFormat=>update({parameterFormat})} options={[["POSITIONAL","Numeradas · {{1}}, {{2}}"],["NAMED","Com nomes · {{nome}}, {{pedido}}"]]}/>
              {showHeader&&<><Choice label="Cabeçalho" value={draft.header.format} onChange={format=>update({header:{format,text:'',examples:{}}})} options={draft.kind==='products'?[["TEXT","Texto"]]:draft.kind==='offer'?[["NONE","Sem cabeçalho"],["IMAGE","Imagem"],["VIDEO","Vídeo"]]:[["NONE","Sem cabeçalho"],["TEXT","Texto"],["IMAGE","Imagem"],["VIDEO","Vídeo"],["DOCUMENT","Documento PDF"]]}/>
                {draft.header.format==='TEXT'&&<TextEditor label="Texto do cabeçalho" max={60} value={draft.header.text} examples={draft.header.examples} format={draft.parameterFormat} onChange={text=>update({header:{...draft.header,text}})} onExamples={examples=>update({header:{...draft.header,examples}})}/>}
                {['IMAGE','VIDEO','DOCUMENT'].includes(draft.header.format)&&<MediaField key={draft.header.format} header={draft.header} onChange={header=>update({header})} api={api} available={caps.media} onBusy={setUploading}/>}
              </>}
              <TextEditor label="Mensagem" value={draft.body} examples={draft.examples} format={draft.parameterFormat} max={draft.kind==='offer'?600:1024} onChange={body=>update({body})} onExamples={examples=>update({examples})}/>
              {showFooter&&<TextField label="Rodapé (opcional)" maxLength={60} value={draft.footer} onChange={footer=>update({footer})} placeholder="Sua empresa · Atendimento"/>}
            </section>
            {catalogType&&<section className="tm-panel"><h2>Produtos do catálogo</h2><p>O catálogo deve estar conectado à mesma conta WhatsApp. Os produtos e preços são escolhidos no envio, não no cadastro deste template.</p></section>}
            {['coupon','offer'].includes(draft.kind)&&<section className="tm-panel"><h2>Oferta</h2>{draft.kind==='offer'&&<><TextField label="Título da oferta" value={draft.offerText} maxLength={16} onChange={offerText=>update({offerText})}/><Check label="Exibir prazo de validade" checked={draft.hasExpiration} onChange={hasExpiration=>update({hasExpiration})}/></>}<TextField label={draft.kind==='offer'?'Exemplo de cupom (opcional)':'Exemplo de cupom'} value={draft.coupon} maxLength={20} onChange={coupon=>update({coupon})} placeholder="BEMVINDO10"/></section>}
            {draft.kind==='flow'&&<section className="tm-panel"><h2>Formulário conectado</h2><TextField label="ID do Flow publicado" value={draft.flow.id} onChange={id=>update({flow:{...draft.flow,id}})}/><TextField label="Texto do botão" value={draft.flow.text} onChange={text=>update({flow:{...draft.flow,text}})}/><Choice label="Ao abrir" value={draft.flow.action} onChange={action=>update({flow:{...draft.flow,action}})} options={[["navigate","Abrir uma tela"],["data_exchange","Consultar dados do formulário"]]}/>{draft.flow.action==='navigate'&&<TextField label="Nome da tela inicial" value={draft.flow.screen} onChange={screen=>update({flow:{...draft.flow,screen}})}/>}</section>}
            {draft.kind==='voiceCall'&&<section className="tm-panel"><TextField label="Texto do botão de ligação" value={draft.callText||'Ligar'} onChange={callText=>update({callText})}/></section>}
            {draft.kind==='location'&&<p className="tm-muted">O endereço e o ponto no mapa são definidos ao enviar a mensagem.</p>}
            {draft.kind==='carousel'&&<section className="tm-panel"><h2>Cartões do carrossel</h2><p className="tm-muted">Use o mesmo formato de mídia e os mesmos tipos de botões em todos os cartões.</p>{draft.cards.map((card,i)=>{
              const change=patch=>update({cards:draft.cards.map((c,j)=>j===i?{...c,...patch}:c)});
              return <div className="tm-card-editor" key={i}><div className="tm-between"><h3>Cartão {i+1}</h3><Button size="small" isBasic disabled={draft.cards.length<=2} onClick={()=>update({cards:draft.cards.filter((_,j)=>i!==j)})}>Remover cartão</Button></div><Choice label="Formato" value={card.header.format} onChange={format=>change({header:{format}})} options={[["IMAGE","Imagem"],["VIDEO","Vídeo"]]}/><MediaField header={card.header} onChange={header=>change({header})} api={api} available={caps.media} onBusy={setUploading}/><TextEditor label="Texto do cartão (opcional)" max={160} value={card.body} examples={card.examples} format={draft.parameterFormat} onChange={body=>change({body})} onExamples={examples=>change({examples})}/><ButtonsEditor value={card.buttons} onChange={buttons=>change({buttons})} max={2}/></div>;
            })}<Button size="small" isBasic disabled={draft.cards.length>=10} onClick={()=>update({cards:[...draft.cards,blankCard()]})}>Adicionar cartão</Button></section>}
            {showButtons&&<section className="tm-panel"><h2>Botões {draft.kind==='offer'?'':'(opcional)'}</h2><ButtonsEditor value={draft.buttons} onChange={buttons=>update({buttons})} max={['coupon','offer','flow','voiceCall'].includes(draft.kind)?9:10}/></section>}
          </>}
        </fieldset>}
        <div className="tm-form-actions"><Button disabled={busy||uploading} onClick={()=>setMode(mode==='review'&&!attempted?'edit':'list')}>{mode==='review'&&!attempted?'Editar conteúdo':'Voltar à lista'}</Button>
          {!type.external&&<Button isPrimary disabled={locked||mode==='review'&&blocked} onClick={()=>{
            if(mode==='edit'){try{metaTemplate(draft);setMode('review');setError('');}catch(e){setError(e.message);heading.current?.focus();}return;}
            run(async()=>{setAttempted(true);try{const input=JSON.parse(JSON.stringify(draft,(key,value)=>key==='preview'?undefined:value));const result=await api.metaTemplates(input);setCreated(result);setItems(current=>[result,...(current||[]).filter(t=>!(t.name===result.name&&t.language===result.language))]);}catch(e){setError(`${e.message} Confira a lista antes de uma nova tentativa; a criação não foi confirmada.`);}});
          }}>{mode==='edit'?'Revisar template':created?'Enviado':'Enviar para aprovação'}</Button>}
        </div>
      </div><Preview draft={draft}/></div>
    </>}
  </section>;
}
