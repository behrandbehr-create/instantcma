/* BTCAMP — app shell: window manager, controls, EQ, playlist, marquee, render loop. */
'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

/* =============== persistence =============== */
const Store = {
  load() { try { return JSON.parse(localStorage.getItem('btcamp_cfg') || '{}'); } catch (e) { return {}; } },
  save(patch) {
    try {
      const c = Object.assign(this.load(), patch);
      localStorage.setItem('btcamp_cfg', JSON.stringify(c));
    } catch (e) {}
  },
};
const CFG = Store.load();

/* =============== window manager =============== */
const WM = {
  z: 10,
  init() {
    $$('.win').forEach(w => {
      w.addEventListener('pointerdown', () => { w.style.zIndex = ++this.z; });
      const pos = (CFG.pos || {})[w.id];
      if (pos) { w.style.left = pos[0] + 'px'; w.style.top = pos[1] + 'px'; }
    });
    $$('.titlebar').forEach(tb => {
      const w = document.getElementById(tb.dataset.win);
      tb.addEventListener('pointerdown', (e) => {
        if (e.target.classList.contains('tb-btn')) return;
        const sx = e.clientX - w.offsetLeft, sy = e.clientY - w.offsetTop;
        const move = (ev) => {
          w.style.left = Math.max(-w.offsetWidth + 60, Math.min(innerWidth - 40, ev.clientX - sx)) + 'px';
          w.style.top = Math.max(0, Math.min(innerHeight - 24, ev.clientY - sy)) + 'px';
        };
        const up = () => {
          removeEventListener('pointermove', move); removeEventListener('pointerup', up);
          const pos = CFG.pos || {}; pos[w.id] = [w.offsetLeft, w.offsetTop];
          CFG.pos = pos; Store.save({ pos });
        };
        addEventListener('pointermove', move); addEventListener('pointerup', up);
      });
      tb.addEventListener('dblclick', (e) => { if (!e.target.classList.contains('tb-btn')) w.classList.toggle('shaded'); });
    });
    $$('[data-close]').forEach(b => b.addEventListener('click', () => this.toggle(b.dataset.close, false)));
    $$('[data-shade]').forEach(b => b.addEventListener('click', () => document.getElementById(b.dataset.shade).classList.toggle('shaded')));
  },
  toggle(id, force) {
    const w = document.getElementById(id);
    const show = force !== undefined ? force : w.classList.contains('hidden');
    w.classList.toggle('hidden', !show);
    if (show) w.style.zIndex = ++this.z;
    if (id === 'win-eq') $('#tg-eq').classList.toggle('on', show);
    if (id === 'win-pl') $('#tg-pl').classList.toggle('on', show);
    return show;
  },
  visible(id) { return !document.getElementById(id).classList.contains('hidden'); },
};

/* =============== widgets =============== */
/* Pointer-captured drag: no text selection, keeps tracking outside the element,
   works with touch, and releases cleanly. */
function capDrag(el, onMove, onDown, onUp) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    el.classList.add('dragging');
    if (onDown) onDown(e);
    onMove(e);
    const mv = (ev) => { ev.preventDefault(); onMove(ev); };
    const up = (ev) => {
      el.classList.remove('dragging');
      el.removeEventListener('pointermove', mv);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      try { el.releasePointerCapture(ev.pointerId); } catch (err) {}
      if (onUp) onUp(ev);
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
}

function makeHSlider(el, get, set, fmt) {
  const thumb = el.querySelector('.thumb'), fill = el.querySelector('.fill');
  const render = () => {
    const f = clamp(get(), 0, 1);
    thumb.style.left = `calc(${(f * 100).toFixed(1)}% - ${(f * 20).toFixed(0)}px)`;
    if (fill) fill.style.width = (f * 100).toFixed(1) + '%';
    if (fmt) el.title = fmt(f);
  };
  capDrag(el, (e) => {
    const r = el.getBoundingClientRect();
    set(clamp((e.clientX - r.left) / r.width, 0, 1)); render();
  });
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    set(clamp(get() + (e.deltaY < 0 ? 0.05 : -0.05), 0, 1)); render();
  }, { passive: false });
  render();
  return { render };
}

function makeVSlider(el, get, set) {
  const thumb = el.querySelector('.thumb');
  const render = () => {
    const f = clamp(get(), 0, 1);
    thumb.style.top = `calc(${((1 - f) * 100).toFixed(1)}% - ${((1 - f) * 12).toFixed(0)}px)`;
  };
  capDrag(el, (e) => {
    const r = el.getBoundingClientRect();
    set(clamp(1 - (e.clientY - r.top) / r.height, 0, 1)); render();
  });
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    set(clamp(get() + (e.deltaY < 0 ? 0.05 : -0.05), 0, 1)); render();
  }, { passive: false });
  render();
  return { render };
}

function makeKnob(wrap, opts) {
  const knob = document.createElement('div'); knob.className = 'knob';
  const ptr = document.createElement('div'); ptr.className = 'ptr'; knob.appendChild(ptr);
  const label = document.createElement('label'); label.textContent = opts.label;
  const kval = document.createElement('div'); kval.className = 'kval';
  wrap.appendChild(knob); wrap.appendChild(label); wrap.appendChild(kval);
  const render = () => {
    const f = (opts.get() - opts.min) / (opts.max - opts.min);
    ptr.style.transform = `rotate(${(-135 + f * 270).toFixed(1)}deg) translateY(3px)`;
    kval.textContent = opts.fmt ? opts.fmt(opts.get()) : opts.get().toFixed(2);
  };
  let startX = 0, startY = 0, startV = 0;
  capDrag(knob, (e) => {
    // drag up OR right to increase — whichever way the hand wants to move
    const d = (startY - e.clientY) + (e.clientX - startX);
    let v = startV + d / 160 * (opts.max - opts.min);
    if (opts.step) v = Math.round(v / opts.step) * opts.step;
    opts.set(clamp(v, opts.min, opts.max)); render();
  }, (e) => { startX = e.clientX; startY = e.clientY; startV = opts.get(); },
     () => Deck.saveParams());
  knob.addEventListener('wheel', (e) => {
    e.preventDefault();
    const stp = opts.step || (opts.max - opts.min) / 40;
    opts.set(clamp(opts.get() + (e.deltaY < 0 ? stp : -stp), opts.min, opts.max));
    render(); Deck.saveParams();
  }, { passive: false });
  knob.addEventListener('dblclick', () => { opts.set(opts.def !== undefined ? opts.def : (opts.min + opts.max) / 2); render(); Deck.saveParams(); });
  render();
  return { render };
}

