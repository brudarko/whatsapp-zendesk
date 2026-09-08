import test from "node:test";
import assert from "node:assert/strict";
import { isLocalApp, localRequest } from "../src/localConnection.js";

test("local transport requires the exact ZCLI origin and never uses the Zendesk proxy", async () => {
  const originalWindow = globalThis.window, originalFetch = globalThis.fetch;
  try {
    globalThis.window = { location: { origin: "https://example.zendesk.com" } };
    assert.equal(isLocalApp(), false);
    await assert.rejects(localRequest("/health", "test"), /somente/);
    globalThis.window.location.origin = "http://localhost:4567";
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "http://127.0.0.1:8787/send");
      assert.equal(options.credentials, "omit");
      assert.equal(options.headers.Authorization, "Bearer temporary");
      assert.equal(options.body, '{"ticketId":3}');
      return { ok: true, json: async () => ({ state: "accepted" }) };
    };
    assert.equal((await localRequest("/send", "temporary", { ticketId: 3 })).state, "accepted");
  } finally { globalThis.window = originalWindow; globalThis.fetch = originalFetch; }
});
