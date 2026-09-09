// O serviço em 127.0.0.1 existe só no desenvolvimento com zcli. O build de produção
// define LOCAL_SERVICE como false e o esbuild remove este caminho do pacote publicado.
export const LOCAL_SERVICE_ENABLED = typeof LOCAL_SERVICE === "undefined" ? true : LOCAL_SERVICE;
const allowed = LOCAL_SERVICE_ENABLED;

export function isLocalApp() {
  return allowed && typeof window !== "undefined"
    && ["http://localhost:4567", "http://127.0.0.1:4567"].includes(window.location.origin);
}
export const localRequest = allowed
  ? async function localRequest(path, token, body) {
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
  : async function localRequest() {
      throw new Error("Esta versão do app não usa serviço local.");
    };
