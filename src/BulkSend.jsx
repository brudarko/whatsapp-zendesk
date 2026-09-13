import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@zendeskgarden/react-buttons";
import { Field, Label, Input, Textarea, Select } from "@zendeskgarden/react-forms";
import { Alert } from "@zendeskgarden/react-notifications";
import { Progress, Spinner } from "@zendeskgarden/react-loaders";
import { Tabs } from "@zendeskgarden/react-tabs";
import { XXL, MD, SM } from "@zendeskgarden/react-typography";
import { parseTemplate, formatPhone, formatPhoneInput, looksLikePhone, destinationPhone, getCountries, getCountryCallingCode } from "./outbound.js";
import { AppHeader, MessagePreview, StatusTag, SectionLabel, PlusIcon, CheckCircleIcon, XCircleIcon, AlertWarningIcon } from "./AppChrome.jsx";
import { TemplateAccess } from "./TemplateAccess.jsx";
import { contactField } from "./bulkFields.js";

const MAX = 15;
const countryNames = new Intl.DisplayNames(["pt-BR"], { type: "region" });
const countries = getCountries().sort((a, b) => a === "BR" ? -1 : b === "BR" ? 1 : countryNames.of(a).localeCompare(countryNames.of(b), "pt-BR"));

function digits(value) { return String(value || "").replace(/\D/g, ""); }
function phoneReady(phone, country) {
  try { return destinationPhone(phone, country); }
  catch { return ""; }
}

