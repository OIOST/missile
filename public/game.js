(() => {
  const F = window.Fortress;
  const C = F.C;
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const stage = document.getElementById('stage');
  const overlay = document.getElementById('overlay');
  const card = document.getElementById('card');
  const fireBtn = document.getElementById('fireBtn');
  const gaugeFill = document.getElementById('gaugeFill');
  const gaugeText = document.getElementById('gaugeText');
  const gaugeLast = document.getElementById('gaugeLast');

  let W = 0, H = 0, S = 1, DPR = 1;
  const MINI = { x: 10, y: 10, h: 56 };
  MINI.w = () => W - 20;

  // ---------- 상태 ----------
  let ws = null;
  let me = -1;
  let heights = null;
  let tanks = null;
  let turn = -1;
  let phase = 'lobby';           // lobby | waiting | aiming | flying | over
  let turnEnd = 0;
  let myAngle = 45;
  let charging = false, chargeStart = 0, power = 0;
  let lastPower = null;
  let enemyPower = 0;
  let anim = null;               // 날아가는 미사일
  let booms = [];                // 폭발 효과
  let floats = [];               // 떠오르는 글자
  let banner = null;             // 화면 중앙 알림
  const cam = { x: 0, y: 0 };
  let peekUntil = 0, peekX = 0;
  let lastAimSent = 0;
  let clouds = Array.from({ length: 30 }, () => ({ x: Math.random() * C.WORLD_W, y: 450 + Math.random() * 900, r: 20 + Math.random() * 30 }));

  // ---------- 화면 크기 ----------
  function resize() {
    const r = stage.getBoundingClientRect();
    W = r.width; H = r.height; DPR = window.devicePixelRatio || 1;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    S = W / C.VIEW_W;
  }
  window.addEventListener('resize', resize);
  resize();

  const viewH = () => H / S;
  const sx = wx => (wx - cam.x) * S;
  const sy = wy => H - (wy - cam.y) * S;

  // ---------- 로비 ----------
  const params = new URLSearchParams(location.search);
  function showLobby() {
    overlay.classList.remove('hidden');
    card.innerHTML = `
      <h1>💥 꼬마 포트리스</h1>
      <p>두 명이 들어오면 게임이 시작돼요!</p>
      <input id="nick" maxlength="12" placeholder="이름" value="${escapeHtml(localStorage.getItem('nick') || '')}">
      <input id="room" maxlength="20" placeholder="방 이름 (같게 맞추기)" value="${escapeHtml(params.get('room') || 'main')}">
      <button id="go">입장하기</button>`;
    document.getElementById('go').onclick = () => {
      const nick = document.getElementById('nick').value.trim();
      const room = document.getElementById('room').value.trim() || 'main';
      try { localStorage.setItem('nick', nick); } catch (e) {}
      connect(nick, room);
    };
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function showCard(html) { overlay.classList.remove('hidden'); card.innerHTML = html; }
  function hideCard() { overlay.classList.add('hidden'); }

  function connect(nick, room) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/?room=${encodeURIComponent(room)}&nick=${encodeURIComponent(nick)}`);
    showCard('<h1>접속 중...</h1><div class="spin"></div>');
    ws.onmessage = e => onMsg(JSON.parse(e.data));
    ws.onclose = () => {
      if (phase === 'full') return;
      phase = 'lobby';
      showCard('<h1>연결이 끊겼어요</h1><button onclick="location.reload()">다시 접속</button>');
    };
  }

  function onMsg(m) {
    switch (m.t) {
      case 'waiting':
        phase = 'waiting';
        showCard(`<h1>친구를 기다리는 중</h1><div class="spin"></div><p>다른 기기에서 이 주소로 들어오고<br>같은 방 이름으로 입장하세요.</p><p style="font-size:13px;word-break:break-all">${escapeHtml(location.origin)}</p>`);
        break;
      case 'full':
        phase = 'full';
        showCard('<h1>방이 꽉 찼어요</h1><p>다른 방 이름으로 들어와 주세요.</p><button onclick="location.reload()">돌아가기</button>');
        break;
      case 'left':
        phase = 'waiting'; charging = false; anim = null;
        showCard('<h1>상대가 나갔어요</h1><div class="spin"></div><p>새 친구를 기다리는 중...</p>');
        break;
      case 'start':
        me = m.you; heights = m.heights; tanks = m.tanks;
        myAngle = 45; lastPower = null; anim = null; booms = []; floats = []; bannerQ = []; banner = null;
        tanks.forEach(t => { t.shownHp = t.hp; t.angle = 45; });
        hideCard();
        cam.x = tanks[me].x - C.VIEW_W / 2;
        cam.y = Math.max(0, F.groundAt(heights, tanks[me].x) - viewH() * 0.32);
        showBanner(`나는 ${tanks[me].name}!`, `공격력 ${tanks[me].atk} · 방어력 ${tanks[me].def}`, 2500);
        updateGaugeLast();
        break;
      case 'turn':
        turn = m.turn; phase = 'aiming'; turnEnd = performance.now() + m.ms; enemyPower = 0;
        showBanner(turn === me ? '내 차례!' : '상대 차례', turn === me ? '왼쪽을 위아래로 끌어 각도 조절' : '조심해요!', 1400);
        break;
      case 'aim':
        if (tanks) { tanks[m.who].angle = m.angle; enemyPower = m.power; }
        break;
      case 'timeout':
        if (m.turn === me) { charging = false; setPower(0); }
        showBanner('시간 초과!', '', 1100);
        break;
      case 'shot':
        startShot(m);
        break;
      case 'over':
        phase = 'over';
        setTimeout(() => {
          const msg = m.winner === -1 ? '무승부!' : (m.winner === me ? '🎉 승리! 🎉' : '😢 패배...');
          showCard(`<h1>${msg}</h1><p>${m.winner === -1 ? '둘 다 쓰러졌어요' : escapeHtml(tanks[m.winner].nick) + ' 승리!'}</p><button id="again">다시 하기</button>`);
          document.getElementById('again').onclick = () => { ws.send(JSON.stringify({ t: 'restart' })); showCard('<h1>새 게임 준비 중...</h1><div class="spin"></div>'); };
        }, 600);
        break;
    }
  }

  let bannerQ = [];
  function showBanner(title, sub, ms) { bannerQ.push({ title, sub, ms }); }
  function nextBanner(now) {
    if ((!banner || now > banner.until) && bannerQ.length) {
      const b = bannerQ.shift();
      banner = { title: b.title, sub: b.sub, start: now, until: now + b.ms };
    }
  }

  // ---------- 발사 ----------
  function startShot(m) {
    phase = 'flying';
    charging = false;
    const shooter = tanks[m.shooter];
    shooter.angle = m.angle;
    if (m.shooter === me) { lastPower = m.power; updateGaugeLast(); }
    const sim = F.simulate(heights, shooter.x, shooter.dir, m.angle, m.power, tanks.map(t => t.x), m.shooter);
    anim = { pts: sim.pts, start: performance.now(), hit: m.hit, damages: m.damages, hp: m.hp, newHeights: m.heights, done: false, shooter: m.shooter };
  }

  function finishShot() {
    const a = anim;
    a.done = true;
    if (a.hit.type === 'out') {
      floats.push({ x: Math.max(20, Math.min(C.WORLD_W - 20, a.hit.x)), y: 500, text: '빗나감!', color: '#fff', t: performance.now() });
    } else {
      booms.push({ x: a.hit.x, y: a.hit.y, t: performance.now() });
      heights = a.newHeights;
      tanks.forEach((t, i) => {
        t.hp = a.hp[i];
        if (a.damages[i] > 0) {
          const c = F.tankCenter(heights, t.x);
          floats.push({ x: c.x, y: c.y + 40, text: `-${a.damages[i]}`, color: '#ff5252', t: performance.now() });
        }
      });
      if (navigator.vibrate && a.damages[me] > 0) navigator.vibrate(200);
    }
    setTimeout(() => { if (anim === a) anim = null; }, 1200);
  }

  function setPower(p) {
    power = p;
    gaugeFill.style.width = p + '%';
    gaugeText.textContent = Math.round(p);
  }
  function updateGaugeLast() {
    gaugeLast.style.left = lastPower == null ? '-10px' : `calc(${lastPower}% - 1px)`;
  }

  const canFire = () => phase === 'aiming' && turn === me && !anim;

  fireBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!canFire()) return;
    fireBtn.setPointerCapture(e.pointerId);
    charging = true; chargeStart = performance.now(); setPower(0);
    fireBtn.classList.add('pressed');
  });
  const release = e => {
    fireBtn.classList.remove('pressed');
    if (!charging) return;
    charging = false;
    if (canFire()) ws.send(JSON.stringify({ t: 'fire', angle: myAngle, power: Math.round(power * 10) / 10 }));
  };
  fireBtn.addEventListener('pointerup', release);
  fireBtn.addEventListener('pointercancel', release);
  fireBtn.addEventListener('contextmenu', e => e.preventDefault());

  // ---------- 각도 드래그 (왼쪽) / 미니맵 터치 ----------
  let drag = null;
  cv.addEventListener('pointerdown', e => {
    const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (y < MINI.y + MINI.h + 4 && heights) {
      peekX = (x - MINI.x) / MINI.w() * C.WORLD_W;
      peekUntil = performance.now() + 2500;
      return;
    }
    if (x < W * 0.6) {
      drag = { id: e.pointerId, y: e.clientY, a: myAngle };
      cv.setPointerCapture(e.pointerId);
    }
  });
  cv.addEventListener('pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    myAngle = Math.max(0, Math.min(90, Math.round(drag.a + (drag.y - e.clientY) * 0.35)));
    sendAim();
  });
  const endDrag = e => { if (drag && drag.id === e.pointerId) drag = null; };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);

  function sendAim(force) {
    if (!canFire() || !ws) return;
    const now = performance.now();
    if (!force && now - lastAimSent < 70) return;
    lastAimSent = now;
    ws.send(JSON.stringify({ t: 'aim', angle: myAngle, power: charging ? power : 0 }));
  }

  // 키보드(컴퓨터용): ↑↓ 각도, 스페이스 발사
  window.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp') { myAngle = Math.min(90, myAngle + 1); sendAim(); }
    else if (e.key === 'ArrowDown') { myAngle = Math.max(0, myAngle - 1); sendAim(); }
    else if (e.code === 'Space' && !e.repeat && canFire()) { charging = true; chargeStart = performance.now(); setPower(0); fireBtn.classList.add('pressed'); }
  });
  window.addEventListener('keyup', e => { if (e.code === 'Space') release(); });

  // ---------- 그리기 ----------
  function loop(now) {
    update(now);
    draw(now);
    requestAnimationFrame(loop);
  }

  function update(now) {
    if (charging) {
      setPower(Math.min(100, (now - chargeStart) / 1700 * 100));
      sendAim();
    }
    if (tanks && turn === me) tanks[me].angle = myAngle;
    if (tanks) tanks.forEach(t => { t.shownHp += (t.hp - t.shownHp) * 0.08; });
    fireBtn.disabled = !canFire() && !charging;

    if (anim && !anim.done) {
      const i = Math.floor((now - anim.start) / 1000 / C.DT);
      if (i >= anim.pts.length - 1) finishShot();
    }

    // 카메라 목표
    if (!heights) return;
    let tx, ty;
    if (anim) {
      const p = anim.done ? [anim.hit.x, anim.hit.y] : anim.pts[Math.min(anim.pts.length - 1, Math.floor((now - anim.start) / 1000 / C.DT))];
      tx = p[0] - C.VIEW_W / 2;
      ty = p[1] - viewH() * 0.5;
    } else if (now < peekUntil) {
      tx = peekX - C.VIEW_W / 2;
      ty = F.groundAt(heights, Math.max(0, Math.min(C.WORLD_W, peekX))) - viewH() * 0.32;
    } else {
      const focus = tanks[turn >= 0 ? turn : me];
      tx = focus.x - C.VIEW_W / 2;
      ty = F.groundAt(heights, focus.x) - viewH() * 0.32;
    }
    tx = Math.max(-100, Math.min(C.WORLD_W - C.VIEW_W + 100, tx));
    ty = Math.max(0, ty);
    const k = anim && !anim.done ? 0.25 : 0.08;
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
  }

  function draw(now) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // 하늘
    const g = ctx.createLinearGradient(0, 0, 0, H);
    const high = Math.min(1, cam.y / 1500);
    g.addColorStop(0, mix('#4fc3f7', '#0b1d51', high));
    g.addColorStop(1, mix('#e1f5fe', '#4a6fa5', high));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    if (!heights) { drawTitleBg(now); return; }

    // 먼 산 (패럴랙스)
    ctx.fillStyle = 'rgba(80,120,160,.35)';
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) {
      const wx = cam.x * 0.3 + x / S;
      ctx.lineTo(x, H - (220 + 90 * Math.sin(wx / 180) + 50 * Math.sin(wx / 67) - cam.y * 0.3) * S);
    }
    ctx.lineTo(W, H); ctx.fill();

    // 구름
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    for (const c of clouds) {
      const x = (c.x - cam.x * 0.6) * S, y = H - (c.y - cam.y * 0.6) * S;
      if (x < -100 || x > W + 100) continue;
      ctx.beginPath();
      ctx.arc(x, y, c.r * S * 0.6, 0, 7); ctx.arc(x + c.r * S * 0.6, y + 5, c.r * S * 0.5, 0, 7); ctx.arc(x - c.r * S * 0.6, y + 6, c.r * S * 0.45, 0, 7);
      ctx.fill();
    }

    drawGround();
    tanks.forEach((t, i) => drawTank(t, i, now));
    drawMissile(now);
    drawBooms(now);
    drawFloats(now);
    drawHud(now);
    drawProtractor();
    drawMinimap(now);
    drawBanner(now);
  }

  function drawTitleBg(now) {
    ctx.fillStyle = '#5d8a3a';
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 10) ctx.lineTo(x, H * 0.72 + Math.sin(x / 50 + now / 3000) * 14);
    ctx.lineTo(W, H); ctx.fill();
  }

  function drawGround() {
    const x0 = Math.max(0, Math.floor(cam.x / C.SEG) - 1);
    const x1 = Math.min(heights.length - 1, Math.ceil((cam.x + C.VIEW_W) / C.SEG) + 1);
    ctx.beginPath();
    ctx.moveTo(sx(x0 * C.SEG), H + 10);
    for (let i = x0; i <= x1; i++) ctx.lineTo(sx(i * C.SEG), sy(heights[i]));
    ctx.lineTo(sx(x1 * C.SEG), H + 10);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, sy(400), 0, H);
    g.addColorStop(0, '#8d6e45'); g.addColorStop(1, '#4e3620');
    ctx.fillStyle = g; ctx.fill();
    ctx.beginPath();
    for (let i = x0; i <= x1; i++) ctx[i === x0 ? 'moveTo' : 'lineTo'](sx(i * C.SEG), sy(heights[i]));
    ctx.strokeStyle = '#5fbf3a'; ctx.lineWidth = 6 * S * 0.6; ctx.lineJoin = 'round'; ctx.stroke();
    // 맵 끝 표시
    [0, C.WORLD_W].forEach(ex => {
      const x = sx(ex);
      if (x > -5 && x < W + 5) { ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(ex === 0 ? 0 : x, 0, ex === 0 ? x : W - x, H); }
    });
  }

  function drawTank(t, i, now) {
    const gx = t.x, gy = F.groundAt(heights, t.x);
    const x = sx(gx), y = sy(gy);
    if (x < -80 || x > W + 80) return;
    const s = S * 0.9;
    const dead = t.hp <= 0;
    // 기울기
    const slope = Math.atan2(F.groundAt(heights, gx + 10) - F.groundAt(heights, gx - 10), 20);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-slope);
    // 포신
    const a = (t.angle * Math.PI) / 180;
    ctx.save();
    ctx.translate(0, -16 * s);
    ctx.rotate(t.dir > 0 ? -a : Math.PI + a);
    ctx.fillStyle = '#333';
    ctx.fillRect(0, -3 * s, C.BARREL * s, 6 * s);
    ctx.restore();
    // 몸체
    ctx.fillStyle = dead ? '#555' : t.color;
    ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, -14 * s, 11 * s, Math.PI, 0); ctx.fill(); ctx.stroke();
    roundRect(-20 * s, -14 * s, 40 * s, 10 * s, 4 * s); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#2b2b2b';
    roundRect(-22 * s, -6 * s, 44 * s, 8 * s, 4 * s); ctx.fill();
    ctx.fillStyle = '#777';
    for (let k = -3; k <= 3; k++) { ctx.beginPath(); ctx.arc(k * 6 * s, -2 * s, 2.2 * s, 0, 7); ctx.fill(); }
    // 눈
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(4 * t.dir * s, -16 * s, 3.5 * s, 0, 7); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(5 * t.dir * s, -16 * s, 1.8 * s, 0, 7); ctx.fill();
    ctx.restore();

    // 이름 + 체력바
    const by = y - 52 * s;
    ctx.font = `700 ${Math.round(12 * S * 0.9)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 3;
    const label = (i === me ? '나 · ' : '') + t.nick;
    ctx.strokeText(label, x, by - 8); ctx.fillText(label, x, by - 8);
    const bw = 50 * s;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x - bw / 2, by, bw, 7 * s);
    ctx.fillStyle = hpColor(t.shownHp); ctx.fillRect(x - bw / 2, by, bw * t.shownHp / 100, 7 * s);
    // 상대가 힘 모으는 중
    if (i !== me && turn === i && phase === 'aiming' && enemyPower > 0) {
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x - bw / 2, by + 10 * s, bw, 5 * s);
      ctx.fillStyle = '#ffeb3b'; ctx.fillRect(x - bw / 2, by + 10 * s, bw * enemyPower / 100, 5 * s);
    }
    // 차례 화살표
    if (turn === i && phase === 'aiming') {
      const bob = Math.sin(now / 200) * 4;
      ctx.fillStyle = i === me ? '#ffeb3b' : '#ff7043';
      ctx.beginPath(); ctx.moveTo(x - 8, by - 34 + bob); ctx.lineTo(x + 8, by - 34 + bob); ctx.lineTo(x, by - 24 + bob); ctx.fill();
    }
  }

  function drawMissile(now) {
    if (!anim || anim.done) return;
    const i = Math.min(anim.pts.length - 1, Math.floor((now - anim.start) / 1000 / C.DT));
    // 꼬리
    ctx.beginPath();
    for (let k = Math.max(0, i - 40); k <= i; k++) ctx[k === Math.max(0, i - 40) ? 'moveTo' : 'lineTo'](sx(anim.pts[k][0]), sy(anim.pts[k][1]));
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 3; ctx.stroke();
    const p = anim.pts[i], q = anim.pts[Math.max(0, i - 1)];
    const ang = Math.atan2(-(p[1] - q[1]), p[0] - q[0]);
    ctx.save();
    ctx.translate(sx(p[0]), sy(p[1]));
    ctx.rotate(ang);
    ctx.fillStyle = '#ff9800';
    ctx.beginPath(); ctx.moveTo(-14, -3); ctx.lineTo(-20 - Math.random() * 6, 0); ctx.lineTo(-14, 3); ctx.fill();
    ctx.fillStyle = '#37474f';
    roundRect(-14, -4, 18, 8, 3); ctx.fill();
    ctx.fillStyle = '#e53935';
    ctx.beginPath(); ctx.moveTo(4, -4); ctx.lineTo(11, 0); ctx.lineTo(4, 4); ctx.fill();
    ctx.restore();
  }

  function drawBooms(now) {
    booms = booms.filter(b => now - b.t < 800);
    for (const b of booms) {
      const p = (now - b.t) / 800;
      const r = C.BLAST_R * S * (0.3 + 0.7 * Math.sqrt(p));
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = '#ffeb3b';
      ctx.beginPath(); ctx.arc(sx(b.x), sy(b.y), r, 0, 7); ctx.fill();
      ctx.fillStyle = '#ff5722';
      ctx.beginPath(); ctx.arc(sx(b.x), sy(b.y), r * 0.65, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawFloats(now) {
    floats = floats.filter(f => now - f.t < 1600);
    ctx.textAlign = 'center';
    ctx.font = `900 ${Math.round(22 * S * 0.9)}px system-ui`;
    for (const f of floats) {
      const p = (now - f.t) / 1600;
      ctx.globalAlpha = 1 - p * p;
      const x = sx(f.x), y = sy(f.y + p * 50);
      ctx.lineWidth = 4; ctx.strokeStyle = '#000';
      ctx.strokeText(f.text, x, y); ctx.fillStyle = f.color; ctx.fillText(f.text, x, y);
      ctx.globalAlpha = 1;
    }
  }

  function drawHud(now) {
    const top = MINI.y + MINI.h + 8;
    const half = (W - 30) / 2;
    tanks.forEach((t, i) => {
      // 왼쪽 칸 = 나, 오른쪽 칸 = 상대
      const slot = i === me ? 0 : 1;
      const x = 10 + slot * (half + 10);
      ctx.fillStyle = turn === i && phase === 'aiming' ? 'rgba(255,235,59,.25)' : 'rgba(0,0,0,.35)';
      roundRect(x, top, half, 44, 8); ctx.fill();
      ctx.fillStyle = t.color; ctx.beginPath(); ctx.arc(x + 12, top + 13, 6, 0, 7); ctx.fill();
      ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
      ctx.font = '700 12px system-ui';
      ctx.fillText(`${i === me ? '나' : '상대'} · ${t.name}`, x + 22, top + 17);
      ctx.font = '600 10px system-ui'; ctx.fillStyle = '#ddd';
      ctx.fillText(`공 ${t.atk}  방 ${t.def}`, x + 8, top + 38);
      const bx = x + 64, bw = half - 72;
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(bx, top + 28, bw, 12);
      ctx.fillStyle = hpColor(t.shownHp); ctx.fillRect(bx, top + 28, bw * t.shownHp / 100, 12);
      ctx.fillStyle = '#fff'; ctx.font = '700 10px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(Math.round(t.hp), bx + bw / 2, top + 38);
    });
    // 타이머
    if (phase === 'aiming') {
      const left = Math.max(0, (turnEnd - now) / 1000);
      const ty = top + 58;
      const warn = left < 10;
      ctx.fillStyle = warn ? `rgba(229,57,53,${0.7 + 0.3 * Math.sin(now / 120)})` : 'rgba(0,0,0,.45)';
      roundRect(W / 2 - 60, ty, 120, 34, 17); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '800 18px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(`${turn === me ? '내 차례' : '상대'} ${Math.ceil(left)}초`, W / 2, ty + 24);
      ctx.fillStyle = warn ? '#ffeb3b' : '#4fc3f7';
      ctx.fillRect(W / 2 - 50, ty + 30, 100 * left / C.TURN_SEC, 3);
    }
  }

  function drawProtractor() {
    const t = tanks[me];
    const R = Math.min(95, W * 0.24);
    const dir = t.dir;
    const cx = dir > 0 ? 20 : 20 + R, cy = H - 40;
    ctx.save();
    // 판
    ctx.fillStyle = 'rgba(255,255,255,.2)';
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    if (dir > 0) ctx.arc(cx, cy, R, -Math.PI / 2, 0); else ctx.arc(cx, cy, R, Math.PI, Math.PI * 1.5);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // 눈금
    ctx.font = '600 9px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
    for (let d = 0; d <= 90; d += 5) {
      const a = d * Math.PI / 180;
      const ux = Math.cos(a) * dir, uy = -Math.sin(a);
      const len = d % 30 === 0 ? 12 : d % 10 === 0 ? 8 : 4;
      ctx.beginPath(); ctx.moveTo(cx + ux * R, cy + uy * R); ctx.lineTo(cx + ux * (R - len), cy + uy * (R - len)); ctx.stroke();
      if (d % 30 === 0) ctx.fillText(d, cx + ux * (R - 20), cy + uy * (R - 20) + 3);
    }
    // 지난 각도(흐리게) 대신 현재 바늘
    const a = myAngle * Math.PI / 180;
    ctx.strokeStyle = '#ffeb3b'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * dir * (R - 4), cy - Math.sin(a) * (R - 4)); ctx.stroke();
    ctx.fillStyle = '#ffeb3b'; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, 7); ctx.fill();
    // 숫자
    ctx.font = '900 26px system-ui'; ctx.textAlign = 'center';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.6)';
    const tx = dir > 0 ? cx + R * 0.55 : cx - R * 0.55;
    ctx.strokeText(`${myAngle}°`, tx, cy + 30); ctx.fillStyle = '#fff'; ctx.fillText(`${myAngle}°`, tx, cy + 30);
    ctx.font = '600 11px system-ui'; ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.fillText('↕ 끌어서 각도', dir > 0 ? cx + R * 0.5 : cx - R * 0.5, cy - R - 10);
    ctx.restore();
  }

  function drawMinimap(now) {
    const mw = MINI.w(), mx = MINI.x, my = MINI.y, mh = MINI.h;
    const k = mw / C.WORLD_W;
    const hk = mh / 1400;
    ctx.fillStyle = 'rgba(10,25,50,.7)'; roundRect(mx, my, mw, mh, 8); ctx.fill();
    ctx.save(); roundRect(mx, my, mw, mh, 8); ctx.clip();
    ctx.beginPath(); ctx.moveTo(mx, my + mh);
    for (let i = 0; i < heights.length; i += 2) ctx.lineTo(mx + i * C.SEG * k, my + mh - heights[i] * hk);
    ctx.lineTo(mx + mw, my + mh); ctx.fillStyle = '#6d8a3d'; ctx.fill();
    // 카메라 범위
    ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1;
    ctx.strokeRect(mx + cam.x * k, my + mh - (cam.y + viewH()) * hk, C.VIEW_W * k, viewH() * hk);
    tanks.forEach((t, i) => {
      const x = mx + t.x * k, y = my + mh - (F.groundAt(heights, t.x) + 10) * hk;
      ctx.fillStyle = t.color; ctx.strokeStyle = i === me ? '#fff' : '#000'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill(); ctx.stroke();
    });
    if (anim && !anim.done) {
      const i = Math.min(anim.pts.length - 1, Math.floor((now - anim.start) / 1000 / C.DT));
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.beginPath();
      for (let j = 0; j <= i; j += 3) ctx[j === 0 ? 'moveTo' : 'lineTo'](mx + anim.pts[j][0] * k, my + mh - anim.pts[j][1] * hk);
      ctx.stroke();
      const p = anim.pts[i];
      ctx.fillStyle = '#ff5252'; ctx.beginPath(); ctx.arc(mx + p[0] * k, Math.max(my + 3, my + mh - p[1] * hk), 3, 0, 7); ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1.5; roundRect(mx, my, mw, mh, 8); ctx.stroke();
  }

  function drawBanner(now) {
    nextBanner(now);
    if (!banner || now > banner.until) return;
    const p = (now - banner.start) / (banner.until - banner.start);
    const alpha = p < 0.1 ? p / 0.1 : p > 0.8 ? (1 - p) / 0.2 : 1;
    ctx.globalAlpha = alpha;
    const y = H * 0.4;
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, y - 40, W, banner.sub ? 76 : 56);
    ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
    ctx.font = '900 30px system-ui'; ctx.fillText(banner.title, W / 2, y);
    if (banner.sub) { ctx.font = '600 14px system-ui'; ctx.fillStyle = '#ffe082'; ctx.fillText(banner.sub, W / 2, y + 24); }
    ctx.globalAlpha = 1;
  }

  // ---------- 도우미 ----------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function hpColor(hp) { return hp > 60 ? '#4caf50' : hp > 30 ? '#ffc107' : '#f44336'; }
  function mix(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const c = [16, 8, 0].map(s => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t));
    return `rgb(${c.join(',')})`;
  }

  showLobby();
  requestAnimationFrame(loop);
})();