/* =============== visualizer deck =============== */
const Deck = {
  knobs: [],
  defs: [
    { key: 'speed',   label: 'SPEED',  min: 0.2, max: 3,   def: 1,    fmt: v => v.toFixed(1) + 'x' },
    { key: 'trails',  label: 'TRAILS', min: 0,   max: 1,   def: 0.65, fmt: v => Math.round(v * 100) + '%' },
    { key: 'glow',    label: 'GLOW',   min: 0,   max: 1,   def: 0.6,  fmt: v => Math.round(v * 100) + '%' },
    { key: 'hue',     label: 'HUE',    min: 0,   max: 360, def: 30,   fmt: v => Math.round(v) + '°' },
    { key: 'density', label: 'DENSITY',min: 0.2, max: 2,   def: 1,    fmt: v => v.toFixed(1) + 'x' },
    { key: 'sens',    label: 'SENS',   min: 0.2, max: 2.5, def: 1,    fmt: v => v.toFixed(1) + 'x' },
    { key: 'sym',     label: 'SYMMETRY',min: 1,  max: 8,   def: 1, step: 1, fmt: v => Math.round(v) + 'X' },
    { key: 'zoom',    label: 'ZOOM',   min: 0.5, max: 1.8, def: 1,    fmt: v => v.toFixed(2) + 'x' },
  ],
  init() {
    if (CFG.viz) Object.assign(Viz.P, CFG.viz);
    const host = $('#viz-knobs');
    this.defs.forEach(d => {
      const wrap = document.createElement('div'); wrap.className = 'knob-wrap'; host.appendChild(wrap);
      this.knobs.push(makeKnob(wrap, { ...d, get: () => Viz.P[d.key], set: (v) => { Viz.P[d.key] = v; } }));
    });
    Viz.attach($('#viz-canvas'));
    Viz.set(CFG.mode || 0); this.updateModeLCD(false);
    $('#viz-prev').addEventListener('click', () => { Viz.prev(); this.updateModeLCD(); });
    $('#viz-next').addEventListener('click', () => { Viz.next(); this.updateModeLCD(); });
    $('#viz-auto').addEventListener('click', (e) => { Viz.auto = !Viz.auto; e.target.classList.toggle('on', Viz.auto); $('#tg-shuffle').classList.toggle('on', Viz.auto); });
    $('#viz-rnd').addEventListener('click', () => this.randomize());
    $('#viz-fs').addEventListener('click', () => this.fullscreen());
    $('#viz-screen').addEventListener('dblclick', () => this.fullscreen());
    $('#viz-crt').addEventListener('click', () => {
      const on = document.body.classList.toggle('crt');
      $('#viz-crt').classList.toggle('on', on);
      Store.save({ crt: on });
    });
    if (CFG.crt) { document.body.classList.add('crt'); $('#viz-crt').classList.add('on'); }
    if (CFG.pal) Viz.pal = CFG.pal % Viz.pals.length;
    $('#viz-pal').addEventListener('click', () => this.cyclePal());
    // data-source selector
    if (CFG.src) Feeds.srcIdx = CFG.src % Feeds.srcModes.length;
    $('#src-name').textContent = Feeds.srcModes[Feeds.srcIdx];
    const src = (dir) => {
      $('#src-name').textContent = Feeds.cycleSrc(dir);
      Store.save({ src: Feeds.srcIdx });
      this.toast('SOURCE: ' + Feeds.srcModes[Feeds.srcIdx]);
    };
    $('#src-prev').addEventListener('click', () => src(-1));
    $('#src-next').addEventListener('click', () => src(1));
    $('#viz-src-lcd').addEventListener('wheel', (e) => { e.preventDefault(); src(e.deltaY > 0 ? 1 : -1); }, { passive: false });
  },
  cyclePal() {
    const name = Viz.cyclePal();
    Store.save({ pal: Viz.pal });
    const osd = $('#viz-osd');
    osd.textContent = '◈ PALETTE: ' + name;
    osd.classList.add('show');
    clearTimeout(this._osdT); this._osdT = setTimeout(() => osd.classList.remove('show'), 1800);
  },
  toast(msg) {
    const el = $('#viz-toast');
    el.textContent = msg; el.classList.remove('show');
    void el.offsetWidth; el.classList.add('show');
  },
  updateModeLCD(save = true) {
    $('#viz-name').textContent = Viz.modes[Viz.idx].name;
    const osd = $('#viz-osd');
    osd.textContent = '▶ ' + Viz.modes[Viz.idx].name;
    osd.classList.add('show');
    clearTimeout(this._osdT); this._osdT = setTimeout(() => osd.classList.remove('show'), 1800);
    if (save) Store.save({ mode: Viz.idx });
  },
  randomize() {
    this.defs.forEach((d, i) => {
      let v = d.min + Math.random() * (d.max - d.min);
      if (d.step) v = Math.round(v);
      Viz.P[d.key] = v; this.knobs[i].render();
    });
    this.saveParams();
  },
  saveParams() { Store.save({ viz: { ...Viz.P } }); },
  fullscreen() {
    const fs = document.body.classList.toggle('fs');
    if (fs) { WM.toggle('win-viz', true); document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {}); }
    else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  },
};

