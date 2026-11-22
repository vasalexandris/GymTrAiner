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

// ---- ΒΑΣΙΚΕΣ ΠΟΖΕΣ ----
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

const bridgeA = P({ ...lie, ...arms(0.04, 0.18, -0.10) });
const bridgeB = P({ ...lie, rrx: -1.96, rY: 0.37, rZ: 0.05, ...legs(-0.04, 1.70, 0.06), ...arms(0.42, 0.18, -0.10) });

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
    ik: { feet: 'bridge', stanceW: 0.28, toeOut: 0.12, hands: 'free', forearmTwist: -1.35, elbowFlare: 0.22, grip: 'open', spine: 'neutral' },
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
    palm: 'flat', label: 'Πλάγια σανίδα', tempo: 3.0, yaw: 0.32, floor: true, hold: true, flatFeet: false,
    frame: { h: 1.75, w: 2.35, cy: 0.46 },
    A: sidePlankP, B: sidePlankP,
    keys: [{ t: 0, p: sidePlankP }, { t: 1, p: sidePlankP }],
    ik: { feet: 'side_plank', hands: 'side_plank', forearmTwist: -1.30, elbowFlare: 0.35, grip: 'floor', spine: 'neutral' },
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
    ik: { feet: 'planted', stanceW: 0.26, toeOut: 0.10, hands: 'band_pull', forearmTwist: -1.25, elbowFlare: 0.45, grip: 'bar', spine: 'neutral' },
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
/** Αφαίρεση τόνων: στα ελληνικά ο τόνος μετακινείται με την κλίση («δικέφαλος» → «δικεφάλων»),
 *  οπότε οι κανόνες ταιριάζουν πάντα σε κείμενο χωρίς τόνους. */
export const deaccent = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const RULES = [
  [/mountain.?climb|ορειβατ/i, 'mountain_climber'],
  [/burpee|μπερπι|μπερπι/i, 'burpee'],
  [/dead.?bug|νεκρο\s*εντομ/i, 'dead_bug'],
  [/bird.?dog|διαγωνια\s*εκταση|στα\s*τεσσερα|τετραποδ|quadruped|superman.*γονατ/i, 'bird_dog'],
  [/superman|σουπερμαν|σουπερμαν|υπερεκταση\s*ραχ|ραχιαι/i, 'superman'],
  [/side\s*plank|πλαγια\s*σανιδ|πλαινη\s*σανιδ|πλαγιο\s*πλανκ/i, 'side_plank'],
  [/russian\s*twist|ρωσικ|στροφες\s*κορμου/i, 'russian_twist'],
  [/wall\s*sit|καθισμα.*τοιχ|τοιχ.*καθισμα|ισομετρικ.*καθισμα/i, 'wall_sit'],
  [/step.?up|box\s*step|ανεβασμα.*(σκαλ|κουτ|παγκ|box)|σκαλοπατ/i, 'step_up'],
  [/hip\s*thrust|ωθησ.*ισχι|ωθησ.*ισχι|ανυψωση\s*λεκανης.*παγκ/i, 'hip_thrust'],
  [/reverse\s*lunge|οπισθι.*(προβολ|εκπτωσ)|πισω\s*(προβολ|εκπτωσ)/i, 'reverse_lunge'],
  [/triceps?\s*dip|chair\s*dip|bench\s*dip|βυθισ.*(τρικεφ|καρεκλ|παγκ)|βουτι.*(τρικεφ|καρεκλ|παγκ)|\bdips?\b/i, 'triceps_dip'],
  [/band\s*pull.?apart|pull.?apart|διανοιξη.*λαστιχ|ανοιγματα.*λαστιχ|ανοιγμα.*λαστιχ/i, 'band_pull_apart'],
  [/(trx|ιμαντ|suspension).*(chest|push|press)|(chest|στηθ|πιεσ).*(trx|ιμαντ|suspension)/i, 'trx_chest_press'],
  [/(trx|ιμαντ|suspension).*(squat|καθισμ|σκουατ)|(squat|καθισμ|σκουατ).*(trx|ιμαντ|suspension)/i, 'trx_squat'],
  [/(trx|ιμαντ|suspension).*(row|κωπηλ|ελξ)|(row|κωπηλ|ελξ).*(trx|ιμαντ|suspension)|inverted\s*row|αντιστροφη\s*κωπηλ/i, 'incline_row'],
  [/back\s*squat|barbell.*squat|καθισμα.*μπαρα.*πλατ|καθισματα.*μπαρα|μπαρα.*πλατ/i, 'back_squat'],
  [/barbell.*row|bent.?over.*row|κωπηλατικ.*μπαρα|μπαρα.*κωπηλατικ/i, 'barbell_row'],
  [/romanian|rdl|ρουμανικ|good.?morning|swing|hip\s*hinge|ελξη\s*ισχιου/i, 'hinge'],
  [/deadlift|αρσ(η|εις)\s*θανατ|νεκρ(η|ες)\s*αρσ/i, 'deadlift'],
  [/jumping|jack|ανοιχτα\s*αλματα|αλματα\s*ανοι/i, 'jumping_jack'],
  [/high.?knee|ψηλα\s*γονατα|τρεξιμο|jog|βαδην|march|skip/i, 'high_knees'],
  [/push.?up|καμψεις|καμψη.*(στηριξη|ωμων|στηθ)|pushup/i, 'pushup'],
  [/plank|σανιδα|πλανκ/i, 'plank'],
  [/lunge|εκπτωσ|προβολ|split\s*squat/i, 'lunge'],
  [/squat|καθισματα|καθισμα|σκουατ/i, 'squat'],
  [/row|κωπηλ|ελξη|pull/i, 'row'],
  [/overhead|shoulder\s*press|military|πιεσεις\s*ωμων|πρεσα\s*ωμων|arnold/i, 'overhead_press'],
  [/lateral|πλαγι(α|ες)\s*ανυψω|side\s*raise/i, 'lateral_raise'],
  [/curl|δικεφαλ|biceps/i, 'curl'],
  [/crunch|κοιλιακ|sit.?up|bicycle|leg\s*raise/i, 'crunch'],
  [/bridge|γεφυρα|glute|γλουτ/i, 'glute_bridge'],
  [/calf|γαμπ|toe\s*raise/i, 'calf_raise'],
  [/bench|στηθους|chest/i, 'generic'],
];

export function inferMotion(ex) {
  let m = ex.motion && MOTIONS[ex.motion] ? ex.motion : null;
  const eqText = deaccent(`${ex.equipment || ''} ${ex.name || ''} ${ex.youtube_query || ''}`);
  if (!m) {
    const name = deaccent(`${ex.name || ''} ${ex.youtube_query || ''}`);
    m = (RULES.find(([re]) => re.test(name)) || [, 'generic'])[1];
  }
  const hasTrx = /trx|ιμαντ|suspension/i.test(eqText);
  const hasBar = /barbell|μπαρα(?!\s*(ελξ|ελξ|pull))|\bbar\b(?!\s*pull)/i.test(eqText);
  if (hasTrx) {
    if (m === 'row') m = 'incline_row';
    else if (m === 'squat') m = 'trx_squat';
    else if (m === 'pushup' || m === 'generic') {
      if (/chest|στηθ|press|πιεσ|push/i.test(eqText)) m = 'trx_chest_press';
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
