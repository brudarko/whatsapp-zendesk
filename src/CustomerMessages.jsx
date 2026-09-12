import React, { useEffect, useState } from "react";
import { Field, Label, Input, Select } from "@zendeskgarden/react-forms";
import { Button } from "@zendeskgarden/react-buttons";
import { parseTemplate, formatPhone } from "./outbound.js";
import { sendStatusLabel } from "./sendStatus.js";
import { Notice } from "./GardenUI.jsx";
import { isLocalApp } from "./localConnection.js";

function ReadReceipt({ ticketId, api }) {
  const [label, setLabel] = useState("Sem confirmação de leitura");
  useEffect(() => {
    if (!ticketId) return;
    let alive = true;
    const load = () => api.sendStatuses([ticketId]).then(({ sends = {} }) => {
      if (alive) setLabel(sendStatusLabel(sends[String(ticketId)]));
    }).catch(() => {});
    load();
    const timer = setInterval(load, 8000);
    return () => { alive = false; clearInterval(timer); };
  }, [ticketId, api]);
  return <p role="status" className="cm-muted">{label}</p>;
}

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

function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const comma = text.indexOf(",");
      resolve(comma >= 0 ? text.slice(comma + 1) : text);
    };
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

function SessionComposer({ customer, ticketId, api, busy, run, notice }) {
  const [windowState, setWindowState] = useState(null);
  const [kind, setKind] = useState("image");
  const [file, setFile] = useState(null);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  useEffect(() => {
    if (!ticketId && !customer.id) return;
    let alive = true;
    const load = () => {
      const request = ticketId ? api.serviceWindow(ticketId) : api.contactWindow(customer.id);
      request.then(value => { if (alive) setWindowState(value); }).catch(() => { if (alive) setWindowState(null); });
    };
    load();
    const timer = setInterval(load, 60000);
    return () => { alive = false; clearInterval(timer); };
  }, [ticketId, customer.id, api]);
  if (windowState?.state !== "open" || !windowState.conversationId) return null;
  return <div className="card cm-session">
    <h3>Janela de 24h</h3>
    <p className="cm-muted">Imagem, áudio, arquivo ou localização. Não substitui o compositor do Agent Workspace.</p>
    <Field className="cm-field"><Label>Tipo</Label>
      <Select value={kind} disabled={busy} onChange={e => setKind(e.target.value)}>
        <option value="image">Imagem</option>
        <option value="file">Áudio ou arquivo</option>
        <option value="location">Localização</option>
      </Select>
    </Field>
    {kind !== "location" ? <Field className="cm-field"><Label>{kind === "image" ? "Imagem" : "Arquivo"}</Label>
      <Input type="file" accept={kind === "image" ? "image/*" : "audio/*,.pdf,.doc,.docx,.xls,.xlsx"} disabled={busy} onChange={e => setFile(e.target.files?.[0] || null)} />
    </Field> : <>
      <Field className="cm-field"><Label>Latitude</Label><Input value={lat} disabled={busy} onChange={e => setLat(e.target.value)} /></Field>
      <Field className="cm-field"><Label>Longitude</Label><Input value={lng} disabled={busy} onChange={e => setLng(e.target.value)} /></Field>
    </>}
    <Button disabled={busy || (kind === "location" ? !lat || !lng : !file)} onClick={() => run(async () => {
      const content = kind === "location"
        ? { type: "location", coordinates: { lat: Number(lat), long: Number(lng) } }
        : { type: kind === "image" ? "image" : "file", file: { name: file.name, type: file.type || "application/octet-stream", data: await fileAsBase64(file) } };
      await api.sendSession({ userId: customer.id, ticketId, conversationId: windowState.conversationId, content });
      notice("Mensagem da janela enviada. Entrega ainda não confirmada.");
      setFile(null);
    })}>Enviar na janela</Button>
  </div>;
}


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

