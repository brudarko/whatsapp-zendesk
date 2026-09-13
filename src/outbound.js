import { shorthand, safeId, brazilianPhoneCandidates } from "./domain.js";
import { parsePhoneNumberFromString, AsYouType, getCountries, getCountryCallingCode } from "libphonenumber-js";

export { getCountries, getCountryCallingCode };
export function formatPhoneInput(value, country = "BR") {
  const text = value.trim().replace(/^00/, "+");
  const international = text.startsWith("+") ? parsePhoneNumberFromString(text) : null;
  if (international?.country) return { country: international.country, value: new AsYouType(international.country).input(international.nationalNumber) };
  return { country, value: new AsYouType(country).input(text) };
}

// Exibição: agrupa o que já veio, nunca inventa DDI nem nono dígito. Números
// brasileiros de 8 dígitos ainda existem na base e o libphonenumber os trata como
// inválidos, então o agrupamento do DDD é feito aqui em vez de perder a leitura.
export function formatPhone(value, country = "BR") {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const digits = text.replace(/\D/g, "");
  const brazilian = digits.startsWith("55")
    ? digits.slice(2)
    : country === "BR" && !text.startsWith("+") ? digits : "";
  if ([10, 11].includes(brazilian.length)) {
    const local = brazilian.slice(2);
    return `+55 (${brazilian.slice(0, 2)}) ${local.slice(0, local.length - 4)}-${local.slice(-4)}`;
  }
  return parsePhoneNumberFromString(text, { defaultCountry: country, extract: false })?.formatInternational() ?? text;
}

export function looksLikePhone(value) {
  const text = String(value ?? "").trim();
  return /^[+(0-9][0-9\s().-]*$/.test(text) && text.replace(/\D/g, "").length >= 3;
}

export function destinationPhone(value, country = "BR") {
  const text = String(value ?? "").trim().replace(/^00/, "+");
  if (!/^[+\d\s().-]+$/.test(text)) throw new Error("Informe um telefone válido com DDI e código de área.");
  // Preserve Brazilian legacy numbers without inventing or removing the ninth digit.
  if ((country === "BR" && !text.startsWith("+")) || text.startsWith("+55")) {
    const phone = brazilianPhoneCandidates(text)[0];
    if (phone) return phone;
    throw new Error("Informe um número brasileiro válido com DDD.");
  }
  const phone = parsePhoneNumberFromString(text, { defaultCountry: country, extract: false });
  if (!phone?.isPossible() || phone.ext) throw new Error("Confira o DDI e o número completo com código de área.");
  return phone.number;
}

export const RECORD_PREFIX = "WhatsApp Active Messages v1\n";
// Separa o texto lido pelo agente do bloco de dados consumido pelo serviço de envio.
// Mantemos o RECORD_PREFIX como primeira linha (marcador histórico); o JSON vem
// após este marcador. Tickets antigos não têm o marcador e caem no formato legado.
export const RECORD_DATA_MARKER = "\nDados do envio (não edite este bloco):\n";

// Comentário interno único do ticket temporário: explica a natureza do ticket e
// registra quem enviou, quando e qual template, sem perder os dados de máquina.
export function recordCommentBody(record, { agentName, sentAt, templateLabel } = {}) {
  const when = sentAt ? new Date(sentAt) : new Date();
  const stamp = Number.isNaN(when.getTime()) ? "" : when.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  const lines = [
    "Ticket temporário de envio ativo pelo WhatsApp.",
    "Assim que o cliente responder, ele é unido automaticamente ao ticket da conversa do WhatsApp.",
  ];
  if (agentName && stamp) lines.push(`Enviado por ${agentName} em ${stamp}.`);
  else if (agentName) lines.push(`Enviado por ${agentName}.`);
  else if (stamp) lines.push(`Enviado em ${stamp}.`);
  if (templateLabel) lines.push(`Template: ${templateLabel}.`);
  return RECORD_PREFIX + lines.join("\n") + RECORD_DATA_MARKER + JSON.stringify(record);
}

// Lê o registro tanto do formato novo (texto + marcador + JSON) quanto do legado
// (RECORD_PREFIX + JSON puro). Devolve null quando o comentário não é um registro.
export function parseRecordComment(text) {
  if (typeof text !== "string" || !text.startsWith(RECORD_PREFIX)) return null;
  const rest = text.slice(RECORD_PREFIX.length);
  const at = rest.lastIndexOf(RECORD_DATA_MARKER);
  const json = at >= 0 ? rest.slice(at + RECORD_DATA_MARKER.length) : rest;
  try { return JSON.parse(json.trim()); } catch { return null; }
}
export function parseTemplate(text, parameters) {
  if (typeof text !== "string" || !/^&\(\([\s\S]*\)\)&$/.test(text.trim()) || /\{\{/.test(text))
    throw new Error("Use um template estático do catálogo, sem variáveis Zendesk.");
  const fields = [...text.matchAll(/([a-z_]+)=\[\[([\s\S]*?)\]\]/g)];
  if (!fields.length || text.replace(/([a-z_]+)=\[\[([\s\S]*?)\]\]/g, "").replace(/&\(\(|\)\)&|\s/g, ""))
    throw new Error("Formato de template não suportado para envio direto.");
  const values = {};
  for (const [, key, value] of fields) {
    if (!["template", "language", "fallback", "body_text", "header_text", "header_image", "header_document", "flow"].includes(key) || (key !== "body_text" && values[key]))
      throw new Error("Campos do template inválidos ou repetidos.");
    (values[key] ??= []).push(value);
  }
  const headers = ["text", "image", "document"].filter(k => values[`header_${k}`]);
  if (headers.length > 1) throw new Error("Mais de um cabeçalho no template.");
  if (values.flow && values.flow[0] !== "1") throw new Error("Campos do template inválidos ou repetidos.");
  const original = values.body_text ?? [];
  const body = parameters ?? original;
  if (!Array.isArray(body) || body.length !== original.length || body.some(v => typeof v !== "string" || !v.trim() || v.length > 1024 || /\{\{/.test(v)))
    throw new Error("Preencha todas as variáveis do template.");
  const config = { name: values.template?.[0], language: values.language?.[0], fallback: values.fallback?.[0], parameters: body,
    headerType: headers[0] || "", headerValue: headers.length ? values[`header_${headers[0]}`][0] : "",
    flow: values.flow?.[0] === "1" };
  shorthand(config); // Reuse catalogue validation, including delimiters and media URLs.
  const components = [];
  if (config.headerType) components.push({ type: "header", parameters: [config.headerType === "text"
    ? { type: "text", text: config.headerValue }
    : { type: config.headerType, [config.headerType]: { link: config.headerValue } }] });
  if (body.length) components.push({ type: "body", parameters: body.map(text => ({ type: "text", text })) });
  if (config.flow) components.push({
    type: "button", sub_type: "flow", index: "0",
    parameters: [{ type: "action", action: { flow_token: "zendesk" } }],
  });
  return { config, message: { type: "template", template: { name: config.name,
    language: { policy: "deterministic", code: config.language }, ...(components.length ? { components } : {}) } } };
}

export function sendRecord({ userId, macroId, parameters }) {
  return { version: 2, userId: safeId(userId), macroId: safeId(macroId), parameters };
}

export function previewSendRecord(record) {
  if (record?.templateText) {
    try {
      const text = parseTemplate(record.templateText, record.parameters).config.fallback;
      if (text) return text;
    } catch { /* fall through to parameters */ }
  }
  if (record?.parameters?.length) return record.parameters.join(" · ");
  return "Mensagem ativa";
}
