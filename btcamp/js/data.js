/* BTCAMP — live Bitcoin data engine.
   Feeds:
     mempool.space WS  — mempool stats, fee estimates, projected blocks, new blocks, difficulty
     blockchain.info WS — every unconfirmed transaction, live (value stream)
     Coinbase WS        — BTC-USD trades (price + volume)
     REST (mempool.space / coinbase) — bootstrap + slow-moving stats (hashrate, difficulty, lightning)
   The engine synthesizes an "audio" signal from the network: a 64-bin spectrum, a 128-sample
   waveform and a beat envelope. Every input has an on/off toggle and an EQ gain. */
'use strict';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

const Feeds = {
  /* ---- live network state ---- */
  S: {
    price: 0, priceOpen: 0, priceDelta: 0, priceMom: 0, vol24: 0, lastTradeSize: 0,
    hi: -Infinity, lo: Infinity, wind: 0, buyPct: 50, lastRound: 0,
    height: 0, blocks: [],            // newest first: {height,hash,miner,size,txs,fees,reward,time,dur}
    mempoolCount: 0, mempoolVsize: 0, mempoolBlocks: [],
    fees: { fast: 1, half: 1, hour: 1, eco: 1, min: 1 },
    vps: 0, txRate: 0,
    hashrate: 0, difficulty: 0, daProgress: 0, daChange: 0, daRemaining: 0, daEstimate: 0,
    ln: { nodes: 0, channels: 0, capacity: 0 },
    lastBlockTime: 0,
  },

  /* ---- feed connections (toggleable) ---- */
  conn: { mempool: 'off', chain: 'off', price: 'off', rest: 'off', sim: 'off' },
  enabled: { mempool: true, chain: true, price: true, rest: true, sim: true }, // sim auto-arms when others are down
  sockets: {}, timers: {}, msgCount: { mempool: 0, chain: 0, price: 0 }, msgRate: { mempool: 0, chain: 0, price: 0 },

  /* ---- EQ: per-input gain (0..2) and on/off toggle ---- */
  bands: ['tx', 'val', 'fee', 'mem', 'blk', 'prc', 'vol', 'hsh', 'dif', 'lnn'],
  bandNames: { tx: 'TX FLOW', val: 'TX VALUE', fee: 'FEE RATE', mem: 'MEMPOOL', blk: 'BLOCKS', prc: 'PRICE', vol: 'VOLUME', hsh: 'HASHRATE', dif: 'DIFFICULTY', lnn: 'LIGHTNING' },
  bandShort: { tx: 'TX', val: 'VALUE', fee: 'FEES', mem: 'MEMPL', blk: 'BLOCKS', prc: 'PRICE', vol: 'VOLUME', hsh: 'HASH', dif: 'DIFF', lnn: 'LN' },
  gains: { tx: 1, val: 1, fee: 1, mem: 1, blk: 1, prc: 1, vol: 1, hsh: 1, dif: 1, lnn: 1 },
  on:    { tx: 1, val: 1, fee: 1, mem: 1, blk: 1, prc: 1, vol: 1, hsh: 1, dif: 1, lnn: 1 },
  eqOn: true, preamp: 1,
  sens: 0.8,        // main volume slider → global sensitivity
  balance: 0,       // -1 on-chain … +1 market
  paused: false,

  eff(k) {
    let g = this.on[k] * (this.eqOn ? this.gains[k] * this.preamp : 1) * this.sens * 1.6;
    const chain = ['tx', 'val', 'fee', 'mem', 'blk'].includes(k);
    if (this.balance < 0 && !chain) g *= 1 + this.balance * 0.9;
    if (this.balance > 0 && chain)  g *= 1 - this.balance * 0.9;
    return this.paused ? 0 : g;
  },

  /* ---- synthesized signal ---- */
  N: 64,
  spec: new Float32Array(64), peaks: new Float32Array(64), peakV: new Float32Array(64),
  wave: new Float32Array(128), wavePos: 0,
  beat: 0, blockFlash: 0, bass: 0, treble: 0, level: 0,
  events: [],      // recent txs for particle viz: {v: BTC, t: ms, big}
  blockEvents: 0,  // counter viz can diff against
  txCounter: 0, tradeCounter: 0,
  _txWindow: [], _impulse: 0, _wavePhase: 0,
  /* market trade tape (BTC://SIGNAL): order-size spectrum, pressure window, whale tape */
  TB: 28, tradeBars: new Float32Array(28), tradeCaps: new Float32Array(28), tradeBuy: new Float32Array(28),
  trades: [],        // recent trades for spark viz: {t, size, buy, price}
  marketWhales: [],  // whale tape ≥ 2 BTC: {t, size, buy, price}
  _buys: [], _sells: [],

  listeners: {},
  addListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
  emit(ev, d) { (this.listeners[ev] || []).forEach(fn => { try { fn(d); } catch (e) {} }); },

  bump(bin, amp, spread) {
    for (let i = -spread; i <= spread; i++) {
      const b = bin + i;
      if (b < 0 || b >= this.N) continue;
      const a = amp * (1 - Math.abs(i) / (spread + 1));
      if (this.spec[b] < a) this.spec[b] = Math.min(1.6, this.spec[b] + a * 0.7);
    }
  },

  /* ================= input events ================= */
  onTx(btc, sim) {
    if (this.paused) return;
    this.txCounter++;
    this._txWindow.push(performance.now());
    const g = this.eff('tx'), vg = this.eff('val');
    if (g <= 0 && vg <= 0) return;
    // map value to a bin: dust → treble, whales → bass
    const bin = clamp(Math.round(50 - 10 * Math.log10(Math.max(btc, 0.0001) * 100)), 2, 60);
    const amp = clamp(0.22 * g + vg * 0.16 * Math.log10(1 + btc * 20), 0, 1.5);
    this.bump(bin, amp, 3);
    this._impulse = Math.min(1.5, this._impulse + amp * 0.8);
    const big = btc >= 25;
    if (big) this.beat = Math.max(this.beat, clamp(0.35 + btc / 400, 0, 1) * this.eff('val'));
    if (this.events.length < 600) this.events.push({ v: btc, t: performance.now(), big, sim: !!sim });
  },

  /* one market trade. isBuy = taker bought (aggressive buy). */
  onTrade(price, size, isBuy) {
    if (this.paused) return;
    this.tradeCounter++;
    const S = this.S, now = performance.now();
    const prev = S.price || price;
    // momentum: $ EMA for the wave, return-EMA "wind" for the pressure viz (à la BTC://SIGNAL)
    S.priceMom = lerp(S.priceMom, price - prev, 0.35);
    S.wind = clamp(S.wind * 0.965 + ((price - prev) / prev) * 0.035 * 4000, -1.6, 1.6);
    S.price = price; S.lastTradeSize = size;
    S.hi = Math.max(S.hi, price); S.lo = Math.min(S.lo, price);
    if (!S.priceOpen) S.priceOpen = price;
    S.priceDelta = S.priceOpen ? (price / S.priceOpen - 1) * 100 : 0;
    // 10s buy/sell pressure window
    if (size > 0 && isBuy !== undefined) {
      (isBuy ? this._buys : this._sells).push({ t: now, size });
      if (this.trades.length < 400) this.trades.push({ t: now, size, buy: !!isBuy, price });
    }
    // order-size spectrum bucket (log scale 0.001 → 30 BTC)
    if (size > 0) {
      const b = clamp(Math.floor(Math.log(Math.max(size, 0.001) / 0.001) / Math.log(30 / 0.001) * this.TB), 0, this.TB - 1);
      this.tradeBars[b] = Math.min(1, this.tradeBars[b] + 0.1 + Math.min(0.55, size * 0.04));
      this.tradeBuy[b] = this.tradeBuy[b] * 0.8 + (isBuy ? 0.2 : 0);
    }
    // whale tape ≥ 2 BTC
    if (size >= 2) {
      this.marketWhales.unshift({ t: now, size, buy: !!isBuy, price });
      this.marketWhales.splice(8);
      this.beat = Math.max(this.beat, clamp(size / 12, 0, 0.9) * this.eff('vol'));
      this.emit('whale', this.marketWhales[0]);
    }
    // round-number milestone ($1000 lines)
    const round = Math.floor(price / 1000) * 1000;
    if (S.lastRound && round !== S.lastRound) this.emit('round', { level: Math.max(round, S.lastRound), up: price > prev });
    S.lastRound = round;
    // signal injection
    const pg = this.eff('prc'), vg = this.eff('vol');
    const j = clamp(Math.abs(S.priceMom) * 0.9 + size * 0.35, 0, 1);
    this.bump(48 + Math.floor(Math.random() * 14), j * pg, 2);       // treble chatter
    this.bump(38 + Math.floor(Math.random() * 8), clamp(size, 0, 1.2) * vg * 0.6, 2);
    this._impulse = Math.min(1.5, this._impulse + j * 0.3 * pg);
  },

  onBlock(b) {
    const S = this.S;
    if (b.height && S.height && b.height <= S.height) return;
    S.height = b.height; S.lastBlockTime = b.time || Date.now() / 1000;
    S.blocks.unshift(b); if (S.blocks.length > 30) S.blocks.pop();
    this.blockEvents++;
    const g = this.eff('blk');
    this.beat = Math.max(this.beat, 1.2 * Math.min(1, g));
    this.blockFlash = 1;
    for (let i = 0; i < 16; i++) this.bump(i, g * (1 - i / 20), 1);  // bass drop
    this._impulse = Math.min(2, this._impulse + g);
    this.emit('block', b);
  },

  /* ================= per-frame synthesis ================= */
  tick(dt) {
    const S = this.S, now = performance.now();
    // tx rate over 5s window
    while (this._txWindow.length && now - this._txWindow[0] > 5000) this._txWindow.shift();
    S.txRate = this._txWindow.length / 5;
    this.events = this.events.filter(e => now - e.t < 6000);
    this.trades = this.trades.filter(e => now - e.t < 6000);
    // buy/sell pressure over 10s
    const cut = now - 10000;
    this._buys = this._buys.filter(x => x.t > cut); this._sells = this._sells.filter(x => x.t > cut);
    const bv = this._buys.reduce((a, x) => a + x.size, 0), sv = this._sells.reduce((a, x) => a + x.size, 0);
    if (bv + sv > 0) S.buyPct = lerp(S.buyPct, bv / (bv + sv) * 100, 0.2);
    // order-size spectrum decay + falling caps
    const tk = Math.pow(0.94, dt * 60);
    for (let i = 0; i < this.TB; i++) {
      this.tradeBars[i] *= tk;
      this.tradeCaps[i] = Math.max(this.tradeCaps[i] - 0.36 * dt, this.tradeBars[i]);
    }
    S.wind *= Math.pow(0.9, dt); // wind settles when the tape goes quiet

    const k = Math.pow(0.0018, dt);              // spectrum decay
    const memP = clamp(S.mempoolVsize / 120e6, 0, 1);
    const gm = this.eff('mem'), gf = this.eff('fee'), gh = this.eff('hsh'), gd = this.eff('dif'), gl = this.eff('lnn');
    const t = now / 1000;

    for (let i = 0; i < this.N; i++) {
      let v = this.spec[i] * k;
      // mempool pressure: breathing floor in the low-mids
      if (i >= 6 && i <= 26) v = Math.max(v, gm * memP * (0.14 + 0.09 * Math.sin(t * 1.7 + i * 0.4)));
      // fee landscape: projected next blocks shape bins 20..40
      if (this.S.mempoolBlocks.length && i >= 20 && i <= 40) {
        const mb = S.mempoolBlocks[Math.floor((i - 20) / 21 * Math.min(8, S.mempoolBlocks.length))];
        if (mb) v = Math.max(v, gf * clamp(Math.log10(1 + (mb.medianFee || 0)) / 3, 0, 1) * (0.22 + 0.06 * Math.sin(t * 2.2 + i)));
      }
      // hashrate: slow heavy swell in the sub-bass
      if (i <= 5) v = Math.max(v, gh * clamp(S.hashrate / 1.2e21, 0.1, 1) * (0.18 + 0.14 * Math.sin(t * 0.9 + i * 0.8)));
      // difficulty epoch: metronome tick that speeds up near retarget
      if (i >= 3 && i <= 5 && gd > 0) {
        const period = lerp(2.2, 0.5, S.daProgress / 100 || 0);
        if ((t % period) < 0.09) v = Math.max(v, 0.5 * gd);
      }
      // lightning shimmer in the top bins
      if (i >= 56 && gl > 0 && S.ln.nodes) v = Math.max(v, gl * (0.1 + 0.12 * Math.abs(Math.sin(t * 7 + i * 2.3))));
      this.spec[i] = v;
      // falling peak caps
      if (v >= this.peaks[i]) { this.peaks[i] = v; this.peakV[i] = 0; }
      else { this.peakV[i] += dt * 1.4; this.peaks[i] = Math.max(v, this.peaks[i] - this.peakV[i] * dt); }
    }

    // waveform: tx impulses + price momentum + organic wobble
    this._wavePhase += dt * (2 + S.txRate * 1.1);
    const steps = Math.max(1, Math.round(dt * 90));
    for (let s = 0; s < steps; s++) {
      this._impulse *= 0.94;
      const smp = clamp(
        this._impulse * Math.sin(this._wavePhase * 7 + s) * 0.9 +
        clamp(S.priceMom * 0.6, -0.5, 0.5) * this.eff('prc') +
        Math.sin(this._wavePhase * 2.1) * 0.12 * this.level, -1, 1);
      this.wave[this.wavePos] = smp;
      this.wavePos = (this.wavePos + 1) % this.wave.length;
    }

    this.beat = Math.max(0, this.beat - dt * 1.8);
    this.blockFlash = Math.max(0, this.blockFlash - dt * 0.5);
    let bass = 0, treb = 0, lv = 0;
    for (let i = 0; i < 10; i++) bass += this.spec[i];
    for (let i = 48; i < 64; i++) treb += this.spec[i];
    for (let i = 0; i < 64; i++) lv += this.spec[i];
    this.bass = bass / 10; this.treble = treb / 16; this.level = lv / 64;

    // message-rate meters (per second, smoothed)
    for (const kk of ['mempool', 'chain', 'price']) {
      this.msgRate[kk] = lerp(this.msgRate[kk], this.msgCount[kk] / Math.max(dt, 0.001), 0.05);
      this.msgCount[kk] = 0;
    }
  },

  /* ================= connections ================= */
  start() {
    this.connect('mempool'); this.connect('chain'); this.connect('price');
    this.restPoll(); this.timers.rest = setInterval(() => this.restPoll(), 60000);
    // auto-arm the simulator if nothing is live after 5s
    setTimeout(() => this.checkSim(), 5000);
    this.timers.sim = setInterval(() => this.checkSim(), 5000);
  },

  checkSim() {
    const live = ['mempool', 'chain', 'price'].some(k => this.conn[k] === 'live');
    if (!live && this.enabled.sim && this.conn.sim !== 'live') this.startSim();
    if ((live || !this.enabled.sim) && this.conn.sim === 'live') this.stopSim();
  },

  toggleFeed(k, state) {
    this.enabled[k] = state !== undefined ? state : !this.enabled[k];
    if (k === 'sim') { this.enabled.sim ? this.checkSim() : this.stopSim(); }
    else if (k === 'rest') { /* next poll respects flag */ if (!this.enabled.rest) this.conn.rest = 'off'; }
    else this.enabled[k] ? this.connect(k) : this.disconnect(k);
    this.emit('conn');
  },

  disconnect(k) {
    if (this.sockets[k]) { try { this.sockets[k].onclose = null; this.sockets[k].close(); } catch (e) {} }
    this.sockets[k] = null; this.conn[k] = 'off'; this.emit('conn');
  },

  connect(k) {
    if (!this.enabled[k]) return;
    this.disconnect(k);
    this.conn[k] = 'connecting'; this.emit('conn');
    const urls = {
      mempool: 'wss://mempool.space/api/v1/ws',
      chain: 'wss://ws.blockchain.info/inv',
      price: 'wss://ws-feed.exchange.coinbase.com',
    };
    let ws;
    try { ws = new WebSocket(urls[k]); } catch (e) { this.conn[k] = 'error'; this.retry(k); return; }
    this.sockets[k] = ws;
    ws.onopen = () => {
      this.conn[k] = 'live'; this.emit('conn'); this.checkSim();
      if (k === 'mempool') {
        ws.send(JSON.stringify({ action: 'init' }));
        ws.send(JSON.stringify({ action: 'want', data: ['blocks', 'stats', 'mempool-blocks', 'live-2h-chart'] }));
      } else if (k === 'chain') {
        ws.send(JSON.stringify({ op: 'unconfirmed_sub' }));
      } else if (k === 'price') {
        ws.send(JSON.stringify({ type: 'subscribe', product_ids: ['BTC-USD'], channels: ['ticker', 'matches'] }));
      }
    };
    ws.onmessage = (m) => { this.msgCount[k]++; try { this.route(k, JSON.parse(m.data)); } catch (e) {} };
    ws.onerror = () => { this.conn[k] = 'error'; this.emit('conn'); };
    ws.onclose = () => { this.conn[k] = this.enabled[k] ? 'error' : 'off'; this.emit('conn'); this.retry(k); };
  },

  retry(k) {
    if (!this.enabled[k]) return;
    clearTimeout(this.timers['r_' + k]);
    this.timers['r_' + k] = setTimeout(() => this.connect(k), 8000 + Math.random() * 5000);
  },

  route(k, d) {
    const S = this.S;
    if (k === 'mempool') {
      if (d.mempoolInfo) { S.mempoolCount = d.mempoolInfo.size; S.mempoolVsize = d.mempoolInfo.vsize; }
      if (d.fees) S.fees = { fast: d.fees.fastestFee, half: d.fees.halfHourFee, hour: d.fees.hourFee, eco: d.fees.economyFee, min: d.fees.minimumFee };
      if (d['mempool-blocks']) S.mempoolBlocks = d['mempool-blocks'];
      if (d.da) { S.daProgress = d.da.progressPercent; S.daChange = d.da.difficultyChange; S.daRemaining = d.da.remainingBlocks; S.daEstimate = d.da.estimatedRetargetDate; }
      if (d['live-2h-chart'] && d['live-2h-chart'].vbytes_per_second != null) S.vps = d['live-2h-chart'].vbytes_per_second;
      if (d.blocks) d.blocks.slice(-8).forEach(b => this.addBlockQuiet(b));
      if (d.block) this.onBlock(this.normBlock(d.block));
    } else if (k === 'chain') {
      if (d.op === 'utx' && d.x) {
        const sats = (d.x.out || []).reduce((a, o) => a + (o.value || 0), 0);
        this.onTx(sats / 1e8);
      }
    } else if (k === 'price') {
      if (d.type === 'match' || d.type === 'last_match') {
        // Coinbase 'side' is the maker side: maker sold ⇒ taker BOUGHT
        this._gotMatch = true;
        this.onTrade(parseFloat(d.price), parseFloat(d.size || 0), d.side === 'sell');
      } else if (d.type === 'ticker' && d.price) {
        if (d.volume_24h) S.vol24 = parseFloat(d.volume_24h);
        if (!this._gotMatch) this.onTrade(parseFloat(d.price), 0);
      }
    }
  },

  normBlock(b) {
    return {
      height: b.height, hash: b.id || b.hash || '',
      miner: (b.extras && b.extras.pool && b.extras.pool.name) || 'Unknown Pool',
      size: b.size || 0, txs: b.tx_count || 0,
      fees: (b.extras && b.extras.totalFees != null) ? b.extras.totalFees / 1e8 : 0,
      reward: (b.extras && b.extras.reward != null) ? b.extras.reward / 1e8 : 3.125,
      time: b.timestamp || Date.now() / 1000, dur: 0,
    };
  },

  addBlockQuiet(raw) {
    const b = this.normBlock(raw), S = this.S;
    if (S.blocks.some(x => x.height === b.height)) return;
    S.blocks.push(b); S.blocks.sort((a, x) => x.height - a.height); S.blocks.splice(30);
    S.height = Math.max(S.height, b.height);
    if (!S.lastBlockTime || b.height === S.height) S.lastBlockTime = Math.max(S.lastBlockTime, b.time);
    for (let i = 1; i < S.blocks.length; i++) S.blocks[i - 1].dur = Math.max(0, S.blocks[i - 1].time - S.blocks[i].time);
    this.emit('blocks');
  },

  async restPoll() {
    if (!this.enabled.rest) return;
    this.conn.rest = 'connecting'; this.emit('conn');
    const get = async (url) => { const r = await fetch(url); if (!r.ok) throw 0; return r.json(); };
    let ok = false;
    const jobs = [
      get('https://mempool.space/api/blocks').then(bs => bs.forEach(b => this.addBlockQuiet(b))),
      get('https://mempool.space/api/v1/fees/recommended').then(f => { if (this.conn.mempool !== 'live') this.S.fees = { fast: f.fastestFee, half: f.halfHourFee, hour: f.hourFee, eco: f.economyFee, min: f.minimumFee }; }),
      get('https://mempool.space/api/v1/difficulty-adjustment').then(d => { this.S.daProgress = d.progressPercent; this.S.daChange = d.difficultyChange; this.S.daRemaining = d.remainingBlocks; this.S.daEstimate = d.estimatedRetargetDate; }),
      get('https://mempool.space/api/v1/mining/hashrate/3d').then(h => { this.S.hashrate = h.currentHashrate; this.S.difficulty = h.currentDifficulty; }),
      get('https://mempool.space/api/v1/lightning/statistics/latest').then(l => { const x = l.latest || l; this.S.ln = { nodes: x.node_count || 0, channels: x.channel_count || 0, capacity: (x.total_capacity || 0) / 1e8 }; }).catch(() => {}),
    ];
    if (this.conn.price !== 'live') jobs.push(get('https://api.coinbase.com/v2/prices/BTC-USD/spot').then(p => { const v = parseFloat(p.data.amount); if (v) this.onTrade(v, 0); }));
    for (const j of jobs) { try { await j; ok = true; } catch (e) {} }
    this.conn.rest = ok ? 'live' : 'error'; this.emit('conn');
  },

  /* ================= simulator (only when live feeds are unreachable) ================= */
  startSim() {
    this.conn.sim = 'live'; this.emit('conn');
    const S = this.S;
    if (!S.price) { S.price = 100000 + Math.random() * 30000; S.priceOpen = S.price; }
    if (!S.height) S.height = 905000 + Math.floor(Math.random() * 100);
    if (!S.hashrate) S.hashrate = 9e20;
    if (!S.mempoolVsize) { S.mempoolVsize = 60e6; S.mempoolCount = 40000; }
    if (!S.fees.fast || S.fees.fast <= 1) S.fees = { fast: 12, half: 8, hour: 5, eco: 3, min: 1 };
    if (!S.mempoolBlocks.length) S.mempoolBlocks = Array.from({ length: 8 }, (_, i) => ({ medianFee: 14 - i * 1.4, blockVSize: 998000, nTx: 3200 - i * 180, feeRange: [1, 20 - i] }));
    if (!S.ln.nodes) S.ln = { nodes: 12500, channels: 48000, capacity: 4800 };
    const pools = ['Foundry USA', 'AntPool', 'ViaBTC', 'F2Pool', 'MARA Pool', 'SpiderPool', 'Luxor', 'Braiins'];
    if (!S.blocks.length) { // seed a plausible recent history so the playlist isn't empty
      const now = Date.now() / 1000; let t = now - 300;
      for (let i = 0; i < 12; i++) {
        S.blocks.push({ height: S.height - i, hash: 'sim', miner: pools[Math.floor(Math.random() * pools.length)], size: 1.1e6 + Math.random() * 9e5, txs: 2200 + Math.floor(Math.random() * 2400), fees: 0.03 + Math.random() * 0.25, reward: 3.125, time: t, dur: 0 });
        t -= 200 + Math.random() * 1100;
      }
      for (let i = 0; i < S.blocks.length - 1; i++) S.blocks[i].dur = S.blocks[i].time - S.blocks[i + 1].time;
      S.lastBlockTime = S.blocks[0].time;
      this.emit('blocks');
    }
    // market regimes with pareto order sizes and momentum-biased flow (à la BTC://SIGNAL)
    let regime = 'calm', regimeT = 0;
    const poisson = (l) => { let L = Math.exp(-l), k2 = 0, p = 1; do { k2++; p *= Math.random(); } while (p > L); return k2 - 1; };
    this.timers.simTx = setInterval(() => {
      if (Math.random() < 0.85) this.onTx(Math.pow(10, Math.random() * 3.4 - 2.2), true);
      if (--regimeT <= 0) {
        const r = Math.random();
        regime = r < 0.55 ? 'calm' : r < 0.85 ? 'active' : 'frenzy';
        regimeT = 40 + Math.random() * 160;
      }
      const lambda = regime === 'calm' ? 0.7 : regime === 'active' ? 2 : 5;
      const n = poisson(lambda);
      for (let i = 0; i < n; i++) {
        const size = Math.min(30, 0.001 * Math.pow(1 / Math.max(1e-6, Math.random()), 1 / 1.25));
        const buyBias = 0.5 + S.wind * 0.12 + (Math.random() - 0.5) * 0.15;
        const isBuy = Math.random() < Math.min(0.85, Math.max(0.15, buyBias));
        const impact = size * (isBuy ? 1 : -1) * (regime === 'frenzy' ? 2.2 : 1.2);
        const noise = (Math.random() - 0.5) * S.price * 0.00012;
        this.onTrade(Math.max(1000, S.price + impact + noise + S.wind * 0.6), size, isBuy);
      }
      S.mempoolVsize = clamp(S.mempoolVsize + (Math.random() - 0.48) * 8e5, 5e6, 300e6);
      S.mempoolCount = Math.round(S.mempoolVsize / 1400);
    }, 220);
    this.timers.simBlock = setInterval(() => {
      const b = { height: S.height + 1, hash: 'sim', miner: pools[Math.floor(Math.random() * pools.length)], size: 1.2e6 + Math.random() * 8e5, txs: 2400 + Math.floor(Math.random() * 2200), fees: 0.04 + Math.random() * 0.2, reward: 3.125, time: Date.now() / 1000, dur: 0 };
      this.onBlock(b); this.emit('blocks');
    }, 42000);
  },

  stopSim() {
    clearInterval(this.timers.simTx); clearInterval(this.timers.simBlock);
    this.conn.sim = 'off'; this.emit('conn');
  },

  anyLive() { return ['mempool', 'chain', 'price', 'rest'].some(k => this.conn[k] === 'live'); },
};
