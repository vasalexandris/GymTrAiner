// Εξοπλισμός & σκηνικά όργανα που κρατά/χρησιμοποιεί ο coach.
// Ρεαλιστικά PBR υλικά, δυναμικά καμπύλα λάστιχα με σύστημα αγκύρωσης (pole/door anchor),
// ιμάντες TRX με διακλάδωση Y, Ολυμπιακή μπάρα, μονόζυγο πόρτας, σχοινάκι, πάγκοι, σκαλοπάτι και τοίχος.
import * as THREE from './vendor/three.module.min.js';

const da = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // χωρίς τόνους

const RULES = {
  straps: /trx|ιμαντ|suspension|strap|αιωρουμεν/i,
  band: /λαστιχ|band|resistance|ελαστικ|pull.?apart|pallof|face\s*pull|wood.?chop/i,
  kettlebell: /kettle|κετλ/i,
  barbell: /barbell|μπαρα(?!\s*(ελξ|pull))|\bbar\b(?!\s*pull)/i,
  dumbbells: /αλτηρ|dumbbell|\bdb\b|μπουκαλι/i,
  mat: /στρωμα|mat\b|yoga|γιογκα/i,
};

const FLOOR_MOTIONS = [
  'pushup', 'knee_pushup', 'plank', 'plank_shoulder_tap',
  'crunch', 'leg_raise', 'bicycle_crunch', 'glute_bridge',
  'bird_dog', 'cat_cow', 'child_pose', 'mountain_climber',
  'dead_bug', 'superman', 'side_plank', 'knee_side_plank', 'russian_twist',
];

const NO_HAND_WEIGHTS = [
  'pushup', 'knee_pushup', 'wall_pushup', 'incline_pushup',
  'plank', 'plank_shoulder_tap', 'jumping_jack', 'high_knees', 'march_in_place',
  'bird_dog', 'cat_cow', 'child_pose', 'mountain_climber', 'burpee',
  'superman', 'side_plank', 'knee_side_plank', 'triceps_dip', 'pull_up',
  'leg_raise', 'bicycle_crunch', 'jump_rope',
];

const BAND_MOTIONS = {
  standing_row: 'front_chest',
  face_pull: 'front_high',
  lat_pulldown: 'front_high',
  band_chest_press: 'behind_chest',
  pallof_press: 'side_waist',
  woodchop: 'side_high',
  band_pull_apart: 'hands',
};

const DEFAULT_DB_MOTIONS = [
  'farmer_walk', 'tricep_kickback', 'tricep_extension', 'bench_press', 'seated_overhead_press',
];

/** Προσδιορίζει το σημείο αγκύρωσης λάστιχου (anchor) από το όνομα/εξοπλισμό & την κίνηση. */
export function resolveBandAnchor(ex, motion) {
  if (motion && BAND_MOTIONS[motion]) return BAND_MOTIONS[motion];
  const text = da(`${ex?.equipment || ''} ${ex?.name || ''} ${ex?.youtube_query || ''}`);
  if (/pull.?apart|διανοιξ/i.test(text)) return 'hands';
  if (/pallof|παλοφ|αντι.?στροφ/i.test(text)) return 'side_waist';
  if (/wood.?chop|ξυλοκοπ/i.test(text)) return 'side_high';
  if (/face\s*pull|lat\s*pull|pulldown|ψηλ.*αγκυρ|high\s*anchor|overhead\s*anchor/i.test(text)) return 'front_high';
  if (/low\s*anchor|χαμηλ.*αγκυρ/i.test(text)) return 'front_low';
  if (/(chest\s*press|πιεσ.*στηθ|behind|πισω)/i.test(text)) return 'behind_chest';
  if (/(door|πορτ|chest.?height|υψος\s*στηθ|standing.*row|ορθι.*κωπηλ)/i.test(text)) return 'front_chest';
  return 'feet';
}

