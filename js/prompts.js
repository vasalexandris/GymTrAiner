import { state } from './store.js';
import { knownQueries } from './videolib.js';

export const SYSTEM = `Είσαι ο GymTrAIner: προσωπικός γυμναστής, διατροφολόγος, coach και σύμβουλος υποστήριξης σε μία φιλική, ενθαρρυντική και επαγγελματική προσωπικότητα.
Κανόνες:
- Απαντάς ΠΑΝΤΑ στα ελληνικά, σύντομα και πρακτικά, χωρίς υπερβολές και χωρίς ντροπιάσματα.
- Ασφάλεια πρώτα: σεβάσου τραυματισμούς, παθήσεις, φάρμακα και αλλεργίες. Μην κάνεις ιατρικές διαγνώσεις και μην αλλάζεις φαρμακευτική αγωγή· όπου χρειάζεται παραπέμπεις σε γιατρό/φυσιοθεραπευτή.
- Αν υπάρχουν σημάδια διατροφικής διαταραχής, πολύ χαμηλού βάρους ή επικίνδυνων στόχων (π.χ. ακραίος περιορισμός θερμίδων), προτείνεις επαγγελματική υποστήριξη.
- Μην προτείνεις κάτω από 1200 kcal/ημέρα (γυναίκες) ή 1500 kcal/ημέρα (άνδρες) χωρίς ιατρική παρακολούθηση.
- Προσάρμοσε στον εξοπλισμό που έχει ο χρήστης (π.χ. στο σπίτι χωρίς μηχανήματα).`;

/** Οδηγία να προτιμώνται ασκήσεις που έχουν ήδη επαληθευμένο βίντεο (μηδέν κόστος API) */
function libHint() {
  const k = knownQueries();
  return k.length ? `\n## Ασκήσεις με έτοιμο βίντεο επίδειξης (προτίμησέ τες όταν ταιριάζουν και χρησιμοποίησε ΑΚΡΙΒΩΣ το ίδιο youtube_query)\n${k.map(x => '- ' + x).join('\n')}\n` : '';
}

export function profileText() {
  const p = state.profile;
  if (!p) return 'Δεν έχει συμπληρωθεί προφίλ.';
  const lines = Object.entries(p).filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
  return lines.join('\n');
}

export function contextText({ includePlans = false } = {}) {
  const s = state;
  const parts = ['## Προφίλ χρήστη\n' + profileText()];
  const goals = s.goals.filter(g => s.selectedGoals.includes(g.id));
  if (goals.length) parts.push('## Στόχοι που επέλεξε\n' + goals.map(g => `- ${g.title} (${g.target || ''}, ${g.timeframe || ''})`).join('\n'));
  const w = s.logs.weights.slice(-8);
  if (w.length) parts.push('## Πρόσφατα βάρη\n' + w.map(x => `${x.date}: ${x.kg}kg`).join('\n'));
  const c = s.logs.checkins.slice(-3);
  if (c.length) parts.push('## Πρόσφατα check-in\n' + c.map(x => JSON.stringify(x)).join('\n'));
  const wo = s.logs.workouts.slice(-8);
  if (wo.length) parts.push('## Πρόσφατες προπονήσεις\n' + wo.map(x => `${x.date}: ${x.focus || x.day} (RPE ${x.rpe ?? '-'})`).join('\n'));
  if (s.medical.length) parts.push('## Ιατρικές εξετάσεις (περίληψη)\n' + s.medical.map(m =>
    `${m.date} ${m.name}: ${m.analysis.summary}\nΣυνέπειες προπόνησης: ${m.analysis.training_implications}\nΣυνέπειες διατροφής: ${m.analysis.nutrition_implications}`).join('\n'));
  if (s.avoid?.length) parts.push('## Ασκήσεις που ο χρήστης ΔΕΝ μπορεί ή δεν θέλει να κάνει (απόφυγε τες και παρόμοιες)\n' + s.avoid.slice(-15).map(a => `- ${a.name}${a.reason ? ' — ' + a.reason : ''}`).join('\n'));
  const fl = s.foodLog ? Object.entries(s.foodLog).filter(([, d]) => Object.keys(d.meals || {}).length).sort().slice(-4) : [];
  if (fl.length) parts.push('## Τι έφαγε πραγματικά (πρόσφατα)\n' + fl.map(([date, d]) => `${date}: ` + Object.values(d.meals || {}).map(x => x.status === 'ok' ? `✓ ${x.name}` : x.status === 'skip' ? `✗ παρέλειψε ${x.name}` : `✎ αντί για ${x.name}: ${x.text}${x.est ? ` (~${x.est.kcal} kcal)` : ''}`).join('; ')).join('\n'));
  if (includePlans && s.plan) parts.push('## Τρέχον πρόγραμμα γυμναστικής\n' + s.plan.days.map(d => `${d.day}: ${d.focus}`).join('; '));
  if (includePlans && s.meal) parts.push(`## Τρέχον πρόγραμμα διατροφής\n~${s.meal.daily_calories} kcal/ημέρα`);
  return parts.join('\n\n');
}