/* =============== preset slots =============== */
const Presets = {
  slots: CFG.presets || [null, null, null, null],
  arm: false,
  init() {
    $('#ps-save').addEventListener('click', () => {
      this.arm = !this.arm;
      $('#ps-save').classList.toggle('arm', this.arm);
      $('#ps-hint').textContent = this.arm ? 'NOW CLICK A SLOT TO STORE' : 'CLICK A SLOT TO LOAD';
    });
    $$('#preset-strip .ps-slot').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = +btn.dataset.slot;
        if (this.arm) this.save(i); else this.load(i);
      });
    });
    this.paint();
  },
  save(i) {
    this.slots[i] = { mode: Viz.idx, P: { ...Viz.P }, pal: Viz.pal, src: Feeds.srcIdx, skin: Skin.idx };
    this.arm = false;
    $('#ps-save').classList.remove('arm');
    $('#ps-hint').textContent = 'STORED IN SLOT ' + (i + 1);
    Store.save({ presets: this.slots });
    this.paint(i);
    Deck.toast('PRESET ' + (i + 1) + ' SAVED');
  },
  load(i) {
    const s = this.slots[i];
    if (!s) { $('#ps-hint').textContent = 'SLOT ' + (i + 1) + ' EMPTY — SAVE FIRST'; return; }
    Object.assign(Viz.P, s.P);
    Viz.pal = s.pal; Feeds.srcIdx = s.src;
    $('#src-name').textContent = Feeds.srcModes[Feeds.srcIdx];
    if (s.skin !== undefined && s.skin < SKINS.length) { Skin.apply(s.skin); SkinsUI.applyHue(); }
    Viz.set(s.mode); Deck.updateModeLCD();
    Deck.knobs.forEach(k => k.render());
    Store.save({ viz: { ...Viz.P }, pal: Viz.pal, src: Feeds.srcIdx });
    this.paint(i);
    Deck.toast('PRESET ' + (i + 1) + ': ' + Viz.modes[Viz.idx].name);
  },
  paint(cur) {
    $$('#preset-strip .ps-slot').forEach((b, i) => {
      b.classList.toggle('has', !!this.slots[i]);
      b.classList.toggle('cur', i === cur);
    });
  },
};

