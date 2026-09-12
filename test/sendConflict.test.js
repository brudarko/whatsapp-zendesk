import test from "node:test";
import assert from "node:assert/strict";
import { classifySendConflict } from "../src/sendConflict.js";

const conversation = { id: 4, status: "open", via: { channel: "whatsapp" }, updated_at: "2026-09-11T20:00:00Z" };
const older = { id: 2, status: "open", via: { channel: "native_messaging" }, updated_at: "2026-09-10T20:00:00Z" };
const record = { id: 9, status: "open", tags: ["whatsapp_active_message"], via: { channel: "api" } };
const closed = { id: 8, status: "closed", via: { channel: "whatsapp" } };

test("classifySendConflict sends when there is no open conversation", () => {
  assert.deepEqual(classifySendConflict([], { state: "open" }), { action: "send" });
  assert.deepEqual(classifySendConflict([record, closed], { state: "open" }), { action: "send" });
});

test("classifySendConflict assigns the newest conversation inside the 24h window", () => {
  const result = classifySendConflict([record, older, conversation], { state: "open" });
  assert.equal(result.action, "assign");
  assert.equal(result.ticket.id, 4);
});

test("classifySendConflict treats a closed or unknown window as stale", () => {
  assert.equal(classifySendConflict([conversation], { state: "closed" }).action, "stale");
  assert.equal(classifySendConflict([conversation], { state: "unknown" }).action, "stale");
  assert.equal(classifySendConflict([conversation], {}).action, "stale");
  assert.equal(classifySendConflict([conversation]).ticket.id, 4);
});