export const ASSESS_PROMPT = () => `Βάσει του προφίλ, κάνε εκτίμηση της τρέχουσας κατάστασης και πρότεινε 3-5 ρεαλιστικούς στόχους.
${contextText()}

Επίστρεψε ΜΟΝΟ JSON με αυτή τη μορφή:
{
 "assessment": {"bmi": number|null, "summary": "2-4 προτάσεις", "strengths": ["..."], "risks": ["... (τραυματισμοί, συνήθειες, ιατρικά)"], "starting_point": "αρχάριος|μέτριος|προχωρημένος"},
 "goals": [{"id":"g1","title":"...","why":"γιατί ταιριάζει σε αυτόν","target":"μετρήσιμος στόχος","timeframe":"π.χ. 12 εβδομάδες"}]
}`;

const MOTIONS = 'squat|lunge|hinge|pushup|plank|row|overhead_press|curl|lateral_raise|jumping_jack|high_knees|crunch|glute_bridge|calf_raise|incline_row|bird_dog|front_raise|generic';

export const EXERCISE_SHAPE = `{
     "name": "όνομα άσκησης στα ελληνικά", "sets": 3, "reps": "10-12 (ή π.χ. '30 δευτερόλεπτα' για ισομετρικές)", "rest_sec": 60,
     "muscles": "κύριοι μύες", "equipment": "ακριβώς ό,τι χρειάζεται: σώμα|αλτήρες|kettlebell|λάστιχο|ιμάντες TRX|μπάρα|στρώμα",
     "instructions": ["βήμα 1","βήμα 2","βήμα 3"], "common_mistakes": "...", "modification": "εναλλακτική αν υπάρχει πόνος/δυσκολία",
     "motion": "ΕΝΑ από: ${MOTIONS} — η κίνηση της βιβλιοθήκης που μοιάζει περισσότερο (για το animation του coach)", "tempo_sec": 3,
     "youtube_query": "όρος αναζήτησης YouTube για σωστή εκτέλεση (κατά προτίμηση αγγλικά, π.χ. 'goblet squat proper form')",
     "music": {"style": "είδος μουσικής από όσα προτιμά ο χρήστης (music_genres) με ένταση ανάλογη της άσκησης", "bpm": 130, "search_query": "όρος αναζήτησης YouTube για μουσική προπόνησης"}
   }`;

const PLAN_SHAPE = `{
 "summary": "σύντομη περιγραφή και λογική του προγράμματος",
 "progression": "πώς προοδεύει ο χρήστης τις επόμενες εβδομάδες",
 "safety_notes": ["..."],
 "days": [{
   "day": "Δευτέρα", "rest": false, "focus": "π.χ. Πλάτη & Δικέφαλοι", "duration_min": 45,
   "warmup": ["..."], "cooldown": ["..."],
   "exercises": [${EXERCISE_SHAPE}]
 }]
}
Συμπερίλαβε και τις 7 ημέρες· οι μέρες ανάπαυσης έχουν "rest": true, "exercises": [] και προαιρετικά ήπια δραστηριότητα στο "focus".`;

const MEAL_SHAPE = `{
 "summary": "...", "daily_calories": number, "macros": {"protein_g": n, "carbs_g": n, "fat_g": n}, "water_l": number,
 "days": [{"day":"Δευτέρα","meals":[{"type":"Πρωινό|Δεκατιανό|Μεσημεριανό|Απογευματινό|Βραδινό","name":"...","description":"υλικά & ποσότητες σε γραμμάρια","household":"οι ίδιες ποσότητες ΧΩΡΙΣ ζυγαριά, με καθημερινά μέτρα: π.χ. 1 φλιτζάνι τσαγιού, 2 κουταλιές της σούπας, 1 φέτα, όσο η παλάμη σου, μια γροθιά, ένα μέτριο φρούτο","kcal":n,"protein":n,"carbs":n,"fat":n}]}],
 "shopping_list": ["..."], "tips": ["..."]
}`;

