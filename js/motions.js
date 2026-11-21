// Βιβλιοθήκη κινήσεων για τον 3D coach. Γωνίες σε rad, forward kinematics.
// Συμβάσεις (ο χαρακτήρας κοιτάζει +z):
//  sl/sr x : ώμος (αρνητικό = ύψωση μπροστά) · z : απαγωγή (L αρνητικό = προς τα έξω)
//  el      : αγκώνας (αρνητικό = κάμψη μπροστά)   kn : γόνατο (θετικό = κάμψη)
//  hl/hr x : ισχίο (αρνητικό = μπροστά)           tx : κλίση κορμού (θετικό = μπροστά)
//  rrx/rY/rZ : περιστροφή/θέση ολόκληρου σώματος (floor κινήσεις)
const base = { tx: 0, hd: 0, slx: 0, slz: 0, srx: 0, srz: 0, elL: 0, elR: 0, hlx: 0, hlz: 0, hrx: 0, hrz: 0, knL: 0, knR: 0, anL: 0, anR: 0, lift: 0, rrx: 0, rY: 0, rZ: 0 };
const P = o => ({ ...base, ...o });
const arms = (x, out = 0, el = 0) => ({ slx: x, srx: x, slz: -out, srz: out, elL: el, elR: el });
const legs = (x, kn = 0, out = 0) => ({ hlx: x, hrx: x, knL: kn, knR: kn, hlz: -out, hrz: out });

export function mirror(p) {
  return { ...p, slx: p.srx, srx: p.slx, slz: -p.srz, srz: -p.slz, elL: p.elR, elR: p.elL, hlx: p.hrx, hrx: p.hlx, hlz: -p.hrz, hrz: -p.hlz, knL: p.knR, knR: p.knL, anL: p.anR, anR: p.anL };
}

const pushTop = P({ rrx: 1.19, rY: 0.42, rZ: 0.14, hd: -0.5, ...arms(-1.19) });
const pushBot = P({ rrx: 1.38, rY: 0.25, rZ: 0.12, hd: -0.45, ...arms(-0.28, 0.12, -1.1) });
const lie = { rrx: -1.57, rY: 0.14, rZ: 0.1, ...legs(-0.84, 2.06) };
const lunge = P({ ...arms(-0.3, 0.1), hlx: -1.1, knL: 1.3, hrx: 0.35, knR: 0.73, anR: 0.7, tx: 0.08 });
const knee = P({ ...arms(-0.5, 0, -1.6), hlx: -1.5, knL: 1.6, srx: -1.0, slx: 0.5 });

export const MOTIONS = {
  squat:         { label: 'Καθίσματα', tempo: 3, prof: [0.5, 0.08, 0.42], yaw: 1.0, A: P({ ...arms(-0.25), ...legs(-0.05) }), B: P({ tx: 0.55, ...arms(-2.1), ...legs(-1.45, 1.9, 0.12) }) },
  lunge:         { label: 'Εκπτώσεις', tempo: 3.5, prof: [0.5, 0.06, 0.44], yaw: 1.0, alt: true, A: P(arms(-0.3, 0.1)), B: lunge },
  hinge:         { label: 'Έλξη ισχίου', tempo: 3.5, prof: [0.5, 0.08, 0.42], yaw: 1.0, A: P(arms(-0.1)), B: P({ tx: 1.15, ...arms(-1.25), ...legs(-0.55, 0.55) }) },
  row:           { label: 'Κωπηλατική', tempo: 3, prof: [0.4, 0.12, 0.48], yaw: 1.0, A: P({ tx: 1.0, ...arms(-1.0), ...legs(-0.45, 0.5) }), B: P({ tx: 1.0, ...arms(-0.35, 0, -0.9), ...legs(-0.45, 0.5) }) },
  overhead_press:{ palm: 'fwd', label: 'Πιέσεις ώμων', tempo: 3, prof: [0.45, 0.1, 0.45], yaw: 0.25, A: P(arms(-0.4, 0.35, -2.1)), B: P(arms(-3.0, 0.15, -0.05)) },
  curl:          { palm: 'up', label: 'Καμπές δικεφάλων', tempo: 3, prof: [0.4, 0.1, 0.5], yaw: 0.5, A: P(arms(-0.05, 0.05, -0.05)), B: P(arms(-0.2, 0.05, -2.5)) },
  lateral_raise: { label: 'Πλάγιες ανυψώσεις', tempo: 3, prof: [0.4, 0.1, 0.5], yaw: 0.2, A: P(arms(0, 0.08, -0.1)), B: P(arms(0, 1.45, -0.25)) },
  jumping_jack:  { label: 'Jumping jacks', tempo: 1.2, yaw: 0.2, noZ: true, A: P({ ...arms(0, 0.15), ...legs(0, 0, 0.08) }), B: P({ ...arms(0, 2.9), ...legs(0, 0, 0.38), lift: 0.05 }) },
  high_knees:    { label: 'Ψηλά γόνατα', tempo: 1.4, yaw: 0.6, alt: true, noZ: true, A: P(arms(-0.5, 0, -1.6)), B: knee },
  calf_raise:    { label: 'Ανασηκώσεις γάμπας', tempo: 2, prof: [0.4, 0.2, 0.4], yaw: 0.8, A: P(arms(0)), B: P({ ...arms(0), anL: 0.9, anR: 0.9, lift: 0.09 }) },
  pushup:        { palm: 'flat', label: 'Κάμψεις', tempo: 3, prof: [0.5, 0.05, 0.45], yaw: 1.35, floor: true, flatFeet: false, A: pushTop, B: pushBot },
  plank:         { palm: 'flat', label: 'Σανίδα', tempo: 3, yaw: 1.35, floor: true, hold: true, flatFeet: false, A: pushTop, B: pushTop },
  crunch:        { label: 'Κοιλιακοί', tempo: 2.5, prof: [0.45, 0.1, 0.45], yaw: 1.35, floor: true, A: P({ ...lie, ...arms(-0.35, 0.12), hd: 0 }), B: P({ ...lie, tx: 0.85, hd: 0.25, ...arms(-0.75, 0.1) }) },
  glute_bridge:  { label: 'Γέφυρα γλουτών', tempo: 3, prof: [0.4, 0.2, 0.4], yaw: 1.35, floor: true, A: P({ ...lie, ...arms(0.05, 0.18) }), B: P({ ...lie, rrx: -1.97, rY: 0.32, ...legs(-0.01, 1.89), ...arms(0.45, 0.18) }) },
  incline_row:   { label: 'Κωπηλατική με ιμάντες (TRX)', tempo: 3, prof: [0.4, 0.12, 0.48], yaw: 1.2, floor: true, frame: { h: 2.75, w: 2.4, cy: 1.25 },
                   A: P({ rrx: -0.6, rY: 0.796, rZ: -0.2, ...arms(-1.64) }), B: P({ rrx: -0.35, rY: 0.896, rZ: 0.0, ...arms(0.75, 0.1, -2.0) }) },
  bird_dog:      { palm: 'flat', label: 'Bird-dog (στα τέσσερα)', tempo: 3.5, prof: [0.4, 0.2, 0.4], yaw: 1.3, floor: true, flatFeet: false, alt: true,
                   A: P({ rrx: 1.37, rY: 0.51, rZ: 0, hd: -0.3, ...arms(-1.37), ...legs(-1.37, 1.57) }),
                   B: P({ rrx: 1.37, rY: 0.51, rZ: 0, hd: -0.3, slx: -2.94, srx: -1.37, hlx: -1.37, knL: 1.57, hrx: 0.2, knR: 0 }) },
  generic:       { label: 'Κίνηση άσκησης', tempo: 2.5, yaw: 0.5, alt: true, A: P(arms(-0.3, 0, -0.8)), B: P({ ...arms(-0.8, 0, -1.2), hlx: -0.7, knL: 0.9 }) },
};

