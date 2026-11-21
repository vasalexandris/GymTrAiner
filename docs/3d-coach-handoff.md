# 3D Coach: πακέτο για άλλη AI

Δώσε στην άλλη AI:
1. το **prompt** παρακάτω (στα αγγλικά, γιατί έτσι αποδίδουν καλύτερα τα περισσότερα μοντέλα) και
2. το αρχείο **`docs/3d-coach-code-bundle.md`** (όλος ο κώδικας του 3D coach σε ένα αρχείο, δημιουργείται με `python3 tools/bundle-3d.py`).

Όταν σου επιστρέψει κώδικα, φέρ' τον εδώ για ενσωμάτωση, δοκιμή και βελτίωση.

---

## Prompt

```
You are a senior real-time 3D / character-animation engineer (three.js, skeletal animation, IK, procedural motion).

CONTEXT
I am building GymTrAIner, a static web app (GitHub Pages, no build step, plain ES modules, three.js r170 vendored
as ./js/vendor/three.module.min.js plus examples/jsm loaders/postprocessing). An AI personal trainer creates workout
plans; during a workout a 3D coach demonstrates each exercise while a voice coach counts reps. The attached bundle
contains the complete 3D coach code:

- js/ik.js         – analytic two-bone IK, joint limits, keyframe curves.
- js/motions.js    – motion library: each exercise = poses A and B (joint angles in radians for a simple FK "proxy"
                     skeleton), tempo, easing profile [toB, hold, back], camera framing, flags (floor, alt, palm, ...).
                     Also exercise-name → motion inference and reps parsing.
- js/avatar.js     – Avatar class: scene, lighting (RoomEnvironment PMREM, ACES, soft shadows, GTAO post-processing),
                     studio cyclorama, invisible FK proxy rig driven by the motion library, camera auto-framing,
                     equipment-aware arm poses, and post(): builds world-space bone targets from the proxy.
- js/skinned.js    – SkinnedCoach: loads any Mixamo-rigged .glb and retargets the proxy onto it with a two-vector
                     (direction + secondary axis) basis per bone, finger grip, and ground-contact correction.
- js/equipment.js  – PBR dumbbells, kettlebell, barbell, bands, TRX straps, mat + detection from exercise text.

The default character is Mixamo "Michelle" (assets/models/Michelle.glb, standard mixamorig skeleton, T-pose bind).
Users may upload any other Mixamo .glb.

PUBLIC API THAT MUST NOT BREAK (used by the workout session code):
  new Avatar(containerEl, look = 'real'|'male'|'female'|'custom', { customModel, onError, quality:'high'|'normal', env:'studio'|'home' })
  avatar.loaded (Promise<boolean>)
  avatar.setMotion(key) · avatar.setEquipment({dumbbells,kettlebell,barbell,band,straps,mat,goblet})
  avatar.ready() · avatar.idle() · avatar.pause(bool) · avatar.talkFor(ms) · avatar.cancelPending()
  await avatar.cycle(durationSec, alt) → resolves true after exactly one repetition (used to sync the voice count)
  await avatar.hold(seconds) · avatar.debug(key, u, alt, equip) · avatar.dispose()
  Motion keys: squat, lunge, hinge, row, overhead_press, curl, lateral_raise, jumping_jack, high_knees, calf_raise,
  pushup, plank, crunch, glute_bridge, incline_row, bird_dog, generic  (you may add more; keep these).

GOAL
Make the coach look and move like a real, professionally animated human trainer (think AAA game quality within
browser limits), with biomechanically correct exercise technique. Users must never see impossible poses,
floating/sliding hands or feet, or interpenetration with equipment.

WHAT I WANT YOU TO IMPROVE (prioritise in this order):
1. Biomechanics & contacts: analytic two-bone IK for arms and legs with pole vectors (knees track over toes,
   elbows at natural angles); planted feet that never slide; hands exactly on the floor/handles; humeral and
   forearm twist (supination/pronation) per exercise; joint limits; correct spine flexion/extension.
2. Motion quality: replace or augment pose-to-pose interpolation with keyframed multi-phase curves per exercise
   (e.g. squat: brace → descent → bottom pause → drive up, hips and knees moving together), anticipation,
   follow-through, subtle weight shift and breathing, natural head/gaze, slight rep-to-rep variation.
   The duration of one rep must stay exactly `durationSec` (voice sync).
3. More exercises with correct technique: mountain climber, burpee, dead bug, superman, side plank, Russian twist,
   reverse lunge, step-up, wall sit, hip thrust, deadlift (barbell), back squat with bar on the back,
   bent-over row (barbell), triceps dip on chair, band pull-apart, TRX squat/chest press. Map names in Greek and
   English in the inference rules.
4. Equipment: hands must hold handles convincingly (finger IK/grip), bands should stretch with slight curvature,
   straps anchored above/front, bar on upper back for back squats.
5. Visual realism (keep 60fps on desktop, ≥30fps on mid-range phones): better skin/cloth shading where
   possible (e.g. MeshPhysicalMaterial sheen/clearcoat tweaks applied to loaded materials), contact shadows,
   tasteful studio lighting. Keep the 'normal' quality path light for phones.

CONSTRAINTS
- Plain ES modules, no bundler, no npm at runtime, only three.js r170 + its examples/jsm (vendored).
- Keep all comments/UI strings in Greek as they are; new user-facing strings in Greek.
- Return COMPLETE replacement files (not fragments) for every file you change, plus a short changelog and any
  new files. Explain the math you used for IK and retargeting in comments.
- Do not change the public API above. Do not add network dependencies.
```

---

## Αρχιτεκτονική με λίγα λόγια
- **Proxy σκελετός (FK):** οι κινήσεις ορίζονται ως γωνίες σε απλό αόρατο σκελετό (`motions.js` → `avatar.js`).
- **Retargeting:** για κάθε κόκαλο του Mixamo υπολογίζεται στόχος κατεύθυνσης + δευτερεύων άξονας από τον proxy, και η περιστροφή προκύπτει από βάσεις (rest basis → target basis) (`skinned.js`).
- **Επαφή με το έδαφος:** το χαμηλότερο σημείο επαφής (πέλματα, χέρια, γόνατα, πλάτη) ακουμπά στο 0.
- **Συγχρονισμός φωνής:** το `cycle(dur)` κρατάει ακριβώς `dur` δευτερόλεπτα ανά επανάληψη· η φωνή μετράει όταν επιλύεται.
