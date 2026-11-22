# GymTrAIner — 3D coach code bundle
Τα αρχεία του 3D coach. Δες `docs/3d-coach-round4.md` για το prompt του τρέχοντος γύρου.

## js/ik.js

```javascript
// Αναλυτική αντίστροφη κινηματική (2-bone IK), ορθοκανονική βάση retargeting,
// όρια αρθρώσεων (ROM), κατανομή σπονδυλικής στήλης και πολυφασικά keyframes.
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
 * Κατασκευάζει ορθοκανονική βάση (e1, e2, e3) σε quaternion (Gram-Schmidt):
 *   e1 = normalize(dir)                                 (κύριος άξονας οστού)
 *   e2 = normalize(sec - (sec · e1) * e1)               (δευτερεύων άξονας)
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
 * Περιστρέφει ένα δευτερεύον διάνυσμα `sec` γύρω από τον άξονα `axis` in-place
 * (χρησιμοποιείται για πρηνισμό/υπτιασμό αντιβραχίου και αξονική στροφή βραχιονίου).
 */
export function applyAxialTwist(sec, axis, angleRad) {
  if (!angleRad) return sec;
  _e1.copy(axis);
  if (_e1.lengthSq() < 1e-10) return sec;
  _e1.normalize();
  _qTmp.setFromAxisAngle(_e1, angleRad);
  return sec.applyQuaternion(_qTmp);
}

/**
 * Αναλυτικός επιλυτής 2-bone IK (Νόμος Συνημιτόνων + Pole Vector + Soft Extension):
 *
 * Δεδομένα:
 *   A = rootPos (ισχίο ή ώμος), T = targetPos (αστράγαλος ή καρπός),
 *   P = polePos (σημείο/διάνυσμα κατεύθυνσης γονάτου ή αγκώνα),
 *   L1, L2 = μήκη ανώτερου και κατώτερου τμήματος.
 *
 * Μαθηματική παραγωγή:
 *   1. Απόσταση-στόχος d_raw = ||T - A||, μονάδα u = (T - A) / d_raw.
 *   2. C1 Soft-extension clamping (εξαλείφει το απότομο «pop» γονάτου/αγκώνα στο κλείδωμα):
 *        d_max  = (L1 + L2) * 0.999
 *        d_soft = d_max * (1 - softness)
 *        Για d_raw > d_soft:
 *          d = d_soft + (d_max - d_soft) * (1 - exp(-(d_raw - d_soft) / (d_max - d_soft)))
 *      Είναι συνεχής και παραγωγίσιμη (d'(d_soft) = 1) με αυστηρό φράγμα d < d_max.
 *   3. Νόμος συνημιτόνων στο τρίγωνο (A, B, C) με πλευρές L1, L2, d:
 *        cos(α) = clamp((L1² + d² - L2²) / (2·L1·d), -1, 1)
 *        sin(α) = sqrt(max(0, 1 - cos²(α)))
 *        cos(β) = clamp((d - L1·cos(α)) / L2, -1, 1)
 *        sin(β) = clamp((L1·sin(α)) / L2, 0, 1)
 *   4. Επίπεδο κάμψης από το pole vector:
 *        n = normalize((P - A) - ((P - A)·u)·u)   (ή poleDir αν poleIsDir=true)
 *   5. Λυμένες διευθύνσεις και θέσεις αρθρώσεων σε world space:
 *        dir1 = cos(α)·u + sin(α)·n,   B* = A + L1·dir1
 *        dir2 = cos(β)·u - sin(β)·n,   C* = A + d·u
 *   6. Κλειστή μορφή ορθογώνιων δευτερευόντων αξόνων στο επίπεδο κάμψης (χωρίς singularities):
 *        p1 = -sin(α)·u + cos(α)·n   (p1 ⊥ dir1, ||p1|| = 1, πάντα προς +n)
 *        p2 = +sin(β)·u + cos(β)·n   (p2 ⊥ dir2, ||p2|| = 1, πάντα προς +n)
 *      - Πόδια: επιγονατίδα & πρόσθια κνήμη κοιτάζουν προς +n → sec1 = +p1, sec2 = +p2.
 *      - Χέρια: ωλέκρανο (αγκώνας) προεξέχει προς +n, άρα η πρόσθια πλευρά (δικέφαλος /
 *        πτύχωση αγκώνα / αντίχειρας σε ουδέτερη λαβή) κοιτάζει προς -n → sec1 = -p1, sec2 = -p2.
 */
export function solveTwoBoneIK(rootPos, targetPos, polePos, L1, L2, opts = {}, out = null) {
  const softness = opts.softness ?? 0.015;
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

  // Διευθύνσεις τμημάτων
  res.dir1.copy(_u).multiplyScalar(cosA).addScaledVector(_n, sinA).normalize();
  res.dir2.copy(_u).multiplyScalar(cosB).addScaledVector(_n, -sinB).normalize();

  // Κλειστής μορφής κάθετοι άξονες στο επίπεδο κάμψης (προς +n)
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
 * - 'neutral': ασκήσεις φορτίου (squat, deadlift, hinge, row) — braced ουδέτερη οσφυϊκή.
 * - 'flex'   : κοιλιακοί (crunch, dead_bug) — ομαλή τμηματική κάμψη σε όλη τη σπονδυλική.
 * - 'ext'    : εκτάσεις ράχης (superman) — μεγαλύτερη έκταση στη θωρακική, προστατευμένη οσφυϊκή.
 * - 'twist'  : στροφικές (russian_twist) — η αξονική στροφή συγκεντρώνεται κυρίως στη θωρακική.
 */
export function spineDistribution(tx, ty = 0, tz = 0, mode = 'neutral') {
  if (mode === 'flex') {
    return {
      lumbarX: tx * 0.36, thoracicX: tx * 0.64,
      lumbarY: ty * 0.25, thoracicY: ty * 0.75,
      lumbarZ: tz * 0.40, thoracicZ: tz * 0.60,
    };
  }
  if (mode === 'ext') {
    return {
      lumbarX: tx * 0.34, thoracicX: tx * 0.66,
      lumbarY: ty * 0.20, thoracicY: ty * 0.80,
      lumbarZ: tz * 0.40, thoracicZ: tz * 0.60,
    };
  }
  if (mode === 'twist') {
    return {
      lumbarX: tx * 0.45, thoracicX: tx * 0.55,
      lumbarY: ty * 0.22, thoracicY: ty * 0.78,
      lumbarZ: tz * 0.35, thoracicZ: tz * 0.65,
    };
  }
  // 'neutral': braced lumbar spine — κύρια κλίση από ισχία/λεκάνη με προστατευμένη οσφυϊκή
  return {
    lumbarX: tx * 0.46, thoracicX: tx * 0.54,
    lumbarY: ty * 0.20, thoracicY: ty * 0.80,
    lumbarZ: tz * 0.42, thoracicZ: tz * 0.58,
  };
}

/**
 * Υπολογίζει την πόζα σε χρονική στιγμή t01 ∈ [0, 1] από πολυφασική λίστα keyframes
 * `keys = [{ t, p, ease? }, ...]`.
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
// Βιβλιοθήκη βιομηχανικών κινήσεων για τον 3D coach (πολυφασικά keyframes + μεταδεδομένα IK).
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

// Τυπικός 5-φασικός κύκλος: A → anticipation/brace → B → isometric pause → drive back → A
function phases(A, B, { brace, settle, toB = 0.46, hold = 0.10, easeDown = 'inOut', easeUp = 'out' } = {}) {
  const k = [{ t: 0, p: A }];
  if (brace) k.push({ t: 0.08, p: brace, ease: 'cubic' });
  k.push({ t: toB, p: B, ease: easeDown });
  if (hold > 0) k.push({ t: toB + hold, p: settle || B, ease: 'linear' });
  k.push({ t: 0.94, p: A, ease: easeUp });
  k.push({ t: 1.0, p: A, ease: 'cubic' });
  return k;
}

// ---- ΒΑΣΙΚΕΣ ΠΟΖΕΣ (ΑΡΧΙΚΕΣ 34 ΑΣΚΗΣΕΙΣ) ----
const squatA = P({ tx: 0.04, ...arms(-0.18, 0.08, -0.18), ...legs(-0.06, 0.10, 0.05, 0.18) });
const squatBrace = P({ tx: 0.14, ...arms(-0.48, 0.06, -0.22), ...legs(-0.26, 0.30, 0.07, 0.20) });
const squatB = P({ tx: 0.48, ...arms(-1.60, 0.06, -0.14), ...legs(-1.42, 1.88, 0.14, 0.22) });
const squatDeep = P({ tx: 0.50, ...arms(-1.64, 0.06, -0.14), ...legs(-1.46, 1.93, 0.14, 0.22) });

const backSquatA = P({ tx: 0.06, ...arms(-0.45, 0.85, -1.95), ...legs(-0.06, 0.10, 0.06, 0.22) });
const backSquatBrace = P({ tx: 0.15, ...arms(-0.48, 0.85, -1.95), ...legs(-0.28, 0.32, 0.08, 0.22) });
const backSquatB = P({ tx: 0.42, ...arms(-0.52, 0.85, -1.95), ...legs(-1.42, 1.88, 0.15, 0.24) });

// Προβολές (90°/90° με ανύψωση πέλματος κατά το βήμα και καρφωμένο πόδι στήριξης)
const lungeA = P({ tx: 0.03, rZ: 0.0, ...arms(-0.16, 0.09, -0.24), ...legs(-0.04, 0.08, 0.03) });
const lungeStep = P({ tx: 0.06, rX: 0.03, rZ: 0.04, hlx: -0.62, knL: 0.78, hrx: 0.06, knR: 0.18, slx: 0.12, srx: -0.45, elL: -0.48, elR: -0.68, slz: -0.09, srz: 0.09 });
const lungeB = P({ tx: 0.08, ty: 0.08, rZ: 0.06, hlx: -1.48, knL: 1.56, hrx: 0.18, knR: 1.52, anR: 0.72, slx: 0.18, srx: -0.62, elL: -0.58, elR: -0.88, slz: -0.10, srz: 0.10 });

const revLungeA = P({ tx: 0.03, rZ: 0.16, ...arms(-0.16, 0.09, -0.24), ...legs(-0.04, 0.08, 0.03) });
const revLungeStep = P({ tx: 0.09, rX: -0.03, rZ: 0.02, hlx: -0.42, knL: 0.48, hrx: 0.34, knR: 0.48, slx: 0.10, srx: -0.44, elL: -0.46, elR: -0.76, slz: -0.09, srz: 0.09 });
const revLungeB = P({ tx: 0.10, ty: 0.08, rZ: -0.20, hlx: -1.46, knL: 1.54, hrx: 0.22, knR: 1.52, anR: 0.72, slx: 0.18, srx: -0.60, elL: -0.58, elR: -0.88, slz: -0.10, srz: 0.10 });

// Άρσεις θανάτου με Ολυμπιακή μπάρα (αληθινή κάμψη ισχίου με ευθεία ουδέτερη οσφυϊκή, ύψος 0.225m)
const dlBot = P({ rrx: 1.06, tx: 0.22, hd: -0.35, ...arms(-1.26, 0.08, -0.05), ...legs(-2.22, 1.46, 0.07, 0.14) });
const dlPullSlack = P({ rrx: 0.98, tx: 0.18, hd: -0.30, shL: -0.02, shR: -0.02, ...arms(-1.14, 0.08, -0.05), ...legs(-2.12, 1.38, 0.07, 0.14) });
const dlTop = P({ rrx: 0.0, tx: 0.03, hd: 0.0, shL: -0.015, shR: -0.015, ...arms(-0.06, 0.08, -0.05), ...legs(-0.04, 0.06, 0.05, 0.14) });

const hingeA = P({ rrx: 0.0, tx: 0.03, ...arms(-0.08, 0.06, -0.10), ...legs(-0.04, 0.08, 0.03) });
const hingeBrace = P({ rrx: 0.22, tx: 0.08, ...arms(-0.30, 0.06, -0.10), ...legs(-0.38, 0.20, 0.03) });
const hingeB = P({ rrx: 1.02, tx: 0.16, hd: -0.25, ...arms(-1.18, 0.06, -0.08), ...legs(-1.46, 0.42, 0.04) });

const rowA = P({ rrx: 0.78, tx: 0.14, hd: -0.22, ...arms(-0.92, 0.08, -0.08), ...legs(-1.24, 0.50, 0.04) });
const rowB = P({ rrx: 0.76, tx: 0.12, hd: -0.20, shL: 0.02, shR: 0.02, ...arms(0.18, 0.16, -1.48), ...legs(-1.22, 0.50, 0.04) });

const bbRowA = P({ rrx: 0.78, tx: 0.14, hd: -0.22, ...arms(-0.92, 0.10, -0.08), ...legs(-1.28, 0.54, 0.05, 0.12) });
const bbRowB = P({ rrx: 0.76, tx: 0.12, hd: -0.20, shL: 0.02, shR: 0.02, ...arms(0.14, 0.24, -1.44), ...legs(-1.26, 0.54, 0.05, 0.12) });

const ohpA = P({ tx: 0.02, ...arms(-0.55, 0.36, -2.02), ...legs(-0.04, 0.08, 0.04) });
const ohpB = P({ tx: 0.01, shL: 0.045, shR: 0.045, ...arms(-2.96, 0.14, -0.08), ...legs(-0.03, 0.06, 0.04) });

const curlA = P({ tx: 0.02, ...arms(-0.06, 0.07, -0.10), ...legs(-0.03, 0.06, 0.03) });
const curlB = P({ tx: 0.02, ...arms(-0.20, 0.06, -2.38), ...legs(-0.03, 0.06, 0.03) });

const latA = P({ tx: 0.04, ...arms(-0.10, 0.10, -0.18), ...legs(-0.04, 0.08, 0.04) });
const frB = P({ tx: 0.02, ...arms(-1.50, 0.12, -0.10), ...legs(-0.04, 0.08, 0.04) });
const latB = P({ tx: 0.05, shL: 0.02, shR: 0.02, ...arms(-0.20, 1.44, -0.28), ...legs(-0.04, 0.08, 0.04) });

const bandA = P({ tx: 0.03, ...arms(-1.52, -0.08, -0.14), ...legs(-0.04, 0.08, 0.04) });
const bandB = P({ tx: -0.02, shL: 0.02, shR: 0.02, ...arms(-1.42, 1.24, -0.18), ...legs(-0.04, 0.08, 0.04) });

// Κάμψεις / Σανίδα / Ορειβάτης (ακριβής ευθεία γραμμή σώματος, το IK βαθμονομεί ύψος/θέση βάσει πραγματικού μήκους χεριών)
const pushTop = P({ rrx: 1.26, rY: 0.34, rZ: 0.02, tx: 0.02, hd: -0.34, ...arms(-1.26, 0.12, -0.08), ...legs(0.02, 0.05) });
const pushBrace = P({ rrx: 1.30, rY: 0.31, rZ: 0.02, tx: 0.02, hd: -0.34, ...arms(-1.05, 0.22, -0.32), ...legs(0.02, 0.06) });
const pushBot = P({ rrx: 1.49, rY: 0.17, rZ: 0.02, tx: 0.02, hd: -0.32, ...arms(-0.34, 0.42, -1.58), ...legs(0.02, 0.06) });

const climbA = P({ rrx: 1.26, rY: 0.35, rZ: 0.02, tx: 0.05, hd: -0.32, ...arms(-1.26, 0.10, -0.08), ...legs(0.02, 0.08) });
const climbB = P({ rrx: 1.26, rY: 0.36, rZ: 0.02, tx: 0.12, ty: 0.10, hd: -0.30, ...arms(-1.26, 0.10, -0.08), hlx: -1.48, knL: 1.78, hrx: 0.06, knR: 0.08 });

const lie = { rrx: -1.57, rY: 0.13, rZ: 0.06, ...legs(-0.84, 1.98, 0.05) };
const crunchA = P({ ...lie, tx: 0.02, hd: 0.05, ...arms(-2.05, 0.72, -2.05) });
const crunchB = P({ ...lie, tx: 0.76, hd: 0.28, ...arms(-1.95, 0.62, -2.05) });

const bridgeA = P({ ...lie, rY: 0.125, rZ: 0.08, tx: 0.0, hd: 0.06, ...arms(0.04, 0.18, -0.08) });
const bridgeB = P({ ...lie, rrx: -2.02, rY: 0.34, rZ: 0.04, tx: 0.04, hd: 0.44, ...legs(-0.06, 1.62, 0.06), ...arms(0.42, 0.18, -0.08) });

const hipThrustA = P({ rrx: -1.06, rY: 0.22, rZ: 0.12, tx: 0.20, hd: 0.34, ...legs(-1.35, 1.88, 0.08), ...arms(-0.62, 0.18, -0.85) });
const hipThrustB = P({ rrx: -1.56, rY: 0.44, rZ: 0.14, tx: 0.04, hd: 0.42, ...legs(-0.08, 1.56, 0.08), ...arms(-0.18, 0.18, -0.55) });

const deadBugA = P({ rrx: -1.57, rY: 0.13, rZ: 0.04, tx: 0.06, hd: 0.10, ...arms(-1.57, 0.06, -0.08), ...legs(-1.56, 1.56, 0.04) });
const deadBugB = P({ rrx: -1.57, rY: 0.13, rZ: 0.04, tx: 0.06, hd: 0.10, slx: -2.94, srx: -1.57, slz: -0.08, srz: 0.06, elL: -0.08, elR: -0.08, hlx: -1.56, knL: 1.56, hrx: -0.24, knR: 0.08, hlz: -0.04, hrz: 0.04 });

const supermanA = P({ rrx: 1.57, rY: 0.12, rZ: 0.0, tx: 0.02, hd: -0.20, ...arms(-2.95, 0.18, -0.12), ...legs(0.02, 0.06, 0.04) });
const supermanB = P({ rrx: 1.57, rY: 0.13, rZ: 0.0, tx: -0.44, hd: -0.16, ...arms(-2.52, 0.24, -0.14), ...legs(0.36, 0.10, 0.06) });

const sidePlankP = P({ rrx: 0.04, rrz: 1.38, rY: 0.32, rZ: 0.0, tx: 0.02, tz: -0.04, hdZ: -0.15, slx: -0.08, slz: -1.38, elL: -1.52, srx: 0.0, srz: 1.56, elR: -0.08, ...legs(0.0, 0.04, 0.02) });

const rTwistMid = P({ rrx: -0.78, rY: 0.14, rZ: 0.04, tx: 0.12, ty: 0.0, hd: 0.15, ...arms(-0.92, -0.28, -1.18), ...legs(-1.16, 1.48, 0.04) });
const rTwistR = P({ rrx: -0.78, rY: 0.14, rZ: 0.04, tx: 0.14, ty: -0.78, hd: 0.15, hdY: -0.35, slx: -0.82, srx: -0.96, slz: 0.36, srz: -0.20, elL: -1.25, elR: -1.10, ...legs(-1.18, 1.50, 0.04) });
const rTwistL = P({ rrx: -0.78, rY: 0.14, rZ: 0.04, tx: 0.14, ty: 0.78, hd: 0.15, hdY: 0.35, slx: -0.96, srx: -0.82, slz: 0.20, srz: -0.36, elL: -1.10, elR: -1.25, ...legs(-1.18, 1.50, 0.04) });

// Ανέβασμα σε σκαλοπάτι (εκκίνηση καθαρά πίσω από το κουτί στο z=-0.10, ανέβασμα στο z=0.40)
const stepUpA = P({ tx: 0.04, rZ: -0.10, ...arms(-0.14, 0.08, -0.22), ...legs(-0.04, 0.08, 0.03) });
const stepUpPlant = P({ tx: 0.18, rZ: 0.14, hlx: -1.16, knL: 1.40, hrx: 0.12, knR: 0.22, slx: 0.18, srx: -0.58, elL: -0.55, elR: -0.88, slz: -0.09, srz: 0.09 });
const stepUpTop = P({ tx: 0.04, rY: 0.34, rZ: 0.40, hlx: -0.04, knL: 0.06, hrx: -0.62, knR: 0.78, slx: -0.52, srx: 0.18, elL: -0.85, elR: -0.55, slz: -0.09, srz: 0.09 });

const wallSitP = P({ tx: -0.02, rZ: -0.10, ...arms(-0.22, 0.10, -0.35), ...legs(-1.54, 1.54, 0.06, 0.08) });

const dipTop = P({ rrx: 0.02, rY: 0.42, rZ: 0.02, tx: 0.04, ...arms(0.55, 0.08, -0.14), ...legs(-1.12, 1.12, 0.04) });
const dipBot = P({ rrx: 0.02, rY: 0.22, rZ: 0.04, tx: 0.08, ...arms(0.95, 0.08, -1.62), ...legs(-1.26, 1.30, 0.04) });

const trxRowA = P({ rrx: -0.58, rY: 0.80, rZ: -0.16, tx: 0.02, ...arms(-1.52, 0.08, -0.10), ...legs(0.02, 0.05, 0.04) });
const trxRowB = P({ rrx: -0.30, rY: 0.90, rZ: 0.02, tx: 0.0, shL: 0.02, shR: 0.02, ...arms(0.50, 0.20, -1.85), ...legs(0.02, 0.05, 0.04) });

const trxSquatA = P({ tx: -0.04, ...arms(-1.12, 0.08, -0.68), ...legs(-0.08, 0.12, 0.06, 0.18) });
const trxSquatB = P({ tx: 0.20, ...arms(-1.55, 0.08, -0.12), ...legs(-1.42, 1.88, 0.14, 0.22) });

const trxPressA = P({ rrx: 0.42, rY: 0.86, rZ: 0.10, tx: 0.02, hd: -0.12, ...arms(-1.18, 0.10, -0.12), ...legs(0.02, 0.06, 0.04) });
const trxPressB = P({ rrx: 0.66, rY: 0.74, rZ: 0.22, tx: 0.02, hd: -0.14, ...arms(-0.42, 0.42, -1.62), ...legs(0.02, 0.06, 0.04) });

const birdDogA = P({ rrx: 1.40, rY: 0.46, rZ: 0.0, tx: 0.03, hd: -0.22, ...arms(-1.40, 0.06, -0.08), ...legs(-1.40, 1.57, 0.04) });
const birdDogB = P({ rrx: 1.40, rY: 0.46, rZ: 0.0, tx: 0.02, hd: -0.20, slx: -2.92, srx: -1.40, slz: -0.06, srz: 0.06, elL: -0.08, elR: -0.08, hlx: -1.40, knL: 1.57, hrx: 0.16, knR: 0.06 });

// Burpee 9-φασικό πρόγραμμα
const burpeeStand = P({ tx: 0.03, rrx: 0, rY: 0.94, rZ: 0, ...arms(-0.14, 0.08, -0.18), ...legs(-0.05, 0.08, 0.04) });
const burpeeSquat = P({ tx: 0.62, rrx: 0.14, rY: 0.44, rZ: 0.02, ...arms(-1.05, 0.14, -0.16), ...legs(-1.58, 2.08, 0.12) });
const burpeePlank = P({ rrx: 1.26, rY: 0.34, rZ: 0.02, tx: 0.02, hd: -0.32, ...arms(-1.26, 0.12, -0.08), ...legs(0.02, 0.06) });
const burpeePush = P({ rrx: 1.49, rY: 0.17, rZ: 0.02, tx: 0.02, hd: -0.30, ...arms(-0.36, 0.42, -1.56), ...legs(0.02, 0.06) });
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

// ---- ΝΕΕΣ ΠΟΖΕΣ ΓΙΑ TASK B (ΣΥΣΤΗΜΑ ΑΓΚΥΡΩΣΗΣ ΛΑΣΤΙΧΩΝ) ----
// 1. Όρθια κωπηλατική με λάστιχο (άγκυρα μπροστά στο στήθος, όρθιος κορμός, έλξη οριζόντια πίσω από τον κορμό)
const standRowA = P({ tx: 0.04, ...arms(-1.48, 0.08, -0.12), ...legs(-0.14, 0.22, 0.05, 0.12) });
const standRowB = P({ tx: -0.03, shL: -0.015, shR: -0.015, ...arms(0.46, 0.16, -1.68), ...legs(-0.14, 0.22, 0.05, 0.12) });

// 2. Face pull (άγκυρα μπροστά-ψηλά, αγκώνες ψηλά & ανοιχτοί, εξωτερική στροφή ώμων προς το πρόσωπο)
const facePullA = P({ tx: 0.03, ...arms(-1.82, 0.10, -0.10), ...legs(-0.14, 0.22, 0.06, 0.12) });
const facePullB = P({ tx: -0.04, shL: 0.01, shR: 0.01, ...arms(-1.18, 1.38, -1.92), ...legs(-0.14, 0.22, 0.06, 0.12) });

// 3. Lat pulldown με λάστιχο (άγκυρα ψηλά-μπροστά, χέρια ψηλά → έλξη αγκώνων κάτω στα πλευρά)
const latPullA = P({ tx: 0.10, hd: -0.12, ...arms(-2.78, 0.28, -0.14), ...legs(-0.22, 0.36, 0.07, 0.14) });
const latPullB = P({ tx: 0.04, hd: 0.0, shL: -0.02, shR: -0.02, ...arms(-0.32, 0.42, -2.02), ...legs(-0.22, 0.36, 0.07, 0.14) });

// 4. Όρθιες πιέσεις στήθους με λάστιχο (άγκυρα πίσω στο στήθος, σταθερή στάση, ώθηση μπροστά)
const bandPressA = P({ tx: 0.07, ...arms(-0.18, 0.56, -1.78), ...legs(-0.14, 0.22, 0.05, 0.12) });
const bandPressB = P({ tx: 0.09, ...arms(-1.52, 0.10, -0.12), ...legs(-0.14, 0.22, 0.05, 0.12) });

// 5. Pallof press (άγκυρα πλάγια στο ύψος μέσης/στέρνου, αυστηρή αντι-στροφή κορμού, ώθηση ευθεία μπροστά)
const pallofA = P({ tx: 0.04, ty: 0.0, ...arms(-0.58, -0.18, -1.88), ...legs(-0.20, 0.32, 0.08, 0.14) });
const pallofB = P({ tx: 0.04, ty: 0.0, ...arms(-1.46, -0.14, -0.12), ...legs(-0.20, 0.32, 0.08, 0.14) });

// 6. Woodchop (διαγώνια στροφή από ψηλά αριστερά → χαμηλά δεξιά με στροφή κορμού & ισχίων)
const woodchopA = P({ tx: 0.02, ty: 0.68, tz: -0.06, hdY: 0.38, ...arms(-2.22, 0.10, -0.18), ...legs(-0.12, 0.18, 0.10, 0.16) });
const woodchopMid = P({ tx: 0.16, ty: 0.0, tz: 0.0, ...arms(-1.35, -0.12, -0.22), ...legs(-0.34, 0.50, 0.11, 0.16) });
const woodchopB = P({ tx: 0.34, ty: -0.72, tz: 0.08, hdY: -0.40, ...arms(-0.72, -0.10, -0.20), ...legs(-0.56, 0.80, 0.12, 0.16) });

// ---- ΝΕΕΣ ΠΟΖΕΣ ΓΙΑ TASK C (25 ΠΑΡΑΛΛΑΓΕΣ ΑΣΚΗΣΕΩΝ) ----
// 7. Κάμψεις στα γόνατα (γόνατα στο στρώμα, κνήμες σηκωμένες ψηλά, ευθεία ώμοι→ισχία→γόνατα)
const kneePushTop = P({ rrx: 1.06, rY: 0.34, rZ: 0.04, tx: 0.02, hd: -0.30, ...arms(-1.06, 0.12, -0.08), ...legs(0.02, 1.48, 0.04) });
const kneePushBot = P({ rrx: 1.42, rY: 0.17, rZ: 0.06, tx: 0.02, hd: -0.28, ...arms(-0.34, 0.42, -1.58), ...legs(0.02, 1.56, 0.04) });

// 8. Κάμψεις σε τοίχο (όρθιος, παλάμες σε τοίχο μπροστά, ευθύ κεκλιμένο σώμα, ΧΩΡΙΣ στρώμα!)
const wallPushA = P({ rrx: 0.34, tx: 0.02, hd: -0.12, ...arms(-1.55, 0.12, -0.10), ...legs(0.02, 0.04, 0.04) });
const wallPushB = P({ rrx: 0.58, tx: 0.02, hd: -0.14, ...arms(-0.68, 0.42, -1.62), ...legs(0.02, 0.04, 0.04) });

// 9. Incline push-up σε καρέκλα/πάγκο (παλάμες στο χείλος πάγκου μπροστά, ευθύ κεκλιμένο σώμα)
const incPushA = P({ rrx: 0.86, rY: 0.58, rZ: -0.12, tx: 0.02, hd: -0.24, ...arms(-1.18, 0.12, -0.10), ...legs(0.02, 0.05, 0.04) });
const incPushB = P({ rrx: 1.12, rY: 0.42, rZ: -0.06, tx: 0.02, hd: -0.24, ...arms(-0.36, 0.44, -1.58), ...legs(0.02, 0.05, 0.04) });

// 10. Πλάγια σανίδα στα γόνατα (κάτω αγκώνας & γόνατα στο στρώμα, κνήμες λυγισμένες πίσω)
const kneeSidePlankP = P({ rrx: 0.04, rrz: 1.22, rY: 0.34, rZ: 0.0, tx: 0.02, tz: -0.04, hdZ: -0.15, slx: -0.08, slz: -1.22, elL: -1.52, srx: 0.0, srz: 1.56, elR: -0.08, ...legs(0.02, 1.52, 0.03) });

// 11. Σανίδα με επαφή ώμων (σταθερά ισχία, εναλλάξ το ένα χέρι αγγίζει τον απέναντι ώμο)
const tapA = P({ rrx: 1.26, rY: 0.34, rZ: 0.02, tx: 0.02, hd: -0.34, ...arms(-1.26, 0.10, -0.08), ...legs(0.02, 0.05, 0.08) });
const tapB = P({ rrx: 1.26, rY: 0.34, rZ: 0.02, tx: 0.02, ty: 0.04, hd: -0.32, slx: -1.26, slz: -0.10, elL: -0.08, srx: -0.68, srz: -0.45, elR: -2.18, ...legs(0.02, 0.05, 0.08) });

// 12. Ανυψώσεις ποδιών (ύπτια στο στρώμα, μέση κολλημένη στο έδαφος, τεντωμένα πόδια από χαμηλά → 90°)
const legRaiseA = P({ rrx: -1.57, rY: 0.13, rZ: 0.02, tx: 0.05, hd: 0.08, ...arms(0.06, 0.16, -0.08), ...legs(-0.24, 0.08, 0.03) });
const legRaiseB = P({ rrx: -1.57, rY: 0.13, rZ: 0.02, tx: 0.08, hd: 0.12, ...arms(0.06, 0.16, -0.08), ...legs(-1.54, 0.08, 0.03) });

// 13. Ποδήλατο κοιλιακών (ύπτια, εναλλάξ στροφή αγκώνα προς αντίθετο γόνατο με έκταση του άλλου ποδιού)
const bikeA = P({ rrx: -1.57, rY: 0.13, rZ: 0.02, tx: 0.42, ty: 0.0, hd: 0.24, ...arms(-2.02, 0.72, -2.08), ...legs(-1.12, 1.32, 0.04) });
const bikeB = P({ rrx: -1.57, rY: 0.13, rZ: 0.02, tx: 0.68, ty: 0.62, hd: 0.28, hdY: 0.28, slx: -1.85, srx: -2.02, slz: -0.68, srz: 0.56, elL: -2.08, elR: -2.08, hlx: -0.26, knL: 0.10, hrx: -1.78, knR: 1.72, hlz: -0.04, hrz: 0.04 });

// 14. Γάτα-Αγελάδα (τετραποδική στάση στο στρώμα: έκταση σπονδυλικής ↔ κάμψη/καμπούριασμα)
const catCowA = P({ rrx: 1.44, rY: 0.46, rZ: 0.0, tx: -0.44, hd: -0.42, ...arms(-1.40, 0.06, -0.08), ...legs(-1.44, 1.56, 0.04) }); // Αγελάδα (έκταση)
const catCowB = P({ rrx: 1.34, rY: 0.47, rZ: 0.0, tx: 0.64, hd: 0.44, ...arms(-1.40, 0.06, -0.08), ...legs(-1.34, 1.56, 0.04) });  // Γάτα (κάμψη)

// 15. Διάταση παιδιού (γονατιστός στο στρώμα, ισχία στις φτέρνες, κορμός διπλωμένος μπροστά, χέρια τεντωμένα μπροστά)
const childPoseP = P({ rrx: 1.38, rY: 0.23, rZ: -0.26, tx: 0.36, hd: 0.28, ...arms(-2.96, 0.14, -0.08), ...legs(-2.12, 2.38, 0.10) });

// 16. Καθίσματα σε καρέκλα (Box squat — κάθισμα μέχρι επαφή με τον πάγκο/καρέκλα πίσω)
const boxSquatA = P({ tx: 0.04, rZ: 0.04, ...arms(-0.18, 0.08, -0.18), ...legs(-0.06, 0.10, 0.06, 0.18) });
const boxSquatB = P({ tx: 0.36, rZ: -0.22, ...arms(-1.48, 0.08, -0.16), ...legs(-1.46, 1.56, 0.12, 0.20) });

// 17. Bulgarian split squat (πίσω πέλμα υπερυψωμένο στον πάγκο πίσω, βαθύ μονοποδικό κάθισμα)
const bssA = P({ tx: 0.06, rZ: 0.16, hlx: -0.12, knL: 0.16, hrx: 0.22, knR: 0.88, ...arms(-0.16, 0.09, -0.22), hlz: -0.05, hrz: 0.05 });
const bssB = P({ tx: 0.16, rZ: 0.08, hlx: -1.48, knL: 1.62, hrx: 0.28, knR: 1.68, ...arms(-0.24, 0.10, -0.28), hlz: -0.05, hrz: 0.05 });

// 18. Πλάγιες εκπτώσεις (Side lunge — πλάγιο βήμα, λυγισμένο εξωτερικό γόνατο, τεντωμένο το άλλο πόδι)
const sideLungeA = P({ tx: 0.03, rX: 0.0, ...arms(-0.18, 0.09, -0.24), ...legs(-0.04, 0.08, 0.05, 0.10) });
const sideLungeStep = P({ tx: 0.16, rX: 0.16, hlx: -0.45, knL: 0.56, hlz: -0.24, hrx: -0.18, knR: 0.10, hrz: 0.34, ...arms(-0.78, 0.08, -0.42) });
const sideLungeB = P({ tx: 0.34, rX: 0.30, hlx: -1.32, knL: 1.54, hlz: -0.28, hrx: -0.34, knR: 0.06, hrz: 0.64, ...arms(-1.35, 0.06, -0.22) });

// 19. Καθιστές πιέσεις ώμων (καθιστός σε καρέκλα/πάγκο, πίεση αλτήρων πάνω από το κεφάλι)
const seatOhpA = P({ tx: 0.02, rZ: -0.04, ...arms(-0.55, 0.38, -2.02), ...legs(-1.54, 1.56, 0.08, 0.10) });
const seatOhpB = P({ tx: 0.01, rZ: -0.04, shL: 0.045, shR: 0.045, ...arms(-2.96, 0.14, -0.08), ...legs(-1.54, 1.56, 0.08, 0.10) });

// 20. Πιέσεις στήθους σε πάγκο (Bench press — ύπτια σε οριζόντιο πάγκο, πέλματα στο πάτωμα)
const benchPressA = P({ rrx: -1.57, rY: 0.54, rZ: 0.0, tx: -0.04, hd: 0.04, ...arms(-0.78, 0.92, -1.68), ...legs(-0.72, 1.52, 0.10, 0.12) });
const benchPressB = P({ rrx: -1.57, rY: 0.54, rZ: 0.0, tx: -0.02, hd: 0.04, ...arms(-1.57, 0.14, -0.10), ...legs(-0.72, 1.52, 0.10, 0.12) });

// 21. Εκτάσεις τρικεφάλων (Tricep kickbacks — σκυφτός κορμός, βραχίονες παράλληλοι με κορμό, έκταση πήχεων πίσω)
const kickbackA = P({ rrx: 0.82, tx: 0.14, hd: -0.26, ...arms(0.16, 0.08, -1.68), ...legs(-1.26, 0.52, 0.05) });
const kickbackB = P({ rrx: 0.82, tx: 0.14, hd: -0.26, ...arms(0.24, 0.08, -0.08), ...legs(-1.26, 0.52, 0.05) });

// 22. Υπερέκταση τρικεφάλων (Overhead tricep extension — αγκώνες ψηλά δίπλα στο κεφάλι, έκταση πάνω)
const triExtA = P({ tx: 0.02, ...arms(-2.96, 0.12, -2.28), ...legs(-0.04, 0.08, 0.05, 0.10) });
const triExtB = P({ tx: 0.02, ...arms(-2.98, 0.10, -0.08), ...legs(-0.04, 0.08, 0.05, 0.10) });

// 23. Έλξεις σε μονόζυγο (Pull-up — κρέμασμα από μονόζυγο πόρτας, έλξη πηγουνιού πάνω από τη μπάρα)
const pullUpA = P({ rrx: 0.02, rY: 1.06, tx: -0.04, hd: -0.12, shL: 0.05, shR: 0.05, ...arms(-3.04, 0.24, -0.08), ...legs(-0.08, 0.82, 0.04) });
const pullUpB = P({ rrx: 0.04, rY: 1.48, tx: -0.08, hd: -0.14, shL: -0.02, shR: -0.02, ...arms(-0.62, 0.68, -2.18), ...legs(-0.14, 0.96, 0.04) });

// 24. Κωπηλατική με έναν αλτήρα σε πάγκο (One-arm dumbbell row — αριστερό χέρι & γόνατο στον πάγκο, δεξί χέρι κωπηλατεί)
const oneArmRowA = P({ rrx: 1.18, rY: 0.68, rX: 0.04, tx: 0.08, hd: -0.28, slx: -1.16, slz: -0.08, elL: -0.08, srx: -1.18, srz: 0.10, elR: -0.08, hlx: -1.18, knL: 1.45, hrx: -1.22, knR: 0.36 });
const oneArmRowB = P({ rrx: 1.16, rY: 0.68, rX: 0.04, tx: 0.06, ty: -0.12, hd: -0.26, slx: -1.16, slz: -0.08, elL: -0.08, srx: 0.26, srz: 0.14, elR: -1.62, hlx: -1.18, knL: 1.45, hrx: -1.22, knR: 0.36 });

// 25. Άλματα από κάθισμα (Squat jump — φόρτιση καθίσματος → εκρηκτική πτήση στον αέρα → μαλακή προσγείωση)
const sqJumpLoad = P({ tx: 0.46, ...arms(0.42, 0.10, -0.35), ...legs(-1.38, 1.84, 0.12, 0.20) });
const sqJumpAir = P({ tx: -0.04, lift: 0.30, ...arms(-2.65, 0.16, -0.14), ...legs(0.06, 0.06, 0.06, 0.12), anL: 0.65, anR: 0.65 });
const sqJumpLand = P({ tx: 0.28, ...arms(-0.62, 0.10, -0.45), ...legs(-0.84, 1.18, 0.10, 0.18) });

// 26. Άλματα πατινάζ (Skater jump — πλάγιο άλμα με φάση πτήσης & προσγείωση σε ένα πόδι)
const skaterA = P({ tx: 0.36, ty: -0.22, rX: -0.26, hlx: -0.28, knL: 0.88, hlz: 0.24, hrx: -1.18, knR: 1.38, hrz: 0.12, slx: -1.08, srx: 0.46, slz: 0.28, srz: 0.16, elL: -0.78, elR: -0.88 });
const skaterAir = P({ tx: 0.14, ty: 0.08, rX: 0.08, lift: 0.22, hlx: -0.58, knL: 0.72, hlz: -0.22, hrx: 0.24, knR: 0.56, hrz: 0.22, slx: 0.28, srx: -1.18, slz: -0.24, srz: 0.22, elL: -0.76, elR: -0.92, anL: 0.55, anR: 0.55 });
const skaterLand = P({ tx: 0.36, ty: 0.22, rX: 0.26, hlx: -1.18, knL: 1.38, hlz: -0.12, hrx: -0.28, knR: 0.88, hrz: -0.24, slx: 0.46, srx: -1.08, slz: -0.16, srz: -0.28, elL: -0.88, elR: -0.78 });

// 27. Ανυψώσεις γάμπας σε σκαλί (φτέρνες κάτω από το επίπεδο του σκαλιού στη φάση 0 → ψηλά στις μύτες στη φάση 1)
const stepCalfA = P({ tx: 0.03, rY: 0.34, rZ: 0.20, ...arms(-0.10, 0.09, -0.18), ...legs(-0.04, 0.06, 0.04), anL: -0.36, anR: -0.36 });
const stepCalfB = P({ tx: 0.02, rY: 0.34, rZ: 0.20, lift: 0.105, ...arms(-0.10, 0.09, -0.18), ...legs(-0.02, 0.04, 0.04), anL: 0.78, anR: 0.78 });

// 28. Περπάτημα επί τόπου (ελεγχόμενο όρθιο βάδισμα επί τόπου, εναλλάξ γόνατο ~75° & αντίθετη κίνηση χεριών)
const marchA = P({ tx: 0.03, ...arms(-0.16, 0.08, -0.72), ...legs(-0.04, 0.08, 0.04) });
const marchB = P({ tx: 0.04, ty: 0.10, slx: 0.32, srx: -0.72, slz: -0.08, srz: 0.08, elL: -0.92, elR: -1.24, hlx: -1.12, knL: 1.32, hrx: 0.04, knR: 0.08 });

// 29. Σχοινάκι (μικρά ρυθμικά άλματα με περιστροφή καρπών στα πλευρά και σχοινάκι)
const ropeA = P({ tx: 0.04, lift: 0.0, ...arms(0.08, 0.22, -1.35), ...legs(-0.22, 0.34, 0.04) });
const ropeB = P({ tx: 0.02, lift: 0.14, ...arms(0.04, 0.26, -1.25), ...legs(0.02, 0.08, 0.04), anL: 0.52, anR: 0.52 });

// 30. Βάδισμα αγρότη (Farmer walk — όρθια στιβαρή στάση, βαρείς αλτήρες στα πλάγια, σταθερό βάδισμα επί τόπου)
const farmerA = P({ tx: 0.02, shL: -0.02, shR: -0.02, ...arms(0.0, 0.13, -0.12), ...legs(-0.04, 0.08, 0.05) });
const farmerB = P({ tx: 0.03, ty: 0.05, shL: -0.02, shR: -0.02, ...arms(0.0, 0.14, -0.12), hlx: -0.72, knL: 0.94, hrx: 0.06, knR: 0.08, hlz: -0.05, hrz: 0.05 });

// 31. TRX Y-raise (κλίση πίσω, τεντωμένα χέρια ανεβαίνουν σε σχήμα Υ πάνω από το κεφάλι)
const trxYA = P({ rrx: -0.44, rY: 0.84, rZ: -0.14, tx: 0.02, ...arms(-1.45, 0.08, -0.10), ...legs(0.02, 0.05, 0.05) });
const trxYB = P({ rrx: -0.16, rY: 0.93, rZ: 0.02, tx: -0.02, shL: 0.02, shR: 0.02, ...arms(-2.68, 0.62, -0.10), ...legs(0.02, 0.05, 0.05) });

export const MOTIONS = {
  // ---- ΑΡΧΙΚΕΣ 17 ΑΣΚΗΣΕΙΣ (ΔΙΑΤΗΡΟΥΝΤΑΙ ΟΛΑ ΤΑ ΚΛΕΙΔΙΑ) ----
  squat: {
    label: 'Καθίσματα', tempo: 3.0, prof: [0.46, 0.10, 0.44], yaw: 0.88,
    A: squatA, B: squatB,
    keys: phases(squatA, squatB, { brace: squatBrace, settle: squatDeep, toB: 0.46, hold: 0.10 }),
    ik: { feet: 'planted', stanceW: 0.34, toeOut: 0.22, hands: 'free', forearmTwist: 0, elbowFlare: 0.35, grip: 'relaxed', spine: 'neutral' },
  },
  lunge: {
    label: 'Προβολές', tempo: 3.4, prof: [0.48, 0.08, 0.44], yaw: 0.96, alt: true, noZ: true,
    A: lungeA, B: lungeB,
    keys: [
      { t: 0.00, p: lungeA },
      { t: 0.16, p: lungeStep, ease: 'cubic' },
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
    ik: { feet: 'planted', stanceW: 0.26, toeOut: 0.10, hands: 'hinge_hold', forearmTwist: -1.25, elbowFlare: 0.22, grip: 'bar', spine: 'neutral' },
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
    ik: { feet: 'planted', stanceW: 0.28, toeOut: 0.12, hands: 'ohp', forearmTwist: -1.25, elbowFlare: 0.42, grip: 'dumbbell', spine: 'neutral' },
  },
  curl: {
    palm: 'up', label: 'Κάμψεις δικεφάλων', tempo: 3.0, prof: [0.40, 0.12, 0.48], yaw: 0.46,
    A: curlA, B: curlB,
    keys: phases(curlA, curlB, { toB: 0.40, hold: 0.12, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'planted', stanceW: 0.24, toeOut: 0.10, hands: 'curl', forearmTwist: 1.45, elbowFlare: 0.06, grip: 'dumbbell', spine: 'neutral' },
  },
  lateral_raise: {
    label: 'Πλάγιες ανυψώσεις', tempo: 3.0, prof: [0.40, 0.12, 0.48], yaw: 0.22,
    A: latA, B: latB,
    keys: phases(latA, latB, { toB: 0.40, hold: 0.12, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'planted', stanceW: 0.26, toeOut: 0.10, hands: 'free', forearmTwist: -0.35, elbowFlare: 0.70, grip: 'dumbbell', spine: 'neutral' },
  },
  front_raise: {
    label: 'Μπροστινές ανυψώσεις', tempo: 3.0, prof: [0.40, 0.12, 0.48], yaw: 0.9,
    A: latA, B: frB,
    keys: phases(latA, frB, { toB: 0.40, hold: 0.12, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'planted', stanceW: 0.26, toeOut: 0.10, hands: 'free', forearmTwist: -1.2, elbowFlare: 0.2, grip: 'dumbbell', spine: 'neutral' },
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
    ik: { feet: 'free', hands: 'free', forearmTwist: 0, elbowFlare: 0.18, grip: 'fist', spine: 'neutral' },
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
    ik: { feet: 'toe', stanceW: 0.22, hands: 'floor', handExtraW: 0.11, forearmTwist: -1.35, elbowFlare: 0.42, grip: 'floor', spine: 'neutral' },
  },
  plank: {
    palm: 'flat', label: 'Σανίδα', tempo: 3.0, yaw: 1.25, floor: true, hold: true, flatFeet: false,
    A: pushTop, B: pushTop,
    keys: [{ t: 0, p: pushTop }, { t: 1, p: pushTop }],
    ik: { feet: 'toe', stanceW: 0.22, hands: 'floor', handExtraW: 0.04, forearmTwist: -1.35, elbowFlare: 0.28, grip: 'floor', spine: 'neutral' },
  },
  crunch: {
    label: 'Κοιλιακοί', tempo: 2.5, prof: [0.44, 0.12, 0.44], yaw: 1.25, floor: true,
    A: crunchA, B: crunchB,
    keys: phases(crunchA, crunchB, { toB: 0.44, hold: 0.12, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'bridge', stanceW: 0.26, toeOut: 0.08, hands: 'free', forearmTwist: 0.6, elbowFlare: 0.70, grip: 'open', spine: 'flex' },
  },
  glute_bridge: {
    label: 'Γέφυρα γλουτών', tempo: 3.0, prof: [0.40, 0.20, 0.40], yaw: 1.25, floor: true,
    A: bridgeA, B: bridgeB,
    keys: phases(bridgeA, bridgeB, { toB: 0.40, hold: 0.20, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'bridge', stanceW: 0.28, toeOut: 0.12, hands: 'supine_mat', forearmTwist: -1.35, elbowFlare: 0.18, grip: 'floor', spine: 'neutral' },
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
    ik: { feet: 'bird_dog', stanceW: 0.22, hands: 'bird_dog', handExtraW: 0.02, forearmTwist: -1.35, elbowFlare: 0.24, grip: 'floor', spine: 'neutral' },
  },
  generic: {
    label: 'Κίνηση άσκησης', tempo: 2.4, yaw: 0.45, alt: true,
    A: P({ ...arms(-0.26, 0.08, -0.78), ...legs(-0.04, 0.08, 0.03) }),
    B: P({ ty: 0.10, slx: 0.18, srx: -0.78, slz: -0.08, srz: 0.08, elL: -0.95, elR: -1.25, hlx: -0.72, knL: 0.96, hrx: 0.04, knR: 0.08 }),
    ik: { feet: 'free', hands: 'free', forearmTwist: 0, elbowFlare: 0.22, grip: 'relaxed', spine: 'neutral' },
  },

  // ---- ΓΥΡΟΣ 2: 17 ΑΣΚΗΣΕΙΣ ----
  mountain_climber: {
    palm: 'flat', label: 'Ορειβάτης (Mountain climber)', tempo: 1.35, yaw: 1.25, floor: true, flatFeet: false, alt: true,
    A: climbA, B: climbB,
    keys: [
      { t: 0.00, p: climbA },
      { t: 0.44, p: climbB, ease: 'out' },
      { t: 0.54, p: climbB, ease: 'linear' },
      { t: 1.00, p: climbA, ease: 'inOut' },
    ],
    ik: { feet: 'mountain_climber', stanceW: 0.22, hands: 'floor', handExtraW: 0.05, forearmTwist: -1.35, elbowFlare: 0.28, grip: 'floor', spine: 'neutral' },
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
    ik: { feet: 'burpee', stanceW: 0.26, hands: 'floor_burpee', handExtraW: 0.09, forearmTwist: -1.35, elbowFlare: 0.40, grip: 'floor', spine: 'neutral' },
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
    palm: 'flat', label: 'Πλάγια σανίδα', tempo: 3.0, yaw: 0.25, floor: true, hold: true, flatFeet: false,
    frame: { h: 1.75, w: 2.35, cy: 0.46 },
    A: sidePlankP, B: sidePlankP,
    keys: [{ t: 0, p: sidePlankP }, { t: 1, p: sidePlankP }],
    ik: { feet: 'side_plank', hands: 'side_plank', forearmTwist: -1.30, elbowFlare: 0.35, grip: 'relaxed', spine: 'neutral' },
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
    ik: { feet: 'free', hands: 'russian_twist', forearmTwist: 0, elbowFlare: 0.45, grip: 'dumbbell', spine: 'twist' },
  },
  reverse_lunge: {
    label: 'Οπίσθιες προβολές', tempo: 3.4, prof: [0.48, 0.08, 0.44], yaw: 0.96, alt: true, noZ: true,
    A: revLungeA, B: revLungeB,
    keys: [
      { t: 0.00, p: revLungeA },
      { t: 0.16, p: revLungeStep, ease: 'cubic' },
      { t: 0.48, p: revLungeB, ease: 'inOut' },
      { t: 0.56, p: revLungeB, ease: 'linear' },
      { t: 0.86, p: revLungeStep, ease: 'out' },
      { t: 1.00, p: revLungeA, ease: 'cubic' },
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
    ik: { feet: 'step_up', stanceW: 0.24, toeOut: 0.06, hands: 'free', forearmTwist: 0, elbowFlare: 0.22, grip: 'relaxed', spine: 'neutral', prop: 'step' },
  },
  wall_sit: {
    label: 'Κάθισμα στον τοίχο', tempo: 3.0, yaw: 1.05, hold: true, noZ: true,
    frame: { h: 2.15, w: 1.85, cy: 0.74 },
    A: wallSitP, B: wallSitP,
    keys: [{ t: 0, p: wallSitP }, { t: 1, p: wallSitP }],
    ik: { feet: 'wall_sit', stanceW: 0.30, toeOut: 0.08, hands: 'free', forearmTwist: 0, elbowFlare: 0.24, grip: 'relaxed', spine: 'neutral', prop: 'wall' },
  },
  hip_thrust: {
    label: 'Ωθήσεις ισχίων (Hip thrust)', tempo: 3.0, prof: [0.40, 0.20, 0.40], yaw: 1.22, floor: true,
    frame: { h: 1.85, w: 2.45, cy: 0.46 },
    A: hipThrustA, B: hipThrustB,
    keys: phases(hipThrustA, hipThrustB, { toB: 0.40, hold: 0.20, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'hip_thrust', stanceW: 0.32, toeOut: 0.14, hands: 'hip_bar', forearmTwist: -1.20, elbowFlare: 0.35, grip: 'bar', spine: 'neutral', prop: 'bench' },
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
    ik: { feet: 'planted', stanceW: 0.26, toeOut: 0.14, hands: 'deadlift_bar', forearmTwist: -1.35, elbowFlare: 0.14, grip: 'bar', spine: 'neutral' },
  },
  back_squat: {
    label: 'Καθίσματα με μπάρα στην πλάτη', tempo: 3.2, prof: [0.46, 0.10, 0.44], yaw: 0.85,
    A: backSquatA, B: backSquatB,
    keys: phases(backSquatA, backSquatB, { brace: backSquatBrace, toB: 0.46, hold: 0.10 }),
    ik: { feet: 'planted', stanceW: 0.36, toeOut: 0.24, hands: 'back_bar', forearmTwist: -1.15, elbowFlare: 0.52, grip: 'bar', spine: 'neutral' },
  },
  barbell_row: {
    label: 'Κωπηλατική με μπάρα', tempo: 3.0, prof: [0.40, 0.12, 0.48], yaw: 0.96,
    A: bbRowA, B: bbRowB,
    keys: phases(bbRowA, bbRowB, { toB: 0.40, hold: 0.12, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'planted', stanceW: 0.30, toeOut: 0.14, hands: 'row_bar', forearmTwist: -1.30, elbowFlare: 0.28, grip: 'bar', spine: 'neutral' },
  },
  triceps_dip: {
    palm: 'flat', label: 'Βυθίσεις τρικεφάλων σε καρέκλα', tempo: 3.0, prof: [0.46, 0.08, 0.46], yaw: 1.15, floor: true,
    frame: { h: 1.95, w: 2.25, cy: 0.52 },
    A: dipTop, B: dipBot,
    keys: phases(dipTop, dipBot, { toB: 0.46, hold: 0.08, easeDown: 'inOut', easeUp: 'out' }),
    ik: { feet: 'planted', stanceW: 0.24, footZ: 0.62, toeOut: 0.06, hands: 'chair_dip', handExtraW: 0.045, forearmTwist: -1.35, elbowFlare: 0.05, grip: 'chair', spine: 'neutral', prop: 'bench' },
  },
  band_pull_apart: {
    label: 'Διάνοιξη λάστιχου', tempo: 2.8, prof: [0.42, 0.14, 0.44], yaw: 0.22,
    A: bandA, B: bandB,
    keys: phases(bandA, bandB, { toB: 0.42, hold: 0.14, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'planted', stanceW: 0.26, toeOut: 0.10, hands: 'band_pull', bandAnchor: 'hands', forearmTwist: -1.25, elbowFlare: 0.45, grip: 'bar', spine: 'neutral' },
  },
  trx_squat: {
    label: 'Καθίσματα με TRX', tempo: 3.2, prof: [0.46, 0.10, 0.44], yaw: 1.05,
    frame: { h: 2.70, w: 2.40, cy: 1.15 },
    A: trxSquatA, B: trxSquatB,
    keys: phases(trxSquatA, trxSquatB, { toB: 0.46, hold: 0.10 }),
    ik: { feet: 'planted', stanceW: 0.34, toeOut: 0.20, hands: 'trx_pull', handW: 0.34, forearmTwist: 0, elbowFlare: 0.26, grip: 'trx', spine: 'neutral' },
  },
  trx_chest_press: {
    label: 'Πιέσεις στήθους με TRX', tempo: 3.0, prof: [0.46, 0.08, 0.46], yaw: 1.15, floor: true, flatFeet: false,
    frame: { h: 2.70, w: 2.45, cy: 1.15 },
    A: trxPressA, B: trxPressB,
    keys: phases(trxPressA, trxPressB, { toB: 0.46, hold: 0.08, easeDown: 'inOut', easeUp: 'out' }),
    ik: { feet: 'toe', stanceW: 0.26, footZ: -0.56, hands: 'trx_push', handExtraW: 0.12, forearmTwist: -1.35, elbowFlare: 0.48, grip: 'trx', spine: 'neutral' },
  },

  // ---- ΓΥΡΟΣ 3 (TASK B): ΑΓΚΥΡΩΜΕΝΕΣ ΑΣΚΗΣΕΙΣ ΛΑΣΤΙΧΟΥ ----
  standing_row: {
    label: 'Όρθια κωπηλατική με λάστιχο', tempo: 3.0, prof: [0.40, 0.14, 0.46], yaw: 1.02,
    frame: { h: 2.35, w: 2.65, cy: 0.92 },
    A: standRowA, B: standRowB,
    keys: phases(standRowA, standRowB, { toB: 0.40, hold: 0.14, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'planted', stanceW: 0.30, toeOut: 0.12, hands: 'standing_row', bandAnchor: 'front_chest', forearmTwist: 0, elbowFlare: 0.14, grip: 'bar', spine: 'neutral' },
  },
  face_pull: {
    label: 'Έλξη προσώπου (Face pull)', tempo: 3.0, prof: [0.40, 0.16, 0.44], yaw: 0.92,
    frame: { h: 2.40, w: 2.65, cy: 0.98 },
    A: facePullA, B: facePullB,
    keys: phases(facePullA, facePullB, { toB: 0.40, hold: 0.16, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'planted', stanceW: 0.30, toeOut: 0.12, hands: 'face_pull', bandAnchor: 'front_high', forearmTwist: 0.35, elbowFlare: 0.85, grip: 'bar', spine: 'neutral' },
  },
  lat_pulldown: {
    label: 'Έλξεις πλάτης με λάστιχο (Lat pulldown)', tempo: 3.0, prof: [0.42, 0.14, 0.44], yaw: 0.92,
    frame: { h: 2.65, w: 2.40, cy: 1.12 },
    A: latPullA, B: latPullB,
    keys: phases(latPullA, latPullB, { toB: 0.42, hold: 0.14, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'planted', stanceW: 0.32, toeOut: 0.14, hands: 'lat_pulldown', bandAnchor: 'front_high', forearmTwist: -1.15, elbowFlare: 0.45, grip: 'bar', spine: 'neutral' },
  },
  band_chest_press: {
    label: 'Όρθιες πιέσεις στήθους με λάστιχο', tempo: 3.0, prof: [0.42, 0.12, 0.46], yaw: 1.05,
    frame: { h: 2.35, w: 2.65, cy: 0.92 },
    A: bandPressA, B: bandPressB,
    keys: phases(bandPressA, bandPressB, { toB: 0.42, hold: 0.12, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'planted', stanceW: 0.30, toeOut: 0.12, hands: 'band_chest_press', bandAnchor: 'behind_chest', forearmTwist: -1.30, elbowFlare: 0.42, grip: 'bar', spine: 'neutral' },
  },
  pallof_press: {
    label: 'Πίεση Pallof (αντι-στροφή)', tempo: 3.2, prof: [0.38, 0.24, 0.38], yaw: 0.45,
    frame: { h: 2.35, w: 2.70, cy: 0.92 },
    A: pallofA, B: pallofB,
    keys: phases(pallofA, pallofB, { toB: 0.38, hold: 0.24, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'planted', stanceW: 0.34, toeOut: 0.12, hands: 'pallof_press', bandAnchor: 'side_waist', forearmTwist: 0, elbowFlare: 0.20, grip: 'bar', spine: 'neutral' },
  },
  woodchop: {
    label: 'Διαγώνια στροφή κορμού (Woodchop)', tempo: 3.0, prof: [0.44, 0.12, 0.44], yaw: 0.36,
    frame: { h: 2.50, w: 2.75, cy: 0.98 },
    A: woodchopA, B: woodchopB,
    keys: [
      { t: 0.00, p: woodchopA },
      { t: 0.22, p: woodchopMid, ease: 'out' },
      { t: 0.44, p: woodchopB, ease: 'out' },
      { t: 0.56, p: woodchopB, ease: 'linear' },
      { t: 0.78, p: woodchopMid, ease: 'inOut' },
      { t: 1.00, p: woodchopA, ease: 'cubic' },
    ],
    ik: { feet: 'planted', stanceW: 0.42, toeOut: 0.16, hands: 'woodchop', bandAnchor: 'side_high', forearmTwist: 0, elbowFlare: 0.28, grip: 'bar', spine: 'twist' },
  },

  // ---- ΓΥΡΟΣ 3 (TASK C): 25 ΕΞΕΙΔΙΚΕΥΜΕΝΕΣ ΠΑΡΑΛΛΑΓΕΣ ΑΣΚΗΣΕΩΝ ----
  knee_pushup: {
    palm: 'flat', label: 'Κάμψεις στα γόνατα', tempo: 3.0, prof: [0.46, 0.08, 0.46], yaw: 1.25, floor: true, flatFeet: false,
    A: kneePushTop, B: kneePushBot,
    keys: phases(kneePushTop, kneePushBot, { toB: 0.46, hold: 0.08, easeDown: 'inOut', easeUp: 'out' }),
    ik: { feet: 'knee_pushup', stanceW: 0.22, hands: 'knee_floor', handExtraW: 0.10, forearmTwist: -1.35, elbowFlare: 0.40, grip: 'floor', spine: 'neutral' },
  },
  wall_pushup: {
    palm: 'flat', label: 'Κάμψεις σε τοίχο', tempo: 2.8, prof: [0.46, 0.08, 0.46], yaw: 1.48, noZ: true,
    frame: { h: 2.35, w: 2.35, cy: 0.92 },
    A: wallPushA, B: wallPushB,
    keys: phases(wallPushA, wallPushB, { toB: 0.46, hold: 0.08, easeDown: 'inOut', easeUp: 'out' }),
    ik: { feet: 'planted', stanceW: 0.26, footZ: -0.46, toeOut: 0.06, hands: 'wall_push', handExtraW: 0.08, forearmTwist: -1.35, elbowFlare: 0.38, grip: 'floor', spine: 'neutral', prop: 'wall' },
  },
  incline_pushup: {
    palm: 'flat', label: 'Κάμψεις με κλίση σε καρέκλα', tempo: 3.0, prof: [0.46, 0.08, 0.46], yaw: 1.20, floor: true, flatFeet: false,
    frame: { h: 2.05, w: 2.45, cy: 0.65 },
    A: incPushA, B: incPushB,
    keys: phases(incPushA, incPushB, { toB: 0.46, hold: 0.08, easeDown: 'inOut', easeUp: 'out' }),
    ik: { feet: 'toe', stanceW: 0.24, hands: 'bench_push', handExtraW: 0.06, forearmTwist: -1.35, elbowFlare: 0.38, grip: 'chair', spine: 'neutral', prop: 'bench' },
  },
  knee_side_plank: {
    palm: 'flat', label: 'Πλάγια σανίδα στα γόνατα', tempo: 3.0, yaw: 0.25, floor: true, hold: true, flatFeet: false,
    frame: { h: 1.70, w: 2.20, cy: 0.44 },
    A: kneeSidePlankP, B: kneeSidePlankP,
    keys: [{ t: 0, p: kneeSidePlankP }, { t: 1, p: kneeSidePlankP }],
    ik: { feet: 'knee_side_plank', hands: 'side_plank', forearmTwist: -1.30, elbowFlare: 0.35, grip: 'relaxed', spine: 'neutral' },
  },
  plank_shoulder_tap: {
    palm: 'flat', label: 'Σανίδα με επαφή ώμων', tempo: 2.4, prof: [0.40, 0.16, 0.44], yaw: 0.92, floor: true, flatFeet: false, alt: true,
    A: tapA, B: tapB,
    keys: phases(tapA, tapB, { toB: 0.40, hold: 0.16, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'toe', stanceW: 0.32, hands: 'plank_tap', handExtraW: 0.04, forearmTwist: -1.35, elbowFlare: 0.26, grip: 'floor', spine: 'neutral' },
  },
  leg_raise: {
    label: 'Ανυψώσεις ποδιών (ύπτια)', tempo: 3.2, prof: [0.44, 0.12, 0.44], yaw: 1.25, floor: true, flatFeet: false,
    frame: { h: 1.85, w: 2.55, cy: 0.46 },
    A: legRaiseA, B: legRaiseB,
    keys: phases(legRaiseA, legRaiseB, { toB: 0.44, hold: 0.12, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'free', hands: 'supine_mat', forearmTwist: -1.35, elbowFlare: 0.18, grip: 'floor', spine: 'flex' },
  },
  bicycle_crunch: {
    label: 'Ποδήλατο κοιλιακών', tempo: 2.0, prof: [0.44, 0.10, 0.46], yaw: 1.10, floor: true, flatFeet: false, alt: true,
    A: bikeA, B: bikeB,
    keys: phases(bikeA, bikeB, { toB: 0.44, hold: 0.10, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'free', hands: 'free', forearmTwist: 0.6, elbowFlare: 0.72, grip: 'open', spine: 'twist' },
  },
  cat_cow: {
    palm: 'flat', label: 'Γάτα-Αγελάδα (Cat-Cow)', tempo: 4.0, prof: [0.42, 0.16, 0.42], yaw: 1.22, floor: true, flatFeet: false,
    A: catCowA, B: catCowB,
    keys: phases(catCowA, catCowB, { toB: 0.42, hold: 0.16, easeDown: 'inOut', easeUp: 'inOut' }),
    ik: { feet: 'quadruped', stanceW: 0.24, hands: 'quadruped', handExtraW: 0.02, forearmTwist: -1.35, elbowFlare: 0.22, grip: 'floor', spine: 'flex' },
  },
  child_pose: {
    palm: 'flat', label: 'Διάταση παιδιού (Child pose)', tempo: 4.0, yaw: 1.22, floor: true, hold: true, flatFeet: false,
    frame: { h: 1.65, w: 2.35, cy: 0.34 },
    A: childPoseP, B: childPoseP,
    keys: [{ t: 0, p: childPoseP }, { t: 1, p: childPoseP }],
    ik: { feet: 'child_pose', stanceW: 0.28, hands: 'child_pose', handExtraW: 0.02, forearmTwist: -1.35, elbowFlare: 0.24, grip: 'floor', spine: 'flex' },
  },
  box_squat: {
    label: 'Καθίσματα σε καρέκλα (Box squat)', tempo: 3.2, prof: [0.44, 0.16, 0.40], yaw: 1.02, noZ: true,
    frame: { h: 2.35, w: 2.15, cy: 0.80 },
    A: boxSquatA, B: boxSquatB,
    keys: phases(boxSquatA, boxSquatB, { toB: 0.44, hold: 0.16, easeDown: 'inOut', easeUp: 'out' }),
    ik: { feet: 'box_squat', stanceW: 0.36, footZ: 0.18, toeOut: 0.20, hands: 'free', forearmTwist: 0, elbowFlare: 0.30, grip: 'relaxed', spine: 'neutral', prop: 'bench' },
  },
  bulgarian_split_squat: {
    label: 'Βουλγαρικά καθίσματα (Bulgarian split squat)', tempo: 3.4, prof: [0.46, 0.10, 0.44], yaw: 1.08, alt: true, noZ: true,
    frame: { h: 2.35, w: 2.35, cy: 0.82 },
    A: bssA, B: bssB,
    keys: phases(bssA, bssB, { toB: 0.46, hold: 0.10, easeDown: 'inOut', easeUp: 'out' }),
    ik: { feet: 'bulgarian', stanceW: 0.26, toeOut: 0.06, hands: 'free', forearmTwist: 0, elbowFlare: 0.22, grip: 'relaxed', spine: 'neutral', prop: 'bench' },
  },
  side_lunge: {
    label: 'Πλάγιες εκπτώσεις (Side lunge)', tempo: 3.4, prof: [0.46, 0.10, 0.44], yaw: 0.22, alt: true, noZ: true,
    frame: { h: 2.30, w: 2.10, cy: 0.80 },
    A: sideLungeA, B: sideLungeB,
    keys: [
      { t: 0.00, p: sideLungeA },
      { t: 0.18, p: sideLungeStep, ease: 'cubic' },
      { t: 0.46, p: sideLungeB, ease: 'inOut' },
      { t: 0.56, p: sideLungeB, ease: 'linear' },
      { t: 0.84, p: sideLungeStep, ease: 'out' },
      { t: 1.00, p: sideLungeA, ease: 'cubic' },
    ],
    ik: { feet: 'side_lunge', stanceW: 0.26, toeOut: 0.08, hands: 'free', forearmTwist: 0, elbowFlare: 0.24, grip: 'relaxed', spine: 'neutral' },
  },
  seated_overhead_press: {
    palm: 'fwd', label: 'Καθιστές πιέσεις ώμων', tempo: 3.0, prof: [0.42, 0.12, 0.46], yaw: 0.52, noZ: true,
    frame: { h: 2.25, w: 1.95, cy: 0.86 },
    A: seatOhpA, B: seatOhpB,
    keys: phases(seatOhpA, seatOhpB, { toB: 0.42, hold: 0.12, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'seated', stanceW: 0.30, footZ: 0.36, toeOut: 0.10, hands: 'ohp', forearmTwist: -1.25, elbowFlare: 0.42, grip: 'dumbbell', spine: 'neutral', prop: 'bench' },
  },
  bench_press: {
    palm: 'fwd', label: 'Πιέσεις στήθους σε πάγκο (Bench press)', tempo: 3.0, prof: [0.44, 0.10, 0.46], yaw: 1.08, floor: true,
    frame: { h: 1.85, w: 2.35, cy: 0.62 },
    A: benchPressA, B: benchPressB,
    keys: phases(benchPressA, benchPressB, { toB: 0.44, hold: 0.10, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'bench_press', stanceW: 0.46, toeOut: 0.16, hands: 'bench_press', forearmTwist: -1.25, elbowFlare: 0.52, grip: 'dumbbell', spine: 'neutral', prop: 'bench_flat' },
  },
  tricep_kickback: {
    label: 'Εκτάσεις τρικεφάλων (Kickbacks)', tempo: 2.8, prof: [0.40, 0.16, 0.44], yaw: 1.05,
    A: kickbackA, B: kickbackB,
    keys: phases(kickbackA, kickbackB, { toB: 0.40, hold: 0.16, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'planted', stanceW: 0.28, toeOut: 0.12, hands: 'kickback', forearmTwist: 0, elbowFlare: 0.08, grip: 'dumbbell', spine: 'neutral' },
  },
  tricep_extension: {
    label: 'Υπερέκταση τρικεφάλων πάνω από το κεφάλι', tempo: 3.0, prof: [0.42, 0.14, 0.44], yaw: 0.68,
    frame: { h: 2.48, w: 1.75, cy: 0.96 },
    A: triExtA, B: triExtB,
    keys: phases(triExtA, triExtB, { toB: 0.42, hold: 0.14, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'planted', stanceW: 0.28, toeOut: 0.10, hands: 'tricep_ext', forearmTwist: 0, elbowFlare: 0.14, grip: 'dumbbell', spine: 'neutral' },
  },
  pull_up: {
    palm: 'fwd', label: 'Έλξεις σε μονόζυγο (Pull-up)', tempo: 3.2, prof: [0.42, 0.14, 0.44], yaw: 0.52, floor: true, flatFeet: false,
    frame: { h: 2.75, w: 2.10, cy: 1.25 },
    A: pullUpA, B: pullUpB,
    keys: phases(pullUpA, pullUpB, { toB: 0.42, hold: 0.14, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'hang', hands: 'pullup_bar', forearmTwist: -1.30, elbowFlare: 0.55, grip: 'bar', spine: 'neutral', prop: 'pullup_bar' },
  },
  one_arm_row: {
    label: 'Κωπηλατική με έναν αλτήρα σε πάγκο', tempo: 3.0, prof: [0.40, 0.14, 0.46], yaw: 1.02, floor: true,
    frame: { h: 2.05, w: 2.35, cy: 0.68 },
    A: oneArmRowA, B: oneArmRowB,
    keys: phases(oneArmRowA, oneArmRowB, { toB: 0.40, hold: 0.14, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'one_arm_row', hands: 'one_arm_row', forearmTwist: 0, elbowFlare: 0.14, grip: 'dumbbell', spine: 'neutral', prop: 'bench_flat' },
  },
  squat_jump: {
    label: 'Άλματα από κάθισμα (Squat jump)', tempo: 2.0, yaw: 0.85, noZ: true,
    frame: { h: 2.95, w: 1.95, cy: 1.10 },
    A: sqJumpLoad, B: sqJumpAir,
    keys: [
      { t: 0.00, p: sqJumpLoad },
      { t: 0.36, p: sqJumpAir, ease: 'out' },
      { t: 0.52, p: sqJumpAir, ease: 'linear' },
      { t: 0.74, p: sqJumpLand, ease: 'in' },
      { t: 1.00, p: sqJumpLoad, ease: 'inOut' },
    ],
    ik: { feet: 'squat_jump', stanceW: 0.34, toeOut: 0.20, hands: 'free', forearmTwist: 0, elbowFlare: 0.30, grip: 'open', spine: 'neutral' },
  },
  skater_jump: {
    label: 'Άλματα πατινάζ (Skater jump)', tempo: 1.8, yaw: 0.22, alt: true, noZ: true,
    frame: { h: 2.35, w: 2.20, cy: 0.88 },
    A: skaterA, B: skaterAir,
    keys: [
      { t: 0.00, p: skaterA },
      { t: 0.38, p: skaterAir, ease: 'out' },
      { t: 0.56, p: skaterLand, ease: 'in' },
      { t: 0.72, p: skaterLand, ease: 'linear' },
      { t: 1.00, p: skaterA, ease: 'inOut' },
    ],
    ik: { feet: 'skater', stanceW: 0.26, hands: 'free', forearmTwist: 0, elbowFlare: 0.26, grip: 'open', spine: 'twist' },
  },
  step_calf_raise: {
    label: 'Ανυψώσεις γάμπας σε σκαλί', tempo: 2.6, prof: [0.40, 0.20, 0.40], yaw: 1.02, noZ: true,
    frame: { h: 2.50, w: 1.95, cy: 1.02 },
    A: stepCalfA, B: stepCalfB,
    keys: phases(stepCalfA, stepCalfB, { toB: 0.40, hold: 0.20, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'step_calf', stanceW: 0.22, toeOut: 0.05, hands: 'free', forearmTwist: 0, elbowFlare: 0.18, grip: 'relaxed', spine: 'neutral', prop: 'step' },
  },
  march_in_place: {
    label: 'Περπάτημα επί τόπου', tempo: 1.7, yaw: 0.62, alt: true, noZ: true,
    A: marchA, B: marchB,
    keys: [
      { t: 0.00, p: marchA },
      { t: 0.44, p: marchB, ease: 'out' },
      { t: 0.56, p: marchB, ease: 'linear' },
      { t: 1.00, p: marchA, ease: 'inOut' },
    ],
    ik: { feet: 'march', stanceW: 0.24, toeOut: 0.06, hands: 'free', forearmTwist: 0, elbowFlare: 0.18, grip: 'relaxed', spine: 'neutral' },
  },
  jump_rope: {
    label: 'Σχοινάκι', tempo: 0.95, yaw: 0.42, noZ: true,
    frame: { h: 2.55, w: 2.15, cy: 0.98 },
    A: ropeA, B: ropeB,
    keys: [
      { t: 0.00, p: ropeA },
      { t: 0.40, p: ropeB, ease: 'out' },
      { t: 0.58, p: ropeB, ease: 'linear' },
      { t: 1.00, p: ropeA, ease: 'in' },
    ],
    ik: { feet: 'jump_rope', stanceW: 0.18, toeOut: 0.05, hands: 'jump_rope', forearmTwist: 0, elbowFlare: 0.20, grip: 'bar', spine: 'neutral', prop: 'jump_rope' },
  },
  farmer_walk: {
    label: 'Βάδισμα αγρότη (Farmer walk)', tempo: 1.8, yaw: 0.65, alt: true, noZ: true,
    A: farmerA, B: farmerB,
    keys: [
      { t: 0.00, p: farmerA },
      { t: 0.44, p: farmerB, ease: 'inOut' },
      { t: 0.56, p: farmerB, ease: 'linear' },
      { t: 1.00, p: farmerA, ease: 'inOut' },
    ],
    ik: { feet: 'march', stanceW: 0.26, toeOut: 0.08, hands: 'farmer', forearmTwist: 0, elbowFlare: 0.08, grip: 'dumbbell', spine: 'neutral' },
  },
  trx_y_raise: {
    label: 'TRX Y-raise (ανάταση Υ)', tempo: 3.0, prof: [0.42, 0.14, 0.44], yaw: 0.95, floor: true,
    frame: { h: 2.75, w: 2.50, cy: 1.20 },
    A: trxYA, B: trxYB,
    keys: phases(trxYA, trxYB, { toB: 0.42, hold: 0.14, easeDown: 'out', easeUp: 'inOut' }),
    ik: { feet: 'planted', stanceW: 0.28, footZ: 0.42, toeOut: 0.08, hands: 'trx_y', handW: 0.36, forearmTwist: 0, elbowFlare: 0.45, grip: 'trx', spine: 'neutral' },
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

/** Αφαίρεση τόνων: στα ελληνικά ο τόνος μετακινείται με την κλίση («δικέφαλος» → «δικεφάλων»),
 *  οπότε οι κανόνες ταιριάζουν πάντα σε κείμενο χωρίς τόνους. */
export const deaccent = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Κανόνες αναγνώρισης κίνησης από ελληνικά & αγγλικά ονόματα ασκήσεων (ΟΛΑ τα regex ΧΩΡΙΣ ελληνικούς τόνους).
 * Οι πιο εξειδικευμένοι κανόνες προηγούνται ώστε να μην «κλέβονται» από γενικούς.
 */
const RULES = [
  // ---- Εξειδικευμένες ασκήσεις εδάφους & κινητικότητας ----
  [/cat.?cow|γατα.?αγελαδ|αγελαδ.?γατα/i, 'cat_cow'],
  [/child.?s?\s*pose|διαταση\s*παιδι|σταση\s*παιδι|θεση\s*παιδι/i, 'child_pose'],
  [/mountain.?climb|ορειβατ/i, 'mountain_climber'],
  [/burpee|μπερπι/i, 'burpee'],
  [/dead.?bug|νεκρο\s*εντομ/i, 'dead_bug'],
  [/bird.?dog|διαγωνια\s*εκταση|στα\s*τεσσερα|τετραποδ|quadruped|superman.*γονατ/i, 'bird_dog'],
  [/superman|σουπερμαν|υπερεκταση\s*ραχ|ραχιαι/i, 'superman'],
  [/bicycle|ποδηλατ.*κοιλ|κοιλ.*ποδηλατ/i, 'bicycle_crunch'],
  [/leg\s*raise|ανυψωσ(η|εις)\s*ποδι|αρσ(η|εις)\s*ποδι/i, 'leg_raise'],
  [/(side\s*plank|πλαγια\s*σανιδ|πλαινη\s*σανιδ|πλαγιο\s*πλανκ).*(knee|γονατ)|(knee|γονατ).*(side\s*plank|πλαγια\s*σανιδ|πλαινη\s*σανιδ)/i, 'knee_side_plank'],
  [/side\s*plank|πλαγια\s*σανιδ|πλαινη\s*σανιδ|πλαγιο\s*πλανκ/i, 'side_plank'],
  [/shoulder\s*tap|(plank|σανιδ|πλανκ).*(επαφ.*ωμ|αγγιγμ.*ωμ|tap)/i, 'plank_shoulder_tap'],
  [/russian\s*twist|ρωσικ|στροφες\s*κορμου/i, 'russian_twist'],

  // ---- Παραλλαγές κάμψεων (πριν από το γενικό pushup!) ----
  [/wall\s*push.?up|(push.?up|καμψ(η|εις)).*(τοιχ|wall)|(τοιχ|wall).*(push.?up|καμψ(η|εις))/i, 'wall_pushup'],
  [/incline\s*push.?up|elevated\s*push.?up|(push.?up|καμψ(η|εις)).*(καρεκλ|παγκ|bench|chair|κλισ|υπερυψ)/i, 'incline_pushup'],
  [/knee\s*push.?up|modified\s*push.?up|(push.?up|καμψ(η|εις)).*(γονατ|knee)/i, 'knee_pushup'],

  // ---- Εξειδικευμένες ασκήσεις λάστιχου (Task B) ----
  [/pallof|παλοφ|αντι.?στροφ/i, 'pallof_press'],
  [/wood.?chop|ξυλοκοπ|διαγωνι.*στροφ.*(λαστιχ|κορμ)/i, 'woodchop'],
  [/face\s*pull|ελξ.*προσωπ|τραβηγμ.*προσωπ/i, 'face_pull'],
  [/lat\s*pull.?down|pulldown|ελξ.*πλατ.*(λαστιχ|ψηλ|τροχαλ)|κατεβασμ.*πλατ/i, 'lat_pulldown'],
  [/band\s*pull.?apart|pull.?apart|διανοιξη.*λαστιχ|ανοιγματα.*λαστιχ|ανοιγμα.*λαστιχ/i, 'band_pull_apart'],
  [/(band|λαστιχ).*(chest\s*press|πιεσ.*στηθ)|(chest\s*press|πιεσ.*στηθ).*(band|λαστιχ)/i, 'band_chest_press'],
  [/(standing|ορθι|σταθερ|chest.?height|υψος\s*στηθ).*(band|λαστιχ).*(row|κωπηλ)|(row|κωπηλ).*(band|λαστιχ).*(standing|ορθι|σταθερ|chest|στηθ)|(band|λαστιχ).*(row|κωπηλ).*(standing|ορθι|σταθερ)/i, 'standing_row'],

  // ---- TRX (y-raise πριν από τα υπόλοιπα!) ----
  [/(trx|ιμαντ|suspension).*(y.?raise|y\s*fly|αναταση\s*y|\by\b)|(y.?raise).*(trx|ιμαντ|suspension)/i, 'trx_y_raise'],
  [/(trx|ιμαντ|suspension).*(chest|push|press)|(chest|στηθ|πιεσ).*(trx|ιμαντ|suspension)/i, 'trx_chest_press'],
  [/(trx|ιμαντ|suspension).*(squat|καθισμ|σκουατ)|(squat|καθισμ|σκουατ).*(trx|ιμαντ|suspension)/i, 'trx_squat'],
  [/(trx|ιμαντ|suspension).*(row|κωπηλ|ελξ)|(row|κωπηλ|ελξ).*(trx|ιμαντ|suspension)|inverted\s*row|αντιστροφη\s*κωπηλ/i, 'incline_row'],

  // ---- Μονόζυγο, Κωπηλατική με έναν αλτήρα, Τρικέφαλοι, Πάγκος ----
  [/pull.?up|chin.?up|μονοζυγ|ελξ(η|εις).*(μονοζυγ|μπαρα\s*ελξ)/i, 'pull_up'],
  [/(one.?arm|single.?arm|εναν\s*αλτηρ|ενα\s*χερ|μονο\s*αλτηρ).*(row|κωπηλ)|(row|κωπηλ).*(one.?arm|single.?arm|εναν\s*αλτηρ|ενα\s*χερ|μονο\s*αλτηρ)/i, 'one_arm_row'],
  [/kick.?back|κι.?κμπακ|[tτ]ricep.*kick/i, 'tricep_kickback'],
  [/([tτ]ricep.*ext|overhead.*[tτ]ricep|υπερεκτασ.*τρικεφ|εκτασ.*τρικεφ|γαλλικ.*πιεσ|skull\s*crush)/i, 'tricep_extension'],
  [/triceps?\s*dip|chair\s*dip|bench\s*dip|βυθισ.*(τρικεφ|καρεκλ|παγκ)|βουτι.*(τρικεφ|καρεκλ|παγκ)|\bdips?\b/i, 'triceps_dip'],
  [/bench\s*press|floor\s*press|πιεσ(η|εις)\s*στηθ|πιεσ(η|εις)\s*σε\s*παγκ|chest\s*press/i, 'bench_press'],
  [/(seated|καθιστ).*(overhead|shoulder\s*press|πιεσ.*ωμ|πρεσ.*ωμ)|(overhead|shoulder\s*press|πιεσ.*ωμ|πρεσ.*ωμ).*(seated|καθιστ)/i, 'seated_overhead_press'],

  // ---- Πόδια: γάμπα σε σκαλί, Bulgarian, box squat, side lunge, άλματα (πριν από γενικά!) ----
  [/(calf|γαμπ|toe\s*raise).*(step|σκαλ|βαθμιδ|υπερυψ)|(step|σκαλ).*(calf|γαμπ)/i, 'step_calf_raise'],
  [/bulgarian|βουλγαρικ|rear\s*foot\s*elevated|rfe\s*split/i, 'bulgarian_split_squat'],
  [/box\s*squat|chair\s*squat|(squat|καθισμ|σκουατ).*(καρεκλ|κουτ|παγκ|box|chair)/i, 'box_squat'],
  [/side\s*lunge|lateral\s*lunge|πλαγι(α|ες)\s*(εκπτωσ|προβολ)/i, 'side_lunge'],
  [/squat\s*jump|jump\s*squat|αλμ.*καθισμ|καθισμ.*αλμ/i, 'squat_jump'],
  [/skater|πατιναζ|πλαγι.*αλμ/i, 'skater_jump'],
  [/wall\s*sit|καθισμα.*τοιχ|τοιχ.*καθισμα|ισομετρικ.*καθισμα/i, 'wall_sit'],
  [/step.?up|box\s*step|ανεβασμα.*(σκαλ|κουτ|παγκ|box)|σκαλοπατ/i, 'step_up'],
  [/hip\s*thrust|ωθησ.*ισχι|ανυψωση\s*λεκανης.*παγκ/i, 'hip_thrust'],
  [/reverse\s*lunge|οπισθι.*(προβολ|εκπτωσ)|πισω\s*(προβολ|εκπτωσ)/i, 'reverse_lunge'],

  // ---- Καρδιοαναπνευστικές / Βάδισμα / Σχοινάκι (πριν από high_knees & jumping_jack!) ----
  [/jump\s*rope|skipping\s*rope|σχοινακ/i, 'jump_rope'],
  [/farmer.?s?\s*(walk|carry)|βαδισμ.*αγροτ|περπατημ.*αλτηρ/i, 'farmer_walk'],
  [/march\s*in\s*place|walk\s*in\s*place|περπατημ.*επι\s*τοπ|βαδην\s*επι\s*τοπ|επι\s*τοπ.*περπατημ/i, 'march_in_place'],

  // ---- Μπάρα / RDL / Deadlift ----
  [/back\s*squat|barbell.*squat|καθισμα.*μπαρα.*πλατ|καθισματα.*μπαρα|μπαρα.*πλατ/i, 'back_squat'],
  [/barbell.*row|bent.?over.*row|κωπηλατικ.*μπαρα|μπαρα.*κωπηλατικ/i, 'barbell_row'],
  [/romanian|rdl|ρουμανικ|good.?morning|swing|hip\s*hinge|ελξη\s*ισχιου/i, 'hinge'],
  [/deadlift|αρσ(η|εις)\s*θανατ|νεκρ(η|ες)\s*αρσ/i, 'deadlift'],

  // ---- Γενικοί κανόνες ----
  [/curl|δικεφαλ|biceps/i, 'curl'],
  [/jumping\s*jack|ανοιχτα\s*αλματα|αλματα\s*ανοι|\bjack/i, 'jumping_jack'],
  [/high.?knee|ψηλα\s*γονατα|τρεξιμο|jog|βαδην|march|skip/i, 'high_knees'],
  [/push.?up|καμψεις|καμψη.*(στηριξη|ωμων|στηθ)|pushup/i, 'pushup'],
  [/plank|σανιδα|πλανκ/i, 'plank'],
  [/lunge|εκπτωσ|προβολ|split\s*squat/i, 'lunge'],
  [/squat|καθισματα|καθισμα|σκουατ/i, 'squat'],
  [/row|κωπηλ|ελξ(η|εις)|pull/i, 'row'],
  [/overhead|shoulder\s*press|military|πιεσεις\s*ωμων|πρεσα\s*ωμων|arnold/i, 'overhead_press'],
  [/front\s*raise|μπροστιν(ες|η|ή)\s*ανυψω|εμπρος\s*ανυψω|προσθι(ες|α)\s*ανυψω/i, 'front_raise'],
  [/lateral|πλαγι(α|ες)\s*ανυψω|side\s*raise/i, 'lateral_raise'],
  [/crunch|κοιλιακ|sit.?up/i, 'crunch'],
  [/bridge|γεφυρα|glute|γλουτ/i, 'glute_bridge'],
  [/calf|γαμπ|toe\s*raise/i, 'calf_raise'],
  [/bench|στηθους|chest/i, 'bench_press'],
];

export function inferMotion(ex) {
  let m = ex.motion && MOTIONS[ex.motion] ? ex.motion : null;
  const eqText = deaccent(`${ex.equipment || ''} ${ex.name || ''} ${ex.youtube_query || ''}`);
  if (!m) {
    const name = deaccent(`${ex.name || ''} ${ex.youtube_query || ''}`);
    m = (RULES.find(([re]) => re.test(name)) || [, 'generic'])[1];
  }
  const hasTrx = /trx|ιμαντ|suspension/i.test(eqText);
  const hasBand = /λαστιχ|band|resistance|ελαστικ/i.test(eqText);
  const hasBar = /barbell|μπαρα(?!\s*(ελξ|pull))|\bbar\b(?!\s*pull)/i.test(eqText);

  if (hasTrx) {
    if (/\by\b.?raise|αναταση\s*y|y\s*fly/i.test(eqText)) m = 'trx_y_raise';
    else if (m === 'row' || m === 'standing_row') m = 'incline_row';
    else if (m === 'squat') m = 'trx_squat';
    else if (m === 'pushup' || m === 'generic' || m === 'bench_press') {
      if (/chest|στηθ|press|πιεσ|push/i.test(eqText)) m = 'trx_chest_press';
    }
  }
  if (hasBand && !hasTrx) {
    // Όρθια κωπηλατική με λάστιχο (εκτός αν ζητηθεί ρητά σκυφτή/bent-over)
    if (m === 'row' && !/bent.?over|σκυφτ/i.test(eqText)) m = 'standing_row';
    else if (m === 'bench_press' && !/bench|παγκ|floor|δαπεδ/i.test(eqText)) m = 'band_chest_press';
  }
  if (hasBar && !hasTrx) {
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
import { getClip, applyClip, clipEntry, getTransition } from './clips.js';
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
    // Σε άσκηση εδάφους που ο coach στέκεται (ξεκούραση/μετάβαση), η κάμερα ανοίγει ώστε να χωρά όρθιος
    const standingNow = m.floor && this.skinned && this.skinned.worldPos('Head').y > 1.0;
    const f = standingNow ? { h: 2.30, w: 2.2, cy: 0.80 } : (m.frame || (m.floor ? { h: 1.75, w: 2.55, cy: 0.38 } : { h: 2.30, w: 1.65, cy: 0.78 }));
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
  /** Χειροκρότημα (τέλος προπόνησης) — motion capture αν υπάρχει */
  celebrate(on = true) { this.celebrating = on; if (on) this.idle(); }

  /** Παίζει μια μετάβαση (καταγραφή μίας φοράς). Επιστρέφει Promise όταν τελειώσει. */
  _playTransition(clip, speed = 1.25) {
    if (!clip || !this.skinned) return Promise.resolve(false);
    this._transDone?.(false);
    return new Promise(res => { this.trans = { clip, t0: this.time, speed, key: Symbol('t') }; this._transDone = res; });
  }

  /** Πριν από ένα σετ: αν ο coach είναι όρθιος και η άσκηση έχει μετάβαση (π.χ. όρθια → σανίδα), την παίζει. */
  async enterExercise() {
    await this.clipReady;
    const wasIdle = this.mode === 'idle' || this.celebrating;
    this.celebrating = false;
    const tr = wasIdle && this.clipAllowed() ? await getTransition(this.motionKey, 'enter') : null;
    this.ready();
    if (tr) await this._playTransition(tr);
  }

  /** Στην ξεκούραση: σηκώνεται με τη μετάβαση (αν υπάρχει) και μετά στέκεται/ανασαίνει.
   *  Σε σύντομη ξεκούραση μένει στη θέση της άσκησης. */
  async exitToRest(restSec = 60) {
    if (restSec < 15 && this.mode !== 'idle') { this.ready(); return; }
    const tr = this.mode !== 'idle' && this.clipAllowed() ? await getTransition(this.motionKey, 'exit') : null;
    if (tr) { const p = this._playTransition(tr); this.idle(); await p; }
    else this.idle();
  }

  /** Επιτρέπεται η καταγραφή με τον τρέχοντα εξοπλισμό; (καταγραφές με βάρη δηλώνουν "props") */
  clipAllowed() {
    if (!this.clip) return false;
    const e = this.equip?.e || {};
    const busy = !!(e.dumbbells || e.kettlebell || e.barbell || e.band || e.straps || e.goblet || e.singleDumbbell || e.jumpRope || e.pullupBar);
    if (this.clipProps?.length) return this.clipProps.every(pr => e[pr]) && !e.singleDumbbell && !e.goblet;
    return !busy;
  }

  setMotion(key) {
    this.motionKey = MOTIONS[key] ? key : 'generic';
    this.motion = MOTIONS[this.motionKey];
    this.yawT = this.motion.yaw;
    this._syncEquipment();
    // Κίνηση από motion capture (αν υπάρχει για αυτή την άσκηση) — αλλιώς η διαδικαστική
    const k = this.motionKey;
    this.clip = null; this.clipProps = null;
    this.clipReady = Promise.all([getClip(k), clipEntry(k)]).then(([c, en]) => {
      if (this.motionKey === k) { this.clip = c; this.clipProps = en?.props || null; }
      return c;
    });
  }

  /** 'clip' αν η τρέχουσα άσκηση παίζει από motion capture, αλλιώς 'procedural' */
  get motionSource() { return this.activeClip && this.activeClip === this.clip && this.skinned && (this.clipW ?? 0) > 0.5 ? 'clip' : 'procedural'; }

  /** Χρόνος μέσα στην κίνηση για την τρέχουσα φάση (κύκλος επανάληψης / στάση / έτοιμος) */
  _clipTime() {
    const c = this.clip;
    if (this._debugMode) return c.repStart + (this._debugU || 0) * c.period * 0.5;
    if (this.mode === 'cycle') return c.repStart + Math.min(this.t / Math.max(this.dur, 0.01), 1) * c.period;
    if (this.mode === 'hold') return c.repStart + (this.t % c.period); // ισομετρική: η καταγραφή παίζει (αναπνοή, μικρο-κινήσεις)
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
      matRotY: 0, matX: 0,
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
    } else if (feetMode === 'bridge' && handsMode === 'supine_mat') {
      // Γέφυρα γλουτών: κεφάλι & ωμοπλάτες ΚΑΡΦΩΜΕΝΕΣ στο στρώμα (y=0.125, z=-0.36),
      // μόνο η λεκάνη & η μέση περιστρέφονται προς τα πάνω σε ευθεία γραμμή ώμοι → ισχία → γόνατα!
      groundLock = 'ik';
      const shY = 0.125;
      const shZ = -0.36;
      const bridgeAng = clamp(-(cur.rrx + Math.PI * 0.5), 0, 0.52);
      hipsPos = rotY(0, shY + torsoLen * Math.sin(bridgeAng), shZ + torsoLen * Math.cos(bridgeAng));
    } else if (feetMode === 'step_calf') {
      // Ανυψώσεις γάμπας σε σκαλί (stepZ=0.28 → σκαλί z=+0.06..+0.50, ύψος 0.34m, μύτες στο χείλος z=+0.11, φτέρνες έξω!)
      meta.stepZ = 0.28;
      const stepH = 0.34;
      const liftH = cur.lift > 0.005 ? Math.min(cur.lift * kScale, 0.052) : -0.056;
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
      // Πλάγια σανίδα (πλήρης / στα γόνατα): στρώμα κατά μήκος του σώματος (90°), ευθεία ώμος → ισχίο → γόνατο/πέλμα προς +X (δεξιά)!
      groundLock = 'ik';
      meta.matRotY = Math.PI * 0.5;
      meta.matX = 0.05;
      const theta = cur.rrz || (feetMode === 'knee_side_plank' ? 1.22 : 1.38);
      const shH = 0.042 + dims.lenArmR * 0.92;
      const hipYFromArm = shH - torsoLen * Math.cos(theta) + shHalfW * Math.sin(theta);
      const legEff = feetMode === 'knee_side_plank' ? dims.lenUpLegR : legReach;
      const hipYFromLeg = 0.060 + legEff * Math.cos(theta) + dims.hipHalfW * Math.sin(theta);
      const minY = feetMode === 'knee_side_plank' ? 0.27 : 0.28;
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
    else if (feetMode === 'bridge') footZ = handsMode === 'supine_mat' ? (-0.36 + torsoLen + dims.lenUpLegL * 0.80) : ((cur.rZ || 0.06) + legReach * 0.56);
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
    } else if (feetMode === 'side_plank') {
      // Πλήρης πλάγια σανίδα: τεντωμένα πόδια εκτείνονται ευθεία προς +X (δεξιά) σε ευθυγράμμιση με τον κορμό!
      groundLock = 'ik';
      const theta = cur.rrz || 1.38;
      const hipJoint = this.skinned ? this.skinned.rest.Hips.pos.distanceTo(this.skinned.rest.LeftUpLeg.pos) : 0.08;
      const footX = (legReach * 0.97 + hipJoint * 0.5) * Math.sin(theta);
      for (const [Side] of [['Left'], ['Right']]) {
        const yF = Side === 'Right' ? 0.055 : 0.125;
        const target = rotY(footX, yF, 0.02);
        const pole = rotY(footX * 0.5, yF + 0.08, 0.35);
        legs[Side] = { target, pole, mode: 'flat', footDir: fwdW, pin: true };
      }
    } else if (feetMode === 'knee_side_plank') {
      // Πλάγια σανίδα στα γόνατα: μηροί εκτείνονται ευθεία προς +X (δεξιά!), γόνατα στο στρώμα, κνήμες λυγισμένες πίσω (-Z)
      groundLock = 'ik';
      const backDir = dirY(0.10, -0.04, -0.99);
      const theta = cur.rrz || 1.22;
      const hipJoint = this.skinned ? this.skinned.rest.Hips.pos.distanceTo(this.skinned.rest.LeftUpLeg.pos) : 0.08;
      const kneeX = (dims.lenUpLegR * 0.94 + hipJoint * 0.45) * Math.sin(theta);
      for (const [Side] of [['Left'], ['Right']]) {
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
      const liftH = cur.lift > 0.005 ? Math.min(cur.lift * kScale, 0.052) : -0.056;
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
            aOut[Side] = { target, pole, forearmTwist: -1.15, gripStyle: 'relaxed' };
          } else {
            const pole = rotY(sgn * (handHalf + 0.38 * flare), 0.28, wristZ - 0.50);
            aOut[Side] = {
              target: floorTgt, pole,
              forearmTwist: -1.35, humeralTwist: 0.16,
              handDir: fwdW.clone(), handPalm: _DOWN, pinFloor: true, gripStyle: 'floor',
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
      } else if (handsMode === 'supine_mat') {
        // Ύπτια στο στρώμα (γέφυρα γλουτών / ανυψώσεις ποδιών): χέρια τεντωμένα πλάι στο σώμα με παλάμες επίπεδες στο στρώμα!
        const shL = getShL();
        const shR = getShR();
        for (const [Side, sgn] of [['Left', 1], ['Right', -1]]) {
          const sh = Side === 'Left' ? shL : shR;
          const target = sh.clone()
            .addScaledVector(fwdW, armReach * 0.90)
            .addScaledVector(rightW, sgn * 0.075);
          target.y = 0.028;
          const pole = target.clone().addScaledVector(fwdW, -0.40).addScaledVector(_Y, -0.15).addScaledVector(rightW, sgn * 0.08);
          aOut[Side] = {
            target, pole,
            forearmTwist: -1.35,
            handDir: fwdW.clone(), handPalm: _DOWN, pinFloor: true, gripStyle: 'floor',
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
          aOut.Left = { target, pole, forearmTwist: -1.35, handDir: fwdW.clone(), handPalm: _DOWN, pinFloor: true, gripStyle: 'floor' };
        }
        if (rightPlanted) {
          const target = rotY(-handHalf, 0.030, wristZ);
          const pole = rotY(-handHalf - 0.10, 0.30, wristZ - 0.48);
          aOut.Right = { target, pole, forearmTwist: -1.35, handDir: fwdW.clone(), handPalm: _DOWN, pinFloor: true, gripStyle: 'floor' };
        }
      } else if (handsMode === 'side_plank') {
        // Κάτω χέρι (Right): αγκώνας & παλάμη επίπεδη στο στρώμα ('floor'), πάνω χέρι (Left): φυσικά χαλαρή παλάμη ('relaxed')
        const shR = getShR();
        const elbowOnMat = new THREE.Vector3(shR.x, 0.042, shR.z);
        const wristTgt = elbowOnMat.clone().addScaledVector(fwdW, dims.lenForeR * 0.94);
        const pole = elbowOnMat.clone().addScaledVector(_Y, -0.45).addScaledVector(fwdW, -0.35);
        aOut.Right = {
          target: wristTgt, pole,
          forearmTwist: -1.35,
          handDir: fwdW.clone(), handPalm: _DOWN, pinFloor: true, gripStyle: 'floor',
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
        // Αριστερό χέρι (+X) επίπεδη παλάμη στον πάγκο ('floor'), δεξί χέρι (-X) σφιχτή λαβή στον αλτήρα ('dumbbell')
        aOut.Left = {
          target: rotY(0.18, 0.468, 0.34),
          pole: rotY(0.24, 0.62, -0.10),
          forearmTwist: -1.35,
          handDir: fwdW.clone(), handPalm: _DOWN, gripStyle: 'floor',
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
        aOut.Right = { target: targetR, pole: poleR, forearmTwist: 0, gripStyle: 'dumbbell' };
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
      matRotY: 0, matX: 0,
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
      // ---- Motion capture πάνω από τη διαδικαστική πόζα ----
      const e = this.equip?.e || {};
      const handsBusy = !!(e.dumbbells || e.kettlebell || e.barbell || e.band || e.straps || e.goblet || e.singleDumbbell || e.jumpRope || e.pullupBar);
      if (!this._specialClips) {
        this._specialClips = true;
        getClip('_idle').then(c => { this.idleClip = c; });
        getClip('_celebrate').then(c => { this.clapClip = c; });
      }
      // Μετάβαση σε εξέλιξη: ολοκληρώνεται όταν περάσει η διάρκειά της
      const tr = this.trans;
      if (tr && (this.time - tr.t0) * tr.speed >= tr.clip.duration - 0.02) { this.trans = null; const r = this._transDone; this._transDone = null; r?.(true); }
      // Επιλογή καταγραφής (προτεραιότητα): μετάβαση → χειροκρότημα → ξεκούραση → κίνηση άσκησης
      let want = null;
      if (this.trans) { const T2 = this.trans; want = { key: T2.key, clip: T2.clip, time: () => Math.min((this.time - T2.t0) * T2.speed, T2.clip.duration - 0.02) }; }
      else if (this.celebrating && this.clapClip) want = { key: 'clap', clip: this.clapClip, time: () => this.time };
      else if (this.mode === 'idle') { if (this.idleClip && !handsBusy) want = { key: 'idle', clip: this.idleClip, time: () => this.time }; }
      else if (this.clipAllowed()) want = { key: this.clip, clip: this.clip, time: () => this._clipTime() };
      // Ομαλή μίξη (0.3 s) ανάμεσα σε καταγραφές — ή από/προς τη διαδικαστική πόζα όταν δεν υπάρχει καταγραφή
      if ((want?.key ?? null) !== (this.trackCur?.key ?? null)) {
        if (this.trackCur) this.trackPrev = { ...this.trackCur, w: this.trackFade ?? 1 };
        this.trackCur = want; this.trackFade = 0;
      }
      this.trackFade = Math.min(1, (this.trackFade ?? 1) + dt / 0.3);
      const fade = this.trackFade;
      if (this.trackPrev) {
        const pw = this.trackCur ? this.trackPrev.w : this.trackPrev.w * (1 - fade);
        applyClip(this.skinned, this.trackPrev.clip, this.trackPrev.time(), this.yaw, pw);
        if (fade >= 1) this.trackPrev = null;
      }
      if (this.trackCur) applyClip(this.skinned, this.trackCur.clip, this.trackCur.time(), this.yaw, this.trackPrev ? fade : Math.min(1, fade + (this.trackPrev ? 0 : 0)));
      this.activeClip = this.trackCur?.clip || null;
      this.clipW = this.trackCur ? fade : 0;
      // Μπάρα στην πλάτη: με καταγραφή, ξανα-τοποθέτηση πάνω στον πραγματικό αυχένα
      if (this.activeClip && meta.barPos && this.motionKey === 'back_squat') {
        const sk = this.skinned, fw = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        meta.barPos = sk.worldPos('Neck').lerp(sk.worldPos('Spine2'), 0.3).addScaledVector(fw, -0.075);
        meta.barAxis = sk.worldPos('LeftArm').sub(sk.worldPos('RightArm')).normalize();
      }
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
      matZ: meta.matRotY ? 0 : ((this.cur.rZ || 0) * (this.k || 1) + (this.cur.rrx > 0.3 ? -0.22 : 0.10)),
      matX: meta.matX || 0,
      matRotY: meta.matRotY || 0,
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


```

