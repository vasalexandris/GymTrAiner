// Εξοπλισμός & σκηνικά όργανα που κρατά/χρησιμοποιεί ο coach.
// Ρεαλιστικά PBR υλικά, δυναμικά καμπύλα λάστιχα (zero-GC buffer update),
// ιμάντες TRX με διακλάδωση Y, Ολυμπιακή μπάρα, πάγκος, σκαλοπάτι και τοίχος.
import * as THREE from './vendor/three.module.min.js';

const RULES = {
  straps: /trx|ιμάντ|suspension|strap|αιωρούμεν/i,
  band: /λάστιχ|band|resistance|ελαστικ|λάστιχα|pull.?apart/i,
  kettlebell: /kettle|κέτλ|κετλ/i,
  barbell: /barbell|μπάρα(?!\s*(έλξ|ελξ|pull))|\bbar\b(?!\s*pull)/i,
  dumbbells: /αλτήρ|dumbbell|\bdb\b|μπουκάλι/i,
  mat: /στρώμα|mat\b|yoga|γιόγκα/i,
};

const FLOOR_MOTIONS = [
  'pushup', 'plank', 'crunch', 'glute_bridge', 'bird_dog',
  'mountain_climber', 'dead_bug', 'superman', 'side_plank', 'russian_twist',
];
const NO_HAND_WEIGHTS = [
  'pushup', 'plank', 'jumping_jack', 'high_knees', 'bird_dog',
  'mountain_climber', 'burpee', 'superman', 'side_plank', 'triceps_dip',
];

/** Επιστρέφει {dumbbells, kettlebell, band, straps, barbell, mat, goblet, bench, step, wall} για μια άσκηση. */
export function equipmentFor(ex, motion) {
  const eq = String(ex.equipment || '');
  const text = `${eq} ${ex.name || ''} ${ex.youtube_query || ''}`;
  const has = k => RULES[k].test(eq) || (k !== 'mat' && RULES[k].test(`${ex.name || ''} ${ex.youtube_query || ''}`));
  const e = {};
  for (const k of Object.keys(RULES)) if (has(k)) e[k] = true;

  if (/σώμα|bodyweight|χωρίς/i.test(eq) && !/αλτήρ|λάστιχ|band|kettle|μπάρα/i.test(eq)) {
    for (const k of ['dumbbells', 'kettlebell', 'barbell', 'band', 'straps']) {
      if (!RULES[k].test(ex.name || '')) delete e[k];
    }
  }
  if (/goblet|κύπελλο/i.test(text)) e.goblet = true;

  // Αυτόματη αντιστοίχιση εξοπλισμού βάσει εξειδικευμένων ασκήσεων
  if (motion === 'deadlift' || motion === 'back_squat' || motion === 'barbell_row') e.barbell = true;
  if (motion === 'band_pull_apart') e.band = true;
  if (motion === 'incline_row' || motion === 'trx_squat' || motion === 'trx_chest_press') e.straps = true;
  if (motion === 'triceps_dip' || motion === 'hip_thrust') e.bench = true;
  if (motion === 'step_up') e.step = true;
  if (motion === 'wall_sit') e.wall = true;

  if (e.kettlebell) delete e.dumbbells;
  if (e.barbell) { delete e.dumbbells; delete e.kettlebell; }
  if (e.straps) { delete e.dumbbells; delete e.kettlebell; delete e.barbell; }
  if (motion && FLOOR_MOTIONS.includes(motion)) e.mat = true;
  if (motion && NO_HAND_WEIGHTS.includes(motion)) {
    delete e.dumbbells; delete e.kettlebell; delete e.barbell;
  }
  return e;
}

