import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { metaOAuth, grantedWabas } from "../server/metaOAuth.mjs";

test("Meta validates app, scope, expiration and granted WABAs",()=>{
  const data={is_valid:true,app_id:"123",scopes:["whatsapp_business_management"],granular_scopes:[{scope:"whatsapp_business_management",target_ids:["456"]}]};
  assert.deepEqual(grantedWabas(data,"123"),["456"]);
  for(const patch of [{is_valid:false},{app_id:"999"},{scopes:[]},{expires_at:1},{granular_scopes:[]}])assert.throws(()=>grantedWabas({...data,...patch},"123"));
});
test("OAuth state is single use, secrets stay server-side and selection requires a grant",async()=>{
  const env={META_APP_ID:"123",META_APP_SECRET:"private",META_LOGIN_CONFIG_ID:"789"}, writes=[];
  const flow=metaOAuth({env,save:async v=>{writes.push(v);Object.assign(env,v);},transport:async url=>({ok:true,json:async()=>{
    if(url.pathname.endsWith("/oauth/access_token"))return {access_token:"private-token"};
    if(url.pathname.endsWith("/debug_token"))return {data:{is_valid:true,app_id:"123",scopes:["whatsapp_business_management"],granular_scopes:[{scope:"whatsapp_business_management",target_ids:["456"]}]}};
    if(url.pathname.endsWith("/message_templates"))return {data:[]};
    return {id:"456",name:"Test WABA"};
  }})});
  const start=flow.begin();
  assert.equal(start.url,start.redirectUri);
  assert.equal(new URL(start.url).search,"");
  const page=flow.page("nonce");
  assert.match(page,/"configId":"789"/);
  assert.match(page,/override_default_response_type:true/);
  assert.match(page,new RegExp(`"state":"${start.state}"`));
  assert.equal(page.includes("private"),false);
  const button={}, result={}, window={};let initOptions, loginOptions;
  runInNewContext(page.match(/<script nonce="nonce">([\s\S]*?)<\/script>/)[1],{
    window, document:{getElementById:id=>id==="connect"?button:result},
    FB:{init:options=>{initOptions=options;},login:(callback,options)=>{
      // Meta sdk.ui -> Assert.maybeFunction rejects AsyncFunction callbacks.
      assert.equal(Object.prototype.toString.call(callback),"[object Function]");
      loginOptions=options;
    }}
  });
  window.fbAsyncInit();button.onclick();
  assert.equal(initOptions.fedCM,false);
  assert.equal(loginOptions.config_id,"789");
  assert.equal(loginOptions.response_type,"code");
  assert.equal(loginOptions.override_default_response_type,true);
  assert.equal(start.url.includes("private"),false);
  await assert.rejects(flow.callback(new URLSearchParams({state:"wrong",code:"abc"})));
  const params=new URLSearchParams({state:start.state,code:"abc"});
  await flow.callback(params);
  assert.throws(()=>flow.page("nonce"));
  await assert.rejects(flow.callback(params));
  assert.equal((await flow.status()).accounts[0].id,"456");
  await assert.rejects(flow.select("999"));
  await flow.select("456");
  assert.equal(env.META_WABA_ID,"456");
  assert.equal(JSON.stringify(await flow.status()).includes("private-token"),false);
  assert.equal(writes.length,2);
});
