import test from "node:test";
import assert from "node:assert/strict";
import { zendesk } from "../src/zendesk.js";
import { shorthand } from "../src/domain.js";
import { RECORD_PREFIX, parseTemplate, destinationPhone, formatPhoneInput, formatPhone, looksLikePhone } from "../src/outbound.js";

test("DDI formatting preserves Brazilian aliases and supports international search", async () => {
  assert.equal(formatPhoneInput("11987654321").value, "(11) 98765-4321");
  assert.equal(destinationPhone("(11) 8765-4321"), "+551187654321");
  assert.equal(destinationPhone("912345678", "PT"), "+351912345678");
  assert.equal(destinationPhone("(415) 555-2671", "US"), "+14155552671");
  assert.equal(formatPhoneInput("+351912345678").country, "PT");
  assert.equal(destinationPhone("00351912345678"), "+351912345678");
  assert.throws(() => destinationPhone("12", "PT"));
  assert.throws(() => destinationPhone("BR.opaque"));
  const queries = [];
  const api = zendesk({ request: async o => { queries.push(decodeURIComponent(o.url)); return { users: [] }; } });
  await api.searchCustomers("+351912345678", "phone");
  assert.equal(queries.length, 1);
  assert.ok(queries[0].endsWith("phone:+351912345678"));
});
import { sendRecordedTicket } from "../server/outbound.mjs";

const text = shorthand({ name: "retomar", language: "pt_BR", fallback: "Olá", parameters: ["Bruno"] });
const macro = { id: 7, active: true, title: "WhatsApp::Retomar", actions: [{ field: "comment_value", value: text }] };

test("user sidebar reads user context without requesting ticket properties", async () => {
  const reads = [];
  const api = zendesk({ get: async key => { reads.push(key); return key === "user" ? { user: { id: 11 } } : { currentUser: { id: 1 } }; },
    request: async ({ url }) => url.includes("identities") ? { identities: [] } : url.includes("users/11") ? { user: { id: 11 } }
      : url.includes("groups") ? { groups: [] } : { macros: [] } });
  assert.equal((await api.load("user_sidebar")).customer.id, 11);
  assert.deepEqual(reads, ["currentUser", "user"]);
});

test("history lists one send per recorded ticket and ignores merge notes", async () => {
  const record = RECORD_PREFIX + JSON.stringify({
    version: 2, userId: "11", macroId: "7", parameters: ["Ana"], templateText: text,
  });
  const api = zendesk({ request: async ({ url }) => {
    if (url.includes("requested")) return { tickets: [
      { id: 8, tags: ["whatsapp_active_message"], via: { channel: "api" } },
      { id: 4, tags: ["whatsapp_active_message"], via: { channel: "whatsapp" } },
      { id: 3, tags: ["whatsapp_active_message"] },
      { id: 1, via: { channel: "email" } },
    ], next_page: null };
    if (url.includes("/3/")) throw new Error("403");
    if (url.includes("/8/")) return { comments: [
      { id: 1, created_at: "2026-09-11T23:19:00Z", public: false, body: record },
      { id: 2, created_at: "2026-09-11T23:19:30Z", public: false, body: "Unido à conversa nativa do WhatsApp." },
    ] };
    if (url.includes("/4/")) return { comments: [
      { id: 9, created_at: "2026-09-11T23:19:00Z", public: false, body: record },
      { id: 10, created_at: "2026-09-11T23:20:00Z", via: { channel: "whatsapp" }, body: "oi" },
    ] };
    throw new Error(`unexpected ${url}`);
  } });
  const result = await api.customerHistory(11);
  assert.deepEqual(result.messages.map(m => m.ticketId), [8]);
  assert.equal(result.messages[0].preview, "Olá");
  assert.deepEqual(result.failures, [3]);
  assert.ok(result.messages[0].status.includes("Sem confirmação"));
});

function sendGet(key) {
  if (key === "currentUser") return { currentUser: { id: 42 } };
  return { "user.id": 11 };
}

