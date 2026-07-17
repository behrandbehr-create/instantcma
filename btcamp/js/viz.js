/* BTCAMP — visualization engine. 13 modes rendered from the synthesized network signal
   (Feeds.spec / Feeds.wave / Feeds.beat) plus raw chain state. All modes respond to the
   user dials: SPEED, TRAILS, GLOW, HUE, DENSITY, SENS, SYMMETRY, ZOOM. */
'use strict';

const Viz = {
  modes: [], idx: 0, auto: false, autoT: 0,
  P: { speed: 1, trails: 0.65, glow: 0.6, hue: 30, density: 1, sens: 1, sym: 1, zoom: 1 },
  canvas: null, g: null, W: 0, H: 0, S: {}, time: 0, hueBase: 30,
  pals: ['SKIN', 'RAINBOW', 'FIRE', 'ICE', 'MONO'], pal: 0,
  _fade: null, // crossfade snapshot of the previous mode

  register(m) { this.modes.push(m); },

  attach(canvas) {
    this.canvas = canvas; this.g = canvas.getContext('2d');
    const fit = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(64, r.width * dpr); canvas.height = Math.max(64, r.height * dpr);
      this.W = canvas.width; this.H = canvas.height; this.S = {};
      this.g.setTransform(1, 0, 0, 1, 0, 0);
      this.g.fillStyle = '#000'; this.g.fillRect(0, 0, this.W, this.H);
    };
    new ResizeObserver(fit).observe(canvas); fit();
  },

  set(i) {
    const next = ((i % this.modes.length) + this.modes.length) % this.modes.length;
    // smooth blend: snapshot the outgoing frame and crossfade it over the incoming mode
    if (this.g && this.W && next !== this.idx) {
      const snap = document.createElement('canvas');
      snap.width = this.W; snap.height = this.H;
      snap.getContext('2d').drawImage(this.canvas, 0, 0);
      this._fade = { img: snap, a: 1 };
    }
    this.idx = next;
    this.S = {}; this.autoT = 0;
    const g = this.g; if (g) { g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, this.W, this.H); }
    return this.modes[this.idx].name;
  },
  next() { return this.set(this.idx + 1); },
  prev() { return this.set(this.idx - 1); },

  hue(off = 0) {
    const p = this.pals[this.pal];
    if (p === 'RAINBOW') return (this.time * 24 + off * 3 + this.P.hue) % 360;
    if (p === 'FIRE') return 5 + (Math.abs(off + this.P.hue) % 90) * 0.6;           // deep red → gold
    if (p === 'ICE') return 175 + (Math.abs(off + this.P.hue) % 100) * 0.85;        // teal → violet
    return (this.hueBase + this.P.hue + off) % 360;                                  // SKIN & MONO
  },
  col(off, s, l, a = 1) {
    if (this.pals[this.pal] === 'MONO') { s = Math.min(s, 20); off = 0; }
    return `hsla(${this.hue(off)},${s}%,${l}%,${a})`;
  },
  cyclePal() { this.pal = (this.pal + 1) % this.pals.length; return this.pals[this.pal]; },

  frame(dt) {
    if (!this.g || !this.W) return;
    const P = this.P;
    dt = Math.min(dt, 0.1) * P.speed;
    this.time += dt;
    if (this.auto) { this.autoT += dt; if (this.autoT > 18) { this.next(); Deck.updateModeLCD(); } }
    const m = this.modes[this.idx], g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (!m.noFade) {
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = `rgba(0,0,0,${lerp(0.5, 0.015, clamp(P.trails, 0, 1))})`;
      g.fillRect(0, 0, this.W, this.H);
    }
    g.save();
    // zoom around center
    if (P.zoom !== 1) { g.translate(this.W / 2, this.H / 2); g.scale(P.zoom, P.zoom); g.translate(-this.W / 2, -this.H / 2); }
    try { m.draw(g, this.W, this.H, Feeds, P, this.time, this.S, dt); } catch (e) {}
    g.restore();
    g.globalCompositeOperation = 'source-over';
    g.shadowBlur = 0;
    // crossfade the previous mode's last frame over the new one
    if (this._fade) {
      this._fade.a -= dt * 1.4;
      if (this._fade.a <= 0) this._fade = null;
      else {
        g.globalAlpha = Math.min(1, this._fade.a);
        g.drawImage(this._fade.img, 0, 0, this.W, this.H);
        g.globalAlpha = 1;
      }
    }
  },

  glowOn(g, c, amt = 1) { const b = this.P.glow * 24 * amt; if (b > 0.5) { g.shadowBlur = b; g.shadowColor = c; } },
  glowOff(g) { g.shadowBlur = 0; },

  spec(i, F) { return clamp(F.spec[i] * this.P.sens, 0, 1.35); },
};

/* Higgsfield-generated nebula backdrop (drawn dimly behind the space-y modes).
   Loads from the Higgsfield CDN; modes render fine without it if offline. */
Viz.art = (() => {
  const img = new Image(); const o = { img, ok: false };
  img.onload = () => { o.ok = true; };
  img.src = 'https://d8j0ntlcm91z4.cloudfront.net/user_3G9FnmnAtJVrnrQzzqiZ1NoYfPk/hf_20260717_042807_0cd0dfb8-0f0f-4ab1-8c53-9af9b036762b.png';
  return o;
})();
Viz.drawArt = function (g, W, H, alpha) {
  if (!this.art.ok) return;
  const img = this.art.img, s = Math.max(W / img.width, H / img.height);
  g.save(); g.globalAlpha = alpha; g.globalCompositeOperation = 'source-over';
  g.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
  g.restore();
};

/* ---------- helpers ---------- */
function vSym(g, W, H, n, fn) { // draw fn() n times rotated around center
  n = Math.max(1, Math.round(n));
  for (let i = 0; i < n; i++) {
    g.save(); g.translate(W / 2, H / 2); g.rotate((i / n) * Math.PI * 2); g.translate(-W / 2, -H / 2);
    fn(i); g.restore();
  }
}
const TAU = Math.PI * 2;

/* ================= 1. SPECTRUM CLASSIC ================= */
Viz.register({
  name: 'SPECTRUM CLASSIC',
  draw(g, W, H, F, P, t, S) {
    const n = F.N, bw = W / n;
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const v = Viz.spec(i, F), h = v * H * 0.86;
      const grad = g.createLinearGradient(0, H, 0, H - h);
      grad.addColorStop(0, Viz.col(i * 1.4, 90, 42));
      grad.addColorStop(1, Viz.col(i * 1.4 + 60, 100, 62));
      g.fillStyle = grad;
      Viz.glowOn(g, Viz.col(i * 1.4, 100, 55), v);
      g.fillRect(i * bw + bw * 0.12, H - h, bw * 0.76, h);
      // peak caps
      const pk = clamp(F.peaks[i] * P.sens, 0, 1.35) * H * 0.86;
      g.fillStyle = Viz.col(i * 1.4 + 90, 100, 75);
      g.fillRect(i * bw + bw * 0.12, H - pk - 4, bw * 0.76, 3);
    }
    Viz.glowOff(g);
    if (F.blockFlash > 0.6) { g.fillStyle = `rgba(255,255,255,${(F.blockFlash - 0.6) * 0.35})`; g.fillRect(0, 0, W, H); }
  },
});

