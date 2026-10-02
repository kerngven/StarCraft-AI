#!/usr/bin/env node
'use strict';
/* OpenAI-compatible server-side AI proxy. Keys never enter browser code. */
const http=require('http');
const PORT=Number(process.env.AI_GATEWAY_PORT||process.argv[2]||28085), TIMEOUT=Number(process.env.AI_TIMEOUT_MS||20000), LIMIT=Number(process.env.AI_TOKEN_LIMIT||12000), USD_LIMIT=Number(process.env.AI_USD_LIMIT||0.30), INPUT_PER_M=Number(process.env.AI_INPUT_PER_M||0.40), OUTPUT_PER_M=Number(process.env.AI_OUTPUT_PER_M||1.60);
const sessions=new Map();
const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
const read=req=>new Promise((resolve,reject)=>{let body='';req.on('data',part=>{body+=part;if(body.length>1e6)reject(new Error('body too large'));});req.on('end',()=>{try{resolve(JSON.parse(body||'{}'));}catch(error){reject(error);}});});
async function callProvider(config, body) {
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),TIMEOUT);
  try { const response=await fetch(config.base.replace(/\/$/,'')+'/chat/completions',{method:'POST',signal:controller.signal,headers:{'content-type':'application/json',authorization:'Bearer '+config.key},body:JSON.stringify(body)}); if(!response.ok)throw new Error('provider HTTP '+response.status); return await response.json(); }
  finally { clearTimeout(timer); }
}
const server=http.createServer(async(req,res)=>{
  if(req.method==='GET'&&req.url==='/health')return json(res,200,{ok:true,sessions:sessions.size});
  if(req.method!=='POST'||req.url!=='/v1/decide')return json(res,404,{error:'POST /v1/decide'});
  try{
    const input=await read(req), supplied=input.provider||{}, free=process.env.AI_FREE_MODE==='1', config=free?{base:process.env.AI_FREE_BASE,key:process.env.AI_FREE_KEY,model:process.env.AI_FREE_MODEL}:supplied, key=String(config.key||'');
    if(!/^https?:\/\//.test(config.base||'')||!key)return json(res,400,{error:'provider.base and provider.key are required'});
    const id=String(input.session||'default').slice(0,100), session=sessions.get(id)||{used:0,cost:0,logs:[]};
    if(session.used>=LIMIT)return json(res,429,{error:'token budget exhausted',used:session.used,limit:LIMIT});
    const maxTokens=Math.min(Number(input.maxTokens)||800,LIMIT-session.used), projected=maxTokens*OUTPUT_PER_M/1e6;
    if(session.cost+projected>USD_LIMIT)return json(res,429,{error:'USD budget exhausted',cost:session.cost,limit:USD_LIMIT});
    const request={model:config.model||'gpt-4.1-mini',messages:[{role:'system',content:'Return only a JSON array of RTS commands.'},{role:'user',content:JSON.stringify(input.observation||{})}],max_tokens:maxTokens,temperature:0.2};
    let output,error; for(let attempt=0;attempt<2;attempt++){try{output=await callProvider({base:config.base,key:key},request);break;}catch(cause){error=cause;}}
    if(!output)throw error;
    const usage=output.usage||{}, used=Number(usage.total_tokens||request.max_tokens), prompt=Number(usage.prompt_tokens||0), completion=Number(usage.completion_tokens||Math.max(0,used-prompt)); session.used+=used; session.cost+=(prompt*INPUT_PER_M+completion*OUTPUT_PER_M)/1e6;
    const content=output.choices&&output.choices[0]&&output.choices[0].message&&output.choices[0].message.content||'[]';
    const log={at:Date.now(),used:used,cost:session.cost,model:request.model,freeMode:free,ok:true};session.logs.push(log);session.logs=session.logs.slice(-50);sessions.set(id,session);
    json(res,200,{content:content,usage:{used:session.used,limit:LIMIT,cost:session.cost,costLimit:USD_LIMIT,last:used},log:log});
  }catch(error){json(res,502,{error:String(error.message||error)});}
});
server.listen(PORT,()=>console.log('[ai-gateway] http://localhost:'+PORT));
