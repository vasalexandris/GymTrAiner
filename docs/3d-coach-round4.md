# 3D Coach — 4ος γύρος: prompt για την άλλη AI

Δώσε στην άλλη AI: (1) το prompt παρακάτω, (2) το `docs/3d-coach-code-bundle.md` (τελευταία έκδοση, περιέχει και το `js/hair.js` και το `gallery.html`).
Όταν επιστρέψει κώδικα, φέρ' τον εδώ: θα τον ελέγξω με το gallery σε όλες τις κινήσεις πριν ανέβει.

**Στόχος του γύρου:** να ετοιμάσουμε τον «κινητήρα» για επαγγελματικό ρεαλιστικό μοντέλο και πραγματικές κινήσεις (motion capture),
ώστε όταν τα αποκτήσουμε να μπουν χωρίς ξαναγράψιμο, και να κλείσουν οι εκκρεμότητες του 3ου γύρου.

---

## Prompt

```
You are continuing work on GymTrAIner's 3D coach (round 4). The attached bundle is the CURRENT code — it already
contains your round-3 work plus my review fixes. Start from it, not from your own copy. gallery.html is the test page
(`python3 -m http.server` in the repo root → http://localhost:8000/gallery.html; supports ?m=, ?ex=, ?eq=, ?hair=, ?page=).

CONTEXT FOR THIS ROUND
We will soon replace the stylized Mixamo "Michelle" with a professional realistic human (e.g. Character Creator /
scanned person, exported as glTF with a Mixamo-compatible or standard humanoid skeleton) and replace hand-keyed poses
with real motion-capture clips of exercises (Mixamo/ActorCore clips, or AI video mocap of our own trainer). The engine
must be ready for that: the same app code must work with (a) procedural motions (today) and (b) clips (tomorrow),
exercise by exercise, with automatic fallback.

MY REVIEW FIXES IN THE CURRENT CODE — KEEP THEM (do not regress):
- hair.js: warmer tint/rougher/less env reflection (hair looked ash-grey); ponytail/braid pitch range down to -1.4 rad
  with sideways spill when face-down; fixed 1/60 s sub-stepping of the spring chain (stable at 10 fps).
- Everything listed as "KEEP" in round 3 (plank/push-up hip-joint fix, horizSq rule, real-shoulder arm IK,
  TRX _junc, back-squat bar, deaccent() matching with accent-free RULES).
- Public API and exports: Avatar {constructor(el, look, {customModel,onError,quality,env,hair}), loaded, setMotion,
  setEquipment, setHair, ready, idle, pause, talkFor, cancelPending, cycle(dur, alt) → resolves after EXACTLY one rep,
  hold, debug, dispose}; avatar.js {Avatar, webglAvailable, LOOKS, defaultQuality}; motions.js {MOTIONS, MOTION_KEYS,
  inferMotion, parseReps, mirror, deaccent}; equipment.js {Equipment, equipmentFor}; skinned.js {loadCoachModel}.

TASK A — Animation-clip pipeline (most important)
1. Clip library: a JSON manifest `data/motion-clips.json` mapping motion keys → clip entries:
   { "squat": { "src": "assets/anim/air_squat.glb", "clip": "Air Squat", "repStart": 0.40, "repEnd": 2.10,
     "loopRegion": true, "mirrorClip": "assets/anim/air_squat_mirror.glb" | null, "rootMotion": "inPlace",
     "contacts": { "feet": "planted" }, "props": { "R": "dumbbell" } } }
   Start empty (no assets yet) but ship one working example using a clip you can generate procedurally IN CODE from
   the existing keyframes (bake squat to an AnimationClip) so the path is tested end-to-end.
2. Retargeting of clips: clips authored on a standard Mixamo skeleton must play on any loaded Mixamo-compatible model
   (bone-name normalization, rest-pose difference compensation via rest-basis like SkinnedCoach already does, hips
   height scaling by leg length). Also support the common alternative naming (Character Creator / Unreal / VRM
   humanoid: pelvis/spine_01/upperarm_l…, Hips/Spine/LeftUpperArm…) through a bone-name map.
3. Rep synchronisation: cycle(dur, alt) plays exactly the [repStart, repEnd] segment time-scaled to `dur` and resolves
   at its end; hold(sec) holds a chosen frame (e.g. plank) with breathing; alt=true uses mirrorClip or a runtime
   mirrored retarget. Cross-fade (0.15–0.25 s) between idle/ready/rep.
4. Post-clip corrections: keep our IK layer AFTER the clip (foot planting on the floor/step, hands on bar/handles/
   floor, equipment attachment to hand bones, ground contact), so clips with slightly different proportions still
   touch correctly.
5. Fallback: if a motion has no clip or the clip fails to load, use the current procedural motion — silently.
6. gallery.html: show which source is used per cell ("clip" / "procedural").

TASK B — Professional model readiness
1. Loader: support compressed glTF — Draco, Meshopt and KTX2 textures. The decoders are part of three r170
   examples/jsm/libs (draco/gltf, basis, meshopt_decoder.module.js): vendor them under js/vendor/jsm/libs and wire
   DRACOLoader / KTX2Loader / MeshoptDecoder in skinned.js. No CDN.
2. Generic humanoid detection: work with Mixamo names AND the alternatives of Task A2; report clearly (Greek message)
   what is missing if the skeleton is not usable.
3. Realistic material handling for any loaded model: skin (approximate subsurface: MeshPhysicalMaterial sheen /
   thickness / attenuation tweaks or a light wrap-lighting term), eyes (clearcoat, no env over-brightening), hair
   cards (alpha-to-coverage when MSAA is on, otherwise alphaTest), cloth (sheen). Detect material roles by name
   heuristics (skin/body/head, eye/cornea, hair/brow/lash, cloth/shirt/pants/shoes) with safe defaults.
4. Performance guard: on load, report triangles, texture memory, bone count to the console and to gallery; if the
   model is too heavy for 'normal' quality (e.g. > 80k tris or > 4 textures above 2K), downscale textures at load
   and disable GTAO automatically.
5. Facial: if the model has blendshapes (ARKit / viseme names like jawOpen, mouthOpen, viseme_aa, eyeBlinkLeft),
   drive them from talkFor() (simple jaw/viseme cycling) and blinking; otherwise keep the current fallback.

TASK C — Leftovers from round 3
1. Ponytail/braid in mountain_climber stays horizontal above the back — it should hang towards the floor along the
   neck/shoulder without entering the head/neck. Consider a short collision capsule for head+neck+upper back and
   solving the chain against it instead of only pitch limits.
2. Hair cards look flat in close-ups: add 2–3 layered card shells with slight offsets/twist, root darkening and tip
   transparency, so volume reads in profile view.
3. step_calf_raise phase 1: remove the remaining 3–4 px gap between toes and the step top.
4. Look again for paradoxes with gallery ?ex= using typical Greek exercise names from home/gym workout plans
   (at least 40 names). Fix wrong motion choices, wrong/missing props, props floating or intersecting.

TASK D — Self-check before handing back
- Render every motion at phase 0 and 1 (all gallery pages) + the hair styles (front/side/back close-up) + at least
  10 motions in REAL TIME (not only debug poses) for 6 s each — the review checks real-time playback, where spring
  physics, IK and ground contact can behave differently from static poses.
- In the changelog list: every changed/new file, each motion you touched with the gallery query used, and anything
  you could NOT finish.

CONSTRAINTS
- Plain ES modules, three.js r170 + vendored examples/jsm only, no network, no bundler.
- Greek UI strings and comments. Complete replacement files + changelog + any new files.
- Keep 'normal' quality fast enough for mid-range phones.
```