/* ================= 2. OSCILLOSCOPE ================= */
Viz.register({
  name: 'OSCILLOSCOPE',
  draw(g, W, H, F, P, t, S) {
    g.globalCompositeOperation = 'lighter';
    const n = F.wave.length;
    for (let pass = 0; pass < 2; pass++) {
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const s = F.wave[(F.wavePos + i) % n] * P.sens;
        const x = (i / (n - 1)) * W;
        const y = H / 2 + s * H * 0.4 * (pass ? 0.55 : 1);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.strokeStyle = pass ? Viz.col(120, 100, 70, 0.8) : Viz.col(0, 100, 60);
      g.lineWidth = pass ? 1.5 : 3;
      Viz.glowOn(g, Viz.col(0, 100, 55), 1);
      g.stroke();
    }
    Viz.glowOff(g);
    // grid
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = Viz.col(0, 60, 40, 0.16); g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= W; x += W / 12) { g.moveTo(x, 0); g.lineTo(x, H); }
    for (let y = 0; y <= H; y += H / 8) { g.moveTo(0, y); g.lineTo(W, y); }
    g.stroke();
  },
});

/* ================= 3. MATRIX RAIN ================= */
Viz.register({
  name: 'MATRIX RAIN',
  draw(g, W, H, F, P, t, S, dt) {
    const fs = Math.max(10, Math.round(H / 46));
    if (!S.cols) {
      S.n = Math.floor(W / fs);
      S.cols = Array.from({ length: S.n }, () => ({ y: Math.random() * H, sp: 0, hot: 0 }));
      S.chars = '01ABCDEF₿abcdef0123456789';
    }
    g.font = `bold ${fs}px monospace`;
    const rate = 0.4 + F.S.txRate * 0.12;
    for (let i = 0; i < S.n; i++) {
      const c = S.cols[i];
      if (c.sp <= 0 && Math.random() < rate * dt * P.density * 2) { c.sp = (0.5 + Math.random()) * H * 0.9; c.y = -fs; c.hot = Math.random() < F.beat; }
      if (c.sp > 0) {
        c.y += c.sp * dt * (1 + F.bass);
        const ch = S.chars[Math.floor(Math.random() * S.chars.length)];
        g.fillStyle = c.hot ? '#ffffff' : Viz.col(0, 100, 72);
        Viz.glowOn(g, Viz.col(0, 100, 50), c.hot ? 1.4 : 0.5);
        g.fillText(ch, i * fs, c.y);
        g.fillStyle = Viz.col(0, 90, 38, 0.8);
        g.fillText(S.chars[Math.floor(Math.random() * S.chars.length)], i * fs, c.y - fs);
        Viz.glowOff(g);
        if (c.y > H + fs * 2) c.sp = 0;
      }
    }
    if (F.blockFlash > 0.7) {
      g.fillStyle = `rgba(255,255,255,${(F.blockFlash - 0.7) * 0.3})`; g.fillRect(0, 0, W, H);
      g.font = `bold ${fs * 3}px monospace`; g.fillStyle = Viz.col(0, 100, 80);
      g.textAlign = 'center'; g.fillText('BLOCK ' + F.S.height, W / 2, H / 2); g.textAlign = 'left';
    }
  },
});

/* ================= 4. TX FOUNTAIN ================= */
Viz.register({
  name: 'TX FOUNTAIN',
  draw(g, W, H, F, P, t, S, dt) {
    if (!S.ps) { S.ps = []; S.seen = 0; }
    // spawn a particle for each new tx event
    const evs = F.events;
    while (S.seen < F.txCounter && S.ps.length < 900 * P.density) {
      S.seen++;
      const e = evs[evs.length - 1] || { v: 0.01, big: false };
      const sz = clamp(2 + Math.log10(1 + e.v * 100) * 5, 2, 26);
      S.ps.push({ x: W / 2 + (Math.random() - 0.5) * W * 0.1, y: H + sz, vx: (Math.random() - 0.5) * W * 0.35, vy: -(H * (0.55 + Math.random() * 0.5)) * (0.8 + Math.log10(1 + e.v) * 0.2), sz, h: Math.random() * 60 - 30, big: e.big, life: 1 });
    }
    if (S.seen > F.txCounter) S.seen = F.txCounter;
    g.globalCompositeOperation = 'lighter';
    const grav = H * 0.5;
    S.ps = S.ps.filter(p => {
      p.vy += grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt * 0.22;
      if (p.life <= 0 || p.y > H + 40) return false;
      g.fillStyle = p.big ? '#ffffff' : Viz.col(p.h, 95, 60, p.life);
      Viz.glowOn(g, Viz.col(p.h, 100, 55), p.big ? 1.6 : 0.7);
      g.beginPath(); g.arc(p.x, p.y, p.sz * (p.big ? 1 + F.beat * 0.5 : 1), 0, TAU); g.fill();
      return true;
    });
    Viz.glowOff(g);
    if (F.blockFlash > 0.8) for (let i = 0; i < 60; i++) {
      const a = Math.random() * TAU, r = Math.random() * W * 0.4;
      g.fillStyle = Viz.col(Math.random() * 80, 100, 70, 0.9);
      g.fillRect(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r, 3, 3);
    }
  },
});

/* ================= 5. MEMPOOL SEA ================= */
Viz.register({
  name: 'MEMPOOL SEA',
  draw(g, W, H, F, P, t, S, dt) {
    if (!S.bub) S.bub = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), r: 0.004 + Math.random() * 0.02, ph: Math.random() * TAU }));
    const fill = clamp(F.S.mempoolVsize / 150e6, 0.05, 1);
    const line = H * (1 - fill * 0.85);
    // water body
    g.globalCompositeOperation = 'source-over';
    const grad = g.createLinearGradient(0, line, 0, H);
    grad.addColorStop(0, Viz.col(0, 80, 30, 0.5)); grad.addColorStop(1, Viz.col(-40, 90, 12, 0.7));
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) g.lineTo(x, line + Math.sin(x / 60 + t * 2) * 8 * (1 + F.bass * 2) + Math.sin(x / 23 - t * 3.2) * 4);
    g.lineTo(W, H); g.fill();
    // bubbles = pending txs, rising speed ~ fee pressure
    g.globalCompositeOperation = 'lighter';
    const n = Math.round(S.bub.length * P.density * fill);
    for (let i = 0; i < Math.min(n, S.bub.length); i++) {
      const b = S.bub[i];
      b.y -= dt * (0.05 + F.S.fees.fast / 300) * (1 + b.r * 20); b.ph += dt * 2;
      if (b.y * H < line) { b.y = 1.02; b.x = Math.random(); }
      const x = b.x * W + Math.sin(b.ph) * 10, y = b.y * H;
      g.strokeStyle = Viz.col(30 + b.r * 800, 90, 65, 0.7); g.lineWidth = 1.5;
      Viz.glowOn(g, Viz.col(30, 100, 55), 0.5);
      g.beginPath(); g.arc(x, y, b.r * H * (1 + F.beat * 0.3), 0, TAU); g.stroke();
    }
    Viz.glowOff(g);
    // projected next-block "ships" on the surface
    (F.S.mempoolBlocks || []).slice(0, 6).forEach((mb, i) => {
      const w = clamp((mb.blockVSize || 0) / 1e6, 0.2, 1) * W * 0.09;
      const x = W * 0.08 + i * W * 0.15, y = line - 12 + Math.sin(t * 2 + i) * 5;
      g.fillStyle = Viz.col(60 - i * 12, 90, 55, 0.9);
      g.fillRect(x, y - 14, w, 14);
      g.fillStyle = '#000a'; g.font = `bold ${Math.max(9, H / 60)}px monospace`;
      g.fillText(`${Math.round(mb.medianFee || 0)}`, x + 3, y - 3);
    });
  },
});

