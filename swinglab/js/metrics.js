// SwingLab — biomechanics engine
// Consumes MediaPipe Pose world landmarks per frame, produces per-frame
// kinematic series, detected swings, and per-swing biomechanical measurements.

// MediaPipe Pose landmark indices
export const LM = {
  NOSE: 0,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
};

const RAD2DEG = 180 / Math.PI;

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }; }
function norm(v) { return Math.hypot(v.x, v.y, v.z); }
function dist(a, b) { return norm(sub(a, b)); }

// Interior angle at joint b (degrees), 3D
export function jointAngle(a, b, c) {
  const u = sub(a, b), v = sub(c, b);
  const nu = norm(u), nv = norm(v);
  if (nu < 1e-6 || nv < 1e-6) return null;
  const cos = (u.x * v.x + u.y * v.y + u.z * v.z) / (nu * nv);
  return Math.acos(Math.min(1, Math.max(-1, cos))) * RAD2DEG;
}

// Rotation of a body segment (shoulder or hip line) in the horizontal plane.
// World coords: x = lateral, y = vertical, z = toward/away from camera.
function lineRotation(left, right) {
  const v = sub(right, left);
  return Math.atan2(v.z, v.x) * RAD2DEG;
}

// Unwrap an angle series so it is continuous across the ±180° seam.
function unwrapSeries(values) {
  const out = [];
  let offset = 0, prev = null;
  for (const v of values) {
    if (v === null || v === undefined) { out.push(null); continue; }
    if (prev !== null) {
      let d = v + offset - prev;
      if (d > 180) offset -= 360;
      else if (d < -180) offset += 360;
    }
    const u = v + offset;
    out.push(u);
    prev = u;
  }
  return out;
}

// Moving-average smoother tolerant of nulls
function smooth(values, win = 5) {
  const half = Math.floor(win / 2);
  return values.map((_, i) => {
    let s = 0, n = 0;
    for (let j = i - half; j <= i + half; j++) {
      const v = values[j];
      if (j >= 0 && j < values.length && v !== null && v !== undefined && isFinite(v)) { s += v; n++; }
    }
    return n ? s / n : null;
  });
}

// Central-difference derivative of a (possibly gappy) series
function derivative(values, times) {
  return values.map((_, i) => {
    const i0 = Math.max(0, i - 1), i1 = Math.min(values.length - 1, i + 1);
    const v0 = values[i0], v1 = values[i1];
    const dt = times[i1] - times[i0];
    if (v0 === null || v1 === null || !dt) return null;
    return (v1 - v0) / dt;
  });
}

