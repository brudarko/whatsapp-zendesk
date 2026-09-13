import test from "node:test";
import assert from "node:assert/strict";
import { contactField } from "../src/bulkFields.js";
test("bulk variables use each contact and leave missing fields empty", () => {
  const contacts = [{ name: "Ana Silva", email: "ana@example.com" }, { name: "Bruno Santos" }];
  assert.deepEqual(contacts.map(c => contactField(c, "firstName")), ["Ana", "Bruno"]);
  assert.deepEqual(contacts.map(c => contactField(c, "email")), ["ana@example.com", ""]);
  assert.equal(contactField(contacts[0], "unknown"), "");
});
