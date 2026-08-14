// SwingLab — main controller
import { PoseLandmarker, FilesetResolver, DrawingUtils } from '../vendor/vision_bundle.mjs';
import { buildSeries, detectSwings, measureSwing, aggregate, LM } from './metrics.js';
import { buildReport, planIntegration, DIMENSIONS } from './coach.js';
import { saveSession, listSessions, getSession, deleteSession } from './db.js';

const $ = id => document.getElementById(id);
const MAX_STORED_VIDEO = 350 * 1024 * 1024;
const state = {
  landmarker: null,
  frames: [],
  series: null,
  swings: [],
  measures: [],
  report: null,
  video: null,
  videoBlob: null,
  sourceName: null,
  overlayFrames: [],
  processing: false,
};

// ---------- boot ----------
async function initModel() {
  setStatus('Loading pose-tracking engine (33-point body model)…');
  const fileset = await FilesetResolver.forVisionTasks('./vendor/wasm');
  state.landmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: './vendor/pose_landmarker_full.task', delegate: 'GPU' },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  }).catch(async () => {
    // GPU delegate unavailable → CPU fallback
    return PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: './vendor/pose_landmarker_full.task', delegate: 'CPU' },
      runningMode: 'VIDEO', numPoses: 1,
    });
  });
  setStatus('Engine ready. Drop your SwingVision export to begin.', 'ok');
  $('dropzone').classList.add('ready');
}

function setStatus(msg, cls = '') {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status ' + cls;
}

// ---------- video intake ----------
function wireDropzone() {
  const dz = $('dropzone');
  const input = $('fileInput');
  dz.addEventListener('click', () => input.click());
  input.addEventListener('change', () => input.files[0] && loadVideo(input.files[0]));
  ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e => {
    const f = [...e.dataTransfer.files].find(f => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(f.name));
    if (f) loadVideo(f);
    else setStatus('That file isn\'t a video. Export the .mp4 from SwingVision (Share → Save Video) and drop it here.', 'err');
  });

  const urlBtn = $('urlBtn'), urlInput = $('urlInput');
  const go = () => { const u = urlInput.value.trim(); if (u) loadVideoFromURL(u); };
  urlBtn.addEventListener('click', go);
  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}

// Try to pull a video straight from a pasted link. Works for direct video
// links whose host allows cross-site access; SwingVision match PAGES block
// browser access, so those get a clear explanation instead of a cryptic error.
async function loadVideoFromURL(url) {
  if (!state.landmarker) { setStatus('Engine still loading — one moment…'); return; }
  if (/swing\.vision\/(matches|share)/i.test(url) && !/\.(mp4|mov|m4v|webm)(\?|$)/i.test(url)) {
    setStatus('That\'s a SwingVision match page — their site doesn\'t let other websites read it directly. In the SwingVision app: Share → Save Video, then drop the file here (it stays saved in your history afterward).', 'err');
    return;
  }
  setStatus('Fetching video from link…');
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    if (!blob.type.startsWith('video/') && !/\.(mp4|mov|m4v|webm)(\?|$)/i.test(url)) {
      throw new Error('not a video (' + (blob.type || 'unknown type') + ')');
    }
    let name;
    try { name = decodeURIComponent(new URL(url).pathname.split('/').pop()) || new URL(url).hostname; }
    catch { name = 'linked video'; }
    loadVideo(blob, name);
  } catch (e) {
    setStatus('Couldn\'t load that link (' + e.message + '). Most video hosts block cross-site access — use Share → Save Video in SwingVision and drop the file here instead. Once analyzed, it\'s kept in your history so you never load it twice.', 'err');
  }
}

function loadVideo(file, nameOverride) {
  if (!state.landmarker) { setStatus('Engine still loading — one moment…'); return; }
  state.videoBlob = file;
  state.sourceName = nameOverride || file.name || 'video';
  const url = URL.createObjectURL(file);
  const video = $('video');
  state.video = video;
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.onloadedmetadata = () => {
    $('stage').classList.remove('hidden');
    $('dropzone').classList.add('hidden');
    sizeCanvas();
    processVideo();
  };
  video.onerror = () => setStatus('Couldn\'t decode that video. Re-export from SwingVision as MP4 and try again.', 'err');
}

function sizeCanvas() {
  const video = $('video'), canvas = $('overlay');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
}

