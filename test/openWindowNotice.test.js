import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";

test("open-window notice hides only for the current ticket", async () => {
  const { outputFiles } = await build({ entryPoints: ["src/CustomerMessages.jsx"], bundle: true, write: false, platform: "node", mainFields: ["module", "main"], format: "cjs" });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const { OpenWindowNotice } = module.exports;
  assert.equal(OpenWindowNotice({ ticketId: 20, currentTicketId: "20" }), null);
  assert.ok(OpenWindowNotice({ ticketId: 20, currentTicketId: 21 }));
  assert.ok(OpenWindowNotice({ ticketId: 20 }));
});
