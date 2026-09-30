const { chromium } = require('playwright');
const path=require('path'),os=require('os'),fs=require('fs');
const CACHED=path.join(os.homedir(),'Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const URL='http://localhost:8080/?cdn=http://www.nvhae.com/starcraft&serverUrl=ws://localhost:28083&level=2&confirm=1';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const b=await chromium.launch({headless:true,executablePath:CACHED,args:['--no-sandbox']});
  const p=await (await b.newContext({viewport:{width:1024,height:768}})).newPage();
  await p.goto(URL,{waitUntil:'domcontentloaded',timeout:20000});
  await sleep(15000);
  const st=await p.evaluate(()=>{
    const S=sourceLoader.sources;
    let total=0,loaded=0,broken=0;
    const samples=[];
    for(const k in S){const im=S[k];total++; if(im.complete&&im.naturalWidth>0)loaded++; else broken++; if(samples.length<5)samples.push({k,complete:im.complete,nw:im.naturalWidth,src:(im.src||'').slice(-40)});}
    return {CDN:Game.CDN,total,loaded,broken,samples,mainTick:Game.mainTick,
      canvas:{w:document.getElementById('middleCanvas').width,h:document.getElementById('middleCanvas').height},
      offset:{x:GameMap.offsetX,y:GameMap.offsetY}};
  });
  console.log(JSON.stringify(st,null,1));
  await b.close();
})().catch(e=>{console.log('ERR',e.message);process.exit(1);});
