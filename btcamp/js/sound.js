/* BTCAMP — network audio engine (aggr.trade-style).
   Every trade is a blip: buys ring high, sells ring low, size sets pitch drop and
   loudness. Whales gong, found blocks boom, round-number crossings chime.
   Off by default; SND button arms it (browsers require a user gesture anyway). */
'use strict';

const Sound = {
  ctx: null, master: null, enabled: false, vol: 0.6,
  _last: 0, _minGap: 35, // ms between blips so a frenzy doesn't clip

  arm() {
    if (this.ctx) return true;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.vol;
      // gentle limiter so whale gongs + frenzies don't distort
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 8; comp.knee.value = 12;
      this.master.connect(comp); comp.connect(this.ctx.destination);
      return true;
    } catch (e) { return false; }
  },

  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) { this.arm(); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
    return this.enabled;
  },

  setVol(v) { this.vol = v; if (this.master) this.master.gain.value = v; },

  _env(gain, t0, peak, decay) {
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
  },

  _tone(type, freq, peak, decay, opts = {}) {
    if (!this.enabled || !this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator(), g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(opts.slideTo, 1), t0 + decay * 0.9);
    this._env(g, t0, peak, decay);
    let node = osc;
    if (opts.pan !== undefined && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner(); p.pan.value = opts.pan;
      osc.connect(p); node = p;
    }
    node.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + decay + 0.05);
  },

  _noise(peak, decay, cutoff) {
    if (!this.enabled || !this.ctx) return;
    const t0 = this.ctx.currentTime, sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, sr * decay, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
    const g = this.ctx.createGain(); this._env(g, t0, peak, decay);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0);
  },

  /* one trade off the tape — aggr-style blip */
  trade(tr) {
    if (!this.enabled || !this.ctx) return;
    const now = performance.now();
    if (tr.size < 0.03) return;                       // dust stays silent
    if (now - this._last < this._minGap && tr.size < 1) return;
    this._last = now;
    const mag = Math.log10(1 + tr.size * 10);          // ~0.1 dust … ~2.5 whale
    const peak = Math.min(0.22, 0.015 + mag * 0.075);
    // buys ring a fifth above sells; size drags the pitch down
    const base = tr.buy ? 659.26 : 220;
    const freq = base / (1 + mag * 0.55);
    this._tone('sine', freq, peak, 0.09 + mag * 0.1, { pan: tr.buy ? 0.25 : -0.25 });
    if (tr.size >= 1) this._tone('triangle', freq / 2, peak * 0.6, 0.22 + mag * 0.12, { pan: tr.buy ? 0.2 : -0.2 });
  },

  whale(w) {
    if (!this.enabled || !this.ctx) return;
    const mag = Math.min(1, w.size / 60);
    this._tone('triangle', w.buy ? 130.8 : 87.3, 0.22 + mag * 0.15, 1.3, { slideTo: w.buy ? 98 : 65 });
    this._tone('sine', w.buy ? 261.6 : 174.6, 0.1, 0.8);
    this._noise(0.06, 0.5, 900);
  },

  block() {
    if (!this.enabled || !this.ctx) return;
    this._tone('sine', 65, 0.4, 1.6, { slideTo: 32 });
    this._tone('sine', 130, 0.14, 0.9, { slideTo: 65 });
    this._noise(0.16, 1.1, 500);
  },

  round(r) {
    if (!this.enabled || !this.ctx) return;
    const seq = r.up ? [523.25, 659.26, 783.99] : [783.99, 659.26, 523.25];
    seq.forEach((f, i) => setTimeout(() => this._tone('sine', f, 0.12, 0.25), i * 90));
  },

  init() {
    Feeds.addListener('trade', (tr) => this.trade(tr));
    Feeds.addListener('whale', (w) => this.whale(w));
    Feeds.addListener('block', () => this.block());
    Feeds.addListener('round', (r) => this.round(r));
  },
};
