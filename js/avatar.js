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
import { getClip, applyClip } from './clips.js';
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
  real:   { name: 'Ρεαλιστική (Michelle)', model: 'assets/models/Michelle.glb', proxy: 'male', hair: 'original' },
  custom: { name: 'Δικό μου μοντέλο', custom: true, proxy: 'male', hair: 'original' },
  male:   { name: 'Άντρας', skin: 0xe2ab80, hair: 'short', hairColor: 0x2a1f1a, top: 0x16a34a, bottom: 0x1f2937, shoulder: 1.0, hip: 1.0, waist: 1.0, ponytail: false, leggings: false, scale: 1 },
  female: { name: 'Γυναίκα', skin: 0xeab898, hair: 'ponytail', hairColor: 0x6b3f26, top: 0x0ea5e9, bottom: 0x334155, shoulder: 0.88, hip: 1.1, waist: 0.86, ponytail: true, leggings: true, scale: 0.96 },
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
    this.hairStyle = opts.hair || (typeof L0.hair === 'string' ? L0.hair : 'original');

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
      this.loaded = loadCoachModel(src, { quality: this.quality, hair: this.hairStyle }).then(sc => {
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
    const hairCol = K.hairColor ?? (typeof K.hair === 'number' ? K.hair : 0x2a1f1a);
    const skin = this.mat(K.skin, 0.55), top = this.mat(K.top, 0.78), bottom = this.mat(K.bottom, 0.82), hair = this.mat(hairCol, 0.50);
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
    const ik = this.motion?.ik || {};
    const prop = ik.prop;
    if (prop === 'bench') e.bench = true;
    if (prop === 'bench_flat') { e.bench = true; e.benchStyle = 'flat'; }
    if (prop === 'step') e.step = true;
    if (prop === 'wall') e.wall = true;
    if (prop === 'pullup_bar') e.pullupBar = true;
    if (prop === 'jump_rope') e.jumpRope = true;
    if ((mk === 'deadlift' || mk === 'back_squat' || mk === 'barbell_row') && !e.dumbbells && !e.kettlebell) e.barbell = true;
    if (mk === 'one_arm_row' && !e.singleDumbbell) { e.singleDumbbell = 'R'; delete e.dumbbells; }
    if (ik.bandAnchor) {
      if (!e.band || e.band === true) e.band = { anchor: ik.bandAnchor };
      else if (typeof e.band === 'object' && !e.band.anchor) e.band = { ...e.band, anchor: ik.bandAnchor };
    }
    if (mk === 'incline_row' || mk === 'trx_squat' || mk === 'trx_chest_press' || mk === 'trx_y_raise') e.straps = true;
    const key = JSON.stringify(e);
    if (key !== this.equipKey) {
      this.equipKey = key;
      this.equip.set(e);
    }
  }

  // ---- ΔΗΜΟΣΙΟ API (ΔΙΑΤΗΡΕΙΤΑΙ ΑΜΕΤΑΒΛΗΤΟ) ----
  setHair(style) {
    this.hairStyle = style || 'original';
    this.skinned?.setHair(this.hairStyle);
  }
  setMotion(key) {
    this.motionKey = MOTIONS[key] ? key : 'generic';
    this.motion = MOTIONS[this.motionKey];
    this.yawT = this.motion.yaw;
    this._syncEquipment();
    // Κίνηση από motion capture (αν υπάρχει για αυτή την άσκηση) — αλλιώς η διαδικαστική
    const k = this.motionKey;
    this.clip = null; this.clipReady = getClip(k).then(c => { if (this.motionKey === k) this.clip = c; return c; });
  }

  /** 'clip' αν η τρέχουσα άσκηση παίζει από motion capture, αλλιώς 'procedural' */
  get motionSource() { return this.clip && this.skinned && (this.clipW ?? 0) > 0.5 ? 'clip' : 'procedural'; }

  /** Χρόνος μέσα στην κίνηση για την τρέχουσα φάση (κύκλος επανάληψης / στάση / έτοιμος) */
  _clipTime() {
    const c = this.clip;
    if (this.mode === 'cycle') return c.repStart + Math.min(this.t / Math.max(this.dur, 0.01), 1) * c.period;
    if (this._debugMode) return c.repStart + (this._debugU || 0) * c.period * 0.5;
    return c.repStart;
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
    const legsMove = m === M2.squat || m === M2.box_squat || m === M2.lunge || m === M2.reverse_lunge ||
      m === M2.bulgarian_split_squat || m === M2.side_lunge || m === M2.step_up || m === M2.calf_raise || m === M2.step_calf_raise;
    if ((e.kettlebell || e.goblet) && legsMove) {
      p.slx = p.srx = -0.34 - p.tx; p.elL = p.elR = -2.28; p.slz = 0.32; p.srz = -0.32;
    } else if (e.dumbbells && legsMove) {
      p.slx = p.srx = -p.tx; p.elL = p.elR = -0.14; p.slz = -0.12; p.srz = 0.12;
    } else if (e.barbell && (m === M2.squat || m === M2.box_squat || m === M2.lunge || m === M2.reverse_lunge || m === M2.bulgarian_split_squat)) {
      p.slx = p.srx = -1.45 - p.tx; p.slz = -0.34; p.srz = 0.34; p.elL = p.elR = -2.55;
    } else if (e.kettlebell && m === M2.hinge) {
      p.slz = 0.22; p.srz = -0.22;
    } else if (e.band && (m === M2.squat || m === M2.box_squat)) {
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
      bandAnchor: ikSpec.bandAnchor || (typeof e.band === 'object' ? e.band.anchor : null),
      bandAnchorPos: null,
      bandSingleHandle: false,
      trxAnchor: null, benchZ: -0.40, benchX: 0, stepZ: 0.42, wallZ: -0.22, pullupZ: 0.04, ropeAngle: 0,
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
    const standY = sk ? sk.hipsRestY : (L.thigh + L.shin + L.ankle) * S;

    // ---- 0. ΑΥΤΟ-ΒΑΘΜΟΝΟΜΗΣΗ ΠΥΕΛΟΥ ΓΙΑ ΚΡΙΣΙΜΕΣ ΕΠΑΦΕΣ ----
    let plankToeZ = -0.76;
    let plankHandZ = 0.46;
    let kneePushKneeZ = -0.42;
    let incBenchEdgeZ = 0.44;
    const isPlankLike = handsMode === 'floor' || handsMode === 'plank_tap' || (handsMode === 'floor_burpee' && cur.rrx > 0.72);

    if (isPlankLike) {
      // Άκαμπτη ευθεία σανίδας (τεντωμένα πόδια 97.5% → μηδενικό λύγισμα γονάτων στο στρώμα)
      // που περιστρέφεται ακριβώς γύρω από τις καρφωμένες μύτες των ποδιών!
      const rrxTop = 1.26;
      const dxHand = ikSpec.handExtraW ?? 0.08;
      const maxVertArm = Math.sqrt(Math.max(0.08, (armReach * 0.92) ** 2 - dxHand * dxHand));
      const maxShY = maxVertArm + 0.032;
      const hipsYTop = Math.max(0.28, maxShY - torsoLen * Math.cos(rrxTop));
      const ankleY = dims.toeHeight + 0.105;
      const legSpan = legReach * 0.975;
      const dHTop = Math.max(0.04, hipsYTop - ankleY);
      const horizTop = Math.sqrt(Math.max(0.25, legSpan * legSpan - dHTop * dHTop));
      plankToeZ = -horizTop * 0.80 - 0.065;
      const hipsZTop = (plankToeZ + 0.065) + horizTop;
      plankHandZ = hipsZTop + torsoLen * Math.sin(rrxTop) + 0.015;

      const drop01 = clamp((cur.rrx - rrxTop) / 0.23, 0, 1);
      const hipsYCur = lerp(hipsYTop, 0.21, drop01);
      const dHCur = Math.max(0.02, hipsYCur - ankleY);
      const hipsZCur = (plankToeZ + 0.065) + Math.sqrt(Math.max(0.25, legSpan * legSpan - dHCur * dHCur));
      hipsPos = rotY(cur.rX || 0, hipsYCur, hipsZCur);
      // Τα πόδια ξεκινούν από την άρθρωση του μηρού (UpLeg), ~10cm πιο κοντά στα πέλματα από το κέντρο της λεκάνης (Hips):
      const hipJoint = this.skinned ? this.skinned.rest.Hips.pos.distanceTo(this.skinned.rest.LeftUpLeg.pos) : 0.08;
      plankToeZ -= hipJoint * 0.92;
    } else if (handsMode === 'knee_floor') {
      // Κάμψεις στα γόνατα: ευθεία ώμοι → ισχία → γόνατα (στο στρώμα y=0.055), κνήμες ψηλά!
      const rrxTop = 1.06;
      const thighSpan = dims.lenUpLegL * 0.96;
      kneePushKneeZ = -0.42;
      const hipsYTop = 0.055 + thighSpan * Math.cos(rrxTop);
      const hipsZTop = kneePushKneeZ + thighSpan * Math.sin(rrxTop);
      plankHandZ = hipsZTop + torsoLen * Math.sin(rrxTop) + 0.02;
      const drop01 = clamp((cur.rrx - rrxTop) / 0.36, 0, 1);
      const curAng = lerp(rrxTop, 1.38, drop01);
      const hipsYCur = Math.max(0.145, 0.055 + thighSpan * Math.cos(curAng));
      const hipsZCur = kneePushKneeZ + thighSpan * Math.sin(curAng);
      hipsPos = rotY(0, hipsYCur, hipsZCur);
    } else if (handsMode === 'wall_push') {
      // Κάμψεις σε τοίχο μπροστά: ευθύ κεκλιμένο σώμα (με διόρθωση hipJoint ώστε τα γόνατα να μένουν 100% τεντωμένα!)
      meta.wallZ = 0.66;
      const push01 = clamp((cur.rrx - 0.34) / 0.24, 0, 1);
      const leanAng = lerp(0.28, 0.44, push01);
      const fZ = ikSpec.footZ || -0.46;
      const hipJoint = this.skinned ? this.skinned.rest.Hips.pos.distanceTo(this.skinned.rest.LeftUpLeg.pos) : 0.08;
      const legR = legReach * 0.985 + hipJoint * 0.85;
      hipsPos = rotY(0, dims.footHeight + legR * Math.cos(leanAng), fZ + legR * Math.sin(leanAng));
    } else if (handsMode === 'bench_push') {
      // Incline push-up σε καρέκλα/πάγκο μπροστά (benchZ=+0.66, μπροστινό χείλος z=+0.44, ύψος 0.45m)
      meta.benchZ = 0.66;
      incBenchEdgeZ = 0.46;
      const rrxTop = 0.86;
      const drop01 = clamp((cur.rrx - rrxTop) / 0.26, 0, 1);
      const benchH = 0.468;
      const shYTop = benchH + armReach * 0.86;
      const shYBot = benchH + 0.14;
      const hipsYTop = Math.max(0.40, shYTop - torsoLen * Math.cos(rrxTop));
      const hipsYBot = Math.max(0.28, shYBot - torsoLen * Math.cos(1.12));
      const hipsYCur = lerp(hipsYTop, hipsYBot, drop01);
      const ankleY = dims.toeHeight + 0.105;
      const legSpan = legReach * 0.975;
      const hipsZTop = incBenchEdgeZ - torsoLen * Math.sin(rrxTop) - 0.04;
      const horizTop = Math.sqrt(Math.max(0.20, legSpan * legSpan - Math.max(0.04, hipsYTop - ankleY) ** 2));
      plankToeZ = (hipsZTop - horizTop) - 0.065;
      const dHCur = Math.max(0.04, hipsYCur - ankleY);
      const hipsZCur = (plankToeZ + 0.065) + Math.sqrt(Math.max(0.20, legSpan * legSpan - dHCur * dHCur));
      hipsPos = rotY(0, hipsYCur, hipsZCur);
      const hipJoint = this.skinned ? this.skinned.rest.Hips.pos.distanceTo(this.skinned.rest.LeftUpLeg.pos) : 0.08;
      plankToeZ -= hipJoint * 0.92;
    } else if (handsMode === 'bird_dog' || handsMode === 'quadruped') {
      // Τετραποδική στάση (Bird-dog / Cat-Cow): ύψος πυέλου ίσο με μήκος μηρού / χεριού
      const tableY = Math.min(dims.lenUpLegL + 0.055, armReach * 0.88 + 0.030);
      const hipZ = handsMode === 'quadruped' ? -0.10 : 0;
      plankHandZ = hipZ + torsoLen * Math.sin(1.40) + 0.02;
      hipsPos = rotY(cur.rX || 0, tableY, hipZ);
    } else if (handsMode === 'child_pose') {
      // Διάταση παιδιού: ισχία χαμηλά πίσω πάνω στις φτέρνες
      hipsPos = rotY(0, 0.21, -0.44);
    } else if (handsMode === 'chair_dip') {
      const benchH = 0.45;
      const topY = Math.max(0.36, benchH + armReach * 0.87 - torsoLen);
      const botY = Math.max(0.18, topY - Math.min(0.21, armReach * 0.42));
      const uDip = clamp((0.42 - (cur.rY || 0.42)) / 0.20, 0, 1);
      hipsPos = rotY(cur.rX || 0, lerp(topY, botY, uDip), 0.02 + uDip * 0.02);
    } else if (feetMode === 'wall_sit') {
      meta.wallZ = -0.22;
      hipsPos = rotY(0, dims.footHeight + dims.lenLegL * 0.96, -0.10);
    } else if (feetMode === 'box_squat') {
      // Καθίσματα σε καρέκλα πίσω: κάτω θέση κάθεται καθαρά στην επιφάνεια του πάγκου (y=0.45m)
      meta.benchZ = -0.34;
      const sq01 = clamp((cur.knL - 0.10) / 1.46, 0, 1);
      const seatY = 0.45 + 0.10;
      hipsPos = rotY(0, lerp(standY, seatY, smootherstep(sq01)), lerp(0.06, -0.20, smootherstep(sq01)));
    } else if (feetMode === 'seated') {
      // Καθιστές πιέσεις ώμων πάνω σε καρέκλα/πάγκο
      meta.benchZ = -0.08;
      hipsPos = rotY(0, 0.45 + 0.10, -0.04);
    } else if (feetMode === 'bench_press') {
      // Ύπτια πάνω σε μακρύ οριζόντιο πάγκο βαρών (y=0.45m)
      meta.benchZ = -0.18;
      hipsPos = rotY(0, 0.45 + 0.115, 0.16);
    } else if (feetMode === 'one_arm_row') {
      // Κωπηλατική με έναν αλτήρα: αριστερό γόνατο & χέρι στον πάγκο (+X), δεξί πόδι στο έδαφος (-X)
      meta.benchX = 0.20;
      meta.benchZ = -0.02;
      hipsPos = rotY(0.02, 0.45 + 0.055 + dims.lenUpLegL * 0.72, -0.22);
    } else if (feetMode === 'bulgarian') {
      meta.benchZ = -0.68;
      const drop01 = clamp((-Math.min(cur.hlx, cur.hrx) - 0.12) / 1.36, 0, 1);
      const lowY = dims.footHeight + dims.lenLegL + 0.045;
      hipsPos = rotY(0, lerp(standY - 0.05, lowY, smootherstep(drop01)), lerp(0.16, 0.08, smootherstep(drop01)));
    } else if (feetMode === 'side_lunge') {
      const amt = clamp(Math.abs(cur.rX) / 0.30, 0, 1);
      const dir = cur.rX >= 0 ? 1 : -1;
      const lowY = dims.footHeight + dims.lenLegL + 0.075;
      hipsPos = rotY(dir * amt * 0.30, lerp(standY, lowY, smootherstep(amt)), -amt * 0.08);
    } else if (handsMode === 'pullup_bar') {
      // Μονόζυγο πόρτας: κρέμασμα από barY=2.18m, groundLock='air' ώστε να μην τραβιέται στο πάτωμα!
      groundLock = 'air';
      meta.pullupZ = 0.04;
      const barY = 2.18;
      const pull01 = clamp((-cur.elL - 0.08) / 2.10, 0, 1);
      const hipsYHang = barY - armReach * 0.93 - torsoLen;
      const hipsYTop = barY - 0.14 - torsoLen;
      hipsPos = rotY(0, lerp(hipsYHang, hipsYTop, pull01), 0.04 - 0.04 * (1 - pull01));
    } else if (feetMode === 'step_calf') {
      // Ανυψώσεις γάμπας σε σκαλί (stepZ=0.28 → σκαλί z=+0.06..+0.50, ύψος 0.34m, μύτες στο χείλος z=+0.11, φτέρνες έξω!)
      meta.stepZ = 0.28;
      const stepH = 0.34;
      const liftH = cur.lift > 0.005 ? Math.min(cur.lift * kScale, 0.062) : -0.056;
      hipsPos = rotY(0, standY + stepH + liftH, -0.01);
    } else if (feetMode === 'squat_jump') {
      if (cur.lift > 0.04) {
        groundLock = 'air';
        hipsPos = rotY(0, standY + cur.lift * kScale, 0);
      }
    } else if (feetMode === 'skater') {
      if (cur.lift > 0.04) {
        groundLock = 'air';
        hipsPos = rotY(cur.rX || 0, standY - 0.08 + cur.lift * kScale, 0);
      }
    } else if (feetMode === 'jump_rope') {
      if (cur.lift > 0.03) {
        groundLock = 'air';
        hipsPos = rotY(0, standY + cur.lift * kScale, 0);
        meta.ropeAngle = Math.PI; // σχοινάκι κάτω από τα πέλματα στην πτήση!
      } else {
        meta.ropeAngle = 0.25; // σχοινάκι ψηλά πάνω από το κεφάλι στην προσγείωση!
      }
    } else if (feetMode === 'side_plank' || feetMode === 'knee_side_plank') {
      groundLock = 'ik';
      const theta = cur.rrz || (feetMode === 'knee_side_plank' ? 1.22 : 1.38);
      const shH = 0.042 + dims.lenArmR * 0.92;
      const hipYFromArm = shH - torsoLen * Math.cos(theta) + shHalfW * Math.sin(theta);
      const legEff = feetMode === 'knee_side_plank' ? dims.lenUpLegR : legReach;
      const hipYFromLeg = 0.055 + legEff * Math.cos(theta) + dims.hipHalfW * Math.sin(theta);
      const minY = feetMode === 'knee_side_plank' ? 0.31 : 0.28;
      hipsPos = rotY(0, Math.max(minY, Math.min(hipYFromArm, hipYFromLeg)), 0);
    } else if (handsMode === 'deadlift_bar') {
      const dl01 = clamp(cur.rrx / 1.06, 0, 1);
      if (dl01 > 0.02) {
        const torsoAng = (cur.rrx || 0) + (cur.tx || 0) * 0.85;
        const needShY = BARBELL_PLATE_R + armReach * 0.94 + palmLen * 0.85;
        const botHipY = clamp(needShY - torsoLen * Math.cos(torsoAng), dims.footHeight + 0.34, standY - 0.15);
        const curHipY = lerp(standY, botHipY, dl01);
        const curHipZ = lerp(0, -0.24, dl01);
        hipsPos = rotY(cur.rX || 0, curHipY, curHipZ);
      }
    } else if (feetMode === 'split' || feetMode === 'reverse_lunge') {
      const splitAmt = clamp(Math.abs(cur.hlx - cur.hrx) / 1.55, 0, 1);
      const lowY = dims.footHeight + dims.lenLegL + 0.055;
      const yCur = lerp(standY, lowY, smootherstep(splitAmt));
      const zCur = feetMode === 'reverse_lunge'
        ? lerp(0.16, -0.20, splitAmt)
        : lerp(0.00, 0.06, splitAmt);
      hipsPos = rotY(cur.rX || 0, yCur, zCur);
    }

    // ---- 1. IK ΠΟΔΙΩΝ (ΚΑΡΦΩΜΕΝΑ ΠΕΛΜΑΤΑ, ΓΟΝΑΤΑ ΣΤΟ ΣΤΡΩΜΑ/ΠΑΓΚΟ & ΑΛΜΑΤΑ) ----
    let footZ = ikSpec.footZ || 0;
    if (feetMode === 'wall_sit') footZ = -0.10 + dims.lenUpLegL * 0.96;
    else if (feetMode === 'bridge') footZ = (cur.rZ || 0.06) + legReach * 0.56;
    else if (feetMode === 'hip_thrust') footZ = 0.14 + dims.lenUpLegL * 1.02;
    else if (feetMode === 'bench_press') footZ = 0.58;

    if (feetMode === 'planted' || feetMode === 'wall_sit' || feetMode === 'bridge' ||
        feetMode === 'hip_thrust' || feetMode === 'box_squat' || feetMode === 'seated' || feetMode === 'bench_press') {
      groundLock = 'ik';
      for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
        const ang = sgn * toeOut;
        const fDir = dirY(Math.sin(ang), 0, Math.cos(ang));
        const target = rotY(sgn * stanceHalf, dims.footHeight, footZ);
        const poleY = (feetMode === 'bridge' || feetMode === 'hip_thrust' || feetMode === 'bench_press') ? 0.74 : 0.38;
        const poleFwd = (feetMode === 'bridge' || feetMode === 'hip_thrust' || feetMode === 'bench_press') ? 0.18 : 0.62;
        const pole = target.clone().addScaledVector(fDir, poleFwd).addScaledVector(_Y, poleY);
        legs[Side] = { target, pole, mode: 'flat', footDir: fDir, pin: true };
      }
    } else if (feetMode === 'knee_pushup') {
      // Κάμψεις στα γόνατα: γόνατα καρφωμένα στο στρώμα, κνήμες & πέλματα σηκωμένα ψηλά!
      groundLock = 'ik';
      const shinDir = dirY(0, 0.72, -0.68);
      for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
        legs[Side] = {
          mode: 'knee_direct',
          kneePos: rotY(sgn * stanceHalf, 0.055, kneePushKneeZ),
          ankleDir: shinDir,
          kneeSec: _DOWN,
          shinSec: fwdW,
          footDir: dirY(0, 0.35, -0.92),
          pin: true,
        };
      }
    } else if (feetMode === 'quadruped') {
      // Γάτα-Αγελάδα: γόνατα καρφωμένα στο στρώμα, κνήμες επίπεδες πίσω
      groundLock = 'ik';
      const shinDir = dirY(0, -0.05, -1);
      for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
        legs[Side] = {
          mode: 'knee_direct',
          kneePos: rotY(sgn * stanceHalf, 0.055, -0.10),
          ankleDir: shinDir,
          kneeSec: fwdW,
          shinSec: _DOWN,
          footDir: shinDir,
          pin: true,
        };
      }
    } else if (feetMode === 'child_pose') {
      // Διάταση παιδιού: γόνατα στο στρώμα, κνήμες επίπεδες πίσω κάτω από τη λεκάνη
      groundLock = 'ik';
      const shinDir = dirY(0, -0.05, -1);
      for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
        legs[Side] = {
          mode: 'knee_direct',
          kneePos: rotY(sgn * stanceHalf, 0.055, -0.08),
          ankleDir: shinDir,
          kneeSec: fwdW,
          shinSec: _DOWN,
          footDir: shinDir,
          pin: true,
        };
      }
    } else if (feetMode === 'knee_side_plank') {
      // Πλάγια σανίδα στα γόνατα: γόνατα στο στρώμα, κνήμες λυγισμένες 90° πίσω
      groundLock = 'ik';
      const backDir = fwdW.clone().negate();
      const theta = cur.rrz || 1.32;
      const legEff = dims.lenUpLegR * 0.94;
      const kneeX = -(hipsPos ? 0 : 0) - legEff * Math.sin(theta);
      for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
        const yK = Side === 'Right' ? 0.055 : 0.135;
        legs[Side] = {
          mode: 'knee_direct',
          kneePos: rotY(kneeX, yK, 0.02),
          ankleDir: backDir,
          kneeSec: fwdW,
          shinSec: fwdW,
          footDir: backDir,
          pin: true,
        };
      }
    } else if (feetMode === 'bulgarian') {
      // Bulgarian split squat: μπροστινό πέλμα στο έδαφος, πίσω πέλμα υπερυψωμένο πάνω στον πάγκο (y=0.45m)!
      groundLock = 'ik';
      const frontIsRight = cur.hlx <= cur.hrx;
      for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
        const isFront = (Side === 'Right') === frontIsRight;
        const fDir = dirY(Math.sin(sgn * 0.05), 0, Math.cos(sgn * 0.05));
        if (isFront) {
          const target = rotY(sgn * stanceHalf, dims.footHeight, 0.34);
          const pole = target.clone().addScaledVector(fDir, 0.58).addScaledVector(_Y, 0.36);
          legs[Side] = { target, pole, mode: 'flat', footDir: fDir, pin: true };
        } else {
          const benchTop = 0.45;
          const toePos = rotY(sgn * stanceHalf, benchTop + 0.035, -0.56);
          const target = rotY(sgn * stanceHalf, benchTop + 0.075, -0.46);
          const pole = rotY(sgn * stanceHalf, 0.18, -0.05);
          legs[Side] = { target, pole, mode: 'toe', footDir: fwdW.clone().negate(), toePos, footUp: _DOWN, pin: true };
        }
      }
    } else if (feetMode === 'side_lunge') {
      // Πλάγιες εκπτώσεις: το ένα πέλμα καρφωμένο, το άλλο ανοίγει πλαγίως με λυγισμένο γόνατο
      groundLock = 'ik';
      const dir = cur.rX >= 0 ? 1 : -1; // +1 = Left stepping out (+X), -1 = Right stepping out (-X)
      const amt = clamp(Math.abs(cur.rX) / 0.30, 0, 1);
      const liftArc = amt > 0.04 && amt < 0.55 ? Math.sin(clamp(amt * 2.1, 0, 1) * Math.PI) * 0.07 : 0;
      for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
        const isLunge = sgn === dir;
        const fDir = dirY(Math.sin(sgn * 0.10), 0, Math.cos(sgn * 0.10));
        if (isLunge) {
          const xPos = dir * lerp(stanceHalf, 0.62, smootherstep(clamp(amt * 1.35, 0, 1)));
          const target = rotY(xPos, dims.footHeight + liftArc, 0.04);
          const pole = target.clone().addScaledVector(fDir, 0.58).addScaledVector(_Y, 0.36);
          legs[Side] = { target, pole, mode: 'flat', footDir: fDir, pin: amt < 0.05 || amt > 0.48 };
        } else {
          const target = rotY(-dir * stanceHalf, dims.footHeight, 0.0);
          const pole = target.clone().addScaledVector(fDir, 0.55).addScaledVector(_Y, 0.36);
          legs[Side] = { target, pole, mode: 'flat', footDir: fDir, pin: true };
        }
      }
    } else if (feetMode === 'one_arm_row') {
      // Αριστερό γόνατο (+X) στον πάγκο (y=0.45m), δεξί πέλμα (-X) καρφωμένο στο έδαφος
      groundLock = 'ik';
      const shinDir = dirY(0, -0.04, -1);
      legs.Left = {
        mode: 'knee_direct',
        kneePos: rotY(0.16, 0.45 + 0.055, -0.24),
        ankleDir: shinDir,
        kneeSec: fwdW,
        shinSec: _DOWN,
        footDir: shinDir,
        pin: true,
      };
      const fDirR = dirY(-0.14, 0, 0.99);
      const targetR = rotY(-0.24, dims.footHeight, -0.32);
      const poleR = targetR.clone().addScaledVector(fDirR, 0.52).addScaledVector(_Y, 0.38);
      legs.Right = { target: targetR, pole: poleR, mode: 'flat', footDir: fDirR, pin: true };
    } else if (feetMode === 'step_calf') {
      // Ανυψώσεις γάμπας σε σκαλί: μύτες καρφωμένες στο χείλος του σκαλιού (y=0.34m, z=+0.10), φτέρνες κάτω από το σκαλί στη φάση 0 και ψηλά στις μύτες στη φάση 1!
      groundLock = 'ik';
      const stepH = 0.34;
      const liftH = cur.lift > 0.005 ? Math.min(cur.lift * kScale, 0.062) : -0.056;
      for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
        const fDir = dirY(Math.sin(sgn * 0.05), 0, Math.cos(sgn * 0.05));
        const toePos = rotY(sgn * stanceHalf, stepH + dims.toeHeight, 0.11);
        const ankleY = stepH + dims.footHeight + liftH;
        const target = rotY(sgn * stanceHalf, ankleY, -0.02);
        const pole = target.clone().addScaledVector(fDir, 0.55).addScaledVector(_Y, 0.38);
        legs[Side] = { target, pole, mode: 'toe', footDir: fDir, toePos, footUp: _Y, pin: true };
      }
    } else if (feetMode === 'march') {
      // Περπάτημα επί τόπου / Farmer walk: το πόδι στήριξης καρφωμένο στο έδαφος, το άλλο ανεβαίνει
      groundLock = 'ik';
      const rightUp = cur.knL > 0.35 && cur.knL > cur.knR + 0.15;
      const leftUp = cur.knR > 0.35 && cur.knR > cur.knL + 0.15;
      for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
        if ((Side === 'Right' && rightUp) || (Side === 'Left' && leftUp)) continue;
        const fDir = dirY(Math.sin(sgn * toeOut), 0, Math.cos(sgn * toeOut));
        const target = rotY(sgn * stanceHalf, dims.footHeight, 0);
        const pole = target.clone().addScaledVector(fDir, 0.55).addScaledVector(_Y, 0.36);
        legs[Side] = { target, pole, mode: 'flat', footDir: fDir, pin: true };
      }
    } else if (feetMode === 'squat_jump' || feetMode === 'jump_rope') {
      if (cur.lift <= 0.03) {
        groundLock = 'ik';
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const ang = sgn * toeOut;
          const fDir = dirY(Math.sin(ang), 0, Math.cos(ang));
          const target = rotY(sgn * stanceHalf, dims.footHeight, 0);
          const pole = target.clone().addScaledVector(fDir, 0.58).addScaledVector(_Y, 0.36);
          legs[Side] = { target, pole, mode: 'flat', footDir: fDir, pin: true };
        }
      }
    } else if (feetMode === 'skater') {
      if (cur.lift <= 0.04) {
        groundLock = 'ik';
        // Πόδι στήριξης είναι αυτό με μικρότερο |hlx|? Στο skaterA: rX=-0.26 → Right (-X) στηρίζει!
        const plantSide = (cur.rX || 0) <= 0 ? 'Right' : 'Left';
        const sgn = plantSide === 'Left' ? 1 : -1;
        const fDir = dirY(Math.sin(sgn * 0.08), 0, Math.cos(sgn * 0.08));
        const target = rotY(cur.rX || 0, dims.footHeight, 0);
        const pole = target.clone().addScaledVector(fDir, 0.55).addScaledVector(_Y, 0.36);
        legs[plantSide] = { target, pole, mode: 'flat', footDir: fDir, pin: true };
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
      const tz = (isPlankLike || handsMode === 'bench_push') ? plankToeZ : (ikSpec.footZ || -0.56);
      for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
        const toePos = rotY(sgn * stanceHalf, dims.toeHeight, tz);
        const target = rotY(sgn * stanceHalf, dims.toeHeight + 0.105, tz + 0.065);
        const isProne = cur.rrx > 0.7;
        const pole = rotY(sgn * stanceHalf, isProne ? 0.05 : 0.45, tz + 0.45);
        legs[Side] = { target, pole, mode: 'toe', footDir: fwdW, toePos, footUp: _Y, pin: true };
      }
    } else if (feetMode === 'mountain_climber') {
      groundLock = 'ik';
      const pinRight = cur.knL < cur.knR;
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
      const stepPhase = clamp(splitAmt * 2.2, 0, 1);
      const liftArc = splitAmt > 0.04 && splitAmt < 0.55 ? Math.sin(stepPhase * Math.PI) * 0.075 : 0;

      for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
        const isFront = (Side === 'Right') === frontIsRight;
        const fDir = dirY(Math.sin(sgn * 0.05), 0, Math.cos(0.05));
        if (feetMode === 'reverse_lunge') {
          if (isFront) {
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

      if (handsMode === 'plank_tap') {
        groundLock = 'ik';
        const wristZ = plankHandZ - palmLen * 0.35;
        const leftTap01 = clamp((-cur.elR - 0.15) / 1.95, 0, 1);
        const rightTap01 = clamp((-cur.elL - 0.15) / 1.95, 0, 1);
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const tap01 = Side === 'Left' ? leftTap01 : rightTap01;
          const floorTgt = rotY(sgn * handHalf, 0.030, wristZ);
          if (tap01 > 0.04) {
            const oppSh = Side === 'Left' ? getShR() : getShL();
            const tapTgt = oppSh.clone().addScaledVector(fwdW, 0.045).addScaledVector(_Y, -0.025);
            const target = floorTgt.clone().lerp(tapTgt, smootherstep(tap01));
            const pole = target.clone().addScaledVector(rightW, sgn * 0.22).addScaledVector(_Y, -0.25).addScaledVector(fwdW, -0.25);
            aOut[Side] = { target, pole, forearmTwist: -1.15 };
          } else {
            const pole = rotY(sgn * (handHalf + 0.38 * flare), 0.28, wristZ - 0.50);
            aOut[Side] = {
              target: floorTgt, pole,
              forearmTwist: -1.35, humeralTwist: 0.16,
              handDir: fwdW.clone(), handPalm: _DOWN, pinFloor: true,
            };
          }
        }
      } else if (isPlankLike || handsMode === 'knee_floor' || handsMode === 'quadruped') {
        groundLock = 'ik';
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
      } else if (handsMode === 'child_pose') {
        groundLock = 'ik';
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const target = rotY(sgn * (shHalfW + 0.03), 0.028, 0.56);
          const pole = rotY(sgn * (shHalfW + 0.14), 0.18, 0.20);
          aOut[Side] = {
            target, pole,
            forearmTwist: -1.35,
            handDir: fwdW.clone(), handPalm: _DOWN, pinFloor: true,
          };
        }
      } else if (handsMode === 'wall_push') {
        groundLock = 'ik';
        const wallFaceZ = (meta.wallZ || 0.58) - 0.032;
        const shMid = getShMid();
        const handY = clamp(shMid.y - 0.04, 1.05, 1.38);
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const target = rotY(sgn * handHalf, handY, wallFaceZ);
          const pole = rotY(sgn * (handHalf + 0.30 * flare), handY - 0.28, wallFaceZ - 0.45);
          aOut[Side] = {
            target, pole,
            forearmTwist: -1.35,
            handDir: _Y.clone(), handPalm: fwdW.clone(),
          };
        }
      } else if (handsMode === 'bench_push') {
        groundLock = 'ik';
        const wristZ = incBenchEdgeZ - palmLen * 0.30;
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const target = rotY(sgn * handHalf, 0.468, wristZ);
          const pole = rotY(sgn * (handHalf + 0.34 * flare), 0.62, wristZ - 0.48);
          aOut[Side] = {
            target, pole,
            forearmTwist: -1.35, humeralTwist: 0.14,
            handDir: fwdW.clone(), handPalm: _DOWN,
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
          const pole = rotY(sgn * (handHalf + 0.03), 0.62, edgeZ - 0.68);
          aOut[Side] = {
            target, pole,
            forearmTwist: -1.35,
            handDir: fwdW.clone(), handPalm: _DOWN,
          };
        }
      } else if (handsMode === 'pullup_bar') {
        // Χέρια 100% καρφωμένα στο οριζόντιο μονόζυγο πόρτας (y=2.18m)
        const barY = 2.18;
        const gripHalf = shHalfW + 0.14;
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const target = rotY(sgn * gripHalf, barY - palmLen * 0.55, meta.pullupZ || 0.04);
          const pole = target.clone().addScaledVector(_Y, -0.50).addScaledVector(rightW, sgn * 0.32).addScaledVector(fwdW, 0.18);
          aOut[Side] = { target, pole, forearmTwist: -1.30 };
        }
      } else if (handsMode === 'bench_press') {
        // Πιέσεις στήθους σε πάγκο: αγκώνες κάτω δίπλα στον θώρακα → έκταση κατακόρυφα πάνω
        const press01 = clamp((1.68 + cur.elL) / 1.58, 0, 1);
        const shMid = getShMid();
        const halfX = e.barbell
          ? (shHalfW + 0.16)
          : lerp(shHalfW + 0.17, shHalfW + 0.04, press01);
        const yOff = lerp(0.14, armReach * 0.90, press01);
        const zOff = lerp(0.02, 0.04, press01);
        if (e.barbell) {
          meta.barPos = shMid.clone().addScaledVector(_Y, yOff + palmLen * 0.55).addScaledVector(fwdW, zOff);
          meta.barAxis = rightW.clone();
        }
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const target = shMid.clone()
            .addScaledVector(rightW, sgn * halfX)
            .addScaledVector(_Y, yOff)
            .addScaledVector(fwdW, zOff);
          const pole = shMid.clone()
            .addScaledVector(rightW, sgn * (halfX + 0.32))
            .addScaledVector(_Y, -0.35)
            .addScaledVector(fwdW, 0.12);
          aOut[Side] = { target, pole, forearmTwist: -1.25 };
        }
      } else if (handsMode === 'one_arm_row') {
        // Αριστερό χέρι (+X) καρφωμένο στον πάγκο, δεξί χέρι (-X) κωπηλατεί τον έναν αλτήρα
        aOut.Left = {
          target: rotY(0.18, 0.468, 0.34),
          pole: rotY(0.24, 0.62, -0.10),
          forearmTwist: -1.35,
          handDir: fwdW.clone(), handPalm: _DOWN,
        };
        const shR = getShR();
        const pull01 = clamp((-cur.elR - 0.08) / 1.54, 0, 1);
        const targetR = shR.clone()
          .addScaledVector(_Y, lerp(-armReach * 0.90, -0.16, pull01))
          .addScaledVector(fwdW, lerp(0.04, -0.12, pull01))
          .addScaledVector(rightW, -0.05);
        const poleR = shR.clone()
          .addScaledVector(_Y, 0.25)
          .addScaledVector(fwdW, -0.52)
          .addScaledVector(rightW, -0.12);
        aOut.Right = { target: targetR, pole: poleR, forearmTwist: 0 };
      } else if (handsMode === 'kickback') {
        // Εκτάσεις τρικεφάλων: βραχίονες κολλημένοι παράλληλα στον κορμό, πήχεις εκτείνονται πίσω!
        const ext01 = clamp((1.68 + cur.elL) / 1.60, 0, 1);
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const sh = Side === 'Left' ? getShL() : getShR();
          const elbowIdeal = sh.clone()
            .addScaledVector(fwdW, -dims.lenArmL * 0.85)
            .addScaledVector(_Y, -0.06)
            .addScaledVector(rightW, sgn * 0.04);
          const ang = lerp(Math.PI * 0.5, 0.08, ext01); // π/2 = κάτω, 0 = ευθεία πίσω
          const target = elbowIdeal.clone()
            .addScaledVector(fwdW, -dims.lenForeL * Math.cos(ang))
            .addScaledVector(_Y, -dims.lenForeL * Math.sin(ang));
          const pole = elbowIdeal.clone().addScaledVector(_Y, 0.45).addScaledVector(fwdW, -0.25);
          aOut[Side] = { target, pole, forearmTwist: 0 };
        }
      } else if (handsMode === 'tricep_ext') {
        // Υπερέκταση τρικεφάλων πάνω από το κεφάλι: αγκώνες ψηλά δίπλα στ' αυτιά (με καθαρό κενό μεταξύ αλτήρων!)
        const ext01 = clamp((2.28 + cur.elL) / 2.20, 0, 1);
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const sh = Side === 'Left' ? getShL() : getShR();
          const elbowIdeal = sh.clone()
            .addScaledVector(_Y, dims.lenArmL * 0.94)
            .addScaledVector(fwdW, 0.02)
            .addScaledVector(rightW, sgn * 0.04);
          const ang = lerp(2.25, 0.08, ext01);
          const target = elbowIdeal.clone()
            .addScaledVector(_Y, dims.lenForeL * Math.cos(ang))
            .addScaledVector(fwdW, -dims.lenForeL * Math.sin(ang))
            .addScaledVector(rightW, sgn * 0.03);
          const pole = elbowIdeal.clone().addScaledVector(fwdW, 0.55).addScaledVector(_Y, 0.25);
          aOut[Side] = { target, pole, forearmTwist: 0 };
        }
      } else if (handsMode === 'standing_row') {
        // Όρθια κωπηλατική με λάστιχο (άγκυρα μπροστά στο στήθος)
        meta.bandAnchor = 'front_chest';
        meta.bandAnchorPos = new THREE.Vector3(0, 1.18, 1.28);
        const shMid = getShMid();
        const pull01 = clamp((-cur.elL - 0.12) / 1.56, 0, 1);
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const target = shMid.clone()
            .addScaledVector(rightW, sgn * lerp(shHalfW + 0.01, shHalfW + 0.07, pull01))
            .addScaledVector(fwdW, lerp(armReach * 0.90, 0.06, pull01))
            .addScaledVector(_Y, lerp(-0.08, -0.16, pull01));
          const pole = target.clone().addScaledVector(fwdW, -0.52).addScaledVector(_Y, -0.14).addScaledVector(rightW, sgn * 0.10);
          aOut[Side] = { target, pole, forearmTwist: 0 };
        }
      } else if (handsMode === 'face_pull') {
        // Face pull (άγκυρα μπροστά-ψηλά, αγκώνες ψηλά & έξω, χέρια δίπλα στους κροτάφους)
        meta.bandAnchor = 'front_high';
        meta.bandAnchorPos = new THREE.Vector3(0, 1.78, 1.24);
        const shMid = getShMid();
        const pull01 = clamp((-cur.elL - 0.10) / 1.82, 0, 1);
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const target = shMid.clone()
            .addScaledVector(rightW, sgn * lerp(0.08, shHalfW + 0.14, pull01))
            .addScaledVector(fwdW, lerp(armReach * 0.88, 0.08, pull01))
            .addScaledVector(_Y, lerp(0.22, 0.18, pull01));
          const pole = shMid.clone()
            .addScaledVector(rightW, sgn * (shHalfW + 0.45))
            .addScaledVector(_Y, 0.26)
            .addScaledVector(fwdW, -0.32);
          aOut[Side] = { target, pole, forearmTwist: 0.35 };
        }
      } else if (handsMode === 'lat_pulldown') {
        // Lat pulldown με λάστιχο (άγκυρα ψηλά-μπροστά, έλξη αγκώνων κάτω στα πλευρά)
        meta.bandAnchor = 'front_high';
        meta.bandAnchorPos = new THREE.Vector3(0, 2.15, 0.72);
        const shMid = getShMid();
        const pull01 = clamp((-cur.elL - 0.14) / 1.88, 0, 1);
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const target = shMid.clone()
            .addScaledVector(rightW, sgn * lerp(shHalfW + 0.16, shHalfW + 0.12, pull01))
            .addScaledVector(fwdW, lerp(0.26, 0.12, pull01))
            .addScaledVector(_Y, lerp(armReach * 0.86, -0.02, pull01));
          const pole = target.clone().addScaledVector(_Y, -0.45).addScaledVector(rightW, sgn * 0.34).addScaledVector(fwdW, -0.18);
          aOut[Side] = { target, pole, forearmTwist: -1.15 };
        }
      } else if (handsMode === 'band_chest_press') {
        // Όρθιες πιέσεις στήθους με λάστιχο (άγκυρα πίσω στο στήθος)
        meta.bandAnchor = 'behind_chest';
        meta.bandAnchorPos = new THREE.Vector3(0, 1.18, -1.18);
        const shMid = getShMid();
        const press01 = clamp((1.78 + cur.elL) / 1.66, 0, 1);
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const target = shMid.clone()
            .addScaledVector(rightW, sgn * lerp(shHalfW + 0.12, shHalfW - 0.01, press01))
            .addScaledVector(fwdW, lerp(0.10, armReach * 0.90, press01))
            .addScaledVector(_Y, lerp(-0.08, -0.06, press01));
          const pole = target.clone().addScaledVector(fwdW, -0.48).addScaledVector(_Y, -0.14).addScaledVector(rightW, sgn * 0.34);
          aOut[Side] = { target, pole, forearmTwist: -1.30 };
        }
      } else if (handsMode === 'pallof_press') {
        // Pallof press: άγκυρα πλάγια στο στέρνο, ενωμένα χέρια πιέζουν ευθεία μπροστά χωρίς στροφή
        meta.bandAnchor = 'side_waist';
        meta.bandAnchorPos = new THREE.Vector3(1.18, 1.08, 0.08);
        meta.bandSingleHandle = true;
        const shMid = getShMid();
        const press01 = clamp((1.88 + cur.elL) / 1.76, 0, 1);
        const fwdD = lerp(0.22, armReach * 0.85, press01);
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const target = shMid.clone()
            .addScaledVector(rightW, sgn * 0.032)
            .addScaledVector(fwdW, fwdD)
            .addScaledVector(_Y, -0.18);
          const pole = target.clone().addScaledVector(fwdW, -0.42).addScaledVector(_Y, -0.22).addScaledVector(rightW, sgn * 0.28);
          aOut[Side] = { target, pole, forearmTwist: 0 };
        }
      } else if (handsMode === 'woodchop') {
        // Woodchop: διαγώνια κίνηση από ψηλά-αριστερά προς χαμηλά-δεξιά με στροφή κορμού
        meta.bandAnchor = 'side_high';
        meta.bandAnchorPos = new THREE.Vector3(1.12, 1.98, 0.14);
        meta.bandSingleHandle = true;
        const shMid = getShMid();
        const chop01 = clamp((0.68 - cur.ty) / 1.40, 0, 1);
        const center = shMid.clone()
          .addScaledVector(rightW, lerp(0.42, -0.36, chop01))
          .addScaledVector(_Y, lerp(0.42, -0.46, chop01))
          .addScaledVector(fwdW, lerp(0.28, 0.34, Math.sin(chop01 * Math.PI) * 0.4 + 0.6));
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const target = center.clone().addScaledVector(rightW, sgn * 0.035);
          const pole = target.clone().addScaledVector(fwdW, -0.35).addScaledVector(_Y, -0.25).addScaledVector(rightW, sgn * 0.22);
          aOut[Side] = { target, pole, forearmTwist: 0 };
        }
      } else if (handsMode === 'trx_y') {
        // TRX Y-raise: χέρια ανοίγουν τεντωμένα σε σχήμα Υ πάνω από το κεφάλι
        meta.trxAnchor = new THREE.Vector3(0, 2.42, 1.32);
        const shMid = getShMid();
        const raise01 = clamp((-cur.slx - 1.45) / 1.23, 0, 1);
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const target = shMid.clone()
            .addScaledVector(rightW, sgn * lerp(shHalfW + 0.02, shHalfW + armReach * 0.56, raise01))
            .addScaledVector(_Y, lerp(0.06, armReach * 0.78, raise01))
            .addScaledVector(fwdW, lerp(armReach * 0.90, 0.28, raise01));
          const pole = target.clone().addScaledVector(fwdW, -0.40).addScaledVector(_Y, -0.25).addScaledVector(rightW, sgn * 0.25);
          aOut[Side] = { target, pole, forearmTwist: 0 };
        }
      } else if (handsMode === 'jump_rope') {
        // Σχοινάκι: χέρια στο ύψος των γοφών, ελαφρώς έξω
        const shMid = getShMid();
        const hop = cur.lift > 0.03 ? 0.04 : 0;
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const target = shMid.clone()
            .addScaledVector(rightW, sgn * (shHalfW + 0.14))
            .addScaledVector(_Y, -torsoLen * 0.72 + hop)
            .addScaledVector(fwdW, 0.14);
          const pole = target.clone().addScaledVector(fwdW, -0.42).addScaledVector(_Y, 0.15).addScaledVector(rightW, sgn * 0.10);
          aOut[Side] = { target, pole, forearmTwist: 0 };
        }
      } else if (handsMode === 'farmer') {
        // Farmer walk: στιβαρά χέρια στα πλάγια με αλτήρες καθαρά έξω από τα παντελόνια/μηρούς
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const sh = Side === 'Left' ? getShL() : getShR();
          const target = sh.clone().addScaledVector(_Y, -armReach * 0.92).addScaledVector(rightW, sgn * 0.115);
          const pole = sh.clone().addScaledVector(_Y, -dims.lenArmL).addScaledVector(fwdW, -0.35).addScaledVector(rightW, sgn * 0.14);
          aOut[Side] = { target, pole, forearmTwist: 0 };
        }
      } else if (handsMode === 'back_bar') {
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
            .addScaledVector(_Y, palmLen * 0.85);
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
        meta.bandAnchor = 'hands';
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
      } else if ((e.kettlebell || e.goblet) && (m === MOTIONS.squat || m === MOTIONS.box_squat || m === MOTIONS.lunge || m === MOTIONS.reverse_lunge || m === MOTIONS.bulgarian_split_squat || m === MOTIONS.side_lunge || m === MOTIONS.step_up)) {
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

    let meta = {
      barPos: null, barAxis: null, barPad: false,
      bandMode: 'loop', bandAnchor: null, bandAnchorPos: null, bandSingleHandle: false,
      trxAnchor: null, benchZ: -0.40, benchX: 0, stepZ: 0.42, wallZ: -0.22, pullupZ: 0.04, ropeAngle: 0,
    };

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
      const isJump = this.motion === MOTIONS.jumping_jack || this.motion === MOTIONS.burpee ||
        this.motion === MOTIONS.high_knees || this.motion === MOTIONS.squat_jump ||
        this.motion === MOTIONS.skater_jump || this.motion === MOTIONS.jump_rope;
      const resolvedMeta = this.skinned.drive(T, hips, dt, {
        air: isJump ? Math.max(0, this.cur.lift * this.k) : 0,
        resolveIK: sk => this._resolveIK(sk, this.motion, this.cur, wp, ax, cy, cz),
        skipHair: true,
      });
      if (resolvedMeta) meta = resolvedMeta;
      // Motion capture πάνω από τη διαδικαστική πόζα, με ομαλή μετάβαση (idle → διαδικαστική στάση)
      // Οι κινήσεις motion capture είναι χωρίς βάρη: με αντικείμενο στα χέρια μένει η διαδικαστική (σωστή λαβή)
      const e = this.equip?.e || {};
      const handsBusy = !!(e.dumbbells || e.kettlebell || e.barbell || e.band || e.straps || e.goblet || e.singleDumbbell || e.jumpRope || e.pullupBar);
      const wantClip = this.clip && !handsBusy && this.mode !== 'idle' ? 1 : 0;
      this.clipW = (this.clipW ?? 0) + (wantClip - (this.clipW ?? 0)) * Math.min(1, dt * 6);
      if (this.clip && this.clipW > 0.001) applyClip(this.skinned, this.clip, this._clipTime(), this.yaw, this.clipW);
      this.skinned.updateHair(dt);
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
      bandAnchor: meta.bandAnchor,
      bandAnchorPos: meta.bandAnchorPos,
      bandSingleHandle: meta.bandSingleHandle,
      trxAnchor: meta.trxAnchor,
      benchZ: meta.benchZ,
      benchX: meta.benchX,
      stepZ: meta.stepZ,
      wallZ: meta.wallZ,
      pullupZ: meta.pullupZ,
      ropeAngle: this.mode === 'cycle' && this.motionKey === 'jump_rope'
        ? (this.t / Math.max(this.dur, 0.1)) * Math.PI * 2
        : meta.ropeAngle,
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

    // Contact shadow κάτω από τον κορμό σε ασκήσεις εδάφους (μόνο όταν υπάρχει στρώμα, όχι σε μονόζυγο/πάγκο/TRX)
    const torsoW = this.skinned ? this.skinned.worldPos('Spine1', this._v1) : wp(this.abdomen);
    const bodyOp = this.equip.e.mat ? 0.34 * clamp(1 - Math.max(0, torsoW.y - 0.12) / 0.45, 0, 1) : 0;
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
  async debug(key, u, alt = false, equip) {
    this.setMotion(key);
    await this.clipReady;
    this._debugU = u; this._debugMode = true;
    if (equip) this.setEquipment(equip);
    this.yaw = this.yawT;
    this.mode = u === 0 ? 'ready' : 'hold';
    this.cur = this.pose(u, alt);
    this.equipPose(this.cur);
    if (this.skinned) {
      this.skinned.offY = 0;
      this.skinned.resetHairPhysics();
    }
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
    this.skinned?.dispose?.();
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

