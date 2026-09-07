import { brazilianPhoneCandidates, macroTemplate, safeId } from "./domain.js";

export function zendesk(client) {
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
      items.push(...(result[key] ?? []));
      url = result.next_page;
    }
    return items;
  }
  return {
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
      const target = (
        await request(`/api/v2/users/${safeId(requester.id)}.json`)
      ).user;
      let queries = [];
      const variants = brazilianPhoneCandidates(target.phone);
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
      return [
        ...new Map(
          results
            .filter(
              (u) =>
                u.id !== target.id &&
                u.role === "end-user" &&
                !u.suspended &&
                (criterion !== "phone" ||
                  brazilianPhoneCandidates(u.phone).some((p) =>
                    variants.includes(p),
                  )),
            )
            .map((u) => [u.id, u]),
        ).values(),
      ];
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
    async mergeUser(sourceId, targetId) {
      if (String(sourceId) === String(targetId))
        throw new Error("Escolha dois perfis diferentes.");
      const users = await Promise.all(
        [sourceId, targetId].map((id) =>
          request(`/api/v2/users/${safeId(id)}.json`),
        ),
      );
      if (users.some(({ user }) => user.role !== "end-user" || user.suspended))
        throw new Error("Só é possível fundir usuários finais ativos.");
      return request(`/api/v2/users/${safeId(sourceId)}/merge`, "PUT", {
        user: { id: Number(safeId(targetId)) },
      });
    },
  };
}
