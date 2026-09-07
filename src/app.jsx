import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@zendeskgarden/react-theming";
import { Button } from "@zendeskgarden/react-buttons";
import { Field, Label, Input, Textarea } from "@zendeskgarden/react-forms";
import { windowFromConversation, shorthand } from "./domain.js";
import { zendesk } from "./zendesk.js";
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
    <Field>
      <Label>{label}</Label>
      <Control
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...props}
      />
    </Field>
  );
}
function Notice({ children, danger = false }) {
  return (
    <div
      className={`notice ${danger ? "danger" : ""}`}
      role={danger ? "alert" : "status"}
    >
      {children}
    </div>
  );
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
  const operation = useRef(false),
    version = useRef(0);
  const win = windowFromConversation(data.conversation, now);
  async function refresh(loc = location) {
    const id = ++version.current;
    const values = await api.load(loc);
    if (id === version.current) setData(values);
  }
  async function run(action) {
    if (operation.current) return;
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
        if (context.location === "nav_bar") setView("setup");
        await client.invoke("resize", {
          width: context.location === "ticket_editor" ? "500px" : "100%",
          height: context.location === "ticket_editor" ? "320px" : "640px",
        });
        await refresh(context.location);
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
    const events = [
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
      <main className={location === "ticket_editor" ? "editor" : ""}>
        <header>
          <span className="eyebrow">WHATSAPP PARA ZENDESK</span>
          <h1>Continue a conversa</h1>
          <span className="badge">Em desenvolvimento</span>
        </header>
        {data.ticket && (
          <div className="customer">
            <strong>{data.ticket.requester?.name || "Solicitante"}</strong>
            <span>
              Ticket #{data.ticket.id} ·{" "}
              {data.ticket.assignee?.group?.name || "Sem grupo"}
            </span>
          </div>
        )}
        <nav aria-label="Áreas do aplicativo">
          {[
            ["templates", "Templates"],
            ["contacts", "Contatos"],
            ["audio", "Áudio"],
            ["setup", "Configurar"],
          ].map(([id, label]) => (
            <Button
              key={id}
              size="small"
              isBasic={view !== id}
              isPrimary={view === id}
              aria-pressed={view === id}
              onClick={() => {
                setView(id);
                setError("");
                setNotice("");
              }}
            >
              {label}
            </Button>
          ))}
        </nav>
        {error && <Notice danger>{error}</Notice>}
        {notice && <Notice>{notice}</Notice>}
        {loading ? (
          <p role="status">Conectando ao Zendesk…</p>
        ) : (
          <>
            {view === "templates" && (
              <>
                <section className={`window ${win.state}`}>
                  <strong>
                    {win.state === "open"
                      ? `Janela aberta · ${Math.ceil(win.remaining / 60000)} min restantes`
                      : win.state === "closed"
                        ? "Janela de 24 horas encerrada"
                        : "Janela de atendimento não identificada"}
                  </strong>
                  <p>
                    {win.state === "open"
                      ? "Estimativa pelo histórico do ticket. A Meta determina a janela efetiva."
                      : "Use um template aprovado. A janela só reabre quando o cliente responder."}
                  </p>
                  {win.expiresAt && (
                    <small>
                      Encerramento estimado:{" "}
                      {new Date(win.expiresAt).toLocaleString("pt-BR")}
                    </small>
                  )}
                </section>
                <Templates
                  data={data}
                  busy={busy}
                  connected={connected}
                  run={run}
                  notice={setNotice}
                  refresh={refresh}
                />
              </>
            )}
            {view === "contacts" && (
              <Contacts
                key={data.ticket?.requester?.id}
                data={data}
                run={run}
                busy={busy}
                notice={setNotice}
                refresh={refresh}
              />
            )}
            {view === "audio" && <AudioPanel />}
            {view === "setup" && (
              <section>
                <h2>Conecte seu atendimento</h2>
                <p>
                  Use o número WhatsApp já conectado ao Zendesk. Não é
                  necessário desconectá-lo para usar este app.
                </p>
                <ol>
                  <li>
                    <strong>Conectar o WhatsApp</strong>
                    <p>
                      Admin Center → Canais → Mensagens e redes sociais →
                      Mensagens. Siga o assistente oficial de conexão.
                    </p>
                  </li>
                  <li>
                    <strong>Aprovar os templates</strong>
                    <p>
                      Crie os modelos no WhatsApp Manager. Cadastre os aprovados
                      na aba Templates e selecione os grupos.
                    </p>
                    <a
                      href="https://business.facebook.com/wa/manage/message-templates/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Abrir WhatsApp Manager ↗
                    </a>
                  </li>
                  <li>
                    <strong>Conferir no ticket</strong>
                    <p>
                      Escolha WhatsApp no editor, insira um template e revise o
                      destinatário antes do envio.
                    </p>
                  </li>
                </ol>
                <Notice>
                  {connected
                    ? "Conectado ao ZAF. Isso não confirma conexão da WABA nem entrega de mensagens."
                    : "Aguardando abertura dentro do Zendesk."}
                </Notice>
                <details>
                  <summary>Próxima etapa de integração</summary>
                  <p>
                    Primeiro contato via Notifications API, criação de templates
                    na Meta, formatos avançados, gravação e envio de áudio,
                    fusão automática de perfis e tickets. Exigem integração de
                    conversas, webhooks e validação no ambiente de testes.
                  </p>
                </details>
                <p>
                  O app será gratuito. Plano Zendesk, tarifas da Meta e eventual
                  hospedagem continuam sujeitos aos respectivos provedores.
                </p>
              </section>
            )}
          </>
        )}
        <footer>
          <span>Open source · Sem licença paga do app</span>
          <Button
            size="small"
            isBasic
            disabled={!connected || busy}
            onClick={() => run(() => refresh())}
          >
            Atualizar
          </Button>
        </footer>
      </main>
    </ThemeProvider>
  );
}

function Templates({ data, busy, connected, run, notice, refresh }) {
  const [query, setQuery] = useState(""),
    [group, setGroup] = useState(""),
    [selected, setSelected] = useState(null),
    [create, setCreate] = useState(false);
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
        {data.currentUser?.role === "admin" && (
          <Button size="small" onClick={() => setCreate(!create)}>
            {create ? "Fechar cadastro" : "Cadastrar"}
          </Button>
        )}
      </div>
      {create && (
        <TemplateForm
          groups={data.groups}
          busy={busy}
          submit={(values) =>
            run(async () => {
              await api.createTemplate(values);
              notice(
                "Macro cadastrada no Zendesk. Este cadastro não envia o template à Meta.",
              );
              setCreate(false);
              await refresh();
            })
          }
        />
      )}
      <TextField
        label="Buscar template"
        value={query}
        onChange={setQuery}
        placeholder="Nome do template"
      />
      <label className="select-label">
        Grupo
        <select value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">Todos disponíveis para mim</option>
          {data.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      {!filtered.length && (
        <div className="empty">
          <h3>Nenhum template encontrado</h3>
          <p>
            Cadastre uma macro de template aprovado com o prefixo WhatsApp::. As
            permissões de grupo são controladas pelo Zendesk.
          </p>
        </div>
      )}
      {filtered.map((t) => (
        <button className="template" key={t.id} onClick={() => setSelected(t)}>
          <strong>{t.label}</strong>
          <span>
            {t.groupIds.length ? "Restrito por grupo" : "Compartilhado"} · Macro
            Zendesk
          </span>
        </button>
      ))}
      {selected && (
        <div className="card">
          <h3>{selected.label}</h3>
          <pre>{selected.text}</pre>
          <p>
            Confira a aprovação no WhatsApp Manager. Depois de inserir, revise e
            envie pelo editor.
          </p>
          <Button
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
          </Button>
        </div>
      )}
    </section>
  );
}

function TemplateForm({ groups, busy, submit }) {
  const [title, setTitle] = useState(""),
    [name, setName] = useState(""),
    [language, setLanguage] = useState("pt_BR"),
    [fallback, setFallback] = useState(""),
    [params, setParams] = useState(""),
    [headerType, setHeaderType] = useState(""),
    [headerValue, setHeaderValue] = useState(""),
    [groupIds, setGroupIds] = useState([]),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        try {
          if (!confirmed) throw new Error("Confira a aprovação na Meta.");
          submit({
            title,
            text: shorthand({
              name,
              language,
              fallback,
              parameters: params ? params.split("\n") : [],
              headerType,
              headerValue,
            }),
            groupIds,
          });
        } catch (err) {
          setError(err.message);
        }
      }}
    >
      <h3>Cadastrar template aprovado</h3>
      <p>
        Esta etapa organiza modelos existentes. Criação e aprovação continuam no
        WhatsApp Manager.
      </p>
      {error && <Notice danger>{error}</Notice>}
      <TextField
        label="Nome para a equipe"
        value={title}
        onChange={setTitle}
        required
        maxLength={150}
      />
      <TextField
        label="Nome exato na Meta"
        value={name}
        onChange={setName}
        required
        placeholder="retomar_atendimento"
      />
      <TextField
        label="Idioma"
        value={language}
        onChange={setLanguage}
        required
      />
      <TextField
        label="Texto alternativo"
        value={fallback}
        onChange={setFallback}
        multiline
        required
      />
      <TextField
        label="Valores das variáveis, um por linha"
        value={params}
        onChange={setParams}
        multiline
      />
      <label className="select-label">
        Cabeçalho
        <select
          value={headerType}
          onChange={(e) => setHeaderType(e.target.value)}
        >
          <option value="">Sem cabeçalho</option>
          <option value="text">Texto</option>
          <option value="image">Imagem</option>
          <option value="document">Documento</option>
        </select>
      </label>
      {headerType && (
        <TextField
          label={
            headerType === "text" ? "Texto do cabeçalho" : "URL HTTPS da mídia"
          }
          value={headerValue}
          onChange={setHeaderValue}
          required
        />
      )}
      <fieldset>
        <legend>Grupos com acesso</legend>
        <p>
          Nenhum selecionado: todos os agentes com acesso às macros
          compartilhadas.
        </p>
        {groups.map((g) => (
          <label className="check" key={g.id}>
            <input
              type="checkbox"
              checked={groupIds.includes(g.id)}
              onChange={(e) =>
                setGroupIds(
                  e.target.checked
                    ? [...groupIds, g.id]
                    : groupIds.filter((id) => id !== g.id),
                )
              }
            />
            {g.name}
          </label>
        ))}
      </fieldset>
      <label className="check">
        <input
          type="checkbox"
          required
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        Conferi que este template e idioma estão aprovados na Meta.
      </label>
      <Button type="submit" isPrimary disabled={busy}>
        Salvar no catálogo Zendesk
      </Button>
    </form>
  );
}

