import { closeoutBlockers, closeoutMissingText } from "../domain/call-completeness.jsx";
import { callRoute } from "../domain/call-locations.jsx";
import { CHECKLIST_RUNS_CAP, CHECKLIST_RUNS_KEY, CHECK_ANSWERS, checklistIsMandatory, checklistPartForSeat, checklistRunFor, isWriteItem, personChecklistRun, shiftKeyFor } from "../domain/checklist.jsx";
import { callCloseReason } from "../domain/close-reasons.jsx";
import { PRIORITY, REQ_STATUS, TIME_STEPS, editFieldLabel, editValueText, pendingCallEdits, priorityKeyOf, proposeCallEditsTo, reqLabels } from "../domain/constants.jsx";
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
import { applyCallCoding } from "../domain/sheet-vocabulary.jsx";
import { crewShiftWindow, hhmm, overtimeMs, scheduledShiftKey, seatLabel, shiftMeta, shiftPhrase, shiftRemainingMs, shiftWindowAt, shiftWindowStr } from "../domain/shift-helpers.jsx";
import { consentFor, needsConsentPrompt, recordConsent } from "../domain/truck-locations.jsx";
import { soundCallAlert, soundReminderTone, soundStandDownTone, speakStandDown } from "../lib/dates.jsx";
import { uid } from "../lib/helpers.jsx";
import { AlertTriangle, Ambulance, Ban, CalendarClock, CheckCircle2, ChevronRight, Circle, Clock, FileSignature, HandRaised, PencilLine, PhoneIncoming, Radio, Users } from "../lib/icons.jsx";
import { notifyAssignedCall } from "../lib/notify.jsx";
import { readKey, writeKey } from "../lib/offline-queue.jsx";
import { useEffect, useRef, useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";
import { AlarmOverlay, AlertToneCheck, CallAlertNotice, SoundDiagnostics } from "./AlarmOverlay.jsx";
import { CallEditForm, CallRoute, ChecklistCard, EditHistory, InfoNote, ReceiverBanner, RefusalForm } from "./AssistanceTasks.jsx";
import { CallRestock } from "./CallRestock.jsx";
import { ChatDock, useMessageAlerts } from "./ChatDock.jsx";
import { CompletedCalls, EscalationChip, EscalationThread } from "./Escalations.jsx";
import { useTracking } from "./FleetMap.jsx";
import { TrackingBar, TrackingConsentModal } from "./LocationAsk.jsx";
import { AssistStatusLine, CallCodingBlock, CallStepper, CallTypeTag, LoadedKmTag, NoTransportTag, PcrAuthorTag } from "./StatusBoard.jsx";

// ---------- team view ----------

export function TeamView({ user, units, requests, saveUnits, saveRequests, addLog, audioCtxRef, checklists, checklistRuns, setChecklistRuns, page, onGoToPage, messages, setMessages, inventory, inventoryMoves, setInventoryMoves, restockDone, setRestockDone, locations, setLocations, trackingConsents, setTrackingConsents }) {
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
  const [ambulanceInput, setAmbulanceInput] = useState(myUnit ? myUnit.ambulanceNumber || "" : "");
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
  const awaitingRestock = callsAwaitingRestock(
    requests,
    myUnit && myUnit.id,
    crewShiftWindow(user, Date.now()).start,
    restockDone
  );

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
    const sound = () => {
      soundStandDownTone(audioCtxRef);
      setTimeout(() => soundStandDownTone(audioCtxRef), 450);
      setTimeout(() => soundStandDownTone(audioCtxRef), 900);
      buzz([500, 150, 500, 150, 500]);
    };
    // Said once - which is two utterances, because speakStandDown says it
    // twice - and then never again. What repeats is the tone and the buzz.
    speakStandDown();
    sound();
    const t = setInterval(sound, 4000);
    return () => {
      clearInterval(t);
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
  // A refusal stays on screen until the crew says they have read it.
  const [dismissedOos, setDismissedOos] = useState(false);
  useEffect(() => {
    // A fresh answer is a fresh notice, even if the last one was dismissed.
    setDismissedOos(false);
  }, [myUnit && myUnit.oosRequest && myUnit.oosRequest.answeredAt]);

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

  useEffect(() => {
    setAmbulanceInput(myUnit ? myUnit.ambulanceNumber || "" : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUnit && myUnit.ambulanceNumber]);

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
      if (alarmIntervalRef.current && alarmingRequestId.current === myRequest.id) return; // already running for this call
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
  }, [myRequest && myRequest.id, myRequest && myRequest.status, myRequest && myRequest.acknowledged, alarmActive]);

  useEffect(() => {
    return () => {
      stopAlarmLoop();
      clearCallAlert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // clear on unmount

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
    const nextRequests = freshRequests.map((r) =>
      r.id === myRequest.id
        ? {
            ...r,
            status: step.to,
            times: { ...r.times, [step.timeKey]: now },
            // Closing the call closes the ask that came off it: a second
            // ambulance for a call that is over is a task nobody should still
            // be looking at on the desk.
            assist:
              step.to === "completed" && assistOf(r)
                ? {
                    ...assistOf(r),
                    status: assistOf(r).status === "pending" ? "cancelled" : assistOf(r).status,
                    cancelledAt: assistOf(r).status === "pending" ? now : assistOf(r).cancelledAt,
                    cancelledBy: assistOf(r).status === "pending" ? "Call completed" : assistOf(r).cancelledBy,
                    teams: assistTeams(r).map((t) => (t.clearedAt ? t : { ...t, clearedAt: now })),
                  }
                : r.assist,
          }
        : r
    );
    const nextUnitPatch = { status: step.unitStatus };
    if (step.to === "completed") nextUnitPatch.assignedRequestId = null;
    // A team that came to help is freed with the call rather than left pointing
    // at a finished one until the next repair pass notices.
    const assistIds = step.to === "completed" ? activeAssistUnitIds(target) : [];
    const nextUnits = freshUnits.map((u) => {
      if (u.id === myUnit.id) {
        const patch = { ...nextUnitPatch };
        // Going back in service only means "available" if a crew is still signed
        // on. If the last seat emptied during the call, the team drops to out of
        // service instead of sitting on the board as a unit dispatch can send.
        if (step.to === "completed") patch.status = idleStatusFor(u);
        return { ...u, ...patch };
      }
      if (assistIds.includes(u.id)) {
        return { ...u, assignedRequestId: null, status: idleStatusFor(u) };
      }
      return u;
    });
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
  const checklistMandatory =
    myUnit && myPart
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
    };
    const fresh = (await readKey(CHECKLIST_RUNS_KEY, checklistRuns)) || [];
    // Already filed by somebody else in the seconds it took to answer.
    if (checklistRunFor(fresh, myUnit.id, myPart.key, todayKey)) {
      setChecklistRuns(fresh);
      return;
    }
    const next = [entry, ...fresh].slice(0, CHECKLIST_RUNS_CAP);
    const ok = await writeKey(CHECKLIST_RUNS_KEY, next);
    if (ok) setChecklistRuns(next);
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

      {/* A crew signing on can check the tablet's speaker against all three
          tones before they are relying on one of them. */}
      <AlertToneCheck audioCtxRef={audioCtxRef} label="Speaker check" style={{ marginTop: 10 }} />
      <SoundDiagnostics audioCtxRef={audioCtxRef} />

      {onPage("teams") && (
        <>
      <div style={styles.sectionHeader}>YOUR SHIFT</div>
      <CrewShiftCard user={user} unit={myUnit} onCall={!!myRequest} />

      <div style={styles.sectionHeader}>YOUR UNIT — {myUnit.name}</div>
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
              <button style={styles.primaryBtnSm} onClick={() => setDismissedOos(true)}>
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
      {awaitingSeat && (
        <div style={styles.reliefWait}>
          <div style={styles.reliefWaitHead}>
            <Clock size={14} style={{ verticalAlign: -2, marginRight: 7 }} />
            WAITING TO TAKE OVER {myUnit ? myUnit.name : "YOUR MEDIC"} — {seatLabel(user.slot).toUpperCase()}
          </div>
          <div style={styles.reliefWaitBody}>
            {occupantName ? `${occupantName} is` : "The outgoing crew are"} still out on a call.
            You are signed on and your shift is running from {clockStr(user.shiftStart)}. The seat
            becomes yours the moment they clear and sign out — you do not need to do anything.
          </div>
          {outgoingCall && (
            <div style={styles.reliefWaitCall}>
              Currently on: {outgoingCall.nature} · {callRoute(outgoingCall)}
            </div>
          )}
          <InfoNote label="Why not just take the seat?">
            Taking it now would stop their overtime at this moment rather than when they actually
            clear, and the call would lose the crew who ran it. The log has to show who was on the
            truck, so the seat changes hands when the truck comes back.
          </InfoNote>
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

      <div style={styles.sectionHeader}>ASSIGNED AMBULANCE</div>
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

      <div style={styles.sectionHeader}>
        <PhoneIncoming size={14} style={{ marginRight: 6, verticalAlign: -2 }} />{" "}
        {assisting ? "ASSISTING ON CALL" : "ASSIGNED CALL"}
      </div>
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
        <div style={{ ...styles.callCard, borderLeftColor: PRIORITY[priorityKeyOf(myRequest)].color, animation: "slide-in 0.25s ease" }}>
          <div style={styles.callCardTop}>
            <div style={styles.callCardNature}>{myRequest.nature}</div>
            <div style={styles.callCardTopRight}>
              {/* The escalation banner. It sits in the corner of the call all
                  the way through it — a crew who hit a problem at the door of
                  a ward should not have to wait until the call is over to say
                  so, and one who only realises afterwards finds the same
                  banner on the same call in their history. */}
              {!alarmActive && (
                <EscalationChip
                  req={myRequest}
                  viewer={escViewer}
                  open={escOpen}
                  onToggle={() => setEscOpen((v) => !v)}
                />
              )}
              <span style={{ ...styles.pill, background: PRIORITY[priorityKeyOf(myRequest)].color }}>{PRIORITY[priorityKeyOf(myRequest)].label}</span>
            </div>
          </div>
          <div style={styles.callCardMeta}>
            <CallRoute req={myRequest} />
            <span style={{ ...styles.pill, background: REQ_STATUS[myRequest.status].color }}>{REQ_STATUS[myRequest.status].label}</span>
            <NoTransportTag req={myRequest} />
            <PcrAuthorTag req={myRequest} />
            <CallTypeTag req={myRequest} />
            <LoadedKmTag req={myRequest} />
            {assisting && (
              <span style={styles.assistTag}>
                <HandRaised size={11} /> SECOND AMBULANCE
                {primaryUnit ? ` · with ${primaryUnit.name}` : ""}
              </span>
            )}
            {myRequest.scheduledFor && (
              <span style={styles.scheduledTag}>
                <CalendarClock size={11} /> booked for {hhmm(myRequest.scheduledFor)}
              </span>
            )}
          </div>
          {myRequest.mrn && <div style={styles.mrnRow}>MRN: {myRequest.mrn}</div>}
          {myRequest.notes && <div style={styles.mrnRow}>{myRequest.notes}</div>}
          {myRequest.requirements && myRequest.requirements.length > 0 && (
            <div style={styles.checklistRow}>
              {reqLabels(myRequest).map((label, i) => (
                <span key={i} style={styles.reqBadge}>{label}</span>
              ))}
            </div>
          )}

          {/* Corrections. A crew can say the details are wrong; only the desk can
              make that stick. Anything already sent shows here so the same crew
              doesn't report it twice while they wait. */}
          {!assisting && (
            <div style={styles.editCrewBlock}>
              {pendingCallEdits(myRequest).length > 0 && (
                <div style={styles.editPendingNote}>
                  <Clock size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
                  Sent to dispatch — waiting for them to confirm:{" "}
                  {pendingCallEdits(myRequest)
                    .map((e) => `${editFieldLabel(e.field)} → ${editValueText(e.to, e.field)}`)
                    .join(", ")}
                </div>
              )}
              <EditHistory req={myRequest} />
              {!editOpen ? (
                <button style={styles.ghostBtnSm} onClick={() => setEditOpen(true)}>
                  <PencilLine size={12} /> These details are wrong
                </button>
              ) : (
                <CallEditForm
                  req={myRequest}
                  mode="propose"
                  onSubmit={proposeCallEdits}
                  onCancel={() => setEditOpen(false)}
                />
              )}
            </div>
          )}

          <CallStepper req={myRequest} />

          {/* Where the ask for a second ambulance has got to, on the card of the
              team who asked for it — a crew waiting for help should not have to
              radio the desk to find out whether it is coming. */}
          <AssistStatusLine req={myRequest} units={units} />

          {/* The paperwork name. One button per seat, each carrying the name of
              whoever is sitting in it — a crew picking "Alpha" are picking a
              person, so the person is what the button says. It can be answered
              from the moment the call is theirs, and only becomes the thing
              holding the call open at the last step, which is where the record
              actually needs it. */}
          {!alarmActive && showPcrBlock && (
            <div style={pcrBlocking ? styles.pcrBlockRequired : styles.pcrBlock}>
              <div style={pcrBlocking ? styles.pcrHeaderRequired : styles.pcrHeader}>
                <FileSignature size={11} /> PCR AUTHOR
                {pcrAuthor ? "" : " — REQUIRED BEFORE BACK IN SERVICE"}
              </div>
              {pcrChoices.length === 0 ? (
                <div style={styles.pcrEmpty}>
                  Nobody is signed on to {myUnit.name}, so there is no name to put the report on. Take a
                  seat on this unit to name the PCR author.
                </div>
              ) : (
                <div style={styles.pcrChoices}>
                  {pcrChoices.map((c) => {
                    const picked = !!pcrAuthor && pcrAuthor.seat === c.seat;
                    return (
                      <button
                        key={c.seat}
                        style={picked ? styles.pcrChoiceOn : styles.pcrChoice}
                        onClick={() => setPcrAuthor(c)}
                      >
                        {picked && <CheckCircle2 size={12} />} {seatLabel(c.seat)} — {c.name}
                      </button>
                    );
                  })}
                </div>
              )}
              {/* The fact of who is writing it stays on the card; the
                  explanation of what that means folds away. */}
              {pcrAuthor ? (
                <div style={styles.pcrNote}>
                  {pcrAuthorText(myRequest)} is writing the report
                  {pcrAuthor.assignedAt ? ` · named at ${clockStr(pcrAuthor.assignedAt)}` : ""}
                </div>
              ) : (
                <div style={styles.pcrNote}>Nobody named yet</div>
              )}
              <InfoNote>
                {pcrAuthor
                  ? "Tap the other seat to move it while the call is still open."
                  : "Whoever is writing the patient care report for this call. The call cannot go back in service until one of you is on it."}
              </InfoNote>
            </div>
          )}

          {/* The two codes for the sheet. Always open on the crew's card — they
              have one call in front of them, not ten, and the distance is
              something only they can answer. For most of the call nothing here
              blocks the timeline: a crew who need to clear a scene are not held
              up by a billing code. At the last step both codes are required,
              because "the desk will finish it off the history list afterwards"
              is exactly the habit that left the column blank. */}
          {!alarmActive && myRequest.status !== "completed" && (
            <CallCodingBlock
              req={myRequest}
              onSet={setCoding}
              missing={codingBlocking}
              hint={assisting ? "Second ambulance — usually a D." : ""}
            />
          )}

          <div style={styles.callCardActions}>
            {alarmActive && (
              <span style={styles.pendingAckTag}>Acknowledge the call above to continue</span>
            )}
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
              <React.Fragment>
                {stepBlocked && (
                  <span style={styles.pcrPendingNote}>
                    Record {closeoutMissingText(blockers)} above to go back in service
                  </span>
                )}
                {/* The one thing this crew is meant to do next. It was the same
                    size as everything else around it, which is the wrong shape
                    for a control pressed once per stage, with a glove on, in a
                    moving vehicle — it should be the obvious target on the
                    screen and hard to miss. */}
                {/* The handover, sitting with the step it belongs to.
                    By the time the next stamp is "Back in service" the crew are
                    standing at the destination having just handed the patient
                    over — so the question about who took them belongs here,
                    beside that button, not further up the card where it is read
                    on the way out instead of on the way in. */}
                {!assisting && !isNoTransport(myRequest) && (myRequest.times || {}).arrivalDestination && (
                  <ReceiverBanner req={myRequest} canEdit onSave={setReceiver} />
                )}

                <button
                  style={stepBlocked ? styles.stepBtnBlocked : styles.stepBtn}
                  onClick={() => runAction("step", () => recordStep(nextStep))}
                  disabled={stepBlocked || !!acting}
                  title={stepBlocked ? `This call needs ${closeoutMissingText(blockers)} before it can close` : ""}
                >
                  <span style={styles.stepBtnCue}>
                    {stepBlocked ? "BLOCKED" : acting === "step" ? "SAVING" : "NEXT"}
                  </span>
                  {acting === "step" ? "Recording…" : nextStep.buttonLabel}
                  {!stepBlocked && <ChevronRight size={18} style={{ marginLeft: "auto" }} />}
                </button>
              </React.Fragment>
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
                Tick what you used on each call, then mark the truck restocked. These stay here
                until you do — signing out does not clear them.
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
export function CrewShiftCard({ user, unit, onCall }) {
  const meta = shiftMeta(user.shift);
  const now = Date.now();
  const ot = overtimeMs(user, now);
  const left = shiftRemainingMs(user, now);
  const notStarted = user.shiftStart && now < user.shiftStart;
  const otherSlot = user.slot === "alpha" ? "bravo" : "alpha";
  const partner = unit ? unit[otherSlot] : null;
  const partnerMeta = partner ? shiftMeta(partner.shift) : null;

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
    </div>
  );
}