#!/usr/bin/env node
/**
 * download-imgs.js — download the 77 game image assets from the CDN into
 * local img/ so the game runs self-contained (CDN='') and recordings are
 * watchable. Sequential + retries + polite delay (CDN resets under load).
 * Idempotent: skips files that already exist and are non-empty.
 */
'use strict';
const fs=require('fs'),path=require('path'),http=require('http');
const CDN='http://www.nvhae.com/starcraft';
const ROOT=path.join(__dirname,'..');
const list=fs.readFileSync('/tmp/imglist.txt','utf8').split('\n').map(s=>s.trim())
  .filter(s=>s).map(s=>s.replace(/^Game\.CDN\+"/,'').replace(/"$/,''));
console.log('assets to fetch:',list.length);

function fetchOnce(url,dest,attempt=0){
  return new Promise((resolve,reject)=>{
    const u=new URL(url);
    const req=http.get({hostname:u.hostname,port:80,path:u.pathname,headers:{'User-Agent':'SC-AI-img','Accept':'*/*'}},res=>{
      if(res.statusCode===200){
        const c=[];res.on('data',x=>c.push(x));
        res.on('end',()=>{const b=Buffer.concat(c);if(b.length>0){fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,b);resolve(b.length);}else reject(new Error('empty'));});
      }else{res.resume();reject(new Error('http '+res.statusCode));}
    });
    req.on('error',reject);
    req.setTimeout(15000,()=>{req.destroy(new Error('timeout'));});
  });
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  let ok=0,skip=0,fail=0;const failed=[];
  for(const rel of list){
    const dest=path.join(ROOT,rel);
    if(fs.existsSync(dest)&&fs.statSync(dest).size>0){skip++;continue;}
    let done=false;
    for(let a=0;a<4&&!done;a++){
      try{const n=await fetchOnce(CDN+'/'+rel,dest,a);ok++;done=true;
        if((ok+skip)%10===0)console.log(`  [${ok+skip}/${list.length}] ok=${ok} skip=${skip} fail=${fail} last=${rel} (${n}B)`);
      }catch(e){await sleep(400*(a+1));}
    }
    if(!done){fail++;failed.push(rel);}
    await sleep(150); // polite delay
  }
  console.log(`\nDONE ok=${ok} skip=${skip} fail=${fail}`);
  if(failed.length)console.log('failed:',failed.join('\n'));
})();
