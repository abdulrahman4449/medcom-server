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

    // Neither half of an arrangement belongs in Upcoming: not the arrangement,
    // which is not a booking, and not the day's copy, which the desk did not
    // book and can already see on the patient's card in Repeating. Listed there
    // too, one dialysis patient read as two bookings.
    t.ok("repeats: the day's copy is an occurrence", D.schedIsOccurrence(occurrence));
    t.ok("repeats: the arrangement itself is not", !D.schedIsOccurrence(tmpl));
    t.ok("repeats: nor is a booking the desk made", !D.schedIsOccurrence(plain));
    const inUpcoming = (s) => D.schedOpen(s, now) && !D.schedIsTemplate(s) && !D.schedIsOccurrence(s);
    t.ok("repeats: Upcoming carries the desk's own booking", inUpcoming(plain));
    t.ok("repeats: Upcoming carries neither the arrangement", !inUpcoming(tmpl));
    t.ok("repeats: nor the day's copy of it", !inUpcoming(occurrence));

    // One card per day, however many desks are watching: the copy is keyed by
    // the local calendar day, so a second pass finds it already made.
    const twice = D.repeatOccurrencesDue(madeToday, at(2026, 8, 27, 16));
    t.is("repeats: one occurrence a day, keyed by the calendar day",
      new Set(twice.map((o) => o.key)).size, twice.length);
  }

  // ---------- statistics describe a period somebody chose
  //
  // The tabs used to mean "the one running now" and nothing else, so an
  // administrator asked for last month's figures and had no way to get them.
  // The chosen period is written into the range key, and every date in this
  // block is one an off-by-one would quietly retitle a filed report with.
  {
    // 27 August 2026 — a Thursday in Q3.
    const now = at(2026, 8, 27, 16);

    t.is("stats: a bare key is the size of the window", D.statRangeBase("month"), "month");
    t.is("stats: a chosen period keeps that size", D.statRangeBase("month:2026-4"), "month");
    t.is("stats: and an empty one still answers", D.statRangeBase(""), "month");

    const thisMonth = D.statRangeWindow("month", now);
    t.is("stats: this month is titled August 2026", thisMonth.title, "August 2026");
    t.is("stats: and reads as 'this month' on screen", thisMonth.label, "this month");
    t.is("stats: it starts on the first", thisMonth.start, at(2026, 8, 1, 0));
    t.is("stats: and ends on the first of the next", thisMonth.end, at(2026, 9, 1, 0));

    // The month index, not the month number: 4 is May.
    const may = D.statRangeWindow("month:2026-4", now);
    t.is("stats: a chosen month is titled by its own name", may.title, "May 2026");
    t.ok("stats: and is never called 'this month'", may.label !== "this month");
    t.is("stats: it starts on the first of May", may.start, at(2026, 5, 1, 0));
    t.is("stats: and ends on the first of June", may.end, at(2026, 6, 1, 0));

    // A month from last year, which is the case that crosses a year boundary.
    const dec = D.statRangeWindow("month:2025-11", now);
    t.is("stats: December of last year", dec.title, "December 2025");
    t.is("stats: ends at the new year", dec.end, at(2026, 1, 1, 0));

    const thisQ = D.statRangeWindow("quarter", now);
    t.is("stats: August is in Q3", thisQ.start, at(2026, 7, 1, 0));
    t.is("stats: which runs to October", thisQ.end, at(2026, 10, 1, 0));

    // Quarters are one-based, because that is what a quarter is called.
    const q2 = D.statRangeWindow("quarter:2026-2", now);
    t.is("stats: Q2 starts in April", q2.start, at(2026, 4, 1, 0));
    t.is("stats: and ends in July", q2.end, at(2026, 7, 1, 0));
    t.ok("stats: Q2 is titled April to June", /April to June/.test(q2.title));
    const q4 = D.statRangeWindow("quarter:2025-4", now);
    t.is("stats: Q4 of last year ends at the new year", q4.end, at(2026, 1, 1, 0));

    const lastYear = D.statRangeWindow("year:2025", now);
    t.is("stats: a chosen year is the whole year", lastYear.start, at(2025, 1, 1, 0));
    t.is("stats: and stops at the next one", lastYear.end, at(2026, 1, 1, 0));

    // A shift ignores any period appended to it: there is only one shift being
    // worked, and it is the one running now.
    t.is("stats: a shift is still the shift", D.statRangeWindow("shift", now).label, "this shift");

    // The picker never offers a period that has not happened.
    const months = D.statPeriodOptions("month", now);
    t.is("stats: the month picker opens on this month", months[0].key, "month:2026-7");
    t.ok("stats: and offers two years back", months.length === 24);
    t.ok("stats: never a month ahead",
      months.every((o) => D.statRangeWindow(o.key, now).start <= now));

    const quarters = D.statPeriodOptions("quarter", now);
    t.is("stats: the quarter picker opens on this quarter", quarters[0].key, "quarter:2026-3");
    // Walking back across the new year is where a quarter picker goes wrong.
    t.is("stats: and steps back into last year", quarters[3].key, "quarter:2025-4");
    t.ok("stats: never a quarter ahead",
      quarters.every((o) => D.statRangeWindow(o.key, now).start <= now));

    const years = D.statPeriodOptions("year", now);
    t.is("stats: the year picker opens on this year", years[0].key, "year:2026");
    t.ok("stats: never a year ahead",
      years.every((o) => D.statRangeWindow(o.key, now).start <= now));

    // Every option the picker offers has to survive being read back.
    t.ok("stats: every offered period parses to its own title",
      [...months, ...quarters, ...years].every((o) => {
        const w = D.statRangeWindow(o.key, now);
        return w.end > w.start && !!w.title;
      }));
  }

  // ---------- a device with an old copy of the board cannot erase it
  //
  // The bug this replaced: every save sent the whole list, so a tablet holding
  // a ten-minute-old board sent that board up and wiped everything raised in
  // between. Reproduced in a browser before the fix — one tap on a sleeping
  // tablet erased four of five calls.
  {
    const M = (current, body) => D.mergeRecordsInto(current, body);
    const board = [{ id: "r1", n: 1 }, { id: "r2", n: 2 }, { id: "r3", n: 3 }];

    t.is("merge: changing one record leaves the others alone",
      M(board, { upsert: [{ id: "r2", n: 22 }] }),
      [{ id: "r1", n: 1 }, { id: "r2", n: 22 }, { id: "r3", n: 3 }]);

    t.is("merge: a record the writer never knew about survives",
      M(board, { upsert: [{ id: "r1", n: 11 }] }).length, 3);

    t.is("merge: a new record is appended, and the order is kept",
      M(board, { upsert: [{ id: "r4", n: 4 }] }).map((x) => x.id), ["r1", "r2", "r3", "r4"]);

    t.is("merge: prepend puts it at the front instead",
      M(board, { upsert: [{ id: "r0", n: 0 }], prepend: true }).map((x) => x.id),
      ["r0", "r1", "r2", "r3"]);

    t.is("merge: a deliberate removal removes",
      M(board, { upsert: [], remove: ["r2"] }).map((x) => x.id), ["r1", "r3"]);

    t.is("merge: removing wins over upserting the same record",
      M(board, { upsert: [{ id: "r2", n: 99 }], remove: ["r2"] }).map((x) => x.id), ["r1", "r3"]);

    t.is("merge: nothing to say changes nothing", M(board, { upsert: [] }), board);

    t.is("merge: an empty board takes the records", M(null, { upsert: [{ id: "a" }] }), [{ id: "a" }]);

    // A cap always drops the oldest, and the oldest is at the far end from
    // wherever new records arrive.
    t.is("merge: a newest-first list is cut at the back",
      M([{ id: "l3" }, { id: "l2" }, { id: "l1" }], { upsert: [{ id: "l4" }], prepend: true, cap: 3 })
        .map((x) => x.id), ["l4", "l3", "l2"]);
    t.is("merge: an oldest-first list is cut at the front",
      M([{ id: "m1" }, { id: "m2" }, { id: "m3" }], { upsert: [{ id: "m4" }], cap: 3 })
        .map((x) => x.id), ["m2", "m3", "m4"]);
    t.is("merge: a cap larger than the list changes nothing",
      M(board, { upsert: [], cap: 99 }).length, 3);

    // Maps merge by their own keys — overtime sent in, restock done, consents.
    t.is("merge: a map keeps the entries the writer never saw",
      M({ a: 1, b: 2 }, { upsert: { c: 3 } }), { a: 1, b: 2, c: 3 });
    t.is("merge: a map entry can be removed",
      M({ a: 1, b: 2 }, { upsert: {}, remove: ["a"] }), { b: 2 });

    // A shape it cannot merge is refused rather than guessed at.
    t.is("merge: a list is not a map", M([{ id: "a" }], { upsert: 7 }), null);

    // Records with no id cannot be merged by id, so they are ignored rather
    // than piling up a duplicate on every write.
    t.is("merge: a record with no id is not taken", M(board, { upsert: [{ n: 4 }] }).length, 3);

    // The cap is bounded, so a bad client cannot ask the server to hold a
    // million records in memory.
    t.ok("merge: the cap is bounded", D.RECORD_CAP_MAX <= 100000);
  }

  // ---------- a call written up after the board came back
  {
    const T = (ymd, entered) => D.pastCallTimes(ymd, entered);

    const good = T("2026-08-20", {
      assigned: "14:00", enroute: "14:05", arrival: "14:20",
      departure: "14:40", arrivalDestination: "15:05", backInService: "15:30",
    });
    t.ok("past call: a straightforward one is accepted", !good.error);
    t.is("past call: the times are read as that day, locally",
      good.times.assigned, at(2026, 8, 20, 14));
    t.is("past call: and it files under the day it ran, not the day it was typed",
      D.opDayKey(D.opDayStart(good.times.assigned)), "2026-08-20");

    // A transfer that leaves at twenty to midnight and clears after it is an
    // ordinary night, not a typing mistake.
    const midnight = T("2026-08-20", { assigned: "23:40", backInService: "00:20" });
    t.ok("past call: one that runs past midnight is accepted", !midnight.error);
    t.ok("past call: and the later time is read as the next day",
      midnight.times.backInService === at(2026, 8, 21, 0, 20));
    t.ok("past call: it says it rolled the day", midnight.rolled === true);
    t.is("past call: a night call still files under the day it opened",
      D.opDayKey(D.opDayStart(midnight.times.assigned)), "2026-08-20");

    t.ok("past call: the start is needed", !!T("2026-08-20", { backInService: "15:30" }).error);
    t.ok("past call: so is the end", !!T("2026-08-20", { assigned: "14:00" }).error);
    t.ok("past call: a call that finishes in the future is refused",
      !!T(D.localYmd(Date.now() + 3 * 86400000), { assigned: "09:00", backInService: "10:00" }).error);

    // The middle four are optional — a paper log often has only two of them.
    const sparse = T("2026-08-20", { assigned: "14:00", arrival: "14:20", backInService: "15:30" });
    t.ok("past call: the middle steps may be left out", !sparse.error);
    t.is("past call: and only what was given is kept", Object.keys(sparse.times).length, 3);
  }

  // ---------- delegation is one area at a time, and the two lists agree
  {
    const server = D.serverDelegation;
    t.is("delegation: the app and the server name the same areas, in the same order",
      D.DELEGATION_AREAS.map((a) => a.key).join(),
      server.DELEGATION_SCOPES.map((a) => a.key).join());
    t.is("delegation: and agree on which of them are administration",
      D.ADMIN_AREAS.map((a) => a.key).join(), server.ADMIN_SCOPES.join());

    // Nonsense is dropped rather than stored, so a hand-made request cannot
    // invent an area the server has never heard of.
    t.is("delegation: an unknown area is not kept",
      server.cleanScopes(["overtime", "everything", ""]), ["overtime"]);
    t.is("delegation: the order is the list's, not the caller's",
      server.cleanScopes(["policies", "dispatch", "overtime"]),
      ["dispatch", "overtime", "policies"]);
    t.is("delegation: a repeat is one area, not two",
      server.cleanScopes(["overtime", "overtime"]), ["overtime"]);

    // Which board keys each area opens, and — the part that matters — which it
    // leaves shut.
    t.ok("delegation: overtime opens the overtime key",
      server.scopeAllowsKey(["overtime"], "ems:overtime"));
    t.ok("delegation: and nothing else",
      !server.scopeAllowsKey(["overtime"], "ems:policies") &&
      !server.scopeAllowsKey(["overtime"], "ems:checklists") &&
      !server.scopeAllowsKey(["overtime"], "ems:inventory"));
    t.ok("delegation: the desk opens no administrator's key at all",
      !server.scopeAllowsKey(["dispatch"], "ems:overtime") &&
      !server.scopeAllowsKey(["dispatch"], "ems:policies"));
    t.ok("delegation: holding nothing opens nothing",
      !server.scopeAllowsKey([], "ems:overtime"));

    // A real administrator carries no list; a delegate carries one. Getting
    // this the wrong way round would either lock an administrator out of their
    // own app or hand a delegate all of it.
    t.ok("delegation: an administrator in their own right holds every area",
      D.canArea({ role: "admin" }, "overtime") && D.canArea({ role: "admin" }, "archive"));
    t.ok("delegation: a delegate holds only what they were named for",
      D.canArea({ role: "admin", delegatedScopes: ["overtime"] }, "overtime") &&
      !D.canArea({ role: "admin", delegatedScopes: ["overtime"] }, "archive"));
    t.ok("delegation: a delegate given nothing holds nothing",
      !D.canArea({ role: "admin", delegatedScopes: [] }, "overtime"));
    t.ok("delegation: a crew member holds nothing whatever the list says",
      !D.canArea({ role: "team", delegatedScopes: ["overtime"] }, "overtime"));
    t.ok("delegation: borrowed administration knows it is borrowed",
      D.isDelegatedAdmin({ role: "admin", delegatedScopes: [] }) &&
      !D.isDelegatedAdmin({ role: "admin" }));

    t.is("delegation: the areas read as a sentence",
      D.areaSentence(["overtime", "archive"]), "Overtime and Archive & backups");
    t.is("delegation: and the server says it the same way",
      server.scopeSentence(["overtime", "archive"]), D.areaSentence(["overtime", "archive"]));

    // Every area on the list must be reachable: one that opens no board key
    // and guards no route is a tick box that does nothing, which is worse than
    // not offering it. Checked here because it is the sort of thing a new area
    // gets wrong on the day it is added.
    const guarded = new Set(["dispatch", "teams", "archive", "stats"]);
    t.ok("delegation: every area either opens a key or guards a screen",
      server.DELEGATION_SCOPES.every(
        (a) => guarded.has(a.key) || (server.SCOPE_WRITES[a.key] || []).length > 0
      ));
    t.ok("delegation: and every area the app draws is one the server knows",
      D.DELEGATION_AREAS.every((a) => server.cleanScopes([a.key]).length === 1));
  }
}