/* =============== network EQ =============== */
const EQ = {
  sliders: {}, auto: false,
  init() {
    if (CFG.gains) Object.assign(Feeds.gains, CFG.gains);
    if (CFG.on) Object.assign(Feeds.on, CFG.on);
    if (CFG.preamp !== undefined) Feeds.preamp = CFG.preamp;
    const host = $('#eq-bands');
    const mk = (key, name, isPre) => {
      const band = document.createElement('div'); band.className = 'band' + (isPre ? ' preamp' : '');
      const db = document.createElement('div'); db.className = 'db';
      const sl = document.createElement('div'); sl.className = 'vslider';
      sl.innerHTML = '<div class="thumb"></div>';
      const lab = document.createElement('label'); lab.textContent = name;
      band.appendChild(db); band.appendChild(sl); band.appendChild(lab);
      host.appendChild(band);
      const get = () => (isPre ? Feeds.preamp : Feeds.gains[key]) / 2;
      const set = (f) => {
        if (isPre) Feeds.preamp = f * 2; else Feeds.gains[key] = f * 2;
        db.textContent = ((f * 2 - 1) >= 0 ? '+' : '') + ((f * 2 - 1) * 12).toFixed(0) + 'dB';
        Store.save({ gains: Feeds.gains, preamp: Feeds.preamp });
      };
      const s = makeVSlider(sl, get, set);
      set(get());
      this.sliders[isPre ? 'pre' : key] = { s, sl, set, get };
      if (!isPre) {
        lab.title = 'Click to toggle this data input on/off';
        lab.addEventListener('click', () => {
          Feeds.on[key] = Feeds.on[key] ? 0 : 1;
          sl.classList.toggle('off', !Feeds.on[key]);
          lab.style.textDecoration = Feeds.on[key] ? '' : 'line-through';
          Store.save({ on: Feeds.on });
        });
        if (!Feeds.on[key]) { sl.classList.add('off'); lab.style.textDecoration = 'line-through'; }
      }
    };
    mk(null, 'PREAMP', true);
    Feeds.bands.forEach(k => mk(k, Feeds.bandShort[k], false));
    $('#eq-on').addEventListener('click', (e) => { Feeds.eqOn = !Feeds.eqOn; e.target.classList.toggle('on', Feeds.eqOn); });
    $('#eq-auto').addEventListener('click', (e) => { this.auto = !this.auto; e.target.classList.toggle('on', this.auto); });
    $('#eq-reset').addEventListener('click', () => {
      Feeds.preamp = 1; this.sliders.pre.set(0.5); this.sliders.pre.s.render();
      Feeds.bands.forEach(k => { Feeds.gains[k] = 1; Feeds.on[k] = 1; const b = this.sliders[k]; b.set(0.5); b.s.render(); b.sl.classList.remove('off'); b.sl.parentElement.querySelector('label').style.textDecoration = ''; });
      Store.save({ gains: Feeds.gains, on: Feeds.on, preamp: 1 });
    });
    this.canvas = $('#eq-canvas'); this.g = this.canvas.getContext('2d');
  },
  tick(t, dt) {
    if (this.auto) { // gently ride the gains with network mood
      Feeds.bands.forEach((k, i) => {
        Feeds.gains[k] = clamp(Feeds.gains[k] + Math.sin(t * 0.3 + i * 1.7) * dt * 0.12, 0.4, 1.7);
        const b = this.sliders[k]; if (b) b.s.render();
      });
    }
    // curve: live spectrum + gain profile
    const g = this.g, c = this.canvas;
    if (!WM.visible('win-eq')) return;
    if (c.width !== c.clientWidth) { c.width = c.clientWidth || 200; c.height = c.clientHeight || 28; }
    const W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    const lf = getComputedStyle(document.documentElement).getPropertyValue('--lf').trim() || '#0f0';
    g.fillStyle = lf; g.globalAlpha = 0.7;
    for (let i = 0; i < Feeds.N; i++) {
      const v = clamp(Feeds.spec[i], 0, 1.2);
      g.fillRect(i / Feeds.N * W, H - v * H, W / Feeds.N - 1, v * H);
    }
    g.globalAlpha = 1; g.strokeStyle = lf; g.lineWidth = 1.5; g.beginPath();
    Feeds.bands.forEach((k, i) => {
      const x = (i + 0.5) / Feeds.bands.length * W, y = H - (Feeds.gains[k] * Feeds.on[k] / 2) * H;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.stroke();
  },
};

/* =============== playlist =============== */
const Playlist = {
  sel: -1,
  init() {
    Feeds.addListener('round', (r) => {
      const msg = (r.up ? '▲ ' : '▼ ') + '$' + r.level.toLocaleString();
      Deck.toast(msg); Marquee.flash(msg + (r.up ? ' CROSSED' : ' LOST'));
    });
    Feeds.addListener('whale', (w) => {
      if (w.size >= 10) Deck.toast(`🐋 ${w.buy ? 'BUY' : 'SELL'} ${w.size.toFixed(1)} BTC`);
    });
    Feeds.addListener('blocks', () => this.render());
    Feeds.addListener('block', (b) => { this.render(true); Marquee.flash(`⚡ BLOCK ${b.height} FOUND BY ${b.miner.toUpperCase()} · ${b.txs.toLocaleString()} TXS · ${(b.size / 1e6).toFixed(2)} MB · ${b.fees.toFixed(3)} ₿ FEES ⚡`); });
    $('#pl-open').addEventListener('click', () => {
      const b = Feeds.S.blocks[this.sel];
      if (b && b.hash && b.hash !== 'sim') window.open('https://mempool.space/block/' + b.hash, '_blank');
    });
    $('#pl-clear').addEventListener('click', () => { Feeds.S.blocks.splice(5); this.render(); });
  },
  fmtDur(s) { if (!s) return '--:--'; const m = Math.floor(s / 60); return m + ':' + String(Math.floor(s % 60)).padStart(2, '0'); },
  render(isNew) {
    const host = $('#pl-list');
    host.innerHTML = '';
    if (!Feeds.S.blocks.length) {
      host.innerHTML = '<div class="row"><span class="dim">AWAITING BLOCKS FROM THE NETWORK…</span></div>';
      $('#pl-total').textContent = '0 BLOCKS';
      return;
    }
    Feeds.S.blocks.forEach((b, i) => {
      const r = document.createElement('div');
      r.className = 'row' + (i === this.sel ? ' sel' : '') + (isNew && i === 0 ? ' new' : '');
      r.innerHTML = `<span class="num">${String(b.height).padStart(6, ' ')}.</span>` +
        `<span class="name">${b.miner} — ${b.txs.toLocaleString()} txs · ${(b.size / 1e6).toFixed(2)}MB · ${b.fees.toFixed(3)}₿</span>` +
        `<span class="len">${this.fmtDur(b.dur)}</span>`;
      r.addEventListener('click', () => { this.sel = i; this.render(); this.announce(b); });
      r.addEventListener('dblclick', () => { if (b.hash && b.hash !== 'sim') window.open('https://mempool.space/block/' + b.hash, '_blank'); });
      host.appendChild(r);
    });
    const tot = Feeds.S.blocks.reduce((a, b) => a + b.txs, 0);
    $('#pl-total').textContent = `${Feeds.S.blocks.length} BLOCKS · ${tot.toLocaleString()} TXS · TIP ${Feeds.S.height || '—'}`;
  },
  announce(b) {
    Marquee.flash(`BLOCK ${b.height} · ${b.miner.toUpperCase()} · ${b.txs.toLocaleString()} TXS · ${(b.size / 1e6).toFixed(2)} MB · FEES ${b.fees.toFixed(3)} ₿ · REWARD ${b.reward.toFixed(3)} ₿`);
  },
  move(d) {
    if (!Feeds.S.blocks.length) return;
    this.sel = clamp(this.sel + d, 0, Feeds.S.blocks.length - 1);
    this.render(); this.announce(Feeds.S.blocks[this.sel]);
  },
};

/* =============== marquee =============== */
const Marquee = {
  x: 0, text: '', flashUntil: 0,
  init() { this.el = $('#marquee'); this.box = $('#marquee-box'); },
  flash(t) { this.el.textContent = t + '  ***  ' + t + '  ***  '; this.x = 0; this.flashUntil = performance.now() + 9000; },
  build() {
    const S = Feeds.S;
    const seg = [];
    if (S.price) seg.push(`BTC $${Math.round(S.price).toLocaleString()} (${S.priceDelta >= 0 ? '+' : ''}${S.priceDelta.toFixed(2)}%)`);
    if (S.height) seg.push(`TIP ${S.height.toLocaleString()}`);
    if (S.blocks[0]) seg.push(`LAST BLOCK BY ${S.blocks[0].miner.toUpperCase()}`);
    if (S.mempoolCount) seg.push(`${S.mempoolCount.toLocaleString()} TXS WAITING (${(S.mempoolVsize / 1e6).toFixed(1)} MB)`);
    if (isFinite(S.hi) && S.hi > 0) seg.push(`H $${Math.round(S.hi).toLocaleString()} · L $${Math.round(S.lo).toLocaleString()}`);
    if (S.buyPct !== 50) seg.push(`PRESSURE ${Math.round(S.buyPct)}▲/${100 - Math.round(S.buyPct)}▼`);
    if (S.fees.fast) seg.push(`FEES ${S.fees.fast}/${S.fees.half}/${S.fees.hour} SAT/VB`);
    if (S.hashrate) seg.push(`HASH ${(S.hashrate / 1e18).toFixed(0)} EH/S`);
    if (S.daProgress) seg.push(`DIFF ${S.daChange >= 0 ? '+' : ''}${(S.daChange || 0).toFixed(2)}% IN ${S.daRemaining} BLKS`);
    if (S.ln.nodes) seg.push(`⚡LN ${S.ln.nodes.toLocaleString()} NODES / ${Math.round(S.ln.capacity).toLocaleString()} ₿`);
    const t = seg.length ? seg.join('  ···  ') : 'BTCAMP · SEARCHING FOR THE NETWORK…';
    this.el.textContent = t + '  ***  ' + t + '  ***  ';
  },
  tick(dt) {
    if (performance.now() > this.flashUntil && (!this._rb || performance.now() > this._rb)) { this.build(); this._rb = performance.now() + 4000; }
    this.x -= dt * 55;
    const half = this.el.scrollWidth / 2;
    if (half > 0 && -this.x > half) this.x += half;
    this.el.style.transform = `translateX(${this.x.toFixed(1)}px)`;
  },
};

/* =============== main deck displays =============== */
const Main = {
  numMode: CFG.numMode || 0, miniMode: 0,
  init() {
    $('#big-num').addEventListener('click', () => { this.numMode = (this.numMode + 1) % 4; Store.save({ numMode: this.numMode }); });
    $('#mini-vis').addEventListener('click', () => { this.miniMode = (this.miniMode + 1) % 2; });
    this.mini = $('#mini-canvas'); this.mg = this.mini.getContext('2d');
    makeHSlider($('#vol'), () => Feeds.sens / 1.6, (f) => { Feeds.sens = f * 1.6; Store.save({ sens: Feeds.sens }); }, f => 'SENSITIVITY ' + Math.round(f * 100) + '%');
    if (CFG.sens !== undefined) Feeds.sens = CFG.sens;
    makeHSlider($('#bal'), () => (Feeds.balance + 1) / 2, (f) => { Feeds.balance = f * 2 - 1; }, f => 'ON-CHAIN ⟷ MARKET');
    // transport
    $('#tp-prev').addEventListener('click', () => Playlist.move(1));
    $('#tp-next').addEventListener('click', () => { Playlist.sel = 0; Playlist.render(); if (Feeds.S.blocks[0]) Playlist.announce(Feeds.S.blocks[0]); });
    $('#tp-play').addEventListener('click', () => { Feeds.paused = false; this.mark('tp-play'); });
    $('#tp-pause').addEventListener('click', () => { Feeds.paused = !Feeds.paused; this.mark(Feeds.paused ? 'tp-pause' : 'tp-play'); });
    $('#tp-stop').addEventListener('click', () => { Feeds.paused = true; Feeds.spec.fill(0); Feeds.peaks.fill(0); Feeds.wave.fill(0); this.mark('tp-stop'); });
    $('#tp-eject').addEventListener('click', () => WM.toggle('win-skins'));
    this.mark('tp-play');
    // toggles
    $('#tg-snd').addEventListener('click', () => $('#tg-snd').classList.toggle('on', Sound.toggle()));
    if (CFG.sndVol !== undefined) Sound.setVol(CFG.sndVol);
    $('#tg-snd').title = 'Network audio (M) · scroll wheel = volume ' + Math.round(Sound.vol * 100) + '%';
    $('#tg-snd').addEventListener('wheel', (e) => {
      e.preventDefault();
      Sound.setVol(clamp(Sound.vol + (e.deltaY < 0 ? 0.08 : -0.08), 0, 1));
      Store.save({ sndVol: Sound.vol });
      $('#tg-snd').title = 'Network audio (M) · scroll wheel = volume ' + Math.round(Sound.vol * 100) + '%';
      Deck.toast('SOUND ' + Math.round(Sound.vol * 100) + '%');
    }, { passive: false });
    $('#tg-tape').addEventListener('click', () => $('#tg-tape').classList.toggle('on', WM.toggle('win-tape')));
    $('#tg-eq').addEventListener('click', () => WM.toggle('win-eq'));
    $('#tg-pl').addEventListener('click', () => WM.toggle('win-pl'));
    $('#tg-shuffle').addEventListener('click', () => { Viz.auto = !Viz.auto; $('#tg-shuffle').classList.toggle('on', Viz.auto); $('#viz-auto').classList.toggle('on', Viz.auto); });
    $('#btn-menu').addEventListener('click', () => WM.toggle('win-skins'));
    // clutterbar
    $$('#clutter .cb').forEach(cb => cb.addEventListener('click', () => {
      const k = cb.dataset.cb;
      if (k === 'O') WM.toggle('win-feeds');
      if (k === 'A') { $('#splash').classList.remove('gone'); setTimeout(() => $('#splash').classList.add('gone'), 2600); }
      if (k === 'I' && Feeds.S.blocks[0]) Playlist.announce(Feeds.S.blocks[0]);
      if (k === 'D') { const w = $('#win-viz'); const big = w.style.width === '1100px'; w.style.width = big ? '760px' : '1100px'; $('#viz-screen').style.height = big ? '430px' : '620px'; }
      if (k === 'V') WM.toggle('win-viz');
    }));
    makeHSlider($('#seek'), () => this.seekF || 0, () => {}, () => 'TIME SINCE LAST BLOCK');
  },
  mark(id) { ['tp-play', 'tp-pause', 'tp-stop'].forEach(b => $('#' + b).classList.toggle('on', b === id)); },
  update() {
    const S = Feeds.S;
    const modes = [
      ['BTC · USD', S.price ? '$' + Math.round(S.price).toLocaleString() : '—'],
      ['BLOCK HEIGHT', S.height ? S.height.toLocaleString() : '—'],
      ['SATS PER USD', S.price ? Math.round(1e8 / S.price).toLocaleString() : '—'],
      ['MEMPOOL TXS', S.mempoolCount ? S.mempoolCount.toLocaleString() : '—'],
    ];
    $('#big-label').textContent = modes[this.numMode][0];
    $('#big-value').textContent = modes[this.numMode][1];
    $('#st-fee').textContent = S.fees.fast || '–';
    $('#st-tps').textContent = S.txRate.toFixed(1);
    $('#st-mem').textContent = (S.mempoolVsize / 1e6).toFixed(0);
    const live = Feeds.anyLive();
    const el = $('#st-live');
    el.innerHTML = `<b>${Feeds.paused ? 'FROZEN' : live ? 'LIVE ●' : Feeds.conn.sim === 'live' ? 'SIM ◌' : 'OFFLINE'}</b>`;
    el.style.color = '';
    // seek: minutes since last block vs 10-minute target
    const since = S.lastBlockTime ? (Date.now() / 1000 - S.lastBlockTime) : 0;
    this.seekF = clamp(since / 600, 0, 1);
    $('#seek .fill').style.width = (this.seekF * 100) + '%';
    $('#seek .thumb').style.left = `calc(${this.seekF * 100}% - ${this.seekF * 20}px)`;
    const m = Math.floor(since / 60), s2 = Math.floor(since % 60);
    $('#seek-eta').textContent = `T+${m}:${String(s2).padStart(2, '0')} / TARGET 10:00`;
  },
  drawMini() {
    const c = this.mini, g = this.mg;
    if (c.width !== c.clientWidth * 2) { c.width = (c.clientWidth || 150) * 2; c.height = (c.clientHeight || 34) * 2; }
    const W = c.width, H = c.height;
    g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(0, 0, W, H);
    const lf = getComputedStyle(document.documentElement).getPropertyValue('--lf').trim() || '#0f0';
    g.fillStyle = lf; g.strokeStyle = lf;
    if (this.miniMode === 0) {
      const n = 32;
      for (let i = 0; i < n; i++) {
        const v = clamp(Feeds.spec[i * 2], 0, 1.2);
        g.fillRect(i / n * W, H - v * H, W / n - 2, v * H);
      }
    } else {
      g.lineWidth = 2; g.beginPath();
      const n = Feeds.wave.length;
      for (let i = 0; i < n; i++) {
        const s = Feeds.wave[(Feeds.wavePos + i) % n];
        const x = i / (n - 1) * W, y = H / 2 + s * H * 0.45;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
  },
};

/* =============== trade tape (aggr-style) =============== */
const TapeUI = {
  count: 0, _rate: [],
  init() {
    this.host = $('#tape-list');
    Feeds.addListener('trade', (tr) => this.add(tr));
    Feeds.addListener('block', (b) => this.addBlock(b));
  },
  add(tr) {
    this._rate.push(performance.now());
    if (!WM.visible('win-tape')) return;
    if (tr.size < 0.001) return; // only sub-1k-sat dust is dropped
    const r = document.createElement('div');
    const cls = tr.size >= 10 ? ' mega' : tr.size >= 1 ? ' big' : '';
    r.className = 'tr ' + (tr.buy ? 'buy' : 'sell') + cls;
    const w = clamp(Math.log10(1 + tr.size * 10) / 2.4, 0.03, 1) * 100;
    r.innerHTML = `<span class="bg" style="width:${w.toFixed(1)}%"></span>` +
      `<span class="side">${tr.buy ? 'BUY' : 'SELL'}</span>` +
      `<span class="sz">${tr.size >= 100 ? tr.size.toFixed(0) : tr.size >= 1 ? tr.size.toFixed(2) : tr.size.toFixed(3)} ₿</span>` +
      `<span class="px2">$${Math.round(tr.price).toLocaleString()}</span>`;
    this.host.prepend(r);
    while (this.host.children.length > 120) this.host.lastChild.remove();
  },
  addBlock(b) {
    if (!WM.visible('win-tape')) return;
    const r = document.createElement('div');
    r.className = 'blkrow';
    r.textContent = `━━ BLOCK ${b.height} · ${b.miner.toUpperCase()} ━━`;
    this.host.prepend(r);
  },
  tick() {
    const now = performance.now();
    this._rate = this._rate.filter(t => now - t < 60000);
    $('#tape-rate').textContent = this._rate.length;
    $('#tape-buy').textContent = Math.round(Feeds.S.buyPct);
  },
};

/* =============== feeds panel =============== */
const FeedsUI = {
  rows: {},
  defs: [
    ['mempool', 'MEMPOOL.SPACE WS', 'blocks · fees · mempool · difficulty'],
    ['chain', 'BLOCKCHAIN.INFO WS', 'every unconfirmed tx, live'],
    ['price', 'COINBASE WS', 'BTC-USD trades + volume'],
    ['rest', 'REST POLL 60s', 'hashrate · lightning · bootstrap'],
    ['sim', 'SIMULATOR', 'auto-engages if wires are down'],
  ],
  init() {
    const host = $('#feed-list');
    this.defs.forEach(([k, nm, desc]) => {
      const r = document.createElement('div'); r.className = 'feed-row lcd';
      r.innerHTML = `<span class="led"></span><span class="nm" title="${desc}">${nm}</span><span class="rate"></span>`;
      const btn = document.createElement('div'); btn.className = 'btn3d' + (Feeds.enabled[k] ? ' on' : ''); btn.textContent = Feeds.enabled[k] ? 'ON' : 'OFF';
      btn.addEventListener('click', () => {
        Feeds.toggleFeed(k);
        btn.classList.toggle('on', Feeds.enabled[k]); btn.textContent = Feeds.enabled[k] ? 'ON' : 'OFF';
      });
      r.appendChild(btn); host.appendChild(r);
      this.rows[k] = r;
    });
    Feeds.addListener('conn', () => this.render());
    this.render();
  },
  render() {
    for (const [k] of this.defs) {
      const led = this.rows[k].querySelector('.led');
      const st = Feeds.conn[k];
      led.className = 'led' + (st === 'live' ? ' on' : st === 'connecting' ? ' wait' : st === 'error' ? ' err' : '');
      const rate = this.rows[k].querySelector('.rate');
      rate.textContent = (k in Feeds.msgRate && st === 'live') ? Feeds.msgRate[k].toFixed(1) + ' msg/s' : st.toUpperCase();
    }
  },
};

/* =============== skins panel =============== */
const SkinsUI = {
  lab: Object.assign({ h: 28, s: 70, l: 50 }, CFG.lab || {}),
  buildCustom() {
    const { h, s, l } = this.lab;
    const f = (ll, ss = s) => `hsl(${h},${Math.round(ss)}%,${Math.round(clamp(ll * (l / 50), 2, 96))}%)`;
    return {
      w1: f(26, s * 0.4), w2: f(12, s * 0.4), bl: f(44, s * 0.35), bd: '#060607',
      t1: f(18, s * 0.9), t2: f(38, s * 0.9), tt: f(92, s * 0.5),
      lb: f(4, s * 0.6), lf: f(58, Math.max(s, 60)), ld: f(24, s * 0.8), la: f(80, s * 0.7),
      ac: f(60, Math.max(s, 55)), tx: f(78, s * 0.25), b1: f(32, s * 0.4), b2: f(16, s * 0.4),
      sh: `hsla(${h},${Math.round(s)}%,55%,0.33)`,
    };
  },
  init() {
    // skin #26: the user's own creation, shaped by the Skin Lab sliders
    SKINS.push({ name: 'Skin Lab Custom', v: this.buildCustom() });
    const host = $('#skin-list');
    SKINS.forEach((s, i) => {
      const r = document.createElement('div'); r.className = 'row';
      r.innerHTML = `<span class="sw" style="background:linear-gradient(90deg, ${s.v.w1} 0 33%, ${s.v.ac} 33% 66%, ${s.v.lf} 66%)"></span><span>${String(i + 1).padStart(2, '0')} · ${s.name}</span>`;
      r.addEventListener('click', () => { Skin.apply(i); this.applyHue(); Marquee.flash('SKIN LOADED: ' + s.name.toUpperCase()); });
      host.appendChild(r);
    });
    // Skin Lab sliders: live-rebuild the custom skin while dragging
    const labSlider = (id, key, max) => makeHSlider($(id),
      () => this.lab[key] / max,
      (f) => {
        this.lab[key] = f * max;
        SKINS[SKINS.length - 1].v = this.buildCustom();
        const sw = $('#skin-list .row:last-child .sw');
        if (sw) sw.style.background = `linear-gradient(90deg, ${SKINS[SKINS.length - 1].v.w1} 0 33%, ${SKINS[SKINS.length - 1].v.ac} 33% 66%, ${SKINS[SKINS.length - 1].v.lf} 66%)`;
        Skin.apply(SKINS.length - 1); this.applyHue();
        Store.save({ lab: this.lab });
      });
    labSlider('#lab-h', 'h', 360); labSlider('#lab-s', 's', 100); labSlider('#lab-l', 'l', 100);
    const saved = parseInt(localStorage.getItem('btcamp_skin') || '1', 10);
    Skin.apply(isNaN(saved) ? 1 : saved);
    this.applyHue();
  },
  applyHue() {
    // derive the viz base hue from the skin accent color
    const ac = getComputedStyle(document.documentElement).getPropertyValue('--ac').trim();
    const m = /^#?([0-9a-f]{6})/i.exec(ac);
    if (!m) return;
    const n = parseInt(m[1], 16), r = (n >> 16) / 255, g2 = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g2, b), mn = Math.min(r, g2, b);
    let h = 0;
    if (mx !== mn) {
      const d = mx - mn;
      h = mx === r ? ((g2 - b) / d + (g2 < b ? 6 : 0)) : mx === g2 ? (b - r) / d + 2 : (r - g2) / d + 4;
      h *= 60;
    }
    Viz.hueBase = h;
  },
};

/* =============== keyboard =============== */
function initKeys() {
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k >= '1' && k <= '9') { Viz.set(parseInt(k, 10) - 1); Deck.updateModeLCD(); }
    else if (k === '0') { Viz.set(9); Deck.updateModeLCD(); }
    else if (k === 'arrowright') { Viz.next(); Deck.updateModeLCD(); }
    else if (k === 'arrowleft') { Viz.prev(); Deck.updateModeLCD(); }
    else if (k === 'f') Deck.fullscreen();
    else if (k === 'escape' && document.body.classList.contains('fs')) Deck.fullscreen();
    else if (k === ' ') { e.preventDefault(); Feeds.paused = !Feeds.paused; Main.mark(Feeds.paused ? 'tp-pause' : 'tp-play'); }
    else if (k === 's') WM.toggle('win-skins');
    else if (k === 'd') WM.toggle('win-feeds');
    else if (k === 'e') WM.toggle('win-eq');
    else if (k === 'p') WM.toggle('win-pl');
    else if (k === 'v') WM.toggle('win-viz');
    else if (k === 'r') Deck.randomize();
    else if (k === 'c') Deck.cyclePal();
    else if (k === 't') $('#tg-tape').classList.toggle('on', WM.toggle('win-tape'));
    else if (k === 'm') $('#tg-snd').classList.toggle('on', Sound.toggle());
    else if (k === 'x') { $('#src-name').textContent = Feeds.cycleSrc(1); Store.save({ src: Feeds.srcIdx }); Deck.toast('SOURCE: ' + Feeds.srcModes[Feeds.srcIdx]); }
    else if (k === 'g') Diag.toggle();
    else if (k === 'a') { Viz.auto = !Viz.auto; $('#viz-auto').classList.toggle('on', Viz.auto); $('#tg-shuffle').classList.toggle('on', Viz.auto); }
  });
}

