# GymTrAIner — 3D coach code bundle
Τα αρχεία του 3D coach. Δες `docs/3d-coach-handoff.md` για το prompt.

## js/motions.js

```javascript
// Βιβλιοθήκη κινήσεων για τον 3D coach. Γωνίες σε rad, forward kinematics.
// Συμβάσεις (ο χαρακτήρας κοιτάζει +z):
//  sl/sr x : ώμος (αρνητικό = ύψωση μπροστά) · z : απαγωγή (L αρνητικό = προς τα έξω)
//  el      : αγκώνας (αρνητικό = κάμψη μπροστά)   kn : γόνατο (θετικό = κάμψη)
//  hl/hr x : ισχίο (αρνητικό = μπροστά)           tx : κλίση κορμού (θετικό = μπροστά)
//  rrx/rY/rZ : περιστροφή/θέση ολόκληρου σώματος (floor κινήσεις)
const base = { tx: 0, hd: 0, slx: 0, slz: 0, srx: 0, srz: 0, elL: 0, elR: 0, hlx: 0, hlz: 0, hrx: 0, hrz: 0, knL: 0, knR: 0, anL: 0, anR: 0, lift: 0, rrx: 0, rY: 0, rZ: 0 };
const P = o => ({ ...base, ...o });
const arms = (x, out = 0, el = 0) => ({ slx: x, srx: x, slz: -out, srz: out, elL: el, elR: el });
const legs = (x, kn = 0, out = 0) => ({ hlx: x, hrx: x, knL: kn, knR: kn, hlz: -out, hrz: out });

export function mirror(p) {
  return { ...p, slx: p.srx, srx: p.slx, slz: -p.srz, srz: -p.slz, elL: p.elR, elR: p.elL, hlx: p.hrx, hrx: p.hlx, hlz: -p.hrz, hrz: -p.hlz, knL: p.knR, knR: p.knL, anL: p.anR, anR: p.anL };
}

const pushTop = P({ rrx: 1.19, rY: 0.42, rZ: 0.14, hd: -0.5, ...arms(-1.19) });
const pushBot = P({ rrx: 1.38, rY: 0.25, rZ: 0.12, hd: -0.45, ...arms(-0.28, 0.12, -1.1) });
const lie = { rrx: -1.57, rY: 0.14, rZ: 0.1, ...legs(-0.84, 2.06) };
const lunge = P({ ...arms(-0.3, 0.1), hlx: -1.1, knL: 1.3, hrx: 0.35, knR: 0.73, anR: 0.7, tx: 0.08 });
const knee = P({ ...arms(-0.5, 0, -1.6), hlx: -1.5, knL: 1.6, srx: -1.0, slx: 0.5 });

export const MOTIONS = {
  squat:         { label: 'Καθίσματα', tempo: 3, prof: [0.5, 0.08, 0.42], yaw: 1.0, A: P({ ...arms(-0.25), ...legs(-0.05) }), B: P({ tx: 0.55, ...arms(-2.1), ...legs(-1.45, 1.9, 0.12) }) },
  lunge:         { label: 'Εκπτώσεις', tempo: 3.5, prof: [0.5, 0.06, 0.44], yaw: 1.0, alt: true, A: P(arms(-0.3, 0.1)), B: lunge },
  hinge:         { label: 'Έλξη ισχίου', tempo: 3.5, prof: [0.5, 0.08, 0.42], yaw: 1.0, A: P(arms(-0.1)), B: P({ tx: 1.15, ...arms(-1.25), ...legs(-0.55, 0.55) }) },
  row:           { label: 'Κωπηλατική', tempo: 3, prof: [0.4, 0.12, 0.48], yaw: 1.0, A: P({ tx: 1.0, ...arms(-1.0), ...legs(-0.45, 0.5) }), B: P({ tx: 1.0, ...arms(-0.35, 0, -0.9), ...legs(-0.45, 0.5) }) },
  overhead_press:{ palm: 'fwd', label: 'Πιέσεις ώμων', tempo: 3, prof: [0.45, 0.1, 0.45], yaw: 0.25, A: P(arms(-0.4, 0.35, -2.1)), B: P(arms(-3.0, 0.15, -0.05)) },
  curl:          { palm: 'up', label: 'Καμπές δικεφάλων', tempo: 3, prof: [0.4, 0.1, 0.5], yaw: 0.5, A: P(arms(-0.05, 0.05, -0.05)), B: P(arms(-0.2, 0.05, -2.5)) },
  lateral_raise: { label: 'Πλάγιες ανυψώσεις', tempo: 3, prof: [0.4, 0.1, 0.5], yaw: 0.2, A: P(arms(0, 0.08, -0.1)), B: P(arms(0, 1.45, -0.25)) },
  jumping_jack:  { label: 'Jumping jacks', tempo: 1.2, yaw: 0.2, noZ: true, A: P({ ...arms(0, 0.15), ...legs(0, 0, 0.08) }), B: P({ ...arms(0, 2.9), ...legs(0, 0, 0.38), lift: 0.05 }) },
  high_knees:    { label: 'Ψηλά γόνατα', tempo: 1.4, yaw: 0.6, alt: true, noZ: true, A: P(arms(-0.5, 0, -1.6)), B: knee },
  calf_raise:    { label: 'Ανασηκώσεις γάμπας', tempo: 2, prof: [0.4, 0.2, 0.4], yaw: 0.8, A: P(arms(0)), B: P({ ...arms(0), anL: 0.9, anR: 0.9, lift: 0.09 }) },
  pushup:        { palm: 'flat', label: 'Κάμψεις', tempo: 3, prof: [0.5, 0.05, 0.45], yaw: 1.35, floor: true, flatFeet: false, A: pushTop, B: pushBot },
  plank:         { palm: 'flat', label: 'Σανίδα', tempo: 3, yaw: 1.35, floor: true, hold: true, flatFeet: false, A: pushTop, B: pushTop },
  crunch:        { label: 'Κοιλιακοί', tempo: 2.5, prof: [0.45, 0.1, 0.45], yaw: 1.35, floor: true, A: P({ ...lie, ...arms(-0.35, 0.12), hd: 0 }), B: P({ ...lie, tx: 0.85, hd: 0.25, ...arms(-0.75, 0.1) }) },
  glute_bridge:  { label: 'Γέφυρα γλουτών', tempo: 3, prof: [0.4, 0.2, 0.4], yaw: 1.35, floor: true, A: P({ ...lie, ...arms(0.05, 0.18) }), B: P({ ...lie, rrx: -1.97, rY: 0.32, ...legs(-0.01, 1.89), ...arms(0.45, 0.18) }) },
  incline_row:   { label: 'Κωπηλατική με ιμάντες (TRX)', tempo: 3, prof: [0.4, 0.12, 0.48], yaw: 1.2, floor: true, frame: { h: 2.75, w: 2.4, cy: 1.25 },
                   A: P({ rrx: -0.6, rY: 0.796, rZ: -0.2, ...arms(-1.64) }), B: P({ rrx: -0.35, rY: 0.896, rZ: 0.0, ...arms(0.75, 0.1, -2.0) }) },
  bird_dog:      { palm: 'flat', label: 'Bird-dog (στα τέσσερα)', tempo: 3.5, prof: [0.4, 0.2, 0.4], yaw: 1.3, floor: true, flatFeet: false, alt: true,
                   A: P({ rrx: 1.37, rY: 0.51, rZ: 0, hd: -0.3, ...arms(-1.37), ...legs(-1.37, 1.57) }),
                   B: P({ rrx: 1.37, rY: 0.51, rZ: 0, hd: -0.3, slx: -2.94, srx: -1.37, hlx: -1.37, knL: 1.57, hrx: 0.2, knR: 0 }) },
  generic:       { label: 'Κίνηση άσκησης', tempo: 2.5, yaw: 0.5, alt: true, A: P(arms(-0.3, 0, -0.8)), B: P({ ...arms(-0.8, 0, -1.2), hlx: -0.7, knL: 0.9 }) },
};

export const MOTION_KEYS = Object.keys(MOTIONS);

const RULES = [
  [/bird.?dog|διαγώνια έκταση|στα τέσσερα|τετραποδ|quadruped|superman.*γόνατ/i, 'bird_dog'],
  [/dead.?bug|νεκρό έντομο/i, 'crunch'],
  [/(trx|ιμάντ|suspension).*(row|κωπηλ|έλξ)|(row|κωπηλ|έλξ).*(trx|ιμάντ|suspension)|inverted row|αντίστροφη κωπηλ/i, 'incline_row'],
  [/bench|στήθους|chest|dip|βουτι/i, 'generic'],
  [/jumping|jack|ανοιχτά άλματα|άλματα ανοι/i, 'jumping_jack'],
  [/high.?knee|ψηλά γόνατα|τρέξιμο|jog|βάδην|march|skip/i, 'high_knees'],
  [/push.?up|κάμψεις|κάμψη.*(στήριξη|ώμων)|pushup/i, 'pushup'],
  [/plank|σανίδα|πλανκ/i, 'plank'],
  [/lunge|εκπτώσ|προβολ|split squat|step.?up/i, 'lunge'],
  [/squat|καθίσματα|σκουάτ|wall sit/i, 'squat'],
  [/deadlift|ρουμανικ|hinge|good.?morning|νεκρ|swing|hip hinge/i, 'hinge'],
  [/row|κωπηλ|έλξη|pull/i, 'row'],
  [/overhead|shoulder press|military|πιέσεις ώμων|πρέσα ώμων|arnold/i, 'overhead_press'],
  [/lateral|πλάγι(α|ες) ανύψω|side raise/i, 'lateral_raise'],
  [/curl|δικέφαλ|biceps/i, 'curl'],
  [/crunch|κοιλιακ|sit.?up|bicycle|leg raise/i, 'crunch'],
  [/bridge|γέφυρα|glute|γλουτ|thrust/i, 'glute_bridge'],
  [/calf|γάμπ|toe raise/i, 'calf_raise'],
];

export function inferMotion(ex) {
  let m = ex.motion && MOTIONS[ex.motion] ? ex.motion : null;
  if (!m) {
    const name = `${ex.name || ''} ${ex.youtube_query || ''}`;
    m = (RULES.find(([re]) => re.test(name)) || [, 'generic'])[1];
  }
  // κωπηλατική με ιμάντες TRX → κίνηση με κλίση προς τα πίσω
  if (m === 'row' && /trx|ιμάντ|suspension/i.test(`${ex.equipment || ''} ${ex.name || ''}`)) m = 'incline_row';
  return m;
}

/** "10-12" → {n:10} · "30 δευτερόλεπτα" → {timed:true,n:30} · "12 ανά πλευρά" → {perSide:true} */
export function parseReps(reps, motionKey) {
  const s = String(reps ?? '10').toLowerCase();
  const num = parseFloat((s.match(/\d+([.,]\d+)?/) || ['10'])[0].replace(',', '.'));
  const min = /\d\s*(λεπτ|min)/.test(s);
  const timed = /δευτ|sec|″|"|\d\s?s\b|\d\s*(λεπτ|min)/.test(s) || MOTIONS[motionKey]?.hold;
  const perSide = /πλευρ|πόδι|χέρι|each|side|ανά (πόδι|χέρι)/.test(s);
  if (timed) {
    const explicit = min || /δευτ|sec|″|"|\d\s?s\b/.test(s); // ρητή μονάδα χρόνου στο κείμενο
    return { timed: true, n: Math.max(3, Math.round(explicit ? (min ? num * 60 : num) : 30)) };
  }
  return { timed: false, n: Math.max(1, Math.round(num)), perSide };
}

```

