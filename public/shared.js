// 서버(Node)와 브라우저가 함께 쓰는 게임 규칙/물리 코드
(function (root) {
  const C = {
    VIEW_W: 400,          // 화면 한 장의 가로 폭(월드 단위)
    WORLD_W: 4000,        // 화면 10배 거리
    SEG: 10,              // 지형 높이 샘플 간격
    G: 380,               // 중력 가속도
    VMAX: 1450,           // 파워 100일 때 초기 속도
    BARREL: 26,           // 포신 길이
    TANK_HIT_R: 24,       // 탱크 피격 판정 반경
    BLAST_R: 75,          // 폭발 피해 반경
    CRATER_R: 38,         // 지형 파임 반경
    DT: 1 / 60,
    TURN_SEC: 30,
    START_X: [300, 3700],
  };

  const TANK_TYPES = [
    { name: '번개 탱크', color: '#f5b700', atk: [32, 42], def: [4, 12] },
    { name: '거북 탱크', color: '#3fa34d', atk: [22, 30], def: [20, 30] },
    { name: '불꽃 탱크', color: '#e4572e', atk: [36, 46], def: [0, 8] },
    { name: '얼음 탱크', color: '#4ea8de', atk: [27, 35], def: [12, 20] },
    { name: '바위 탱크', color: '#8d6e63', atk: [25, 33], def: [16, 25] },
    { name: '별빛 탱크', color: '#b36ee8', atk: [29, 38], def: [8, 16] },
  ];

  function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

  function rollTank(excludeIdx) {
    let idx;
    do { idx = Math.floor(Math.random() * TANK_TYPES.length); } while (idx === excludeIdx);
    const t = TANK_TYPES[idx];
    return { type: idx, name: t.name, color: t.color, atk: randInt(t.atk[0], t.atk[1]), def: randInt(t.def[0], t.def[1]) };
  }

  function makeTerrain() {
    const n = Math.floor(C.WORLD_W / C.SEG) + 1;
    const waves = [];
    for (let i = 0; i < 5; i++) {
      waves.push({ a: 20 + Math.random() * 70, f: (0.5 + Math.random() * 4) * Math.PI * 2 / C.WORLD_W, p: Math.random() * 7 });
    }
    const h = [];
    for (let i = 0; i < n; i++) {
      const x = i * C.SEG;
      let y = 260;
      for (const w of waves) y += w.a * Math.sin(x * w.f + w.p);
      h.push(Math.round(Math.max(80, y)));
    }
    // 탱크 자리는 평평하게
    for (const sx of C.START_X) {
      const ci = Math.round(sx / C.SEG);
      const base = h[ci];
      for (let k = -4; k <= 4; k++) h[ci + k] = base;
    }
    return h;
  }

  function groundAt(h, x) {
    const f = x / C.SEG;
    let i = Math.floor(f);
    if (i < 0) return h[0];
    if (i >= h.length - 1) return h[h.length - 1];
    const t = f - i;
    return h[i] * (1 - t) + h[i + 1] * t;
  }

  function tankCenter(h, x) { return { x, y: groundAt(h, x) + 12 }; }

  // dir: +1 이면 오른쪽, -1 이면 왼쪽을 바라봄
  function simulate(h, shooterX, dir, angleDeg, power, tankXs, shooterIdx) {
    const rad = angleDeg * Math.PI / 180;
    const v = C.VMAX * Math.max(0, Math.min(100, power)) / 100;
    const c = tankCenter(h, shooterX);
    let x = c.x + Math.cos(rad) * C.BARREL * dir;
    let y = c.y + 4 + Math.sin(rad) * C.BARREL;
    let vx = Math.cos(rad) * v * dir;
    let vy = Math.sin(rad) * v;
    const pts = [[x, y]];
    let hit = null;
    for (let step = 0; step < 60 * 40; step++) {
      vy -= C.G * C.DT;
      x += vx * C.DT;
      y += vy * C.DT;
      pts.push([x, y]);
      if (x < -300 || x > C.WORLD_W + 300 || y < -200) { hit = { x, y, type: 'out' }; break; }
      for (let i = 0; i < tankXs.length; i++) {
        if (i === shooterIdx && step < 12) continue;
        const tc = tankCenter(h, tankXs[i]);
        if (Math.hypot(x - tc.x, y - tc.y) < C.TANK_HIT_R) { hit = { x, y, type: 'tank', tank: i }; break; }
      }
      if (hit) break;
      if (x >= 0 && x <= C.WORLD_W && y <= groundAt(h, x)) {
        hit = { x, y: groundAt(h, x), type: 'ground' }; break;
      }
    }
    if (!hit) hit = { x, y, type: 'out' };
    return { pts, hit };
  }

  function deform(h, x, y, r) {
    for (let i = 0; i < h.length; i++) {
      const dx = i * C.SEG - x;
      if (Math.abs(dx) >= r) continue;
      const bottom = y - Math.sqrt(r * r - dx * dx);
      if (h[i] > bottom) h[i] = Math.max(30, Math.round(bottom));
    }
  }

  // 공격자 공격력, 피격자 방어력, 폭발 지점과의 거리로 피해 계산
  function damageFor(atk, def, dist, direct) {
    if (!direct && dist >= C.BLAST_R) return 0;
    const fall = direct ? 1 : Math.max(0, 1 - dist / C.BLAST_R) * 0.85;
    return Math.max(1, Math.round(atk * fall * (1 - def / 60)));
  }


  // 한 판의 진행(턴/타이머/피해). send(slot, msg) 로 각 플레이어에게 메시지를 보냄.
  // Node 서버와 브라우저(방장 기기) 양쪽에서 같은 코드로 돌아감.
  class Game {
    constructor(send) { this.send = send; this.phase = 'waiting'; this.timer = null; this.flyTimer = null; }
    bcast(m) { this.send(0, m); this.send(1, m); }
    stop() { clearTimeout(this.timer); clearTimeout(this.flyTimer); this.timer = this.flyTimer = null; this.phase = 'waiting'; }
    start(nicks) {
      this.stop();
      this.heights = makeTerrain();
      const t0 = rollTank(-1), t1 = rollTank(t0.type);
      this.tanks = [
        Object.assign({}, t0, { x: C.START_X[0], hp: 100, dir: 1, angle: 45, nick: nicks[0] || '플레이어1' }),
        Object.assign({}, t1, { x: C.START_X[1], hp: 100, dir: -1, angle: 45, nick: nicks[1] || '플레이어2' }),
      ];
      this.turn = Math.random() < 0.5 ? 0 : 1;
      for (let i = 0; i < 2; i++) this.send(i, this.startMsg(i));
      this.beginTurn();
    }
    startMsg(i) { return { t: 'start', you: i, heights: this.heights, tanks: this.tanks }; }
    turnMsg() {
      return { t: 'turn', turn: this.turn, ms: Math.max(0, this.turnEndsAt - Date.now()), hp: this.tanks.map(t => t.hp) };
    }
    beginTurn() {
      this.phase = 'aiming';
      this.turnEndsAt = Date.now() + C.TURN_SEC * 1000;
      this.bcast(this.turnMsg());
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        if (this.phase !== 'aiming') return;
        this.bcast({ t: 'timeout', turn: this.turn });
        this.turn = 1 - this.turn;
        this.beginTurn();
      }, C.TURN_SEC * 1000 + 300);
    }
    // 다시 접속하거나 메시지를 놓친 사람에게 현재 상황 전체를 다시 보냄
    resync(i) {
      if (!this.tanks || this.phase === 'waiting') return;
      this.send(i, this.startMsg(i));
      if (this.phase === 'aiming') this.send(i, this.turnMsg());
    }
    handle(idx, m) {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'aim' && this.phase === 'aiming' && this.turn === idx) {
        this.tanks[idx].angle = Math.max(0, Math.min(90, Number(m.angle) || 0));
        this.send(1 - idx, { t: 'aim', who: idx, angle: this.tanks[idx].angle, power: Number(m.power) || 0 });
      } else if (m.t === 'fire') {
        this.fire(idx, m.angle, m.power);
      } else if (m.t === 'restart' && this.phase === 'over') {
        this.start(this.tanks.map(t => t.nick));
      } else if (m.t === 'sync') {
        this.resync(idx);
      }
    }
    fire(idx, angle, power) {
      if (this.phase !== 'aiming' || this.turn !== idx) return;
      clearTimeout(this.timer);
      this.phase = 'flying';
      angle = Math.max(0, Math.min(90, Number(angle) || 0));
      power = Math.max(0, Math.min(100, Number(power) || 0));
      const me = this.tanks[idx];
      me.angle = angle;
      const sim = simulate(this.heights, me.x, me.dir, angle, power, this.tanks.map(t => t.x), idx);
      const hit = sim.hit;
      const damages = [0, 0];
      if (hit.type !== 'out') {
        this.tanks.forEach((t, i) => {
          const c = tankCenter(this.heights, t.x);
          const d = damageFor(me.atk, t.def, Math.hypot(c.x - hit.x, c.y - hit.y), hit.type === 'tank' && hit.tank === i);
          damages[i] = d;
          t.hp = Math.max(0, t.hp - d);
        });
      }
      if (hit.type !== 'out') deform(this.heights, hit.x, hit.y, C.CRATER_R);
      this.bcast({ t: 'shot', shooter: idx, angle, power, hit, damages, hp: this.tanks.map(t => t.hp), heights: this.heights });
      const flyMs = sim.pts.length * C.DT * 1000 + 1800;
      this.flyTimer = setTimeout(() => {
        const dead = this.tanks.map(t => t.hp <= 0);
        if (dead[0] || dead[1]) {
          this.phase = 'over';
          this.bcast({ t: 'over', winner: dead[0] && dead[1] ? -1 : (dead[0] ? 1 : 0) });
          return;
        }
        this.turn = 1 - this.turn;
        this.beginTurn();
      }, flyMs);
    }
  }

  root.Fortress = { C, TANK_TYPES, rollTank, makeTerrain, groundAt, tankCenter, simulate, deform, damageFor, Game };
})(typeof module !== 'undefined' ? module.exports : window);
