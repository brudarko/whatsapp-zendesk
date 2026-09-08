import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const configPath = join(homedir(), ".zendesk-whatsapp", "connection.json");

export async function discover(input, transport = fetch) {
  const { subdomain, appId, keyId, secret } = input;
  if (!/^[a-z0-9-]+$/.test(subdomain ?? "") || !/^[a-f0-9]{24}$/i.test(appId ?? "") ||
      !/^app_[a-f0-9]{24}$/i.test(keyId ?? "") || typeof secret !== "string" || !secret || secret.length > 512 || /\s/.test(secret))
    throw new Error("Confira o subdomínio, App ID, Key ID e Secret. Cole os valores sem barras extras ou espaços.");
  const base = `https://${subdomain}.zendesk.com/sc/v2/apps/${appId}/integrations`;
  let cursor = "";
  const seen = new Set(), integrations = [];
  do {
    const response = await transport(base + (cursor ? `?page[after]=${encodeURIComponent(cursor)}` : ""), {
      redirect: "error", signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${secret}`).toString("base64")}` },
    });
    if (!response.ok) throw new Error(response.status === 401 ? "Credenciais recusadas pelo Sunshine." : response.status === 403 ? "A chave não tem permissão para consultar integrações." : `Não foi possível consultar o Sunshine (HTTP ${response.status}).`);
    const page = await response.json();
    if (!Array.isArray(page.integrations) || typeof page.meta?.hasMore !== "boolean") throw new Error("Resposta de integrações incompleta.");
    for (const item of page.integrations) if (item.type === "whatsapp" && /^[a-f0-9]{24}$/i.test(item.id))
      integrations.push({ id: item.id, name: item.displayName || "WhatsApp", phone: item.phoneNumber || "Número não informado pela API" });
    cursor = page.meta.hasMore ? page.meta.afterCursor : "";
    if (page.meta.hasMore && (typeof cursor !== "string" || !cursor || seen.has(cursor))) throw new Error("Paginação de integrações inválida.");
    seen.add(cursor);
  } while (cursor);
  return [...new Map(integrations.map(i => [i.id, i])).values()];
}

export function selectionConfig(credentials, integrations, selection) {
  if (!integrations.some(i => i.id === selection.integrationId)) throw new Error("Selecione um número retornado pelo Sunshine.");
  if (!/^[1-9]\d*$/.test(selection.portfolioId ?? "")) throw new Error("Informe o ID numérico do portfólio empresarial Meta. Ele não é o ID da WABA.");
  return { ZENDESK_SUBDOMAIN: credentials.subdomain, SUNSHINE_APP_ID: credentials.appId,
    SUNSHINE_KEY_ID: credentials.keyId, SUNSHINE_SECRET: credentials.secret,
    WHATSAPP_INTEGRATION_ID: selection.integrationId, META_PORTFOLIO_ID: selection.portfolioId };
}

async function start() {
  const token = randomBytes(32).toString("hex"), port = 8788;
  const origin = `http://127.0.0.1:${port}`;
  let pending = null, busy = false;
  const html = await readFile(new URL("./setup.html", import.meta.url));
  createServer(async (req, res) => {
    const reply = (code, body) => { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); };
    if (req.headers.host !== `127.0.0.1:${port}`) return reply(403, { error: "Host inválido." });
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'" });
      return res.end(html);
    }
    const actual = Buffer.from(req.headers.authorization ?? ""), expected = Buffer.from(`Bearer ${token}`);
    if (req.headers.origin !== origin || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return reply(403, { error: "Reabra o link do assistente mostrado no terminal." });
    if (req.method !== "POST" || !["/discover", "/save"].includes(req.url)) return reply(404, { error: "Rota inexistente." });
    if (busy) return reply(409, { error: "Aguarde a operação atual." });
    busy = true;
    try {
      let body = "";
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 4096) throw new Error("Formulário muito grande."); }
      const input = JSON.parse(body);
      if (req.url === "/discover") {
        pending = null;
        const integrations = await discover(input);
        pending = { credentials: input, integrations, expires: Date.now() + 15 * 60000 };
        return reply(200, { integrations }); // Never return raw integration objects or secrets.
      }
      if (!pending || pending.expires < Date.now()) throw new Error("Valide novamente suas credenciais.");
      const config = selectionConfig(pending.credentials, pending.integrations, input);
      // Local single-account bootstrap. A hosted service needs per-tenant encrypted storage and authentication.
      const directory = join(homedir(), ".zendesk-whatsapp");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temp = join(directory, `connection-${randomBytes(8).toString("hex")}.tmp`);
      await writeFile(temp, JSON.stringify(config), { mode: 0o600, flag: "wx" });
      await rename(temp, configPath);
      pending = null;
      reply(200, { message: "Conexão Sunshine salva neste computador. Próxima etapa: autorizar o Support e configurar o endereço HTTPS do serviço. Nenhuma mensagem foi enviada." });
    } catch (e) { reply(400, { error: e instanceof SyntaxError ? "Formulário inválido." : e.message }); }
    finally { busy = false; }
  }).listen(port, "127.0.0.1", () => console.log(`Assistente privado local: ${origin}/#${token}`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await start();