// Build per-frame kinematic series from raw frames.
// frames: [{t, world: [33 landmarks], image: [33 landmarks], visMin }]
// handedness: 'right' | 'left'
export function buildSeries(frames, handedness) {
  const R = handedness === 'right';
  const SH = R ? LM.R_SHOULDER : LM.L_SHOULDER;
  const EL = R ? LM.R_ELBOW : LM.L_ELBOW;
  const WR = R ? LM.R_WRIST : LM.L_WRIST;
  const KN_BACK = R ? LM.R_KNEE : LM.L_KNEE;   // loading (back) leg for a forehand
  const HP_BACK = R ? LM.R_HIP : LM.L_HIP;
  const AN_BACK = R ? LM.R_ANKLE : LM.L_ANKLE;
  const KN_FRONT = R ? LM.L_KNEE : LM.R_KNEE;
  const HP_FRONT = R ? LM.L_HIP : LM.R_HIP;
  const AN_FRONT = R ? LM.L_ANKLE : LM.R_ANKLE;

  const t = frames.map(f => f.t);
  const shoulderRotRaw = [], hipRotRaw = [], kneeBack = [], kneeFront = [], elbow = [],
    wristPos = [], hipCenter = [], shoulderCenter = [], torsoLen = [], contactHeight = [],
    spineTilt = [], visible = [];

  for (const f of frames) {
    const w = f.world;
    if (!w) {
      shoulderRotRaw.push(null); hipRotRaw.push(null); kneeBack.push(null); kneeFront.push(null);
      elbow.push(null); wristPos.push(null); hipCenter.push(null); shoulderCenter.push(null);
      torsoLen.push(null); contactHeight.push(null); spineTilt.push(null); visible.push(false);
      continue;
    }
    const ls = w[LM.L_SHOULDER], rs = w[LM.R_SHOULDER], lh = w[LM.L_HIP], rh = w[LM.R_HIP];
    const sc = mid(ls, rs), hc = mid(lh, rh);
    shoulderRotRaw.push(lineRotation(ls, rs));
    hipRotRaw.push(lineRotation(lh, rh));
    kneeBack.push(jointAngle(w[HP_BACK], w[KN_BACK], w[AN_BACK]));
    kneeFront.push(jointAngle(w[HP_FRONT], w[KN_FRONT], w[AN_FRONT]));
    elbow.push(jointAngle(w[SH], w[EL], w[WR]));
    wristPos.push(w[WR]);
    hipCenter.push(hc);
    shoulderCenter.push(sc);
    const tl = dist(sc, hc);
    torsoLen.push(tl);
    // wrist height relative to hip, normalized by torso length (y is down in MediaPipe world? y grows downward in image; world y grows down too)
    contactHeight.push(tl ? (hc.y - w[WR].y) / tl : null);
    const spine = sub(sc, hc);
    spineTilt.push(Math.atan2(Math.hypot(spine.x, spine.z), Math.abs(spine.y) || 1e-6) * RAD2DEG);
    visible.push(true);
  }

  const shoulderRot = smooth(unwrapSeries(shoulderRotRaw), 5);
  const hipRot = smooth(unwrapSeries(hipRotRaw), 5);
  const xFactor = shoulderRot.map((s, i) =>
    (s !== null && hipRot[i] !== null) ? s - hipRot[i] : null);

  // Wrist speed in torso-lengths per second (camera-scale independent)
  const wristSpeed = frames.map((_, i) => {
    const i0 = Math.max(0, i - 1), i1 = Math.min(frames.length - 1, i + 1);
    const p0 = wristPos[i0], p1 = wristPos[i1], tl = torsoLen[i];
    const dt = t[i1] - t[i0];
    if (!p0 || !p1 || !tl || !dt) return null;
    return dist(p1, p0) / dt / tl;
  });
  const wristSpeedS = smooth(wristSpeed, 5);

  // Hip-center lateral (x) position in torso lengths — weight-transfer proxy.
  // MUST use image landmarks: world landmarks are root-centered, so whole-body
  // translation (the thing weight transfer IS) cancels out of them entirely.
  const hipX = frames.map(f => {
    const im = f.image;
    if (!im) return null;
    const hcx = (im[LM.L_HIP].x + im[LM.R_HIP].x) / 2;
    const hcy = (im[LM.L_HIP].y + im[LM.R_HIP].y) / 2;
    const scx = (im[LM.L_SHOULDER].x + im[LM.R_SHOULDER].x) / 2;
    const scy = (im[LM.L_SHOULDER].y + im[LM.R_SHOULDER].y) / 2;
    const tl = Math.hypot(scx - hcx, scy - hcy);
    return tl > 1e-4 ? hcx / tl : null;
  });
  const hipXS = smooth(hipX, 7);

  return {
    t, visible,
    shoulderRot, hipRot, xFactor,
    shoulderRotVel: smooth(derivative(shoulderRot, t), 5),
    hipRotVel: smooth(derivative(hipRot, t), 5),
    elbow: smooth(elbow, 5),
    elbowVel: smooth(derivative(smooth(elbow, 5), t), 5),
    kneeBack: smooth(kneeBack, 7),
    kneeFront: smooth(kneeFront, 7),
    wristSpeed: wristSpeedS,
    hipX: hipXS,
    hipXVel: smooth(derivative(hipXS, t), 5),
    contactHeight: smooth(contactHeight, 5),
    spineTilt: smooth(spineTilt, 7),
    torsoLen,
  };
}

