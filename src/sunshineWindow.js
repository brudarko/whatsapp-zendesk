import { messagingIds } from './identity.js';
import { windowFromConversation } from './domain.js';

export async function sunshineWindow(contact, scope, request, now = Date.now()) {
  const validId = value => { if (!/^[a-f0-9]{24}$/i.test(value || '')) throw Error('Identificador Sunshine inválido.'); return value; };
  const root = `/v2/apps/${validId(scope.appId)}`;
  const users = messagingIds(contact), conversations = new Set(), inbound = [];
  let requests = 0;
  async function pages(path, key, direction, visit) {
    let cursor = '', seen = new Set();
    do {
      // ponytail: bounded scan; return unknown via caller fallback if large histories exceed this budget.
      if (++requests > 30) throw Error('Histórico Sunshine incompleto.');
      const page = await request(path + (cursor ? `${path.includes('?') ? '&' : '?'}page[${direction}]=${encodeURIComponent(cursor)}` : ''));
      if (!Array.isArray(page[key]) || typeof page.meta?.hasMore !== 'boolean') throw Error('Resposta Sunshine incompleta.');
      await visit(page[key]);
      if (!page.meta.hasMore) break;
      cursor = page.meta[direction === 'before' ? 'beforeCursor' : 'afterCursor'];
      if (typeof cursor !== 'string' || !cursor || seen.has(cursor)) throw Error('Paginação Sunshine inválida.');
      seen.add(cursor);
    } while (true);
  }
  for (const id of users) await pages(`${root}/conversations?filter[userId]=${validId(id)}`, 'conversations', 'after', items => {
    items.forEach(c => conversations.add(validId(c.id)));
  });
  for (const id of conversations) await pages(`${root}/conversations/${id}/messages`, 'messages', 'before', items => {
    for (const m of items) if (m.author?.type === 'user' && users.includes(m.author.userId) && m.source?.type === 'whatsapp' && m.source.integrationId === scope.integrationId) {
      const timestamp = m.source.originalMessageTimestamp || m.received;
      inbound.push({timestamp, conversationId: id, channel:{name:'whatsapp'}, author:{role:'end-user'}});
    }
  });
  const latest = inbound.reduce((best, item) => {
    const time = Date.parse(item.timestamp);
    if (!Number.isFinite(time)) return best;
    if (!best || time > best.time) return { time, conversationId: item.conversationId };
    return best;
  }, null);
  return {...windowFromConversation(inbound, now), source:'sunshine', conversationId: latest?.conversationId || null};
}
