import React, { useEffect, useState } from "react";
import { Field, Label, Input, Select } from "@zendeskgarden/react-forms";
import { Button } from "@zendeskgarden/react-buttons";
import { Timeline } from "@zendeskgarden/react-accordions";
import { parseTemplate, formatPhone, RECORD_PREFIX } from "./outbound.js";
import { Notice } from "./GardenUI.jsx";
import { isLocalApp } from "./localConnection.js";

// Long histories stay readable: show the opening of the message and let the agent
// expand it in place. The label names the state it goes to, not the current one.
function MessageBody({ body }) {
  const [open, setOpen] = useState(false);
  if (body.length <= 240) return <p className="cm-message-body">{body}</p>;
  return <div className="cm-message-details">
    <p className="cm-message-body">{open ? body : `${body.slice(0, 160)}…`}</p>
    <Button size="small" isLink onClick={() => setOpen(!open)}>{open ? "Ver menos" : "Ver mensagem completa"}</Button>
  </div>;
}

function DevLocalConnection({ api, busy, run, onConnected }) {
  const [token, setToken] = useState(""), [connected, setConnected] = useState(false);
  if (!isLocalApp()) return null;
  if (connected) return <p role="status">Serviço local conectado.</p>;
  return <div className="card">
    <Field className="app-field"><Label>Chave temporária do serviço local</Label>
      <Input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value.trim())} disabled={busy} />
    </Field>
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

export const LocalConnection = (typeof LOCAL_SERVICE === "undefined" ? true : LOCAL_SERVICE)
  ? DevLocalConnection : () => null;

export function CustomerSummary({ customer }) {
  return <div className="customer cm-recipient"><strong>{customer.name}</strong><span>{formatPhone(customer.phone) || "Contato identificado pelo WhatsApp"}</span></div>;
}