const M = {
  rubber:  () => new THREE.MeshStandardMaterial({ color: 0x1b1e24, roughness: 0.76, metalness: 0.06 }),
  accent:  c  => new THREE.MeshStandardMaterial({ color: c, roughness: 0.50, metalness: 0.10 }),
  chrome:  () => new THREE.MeshStandardMaterial({ color: 0xe2e6ec, roughness: 0.16, metalness: 1.0 }),
  knurl:   () => new THREE.MeshStandardMaterial({ color: 0x9aa2ac, roughness: 0.44, metalness: 0.96 }),
  iron:    () => new THREE.MeshStandardMaterial({ color: 0x262930, roughness: 0.52, metalness: 0.65 }),
  latex:   c  => new THREE.MeshStandardMaterial({ color: c, roughness: 0.38, metalness: 0.02, side: THREE.DoubleSide }),
  strap:   () => new THREE.MeshStandardMaterial({ color: 0x181a1f, roughness: 0.88, metalness: 0.04 }),
  handle:  () => new THREE.MeshStandardMaterial({ color: 0xf4c430, roughness: 0.55, metalness: 0.06 }),
  mat:     () => new THREE.MeshStandardMaterial({ color: 0x4f4678, roughness: 0.92, metalness: 0.0 }),
  leather: () => new THREE.MeshStandardMaterial({ color: 0x252830, roughness: 0.54, metalness: 0.08 }),
  steel:   () => new THREE.MeshStandardMaterial({ color: 0x353942, roughness: 0.42, metalness: 0.82 }),
  stepTop: () => new THREE.MeshStandardMaterial({ color: 0x22262e, roughness: 0.85, metalness: 0.04 }),
  stepBox: () => new THREE.MeshStandardMaterial({ color: 0x3b4252, roughness: 0.72, metalness: 0.10 }),
  wall:    () => new THREE.MeshStandardMaterial({ color: 0xd6dce6, roughness: 0.90, metalness: 0.0, envMapIntensity: 0.45 }),
};

const shadow = o => {
  o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  return o;
};

function dumbbell() {
  const g = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.0155, 0.0155, 0.145, 16), M.knurl());
  bar.rotation.z = Math.PI / 2;
  g.add(bar);
  for (const s of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.074, 6), M.rubber());
    head.rotation.z = Math.PI / 2;
    head.position.x = s * 0.112;
    g.add(head);
    const bevel = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.058, 0.010, 6), M.rubber());
    bevel.rotation.z = Math.PI / 2;
    bevel.position.x = s * 0.153;
    g.add(bevel);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.006, 20), M.chrome());
    cap.rotation.z = Math.PI / 2;
    cap.position.x = s * 0.158;
    g.add(cap);
    const coll = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.023, 0.014, 16), M.chrome());
    coll.rotation.z = Math.PI / 2;
    coll.position.x = s * 0.070;
    g.add(coll);
  }
  return shadow(g);
}

function kettlebell() {
  const g = new THREE.Group();
  const iron = M.iron();
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.106, 28, 20), iron);
  bell.scale.set(1, 0.92, 0.96);
  bell.position.y = -0.145;
  g.add(bell);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.068, 0.020, 24), iron);
  base.position.y = -0.236;
  g.add(base);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.005, 8, 24), M.accent(0x22c55e));
  band.rotation.x = Math.PI / 2;
  band.position.y = -0.066;
  g.add(band);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.060, 0.0145, 12, 28, Math.PI), iron);
  handle.position.y = -0.055;
  g.add(handle);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.0145, 0.017, 0.062, 12), iron);
    leg.position.set(s * 0.060, -0.084, 0);
    g.add(leg);
  }
  return shadow(g);
}

function barbell() {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.32, 18), M.knurl());
  shaft.rotation.z = Math.PI / 2;
  g.add(shaft);
  for (const s of [-1, 1]) {
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.34, 18), M.chrome());
    sleeve.rotation.z = Math.PI / 2;
    sleeve.position.x = s * 0.78;
    g.add(sleeve);
    const stop = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.022, 18), M.chrome());
    stop.rotation.z = Math.PI / 2;
    stop.position.x = s * 0.61;
    g.add(stop);
    // Bumper plates (ακτίνα 0.19m → ταιριάζει με το ύψος deadlift!)
    const plates = [[0.65, 0.19, 0.040, 0x2563eb], [0.70, 0.155, 0.032, 0xeab308]];
    for (const [x, r, w, ringCol] of plates) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 32), M.rubber());
      p.rotation.z = Math.PI / 2;
      p.position.x = s * x;
      g.add(p);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.044, w + 0.004, 20), M.chrome());
      hub.rotation.z = Math.PI / 2;
      hub.position.x = s * x;
      g.add(hub);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.72, 0.004, 8, 28), M.accent(ringCol));
      ring.rotation.y = Math.PI / 2;
      ring.position.x = s * (x + s * (w * 0.5 + 0.001));
      g.add(ring);
    }
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.034, 16), M.chrome());
    collar.rotation.z = Math.PI / 2;
    collar.position.x = s * 0.745;
    g.add(collar);
  }
  // Αφρώδες μαξιλαράκι για hip thrust (φαίνεται μόνο σε hip_thrust)
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.36, 18), M.leather());
  pad.rotation.z = Math.PI / 2;
  pad.visible = false;
  pad.name = 'hipPad';
  g.add(pad);
  g.userData.pad = pad;
  return shadow(g);
}