/* ================= 6. BLOCK CITY ================= */
Viz.register({
  name: 'BLOCK CITY',
  draw(g, W, H, F, P, t, S) {
    const bs = F.S.blocks.slice(0, 16).reverse();
    if (!bs.length) return;
    const bw = W / 17, horizon = H * 0.82;
    g.globalCompositeOperation = 'lighter';
    // ground grid
    g.strokeStyle = Viz.col(0, 70, 40, 0.25); g.lineWidth = 1; g.beginPath();
    for (let i = 0; i <= 20; i++) { const x = (i / 20) * W; g.moveTo(W / 2 + (x - W / 2) * 0.2, horizon); g.lineTo(x, H); }
    for (let i = 0; i < 6; i++) { const y = horizon + (H - horizon) * Math.pow(i / 6, 1.7); g.moveTo(0, y); g.lineTo(W, y); }
    g.stroke();
    bs.forEach((b, i) => {
      const hgt = clamp(b.size / 2.2e6, 0.08, 1) * H * 0.62 * (1 + (i === bs.length - 1 ? F.beat * 0.25 : 0));
      const x = bw * (i + 0.5), w = bw * 0.7;
      const feeGlow = clamp(b.fees / 0.5, 0.1, 1);
      const grad = g.createLinearGradient(0, horizon - hgt, 0, horizon);
      grad.addColorStop(0, Viz.col(40 * feeGlow, 95, 60));
      grad.addColorStop(1, Viz.col(0, 80, 22));
      g.fillStyle = grad;
      Viz.glowOn(g, Viz.col(30, 100, 50), feeGlow);
      g.fillRect(x, horizon - hgt, w, hgt);
      // windows = txs
      g.fillStyle = Viz.col(60, 100, 80, 0.5);
      const rows = clamp(Math.round(b.txs / 400), 2, 14);
      for (let r = 1; r < rows; r++) for (let c2 = 0; c2 < 3; c2++)
        if ((r * 7 + c2 * 13 + b.height) % 3) g.fillRect(x + 4 + c2 * (w / 3), horizon - (hgt * r / rows), w / 5, 2);
      Viz.glowOff(g);
      g.fillStyle = Viz.col(0, 30, 85, 0.9); g.font = `${Math.max(8, W / 110)}px monospace`;
      g.save(); g.translate(x + w / 2, horizon + 12); g.rotate(0.6); g.fillText(String(b.height), 0, 0); g.restore();
    });
    // sun = price
    const sy = H * 0.2 - clamp(F.S.priceDelta, -8, 8) / 8 * H * 0.12;
    g.fillStyle = Viz.col(F.S.priceDelta >= 0 ? 80 : -20, 100, 60, 0.9);
    Viz.glowOn(g, Viz.col(60, 100, 60), 2);
    g.beginPath(); g.arc(W * 0.85, sy, H * 0.05 * (1 + F.treble), 0, TAU); g.fill();
    Viz.glowOff(g);
  },
});

