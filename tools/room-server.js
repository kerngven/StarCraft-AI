#!/usr/bin/env node
/*
 * P2 room server.  It speaks the legacy lockstep protocol while keeping room
 * state server-owned: ws://host:28084/?room=demo&players=2&bots=1
 * Add spectator=1 for a non-playing connection, and reconnect=<token> to
 * reclaim a disconnected player seat before its grace period expires.
 */
'use strict';
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || process.argv[2] || 28084);
const TICK_MS = 100;
const RECONNECT_MS = 30_000;
const rooms = new Map();
const send = (ws, value) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(value)); };

function integer(value, fallback, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}
function createRoom(id, query) {
  const players = integer(query.get('players'), 2, 2, 4);
  const bots = integer(query.get('bots'), 0, 0, players);
  const room = { id, players, bots, tick: 0, lag: 2, started: false, cmds: null, replay: {}, spectators: new Set(),
    seats: Array.from({ length: players }, (_, team) => team < bots ? { team, kind: 'ai', token: 'ai-' + team, tick: 0 } : null) };
  rooms.set(id, room);
  return room;
}
function roomState(room) {
  return { id: room.id, players: room.players, bots: room.bots, started: room.started, tick: room.tick,
    seats: room.seats.map((seat, team) => seat ? { team, kind: seat.kind, connected: !!seat.ws, reconnecting: !!seat.until } : { team, kind: 'empty' }),
    spectators: room.spectators.size };
}
function begin(room) {
  if (room.started || room.seats.some(seat => !seat)) return;
  room.started = true; room.tick = 0; room.cmds = null; room.replay = {};
  room.seats.forEach(seat => { seat.tick = 0; if (seat.ws) { send(seat.ws, { type: 'start', team: seat.team }); send(seat.ws, { type: 'tick', tick: room.lag }); } });
  room.spectators.forEach(ws => send(ws, { type: 'notice', msg: 'Spectating room ' + room.id }));
}
function broadcast(room, message) {
  room.seats.forEach(seat => { if (seat && seat.ws) send(seat.ws, message); });
  room.spectators.forEach(ws => send(ws, message));
}
function joinPlayer(room, ws, reconnectToken) {
  let seat = reconnectToken && room.seats.find(candidate => candidate && candidate.token === reconnectToken && candidate.until > Date.now());
  if (seat) { clearTimeout(seat.timer); delete seat.until; delete seat.timer; seat.ws = ws; }
  else {
    const team = room.seats.findIndex(candidate => candidate === null);
    if (team < 0) return null;
    seat = { team, kind: 'player', token: crypto.randomUUID(), tick: 0, ws };
    room.seats[team] = seat;
  }
  ws.room = room; ws.seat = seat;
  send(ws, { type: 'notice', msg: 'Seat ' + seat.team + ' ready. Reconnect token: ' + seat.token });
  if (room.started) { send(ws, { type: 'start', team: seat.team }); send(ws, { type: 'tick', tick: room.tick + room.lag }); }
  else begin(room);
  return seat;
}
function leavePlayer(ws) {
  const room = ws.room, seat = ws.seat;
  if (!room || !seat || seat.ws !== ws) return;
  delete seat.ws; seat.until = Date.now() + RECONNECT_MS; seat.tick = Number.MAX_VALUE;
  seat.timer = setTimeout(() => { if (!seat.ws && room.seats[seat.team] === seat) room.seats[seat.team] = null; }, RECONNECT_MS);
  broadcast(room, { type: 'notice', msg: 'Player ' + seat.team + ' disconnected; seat held for 30 seconds.' });
}
setInterval(() => {
  rooms.forEach(room => {
    if (!room.started) return;
    room.seats.forEach(seat => { if (seat && seat.kind === 'ai') seat.tick = room.tick + 1; });
    if (room.tick >= Math.min.apply(null, room.seats.map(seat => seat ? seat.tick : -1))) return;
    room.tick++;
    const message = { type: 'tick', tick: room.tick + room.lag, cmds: room.cmds };
    broadcast(room, message);
    if (room.cmds) { room.replay[message.tick] = room.cmds; room.cmds = null; }
  });
}, TICK_MS);

const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, rooms: rooms.size })); }
  if (req.url === '/rooms') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify([...rooms.values()].map(roomState))); }
  res.writeHead(404); res.end('Use /health or /rooms');
});
const wss = new WebSocketServer({ server });
wss.on('connection', (ws, request) => {
  const query = new URL(request.url, 'http://localhost').searchParams;
  const room = rooms.get(query.get('room') || 'default') || createRoom(query.get('room') || 'default', query);
  send(ws, { type: 'ping' });
  if (query.get('spectator') === '1') {
    room.spectators.add(ws); ws.spectatorRoom = room; send(ws, { type: 'notice', msg: 'Spectator connected.' });
    if (room.started) { send(ws, { type: 'start', team: 0 }); send(ws, { type: 'tick', tick: room.tick + room.lag }); }
  }
  else if (!joinPlayer(room, ws, query.get('reconnect'))) { send(ws, { type: 'notice', msg: 'Room full.' }); ws.close(); return; }
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch (_) { return; }
    if (msg.type === 'pong') return send(ws, { type: 'ping' });
    if (msg.type === 'tick' && ws.seat) { ws.seat.tick = Number(msg.tick) || 0; if (msg.cmds) ws.room.cmds = (ws.room.cmds || []).concat(msg.cmds); }
    if (msg.type === 'chat' && ws.room && ws.seat) broadcast(ws.room, { type: 'notice', msg: 'P' + ws.seat.team + ': ' + String(msg.msg).slice(0, 500) });
    if (msg.type === 'getReplay' && ws.room) send(ws, { type: 'replay', replay: ws.room.replay });
  });
  ws.on('close', () => { if (ws.spectatorRoom) ws.spectatorRoom.spectators.delete(ws); leavePlayer(ws); });
});
server.listen(PORT, () => console.log('[room-server] ws://localhost:' + PORT + '/?room=demo&players=2&bots=1'));