function sendRequest(calls, extra = {}) {
  return async o => {
    calls.push(o);
    if (extra.handle && await extra.handle(o)) return extra.handle(o);
    if (o.url.includes("requested")) return { tickets: extra.tickets ?? [] };
    if (o.url.includes("identities")) return { identities: [] };
    if (o.url.includes("/users/")) return { user: { id: 11, role: "end-user" } };
    if (o.url.includes("macros")) return { macro };
    if (o.url === "/api/v2/tickets.json") return { ticket: { id: 3 } };
    if (o.type === "PUT" && String(o.url).includes("/tickets/")) return { ticket: { id: 3 } };
    if (o.type === "POST" && String(o.url).includes("/merge")) return {};
    return { state: "accepted" };
  };
}

test("active send records a private ticket before dispatch and disables mutation retries", async () => {
  const calls = [];
  const api = zendesk({ metadata: async () => ({ settings: { outbound_service_host: "send.example.test" } }),
    get: sendGet, request: sendRequest(calls) });
  await api.sendActive({ userId: 11, macroId: 7, parameters: ["Ana"], assignWaitMs: 0 }, "user_sidebar");
  const writes = calls.filter(c => c.type === "POST");
  assert.equal(writes[0].url, "/api/v2/tickets.json");
  assert.equal(JSON.parse(writes[0].data).ticket.comment.public, false);
  assert.equal(JSON.parse(writes[0].data).ticket.assignee_id, 42);
  const instruction = JSON.parse(JSON.parse(writes[0].data).ticket.comment.body.slice(RECORD_PREFIX.length));
  assert.equal(instruction.version, 2);
  assert.equal("consent" in instruction, false);
  assert.equal("approved" in instruction, false);
  assert.equal(writes[1].url, "https://send.example.test/send");
  assert.ok(writes.every(c => c.autoRetry === false));
  const assign = calls.find(c => c.type === "PUT" && String(c.url).includes("/tickets/3.json"));
  assert.equal(JSON.parse(assign.data).ticket.assignee_id, 42);
});

test("production send posts the recorded ticket to Portta with Sunshine Basic", async () => {
  const appId = "a".repeat(24), keyId = `app_${"b".repeat(24)}`, integrationId = "c".repeat(24);
  const calls = [];
  const api = zendesk({
    metadata: async () => ({ settings: { sunshine_app_id: appId, sunshine_key_id: keyId, whatsapp_integration_id: integrationId, meta_portfolio_id: "1" } }),
    context: async () => ({ account: { subdomain: "d3v-brudarko" } }),
    get: sendGet,
    request: sendRequest(calls),
  });
  await api.sendActive({ userId: 11, macroId: 7, parameters: ["Ana"], assignWaitMs: 0 }, "user_sidebar");
  const send = calls.find(c => String(c.url).includes("/whatsapp/send/"));
  assert.equal(send.url, "https://apps.portta.com.br/whatsapp/send/d3v-brudarko");
  assert.equal(send.secure, true);
  assert.equal(send.headers.Authorization, "Basic {{basic_auth.token}}");
  assert.deepEqual(send.basic_auth, { username: keyId, password: "{{setting.sunshine_secret}}" });
  assert.deepEqual(JSON.parse(send.data), { ticketId: "3", appId, integrationId, portfolioId: "1" });
  assert.equal(send.autoRetry, false);
  assert.equal(calls.some(c => c.headers?.Authorization?.includes("outbound_service_token")), false);
});

test("template parser checks variable count, unsupported syntax and placeholders", () => {
  assert.equal(parseTemplate(text, ["Ana"]).message.template.components[0].parameters[0].text, "Ana");
  assert.throws(() => parseTemplate(text, []));
  assert.throws(() => parseTemplate(text, ["{{ticket.id}}"]));
  assert.throws(() => parseTemplate(text + " arbitrary"));
});

