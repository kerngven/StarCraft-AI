#!/usr/bin/env node
'use strict';
const { spawn } = require('child_process');
const { WebSocket } = require('ws');
const http = require('http');
const path = require('path');
const port = 28184;
const child = spawn(process.execPath, [path.join(__dirname, 'room-server.js'), String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url); const messages = [];
    const timer = setTimeout(() => reject(new Error('Timed out: ' + url)), 5000);
    ws.on('message', raw => { const message = JSON.parse(raw); messages.push(message); if (message.type === 'ping') ws.send(JSON.stringify({ type: 'pong' })); if (message.type === 'start') { clearTimeout(timer); resolve({ ws, messages }); } });
    ws.on('error', reject);
  });
}
async function json(url) { return new Promise((resolve, reject) => http.get(url, response => { let body=''; response.on('data', part => body += part); response.on('end', () => resolve(JSON.parse(body))); }).on('error', reject)); }
async function main() {
  await new Promise((resolve, reject) => { child.stdout.on('data', data => String(data).includes('room-server') && resolve()); child.once('error', reject); });
  const first = await connect('ws://localhost:' + port + '/?room=alpha&players=2&bots=1');
  const token = first.messages.find(message => message.type === 'notice').msg.match(/Reconnect token: ([\w-]+)/)[1];
  first.ws.close(); await wait(100);
  const second = await connect('ws://localhost:' + port + '/?room=alpha&players=2&bots=1&reconnect=' + token);
  const spectator = await connect('ws://localhost:' + port + '/?room=alpha&spectator=1');
  const state = await json('http://localhost:' + port + '/rooms');
  second.ws.close(); spectator.ws.close();
  if (!state.length || !state[0].started || state[0].bots !== 1 || state[0].spectators !== 1 || state[0].seats.filter(seat => seat.kind === 'player').length !== 1) throw new Error('Unexpected room state: ' + JSON.stringify(state));
  console.log('PASS room server', JSON.stringify(state[0]));
}
main().catch(error => { console.error('FAIL', error.message); process.exitCode = 1; }).finally(() => child.kill());
