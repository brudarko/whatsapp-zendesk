export function providerError(status,data,secrets=[]) {
  const errors=Array.isArray(data?.errors)?data.errors:[data?.error||data];
  let detail=errors.slice(0,3).flatMap(e=>typeof e==='string'?[e]:[e?.code,e?.error_user_msg||e?.description||e?.message])
    .filter(v=>typeof v==='string'||typeof v==='number').join(': ');
  for(const secret of secrets)if(typeof secret==='string'&&secret.length>=8)detail=detail.split(secret).join('[oculto]');
  detail=detail.replace(/(?:Bearer|Basic|OAuth)\s+\S+/gi,'[credencial oculta]').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,500);
  return new Error(`API recusou a operação (HTTP ${status}).${detail?' '+detail:''}`);
}

// Advanced creation and sample uploads require direct WABA management access.
// Never use the token for a WABA different from the connected Sunshine channel.
export async function templateMetaAccess(env,scope,sunshine) {
  if(!env.META_ACCESS_TOKEN || !/^[1-9]\d*$/.test(env.META_WABA_ID||"") || !/^v\d+\.0$/.test(env.META_GRAPH_VERSION||""))return false;
  const {integration}=await sunshine(`/v2/apps/${scope.appId}/integrations/${scope.integrationId}`);
  return integration?.type==="whatsapp" && String(integration.accountId)===env.META_WABA_ID;
}
export async function metaRequest(env,path,body,fetcher=fetch,headers={}) {
  const response=await fetcher(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${path}`,{
    method:"POST",redirect:"error",signal:AbortSignal.timeout(60000),
    headers:{Authorization:`Bearer ${env.META_ACCESS_TOKEN}`,"Content-Type":"application/json",...headers},
    body:Buffer.isBuffer(body)?body:JSON.stringify(body)
  });
  const data=await response.json();
  if(!response.ok)throw providerError(response.status,data,[env.META_ACCESS_TOKEN,env.META_APP_SECRET]);
  return data;
}
export async function uploadTemplateSample(env,input,fetcher=fetch) {
  if(!/^\d+$/.test(env.META_APP_ID||""))throw Error("Configure o aplicativo Meta para enviar arquivos de exemplo.");
  const limits={"image/jpeg":5*1024**2,"image/png":5*1024**2,"video/mp4":16*1024**2,"application/pdf":16*1024**2};
  if(!limits[input.type]||typeof input.data!=="string"||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))throw Error("Use JPG, PNG, MP4 ou PDF.");
  const bytes=Buffer.from(input.data,"base64");
  if(!bytes.length||bytes.length>limits[input.type])throw Error("Arquivo muito grande: imagens até 5 MB; vídeos e PDF até 16 MB.");
  const valid=input.type==="image/png"?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
    input.type==="image/jpeg"?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:
    input.type==="application/pdf"?bytes.subarray(0,5).toString()==="%PDF-":bytes.subarray(4,8).toString()==="ftyp";
  if(!valid)throw Error("O conteúdo do arquivo não corresponde ao formato escolhido.");
  const query=new URLSearchParams({file_length:String(bytes.length),file_type:input.type,file_name:String(input.name||"sample").replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,100)});
  const session=await metaRequest(env,`${env.META_APP_ID}/uploads?${query}`,{},fetcher);
  if(typeof session.id!=="string"||!/^upload:[A-Za-z0-9_+/=%-]+(?:\?sig=[A-Za-z0-9_%=-]+)?$/.test(session.id))throw Error("Não foi possível preparar o arquivo de exemplo.");
  const result=await metaRequest(env,session.id,bytes,fetcher,{"Content-Type":"application/octet-stream",file_offset:"0",Authorization:`OAuth ${env.META_ACCESS_TOKEN}`});
  if(typeof result.h!=="string"||!/^\d+:/.test(result.h))throw Error("Envio do arquivo de exemplo não confirmado.");
  return {handle:result.h};
}
