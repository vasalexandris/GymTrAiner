// Ημέρες της εβδομάδας ↔ ημερομηνίες (Δευτέρα–Κυριακή της τρέχουσας εβδομάδας)
const WEEK = ['δευτ', 'τριτ', 'τεταρ', 'πεμπ', 'παρασ', 'σαββ', 'κυρια'];
const plain = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const weekdayIndex = name => WEEK.findIndex(w => plain(name).startsWith(w));
export const todayWeekday = () => (new Date().getDay() + 6) % 7;
export const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export function dateOf(dayName) {
  const wi = weekdayIndex(dayName); if (wi < 0) return null;
  const now = new Date(), d = new Date(now); d.setDate(now.getDate() - todayWeekday() + wi);
  return iso(d);
}
export const shortDate = date => new Date(date).toLocaleDateString('el-GR', { day: 'numeric', month: 'short' });