## js/avatar.js

```javascript
import * as THREE from './vendor/three.module.min.js';
import { RoomEnvironment } from './vendor/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from './vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from './vendor/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from './vendor/jsm/postprocessing/OutputPass.js';
import { MOTIONS, mirror } from './motions.js';
import { loadCoachModel } from './skinned.js';
import { Equipment } from './equipment.js';

const L = { thigh: 0.45, shin: 0.43, upper: 0.30, fore: 0.27, ankle: 0.07 };
const KEYS = ['tx', 'hd', 'slx', 'slz', 'srx', 'srz', 'elL', 'elR', 'hlx', 'hlz', 'hrx', 'hrz', 'knL', 'knR', 'anL', 'anR', 'lift', 'rrx', 'rY', 'rZ'];
const STAND = Object.fromEntries(KEYS.map(k => [k, 0]));
// ρυθμός ακολουθίας ανά άρθρωση (μεγαλύτερο = πιο γρήγορη ακολουθία). Τα άκρα καθυστερούν λίγο → φυσικότερη κίνηση.
const RATE = { tx: 24, hd: 12, slx: 20, slz: 20, srx: 20, srz: 20, elL: 16, elR: 16, hlx: 28, hlz: 28, hrx: 28, hrz: 28, knL: 28, knR: 28, anL: 20, anR: 20, lift: 30, rrx: 28, rY: 30, rZ: 30 };
// στροφή αντιβραχίου (rad) ανά προσανατολισμό παλάμης
const TWIST = { up: 1.5, fwd: 1.25, flat: -1.45 };
const sm = x => x * x * x * (x * (x * 6 - 15) + 10);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const LOOKS = {
  real:   { name: 'Ρεαλιστική (Michelle)', model: 'assets/models/Michelle.glb', proxy: 'male' },
  custom: { name: 'Δικό μου μοντέλο', custom: true, proxy: 'male' },
  male:   { name: 'Άντρας', skin: 0xe2ab80, hair: 0x2a1f1a, top: 0x16a34a, bottom: 0x1f2937, shoulder: 1.0, hip: 1.0, waist: 1.0, ponytail: false, leggings: false, scale: 1 },
  female: { name: 'Γυναίκα', skin: 0xeab898, hair: 0x6b3f26, top: 0x0ea5e9, bottom: 0x334155, shoulder: 0.88, hip: 1.1, waist: 0.86, ponytail: true, leggings: true, scale: 0.96 },
};

function woodTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  for (let i = 0; i < 8; i++) {
    const y = i * 64; let x = (i % 2) * -140;
    while (x < 512) {
      const w = 170 + ((i * 37 + Math.abs(x)) % 5) * 26, v = (Math.sin(i * 12.9 + x * 0.07) * 0.5 + 0.5) * 30 - 15;
      g.fillStyle = `rgb(${178 + v},${132 + v * 0.8},${90 + v * 0.6})`; g.fillRect(x, y, w, 64);
      g.strokeStyle = 'rgba(70,40,15,.13)'; g.lineWidth = 1.2;
      for (let k = 0; k < 7; k++) { const yy = y + 5 + k * 9 + Math.sin(x + k) * 2; g.beginPath(); g.moveTo(x, yy); g.bezierCurveTo(x + w * 0.3, yy + 3, x + w * 0.6, yy - 3, x + w, yy + 1); g.stroke(); }
      g.fillStyle = 'rgba(45,25,10,.5)'; g.fillRect(x, y, 2, 64); x += w;
    }
    g.fillStyle = 'rgba(45,25,10,.45)'; g.fillRect(0, y + 62, 512, 2);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3.2, 3.2); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function radialAlpha() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 30, 128, 128, 128); gr.addColorStop(0, '#fff'); gr.addColorStop(0.62, '#fff'); gr.addColorStop(1, '#000');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c);
}

/** Καμπύλο ενιαίο φόντο φωτογραφικού στούντιο (cyclorama) */
function cyclorama() {
  const W = 16, floorLen = 6.5, R = 1.8, wallH = 6, arc = Math.PI / 2 * R, total = floorLen + arc + wallH, z0 = 4.5;
  const g = new THREE.PlaneGeometry(W, total, 1, 90), pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), d = pos.getY(i) + total / 2; let y, z;
    if (d <= floorLen) { z = z0 - d; y = 0; }
    else if (d <= floorLen + arc) { const a = (d - floorLen) / R; z = z0 - floorLen - Math.sin(a) * R; y = R - Math.cos(a) * R; }
    else { z = z0 - floorLen - R; y = R + (d - floorLen - arc); }
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xdfe3ea, roughness: 0.92, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.5 }));
  m.receiveShadow = true; return m;
}

/** Ποιότητα γραφικών: high (PC) ή normal (κινητά/αδύναμες συσκευές) */
export function defaultQuality() {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || Math.min(screen.width, screen.height) < 700;
  return mobile ? 'normal' : 'high';
}

export function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

/** Ομαλό σχήμα εκ περιστροφής από σημεία [y, r] (αύξουσα y). */
function lathe(stations, material, seg = 24) {
  const pts = new THREE.SplineCurve(stations.map(([y, r]) => new THREE.Vector2(r, y))).getPoints(28);
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, seg), material); m.castShadow = true; return m;
}
function ball(r, material, sx = 1, sy = 1, sz = 1) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), material); m.scale.set(sx, sy, sz); m.castShadow = true; return m; }

export class Avatar {
  constructor(container, look = 'real', opts = {}) {
    this.container = container; this.lookKey = LOOKS[look] ? look : 'real';
    const L0 = LOOKS[this.lookKey]; this.look = L0.proxy ? LOOKS[L0.proxy] : L0;
    this.envKind = opts.env || 'studio'; this.quality = opts.quality || defaultQuality();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.append(this.renderer.domElement);
    this.renderer.domElement.style.cssText = 'width:100%;height:100%;display:block';
    this.scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(this.renderer); this.env = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
    this.scene.environment = this.env;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x8a7a6a, 0.45));
    const sun = new THREE.DirectionalLight(0xfff1e0, 2.3); sun.position.set(2.2, 4.4, 3.0);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02; sun.shadow.radius = 5;
    Object.assign(sun.shadow.camera, { left: -2.2, right: 2.2, top: 2.8, bottom: -1.4, near: 0.5, far: 12 });
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0xbcd4ff, 1.1); rim.position.set(-3, 2.6, -2.8); this.scene.add(rim);
    this.build();
    if (this.quality === 'high') {
      const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(this.renderer, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.gtao = new GTAOPass(this.scene, this.camera, 1, 1);
      this.gtao.blendIntensity = 0.9;
      this.gtao.updateGtaoMaterial({ radius: 0.3, distanceExponent: 1.4, thickness: 1.2, scale: 1.25 });
      this.composer.addPass(this.gtao);
      this.composer.addPass(new OutputPass());
      if (this.envKind !== 'studio') this.scene.background = new THREE.Color(0xdfe8f4);
    } else { this.renderer.shadowMap.type = THREE.PCFShadowMap; }
    this.proxyMeshes = []; this.figure.traverse(o => { if (o.isMesh) this.proxyMeshes.push(o); });
    this.equip = new Equipment(this.scene); this.equipKey = '';
    this.cur = { ...STAND }; this.tgt = { ...STAND };
    this.motion = MOTIONS.squat; this.mode = 'idle'; this.t = 0; this.dur = 1; this.alt = false;
    this.yaw = 0.3; this.yawT = 0.3; this.paused = false; this.clock = new THREE.Clock(); this.time = 0;
    this.camD = 5; this.camY = 0.9;
    this.talkUntil = 0; this.nextBlink = 2; this.blink = 0; this.pt = { a: 0, v: 0, py: 0, pvy: 0 }; this.tmpV = new THREE.Vector3();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(container); this.resize();
    this.loop = this.loop.bind(this); this.raf = requestAnimationFrame(this.loop);
    // ρεαλιστικό μοντέλο
    const src = L0.custom ? opts.customModel : L0.model;
    this.loaded = Promise.resolve(false);
    if (src) {
      const overlay = document.createElement('div'); overlay.className = 'avatar-loading'; overlay.textContent = '⏳ Ο coach ετοιμάζεται…'; container.append(overlay);
      this.loaded = loadCoachModel(src).then(sc => {
        overlay.remove(); if (this.disposed) return false;
        this.skinned = sc; this.scene.add(sc.root);
        this.k = sc.hipsRestY / (L.thigh + L.shin + L.ankle);
        this.proxyMeshes.forEach(m => { m.visible = false; });
        return true;
      }).catch(e => { overlay.remove(); console.warn(e); opts.onError?.(e); return false; });
    }
  }

  mat(color, rough = 0.62, metal = 0.02) { return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }); }

  build() {
    const K = this.look;
    const skin = this.mat(K.skin, 0.55), top = this.mat(K.top, 0.75), bottom = this.mat(K.bottom, 0.8), hair = this.mat(K.hair, 0.5);
    const shoe = this.mat(0xf1f5f9, 0.5), sole = this.mat(0x334155, 0.9), dark = this.mat(0x1a1210, 0.4), white = this.mat(0xffffff, 0.3), lip = this.mat(0xb8574f, 0.5);
    const legMat = K.leggings ? bottom : skin;

    if (this.envKind === 'studio') {
      this.scene.add(cyclorama());
      const fill = new THREE.PointLight(0xffffff, 6, 9); fill.position.set(-2.4, 2.2, 2.6); this.scene.add(fill);
    } else {
      // ξύλινο πάτωμα «σπιτιού» που σβήνει στις άκρες
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshStandardMaterial({ color: 0xbfa58c, map: woodTexture(), alphaMap: radialAlpha(), transparent: true, roughness: 0.5, metalness: 0, envMapIntensity: 0.6 }));
      floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.scene.add(floor);
    }
    this.figure = new THREE.Group(); this.figure.scale.setScalar(K.scale); this.scene.add(this.figure);
    this.sway = new THREE.Group(); this.figure.add(this.sway);
    this.hips = new THREE.Group(); this.sway.add(this.hips);

    // πύελος
    const pelvis = ball(0.125, bottom, 1.12 * K.hip, 0.78, 0.84); pelvis.position.y = 0.03; this.hips.add(pelvis);
    // κοιλιά + θώρακας (2 τμήματα → φυσική καμπύλη σπονδυλικής)
    this.abdomen = new THREE.Group(); this.hips.add(this.abdomen);
    const abd = lathe([[0.0, 0.135 * K.hip], [0.11, 0.118 * K.waist], [0.23, 0.128 * K.waist]], top);
    abd.scale.z = 0.74; this.abdomen.add(abd);
    this.chest = new THREE.Group(); this.chest.position.y = 0.22; this.abdomen.add(this.chest);
    const ch = lathe([[0.0, 0.128 * K.waist], [0.1, 0.155 * K.shoulder], [0.2, 0.172 * K.shoulder], [0.27, 0.15 * K.shoulder], [0.305, 0.075], [0.318, 0.0]], top);
    ch.scale.z = 0.72; this.chest.add(ch);
    const neck = lathe([[0.27, 0.05], [0.33, 0.042], [0.4, 0.04]], skin, 14); this.chest.add(neck);
    // κεφάλι
    this.headG = new THREE.Group(); this.headG.position.y = 0.34; this.chest.add(this.headG);
    const head = lathe([[0.005, 0.03], [0.03, 0.068], [0.07, 0.097], [0.125, 0.108], [0.18, 0.103], [0.225, 0.074], [0.248, 0.032], [0.255, 0.0]], skin, 28);
    head.scale.set(0.93, 1, 1.04); this.headG.add(head);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.017, 0.04, 10), skin); nose.rotation.x = Math.PI / 2; nose.position.set(0, 0.112, 0.112); nose.castShadow = true; this.headG.add(nose);
    for (const s of [-1, 1]) {
      const ear = ball(0.02, skin, 0.5, 1, 0.9); ear.position.set(s * 0.098, 0.125, -0.005); this.headG.add(ear);
      const eyeW = ball(0.02, white, 1, 0.75, 0.5); eyeW.position.set(s * 0.04, 0.142, 0.097); eyeW.name = 'eye';
      const iris = ball(0.011, dark); iris.position.set(0, 0, 0.012); eyeW.add(iris); this.headG.add(eyeW);
      const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.005, 0.034, 3, 6), hair); brow.rotation.z = Math.PI / 2 - s * 0.12; brow.position.set(s * 0.042, 0.172, 0.1); this.headG.add(brow);
    }
    this.mouth = new THREE.Group(); this.mouth.position.set(0, 0.072, 0.1); this.headG.add(this.mouth);
    const lipM = ball(0.02, lip, 1.5, 0.35, 0.45); this.mouth.add(lipM);
    const inner = ball(0.014, dark, 1.2, 0.3, 0.3); inner.position.z = 0.006; inner.name = 'inner'; this.mouth.add(inner);
    // μαλλιά
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.114, 24, 14, 0, Math.PI * 2, 0, Math.PI * (K.ponytail ? 0.56 : 0.5)), hair);
    cap.position.set(0, 0.145, -0.012); cap.rotation.x = -0.5; cap.scale.set(1.0, 1.05, 1.04); cap.castShadow = true; this.headG.add(cap);
    const back = ball(0.108, hair, 0.98, 0.9, 0.8); back.position.set(0, 0.16, -0.03); this.headG.add(back);
    if (K.ponytail) {
      this.tail = new THREE.Group(); this.tail.position.set(0, 0.2, -0.1); this.headG.add(this.tail);
      const band = ball(0.026, this.mat(0xef4444), 1, 0.7, 1); this.tail.add(band);
      const hairTail = lathe([[-0.26, 0.004], [-0.17, 0.03], [-0.07, 0.034], [0.0, 0.022]], hair, 12); hairTail.rotation.x = 0.0; this.tail.add(hairTail);
    }
    // χέρια
    const mkArm = side => {
      const sh = new THREE.Group(); sh.position.set(side * 0.205 * K.shoulder, 0.25, 0); this.chest.add(sh);
      const delt = ball(0.055, top, 1, 1.05, 1); sh.add(delt);
      const arm = lathe([[-L.upper, 0.04], [-L.upper * 0.62, 0.05], [-L.upper * 0.2, 0.055], [0.0, 0.05]], skin, 16); sh.add(arm);
      const sleeve = lathe([[-L.upper * 0.5, 0.056], [-L.upper * 0.22, 0.06], [0.0, 0.056]], top, 16); sh.add(sleeve);
      const el = new THREE.Group(); el.position.y = -L.upper; sh.add(el);
      el.add(ball(0.04, skin));
      const fore = lathe([[-L.fore, 0.032], [-L.fore * 0.55, 0.04], [-L.fore * 0.1, 0.042], [0.0, 0.04]], skin, 16); el.add(fore);
      const hand = new THREE.Group(); hand.position.y = -L.fore - 0.04; el.add(hand);
      const palm = ball(0.04, skin, 0.95, 1.25, 0.55); hand.add(palm);
      const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.034, 3, 6), skin); thumb.position.set(-side * 0.03, 0.018, 0.012); thumb.rotation.z = side * 0.5; thumb.castShadow = true; hand.add(thumb);
      return { sh, el };
    };
    // πόδια
    const mkLeg = side => {
      const hp = new THREE.Group(); hp.position.set(side * 0.1 * K.hip, 0, 0); this.hips.add(hp);
      const thigh = lathe([[-L.thigh, 0.058], [-L.thigh * 0.55, 0.075], [-L.thigh * 0.15, 0.086], [0.0, 0.08]], legMat, 18); hp.add(thigh);
      if (!K.leggings) hp.add(lathe([[-L.thigh * 0.5, 0.082], [-L.thigh * 0.2, 0.09], [0.0, 0.086]], bottom, 18));
      const kn = new THREE.Group(); kn.position.y = -L.thigh; hp.add(kn);
      kn.add(ball(0.058, legMat));
      const shin = lathe([[-L.shin, 0.042], [-L.shin * 0.7, 0.048], [-L.shin * 0.72, 0.056], [-L.shin * 0.2, 0.05], [0.0, 0.056]], legMat, 16); kn.add(shin);
      const an = new THREE.Group(); an.position.y = -L.shin; kn.add(an);
      const shoeB = ball(0.052, shoe, 1, 0.78, 2.35); shoeB.position.set(0, -0.026, 0.055); an.add(shoeB);
      const sl = new THREE.Mesh(new THREE.BoxGeometry(0.098, 0.016, 0.255), sole); sl.position.set(0, -0.062, 0.05); sl.castShadow = true; an.add(sl);
      return { hp, kn, an };
    };
    this.aL = mkArm(-1); this.aR = mkArm(1); this.lL = mkLeg(-1); this.lR = mkLeg(1);
  }

  resize() {
    const w = this.container.clientWidth || 300, h = this.container.clientHeight || 300;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.composer) { this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h); }
  }

  draw() { if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera); }

  /** Κάδρωση: απόσταση κάμερας ώστε ο coach να γεμίζει την οθόνη ανάλογα με την κίνηση */
  frame() {
    const m = this.motion, f = m.frame || (m.floor ? { h: 1.75, w: 2.55, cy: 0.36 } : { h: 2.3, w: 1.6, cy: 0.76 });
    const vf = THREE.MathUtils.degToRad(this.camera.fov), hf = 2 * Math.atan(Math.tan(vf / 2) * this.camera.aspect);
    return { d: Math.max((f.h / 2) / Math.tan(vf / 2), (f.w / 2) / Math.tan(hf / 2)), cy: f.cy };
  }

  // ---- ΕΛΕΓΧΟΣ ----
  setMotion(key) { this.motion = MOTIONS[key] || MOTIONS.generic; this.yawT = this.motion.yaw; }
  setEquipment(e) { const key = JSON.stringify(e || {}); if (key !== this.equipKey) { this.equipKey = key; this.equip.set(e || {}); } }
  ready() { this.mode = 'ready'; this.cancelPending(); }
  idle() { this.mode = 'idle'; this.cancelPending(); }
  pause(on) { this.paused = on; }
  talkFor(ms) { this.talkUntil = performance.now() + ms; }
  cancelPending() { if (this.resolve) { const r = this.resolve; this.resolve = null; r(false); } }
  cycle(dur, alt = false) { this.cancelPending(); this.mode = 'cycle'; this.t = 0; this.dur = dur; this.alt = alt; return new Promise(r => { this.resolve = r; }); }
  hold(sec) { this.cancelPending(); this.mode = 'hold'; this.t = 0; this.dur = sec; return new Promise(r => { this.resolve = r; }); }

  /** u: 0..1 στο τρέχον στάδιο· ασύμμετρο προφίλ: [προς B, παύση, επιστροφή] */
  progress(t01) {
    const [a, h, b] = this.motion.prof || [0.5, 0, 0.5];
    if (t01 < a) return sm(t01 / a);
    if (t01 < a + h) return 1;
    return 1 - sm(Math.min((t01 - a - h) / b, 1));
  }

  pose(u, alt) {
    const m = this.motion, A = alt && m.alt ? mirror(m.A) : m.A, B = alt && m.alt ? mirror(m.B) : m.B;
    const o = {}; for (const k of KEYS) o[k] = A[k] + (B[k] - A[k]) * u; return o;
  }

  targetPose() {
    const m = this.motion, breath = Math.sin(this.time * 1.9);
    let p;
    if (this.mode === 'cycle') p = this.pose(this.progress(Math.min(this.t / this.dur, 1)), this.alt);
    else if (this.mode === 'hold') { p = { ...m.B }; p.rY += breath * 0.004; }
    else if (this.mode === 'ready') p = { ...m.A };
    else p = { ...STAND, slx: 0.05, srx: 0.05, elL: -0.2, elR: -0.2, slz: -0.07, srz: 0.07, hlz: -0.02, hrz: 0.02 };
    if (this.mode !== 'cycle') { p.tx += breath * 0.012; p.slx += breath * 0.01; p.srx += breath * 0.01; }
    if (this.mode !== 'idle') this.equipPose(p);
    else { const e = this.equip?.e || {}; if (e.kettlebell || e.goblet) { p.slx = p.srx = -0.3; p.slz = 0.3; p.srz = -0.3; p.elL = p.elR = -0.35; } }
    return p;
  }

  /** Προσαρμογή χεριών στον εξοπλισμό (π.χ. goblet squat, αλτήρες στα πλάγια) */
  equipPose(p) {
    const e = this.equip?.e || {}, m = this.motion, M2 = MOTIONS;
    const legsMove = m === M2.squat || m === M2.lunge || m === M2.calf_raise;
    if ((e.kettlebell || e.goblet) && legsMove) {
      p.slx = p.srx = -0.32 - p.tx; p.elL = p.elR = -2.3; p.slz = 0.32; p.srz = -0.32;
    } else if (e.dumbbells && legsMove) {
      p.slx = p.srx = -p.tx; p.elL = p.elR = -0.1; p.slz = -0.12; p.srz = 0.12;
    } else if (e.barbell && (m === M2.squat || m === M2.lunge)) { // front rack: μπάρα μπροστά στους ώμους
      p.slx = p.srx = -1.5 - p.tx; p.slz = -0.38; p.srz = 0.38; p.elL = p.elR = -2.8;
    } else if (e.kettlebell && m === M2.hinge) {
      p.slz = 0.22; p.srz = -0.22;
    } else if (e.band && (m === M2.squat)) {
      p.slx = p.srx = -0.5 - p.tx; p.elL = p.elR = -2.2;
    }
  }

  loop() {
    this.raf = requestAnimationFrame(this.loop);
    const real = this.clock.getDelta(), dt = Math.min(real, 0.1); // dt για ομαλοποίηση· real για χρονισμό (ώστε φωνή/κίνηση να μένουν συγχρονισμένες και σε αργές συσκευές)
    if (!this.paused) {
      this.time += real;
      if (this.mode === 'cycle' || this.mode === 'hold') {
        this.t += real;
        if (this.t >= this.dur && this.resolve) { const r = this.resolve; this.resolve = null; this.mode = 'ready'; r(true); }
      }
    }
    this.tgt = this.targetPose();
    const fast = this.mode === 'cycle';
    for (const key of KEYS) this.cur[key] += (this.tgt[key] - this.cur[key]) * (1 - Math.exp(-dt * (fast ? RATE[key] : 7)));
    this.yaw += (this.yawT - this.yaw) * (1 - Math.exp(-dt * 4));
    this.apply(this.cur, this.motion);
    this.living(dt);
    this.post(dt);
    const fr = this.frame(), kc = 1 - Math.exp(-dt * 2.5);
    this.camD += (fr.d - this.camD) * kc; this.camY += (fr.cy - this.camY) * kc;
    this.camera.position.set(0, this.camY + this.camD * 0.1, this.camD); this.camera.lookAt(0, this.camY, 0);
    this.draw();
  }

  /** Μεταφορά στο ρεαλιστικό μοντέλο + ενημέρωση εξοπλισμού */
  post(dt) {
    this.figure.updateMatrixWorld(true);
    this.palmW = (this.palmW ?? 0) + ((this.mode === 'idle' ? 0 : 1) - (this.palmW ?? 0)) * Math.min(1, dt * 6);
    const q = new THREE.Quaternion(), Yv = new THREE.Vector3(0, 1, 0), Zv = new THREE.Vector3(0, 0, 1);
    const ax = (o, v) => v.clone().applyQuaternion(o.getWorldQuaternion(q));
    const wp = (o, x = 0, y = 0, z = 0) => o.localToWorld(new THREE.Vector3(x, y, z));
    const sides = [['Left', this.aR, this.lR], ['Right', this.aL, this.lL]]; // Left του μοντέλου = +x
    const grip = this.equip.grip();
    if (this.skinned) {
      const T = {};
      const hy = ax(this.hips, Yv), hz = ax(this.hips, Zv), ay = ax(this.abdomen, Yv), az = ax(this.abdomen, Zv), cy = ax(this.chest, Yv), cz = ax(this.chest, Zv), ey = ax(this.headG, Yv), ez = ax(this.headG, Zv);
      T.Hips = { dir: hy, sec: hz }; T.Spine = { dir: ay, sec: az };
      T.Spine1 = { dir: ay.clone().add(cy), sec: az.clone().add(cz) }; T.Spine2 = { dir: cy, sec: cz };
      T.Neck = { dir: cy.clone().add(ey), sec: cz.clone().add(ez) }; T.Head = { dir: ey, sec: ez };
      for (const [S, a, l] of sides) {
        const sh = wp(a.sh), el = wp(a.el), hand = wp(a.el, 0, -L.fore, 0);
        T[S + 'Arm'] = { dir: el.clone().sub(sh), sec: ax(a.sh, Zv) };
        const fdir = hand.sub(el), fsec = ax(a.el, Zv);
        const tw = (TWIST[this.motion.palm] || 0) * this.palmW;
        if (tw) fsec.applyAxisAngle(fdir.clone().normalize(), S === 'Left' ? tw : -tw); // πρηνισμός/υπτιασμός καρπού
        T[S + 'ForeArm'] = { dir: fdir, sec: fsec };
        const hp = wp(l.hp), kn = wp(l.kn), an = wp(l.an), toe = wp(l.an, 0, -0.05, 0.14);
        T[S + 'UpLeg'] = { dir: kn.clone().sub(hp), sec: ax(l.hp, Zv) };
        T[S + 'Leg'] = { dir: an.clone().sub(kn), sec: ax(l.kn, Zv) };
        T[S + 'Foot'] = { dir: toe.sub(an), sec: ax(l.an, Yv) };
      }
      if (this.motion.palm === 'flat' && this.palmW > 0.5) { // παλάμες επίπεδες στο πάτωμα, δάχτυλα προς το κεφάλι
        const fwd = new THREE.Vector3(0, 0, 1).applyAxisAngle(Yv, this.yaw);
        for (const [S] of sides) T[S + 'Hand'] = { dir: fwd.clone(), sec: new THREE.Vector3(0, -1, 0) };
      }
      const hips = wp(this.hips).multiplyScalar(this.k);
      const g2 = this.motion.palm === 'flat' ? 0.05 : grip; this.skinned.setGrip(g2, g2);
      this.skinned.drive(T, hips, dt, { air: this.motion === MOTIONS.jumping_jack ? this.cur.lift * this.k : 0 });
    }
    // χέρια/πόδια για τον εξοπλισμό
    const H = { figure: this.figure, yaw: this.yaw, feet: {}, matZ: (this.cur.rZ || 0) * (this.k || 1) + (this.cur.rrx > 0.3 ? -0.3 : 0.1) };
    for (const [S, a, l] of sides) {
      const key = S[0];
      if (this.skinned) {
        const sk = this.skinned, b = n => sk.worldPos(S + n);
        const hand = b('Hand'), mid = sk.b[S + 'HandMiddle1'] ? b('HandMiddle1') : hand.clone();
        const i1 = sk.b[S + 'HandIndex1'] ? b('HandIndex1') : null, p1 = sk.b[S + 'HandPinky1'] ? b('HandPinky1') : null;
        const fingers = mid.clone().sub(hand); const across = i1 && p1 ? p1.sub(i1) : ax(a.el, new THREE.Vector3(1, 0, 0));
        const palm = new THREE.Vector3().crossVectors(fingers, across).normalize().multiplyScalar(S === 'Left' ? -0.022 : 0.022);
        H[key] = { pos: hand.clone().addScaledVector(fingers, 1.25).add(palm), across };
        const foot = sk.b[S + 'ToeBase'] ? b('Foot').add(b('ToeBase')).multiplyScalar(0.5) : b('Foot');
        H.feet[key] = foot.setY(0.015);
      } else {
        H[key] = { pos: wp(a.el, 0, -L.fore - 0.045, 0), across: ax(a.el, new THREE.Vector3(1, 0, 0)) };
        H.feet[key] = wp(l.an, 0, -0.06, 0.06).setY(0.015);
      }
    }
    this.equip.update(H);
  }

  /** Μικρο-κινήσεις ζωής: βλέμμα, ανοιγοκλείσιμο, μιλιά, αναπνοή, κουτσουλιά ουράς */
  living(dt) {
    const now = performance.now(), m = this.motion;
    // βλέμμα προς τον χρήστη (αντισταθμίζει τη στροφή του σώματος)
    const target = clamp(-this.yaw * (m.floor ? 0.45 : 0.75), -0.7, 0.7);
    this.headG.rotation.y += (target + Math.sin(this.time * 0.5) * 0.05 - this.headG.rotation.y) * (1 - Math.exp(-dt * 5));
    // βλεφαρίδα
    this.nextBlink -= dt; if (this.nextBlink < 0) { this.blink = 0.14; this.nextBlink = 2 + Math.random() * 3.5; }
    if (this.blink > 0) this.blink -= dt;
    const eyeY = this.blink > 0 ? 0.12 : 1;
    this.headG.children.forEach(c => { if (c.name === 'eye') c.scale.y = 0.75 * eyeY; });
    // στόμα όταν μιλάει
    const talking = now < this.talkUntil && !this.paused;
    const open = talking ? 0.35 + 0.65 * Math.abs(Math.sin(this.time * 14)) : 0;
    if (talking) this.headG.rotation.x += Math.sin(this.time * 6.5) * 0.035;
    this.mouth.scale.y = 1 + open * 2.6; this.mouth.children[1].scale.y = 0.3 + open * 1.6;
    // κάθετη ταλάντευση ισορροπίας
    this.sway.rotation.z = this.mode === 'idle' || this.mode === 'ready' ? Math.sin(this.time * 0.6) * 0.012 : 0;
    // αλογοουρά (ελατήριο)
    if (this.tail) {
      this.headG.getWorldPosition(this.tmpV); const s = this.pt;
      const vy = (this.tmpV.y - s.py) / Math.max(dt, 1e-3); const ay = clamp((vy - s.pvy) / Math.max(dt, 1e-3), -25, 25);
      s.py = this.tmpV.y; s.pvy = vy;
      s.v += (-90 * (s.a - 0.18) - 9 * s.v + ay * 0.06) * dt; s.a = clamp(s.a + s.v * dt, -0.9, 1.1);
      this.tail.rotation.x = s.a; this.tail.rotation.z = Math.sin(this.time * 1.3) * 0.03;
    }
  }

  /** Άμεση εφαρμογή πόζας (για δοκιμές) */
  debug(key, u, alt = false, equip) {
    this.setMotion(key); if (equip) this.setEquipment(equip); this.yaw = this.yawT; this.mode = u === 0 ? 'ready' : 'hold';
    this.cur = this.pose(u, alt); this.equipPose(this.cur);
    for (let i = 0; i < 40; i++) { this.apply(this.cur, this.motion); this.living(0.1); this.post(0.1); }
    const fr = this.frame(); this.camD = fr.d; this.camY = fr.cy;
    this.camera.position.set(0, this.camY + this.camD * 0.1, this.camD); this.camera.lookAt(0, this.camY, 0);
    this.draw();
  }

  apply(p, m) {
    this.figure.rotation.y = this.yaw;
    // σπονδυλική στήλη σε 2 τμήματα + αντιστάθμιση βλέμματος
    this.abdomen.rotation.x = p.tx * 0.42; this.chest.rotation.x = p.tx * 0.58;
    this.headG.rotation.x = p.hd - p.tx * 0.45;
    // ωμοπλάτες: ανασηκώνονται όταν τα χέρια ανεβαίνουν
    const up = k => clamp((Math.abs(p[k + 'z']) - 1.2) * 0.04 + (-p[k + 'x'] > 2 ? 0.03 : 0), 0, 0.05);
    this.aL.sh.position.y = 0.25 + up('sl'); this.aR.sh.position.y = 0.25 + up('sr');
    this.aL.sh.rotation.set(p.slx, 0, p.slz); this.aR.sh.rotation.set(p.srx, 0, p.srz);
    this.aL.el.rotation.x = p.elL; this.aR.el.rotation.x = p.elR;
    this.lL.hp.rotation.set(p.hlx, 0, p.hlz); this.lR.hp.rotation.set(p.hrx, 0, p.hrz);
    this.lL.kn.rotation.x = p.knL; this.lR.kn.rotation.x = p.knR;
    // πέλματα επίπεδα στο έδαφος (εκτός από κάμψεις/σανίδα όπου πατούν στις μύτες)
    const flat = m.flatFeet !== false;
    this.lL.an.rotation.x = (flat ? -(p.rrx + p.hlx + p.knL) : 0) + p.anL;
    this.lR.an.rotation.x = (flat ? -(p.rrx + p.hrx + p.knR) : 0) + p.anR;
    this.hips.rotation.x = p.rrx;
    if (m.floor) { this.hips.position.set(0, p.rY, p.rZ); return; }
    const leg = (hx, hz, kx) => {
      const f1 = -hx, f2 = -hx - kx;
      return { v: (L.thigh * Math.cos(f1) + L.shin * Math.cos(f2)) * Math.cos(hz), f: L.thigh * Math.sin(f1) + L.shin * Math.sin(f2) };
    };
    const a = leg(p.hlx, p.hlz, p.knL), b = leg(p.hrx, p.hrz, p.knR);
    this.hips.position.set(0, Math.max(a.v, b.v) + L.ankle + p.lift, m.noZ ? 0 : -(a.f + b.f) / 2);
  }

  dispose() {
    this.disposed = true; this.composer?.dispose?.(); this.gtao?.dispose?.(); cancelAnimationFrame(this.raf); this.ro.disconnect(); this.cancelPending(); this.equip.dispose(); this.env?.dispose();
    this.skinned?.root.traverse(o => { if (o.material) Object.values(o.material).forEach(v => v?.isTexture && v.dispose()); });
    this.scene.traverse(o => { o.geometry?.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); });
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}

```