/* ================= 7. WARP TUNNEL ================= */
Viz.register({
  name: 'WARP TUNNEL',
  draw(g, W, H, F, P, t, S, dt) {
    Viz.drawArt(g, W, H, 0.05 + F.bass * 0.06);
    if (!S.st) S.st = Array.from({ length: 500 }, () => ({ a: Math.random() * TAU, r: Math.random(), sp: 0.5 + Math.random() }));
    const cx = W / 2 + Math.sin(t * 0.7) * W * 0.06, cy = H / 2 + Math.cos(t * 0.53) * H * 0.06;
    const speed = (0.12 + F.S.txRate * 0.04 + F.bass * 0.5) * (F.blockFlash > 0.5 ? 4 : 1);
    g.globalCompositeOperation = 'lighter';
    const n = Math.round(S.st.length * P.density);
    for (let i = 0; i < Math.min(n, S.st.length); i++) {
      const s = S.st[i];
      const r0 = Math.pow(s.r, 2);
      s.r += dt * speed * s.sp;
      if (s.r > 1) { s.r = 0.02; s.a = Math.random() * TAU; }
      const r1 = Math.pow(s.r, 2);
      const R = Math.hypot(W, H) * 0.6;
      const x0 = cx + Math.cos(s.a) * r0 * R, y0 = cy + Math.sin(s.a) * r0 * R;
      const x1 = cx + Math.cos(s.a) * r1 * R, y1 = cy + Math.sin(s.a) * r1 * R;
      g.strokeStyle = Viz.col(s.a * 57.3 * 0.3, 90, 45 + r1 * 45, 0.9);
      g.lineWidth = 1 + r1 * 3.5;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
    // tunnel rings driven by spectrum
    for (let i = 0; i < 8; i++) {
      const v = Viz.spec(i * 8, F);
      g.strokeStyle = Viz.col(i * 20, 100, 55, 0.12 + v * 0.3);
      g.lineWidth = 1 + v * 4;
      g.beginPath(); g.arc(cx, cy, ((t * speed * 2 + i / 8) % 1) ** 2 * Math.hypot(W, H) * 0.55, 0, TAU); g.stroke();
    }
  },
});

/* ================= 8. RADIAL PULSE ================= */
Viz.register({
  name: 'RADIAL PULSE',
  draw(g, W, H, F, P, t, S) {
    Viz.drawArt(g, W, H, 0.06 + F.level * 0.08);
    const R = Math.min(W, H) * 0.16 * (1 + F.beat * 0.4);
    g.globalCompositeOperation = 'lighter';
    vSym(g, W, H, P.sym, () => {
      g.translate(W / 2, H / 2); g.rotate(t * 0.4);
      for (let i = 0; i < F.N; i++) {
        const v = Viz.spec(i, F);
        const a = (i / F.N) * TAU;
        const r1 = R + v * Math.min(W, H) * 0.32;
        g.strokeStyle = Viz.col(i * 3, 95, 55 + v * 25, 0.85);
        g.lineWidth = 3;
        Viz.glowOn(g, Viz.col(i * 3, 100, 55), v);
        g.beginPath();
        g.moveTo(Math.cos(a) * R, Math.sin(a) * R);
        g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
        g.stroke();
      }
      Viz.glowOff(g);
      g.rotate(-t * 0.4); g.translate(-W / 2, -H / 2);
    });
    // core: price readout pulse
    g.fillStyle = Viz.col(40, 100, 65, 0.9);
    g.font = `bold ${Math.max(12, Math.min(W, H) / 22)}px monospace`; g.textAlign = 'center';
    Viz.glowOn(g, Viz.col(40, 100, 55), 1.5);
    g.fillText(F.S.price ? '$' + Math.round(F.S.price).toLocaleString() : '— — —', W / 2, H / 2 + 6);
    Viz.glowOff(g); g.textAlign = 'left';
  },
});

/* ================= 9. PLASMA FIRE ================= */
Viz.register({
  name: 'PLASMA FIRE',
  noFade: true,
  draw(g, W, H, F, P, t, S) {
    const w = 144, h = 90;
    if (!S.buf) { S.buf = new Float32Array(w * (h + 2)); S.off = document.createElement('canvas'); S.off.width = w; S.off.height = h; S.og = S.off.getContext('2d'); S.img = S.og.createImageData(w, h); }
    const heat = clamp(F.S.mempoolVsize / 150e6, 0.15, 1) * 0.9 + F.bass * 0.4 + F.beat * 0.5;
    const buf = S.buf;
    for (let x = 0; x < w; x++) {
      const sp = Viz.spec(Math.floor(x / w * 63), F);
      buf[(h) * w + x] = buf[(h + 1) * w + x] = Math.random() < heat ? 0.75 + sp * 0.6 + Math.random() * 0.3 : 0;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : 0, xr = x < w - 1 ? x + 1 : w - 1;
      buf[y * w + x] = (buf[(y + 1) * w + xl] + buf[(y + 1) * w + x] * 2 + buf[(y + 1) * w + xr] + buf[(y + 2) * w + x]) / 4.06;
    }
    const d = S.img.data, hb = Viz.hue(0);
    for (let i = 0; i < w * h; i++) {
      const v = clamp(buf[i], 0, 1.4);
      // fire palette rotated by hue dial
      const c = hslToRgb(((hb + v * 55 - 20) % 360) / 360, 1, clamp(v * 0.62, 0, 0.92));
      d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = v > 0.03 ? 255 : 250;
    }
    S.og.putImageData(S.img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(S.off, 0, 0, W, H);
  },
});

function hslToRgb(h, s, l) {
  const f = (n) => { const k = (n + h * 12) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/* ================= 10. FLOW FIELD ================= */
Viz.register({
  name: 'FLOW FIELD',
  draw(g, W, H, F, P, t, S, dt) {
    if (!S.ps) S.ps = Array.from({ length: 700 }, () => ({ x: Math.random() * W, y: Math.random() * H, l: Math.random() }));
    const mom = clamp(F.S.priceMom * 0.02, -1, 1);
    g.globalCompositeOperation = 'lighter';
    const n = Math.round(S.ps.length * P.density);
    const spd = (30 + F.level * 260) * (1 + Math.abs(mom));
    for (let i = 0; i < Math.min(n, S.ps.length); i++) {
      const p = S.ps[i];
      const a = Math.sin(p.x * 0.004 + t * 0.6) * 2.4 + Math.cos(p.y * 0.005 - t * 0.4) * 2.4 + mom * 3;
      const nx = p.x + Math.cos(a) * spd * dt, ny = p.y + Math.sin(a) * spd * dt;
      g.strokeStyle = Viz.col(a * 20 + mom * 60, 90, 55, 0.5 + F.level * 0.4);
      g.lineWidth = 1.2 + F.bass * 2;
      g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(nx, ny); g.stroke();
      p.x = nx; p.y = ny; p.l -= dt * 0.2;
      if (p.x < 0 || p.x > W || p.y < 0 || p.y > H || p.l <= 0) { p.x = Math.random() * W; p.y = Math.random() * H; p.l = 1; }
    }
  },
});

/* ================= 11. PRICE RIBBON ================= */
Viz.register({
  name: 'PRICE RIBBON',
  draw(g, W, H, F, P, t, S, dt) {
    if (!S.hist) { S.hist = []; S.acc = 0; }
    S.acc += dt;
    if (S.acc > 0.08 && F.S.price) { S.acc = 0; S.hist.push(F.S.price); if (S.hist.length > 260) S.hist.shift(); }
    if (S.hist.length < 2) return;
    let mn = Infinity, mx = -Infinity;
    for (const v of S.hist) { if (v < mn) mn = v; if (v > mx) mx = v; }
    const pad = Math.max((mx - mn) * 0.15, mx * 0.0004); mn -= pad; mx += pad;
    const up = S.hist[S.hist.length - 1] >= S.hist[0];
    const hueOff = up ? 90 : -25;
    g.globalCompositeOperation = 'lighter';
    // area glow
    g.beginPath();
    S.hist.forEach((v, i) => { const x = i / (S.hist.length - 1) * W, y = H - (v - mn) / (mx - mn) * H * 0.9 - H * 0.05; i ? g.lineTo(x, y) : g.moveTo(x, y); });
    const last = S.hist[S.hist.length - 1];
    const lyy = H - (last - mn) / (mx - mn) * H * 0.9 - H * 0.05;
    g.strokeStyle = Viz.col(hueOff, 100, 60); g.lineWidth = 3;
    Viz.glowOn(g, Viz.col(hueOff, 100, 55), 1.4); g.stroke(); Viz.glowOff(g);
    g.lineTo(W, H); g.lineTo(0, H); g.closePath();
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, Viz.col(hueOff, 100, 50, 0.3)); grad.addColorStop(1, Viz.col(hueOff, 100, 50, 0));
    g.fillStyle = grad; g.fill();
    // live tick spark
    g.fillStyle = '#fff'; Viz.glowOn(g, Viz.col(hueOff, 100, 70), 2);
    g.beginPath(); g.arc(W, lyy, 4 + F.treble * 8, 0, TAU); g.fill(); Viz.glowOff(g);
    // spectrum skyline behind
    for (let i = 0; i < F.N; i += 2) {
      const v = Viz.spec(i, F);
      g.fillStyle = Viz.col(i, 80, 45, 0.12);
      g.fillRect(i / F.N * W, H - v * H * 0.3, W / F.N * 1.6, v * H * 0.3);
    }
    g.font = `bold ${Math.max(12, H / 16)}px monospace`;
    g.fillStyle = Viz.col(hueOff, 90, 70, 0.95);
    g.fillText('$' + Math.round(last).toLocaleString(), W * 0.03, H * 0.14);
    g.font = `${Math.max(9, H / 34)}px monospace`;
    g.fillStyle = Viz.col(hueOff, 60, 60, 0.8);
    g.fillText((F.S.priceDelta >= 0 ? '+' : '') + F.S.priceDelta.toFixed(2) + '% SESSION  ·  VOL ' + Math.round(F.S.vol24).toLocaleString() + ' BTC', W * 0.03, H * 0.14 + H / 22);
  },
});

/* ================= 12. WHALE SONAR ================= */
Viz.register({
  name: 'WHALE SONAR',
  draw(g, W, H, F, P, t, S, dt) {
    if (!S.blips) { S.blips = []; S.seen = 0; S.rings = []; S.blocksSeen = F.blockEvents; }
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.46;
    // new tx → blip (bigger tx = bigger, closer to center)
    while (S.seen < F.txCounter) {
      S.seen++;
      const e = F.events[F.events.length - 1] || { v: 0.01 };
      if (e.v > 0.5 && S.blips.length < 200) S.blips.push({ a: Math.random() * TAU, r: clamp(1 - Math.log10(1 + e.v) / 3.2, 0.08, 1), v: e.v, life: 1 });
    }
    if (F.blockEvents > S.blocksSeen) { S.blocksSeen = F.blockEvents; S.rings.push({ r: 0, life: 1 }); }
    g.globalCompositeOperation = 'lighter';
    // radar rings + crosshair
    g.strokeStyle = Viz.col(0, 80, 45, 0.35); g.lineWidth = 1;
    for (let i = 1; i <= 4; i++) { g.beginPath(); g.arc(cx, cy, R * i / 4, 0, TAU); g.stroke(); }
    g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
    // sweep
    const sw = t * (1 + F.S.txRate * 0.08);
    const grad = g.createConicGradient ? g.createConicGradient(sw, cx, cy) : null;
    if (grad) {
      grad.addColorStop(0, Viz.col(0, 100, 55, 0.5)); grad.addColorStop(0.12, Viz.col(0, 100, 50, 0));
      grad.addColorStop(1, 'transparent');
      g.fillStyle = grad; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
    }
    // blips
    S.blips = S.blips.filter(b => {
      b.life -= dt * 0.12;
      if (b.life <= 0) return false;
      const x = cx + Math.cos(b.a) * b.r * R, y = cy + Math.sin(b.a) * b.r * R;
      const sz = clamp(2 + Math.log10(1 + b.v) * 6, 2, 22);
      const whale = b.v >= 50;
      g.fillStyle = whale ? '#fff' : Viz.col(60, 100, 65, b.life);
      Viz.glowOn(g, Viz.col(40, 100, 55), whale ? 2 : 0.8);
      g.beginPath(); g.arc(x, y, sz * (whale ? 1 + F.beat * 0.4 : 1), 0, TAU); g.fill();
      if (whale) { g.font = `bold ${Math.max(9, H / 40)}px monospace`; g.fillText('₿' + Math.round(b.v).toLocaleString(), x + sz + 3, y + 3); }
      Viz.glowOff(g);
      return true;
    });
    // block shockwave rings
    S.rings = S.rings.filter(r => {
      r.r += dt * R * 1.1; r.life -= dt * 0.5;
      if (r.life <= 0) return false;
      g.strokeStyle = Viz.col(30, 100, 65, r.life); g.lineWidth = 4 * r.life;
      Viz.glowOn(g, Viz.col(30, 100, 55), 1.4);
      g.beginPath(); g.arc(cx, cy, r.r, 0, TAU); g.stroke(); Viz.glowOff(g);
      return true;
    });
  },
});

/* ================= 13. PRESSURE WIND (BTC://SIGNAL port) =================
   Momentum particle wind (green up / red down), a spark per trade, whale
   shockwaves + tape, rolling price oscilloscope with session H/L, buy/sell
   pressure bar, and an order-size spectrum with falling peak caps. */
Viz.register({
  name: 'PRESSURE WIND',
  draw(g, W, H, F, P, t, S, dt) {
    const UP = 'rgba(46,230,168,', DOWN = 'rgba(255,77,94,';
    const M = F.S;
    if (!S.amb) { S.amb = []; S.sparks = []; S.rings = []; S.tape = []; S.acc = 0; S.lastT = performance.now(); }
    const priceToY = (p) => {
      if (!isFinite(M.hi) || M.hi === M.lo) return H * 0.5;
      const pad = (M.hi - M.lo) * 0.25 + 1e-9;
      return H * 0.78 - ((p - (M.lo - pad)) / ((M.hi + pad) - (M.lo - pad))) * (H * 0.56);
    };
    const wind = clamp(M.wind * P.sens, -1.6, 1.6), dir = wind >= 0;

    // ambient wind field — density follows trade rate and the DENSITY dial
    const target = Math.min(520, (140 + F.trades.length * 30) * P.density) * (W / 1400 + 0.4);
    while (S.amb.length < target) S.amb.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 18, vy: 0, r: 0.6 + Math.random() * 1.6, seed: Math.random() * 1000 });
    while (S.amb.length > target + 60) S.amb.pop();
    g.globalCompositeOperation = 'lighter';
    const a0 = 0.05 + Math.min(0.3, Math.abs(wind) * 0.22);
    g.fillStyle = (dir ? UP : DOWN) + a0 + ')';
    for (const p of S.amb) {
      p.vy += (-wind * 11 - p.vy) * 0.04;
      p.vx += Math.sin(t * 0.4 + p.seed) * 0.6;
      p.x += p.vx * dt; p.y += p.vy * dt * 10;
      if (p.y < -10) p.y = H + 10; if (p.y > H + 10) p.y = -10;
      if (p.x < -10) p.x = W + 10; if (p.x > W + 10) p.x = -10;
      g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.fill();
    }

    // new trades since last frame → sparks; whales → shockwave rings
    const newTrades = F.trades.filter(x => x.t > S.lastT);
    S.lastT = performance.now();
    for (const tr of newTrades) {
      const mag = Math.log10(1 + tr.size * 10);
      const n = Math.min(40, 2 + Math.floor(mag * 14 * P.density));
      const cx = W * 0.5 + (Math.random() - 0.5) * W * 0.5, cy = priceToY(tr.price);
      for (let i = 0; i < n && S.sparks.length < 800; i++) {
        const a = Math.random() * TAU, sp = (24 + Math.random() * 96) * (1 + mag);
        S.sparks.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (tr.buy ? 36 : -36), life: 1, dk: 0.7 + Math.random() * 1.2, buy: tr.buy, r: 1 + mag * 1.2 });
      }
      if (tr.size >= 2) S.rings.push({ x: cx, y: cy, r: 6, max: 120 + mag * 90, buy: tr.buy, life: 1 });
    }
    S.sparks = S.sparks.filter(p => {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.buy ? -36 : 36) * dt; p.life -= p.dk * dt;
      if (p.life <= 0) return false;
      g.fillStyle = (p.buy ? UP : DOWN) + p.life.toFixed(3) + ')';
      g.beginPath(); g.arc(p.x, p.y, Math.max(0.4, p.r * p.life), 0, TAU); g.fill();
      return true;
    });
    S.rings = S.rings.filter(r => {
      r.r += (240 + r.r * 2.4) * dt; r.life -= 0.72 * dt;
      if (r.life <= 0 || r.r > r.max) return false;
      g.strokeStyle = (r.buy ? UP : DOWN) + (r.life * 0.8).toFixed(3) + ')';
      g.lineWidth = 2 + r.life * 3;
      g.beginPath(); g.arc(r.x, r.y, r.r, 0, TAU); g.stroke();
      return true;
    });

    // rolling price oscilloscope
    S.acc += dt;
    if (S.acc > 0.05 && M.price) { S.acc = 0; S.tape.push(M.price); if (S.tape.length > 360) S.tape.shift(); }
    if (S.tape.length > 2) {
      g.strokeStyle = Viz.col(0, 100, 58); g.lineWidth = 2;
      Viz.glowOn(g, Viz.col(0, 100, 55), 1);
      g.beginPath();
      S.tape.forEach((p, i) => { const x = i / 359 * W, y = priceToY(p); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.stroke(); Viz.glowOff(g);
    }

    // order-size spectrum: segmented bars, buy/sell colored, falling caps
    const NB = F.TB, sw = W - 44, sx = 22, sy = H - 14, sh = H * 0.16, bw = sw / NB;
    for (let i = 0; i < NB; i++) {
      const h2 = F.tradeBars[i] * sh, x = sx + i * bw;
      g.fillStyle = (F.tradeBuy[i] > 0.5 ? UP : DOWN) + '1)';
      const segs = Math.ceil(h2 / 6);
      for (let s2 = 0; s2 < segs; s2++) {
        g.globalAlpha = 0.25 + 0.75 * (s2 / Math.max(1, sh / 6));
        g.fillRect(x + 1, sy - s2 * 6 - 4, bw - 3, 4);
      }
      g.globalAlpha = 1;
      g.fillStyle = '#e8ecf2';
      g.fillRect(x + 1, sy - F.tradeCaps[i] * sh - 5, bw - 3, 2);
    }

    // HUD: price + session + H/L + pressure + whale tape
    g.globalCompositeOperation = 'source-over';
    const c = M.priceDelta >= 0;
    const fs = Math.max(16, Math.min(W, H) / 14);
    g.font = `bold ${fs}px monospace`;
    g.fillStyle = (c ? UP : DOWN) + '1)';
    if (M.price) g.fillText('$' + Math.round(M.price).toLocaleString(), 22, 30 + fs * 0.8);
    g.font = `${fs * 0.34}px monospace`;
    g.fillText((c ? '▲ +' : '▼ ') + M.priceDelta.toFixed(2) + '%  SESSION', 24, 40 + fs * 1.2);
    if (isFinite(M.hi)) {
      g.fillStyle = 'rgba(160,170,190,0.8)';
      g.fillText(`H $${Math.round(M.hi).toLocaleString()}   L $${Math.round(M.lo).toLocaleString()}`, 24, 48 + fs * 1.6);
    }
    // pressure bar (10s)
    const pw = Math.min(230, W * 0.3), px = W - pw - 22, bp = M.buyPct / 100;
    g.fillStyle = 'rgba(160,170,190,0.8)'; g.font = `${Math.max(8, fs * 0.28)}px monospace`;
    g.textAlign = 'right'; g.fillText('BUY / SELL PRESSURE · 10s', W - 22, 34); g.textAlign = 'left';
    g.fillStyle = '#0f1319'; g.fillRect(px, 40, pw, 9);
    g.fillStyle = UP + '0.9)'; g.fillRect(px, 40, pw * bp, 9);
    g.fillStyle = DOWN + '0.9)'; g.fillRect(px + pw * bp, 40, pw * (1 - bp), 9);
    g.fillStyle = 'rgba(160,170,190,0.8)';
    g.textAlign = 'right'; g.fillText(`${Math.round(M.buyPct)} / ${100 - Math.round(M.buyPct)}`, W - 22, 62);
    // whale tape
    g.fillText('WHALE TAPE ≥ 2.0 BTC', W - 22, 84);
    F.marketWhales.forEach((w2, i) => {
      g.fillStyle = (w2.buy ? UP : DOWN) + '0.95)';
      g.fillText(`${w2.buy ? 'BUY ' : 'SELL'} ${w2.size.toFixed(2)} @ $${Math.round(w2.price).toLocaleString()}`, W - 22, 102 + i * 15);
    });
    g.textAlign = 'left';
  },
});

