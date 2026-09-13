import React, { useEffect, useState } from "react";
import { Field, Label, Input, Select } from "@zendeskgarden/react-forms";
import { Button } from "@zendeskgarden/react-buttons";
import { Spinner } from "@zendeskgarden/react-loaders";
import { parseTemplate, formatPhone } from "./outbound.js";
import { Notice, LoadingSkeleton } from "./GardenUI.jsx";
import { MessagePreview, StatusTag } from "./AppChrome.jsx";
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

function sendNotice(value) {
  if (value.assigned && value.merge?.intoNew) return `Envio solicitado e unido no ticket #${value.ticketId}.`;
  if (value.assigned && !value.merge?.merged) return value.state === "accepted"
    ? `Envio solicitado e atribuído ao ticket #${value.ticketId}. Entrega ainda não confirmada.`
    : value.message;
  if (value.merge?.merged) return `Envio solicitado e unido ao ticket #${value.ticketId}.`;
  return value.state === "accepted" ? "Envio solicitado. Entrega ainda não confirmada." : value.message;
}

export function OpenWindowNotice({ ticketId, currentTicketId, api, busy, run }) {
  if (currentTicketId != null && String(ticketId) === String(currentTicketId)) return null;
  return <Notice>
    <p>Já existe o ticket #{ticketId} dentro da janela de 24h. Abra a conversa em vez de enviar um template.</p>
    <div className="cm-conflict-actions">
      <Button isPrimary disabled={busy} onClick={() => run(() => api.openTicket(ticketId))}>Abrir ticket</Button>
    </div>
  </Notice>;
}

