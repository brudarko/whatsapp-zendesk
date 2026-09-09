const DDDS = new Set(
  "11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99".split(
    " ",
  ),
);

// ponytail: candidates for review, never proof of identity or a rewritten destination.
export function brazilianPhoneCandidates(value) {
  const text = String(value ?? "").trim();
  if (!/^(?:\+|00)?[\d\s().-]+$/.test(text)) return [];
  let digits = text.replace(/\D/g, "");
  if (text.startsWith("00")) digits = digits.slice(2);
  const international =
    text.startsWith("+") || text.startsWith("00") || digits.length > 11;
  if (international) {
    if (!digits.startsWith("55")) return [];
    digits = digits.slice(2);
  }
  if (![10, 11].includes(digits.length) || !DDDS.has(digits.slice(0, 2)))
    return [];
  const ddd = digits.slice(0, 2),
    local = digits.slice(2);
  if (!(/^[2-9]\d{7}$/.test(local) || /^9\d{8}$/.test(local))) return [];
  const variants = ["+55" + digits];
  // Fixed lines and SME/trunk numbers do not gain a 9 through this heuristic.
  if (/^[89]\d{7}$/.test(local)) variants.push("+55" + ddd + "9" + local);
  if (/^9[89]\d{7}$/.test(local)) variants.push("+55" + ddd + local.slice(1));
  return variants;
}

export function windowDuration(milliseconds) {
  const minutes = Math.max(0, Math.ceil(milliseconds / 60000));
  const hours = Math.floor(minutes / 60);
  return `${hours}h${minutes % 60 ? ` ${minutes % 60}min` : ""}`;
}

export function windowFromConversation(messages, now = Date.now()) {
  const timestamps = messages
    .filter(
      (m) => m.channel?.name === "whatsapp" && m.author?.role === "end-user",
    )
    .map((m) => Date.parse(m.timestamp))
    .filter((t) => Number.isFinite(t) && t <= now);
  if (!timestamps.length) return { state: "unknown", remaining: 0 };
  const lastInbound = Math.max(...timestamps);
  const expiresAt = lastInbound + 24 * 60 * 60 * 1000;
  return {
    state: now < expiresAt ? "open" : "closed",
    lastInbound,
    expiresAt,
    remaining: Math.max(0, expiresAt - now),
  };
}

export function shorthand({
  name,
  language,
  fallback,
  parameters = [],
  headerType = "",
  headerValue = "",
}) {
  if (!/^[a-z0-9_]{1,512}$/.test(name))
    throw new Error(
      "Use letras minúsculas, números e sublinhado no nome Meta.",
    );
  if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language))
    throw new Error("Informe um idioma válido, como pt_BR.");
  function pair(key, value) {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      /\[\[|\]\]|&\(\(|\)\)&/.test(value)
    )
      throw new Error("Preencha os campos sem delimitadores de template.");
    return `${key}=[[${value}]]`;
  }
  const pairs = [
    pair("template", name),
    pair("language", language),
    pair("fallback", fallback),
  ];
  if (headerType) {
    if (!["text", "image", "document"].includes(headerType))
      throw new Error("Este formato exige a API de conversas.");
    if (headerType !== "text" && !/^https:\/\/[^\s]+$/.test(headerValue))
      throw new Error("A mídia precisa de uma URL HTTPS.");
    pairs.push(pair(`header_${headerType}`, headerValue));
  }
  parameters.forEach((p) => pairs.push(pair("body_text", p)));
  return `&(( ${pairs.join(" ")} ))&`;
}

export function macroTemplate(macro) {
  const action = macro.actions?.find((a) => a.field === "comment_value");
  if (
    !macro.active ||
    !macro.title.startsWith("WhatsApp::") ||
    !action?.value?.includes("&((")
  )
    return null;
  return {
    ...macro,
    text: action.value,
    label: macro.title.slice("WhatsApp::".length),
    useCase: typeof macro.description === "string" ? macro.description : "",
    groupIds: macro.restriction?.ids ?? [],
  };
}

export function safeId(id) {
  if (!/^\d+$/.test(String(id)) || Number(id) <= 0)
    throw new Error("Identificador inválido.");
  return String(id);
}

// Catálogo visto pelo administrador: inclui macros inativas, que ficam fora do
// envio (macroTemplate as descarta) enquanto a Meta não aprova o template.
export function catalogMacro(macro) {
  if (typeof macro?.title !== "string" || !macro.title.startsWith("WhatsApp::")) return null;
  const text = macro.actions?.find((a) => a.field === "comment_value")?.value ?? "";
  return {
    id: macro.id,
    label: macro.title.slice("WhatsApp::".length),
    useCase: typeof macro.description === "string" ? macro.description : "",
    groupIds: macro.restriction?.ids ?? [],
    active: macro.active === true,
    template: /template=\[\[([^\]]+)\]\]/.exec(text)?.[1] ?? "",
    language: /language=\[\[([^\]]+)\]\]/.exec(text)?.[1] ?? "",
  };
}

export function catalogMatch(entries, item) {
  if (!item?.name) return null;
  return (entries ?? []).find((e) => e.template === item.name && e.language === item.language) ?? null;
}
