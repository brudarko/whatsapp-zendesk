// Acesso ao Sunshine Conversations pela credencial que o administrador informa na
// instalação. O segredo nunca chega ao browser: o proxy do Zendesk monta o Basic com
// {{basic_auth.token}} (concatena username:password e codifica em base64) e substitui
// {{setting.sunshine_secret}} fora do navegador. Testado: a sessão do agente recebe
// 401 em /sc/v2, então a chave da Conversations API é obrigatória.
const HEX24 = /^[a-f0-9]{24}$/i;

export function sunshineConfig(settings = {}) {
  const appId = String(settings.sunshine_app_id ?? "").trim();
  const keyId = String(settings.sunshine_key_id ?? "").trim();
  if (!HEX24.test(appId) || !/^app_[a-f0-9]{24}$/i.test(keyId)) return null;
  const integrationId = String(settings.whatsapp_integration_id ?? "").trim();
  const portfolioId = String(settings.meta_portfolio_id ?? "").trim();
  return {
    appId,
    keyId,
    ...(HEX24.test(integrationId) ? { integrationId } : {}),
    ...(/^[1-9]\d*$/.test(portfolioId) ? { portfolioId } : {}),
  };
}

export function sunshineRequest(client, config, subdomain) {
  if (!/^[a-z0-9-]+$/.test(subdomain ?? "")) throw new Error("Subdomínio Zendesk inválido.");
  const base = `https://${subdomain}.zendesk.com/sc`;
  return async function request(path, method = "GET", body) {
    if (!path.startsWith("/v")) throw new Error("Caminho Sunshine inválido.");
    return client.request({
      url: base + path,
      type: method,
      dataType: "json",
      contentType: "application/json",
      secure: true,
      headers: { Authorization: "Basic {{basic_auth.token}}" },
      basic_auth: { username: config.keyId, password: "{{setting.sunshine_secret}}" },
      ...(body ? { data: JSON.stringify(body) } : {}),
    });
  };
}

// O número do WhatsApp não é pedido na instalação quando a conta tem só um: a
// integração é descoberta pela API. Com vários, o administrador precisa escolher
// preenchendo whatsapp_integration_id, porque o app não escreve nas próprias settings.
export async function whatsappIntegration(request, config) {
  if (config.integrationId) return config.integrationId;
  const found = [];
  let cursor = "";
  const seen = new Set();
  do {
    const path = `/v2/apps/${config.appId}/integrations${cursor ? `?page[after]=${encodeURIComponent(cursor)}` : ""}`;
    const page = await request(path);
    if (!Array.isArray(page.integrations) || typeof page.meta?.hasMore !== "boolean")
      throw new Error("Resposta de integrações incompleta.");
    for (const item of page.integrations)
      if (item.type === "whatsapp" && HEX24.test(item.id))
        found.push({ id: item.id, name: item.displayName || "WhatsApp", phone: item.phoneNumber || "" });
    cursor = page.meta.hasMore ? page.meta.afterCursor : "";
    if (page.meta.hasMore && (typeof cursor !== "string" || !cursor || seen.has(cursor)))
      throw new Error("Paginação de integrações inválida.");
    seen.add(cursor);
  } while (cursor);
  const unique = [...new Map(found.map(i => [i.id, i])).values()];
  if (!unique.length) throw new Error("Nenhum número WhatsApp encontrado nesta conta Sunshine.");
  if (unique.length > 1) {
    const list = unique.map(i => `${i.name}${i.phone ? ` (${i.phone})` : ""}: ${i.id}`).join(" · ");
    throw new Error(`Esta conta tem mais de um número WhatsApp. Preencha o ID da integração nas configurações do app. Opções — ${list}`);
  }
  return unique[0].id;
}
