const { chromium } = require('playwright');
const path=require('path'),os=require('os');
const CACHED=path.join(os.homedir(),'Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const URL='http://localhost:8080/?cdn=http://www.nvhae.com/starcraft&serverUrl=ws://localhost:28083&level=2&confirm=1';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const b=await chromium.launch({headless:true,executablePath:CACHED,args:['--no-sandbox']});
  const p=await (await b.newContext({viewport:{width:1024,height:768}})).newPage();
  const imgRes=[];
  p.on('response',res=>{
    const u=res.url();
    if(u.includes('/img/Charas/')||u.includes('/img/Bg/')){
      imgRes.push({u:u.slice(-40),status:res.status(),size:res.headers()['content-length']||'?'});
    }
  });
  await p.goto(URL,{waitUntil:'domcontentloaded',timeout:20000});
  await sleep(12000);
  const st=await p.evaluate(()=>{
    const S=sourceLoader.sources;let total=0,loaded=0,broken=0;
    for(const k in S){const im=S[k];total++;if(im.complete&&im.naturalWidth>0)loaded++;else broken++;}
    return {CDN:Game.CDN,total,loaded,broken,mainTick:Game.mainTick};
  });
  console.log('PAGE STATE:',JSON.stringify(st));
  console.log('IMG RESPONSES (first 12):');
  imgRes.slice(0,12).forEach(r=>console.log(' ',r.status,r.size+'B',r.u));
  console.log('total img responses:',imgRes.length);
  await b.close();
})().catch(e=>{console.log('ERR',e.message);process.exit(1);});
