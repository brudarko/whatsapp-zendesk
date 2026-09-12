// Acesso ao Sunshine Conversations pela credencial da instalação. O segredo nunca
// chega ao browser: o proxy ZAF monta Basic com {{basic_auth.token}} e substitui
// {{setting.sunshine_secret}} fora do navegador. Pedidos a *.zendesk.com/sc NÃO
// passam por esse proxy (são API Zendesk no browser), então o placeholder ia
// literal e o Sunshine respondia 401 Invalid authorization header format. O
// destino é apps.portta.com.br, que encaminha para {subdomínio}.zendesk.com/sc.
// A sessão do agente também recebe 401 em /sc/v2; a chave Conversations é obrigatória.
const HEX24 = /^[a-f0-9]{24}$/i;

// Diagnóstico por campo: "credencial ausente" sem dizer qual campo está errado
// obriga o administrador a adivinhar. O secret não aparece aqui porque configuração
// protegida não é devolvida ao app — sua ausência só se manifesta como 401 na chamada.
export function sunshineIssues(settings = {}) {
  const appId = String(settings.sunshine_app_id ?? "").trim();
  const keyId = String(settings.sunshine_key_id ?? "").trim();
  const issues = [];
  if (!appId) issues.push("App ID não preenchido.");
  else if (!HEX24.test(appId)) issues.push(`App ID com formato inesperado (${appId.length} caracteres; esperado 24 hexadecimais).`);
  if (!keyId) issues.push("Key ID não preenchido.");
  else if (!/^app_[a-f0-9]{24}$/i.test(keyId)) issues.push(`Key ID com formato inesperado (${keyId.slice(0, 4)}…, ${keyId.length} caracteres; esperado app_ e 24 hexadecimais).`);
  return issues;
}

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

export function describeZafError(error) {
  if (error == null) return "Erro desconhecido.";
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message) return error.message;
  const status = error.status ?? error.statusCode;
  const body = error.responseJSON ?? error.response ?? error.error;
  const description = body?.error?.description || body?.description || body?.error?.message
    || (typeof body?.error === "string" ? body.error : "") || body?.message;
  const parts = [status && `HTTP ${status}`, description, error.message].filter(Boolean);
  if (parts.length) {
    const text = parts.join(" · ");
    if (/invalid key\/secret pair/i.test(text))
      return `${text}. Cole de novo o Key ID e o secret da mesma chave Conversations (o secret só aparece na criação).`;
    return text;
  }
  try {
    const text = JSON.stringify(error);
    return text && text !== "{}" ? text.slice(0, 500) : "Erro do Zendesk sem mensagem.";
  } catch {
    return "Erro do Zendesk sem mensagem.";
  }
}

function unwrapSunshine(response) {
  const wrapped = response && typeof response === "object"
    && ("responseJSON" in response || ("status" in response && "responseText" in response));
  const body = wrapped ? (response.responseJSON ?? (response.responseText ? JSON.parse(response.responseText) : {})) : response;
  const keys = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : [];
  return {
    status: wrapped ? (response.status ?? 0) : 200,
    body,
    keys,
    count: Array.isArray(body?.messageTemplates) ? body.messageTemplates.length : null,
  };
}

export function sunshineRequest(client, config, subdomain) {
  if (!/^[a-z0-9-]+$/.test(subdomain ?? "")) throw new Error("Subdomínio Zendesk inválido.");
  const base = `https://apps.portta.com.br/whatsapp/sc/${subdomain}`;
  return async function request(path, method = "GET", body) {
    if (!path.startsWith("/v")) throw new Error("Caminho Sunshine inválido.");
    const url = base + path;
    try {
      const response = await client.request({
        url,
        type: method,
        dataType: "json",
        secure: true,
        httpCompleteResponse: true,
        headers: { Authorization: "Basic {{basic_auth.token}}" },
        basic_auth: { username: config.keyId, password: "{{setting.sunshine_secret}}" },
        ...(body ? { contentType: "application/json", data: JSON.stringify(body) } : {}),
      });
      const payload = unwrapSunshine(response);
      request.last = { url, method, status: payload.status, keys: payload.keys, count: payload.count };
      if (payload.status >= 400) {
        throw Object.assign(new Error(describeZafError({ status: payload.status, responseJSON: payload.body })), { probe: request.last });
      }
      return payload.body;
    } catch (error) {
      if (error?.probe) throw error;
      request.last = { url, method, status: error?.status ?? null, error: describeZafError(error) };
      throw Object.assign(error instanceof Error ? error : new Error(describeZafError(error)), { probe: request.last });
    }
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