/** Επιστρέφει τον εξοπλισμό {dumbbells, singleDumbbell, kettlebell, band, straps, barbell, mat, goblet, bench, benchStyle, step, wall, pullupBar, jumpRope} για μια άσκηση. */
export function equipmentFor(ex, motion) {
  const eq = da(ex?.equipment);
  const nm = da(`${ex?.name || ''} ${ex?.youtube_query || ''}`);
  const text = `${eq} ${nm}`;
  const has = k => RULES[k].test(eq) || (k !== 'mat' && RULES[k].test(nm));
  const e = {};
  for (const k of Object.keys(RULES)) if (has(k)) e[k] = true;

  if (/σωμα|bodyweight|χωρις/i.test(eq) && !/αλτηρ|λαστιχ|band|kettle|μπαρα/i.test(eq)) {
    for (const k of ['dumbbells', 'kettlebell', 'barbell', 'band', 'straps']) {
      if (!RULES[k].test(da(ex?.name))) delete e[k];
    }
  }
  if (/goblet|κυπελλο/i.test(text)) e.goblet = true;

  // Αυτόματη αντιστοίχιση εξοπλισμού & props βάσει εξειδικευμένων ασκήσεων
  if (motion === 'deadlift' || motion === 'back_squat' || motion === 'barbell_row') e.barbell = true;
  if (motion && BAND_MOTIONS[motion]) e.band = { anchor: BAND_MOTIONS[motion] };
  if (motion === 'incline_row' || motion === 'trx_squat' || motion === 'trx_chest_press' || motion === 'trx_y_raise') e.straps = true;

  if (motion === 'triceps_dip' || motion === 'hip_thrust' || motion === 'box_squat' ||
      motion === 'bulgarian_split_squat' || motion === 'incline_pushup' || motion === 'seated_overhead_press') {
    e.bench = true;
  }
  if (motion === 'bench_press') {
    e.bench = true;
    e.benchStyle = 'flat';
  }
  if (motion === 'one_arm_row') {
    e.bench = true;
    e.benchStyle = 'flat';
    e.singleDumbbell = 'R';
    delete e.dumbbells;
  }
  if (motion === 'step_up' || motion === 'step_calf_raise') e.step = true;
  if (motion === 'wall_sit' || motion === 'wall_pushup') e.wall = true;
  if (motion === 'pull_up') e.pullupBar = true;
  if (motion === 'jump_rope') e.jumpRope = true;

  if (motion && DEFAULT_DB_MOTIONS.includes(motion) && !e.barbell && !e.kettlebell && !e.band && !e.straps) {
    e.dumbbells = true;
  }

  // Κανονικοποίηση e.band → { anchor }
  if (e.band) {
    const anchor = typeof e.band === 'object' && e.band.anchor
      ? e.band.anchor
      : (typeof e.band === 'string' ? e.band : resolveBandAnchor(ex, motion));
    e.band = { anchor };
  }

  // Επίλυση συγκρούσεων εξοπλισμού χεριών
  if (e.kettlebell) delete e.dumbbells;
  if (e.barbell) { delete e.dumbbells; delete e.kettlebell; }
  if (e.straps) { delete e.dumbbells; delete e.kettlebell; delete e.barbell; delete e.band; }
  if (e.band && motion && BAND_MOTIONS[motion]) { delete e.dumbbells; delete e.kettlebell; delete e.barbell; }
  if (e.singleDumbbell) { delete e.dumbbells; delete e.kettlebell; delete e.barbell; }

  // Αποφυγή παραδόξων στρώματος: οι ασκήσεις εδάφους παίρνουν πάντα στρώμα,
  // ενώ οι όρθιες / με πάγκο / τοίχο / μονόζυγο / σκαλί ΔΕΝ εμφανίζουν στρώμα.
  if (motion && FLOOR_MOTIONS.includes(motion)) {
    e.mat = true;
  } else if (motion && motion !== 'generic' && motion !== 'burpee') {
    delete e.mat;
  }

  if (motion && NO_HAND_WEIGHTS.includes(motion)) {
    delete e.dumbbells; delete e.singleDumbbell; delete e.kettlebell; delete e.barbell;
  }
  return e;
}

