// SwingLab — ATP coaching model
// Scores measured biomechanics against pro reference ranges and produces a
// prioritized coaching report: findings, 5 focus areas, top 3, drills.

// Each dimension: id, label, what we measure, ATP reference band, scorer.
// score() returns 0–100 (100 = pro-level), given the session aggregate.
export const DIMENSIONS = [
  {
    id: 'coil',
    label: 'Shoulder Coil & X-Factor',
    unit: '°',
    value: a => a.xFactorMax,
    ref: 'ATP: 15–30° hip–shoulder separation at the start of the forward swing',
    score(a) {
      const v = a.xFactorMax;
      if (v === null) return null;
      if (v >= 18) return Math.min(100, 80 + (v - 18) * 2);
      return Math.max(5, (v / 18) * 80);
    },
    finding: (a, s) => s < 60
      ? `Your hips and shoulders are turning together as one block — median separation of ${fmt(a.xFactorMax)}° vs the 15–30° an ATP player stores. That stretch across the torso is the rubber band that whips the racquet through; without it, the arm has to make all the speed itself.`
      : `Solid torso coil: ${fmt(a.xFactorMax)}° of hip–shoulder separation is inside the pro band. Keep loading against the hip, not just turning the arm back.`,
  },
  {
    id: 'chain',
    label: 'Kinetic Chain Sequencing',
    unit: 'ms',
    value: a => a.hipLead !== null ? a.hipLead * 1000 : null,
    ref: 'ATP: hips fire 30–100 ms before shoulders, ground-up sequence on 90%+ of swings',
    score(a) {
      if (a.hipLead === null) return null;
      const ms = a.hipLead * 1000;
      let s;
      if (ms >= 25 && ms <= 120) s = 90;
      else if (ms > 0) s = 55 + ms;         // fired first but barely
      else s = Math.max(5, 45 + ms);        // shoulders/arm led — the classic arm swing
      if (a.chainOrderedFrac !== null) s = s * (0.5 + 0.5 * a.chainOrderedFrac);
      return Math.max(0, Math.min(100, s));
    },
    finding: (a, s) => s < 60
      ? `The sequence is running top-down: your arm accelerates before (or with) your hips instead of after them. Hip lead measured at ${a.hipLead === null ? 'n/a' : fmt(a.hipLead * 1000)} ms (pros: +30 to +100 ms), with a clean ground-up order on ${pct(a.chainOrderedFrac)} of swings. This is the signature of "all arm, no body."`
      : `Ground-up sequencing is working: hips lead the shoulders by ${fmt(a.hipLead * 1000)} ms and the chain runs in order on ${pct(a.chainOrderedFrac)} of swings.`,
  },
  {
    id: 'legs',
    label: 'Leg Drive & Knee Load',
    unit: '°',
    value: a => a.kneeMin,
    ref: 'ATP: back knee loads to 120–140° at the bottom of the preparation',
    score(a) {
      const v = a.kneeMin;
      if (v === null) return null;
      if (v <= 140) return Math.min(100, 85 + (140 - v));
      if (v >= 172) return 10;
      return Math.max(10, 85 - (v - 140) * 2.3);
    },
    finding: (a, s) => s < 60
      ? `Back knee only flexes to ${fmt(a.kneeMin)}° (pros load to 120–140°). Straight legs are why the swing feels stiff — there is no spring being compressed, so there is nothing to release up into the shot.`
      : `Good ground force: back knee loading to ${fmt(a.kneeMin)}° gives you a real platform to push from.`,
  },
  {
    id: 'transfer',
    label: 'Weight Transfer',
    unit: 'torso-lengths',
    value: a => a.weightTransfer,
    ref: 'ATP: hips travel ≥ 0.25 torso-lengths into the shot before contact',
    score(a) {
      const v = a.weightTransfer;
      if (v === null) return null;
      return Math.max(5, Math.min(100, (v / 0.25) * 85));
    },
    finding: (a, s) => s < 60
      ? `Your center of mass moves only ${fmt(a.weightTransfer, 2)} torso-lengths into the shot (pros ≥ 0.25). You're rotating in place rather than moving through the ball — linear momentum is free pace you're leaving on the table.`
      : `You're moving through contact well — ${fmt(a.weightTransfer, 2)} torso-lengths of drive into the shot.`,
  },
  {
    id: 'contact',
    label: 'Contact Point & Extension',
    unit: '°',
    value: a => a.elbowAtContact,
    ref: 'ATP: elbow at 120–155° at contact — struck out in front, arm extending',
    score(a) {
      const v = a.elbowAtContact;
      if (v === null) return null;
      if (v >= 120 && v <= 160) return 90;
      if (v < 120) return Math.max(10, 90 - (120 - v) * 2);
      return Math.max(40, 90 - (v - 160) * 3);
    },
    finding: (a, s) => s < 60
      ? `Elbow angle at contact is ${fmt(a.elbowAtContact)}° — a cramped, bent-arm strike close to the body (pros: 120–155°, meeting the ball out in front). Late, jammed contact forces the arm to muscle the ball.`
      : `Contact structure is healthy: ${fmt(a.elbowAtContact)}° of elbow extension means you're meeting the ball out in front with leverage.`,
  },
  {
    id: 'finish',
    label: 'Extension & Follow-Through',
    unit: 's',
    value: a => a.followThrough,
    ref: 'ATP: racquet stays above 30% of peak speed for 0.25–0.45 s past contact',
    score(a) {
      const v = a.followThrough;
      if (v === null) return null;
      if (v >= 0.24) return Math.min(100, 85 + (v - 0.24) * 60);
      return Math.max(10, (v / 0.24) * 85);
    },
    finding: (a, s) => s < 60
      ? `Follow-through decays in ${fmt(a.followThrough, 2)} s (pros 0.25–0.45 s). A short finish means you're decelerating before contact — the body braking instead of releasing through the ball.`
      : `Full release: ${fmt(a.followThrough, 2)} s of follow-through shows you're swinging through the ball, not at it.`,
  },
  {
    id: 'racquetspeed',
    label: 'Racquet-Hand Speed',
    unit: 'TL/s',
    value: a => a.peakSpeed,
    ref: 'ATP forehand: wrist peaks ≈ 9–14 torso-lengths/second',
    score(a) {
      const v = a.peakSpeed;
      if (v === null) return null;
      return Math.max(5, Math.min(100, (v / 9) * 85));
    },
    finding: (a, s) => s < 60
      ? `Peak hand speed of ${fmt(a.peakSpeed, 1)} torso-lengths/s is below the 9–14 pros generate — the expected result of the chain issues above, not a strength problem. Fix the sequence and this number rises on its own.`
      : `Hand speed of ${fmt(a.peakSpeed, 1)} torso-lengths/s is in a strong range.`,
  },
];

