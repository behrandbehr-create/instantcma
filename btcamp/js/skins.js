/* BTCAMP — skin engine. 25 skins inspired by the most-loved classic Winamp 2.x skins.
   Each skin is a CSS custom-property palette applied to :root. */
'use strict';

const SKINS = [
  // name, chrome hi/lo, bezel light/dark, title grad, title text, lcd bg/fg/dim/accent, accent, chrome text, button hi/lo, glow
  { name: "Base 2.91 Classic",  v: { w1:'#4a4a5e', w2:'#26262f', bl:'#7d7d94', bd:'#0d0d12', t1:'#1a2c79', t2:'#4062c9', tt:'#e0d7b8', lb:'#000000', lf:'#00e800', ld:'#0d4a0d', la:'#8cff8c', ac:'#d4b04a', tx:'#c9c9d4', b1:'#5a5a70', b2:'#33333f', sh:'#4062c966' } },
  { name: "Bitcoin Orange",     v: { w1:'#33302c', w2:'#1a1815', bl:'#5f574a', bd:'#080706', t1:'#7a3c00', t2:'#f7931a', tt:'#fff2df', lb:'#0d0800', lf:'#ffa42b', ld:'#4d3100', la:'#ffd894', ac:'#f7931a', tx:'#d9cfc2', b1:'#4a4238', b2:'#26221d', sh:'#f7931a55' } },
  { name: "Gold Bar",           v: { w1:'#8a7434', w2:'#4d3f18', bl:'#d9bf6f', bd:'#241d08', t1:'#5c4a12', t2:'#c9a227', tt:'#fff6d8', lb:'#12100a', lf:'#ffd75e', ld:'#5e4d1a', la:'#fff0b8', ac:'#ffd75e', tx:'#f0e3b8', b1:'#a08a44', b2:'#5c4c1e', sh:'#c9a22766' } },
  { name: "Matrix Code",        v: { w1:'#0d1f0d', w2:'#050c05', bl:'#1f4a1f', bd:'#010401', t1:'#052405', t2:'#0f7a0f', tt:'#aaffaa', lb:'#000600', lf:'#00ff41', ld:'#004d14', la:'#b3ffcc', ac:'#00ff41', tx:'#7acc8a', b1:'#143314', b2:'#081508', sh:'#00ff4155' } },
  { name: "Amber CRT",          v: { w1:'#2b2118', w2:'#150f0a', bl:'#54402e', bd:'#070503', t1:'#3d2405', t2:'#8a5a10', tt:'#ffdf9e', lb:'#0f0800', lf:'#ffb000', ld:'#4d3500', la:'#ffd980', ac:'#ffb000', tx:'#c9ad8a', b1:'#403225', b2:'#211a12', sh:'#ffb00044' } },
  { name: "Tron Grid",          v: { w1:'#0a1420', w2:'#040910', bl:'#1f3d5c', bd:'#010305', t1:'#04263d', t2:'#0a6e99', tt:'#c8f4ff', lb:'#00090d', lf:'#00e5ff', ld:'#00434d', la:'#b8f7ff', ac:'#00e5ff', tx:'#8ab8cc', b1:'#122a40', b2:'#081420', sh:'#00e5ff55' } },
  { name: "Vaporwave Sunset",   v: { w1:'#3d2952', w2:'#1f1230', bl:'#7a52a3', bd:'#0d0616', t1:'#521f5c', t2:'#c93d8f', tt:'#ffe3f6', lb:'#12041a', lf:'#ff71ce', ld:'#5c1f4a', la:'#01cdfe', ac:'#01cdfe', tx:'#c9a8e0', b1:'#573a75', b2:'#2d1c42', sh:'#ff71ce55' } },
  { name: "Deus Ex Nano",       v: { w1:'#26241c', w2:'#12110c', bl:'#4d4933', bd:'#050503', t1:'#1c1a08', t2:'#6b6116', tt:'#e8e0a8', lb:'#0a0a04', lf:'#c8b445', ld:'#454012', la:'#f2ecc0', ac:'#c8b445', tx:'#b3ad8a', b1:'#3b3826', b2:'#1d1b12', sh:'#c8b44544' } },
  { name: "MMD3 Silver",        v: { w1:'#b8bcc4', w2:'#7d828e', bl:'#eef0f4', bd:'#3d414a', t1:'#5c6270', t2:'#9aa1b0', tt:'#ffffff', lb:'#1a2733', lf:'#7ec8ff', ld:'#2b4a63', la:'#d5edff', ac:'#3d7dd9', tx:'#22252b', b1:'#d0d4dc', b2:'#8f94a0', sh:'#3d7dd944' } },
  { name: "Brushed Steel",      v: { w1:'#6e7278', w2:'#3d4045', bl:'#a8adb5', bd:'#1c1e21', t1:'#2b2e33', t2:'#5c6169', tt:'#e8eaed', lb:'#101214', lf:'#c8d4e0', ld:'#454c54', la:'#ffffff', ac:'#8fb8e0', tx:'#dde0e4', b1:'#83888f', b2:'#4a4e54', sh:'#8fb8e044' } },
  { name: "Carbon Fiber",       v: { w1:'#222428', w2:'#101114', bl:'#42454c', bd:'#040405', t1:'#1a0505', t2:'#7a1414', tt:'#ffd0d0', lb:'#0a0a0c', lf:'#ff3b3b', ld:'#4d1212', la:'#ffb8b8', ac:'#ff3b3b', tx:'#a8abb3', b1:'#33363c', b2:'#191b1f', sh:'#ff3b3b44' } },
  { name: "Terminal 1985",      v: { w1:'#0c0c0c', w2:'#040404', bl:'#2e2e2e', bd:'#000000', t1:'#001a00', t2:'#003b00', tt:'#33ff33', lb:'#000000', lf:'#33ff33', ld:'#0f4d0f', la:'#ccffcc', ac:'#33ff33', tx:'#33cc33', b1:'#1c1c1c', b2:'#0a0a0a', sh:'#33ff3333' } },
  { name: "Nordic Ice",         v: { w1:'#d6e4ee', w2:'#a3bcce', bl:'#f4f9fc', bd:'#5c7a8f', t1:'#31576e', t2:'#6699b8', tt:'#f4fbff', lb:'#0d1e29', lf:'#8fd4ff', ld:'#2e5266', la:'#e0f4ff', ac:'#2e7db3', tx:'#1f3542', b1:'#e8f1f7', b2:'#b0c8d8', sh:'#2e7db344' } },
  { name: "Bloodmoon",          v: { w1:'#331014', w2:'#1a070a', bl:'#662028', bd:'#080203', t1:'#3d0508', t2:'#991216', tt:'#ffd6d6', lb:'#120204', lf:'#ff2e4a', ld:'#590f1c', la:'#ff9eae', ac:'#ff2e4a', tx:'#cc8f96', b1:'#4d181e', b2:'#260b0e', sh:'#ff2e4a44' } },
  { name: "Deep Sea",           v: { w1:'#0f2233', w2:'#06111c', bl:'#24455f', bd:'#020609', t1:'#03293d', t2:'#0d5c80', tt:'#ccf0ff', lb:'#020d12', lf:'#2ee6c8', ld:'#0d4a40', la:'#b8fff0', ac:'#2ee6c8', tx:'#8fb3c4', b1:'#1a3549', b2:'#0b1b28', sh:'#2ee6c844' } },
  { name: "Toxic Waste",        v: { w1:'#20260f', w2:'#0f1306', bl:'#414d20', bd:'#040502', t1:'#1c2903', t2:'#4d7305', tt:'#e8ffb3', lb:'#090c02', lf:'#aaff00', ld:'#3d5c00', la:'#e0ffa3', ac:'#aaff00', tx:'#a8bd7a', b1:'#333d1a', b2:'#181f0b', sh:'#aaff0044' } },
  { name: "Bubblegum Pop",      v: { w1:'#f2b8d0', w2:'#d17ba3', bl:'#ffe0ec', bd:'#8f3d63', t1:'#a32e6b', t2:'#e668a8', tt:'#fff0f7', lb:'#2b0d1c', lf:'#ff7ec2', ld:'#7a2e56', la:'#ffe0f0', ac:'#e6288f', tx:'#4d1230', b1:'#facce0', b2:'#dd94b8', sh:'#e6288f44' } },
  { name: "Midnight Violet",    v: { w1:'#241a3d', w2:'#120c21', bl:'#4a3878', bd:'#060310', t1:'#1f0d47', t2:'#5c2ea3', tt:'#e5d6ff', lb:'#0c0616', lf:'#b388ff', ld:'#3d2966', la:'#e8dcff', ac:'#b388ff', tx:'#a394c9', b1:'#382a59', b2:'#1c1430', sh:'#b388ff44' } },
  { name: "Sakura Drift",       v: { w1:'#f4e6e8', w2:'#d9b8be', bl:'#fdf6f7', bd:'#96636b', t1:'#8f4a56', t2:'#cc8593', tt:'#fff5f7', lb:'#241318', lf:'#ff9eb8', ld:'#663a48', la:'#ffe0e8', ac:'#d4506e', tx:'#42272e', b1:'#f7ebec', b2:'#dcc2c7', sh:'#d4506e44' } },
  { name: "Hacker Den",         v: { w1:'#16211c', w2:'#0a100d', bl:'#2e4438', bd:'#030504', t1:'#041a0d', t2:'#0e5c2b', tt:'#b3ffd1', lb:'#020806', lf:'#20e070', ld:'#0b4d28', la:'#ffb000', ac:'#ffb000', tx:'#7db394', b1:'#22332b', b2:'#101914', sh:'#20e07044' } },
  { name: "Royal Court",        v: { w1:'#2e1f47', w2:'#180f28', bl:'#59407d', bd:'#080414', t1:'#33094d', t2:'#6e1f8f', tt:'#ffe9b3', lb:'#100a1c', lf:'#e8c04a', ld:'#4d3d14', la:'#fff0c0', ac:'#e8c04a', tx:'#b8a3d1', b1:'#443063', b2:'#241736', sh:'#e8c04a44' } },
  { name: "Desert Chrome",      v: { w1:'#b39064', w2:'#7d5f3a', bl:'#e0c396', bd:'#3d2d18', t1:'#5c3a14', t2:'#a3702b', tt:'#fff0d6', lb:'#1c1206', lf:'#ffb347', ld:'#5c3d14', la:'#ffe0b3', ac:'#e07b14', tx:'#332412', b1:'#c9a878', b2:'#8f6e45', sh:'#e07b1444' } },
  { name: "Aqua Y2K",           v: { w1:'#bfe3ef', w2:'#7fb8cc', bl:'#e8f7fc', bd:'#3d7a94', t1:'#1470a3', t2:'#4db8e8', tt:'#ffffff', lb:'#08222e', lf:'#4de8ff', ld:'#14566b', la:'#d6f9ff', ac:'#0e94cc', tx:'#123540', b1:'#d9f0f8', b2:'#94c9db', sh:'#0e94cc44' } },
  { name: "Classified W3",      v: { w1:'#1f3338', w2:'#0f1a1d', bl:'#3d6069', bd:'#040808', t1:'#062e33', t2:'#12707d', tt:'#c8f4f7', lb:'#03110f', lf:'#4affd8', ld:'#125245', la:'#ccfff0', ac:'#4affd8', tx:'#8fb3b8', b1:'#2c4850', b2:'#152428', sh:'#4affd844' } },
  { name: "Higgsfield Ultra",   v: { w1:'#2a2622', w2:'#141210', bl:'#59504a', bd:'#060505', t1:'#1f1206', t2:'#8f4a0a', tt:'#ffe8cc', lb:'#0d0703', lf:'#ff8c1a', ld:'#4d2c08', la:'#ffd9a8', ac:'#ff8c1a', tx:'#cfc0b0', b1:'#403830', b2:'#201c18', sh:'#ff8c1a55',
      tex: 'https://d8j0ntlcm91z4.cloudfront.net/user_3G9FnmnAtJVrnrQzzqiZ1NoYfPk/hf_20260717_042809_1bb4c592-7c21-4f16-bd38-19906c42077c.png' } },
];

const Skin = {
  idx: 0,
  apply(i) {
    this.idx = ((i % SKINS.length) + SKINS.length) % SKINS.length;
    const s = SKINS[this.idx], r = document.documentElement.style;
    for (const [k, val] of Object.entries(s.v)) if (k !== 'tex') r.setProperty('--' + k, val);
    // optional chrome texture (Higgsfield-generated art); layered under the gradient tint
    r.setProperty('--tex', s.v.tex ? `url(${s.v.tex})` : 'none');
    document.querySelectorAll('#skin-list .row').forEach((el, j) =>
      el.classList.toggle('sel', j === this.idx));
    try { localStorage.setItem('btcamp_skin', this.idx); } catch (e) {}
    return s.name;
  },
  next() { return this.apply(this.idx + 1); },
  prev() { return this.apply(this.idx - 1); },
};