const M = {
  rubber:  () => new THREE.MeshStandardMaterial({ color: 0x1b1e24, roughness: 0.76, metalness: 0.06 }),
  accent:  c  => new THREE.MeshStandardMaterial({ color: c, roughness: 0.50, metalness: 0.10 }),
  chrome:  () => new THREE.MeshStandardMaterial({ color: 0xe2e6ec, roughness: 0.16, metalness: 1.0 }),
  knurl:   () => new THREE.MeshStandardMaterial({ color: 0x9aa2ac, roughness: 0.44, metalness: 0.96 }),
  iron:    () => new THREE.MeshStandardMaterial({ color: 0x262930, roughness: 0.52, metalness: 0.65 }),
  latex:   c  => new THREE.MeshStandardMaterial({ color: c, roughness: 0.36, metalness: 0.04, side: THREE.DoubleSide }),
  strap:   () => new THREE.MeshStandardMaterial({ color: 0x181a1f, roughness: 0.88, metalness: 0.04 }),
  handle:  () => new THREE.MeshStandardMaterial({ color: 0xf4c430, roughness: 0.55, metalness: 0.06 }),
  mat:     () => new THREE.MeshStandardMaterial({ color: 0x4f4678, roughness: 0.92, metalness: 0.0 }),
  leather: () => new THREE.MeshStandardMaterial({ color: 0x252830, roughness: 0.54, metalness: 0.08 }),
  steel:   () => new THREE.MeshStandardMaterial({ color: 0x353942, roughness: 0.42, metalness: 0.82 }),
  stepTop: () => new THREE.MeshStandardMaterial({ color: 0x22262e, roughness: 0.85, metalness: 0.04 }),
  stepBox: () => new THREE.MeshStandardMaterial({ color: 0x3b4252, roughness: 0.72, metalness: 0.10 }),
  wall:    () => new THREE.MeshStandardMaterial({ color: 0xd6dce6, roughness: 0.90, metalness: 0.0, envMapIntensity: 0.45 }),
  wood:    () => new THREE.MeshStandardMaterial({ color: 0xb08a65, roughness: 0.68, metalness: 0.04 }),
  rope:    () => new THREE.MeshStandardMaterial({ color: 0x0ea5e9, roughness: 0.42, metalness: 0.08 }),
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

export const BARBELL_PLATE_R = 0.225; // πρότυπη Ολυμπιακή διάμετρος 450mm → ύψος deadlift 22.5cm

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
    const plates = [[0.65, BARBELL_PLATE_R, 0.042, 0x2563eb], [0.70, 0.175, 0.032, 0xeab308]];
    for (const [x, r, w, ringCol] of plates) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 32), M.rubber());
      p.rotation.z = Math.PI / 2;
      p.position.x = s * x;
      g.add(p);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, w + 0.004, 20), M.chrome());
      hub.rotation.z = Math.PI / 2;
      hub.position.x = s * x;
      g.add(hub);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.72, 0.0045, 8, 28), M.accent(ringCol));
      ring.rotation.y = Math.PI / 2;
      ring.position.x = s * (x + s * (w * 0.5 + 0.001));
      g.add(ring);
    }
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.034, 16), M.chrome());
    collar.rotation.z = Math.PI / 2;
    collar.position.x = s * 0.745;
    g.add(collar);
  }
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.36, 18), M.leather());
  pad.rotation.z = Math.PI / 2;
  pad.visible = false;
  pad.name = 'hipPad';
  g.add(pad);
  g.userData.pad = pad;
  return shadow(g);
}

/**
 * Δυναμικό καμπύλο λάστιχο αντίστασης / σχοινάκι (quadratic Bezier tube mesh).
 * Ενημερώνει τα buffers in-place χωρίς δεσμεύσεις μνήμης ανά καρέ, με ελαφριά
 * λέπτυνση κατά την επιμήκυνση (φαινόμενο Poisson).
 */
