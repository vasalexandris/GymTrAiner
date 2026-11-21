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
