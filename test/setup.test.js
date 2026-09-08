import test from "node:test";
import assert from "node:assert/strict";
import { discover, selectionConfig } from "../server/setup.mjs";

const credentials = { subdomain: "example", appId: "a".repeat(24), keyId: "app_" + "b".repeat(24), secret: "test-secret" };
test("setup discovers all WhatsApp pages without returning provider secrets or following remote links", async () => {
  const urls = [];
  const integrations = await discover(credentials, async (url, options) => {
    urls.push(url);
    assert.equal(options.redirect, "error");
    return { ok: true, json: async () => ({ integrations: [{ id: "c".repeat(24), type: "whatsapp", phoneNumber: "+5511987654321", accountManagementAccessToken: "private" }, { id: "d".repeat(24), type: "web" }], meta: { hasMore: urls.length === 1, afterCursor: "cursor" }, links: { next: "https://evil.example/" } }) };
  });
  assert.equal(urls.length, 2);
  assert.ok(urls.every(u => u.startsWith("https://example.zendesk.com/sc/")));
  assert.equal(integrations.length, 1);
  assert.equal(JSON.stringify(integrations).includes("private"), false);
  const config = selectionConfig(credentials, integrations, { integrationId: "c".repeat(24), portfolioId: "1234" });
  assert.equal(config.WHATSAPP_INTEGRATION_ID, "c".repeat(24));
  assert.throws(() => selectionConfig(credentials, integrations, { integrationId: "d".repeat(24), portfolioId: "1234" }));
  assert.throws(() => selectionConfig(credentials, integrations, { integrationId: "c".repeat(24), portfolioId: "" }));
});
test("setup rejects malicious hosts, unauthorized credentials and incomplete pagination", async () => {
  await assert.rejects(discover({ ...credentials, subdomain: "example.com/" }, () => { throw Error("should not call"); }), /Confira/);
  await assert.rejects(discover(credentials, async () => ({ ok: false, status: 401 })), /Credenciais recusadas/);
  await assert.rejects(discover(credentials, async () => ({ ok: true, json: async () => ({ integrations: [], meta: { hasMore: true } }) })), /Paginação/);
});
