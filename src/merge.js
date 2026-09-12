import { brazilianPhoneCandidates } from "./domain.js";

export function contactPhones({ user, identities }) {
  return [...new Set([user.phone, ...identities
    .filter((i) => i.type === "phone_number").map((i) => i.value)]
    .flatMap(brazilianPhoneCandidates))];
}

export function mergeReview(source, target) {
  const blockers = [];
  for (const { user } of [source, target]) {
    if (user.role !== "end-user" || user.suspended)
      blockers.push("Só é possível fundir usuários finais ativos.");
    if (user.shared) blockers.push("Perfil de outra conta por compartilhamento não pode ser fundido.");
  }
  // ponytail: protect SSO until account authentication settings can be checked.
  if (source.user.external_id)
    blockers.push("A origem possui ID externo. Preserve esse perfil como destino ou revise o vínculo SSO fora do app.");
  const losses = [];
  for (const key of ["notes", "details"]) {
    if (source.user[key] && source.user[key] !== target.user[key])
      losses.push({ field: key, source: source.user[key], target: target.user[key] ?? "" });
  }
  const tags = (source.user.tags ?? []).filter((t) => !(target.user.tags ?? []).includes(t));
  if (tags.length) losses.push({ field: "tags", source: tags, target: target.user.tags ?? [] });
  for (const [key, value] of Object.entries(source.user.user_fields ?? {})) {
    if (value !== null && value !== "" && value !== undefined &&
        JSON.stringify(value) !== JSON.stringify(target.user.user_fields?.[key]))
      losses.push({ field: `user_fields.${key}`, source: value, target: target.user.user_fields?.[key] ?? null });
  }
  return { source, target, blockers: [...new Set(blockers)], losses };
}

export function contactFingerprint(contact) {
  // Include all user properties; ignore identity response ordering and URLs.
  const identities = contact.identities.map(({ url, ...identity }) => identity)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const stable = (v) => Array.isArray(v) ? v.map(stable) : v && typeof v === "object"
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v;
  return JSON.stringify(stable({ user: contact.user, identities }));
}

// Automatic merges require provider-verified identity; phone aliases only discover candidates.
export function automaticMergeReason(review) {
  if (review.blockers.length || review.losses.length)
    return "Há restrições ou dados que exigem revisão manual.";
  const { source, target } = review;
  const verified = (c, type) => c.identities.filter(i => i.type === type &&
    i.verified === true && typeof i.value === "string" && i.value.trim())
    .map(i => type === "phone_number" ? i.value.replace(/[^0-9]/g, "") : i.value.trim().toLowerCase()).filter(Boolean);
  const shared = (a, b) => a.some(v => b.includes(v));
  const messaging = c => c.identities.filter(i => i.type === "messaging" && i.value).map(i => i.value);
  const a = messaging(source), b = messaging(target);
  if (a.length && b.length && (a.some(v => !b.includes(v)) || b.some(v => !a.includes(v))))
    return "Os perfis têm vínculos Sunshine diferentes. Revise a reconciliação manualmente.";
  if (!shared(verified(source, "email"), verified(target, "email")) &&
      !shared(verified(source, "phone_number"), verified(target, "phone_number")) &&
      !shared(a, b))
    return "Identidade não comprovada: nome e variações do nono dígito apenas sugerem duplicidade.";
  for (const key of ["organization_id", "locale", "time_zone", "restricted_agent", "ticket_restriction", "only_private_comments", "moderator"])
    if (JSON.stringify(source.user[key] ?? null) !== JSON.stringify(target.user[key] ?? null))
      return "Organização, preferências ou permissões diferentes exigem revisão manual.";
  // Do not silently combine conflicting verified contact identities.
  for (const type of ["email", "phone_number"])
    if (verified(source, type).some(v => !verified(target, type).includes(v)))
      return "Existem identidades verificadas diferentes. Revise os perfis.";
  return "";
}

function isOpenTicket(ticket) {
  return ticket && ticket.status !== "closed" && ticket.status !== "deleted";
}

export function isRecordTicket(ticket) {
  return (ticket?.tags ?? []).includes("whatsapp_active_message");
}

export function isConversationTicket(ticket) {
  return ["whatsapp", "native_messaging"].includes(ticket?.via?.channel);
}

export function pickMergeTarget(tickets) {
  return [...tickets]
    .filter((ticket) => isOpenTicket(ticket) && isConversationTicket(ticket))
    .sort((a, b) => (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0))[0] || null;
}

export function pickMergeSources(tickets, targetId) {
  return tickets.filter((ticket) => isOpenTicket(ticket) && isRecordTicket(ticket)
    && !isConversationTicket(ticket) && String(ticket.id) !== String(targetId));
}

export function resolveTicketMerge(tickets, currentId) {
  const current = tickets.find((ticket) => String(ticket.id) === String(currentId));
  if (current && !isOpenTicket(current)) return { target: null, sources: [] };
  const target = current && isConversationTicket(current) ? current : pickMergeTarget(tickets);
  if (!target) return { target: null, sources: [] };
  return { target, sources: pickMergeSources(tickets, target.id) };
}
