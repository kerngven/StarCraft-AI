#!/usr/bin/env node
'use strict';
const { chromium } = require('playwright');
const path = require('path'); const os = require('os'); const fs = require('fs');
const CACHED = path.join(os.homedir(),'Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const OPTS = { headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] };
if (fs.existsSync(CACHED)) OPTS.executablePath = CACHED;
const URL = 'http://localhost:8080/?cdn=http://www.nvhae.com/starcraft&serverUrl=ws://localhost:28083&level=2&confirm=1';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  const browser = await chromium.launch(OPTS);
  const page = await browser.newPage({viewport:{width:1024,height:768}});
  const logs=[];
  page.on('console', m=>{ if(m.type()==='error'||m.type()==='warning') logs.push(m.type()+': '+m.text()); });
  page.on('pageerror', e=>logs.push('PAGEERROR: '+String(e).slice(0,120)));

  // Bridge: page calls back into Node with a JSON string. This avoids
  // Playwright's return-value serialization (broken by the game's `var Map`).
  let data=null;
  const ack = () => new Promise(r=>{ data=r; });
  await page.exposeFunction('__send', (s)=>{ if(data){ const r=data; data=null; r(s); } });

  await page.goto(URL,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(12000);

  // Sample tick twice, 3s apart, to confirm the game is advancing.
  const sample = (label) => new Promise((resolve)=>{
    data=resolve;
    page.evaluate((lbl)=>{
      try{
        var t=Game.team, r=Resource[t];
        var our=Unit.allOurUnits(), enemy=Unit.allEnemyUnits();
        var s=function(u){return {id:u.id,name:u.name,x:Math.round(u.posX()),y:Math.round(u.posY()),hp:u.life,fly:!!u.isFlying,atk:!!u.attack};};
        __send(JSON.stringify({label:lbl,team:t,race:Game.race.selected,tick:Game.mainTick,srv:Game.serverTick,
          mine:r.mine,gas:r.gas,man:r.man,our:our.length,enemy:enemy.length,
          ourList:our.slice(0,4).map(s),enemyList:enemy.slice(0,4).map(s)}));
      }catch(e){ __send(JSON.stringify({label:lbl,err:String(e)})); }
    },label).catch(()=>{});
  });

  const a = await sample('t0');
  await sleep(3000);
  const b = await sample('t1');
  console.log('T0:',a);
  console.log('T1:',b);
  const A=JSON.parse(a), B=JSON.parse(b);
  console.log('');
  console.log('advanced:',(B.tick||0)-(A.tick||0),'ticks in 3s  |  our:',A.our,'enemy:',A.enemy);
  console.log('--- page errors/warnings (last 8) ---');
  logs.slice(-8).forEach(l=>console.log('  '+l));
  await browser.close();
})();