export const MOTION_KEYS = Object.keys(MOTIONS);

const RULES = [
  [/bird.?dog|διαγώνια έκταση|στα τέσσερα|τετραποδ|quadruped|superman.*γόνατ/i, 'bird_dog'],
  [/dead.?bug|νεκρό έντομο/i, 'crunch'],
  [/(trx|ιμάντ|suspension).*(row|κωπηλ|έλξ)|(row|κωπηλ|έλξ).*(trx|ιμάντ|suspension)|inverted row|αντίστροφη κωπηλ/i, 'incline_row'],
  [/bench|στήθους|chest|dip|βουτι/i, 'generic'],
  [/jumping|jack|ανοιχτά άλματα|άλματα ανοι/i, 'jumping_jack'],
  [/high.?knee|ψηλά γόνατα|τρέξιμο|jog|βάδην|march|skip/i, 'high_knees'],
  [/push.?up|κάμψεις|κάμψη.*(στήριξη|ώμων)|pushup/i, 'pushup'],
  [/plank|σανίδα|πλανκ/i, 'plank'],
  [/lunge|εκπτώσ|προβολ|split squat|step.?up/i, 'lunge'],
  [/squat|καθίσματα|σκουάτ|wall sit/i, 'squat'],
  [/deadlift|ρουμανικ|hinge|good.?morning|νεκρ|swing|hip hinge/i, 'hinge'],
  [/row|κωπηλ|έλξη|pull/i, 'row'],
  [/overhead|shoulder press|military|πιέσεις ώμων|πρέσα ώμων|arnold/i, 'overhead_press'],
  [/lateral|πλάγι(α|ες) ανύψω|side raise/i, 'lateral_raise'],
  [/curl|δικέφαλ|biceps/i, 'curl'],
  [/crunch|κοιλιακ|sit.?up|bicycle|leg raise/i, 'crunch'],
  [/bridge|γέφυρα|glute|γλουτ|thrust/i, 'glute_bridge'],
  [/calf|γάμπ|toe raise/i, 'calf_raise'],
];

export function inferMotion(ex) {
  let m = ex.motion && MOTIONS[ex.motion] ? ex.motion : null;
  if (!m) {
    const name = `${ex.name || ''} ${ex.youtube_query || ''}`;
    m = (RULES.find(([re]) => re.test(name)) || [, 'generic'])[1];
  }
  // κωπηλατική με ιμάντες TRX → κίνηση με κλίση προς τα πίσω
  if (m === 'row' && /trx|ιμάντ|suspension/i.test(`${ex.equipment || ''} ${ex.name || ''}`)) m = 'incline_row';
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
