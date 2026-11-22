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
