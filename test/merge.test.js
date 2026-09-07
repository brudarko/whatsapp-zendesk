import test from "node:test";
import assert from "node:assert/strict";
import { zendesk } from "../src/zendesk.js";
import { contactPhones, mergeReview } from "../src/merge.js";

function fixture() {
  const users = Object.fromEntries([11, 12].map((id) => [id, {
    user: { id, role: "end-user", name: `Pessoa ${id}`, notes: "", tags: [], user_fields: {} },
    identities: [{ id: id * 10, type: "messaging", value: `sunshine-${id}` }],
  }]));
  const writes = [];
  let fail = false;
  const api = zendesk({ request: async (options) => {
    const id = options.url.match(/users\/(\d+)/)?.[1];
    if (options.type !== "GET") {
      writes.push(options);
      if (fail) throw new Error("timeout");
      const target = JSON.parse(options.data).user.id;
      users[target].identities.push(...users[id].identities);
      delete users[id];
      return { user: users[target].user };
    }
    if (!users[id]) throw new Error("404");
    return structuredClone(options.url.includes("identities")
      ? { identities: users[id].identities } : { user: users[id].user });
  }});
  return { api, users, writes, timeout: () => { fail = true; } };
}

test("merge previews secondary identities and losses including false custom fields", () => {
  const { users } = fixture();
  users[11].identities.push({ type: "phone_number", value: "+55 11 98765-4321" });
  users[11].user.notes = "Preservar";
  users[11].user.tags = ["vip"];
  users[11].user.user_fields = { opted_out: false };
  assert.ok(contactPhones(users[11]).includes("+5511987654321"));
  assert.equal(mergeReview(users[11], users[12]).losses.length, 3);
});

test("merge blocks staff, shared users and source external id without writes", async () => {
  for (const change of [{ role: "agent" }, { suspended: true }, { shared: true }, { external_id: "crm-1" }]) {
    const { api, users, writes } = fixture();
    Object.assign(users[11].user, change);
    const review = await api.previewMerge(11, 12);
    assert.ok(review.blockers.length);
    await assert.rejects(api.mergeUser(review));
    assert.equal(writes.length, 0);
  }
  const { api } = fixture();
  await assert.rejects(api.previewMerge(11, 11), /diferentes/);
  await assert.rejects(api.mergeUser({}), /revisão/);
});

test("merge requires loss acknowledgement and rechecks identity changes", async () => {
  const { api, users, writes } = fixture();
  users[11].user.notes = "Não perder";
  const review = await api.previewMerge(11, 12);
  await assert.rejects(api.mergeUser(review), /perda/);
  users[11].identities.push({ id: 999, type: "email", value: "new@example.test" });
  await assert.rejects(api.mergeUser(review, true), /mudaram/);
  assert.equal(writes.length, 0);
});

test("merge reports surviving messaging links and cannot reuse approval", async () => {
  const { api, writes } = fixture();
  const review = await api.previewMerge(11, 12);
  const result = await api.mergeUser(review);
  assert.equal(result.verified, true);
  assert.deepEqual(result.messaging, ["sunshine-12", "sunshine-11"]);
  await assert.rejects(api.mergeUser(review), /revisão/);
  assert.equal(writes.length, 1);
});

test("ambiguous merge is never retried using the same approval", async () => {
  const { api, writes, timeout } = fixture();
  const review = await api.previewMerge(11, 12);
  timeout();
  await assert.rejects(api.mergeUser(review), /não foi confirmada/);
  await assert.rejects(api.mergeUser(review), /revisão/);
  assert.equal(writes.length, 1);
});

test("incomplete identity response blocks review instead of treating it as empty", async () => {
  const api = zendesk({ request: async ({ url }) => url.includes("identities")
    ? {} : { user: { id: Number(url.match(/users\/(\d+)/)[1]), role: "end-user" } } });
  await assert.rejects(api.previewMerge(11, 12), /incompleta/);
});

test("phone search uses secondary identities of source and candidates", async () => {
  const urls = [];
  const api = zendesk({ request: async ({ url }) => {
    urls.push(url);
    if (url.includes("/search")) return { users: [{ id: 12, role: "end-user", phone: null }] };
    const id = Number(url.match(/users\/(\d+)/)[1]);
    if (url.includes("identities")) return { identities: [{ id, type: "phone_number", value: id === 11 ? "+5511987654321" : "+551187654321" }] };
    return { user: { id, role: "end-user", phone: null } };
  }});
  assert.deepEqual((await api.duplicates({ id: 11 })).map((u) => u.id), [12]);
  assert.ok(urls.some((u) => decodeURIComponent(u).includes("phone:+5511987654321")));
});
