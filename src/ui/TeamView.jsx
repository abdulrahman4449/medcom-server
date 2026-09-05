import { closeoutBlockers, closeoutMissingText } from "../domain/call-completeness.jsx";
import { callFrom, callRoute, callTo } from "../domain/call-locations.jsx";
import { CHECKLIST_RUNS_CAP, CHECKLIST_RUNS_KEY, CHECK_ANSWERS, checklistIsMandatory, checklistPartForSeat, checklistRunFor, isWriteItem, personChecklistRun, shiftKeyFor } from "../domain/checklist.jsx";
import { callCloseReason } from "../domain/close-reasons.jsx";
import { PRIORITY, REQ_STATUS, reqStatusMeta, TIME_STEPS, editFieldLabel, editValueText, pendingCallEdits, priorityKeyOf, proposeCallEditsTo, reqLabels } from "../domain/constants.jsx";
import { stampStep } from "../domain/stamping.jsx";
import { escalationViewer, lastAdminReply } from "../domain/escalations.jsx";
import { effectiveStatusMeta, idleStatusFor, liveRequestFor, statusMeta } from "../domain/in-service.jsx";
import { DEFAULT_STATION, atStation, stationLabel, stationOf } from "../domain/live-sheet.jsx";
import { BASE_TITLE, buzz, clearCallAlert, clockStr, msDurationStr, otHoursStr, shortDurationStr } from "../domain/messages.jsx";
import { opDayKey, opDayStart } from "../domain/op-day.jsx";
import { OOS_REASONS, oosRequestOf } from "../domain/out-of-service.jsx";
import { NO_TRANSPORT, REFUSAL_FROM_STATUSES, REFUSAL_TIME_KEY } from "../domain/outcomes.jsx";
import { pcrAuthorChoices, pcrAuthorOf, pcrAuthorText } from "../domain/pcr-author.jsx";
import { callsAwaitingRestock, markRestocked } from "../domain/restock.jsx";
import { activeAssistUnitIds, assistOf, assistPending, assistTeamFor, assistTeams, isNoTransport } from "../domain/second-ambulance.jsx";
import { ADDED_SERVICES, CALL_TYPES, LOADED_KM, LOADED_KM_COLOR, applyCallCoding, callTypeOf, loadedKmOf, suggestedCallType } from "../domain/sheet-vocabulary.jsx";
import { overtimeClaimId, overtimeReasonProblem, sendOvertimeClaim } from "../domain/overtime.jsx";
import { crewShiftWindow, hhmm, overtimeMs, scheduledShiftKey, seatLabel, shiftMeta, shiftPhrase, shiftRemainingMs, shiftWindowAt, shiftWindowStr } from "../domain/shift-helpers.jsx";
import { consentFor, needsConsentPrompt, recordConsent } from "../domain/truck-locations.jsx";
import { nativeAlarm, soundCallAlert, soundReminderTone, soundSpeakerCheck, soundStandDownTone, speakStandDown } from "../lib/dates.jsx";
import { changedFieldsSince, newestDispatchEditAt, seenBaselineFor, unseenDispatchEdits } from "../domain/call-changes.jsx";
import { markEditsSeen, readEditsSeen } from "../lib/edits-seen.jsx";
import { uid } from "../lib/helpers.jsx";
import { AlertTriangle, Ambulance, Ban, CalendarClock, CheckCircle2, ChevronRight, Circle, Clock, FileSignature, HandRaised, PencilLine, PhoneIncoming, Radio, Users } from "../lib/icons.jsx";
import { notifyAssignedCall } from "../lib/notify.jsx";
import { readKey, writeKey, writeList } from "../lib/offline-queue.jsx";
import { answerHandover, askForMySeat, handoverIsAsk, handoverRequest } from "../domain/seat-handover.jsx";
import { useEffect, useRef, useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";
import { SectionBanner } from "./AdminView.jsx";
import { AlarmOverlay, AlertToneCheck, BackgroundAlertNotice, CallAlertNotice, SoundDiagnostics } from "./AlarmOverlay.jsx";
import { markSpeakerCheckDone, speakerCheckDone, speakerCheckDue, speakerCheckKey, speakerCheckResult } from "../domain/speaker-check.jsx";
import { CallEditForm, CallRoute, ChecklistCard, EditHistory, InfoNote, ReceiverBanner, RefusalForm } from "./AssistanceTasks.jsx";
import { CallRestock } from "./CallRestock.jsx";
import { ChatDock, useMessageAlerts } from "./ChatDock.jsx";
import { CompletedCalls, EscalationChip, EscalationThread } from "./Escalations.jsx";
import { useTracking } from "./FleetMap.jsx";
import { TrackingBar, TrackingConsentModal } from "./LocationAsk.jsx";
import { AssistStatusLine, CallCodingBlock, CallStepper, CallTypeTag, LoadedKmTag, NoTransportTag, PcrAuthorTag } from "./StatusBoard.jsx";

// ---------- team view ----------

export function TeamView({ onHandOver, user, units, requests, saveUnits, saveRequests, addLog, audioCtxRef, checklists, checklistRuns, setChecklistRuns, page, onGoToPage, messages, setMessages, inventory, inventoryMoves, setInventoryMoves, restockDone, setRestockDone, coldReady, locations, setLocations, trackingConsents, setTrackingConsents, overtimeSent, setOvertimeSent, submissions }) {
  const myUnit = units.find((u) => u.id === user.unitId);
  // A crew belongs to the station their truck is at, and sees nothing of the
  // other one. As on the desk, the full arrays are left alone for saving —
  // these are only what gets shown.
  const myStation = myUnit ? stationOf(myUnit) : (user.station || DEFAULT_STATION);
  const stationUnits = atStation(units, myStation);
  const stationRequests = atStation(requests, myStation);
  // Only a call that is still running counts as this crew's assignment. A
  // completed one left behind by a stale pointer must not resurface here — and
  // certainly must not restart the alarm.
  const myRequest = liveRequestFor(myUnit, requests);

  // Dispatch changed the call while the crew were on it (domain/call-changes).
  // A tone when a new desk edit lands, a red star on each changed line, and
  // both stay until the crew tap Seen. Per device, per call.
  const [editsSeenAt, setEditsSeenAt] = useState(0);
  const editsToneRef = useRef(null);
  useEffect(() => {
    editsToneRef.current = null;
    if (!myRequest) return;
    setEditsSeenAt(readEditsSeen(myRequest.id) || seenBaselineFor(myRequest));
  }, [myRequest && myRequest.id]);
  const newestDeskEdit = myRequest ? newestDispatchEditAt(myRequest) : 0;
  useEffect(() => {
    if (!myRequest) return;
    if (editsToneRef.current !== null && newestDeskEdit > editsToneRef.current) {
      // Forced, like a message from the desk: a change to the destination
      // that arrives under a lowered volume chip is a change nobody heard.
      soundReminderTone(audioCtxRef, true);
      buzz([180, 90, 180]);
    }
    editsToneRef.current = newestDeskEdit;
  }, [newestDeskEdit, myRequest && myRequest.id]);
  const unseenEdits = myRequest ? unseenDispatchEdits(myRequest, editsSeenAt) : [];
  const changedFields = myRequest ? changedFieldsSince(myRequest, editsSeenAt) : new Set();
  const Star = ({ field }) =>
    changedFields.has(field) ? (
      <span title="Changed by Dispatch" style={{ color: "var(--crit)", fontWeight: 800, marginRight: 5 }}>★</span>
    ) : null;
  function markChangesSeen() {
    if (!myRequest) return;
    markEditsSeen(myRequest.id, newestDeskEdit);
    setEditsSeenAt(newestDeskEdit);
  }
  // The elapsed-time figure on the card, and it ticks every SECOND. A quarter
  // minute was cheaper and read as a broken clock: the seconds sat on 00:02:58
  // for fifteen seconds and then jumped to 00:03:13, which a crew watching a
  // response time reads as the app having frozen. A card is a handful of
  // elements; one re-render a second is nothing beside a stopwatch nobody
  // trusts.
  const [clockNow, setClockNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const callEditsApplied = (req) => (req && Array.isArray(req.edits) ? req.edits : []).some((e) => e && e.status === "applied");
  // A call this team was sent to as the second ambulance, rather than one that
  // is theirs to run. The team that owns the call keeps the timeline; an
  // assisting team's job is to turn up, help, and clear when they're done.
  const assistTeam = myUnit && myRequest ? assistTeamFor(myRequest, myUnit.id) : null;
  const assisting = !!(assistTeam && myRequest.assignedUnitId !== myUnit.id);
  const primaryUnit = assisting ? units.find((u) => u.id === myRequest.assignedUnitId) : null;
  // An assisting team is alerted exactly like the team that got the call: by
  // the time they are sent the call is well past "assigned", so waiting for
  // that status would leave their tablet silent. Their acknowledgement is their
  // own, kept on their entry in the call's assist record.
  const alarmActive = assisting
    ? !assistTeam.acknowledgedAt
    : !!(myRequest && myRequest.status === "assigned" && !myRequest.acknowledged);
  // Starts EMPTY unless this shift has already confirmed a number. The field
  // used to open on whatever the last crew typed, so the person signing on
  // pressed Confirm beside last shift's truck — the one thing the prompt below
  // exists to prevent.
  const [ambulanceInput, setAmbulanceInput] = useState(() =>
    myUnit && myUnit.ambulanceNumber &&
    myUnit.ambulanceShiftStart === (user.shiftStart || shiftWindowAt(Date.now()).start)
      ? myUnit.ambulanceNumber
      : ""
  );
  // The board arrives a moment after this screen does, so the field was
  // initialised from a unit that was still empty and then never caught up —
  // which looked like the number had not been saved at all. It follows the
  // board now, except while somebody is typing into it.
  const ambulanceTouched = useRef(false);
  useEffect(() => {
    if (ambulanceTouched.current) return;
    // Only mirror the board's number once this shift has confirmed it. Before
    // that the field stays empty, so nobody confirms last shift's truck by
    // pressing a button beside a number that was already filled in.
    //
    // The test is worked out here rather than read from further down the
    // component: a const declared below is in its temporal dead zone while this
    // effect body is being created, and reaching for it crashed the crew screen.
    const confirmedThisShift =
      myUnit &&
      myUnit.ambulanceShiftStart === (user.shiftStart || shiftWindowAt(Date.now()).start);
    if (myUnit && myUnit.ambulanceNumber && confirmedThisShift) {
      setAmbulanceInput(myUnit.ambulanceNumber);
    }
  }, [myUnit && myUnit.ambulanceNumber, myUnit && myUnit.ambulanceShiftStart]);
  // Whether the escalation thread on the live call is unfolded.
  const [escOpen, setEscOpen] = useState(false);
  // Whether the "these details are wrong" form is open on the live call.
  const [editOpen, setEditOpen] = useState(false);
  // Whether the refusal is being signed for.
  const [refusalOpen, setRefusalOpen] = useState(false);
  const [assistOpen, setAssistOpen] = useState(false);
  const [assistWhat, setAssistWhat] = useState("");
  const [checklistOpen, setChecklistOpen] = useState(false);
  // Asking to come off the run.
  // A call called off while the crew are on the way.
  //
  // The desk standing a call down is the one change to this screen that must
  // reach the crew without them looking at it. They are moving — possibly on
  // lights — towards somewhere they no longer need to go, and the call card
  // quietly disappearing is not a message. It is also the change most likely to
  // happen while the tablet is face-down on the dash.
  //
  // So it sounds, and it keeps saying so on screen until somebody clears it.
  // The full alert tone rather than the soft reminder: turning a truck around
  // is urgent, and it is the same sound they already associate with "look at
  // the screen now".
  // A message from the desk on this crew's own thread.
  useMessageAlerts(messages, "crew", myUnit ? [myUnit.id] : [], audioCtxRef);

  // ---------- location ----------
  //
  // Four conditions, all of which have to hold: this crew are on a call, this
  // device is the Alpha seat, this person has agreed, and the browser will give
  // a position. The seat check is what makes one truck one dot — two phones in
  // one vehicle reporting opposite corners of a car park is noise, and Alpha is
  // the seat the department named.
  const isAlpha = !!(myUnit && myUnit.alpha && user && myUnit.alpha.accountId === user.accountId);
  const shouldTrack = !!(myRequest && myUnit && isAlpha && !assisting);

  // Said out loud on the crew's own screen, so "the map is empty" is never a
  // mystery anybody has to debug from the desk.
  const trackingReason = (() => {
    if (!myRequest) return "";
    if (assisting) return "Location off — the team who own this call share the position";
    if (!isAlpha) return "Location is shared from the Alpha seat's device, not this one";
    if (!user || !user.accountId) return "Location off — this session has no employee ID against it";
    const c = consentFor(trackingConsents, user.accountId);
    if (!c) return "Waiting for your answer about sharing this truck's position";
    if (c.status === "refused") return "You declined location — the desk cannot see this truck";
    return "";
  })();
  const tracking = useTracking({
    unit: myUnit,
    request: myRequest,
    user,
    consents: trackingConsents,
    setLocations,
    active: shouldTrack,
    // Whose job it is to clean up when the call ends — the same seat that does
    // the sending, and nobody else.
    responsible: isAlpha,
  });

  // Asked when a call arrives, not at sign-on: consent for something is asked
  // for at the moment the something is about to happen, which is also the only
  // moment the answer is meaningful.
  const [consentOpen, setConsentOpen] = useState(false);
  useEffect(() => {
    if (!shouldTrack) {
      setConsentOpen(false);
      return;
    }
    setConsentOpen(needsConsentPrompt(trackingConsents, user && user.accountId));
  }, [shouldTrack, trackingConsents, user && user.accountId]);

  async function decideTracking(status, reason) {
    const next = await recordConsent({
      accountId: user && user.accountId,
      name: (user && user.name) || "",
      status,
      reason,
    });
    if (!next) {
      window.alert(
        "That could not be saved — there is no signal to the server right now.\n\n" +
          "Nothing is being shared in the meantime. Try again when the connection is back."
      );
      return;
    }
    setTrackingConsents(next);
    setConsentOpen(false);
    await addLog(
      status === "granted"
        ? `${(user && user.name) || "A crew member"} allowed location while on a call`
        : `${(user && user.name) || "A crew member"} declined location — ${reason}`,
      "status"
    );
  }

  // Calls this truck has finished on this shift with nobody having said the
  // truck was made up again afterwards.
  // Nothing until the slow poll has answered: the marks live on it, and before
  // they land every finished call looks unrestocked — a nudge that flashed on
  // every refresh and vanished a moment later.
  const awaitingRestock = coldReady
    ? callsAwaitingRestock(requests, myUnit && myUnit.id, crewShiftWindow(user, Date.now()).start, restockDone)
    : [];

  // Bumped whenever this screen comes back to the front, so the alarm can tell
  // "still running" from "running since before the phone was put away".
  const [wokeAt, setWokeAt] = useState(0);
  const alarmWokeAt = useRef(0);
  useEffect(() => {
    const wake = () => {
      try {
        if (typeof document !== "undefined" && document.hidden) return;
      } catch (e) {
        // no visibility API; treat it as awake
      }
      setWokeAt(Date.now());
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    let handle = null;
    try {
      const app = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (app && typeof app.addListener === "function") {
        const added = app.addListener("appStateChange", (state) => {
          if (state && state.isActive) setWokeAt(Date.now());
        });
        if (added && typeof added.then === "function") added.then((h) => (handle = h));
        else handle = added;
      }
    } catch (e) {
      // no shell
    }
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      try {
        if (handle && typeof handle.remove === "function") handle.remove();
      } catch (e) {
        // already gone
      }
    };
  }, []);

  const wasOnCall = useRef(null);
  const [calledOff, setCalledOff] = useState(null);
  // Which call has already been announced as stood down on this device.
  const standDownFor = useRef(null);
  useEffect(() => {
    if (!myUnit) {
      wasOnCall.current = null;
      return;
    }
    const prev = wasOnCall.current;
    if (myRequest) {
      wasOnCall.current = { id: myRequest.id };
      return;
    }
    wasOnCall.current = null;
    if (!prev) return;
    const gone = (requests || []).find((r) => r && r.id === prev.id);
    if (!gone || gone.status !== "completed") return;
    // A crew who stamped Back in Service themselves closed their own call and
    // do not need to be told about it. This is only for a call ended out from
    // under them.
    if (gone.times && gone.times.backInService) return;
    // Once per call, whatever route gets here. The effect re-runs on every
    // poll, and anything that let it fire twice announced the same stand-down
    // to a crew twice over - which reads as two cancelled calls.
    if (standDownFor.current === gone.id) return;
    standDownFor.current = gone.id;
    // The buzz here; the sound belongs to the banner's own effect below, which
    // runs the moment calledOff is set. Announcing it in both places spoke the
    // sentence twice over from two different starting points, and the second
    // one cut the first one off.
    buzz([400, 150, 400, 150, 400]);
    setCalledOff({
      nature: gone.nature || "the call",
      reason: callCloseReason(gone),
      by: gone.closedBy || "the desk",
      at: gone.closedAt || Date.now(),
    });
    // And put it in front of them. A stand-down that arrives while the crew are
    // reading the inventory is a stand-down nobody sees, and they are driving.
    if (onGoToPage) onGoToPage("board");
  }, [myRequest && myRequest.id, requests, myUnit && myUnit.id]);

  // It keeps sounding until somebody says they have heard it.
  //
  // One tone was not enough: the whole point of a stand-down is that the crew
  // are moving, often with a siren on, and a single chime behind that is
  // nothing. It repeats every six seconds — long enough not to be a wall of
  // noise, short enough that it cannot be mistaken for having stopped — until
  // "Understood" is pressed, which is also the only thing that clears the
  // banner. Nothing else silences it: not switching pages, not the volume chip.
  useEffect(() => {
    if (!calledOff) return;
    // A single chime every six seconds was not enough behind a running siren.
    // Three tones in quick succession, every four seconds, with a longer buzz -
    // a stand-down is the one message where being annoying is the point, and it
    // stops the instant somebody presses Understood.
    // The tone leads, and the words follow it. This order is the whole fix for
    // "the phrase played, the tone did not, and then a tone arrived a few
    // seconds later" - reported twice off a real handset.
    //
    // It used to speak first and sound underneath. Speaking takes the device's
    // audio session: on iOS an utterance activates its own, and on Android it
    // takes audio focus. `speakStandDown` says the sentence at 220ms and again
    // at 2000ms, roughly 1.8 seconds each, so the voice holds the audio for
    // about the first four seconds - which is exactly where the first three
    // tones were scheduled. They were being spoken over. The first tone the
    // crew actually heard was the repeat at four seconds, once the voice had
    // finished, and that is the delay that was described.
    //
    // So: tone first, on its own; the sentence once the tones have cleared;
    // the repeat once the sentence has. Nothing is scheduled on top of
    // anything else, and the tone - the part that carries the meaning fastest
    // - is the part that is never late.
    const SPEAK_AFTER_MS = 1400;
    const REPEAT_AFTER_MS = 5600;
    // Every pending timer, so pressing Understood silences all of it and
    // nothing fires into a banner that is already gone.
    const timers = new Set();
    const later = (fn, ms) => {
      const id = setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
      return id;
    };

    const sound = () => {
      soundStandDownTone(audioCtxRef);
      later(() => soundStandDownTone(audioCtxRef), 450);
      later(() => soundStandDownTone(audioCtxRef), 900);
      buzz([500, 150, 500, 150, 500]);
    };

    sound();
    later(speakStandDown, SPEAK_AFTER_MS);
    let repeat = null;
    later(() => {
      sound();
      repeat = setInterval(sound, 4000);
    }, REPEAT_AFTER_MS);

    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
      if (repeat) clearInterval(repeat);
      // Nothing half-spoken outlives the banner.
      try {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
      } catch (e) {
        // no voice on this device
      }
    };
  }, [calledOff]);

  // A reply that arrives silently is a reply nobody reads.
  //
  // The crew asked a question and then went back to work; a chip changing
  // colour somewhere behind the call card is not going to reach them. The tone
  // is the routine one — this is worth knowing, not worth interrupting a
  // patient for.
  const lastReplySeen = useRef(null);
  useEffect(() => {
    if (!myUnit) return;
    let newest = null;
    (requests || []).forEach((r) => {
      if (r.assignedUnitId !== myUnit.id) return;
      (r.escalations || []).forEach((esc) => {
        const reply = lastAdminReply(esc);
        if (reply && (!newest || reply.ts > newest)) newest = reply.ts;
      });
    });
    if (newest && lastReplySeen.current !== null && newest > lastReplySeen.current) {
      soundReminderTone(audioCtxRef);
    }
    lastReplySeen.current = newest;
  }, [requests, myUnit && myUnit.id]);

  const [oosOpen, setOosOpen] = useState(false);
  const [oosReason, setOosReason] = useState("");
  const [oosNote, setOosNote] = useState("");
  // A refusal stays on screen until the crew says they have read it — and once
  // they have, it stays read.
  //
  // "Understood" used to set a piece of component state, which lasted exactly
  // as long as this screen was mounted. Policies is a shared page, so opening
  // it unmounts the crew view; coming back rebuilt it with the flag cleared and
  // the refusal in their face again. From the crew's side the button did
  // nothing, every single time.
  //
  // Remembered on the device rather than on the board: it is a fact about who
  // has read something on this screen, not about the truck, and writing it to
  // the board would have every tablet posting the whole unit list back to say
  // so. Keyed by the answer's timestamp, so a *new* refusal is a new notice.
  const oosAnsweredAt =
    (myUnit && myUnit.oosRequest && myUnit.oosRequest.answeredAt) || 0;
  const oosSeenKey = `ems:oosSeen:${(myUnit && myUnit.id) || "none"}`;
  const [dismissedOos, setDismissedOos] = useState(false);
  useEffect(() => {
    let seen = 0;
    try {
      seen = Number(window.localStorage.getItem(oosSeenKey) || 0);
    } catch (e) {
      // a device that cannot remember shows the notice again; no worse than before
    }
    setDismissedOos(!!oosAnsweredAt && seen === oosAnsweredAt);
  }, [oosAnsweredAt, oosSeenKey]);

  function dismissOos() {
    try {
      window.localStorage.setItem(oosSeenKey, String(oosAnsweredAt));
    } catch (e) {
      // ignore
    }
    setDismissedOos(true);
  }

  // A crew who come across an emergency.
  //
  // Somebody collapses in the corridor in front of them, or a ward calls them
  // over as they pass. Until now that call reached the board by telephone and
  // was typed in afterwards from memory, so its times were always an estimate
  // and it was always the worst-documented call of the shift. The crew can now
  // open it themselves, from where they are standing, and the desk is told at
  // once.
  async function raiseOwnEmergency() {
    if (!myUnit) return;
    const where = window.prompt("Where are you? This is the pick-up location.");
    if (where === null) return;
    if (!where.trim()) {
      window.alert("The desk needs to know where you are.");
      return;
    }
    const what = window.prompt("What is it? Say enough for the desk to send help if you need it.");
    if (what === null) return;

    const now = Date.now();
    const fresh = await readKey("ems:requests", requests);
    const req = {
      id: uid("req"),
      station: stationOf(myUnit),
      nature: (what || "").trim() || "Emergency found by crew",
      locationFrom: where.trim(),
      locationTo: "",
      priority: "als",
      status: "onscene",
      createdAt: now,
      createdBy: user.name || "Crew",
      // Raised by the crew who are already standing on it, so the first three
      // stamps are true at the moment it opens.
      //
      // Pending the desk's confirmation, not the desk's permission. The crew
      // are with a patient either way and their clock is already running — what
      // the desk confirms is that the call is on the board, has a number, and
      // is being counted. A crew waiting for a yes before they start treating
      // is the one outcome this must never produce.
      raisedByCrew: true,
      crewRaise: {
        status: "pending",
        byName: user.name || "",
        byAccountId: user.accountId || "",
        at: now,
      },
      assignedUnitId: myUnit.id,
      assignedAt: now,
      times: { enroute: now, arrival: now },
      escalations: [],
    };
    await saveRequests([req, ...fresh]);
    const freshUnits = await readKey("ems:units", units);
    await saveUnits(
      freshUnits.map((u) =>
        u.id === myUnit.id ? { ...u, status: "onscene", assignedRequestId: req.id } : u
      )
    );
    await addLog(
      `${myUnit.name} came across an emergency at ${where.trim()}${
        (what || "").trim() ? ` — ${what.trim()}` : ""
      } · raised by ${user.name || "the crew"}`,
      "status"
    );
  }

  async function requestOutOfService() {
    if (!myUnit || !oosReason) return;
    const now = Date.now();
    const fresh = await readKey("ems:units", units);
    await saveUnits(
      fresh.map((u) =>
        u.id === myUnit.id
          ? {
              ...u,
              oosRequest: {
                id: uid("oos"),
                status: "pending",
                reason: oosReason,
                note: oosNote.trim(),
                byName: user.name || "",
                byAccountId: user.accountId || "",
                seat: user.slot || null,
                askedAt: now,
              },
            }
          : u
      )
    );
    await addLog(
      `${myUnit.name} asked to go out of service — ${oosReason}` +
        (oosNote.trim() ? `: ${oosNote.trim()}` : "") +
        ` · requested by ${user.name || "crew"}`,
      "status"
    );
    setOosOpen(false);
    setOosReason("");
    setOosNote("");
  }

  async function cancelOosRequest() {
    if (!myUnit) return;
    const fresh = await readKey("ems:units", units);
    await saveUnits(fresh.map((u) => (u.id === myUnit.id ? { ...u, oosRequest: null } : u)));
    await addLog(`${myUnit.name} withdrew its out-of-service request`, "status");
  }
  // Which page the bar is showing. A crew's call is the thing they must never
  // have to hunt for, so it is the default and always one tap away.
  const onPage = (k) => !page || page === k;
  // Which action this crew has just tapped. Every one of these starts with a
  // read from the server, so on a weak signal there was a pause with nothing on
  // screen to show the tap had registered — and crews tapped again. The button
  // now says so the instant it is pressed, and refuses a second tap while it
  // works.
  const [acting, setActing] = useState(null);

  // Wraps any crew action so the screen answers immediately and the same tap
  // cannot be fired twice.
  async function runAction(name, fn) {
    if (acting) return;
    setActing(name);
    try {
      await fn();
    } finally {
      setActing(null);
    }
  }
  const alarmIntervalRef = useRef(null);
  const alarmingRequestId = useRef(null);
  const notifiedRequestId = useRef(null);

  // (A second, unguarded mirror of the board's number used to live here. It
  // undid the guard above on every poll: the night crew's field filled itself
  // with the day crew's truck. The guarded effect above is the only mirror.)

  // Persistent alarm: starts the moment a call is assigned to this unit and
  // has not yet been acknowledged, and keeps sounding until it is.
  //
  // The tone alone only reaches a crew who are looking at this tab with the
  // sound already unlocked, which is not how a tablet in an ambulance is
  // usually sitting. So the same condition also raises a system notification
  // and buzzes the device, and every repeat tries to resume an audio context
  // the browser may have suspended while the page was in the background.
  useEffect(() => {
    const needsAlarm = alarmActive;

    if (needsAlarm) {
      if (notifiedRequestId.current !== myRequest.id) {
        notifiedRequestId.current = myRequest.id;
        notifyAssignedCall(myRequest, myUnit ? myUnit.name : "");
      }
      // Already running for this call — unless the app has just come back to
      // the front since it started. A phone that was suspended had its timers
      // frozen with it, and iOS interrupts the page's audio while the app is
      // away, so the loop that "is still running" on paper may not have made a
      // sound since before the screen locked. Coming back re-arms it: stop and
      // start again, which sounds immediately.
      if (
        alarmIntervalRef.current &&
        alarmingRequestId.current === myRequest.id &&
        alarmWokeAt.current === wokeAt
      )
        return;
      alarmWokeAt.current = wokeAt;
      stopAlarmLoop();
      alarmingRequestId.current = myRequest.id;
      const sound = () => {
        // Creating and waking the context is part of playing, not something
        // done once at sign-in — so a crew who left this tab in the background
        // still hear the repeat that lands after they come back to it.
        // Through priorityKeyOf, not off the raw field.
        //
        // A call's level of care is decided by its category first — the desk
        // coding a patient as C (CCT) is what makes it a critical care
        // transfer — and `priority` is only the fallback for a call with no
        // category on it yet. Reading the raw field skipped that entirely, so a
        // CCT patient coded at the desk arrived on the crew's tablet with the
        // routine BLS chime: the one tone that tells a crew this is not urgent.
        //
        // It also mixed up the old vocabulary. priorityKeyOf maps legacy
        // "urgent" to cct and "critical" to als; toneKeyFor maps those two
        // words the other way round. Anything going straight from the stored
        // field to the tone therefore had them crossed. One route in, and both
        // agree.
        soundCallAlert(audioCtxRef, priorityKeyOf(myRequest), true);
        // Vibration alongside the tone, not instead of it: on a phone face-down
        // in a cradle the buzz is what gets noticed first, and it is the one
        // channel a hardware silent switch does not touch.
        buzz([600, 200, 600, 200, 900]);
      };
      sound();
      alarmIntervalRef.current = setInterval(sound, 1700);
    } else {
      stopAlarmLoop();
      clearCallAlert();
      notifiedRequestId.current = null;
    }
    return () => {
      // keep running across re-renders; only cleared on unmount or when the alarm condition clears
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myRequest && myRequest.id, myRequest && myRequest.status, myRequest && myRequest.acknowledged, alarmActive, wokeAt]);

  useEffect(() => {
    return () => {
      stopAlarmLoop();
      clearCallAlert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // clear on unmount

  // ---- the speaker check that nobody has to remember ----
  //
  // At sign-on, once, on the shell only: play the dispatch tone down the same
  // path a real call takes and put the answer on the screen. The buttons below
  // have always been there and are pressed on somebody's first day and never
  // again; a phone that has gone silent since then is discovered by missing a
  // call. This is the check that happens while the crew are still standing at
  // the truck.
  //
  // It runs through the plugin's alarm stream, which needs no tap — page audio
  // does, which is why this never runs in a browser: silence pretending to be a
  // check is worse than no check, because silence reads as a broken speaker.
  const [speakerCheck, setSpeakerCheck] = useState(null);
  const speakerCheckRan = useRef(false);
  useEffect(() => {
    if (speakerCheckRan.current) return;
    const key = speakerCheckKey(user, myUnit);
    let store = null;
    try { store = window.localStorage; } catch (e) { store = null; }
    const done = speakerCheckDone(key, store);
    if (!speakerCheckDue({
      key,
      hasShell: !!nativeAlarm(),
      alarmActive,
      // A truck already out on a call is working, and a phone that has been
      // dispatched has just proved the point anyway.
      onCall: !!myRequest,
      done,
    })) return;
    speakerCheckRan.current = true;
    markSpeakerCheckDone(key, store);
    // A moment after the screen settles, so it does not land in the middle of
    // the sign-in transition.
    const t = setTimeout(() => {
      Promise.resolve(soundSpeakerCheck(audioCtxRef, "als"))
        .then((r) => setSpeakerCheck(speakerCheckResult(r)))
        .catch(() => setSpeakerCheck(speakerCheckResult(null)));
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user && user.accountId, myUnit && myUnit.id, user && user.shiftStart, alarmActive, myRequest && myRequest.id]);

  function stopAlarmLoop() {
    if (alarmIntervalRef.current) {
      clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }
    alarmingRequestId.current = null;
    buzz(0);
  }

  // A crew who have this board open on another tab see nothing of the overlay,
  // so the tab strip itself carries the alert until the call is acknowledged.
  useEffect(() => {
    if (!alarmActive) {
      document.title = BASE_TITLE;
      return;
    }
    let on = false;
    const flash = () => {
      on = !on;
      document.title = on ? "🚨 INCOMING CALL" : BASE_TITLE;
    };
    flash();
    const t = setInterval(flash, 900);
    return () => {
      clearInterval(t);
      document.title = BASE_TITLE;
    };
  }, [alarmActive]);

  async function acknowledgeCall() {
    if (!myRequest) return;
    stopAlarmLoop();
    clearCallAlert();
    const now = Date.now();
    const freshRequests = await readKey("ems:requests", requests);
    const nextRequests = freshRequests.map((r) => {
      if (r.id !== myRequest.id) return r;
      // An assisting team acknowledge on their own line. The owning team's
      // acknowledgement is what dispatch watches for the call itself, and a
      // second team turning up must not tick that box on their behalf.
      if (assisting) {
        return {
          ...r,
          assist: {
            ...assistOf(r),
            teams: assistTeams(r).map((t) =>
              t.unitId === myUnit.id && !t.clearedAt ? { ...t, acknowledgedAt: t.acknowledgedAt || now } : t
            ),
          },
        };
      }
      return { ...r, acknowledged: true };
    });
    await saveRequests(nextRequests);
    // Tagged as a board event: an acknowledgement is one of the two lines the
    // dispatcher's log sheet still shows live.
    await addLog(
      assisting
        ? `${myUnit.name} acknowledged assist request — ${myRequest.nature}`
        : `${myUnit.name} acknowledged call — ${myRequest.nature}`,
      "status",
      { event: "ack", unitName: myUnit.name, requestId: myRequest.id, assisting: !!assisting }
    );
  }

  // The ambulance a medic is running is a fact about the shift, not about the
  // unit for ever. Trucks are swapped for servicing, and the number left over
  // from last week quietly went onto this week's calls — which is exactly the
  // column the finance and maintenance records are matched on. So it is stamped
  // with the shift it was entered for, and asked for again each shift.
  async function saveAmbulanceNumber() {
    if (!myUnit) return;
    const n = ambulanceInput.trim();
    const freshUnits = await readKey("ems:units", units);
    const nextUnits = freshUnits.map((u) =>
      u.id === myUnit.id
        ? {
            ...u,
            ambulanceNumber: n,
            ambulanceShiftStart: user.shiftStart || shiftWindowAt(Date.now()).start,
            ambulanceSetBy: user.name || "",
            ambulanceSetAt: Date.now(),
          }
        : u
    );
    await saveUnits(nextUnits);
    ambulanceTouched.current = false;
    await addLog(
      `${myUnit.name} — ambulance #${n || "—"} recorded for ${shiftPhrase(user)} by ${user.name || "the crew"}`,
      "status"
    );
  }

  async function setStatus(status) {
    const freshUnits = await readKey("ems:units", units);
    const freshRequests = await readKey("ems:requests", requests);
    const nextUnits = freshUnits.map((u) => {
      if (u.id !== myUnit.id) return u;
      // Setting the status by hand also drops a pointer to a call that has
      // already finished, so dispatch stops seeing this team as committed to it.
      const stale = u.assignedRequestId && !liveRequestFor(u, freshRequests);
      return { ...u, status, assignedRequestId: stale ? null : u.assignedRequestId };
    });
    await saveUnits(nextUnits);
    // A team helping on someone else's call has no timeline to stamp, so this
    // is the only place their "en route" is recorded — it carries the same tag
    // the timeline step does so it reaches the log sheet too.
    await addLog(
      `${myUnit.name} marked ${statusMeta(status).label}`,
      "status",
      status === "enroute" ? { event: "enroute", unitName: myUnit.name } : undefined
    );
  }

  // Advances the call through the fixed timeline (TIME_STEPS), stamping the
  // current time for the step just completed.
  async function recordStep(step) {
    if (!myRequest || !myUnit) return;
    // The timeline belongs to the team the call was assigned to. A team that is
    // only there to help never stamps it.
    if (assisting) return;
    const now = Date.now();
    const freshRequests = await readKey("ems:requests", requests);
    const freshUnits = await readKey("ems:units", units);
    const target = freshRequests.find((r) => r.id === myRequest.id) || myRequest;
    // The call does not close without a name against its patient care report, a
    // category and a loaded-kilometer band. Checked here against the fresh copy
    // as well as on the button, so a crew working from two tablets cannot slip
    // the last step past it.
    const blockers = closeoutBlockers(target, step);
    if (blockers.length > 0) {
      const lines = {
        pcrAuthor: "• PCR AUTHOR — pick Alpha or Bravo, whoever is writing the patient care report.",
        callType: "• CATEGORY OF CALL — A, B, C, D, E or N/A.",
        loadedKm: "• LOADED KILOMETERS — the band the loaded leg fell into.",
      };
      window.alert(
        `Record ${closeoutMissingText(blockers)} before going back in service.\n\n` +
          blockers.map((b) => lines[b.key]).join("\n") +
          "\n\nThey are on the call card above the button."
      );
      return;
    }
    // The same transformation the desk's radio stamp goes through
    // (stamping.jsx): the call advances, the truck follows, closing the call
    // closes what hung off it. The crew's own stamp carries no source.
    const stamped = stampStep({
      requests: freshRequests, units: freshUnits, req: target, unit: myUnit, step,
      at: now, stampedAt: now, by: user.name, byRole: "team", accountId: user.accountId, source: null,
    });
    const nextRequests = stamped.requests;
    const nextUnits = stamped.units;
    await saveRequests(nextRequests);
    await saveUnits(nextUnits);
    // Every step is logged and exported; the two the desk watches live are
    // tagged so the board's feed can pick them out — moving, and free again.
    const feedEvent = step.timeKey === "enroute" || step.timeKey === "backInService"
      ? { event: step.timeKey, unitName: myUnit.name, requestId: myRequest.id }
      : undefined;
    await addLog(
      `${myUnit.name} — ${step.timeLabel} at ${clockStr(now)} (${myRequest.nature})`,
      "status",
      feedEvent
    );
  }

  // Records which of the crew is writing the patient care report for this call.
  // Stored as the name and the seat as they read right now, not as a pointer to
  // the seat: whoever wrote the report is still that person after they sign off
  // and somebody else takes the seat they were sitting in.
  //
  // It stays changeable while the call is open — a crew who tap the wrong seat,
  // or who swap the paperwork between them at the destination, should be able to
  // correct it on the call rather than through the desk afterwards.
  async function setPcrAuthor(choice) {
    if (!myRequest || !myUnit || assisting || !choice) return;
    const existing = pcrAuthorOf(myRequest);
    if (existing && existing.seat === choice.seat && existing.name === choice.name) return;
    const now = Date.now();
    const freshRequests = await readKey("ems:requests", requests);
    const nextRequests = freshRequests.map((r) =>
      r.id === myRequest.id
        ? {
            ...r,
            pcrAuthor: {
              seat: choice.seat,
              name: choice.name,
              accountId: choice.accountId || null,
              unitId: myUnit.id,
              unitName: myUnit.name,
              assignedAt: now,
              assignedBy: user && user.name ? user.name : myUnit.name,
            },
          }
        : r
    );
    await saveRequests(nextRequests);
    await addLog(
      `${myUnit.name} — PCR author ${seatLabel(choice.seat)} · ${choice.name}` +
        `${existing ? ` (was ${seatLabel(existing.seat)} · ${existing.name})` : ""} — ${myRequest.nature}`,
      "status"
    );
  }

  // A crew finds the call is wrong — usually the MRN, sometimes the ward. They
  // report it and it goes no further than that: the call keeps the details it
  // has until the desk confirms the change. A crew correcting the record from
  // the bedside on their own would leave dispatch working from a call that
  // quietly changed underneath them.
  // ADDED SERVICE — the sheet's own column Q, picked from the department's own
  // list rather than typed, so what a crew choose is the word that lands in the
  // column and the desk's editor offers the same three. It is not one of the
  // three paperwork ticks and never blocks going back in service. Tapping the
  // code already on the call clears it, because a picker with no free text is
  // otherwise a choice that cannot be taken back.
  async function setAddedService(key) {
    if (!myRequest) return;
    const now = Date.now();
    const fresh = await readKey("ems:requests", requests);
    const target = fresh.find((r) => r.id === myRequest.id);
    if (!target) return;
    const previous = (target.addedService || "").trim();
    const next = previous === key ? "" : key;
    if (next === previous) return;
    const who = user && user.name ? user.name : (myUnit ? myUnit.name : "Crew");
    await saveRequests(
      fresh.map((r) =>
        r.id === myRequest.id
          ? { ...r, addedService: next, addedServiceBy: who, addedServiceAt: now }
          : r
      )
    );
    await addLog(
      (next
        ? `Added service ${next} set on "${target.nature}"`
        : `Added service cleared on "${target.nature}"`) +
        `${previous && next ? ` — was ${previous}` : ""} — ${who}`,
      "status"
    );
  }

  // Recording who took the patient at the destination.

  async function setReceiver({ name, receiverId }) {
    if (!myRequest) return;
    const now = Date.now();
    const who = user && user.name ? user.name : (myUnit ? myUnit.name : "Crew");
    const fresh = await readKey("ems:requests", requests);
    await saveRequests(
      fresh.map((r) =>
        r.id === myRequest.id
          ? { ...r, receiver: { name, receiverId, takenBy: who, takenAt: now, unitName: myUnit ? myUnit.name : "" } }
          : r
      )
    );
    await addLog(
      `${myUnit ? myUnit.name : "Crew"} (${who}) recorded the receiver for "${myRequest.nature}" — ` +
        `${name} (ID ${receiverId})`,
      "status"
    );
  }

  // Still waiting for the seat: the session says so and the board still shows
  // somebody else in it. The moment the board disagrees, the wait is over — the
  // seat transferred when they signed out.
  const seatHolder = myUnit ? myUnit[user.slot] : null;
  const awaitingSeat =
    !!user.awaitingRelief && !!seatHolder && seatHolder.accountId !== user.accountId;
  const occupantName = seatHolder ? seatHolder.name : "";
  const outgoingCall = awaitingSeat && myUnit ? liveRequestFor(myUnit, requests) : null;
  // Waiting because the holder was ASKED (seat-handover.jsx), as opposed to
  // waiting for a crew still out on a call.
  const myAsk = myUnit && user.slot ? handoverRequest(myUnit, user.slot) : null;
  const askMode = awaitingSeat && !!myAsk && myAsk.accountId === user.accountId && handoverIsAsk(myAsk);
  // The other side: somebody is asking for THIS person's seat.
  const askForMe = myUnit && user.slot && !user.awaitingRelief ? askForMySeat(myUnit, user.slot, user.accountId) : null;

  // Handing over is signing out — the hours close by the same sign-out as any
  // other, and the seat transfers by the rule that already existed for a
  // queued relief. Approving is recorded on the ask first so the log can say
  // it was approved rather than merely vacated.
  async function approveHandover() {
    if (!myUnit || !askForMe) return;
    if (!window.confirm(`Hand ${seatLabel(user.slot)} over to ${askForMe.name} and sign out now?\n\nYour hours close at this moment and the seat is theirs.`)) return;
    const fresh = await readKey("ems:units", units);
    await saveUnits(fresh.map((u) => (u.id === myUnit.id ? answerHandover(u, user.slot, "approved", user.name, Date.now()) : u)));
    if (onHandOver) await onHandOver();
  }
  async function declineHandover() {
    if (!myUnit || !askForMe) return;
    const now = Date.now();
    const fresh = await readKey("ems:units", units);
    await saveUnits(fresh.map((u) => (u.id === myUnit.id ? answerHandover(u, user.slot, "declined", user.name, now) : u)));
    await addLog(
      `${myUnit.name} — ${user.name} declined ${askForMe.name}'s request to take over ${seatLabel(user.slot)}`,
      "shift",
      { kind: "note", role: "team", name: user.name, accountId: user.accountId, unitId: myUnit.id, unitName: myUnit.name, station: stationOf(myUnit), seat: user.slot, handoverDeclined: askForMe.accountId }
    );
  }

  // This crew member's own list, and whether it has already been done today for
  // this truck. Alpha takes the medic list, Bravo the EMT list.
  const myPart = user.slot ? checklistPartForSeat(user.slot) : null;
  const myChecklistItems =
    myPart && checklists && checklists[myPart.key] ? checklists[myPart.key] : [];
  const todayKey = shiftKeyFor(user.shiftStart || Date.now());
  const myChecklistRun =
    myUnit && myPart ? checklistRunFor(checklistRuns, myUnit.id, myPart.key, todayKey) : null;
  // One checklist per person per shift is the obligation. If they have already
  // filed theirs — on this truck or on one they were sitting in earlier — the
  // list on this truck is offered rather than demanded.
  const myShiftRun = personChecklistRun(checklistRuns, user.accountId, todayKey);
  // Same guard as the restock nudge: the filed runs ride the slow poll, and
  // demanded off an empty list the checklist was "required" of a crew who had
  // filed it an hour ago, for one round trip after every open.
  const checklistMandatory =
    coldReady && myUnit && myPart
      ? checklistIsMandatory(checklistRuns, user.accountId, todayKey, myUnit.id, myPart.key)
      : false;

  async function fileChecklist({ answers, note }) {
    if (!myUnit || !myPart) return;
    const now = Date.now();
    const flagged = myChecklistItems.filter(
      (it) => !isWriteItem(it) && answers[it.id] && answers[it.id] !== "available"
    );
    const readings = myChecklistItems
      .filter((it) => isWriteItem(it) && String(answers[it.id] || "").trim())
      .map((it) => `${it.text}: ${String(answers[it.id]).trim()}`);
    const entry = {
      id: uid("chk"),
      unitId: myUnit.id,
      unitName: myUnit.name,
      station: stationOf(myUnit),
      part: myPart.key,
      seat: user.slot,
      byAccountId: user.accountId || "",
      byName: user.name || "",
      at: now,
      shiftKey: todayKey,
      dayKey: opDayKey(opDayStart(now)),
      shift: user.shift || scheduledShiftKey(now),
      answers,
      note: note || "",
      flaggedCount: flagged.length,
      // The words, not only the ids.
      //
      // A filed run stores answers keyed by item id, and the words those ids
      // stand for live in the checklist administration screen — which changes.
      // An item reworded or taken off the list six months later left every run
      // that flagged it reading "(item no longer on the list)", which is the
      // opposite of a reference. The exceptions and the readings are what
      // anybody goes back for, and they are small enough to keep verbatim on
      // the run itself; the all-available answers stay as ids, because "twenty
      // nine things were fine" needs no words to say it.
      flagged: flagged.map((it) => ({ id: it.id, text: it.text, answer: answers[it.id] })),
      readings: myChecklistItems
        .filter((it) => isWriteItem(it) && String(answers[it.id] || "").trim())
        .map((it) => ({ id: it.id, text: it.text, value: String(answers[it.id]).trim() })),
      itemCount: myChecklistItems.length,
    };
    const fresh = (await readKey(CHECKLIST_RUNS_KEY, checklistRuns)) || [];
    // Already filed by somebody else in the seconds it took to answer.
    if (checklistRunFor(fresh, myUnit.id, myPart.key, todayKey)) {
      setChecklistRuns(fresh);
      return;
    }
    // Written as one filed list, not as every list ever filed: two crews
    // filing within the same poll used to mean the second one replaced the
    // first, and the truck the first crew checked read as unchecked.
    const next = [entry, ...fresh].slice(0, CHECKLIST_RUNS_CAP);
    const sent = await writeList(CHECKLIST_RUNS_KEY, next, fresh, {
      prepend: true,
      cap: CHECKLIST_RUNS_CAP,
    });
    if (sent.ok) setChecklistRuns(sent.value || next);
    // The flagged items go on the log in words, because that is what the desk
    // and the administrator actually read. A list where everything was fine
    // says so in one line and takes up no more room than that.
    await addLog(
      `${myUnit.name} — ${myPart.label} filed by ${user.name || "crew"}` +
        (flagged.length
          ? ` · ${flagged.length} item${flagged.length === 1 ? "" : "s"} flagged: ` +
            flagged
              .map(
                (it) =>
                  `${it.text} (${(CHECK_ANSWERS.find((a) => a.key === answers[it.id]) || {}).label})`
              )
              .join("; ")
          : " · everything available") +
        (readings.length ? ` · ${readings.join("; ")}` : "") +
        (note ? ` · note: ${note}` : ""),
      "status"
    );
  }

  // Whether the ambulance number still has to be confirmed for this tour. Asked
  // of Alpha, because somebody has to own it and two people being asked means
  // neither does.
  const myShiftStart = user.shiftStart || shiftWindowAt(Date.now()).start;
  const ambulanceNeedsConfirming =
    !!myUnit && user.slot === "alpha" && myUnit.ambulanceShiftStart !== myShiftStart;
  // A number confirmed on a previous shift is last shift's answer. It is shown
  // as a suggestion to confirm, not as this shift's fact — so the field starts
  // empty when it has to be asked again.
  const ambulanceCarriedOver = ambulanceNeedsConfirming ? myUnit && myUnit.ambulanceNumber : null;

  // The other seat, and whether it was signed on from this device.
  const otherSeat = user.slot === "alpha" ? "bravo" : "alpha";
  const mySeatPartner = myUnit ? myUnit[otherSeat] : null;

  // Standing a partner down is asked for, not done.
  //
  // It takes a person off the truck and off the record of the hours they are
  // working, and the desk is the one answerable for who is crewed. So it goes
  // the same way an out-of-service request does: the crew asks, the desk
  // answers, and the seat is held until then.
  async function standPartnerDown() {
    if (!myUnit || !mySeatPartner) return;
    const ok = window.confirm(
      `Ask the desk to stand ${mySeatPartner.name} down from ${seatLabel(otherSeat)}?\n\n` +
        `They stay on the truck until the desk agrees. Their hours are recorded to the moment it ` +
        `is approved, not to now.`
    );
    if (!ok) return;
    const reason = window.prompt("Why are they coming off? The desk sees this.");
    if (reason === null) return;
    if (!reason.trim()) {
      window.alert("The desk needs a reason.");
      return;
    }
    const fresh0 = await readKey("ems:units", units);
    await saveUnits(
      fresh0.map((u) =>
        u.id === myUnit.id
          ? {
              ...u,
              standDownRequest: {
                id: uid("sd"),
                status: "pending",
                seat: otherSeat,
                name: mySeatPartner.name,
                accountId: mySeatPartner.accountId,
                reason: reason.trim(),
                byName: user.name || "",
                askedAt: Date.now(),
              },
            }
          : u
      )
    );
    await addLog(
      `${myUnit.name} — ${user.name || "crew"} asked to stand ${mySeatPartner.name} down from ` +
        `${seatLabel(otherSeat)}: ${reason.trim()}`,
      "status"
    );
    return;
    // eslint-disable-next-line no-unreachable
    const now = Date.now();
    const fresh = await readKey("ems:units", units);
    const unit = fresh.find((u) => u.id === myUnit.id);
    if (!unit || !unit[otherSeat]) return;
    const p = unit[otherSeat];
    const ot = overtimeMs(p, now);
    await saveUnits(
      fresh.map((u) =>
        u.id === myUnit.id
          ? {
              ...u,
              [otherSeat]: null,
              lastCrew: {
                ...(u.lastCrew || {}),
                [otherSeat]: { ...p, signedOffAt: now, overtimeMs: ot },
              },
            }
          : u
      )
    );
    await addLog(
      `${unit.name} — ${p.name} (${seatLabel(otherSeat)}) stood down by ${user.name || "the crew"}` +
        (ot > 0 ? ` · ${otHoursStr(ot)} overtime` : ""),
      "shift",
      {
        kind: "off",
        role: "team",
        name: p.name,
        accountId: p.accountId,
        unitId: unit.id,
        unitName: unit.name,
        station: stationOf(unit),
        seat: otherSeat,
        shift: p.shift || null,
        shiftStart: p.shiftStart || null,
        shiftEnd: p.shiftEnd || null,
        overtimeMs: ot,
      }
    );
  }

  async function proposeCallEdits(changes, note) {
    const ok = await proposeCallEditsTo({
      req: myRequest, changes, note, viewer: escViewer,
      requests, saveRequests, addLog,
    });
    if (ok) setEditOpen(false);
  }

  // The patient refuses the transfer at the bedside. The response stands and
  // the timeline carries on exactly as it would have — this only records the
  // refusal and its time, and stamps the call as a response with no transport
  // from here on.
  // A refusal is the one thing a crew records that ends with no patient moved,
  // so it is the one thing that has to be signed for. The name, National ID and
  // relationship of whoever refused are taken at the bedside and stored on the
  // call — "the patient refused" with nobody's name against it is not a record
  // of anything.
  async function recordRefusal({ name, nationalId, relation }) {
    if (!myRequest || !myUnit || assisting) return;
    if (isNoTransport(myRequest)) return;
    const who = (name || "").trim();
    const nid = (nationalId || "").trim();
    const rel = (relation || "").trim();
    if (!who || !nid || !rel) return;
    const now = Date.now();
    const freshRequests = await readKey("ems:requests", requests);
    const nextRequests = freshRequests.map((r) =>
      r.id === myRequest.id
        ? {
            ...r,
            noTransport: true,
            refusedBy: user && user.name ? user.name : myUnit.name,
            refusedByUnitId: myUnit.id,
            // Who actually refused, as given at the bedside.
            refusal: {
              name: who,
              nationalId: nid,
              relation: rel,
              takenBy: user && user.name ? user.name : myUnit.name,
              takenAt: now,
              unitName: myUnit.name,
            },
            times: { ...r.times, [REFUSAL_TIME_KEY]: now },
          }
        : r
    );
    await saveRequests(nextRequests);
    setRefusalOpen(false);
    await addLog(
      `${myUnit.name} — patient refused transfer at ${clockStr(now)} (${myRequest.nature}) — ` +
        `signed by ${who} (${rel}, National ID ${nid}) — ${NO_TRANSPORT.label}`,
      "status"
    );
  }

  // Asks the desk for a second ambulance on this call. Nothing about the call
  // changes: the team keep it, keep the timeline, and keep working — this puts
  // the ask in front of dispatch as an alert and as a task that is only done
  // once another team has been sent here.
  // Asking for a second ambulance, and saying what for.
  //
  // "Assist requested" told the desk an ambulance was wanted and nothing about
  // what to send — a lifting job and a deteriorating patient need different
  // trucks and different urgency, and the desk was left to telephone and ask.
  async function requestAssistance(detail) {
    if (!myRequest || !myUnit || assisting) return;
    if (assistPending(myRequest)) return;
    const what = (detail || "").trim();
    if (!what) return;
    const now = Date.now();
    const freshRequests = await readKey("ems:requests", requests);
    const nextRequests = freshRequests.map((r) =>
      r.id === myRequest.id
        ? {
            ...r,
            assist: {
              ...(assistOf(r) || {}),
              status: "pending",
              // What they actually need, so the desk can send the right thing.
              detail: what,
              requestedAt: now,
              requestedByUnitId: myUnit.id,
              requestedByUnitName: myUnit.name,
              requestedBy: user && user.name ? user.name : "",
              cancelledAt: null,
              cancelledBy: null,
              teams: assistTeams(r),
            },
          }
        : r
    );
    await saveRequests(nextRequests);
    await addLog(
      `${myUnit.name} requested an additional ambulance (auxiliary) — ${myRequest.nature} · ${callRoute(myRequest)}`,
      "call"
    );
  }

  // The crew's half of the coding. Same writer as the desk uses, so a code set
  // in the truck and a code set at the desk are the same fact recorded the same
  // way. Open to an assisting team as well: they are the D on somebody else's
  // call and they have run the same distance.
  async function setCoding(field, value) {
    if (!myRequest) return;
    await applyCallCoding({
      reqId: myRequest.id,
      field,
      value,
      requests,
      saveRequests,
      addLog,
      actor: { name: user && user.name ? `${user.name} · ${myUnit ? myUnit.name : ""}`.trim() : "" },
    });
  }

  // An assisting team finishing up. They don't own the timeline, so this is how
  // they come off the call and back onto the board without waiting for the team
  // running it to close it.
  async function clearAssist() {
    if (!myRequest || !myUnit || !assisting) return;
    const now = Date.now();
    const freshRequests = await readKey("ems:requests", requests);
    const freshUnits = await readKey("ems:units", units);
    const nextRequests = freshRequests.map((r) =>
      r.id === myRequest.id
        ? {
            ...r,
            assist: {
              ...assistOf(r),
              teams: assistTeams(r).map((t) =>
                t.unitId === myUnit.id && !t.clearedAt ? { ...t, clearedAt: now } : t
              ),
            },
          }
        : r
    );
    const nextUnits = freshUnits.map((u) =>
      u.id === myUnit.id ? { ...u, assignedRequestId: null, status: idleStatusFor(u) } : u
    );
    await saveRequests(nextRequests);
    await saveUnits(nextUnits);
    await addLog(
      `${myUnit.name} finished assisting ${primaryUnit ? primaryUnit.name : "the assigned team"} — ${myRequest.nature}`,
      "clear"
    );
  }

  if (!myUnit) {
    return <div style={styles.emptyState}>Your unit could not be found. Please sign out and sign in again.</div>;
  }

  const nextStep = myRequest ? TIME_STEPS.find((s) => s.from === myRequest.status) : null;

  // The window this crew's own closed-call list covers. Taken from the shift
  // this person signed on for rather than from the clock, so both seats of a
  // night crew who came in early are reading the same twelve hours, and held
  // open past the end of it so a call that finishes on overtime is still on
  // the list of the shift it was worked on.
  const myShiftWindow = crewShiftWindow(user, Date.now());

  // Who this crew member is as far as escalations go. The shift window is part
  // of it: it is what decides whether an issue their partner raised is theirs
  // to read as well.
  const escViewer = escalationViewer(user, myUnit, myShiftWindow);

  // What the call is still missing before it can close, and therefore what is
  // standing between this crew and the end of it. Worked out once here so the
  // paperwork block, the coding block and the button all describe the same
  // three facts rather than each deciding for itself.
  const blockers = assisting ? [] : closeoutBlockers(myRequest, nextStep);
  const blockerKeys = blockers.map((b) => b.key);
  const stepBlocked = blockers.length > 0;

  // The paperwork name: who the report is on, who it can be put on, and whether
  // its absence is what is now standing between the crew and the end of the call.
  const pcrChoices = pcrAuthorChoices(myUnit, user);
  const pcrAuthor = myRequest ? pcrAuthorOf(myRequest) : null;
  const pcrBlocking = blockerKeys.includes("pcrAuthor");
  const codingBlocking = blockerKeys.filter((k) => k === "callType" || k === "loadedKm");
  const showPcrBlock = !!myRequest && !assisting && myRequest.status !== "completed";

  // The two exception actions. They are worked out here so the card can ask
  // once whether either of them applies before it draws the block they live in
  // — an empty heading over no buttons is worse than no heading.
  const showRefusalBtn =
    !!myRequest && REFUSAL_FROM_STATUSES.includes(myRequest.status) && !isNoTransport(myRequest);
  const showAssistBtn = !!myRequest && myRequest.status !== "completed";

  return (
    <div>
      {alarmActive && (
        <AlarmOverlay
          request={myRequest}
          onAcknowledge={acknowledgeCall}
          assisting={assisting}
          withUnit={assisting && primaryUnit ? primaryUnit.name : ""}
        />
      )}

      <div style={styles.stationBanner}>
        <Radio size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
        {stationLabel(myStation)} — {myUnit.name}
      </div>

      {/* The board of every unit's status, and who is free, belongs to the desk
          and to administration. A crew needs its own call and its own unit —
          the rest is dispatch's picture to hold, not theirs to watch. */}

      <CallAlertNotice audioCtxRef={audioCtxRef} />
      {/* And the four things about the handset itself that silence an alert —
          notifications off, the channel silenced, the alarm slider at zero,
          battery optimisation freezing the app. Outside the page test, like the
          notice above it: a crew whose phone cannot be heard needs telling on
          whichever screen they are standing on. */}
      <BackgroundAlertNotice />

      {/* What the automatic check at sign-on found. Dismissable, because it is
          a result and not a demand — but it stays until it is read, since a
          crew who miss it are back to finding out at the first call. */}
      {speakerCheck && (
        <div
          style={{
            marginTop: 10,
            borderRadius: 12,
            padding: "9px 12px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            minWidth: 0,
            border: `1px solid ${speakerCheck.ok ? "var(--hair-2)" : "var(--hold)"}`,
            background: speakerCheck.ok ? "transparent" : "color-mix(in srgb, var(--hold) 10%, transparent)",
          }}
        >
          <span style={{ flex: "none", fontSize: 13 }}>{speakerCheck.ok ? "✓" : "⚠"}</span>
          <span style={{ flex: 1, fontSize: 12.5, color: speakerCheck.ok ? "var(--ink-3)" : "var(--hold-2)", overflowWrap: "anywhere" }}>
            {speakerCheck.say}
          </span>
          <button type="button" style={styles.ghostBtnSm} onClick={() => setSpeakerCheck(null)}>OK</button>
        </div>
      )}

      {/* A crew signing on can check the tablet's speaker against all three
          tones before they are relying on one of them. */}
      <AlertToneCheck audioCtxRef={audioCtxRef} label="Speaker check" style={{ marginTop: 10 }} />
      <SoundDiagnostics audioCtxRef={audioCtxRef} />

      {onPage("teams") && (
        <>
      <SectionBanner title="YOUR SHIFT" />
      <CrewShiftCard
        user={user}
        unit={myUnit}
        onCall={!!myRequest}
        overtimeSent={overtimeSent}
        setOvertimeSent={setOvertimeSent}
        addLog={addLog}
      />

      <SectionBanner title={`YOUR UNIT — ${myUnit.name}`} />
      <div style={styles.myUnitCard}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Circle size={10} fill={effectiveStatusMeta(myUnit, requests).color} color={effectiveStatusMeta(myUnit, requests).color} />
          <span style={{ fontSize: 17, fontWeight: 700, color: effectiveStatusMeta(myUnit, requests).color }}>{effectiveStatusMeta(myUnit, requests).label}</span>
        </div>
        {/* Waiting on the desk to acknowledge a call the crew opened. The clock
            is already running and the patient is already theirs — this only
            says the board has not caught up yet. */}
        {myRequest && myRequest.crewRaise && myRequest.crewRaise.status === "pending" && (
          <div style={styles.oosPending}>
            <Clock size={12} style={{ verticalAlign: -1, marginRight: 6 }} />
            Waiting for the desk to confirm this onto the board. Carry on — your times are recording.
          </div>
        )}

        {/* The desk's answer, where the crew will see it.
            A refusal in particular must reach them — they asked for a reason,
            and being told no without one teaches only not to ask. It stays until
            they acknowledge it. */}
        {/* On, off, and how long ago — on the crew's own screen, so somebody
            whose position stopped updating twenty minutes ago can see that
            without asking the desk. */}
        {myRequest && (
          <TrackingBar
            state={tracking.state}
            lastTs={tracking.lastTs}
            error={tracking.error}
            reason={trackingReason}
          />
        )}

        <TrackingConsentModal
          open={consentOpen}
          user={user}
          onDecide={decideTracking}
        />

        {myUnit.oosRequest &&
          myUnit.oosRequest.status === "refused" &&
          !dismissedOos && (
            <div style={styles.oosRefused}>
              <AlertTriangle size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
              <strong>Out of service refused</strong> by {myUnit.oosRequest.answeredBy}
              <div style={styles.oosRefusedWhy}>“{myUnit.oosRequest.answerNote}”</div>
              <div style={styles.oosRefusedAsked}>
                You asked: {myUnit.oosRequest.reason}
                {myUnit.oosRequest.note ? ` — ${myUnit.oosRequest.note}` : ""}
              </div>
              <button style={styles.primaryBtnSm} onClick={dismissOos}>
                Understood
              </button>
            </div>
          )}

        {/* Asked for, not yet answered. The truck is still available meanwhile —
            it is a working ambulance until the desk says otherwise. */}
        {oosRequestOf(myUnit) && (
          <div style={styles.oosPending}>
            <Clock size={12} style={{ verticalAlign: -1, marginRight: 6 }} />
            Waiting on the desk — {oosRequestOf(myUnit).reason}
            {oosRequestOf(myUnit).note ? `: ${oosRequestOf(myUnit).note}` : ""}
            <button style={styles.oosCancel} onClick={cancelOosRequest}>
              Cancel
            </button>
          </div>
        )}

        {oosOpen && (
          <div style={styles.oosForm}>
            <div style={styles.oosFormHead}>WHY DOES THE TRUCK NEED TO COME OFF?</div>
            <select
              style={{ ...styles.input, marginTop: 8 }}
              value={oosReason}
              onChange={(e) => setOosReason(e.target.value)}
            >
              <option value="">Choose a reason</option>
              {OOS_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <input
              style={{ ...styles.input, marginTop: 8 }}
              value={oosNote}
              onChange={(e) => setOosNote(e.target.value)}
              placeholder={oosReason === "Other" ? "Say what it is" : "Anything else (optional)"}
            />
            <div style={styles.checkActions}>
              <button style={styles.ghostBtnSm} onClick={() => setOosOpen(false)}>Cancel</button>
              <button
                style={
                  oosReason && (oosReason !== "Other" || oosNote.trim())
                    ? styles.primaryBtnSm
                    : styles.checkSubmitOff
                }
                disabled={!oosReason || (oosReason === "Other" && !oosNote.trim())}
                onClick={requestOutOfService}
              >
                Send to the desk
              </button>
            </div>
          </div>
        )}

        {!myRequest && (
          <div style={{ display: "flex", gap: 8 }}>
            {myUnit.status !== "available" && (
              <button style={styles.ghostBtnSm} onClick={() => setStatus("available")}>Set available</button>
            )}
            {myUnit.status !== "oos" && !oosRequestOf(myUnit) && (
              <button style={styles.ghostBtnSm} onClick={() => setOosOpen(true)}>
                Request out of service
              </button>
            )}
            {myUnit.status === "oos" && (
              <button style={styles.primaryBtnSm} onClick={() => setStatus("available")}>Back in service</button>
            )}
          </div>
        )}
        {/* A team helping on someone else's call has no timeline of its own to
            advance, so this is how they still read correctly on the status board
            while they are out. */}
        {assisting && (
          <div style={{ display: "flex", gap: 8 }}>
            {myUnit.status !== "enroute" && (
              <button style={styles.ghostBtnSm} onClick={() => setStatus("enroute")}>En route</button>
            )}
            {myUnit.status !== "onscene" && (
              <button style={styles.ghostBtnSm} onClick={() => setStatus("onscene")}>On scene</button>
            )}
          </div>
        )}
      </div>

      {/* Waiting for a seat that is still out.
          They are on duty and their hours are running; what they are not is on
          the truck. Showing them the ordinary crew screen would have them
          watching a call that is not theirs, on a unit they cannot act for. */}
      {/* Somebody wants this seat. The holder decides, here, on their own
          phone — the person asking is signed on and waiting, and the desk can
          step in only if this prompt goes unanswered. */}
      {askForMe && (
        <div style={styles.oosAsk}>
          <div style={styles.oosAskHead}>
            {askForMe.name} is asking to take over your seat — {myUnit ? myUnit.name : "your medic"} · {seatLabel(user.slot)}
          </div>
          <div style={styles.oosAskWhy}>
            Waiting since {clockStr(askForMe.queuedAt)}. Handing over signs you out now — your hours close at this
            moment and the seat is theirs. Declining keeps your seat and tells them.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button style={styles.primaryBtnSm} onClick={approveHandover}>Hand over &amp; sign out</button>
            <button style={styles.ghostBtnSm} onClick={declineHandover}>Decline</button>
          </div>
        </div>
      )}

      {awaitingSeat && (
        <div style={styles.reliefWait}>
          <div style={styles.reliefWaitHead}>
            <Clock size={14} style={{ verticalAlign: -2, marginRight: 7 }} />
            {askMode ? "WAITING FOR APPROVAL — " : "WAITING TO TAKE OVER "}{myUnit ? myUnit.name : "YOUR MEDIC"} — {seatLabel(user.slot).toUpperCase()}
          </div>
          <div style={styles.reliefWaitBody}>
            {askMode
              ? `${occupantName || "The seat holder"} has been asked on their phone. You are signed on and your shift is running from ${clockStr(user.shiftStart)}. The seat becomes yours the moment they approve or sign out. If they cannot answer, ask the dispatcher to hand it over.`
              : `${occupantName ? `${occupantName} is` : "The outgoing crew are"} still out on a call. You are signed on and your shift is running from ${clockStr(user.shiftStart)}. The seat becomes yours the moment they clear and sign out — you do not need to do anything.`}
          </div>
          {outgoingCall && (
            <div style={styles.reliefWaitCall}>
              Currently on: {outgoingCall.nature} · {callRoute(outgoingCall)}
            </div>
          )}
          {askMode ? (
            <InfoNote label="Why ask?">
              A seat somebody is working is theirs until they hand it over. Asking on their phone
              means nobody is stood down without knowing, and their hours close by their own
              sign-out — not by yours.
            </InfoNote>
          ) : (
            <InfoNote label="Why not just take the seat?">
              Taking it now would stop their overtime at this moment rather than when they actually
              clear, and the call would lose the crew who ran it. The log has to show who was on the
              truck, so the seat changes hands when the truck comes back.
            </InfoNote>
          )}
        </div>
      )}

      {/* Managing the other seat from this device.
          A crew sharing one tablet changes over mid-shift like any other — a
          partner goes off sick, or is relieved early. Whoever signed them on can
          stand them down and sign the next person on, and the replacement gives
          their own password just as the first one did. */}
      {mySeatPartner && mySeatPartner.viaSeat === user.slot && (
        <div style={styles.partnerManage}>
          <div style={styles.partnerManageHead}>
            <Users size={12} style={{ verticalAlign: -1, marginRight: 5 }} />
            {seatLabel(otherSeat).toUpperCase()} — {mySeatPartner.name}
          </div>
          <InfoNote>
            Signed on from this tablet. They sign off automatically when you do.
          </InfoNote>
          <button style={{ ...styles.ghostBtnSm, marginTop: 8 }} onClick={standPartnerDown}>
            Stand them down
          </button>
        </div>
      )}

      <SectionBanner title="ASSIGNED AMBULANCE" />
      {/* Asked once a shift, of whoever is sitting in Alpha.
          A number carried over from last week goes onto this week's calls
          without anybody noticing, and it is the column the maintenance and
          finance records are matched on. So it is confirmed at the start of each
          tour rather than assumed. */}
      {ambulanceNeedsConfirming && (
        <div style={styles.ambulancePrompt}>
          <div style={styles.ambulancePromptHead}>
            <Ambulance size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
            WHICH AMBULANCE ARE YOU ON THIS SHIFT?
          </div>
          <div style={styles.ambulancePromptBody}>
            {myUnit.ambulanceNumber
              ? `Last shift was on ${ambulanceCarriedOver}. Enter the one you are actually on — it ` +
                `may be the same truck, but this shift has to say so itself.`
              : "It goes on every call this shift and on the log sheet."}
          </div>
        </div>
      )}
      <div style={styles.ambulanceRow}>
        <input
          style={{ ...styles.input, maxWidth: 180 }}
          value={ambulanceInput}
          onChange={(e) => {
            ambulanceTouched.current = true;
            setAmbulanceInput(e.target.value);
          }}
          placeholder="e.g. A-207"
        />
        <button
          style={ambulanceNeedsConfirming ? styles.primaryBtnSm : styles.ghostBtnSm}
          disabled={!ambulanceInput.trim()}
          onClick={saveAmbulanceNumber}
        >
          {ambulanceNeedsConfirming ? "Confirm for this shift" : "Update"}
        </button>
        {myUnit.ambulanceNumber && !ambulanceNeedsConfirming && (
          <span style={styles.assignedTag}>
            {myUnit.ambulanceNumber}
            {myUnit.ambulanceSetBy ? ` · set by ${myUnit.ambulanceSetBy}` : ""}
          </span>
        )}

        {/* The daily check, in the same box and on the same line as the vehicle
            it is about. It is one small button until it is pressed, and a tick
            once it is done — a crew opening their screen mid-shift should see
            that it is handled, not read the whole list again. */}
        {myPart && myChecklistItems.length > 0 && !ambulanceNeedsConfirming && (
          myChecklistRun ? (
            <span style={styles.checkDoneTag} title={`Filed by ${myChecklistRun.byName} at ${clockStr(myChecklistRun.at)}`}>
              ✓ Daily checklist
            </span>
          ) : checklistMandatory ? (
            <button style={styles.checkOpenBtn} onClick={() => setChecklistOpen(true)}>
              📋 Complete your daily checklist
            </button>
          ) : (
            <button
              style={styles.checkOptionalBtn}
              onClick={() => setChecklistOpen(true)}
              title={`You filed your checklist for this shift on ${myShiftRun.unitName} at ${clockStr(myShiftRun.at)}`}
            >
              📋 Checklist for this truck — optional
            </button>
          )
        )}
      </div>

      {/* Opened only when asked for. */}
      {checklistOpen && myPart && !myChecklistRun && (
        <ChecklistCard
          part={myPart}
          items={myChecklistItems}
          checklists={checklists}
          onSubmit={async (v) => {
            await fileChecklist(v);
            setChecklistOpen(false);
          }}
          onCancel={() => setChecklistOpen(false)}
        />
      )}

      <SectionBanner
        title={assisting ? "ASSISTING ON CALL" : "ASSIGNED CALL"}
        icon={<PhoneIncoming size={13} />}
      />
        </>
      )}

      {/* My call: the thing a crew must never have to hunt for. */}
      {onPage("board") && (
        <>
      {/* The call was called off while they were on their way.
          On this page, not the truck page: this is the first thing the crew
          look at, and a stand-down they have to go and find is a crew still
          driving to a call that no longer exists. It does not clear itself and
          the tone does not stop until somebody presses the button — see the
          repeat in the effect that raises it. */}
      {calledOff && (
        <div style={styles.calledOff} className="breathing">
          <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          <strong>Call cancelled — stand down</strong>
          <div style={styles.calledOffWhat}>{calledOff.nature}</div>
          {calledOff.reason && <div style={styles.calledOffWhy}>“{calledOff.reason}”</div>}
          <div style={styles.calledOffWho}>
            Closed by {calledOff.by} at {clockStr(calledOff.at)}
          </div>
          <button style={styles.standDownBtn} onClick={() => setCalledOff(null)}>
            Understood — standing down
          </button>
        </div>
      )}

      {/* Something has happened in front of the truck. Its own thing, on the
          page the crew are already on — it used to sit on the truck page next
          to "Request out of service", which is a different kind of decision
          entirely and made this one easy to miss.

          On a call it stays put and goes grey rather than disappearing: a
          control that vanishes teaches nobody where it lives, and the crew
          need to know where it is for the time they are not on a call. */}
      <button
        style={myRequest ? styles.foundEmergencyBtnOff : styles.foundEmergencyBtn}
        onClick={raiseOwnEmergency}
        disabled={!!myRequest}
        title={myRequest ? "You are already on a call" : "Raise a call you have come across"}
      >
        🚨 Emergency in front of us
        {myRequest && <span style={styles.foundEmergencyWhy}>already on a call</span>}
      </button>

      {/* The truck still has to be made up after a call.
          The red number on History is the record of it; this is the thing that
          actually catches a crew, because after Back in Service they are
          standing on this page looking at "no active call" and there is nothing
          else here telling them there is a job left. */}
      {!myRequest && awaitingRestock.length > 0 && (
        <button style={styles.restockNudge} onClick={() => onGoToPage && onGoToPage("history")}>
          <span style={styles.restockNudgeCount}>{awaitingRestock.length}</span>
          <span style={styles.restockNudgeBody}>
            <span style={styles.restockNudgeTitle}>
              Restock the truck
            </span>
            <span style={styles.restockNudgeSub}>
              {awaitingRestock.length === 1
                ? `After ${awaitingRestock[0].nature || "your last call"} — tap to tick off what you used`
                : `${awaitingRestock.length} calls waiting — tap to tick off what you used`}
            </span>
          </span>
          <ChevronRight size={18} color="var(--hold)" />
        </button>
      )}

      {!myRequest ? (
        <div style={styles.emptyState}>No active call. You'll be notified here the moment dispatch assigns one.</div>
      ) : (
        <div style={{ ...styles.callCard, borderLeftColor: PRIORITY[priorityKeyOf(myRequest)].color, animation: "slide-in 0.25s ease", overflow: "hidden" }}>
          {/* ---- header: category · status · elapsed, then the call itself ---- */}
          {(() => {
            const pr = PRIORITY[priorityKeyOf(myRequest)];
            const st = reqStatusMeta(myRequest.status);
            const tm = myRequest.times || {};
            const stamped = Object.values(tm).filter((v) => typeof v === "number" && v <= clockNow);
            const since = stamped.length ? Math.max(...stamped) : myRequest.createdAt || 0;
            const started = tm.assigned || myRequest.createdAt || since;
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span style={{ flex: "none", padding: "3px 9px", borderRadius: 6, background: `color-mix(in srgb, ${pr.color} 16%, transparent)`, color: pr.color, fontSize: 11, fontWeight: 800, letterSpacing: 0.9 }}>{pr.label}</span>
                  <span style={{ marginLeft: "auto", flex: "none", fontSize: 19, fontWeight: 700, color: pr.color, fontVariantNumeric: "tabular-nums" }}>
                    {msDurationStr(Math.max(0, clockNow - started))}
                  </span>
                </div>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: st.color, overflowWrap: "anywhere" }}>
                  <span style={{ flex: "none", width: 7, height: 7, borderRadius: 999, background: st.color }} />
                  <span>{st.label}{since ? ` · since ${clockStr(since)}` : ""}</span>
                </span>
              </div>
            );
          })()}
          <div style={{ ...styles.callCardNature, fontSize: 25, fontWeight: 750, letterSpacing: -0.6, lineHeight: 1.12, marginTop: 6, overflowWrap: "anywhere" }}>
            <Star field="nature" />{myRequest.nature}
          </div>
          {(isNoTransport(myRequest) || assisting || myRequest.scheduledFor) && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              <NoTransportTag req={myRequest} />
              {assisting && (
                <span style={styles.assistTag}>
                  <HandRaised size={11} /> SECOND AMBULANCE{primaryUnit ? ` · with ${primaryUnit.name}` : ""}
                </span>
              )}
              {myRequest.scheduledFor && (
                <span style={styles.scheduledTag}>
                  <CalendarClock size={11} /> booked for {hhmm(myRequest.scheduledFor)}
                </span>
              )}
            </div>
          )}

          {/* ---- the route block: pick-up → destination, needs, MRN, notes ---- */}
          <div style={{ marginTop: 12, borderRadius: 12, background: "var(--inset)", border: "1px solid var(--hair)", padding: "12px 14px", minWidth: 0 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", minWidth: 0 }}>
              <div style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 6, gap: 3 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, border: "2px solid var(--ink-3)", boxSizing: "border-box" }} />
                <span style={{ width: 2, height: 22, background: "var(--hair-2)" }} />
                <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--ink)" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.1, color: "var(--ink-4)" }}>PICK UP</span>
                  <span style={{ fontSize: 16.5, fontWeight: 600, color: "var(--ink-2)", overflowWrap: "anywhere" }}><Star field="locationFrom" />{callFrom(myRequest) || "—"}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.1, color: "var(--ink-4)" }}>DESTINATION</span>
                  <span style={{ fontSize: 16.5, fontWeight: 650, color: "var(--ink)", overflowWrap: "anywhere" }}><Star field="locationTo" />{callTo(myRequest) || "—"}</span>
                </div>
              </div>
            </div>
            {(reqLabels(myRequest).length > 0 || myRequest.mrn) && (
              <React.Fragment>
                <div style={{ height: 1, background: "var(--hair)", margin: "12px 0 10px" }} />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
                    {reqLabels(myRequest).map((label, i) => (
                      <span key={i} style={{ padding: "3px 8px", borderRadius: 6, background: "var(--inset-2)", border: "1px solid var(--hair-2)", fontSize: 11, fontWeight: 700, color: "var(--ink-2)", whiteSpace: "nowrap" }}>{label}</span>
                    ))}
                  </div>
                  {myRequest.mrn && (
                    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 8, marginLeft: "auto", minWidth: 0 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.1, color: "var(--ink-4)" }}>MRN</span>
                      <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: 0.5, color: "var(--ink)", fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}><Star field="mrn" />{myRequest.mrn}</span>
                    </span>
                  )}
                </div>
              </React.Fragment>
            )}
            {/* What the desk wrote on the call. It used to be an unlabelled
                paragraph at the foot of the route block, which reads as part
                of the address rather than as a note somebody left for this
                crew — so it carries its own caption. Drawn only when there is
                something to say: an empty NOTES banner on every call teaches a
                crew to stop looking at it. */}
            {myRequest.notes && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--hair)", display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.1, color: "var(--ink-4)" }}>NOTES FROM DISPATCH</span>
                <span style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.45, overflowWrap: "anywhere" }}>{myRequest.notes}</span>
              </div>
            )}
          </div>

          {/* What the desk changed, in full, until the crew say they have
              seen it. The stars above mark WHERE; this says WHAT it was and
              what it is now, because "the destination changed" is not enough
              to act on. */}
          {unseenEdits.length > 0 && (
            <div style={{ marginTop: 10, border: "1px solid var(--crit)", background: "color-mix(in srgb, var(--crit) 10%, var(--panel))", borderRadius: 10, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 0.6, color: "var(--crit-2)" }}>★ DISPATCH CHANGED THIS CALL</div>
              {unseenEdits.map((e) => (
                <div key={e.id} style={{ fontSize: 13.5, color: "var(--ink)", overflowWrap: "anywhere" }}>
                  <strong>{editFieldLabel(e.field)}</strong>: {editValueText(e.from, e.field) || "—"} → <strong>{editValueText(e.to, e.field)}</strong>
                  <span style={{ color: "var(--ink-3)" }}> · {e.by} · {clockStr(e.at)}</span>
                </div>
              ))}
              <button style={{ ...styles.ghostBtnSm, alignSelf: "flex-start" }} onClick={markChangesSeen}>
                Seen — clear the stars
              </button>
            </div>
          )}

          {/* ---- the five stamps as a stepper: ticks behind, a ring on now, nothing ahead ---- */}
          {(() => {
            const tm = myRequest.times || {};
            const SHORT = { enroute: "EN ROUTE", arrival: "SCENE", departure: "DEPART", arrivalDestination: "ARRIVED", backInService: "IN SERVICE" };
            const rows = [];
            TIME_STEPS.forEach((s) => {
              rows.push({ key: s.timeKey, label: SHORT[s.timeKey] || s.timeLabel, ts: tm[s.timeKey] || null });
              if (s.timeKey === "arrival" && tm[REFUSAL_TIME_KEY]) rows.push({ key: REFUSAL_TIME_KEY, label: "REFUSED", ts: tm[REFUSAL_TIME_KEY], color: NO_TRANSPORT.color });
            });
            const cur = rows.findIndex((r) => !r.ts);
            const tight = rows.length > 5;
            return (
              <div style={{ display: "flex", alignItems: "flex-start", marginTop: 14, minWidth: 0 }}>
                {rows.map((r, i) => {
                  const done = !!r.ts, now = i === cur;
                  const tint = r.color || (done ? "var(--ok)" : now ? "var(--flow)" : "var(--hair-2)");
                  return (
                    <React.Fragment key={r.key}>
                      {i > 0 && <div style={{ flex: 1, height: 2, marginTop: 12, marginLeft: -4, marginRight: -4, background: rows[i - 1].ts ? (rows[i - 1].color || "var(--ok)") : "var(--hair-2)" }} />}
                      <div style={{ flex: "none", width: tight ? 50 : 58, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, minWidth: 0 }}>
                        <div style={{ width: 26, height: 26, borderRadius: 999, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center",
                          background: done ? tint : "var(--inset)", border: done ? "none" : `${now ? 2.5 : 2}px solid ${tint}`,
                          boxShadow: now ? "0 0 0 5px color-mix(in srgb, var(--flow) 16%, transparent)" : "none" }}>
                          {done && <span style={{ color: "var(--ground)", fontSize: 13, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                          {now && <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--flow)" }} />}
                        </div>
                        <span style={{ fontSize: tight ? 8.5 : 9.5, fontWeight: now ? 800 : 700, letterSpacing: 0.3, whiteSpace: "nowrap", color: done ? tint : now ? "var(--ink)" : "var(--ink-4)" }}>{r.label}</span>
                        <span style={{ fontSize: 11, marginTop: -3, fontVariantNumeric: "tabular-nums", color: done ? "var(--ink-3)" : "var(--flow)", whiteSpace: "nowrap" }}>{done ? hhmm(r.ts) : now ? "now" : ""}</span>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            );
          })()}

          <AssistStatusLine req={myRequest} units={units} />

          {/* ---- paperwork: PCR author, call type, loaded km — three ticks to earn ---- */}
          {!alarmActive && showPcrBlock && (() => {
            const type = callTypeOf(myRequest);
            const km = loadedKmOf(myRequest);
            const suggested = type ? null : suggestedCallType(myRequest);
            const needType = codingBlocking.includes("callType");
            const needKm = codingBlocking.includes("loadedKm");
            const required = pcrBlocking || needType || needKm;
            const doneCount = (pcrAuthor ? 1 : 0) + (type ? 1 : 0) + (km ? 1 : 0);
            const accent = required ? "var(--hold)" : "var(--hair-2)";
            const rowStyle = (miss) => ({ minHeight: 44, display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 10, background: "var(--inset)", border: `1px solid ${miss ? "var(--hold)" : "var(--hair)"}`, minWidth: 0 });
            const mark = (ok, miss) => ok
              ? <span style={{ flex: "none", width: 18, height: 18, borderRadius: 999, background: "var(--ok)", color: "var(--ground)", fontSize: 11, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</span>
              : <span style={{ flex: "none", width: 18, height: 18, borderRadius: 999, boxSizing: "border-box", border: `2px solid ${miss ? "var(--hold)" : "var(--hair-3)"}` }} />;
            const lab = (text, miss) => <span style={{ flex: "none", width: 82, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: miss ? "var(--hold-2)" : "var(--ink-3)", whiteSpace: "nowrap" }}>{text}</span>;
            const chip = (on, color, extra) => ({ minWidth: 34, height: 32, padding: "0 8px", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 8, fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, cursor: "pointer", background: on ? `color-mix(in srgb, ${color} 18%, transparent)` : "transparent", border: `1px solid ${on ? color : extra || "var(--hair-2)"}`, color: on ? color : "var(--ink-2)", whiteSpace: "nowrap" });
            return (
              <div style={{ marginTop: 14, borderRadius: 12, border: `1px solid ${accent}`, background: required ? "color-mix(in srgb, var(--hold) 7%, transparent)" : "transparent", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 1.1, color: required ? "var(--hold-2)" : "var(--ink-4)" }}>{required ? "BEFORE BACK IN SERVICE" : "PAPERWORK"}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: required ? "var(--hold-2)" : "var(--ink-4)", whiteSpace: "nowrap" }}>{required ? `${3 - doneCount} of 3 left` : `${doneCount} of 3 done`}</span>
                </div>
                <div style={rowStyle(pcrBlocking && !pcrAuthor)}>
                  {mark(!!pcrAuthor, pcrBlocking)}{lab("PCR AUTHOR", pcrBlocking && !pcrAuthor)}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginLeft: "auto", justifyContent: "flex-end", minWidth: 0 }}>
                    {pcrChoices.length === 0
                      ? <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Nobody signed on to {myUnit.name}</span>
                      : pcrChoices.map((c) => {
                          const on = !!pcrAuthor && pcrAuthor.seat === c.seat;
                          return <button key={c.seat} type="button" style={chip(on, "var(--flow)")} onClick={() => setPcrAuthor(c)}>{seatLabel(c.seat)} · {c.name}</button>;
                        })}
                  </div>
                </div>
                <div style={{ ...rowStyle(needType), flexWrap: "wrap", rowGap: 8 }}>
                  {mark(!!type, needType)}{lab("CALL TYPE", needType)}
                  <div style={{ flex: "1 1 100%", display: "flex", gap: 5, flexWrap: "wrap", minWidth: 0 }}>
                    {CALL_TYPES.map((t) => {
                      const on = !!type && type.key === t.key;
                      return <button key={t.key} type="button" title={`${t.key} — ${t.desc}`} style={{ ...chip(on, t.color, suggested === t.key ? "rgba(245,158,11,0.7)" : null), flex: "1 1 0", minWidth: 40 }} onClick={() => setCoding("callType", t.key)}>{t.key}</button>;
                    })}
                  </div>
                </div>
                <div style={{ ...rowStyle(needKm), flexWrap: "wrap", rowGap: 8 }}>
                  {mark(!!km, needKm)}{lab("LOADED KM", needKm)}
                  {km && <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{km.name}</span>}
                  <div style={{ flex: "1 1 100%", display: "flex", gap: 5, flexWrap: "wrap", minWidth: 0 }}>
                    {LOADED_KM.map((k) => {
                      const on = !!km && km.key === k.key;
                      return <button key={k.key} type="button" title={`${k.name} — ${k.desc}`} style={{ ...chip(on, LOADED_KM_COLOR), flex: "1 1 0", minWidth: 40 }} onClick={() => setCoding("loadedKm", k.key)}>{k.key === "NA" ? "N/A" : k.key}</button>;
                    })}
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--ink-4)", overflowWrap: "anywhere" }}>
                  {type ? `${type.key} · ${type.name}` : "Type: A ALS · B BLS · C critical · D auxiliary · E no transport"}
                  {" — "}
                  {km ? `${km.name} loaded` : "Km bands: 1 ≤50 · 2 51–150 · 3 151–250 · 4 251–400 · 5 400+"}
                </div>
                {/* ADDED SERVICE — sheet column Q, under the kilometre band
                    because that is where it sits on the sheet and the two are
                    filled in together. A picker, not free text: the sheet has
                    a vocabulary of three and typing beside it produced a
                    column somebody had to translate at month end. No ring
                    beside it — it is optional and is not one of the three
                    ticks, so it never blocks going back in service. */}
                <div style={{ ...rowStyle(false), flexWrap: "wrap", rowGap: 8 }}>
                  <span style={{ flex: "none", width: 18 }} />{lab("ADDED SVC", false)}
                  <div style={{ flex: "1 1 100%", display: "flex", gap: 5, flexWrap: "wrap", minWidth: 0 }}>
                    {ADDED_SERVICES.map((k) => {
                      const on = (myRequest.addedService || "").trim() === k;
                      return <button key={k} type="button" title={on ? "Tap again to clear it" : `Added service ${k}`} style={{ ...chip(on, "var(--flow)"), flex: "1 1 0", minWidth: 40 }} onClick={() => setAddedService(k)}>{k === "NA" ? "N/A" : k}</button>;
                    })}
                  </div>
                  {/* A note typed on a build that took free text here. Kept in
                      view rather than hidden behind the picker that replaced
                      it — it is billing information somebody wrote down. */}
                  {myRequest.addedServices && (
                    <span style={{ flex: "1 1 100%", fontSize: 11.5, color: "var(--ink-3)", overflowWrap: "anywhere" }}>
                      Noted earlier: {myRequest.addedServices}
                    </span>
                  )}
                </div>
              </div>
            );
          })()}

          {/* The handover, sitting with the step it belongs to. */}
          {!alarmActive && !assisting && !isNoTransport(myRequest) && (myRequest.times || {}).arrivalDestination && (
            <div style={{ marginTop: 10 }}><ReceiverBanner req={myRequest} canEdit onSave={setReceiver} /></div>
          )}

          {/* ---- the one primary action ---- */}
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            {alarmActive && <span style={styles.pendingAckTag}>Acknowledge the call above to continue</span>}
            {!alarmActive && assisting && (
              <React.Fragment>
                <span style={styles.assistNote}>
                  {primaryUnit ? primaryUnit.name : "The assigned team"} record the call times. Clear
                  yourself off it once you're done helping.
                </span>
                <button style={styles.ghostBtnSm} onClick={clearAssist}>
                  <CheckCircle2 size={13} /> Finished assisting
                </button>
              </React.Fragment>
            )}
            {!alarmActive && !assisting && nextStep && (
              <button
                style={{ ...(stepBlocked ? styles.stepBtnBlocked : styles.stepBtn), marginTop: 0, minHeight: 64, borderRadius: 14 }}
                onClick={() => runAction("step", () => recordStep(nextStep))}
                disabled={stepBlocked || !!acting}
                title={stepBlocked ? `This call needs ${closeoutMissingText(blockers)} before it can close` : ""}
              >
                <span style={{ ...styles.stepBtnCue, ...(stepBlocked ? { color: "var(--hold-2)", borderColor: "var(--hair-3)" } : null) }}>
                  {stepBlocked ? "BLOCKED" : acting === "step" ? "SAVING" : "NEXT"}
                </span>
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", minWidth: 0, textAlign: "left" }}>
                  <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.2, overflowWrap: "anywhere" }}>{acting === "step" ? "Recording…" : nextStep.buttonLabel}</span>
                  {stepBlocked && <span style={{ fontSize: 12, fontWeight: 500, color: "var(--hold-2)", overflowWrap: "anywhere" }}>record {closeoutMissingText(blockers)} above</span>}
                </span>
                {!stepBlocked && <ChevronRight size={18} style={{ marginLeft: "auto", flex: "none" }} />}
              </button>
            )}
            {/* Quiet: the things pressed on a handful of calls. */}
            {!alarmActive && (
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
                {!assisting && !editOpen && (
                  <button type="button" style={{ background: "none", border: "none", padding: "6px 2px", minHeight: 36, fontFamily: "inherit", fontSize: 13, color: "var(--ink-3)", textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer" }} onClick={() => setEditOpen(true)}>
                    Details are wrong
                  </button>
                )}
                <EscalationChip req={myRequest} viewer={escViewer} open={escOpen} onToggle={() => setEscOpen((v) => !v)} />
              </div>
            )}
            {!assisting && (pendingCallEdits(myRequest).length > 0 || editOpen || callEditsApplied(myRequest)) && (
              <div style={{ minWidth: 0 }}>
                {pendingCallEdits(myRequest).length > 0 && (
                  <div style={styles.editPendingNote}>
                    <Clock size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
                    Sent to dispatch — waiting for them to confirm:{" "}
                    {pendingCallEdits(myRequest).map((e) => `${editFieldLabel(e.field)} → ${editValueText(e.to, e.field)}`).join(", ")}
                  </div>
                )}
                {unseenEdits.length === 0 && <EditHistory req={myRequest} />}
                {editOpen && (
                  <CallEditForm req={myRequest} mode="propose" onSubmit={proposeCallEdits} onCancel={() => setEditOpen(false)} />
                )}
              </div>
            )}
          </div>

          {/* Both of these are things only the crew standing in the room can
              know: that the patient will not be going, and that one team is
              not enough. Neither of them changes the timeline — the times are
              completed exactly as they always are.

              They sit here, in their own block below the timeline button and
              behind a rule, rather than beside it. The button a crew press on
              every single call is the one at the top; these two are pressed
              on a handful of calls a year, and a thumb reaching for "on scene"
              on a moving tablet must not be able to land on "patient refused"
              or pull a second ambulance out of the desk by mistake. The gap
              and the heading are the guard rail; the confirm box behind each
              one is the second. */}
          {!alarmActive && !assisting && (showRefusalBtn || showAssistBtn) && (
            <div style={styles.exceptionBlock}>
              <div style={styles.exceptionHeader}>
                <AlertTriangle size={11} /> EXCEPTIONS — NOT PART OF THE NORMAL CALL
              </div>
              <div style={styles.exceptionActions}>
                {showRefusalBtn && (
                  <button style={styles.refusalBtn} onClick={() => setRefusalOpen(true)}>
                    <Ban size={13} /> Patient refused transfer
                  </button>
                )}
                {showAssistBtn && (
                  <button
                    style={assistPending(myRequest) ? styles.assistBtnPending : styles.assistBtn}
                    onClick={() => setAssistOpen(true)}
                    disabled={assistPending(myRequest)}
                  >
                    <Ambulance size={13} />{" "}
                    {assistPending(myRequest) ? "Assistance requested" : "Additional ambulance (auxiliary)"}
                  </button>
                )}
              </div>
              {/* What the second ambulance is for. The desk cannot send the
                  right thing to a request that only says "assist". */}
              {assistOpen && (
                <div style={styles.oosForm}>
                  <div style={styles.oosFormHead}>WHAT DO YOU NEED THE SECOND AMBULANCE FOR?</div>
                  <input
                    style={{ ...styles.input, marginTop: 8 }}
                    value={assistWhat}
                    onChange={(e) => setAssistWhat(e.target.value)}
                    placeholder="e.g. lifting assistance, patient deteriorating, second stretcher"
                  />
                  <div style={styles.checkActions}>
                    <button style={styles.ghostBtnSm} onClick={() => setAssistOpen(false)}>
                      Cancel
                    </button>
                    <button
                      style={assistWhat.trim() ? styles.primaryBtnSm : styles.checkSubmitOff}
                      disabled={!assistWhat.trim()}
                      onClick={async () => {
                        await requestAssistance(assistWhat);
                        setAssistOpen(false);
                        setAssistWhat("");
                      }}
                    >
                      Ask the desk
                    </button>
                  </div>
                </div>
              )}

              {refusalOpen && (
                <RefusalForm
                  onCancel={() => setRefusalOpen(false)}
                  onSubmit={recordRefusal}
                />
              )}
            </div>
          )}
          {!alarmActive && escOpen && (
            <EscalationThread
              req={myRequest}
              viewer={escViewer}
              requests={requests}
              saveRequests={saveRequests}
              addLog={addLog}
              onClose={() => setEscOpen(false)}
            />
          )}
        </div>
      )}

      {/* The calls this team has already finished on the shift that is running
          now. The crew stamped the times, and this is where they read them
          back. Scoped to their own 12-hour window, because the truck's older
          history belongs to the crews who worked it before them — though a
          search, a date or the escalated-issues filter opens the whole record
          they are allowed to see. A crew who only realises here that a detail
          was wrong can still report it: it goes to the desk the same way it
          would have on the live call, and the desk still has the last word. */}
        </>
      )}

      {/* History: what this crew has already closed on the shift running now. */}
      {onPage("history") && (
        <div style={{ marginTop: 18 }}>
          {/* What still has to be put back on the truck. Above the history
              itself, because it is the only thing on this page anybody has to
              act on — the rest is a record. */}
          {awaitingRestock.length > 0 && (
            <div style={styles.restockQueue}>
              <div style={styles.restockQueueHead}>
                <span style={styles.restockQueueTitle}>RESTOCK OUTSTANDING</span>
                <span style={styles.restockQueueCount}>{awaitingRestock.length}</span>
              </div>
              <div style={styles.restockQueueNote}>
                Tick what you used on each call, then mark the truck restocked.
              </div>
              {awaitingRestock.map((req, i) => (
                <CallRestock
                  key={req.id}
                  startOpen={i === 0}
                  inventory={inventory}
                  moves={inventoryMoves}
                  unit={myUnit}
                  user={user}
                  request={req}
                  setMoves={setInventoryMoves}
                  onDone={async () => {
                    const next = await markRestocked({ request: req, unit: myUnit, user });
                    if (next) setRestockDone(next);
                    await addLog(
                      `${myUnit.name} restocked after ${req.nature || "a call"}` +
                        `${user && user.name ? ` by ${user.name}` : ""}`,
                      "status"
                    );
                  }}
                />
              ))}
            </div>
          )}

          <CompletedCalls
            requests={stationRequests}
            units={stationUnits}
            unitId={myUnit.id}
            shiftWindow={myShiftWindow}
            user={user}
            viewer={escViewer}
            saveRequests={saveRequests}
            addLog={addLog}
            submissions={submissions}
          />
        </div>
      )}

      {/* One thread, straight into it — a crew has only ever one desk to talk
          to, so there is nothing to pick from.

          Outside every page test on purpose. It used to sit inside the crew's
          own page, so a crew reading their call or their history had no way to
          answer the desk and no sign that the desk had said anything — the
          count was on a screen they were not looking at. The desk's dock has
          always floated over every page; this is the same dock with the same
          rules. */}
      <ChatDock
        floating
        user={user}
        units={units}
        messages={messages}
        station={myUnit ? stationOf(myUnit) : null}
        myUnitId={myUnit ? myUnit.id : null}
        audioCtxRef={audioCtxRef}
        onSent={setMessages}
      />
    </div>
  );
}