export const PLAN_PROMPT = (extra = '') => `Φτιάξε εβδομαδιαίο πρόγραμμα γυμναστικής προσαρμοσμένο στον χρήστη. Σεβάσου τραυματισμούς/περιορισμούς (δώσε εναλλακτικές ασκήσεις), διαθέσιμες μέρες, διάρκεια και εξοπλισμό.
${contextText()}
${extra ? '\n## Επιπλέον οδηγίες/ενημέρωση\n' + extra : ''}${libHint()}

Επίστρεψε ΜΟΝΟ JSON:
${PLAN_SHAPE}`;

export const MEAL_PROMPT = (extra = '') => `Φτιάξε εβδομαδιαίο πρόγραμμα διατροφής (7 ημέρες) για τον χρήστη. Σεβάσου αλλεργίες, τύπο διατροφής, προτιμήσεις, χρόνο μαγειρέματος, budget και ιατρικά δεδομένα. Προτίμησε απλά, εύκολα πιάτα με υλικά διαθέσιμα στην Ελλάδα.
${contextText({ includePlans: true })}
${extra ? '\n## Επιπλέον οδηγίες/ενημέρωση\n' + extra : ''}

Επίστρεψε ΜΟΝΟ JSON:
${MEAL_SHAPE}`;

export const BOTH_PROMPT = (extra = '') => `Φτιάξε ΣΥΝΔΥΑΣΜΕΝΑ (1) εβδομαδιαίο πρόγραμμα γυμναστικής και (2) εβδομαδιαίο πρόγραμμα διατροφής για τον χρήστη, συμβατά μεταξύ τους (οι θερμίδες/πρωτεΐνη να ταιριάζουν στον όγκο προπόνησης και στους στόχους).
Γυμναστική: σεβάσου τραυματισμούς/περιορισμούς (δώσε εναλλακτικές), διαθέσιμες μέρες, διάρκεια, εξοπλισμό. Συμπερίλαβε και τις 7 ημέρες· οι μέρες ανάπαυσης έχουν "rest": true, "exercises": [].
Διατροφή: σεβάσου αλλεργίες, τύπο διατροφής, προτιμήσεις, χρόνο μαγειρέματος, budget και ιατρικά δεδομένα· απλά πιάτα με υλικά διαθέσιμα στην Ελλάδα, 7 ημέρες.
${contextText()}
${extra ? '\n## Επιπλέον οδηγίες/ενημέρωση\n' + extra : ''}${libHint()}

Επίστρεψε ΜΟΝΟ JSON της μορφής {"plan": <PLAN>, "meal": <MEAL>} όπου:
<PLAN> =
${PLAN_SHAPE}
<MEAL> =
${MEAL_SHAPE}`;

export const MEDICAL_PROMPT = `Ανάλυσε τις συνημμένες/επικολλημένες ιατρικές εξετάσεις ΜΟΝΟ για ενημερωτικούς σκοπούς στο πλαίσιο γυμναστικής και διατροφής (όχι διάγνωση).
Επίστρεψε ΜΟΝΟ JSON:
{
 "exam_type": "π.χ. Γενική αίματος",
 "summary": "κατανοητή περίληψη 2-5 προτάσεις",
 "markers": [{"name":"...","value":"...","unit":"...","reference":"...","status":"normal|low|high|unknown"}],
 "training_implications": "τι σημαίνει για την προπόνηση (ένταση, προσοχή, περιορισμοί)",
 "nutrition_implications": "τι σημαίνει για τη διατροφή",
 "see_doctor": "ποια ευρήματα αξίζει να συζητηθούν με γιατρό και πόσο επείγει, ή κενό"
}
Αν το αρχείο δεν είναι ιατρική εξέταση ή δεν διαβάζεται, εξήγησέ το στο "summary" και άφησε "markers" κενό.`;

export const REVIEW_PROMPT = () => `Κάνε αξιολόγηση προόδου του χρήστη βάσει των δεδομένων: τάση βάρους, check-in, προπονήσεις που ολοκληρώθηκαν, διάθεση/ενέργεια. Δώσε:
## Πώς πάμε
## Τι πήγε καλά
## Τι να βελτιώσουμε
## Προτεινόμενες προσαρμογές (προπόνηση/διατροφή)
## Στόχος για την επόμενη εβδομάδα
Να είσαι ειλικρινής αλλά ενθαρρυντικός.
${contextText({ includePlans: true })}`;

