import test from "node:test";
import assert from "node:assert/strict";
import { resolveWhatsApp, notificationDestination, readWhatsAppIdentity, whatsappIdentifier } from "../src/identity.js";
const scope = { appId: "a".repeat(24), portfolioId: "portfolio-a", integrationId: "b".repeat(24) };
const contact = { user: { id: 1, phone: null }, identities: [{ type: "messaging", value: "c".repeat(24) }] };
const client = { id: "d".repeat(24), messagingUserId: "c".repeat(24), integrationId: scope.integrationId, type: "whatsapp", status: "active", externalId: "BR.opaque_123-xyz" };

test("BSUID without phone resolves and produces the original opaque destination", () => {
  const identity = resolveWhatsApp(contact, [client], scope);
  assert.equal(identity.phone, null);
  assert.deepEqual(notificationDestination(identity, scope), { integrationId: scope.integrationId, destinationId: client.externalId });
  assert.throws(() => notificationDestination(identity, { ...scope, portfolioId: "another" }));
  assert.notEqual(identity.identityKey, resolveWhatsApp(contact, [client], { ...scope, portfolioId: "another" }).identityKey);
});
test("pending, unrelated clients, wrong integration and conflicts cannot become destinations", () => {
  for (const clients of [[], [{ ...client, status: "pending" }], [{ ...client, status: "blocked" }], [{ ...client, messagingUserId: "other" }], [{ ...client, integrationId: "other" }], [client, { ...client, externalId: "BR.other" }]]) {
    assert.throws(() => notificationDestination(resolveWhatsApp(contact, clients, scope), scope));
  }
  assert.equal(resolveWhatsApp(contact, [{ ...client, status: "blocked" }], scope).state, "blocked");
  assert.equal(resolveWhatsApp(contact, [client], { ...scope, portfolioId: "" }).state, "resolved");
  assert.deepEqual(notificationDestination(resolveWhatsApp(contact, [client], { ...scope, portfolioId: "" }), { appId: scope.appId, integrationId: scope.integrationId }),
    { integrationId: scope.integrationId, destinationId: "BR.opaque_123-xyz" });
});
test("legacy phone remains routable without inserting a ninth digit; BSUID never becomes phone", () => {
  assert.deepEqual(whatsappIdentifier("551187654321"), { type: "phone", value: "+551187654321" });
  assert.equal(whatsappIdentifier("BR.foo").type, "bsuid");
  assert.equal(whatsappIdentifier("BR.foo bar"), null);
  assert.equal(resolveWhatsApp({ ...contact, user: { id: 1, phone: "+5511987654321" } }, [client], scope).phone, null);
});
test("read all linked Sunshine users and cursor pages without trusting next URLs", async () => {
  const paths = [];
  const withTwo = { ...contact, identities: [...contact.identities, { type: "messaging", value: "e".repeat(24) }] };
  const result = await readWhatsAppIdentity(withTwo, scope, async (path) => {
    paths.push(path);
    if (path.includes("page[after]")) return { clients: [client], meta: { hasMore: false } };
    if (path.includes("e".repeat(24))) return { clients: [], meta: { hasMore: false } };
    return { clients: [], meta: { hasMore: true, afterCursor: "cursor1" }, links: { next: "https://untrusted.invalid/" } };
  });
  assert.equal(result.state, "resolved");
  assert.equal(paths.length, 3);
  assert.ok(paths.every((p) => p.startsWith(`/v2/apps/${scope.appId}/users/`)));
  await assert.rejects(readWhatsAppIdentity(contact, scope, async () => ({ clients: [], meta: { hasMore: true } })), /Cursor/);
});
