import test from "node:test";
import assert from "node:assert/strict";
import { readReceipt } from "../src/readReceipt.js";

const scope = { appId: "a".repeat(24), integrationId: "b".repeat(24) };
const contact = { user: { id: 7 }, identities: [{ type: "messaging", value: "c".repeat(24) }] };
const sentAt = "2026-09-08T20:00:00.000Z";

function sunshine(pages) {
  const calls = [];
  return { calls, request: async path => { calls.push(path); 
    for (const [match, body] of pages) if (path.startsWith(match)) return body;
    throw new Error(`rota inesperada: ${path}`);
  } };
}

test("read receipt reports only reading, never delivery", async () => {
  const conversations = [`/v2/apps/${scope.appId}/conversations?filter[userId]=`, { conversations: [{ id: "d".repeat(24) }], meta: { hasMore: false } }];
  // Leitura posterior ao envio confirma leitura.
  let api = sunshine([conversations, [`/v2/apps/${scope.appId}/conversations/${"d".repeat(24)}/participants`,
    { participants: [{ userId: "c".repeat(24), unreadCount: 0, lastRead: "2026-09-08T20:05:00.000Z" }], meta: { hasMore: false } }]]);
  assert.deepEqual(await readReceipt(contact, scope, api.request, sentAt), { state: "read", at: "2026-09-08T20:05:00.000Z" });

  // Leitura anterior ao envio é de outra mensagem: não confirma nada.
  api = sunshine([conversations, [`/v2/apps/${scope.appId}/conversations/${"d".repeat(24)}/participants`,
    { participants: [{ userId: "c".repeat(24), unreadCount: 1, lastRead: "2026-09-08T19:00:00.000Z" }], meta: { hasMore: false } }]]);
  assert.deepEqual(await readReceipt(contact, scope, api.request, sentAt), { state: "unconfirmed" });

  // lastRead nulo (nunca leu) e participante de outro usuário são ignorados.
  api = sunshine([conversations, [`/v2/apps/${scope.appId}/conversations/${"d".repeat(24)}/participants`,
    { participants: [{ userId: "c".repeat(24), lastRead: null }, { userId: "e".repeat(24), lastRead: "2026-09-09T10:00:00.000Z" }], meta: { hasMore: false } }]]);
  assert.deepEqual(await readReceipt(contact, scope, api.request, sentAt), { state: "unconfirmed" });

  // Sem vínculo messaging não há o que consultar, e não se inventa estado.
  const result = await readReceipt({ user: { id: 7 }, identities: [] }, scope, async () => { throw new Error("não deveria chamar"); }, sentAt);
  assert.equal(result.state, "unknown");

  // Resposta sem paginação declarada ou com cursor repetido não vira "não lido".
  for (const broken of [{ participants: [] }, { participants: [], meta: { hasMore: true, afterCursor: "" } }]) {
    const bad = sunshine([conversations, [`/v2/apps/${scope.appId}/conversations/${"d".repeat(24)}/participants`, broken]]);
    await assert.rejects(() => readReceipt(contact, scope, bad.request, sentAt));
  }
  await assert.rejects(() => readReceipt(contact, scope, async () => ({}), "data ruim"));
  await assert.rejects(() => readReceipt(contact, { appId: "curto" }, async () => ({}), sentAt));
});
