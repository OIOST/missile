const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Fortress } = require('./public/shared.js');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map();

function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

function getRoom(name) {
  if (!rooms.has(name)) {
    const room = { name, players: [null, null] };
    room.game = new Fortress.Game((slot, msg) => send(room.players[slot] && room.players[slot].ws, msg));
    rooms.set(name, room);
  }
  return rooms.get(name);
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const roomName = (url.searchParams.get('room') || 'main').slice(0, 30);
  const nick = (url.searchParams.get('nick') || '').slice(0, 12);
  const room = getRoom(roomName);
  const slot = room.players.findIndex(p => p === null);
  if (slot === -1) { send(ws, { t: 'full' }); ws.close(); return; }
  room.players[slot] = { ws, nick: nick || `플레이어${slot + 1}` };
  if (room.players.every(Boolean)) room.game.start(room.players.map(p => p.nick));
  else send(ws, { t: 'waiting' });

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const idx = room.players.findIndex(p => p && p.ws === ws);
    if (idx >= 0 && room.players.every(Boolean)) room.game.handle(idx, m);
  });

  ws.on('close', () => {
    const idx = room.players.findIndex(p => p && p.ws === ws);
    if (idx < 0) return;
    room.players[idx] = null;
    room.game.stop();
    const other = room.players[1 - idx];
    if (other) send(other.ws, { t: 'left' });
    else rooms.delete(room.name);
  });
});

// 끊긴 연결 정리
setInterval(() => wss.clients.forEach(ws => { if (ws.isAlive === false) return ws.terminate(); ws.isAlive = false; ws.ping(); }), 30000);
wss.on('connection', ws => { ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; }); });

server.listen(PORT, () => console.log(`포트리스 서버 실행 중: http://localhost:${PORT}`));
