#!/usr/bin/env node
'use strict';
// spike.js — P0.4 core-assumption gate.
// 1 LLM player (browser A, team 1) vs 1 script player (browser B, team 0),
// full game in headless Chromium, recorded to video.
// Acceptance: LLM plays a full game; outputs legal JSON; engine doesn't crash;
// a watchable recording is produced.
const { chromium } = require('playwright');
const path=require('path'),os=require('os'),fs=require('fs');
const CACHED=path.join(os.homedir(),'Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const OPTS={headless:true,args:['--no-sandbox','--disable-dev-shm-usage']};
if(fs.existsSync(CACHED))OPTS.executablePath=CACHED;
const URL='http://localhost:8080/?serverUrl=ws://localhost:28083&level=2&confirm=1';
const LLM={base:'http://192.168.50.64:8080/v1/chat/completions',key:'dddd',model:'qwen3.8-27b-uncensored-fp8-q4_k_m.gguf'};
const DURATION_MS=180000;      // 3 min game
const STEP_MS=2000;             // decision cadence
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const withTimeout=(p,ms,tag)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error('TIMEOUT '+tag)),ms))]);

// ---- observation (team-aware) ----
function obsExpr(team){
  return `(()=>{
    const t=${team};
    const R=Resource[t];
    const our=Unit.allUnits.filter(u=>u.team===t&&u.status!=='dead').map(u=>({
      id:u.id,n:u.name,hp:u.hp,x:Math.round(u.posX()),y:Math.round(u.posY()),atk:!!u.attack
    })).slice(0,12);
    const enemy=Unit.allUnits.filter(u=>u.team!==t&&u.status!=='dead'&&u.insideScreen()).map(u=>({
      n:u.name,hp:u.hp,x:Math.round(u.posX()),y:Math.round(u.posY())
    })).slice(0,12);
    return JSON.stringify({
      tick:Game.mainTick, team:t, race:Game.race.selected,
      minerals:R?R.mine:null, gas:R?R.gas:null,
      ourCount:our.length, enemyCount:enemy.length,
      our:our, enemy:enemy
    });
  })()`;
}

// ---- LLM call ----
const SYS='You are an expert StarCraft player. You receive a JSON observation of your army and visible enemies. Reply with ONLY a JSON array of commands. Each command: {"type":"move","uids":[id...],"pos":{"x":int,"y":int}} or {"type":"attack","uids":[id...],"pos":{"x":int,"y":int}}. Move/attack your units toward enemies to fight. Do not include any text outside the JSON array.';
async function llmCallOnce(obs,extra){
  const body={model:LLM.model,messages:[{role:'system',content:SYS+(extra||'')},{role:'user',content:obs+'\n/no_think'}],max_tokens:1200,temperature:0.2};
  const r=await fetch(LLM.base,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+LLM.key},body:JSON.stringify(body)});
  if(!r.ok) throw new Error('http '+r.status);
  const d=await r.json();
  const content=d.choices[0].message.content||'';
  return {content,finish:d.choices[0].finish_reason,reasoning:d.choices[0].message.reasoning_content?d.choices[0].message.reasoning_content.length:0};
}
async function llmDecide(obs,extra){
  try{
    return await llmCallOnce(obs,extra);
  }catch(e){
    // one retry (server hiccup / transient)
    await sleep(800);
    return await llmCallOnce(obs,extra);
  }
}
function parseCmds(content){
  let s=content.trim();
  const a=s.indexOf('['),b=s.lastIndexOf(']');
  if(a>=0&&b>a) s=s.slice(a,b+1);
  const arr=JSON.parse(s);
  return arr.filter(c=>c&&Array.isArray(c.uids)&&c.pos&&Number.isFinite(c.pos.x)&&Number.isFinite(c.pos.y));
}

// ---- command injection (page) ----
function injectExpr(cmds){
  return `(()=>{
    const cmds=${JSON.stringify(cmds)};
    let n=0;
    cmds.forEach(c=>{
      const uids=c.uids.filter(id=>Unit.allUnits.some(u=>u.id===id&&u.status!=='dead'));
      if(!uids.length) return;
      const type=(c.type==='attack')?'rightClick':'rightClick'; // rightClick auto-attacks if enemy in range
      Multiplayer.cmds.push(JSON.stringify({uids,type,pos:{x:c.pos.x,y:c.pos.y},unlock:false,btn:c.type==='attack'?'attack':''}));
      n++;
    });
    return n;
  })()`;
}

