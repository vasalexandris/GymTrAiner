// Αποθήκευση δικού σου 3D μοντέλου coach (.glb) στο IndexedDB του browser (χωράει πολλά MB).
const DB = 'gymtrainer-models', STORE = 'm', KEY = 'custom';

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function run(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, mode), req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { res(req?.result); db.close(); }; tx.onerror = () => { rej(tx.error); db.close(); };
  });
}
export const getCustomModel = () => run('readonly', s => s.get(KEY)).catch(() => null);
export const saveCustomModel = (buf, name) => run('readwrite', s => s.put({ buf, name, date: new Date().toISOString().slice(0, 10) }, KEY));
export const deleteCustomModel = () => run('readwrite', s => s.delete(KEY));
