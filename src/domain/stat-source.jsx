import { dedupeById } from "../lib/helpers.jsx";

// ---------- what the statistics are allowed to count ----------
//
// The statistics read `ems:requests` and `ems:log`, and neither of those is the
// department's record. Both are working stores, deliberately kept small:
//
//   - `pruneArchivedWork` drops a completed call from the live board four
//     shifts after its own shift was filed and finalised, and its log lines
//     with it. That is correct — the archive already holds them, and a board
//     that grows forever eventually fails every write.
//   - `ems:log` is capped at 400 lines regardless. Sign-on and sign-off are log
//     lines, and they are the DENOMINATOR of every UHU figure: how many shifts
//     a person worked. Four hundred lines is a few busy days.
//
// So a month asked for from the archive read as a quiet month: the shift log
// downloads perfectly as a PDF and a workbook, because those are built from the
// submission, and the same month's statistics showed a handful of calls and a
// UHU nobody recognised. Restoring a backup did not fix it and could not — the
// records were never missing, they were in `ems:submissions` and the statistics
// were not looking there.
//
// A finalised submission carries the full call records and the full log lines
// for its shift and station (see `submitShiftLog`), which is exactly the shape
// the statistics need. This folds them back in.
//
// Live wins on a clash, always. A submission is a snapshot taken when the desk
// filed; the board's copy has whatever happened after. Deduplication is by
// record id, so a call held in both places is counted once — the whole reason
// "put back what is missing" and the statistics have to agree.

// Everything that holds a filed copy of finished work: the shift logs the desks
// submitted, and the operational days the board kept on its own. Both are read,
// because they do not cover the same ground — a shift nobody submitted is still
// in the day that was kept, and a day still open has its shifts filed already.
// A record in both is one record; the merge below is by id.
export function filedSources(submissions, archives) {
  const out = [];
  (Array.isArray(submissions) ? submissions : []).forEach((s) => { if (s) out.push(s); });
  (Array.isArray(archives) ? archives : []).forEach((a) => { if (a) out.push(a); });
  return out;
}

// Every filed record-holder whose own window could have produced a record
// inside the period being measured.
//
// A submission carries `windowStart`/`windowEnd` — its shift. A kept day
// carries `dayStart`/`dayEnd`. One test, read off whichever it has.
export function filedInWindow(sources, win) {
  const all = Array.isArray(sources) ? sources.filter(Boolean) : [];
  if (!win || !win.start || !win.end) return all;
  return all.filter((s) => {
    const start = s.windowStart || s.dayStart || null;
    const end = s.windowEnd || s.dayEnd || null;
    if (end && end < win.start) return false;
    if (start && start >= win.end) return false;
    return true;
  });
}

// The live list, plus everything the filed copies hold that it no longer does.
//
// `dedupeById` keeps the FIRST copy of an id, and the live list is laid down
// first — so the board's version of a call wins over the snapshot taken when
// the desk filed, which is right: the snapshot is a picture of that moment and
// the board has whatever happened after it.
export function withFiledWork(live, sources, part, win) {
  const filed = [];
  filedInWindow(sources, win).forEach((sub) => {
    (Array.isArray(sub[part]) ? sub[part] : []).forEach((rec) => {
      if (rec && rec.id) filed.push(rec);
    });
  });
  return dedupeById([...(Array.isArray(live) ? live : []), ...filed]);
}

export function statsRequests(requests, submissions, win, archives) {
  return withFiledWork(requests, filedSources(submissions, archives), "requests", win);
}

export function statsLog(log, submissions, win, archives) {
  return withFiledWork(log, filedSources(submissions, archives), "log", win);
}

// How many records the filed copies contributed, for the line that says so. A
// statistic that quietly grew when nothing on the board changed is one somebody
// has to be able to explain.
export function filedContribution({ requests, log, submissions, win, archives }) {
  const live = (l) => dedupeById(l || []).length;
  return {
    calls: statsRequests(requests, submissions, win, archives).length - live(requests),
    lines: statsLog(log, submissions, win, archives).length - live(log),
  };
}