// Drill library, mapped to dimension ids, ATP-coach style.
export const DRILLS = {
  coil: [
    { name: 'Back-to-the-net shadow swings', how: 'Set up sideways, turn until your back shoulder blade faces the net and your chin touches your front shoulder. Hold 2 s, feel the stretch across your obliques, then swing. 3×10 daily.', why: 'Trains the separation between hip turn and shoulder turn that stores elastic energy.' },
    { name: 'Medicine-ball rotational throw', how: 'With a 2–4 kg ball, load into your back hip, coil shoulders past hips, and throw against a wall from your forehand stance. 3×8 per side.', why: 'The ball is too heavy to arm — it forces the torso to do the work, exactly the pattern your forehand needs.' },
  ],
  chain: [
    { name: 'Step-and-hit progression', how: 'Drop-feed balls. Freeze in your loaded position, then deliberately fire: push the back hip forward FIRST, let the shoulders get pulled around, and let the arm come last — like cracking a whip. 20 balls, exaggerated, before every session.', why: 'Rewires the firing order from arm-first to ground-up. Exaggeration is the fastest way to move a motor pattern.' },
    { name: 'Hip-lead freeze drill', how: 'Shadow swing in slow motion: rotate hips 45° while keeping shoulders fully coiled, freeze, check in a mirror, then release the upper body. 3×10.', why: 'Isolates the hip-before-shoulder moment your data shows is missing.' },
  ],
  legs: [
    { name: 'Sit-and-lift forehands', how: 'Before each drop-feed, bend the back knee until your thigh burns slightly (think "sitting into a bar stool"), then drive up and through as you swing. 25 balls.', why: 'Converts the legs from posts into springs — the stiffness you feel is straight knees.' },
    { name: 'Split-step + load ladder', how: 'Split step, first step to the ball, and land in a loaded back knee at 120–140°. Have a partner call sides randomly. 2×10 each side.', why: 'Makes the loaded position automatic under movement, not just from a standing feed.' },
  ],
  transfer: [
    { name: 'Fence-lean drive drill', how: 'Stand one racquet-length from the back fence, swing and let your momentum carry you a full step toward the net on every finish. If you end where you started, the rep doesn\'t count.', why: 'Forces linear weight transfer through contact instead of spinning in place.' },
  ],
  contact: [
    { name: 'Contact-point freeze frames', how: 'Drop-feed, swing, and freeze your finish. Check: did you meet the ball a full arm-and-racquet reach in front of your front hip? Film 10 reps and check each one in SwingLab.', why: 'Moves contact from beside the body (arm-only territory) to out front where body rotation can transfer into the ball.' },
  ],
  finish: [
    { name: 'Catch-the-racquet finish', how: 'Every swing finishes with the racquet over the opposite shoulder and your free hand catching the throat. Hold for a full second. No catch, no rep.', why: 'A complete finish is the proof the body released through the ball instead of braking early.' },
  ],
  racquetspeed: [
    { name: 'Overspeed shadow sets', how: 'With just the racquet (or a lighter one), 3×10 maximal-intent shadow forehands focusing on the whip feeling — loose arm, fast hip.', why: 'Once sequencing improves, overspeed work teaches the nervous system to use the new pattern at full velocity.' },
  ],
};

