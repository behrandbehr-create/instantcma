// SwingLab — main controller
import { PoseLandmarker, FilesetResolver, DrawingUtils } from '../vendor/vision_bundle.mjs';
import { buildSeries, detectSwings, measureSwing, aggregate, LM } from './metrics.js';
import { buildReport, planIntegration, DIMENSIONS } from './coach.js';
import { saveSession, listSessions, getSession, deleteSession } from './db.js';
import { measureSegments, ghostPoseAt, GHOST_BONES, GHOST_CONTACT_PHASE, buildCallouts } from './ghost.js';

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
const IS_MOBILE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent)); // iPadOS masquerades as Mac

async function initModel() {
  setStatus('Loading body-tracking engine…');
  const fileset = await FilesetResolver.forVisionTasks('./vendor/wasm');

  // Phones get the lite model (5.8MB, several× faster); desktops get full accuracy.
  const modelFile = IS_MOBILE ? 'pose_landmarker_lite.task' : 'pose_landmarker_full.task';
  const resp = await fetch('./vendor/' + modelFile);
  if (!resp.ok) throw new Error('model download failed (' + resp.status + ')');
  const total = +resp.headers.get('Content-Length') || 0;
  let modelBuf;
  if (resp.body && total) {
    const reader = resp.body.getReader();
    const chunks = [];
    let got = 0, lastPct = -1;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      const pct = Math.round((got / total) * 100);
      if (pct !== lastPct) { lastPct = pct; setStatus(`Downloading body-tracking model… ${pct}%`); }
    }
    modelBuf = new Uint8Array(got);
    let off = 0;
    for (const c of chunks) { modelBuf.set(c, off); off += c.length; }
  } else {
    modelBuf = new Uint8Array(await resp.arrayBuffer());
  }

  setStatus('Starting engine…');
  const make = delegate => PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: modelBuf, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  state.landmarker = await make('GPU').catch(() => make('CPU'));
  setStatus('Engine ready. Load your SwingVision export to begin.', 'ok');
  $('dropzone').classList.add('ready');
}

// Surface any silent failure in the status bar so "nothing happened" becomes diagnosable
window.addEventListener('error', e => {
  setStatus('Something broke: ' + (e.message || 'unknown error') + ' — screenshot this message for Claude.', 'err');
});
window.addEventListener('unhandledrejection', e => {
  const msg = e.reason && e.reason.message ? e.reason.message : String(e.reason);
  setStatus('Something broke: ' + msg + ' — screenshot this message for Claude.', 'err');
});

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

// Rewrite share-page links into direct-download form where the pattern is known
// (Dropbox "scl" share links → dl.dropboxusercontent.com with dl=1).
function normalizeVideoURL(u) {
  try {
    const url = new URL(u);
    if (url.hostname.endsWith('dropbox.com') && url.pathname.startsWith('/scl/')) {
      url.hostname = 'dl.dropboxusercontent.com';
      url.searchParams.set('dl', '1');
      return url.toString();
    }
  } catch {}
  return u;
}

