// BSUID is opaque. Never strip punctuation or apply Brazilian phone aliases to it.
export function whatsappIdentifier(value) {
  if (typeof value !== "string") return null;
  if (/^[A-Z]{2}\.[^\s]+$/.test(value)) return { type: "bsuid", value };
  if (/^\+?[1-9]\d{6,14}$/.test(value))
    return { type: "phone", value: value.startsWith("+") ? value : `+${value}` };
  return null;
}

export function messagingIds(contact) {
  return [...new Set(contact.identities.filter((i) => i.type === "messaging")
    .map((i) => i.value).filter((id) => typeof id === "string" && id))];
}

export function resolveWhatsApp(contact, clients, scope) {
  const linked = new Set(messagingIds(contact));
  const matches = clients.filter((c) => c.type === "whatsapp" &&
    linked.has(c.messagingUserId) && c.integrationId === scope.integrationId);
  const active = matches.filter((c) => c.status === "active");
  const destinations = active.map((c) => ({ client: c, identifier: whatsappIdentifier(c.externalId) }))
    .filter((c) => c.identifier);
  const base = { supportUserId: contact.user.id, messagingUserIds: [...linked],
    name: contact.user.name || "Contato", phone: contact.user.phone || null, scope: { ...scope } };
  if (!scope.appId || !scope.integrationId)
    return { ...base, state: "unconfigured", reason: "Configure a integração WhatsApp." };
  if (matches.some((c) => c.status === "blocked"))
    return { ...base, state: "blocked", reason: "O contato bloqueou esta empresa no WhatsApp." };
  if (!destinations.length) return { ...base, state: "unresolved", reason: matches.some((c) => c.status === "pending")
    ? "Identidade aguardando confirmação da Meta." : "Nenhum destinatário WhatsApp confirmado nesta integração.",
    pending: matches.some((c) => c.status === "pending") };
  const unique = new Set(destinations.map((d) => `${d.identifier.type}:${d.identifier.value}`));
  if (unique.size !== 1) return { ...base, state: "ambiguous", reason: "Há mais de um destinatário. Revise os vínculos antes de enviar." };
  const { client, identifier } = destinations[0];
  const phone = client.additionalIdentifiers?.find((i) => i.key === "phoneNumber")?.value;
  return { ...base, state: "resolved", identifier,
    phone: identifier.type === "phone" ? identifier.value : whatsappIdentifier(phone)?.type === "phone" ? whatsappIdentifier(phone).value : null,
    messagingUserId: client.messagingUserId, clientId: client.id,
    // Scope is part of identity: an identical opaque value across portfolios is not a match.
    identityKey: JSON.stringify([scope.appId, scope.portfolioId, identifier.type, identifier.value]) };
}

export function notificationDestination(identity, scope) {
  const keys = ["appId", "integrationId"];
  if (scope.portfolioId && identity.scope?.portfolioId) keys.push("portfolioId");
  if (identity.state !== "resolved" || !identity.identifier ||
      keys.some((k) => !scope[k] || scope[k] !== identity.scope[k]))
    throw new Error(identity.reason || "Destinatário não confirmado para esta integração.");
  return { integrationId: scope.integrationId, destinationId: identity.identifier.value };
}

// Request must be an authenticated server-side Sunshine transport, never a browser-held secret.
export async function readWhatsAppIdentity(contact, scope, request) {
  const segment = (id) => {
    if (typeof id !== "string" || !/^[a-f0-9]{24}$/i.test(id)) throw new Error("ID Sunshine inválido.");
    return id;
  };
  const clients = [];
  for (const userId of messagingIds(contact)) {
    const path = `/v2/apps/${segment(scope.appId)}/users/${segment(userId)}/clients`;
    let next = path;
    const seen = new Set();
    while (next) {
      if (seen.has(next)) throw new Error("Paginação Sunshine repetida.");
      seen.add(next);
      const page = await request(next);
      if (!Array.isArray(page.clients) || typeof page.meta?.hasMore !== "boolean")
        throw new Error("Resposta Sunshine incompleta.");
      clients.push(...page.clients.map((c) => ({ ...c, messagingUserId: userId })));
      next = null;
      if (page.meta?.hasMore) {
        // Rebuild the path locally; never forward credentials to a provider-supplied URL.
        const cursor = page.meta.afterCursor;
        if (typeof cursor !== "string" || !cursor) throw new Error("Cursor Sunshine ausente.");
        next = `${path}?page[after]=${encodeURIComponent(cursor)}`;
      }
    }
  }
  return resolveWhatsApp(contact, clients, scope);
}