export function BulkSend({ data, api, busy, run, notice, onClose, location = "modal" }) {
  const [tab, setTab] = useState("massa");
  const [phase, setPhase] = useState("compose");
  const [country, setCountry] = useState("BR");
  const [query, setQuery] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [contacts, setContacts] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [selected, setSelected] = useState("");
  const [sources, setSources] = useState({});
  const [results, setResults] = useState({});
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState(1);
  const template = data.templates.find(t => String(t.id) === selected);
  const paramCount = useMemo(() => {
    if (!template) return 0;
    try { return parseTemplate(template.text).config.parameters.length; }
    catch { return 0; }
  }, [template]);
  const ready = contacts.filter(c => c.status === "ok");
  const incomplete = contacts.filter(c => c.status !== "ok");
  const atLimit = contacts.length >= MAX;

  useEffect(() => {
    const raw = query.trim();
    if (raw.length < 2) { setSuggestions([]); return; }
    let alive = true;
    const timer = setTimeout(() => {
      const byPhone = looksLikePhone(raw);
      const value = byPhone ? (() => { try { return destinationPhone(raw, country); } catch { return raw; } })() : raw;
      api.searchCustomers(value, byPhone ? "phone" : "name").then(found => {
        if (!alive) return;
        const taken = new Set(contacts.map(c => String(c.userId || digits(c.phone))));
        setSuggestions(found.filter(u => u.phone && u.role === "end-user" && !u.suspended && !taken.has(String(u.id)) && !taken.has(digits(u.phone))).slice(0, 4));
      }).catch(() => { if (alive) setSuggestions([]); });
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [query, country, contacts, api]);

  function addContact(entry) {
    if (atLimit) return;
    const phone = entry.phone || "";
    const e164 = phoneReady(phone, country);
    const key = String(entry.userId || e164 || digits(phone) || entry.name);
    if (contacts.some(c => c.key === key || (e164 && c.e164 === e164))) return;
    const parameters = Array.from({ length: paramCount }, (_, i) => sources[i] ? contactField(entry, sources[i]) : "");
    setContacts(list => [...list, {
      key, userId: entry.userId || "", name: entry.name || phone || "Contato",
      email: entry.email || "", phone, e164, status: e164 ? "ok" : "check",
      parameters,
    }].slice(0, MAX));
    setQuery(""); setSuggestions([]);
  }
  function addFromEntry() {
    const raw = query.trim();
    if (!raw) return;
    const match = suggestions[0];
    if (match && match.name.toLowerCase() === raw.toLowerCase()) return addContact({ ...match, userId: match.id });
    if (looksLikePhone(raw)) addContact({ name: raw, phone: raw });
    else addContact({ name: raw, phone: "" });
  }
  function addFromPaste() {
    const lines = pasteText.split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);
    lines.forEach(line => {
      if (looksLikePhone(line)) addContact({ name: line, phone: line });
      else addContact({ name: line, phone: "" });
    });
    setPasteText(""); setPasteOpen(false);
  }
  function removeContact(key) { setContacts(list => list.filter(c => c.key !== key)); }
  function setParam(key, index, value) {
    setContacts(list => list.map(c => c.key !== key ? c : { ...c, parameters: c.parameters.map((v, i) => i === index ? value : v) }));
  }
  useEffect(() => {
    setContacts(list => list.map(c => {
      const next = Array.from({ length: paramCount }, (_, i) => c.parameters[i] || "");
      return { ...c, parameters: next };
    }));
  }, [paramCount]);

  const preview = (() => {
    if (!template) return "";
    const sample = ready[0] || contacts[0];
    try { return parseTemplate(template.text, sample?.parameters).config.fallback; }
    catch { return ""; }
  })();
  const filled = ready.length && template && ready.every(c => c.parameters.every(v => String(v).trim()));

  async function send(list) {
    setPhase("sending"); setProgress(0);
    const next = { ...results };
    list.forEach(c => { next[c.key] = "sending"; });
    setResults({ ...next });
    let done = 0;
    for (const c of list) {
      try {
        await api.sendActive({
          userId: c.userId || undefined,
          ...(!c.userId ? { newCustomer: { name: c.name, phone: c.e164 || c.phone } } : {}),
          macroId: selected,
          parameters: c.parameters,
        }, location);
        next[c.key] = "ok";
      } catch (e) {
        next[c.key] = "fail";
        next[`${c.key}:error`] = e.message || "Falha no envio.";
      }
      done += 1;
      setResults({ ...next });
      setProgress(Math.round((done / list.length) * 100));
    }
    setPhase("done");
    notice?.(`${list.filter(c => next[c.key] === "ok").length} enviada(s).`);
  }

  const okKeys = Object.keys(results).filter(k => !k.includes(":") && results[k] === "ok");
  const failKeys = Object.keys(results).filter(k => !k.includes(":") && results[k] === "fail");
  const byKey = key => contacts.find(c => c.key === key);

  return <div className="bulk-page">
    {onClose && <AppHeader title="WhatsApp" onClose={onClose} />}
    <Tabs selectedItem={tab} onChange={setTab}>
      <div className="app-tab-scroll"><Tabs.TabList aria-label="Envio em massa">
        <Tabs.Tab item="massa">Envio em massa</Tabs.Tab>
        {data.currentUser?.role === "admin" && <Tabs.Tab item="templates">Templates</Tabs.Tab>}
      </Tabs.TabList></div>
      <Tabs.TabPanel item={tab} className="bulk-body">
        {tab === "templates" && data.currentUser?.role === "admin" && <TemplateAccess api={api} groups={data.groups} busy={busy} run={run} />}
        {tab === "massa" && phase === "compose" && <div className="bulk-compose">
          <div>
            <XXL tag="h1" style={{ margin: 0, fontWeight: 700 }}>Enviar mensagem ativa em massa</XXL>
            <MD style={{ marginTop: 4 }}>Envie um template aprovado para até {MAX} contatos ao mesmo tempo.</MD>
          </div>
          <div className="bulk-section-head">
            <SectionLabel>Destinatários</SectionLabel>
            <StatusTag label={`${contacts.length}/${MAX} contatos`} hue="grey" />
          </div>
          <div className="bulk-steps" aria-label="Etapas do envio">
            <span className="bulk-step-active">1. Destinatários</span><span className={step === 2 ? "bulk-step-active" : ""}>2. Mensagem</span>
          </div>
          <div className="bulk-add">
            <Field className="app-field"><Label>DDI</Label>
              <Select value={country} disabled={busy || atLimit} onChange={e => setCountry(e.target.value)}>
                {countries.map(code => <option key={code} value={code}>{countryNames.of(code)} (+{getCountryCallingCode(code)})</option>)}
              </Select>
            </Field>
            <Field className="app-field bulk-query"><Label>Nome ou número do contato</Label>
              <Input disabled={busy || atLimit} value={query}
                onChange={e => {
                  const raw = e.target.value;
                  if (looksLikePhone(raw)) { const formatted = formatPhoneInput(raw, country); setCountry(formatted.country); setQuery(formatted.value); }
                  else setQuery(raw);
                }}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addFromEntry(); } }} />
            </Field>
            <Button disabled={busy || atLimit || !query.trim()} onClick={addFromEntry}>
              <Button.StartIcon><PlusIcon /></Button.StartIcon>Adicionar
            </Button>
          </div>
          {!!suggestions.length && <ul className="bulk-suggest">{suggestions.map(u => <li key={u.id}>
            <button type="button" className="template" onClick={() => addContact({ ...u, userId: u.id })}>
              <strong>{u.name}</strong><span>{formatPhone(u.phone)}</span>
            </button>
          </li>)}</ul>}
          <Button isLink onClick={() => setPasteOpen(o => !o)}>Colar vários números</Button>
          {pasteOpen && <Field className="app-field"><Label>Números ou nomes</Label>
            <Textarea rows={4} value={pasteText} onChange={e => setPasteText(e.target.value)} placeholder={"Um por linha, ou separados por vírgula"} />
            <Button size="small" onClick={addFromPaste} disabled={!pasteText.trim()}>Adicionar da lista</Button>
          </Field>}
          {!!contacts.length && <ul className="bulk-list">{contacts.map(c => <li key={c.key} className="card bulk-row">
            <div><strong>{c.name}</strong><SM>{c.e164 ? formatPhone(c.e164) : c.phone || "Número incompleto"}</SM></div>
            {c.status !== "ok" && <StatusTag label="Número incompleto" hue="yellow" />}
            <Button size="small" isBasic onClick={() => removeContact(c.key)}>Remover</Button>
          </li>)}</ul>}
          {step === 2 && <>
          <Field className="app-field"><Label>Template</Label>
            <Select value={selected} disabled={busy} onChange={e => { setSelected(e.target.value); setSources({}); }}>
              <option value="">Selecione um template</option>
              {data.templates.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
          </Field>
          {!!paramCount && !!contacts.length && <div className="bulk-vars">
            <h2>Personalize por contato</h2>
            <p>Escolha um campo para preencher a variável em todas as linhas. Revise os valores antes de enviar.</p>
            <div className="bulk-source-grid">{Array.from({ length: paramCount }, (_, i) => <Field className="app-field" key={i}>
              <Label>Preencher variável {i + 1} com</Label>
              <Select value={sources[i] || ""} disabled={busy} onChange={e => {
                const field = e.target.value;
                setSources(current => ({ ...current, [i]: field }));
                if (field) setContacts(list => list.map(c => ({ ...c, parameters: c.parameters.map((v, index) => index === i ? contactField(c, field) : v) })));
              }}>
                <option value="">Preenchimento manual</option>
                <option value="firstName">Primeiro nome</option>
                <option value="name">Nome completo</option>
                <option value="email">E-mail</option>
                <option value="phone">Telefone</option>
              </Select>
            </Field>)}</div>
            <div className="bulk-var-table">
              <div className="bulk-var-head"><span>Contato</span>{Array.from({ length: paramCount }, (_, i) => <span key={i}>Variável {i + 1}</span>)}</div>
              {contacts.map(c => <div className="bulk-var-row" key={c.key}>
                <strong>{c.name}</strong>
                {c.parameters.map((value, i) => <Input key={i} aria-label={`Variável ${i + 1} de ${c.name}`} maxLength={1024} isCompact value={value} disabled={busy} onChange={e => setParam(c.key, i, e.target.value)} />)}
              </div>)}
            </div>
          </div>}
          {preview && <MessagePreview title={`Prévia — ${ready[0]?.name || contacts[0]?.name || "contato"}`}>{preview}</MessagePreview>}
          </>}
        </div>}
        {tab === "massa" && phase === "sending" && <div className="bulk-compose">
          <XXL tag="h1" style={{ margin: 0, fontWeight: 700 }}>Enviando mensagens…</XXL>
          <MD>Não feche esta janela até concluir.</MD>
          <div className="bulk-progress"><SM>{Object.values(results).filter(v => v !== "sending").length} de {ready.length}</SM><SM>{progress}%</SM></div>
          <Progress value={progress} aria-label="Progresso do envio" />
          <ul className="bulk-list">{ready.map(c => <li key={c.key} className="card bulk-row">
            <div><strong>{c.name}</strong><SM>{formatPhone(c.e164 || c.phone)}</SM></div>
            {results[c.key] === "sending" && <Spinner size="18" />}
            {results[c.key] === "ok" && <span className="bulk-ok"><CheckCircleIcon /> Enviado</span>}
            {results[c.key] === "fail" && <span className="bulk-fail"><XCircleIcon /> Falhou</span>}
          </li>)}</ul>
        </div>}
        {tab === "massa" && phase === "done" && <div className="bulk-compose">
          <div className="bulk-done-head">
            <span className={`bulk-done-icon ${failKeys.length ? "warn" : "ok"}`} aria-hidden="true">
              {failKeys.length ? <AlertWarningIcon size={22} /> : <CheckCircleIcon size={22} />}
            </span>
            <div>
              <XXL tag="h1" style={{ margin: 0, fontWeight: 700 }}>{okKeys.length} enviada{okKeys.length === 1 ? "" : "s"}{failKeys.length ? `, ${failKeys.length} falhou` : ""}</XXL>
              <MD>{template?.label}</MD>
            </div>
          </div>
          {!!failKeys.length && <Alert type="warning"><Alert.Title>Alguns envios falharam</Alert.Title>Você pode reenviar apenas os contatos que falharam.</Alert>}
          <ul className="bulk-list">{okKeys.concat(failKeys).map(key => {
            const c = byKey(key); if (!c) return null;
            return <li key={key} className="card bulk-row">
              <div><strong>{c.name}</strong><SM>{formatPhone(c.e164 || c.phone)}</SM>
                {results[`${key}:error`] && <SM>{results[`${key}:error`]}</SM>}
              </div>
              {results[key] === "ok" ? <span className="bulk-ok"><CheckCircleIcon /> Enviado</span> : <span className="bulk-fail"><XCircleIcon /> Falhou</span>}
            </li>;
          })}</ul>
        </div>}
      </Tabs.TabPanel>
    </Tabs>
    {tab === "massa" && phase === "compose" && <footer className="bulk-footer">
      <SM>{ready.length} de {contacts.length || 0} prontos para envio{incomplete.length ? ` · ${incomplete.length} com número incompleto` : ""}</SM>
      <div className="bulk-footer-actions">
        {onClose && <Button isBasic onClick={onClose}>Cancelar</Button>}
        {step === 2 && <Button isBasic onClick={() => setStep(1)}>Voltar</Button>}
        {step === 1 && <Button isPrimary disabled={busy || !ready.length} onClick={() => setStep(2)}>Continuar</Button>}
        {step === 2 && <Button isPrimary disabled={busy || !filled} onClick={() => run(() => send(ready))}>
          Enviar para {ready.length} contato{ready.length === 1 ? "" : "s"}
        </Button>}
      </div>
    </footer>}
    {tab === "massa" && phase === "done" && <footer className="bulk-footer">
      <span />
      <div className="bulk-footer-actions">
        {!!failKeys.length && <Button onClick={() => run(() => send(failKeys.map(byKey).filter(Boolean)))}>Reenviar falhas</Button>}
        <Button isPrimary onClick={onClose || (() => { setContacts([]); setResults({}); setProgress(0); setPhase("compose"); })}>Concluir</Button>
      </div>
    </footer>}
  </div>;
}