// Try to pull a video straight from a pasted link. Works for direct video
// links whose host allows cross-site access; SwingVision match PAGES block
// browser access, so those get a clear explanation instead of a cryptic error.
async function loadVideoFromURL(url) {
  if (!state.landmarker) { setStatus('Engine still loading — one moment…'); return; }
  url = normalizeVideoURL(url);
  if (/swing\.vision\/(matches|share)/i.test(url) && !/\.(mp4|mov|m4v|webm)(\?|$)/i.test(url)) {
    setStatus('That\'s a SwingVision match page — their site doesn\'t let other websites read it directly. In the SwingVision app: Share → Save Video, then drop the file here (it stays saved in your history afterward).', 'err');
    return;
  }
  setStatus('Fetching video from link…');
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    if (!blob.type.startsWith('video/') && !/\.(mp4|mov|m4v|webm)(\?|&|$)/i.test(url)) {
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
  resetReplay();
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
  video.onerror = () => setStatus('Couldn\'t decode that video on this device. iPhone .mov files often use HEVC, which desktop browsers can\'t always play — either open this site on your phone (it plays HEVC natively), or export from SwingVision as an MP4.', 'err');
}

function sizeCanvas() {
  const video = $('video'), canvas = $('overlay');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
}

// ---------- processing ----------
function fmtEta(s) {
  s = Math.round(s);
  return s >= 90 ? Math.round(s / 60) + ' min' : s + 's';
}

async function processVideo() {
  const video = $('video');
  state.frames = [];
  state.overlayFrames = [];
  state.processing = true;
  $('progressWrap').classList.remove('hidden');
  setStatus('Tracking your body frame-by-frame…');

  // Keep the phone screen awake — locking the screen mid-analysis kills the job
  let wakeLock = null;
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}

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

  // Single playback pass: the video plays once at normal speed while the pose
  // model samples the presented frames. Decoding stays sequential (hardware,
  // effectively free) — the old seek-per-frame approach forced iPhones to
  // re-decode from the previous keyframe on EVERY step, which turned long
  // HEVC clips into multi-hour jobs. Total time now ≈ the video's duration.
  const TARGET = IS_MOBILE ? 1 / 20 : 1 / 30; // seconds between samples
  let lastTs = 0; // MediaPipe requires strictly monotonically increasing integer timestamps
  let nextSample = 0;
  video.muted = true;
  video.playbackRate = 1;
  video.currentTime = 0;
  setStatus('Tracking your body — one pass through the video…');
  await video.play().catch(() => {});

  await new Promise(resolve => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };
    if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return finish();
    const onFrame = (_now, meta) => {
      if (!state.processing) return finish();
      const t = meta.mediaTime;
      if (t >= nextSample) {
        nextSample = t + TARGET;
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
        $('progressBar').style.width = p + '%';
        $('progressPct').textContent = `Analyzing mechanics… ${Math.round(p)}% · ~${fmtEta(Math.max(0, duration - t))} left`;
      }
      if (video.ended) return finish();
      video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
    video.addEventListener('ended', finish, { once: true });
  });

  video.pause();
  try { wakeLock?.release(); } catch {}
  state.processing = false;
  $('progressWrap').classList.add('hidden');
  analyze();
}

