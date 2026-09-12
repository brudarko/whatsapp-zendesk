import test from "node:test";
import assert from "node:assert/strict";
import { zendesk } from "../src/zendesk.js";

test("inserting template blocks a changed ticket, closed ticket and wrong channel", async () => {
  let values = {
    "ticket.id": 1,
    "ticket.status": "open",
    "ticket.editor.targetChannel": { name: "email" },
  };
  const client = {
    get: async () => values,
    request: () => {
      throw new Error("Should not fetch");
    },
    invoke: () => {
      throw new Error("Should not insert");
    },
  };
  const api = zendesk(client);
  await assert.rejects(api.insertTemplate({ id: 2 }, 99), /ticket mudou/);
  await assert.rejects(api.insertTemplate({ id: 2 }, 1), /Selecione WhatsApp/);
  values = { ...values, "ticket.status": "closed" };
  await assert.rejects(api.insertTemplate({ id: 2 }, 1), /fechado/);
});
test("catalog follows all offset pages and asks Zendesk for applicable macros", async () => {
  const calls = [];
  const macro = (id) => ({
    id,
    title: "WhatsApp::Modelo",
    active: true,
    actions: [{ field: "comment_value", value: "&((template=[[modelo]]))&" }],
  });
  const api = zendesk({
    get: async () => ({ currentUser: { role: "agent" } }),
    request: async ({ url }) => {
      calls.push(url);
      if (url.includes("groups")) return { groups: [] };
      return url.includes("page=2")
        ? { macros: [macro(2)] }
        : {
            macros: [macro(1)],
            next_page: "https://example.zendesk.com/api/v2/macros.json?page=2",
          };
    },
  });
  const result = await api.load("nav_bar");
  assert.equal(result.templates.length, 2);
  assert.ok(calls.some((c) => c.includes("only_viewable=true")));
  assert.ok(calls.every((c) => c.startsWith("/api/v2/")));
});

test("syncSendCatalog creates an active macro for approved sendable templates", async () => {
  const calls = [];
  const item = { name: "agendamento", language: "pt_BR", status: "APPROVED", components: [{ type: "BODY", text: "Olá {{1}}", example: { body_text: [["Ana"]] } }] };
  const api = zendesk({
    get: async () => ({ currentUser: { role: "admin" } }),
    request: async (options) => {
      calls.push(options);
      if (options.url?.includes("macros.json?active=")) return { macros: [] };
      if (options.type === "POST") return { macro: { id: 1 } };
      return { macros: [] };
    },
  });
  await api.syncSendCatalog([item, { ...item, name: "promo", components: [{ type: "BODY", text: "Oi" }, { type: "BUTTONS", buttons: [] }] }]);
  const create = calls.find((c) => c.type === "POST" && c.url === "/api/v2/macros.json");
  assert.ok(create);
  const body = JSON.parse(create.data);
  assert.equal(body.macro.title, "WhatsApp::agendamento");
  assert.equal(body.macro.active, true);
  assert.match(body.macro.actions[0].value, /template=\[\[agendamento\]\]/);
  assert.equal(calls.filter((c) => c.type === "POST").length, 1);
});
