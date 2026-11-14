const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Fortress } = require('./public/shared.js');
const { C } = Fortress;

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

function getRoom(name) {
  if (!rooms.has(name)) rooms.set(name, { name, players: [null, null], phase: 'waiting', timer: null, flyTimer: null });
  return rooms.get(name);
}

function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(room, msg) { room.players.forEach(p => p && send(p.ws, msg)); }

function clearTimers(room) {
  clearTimeout(room.timer); clearTimeout(room.flyTimer);
  room.timer = room.flyTimer = null;
}

function startGame(room) {
  clearTimers(room);
  room.heights = Fortress.makeTerrain();
  const t0 = Fortress.rollTank(-1);
  const t1 = Fortress.rollTank(t0.type);
  room.state = {
    tanks: [
      { ...t0, x: C.START_X[0], hp: 100, dir: 1, angle: 45, nick: room.players[0].nick },
      { ...t1, x: C.START_X[1], hp: 100, dir: -1, angle: 45, nick: room.players[1].nick },
    ],
    turn: Math.random() < 0.5 ? 0 : 1,
  };
  room.players.forEach((p, i) => send(p.ws, { t: 'start', you: i, heights: room.heights, tanks: room.state.tanks }));
  beginTurn(room);
}

function beginTurn(room) {
  room.phase = 'aiming';
  room.turnEndsAt = Date.now() + C.TURN_SEC * 1000;
  broadcast(room, { t: 'turn', turn: room.state.turn, ms: C.TURN_SEC * 1000 });
  clearTimeout(room.timer);
  room.timer = setTimeout(() => {
    if (room.phase !== 'aiming') return;
    broadcast(room, { t: 'timeout', turn: room.state.turn });
    room.state.turn = 1 - room.state.turn;
    beginTurn(room);
  }, C.TURN_SEC * 1000 + 300);
}

function fire(room, idx, angle, power) {
  const st = room.state;
  if (room.phase !== 'aiming' || st.turn !== idx) return;
  clearTimeout(room.timer);
  room.phase = 'flying';
  angle = Math.max(0, Math.min(90, Number(angle) || 0));
  power = Math.max(0, Math.min(100, Number(power) || 0));
  const me = st.tanks[idx];
  me.angle = angle;
  const xs = st.tanks.map(t => t.x);
  const sim = Fortress.simulate(room.heights, me.x, me.dir, angle, power, xs, idx);
  const hit = sim.hit;
  const damages = [0, 0];
  if (hit.type !== 'out') {
    st.tanks.forEach((t, i) => {
      const c = Fortress.tankCenter(room.heights, t.x);
      const direct = hit.type === 'tank' && hit.tank === i;
      const d = Fortress.damageFor(me.atk, t.def, Math.hypot(c.x - hit.x, c.y - hit.y), direct);
      damages[i] = d;
      t.hp = Math.max(0, t.hp - d);
    });
    Fortress.deform(room.heights, hit.x, hit.y, C.CRATER_R);
  }
  broadcast(room, {
    t: 'shot', shooter: idx, angle, power, hit, damages,
    hp: st.tanks.map(t => t.hp), heights: room.heights,
  });
  const flyMs = sim.pts.length * C.DT * 1000 + 1800;
  room.flyTimer = setTimeout(() => {
    const dead = st.tanks.map(t => t.hp <= 0);
    if (dead[0] || dead[1]) {
      room.phase = 'over';
      const winner = dead[0] && dead[1] ? -1 : (dead[0] ? 1 : 0);
      broadcast(room, { t: 'over', winner });
      return;
    }
    st.turn = 1 - st.turn;
    beginTurn(room);
  }, flyMs);
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const roomName = (url.searchParams.get('room') || 'main').slice(0, 30);
  const nick = (url.searchParams.get('nick') || '').slice(0, 12);
  const room = getRoom(roomName);
  const slot = room.players.findIndex(p => p === null);
  if (slot === -1) {
    send(ws, { t: 'full' });
    ws.close();
    return;
  }
  room.players[slot] = { ws, nick: nick || `플레이어${slot + 1}` };
  const count = room.players.filter(Boolean).length;
  if (count < 2) {
    send(ws, { t: 'waiting' });
  } else {
    startGame(room);
  }

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const idx = room.players.findIndex(p => p && p.ws === ws);
    if (idx < 0) return;
    if (m.t === 'aim' && room.phase === 'aiming' && room.state.turn === idx) {
      room.state.tanks[idx].angle = Math.max(0, Math.min(90, Number(m.angle) || 0));
      const other = room.players[1 - idx];
      if (other) send(other.ws, { t: 'aim', who: idx, angle: room.state.tanks[idx].angle, power: Number(m.power) || 0 });
    } else if (m.t === 'fire') {
      fire(room, idx, m.angle, m.power);
    } else if (m.t === 'restart' && room.phase === 'over' && room.players.every(Boolean)) {
      startGame(room);
    }
  });

  ws.on('close', () => {
    const idx = room.players.findIndex(p => p && p.ws === ws);
    if (idx < 0) return;
    room.players[idx] = null;
    clearTimers(room);
    room.phase = 'waiting';
    const other = room.players[1 - idx];
    if (other) {
      send(other.ws, { t: 'left' });
    } else {
      rooms.delete(room.name);
    }
  });
});

// 끊긴 연결 정리
setInterval(() => wss.clients.forEach(ws => { if (ws.isAlive === false) return ws.terminate(); ws.isAlive = false; ws.ping(); }), 30000);
wss.on('connection', ws => { ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; }); });

server.listen(PORT, () => console.log(`포트리스 서버 실행 중: http://localhost:${PORT}`));
