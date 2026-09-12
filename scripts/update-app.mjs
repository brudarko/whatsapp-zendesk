import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

// zcli apps:update always PUTs /apps/installations with zcli.apps.config.json
// parameters. Empty/dummy values there wipe sunshine_secret and meta_portfolio_id.
// This command uploads a new package only and leaves the installation settings alone.
const require = createRequire(import.meta.url);
const { request } = require("@zendesk/zcli-core");

async function uploadZip(zipPath) {
  const zip = readFileSync(zipPath);
  const form = new FormData();
  form.append("uploaded_data", new Blob([zip], { type: "application/zip" }), basename(zipPath));
  const cfg = await request.createRequestConfig("api/v2/apps/uploads.json", { method: "POST" });
  const headers = { ...cfg.headers };
  delete headers["Content-Type"];
  delete headers["content-type"];
  const response = await fetch(`${String(cfg.baseURL).replace(/\/$/, "")}/api/v2/apps/uploads.json`, {
    method: "POST", headers, body: form,
  });
  const body = await response.text();
  if (response.status >= 400) throw new Error(`api/v2/apps/uploads.json HTTP ${response.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body);
}
const root = new URL("..", import.meta.url).pathname;
const configPath = join(root, "zcli.apps.config.json");

function loadConfig() {
  try { return JSON.parse(readFileSync(configPath, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return {}; throw error; }
}

async function api(path, options = {}) {
  const cfg = await request.createRequestConfig(path, { method: options.method || "GET" });
  const headers = { ...cfg.headers, Accept: "application/json", ...(options.headers || {}) };
  const response = await fetch(`${String(cfg.baseURL).replace(/\/$/, "")}/${path.replace(/^\//, "")}`, {
    method: options.method || "GET",
    headers,
    ...(options.data ? { body: options.data } : {}),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (response.status >= 400) throw new Error(`${path} HTTP ${response.status}: ${text.slice(0, 300)}`);
  return data;
}

async function resolveAppId(config) {
  const listed = config.app_id && Number(config.app_id) > 0 ? String(config.app_id) : "";
  if (listed) return listed;
  const page = await api("api/support/apps/installations.json");
  const rows = (page.installations ?? []).map(i => ({
    app_id: i.app_id, installation_id: i.id, name: i.settings?.name || i.settings?.title || "",
  }));
  if (rows.length === 1) return String(rows[0].app_id);
  const names = rows.map(r => `${r.name || "(sem nome)"} → app_id ${r.app_id}`).join("\n");
  throw new Error(`Coloque o app_id em zcli.apps.config.json (só o número; sem parameters).\n${names || "Nenhuma instalação encontrada."}`);
}

const zipPath = execFileSync("node", [join(root, "scripts/package-app.mjs")], { cwd: root, encoding: "utf8" }).trim().split("\n")[0];
const upload = await uploadZip(zipPath);
const uploadId = upload.id ?? upload.upload?.id;
if (!uploadId) throw new Error("Upload sem id.");

const config = loadConfig();
const appId = await resolveAppId(config);
const deploy = await api(`api/v2/apps/${appId}`, {
  method: "PUT",
  data: JSON.stringify({ upload_id: uploadId }),
  headers: { "Content-Type": "application/json" },
});
const jobId = deploy.job_id;
if (!jobId) throw new Error("Deploy sem job_id.");
for (let i = 0; i < 40; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const job = await api(`api/v2/apps/job_statuses/${jobId}`);
  if (job.status === "completed") {
    if (String(config.app_id) !== String(appId))
      writeFileSync(configPath, `${JSON.stringify({ app_id: Number(appId) }, null, 2)}\n`);
    console.log(`App ${appId} atualizado. Settings da instalação foram preservadas.`);
    process.exit(0);
  }
  if (job.status === "failed") throw new Error(job.message || "Deploy falhou.");
}
throw new Error("Deploy não concluiu a tempo.");