## js/skinned.js

```javascript
// Ρεαλιστικός 3D coach: φόρτωση οποιουδήποτε Mixamo-rigged .glb,
// αναλυτικό 2-bone IK απευθείας στις πραγματικές διαστάσεις του σκελετού (zero-lag),
// retargeting με ορθοκανονική βάση, κλίση πέλματος rest-pose, κράτημα δαχτύλων και PBR υλικά.
import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/jsm/loaders/GLTFLoader.js';
import { basisFromDirSec, applyAxialTwist, solveTwoBoneIK, clamp } from './ik.js';
import { HairController } from './hair.js';

const norm = n => n.replace(/^mixamorig[:_]?/i, '');
const V = () => new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];
const FINGER_CASCADE = { Index: 0.90, Middle: 1.00, Ring: 1.08, Pinky: 1.16 };

// Προφίλ κάμψης δαχτύλων [k1 (MCP), k2 (PIP), k3 (DIP), thumbCurl, thumbOppose]
const GRIP_PROFILES = {
  open:       [0.28, 0.36, 0.24, 0.22, 0.18], // φυσικό ανοιχτό χέρι με ήπια ανατομική καμπύλη (όχι άκαμπτο)
  floor:      [-0.04, 0.05, 0.05, 0.06, -0.06], // παλάμες ανοιχτές & επίπεδες στο στρώμα/τοίχο
  relaxed:    [0.56, 0.74, 0.52, 0.38, 0.36], // φυσική χαλαρή καμπύλωση δαχτύλων σε ηρεμία / ελεύθερο χέρι
  fist:       [1.18, 1.50, 1.08, 0.68, 0.64], // απαλή αθλητική γροθιά (προβολές, ψηλά γόνατα, τρέξιμο)
  chair:      [0.72, 0.90, 0.58, 0.26, 0.18], // δάχτυλα αγκαλιάζουν την άκρη της καρέκλας/πάγκου
  bar:        [1.34, 1.56, 1.14, 0.74, 0.68], // σφιχτή λαβή μπάρας/μονόζυγου/λαβής λάστιχου
  dumbbell:   [1.32, 1.54, 1.10, 0.72, 0.64],
  kettlebell: [1.20, 1.46, 1.00, 0.60, 0.54],
  trx:        [1.28, 1.52, 1.06, 0.66, 0.60],
};

/**
 * Αναβάθμιση υλικών φορτωμένου GLB σε MeshPhysicalMaterial (μόνο σε quality='high')
 * με cache ώστε κοινόχρηστα υλικά να μην ανακατασκευάζονται ή διαγράφονται διπλά.
 */
function upgradeMaterials(root, quality) {
  const cache = new Map();
  const toDispose = new Set();

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
      if (cache.has(m)) return cache.get(m);

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
        depthWrite: m.depthWrite,
        side: m.side,
        roughness: m.roughness,
        metalness: m.metalness,
        vertexColors: m.vertexColors,
        envMapIntensity: 0.85,
      });

      if (/eyelash|lash/i.test(tag)) {
        // Βλεφαρίδες (alpha-card): ματ χωρίς clearcoat
        phys.roughness = 0.78;
        phys.metalness = 0.0;
      } else if (/eye|cornea|iris/i.test(tag)) {
        phys.roughness = 0.16;
        phys.clearcoat = 0.75;
        phys.clearcoatRoughness = 0.10;
      } else if (/hair|brow|beard|ponytail/i.test(tag)) {
        phys.roughness = Math.max(m.roughness, 0.48);
        phys.sheen = 0.28;
        phys.sheenRoughness = 0.56;
        phys.clearcoat = 0.14;
        phys.clearcoatRoughness = 0.46;
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
        // Αθλητικά υφάσματα: ματ μικροΐνα με απαλό sheen
        phys.roughness = Math.max(m.roughness, 0.72);
        phys.metalness = Math.min(m.metalness, 0.08);
        phys.sheen = 0.42;
        phys.sheenColor = m.color.clone().lerp(new THREE.Color(0xffffff), 0.35);
        phys.sheenRoughness = 0.80;
        phys.envMapIntensity = 0.68;
      }

      cache.set(m, phys);
      toDispose.add(m);
      return phys;
    });
    o.material = Array.isArray(o.material) ? next : next[0];
  });

  toDispose.forEach(m => m.dispose());
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

    // Κανονικοποίηση μεγέθους: ύψος ≈ 1.70m, πέλματα ακριβώς στο y = 0
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

    // Κλίση πέλματος σε T-pose (Foot → ToeBase κατεβαίνει ~25°· τη διατηρούμε ώστε η σόλα να μένει απόλυτα επίπεδη!)
    let footRestSlope = -0.45;
    let toeRestSlope = 0;
    if (p('LeftToeBase')) {
      const f2t = p('LeftToeBase').clone().sub(p('LeftFoot'));
      const h = Math.max(0.04, Math.hypot(f2t.x, f2t.z));
      footRestSlope = f2t.y / h;
      if (p('LeftToe_End')) {
        const t2e = p('LeftToe_End').clone().sub(p('LeftToeBase'));
        const ht = Math.max(0.02, Math.hypot(t2e.x, t2e.z));
        toeRestSlope = t2e.y / ht;
      }
    }

    const shMid = p('LeftArm').clone().add(p('RightArm')).multiplyScalar(0.5);
    const palmLen = p('LeftHandMiddle1') ? p('LeftHand').distanceTo(p('LeftHandMiddle1')) : 0.075;

    // Πραγματικές ανατομικές διαστάσεις του φορτωμένου μοντέλου (για ακριβές, αυτο-βαθμονομούμενο 2-bone IK)
    this.dims = {
      lenUpLegL: p('LeftUpLeg').distanceTo(p('LeftLeg')),
      lenLegL: p('LeftLeg').distanceTo(p('LeftFoot')),
      lenUpLegR: p('RightUpLeg').distanceTo(p('RightLeg')),
      lenLegR: p('RightLeg').distanceTo(p('RightFoot')),
      lenArmL: p('LeftArm').distanceTo(p('LeftForeArm')),
      lenForeL: p('LeftForeArm').distanceTo(p('LeftHand')),
      lenArmR: p('RightArm').distanceTo(p('RightForeArm')),
      lenForeR: p('RightForeArm').distanceTo(p('RightHand')),
      torsoLen: Math.max(0.32, shMid.distanceTo(p('Hips'))),
      palmLen: clamp(palmLen, 0.05, 0.10),
      footHeight: Math.max(0.055, (p('LeftFoot').y + p('RightFoot').y) * 0.5),
      toeHeight: p('LeftToeBase') ? Math.max(0.018, (p('LeftToeBase').y + p('RightToeBase').y) * 0.5) : 0.024,
      toeFwd: p('LeftToeBase') ? Math.max(0.09, Math.abs(p('LeftToeBase').z - p('LeftFoot').z)) : 0.13,
      footRestSlope,
      toeRestSlope,
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
     */
    const mkEntry = (n, c, sec) => {
      const dir = c ? ch(n, c) : Y.clone();
      const offset = basisFromDirSec(dir, sec, new THREE.Quaternion()).invert().multiply(this.rest[n].world);
      return { n, offset };
    };

    // Αλυσίδα κορμού, κεφαλής & κλειδών (οδηγείται πάντα 1η ώστε να είναι γνωστές οι ακριβείς αρθρώσεις στο τρέχον καρέ)
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
        // Άξονας αντίθεσης αντίχειρα (προς το εσωτερικό της παλάμης, όχι προς τα έξω!)
        const oppAx = new THREE.Vector3(0, side === 'Left' ? 1 : -1, 0).applyQuaternion(invW);
        this.fingers.push({ bone: this.b[n], local: this.rest[n].local, ax, oppAx, side, k, thumb: true });
      }
    }

    this.grip = { Left: 0.25, Right: 0.25 };
    this.gripCur = { Left: 0.25, Right: 0.25 };
    this.gripStyle = { Left: 'relaxed', Right: 'relaxed' };
    this.gripProfCur = { Left: [...GRIP_PROFILES.relaxed], Right: [...GRIP_PROFILES.relaxed] };
    this.offY = 0;

    // Διαχειριστής εναλλακτικής κόμμωσης (Michelle & συμβατά Mixamo μοντέλα)
    this.hair = new HairController(root, this.b.Head, this.quality, opts.hair || 'original');

    // Προ-δεσμευμένα scratch αντικείμενα (zero GC ανά καρέ)
    this._q1 = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._v1 = V();
    this._v2 = V();
    this._v3 = V();
    this._v4 = V();
    this._v5 = V();
    this._ikRes = {
      midPos: V(), endPos: V(), dir1: V(), dir2: V(),
      p1: V(), p2: V(), poleNormal: V(), bendNormal: V(),
      clampedDist: 0, reachRatio: 0,
    };
  }

  setHair(style) {
    this.hair?.setStyle(style);
  }

  updateHair(dt) {
    this.hair?.update(dt);
  }

  resetHairPhysics() {
    this.hair?.resetPhysics();
  }

  dispose() {
    this.hair?.dispose();
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
   * Οδηγεί τον Mixamo σκελετό με 2-σταδίων υβριδικό FK + Αναλυτικό 2-Bone IK (zero frame lag):
   *  1. Κορμός, κεφάλι, κλείδες (FK).
   *  2. Προαιρετική επίλυση στόχων IK (`opts.resolveIK(this)`) πάνω στις ΤΡΕΧΟΥΣΕΣ πραγματικές
   *     θέσεις ώμων/αυχένα/ισχίων του μοντέλου (μηδέν καθυστέρηση καρέ & πλήρης αυτο-βαθμονόμηση).
   *  3. Περιορισμός ύψους πυέλου για καρφωμένα πέλματα.
   *  4. 2-Bone IK ποδιών + ακριβής κλίση σόλας (`footRestSlope`).
   *  5. 2-Bone IK χεριών + στροφή βραχιονίου/αντιβραχίου + επαφή παλάμης.
   *  6. Δάχτυλα & ασφαλής εδαφική επαφή χωρίς ταλαντώσεις.
   */
  drive(targets, hipsPos, dt, opts = {}) {
    let { air = 0, ik = null, groundLock = 'auto', resolveIK = null } = opts;

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

    // 2. Zero-lag επίλυση IK στόχων πάνω στον τρέχοντα προσανατολισμό κορμού του Mixamo μοντέλου
    let resolvedMeta = null;
    if (resolveIK) {
      const res = resolveIK(this);
      if (res) {
        ik = { legs: res.legs, arms: res.arms };
        if (res.groundLock) groundLock = res.groundLock;
        resolvedMeta = res.meta || null;
        if (res.hipsPos) {
          const hipsBone = this.b.Hips;
          const lp = this._v1.copy(res.hipsPos);
          lp.y += this.offY;
          hipsBone.parent.worldToLocal(lp);
          hipsBone.position.copy(lp);
          hipsBone.updateMatrixWorld(true);
          // Επανυπολογισμός εξαρτώμενων στόχων χεριών (π.χ. back_bar / floor) μετά τη ρύθμιση πυέλου
          if (res.refreshArms) res.refreshArms(this, ik);
        }
      }
    }

    // 3. Περιορισμός έκτασης πυέλου για καρφωμένα πέλματα (ποτέ αποκόλληση από το έδαφος)
    if (ik && ik.legs) {
      let maxDrop = 0;
      for (const side of ['Left', 'Right']) {
        const legIK = ik.legs[side];
        if (!legIK || !legIK.pin || !legIK.target) continue;
        const hipPos = this.worldPos(side + 'UpLeg', this._v1);
        const L1 = side === 'Left' ? this.dims.lenUpLegL : this.dims.lenUpLegR;
        const L2 = side === 'Left' ? this.dims.lenLegL : this.dims.lenLegR;
        const maxR = (L1 + L2) * 0.990;
        const dx = hipPos.x - legIK.target.x;
        const dz = hipPos.z - legIK.target.z;
        const dy = hipPos.y - legIK.target.y;
        const distSq = dx * dx + dy * dy + dz * dz;
        const horizSq = dx * dx + dz * dz;
        // Μόνο για κυρίως κατακόρυφο πόδι (όρθιες ασκήσεις). Σε σανίδα/κάμψεις το πόδι είναι σχεδόν οριζόντιο:
        // εκεί το allowDy → 0 και η πύελος «έπεφτε» στο πάτωμα (γονατιστή θέση).
        if (distSq > maxR * maxR && dy > 0.04 && horizSq < (0.6 * maxR) ** 2) {
          const allowDy = horizSq < maxR * maxR ? Math.sqrt(maxR * maxR - horizSq) : 0.04;
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
        if (resolvedMeta?._refreshArms) resolvedMeta._refreshArms(this, ik);
      }
    }

    // 4. Πόδια: Αναλυτικό 2-Bone IK (με footRestSlope ώστε οι σόλες να ακουμπούν 100% επίπεδα!)
    const pinnedBones = new Set();
    for (const side of ['Left', 'Right']) {
      const legIK = ik?.legs?.[side];
      if (legIK && legIK.mode === 'knee_direct' && legIK.kneePos) {
        if (legIK.pin) {
          pinnedBones.add(side + 'Leg');
          pinnedBones.add(side + 'Foot');
          pinnedBones.add(side + 'ToeBase');
        }
        const hipPos = this.worldPos(side + 'UpLeg', this._v1);
        const dir1 = this._v2.subVectors(legIK.kneePos, hipPos);
        if (dir1.lengthSq() > 1e-6) {
          this._setBoneWorld(side + 'UpLeg', dir1, legIK.kneeSec || Y);
        }
        const dir2 = this._v3.copy(legIK.ankleDir || Z);
        if (dir2.lengthSq() > 1e-6) {
          this._setBoneWorld(side + 'Leg', dir2, legIK.shinSec || legIK.kneeSec || Y);
        }
        if (this.limbMap[side + 'Foot']) {
          const fDir = legIK.footDir ? this._v4.copy(legIK.footDir) : this._v4.copy(dir2);
          this._setBoneWorld(side + 'Foot', fDir, legIK.footUp || Y);
          if (this.limbMap[side + 'ToeBase']) {
            this._setBoneWorld(side + 'ToeBase', fDir, legIK.footUp || Y);
          }
        }
      } else if (legIK && legIK.target) {
        if (legIK.pin) {
          pinnedBones.add(side + 'Foot');
          pinnedBones.add(side + 'ToeBase');
        }
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

        // Προσανατολισμός πέλματος με διόρθωση rest-pose κλίσης σόλας
        if (this.limbMap[side + 'Foot']) {
          if (legIK.mode === 'flat' && legIK.footDir) {
            const flatDir = this._v4.copy(legIK.footDir).setY(0).normalize();
            flatDir.y = this.dims.footRestSlope;
            this._setBoneWorld(side + 'Foot', flatDir, Y);
            if (this.limbMap[side + 'ToeBase']) {
              const toeDir = this._v5.copy(legIK.footDir).setY(0).normalize();
              toeDir.y = this.dims.toeRestSlope;
              this._setBoneWorld(side + 'ToeBase', toeDir, Y);
            }
          } else if (legIK.mode === 'toe' && legIK.toePos) {
            const anklePos = this.worldPos(side + 'Foot', this._v2);
            const fDir = this._v3.subVectors(legIK.toePos, anklePos);
            if (fDir.lengthSq() > 1e-5) {
              this._setBoneWorld(side + 'Foot', fDir, legIK.footUp || Y);
            }
            if (this.limbMap[side + 'ToeBase'] && legIK.footDir) {
              const toeDir = this._v5.copy(legIK.footDir).setY(0).normalize();
              toeDir.y = this.dims.toeRestSlope;
              this._setBoneWorld(side + 'ToeBase', toeDir, Y);
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

    // 5. Χέρια: Αναλυτικό 2-Bone IK + βραχιόνια/αντιβραχιόνια στροφή + επαφή παλάμης
    for (const side of ['Left', 'Right']) {
      const armIK = ik?.arms?.[side];
      if (armIK && armIK.target) {
        if (armIK.pinFloor) {
          pinnedBones.add(side + 'Hand');
          pinnedBones.add(side + 'ForeArm');
        }
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

        // Κατανομή αξονικής στροφής: βραχιόνια συμμετοχή + πρηνισμός/υπτιασμός αντιβραχίου
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

    // 6. Ρεαλιστική άρθρωση δαχτύλων ανά χέρι (υποστηρίζει ανεξάρτητο προφίλ Left/Right, π.χ. side plank, one-arm row)
    const kf = 1 - Math.exp(-dt * 12);
    for (const s of ['Left', 'Right']) {
      this.gripCur[s] += (this.grip[s] - this.gripCur[s]) * kf;
      const armOverride = ik?.arms?.[s]?.gripStyle;
      const effStyle = (armOverride && GRIP_PROFILES[armOverride]) ? armOverride : this.gripStyle[s];
      const targetProf = GRIP_PROFILES[effStyle] || GRIP_PROFILES.relaxed;
      const curProf = this.gripProfCur[s];
      for (let j = 0; j < 5; j++) curProf[j] += (targetProf[j] - curProf[j]) * kf;
    }
    for (let i = 0; i < this.fingers.length; i++) {
      const f = this.fingers[i];
      const prof = this.gripProfCur[f.side];
      // Τα προφίλ περιέχουν ήδη τις ακριβείς ανατομικές γωνίες σε rad (χωρίς διπλή εξασθένηση!)
      if (f.thumb) {
        const curl = prof[3] * (f.k === 1 ? 0.78 : 1.0);
        const opp = f.k === 1 ? prof[4] : 0;
        f.bone.quaternion.copy(f.local).multiply(this._q1.setFromAxisAngle(f.ax, curl));
        if (opp) f.bone.quaternion.multiply(this._q2.setFromAxisAngle(f.oppAx, opp));
      } else {
        const curl = prof[f.k - 1] * f.cascade;
        f.bone.quaternion.copy(f.local).multiply(this._q1.setFromAxisAngle(f.ax, curl));
      }
    }

    this.root.updateMatrixWorld(true);

    // 7. Επαφή με το έδαφος χωρίς κατακόρυφες ταλαντώσεις:
    // - Σε IK-locked mode, ελέγχουμε τα μη-καρφωμένα οστά ώστε πύελος/πλάτη/γόνατα/κεφάλι
    //   να μην βυθίζονται ποτέ κάτω από το y = 0. Χρησιμοποιούμε την αλγεβρικά σταθερή σχέση
    //   want = max(0, offY - minY) (= max(0, -rawMinY)) που έχει σταθερό σημείο χωρίς jitter!
    const contacts = [
      ['LeftToeBase', this.dims.toeHeight], ['RightToeBase', this.dims.toeHeight],
      ['LeftFoot', this.dims.footHeight * 0.92], ['RightFoot', this.dims.footHeight * 0.92],
      ['LeftHand', 0.022], ['RightHand', 0.022],
      ['LeftLeg', 0.055], ['RightLeg', 0.055],
      ['Hips', 0.11], ['Spine2', 0.12], ['Head', 0.11],
      ['LeftForeArm', 0.042], ['RightForeArm', 0.042],
    ];
    let minY = Infinity;
    for (let i = 0; i < contacts.length; i++) {
      const [n, r] = contacts[i];
      if (!this.b[n]) continue;
      if (groundLock === 'ik' && pinnedBones.has(n)) continue;
      const y = this.worldPos(n, this._v2).y - r;
      if (y < minY) minY = y;
    }

    if (groundLock === 'air') {
      // Αιώρηση / μονόζυγο / φάση πτήσης άλματος: καμία έλξη προς το έδαφος
      this.offY += (0 - this.offY) * (1 - Math.exp(-dt * 18));
    } else if (groundLock === 'ik') {
      const want = Number.isFinite(minY) ? Math.max(0, this.offY - minY) : 0;
      this.offY += (want - this.offY) * (1 - Math.exp(-dt * 14));
    } else if (Number.isFinite(minY)) {
      const want = this.offY - minY + air;
      this.offY += (want - this.offY) * (1 - Math.exp(-dt * 18));
    }

    if (!opts.skipHair) this.hair?.update(dt);
    return resolvedMeta;
  }
}


```