function Contacts({ data, run, busy, notice, refresh }) {
  const [criterion, setCriterion] = useState("phone"),
    [matches, setMatches] = useState(null),
    [source, setSource] = useState(null),
    [confirmed, setConfirmed] = useState(false);
  const requester = data.ticket?.requester;
  if (!requester?.id)
    return (
      <div className="empty">
        <h2>Abra um ticket</h2>
        <p>
          A busca compara o solicitante com outros usuários finais do Zendesk.
        </p>
      </div>
    );
  return (
    <section>
      <h2>Uma pessoa, um histórico</h2>
      <p>
        Variações do nono dígito são candidatas à revisão. Telefones fixos e
        BSUID são preservados.
      </p>
      <label className="select-label">
        Buscar possíveis duplicados por
        <select
          value={criterion}
          onChange={(e) => {
            setCriterion(e.target.value);
            setMatches(null);
            setSource(null);
            setConfirmed(false);
          }}
        >
          <option value="phone">Telefone brasileiro</option>
          <option value="email">E-mail</option>
          <option value="name">Nome</option>
        </select>
      </label>
      <Button
        disabled={busy}
        onClick={() =>
          run(async () => {
            setSource(null);
            setConfirmed(false);
            setMatches(await api.duplicates(requester, criterion));
          })
        }
      >
        Buscar contatos
      </Button>
      {matches?.length === 0 && (
        <Notice>
          Nenhum candidato encontrado. Isso não garante ausência de duplicados.
        </Notice>
      )}
      {matches?.map((user) => (
        <div className="card" key={user.id}>
          <strong>
            {user.name} · #{user.id}
          </strong>
          <p>
            {user.phone || "Sem telefone"}
            <br />
            {user.email || "Sem e-mail"}
          </p>
          <Button
            size="small"
            disabled={busy}
            onClick={() => {
              setSource(user);
              setConfirmed(false);
            }}
          >
            Revisar fusão
          </Button>
        </div>
      ))}
      {source && (
        <div className="card">
          <h3>Conferir antes de fundir</h3>
          <p>
            <strong>
              {source.name} (#{source.id})
            </strong>{" "}
            será incorporado a{" "}
            <strong>
              {requester.name} (#{requester.id})
            </strong>
            . O solicitante atual será mantido. A operação é irreversível.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Confirmei que os perfis pertencem à mesma pessoa e o destino está
            correto.
          </label>
          <Button
            isDanger
            disabled={!confirmed || busy}
            onClick={() =>
              run(async () => {
                const current = await client.get("ticket.requester.id");
                if (current["ticket.requester.id"] !== requester.id)
                  throw new Error(
                    "O solicitante mudou. Atualize antes de fundir.",
                  );
                await api.mergeUser(source.id, requester.id);
                setSource(null);
                setMatches(null);
                setConfirmed(false);
                notice("Perfis fundidos pelo Zendesk.");
                await refresh();
              })
            }
          >
            Fundir perfis
          </Button>
        </div>
      )}
    </section>
  );
}

function AudioPanel() {
  const [audio, setAudio] = useState(null),
    [error, setError] = useState("");
  useEffect(
    () => () => {
      if (audio) URL.revokeObjectURL(audio.url);
    },
    [audio],
  );
  return (
    <section>
      <h2>Áudio no atendimento</h2>
      <p>
        O Zendesk já reproduz áudios na conversa. Use o player nativo para ouvir
        o cliente.
      </p>
      <div className="card">
        <h3>Prévia de um áudio</h3>
        <p>
          Confira o arquivo antes de anexá-lo pelo editor nativo. Esta prévia
          não envia mensagens.
        </p>
        <label className="select-label">
          Arquivo de áudio
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => {
              setError("");
              const file = e.target.files?.[0];
              if (!file) return;
              if (
                !file.type.startsWith("audio/") ||
                file.size > 16 * 1024 * 1024
              ) {
                setError("Escolha um áudio de até 16 MB para prévia.");
                return;
              }
              setAudio({ url: URL.createObjectURL(file), name: file.name });
            }}
          />
        </label>
        {error && <Notice danger>{error}</Notice>}
        {audio && (
          <>
            <p>{audio.name}</p>
            <audio controls src={audio.url} aria-label="Prévia do áudio" />
          </>
        )}
      </div>
      <Notice>
        Gravação e envio integrado ainda dependem do transporte de mídia. Áudio
        não substitui um template fora da janela de 24 horas.
      </Notice>
    </section>
  );
}
createRoot(document.getElementById("root")).render(<App />);