/* ================= FRACTAL ENGINE (WebGL, smooth coloring) =================
   GPU escape-time fractals with log-log smooth iteration coloring. Uniforms are
   driven by the live network signal; falls back to a CPU render if WebGL fails. */
const Fractal = {
  ok: null, size: [0, 0],
  init() {
    if (this.ok !== null) return this.ok;
    try {
      this.cv = document.createElement('canvas');
      const gl = this.gl = this.cv.getContext('webgl', { antialias: false, depth: false, preserveDrawingBuffer: true });
      if (!gl) throw 0;
      const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
      const fs = `precision highp float;
uniform vec2 res;uniform vec2 cc;uniform vec2 ctr;uniform float zm;uniform float hue;
uniform float sat;uniform float en;uniform float md;
vec3 h2r(float h,float s,float v){vec3 k=abs(mod(h*6.+vec3(0.,4.,2.),6.)-3.)-1.;return v*mix(vec3(1.),clamp(k,0.,1.),s);}
void main(){
  vec2 uv=(gl_FragCoord.xy-.5*res)/min(res.x,res.y)*3./zm+ctr;
  vec2 z,c2;
  if(md<.5){z=uv;c2=cc;}else{z=vec2(0.);c2=uv;}
  float n=-1.;vec2 zz=z;float m2=0.;
  for(int i=0;i<220;i++){
    zz=vec2(zz.x*zz.x-zz.y*zz.y,2.*zz.x*zz.y)+c2;
    m2=dot(zz,zz);
    if(m2>256.){n=float(i);break;}
  }
  if(n<0.){gl_FragColor=vec4(h2r(hue,sat*.5,.05+en*.04),1.);return;}
  float sn=n-log2(log2(m2))+4.;
  float t=sn*.016;
  float v=clamp(1.-exp(-sn*.085),0.,1.);
  float band=.55+.45*sin(t*6.28318+en);
  vec3 col=h2r(fract(hue+t*.9),sat,(.06+.94*v*band)*(.5+en*.7));
  col+=vec3(1.,.95,.8)*pow(v,16.)*(.3+en*.7);
  gl_FragColor=vec4(col,1.);
}`;
      const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(sh); return sh; };
      const pr = this.pr = gl.createProgram();
      gl.attachShader(pr, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, mk(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(pr); if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw 0;
      gl.useProgram(pr);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(pr, 'p');
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.u = {}; for (const n of ['res', 'cc', 'ctr', 'zm', 'hue', 'sat', 'en', 'md']) this.u[n] = gl.getUniformLocation(pr, n);
      this.ok = true;
    } catch (e) { this.ok = false; }
    return this.ok;
  },
  render(W, H, o) {
    const gl = this.gl, w = Math.max(64, W >> 1), h = Math.max(64, H >> 1);
    if (this.size[0] !== w || this.size[1] !== h) { this.cv.width = w; this.cv.height = h; gl.viewport(0, 0, w, h); this.size = [w, h]; }
    gl.uniform2f(this.u.res, w, h);
    gl.uniform2f(this.u.cc, o.cx, o.cy);
    gl.uniform2f(this.u.ctr, o.px, o.py);
    gl.uniform1f(this.u.zm, o.zoom);
    gl.uniform1f(this.u.hue, o.hue);
    gl.uniform1f(this.u.sat, o.sat);
    gl.uniform1f(this.u.en, o.energy);
    gl.uniform1f(this.u.md, o.mandel ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.cv;
  },
  /* CPU fallback at low resolution */
  cpu(S, W, H, o) {
    const w = 128, h = 72;
    if (!S.off) { S.off = document.createElement('canvas'); S.off.width = w; S.off.height = h; S.og = S.off.getContext('2d'); S.img = S.og.createImageData(w, h); }
    const d = S.img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let zx, zy, cx2, cy2;
      const ux = (x - w / 2) / (h / 2) * 1.5 / o.zoom + o.px, uy = (y - h / 2) / (h / 2) * 1.5 / o.zoom + o.py;
      if (o.mandel) { zx = 0; zy = 0; cx2 = ux; cy2 = uy; } else { zx = ux; zy = uy; cx2 = o.cx; cy2 = o.cy; }
      let i = 0, m2 = 0;
      for (; i < 80; i++) { const t2 = zx * zx - zy * zy + cx2; zy = 2 * zx * zy + cy2; zx = t2; m2 = zx * zx + zy * zy; if (m2 > 64) break; }
      const k = (y * w + x) * 4;
      if (i >= 80) { d[k] = d[k + 1] = d[k + 2] = 8; d[k + 3] = 255; }
      else {
        const sn = i - Math.log2(Math.log2(m2)) + 4;
        const c = hslToRgb(((o.hue * 360 + sn * 6) % 360) / 360, o.sat, clamp(0.2 + 0.5 * (0.5 + 0.5 * Math.sin(sn * 0.4)), 0, 0.85) * (0.55 + o.energy * 0.6));
        d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = 255;
      }
    }
    S.og.putImageData(S.img, 0, 0);
    return S.off;
  },
};

/* ================= 14. JULIA DRIFT ================= */
Viz.register({
  name: 'JULIA DRIFT',
  noFade: true,
  draw(g, W, H, F, P, t, S, dt) {
    if (!S.ph) { S.ph = Math.random() * TAU; S.zoom = 1; S.rot = 0; }
    // the Julia constant orbits the cardioid rim; network activity bends the orbit
    S.ph += dt * (0.11 + F.level * 0.25);
    S.rot += dt * 0.05 * P.speed;
    const wob = Math.sin(t * 0.7) * 0.02 + F.bass * 0.05;
    const r = 0.7885 + wob * 0.4;
    const o = {
      cx: r * Math.cos(S.ph), cy: r * Math.sin(S.ph),
      px: 0, py: 0,
      zoom: (1.18 + F.beat * 0.3 + F.level * 0.18) * P.zoom,
      hue: Viz.hue(0) / 360, sat: Viz.pals[Viz.pal] === 'MONO' ? 0.15 : 0.85,
      energy: clamp(F.level * P.sens * 1.6 + F.blockFlash * 0.8, 0.1, 1.6),
      mandel: false,
    };
    const src = Fractal.init() ? Fractal.render(W, H, o) : Fractal.cpu(S, W, H, o);
    g.imageSmoothingEnabled = true;
    g.save(); g.translate(W / 2, H / 2); g.rotate(S.rot); g.scale(1.08, 1.08); g.translate(-W / 2, -H / 2);
    g.drawImage(src, 0, 0, W, H); g.restore();
    // spectrum halo ring around the fractal
    g.globalCompositeOperation = 'lighter';
    const R = Math.min(W, H) * 0.47;
    for (let i = 0; i < F.N; i += 2) {
      const v = Viz.spec(i, F); if (v < 0.05) continue;
      const a = i / F.N * TAU - Math.PI / 2 + S.rot;
      g.strokeStyle = Viz.col(i * 2, 90, 60, v * 0.5);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(W / 2 + Math.cos(a) * R, H / 2 + Math.sin(a) * R);
      g.lineTo(W / 2 + Math.cos(a) * (R + v * 40), H / 2 + Math.sin(a) * (R + v * 40));
      g.stroke();
    }
  },
});

/* ================= 15. MANDEL DEEP ================= */
Viz.register({
  name: 'MANDEL DEEP',
  noFade: true,
  draw(g, W, H, F, P, t, S, dt) {
    if (!S.z) { S.z = 0.8; S.tgt = 0; }
    // breathe into seahorse valley; a found block warps to a new locus
    const loci = [
      [-0.743643887037151, 0.13182590420533],
      [-0.101096, 0.956286], [-1.25066, 0.02012],
      [0.2549870375144766, -0.0005679790528465], [-1.7862712, 0.0],
    ];
    if (S.lastBlocks === undefined) S.lastBlocks = F.blockEvents;
    if (F.blockEvents > S.lastBlocks) { S.lastBlocks = F.blockEvents; S.tgt = (S.tgt + 1) % loci.length; S.z = Math.min(S.z, 60); }
    const [px, py] = loci[S.tgt];
    // log-space zoom cycle, sped up by network level; loops before precision dies
    S.z *= 1 + dt * (0.22 + F.level * 0.5) * P.speed;
    if (S.z > 22000) S.z = 0.8;
    const o = {
      cx: 0, cy: 0, px, py,
      zoom: S.z * P.zoom,
      hue: Viz.hue(0) / 360, sat: Viz.pals[Viz.pal] === 'MONO' ? 0.15 : 0.8,
      energy: clamp(0.25 + F.level * P.sens * 1.3 + F.beat * 0.5, 0.1, 1.6),
      mandel: true,
    };
    const src = Fractal.init() ? Fractal.render(W, H, o) : Fractal.cpu(S, W, H, o);
    g.imageSmoothingEnabled = true;
    g.drawImage(src, 0, 0, W, H);
    // waveform ribbon across the deep
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = Viz.col(40, 100, 65, 0.5); g.lineWidth = 2;
    Viz.glowOn(g, Viz.col(40, 100, 55), 0.8);
    g.beginPath();
    const n = F.wave.length;
    for (let i = 0; i < n; i++) {
      const s2 = F.wave[(F.wavePos + i) % n] * P.sens;
      const x = i / (n - 1) * W, y = H * 0.86 + s2 * H * 0.1;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke(); Viz.glowOff(g);
    g.font = `${Math.max(9, H / 42)}px monospace`;
    g.fillStyle = Viz.col(0, 40, 80, 0.7);
    g.fillText('DEPTH ' + S.z.toFixed(1) + 'x', 16, H - 14);
  },
});

/* ================= 16. HALVING SPIRAL ================= */
Viz.register({
  name: 'HALVING SPIRAL',
  draw(g, W, H, F, P, t, S) {
    Viz.drawArt(g, W, H, 0.07);
    const cx = W / 2, cy = H / 2;
    const h = F.S.height || 0;
    const HALVING = 210000, next = (Math.floor(h / HALVING) + 1) * HALVING;
    const left = next - h, frac = 1 - left / HALVING;
    g.globalCompositeOperation = 'lighter';
    vSym(g, W, H, P.sym, () => {
      // spiral of blocks: one dot ≈ 500 blocks of the current epoch
      const dots = Math.round(HALVING / 500);
      for (let i = 0; i < dots * frac; i++) {
        const p = i / dots;
        const a = p * TAU * 7 + t * 0.15;
        const r = (0.06 + p * 0.42) * Math.min(W, H);
        const v = Viz.spec(Math.floor(p * 63), F);
        g.fillStyle = Viz.col(p * 120, 90, 45 + v * 35, 0.5 + v * 0.5);
        const sz = 1.5 + v * 5 + (i > dots * frac - 3 ? F.beat * 6 : 0);
        g.fillRect(cx + Math.cos(a) * r - sz / 2, cy + Math.sin(a) * r - sz / 2, sz, sz);
      }
    });
    // countdown core
    g.textAlign = 'center';
    g.fillStyle = Viz.col(40, 100, 70, 0.95);
    Viz.glowOn(g, Viz.col(40, 100, 55), 1.5);
    g.font = `bold ${Math.max(14, Math.min(W, H) / 16)}px monospace`;
    g.fillText(left.toLocaleString(), cx, cy - 4);
    Viz.glowOff(g);
    g.font = `${Math.max(9, Math.min(W, H) / 42)}px monospace`;
    g.fillStyle = Viz.col(0, 50, 75, 0.8);
    g.fillText('BLOCKS TO HALVING · EPOCH ' + (Math.floor(h / HALVING) + 1), cx, cy + Math.min(W, H) / 24);
    g.fillText('SUBSIDY ' + (50 / Math.pow(2, Math.floor(h / HALVING))).toFixed(3) + ' ₿ → ' + (50 / Math.pow(2, Math.floor(h / HALVING) + 1)).toFixed(4) + ' ₿', cx, cy + Math.min(W, H) / 24 * 2.3);
    g.textAlign = 'left';
  },
});

/* ================= 17. AVS SUPERSCOPE =================
   Homage to Winamp AVS superscopes: a parametric point-scope whose equation
   is warped by the waveform and spectrum, drawn with additive trails. */
Viz.register({
  name: 'AVS SUPERSCOPE',
  draw(g, W, H, F, P, t, S) {
    const N = 220 * P.density;
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.4;
    g.globalCompositeOperation = 'lighter';
    vSym(g, W, H, P.sym, () => {
      let px = 0, py = 0;
      for (let i = 0; i < N; i++) {
        const p = i / N;
        const w = F.wave[Math.floor(p * (F.wave.length - 1) + F.wavePos) % F.wave.length] * P.sens;
        const sp = Viz.spec(Math.floor(p * 63), F);
        // the classic "spiral scope" equation, bent by the network
        const a = p * TAU * (2 + Math.sin(t * 0.23) * 1.5) + t * 0.7;
        const r = R * (0.3 + 0.45 * Math.sin(p * Math.PI) + w * 0.35 + sp * 0.2 + F.beat * 0.12);
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * (0.72 + 0.28 * Math.sin(t * 0.4));
        if (i) {
          g.strokeStyle = Viz.col(p * 160 + sp * 60, 95, 52 + sp * 30, 0.7);
          g.lineWidth = 1.2 + sp * 3 + F.beat;
          g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke();
        }
        px = x; py = y;
      }
    });
  },
});

/* ================= 18. GEISS TERRAIN =================
   Rolling plasma mountains a la the Geiss plugin: a scrolling heightfield
   ridged by the spectrum, drawn as glowing horizon lines. */
Viz.register({
  name: 'GEISS TERRAIN',
  draw(g, W, H, F, P, t, S, dt) {
    if (!S.rows) { S.rows = []; S.acc = 9; }
    S.acc += dt * (3 + F.level * 9) * P.speed;
    while (S.acc >= 1) { // birth a new ridge at the horizon from the live spectrum
      S.acc -= 1;
      const ridge = new Float32Array(48);
      for (let i = 0; i < 48; i++) {
        const v = Viz.spec(Math.floor(Math.abs(i - 24) / 24 * 60), F);
        ridge[i] = v + (Math.random() - 0.5) * 0.06;
      }
      S.rows.unshift(ridge);
      if (S.rows.length > 26) S.rows.pop();
    }
    const horizon = H * 0.36;
    g.globalCompositeOperation = 'lighter';
    // sun: block-flash supernova
    g.fillStyle = Viz.col(40, 100, 60, 0.8 + F.blockFlash * 0.2);
    Viz.glowOn(g, Viz.col(40, 100, 55), 1.6 + F.blockFlash * 2);
    g.beginPath(); g.arc(W / 2, horizon - H * 0.1, H * (0.05 + F.bass * 0.03 + F.blockFlash * 0.05), 0, TAU); g.fill();
    Viz.glowOff(g);
    S.rows.forEach((ridge, ri) => {
      const p = ri / 26;
      const y0 = horizon + Math.pow(p, 1.6) * (H - horizon);
      const amp = H * 0.3 * Math.pow(p, 0.8);
      const spread = lerp(W * 0.18, W * 0.62, p);
      g.strokeStyle = Viz.col(p * 70, 90, lerp(68, 32, p), 0.85 - p * 0.3);
      g.lineWidth = 1.4 + p * 2;
      g.beginPath();
      for (let i = 0; i < 48; i++) {
        const x = W / 2 + (i / 47 - 0.5) * 2 * spread;
        const y = y0 - ridge[i] * amp * P.sens;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    });
  },
});

/* ================= 19. G-FORCE WAVES =================
   Layered flowing waveforms with mirror symmetry, in the spirit of G-Force. */
Viz.register({
  name: 'G-FORCE WAVES',
  draw(g, W, H, F, P, t, S) {
    g.globalCompositeOperation = 'lighter';
    const layers = Math.round(5 * P.density) + 2;
    for (let L = 0; L < layers; L++) {
      const lp = L / (layers - 1);
      const yc = H * (0.2 + lp * 0.6);
      const ph = t * (0.6 + lp) + L * 2.1;
      g.strokeStyle = Viz.col(L * 34, 92, 58, 0.55);
      g.lineWidth = 1.6 + F.bass * 3 * (1 - lp);
      Viz.glowOn(g, Viz.col(L * 34, 100, 55), 0.6);
      g.beginPath();
      const n = F.wave.length;
      for (let i = 0; i <= n; i++) {
        const w = F.wave[(F.wavePos + i) % n] * P.sens;
        const x = i / n * W;
        const y = yc + Math.sin(i / n * TAU * (1.5 + lp * 2) + ph) * H * 0.06 * (1 + F.level)
                + w * H * 0.16 * (1 - lp * 0.5);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
      // mirrored ghost
      g.globalAlpha = 0.35;
      g.save(); g.translate(0, H); g.scale(1, -1); g.stroke(); g.restore();
      g.globalAlpha = 1;
    }
    Viz.glowOff(g);
  },
});

/* ================= 20. BEAT CUBE =================
   Wireframe cube spinning in 3D; trades spark its edges, blocks detonate it. */
Viz.register({
  name: 'BEAT CUBE',
  draw(g, W, H, F, P, t, S, dt) {
    if (!S.rot) S.rot = { x: 0.4, y: 0.2, z: 0 };
    S.rot.x += dt * 0.5 * P.speed; S.rot.y += dt * 0.7 * P.speed + F.bass * dt * 2; S.rot.z += dt * 0.3;
    const size = Math.min(W, H) * 0.22 * (1 + F.beat * 0.35) * (F.blockFlash > 0.6 ? 1.3 : 1);
    const V = [];
    for (let i = 0; i < 8; i++) V.push([(i & 1 ? 1 : -1), (i & 2 ? 1 : -1), (i & 4 ? 1 : -1)]);
    const E = [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
    const { x: rx, y: ry, z: rz } = S.rot;
    const proj = V.map(([x, y, z]) => {
      let [a, b] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)]; y = a; z = b;
      [a, b] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)]; x = a; z = b;
      [a, b] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)]; x = a; y = b;
      const d = 3.2 / (3.2 + z);
      return [W / 2 + x * size * d, H / 2 + y * size * d, d];
    });
    g.globalCompositeOperation = 'lighter';
    vSym(g, W, H, Math.min(P.sym, 4), () => {
      E.forEach(([a2, b2], i) => {
        const v = Viz.spec(i * 5, F);
        g.strokeStyle = Viz.col(i * 24, 95, 50 + v * 35, 0.85);
        g.lineWidth = 1.5 + v * 5;
        Viz.glowOn(g, Viz.col(i * 24, 100, 55), 0.6 + v);
        g.beginPath(); g.moveTo(proj[a2][0], proj[a2][1]); g.lineTo(proj[b2][0], proj[b2][1]); g.stroke();
      });
      Viz.glowOff(g);
      proj.forEach((p2, i) => {
        g.fillStyle = Viz.col(i * 40, 90, 70, 0.9);
        g.beginPath(); g.arc(p2[0], p2[1], (2 + F.treble * 5) * p2[2], 0, TAU); g.fill();
      });
    });
  },
});

