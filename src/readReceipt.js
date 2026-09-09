import { messagingIds } from "./identity.js";

// O Sunshine não expõe status de entrega na mensagem: o objeto message tem id, received,
// author, content, source, metadata e nada de delivery. Entrega e falha só chegam por
// webhook (conversation:message:delivery:channel|user|failure), que exige endpoint público.
// O que dá para consultar é a leitura: cada participante da conversa traz lastRead
// ("latest message the user has read") e unreadCount. Por isso este módulo responde
// apenas "lido" ou "sem confirmação" — nunca afirma entrega.
export async function readReceipt(contact, scope, request, sentAt) {
  const validId = value => {
    if (!/^[a-f0-9]{24}$/i.test(value || "")) throw Error("Identificador Sunshine inválido.");
    return value;
  };
  const sent = Date.parse(sentAt);
  if (!Number.isFinite(sent)) throw Error("Data do envio inválida.");
  const root = `/v2/apps/${validId(scope.appId)}`;
  const users = messagingIds(contact);
  if (!users.length) return { state: "unknown", reason: "O contato não tem vínculo messaging para consultar leitura." };
  let requests = 0;
  async function pages(path, key, visit) {
    let cursor = "";
    const seen = new Set();
    do {
      if (++requests > 20) throw Error("Consulta de leitura incompleta.");
      const page = await request(path + (cursor ? `${path.includes("?") ? "&" : "?"}page[after]=${encodeURIComponent(cursor)}` : ""));
      if (!Array.isArray(page[key]) || typeof page.meta?.hasMore !== "boolean") throw Error("Resposta Sunshine incompleta.");
      visit(page[key]);
      if (!page.meta.hasMore) break;
      cursor = page.meta.afterCursor;
      if (typeof cursor !== "string" || !cursor || seen.has(cursor)) throw Error("Paginação Sunshine inválida.");
      seen.add(cursor);
    } while (true);
  }
  const conversations = new Set();
  for (const id of users)
    await pages(`${root}/conversations?filter[userId]=${validId(id)}`, "conversations", items =>
      items.forEach(c => conversations.add(validId(c.id))));
  let latest = 0;
  for (const id of conversations)
    await pages(`${root}/conversations/${id}/participants`, "participants", items => {
      for (const participant of items) {
        if (!users.includes(participant.userId)) continue;
        const read = Date.parse(participant.lastRead ?? "");
        if (Number.isFinite(read) && read > latest) latest = read;
      }
    });
  // lastRead marca a última mensagem lida: só conta como leitura deste envio se for posterior a ele.
  return latest >= sent
    ? { state: "read", at: new Date(latest).toISOString() }
    : { state: "unconfirmed" };
}
