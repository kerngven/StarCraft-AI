#!/usr/bin/env node
/* P5 four-seat scripted showmatch / browser-load smoke. */
'use strict';
const {spawn}=require('child_process');const {chromium}=require('playwright');const path=require('path'),os=require('os'),fs=require('fs');
const port=28186, cached=path.join(os.homedir(),'Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const options={headless:true,args:['--no-sandbox']};if(fs.existsSync(cached))options.executablePath=cached;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const server=spawn(process.execPath,[path.join(__dirname,'room-server.js'),String(port)],{stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{server.stdout.on('data',data=>String(data).includes('room-server')&&resolve());server.once('error',reject);});
 const ws=encodeURIComponent('ws://localhost:'+port+'/?room=showmatch&players=4');
 const browser=await chromium.launch(options), pages=[];
 for(let i=0;i<4;i++){const page=await browser.newPage({viewport:{width:960,height:640}});await page.goto('http://localhost:8080/?cdn=&serverUrl='+ws+'&level=8&confirm=1&gameSpeed=0.5',{waitUntil:'domcontentloaded'});pages.push(page);}
 await Promise.all(pages.map(page=>page.waitForFunction(()=>Multiplayer.ON&&Game.mainTick>8,{timeout:30000})));
 for(let round=0;round<5;round++){await Promise.all(pages.map(page=>page.evaluate(()=>{const uids=Unit.allOurUnits().filter(unit=>unit.attack).map(unit=>unit.id);if(uids.length)Multiplayer.cmds.push(JSON.stringify({type:'rightClick',uids:uids,pos:{x:2048,y:2048},unlock:false,btn:'attack'}));})));await wait(2000);}
 const state=await Promise.all(pages.map(page=>page.evaluate(()=>({team:Game.team,tick:Game.mainTick,units:Unit.allOurUnits().length}))));
 await browser.close();server.kill();
 if(state.length!==4||new Set(state.map(item=>item.team)).size!==4||state.some(item=>item.tick<20))throw new Error(JSON.stringify(state));
 console.log('PASS four-player showmatch',JSON.stringify(state));
})().catch(error=>{console.error('FAIL',error.message);process.exit(1);});
