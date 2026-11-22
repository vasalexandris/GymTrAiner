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
