import * as THREE from './vendor/three.module.min.js';
import { MOTIONS, mirror } from './motions.js';

const L = { thigh: 0.45, shin: 0.43, upper: 0.30, fore: 0.27, ankle: 0.07 };
const KEYS = ['tx', 'hd', 'slx', 'slz', 'srx', 'srz', 'elL', 'elR', 'hlx', 'hlz', 'hrx', 'hrz', 'knL', 'knR', 'anL', 'anR', 'lift', 'rrx', 'rY', 'rZ'];
const STAND = Object.fromEntries(KEYS.map(k => [k, 0]));
const ease = u => 0.5 - 0.5 * Math.cos(Math.PI * 2 * u); // 0→1→0 σε έναν κύκλο

export function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

export class Avatar {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    container.append(this.renderer.domElement);
    this.renderer.domElement.style.cssText = 'width:100%;height:100%;display:block';
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    this.camera.position.set(0, 1.15, 4.3);
    this.camera.lookAt(0, 0.8, 0);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(2, 4, 3); this.scene.add(sun);
    this.build();
    this.cur = { ...STAND }; this.tgt = { ...STAND };
    this.motion = MOTIONS.squat; this.mode = 'idle'; this.t = 0; this.dur = 1; this.alt = false;
    this.yaw = 0.3; this.yawT = 0.3; this.paused = false; this.clock = new THREE.Clock(); this.time = 0;
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(container); this.resize();
    this.loop = this.loop.bind(this); this.raf = requestAnimationFrame(this.loop);
  }

  mat(color, rough = 0.7) { return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 }); }

  limb(parent, len, r, material) {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(len - 2 * r, 0.01), 6, 12), material);
    m.position.y = -len / 2; parent.add(m); return m;
  }

  build() {
    const skin = this.mat(0xf0c08f), shirt = this.mat(0x16a34a), shorts = this.mat(0x1e293b), shoe = this.mat(0xf8fafc), hair = this.mat(0x3b2f2f);
    // δάπεδο
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.7, 48), new THREE.MeshBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.22 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.001; this.scene.add(floor);
    this.figure = new THREE.Group(); this.scene.add(this.figure);
    this.hips = new THREE.Group(); this.figure.add(this.hips);
    const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), shorts); pelvis.scale.set(1.2, 0.8, 0.9); this.hips.add(pelvis);
    this.torso = new THREE.Group(); this.hips.add(this.torso);
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.24, 6, 14), shirt); chest.position.y = 0.27; chest.scale.set(1.3, 1, 0.8); this.torso.add(chest);
    this.headG = new THREE.Group(); this.headG.position.y = 0.56; this.torso.add(this.headG);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 16), skin); head.position.y = 0.1; this.headG.add(head);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.122, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair); cap.position.y = 0.11; cap.rotation.x = -0.35; this.headG.add(cap);
    for (const x of [-0.04, 0.04]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), this.mat(0x111111)); e.position.set(x, 0.11, 0.108); this.headG.add(e); }
    const mkArm = side => {
      const sh = new THREE.Group(); sh.position.set(side * 0.21, 0.47, 0); this.torso.add(sh);
      sh.add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), shirt));
      this.limb(sh, L.upper, 0.05, shirt);
      const el = new THREE.Group(); el.position.y = -L.upper; sh.add(el);
      this.limb(el, L.fore, 0.043, skin);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), skin); hand.position.y = -L.fore - 0.02; el.add(hand);
      return { sh, el };
    };
    const mkLeg = side => {
      const hp = new THREE.Group(); hp.position.set(side * 0.1, 0, 0); this.hips.add(hp);
      this.limb(hp, L.thigh, 0.075, shorts);
      const kn = new THREE.Group(); kn.position.y = -L.thigh; hp.add(kn);
      this.limb(kn, L.shin, 0.06, skin);
      const an = new THREE.Group(); an.position.y = -L.shin; kn.add(an);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.24), shoe); foot.position.set(0, -0.03, 0.06); an.add(foot);
      return { hp, kn, an };
    };
    this.aL = mkArm(-1); this.aR = mkArm(1); this.lL = mkLeg(-1); this.lR = mkLeg(1);
  }

  resize() {
    const w = this.container.clientWidth || 300, h = this.container.clientHeight || 300;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h;
    this.camera.position.z = w / h < 1.2 ? 6.6 : 4.3; this.camera.lookAt(0, w / h < 1.2 ? 0.95 : 0.8, 0); this.camera.updateProjectionMatrix();
  }

  // ---- ΕΛΕΓΧΟΣ ----
  setMotion(key) { this.motion = MOTIONS[key] || MOTIONS.generic; this.yawT = this.motion.yaw; }
  ready() { this.mode = 'ready'; this.cancelPending(); }
  idle() { this.mode = 'idle'; this.cancelPending(); }
  pause(on) { this.paused = on; }
  cancelPending() { if (this.resolve) { const r = this.resolve; this.resolve = null; r(false); } }
  cycle(dur, alt = false) { this.cancelPending(); this.mode = 'cycle'; this.t = 0; this.dur = dur; this.alt = alt; return new Promise(r => { this.resolve = r; }); }
  hold(sec) { this.cancelPending(); this.mode = 'hold'; this.t = 0; this.dur = sec; return new Promise(r => { this.resolve = r; }); }

  pose(u, alt) {
    const m = this.motion, B = alt && m.alt ? mirror(m.B) : m.B, A = alt && m.alt ? mirror(m.A) : m.A;
    const o = {}; for (const k of KEYS) o[k] = A[k] + (B[k] - A[k]) * u; return o;
  }

  targetPose() {
    const m = this.motion, breath = Math.sin(this.time * 1.8);
    let p;
    if (this.mode === 'cycle') p = this.pose(ease(Math.min(this.t / this.dur, 1)), this.alt);
    else if (this.mode === 'hold') { p = { ...m.B }; p.rY += breath * 0.004; }
    else if (this.mode === 'ready') p = { ...m.A };
    else p = { ...STAND, slx: 0.04, srx: 0.04, elL: -0.15, elR: -0.15, slz: -0.06, srz: 0.06 };
    if (this.mode !== 'cycle') p.tx += breath * 0.012;
    return p;
  }

  loop() {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (!this.paused) {
      this.time += dt;
      if (this.mode === 'cycle' || this.mode === 'hold') {
        this.t += dt;
        if (this.t >= this.dur && this.resolve) { const r = this.resolve; this.resolve = null; this.mode = 'ready'; r(true); }
      }
    }
    this.tgt = this.targetPose();
    const k = 1 - Math.exp(-dt * (this.mode === 'cycle' ? 30 : 9));
    for (const key of KEYS) this.cur[key] += (this.tgt[key] - this.cur[key]) * k;
    this.yaw += (this.yawT - this.yaw) * (1 - Math.exp(-dt * 4));
    this.apply(this.cur, this.motion);
    this.renderer.render(this.scene, this.camera);
  }

  /** Άμεση εφαρμογή πόζας (χρήσιμο για δοκιμές) */
  debug(key, u, alt = false) { this.setMotion(key); this.yaw = this.yawT; this.mode = 'idle'; this.cur = this.pose(u, alt); this.apply(this.cur, this.motion); this.renderer.render(this.scene, this.camera); }

  apply(p, m) {
    this.figure.rotation.y = this.yaw;
    this.torso.rotation.x = p.tx; this.headG.rotation.x = p.hd;
    this.aL.sh.rotation.set(p.slx, 0, p.slz); this.aR.sh.rotation.set(p.srx, 0, p.srz);
    this.aL.el.rotation.x = p.elL; this.aR.el.rotation.x = p.elR;
    this.lL.hp.rotation.set(p.hlx, 0, p.hlz); this.lR.hp.rotation.set(p.hrx, 0, p.hrz);
    this.lL.kn.rotation.x = p.knL; this.lR.kn.rotation.x = p.knR;
    this.lL.an.rotation.x = p.anL; this.lR.an.rotation.x = p.anR;
    this.hips.rotation.x = p.rrx;
    if (m.floor) { this.hips.position.set(0, p.rY, p.rZ); return; }
    // αυτόματη τοποθέτηση στο έδαφος από τις γωνίες των ποδιών
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