/**
 * Δυναμικό καμπύλο λάστιχο αντίστασης (quadratic Bezier tube mesh).
 * Ενημερώνει τα buffers in-place χωρίς δεσμεύσεις μνήμης ανά καρέ, με ελαφριά
 * λέπτυνση κατά την επιμήκυνση (φαινόμενο Poisson).
 */
class CurvedBand {
  constructor(mat, segs = 16, radial = 8, baseRadius = 0.011, restLen = 0.75) {
    this.segs = segs;
    this.radial = radial;
    this.baseRadius = baseRadius;
    this.restLen = restLen;
    const vertCount = (segs + 1) * (radial + 1);
    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const indices = [];
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < radial; j++) {
        const a = i * (radial + 1) + j;
        const b = a + (radial + 1);
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setIndex(indices);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;

    this._p = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._alt = new THREE.Vector3(1, 0, 0);
  }

  /** Ενημερώνει το καμπύλο λάστιχο από a → b με σημείο ελέγχου ctrl. */
  update(a, ctrl, b) {
    const pos = this.mesh.geometry.attributes.position;
    const nrm = this.mesh.geometry.attributes.normal;
    const approxLen = a.distanceTo(ctrl) + ctrl.distanceTo(b);
    const stretch = Math.max(0.75, approxLen / Math.max(this.restLen, 0.1));
    const r = this.baseRadius / Math.sqrt(stretch);

    let idx = 0;
    for (let i = 0; i <= this.segs; i++) {
      const u = i / this.segs;
      const om = 1 - u;
      // P(u) = (1-u)^2 * a + 2(1-u)u * ctrl + u^2 * b
      this._p.set(
        om * om * a.x + 2 * om * u * ctrl.x + u * u * b.x,
        om * om * a.y + 2 * om * u * ctrl.y + u * u * b.y,
        om * om * a.z + 2 * om * u * ctrl.z + u * u * b.z
      );
      // P'(u) = 2(1-u)(ctrl - a) + 2u(b - ctrl)
      this._t.set(
        2 * om * (ctrl.x - a.x) + 2 * u * (b.x - ctrl.x),
        2 * om * (ctrl.y - a.y) + 2 * u * (b.y - ctrl.y),
        2 * om * (ctrl.z - a.z) + 2 * u * (b.z - ctrl.z)
      );
      if (this._t.lengthSq() < 1e-8) this._t.set(0, 1, 0);
      else this._t.normalize();

      const ref = Math.abs(this._t.y) < 0.92 ? this._up : this._alt;
      this._n.crossVectors(this._t, ref).normalize();
      this._b.crossVectors(this._t, this._n).normalize();

      for (let j = 0; j <= this.radial; j++) {
        const ang = (j / this.radial) * Math.PI * 2;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const nx = this._n.x * ca + this._b.x * sa;
        const ny = this._n.y * ca + this._b.y * sa;
        const nz = this._n.z * ca + this._b.z * sa;
        pos.setXYZ(idx, this._p.x + nx * r, this._p.y + ny * r, this._p.z + nz * r);
        nrm.setXYZ(idx, nx, ny, nz);
        idx++;
      }
    }
    pos.needsUpdate = true;
    nrm.needsUpdate = true;
  }
}

