#!/usr/bin/env node
/**
 * mock-server.js — P0.6
 *
 * Local mock WebSocket server that faithfully replicates the lockstep
 * protocol of the original GameRule/SC_server.js, so the fork can play
 * 2+ player games locally without the black-box nvhae.com:28082 server.
 *
 * Protocol (client<->server), identical to the original:
 *   server -> client : ping | start{team} | tick{tick,cmds} | notice{msg} | replay{replay}
 *   client -> server : pong | tick{tick,cmds} | login | chat | snapshot | replaySnapshot | log | getReplay
 *
 * Lockstep: the server advances its authoritative `room.tick` only when it is
 * behind the slowest client's reported tick; each client advances only when it
 * is behind the server's tick. (See GameRule/Multiplayer.js + Game.js animation loop.)
 *
 * Extensions over the original (clearly marked):
 *   - Server-side BOT seats: fill empty seats with a simple scripted bot so a
 *     single browser (human or headless) can start a game immediately.
 *   - HTTP GET /state : JSON snapshot of the room (debugging + LLM observation).
 *   - HTTP GET /health: liveness probe.
 *   - Configurable via env/args: PORT, PLAYERS (seats), BOTS (bot seats).
 *
 * Usage:
 *   node tools/mock-server.js                 # 2 seats, 0 bots (2 browsers)
 *   BOTS=1 node tools/mock-server.js          # 2 seats, 1 bot (1 browser vs bot)
 *   BOTS=2 node tools/mock-server.js          # 2 seats, 2 bots (bot vs bot)
 */
'use strict';
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.PORT || process.argv[2], 10) || 28083;
const PLAYERS = parseInt(process.env.PLAYERS, 10) || 2;   // total seats
const BOTS = parseInt(process.env.BOTS, 10) || 0;          // server-side bot seats
const TICK_INTERVAL = 100;                                  // ms, matches original
const NAMES = ['Tom', 'John', 'Steve', 'Mike', 'Cindy', 'Emile'];
const COLORS = ['yellow', 'orange', 'lime', 'aqua', 'violet', 'red'];

// ---------------------------------------------------------------------------
// Room state
// ---------------------------------------------------------------------------
let room = null;

function newRoom() {
  room = {
    id: 0,
    tick: 0,
    roomLag: 0,
    clientTicks: new Array(PLAYERS).fill(0),
    cmds: null,
    replay: {},
    // seats: array of {kind:'bot'|'client', ws?, team, name, color, bot?}
    seats: new Array(PLAYERS).fill(null),
    started: false,
    createdAt: Date.now()
  };
  // Pre-fill bot seats.
  for (let t = 0; t < PLAYERS; t++) {
    if (t < BOTS) {
      room.seats[t] = {
        kind: 'bot',
        team: t,
        name: 'Bot_' + t,
        color: COLORS[t % COLORS.length],
        bot: makeBot(t)
      };
    }
  }
  return room;
}

// ---------------------------------------------------------------------------
// Server-side bot: a minimal lockstep "seat filler".
//
// Its job is ONLY to keep the game running when there are fewer browser clients
// than seats: it reports ticks so it is never the lockstep bottleneck. It is NOT
// a real player (it has no unit IDs, so it can't issue meaningful commands).
// The actual "script player" / "LLM player" for the P0.4 spike is a HEADLESS
// BROWSER running the real game client (which has unit IDs and can act).
// ---------------------------------------------------------------------------
function makeBot(team) {
  const bot = {
    team,
    tickLag: 0,
    think() {
      // Keep up with the room so the bot never blocks lockstep.
      if (room) room.clientTicks[team] = Math.max(room.clientTicks[team], room.tick + 1);
    }
  };
  return bot;
}

// ---------------------------------------------------------------------------
// HTTP server (state + health) and WebSocket server
// ---------------------------------------------------------------------------
const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, port: PORT, players: PLAYERS, bots: BOTS }));
    return;
  }
  if (req.url === '/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      players: PLAYERS,
      bots: BOTS,
      started: room ? room.started : false,
      tick: room ? room.tick : 0,
      clientTicks: room ? room.clientTicks : [],
      seats: room ? room.seats.map((s, i) => s ? {
        team: i, kind: s.kind, name: s.name, color: s.color
      } : { team: i, kind: 'empty' }) : [],
      pendingCmds: room && room.cmds ? room.cmds.length : 0
    }, null, 2));
    return;
  }
  if (req.url === '/reset') {
    // Start a fresh room (clears current seats/game).
    if (room && room._timer) clearInterval(room._timer);
    newRoom();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, msg: 'room reset' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('StarCraft-AI mock server. Try /health or /state');
});
httpServer.listen(PORT, () => {
  newRoom(); // persistent room; clients join it
  console.log(`[mock-server] listening on :${PORT}`);
  console.log(`[mock-server] seats=${PLAYERS} bots=${BOTS} (browser clients=${PLAYERS - BOTS})`);
  console.log(`[mock-server] http://localhost:${PORT}/state  (JSON room state)`);
});