export function CustomerMessages({ customer, data, api, location, busy, run, notice, pane = "messages", onTemplates }) {
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
    setResult(null); setAttempted(false); setStalePrompt(false);
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
  return <div className="cm-workspace">
    <section hidden={!sendOnly && pane !== "messages"} aria-label="Enviar mensagem">
      <h2>Enviar mensagem ativa</h2>
      {sendOnly && <CustomerSummary customer={customer} />}
      {conflict?.action === "assign" && conflict.ticket && <Notice>
        <p>Já existe o ticket #{conflict.ticket.id} dentro da janela de 24h. Atribua a conversa a você em vez de enviar um template.</p>
        <div className="cm-conflict-actions">
          <Button isPrimary disabled={busy} onClick={() => run(async () => {
            const assigned = await api.assignToCurrentUser(conflict.ticket.id);
            setConflict({ action: "send" });
            setResult({ ticketId: assigned.ticketId, assigned: true });
            notice(`Ticket #${assigned.ticketId} atribuído a você.`);
          })}>Atribuir a mim</Button>
          <Button isBasic disabled={busy} onClick={() => setConflict({ action: "send" })}>Cancelar</Button>
        </div>
      </Notice>}
      {!data.templates.length ? <div className="cm-empty"><strong>Nenhum template disponível</strong>
        {onTemplates ? <Button size="small" onClick={onTemplates}>Ver templates</Button> : <p>Só entram aqui as mensagens publicadas no catálogo de envio (aprovadas na Meta; botão Flow entra, outros botões e mídia ainda não). Em Gerenciar templates, clique em Atualizar e recarregue este painel.</p>}
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
        {configLoading ? <p className="cm-muted" role="status">Verificando conexão…</p> : !config && <Notice>Informe o App ID e o Key ID do Sunshine nas configurações do app para enviar.</Notice>}
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
        }}>{busy && attempted ? "Enviando…" : customer.id ? "Enviar mensagem" : "Criar contato e enviar"}</Button>}
      </>}
      {attempted && !result && <p className="cm-muted">Confira esta tentativa {sendOnly ? "no ticket" : "na aba Histórico"} antes de enviar novamente.</p>}
      {result && <div className="cm-result"><Button size="small" isBasic onClick={() => run(() => api.openTicket(result.ticketId))}>Abrir ticket #{result.ticketId}</Button>
        {result.merge?.offer && result.merge.target && <Button size="small" onClick={() => run(async () => {
          const merged = await api.mergeRecordTickets(customer.id, { auto: true, preferSource: result.ticketId });
          setResult({ ...result, ticketId: merged.ticketId || result.ticketId, merge: merged });
          notice(merged.merged ? `Tickets unidos no #${merged.ticketId}.` : "Não havia tickets para unir.");
        })}>Unir ao ticket #{result.merge.target.id}</Button>}
        {result.state === "accepted" && <ReadReceipt ticketId={result.ticketId} api={api} />}
        {result.warning && <p role="status">{result.warning}</p>}</div>}
      {!sendOnly && <SessionComposer customer={customer} ticketId={data.ticket?.id} api={api} busy={busy} run={run} notice={notice} />}
    </section>
    <section hidden={!showHistory} aria-label="Histórico do contato">
      <div className="section-title"><h2>Histórico</h2><Button size="small" isBasic disabled={busy || historyLoading} onClick={() => setRevision(v => v + 1)}>Atualizar</Button></div>
      {error && <Notice danger>{error}</Notice>}
      {historyLoading && <p role="status" className="cm-muted">Carregando histórico…</p>}
      {!historyLoading && !error && history?.failures.length > 0 && <Notice>Histórico parcial: {history.failures.length} {history.failures.length === 1 ? "ticket não pôde ser consultado" : "tickets não puderam ser consultados"}.</Notice>}
      {!historyLoading && !error && history && <>
        {!messages.length && <div className="cm-empty"><strong>Ainda não há envios</strong></div>}
        {!!messages.length && <ul className="cm-sends">{messages.map(m => <li key={`${m.ticketId}:${m.id}`} className="card">
          <div className="cm-history-meta">
            <time dateTime={m.created_at}>{new Date(m.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</time>
            <span role="status">{m.status || "Sem confirmação de leitura"}</span>
          </div>
          <MessageBody body={m.preview || "Mensagem ativa"} />
          {m.event && <p className="cm-muted">{m.event}</p>}
        </li>)}</ul>}
      </>}
    </section>
  </div>;
}