export function CustomerMessages({ customer, data, api, location, busy, run, notice, pane = "messages", children }) {
  const sendOnly = location === "top_bar", showHistory = !sendOnly && pane === "history";
  const showSend = sendOnly || pane === "messages";
  const [history, setHistory] = useState(null), [error, setError] = useState("");
  const [revision, setRevision] = useState(0), [config, setConfig] = useState(null);
  const [configLoading, setConfigLoading] = useState(true), [historyLoading, setHistoryLoading] = useState(false);
  const [selected, setSelected] = useState(""), [parameters, setParameters] = useState([]);
  const [attempted, setAttempted] = useState(false), [result, setResult] = useState(null);
  const [conflict, setConflict] = useState(null), [stalePrompt, setStalePrompt] = useState(false);
  useEffect(() => {
    let alive = true;
    setConfigLoading(true);
    api.outboundConfig().then(value => { if (alive) setConfig(value); }).catch(() => { if (alive) setConfig(null); })
      .finally(() => { if (alive) setConfigLoading(false); });
    return () => { alive = false; };
  }, [customer.id, api]);
  useEffect(() => {
    setResult(null); setAttempted(false); setStalePrompt(false); setConflict(null);
  }, [customer.id]);
  useEffect(() => {
    if (!showSend || !customer.id || result) { if (!customer.id) setConflict(null); return; }
    let alive = true;
    api.findSendConflict(customer.id).then(value => { if (alive) setConflict(value); })
      .catch(() => { if (alive) setConflict({ action: "send" }); });
    return () => { alive = false; };
  }, [customer.id, api, showSend, revision, result]);
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
  const messages = history?.messages || [];
  const redirecting = conflict?.action === "assign" && conflict.ticket;
  const checkingWindow = showSend && !!customer.id && !result && conflict === null;
  if (showSend && (checkingWindow || configLoading)) return <LoadingSkeleton compact />;
  return <div className="cm-workspace">
    <section hidden={!sendOnly && pane !== "messages"} aria-label="Enviar mensagem">
      {sendOnly && <h2>Enviar mensagem ativa</h2>}
      {sendOnly && <CustomerSummary customer={customer} />}
      {checkingWindow && <LoadingSkeleton label="Verificando se já existe conversa…" />}
      {redirecting && <OpenWindowNotice ticketId={conflict.ticket.id} currentTicketId={location === "ticket_sidebar" ? data.ticket?.id : undefined} api={api} busy={busy} run={run} />}
      {redirecting || checkingWindow ? null : !data.templates.length ? <div className="cm-empty"><strong>Nenhum template disponível</strong>
        <p>Nenhum template publicado está disponível no catálogo de envio.</p>
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
        {preview && <MessagePreview>{preview.config.fallback}</MessagePreview>}
        {configLoading ? <LoadingSkeleton label="Verificando conexão…" /> : !config && <Notice>Informe o App ID e o Key ID do Sunshine nas configurações do app para enviar.</Notice>}
        {conflict?.action === "stale" && conflict.ticket && stalePrompt && <Notice>
          <p>O ticket #{conflict.ticket.id} está aberto, mas a janela de 24h já passou. Feche e abra um novo ou una o atual no ticket que será criado.</p>
          <div className="cm-conflict-actions">
            <Button isPrimary disabled={busy || attempted || !config || !preview} onClick={() => run(async () => {
              setAttempted(true);
              try {
                const value = await api.sendActive({ userId: customer.id, macroId: selected, parameters, intent: "close_and_new", closeTicketId: conflict.ticket.id }, location);
                setConflict({ action: "send" });
                setStalePrompt(false);
                setResult(value);
                notice(sendNotice(value));
              } finally { setRevision(v => v + 1); }
            })}>Fechar atual e abrir novo</Button>
            <Button disabled={busy || attempted || !config || !preview} onClick={() => run(async () => {
              setAttempted(true);
              try {
                const value = await api.sendActive({ userId: customer.id, macroId: selected, parameters, intent: "merge_into_new", mergeTicketId: conflict.ticket.id }, location);
                setConflict({ action: "send" });
                setStalePrompt(false);
                setResult(value);
                notice(sendNotice(value));
              } finally { setRevision(v => v + 1); }
            })}>Unir no ticket novo</Button>
            <Button isBasic disabled={busy} onClick={() => setStalePrompt(false)}>Cancelar</Button>
          </div>
        </Notice>}
        {conflict?.action !== "assign" && !(conflict?.action === "stale" && stalePrompt) && <Button isPrimary disabled={busy || attempted || !config || !preview} onClick={() => {
          if (conflict?.action === "stale") { setStalePrompt(true); return; }
          run(async () => {
            setAttempted(true);
            try {
              const value = await api.sendActive({ userId: customer.id, ...(!customer.id ? { newCustomer: customer } : {}), macroId: selected, parameters }, location);
              setResult(value);
              notice(sendNotice(value));
            } finally { setRevision(v => v + 1); }
          });
        }}><Button.StartIcon>{busy && attempted && <Spinner size="16" />}</Button.StartIcon>{busy && attempted ? "Enviando…" : customer.id ? "Enviar mensagem" : "Criar contato e enviar"}</Button>}
      </>}
      {attempted && !result && <p className="cm-muted">Confira esta tentativa {sendOnly ? "no ticket" : "na aba Histórico"} antes de enviar novamente.</p>}
      {result && <div className="cm-result"><Button size="small" isBasic onClick={() => run(() => api.openTicket(result.ticketId))}>Abrir ticket #{result.ticketId}</Button>
        {result.merge?.offer && result.merge.target && <Button size="small" onClick={() => run(async () => {
          const merged = await api.mergeRecordTickets(customer.id, { auto: true, preferSource: result.ticketId });
          setResult({ ...result, ticketId: merged.ticketId || result.ticketId, merge: merged });
          notice(merged.merged ? `Tickets unidos no #${merged.ticketId}.` : "Não havia tickets para unir.");
        })}>Unir ao ticket #{result.merge.target.id}</Button>}
        {result.warning && <p role="status">{result.warning}</p>}</div>}
      {showSend && children}
    </section>
    <section hidden={!showHistory} aria-label="Histórico do contato">
      <div className="section-title"><h2>Histórico</h2><Button size="small" isBasic disabled={busy || historyLoading} onClick={() => setRevision(v => v + 1)}>Atualizar</Button></div>
      {error && <Notice danger>{error}</Notice>}
      {historyLoading && <LoadingSkeleton label="Carregando histórico…" />}
      {!historyLoading && !error && history?.failures.length > 0 && <Notice>Histórico parcial: {history.failures.length} {history.failures.length === 1 ? "ticket não pôde ser consultado" : "tickets não puderam ser consultados"}.</Notice>}
      {!historyLoading && !error && history && <>
        {!messages.length && <div className="cm-empty"><strong>Ainda não há envios</strong></div>}
        {!!messages.length && <ul className="cm-sends">{messages.map(m => <li key={`${m.ticketId}:${m.id}`} className="card">
          <div className="cm-history-meta">
            <time dateTime={m.created_at}>{new Date(m.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</time>
            <StatusTag label={m.status || "Sem confirmação de leitura"} />
          </div>
          {m.templateName && <strong>Template: {m.templateName}</strong>}
          <MessageBody body={m.preview || "Mensagem ativa"} />
          {m.event && <p className="cm-muted">{m.event}</p>}
        </li>)}</ul>}
      </>}
    </section>
  </div>;
}
