import test from 'node:test';
import assert from 'node:assert/strict';
import {sunshineWindow} from '../src/sunshineWindow.js';
import {windowDuration} from '../src/domain.js';
const user='a'.repeat(24), conversation='b'.repeat(24), scope={appId:'c'.repeat(24),integrationId:'d'.repeat(24)};
const contact={identities:[{type:'messaging',value:user}]};
const now=Date.parse('2026-09-08T20:00:00Z');
const message=(time,patch={})=>({author:{type:'user',userId:user},source:{type:'whatsapp',integrationId:scope.integrationId,originalMessageTimestamp:time},received:new Date(now).toISOString(),...patch});
test('window uses latest client reply in scoped Sunshine history, including older pages',async()=>{
 const paths=[];
 const result=await sunshineWindow(contact,scope,async path=>{
  paths.push(path);
  if(path.includes('filter[userId]'))return{conversations:[{id:conversation}],meta:{hasMore:false}};
  if(path.includes('page[before]'))return{messages:[message('2026-09-08T16:00:00Z'),message('2026-09-08T18:00:00Z')],meta:{hasMore:false}};
  return{messages:[message('2026-09-08T19:59:00Z',{author:{type:'business'}}),message('2026-09-08T19:58:00Z',{source:{type:'whatsapp',integrationId:'other'}})],meta:{hasMore:true,beforeCursor:'cursor/?'}};
 },now);
 assert.equal(result.remaining,22*3600000);
 assert.equal(result.lastInbound,Date.parse('2026-09-08T18:00:00Z'));
 assert.equal(result.conversationId,conversation);
 assert.ok(paths.at(-1).endsWith('page[before]=cursor%2F%3F'));
 assert.equal(windowDuration(1224*60000),'20h 24min');
 assert.equal(windowDuration(24*3600000),'24h');
 const closed=await sunshineWindow(contact,scope,async path=>path.includes('filter[userId]')?{conversations:[{id:conversation}],meta:{hasMore:false}}:{messages:[message('2026-09-07T20:00:00Z')],meta:{hasMore:false}},now);
 assert.equal(closed.state,'closed');
});
test('incomplete Sunshine history cannot become a confirmed window',async()=>{
 assert.equal((await sunshineWindow({identities:[]},scope,()=>{throw Error('must not call');},now)).state,'unknown');
 await assert.rejects(sunshineWindow(contact,scope,async()=>({conversations:[],meta:{hasMore:true,afterCursor:'same'}}),now),/Paginação/);
 await assert.rejects(sunshineWindow(contact,scope,async()=>({conversations:[]}),now),/incompleta/);
});