## js/equipment.js

```javascript
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
      if (h.matRotY) o.mat.quaternion.multiply(_tmpQ2.setFromAxisAngle(_tmpU, h.matRotY));
      o.mat.position.set(h.matX || 0, 0, h.matZ || 0).applyQuaternion(yawQ).setY(0.004);
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

```

## js/hair.js

```javascript
// Σύστημα κόμμωσης για τον ρεαλιστικό 3D coach (Mixamo Michelle & συμβατά μοντέλα):
// 1. Απομόνωση & αφαίρεση αρχικής κόμμωσης (τοπολογικά κελύφη + βάρη οστού Head + έλεγχος περιβλήματος)
//    χωρίς καμία επέμβαση σε πρόσωπο, αυτιά, ακουστικά, γυαλιά ή λαιμό.
// 2. Διαδικαστικές υφές τριχών (CanvasTexture: ανισότροπες ανταύγειες, bump ινών, alpha-tested άκρες)
//    και MeshPhysicalMaterial με sheen.
// 3. Τέσσερις νέες κομμώσεις ('ponytail' | 'bun' | 'braid' | 'short') προσαρτημένες στο οστό Head,
//    με δυναμική αλυσίδα ελατηρίων 3 τμημάτων για φυσική δευτερεύουσα κίνηση.
import * as THREE from './vendor/three.module.min.js';
import { clamp } from './ik.js';

export const HAIR_STYLES = ['original', 'ponytail', 'bun', 'braid', 'short'];

const _V1 = new THREE.Vector3();
const _V2 = new THREE.Vector3();
const _V3 = new THREE.Vector3();
const _Q1 = new THREE.Quaternion();
const _UP = new THREE.Vector3(0, 1, 0);

/**
 * Δημιουργεί διαδικαστικές υφές τριχών (albedo, bump, alpha) σε CanvasTexture.
 * - map: βαθύ καστανό/εσπρέσο (ταιριαστό με τους τόνους της Michelle) με λεπτές ίνες και ανισότροπη ανταύγεια.
 * - bumpMap: κατακόρυφες αυλακώσεις τριχών για κατοπτρική υφή.
 * - alphaMap: συμπαγής ρίζα με φτερωτές άκρες (alphaTest) για ρεαλιστικές τούφες (hair cards).
 */
function createHairTextures() {
  const W = 512, H = 512;

  const cCol = document.createElement('canvas');
  cCol.width = W; cCol.height = H;
  const gCol = cCol.getContext('2d');
  const baseGrad = gCol.createLinearGradient(0, 0, 0, H);
  baseGrad.addColorStop(0.00, '#1e1410');
  baseGrad.addColorStop(0.28, '#2d1e18');
  baseGrad.addColorStop(0.62, '#3a271f');
  baseGrad.addColorStop(1.00, '#281a14');
  gCol.fillStyle = baseGrad;
  gCol.fillRect(0, 0, W, H);

  let seed = 1337;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let i = 0; i < 680; i++) {
    const x = rnd() * W;
    const w = 0.8 + rnd() * 2.2;
    const tone = rnd();
    const r = Math.round(32 + tone * 52);
    const g = Math.round(21 + tone * 35);
    const b = Math.round(16 + tone * 26);
    const a = 0.24 + rnd() * 0.44;
    gCol.strokeStyle = `rgba(${r},${g},${b},${a})`;
    gCol.lineWidth = w;
    const sway = (rnd() - 0.5) * 12;
    gCol.beginPath();
    gCol.moveTo(x, 0);
    gCol.bezierCurveTo(x + sway, H * 0.35, x - sway * 0.7, H * 0.72, x + sway * 0.35, H);
    gCol.stroke();
  }

  // Ανισότροπες ζώνες ανταύγειας (primary & secondary sheen band)
  const sheen1 = gCol.createLinearGradient(0, H * 0.16, 0, H * 0.46);
  sheen1.addColorStop(0.0, 'rgba(155, 112, 86, 0.0)');
  sheen1.addColorStop(0.45, 'rgba(165, 118, 90, 0.26)');
  sheen1.addColorStop(0.55, 'rgba(182, 132, 102, 0.20)');
  sheen1.addColorStop(1.0, 'rgba(155, 112, 86, 0.0)');
  gCol.fillStyle = sheen1;
  gCol.fillRect(0, H * 0.16, W, H * 0.30);

  const sheen2 = gCol.createLinearGradient(0, H * 0.56, 0, H * 0.82);
  sheen2.addColorStop(0.0, 'rgba(130, 92, 68, 0.0)');
  sheen2.addColorStop(0.5, 'rgba(142, 100, 75, 0.15)');
  sheen2.addColorStop(1.0, 'rgba(130, 92, 68, 0.0)');
  gCol.fillStyle = sheen2;
  gCol.fillRect(0, H * 0.56, W, H * 0.26);

  // Bump map (λεπτές αυλακώσεις τριχών)
  const cBump = document.createElement('canvas');
  cBump.width = W; cBump.height = H;
  const gBump = cBump.getContext('2d');
  gBump.fillStyle = '#808080';
  gBump.fillRect(0, 0, W, H);
  for (let i = 0; i < 720; i++) {
    const x = rnd() * W;
    const v = Math.round(52 + rnd() * 150);
    gBump.strokeStyle = `rgba(${v},${v},${v},0.48)`;
    gBump.lineWidth = 0.8 + rnd() * 1.6;
    const sway = (rnd() - 0.5) * 9;
    gBump.beginPath();
    gBump.moveTo(x, 0);
    gBump.bezierCurveTo(x + sway, H * 0.35, x - sway * 0.6, H * 0.72, x + sway * 0.25, H);
    gBump.stroke();
  }

  // Alpha map για hair cards (συμπαγής ρίζα → φτερωτές μυτερές άκρες)
  const cAlpha = document.createElement('canvas');
  cAlpha.width = W; cAlpha.height = H;
  const gAlpha = cAlpha.getContext('2d');
  gAlpha.fillStyle = '#000';
  gAlpha.fillRect(0, 0, W, H);

  for (let i = 0; i < 52; i++) {
    const u = (i + 0.5) / 52;
    const x0 = W * (0.10 + u * 0.80);
    const centerBias = 1 - Math.abs(u - 0.5) * 2;
    const tipY = H * (0.58 + centerBias * 0.40 + (rnd() - 0.5) * 0.10);
    const widthTop = 12 + rnd() * 14;
    const grad = gAlpha.createLinearGradient(x0, 0, x0, tipY);
    grad.addColorStop(0.0, 'rgba(255,255,255,0.99)');
    grad.addColorStop(0.68, 'rgba(255,255,255,0.96)');
    grad.addColorStop(0.90, 'rgba(220,220,220,0.65)');
    grad.addColorStop(1.0, 'rgba(0,0,0,0.0)');
    gAlpha.fillStyle = grad;
    gAlpha.beginPath();
    gAlpha.moveTo(x0 - widthTop * 0.5, 0);
    gAlpha.lineTo(x0 + widthTop * 0.5, 0);
    gAlpha.quadraticCurveTo(x0 + widthTop * 0.35, tipY * 0.65, x0 + (rnd() - 0.5) * 6, tipY);
    gAlpha.quadraticCurveTo(x0 - widthTop * 0.35, tipY * 0.65, x0 - widthTop * 0.5, 0);
    gAlpha.closePath();
    gAlpha.fill();
  }

  const map = new THREE.CanvasTexture(cCol);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.anisotropy = 4;

  const bumpMap = new THREE.CanvasTexture(cBump);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.ClampToEdgeWrapping;
  bumpMap.anisotropy = 4;

  const alphaMap = new THREE.CanvasTexture(cAlpha);
  alphaMap.wrapS = THREE.ClampToEdgeWrapping;
  alphaMap.wrapT = THREE.ClampToEdgeWrapping;

  return { map, bumpMap, alphaMap };
}

/**
 * Αναλύει το φορτωμένο SkinnedMesh (π.χ. Michelle.glb), εντοπίζει τα αποσυνδεδεμένα
 * τοπολογικά κελύφη που είναι δεμένα ≈100% στο οστό Head ΚΑΙ εκτείνονται έξω από
 * το ελλειψοειδές κρανίου/ακουστικών (π.χ. τα μεγάλα σινιόν της Michelle),
 * και κατασκευάζει εναλλακτικό index buffer χωρίς αυτά.
 */
function analyzeAndPrepareHairStrip(root, headBone) {
  let targetMesh = null;
  let headJointIdx = -1;

  root.traverse(o => {
    if (!o.isSkinnedMesh || !o.skeleton || !o.geometry?.index) return;
    const idx = o.skeleton.bones.indexOf(headBone);
    if (idx !== -1 && (!targetMesh || o.geometry.index.count > targetMesh.geometry.index.count)) {
      targetMesh = o;
      headJointIdx = idx;
    }
  });

  if (!targetMesh || headJointIdx === -1) {
    return { supported: false, mesh: null, originalIndex: null, strippedIndex: null, skull: null };
  }

  const geo = targetMesh.geometry;
  const posAttr = geo.attributes.position;
  const siAttr = geo.attributes.skinIndex;
  const swAttr = geo.attributes.skinWeight;
  const indexAttr = geo.index;
  if (!posAttr || !siAttr || !swAttr || !indexAttr) {
    return { supported: false, mesh: null, originalIndex: null, strippedIndex: null, skull: null };
  }

  const vCount = posAttr.count;
  const headW = new Float32Array(vCount);
  for (let i = 0; i < vCount; i++) {
    let w = 0;
    if (siAttr.getX(i) === headJointIdx) w += swAttr.getX(i);
    if (siAttr.getY(i) === headJointIdx) w += swAttr.getY(i);
    if (siAttr.getZ(i) === headJointIdx) w += swAttr.getZ(i);
    if (siAttr.getW(i) === headJointIdx) w += swAttr.getW(i);
    headW[i] = w;
  }

  // Κβάντιση θέσεων κορυφών (~1mm) για εύρεση πραγματικών τοπολογικών κελυφών (ανεξάρτητα από UV seams)
  const posToPid = new Map();
  const vToPid = new Int32Array(vCount);
  let pidCount = 0;
  for (let i = 0; i < vCount; i++) {
    const key = `${Math.round(posAttr.getX(i) * 1000)},${Math.round(posAttr.getY(i) * 1000)},${Math.round(posAttr.getZ(i) * 1000)}`;
    let pid = posToPid.get(key);
    if (pid === undefined) {
      pid = pidCount++;
      posToPid.set(key, pid);
    }
    vToPid[i] = pid;
  }

  // Union-Find σε όλα τα τρίγωνα του mesh
  const parent = new Int32Array(pidCount);
  for (let i = 0; i < pidCount; i++) parent[i] = i;
  const find = x => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) { const nx = parent[x]; parent[x] = r; x = nx; }
    return r;
  };
  const unite = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const idxArr = indexAttr.array;
  const triCount = (idxArr.length / 3) | 0;
  for (let t = 0; t < triCount; t++) {
    const a = vToPid[idxArr[t * 3]];
    const b = vToPid[idxArr[t * 3 + 1]];
    const c = vToPid[idxArr[t * 3 + 2]];
    unite(a, b);
    unite(b, c);
  }

  // Συγκέντρωση στατιστικών ανά κέλυφος σε world space (μέσω getVertexPosition ώστε να λαμβάνεται υπόψη το skinning & η κλίμακα 0.01/90° του Mixamo!)
  root.updateMatrixWorld(true);
  targetMesh.skeleton.update();
  const meshWorld = targetMesh.matrixWorld;
  const headWorldPos = headBone.getWorldPosition(new THREE.Vector3());

  const shells = new Map();
  for (let t = 0; t < triCount; t++) {
    const i0 = idxArr[t * 3], i1 = idxArr[t * 3 + 1], i2 = idxArr[t * 3 + 2];
    const r = find(vToPid[i0]);
    let s = shells.get(r);
    if (!s) {
      s = {
        root: r, tris: 0, vSet: new Set(),
        minX: Infinity, maxX: -Infinity,
        minY: Infinity, maxY: -Infinity,
        minZ: Infinity, maxZ: -Infinity,
        hwMin: 1, hwSum: 0, hwCnt: 0,
      };
      shells.set(r, s);
    }
    s.tris++;
    for (const vi of [i0, i1, i2]) {
      if (s.vSet.has(vi)) continue;
      s.vSet.add(vi);
      targetMesh.getVertexPosition(vi, _V1).applyMatrix4(meshWorld).sub(headWorldPos);
      if (_V1.x < s.minX) s.minX = _V1.x;
      if (_V1.x > s.maxX) s.maxX = _V1.x;
      if (_V1.y < s.minY) s.minY = _V1.y;
      if (_V1.y > s.maxY) s.maxY = _V1.y;
      if (_V1.z < s.minZ) s.minZ = _V1.z;
      if (_V1.z > s.maxZ) s.maxZ = _V1.z;
      const hw = headW[vi];
      if (hw < s.hwMin) s.hwMin = hw;
      s.hwSum += hw;
      s.hwCnt++;
    }
  }

  let bodyShell = null;
  for (const s of shells.values()) {
    if (s.hwMin < 0.05 && s.maxY > 0.10 && (!bodyShell || s.tris > bodyShell.tris)) {
      bodyShell = s;
    }
  }
  if (!bodyShell) {
    return { supported: false, mesh: null, originalIndex: null, strippedIndex: null, skull: null };
  }

  let skMinX = Infinity, skMaxX = -Infinity;
  let skMinY = Infinity, skMaxY = -Infinity;
  let skMinZ = Infinity, skMaxZ = -Infinity;
  for (const vi of bodyShell.vSet) {
    if (headW[vi] <= 0.5) continue;
    targetMesh.getVertexPosition(vi, _V1).applyMatrix4(meshWorld).sub(headWorldPos);
    if (_V1.x < skMinX) skMinX = _V1.x;
    if (_V1.x > skMaxX) skMaxX = _V1.x;
    if (_V1.y < skMinY) skMinY = _V1.y;
    if (_V1.y > skMaxY) skMaxY = _V1.y;
    if (_V1.z < skMinZ) skMinZ = _V1.z;
    if (_V1.z > skMaxZ) skMaxZ = _V1.z;
  }

  const skullHalfW = Math.max(0.075, (skMaxX - skMinX) * 0.5);
  const skullTopY = Math.max(0.18, skMaxY);
  const skullBackZ = Math.min(-0.03, skMinZ);

  const hairShellRoots = new Set();
  for (const s of shells.values()) {
    if (s === bodyShell) continue;
    const hwMean = s.hwSum / Math.max(s.hwCnt, 1);
    if (hwMean < 0.90 || s.hwMin < 0.70) continue;
    if (s.tris < 120) continue;
    const maxAbsX = Math.max(Math.abs(s.minX), Math.abs(s.maxX));
    const extendsWide = maxAbsX > skullHalfW * 1.48;
    const extendsFarBack = s.minZ < skullBackZ - 0.075;
    const extendsHigh = s.maxY > skullTopY + 0.055;
    if ((extendsWide && extendsFarBack) || (extendsFarBack && extendsHigh)) {
      hairShellRoots.add(s.root);
    }
  }

  if (hairShellRoots.size === 0) {
    return { supported: false, mesh: targetMesh, originalIndex: indexAttr, strippedIndex: null, skull: null };
  }

  const kept = [];
  for (let t = 0; t < triCount; t++) {
    const i0 = idxArr[t * 3], i1 = idxArr[t * 3 + 1], i2 = idxArr[t * 3 + 2];
    if (hairShellRoots.has(find(vToPid[i0]))) continue;
    kept.push(i0, i1, i2);
  }
  const ArrType = idxArr.constructor;
  const strippedIndex = new THREE.BufferAttribute(new ArrType(kept), 1);

  return {
    supported: true,
    mesh: targetMesh,
    originalIndex: indexAttr,
    strippedIndex,
    skull: { halfW: skullHalfW, topY: skullTopY, minY: skMinY, frontZ: skMaxZ, backZ: skullBackZ },
  };
}

/**
 * Κατασκευάζει πλήρες, κλειστό γλυπτό κέλυφος μαλλιών (skull cap) που:
 * - Εφάπτεται ακριβώς κάτω από τη στέκα των ακουστικών της Michelle (y_top ≈ 0.219, μηδέν κενό αέρα!)
 * - Καλύπτει φυσικά το άνω μέτωπο (με απαλή κεντρική χωρίστρα) πάνω από τα φρύδια χωρίς να ξεπροβάλλει δέρμα
 * - Κλείνει ΕΝΤΕΛΩΣ το ανοιχτό πίσω μέρος του κρανίου της Michelle από αυτί σε αυτί μέχρι τον αυχένα (y ≈ 0.008),
 *   ώστε να μην φαίνεται ποτέ το εσωτερικό του κεφαλιού από καμία γωνία!
 * - Στο 'short' προσθέτει ομαλό, γλυπτό όγκο πίσω από τη στέκα (χωρίς κενά ή αποκομμένες τούφες).
 */
function buildSkullCap(mat, isShort = false) {
  const segU = 44, segV = 30;
  const geo = new THREE.BufferGeometry();
  const positions = [];
  const uvs = [];
  const indices = [];

  // Ακριβές κέντρο κρανίου Michelle σε μέτρα από το οστό Head (0, 1.3685, -0.0184):
  // Το κέντρο του κεφαλιού της βρίσκεται μπροστά από το οστό Head κατά dz ≈ +0.024!
  const cx = 0;
  const cy = 0.114;
  const cz = 0.024;

  for (let iv = 0; iv <= segV; iv++) {
    const v = iv / segV; // 0 = κορυφή, 1 = περίγραμμα (γραμμή μετώπου / κροτάφοι / αυχένας)
    for (let iu = 0; iu <= segU; iu++) {
      const u = iu / segU;
      const az = u * Math.PI * 2; // 0 = μπροστά (+Z), ±π/2 = πλαϊνά (±X), π = πίσω (-Z)
      const sinA = Math.sin(az);
      const cosA = Math.cos(az);

      // Ομαλή μετάβαση της μέγιστης γωνίας φ από το μέτωπο (φ≈0.98) → κροτάφους (φ≈1.68) → πλήρη κάλυψη πίσω (φ≈2.62)!
      // Χρησιμοποιούμε smoothstep στο cosA ώστε ΟΛΟ το πίσω ημισφαίριο (από αυτί σε αυτί!) να κατεβαίνει ως τον αυχένα!
      const backBlend = clamp((-cosA + 0.18) / 0.72, 0, 1);
      const backSmooth = backBlend * backBlend * (3 - 2 * backBlend);
      const frontMask = Math.max(0, cosA);

      // Απαλή καμπύλη γραμμής μετώπου (ελαφρύς κυματισμός χωρίστρας, πάντα πάνω από τα φρύδια)
      const centerPart = Math.exp(-Math.pow(sinA * 6.5, 2)) * 0.045 * frontMask;
      const templeDip = Math.exp(-Math.pow((Math.abs(sinA) - 0.85) * 4.0, 2)) * 0.16 * (1 - backSmooth);

      const phiFront = 1.00 + templeDip - centerPart;
      const phiBack = isShort ? 2.66 : 2.62;
      const phiMax = phiFront + (phiBack - phiFront) * backSmooth;

      const phi = v * phiMax;
      const sinP = Math.sin(phi);
      const cosP = Math.cos(phi);

      // Ελλειψοειδείς ακτίνες βαθμονομημένες ακριβώς πάνω στη Michelle:
      // - Κορυφή: y = 0.114 + 0.1055 = 0.2195 (εφάπτεται ακριβώς κάτω από τη στέκα των ακουστικών!)
      // - Μέτωπο: z = 0.024 + 0.095 = 0.119 (καλύπτει 100% το μέτωπο χωρίς να ξεπροβάλλει δέρμα!)
      // - Πίσω ινίο: z = 0.024 - 0.114 = -0.090 (ή -0.104 στο short για όγκο κουρέματος)
      let rx = 0.0925;
      let ry = 0.1055;
      let rz = cosA >= 0 ? 0.0955 : (isShort ? 0.124 : 0.110);

      // Για το κοντό αθλητικό κούρεμα: ομαλός γλυπτός όγκος στο πίσω-πάνω τμήμα (πίσω από τη στέκα!)
      if (isShort && cosA < -0.15) {
        const crownVol = Math.sin(clamp(phi / 1.9, 0, 1) * Math.PI) * (-cosA);
        rx += crownVol * 0.010;
        ry += crownVol * 0.008;
      }

      let x = cx + sinP * sinA * rx;
      let y = cy + cosP * ry;
      let z = cz + sinP * cosA * rz;

      // Απαλή σύσφιξη στο κάτω χείλος του αυχένα ώστε να «κλείνει» ερμητικά γύρω από τον λαιμό!
      if (backSmooth > 0.2 && v > 0.72) {
        const t = (v - 0.72) / 0.28;
        const neckPull = t * t * backSmooth;
        x *= 1 - neckPull * 0.42;
        z = z * (1 - neckPull * 0.46) + (-0.022) * (neckPull * 0.46);
      }

      // Εφαρμογή ακριβώς κάτω από τη στέκα & τα καλύμματα ακουστικών (χωρίς να τρυπάει ούτε να μένει κενό!)
      const inBandZ = Math.exp(-Math.pow((z - 0.010) / 0.026, 2));
      const overTop = clamp((y - 0.165) / 0.055, 0, 1);
      y = Math.min(y, 0.219 - inBandZ * overTop * 0.004);
      if (Math.abs(x) > 0.088 && y > 0.030 && y < 0.175 && z > -0.036 && z < 0.068) {
        x = Math.sign(x) * (0.088 + (Math.abs(x) - 0.088) * 0.25);
      }

      // Λεπτή κυματιστή υφή τριχών + απαλή γραμμή χωρίστρας στην κορυφή
      const partGroove = Math.exp(-Math.pow(x / 0.009, 2)) * clamp((y - 0.175) / 0.04, 0, 1) * 0.003;
      const ripple = Math.sin(az * 18 + v * 2.5) * 0.0012 * sinP;
      x += sinA * ripple;
      y -= partGroove;
      z += cosA * ripple;

      positions.push(x, y, z);
      uvs.push(u * 4.0, v);
    }
  }

  const stride = segU + 1;
  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * stride + iu;
      const b = a + stride;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Καμπύλη τούφα-κάρτα (hair card) κατά μήκος 3D Spline με κυρτή διατομή
 * και UV κατάλληλο για alpha-tested φτερωτές άκρες.
 */
function buildHairCardGeometry(points, widthRoot, widthTip, segLen = 10, arch = 0.007) {
  const curve = new THREE.CatmullRomCurve3(points);
  const segW = 3;
  const positions = [];
  const uvs = [];
  const indices = [];
  const p = new THREE.Vector3();
  const tang = new THREE.Vector3();
  const side = new THREE.Vector3();
  const nrm = new THREE.Vector3();

  for (let i = 0; i <= segLen; i++) {
    const v = i / segLen;
    curve.getPoint(v, p);
    curve.getTangent(v, tang).normalize();
    const ref = Math.abs(tang.y) < 0.92 ? _UP : new THREE.Vector3(0, 0, 1);
    side.crossVectors(tang, ref).normalize();
    nrm.crossVectors(side, tang).normalize();
    const w = widthRoot + (widthTip - widthRoot) * Math.pow(v, 0.78);

    for (let j = 0; j <= segW; j++) {
      const u = j / segW;
      const s = (u - 0.5) * 2;
      const cOff = (1 - s * s) * arch;
      positions.push(
        p.x + side.x * s * w * 0.5 + nrm.x * cOff,
        p.y + side.y * s * w * 0.5 + nrm.y * cOff,
        p.z + side.z * s * w * 0.5 + nrm.z * cOff
      );
      uvs.push(u, v);
    }
  }

  const stride = segW + 1;
  for (let i = 0; i < segLen; i++) {
    for (let j = 0; j < segW; j++) {
      const a = i * stride + j;
      const b = a + stride;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Απαλές πρόσθιες τούφες πλαισίωσης μετώπου (εφαρμόζουν σφιχτά πάνω στο κέλυφος χωρίς να προεξέχουν) */
function addFrontSweepCards(group, cardMat, isShort = false) {
  const specs = isShort
    ? [
        // Φτερωτή πλαϊνή φράντζα σφιχτά εφαρμοσμένη στο μέτωπο (χωρίς προεξοχή σε πλάγια όψη)
        { pts: [[0.014, 0.204, 0.048], [-0.016, 0.188, 0.092], [-0.052, 0.168, 0.092], [-0.074, 0.144, 0.070]], w0: 0.038, w1: 0.022 },
        { pts: [[0.008, 0.202, 0.056], [-0.018, 0.184, 0.098], [-0.046, 0.164, 0.096]], w0: 0.032, w1: 0.018 },
        { pts: [[0.018, 0.204, 0.048], [0.046, 0.186, 0.088], [0.068, 0.160, 0.082], [0.078, 0.136, 0.062]], w0: 0.036, w1: 0.020 },
      ]
    : [
        // Μαζεμένες τούφες μετώπου σφιχτά εφαρμοσμένες πάνω στο κρανίο
        { pts: [[0.006, 0.204, 0.052], [-0.024, 0.192, 0.092], [-0.058, 0.175, 0.084], [-0.076, 0.154, 0.050]], w0: 0.034, w1: 0.018 },
        { pts: [[-0.006, 0.204, 0.052], [0.024, 0.192, 0.092], [0.058, 0.175, 0.084], [0.076, 0.154, 0.050]], w0: 0.034, w1: 0.018 },
      ];

  for (const sp of specs) {
    const geo = buildHairCardGeometry(sp.pts.map(p => new THREE.Vector3(...p)), sp.w0, sp.w1, 8, 0.003);
    const m = new THREE.Mesh(geo, cardMat);
    m.castShadow = true;
    group.add(m);
  }
}

/** Λαστιχάκι μαλλιών (αθλητικό ματ υφασμάτινο) */
function buildHairTie(color = 0x0f766e, r = 0.025, tube = 0.008) {
  const m = new THREE.Mesh(
    new THREE.TorusGeometry(r, tube, 10, 22),
    new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.04 })
  );
  m.castShadow = true;
  return m;
}

/** Ομαλός γλυπτός όγκος εκ περιστροφής (LatheGeometry) για πλούσια συνεκτική αλογοουρά */
function buildTaperedVolume(stations, mat, seg = 18) {
  const pts = new THREE.SplineCurve(stations.map(([y, r]) => new THREE.Vector2(r, y))).getPoints(16);
  const g = new THREE.LatheGeometry(pts, seg);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Κατασκευάζει την επιλεγμένη κόμμωση στο σύστημα συντεταγμένων του `hairMount` (μέτρα από Head bone).
 * Επιστρέφει `{ group, chain }` όπου `chain` είναι προαιρετική αλυσίδα 3 τμημάτων για spring physics.
 */
function buildHairStyle(style, solidMat, cardMat) {
  const group = new THREE.Group();
  group.name = `hair_${style}`;
  let chain = null;

  if (style === 'ponytail') {
    group.add(buildSkullCap(solidMat, false));
    addFrontSweepCards(group, cardMat, false);

    // Λαστιχάκι στο υψηλό ινίο (πίσω από τη στέκα και τα ακουστικά!)
    const rootPos = new THREE.Vector3(0, 0.152, -0.082);
    const tie = buildHairTie(0x0f766e, 0.025, 0.0085);
    tie.position.copy(rootPos);
    tie.rotation.x = 0.45;
    group.add(tie);

    // Αλυσίδα ελατηρίων 3 τμημάτων (seg0 → seg1 → seg2)
    const seg0 = new THREE.Group();
    seg0.position.copy(rootPos);
    group.add(seg0);

    const seg1 = new THREE.Group();
    seg1.position.set(0, -0.082, -0.034);
    seg0.add(seg1);

    const seg2 = new THREE.Group();
    seg2.position.set(0, -0.095, -0.014);
    seg1.add(seg2);

    // Πλούσιος συνεκτικός όγκος ανά τμήμα (LatheGeometry με ομαλή συνέχεια χωρίς «σκαλοπάτι» μεταξύ seg0/seg1/seg2)
    const v0 = buildTaperedVolume([[-0.100, 0.033], [-0.050, 0.036], [-0.012, 0.024], [0.012, 0.018]], solidMat, 18);
    v0.position.set(0, 0.004, -0.002);
    v0.rotation.x = -0.36;
    seg0.add(v0);

    const v1 = buildTaperedVolume([[-0.108, 0.024], [-0.052, 0.031], [0.014, 0.032]], solidMat, 16);
    v1.rotation.x = -0.14;
    seg1.add(v1);

    const v2 = buildTaperedVolume([[-0.124, 0.003], [-0.072, 0.014], [-0.020, 0.022], [0.012, 0.023]], solidMat, 14);
    v2.rotation.x = -0.04;
    seg2.add(v2);

    const addWrapCards = (parent, count, len, rStart, rMid, rEnd, w0, w1, tiltX) => {
      const holder = new THREE.Group();
      holder.rotation.x = tiltX;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + 0.25;
        const ca = Math.cos(a), sa = Math.sin(a);
        const pts = [
          new THREE.Vector3(sa * rStart, 0.010, ca * rStart * 0.94),
          new THREE.Vector3(sa * rMid, -len * 0.48, ca * rMid * 0.94),
          new THREE.Vector3(sa * rEnd, -len, ca * rEnd * 0.94),
        ];
        const card = new THREE.Mesh(buildHairCardGeometry(pts, w0, w1, 8, 0.004), cardMat);
        card.castShadow = true;
        holder.add(card);
      }
      parent.add(holder);
    };
    addWrapCards(seg0, 7, 0.112, 0.019, 0.037, 0.033, 0.044, 0.030, -0.36);
    addWrapCards(seg1, 7, 0.118, 0.031, 0.032, 0.024, 0.040, 0.026, -0.14);
    addWrapCards(seg2, 6, 0.128, 0.022, 0.017, 0.005, 0.032, 0.014, -0.04);

    chain = {
      segs: [seg0, seg1, seg2],
      restX: [0.05, 0.04, 0.02],
      ax: [0.05, 0.04, 0.02],
      az: [0, 0, 0],
      vx: [0, 0, 0],
      vz: [0, 0, 0],
      minX: [-0.85, -0.7, -0.6],
      maxX: [1.15, 0.95, 0.85],
      stiff: [62, 52, 44],
      damp: [9.5, 8.5, 7.5],
      gravGain: [0.55, 0.42, 0.34],
    };
  } else if (style === 'bun') {
    group.add(buildSkullCap(solidMat, false));
    addFrontSweepCards(group, cardMat, false);

    // Υψηλός αθλητικός κότσος στο πίσω-πάνω τμήμα (καθαρά πίσω από τη στέκα των ακουστικών!)
    const bunCenter = new THREE.Vector3(0, 0.184, -0.074);
    const bunG = new THREE.Group();
    bunG.position.copy(bunCenter);
    bunG.rotation.x = -0.38;
    group.add(bunG);

    const tie = buildHairTie(0x0f766e, 0.037, 0.0085);
    tie.rotation.x = Math.PI / 2;
    tie.position.set(0, -0.016, 0.006);
    bunG.add(tie);

    const core = new THREE.Mesh(new THREE.SphereGeometry(0.050, 22, 16), solidMat);
    core.scale.set(1.06, 0.88, 0.96);
    core.position.set(0, 0.018, -0.014);
    core.castShadow = true;
    bunG.add(core);

    const coil1 = new THREE.Mesh(new THREE.TorusGeometry(0.037, 0.018, 12, 26), solidMat);
    coil1.rotation.set(Math.PI / 2 - 0.14, 0.12, 0);
    coil1.position.set(0, 0.006, -0.010);
    coil1.castShadow = true;
    bunG.add(coil1);

    const coil2 = new THREE.Mesh(new THREE.TorusGeometry(0.027, 0.015, 10, 22), solidMat);
    coil2.rotation.set(Math.PI / 2 + 0.16, -0.18, 0);
    coil2.position.set(0, 0.035, -0.018);
    coil2.castShadow = true;
    bunG.add(coil2);

    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * Math.PI * 2;
      const a1 = a0 + 1.15;
      const pts = [
        new THREE.Vector3(Math.sin(a0) * 0.052, 0.002, -0.014 + Math.cos(a0) * 0.048),
        new THREE.Vector3(Math.sin((a0 + a1) * 0.5) * 0.056, 0.022, -0.016 + Math.cos((a0 + a1) * 0.5) * 0.052),
        new THREE.Vector3(Math.sin(a1) * 0.044, 0.043, -0.018 + Math.cos(a1) * 0.040),
      ];
      const c = new THREE.Mesh(buildHairCardGeometry(pts, 0.030, 0.018, 8, 0.005), cardMat);
      c.castShadow = true;
      bunG.add(c);
    }
  } else if (style === 'braid') {
    group.add(buildSkullCap(solidMat, false));
    addFrontSweepCards(group, cardMat, false);

    // Βάση πλεξούδας στο κέντρο του ινίου (x=0)
    const rootPos = new THREE.Vector3(0, 0.105, -0.088);
    const tieTop = buildHairTie(0x0f766e, 0.022, 0.0075);
    tieTop.position.copy(rootPos);
    tieTop.rotation.x = 0.28;
    group.add(tieTop);

    const seg0 = new THREE.Group();
    seg0.position.copy(rootPos);
    group.add(seg0);

    const seg1 = new THREE.Group();
    seg1.position.set(0, -0.105, -0.014);
    seg0.add(seg1);

    const seg2 = new THREE.Group();
    seg2.position.set(0, -0.102, -0.006);
    seg1.add(seg2);

    const addBraidLobes = (parent, count, yStart, stepY, rBase, rEnd) => {
      for (let i = 0; i < count; i++) {
        const t = i / Math.max(count - 1, 1);
        const r = rBase + (rEnd - rBase) * t;
        const y = yStart - i * stepY;
        for (const side of [-1, 1]) {
          const lobe = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), solidMat);
          lobe.scale.set(0.95, 1.38, 0.85);
          lobe.position.set(side * r * 0.56, y - (side > 0 ? stepY * 0.32 : 0), -0.004);
          lobe.rotation.z = side * 0.48;
          lobe.rotation.x = 0.14;
          lobe.castShadow = true;
          parent.add(lobe);
        }
      }
    };

    addBraidLobes(seg0, 4, -0.012, 0.026, 0.021, 0.018);
    addBraidLobes(seg1, 4, -0.008, 0.025, 0.0175, 0.014);
    addBraidLobes(seg2, 3, -0.006, 0.022, 0.0135, 0.010);

    const tieBot = buildHairTie(0x0f766e, 0.012, 0.0045);
    tieBot.position.set(0, -0.070, -0.004);
    tieBot.rotation.x = Math.PI / 2;
    seg2.add(tieBot);

    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const pts = [
        new THREE.Vector3(Math.sin(a) * 0.008, -0.072, -0.004 + Math.cos(a) * 0.007),
        new THREE.Vector3(Math.sin(a) * 0.015, -0.108, -0.005 + Math.cos(a) * 0.013),
        new THREE.Vector3(Math.sin(a) * 0.007, -0.145, -0.005 + Math.cos(a) * 0.007),
      ];
      const tuft = new THREE.Mesh(buildHairCardGeometry(pts, 0.020, 0.009, 6, 0.004), cardMat);
      tuft.castShadow = true;
      seg2.add(tuft);
    }

    chain = {
      segs: [seg0, seg1, seg2],
      restX: [0.05, 0.03, 0.02],
      ax: [0.05, 0.03, 0.02],
      az: [0, 0, 0],
      vx: [0, 0, 0],
      vz: [0, 0, 0],
      minX: [-0.8, -0.65, -0.55],
      maxX: [1.05, 0.85, 0.75],
      stiff: [74, 62, 52],
      damp: [10.5, 9.2, 8.2],
      gravGain: [0.50, 0.38, 0.30],
    };
  } else if (style === 'short') {
    // Κοντό αθλητικό φιλαριστό κούρεμα (sleek layered athletic pixie-bob):
    // Συνεκτικό γλυπτό κέλυφος με ήπιο πίσω όγκο + σφιχτά εφαρμοσμένες φτερωτές στρώσεις (μηδέν προεξέχουσες τούφες!)
    group.add(buildSkullCap(solidMat, true));
    addFrontSweepCards(group, cardMat, true);

    // Σφιχτές επικαλυπτόμενες στρώσεις που αγκαλιάζουν την καμπύλη του αυχένα (ακριβώς πάνω στο κέλυφος!)
    const napeStrands = 7;
    for (let i = 0; i < napeStrands; i++) {
      const u = (i / (napeStrands - 1)) * 2 - 1; // -1..+1
      const ang = Math.PI + u * 0.82;
      const sx = Math.sin(ang), czDir = Math.cos(ang);
      const pts = [
        new THREE.Vector3(sx * 0.088, 0.145, 0.024 + czDir * 0.118),
        new THREE.Vector3(sx * 0.086, 0.085, 0.024 + czDir * 0.114),
        new THREE.Vector3(sx * 0.068, 0.022, 0.024 + czDir * 0.080),
      ];
      const card = new THREE.Mesh(buildHairCardGeometry(pts, 0.044, 0.028, 8, 0.005), cardMat);
      card.castShadow = true;
      group.add(card);
    }
  }

  return { group, chain };
}

/**
 * Διαχειριστής κόμμωσης για SkinnedCoach:
 * - Εναλλαγή μεταξύ 'original' | 'ponytail' | 'bun' | 'braid' | 'short'.
 * - Φυσική 3-τμημάτων ελατηρίων σε world space (αντίδραση σε βαρύτητα & επιτάχυνση κεφαλιού).
 */
export class HairController {
  constructor(root, headBone, quality = 'high', initialStyle = 'original') {
    this.root = root;
    this.headBone = headBone;
    this.quality = quality;
    this.style = 'original';

    this.strip = analyzeAndPrepareHairStrip(root, headBone);
    this.supported = this.strip.supported;

    root.updateMatrixWorld(true);
    const headPos = headBone.getWorldPosition(new THREE.Vector3());
    const mountLocal = headBone.matrixWorld.clone().invert().multiply(
      new THREE.Matrix4().makeTranslation(headPos.x, headPos.y, headPos.z)
    );
    this.mount = new THREE.Group();
    this.mount.name = 'coach_hair_mount';
    mountLocal.decompose(this.mount.position, this.mount.quaternion, this.mount.scale);
    headBone.add(this.mount);

    this.textures = null;
    this.solidMat = null;
    this.cardMat = null;
    this.activeGroup = null;
    this.chain = null;

    this.prevPos = new THREE.Vector3();
    this.prevVel = new THREE.Vector3();
    this.hasPrev = false;

    this.setStyle(initialStyle);
  }

  _ensureMaterials() {
    if (this.solidMat) return;
    this.textures = createHairTextures();
    const { map, bumpMap, alphaMap } = this.textures;

    if (this.quality === 'high') {
      this.solidMat = new THREE.MeshPhysicalMaterial({
        color: 0xc9a38a, // ζεστός τόνος: χωρίς αυτόν οι λευκές αντανακλάσεις του στούντιο έκαναν τα μαλλιά σταχτιά
        map,
        bumpMap,
        bumpScale: 0.0045,
        side: THREE.DoubleSide,
        roughness: 0.74,
        metalness: 0.04,
        sheen: 0.72,
        sheenColor: new THREE.Color(0x98684e),
        sheenRoughness: 0.36,
        clearcoat: 0.16,
        clearcoatRoughness: 0.38,
        envMapIntensity: 0.32, specularIntensity: 0.45,
      });
      this.cardMat = new THREE.MeshPhysicalMaterial({
        color: 0xc9a38a, // ζεστός τόνος: χωρίς αυτόν οι λευκές αντανακλάσεις του στούντιο έκαναν τα μαλλιά σταχτιά
        map,
        bumpMap,
        bumpScale: 0.0035,
        alphaMap,
        alphaTest: 0.40,
        side: THREE.DoubleSide,
        roughness: 0.76,
        metalness: 0.04,
        sheen: 0.75,
        sheenColor: new THREE.Color(0x9e6c52),
        sheenRoughness: 0.38,
        clearcoat: 0.14,
        clearcoatRoughness: 0.40,
        envMapIntensity: 0.32, specularIntensity: 0.45,
      });
    } else {
      this.solidMat = new THREE.MeshStandardMaterial({
        color: 0xc9a38a, // ζεστός τόνος: χωρίς αυτόν οι λευκές αντανακλάσεις του στούντιο έκαναν τα μαλλιά σταχτιά
        map,
        bumpMap,
        bumpScale: 0.0035,
        side: THREE.DoubleSide,
        roughness: 0.78,
        metalness: 0.05,
        envMapIntensity: 0.32,
      });
      this.cardMat = new THREE.MeshStandardMaterial({
        color: 0xc9a38a, // ζεστός τόνος: χωρίς αυτόν οι λευκές αντανακλάσεις του στούντιο έκαναν τα μαλλιά σταχτιά
        map,
        alphaMap,
        alphaTest: 0.42,
        side: THREE.DoubleSide,
        roughness: 0.8,
        metalness: 0.05,
        envMapIntensity: 0.32,
      });
    }
  }

  _clearActive() {
    if (!this.activeGroup) return;
    this.activeGroup.traverse(o => {
      if (o.isMesh) {
        o.geometry?.dispose();
        if (o.material && o.material !== this.solidMat && o.material !== this.cardMat) {
          o.material.dispose();
        }
      }
    });
    this.mount.remove(this.activeGroup);
    this.activeGroup = null;
    this.chain = null;
  }

  setStyle(style) {
    const want = HAIR_STYLES.includes(style) ? style : 'original';
    if (!this.supported && want !== 'original') {
      console.warn('Δεν ήταν δυνατή η καθαρή απομόνωση κόμμωσης στο μοντέλο· διατηρείται η αρχική.');
      this.style = 'original';
      return;
    }
    this._clearActive();
    this.style = want;

    if (this.strip.mesh) {
      this.strip.mesh.geometry.setIndex(
        want === 'original' ? this.strip.originalIndex : this.strip.strippedIndex
      );
    }

    if (want !== 'original') {
      this._ensureMaterials();
      const built = buildHairStyle(want, this.solidMat, this.cardMat);
      this.activeGroup = built.group;
      this.chain = built.chain;
      this.mount.add(this.activeGroup);
      this.hasPrev = false;
    }
  }

  resetPhysics() {
    this.hasPrev = false;
    if (!this.chain) return;
    for (let i = 0; i < this.chain.segs.length; i++) {
      this.chain.ax[i] = this.chain.restX[i];
      this.chain.az[i] = 0;
      this.chain.vx[i] = 0;
      this.chain.vz[i] = 0;
      this.chain.segs[i].rotation.set(this.chain.ax[i], 0, 0);
    }
  }

  /**
   * Δευτερεύουσα κίνηση αλυσίδας ελατηρίων (ponytail / braid):
   * Προβάλλει τη βαρύτητα και την επιτάχυνση του κεφαλιού στο τοπικό σύστημα του hairMount,
   * ώστε η αλογοουρά/πλεξούδα να κρέμεται φυσικά σε κλίσεις και να ταλαντώνεται ομαλά στα άλματα.
   */
  update(dt) {
    if (!this.chain || dt <= 0) return;
    const c = this.chain;
    const hdt = Math.min(dt, 0.05);

    this.mount.getWorldPosition(_V1);
    this.mount.getWorldQuaternion(_Q1);

    _V3.set(0, 0, 0);
    if (this.hasPrev) {
      _V2.copy(_V1).sub(this.prevPos).multiplyScalar(1 / Math.max(hdt, 1e-3));
      _V3.copy(_V2).sub(this.prevVel).multiplyScalar(1 / Math.max(hdt, 1e-3));
      _V3.clampLength(0, 18);
      this.prevVel.copy(_V2);
    } else {
      this.prevVel.set(0, 0, 0);
      this.hasPrev = true;
    }
    this.prevPos.copy(_V1);

    _V2.set(0, -9.81, 0).sub(_V3);
    const invQ = _Q1.invert();
    _V2.applyQuaternion(invQ).normalize();

    // Όταν το πρόσωπο κοιτάζει το πάτωμα (κάμψεις, σανίδα, mountain climber) η βαρύτητα δείχνει προς το πρόσωπο:
    // η αλογοουρά πέφτει πάνω στον αυχένα (έως -1.4 rad) και η υπόλοιπη «έλξη» τη γέρνει στο πλάι,
    // ώστε να μην περνάει μέσα από το κεφάλι ούτε να μένει όρθια προς τα πάνω.
    const rawPitch = Math.atan2(-_V2.z, -_V2.y);
    const targetPitch = clamp(rawPitch, -1.4, 1.25);
    const spill = rawPitch < -1.4 ? Math.min(0.9, -1.4 - rawPitch) : 0;
    const side = _V2.x >= 0 ? 1 : -1;
    const targetRoll = clamp(Math.atan2(_V2.x, Math.max(0.25, Math.abs(_V2.y))) * 0.65 + side * spill * 0.5, -0.85, 0.85);

    // Υπο-βήματα σταθερού 1/60 s: σταθερή φυσική και σε αργές συσκευές (χωρίς ταλάντωση / «καθυστέρηση»)
    const steps = Math.max(1, Math.min(8, Math.ceil(Math.min(dt, 0.2) / (1 / 60))));
    const sdt = Math.min(dt, 0.2) / steps;
    for (let i = 0; i < c.segs.length; i++) {
      const tx = clamp(c.restX[i] + targetPitch * c.gravGain[i], c.minX[i], c.maxX[i]);
      const tz = clamp(targetRoll * (0.45 + i * 0.22), -0.75, 0.75);
      for (let k = 0; k < steps; k++) {
        const fx = -c.stiff[i] * (c.ax[i] - tx) - c.damp[i] * c.vx[i];
        const fz = -c.stiff[i] * (c.az[i] - tz) - c.damp[i] * c.vz[i];
        c.vx[i] += fx * sdt;
        c.vz[i] += fz * sdt;
        c.ax[i] = clamp(c.ax[i] + c.vx[i] * sdt, c.minX[i], c.maxX[i]);
        c.az[i] = clamp(c.az[i] + c.vz[i] * sdt, -0.8, 0.8);
      }
      c.segs[i].rotation.set(c.ax[i], 0, c.az[i]);
    }
  }

  dispose() {
    this._clearActive();
    if (this.strip.mesh && this.strip.originalIndex) {
      this.strip.mesh.geometry.setIndex(this.strip.originalIndex);
    }
    this.mount.removeFromParent();
    this.solidMat?.dispose();
    this.cardMat?.dispose();
    this.textures?.map?.dispose();
    this.textures?.bumpMap?.dispose();
    this.textures?.alphaMap?.dispose();
  }
}

```

