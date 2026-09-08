import { createServer } from "node:http";
import { timingSafeEqual, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { mkdir, writeFile, rename, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { zendesk } from "../src/zendesk.js";
import { sendRecordedTicket } from "./outbound.mjs";
import { configPath } from "./setup.mjs";
import { whatsappTemplates } from "./templates.mjs";
import { metaOAuth } from "./metaOAuth.mjs";

const localMode = process.argv.includes("--local");
if (localMode) {
  process.env.OUTBOUND_SERVICE_TOKEN = randomBytes(32).toString("hex");
  process.env.OUTBOUND_DATA_DIR ||= join(homedir(), ".zendesk-whatsapp", "outbound");
}

try {
  const saved = JSON.parse(await readFile(configPath, "utf8"));
  if (!process.env.ZENDESK_OAUTH_TOKEN && saved.ZENDESK_OAUTH_EXPIRES_AT && Date.now() >= saved.ZENDESK_OAUTH_EXPIRES_AT) throw new Error("Token expirado. Execute npm run setup:oauth.");
  for (const key of ["META_APP_ID", "META_LOGIN_CONFIG_ID", "META_APP_SECRET", "META_ACCESS_TOKEN", "META_WABA_ID", "META_GRAPH_VERSION", "META_REDIRECT_URI", "ZENDESK_OAUTH_TOKEN", "OUTBOUND_AGENT_IDS", "ZENDESK_SUBDOMAIN", "SUNSHINE_APP_ID", "SUNSHINE_KEY_ID", "SUNSHINE_SECRET", "WHATSAPP_INTEGRATION_ID", "META_PORTFOLIO_ID"])
    if (!process.env[key] && typeof saved[key] === "string") process.env[key] = saved[key];
} catch (e) { if (e.code !== "ENOENT") throw new Error("Não foi possível ler a conexão local. Execute npm run setup:local novamente."); }

const required = ["ZENDESK_SUBDOMAIN", "ZENDESK_OAUTH_TOKEN", "SUNSHINE_APP_ID", "SUNSHINE_KEY_ID", "SUNSHINE_SECRET", "WHATSAPP_INTEGRATION_ID", "META_PORTFOLIO_ID", "OUTBOUND_SERVICE_TOKEN", "OUTBOUND_AGENT_IDS", "OUTBOUND_DATA_DIR"];
for (const key of required) if (!process.env[key]) throw new Error(`Configure ${key}.`);
if (!/^[a-z0-9-]+$/.test(process.env.ZENDESK_SUBDOMAIN) || process.env.OUTBOUND_SERVICE_TOKEN.length < 32) throw new Error("Configuração de subdomínio ou token inválida.");
const scope = { appId: process.env.SUNSHINE_APP_ID, integrationId: process.env.WHATSAPP_INTEGRATION_ID, portfolioId: process.env.META_PORTFOLIO_ID };
if (![scope.appId, scope.integrationId].every(id => /^[a-f0-9]{24}$/i.test(id))) throw new Error("IDs Sunshine inválidos.");
const allowedAgentIds = process.env.OUTBOUND_AGENT_IDS.split(",").map(id => id.trim());
if (!allowedAgentIds.every(id => /^[1-9]\d*$/.test(id))) throw new Error("Lista de agentes inválida.");
const base = `https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com`;
async function request(path, auth, method = "GET", body) {
  const response = await fetch(base + path, { method, redirect: "error", signal: AbortSignal.timeout(20000),
    headers: { Authorization: auth, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error(`API recusou a operação (HTTP ${response.status}).`);
  return response.json();
}
const api = zendesk({ request: o => request(o.url, `Bearer ${process.env.ZENDESK_OAUTH_TOKEN}`, o.type, o.data ? JSON.parse(o.data) : undefined) });
const auth = `Basic ${Buffer.from(`${process.env.SUNSHINE_KEY_ID}:${process.env.SUNSHINE_SECRET}`).toString("base64")}`;
const sunshine = (path, method, body) => request(`/sc${path}`, auth, method, body);
const directory = resolve(process.env.OUTBOUND_DATA_DIR);
await mkdir(directory, { recursive: true, mode: 0o700 });
const claim = async id => {
  try { await writeFile(join(directory, `${id}.json`), JSON.stringify({ state: "attempting", ticketId: id }), { flag: "wx", mode: 0o600 }); }
  catch { throw new Error("Já existe uma tentativa ou o armazenamento está indisponível. Confira o ticket antes de reenviar."); }
};
const save = async (id, result) => {
  const temporary = join(directory, `${id}.tmp`);
  await writeFile(temporary, JSON.stringify(result), { mode: 0o600 });
  await rename(temporary, join(directory, `${id}.json`));
};
const meta = metaOAuth({ env:process.env, save:async values => {
  const config = JSON.parse(await readFile(configPath,"utf8"));
  if (config.ZENDESK_SUBDOMAIN !== process.env.ZENDESK_SUBDOMAIN) throw new Error("A conta local mudou. Reinicie o serviço.");
  const temporary = `${configPath}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temporary,JSON.stringify({...config,...values}),{mode:0o600,flag:"wx"});
  await rename(temporary,configPath);
  Object.assign(process.env,values);
} });
createServer(async (req, res) => {
  const reply = (code, body) => { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); };
  if (localMode && ["GET","POST"].includes(req.method) && req.url?.split("?")[0] === "/meta/callback" && req.headers.host === "127.0.0.1:8787") {
    res.setHeader("Referrer-Policy","no-referrer");
    res.setHeader("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'");
    try {
      if(req.method === "GET") {
        const nonce=randomBytes(24).toString("base64");
        const html=meta.page(nonce);
        res.setHeader("Content-Security-Policy",`default-src 'none'; script-src 'nonce-${nonce}' https://connect.facebook.net; connect-src 'self' https://*.facebook.com https://connect.facebook.net; style-src 'unsafe-inline'; frame-src https://*.facebook.com https://connect.facebook.net; img-src https://*.facebook.com https://connect.facebook.net data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
        res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});return res.end(html);
      }
      if(req.headers.origin !== new URL(process.env.META_REDIRECT_URI).origin) return reply(403,{error:"Origem inválida."});
      let raw="";for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16384)throw new Error("Pedido muito grande.");}
      const input=JSON.parse(raw);
      if(typeof input.state!=="string"||typeof input.code!=="string")throw new Error("Pedido inválido.");
      await meta.callback(new URLSearchParams(input)); return reply(200,{message:"Meta conectada. Volte ao Zendesk, clique em Atualizar conexão e selecione sua conta WhatsApp. Nenhuma mensagem foi enviada."}); }
    catch(e){return reply(400,{error:e.message});}
  }
  if (localMode) {
    if (req.headers.host !== "127.0.0.1:8787" || !["http://localhost:4567", "http://127.0.0.1:4567"].includes(req.headers.origin)) return reply(403, { error: "Origem local inválida." });
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Allow-Private-Network", "true");
      res.writeHead(204); return res.end();
    }
  }
  const actual = Buffer.from(req.headers.authorization ?? ""), expected = Buffer.from(`Bearer ${process.env.OUTBOUND_SERVICE_TOKEN}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return reply(401, { error: "Não autorizado." });
  if (localMode && ["/meta/connect","/meta/status","/meta/select"].includes(req.url)) {
    try {
      const {user}=await api.request("/api/v2/users/me.json");
      if(user?.role!=="admin"||user.suspended)return reply(403,{error:"Autorize o serviço com um administrador."});
      if(req.url==="/meta/status"&&req.method==="GET")return reply(200,await meta.status());
      if(req.url==="/meta/connect"&&req.method==="POST")return reply(200,meta.begin());
      if(req.url==="/meta/select"&&req.method==="POST") {
        let raw="";for await(const chunk of req){raw+=chunk;if(raw.length>1024)throw new Error("Pedido inválido.");}
        return reply(200,await meta.select(JSON.parse(raw).id));
      }
      return reply(405,{error:"Método inválido."});
    }catch(e){return reply(400,{error:e.message});}
  }
  if (localMode && req.url === "/templates" && ["GET", "POST"].includes(req.method)) {
    try {
      const { user } = await api.request("/api/v2/users/me.json");
      if (user?.role !== "admin" || user.suspended) return reply(403, { error: "Autorize o serviço com um administrador." });
      let payload;
      if (req.method === "POST") {
        let raw="";for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16384)throw new Error("Template muito grande.");}
        payload=JSON.parse(raw);
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Template inválido.");
      }
      return reply(200,await whatsappTemplates(sunshine,scope,payload));
    }catch(e){return reply(409,{error:e.message});}
  }
  if (localMode && req.method === "GET" && req.url === "/health") return reply(200, { subdomain: process.env.ZENDESK_SUBDOMAIN });
  if (req.method !== "POST" || req.url !== "/send") return reply(404, { error: "Rota inexistente." });
  try {
    let input = "";
    for await (const chunk of req) { input += chunk; if (Buffer.byteLength(input) > 1024) throw new Error("Pedido muito grande."); }
    const { ticketId } = JSON.parse(input);
    const result = await sendRecordedTicket(ticketId, { api, sunshine, scope, claim, save, allowedAgentIds });
    reply(200, result);
  } catch (e) { reply(409, { error: e.message || "Falha no envio." }); }
}).listen(localMode ? 8787 : Number(process.env.PORT || 8787), "127.0.0.1", () => console.log(localMode
  ? `Serviço local pronto. Cole esta chave temporária no app ZCLI:\n${process.env.OUTBOUND_SERVICE_TOKEN}`
  : "Serviço WhatsApp disponível no loopback. Use proxy HTTPS para o app instalado."));
