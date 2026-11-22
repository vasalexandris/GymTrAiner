# 3D Coach — 3ος γύρος: prompt για την άλλη AI

Δώσε στην άλλη AI: (1) το prompt παρακάτω, (2) το `docs/3d-coach-code-bundle.md` (τελευταία έκδοση), (3) το `gallery.html`.
Όταν επιστρέψει κώδικα, φέρ' τον εδώ: θα τον ελέγξω με το gallery σε όλες τις κινήσεις πριν ανέβει.

---

## Prompt

```
You are continuing work on GymTrAIner's 3D coach (round 3). The attached bundle is the CURRENT code
(it already contains your round-2 work plus my fixes — start from it, do not start from your old copy).
Also attached: gallery.html, a test page that renders any motion at phase 0 and 1, or takes real exercise
names ("name | equipment" per line) and shows which motion + equipment the app would pick.
Run it locally: `python3 -m http.server` in the repo root → http://localhost:8000/gallery.html

KEEP (do not regress — I review every round with the gallery):
- Public API of Avatar (constructor, loaded, setMotion, setEquipment, ready, idle, pause, talkFor, cancelPending,
  cycle(dur, alt) resolving after exactly one rep, hold, debug, dispose) and exports used by the app:
  avatar.js {Avatar, webglAvailable, LOOKS, defaultQuality}, motions.js {MOTIONS, MOTION_KEYS, inferMotion,
  parseReps, mirror, deaccent}, equipment.js {Equipment, equipmentFor}, skinned.js {loadCoachModel}.
- Straight-body plank/push-up: legs are measured from the hip JOINT (UpLeg), not the Hips bone (the ~10cm
  offset made the knees collapse to the mat); the pelvis-drop rule for pinned feet only applies to mostly
  vertical legs. Push-up bottom must stay deep (chest near the mat), plank straight shoulders→heels.
- Arm IK on the real model's current shoulder/neck positions; TRX junction vector must not alias the scratch
  vector used by stretchSegment; back-squat bar on the upper back.
- Accent-insensitive Greek matching: all name/equipment text goes through deaccent() and rule regexes are
  written WITHOUT Greek accents (Greek stress moves between word forms: δικέφαλος → δικεφάλων).

TASK A — Hairstyle (the user wants a different hairstyle for the coach)
The default model is Mixamo "Michelle" (assets/models/Michelle.glb): ONE skinned mesh, ONE material, a 4-texture
atlas; the hair (big puffs/buns) is part of that same mesh. Implement an option `hair` in Avatar opts and LOOKS:
'original' | 'ponytail' | 'bun' | 'braid' | 'short'.
1. Remove the original hair geometry at load time without touching face, ears, headphones or neck: classify
   triangles whose vertices are skinned (≈100%) to the Head bone AND lie outside a fitted skull ellipsoid
   (and/or in the hair UV island of the atlas — inspect the texture). Build a new index buffer without them.
   If you cannot isolate hair cleanly, say so and keep 'original'.
2. Build the new hairstyle as real geometry attached to the Head bone (sculpted cap that follows the skull +
   strands/cards; ponytail/braid with a short 2–3 segment spring chain for secondary motion), with a
   procedurally generated strand texture (CanvasTexture: anisotropic highlights, alpha-tested tips) and
   MeshPhysicalMaterial sheen. It must not intersect the headphones or clip through the skull when the
   head turns. Provide front, side, back views in your self-check.

TASK B — Equipment must be anchored where it is in reality (the user's main complaint)
Example: "Κωπηλατική με λάστιχο σε σταθερή όρθια θέση" (standing band row) currently shows a BENT-OVER row
with the band starting from the FEET. In reality the band is anchored at chest height in front (door anchor /
pole) and the coach stands upright pulling horizontally.
Implement a band anchor system: band.anchor = 'feet' | 'front_chest' | 'front_high' | 'front_low' |
'behind_chest' | 'side_waist' | 'hands', with a visible anchor prop (door anchor in a door frame or a vertical
pole / wall bar) placed at the correct height/distance, band stretched with slight curvature, tension
increasing with the pull. Choose the anchor from the exercise (name + equipment), e.g.:
- standing band row, band chest-height row → front_chest (new motion: standing_row — upright torso, arms
  pull horizontally, elbows past the torso, scapulae retract)
- face pull → front_high (new motion face_pull: elbows high, hands to the face, external rotation)
- band lat pulldown → front_high or overhead (new motion lat_pulldown, kneeling or standing)
- band chest press (standing) → behind_chest (new motion band_chest_press)
- Pallof press → side_waist (new motion pallof_press: anti-rotation, press straight out from the sternum)
- woodchop → side high→low diagonal (new motion woodchop with trunk rotation)
- band curls, lateral raises, overhead press, squats with band → feet (current behaviour)
- band pull-apart → hands (current behaviour)

TASK C — Exercise variants that currently look wrong (verify each in gallery with the exact names below)
| Exercise name (as the app receives it)            | Now                         | Must be |
|---------------------------------------------------|-----------------------------|---------|
| Κάμψεις στα γόνατα                                | full push-up                | knee push-up: knees on mat, feet up |
| Κάμψεις σε τοίχο (wall push-up)                   | push-up on the floor + mat  | standing, hands on a wall, body inclined |
| Incline push-up σε καρέκλα                        | floor push-up               | hands on chair/bench edge |
| Πλάγια σανίδα στα γόνατα                          | full side plank             | knee side plank |
| Plank με επαφή ώμων (shoulder taps)               | static plank                | alternate hand taps opposite shoulder, hips stable |
| Ανυψώσεις ποδιών (leg raises)                     | crunch                      | supine straight-leg raises, lower back on mat |
| Ποδήλατο κοιλιακών (bicycle crunch)               | crunch                      | alternating elbow-to-knee with leg cycling |
| Γάτα-Αγελάδα (cat-cow)                            | generic standing ON a mat   | quadruped spinal flexion/extension |
| Διάταση παιδιού (child pose)                      | generic standing            | kneeling, hips to heels, arms forward |
| Καθίσματα σε καρέκλα (box squat)                  | squat, no chair             | squat to a visible chair behind |
| Bulgarian split squat                             | lunge, no bench             | rear foot on bench behind, front leg squat |
| Πλάγιες εκπτώσεις (side lunges)                   | forward lunge               | lateral lunge |
| Πιέσεις ώμων με αλτήρες καθιστός                  | standing press              | seated on a chair/bench |
| Bench press με αλτήρες                            | generic standing            | floor press on mat or bench press on bench |
| Τricep kickbacks / Υπερέκταση τρικεφάλων...       | generic                     | correct triceps motions with dumbbells |
| Έλξεις σε μονόζυγο                                | generic, no bar             | pull-up on a doorway bar |
| Κωπηλατική με έναν αλτήρα                         | two-arm bent-over row       | one-arm row, other hand/knee on bench |
| Squat jumps / Skater jumps                        | squat / generic             | jumps with flight phase and soft landing |
| Ανυψώσεις γάμπας σε σκαλί                         | calf raise on floor         | on a step edge, heels below step level |
| Περπάτημα επί τόπου / Σχοινάκι / Farmer walk      | generic                     | march in place / jump rope with rope prop / walk in place holding dumbbells |
| TRX Y-raise                                       | generic standing w/ straps  | inclined back, arms to a Y |
Also look for more paradoxes of the same kind yourself (equipment floating or in the wrong place, props missing,
standing motions on a mat, floor motions without a mat, hands not on handles, interpenetration).
Every new motion needs Greek + English name patterns (without accents) in RULES, a label in Greek, tempo,
and correct props in equipmentFor.

TASK D — Self-check before you hand back
For every motion (old and new) render gallery phase 0 and 1, and the exercise-name list from Task C; fix what is
wrong. In your changelog list each motion and the gallery query you used to check it.

CONSTRAINTS
- Plain ES modules, three.js r170 + vendored examples/jsm only, no network, no bundler.
- Greek UI strings and comments. Complete replacement files + changelog + any new files.
- Keep 'normal' quality fast enough for mid-range phones.
```
