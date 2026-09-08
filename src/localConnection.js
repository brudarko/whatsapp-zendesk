export function isLocalApp() {
  return typeof window !== "undefined" && ["http://localhost:4567", "http://127.0.0.1:4567"].includes(window.location.origin);
}
export async function localRequest(path, token, body) {
  if (!isLocalApp()) throw new Error("Conexão disponível somente no ZCLI local.");
  const response = await fetch(`http://127.0.0.1:8787${path}`, { method: body ? "POST" : "GET", credentials: "omit", redirect: "error",
    signal: AbortSignal.timeout(60000), headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(typeof result.error === "string" ? result.error : `Serviço local recusou a operação (HTTP ${response.status}).`);
  }
  return response.json();
}
