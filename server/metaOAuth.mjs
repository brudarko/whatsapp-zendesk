import { randomBytes, timingSafeEqual } from "node:crypto";

export function grantedWabas(data, appId, now = Date.now()) {
  if (!data?.is_valid || String(data.app_id) !== appId || !data.scopes?.includes("whatsapp_business_management") ||
      [data.expires_at, data.data_access_expires_at].some(t => t && t * 1000 <= now)) throw new Error("A Meta não concedeu acesso válido à gestão do WhatsApp. Conecte novamente.");
  const ids = [...new Set((data.granular_scopes || []).filter(s => s.scope === "whatsapp_business_management").flatMap(s => s.target_ids || []))];
  if (!ids.length || ids.some(id => !/^[1-9]\d*$/.test(id))) throw new Error("Nenhuma conta WhatsApp foi compartilhada. Confira os ativos na configuração de login da Meta.");
  return ids;
}

// ponytail: single-account local OAuth; hosted installations need isolated sessions and encrypted tenant storage.
export function metaOAuth({ env, save, transport = fetch }) {
  let pending = null;
  const checkState = value => {
    const actual = Buffer.from(value || ""), expected = Buffer.from(pending?.state || "");
    if (!pending || pending.expires < Date.now() || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Conexão expirada ou inválida. Clique em Conectar com a Meta novamente.");
  };
  const version = () => env.META_GRAPH_VERSION || "v25.0";
  const redirect = () => env.META_REDIRECT_URI || "http://127.0.0.1:8787/meta/callback";
  async function graph(path, params, auth) {
    const url = new URL(`https://graph.facebook.com/${version()}/${path}`);
    for (const [key,value] of Object.entries(params)) url.searchParams.set(key,value);
    let response;
    try { response = await transport(url, { redirect: "error", signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${auth}` } }); }
    catch { throw new Error("Não foi possível conectar à Meta. Tente conectar novamente."); }
    if (!response.ok) throw new Error(`A Meta recusou a conexão (HTTP ${response.status}). Confira as permissões e as configurações de login.`);
    return response.json();
  }
  const inspect = async token => {
    const { data } = await graph("debug_token", { input_token: token }, `${env.META_APP_ID}|${env.META_APP_SECRET}`);
    return { data, ids: grantedWabas(data, env.META_APP_ID) };
  };
  return {
    begin() {
      if (![env.META_APP_ID,env.META_LOGIN_CONFIG_ID].every(v => /^[1-9]\d*$/.test(v || "")) || !env.META_APP_SECRET) throw new Error("A conexão Meta ainda não foi configurada pelo administrador do serviço.");
      const callback = new URL(redirect());
      if (callback.username || callback.password || callback.search || callback.hash || callback.pathname !== "/meta/callback" ||
          !(callback.protocol === "https:" || callback.origin === "http://127.0.0.1:8787")) throw new Error("URL de retorno Meta inválida.");
      const state = randomBytes(32).toString("hex");
      pending = { state, expires: Date.now()+10*60000, redirect: callback.href };
      // redirect_uri precisa bater exatamente com a URI cadastrada na Meta (strict mode); nunca carregar o state na URL da página.
      return { url:callback.href, redirectUri:callback.href, state };
    },
    page(nonce) {
      if (!pending || pending.expires < Date.now()) throw new Error("Conexão expirada ou inválida. Clique em Conectar com a Meta novamente.");
      const state = pending.state;
      const config = JSON.stringify({ appId:env.META_APP_ID, configId:env.META_LOGIN_CONFIG_ID, version:version(), state }).replaceAll("<", "\\u003c");
      return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Conectar WhatsApp</title><body><h1>Conectar WhatsApp</h1><button id="connect" disabled>Continuar com a Meta</button><p id="result" role="status">Carregando conexão segura…</p><script nonce="${nonce}">
const config=${config}, button=document.getElementById('connect'), result=document.getElementById('result');
// Keep Embedded Signup on the code/config_id flow; FedCM requests openid instead.
window.fbAsyncInit=()=>{FB.init({appId:config.appId,version:config.version,autoLogAppEvents:false,xfbml:false,fedCM:false});button.disabled=false;result.textContent='Selecione sua conta WhatsApp na próxima janela.';};
async function completeLogin(response){
 if(!response.authResponse?.code){result.textContent='Autorização não concluída. Tente novamente.';button.disabled=false;return;}
 try{const reply=await fetch('/meta/callback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:config.state,code:response.authResponse.code})});const data=await reply.json();result.textContent=data.message||data.error;}
 catch{result.textContent='Não foi possível confirmar a conexão. Volte ao Zendesk e verifique a conexão antes de tentar novamente.';}
}
button.onclick=()=>{button.disabled=true;result.textContent='Abrindo a janela da Meta…';try{
 FB.login(function(response){void completeLogin(response);},{config_id:config.configId,response_type:'code',override_default_response_type:true,extras:{setup:{}}});
}catch{button.disabled=false;result.textContent='Não foi possível abrir a janela da Meta. Atualize a página e tente novamente.';}};
</script><script async defer crossorigin="anonymous" src="https://connect.facebook.net/pt_BR/sdk.js"></script></body></html>`;
    },
    async callback(query) {
      checkState(query.get("state"));
      pending = null;
      if (query.has("error") || !query.get("code")) throw new Error("A autorização foi cancelada. Você pode tentar novamente pelo app.");
      const token = await graph("oauth/access_token", { client_id:env.META_APP_ID, client_secret:env.META_APP_SECRET, code:query.get("code") }, `${env.META_APP_ID}|${env.META_APP_SECRET}`);
      if (typeof token.access_token !== "string" || !token.access_token) throw new Error("A Meta não retornou um token válido.");
      const { data } = await inspect(token.access_token);
      await save({ META_ACCESS_TOKEN:token.access_token, META_WABA_ID:"", META_GRAPH_VERSION:version(), META_TOKEN_EXPIRES_AT:String(data.expires_at || 0) });
    },
    async status() {
      if (!env.META_ACCESS_TOKEN) return { connected:false, accounts:[], redirectUri:redirect() };
      const { ids } = await inspect(env.META_ACCESS_TOKEN);
      const accounts=[];
      for (const id of ids) {
        const item = await graph(id, { fields:"id,name" }, env.META_ACCESS_TOKEN);
        if (String(item.id)!==id) throw new Error("A Meta retornou uma conta diferente da solicitada.");
        accounts.push({ id, name:item.name || "Conta WhatsApp" });
      }
      return { connected:true, accounts, selectedId:ids.includes(env.META_WABA_ID)?env.META_WABA_ID:"" };
    },
    async select(id) {
      const { ids } = await inspect(env.META_ACCESS_TOKEN);
      if (!ids.includes(id)) throw new Error("Selecione uma conta autorizada pela Meta.");
      await graph(`${id}/message_templates`, { limit:"1", fields:"id" }, env.META_ACCESS_TOKEN);
      await save({ META_WABA_ID:id });
      return { selectedId:id };
    },
  };
}
