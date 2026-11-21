# GymTrAIner — 3D coach code bundle
Τα αρχεία του 3D coach. Δες `docs/3d-coach-handoff.md` για το prompt.

## js/ik.js

```javascript
// Αναλυτική αντίστροφη κινηματική (2-bone IK), ορθοκανονική βάση retargeting,
// όρια αρθρώσεων (ROM) και πολυφασικές καμπύλες keyframes για τον 3D coach.
import * as THREE from './vendor/three.module.min.js';

const _Y = new THREE.Vector3(0, 1, 0);
const _Z = new THREE.Vector3(0, 0, 1);
const _X = new THREE.Vector3(1, 0, 0);
const _m4 = new THREE.Matrix4();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _e3 = new THREE.Vector3();
const _D = new THREE.Vector3();
const _u = new THREE.Vector3();
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _qTmp = new THREE.Quaternion();

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = x => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
export const smootherstep = x => {
  const t = clamp(x, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/**
 * Καμπύλη επιτάχυνσης/επιβράδυνσης ανά τμήμα keyframe.
 * - 'inOut' (default): C2 quintic smootherstep (φυσική επιτάχυνση & φρενάρισμα)
 * - 'out'  : εκρηκτική εκκίνηση, ομαλό φρενάρισμα (concentric drive / άλμα)
 * - 'in'   : αργή εκκίνηση, επιταχυνόμενη κατάληξη (βαρυτική κάθοδος)
 * - 'cubic': κλασική cubic Hermite in-out
 * - 'linear': γραμμική
 */
export function easeValue(t01, ease = 'inOut') {
  const t = clamp(t01, 0, 1);
  if (ease === 'linear') return t;
  if (ease === 'out') return 1 - Math.pow(1 - t, 3);
  if (ease === 'in') return t * t * t;
  if (ease === 'cubic') return smoothstep(t);
  return smootherstep(t);
}

/**
 * Κατασκευάζει ορθοκανονική βάση (e1, e2, e3) σε quaternion:
 *   e1 = normalize(dir)                                 (κύριος άξονας οστού)
 *   e2 = normalize(sec - (sec · e1) * e1)               (δευτερεύων άξονας, Gram-Schmidt)
 *   e3 = e1 × e2                                        (δεξιόστροφος 3ος άξονας)
 * Αν dir || sec, επιλέγεται σταθερός εφεδρικός άξονας χωρίς gimbal flip.
 */
export function basisFromDirSec(dir, sec, out = new THREE.Quaternion()) {
  _e1.copy(dir);
  if (_e1.lengthSq() < 1e-10) _e1.copy(_Y);
  else _e1.normalize();

  _e2.copy(sec).addScaledVector(_e1, -sec.dot(_e1));
  if (_e2.lengthSq() < 1e-8) {
    const fb = Math.abs(_e1.y) < 0.9 ? _Y : _Z;
    _e2.copy(fb).addScaledVector(_e1, -fb.dot(_e1));
  }
  _e2.normalize();
  _e3.crossVectors(_e1, _e2);
  _m4.makeBasis(_e1, _e2, _e3);
  return out.setFromRotationMatrix(_m4);
}

/**
 * Περιστρέφει ένα δευτερεύον διάνυσμα `sec` γύρω από τον άξονα `axis` (πρηνισμός/υπτιασμός
 * αντιβραχίου ή στροφή βραχιονίου) in-place.
 */
export function applyAxialTwist(sec, axis, angleRad) {
  if (!angleRad) return sec;
  _e1.copy(axis).normalize();
  _qTmp.setFromAxisAngle(_e1, angleRad);
  return sec.applyQuaternion(_qTmp);
}

/**
 * Αναλυτικός επιλυτής 2-bone IK (Νόμος Συνημιτόνων + Pole Vector + Soft Extension):
 *
 * Δεδομένα:
 *   A = rootPos (ισχίο ή ώμος), T = targetPos (αστράγαλος ή καρπός),
 *   P = polePos (διάνυσμα/σημείο κατεύθυνσης γονάτου ή αγκώνα),
 *   L1, L2 = μήκη ανώτερου/κατώτερου τμήματος.
 *
 * Μαθηματική παραγωγή:
 *   1. Απόσταση-στόχος d_raw = ||T - A||, μονάδα u = (T - A) / d_raw.
 *   2. Soft-extension clamping (αποτρέπει το απότομο «κλείδωμα/pop» στην πλήρη έκταση):
 *        d_max  = (L1 + L2) * 0.999
 *        d_soft = d_max * (1 - softness)
 *        Για d_raw > d_soft:
 *          d = d_soft + (d_max - d_soft) * (1 - exp(-(d_raw - d_soft) / (d_max - d_soft)))
 *      Η συνάρτηση είναι C1 συνεχής στο d_soft και παραμένει αυστηρά d < d_max.
 *   3. Νόμος συνημιτόνων στο τρίγωνο (A, B, C) με πλευρές L1, L2, d:
 *        cos(α) = clamp((L1² + d² - L2²) / (2·L1·d), -1, 1)
 *        sin(α) = sqrt(max(0, 1 - cos²(α)))
 *      Για τη γωνία β στον τελικό κόμβο C:
 *        cos(β) = clamp((d - L1·cos(α)) / L2, -1, 1)
 *        sin(β) = clamp((L1·sin(α)) / L2, 0, 1)
 *   4. Επίπεδο κάμψης από το pole vector:
 *        n = normalize((P - A) - ((P - A)·u)·u)   (ή poleDir αν poleIsDir=true)
 *   5. Λυμένες θέσεις αρθρώσεων σε world space:
 *        B* = A + L1·(cos(α)·u + sin(α)·n)
 *        C* = A + d·u
 *        dir1 = normalize(B* - A) = cos(α)·u + sin(α)·n
 *        dir2 = normalize(C* - B*) = cos(β)·u - sin(β)·n
 *   6. Κλειστή μορφή κάθετων δευτερευόντων αξόνων στο επίπεδο κάμψης (χωρίς singularities):
 *        p1 = -sin(α)·u + cos(α)·n   (κάθετο στο dir1, πάντα προς +n)
 *        p2 = +sin(β)·u + cos(β)·n   (κάθετο στο dir2, πάντα προς +n)
 *      - Για πόδια: η επιγονατίδα/κνήμη κοιτάζει προς +n → sec1 = +p1, sec2 = +p2.
 *      - Για χέρια: ο αγκώνας προεξέχει προς +n, άρα η πρόσθια πλευρά (δικέφαλος/πτυχωση)
 *        κοιτάζει προς -n → sec1 = -p1, sec2 = -p2.
 */
export function solveTwoBoneIK(rootPos, targetPos, polePos, L1, L2, opts = {}, out = null) {
  const softness = opts.softness ?? 0.014;
  const poleIsDir = !!opts.poleIsDir;
  const minMargin = opts.minMargin ?? 0.02;

  const res = out || {
    midPos: new THREE.Vector3(),
    endPos: new THREE.Vector3(),
    dir1: new THREE.Vector3(),
    dir2: new THREE.Vector3(),
    p1: new THREE.Vector3(),
    p2: new THREE.Vector3(),
    poleNormal: new THREE.Vector3(),
    bendNormal: new THREE.Vector3(),
    clampedDist: 0,
    reachRatio: 0,
  };

  _D.subVectors(targetPos, rootPos);
  let dRaw = _D.length();
  if (dRaw < 1e-5) {
    _u.set(0, -1, 0);
    dRaw = 1e-5;
  } else {
    _u.copy(_D).multiplyScalar(1 / dRaw);
  }

  const dMin = Math.abs(L1 - L2) + minMargin;
  const dMax = (L1 + L2) * 0.999;
  const dSoft = Math.max(dMin + 1e-4, dMax * (1 - softness));

  let d;
  if (dRaw <= dSoft) {
    d = Math.max(dMin, dRaw);
  } else {
    const span = Math.max(dMax - dSoft, 1e-5);
    d = dSoft + span * (1 - Math.exp(-(dRaw - dSoft) / span));
  }

  // Προβολή pole vector κάθετα στον άξονα u
  if (poleIsDir) _p.copy(polePos);
  else _p.subVectors(polePos, rootPos);

  _n.copy(_p).addScaledVector(_u, -_p.dot(_u));
  if (_n.lengthSq() < 1e-8) {
    const fb = Math.abs(_u.z) < 0.9 ? _Z : _X;
    _n.copy(fb).addScaledVector(_u, -fb.dot(_u));
  }
  _n.normalize();

  // Νόμος συνημιτόνων
  const cosA = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const cosB = clamp((d - L1 * cosA) / L2, -1, 1);
  const sinB = clamp((L1 * sinA) / L2, 0, 1);

  // Διευθύνσεις τμημάτων: dir1 = cosA*u + sinA*n, dir2 = cosB*u - sinB*n
  res.dir1.copy(_u).multiplyScalar(cosA).addScaledVector(_n, sinA).normalize();
  res.dir2.copy(_u).multiplyScalar(cosB).addScaledVector(_n, -sinB).normalize();

  // Κάθετα διανύσματα στο επίπεδο κάμψης (προς +n)
  res.p1.copy(_u).multiplyScalar(-sinA).addScaledVector(_n, cosA).normalize();
  res.p2.copy(_u).multiplyScalar(sinB).addScaledVector(_n, cosB).normalize();

  // Θέσεις αρθρώσεων
  res.midPos.copy(rootPos).addScaledVector(res.dir1, L1);
  res.endPos.copy(rootPos).addScaledVector(_u, d);
  res.poleNormal.copy(_n);
  res.bendNormal.crossVectors(_n, _u).normalize();
  res.clampedDist = d;
  res.reachRatio = dRaw / (L1 + L2);
  return res;
}

/**
 * Βιομηχανικά όρια εύρους κίνησης (ROM σε rad) ανά παράμετρο πόζας.
 * Αποτρέπουν υπερέκταση γονάτων/αγκώνων και αφύσικες στροφές σπονδυλικής στήλης.
 */
export const JOINT_LIMITS = {
  tx:   [-0.65,  1.60], // κάμψη/έκταση κορμού
  ty:   [-1.10,  1.10], // στροφή κορμού (axial)
  tz:   [-0.55,  0.55], // πλάγια κλίση κορμού
  hd:   [-0.75,  0.75], // κλίση κεφαλής
  hdY:  [-1.05,  1.05], // στροφή κεφαλής
  hdZ:  [-0.45,  0.45], // πλάγια κλίση κεφαλής
  slx:  [-3.25,  1.25], // ώμος πρόσθια/οπίσθια κάμψη
  srx:  [-3.25,  1.25],
  slz:  [-3.05,  0.95], // L απαγωγή (αρνητικό = έξω)
  srz:  [-0.95,  3.05], // R απαγωγή (θετικό = έξω)
  slY:  [-1.65,  1.65], // στροφή βραχιονίου
  srY:  [-1.65,  1.65],
  elL:  [-2.68, -0.02], // αγκώνας: ΠΟΤΕ θετικό (όχι υπερέκταση!)
  elR:  [-2.68, -0.02],
  hlx:  [-2.25,  0.95], // ισχίο κάμψη/έκταση
  hrx:  [-2.25,  0.95],
  hlz:  [-1.15,  0.45], // L ισχίο απαγωγή
  hrz:  [-0.45,  1.15], // R ισχίο απαγωγή
  hlY:  [-0.75,  0.75], // στροφή ισχίου (toe-out)
  hrY:  [-0.75,  0.75],
  knL:  [ 0.00,  2.60], // γόνατο: ΠΟΤΕ αρνητικό (όχι υπερέκταση!)
  knR:  [ 0.00,  2.60],
  anL:  [-0.85,  1.25], // αστράγαλος
  anR:  [-0.85,  1.25],
  shL:  [-0.04,  0.07], // ανύψωση ωμοπλάτης
  shR:  [-0.04,  0.07],
  lift: [-0.25,  0.65],
  rrx:  [-2.20,  2.00],
  rrz:  [-1.65,  1.65],
  rX:   [-0.60,  0.60],
  rY:   [-0.10,  1.50],
  rZ:   [-1.20,  1.20],
};

/** Εφαρμόζει τα ανατομικά όρια σε μια πόζα in-place. */
export function clampPose(p) {
  for (const k in JOINT_LIMITS) {
    if (p[k] !== undefined) {
      const [lo, hi] = JOINT_LIMITS[k];
      if (p[k] < lo) p[k] = lo;
      else if (p[k] > hi) p[k] = hi;
    }
  }
  return p;
}

/**
 * Κατανομή κλίσης/κάμψης σπονδυλικής στήλης σε οσφυϊκή (Spine) και θωρακική (Spine1/Spine2) μοίρα:
 * - 'neutral': ασκήσεις φορτίου (squat, deadlift, hinge, row) — η οσφυϊκή παραμένει σταθερή/ουδέτερη,
 *   η κίνηση προέρχεται κυρίως από τα ισχία με ελαφριά θωρακική σταθεροποίηση.
 * - 'flex'   : κοιλιακοί (crunch, dead_bug) — ομαλή τμηματική κάμψη σε όλη τη σπονδυλική.
 * - 'ext'    : εκτάσεις ράχης (superman) — μεγαλύτερη έκταση στη θωρακική, προστατευμένη οσφυϊκή.
 * - 'twist'  : στροφικές (russian_twist) — η στροφή (ty) συγκεντρώνεται κυρίως στη θωρακική μοίρα.
 */
export function spineDistribution(tx, ty = 0, tz = 0, mode = 'neutral') {
  if (mode === 'flex') {
    return {
      lumbarX: tx * 0.38, thoracicX: tx * 0.62,
      lumbarY: ty * 0.25, thoracicY: ty * 0.75,
      lumbarZ: tz * 0.40, thoracicZ: tz * 0.60,
    };
  }
  if (mode === 'ext') {
    return {
      lumbarX: tx * 0.35, thoracicX: tx * 0.65,
      lumbarY: ty * 0.20, thoracicY: ty * 0.80,
      lumbarZ: tz * 0.40, thoracicZ: tz * 0.60,
    };
  }
  if (mode === 'twist') {
    return {
      lumbarX: tx * 0.45, thoracicX: tx * 0.55,
      lumbarY: ty * 0.22, thoracicY: ty * 0.78, // η θωρακική στρέφεται, η οσφυϊκή προστατεύεται
      lumbarZ: tz * 0.35, thoracicZ: tz * 0.65,
    };
  }
  // 'neutral' (default): braced lumbar spine — κύρια κλίση στον άξονα του ισχίου/πυέλου
  return {
    lumbarX: tx * 0.48, thoracicX: tx * 0.52,
    lumbarY: ty * 0.20, thoracicY: ty * 0.80,
    lumbarZ: tz * 0.42, thoracicZ: tz * 0.58,
  };
}

/**
 * Υπολογίζει την πόζα σε χρονική στιγμή t01 ∈ [0, 1] από πολυφασική λίστα keyframes
 * `keys = [{ t, p, ease? }, ...]`. Επιστρέφει νέο αντικείμενο με όλα τα κλειδιά του `allKeys`.
 */
export function evalKeyframes(keys, t01, allKeys, mirrorFn = null, out = {}) {
  const t = clamp(t01, 0, 1);
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const k0 = keys[i];
  const k1 = keys[Math.min(i + 1, keys.length - 1)];
  const span = Math.max(k1.t - k0.t, 1e-6);
  const localT = clamp((t - k0.t) / span, 0, 1);
  const w = easeValue(localT, k1.ease || 'inOut');
  const p0 = mirrorFn ? mirrorFn(k0.p) : k0.p;
  const p1 = mirrorFn ? mirrorFn(k1.p) : k1.p;
  for (let j = 0; j < allKeys.length; j++) {
    const k = allKeys[j];
    const a = p0[k] || 0;
    const b = p1[k] || 0;
    out[k] = a + (b - a) * w;
  }
  return clampPose(out);
}

```

## js/motions.js

