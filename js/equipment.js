// Εξοπλισμός που κρατά/χρησιμοποιεί ο coach. Ρεαλιστικά υλικά (PBR) για αντανακλάσεις από το environment.
import * as THREE from './vendor/three.module.min.js';

const RULES = {
  straps: /trx|ιμάντ|suspension|strap|αιωρούμεν/i,
  band: /λάστιχ|band|resistance|ελαστικ|λάστιχα/i,
  kettlebell: /kettle|κέτλ|κετλ/i,
  barbell: /barbell|μπάρα(?!\s*(έλξ|ελξ|pull))|\bbar\b(?!\s*pull)/i,
  dumbbells: /αλτήρ|dumbbell|\bdb\b|μπουκάλι/i,
  mat: /στρώμα|mat\b|yoga|γιόγκα/i,
};

/** Επιστρέφει {dumbbells, kettlebell, band, straps, barbell, mat, goblet} για μια άσκηση. */
export function equipmentFor(ex, motion) {
  const eq = String(ex.equipment || '');
  const text = `${eq} ${ex.name || ''} ${ex.youtube_query || ''}`;
  const has = k => RULES[k].test(eq) || (k !== 'mat' && RULES[k].test(`${ex.name || ''} ${ex.youtube_query || ''}`));
  const e = {};
  for (const k of Object.keys(RULES)) if (has(k)) e[k] = true;
  if (/σώμα|bodyweight|χωρίς/i.test(eq) && !/αλτήρ|λάστιχ|band|kettle|μπάρα/i.test(eq)) for (const k of ['dumbbells', 'kettlebell', 'barbell', 'band', 'straps']) if (!RULES[k].test(ex.name || '')) delete e[k];
  if (/goblet|κύπελλο/i.test(text)) e.goblet = true;
  if (e.kettlebell) { delete e.dumbbells; }
  if (e.barbell) { delete e.dumbbells; }
  if (motion && ['pushup', 'plank', 'crunch', 'glute_bridge', 'bird_dog'].includes(motion)) e.mat = true;
  if (['pushup', 'plank', 'jumping_jack', 'high_knees', 'bird_dog'].includes(motion)) { delete e.dumbbells; delete e.kettlebell; delete e.barbell; }
  return e;
}

const M = {
  rubber: () => new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.78, metalness: 0.05 }),
  chrome: () => new THREE.MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.18, metalness: 1 }),
  knurl: () => new THREE.MeshStandardMaterial({ color: 0x9aa1aa, roughness: 0.45, metalness: 1 }),
  iron: () => new THREE.MeshStandardMaterial({ color: 0x25272b, roughness: 0.55, metalness: 0.6 }),
  latex: c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.42, metalness: 0 }),
  strap: () => new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.9 }),
  handle: () => new THREE.MeshStandardMaterial({ color: 0xf2c94c, roughness: 0.6 }),
  mat: () => new THREE.MeshStandardMaterial({ color: 0x5b4b8a, roughness: 0.95 }),
};
const shadow = o => { o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } }); return o; };

function dumbbell() {
  const g = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.15, 16), M.knurl()); bar.rotation.z = Math.PI / 2; g.add(bar);
  for (const s of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.075, 6), M.rubber()); head.rotation.z = Math.PI / 2; head.position.x = s * 0.112; g.add(head);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.006, 20), M.chrome()); cap.rotation.z = Math.PI / 2; cap.position.x = s * 0.152; g.add(cap);
    const coll = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.012, 16), M.chrome()); coll.rotation.z = Math.PI / 2; coll.position.x = s * 0.07; g.add(coll);
  }
  return shadow(g);
}
function kettlebell() {
  const g = new THREE.Group(), iron = M.iron();
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.105, 28, 20), iron); bell.scale.y = 0.92; bell.position.y = -0.14; g.add(bell);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.02, 24), iron); base.position.y = -0.235; g.add(base);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.014, 12, 28, Math.PI), iron); handle.position.y = -0.06; g.add(handle);
  for (const s of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.06, 12), iron); leg.position.set(s * 0.06, -0.085, 0); g.add(leg); }
  return shadow(g);
}
function barbell() {
  const g = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.7, 16), M.chrome()); bar.rotation.z = Math.PI / 2; g.add(bar);
  for (const s of [-1, 1]) {
    for (const [x, r] of [[0.6, 0.18], [0.64, 0.14]]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.035, 32), M.rubber()); p.rotation.z = Math.PI / 2; p.position.x = s * x; g.add(p); }
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 16), M.chrome()); c.rotation.z = Math.PI / 2; c.position.x = s * 0.56; g.add(c);
  }
  return shadow(g);
}
/** Ευθύγραμμο «σχοινί/λάστιχο» ανάμεσα σε δύο σημεία */
function rope(radius, mat) { const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 10), mat); m.castShadow = true; return m; }
function stretch(m, a, b) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  m.position.copy(a).addScaledVector(d, 0.5); m.scale.set(1, Math.max(len, 0.001), 1);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
}
const alignX = (obj, axis) => obj.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), axis.clone().normalize());

