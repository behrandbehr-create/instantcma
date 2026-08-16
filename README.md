# SwingLab — ATP Biomechanics Coach

Browser-based tennis swing analyzer. Drop in a SwingVision video export and get
an ATP-coach-style biomechanics breakdown: 33-point body tracking, kinetic-chain
timing, X-factor (hip–shoulder separation), knee load, weight transfer, contact
extension — scored against pro reference bands, with a ranked list of 5 focus
areas, the 3 most important fixes, prescribed drills, and integration with the
30-day championship prep plan.

## How it works

- **Pose tracking**: Google MediaPipe Pose Landmarker (full model), vendored in
  `vendor/` so the app is fully self-contained — no CDN, no uploads. The video
  is analyzed entirely in the user's browser.
- **Frame processing**: deterministic seek-stepping at 30 fps so every frame is
  analyzed regardless of device speed.
- **Biomechanics** (`js/metrics.js`): per-frame joint angles and segment
  rotations from world landmarks; swing detection from racquet-hand speed peaks;
  per-swing measurement of coil, sequencing (hip-lead ms), knee load, weight
  transfer (image-space hip travel), contact-point extension, follow-through.
- **Coaching model** (`js/coach.js`): scores each dimension 0–100 against ATP
  reference bands, ranks deficits, prescribes matched drills.
- **AI coach letter** (`/api/analyze-swing`): optional Vercel function that
  turns the measured numbers into a personalized coaching letter via the
  Anthropic API (`ANTHROPIC_API_KEY` env var). The UI falls back to a built-in
  summary when the API isn't configured.

## Usage

1. In SwingVision: open your match → Share → **Save Video** (or export a
   highlight clip). Side or back view with the full body in frame works best.
2. Open `/swinglab` on the deployed site, pick your handedness, drop the file.
3. Read the report; click swing chips to replay any swing in slow motion with
   the skeleton overlay. Print/Save as PDF for the coach binder.
4. Re-film weekly from the same camera angle and compare scores.