class CurvedBand {
  constructor(mat, segs = 18, radial = 8, baseRadius = 0.011, restLen = 0.75) {
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
      this._p.set(
        om * om * a.x + 2 * om * u * ctrl.x + u * u * b.x,
        om * om * a.y + 2 * om * u * ctrl.y + u * u * b.y,
        om * om * a.z + 2 * om * u * ctrl.z + u * u * b.z
      );
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
    return stretch;
  }
}

/** Ευθύγραμμος ιμάντας webbing (πλακέ ορθογώνια διατομή) */
function webbing(width, thickness, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(width, 1, thickness), mat);
  m.castShadow = true;
  return m;
}

/** Κατακόρυφος στύλος / δοκός αγκύρωσης λάστιχου (wall bar / door-anchor frame) με κινητό κρίκο D-ring */
function bandAnchorProp() {
  const g = new THREE.Group();
  const steel = M.steel(), rubber = M.rubber(), strap = M.strap(), chrome = M.chrome();

  // Στιβαρή βάση δαπέδου
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.024, 0.28), rubber);
  base.position.y = 0.012;
  g.add(base);

  // Κατακόρυφη ατσάλινη κολόνα 2.35m με ενδείξεις ύψους (οριζόντιες ράβδοι wall-bar)
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.028, 2.35, 16), steel);
  post.position.y = 1.18;
  g.add(post);

  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.025, 16), rubber);
  cap.position.y = 2.36;
  g.add(cap);

  for (const h of [0.30, 0.75, 1.18, 1.62, 2.05]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.005, 8, 18), chrome);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = h;
    g.add(ring);
  }

  // Κινητή θηλιά αγκύρωσης (anchor cuff + D-ring) που τοποθετείται στο ακριβές ύψος της άσκησης
  const cuff = new THREE.Group();
  const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.055, 16), strap);
  cuff.add(wrap);
  const dring = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.0055, 8, 18), chrome);
  dring.position.z = -0.044;
  cuff.add(dring);
  g.add(cuff);
  g.userData.cuff = cuff;

  return shadow(g);
}

/** Λαβή λάστιχου (αφρώδης λαβή + κρίκος) */
function bandHandleProp() {
  const hg = new THREE.Group();
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.125, 12), M.rubber());
  hg.add(grip);
  for (const s of [-0.065, 0.065]) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.010, 10), M.accent(0xe63946));
    cap.position.y = s;
    hg.add(cap);
  }
  return shadow(hg);
}

/** Μονόζυγο πόρτας (doorway pull-up frame με δύο κάθετους ορθοστάτες & οριζόντια μπάρα στα 2.18m) */
function pullupBarProp() {
  const g = new THREE.Group();
  const wood = M.wood(), steel = M.steel(), chrome = M.chrome(), rubber = M.rubber();
  const frameH = 2.38;
  const halfW = 0.56;
  const barY = 2.18;

  // Πλαίσιο πόρτας
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.085, frameH, 0.11), wood);
    post.position.set(s * (halfW + 0.042), frameH * 0.5, 0);
    g.add(post);
    const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.024, 14), steel);
    mount.rotation.z = Math.PI / 2;
    mount.position.set(s * (halfW - 0.005), barY, 0);
    g.add(mount);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 + 0.17, 0.095, 0.12), wood);
  lintel.position.set(0, frameH + 0.045, 0);
  g.add(lintel);

  // Οριζόντια ατσάλινη μπάρα + αντιολισθητικές λαβές αφρού
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, halfW * 2, 18), chrome);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, barY, 0);
  g.add(bar);

  for (const s of [-1, 1]) {
    const foam = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.24, 14), rubber);
    foam.rotation.z = Math.PI / 2;
    foam.position.set(s * 0.29, barY, 0);
    g.add(foam);
  }
  return shadow(g);
}

