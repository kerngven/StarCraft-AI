#!/usr/bin/env node
'use strict';
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
  page.on('pageerror',e=>errs.push('PAGEERROR: '+String(e).slice(0,120)));
  console.log('STEP1 goto...');
  await withTimeout(page.goto(URL,{waitUntil:'domcontentloaded',timeout:20000}),22000,'goto');
  console.log('STEP1 done',Date.now()-t0,'ms');

  // Poll until the game has booted (Multiplayer.ON && mainTick>0), up to 40s.
  console.log('STEP2 wait for game ready...');
  let ready=null;
  for(let i=0;i<40;i++){
    await sleep(1000);
    try{
      const st=await withTimeout(page.evaluate(()=>JSON.stringify({
        mp:Multiplayer.ON, t:Game.mainTick, s:Game.serverTick,
        team:Game.team, race:Game.race.selected,
        mine:Resource[Game.team]?Resource[Game.team].mine:null,
        our:Unit.allOurUnits().length, enemy:Unit.allEnemyUnits().length
      })),4000,'status');
      const o=JSON.parse(st);
      if(i%5===0||o.mp) console.log(`  [${i+1}s] mp=${o.mp} t=${o.t} s=${o.s} team=${o.team} race=${o.race} mine=${o.mine} our=${o.our} enemy=${o.enemy}`);
      if(o.mp && o.t>0){ ready=o; break; }
    }catch(e){ console.log(`  [${i+1}s] poll err: ${e.message}`); }
  }
  if(!ready){ console.log('NOT READY after 40s'); console.log('pageerrors:',errs.slice(-5)); await browser.close(); process.exit(2); }
  console.log('READY:',JSON.stringify(ready),'at',Date.now()-t0,'ms');

  // Confirm the game ADVANCES: sample tick twice, 3s apart.
  const a=JSON.parse(await page.evaluate(()=>JSON.stringify({t:Game.mainTick,our:Unit.allOurUnits().map(u=>({n:u.name,x:Math.round(u.posX()),y:Math.round(u.posY())})).slice(0,3)})));
  await sleep(3000);
  const b=JSON.parse(await page.evaluate(()=>JSON.stringify({t:Game.mainTick,our:Unit.allOurUnits().map(u=>({n:u.name,x:Math.round(u.posX()),y:Math.round(u.posY())})).slice(0,3)})));
  console.log('ADVANCE: tick',a.t,'->',b.t,'(+'+(b.t-a.t)+') in 3s');
  console.log('  our units now:',JSON.stringify(b.our));
  console.log('pageerrors (last 5):',errs.slice(-5));
  console.log('PROBE OK',Date.now()-t0,'ms');
  await browser.close();
  process.exit(0);
})().catch(e=>{console.log('FATAL',e);process.exit(1);});