// Detect swings from wrist-speed peaks.
export function detectSwings(series) {
  const { t, wristSpeed } = series;
  const vals = wristSpeed.filter(v => v !== null && isFinite(v));
  if (vals.length < 20) return [];
  const sorted = [...vals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  // Threshold: well above ordinary movement, scaled to this video's dynamics
  const thr = Math.max(median * 3, p95 * 0.55, 2.5);

  const peaks = [];
  for (let i = 2; i < wristSpeed.length - 2; i++) {
    const v = wristSpeed[i];
    if (v === null || v < thr) continue;
    if (v >= (wristSpeed[i - 1] ?? -1) && v >= (wristSpeed[i + 1] ?? -1) &&
        v > (wristSpeed[i - 2] ?? -1) && v > (wristSpeed[i + 2] ?? -1)) {
      if (peaks.length && t[i] - t[peaks[peaks.length - 1]] < 0.9) {
        if (v > wristSpeed[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = i;
      } else {
        peaks.push(i);
      }
    }
  }

  return peaks.map(pi => {
    // Window: backswing starts where speed last dropped below 25% of peak, capped at 1.2s before
    const peakV = wristSpeed[pi];
    let start = pi;
    while (start > 0 && t[pi] - t[start] < 1.2 &&
           (wristSpeed[start] === null || wristSpeed[start] > peakV * 0.22)) start--;
    let end = pi;
    while (end < t.length - 1 && t[end] - t[pi] < 0.8 &&
           (wristSpeed[end] === null || wristSpeed[end] > peakV * 0.2)) end++;
    return { start, contact: pi, end, peakSpeed: peakV };
  });
}

function seriesMaxIdx(arr, from, to, absolute = false) {
  let best = -Infinity, idx = -1;
  for (let i = from; i <= to; i++) {
    const v = arr[i];
    if (v === null || !isFinite(v)) continue;
    const m = absolute ? Math.abs(v) : v;
    if (m > best) { best = m; idx = i; }
  }
  return idx;
}

function valueAt(arr, i) {
  const v = arr?.[i];
  return (v === null || v === undefined || !isFinite(v)) ? null : v;
}

// Measure one swing → biomechanical numbers
export function measureSwing(series, swing, handedness) {
  const { t } = series;
  const { start, contact, end } = swing;
  const sign = handedness === 'right' ? 1 : -1;

  // Coil: max |X-factor deviation from neutral| between start and contact.
  // Neutral = X-factor at the quietest moment near swing start.
  const xfAtStart = valueAt(series.xFactor, start);
  let maxSep = null, sepIdx = -1;
  for (let i = start; i <= contact; i++) {
    const v = valueAt(series.xFactor, i);
    if (v === null || xfAtStart === null) continue;
    const sep = Math.abs(v - xfAtStart);
    if (maxSep === null || sep > maxSep) { maxSep = sep; sepIdx = i; }
  }

  // Total shoulder turn from start to its extreme before contact
  const shAtStart = valueAt(series.shoulderRot, start);
  let shoulderTurn = null;
  for (let i = start; i <= contact; i++) {
    const v = valueAt(series.shoulderRot, i);
    if (v === null || shAtStart === null) continue;
    const turn = Math.abs(v - shAtStart);
    if (shoulderTurn === null || turn > shoulderTurn) shoulderTurn = turn;
  }

  // Knee load: minimum back-knee angle during preparation (lower = more bend)
  let kneeMin = null;
  for (let i = start; i <= contact; i++) {
    const v = valueAt(series.kneeBack, i);
    if (v !== null && (kneeMin === null || v < kneeMin)) kneeMin = v;
  }

  // Kinetic-chain sequencing: times of peak hip rotation velocity,
  // shoulder rotation velocity, elbow extension velocity, wrist speed.
  const winA = Math.max(start, contact - Math.round((contact - start) * 0.7));
  const hipPeakI = seriesMaxIdx(series.hipRotVel, winA, contact, true);
  const shPeakI = seriesMaxIdx(series.shoulderRotVel, winA, contact, true);
  const elPeakI = seriesMaxIdx(series.elbowVel, winA, Math.min(end, contact + 2), true);
  const wrPeakI = contact;
  const chain = {
    hip: hipPeakI >= 0 ? t[hipPeakI] : null,
    shoulder: shPeakI >= 0 ? t[shPeakI] : null,
    elbow: elPeakI >= 0 ? t[elPeakI] : null,
    wrist: t[wrPeakI],
  };
  let chainOrdered = null, hipLead = null;
  if (chain.hip !== null && chain.shoulder !== null) {
    hipLead = chain.shoulder - chain.hip; // >0 means hips fired first
    chainOrdered = chain.hip <= chain.shoulder + 0.017 && chain.shoulder <= chain.wrist + 0.017;
  }

  // Hip vs shoulder peak angular velocity magnitudes — body-drive ratio.
  const hipVelPeak = hipPeakI >= 0 ? Math.abs(series.hipRotVel[hipPeakI]) : null;
  const shVelPeak = shPeakI >= 0 ? Math.abs(series.shoulderRotVel[shPeakI]) : null;

  // Weight transfer: hip-center x travel from start to contact (torso lengths),
  // signed toward the swing direction.
  const hx0 = valueAt(series.hipX, start), hx1 = valueAt(series.hipX, contact);
  const weightTransfer = (hx0 !== null && hx1 !== null) ? Math.abs(hx1 - hx0) : null;

  // Contact-point measurements
  const elbowAtContact = valueAt(series.elbow, contact);
  const contactHeight = valueAt(series.contactHeight, contact);

  // Follow-through length: time from contact until speed decays below 30% of peak
  let ftEnd = contact;
  while (ftEnd < series.t.length - 1 && t[ftEnd] - t[contact] < 1.0 &&
         (series.wristSpeed[ftEnd] ?? 0) > swing.peakSpeed * 0.3) ftEnd++;
  const followThrough = t[ftEnd] - t[contact];

  void sign;
  return {
    tStart: t[start], tContact: t[contact], tEnd: t[end],
    peakSpeed: swing.peakSpeed,
    xFactorMax: maxSep, xFactorIdx: sepIdx,
    shoulderTurn,
    kneeMin,
    chain, chainOrdered, hipLead,
    hipVelPeak, shVelPeak,
    bodyDriveRatio: (hipVelPeak && shVelPeak) ? hipVelPeak / shVelPeak : null,
    weightTransfer,
    elbowAtContact, contactHeight,
    followThrough,
  };
}

// Aggregate per-swing measurements → session medians
export function aggregate(measures) {
  const med = key => {
    const vs = measures.map(m => m[key]).filter(v => v !== null && v !== undefined && isFinite(v));
    if (!vs.length) return null;
    vs.sort((a, b) => a - b);
    return vs[Math.floor(vs.length / 2)];
  };
  const frac = key => {
    const vs = measures.map(m => m[key]).filter(v => v === true || v === false);
    if (!vs.length) return null;
    return vs.filter(Boolean).length / vs.length;
  };
  return {
    swings: measures.length,
    xFactorMax: med('xFactorMax'),
    shoulderTurn: med('shoulderTurn'),
    kneeMin: med('kneeMin'),
    hipLead: med('hipLead'),
    bodyDriveRatio: med('bodyDriveRatio'),
    chainOrderedFrac: frac('chainOrdered'),
    weightTransfer: med('weightTransfer'),
    elbowAtContact: med('elbowAtContact'),
    contactHeight: med('contactHeight'),
    followThrough: med('followThrough'),
    peakSpeed: med('peakSpeed'),
  };
}
