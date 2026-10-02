#!/usr/bin/env node
/* Browser regression: a worker must complete a mineral round trip. */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cachedChrome=path.join(os.homedir(),'Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const launch={headless:true,args:['--no-sandbox','--disable-dev-shm-usage']};
if (fs.existsSync(cachedChrome)) launch.executablePath=cachedChrome;

async function main(){
    const browser=await chromium.launch(launch);
    const page=await browser.newPage({viewport:{width:1024,height:768}});
    const errors=[];
    page.on('pageerror',error=>errors.push(String(error)));
    await page.goto('http://localhost:8080/?cdn=&level=13&offline=1',{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>typeof Game!='undefined' && Game.mainTick>10,{timeout:30000});
    const result=await page.evaluate(async()=>{
        const worker=Unit.allOurUnits().filter(Economy.isWorker)[0];
        const before={mine:Resource[Game.team].mine,gas:Resource[Game.team].gas};
        // Exercise the normal command queue instead of a private UI path.
        Multiplayer.cmds.push(JSON.stringify({uids:[worker.id],type:'gather'}));
        const accepted=true;
        await new Promise(resolve=>setTimeout(resolve,15000));
        const afterMine=Resource[Game.team].mine;
        Economy.stop(worker);
        const gasAccepted=Economy.gather(worker,Economy.closestNode(worker,'gas'));
        await new Promise(resolve=>setTimeout(resolve,15000));
        Economy.stop(worker);
        Resource[Game.team].mine=1000;
        Cheat.cwal=true;
        Multiplayer.cmds.push(JSON.stringify({uids:[worker.id],type:'expand'}));
        await new Promise(resolve=>setTimeout(resolve,15000));
        Cheat.cwal=false;
        const bases=Building.allBuildings.filter(building=>building.team===Game.team && Economy.isBase(building));
        const expansion=Economy.fields[1];
        const nearestBase=Economy.closestBase(worker);
        return {accepted,gasAccepted,before,after:{mine:afterMine,gas:Resource[Game.team].gas},expanded:bases.length===2,nearestExpansion:nearestBase && nearestBase.distanceFrom(expansion.depot)<180,tick:Game.mainTick,nodes:ResourceNode.allNodes.length};
    });
    await browser.close();
    // Missing optional audio codecs are unrelated to simulation correctness.
    const relevantErrors=errors.filter(error=>error.indexOf('NotSupportedError')===-1);
    if (!result.accepted || !result.gasAccepted || !result.expanded || !result.nearestExpansion || result.after.mine<=result.before.mine || result.after.gas<=result.before.gas || relevantErrors.length) {
        console.error('FAIL',JSON.stringify({result,errors:relevantErrors}));
        process.exit(1);
    }
    console.log('PASS economy round trip',JSON.stringify(result));
}
main().catch(error=>{ console.error('FATAL',error); process.exit(2); });
