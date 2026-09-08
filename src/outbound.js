import { shorthand, safeId, brazilianPhoneCandidates } from "./domain.js";
import { parsePhoneNumberFromString, AsYouType, getCountries, getCountryCallingCode } from "libphonenumber-js";

export { getCountries, getCountryCallingCode };
export function formatPhoneInput(value, country = "BR") {
  const text = value.trim().replace(/^00/, "+");
  const international = text.startsWith("+") ? parsePhoneNumberFromString(text) : null;
  if (international?.country) return { country: international.country, value: new AsYouType(international.country).input(international.nationalNumber) };
  return { country, value: new AsYouType(country).input(text) };
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
export function parseTemplate(text, parameters) {
  if (typeof text !== "string" || !/^&\(\([\s\S]*\)\)&$/.test(text.trim()) || /\{\{/.test(text))
    throw new Error("Use um template estático do catálogo, sem variáveis Zendesk.");
  const fields = [...text.matchAll(/([a-z_]+)=\[\[([\s\S]*?)\]\]/g)];
  if (!fields.length || text.replace(/([a-z_]+)=\[\[([\s\S]*?)\]\]/g, "").replace(/&\(\(|\)\)&|\s/g, ""))
    throw new Error("Formato de template não suportado para envio direto.");
  const values = {};
  for (const [, key, value] of fields) {
    if (!["template", "language", "fallback", "body_text", "header_text", "header_image", "header_document"].includes(key) || (key !== "body_text" && values[key]))
      throw new Error("Campos do template inválidos ou repetidos.");
    (values[key] ??= []).push(value);
  }
  const headers = ["text", "image", "document"].filter(k => values[`header_${k}`]);
  if (headers.length > 1) throw new Error("Mais de um cabeçalho no template.");
  const original = values.body_text ?? [];
  const body = parameters ?? original;
  if (!Array.isArray(body) || body.length !== original.length || body.some(v => typeof v !== "string" || !v.trim() || v.length > 1024 || /\{\{/.test(v)))
    throw new Error("Preencha todas as variáveis do template.");
  const config = { name: values.template?.[0], language: values.language?.[0], fallback: values.fallback?.[0], parameters: body,
    headerType: headers[0] || "", headerValue: headers.length ? values[`header_${headers[0]}`][0] : "" };
  shorthand(config); // Reuse catalogue validation, including delimiters and media URLs.
  const components = [];
  if (config.headerType) components.push({ type: "header", parameters: [config.headerType === "text"
    ? { type: "text", text: config.headerValue }
    : { type: config.headerType, [config.headerType]: { link: config.headerValue } }] });
  if (body.length) components.push({ type: "body", parameters: body.map(text => ({ type: "text", text })) });
  return { config, message: { type: "template", template: { name: config.name,
    language: { policy: "deterministic", code: config.language }, ...(components.length ? { components } : {}) } } };
}

export function sendRecord({ userId, macroId, parameters }) {
  return { version: 2, userId: safeId(userId), macroId: safeId(macroId), parameters };
}