function outboundFixture() {
  const calls = [], claims = new Set(), results = [];
  const record = { version: 1, userId: "11", macroId: "7", templateText: text, parameters: ["Ana"], consent: true, approved: true };
  const scope = { appId: "a".repeat(24), integrationId: "b".repeat(24), portfolioId: "portfolio" };
  const api = { request: async (path, method) => {
    calls.push([path, method]);
    if (path.includes("comments")) return { comments: [{ public: false, audit_id: 5, body: RECORD_PREFIX + JSON.stringify(record) }] };
    if (path.includes("audits")) return { audit: { author_id: 1 } };
    if (path.includes("users")) return { user: { id: 1, role: "agent" } };
    if (path.includes("macros")) return { macro };
    return { ticket: { requester_id: 11, tags: ["whatsapp_active_message"], status: "open" } };
  }, contact: async () => ({ user: { id: 11, role: "end-user" }, identities: [{ type: "messaging", value: "c".repeat(24) }] }) };
  return { calls, record, results, deps: { api, scope, allowedAgentIds: ["1"],
    sunshine: async (path, method, payload) => {
      calls.push([path, method, payload]);
      return method === "POST" ? { notification: { _id: "notification-1" } } : { clients: [{ type: "whatsapp", integrationId: scope.integrationId, status: "active", externalId: "BR.opaque" }], meta: { hasMore: false } };
    }, claim: async id => { if (claims.has(id)) throw new Error("already attempted"); claims.add(id); }, save: async (id, result) => results.push(result) } };
}

test("server confirms scoped BSUID, persists outcome, and never repeats a claimed send", async () => {
  const f = outboundFixture();
  assert.equal((await sendRecordedTicket(3, f.deps)).state, "accepted");
  const post = f.calls.find(c => c[0].includes("notifications"));
  assert.equal(post[2].destination.destinationId, "BR.opaque");
  assert.equal(f.results.length, 1);
  await assert.rejects(sendRecordedTicket(3, f.deps), /already attempted/);
  assert.equal(f.calls.filter(c => c[0].includes("notifications")).length, 1);
});

test("server blocks unauthorized agents and changed templates before sending", async () => {
  for (const variant of ["agent", "template"]) {
    const f = outboundFixture();
    if (variant === "agent") f.deps.allowedAgentIds = [];
    else f.record.templateText = "different";
    await assert.rejects(sendRecordedTicket(3, f.deps));
    assert.equal(f.calls.filter(c => c[0].includes("notifications")).length, 0);
  }
});

test("notification timeout persists an unknown outcome and prevents a second dispatch", async () => {
  const f = outboundFixture(), original = f.deps.sunshine;
  let attempts = 0;
  f.deps.sunshine = async (path, method, payload) => {
    if (method === "POST") { attempts++; throw new Error("timeout"); }
    return original(path, method, payload);
  };
  assert.equal((await sendRecordedTicket(3, f.deps)).state, "unknown");
  assert.equal(f.results[0].state, "unknown");
  await assert.rejects(sendRecordedTicket(3, f.deps), /already attempted/);
  assert.equal(attempts, 1);
});

