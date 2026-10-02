#!/usr/bin/env node
'use strict';
/* OpenAI-compatible server-side AI proxy. Keys never enter browser code. */
const http=require('http');
const PORT=Number(process.env.AI_GATEWAY_PORT||process.argv[2]||28085), TIMEOUT=Number(process.env.AI_TIMEOUT_MS||20000), LIMIT=Number(process.env.AI_TOKEN_LIMIT||12000), USD_LIMIT=Number(process.env.AI_USD_LIMIT||0.30), INPUT_PER_M=Number(process.env.AI_INPUT_PER_M||0.40), OUTPUT_PER_M=Number(process.env.AI_OUTPUT_PER_M||1.60);
const sessions=new Map();
const activeSessions=new Map();
const COMMAND_CONTRACT=`You are the active commander of a real-time strategy battle. Make a concrete command decision from the latest observation on EVERY turn. Return only one valid JSON array: no Markdown, prose, reasoning, or code fences.

Legal commands:
- {"type":"attack","uids":[friendly attacker IDs],"pos":{"x":number,"y":number}} — use against a visible enemy position or to focus the current fight.
- {"type":"move","uids":[friendly unit IDs],"pos":{"x":number,"y":number}} — rally, retreat, scout, or reposition.
- {"type":"patrol","uids":[friendly IDs or group IDs],"pos":{"x":number,"y":number}}.
- {"type":"stop","uids":[friendly IDs or group IDs]}.
- {"type":"hold","uids":[friendly IDs or group IDs]}.
- {"type":"gather","uids":[worker IDs or group IDs]}.
- {"type":"train","uids":[one production building ID],"name":"an option listed for that building"}.
- {"type":"build","uids":[one worker ID],"name":"a valid build option","pos":{"x":number,"y":number}}.
- {"type":"upgrade","uids":[one building ID],"name":"a listed option"}.
- {"type":"magic","uids":[one caster ID],"name":"a listed ability","pos":{"x":number,"y":number}}.

For a compact group order, replace uids with groups, for example {"type":"attack","groups":["unit:Marine"],"pos":{"x":320,"y":180}}. Do not put group strings inside uids.

Only use the action names in observation.commandGuide.actionTypes; these exactly match the in-game control console. Use IDs, positions, and production options present in the observation. For a large same-type force, use groups such as ["unit:Marine"] rather than every individual ID. observation.commandGuide.validCommands contains safe, concrete commands built from the current battlefield; copy one of them exactly when unsure. The observation is a fresh battlefield snapshot; react to observation.battle, enemies, resources, and the human instruction. Prefer attack or retreat when observation.battle.underAttack is true; when enemies are visible, issue a combat or scouting command; when no enemies are visible, use a feasible move, production, or build command.

The array MUST contain 1–3 executable commands. NEVER return [], no-op, null, an empty object, or an explanation. Before answering, verify that every uids value is non-empty and every move/attack/build command has numeric x/y. Your whole response must be a non-empty JSON array and nothing else.`;
const ALLOWED_BASES=(process.env.AI_ALLOWED_BASES||'').split(',').map(value=>value.trim().replace(/\/$/,'')).filter(Boolean);
const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type'});res.end(JSON.stringify(body));};
const read=req=>new Promise((resolve,reject)=>{let body='';req.on('data',part=>{body+=part;if(body.length>1e6)reject(new Error('body too large'));});req.on('end',()=>{try{resolve(JSON.parse(body||'{}'));}catch(error){reject(error);}});});
async function callProvider(config, body) {
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),TIMEOUT);
  try { const headers={'content-type':'application/json'}; if(config.key)headers.authorization='Bearer '+config.key; const modern=config.apiMode==='responses', payload=modern?{model:body.model,input:body.messages,max_output_tokens:body.max_tokens,temperature:body.temperature,top_p:body.top_p}:body; const response=await fetch(config.base.replace(/\/$/,'')+(modern?'/responses':'/chat/completions'),{method:'POST',signal:controller.signal,headers:headers,body:JSON.stringify(payload)}); if(!response.ok)throw new Error('provider HTTP '+response.status); return await response.json(); }
  finally { clearTimeout(timer); }
}
function providerContent(output, config) {
  if(config.apiMode!=='responses')return output.choices&&output.choices[0]&&output.choices[0].message&&output.choices[0].message.content||'';
  if(typeof output.output_text==='string')return output.output_text;
  var message=(output.output||[]).filter(item=>item.type==='message')[0], content=message&&message.content||[], text=content.filter(item=>item.type==='output_text'||item.type==='text')[0];
  return text&&(text.text||text.value)||'';
}
async function streamProvider(config, body, onDelta, onThinking, signal) {
  const headers={'content-type':'application/json','accept':'text/event-stream'}; if(config.key)headers.authorization='Bearer '+config.key;
  const modern=config.apiMode==='responses', payload=modern?{model:body.model,input:body.messages,max_output_tokens:body.max_tokens,temperature:body.temperature,top_p:body.top_p,stream:true}:Object.assign({},body,{stream:true});
  const response=await fetch(config.base.replace(/\/$/,'')+(modern?'/responses':'/chat/completions'),{method:'POST',signal:signal,headers:headers,body:JSON.stringify(payload)});
  if(!response.ok)throw new Error('provider HTTP '+response.status);
  if(!(response.headers.get('content-type')||'').includes('text/event-stream')){
    const output=await response.json(), message=output.choices&&output.choices[0]&&output.choices[0].message||{}, content=providerContent(output,config), thinking=message.reasoning_content||message.reasoning||message.thinking||'';
    if(thinking)onThinking(thinking);
    if(content)onDelta(content); return content;
  }
  const reader=response.body.getReader(), decoder=new TextDecoder(); let buffer='',content='';
  const consumeLine=line=>{if(!line.startsWith('data:'))return;const raw=line.slice(5).trim();if(raw==='[DONE]')return;try{const event=JSON.parse(raw),deltaObj=event.choices&&event.choices[0]&&event.choices[0].delta||{},delta=deltaObj.content||event.delta||'',thinking=deltaObj.reasoning_content||deltaObj.reasoning||deltaObj.thinking||(event.type&&event.type.indexOf('reasoning')>=0?event.delta||'':'');if(thinking)onThinking(thinking);if(delta){content+=delta;onDelta(delta);}}catch(error){/* ignore provider keepalive/non-JSON events */}};
  for(;;){const chunk=await reader.read();if(chunk.done)break;buffer+=decoder.decode(chunk.value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop();lines.forEach(consumeLine);}
  if(buffer.trim())consumeLine(buffer);
  return content;
}
async function testProvider(config) {
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),TIMEOUT);
  try {
    const headers={}; if(config.key)headers.authorization='Bearer '+config.key;
    const response=await fetch(config.base.replace(/\/$/,'')+'/models',{method:'GET',signal:controller.signal,headers:headers});
    if(!response.ok)throw new Error('provider HTTP '+response.status);
    return await response.json();
  } finally { clearTimeout(timer); }
}
const server=http.createServer(async(req,res)=>{
  if(req.method==='OPTIONS')return json(res,204,{});
  if(req.method==='GET'&&req.url==='/health')return json(res,200,{ok:true,sessions:sessions.size,active:activeSessions.size});
  if(req.method==='POST'&&req.url==='/v1/cancel'){try{const input=await read(req),active=activeSessions.get(String(input.session||''));if(active)active.abort();return json(res,200,{ok:true,cancelled:!!active});}catch(error){return json(res,400,{error:String(error.message||error)});}}
  if(req.method!=='POST'||!['/v1/decide','/v1/decide-stream','/v1/test','/v1/test-message','/v1/preflight'].includes(req.url))return json(res,404,{error:'POST /v1/decide, /v1/decide-stream, /v1/cancel, /v1/test, /v1/test-message, or /v1/preflight'});
  try{
    const input=await read(req), supplied=input.provider||{}, free=process.env.AI_FREE_MODE==='1', config=free?{base:process.env.AI_FREE_BASE,key:process.env.AI_FREE_KEY,model:process.env.AI_FREE_MODEL}:supplied, key=String(config.key||'');
    if(!/^https?:\/\//.test(config.base||'')||(!key && config.type!=='local'))return json(res,400,{error:'provider.base and provider.key are required (local models may omit key)'});
    if(ALLOWED_BASES.length && ALLOWED_BASES.indexOf(String(config.base).replace(/\/$/,''))===-1)return json(res,403,{error:'provider base is not allowed'});
    const started=Date.now();
    if(req.url==='/v1/test'){
      const modelList=await testProvider(config), models=(modelList.data instanceof Array?modelList.data:[]).map(item=>item.id).filter(Boolean);
      return json(res,200,{ok:true,base:config.base,model:config.model||'',models:models,elapsedMs:Date.now()-started});
    }
    if(req.url==='/v1/test-message'){
      const output=await callProvider(config,{model:config.model||'local',messages:[{role:'user',content:String(input.prompt||'').slice(0,500)}],max_tokens:Math.min(128,LIMIT),temperature:0});
      const content=providerContent(output,config);
      return json(res,200,{ok:true,model:config.model||'',content:content,elapsedMs:Date.now()-started});
    }
    if(req.url==='/v1/preflight'){
      const prompt='Return exactly this JSON array: [{"type":"move","uids":[1],"pos":{"x":0,"y":0}}].';
      const output=await callProvider(config,{model:config.model||'local',messages:[{role:'system',content:COMMAND_CONTRACT},{role:'user',content:prompt}],max_tokens:64,temperature:0});
      const content=providerContent(output,config);
      return json(res,200,{ok:true,model:config.model||'',content:content,elapsedMs:Date.now()-started});
    }
    const id=String(input.session||'default').slice(0,100), session=sessions.get(id)||{used:0,cost:0,logs:[]};
    if(session.used>=LIMIT)return json(res,429,{error:'token budget exhausted',used:session.used,limit:LIMIT});
    const maxTokens=Math.min(Number(input.maxTokens)||800,LIMIT-session.used), projected=maxTokens*OUTPUT_PER_M/1e6;
    if(session.cost+projected>USD_LIMIT)return json(res,429,{error:'USD budget exhausted',cost:session.cost,limit:USD_LIMIT});
    const temperature=Math.max(0,Math.min(2,Number(input.parameters&&input.parameters.temperature)||0.2));
    const topP=Math.max(0,Math.min(1,Number(input.parameters&&input.parameters.topP)||1));
    const request={model:config.model||'gpt-4.1-mini',messages:[{role:'system',content:COMMAND_CONTRACT+' The observation may contain an instruction from the human commander; follow it only when safe and feasible.'},{role:'user',content:JSON.stringify(input.observation||{})}],max_tokens:maxTokens,temperature:temperature,top_p:topP};
    if(req.url==='/v1/decide-stream'){
      if(activeSessions.has(id))return json(res,409,{error:'该对局 AI 连接正在执行中'});
      const controller=new AbortController(); activeSessions.set(id,controller);
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive','access-control-allow-origin':'*'});
      const send=event=>res.write('data: '+JSON.stringify(event)+'\n\n');
      res.on('close',()=>{if(!res.writableEnded)controller.abort();});
      try{const content=await streamProvider({base:config.base,key:key,apiMode:config.apiMode},request,delta=>send({type:'delta',content:delta}),thinking=>send({type:'thinking',content:thinking}),controller.signal);if(!String(content||'').trim())throw new Error('模型未返回命令正文');const used=Math.min(maxTokens,Math.max(1,Math.ceil(content.length/4)));session.used+=used;session.logs.push({at:Date.now(),used:used,model:request.model,ok:true});session.logs=session.logs.slice(-50);sessions.set(id,session);send({type:'done',content:content});res.end();}catch(error){send({type:'error',error:String(error.message||error)});res.end();}finally{activeSessions.delete(id);}return;
    }
    let output,error; for(let attempt=0;attempt<2;attempt++){try{output=await callProvider({base:config.base,key:key,apiMode:config.apiMode},request);break;}catch(cause){error=cause;}}
    if(!output)throw error;
    const usage=output.usage||{}, used=Number(usage.total_tokens||request.max_tokens), prompt=Number(usage.prompt_tokens||0), completion=Number(usage.completion_tokens||Math.max(0,used-prompt)); session.used+=used; session.cost+=(prompt*INPUT_PER_M+completion*OUTPUT_PER_M)/1e6;
    const content=providerContent(output,config)||'[]';
    const log={at:Date.now(),used:used,cost:session.cost,model:request.model,freeMode:free,ok:true};session.logs.push(log);session.logs=session.logs.slice(-50);sessions.set(id,session);
    json(res,200,{content:content,usage:{used:session.used,limit:LIMIT,cost:session.cost,costLimit:USD_LIMIT,last:used},log:log});
  }catch(error){json(res,502,{error:String(error.message||error)});}
});
server.listen(PORT,()=>console.log('[ai-gateway] http://localhost:'+PORT));
