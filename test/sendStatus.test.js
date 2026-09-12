import test from "node:test";
import assert from "node:assert/strict";
import { sendStatusLabel, sendEventLine } from "../src/sendStatus.js";

test("send status never calls an unconfirmed message unread", () => {
  assert.equal(sendStatusLabel(null), "Sem confirmação de leitura");
  assert.equal(sendStatusLabel({ state: "accepted" }), "Aceita");
  assert.equal(sendStatusLabel({ state: "accepted", kind: "session" }), "Enviada");
  assert.equal(sendStatusLabel({ state: "accepted", channelAt: "2026-09-11T20:00:00Z" }), "Entregue no canal");
  assert.equal(sendStatusLabel({ deliveredAt: "2026-09-11T20:00:01Z" }), "Entregue");
  assert.equal(sendStatusLabel({ deliveredAt: "2026-09-11T20:00:01Z", readAt: "2026-09-11T20:01:00Z" }), "Lida");
  assert.equal(sendStatusLabel({ readAt: "2026-09-11T20:01:00Z", repliedAt: "2026-09-11T20:02:00Z" }), "Respondeu");
  assert.equal(sendStatusLabel({ failedAt: "2026-09-11T20:00:02Z", failureCode: "131047" }), "Falhou (131047)");
});

test("history event line names postback, flow, quote and Meta error", () => {
  assert.equal(sendEventLine({ postbackLabel: "Sim" }), "Clicou: Sim");
  assert.equal(sendEventLine({ flowResponse: { flow_token: "t" } }), "Flow enviado");
  assert.equal(sendEventLine({ quotedPreview: "Olá" }), "Respondeu citando Olá");
  assert.equal(sendEventLine({ metaError: { code: "131047" } }), "131047");
  assert.equal(sendEventLine({ metaPricing: { category: "utility" } }), "Preço Meta: utility");
  assert.equal(sendEventLine({}), "");
});
