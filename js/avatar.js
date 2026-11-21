import * as THREE from './vendor/three.module.min.js';
import { MOTIONS, mirror } from './motions.js';

const L = { thigh: 0.45, shin: 0.43, upper: 0.30, fore: 0.27, ankle: 0.07 };
const KEYS = ['tx', 'hd', 'slx', 'slz', 'srx', 'srz', 'elL', 'elR', 'hlx', 'hlz', 'hrx', 'hrz', 'knL', 'knR', 'anL', 'anR', 'lift', 'rrx', 'rY', 'rZ'];
const STAND = Object.fromEntries(KEYS.map(k => [k, 0]));
// ρυθμός ακολουθίας ανά άρθρωση (μεγαλύτερο = πιο γρήγορη ακολουθία). Τα άκρα καθυστερούν λίγο → φυσικότερη κίνηση.
const RATE = { tx: 24, hd: 12, slx: 20, slz: 20, srx: 20, srz: 20, elL: 16, elR: 16, hlx: 28, hlz: 28, hrx: 28, hrz: 28, knL: 28, knR: 28, anL: 20, anR: 20, lift: 30, rrx: 28, rY: 30, rZ: 30 };
const sm = x => x * x * x * (x * (x * 6 - 15) + 10);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const LOOKS = {
  male:   { name: 'Άντρας', skin: 0xe2ab80, hair: 0x2a1f1a, top: 0x16a34a, bottom: 0x1f2937, shoulder: 1.0, hip: 1.0, waist: 1.0, ponytail: false, leggings: false, scale: 1 },
  female: { name: 'Γυναίκα', skin: 0xeab898, hair: 0x6b3f26, top: 0x0ea5e9, bottom: 0x334155, shoulder: 0.88, hip: 1.1, waist: 0.86, ponytail: true, leggings: true, scale: 0.96 },
};

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
  constructor(container, look = 'male') {
    this.container = container; this.look = LOOKS[look] || LOOKS.male;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.append(this.renderer.domElement);
    this.renderer.domElement.style.cssText = 'width:100%;height:100%;display:block';
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    this.scene.add(new THREE.HemisphereLight(0xdfeaff, 0x8a7f78, 1.25));
    const sun = new THREE.DirectionalLight(0xfff4e5, 2.4); sun.position.set(2.2, 4.2, 3.2);
    sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0008; sun.shadow.radius = 4;
    Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2.4, bottom: -1.2, near: 0.5, far: 12 });
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x9ec5ff, 0.9); rim.position.set(-3, 2.5, -2.5); this.scene.add(rim);
    this.build();
    this.cur = { ...STAND }; this.tgt = { ...STAND };
    this.motion = MOTIONS.squat; this.mode = 'idle'; this.t = 0; this.dur = 1; this.alt = false;
    this.yaw = 0.3; this.yawT = 0.3; this.paused = false; this.clock = new THREE.Clock(); this.time = 0;
    this.talkUntil = 0; this.nextBlink = 2; this.blink = 0; this.pt = { a: 0, v: 0, py: 0, pvy: 0 }; this.tmpV = new THREE.Vector3();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(container); this.resize();
    this.loop = this.loop.bind(this); this.raf = requestAnimationFrame(this.loop);
  }

  mat(color, rough = 0.62, metal = 0.02) { return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }); }

  build() {
    const K = this.look;
    const skin = this.mat(K.skin, 0.55), top = this.mat(K.top, 0.75), bottom = this.mat(K.bottom, 0.8), hair = this.mat(K.hair, 0.5);
    const shoe = this.mat(0xf1f5f9, 0.5), sole = this.mat(0x334155, 0.9), dark = this.mat(0x1a1210, 0.4), white = this.mat(0xffffff, 0.3), lip = this.mat(0xb8574f, 0.5);
    const legMat = K.leggings ? bottom : skin;

    // δάπεδο + σκιά
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.7, 56), new THREE.MeshBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.2 }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.001; this.scene.add(disc);
    const shadowCatcher = new THREE.Mesh(new THREE.CircleGeometry(1.7, 40), new THREE.ShadowMaterial({ opacity: 0.28 }));
    shadowCatcher.rotation.x = -Math.PI / 2; shadowCatcher.position.y = 0.002; shadowCatcher.receiveShadow = true; this.scene.add(shadowCatcher);

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
    const w = this.container.clientWidth || 300, h = this.container.clientHeight || 300, wide = w / h >= 1.2;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h;
    this.camera.position.set(0, wide ? 1.15 : 1.25, wide ? 4.3 : 6.6); this.camera.lookAt(0, wide ? 0.8 : 0.95, 0);
    this.camera.updateProjectionMatrix();
  }

  // ---- ΕΛΕΓΧΟΣ ----
  setMotion(key) { this.motion = MOTIONS[key] || MOTIONS.generic; this.yawT = this.motion.yaw; }
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
    return p;
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
    this.renderer.render(this.scene, this.camera);
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
  debug(key, u, alt = false) { this.setMotion(key); this.yaw = this.yawT; this.mode = 'idle'; this.cur = this.pose(u, alt); this.apply(this.cur, this.motion); this.living(0.016); this.renderer.render(this.scene, this.camera); }

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
    cancelAnimationFrame(this.raf); this.ro.disconnect(); this.cancelPending();
    this.scene.traverse(o => { o.geometry?.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); });
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