const wss = new WebSocketServer({ server: httpServer });

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function broadcast(obj) {
  if (!room) return;
  room.seats.forEach((s) => { if (s && s.kind === 'client') send(s.ws, obj); });
}

function log(...args) { console.log(new Date().toISOString().slice(11, 19), ...args); }

wss.on('connection', (ws) => {
  const ip = ws._socket.remoteAddress;
  log('client connected', ip);
  send(ws, { type: 'ping' });

  // Find the first empty (non-bot) seat in the persistent room.
  const team = room.seats.findIndex((s) => s === null);
  if (team === -1) {
    log('room full, rejecting', ip);
    send(ws, { type: 'notice', msg: 'Room full' });
    ws.close();
    return;
  }
  const name = NAMES[Math.floor(Math.random() * NAMES.length)];
  const color = COLORS[team % COLORS.length];
  room.seats[team] = { kind: 'client', ws, team, name, color };
  ws.room = room;
  ws.team = team;
  ws.tickLag = 0;
  log(`seat ${team} filled by ${name} (${color})`);

  // If all seats are now filled, start the game.
  if (room.seats.every((s) => s !== null)) startGame();

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch (e) { return; }
    handleMessage(ws, msg);
  });

  ws.on('close', () => {
    log('client closed', ip);
    if (!room || !room.seats[team]) return;
    // Mark seat empty; keep game running (clientTicks -> MAX so it stops blocking).
    room.clientTicks[team] = Number.MAX_VALUE;
    room.seats[team] = null;
    broadcast({ type: 'notice', msg: `${name} has left the game...` });
  });
});

function startGame() {
  if (room.started) return;
  room.started = true;
  room.tick = 0;
  room.clientTicks = new Array(PLAYERS).fill(0);
  room.cmds = null;
  room.replay = {};
  room.roomLag = 0;
  log('=== GAME START ===');
  // Tell each client its team and the first tick.
  room.seats.forEach((s, i) => {
    if (s && s.kind === 'client') {
      send(s.ws, { type: 'start', team: i });
      send(s.ws, { type: 'tick', tick: room.tick + room.roomLag });
    }
  });
  // Server ticking loop.
  if (room._timer) clearInterval(room._timer);
  room._timer = setInterval(tickLoop, TICK_INTERVAL);
}

function tickLoop() {
  if (!room || !room.started) return;
  // Bots think (report ticks + emit cmds).
  room.seats.forEach((s) => { if (s && s.kind === 'bot') s.bot.think(); });
  const minTick = Math.min.apply(null, room.clientTicks);
  if (room.tick < minTick) {
    room.tick++;
    const sendTick = room.tick + room.roomLag;
    room.seats.forEach((s) => { if (s && s.kind === 'client') send(s.ws, { type: 'tick', tick: sendTick, cmds: room.cmds }); });
    if (room.cmds) {
      room.replay[sendTick] = room.cmds;
      room.cmds = null;
    }
  }
}

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'pong':
      // Latency measurement (simplified: keep tickLag small for local play).
      if (ws.pingStart) {
        const latency = Date.now() - ws.pingStart;
        ws.tickLag = Math.max(0, Math.ceil(latency * 2 / 100));
        ws.pingStart = null;
      }
      // Keep pinging to measure (original pings 5x).
      ws.pingStart = Date.now();
      send(ws, { type: 'ping' });
      break;
    case 'tick': {
      if (!room || !room.seats[ws.team]) break;
      const clientTick = (msg.tick || 0) + ws.tickLag;
      room.clientTicks[ws.team] = clientTick;
      if (msg.cmds) {
        if (!room.cmds) room.cmds = [];
        room.cmds = room.cmds.concat(msg.cmds);
      }
      break;
    }
    case 'login':
      log(`login team=${msg.team} level=${msg.level} size=${msg.size && msg.size.x}x${msg.size && msg.size.y}`);
      break;
    case 'chat':
      broadcast({ type: 'notice', msg: `<span style="color:${COLORS[ws.team % COLORS.length]}">${room.seats[ws.team].name}: ${msg.msg}</span>` });
      break;
    case 'getReplay':
      send(ws, { type: 'replay', replay: room ? room.replay : {} });
      break;
    case 'snapshot':
      log(`snapshot#${msg.num} our=${msg.count && msg.count.ourUnits} enemy=${msg.count && msg.count.enemyUnits}`);
      break;
    case 'replaySnapshot':
      break;
    case 'log':
      log('client log:', msg.log);
      break;
    default:
      break;
  }
}
