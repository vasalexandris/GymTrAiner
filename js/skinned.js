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
  open:       [0.06, 0.08, 0.05, 0.05, 0.00],
  floor:      [-0.06, 0.03, 0.03, 0.02, -0.14], // παλάμες ανοιχτές & επίπεδες στο έδαφος
  relaxed:    [0.24, 0.34, 0.22, 0.16, 0.12],
  chair:      [0.64, 0.80, 0.48, 0.20, 0.10],   // δάχτυλα αγκαλιάζουν την άκρη της καρέκλας
  bar:        [1.18, 1.48, 1.02, 0.62, 0.58],   // σφιχτή λαβή μπάρας με αντίχειρα από πάνω
  dumbbell:   [1.15, 1.44, 0.98, 0.58, 0.52],
  kettlebell: [1.05, 1.32, 0.88, 0.48, 0.44],
  trx:        [1.12, 1.40, 0.95, 0.55, 0.50],
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
        const oppAx = new THREE.Vector3(0, side === 'Left' ? -1 : 1, 0).applyQuaternion(invW);
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

    // 6. Ρεαλιστική άρθρωση δαχτύλων (8 προφίλ ανά εξοπλισμό / έδαφος)
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

    this.hair?.update(dt);
    return resolvedMeta;
  }
}

