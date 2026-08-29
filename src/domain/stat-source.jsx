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

// Every submission whose shift could have produced a record inside the window.
//
// A finalised submission's log is re-cut at the moment it completes, so it can
// carry lines a little past its own window end; the caller filters by timestamp
// anyway, so the loose edge costs nothing and a missed submission costs a
// month's figures.
export function filedInWindow(submissions, win) {
  const all = Array.isArray(submissions) ? submissions : [];
  if (!win || !win.start || !win.end) return all.filter(Boolean);
  return all.filter(
    (s) => s && !(s.windowEnd && s.windowEnd < win.start) && !(s.windowStart && s.windowStart >= win.end)
  );
}

// The live list, plus everything the archive holds that it no longer does.
export function withFiledWork(live, submissions, part, win) {
  const out = Array.isArray(live) ? live.slice() : [];
  const seen = new Set();
  out.forEach((r) => {
    if (r && r.id) seen.add(String(r.id));
  });
  filedInWindow(submissions, win).forEach((sub) => {
    const held = Array.isArray(sub[part]) ? sub[part] : [];
    held.forEach((rec) => {
      if (!rec || !rec.id) return;
      const id = String(rec.id);
      if (seen.has(id)) return;
      seen.add(id);
      out.push(rec);
    });
  });
  return out;
}

export function statsRequests(requests, submissions, win) {
  return withFiledWork(requests, submissions, "requests", win);
}

export function statsLog(log, submissions, win) {
  return withFiledWork(log, submissions, "log", win);
}

// How many records the archive contributed, for the line that says so. A
// statistic that quietly grew when nothing on the board changed is one somebody
// has to be able to explain.
export function filedContribution({ requests, log, submissions, win }) {
  const calls = statsRequests(requests, submissions, win).length - (requests || []).length;
  const lines = statsLog(log, submissions, win).length - (log || []).length;
  return { calls, lines };
}
