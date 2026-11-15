// Fake supabase-js: same calls, data kept in localStorage, live updates via BroadcastChannel.
(function(){
const KEY="__mock_t57_docs",bc=new BroadcastChannel("mocksupa");
const X=o=>{const r=new XMLHttpRequest();r.open("POST","/__db",false);r.setRequestHeader("Content-Type","application/json");r.send(JSON.stringify(o));return JSON.parse(r.responseText||"{}")};const load=()=>X({op:"all"}),save=o=>{};window.__dbAll=load;window.__dbClear=()=>X({op:"clear"});
const listeners=[];bc.onmessage=e=>listeners.forEach(f=>f(e.data));
const emit=p=>{bc.postMessage(p);setTimeout(()=>listeners.forEach(f=>f(p)),5)};
function get(o,col){if(col.startsWith("data->>")){const v=o.data[col.slice(7)];return v==null?null:String(v)}if(col.startsWith("data->"))return o.data[col.slice(6)];return o[col]}
const cmp={eq:(a,b)=>a===b||String(a)===String(b),gte:(a,b)=>a>=b,lte:(a,b)=>a<=b,gt:(a,b)=>a>b,lt:(a,b)=>a<b};
function q(table){const f=[];let mode="select",payload=null;const b={
  select(){return b},eq(c,v){f.push([c,"eq",v]);return b},filter(c,op,v){f.push([c,op,typeof v==="string"&&/^-?\d+(\.\d+)?$/.test(v)&&c.startsWith("data->")&&!c.startsWith("data->>")?+v:v]);return b},limit(){return b},
  maybeSingle(){mode="single";return b},upsert(row){mode="upsert";payload=row;return b},delete(){mode="delete";return b},
  then(res,rej){if(window.__offline)return Promise.resolve({data:null,error:{message:"TypeError: Failed to fetch"}}).then(res,rej);try{const db=load();const rows=Object.values(db);const match=r=>f.every(([c,op,v])=>cmp[op](get(r,c),v));
    if(mode==="upsert"){X({op:"upsert",row:{coll:payload.coll,id:payload.id,data:JSON.parse(JSON.stringify(payload.data))}});emit({new:{coll:payload.coll}});return Promise.resolve({data:null,error:null}).then(res,rej)}
    if(mode==="delete"){const del=Object.values(load()).filter(match);X({op:"del",keys:del.map(r=>r.coll+"/"+r.id)});del.forEach(r=>emit({old:{coll:r.coll}}));return Promise.resolve({data:null,error:null}).then(res,rej)}
    const out=rows.filter(match).map(r=>({id:r.id,data:JSON.parse(JSON.stringify(r.data))}));
    return Promise.resolve({data:mode==="single"?(out[0]||null):out,error:null}).then(res,rej)}catch(e){return Promise.resolve({data:null,error:{message:String(e)}}).then(res,rej)}}};return b}
window.supabase={createClient(){window.__mockCalls=(window.__mockCalls||0);return {
  from:t=>q(t),
  rpc(name,a){if(window.__offline)return Promise.resolve({data:null,error:{message:"TypeError: Failed to fetch"}});return (X({op:"merge",c:a.c,i:a.i,patch:a.patch}),emit({new:{coll:a.c}}),Promise.resolve({data:null,error:null}))},
  channel(){const ch={on(_e,_f,cb){listeners.push(cb);return ch},subscribe(cb){setTimeout(()=>cb&&cb("SUBSCRIBED"),10);return ch}};return ch}}}};
})();
