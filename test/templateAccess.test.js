import test from "node:test";
import assert from "node:assert/strict";
import { zendesk } from "../src/zendesk.js";
test("catalog presentation updates only name and groups and requires admin", async () => {
  let call;
  const api = zendesk({ get: async () => ({ currentUser: { role: "admin" } }), request: async value => { call = value; return {}; } });
  await api.updateCatalogPresentation({ id: 7, label: " Aviso ", groupIds: ["2"] });
  assert.deepEqual(JSON.parse(call.data), { macro: { title: "WhatsApp::Aviso", restriction: { type: "Group", ids: [2] } } });
  const agent = zendesk({ get: async () => ({ currentUser: { role: "agent" } }) });
  await assert.rejects(agent.updateCatalogPresentation({ id: 7, label: "Aviso", groupIds: [] }), /administradores/);
});
