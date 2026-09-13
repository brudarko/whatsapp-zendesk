import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider, DEFAULT_THEME } from "@zendeskgarden/react-theming";
import { Button } from "@zendeskgarden/react-buttons";
import { Field, Label, Checkbox } from "@zendeskgarden/react-forms";
import { Tabs } from "@zendeskgarden/react-tabs";
import { SM } from "@zendeskgarden/react-typography";
import { AppStyles, Notice, Disclosure, LoadingSkeleton } from "./GardenUI.jsx";
import { SectionLabel, openBulkSend } from "./AppChrome.jsx";
import { zendesk } from "./zendesk.js";
import { CustomerMessages, CustomerSummary } from "./CustomerMessages.jsx";
import { WindowStatus } from "./WindowStatus.jsx";
import { TopBarMessages } from "./TopBarMessages.jsx";
import { ServiceStatus } from "./ServiceStatus.jsx";
import { BulkSend } from "./BulkSend.jsx";
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
function App() {
  const [data, setData] = useState(empty),
    [location, setLocation] = useState("ticket_sidebar"),
    [view, setView] = useState("messages"),
    [scheme, setScheme] = useState("light");
  const theme = useMemo(() => ({ ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, base: scheme === "dark" ? "dark" : "light" } }), [scheme]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [connected, setConnected] = useState(false),
    [loading, setLoading] = useState(true),
    [now, setNow] = useState(Date.now());
  const [credentialIssues, setCredentialIssues] = useState(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [ticketMerge, setTicketMerge] = useState(null);
  const autoChecked = useRef(new Set()), autoTicket = useRef(""), autoMerge = useRef(false), autoRunning = useRef(false);
  const ticketMergeTried = useRef(new Set());
  const operation = useRef(false),
    version = useRef(0);
  async function refresh(loc = location) {
    const id = ++version.current;
    const issues = await api.sunshineSettingsIssues();
    if (!issues.length) {
      try {
        if (!await api.sunshineScope()) issues.push("Configure as credenciais do Sunshine.");
      } catch {
        issues.push("Não foi possível validar as credenciais. Confira App ID, Key ID e Secret e recarregue o app.");
      }
    }
    if (id !== version.current) return;
    setCredentialIssues(issues);
    if (issues.length) return;
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
        if (["user_sidebar", "top_bar", "ticket_sidebar"].includes(context.location)) setView("messages");
        const schemeValue = await client.get("colorScheme").catch(() => ({}));
        if (alive) setScheme(schemeValue.colorScheme === "dark" ? "dark" : "light");
        await client.invoke("resize", {
          width: context.location === "top_bar" ? "400px" : context.location === "ticket_editor" ? "500px" : "100%",
          height: context.location === "top_bar" ? "420px" : context.location === "ticket_editor" ? "320px" : context.location === "modal" ? "100%" : "640px",
        });
        const values = await refresh(context.location);
        if (alive && context.location === "nav_bar") setView("setup");
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
    const applyScheme = value => setScheme((value?.colorScheme ?? value) === "dark" ? "dark" : "light");
    const events = ["top_bar", "nav_bar", "modal"].includes(location) ? ["pane.activated"] : location === "user_sidebar" ? ["app.activated", "user.name.changed", "user.email.changed"] : [
      "ticket.requester.id.changed",
      "ticket.assignee.group.id.changed",
      "ticket.conversation.changed",
      "app.activated",
    ];
    if (connected) {
      events.forEach((event) => client.on(event, changed));
      client.on("colorScheme.changed", applyScheme);
    }
    return () => {
      clearInterval(timer);
      if (connected) {
        events.forEach((event) => client.off(event, changed));
        client.off("colorScheme.changed", applyScheme);
      }
    };
  }, [connected, location]);
  const openBulk = () => run(() => openBulkSend(client));
  const shell = location === "top_bar" ? "top-bar" : location === "ticket_editor" ? "editor" : location === "nav_bar" ? "nav-page" : location === "user_sidebar" ? "customer-sidebar" : location === "modal" ? "modal-page" : "ticket-sidebar";
  if (credentialIssues === null || credentialIssues.length) return (
    <ThemeProvider theme={theme}>
      <AppStyles />
      <main className={`${shell} credential-page`}>
        {credentialIssues?.length ? <Notice title="Configure as credenciais do Sunshine">
          <p>Preencha App ID, Key ID e Secret nas configurações do app, em Admin Center · Apps e integrações.</p>
          <ul>{credentialIssues.map(issue => <li key={issue}>{issue}</li>)}</ul>
        </Notice> : error ? <Notice danger title="Não foi possível verificar as credenciais">{error}</Notice>
          : <LoadingSkeleton label="Verificando as credenciais do Sunshine…" />}
      </main>
    </ThemeProvider>
  );
  if (["modal", "nav_bar"].includes(location)) return (
    <ThemeProvider theme={theme}>
      <AppStyles />
      {error && <Notice danger>{error}</Notice>}
      {loading ? <LoadingSkeleton /> : <BulkSend location={location} data={data} api={api} busy={busy} run={run} notice={setNotice} onClose={location === "modal" ? () => client.invoke("destroy").catch(() => {}) : undefined} />}
    </ThemeProvider>
  );
  return (
    <ThemeProvider theme={theme}>
      <AppStyles />
      <main className={shell}>
        <Tabs selectedItem={view} onChange={id => { setView(id); setError(""); setNotice(""); }}>
        {location !== "top_bar" && <div className="app-tab-scroll"><Tabs.TabList aria-label="Áreas do aplicativo">
          {[
            ...(["user_sidebar", "ticket_sidebar"].includes(location) ? [["messages", "Enviar"], ["history", "Histórico"]] : []),
            ...(["nav_bar", "ticket_editor"].includes(location) ? [] : [["contacts", "Fundir clientes"]]),
            ...(location === "nav_bar" && data.currentUser?.role === "admin" ? [["setup", "Configurações"]] : []),
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
          <LoadingSkeleton />
        ) : (
          <>
            {!data.customer && !error && <Notice danger title="Não foi possível carregar o contato">
              <p>Atualize o ticket e verifique se existe um solicitante válido para este atendimento.</p>
            </Notice>}
            {data.customer && <CustomerMessages key={"messages:" + data.customer.id} customer={data.customer} data={data} api={api} location={location} busy={busy} run={run} notice={setNotice} pane={view}>
            {view === "messages" && data.ticket && <WindowStatus key={data.ticket.id} ticketId={data.ticket.id} messages={data.conversation} api={api} now={now} />}
            {view === "messages" && ["ticket_sidebar", "user_sidebar"].includes(location) && <div className="bulk-cta">
              <div className="bulk-cta-rule" />
              <SectionLabel>Vários contatos</SectionLabel>
              <SM>O envio de mensagens em massa será adicionado em breve.</SM>
            </div>}
            </CustomerMessages>}
            {view === "messages" && location === "top_bar" && <TopBarMessages data={data} api={api} busy={busy} run={run} notice={setNotice} />}
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
            {view === "setup" && location === "nav_bar" && data.currentUser?.role === "admin" && (
              <section>
                <ServiceStatus api={api} />
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
      <div className="duplicates-intro"><p>O Zendesk pode criar mais de um cadastro para o mesmo contato de WhatsApp. Aqui você pode encontrar duplicatas, revisar os dados e reunir os cadastros em um único cliente.</p></div>
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