// What the crew themselves see about their shift: the 12-hour window they
// signed on for, the time left in it, and — once that runs out — how long
// they've been on overtime, with the other seat's shift alongside so a crew
// that is halfway through a handover can see it. Nothing here stops them
// working; a call that runs past 19:00 (or 07:00) just keeps running.
export function CrewShiftCard({ user, unit, onCall, overtimeSent, setOvertimeSent, addLog }) {
  const meta = shiftMeta(user.shift);
  // What the crew are told about their own overtime, and — when it is theirs to
  // claim — the one button that sends it. Folded away by default: it is three
  // sentences about pay on a screen whose job is the next call.
  const [otOpen, setOtOpen] = useState(false);
  const [otBusy, setOtBusy] = useState(false);
  // Why they stayed. Required on a claim no call held them on — see
  // `overtimeReasonRequired`: an administrator cannot approve "0.37 h, not on
  // a call" without being told what it was for.
  const [otReason, setOtReason] = useState("");
  const [otSaid, setOtSaid] = useState("");
  const now = Date.now();
  const ot = overtimeMs(user, now);
  const left = shiftRemainingMs(user, now);
  const notStarted = user.shiftStart && now < user.shiftStart;
  const otherSlot = user.slot === "alpha" ? "bravo" : "alpha";
  const partner = unit ? unit[otherSlot] : null;
  const partnerMeta = partner ? shiftMeta(partner.shift) : null;

  // The stay this shift will become a claim for, keyed exactly as the log will
  // key it — see `overtimeClaimId` — so sending it now and signing off later
  // are the same claim and not two.
  const claim = {
    id: overtimeClaimId({
      accountId: user.accountId,
      name: user.name,
      shiftStart: user.shiftStart,
      unitId: unit ? unit.id : null,
      seat: user.slot,
    }),
    name: user.name,
    accountId: user.accountId || "",
    unitName: unit ? unit.name : "",
    claimedMs: ot,
    // Carried onto the claim so the reason rule reads the same thing here as
    // it does at sign-out.
    onCall: !!onCall,
  };
  const alreadySent = !!(overtimeSent && overtimeSent[claim.id]);

  async function send() {
    if (otBusy) return;
    const problem = overtimeReasonProblem(claim, otReason);
    if (problem) {
      setOtSaid(problem);
      return;
    }
    setOtSaid("");
    setOtBusy(true);
    try {
      await sendOvertimeClaim({
        claim, sent: overtimeSent, setSent: setOvertimeSent, user, addLog, reason: otReason,
      });
    } finally {
      setOtBusy(false);
    }
  }

  return (
    <div style={{ ...styles.shiftCard, borderLeftColor: ot > 0 ? "var(--crit)" : meta ? meta.color : "var(--hair-2)" }}>
      <div style={styles.shiftCardTop}>
        <span style={{ ...styles.shiftCardTitle, color: meta ? meta.color : "var(--ink-3)" }}>
          {meta ? `${meta.glyph} ${meta.label}` : "SHIFT NOT RECORDED"}
        </span>
        <span style={styles.shiftCardWindow}>
          {shiftWindowStr(user) || (meta ? meta.window : "")}
        </span>
      </div>
      {ot > 0 ? (
        <div style={styles.shiftCardOvertime}>
          <Circle size={8} fill="var(--crit)" style={{ animation: "pulse-dot 1.4s ease-in-out infinite" }} />
          <span style={styles.shiftCardOvertimeLabel}>ON OVERTIME</span>
          <span style={styles.shiftCardOvertimeTime}>{otHoursStr(ot)}</span>
        </div>
      ) : (
        <div style={styles.shiftCardRemaining}>
          {!meta
            ? "Sign out and back in to record your shift"
            : notStarted
            ? `Starts ${hhmm(user.shiftStart)} — ${shortDurationStr(user.shiftStart - now)} from now`
            : `${msDurationStr(left)} left on this shift`}
        </div>
      )}
      <div style={styles.shiftCardNote}>
        {ot > 0
          ? onCall
            ? "You're past the end of your shift and still on a call — the extra time is on the log sheet as overtime."
            : "Past the end of your shift. Sign out when you're relieved, or swap shift from the badge in the header."
          : `${seatLabel(user.slot)} seat${partner ? ` · ${otherSlot === "alpha" ? "Alpha" : "Bravo"}: ${partner.name}${partnerMeta ? ` (${partnerMeta.short})` : ""}` : ` · ${otherSlot === "alpha" ? "Alpha" : "Bravo"} seat open`}`}
      </div>

      {/* Whether anybody is going to be asked to approve these hours, and — if
          that is the crew member's own decision — the button that decides it.
          Retractable, because it is a paragraph about pay sitting on the screen
          a crew works a call from. */}
      {ot > 0 && (
        <div style={styles.otCrewWrap}>
          <button style={styles.otCrewHead} onClick={() => setOtOpen((v) => !v)}>
            <span style={{ ...styles.otBlockCaret, transform: otOpen ? "rotate(90deg)" : "none" }}>›</span>
            WHAT HAPPENS TO THESE HOURS
            <span style={styles.otBlockCount}>{alreadySent ? "SENT" : onCall ? "AUTOMATIC" : "YOURS TO SEND"}</span>
          </button>
          {otOpen && (
            <div style={styles.otCrewBody}>
              {onCall ? (
                <span>
                  A call was running when your shift ended, so this goes to administration on its
                  own when you sign off. There is nothing for you to do.
                </span>
              ) : alreadySent ? (
                <span>
                  Sent to administration. They will approve it, approve part of it, or decline it
                  with a reason — and either way it stays on the shift log.
                </span>
              ) : (
                <React.Fragment>
                  <span>
                    You were not on a call when your shift ended, so these hours are yours to claim
                    or to leave. They are on the shift log either way; sending only decides whether
                    anybody is asked to approve them. You will be offered this again when you sign
                    off.
                  </span>
                  {/* No call held them, so the board cannot say what this was
                      for and an administrator has nothing to decide on. 16px
                      like every field in this app, or focusing it zooms the
                      whole board on iOS. */}
                  <label style={styles.otReasonLabel}>WHAT KEPT YOU</label>
                  <textarea
                    style={styles.otReasonInput}
                    rows={2}
                    value={otReason}
                    placeholder="Restocking after the last call, late handover, truck fault…"
                    onChange={(e) => { setOtReason(e.target.value); if (otSaid) setOtSaid(""); }}
                  />
                  {otSaid && <span style={styles.otReasonProblem}>{otSaid}</span>}
                  <button style={styles.primaryBtnSm} onClick={send} disabled={otBusy}>
                    {otBusy ? "Sending…" : `Send ${otHoursStr(ot)} to administration`}
                  </button>
                </React.Fragment>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}