export function CustomerMessages({ customer, data, api, location, busy, run, notice, pane = "messages", onTemplates }) {
  const sendOnly = location === "top_bar", showHistory = !sendOnly && pane === "history";
  const [history, setHistory] = useState(null), [error, setError] = useState("");
  const [revision, setRevision] = useState(0), [config, setConfig] = useState(null);
  const [configLoading, setConfigLoading] = useState(true), [historyLoading, setHistoryLoading] = useState(false);
  const [selected, setSelected] = useState(""), [parameters, setParameters] = useState([]);
  const [attempted, setAttempted] = useState(false), [result, setResult] = useState(null);
  const [filter, setFilter] = useState("all");
  useEffect(() => {
    let alive = true;
    setConfigLoading(true);
    api.outboundConfig().then(value => { if (alive) setConfig(value); }).catch(() => { if (alive) setConfig(null); })
      .finally(() => { if (alive) setConfigLoading(false); });
    return () => { alive = false; };
  }, [customer.id, api]);
  useEffect(() => {
    if (!showHistory || !customer.id) return;
    let alive = true;
    setHistoryLoading(true); setError("");
    api.customerHistory(customer.id).then(value => { if (alive) setHistory(value); })
      .catch(() => { if (alive) setError("Não foi possível carregar o histórico. Tente atualizar."); })
      .finally(() => { if (alive) setHistoryLoading(false); });
    return () => { alive = false; };
  }, [customer.id, revision, api, showHistory]);
  const template = data.templates.find(t => String(t.id) === selected);
  let preview = null, templateError = "";
  if (template) {
    try { preview = parseTemplate(template.text, parameters); } catch (e) { templateError = e.message; }
  }
  const messages = history?.messages.filter(m => filter === "all" || (filter === "records" ? m.record : !m.record)) || [];
  return <div className="cm-workspace">
    <section hidden={!sendOnly && pane !== "messages"} aria-label="Enviar mensagem">
      <h2>Enviar mensagem ativa</h2>
      {sendOnly && <CustomerSummary customer={customer} />}
      {!data.templates.length ? <div className="cm-empty"><strong>Nenhum template disponível</strong>
        {onTemplates ? <Button size="small" onClick={onTemplates}>Ver templates</Button> : <p>Um administrador precisa publicar mensagens no catálogo, em Gerenciar templates.</p>}
      </div> : <>
        <Field className="cm-field"><Label>Template</Label><Select value={selected} disabled={busy || attempted} onChange={e => {
          setSelected(e.target.value);
          try { setParameters(parseTemplate(data.templates.find(t => String(t.id) === e.target.value)?.text).config.parameters); }
          catch { setParameters([]); }
        }}><option value="">Selecione um template</option>{data.templates.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></Field>
        {template?.useCase && <p className="cm-muted cm-use-case">{template.useCase}</p>}
        {parameters.map((value, i) => <Field className="cm-field" key={i}><Label>Variável {i + 1}</Label>
          <Input value={value} maxLength={1024} disabled={busy || attempted} onChange={e => setParameters(parameters.map((v, index) => index === i ? e.target.value : v))} />
        </Field>)}
        {templateError && <Notice danger>{templateError}</Notice>}
        {preview && <div className="cm-preview"><span>Prévia da mensagem</span><p>{preview.config.fallback}</p></div>}
        {configLoading ? <p className="cm-muted" role="status">Verificando conexão…</p> : !config && <Notice>Conecte o WhatsApp nas configurações para enviar.</Notice>}
        <Button isPrimary disabled={busy || attempted || !config || !preview} onClick={() => run(async () => {
          setAttempted(true);
          try {
            const value = await api.sendActive({ userId: customer.id, ...(!customer.id ? { newCustomer: customer } : {}), macroId: selected, parameters }, location);
            setResult(value);
            notice(value.state === "accepted" ? "Envio solicitado. Entrega ainda não confirmada." : value.message);
          } finally { setRevision(v => v + 1); }
        })}>{busy && attempted ? "Enviando…" : customer.id ? "Enviar mensagem" : "Criar contato e enviar"}</Button>
      </>}
      {attempted && !result && <p className="cm-muted">Confira esta tentativa {sendOnly ? "no ticket" : "na aba Histórico"} antes de enviar novamente.</p>}
      {result && <div className="cm-result"><Button size="small" isBasic onClick={() => run(() => api.openTicket(result.ticketId))}>Abrir ticket #{result.ticketId}</Button>
        {result.state === "accepted" && <ReadReceipt ticketId={result.ticketId} api={api} busy={busy} />}
        {result.warning && <p role="status">{result.warning}</p>}</div>}
    </section>
    <section hidden={!showHistory} aria-label="Histórico do contato">
      <div className="section-title"><h2>Histórico</h2><Button size="small" isBasic disabled={busy || historyLoading} onClick={() => setRevision(v => v + 1)}>Atualizar</Button></div>
      {error && <Notice danger>{error}</Notice>}
      {historyLoading && <p role="status" className="cm-muted">Carregando histórico…</p>}
      {!historyLoading && !error && history?.failures.length > 0 && <Notice>Histórico parcial: {history.failures.length} {history.failures.length === 1 ? "ticket não pôde ser consultado" : "tickets não puderam ser consultados"}.</Notice>}
      {!historyLoading && !error && history && <>
        {history.messages.length > 0 && <div className="cm-filter">
          <Field><Label hidden>Mostrar</Label>
            <Select isCompact value={filter} onChange={e => setFilter(e.target.value)}>
              <option value="all">Todas as mensagens</option><option value="records">Registros de envio</option><option value="whatsapp">Conversas do WhatsApp</option>
            </Select>
          </Field>
          <span className="cm-muted cm-count">{messages.length} {messages.length === 1 ? "registro" : "registros"}</span>
        </div>}
        {!messages.length && <div className="cm-empty"><strong>{history.messages.length ? "Nenhum registro neste filtro" : "Ainda não há mensagens"}</strong><p>{history.messages.length ? "Selecione outro filtro para ver as conversas." : ""}</p></div>}
        {!!messages.length && <Timeline className="cm-timeline">{messages.map(m => {
          let body = m.plain_body ?? m.body ?? "Mensagem sem texto";
          if (body.startsWith(RECORD_PREFIX)) {
            try { const record = JSON.parse(body.slice(RECORD_PREFIX.length)); body = `Tentativa de envio registrada${record.parameters?.length ? `\nValores: ${record.parameters.join(" · ")}` : ""}`; }
            catch { body = "Registro de envio. Abra o ticket para consultar os detalhes."; }
          }
          return <Timeline.Item key={`${m.ticketId}:${m.id}`}>
            <Timeline.Content>
              <div className="cm-history-meta"><span>{m.record ? "Registro de envio" : "WhatsApp"}</span><time dateTime={m.created_at}>{new Date(m.created_at).toLocaleString("pt-BR", {dateStyle:"short", timeStyle:"short"})}</time></div>
              <MessageBody body={body} />
              {m.record && <ReadReceipt ticketId={m.ticketId} api={api} busy={busy} />}
              <Button size="small" isLink title={m.subject} onClick={() => run(() => api.openTicket(m.ticketId))}>Abrir ticket #{m.ticketId}</Button>
            </Timeline.Content>
          </Timeline.Item>;
        })}</Timeline>}
        {!!messages.length && <p className="cm-muted cm-footnote">Os registros não confirmam entrega ou leitura.</p>}
      </>}
    </section>
  </div>;
}
