// The rules this app is documented to obey, exercised rather than read.
//
// `npm run check` proves the code parses and every name resolves. It cannot
// prove that a day runs 07:00 to 07:00, that Zahrawi is measured against nine
// and a half hours, or that a crew who came on at one o'clock is not credited
// with the call that ran at eight. Those are the rules in CLAUDE.md, and each
// one is here because getting it wrong has been a real bug at least once.
//
// Add to this whenever a fault turns out to be a rule that was never written
// down. A test here costs nothing to run and is the only thing that will catch
// it coming back.

export function run(D, t) {
  const at = (y, m, d, hh, mm = 0) => new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
  const H = 3600000;

  // ---------- a day runs 07:00 to 07:00 and files under the date it opened
  t.is("op day: 08:00 on the 20th is the 20th", D.opDayKey(D.opDayStart(at(2026, 8, 20, 8))), "2026-08-20");
  t.is("op day: 23:30 on the 20th is still the 20th", D.opDayKey(D.opDayStart(at(2026, 8, 20, 23, 30))), "2026-08-20");
  t.is("op day: 02:00 on the 21st belongs to the 20th", D.opDayKey(D.opDayStart(at(2026, 8, 21, 2))), "2026-08-20");
  t.is("op day: 06:59 on the 21st belongs to the 20th", D.opDayKey(D.opDayStart(at(2026, 8, 21, 6, 59))), "2026-08-20");
  t.is("op day: 07:00 on the 21st opens the 21st", D.opDayKey(D.opDayStart(at(2026, 8, 21, 7))), "2026-08-21");
  t.is("op day: 03:00 on 1 Jan belongs to 31 Dec", D.opDayKey(D.opDayStart(at(2027, 1, 1, 3))), "2026-12-31");
  t.ok("op day: exactly 24 hours long",
    D.opDayEnd(D.opDayStart(at(2026, 8, 20, 9))) - D.opDayStart(at(2026, 8, 20, 9)) === 24 * H);

  // ---------- Zahrawi stands 9:30, and it is the UHU denominator
  t.is("Zahrawi: 9.5 hours", D.shiftMsForUnit({ name: "ZAHRAWI" }), 9.5 * H);
  t.is("Zahrawi: the short form too", D.shiftMsForUnit({ name: "ZAH" }), 9.5 * H);
  t.is("every other medic: 12 hours", D.shiftMsForUnit({ name: "MEDIC 1" }), 12 * H);
  t.ok("Zahrawi does not count towards coverage",
    D.coverageUnits([{ id: "z", name: "ZAHRAWI", station: "main", alpha: { name: "A" } },
                     { id: "m", name: "MEDIC 1", station: "main", alpha: { name: "B" } }], "main")
      .map((u) => u.id).join() === "m");

  // ---------- a written status that went missing must not tell the desk a lie
  const staffed = { id: "u1", name: "MEDIC 1", status: "available", alpha: { name: "A" }, bravo: null };
  const bare = { id: "u2", name: "MEDIC 2", status: "available", alpha: null, bravo: null };
  t.is("status: nobody signed on reads oos, whatever is stored", D.effectiveStatus(bare, []), "oos");
  t.is("status: staffed and idle reads available", D.effectiveStatus(staffed, []), "available");
  t.ok("status: on a live call reports an on-call status",
    ["dispatched", "enroute", "onscene", "transporting", "arrived"]
      .includes(D.effectiveStatus(staffed, [{ id: "r", status: "onscene", assignedUnitId: "u1" }])));
  t.is("status: a stale on-call status with no live call falls back",
    D.effectiveStatus({ ...staffed, status: "onscene" }, []), "available");
  t.is("status: a stale on-call status on an empty truck reads oos",
    D.effectiveStatus({ ...bare, status: "onscene" }, []), "oos");
  t.is("status: no unit reads oos", D.effectiveStatus(null, []), "oos");

  // ---------- anything paid is written in hours
  t.is("overtime: 2h45m reads in hours", D.otHoursStr(2.75 * H), "2.75 h");
  t.is("overtime: never negative", D.otHoursStr(-5), "0.00 h");

  // ---------- the checklist is the person's, once per shift, not the truck's
  {
    const runs = [{ byAccountId: "F1", shiftKey: "2026-08-20-day", unitId: "u1", part: "main" }];
    t.ok("checklist: the person who filed one is done for that shift",
      D.checklistDoneByPerson(runs, "F1", "2026-08-20-day"));
    t.ok("checklist: their crewmate still owes one",
      !D.checklistDoneByPerson(runs, "F2", "2026-08-20-day"));
    t.ok("checklist: the same person owes another next shift",
      !D.checklistDoneByPerson(runs, "F1", "2026-08-20-night"));
    t.ok("checklist: their own filed list stays the mandatory one",
      D.checklistIsMandatory(runs, "F1", "2026-08-20-day", "u1", "main"));
    t.ok("checklist: a second truck the same shift is optional",
      !D.checklistIsMandatory(runs, "F1", "2026-08-20-day", "u2", "main"));
    t.ok("checklist: somebody who has filed nothing is always mandatory",
      D.checklistIsMandatory(runs, "F9", "2026-08-20-day", "u1", "main"));
    t.ok("checklist: a bare 'day' key never satisfies a dated shift",
      !D.checklistDoneByPerson([{ byAccountId: "F1", shiftKey: "day" }], "F1", "2026-08-27-day"));
  }

  // ---------- UHU is per person, not per vehicle
  {
    const now = at(2026, 8, 20, 19), from = at(2026, 8, 20, 7), to = now;
    const unit = { id: "u1", name: "MEDIC 1" };
    const whole = { name: "A", signedOnAt: from };
    const late = { name: "B", signedOnAt: at(2026, 8, 20, 13) };
    const reqs = [{ id: "r1", createdAt: at(2026, 8, 20, 8), assignedUnitId: "u1", status: "completed",
      times: { assigned: at(2026, 8, 20, 8), backInService: at(2026, 8, 20, 11) } }];
    const a = D.computePersonUhu(unit, whole, reqs, now, from, to);
    const b = D.computePersonUhu(unit, late, reqs, now, from, to);
    t.ok("uhu: the crew who ran the call is credited with it", a.calls === 1);
    t.ok("uhu: the crew who came on afterwards is not", b.calls === 0 && b.totalMs === 0);
    t.is("uhu: measured against a 12h tour", a.shiftMs, 12 * H);
    t.is("uhu: Zahrawi against 9.5h",
      D.computePersonUhu({ id: "z", name: "ZAHRAWI" }, whole, [], now, from, to).shiftMs, 9.5 * H);
    t.ok("uhu: a call longer than the shift still caps at 100%",
      D.computePersonUhu(unit, whole, [{ id: "x", createdAt: from, assignedUnitId: "u1",
        status: "completed", times: { assigned: from, backInService: from + 40 * H } }],
        now, from, to).pct <= 100);
  }

  // ---------- restocking is per call, and clears only when somebody presses it
  {
    const now = Date.now();
    const reqs = [
      { id: "r1", status: "completed", assignedUnitId: "u1", times: { backInService: now - 1000 } },
      { id: "r2", status: "completed", assignedUnitId: "u1", times: { backInService: now - 2000 } },
      { id: "r3", status: "onscene", assignedUnitId: "u1", times: {} },
      { id: "r4", status: "completed", assignedUnitId: "u2", times: { backInService: now - 1000 } },
    ];
    t.is("restock: this truck's finished calls, minus the ones marked done",
      D.callsAwaitingRestock(reqs, "u1", 0, { r1: { at: now } }).map((r) => r.id), ["r2"]);
    t.is("restock: a live call is never in the queue",
      D.callsAwaitingRestock(reqs, "u1", 0, {}).map((r) => r.id), ["r1", "r2"]);
    t.ok("restock: 'we used nothing' differs from 'nobody looked'",
      D.restockIsDone({ r1: { at: now } }, "r1") && !D.restockIsDone({ r1: { at: now } }, "r2"));
  }

  // ---------- a repeating booking reaches the board on the day, not before
  {
    const now = at(2026, 8, 20, 9);
    t.is("repeat: the horizon is today only", D.REPEAT_HORIZON_DAYS, 0);
    t.ok("repeat: never raises an occurrence beyond today",
      D.repeatOccurrencesDue({ scheduledFor: at(2026, 8, 20, 15), repeat: { days: [1, 3, 4, 5] } }, now)
        .every((o) => new Date(o.at).getDate() === 20));
    t.is("repeat: one whose time has passed is not raised",
      D.repeatOccurrencesDue({ scheduledFor: at(2026, 8, 20, 8), repeat: { days: [4] } }, now), []);
    t.is("repeat: no days means it never repeats",
      D.repeatOccurrencesDue({ scheduledFor: now + H, repeat: { days: [] } }, now), []);
    t.ok("repeat: days make it recurring",
      D.isRecurring({ repeat: { days: [1] } }) && !D.isRecurring({}));
  }

  // ---------- clocks
  t.is("clock: HH:MM:SS is padded", D.msDurationStr(3 * H + 4 * 60000 + 5000), "03:04:05");
  t.is("clock: negative clamps to zero", D.msDurationStr(-1), "00:00:00");
  t.is("clock: under an hour is minutes", D.shortDurationStr(45 * 60000), "45m");
  t.is("clock: over an hour carries both", D.shortDurationStr(2 * H + 5 * 60000), "2h 05m");
  t.is("clock: midnight is 00:00, never 24:00", D.forceMidnight("24:00"), "00:00");
  t.is("clock: a real time is left alone", D.forceMidnight("14:32"), "14:32");
  t.is("clock: only at a boundary, not inside a number", D.forceMidnight("124:00"), "124:00");

  // ---------- the export carries the day it is describing
  {
    const archived = D.opDayStart(at(2026, 8, 20, 9));
    const now = at(2026, 8, 27, 15);
    const reqs = [{ id: "r1", createdAt: at(2026, 8, 20, 9), status: "completed", assignedUnitId: "u1",
      nature: "Transfer", station: "main",
      times: { assigned: at(2026, 8, 20, 9), backInService: at(2026, 8, 20, 10) } }];
    const units = [{ id: "u1", name: "MEDIC 1", station: "main" }];
    const withDay = JSON.stringify(D.buildDispatchLogAOA(reqs, units, {}, [], now, "main", [], archived));
    const noDay = JSON.stringify(D.buildDispatchLogAOA(reqs, units, {}, [], now, "main", []));
    t.ok("export: a day from the archive is titled with its own date",
      /20[/-]?0?8|20 Aug|2026-08-20/.test(withDay));
    t.ok("export: and not with today's", !/27[/-]?0?8|27 Aug|2026-08-27/.test(withDay));
    t.ok("export: dayStart genuinely changes the sheet", withDay !== noDay);
  }

  // ---------- a crew stay is keyed by the shift window, never by "day"/"night"
  {
    const line = (ts, kind, sStart, sEnd) => ({ ts, type: "shift", detail: { kind, role: "team",
      name: "A. Ali", accountId: "F1", unitId: "u1", seat: "alpha", shift: "day",
      shiftStart: sStart, shiftEnd: sEnd } });
    const log = [
      line(at(2026, 8, 20, 7), "on", at(2026, 8, 20, 7), at(2026, 8, 20, 19)),
      line(at(2026, 8, 20, 19), "off", at(2026, 8, 20, 7), at(2026, 8, 20, 19)),
      line(at(2026, 8, 22, 7), "on", at(2026, 8, 22, 7), at(2026, 8, 22, 19)),
      line(at(2026, 8, 22, 19), "off", at(2026, 8, 22, 7), at(2026, 8, 22, 19)),
    ];
    const stamps = D.medicCrewStamps({ id: "u1", name: "MEDIC 1" }, log, at(2026, 8, 22, 20));
    t.ok("crew stamps: Tuesday and Thursday are two stays, not one fortnight-long run",
      (Array.isArray(stamps) ? stamps.length : 0) >= 2,
      "got " + JSON.stringify(stamps).slice(0, 200));
  }

  // ---------- a repeating booking is one patient, however many arrangements
  {
    const t8 = at(2026, 8, 20, 8);
    const t14 = at(2026, 8, 20, 14);
    const mwf = { id: "a", mrn: "MRN77", nature: "Dialysis", locationFrom: "Ward 3",
      locationTo: "Renal", scheduledFor: t8, repeat: { days: [1, 3, 5] } };
    const sat = { id: "b", mrn: "MRN77", nature: "Dialysis", locationFrom: "Ward 3",
      locationTo: "Renal", scheduledFor: t14, repeat: { days: [6] } };
    const other = { id: "c", mrn: "MRN99", nature: "Dialysis", locationFrom: "Ward 3",
      locationTo: "Renal", scheduledFor: t8, repeat: { days: [2] } };
    const groups = D.groupRepeatsByPatient([mwf, sat, other], at(2026, 8, 20, 9));
    t.is("repeats: one card per patient, not per arrangement", groups.length, 2);
    const mine = groups.find((g) => g.key === "mrn:MRN77");
    t.is("repeats: the patient's card carries every day they run on",
      mine.days.join(), "1,3,5,6");
    t.is("repeats: and both arrangements", mine.entries.length, 2);
    t.ok("repeats: a different MRN is a different patient",
      groups.some((g) => g.key === "mrn:MRN99"));
    // No MRN: the same journey is still the same standing run.
    const g2 = D.groupRepeatsByPatient(
      [{ ...mwf, id: "x", mrn: "" }, { ...sat, id: "y", mrn: "" }],
      at(2026, 8, 20, 9)
    );
    t.is("repeats: with no MRN the journey identifies the run", g2.length, 1);
  }

  // ---------- the next occurrence, for the line that says when they are in
  {
    const tmpl = { scheduledFor: at(2026, 8, 20, 8), repeat: { days: [1, 3, 5] } };
    // Thursday 20 August 2026 is a Thursday; the next Friday is the 21st.
    t.is("repeats: next occurrence is the next day it runs",
      D.nextRepeatAt(tmpl, at(2026, 8, 20, 9)), at(2026, 8, 21, 8));
    t.is("repeats: a booking with no days has no next", D.nextRepeatAt({ scheduledFor: 1 }, 1), null);
  }

  // ---------- overtime reaches administration only when it should
  {
    const off = (onCall) => [{
      ts: at(2026, 8, 20, 20), type: "shift",
      detail: { kind: "off", role: "team", name: "A. Ali", accountId: "F1", unitId: "u1",
        unitName: "MEDIC 1", seat: "alpha", shift: "day", shiftStart: at(2026, 8, 20, 7),
        shiftEnd: at(2026, 8, 20, 19), overtimeMs: 1 * H, onCall, onCallNature: onCall ? "Chest pain" : "" },
    }];
    const from = at(2026, 8, 20, 0), to = at(2026, 8, 21, 0);
    const held = D.overtimeClaims(off(true), [], from, to, {}, {})[0];
    t.ok("overtime: a call held them, so it is sent on its own", held.submitted && held.automatic);
    const stayed = D.overtimeClaims(off(false), [], from, to, {}, {})[0];
    t.ok("overtime: they stayed, so it waits on them", !stayed.submitted && !stayed.automatic);
    const sentIn = D.overtimeClaims(off(false), [], from, to, {}, { [stayed.id]: { at: 1 } })[0];
    t.ok("overtime: once they send it, it is in front of administration", sentIn.submitted);
    t.ok("overtime: and it is still not automatic", !sentIn.automatic);
    // The stamp on the log beats deriving it from a board that no longer has
    // the call — the whole reason it is stamped at sign-off.
    t.ok("overtime: the stamped answer is used, not the live board",
      D.overtimeClaims(off(true), [], from, to, {}, {})[0].onCall === true);
    t.is("overtime: the claim id keys the stay, seat included",
      D.overtimeClaimId({ accountId: "F1", shiftStart: 5, unitId: "u1", seat: "alpha" }),
      "F1::5::u1::alpha");
  }

  // ---------- the patient record joins by MRN and by nothing else
  {
    const live = [
      { id: "r1", mrn: "mrn-77 ", nature: "Dialysis", locationFrom: "Ward 3", locationTo: "Renal",
        status: "completed", createdAt: at(2026, 8, 26, 9), times: { assigned: at(2026, 8, 26, 9) },
        requirements: ["oxygen"], station: "main" },
      { id: "r2", mrn: "MRN77", nature: "Dialysis", locationFrom: "Ward 3", locationTo: "Renal",
        status: "completed", createdAt: at(2026, 8, 25, 9), times: { assigned: at(2026, 8, 25, 9) },
        station: "main" },
      // No MRN: there is nothing to join it by, so it must not appear at all.
      { id: "r3", nature: "Fall", status: "completed", createdAt: at(2026, 8, 25, 10), times: {} },
    ];
    const booked = [
      { id: "s1", mrn: "MRN77", nature: "Dialysis", locationFrom: "Ward 3", locationTo: "Renal",
        status: "scheduled", scheduledFor: at(2026, 8, 28, 9) },
    ];
    const archived = [{ requests: [
      // The same call the live board still has: one journey, not two.
      { id: "r2", mrn: "MRN77", nature: "Dialysis", status: "completed",
        createdAt: at(2026, 8, 25, 9), times: {} },
      { id: "r9", mrn: "MRN88", nature: "Transfer", status: "completed",
        createdAt: at(2026, 8, 1, 9), times: {} },
    ], scheduled: [] }];

    const recs = D.patientRecords(live, booked, archived);
    t.is("records: one record per MRN", recs.length, 2);
    const me = recs.find((r) => r.mrn === "MRN77");
    t.is("records: the MRN is normalised, so mrn-77 and MRN77 are not two people",
      me.count, 3);
    t.ok("records: a call with no MRN is not invented into a record",
      !recs.some((r) => r.journeys.some((j) => j.id === "r3")));
    t.is("records: an archived copy of a live call is the same journey",
      me.journeys.filter((j) => j.id === "r2").length, 1);
    t.is("records: the booking still to come is counted as open", me.openCount, 1);
    t.is("records: the usual journey is the one they mostly make",
      me.usualRoute, "Ward 3 → Renal");
    t.ok("records: what they have needed is carried across every journey",
      me.requirements.includes("oxygen"));
    t.ok("records: the patient with something coming outranks one long finished",
      recs[0].mrn === "MRN77");
    // "Last" means the past. A booking on the book is next, not last.
    t.ok("records: a future booking is next, never last", me.nextAt > Date.now());
    t.ok("records: last is a date that has already happened", me.lastAt <= Date.now());
    t.ok("records: a search reaches the ward as well as the number",
      D.recordMatches(me, "renal") && D.recordMatches(me, "mrn77") && !D.recordMatches(me, "zzz"));
  }

  // ---------- a standing arrangement is never dispatched
  {
    const tmpl = { id: "t1", status: "scheduled", scheduledFor: at(2026, 8, 20, 7, 15),
      repeat: { days: [0, 2, 4] }, nature: "HD appointment" };
    const occurrence = { ...tmpl, id: "o1", repeatOf: "t1", repeatKey: "2026-08-25", repeat: null,
      scheduledFor: at(2026, 8, 25, 7, 15) };
    const plain = { id: "p1", status: "scheduled", scheduledFor: at(2026, 8, 20, 7, 15) };
    const now = at(2026, 8, 27, 16);

    t.ok("repeats: the arrangement is a template", D.schedIsTemplate(tmpl));
    t.ok("repeats: an occurrence it threw off is not", !D.schedIsTemplate(occurrence));
    t.ok("repeats: a one-off booking is not", !D.schedIsTemplate(plain));

    t.ok("repeats: an arrangement long past its time never falls due",
      !D.schedDue(tmpl, now));
    t.ok("repeats: its occurrence does", D.schedDue(occurrence, now));
    t.ok("repeats: and so does an ordinary booking", D.schedDue(plain, now));

    // The day it was set up on runs like every other day it runs on. It used to
    // be skipped, because the arrangement was itself the first appointment.
    const madeToday = { scheduledFor: at(2026, 8, 27, 18), repeat: { days: [0, 1, 2, 3, 4, 5, 6] } };
    t.is("repeats: the day it was set up on still gets an occurrence",
      D.repeatOccurrencesDue(madeToday, at(2026, 8, 27, 16)).length, 1);
  }
}