/* ================= 21. BAR GALAXY 3D =================
   WhiteCap-style: the spectrum wrapped around a rotating 3D ring platform. */
Viz.register({
  name: 'BAR GALAXY 3D',
  draw(g, W, H, F, P, t, S) {
    const cx = W / 2, cy = H * 0.56, R = Math.min(W, H) * 0.34;
    const rot = t * 0.5 * P.speed;
    const tilt = 0.42;
    const bars = [];
    for (let i = 0; i < F.N; i++) {
      const a = i / F.N * TAU + rot;
      const v = Viz.spec(i, F);
      const x3 = Math.cos(a) * R, z3 = Math.sin(a) * R;
      bars.push({ x: cx + x3, y: cy + z3 * tilt, h: v * H * 0.3 * (1 + F.beat * 0.2), depth: z3, i, v });
    }
    bars.sort((a, b) => a.depth - b.depth); // paint back-to-front
    g.globalCompositeOperation = 'lighter';
    for (const b of bars) {
      const near = (b.depth / R + 1) / 2; // 0 back … 1 front
      const w = 3 + near * 6;
      const grad = g.createLinearGradient(0, b.y - b.h, 0, b.y);
      grad.addColorStop(0, Viz.col(b.i * 4 + 70, 100, 65, 0.35 + near * 0.6));
      grad.addColorStop(1, Viz.col(b.i * 4, 85, 30, 0.25 + near * 0.4));
      g.fillStyle = grad;
      if (b.v > 0.4) Viz.glowOn(g, Viz.col(b.i * 4, 100, 55), b.v * near);
      g.fillRect(b.x - w / 2, b.y - b.h, w, b.h + 2);
      Viz.glowOff(g);
    }
    // hub readout
    g.fillStyle = Viz.col(40, 90, 70, 0.9);
    g.font = `bold ${Math.max(11, H / 30)}px monospace`; g.textAlign = 'center';
    g.fillText(F.S.txRate.toFixed(1) + ' TX/S', cx, cy + 6); g.textAlign = 'left';
  },
});