// ---------- processing ----------
async function processVideo() {
  const video = $('video');
  state.frames = [];
  state.overlayFrames = [];
  state.processing = true;
  $('progressWrap').classList.remove('hidden');
  setStatus('Tracking your body frame-by-frame…');

  // Deterministic seek-stepping: every frame is analyzed no matter how slow
  // the device is (a realtime-playback loop silently drops frames on slow GPUs).
  // Some containers (MediaRecorder webm, certain exports) report Infinity until
  // forced to scan: seek far past the end, then read the real duration.
  if (!isFinite(video.duration)) {
    await new Promise(resolve => {
      const done = () => { video.removeEventListener('durationchange', done); resolve(); };
      video.addEventListener('durationchange', done);
      video.currentTime = 1e7;
      setTimeout(resolve, 5000);
    });
  }
  const duration = isFinite(video.duration) ? video.duration : 0;
  if (!duration) {
    setStatus('Couldn\'t read the video\'s duration — re-export as MP4 and try again.', 'err');
    state.processing = false;
    $('progressWrap').classList.add('hidden');
    return;
  }
  const STEP = 1 / 30;
  video.pause();

  const seekTo = t => new Promise(resolve => {
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done);
    video.currentTime = Math.min(t, duration - 0.001);
  });

  let lastTs = 0; // MediaPipe requires strictly monotonically increasing integer timestamps
  const t0 = performance.now();
  for (let t = 0; t < duration && state.processing; t += STEP) {
    await seekTo(t);
    try {
      lastTs = Math.max(lastTs + 1, Math.round(t * 1000));
      const res = state.landmarker.detectForVideo(video, lastTs);
      const has = res.landmarks && res.landmarks.length > 0;
      state.frames.push({
        t,
        world: has ? res.worldLandmarks[0] : null,
        image: has ? res.landmarks[0] : null,
      });
      drawOverlay(has ? res.landmarks[0] : null);
    } catch (e) {
      state.frames.push({ t, world: null, image: null });
    }
    const p = Math.min(100, (t / duration) * 100);
    if (state.frames.length % 5 === 0 || p >= 99) {
      const elapsed = (performance.now() - t0) / 1000;
      const eta = p > 2 ? Math.round(elapsed * (100 - p) / p) : null;
      $('progressBar').style.width = p + '%';
      $('progressPct').textContent = Math.round(p) + '%' + (eta !== null ? ` · ~${eta}s left` : '');
      await new Promise(r => setTimeout(r, 0)); // let the UI breathe
    }
  }

  state.processing = false;
  $('progressWrap').classList.add('hidden');
  analyze();
}

