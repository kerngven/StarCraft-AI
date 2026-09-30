#!/usr/bin/env node
'use strict';
const { chromium } = require('playwright');
const path=require('path'),os=require('os'),fs=require('fs');
const CACHED=path.join(os.homedir(),'Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
(async()=>{
  const b=await chromium.launch({headless:true,executablePath:CACHED,args:['--no-sandbox']});
  const c=await b.newContext({viewport:{width:320,height:200},recordVideo:{dir:'/tmp/vt',size:{width:320,height:200}}});
  const p=await c.newPage();
  await p.setContent('<h1>video test</h1>');
  await new Promise(r=>setTimeout(r,1500));
  await c.close(); await b.close();
  console.log('video files:',fs.readdirSync('/tmp/vt'));
})().catch(e=>{console.log('ERR',e.message);process.exit(1);});