function drawOverlay(imageLandmarks, crop = null) {
  const canvas = $('overlay');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (crop) {
    const video = $('video');
    const vw = video.videoWidth, vh = video.videoHeight;
    if (vw && vh) {
      ctx.drawImage(video, crop.x * vw, crop.y * vh, crop.f * vw, crop.f * vh,
        0, 0, canvas.width, canvas.height);
    }
  }
  if (!imageLandmarks) return;
  const pts = crop ? imageLandmarks.map(tfPoint) : imageLandmarks;
  const du = new DrawingUtils(ctx);
  du.drawConnectors(pts, PoseLandmarker.POSE_CONNECTIONS,
    { color: 'rgba(64,224,178,0.9)', lineWidth: Math.max(2, canvas.width / 400) });
  du.drawLandmarks(pts,
    { color: '#e8fff7', radius: Math.max(2, canvas.width / 500), lineWidth: 1 });
  // Emphasize the kinetic-chain joints
  const key = [LM.L_HIP, LM.R_HIP, LM.L_SHOULDER, LM.R_SHOULDER];
  ctx.fillStyle = '#ffb86b';
  for (const i of key) {
    const p = pts[i];
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
// Two layers of persistence:
//  1. IndexedDB — full record (optionally with replay frames + video)
//  2. localStorage mirror — a tiny summary (agg + measures, a few KB) that
//     survives even when a mobile browser evicts IndexedDB. Reports can be
//     fully rebuilt from it; only video replay is lost.
const TREND_KEY = 'swinglab_sessions_v1';

function loadTrend() {
  try { return JSON.parse(localStorage.getItem(TREND_KEY) || '[]'); } catch { return []; }
}
function saveTrend(list) {
  try { localStorage.setItem(TREND_KEY, JSON.stringify(list.slice(-60))); } catch {}
}

async function persistSession(agg) {
  const date = Date.now();
  const name = state.sourceName || 'session';

  // Layer 2 first — it must never be blocked by layer 1 failing
  const trend = loadTrend();
  trend.push({ date, name, overall: state.report.overall, swings: state.measures.length, agg, measures: state.measures });
  saveTrend(trend);

  try { await navigator.storage?.persist?.(); } catch {}
  try {
    const record = { date, name, overall: state.report.overall, swings: state.measures.length, agg, measures: state.measures };
    // Replay data only when light enough to store reliably (huge records are
    // exactly what makes mobile IndexedDB writes fail silently)
    if (state.frames.length <= 3000) {
      record.frames = state.frames;
      const cap = IS_MOBILE ? 120 * 1024 * 1024 : MAX_STORED_VIDEO;
      if (state.videoBlob && state.videoBlob.size <= cap) record.videoBlob = state.videoBlob;
    }
    await saveSession(record);
  } catch (e) {
    console.warn('IndexedDB save failed (summary still kept):', e);
  }
  renderHistory();
}

async function renderHistory() {
  let sessions = [];
  try { sessions = await listSessions(); } catch { sessions = []; }
  // Merge in localStorage summaries that IndexedDB no longer has (evicted or
  // never saved) — matched by timestamp
  const idbDates = new Set(sessions.map(s => s.date));
  const summaries = loadTrend().filter(t => !idbDates.has(t.date))
    .map(t => ({ ...t, id: null, hasVideo: false, summaryOnly: true }));
  const all = [...sessions, ...summaries].sort((a, b) => b.date - a.date);

  const sec = $('historySec');
  if (!all.length) { sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');
  $('historyList').innerHTML = all.map((s, i) => `
    <div class="histCard" data-id="${s.id ?? ''}" data-date="${s.date}">
      <div class="histScore">${s.overall ?? '–'}</div>
      <div class="histMeta">
        <strong>${escapeHtml(s.name)}</strong>
        <span>${new Date(s.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
        · ${s.swings} swing${s.swings === 1 ? '' : 's'}${s.hasVideo ? '' : ' · report only'}</span>
      </div>
      ${s.id !== null ? `<label class="histCmpWrap" title="Select two sessions to compare">
        <input type="checkbox" class="histCmp" data-id="${s.id}"> compare
      </label>` : ''}
      <button class="histDel" data-id="${s.id ?? ''}" data-date="${s.date}" title="Delete this session">✕</button>
    </div>`).join('');

  document.querySelectorAll('.histCard').forEach(card =>
    card.addEventListener('click', e => {
      if (e.target.classList.contains('histDel') || e.target.classList.contains('histCmp') ||
          e.target.classList.contains('histCmpWrap')) return;
      if (card.dataset.id) restoreSession(+card.dataset.id);
      else restoreSummary(+card.dataset.date);
    }));
  document.querySelectorAll('.histDel').forEach(btn =>
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (btn.dataset.id) await deleteSession(+btn.dataset.id).catch(() => {});
      saveTrend(loadTrend().filter(t => t.date !== +btn.dataset.date));
      renderHistory();
    }));
  document.querySelectorAll('.histCmp').forEach(cb =>
    cb.addEventListener('change', onCompareToggle));

  drawTrend($('trendChart'), all);
}

// Rebuild a full report from a localStorage summary (no video/replay data)
function restoreSummary(date) {
  const s = loadTrend().find(t => t.date === date);
  if (!s) return;
  state.frames = [];
  state.series = null;
  state.swings = [];
  state.measures = s.measures || [];
  state.videoBlob = null;
  state.sourceName = s.name;
  state.report = buildReport(s.agg);
  $('dropzone').classList.add('hidden');
  $('stage').classList.add('hidden');
  renderReport();
  setStatus(`Loaded saved report from ${new Date(date).toLocaleDateString()} — replay isn't available for summary-only sessions.`, 'ok');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- session compare ----------
function onCompareToggle() {
  const sel = [...document.querySelectorAll('.histCmp:checked')].map(cb => +cb.dataset.id);
  if (sel.length > 2) { this.checked = false; return; }
  if (sel.length === 2) renderCompare(sel[0], sel[1]);
  else $('compareSec').classList.add('hidden');
}

async function renderCompare(idA, idB) {
  let a = await getSession(idA).catch(() => null);
  let b = await getSession(idB).catch(() => null);
  if (!a || !b) return;
  if (a.date > b.date) [a, b] = [b, a]; // A = earlier, B = later
  const ra = buildReport(a.agg), rb = buildReport(b.agg);
  const fmtD = ts => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  $('compareSec').classList.remove('hidden');
  $('compareTitle').textContent = `${fmtD(a.date)} (${ra.overall}) vs ${fmtD(b.date)} (${rb.overall})`;
  const delta = rb.overall - ra.overall;
  $('compareDelta').textContent = (delta >= 0 ? '+' : '') + delta + ' overall';
  $('compareDelta').className = 'cmpDelta ' + (delta > 0 ? 'up' : delta < 0 ? 'down' : '');

  const byId = list => Object.fromEntries(list.map(d => [d.id, d]));
  const A = byId(ra.scored), B = byId(rb.scored);
  $('compareTable').innerHTML =
    `<tr><th>Metric</th><th>${fmtD(a.date)}</th><th>${fmtD(b.date)}</th><th>Δ</th></tr>` +
    rb.scored.map(d => {
      const sa = A[d.id] ? Math.round(A[d.id].score) : null;
      const sb = Math.round(d.score);
      const dd = sa === null ? null : sb - sa;
      const cls = dd === null ? '' : dd > 0 ? 'up' : dd < 0 ? 'down' : '';
      return `<tr>
        <td>${d.label}</td>
        <td>${sa ?? '—'}</td>
        <td>${sb}</td>
        <td class="cmpDelta ${cls}">${dd === null ? '—' : (dd >= 0 ? '+' : '') + dd}</td>
      </tr>`;
    }).join('');

  drawRadarCompare($('compareRadar'), ra.scored, B, fmtD(a.date), fmtD(b.date));
  $('compareSec').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function drawRadarCompare(canvas, dimsA, dimsBById, labelA, labelB) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.offsetWidth * 2;
  const H = canvas.height = canvas.offsetHeight * 2;
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.32;
  const n = dimsA.length;
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = `${Math.round(W / 48)}px system-ui`;
  for (let ring = 1; ring <= 4; ring++) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
      const r = R * ring / 4;
      const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  dimsA.forEach((d, i) => {
    const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
    ctx.textAlign = Math.cos(ang) > 0.3 ? 'left' : Math.cos(ang) < -0.3 ? 'right' : 'center';
    ctx.fillText(d.label.split(' & ')[0], cx + Math.cos(ang) * (R + 14), cy + Math.sin(ang) * (R + 14) + 5);
  });
  const poly = (scores, stroke, fill) => {
    ctx.beginPath();
    scores.forEach((s, i) => {
      const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
      const r = R * (s / 100);
      const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = stroke; ctx.lineWidth = 3; ctx.stroke();
  };
  poly(dimsA.map(d => d.score), 'rgba(150,170,190,0.9)', 'rgba(150,170,190,0.12)');
  poly(dimsA.map(d => dimsBById[d.id] ? dimsBById[d.id].score : 0), 'rgba(64,224,178,0.95)', 'rgba(64,224,178,0.2)');
  ctx.font = `${Math.round(W / 44)}px system-ui`;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(150,170,190,0.95)';
  ctx.fillText('— ' + labelA, 16, H - 40);
  ctx.fillStyle = 'rgba(64,224,178,0.95)';
  ctx.fillText('— ' + labelB, 16, H - 14);
}

function resetReplay() {
  replay.active = false;
  replay.segs = null;
  cancelAnimationFrame(replay.raf);
  const bar = $('replayBar');
  if (bar) bar.classList.add('hidden');
}

async function restoreSession(id) {
  const s = await getSession(id).catch(() => null);
  if (!s) return;
  setStatus('Loading saved session…');
  resetReplay();
  state.sourceName = s.name;
  state.videoBlob = s.videoBlob || null;
  $('dropzone').classList.add('hidden');

  if (!s.frames || !s.frames.length) {
    // Compact record: rebuild the report from stored aggregates
    state.frames = [];
    state.series = null;
    state.swings = [];
    state.measures = s.measures || [];
    state.report = buildReport(s.agg);
    $('stage').classList.add('hidden');
    renderReport();
    setStatus(`Loaded saved report from ${new Date(s.date).toLocaleDateString()}.`, 'ok');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  state.frames = s.frames;
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

  // Per-swing chips + charts need the full frame series; summary-only
  // restores hide that section but keep every score, finding and drill.
  const kinSection = $('chartXfactor').closest('section');
  if (state.series) {
    kinSection.classList.remove('hidden');
    $('swingList').innerHTML = state.measures.map((m, i) => `
      <button class="swingChip" data-i="${i}">
        Swing ${i + 1} · ${m.tContact.toFixed(1)}s · ${m.peakSpeed.toFixed(1)} TL/s
      </button>`).join('');
    document.querySelectorAll('.swingChip').forEach(b =>
      b.addEventListener('click', () => startReplay(+b.dataset.i)));
    drawTimeline($('chartXfactor'), state.series.t, state.series.xFactor, 'X-Factor (°)', state.swings, state.series);
    drawTimeline($('chartSpeed'), state.series.t, state.series.wristSpeed, 'Racquet-hand speed (TL/s)', state.swings, state.series);
  } else {
    kinSection.classList.add('hidden');
  }

  // Plan integration
  $('planRows').innerHTML = planIntegration(r).map(row => `
    <tr><td>${row.phase}</td><td>${row.action}</td></tr>`).join('');
}

// ---------- ghost replay ----------
const replay = { active: false, idx: 0, ghost: true, zoom: IS_MOBILE, crop: null, segs: null, anchor: null, mirror: 1, callouts: [], raf: 0 };

// Square crop (normalized units — equal fractions preserve aspect) around the
// tracked body, padded so the full swing stays in frame.
function computeCrop(im) {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of im) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const f = Math.min(1, Math.max(0.32, Math.max(maxX - minX, maxY - minY) * 1.65));
  let x = (minX + maxX) / 2 - f / 2;
  let y = (minY + maxY) / 2 - f / 2;
  x = Math.min(Math.max(x, 0), 1 - f);
  y = Math.min(Math.max(y, 0), 1 - f);
  return { x, y, f };
}

function tfPoint(p) {
  const c = replay.crop;
  if (!c) return p;
  return { x: (p.x - c.x) / c.f, y: (p.y - c.y) / c.f };
}

function nearestFrame(t) {
  let best = null, bd = Infinity;
  for (const f of state.frames) {
    const d = Math.abs(f.t - t);
    if (d < bd) { bd = d; best = f; }
  }
  return bd < 0.12 ? best : null;
}

function startReplay(idx) {
  if (!state.video || !state.videoBlob) {
    setStatus('This session was saved without its video, so replay isn\'t available — but all scores and findings are.', 'err');
    return;
  }
  const m = state.measures[idx];
  replay.active = true;
  replay.idx = idx;
  replay.segs = replay.segs || measureSegments(state.frames);
  replay.callouts = buildCallouts(m);

  // Anchor the ghost at the player's median hip position across the swing,
  // scaled by their on-screen torso length; mirror to match swing direction.
  const win = state.frames.filter(f => f.image && f.t >= m.tStart && f.t <= m.tEnd);
  const hx = [], hy = [], tl = [];
  for (const f of win) {
    const im = f.image;
    const hcx = (im[LM.L_HIP].x + im[LM.R_HIP].x) / 2, hcy = (im[LM.L_HIP].y + im[LM.R_HIP].y) / 2;
    const scx = (im[LM.L_SHOULDER].x + im[LM.R_SHOULDER].x) / 2, scy = (im[LM.L_SHOULDER].y + im[LM.R_SHOULDER].y) / 2;
    hx.push(hcx); hy.push(hcy); tl.push(Math.hypot(scx - hcx, scy - hcy));
  }
  const medOf = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0.5; };
  replay.anchor = { x: medOf(hx), y: medOf(hy), torso: medOf(tl) || 0.15 };
  const fc = nearestFrame(m.tContact), fs = nearestFrame(m.tStart);
  const R = $('handedness').value === 'right';
  const WR = R ? LM.R_WRIST : LM.L_WRIST;
  replay.mirror = (fc?.image && fs?.image && fc.image[WR].x < fs.image[WR].x) ? -1 : 1;

  $('replayBar').classList.remove('hidden');
  $('replayLabel').textContent = `Swing ${idx + 1}`;
  $('ghostToggle').checked = replay.ghost;
  $('zoomToggle').checked = replay.zoom;
  replay.crop = null;
  const v = $('video');
  v.pause();
  v.playbackRate = +$('replaySpeed').value;
  v.currentTime = m.tStart;
  v.play();
  $('stage').scrollIntoView({ behavior: 'smooth', block: 'center' });
  cancelAnimationFrame(replay.raf);
  replayLoop();
}

function replayLoop() {
  if (!replay.active) return;
  const v = $('video');
  const m = state.measures[replay.idx];
  const t = v.currentTime;
  if (!v.paused && t >= m.tEnd + 0.15) { v.currentTime = m.tStart; } // loop the swing
  const f = nearestFrame(t);

  // Auto-zoom: glide the crop toward the tracked body
  if (replay.zoom && f?.image) {
    const target = computeCrop(f.image);
    const c = replay.crop;
    replay.crop = c
      ? { x: c.x + (target.x - c.x) * 0.12, y: c.y + (target.y - c.y) * 0.12, f: c.f + (target.f - c.f) * 0.12 }
      : target;
  } else if (!replay.zoom) {
    replay.crop = null;
  }
  v.style.visibility = (replay.zoom && replay.crop) ? 'hidden' : '';

  drawOverlay(f ? f.image : null, replay.crop);
  const phase = phaseAt(t, m);
  $('replayScrub').value = String(Math.round(phase * 1000));
  if (replay.ghost && phase >= 0 && phase <= 1) drawGhost(phase);
  replay.raf = requestAnimationFrame(replayLoop);
}

// Map video time → ghost phase, pinning the ghost's contact to the player's.
function phaseAt(t, m) {
  if (t <= m.tStart) return 0;
  if (t >= m.tEnd) return 1;
  if (t <= m.tContact) return (t - m.tStart) / (m.tContact - m.tStart) * GHOST_CONTACT_PHASE;
  return GHOST_CONTACT_PHASE + (t - m.tContact) / (m.tEnd - m.tContact) * (1 - GHOST_CONTACT_PHASE);
}

function ghostToCanvas(g, canvas) {
  const a = replay.anchor, s = a.torso / replay.segs.torso;
  const p = tfPoint({ x: a.x + replay.mirror * g.x * s, y: a.y + g.y * s });
  return { x: p.x * canvas.width, y: p.y * canvas.height };
}

function drawGhost(phase) {
  const canvas = $('overlay');
  const ctx = canvas.getContext('2d');
  const pose = ghostPoseAt(phase, replay.segs);
  const lw = Math.max(2.5, canvas.width / 350);

  ctx.save();
  ctx.shadowColor = 'rgba(255,200,90,0.9)';
  ctx.shadowBlur = lw * 4;
  ctx.strokeStyle = 'rgba(255,216,140,0.65)';
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  for (const [j1, j2] of GHOST_BONES) {
    const p1 = ghostToCanvas(pose[j1], canvas), p2 = ghostToCanvas(pose[j2], canvas);
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
  }
  const head = ghostToCanvas(pose.head, canvas);
  ctx.beginPath();
  ctx.arc(head.x, head.y, lw * 2.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Deviation callouts (max 2 at a time)
  const active = replay.callouts.filter(c => phase >= c.from && phase <= c.to).slice(0, 2);
  active.forEach((c, i) => {
    const p = ghostToCanvas(pose[c.joint], canvas);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,90,110,0.95)';
    ctx.lineWidth = lw * 0.8;
    ctx.beginPath();
    ctx.arc(p.x, p.y, lw * 3.6, 0, Math.PI * 2);
    ctx.stroke();
    const fs = Math.max(13, canvas.width / 60);
    ctx.font = `600 ${fs}px system-ui`;
    const label = c.text;
    const tw = ctx.measureText(label).width;
    let lx = Math.min(Math.max(p.x - tw / 2, 10), canvas.width - tw - 22);
    const ly = 14 + i * (fs + 22);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - lw * 3.6);
    ctx.lineTo(lx + tw / 2 + 6, ly + fs + 10);
    ctx.stroke();
    ctx.fillStyle = 'rgba(20,8,10,0.82)';
    ctx.beginPath();
    ctx.roundRect(lx - 8, ly, tw + 16, fs + 12, 8);
    ctx.fill();
    ctx.fillStyle = '#ff8296';
    ctx.fillText(label, lx, ly + fs + 2);
    ctx.restore();
  });
}

function wireReplayBar() {
  const v = $('video');
  $('replayPlay').addEventListener('click', () => {
    if (v.paused) { v.playbackRate = +$('replaySpeed').value; v.play(); }
    else v.pause();
  });
  $('replaySpeed').addEventListener('change', () => { v.playbackRate = +$('replaySpeed').value; });
  $('ghostToggle').addEventListener('change', e => { replay.ghost = e.target.checked; });
  $('zoomToggle').addEventListener('change', e => {
    replay.zoom = e.target.checked;
    if (!replay.zoom) { replay.crop = null; $('video').style.visibility = ''; }
  });
  $('replayScrub').addEventListener('input', e => {
    const m = state.measures[replay.idx];
    if (!m) return;
    v.pause();
    const ph = +e.target.value / 1000;
    v.currentTime = ph <= GHOST_CONTACT_PHASE
      ? m.tStart + (ph / GHOST_CONTACT_PHASE) * (m.tContact - m.tStart)
      : m.tContact + ((ph - GHOST_CONTACT_PHASE) / (1 - GHOST_CONTACT_PHASE)) * (m.tEnd - m.tContact);
  });
  $('replayClose').addEventListener('click', () => {
    replay.active = false;
    replay.crop = null;
    cancelAnimationFrame(replay.raf);
    v.pause();
    v.playbackRate = 1;
    v.style.visibility = '';
    $('replayBar').classList.add('hidden');
    const canvas = $('overlay');
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  });
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
wireReplayBar();
renderHistory();
if (IS_MOBILE) {
  $('dropzone').querySelector('h2').textContent = 'Tap to choose your swing video';
}

// Installable app: registers the offline cache and, on mobile browsers that
// aren't running as an installed app yet, explains Add to Home Screen (the
// reliable path to permanent history on iOS).
try { navigator.serviceWorker?.register('./sw.js'); } catch {}
const isInstalled = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
if (IS_MOBILE && !isInstalled && localStorage.getItem('swinglab_install_hint') !== 'dismissed') {
  $('installHint').classList.remove('hidden');
}
$('installDismiss')?.addEventListener('click', () => {
  $('installHint').classList.add('hidden');
  try { localStorage.setItem('swinglab_install_hint', 'dismissed'); } catch {}
});
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
