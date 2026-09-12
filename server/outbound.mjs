import { RECORD_PREFIX, parseTemplate, destinationPhone } from "../src/outbound.js";
import { safeId, macroTemplate } from "../src/domain.js";
import { readWhatsAppIdentity, notificationDestination, messagingIds } from "../src/identity.js";

// Process only an immutable, private send instruction already recorded in Support.
export async function sendRecordedTicket(ticketId, { api, sunshine, scope, claim, save, allowedAgentIds }) {
  const id = safeId(ticketId);
  const { ticket } = await api.request(`/api/v2/tickets/${id}.json`);
  if (!ticket?.tags?.includes("whatsapp_active_message") || ticket.status === "closed") throw new Error("Ticket de envio inválido ou fechado.");
  const page = await api.request(`/api/v2/tickets/${id}/comments.json?sort_order=asc`);
  const comment = page.comments?.[0];
  const text = [comment?.body, comment?.plain_body]
    .filter(t => typeof t === "string")
    .map(t => t.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'"))
    .find(t => t.startsWith(RECORD_PREFIX)) ?? comment?.plain_body ?? comment?.body;
  if (comment?.public !== false || !text?.startsWith(RECORD_PREFIX)) throw new Error("Registro de envio ausente.");
  const record = JSON.parse(text.slice(RECORD_PREFIX.length));
  if (![1, 2].includes(record.version) || (record.version === 1 && (record.consent !== true || record.approved !== true)) || String(ticket.requester_id) !== String(record.userId)) throw new Error("Registro de envio inconsistente.");
  const { audit } = await api.request(`/api/v2/tickets/${id}/audits/${safeId(comment.audit_id)}.json`);
  if (!allowedAgentIds.includes(String(audit?.author_id))) throw new Error("Agente não autorizado no serviço de envio.");
  const { user: agent } = await api.request(`/api/v2/users/${safeId(audit.author_id)}.json`);
  if (!agent || agent.suspended || !["agent", "admin"].includes(agent.role)) throw new Error("Agente inativo ou sem permissão.");
  const { macro } = await api.request(`/api/v2/macros/${safeId(record.macroId)}.json`);
  const template = macroTemplate(macro ?? {});
  if (!template) throw new Error("Template removido ou inativo.");
  if (record.templateText !== template.text) throw new Error("O template mudou desde a confirmação. Prepare um novo envio.");
  if (macro.restriction?.type === "User" && String(macro.restriction.id) !== String(agent.id)) throw new Error("Template privado de outro agente.");
  if (macro.restriction?.type === "Group") {
    const { groups, next_page, meta } = await api.request(`/api/v2/users/${safeId(agent.id)}/groups.json`);
    if (!Array.isArray(groups) || next_page || meta?.has_more) throw new Error("Não foi possível confirmar os grupos do agente.");
    const permitted = macro.restriction.ids ?? [macro.restriction.id];
    if (!groups.some(g => permitted.map(String).includes(String(g.id)))) throw new Error("O agente não pertence ao grupo do template.");
  } else if (macro.restriction && macro.restriction.type !== "User") throw new Error("Restrição de template não reconhecida.");
  const { message } = parseTemplate(template.text, record.parameters);
  const contact = await api.contact(record.userId);
  if (contact.user.role !== "end-user" || contact.user.suspended) throw new Error("Contato indisponível para envio.");
  let destination;
  if (!messagingIds(contact).length && record.phone) {
    const phone = destinationPhone(record.phone);
    if (phone !== destinationPhone(contact.user.phone)) throw new Error("O telefone do contato mudou. Prepare um novo envio.");
    if (!scope.integrationId) throw new Error("Integração WhatsApp ausente.");
    destination = { integrationId: scope.integrationId, destinationId: phone };
  } else {
    // A conflicting or pending messaging identity must never fall back to a guessed phone.
    const identity = await readWhatsAppIdentity(contact, scope, sunshine);
    destination = notificationDestination(identity, scope);
  }
  const { ticket: fresh } = await api.request(`/api/v2/tickets/${id}.json`);
  if (String(fresh.requester_id) !== String(record.userId) || fresh.status === "closed") throw new Error("O ticket mudou antes do envio.");
  await claim(id); // Durable exclusive reservation; a timeout must never trigger a blind resend.
  let result;
  try {
    const response = await sunshine(`/v1.1/apps/${scope.appId}/notifications`, "POST", {
      destination, author: { role: "appMaker" }, messageSchema: "whatsapp", message,
    });
    if (!response.notification?._id) throw new Error("Resposta sem identificador");
    result = { ticketId: id, state: "accepted", notificationId: response.notification._id };
  } catch {
    result = { ticketId: id, state: "unknown", message: "Resultado do envio não confirmado. Confira antes de qualquer nova tentativa." };
  }
  await save(id, result);
  try {
    await api.request(`/api/v2/tickets/${id}.json`, "PUT", { ticket: { comment: { public: false,
      body: result.state === "accepted" ? `WhatsApp: solicitação aceita pela API. Notificação ${result.notificationId}. Entrega e leitura ainda não confirmadas.` : result.message } } });
  } catch { result.warning = "Não foi possível registrar o resultado no ticket. O envio não será repetido."; }
  return result;
}
