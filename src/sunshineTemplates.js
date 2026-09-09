import { metaTemplate } from "./metaTemplate.js";

export async function whatsappTemplates(sunshine, scope, input) {
  if (![scope.appId, scope.integrationId].every(id => /^[a-f0-9]{24}$/i.test(id)))
    throw new Error("Configure o canal WhatsApp antes de gerenciar templates.");
  const path = `/v1.1/apps/${scope.appId}/integrations/${scope.integrationId}/messageTemplates`;
  if (input !== undefined) {
    // Never retry a creation whose outcome is unknown.
    const payload = metaTemplate(input);
    // Sunshine v1.1 uses camelCase for this field; Meta uses phone_number.
    for(const c of payload.components)for(const b of c.buttons||[])if(b.phone_number){b.phoneNumber=b.phone_number;delete b.phone_number;}
    const result = await sunshine(path, "POST", payload);
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