## js/skinned.js

```javascript
// Ρεαλιστικός coach: φορτώνει rigged μοντέλο (σκελετός Mixamo) και του μεταφέρει (retarget)
// τις κινήσεις του αόρατου «οδηγού» σκελετού του Avatar.
import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/jsm/loaders/GLTFLoader.js';

const norm = n => n.replace(/^mixamorig[:_]?/i, '');
const V = () => new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];

function basis(dir, sec, out) {
  const e1 = dir.clone().normalize();
  const e2 = sec.clone().addScaledVector(e1, -sec.dot(e1));
  if (e2.lengthSq() < 1e-8) e2.copy(Math.abs(e1.y) < 0.9 ? Y : Z).addScaledVector(e1, -(Math.abs(e1.y) < 0.9 ? e1.y : e1.z));
  e2.normalize();
  const e3 = new THREE.Vector3().crossVectors(e1, e2);
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(e1, e2, e3));
}

export async function loadCoachModel(src) {
  const loader = new GLTFLoader();
  const gltf = typeof src === 'string' ? await loader.loadAsync(src) : await loader.parseAsync(src, '');
  return new SkinnedCoach(gltf.scene);
}

export class SkinnedCoach {
  constructor(root) {
    this.root = root; this.b = {};
    root.traverse(o => {
      if (o.isBone) this.b[norm(o.name)] = o;
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; if (o.material) { o.material.envMapIntensity = 0.9; } }
    });
    const need = ['Hips', 'Spine', 'Spine2', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];
    const miss = need.filter(n => !this.b[n]);
    if (miss.length) throw new Error('Το μοντέλο δεν έχει σκελετό τύπου Mixamo (λείπουν: ' + miss.join(', ') + ')');
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    // κλίμακα ώστε ύψος ≈ 1.70m, πατούσες στο 0
    const s = 1.7 / Math.max(box.max.y - box.min.y, 0.01);
    root.scale.multiplyScalar(s); root.updateMatrixWorld(true);
    this.rest = {};
    for (const [n, bone] of Object.entries(this.b)) this.rest[n] = { local: bone.quaternion.clone(), world: bone.getWorldQuaternion(new THREE.Quaternion()), pos: bone.getWorldPosition(V()) };
    const p = n => this.rest[n]?.pos;
    // κόκαλα που οδηγούνται: [όνομα, παιδί για κατεύθυνση, άξονας «μπροστά» σε rest]
    const ch = (a, b) => (p(b) ? p(b).clone().sub(p(a)) : null);
    this.chain = [
      ['Hips', 'Spine', Z], ['Spine', this.b.Spine1 ? 'Spine1' : 'Spine2', Z], ...(this.b.Spine1 ? [['Spine1', 'Spine2', Z]] : []), ['Spine2', 'Neck', Z], ['Neck', 'Head', Z],
      ['Head', this.b.HeadTop_End ? 'HeadTop_End' : null, Z],
      ['LeftArm', 'LeftForeArm', Z], ['LeftForeArm', 'LeftHand', Z], ['RightArm', 'RightForeArm', Z], ['RightForeArm', 'RightHand', Z],
      ['LeftUpLeg', 'LeftLeg', Z], ['LeftLeg', 'LeftFoot', Z], ['RightUpLeg', 'RightLeg', Z], ['RightLeg', 'RightFoot', Z],
      ...(this.b.LeftToeBase ? [['LeftFoot', 'LeftToeBase', Y], ['RightFoot', 'RightToeBase', Y]] : []),
      ...(this.b.LeftHandMiddle1 ? [['LeftHand', 'LeftHandMiddle1', Y.clone().negate()], ['RightHand', 'RightHandMiddle1', Y.clone().negate()]] : []), // παλάμη προς τα κάτω σε T-pose
    ].map(([n, c, sec]) => {
      const dir = c ? ch(n, c) : Y.clone();
      return { n, restBasis: basis(dir, sec, new THREE.Quaternion()).invert() };
    });
    this.hipsRestY = p('Hips').y;
    // δάχτυλα: άξονας κάμψης στο τοπικό σύστημα κάθε φάλαγγας
    this.fingers = [];
    for (const side of ['Left', 'Right']) {
      const i1 = p(side + 'HandIndex1'), p1 = p(side + 'HandPinky1');
      if (!i1 || !p1) continue;
      const across = (side === 'Left' ? p1.clone().sub(i1) : i1.clone().sub(p1)).normalize();
      // αν το χέρι «κοιτάει» αλλού, επιβεβαιώνουμε φορά με την παλάμη: κάμψη προς -Y σε T-pose
      for (const f of FINGERS) for (let k = 1; k <= 3; k++) {
        const n = `${side}Hand${f}${k}`; if (!this.b[n]) continue;
        const ax = across.clone().applyQuaternion(this.rest[n].world.clone().invert());
        this.fingers.push({ bone: this.b[n], local: this.rest[n].local, ax, side, k });
      }
      for (let k = 1; k <= 3; k++) {
        const n = `${side}HandThumb${k}`; if (!this.b[n]) continue;
        const ax = new THREE.Vector3(0, 0, side === 'Left' ? -1 : 1).applyQuaternion(this.rest[n].world.clone().invert());
        this.fingers.push({ bone: this.b[n], local: this.rest[n].local, ax, side, k, thumb: true });
      }
    }
    this.grip = { Left: 0.25, Right: 0.25 }; this.gripCur = { Left: 0.25, Right: 0.25 };
    this.offY = 0; this.tq = new THREE.Quaternion(); this.tq2 = new THREE.Quaternion(); this.tv = V(); this.tv2 = V();
  }

  setGrip(left, right) { this.grip.Left = left; this.grip.Right = right; }

  worldPos(name, out = V()) { return this.b[name].getWorldPosition(out); }

  /** targets: { name: {dir, sec} } σε world space · hipsPos: world */
  drive(targets, hipsPos, dt, { air = 0 } = {}) {
    const q = this.tq, pq = this.tq2;
    for (const c of this.chain) {
      const t = targets[c.n]; const bone = this.b[c.n]; if (!t || !bone) continue;
      basis(t.dir, t.sec, q).multiply(c.restBasis).multiply(this.rest[c.n].world); // νέα world rotation
      bone.parent.getWorldQuaternion(pq);
      bone.quaternion.copy(pq.invert().multiply(q));
      if (c.n === 'Hips') {
        const lp = this.tv.copy(hipsPos); lp.y += this.offY; bone.parent.worldToLocal(lp); bone.position.copy(lp);
      }
      bone.updateMatrixWorld(true);
    }
    // δάχτυλα (κράτημα αντικειμένων)
    const kf = 1 - Math.exp(-dt * 10);
    for (const s of ['Left', 'Right']) this.gripCur[s] += (this.grip[s] - this.gripCur[s]) * kf;
    for (const f of this.fingers) {
      const g = this.gripCur[f.side] * (f.thumb ? 0.55 : (f.k === 1 ? 1.15 : 1.35));
      f.bone.quaternion.copy(f.local).multiply(this.tq.setFromAxisAngle(f.ax, g));
    }
    this.root.updateMatrixWorld(true);
    // επαφή με το έδαφος: το χαμηλότερο σημείο επαφής ακουμπά στο 0
    const C = [['LeftToeBase', 0.025], ['RightToeBase', 0.025], ['LeftFoot', 0.075], ['RightFoot', 0.075], ['LeftHand', 0.02], ['RightHand', 0.02],
      ['LeftLeg', 0.06], ['RightLeg', 0.06], ['Hips', 0.11], ['Spine2', 0.12], ['Head', 0.11], ['LeftForeArm', 0.045], ['RightForeArm', 0.045]];
    let min = Infinity;
    for (const [n, r] of C) { if (!this.b[n]) continue; const y = this.worldPos(n, this.tv2).y - r; if (y < min) min = y; }
    const want = this.offY - min + air;
    this.offY += (want - this.offY) * (1 - Math.exp(-dt * 18));
  }
}

```

