// SwingLab — Ghost Coach
// Synthesizes an ATP-pattern forehand as a stick-figure motion, scaled to the
// player's own segment lengths and time-synced to their measured swing, for
// hologram-style overlay on the footage. The motion is generated from the same
// reference model that scores the player, so the ghost is literally "what the
// grader wants to see".

import { LM } from './metrics.js';

function med(vals) {
  const v = vals.filter(x => x !== null && isFinite(x)).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
}
function d3(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

// Median body segment lengths (meters-ish, MediaPipe world space) from frames.
export function measureSegments(frames) {
  const torso = [], upper = [], fore = [], thigh = [], shin = [];
  for (const f of frames) {
    const w = f.world;
    if (!w) continue;
    const sc = { x: (w[LM.L_SHOULDER].x + w[LM.R_SHOULDER].x) / 2, y: (w[LM.L_SHOULDER].y + w[LM.R_SHOULDER].y) / 2, z: (w[LM.L_SHOULDER].z + w[LM.R_SHOULDER].z) / 2 };
    const hc = { x: (w[LM.L_HIP].x + w[LM.R_HIP].x) / 2, y: (w[LM.L_HIP].y + w[LM.R_HIP].y) / 2, z: (w[LM.L_HIP].z + w[LM.R_HIP].z) / 2 };
    torso.push(d3(sc, hc));
    upper.push(d3(w[LM.R_SHOULDER], w[LM.R_ELBOW]));
    fore.push(d3(w[LM.R_ELBOW], w[LM.R_WRIST]));
    thigh.push(d3(w[LM.R_HIP], w[LM.R_KNEE]));
    shin.push(d3(w[LM.R_KNEE], w[LM.R_ANKLE]));
  }
  return {
    torso: med(torso) || 0.5,
    upper: med(upper) || 0.28,
    fore: med(fore) || 0.26,
    thigh: med(thigh) || 0.42,
    shin: med(shin) || 0.4,
  };
}

function smoothstep(t, t0, t1) {
  if (t <= t0) return 0;
  if (t >= t1) return 1;
  const u = (t - t0) / (t1 - t0);
  return u * u * (3 - 2 * u);
}
function lerp(a, b, t) { return a + (b - a) * t; }

// Two-bone IK in the sagittal plane: given root and target, limb lengths
// l1/l2, return the middle joint. bendSign picks which side the joint bows.
function ik(root, target, l1, l2, bendSign) {
  let dx = target.x - root.x, dy = target.y - root.y;
  let d = Math.hypot(dx, dy);
  const maxD = (l1 + l2) * 0.999, minD = Math.abs(l1 - l2) * 1.001;
  if (d > maxD) { dx *= maxD / d; dy *= maxD / d; d = maxD; }
  if (d < minD) { const s = minD / (d || 1e-6); dx *= s; dy *= s; d = minD; }
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const px = root.x + (a / d) * dx, py = root.y + (a / d) * dy;
  return { x: px - bendSign * (h / d) * dy, y: py + bendSign * (h / d) * dx };
}

export const GHOST_CONTACT_PHASE = 0.7;

// The ideal forehand, phase p ∈ [0,1], contact at p=0.7.
// Coordinates: x = toward the net (positive), y = DOWN (MediaPipe convention),
// origin at the standing pelvis. Returned joints are named 2D points.
export function ghostPoseAt(p, segs) {
  const T = segs.torso, UP = segs.upper, FA = segs.fore, TH = segs.thigh, SH = segs.shin;
  const legL = TH + SH;

  const coil = smoothstep(p, 0.02, 0.42);          // unit turn + load
  const drive = smoothstep(p, 0.45, 0.68);          // hips fire
  const strike = smoothstep(p, 0.53, GHOST_CONTACT_PHASE); // arm releases last
  const follow = smoothstep(p, GHOST_CONTACT_PHASE, 0.96);

  // Pelvis: sinks with knee load, drives forward and up through contact
  const sink = 0.16 * T * coil * (1 - 0.85 * drive);
  const fwd = T * (0.32 * drive + 0.10 * follow) - 0.06 * T * coil;
  const pelvis = { x: fwd, y: sink };

  // Feet planted: back foot behind, front foot steps toward the net
  const stance = 0.95 * T;
  const groundY = legL * 0.96;
  const backFoot = { x: -stance * 0.55, y: groundY };
  const frontFoot = { x: stance * 0.55 + 0.25 * T * drive, y: groundY };
  const hipBack = { x: pelvis.x - 0.07 * T, y: pelvis.y + 0.02 * T };
  const hipFront = { x: pelvis.x + 0.07 * T, y: pelvis.y + 0.02 * T };
  const kneeBack = ik(hipBack, backFoot, TH, SH, 1);   // knee bows forward
  const kneeFront = ik(hipFront, frontFoot, TH, SH, 1);

  // Spine: slight crouch in coil, tall and tilted into the shot at contact
  const spineLean = 0.10 * T * drive - 0.05 * T * coil;
  const neck = { x: pelvis.x + spineLean, y: pelvis.y - T };
  const head = { x: neck.x + 0.02 * T, y: neck.y - 0.32 * T };

  // Hitting-arm wrist path: back and low in coil → lag → contact well out
  // front at waist-chest height → wrap finish over the opposite shoulder.
  const reach = UP + FA;
  const wristCoil = { x: pelvis.x - 0.95 * reach, y: pelvis.y - 0.15 * T };
  const wristLag = { x: pelvis.x - 0.55 * reach, y: pelvis.y + 0.10 * T };
  const wristContact = { x: pelvis.x + 0.80 * reach, y: pelvis.y - 0.45 * T };
  const wristFinish = { x: pelvis.x + 0.15 * reach, y: pelvis.y - 1.25 * T };
  let wrist;
  if (strike === 0) {
    wrist = { x: lerp(0.4 * reach, wristCoil.x, coil), y: lerp(-0.3 * T, wristCoil.y, coil) };
  } else if (strike < 0.45) {
    const u = strike / 0.45;
    wrist = { x: lerp(wristCoil.x, wristLag.x, u), y: lerp(wristCoil.y, wristLag.y, u) };
  } else {
    const u = (strike - 0.45) / 0.55;
    wrist = { x: lerp(wristLag.x, wristContact.x, u), y: lerp(wristLag.y, wristContact.y, u) };
  }
  if (follow > 0) {
    wrist = { x: lerp(wristContact.x, wristFinish.x, follow), y: lerp(wristContact.y, wristFinish.y, follow) };
  }
  const shoulderHit = { x: neck.x + 0.05 * T - 0.10 * T * coil, y: neck.y + 0.12 * T };
  const elbowHit = ik(shoulderHit, wrist, UP, FA, follow > 0.1 ? 1 : -1);

  // Off arm: stretches across during the coil (counter-balance), tucks after
  const offW = {
    x: lerp(pelvis.x + 0.55 * reach * coil + 0.15 * reach, pelvis.x - 0.15 * reach, Math.max(drive, follow)),
    y: neck.y + lerp(0.15 * T, 0.35 * T, Math.max(drive, follow)),
  };
  const shoulderOff = { x: neck.x - 0.05 * T, y: neck.y + 0.12 * T };
  const elbowOff = ik(shoulderOff, offW, UP, FA, 1);

  return {
    pelvis, neck, head,
    hipBack, hipFront, kneeBack, kneeFront, ankleBack: backFoot, ankleFront: frontFoot,
    shoulderHit, elbowHit, wrist,
    shoulderOff, elbowOff, wristOff: offW,
  };
}

// Bones to stroke, in draw order (rear limbs first)
export const GHOST_BONES = [
  ['hipBack', 'kneeBack'], ['kneeBack', 'ankleBack'],
  ['shoulderOff', 'elbowOff'], ['elbowOff', 'wristOff'],
  ['pelvis', 'neck'], ['neck', 'head'],
  ['hipFront', 'kneeFront'], ['kneeFront', 'ankleFront'],
  ['hipBack', 'hipFront'], ['shoulderHit', 'shoulderOff'],
  ['shoulderHit', 'elbowHit'], ['elbowHit', 'wrist'],
];

// Deviation callouts for one measured swing, each active in a phase window.
// Anchored to a ghost joint so the label points at the body part to fix.
export function buildCallouts(measure) {
  const out = [];
  if (measure.kneeMin !== null && measure.kneeMin > 150) {
    out.push({ from: 0.06, to: 0.45, joint: 'kneeBack', text: 'Bend the back knee — load the spring' });
  }
  if (measure.xFactorMax !== null && measure.xFactorMax < 15) {
    out.push({ from: 0.10, to: 0.5, joint: 'shoulderHit', text: 'Turn shoulders past hips — coil' });
  }
  if (measure.hipLead === null || measure.hipLead * 1000 < 15) {
    out.push({ from: 0.45, to: 0.66, joint: 'hipFront', text: 'Hips fire FIRST — arm comes last' });
  }
  if (measure.weightTransfer !== null && measure.weightTransfer < 0.15) {
    out.push({ from: 0.5, to: 0.72, joint: 'pelvis', text: 'Drive forward through the ball' });
  }
  if (measure.elbowAtContact !== null && measure.elbowAtContact < 115) {
    out.push({ from: 0.6, to: 0.78, joint: 'wrist', text: 'Reach — meet it out in front' });
  }
  if (measure.followThrough !== null && measure.followThrough < 0.2) {
    out.push({ from: 0.72, to: 0.95, joint: 'wrist', text: 'Finish over the shoulder' });
  }
  return out;
}
