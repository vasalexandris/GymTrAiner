// 3D Coach Avatar: σκηνή, 3-point φωτισμός στούντιο/σπιτιού, contact shadows,
// πολυφασική εκτέλεση κινήσεων με ακριβή χρονισμό (voice sync), zero-lag αναλυτικό 2-bone IK
// βαθμονομημένο στις πραγματικές διαστάσεις του μοντέλου, και ενοποίηση με SkinnedCoach & Equipment.
import * as THREE from './vendor/three.module.min.js';
import { RoomEnvironment } from './vendor/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from './vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from './vendor/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from './vendor/jsm/postprocessing/OutputPass.js';
import { MOTIONS, POSE_KEYS, mirror, sampleCycle } from './motions.js';
import { loadCoachModel } from './skinned.js';
import { Equipment, BARBELL_PLATE_R } from './equipment.js';
import { clamp, lerp, smootherstep, clampPose, spineDistribution, applyAxialTwist, solveTwoBoneIK, basisFromDirSec } from './ik.js';

const L = { thigh: 0.45, shin: 0.43, upper: 0.30, fore: 0.27, ankle: 0.07 };
const KEYS = POSE_KEYS;
const STAND = Object.fromEntries(KEYS.map(k => [k, 0]));

// Ρυθμός ακολουθίας ανά άρθρωση (τα άκρα καθυστερούν ελαφρά → φυσική αδράνεια)
const RATE = {
  tx: 24, ty: 22, tz: 22, hd: 12, hdY: 12, hdZ: 12,
  slx: 20, slz: 20, slY: 18, srx: 20, srz: 20, srY: 18,
  elL: 18, elR: 18, shL: 16, shR: 16,
  hlx: 28, hlz: 28, hlY: 22, hrx: 28, hrz: 28, hrY: 22,
  knL: 28, knR: 28, anL: 22, anR: 22,
  lift: 32, rrx: 28, rrz: 26, rX: 24, rY: 30, rZ: 30,
};

const PALM_TO_TWIST = { up: 1.45, fwd: -1.25, flat: -1.35, neutral: 0 };

const _Y = new THREE.Vector3(0, 1, 0);
const _Z = new THREE.Vector3(0, 0, 1);
const _X = new THREE.Vector3(1, 0, 0);
const _DOWN = new THREE.Vector3(0, -1, 0);

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
      for (let k = 0; k < 7; k++) {
        const yy = y + 5 + k * 9 + Math.sin(x + k) * 2;
        g.beginPath(); g.moveTo(x, yy); g.bezierCurveTo(x + w * 0.3, yy + 3, x + w * 0.6, yy - 3, x + w, yy + 1); g.stroke();
      }
      g.fillStyle = 'rgba(45,25,10,.5)'; g.fillRect(x, y, 2, 64); x += w;
    }
    g.fillStyle = 'rgba(45,25,10,.45)'; g.fillRect(0, y + 62, 512, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3.2, 3.2);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function radialAlpha() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 30, 128, 128, 128);
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.62, '#fff'); gr.addColorStop(1, '#000');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

/** Απαλός δίσκος σκιάς επαφής (contact shadow) για γείωση πελμάτων & σώματος */
function contactShadowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  gr.addColorStop(0.0, 'rgba(15,20,30,0.68)');
  gr.addColorStop(0.45, 'rgba(15,20,30,0.32)');
  gr.addColorStop(1.0, 'rgba(15,20,30,0.0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** Καμπύλο ενιαίο φόντο φωτογραφικού στούντιο (cyclorama) με απαλό gradient βάθους */
function cyclorama() {
  const W = 16, floorLen = 6.5, R = 1.8, wallH = 6, arc = Math.PI / 2 * R, total = floorLen + arc + wallH, z0 = 4.5;
  const g = new THREE.PlaneGeometry(W, total, 1, 90);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const colFloor = new THREE.Color(0xe4e8ef);
  const colCurve = new THREE.Color(0xd7dde7);
  const colWall  = new THREE.Color(0xcbd4e2);
  const tmpC = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), d = pos.getY(i) + total / 2;
    let y, z;
    if (d <= floorLen) {
      z = z0 - d; y = 0;
      tmpC.copy(colFloor).lerp(colCurve, clamp(d / floorLen, 0, 1) * 0.45);
    } else if (d <= floorLen + arc) {
      const a = (d - floorLen) / R;
      z = z0 - floorLen - Math.sin(a) * R; y = R - Math.cos(a) * R;
      tmpC.copy(colCurve).lerp(colWall, a / (Math.PI / 2) * 0.55);
    } else {
      z = z0 - floorLen - R; y = R + (d - floorLen - arc);
      tmpC.copy(colWall);
    }
    pos.setXYZ(i, x, y, z);
    colors[i * 3] = tmpC.r; colors[i * 3 + 1] = tmpC.g; colors[i * 3 + 2] = tmpC.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.92, metalness: 0,
    side: THREE.DoubleSide, envMapIntensity: 0.45,
  }));
  m.receiveShadow = true;
  return m;
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
function ball(r, material, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), material);
  m.scale.set(sx, sy, sz); m.castShadow = true; return m;
}

// Rest-basis για τον αόρατο/procedural proxy (όλα τα άκρα κατεβαίνουν κατά -Y με πρόσθιο άξονα +Z)
const PROXY_REST_INV = basisFromDirSec(new THREE.Vector3(0, -1, 0), _Z, new THREE.Quaternion()).invert();