## js/equipment.js

```javascript
// Εξοπλισμός που κρατά/χρησιμοποιεί ο coach. Ρεαλιστικά υλικά (PBR) για αντανακλάσεις από το environment.
import * as THREE from './vendor/three.module.min.js';

const RULES = {
  straps: /trx|ιμάντ|suspension|strap|αιωρούμεν/i,
  band: /λάστιχ|band|resistance|ελαστικ|λάστιχα/i,
  kettlebell: /kettle|κέτλ|κετλ/i,
  barbell: /barbell|μπάρα(?!\s*(έλξ|ελξ|pull))|\bbar\b(?!\s*pull)/i,
  dumbbells: /αλτήρ|dumbbell|\bdb\b|μπουκάλι/i,
  mat: /στρώμα|mat\b|yoga|γιόγκα/i,
};

/** Επιστρέφει {dumbbells, kettlebell, band, straps, barbell, mat, goblet} για μια άσκηση. */
export function equipmentFor(ex, motion) {
  const eq = String(ex.equipment || '');
  const text = `${eq} ${ex.name || ''} ${ex.youtube_query || ''}`;
  const has = k => RULES[k].test(eq) || (k !== 'mat' && RULES[k].test(`${ex.name || ''} ${ex.youtube_query || ''}`));
  const e = {};
  for (const k of Object.keys(RULES)) if (has(k)) e[k] = true;
  if (/σώμα|bodyweight|χωρίς/i.test(eq) && !/αλτήρ|λάστιχ|band|kettle|μπάρα/i.test(eq)) for (const k of ['dumbbells', 'kettlebell', 'barbell', 'band', 'straps']) if (!RULES[k].test(ex.name || '')) delete e[k];
  if (/goblet|κύπελλο/i.test(text)) e.goblet = true;
  if (e.kettlebell) { delete e.dumbbells; }
  if (e.barbell) { delete e.dumbbells; }
  if (motion && ['pushup', 'plank', 'crunch', 'glute_bridge', 'bird_dog'].includes(motion)) e.mat = true;
  if (['pushup', 'plank', 'jumping_jack', 'high_knees', 'bird_dog'].includes(motion)) { delete e.dumbbells; delete e.kettlebell; delete e.barbell; }
  return e;
}

const M = {
  rubber: () => new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.78, metalness: 0.05 }),
  chrome: () => new THREE.MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.18, metalness: 1 }),
  knurl: () => new THREE.MeshStandardMaterial({ color: 0x9aa1aa, roughness: 0.45, metalness: 1 }),
  iron: () => new THREE.MeshStandardMaterial({ color: 0x25272b, roughness: 0.55, metalness: 0.6 }),
  latex: c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.42, metalness: 0 }),
  strap: () => new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.9 }),
  handle: () => new THREE.MeshStandardMaterial({ color: 0xf2c94c, roughness: 0.6 }),
  mat: () => new THREE.MeshStandardMaterial({ color: 0x5b4b8a, roughness: 0.95 }),
};
const shadow = o => { o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } }); return o; };

function dumbbell() {
  const g = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.15, 16), M.knurl()); bar.rotation.z = Math.PI / 2; g.add(bar);
  for (const s of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.075, 6), M.rubber()); head.rotation.z = Math.PI / 2; head.position.x = s * 0.112; g.add(head);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.006, 20), M.chrome()); cap.rotation.z = Math.PI / 2; cap.position.x = s * 0.152; g.add(cap);
    const coll = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.012, 16), M.chrome()); coll.rotation.z = Math.PI / 2; coll.position.x = s * 0.07; g.add(coll);
  }
  return shadow(g);
}
function kettlebell() {
  const g = new THREE.Group(), iron = M.iron();
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.105, 28, 20), iron); bell.scale.y = 0.92; bell.position.y = -0.14; g.add(bell);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.02, 24), iron); base.position.y = -0.235; g.add(base);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.014, 12, 28, Math.PI), iron); handle.position.y = -0.06; g.add(handle);
  for (const s of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.06, 12), iron); leg.position.set(s * 0.06, -0.085, 0); g.add(leg); }
  return shadow(g);
}
function barbell() {
  const g = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.7, 16), M.chrome()); bar.rotation.z = Math.PI / 2; g.add(bar);
  for (const s of [-1, 1]) {
    for (const [x, r] of [[0.6, 0.18], [0.64, 0.14]]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.035, 32), M.rubber()); p.rotation.z = Math.PI / 2; p.position.x = s * x; g.add(p); }
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 16), M.chrome()); c.rotation.z = Math.PI / 2; c.position.x = s * 0.56; g.add(c);
  }
  return shadow(g);
}
/** Ευθύγραμμο «σχοινί/λάστιχο» ανάμεσα σε δύο σημεία */
function rope(radius, mat) { const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 10), mat); m.castShadow = true; return m; }
function stretch(m, a, b) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  m.position.copy(a).addScaledVector(d, 0.5); m.scale.set(1, Math.max(len, 0.001), 1);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
}
const alignX = (obj, axis) => obj.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), axis.clone().normalize());

export class Equipment {
  constructor(scene) { this.scene = scene; this.group = new THREE.Group(); scene.add(this.group); this.set({}); }

  set(e) {
    this.e = e || {};
    this.group.clear();
    const add = o => { this.group.add(o); return o; };
    this.o = {};
    if (this.e.dumbbells && !this.e.goblet) this.o.db = [add(dumbbell()), add(dumbbell())];
    if (this.e.dumbbells && this.e.goblet) this.o.goblet = add(dumbbell());
    if (this.e.kettlebell) this.o.kb = add(kettlebell());
    if (this.e.barbell) this.o.bar = add(barbell());
    if (this.e.band) this.o.band = [add(rope(0.011, M.latex(0xe63946))), add(rope(0.011, M.latex(0xe63946)))];
    if (this.e.straps) {
      const st = M.strap(), hd = M.handle();
      this.o.straps = [add(rope(0.012, st)), add(rope(0.012, st))];
      this.o.handles = [0, 1].map(() => { const h = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.13, 14), hd); h.castShadow = true; return add(h); });
      const anchor = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.08), M.iron()); this.o.anchor = add(anchor);
    }
    if (this.e.mat) {
      const mat = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.008, 1.9), M.mat()); mat.receiveShadow = true; this.o.mat = add(mat);
    }
  }

  /** Ποσό «κλεισίματος» δαχτύλων ανά χέρι */
  grip() { const e = this.e; return e.dumbbells || e.kettlebell || e.barbell || e.band || e.straps ? 1 : 0.25; }

  /** h: { L:{pos,across}, R:{pos,across}, feet:{L,R}, figure, yaw } σε world space */
  update(h) {
    const o = this.o, up = new THREE.Vector3(0, 1, 0);
    if (o.db) o.db.forEach((d, i) => { const s = i ? h.R : h.L; d.position.copy(s.pos); alignX(d, s.across); });
    const mid = h.L.pos.clone().add(h.R.pos).multiplyScalar(0.5), across = h.R.pos.clone().sub(h.L.pos);
    if (o.goblet) { o.goblet.position.copy(mid).addScaledVector(up, -0.03); alignX(o.goblet, up); }
    if (o.kb) { o.kb.position.copy(mid); o.kb.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(across.x, 0, across.z).normalize()); }
    if (o.bar) { o.bar.position.copy(mid); alignX(o.bar, across.lengthSq() > 1e-4 ? across : new THREE.Vector3(1, 0, 0)); }
    if (o.band) { stretch(o.band[0], h.feet.L, h.L.pos); stretch(o.band[1], h.feet.R, h.R.pos); }
    if (o.straps) {
      const anchor = h.figure.localToWorld(new THREE.Vector3(0, 2.45, 1.15));
      o.anchor.position.copy(anchor);
      [h.L, h.R].forEach((s, i) => { stretch(o.straps[i], anchor, s.pos); o.handles[i].position.copy(s.pos); o.handles[i].quaternion.setFromUnitVectors(up, s.across.clone().normalize()); });
    }
    if (o.mat) { o.mat.position.set(0, 0.004, 0); h.figure.updateMatrixWorld(); const q = new THREE.Quaternion().setFromAxisAngle(up, h.yaw); o.mat.quaternion.copy(q); o.mat.position.copy(new THREE.Vector3(0, 0, h.matZ || 0).applyQuaternion(q)).setY(0.004); }
  }

  dispose() { this.group.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); this.group.removeFromParent(); }
}

```
