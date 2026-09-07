import { readWhatsAppIdentity } from "../src/identity.js";

// Read-only diagnostic. Credentials stay in this process, never in the ZAF iframe.
const required = ["ZENDESK_SUBDOMAIN", "ZENDESK_OAUTH_TOKEN", "SUNSHINE_APP_ID", "SUNSHINE_KEY_ID", "SUNSHINE_SECRET", "WHATSAPP_INTEGRATION_ID", "META_PORTFOLIO_ID"];
try {
  for (const key of required) if (!process.env[key]) throw new Error(`Configure ${key} no ambiente local.`);
  const subdomain = process.env.ZENDESK_SUBDOMAIN, id = process.argv[2];
  if (!/^[a-z0-9-]+$/.test(subdomain) || !/^[1-9]\d*$/.test(id ?? "")) throw new Error("Informe subdomínio e ID de usuário Support válidos.");
  const origin = `https://${subdomain}.zendesk.com`;
  const get = async (path, authorization) => {
    const response = await fetch(origin + path, { redirect: "error", signal: AbortSignal.timeout(15000), headers: { Authorization: authorization } });
    if (!response.ok) throw new Error(`Consulta recusada: HTTP ${response.status}. Confira acesso e configuração.`);
    return response.json();
  };
  const auth = `Bearer ${process.env.ZENDESK_OAUTH_TOKEN}`;
  const { user } = await get(`/api/v2/users/${id}.json`, auth);
  if (String(user?.id) !== id) throw new Error("Perfil Support inesperado.");
  const identities = [];
  let path = `/api/v2/users/${id}/identities.json`;
  const seen = new Set();
  while (path) {
    if (seen.has(path)) throw new Error("Paginação Support repetida.");
    seen.add(path);
    const page = await get(path, auth);
    if (!Array.isArray(page.identities)) throw new Error("Identidades Support ausentes.");
    identities.push(...page.identities);
    path = null;
    if (page.next_page) {
      const next = new URL(page.next_page, origin);
      if (next.origin !== origin || next.pathname !== `/api/v2/users/${id}/identities.json`) throw new Error("Paginação Support inválida.");
      path = next.pathname + next.search;
    }
  }
  const scope = { appId: process.env.SUNSHINE_APP_ID, integrationId: process.env.WHATSAPP_INTEGRATION_ID, portfolioId: process.env.META_PORTFOLIO_ID };
  const sunshineAuth = "Basic " + Buffer.from(`${process.env.SUNSHINE_KEY_ID}:${process.env.SUNSHINE_SECRET}`).toString("base64");
  const identity = await readWhatsAppIdentity({ user, identities }, scope, (url) => get(`/sc${url}`, sunshineAuth));
  console.log(JSON.stringify(identity, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
