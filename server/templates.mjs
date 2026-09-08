import { metaTemplate } from "../src/metaTemplate.js";

export async function whatsappTemplates(sunshine, scope, input) {
  if (![scope.appId, scope.integrationId].every(id => /^[a-f0-9]{24}$/i.test(id)))
    throw new Error("Configure o canal WhatsApp antes de gerenciar templates.");
  const path = `/v1.1/apps/${scope.appId}/integrations/${scope.integrationId}/messageTemplates`;
  if (input !== undefined) {
    // Never retry a creation whose outcome is unknown.
    const result = await sunshine(path, "POST", metaTemplate(input));
    if (!result.messageTemplate?.id) throw new Error("Criação não confirmada. Confira os templates antes de tentar novamente.");
    return result.messageTemplate;
  }
  const data = [], seen = new Set();
  let cursor = "";
  do {
    const result = await sunshine(path + (cursor ? `?after=${encodeURIComponent(cursor)}` : ""));
    if (!Array.isArray(result.messageTemplates)) throw new Error("Não foi possível ler a lista de templates do WhatsApp.");
    data.push(...result.messageTemplates);
    cursor = result.after;
    if (cursor && (typeof cursor !== "string" || seen.has(cursor))) throw new Error("Paginação de templates inválida.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return { data };
}
