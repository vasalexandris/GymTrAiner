import { withLoading, toast } from './ui.js';
import { state, save, today } from './store.js';
import { geminiJSON, textPart } from './api.js';
import { SYSTEM, BOTH_PROMPT } from './prompts.js';

/** Πρόγραμμα γυμναστικής + διατροφής με ΕΝΑ αίτημα (εξοικονόμηση quota). */
export async function generateBoth(btn, extra = '') {
  return withLoading(btn, async () => {
    const r = await geminiJSON({ system: SYSTEM, contents: [textPart(BOTH_PROMPT(extra))], temperature: 0.6, maxTokens: 32768 });
    if (!Array.isArray(r.plan?.days) || !Array.isArray(r.meal?.days)) throw new Error('Μη πλήρης απάντηση από το AI, δοκίμασε ξανά.');
    r.plan.created = r.meal.created = today();
    state.plan = r.plan; state.meal = r.meal; save();
    toast('Τα προγράμματα γυμναστικής και διατροφής είναι έτοιμα!', 'success');
    return true;
  });
}
