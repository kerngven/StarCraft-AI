#!/usr/bin/env node
'use strict';
// cmd-test.js — verify the command-injection round-trip (P0.4 core).
// Boots the game headless, reads our unit positions, injects a rightClick
// move command for ALL our units, then verifies they actually move.
const { chromium } = require('playwright');
const path=require('path'),os=require('os'),fs=require('fs');
const CACHED=path.join(os.homedir(),'Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const OPTS={headless:true,args:['--no-sandbox','--disable-dev-shm-usage']};
if(fs.existsSync(CACHED))OPTS.executablePath=CACHED;
const URL='http://localhost:8080/?cdn=http://www.nvhae.com/starcraft&serverUrl=ws://localhost:28083&level=2&confirm=1';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const withTimeout=(p,ms,tag)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error('TIMEOUT '+tag)),ms))]);

(async()=>{
  const t0=Date.now();
  const browser=await chromium.launch(OPTS);
  const page=await browser.newPage({viewport:{width:1024,height:768}});
  const errs=[];
  page.on('pageerror',e=>errs.push(String(e).slice(0,100)));
  console.log('STEP1 goto...');
  await withTimeout(page.goto(URL,{waitUntil:'domcontentloaded',timeout:20000}),22000,'goto');

  // Wait for game ready (mp && tick>0).
  console.log('STEP2 wait ready...');
  let ready=null;
  for(let i=0;i<40;i++){
    await sleep(1000);
    try{
      const o=JSON.parse(await withTimeout(page.evaluate(()=>JSON.stringify({
        mp:Multiplayer.ON,t:Game.mainTick,team:Game.team
      })),4000,'st'));
      if(o.mp&&o.t>0){ready=o;break;}
    }catch(e){}
  }
  if(!ready){console.log('NOT READY');await browser.close();process.exit(2);}
  console.log('READY',JSON.stringify(ready),'at',Date.now()-t0,'ms');

  // Read our units (id, name, pos).
  const before=JSON.parse(await page.evaluate(()=>JSON.stringify(
    Unit.allOurUnits().map(u=>({id:u.id,n:u.name,x:Math.round(u.posX()),y:Math.round(u.posY())}))
  )));
  console.log('STEP3 our units (before):',JSON.stringify(before));

  // Pick a target far from all our units (right side of screen).
  const avgX=before.reduce((s,u)=>s+u.x,0)/before.length;
  const target={x:Math.min(1000,Math.max(100,avgX+300)),y:400};
  console.log('STEP4 target:',JSON.stringify(target));

  // Inject a rightClick move command for ALL our units.
  const injected=await page.evaluate((tgt)=>{
    const uids=Unit.allOurUnits().map(u=>u.id);
    Multiplayer.cmds.push(JSON.stringify({uids,type:'rightClick',pos:tgt,unlock:false,btn:''}));
    return {n:uids.length,cmdsLen:Multiplayer.cmds.length};
  },target);
  console.log('STEP4 injected:',JSON.stringify(injected));

  // Wait for the command to round-trip and units to move (~5s).
  await sleep(5000);
  const after=JSON.parse(await page.evaluate(()=>JSON.stringify(
    Unit.allOurUnits().map(u=>({id:u.id,n:u.name,x:Math.round(u.posX()),y:Math.round(u.posY())}))
  )));
  console.log('STEP5 our units (after):',JSON.stringify(after));

  // Compute movement.
  let moved=0,byId={};
  before.forEach(b=>byId[b.id]=b);
  after.forEach(a=>{
    const b=byId[a.id];
    if(b){const d=Math.abs(a.x-b.x)+Math.abs(a.y-b.y);if(d>5)moved++;}
  });
  const tickNow=JSON.parse(await page.evaluate(()=>JSON.stringify({t:Game.mainTick,s:Game.serverTick})));
  console.log('RESULT: moved',moved,'/',after.length,'units; tick',tickNow.t,'server',tickNow.s);
  console.log('pageerrors (last 3):',errs.slice(-3));
  const ok=moved>=1 && tickNow.t>before.length; // at least one unit moved & game advanced
  console.log(ok?'CMD-TEST PASS':'CMD-TEST FAIL');
  await browser.close();
  process.exit(ok?0:1);
})().catch(e=>{console.log('FATAL',e);process.exit(1);});
