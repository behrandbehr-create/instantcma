# ⚡ BTCAMP — It Really Whips the Blockchain's Ass

A classic-Winamp-style desktop player, rebuilt for the Bitcoin network. Every part of the
audio player is renamed and remapped to live chain data: the "song" is the blockchain, the
EQ shapes which network inputs drive the visuals, and the playlist is the chain tip.

**Open it:** serve the repo and visit `/btcamp/` (e.g. `npx serve` or the Vercel deploy).
100% static — no build step, no server code, no API keys.

## The windows

| Window | Audio-player role | Bitcoin mapping |
|---|---|---|
| **Main deck** | player | Big LCD (click to cycle): price / block height / sats-per-$ / mempool txs. kbps→sat/vB, kHz→tx/s, seek bar→time since last block vs 10-min target, marquee→live network ticker |
| **Network EQ** | 10-band equalizer | Each band is one data input: TX · VALUE · FEES · MEMPL · BLOCKS · PRICE · VOLUME · HASH · DIFF · LN. Slider = gain into the visuals, **click a band label to toggle that input off**. PREAMP = master |
| **Block Chain** | playlist | Last 30 blocks as tracks (miner, txs, size, fees; "duration" = time to mine). Double-click / INSPECT opens the block on mempool.space |
| **Network Visualizer** | vis plugin | The main event — see below |
| **Skin Browser** | skins | 30 palettes inspired by the classic-era favorites, plus **Skin Lab** — HUE/SAT/LUM sliders that forge a 31st custom skin live (⏏ button, `S`) |
| **Trade Tape** | — | aggr.trade-style live tape: every trade with buy/sell coloring and size-scaled bars, whales in big type, block separators, trades/min + buy% header (`TAPE` button, `T`) |
| **Data Feeds** | options | Live-wire toggles per feed with status LEDs + msg/s meters (`O` clutterbar, `D`) |

## Visualizations (23 modes, keys 1–9,0,←→)

Spectrum Classic · Oscilloscope · Matrix Rain · TX Fountain · Mempool Sea · Block City ·
Warp Tunnel · Radial Pulse · Plasma Fire · Flow Field · Price Ribbon · Whale Sonar ·
**Pressure Wind** · **Julia Drift** · **Mandel Deep** · Halving Spiral · **AVS
Superscope** · **Geiss Terrain** · **G-Force Waves** · **Beat Cube** · **Bar Galaxy 3D**
· **Tunnel Scope** · **MilkDrop Warp**.

**MilkDrop Warp** uses the genuine MilkDrop technique: the previous frame feeds back
through a WebGL per-pixel warp shader (zoom, rotation, and a sinusoidal displacement
field bent by the bass), decays with a slow color drift, and fresh waveform ink is
stamped on top each frame — TRAILS controls the echo length, DENSITY the warp amount.

The last six are homages to the classic plugin canon — AVS superscopes, Geiss plasma
mountains, G-Force layered waves, demo-scene wireframe cubes, WhiteCap-style 3D bar
rings, and Tripex waveform tunnels — all rebuilt natively and driven by the live signal.

**Data source selector** (`SRC` LCD in the deck, or `X`): choose what drives the visuals —
**FUSION** (default: every feed blended, so market trades keep it moving between blocks) ·
MARKET · PRICE · VOLUME · CHAIN · MEMPOOL.

**Julia Drift / Mandel Deep** are GPU fractals (WebGL shader, smooth log-log escape-time
coloring, CPU fallback): the Julia constant orbits the cardioid bent by network bass, a
spectrum halo rings the set; Mandel Deep breathes into famous loci (seahorse valley and
friends) at up to 22,000× — every found block warps it to a new locus. Mode switches
**crossfade smoothly** instead of hard-cutting.

**Pressure Wind** is the full BTC://SIGNAL experience folded in: a momentum particle wind
(green blows up, red blows down), a spark burst for every trade on the tape, whale
shockwave rings with a live whale tape (≥ 2 BTC), a rolling price oscilloscope with
session high/low, a 10-second buy/sell pressure bar, and an order-size spectrum
(small orders left → whales right) with classic falling peak caps.

Eight labeled sliders shape every mode: **SPEED · TRAILS · GLOW · HUE · DENSITY · SENS · SYMMETRY ·
ZOOM** (drag or scroll, double-click to reset). `PAL`/`C` cycles five color engines that
retint every mode — **SKIN / RAINBOW / FIRE / ICE / MONO**. `AUTO` cycles modes, `RND`
randomizes the dials, `CRT` adds a scanline/vignette overlay, `FULL`/`F`/double-click for
fullscreen.
Round-number price crossings ($1,000 lines) and 10+ BTC whale trades flash a toast over
the visualizer and take over the marquee.

The "audio" signal is synthesized from the network: every unconfirmed tx strikes a
spectrum bin by value (whales hit the bass), fee pressure shapes the mids, price trades
chatter in the treble, hashrate swells the sub-bass, difficulty ticks a metronome that
accelerates toward retarget, and a found block drops the bass and flashes every mode.

## Live data (all client-side, behind the scenes)

- `wss://mempool.space/api/v1/ws` — mempool depth, fee estimates, projected blocks, new blocks, difficulty adjustment
- `wss://ws.blockchain.info/inv` — every unconfirmed transaction as it propagates
- `wss://ws-feed.exchange.coinbase.com` — every BTC-USD trade with taker side (`matches`) plus 24h volume (`ticker`); drives price, momentum wind, buy/sell pressure, order-size spectrum and the whale tape
- REST (60s): mempool.space hashrate/difficulty/lightning stats + Coinbase spot fallback

Each wire has its own toggle in **Data Feeds**; the simulator auto-engages only if every
live wire is down (badge switches from `LIVE ●` to `SIM ◌`).

## Higgsfield art

The *Higgsfield Ultra* skin chrome texture and the nebula backdrop behind Warp Tunnel /
Radial Pulse / Halving Spiral were generated with the Higgsfield connector (nano banana 2)
and load from the Higgsfield CDN; everything degrades gracefully if they're unreachable.

## Presets

The strip under the deck stores four complete looks — mode, all eight dials, palette,
data source, and skin. Click **SAVE** then a slot to store; click a slot to load.

## Sound (aggr.trade-style)

`SND` button (or `M`) arms the network audio engine (WebAudio, off by default): every
trade blips — buys ring a fifth above sells, size drags the pitch down and the volume up;
whales gong; a found block booms; round-number crossings chime. A compressor keeps
frenzies from clipping. All knobs, sliders, and dials also respond to the scroll wheel,
and drags are pointer-captured — no text selection, works on touch.

## Mobile

Phones get a dedicated shell (auto-detected): the visualizer fills the screen with a
price/status ticker on top and a touch deck below — **swipe left/right on the visuals to
change modes**, and SRC / COLOR / SOUND / SKIN buttons plus a pull-up **DIALS** sheet
with slider versions of all eight dials. Desktop keeps the full windowed rig.

## Keys

`1–9,0` vis modes · `←→` prev/next mode · `F` fullscreen · `X` data source · `C` colors ·
`M` sound · `T` trade tape · `Space` freeze · `A` auto-cycle · `R` randomize dials ·
`S` skins · `E` EQ · `P` playlist · `V` visualizer · `D` data feeds