/** Στιβαρός πάγκος / καρέκλα γυμναστικής (ύψος 0.45m). Υποστηρίζει 'seat' (καρέκλα/κουτί) & 'flat' (μακρύς πάγκος βαρών). */
function benchProp(style = 'seat') {
  const g = new THREE.Group();
  const steel = M.steel(), leather = M.leather(), rubber = M.rubber();
  const topH = 0.45;
  const isFlat = style === 'flat';
  const w = isFlat ? 0.34 : 0.58;
  const d = isFlat ? 1.18 : 0.44;

  const pad = new THREE.Mesh(new THREE.BoxGeometry(w, 0.065, d), leather);
  pad.position.set(0, topH - 0.0325, 0);
  g.add(pad);

  const frame = new THREE.Mesh(new THREE.BoxGeometry(w - 0.08, 0.032, d - 0.08), steel);
  frame.position.set(0, topH - 0.08, 0);
  g.add(frame);

  const lx = isFlat ? (w * 0.38) : 0.23;
  const lz = isFlat ? (d * 0.40) : 0.16;
  for (const sx of [-lx, lx]) {
    for (const sz of [-lz, lz]) {
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

/** Κουτί plyo step-up / σκαλί γάμπας (ύψος 0.34m) με αντιολισθητική επιφάνεια */
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

/** Καθαρό αρχιτεκτονικό πάνελ τοίχου για wall sit & wall push-up */
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

/** Λαβή σχοινακιού */
function ropeHandleProp() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.135, 12), M.rubber());
  g.add(body);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.020, 12), M.accent(0x0ea5e9));
  tip.position.y = 0.075;
  g.add(tip);
  return shadow(g);
}

