export function metaTemplate({ name, language, category, body, examples = [] }) {
  if (!/^[a-z0-9_]{1,512}$/.test(name || "") || !/^[a-z]{2}(?:_[A-Z]{2})?$/.test(language || "")) throw new Error("Confira nome e idioma do template.");
  if (!["UTILITY", "MARKETING"].includes(category)) throw new Error("Categoria não suportada neste formulário.");
  if (typeof body !== "string" || !body.trim() || body.length > 1024) throw new Error("Escreva uma mensagem de até 1024 caracteres.");
  const matches = [...body.matchAll(/\{\{([1-9]\d*)\}\}/g)];
  if (/[{}]/.test(body.replace(/\{\{[1-9]\d*\}\}/g, ""))) throw new Error("Use variáveis no formato {{1}}, {{2}}.");
  const ids = [...new Set(matches.map(m => Number(m[1])))].sort((a,b) => a-b);
  if (ids.some((id,i) => id !== i+1) || examples.length !== ids.length || examples.some(v => typeof v !== "string" || !v.trim() || v.length > 1024)) throw new Error("Preencha exemplos para todas as variáveis, em sequência a partir de {{1}}.");
  return { name, language, category, components: [{ type: "BODY", text: body, ...(ids.length ? { example: { body_text: [examples] } } : {}) }] };
}
