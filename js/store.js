// Data layer: Firebase Firestore when configured, otherwise a local demo store.
import { firebaseConfig } from "../firebase-config.js";

const FB = "https://www.gstatic.com/firebasejs/10.12.2/";
const listeners = new Set();
let impl = null;

export const state = { mode: "loading", trip: null, scores: {}, log: [], online: navigator.onLine, pending: false, error: null, ready: false };
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = () => listeners.forEach(fn => fn(state));
addEventListener("online", () => { state.online = true; emit(); });
addEventListener("offline", () => { state.online = false; emit(); });

export async function start(tripId, seedFn) {
  impl = firebaseConfig && firebaseConfig.apiKey ? await firebaseStore(tripId) : demoStore(tripId);
  state.mode = impl.mode;
  impl.watch(seedFn);
}
export const saveTrip = trip => impl.saveTrip(trip);
export const setScore = (roundId, key, n, value) => impl.setScore(roundId, key, n, value);
export const addLog = entry => impl.addLog(entry);
export const resetDemo = () => impl.reset && impl.reset();

// ---------------- Firebase ----------------
async function firebaseStore(tripId) {
  const [{ initializeApp }, fs, au] = await Promise.all([
    import(FB + "firebase-app.js"), import(FB + "firebase-firestore.js"), import(FB + "firebase-auth.js"),
  ]);
  const app = initializeApp(firebaseConfig);
  let db;
  try {
    db = fs.initializeFirestore(app, { ignoreUndefinedProperties: true, localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch (e) { db = fs.getFirestore(app); }
  const auth = au.getAuth(app);
  const tripRef = fs.doc(db, "trips", tripId);
  const scoreUnsubs = {};

  function watchScores(roundIds) {
    for (const rid of roundIds) {
      if (scoreUnsubs[rid]) continue;
      scoreUnsubs[rid] = fs.onSnapshot(fs.doc(db, "trips", tripId, "scores", rid), { includeMetadataChanges: true }, snap => {
        state.scores[rid] = (snap.exists() && snap.data().s) || {};
        state.pending = snap.metadata.hasPendingWrites;
        emit();
      }, err => { state.error = err.message; emit(); });
    }
  }

  return {
    mode: "live",
    watch(seedFn) {
      au.signInAnonymously(auth).then(() => {
        fs.onSnapshot(tripRef, async snap => {
          if (!snap.exists()) {
            await fs.setDoc(tripRef, seedFn());
            return;
          }
          state.trip = snap.data();
          state.ready = true;
          watchScores(Object.keys(state.trip.rounds || {}));
          emit();
        }, err => { state.error = "Could not load the trip: " + err.message; emit(); });
        const q = fs.query(fs.collection(db, "trips", tripId, "log"), fs.orderBy("at", "desc"), fs.limit(60));
        fs.onSnapshot(q, snap => { state.log = snap.docs.map(d => ({ ...d.data(), at: d.data().at?.toMillis?.() || Date.now() })); emit(); });
      }).catch(err => { state.error = "Sign-in failed. Check Anonymous sign-in is enabled in Firebase. (" + err.code + ")"; emit(); });
    },
    saveTrip(trip) { trip.updatedAt = Date.now(); return fs.setDoc(tripRef, trip); },
    setScore(rid, key, n, value) {
      const v = value === null || value === undefined ? fs.deleteField() : value;
      return fs.setDoc(fs.doc(db, "trips", tripId, "scores", rid), { s: { [key]: { ["h" + n]: v } } }, { merge: true });
    },
    addLog(entry) { return fs.addDoc(fs.collection(db, "trips", tripId, "log"), { ...entry, at: fs.serverTimestamp() }); },
  };
}

// ---------------- Demo (this device only) ----------------
function demoStore(tripId) {
  const K = k => `tdt:${tripId}:${k}`;
  const read = (k, d) => { try { const v = localStorage.getItem(K(k)); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(K(k), JSON.stringify(v)); } catch (e) {} };
  let chan = null; try { chan = new BroadcastChannel("tdt-" + tripId); } catch (e) {}
  const load = () => { state.trip = read("trip", null); state.scores = read("scores", {}); state.log = read("log", []); state.ready = !!state.trip; emit(); };
  if (chan) chan.onmessage = load;
  const ping = () => chan && chan.postMessage(1);
  return {
    mode: "demo",
    watch(seedFn) { if (!read("trip", null)) write("trip", seedFn()); load(); },
    saveTrip(trip) { trip.updatedAt = Date.now(); write("trip", trip); load(); ping(); return Promise.resolve(); },
    setScore(rid, key, n, value) {
      const s = read("scores", {}); s[rid] = s[rid] || {}; s[rid][key] = s[rid][key] || {};
      if (value === null || value === undefined) delete s[rid][key]["h" + n]; else s[rid][key]["h" + n] = value;
      write("scores", s); load(); ping(); return Promise.resolve();
    },
    addLog(entry) { const l = read("log", []); l.unshift({ ...entry, at: Date.now() }); write("log", l.slice(0, 60)); load(); ping(); return Promise.resolve(); },
    reset() { try { Object.keys(localStorage).filter(k => k.startsWith(`tdt:${tripId}:`)).forEach(k => localStorage.removeItem(k)); } catch (e) {} location.reload(); },
  };
}
