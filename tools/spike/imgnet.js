const { chromium } = require('playwright');
const path=require('path'),os=require('os');
const CACHED=path.join(os.homedir(),'Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const b=await chromium.launch({headless:true,executablePath:CACHED,args:['--no-sandbox']});
  const p=await (await b.newContext({viewport:{width:1024,height:768}})).newPage();
  // Load a single image via XHR in a blank page, check bytes
  await p.goto('about:blank');
  const r=await p.evaluate(async()=>{
    const url='http://www.nvhae.com/starcraft/img/Charas/SCV.png';
    const res=await fetch(url);
    const buf=await res.arrayBuffer();
    // also try <img>
    const im=new Image();
    await new Promise((res,rej)=>{im.onload=()=>res();im.onerror=()=>rej('imgerr');im.src=url;});
    return {xhr_status:res.status, xhr_bytes:buf.byteLength, img_naturalWidth:im.naturalWidth};
  });
  console.log(JSON.stringify(r,null,1));
  await b.close();
})().catch(e=>{console.log('ERR',e.message);process.exit(1);});
