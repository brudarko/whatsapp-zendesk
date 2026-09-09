import test from "node:test";
import assert from "node:assert/strict";
import { sunshineConfig, sunshineRequest, whatsappIntegration } from "../src/sunshine.js";

const appId = "a".repeat(24), keyId = `app_${"b".repeat(24)}`;

test("install settings become a proxied Sunshine credential", async () => {
  assert.equal(sunshineConfig({}), null);
  assert.equal(sunshineConfig({ sunshine_app_id: appId, sunshine_key_id: "chave-errada" }), null);
  assert.deepEqual(sunshineConfig({ sunshine_app_id: ` ${appId} `, sunshine_key_id: keyId }), { appId, keyId });
  assert.deepEqual(sunshineConfig({ sunshine_app_id: appId, sunshine_key_id: keyId, whatsapp_integration_id: "curto", meta_portfolio_id: "0" }), { appId, keyId });
  const full = sunshineConfig({ sunshine_app_id: appId, sunshine_key_id: keyId, whatsapp_integration_id: "c".repeat(24), meta_portfolio_id: "123" });
  assert.deepEqual(full, { appId, keyId, integrationId: "c".repeat(24), portfolioId: "123" });

  // O segredo nunca é lido pelo app: vai como placeholder que o proxy substitui.
  const calls = [];
  const client = { request: async options => { calls.push(options); return { ok: true }; } };
  const request = sunshineRequest(client, full, "d3v-exemplo");
  await request(`/v2/apps/${appId}/conversations`);
  assert.equal(calls[0].url, `https://d3v-exemplo.zendesk.com/sc/v2/apps/${appId}/conversations`);
  assert.equal(calls[0].secure, true);
  assert.equal(calls[0].headers.Authorization, "Basic {{basic_auth.token}}");
  assert.deepEqual(calls[0].basic_auth, { username: keyId, password: "{{setting.sunshine_secret}}" });
  await assert.rejects(() => request("/api/v2/users/me.json"), /Caminho Sunshine inválido/);
  assert.throws(() => sunshineRequest(client, full, "sub dominio ruim"));
});

test("WhatsApp integration is discovered, and ambiguity asks the admin to choose", async () => {
  const config = { appId, keyId };
  const one = { integrations: [{ id: "e".repeat(24), type: "whatsapp", displayName: "Vendas", phoneNumber: "+5511999999999" }], meta: { hasMore: false } };
  assert.equal(await whatsappIntegration(async () => one, config), "e".repeat(24));

  // Integração já escolhida na instalação não gasta chamada.
  assert.equal(await whatsappIntegration(async () => { throw new Error("não deveria chamar"); }, { ...config, integrationId: "f".repeat(24) }), "f".repeat(24));

  const two = { integrations: [one.integrations[0], { id: "9".repeat(24), type: "whatsapp", displayName: "Suporte" }], meta: { hasMore: false } };
  await assert.rejects(() => whatsappIntegration(async () => two, config), /mais de um número WhatsApp/);
  await assert.rejects(() => whatsappIntegration(async () => ({ integrations: [{ id: "1".repeat(24), type: "web" }], meta: { hasMore: false } }), config), /Nenhum número WhatsApp/);
  await assert.rejects(() => whatsappIntegration(async () => ({ integrations: [] }), config), /incompleta/);
  await assert.rejects(() => whatsappIntegration(async () => ({ integrations: [], meta: { hasMore: true, afterCursor: "" } }), config), /Paginação/);
});