test("top bar creates a customer only after checking aliases, then records and sends", async () => {
  for (const scenario of ["new", "duplicate", "timeout"]) {
    const writes = [], searches = [];
    const api = zendesk({ metadata: async () => ({ settings: { outbound_service_host: "send.example.test" } }),
      get: async key => {
        if (key === "currentUser") return { currentUser: { id: 42 } };
        throw new Error("Top bar must not read a ticket context");
      },
      request: async o => {
        if (o.type === "POST") writes.push(o);
        if (o.url.includes("requested")) return { tickets: [] };
        if (o.url.includes("search.json")) { searches.push(decodeURIComponent(o.url)); return { users: scenario === "duplicate" ? [{ id: 12 }] : [] }; }
        if (scenario === "timeout" && o.type === "POST") throw new Error("timeout");
        if (o.url.includes("macros")) return { macro };
        if (o.url.includes("identities")) return { identities: [] };
        if (o.url.includes("users")) return { user: { id: 11, role: "end-user", phone: "+5511987654321" } };
        if (o.url === "/api/v2/tickets.json") return { ticket: { id: 3 } };
        return { state: "accepted" };
      } });
    const send = () => api.sendActive({ newCustomer: { name: "Ana", phone: "(11) 98765-4321" }, macroId: 7, parameters: ["Ana"], consent: true, approved: true, assignWaitMs: 0 }, "top_bar");
    if (scenario === "duplicate") { await assert.rejects(send(), /Encontramos um contato/); assert.equal(writes.length, 0); }
    else if (scenario === "timeout") { await assert.rejects(send(), /Cadastro não confirmado/); assert.deepEqual(writes.map(w => w.url), ["/api/v2/users.json"]); }
    else {
      await send();
      assert.deepEqual(writes.map(w => w.url), ["/api/v2/users.json", "/api/v2/tickets.json", "https://send.example.test/send"]);
      assert.equal(JSON.parse(writes[0].data).user.phone, "+5511987654321");
      const record = JSON.parse(JSON.parse(writes[1].data).ticket.comment.body.slice(RECORD_PREFIX.length));
      assert.equal(record.phone, "+5511987654321");
      assert.ok(writes.every(w => w.autoRetry === false));
    }
    assert.ok(searches.some(s => s.endsWith("phone:+551187654321")));
  }
  assert.equal(destinationPhone("(55) 98765-4321"), "+5555987654321");
  assert.throws(() => destinationPhone("BR.opaque"));
});

test("first contact uses the recorded exact phone; changed phones and linked conflicts block", async () => {
  for (const variant of ["new", "changed", "linked"]) {
    const f = outboundFixture();
    f.record.phone = "+5511987654321";
    f.deps.api.contact = async () => ({ user: { id: 11, role: "end-user", phone: variant === "changed" ? "+5511987654322" : f.record.phone },
      identities: variant === "linked" ? [{ type: "messaging", value: "c".repeat(24) }] : [] });
    if (variant === "linked") f.deps.sunshine = async () => ({ clients: [], meta: { hasMore: false } });
    if (variant === "new") {
      assert.equal((await sendRecordedTicket(3, f.deps)).state, "accepted");
      assert.equal(f.calls.find(c => c[0].includes("notifications"))[2].destination.destinationId, f.record.phone);
    } else {
      await assert.rejects(sendRecordedTicket(3, f.deps));
      assert.equal(f.results.length, 0);
    }
  }
});

test("recipient display groups Brazilian numbers without inventing digits", () => {
  // Número legado de 8 dígitos: o libphonenumber o considera inválido e não agrupa.
  assert.equal(formatPhone("554999465530"), "+55 (49) 9946-5530");
  assert.equal(formatPhone("+5511987654321"), "+55 (11) 98765-4321");
  assert.equal(formatPhone("11987654321"), "+55 (11) 98765-4321");
  assert.equal(formatPhone("+14155552671"), "+1 415 555 2671");
  // Sem número reconhecível nada é inventado nem escondido.
  assert.equal(formatPhone("contato sem numero"), "contato sem numero");
  assert.equal(formatPhone(null), "");
  // A busca única decide o critério pelo que foi digitado.
  for (const value of ["+55 49", "(11) 98765-4321", "4999465530"]) assert.equal(looksLikePhone(value), true);
  for (const value of ["Bruno", "Bruno 2", "", "1"]) assert.equal(looksLikePhone(value), false);
});

const openConversation = { id: 4, status: "open", via: { channel: "whatsapp" }, updated_at: "2026-09-11T20:00:00Z" };

test("findSendConflict sends without a conversation and treats a failed window as stale", async () => {
  const api = zendesk({
    metadata: async () => ({ settings: {} }),
    request: async ({ url }) => url.includes("requested")
      ? { tickets: url.includes("11") ? [] : [openConversation] }
      : { ticket: { id: 4, requester_id: 12 } },
  });
  assert.equal((await api.findSendConflict(11)).action, "send");
  const stale = await api.findSendConflict(12);
  assert.equal(stale.action, "stale");
  assert.equal(stale.ticket.id, 4);
});