/** Ευθύγραμμος ιμάντας webbing (πλακέ ορθογώνια διατομή) */
function webbing(width, thickness, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(width, 1, thickness), mat);
  m.castShadow = true;
  return m;
}

/** Στιβαρός πάγκος / καρέκλα γυμναστικής (ύψος 0.45m) για triceps dip & hip thrust */
function benchProp() {
  const g = new THREE.Group();
  const steel = M.steel(), leather = M.leather(), rubber = M.rubber();
  const topH = 0.45;
  // Μαξιλάρι
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.065, 0.44), leather);
  pad.position.set(0, topH - 0.0325, 0);
  g.add(pad);
  // Μεταλλικό πλαίσιο
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.032, 0.36), steel);
  frame.position.set(0, topH - 0.08, 0);
  g.add(frame);
  // 4 πόδια με αντιολισθητικά πέλματα
  for (const sx of [-0.23, 0.23]) {
    for (const sz of [-0.16, 0.16]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, topH - 0.08, 12), steel);
      leg.position.set(sx, (topH - 0.08) * 0.5, sz);
      g.add(leg);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.016, 12), rubber);
      foot.position.set(sx, 0.008, sz);
      g.add(foot);
    }
  }
  return shadow(g);
}

/** Κουτί plyo step-up (ύψος 0.34m) με αντιολισθητική επιφάνεια */
function stepBoxProp() {
  const g = new THREE.Group();
  const h = 0.34;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.64, h - 0.018, 0.44), M.stepBox());
  body.position.y = (h - 0.018) * 0.5;
  g.add(body);
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.018, 0.45), M.stepTop());
  top.position.y = h - 0.009;
  g.add(top);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.652, 0.018, 0.452), M.accent(0x22c55e));
  stripe.position.y = h - 0.045;
  g.add(stripe);
  return shadow(g);
}

/** Καθαρό αρχιτεκτονικό πάνελ τοίχου για wall sit */
function wallPanelProp() {
  const g = new THREE.Group();
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.55, 2.25, 0.08), M.wall());
  panel.position.set(0, 1.125, -0.04);
  g.add(panel);
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.57, 0.08, 0.10), M.steel());
  base.position.set(0, 0.04, -0.04);
  g.add(base);
  return shadow(g);
}

const _tmpD = new THREE.Vector3();
const _tmpU = new THREE.Vector3(0, 1, 0);
const _tmpX = new THREE.Vector3(1, 0, 0);
const _tmpV1 = new THREE.Vector3();
const _tmpV2 = new THREE.Vector3();
const _tmpV3 = new THREE.Vector3();
const _tmpQ = new THREE.Quaternion();

const _junc = new THREE.Vector3();
function stretchSegment(m, a, b) {
  _tmpD.subVectors(b, a);
  const len = _tmpD.length();
  m.position.copy(a).addScaledVector(_tmpD, 0.5);
  m.scale.set(1, Math.max(len, 0.001), 1);
  if (len > 1e-5) m.quaternion.setFromUnitVectors(_tmpU, _tmpD.multiplyScalar(1 / len));
}

function alignX(obj, axis) {
  _tmpV1.copy(axis);
  if (_tmpV1.lengthSq() < 1e-6) _tmpV1.set(1, 0, 0);
  else _tmpV1.normalize();
  obj.quaternion.setFromUnitVectors(_tmpX, _tmpV1);
}