/* ================= 22. TUNNEL SCOPE =================
   Tripex-style: rings of the live waveform receding into a twisting tunnel. */
Viz.register({
  name: 'TUNNEL SCOPE',
  draw(g, W, H, F, P, t, S, dt) {
    if (!S.rings) { S.rings = []; S.acc = 1; }
    S.acc += dt * (5 + F.S.txRate * 0.5) * P.speed;
    while (S.acc >= 1) {
      S.acc -= 1;
      const snap = new Float32Array(64);
      for (let i = 0; i < 64; i++) snap[i] = F.wave[(F.wavePos + Math.floor(i / 64 * F.wave.length)) % F.wave.length];
      S.rings.unshift({ z: 0, w: snap, beat: F.beat });
      if (S.rings.length > 34) S.rings.pop();
    }
    const cx = W / 2 + Math.sin(t * 0.6) * W * 0.08, cy = H / 2 + Math.cos(t * 0.45) * H * 0.08;
    g.globalCompositeOperation = 'lighter';
    for (let ri = S.rings.length - 1; ri >= 0; ri--) {
      const ring = S.rings[ri];
      ring.z += dt * (0.55 + F.level * 0.7) * P.speed;
      const p = clamp(ring.z, 0, 1);
      const R = Math.pow(p, 1.7) * Math.hypot(W, H) * 0.62 + 4;
      const twist = t * 0.8 + ri * 0.14;
      g.strokeStyle = Viz.col(ri * 9 + p * 60, 92, 30 + p * 45, 0.12 + p * 0.75);
      g.lineWidth = 1 + p * 2.6 + ring.beat * 2;
      g.beginPath();
      for (let i = 0; i <= 64; i++) {
        const a = i / 64 * TAU + twist;
        const w = ring.w[i % 64] * P.sens;
        const r2 = R * (1 + w * 0.3);
        const x = cx + Math.cos(a) * r2, y = cy + Math.sin(a) * r2;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
    S.rings = S.rings.filter(r2 => r2.z < 1.05);
  },
});
