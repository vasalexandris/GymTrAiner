import * as THREE from './vendor/three.module.min.js';
import { RoomEnvironment } from './vendor/jsm/environments/RoomEnvironment.js';
import { MOTIONS, mirror } from './motions.js';
import { loadCoachModel } from './skinned.js';
import { Equipment } from './equipment.js';

const L = { thigh: 0.45, shin: 0.43, upper: 0.30, fore: 0.27, ankle: 0.07 };
const KEYS = ['tx', 'hd', 'slx', 'slz', 'srx', 'srz', 'elL', 'elR', 'hlx', 'hlz', 'hrx', 'hrz', 'knL', 'knR', 'anL', 'anR', 'lift', 'rrx', 'rY', 'rZ'];
const STAND = Object.fromEntries(KEYS.map(k => [k, 0]));
// ρυθμός ακολουθίας ανά άρθρωση (μεγαλύτερο = πιο γρήγορη ακολουθία). Τα άκρα καθυστερούν λίγο → φυσικότερη κίνηση.
const RATE = { tx: 24, hd: 12, slx: 20, slz: 20, srx: 20, srz: 20, elL: 16, elR: 16, hlx: 28, hlz: 28, hrx: 28, hrz: 28, knL: 28, knR: 28, anL: 20, anR: 20, lift: 30, rrx: 28, rY: 30, rZ: 30 };
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

    // ξύλινο πάτωμα που «σβήνει» στις άκρες + σκιές
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshStandardMaterial({ color: 0xbfa58c, map: woodTexture(), alphaMap: radialAlpha(), transparent: true, roughness: 0.5, metalness: 0, envMapIntensity: 0.6 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.scene.add(floor);
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
  }

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
    this.renderer.render(this.scene, this.camera);
  }

  /** Μεταφορά στο ρεαλιστικό μοντέλο + ενημέρωση εξοπλισμού */
  post(dt) {
    this.figure.updateMatrixWorld(true);
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
        T[S + 'ForeArm'] = { dir: hand.sub(el), sec: ax(a.el, Zv) };
        const hp = wp(l.hp), kn = wp(l.kn), an = wp(l.an), toe = wp(l.an, 0, -0.05, 0.14);
        T[S + 'UpLeg'] = { dir: kn.clone().sub(hp), sec: ax(l.hp, Zv) };
        T[S + 'Leg'] = { dir: an.clone().sub(kn), sec: ax(l.kn, Zv) };
        T[S + 'Foot'] = { dir: toe.sub(an), sec: ax(l.an, Yv) };
      }
      const hips = wp(this.hips).multiplyScalar(this.k);
      this.skinned.setGrip(grip, grip);
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
    this.renderer.render(this.scene, this.camera);
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
    this.disposed = true; cancelAnimationFrame(this.raf); this.ro.disconnect(); this.cancelPending(); this.equip.dispose(); this.env?.dispose();
    this.skinned?.root.traverse(o => { if (o.material) Object.values(o.material).forEach(v => v?.isTexture && v.dispose()); });
    this.scene.traverse(o => { o.geometry?.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); });
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