function fmt(v, d = 0) { return v === null || v === undefined ? '—' : (+v).toFixed(d); }
function pct(v) { return v === null || v === undefined ? '—' : Math.round(v * 100) + '%'; }

// Produce the full report from a session aggregate.
export function buildReport(agg) {
  const scored = DIMENSIONS.map(d => {
    const score = d.score(agg);
    return {
      id: d.id, label: d.label, unit: d.unit, ref: d.ref,
      value: d.value(agg),
      score,
      finding: score === null ? null : d.finding(agg, score),
      drills: DRILLS[d.id] || [],
    };
  }).filter(d => d.score !== null);

  // Weakest → strongest
  const ranked = [...scored].sort((a, b) => a.score - b.score);
  const focusFive = ranked.slice(0, 5);
  const topThree = ranked.slice(0, 3);
  const overall = scored.length
    ? Math.round(scored.reduce((s, d) => s + d.score, 0) / scored.length)
    : null;

  return { scored, ranked, focusFive, topThree, overall, agg };
}

// Map the top findings onto the 30-day championship plan phases.
export function planIntegration(report) {
  const ids = report.topThree.map(d => d.id);
  const rows = [];
  if (ids.includes('legs') || ids.includes('coil'))
    rows.push({ phase: 'Days 1–10 · Foundation block', action: 'Replace generic rally warm-ups with the loading drills (sit-and-lift, back-to-the-net shadows) — 15 min before every hit.' });
  if (ids.includes('chain') || ids.includes('transfer'))
    rows.push({ phase: 'Days 11–20 · Build block', action: 'Dedicate two sessions/week to sequencing: step-and-hit progression + medicine-ball throws, filmed and re-run through SwingLab to verify hip-lead is trending positive.' });
  if (ids.includes('contact') || ids.includes('finish') || ids.includes('racquetspeed'))
    rows.push({ phase: 'Days 21–30 · Sharpen block', action: 'Live-ball integration: contact-point freezes and catch-the-racquet finishes during point play, plus one SwingLab re-test at day 27 as the pre-championship baseline check.' });
  rows.push({ phase: 'Every session', action: 'Film from the same angle as today\'s baseline so week-over-week numbers are comparable.' });
  return rows;
}
