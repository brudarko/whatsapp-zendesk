import { RECORD_PREFIX, parseTemplate, sendRecord, previewSendRecord, destinationPhone, recordCommentBody, parseRecordComment } from "./outbound.js";
import { macroTemplate, catalogMacro, safeId, brazilianPhoneCandidates } from "./domain.js";
import { sendCatalogActions } from "./metaTemplate.js";
import { contactPhones, mergeReview, contactFingerprint, automaticMergeReason, resolveTicketMerge, isRecordTicket, isConversationTicket, pickMergeTarget } from "./merge.js";
import { classifySendConflict } from "./sendConflict.js";
import { sendStatusLabel, sendEventLine } from "./sendStatus.js";
import { messagingIds, readWhatsAppIdentity } from "./identity.js";
import { isLocalApp, localRequest } from "./localConnection.js";
import { sunshineConfig, sunshineIssues, sunshineRequest, whatsappIntegration, describeZafError } from "./sunshine.js";
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
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function waitForConversationTicket(userId, excludeId, { attempts = 3, delayMs = 300 } = {}) {
    for (let i = 0; i < attempts; i++) {
      try {
        const tickets = (await pages(`/api/v2/users/${safeId(userId)}/tickets/requested.json`, "tickets"))
          .filter(ticket => String(ticket.id) !== String(excludeId || ""));
        const conversation = pickMergeTarget(tickets);
        if (conversation) return safeId(conversation.id);
      } catch { /* Messaging can create the native ticket after the notification. */ }
      if (i < attempts - 1 && delayMs) await sleep(delayMs);
    }
    return null;
  }
  const api = {
    contact,
    request,
    async openTicket(id) {
      await client.invoke("routeTo", "ticket", Number(safeId(id)));
      try { await client.invoke("popover", "hide"); } catch { /* só o top_bar tem popover */ }
    },
    // Fusão automática é irreversível: só roda se o administrador ligou a configuração.
    async autoMergeEnabled() {
      const { settings = {} } = await client.metadata();
      return settings.auto_merge_contacts === true;
    },
    async autoMergeTicketsEnabled() {
      const { settings = {} } = await client.metadata();
      return settings.auto_merge_tickets === true;
    },
    async currentAgentId() {
      const { currentUser } = await client.get("currentUser");
      const id = Number(currentUser?.id);
      if (!id) throw new Error("Não foi possível identificar o atendente.");
      return id;
    },
    async findSendConflict(userId) {
      const tickets = await pages(`/api/v2/users/${safeId(userId)}/tickets/requested.json`, "tickets");
      const ticket = pickMergeTarget(tickets);
      if (!ticket) return classifySendConflict(tickets);
      let window = { state: "unknown" };
      try { window = await api.serviceWindow(ticket.id); }
      catch { window = { state: "unknown" }; }
      return { ...classifySendConflict(tickets, window), window };
    },
    async assignToCurrentUser(ticketId) {
      const id = safeId(ticketId);
      const assigneeId = await api.currentAgentId();
      await request(`/api/v2/tickets/${id}.json`, "PUT", {
        ticket: { assignee_id: assigneeId, status: "open" },
      });
      return { ticketId: id, assigneeId };
    },
    async closeConversationTicket(ticketId) {
      const id = safeId(ticketId);
      try {
        await request(`/api/v2/tickets/${id}.json`, "PUT", { ticket: { status: "closed" } });
      } catch {
        try {
          await request(`/api/v2/tickets/${id}.json`, "PUT", { ticket: { status: "solved" } });
        } catch {
          throw new Error("Não foi possível fechar o ticket atual.");
        }
      }
      return { ticketId: id };
    },
    async load(location) {
      const globals = await client.get("currentUser");
      const currentUser = globals.currentUser;
      const [groups, initialMacros] = await Promise.all([
        pages("/api/v2/groups.json", "groups"),
        pages("/api/v2/macros.json?active=true&only_viewable=true", "macros"),
      ]);
      let macros = initialMacros;
      if (currentUser.role === "admin" && ["top_bar", "user_sidebar", "nav_bar"].includes(location)) {
        try {
          const list = await api.metaTemplates();
          if (sendCatalogActions(list.data, macros.map(catalogMacro).filter(Boolean)).length) {
            await api.syncSendCatalog(list.data);
            macros = await pages("/api/v2/macros.json?active=true&only_viewable=true", "macros");
          }
        } catch { /* envio segue com as macros já carregadas */ }
      }
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
        const requesterId = ticket?.requester?.id || ticket?.requester_id;
        // Um perfil inacessível não pode apagar a tela: o histórico de envios precisa
        // abrir mesmo quando o ticket não é do canal WhatsApp ou o contato falha.
        if (!customer && requesterId) {
          try { customer = (await contact(requesterId)).user; }
          catch { customer = { id: requesterId }; }
        }
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
      if (["top_bar", "modal", "nav_bar"].includes(location)) return;
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
      if (typeof host === "string" && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(host)
          && host !== "apps.portta.com.br")
        return { host };
      if (sunshineConfig(settings) || host === "apps.portta.com.br")
        return { host: "apps.portta.com.br", portta: true };
      return null;
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
    async contactWindow(userId) {
      const access = await api.sunshineScope();
      if (!access) throw Error("Informe a credencial da Conversations API nas configurações do app.");
      return sunshineWindow(await contact(userId), access.scope, access.request);
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
        const scopeProbe = { appId: access.scope.appId, integrationId: access.scope.integrationId, keyId: access.config.keyId };
        try {
          const result = await whatsappTemplates(access.request, access.scope, input);
          if (result && typeof result === "object" && Array.isArray(result.data)) {
            result.probe = { ...(result.probe || {}), ...scopeProbe };
          }
          return result;
        } catch (error) {
          const wrapped = error instanceof Error ? error : new Error(describeZafError(error));
          wrapped.probe = { ...(error?.probe || {}), ...scopeProbe };
          throw wrapped;
        }
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
      const intent = input.intent || "send";
      if (!["send", "close_and_new", "merge_into_new"].includes(intent))
        throw new Error("Ação de envio inválida.");
      const config = await api.outboundConfig();
      if (!config) throw new Error("Configure a conexão do serviço de envio antes de continuar.");
      let portta;
      if (config.portta) {
        portta = await api.sunshineScope();
        if (!portta?.scope?.integrationId) throw new Error("Informe a credencial da Conversations API nas configurações do app.");
      }
      // Validate the template before creating a new customer.
      const fresh = macroTemplate((await request(`/api/v2/macros/${safeId(input.macroId)}.json`)).macro ?? {});
      if (!fresh) throw new Error("Template removido ou desativado.");
      parseTemplate(fresh.text, input.parameters);
      let userId = input.userId;
      if (input.newCustomer) {
        if (!["top_bar", "modal", "nav_bar"].includes(location)) throw new Error("Cadastre o contato pelo menu superior.");
        const { name, phone: value } = input.newCustomer;
        const phone = destinationPhone(value);
        if (typeof name !== "string" || !name.trim() || name.trim().length > 255) throw new Error("Informe o nome do contato (até 255 caracteres).");
        if ((await api.searchCustomers(phone, "phone")).length) throw new Error("Encontramos um contato para esse número ou sua variação. Volte à busca e selecione o perfil existente.");
        try {
          const created = await request("/api/v2/users.json", "POST", { user: { name: name.trim(), phone, role: "end-user" } });
          userId = safeId(created.user?.id);
        } catch { throw new Error("Cadastro não confirmado. Pesquise o número antes de tentar novamente; nenhuma mensagem foi enviada."); }
      }
      if (intent === "close_and_new") {
        if (!input.closeTicketId) throw new Error("Informe o ticket a fechar.");
        await api.closeConversationTicket(input.closeTicketId);
      }
      const record = sendRecord({ ...input, userId });
      await api.assertContactContext(record.userId, location);
      const profile = await contact(record.userId);
      if (profile.user.role !== "end-user" || profile.user.suspended) throw new Error("O contato não está disponível para envio.");
      const identity = await api.whatsappIdentity(record.userId).catch(() => null);
      if (identity?.state === "blocked") throw new Error(identity.reason);
      if ((["top_bar", "modal", "nav_bar"].includes(location)) && profile.user.phone) {
        try { record.phone = destinationPhone(profile.user.phone); } catch { /* A linked BSUID can still resolve a contact with an unusable phone. */ }
      }
      record.templateText = fresh.text;
      await api.assertContactContext(record.userId, location);
      let agent = null;
      try { agent = (await client.get("currentUser")).currentUser; } catch { /* Ticket is assigned after send when the agent id is available. */ }
      const assigneeId = agent && Number(agent.id) ? Number(safeId(agent.id)) : null;
      let created;
      try {
        created = await request("/api/v2/tickets.json", "POST", { ticket: {
          requester_id: Number(record.userId), subject: `WhatsApp ativo · ${fresh.label}`,
          tags: ["whatsapp_active_message"],
          ...(assigneeId ? { assignee_id: assigneeId } : {}),
          comment: { public: false, body: recordCommentBody(record, { agentName: agent?.name, templateLabel: fresh.label }) },
        } });
      } catch { throw new Error("Criação do ticket não confirmada. Confira o histórico antes de tentar novamente; nenhuma chamada de envio foi feita pelo app."); }
      const ticketId = safeId(created.ticket?.id);
      if (intent === "merge_into_new") {
        if (!input.mergeTicketId) throw new Error("Informe o ticket a unir.");
        try {
          await request(`/api/v2/tickets/${ticketId}/merge`, "POST", {
            ids: [Number(safeId(input.mergeTicketId))],
            target_comment: "Conversa WhatsApp unida a este envio ativo.",
            source_comment: "Unido ao novo ticket de envio WhatsApp.",
          });
        } catch {
          throw new Error("O Zendesk recusou a união dos tickets. Una manualmente ou feche o ticket atual e envie de novo.");
        }
      }
      try {
        const result = config.localToken ? await localRequest("/send", config.localToken, { ticketId })
          : config.portta ? await client.request({
              url: `https://apps.portta.com.br/whatsapp/send/${(await client.context()).account?.subdomain}`,
              type: "POST", dataType: "json", contentType: "application/json",
              data: JSON.stringify({
                ticketId,
                appId: portta.scope.appId,
                integrationId: portta.scope.integrationId,
                ...(portta.scope.portfolioId ? { portfolioId: portta.scope.portfolioId } : {}),
              }),
              secure: true, cors: false, autoRetry: false,
              headers: { Authorization: "Basic {{basic_auth.token}}" },
              basic_auth: { username: portta.config.keyId, password: "{{setting.sunshine_secret}}" },
            })
          : await client.request({ url: `https://${config.host}/send`, type: "POST", dataType: "json",
          contentType: "application/json", data: JSON.stringify({ ticketId }), secure: true, cors: false, autoRetry: false,
          headers: { Authorization: "Bearer {{setting.outbound_service_token}}" } });
        if (!["accepted", "unknown"].includes(result?.state)) throw new Error("Resposta inesperada");
        const sent = { ...result, ticketId };
        let surviving = ticketId;
        if (intent === "merge_into_new") {
          sent.merge = { merged: true, ticketId, intoNew: true };
        } else {
          try {
            const merge = await api.mergeRecordTickets(record.userId, {
              auto: await api.autoMergeTicketsEnabled(),
              preferSource: ticketId,
              excludeTicketId: intent === "close_and_new" ? input.closeTicketId : undefined,
            });
            if (merge.merged) surviving = merge.ticketId;
            else if (merge.target) surviving = safeId(merge.target.id);
            if (merge.merged || merge.offer) sent.merge = merge;
          } catch (error) {
            sent.warning = error.message || "Não foi possível unir os tickets.";
          }
          if (String(surviving) === String(ticketId)) {
            const found = await waitForConversationTicket(record.userId, intent === "close_and_new" ? input.closeTicketId : undefined, {
              attempts: 3,
              delayMs: Number.isFinite(input.assignWaitMs) ? input.assignWaitMs : 300,
            });
            if (found) surviving = found;
          }
        }
        try {
          await api.assignToCurrentUser(surviving);
          return { ...sent, ticketId: surviving, assigned: true };
        } catch (error) {
          return { ...sent, ticketId: surviving, warning: sent.warning || error.message || "Não foi possível atribuir o ticket." };
        }
      } catch (error) {
        const detail = describeZafError(error);
        return { ticketId, state: "unknown", message: /Ticket registrado/.test(detail) ? detail : `Ticket registrado; envio não confirmado (${detail}). Confira o resultado antes de reenviar.` };
      }
    },
    async sendStatuses(ticketIds) {
      const ids = [...new Set((ticketIds ?? []).map(id => safeId(id)))];
      if (!ids.length) return { sends: {} };
      const config = await api.outboundConfig();
      if (config?.localToken) return localRequest("/sends", config.localToken, { ticketIds: ids });
      if (!config?.portta) return { sends: {} };
      const portta = await api.sunshineScope();
      if (!portta) return { sends: {} };
      try {
        const payload = await client.request({
          url: `https://apps.portta.com.br/whatsapp/sends/${(await client.context()).account?.subdomain}?ticketIds=${ids.join(",")}`,
          type: "GET", dataType: "json", secure: true, cors: false, autoRetry: true,
          headers: { Authorization: "Basic {{basic_auth.token}}" },
          basic_auth: { username: portta.config.keyId, password: "{{setting.sunshine_secret}}" },
        });
        return { sends: payload.sends || {} };
      } catch { return { sends: {} }; }
    },
    async whatsappIdentity(userId) {
      const access = await api.sunshineScope();
      if (!access) throw new Error("Informe a credencial da Conversations API nas configurações do app.");
      return readWhatsAppIdentity(await contact(userId), access.scope, access.request);
    },
    async linkWhatsApp(userId, phone) {
      const access = await api.sunshineScope();
      if (!access) throw new Error("Informe a credencial da Conversations API nas configurações do app.");
      const profile = await contact(userId);
      const ids = messagingIds(profile);
      if (!ids.length) throw new Error("O contato ainda não tem identidade de messaging. Envie um template ou aguarde a primeira mensagem.");
      const destination = destinationPhone(phone || profile.user.phone);
      return access.request(`/v2/apps/${access.scope.appId}/users/${ids[0]}/clients`, "POST", {
        matchCriteria: { type: "whatsapp", integrationId: access.scope.integrationId, primary: destination },
        confirmation: { type: "immediate" },
        message: { type: "text", text: "Confirme este número para continuar no WhatsApp." },
      });
    },
    async mergeSunshineUsers(survivingId, discardedId) {
      const access = await api.sunshineScope();
      if (!access) throw new Error("Informe a credencial da Conversations API nas configurações do app.");
      const segment = id => {
        if (!/^[a-f0-9]{24}$/i.test(String(id || ""))) throw new Error("ID Sunshine inválido.");
        return id;
      };
      return access.request(`/v2/apps/${access.scope.appId}/users/${segment(survivingId)}/merge`, "POST", {
        userId: segment(discardedId),
      });
    },
    async sendSession({ userId, ticketId, conversationId, content, quotedMessageId }) {
      const config = await api.outboundConfig();
      if (!config?.portta) throw new Error("Configure o serviço de envio para mensagens da janela de 24h.");
      const portta = await api.sunshineScope();
      if (!portta?.scope?.integrationId) throw new Error("Informe a credencial da Conversations API nas configurações do app.");
      await api.assertContactContext(userId, ticketId ? "ticket_sidebar" : "user_sidebar");
      const identity = await api.whatsappIdentity(userId).catch(() => null);
      if (identity?.state === "blocked") throw new Error(identity.reason);
      const payload = {
        conversationId,
        ticketId,
        content,
        quotedMessageId,
        sunshineUserId: identity?.messagingUserId,
        appId: portta.scope.appId,
        integrationId: portta.scope.integrationId,
        ...(portta.scope.portfolioId ? { portfolioId: portta.scope.portfolioId } : {}),
      };
      if (content.file) {
        const uploaded = await client.request({
          url: `https://apps.portta.com.br/whatsapp/attachments/${(await client.context()).account?.subdomain}`,
          type: "POST", dataType: "json", contentType: "application/json",
          data: JSON.stringify({
            appId: portta.scope.appId,
            integrationId: portta.scope.integrationId,
            conversationId,
            filename: content.file.name,
            mediaType: content.file.type,
            content: content.file.data,
          }),
          secure: true, cors: false, autoRetry: false,
          headers: { Authorization: "Basic {{basic_auth.token}}" },
          basic_auth: { username: portta.config.keyId, password: "{{setting.sunshine_secret}}" },
        });
        payload.content = { type: content.type, mediaUrl: uploaded.mediaUrl, altText: content.file.name };
      }
      return client.request({
        url: `https://apps.portta.com.br/whatsapp/session/${(await client.context()).account?.subdomain}`,
        type: "POST", dataType: "json", contentType: "application/json",
        data: JSON.stringify(payload),
        secure: true, cors: false, autoRetry: false,
        headers: { Authorization: "Basic {{basic_auth.token}}" },
        basic_auth: { username: portta.config.keyId, password: "{{setting.sunshine_secret}}" },
      });
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
        if (!isRecordTicket(ticket) || isConversationTicket(ticket)) continue;
        try {
          const comments = await pages(`/api/v2/tickets/${safeId(ticket.id)}/comments.json`, "comments");
          const send = comments.find(comment => parseRecordComment(comment.plain_body ?? comment.body ?? ""));
          if (!send) continue;
          const record = parseRecordComment(send.plain_body ?? send.body);
          if (![1, 2].includes(record?.version)) continue;
          let templateName = "";
          try { templateName = parseTemplate(record.templateText, record.parameters).config.name; } catch {}
          if (!templateName && record.macroId) {
            try {
              const { macro } = await request(`/api/v2/macros/${safeId(record.macroId)}.json`);
              templateName = String(macro?.title || "").replace(/^WhatsApp::/, "");
            } catch { /* older/deleted macros have no recoverable display name */ }
          }
          messages.push({
            templateName,
            id: send.id, ticketId: ticket.id, created_at: send.created_at, subject: ticket.subject,
            preview: previewSendRecord(record), record: true, status: "Sem confirmação de leitura",
          });
        } catch { failures.push(ticket.id); }
      }
      messages.sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
      try {
        const { sends = {} } = await api.sendStatuses([
          ...messages.map(m => String(m.ticketId)),
          ...tickets.map(ticket => String(ticket.id)),
        ]);
        for (const message of messages) {
          const row = sends[String(message.ticketId)];
          message.status = sendStatusLabel(row);
          message.event = sendEventLine(row);
        }
        for (const [ticketId, row] of Object.entries(sends)) {
          for (const session of row.sessions || []) {
            messages.push({
              id: session.sendId || session.notificationId || ticketId,
              ticketId,
              created_at: session.createdAt || new Date().toISOString(),
              preview: session.kind === "session" ? "Mensagem da janela de 24h" : session.label,
              record: false,
              session: true,
              status: sendStatusLabel(session),
              event: sendEventLine(session),
            });
          }
        }
        messages.sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
      } catch { /* keep the unconfirmed label when receipts are unavailable */ }
      return { messages, ticketCount: tickets.length, failures };
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
    async updateCatalogPresentation({ id, label, groupIds }) {
      const { currentUser } = await client.get("currentUser");
      if (currentUser.role !== "admin") throw new Error("Somente administradores podem editar o catálogo.");
      if (typeof label !== "string" || !label.trim() || label.trim().length > 80) throw new Error("Informe um nome de até 80 caracteres.");
      const ids = groupIds.map(id => Number(safeId(id)));
      return request(`/api/v2/macros/${safeId(id)}.json`, "PUT", { macro: {
        title: `WhatsApp::${label.trim()}`,
        restriction: ids.length ? { type: "Group", ids } : null,
      } });
    },
    async syncSendCatalog(items) {
      const entries = await api.catalogEntries();
      for (const action of sendCatalogActions(items, entries)) {
        await api.saveCatalogEntry({
          macroId: action.macroId,
          title: action.title,
          text: action.text,
          groupIds: action.groupIds ?? [],
          description: action.description ?? "",
          active: true,
        });
      }
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
    async findTicketMerge(ticketId) {
      const { ticket } = await request(`/api/v2/tickets/${safeId(ticketId)}.json`);
      if (!ticket?.requester_id) return { target: null, sources: [] };
      const tickets = await pages(`/api/v2/users/${safeId(ticket.requester_id)}/tickets/requested.json`, "tickets");
      return resolveTicketMerge(tickets, ticket.id);
    },
    async mergeRecordTickets(userId, { auto = false, preferSource, excludeTicketId } = {}) {
      const tickets = (await pages(`/api/v2/users/${safeId(userId)}/tickets/requested.json`, "tickets"))
        .filter(ticket => String(ticket.id) !== String(excludeTicketId || ""));
      const plan = resolveTicketMerge(tickets, preferSource);
      if (!plan.target || !plan.sources.length) return { merged: false, ...plan };
      if (!auto) return { merged: false, offer: true, ...plan };
      try {
        await request(`/api/v2/tickets/${safeId(plan.target.id)}/merge`, "POST", {
          ids: plan.sources.map(source => Number(source.id)),
          target_comment: "Registro de envio WhatsApp unido a esta conversa.",
          source_comment: "Unido à conversa nativa do WhatsApp.",
        });
      } catch {
        throw new Error("O Zendesk recusou a união dos tickets. Una manualmente a conversa e o registro de envio.");
      }
      return { merged: true, ticketId: String(plan.target.id), target: plan.target, sources: plan.sources };
    },
    async autoMergeTicketsOnOpen(ticketId) {
      if (!(await api.autoMergeTicketsEnabled())) return { merged: false };
      const { ticket } = await request(`/api/v2/tickets/${safeId(ticketId)}.json`);
      if (!ticket?.requester_id) return { merged: false };
      return api.mergeRecordTickets(ticket.requester_id, { auto: true, preferSource: ticket.id });
    },
  };
  return api;
}
