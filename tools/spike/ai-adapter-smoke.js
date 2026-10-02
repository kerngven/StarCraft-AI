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
    const groupAccepted=AIAdapter.enqueue([{type:'hold',groups:[observation.unitGroups[0].group]}],team);
    await new Promise(resolve=>setTimeout(resolve,3000));
    Cheat.cwal=false;
    const instructed=AICommander.injectInstruction(team,'Focus on economy'), throttled=AICommander.injectInstruction(team,'Ignore this'), rejected=AICommander.apply(team,[],'test');
    let requestBody, requests=0, originalFetch=window.fetch;
    window.fetch=(url,options)=>{requests++;requestBody=JSON.parse(options.body);return Promise.resolve({ok:true,status:200,json:()=>Promise.resolve({content:'[{"type":"no-op"}]'})});};
    AICommander.decide(team,{gatewayUrl:'http://gateway.test',base:'http://model.test/v1',model:'test',type:'local',maxTokens:64,temperature:0.2,topP:1});
    await new Promise(resolve=>setTimeout(resolve,20)); window.fetch=originalFetch;
    var state=AICommander.forTeam(team), aborted=false, manualAction={status:'running',rawContent:''}; state.pending=true; state.request={abort:function(){aborted=true;}}; AICommander.trackAction(team,manualAction); AICommander.render(team);
    const cancelEnabled=!!document.querySelector('button.command_ActionCancel'), cancelled=AICommander.cancelAction(team,manualAction.actionId), cancelRemoved=aborted; AICommander.finishAction(team,manualAction);
    for(let i=0;i<4;i++)AICommander.trackAction(team,{status:'completed',rawContent:'[]'}); AICommander.render(team);
    const latestActionTabs=[...document.querySelectorAll('.command_ActionSelect')].map(button=>button.textContent), actionPrevEnabled=!document.querySelector('.command_ActionPrev').disabled;
    document.querySelector('.command_ActionPrev').click(); const earlierActionTabs=[...document.querySelectorAll('.command_ActionSelect')].map(button=>button.textContent), actionNextEnabled=!document.querySelector('.command_ActionNext').disabled;
    Game.mainTick+=AICommander.MIN_INSTRUCTION_TICKS; const successful=AICommander.injectInstruction(team,'Successful order'); AICommander.log(team,'ai','AI 原始返回：[{"type":"move"}]'); AICommander.log(team,'executed','已映射并执行 1 个单位操作。'); AICommander.render(team);
    const historyCount=document.querySelectorAll('.command_LogEntries button').length; document.querySelector('[data-command-tab="errors"]').click(); const errorCount=document.querySelectorAll('.command_LogEntries button').length; document.querySelector('[data-command-tab="history"]').click();
    const firstLog=document.querySelector('.command_LogEntries button'); if(firstLog)firstLog.click();
    const detail=document.querySelector('.command_LogDetail').textContent;
    return {hasResources:!!observation.resources,units:observation.units.length,hasBattle:!!(observation.battle&&typeof observation.battle.underAttack==='boolean'),hasTacticalState:!!(observation.tacticalState&&observation.economy&&observation.economy.workers&&observation.unitGroups[0].hp),hasMapVision:!!(observation.map&&observation.map.grid&&observation.vision&&observation.vision.visibleCells instanceof Array&&observation.opportunities instanceof Array),hasCapabilities:!!(observation.commandGuide&&observation.commandGuide.capability&&observation.commandGuide.capability.production),hasGroups:!!(observation.unitGroups&&observation.unitGroups.length),hasStandardAction:!!(observation.commandGuide&&observation.commandGuide.actionTypes&&observation.commandGuide.actionTypes.patrol),accepted,groupAccepted,moved:worker.x!==before.x||worker.y!==before.y,trained:Unit.allOurUnits().length>count,instructed,successful,throttled,rejected,requests,hasInstruction:requestBody&&requestBody.observation.instruction==='Focus on economy',hasLiveBattleInRequest:requestBody&&requestBody.observation.battle&&typeof requestBody.observation.battle.visibleEnemyCount==='number',cancelEnabled,cancelled,aborted,cancelRemoved,latestActionTabs,earlierActionTabs,actionPrevEnabled,actionNextEnabled,historyCount,errorCount,logs:AICommander.forTeam(team).logs.length,rendered:document.querySelectorAll('.command_LogEntries button').length,logExpanded:!document.querySelector('.command_LogDetail').hidden,detailHasHuman:detail.indexOf('Successful order')>=0,detailHasAI:detail.indexOf('AI 原始返回')>=0,scrollbar:getComputedStyle(document.querySelector('.command_LogEntries')).overflowY==='scroll',speed:Game._frameInterval,decisionTicks:Game.decisionIntervalTicks,objective:Game.objective&&Game.objective.building};
  });
  await browser.close();
  if(!result.hasResources||!result.units||!result.hasBattle||!result.hasTacticalState||!result.hasMapVision||!result.hasCapabilities||!result.hasGroups||!result.hasStandardAction||result.accepted!==2||result.groupAccepted!==1||!result.moved||!result.trained||!result.instructed||!result.successful||result.throttled||result.rejected!==0||result.requests!==1||!result.hasInstruction||!result.hasLiveBattleInRequest||!result.cancelEnabled||!result.cancelled||!result.aborted||!result.cancelRemoved||result.latestActionTabs.length!==3||result.latestActionTabs[0]!=='指令 4 · 请求中'||result.latestActionTabs[2]!=='指令 6 · 请求中'||result.earlierActionTabs[0]!=='指令 3 · 请求中'||!result.actionPrevEnabled||!result.actionNextEnabled||result.historyCount!==1||result.errorCount<1||result.logs<2||result.rendered!==1||!result.logExpanded||!result.detailHasHuman||!result.detailHasAI||!result.scrollbar||result.speed!==200||result.decisionTicks!==60||result.objective!=='NoSuchBuilding') throw new Error(JSON.stringify(result));
  console.log('PASS AI adapter',JSON.stringify(result));
})().catch(error=>{console.error('FAIL',error.message);process.exit(1);});
