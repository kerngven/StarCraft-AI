#!/usr/bin/env node
'use strict';
const { chromium } = require('playwright');
const fs=require('fs'),os=require('os'),path=require('path');
const cached=path.join(os.homedir(),'Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const options={headless:true,args:['--no-sandbox']}; if(fs.existsSync(cached)) options.executablePath=cached;
(async()=>{
  const browser=await chromium.launch(options), page=await browser.newPage();
  await page.goto('http://localhost:8080/?cdn=&level=13&offline=1&gameSpeed=0.5&decisionTicks=60&victoryBuilding=NoSuchBuilding',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof AICommander!='undefined'&&Game.mainTick>10);
  const result=await page.evaluate(async()=>{
    const team=Game.team, worker=Unit.allOurUnits()[0], before={x:worker.x,y:worker.y};
    const observation=AIAdapter.observe(team), commandCenter=Building.allBuildings.filter(building=>building.team===team&&building.name==='CommandCenter')[0], count=Unit.allOurUnits().length;
    Cheat.cwal=true;
    const accepted=AIAdapter.enqueue([{type:'move',uids:[worker.id],pos:{x:500,y:300}},{type:'train',uids:[commandCenter.id],name:'SCV'},{type:'invalid'}],team);
    await new Promise(resolve=>setTimeout(resolve,3000));
    Cheat.cwal=false;
    const instructed=AICommander.injectInstruction(team,'Focus on economy'), throttled=AICommander.injectInstruction(team,'Ignore this'), fallback=AICommander.apply(team,[],'test');
    return {hasResources:!!observation.resources,units:observation.units.length,accepted,moved:worker.x!==before.x||worker.y!==before.y,trained:Unit.allOurUnits().length>count,instructed,throttled,fallback,logs:AICommander.forTeam(team).logs.length,rendered:document.querySelectorAll('.command_LogEntries div').length,speed:Game._frameInterval,decisionTicks:Game.decisionIntervalTicks,objective:Game.objective&&Game.objective.building};
  });
  await browser.close();
  if(!result.hasResources||!result.units||result.accepted!==2||!result.moved||!result.trained||!result.instructed||result.throttled||!result.fallback||result.logs<2||result.rendered<2||result.speed!==200||result.decisionTicks!==60||result.objective!=='NoSuchBuilding') throw new Error(JSON.stringify(result));
  console.log('PASS AI adapter',JSON.stringify(result));
})().catch(error=>{console.error('FAIL',error.message);process.exit(1);});