/* =============== diagnostics & self-defense =============== */
const BUILD = 'v8';
const Diag = {
  visible: false,
  init() {
    // red error strip: any uncaught error shows itself instead of a dead black canvas
    this.banner = document.createElement('div');
    this.banner.id = 'err-banner';
    document.body.appendChild(this.banner);
    addEventListener('error', (e) => this.err(e.message + (e.filename ? ' @ ' + e.filename.split('/').pop() + ':' + e.lineno : '')));
    addEventListener('unhandledrejection', (e) => this.err('async: ' + (e.reason && e.reason.message || e.reason)));
    // diagnostics overlay inside the viz screen (G key)
    this.panel = document.createElement('div');
    this.panel.id = 'viz-diag';
    $('#viz-screen').appendChild(this.panel);
  },
  err(msg) {
    if (!msg) return;
    this.banner.textContent = '⚠ ' + String(msg).slice(0, 160) + '  — press G for diagnostics';
    this.banner.classList.add('show');
    clearTimeout(this._t);
    this._t = setTimeout(() => this.banner.classList.remove('show'), 12000);
  },
  toggle() { this.visible = !this.visible; this.panel.classList.toggle('show', this.visible); },
  tick() {
    if (Viz.lastErr) this.err('viz ' + Viz.lastErr);
    if (!this.visible) return;
    const F = Feeds, gl = !!(Fractal.ok || (Fractal.init && Fractal.init()));
    this.panel.innerHTML =
      `BTCAMP ${BUILD} · ${Viz.modes[Viz.idx].name}<br>` +
      `FPS ${Viz.fps.toFixed(0)}${Viz.perf ? ' · PERF MODE' : ''} · CANVAS ${Viz.W}×${Viz.H} · DPR≤${Viz.dprCap}<br>` +
      `WEBGL ${gl ? 'OK' : 'NO'} · WARP ${Warp.ok === null ? '—' : Warp.ok ? 'OK' : 'NO'}<br>` +
      `FEEDS mempool:${F.conn.mempool} chain:${F.conn.chain} price:${F.conn.price} rest:${F.conn.rest} sim:${F.conn.sim}<br>` +
      `MSG/S ${F.msgRate.mempool.toFixed(1)} / ${F.msgRate.chain.toFixed(1)} / ${F.msgRate.price.toFixed(1)} · TX/S ${F.S.txRate.toFixed(1)}<br>` +
      `SIGNAL level ${F.level.toFixed(2)} bass ${F.bass.toFixed(2)} beat ${F.beat.toFixed(2)} · SRC ${F.srcModes[F.srcIdx]}<br>` +
      (Viz.lastErr ? `LAST VIZ ERROR: ${Viz.lastErr}` : 'NO VIZ ERRORS');
  },
};

