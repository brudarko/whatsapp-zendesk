import React, { useEffect, useState } from "react";
import { Button } from "@zendeskgarden/react-buttons";
import { parseTemplate, RECORD_PREFIX } from "./outbound.js";
import { isLocalApp } from "./localConnection.js";

export function LocalConnection({ api, busy, run, onConnected }) {
  const [token, setToken] = useState(""), [connected, setConnected] = useState(false);
  if (!isLocalApp()) return null;
  if (connected) return <p role="status">Serviço local conectado.</p>;
  return <div className="card">
    <label className="select-label">Chave temporária do serviço local
      <input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value.trim())} disabled={busy} />
    </label>
    <Button disabled={busy || !/^[a-f0-9]{64}$/.test(token)} onClick={() => run(async () => {
      sessionStorage.setItem("whatsapp-local-token", token);
      try {
        const config = await api.outboundConfig();
        if (!config?.localToken) throw new Error("Não foi possível conectar ao serviço local.");
        setConnected(true); setToken(""); onConnected?.(config);
      } catch (e) { sessionStorage.removeItem("whatsapp-local-token"); throw e; }
    })}>Conectar serviço local</Button>
  </div>;
}

export function CustomerMessages({ customer, data, api, location, busy, run, notice }) {
  const sendOnly = location === "top_bar";
  const SendContainer = sendOnly ? "div" : "details";
  const [history, setHistory] = useState(null), [error, setError] = useState("");
  const [revision, setRevision] = useState(0), [config, setConfig] = useState(null);
  const [selected, setSelected] = useState(""), [parameters, setParameters] = useState([]);
  const [attempted, setAttempted] = useState(false), [result, setResult] = useState(null);
  useEffect(() => {
    let alive = true;
    setHistory(null); setError("");
    if (customer.id && !sendOnly) api.customerHistory(customer.id).then(value => { if (alive) setHistory(value); })
      .catch(() => { if (alive) setError("Não foi possível consultar o histórico. Verifique suas permissões e tente novamente."); });
    api.outboundConfig().then(value => { if (alive) setConfig(value); }).catch(() => { if (alive) setConfig(null); });
    return () => { alive = false; };
  }, [customer.id, revision, api, sendOnly]);
  const template = data.templates.find(t => String(t.id) === selected);
  let preview = null, templateError = "";
  if (template) {
    try { preview = parseTemplate(template.text, parameters); } catch (e) { templateError = e.message; }
  }
  return <section>
    <h2>{sendOnly ? "Enviar mensagem ativa" : customer.id ? "Mensagens do contato" : "Nova mensagem"}</h2>
    <p>{customer.name} · {customer.phone || "Destinatário identificado pelo vínculo WhatsApp"}</p>
    <SendContainer {...(!sendOnly ? { open: true } : {})}>
      {!sendOnly && <summary>Enviar mensagem ativa</summary>}
      {!config && <p role="status">{sendOnly ? "Configure a conexão WhatsApp para liberar o envio." : "O envio precisa da conexão com o serviço WhatsApp. O histórico e a revisão de contatos já podem ser usados."}</p>}
      <label className="select-label">Template
        <select value={selected} disabled={busy || attempted} onChange={e => {
          setSelected(e.target.value);
          try { setParameters(parseTemplate(data.templates.find(t => String(t.id) === e.target.value)?.text).config.parameters); }
          catch { setParameters([]); }
        }}>
          <option value="">Selecione um template</option>
          {data.templates.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </label>
      {!data.templates.length && <p>Nenhum template disponível. Cadastre um modelo aprovado {sendOnly ? "na área Templates do app na navegação lateral." : "na aba Templates."}</p>}
      {parameters.map((value, i) => <label className="select-label" key={i}>Variável {i + 1}
        <input value={value} maxLength={1024} disabled={busy || attempted} onChange={e => setParameters(parameters.map((v, index) => index === i ? e.target.value : v))} />
      </label>)}
      {templateError && <p role="alert">{templateError}</p>}
      {preview && <div className="card"><strong>{preview.config.name} · {preview.config.language}</strong>
        <p>{preview.config.fallback}</p>
      </div>}
      <Button isPrimary disabled={busy || attempted || !config || !preview} onClick={() => run(async () => {
        setAttempted(true);
        try {
          const value = await api.sendActive({ userId: customer.id, ...(!customer.id ? { newCustomer: customer } : {}), macroId: selected, parameters }, location);
          setResult(value);
          notice(value.state === "accepted" ? "Solicitação aceita pela API. Entrega e leitura ainda não confirmadas." : value.message);
        } finally { setRevision(v => v + 1); }
      })}>{customer.id ? "Registrar e enviar" : "Criar contato e enviar"}</Button>
      {attempted && <p>Antes de iniciar outro envio, confira o resultado desta tentativa {sendOnly ? "no ticket ou no perfil do contato." : "no histórico."}</p>}
      {result && <p><Button size="small" onClick={() => run(() => api.openTicket(result.ticketId))}>Abrir ticket #{result.ticketId}</Button>{result.warning && <span> · {result.warning}</span>}</p>}
    </SendContainer>
    {customer.id && !sendOnly && <><div className="section-title"><h3>Histórico entre tickets</h3>
      <Button size="small" disabled={busy} onClick={() => setRevision(v => v + 1)}>Atualizar histórico</Button>
    </div>
    <p>Conversas e envios registrados para este contato.</p>
    {error && <p role="alert">{error}</p>}
    {!history && !error && <p role="status">Consultando os tickets do contato…</p>}
    {history?.failures.length > 0 && <p role="alert">Histórico parcial: não foi possível consultar {history.failures.length} ticket(s).</p>}
    {history && <p>{history.messages.length} registro(s) em {history.ticketCount} ticket(s) consultado(s).</p>}
    {history?.messages.map(m => {
      let body = m.plain_body ?? m.body ?? "Mensagem sem texto";
      if (body.startsWith(RECORD_PREFIX)) {
        try { const record = JSON.parse(body.slice(RECORD_PREFIX.length)); body = `Tentativa registrada · macro #${record.macroId}\nValores: ${(record.parameters ?? []).join(" · ")}`; } catch { /* Show the original record when malformed. */ }
      }
      return <article className="card" key={`${m.ticketId}:${m.id}`}>
        <Button size="small" onClick={() => run(() => api.openTicket(m.ticketId))}>Ticket #{m.ticketId} · {m.subject}</Button>
        <p><time dateTime={m.created_at}>{new Date(m.created_at).toLocaleString("pt-BR")}</time> · {m.record ? "Registro interno" : "WhatsApp"}</p>
        <pre>{body}</pre><small>{m.status}</small>
      </article>;
    })}</>}
  </section>;
}
