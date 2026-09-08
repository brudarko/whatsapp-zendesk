import { createServer } from "node:http";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import { configPath } from "./setup.mjs";

const config = JSON.parse(await readFile(configPath, "utf8"));
const subdomain = config.ZENDESK_SUBDOMAIN;
if (!/^[a-z0-9-]+$/.test(subdomain ?? "")) throw new Error("Execute setup:local primeiro.");
const clientId = process.argv[2] || "app_zendesk";
const redirect = "http://localhost:8787/oauth/callback";
const state = randomBytes(32).toString("hex"), verifier = randomBytes(48).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const base = `https://${subdomain}.zendesk.com`;
const url = new URL(`${base}/oauth/authorizations/new`);
url.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirect,
  scope: "read write", state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
let used = false;
const server = createServer(async (req, res) => {
  const reply = (code, text) => { res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }); res.end(text); };
  const incoming = new URL(req.url, redirect);
  if (req.headers.host !== "localhost:8787" || req.method !== "GET" || incoming.pathname !== "/oauth/callback") return reply(404, "Rota inexistente.");
  const actual = Buffer.from(incoming.searchParams.get("state") || ""), expected = Buffer.from(state);
  if (used || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return reply(400, "Autorização inválida ou já utilizada. Execute setup:oauth novamente.");
  used = true;
  try {
    const code = incoming.searchParams.get("code");
    if (!code || incoming.searchParams.has("error")) throw new Error("Autorização não concedida.");
    const response = await fetch(`${base}/oauth/tokens`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grant_type: "authorization_code", code,
        client_id: clientId, redirect_uri: redirect, code_verifier: verifier, scope: "read write", expires_in: 86400 }) });
    if (!response.ok) throw new Error(`Zendesk recusou a troca OAuth (HTTP ${response.status}). Confira o identificador, a URL e o suporte a PKCE do cliente.`);
    const token = await response.json();
    if (typeof token.access_token !== "string" || !token.access_token) throw new Error("Resposta OAuth incompleta.");
    const me = await fetch(`${base}/api/v2/users/me.json`, { redirect: "error", signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${token.access_token}` } });
    if (!me.ok) throw new Error("Não foi possível validar o usuário autorizado.");
    const { user } = await me.json();
    if (!user || user.suspended || !["admin", "agent"].includes(user.role)) throw new Error("Autorize com um agente ativo do Zendesk.");
    const current = JSON.parse(await readFile(configPath, "utf8"));
    if (current.ZENDESK_SUBDOMAIN !== subdomain) throw new Error("A conta configurada mudou. Reinicie a autorização.");
    current.ZENDESK_OAUTH_TOKEN = token.access_token;
    current.ZENDESK_OAUTH_EXPIRES_AT = Date.now() + Number(token.expires_in || 86400) * 1000;
    current.OUTBOUND_AGENT_IDS = String(user.id);
    if (token.refresh_token) current.ZENDESK_REFRESH_TOKEN = token.refresh_token;
    const temporary = `${configPath}.${randomBytes(8).toString("hex")}.tmp`;
    await writeFile(temporary, JSON.stringify(current), { mode: 0o600, flag: "wx" });
    await rename(temporary, configPath);
    reply(200, "Zendesk autorizado e token salvo neste computador. Nenhuma mensagem foi enviada. O acesso de teste expira; execute setup:oauth novamente para renovar. Falta conectar o app ao serviço de envio.");
    console.log("OAuth concluído; credenciais salvas sem exibição no terminal.");
  } catch (e) { reply(400, e.message); }
  finally { clearTimeout(deadline); server.close(); }
});
const deadline = setTimeout(() => { console.log("Autorização expirada. Execute setup:oauth novamente."); server.close(); }, 10 * 60000);
server.on("error", error => { clearTimeout(deadline); console.error(error.code === "EADDRINUSE" ? "Porta 8787 ocupada. Encerre o assistente OAuth anterior." : "Não foi possível iniciar o retorno OAuth."); process.exitCode = 1; });
server.listen(8787, "localhost", () => console.log(`Abra para autorizar sua conta Zendesk:\n${url}`));
