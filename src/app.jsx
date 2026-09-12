import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@zendeskgarden/react-theming";
import { Button } from "@zendeskgarden/react-buttons";
import { Field, Label, Input, Textarea, Select, Checkbox } from "@zendeskgarden/react-forms";
import { Tabs } from "@zendeskgarden/react-tabs";
import { AppStyles, Notice, Disclosure } from "./GardenUI.jsx";
import { parseTemplate } from "./outbound.js";
import { zendesk } from "./zendesk.js";
import { IdentityPanel } from "./IdentityPanel.jsx";
import { CustomerMessages, CustomerSummary, LocalConnection } from "./CustomerMessages.jsx";
import { MetaTemplates } from "./MetaTemplates.jsx";
import { WindowStatus } from "./WindowStatus.jsx";
import { TopBarMessages } from "./TopBarMessages.jsx";
import "./style.css";

const client = window.ZAFClient?.init(),
  api = client && zendesk(client);
const empty = {
  currentUser: null,
  groups: [],
  templates: [],
  ticket: null,
  conversation: [],
};
function TextField({ label, value, onChange, multiline, ...props }) {
  const Control = multiline ? Textarea : Input;
  return (
    <Field className="app-field">
      <Label>{label}</Label>
      <Control
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...props}
      />
    </Field>
  );
}

