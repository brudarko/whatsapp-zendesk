import test from "node:test";
import assert from "node:assert/strict";
import {
  brazilianPhoneCandidates as phones,
  windowFromConversation as window24,
  shorthand,
  macroTemplate,
  safeId,
} from "../src/domain.js";

test("BR: preserve original, find candidate, protect fixed lines, foreign numbers, DDD 55 and BSUID", () => {
  assert.deepEqual(phones("(11) 99876-5432"), [
    "+5511998765432",
    "+551198765432",
  ]);
  assert.deepEqual(phones("0055 11 9876-5432"), [
    "+551198765432",
    "+5511998765432",
  ]);
  assert.deepEqual(phones("(55) 99876-5432"), [
    "+5555998765432",
    "+555598765432",
  ]);
  assert.deepEqual(phones("+55 11 3234-5678"), ["+551132345678"]);
  assert.deepEqual(phones("+55 11 7234-5678"), ["+551172345678"]);
  for (const value of [
    "+1 212 555 0100",
    "BR.123456789",
    "+55 20 99876-5432",
    "abc11998765432",
    "11998765432 ramal 2",
  ])
    assert.deepEqual(phones(value), []);
});
test("24h: only inbound WhatsApp affects window; boundary is closed; missing evidence stays unknown", () => {
  const now = Date.parse("2026-09-07T12:00:00Z");
  const inbound = {
    channel: { name: "whatsapp" },
    author: { role: "end-user" },
    timestamp: new Date(now - 86400000).toISOString(),
  };
  assert.equal(window24([inbound], now).state, "closed");
  assert.equal(window24([inbound], now - 1).state, "open");
  assert.equal(
    window24([{ ...inbound, author: { role: "agent" } }], now).state,
    "unknown",
  );
  assert.equal(
    window24([{ ...inbound, channel: { name: "web" } }], now).state,
    "unknown",
  );
  assert.equal(
    window24([{ ...inbound, timestamp: "invalid" }], now).state,
    "unknown",
  );
  assert.equal(
    window24([{ ...inbound, timestamp: new Date(now + 1).toISOString() }], now)
      .state,
    "unknown",
  );
});
test("template syntax rejects delimiter injection, invalid names and unsafe media", () => {
  const template = {
    name: "retomar_atendimento",
    language: "pt_BR",
    fallback: "Podemos continuar?",
    parameters: ["Cliente"],
  };
  assert.match(shorthand(template), /body_text=\[\[Cliente\]\]/);
  assert.throws(() => shorthand({ ...template, name: "INVALID" }));
  assert.throws(() =>
    shorthand({ ...template, parameters: ["]] template=[[outro"] }),
  );
  assert.throws(() =>
    shorthand({
      ...template,
      headerType: "image",
      headerValue: "javascript:alert(1)",
    }),
  );
  assert.throws(() =>
    shorthand({
      ...template,
      headerType: "video",
      headerValue: "https://example.com/file.mp4",
    }),
  );
  assert.equal(macroTemplate({ title: "Other", active: true }), null);
  assert.throws(() => safeId("../users"));
});