export class Equipment {
  constructor(scene) { this.scene = scene; this.group = new THREE.Group(); scene.add(this.group); this.set({}); }

  set(e) {
    this.e = e || {};
    this.group.clear();
    const add = o => { this.group.add(o); return o; };
    this.o = {};
    if (this.e.dumbbells && !this.e.goblet) this.o.db = [add(dumbbell()), add(dumbbell())];
    if (this.e.dumbbells && this.e.goblet) this.o.goblet = add(dumbbell());
    if (this.e.kettlebell) this.o.kb = add(kettlebell());
    if (this.e.barbell) this.o.bar = add(barbell());
    if (this.e.band) this.o.band = [add(rope(0.011, M.latex(0xe63946))), add(rope(0.011, M.latex(0xe63946)))];
    if (this.e.straps) {
      const st = M.strap(), hd = M.handle();
      this.o.straps = [add(rope(0.012, st)), add(rope(0.012, st))];
      this.o.handles = [0, 1].map(() => { const h = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.13, 14), hd); h.castShadow = true; return add(h); });
      const anchor = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.08), M.iron()); this.o.anchor = add(anchor);
    }
    if (this.e.mat) {
      const mat = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.008, 1.9), M.mat()); mat.receiveShadow = true; this.o.mat = add(mat);
    }
  }

  /** Ποσό «κλεισίματος» δαχτύλων ανά χέρι */
  grip() { const e = this.e; return e.dumbbells || e.kettlebell || e.barbell || e.band || e.straps ? 1 : 0.25; }

  /** h: { L:{pos,across}, R:{pos,across}, feet:{L,R}, figure, yaw } σε world space */
  update(h) {
    const o = this.o, up = new THREE.Vector3(0, 1, 0);
    if (o.db) o.db.forEach((d, i) => { const s = i ? h.R : h.L; d.position.copy(s.pos); alignX(d, s.across); });
    const mid = h.L.pos.clone().add(h.R.pos).multiplyScalar(0.5), across = h.R.pos.clone().sub(h.L.pos);
    if (o.goblet) { o.goblet.position.copy(mid).addScaledVector(up, -0.03); alignX(o.goblet, up); }
    if (o.kb) { o.kb.position.copy(mid); o.kb.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(across.x, 0, across.z).normalize()); }
    if (o.bar) { o.bar.position.copy(mid); alignX(o.bar, across.lengthSq() > 1e-4 ? across : new THREE.Vector3(1, 0, 0)); }
    if (o.band) { stretch(o.band[0], h.feet.L, h.L.pos); stretch(o.band[1], h.feet.R, h.R.pos); }
    if (o.straps) {
      const anchor = h.figure.localToWorld(new THREE.Vector3(0, 2.45, 1.15));
      o.anchor.position.copy(anchor);
      [h.L, h.R].forEach((s, i) => { stretch(o.straps[i], anchor, s.pos); o.handles[i].position.copy(s.pos); o.handles[i].quaternion.setFromUnitVectors(up, s.across.clone().normalize()); });
    }
    if (o.mat) { o.mat.position.set(0, 0.004, 0); h.figure.updateMatrixWorld(); const q = new THREE.Quaternion().setFromAxisAngle(up, h.yaw); o.mat.quaternion.copy(q); o.mat.position.copy(new THREE.Vector3(0, 0, h.matZ || 0).applyQuaternion(q)).setY(0.004); }
  }

  dispose() { this.group.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); this.group.removeFromParent(); }
}
