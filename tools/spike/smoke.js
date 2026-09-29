#!/usr/bin/env node
/**
 * smoke.js — P0.4 spike: Playwright headless smoke test
 *
 * Verifies the full control path:
 *   1. Launch local chromium (not Browserbase remote)
 *   2. Load the game (level 2, multiplayer, local mock server, CDN assets)
 *   3. Read game observation state from the page
 *   4. Inject a command (move all our units to a target)
 *   5. Verify units actually moved
 *
 * Usage: node tools/spike/smoke.js
 */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const os = require('os');

// Use the already-cached Chromium (Hermes browser tool's build) to avoid a
// fresh download. Fall back to the bundled browser if the cache is missing.
const CACHED_CHROME = path.join(
  os.homedir(), 'Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
);
const fs = require('fs');
const LAUNCH_OPTS = {
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
};
if (fs.existsSync(CACHED_CHROME)) LAUNCH_OPTS.executablePath = CACHED_CHROME;

const URL = 'http://localhost:8080/?cdn=http://www.nvhae.com/starcraft&serverUrl=ws://localhost:28083&level=2&confirm=1';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const browser = await chromium.launch(LAUNCH_OPTS);
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  console.log('[1] navigating to', URL);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for the game to boot (multiplayer start + first ticks).
  console.log('[2] waiting for game boot...');
  let booted = false;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const st = await page.evaluate(() => ({
      hasGame: typeof Game !== 'undefined',
      mp: typeof Multiplayer !== 'undefined' ? Multiplayer.ON : null,
      tick: typeof Game !== 'undefined' ? Game.mainTick : null
    })).catch(() => null);
    if (st && st.hasGame && st.mp === true && st.tick > 5) { booted = true; break; }
  }
  if (!booted) {
    console.log('FAIL: game did not boot in 30s');
    const dbg = await page.evaluate(() => ({
      url: location.href, hasGame: typeof Game, hasUnit: typeof Unit
    })).catch(() => null);
    console.log('debug:', JSON.stringify(dbg));
    console.log('errors:', errors.slice(0, 5));
    await browser.close();
    process.exit(1);
  }
  console.log('[2] game booted');

  // [3] Read observation.
  const obs = await page.evaluate(() => {
    const t = Game.team, r = Resource[t];
    const our = Unit.allOurUnits(), enemy = Unit.allEnemyUnits();
    const s = (u) => ({ id: u.id, name: u.name, x: Math.round(u.posX()), y: Math.round(u.posY()), hp: u.life, flying: !!u.isFlying, atk: !!u.attack });
    return {
      team: t, race: Game.race.selected, tick: Game.mainTick,
      resource: { mine: r.mine, gas: r.gas, man: r.man, totalMan: r.totalMan },
      our: our.map(s), enemy: enemy.map(s)
    };
  });
  console.log('[3] observation: team=' + obs.team + ' race=' + obs.race + ' tick=' + obs.tick +
    ' our=' + obs.our.length + ' enemy=' + obs.enemy.length + ' mine=' + obs.resource.mine);
  console.log('    our units:', JSON.stringify(obs.our.slice(0, 5)));
  console.log('    enemy units:', JSON.stringify(obs.enemy.slice(0, 5)));

  // [4] Inject a command: move ALL our units to a target position.
  // Target: a point in the middle of the map (away from our spawn).
  const target = { x: 500, y: 300 };
  const before = obs.our.map(u => ({ id: u.id, x: u.x, y: u.y }));
  await page.evaluate((t) => {
    const uids = Unit.allOurUnits().map(u => u.id);
    Multiplayer.cmds.push(JSON.stringify({
      uids, type: 'rightClick', pos: { x: t.x, y: t.y }, unlock: false, btn: 'move'
    }));
  }, target);
  console.log('[4] injected move command for ' + before.length + ' units -> ' + JSON.stringify(target));

  // [5] Wait for units to move, then verify.
  await sleep(4000);
  const after = await page.evaluate(() => {
    const t = Game.team;
    return Unit.allOurUnits().map(u => ({ id: u.id, x: Math.round(u.posX()), y: Math.round(u.posY()) }));
  });
  let moved = 0;
  after.forEach((a) => {
    const b = before.find((x) => x.id === a.id);
    if (b && (Math.abs(a.x - b.x) > 5 || Math.abs(a.y - b.y) > 5)) moved++;
  });
  const tickNow = await page.evaluate(() => Game.mainTick);
  console.log('[5] after 4s: tick=' + tickNow + ' unitsMoved=' + moved + '/' + before.length);
  console.log('    before:', JSON.stringify(before.slice(0, 5)));
  console.log('    after :', JSON.stringify(after.slice(0, 5)));

  const ok = booted && moved > 0;
  console.log('');
  console.log(ok ? 'PASS: full control path works (observe -> inject -> units moved)' : 'FAIL');
  if (errors.length) console.log('console errors:', errors.slice(0, 5));

  await browser.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