// Ανεξάρτητα scratch διανύσματα (χωρίς aliasing μεταξύ συναρτήσεων)
const _tmpD = new THREE.Vector3();
const _tmpU = new THREE.Vector3(0, 1, 0);
const _tmpX = new THREE.Vector3(1, 0, 0);
const _tmpV1 = new THREE.Vector3();
const _tmpV2 = new THREE.Vector3();
const _tmpV3 = new THREE.Vector3();
const _tmpV4 = new THREE.Vector3();
const _junc = new THREE.Vector3();
const _ctrl = new THREE.Vector3();
const _tmpQ = new THREE.Quaternion();
const _tmpQ2 = new THREE.Quaternion();

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
    if (this.e.singleDumbbell) this.o.singleDb = add(dumbbell());
    if (this.e.dumbbells && this.e.goblet) this.o.goblet = add(dumbbell());
    if (this.e.kettlebell) this.o.kb = add(kettlebell());
    if (this.e.barbell) this.o.bar = add(barbell());
    if (this.e.band) {
      const lMat = M.latex(0xe63946);
      this.o.bandMat = lMat;
      this.o.bandL = new CurvedBand(lMat, 18, 8, 0.010, 0.85);
      this.o.bandR = new CurvedBand(lMat, 18, 8, 0.010, 0.85);
      this.o.bandH = new CurvedBand(lMat, 18, 8, 0.010, 0.55);
      add(this.o.bandL.mesh);
      add(this.o.bandR.mesh);
      add(this.o.bandH.mesh);
      this.o.bandPole = add(bandAnchorProp());
      this.o.bandHandles = [add(bandHandleProp()), add(bandHandleProp())];
      this.o.bandPole.visible = false;
      this.o.bandHandles[0].visible = false;
      this.o.bandHandles[1].visible = false;
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
    if (this.e.jumpRope) {
      this.o.rope = new CurvedBand(M.rope(), 26, 6, 0.0055, 2.4);
      add(this.o.rope.mesh);
      this.o.ropeHandles = [add(ropeHandleProp()), add(ropeHandleProp())];
    }
    if (this.e.pullupBar) this.o.pullupBar = add(pullupBarProp());
    if (this.e.mat) {
      const mat = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.008, 1.96), M.mat());
      mat.receiveShadow = true;
      this.o.mat = add(mat);
    }
    if (this.e.bench) this.o.bench = add(benchProp(this.e.benchStyle || 'seat'));
    if (this.e.step) this.o.step = add(stepBoxProp());
    if (this.e.wall) this.o.wall = add(wallPanelProp());
  }

  /** Ποσό «κλεισίματος» δαχτύλων ανά χέρι */
  grip() {
    const e = this.e;
    return e.dumbbells || e.singleDumbbell || e.kettlebell || e.barbell || e.band || e.straps || e.pullupBar || e.jumpRope ? 1 : 0.25;
  }

  /** Προτεινόμενο στυλ λαβής δαχτύλων */
  gripStyle() {
    const e = this.e;
    if (e.barbell || e.pullupBar) return 'bar';
    if (e.dumbbells || e.singleDumbbell) return 'dumbbell';
    if (e.kettlebell) return 'kettlebell';
    if (e.straps) return 'trx';
    if (e.band || e.jumpRope) return 'bar';
    return null;
  }

  /**
   * Ενημερώνει θέσεις & προσανατολισμούς εξοπλισμού σε world space.
   * h: { L:{pos,across}, R:{pos,across}, feet:{L,R}, figure, yaw, matZ,
   *      barPos?, barAxis?, barPad?, bandAnchor?, bandAnchorPos?, bandSingleHandle?,
   *      trxAnchor?, benchZ?, benchX?, stepZ?, wallZ?, pullupZ?, ropeAngle? }
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

    if (o.singleDb) {
      const sideKey = this.e.singleDumbbell === 'L' ? 'L' : 'R';
      const s = h[sideKey];
      o.singleDb.position.copy(s.pos);
      alignX(o.singleDb, s.across);
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
        if (o.bar.position.y < BARBELL_PLATE_R) o.bar.position.y = BARBELL_PLATE_R;
        alignX(o.bar, h.barAxis);
      } else {
        o.bar.position.copy(mid);
        if (o.bar.position.y < BARBELL_PLATE_R) o.bar.position.y = BARBELL_PLATE_R;
        alignX(o.bar, across.lengthSq() > 1e-4 ? across : _tmpV1.set(1, 0, 0).applyQuaternion(yawQ));
      }
      if (o.bar.userData.pad) o.bar.userData.pad.visible = !!h.barPad;
    }

    // ---- ΣΥΣΤΗΜΑ ΑΓΚΥΡΩΣΗΣ ΛΑΣΤΙΧΩΝ (feet | hands | front_chest | front_high | front_low | behind_chest | side_waist | side_high) ----
    if (o.bandH) {
      const anchorKind = h.bandAnchor || (typeof this.e.band === 'object' ? this.e.band.anchor : null) || (h.bandMode === 'pull_apart' ? 'hands' : 'feet');
      if (anchorKind === 'hands') {
        o.bandL.mesh.visible = false;
        o.bandR.mesh.visible = false;
        o.bandH.mesh.visible = true;
        o.bandPole.visible = false;
        o.bandHandles[0].visible = false;
        o.bandHandles[1].visible = false;
        const dist = h.L.pos.distanceTo(h.R.pos);
        const slack = Math.max(0.010, 0.10 - dist * 0.068);
        const fwd = _tmpV1.set(0, -slack * 0.32, slack).applyQuaternion(yawQ);
        _ctrl.copy(mid).add(fwd);
        o.bandH.update(h.L.pos, _ctrl, h.R.pos);
      } else if (anchorKind === 'feet') {
        o.bandH.mesh.visible = false;
        o.bandL.mesh.visible = true;
        o.bandR.mesh.visible = true;
        o.bandPole.visible = false;
        o.bandHandles[0].visible = false;
        o.bandHandles[1].visible = false;
        const sideL = _tmpV1.set(0.09, 0, 0.06).applyQuaternion(yawQ);
        _ctrl.copy(h.feet.L).lerp(h.L.pos, 0.5).add(sideL);
        o.bandL.update(h.feet.L, _ctrl, h.L.pos);

        const sideR = _tmpV1.set(-0.09, 0, 0.06).applyQuaternion(yawQ);
        _ctrl.copy(h.feet.R).lerp(h.R.pos, 0.5).add(sideR);
        o.bandR.update(h.feet.R, _ctrl, h.R.pos);
      } else {
        // Σταθερή αγκύρωση σε στύλο/πόρτα: ορατός στύλος, κινητός κρίκος, τεντωμένο καμπύλο λάστιχο & λαβές
        const defaultAnchors = {
          front_chest:  [0.0,  1.18,  1.28],
          front_high:   [0.0,  1.92,  1.18],
          front_low:    [0.0,  0.28,  1.28],
          behind_chest: [0.0,  1.18, -1.16],
          side_waist:   [1.18, 1.08,  0.08],
          side_high:    [1.12, 1.98,  0.14],
        };
        const def = defaultAnchors[anchorKind] || defaultAnchors.front_chest;
        const aLocal = h.bandAnchorPos || _tmpV4.set(def[0], def[1], def[2]);
        const poleBase = _tmpV1.set(aLocal.x, 0, aLocal.z).applyQuaternion(yawQ);
        const anchorW = _junc.set(aLocal.x, aLocal.y, aLocal.z).applyQuaternion(yawQ);

        o.bandPole.visible = true;
        o.bandPole.position.copy(poleBase);
        // Προσανατολισμός κρίκου D-ring προς τον coach
        const toCoachAngle = Math.atan2(-aLocal.x, -aLocal.z);
        o.bandPole.quaternion.copy(yawQ).multiply(_tmpQ2.setFromAxisAngle(_tmpU, toCoachAngle + Math.PI));
        if (o.bandPole.userData.cuff) o.bandPole.userData.cuff.position.y = aLocal.y;

        // Υπολογισμός τάσης & καμπυλότητας (όσο μεγαλύτερη η έλξη, τόσο μειώνεται η κοιλιά του λάστιχου!)
        const updateStrand = (bandObj, handPos, lateralOff) => {
          const dist = anchorW.distanceTo(handPos);
          const sag = Math.max(0.008, Math.min(0.14, 0.15 - (dist - 0.55) * 0.13));
          _ctrl.copy(anchorW).lerp(handPos, 0.5);
          _ctrl.y -= sag;
          if (lateralOff) {
            _tmpV1.set(lateralOff, 0, 0).applyQuaternion(yawQ);
            _ctrl.add(_tmpV1);
          }
          return bandObj.update(anchorW, _ctrl, handPos);
        };

        o.bandH.mesh.visible = false;
        let maxStretch = 1.0;
        if (h.bandSingleHandle) {
          // Pallof press / Woodchop: ενιαία διπλή έλξη προς τις ενωμένες παλάμες
          o.bandL.mesh.visible = true;
          o.bandR.mesh.visible = false;
          maxStretch = updateStrand(o.bandL, mid, 0);
          o.bandHandles[0].visible = true;
          o.bandHandles[1].visible = false;
          o.bandHandles[0].position.copy(mid);
          o.bandHandles[0].quaternion.copy(yawQ);
        } else {
          o.bandL.mesh.visible = true;
          o.bandR.mesh.visible = true;
          // Στο behind_chest (πιέσεις στήθους με άγκυρα πίσω) τα δύο σκέλη ανοίγουν εξωτερικά γύρω από τα πλευρά/μασχάλες!
          const latBow = anchorKind === 'behind_chest' ? 0.30 : 0.015;
          const sL = updateStrand(o.bandL, h.L.pos, latBow);
          const sR = updateStrand(o.bandR, h.R.pos, -latBow);
          maxStretch = Math.max(sL, sR);
          [h.L, h.R].forEach((s, i) => {
            o.bandHandles[i].visible = true;
            o.bandHandles[i].position.copy(s.pos);
            _tmpV1.copy(s.across);
            if (_tmpV1.lengthSq() < 1e-5) _tmpV1.set(1, 0, 0).applyQuaternion(yawQ);
            else _tmpV1.normalize();
            o.bandHandles[i].quaternion.setFromUnitVectors(_tmpU, _tmpV1);
          });
        }
        // Απαλή οπτική ένδειξη αυξημένης τάσης στο υλικό του λάστιχου
        if (o.bandMat) {
          const t01 = Math.max(0, Math.min(1, (maxStretch - 1.0) / 0.85));
          o.bandMat.color.setRGB(0.90 + t01 * 0.08, 0.22 - t01 * 0.07, 0.27 - t01 * 0.07);
        }
      }
    }

    if (o.straps) {
      const aLocal = h.trxAnchor || _tmpV1.set(0, 2.42, 1.25);
      const anchor = h.figure.localToWorld(_tmpV2.copy(aLocal));
      const handsMid = _tmpV3.copy(h.L.pos).add(h.R.pos).multiplyScalar(0.5);
      // Χρήση ανεξάρτητου _junc (η stretchSegment χρησιμοποιεί το _tmpD)
      _junc.subVectors(handsMid, anchor).normalize().multiplyScalar(0.45).add(anchor);
      o.anchor.position.copy(anchor);
      o.anchor.quaternion.copy(yawQ);
      o.junction.position.copy(_junc);
      o.junction.quaternion.copy(yawQ);
      stretchSegment(o.mainStrap, anchor, _junc);
      [h.L, h.R].forEach((s, i) => {
        stretchSegment(o.straps[i], _junc, s.pos);
        o.handles[i].position.copy(s.pos);
        _tmpV1.copy(s.across);
        if (_tmpV1.lengthSq() < 1e-5) _tmpV1.set(1, 0, 0).applyQuaternion(yawQ);
        else _tmpV1.normalize();
        o.handles[i].quaternion.setFromUnitVectors(_tmpU, _tmpV1);
      });
    }

    // ---- ΣΧΟΙΝΑΚΙ (δυναμικό τόξο συγχρονισμένο με τη φάση του άλματος — σε Quadratic Bezier, ctrl.y = 2*yMin - yHands!) ----
    if (o.rope) {
      [h.L, h.R].forEach((s, i) => {
        o.ropeHandles[i].position.copy(s.pos);
        const outDir = _tmpV1.set(i ? -1 : 1, -0.25, 0.25).applyQuaternion(yawQ).normalize();
        o.ropeHandles[i].quaternion.setFromUnitVectors(_tmpU, outDir);
      });
      const ang = h.ropeAngle ?? 0; // 0 = ψηλά πάνω από το κεφάλι, π = ακριβώς κάτω από τα πέλματα (y≈0.02m)!
      const handY = mid.y;
      const apexY = 0.98 + Math.cos(ang) * 0.96; // 1.94m ψηλά ↔ 0.02m κάτω από τα πέλματα!
      const ctrlY = 2 * apexY - handY;
      const cz = Math.sin(ang) * 0.55;
      _ctrl.set(0, ctrlY, cz).applyQuaternion(yawQ);
      o.rope.update(h.L.pos, _ctrl, h.R.pos);
    }

    if (o.pullupBar) {
      o.pullupBar.quaternion.copy(yawQ);
      o.pullupBar.position.set(0, 0, h.pullupZ ?? 0.04).applyQuaternion(yawQ).setY(0);
    }

    if (o.mat) {
      o.mat.quaternion.copy(yawQ);
      o.mat.position.set(0, 0, h.matZ || 0).applyQuaternion(yawQ).setY(0.004);
    }

    if (o.bench) {
      o.bench.quaternion.copy(yawQ);
      o.bench.position.set(h.benchX ?? 0, 0, h.benchZ ?? -0.40).applyQuaternion(yawQ).setY(0);
    }

    if (o.step) {
      o.step.quaternion.copy(yawQ);
      o.step.position.set(0, 0, h.stepZ ?? 0.42).applyQuaternion(yawQ).setY(0);
    }

    if (o.wall) {
      const wz = h.wallZ ?? -0.22;
      // Όταν ο τοίχος είναι μπροστά (wz > 0, π.χ. wall push-up), περιστρέφεται 180° ώστε η όψη επαφής να είναι ακριβώς στο wz
      o.wall.quaternion.copy(yawQ);
      if (wz > 0) o.wall.quaternion.multiply(_tmpQ2.setFromAxisAngle(_tmpU, Math.PI));
      o.wall.position.set(0, 0, wz).applyQuaternion(yawQ).setY(0);
    }
  }

  dispose() {
    this._clearGroup();
    this.group.removeFromParent();
  }
}