// Estado das duas conexões: o canal WhatsApp (credencial da Conversations API
// informada na instalação) e o serviço de envio (opcional, para disparo validado).
function ServiceStatus({ api }) {
  const [channel, setChannel] = useState(undefined), [service, setService] = useState(undefined);
  const [issues, setIssues] = useState([]);
  useEffect(() => {
    let alive = true;
    api.sunshineScope()
      .then(value => { if (alive) setChannel(value ? { integrationId: value.scope.integrationId } : null); })
      .catch(e => { if (alive) setChannel({ error: e.message }); });
    api.sunshineSettingsIssues().then(list => { if (alive) setIssues(list); }).catch(() => {});
    api.outboundConfig().then(value => { if (alive) setService(value); }).catch(() => { if (alive) setService(null); });
    return () => { alive = false; };
  }, [api]);
  return <>
    {channel === undefined ? <p role="status" className="cm-muted">Verificando o canal WhatsApp…</p>
      : channel?.integrationId ? <Notice type="success">
          <strong>Canal WhatsApp conectado</strong>
          <p>Integração {channel.integrationId}</p>
        </Notice>
      : channel?.error ? <Notice danger><strong>Não foi possível ler o canal WhatsApp</strong><p>{channel.error}</p></Notice>
      : <Notice>
          <strong>Credencial da Conversations API ausente</strong>
          <p>Preencha App ID, Key ID e Secret nas configurações do app, em Admin Center · Apps e integrações. A chave é criada em APIs · Conversations API.</p>
          {!!issues.length && <ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
        </Notice>}
    {service === undefined ? null
      : service?.host ? <Notice type="success"><strong>Serviço de envio conectado</strong><p>{service.host}</p></Notice>
      : service?.localToken ? <Notice type="success"><strong>Serviço local conectado</strong><p>Vale só neste ambiente de desenvolvimento.</p></Notice>
      : <Notice>
          <strong>Envio ativo sem serviço</strong>
          <p>Templates, histórico, janela de 24h e leitura funcionam pela credencial acima. O disparo de mensagem ativa precisa do servidor de envio, configurado no mesmo formulário.</p>
        </Notice>}
  </>;
}

function App() {
  const [data, setData] = useState(empty),
    [location, setLocation] = useState("ticket_sidebar"),
    [view, setView] = useState("templates");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [connected, setConnected] = useState(false),
    [loading, setLoading] = useState(true),
    [now, setNow] = useState(Date.now());
  const [autoBusy, setAutoBusy] = useState(false);
  const [ticketMerge, setTicketMerge] = useState(null);
  const autoChecked = useRef(new Set()), autoTicket = useRef(""), autoMerge = useRef(false), autoRunning = useRef(false);
  const ticketMergeTried = useRef(new Set());
  const operation = useRef(false),
    version = useRef(0);
  async function refresh(loc = location) {
    const id = ++version.current;
    const values = await api.load(loc);
    if (id !== version.current) return;
    setData(values);
    const loaded = values;
    autoTicket.current = `${values.ticket?.id}:${values.ticket?.requester?.id}`;
    const offerTicketMerge = () => {
      if (loc !== "ticket_sidebar" || !values.ticket?.id) { setTicketMerge(null); return; }
      api.findTicketMerge(values.ticket.id).then(async offer => {
        if (!offer?.sources?.length || !offer.target) { setTicketMerge(null); return; }
        if (await api.autoMergeTicketsEnabled().catch(() => false)) {
          const mergeKey = `tickets:${values.ticket.id}:${offer.target.id}`;
          if (ticketMergeTried.current.has(mergeKey)) { setTicketMerge(offer); return; }
          ticketMergeTried.current.add(mergeKey);
          const merged = await api.mergeRecordTickets(values.ticket.requester.id, { auto: true, preferSource: values.ticket.id });
          if (merged.merged) {
            setTicketMerge(null);
            setNotice(`Tickets unidos no #${merged.ticketId}.`);
          } else setTicketMerge(offer);
        } else setTicketMerge(offer);
      }).catch(() => setTicketMerge(null));
    };
    if (!autoMerge.current || loc !== "ticket_sidebar" || !values.ticket?.id || operation.current || autoRunning.current) {
      offerTicketMerge();
      return loaded;
    }
    const key = `${values.ticket.id}:${values.ticket.requester?.id}`;
    if (autoChecked.current.has(key)) {
      offerTicketMerge();
      return loaded;
    }
    autoChecked.current.add(key);
    // Trava própria: a verificação automática não pode bloquear as ações do agente,
    // que são serializadas por run(). Antes ela tomava o mesmo mutex e, enquanto
    // esperava, todo clique era engolido em silêncio.
    autoRunning.current = true;
    setAutoBusy(true);
    try {
      const context = await client.context();
      const account = context.account?.subdomain;
      if (!account || !navigator.locks?.request)
        throw new Error("Fusão automática indisponível: não foi possível proteger a operação contra repetição.");
      // ponytail: browser-local lock; separate computers still depend on Zendesk's merge validation.
      // ifAvailable evita fila: com o app aberto em várias abas de ticket, esperar a
      // trava de outra instância deixava esta pendurada por tempo indeterminado.
      const result = await navigator.locks.request(`wa-merge:${account}`, { ifAvailable: true }, async lock => {
        if (!lock) return { skipped: true };
        const current = await client.get(["ticket.id", "ticket.requester.id"]);
        if (current["ticket.id"] !== values.ticket.id || current["ticket.requester.id"] !== values.ticket.requester?.id)
          throw new Error("O solicitante mudou. Reabra o ticket para verificar os contatos.");
        return api.autoMergeOnOpen(values.ticket.id, { claim: async pair => {
          const latest = await client.get(["ticket.id", "ticket.requester.id"]);
          if (latest["ticket.id"] !== values.ticket.id || latest["ticket.requester.id"] !== values.ticket.requester?.id)
            throw new Error("O ticket mudou. Nenhum contato foi fundido.");
          const storageKey = `wa-merge-attempt:${account}:${pair}`;
          if (localStorage.getItem(storageKey))
            throw new Error("Já existe uma tentativa de fusão para esses perfis neste navegador. Confira o resultado na revisão manual.");
          localStorage.setItem(storageKey, new Date().toISOString());
        }});
      });
      // Outra aba já está verificando: tenta de novo no próximo carregamento.
      if (result?.skipped) autoChecked.current.delete(key);
      // Só a fusão de fato executada vira aviso: o resultado "nada a fundir" é ruído.
      else if (autoTicket.current === key && result.merged) setNotice(result.message);
    } catch (e) {
      if (autoTicket.current === key) setError(e.message || "Não foi possível verificar os duplicados. Use a aba Contatos.");
    } finally {
      autoRunning.current = false;
      setAutoBusy(false);
    }
    offerTicketMerge();
    return loaded;
  }
  async function run(action) {
    // Nunca falhar em silêncio: sem isso, um clique durante outra operação não
    // produzia nem resultado nem mensagem.
    if (operation.current) { setError("Há uma operação em andamento. Aguarde e tente novamente."); return; }
    operation.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(
        e.message || "O Zendesk recusou a operação. Verifique suas permissões.",
      );
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    let alive = true;
    const deadline = setTimeout(() => {
      if (alive) {
        setLoading(false);
        setError(
          "Abra o app dentro do Zendesk com ?zcli_apps=true. A conexão ainda não foi estabelecida.",
        );
      }
    }, 10000);
    (async () => {
      try {
        if (!client) return;
        const context = await client.context();
        if (!alive) return;
        setLocation(context.location);
        setConnected(true);
        autoMerge.current = await api.autoMergeEnabled().catch(() => false);
        if (["user_sidebar", "top_bar"].includes(context.location)) setView("messages");
        await client.invoke("resize", {
          width: context.location === "top_bar" ? "400px" : context.location === "ticket_editor" ? "500px" : "100%",
          height: context.location === "top_bar" ? "420px" : context.location === "ticket_editor" ? "320px" : "640px",
        });
        const values = await refresh(context.location);
        // O menu lateral não tem catálogo: administrador cai em Gerenciar templates.
        if (alive && context.location === "nav_bar") setView("meta");
        if (alive) setError("");
      } catch (e) {
        if (alive)
          setError(e.message || "Não foi possível carregar o Zendesk.");
      } finally {
        clearTimeout(deadline);
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      clearTimeout(deadline);
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    const changed = () => {
      refresh().catch((e) => setError(e.message || "Falha ao atualizar."));
    };
    const events = ["top_bar", "nav_bar"].includes(location) ? ["pane.activated"] : location === "user_sidebar" ? ["app.activated", "user.name.changed", "user.email.changed"] : [
      "ticket.requester.id.changed",
      "ticket.assignee.group.id.changed",
      "ticket.conversation.changed",
      "app.activated",
    ];
    if (connected) events.forEach((event) => client.on(event, changed));
    return () => {
      clearInterval(timer);
      if (connected) events.forEach((event) => client.off(event, changed));
    };
  }, [connected, location]);
  return (
    <ThemeProvider>
      <AppStyles />
      <main className={location === "top_bar" ? "top-bar" : location === "ticket_editor" ? "editor" : location === "nav_bar" ? "nav-page" : location === "user_sidebar" ? "customer-sidebar" : ""}>
        <Tabs selectedItem={view} onChange={id => { setView(id); setError(""); setNotice(""); }}>
        {location !== "top_bar" && <div className="app-tab-scroll"><Tabs.TabList aria-label="Áreas do aplicativo">
          {[
            ...(["user_sidebar", "ticket_sidebar"].includes(location) ? [["messages", "Enviar"], ["history", "Histórico"]] : []),
            ...(["ticket_sidebar", "ticket_editor"].includes(location) ? [["templates", "Templates"]] : []),
            ...(location === "nav_bar" ? [] : [["contacts", "Duplicados"]]),
            ...(location === "nav_bar" && data.currentUser?.role === "admin" ? [["meta", "Gerenciar templates"], ["setup", "Configurações"]] : []),
          ].map(([id, label]) => <Tabs.Tab key={id} item={id}>{label}</Tabs.Tab>)}
        </Tabs.TabList></div>}
        <Tabs.TabPanel item={view} className="app-panel">
        {error && <Notice danger>{error}</Notice>}
        {notice && <Notice>{notice}</Notice>}
        {ticketMerge?.target && location === "ticket_sidebar" && <Notice>
          <p>Há um registro de envio separado desta conversa.</p>
          <Button size="small" disabled={busy} onClick={() => run(async () => {
            const merged = await api.mergeRecordTickets(data.ticket.requester.id, { auto: true, preferSource: data.ticket.id });
            setTicketMerge(null);
            setNotice(merged.merged ? `Tickets unidos no #${merged.ticketId}.` : "Não havia tickets para unir.");
          })}>Unir ao ticket #{ticketMerge.target.id}</Button>
        </Notice>}
        {location === "nav_bar" && data.currentUser && data.currentUser.role !== "admin" &&
          <Notice>Esta página é para administradores. Use o app no ticket ou no perfil do contato.</Notice>}
        {loading ? (
          <p role="status">Conectando ao Zendesk…</p>
        ) : (
          <>
            {view === "meta" && location === "nav_bar" && data.currentUser?.role === "admin" && <MetaTemplates api={api} busy={busy} run={run} groups={data.groups} />}
            {data.customer && <CustomerMessages key={"messages:" + data.customer.id} customer={data.customer} data={data} api={api} location={location} busy={busy} run={run} notice={setNotice} pane={view} onTemplates={["ticket_sidebar", "ticket_editor"].includes(location) ? () => setView("templates") : undefined} />}
            {view === "messages" && location === "top_bar" && <TopBarMessages data={data} api={api} busy={busy} run={run} notice={setNotice} />}
            {view === "templates" && (
              <>
                {data.ticket && <WindowStatus key={data.ticket.id} ticketId={data.ticket.id} messages={data.conversation} api={api} now={now} />}
                <Templates
                  data={data}
                  busy={busy || autoBusy}
                  connected={connected}
                  run={run}
                  notice={setNotice}
                  refresh={refresh}
                />
              </>
            )}
            {view === "contacts" && (
              <Contacts
                key={"contacts:" + (data.customer?.id ?? data.ticket?.requester?.id)}
                data={data}
                location={location}
                run={run}
                busy={busy || autoBusy}
                notice={setNotice}
                refresh={refresh}
              />
            )}
            {view === "setup" && (
              <section>
                <h2>Conecte seu atendimento</h2>
                <ServiceStatus api={api} />
                <LocalConnection api={api} busy={busy} run={run} />
                {(typeof LOCAL_SERVICE === "undefined" ? true : LOCAL_SERVICE) && <Disclosure title="Diagnóstico">
                  <p>{connected ? "Zendesk conectado." : "Aguardando conexão com o Zendesk."}</p>
                  <IdentityPanel requesterId={data.customer?.id ?? data.ticket?.requester?.id} api={api} busy={busy} run={run} notice={setNotice} />
                </Disclosure>}
              </section>
            )}
          </>
        )}

        </Tabs.TabPanel>
        </Tabs>
      </main>
    </ThemeProvider>
  );
}

function Templates({ data, busy, connected, run, notice, refresh }) {
  const [query, setQuery] = useState(""),
    [group, setGroup] = useState(""),
    [selected, setSelected] = useState(null);
  const filtered = data.templates.filter(
    (t) =>
      t.label
        .toLocaleLowerCase("pt-BR")
        .includes(query.toLocaleLowerCase("pt-BR")) &&
      (!group || !t.groupIds.length || t.groupIds.map(String).includes(group)),
  );
  return (
    <section>
      <div className="section-title">
        <h2>Seus templates</h2>
        <div className="tm-actions"><Button size="small" isBasic disabled={!connected || busy} onClick={() => run(() => refresh())}>Atualizar</Button></div>
      </div>
      <TextField
        label="Buscar template"
        value={query}
        onChange={setQuery}
        placeholder="Nome do template"
      />
      <Field className="app-field">
        <Label>Grupo</Label>
        <Select value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">Todos os grupos</option>
          {data.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      </Field>
      {!filtered.length && (
        <div className="empty">
          <h3>Nenhum template encontrado</h3>
          <p>
            {data.templates.length ? "Tente outro nome ou grupo." : "Os templates adicionados ao catálogo aparecerão aqui."}
          </p>
        </div>
      )}
      {filtered.map((t) => (
        <button className="template" key={t.id} onClick={() => setSelected(t)}>
          <strong>{t.label}</strong>
          {t.useCase && <span className="template-use-case">{t.useCase}</span>}
          <span>
            {t.groupIds.length ? "Restrito por grupo" : "Compartilhado"}
          </span>
        </button>
      ))}
      {selected && (
        <div className="card">
          <h3>{selected.label}</h3>
          {selected.useCase && <p>{selected.useCase}</p>}
          <div className="cm-preview"><p>{(() => { try { return parseTemplate(selected.text).config.fallback; } catch { return selected.text; } })()}</p></div>
          <p>
            {data.customer ? "Envie pela aba Enviar." : "Revise no editor antes de enviar."}
          </p>
          {!data.customer && <Button
            isPrimary
            isStretched
            disabled={busy || !connected || !data.ticket?.id}
            onClick={() =>
              run(async () => {
                await api.insertTemplate(selected, data.ticket.id);
                notice(
                  "Template inserido no editor. Revise o destinatário antes do envio.",
                );
              })
            }
          >
            Inserir no editor
          </Button>}
        </div>
      )}
    </section>
  );
}

function Contacts({ data, location, run, busy, notice, refresh }) {
  const [matches, setMatches] = useState(null),
    [searching, setSearching] = useState(false),
    [failedCriteria, setFailedCriteria] = useState([]),
    [review, setReview] = useState(null),
    [confirmed, setConfirmed] = useState(false),
    [lossesAccepted, setLossesAccepted] = useState(false),
    [sunshineIds, setSunshineIds] = useState(null);
  const requester = data.customer ?? data.ticket?.requester;
  const resetReview = () => { setReview(null); setConfirmed(false); setLossesAccepted(false); setSunshineIds(null); };
  async function preview(sourceId, targetId) {
    resetReview();
    setReview(await api.previewMerge(sourceId, targetId));
  }
  const reasonLabels = {phone: "Telefone", email: "E-mail", name: "Nome semelhante"};
  if (!requester?.id) return <div className="empty"><h2>Selecione um contato</h2>
    <p>Abra um ticket ou perfil para procurar duplicados.</p></div>;
  return <section className="contacts-workspace">
    {!review && <>
      <div className="duplicates-intro"><h2>Unir contatos duplicados</h2></div>
      <Button isPrimary disabled={busy} onClick={() => run(async () => {
        resetReview(); setMatches(null); setFailedCriteria([]); setSearching(true);
        try {
          const result = await api.findDuplicates(requester);
          setMatches(result.users); setFailedCriteria(result.failedCriteria);
        } finally { setSearching(false); }
      })}>{searching ? "Procurando…" : matches === null ? "Procurar duplicados" : "Procurar novamente"}</Button>
      {failedCriteria.length > 0 && <Notice>Busca parcial. Não foi possível consultar por {failedCriteria.map(c => reasonLabels[c].toLowerCase()).join(", ")}.</Notice>}
      {matches?.length === 0 && <div className="cm-empty contacts-results"><strong>Nenhum duplicado encontrado</strong></div>}
      {matches?.length > 0 && <div className="contacts-results"><p className="cm-muted">{matches.length} {matches.length === 1 ? "possível duplicado" : "possíveis duplicados"}</p>
        {matches.map(user => <article className="card duplicate-card" key={user.id}>
          <CustomerSummary customer={user} />
          {user.email && <p className="duplicate-email">{user.email}</p>}
          <p className="cm-muted">Encontrado por {user.matchReasons.map(c => reasonLabels[c].toLowerCase()).join(" e ")}</p>
          <Button size="small" disabled={busy} onClick={() => run(() => preview(user.id, requester.id))}>Revisar e fundir</Button>
        </article>)}
      </div>}
    </>}
    {review && <div className="merge-review">
      <Button size="small" isBasic disabled={busy} onClick={resetReview}>Voltar aos resultados</Button>
      <h2>Revisar fusão</h2>
      <p>Os contatos serão reunidos no perfil principal do Zendesk. Esta ação não pode ser desfeita.</p>
      <Button size="small" disabled={busy} onClick={() => run(() => preview(review.target.user.id, review.source.user.id))}>Inverter perfil principal</Button>
      {[['Contato que será incorporado', review.source], ['Perfil principal · será mantido', review.target]].map(([title, profile]) =>
        <div key={title} className="card"><h3>{title}</h3>
          <CustomerSummary customer={profile.user} />
          {profile.user.email && <p className="duplicate-email">{profile.user.email}</p>}
          <span className="cm-muted">Perfil #{profile.user.id}</span>
          <Disclosure title="Mais informações" level={4} isCompact>
            <p>Organização: {profile.user.organization_id || "Sem organização"}<br />ID externo: {profile.user.external_id || "Ausente"}</p>
            <ul>{profile.identities.map((i) => <li key={i.id}>{i.type}: <code>{i.value}</code>{i.primary ? " · principal" : ""}</li>)}</ul>
          </Disclosure>
        </div>)}
      <Disclosure title="O que será mantido" isCompact><p>Nome, idioma e fuso horário do perfil principal. A fusão afeta os contatos do Zendesk; não confirma fusão no Sunshine.</p></Disclosure>
      {review.blockers.map((reason) => <Notice danger key={reason}>{reason}</Notice>)}
      {review.losses.length > 0 && <>
        <h3>Dados da origem que não serão preservados</h3>
        {review.losses.map((loss) => <Disclosure key={loss.field} title={loss.field} level={4} isCompact>
          <p>Origem:</p><pre>{JSON.stringify(loss.source, null, 2)}</pre>
          <p>Valor mantido no destino:</p><pre>{JSON.stringify(loss.target, null, 2)}</pre>
        </Disclosure>)}
        <p>Para preservar esses valores, ajuste o perfil principal no Zendesk e abra outra revisão antes de fundir.</p>
        <Field className="app-field"><Checkbox disabled={busy} checked={lossesAccepted} onChange={(e) => setLossesAccepted(e.target.checked)}><Label>Aceito descartar os valores listados acima.</Label></Checkbox></Field>
      </>}
      <Field className="app-field"><Checkbox disabled={busy} checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}><Label>É a mesma pessoa e escolhi o perfil principal correto.</Label></Checkbox></Field>
      <Button isDanger disabled={busy || !confirmed || review.blockers.length > 0 || (review.losses.length > 0 && !lossesAccepted)} onClick={() => run(async () => {
        await api.assertContactContext(requester.id, location);
        const selected = review;
        resetReview();
        const result = await api.mergeUser(selected, lossesAccepted);
        setMatches(null);
        notice(result.verified
          ? `Contatos fundidos no Zendesk. Perfil principal #${result.survivor.user.id}.`
          : "Zendesk aceitou a fusão, mas a consulta do perfil principal falhou. Confira o resultado antes de continuar.");
        if (result.messaging?.length >= 2) setSunshineIds(result.messaging);
        if (location === "user_sidebar" && String(selected.source.user.id) === String(requester.id)) {
          await client.invoke("routeTo", "user", selected.target.user.id);
        } else await refresh();
      })}>Fundir contatos</Button>
    </div>}
    {sunshineIds?.length >= 2 && <Notice>
      <p>Há mais de um usuário Sunshine neste perfil. A fusão Support não une o Sunshine.</p>
      <Button size="small" disabled={busy} onClick={() => run(async () => {
        await api.mergeSunshineUsers(sunshineIds[0], sunshineIds[1]);
        setSunshineIds(null);
        notice("Usuários Sunshine unidos.");
      })}>Unir no Sunshine</Button>
    </Notice>}
  </section>;
}

createRoot(document.getElementById("root")).render(<App />);
