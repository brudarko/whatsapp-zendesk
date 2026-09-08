import React, { useEffect, useState } from "react";
import { Button } from "@zendeskgarden/react-buttons";
import { metaTemplate } from "./metaTemplate.js";

export function MetaTemplates({ api, busy, run }) {
  const [name,setName]=useState(""), [category,setCategory]=useState("UTILITY"), [body,setBody]=useState("");
  const [language,setLanguage]=useState("pt_BR"), [examples,setExamples]=useState({}), [items,setItems]=useState(null), [message,setMessage]=useState(""), [attempted,setAttempted]=useState(false);
  const [loading,setLoading]=useState(true), [error,setError]=useState(""), [created,setCreated]=useState(false);
  useEffect(()=>{
    let active=true;
    api.metaTemplates().then(result=>{if(active)setItems(result.data);})
      .catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[api]);
  const statusLabel = status => ({APPROVED:"Aprovado",PENDING:"Em análise",REJECTED:"Rejeitado",PAUSED:"Pausado",DISABLED:"Desativado"})[status] || status || "Status não informado";
  const ids=[...new Set([...body.matchAll(/\{\{([1-9]\d*)\}\}/g)].map(m=>Number(m[1])))].sort((a,b)=>a-b);
  return <section><h2>Templates do WhatsApp</h2><p>Crie mensagens no canal conectado ao Zendesk e acompanhe a aprovação da Meta.</p>
    <Button disabled={busy||loading} onClick={()=>run(async()=>{
      setLoading(true);setError("");
      try {setItems((await api.metaTemplates()).data);} catch(e){setError(e.message);} finally{setLoading(false);}
    })}>Atualizar templates</Button>
    {loading&&<p role="status">Carregando templates…</p>}
    {error&&<p role="alert">{error}</p>}
    {!loading&&!error&&items?.length===0&&<p>Nenhum template cadastrado neste canal. Crie o primeiro abaixo.</p>}
    {items?.map(t=><article className="card" key={`${t.id}:${t.language}`}><strong>{t.name}</strong><p>{t.language} · {statusLabel(t.status)}</p>
      {t.components?.filter(c=>c.text).map((c,i)=><div key={i} className="message-preview">{c.text}</div>)}
      {t.components?.flatMap(c=>c.buttons||[]).map((b,i)=><p key={i}>{b.text}</p>)}
    </article>)}
    <p><small>A lista e os status podem levar até duas horas para atualizar.</small></p>
    <details><summary>Novo template</summary>
      <label className="select-label">Nome<input value={name} onChange={e=>setName(e.target.value)} placeholder="confirmacao_agendamento" disabled={busy||attempted}/></label>
      <label className="select-label">Categoria<select value={category} onChange={e=>setCategory(e.target.value)} disabled={busy||attempted}><option value="UTILITY">Utilidade</option><option value="MARKETING">Marketing</option></select></label>
      <label className="select-label">Idioma<select value={language} onChange={e=>setLanguage(e.target.value)} disabled={busy||attempted}><option value="pt_BR">Português (Brasil)</option><option value="en_US">Inglês (EUA)</option><option value="es">Espanhol</option></select></label>
      <label className="select-label">Mensagem<textarea rows={5} maxLength={1024} value={body} onChange={e=>setBody(e.target.value)} placeholder="Olá {{1}}, seu agendamento está confirmado." disabled={busy||attempted}/></label>
      {ids.map(id=><label className="select-label" key={id}>Exemplo da variável {id}<input value={examples[id]||""} onChange={e=>setExamples({...examples,[id]:e.target.value})} disabled={busy||attempted}/></label>)}
      <p>Prévia</p><div className="message-preview">{body.replace(/\{\{([1-9]\d*)\}\}/g,(_,id)=>examples[id]||`{{${id}}}`)}</div>
      <Button isPrimary disabled={busy||attempted||!body||!name} onClick={()=>run(async()=>{
        const input={name,language,category,body,examples:ids.map(id=>examples[id]||"")};metaTemplate(input);
        setAttempted(true);
        try { const result=await api.metaTemplates(input);setCreated(true);setMessage(`Template cadastrado. ${statusLabel(result.status)}.`);
          setItems(current=>[result,...(current||[]).filter(t=>!(t.name===result.name&&t.language===result.language))]);
        }
        catch(e){setMessage("Confira a lista antes de tentar novamente: o resultado da criação não foi confirmado.");throw e;}
      })}>Enviar para aprovação</Button>
      {message&&<p role="status">{message}</p>}
      {created&&<Button disabled={busy} onClick={()=>{setName("");setBody("");setExamples({});setMessage("");setAttempted(false);setCreated(false);}}>Criar outro template</Button>}
    </details><p><small>Nesta etapa: templates de texto e variáveis. Cabeçalhos, botões e autenticação ainda não estão disponíveis neste formulário.</small></p>
  </section>;
}