```javascript
// Βιβλιοθήκη βιομηχανικών κινήσεων για τον 3D coach (πολυφασικά keyframes + επαφές IK).
// Συμβάσεις (ο χαρακτήρας κοιτάζει +z, +x = αριστερά του χαρακτήρα):
//  tx/ty/tz : κάμψη / στροφή / πλάγια κλίση κορμού (tx > 0 = κλίση μπροστά)
//  hd/hdY/hdZ : κλίση / στροφή / πλάγια κλίση κεφαλής
//  sl/sr x : ώμος (αρνητικό = ύψωση μπροστά) · z : απαγωγή (slz < 0, srz > 0 = έξω) · Y : στροφή βραχιονίου
//  elL/elR : αγκώνας (αρνητικό = κάμψη μπροστά, ≤ 0) · shL/shR : ανύψωση ωμοπλάτης
//  hl/hr x : ισχίο (αρνητικό = μπροστά) · z : απαγωγή · Y : εξωτερική στροφή
//  knL/knR : γόνατο (θετικό = κάμψη, ≥ 0) · anL/anR : αστράγαλος
//  rrx/rrz/rX/rY/rZ : προσανατολισμός & θέση πυέλου (floor / multi-phase κινήσεις)
import { evalKeyframes, clampPose } from './ik.js';

export const POSE_KEYS = [
  'tx', 'ty', 'tz', 'hd', 'hdY', 'hdZ',
  'slx', 'slz', 'slY', 'srx', 'srz', 'srY',
  'elL', 'elR', 'shL', 'shR',
  'hlx', 'hlz', 'hlY', 'hrx', 'hrz', 'hrY',
  'knL', 'knR', 'anL', 'anR',
  'lift', 'rrx', 'rrz', 'rX', 'rY', 'rZ',
];

const base = Object.fromEntries(POSE_KEYS.map(k => [k, 0]));
const P = o => clampPose({ ...base, ...o });
const arms = (x, out = 0, el = -0.08, y = 0) => ({ slx: x, srx: x, slz: -out, srz: out, elL: el, elR: el, slY: -y, srY: y });
const legs = (x, kn = 0, out = 0, y = 0) => ({ hlx: x, hrx: x, knL: kn, knR: kn, hlz: -out, hrz: out, hlY: -y, hrY: y });

export function mirror(p) {
  return {
    ...p,
    ty: -(p.ty || 0),
    tz: -(p.tz || 0),
    hdY: -(p.hdY || 0),
    hdZ: -(p.hdZ || 0),
    slx: p.srx, srx: p.slx,
    slz: -p.srz, srz: -p.slz,
    slY: -(p.srY || 0), srY: -(p.slY || 0),
    elL: p.elR, elR: p.elL,
    shL: p.shR || 0, shR: p.shL || 0,
    hlx: p.hrx, hrx: p.hlx,
    hlz: -p.hrz, hrz: -p.hlz,
    hlY: -(p.hrY || 0), hrY: -(p.hlY || 0),
    knL: p.knR, knR: p.knL,
    anL: p.anR, anR: p.anL,
    rrz: -(p.rrz || 0),
    rX: -(p.rX || 0),
  };
}

// Βοηθητικός κατασκευαστής τυπικού 5-φασικού κύκλου: A → anticipation → B → pause → follow-through → A
function phases(A, B, { brace, settle, toB = 0.46, hold = 0.10, easeDown = 'inOut', easeUp = 'out' } = {}) {
  const k = [{ t: 0, p: A }];
  if (brace) k.push({ t: 0.08, p: brace, ease: 'cubic' });
  k.push({ t: toB, p: B, ease: easeDown });
  if (hold > 0) k.push({ t: toB + hold, p: settle || B, ease: 'linear' });
  k.push({ t: 0.94, p: A, ease: easeUp });
  k.push({ t: 1.0, p: A, ease: 'cubic' });
  return k;
}

// ---- ΒΑΣΙΚΕΣ ΠΟΖΕΣ ----
const squatA = P({ tx: 0.04, ...arms(-0.18, 0.08, -0.18), ...legs(-0.06, 0.10, 0.05, 0.18) });
const squatBrace = P({ tx: 0.14, ...arms(-0.48, 0.06, -0.22), ...legs(-0.26, 0.30, 0.07, 0.20) });
const squatB = P({ tx: 0.48, ...arms(-1.62, 0.06, -0.14), ...legs(-1.42, 1.88, 0.14, 0.22) });
const squatDeep = P({ tx: 0.50, ...arms(-1.66, 0.06, -0.14), ...legs(-1.46, 1.93, 0.14, 0.22) });

const backSquatA = P({ tx: 0.06, ...arms(-0.45, 0.85, -1.95), ...legs(-0.06, 0.10, 0.06, 0.22) });
const backSquatBrace = P({ tx: 0.15, ...arms(-0.48, 0.85, -1.95), ...legs(-0.28, 0.32, 0.08, 0.22) });
const backSquatB = P({ tx: 0.42, ...arms(-0.52, 0.85, -1.95), ...legs(-1.42, 1.88, 0.15, 0.24) });

const lungeA = P({ tx: 0.03, ...arms(-0.18, 0.09, -0.22), ...legs(-0.03, 0.06, 0.03) });
const lungeStep = P({ tx: 0.06, rX: 0.03, hlx: -0.55, knL: 0.72, hrx: 0.10, knR: 0.18, slx: 0.10, srx: -0.45, elL: -0.45, elR: -0.65, slz: -0.09, srz: 0.09 });
const lungeB = P({ tx: 0.08, ty: 0.08, hlx: -1.16, knL: 1.38, hrx: 0.40, knR: 1.20, anR: 0.68, slx: 0.16, srx: -0.58, elL: -0.55, elR: -0.82, slz: -0.10, srz: 0.10 });

const revLungeStep = P({ tx: 0.10, rX: -0.03, hlx: -0.35, knL: 0.42, hrx: 0.35, knR: 0.45, slx: 0.10, srx: -0.42, elL: -0.45, elR: -0.75, slz: -0.09, srz: 0.09 });
const revLungeB = P({ tx: 0.11, ty: 0.08, hlx: -1.14, knL: 1.36, hrx: 0.46, knR: 1.24, anR: 0.72, slx: 0.16, srx: -0.56, elL: -0.55, elR: -0.85, slz: -0.10, srz: 0.10 });

const hingeA = P({ tx: 0.03, ...arms(-0.08, 0.06, -0.10), ...legs(-0.04, 0.08, 0.03) });
const hingeBrace = P({ tx: 0.24, ...arms(-0.28, 0.06, -0.10), ...legs(-0.18, 0.20, 0.03) });
const hingeB = P({ tx: 1.12, hd: 0.14, ...arms(-1.14, 0.06, -0.08), ...legs(-0.48, 0.42, 0.04) });

const dlBot = P({ tx: 1.00, hd: 0.12, ...arms(-1.04, 0.08, -0.06), ...legs(-0.98, 1.08, 0.07, 0.14) });
const dlPullSlack = P({ tx: 0.90, hd: 0.08, shL: -0.02, shR: -0.02, ...arms(-0.96, 0.08, -0.06), ...legs(-0.92, 1.02, 0.07, 0.14) });
const dlTop = P({ tx: 0.03, hd: 0.0, shL: -0.015, shR: -0.015, ...arms(-0.06, 0.08, -0.06), ...legs(-0.04, 0.06, 0.05, 0.14) });

const rowA = P({ tx: 0.88, hd: 0.08, ...arms(-0.90, 0.08, -0.08), ...legs(-0.46, 0.50, 0.04) });
const rowB = P({ tx: 0.86, hd: 0.06, shL: 0.02, shR: 0.02, ...arms(0.18, 0.16, -1.48), ...legs(-0.46, 0.50, 0.04) });

const bbRowA = P({ tx: 0.86, hd: 0.08, ...arms(-0.88, 0.10, -0.08), ...legs(-0.48, 0.52, 0.05, 0.12) });
const bbRowB = P({ tx: 0.84, hd: 0.06, shL: 0.02, shR: 0.02, ...arms(0.12, 0.24, -1.42), ...legs(-0.48, 0.52, 0.05, 0.12) });

const ohpA = P({ tx: 0.02, ...arms(-0.55, 0.36, -2.02), ...legs(-0.04, 0.08, 0.04) });
const ohpB = P({ tx: 0.01, shL: 0.045, shR: 0.045, ...arms(-2.96, 0.14, -0.08), ...legs(-0.03, 0.06, 0.04) });

const curlA = P({ tx: 0.02, ...arms(-0.06, 0.07, -0.10), ...legs(-0.03, 0.06, 0.03) });
const curlB = P({ tx: 0.02, ...arms(-0.22, 0.06, -2.38), ...legs(-0.03, 0.06, 0.03) });

const latA = P({ tx: 0.04, ...arms(-0.10, 0.10, -0.18), ...legs(-0.04, 0.08, 0.04) });
const latB = P({ tx: 0.05, shL: 0.02, shR: 0.02, ...arms(-0.20, 1.44, -0.28), ...legs(-0.04, 0.08, 0.04) });

const bandA = P({ tx: 0.03, ...arms(-1.52, -0.08, -0.14), ...legs(-0.04, 0.08, 0.04) });
const bandB = P({ tx: -0.02, shL: 0.02, shR: 0.02, ...arms(-1.42, 1.24, -0.18), ...legs(-0.04, 0.08, 0.04) });

const pushTop = P({ rrx: 1.25, rY: 0.36, rZ: 0.04, tx: 0.02, hd: -0.34, ...arms(-1.25, 0.12, -0.08), ...legs(0.02, 0.05) });
const pushBrace = P({ rrx: 1.29, rY: 0.33, rZ: 0.04, tx: 0.02, hd: -0.34, ...arms(-1.05, 0.22, -0.32), ...legs(0.02, 0.06) });
const pushBot = P({ rrx: 1.48, rY: 0.19, rZ: 0.03, tx: 0.02, hd: -0.32, ...arms(-0.34, 0.42, -1.58), ...legs(0.02, 0.06) });

const climbA = P({ rrx: 1.25, rY: 0.37, rZ: 0.04, tx: 0.05, hd: -0.32, ...arms(-1.25, 0.10, -0.08), ...legs(0.02, 0.08) });
const climbB = P({ rrx: 1.25, rY: 0.38, rZ: 0.04, tx: 0.12, ty: 0.10, hd: -0.30, ...arms(-1.25, 0.10, -0.08), hlx: -1.48, knL: 1.78, hrx: 0.06, knR: 0.08 });

const lie = { rrx: -1.57, rY: 0.14, rZ: 0.08, ...legs(-0.84, 1.98, 0.05) };
const crunchA = P({ ...lie, tx: 0.02, hd: 0.05, ...arms(-2.05, 0.58, -2.05) });
const crunchB = P({ ...lie, tx: 0.76, hd: 0.28, ...arms(-1.95, 0.46, -2.05) });

const bridgeA = P({ ...lie, ...arms(0.04, 0.18, -0.10) });
const bridgeB = P({ ...lie, rrx: -1.96, rY: 0.36, rZ: 0.06, ...legs(-0.04, 1.72, 0.06), ...arms(0.42, 0.18, -0.10) });

const hipThrustA = P({ rrx: -1.06, rY: 0.22, rZ: 0.12, tx: 0.20, hd: 0.34, ...legs(-1.35, 1.88, 0.08), ...arms(-0.62, 0.18, -0.85) });
const hipThrustB = P({ rrx: -1.56, rY: 0.44, rZ: 0.14, tx: 0.04, hd: 0.42, ...legs(-0.08, 1.56, 0.08), ...arms(-0.18, 0.18, -0.55) });

const deadBugA = P({ rrx: -1.57, rY: 0.14, rZ: 0.04, tx: 0.06, hd: 0.10, ...arms(-1.57, 0.06, -0.08), ...legs(-1.56, 1.56, 0.04) });
const deadBugB = P({ rrx: -1.57, rY: 0.14, rZ: 0.04, tx: 0.06, hd: 0.10, slx: -2.96, srx: -1.57, slz: -0.08, srz: 0.06, elL: -0.08, elR: -0.08, hlx: -1.56, knL: 1.56, hrx: -0.22, knR: 0.08, hlz: -0.04, hrz: 0.04 });

const supermanA = P({ rrx: 1.57, rY: 0.12, rZ: 0.0, tx: 0.02, hd: -0.20, ...arms(-2.95, 0.18, -0.12), ...legs(0.02, 0.06, 0.04) });
const supermanB = P({ rrx: 1.57, rY: 0.13, rZ: 0.0, tx: -0.44, hd: -0.16, ...arms(-2.52, 0.24, -0.14), ...legs(0.36, 0.10, 0.06) });

const sidePlankP = P({ rrx: 0.05, rrz: 1.28, rY: 0.405, rZ: 0.0, tx: 0.02, tz: -0.04, hdZ: -0.15, slx: -0.08, slz: -1.35, elL: -1.48, srx: 0.0, srz: 1.56, elR: -0.08, ...legs(0.0, 0.04, 0.02) });

const rTwistMid = P({ rrx: -0.78, rY: 0.15, rZ: 0.04, tx: 0.12, ty: 0.0, hd: 0.15, ...arms(-0.92, -0.28, -1.18), ...legs(-1.16, 1.48, 0.04) });
const rTwistR = P({ rrx: -0.78, rY: 0.15, rZ: 0.04, tx: 0.14, ty: -0.76, hd: 0.15, hdY: -0.35, slx: -0.82, srx: -0.96, slz: 0.36, srz: -0.20, elL: -1.25, elR: -1.10, ...legs(-1.18, 1.50, 0.04) });
const rTwistL = P({ rrx: -0.78, rY: 0.15, rZ: 0.04, tx: 0.14, ty: 0.76, hd: 0.15, hdY: 0.35, slx: -0.96, srx: -0.82, slz: 0.20, srz: -0.36, elL: -1.10, elR: -1.25, ...legs(-1.18, 1.50, 0.04) });

const stepUpA = P({ tx: 0.04, rZ: -0.04, ...arms(-0.14, 0.08, -0.22), ...legs(-0.04, 0.08, 0.03) });
const stepUpPlant = P({ tx: 0.18, rZ: 0.18, hlx: -1.12, knL: 1.35, hrx: 0.12, knR: 0.22, slx: 0.18, srx: -0.58, elL: -0.55, elR: -0.88, slz: -0.09, srz: 0.09 });
const stepUpTop = P({ tx: 0.04, rY: 0.34, rZ: 0.40, hlx: -0.04, knL: 0.06, hrx: -0.62, knR: 0.78, slx: -0.52, srx: 0.18, elL: -0.85, elR: -0.55, slz: -0.09, srz: 0.09 });

const wallSitP = P({ tx: -0.02, rZ: -0.08, ...arms(-0.22, 0.10, -0.35), ...legs(-1.54, 1.54, 0.06, 0.08) });

const dipTop = P({ rrx: 0.02, rY: 0.43, rZ: 0.02, tx: 0.04, ...arms(0.55, 0.08, -0.14), ...legs(-1.12, 1.12, 0.04) });
const dipBot = P({ rrx: 0.02, rY: 0.23, rZ: 0.04, tx: 0.08, ...arms(0.95, 0.08, -1.62), ...legs(-1.26, 1.30, 0.04) });

const trxRowA = P({ rrx: -0.60, rY: 0.80, rZ: -0.18, tx: 0.02, ...arms(-1.52, 0.08, -0.10), ...legs(0.02, 0.05, 0.04) });
const trxRowB = P({ rrx: -0.32, rY: 0.90, rZ: 0.02, tx: 0.0, shL: 0.02, shR: 0.02, ...arms(0.52, 0.20, -1.85), ...legs(0.02, 0.05, 0.04) });

const trxSquatA = P({ tx: -0.04, ...arms(-1.12, 0.08, -0.68), ...legs(-0.08, 0.12, 0.06, 0.18) });
const trxSquatB = P({ tx: 0.20, ...arms(-1.55, 0.08, -0.12), ...legs(-1.42, 1.88, 0.14, 0.22) });

const trxPressA = P({ rrx: 0.42, rY: 0.86, rZ: 0.10, tx: 0.02, hd: -0.12, ...arms(-1.18, 0.10, -0.12), ...legs(0.02, 0.06, 0.04) });
const trxPressB = P({ rrx: 0.68, rY: 0.74, rZ: 0.22, tx: 0.02, hd: -0.14, ...arms(-0.42, 0.42, -1.62), ...legs(0.02, 0.06, 0.04) });

const birdDogA = P({ rrx: 1.38, rY: 0.51, rZ: 0.0, tx: 0.04, hd: -0.24, ...arms(-1.38, 0.06, -0.08), ...legs(-1.38, 1.57, 0.04) });
const birdDogB = P({ rrx: 1.38, rY: 0.51, rZ: 0.0, tx: 0.02, hd: -0.22, slx: -2.92, srx: -1.38, slz: -0.06, srz: 0.06, elL: -0.08, elR: -0.08, hlx: -1.38, knL: 1.57, hrx: 0.16, knR: 0.06 });

// Burpee 9-φασικό πρόγραμμα
const burpeeStand = P({ tx: 0.03, rrx: 0, rY: 0.94, rZ: 0, ...arms(-0.14, 0.08, -0.18), ...legs(-0.05, 0.08, 0.04) });
const burpeeSquat = P({ tx: 0.62, rrx: 0.14, rY: 0.44, rZ: 0.02, ...arms(-1.05, 0.14, -0.16), ...legs(-1.58, 2.08, 0.12) });
const burpeePlank = P({ rrx: 1.25, rY: 0.36, rZ: 0.02, tx: 0.02, hd: -0.32, ...arms(-1.25, 0.12, -0.08), ...legs(0.02, 0.06) });
const burpeePush = P({ rrx: 1.48, rY: 0.19, rZ: 0.02, tx: 0.02, hd: -0.30, ...arms(-0.36, 0.42, -1.56), ...legs(0.02, 0.06) });
const burpeeJump = P({ tx: -0.04, rrx: 0, rY: 1.18, rZ: 0, lift: 0.24, ...arms(-2.96, 0.16, -0.10), ...legs(0.06, 0.06, 0.04), anL: 0.55, anR: 0.55 });
const burpeeLand = P({ tx: 0.18, rrx: 0, rY: 0.80, rZ: 0, ...arms(-0.42, 0.12, -0.35), ...legs(-0.56, 0.74, 0.06) });

// Jumping jack με ρεαλιστικό άλμα & απορρόφηση
const jjA = P({ tx: 0.02, ...arms(-0.05, 0.14, -0.14), ...legs(-0.04, 0.08, 0.06) });
const jjDip = P({ tx: 0.06, ...arms(-0.08, 0.18, -0.22), ...legs(-0.18, 0.28, 0.07) });
const jjAirOut = P({ tx: 0.0, lift: 0.08, ...arms(-0.10, 2.75, -0.18), ...legs(0.02, 0.06, 0.34) });
const jjWide = P({ tx: 0.05, lift: 0.0, ...arms(-0.10, 2.92, -0.16), ...legs(-0.16, 0.24, 0.38) });
const jjAirIn = P({ tx: 0.0, lift: 0.07, ...arms(-0.08, 1.15, -0.20), ...legs(0.02, 0.06, 0.16) });

const kneeA = P({ tx: 0.05, ...arms(-0.45, 0.08, -1.52), ...legs(-0.06, 0.14, 0.04) });
const kneeB = P({ tx: 0.06, ty: 0.16, lift: 0.045, slx: 0.42, srx: -1.02, slz: -0.08, srz: 0.08, elL: -1.55, elR: -1.68, hlx: -1.52, knL: 1.72, hrx: 0.10, knR: 0.16, anR: 0.32 });

const calfA = P({ tx: 0.02, ...arms(-0.08, 0.08, -0.14), ...legs(-0.03, 0.05, 0.03) });
const calfB = P({ tx: 0.02, lift: 0.095, ...arms(-0.08, 0.08, -0.14), ...legs(-0.02, 0.04, 0.03), anL: 0.85, anR: 0.85 });

export const MOTIONS = {
  // ---- ΑΡΧΙΚΕΣ 17 ΑΣΚΗΣΕΙΣ (ΔΙΑΤΗΡΟΥΝΤΑΙ ΟΛΑ ΤΑ ΚΛΕΙΔΙΑ) ----
  squat: {
    label: 'Καθίσματα', tempo: 3.0, prof: [0.46, 0.10, 0.44], yaw: 0.88,
    A: squatA, B: squatB,
    keys: phases(squatA, squatB, { brace: squatBrace, settle: squatDeep, toB: 0.46, hold: 0.10 }),
    ik: { feet: 'planted', stanceW: 0.34, toeOut: 0.22, hands: 'free', forearmTwist: 0, elbowFlare: 0.35, grip: 'relaxed', spine: 'neutral' },
  },
  lunge: {
    label: 'Προβολές', tempo: 3.4, prof: [0.48, 0.08, 0.44], yaw: 0.96, alt: true,
    A: lungeA, B: lungeB,
    keys: [
      { t: 0.00, p: lungeA },
      { t: 0.14, p: lungeStep, ease: 'cubic' },
      { t: 0.48, p: lungeB, ease: 'inOut' },
      { t: 0.56, p: lungeB, ease: 'linear' },
      { t: 0.86, p: lungeStep, ease: 'out' },
      { t: 1.00, p: lungeA, ease: 'cubic' },
    ],
    ik: { feet: 'split', stanceW: 0.24, toeOut: 0.05, hands: 'free', forearmTwist: 0, elbowFlare: 0.20, grip: 'relaxed', spine: 'neutral' },
  },
  hinge: {
    label: 'Έλξη ισχίου (RDL)', tempo: 3.4, prof: [0.48, 0.08, 0.44], yaw: 1.0,
    A: hingeA, B: hingeB,
    keys: phases(hingeA, hingeB, { brace: hingeBrace, toB: 0.48, hold: 0.08 }),
    ik: { feet: 'planted', stanceW: 0.26, toeOut: 0.10, hands: 'free', forearmTwist: -1.25, elbowFlare: 0.25, grip: 'bar', spine: 'neutral' },
  },
  row: {
    label: 'Κωπηλατική', tempo: 3.0, prof: [0.40, 0.12, 0.48], yaw: 1.0,
    A: rowA, B: rowB,
    keys: phases(rowA, rowB, { toB: 0.40, hold: 0.12, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'planted', stanceW: 0.28, toeOut: 0.12, hands: 'free', forearmTwist: 0, elbowFlare: 0.20, grip: 'dumbbell', spine: 'neutral' },
  },
  overhead_press: {
    palm: 'fwd', label: 'Πιέσεις ώμων', tempo: 3.0, prof: [0.42, 0.12, 0.46], yaw: 0.30,
    A: ohpA, B: ohpB,
    keys: phases(ohpA, ohpB, { toB: 0.42, hold: 0.12, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'planted', stanceW: 0.28, toeOut: 0.12, hands: 'free', forearmTwist: -1.25, elbowFlare: 0.45, grip: 'dumbbell', spine: 'neutral' },
  },
  curl: {
    palm: 'up', label: 'Κάμψεις δικεφάλων', tempo: 3.0, prof: [0.40, 0.12, 0.48], yaw: 0.46,
    A: curlA, B: curlB,
    keys: phases(curlA, curlB, { toB: 0.40, hold: 0.12, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'planted', stanceW: 0.24, toeOut: 0.10, hands: 'free', forearmTwist: 1.45, elbowFlare: 0.08, grip: 'dumbbell', spine: 'neutral' },
  },
  lateral_raise: {
    label: 'Πλάγιες ανυψώσεις', tempo: 3.0, prof: [0.40, 0.12, 0.48], yaw: 0.22,
    A: latA, B: latB,
    keys: phases(latA, latB, { toB: 0.40, hold: 0.12, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'planted', stanceW: 0.26, toeOut: 0.10, hands: 'free', forearmTwist: -0.35, elbowFlare: 0.70, grip: 'dumbbell', spine: 'neutral' },
  },
  jumping_jack: {
    label: 'Jumping jacks', tempo: 1.25, yaw: 0.20, noZ: true,
    A: jjA, B: jjWide,
    keys: [
      { t: 0.00, p: jjA },
      { t: 0.10, p: jjDip, ease: 'cubic' },
      { t: 0.34, p: jjAirOut, ease: 'out' },
      { t: 0.50, p: jjWide, ease: 'in' },
      { t: 0.60, p: jjWide, ease: 'linear' },
      { t: 0.80, p: jjAirIn, ease: 'out' },
      { t: 0.94, p: jjDip, ease: 'in' },
      { t: 1.00, p: jjA, ease: 'cubic' },
    ],
    ik: { feet: 'free', hands: 'free', forearmTwist: -0.45, elbowFlare: 0.65, grip: 'open', spine: 'neutral' },
  },
  high_knees: {
    label: 'Ψηλά γόνατα', tempo: 1.35, yaw: 0.55, alt: true, noZ: true,
    A: kneeA, B: kneeB,
    keys: [
      { t: 0.00, p: kneeA },
      { t: 0.44, p: kneeB, ease: 'out' },
      { t: 0.54, p: kneeB, ease: 'linear' },
      { t: 1.00, p: kneeA, ease: 'inOut' },
    ],
    ik: { feet: 'free', hands: 'free', forearmTwist: 0, elbowFlare: 0.18, grip: 'relaxed', spine: 'neutral' },
  },
  calf_raise: {
    label: 'Ανασηκώσεις γάμπας', tempo: 2.2, prof: [0.38, 0.22, 0.40], yaw: 0.78,
    A: calfA, B: calfB,
    keys: phases(calfA, calfB, { toB: 0.38, hold: 0.22, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'toe_raise', stanceW: 0.22, toeOut: 0.05, hands: 'free', forearmTwist: 0, elbowFlare: 0.18, grip: 'relaxed', spine: 'neutral' },
  },
  pushup: {
    palm: 'flat', label: 'Κάμψεις', tempo: 3.0, prof: [0.46, 0.08, 0.46], yaw: 1.25, floor: true, flatFeet: false,
    A: pushTop, B: pushBot,
    keys: phases(pushTop, pushBot, { brace: pushBrace, toB: 0.46, hold: 0.08, easeDown: 'inOut', easeUp: 'out' }),
    ik: { feet: 'toe', stanceW: 0.24, footZ: -0.80, hands: 'floor', handW: 0.54, handZ: 0.52, forearmTwist: -1.35, elbowFlare: 0.42, grip: 'floor', spine: 'neutral' },
  },
  plank: {
    palm: 'flat', label: 'Σανίδα', tempo: 3.0, yaw: 1.25, floor: true, hold: true, flatFeet: false,
    A: pushTop, B: pushTop,
    keys: [{ t: 0, p: pushTop }, { t: 1, p: pushTop }],
    ik: { feet: 'toe', stanceW: 0.24, footZ: -0.80, hands: 'floor', handW: 0.46, handZ: 0.52, forearmTwist: -1.35, elbowFlare: 0.28, grip: 'floor', spine: 'neutral' },
  },
  crunch: {
    label: 'Κοιλιακοί', tempo: 2.5, prof: [0.44, 0.12, 0.44], yaw: 1.25, floor: true,
    A: crunchA, B: crunchB,
    keys: phases(crunchA, crunchB, { toB: 0.44, hold: 0.12, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'bridge', stanceW: 0.26, footZ: 0.56, toeOut: 0.08, hands: 'free', forearmTwist: 0.6, elbowFlare: 0.70, grip: 'open', spine: 'flex' },
  },
  glute_bridge: {
    label: 'Γέφυρα γλουτών', tempo: 3.0, prof: [0.40, 0.20, 0.40], yaw: 1.25, floor: true,
    A: bridgeA, B: bridgeB,
    keys: phases(bridgeA, bridgeB, { toB: 0.40, hold: 0.20, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'bridge', stanceW: 0.28, footZ: 0.56, toeOut: 0.12, hands: 'free', forearmTwist: -1.35, elbowFlare: 0.22, grip: 'open', spine: 'neutral' },
  },
  incline_row: {
    label: 'Κωπηλατική με ιμάντες (TRX)', tempo: 3.0, prof: [0.40, 0.12, 0.48], yaw: 1.15, floor: true,
    frame: { h: 2.75, w: 2.4, cy: 1.22 },
    A: trxRowA, B: trxRowB,
    keys: phases(trxRowA, trxRowB, { toB: 0.40, hold: 0.12, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'planted', stanceW: 0.28, footZ: 0.44, toeOut: 0.08, hands: 'trx_pull', handW: 0.36, forearmTwist: 0, elbowFlare: 0.28, grip: 'trx', spine: 'neutral' },
  },
  bird_dog: {
    palm: 'flat', label: 'Bird-dog (στα τέσσερα)', tempo: 3.4, prof: [0.40, 0.20, 0.40], yaw: 1.22, floor: true, flatFeet: false, alt: true,
    A: birdDogA, B: birdDogB,
    keys: phases(birdDogA, birdDogB, { toB: 0.40, hold: 0.20 }),
    ik: { feet: 'bird_dog', stanceW: 0.24, hands: 'bird_dog', handW: 0.40, handZ: 0.44, forearmTwist: -1.35, elbowFlare: 0.24, grip: 'floor', spine: 'neutral' },
  },
  generic: {
    label: 'Κίνηση άσκησης', tempo: 2.4, yaw: 0.45, alt: true,
    A: P({ ...arms(-0.26, 0.08, -0.78), ...legs(-0.04, 0.08, 0.03) }),
    B: P({ ty: 0.10, slx: 0.18, srx: -0.78, slz: -0.08, srz: 0.08, elL: -0.95, elR: -1.25, hlx: -0.72, knL: 0.96, hrx: 0.04, knR: 0.08 }),
    ik: { feet: 'free', hands: 'free', forearmTwist: 0, elbowFlare: 0.22, grip: 'relaxed', spine: 'neutral' },
  },

  // ---- ΝΕΕΣ 17 ΑΣΚΗΣΕΙΣ ΜΕ ΑΚΡΙΒΗ ΒΙΟΜΗΧΑΝΙΚΗ ΤΕΧΝΙΚΗ ----
  mountain_climber: {
    palm: 'flat', label: 'Ορειβάτης (Mountain climber)', tempo: 1.35, yaw: 1.25, floor: true, flatFeet: false, alt: true,
    A: climbA, B: climbB,
    keys: [
      { t: 0.00, p: climbA },
      { t: 0.44, p: climbB, ease: 'out' },
      { t: 0.54, p: climbB, ease: 'linear' },
      { t: 1.00, p: climbA, ease: 'inOut' },
    ],
    ik: { feet: 'mountain_climber', stanceW: 0.24, footZ: -0.80, hands: 'floor', handW: 0.48, handZ: 0.52, forearmTwist: -1.35, elbowFlare: 0.28, grip: 'floor', spine: 'neutral' },
  },
  burpee: {
    palm: 'flat', label: 'Μπέρπι (Burpee)', tempo: 4.0, yaw: 1.15, floor: true, flatFeet: false,
    frame: { h: 2.45, w: 2.45, cy: 0.85 },
    A: burpeeStand, B: burpeePush,
    keys: [
      { t: 0.00, p: burpeeStand },
      { t: 0.14, p: burpeeSquat, ease: 'inOut' },
      { t: 0.28, p: burpeePlank, ease: 'out' },
      { t: 0.43, p: burpeePush, ease: 'inOut' },
      { t: 0.56, p: burpeePlank, ease: 'out' },
      { t: 0.70, p: burpeeSquat, ease: 'out' },
      { t: 0.85, p: burpeeJump, ease: 'out' },
      { t: 0.94, p: burpeeLand, ease: 'in' },
      { t: 1.00, p: burpeeStand, ease: 'cubic' },
    ],
    ik: { feet: 'burpee', stanceW: 0.28, footZ: -0.80, hands: 'floor_burpee', handW: 0.52, handZ: 0.52, forearmTwist: -1.35, elbowFlare: 0.40, grip: 'floor', spine: 'neutral' },
  },
  dead_bug: {
    label: 'Νεκρό έντομο (Dead bug)', tempo: 3.4, prof: [0.44, 0.12, 0.44], yaw: 1.25, floor: true, alt: true,
    A: deadBugA, B: deadBugB,
    keys: phases(deadBugA, deadBugB, { toB: 0.44, hold: 0.12 }),
    ik: { feet: 'free', hands: 'free', forearmTwist: 0, elbowFlare: 0.20, grip: 'open', spine: 'flex' },
  },
  superman: {
    label: 'Σούπερμαν (Superman)', tempo: 3.0, prof: [0.38, 0.24, 0.38], yaw: 1.25, floor: true, flatFeet: false,
    A: supermanA, B: supermanB,
    keys: phases(supermanA, supermanB, { toB: 0.38, hold: 0.24, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'free', hands: 'free', forearmTwist: -1.25, elbowFlare: 0.30, grip: 'open', spine: 'ext' },
  },
  side_plank: {
    palm: 'flat', label: 'Πλάγια σανίδα', tempo: 3.0, yaw: 0.35, floor: true, hold: true, flatFeet: false,
    frame: { h: 1.75, w: 2.35, cy: 0.46 },
    A: sidePlankP, B: sidePlankP,
    keys: [{ t: 0, p: sidePlankP }, { t: 1, p: sidePlankP }],
    ik: { feet: 'side_plank', hands: 'side_plank', forearmTwist: -1.1, elbowFlare: 0.35, grip: 'floor', spine: 'neutral' },
  },
  russian_twist: {
    label: 'Ρωσικές στροφές', tempo: 2.8, yaw: 0.55, floor: true,
    frame: { h: 1.75, w: 2.15, cy: 0.42 },
    A: rTwistMid, B: rTwistR,
    keys: [
      { t: 0.00, p: rTwistMid },
      { t: 0.22, p: rTwistR, ease: 'out' },
      { t: 0.28, p: rTwistR, ease: 'linear' },
      { t: 0.50, p: rTwistMid, ease: 'inOut' },
      { t: 0.72, p: rTwistL, ease: 'out' },
      { t: 0.78, p: rTwistL, ease: 'linear' },
      { t: 1.00, p: rTwistMid, ease: 'inOut' },
    ],
    ik: { feet: 'free', hands: 'free', forearmTwist: 0, elbowFlare: 0.45, grip: 'dumbbell', spine: 'twist' },
  },
  reverse_lunge: {
    label: 'Οπίσθιες προβολές', tempo: 3.4, prof: [0.48, 0.08, 0.44], yaw: 0.96, alt: true,
    A: lungeA, B: revLungeB,
    keys: [
      { t: 0.00, p: lungeA },
      { t: 0.14, p: revLungeStep, ease: 'cubic' },
      { t: 0.48, p: revLungeB, ease: 'inOut' },
      { t: 0.56, p: revLungeB, ease: 'linear' },
      { t: 0.86, p: revLungeStep, ease: 'out' },
      { t: 1.00, p: lungeA, ease: 'cubic' },
    ],
    ik: { feet: 'reverse_lunge', stanceW: 0.24, toeOut: 0.05, hands: 'free', forearmTwist: 0, elbowFlare: 0.20, grip: 'relaxed', spine: 'neutral' },
  },
  step_up: {
    label: 'Ανέβασμα σε σκαλοπάτι', tempo: 3.2, yaw: 0.95, alt: true, noZ: true,
    frame: { h: 2.50, w: 1.95, cy: 0.96 },
    A: stepUpA, B: stepUpTop,
    keys: [
      { t: 0.00, p: stepUpA },
      { t: 0.20, p: stepUpPlant, ease: 'cubic' },
      { t: 0.50, p: stepUpTop, ease: 'out' },
      { t: 0.60, p: stepUpTop, ease: 'linear' },
      { t: 0.84, p: stepUpPlant, ease: 'inOut' },
      { t: 1.00, p: stepUpA, ease: 'cubic' },
    ],
    ik: { feet: 'step_up', stanceW: 0.26, toeOut: 0.06, hands: 'free', forearmTwist: 0, elbowFlare: 0.22, grip: 'relaxed', spine: 'neutral', prop: 'step' },
  },
  wall_sit: {
    label: 'Κάθισμα στον τοίχο', tempo: 3.0, yaw: 1.05, hold: true, noZ: true,
    frame: { h: 2.15, w: 1.85, cy: 0.74 },
    A: wallSitP, B: wallSitP,
    keys: [{ t: 0, p: wallSitP }, { t: 1, p: wallSitP }],
    ik: { feet: 'wall_sit', stanceW: 0.32, footZ: 0.37, toeOut: 0.08, hands: 'free', forearmTwist: 0, elbowFlare: 0.24, grip: 'relaxed', spine: 'neutral', prop: 'wall' },
  },
  hip_thrust: {
    label: 'Ωθήσεις ισχίων (Hip thrust)', tempo: 3.0, prof: [0.40, 0.20, 0.40], yaw: 1.22, floor: true,
    frame: { h: 1.85, w: 2.45, cy: 0.46 },
    A: hipThrustA, B: hipThrustB,
    keys: phases(hipThrustA, hipThrustB, { toB: 0.40, hold: 0.20, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'hip_thrust', stanceW: 0.34, footZ: 0.60, toeOut: 0.14, hands: 'hip_bar', handW: 0.48, forearmTwist: -1.20, elbowFlare: 0.35, grip: 'bar', spine: 'neutral', prop: 'bench' },
  },
  deadlift: {
    label: 'Άρσεις θανάτου με μπάρα', tempo: 3.4, prof: [0.42, 0.14, 0.44], yaw: 0.96,
    A: dlBot, B: dlTop,
    keys: [
      { t: 0.00, p: dlBot },
      { t: 0.09, p: dlPullSlack, ease: 'cubic' },
      { t: 0.44, p: dlTop, ease: 'out' },
      { t: 0.58, p: dlTop, ease: 'linear' },
      { t: 0.92, p: dlBot, ease: 'inOut' },
      { t: 1.00, p: dlBot, ease: 'cubic' },
    ],
    ik: { feet: 'planted', stanceW: 0.28, toeOut: 0.14, hands: 'deadlift_bar', handW: 0.56, forearmTwist: -1.35, elbowFlare: 0.15, grip: 'bar', spine: 'neutral' },
  },
  back_squat: {
    label: 'Καθίσματα με μπάρα στην πλάτη', tempo: 3.2, prof: [0.46, 0.10, 0.44], yaw: 0.85,
    A: backSquatA, B: backSquatB,
    keys: phases(backSquatA, backSquatB, { brace: backSquatBrace, toB: 0.46, hold: 0.10 }),
    ik: { feet: 'planted', stanceW: 0.36, toeOut: 0.24, hands: 'back_bar', handW: 0.68, forearmTwist: -1.15, elbowFlare: 0.55, grip: 'bar', spine: 'neutral' },
  },
  barbell_row: {
    label: 'Κωπηλατική με μπάρα', tempo: 3.0, prof: [0.40, 0.12, 0.48], yaw: 0.96,
    A: bbRowA, B: bbRowB,
    keys: phases(bbRowA, bbRowB, { toB: 0.40, hold: 0.12, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'planted', stanceW: 0.30, toeOut: 0.14, hands: 'row_bar', handW: 0.58, forearmTwist: -1.30, elbowFlare: 0.28, grip: 'bar', spine: 'neutral' },
  },
  triceps_dip: {
    palm: 'flat', label: 'Βυθίσεις τρικεφάλων σε καρέκλα', tempo: 3.0, prof: [0.46, 0.08, 0.46], yaw: 1.15, floor: true,
    frame: { h: 1.95, w: 2.25, cy: 0.52 },
    A: dipTop, B: dipBot,
    keys: phases(dipTop, dipBot, { toB: 0.46, hold: 0.08, easeDown: 'inOut', easeUp: 'out' }),
    ik: { feet: 'planted', stanceW: 0.26, footZ: 0.66, toeOut: 0.06, hands: 'chair_dip', handW: 0.44, forearmTwist: -1.35, elbowFlare: 0.06, grip: 'chair', spine: 'neutral', prop: 'bench' },
  },
  band_pull_apart: {
    label: 'Διάνοιξη λάστιχου', tempo: 2.8, prof: [0.42, 0.14, 0.44], yaw: 0.22,
    A: bandA, B: bandB,
    keys: phases(bandA, bandB, { toB: 0.42, hold: 0.14, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'planted', stanceW: 0.26, toeOut: 0.10, hands: 'band_pull', forearmTwist: -1.25, elbowFlare: 0.45, grip: 'bar', spine: 'neutral' },
  },
  trx_squat: {
    label: 'Καθίσματα με TRX', tempo: 3.2, prof: [0.46, 0.10, 0.44], yaw: 1.05,
    frame: { h: 2.70, w: 2.40, cy: 1.15 },
    A: trxSquatA, B: trxSquatB,
    keys: phases(trxSquatA, trxSquatB, { toB: 0.46, hold: 0.10 }),
    ik: { feet: 'planted', stanceW: 0.34, toeOut: 0.20, hands: 'trx_pull', handW: 0.36, forearmTwist: 0, elbowFlare: 0.26, grip: 'trx', spine: 'neutral' },
  },
  trx_chest_press: {
    label: 'Πιέσεις στήθους με TRX', tempo: 3.0, prof: [0.46, 0.08, 0.46], yaw: 1.15, floor: true, flatFeet: false,
    frame: { h: 2.70, w: 2.45, cy: 1.15 },
    A: trxPressA, B: trxPressB,
    keys: phases(trxPressA, trxPressB, { toB: 0.46, hold: 0.08, easeDown: 'inOut', easeUp: 'out' }),
    ik: { feet: 'toe', stanceW: 0.28, footZ: -0.56, hands: 'trx_push', handW: 0.56, forearmTwist: -1.35, elbowFlare: 0.48, grip: 'trx', spine: 'neutral' },
  },
};

export const MOTION_KEYS = Object.keys(MOTIONS);

/**
 * Αξιολογεί μια κίνηση σε κανονικοποιημένο χρόνο κύκλου t01 ∈ [0, 1] (πλήρης επανάληψη).
 * Αν η κίνηση διαθέτει πολυφασικό πίνακα `keys`, χρησιμοποιείται αυτός· αλλιώς A ↔ B.
 */
export function sampleCycle(motion, t01, alt = false, out = {}) {
  const mFn = alt && motion.alt ? mirror : null;
  if (motion.keys && motion.keys.length >= 2) {
    return evalKeyframes(motion.keys, t01, POSE_KEYS, mFn, out);
  }
  const [a, h, b] = motion.prof || [0.5, 0, 0.5];
  let u;
  if (t01 < a) u = t01 / Math.max(a, 1e-6);
  else if (t01 < a + h) u = 1;
  else u = 1 - Math.min((t01 - a - h) / Math.max(b, 1e-6), 1);
  u = u * u * u * (u * (u * 6 - 15) + 10);
  const A = mFn ? mFn(motion.A) : motion.A;
  const B = mFn ? mFn(motion.B) : motion.B;
  for (let i = 0; i < POSE_KEYS.length; i++) {
    const k = POSE_KEYS[i];
    out[k] = (A[k] || 0) + ((B[k] || 0) - (A[k] || 0)) * u;
  }
  return clampPose(out);
}

/**
 * Κανόνες αναγνώρισης κίνησης από ελληνικά & αγγλικά ονόματα ασκήσεων.
 * Οι πιο εξειδικευμένοι κανόνες προηγούνται ώστε να μην «κλέβονται» από γενικούς.
 */
const RULES = [
  [/mountain.?climb|ορειβάτ/i, 'mountain_climber'],
  [/burpee|μπέρπι|μπερπι/i, 'burpee'],
  [/dead.?bug|νεκρό\s*έντομ/i, 'dead_bug'],
  [/bird.?dog|διαγώνια\s*έκταση|στα\s*τέσσερα|τετραποδ|quadruped|superman.*γόνατ/i, 'bird_dog'],
  [/superman|σούπερμαν|σουπερμαν|υπερέκταση\s*ράχ|ραχιαί/i, 'superman'],
  [/side\s*plank|πλάγια\s*σανίδ|πλαϊνή\s*σανίδ|πλάγιο\s*πλανκ/i, 'side_plank'],
  [/russian\s*twist|ρωσικ|στροφές\s*κορμού/i, 'russian_twist'],
  [/wall\s*sit|κάθισμα.*τοίχ|τοίχ.*κάθισμα|ισομετρικ.*κάθισμα/i, 'wall_sit'],
  [/step.?up|box\s*step|ανέβασμα.*(σκαλ|κουτ|πάγκ|box)|σκαλοπάτ/i, 'step_up'],
  [/hip\s*thrust|ώθησ.*ισχί|ωθήσ.*ισχί|ανύψωση\s*λεκάνης.*πάγκ/i, 'hip_thrust'],
  [/reverse\s*lunge|οπίσθι.*(προβολ|εκπτώσ)|πίσω\s*(προβολ|εκπτώσ)/i, 'reverse_lunge'],
  [/triceps?\s*dip|chair\s*dip|bench\s*dip|βυθίσ.*(τρικεφ|καρέκλ|πάγκ)|βουτι.*(τρικεφ|καρέκλ|πάγκ)|\bdips?\b/i, 'triceps_dip'],
  [/band\s*pull.?apart|pull.?apart|διάνοιξη.*λάστιχ|ανοίγματα.*λάστιχ|άνοιγμα.*λάστιχ/i, 'band_pull_apart'],
  [/(trx|ιμάντ|suspension).*(chest|push|press)|(chest|στήθ|πιέσ).*(trx|ιμάντ|suspension)/i, 'trx_chest_press'],
  [/(trx|ιμάντ|suspension).*(squat|καθίσμ|σκουάτ)|(squat|καθίσμ|σκουάτ).*(trx|ιμάντ|suspension)/i, 'trx_squat'],
  [/(trx|ιμάντ|suspension).*(row|κωπηλ|έλξ)|(row|κωπηλ|έλξ).*(trx|ιμάντ|suspension)|inverted\s*row|αντίστροφη\s*κωπηλ/i, 'incline_row'],
  [/back\s*squat|barbell.*squat|κάθισμα.*μπάρα.*πλάτ|καθίσματα.*μπάρα|μπάρα.*πλάτ/i, 'back_squat'],
  [/barbell.*row|bent.?over.*row|κωπηλατικ.*μπάρα|μπάρα.*κωπηλατικ/i, 'barbell_row'],
  [/romanian|rdl|ρουμανικ|good.?morning|swing|hip\s*hinge|έλξη\s*ισχίου/i, 'hinge'],
  [/deadlift|άρσ(η|εις)\s*θανάτ|νεκρ(ή|ές)\s*άρσ/i, 'deadlift'],
  [/jumping|jack|ανοιχτά\s*άλματα|άλματα\s*ανοι/i, 'jumping_jack'],
  [/high.?knee|ψηλά\s*γόνατα|τρέξιμο|jog|βάδην|march|skip/i, 'high_knees'],
  [/push.?up|κάμψεις|κάμψη.*(στήριξη|ώμων|στήθ)|pushup/i, 'pushup'],
  [/plank|σανίδα|πλανκ/i, 'plank'],
  [/lunge|εκπτώσ|προβολ|split\s*squat/i, 'lunge'],
  [/squat|καθίσματα|κάθισμα|σκουάτ/i, 'squat'],
  [/row|κωπηλ|έλξη|pull/i, 'row'],
  [/overhead|shoulder\s*press|military|πιέσεις\s*ώμων|πρέσα\s*ώμων|arnold/i, 'overhead_press'],
  [/lateral|πλάγι(α|ες)\s*ανύψω|side\s*raise/i, 'lateral_raise'],
  [/curl|δικέφαλ|biceps/i, 'curl'],
  [/crunch|κοιλιακ|sit.?up|bicycle|leg\s*raise/i, 'crunch'],
  [/bridge|γέφυρα|glute|γλουτ/i, 'glute_bridge'],
  [/calf|γάμπ|toe\s*raise/i, 'calf_raise'],
  [/bench|στήθους|chest/i, 'generic'],
];

export function inferMotion(ex) {
  let m = ex.motion && MOTIONS[ex.motion] ? ex.motion : null;
  const eqText = `${ex.equipment || ''} ${ex.name || ''} ${ex.youtube_query || ''}`;
  if (!m) {
    const name = `${ex.name || ''} ${ex.youtube_query || ''}`;
    m = (RULES.find(([re]) => re.test(name)) || [, 'generic'])[1];
  }
  const hasTrx = /trx|ιμάντ|suspension/i.test(eqText);
  const hasBar = /barbell|μπάρα(?!\s*(έλξ|ελξ|pull))|\bbar\b(?!\s*pull)/i.test(eqText);
  if (hasTrx) {
    if (m === 'row') m = 'incline_row';
    else if (m === 'squat') m = 'trx_squat';
    else if (m === 'pushup' || m === 'generic') {
      if (/chest|στήθ|press|πιέσ|push/i.test(eqText)) m = 'trx_chest_press';
    }
  }
  if (hasBar) {
    if (m === 'squat' && !/front|μπροστ/i.test(eqText)) m = 'back_squat';
    else if (m === 'row') m = 'barbell_row';
  }
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
// 3D Coach Avatar: σκηνή, 3-point φωτισμός στούντιο/σπιτιού, contact shadows,
// πολυφασική εκτέλεση κινήσεων με ακριβή χρονισμό (voice sync), αναλυτικό 2-bone IK
// για καρφωμένα πέλματα & παλάμες, και ενοποίηση με SkinnedCoach & Equipment.
import * as THREE from './vendor/three.module.min.js';
import { RoomEnvironment } from './vendor/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from './vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from './vendor/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from './vendor/jsm/postprocessing/OutputPass.js';
import { MOTIONS, POSE_KEYS, mirror, sampleCycle } from './motions.js';
import { loadCoachModel } from './skinned.js';
import { Equipment } from './equipment.js';
import { clamp, smootherstep, clampPose, spineDistribution, applyAxialTwist } from './ik.js';

const L = { thigh: 0.45, shin: 0.43, upper: 0.30, fore: 0.27, ankle: 0.07 };
const KEYS = POSE_KEYS;
const STAND = Object.fromEntries(KEYS.map(k => [k, 0]));

// Ρυθμός ακολουθίας ανά άρθρωση (μεγαλύτερο = πιο άμεση απόκριση· τα άκρα καθυστερούν ελαφρά → φυσική αδράνεια)
const RATE = {
  tx: 24, ty: 22, tz: 22, hd: 12, hdY: 12, hdZ: 12,
  slx: 20, slz: 20, slY: 18, srx: 20, srz: 20, srY: 18,
  elL: 18, elR: 18, shL: 16, shR: 16,
  hlx: 28, hlz: 28, hlY: 22, hrx: 28, hrz: 28, hrY: 22,
  knL: 28, knR: 28, anL: 22, anR: 22,
  lift: 32, rrx: 28, rrz: 26, rX: 24, rY: 30, rZ: 30,
};

// Αντιστοίχιση παλαιού πεδίου palm → στροφή αντιβραχίου (rad): >0 υπτιασμός, <0 πρηνισμός
const PALM_TO_TWIST = { up: 1.45, fwd: -1.25, flat: -1.35, neutral: 0 };

const _Y = new THREE.Vector3(0, 1, 0);
const _Z = new THREE.Vector3(0, 0, 1);
const _X = new THREE.Vector3(1, 0, 0);

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

    // Ψυχρό rim light πίσω-αριστερά για διαχωρισμό σιλουέτας
    const rim = new THREE.DirectionalLight(0xc2d8ff, 1.15);
    rim.position.set(-2.8, 2.7, -2.6);
    this.scene.add(rim);

    // Μαλακό fill light από αριστερά-μπροστά
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
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
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

    // Πύελος
    const pelvis = ball(0.125, bottom, 1.12 * K.hip, 0.78, 0.84);
    pelvis.position.y = 0.03;
    this.hips.add(pelvis);

    // Κοιλιά + θώρακας (2 τμήματα → φυσική καμπύλη σπονδυλικής)
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

    // Κεφάλι
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

    // Μαλλιά
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

    // Χέρια (aL = -X = ανατομικά Δεξί, aR = +X = ανατομικά Αριστερό)
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

    // Πόδια
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
    // Διακριτική μικρο-παραλλαγή ανά επανάληψη (±1.5%) ώστε η κίνηση να μην είναι ρομποτική
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

  /** u: 0..1 στο τρέχον στάδιο· διατηρείται για συμβατότητα */
  progress(t01) {
    const [a, h, b] = this.motion.prof || [0.5, 0, 0.5];
    if (t01 < a) return smootherstep(t01 / Math.max(a, 1e-6));
    if (t01 < a + h) return 1;
    return 1 - smootherstep(Math.min((t01 - a - h) / Math.max(b, 1e-6), 1));
  }

  /** Παρεμβολή πόζας σε u ∈ [0, 1] μεταξύ A και B (χρησιμοποιείται από debug) */
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
      // Διακριτική μικρο-παραλλαγή επανάληψης & συγχρονισμένη αναπνοή (εκπνοή στην προσπάθεια)
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
      // Φυσική αθλητική στάση αναμονής με ήπια μετατόπιση βάρους
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
      // Front rack: μπάρα μπροστά στους ώμους (για back_squat χρησιμοποιείται ήδη back_bar IK)
      p.slx = p.srx = -1.45 - p.tx; p.slz = -0.34; p.srz = 0.34; p.elL = p.elR = -2.55;
    } else if (e.kettlebell && m === M2.hinge) {
      p.slz = 0.22; p.srz = -0.22;
    } else if (e.band && m === M2.squat) {
      p.slx = p.srx = -0.52 - p.tx; p.elL = p.elR = -2.18;
    }
  }

  loop() {
    this.raf = requestAnimationFrame(this.loop);
    // real για ακριβή συγχρονισμό φωνής/επανάληψης· dt για σταθερότητα ομαλοποίησης
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
   * Κατασκευάζει τους παγκόσμιους στόχους 2-Bone IK (πέλματα, pole vectors γονάτων,
   * παλάμες/λαβές, pole vectors αγκώνων, πρηνισμός/υπτιασμός) για την τρέχουσα πόζα.
   */
  _buildIK(m, cur, sides, wp, ax) {
    const ikSpec = m.ik || {};
    const e = this.equip?.e || {};
    const dims = this.skinned ? this.skinned.dims : { footHeight: L.ankle, toeHeight: 0.025, toeFwd: 0.13 };
    const kScale = this.skinned ? this.k : 1;
    const yaw = this.yaw;
    const rotY = (x, y, z) => new THREE.Vector3(x, y, z).applyAxisAngle(_Y, yaw);
    const dirY = (x, y, z) => new THREE.Vector3(x, y, z).applyAxisAngle(_Y, yaw).normalize();
    const fwdW = dirY(0, 0, 1);
    const rightW = dirY(1, 0, 0); // +X = αριστερά του χαρακτήρα σε world space

    const legs = {};
    const arms = {};
    const meta = {
      groundLock: 'auto',
      barPos: null, barAxis: null, barPad: false,
      bandMode: ikSpec.hands === 'band_pull' ? 'pull_apart' : 'loop',
      trxAnchor: null, benchZ: -0.40, stepZ: 0.42, wallZ: -0.20,
    };

    if (this.mode === 'idle') {
      // Σε idle κρατάμε τα πέλματα σταθερά καρφωμένα στο έδαφος (μηδενικό γλίστρημα κατά την ταλάντευση!)
      const hw = 0.125;
      for (const [S, sgn] of [['Left', 1], ['Right', -1]]) {
        const toeAng = sgn * 0.12;
        const fDir = dirY(Math.sin(toeAng), 0, Math.cos(toeAng));
        const target = rotY(sgn * hw, dims.footHeight, 0);
        const pole = target.clone().addScaledVector(fDir, 0.55).addScaledVector(_Y, 0.35);
        legs[S] = { target, pole, mode: 'flat', footDir: fDir, pin: true };
      }
      meta.groundLock = 'ik';
      return { legs, arms, meta };
    }

    // ---- 1. IK ΠΟΔΙΩΝ (ΚΑΡΦΩΜΕΝΑ ΠΕΛΜΑΤΑ & ΓΟΝΑΤΑ ΠΑΝΩ ΑΠΟ ΤΑ ΔΑΧΤΥΛΑ) ----
    const feetMode = ikSpec.feet || 'free';
    const stanceHalf = (ikSpec.stanceW || 0.26) * 0.5;
    const toeOut = ikSpec.toeOut || 0.10;
    const footZ = ikSpec.footZ || 0;

    if (feetMode === 'planted' || feetMode === 'wall_sit' || feetMode === 'bridge' || feetMode === 'hip_thrust') {
      meta.groundLock = 'ik';
      for (const [S, sgn] of [['Left', 1], ['Right', -1]]) {
        const ang = sgn * toeOut;
        const fDir = dirY(Math.sin(ang), 0, Math.cos(ang));
        const target = rotY(sgn * stanceHalf, dims.footHeight, footZ);
        const poleY = (feetMode === 'bridge' || feetMode === 'hip_thrust') ? 0.72 : 0.38;
        const poleFwd = (feetMode === 'bridge' || feetMode === 'hip_thrust') ? 0.15 : 0.60;
        const pole = target.clone().addScaledVector(fDir, poleFwd).addScaledVector(_Y, poleY);
        legs[S] = { target, pole, mode: 'flat', footDir: fDir, pin: true };
      }
    } else if (feetMode === 'toe_raise') {
      meta.groundLock = 'ik';
      const liftH = Math.max(0, cur.lift * kScale);
      for (const [S, sgn] of [['Left', 1], ['Right', -1]]) {
        const ang = sgn * toeOut;
        const fDir = dirY(Math.sin(ang), 0, Math.cos(ang));
        const toePos = rotY(sgn * stanceHalf, dims.toeHeight, footZ + dims.toeFwd);
        const target = rotY(sgn * stanceHalf, dims.footHeight + liftH * 0.88, footZ + liftH * 0.12);
        const pole = target.clone().addScaledVector(fDir, 0.55).addScaledVector(_Y, 0.38);
        legs[S] = { target, pole, mode: liftH > 0.01 ? 'toe' : 'flat', footDir: fDir, toePos, pin: true };
      }
    } else if (feetMode === 'toe') {
      meta.groundLock = 'ik';
      for (const [S, sgn] of [['Left', 1], ['Right', -1]]) {
        const toePos = rotY(sgn * stanceHalf, dims.toeHeight, footZ);
        const target = rotY(sgn * stanceHalf, dims.toeHeight + 0.11, footZ + 0.07);
        const isProne = cur.rrx > 0.7;
        const pole = rotY(sgn * stanceHalf, isProne ? 0.06 : 0.45, footZ + 0.45);
        legs[S] = { target, pole, mode: 'toe', footDir: fwdW, toePos, footUp: _Y, pin: true };
      }
    } else if (feetMode === 'mountain_climber') {
      meta.groundLock = 'ik';
      // Το πόδι στήριξης (μικρότερη κάμψη γονάτου) μένει καρφωμένο στις μύτες
      const pinRight = cur.knL < cur.knR; // lL = Right, lR = Left
      const pinSide = pinRight ? 'Right' : 'Left';
      const sgn = pinSide === 'Left' ? 1 : -1;
      const toePos = rotY(sgn * stanceHalf, dims.toeHeight, footZ);
      const target = rotY(sgn * stanceHalf, dims.toeHeight + 0.11, footZ + 0.07);
      const pole = rotY(sgn * stanceHalf, 0.06, footZ + 0.45);
      legs[pinSide] = { target, pole, mode: 'toe', footDir: fwdW, toePos, footUp: _Y, pin: true };
    } else if (feetMode === 'split' || feetMode === 'reverse_lunge') {
      meta.groundLock = 'ik';
      // Υπολογίζουμε τα πραγματικά proxy πέλματα και τα «κλειδώνουμε» σε ακριβές y=footHeight/toeHeight
      // (για reverse_lunge το μπροστινό πέλμα δεν μετακινείται καθόλου!)
      const frontIsRight = cur.hlx <= cur.hrx; // lL = Right (-X), lR = Left (+X)
      const splitAmt = clamp(Math.abs(cur.hlx - cur.hrx) / 1.45, 0, 1);
      for (const [S, sgn] of [['Left', 1], ['Right', -1]]) {
        const isFront = (S === 'Right') === frontIsRight;
        const fDir = dirY(Math.sin(sgn * 0.05), 0, Math.cos(0.05));
        if (feetMode === 'reverse_lunge') {
          if (isFront) {
            const target = rotY(sgn * stanceHalf, dims.footHeight, 0.02);
            const pole = target.clone().addScaledVector(fDir, 0.60).addScaledVector(_Y, 0.35);
            legs[S] = { target, pole, mode: 'flat', footDir: fDir, pin: true };
          } else {
            const backZ = -0.68 * splitAmt;
            const toePos = rotY(sgn * stanceHalf, dims.toeHeight, backZ + dims.toeFwd * (1 - splitAmt * 0.5));
            const target = rotY(sgn * stanceHalf, dims.footHeight + splitAmt * 0.06, backZ);
            const pole = target.clone().addScaledVector(fDir, 0.45).addScaledVector(_Y, 0.20);
            legs[S] = { target, pole, mode: splitAmt > 0.2 ? 'toe' : 'flat', footDir: fDir, toePos, pin: true };
          }
        } else {
          // Κλασική προβολή μπροστά
          if (isFront) {
            const fwdZ = 0.62 * splitAmt;
            const target = rotY(sgn * stanceHalf, dims.footHeight, fwdZ);
            const pole = target.clone().addScaledVector(fDir, 0.60).addScaledVector(_Y, 0.35);
            legs[S] = { target, pole, mode: 'flat', footDir: fDir, pin: true };
          } else {
            const backZ = -0.10 * splitAmt;
            const toePos = rotY(sgn * stanceHalf, dims.toeHeight, backZ + dims.toeFwd * (1 - splitAmt * 0.5));
            const target = rotY(sgn * stanceHalf, dims.footHeight + splitAmt * 0.06, backZ);
            const pole = target.clone().addScaledVector(fDir, 0.45).addScaledVector(_Y, 0.22);
            legs[S] = { target, pole, mode: splitAmt > 0.2 ? 'toe' : 'flat', footDir: fDir, toePos, pin: true };
          }
        }
      }
    } else if (feetMode === 'step_up') {
      meta.groundLock = 'ik';
      meta.stepZ = 0.42;
      const stepH = 0.34;
      // Καθορισμός ποδιού ανόδου: rY > 0.05 ή μεγάλη κάμψη ισχίου
      const leadIsRight = cur.hlx <= cur.hrx;
      const onStep = (cur.rY > 0.04) || (Math.abs(cur.hlx - cur.hrx) > 0.45);
      for (const [S, sgn] of [['Left', 1], ['Right', -1]]) {
        const isLead = (S === 'Right') === leadIsRight;
        const fDir = dirY(Math.sin(sgn * 0.05), 0, Math.cos(0.05));
        if (isLead && onStep) {
          const target = rotY(sgn * stanceHalf, stepH + dims.footHeight, meta.stepZ);
          const pole = target.clone().addScaledVector(fDir, 0.55).addScaledVector(_Y, 0.36);
          legs[S] = { target, pole, mode: 'flat', footDir: fDir, pin: true };
        } else if (!onStep) {
          const target = rotY(sgn * stanceHalf, dims.footHeight, -0.05);
          const pole = target.clone().addScaledVector(fDir, 0.55).addScaledVector(_Y, 0.36);
          legs[S] = { target, pole, mode: 'flat', footDir: fDir, pin: true };
        }
        // Το πίσω πόδι κατά την άνοδο μένει ελεύθερο FK ώστε να ανεβαίνει φυσικά πάνω από το κουτί
      }
    } else if (feetMode === 'burpee') {
      if (cur.lift < 0.04 && cur.rrx < 0.38) {
        meta.groundLock = 'ik';
        for (const [S, sgn] of [['Left', 1], ['Right', -1]]) {
          const fDir = dirY(Math.sin(sgn * 0.14), 0, Math.cos(0.14));
          const target = rotY(sgn * stanceHalf, dims.footHeight, 0);
          const pole = target.clone().addScaledVector(fDir, 0.58).addScaledVector(_Y, 0.36);
          legs[S] = { target, pole, mode: 'flat', footDir: fDir, pin: true };
        }
      } else if (cur.rrx > 0.85) {
        meta.groundLock = 'ik';
        for (const [S, sgn] of [['Left', 1], ['Right', -1]]) {
          const toePos = rotY(sgn * stanceHalf, dims.toeHeight, footZ);
          const target = rotY(sgn * stanceHalf, dims.toeHeight + 0.11, footZ + 0.07);
          const pole = rotY(sgn * stanceHalf, 0.06, footZ + 0.45);
          legs[S] = { target, pole, mode: 'toe', footDir: fwdW, toePos, footUp: _Y, pin: true };
        }
      }
    }

    // ---- 2. IK ΧΕΡΙΩΝ (ΕΔΑΦΟΣ, ΚΑΡΕΚΛΑ, ΜΠΑΡΑ, TRX, ΛΑΣΤΙΧΟ, GOBLET) ----
    const handsMode = ikSpec.hands || 'free';
    const handHalf = (ikSpec.handW || 0.46) * 0.5;
    let handZ = ikSpec.handZ ?? 0.55;
    // Τα χέρια στήριξης μπαίνουν κάτω από τους ΠΡΑΓΜΑΤΙΚΟΥΣ ώμους του μοντέλου (ο proxy έχει άλλες αναλογίες κορμού)
    if (this.skinned && (handsMode === 'floor' || handsMode === 'floor_burpee' || handsMode === 'bird_dog')) {
      const sk = this.skinned, shZ = (sk.worldPos('LeftArm').dot(fwdW) + sk.worldPos('RightArm').dot(fwdW)) * 0.5;
      const want = shZ + (ikSpec.handZoff ?? 0.03);
      this._handZ = this._handZ == null || Math.abs(this._handZ - want) > 0.6 ? want : this._handZ + (want - this._handZ) * 0.25;
      handZ = this._handZ;
    } else this._handZ = null;
    const flare = ikSpec.elbowFlare ?? 0.35;
    const fTwist = ikSpec.forearmTwist ?? PALM_TO_TWIST[m.palm] ?? 0;

    if (handsMode === 'floor' || (handsMode === 'floor_burpee' && cur.rrx > 0.55)) {
      meta.groundLock = 'ik';
      const downW = new THREE.Vector3(0, -1, 0);
      for (const [S, sgn] of [['Left', 1], ['Right', -1]]) {
        const target = rotY(sgn * handHalf, 0.036, handZ);
        // Αγκώνες στις ~38°-45° πίσω-έξω (όχι 90° chicken-wing!)
        const pole = rotY(sgn * (handHalf + 0.38 * flare), 0.30, handZ - 0.52);
        arms[S] = {
          target, pole,
          forearmTwist: -1.35,
          humeralTwist: 0.18,
          handDir: fwdW.clone(),
          handPalm: downW,
        };
      }
    } else if (handsMode === 'bird_dog') {
      meta.groundLock = 'ik';
      const downW = new THREE.Vector3(0, -1, 0);
      // Το χέρι στήριξης έχει slx/srx > -2.0 (το εκτεταμένο είναι ~ -2.92)
      const leftPlanted = cur.srx > -2.1; // aR = Left
      const rightPlanted = cur.slx > -2.1; // aL = Right
      if (leftPlanted) {
        const target = rotY(handHalf, 0.036, handZ);
        const pole = rotY(handHalf + 0.12, 0.32, handZ - 0.48);
        arms.Left = { target, pole, forearmTwist: -1.35, handDir: fwdW.clone(), handPalm: downW };
      }
      if (rightPlanted) {
        const target = rotY(-handHalf, 0.036, handZ);
        const pole = rotY(-handHalf - 0.12, 0.32, handZ - 0.48);
        arms.Right = { target, pole, forearmTwist: -1.35, handDir: fwdW.clone(), handPalm: downW };
      }
    } else if (handsMode === 'chair_dip') {
      meta.groundLock = 'ik';
      meta.benchZ = -0.40;
      const edgeZ = -0.18; // πρόσθια ακμή πάγκου (benchZ + 0.22)
      const downW = new THREE.Vector3(0, -1, 0);
      for (const [S, sgn] of [['Left', 1], ['Right', -1]]) {
        const target = rotY(sgn * handHalf, 0.468, edgeZ);
        // Αγκώνες αυστηρά ΠΙΣΩ (όχι άνοιγμα στα πλάγια!)
        const pole = rotY(sgn * (handHalf + 0.05), 0.62, edgeZ - 0.65);
        arms[S] = {
          target, pole,
          forearmTwist: -1.35,
          handDir: fwdW.clone(),
          handPalm: downW,
        };
      }
    } else if (handsMode === 'back_bar') {
      // Μπάρα ακριβώς πάνω στους άνω τραπεζοειδείς (πίσω από τον αυχένα, μηδέν clipping!)
      // Στο ρεαλιστικό μοντέλο: πραγματική θέση αυχένα (ο proxy έχει μακρύτερο κορμό → η μπάρα έβγαινε πάνω από το κεφάλι)
      const shMid = this.skinned
        ? this.skinned.worldPos('Neck').lerp(this.skinned.worldPos('Spine2'), 0.3).addScaledVector(fwdW, -0.075)
        : wp(this.chest, 0, 0.27, -0.105).multiplyScalar(kScale);
      const barAxis = rightW.clone();
      meta.barPos = shMid.clone();
      meta.barAxis = barAxis;
      const gripHalf = (ikSpec.handW || 0.68) * 0.5;
      for (const [S, sgn] of [['Left', 1], ['Right', -1]]) {
        const target = shMid.clone().addScaledVector(barAxis, sgn * gripHalf);
        const pole = target.clone().addScaledVector(_Y, -0.48).addScaledVector(fwdW, -0.35).addScaledVector(barAxis, sgn * 0.14);
        arms[S] = { target, pole, forearmTwist: -1.15, humeralTwist: 0.45 };
      }
    } else if (handsMode === 'deadlift_bar' || handsMode === 'row_bar') {
      // Συμμετρική μπάρα: τα δύο χέρια κλειδώνουν στο ακριβές πλάτος λαβής πάνω στον άξονα της μπάρας
      const barAxis = rightW.clone();
      const gripHalf = (ikSpec.handW || 0.56) * 0.5;
      const aLHand = wp(this.aL.el, 0, -L.fore, 0).multiplyScalar(kScale);
      const aRHand = wp(this.aR.el, 0, -L.fore, 0).multiplyScalar(kScale);
      const midH = aLHand.add(aRHand).multiplyScalar(0.5);
      if (handsMode === 'deadlift_bar') {
        // Κατακόρυφη διαδρομή μπάρας πάνω από το μέσο του πέλματος (z ≈ 0.16), ποτέ κάτω από 0.195m!
        const barZ = 0.16;
        const barY = Math.max(0.20, midH.y);
        meta.barPos = rotY(0, barY, barZ);
      } else {
        meta.barPos = midH.clone();
        if (meta.barPos.y < 0.22) meta.barPos.y = 0.22;
      }
      meta.barAxis = barAxis;
      for (const [S, sgn] of [['Left', 1], ['Right', -1]]) {
        const target = meta.barPos.clone().addScaledVector(barAxis, sgn * gripHalf);
        const pole = target.clone().addScaledVector(fwdW, -0.45).addScaledVector(_Y, 0.35).addScaledVector(barAxis, sgn * 0.18 * flare);
        arms[S] = { target, pole, forearmTwist: fTwist };
      }
    } else if (handsMode === 'hip_bar') {
      meta.benchZ = -0.52;
      if (e.barbell) {
        const hipsW = wp(this.hips, 0, 0.06, 0.11).multiplyScalar(kScale);
        const barAxis = rightW.clone();
        meta.barPos = hipsW.clone();
        meta.barAxis = barAxis;
        meta.barPad = true;
        for (const [S, sgn] of [['Left', 1], ['Right', -1]]) {
          const target = hipsW.clone().addScaledVector(barAxis, sgn * 0.24);
          const pole = target.clone().addScaledVector(_Y, -0.22).addScaledVector(barAxis, sgn * 0.25);
          arms[S] = { target, pole, forearmTwist: -1.20 };
        }
      }
    } else if (handsMode === 'trx_pull' || handsMode === 'trx_push') {
      const isPush = handsMode === 'trx_push';
      meta.trxAnchor = new THREE.Vector3(0, 2.45, isPush ? -1.25 : 1.25);
      // Κρατάμε συμμετρικές λαβές TRX με καθαρή κατεύθυνση αγκώνων
      const aLHand = wp(this.aL.el, 0, -L.fore, 0).multiplyScalar(kScale);
      const aRHand = wp(this.aR.el, 0, -L.fore, 0).multiplyScalar(kScale);
      const midH = aLHand.add(aRHand).multiplyScalar(0.5);
      const hHalf = (ikSpec.handW || 0.40) * 0.5;
      for (const [S, sgn] of [['Left', 1], ['Right', -1]]) {
        const target = midH.clone().addScaledVector(rightW, sgn * hHalf);
        const pole = target.clone()
          .addScaledVector(fwdW, isPush ? -0.45 : -0.42)
          .addScaledVector(_Y, -0.25)
          .addScaledVector(rightW, sgn * 0.40 * flare);
        arms[S] = { target, pole, forearmTwist: fTwist };
      }
    } else if ((e.kettlebell || e.goblet) && (m === MOTIONS.squat || m === MOTIONS.lunge || m === MOTIONS.reverse_lunge || m === MOTIONS.step_up)) {
      // Goblet hold: και οι δύο παλάμες αγκαλιάζουν το βάρος μπροστά στο στέρνο
      const sternum = wp(this.chest, 0, 0.16, 0.23).multiplyScalar(kScale);
      for (const [S, sgn] of [['Left', 1], ['Right', -1]]) {
        const target = sternum.clone().addScaledVector(rightW, sgn * 0.065);
        const pole = target.clone().addScaledVector(_Y, -0.42).addScaledVector(rightW, sgn * 0.16).addScaledVector(fwdW, -0.15);
        arms[S] = { target, pole, forearmTwist: 0.15 };
      }
    }

    return { legs, arms, meta };
  }

  /** Μεταφορά στο ρεαλιστικό μοντέλο (FK + 2-Bone IK) + ενημέρωση εξοπλισμού & contact shadows */
  post(dt) {
    this.figure.updateMatrixWorld(true);
    this.palmW = (this.palmW ?? 0) + ((this.mode === 'idle' ? 0 : 1) - (this.palmW ?? 0)) * Math.min(1, dt * 6);
    const q = this._qTmp;
    const ax = (o, v) => v.clone().applyQuaternion(o.getWorldQuaternion(q));
    const wp = (o, x = 0, y = 0, z = 0) => o.localToWorld(new THREE.Vector3(x, y, z));
    const sides = [['Left', this.aR, this.lR], ['Right', this.aL, this.lL]]; // Left του μοντέλου = +x

    const ikSpec = this.motion.ik || {};
    const { legs, arms, meta } = this._buildIK(this.motion, this.cur, sides, wp, ax);

    // Επιλογή στυλ δαχτύλων: προτεραιότητα στον εξοπλισμό, αλλιώς από την άσκηση
    const eqGripStyle = this.equip.gripStyle();
    const gripStyle = this.mode === 'idle' ? 'relaxed' : (eqGripStyle || ikSpec.grip || 'relaxed');
    const gripAmt = this.mode === 'idle' ? 0.25 : (gripStyle === 'floor' ? 0.05 : this.equip.grip());

    if (this.skinned) {
      const T = {};
      const hy = ax(this.hips, _Y), hz = ax(this.hips, _Z);
      const ay = ax(this.abdomen, _Y), az = ax(this.abdomen, _Z);
      const cy = ax(this.chest, _Y), cz = ax(this.chest, _Z);
      const ey = ax(this.headG, _Y), ez = ax(this.headG, _Z);

      T.Hips = { dir: hy, sec: hz };
      T.Spine = { dir: ay, sec: az };
      T.Spine1 = { dir: ay.clone().add(cy), sec: az.clone().add(cz) };
      T.Spine2 = { dir: cy, sec: cz };
      T.Neck = { dir: cy.clone().add(ey), sec: cz.clone().add(ez) };
      T.Head = { dir: ey, sec: ez };

      // Scapulohumeral rhythm για κλείδες (LeftShoulder / RightShoulder)
      const cx = ax(this.chest, _X);
      for (const [S, a, l] of sides) {
        const sgn = S === 'Left' ? 1 : -1;
        const sh = wp(a.sh), el = wp(a.el), hand = wp(a.el, 0, -L.fore, 0);
        const armDir = el.clone().sub(sh);
        // Όταν ο βραχίονας ανυψώνεται πάνω από τις 60°, η κλείδα ανυψώνεται απαλά (~12°-18°)
        const upDot = clamp(armDir.clone().normalize().dot(cy), 0, 1);
        const clavLift = clamp(upDot * 0.28 + (S === 'Left' ? (this.cur.shR || 0) : (this.cur.shL || 0)) * 3.0, -0.08, 0.30);
        const clavDir = cx.clone().multiplyScalar(sgn).addScaledVector(cy, clavLift).normalize();
        T[S + 'Shoulder'] = { dir: clavDir, sec: cz };

        T[S + 'Arm'] = { dir: armDir, sec: ax(a.sh, _Z) };
        const fdir = hand.sub(el), fsec = ax(a.el, _Z);
        const fTw = (ikSpec.forearmTwist ?? PALM_TO_TWIST[this.motion.palm] ?? 0) * this.palmW;
        if (fTw) applyAxialTwist(fsec, fdir, S === 'Left' ? -fTw : fTw);
        T[S + 'ForeArm'] = { dir: fdir, sec: fsec };

        const hp = wp(l.hp), kn = wp(l.kn), an = wp(l.an), toe = wp(l.an, 0, -0.05, 0.14);
        T[S + 'UpLeg'] = { dir: kn.clone().sub(hp), sec: ax(l.hp, _Z) };
        T[S + 'Leg'] = { dir: an.clone().sub(kn), sec: ax(l.kn, _Z) };
        T[S + 'Foot'] = { dir: toe.sub(an), sec: ax(l.an, _Y) };
      }

      const hips = wp(this.hips).multiplyScalar(this.k);
      this.skinned.setGrip(gripAmt, gripAmt, gripStyle, gripStyle);
      const isJump = this.motion === MOTIONS.jumping_jack || this.motion === MOTIONS.burpee || this.motion === MOTIONS.high_knees;
      this.skinned.drive(T, hips, dt, {
        air: isJump ? Math.max(0, this.cur.lift * this.k) : 0,
        ik: { legs, arms },
        groundLock: meta.groundLock,
      });
    }

    // Εξαγωγή θέσεων χεριών/ποδιών για εξοπλισμό & contact shadows
    const H = {
      figure: this.figure,
      yaw: this.yaw,
      feet: {},
      matZ: (this.cur.rZ || 0) * (this.k || 1) + (this.cur.rrx > 0.3 ? -0.25 : 0.10),
      barPos: meta.barPos,
      barAxis: meta.barAxis,
      barPad: meta.barPad,
      bandMode: meta.bandMode,
      trxAnchor: meta.trxAnchor,
      benchZ: meta.benchZ,
      stepZ: meta.stepZ,
      wallZ: meta.wallZ,
    };

    for (const [S, a, l] of sides) {
      const key = S[0];
      if (this.skinned) {
        const sk = this.skinned;
        const b = n => sk.worldPos(S + n);
        const hand = b('Hand');
        const mid = sk.b[S + 'HandMiddle1'] ? b('HandMiddle1') : hand.clone();
        const i1 = sk.b[S + 'HandIndex1'] ? b('HandIndex1') : null;
        const p1 = sk.b[S + 'HandPinky1'] ? b('HandPinky1') : null;
        const fingers = mid.clone().sub(hand);
        const across = i1 && p1 ? p1.sub(i1) : ax(a.el, _X);
        const palm = new THREE.Vector3().crossVectors(fingers, across).normalize().multiplyScalar(S === 'Left' ? -0.022 : 0.022);
        H[key] = { pos: hand.clone().addScaledVector(fingers, 1.22).add(palm), across };
        const footW = sk.b[S + 'ToeBase'] ? b('Foot').add(b('ToeBase')).multiplyScalar(0.5) : b('Foot');
        H.feet[key] = footW.clone().setY(0.015);
        // Contact shadow κάτω από κάθε πέλμα
        const shMesh = this.cShadows[S === 'Left' ? 'footL' : 'footR'];
        const fh = Math.max(0, footW.y - sk.dims.footHeight * 0.6);
        shMesh.position.set(footW.x, 0.0025, footW.z);
        shMesh.rotation.z = -this.yaw;
        shMesh.material.opacity = 0.36 * clamp(1 - fh / 0.28, 0, 1);
        shMesh.scale.setScalar(1 + fh * 0.7);
      } else {
        H[key] = { pos: wp(a.el, 0, -L.fore - 0.045, 0), across: ax(a.el, _X) };
        const footW = wp(l.an, 0, -0.06, 0.06);
        H.feet[key] = footW.clone().setY(0.015);
        const shMesh = this.cShadows[S === 'Left' ? 'footL' : 'footR'];
        const fh = Math.max(0, footW.y);
        shMesh.position.set(footW.x, 0.0025, footW.z);
        shMesh.rotation.z = -this.yaw;
        shMesh.material.opacity = 0.34 * clamp(1 - fh / 0.28, 0, 1);
      }
    }

    // Ακριβής ευθυγράμμιση μπάρας με τα λυμένα κέντρα παλαμών (μηδενικό κενό λαβής)
    if (this.equip.e.barbell && H.L && H.R && meta.barPos) {
      H.barPos = H.L.pos.clone().add(H.R.pos).multiplyScalar(0.5);
      if (this.motionKey === 'deadlift' && H.barPos.y < 0.195) H.barPos.y = 0.195;
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
    // Ουδέτερος αυχένας σε κινήσεις εδάφους/μεγάλης κλίσης — δεν στρίβει αφύσικα το κεφάλι
    const neutralNeck = m.floor || Math.abs(this.cur.tx) > 0.75;
    const gazeGain = neutralNeck ? 0.22 : 0.68;
    const targetYaw = clamp(-this.yaw * gazeGain + (this.cur.hdY || 0), -0.68, 0.68);
    this.headG.rotation.y += (targetYaw + Math.sin(this.time * 0.48) * 0.04 - this.headG.rotation.y) * (1 - Math.exp(-dt * 5));
    this.headG.rotation.z += ((this.cur.hdZ || 0) - this.headG.rotation.z) * (1 - Math.exp(-dt * 6));

    // Βλεφαρίδα
    this.nextBlink -= dt;
    if (this.nextBlink < 0) { this.blink = 0.13; this.nextBlink = 2.2 + Math.random() * 3.4; }
    if (this.blink > 0) this.blink -= dt;
    const eyeY = this.blink > 0 ? 0.12 : 1;
    this.headG.children.forEach(c => { if (c.name === 'eye') c.scale.y = 0.75 * eyeY; });

    // Στόμα & μικρο-νεύματα όταν μιλάει ο voice coach
    const talking = now < this.talkUntil && !this.paused;
    const open = talking ? 0.35 + 0.65 * Math.abs(Math.sin(this.time * 14)) : 0;
    if (talking) this.headG.rotation.x += Math.sin(this.time * 6.5) * 0.030;
    this.mouth.scale.y = 1 + open * 2.6;
    this.mouth.children[1].scale.y = 0.3 + open * 1.6;

    // Απαλή μετατόπιση ισορροπίας σε idle/ready
    this.sway.rotation.z = (this.mode === 'idle' || this.mode === 'ready') ? Math.sin(this.time * 0.55) * 0.010 : 0;

    // Δυναμική αλογοουρά (ελατήριο-αποσβεστήρας)
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

    // Τμηματική κατανομή σπονδυλικής στήλης (οσφυϊκή + θωρακική) βάσει βιομηχανικού προφίλ
    const sp = spineDistribution(p.tx || 0, p.ty || 0, p.tz || 0, m.ik?.spine || 'neutral');
    this.abdomen.rotation.set(sp.lumbarX, sp.lumbarY, sp.lumbarZ);
    this.chest.rotation.set(sp.thoracicX, sp.thoracicY, sp.thoracicZ);

    // Αντιστάθμιση κεφαλής (μειωμένη σε μεγάλες κλίσεις ώστε ο αυχένας να μένει ουδέτερος)
    const neckComp = Math.abs(p.tx || 0) > 0.75 ? 0.25 : 0.42;
    this.headG.rotation.x = (p.hd || 0) - (p.tx || 0) * neckComp;

    // Ωμοπλάτες: ανασηκώνονται φυσικά με την ανύψωση των χεριών
    const up = (k, sk) => clamp((Math.abs(p[k + 'z']) - 1.1) * 0.035 + (-p[k + 'x'] > 1.9 ? 0.025 : 0) + (p[sk] || 0), -0.03, 0.055);
    this.aL.sh.position.y = 0.25 + up('sl', 'shL');
    this.aR.sh.position.y = 0.25 + up('sr', 'shR');
    this.aL.sh.rotation.set(p.slx, p.slY || 0, p.slz);
    this.aR.sh.rotation.set(p.srx, p.srY || 0, p.srz);
    this.aL.el.rotation.x = Math.min(-0.02, p.elL); // ποτέ υπερέκταση αγκώνα
    this.aR.el.rotation.x = Math.min(-0.02, p.elR);

    this.lL.hp.rotation.set(p.hlx, p.hlY || 0, p.hlz);
    this.lR.hp.rotation.set(p.hrx, p.hrY || 0, p.hrz);
    this.lL.kn.rotation.x = Math.max(0, p.knL); // ποτέ υπερέκταση γονάτου
    this.lR.kn.rotation.x = Math.max(0, p.knR);

    // Πέλματα επίπεδα στο έδαφος (εκτός από κινήσεις στις μύτες)
    const flat = m.flatFeet !== false;
    this.lL.an.rotation.x = (flat ? -((p.rrx || 0) + p.hlx + p.knL) : 0) + (p.anL || 0);
    this.lR.an.rotation.x = (flat ? -((p.rrx || 0) + p.hrx + p.knR) : 0) + (p.anR || 0);

    this.hips.rotation.set(p.rrx || 0, 0, p.rrz || 0);
    if (m.floor) {
      this.hips.position.set(p.rX || 0, p.rY || 0, p.rZ || 0);
      return;
    }

    const leg = (hx, hz, kx) => {
      const f1 = -hx, f2 = -hx - kx;
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

```