test("assignToCurrentUser puts the signed-in agent on the ticket", async () => {
  const calls = [];
  const api = zendesk({ get: sendGet, request: async o => { calls.push(o); return {}; } });
  const result = await api.assignToCurrentUser(4);
  assert.equal(result.assigneeId, 42);
  assert.equal(calls[0].type, "PUT");
  assert.equal(calls[0].url, "/api/v2/tickets/4.json");
  assert.deepEqual(JSON.parse(calls[0].data).ticket, { assignee_id: 42, status: "open" });
});

test("closeConversationTicket falls back to solved when closed is rejected", async () => {
  const statuses = [];
  const api = zendesk({ request: async o => {
    const status = JSON.parse(o.data).ticket.status;
    statuses.push(status);
    if (status === "closed") throw new Error("422");
    return {};
  } });
  await api.closeConversationTicket(4);
  assert.deepEqual(statuses, ["closed", "solved"]);
});

test("close_and_new closes the stale ticket before recording the send", async () => {
  const calls = [];
  const api = zendesk({
    metadata: async () => ({ settings: { outbound_service_host: "send.example.test" } }),
    get: sendGet,
    request: sendRequest(calls),
  });
  await api.sendActive({ userId: 11, macroId: 7, parameters: ["Ana"], intent: "close_and_new", closeTicketId: 4, assignWaitMs: 0 }, "user_sidebar");
  const writes = calls.filter(c => c.type === "PUT" || c.type === "POST");
  assert.equal(writes[0].url, "/api/v2/tickets/4.json");
  assert.equal(JSON.parse(writes[0].data).ticket.status, "closed");
  assert.equal(writes[1].url, "/api/v2/tickets.json");
  assert.equal(writes[2].url, "https://send.example.test/send");
});

test("merge_into_new unites the old conversation into the new record", async () => {
  const calls = [];
  const api = zendesk({
    metadata: async () => ({ settings: { outbound_service_host: "send.example.test", auto_merge_tickets: true } }),
    get: sendGet,
    request: sendRequest(calls, { tickets: [openConversation, { id: 3, status: "open", tags: ["whatsapp_active_message"], via: { channel: "api" } }] }),
  });
  const result = await api.sendActive({ userId: 11, macroId: 7, parameters: ["Ana"], intent: "merge_into_new", mergeTicketId: 4, assignWaitMs: 0 }, "user_sidebar");
  assert.equal(result.ticketId, "3");
  assert.equal(result.merge.intoNew, true);
  const merge = calls.find(c => c.type === "POST" && String(c.url).includes("/merge"));
  assert.equal(merge.url, "/api/v2/tickets/3/merge");
  assert.deepEqual(JSON.parse(merge.data).ids, [4]);
  assert.equal(calls.some(c => c.type === "POST" && String(c.url).includes("/tickets/4/merge")), false);
});

test("sendActive assigns a conversation ticket that appears after dispatch", async () => {
  const calls = [];
  let lists = 0;
  const api = zendesk({
    metadata: async () => ({ settings: { outbound_service_host: "send.example.test" } }),
    get: sendGet,
    request: async o => {
      calls.push(o);
      if (o.url.includes("requested")) {
        lists += 1;
        return { tickets: lists > 1 ? [openConversation] : [] };
      }
      if (o.url.includes("identities")) return { identities: [] };
      if (o.url.includes("/users/")) return { user: { id: 11, role: "end-user" } };
      if (o.url.includes("macros")) return { macro };
      if (o.url === "/api/v2/tickets.json") return { ticket: { id: 3 } };
      if (o.type === "PUT") return {};
      return { state: "accepted" };
    },
  });
  const result = await api.sendActive({ userId: 11, macroId: 7, parameters: ["Ana"], assignWaitMs: 0 }, "user_sidebar");
  assert.equal(result.ticketId, "4");
  assert.equal(result.assigned, true);
  const assign = calls.find(c => c.type === "PUT" && String(c.url).includes("/tickets/4.json"));
  assert.equal(JSON.parse(assign.data).ticket.assignee_id, 42);
});
