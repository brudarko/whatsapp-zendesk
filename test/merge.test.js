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

function automaticFixture({ phones = ["+5511987654321", "+5511987654321"], verified = true, count = 1, channel = "whatsapp", notes = "" } = {}) {
  const writes = [], claims = [];
  const profiles = Object.fromEntries([11, 12, 13].map((id, i) => [id, {
    user: { id, role: "end-user", phone: phones[i % 2], name: "Bruno", notes: id === 12 ? notes : "", tags: [], user_fields: {} },
    identities: [{ id, type: "phone_number", value: phones[i % 2], verified }],
  }]));
  const api = zendesk({ request: async options => {
    const { url, type } = options;
    if (url.includes("/tickets/")) return { ticket: { id: 3, requester_id: 12, status: "open", via: { channel } } };
    if (url.includes("/search")) return { users: [profiles[11].user, ...(count > 1 ? [profiles[13].user] : [])] };
    const id = Number(url.match(/users\/(\d+)/)[1]);
    if (type !== "GET") { writes.push(options); return {}; }
    return structuredClone(url.includes("identities") ? { identities: profiles[id].identities } : { user: profiles[id].user });
  }});
  const guard = { claim: async pair => { if (claims.includes(pair)) throw new Error("tentativa anterior"); claims.push(pair); } };
  return { api, guard, writes, claims, profiles };
}

test("opening WhatsApp ticket merges one proven candidate once with stable survivor", async () => {
  const f = automaticFixture();
  assert.equal((await f.api.autoMergeOnOpen(3, f.guard)).merged, true);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].url, "/api/v2/users/12/merge");
  assert.equal(JSON.parse(f.writes[0].data).user.id, 11);
  await assert.rejects(f.api.autoMergeOnOpen(3, f.guard), /tentativa anterior/);
  assert.equal(f.writes.length, 1);
});

test("automatic merge refuses aliases alone, unverified contacts, ambiguity, losses and other channels", async () => {
  for (const options of [
    { phones: ["+5511987654321", "+551187654321"] },
    { verified: false }, { count: 2 }, { notes: "preservar" }, { channel: "email" },
  ]) {
    const f = automaticFixture(options);
    assert.ok((await f.api.autoMergeOnOpen(3, f.guard)).message);
    assert.equal(f.writes.length, 0);
    assert.equal(f.claims.length, 0);
  }
});

test("automatic merge refuses distinct Sunshine users and missing repetition protection", async () => {
  const f = automaticFixture();
  for (const id of [11, 12]) f.profiles[id].identities.push({ type: "messaging", value: `sunshine-${id}` });
  assert.match((await f.api.autoMergeOnOpen(3, f.guard)).message, /Sunshine diferentes/);
  assert.equal(f.writes.length, 0);
  const g = automaticFixture();
  await assert.rejects(g.api.autoMergeOnOpen(3), /Proteção/);
  assert.equal(g.writes.length, 0);
});

test("one-click duplicate search combines criteria, deduplicates and reports partial failures", async () => {
  const api = zendesk({ request: async () => { throw Error('Unexpected request'); } });
  const calls = [];
  api.duplicates = async (user, criterion) => {
    calls.push(criterion);
    if (criterion === 'email') throw Error('Forbidden');
    return criterion === 'phone' ? [{id:12,name:'Ana'}] : [{id:'12',name:'Ana'},{id:13,name:'Ana Silva'}];
  };
  const result = await api.findDuplicates({id:11});
  assert.deepEqual(calls,['phone','email','name']);
  assert.deepEqual(result.users.map(u => u.matchReasons),[['phone','name'],['name']]);
  assert.deepEqual(result.failedCriteria,['email']);
  api.duplicates = async () => { throw Error('Offline'); };
  await assert.rejects(api.findDuplicates({id:11}),/Não foi possível/);
  api.duplicates = async () => [];
  assert.deepEqual(await api.findDuplicates({id:11}),{users:[],failedCriteria:[]});
});

test("automatic merge stays off until the admin turns the setting on", async () => {
  const settings = {};
  const api = zendesk({
    metadata: async () => ({ settings }),
    get: async () => ({ currentUser: { role: "admin" } }),
    request: async () => ({}),
  });
  assert.equal(await api.autoMergeEnabled(), false);
  settings.auto_merge_contacts = "true"; // string do formulário não conta como consentimento
  assert.equal(await api.autoMergeEnabled(), false);
  settings.auto_merge_contacts = true;
  assert.equal(await api.autoMergeEnabled(), true);
});
