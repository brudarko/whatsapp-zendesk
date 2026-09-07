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
