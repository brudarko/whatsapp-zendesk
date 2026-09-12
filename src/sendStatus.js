export function sendStatusLabel(row) {
  if (!row) return "Sem confirmação de leitura";
  if (row.replied_at || row.repliedAt) return "Respondeu";
  if (row.read_at || row.readAt) return "Lida";
  const failed = row.failed_at || row.failedAt;
  if (failed) {
    const code = row.failure_code || row.failureCode;
    return code ? `Falhou (${code})` : "Falhou";
  }
  if (row.delivered_at || row.deliveredAt) return "Entregue";
  if (row.channel_at || row.channelAt) return "Entregue no canal";
  if (row.state === "accepted") return row.kind === "session" ? "Enviada" : "Aceita";
  return "Sem confirmação de leitura";
}

export function sendEventLine(row) {
  if (!row) return "";
  if (row.postbackLabel || row.postbackPayload) return `Clicou: ${row.postbackLabel || row.postbackPayload}`;
  if (row.flowResponse) return "Flow enviado";
  if (row.quotedPreview) return `Respondeu citando ${row.quotedPreview}`;
  if (row.quotedMessageId) return "Respondeu citando uma mensagem";
  const error = row.metaError;
  if (error) {
    if (typeof error === "string") return error;
    return String(error.code || error.title || error.message || "");
  }
  const pricing = row.metaPricing;
  if (pricing && typeof pricing === "object") {
    const category = pricing.category || pricing.pricing_model || pricing.type;
    return category ? `Preço Meta: ${category}` : "";
  }
  return "";
}