// ---- script player heuristic (team 0): rally toward nearest visible enemy, else hold center ----
function scriptDecide(obs){
  const o=JSON.parse(obs);
  if(o.enemy.length){
    // target the nearest enemy cluster center
    const ex=Math.round(o.enemy.reduce((s,e)=>s+e.x,0)/o.enemy.length);
    const ey=Math.round(o.enemy.reduce((s,e)=>s+e.y,0)/o.enemy.length);
    const combat=o.our.filter(u=>u.atk);
    const uids=combat.map(u=>u.id);
    if(uids.length) return [{type:'attack',uids,pos:{x:ex,y:ey}}];
  }
  // no enemy visible: hold formation near own base (left side)
  const uids=o.our.map(u=>u.id);
  if(uids.length) return [{type:'move',uids,pos:{x:200,y:400}}];
  return [];
}

async function bootBrowser(videoDir,tag){
  const ctx=await chromium.launch(OPTS).then(async b=>{
    browser=b;
    const c=await b.newContext({viewport:{width:1024,height:768},recordVideo:{dir:videoDir,size:{width:1024,height:768}}});
    const p=await c.newPage();
    return {b,c,p};
  });
  return ctx;
}

(async()=>{
  const t0=Date.now();
  const videoDir=path.join(__dirname,'video');
  fs.rmSync(videoDir,{recursive:true,force:true});
  fs.mkdirSync(videoDir,{recursive:true});

  console.log('BOOT browser A (LLM, team 1)...');
  const A=await (async()=>{const b=await chromium.launch(OPTS);const c=await b.newContext({viewport:{width:1024,height:768},recordVideo:{dir:videoDir,name:'A-llm.webm',size:{width:1024,height:768}}});const p=await c.newPage();return{b,c,p};})();
  console.log('BOOT browser B (script, team 0)...');
  const B=await (async()=>{const b=await chromium.launch(OPTS);const c=await b.newContext({viewport:{width:1024,height:768},recordVideo:{dir:videoDir,name:'B-script.webm',size:{width:1024,height:768}}});const p=await c.newPage();return{b,c,p};})();

  await withTimeout(A.p.goto(URL,{waitUntil:'domcontentloaded',timeout:20000}),22000,'gotoA');
  await withTimeout(B.p.goto(URL,{waitUntil:'domcontentloaded',timeout:20000}),22000,'gotoB');

  // Wait for BOTH to be ready (mp && tick>0).
  console.log('WAIT both ready...');
  let Aready=false,Bready=false;
  for(let i=0;i<45;i++){
    await sleep(1000);
    try{Aready=JSON.parse(await A.p.evaluate('JSON.stringify({mp:Multiplayer.ON,t:Game.mainTick,team:Game.team})')).mp&&JSON.parse(await A.p.evaluate('Game.mainTick'))>0;}catch(e){}
    try{Bready=JSON.parse(await B.p.evaluate('JSON.stringify({mp:Multiplayer.ON,t:Game.mainTick,team:Game.team})')).mp&&JSON.parse(await B.p.evaluate('Game.mainTick'))>0;}catch(e){}
    if(i%10===0)console.log(`  [${i+1}s] A=${Aready} B=${Bready}`);
    if(Aready&&Bready)break;
  }
  if(!Aready||!Bready){console.log('NOT BOTH READY A='+Aready+' B='+Bready);await A.b.close();await B.b.close();process.exit(2);}
  const Ateam=JSON.parse(await A.p.evaluate('Game.team'));
  const Bteam=JSON.parse(await B.p.evaluate('Game.team'));
  console.log('BOTH READY at',Date.now()-t0,'ms  A.team='+Ateam+' B.team='+Bteam);

  // The LLM must drive team 1, the script team 0. If seats came out swapped,
  // map roles by actual team.
  const llmPage=(Ateam===1)?A:B;
  const scrPage=(Bteam===0)?B:A;
  const llmTeam=1, scrTeam=0;
  console.log('ROLE MAP: LLM->',llmPage===A?'A':'B','(team',llmTeam+')  SCRIPT->',scrPage===A?'A':'B','(team',scrTeam+')');

  let llmValid=0,llmFail=0,scrCmds=0,lastLLM='';
  const endAt=t0+DURATION_MS;
  while(Date.now()<endAt){
    const stepStart=Date.now();
    // 1) LLM decides (retry up to 2x on empty/invalid JSON)
    let llmCmds=[];
    let counted=false;
    try{
      const obs=await llmPage.p.evaluate(obsExpr(llmTeam));
      let content='',finish='',reasoning=0,attempt=0;
      for(let a=0;a<2;a++){
        attempt=a+1;
        const stronger=(a>0)?' Be concise. Output ONLY the JSON array, no reasoning, no prose. ':'';
        const {content:c,finish:f,reasoning:rz}=await withTimeout(llmDecide(obs, stronger),45000,'llm');
        content=c;finish=f;reasoning=rz;
        try{ llmCmds=parseCmds(content); if(llmCmds.length) break; }catch(pe){ llmCmds=[]; }
      }
      lastLLM=`[finish=${finish} reason=${reasoning} att=${attempt}] `+content.slice(0,120);
      const n=await llmPage.p.evaluate(injectExpr(llmCmds));
      if(llmCmds.length) llmValid++; else llmFail++;
      counted=true;
    }catch(e){
      if(!counted){llmFail++; lastLLM='ERR: '+String(e).slice(0,80);}
      // fallback: keep the LLM team alive with a hold command
      try{
        const obs=await llmPage.p.evaluate(obsExpr(llmTeam));
        const o=JSON.parse(obs);
        const uids=o.our.map(u=>u.id);
        if(uids.length) await llmPage.p.evaluate(injectExpr([{type:'move',uids,pos:{x:600,y:400}}]));
      }catch(e2){}
    }
    // 2) script decides
    try{
      const obs=await scrPage.p.evaluate(obsExpr(scrTeam));
      const cmds=scriptDecide(obs);
      if(cmds.length){await scrPage.p.evaluate(injectExpr(cmds));scrCmds+=cmds.length;}
    }catch(e){}
    // 3) status
    const A_t=JSON.parse(await llmPage.p.evaluate('Game.mainTick'));
    const B_t=JSON.parse(await scrPage.p.evaluate('Game.mainTick'));
    const elapsed=Math.round((Date.now()-t0)/1000);
    console.log(`[${elapsed}s] tick LLM=${A_t} SCR=${B_t}  llmValid=${llmValid} llmFail=${llmFail} scrCmds=${scrCmds} | ${lastLLM.slice(0,70)}`);
    const last=Math.round((Date.now()-stepStart)/1000);
    await sleep(Math.max(0,STEP_MS-last*1000));
  }

  // Final state.
  const fin=await (async()=>{
    const a=JSON.parse(await llmPage.p.evaluate(obsExpr(llmTeam)));
    const b=JSON.parse(await scrPage.p.evaluate(obsExpr(scrTeam)));
    return {llm:{tick:a.tick,our:a.ourCount,enemy:a.enemyCount,min:a.minerals},scr:{tick:b.tick,our:b.ourCount,enemy:b.enemyCount,min:b.minerals}};
  })();
  console.log('FINAL:',JSON.stringify(fin));
  console.log('lastLLM:',lastLLM);

  // Close (flushes video).
  await llmPage.c.close(); await scrPage.c.close();
  await A.b.close(); await B.b.close();

  const vids=fs.readdirSync(videoDir).filter(f=>f.endsWith('.webm'));
  console.log('VIDEOS:',vids.map(v=>v+' ('+Math.round(fs.statSync(path.join(videoDir,v)).size/1024)+'KB)').join(', '));

  const ok = llmValid>=3 && vids.length>=1 && fin.llm.tick>50;
  console.log(ok?'SPIKE PASS':'SPIKE (partial) — check criteria');
  console.log('  llmValidJSON:',llmValid,' llmFail:',llmFail,' videos:',vids.length,' finalTick:',fin.llm.tick);
  process.exit(ok?0:1);
})().catch(e=>{console.log('FATAL',e);process.exit(1);});