export class Avatar {
  constructor(container, look = 'real', opts = {}) {
    this.container = container;
    this.lookKey = LOOKS[look] ? look : 'real';
    const L0 = LOOKS[this.lookKey];
    this.look = L0.proxy ? LOOKS[L0.proxy] : L0;
    this.envKind = opts.env || 'studio';
    this.quality = opts.quality || defaultQuality();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    const maxDpr = this.quality === 'high' ? 2 : 1.5;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, maxDpr));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = this.quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    container.append(this.renderer.domElement);
    this.renderer.domElement.style.cssText = 'width:100%;height:100%;display:block';

    this.scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    this.scene.environment = this.env;

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);

    // 3-point φωτισμός στούντιο / σπιτιού με σφιχτό shadow frustum για καθαρές σκιές
    const hemiGround = this.envKind === 'studio' ? 0x9aa4b2 : 0x9a7d60;
    this.scene.add(new THREE.HemisphereLight(0xf0f5ff, hemiGround, 0.52));

    const sun = new THREE.DirectionalLight(0xfff3e4, 2.25);
    sun.position.set(2.1, 4.2, 2.9);
    sun.castShadow = true;
    const smSize = this.quality === 'high' ? 2048 : 1024;
    sun.shadow.mapSize.set(smSize, smSize);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.018;
    sun.shadow.radius = this.quality === 'high' ? 4.5 : 2.5;
    Object.assign(sun.shadow.camera, { left: -1.85, right: 1.85, top: 2.5, bottom: -0.9, near: 0.8, far: 11 });
    this.scene.add(sun);

    const rim = new THREE.DirectionalLight(0xc2d8ff, 1.15);
    rim.position.set(-2.8, 2.7, -2.6);
    this.scene.add(rim);

    const fill = new THREE.DirectionalLight(0xe6f0ff, 0.55);
    fill.position.set(-2.5, 1.9, 2.4);
    this.scene.add(fill);

    this.build();

    if (this.quality === 'high') {
      const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(this.renderer, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.gtao = new GTAOPass(this.scene, this.camera, 1, 1);
      this.gtao.blendIntensity = 0.82;
      this.gtao.updateGtaoMaterial({ radius: 0.28, distanceExponent: 1.4, thickness: 1.15, scale: 1.2 });
      this.composer.addPass(this.gtao);
      this.composer.addPass(new OutputPass());
      if (this.envKind !== 'studio') this.scene.background = new THREE.Color(0xdfe8f4);
    }

    this.proxyMeshes = [];
    this.figure.traverse(o => { if (o.isMesh) this.proxyMeshes.push(o); });

    this.equip = new Equipment(this.scene);
    this.userEquip = {};
    this.equipKey = '';

    this.cur = { ...STAND };
    this.tgt = { ...STAND };
    this.motionKey = 'squat';
    this.motion = MOTIONS.squat;
    this.mode = 'idle';
    this.t = 0;
    this.dur = 1;
    this.alt = false;
    this.repCount = 0;
    this.repVar = { depth: 1, head: 0, sway: 0 };

    this.yaw = 0.3;
    this.yawT = 0.3;
    this.paused = false;
    this.clock = new THREE.Clock();
    this.time = 0;
    this.camD = 5;
    this.camY = 0.9;
    this.talkUntil = 0;
    this.nextBlink = 2;
    this.blink = 0;
    this.pt = { a: 0, v: 0, py: 0, pvy: 0 };
    this.tmpV = new THREE.Vector3();
    this._qTmp = new THREE.Quaternion();
    this._qTmp2 = new THREE.Quaternion();
    this._v1 = new THREE.Vector3();
    this._poseScratch = { ...STAND };

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);

    // Φόρτωση ρεαλιστικού Mixamo μοντέλου
    const src = L0.custom ? opts.customModel : L0.model;
    this.loaded = Promise.resolve(false);
    if (src) {
      const overlay = document.createElement('div');
      overlay.className = 'avatar-loading';
      overlay.textContent = '⏳ Ο coach ετοιμάζεται…';
      container.append(overlay);
      this.loaded = loadCoachModel(src, { quality: this.quality }).then(sc => {
        overlay.remove();
        if (this.disposed) return false;
        this.skinned = sc;
        this.scene.add(sc.root);
        this.k = sc.hipsRestY / (L.thigh + L.shin + L.ankle);
        this.proxyMeshes.forEach(m => { m.visible = false; });
        return true;
      }).catch(e => {
        overlay.remove();
        console.warn(e);
        opts.onError?.(e);
        return false;
      });
    }
  }

  mat(color, rough = 0.62, metal = 0.02) {
    return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  }

  build() {
    const K = this.look;
    const skin = this.mat(K.skin, 0.55), top = this.mat(K.top, 0.78), bottom = this.mat(K.bottom, 0.82), hair = this.mat(K.hair, 0.50);
    const shoe = this.mat(0xf1f5f9, 0.50), sole = this.mat(0x334155, 0.90), dark = this.mat(0x1a1210, 0.38), white = this.mat(0xffffff, 0.28), lip = this.mat(0xb8574f, 0.48);
    const legMat = K.leggings ? bottom : skin;

    if (this.envKind === 'studio') {
      this.scene.add(cyclorama());
    } else {
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(7.5, 7.5),
        new THREE.MeshStandardMaterial({
          color: 0xc2a88e, map: woodTexture(), alphaMap: radialAlpha(),
          transparent: true, roughness: 0.48, metalness: 0, envMapIntensity: 0.55,
        })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      this.scene.add(floor);
    }

    // Contact shadow decals (ελαφριά γείωση πελμάτων & σώματος σε high & normal)
    const csTex = contactShadowTexture();
    const mkShadow = (sx, sz) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(sx, sz),
        new THREE.MeshBasicMaterial({ map: csTex, transparent: true, opacity: 0.35, depthWrite: false })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.0025;
      m.renderOrder = 1;
      this.scene.add(m);
      return m;
    };
    this.cShadows = {
      footL: mkShadow(0.32, 0.42),
      footR: mkShadow(0.32, 0.42),
      body:  mkShadow(0.75, 0.95),
    };
    this.cShadows.body.material.opacity = 0;

    this.figure = new THREE.Group();
    this.figure.scale.setScalar(K.scale);
    this.scene.add(this.figure);
    this.sway = new THREE.Group();
    this.figure.add(this.sway);
    this.hips = new THREE.Group();
    this.sway.add(this.hips);

    const pelvis = ball(0.125, bottom, 1.12 * K.hip, 0.78, 0.84);
    pelvis.position.y = 0.03;
    this.hips.add(pelvis);

    this.abdomen = new THREE.Group();
    this.hips.add(this.abdomen);
    const abd = lathe([[0.0, 0.135 * K.hip], [0.11, 0.118 * K.waist], [0.23, 0.128 * K.waist]], top);
    abd.scale.z = 0.74;
    this.abdomen.add(abd);

    this.chest = new THREE.Group();
    this.chest.position.y = 0.22;
    this.abdomen.add(this.chest);
    const ch = lathe([[0.0, 0.128 * K.waist], [0.1, 0.155 * K.shoulder], [0.2, 0.172 * K.shoulder], [0.27, 0.15 * K.shoulder], [0.305, 0.075], [0.318, 0.0]], top);
    ch.scale.z = 0.72;
    this.chest.add(ch);
    const neck = lathe([[0.27, 0.05], [0.33, 0.042], [0.4, 0.04]], skin, 14);
    this.chest.add(neck);

    this.headG = new THREE.Group();
    this.headG.position.y = 0.34;
    this.chest.add(this.headG);
    const head = lathe([[0.005, 0.03], [0.03, 0.068], [0.07, 0.097], [0.125, 0.108], [0.18, 0.103], [0.225, 0.074], [0.248, 0.032], [0.255, 0.0]], skin, 28);
    head.scale.set(0.93, 1, 1.04);
    this.headG.add(head);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.017, 0.04, 10), skin);
    nose.rotation.x = Math.PI / 2; nose.position.set(0, 0.112, 0.112); nose.castShadow = true;
    this.headG.add(nose);
    for (const s of [-1, 1]) {
      const ear = ball(0.02, skin, 0.5, 1, 0.9); ear.position.set(s * 0.098, 0.125, -0.005); this.headG.add(ear);
      const eyeW = ball(0.02, white, 1, 0.75, 0.5); eyeW.position.set(s * 0.04, 0.142, 0.097); eyeW.name = 'eye';
      const iris = ball(0.011, dark); iris.position.set(0, 0, 0.012); eyeW.add(iris); this.headG.add(eyeW);
      const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.005, 0.034, 3, 6), hair);
      brow.rotation.z = Math.PI / 2 - s * 0.12; brow.position.set(s * 0.042, 0.172, 0.1); this.headG.add(brow);
    }
    this.mouth = new THREE.Group();
    this.mouth.position.set(0, 0.072, 0.1);
    this.headG.add(this.mouth);
    this.mouth.add(ball(0.02, lip, 1.5, 0.35, 0.45));
    const inner = ball(0.014, dark, 1.2, 0.3, 0.3); inner.position.z = 0.006; inner.name = 'inner';
    this.mouth.add(inner);

    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.114, 24, 14, 0, Math.PI * 2, 0, Math.PI * (K.ponytail ? 0.56 : 0.5)), hair);
    cap.position.set(0, 0.145, -0.012); cap.rotation.x = -0.5; cap.scale.set(1.0, 1.05, 1.04); cap.castShadow = true;
    this.headG.add(cap);
    const back = ball(0.108, hair, 0.98, 0.9, 0.8); back.position.set(0, 0.16, -0.03);
    this.headG.add(back);
    if (K.ponytail) {
      this.tail = new THREE.Group(); this.tail.position.set(0, 0.2, -0.1); this.headG.add(this.tail);
      this.tail.add(ball(0.026, this.mat(0xef4444), 1, 0.7, 1));
      const hairTail = lathe([[-0.26, 0.004], [-0.17, 0.03], [-0.07, 0.034], [0.0, 0.022]], hair, 12);
      this.tail.add(hairTail);
    }

    const mkArm = side => {
      const sh = new THREE.Group(); sh.position.set(side * 0.205 * K.shoulder, 0.25, 0); this.chest.add(sh);
      sh.add(ball(0.055, top, 1, 1.05, 1));
      sh.add(lathe([[-L.upper, 0.04], [-L.upper * 0.62, 0.05], [-L.upper * 0.2, 0.055], [0.0, 0.05]], skin, 16));
      sh.add(lathe([[-L.upper * 0.5, 0.056], [-L.upper * 0.22, 0.06], [0.0, 0.056]], top, 16));
      const el = new THREE.Group(); el.position.y = -L.upper; sh.add(el);
      el.add(ball(0.04, skin));
      el.add(lathe([[-L.fore, 0.032], [-L.fore * 0.55, 0.04], [-L.fore * 0.1, 0.042], [0.0, 0.04]], skin, 16));
      const hand = new THREE.Group(); hand.position.y = -L.fore - 0.04; el.add(hand);
      hand.add(ball(0.04, skin, 0.95, 1.25, 0.55));
      const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.034, 3, 6), skin);
      thumb.position.set(-side * 0.03, 0.018, 0.012); thumb.rotation.z = side * 0.5; thumb.castShadow = true;
      hand.add(thumb);
      return { sh, el, hand };
    };

    const mkLeg = side => {
      const hp = new THREE.Group(); hp.position.set(side * 0.1 * K.hip, 0, 0); this.hips.add(hp);
      hp.add(lathe([[-L.thigh, 0.058], [-L.thigh * 0.55, 0.075], [-L.thigh * 0.15, 0.086], [0.0, 0.08]], legMat, 18));
      if (!K.leggings) hp.add(lathe([[-L.thigh * 0.5, 0.082], [-L.thigh * 0.2, 0.09], [0.0, 0.086]], bottom, 18));
      const kn = new THREE.Group(); kn.position.y = -L.thigh; hp.add(kn);
      kn.add(ball(0.058, legMat));
      kn.add(lathe([[-L.shin, 0.042], [-L.shin * 0.7, 0.048], [-L.shin * 0.72, 0.056], [-L.shin * 0.2, 0.05], [0.0, 0.056]], legMat, 16));
      const an = new THREE.Group(); an.position.y = -L.shin; kn.add(an);
      const shoeB = ball(0.052, shoe, 1, 0.78, 2.35); shoeB.position.set(0, -0.026, 0.055); an.add(shoeB);
      const sl = new THREE.Mesh(new THREE.BoxGeometry(0.098, 0.016, 0.255), sole);
      sl.position.set(0, -0.062, 0.05); sl.castShadow = true; an.add(sl);
      return { hp, kn, an };
    };

    this.aL = mkArm(-1); this.aR = mkArm(1);
    this.lL = mkLeg(-1); this.lR = mkLeg(1);
  }

  resize() {
    const w = this.container.clientWidth || 300, h = this.container.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  }

  draw() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Κάδρωση: απόσταση κάμερας ώστε ο coach να γεμίζει την οθόνη ανάλογα με την κίνηση */
  frame() {
    const m = this.motion;
    const f = m.frame || (m.floor ? { h: 1.75, w: 2.55, cy: 0.38 } : { h: 2.30, w: 1.65, cy: 0.78 });
    const vf = THREE.MathUtils.degToRad(this.camera.fov);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * this.camera.aspect);
    return { d: Math.max((f.h / 2) / Math.tan(vf / 2), (f.w / 2) / Math.tan(hf / 2)), cy: f.cy };
  }

  /** Συγχώνευση εξοπλισμού χρήστη με απαραίτητα props της τρέχουσας άσκησης */
  _syncEquipment() {
    const e = { ...this.userEquip };
    const mk = this.motionKey;
    const prop = this.motion?.ik?.prop;
    if (prop === 'bench') e.bench = true;
    if (prop === 'step') e.step = true;
    if (prop === 'wall') e.wall = true;
    if ((mk === 'deadlift' || mk === 'back_squat' || mk === 'barbell_row') && !e.dumbbells && !e.kettlebell) e.barbell = true;
    if (mk === 'band_pull_apart') e.band = true;
    if (mk === 'incline_row' || mk === 'trx_squat' || mk === 'trx_chest_press') e.straps = true;
    const key = JSON.stringify(e);
    if (key !== this.equipKey) {
      this.equipKey = key;
      this.equip.set(e);
    }
  }

  // ---- ΔΗΜΟΣΙΟ API (ΔΙΑΤΗΡΕΙΤΑΙ ΑΜΕΤΑΒΛΗΤΟ) ----
  setMotion(key) {
    this.motionKey = MOTIONS[key] ? key : 'generic';
    this.motion = MOTIONS[this.motionKey];
    this.yawT = this.motion.yaw;
    this._syncEquipment();
  }
  setEquipment(e) {
    this.userEquip = { ...(e || {}) };
    this._syncEquipment();
  }
  ready() { this.mode = 'ready'; this.cancelPending(); }
  idle() { this.mode = 'idle'; this.cancelPending(); }
  pause(on) { this.paused = on; }
  talkFor(ms) { this.talkUntil = performance.now() + ms; }
  cancelPending() { if (this.resolve) { const r = this.resolve; this.resolve = null; r(false); } }

  cycle(dur, alt = false) {
    this.cancelPending();
    this.mode = 'cycle';
    this.t = 0;
    this.dur = dur;
    this.alt = alt;
    this.repCount++;
    const s = Math.sin(this.repCount * 2.17);
    this.repVar = { depth: 1 + s * 0.014, head: Math.cos(this.repCount * 1.63) * 0.015, sway: s * 0.008 };
    return new Promise(r => { this.resolve = r; });
  }

  hold(sec) {
    this.cancelPending();
    this.mode = 'hold';
    this.t = 0;
    this.dur = sec;
    return new Promise(r => { this.resolve = r; });
  }

  progress(t01) {
    const [a, h, b] = this.motion.prof || [0.5, 0, 0.5];
    if (t01 < a) return smootherstep(t01 / Math.max(a, 1e-6));
    if (t01 < a + h) return 1;
    return 1 - smootherstep(Math.min((t01 - a - h) / Math.max(b, 1e-6), 1));
  }

  pose(u, alt) {
    const m = this.motion;
    const A = alt && m.alt ? mirror(m.A) : m.A;
    const B = alt && m.alt ? mirror(m.B) : m.B;
    const o = {};
    for (let i = 0; i < KEYS.length; i++) {
      const k = KEYS[i];
      o[k] = (A[k] || 0) + ((B[k] || 0) - (A[k] || 0)) * u;
    }
    return clampPose(o);
  }

  targetPose() {
    const m = this.motion;
    const breath = Math.sin(this.time * 1.85);
    let p;

    if (this.mode === 'cycle') {
      const t01 = clamp(this.t / Math.max(this.dur, 1e-4), 0, 1);
      p = sampleCycle(m, t01, this.alt, { ...this._poseScratch });
      const phaseBreath = Math.sin(t01 * Math.PI * 2) * 0.010;
      p.tx = (p.tx || 0) * this.repVar.depth + phaseBreath;
      p.hd = (p.hd || 0) + this.repVar.head;
      p.rX = (p.rX || 0) + this.repVar.sway * Math.sin(t01 * Math.PI);
    } else if (this.mode === 'hold') {
      p = { ...m.B };
      p.rY = (p.rY || 0) + breath * 0.004;
      p.tx = (p.tx || 0) + breath * 0.010;
      p.shL = (p.shL || 0) + breath * 0.004;
      p.shR = (p.shR || 0) + breath * 0.004;
    } else if (this.mode === 'ready') {
      p = { ...m.A };
      p.tx = (p.tx || 0) + breath * 0.012;
      p.slx = (p.slx || 0) + breath * 0.010;
      p.srx = (p.srx || 0) + breath * 0.010;
    } else {
      const shift = Math.sin(this.time * 0.55) * 0.014;
      p = {
        ...STAND,
        tx: 0.02 + breath * 0.012,
        slx: 0.04 + breath * 0.010, srx: 0.04 + breath * 0.010,
        elL: -0.22, elR: -0.22,
        slz: -0.08, srz: 0.08,
        hlx: -0.03, hrx: -0.03,
        knL: 0.06, knR: 0.06,
        hlz: -0.03, hrz: 0.03,
        rX: shift,
      };
    }

    if (this.mode !== 'idle') this.equipPose(p);
    else {
      const e = this.equip?.e || {};
      if (e.kettlebell || e.goblet) {
        p.slx = p.srx = -0.32; p.slz = 0.30; p.srz = -0.30; p.elL = p.elR = -0.45;
      }
    }
    return clampPose(p);
  }

  /** Προσαρμογή χεριών στον εξοπλισμό (goblet, αλτήρες, μπάρα, λάστιχο) */
  equipPose(p) {
    const e = this.equip?.e || {}, m = this.motion, M2 = MOTIONS;
    const legsMove = m === M2.squat || m === M2.lunge || m === M2.reverse_lunge || m === M2.step_up || m === M2.calf_raise;
    if ((e.kettlebell || e.goblet) && legsMove) {
      p.slx = p.srx = -0.34 - p.tx; p.elL = p.elR = -2.28; p.slz = 0.32; p.srz = -0.32;
    } else if (e.dumbbells && legsMove) {
      p.slx = p.srx = -p.tx; p.elL = p.elR = -0.14; p.slz = -0.12; p.srz = 0.12;
    } else if (e.barbell && (m === M2.squat || m === M2.lunge || m === M2.reverse_lunge)) {
      p.slx = p.srx = -1.45 - p.tx; p.slz = -0.34; p.srz = 0.34; p.elL = p.elR = -2.55;
    } else if (e.kettlebell && m === M2.hinge) {
      p.slz = 0.22; p.srz = -0.22;
    } else if (e.band && m === M2.squat) {
      p.slx = p.srx = -0.52 - p.tx; p.elL = p.elR = -2.18;
    }
  }

  loop() {
    this.raf = requestAnimationFrame(this.loop);
    const real = this.clock.getDelta();
    const dt = Math.min(real, 0.1);
    if (!this.paused) {
      this.time += real;
      if (this.mode === 'cycle' || this.mode === 'hold') {
        this.t += real;
        if (this.t >= this.dur && this.resolve) {
          const r = this.resolve;
          this.resolve = null;
          this.mode = 'ready';
          r(true);
        }
      }
    }

    this.tgt = this.targetPose();
    const fast = this.mode === 'cycle';
    for (let i = 0; i < KEYS.length; i++) {
      const key = KEYS[i];
      this.cur[key] += (this.tgt[key] - this.cur[key]) * (1 - Math.exp(-dt * (fast ? RATE[key] : 7.5)));
    }
    this.yaw += (this.yawT - this.yaw) * (1 - Math.exp(-dt * 4));
    this.apply(this.cur, this.motion);
    this.living(dt);
    this.post(dt);

    const fr = this.frame(), kc = 1 - Math.exp(-dt * 2.5);
    this.camD += (fr.d - this.camD) * kc;
    this.camY += (fr.cy - this.camY) * kc;
    this.camera.position.set(0, this.camY + this.camD * 0.1, this.camD);
    this.camera.lookAt(0, this.camY, 0);
    this.draw();
  }

  /**
   * Zero-lag επίλυση στόχων 2-Bone IK βαθμονομημένη στις ΠΡΑΓΜΑΤΙΚΕΣ διαστάσεις
   * του φορτωμένου Mixamo μοντέλου (`sk.dims`) ή του proxy (`L`).
   * Καλείται ΜΕΣΑ στη `SkinnedCoach.drive()` αμέσως αφού έχει τοποθετηθεί ο κορμός
   * του τρέχοντος καρέ, ώστε να μην υπάρχει καμία καθυστέρηση καρέ ή απόκλιση αναλογιών.
   */
  _resolveIK(sk, m, cur, wp, ax, chestUp, chestFwd) {
    const ikSpec = m.ik || {};
    const e = this.equip?.e || {};
    const S = this.look.scale;
    const dims = sk ? sk.dims : {
      lenUpLegL: L.thigh * S, lenLegL: L.shin * S,
      lenUpLegR: L.thigh * S, lenLegR: L.shin * S,
      lenArmL: L.upper * S, lenForeL: L.fore * S,
      lenArmR: L.upper * S, lenForeR: L.fore * S,
      torsoLen: 0.47 * S, palmLen: 0.06 * S,
      footHeight: L.ankle * S, toeHeight: 0.025 * S, toeFwd: 0.13 * S,
      hipHalfW: 0.10 * this.look.hip * S, shoulderHalfW: 0.205 * this.look.shoulder * S,
    };

    const armReach = (dims.lenArmL + dims.lenForeL + dims.lenArmR + dims.lenForeR) * 0.5;
    const legReach = (dims.lenUpLegL + dims.lenLegL + dims.lenUpLegR + dims.lenLegR) * 0.5;
    const torsoLen = dims.torsoLen;
    const shHalfW = dims.shoulderHalfW;
    const palmLen = dims.palmLen;
    const kScale = sk ? this.k : 1;

    const yaw = this.yaw;
    const rotY = (x, y, z) => new THREE.Vector3(x, y, z).applyAxisAngle(_Y, yaw);
    const dirY = (x, y, z) => new THREE.Vector3(x, y, z).applyAxisAngle(_Y, yaw).normalize();
    const fwdW = dirY(0, 0, 1);
    const rightW = dirY(1, 0, 0); // +X = αριστερά του χαρακτήρα

    const legs = {};
    const arms = {};
    let hipsPos = null;
    let groundLock = 'auto';

    const meta = {
      barPos: null, barAxis: null, barPad: false,
      bandMode: ikSpec.hands === 'band_pull' ? 'pull_apart' : 'loop',
      trxAnchor: null, benchZ: -0.40, stepZ: 0.42, wallZ: -0.22,
    };

    if (this.mode === 'idle') {
      const hw = Math.max(dims.hipHalfW + 0.025, 0.12);
      for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
        const toeAng = sgn * 0.12;
        const fDir = dirY(Math.sin(toeAng), 0, Math.cos(toeAng));
        const target = rotY(sgn * hw, dims.footHeight, 0);
        const pole = target.clone().addScaledVector(fDir, 0.55).addScaledVector(_Y, 0.35);
        legs[Side] = { target, pole, mode: 'flat', footDir: fDir, pin: true };
      }
      return { legs, arms, hipsPos, groundLock: 'ik', meta };
    }

    const feetMode = ikSpec.feet || 'free';
    const handsMode = ikSpec.hands || 'free';
    const stanceHalf = Math.max(dims.hipHalfW + 0.015, (ikSpec.stanceW || 0.26) * 0.5);
    const toeOut = ikSpec.toeOut || 0.10;
    const flare = ikSpec.elbowFlare ?? 0.35;
    const fTwist = ikSpec.forearmTwist ?? PALM_TO_TWIST[m.palm] ?? 0;

    // ---- 0. ΑΥΤΟ-ΒΑΘΜΟΝΟΜΗΣΗ ΠΥΕΛΟΥ ΓΙΑ ΚΡΙΣΙΜΕΣ ΕΠΑΦΕΣ (PLANK/PUSHUP/DIP/BIRD-DOG/WALL-SIT/SIDE-PLANK) ----
    let plankToeZ = -0.76;
    let plankHandZ = 0.46;
    const isPlankLike = handsMode === 'floor' || (handsMode === 'floor_burpee' && cur.rrx > 0.72);

    if (isPlankLike) {
      // Άκαμπτη ευθεία σανίδας (τεντωμένα πόδια 99.3% → μηδενικό λύγισμα γονάτων στο στρώμα)
      // που περιστρέφεται ακριβώς γύρω από τις καρφωμένες μύτες των ποδιών!
      const rrxTop = 1.26;
      const dxHand = ikSpec.handExtraW ?? 0.08;
      // Πυθαγόρειος υπολογισμός μέγιστου κάθετου ύψους ώμου λαμβάνοντας υπόψη το πλάτος παλαμών (dxHand)
      const maxVertArm = Math.sqrt(Math.max(0.08, (armReach * 0.92) ** 2 - dxHand * dxHand));
      const maxShY = maxVertArm + 0.032;
      const hipsYTop = Math.max(0.28, maxShY - torsoLen * Math.cos(rrxTop));
      const ankleY = dims.toeHeight + 0.105;
      const legSpan = legReach * 0.975; // ευθεία γραμμή σώματος, με περιθώριο κάτω από το όριο IK (0.99)
      const dHTop = Math.max(0.04, hipsYTop - ankleY);
      const horizTop = Math.sqrt(Math.max(0.25, legSpan * legSpan - dHTop * dHTop));
      plankToeZ = -horizTop * 0.80 - 0.065;
      const hipsZTop = (plankToeZ + 0.065) + horizTop;
      // Καρφωμένη θέση παλάμης ακριβώς κάτω από τους ώμους στην κορυφή — ΜΗΔΕΝ γλίστρημα σε όλη την επανάληψη!
      plankHandZ = hipsZTop + torsoLen * Math.sin(rrxTop) + 0.015;

      const drop01 = clamp((cur.rrx - rrxTop) / 0.23, 0, 1);
      const hipsYCur = lerp(hipsYTop, 0.21, drop01);
      const dHCur = Math.max(0.02, hipsYCur - ankleY);
      const hipsZCur = (plankToeZ + 0.065) + Math.sqrt(Math.max(0.25, legSpan * legSpan - dHCur * dHCur));
      hipsPos = rotY(cur.rX || 0, hipsYCur, hipsZCur);
      // Τα πόδια ξεκινούν από την άρθρωση του μηρού (UpLeg), ~10cm πιο κοντά στα πέλματα από το κέντρο της λεκάνης (Hips):
      // μετακινούμε τις μύτες ισόποσα πίσω ώστε τα πόδια να μένουν τεντωμένα (αλλιώς τα γόνατα έπεφταν στο στρώμα).
      const hipJoint = this.skinned ? this.skinned.rest.Hips.pos.distanceTo(this.skinned.rest.LeftUpLeg.pos) : 0.08;
      plankToeZ -= hipJoint * 0.92;
    } else if (handsMode === 'bird_dog') {
      // Τετραποδική στάση: ύψος πυέλου ίσο με το ελάχιστο μεταξύ μήκους μηρού και χεριού
      const tableY = Math.min(dims.lenUpLegL + 0.055, armReach * 0.88 + 0.030);
      plankHandZ = torsoLen * Math.sin(1.40) + 0.02;
      hipsPos = rotY(cur.rX || 0, tableY, 0);
    } else if (handsMode === 'chair_dip') {
      const benchH = 0.45;
      const topY = Math.max(0.36, benchH + armReach * 0.87 - torsoLen);
      const botY = Math.max(0.18, topY - Math.min(0.21, armReach * 0.42));
      const uDip = clamp((0.42 - (cur.rY || 0.42)) / 0.20, 0, 1);
      hipsPos = rotY(cur.rX || 0, lerp(topY, botY, uDip), 0.02 + uDip * 0.02);
    } else if (feetMode === 'wall_sit') {
      meta.wallZ = -0.22;
      hipsPos = rotY(0, dims.footHeight + dims.lenLegL * 0.96, -0.10);
    } else if (feetMode === 'side_plank') {
      // Ευθεία πλάγια σανίδα (~79° από την κατακόρυφο): κάτω ώμος σε ύψος 0.042 + lenArm, κάτω πέλμα στο έδαφος
      groundLock = 'ik';
      const theta = cur.rrz || 1.38;
      const shH = 0.042 + dims.lenArmR * 0.92;
      const hipYFromArm = shH - torsoLen * Math.cos(theta) + shHalfW * Math.sin(theta);
      const hipYFromLeg = 0.055 + legReach * Math.cos(theta) + dims.hipHalfW * Math.sin(theta);
      hipsPos = rotY(0, Math.max(0.28, Math.min(hipYFromArm, hipYFromLeg)), 0);
    } else if (handsMode === 'deadlift_bar') {
      // Αυτο-βαθμονόμηση ύψους πυέλου στις άρσεις θανάτου ώστε οι δίσκοι (r=0.225m)
      // να ακουμπούν ακριβώς στο πάτωμα στην εκκίνηση, ανεξαρτήτως μήκους χεριών του μοντέλου!
      const dl01 = clamp(cur.rrx / 1.06, 0, 1);
      if (dl01 > 0.02) {
        const torsoAng = (cur.rrx || 0) + (cur.tx || 0) * 0.85;
        const standY = sk ? sk.hipsRestY : (L.thigh + L.shin + L.ankle) * S;
        const needShY = BARBELL_PLATE_R + armReach * 0.94 + palmLen * 0.85;
        const botHipY = clamp(needShY - torsoLen * Math.cos(torsoAng), dims.footHeight + 0.34, standY - 0.15);
        const curHipY = lerp(standY, botHipY, dl01);
        const curHipZ = lerp(0, -0.24, dl01);
        hipsPos = rotY(cur.rX || 0, curHipY, curHipZ);
      }
    } else if (feetMode === 'split' || feetMode === 'reverse_lunge') {
      // Ακριβές βάθος 90°/90° προβολής βαθμονομημένο στο πραγματικό μήκος κνήμης
      const splitAmt = clamp(Math.abs(cur.hlx - cur.hrx) / 1.55, 0, 1);
      const standY = sk ? sk.hipsRestY : (L.thigh + L.shin + L.ankle) * S;
      const lowY = dims.footHeight + dims.lenLegL + 0.055;
      const yCur = lerp(standY, lowY, smootherstep(splitAmt));
      const zCur = feetMode === 'reverse_lunge'
        ? lerp(0.16, -0.20, splitAmt)
        : lerp(0.00, 0.06, splitAmt);
      hipsPos = rotY(cur.rX || 0, yCur, zCur);
    }

    // ---- 1. IK ΠΟΔΙΩΝ (ΚΑΡΦΩΜΕΝΑ ΠΕΛΜΑΤΑ & ΓΟΝΑΤΑ ΠΑΝΩ ΑΠΟ ΤΑ ΔΑΧΤΥΛΑ) ----
    let footZ = ikSpec.footZ || 0;
    if (feetMode === 'wall_sit') footZ = -0.10 + dims.lenUpLegL * 0.96;
    else if (feetMode === 'bridge') footZ = (cur.rZ || 0.06) + legReach * 0.56;
    else if (feetMode === 'hip_thrust') footZ = 0.14 + dims.lenUpLegL * 1.02;

    if (feetMode === 'planted' || feetMode === 'wall_sit' || feetMode === 'bridge' || feetMode === 'hip_thrust') {
      groundLock = 'ik';
      for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
        const ang = sgn * toeOut;
        const fDir = dirY(Math.sin(ang), 0, Math.cos(ang));
        const target = rotY(sgn * stanceHalf, dims.footHeight, footZ);
        const poleY = (feetMode === 'bridge' || feetMode === 'hip_thrust') ? 0.74 : 0.38;
        const poleFwd = (feetMode === 'bridge' || feetMode === 'hip_thrust') ? 0.15 : 0.62;
        const pole = target.clone().addScaledVector(fDir, poleFwd).addScaledVector(_Y, poleY);
        legs[Side] = { target, pole, mode: 'flat', footDir: fDir, pin: true };
      }
    } else if (feetMode === 'toe_raise') {
      groundLock = 'ik';
      const liftH = Math.max(0, cur.lift * kScale);
      for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
        const ang = sgn * toeOut;
        const fDir = dirY(Math.sin(ang), 0, Math.cos(ang));
        const toePos = rotY(sgn * stanceHalf, dims.toeHeight, footZ + dims.toeFwd);
        const target = rotY(sgn * stanceHalf, dims.footHeight + liftH * 0.88, footZ + liftH * 0.12);
        const pole = target.clone().addScaledVector(fDir, 0.55).addScaledVector(_Y, 0.38);
        legs[Side] = { target, pole, mode: liftH > 0.01 ? 'toe' : 'flat', footDir: fDir, toePos, pin: true };
      }
    } else if (feetMode === 'toe') {
      groundLock = 'ik';
      const tz = isPlankLike ? plankToeZ : (ikSpec.footZ || -0.56);
      for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
        const toePos = rotY(sgn * stanceHalf, dims.toeHeight, tz);
        const target = rotY(sgn * stanceHalf, dims.toeHeight + 0.105, tz + 0.065);
        const isProne = cur.rrx > 0.7;
        const pole = rotY(sgn * stanceHalf, isProne ? 0.05 : 0.45, tz + 0.45);
        legs[Side] = { target, pole, mode: 'toe', footDir: fwdW, toePos, footUp: _Y, pin: true };
      }
    } else if (feetMode === 'mountain_climber') {
      groundLock = 'ik';
      const pinRight = cur.knL < cur.knR; // lL = Right, lR = Left
      const pinSide = pinRight ? 'Right' : 'Left';
      const sgn = pinSide === 'Left' ? 1 : -1;
      const toePos = rotY(sgn * stanceHalf, dims.toeHeight, plankToeZ);
      const target = rotY(sgn * stanceHalf, dims.toeHeight + 0.105, plankToeZ + 0.065);
      const pole = rotY(sgn * stanceHalf, 0.05, plankToeZ + 0.45);
      legs[pinSide] = { target, pole, mode: 'toe', footDir: fwdW, toePos, footUp: _Y, pin: true };
    } else if (feetMode === 'split' || feetMode === 'reverse_lunge') {
      groundLock = 'ik';
      const frontIsRight = cur.hlx <= cur.hrx;
      const splitAmt = clamp(Math.abs(cur.hlx - cur.hrx) / 1.55, 0, 1);
      // Παραβολικό τόξο ανύψωσης κατά το βήμα ώστε το πόδι να μην σέρνεται στο πάτωμα!
      const stepPhase = clamp(splitAmt * 2.2, 0, 1);
      const liftArc = splitAmt > 0.04 && splitAmt < 0.55 ? Math.sin(stepPhase * Math.PI) * 0.075 : 0;

      for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
        const isFront = (Side === 'Right') === frontIsRight;
        const fDir = dirY(Math.sin(sgn * 0.05), 0, Math.cos(0.05));
        if (feetMode === 'reverse_lunge') {
          if (isFront) {
            // Μπροστινό πέλμα 100% ΚΑΡΦΩΜΕΝΟ στο έδαφος σε όλη την επανάληψη
            const target = rotY(sgn * stanceHalf, dims.footHeight, 0.16);
            const pole = target.clone().addScaledVector(fDir, 0.60).addScaledVector(_Y, 0.36);
            legs[Side] = { target, pole, mode: 'flat', footDir: fDir, pin: true };
          } else {
            const backZ = lerp(0.16, -0.58, smootherstep(clamp(splitAmt * 1.45, 0, 1)));
            const isPlanted = splitAmt < 0.05 || splitAmt > 0.48;
            const toePos = rotY(sgn * stanceHalf, dims.toeHeight + liftArc, backZ + dims.toeFwd * (1 - splitAmt * 0.45));
            const target = rotY(sgn * stanceHalf, dims.footHeight + splitAmt * 0.075 + liftArc, backZ);
            const pole = target.clone().addScaledVector(fDir, 0.45).addScaledVector(_Y, 0.18);
            legs[Side] = { target, pole, mode: splitAmt > 0.22 ? 'toe' : 'flat', footDir: fDir, toePos, pin: isPlanted };
          }
        } else {
          // Μπροστινή προβολή: πίσω πέλμα καρφωμένο, μπροστινό σηκώνεται σε τόξο και πατάει σταθερά
          if (isFront) {
            const fwdZ = lerp(0.0, 0.44, smootherstep(clamp(splitAmt * 1.45, 0, 1)));
            const isPlanted = splitAmt < 0.05 || splitAmt > 0.48;
            const target = rotY(sgn * stanceHalf, dims.footHeight + liftArc, fwdZ);
            const pole = target.clone().addScaledVector(fDir, 0.60).addScaledVector(_Y, 0.36);
            legs[Side] = { target, pole, mode: 'flat', footDir: fDir, pin: isPlanted };
          } else {
            const backZ = lerp(0.0, -0.34, smootherstep(clamp(splitAmt * 1.3, 0, 1)));
            const toePos = rotY(sgn * stanceHalf, dims.toeHeight, backZ + dims.toeFwd * (1 - splitAmt * 0.45));
            const target = rotY(sgn * stanceHalf, dims.footHeight + splitAmt * 0.075, backZ);
            const pole = target.clone().addScaledVector(fDir, 0.45).addScaledVector(_Y, 0.18);
            legs[Side] = { target, pole, mode: splitAmt > 0.22 ? 'toe' : 'flat', footDir: fDir, toePos, pin: true };
          }
        }
      }
    } else if (feetMode === 'step_up') {
      groundLock = 'ik';
      meta.stepZ = 0.42;
      const stepH = 0.34;
      const leadIsRight = cur.hlx <= cur.hrx;
      const prog = clamp((cur.rZ + 0.10) / 0.50, 0, 1);
      const onStep = prog > 0.22 || cur.rY > 0.04;
      for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
        const isLead = (Side === 'Right') === leadIsRight;
        const fDir = dirY(Math.sin(sgn * 0.05), 0, Math.cos(0.05));
        if (isLead && onStep) {
          // Ομαλό τόξο ανόδου πάνω από το χείλος του κουτιού πριν το πάτημα
          const plantBlend = clamp((prog - 0.18) / 0.24, 0, 1);
          const clearArc = plantBlend < 1 ? Math.sin(plantBlend * Math.PI) * 0.08 : 0;
          const target = rotY(
            sgn * stanceHalf,
            lerp(dims.footHeight, stepH + dims.footHeight, smootherstep(plantBlend)) + clearArc,
            lerp(-0.10, 0.40, smootherstep(plantBlend))
          );
          const pole = target.clone().addScaledVector(fDir, 0.56).addScaledVector(_Y, 0.36);
          legs[Side] = { target, pole, mode: 'flat', footDir: fDir, pin: plantBlend >= 0.95 };
        } else if (!onStep) {
          const target = rotY(sgn * stanceHalf, dims.footHeight, -0.10);
          const pole = target.clone().addScaledVector(fDir, 0.56).addScaledVector(_Y, 0.36);
          legs[Side] = { target, pole, mode: 'flat', footDir: fDir, pin: true };
        }
      }
    } else if (feetMode === 'burpee') {
      if (cur.lift < 0.04 && cur.rrx < 0.38) {
        groundLock = 'ik';
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const fDir = dirY(Math.sin(sgn * 0.14), 0, Math.cos(0.14));
          const target = rotY(sgn * stanceHalf, dims.footHeight, 0);
          const pole = target.clone().addScaledVector(fDir, 0.58).addScaledVector(_Y, 0.36);
          legs[Side] = { target, pole, mode: 'flat', footDir: fDir, pin: true };
        }
      } else if (cur.rrx > 0.72) {
        groundLock = 'ik';
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const toePos = rotY(sgn * stanceHalf, dims.toeHeight, plankToeZ);
          const target = rotY(sgn * stanceHalf, dims.toeHeight + 0.105, plankToeZ + 0.065);
          const pole = rotY(sgn * stanceHalf, 0.05, plankToeZ + 0.45);
          legs[Side] = { target, pole, mode: 'toe', footDir: fwdW, toePos, footUp: _Y, pin: true };
        }
      }
    }

    // ---- 2. IK ΧΕΡΙΩΝ (ΥΠΟΛΟΓΙΣΜΟΣ ΠΑΝΩ ΣΤΙΣ ΠΡΑΓΜΑΤΙΚΕΣ ΤΡΕΧΟΥΣΕΣ ΘΕΣΕΙΣ ΩΜΩΝ/ΑΥΧΕΝΑ) ----
    const computeArms = (coach, targetIK) => {
      const aOut = targetIK ? targetIK.arms : arms;
      const getShL = () => coach ? coach.worldPos('LeftArm') : wp(this.aR.sh);
      const getShR = () => coach ? coach.worldPos('RightArm') : wp(this.aL.sh);
      const getShMid = () => getShL().add(getShR()).multiplyScalar(0.5);

      const handHalf = ikSpec.handExtraW !== undefined
        ? (shHalfW + ikSpec.handExtraW)
        : ((ikSpec.handW || (shHalfW * 2 + 0.10)) * 0.5);

      if (isPlankLike) {
        groundLock = 'ik';
        // Ο καρπός μετατοπίζεται -palmLen*0.35 πίσω ώστε το κέντρο της παλάμης να πατάει ακριβώς κάτω από τον ώμο
        const wristZ = plankHandZ - palmLen * 0.35;
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const target = rotY(sgn * handHalf, 0.030, wristZ);
          const pole = rotY(sgn * (handHalf + 0.38 * flare), 0.28, wristZ - 0.50);
          aOut[Side] = {
            target, pole,
            forearmTwist: -1.35, humeralTwist: 0.16,
            handDir: fwdW.clone(), handPalm: _DOWN, pinFloor: true,
          };
        }
      } else if (handsMode === 'bird_dog') {
        groundLock = 'ik';
        const wristZ = plankHandZ - palmLen * 0.35;
        const leftPlanted = cur.srx > -2.1;
        const rightPlanted = cur.slx > -2.1;
        if (leftPlanted) {
          const target = rotY(handHalf, 0.030, wristZ);
          const pole = rotY(handHalf + 0.10, 0.30, wristZ - 0.48);
          aOut.Left = { target, pole, forearmTwist: -1.35, handDir: fwdW.clone(), handPalm: _DOWN, pinFloor: true };
        }
        if (rightPlanted) {
          const target = rotY(-handHalf, 0.030, wristZ);
          const pole = rotY(-handHalf - 0.10, 0.30, wristZ - 0.48);
          aOut.Right = { target, pole, forearmTwist: -1.35, handDir: fwdW.clone(), handPalm: _DOWN, pinFloor: true };
        }
      } else if (handsMode === 'side_plank') {
        // Κάτω χέρι (Right) σε 2-bone IK: αγκώνας ακριβώς κάτω από τον ώμο στο στρώμα, αντιβράχιο μπροστά!
        const shR = getShR();
        const elbowOnMat = new THREE.Vector3(shR.x, 0.042, shR.z);
        const wristTgt = elbowOnMat.clone().addScaledVector(fwdW, dims.lenForeR * 0.94);
        const pole = elbowOnMat.clone().addScaledVector(_Y, -0.45).addScaledVector(fwdW, -0.35);
        aOut.Right = {
          target: wristTgt, pole,
          forearmTwist: -1.35,
          handDir: fwdW.clone(), handPalm: _DOWN, pinFloor: true,
        };
      } else if (handsMode === 'chair_dip') {
        groundLock = 'ik';
        meta.benchZ = -0.40;
        const edgeZ = -0.18;
        const wristZ = edgeZ - palmLen * 0.32;
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const target = rotY(sgn * handHalf, 0.468, wristZ);
          // Αγκώνες αυστηρά ΠΙΣΩ πάνω από τον πάγκο (όχι άνοιγμα στα πλάγια!)
          const pole = rotY(sgn * (handHalf + 0.03), 0.62, edgeZ - 0.68);
          aOut[Side] = {
            target, pole,
            forearmTwist: -1.35,
            handDir: fwdW.clone(), handPalm: _DOWN,
          };
        }
      } else if (handsMode === 'back_bar') {
        // Zero-lag θέση άνω τραπεζοειδών: Spine2↔Neck πίσω κατά -chestFwd*0.085 (ακολουθεί κάθε κλίση κορμού!)
        const barPos = coach
          ? coach.worldPos('Spine2').lerp(coach.worldPos('Neck'), 0.62).addScaledVector(chestFwd, -0.085).addScaledVector(chestUp, 0.015)
          : wp(this.chest, 0, 0.27, -0.105);
        const barAxis = rightW.clone();
        meta.barPos = barPos.clone();
        meta.barAxis = barAxis;
        const gripHalf = shHalfW + 0.18;
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const target = barPos.clone()
            .addScaledVector(barAxis, sgn * gripHalf)
            .addScaledVector(chestUp, -palmLen * 0.45)
            .addScaledVector(chestFwd, -palmLen * 0.25);
          const pole = target.clone()
            .addScaledVector(chestUp, -0.46)
            .addScaledVector(chestFwd, -0.34)
            .addScaledVector(barAxis, sgn * 0.14);
          aOut[Side] = { target, pole, forearmTwist: -1.15, humeralTwist: 0.45 };
        }
      } else if (handsMode === 'deadlift_bar') {
        // Κατακόρυφη διαδρομή Ολυμπιακής μπάρας (0.225m δίσκοι) πάνω από το μέσο του πέλματος, χέρια έξω από τα γόνατα!
        const shMid = getShMid();
        const barAxis = rightW.clone();
        const gripHalf = Math.max(stanceHalf + 0.08, shHalfW + 0.06);
        const barY = clamp(shMid.y - armReach * 0.94 - palmLen * 0.85, BARBELL_PLATE_R, shMid.y - armReach * 0.88);
        const barPos = rotY(0, barY, 0.15);
        meta.barPos = barPos.clone();
        meta.barAxis = barAxis;
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const target = barPos.clone()
            .addScaledVector(barAxis, sgn * gripHalf)
            .addScaledVector(_Y, palmLen * 0.85); // ο καρπός πάνω από τη μπάρα ώστε τα δάχτυλα να την αγκαλιάζουν!
          const pole = target.clone().addScaledVector(fwdW, -0.45).addScaledVector(_Y, 0.35).addScaledVector(barAxis, sgn * 0.06);
          aOut[Side] = { target, pole, forearmTwist: -1.35 };
        }
      } else if (handsMode === 'row_bar') {
        const shMid = getShMid();
        const barAxis = rightW.clone();
        const gripHalf = shHalfW + 0.10;
        const pull01 = clamp((-cur.elL - 0.10) / 1.35, 0, 1);
        const dropY = lerp(armReach * 0.92, armReach * 0.40, pull01);
        const fwdOff = lerp(0.06, -0.06, pull01);
        const barPos = shMid.clone().addScaledVector(_Y, -dropY).addScaledVector(fwdW, fwdOff);
        if (barPos.y < BARBELL_PLATE_R) barPos.y = BARBELL_PLATE_R;
        meta.barPos = barPos.clone();
        meta.barAxis = barAxis;
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const target = barPos.clone().addScaledVector(barAxis, sgn * gripHalf).addScaledVector(_Y, palmLen * 0.65);
          const pole = target.clone().addScaledVector(fwdW, -0.50).addScaledVector(_Y, 0.42).addScaledVector(barAxis, sgn * 0.14);
          aOut[Side] = { target, pole, forearmTwist: -1.30 };
        }
      } else if (handsMode === 'hip_bar') {
        meta.benchZ = -0.52;
        if (e.barbell) {
          const hipsW = coach ? coach.worldPos('Hips') : wp(this.hips);
          const barAxis = rightW.clone();
          const barPos = hipsW.clone().addScaledVector(_Y, 0.08).addScaledVector(fwdW, 0.075);
          meta.barPos = barPos.clone();
          meta.barAxis = barAxis;
          meta.barPad = true;
          const gripHalf = shHalfW + 0.08;
          for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
            const target = barPos.clone().addScaledVector(barAxis, sgn * gripHalf);
            const pole = target.clone().addScaledVector(_Y, -0.22).addScaledVector(barAxis, sgn * 0.25);
            aOut[Side] = { target, pole, forearmTwist: -1.20 };
          }
        }
      } else if (handsMode === 'band_pull') {
        // Οριζόντιο τόξο διάνοιξης λάστιχου στο ύψος των ώμων με ελαφρά λυγισμένους αγκώνες
        const shMid = getShMid();
        const open01 = clamp((cur.srz + 0.08) / 1.32, 0, 1);
        const halfX = lerp(0.14, shHalfW + armReach * 0.80, open01);
        const fwdD = lerp(armReach * 0.88, 0.16, open01);
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const target = shMid.clone().addScaledVector(rightW, sgn * halfX).addScaledVector(fwdW, fwdD);
          const pole = target.clone().addScaledVector(fwdW, -0.45).addScaledVector(_Y, -0.22).addScaledVector(rightW, sgn * 0.15);
          aOut[Side] = { target, pole, forearmTwist: -1.25 };
        }
      } else if (handsMode === 'trx_pull' || handsMode === 'trx_push') {
        const isPush = handsMode === 'trx_push';
        meta.trxAnchor = new THREE.Vector3(0, 2.42, isPush ? -1.25 : 1.25);
        const shMid = getShMid();
        const bend01 = clamp((-cur.elL - 0.12) / 1.65, 0, 1);
        const hHalf = isPush ? (shHalfW + 0.12) : Math.max(0.16, shHalfW + 0.03);
        const fwdD = isPush
          ? lerp(armReach * 0.90, 0.18, bend01)
          : lerp(armReach * 0.92, 0.22, bend01);
        const yOff = isPush ? lerp(-0.06, -0.02, bend01) : lerp(0.10, -0.04, bend01);
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const target = shMid.clone()
            .addScaledVector(rightW, sgn * hHalf)
            .addScaledVector(fwdW, fwdD)
            .addScaledVector(_Y, yOff);
          const pole = target.clone()
            .addScaledVector(fwdW, -0.45)
            .addScaledVector(_Y, -0.25)
            .addScaledVector(rightW, sgn * 0.42 * flare);
          aOut[Side] = { target, pole, forearmTwist: fTwist };
        }
      } else if (handsMode === 'curl') {
        // Αγκώνες σταθερά κοντά στα πλευρά, καθαρός υπτιασμός αντιβραχίου (παλάμες ΠΑΝΩ!)
        const curl01 = clamp((-cur.elL - 0.10) / 2.28, 0, 1);
        const ang = lerp(0.12, 2.38, curl01);
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const sh = Side === 'Left' ? getShL() : getShR();
          const elbowIdeal = sh.clone().addScaledVector(_Y, -dims.lenArmL * 0.96).addScaledVector(fwdW, 0.03 * curl01).addScaledVector(rightW, sgn * 0.02);
          const target = elbowIdeal.clone()
            .addScaledVector(_Y, -dims.lenForeL * Math.cos(ang))
            .addScaledVector(fwdW, dims.lenForeL * Math.sin(ang));
          const pole = elbowIdeal.clone().addScaledVector(fwdW, -0.45).addScaledVector(_Y, -0.15);
          aOut[Side] = { target, pole, forearmTwist: 1.45 };
        }
      } else if (handsMode === 'ohp') {
        // Κατακόρυφη πίεση ώμων στο επίπεδο ωμοπλάτης (~30° μπροστά)
        const press01 = clamp((-cur.slx - 0.55) / 2.40, 0, 1);
        const hHalf = e.barbell ? (shHalfW + 0.13) : (shHalfW + 0.09);
        const shMid = getShMid();
        const yOff = lerp(0.06, armReach * 0.93, press01);
        const zOff = lerp(0.10, 0.03, press01);
        if (e.barbell) {
          meta.barPos = shMid.clone().addScaledVector(_Y, yOff + palmLen * 0.5).addScaledVector(fwdW, zOff);
          meta.barAxis = rightW.clone();
        }
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const target = shMid.clone()
            .addScaledVector(rightW, sgn * hHalf)
            .addScaledVector(_Y, yOff)
            .addScaledVector(fwdW, zOff);
          const pole = target.clone().addScaledVector(_Y, -0.45).addScaledVector(fwdW, 0.25).addScaledVector(rightW, sgn * 0.22);
          aOut[Side] = { target, pole, forearmTwist: -1.25 };
        }
      } else if (handsMode === 'russian_twist') {
        // Δύο χέρια μαζί μπροστά στον στρεφόμενο θώρακα (κρατώντας αλτήρα/kettlebell ή ενωμένες παλάμες)
        const shMid = getShMid();
        const anchor = shMid.clone().addScaledVector(chestFwd, 0.34).addScaledVector(chestUp, -0.14);
        const handSep = (e.dumbbells || e.kettlebell) ? 0.065 : 0.04;
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const target = anchor.clone().addScaledVector(rightW, sgn * handSep);
          const pole = target.clone().addScaledVector(_Y, -0.30).addScaledVector(chestFwd, -0.25).addScaledVector(rightW, sgn * 0.28);
          aOut[Side] = { target, pole, forearmTwist: 0 };
        }
      } else if (handsMode === 'hinge_hold' && (e.barbell || e.kettlebell)) {
        const shMid = getShMid();
        const gripHalf = e.barbell ? (shHalfW + 0.09) : 0.055;
        const barY = Math.max(BARBELL_PLATE_R, shMid.y - armReach * 0.94);
        const barPos = rotY(0, barY, 0.14);
        if (e.barbell) { meta.barPos = barPos.clone(); meta.barAxis = rightW.clone(); }
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const target = barPos.clone().addScaledVector(rightW, sgn * gripHalf).addScaledVector(_Y, palmLen * 0.7);
          const pole = target.clone().addScaledVector(fwdW, -0.42).addScaledVector(_Y, 0.30);
          aOut[Side] = { target, pole, forearmTwist: -1.25 };
        }
      } else if ((e.kettlebell || e.goblet) && (m === MOTIONS.squat || m === MOTIONS.lunge || m === MOTIONS.reverse_lunge || m === MOTIONS.step_up)) {
        // Goblet hold: και οι δύο παλάμες αγκαλιάζουν το βάρος μπροστά στο στέρνο (zero-lag από Spine2!)
        const sternum = coach
          ? coach.worldPos('Spine2').addScaledVector(chestFwd, 0.22).addScaledVector(chestUp, 0.04)
          : wp(this.chest, 0, 0.16, 0.23);
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const target = sternum.clone().addScaledVector(rightW, sgn * 0.065);
          const pole = target.clone().addScaledVector(_Y, -0.40).addScaledVector(rightW, sgn * 0.18).addScaledVector(chestFwd, -0.16);
          aOut[Side] = { target, pole, forearmTwist: 0.15 };
        }
      }
    };

    computeArms(sk, null);
    meta._refreshArms = computeArms;
    return { legs, arms, hipsPos, groundLock, meta, refreshArms: computeArms };
  }

  /** Εφαρμογή 2-Bone IK και στον procedural proxy σκελετό (looks 'male'/'female') */
  _applyProxyIK(res) {
    if (!res) return;
    const S = this.look.scale;
    if (res.hipsPos) {
      const lp = res.hipsPos.clone();
      this.hips.parent.worldToLocal(lp);
      this.hips.position.copy(lp);
      this.figure.updateMatrixWorld(true);
    }
    const setGroupWorld = (grp, dir, sec) => {
      const wq = basisFromDirSec(dir, sec, this._qTmp).multiply(PROXY_REST_INV);
      grp.parent.getWorldQuaternion(this._qTmp2);
      grp.quaternion.copy(this._qTmp2.invert().multiply(wq));
      grp.updateMatrixWorld(true);
    };
    const sides = [['Left', this.aR, this.lR], ['Right', this.aL, this.lL]];
    for (const [Side, a, l] of sides) {
      const legIK = res.legs?.[Side];
      if (legIK && legIK.target) {
        const hpW = l.hp.getWorldPosition(this._v1);
        const sol = solveTwoBoneIK(hpW, legIK.target, legIK.pole, L.thigh * S, L.shin * S, { softness: 0.015 });
        setGroupWorld(l.hp, sol.dir1, sol.p1);
        setGroupWorld(l.kn, sol.dir2, sol.p2);
      }
      const armIK = res.arms?.[Side];
      if (armIK && armIK.target) {
        const shW = a.sh.getWorldPosition(this._v1);
        const sol = solveTwoBoneIK(shW, armIK.target, armIK.pole, L.upper * S, L.fore * S, { softness: 0.012 });
        setGroupWorld(a.sh, sol.dir1, sol.p1.clone().negate());
        setGroupWorld(a.el, sol.dir2, sol.p2.clone().negate());
      }
    }
  }

  /** Μεταφορά στο ρεαλιστικό μοντέλο (FK + Zero-Lag 2-Bone IK) + εξοπλισμός & contact shadows */
  post(dt) {
    this.figure.updateMatrixWorld(true);
    this.palmW = (this.palmW ?? 0) + ((this.mode === 'idle' ? 0 : 1) - (this.palmW ?? 0)) * Math.min(1, dt * 6);
    const q = this._qTmp;
    const ax = (o, v) => v.clone().applyQuaternion(o.getWorldQuaternion(q));
    const wp = (o, x = 0, y = 0, z = 0) => o.localToWorld(new THREE.Vector3(x, y, z));
    const sides = [['Left', this.aR, this.lR], ['Right', this.aL, this.lL]]; // Left του μοντέλου = +x

    const ikSpec = this.motion.ik || {};
    const cy = ax(this.chest, _Y), cz = ax(this.chest, _Z);

    const eqGripStyle = this.equip.gripStyle();
    const gripStyle = this.mode === 'idle' ? 'relaxed' : (eqGripStyle || ikSpec.grip || 'relaxed');
    const gripAmt = this.mode === 'idle' ? 0.25 : (gripStyle === 'floor' ? 0.05 : this.equip.grip());

    let meta = { barPos: null, barAxis: null, barPad: false, bandMode: 'loop', trxAnchor: null, benchZ: -0.40, stepZ: 0.42, wallZ: -0.22 };

    if (this.skinned) {
      const T = {};
      const hy = ax(this.hips, _Y), hz = ax(this.hips, _Z);
      const ay = ax(this.abdomen, _Y), az = ax(this.abdomen, _Z);
      const ey = ax(this.headG, _Y), ez = ax(this.headG, _Z);

      T.Hips = { dir: hy, sec: hz };
      T.Spine = { dir: ay, sec: az };
      T.Spine1 = { dir: ay.clone().add(cy), sec: az.clone().add(cz) };
      T.Spine2 = { dir: cy, sec: cz };
      T.Neck = { dir: cy.clone().add(ey), sec: cz.clone().add(ez) };
      T.Head = { dir: ey, sec: ez };

      // Scapulohumeral rhythm για κλείδες (LeftShoulder / RightShoulder)
      const cx = ax(this.chest, _X);
      for (const [Side, a, l] of sides) {
        const sgn = Side === 'Left' ? 1 : -1;
        const sh = wp(a.sh), el = wp(a.el), hand = wp(a.el, 0, -L.fore, 0);
        const armDir = el.clone().sub(sh);
        const upDot = clamp(armDir.clone().normalize().dot(cy), 0, 1);
        const clavLift = clamp(upDot * 0.28 + (Side === 'Left' ? (this.cur.shR || 0) : (this.cur.shL || 0)) * 3.0, -0.08, 0.30);
        const clavDir = cx.clone().multiplyScalar(sgn).addScaledVector(cy, clavLift).normalize();
        T[Side + 'Shoulder'] = { dir: clavDir, sec: cz };

        T[Side + 'Arm'] = { dir: armDir, sec: ax(a.sh, _Z) };
        const fdir = hand.sub(el), fsec = ax(a.el, _Z);
        const fTw = (ikSpec.forearmTwist ?? PALM_TO_TWIST[this.motion.palm] ?? 0) * this.palmW;
        if (fTw) applyAxialTwist(fsec, fdir, Side === 'Left' ? -fTw : fTw);
        T[Side + 'ForeArm'] = { dir: fdir, sec: fsec };

        const hp = wp(l.hp), kn = wp(l.kn), an = wp(l.an), toe = wp(l.an, 0, -0.05, 0.14);
        T[Side + 'UpLeg'] = { dir: kn.clone().sub(hp), sec: ax(l.hp, _Z) };
        T[Side + 'Leg'] = { dir: an.clone().sub(kn), sec: ax(l.kn, _Z) };
        T[Side + 'Foot'] = { dir: toe.sub(an), sec: ax(l.an, _Y) };
      }

      const hips = wp(this.hips).multiplyScalar(this.k);
      this.skinned.setGrip(gripAmt, gripAmt, gripStyle, gripStyle);
      const isJump = this.motion === MOTIONS.jumping_jack || this.motion === MOTIONS.burpee || this.motion === MOTIONS.high_knees;
      const resolvedMeta = this.skinned.drive(T, hips, dt, {
        air: isJump ? Math.max(0, this.cur.lift * this.k) : 0,
        resolveIK: sk => this._resolveIK(sk, this.motion, this.cur, wp, ax, cy, cz),
      });
      if (resolvedMeta) meta = resolvedMeta;
    } else {
      const res = this._resolveIK(null, this.motion, this.cur, wp, ax, cy, cz);
      meta = res.meta;
      this._applyProxyIK(res);
    }

    // Εξαγωγή θέσεων χεριών/ποδιών για εξοπλισμό & contact shadows
    const H = {
      figure: this.figure,
      yaw: this.yaw,
      feet: {},
      matZ: (this.cur.rZ || 0) * (this.k || 1) + (this.cur.rrx > 0.3 ? -0.22 : 0.10),
      barPos: meta.barPos,
      barAxis: meta.barAxis,
      barPad: meta.barPad,
      bandMode: meta.bandMode,
      trxAnchor: meta.trxAnchor,
      benchZ: meta.benchZ,
      stepZ: meta.stepZ,
      wallZ: meta.wallZ,
    };

    for (const [Side, a, l] of sides) {
      const key = Side[0];
      if (this.skinned) {
        const sk = this.skinned;
        const b = n => sk.worldPos(Side + n);
        const hand = b('Hand');
        const mid = sk.b[Side + 'HandMiddle1'] ? b('HandMiddle1') : hand.clone();
        const i1 = sk.b[Side + 'HandIndex1'] ? b('HandIndex1') : null;
        const p1 = sk.b[Side + 'HandPinky1'] ? b('HandPinky1') : null;
        const fingers = mid.clone().sub(hand);
        const across = i1 && p1 ? p1.sub(i1) : ax(a.el, _X);
        const palm = new THREE.Vector3().crossVectors(fingers, across).normalize().multiplyScalar(Side === 'Left' ? -0.022 : 0.022);
        H[key] = { pos: hand.clone().addScaledVector(fingers, 1.22).add(palm), across };
        const footW = sk.b[Side + 'ToeBase'] ? b('Foot').add(b('ToeBase')).multiplyScalar(0.5) : b('Foot');
        H.feet[key] = footW.clone().setY(0.015);

        const shMesh = this.cShadows[Side === 'Left' ? 'footL' : 'footR'];
        const fh = Math.max(0, footW.y - sk.dims.footHeight * 0.65);
        shMesh.position.set(footW.x, 0.0025, footW.z);
        shMesh.rotation.z = -this.yaw;
        shMesh.material.opacity = 0.36 * clamp(1 - fh / 0.28, 0, 1);
        shMesh.scale.setScalar(1 + fh * 0.7);
      } else {
        H[key] = { pos: wp(a.el, 0, -L.fore - 0.045, 0), across: ax(a.el, _X) };
        const footW = wp(l.an, 0, -0.06, 0.06);
        H.feet[key] = footW.clone().setY(0.015);
        const shMesh = this.cShadows[Side === 'Left' ? 'footL' : 'footR'];
        const fh = Math.max(0, footW.y);
        shMesh.position.set(footW.x, 0.0025, footW.z);
        shMesh.rotation.z = -this.yaw;
        shMesh.material.opacity = 0.34 * clamp(1 - fh / 0.28, 0, 1);
      }
    }

    // Ακριβής ευθυγράμμιση μπάρας με τα λυμένα κέντρα παλαμών (μηδενικό κενό λαβής)
    if (this.equip.e.barbell && H.L && H.R && meta.barPos && this.motionKey !== 'back_squat') {
      H.barPos = H.L.pos.clone().add(H.R.pos).multiplyScalar(0.5);
      if (H.barPos.y < BARBELL_PLATE_R) H.barPos.y = BARBELL_PLATE_R;
      const span = H.R.pos.clone().sub(H.L.pos);
      if (span.lengthSq() > 1e-4) H.barAxis = span.normalize();
    }

    // Contact shadow κάτω από τον κορμό σε ασκήσεις εδάφους
    const torsoW = this.skinned ? this.skinned.worldPos('Spine1', this._v1) : wp(this.abdomen);
    const bodyOp = this.motion.floor ? 0.34 * clamp(1 - Math.max(0, torsoW.y - 0.12) / 0.45, 0, 1) : 0;
    this.cShadows.body.position.set(torsoW.x, 0.002, torsoW.z);
    this.cShadows.body.rotation.z = -this.yaw;
    this.cShadows.body.material.opacity = bodyOp;

    this.equip.update(H);
  }

  /** Μικρο-κινήσεις ζωής: φυσικό βλέμμα (με προστασία αυχένα), βλεφαρίδα, ομιλία, ουρά */
  living(dt) {
    const now = performance.now(), m = this.motion;
    const neutralNeck = m.floor || Math.abs(this.cur.tx) > 0.75;
    const gazeGain = neutralNeck ? 0.22 : 0.68;
    const targetYaw = clamp(-this.yaw * gazeGain + (this.cur.hdY || 0), -0.68, 0.68);
    this.headG.rotation.y += (targetYaw + Math.sin(this.time * 0.48) * 0.04 - this.headG.rotation.y) * (1 - Math.exp(-dt * 5));
    this.headG.rotation.z += ((this.cur.hdZ || 0) - this.headG.rotation.z) * (1 - Math.exp(-dt * 6));

    this.nextBlink -= dt;
    if (this.nextBlink < 0) { this.blink = 0.13; this.nextBlink = 2.2 + Math.random() * 3.4; }
    if (this.blink > 0) this.blink -= dt;
    const eyeY = this.blink > 0 ? 0.12 : 1;
    this.headG.children.forEach(c => { if (c.name === 'eye') c.scale.y = 0.75 * eyeY; });

    const talking = now < this.talkUntil && !this.paused;
    const open = talking ? 0.35 + 0.65 * Math.abs(Math.sin(this.time * 14)) : 0;
    if (talking) this.headG.rotation.x += Math.sin(this.time * 6.5) * 0.030;
    this.mouth.scale.y = 1 + open * 2.6;
    this.mouth.children[1].scale.y = 0.3 + open * 1.6;

    this.sway.rotation.z = (this.mode === 'idle' || this.mode === 'ready') ? Math.sin(this.time * 0.55) * 0.010 : 0;

    if (this.tail) {
      this.headG.getWorldPosition(this.tmpV);
      const s = this.pt;
      const vy = (this.tmpV.y - s.py) / Math.max(dt, 1e-3);
      const ay = clamp((vy - s.pvy) / Math.max(dt, 1e-3), -25, 25);
      s.py = this.tmpV.y; s.pvy = vy;
      s.v += (-90 * (s.a - 0.18) - 9 * s.v + ay * 0.06) * dt;
      s.a = clamp(s.a + s.v * dt, -0.9, 1.1);
      this.tail.rotation.x = s.a;
      this.tail.rotation.z = Math.sin(this.time * 1.3) * 0.03;
    }
  }

  /** Άμεση εφαρμογή πόζας (για δοκιμές / snapshots) */
  debug(key, u, alt = false, equip) {
    this.setMotion(key);
    if (equip) this.setEquipment(equip);
    this.yaw = this.yawT;
    this.mode = u === 0 ? 'ready' : 'hold';
    this.cur = this.pose(u, alt);
    this.equipPose(this.cur);
    if (this.skinned) this.skinned.offY = 0;
    for (let i = 0; i < 40; i++) {
      this.apply(this.cur, this.motion);
      this.living(0.1);
      this.post(0.1);
    }
    const fr = this.frame();
    this.camD = fr.d; this.camY = fr.cy;
    this.camera.position.set(0, this.camY + this.camD * 0.1, this.camD);
    this.camera.lookAt(0, this.camY, 0);
    this.draw();
  }

  apply(p, m) {
    this.figure.rotation.y = this.yaw;

    const sp = spineDistribution(p.tx || 0, p.ty || 0, p.tz || 0, m.ik?.spine || 'neutral');
    this.abdomen.rotation.set(sp.lumbarX, sp.lumbarY, sp.lumbarZ);
    this.chest.rotation.set(sp.thoracicX, sp.thoracicY, sp.thoracicZ);

    const neckComp = Math.abs(p.tx || 0) > 0.75 ? 0.25 : 0.42;
    this.headG.rotation.x = (p.hd || 0) - (p.tx || 0) * neckComp;

    const up = (k, sk) => clamp((Math.abs(p[k + 'z']) - 1.1) * 0.035 + (-p[k + 'x'] > 1.9 ? 0.025 : 0) + (p[sk] || 0), -0.03, 0.055);
    this.aL.sh.position.y = 0.25 + up('sl', 'shL');
    this.aR.sh.position.y = 0.25 + up('sr', 'shR');
    this.aL.sh.rotation.set(p.slx, p.slY || 0, p.slz);
    this.aR.sh.rotation.set(p.srx, p.srY || 0, p.srz);
    this.aL.el.rotation.x = Math.min(-0.02, p.elL);
    this.aR.el.rotation.x = Math.min(-0.02, p.elR);

    this.lL.hp.rotation.set(p.hlx, p.hlY || 0, p.hlz);
    this.lR.hp.rotation.set(p.hrx, p.hrY || 0, p.hrz);
    this.lL.kn.rotation.x = Math.max(0, p.knL);
    this.lR.kn.rotation.x = Math.max(0, p.knR);

    const flat = m.flatFeet !== false;
    this.lL.an.rotation.x = (flat ? -((p.rrx || 0) + p.hlx + p.knL) : 0) + (p.anL || 0);
    this.lR.an.rotation.x = (flat ? -((p.rrx || 0) + p.hrx + p.knR) : 0) + (p.anR || 0);

    this.hips.rotation.set(p.rrx || 0, 0, p.rrz || 0);
    if (m.floor) {
      this.hips.position.set(p.rX || 0, p.rY || 0, p.rZ || 0);
      return;
    }

    const leg = (hx, hz, kx) => {
      const f1 = -((p.rrx || 0) + hx), f2 = f1 - kx;
      return {
        v: (L.thigh * Math.cos(f1) + L.shin * Math.cos(f2)) * Math.cos(hz),
        f: L.thigh * Math.sin(f1) + L.shin * Math.sin(f2),
      };
    };
    const a = leg(p.hlx, p.hlz, p.knL);
    const b = leg(p.hrx, p.hrz, p.knR);
    const baseY = Math.max(a.v, b.v) + L.ankle + (p.lift || 0) + (p.rY || 0);
    const baseZ = (m.noZ ? 0 : -(a.f + b.f) / 2) + (p.rZ || 0);
    this.hips.position.set(p.rX || 0, baseY, baseZ);
  }

  dispose() {
    this.disposed = true;
    this.composer?.dispose?.();
    this.gtao?.dispose?.();
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.cancelPending();
    this.equip.dispose();
    this.env?.dispose();
    this.skinned?.root.traverse(o => {
      if (o.material) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach(m => Object.values(m).forEach(v => v?.isTexture && v.dispose()));
      }
    });
    this.scene.traverse(o => {
      o.geometry?.dispose();
      if (o.material) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach(m => {
          Object.values(m).forEach(v => v?.isTexture && v.dispose());
          m.dispose();
        });
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
