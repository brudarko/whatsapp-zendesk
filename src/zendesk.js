import { macroTemplate, safeId } from "./domain.js";
import { contactPhones, mergeReview, contactFingerprint } from "./merge.js";

export function zendesk(client) {
  const reviews = new WeakMap();
  const request = (url, type = "GET", body) =>
    client.request({
      url,
      type,
      dataType: "json",
      contentType: "application/json",
      ...(body ? { data: JSON.stringify(body) } : {}),
    });
  async function pages(url, key) {
    const items = [],
      seen = new Set();
    while (url) {
      // Never follow a provider-supplied URL outside the Zendesk API.
      const parsed = new URL(url, "https://local.invalid");
      if (
        !parsed.pathname.startsWith("/api/v2/") ||
        seen.has(parsed.pathname + parsed.search)
      )
        throw new Error("Paginação inválida.");
      url = parsed.pathname + parsed.search;
      seen.add(url);
      const result = await request(url);
      if (!Array.isArray(result[key]) || (result.meta?.has_more && !result.next_page))
        throw new Error("Resposta incompleta do Zendesk. Atualize antes de continuar.");
      items.push(...result[key]);
      url = result.next_page;
    }
    return items;
  }
  async function contact(id) {
    const path = `/api/v2/users/${safeId(id)}`;
    const [{ user }, identities] = await Promise.all([
      request(`${path}.json`), pages(`${path}/identities.json`, "identities"),
    ]);
    if (!user || String(user.id) !== String(id))
      throw new Error("O Zendesk retornou um perfil diferente do solicitado.");
    return { user, identities };
  }
  return {
    contact,
    request,
    async load(location) {
      const globals = await client.get("currentUser");
      const currentUser = globals.currentUser;
      const [groups, macros] = await Promise.all([
        pages("/api/v2/groups.json", "groups"),
        pages("/api/v2/macros.json?active=true&only_viewable=true", "macros"),
      ]);
      let ticket = null,
        conversation = [];
      if (location !== "nav_bar") {
        const values = await client.get(["ticket", "ticket.conversation"]);
        ticket = values.ticket;
        conversation = values["ticket.conversation"] ?? [];
      }
      return {
        currentUser,
        groups,
        templates: macros.map(macroTemplate).filter(Boolean),
        ticket,
        conversation,
      };
    },
    async duplicates(requester, criterion = "phone") {
      if (!requester?.id) return [];
      const targetContact = await contact(requester.id);
      const target = targetContact.user;
      let queries = [];
      const variants = contactPhones(targetContact);
      if (criterion === "phone") queries = variants.map((p) => `phone:${p}`);
      if (criterion === "email" && target.email)
        queries = [`email:"${target.email.replace(/["\\]/g, "")}"`];
      if (criterion === "name" && target.name)
        queries = [`name:"${target.name.replace(/["\\]/g, "")}"`];
      const results = (
        await Promise.all(
          queries.map((q) =>
            pages(
              `/api/v2/users/search.json?query=${encodeURIComponent(q)}`,
              "users",
            ),
          ),
        )
      ).flat();
      const candidates = [
        ...new Map(
          results
            .filter(
              (u) =>
                u.id !== target.id &&
                u.role === "end-user" &&
                !u.suspended,
            )
            .map((u) => [u.id, u]),
        ).values(),
      ];
      if (criterion !== "phone") return candidates;
      const matches = [];
      // Sequential identity reads avoid bursts against the account rate limit.
      for (const user of candidates) {
        const full = await contact(user.id);
        if (contactPhones(full).some((p) => variants.includes(p))) matches.push(full.user);
      }
      return matches;
    },
    async insertTemplate(template, expectedTicketId) {
      const current = await client.get([
        "ticket.id",
        "ticket.status",
        "ticket.editor.targetChannel",
      ]);
      if (
        current["ticket.id"] !== expectedTicketId ||
        current["ticket.status"] === "closed"
      )
        throw new Error("O ticket mudou ou está fechado. Atualize o app.");
      if (
        !["whatsapp", "whatapp"].includes(
          current["ticket.editor.targetChannel"]?.name,
        )
      )
        throw new Error(
          "Selecione WhatsApp no editor antes de inserir o template.",
        );
      const fresh = macroTemplate(
        (await request(`/api/v2/macros/${safeId(template.id)}.json`)).macro,
      );
      if (!fresh)
        throw new Error(
          "O template foi desativado ou alterado. Atualize o catálogo.",
        );
      if (/\{\{/.test(fresh.text))
        throw new Error(
          "Esta macro usa variáveis Zendesk. Aplique-a pelo menu nativo de macros para resolver os valores.",
        );
      await client.invoke("ticket.editor.insert", fresh.text);
    },
    async createTemplate({ title, text, groupIds }) {
      const { currentUser } = await client.get("currentUser");
      if (currentUser.role !== "admin")
        throw new Error(
          "Somente administradores podem cadastrar templates compartilhados.",
        );
      return request("/api/v2/macros.json", "POST", {
        macro: {
          title: `WhatsApp::${title}`,
          active: true,
          actions: [{ field: "comment_value", value: text }],
          ...(groupIds.length
            ? {
                restriction: {
                  type: "Group",
                  ids: groupIds.map((id) => Number(safeId(id))),
                },
              }
            : {}),
        },
      });
    },
    async previewMerge(sourceId, targetId) {
      if (String(sourceId) === String(targetId))
        throw new Error("Escolha dois perfis diferentes.");
      const [source, target] = await Promise.all([contact(sourceId), contact(targetId)]);
      const review = mergeReview(source, target);
      reviews.set(review, [contactFingerprint(source), contactFingerprint(target)]);
      return review;
    },
    async mergeUser(review, acknowledgedLosses = false) {
      const expected = reviews.get(review);
      if (!expected) throw new Error("Abra uma nova revisão antes de fundir.");
      if (review.blockers.length) throw new Error(review.blockers.join(" "));
      if (review.losses.length && !acknowledgedLosses)
        throw new Error("Revise e confirme a perda dos dados listados.");
      const sourceId = review.source.user.id, targetId = review.target.user.id;
      const current = await Promise.all([contact(sourceId), contact(targetId)]);
      if (current.some((c, i) => contactFingerprint(c) !== expected[i])) {
        reviews.delete(review);
        throw new Error("Os perfis ou identidades mudaram. Abra uma nova revisão.");
      }
      if (!reviews.has(review)) throw new Error("Esta revisão já foi utilizada.");
      reviews.delete(review); // Never blindly repeat an irreversible request after a timeout.
      try {
        await request(`/api/v2/users/${safeId(sourceId)}/merge`, "PUT", {
          user: { id: Number(safeId(targetId)) },
        });
      } catch {
        throw new Error("A fusão não foi confirmada. Confira os dois perfis no Zendesk antes de tentar novamente.");
      }
      try {
        const survivor = await contact(targetId);
        const messaging = survivor.identities.filter((i) => i.type === "messaging").map((i) => i.value);
        return { survivor, messaging, verified: true };
      } catch {
        return { verified: false };
      }
    },
  };
}
