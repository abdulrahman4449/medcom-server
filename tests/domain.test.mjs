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
    // Relative to now, not a date typed into the file.
    //
    // This was `at(2026, 8, 28, 9)` and it rotted exactly as you would expect:
    // the assertion below says a booking still to come is "next, never last",
    // and on the afternoon of 28 August 2026 that date stopped being in the
    // future. A fixture that has to be in the future must be written as "in the
    // future", or it is a test with an expiry date on it.
    const soon = Date.now() + 3 * 86400000;
    const booked = [
      { id: "s1", mrn: "MRN77", nature: "Dialysis", locationFrom: "Ward 3", locationTo: "Renal",
        status: "scheduled", scheduledFor: soon },
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
    t.is("repeats: an every-day arrangement throws off exactly one", twice.length, 1);

    // Asked again and again through the day, it must keep saying the same day.
    // Two desks polling fifteen seconds apart is the ordinary case, and each
    // answer is checked against what already exists by this key - so a key that
    // drifted within a day would put a second ambulance on the same patient.
    const keysThroughTheDay = [8, 10, 12, 14, 16].map(
      (h) => (D.repeatOccurrencesDue(madeToday, at(2026, 8, 27, h))[0] || {}).key
    );
    t.is("repeats: the day's key does not drift as the day goes on",
      new Set(keysThroughTheDay.filter(Boolean)).size, 1);

    // And an arrangement running several days still only ever answers for the
    // day being asked about — the horizon is today, not a week of cards.
    const everyDay = { scheduledFor: at(2026, 8, 27, 23), repeat: { days: [0, 1, 2, 3, 4, 5, 6] } };
    [27, 28, 29].forEach((d) => {
      t.is(`repeats: ${d} August throws off one card, not several`,
        D.repeatOccurrencesDue(everyDay, at(2026, 8, d, 9)).length, 1);
    });
  }

  // ---------- an abandoned call must not earn on-call time for ever
  //
  // A call still open counts up to now, which is right while a crew is out and
  // wrong once nobody has closed it for two days. Left uncapped, an abandoned
  // call showed 48h 50m of "on call" and carried one medic's UHU to 81.7% for a
  // whole month, on a truck that had been standing still. Nobody is on one call
  // for two days; a shift is the ceiling, because a shift is the longest
  // anybody is on duty in one stretch.
  {
    const H = 3600000;
    const now = at(2026, 8, 27, 18);
    const open = (hoursAgo) => ({
      id: "x", status: "assigned", assignedUnitId: "u1",
      createdAt: now - hoursAgo * H, times: { assigned: now - hoursAgo * H },
    });

    t.is("uhu: a call running two hours counts two hours",
      D.callBusyMs(open(2), now), 2 * H);
    t.is("uhu: a call running eleven hours still counts them all",
      D.callBusyMs(open(11), now), 11 * H);
    // The cap. 48h50m was the real figure off a real board.
    t.is("uhu: a call abandoned for two days counts one shift, not two days",
      D.callBusyMs(open(48.83), now), D.MAX_CALL_MS);
    t.ok("uhu: which is far less than the time it has been open",
      D.callBusyMs(open(48.83), now) < 48 * H);

    // A call that finished is measured by its stamps, capped or not — a
    // recorded duration is a fact and this must not quietly rewrite it.
    const done = {
      id: "y", status: "completed", assignedUnitId: "u1",
      createdAt: now - 30 * H,
      times: { assigned: now - 30 * H, backInService: now - 29 * H },
    };
    t.is("uhu: a finished call is measured by its own stamps", D.callBusyMs(done, now), H);

    // And a closed call with no stamps at all still contributes nothing,
    // rather than everything since it was raised.
    const abandoned = { id: "z", status: "completed", assignedUnitId: "u1",
      createdAt: now - 40 * H, times: {} };
    t.is("uhu: a closed call with no stamps contributes nothing",
      D.callBusyMs(abandoned, now), 0);
  }

  // ---------- the sheet says whether a patient was moved
  //
  // The question the department reads a month-end sheet for, and until now it
  // was answerable only by reading the close reason on every row. Four answers,
  // not two: recording a refusal or a call still running as a transfer would be
  // a lie, and a refusal is deliberately not a cancellation — the truck went
  // and the team assessed somebody, so that call happened.
  {
    const done = (extra) => ({ status: "completed", times: { backInService: at(2026, 8, 27, 12) }, ...extra });

    t.is("sheet: a delivered patient reads as transferred",
      D.requestOutcomeLabel(done({ closeReason: "Call completed — patient delivered" })), "TRANSFERRED");
    t.is("sheet: a call the desk stood down reads as cancelled",
      D.requestOutcomeLabel(done({ closeReason: "Cancelled before the team arrived" })), "CANCELLED");
    t.is("sheet: and so does one stood down en route",
      D.requestOutcomeLabel(done({ closeReason: "Team stood down en route" })), "CANCELLED");
    // The reason can be added to, so it matches on the words rather than the
    // whole string.
    t.is("sheet: a cancellation with a sentence added is still cancelled",
      D.requestOutcomeLabel(done({ closeReason: "Cancelled before the team arrived — ward rang back" })),
      "CANCELLED");
    t.is("sheet: a call still running is neither",
      D.requestOutcomeLabel({ status: "assigned" }), "IN PROGRESS");
    t.is("sheet: and nothing at all does not throw", D.requestOutcomeLabel(null), "IN PROGRESS");

    // A refusal is its own ending. It is not a cancellation and it is not a
    // transfer, and calling it either would put the wrong number in a report.
    const refused = done({ closeReason: "Patient refused transport", noTransport: true });
    t.ok("sheet: a refusal is not a cancellation", D.requestOutcomeLabel(refused) !== "CANCELLED");
    t.ok("sheet: nor is it a transfer", D.requestOutcomeLabel(refused) !== "TRANSFERRED");

    // The shading keys off the same answer the column prints, so a yellow row
    // and a row reading CANCELLED can never disagree.
    t.is("sheet: the shading and the column read the same call the same way",
      D.requestOutcomeKey(done({ closeReason: "Duplicate call" })), "cancelled");
  }

  // ---------- a status the board writes must never be a blank screen
  //
  // The crew's own call card read REQ_STATUS[status].color with no guard,
  // alone among every reader of that table. Any status the board holds that
  // this table does not know threw there, React unmounted the tree, and the
  // crew were left with nothing: no card, no banner, no tone, nothing to
  // press. A blank screen on a crew's own call is the worst one available.
  {
    // Deliberately NOT adding a "cancelled" status - close-reasons.jsx says
    // this board has none on purpose. The fix is the guard, not the entry.
    t.ok("call status: there is still no cancelled status", !D.REQ_STATUS.cancelled);
    ["pending", "assigned", "enroute", "onscene", "transporting", "arrived", "completed"]
      .forEach((k) => {
        t.ok(`call status: ${k} has a colour and a label`,
          !!(D.REQ_STATUS[k] && D.REQ_STATUS[k].color && D.REQ_STATUS[k].label));
      });
    // And the reader never throws, whatever the board hands it - a status
    // added on the server before the app knows about it is a real case.
    t.is("call status: an unknown status still renders",
      D.reqStatusMeta("something_new").label, "SOMETHING_NEW");
    t.ok("call status: and still has a colour", !!D.reqStatusMeta("something_new").color);
    t.ok("call status: even for nothing at all", !!D.reqStatusMeta(undefined).color);
    t.is("call status: which reads as a dash", D.reqStatusMeta(undefined).label, "—");
  }

  // ---------- ALS and CCT are one tone, BLS is the other
  //
  // The department's decision, and the reason it is a test rather than a
  // comment: a crew is not asked to tell two urgent tones apart in the second
  // after waking up. What they act on is "get up now" against "this can be
  // walked to", so that is the distinction the sound carries.
  //
  // This is NOT the old bug where every priority collapsed onto one fallback
  // tone. BLS still has to be different, and the last assertion is what stops
  // somebody quietly making all three the same again.
  {
    t.is("tones: a CCT call gets the wail", D.toneKeyFor("cct"), "critical");
    t.is("tones: an ALS call gets the same wail", D.toneKeyFor("als"), "critical");
    t.is("tones: a BLS call keeps the chime", D.toneKeyFor("bls"), "routine");
    // Both vocabularies, because a board that has been running a while still
    // holds the old words.
    t.is("tones: the old word for CCT still maps", D.toneKeyFor("urgent"), "critical");
    t.is("tones: and the old word for ALS", D.toneKeyFor("critical"), "critical");
    t.is("tones: an unrecognised priority still makes a noise", D.toneKeyFor("nonsense"), "routine");
    t.ok("tones: BLS is never the urgent tone", D.toneKeyFor("bls") !== D.toneKeyFor("cct"));
  }

  // ---------- a call written up by hand names its crew
  //
  // The board was not there when it ran, so nothing on it knows who crewed the
  // call. The names used to be typed, and a name typed at eight in the morning
  // about a call at two is spelt three ways across three entries. They are
  // picked now, off everybody the log has seen work.
  {
    const units = [
      { id: "u1", name: "MEDIC 1", alpha: { accountId: "F9001", name: "R. Chen" }, bravo: null },
      { id: "u2", name: "MEDIC 2", alpha: null, bravo: { accountId: "F9002", name: "S. Ahmed" } },
    ];
    const log = [
      { id: "1", role: "team", accountId: "F9003", name: "M. Farah", ts: at(2026, 8, 20, 7) },
      { id: "2", role: "team", accountId: "F9004", name: "L. Haddad", ts: at(2026, 8, 26, 7) },
      // A dispatcher is not somebody who could have been in the back of a
      // truck, and the same test the statistics use keeps them out.
      { id: "3", role: "dispatch", accountId: "F9005", name: "Desk", ts: at(2026, 8, 27, 7) },
      // The same person again, on another day. One entry, not two.
      { id: "4", role: "team", accountId: "F9003", name: "M. Farah", ts: at(2026, 8, 25, 7) },
      // A line with no name on it is not a person.
      { id: "5", role: "team", accountId: "", name: "", ts: at(2026, 8, 27, 8) },
    ];
    const crew = D.knownCrew(log, units);
    const ids = crew.map((p) => p.accountId);

    t.ok("past call: a dispatcher is never offered as crew", !ids.includes("F9005"));
    t.is("past call: everybody who has been on a truck, once each", crew.length, 4);
    t.is("past call: one entry for somebody who signed on twice",
      crew.filter((p) => p.accountId === "F9003").length, 1);
    t.ok("past call: whoever is in a seat now sorts first",
      ids[0] === "F9001" || ids[0] === "F9002");
    t.ok("past call: and the most recent sign-on comes before an older one",
      ids.indexOf("F9004") < ids.indexOf("F9003"));

    // The record carries the employee ID, because a name is not an identity —
    // two people share one often enough that a sheet cannot rely on it.
    t.is("past call: a person is held by their employee ID",
      D.crewOptionValue({ accountId: "F9001", name: "R. Chen" }), "F9001");
    t.is("past call: and by name when the board has no ID for them",
      D.crewOptionValue({ accountId: "", name: "Agency medic" }), "Agency medic");
    t.is("past call: a picked value finds its person",
      (D.crewByValue(crew, "F9003") || {}).name, "M. Farah");
    t.is("past call: and an empty pick finds nobody", D.crewByValue(crew, ""), null);

    // An empty board still answers, rather than throwing on the one screen
    // somebody reaches for when the board has just come back.
    t.is("past call: no log and no trucks is an empty list", D.knownCrew(null, null).length, 0);
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

    // A bare shift is the one running now; a chosen one is pinned by its own
    // start, and a night shift is named by the date it OPENED.
    t.is("stats: a bare shift is the shift running now", D.statRangeWindow("shift", now).label, "this shift");
    t.is("stats: at 16:00 that is the day shift from 07:00",
      D.statRangeWindow("shift", now).start, at(2026, 8, 27, 7));
    const lastNight = D.statRangeWindow(`shift:${at(2026, 8, 26, 19)}`, now);
    t.is("stats: a chosen shift starts where its window does", lastNight.start, at(2026, 8, 26, 19));
    t.is("stats: and is twelve hours long", lastNight.end, at(2026, 8, 27, 7));
    t.ok("stats: a past night shift is named by the date it opened",
      /night shift of 26 Aug 2026/.test(lastNight.label));

    // The operational week: Sunday 07:00 to the next Sunday 07:00. 27 August
    // 2026 is a Thursday, so its week opened on Sunday the 23rd.
    const thisWeek = D.statRangeWindow("week", now);
    t.is("stats: this week opened on Sunday at 07:00", thisWeek.start, at(2026, 8, 23, 7));
    t.is("stats: and runs to the next Sunday at 07:00", thisWeek.end, at(2026, 8, 30, 7));
    t.is("stats: and reads as 'this week' on screen", thisWeek.label, "this week");
    // 03:00 on Sunday morning is still inside the night that Saturday's day
    // opened — the week boundary is the operational day's, not midnight's.
    t.is("stats: the small hours of Sunday belong to the week that is ending",
      D.statRangeWindow("week", at(2026, 8, 30, 3)).start, at(2026, 8, 23, 7));
    const chosenWeek = D.statRangeWindow("week:2026-7-16", now);
    t.is("stats: a chosen week opens on its own Sunday", chosenWeek.start, at(2026, 8, 16, 7));
    t.is("stats: and closes a week later", chosenWeek.end, at(2026, 8, 23, 7));
    t.ok("stats: and is named by the day it opened", /week of 16 Aug 2026/.test(chosenWeek.label));

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

    const weeks = D.statPeriodOptions("week", now);
    t.is("stats: the week picker opens on this week", weeks[0].key, "week:2026-7-23");
    t.is("stats: and offers half a year back", weeks.length, 26);
    t.ok("stats: each option steps back exactly a week",
      weeks.every((o, i) => D.statRangeWindow(o.key, now).start === thisWeek.start - i * 7 * 86400000));

    const shifts = D.statPeriodOptions("shift", now);
    t.is("stats: the shift picker opens on the shift running now",
      shifts[0].key, `shift:${at(2026, 8, 27, 7)}`);
    t.is("stats: the one before it is the night that opened yesterday",
      shifts[1].key, `shift:${at(2026, 8, 26, 19)}`);
    t.ok("stats: and the night is labelled with the date it opened",
      /NIGHT SHIFT — 26 Aug 2026/.test(shifts[1].label));
    t.is("stats: a fortnight of shifts is offered", shifts.length, 28);

    // Every option the picker offers has to survive being read back.
    t.ok("stats: every offered period parses to its own title",
      [...months, ...quarters, ...years, ...weeks, ...shifts].every((o) => {
        const w = D.statRangeWindow(o.key, now);
        return w.end > w.start && !!w.title;
      }));
  }

  // ---------- the statistics count the archive, not just the live board
  //
  // `pruneArchivedWork` takes a filed call off the live board four shifts after
  // its shift was finalised, and `ems:log` is capped at 400 lines regardless.
  // Both are correct. What was wrong is that the statistics read only the live
  // board — so a month whose shift log downloads as a forty-call PDF showed a
  // handful of calls, a UHU nobody recognised, and no amount of restoring a
  // backup could fix it, because nothing was ever missing.
  {
    const win = { start: at(2026, 5, 1, 0), end: at(2026, 6, 1, 0) };
    const inMay = at(2026, 5, 12, 9);
    const live = [{ id: "r-live", createdAt: at(2026, 5, 28, 9), status: "completed" }];
    const liveLog = [{ id: "l-live", ts: at(2026, 5, 28, 9) }];
    const subs = [
      {
        id: "2026-05-12::day::main",
        station: "main",
        status: "final",
        windowStart: at(2026, 5, 12, 7),
        windowEnd: at(2026, 5, 12, 19),
        requests: [{ id: "r-filed", createdAt: inMay, status: "completed" }],
        log: [{ id: "l-filed", ts: inMay }],
      },
      // A shift from a different month must not be dragged into May.
      {
        id: "2026-02-02::day::main",
        station: "main",
        status: "final",
        windowStart: at(2026, 2, 2, 7),
        windowEnd: at(2026, 2, 2, 19),
        requests: [{ id: "r-feb", createdAt: at(2026, 2, 2, 9), status: "completed" }],
        log: [{ id: "l-feb", ts: at(2026, 2, 2, 9) }],
      },
    ];

    t.is("stats: a filed call the board no longer holds is still counted",
      D.statsRequests(live, subs, win).map((r) => r.id).sort().join(), "r-filed,r-live");
    t.is("stats: and its log lines with it",
      D.statsLog(liveLog, subs, win).map((l) => l.id).sort().join(), "l-filed,l-live");
    t.is("stats: a shift outside the window is not dragged in",
      D.statsRequests(live, subs, win).some((r) => r.id === "r-feb"), false);

    // The whole point of merging by id: the archive and the board hold the same
    // call for four shifts, and counting it twice would double a month.
    const both = [{ id: "r-filed", createdAt: inMay, status: "completed" }, ...live];
    t.is("stats: a call held in both places is counted once",
      D.statsRequests(both, subs, win).filter((r) => r.id === "r-filed").length, 1);
    t.ok("stats: and the board's copy is the one kept, not the snapshot",
      D.statsRequests(
        [{ id: "r-filed", createdAt: inMay, status: "completed", note: "live" }],
        subs, win
      ).find((r) => r.id === "r-filed").note === "live");

    // Nothing came from the archive when nothing was missing, so the line that
    // explains the difference must not appear.
    t.is("stats: nothing to say when the board still holds it all",
      D.filedContribution({ requests: both, log: [{ id: "l-filed", ts: inMay }, ...liveLog], submissions: subs, win }).calls, 0);
    t.is("stats: and it counts what the archive actually contributed",
      D.filedContribution({ requests: live, log: liveLog, submissions: subs, win }).calls, 1);

    // The rule the merge exists to compensate for, asserted here so the two
    // cannot drift: a filed call IS dropped from the live board, on purpose.
    const cutoff = D.pruneCutoff(at(2026, 5, 20, 9));
    t.ok("stats: a finalised filed call is safe to prune off the board",
      D.isSafeToPrune(
        { id: "r-filed", createdAt: inMay, status: "completed", station: "main" },
        subs, cutoff
      ));
  }

  // ---------- nothing is filed under two shifts, and nothing prints twice
  //
  // Both re-cuts of a filed submission's log used to end at `Date.now()`, so a
  // day shift finalised at 21:00 swallowed the night crew's 19:00 sign-on —
  // the same line filed under two shifts and printed on two sheets. Held open
  // by a running call, it took days of that station's lines the same way.
  {
    const dayStart = at(2026, 8, 26, 7);
    const dayEnd = at(2026, 8, 26, 19);
    const line = (id, ts, shiftStart) => ({
      id, ts, station: "main", type: "shift",
      detail: { role: "team", kind: "off", name: "R. Chen", accountId: "F9001", station: "main", shiftStart },
    });
    const log = [
      line("l-day", at(2026, 8, 26, 9), dayStart),
      // The night crew signing on at 19:00. Theirs, not the day shift's.
      line("l-night", at(2026, 8, 26, 19), dayEnd),
      // The day's own Alpha, signing off in overtime at 19:40. Still theirs.
      line("l-ot", at(2026, 8, 26, 19, 40), dayStart),
      // A different station entirely.
      { ...line("l-ccc", at(2026, 8, 26, 9), dayStart), station: "ccc", detail: { role: "team", kind: "off", station: "ccc", shiftStart: dayStart } },
    ];
    const cut = D.logForFiledShift(log, "main", dayStart, dayEnd).map((e) => e.id).sort().join();
    t.is("filed log: the shift's own lines, plus its overtime sign-off", cut, "l-day,l-ot");
    t.is("filed log: and that overtime line is filed under one shift only",
      D.logForFiledShift(log, "main", dayEnd, at(2026, 8, 27, 7)).some((e) => e.id === "l-ot"), false);
    // A shift start that is not a window start - Zahrawi stands 09:30 - still
    // has to land somewhere. Filed under nothing is lost from every sheet.
    t.is("filed log: a 09:30 start files under the day it worked",
      D.logShiftHome({ ts: at(2026, 8, 26, 20), detail: { shiftStart: at(2026, 8, 26, 9, 30) } }),
      at(2026, 8, 26, 7));
    t.is("filed log: the next crew's sign-on is not filed under this shift",
      D.logForFiledShift(log, "main", dayStart, dayEnd).some((e) => e.id === "l-night"), false);
    t.is("filed log: and the other station is never in it",
      D.logForFiledShift(log, "main", dayStart, dayEnd).some((e) => e.id === "l-ccc"), false);
    // The night shift gets that sign-on, exactly once.
    t.is("filed log: the sign-on belongs to the shift it opened",
      D.logForFiledShift(log, "main", dayEnd, at(2026, 8, 27, 7)).map((e) => e.id).join(), "l-night");

    // The last gate: a sheet can never print one call twice, whatever it is
    // handed. Every merge upstream is by id; this is the one a human reads.
    t.is("dedupe: one record per id, first copy kept, order untouched",
      D.dedupeById([{ id: "a", v: 1 }, { id: "b" }, { id: "a", v: 2 }]).map((r) => r.id + (r.v || "")).join(),
      "a1,b");
    t.is("dedupe: a record with no id is never dropped",
      D.dedupeById([{ ts: 1 }, { ts: 2 }]).length, 2);
    t.is("dedupe: nothing at all is not a crash", D.dedupeById(null).length, 0);
  }

  // ---------- the checklist is one per person per shift, and so is the figure
  //
  // Compliance counted every list filed. Somebody who changed truck mid-shift
  // filed twice and scored two out of one shift - clamped to 100%, which then
  // paid for a shift they had filed nothing on. Over a month that reads as full
  // compliance on a department that is not at full compliance.
  {
    const win = { start: at(2026, 8, 1, 0), end: at(2026, 9, 1, 0) };
    const now = at(2026, 8, 28, 12);
    const on = (id, ts, shiftStart) => ({ id, ts, station: "main", type: "shift",
      detail: { kind: "on", role: "team", name: "R. Chen", accountId: "F9001", unitId: "u1",
        unitName: "MEDIC 1", station: "main", seat: "alpha", shiftStart, shiftEnd: shiftStart + 12 * H } });
    const off = (id, ts, shiftStart) => ({ ...on(id, ts, shiftStart), detail: { ...on(id, ts, shiftStart).detail, kind: "off" } });
    // Two shifts worked: the 10th and the 12th.
    const log = [
      on("o1", at(2026, 8, 10, 7), at(2026, 8, 10, 7)), off("f1", at(2026, 8, 10, 19), at(2026, 8, 10, 7)),
      on("o2", at(2026, 8, 12, 7), at(2026, 8, 12, 7)), off("f2", at(2026, 8, 12, 19), at(2026, 8, 12, 7)),
    ];
    // Two lists, both on the FIRST shift - they changed truck at lunchtime.
    // Nothing at all on the second.
    const runs = [
      { id: "c1", at: at(2026, 8, 10, 7, 20), byAccountId: "F9001", byName: "R. Chen", unitId: "u1" },
      { id: "c2", at: at(2026, 8, 10, 13, 5), byAccountId: "F9001", byName: "R. Chen", unitId: "u2" },
    ];
    const rows = D.staffStatsFor(log, [], [], win, now, runs);
    t.is("checklist: two shifts worked", rows[0].shiftsWorked, 2);
    t.is("checklist: two lists on one shift is one shift covered", rows[0].checklistsFiled, 1);
    t.is("checklist: so compliance is half, not full", Math.round(rows[0].checklistCompliance), 50);

    // One list on each shift is full compliance, and nothing else is.
    const spread = [
      { id: "c1", at: at(2026, 8, 10, 7, 20), byAccountId: "F9001", byName: "R. Chen", unitId: "u1" },
      { id: "c3", at: at(2026, 8, 12, 7, 10), byAccountId: "F9001", byName: "R. Chen", unitId: "u1" },
    ];
    t.is("checklist: one on each shift is full compliance",
      Math.round(D.staffStatsFor(log, [], [], win, now, spread)[0].checklistCompliance), 100);
  }

  // ---------- a kept operational day counts too, and never twice
  {
    const win = { start: at(2026, 5, 1, 0), end: at(2026, 6, 1, 0) };
    const call = { id: "r-x", createdAt: at(2026, 5, 9, 9), status: "completed" };
    const sub = { id: "s", status: "final", windowStart: at(2026, 5, 9, 7), windowEnd: at(2026, 5, 9, 19),
      requests: [call], log: [] };
    const arch = { id: "a", dayStart: at(2026, 5, 9, 7), dayEnd: at(2026, 5, 10, 7),
      requests: [call], log: [] };
    t.is("stats: a kept day the desk never filed a log for is still counted",
      D.statsRequests([], [], win, [arch]).map((r) => r.id).join(), "r-x");
    t.is("stats: and a call in the shift log AND the kept day is counted once",
      D.statsRequests([], [sub], win, [arch]).length, 1);
    t.is("stats: a kept day outside the period is not dragged in",
      D.statsRequests([], [], win, [{ id: "a2", dayStart: at(2026, 2, 1, 7), dayEnd: at(2026, 2, 2, 7),
        requests: [{ id: "r-feb", createdAt: at(2026, 2, 1, 9) }], log: [] }]).length, 0);
  }

  // ---------- a month spread across the board, a filed log and a kept day
  //
  // The whole of it at once, with the numbers worked out by hand, because the
  // parts can each be right and the total still be wrong. One person changes
  // truck mid-shift; one shift lives only in a submission; one lives only in a
  // kept operational day; one is still on the board.
  {
    const unitsAB = [{ id: "u1", name: "MEDIC 1", station: "main" }, { id: "u2", name: "MEDIC 2", station: "main" }];
    const call = (id, unitId, start, end) => ({
      id, unitId, assignedUnitId: unitId, station: "main", status: "completed", createdAt: start,
      times: { dispatch: start, arrivalScene: start + 6e5, departScene: start + 12e5,
               arrivalDestination: end - 3e5, backInService: end } });
    const seat = (id, ts, kind, who, unitId, shiftStart) => ({
      id, ts, type: "shift", station: "main",
      detail: { kind, role: "team", name: who.name, accountId: who.id, unitId,
        unitName: unitId === "u1" ? "MEDIC 1" : "MEDIC 2", station: "main", seat: who.seat,
        shiftStart, shiftEnd: shiftStart + 12 * H } });
    const A = { id: "F9001", name: "R. Chen", seat: "alpha" };
    const B = { id: "F9002", name: "K. Osei", seat: "bravo" };

    const s1 = at(2026, 8, 3, 7), s2 = at(2026, 8, 5, 7), s3 = at(2026, 8, 20, 7);
    const s1Calls = [call("c1", "u1", at(2026, 8, 3, 8), at(2026, 8, 3, 10)),
                     call("c2", "u2", at(2026, 8, 3, 14), at(2026, 8, 3, 15))];
    const s1Log = [
      seat("a-on1", at(2026, 8, 3, 7), "on", A, "u1", s1),
      seat("b-on", at(2026, 8, 3, 7), "on", B, "u1", s1),
      seat("a-off1", at(2026, 8, 3, 13), "off", A, "u1", s1),
      seat("a-on2", at(2026, 8, 3, 13), "on", A, "u2", s1),
      seat("a-off2", at(2026, 8, 3, 19), "off", A, "u2", s1),
      seat("b-off", at(2026, 8, 3, 19), "off", B, "u1", s1),
    ];
    const s2Log = [seat("a-on3", s2, "on", A, "u1", s2), seat("a-off3", at(2026, 8, 5, 19), "off", A, "u1", s2)];
    const s3Calls = [call("c3", "u1", at(2026, 8, 20, 9), at(2026, 8, 20, 13))];
    const s3Log = [seat("a-on4", s3, "on", A, "u1", s3), seat("a-off4", at(2026, 8, 20, 19), "off", A, "u1", s3)];

    const submissions = [{ id: "sub1", station: "main", status: "final", windowStart: s1,
      windowEnd: s1 + 12 * H, requests: s1Calls, log: s1Log, requestIds: s1Calls.map((r) => r.id) }];
    const archives = [{ id: "arch1", dayStart: s2, dayEnd: s2 + 24 * H, requests: [], log: s2Log }];

    const now = at(2026, 8, 28, 12);
    const win = D.statRangeWindow("month:2026-7", now);
    const reqs = D.statsRequests(s3Calls, submissions, win, archives);
    const lines = D.statsLog(s3Log, submissions, win, archives);
    t.is("month: three calls, from three different places", reqs.length, 3);
    t.is("month: and not one of them twice", new Set(reqs.map((r) => r.id)).size, 3);
    t.is("month: ten log lines, none of them twice", new Set(lines.map((l) => l.id)).size, 10);

    const runs = [
      { id: "k1", at: at(2026, 8, 3, 7, 20), byAccountId: A.id, byName: A.name, unitId: "u1" },
      { id: "k2", at: at(2026, 8, 3, 13, 10), byAccountId: A.id, byName: A.name, unitId: "u2" },
      { id: "k3", at: at(2026, 8, 20, 7, 15), byAccountId: A.id, byName: A.name, unitId: "u1" },
    ];
    const rows = D.staffStatsFor(lines, reqs, unitsAB, win, now, runs);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    t.is("month: a truck change mid-shift is one shift", by.F9001.shiftsWorked, 3);
    t.is("month: 3h on shift one and 4h on shift three", Math.round(by.F9001.onCallMs / H), 7);
    t.is("month: so 7 hours over three twelves", Number(by.F9001.uhu.toFixed(1)), 19.4);
    t.is("month: the Bravo is credited only with the call on their own truck",
      Math.round(by.F9002.onCallMs / H), 2);
    t.is("month: and measured on the one shift they worked", Number(by.F9002.uhu.toFixed(1)), 16.7);
    t.is("month: two lists on one shift is two shifts covered out of three", by.F9001.checklistsFiled, 2);
    t.is("month: so 67% compliance, not 100%", Math.round(by.F9001.checklistCompliance), 67);
    t.is("month: the department is weighted by shifts, not averaged",
      Number(D.departmentUhu(rows).toFixed(1)), 18.8);
  }

  // ---------- a booking is raised before it leaves, never as it leaves
  //
  // The department's rule: the card reaches the board fifteen minutes before
  // the DISPATCH time, not the appointment time. Where no dispatch time was
  // given the appointment time is the only time anybody knows, so it is what
  // the crew work back from — and the lead applies to it too. It used to apply
  // only to `dispatchAt`, so a booking taken without one was raised at the
  // moment the patient was due to be somewhere else.
  {
    const appt = at(2026, 8, 20, 10, 0);
    const leave = at(2026, 8, 20, 9, 30);
    t.is("booking: fifteen minutes before the dispatch time",
      D.schedReleaseAt({ scheduledFor: appt, dispatchAt: leave }), at(2026, 8, 20, 9, 15));
    t.is("booking: and never fifteen minutes before the appointment when a dispatch time exists",
      D.schedReleaseAt({ scheduledFor: appt, dispatchAt: leave }) === appt - 15 * 60000, false);
    t.is("booking: with no dispatch time the appointment time is what it leaves for",
      D.schedReleaseAt({ scheduledFor: appt }), at(2026, 8, 20, 9, 45));
    t.is("booking: nothing booked is not a booking due now", D.schedReleaseAt({}), 0);
    t.is("booking: and neither is nothing at all", D.schedReleaseAt(null), 0);

    // Due is release-time, plus the two things that are never released at all.
    const due = (s, now) => D.schedDue(s, now);
    t.is("booking: not due a minute before its card is raised",
      due({ status: "scheduled", scheduledFor: appt, dispatchAt: leave }, at(2026, 8, 20, 9, 14)), false);
    t.is("booking: due once it is",
      due({ status: "scheduled", scheduledFor: appt, dispatchAt: leave }, at(2026, 8, 20, 9, 15)), true);
    t.is("booking: one waiting on the ward's call is never due",
      due({ status: "scheduled", awaitCall: true, scheduledFor: null }, at(2026, 8, 20, 12)), false);
    t.is("booking: and a standing arrangement is never due either",
      due({ status: "scheduled", scheduledFor: appt, dispatchAt: leave, repeat: { days: [0, 2, 4] } },
        at(2026, 8, 20, 12)), false);
  }

  // ---------- a repeating arrangement is one card, on the day it runs
  //
  // Sunday, Tuesday, Thursday means three cards on three days — not a week of
  // them sitting in Upcoming beside the calls being worked. The horizon is
  // zero: an occurrence is thrown off for TODAY, and only if its appointment
  // has not already gone.
  {
    t.is("repeat: the horizon is today and nothing further", D.REPEAT_HORIZON_DAYS, 0);
    // A Sunday/Tuesday/Thursday arrangement, appointment 07:15.
    const tmpl = { id: "t1", scheduledFor: at(2026, 8, 18, 7, 15), repeat: { days: [0, 2, 4] } };
    // 18 August 2026 is a Tuesday.
    t.is("repeat: a day it runs throws off exactly one occurrence",
      D.repeatOccurrencesDue(tmpl, at(2026, 8, 18, 6, 0)).length, 1);
    t.is("repeat: and it is that day's appointment time",
      D.repeatOccurrencesDue(tmpl, at(2026, 8, 18, 6, 0))[0].at, at(2026, 8, 18, 7, 15));
    // 19 August is a Wednesday - not one of its days.
    t.is("repeat: a day it does not run throws off nothing",
      D.repeatOccurrencesDue(tmpl, at(2026, 8, 19, 6, 0)).length, 0);
    t.is("repeat: nothing is stocked for the rest of the week",
      D.repeatOccurrencesDue(tmpl, at(2026, 8, 18, 6, 0)).every(
        (o) => o.at < at(2026, 8, 19, 0, 0)), true);
    t.is("repeat: and nothing once the appointment has gone",
      D.repeatOccurrencesDue(tmpl, at(2026, 8, 18, 8, 0)).length, 0);

    // The day the desk BOOKED is an occurrence in its own right, whatever the
    // weekday list says.
    //
    // This lost a booking outright. The form takes a date and time AND a set of
    // days, and the date it was booked for only ran if that weekday happened to
    // be ticked — so "today at 09:00, repeating Sun/Tue/Thu", booked on a
    // Saturday, silently never happened: not in Upcoming (it is a template),
    // not on the board (a template is never released), and nothing anywhere
    // saying so.
    // 22 August 2026 is a Saturday; Sun/Tue/Thu does not include it.
    const sat = { id: "t2", scheduledFor: at(2026, 8, 22, 9, 0), repeat: { days: [0, 2, 4] } };
    t.is("repeat: the day it was booked for runs, even off the weekday list",
      D.repeatOccurrencesDue(sat, at(2026, 8, 22, 6, 0)).length, 1);
    t.is("repeat: at the time it was booked for",
      D.repeatOccurrencesDue(sat, at(2026, 8, 22, 6, 0))[0].at, at(2026, 8, 22, 9, 0));
    // And the Sunday after it still runs, from the same arrangement.
    t.is("repeat: and the ticked days still run",
      D.repeatOccurrencesDue(sat, at(2026, 8, 23, 6, 0)).length, 1);
    // A day that is neither the booked day nor a ticked day runs nothing.
    // 24 August 2026 is a Monday.
    t.is("repeat: a day that is neither still runs nothing",
      D.repeatOccurrencesDue(sat, at(2026, 8, 24, 6, 0)).length, 0);
    // The booked day being a ticked day too must not make two.
    const tue = { id: "t3", scheduledFor: at(2026, 8, 18, 9, 0), repeat: { days: [0, 2, 4] } };
    t.is("repeat: a booked day that is also a ticked day is still one occurrence",
      D.repeatOccurrencesDue(tue, at(2026, 8, 18, 6, 0)).length, 1);

    // The arrangement itself never reaches Upcoming, and neither does the
    // day's copy: one is not an appointment, the other is already on the
    // board.
    const occ = { id: "o1", repeatOf: "t1", scheduledFor: at(2026, 8, 18, 7, 15), repeat: { days: [0, 2, 4] } };
    t.ok("repeat: the arrangement is a template, not a booking", D.schedIsTemplate(tmpl));
    t.ok("repeat: the day's copy is an occurrence", D.schedIsOccurrence(occ));
    t.is("repeat: and the copy is not itself a template", D.schedIsTemplate(occ), false);
  }

  // ---------- a stopped arrangement stops
  //
  // The pass that throws off the day's copy picked its templates on shape
  // alone and never looked at whether the arrangement was still wanted, so
  // cancelling a standing transfer took it off the Repeating tab — which
  // filters cancelled ones out — and changed nothing else: it went on
  // producing a call every one of its days, from a card the desk could no
  // longer see to stop it a second time.
  {
    const live = { id: "t", scheduledFor: at(2026, 8, 18, 9), repeat: { days: [0, 2, 4] }, status: "scheduled" };
    t.ok("repeat: a live arrangement is one the pass will run", D.schedRepeatIsLive(live));
    t.is("repeat: a cancelled arrangement is not",
      D.schedRepeatIsLive({ ...live, status: "cancelled" }), false);
    t.is("repeat: and the day's copy is never a template to run",
      D.schedRepeatIsLive({ ...live, repeatOf: "t" }), false);
    t.is("repeat: nor is an ordinary booking with no days on it",
      D.schedRepeatIsLive({ id: "b", scheduledFor: at(2026, 8, 18, 9), status: "scheduled" }), false);
  }

  // ---------- a call called off before the crew arrived used nothing
  //
  // Restocking a truck nobody opened is paperwork for its own sake. Both halves
  // are needed: a call stood down at the bedside may well have cost gloves and
  // a blanket, and a call with no scene stamp is an unfinished timeline rather
  // than a cancellation.
  {
    const base = { id: "r", status: "completed", assignedUnitId: "u1", createdAt: at(2026, 8, 20, 9),
      times: { backInService: at(2026, 8, 20, 10) } };
    const cancelled = { ...base, closeReason: "Cancelled before the team arrived" };
    t.ok("restock: called off before the scene needs none", D.restockNotNeeded(cancelled));
    t.is("restock: called off AT the scene still needs one",
      D.restockNotNeeded({ ...cancelled, times: { ...base.times, arrival: at(2026, 8, 20, 9, 20) } }), false);
    t.is("restock: an ordinary call needs one",
      D.restockNotNeeded({ ...base, closeReason: "Call completed — patient delivered" }), false);
    t.is("restock: a call with no reason on it at all still needs one",
      D.restockNotNeeded(base), false);
    // A refusal is not a cancellation: the truck rolled and the crew assessed
    // the patient, so that call happened.
    t.is("restock: a refusal is not a cancellation",
      D.restockNotNeeded({ ...base, closeReason: "Patient refused transport" }), false);

    // And the list itself drops it.
    const done = {};
    t.is("restock: the outstanding list leaves it out",
      D.callsAwaitingRestock([cancelled], "u1", at(2026, 8, 20, 7), done).length, 0);
    t.is("restock: and keeps an ordinary one",
      D.callsAwaitingRestock(
        [{ ...base, closeReason: "Call completed — patient delivered" }], "u1", at(2026, 8, 20, 7), done
      ).length, 1);
  }

  // ---------- a night call is a night call whenever it finishes
  //
  // The shift a call belongs to is the shift it was RAISED in. One raised at
  // 23:30 that finishes at 00:40, and one raised at 06:30 that finishes at
  // 08:10, were both worked by the night crew and are shaded as night on the
  // sheet — the clock time they happened to end at says nothing about whose
  // shift they were.
  {
    const night = (h, m) => D.isNightCall({ createdAt: at(2026, 8, 28, h, m) });
    t.is("night: 07:00 opens the day shift", night(7, 0), false);
    t.is("night: midday is day", night(12, 0), false);
    t.is("night: 18:59 is still day", night(18, 59), false);
    t.is("night: 19:00 opens the night", night(19, 0), true);
    t.is("night: 23:30 is night", night(23, 30), true);
    t.is("night: 00:30 is night", night(0, 30), true);
    t.is("night: 02:00 is night", night(2, 0), true);
    t.is("night: 06:59 is the last minute of the night", night(6, 59), true);
    // A call with no raised time cannot be filed under a shift at all, and must
    // not be quietly called night because the epoch happens to fall there.
    t.is("night: an unstamped call is not asserted either way",
      D.isNightCall({ createdAt: 0 }), D.isNightCall({}));
  }

  // ---------- a call called off has no response time, and is not a backlog
  //
  // The two were one number under one sentence — "not yet measurable, still
  // running or closed without arriving" — and on a real month that read 52
  // against 34 measured, which looks like a department sitting on fifty-two
  // open emergencies. Almost every one was a call the desk stood down before
  // the crew reached anybody: there is no response time, there never will be
  // one, and nothing is outstanding.
  {
    const win = [at(2026, 8, 1, 0), at(2026, 9, 1, 0)];
    const em = (id, raised, arrived, closeReason) => ({
      id, callCategory: "EMERGENCY (INTERNAL)", status: "completed", createdAt: raised,
      closeReason: closeReason || "Call completed — patient delivered",
      times: arrived ? { arrivalDestination: arrived } : {},
    });
    const rows = [
      em("a", at(2026, 8, 3, 9), at(2026, 8, 3, 9, 6)),        // 6 min — inside
      em("b", at(2026, 8, 4, 9), at(2026, 8, 4, 9, 8)),        // 8 min — inside
      em("c", at(2026, 8, 5, 9), at(2026, 8, 5, 9, 16)),       // 16 min — outside
      em("d", at(2026, 8, 6, 9), null, "Cancelled before the team arrived"),
      em("e", at(2026, 8, 7, 9), null, "Team stood down en route"),
      // Genuinely open on the board — the only one anybody has to act on.
      { id: "f", callCategory: "EMERGENCY (INTERNAL)", status: "enroute",
        createdAt: at(2026, 8, 8, 9), times: {} },
      // Closed with no arrival time and no cancellation on it: a refusal, a
      // timeline the desk closed unfinished, or a call closed before the
      // close-reason box existed. No response time will ever exist, so it is
      // an exclusion — never "still open".
      em("g", at(2026, 8, 9, 9), null, "Patient refused transport"),
      { id: "h", callCategory: "EMERGENCY (INTERNAL)", status: "completed",
        createdAt: at(2026, 8, 10, 9), times: {} },
    ];
    const r = D.responseCompliance(rows, win[0], win[1]);
    t.is("response: only calls that arrived are measured", r.total, 3);
    t.is("response: two of the three made ten minutes", r.within, 2);
    t.is("response: so compliance is 67%", Math.round(r.pct), 67);
    // 6 + 8 + 16 = 30 minutes over three calls.
    t.is("response: and the average is ten minutes", Math.round(r.avg / 60000), 10);
    t.is("response: a stood-down call is counted apart, not as a backlog", r.calledOff, 2);
    t.is("response: still running means literally open on the board", r.running, 1);
    t.is("response: a closed call with no time is an exclusion, whatever it closed for",
      r.closedNoTime, 2);
    t.is("response: the not-counted line folds every closed no-time call together",
      r.notCounted, 4);
    // A cancelled call must never move the figure itself.
    const without = D.responseCompliance(rows.filter((x) => !["d", "e"].includes(x.id)), win[0], win[1]);
    t.is("response: excluding the stood-down calls changes nothing", Math.round(without.pct), Math.round(r.pct));
    t.is("response: nor the average", Math.round(without.avg), Math.round(r.avg));
    // Nothing at all is not 0% compliance, it is no measurement.
    t.is("response: a period with no emergencies has no percentage",
      D.responseCompliance([], win[0], win[1]).pct, null);
  }

  // ---------- the service mix: CCT, ALS, BLS, honestly
  //
  // Shares of every call the period received, read the way the sheet's Svc
  // column reads them: the category decides, an explicit priority is honoured
  // on a call not yet coded, and a call with neither is "Not stated" — never
  // quietly counted as BLS, because a percentage built on an assumption is a
  // percentage nobody can defend.
  {
    const win = [at(2026, 8, 1, 0), at(2026, 9, 1, 0)];
    const call = (id, extra) => ({ id, createdAt: at(2026, 8, 5, 9), ...extra });
    const { rows, total } = D.serviceMixRows(
      [
        call("a", { callType: "C" }),               // CCT by category
        call("b", { callType: "A" }),               // ALS by category
        call("c", { callType: "B" }),               // BLS by category
        call("d", { callType: "D" }),               // D is BLS work
        call("e", { priority: "als" }),             // not coded yet — priority speaks
        call("f", {}),                              // neither — Not stated
      ],
      win[0], win[1]
    );
    t.is("svc: six calls counted", total, 6);
    const by = Object.fromEntries(rows.map((r) => [r.name, r.n]));
    t.is("svc: the category decides CCT", by.CCT, 1);
    t.is("svc: an uncoded call's explicit priority is honoured", by.ALS, 2);
    t.is("svc: B and D are both basic life support", by.BLS, 2);
    t.is("svc: a call with neither is Not stated, never assumed BLS", by["Not stated"], 1);
    t.is("svc: the three the department runs come first, in its own order",
      rows.slice(0, 3).map((r) => r.name), ["CCT", "ALS", "BLS"]);
    // Always all three, zeros included — same rule as the category mix.
    const none = D.serviceMixRows([call("z", { callType: "A" })], win[0], win[1]);
    t.is("svc: a level nothing came in against is listed at nought",
      none.rows.find((r) => r.name === "CCT").n, 0);
    t.ok("svc: and the shares are of the total received",
      Math.round(rows.find((r) => r.name === "ALS").pct) === 33);
  }

  // ---------- putting data back belongs to the owner
  //
  // Taking a copy is safe and stays with anyone holding the archive area.
  // Putting one back rewrites the department's record, so it belongs to
  // F1525518 alone — a delegate restores only inside a window the owner has
  // opened, and the window closes on its own clock.
  {
    const now = 1000000;
    const owner = { id: "F1525518", fullAdmin: true };
    const delegate = { id: "F2001", fullAdmin: false };
    const otherAdmin = { id: "F9999", fullAdmin: true };
    t.is("restore: the owner may always put data back", D.mayRestore(owner, null, now), true);
    t.is("restore: a delegate with no window may not", D.mayRestore(delegate, null, now), false);
    t.is("restore: another full admin is still not the owner",
      D.mayRestore(otherAdmin, null, now), false);
    const live = { expiresAt: now + 60000 };
    t.is("restore: an open window lets the delegate through", D.mayRestore(delegate, live, now), true);
    t.is("restore: an expired window refuses on its own",
      D.mayRestore(delegate, { expiresAt: now - 1 }, now), false);
    t.is("restore: only the owner opens the window", D.mayOpenRestoreWindow(delegate), false);
    t.is("restore: a delegate ACTING as admin is still not the owner",
      D.mayOpenRestoreWindow({ id: "F2001", fullAdmin: false }), false);
    t.is("restore: the owner's own session opens it", D.mayOpenRestoreWindow(owner), true);
    t.is("restore: an impostor with the owner's id but not the admin role cannot",
      D.mayOpenRestoreWindow({ id: "F1525518", fullAdmin: false }), false);
    t.ok("restore: the window closes on its own inside an hour",
      D.RESTORE_APPROVAL_TTL_MS <= 60 * 60 * 1000);

    // The owner account cannot be taken over. Another administrator deleting
    // it, demoting it, or clearing its password and pocketing the sign-in
    // code would either destroy the restore authority or simply become the
    // owner — found in the field as a Remove button on the owner's row.
    t.ok("owner account: nobody deletes it, another admin included",
      !!D.ownerAccountRefusal("F9999999", "F1525518", "delete"));
    t.ok("owner account: the owner cannot delete it either",
      !!D.ownerAccountRefusal("F1525518", "F1525518", "delete"));
    t.ok("owner account: nobody demotes it below administrator",
      !!D.ownerAccountRefusal("F1525518", "F1525518", "demote"));
    t.ok("owner account: another admin cannot clear its password",
      !!D.ownerAccountRefusal("F9999999", "F1525518", "clear-password"));
    t.is("owner account: the owner may clear their own password",
      D.ownerAccountRefusal("F1525518", "F1525518", "clear-password"), null);
    t.is("owner account: the owner may edit their own row",
      D.ownerAccountRefusal("F1525518", "F1525518", "edit"), null);
    t.ok("owner account: another admin cannot edit it at all",
      !!D.ownerAccountRefusal("F9999999", "F1525518", "edit"));
    t.is("owner account: every other account is untouched by this rule",
      D.ownerAccountRefusal("F9999999", "E1000", "delete"), null);
    t.ok("owner account: the id is matched case-insensitively",
      !!D.ownerAccountRefusal("F9999999", " f1525518 ", "delete"));

    // The System page's own rules: a device's error report is bounded and
    // scrubbed before it is kept, a looping fault is one row not a hundred,
    // and a run of digits — the shape an MRN takes — never survives into the
    // owner's error store.
    const rep = D.cleanReport({ message: "save failed for MRN 123456 on ward", stack: "x".repeat(5000) }, 1000);
    t.ok("system: digit runs are masked out of reports", !rep.message.includes("123456"));
    t.ok("system: a stack is capped, not kept whole", rep.stack.length <= 900);
    t.is("system: a report with no message is nothing", D.cleanReport({ stack: "s" }, 0), null);
    let list = D.addReport([], D.cleanReport({ message: "boom", build: "b1" }, 1));
    list = D.addReport(list, D.cleanReport({ message: "boom", build: "b1" }, 2));
    t.is("system: the same fault twice is one row", list.length, 1);
    t.is("system: ...counted twice", list[0].count, 2);
    list = D.addReport(list, D.cleanReport({ message: "boom", build: "b2" }, 3));
    t.is("system: the same fault on a NEW build is a new row", list.length, 2);
    for (let i = 0; i < 300; i++) list = D.addReport(list, D.cleanReport({ message: "m" + i, build: "b" }, i));
    t.ok("system: the report list is capped", list.length <= D.REPORT_LIST_CAP);
    const stats = D.latencyStats([5, 1, 3, 100, 2]);
    t.is("system: latency p50 is the middle, not the mean", stats.p50, 3);
    t.is("system: latency max is the outlier itself", stats.max, 100);
    t.ok("system: a silent device is called stale after two minutes",
      D.fleetRow({ lastSeen: 0 }, D.FLEET_STALE_MS + 1).stale);
    t.ok("system: a device just heard from is not",
      !D.fleetRow({ lastSeen: 1000 }, 1500).stale);

    // A settled password request stays settled. An old build queued its ask
    // as a board write and replayed it on every sign-in, flipping the
    // administrator's Dismiss back to pending from a device nobody could
    // see. Board writes may settle a request; only /api/auth/forgot creates.
    const cur = [
      { id: "pw1", accountId: "D11", status: "declined", decidedAt: 5 },
      { id: "pw2", accountId: "F90", status: "pending", ts: 1 },
    ];
    const replay = D.settledResetsHold(cur, [
      { id: "pw1", accountId: "D11", status: "pending", ts: 9 }, // the ghost
      { id: "pw2", accountId: "F90", status: "pending", ts: 1 },
      { id: "pw3", accountId: "D11", status: "pending", ts: 9 }, // created by a board write
    ]);
    t.is("resets: a dismissed request cannot be flipped back to waiting",
      replay.find((r) => r.id === "pw1").status, "declined");
    t.ok("resets: a still-waiting request passes through untouched",
      replay.find((r) => r.id === "pw2").status === "pending");
    t.ok("resets: a board write cannot CREATE a request",
      !replay.find((r) => r.id === "pw3"));
    const settle = D.settledResetsHold(cur, [
      { id: "pw2", accountId: "F90", status: "cleared", decidedAt: 9 },
      { id: "pw1", accountId: "D11", status: "declined", decidedAt: 5 },
    ]);
    t.is("resets: settling a waiting request still works",
      settle.find((r) => r.id === "pw2").status, "cleared");
    t.ok("resets: the old vocabulary ('open') is held to the same rule",
      !D.settledResetsHold([], [{ id: "x", status: "open" }]).length);
    t.is("resets: the guard counts what it refused, so the page can say so",
      D.resetReplayCount(cur, [
        { id: "pw1", accountId: "D11", status: "pending", ts: 9 },
        { id: "pw3", accountId: "D11", status: "pending", ts: 9 },
      ]), 2);
    t.is("resets: a clean settle counts nothing",
      D.resetReplayCount(cur, [{ id: "pw2", accountId: "F90", status: "cleared" }]), 0);

    // Findings: a guard that fires silently is how the last ghost hid.
    let fnd = D.addFinding([], "stale-device", "replayed a settled request", 1);
    fnd = D.addFinding(fnd, "stale-device", "replayed a settled request", 2);
    t.is("findings: the same finding twice is one row counted twice", fnd.length, 1);
    t.is("findings: ...and carries the count", fnd[0].count, 2);
    fnd = D.addFinding(fnd, "sign-in-limiter", "tripped for ID X", 3);
    t.is("findings: a different kind is its own row", fnd.length, 2);
    t.ok("findings: a finding is bounded, and an EMPLOYEE ID survives it whole",
      D.addFinding([], "k", "device of D11111111 " + "y".repeat(999), 1)[0].message.includes("D11111111") &&
      D.addFinding([], "k", "y".repeat(999), 1)[0].message.length <= 240);
    t.ok("findings: a stranger's quoted text is scrubbed by the caller's scrubText",
      !D.scrubText("MRN 1234567 typed as an id", 100).includes("1234567"));
    for (let i = 0; i < 300; i++) fnd = D.addFinding(fnd, "k" + i, "m", i);
    t.ok("findings: the list is capped", fnd.length <= D.FINDING_LIST_CAP);

    // The watchdog: a silent truck on a LIVE call is the one condition worth
    // waking the owner for — judged on the whole crew, because one dead
    // phone with a live partner is the partner's to mention, not an alarm.
    const seen = new Map([["F90", 1000 - 30000], ["F91", 1000 - 400000], ["F92", 1000 - 400000]]);
    const trucks = [
      { id: "m1", name: "MEDIC 1", assignedRequestId: "r1", alpha: { accountId: "F90" }, bravo: { accountId: "F91" } },
      { id: "m2", name: "MEDIC 2", assignedRequestId: "r2", alpha: { accountId: "F92" } },
      { id: "m3", name: "MEDIC 3", alpha: { accountId: "F93" } },
    ];
    const silent = D.silentActiveTrucks(trucks, seen, 1000, 180000);
    t.ok("watchdog: a truck whose WHOLE crew is silent on a call is flagged",
      silent.some((x) => x.unit === "MEDIC 2"));
    t.ok("watchdog: one silent phone with a live partner is not an alarm",
      !silent.some((x) => x.unit === "MEDIC 1"));
    t.ok("watchdog: a truck not on a call is nobody's emergency",
      !silent.some((x) => x.unit === "MEDIC 3"));

    // One small history row per day, hard-bounded.
    let hist = D.historyAppend([], { day: "2026-09-01", requests: 10 });
    hist = D.historyAppend(hist, { day: "2026-09-01", requests: 99 });
    t.is("history: one row per day — the later write replaces", hist.length, 1);
    t.is("history: ...and carries the newer figures", hist[0].requests, 99);
    for (let i = 0; i < 200; i++) hist = D.historyAppend(hist, { day: "d" + String(i).padStart(3, "0") });
    t.ok("history: capped at ninety days", hist.length <= D.HISTORY_CAP);

    t.ok("burst: five errors in ten minutes is a burst",
      D.errorBurst([1, 2, 3, 4, 5], 6, 600000, 5));
    t.ok("burst: five errors across a day is not",
      !D.errorBurst([1, 2, 3, 4, 5].map((n) => n * 3600000), 86400000, 600000, 5));
  }

  // ---------- a no-coverage gap ends when the station closes, not just when
  // a team comes back
  //
  // The opening pass has always known that a station with nobody signed on is
  // CLOSED, not uncovered. The closing pass did not — so a gap declared in the
  // afternoon was held open all night by an empty station, and the morning
  // board read "NO COVERAGE — 19:25:27" over a team standing ready.
  {
    const staffed = (id, station, extra) => ({
      id, name: id.toUpperCase(), station, alpha: { name: "A", accountId: "F1" }, ...extra,
    });
    const onCall = [{ id: "r1", status: "enroute", assignedUnitId: "m1", createdAt: 1 }];
    t.is("coverage: a staffed team standing free ends the gap",
      D.coverageGapCloseReason([staffed("m1", "main")], [], "main"),
      "First team back in service");
    t.is("coverage: every staffed team out keeps it open",
      D.coverageGapCloseReason([staffed("m1", "main")], onCall, "main"), null);
    t.is("coverage: the last team signing off ends it — the station is closed",
      D.coverageGapCloseReason([{ id: "m1", name: "MEDIC 1", station: "main" }], [], "main"),
      "Every team signed off — station closed");
    t.is("coverage: an empty units list reads as a closed station too",
      D.coverageGapCloseReason([], [], "main"), "Every team signed off — station closed");
    // Zahrawi is not coverage — a station holding only Zahrawi is closed for
    // coverage purposes, exactly as the opening pass has always treated it.
    t.is("coverage: Zahrawi alone does not hold a gap open",
      D.coverageGapCloseReason([staffed("z1", "ccc", { name: "ZAHRAWI" })], [], "ccc"),
      "Every team signed off — station closed");
    t.is("coverage: another station's teams decide nothing here",
      D.coverageGapCloseReason([staffed("m1", "main")], [], "ccc"),
      "Every team signed off — station closed");
  }

  // ---------- a board write wakes a phone once, and only for a new assignment
  //
  // The server pushes to a truck's phones the moment a call LANDS on it. The
  // board is written on every small change, so the trigger has to see the
  // difference between "this truck was just handed a call" and "the same call
  // was saved again" — a phone buzzed sixty times per call is a phone whose
  // owner turns notifications off, which is the failure push exists to fix.
  {
    const req = (id, extra) => ({ id, status: "assigned", ...extra });
    t.is("push: a fresh dispatch wakes the truck",
      D.newAssignments([], [req("a", { assignedUnitId: "m1" })]),
      [{ unitId: "m1", requestId: "a", priority: "" }]);
    t.is("push: re-saving the same assignment wakes nobody",
      D.newAssignments(
        [req("a", { assignedUnitId: "m1" })],
        [req("a", { assignedUnitId: "m1", times: { enroute: 5 } })]
      ), []);
    t.is("push: a call moved to another truck wakes the NEW truck",
      D.newAssignments(
        [req("a", { assignedUnitId: "m1" })],
        [req("a", { assignedUnitId: "m2" })]
      ), [{ unitId: "m2", requestId: "a", priority: "" }]);
    t.is("push: a pending call with no truck wakes nobody",
      D.newAssignments([], [req("a", { assignedUnitId: null })]), []);
    t.is("push: a completed call wakes nobody, whatever changed on it",
      D.newAssignments([], [req("a", { assignedUnitId: "m1", status: "completed" })]), []);
    t.is("push: assigning a call that existed unassigned wakes the truck",
      D.newAssignments(
        [req("a", { assignedUnitId: "" })],
        [req("a", { assignedUnitId: "m1", priority: "als" })]
      ), [{ unitId: "m1", requestId: "a", priority: "als" }]);
    t.is("push: a broken previous list is treated as empty, never thrown on",
      D.newAssignments(null, [req("a", { assignedUnitId: "m1" })]).length, 1);
  }

  // ---------- one person locked out is one row, whatever the board holds
  //
  // The forgot-password request had two writers with two vocabularies: the
  // server route wrote `status: "open"`, the app wrote `status: "pending"`,
  // and each dedupe only knew its own word — so the same person appeared on
  // the administrator's panel twice with two Clear password buttons. The
  // panel now reads both words, keeps the newest row per account, and
  // normalises the timestamp whichever build wrote it.
  {
    const rows = [
      { id: "a", accountId: "D1111111", ts: 1000, status: "pending" },
      { id: "b", accountId: "d1111111", at: 2000, status: "open" },
      { id: "c", accountId: "F2002", ts: 500, status: "pending" },
      { id: "d", accountId: "F2003", ts: 900, status: "cleared" },
    ];
    const pending = D.pendingResets(rows);
    t.is("resets: one row per person, however many the board holds", pending.length, 2);
    const khaled = pending.find((r) => String(r.accountId).toUpperCase() === "D1111111");
    t.is("resets: the newest request wins, even under the old word", khaled.id, "b");
    t.is("resets: and its timestamp is readable whichever build wrote it", khaled.ts, 2000);
    t.is("resets: a decided request is not pending", pending.some((r) => r.id === "d"), false);
  }

  // ---------- the role switch translates before it compares
  //
  // The server's word for a crew member's role is "crew"; a session working a
  // truck is role "team". Compared raw, every plain crew member appeared to
  // hold a second role — their own, under its other name — and the header
  // offered "My truck" as a switch into role "crew", which nothing in the app
  // draws: an empty screen with nothing to press, on every crew phone.
  {
    t.is("roles: a plain crew member on their truck is offered nothing",
      D.roleSwitchTarget({ role: "team", unitId: "m1", roles: ["crew"] }), null);
    t.is("roles: a plain dispatcher is offered nothing",
      D.roleSwitchTarget({ role: "dispatcher", roles: ["dispatcher"] }), null);
    t.is("roles: a crew member lent an area is offered administration",
      D.roleSwitchTarget({ role: "team", unitId: "m1", roles: ["crew", "admin"] }), "admin");
    t.is("roles: and from the lent area the way back is their truck",
      D.roleSwitchTarget({ role: "admin", unitId: "m1", roles: ["crew", "admin"] }), "team");
    // A delegate who signed straight into the lent area never took a seat, so
    // there is no truck to offer a way back to.
    t.is("roles: no seat means no way 'back' to a truck",
      D.roleSwitchTarget({ role: "admin", roles: ["crew", "admin"] }), null);
    t.is("roles: an admin on the dispatch desk can go back to administration",
      D.roleSwitchTarget({ role: "dispatcher", roles: ["admin"] }), "admin");
    t.is("roles: a dispatcher lent an area is offered administration",
      D.roleSwitchTarget({ role: "dispatcher", roles: ["dispatcher", "admin"] }), "admin");
    // Whatever is offered, it is always the app's own vocabulary — "crew" is
    // not a role any view is drawn for.
    t.ok("roles: the server's word never reaches the app",
      ["team", "dispatcher", "admin", null].includes(
        D.roleSwitchTarget({ role: "team", unitId: "m1", roles: ["crew", "dispatcher"] })));
  }

  // ---------- the mix lists every category, including the ones at nought
  //
  // Built from the calls alone, a category nothing came in against was absent
  // from the panel — and absent reads as an incomplete list rather than as a
  // nought. What the department was NOT called for is half of what somebody
  // opens this panel to find out.
  {
    const win = [at(2026, 8, 1, 0), at(2026, 9, 1, 0)];
    const call = (id, cat) => ({ id, createdAt: at(2026, 8, 5, 9), callCategory: cat });
    const { rows, total, ran } = D.categoryMixRows(
      [call("a", "ROUTINE"), call("b", "ROUTINE"), call("c", "DISCHARGE"), call("d", "")],
      win[0],
      win[1]
    );
    t.is("mix: every call is counted", total, 4);
    t.is("mix: three categories actually came up", ran, 3);
    t.ok("mix: and every category the department has is listed",
      D.CALL_CATEGORIES.every((c) => rows.some((r) => r.name === c)));
    t.ok("mix: a call nobody coded is its own line, not dropped",
      rows.some((r) => r.name === "Not stated" && r.n === 1));
    t.is("mix: busiest first", rows[0].name, "ROUTINE");
    t.is("mix: and it is the share of the calls, not of the categories",
      Math.round(rows[0].pct), 50);
    t.ok("mix: the ones that never came up sit at the bottom at nought",
      rows[rows.length - 1].n === 0);
    // A period with nothing in it is still the whole list, at nought — not an
    // empty panel that looks broken.
    const empty = D.categoryMixRows([], win[0], win[1]);
    t.is("mix: an empty period still lists every category", empty.rows.length, rows.length - 1);
    t.is("mix: with nothing counted against any of them", empty.ran, 0);
    t.ok("mix: and no percentage is invented from a zero total",
      empty.rows.every((r) => r.pct === 0));
  }

  // ---------- rush is demand against capacity, not calls per hour
  //
  // Two trucks busy is a rush when two are staffed and a quiet spell when five
  // are. And a call waiting with nothing free to send is a rush whatever the
  // arithmetic says — the next call has nowhere to go.
  {
    const u = (id, on, status) => ({ id, name: id, station: "main", status: status || "available",
      alpha: on ? { name: "A", accountId: "F1" } : null, bravo: null });
    const live = (id, unitId) => ({ id, station: "main", status: "assigned", assignedUnitId: unitId,
      createdAt: at(2026, 8, 29, 9) });
    const waiting = (id) => ({ id, station: "main", status: "pending", createdAt: at(2026, 8, 29, 9) });

    t.is("rush: an empty board is quiet",
      D.rushNow([u("m1", true), u("m2", true)], [], "main").level, "quiet");
    t.is("rush: one of three out is steady",
      D.rushNow([u("m1", true), u("m2", true), u("m3", true)],
        [live("c1", "m1")], "main").level, "steady");
    t.is("rush: half the fleet out is busy",
      D.rushNow([u("m1", true), u("m2", true)], [live("c1", "m1")], "main").level, "busy");
    t.is("rush: every staffed truck out is a rush",
      D.rushNow([u("m1", true), u("m2", true)],
        [live("c1", "m1"), live("c2", "m2")], "main").level, "rush");
    t.is("rush: a call waiting with nothing free is a rush whatever the count says",
      D.rushNow([u("m1", true)], [live("c1", "m1"), waiting("c2")], "main").level, "rush");
    t.is("rush: a call waiting WITH a truck free is not yet a rush",
      D.rushNow([u("m1", true), u("m2", true)], [waiting("c1")], "main").waiting, 1);
    // An unstaffed truck is not capacity. Two trucks on the roster with one
    // crew signed on is a one-truck fleet.
    t.is("rush: capacity is staffed trucks, not the roster",
      D.rushNow([u("m1", true), u("m2", false)], [live("c1", "m1")], "main").level, "rush");
    // A stale stored status must not fake capacity — same rule as the counts.
    t.is("rush: a stale available on an empty truck is not a free truck",
      D.rushNow([u("m1", true), u("m2", false, "available")],
        [live("c1", "m1"), waiting("c2")], "main").level, "rush");
    // Stations are counted apart.
    const both = [u("m1", true), { ...u("c9", true), station: "ccc" }];
    t.is("rush: one station's rush is not the other's",
      D.rushNow(both, [live("x", "m1")], "ccc").level, "quiet");
  }

  // ---------- the rush profile reads in operational-day order
  {
    t.is("rush hours: the axis starts where the day starts", D.RUSH_HOURS[0], 7);
    t.is("rush hours: and ends on the last hour of the night", D.RUSH_HOURS[23], 6);

    // Ten days, one call every morning 09:40 - 11:10: hour 9 gets 20 minutes,
    // hour 10 the whole hour, hour 11 ten minutes.
    const calls = [];
    for (let d = 1; d <= 10; d++) {
      calls.push({ id: "r" + d, status: "completed", createdAt: at(2026, 8, d, 9, 40),
        times: { backInService: at(2026, 8, d, 11, 10) } });
    }
    const p = D.rushHourProfile(calls, at(2026, 8, 1, 0), at(2026, 8, 11, 0), at(2026, 8, 20, 0));
    const byHour = Object.fromEntries(p.rows.map((r) => [r.hour, r]));
    t.is("rush hours: a 09:40 start gives hour nine its twenty minutes",
      Number(byHour[9].avg.toFixed(2)), 0.33);
    t.is("rush hours: hour ten is fully loaded", Number(byHour[10].avg.toFixed(2)), 1);
    t.is("rush hours: hour eleven gets its ten minutes", Number(byHour[11].avg.toFixed(2)), 0.17);
    t.is("rush hours: an hour nothing ran in is nought", byHour[3].avg, 0);
    t.is("rush hours: ten calls were raised, all in hour nine", byHour[9].raised, 10);
    t.is("rush hours: the peak is the loaded hour", p.peaks.includes(10), true);

    // A call that crosses midnight loads the night hours of the same
    // operational day, not a phantom morning.
    const night = [{ id: "n", status: "completed", createdAt: at(2026, 8, 5, 23, 30),
      times: { backInService: at(2026, 8, 6, 0, 30) } }];
    const np = D.rushHourProfile(night, at(2026, 8, 1, 0), at(2026, 8, 11, 0), at(2026, 8, 20, 0));
    const nBy = Object.fromEntries(np.rows.map((r) => [r.hour, r]));
    t.ok("rush hours: a midnight-crossing call loads 23 and 00, half each",
      Number((nBy[23].avg * 10).toFixed(1)) === 0.5 && Number((nBy[0].avg * 10).toFixed(1)) === 0.5);

    // Consecutive peaks fold into a range, in the day's own order.
    t.is("rush hours: peaks read as ranges", D.rushHourRanges([9, 10, 19]),
      "09:00\u201311:00 and 19:00\u201320:00");
    t.is("rush hours: the last hour of the night closes at 07:00",
      D.rushHourRanges([6]), "06:00\u201307:00");
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
