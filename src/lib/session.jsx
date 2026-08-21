
// ---------- session (survives a page refresh) ----------
//
// Who is signed in used to live only in React state, so a refresh — or a
// tablet reloading itself after being locked — dropped whoever was working the
// board back to the sign-in screen and made a crew member re-take their seat.
// The session is kept in localStorage instead and restored on load. It is only
// a record of who this device is; every fact about the shift still comes from
// the board, and the checks further down still sign you out for real if your
// account was removed or someone else took your seat.
export const SESSION_KEY = "ems:session";
// Bumped to 2 when stations were introduced. A session saved before that has no
// station on it, and a missing station silently reads as the Main Office — so a
// CCC dispatcher carrying an old session would have been shown the Main Office's
// board, and exported the Main Office's log, while believing they were on CCC.
// Raising the version retires those sessions: everyone signs in once more and
// says which station they are working.
export const SESSION_VERSION = 2;

export function readSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || saved.v !== SESSION_VERSION || !saved.user || !saved.user.role) return null;
    // Admins work across both stations and never pick one. Everybody else must
    // have one, or the board they are shown is a guess.
    if (saved.user.role !== "admin" && !saved.user.station) return null;
    return saved;
  } catch (e) {
    return null;
  }
}

export function writeSession(session) {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (e) {
    // private browsing or a full quota: the session just won't survive a refresh
  }
}

export function patchSession(patch) {
  const current = readSession();
  if (!current) return;
  writeSession({ ...current, ...patch });
}

export function clearSession() {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch (e) {
    // ignore
  }
}