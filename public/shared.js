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

  root.Fortress = { C, TANK_TYPES, rollTank, makeTerrain, groundAt, tankCenter, simulate, deform, damageFor };
})(typeof module !== 'undefined' ? module.exports : window);
