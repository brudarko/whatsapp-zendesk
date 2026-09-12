import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// zcli apps:package on Node 26 has left tmp zips without an EOCD (they end on
// PK0708). Zendesk then answers "Cannot unzip the package". zip -X writes a
// complete archive and strips macOS extra attributes that also break their unzip.
const root = new URL("..", import.meta.url).pathname;
const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const outDir = join(root, "tmp");
const out = join(outDir, `app-${stamp}.zip`);
mkdirSync(outDir, { recursive: true });
execFileSync("zip", ["-r", "-X", "-q", out, "manifest.json", "assets", "translations", "-x", "*.DS_Store", "*/.DS_Store", "*._*"], { cwd: root });
const listing = execFileSync("unzip", ["-Z1", out], { encoding: "utf8" });
if (!listing.split("\n").includes("manifest.json")) throw new Error("O zip não tem manifest.json na raiz.");
execFileSync("unzip", ["-t", out]);
if (readFileSync(out).lastIndexOf(Buffer.from("PK\x05\x06")) < 0)
  throw new Error("Zip sem EOCD — não envie este arquivo ao Zendesk.");
const size = statSync(out).size;
if (size > 2 * 1024 * 1024) throw new Error(`Zip com ${size} bytes; o limite do Zendesk é 2 MB.`);
console.log(out);
console.log(`${size} bytes`);