export const ALT_PROMPT = (ex, day, reason) => `Ο χρήστης δεν μπορεί ή δεν θέλει να κάνει την άσκηση «${ex.name}» (μύες: ${ex.muscles || '-'}, εξοπλισμός: ${ex.equipment || '-'}).
Λόγος: ${reason || 'δεν δηλώθηκε'}.
Πρότεινε ΜΙΑ εναλλακτική άσκηση που δουλεύει τους ίδιους μύες, δεν απαιτεί εξοπλισμό που δεν έχει, δεν έχει το πρόβλημα που περιγράφεται και ταιριάζει στον τραυματισμούς/περιορισμούς του. Κράτησε παρόμοια σετ/επαναλήψεις/ανάπαυση.
ΜΗΝ προτείνεις: ${[...(ex.tried || []), ex.name].join(', ')}.
Η μέρα είναι «${day.focus || day.day}» και περιλαμβάνει: ${(day.exercises || []).map(e => e.name).join(', ')}.
${contextText()}
${libHint()}
Επίστρεψε ΜΟΝΟ JSON με μία άσκηση σε αυτή τη μορφή:
${EXERCISE_SHAPE}`;

export const HOUSEHOLD_PROMPT = days => `Για κάθε γεύμα παρακάτω γράψε τις ποσότητες ΧΩΡΙΣ ζυγαριά, με καθημερινά μέτρα που καταλαβαίνει όλος ο κόσμος στην Ελλάδα
(φλιτζάνι τσαγιού, κουταλιά της σούπας/του γλυκού, φέτα, χούφτα, «όσο η παλάμη σου», «μια γροθιά», «μέγεθος τράπουλας», μέτριο φρούτο, μπολ).
Να είναι σύντομο και πρακτικό, μία γραμμή ανά γεύμα.
${days.map((d, i) => `Ημέρα ${i} (${d.day}):\n` + d.meals.map((m, j) => `  ${j}. ${m.name}: ${m.description}`).join('\n')).join('\n')}

Επίστρεψε ΜΟΝΟ JSON: {"days": [["γεύμα 0", "γεύμα 1", ...], ...]} με ίδια σειρά και πλήθος.`;

export const FOOD_ESTIMATE_PROMPT = (text, planned) => `Ο χρήστης αντί για το προγραμματισμένο γεύμα «${planned.name}» (${planned.kcal} kcal) έφαγε:
«${text}»
Εκτίμησε ρεαλιστικά θερμίδες και μακροθρεπτικά (αν οι ποσότητες είναι αόριστες, υπέθεσε συνηθισμένη ελληνική μερίδα και γράψε την υπόθεση στο note).
Επίστρεψε ΜΟΝΟ JSON: {"name":"σύντομη ονομασία","kcal":n,"protein":n,"carbs":n,"fat":n,"note":"σύντομο σχόλιο/υπόθεση, χωρίς ηθικολογία"}`;

export const ADJUST_DAY_PROMPT = (day, eaten, remaining, targets, wish) => `Πρόγραμμα διατροφής, ημέρα ${day.day}. Στόχος ημέρας: ${targets.daily_calories} kcal, πρωτεΐνη ${targets.macros?.protein_g}g, υδατάνθρακες ${targets.macros?.carbs_g}g, λιπαρά ${targets.macros?.fat_g}g.
Ήδη έφαγε (σύνολο ${eaten.kcal} kcal, Π ${eaten.protein}g, Υ ${eaten.carbs}g, Λ ${eaten.fat}g):
${eaten.lines.join('\n')}
Υπόλοιπα γεύματα της ημέρας (με index):
${remaining.map(r => `${r.index}. ${r.meal.type}: ${r.meal.name} (${r.meal.kcal} kcal)`).join('\n')}
${wish ? 'Επιθυμία χρήστη: ' + wish : ''}
Προσάρμοσε ΜΟΝΟ τα υπόλοιπα γεύματα ώστε το σύνολο της ημέρας να πλησιάσει τον στόχο (ποτέ κάτω από ασφαλές όριο, χωρίς «τιμωρία» για ό,τι έφαγε· αν ξεπέρασε πολύ τον στόχο, μοίρασε ήπια και πες ότι μία μέρα δεν χαλάει τίποτα).
Σεβάσου αλλεργίες/προτιμήσεις.
${contextText()}

Επίστρεψε ΜΟΝΟ JSON: {"meals":[{"index":n,"type":"...","name":"...","description":"υλικά & γραμμάρια","household":"ποσότητες χωρίς ζυγαριά","kcal":n,"protein":n,"carbs":n,"fat":n}],"note":"1-2 προτάσεις ενθάρρυνσης/εξήγησης"}`;