## js/skinned.js

```javascript
// Ρεαλιστικός 3D coach: φόρτωση οποιουδήποτε Mixamo-rigged .glb,
// αναλυτικό 2-bone IK απευθείας στις πραγματικές διαστάσεις του σκελετού,
// retargeting με ορθοκανονική βάση, κράτημα δαχτύλων και PBR βελτίωση υλικών.
import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/jsm/loaders/GLTFLoader.js';
import { basisFromDirSec, applyAxialTwist, solveTwoBoneIK, clamp } from './ik.js';

const norm = n => n.replace(/^mixamorig[:_]?/i, '');
const V = () => new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];
const FINGER_CASCADE = { Index: 0.90, Middle: 1.00, Ring: 1.08, Pinky: 1.16 };

// Προφίλ κάμψης δαχτύλων [k1 (MCP), k2 (PIP), k3 (DIP), thumbCurl, thumbOppose]
const GRIP_PROFILES = {
  open:       [0.06, 0.08, 0.05, 0.05, 0.0],
  floor:      [-0.08, 0.04, 0.04, 0.02, -0.15], // παλάμες ανοιχτές & επίπεδες στο έδαφος
  relaxed:    [0.24, 0.34, 0.22, 0.16, 0.12],
  chair:      [0.62, 0.78, 0.45, 0.20, 0.10],   // δάχτυλα αγκαλιάζουν την άκρη της καρέκλας
  bar:        [1.18, 1.48, 1.02, 0.62, 0.58],   // σφιχτή λαβή μπάρας με αντίχειρα από πάνω
  dumbbell:   [1.15, 1.44, 0.98, 0.58, 0.52],
  kettlebell: [1.05, 1.32, 0.88, 0.48, 0.44],
  trx:        [1.12, 1.40, 0.95, 0.55, 0.50],
};

/**
 * Αναβάθμιση υλικών φορτωμένου GLB σε MeshPhysicalMaterial (μόνο σε quality='high')
 * για φυσική απόκριση δέρματος (απαλό sheen), υφασμάτων (microfiber sheen) και ματιών.
 */
function upgradeMaterials(root, quality) {
  root.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false;
    if (!o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const next = mats.map(m => {
      if (!m || !m.isMeshStandardMaterial) return m;
      if (quality !== 'high') {
        m.envMapIntensity = 0.82;
        return m;
      }
      const tag = `${o.name || ''} ${m.name || ''}`.toLowerCase();
      const phys = new THREE.MeshPhysicalMaterial({
        color: m.color,
        map: m.map,
        normalMap: m.normalMap,
        normalScale: m.normalScale,
        roughnessMap: m.roughnessMap,
        metalnessMap: m.metalnessMap,
        aoMap: m.aoMap,
        aoMapIntensity: m.aoMapIntensity,
        emissive: m.emissive,
        emissiveMap: m.emissiveMap,
        emissiveIntensity: m.emissiveIntensity,
        alphaMap: m.alphaMap,
        transparent: m.transparent,
        opacity: m.opacity,
        alphaTest: m.alphaTest,
        side: m.side,
        roughness: m.roughness,
        metalness: m.metalness,
        vertexColors: m.vertexColors,
        envMapIntensity: 0.85,
      });
      if (/eye|cornea|iris|lash/i.test(tag)) {
        phys.roughness = 0.18;
        phys.clearcoat = 0.72;
        phys.clearcoatRoughness = 0.10;
      } else if (/hair|brow|beard|ponytail/i.test(tag)) {
        phys.roughness = Math.max(m.roughness, 0.48);
        phys.sheen = 0.30;
        phys.sheenRoughness = 0.55;
        phys.clearcoat = 0.16;
        phys.clearcoatRoughness = 0.45;
      } else if (/skin|body|face|head|arm|leg|hand|neck/i.test(tag)) {
        phys.roughness = clamp(m.roughness, 0.46, 0.64);
        phys.metalness = 0.0;
        phys.sheen = 0.22;
        phys.sheenColor = new THREE.Color(0xffd8c2);
        phys.sheenRoughness = 0.68;
        phys.clearcoat = 0.06;
        phys.clearcoatRoughness = 0.58;
        phys.envMapIntensity = 0.82;
      } else if (/shoe|sneaker|boot|sole/i.test(tag)) {
        phys.roughness = clamp(m.roughness, 0.42, 0.78);
        phys.clearcoat = 0.14;
        phys.clearcoatRoughness = 0.42;
      } else {
        // Αθλητικά ρούχα: ματ μικροΐνα με απαλό sheen
        phys.roughness = Math.max(m.roughness, 0.72);
        phys.metalness = Math.min(m.metalness, 0.08);
        phys.sheen = 0.42;
        phys.sheenColor = m.color.clone().lerp(new THREE.Color(0xffffff), 0.35);
        phys.sheenRoughness = 0.80;
        phys.envMapIntensity = 0.68;
      }
      m.dispose();
      return phys;
    });
    o.material = Array.isArray(o.material) ? next : next[0];
  });
}

export async function loadCoachModel(src, opts = {}) {
  const loader = new GLTFLoader();
  const gltf = typeof src === 'string' ? await loader.loadAsync(src) : await loader.parseAsync(src, '');
  return new SkinnedCoach(gltf.scene, opts);
}

export class SkinnedCoach {
  constructor(root, opts = {}) {
    this.root = root;
    this.b = {};
    this.quality = opts.quality || 'high';

    root.traverse(o => {
      if (o.isBone) this.b[norm(o.name)] = o;
    });
    upgradeMaterials(root, this.quality);

    const need = [
      'Hips', 'Spine', 'Spine2', 'Neck', 'Head',
      'LeftArm', 'LeftForeArm', 'LeftHand',
      'RightArm', 'RightForeArm', 'RightHand',
      'LeftUpLeg', 'LeftLeg', 'LeftFoot',
      'RightUpLeg', 'RightLeg', 'RightFoot',
    ];
    const miss = need.filter(n => !this.b[n]);
    if (miss.length) {
      throw new Error('Το μοντέλο δεν έχει σκελετό τύπου Mixamo (λείπουν: ' + miss.join(', ') + ')');
    }

    // Κανονικοποίηση μεγέθους: ύψος ≈ 1.70m, πέλματα στο y = 0
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const s = 1.70 / Math.max(box.max.y - box.min.y, 0.01);
    root.scale.multiplyScalar(s);
    root.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(root);
    if (Math.abs(box2.min.y) > 1e-4) {
      root.position.y -= box2.min.y;
      root.updateMatrixWorld(true);
    }

    // Αποθήκευση rest pose (T-pose) όλων των οστών
    this.rest = {};
    for (const [n, bone] of Object.entries(this.b)) {
      this.rest[n] = {
        local: bone.quaternion.clone(),
        world: bone.getWorldQuaternion(new THREE.Quaternion()),
        pos: bone.getWorldPosition(V()),
      };
    }

    const p = n => this.rest[n]?.pos;
    const ch = (a, b) => (p(b) ? p(b).clone().sub(p(a)) : null);

    // Πραγματικές ανατομικές διαστάσεις του φορτωμένου μοντέλου (για ακριβές 2-bone IK)
    this.dims = {
      lenUpLegL: p('LeftUpLeg').distanceTo(p('LeftLeg')),
      lenLegL: p('LeftLeg').distanceTo(p('LeftFoot')),
      lenUpLegR: p('RightUpLeg').distanceTo(p('RightLeg')),
      lenLegR: p('RightLeg').distanceTo(p('RightFoot')),
      lenArmL: p('LeftArm').distanceTo(p('LeftForeArm')),
      lenForeL: p('LeftForeArm').distanceTo(p('LeftHand')),
      lenArmR: p('RightArm').distanceTo(p('RightForeArm')),
      lenForeR: p('RightForeArm').distanceTo(p('RightHand')),
      footHeight: Math.max(0.055, (p('LeftFoot').y + p('RightFoot').y) * 0.5),
      toeHeight: p('LeftToeBase') ? Math.max(0.018, (p('LeftToeBase').y + p('RightToeBase').y) * 0.5) : 0.024,
      toeFwd: p('LeftToeBase') ? Math.max(0.09, p('LeftToeBase').z - p('LeftFoot').z) : 0.13,
      hipHalfW: Math.abs(p('LeftUpLeg').x - p('RightUpLeg').x) * 0.5,
      shoulderHalfW: Math.abs(p('LeftArm').x - p('RightArm').x) * 0.5,
    };
    this.hipsRestY = p('Hips').y;

    /**
     * Μαθηματικά Retargeting με Ορθοκανονική Βάση:
     * Στο rest pose (T-pose), κάθε οστό i έχει παγκόσμια κατεύθυνση d0 (προς το παιδί του)
     * και δευτερεύοντα άξονα s0. Υπολογίζουμε:
     *   Q_offset,i = basis(d0, s0)^{-1} * Q_world0,i
     * Κατά την εκτέλεση, για κάθε στόχο { dir, sec } σε world space:
     *   Q_world,i = basis(dir, sec) * Q_offset,i
     *   Q_local,i = Q_world,parent^{-1} * Q_world,i
     * Αυτό λειτουργεί ανεξάρτητα από τις τοπικές συμβάσεις αξόνων του .glb (Mixamo κ.ά.).
     */
    const mkEntry = (n, c, sec) => {
      const dir = c ? ch(n, c) : Y.clone();
      const offset = basisFromDirSec(dir, sec, new THREE.Quaternion()).invert().multiply(this.rest[n].world);
      return { n, offset };
    };

    // Αλυσίδα κορμού & κεφαλής (οδηγείται πάντα πρώτη ώστε να γνωρίζουμε ακριβείς θέσεις αρθρώσεων)
    this.torsoChain = [
      ['Hips', 'Spine', Z],
      ['Spine', this.b.Spine1 ? 'Spine1' : 'Spine2', Z],
      ...(this.b.Spine1 ? [['Spine1', 'Spine2', Z]] : []),
      ['Spine2', 'Neck', Z],
      ['Neck', 'Head', Z],
      ['Head', this.b.HeadTop_End ? 'HeadTop_End' : null, Z],
      ...(this.b.LeftShoulder ? [['LeftShoulder', 'LeftArm', Z]] : []),
      ...(this.b.RightShoulder ? [['RightShoulder', 'RightArm', Z]] : []),
    ].map(([n, c, sec]) => mkEntry(n, c, sec));

    // Χάρτης offset για τα άκρα (χρησιμοποιούνται τόσο από IK όσο και από FK fallback)
    this.limbMap = {};
    const limbSpecs = [
      ['LeftArm', 'LeftForeArm', Z], ['LeftForeArm', 'LeftHand', Z],
      ['RightArm', 'RightForeArm', Z], ['RightForeArm', 'RightHand', Z],
      ['LeftUpLeg', 'LeftLeg', Z], ['LeftLeg', 'LeftFoot', Z],
      ['RightUpLeg', 'RightLeg', Z], ['RightLeg', 'RightFoot', Z],
      ...(this.b.LeftToeBase ? [['LeftFoot', 'LeftToeBase', Y], ['RightFoot', 'RightToeBase', Y]] : []),
      ...(this.b.LeftToe_End && this.b.LeftToeBase ? [['LeftToeBase', 'LeftToe_End', Y], ['RightToeBase', 'RightToe_End', Y]] : []),
      ...(this.b.LeftHandMiddle1 ? [
        ['LeftHand', 'LeftHandMiddle1', Y.clone().negate()],
        ['RightHand', 'RightHandMiddle1', Y.clone().negate()],
      ] : []),
    ];
    for (const [n, c, sec] of limbSpecs) {
      if (this.b[n]) this.limbMap[n] = mkEntry(n, c, sec);
    }

    // Άξονες κάμψης δαχτύλων & αντίχειρα στο τοπικό σύστημα κάθε φάλαγγας
    this.fingers = [];
    for (const side of ['Left', 'Right']) {
      const i1 = p(side + 'HandIndex1');
      const p1 = p(side + 'HandPinky1');
      if (!i1 || !p1) continue;
      const across = (side === 'Left' ? p1.clone().sub(i1) : i1.clone().sub(p1)).normalize();
      for (const f of FINGERS) {
        const cascade = FINGER_CASCADE[f];
        for (let k = 1; k <= 3; k++) {
          const n = `${side}Hand${f}${k}`;
          if (!this.b[n]) continue;
          const ax = across.clone().applyQuaternion(this.rest[n].world.clone().invert());
          this.fingers.push({ bone: this.b[n], local: this.rest[n].local, ax, side, k, cascade });
        }
      }
      for (let k = 1; k <= 3; k++) {
        const n = `${side}HandThumb${k}`;
        if (!this.b[n]) continue;
        const invW = this.rest[n].world.clone().invert();
        const ax = new THREE.Vector3(0, 0, side === 'Left' ? -1 : 1).applyQuaternion(invW);
        const oppAx = new THREE.Vector3(0, side === 'Left' ? -1 : 1, 0).applyQuaternion(invW);
        this.fingers.push({ bone: this.b[n], local: this.rest[n].local, ax, oppAx, side, k, thumb: true });
      }
    }

    this.grip = { Left: 0.25, Right: 0.25 };
    this.gripCur = { Left: 0.25, Right: 0.25 };
    this.gripStyle = { Left: 'relaxed', Right: 'relaxed' };
    this.gripProfCur = { Left: [...GRIP_PROFILES.relaxed], Right: [...GRIP_PROFILES.relaxed] };
    this.offY = 0;

    // Προ-δεσμευμένα scratch αντικείμενα (zero GC ανά καρέ)
    this._q1 = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._q3 = new THREE.Quaternion();
    this._v1 = V();
    this._v2 = V();
    this._v3 = V();
    this._v4 = V();
    this._ikRes = {
      midPos: V(), endPos: V(), dir1: V(), dir2: V(),
      p1: V(), p2: V(), poleNormal: V(), bendNormal: V(),
      clampedDist: 0, reachRatio: 0,
    };
  }

  setGrip(left, right, styleL = null, styleR = null) {
    this.grip.Left = left;
    this.grip.Right = right;
    if (styleL) this.gripStyle.Left = GRIP_PROFILES[styleL] ? styleL : 'relaxed';
    if (styleR) this.gripStyle.Right = GRIP_PROFILES[styleR] ? styleR : this.gripStyle.Left;
  }

  worldPos(name, out = V()) {
    return this.b[name].getWorldPosition(out);
  }

  _setBoneWorld(name, dir, sec) {
    const entry = this.limbMap[name] || this.torsoChain.find(c => c.n === name);
    const bone = this.b[name];
    if (!entry || !bone) return;
    basisFromDirSec(dir, sec, this._q1).multiply(entry.offset);
    bone.parent.getWorldQuaternion(this._q2);
    bone.quaternion.copy(this._q2.invert().multiply(this._q1));
    bone.updateMatrixWorld(true);
  }

  /**
   * Οδηγεί τον Mixamo σκελετό με υβριδικό FK (κορμός/κεφάλι/κλείδες) + Αναλυτικό 2-Bone IK (πόδια & χέρια).
   * @param {Object} targets  { BoneName: { dir, sec } } σε world space
   * @param {THREE.Vector3} hipsPos  Παγκόσμια θέση πυέλου
   * @param {number} dt  Χρονικό βήμα (s)
   * @param {Object} opts  { air, ik: { legs, arms }, groundLock }
   */
  drive(targets, hipsPos, dt, opts = {}) {
    const { air = 0, ik = null, groundLock = 'auto' } = opts;

    // 1. Κορμός, κεφάλι και κλείδες (FK retargeting)
    for (let i = 0; i < this.torsoChain.length; i++) {
      const c = this.torsoChain[i];
      const t = targets[c.n];
      const bone = this.b[c.n];
      if (!t || !bone) continue;
      basisFromDirSec(t.dir, t.sec, this._q1).multiply(c.offset);
      bone.parent.getWorldQuaternion(this._q2);
      bone.quaternion.copy(this._q2.invert().multiply(this._q1));
      if (c.n === 'Hips') {
        const lp = this._v1.copy(hipsPos);
        lp.y += this.offY;
        bone.parent.worldToLocal(lp);
        bone.position.copy(lp);
      }
      bone.updateMatrixWorld(true);
    }

    // 2. Περιορισμός έκτασης πυέλου για καρφωμένα πέλματα:
    // Αν κάποιο καρφωμένο πόδι απέχει > 99% του (L1 + L2) από το ισχίο, κατεβάζουμε
    // ομαλά την πύελο ώστε το πέλμα να ΜΗΝ ξεκολλήσει ποτέ από το έδαφος.
    if (ik && ik.legs) {
      let maxDrop = 0;
      for (const side of ['Left', 'Right']) {
        const legIK = ik.legs[side];
        if (!legIK || !legIK.pin) continue;
        const hipPos = this.worldPos(side + 'UpLeg', this._v1);
        const L1 = side === 'Left' ? this.dims.lenUpLegL : this.dims.lenUpLegR;
        const L2 = side === 'Left' ? this.dims.lenLegL : this.dims.lenLegR;
        const maxR = (L1 + L2) * 0.990;
        const dx = hipPos.x - legIK.target.x;
        const dz = hipPos.z - legIK.target.z;
        const dy = hipPos.y - legIK.target.y;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq > maxR * maxR && dy > 0.05) {
          const horizSq = dx * dx + dz * dz;
          const allowDy = horizSq < maxR * maxR ? Math.sqrt(maxR * maxR - horizSq) : 0.05;
          const drop = dy - allowDy;
          if (drop > maxDrop) maxDrop = drop;
        }
      }
      if (maxDrop > 1e-4) {
        const hipsBone = this.b.Hips;
        const wp = this.worldPos('Hips', this._v1);
        wp.y -= maxDrop;
        hipsBone.parent.worldToLocal(wp);
        hipsBone.position.copy(wp);
        hipsBone.updateMatrixWorld(true);
      }
    }

    // 3. Πόδια: Αναλυτικό 2-Bone IK (ή FK fallback αν το πόδι είναι ελεύθερο)
    for (const side of ['Left', 'Right']) {
      const legIK = ik?.legs?.[side];
      if (legIK && legIK.target) {
        const hipPos = this.worldPos(side + 'UpLeg', this._v1);
        const L1 = side === 'Left' ? this.dims.lenUpLegL : this.dims.lenUpLegR;
        const L2 = side === 'Left' ? this.dims.lenLegL : this.dims.lenLegR;
        const sol = solveTwoBoneIK(hipPos, legIK.target, legIK.pole, L1, L2, {
          softness: legIK.softness ?? 0.014,
          poleIsDir: !!legIK.poleIsDir,
        }, this._ikRes);

        // Επιγονατίδα & κνήμη κοιτάζουν ακριβώς προς +p1 / +p2 (ευθυγράμμιση γονάτου πάνω από τα δάχτυλα)
        this._setBoneWorld(side + 'UpLeg', sol.dir1, sol.p1);
        this._setBoneWorld(side + 'Leg', sol.dir2, sol.p2);

        // Προσανατολισμός πέλματος
        if (this.limbMap[side + 'Foot']) {
          if (legIK.mode === 'flat' && legIK.footDir) {
            this._setBoneWorld(side + 'Foot', legIK.footDir, Y);
            if (this.limbMap[side + 'ToeBase']) {
              this._setBoneWorld(side + 'ToeBase', legIK.footDir, Y);
            }
          } else if (legIK.mode === 'toe' && legIK.toePos) {
            const anklePos = this.worldPos(side + 'Foot', this._v2);
            const fDir = this._v3.subVectors(legIK.toePos, anklePos);
            if (fDir.lengthSq() > 1e-5) {
              this._setBoneWorld(side + 'Foot', fDir, legIK.footUp || Y);
            }
            if (this.limbMap[side + 'ToeBase'] && legIK.footDir) {
              this._setBoneWorld(side + 'ToeBase', legIK.footDir, Y);
            }
          } else if (targets[side + 'Foot']) {
            const tf = targets[side + 'Foot'];
            this._setBoneWorld(side + 'Foot', tf.dir, tf.sec);
          }
        }
      } else {
        for (const part of ['UpLeg', 'Leg', 'Foot']) {
          const n = side + part;
          if (targets[n] && this.limbMap[n]) this._setBoneWorld(n, targets[n].dir, targets[n].sec);
        }
      }
    }

    // 4. Χέρια: Αναλυτικό 2-Bone IK (ή FK fallback) + στροφή βραχιονίου & πρηνισμός/υπτιασμός αντιβραχίου
    for (const side of ['Left', 'Right']) {
      const armIK = ik?.arms?.[side];
      if (armIK && armIK.target) {
        const shPos = this.worldPos(side + 'Arm', this._v1);
        const L1 = side === 'Left' ? this.dims.lenArmL : this.dims.lenArmR;
        const L2 = side === 'Left' ? this.dims.lenForeL : this.dims.lenForeR;
        const sol = solveTwoBoneIK(shPos, armIK.target, armIK.pole, L1, L2, {
          softness: armIK.softness ?? 0.012,
          poleIsDir: !!armIK.poleIsDir,
        }, this._ikRes);

        // Πρόσθια πλευρά βραχίονα/αντιβραχίου = -p1 / -p2 (προς την πτύχωση του αγκώνα)
        const sec1 = this._v2.copy(sol.p1).negate();
        const sec2 = this._v3.copy(sol.p2).negate();

        // Κατανομή αξονικής στροφής: ελαφριά βραχιόνια συμμετοχή + κύριος πρηνισμός/υπτιασμός στο αντιβράχιο
        const hTw = clamp(armIK.humeralTwist || 0, -1.3, 1.3);
        const fTw = clamp(armIK.forearmTwist || 0, -1.52, 1.52);
        const sgn = side === 'Left' ? -1 : 1;
        if (hTw) applyAxialTwist(sec1, sol.dir1, sgn * hTw);
        if (fTw) applyAxialTwist(sec2, sol.dir2, sgn * fTw);

        this._setBoneWorld(side + 'Arm', sol.dir1, sec1);
        this._setBoneWorld(side + 'ForeArm', sol.dir2, sec2);

        if (this.limbMap[side + 'Hand']) {
          if (armIK.handDir && armIK.handPalm) {
            this._setBoneWorld(side + 'Hand', armIK.handDir, armIK.handPalm);
          } else {
            // Ουδέτερη ευθυγράμμιση καρπού με το αντιβράχιο (παλάμη = ±(dir2 × sec2))
            const palm = this._v4.crossVectors(sol.dir2, sec2).multiplyScalar(side === 'Left' ? 1 : -1);
            this._setBoneWorld(side + 'Hand', sol.dir2, palm);
          }
        }
      } else {
        for (const part of ['Arm', 'ForeArm', 'Hand']) {
          const n = side + part;
          if (targets[n] && this.limbMap[n]) this._setBoneWorld(n, targets[n].dir, targets[n].sec);
        }
      }
    }

    // 5. Ρεαλιστική άρθρωση δαχτύλων (διαφορετικό προφίλ ανά εξοπλισμό / έδαφος)
    const kf = 1 - Math.exp(-dt * 11);
    for (const s of ['Left', 'Right']) {
      this.gripCur[s] += (this.grip[s] - this.gripCur[s]) * kf;
      const targetProf = GRIP_PROFILES[this.gripStyle[s]] || GRIP_PROFILES.relaxed;
      const curProf = this.gripProfCur[s];
      for (let j = 0; j < 5; j++) curProf[j] += (targetProf[j] - curProf[j]) * kf;
    }
    for (let i = 0; i < this.fingers.length; i++) {
      const f = this.fingers[i];
      const prof = this.gripProfCur[f.side];
      const scale = clamp(this.gripCur[f.side] > 0.01 ? 0.35 + 0.65 * this.gripCur[f.side] : 1.0, 0.25, 1.15);
      if (f.thumb) {
        const curl = prof[3] * (f.k === 1 ? 0.75 : 1.0) * scale;
        const opp = f.k === 1 ? prof[4] * scale : 0;
        f.bone.quaternion.copy(f.local).multiply(this._q1.setFromAxisAngle(f.ax, curl));
        if (opp) f.bone.quaternion.multiply(this._q2.setFromAxisAngle(f.oppAx, opp));
      } else {
        const curl = prof[f.k - 1] * f.cascade * scale;
        f.bone.quaternion.copy(f.local).multiply(this._q1.setFromAxisAngle(f.ax, curl));
      }
    }

    this.root.updateMatrixWorld(true);

    // 6. Επαφή με το έδαφος:
    // - Σε IK-locked mode, οι πατούσες/παλάμες είναι ήδη στο y=0· εφαρμόζουμε μόνο προστασία
    //   ώστε κανένα μέρος του σώματος (γόνατα, πύελος, πλάτη) να μην βυθίζεται κάτω από το y=0.
    // - Σε ελεύθερες κινήσεις (π.χ. jumping jack, high knees), εδράζουμε το χαμηλότερο σημείο στο y=air.
    const contacts = [
      ['LeftToeBase', this.dims.toeHeight], ['RightToeBase', this.dims.toeHeight],
      ['LeftFoot', this.dims.footHeight * 0.92], ['RightFoot', this.dims.footHeight * 0.92],
      ['LeftHand', 0.022], ['RightHand', 0.022],
      ['LeftLeg', 0.060], ['RightLeg', 0.060],
      ['Hips', 0.11], ['Spine2', 0.12], ['Head', 0.11],
      ['LeftForeArm', 0.045], ['RightForeArm', 0.045],
    ];
    let minY = Infinity;
    for (let i = 0; i < contacts.length; i++) {
      const [n, r] = contacts[i];
      if (!this.b[n]) continue;
      const y = this.worldPos(n, this._v2).y - r;
      if (y < minY) minY = y;
    }

    if (groundLock === 'ik') {
      // Αν κάποιο σημείο βυθίζεται κάτω από το 0, ανασηκώνουμε απαλά· αλλιώς επανερχόμαστε στο 0
      const rawNeed = minY < -0.004 ? this.offY - minY : 0;
      const want = Math.max(0, rawNeed);
      this.offY += (want - this.offY) * (1 - Math.exp(-dt * 14));
    } else {
      const want = this.offY - minY + air;
      this.offY += (want - this.offY) * (1 - Math.exp(-dt * 18));
    }
  }
}

```

## js/equipment.js

```javascript
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

```