## js/clips.js

```javascript
// Κινήσεις από motion capture (Mixamo κ.ά.) για τον ρεαλιστικό coach.
// Μορφή αρχείου: tools/clip-converter.html → «gymtrainer-clip@1»: για κάθε οστό η περιστροφή σε world space
// ΣΧΕΤΙΚΑ με το T-pose (D = W(t)·W_rest⁻¹) και η θέση της λεκάνης κανονικοποιημένη με το ύψος λεκάνης.
// Στο μοντέλο: W_target(t) = R_yaw · D(t) · W_target_rest — δουλεύει σε κάθε μοντέλο με σκελετό τύπου Mixamo.
import * as THREE from './vendor/three.module.min.js';

let manifestP = null;
const cache = new Map();

/** data/motion-clips.json: { "squat": { "src": "assets/anim/air_squat.json" }, ... } */
export function loadManifest() {
  return (manifestP ||= fetch('data/motion-clips.json', { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : {})).then(j => j.clips || {}).catch(() => ({})));
}

/** Ρυθμίσεις καταγραφής από το manifest (π.χ. props, enter/exit μεταβάσεις) */
export async function clipEntry(key) { return (await loadManifest())[key] || null; }

/** Μετάβαση (enter: όρθια → θέση άσκησης, exit: θέση άσκησης → όρθια) για την άσκηση */
export async function getTransition(key, kind) {
  const src = (await loadManifest())[key]?.[kind];
  if (!src) return null;
  if (!cache.has(src)) cache.set(src, fetch(src).then(r => (r.ok ? r.json() : null)).then(d => (d?.format === 'gymtrainer-clip@1' ? prepare(d, { src }) : null)).catch(() => null));
  return cache.get(src);
}

export async function getClip(key) {
  const man = await loadManifest();
  const entry = man[key];
  if (!entry?.src) return null;
  if (!cache.has(entry.src)) {
    cache.set(entry.src, fetch(entry.src).then(r => (r.ok ? r.json() : null)).then(d => (d?.format === 'gymtrainer-clip@1' ? prepare(d, entry) : null)).catch(() => null));
  }
  return cache.get(entry.src);
}

function prepare(d, entry) {
  const nb = d.bones.length;
  return {
    ...d, ...entry, nb,
    q: Float32Array.from(d.q), hips: Float32Array.from(d.hips),
    repStart: entry.repStart ?? d.repStart ?? 0,
    period: entry.period ?? d.period ?? d.duration,
    index: Object.fromEntries(d.bones.map((n, i) => [n, i])),
  };
}

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();

/** Δειγματοληψία τη χρονική στιγμή t (κυκλικά): επιστρέφει {q(boneIndex,out), hips(out)} */
function sampler(clip, t) {
  const dur = clip.loop ? clip.duration : (clip.frames - 1) / clip.fps;
  let tt = clip.loop ? ((t % dur) + dur) % dur : Math.min(Math.max(t, 0), dur);
  const fpos = tt * clip.fps, f0 = Math.min(clip.frames - 1, Math.floor(fpos)), f1 = Math.min(clip.frames - 1, f0 + 1), a = fpos - f0;
  return {
    q(i, out) {
      const o0 = (f0 * clip.nb + i) * 4, o1 = (f1 * clip.nb + i) * 4;
      _qa.set(clip.q[o0], clip.q[o0 + 1], clip.q[o0 + 2], clip.q[o0 + 3]);
      _qb.set(clip.q[o1], clip.q[o1 + 1], clip.q[o1 + 2], clip.q[o1 + 3]);
      return out.slerpQuaternions(_qa, _qb, a);
    },
    hips(out) {
      const o0 = f0 * 3, o1 = f1 * 3, h = clip.hips;
      return out.set(h[o0] + (h[o1] - h[o0]) * a, h[o0 + 1] + (h[o1 + 1] - h[o0 + 1]) * a, h[o0 + 2] + (h[o1 + 2] - h[o0 + 2]) * a);
    },
  };
}

const _yaw = new THREE.Quaternion(), _D = new THREE.Quaternion(), _W = new THREE.Quaternion(), _P = new THREE.Quaternion(), _L = new THREE.Quaternion();
const _v = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);

/**
 * Εφαρμόζει την κίνηση στο SkinnedCoach με βάρος w (0..1) πάνω από την ήδη υπολογισμένη (διαδικαστική) πόζα.
 * Τα οστά επεξεργάζονται από τη ρίζα προς τα άκρα, ώστε κάθε τοπική περιστροφή να υπολογίζεται
 * πάνω στη ΝΕΑ world περιστροφή του γονέα.
 */
export function applyClip(sk, clip, t, yaw, w) {
  if (!clip || w <= 0.001) return;
  const S = sampler(clip, t);
  _yaw.setFromAxisAngle(_Y, yaw);
  const worldOf = new Map();
  const visit = bone => {
    const n = bone.name.replace(/^mixamorig\d*[:_]?/i, '');
    const i = clip.index[n], rest = sk.rest[n];
    if (i != null && rest) {
      S.q(i, _D);
      const Wt = _W.copy(_yaw).multiply(_D).multiply(rest.world).clone();
      const pW = worldOf.get(bone.parent) || bone.parent.getWorldQuaternion(_P).clone();
      _L.copy(pW).invert().multiply(Wt);
      bone.quaternion.slerp(_L, w);
      // world μετά το blending (για τα παιδιά)
      worldOf.set(bone, pW.clone().multiply(bone.quaternion));
      if (n === 'Hips') {
        const H = rest.pos.y; // ύψος λεκάνης στο T-pose (πέλματα στο 0)
        S.hips(_v);
        const target = new THREE.Vector3(_v.x * H, _v.y * H, _v.z * H).applyQuaternion(_yaw);
        const cur = bone.getWorldPosition(new THREE.Vector3());
        cur.lerp(target, w);
        bone.parent.updateMatrixWorld(true);
        bone.parent.worldToLocal(cur);
        bone.position.copy(cur);
      }
    } else if (worldOf.has(bone.parent)) {
      worldOf.set(bone, worldOf.get(bone.parent).clone().multiply(bone.quaternion));
    }
    for (const c of bone.children) if (c.isBone) visit(c);
  };
  visit(sk.b.Hips);
  sk.root.updateMatrixWorld(true);

  // Επαφή με το έδαφος: το χαμηλότερο σημείο επαφής ακουμπά ακριβώς στο πάτωμα (ούτε βύθισμα ούτε αιώρηση)
  const C = [['LeftToeBase', sk.dims.toeHeight], ['RightToeBase', sk.dims.toeHeight], ['LeftFoot', sk.dims.footHeight * 0.92], ['RightFoot', sk.dims.footHeight * 0.92],
    ['LeftHand', 0.022], ['RightHand', 0.022], ['LeftLeg', 0.055], ['RightLeg', 0.055], ['Hips', 0.11], ['Spine2', 0.12], ['Head', 0.11]];
  let minY = Infinity;
  for (const [n, r] of C) if (sk.b[n]) minY = Math.min(minY, sk.worldPos(n, _v).y - r);
  if (Number.isFinite(minY) && Math.abs(minY) > 1e-4) {
    const hb = sk.b.Hips, wpos = hb.getWorldPosition(new THREE.Vector3());
    wpos.y -= minY * w;
    hb.parent.worldToLocal(wpos); hb.position.copy(wpos);
    sk.root.updateMatrixWorld(true);
  }
}

```