function drawOverlay(imageLandmarks) {
  const canvas = $('overlay');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!imageLandmarks) return;
  const du = new DrawingUtils(ctx);
  du.drawConnectors(imageLandmarks, PoseLandmarker.POSE_CONNECTIONS,
    { color: 'rgba(64,224,178,0.9)', lineWidth: Math.max(2, canvas.width / 400) });
  du.drawLandmarks(imageLandmarks,
    { color: '#e8fff7', radius: Math.max(2, canvas.width / 500), lineWidth: 1 });
  // Emphasize the kinetic-chain joints
  const key = [LM.L_HIP, LM.R_HIP, LM.L_SHOULDER, LM.R_SHOULDER];
  ctx.fillStyle = '#ffb86b';
  for (const i of key) {
    const p = imageLandmarks[i];
    ctx.beginPath();
    ctx.arc(p.x * canvas.width, p.y * canvas.height, Math.max(3, canvas.width / 300), 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------- analysis ----------
function analyze(opts = {}) {
  const { save = true } = opts;
  const tracked = state.frames.filter(f => f.world).length;
  if (tracked < 30) {
    setStatus(`Only ${tracked} frames had a trackable player. SwingVision wide-angle exports work best — make sure the full body is visible.`, 'err');
    $('dropzone').classList.remove('hidden');
    return;
  }
  const handedness = $('handedness').value;
  setStatus(`Tracked ${tracked} frames. Computing biomechanics…`);

  state.series = buildSeries(state.frames, handedness);
  state.swings = detectSwings(state.series);
  if (!state.swings.length) {
    setStatus('No clear swings detected — the clip may be too zoomed out or the player too small in frame. Try a rally clip where you fill more of the frame.', 'err');
    return;
  }
  state.measures = state.swings.map(s => measureSwing(state.series, s, handedness));
  const agg = aggregate(state.measures);
  state.report = buildReport(agg);

  renderReport();
  fetchAICoach(agg, state.report);
  setStatus(`Analysis complete — ${state.swings.length} swing${state.swings.length > 1 ? 's' : ''} detected and measured.`, 'ok');
  if (save) persistSession(agg);
}

// ---------- history ----------
async function persistSession(agg) {
  try {
    const record = {
      date: Date.now(),
      name: state.sourceName || 'session',
      overall: state.report.overall,
      swings: state.measures.length,
      agg,
      frames: state.frames,
    };
    if (state.videoBlob && state.videoBlob.size <= MAX_STORED_VIDEO) {
      record.videoBlob = state.videoBlob;
    }
    await saveSession(record);
    renderHistory();
  } catch (e) {
    // Storage full or blocked — history is a convenience, never fatal
    console.warn('history save failed:', e);
  }
}

async function renderHistory() {
  let sessions = [];
  try { sessions = await listSessions(); } catch { return; }
  const sec = $('historySec');
  if (!sessions.length) { sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');
  $('historyList').innerHTML = sessions.map(s => `
    <div class="histCard" data-id="${s.id}">
      <div class="histScore">${s.overall ?? '–'}</div>
      <div class="histMeta">
        <strong>${escapeHtml(s.name)}</strong>
        <span>${new Date(s.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
        · ${s.swings} swing${s.swings === 1 ? '' : 's'}${s.hasVideo ? '' : ' · report only'}</span>
      </div>
      <button class="histDel" data-id="${s.id}" title="Delete this session">✕</button>
    </div>`).join('');

  document.querySelectorAll('.histCard').forEach(card =>
    card.addEventListener('click', e => {
      if (e.target.classList.contains('histDel')) return;
      restoreSession(+card.dataset.id);
    }));
  document.querySelectorAll('.histDel').forEach(btn =>
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      await deleteSession(+btn.dataset.id).catch(() => {});
      renderHistory();
    }));

  drawTrend($('trendChart'), sessions);
}

async function restoreSession(id) {
  const s = await getSession(id).catch(() => null);
  if (!s) return;
  setStatus('Loading saved session…');
  state.frames = s.frames;
  state.sourceName = s.name;
  state.videoBlob = s.videoBlob || null;
  $('dropzone').classList.add('hidden');
  if (s.videoBlob) {
    const video = $('video');
    state.video = video;
    video.src = URL.createObjectURL(s.videoBlob);
    video.muted = true;
    video.playsInline = true;
    await new Promise(r => { video.onloadedmetadata = r; });
    $('stage').classList.remove('hidden');
    sizeCanvas();
  } else {
    $('stage').classList.add('hidden');
  }
  analyze({ save: false });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function drawTrend(canvas, sessions) {
  const pts = [...sessions].reverse().filter(s => s.overall !== null && s.overall !== undefined);
  if (pts.length < 2) { canvas.classList.add('hidden'); return; }
  canvas.classList.remove('hidden');
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.offsetWidth * 2;
  const H = canvas.height = canvas.offsetHeight * 2;
  ctx.clearRect(0, 0, W, H);
  const pad = 34;
  const X = i => pad + (i / (pts.length - 1)) * (W - pad * 2);
  const Y = v => H - pad - (v / 100) * (H - pad * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  for (const g of [25, 50, 75, 100]) {
    ctx.beginPath(); ctx.moveTo(pad, Y(g)); ctx.lineTo(W - pad, Y(g)); ctx.stroke();
  }
  ctx.beginPath();
  pts.forEach((s, i) => i ? ctx.lineTo(X(i), Y(s.overall)) : ctx.moveTo(X(0), Y(s.overall)));
  ctx.strokeStyle = 'rgba(64,224,178,0.95)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#40e0b2';
  pts.forEach((s, i) => {
    ctx.beginPath(); ctx.arc(X(i), Y(s.overall), 6, 0, Math.PI * 2); ctx.fill();
  });
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `${Math.round(W / 55)}px system-ui`;
  ctx.textAlign = 'center';
  pts.forEach((s, i) => ctx.fillText(String(s.overall), X(i), Y(s.overall) - 14));
  ctx.textAlign = 'left';
  ctx.fillText('Session score over time', pad, 24);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- rendering ----------
function renderReport() {
  const r = state.report;
  $('report').classList.remove('hidden');

  // Overall score dial
  $('overallScore').textContent = r.overall;
  $('overallLabel').textContent =
    r.overall >= 80 ? 'ATP-pattern mechanics' :
    r.overall >= 60 ? 'Solid base — refinements needed' :
    r.overall >= 40 ? 'Developing — big gains available' :
    'Arm-dominant pattern — rebuild the chain';
  $('swingCount').textContent = r.agg.swings;

  // Radar
  drawRadar($('radar'), r.scored);

  // Top 3
  $('topThree').innerHTML = r.topThree.map((d, i) => `
    <div class="card critical">
      <div class="cardRank">${i + 1}</div>
      <h4>${d.label}</h4>
      <div class="scoreRow"><div class="bar"><div style="width:${d.score}%"></div></div><span>${Math.round(d.score)}</span></div>
      <p>${d.finding}</p>
      <p class="ref">${d.ref}</p>
    </div>`).join('');

  // Focus 5
  $('focusFive').innerHTML = r.focusFive.map((d, i) => `
    <li>
      <span class="fRank">${i + 1}</span>
      <div><strong>${d.label}</strong> — score ${Math.round(d.score)}/100
      <div class="fDetail">${d.finding}</div></div>
    </li>`).join('');

  // Full metric table
  $('metricsTable').innerHTML = `
    <tr><th>Metric</th><th>Yours (median)</th><th>ATP reference</th><th>Score</th></tr>` +
    r.scored.map(d => `
      <tr>
        <td>${d.label}</td>
        <td>${d.value === null ? '—' : (+d.value).toFixed(d.unit === 'torso-lengths' || d.unit === 's' ? 2 : d.unit === 'TL/s' ? 1 : 0)} ${d.unit}</td>
        <td class="refCell">${d.ref.replace('ATP: ', '')}</td>
        <td><span class="pill ${d.score >= 70 ? 'good' : d.score >= 45 ? 'mid' : 'bad'}">${Math.round(d.score)}</span></td>
      </tr>`).join('');

  // Drills for the top 3
  $('drills').innerHTML = r.topThree.map(d => `
    <div class="drillGroup">
      <h4>${d.label}</h4>
      ${d.drills.map(dr => `
        <div class="drill">
          <strong>${dr.name}</strong>
          <p>${dr.how}</p>
          <p class="why">Why: ${dr.why}</p>
        </div>`).join('')}
    </div>`).join('');

  // Per-swing chips
  $('swingList').innerHTML = state.measures.map((m, i) => `
    <button class="swingChip" data-t="${m.tContact}">
      Swing ${i + 1} · ${m.tContact.toFixed(1)}s · ${m.peakSpeed.toFixed(1)} TL/s
    </button>`).join('');
  document.querySelectorAll('.swingChip').forEach(b =>
    b.addEventListener('click', () => {
      const v = $('video');
      v.currentTime = Math.max(0, +b.dataset.t - 1.2);
      v.playbackRate = 0.4;
      v.play();
      setTimeout(() => { v.pause(); v.playbackRate = 1; }, 5000);
      replayOverlay();
    }));

  // Charts
  drawTimeline($('chartXfactor'), state.series.t, state.series.xFactor, 'X-Factor (°)', state.swings, state.series);
  drawTimeline($('chartSpeed'), state.series.t, state.series.wristSpeed, 'Racquet-hand speed (TL/s)', state.swings, state.series);

  // Plan integration
  $('planRows').innerHTML = planIntegration(r).map(row => `
    <tr><td>${row.phase}</td><td>${row.action}</td></tr>`).join('');
}

// Redraw skeleton during replay
function replayOverlay() {
  const v = $('video');
  const step = () => {
    if (v.paused || v.ended) return;
    const t = v.currentTime;
    let best = null, bd = Infinity;
    for (const f of state.frames) {
      const d = Math.abs(f.t - t);
      if (d < bd) { bd = d; best = f; }
    }
    if (best && bd < 0.1) drawOverlay(best.image);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- charts (canvas, no deps) ----------
function drawRadar(canvas, dims) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.offsetWidth * 2;
  const H = canvas.height = canvas.offsetHeight * 2;
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.34;
  const n = dims.length;
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = `${Math.round(W / 46)}px system-ui`;
  for (let ring = 1; ring <= 4; ring++) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const r = R * ring / 4;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  dims.forEach((d, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    ctx.textAlign = Math.cos(a) > 0.3 ? 'left' : Math.cos(a) < -0.3 ? 'right' : 'center';
    ctx.fillText(d.label.split(' & ')[0], cx + Math.cos(a) * (R + 14), cy + Math.sin(a) * (R + 14) + 5);
  });
  ctx.beginPath();
  dims.forEach((d, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = R * (d.score / 100);
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = 'rgba(64,224,178,0.25)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(64,224,178,0.95)';
  ctx.lineWidth = 3;
  ctx.stroke();
}

function drawTimeline(canvas, t, series, label, swings, allSeries) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.offsetWidth * 2;
  const H = canvas.height = canvas.offsetHeight * 2;
  ctx.clearRect(0, 0, W, H);
  const vals = series.filter(v => v !== null && isFinite(v));
  if (!vals.length) return;
  const min = Math.min(...vals), max = Math.max(...vals);
  const pad = 30;
  const X = i => pad + (t[i] / t[t.length - 1]) * (W - pad * 2);
  const Y = v => H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2);
  // swing contact markers
  ctx.fillStyle = 'rgba(255,184,107,0.18)';
  for (const s of swings) {
    const x0 = X(s.start), x1 = X(s.end);
    ctx.fillRect(x0, 0, x1 - x0, H);
  }
  ctx.strokeStyle = 'rgba(255,184,107,0.8)';
  for (const s of swings) {
    ctx.beginPath(); ctx.moveTo(X(s.contact), 0); ctx.lineTo(X(s.contact), H); ctx.stroke();
  }
  // trace
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < series.length; i++) {
    const v = series[i];
    if (v === null || !isFinite(v)) { started = false; continue; }
    const x = X(i), y = Y(v);
    started ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    started = true;
  }
  ctx.strokeStyle = 'rgba(64,224,178,0.95)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.font = `${Math.round(W / 60)}px system-ui`;
  ctx.textAlign = 'left';
  ctx.fillText(label, pad, 24);
  void allSeries;
}

// ---------- Claude coach narrative ----------
async function fetchAICoach(agg, report) {
  const box = $('aiCoach');
  box.innerHTML = '<div class="aiThinking">Writing your personalized coaching letter…</div>';
  try {
    const res = await fetch('/api/analyze-swing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aggregate: agg,
        scores: report.scored.map(d => ({ label: d.label, score: Math.round(d.score), value: d.value, ref: d.ref })),
        topThree: report.topThree.map(d => d.label),
      }),
    });
    if (!res.ok) throw new Error('api ' + res.status);
    const data = await res.json();
    box.innerHTML = `<div class="aiLetter">${data.letter.replace(/\n\n/g, '</p><p>').replace(/^/, '<p>')}</p></div>
      <div class="aiTag">Written by Claude from your measured numbers</div>`;
  } catch {
    // Offline / no API key → built-in letter from the rules engine
    const worst = report.topThree.map(d => d.label.toLowerCase()).join(', ');
    box.innerHTML = `<div class="aiLetter"><p>Coach's summary (offline mode): your session scored ${report.overall}/100 against the ATP pattern model. The measurements point to one root cause expressed three ways — ${worst}. Work the drills below in order; they're sequenced so each one feeds the next. Re-film in one week from the same camera angle and compare your numbers here.</p></div>
      <div class="aiTag">Built-in analysis · deploy with ANTHROPIC_API_KEY set to get the full Claude coaching letter</div>`;
  }
}

// ---------- print/export ----------
function wireExport() {
  $('printBtn').addEventListener('click', () => window.print());
  $('newVideoBtn').addEventListener('click', () => {
    $('report').classList.add('hidden');
    $('stage').classList.add('hidden');
    $('dropzone').classList.remove('hidden');
    setStatus('Engine ready. Drop your next video.', 'ok');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// ---------- go ----------
wireDropzone();
wireExport();
renderHistory();
initModel().catch(e => setStatus('Engine failed to load: ' + e.message + ' — try a Chromium-based browser.', 'err'));
void DIMENSIONS;

// Dev/test hook: inject a pre-tracked frame stream and run the analysis+report
// pipeline without a video (used by the automated test harness).
window.__swinglab = {
  state,
  injectFrames(frames) {
    state.frames = frames;
    analyze();
    return state.report;
  },
};