export class Equipment {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.e = {};
    this.o = {};
    this.set({});
  }

  _clearGroup() {
    this.group.traverse(o => {
      if (o.isMesh) {
        o.geometry?.dispose();
        if (o.material) {
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          ms.forEach(m => m.dispose());
        }
      }
    });
    this.group.clear();
  }

  set(e) {
    this.e = e || {};
    this._clearGroup();
    const add = o => { this.group.add(o); return o; };
    this.o = {};

    if (this.e.dumbbells && !this.e.goblet) this.o.db = [add(dumbbell()), add(dumbbell())];
    if (this.e.dumbbells && this.e.goblet) this.o.goblet = add(dumbbell());
    if (this.e.kettlebell) this.o.kb = add(kettlebell());
    if (this.e.barbell) this.o.bar = add(barbell());
    if (this.e.band) {
      const lMat = M.latex(0xe63946);
      this.o.bandL = new CurvedBand(lMat, 16, 8, 0.010, 0.80);
      this.o.bandR = new CurvedBand(lMat, 16, 8, 0.010, 0.80);
      this.o.bandH = new CurvedBand(lMat, 18, 8, 0.010, 0.55);
      add(this.o.bandL.mesh);
      add(this.o.bandR.mesh);
      add(this.o.bandH.mesh);
    }
    if (this.e.straps) {
      const st = M.strap(), hd = M.handle(), ch = M.chrome();
      this.o.mainStrap = add(webbing(0.032, 0.008, st));
      this.o.straps = [add(webbing(0.028, 0.007, st)), add(webbing(0.028, 0.007, st))];
      this.o.handles = [0, 1].map(() => {
        const hg = new THREE.Group();
        const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.13, 14), hd);
        grip.castShadow = true;
        hg.add(grip);
        for (const s of [-0.068, 0.068]) {
          const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.012, 12), st);
          cap.position.y = s;
          hg.add(cap);
        }
        return add(hg);
      });
      this.o.anchor = add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.045, 0.09), M.iron()));
      this.o.junction = add(new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 8, 16), ch));
    }
    if (this.e.mat) {
      const mat = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.008, 1.96), M.mat());
      mat.receiveShadow = true;
      this.o.mat = add(mat);
    }
    if (this.e.bench) this.o.bench = add(benchProp());
    if (this.e.step) this.o.step = add(stepBoxProp());
    if (this.e.wall) this.o.wall = add(wallPanelProp());
  }

  /** Ποσό «κλεισίματος» δαχτύλων ανά χέρι */
  grip() {
    const e = this.e;
    return e.dumbbells || e.kettlebell || e.barbell || e.band || e.straps ? 1 : 0.25;
  }

  /** Προτεινόμενο στυλ λαβής δαχτύλων */
  gripStyle() {
    const e = this.e;
    if (e.barbell) return 'bar';
    if (e.dumbbells) return 'dumbbell';
    if (e.kettlebell) return 'kettlebell';
    if (e.straps) return 'trx';
    if (e.band) return 'bar';
    return null;
  }

  /**
   * Ενημερώνει θέσεις & προσανατολισμούς εξοπλισμού σε world space.
   * h: { L:{pos,across}, R:{pos,across}, feet:{L,R}, figure, yaw, matZ,
   *      barPos?, barAxis?, barPad?, bandMode?, trxAnchor?, benchZ?, stepZ?, wallZ? }
   */
  update(h) {
    const o = this.o;
    const yawQ = _tmpQ.setFromAxisAngle(_tmpU, h.yaw || 0);

    if (o.db) {
      o.db.forEach((d, i) => {
        const s = i ? h.R : h.L;
        d.position.copy(s.pos);
        alignX(d, s.across);
      });
    }

    const mid = _tmpV2.copy(h.L.pos).add(h.R.pos).multiplyScalar(0.5);
    const across = _tmpV3.copy(h.R.pos).sub(h.L.pos);

    if (o.goblet) {
      o.goblet.position.copy(mid).addScaledVector(_tmpU, -0.025);
      alignX(o.goblet, _tmpU);
    }

    if (o.kb) {
      o.kb.position.copy(mid);
      _tmpV1.set(across.x, 0, across.z);
      if (_tmpV1.lengthSq() < 1e-4) _tmpV1.set(1, 0, 0).applyQuaternion(yawQ);
      alignX(o.kb, _tmpV1);
    }

    if (o.bar) {
      if (h.barPos && h.barAxis) {
        o.bar.position.copy(h.barPos);
        alignX(o.bar, h.barAxis);
      } else {
        o.bar.position.copy(mid);
        // Προστασία ώστε οι δίσκοι (ακτίνα 0.19m) να μην βυθίζονται κάτω από το πάτωμα
        if (o.bar.position.y < 0.192) o.bar.position.y = 0.192;
        alignX(o.bar, across.lengthSq() > 1e-4 ? across : _tmpV1.set(1, 0, 0).applyQuaternion(yawQ));
      }
      if (o.bar.userData.pad) o.bar.userData.pad.visible = !!h.barPad;
    }

    if (o.bandH) {
      if (h.bandMode === 'pull_apart') {
        o.bandL.mesh.visible = false;
        o.bandR.mesh.visible = false;
        o.bandH.mesh.visible = true;
        // Ελαφριά τόξωση μπροστά (μειώνεται όσο τεντώνει το λάστιχο)
        const dist = h.L.pos.distanceTo(h.R.pos);
        const slack = Math.max(0.015, 0.11 - dist * 0.07);
        const fwd = _tmpV1.set(0, -slack * 0.35, slack).applyQuaternion(yawQ);
        const ctrl = _tmpD.copy(mid).add(fwd);
        o.bandH.update(h.L.pos, ctrl, h.R.pos);
      } else {
        o.bandH.mesh.visible = false;
        o.bandL.mesh.visible = true;
        o.bandR.mesh.visible = true;
        // Ελαφριά εξωτερική καμπύλωση ανάμεσα στο πέλμα και το χέρι
        const sideL = _tmpV1.set(0.04, 0, 0.03).applyQuaternion(yawQ);
        const ctrlL = _tmpD.copy(h.feet.L).lerp(h.L.pos, 0.5).add(sideL);
        o.bandL.update(h.feet.L, ctrlL, h.L.pos);

        const sideR = _tmpV1.set(-0.04, 0, 0.03).applyQuaternion(yawQ);
        const ctrlR = _tmpD.copy(h.feet.R).lerp(h.R.pos, 0.5).add(sideR);
        o.bandR.update(h.feet.R, ctrlR, h.R.pos);
      }
    }

    if (o.straps) {
      const aLocal = h.trxAnchor || _tmpV1.set(0, 2.45, 1.20);
      const anchor = h.figure.localToWorld(_tmpV2.copy(aLocal));
      // Κεντρικός κρίκος διακλάδωσης Y 45cm κάτω από το σημείο αγκύρωσης προς τις παλάμες
      const handsMid = _tmpV3.copy(h.L.pos).add(h.R.pos).multiplyScalar(0.5);
      // ΠΡΟΣΟΧΗ: η stretchSegment χρησιμοποιεί το _tmpD ως scratch → η διακλάδωση χρειάζεται δικό της διάνυσμα
      const junc = _junc.subVectors(handsMid, anchor).normalize().multiplyScalar(0.45).add(anchor);
      o.anchor.position.copy(anchor);
      o.anchor.quaternion.copy(yawQ);
      o.junction.position.copy(junc);
      o.junction.quaternion.copy(yawQ);
      stretchSegment(o.mainStrap, anchor, junc);
      [h.L, h.R].forEach((s, i) => {
        stretchSegment(o.straps[i], junc, s.pos);
        o.handles[i].position.copy(s.pos);
        _tmpV1.copy(s.across);
        if (_tmpV1.lengthSq() < 1e-5) _tmpV1.set(1, 0, 0).applyQuaternion(yawQ);
        else _tmpV1.normalize();
        o.handles[i].quaternion.setFromUnitVectors(_tmpU, _tmpV1);
      });
    }

    if (o.mat) {
      o.mat.quaternion.copy(yawQ);
      o.mat.position.set(0, 0, h.matZ || 0).applyQuaternion(yawQ).setY(0.004);
    }

    if (o.bench) {
      o.bench.quaternion.copy(yawQ);
      o.bench.position.set(0, 0, h.benchZ ?? -0.40).applyQuaternion(yawQ).setY(0);
    }

    if (o.step) {
      o.step.quaternion.copy(yawQ);
      o.step.position.set(0, 0, h.stepZ ?? 0.42).applyQuaternion(yawQ).setY(0);
    }

    if (o.wall) {
      o.wall.quaternion.copy(yawQ);
      o.wall.position.set(0, 0, h.wallZ ?? -0.22).applyQuaternion(yawQ).setY(0);
    }
  }

  dispose() {
    this._clearGroup();
    this.group.removeFromParent();
  }
}
