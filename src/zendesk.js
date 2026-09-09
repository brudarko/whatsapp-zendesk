import { RECORD_PREFIX, parseTemplate, sendRecord, destinationPhone } from "./outbound.js";
import { macroTemplate, catalogMacro, safeId, brazilianPhoneCandidates } from "./domain.js";
import { contactPhones, mergeReview, contactFingerprint, automaticMergeReason } from "./merge.js";
import { isLocalApp, localRequest } from "./localConnection.js";
import { sunshineConfig, sunshineIssues, sunshineRequest, whatsappIntegration } from "./sunshine.js";
import { sunshineWindow } from "./sunshineWindow.js";
import { readReceipt } from "./readReceipt.js";
import { whatsappTemplates } from "./sunshineTemplates.js";


export function zendesk(client) {
  const reviews = new WeakMap();
  const request = (url, type = "GET", body) =>
    client.request({
      url,
      type,
      dataType: "json",
      autoRetry: type === "GET",
      contentType: "application/json",
      ...(body ? { data: JSON.stringify(body) } : {}),
    });
  async function pages(url, key) {
    const items = [],
      seen = new Set();
    while (url) {
      // Never follow a provider-supplied URL outside the Zendesk API.
      const parsed = new URL(url, "https://local.invalid");
      if (
        !parsed.pathname.startsWith("/api/v2/") ||
        seen.has(parsed.pathname + parsed.search)
      )
        throw new Error("Paginação inválida.");
      url = parsed.pathname + parsed.search;
      seen.add(url);
      const result = await request(url);
      if (!Array.isArray(result[key]) || (result.meta?.has_more && !result.next_page))
        throw new Error("Resposta incompleta do Zendesk. Atualize antes de continuar.");
      items.push(...result[key]);
      url = result.next_page;
    }
    return items;
  }
  async function contact(id) {
    const path = `/api/v2/users/${safeId(id)}`;
    const [{ user }, identities] = await Promise.all([
      request(`${path}.json`), pages(`${path}/identities.json`, "identities"),
    ]);
    if (!user || String(user.id) !== String(id))
      throw new Error("O Zendesk retornou um perfil diferente do solicitado.");
    return { user, identities };
  }
  const api = {
    contact,
    request,
    openTicket: id => client.invoke("routeTo", "ticket", Number(safeId(id))),
    // Fusão automática é irreversível: só roda se o administrador ligou a configuração.
    async autoMergeEnabled() {
      const { settings = {} } = await client.metadata();
      return settings.auto_merge_contacts === true;
    },
    async load(location) {
      const globals = await client.get("currentUser");
      const currentUser = globals.currentUser;
      const [groups, macros] = await Promise.all([
        pages("/api/v2/groups.json", "groups"),
        pages("/api/v2/macros.json?active=true&only_viewable=true", "macros"),
      ]);
      let customer = null;
      if (location === "user_sidebar") {
        const values = await client.get("user");
        customer = (await contact(values.user.id)).user;
      }
      let ticket = null,
        conversation = [];
      if (["ticket_sidebar", "ticket_editor"].includes(location)) {
        const values = await client.get(["ticket", "ticket.conversation"]);
        ticket = values.ticket;
        conversation = values["ticket.conversation"] ?? [];
      }
      return {
        currentUser,
        customer,
        groups,
        templates: macros.map(macroTemplate).filter(Boolean),
        ticket,
        conversation,
      };
    },
    async assertContactContext(expectedId, location) {
      // The top bar has an explicitly selected recipient, independent of the active ticket.
      if (location === "top_bar") return;
      const key = location === "user_sidebar" ? "user.id" : "ticket.requester.id";
      const current = await client.get(key);
      if (String(current[key]) !== String(expectedId)) throw new Error("O contato mudou. Atualize o app antes de continuar.");
    },
    async outboundConfig() {
      // A expressão do define fica no próprio if: é assim que o esbuild remove o
      // trecho do pacote de produção em vez de guardá-lo atrás de uma variável.
      if ((typeof LOCAL_SERVICE === "undefined" ? true : LOCAL_SERVICE) && isLocalApp()) {
        const token = sessionStorage.getItem("whatsapp-local-token");
        if (token) {
          const health = await localRequest("/health", token);
          const context = await client.context();
          if (health.subdomain !== context.account?.subdomain) throw new Error("O serviço local pertence a outra conta Zendesk.");
          return { localToken: token };
        }
      }
      const { settings = {} } = await client.metadata();
      const host = settings.outbound_service_host;
      return typeof host === "string" && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(host)
        ? { host } : null;
    },
    // Credencial da instalação: o proxy do Zendesk assina a chamada ao Sunshine e o
    // segredo não passa pelo browser. Sem as settings, cai no serviço local (dev).
    async sunshine() {
      const { settings = {} } = await client.metadata();
      const config = sunshineConfig(settings);
      if (!config) {
        const issues = sunshineIssues(settings);
        // Nenhum campo preenchido é o caso normal antes de configurar; formato errado precisa aparecer.
        if (issues.some(issue => !issue.includes("não preenchido"))) throw new Error(issues.join(" "));
        return null;
      }
      const context = await client.context();
      const request = sunshineRequest(client, config, context.account?.subdomain);
      return { config, request };
    },
    async sunshineSettingsIssues() {
      const { settings = {} } = await client.metadata();
      return sunshineIssues(settings);
    },
    async sunshineScope() {
      const access = await api.sunshine();
      if (!access) return null;
      const integrationId = await whatsappIntegration(access.request, access.config);
      return { ...access, scope: { appId: access.config.appId, integrationId, portfolioId: access.config.portfolioId } };
    },
    // Só leitura: o Sunshine não informa entrega sem webhook. Ver src/readReceipt.js.
    async readReceipt(ticketId) {
      const id = safeId(ticketId);
      const access = await api.sunshineScope();
      if (access) {
        const { ticket } = await request(`/api/v2/tickets/${id}.json`);
        if (!ticket?.tags?.includes("whatsapp_active_message")) throw new Error("Ticket sem registro de envio.");
        const page = await request(`/api/v2/tickets/${id}/comments.json?sort_order=asc`);
        const record = page.comments?.[0];
        if (record?.public !== false || !record.created_at) throw new Error("Registro de envio ausente.");
        return readReceipt(await contact(ticket.requester_id), access.scope, access.request, record.created_at);
      }
      const config = await api.outboundConfig();
      if (!config?.localToken) throw Error("Serviço local indisponível.");
      return localRequest("/read", config.localToken, {ticketId: id});
    },
    async serviceWindow(ticketId) {
      const id = safeId(ticketId);
      const access = await api.sunshineScope();
      if (access) {
        const { ticket } = await request(`/api/v2/tickets/${id}.json`);
        return sunshineWindow(await contact(ticket.requester_id), access.scope, access.request);
      }
      const config = await api.outboundConfig();
      if (!config?.localToken) throw Error("Serviço local indisponível.");
      return localRequest("/window", config.localToken, {ticketId: id});
    },
    async metaTemplates(input, action = "") {
      if(!["","capabilities","media"].includes(action))throw new Error("Operação de templates inválida.");
      const { currentUser } = await client.get("currentUser");
      if (currentUser.role !== "admin") throw new Error("Somente administradores podem gerenciar templates.");
      const access = await api.sunshineScope();
      if (access) {
        // Formatos avançados e upload de exemplo dependem de acesso direto à WABA, que
        // não passa pela credencial da instalação: por aqui, só o que o Sunshine aceita.
        if (action === "capabilities") return { advanced: false, media: false };
        if (action === "media") throw new Error("O envio de arquivos de exemplo precisa do gerenciamento avançado na Meta.");
        return whatsappTemplates(access.request, access.scope, input);
      }
      const config = await api.outboundConfig();
      if (!config?.localToken) throw new Error("Informe a credencial da Conversations API nas configurações do app para gerenciar os templates do seu canal WhatsApp.");
      return localRequest(`/templates${action ? `/${action}` : ""}`, config.localToken, input);
    },
    async metaConnection(action, input) {
      if (!["connect", "status", "select"].includes(action)) throw new Error("Ação inválida.");
      const { currentUser } = await client.get("currentUser");
      if (currentUser.role !== "admin") throw new Error("Somente administradores podem conectar a Meta.");
      const config = await api.outboundConfig();
      if (!config?.localToken) throw new Error("Conecte o serviço local em Configurar.");
      return localRequest(`/meta/${action}`, config.localToken, action === "status" ? undefined : input || {});
    },
    async sendActive(input, location) {
      const config = await api.outboundConfig();
      if (!config) throw new Error("Configure a conexão do serviço de envio antes de continuar.");
      // Validate the template before creating a new customer.
      const fresh = macroTemplate((await request(`/api/v2/macros/${safeId(input.macroId)}.json`)).macro ?? {});
      if (!fresh) throw new Error("Template removido ou desativado.");
      parseTemplate(fresh.text, input.parameters);
      let userId = input.userId;
      if (input.newCustomer) {
        if (location !== "top_bar") throw new Error("Cadastre o contato pelo menu superior.");
        const { name, phone: value } = input.newCustomer;
        const phone = destinationPhone(value);
        if (typeof name !== "string" || !name.trim() || name.trim().length > 255) throw new Error("Informe o nome do contato (até 255 caracteres).");
        if ((await api.searchCustomers(phone, "phone")).length) throw new Error("Encontramos um contato para esse número ou sua variação. Volte à busca e selecione o perfil existente.");
        try {
          const created = await request("/api/v2/users.json", "POST", { user: { name: name.trim(), phone, role: "end-user" } });
          userId = safeId(created.user?.id);
        } catch { throw new Error("Cadastro não confirmado. Pesquise o número antes de tentar novamente; nenhuma mensagem foi enviada."); }
      }
      const record = sendRecord({ ...input, userId });
      await api.assertContactContext(record.userId, location);
      const profile = await contact(record.userId);
      if (profile.user.role !== "end-user" || profile.user.suspended) throw new Error("O contato não está disponível para envio.");
      if (location === "top_bar" && profile.user.phone) {
        try { record.phone = destinationPhone(profile.user.phone); } catch { /* A linked BSUID can still resolve a contact with an unusable phone. */ }
      }
      record.templateText = fresh.text;
      await api.assertContactContext(record.userId, location);
      let created;
      try {
        created = await request("/api/v2/tickets.json", "POST", { ticket: {
          requester_id: Number(record.userId), subject: `WhatsApp ativo · ${fresh.label}`,
          tags: ["whatsapp_active_message"], comment: { public: false, body: RECORD_PREFIX + JSON.stringify(record) },
        } });
      } catch { throw new Error("Criação do ticket não confirmada. Confira o histórico antes de tentar novamente; nenhuma chamada de envio foi feita pelo app."); }
      const ticketId = safeId(created.ticket?.id);
      try {
        const result = config.localToken ? await localRequest("/send", config.localToken, { ticketId }) : await client.request({ url: `https://${config.host}/send`, type: "POST", dataType: "json",
          contentType: "application/json", data: JSON.stringify({ ticketId }), secure: true, cors: false, autoRetry: false,
          headers: { Authorization: "Bearer {{setting.outbound_service_token}}" } });
        if (!["accepted", "unknown"].includes(result?.state)) throw new Error("Resposta inesperada");
        return { ...result, ticketId };
      } catch {
        return { ticketId, state: "unknown", message: "Ticket registrado; envio não confirmado. Confira o resultado antes de reenviar." };
      }
    },
    async searchCustomers(value, criterion = "name") {
      const text = String(value ?? "").trim();
      if (text.length < 2 || text.length > 255) throw new Error("Digite de 2 a 255 caracteres para buscar.");
      const queries = criterion === "phone"
        ? [...new Set([destinationPhone(text), ...brazilianPhoneCandidates(destinationPhone(text))])].map(p => `phone:${p}`)
        : [`name:"${text.replace(/["\\]/g, "")}"`];
      const users = (await Promise.all(queries.map(q => pages(`/api/v2/users/search.json?query=${encodeURIComponent(q)}`, "users")))).flat();
      return [...new Map(users.map(u => [String(u.id), u])).values()];
    },
    async customerHistory(userId) {
      // Requested tickets follow the surviving Support user after a merge.
      const tickets = await pages(`/api/v2/users/${safeId(userId)}/tickets/requested.json`, "tickets");
      const messages = [], failures = [];
      for (const ticket of tickets) {
        try {
          const comments = await pages(`/api/v2/tickets/${safeId(ticket.id)}/comments.json`, "comments");
          for (const comment of comments) {
            const isWhatsApp = comment.via?.channel === "whatsapp";
            const isRecord = (ticket.tags ?? []).includes("whatsapp_active_message") && comment.public === false;
            if (!isWhatsApp && !isRecord) continue;
            messages.push({ ...comment, ticketId: ticket.id, subject: ticket.subject,
              record: isRecord && !isWhatsApp,
              // A ticket comment proves a record, not transport delivery or read status.
              status: "Sem confirmação de entrega/leitura" });
          }
        } catch { failures.push(ticket.id); }
      }
      const unique = [...new Map(messages.map(m => [`${m.ticketId}:${m.id}`, m])).values()];
      unique.sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
      return { messages: unique, ticketCount: tickets.length, failures };
    },
    async findDuplicates(requester) {
      const criteria = ["phone", "email", "name"];
      const results = await Promise.allSettled(criteria.map(criterion => api.duplicates(requester, criterion)));
      const users = new Map(), failedCriteria = [];
      results.forEach((result, i) => {
        if (result.status === "rejected") { failedCriteria.push(criteria[i]); return; }
        for (const user of result.value) {
          const id = String(user.id);
          if (!users.has(id)) users.set(id, { ...user, matchReasons: [] });
          users.get(id).matchReasons.push(criteria[i]);
        }
      });
      if (failedCriteria.length === criteria.length) throw new Error("Não foi possível procurar duplicados. Tente novamente.");
      return { users: [...users.values()], failedCriteria };
    },
    async duplicates(requester, criterion = "phone") {
      if (!requester?.id) return [];
      const targetContact = await contact(requester.id);
      const target = targetContact.user;
      let queries = [];
      const variants = contactPhones(targetContact);
      if (criterion === "phone") queries = variants.map((p) => `phone:${p}`);
      if (criterion === "email" && target.email)
        queries = [`email:"${target.email.replace(/["\\]/g, "")}"`];
      if (criterion === "name" && target.name)
        queries = [`name:"${target.name.replace(/["\\]/g, "")}"`];
      const results = (
        await Promise.all(
          queries.map((q) =>
            pages(
              `/api/v2/users/search.json?query=${encodeURIComponent(q)}`,
              "users",
            ),
          ),
        )
      ).flat();
      const candidates = [
        ...new Map(
          results
            .filter(
              (u) =>
                u.id !== target.id &&
                u.role === "end-user" &&
                !u.suspended,
            )
            .map((u) => [u.id, u]),
        ).values(),
      ];
      if (criterion !== "phone") return candidates;
      const matches = [];
      // Sequential identity reads avoid bursts against the account rate limit.
      for (const user of candidates) {
        const full = await contact(user.id);
        if (contactPhones(full).some((p) => variants.includes(p))) matches.push(full.user);
      }
      return matches;
    },
    async insertTemplate(template, expectedTicketId) {
      const current = await client.get([
        "ticket.id",
        "ticket.status",
        "ticket.editor.targetChannel",
      ]);
      if (
        current["ticket.id"] !== expectedTicketId ||
        current["ticket.status"] === "closed"
      )
        throw new Error("O ticket mudou ou está fechado. Atualize o app.");
      if (
        !["whatsapp", "whatapp"].includes(
          current["ticket.editor.targetChannel"]?.name,
        )
      )
        throw new Error(
          "Selecione WhatsApp no editor antes de inserir o template.",
        );
      const fresh = macroTemplate(
        (await request(`/api/v2/macros/${safeId(template.id)}.json`)).macro,
      );
      if (!fresh)
        throw new Error(
          "O template foi desativado ou alterado. Atualize o catálogo.",
        );
      if (/\{\{/.test(fresh.text))
        throw new Error(
          "Esta macro usa variáveis Zendesk. Aplique-a pelo menu nativo de macros para resolver os valores.",
        );
      await client.invoke("ticket.editor.insert", fresh.text);
    },
    // Catálogo do administrador: precisa ver também as macros inativas, que são as
    // mensagens ainda aguardando aprovação da Meta.
    async catalogEntries() {
      const { currentUser } = await client.get("currentUser");
      if (currentUser.role !== "admin")
        throw new Error("Somente administradores podem gerenciar o catálogo.");
      const [active, inactive] = await Promise.all([
        pages("/api/v2/macros.json?active=true", "macros"),
        pages("/api/v2/macros.json?active=false", "macros"),
      ]);
      return [...active, ...inactive].map(catalogMacro).filter(Boolean);
    },
    async saveCatalogEntry({ macroId, title, text, groupIds = [], description = "", active = false }) {
      const { currentUser } = await client.get("currentUser");
      if (currentUser.role !== "admin")
        throw new Error("Somente administradores podem cadastrar templates compartilhados.");
      const macro = {
        title: `WhatsApp::${title}`,
        active,
        description,
        actions: [{ field: "comment_value", value: text }],
        // null remove a restrição: sem grupo, a mensagem vale para toda a equipe.
        restriction: groupIds.length
          ? { type: "Group", ids: groupIds.map((id) => Number(safeId(id))) }
          : null,
      };
      return macroId
        ? request(`/api/v2/macros/${safeId(macroId)}.json`, "PUT", { macro })
        : request("/api/v2/macros.json", "POST", { macro });
    },
    async previewMerge(sourceId, targetId) {
      if (String(sourceId) === String(targetId))
        throw new Error("Escolha dois perfis diferentes.");
      const [source, target] = await Promise.all([contact(sourceId), contact(targetId)]);
      const review = mergeReview(source, target);
      reviews.set(review, [contactFingerprint(source), contactFingerprint(target)]);
      return review;
    },
    async mergeUser(review, acknowledgedLosses = false) {
      const expected = reviews.get(review);
      if (!expected) throw new Error("Abra uma nova revisão antes de fundir.");
      if (review.blockers.length) throw new Error(review.blockers.join(" "));
      if (review.losses.length && !acknowledgedLosses)
        throw new Error("Revise e confirme a perda dos dados listados.");
      const sourceId = review.source.user.id, targetId = review.target.user.id;
      const current = await Promise.all([contact(sourceId), contact(targetId)]);
      if (current.some((c, i) => contactFingerprint(c) !== expected[i])) {
        reviews.delete(review);
        throw new Error("Os perfis ou identidades mudaram. Abra uma nova revisão.");
      }
      if (!reviews.has(review)) throw new Error("Esta revisão já foi utilizada.");
      reviews.delete(review); // Never blindly repeat an irreversible request after a timeout.
      try {
        await request(`/api/v2/users/${safeId(sourceId)}/merge`, "PUT", {
          user: { id: Number(safeId(targetId)) },
        });
      } catch {
        throw new Error("A fusão não foi confirmada. Confira os dois perfis no Zendesk antes de tentar novamente.");
      }
      try {
        const survivor = await contact(targetId);
        const messaging = survivor.identities.filter((i) => i.type === "messaging").map((i) => i.value);
        return { survivor, messaging, verified: true };
      } catch {
        return { verified: false };
      }
    },
    async autoMergeOnOpen(ticketId, guard) {
      // Use the persisted ticket channel, not a guessed channel from its comments.
      const { ticket } = await request(`/api/v2/tickets/${safeId(ticketId)}.json`);
      if (ticket?.via?.channel !== "whatsapp" || ticket.status === "closed")
        return { message: "Fusão automática disponível em tickets WhatsApp abertos." };
      const requester = { id: ticket.requester_id };
      const candidates = [...new Map((await Promise.all([
        api.duplicates(requester, "phone"), api.duplicates(requester, "email"),
      ])).flat().map(u => [String(u.id), u])).values()];
      if (!candidates.length) return { message: "Verificação automática concluída: nenhum candidato por telefone ou e-mail. Perfis sem identificadores exigem busca manual." };
      if (candidates.length !== 1) return { message: "Vários candidatos encontrados. Confira a aba Contatos antes de fundir." };
      // Stable ordering prevents two tabs from attempting opposite merges.
      const ids = [String(requester.id), String(candidates[0].id)].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
      const review = await api.previewMerge(ids[1], ids[0]);
      const reason = automaticMergeReason(review);
      if (reason) return { message: reason };
      const { ticket: fresh } = await request(`/api/v2/tickets/${safeId(ticketId)}.json`);
      if (String(fresh.requester_id) !== String(requester.id) || fresh.status === "closed" || fresh.via?.channel !== "whatsapp")
        throw new Error("O ticket mudou durante a verificação automática.");
      if (!guard?.claim) throw new Error("Proteção contra repetição indisponível.");
      await guard.claim(ids.join(":"));
      const result = await api.mergeUser(review);
      return { merged: true, message: result.verified
        ? `Fusão automática Support concluída. Perfil principal #${ids[0]}. Atualize o ticket para conferir o solicitante. Sunshine não foi fundido pelo app.`
        : "Fusão aceita; confira o perfil principal no Zendesk. A verificação posterior falhou." };
    },
  };
  return api;
}