## gallery.html

```html
<!doctype html>
<html lang="el">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>GymTrAIner — Gallery κινήσεων</title>
<style>
  body{margin:0;font:14px system-ui,sans-serif;background:#eef2f7;color:#0f172a}
  header{padding:12px 16px;background:#0f172a;color:#fff}
  header a{color:#4ade80}
  form{display:flex;flex-wrap:wrap;gap:8px;padding:12px 16px;background:#fff;border-bottom:1px solid #e2e8f0}
  textarea{width:100%;min-height:60px;font:inherit}
  input,select,button{font:inherit;padding:6px 10px}
  #g{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:10px;padding:12px}
  .cell{background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px #0002}
  .view{height:300px;position:relative}
  .lbl{padding:6px 10px;font-size:12px;border-top:1px solid #eee}
  .lbl b{color:#16a34a}
</style>
<script type="importmap">{ "imports": { "three": "./js/vendor/three.module.min.js" } }</script>
</head>
<body>
<header>🎬 <b>Gallery κινήσεων του 3D coach</b> — εργαλείο ελέγχου (θέση αρχής «0» και τέλους «1» κάθε κίνησης). <a href="./">← Εφαρμογή</a></header>
<form id="f">
  <div style="width:100%"><label>Ονόματα ασκήσεων (ένα ανά γραμμή, προαιρετικά «όνομα | εξοπλισμός»):</label>
  <textarea name="ex" placeholder="Κωπηλατική με λάστιχο σε όρθια θέση | λάστιχο&#10;Κάμψεις στα γόνατα | στρώμα"></textarea></div>
  <label>…ή κινήσεις (κλειδιά): <input name="m" size="40" placeholder="squat,pushup,plank"></label>
  <label>Εξοπλισμός (για κλειδιά): <input name="eq" size="18" placeholder="dumbbells,mat"></label>
  <label>Κόμμωση <select name="hair"><option value="">προεπιλογή</option><option>original</option><option>ponytail</option><option>bun</option><option>braid</option><option>short</option></select></label>
  <label>Σελίδα <input name="page" type="number" min="1" value="1" style="width:60px"></label>
  <button>Εμφάνιση</button>
</form>
<div id="g"></div>
<script type="module">
import { Avatar } from './js/avatar.js';
import { MOTION_KEYS, inferMotion } from './js/motions.js';
import { equipmentFor } from './js/equipment.js';

const q = new URLSearchParams(location.search), f = document.getElementById('f');
for (const k of ['ex', 'm', 'eq', 'page', 'hair']) if (q.get(k)) f.elements[k].value = q.get(k);
const PER = 4; // 4 ασκήσεις × 2 θέσεις = 8 WebGL contexts (όριο browser ~16)

let items;
if (q.get('ex')) {
  items = q.get('ex').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const [name, equipment = ''] = l.split('|').map(s => s.trim());
    const ex = { name, equipment }, m = inferMotion(ex);
    return { title: name, m, eq: equipmentFor(ex, m) };
  });
} else {
  const keys = q.get('m') ? q.get('m').split(',').map(s => s.trim()) : MOTION_KEYS;
  const eq = q.get('eq') ? Object.fromEntries(q.get('eq').split(',').map(k => [k.trim(), true])) : null;
  items = keys.map(m => ({ title: m, m, eq: eq || equipmentFor({ name: m }, m) }));
}
const page = Math.max(1, +(q.get('page') || 1)), slice = items.slice((page - 1) * PER, page * PER);
const g = document.getElementById('g');
if (items.length > PER) g.insertAdjacentHTML('beforebegin', `<p style="padding:0 16px">Σελίδα ${page}/${Math.ceil(items.length / PER)} — άλλαξε «Σελίδα» για τις υπόλοιπες.</p>`);

for (const it of slice) for (const u of [0, 1]) {
  const cell = document.createElement('div'); cell.className = 'cell';
  const view = document.createElement('div'); view.className = 'view';
  const lbl = document.createElement('div'); lbl.className = 'lbl';
  lbl.innerHTML = `<b>${it.m}</b> · θέση ${u} · εξοπλισμός: ${Object.keys(it.eq).join(', ') || '—'}<br>${it.title.replace(/</g, '&lt;')}`;
  cell.append(view, lbl); g.append(cell);
  const a = new Avatar(view, 'real', { quality: 'normal', hair: q.get('hair') || undefined }); await a.loaded;
  a.paused = true; cancelAnimationFrame(a.raf); await a.debug(it.m, u, false, it.eq);
  lbl.innerHTML += ` · <i>${a.motionSource === 'clip' ? '🎥 motion capture' : 'χειροποίητη'}</i>`;
}
window.done = true;
</script>
</body>
</html>

```