/* auto-degrade on weak GPUs: sustained low FPS → drop resolution + kill glow */
const PerfGuard = {
  bad: 0, done: false,
  tick(dt) {
    Viz.fps = lerp(Viz.fps, 1 / Math.max(dt, 0.001), 0.05);
    if (this.done || document.hidden) return;
    if (Viz.fps < 26) { this.bad += dt; } else this.bad = Math.max(0, this.bad - dt);
    if (this.bad > 4) {
      this.done = true; Viz.perf = true; Viz.setDprCap(1);
      Deck.toast('PERF MODE: RESOLUTION + GLOW REDUCED');
    }
  },
};

/* =============== boot =============== */
addEventListener('DOMContentLoaded', () => {
  WM.init(); SkinsUI.init(); Main.init(); EQ.init(); Playlist.init(); FeedsUI.init(); TapeUI.init(); Marquee.init(); Deck.init(); Presets.init(); Diag.init(); initKeys();
  Sound.init();
  Feeds.start();
  const splash = $('#splash');
  const go = () => splash.classList.add('gone');
  splash.addEventListener('click', go);
  setTimeout(go, 3500);

  let last = performance.now(), uiT = 0;
  const loop = (now) => {
    const dt = Math.min((now - last) / 1000, 0.25); last = now;
    Feeds.tick(dt);
    Viz.frame(dt);
    Marquee.tick(dt);
    Main.drawMini();
    PerfGuard.tick(dt);
    uiT += dt;
    if (uiT > 0.25) { uiT = 0; Main.update(); EQ.tick(now / 1000, 0.25); FeedsUI.render(); TapeUI.tick(); Diag.tick(); }
    const osd = $('#viz-block-osd');
    osd.textContent = Feeds.blockFlash > 0 ? '⚡ NEW BLOCK' : '';
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
