#!/usr/bin/env node
'use strict';
const {spawn}=require('child_process'),http=require('http'),path=require('path'); const port=28185;
const child=spawn(process.execPath,[path.join(__dirname,'ai-gateway.js'),String(port)],{stdio:['ignore','pipe','pipe']});
function request(method,pathname,body){return new Promise((resolve,reject)=>{const req=http.request({port,method,path:pathname,headers:{'content-type':'application/json'}},res=>{let out='';res.on('data',part=>out+=part);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(out)}));});req.on('error',reject);if(body)req.end(JSON.stringify(body));else req.end();});}
(async()=>{await new Promise((resolve,reject)=>{child.stdout.on('data',data=>String(data).includes('ai-gateway')&&resolve());child.once('error',reject);});const health=await request('GET','/health'),invalid=await request('POST','/v1/decide',{});if(!health.body.ok||invalid.status!==400)throw new Error(JSON.stringify({health,invalid}));console.log('PASS AI gateway',JSON.stringify({health,invalid}));})().catch(error=>{console.error('FAIL',error.message);process.exitCode=1;}).finally(()=>child.kill());