## tools/clip-converter.html

```html
<!doctype html>
<html lang="el">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>GymTrAIner — Μετατροπή κινήσεων Mixamo</title>
<style>
  body{font:15px system-ui,sans-serif;margin:0;background:#f4f6fb;color:#0f172a}
  main{max-width:860px;margin:0 auto;padding:20px}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:14px}
  label{display:block;margin:8px 0 4px;font-weight:600}
  input,select,button{font:inherit;padding:6px 10px}
  table{border-collapse:collapse;width:100%;font-size:.9rem} td,th{border-bottom:1px solid #e2e8f0;padding:6px;text-align:left}
  code{background:#eef2f7;padding:1px 5px;border-radius:5px}
</style>
<script type="importmap">{ "imports": { "three": "../js/vendor/three.module.min.js" } }</script>
</head>
<body><main>
<h1>🎬 Μετατροπή κινήσεων Mixamo → GymTrAIner</h1>
<div class="card">
  <ol>
    <li>Στο mixamo.com διάλεξε κίνηση → Download → <b>FBX Binary</b>, 30 fps (with ή without skin, όπως θέλεις).</li>
    <li>Διάλεξε εδώ το αρχείο, την κίνηση της εφαρμογής που αντικαθιστά και πώς ξεκινά μια επανάληψη.</li>
    <li>Κατέβασε το <code>.json</code> και βάλ' το στο <code>assets/anim/</code>, και πρόσθεσε μια γραμμή στο <code>data/motion-clips.json</code>.</li>
  </ol>
  <label>Αρχείο FBX</label><input type="file" id="file" accept=".fbx">
  <label>Κίνηση εφαρμογής (κλειδί)</label><input id="key" placeholder="π.χ. squat, pushup, crunch">
  <label>Μια επανάληψη ξεκινά όταν…</label>
  <select id="mode">
    <option value="hipsHigh">η λεκάνη είναι ψηλά (καθίσματα, κάμψεις, άλματα)</option>
    <option value="headLow">το κεφάλι είναι χαμηλά (κοιλιακοί/sit-ups ξαπλωμένος)</option>
    <option value="headHigh">το κεφάλι είναι ψηλά (όρθια θέση, π.χ. burpee)</option>
    <option value="once">μετάβαση — παίζει μία φορά ολόκληρη (π.χ. όρθια → σανίδα)</option>
    <option value="handsLow">τα χέρια είναι χαμηλά (π.χ. jumping jacks)</option>
  </select>
  <label><input type="checkbox" id="inplace"> Επί τόπου (αφαίρεση μετακίνησης, π.χ. τρέξιμο/περπάτημα)</label>
  <p><button id="go">Μετατροπή</button></p>
  <div id="out"></div>
</div>
</main>
<script type="module">
import * as THREE from 'three';
import { FBXLoader } from '../js/vendor/jsm/loaders/FBXLoader.js';

const FPS = 30;
const norm = n => n.replace(/^mixamorig\d*[:_]?/i, '');

/** Μετατρέπει ArrayBuffer FBX σε «ανεξάρτητη από χαρακτήρα» κίνηση:
 *  για κάθε οστό, περιστροφή σε world space ΣΧΕΤΙΚΑ με το T-pose (D = W(t)·W_rest⁻¹)
 *  και θέση λεκάνης κανονικοποιημένη με το ύψος λεκάνης. Έτσι παίζει σε οποιοδήποτε μοντέλο Mixamo. */
export async function convert(buf, { key, mode = 'hipsHigh', name = 'clip', inPlace = false } = {}) {
  const obj = new FBXLoader().parse(buf, '');
  const clip = obj.animations[0];
  if (!clip) throw new Error('Το FBX δεν έχει κίνηση');
  const bones = [], seen = new Set();
  obj.traverse(o => { if (o.isBone && !seen.has(norm(o.name))) { seen.add(norm(o.name)); bones.push(o); } }); // χωρίς διπλότυπα σκελετών
  if (!bones.find(b => norm(b.name) === 'Hips')) throw new Error('Δεν βρέθηκε σκελετός Mixamo');
  obj.updateMatrixWorld(true);
  const rest = bones.map(b => b.getWorldQuaternion(new THREE.Quaternion()));
  const hips = bones.find(b => norm(b.name) === 'Hips');
  const restHips = hips.getWorldPosition(new THREE.Vector3());
  const foot = bones.find(b => norm(b.name) === 'LeftToeBase') || bones.find(b => norm(b.name) === 'LeftFoot');
  const floorY = foot.getWorldPosition(new THREE.Vector3()).y;
  const hipsH = restHips.y - floorY;

  const mixer = new THREE.AnimationMixer(obj); const act = mixer.clipAction(clip); act.setLoop(THREE.LoopOnce); act.clampWhenFinished = true; act.play();
  const n = Math.max(2, Math.round(clip.duration * FPS) + 1);
  const q = [], hp = [], sig = [];
  const head = bones.find(b => norm(b.name) === 'Head');
  const wq = new THREE.Quaternion(), wv = new THREE.Vector3();
  for (let f = 0; f < n; f++) {
    mixer.setTime(Math.min(f / FPS, clip.duration - 1e-4)); // χωρίς «τύλιγμα» του τελευταίου καρέ στην αρχή obj.updateMatrixWorld(true);
    bones.forEach((b, i) => {
      b.getWorldQuaternion(wq).multiply(rest[i].clone().invert());
      q.push(+wq.x.toFixed(4), +wq.y.toFixed(4), +wq.z.toFixed(4), +wq.w.toFixed(4));
    });
    hips.getWorldPosition(wv);
    hp.push(+((wv.x - restHips.x) / hipsH).toFixed(4), +((wv.y - floorY) / hipsH).toFixed(4), +((wv.z - restHips.z) / hipsH).toFixed(4));
    const handY = (bones.find(b => norm(b.name) === 'LeftHand').getWorldPosition(new THREE.Vector3()).y + bones.find(b => norm(b.name) === 'RightHand').getWorldPosition(new THREE.Vector3()).y) / 2;
    sig.push(mode === 'hipsHigh' ? wv.y : mode === 'handsLow' ? handY : head.getWorldPosition(new THREE.Vector3()).y);
  }

  // Οι κινήσεις Mixamo είναι μία επανάληψη σε loop. Η επανάληψη της εφαρμογής ξεκινά από τη «θέση εκκίνησης»
  // (π.χ. όρθια στα καθίσματα, πάνω θέση στις κάμψεις, ξαπλωμένη στους κοιλιακούς) και διαρκεί έναν πλήρη κύκλο.
  const want = mode === 'headLow' || mode === 'handsLow' ? -1 : 1;
  const s = sig.map(v => want * v), hi = Math.max(...s), lo = Math.min(...s), amp = Math.max(hi - lo, 1e-6);
  let start, isLoop, period, reps;
  if (mode === 'once') { // μετάβαση (π.χ. όρθια → σανίδα): παίζει μία φορά, ολόκληρη
    start = 0; isLoop = false; period = clip.duration; reps = 1;
  } else {
    start = s.findIndex(v => v >= hi - amp * 0.02);
    isLoop = Math.abs(s[0] - s[n - 1]) < amp * 0.08;
    // Πόσες επαναλήψεις έχει η καταγραφή: κορυφές της «αρχικής θέσης» με ενδιάμεσο πραγματικό βάθος
    reps = 0; let armed = false;
    for (let i = 0; i < n; i++) { if (s[i] < hi - amp * 0.6) armed = true; else if (armed && s[i] >= hi - amp * 0.1) { reps++; armed = false; } }
    reps = Math.max(1, reps);
    period = (isLoop ? clip.duration : clip.duration - start / FPS) / reps;
  }
  const peaks = [start];
  // «Επί τόπου»: αφαιρούμε τη μετακίνηση της λεκάνης στο επίπεδο (π.χ. τρέξιμο προς τα εμπρός)
  if (inPlace) for (let f = 0; f < n; f++) { hp[f * 3] = 0; hp[f * 3 + 2] = 0; }
  return {
    format: 'gymtrainer-clip@1', inPlace, name, key, fps: FPS, frames: n,
    bones: bones.map(b => norm(b.name)), q, hips: hp,
    repStart: +(start / FPS).toFixed(3), period: +period.toFixed(3), loop: isLoop, reps, duration: +clip.duration.toFixed(3),
    peaks: peaks.map(p => +(p / FPS).toFixed(2)),
  };
}
window.convert = async (url, opts) => convert(await (await fetch(url)).arrayBuffer(), opts);

document.getElementById('go').onclick = async () => {
  const f = document.getElementById('file').files[0], out = document.getElementById('out');
  if (!f) return;
  out.textContent = '⏳ Μετατροπή…';
  try {
    const key = document.getElementById('key').value.trim() || 'generic';
    const res = await convert(await f.arrayBuffer(), { key, mode: document.getElementById('mode').value, inPlace: document.getElementById('inplace').checked, name: f.name.replace(/\.fbx$/i, '') });
    const file = res.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '.json';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(res)], { type: 'application/json' })); a.download = file; a.textContent = '⬇ ' + file;
    out.innerHTML = `<p>Διάρκεια ${res.duration}s · επανάληψη από ${res.repStart}s, διάρκεια ${res.period}s · ${res.bones.length} οστά</p><p>Γραμμή για το data/motion-clips.json:<br><code>"${key}": { "src": "assets/anim/${file}" }</code></p>`;
    out.prepend(a);
  } catch (e) { out.textContent = '❌ ' + e.message; }
};
</script>
</body></html>

```
