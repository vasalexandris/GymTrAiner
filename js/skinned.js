// Ρεαλιστικός coach: φορτώνει rigged μοντέλο (σκελετός Mixamo) και του μεταφέρει (retarget)
// τις κινήσεις του αόρατου «οδηγού» σκελετού του Avatar.
import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/jsm/loaders/GLTFLoader.js';

const norm = n => n.replace(/^mixamorig[:_]?/i, '');
const V = () => new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];

function basis(dir, sec, out) {
  const e1 = dir.clone().normalize();
  const e2 = sec.clone().addScaledVector(e1, -sec.dot(e1));
  if (e2.lengthSq() < 1e-8) e2.copy(Math.abs(e1.y) < 0.9 ? Y : Z).addScaledVector(e1, -(Math.abs(e1.y) < 0.9 ? e1.y : e1.z));
  e2.normalize();
  const e3 = new THREE.Vector3().crossVectors(e1, e2);
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(e1, e2, e3));
}

export async function loadCoachModel(src) {
  const loader = new GLTFLoader();
  const gltf = typeof src === 'string' ? await loader.loadAsync(src) : await loader.parseAsync(src, '');
  return new SkinnedCoach(gltf.scene);
}

export class SkinnedCoach {
  constructor(root) {
    this.root = root; this.b = {};
    root.traverse(o => {
      if (o.isBone) this.b[norm(o.name)] = o;
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; if (o.material) { o.material.envMapIntensity = 0.9; } }
    });
    const need = ['Hips', 'Spine', 'Spine2', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];
    const miss = need.filter(n => !this.b[n]);
    if (miss.length) throw new Error('Το μοντέλο δεν έχει σκελετό τύπου Mixamo (λείπουν: ' + miss.join(', ') + ')');
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    // κλίμακα ώστε ύψος ≈ 1.70m, πατούσες στο 0
    const s = 1.7 / Math.max(box.max.y - box.min.y, 0.01);
    root.scale.multiplyScalar(s); root.updateMatrixWorld(true);
    this.rest = {};
    for (const [n, bone] of Object.entries(this.b)) this.rest[n] = { local: bone.quaternion.clone(), world: bone.getWorldQuaternion(new THREE.Quaternion()), pos: bone.getWorldPosition(V()) };
    const p = n => this.rest[n]?.pos;
    // κόκαλα που οδηγούνται: [όνομα, παιδί για κατεύθυνση, άξονας «μπροστά» σε rest]
    const ch = (a, b) => (p(b) ? p(b).clone().sub(p(a)) : null);
    this.chain = [
      ['Hips', 'Spine', Z], ['Spine', this.b.Spine1 ? 'Spine1' : 'Spine2', Z], ...(this.b.Spine1 ? [['Spine1', 'Spine2', Z]] : []), ['Spine2', 'Neck', Z], ['Neck', 'Head', Z],
      ['Head', this.b.HeadTop_End ? 'HeadTop_End' : null, Z],
      ['LeftArm', 'LeftForeArm', Z], ['LeftForeArm', 'LeftHand', Z], ['RightArm', 'RightForeArm', Z], ['RightForeArm', 'RightHand', Z],
      ['LeftUpLeg', 'LeftLeg', Z], ['LeftLeg', 'LeftFoot', Z], ['RightUpLeg', 'RightLeg', Z], ['RightLeg', 'RightFoot', Z],
      ...(this.b.LeftToeBase ? [['LeftFoot', 'LeftToeBase', Y], ['RightFoot', 'RightToeBase', Y]] : []),
    ].map(([n, c, sec]) => {
      const dir = c ? ch(n, c) : Y.clone();
      return { n, restBasis: basis(dir, sec, new THREE.Quaternion()).invert() };
    });
    this.hipsRestY = p('Hips').y;
    // δάχτυλα: άξονας κάμψης στο τοπικό σύστημα κάθε φάλαγγας
    this.fingers = [];
    for (const side of ['Left', 'Right']) {
      const i1 = p(side + 'HandIndex1'), p1 = p(side + 'HandPinky1');
      if (!i1 || !p1) continue;
      const across = (side === 'Left' ? p1.clone().sub(i1) : i1.clone().sub(p1)).normalize();
      // αν το χέρι «κοιτάει» αλλού, επιβεβαιώνουμε φορά με την παλάμη: κάμψη προς -Y σε T-pose
      for (const f of FINGERS) for (let k = 1; k <= 3; k++) {
        const n = `${side}Hand${f}${k}`; if (!this.b[n]) continue;
        const ax = across.clone().applyQuaternion(this.rest[n].world.clone().invert());
        this.fingers.push({ bone: this.b[n], local: this.rest[n].local, ax, side, k });
      }
      for (let k = 1; k <= 3; k++) {
        const n = `${side}HandThumb${k}`; if (!this.b[n]) continue;
        const ax = new THREE.Vector3(0, 0, side === 'Left' ? -1 : 1).applyQuaternion(this.rest[n].world.clone().invert());
        this.fingers.push({ bone: this.b[n], local: this.rest[n].local, ax, side, k, thumb: true });
      }
    }
    this.grip = { Left: 0.25, Right: 0.25 }; this.gripCur = { Left: 0.25, Right: 0.25 };
    this.offY = 0; this.tq = new THREE.Quaternion(); this.tq2 = new THREE.Quaternion(); this.tv = V(); this.tv2 = V();
  }

  setGrip(left, right) { this.grip.Left = left; this.grip.Right = right; }

  worldPos(name, out = V()) { return this.b[name].getWorldPosition(out); }

  /** targets: { name: {dir, sec} } σε world space · hipsPos: world */
  drive(targets, hipsPos, dt, { air = 0 } = {}) {
    const q = this.tq, pq = this.tq2;
    for (const c of this.chain) {
      const t = targets[c.n]; const bone = this.b[c.n]; if (!t || !bone) continue;
      basis(t.dir, t.sec, q).multiply(c.restBasis).multiply(this.rest[c.n].world); // νέα world rotation
      bone.parent.getWorldQuaternion(pq);
      bone.quaternion.copy(pq.invert().multiply(q));
      if (c.n === 'Hips') {
        const lp = this.tv.copy(hipsPos); lp.y += this.offY; bone.parent.worldToLocal(lp); bone.position.copy(lp);
      }
      bone.updateMatrixWorld(true);
    }
    // δάχτυλα (κράτημα αντικειμένων)
    const kf = 1 - Math.exp(-dt * 10);
    for (const s of ['Left', 'Right']) this.gripCur[s] += (this.grip[s] - this.gripCur[s]) * kf;
    for (const f of this.fingers) {
      const g = this.gripCur[f.side] * (f.thumb ? 0.55 : (f.k === 1 ? 1.15 : 1.35));
      f.bone.quaternion.copy(f.local).multiply(this.tq.setFromAxisAngle(f.ax, g));
    }
    this.root.updateMatrixWorld(true);
    // επαφή με το έδαφος: το χαμηλότερο σημείο επαφής ακουμπά στο 0
    const C = [['LeftToeBase', 0.025], ['RightToeBase', 0.025], ['LeftFoot', 0.075], ['RightFoot', 0.075], ['LeftHand', 0.035], ['RightHand', 0.035],
      ['LeftLeg', 0.06], ['RightLeg', 0.06], ['Hips', 0.11], ['Spine2', 0.12], ['Head', 0.11], ['LeftForeArm', 0.045], ['RightForeArm', 0.045]];
    let min = Infinity;
    for (const [n, r] of C) { if (!this.b[n]) continue; const y = this.worldPos(n, this.tv2).y - r; if (y < min) min = y; }
    const want = this.offY - min + air;
    this.offY += (want - this.offY) * (1 - Math.exp(-dt * 18));
  }
}
