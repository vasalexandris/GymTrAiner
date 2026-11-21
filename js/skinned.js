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
