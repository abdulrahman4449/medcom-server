import { actAsRole, choosePassword, lookupAccount, saveAccount, signIn, verifyPassword } from "../lib/auth.jsx";
import { BrandLockup, DEPT_LOGO, HOSPITAL_LOGO, ORG_NAME, SHOW_LOGOS } from "../brand/artwork.jsx";
import { APP_NAME } from "../brand/brand.jsx";
import { areaSentence } from "../domain/delegation.jsx";
import { reliefSituationFor, seatShiftIsOver } from "../domain/crew-relief.jsx";
import { handoverKind, handoverRequest, queueHandover } from "../domain/seat-handover.jsx";
import { ON_CALL_STATUSES, effectiveStatusMeta, liveRequestFor } from "../domain/in-service.jsx";
import { callRoute } from "../domain/call-locations.jsx";
import { DEFAULT_STATION, STATIONS, stationLabel, stationOf, stationShort } from "../domain/live-sheet.jsx";
import { clockStr, msDurationStr, otHoursStr, shortDurationStr } from "../domain/messages.jsx";
import { crewShiftSummary, overtimeMs, scheduledShiftKey, seatLabel, shiftAssignment, shiftMeta, shiftPhrase } from "../domain/shift-helpers.jsx";
import { HANDOVER_GRACE_MS } from "../domain/shifts.jsx";
import { actorStamp } from "../export/name-stamps.jsx";
import { API_BASE } from "../lib/board-api.jsx";
import { Ambulance, Archive, CheckCircle2, ChevronRight, Radio, Users } from "../lib/icons.jsx";
import { readKey, writeKey } from "../lib/offline-queue.jsx";
import { useEffect, useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";
import { InfoNote } from "./AssistanceTasks.jsx";
import { requestPasswordReset } from "./PasswordResets.jsx";
import { ShiftPicker } from "./ShiftPicker.jsx";
import { GlobalFont } from "./font.jsx";

// ---------- login ----------

// Is this person already sitting somewhere?
//
// A crew member signing in on a second device — their own phone as well as the
// truck tablet, or a tablet that was restarted — is not a handover. The board
// used to offer them "take over" against their own name, which stands them
// down and writes a shift swap recording that they relieved themselves. That is
// a fiction on the log sheet and it resets their own hours.
export function seatHeldBy(units, accountId) {
  if (!accountId) return null;
  for (const u of units || []) {
    for (const slot of ["alpha", "bravo"]) {
      const m = u && u[slot];
      if (m && m.accountId === accountId) return { unit: u, slot, member: m };
    }
  }
  return null;
}

// What the sign-in screen has to say before anybody types: why this device
// was signed out (App.jsx sets it), in words that stop the wrong next step.
function loginNoticeText(notice) {
  if (notice === "other-device") {
    return "You signed in on another phone, so this one was signed out. Nothing on the board changed — your seat, your shift and your hours carry on. Sign in here to continue as yourself.";
  }
  if (notice && notice.startsWith("declined:")) {
    const [, by, unit, seat] = notice.split(":");
    return `${by} declined your request to take over ${unit} · ${seat}. You have been signed off. If the seat has to change hands, ask the dispatcher.`;
  }
  return "";
}

// One choice on the role screen, drawn to the card contract in
// design/README.md: 16px radius, hairline, lift, and a 4px status bar across
// the top so what kind of work it is survives distance and colour blindness —
// the same rule the fleet cards on the board follow.
function RoleCard({ tone, icon, title, sub, onClick, disabled, held, pill }) {
  return (
    <button
      style={{ ...styles.roleCard, ...(held ? styles.roleCardHeld : null) }}
      onClick={onClick}
      disabled={disabled}
    >
      <span style={{ ...styles.roleCardBar, background: tone }} />
      <span style={{ ...styles.roleCardIcon, background: `color-mix(in srgb, ${tone} 14%, transparent)` }}>
        {icon}
      </span>
      <span style={styles.roleCardBody}>
        {pill && <span style={styles.roleCardPill}>{pill}</span>}
        <span style={{ ...styles.roleCardTitle, display: "block" }}>{title}</span>
        {sub && <span style={{ ...styles.roleCardSub, display: "block" }}>{sub}</span>}
      </span>
      <ChevronRight size={18} color="var(--ink-4)" />
    </button>
  );
}

export function LoginScreen({ units, onLogin, saveUnits, addLog, theme, onToggleTheme, loginNotice }) {
  // ---- account sign-in state machine ----
  const [stage, setStage] = useState("id"); // "id" | "createPassword" | "roleChoice" | "chooseShift" | "chooseStation" | "chooseTeam" | "chooseSeat"
  const [idInput, setIdInput] = useState("");
  const [foundAccount, setFoundAccount] = useState(null);
  const [seatUnit, setSeatUnit] = useState(null);
  const [joinTeamId, setJoinTeamId] = useState(null);
  // What this session will end up being — "dispatcher" (own desk) or "team"
  // (a seat on a unit). Set before the shift step, because that's what decides
  // whether a seat still has to be picked afterward.
  const [pendingRole, setPendingRole] = useState(null);
  // Whether this sign-on is being made on borrowed authority. Carried onto the
  // shift log so a night worked on a delegation reads as one.
  const [actingDelegated, setActingDelegated] = useState(false);
  const [shiftKey, setShiftKey] = useState(null);
  // Which of the two stations this session is working. Everything the
  // session then sees — calls, bookings, the log — is that station's.
  const [stationKey, setStationKey] = useState(null);
  // The partner being signed in on the same device, if there is one.
  const [partnerId, setPartnerId] = useState("");
  const [partnerError, setPartnerError] = useState("");
  const [partnerPw, setPartnerPw] = useState("");
  const [partnerOk, setPartnerOk] = useState(false);
  // Matched against the ID list the same way the person signing in was, so a
  // typo says so here rather than seating a name that does not exist.
  const [partnerAccount, setPartnerAccount] = useState(null);
  const partnerName = partnerAccount ? partnerAccount.name || partnerAccount.id : "";
  useEffect(() => {
    const q = (partnerId || "").trim().toLowerCase();
    if (!q) {
      setPartnerAccount(null);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      let hit = null;
      try {
        hit = (await lookupAccount(q)).account;
      } catch (e) {
        hit = null;
      }
      if (!alive) return;
      setPartnerAccount(hit);
      setPartnerError(hit ? "" : "That ID isn't recognised.");
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [partnerId]);

  // Checked as it is typed, so the crew know before they commit whether the
  // second seat is actually going to be taken.
  useEffect(() => {
    let alive = true;
    if (!partnerAccount || !partnerPw) {
      setPartnerOk(false);
      return;
    }
    (async () => {
      // Checked on the server like any other password. The token this device
      // already holds is kept - the partner is taking a seat, not the device.
      const good = partnerAccount.hasPassword && (await verifyPassword(partnerAccount.id, partnerPw));
      if (!alive) return;
      setPartnerOk(good);
      setPartnerError(good || partnerPw.length < 4 ? "" : "That password doesn't match that ID.");
    })();
    return () => {
      alive = false;
    };
  }, [partnerAccount, partnerPw]);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  // The one-time code an administrator issued for a first sign-in.
  const [claimCode, setClaimCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Whether the truck being signed into is out on a call RIGHT NOW. The seat
  // card has to say so in so many words: it decides whether choosing a held
  // seat asks its holder or queues behind a running call, and a crew member
  // reading "Held by Ali" cannot be expected to know which. Read while the
  // seat picker is open, every few seconds, and nowhere else.
  const [seatRequests, setSeatRequests] = useState([]);
  // The server's "your account is seated on another phone" answer, held for
  // the screen that asks whether to go on.
  const [seatedElsewhere, setSeatedElsewhere] = useState(null);
  // The board as this screen knows it. The `units` prop is what the app's poll
  // holds, and on a phone that has just signed in the poll has not run yet (it
  // waits for a token) — so the station list said "0 medics on this station"
  // and the team list was empty for the first seconds of every sign-in. This
  // is read straight off the board once the password is accepted and kept
  // fresh while somebody is choosing, and nothing below draws off the prop.
  const [boardUnits, setBoardUnits] = useState(units || []);
  const [boardFresh, setBoardFresh] = useState(false);
  useEffect(() => {
    if (Array.isArray(units) && units.length) setBoardUnits(units);
  }, [units]);
  useEffect(() => {
    if (!["chooseStation", "chooseTeam", "chooseSeat", "resume"].includes(stage)) return;
    let alive = true;
    const pull = async () => {
      const u = await readKey("ems:units", null);
      if (alive && Array.isArray(u)) { setBoardUnits(u); setBoardFresh(true); }
    };
    pull();
    const t = setInterval(pull, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [stage]);
  useEffect(() => {
    if (stage !== "chooseSeat") return;
    let alive = true;
    const pull = async () => {
      const r = await readKey("ems:requests", []);
      if (alive) setSeatRequests(Array.isArray(r) ? r : []);
    };
    pull();
    const t = setInterval(pull, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [stage]);

  // Dispatchers and admins get an extra step after their password: keep their
  // own view, or join a team as crew for this shift. Crew go straight on to
  // picking their shift, then the medic they're working, then a seat on it.
  const canJoinTeam = (accountRole) => accountRole === "admin" || accountRole === "dispatcher";

  // Authority an administrator lent them, if it is still live. The server
  // decides that — this is only what it said when the password was checked, and
  // every request afterwards is re-checked against the account.
  const delegation =
    foundAccount && foundAccount.delegation && Array.isArray(foundAccount.delegation.scopes)
      ? foundAccount.delegation
      : null;
  const lentAreas = delegation ? delegation.scopes : [];

  // What the ACCOUNT holds, carried onto every session this screen creates.
  //
  // None of the sessions built below used to carry it, so `DelegatedTag` had
  // nothing to draw the lent-area chip from and `RoleSwitch` had no second role
  // to offer — a dispatcher lent the overtime saw no chip beside their name and
  // no way into it without signing out, which is the whole feature. `ownRole`
  // is the role they actually are, so switching back knows where back is.
  const authorityOf = (account) => ({
    ownRole: (account && account.role) || null,
    // The owner's mark, from the server — it draws the System tile and
    // nothing else; every owner route re-checks the account regardless.
    isOwner: !!(account && account.isOwner),
    roles: Array.isArray(account && account.roles) ? account.roles : [],
    delegation:
      account && account.delegation && Array.isArray(account.delegation.scopes)
        ? account.delegation
        : null,
  });
  // The desk is a role — a shift, a station, a sign-on on the log. Every other
  // area is a part of administration. Somebody can be lent both, and is then
  // offered both.
  const lentDesk = lentAreas.includes("dispatch");
  const lentAdminAreas = lentAreas.filter((k) => k !== "dispatch");

  // Stepping into a delegated role.
  //
  // The token is re-issued for that role BEFORE the session says so. The other
  // way round put an administrator's screen in front of somebody whose every
  // request the board was still answering as crew — every button on it visible
  // and every one of them refused.
  async function actAsDelegated(role) {
    if (!foundAccount || !delegation) return;
    setBusy(true);
    setError("");
    let held = [];
    try {
      const out = await actAsRole(role);
      held = (out && out.scopes) || [];
    } catch (e) {
      setBusy(false);
      setError((e && e.message) || "That could not be done. Try again.");
      return;
    }
    const areas = role === "admin" ? held : ["dispatch"];
    const session = {
      role,
      name: foundAccount.name || foundAccount.id,
      accountId: foundAccount.id,
      delegated: true,
    };
    await addLog(
      `${foundAccount.name || foundAccount.id} signed in on authority delegated by ` +
        `${delegation.by || "an administrator"} — working on ${areaSentence(areas).toLowerCase()}`,
      "status",
      null,
      actorStamp(session)
    );
    setBusy(false);
    setActingDelegated(true);
    if (role === "admin") {
      onLogin({
        ...authorityOf(foundAccount),
        role: "admin",
        name: session.name,
        accountId: session.accountId,
        delegated: true,
        // The areas this session may touch. Its presence is what tells the app
        // this is administration borrowed rather than held — see `canArea`.
        delegatedScopes: held,
      });
      return;
    }
    setPendingRole("dispatcher");
    setStage("chooseShift");
  }

  async function routeAfterPassword(account) {
    // Already on a seat? Then they are signing in again, not signing on. Offer
    // to carry on being who they already are before anything else.
    //
    // Read the board HERE, not off the prop: on a phone that has just signed
    // in for the first time the poll has not run yet (it waits for a token),
    // the prop is still empty, and the person who most needs "Continue as
    // MEDIC 1" — somebody changing phones mid-shift — was sent to pick a
    // shift and a truck as if they were new.
    const freshUnits = (await readKey("ems:units", units)) || units;
    if (Array.isArray(freshUnits)) { setBoardUnits(freshUnits); setBoardFresh(true); }
    const held = seatHeldBy(freshUnits, account.id);
    if (held) {
      setSeatUnit(held.unit);
      setJoinTeamId(held.unit.id);
      setStage("resume");
      return;
    }
    // The choice is offered to anybody who has more than one role to choose
    // between — which now includes a crew member an administrator has lent
    // authority to, and did not before.
    const lent = account.delegation && account.delegation.scopes;
    if (canJoinTeam(account.role) || (Array.isArray(lent) && lent.length > 0)) {
      setStage("roleChoice");
      return;
    }
    setPendingRole("team");
    setStage("chooseShift");
  }

  // Carrying on. Nothing is written: they are already signed on, the seat is
  // already theirs, and their hours have been running since they took it. This
  // only tells this device who it is.
  function resumeSeat() {
    const held = seatHeldBy(boardUnits, foundAccount && foundAccount.id);
    if (!held) {
      // The seat went while they were reading the screen.
      setStage(canJoinTeam(foundAccount.role) ? "roleChoice" : "chooseShift");
      return;
    }
    const { unit, slot, member } = held;
    onLogin({
      ...authorityOf(foundAccount),
      role: "team",
      accountId: foundAccount.id,
      name: foundAccount.name || member.name || foundAccount.id,
      unitId: unit.id,
      unitName: unit.name,
      station: stationOf(unit),
      slot,
      shift: member.shift || scheduledShiftKey(Date.now()),
      shiftStart: member.shiftStart || null,
      shiftEnd: member.shiftEnd || null,
      signedOnAt: member.signedOnAt || Date.now(),
    });
  }

  // One press, both fields.
  //
  // The ID and the password used to be two screens with a Continue between
  // them, which meant a crew member at a changeover typed, waited for a round
  // trip, then typed again. The design puts them on one card, so this does the
  // lookup and the check together — and the one case that genuinely needs a
  // second screen, somebody signing in for the first time who has no password
  // yet, is the only thing that moves them on to one.
  async function handleSignIn() {
    // The Sign in button is already disabled while this is empty, so there is
    // nothing to mark: it cannot be pressed with a blank ID in the first place.
    if (!idInput.trim()) return;
    setBusy(true);
    setError("");
    // The roster is not on this device any more. The server says whether the ID
    // exists and whether a password has been chosen for it; the password itself
    // is only ever checked there.
    let found = null;
    try {
      const looked = await lookupAccount(idInput.trim());
      found = looked.account;
    } catch (e) {
      setBusy(false);
      setError(
        e.status === 404
          ? "ID not recognised. Contact your administrator."
          : e.message || "Could not reach the server."
      );
      return;
    }
    // No role is checked here any more, because none was asked for. The tab
    // strip made a person name their own role BEFORE the app knew who they
    // were, and answered a wrong guess with "that isn't a team ID — try the
    // Dispatcher or Admin tab instead": a refusal for a question that should
    // never have been put. The account says what it is, and `routeAfterPassword`
    // offers only what it actually holds.
    setFoundAccount(found);

    // No password on the account yet: this is their first time, and the next
    // screen asks them to choose one. Whatever they typed in the password box
    // is discarded rather than silently becoming their password — a field
    // filled in before anyone said it would be kept is not a choice.
    if (!found.hasPassword) {
      setPw("");
      setPw2("");
      setBusy(false);
      setStage("createPassword");
      return;
    }

    try {
      // Checked on the server, which is the only place that can check it.
      // Signing in is what issues this device its token.
      found = await signIn(idInput.trim(), pw);
      setFoundAccount(found);
    } catch (e) {
      setBusy(false);
      // Right password, but this account is seated on a truck from another
      // phone. Signing in here would sign that phone out mid-shift — and a
      // signed-out phone cannot sound a call — so it is asked, not assumed.
      if (e.status === 409 && e.data && e.data.reason === "seated-elsewhere") {
        setSeatedElsewhere({ id: idInput.trim(), pw, unitName: e.data.unitName, slot: e.data.slot });
        setStage("seatedElsewhere");
        return;
      }
      setError(e.message || "That password doesn't match that ID.");
      setPw("");
      return;
    }
    setBusy(false);
    setPw("");
    await routeAfterPassword(found);
  }

  // "Yes, this is my phone now": sign the other phone out and carry on.
  async function continueDespiteSeat() {
    if (!seatedElsewhere) return;
    setBusy(true);
    setError("");
    let found;
    try {
      found = await signIn(seatedElsewhere.id, seatedElsewhere.pw, true);
      setFoundAccount(found);
    } catch (e) {
      setBusy(false);
      setError(e.message || "Could not sign in.");
      return;
    }
    setBusy(false);
    setPw("");
    setSeatedElsewhere(null);
    await routeAfterPassword(found);
  }

  // Forgotten it. This asks an administrator; it does not let anybody in.
  async function askForReset() {
    const typed = idInput.trim();
    if (!typed) {
      setError("Type your employee ID first, then press this.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      let found = null;
      try {
        found = (await lookupAccount(typed)).account;
      } catch (e) {
        found = null;
      }
      // Deliberately says the ID is not recognised rather than staying vague.
      // This is an internal board where IDs are issued by the department, not a
      // public site where confirming an account exists tells an attacker
      // something; being unclear here just leaves somebody stuck at a door.
      if (!found) {
        setError("ID not recognised. Contact your administrator.");
        return;
      }
      const res = await requestPasswordReset(found);
      if (res === "slow") {
        setError("Too many attempts — wait a few minutes, then press it once.");
        return;
      }
      if (!res) {
        setError("No signal — that request did not send. Try again in a moment.");
        return;
      }
      window.alert(
        `Sent to your administrator.\n\n` +
          `If you had already asked, they still see one request — asking again loses nothing. ` +
          `Once they clear it, sign in with your ID and you will be asked to choose a new ` +
          `password. Your account is not deleted and nothing on your record is lost.`
      );
    } finally {
      setBusy(false);
    }
  }

  // Setting a password for the first time. The server decides whether that is
  // allowed — this screen cannot grant it.
  async function handleCreatePassword() {
    if (!claimCode.trim()) {
      setError("Enter the sign-in code your administrator gave you.");
      return;
    }
    if (pw.length < 4) {
      setError("Password must be at least 4 characters.");
      return;
    }
    if (pw !== pw2) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    let updatedAccount;
    try {
      // The server stores it, salted, and signs this device in as part of the
      // same call - there is no moment where a password exists on the device.
      updatedAccount = await choosePassword(foundAccount.id, pw, claimCode.trim());
    } catch (e) {
      setBusy(false);
      setError(e.message || "Could not set that password.");
      return;
    }
    setFoundAccount(updatedAccount);
    setBusy(false);
    await routeAfterPassword(updatedAccount);
  }


  // Crew members choose their own seat at sign-in — fetch the chosen medic's
  // live occupancy so the two seats can be offered accurately, along with who
  // is sitting in them and on which shift, since a seat still held by an
  // outgoing crew member is exactly the handover case.
  async function enterSeatStage(unitId) {
    setBusy(true);
    setError("");
    const freshUnits = await readKey("ems:units", []);
    setSeatUnit(freshUnits.find((u) => u.id === unitId) || null);
    setBusy(false);
    setStage("chooseSeat");
  }

  function chooseJoinTeam(unitId) {
    setJoinTeamId(unitId);
    enterSeatStage(unitId);
  }

  // The shift step: what everyone signing on to work the board answers, since
  // the clock alone can't tell a day crew running late from a night crew
  // starting early.
  function chooseShift(key) {
    setShiftKey(key);
    setError("");
    // Then which station. Both roles answer it: the desk runs one station's
    // board, and a crew signs on to the medic they are actually working, which
    // only means anything once we know which station's medics to show them.
    setStage("chooseStation");
  }

  function chooseStation(key) {
    setStationKey(key);
    setError("");
    if (pendingRole === "dispatcher") {
      finishDispatcherLogin(foundAccount, shiftKey, key);
      return;
    }
    // Nobody is rostered to a fixed medic: the unit is chosen on the way in,
    // every time. Crews here move between medics from one shift to the next, so
    // an account that remembered a unit only ever recorded where someone used
    // to be — and put the wrong name against the wrong truck on the log sheet.
    setStage("chooseTeam");
  }

  async function finishDispatcherLogin(account, key, station) {
    setBusy(true);
    const now = Date.now();
    const assignment = shiftAssignment(key, now);
    const late = overtimeMs(assignment, now);
    // Working the desk on somebody else's authority is a fact about the shift,
    // so it goes on the shift log rather than only on the screen it was chosen
    // from. A month later, "who was on the desk that night" has to answer
    // truthfully, and "a crew member, on the administrator's authority" is a
    // different answer from "a dispatcher".
    const borrowed = actingDelegated && account.role !== "dispatcher";
    const session = {
      ...authorityOf(account),
      role: "dispatcher",
      name: account.name || account.id,
      accountId: account.id,
      station: station || DEFAULT_STATION,
      ...(borrowed ? { delegated: "dispatcher" } : {}),
      ...assignment,
    };
    await addLog(
      `Dispatch — ${account.name || account.id} signed on at ${stationLabel(session.station)} for ${shiftPhrase(assignment)}` +
        (borrowed ? " · on delegated authority" : "") +
        (late > 0 ? ` · already ${msDurationStr(late)} past that shift's end` : ""),
      "shift",
      {
        kind: "on",
        role: "dispatcher",
        name: account.name || account.id,
        accountId: account.id,
        shift: key,
        station: session.station,
        shiftStart: assignment.shiftStart,
        shiftEnd: assignment.shiftEnd,
        overtimeMs: late,
        delegated: borrowed || undefined,
      },
      // This device has no session yet, so the stamp comes from the person who
      // has just signed on rather than from whoever was here before them.
      actorStamp(session)
    );
    setBusy(false);
    onLogin(session);
  }

  // Taking a seat that someone is still sitting in: the outgoing crew member
  // is stood down (their own session drops back to the login screen on its next
  // poll) and the swap goes on the log sheet naming both sides.
  //
  // Three cases (seat-handover.jsx). Somebody MID-SHIFT is asked, on their own
  // phone, and nothing moves until they answer. Somebody whose shift is over
  // and who is not out went home without signing out — there is nobody to ask,
  // so that is the plain takeover it always was. Somebody still out on a call
  // is queued for; finishTeamLogin asks its own question for that one.
  async function takeOverSeat(seat, holder) {
    const now = Date.now();
    const freshRequests = (await readKey("ems:requests", [])) || [];
    const kind = handoverKind(seatUnit, seat, freshRequests, foundAccount.id, now);
    const holderMeta = shiftMeta(holder.shift);
    const ot = overtimeMs(holder, now);
    const where = seatUnit ? seatUnit.name : "this team";
    const who =
      `${holder.name} is still signed on${holderMeta ? ` for the ${holderMeta.label.toLowerCase()}` : ""}` +
      `${ot > 0 ? ` and is ${otHoursStr(ot)} into overtime` : ""}.`;
    let confirmed = true;
    if (kind === "needs-approval") {
      confirmed = window.confirm(
        `Ask ${holder.name} to hand over ${seatLabel(seat)} on ${where}?\n\n${who}\n\n` +
          `They are asked on their own phone. You will be signed on and waiting; the seat is yours the moment ` +
          `they approve or sign out. If they cannot answer, the dispatcher can hand it over.`
      );
    } else if (kind === "forgot") {
      confirmed = window.confirm(
        `Take over ${seatLabel(seat)} on ${where}?\n\n` +
          `${holder.name}'s shift ended${holder.shiftEnd ? ` at ${clockStr(holder.shiftEnd)}` : ""} and the truck is not out — ` +
          `they left without signing out. They will be signed off and the swap recorded on the log sheet.`
      );
    }
    if (!confirmed) return;
    finishTeamLogin(foundAccount, seat);
  }

  // Signing in again while waiting for a seat — on another phone, or after
  // this one restarted. Nothing is written: the ask is already on the seat.
  function resumeWaiting(seat) {
    const unit = seatUnit;
    const r = unit ? handoverRequest(unit, seat) : null;
    if (!r || r.accountId !== foundAccount.id) return;
    onLogin({
      ...authorityOf(foundAccount),
      role: "team",
      accountId: foundAccount.id,
      name: foundAccount.name || r.name || foundAccount.id,
      unitId: unit.id,
      unitName: unit.name,
      station: stationOf(unit),
      slot: seat,
      shift: r.shift || scheduledShiftKey(Date.now()),
      shiftStart: r.shiftStart || null,
      shiftEnd: r.shiftEnd || null,
      signedOnAt: r.queuedAt || Date.now(),
      awaitingRelief: true,
    });
  }

  // The other seat, taken at the same time and in the partner's own name. Only
  // ever the opposite seat to the one being signed into, and never over somebody
  // already sitting there — a crew sharing a tablet must not quietly stand down
  // whoever the board thinks is in that seat.
  async function seatPartnerIfAny(teamId, mySeat, assignment) {
    // No password, no seat. This is the whole point of asking for it.
    if (!partnerAccount || !partnerOk || !teamId) return null;
    const other = mySeat === "alpha" ? "bravo" : "alpha";
    const fresh = await readKey("ems:units", units);
    const unit = fresh.find((u) => u.id === teamId);
    if (!unit) return null;
    if (unit[other]) return { skipped: "occupied", seat: other };
    if (partnerAccount.id === (foundAccount ? foundAccount.id : "")) return { skipped: "same", seat: other };
    const member = {
      accountId: partnerAccount.id,
      name: partnerAccount.name || partnerAccount.id,
      signedOnAt: Date.now(),
      // Signed on from the other seat's device. Recorded so that when that seat
      // signs off, this one goes with it — the tablet is leaving the truck.
      viaSeat: mySeat,
      viaAccountId: foundAccount ? foundAccount.id : null,
      ...assignment,
    };
    await saveUnits(fresh.map((u) => (u.id === teamId ? { ...u, [other]: member } : u)));
    return { seated: member, seat: other };
  }

  async function finishTeamLogin(account, slot) {
    const teamId = joinTeamId;
    // The medic is always picked on the way in, so there is nothing to fall back
    // on if that step was somehow skipped — send them back to it.
    if (!teamId) {
      setStage("chooseTeam");
      return;
    }
    setBusy(true);
    const now = Date.now();
    const key = shiftKey || scheduledShiftKey(now);
    const assignment = shiftAssignment(key, now);

    // Crew (or a dispatcher/admin choosing to join a team): take the seat they
    // chose, stamped with the shift they're working. If the team was completely
    // unstaffed and idle, this also brings it back online automatically.
    const freshUnits = await readKey("ems:units", units);
    const unit = freshUnits.find((u) => u.id === teamId);
    const displaced = unit ? unit[slot] : null;
    const vacated = unit && unit.lastCrew ? unit.lastCrew[slot] : null;
    // Who this person is relieving: whoever is being taken over from right now,
    // or the last person to hold the seat if they left recently enough for it to
    // be the same handover rather than an unrelated shift days ago.
    const relieved =
      displaced ||
      (vacated && now - (vacated.signedOffAt || 0) <= HANDOVER_GRACE_MS ? vacated : null);

    // A seat whose crew are still out on a call is not taken — it is queued for.
    // They stay on it until they clear and sign out, and it transfers itself
    // then. The person arriving is on duty from now either way, so their own
    // hours start correctly.
    // Read straight from the board. This screen has no requests prop — reaching
    // for one threw before anything else could run, which stopped every crew
    // sign-on for every ID and looked like the app simply doing nothing.
    const freshRequests = (await readKey("ems:requests", [])) || [];
    const situation = reliefSituationFor(unit, slot, freshRequests, now);
    if (unit && situation === "still-out") {
      const out = unit[slot];
      const ok = window.confirm(
        `${unit.name} is still out on a call with ${out.name} in ${seatLabel(slot)}.\n\n` +
          `You will be signed on now and take the seat automatically the moment they clear and ` +
          `sign out — their overtime keeps counting until then, and the call keeps its crew.\n\n` +
          `Sign on as relief?`
      );
      if (!ok) {
        setBusy(false);
        return;
      }
      const nextUnits = freshUnits.map((u) =>
        u.id === teamId
          ? {
              ...u,
              relief: {
                ...(u.relief || {}),
                [slot]: {
                  accountId: account.id,
                  name: account.name || account.id,
                  queuedAt: now,
                  ...assignment,
                },
              },
            }
          : u
      );
      await saveUnits(nextUnits);
      const session = {
        ...authorityOf(account),
        role: "team",
        accountId: account.id,
        name: account.name || account.id,
        unitId: teamId,
        unitName: unit.name,
        station: stationOf(unit),
        slot,
        shift: key,
        ...assignment,
        // Waiting for the seat rather than sitting in it.
        awaitingRelief: true,
      };
      await addLog(
        `${unit.name} — ${session.name} signed on to relieve ${out.name} (${seatLabel(slot)}), ` +
          `who is still out on a call · takes the seat when they sign out`,
        "shift",
        {
          kind: "on",
          role: "team",
          name: session.name,
          accountId: account.id,
          unitId: teamId,
          unitName: unit.name,
          station: stationOf(unit),
          seat: slot,
          shift: key,
          shiftStart: assignment.shiftStart,
          shiftEnd: assignment.shiftEnd,
          awaitingRelief: true,
        },
        actorStamp(session)
      );
      setBusy(false);
      onLogin(session);
      return;
    }

    // Somebody mid-shift is asked, on their own phone. The ask goes on the seat
    // (the same queue a still-out relief uses), the person asking is signed on
    // and waiting, and the seat moves only when the holder approves or signs
    // out — or when the desk hands it over because the holder cannot answer.
    if (unit && situation === "on-shift" && unit[slot] && unit[slot].accountId !== account.id) {
      const out = unit[slot];
      const nextUnits = freshUnits.map((u) =>
        u.id === teamId
          ? queueHandover(u, slot, { accountId: account.id, name: account.name || account.id, ...assignment }, now, true)
          : u
      );
      await saveUnits(nextUnits);
      const session = {
        ...authorityOf(account),
        role: "team",
        accountId: account.id,
        name: account.name || account.id,
        unitId: teamId,
        unitName: unit.name,
        station: stationOf(unit),
        slot,
        shift: key,
        ...assignment,
        awaitingRelief: true,
      };
      await addLog(
        `${unit.name} — ${session.name} asked to take over ${seatLabel(slot)} from ${out.name} · waiting for their approval`,
        "shift",
        {
          kind: "on",
          role: "team",
          name: session.name,
          accountId: account.id,
          unitId: teamId,
          unitName: unit.name,
          station: stationOf(unit),
          seat: slot,
          shift: key,
          shiftStart: assignment.shiftStart,
          shiftEnd: assignment.shiftEnd,
          awaitingRelief: true,
          askedToTakeOver: out.accountId,
        },
        actorStamp(session)
      );
      setBusy(false);
      onLogin(session);
      return;
    }

    if (unit) {
      const bothEmptyBefore = !unit.alpha && !unit.bravo;
      // Signing on puts the team in service. Two cases need it: nobody was on
      // board (so no one can have chosen to be out of service), and a unit
      // still wearing an on-call status from a call that has already finished —
      // that second case is what left crews signed on while dispatch saw
      // nothing in service and had no team to assign a call to. A deliberate
      // "Out of service" from a crew member who is still on board is left
      // alone; their partner signing on doesn't override them.
      const staleOnCallStatus = !unit.assignedRequestId && ON_CALL_STATUSES.includes(unit.status);
      const comesIntoService =
        (bothEmptyBefore && (unit.status === "oos" || !unit.status)) || staleOnCallStatus;
      const nextUnits = freshUnits.map((u) =>
        u.id === teamId
          ? {
              ...u,
              [slot]: { accountId: account.id, name: account.name || account.id, ...assignment },
              status: comesIntoService ? "available" : u.status,
              assignedRequestId: staleOnCallStatus ? null : u.assignedRequestId,
            }
          : u
      );
      await saveUnits(nextUnits);
    }
    // Teams aren't fixed to a medic any more, so nothing about this sign-on is
    // written back to the account. Any unit left on an account from before that
    // change is cleared as its holder signs on, so the admin roster stops
    // showing a truck the person may not have worked for weeks.
    if (account.role === "crew" && account.team) {
      // The roster lives on the server now and only an administrator may
      // change it, so this clears the stale truck through the accounts
      // endpoint rather than by rewriting a board key.
      try {
        await saveAccount({ ...account, team: null });
      } catch (e) {
        // A crew member is not an administrator, so this is refused for
        // everyone but an admin signing on to a truck. It is cosmetic - the
        // roster showing a truck they may not have worked for weeks - and must
        // never stop somebody taking their seat.
      }
    }

    const unitName = unit ? unit.name : "";
    const late = overtimeMs(assignment, now);
    const relievedMeta = relieved ? shiftMeta(relieved.shift) : null;
    const relievedNote = relieved
      ? ` — ${displaced ? "taking over from" : "relieving"} ${relieved.name}` +
        (relievedMeta
          ? ` (${relievedMeta.label}${relieved.overtimeMs ? `, ${otHoursStr(relieved.overtimeMs)} overtime` : ""})`
          : "")
      : "";
    const session = {
      ...authorityOf(account),
      role: "team",
      name: account.name || account.id,
      unitId: teamId,
      unitName,
      // The station is taken from the unit itself rather than from what was
      // tapped on the way in, so a crew's session can never disagree with the
      // truck they are actually sitting in.
      station: stationOf(unit),
      slot,
      accountId: account.id,
      ...assignment,
    };
    await addLog(
      `${unitName ? `${unitName} (${stationShort(stationOf(unit))}) — ` : ""}${account.name || account.id} (${seatLabel(slot)}) ` +
        `signed on for ${shiftPhrase(assignment)}` +
        (late > 0 ? ` · already ${msDurationStr(late)} past that shift's end` : "") +
        relievedNote,
      "shift",
      {
        kind: displaced ? "swap" : "on",
        role: "team",
        name: account.name || account.id,
        accountId: account.id,
        unitName,
        station: stationOf(unit),
        seat: slot,
        shift: key,
        shiftStart: assignment.shiftStart,
        shiftEnd: assignment.shiftEnd,
        overtimeMs: late,
        relievedName: relieved ? relieved.name : null,
        relievedShift: relieved ? relieved.shift || null : null,
        relievedOvertimeMs: relieved ? relieved.overtimeMs || 0 : 0,
      },
      // Stamped from the session this sign-on creates, since the board doesn't
      // have it yet.
      actorStamp(session)
    );
    // Signing on alone, confirmed.
    //
    // A truck with one seat filled is a truck that cannot run most calls, and
    // the board shows it as crewed either way. If nobody has been named for the
    // other seat, say so plainly before it is done.
    if (!partnerAccount && slot === "alpha") {
      const alone = window.confirm(
        `Sign on to ${unit ? unit.name : "this medic"} without a partner?\n\n` +
          `The truck will show as crewed with only ${seatLabel(slot)} filled. ` +
          `Your partner can sign on from their own device at any time.`
      );
      if (!alone) {
        setBusy(false);
        return;
      }
    }

    // If a partner's ID was given, they take the other seat now — recorded in
    // their own name, with the same shift, and logged as its own sign-on so the
    // sheet shows two people on the truck rather than one.
    const partnerResult = await seatPartnerIfAny(teamId, slot, assignment);
    if (partnerResult && partnerResult.seated) {
      await addLog(
        `${unitName ? `${unitName} — ` : ""}${partnerResult.seated.name} ` +
          `(${seatLabel(partnerResult.seat)}) signed on for ${shiftPhrase(assignment)} ` +
          `· signed in by ${account.name || account.id} on a shared device`,
        "shift",
        {
          kind: "on",
          role: "team",
          name: partnerResult.seated.name,
          accountId: partnerResult.seated.accountId,
          unitId: teamId,
          unitName,
          station: stationOf(unit),
          seat: partnerResult.seat,
          shift: key,
          shiftStart: assignment.shiftStart,
          shiftEnd: assignment.shiftEnd,
          sharedDevice: true,
        },
        actorStamp(session)
      );
    }

    setBusy(false);
    onLogin(session);
  }

  // Admins oversee the board around the clock and aren't rostered to either
  // 12-hour shift, so they skip the shift step; a dispatcher taking the desk
  // picks their shift like everyone else working the board.
  function continueAsSelf() {
    if (!foundAccount) return;
    if (foundAccount.role === "admin") {
      onLogin({
        ...authorityOf(foundAccount),
        role: "admin",
        name: foundAccount.name || foundAccount.id,
        accountId: foundAccount.id,
      });
      return;
    }
    setPendingRole("dispatcher");
    setStage("chooseShift");
  }

  function resetAccountFlow() {
    setStage("id");
    setIdInput("");
    setFoundAccount(null);
    setSeatUnit(null);
    setJoinTeamId(null);
    setPendingRole(null);
    setShiftKey(null);
    setPw("");
    setPw2("");
    setClaimCode("");
    setError("");
  }

  return (
    <div style={styles.loginWrap}>
      {onToggleTheme && (
        <button style={styles.loginThemeBtn} onClick={onToggleTheme}>
          {theme === "dark" ? "☀︎" : "☾"}
        </button>
      )}
      <GlobalFont />
      <div style={styles.loginCard}>
        {/* The white plate goes with the crests. Left behind on its own it is
            an empty card above the sign-in box, which reads as something that
            failed to load rather than as a deliberate space. */}
        {SHOW_LOGOS && (
          <div style={styles.logoPlateLogin}>
            <img src={HOSPITAL_LOGO} alt={ORG_NAME || "Hospital crest"} style={styles.loginHospitalLogo} />
            <div style={styles.loginLogoDivider} />
            <img src={DEPT_LOGO} alt={ORG_NAME ? `${ORG_NAME} Ambulance EMS` : "Ambulance EMS crest"} style={styles.loginDeptLogo} />
          </div>
        )}
        {/* The mark above the name, the name above the line it is sold on —
            centred, as the approved design has it. */}
        {/* The artwork, whole. It carries the name and the line beneath it
            already — setting either again in type beside it would be the same
            words twice in two different typefaces. */}
        <div style={styles.loginMark}>
          <BrandLockup size={168} />
        </div>
        {/* No door to pick. One ID, one password, and the ROLE comes after —
            see `routeAfterPassword`, which offers only what this account
            holds. The tab strip that used to sit here asked a person to name
            their own role before anything had identified them, and a wrong
            guess was answered with a refusal rather than an answer. */}
        <div style={{ marginTop: 18 }}>
            {loginNotice && loginNoticeText(loginNotice) && (
              <div style={styles.claimCodeBanner}>{loginNoticeText(loginNotice)}</div>
            )}
            {stage === "id" && (
              <>
                <label style={styles.loginFieldLabel}>EMPLOYEE ID</label>
                <input
                  style={styles.loginInput}
                  value={idInput}
                  onChange={(e) => setIdInput(e.target.value)}
                  placeholder="F1525518"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
                />
                <label style={{ ...styles.loginFieldLabel, marginTop: 14 }}>PASSWORD</label>
                <input
                  type="password"
                  style={styles.loginInput}
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
                />
                {error && <div style={styles.loginError}>{error}</div>}
                <button
                  style={busy || !idInput.trim() ? styles.loginSubmitOff : styles.loginSubmit}
                  disabled={busy || !idInput.trim()}
                  onClick={handleSignIn}
                >
                  {busy ? "Checking…" : "Sign in"}
                </button>
                <button style={styles.forgotBtn} onClick={askForReset} disabled={busy}>
                  Forgot your password?
                </button>

                <div style={styles.loginNote}>
                  <svg
                    width="15" height="15" viewBox="0 0 24 24" fill="none"
                    stroke="var(--info)" strokeWidth="2" strokeLinecap="round"
                    style={{ flex: "none" }}
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 11v5.5" />
                    <circle cx="12" cy="7.9" r=".9" fill="var(--info)" stroke="none" />
                  </svg>
                  <span>
                    The ambulance board for Emergency Medical Services. Sign in with the ID
                    your administrator gave you.
                  </span>
                </div>
              </>
            )}

            {stage === "createPassword" && (
              <>
                <div style={styles.loginSub}>First time signing in — choose a password.</div>
                {/* The code is what proves this account is theirs. An employee
                    ID is printed on a badge; on its own it used to be enough to
                    claim an account nobody had signed into yet. */}
                <label style={styles.label}>Sign-in code from your administrator</label>
                <input
                  style={{ ...styles.input, letterSpacing: 2, textTransform: "uppercase" }}
                  value={claimCode}
                  onChange={(e) => setClaimCode(e.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                />
                {/* Said out loud, because the question it answers came up for
                    real: "I don't receive a code." Nothing sends one. It is
                    handed over by the administrator, who has it on their screen
                    the moment they add you — the app has no way to message
                    somebody who has not signed in yet. */}
                <div style={styles.formHint}>
                  No code arrives by text or email. Your administrator issues it and sends it to
                  you — ask them for it if you have not been given one.
                </div>
                <label style={{ ...styles.label, marginTop: 14 }}>New password</label>
                <input
                  type="password"
                  style={styles.input}
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  placeholder="At least 4 characters"
                />
                <label style={styles.label}>Confirm password</label>
                <input
                  type="password"
                  style={styles.input}
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreatePassword()}
                />
                {error && <div style={styles.loginError}>{error}</div>}
                <div style={styles.loginActions}>
                  <button style={styles.ghostBtn} onClick={resetAccountFlow}>Back</button>
                  <button style={styles.primaryBtn} disabled={busy} onClick={handleCreatePassword}>
                    {busy ? "Saving…" : "Set password & sign in"}
                  </button>
                </div>
              </>
            )}

            {stage === "roleChoice" && (
              <>
                <div style={styles.loginSub}>
                  Welcome back, {foundAccount.name || foundAccount.id}.
                </div>
                <div style={{ ...styles.loginSub, marginTop: 4, color: "var(--ink-3)" }}>
                  What are you working as today?
                </div>
                {/* Only what this account actually holds. The tab strip that
                    used to sit on the first screen asked the same question
                    BEFORE anything had identified them, and answered a wrong
                    guess with a refusal; by the time this screen is drawn the
                    server has already said what they are. */}
                <div style={{ display: "flex", flexDirection: "column", gap: 11, marginTop: 14 }}>
                  <RoleCard
                    tone="var(--ok)"
                    icon={<Ambulance size={20} color="var(--ok)" />}
                    title={canJoinTeam(foundAccount.role) ? "Join a team" : "Continue as team member"}
                    sub="Work a truck. You pick the shift and the vehicle next."
                    onClick={() => {
                      setActingDelegated(false);
                      setPendingRole("team");
                      setStage("chooseShift");
                    }}
                  />
                  {/* An administrator covering the desk is a dispatcher for
                      that shift, not an administrator with a dispatch tab:
                      they pick a shift and a station like anybody else taking
                      the desk, their sign-on goes on the log sheet as
                      dispatch, and their hours run against that shift. Without
                      this the only way to cover a desk was to sign in on
                      somebody else's ID, which put the wrong name on the
                      night's log. */}
                  {foundAccount.role === "admin" && (
                    <RoleCard
                      tone="var(--flow)"
                      icon={<Radio size={20} color="var(--flow)" />}
                      title="Take the dispatch desk"
                      sub="Raise and assign calls. Signs you on to the desk for this shift."
                      onClick={() => {
                        setPendingRole("dispatcher");
                        setStage("chooseShift");
                      }}
                    />
                  )}
                  {canJoinTeam(foundAccount.role) && (
                    <RoleCard
                      tone="var(--move)"
                      icon={<Archive size={20} color="var(--move)" />}
                      title={foundAccount.role === "admin" ? "Administration" : "Continue as Dispatcher"}
                      sub={
                        foundAccount.role === "admin"
                          ? "Statistics, teams, the schedule and the archive."
                          : "Your own desk view."
                      }
                      onClick={continueAsSelf}
                    />
                  )}
                  {/* Authority somebody lent them. Named, dated, and under
                      their own name — which is the whole point: the alternative
                      people were using was signing in on the administrator's
                      own ID, which put the wrong name on every line of the
                      night's log. The desk is now ONLY ever reached this way
                      for anybody who is not an administrator. */}
                  {lentDesk && (
                    <RoleCard
                      tone="var(--move)"
                      icon={<Radio size={20} color="var(--move)" />}
                      title="Work the dispatch desk"
                      sub={`Lent to you by ${delegation.by || "an administrator"}.`}
                      disabled={busy}
                      onClick={() => actAsDelegated("dispatcher")}
                    />
                  )}
                  {lentAdminAreas.length > 0 && (
                    <RoleCard
                      tone="var(--move)"
                      icon={<Archive size={20} color="var(--move)" />}
                      /* Named for what they can actually do, not "as an
                         administrator" — they are not one, and the screen
                         they get is only the part they were lent. */
                      title={`Work on ${areaSentence(lentAdminAreas)}`}
                      sub={`Lent to you by ${delegation.by || "an administrator"}.`}
                      disabled={busy}
                      onClick={() => actAsDelegated("admin")}
                    />
                  )}
                </div>
                <div style={styles.loginFootnote}>
                  You can change this without signing out — whatever you choose, the other
                  roles you hold stay one tap away in the header.
                </div>
                <div style={styles.loginActions}>
                  <button style={styles.ghostBtn} onClick={resetAccountFlow}>Not you? Back</button>
                </div>
              </>
            )}

            {stage === "chooseShift" && <ShiftPicker
              subject={pendingRole === "dispatcher" ? "the dispatch desk" : "your team"}
              busy={busy}
              onPick={chooseShift}
              onBack={() => (canJoinTeam(foundAccount.role) ? setStage("roleChoice") : resetAccountFlow())}
            />}

            {stage === "chooseStation" && (
              <>
                <div style={styles.loginSub}>Which station are you working this shift?</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
                  {STATIONS.map((s) => {
                    const count = boardUnits.filter((u) => stationOf(u) === s.key).length;
                    return (
                      <button key={s.key} style={styles.roleBtn} onClick={() => chooseStation(s.key)}>
                        <div style={{ textAlign: "left" }}>
                          <div style={styles.roleBtnTitle}>{s.label}</div>
                          <div style={styles.roleBtnSub}>
                            {boardFresh || boardUnits.length
                              ? `${count} ${count === 1 ? "medic" : "medics"} on this station`
                              : "Reading the board…"}
                          </div>
                        </div>
                        <ChevronRight size={18} color="var(--ink-3)" />
                      </button>
                    );
                  })}
                </div>
                <div style={styles.loginActions}>
                  <button style={styles.ghostBtn} onClick={() => setStage("chooseShift")}>Back</button>
                </div>
              </>
            )}

            {stage === "chooseTeam" && (
              <>
                <div style={styles.loginSub}>
                  Which medic are you working this shift at {stationLabel(stationKey)}?
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
                  {!boardFresh && !boardUnits.length && (
                    <div style={styles.formHint}>Reading the board…</div>
                  )}
                  {boardUnits.filter((u) => stationOf(u) === stationKey).map((u) => (
                    <button key={u.id} style={styles.roleBtn} onClick={() => chooseJoinTeam(u.id)}>
                      <div style={{ textAlign: "left" }}>
                        <div style={styles.roleBtnTitle}>{u.name}</div>
                        <div style={styles.roleBtnSub}>
                          {u.alpha && u.bravo ? "Both seats filled" : u.alpha || u.bravo ? "One seat open" : "Both seats open"}
                          {crewShiftSummary(u) ? ` · on duty: ${crewShiftSummary(u)}` : ""}
                        </div>
                      </div>
                      <ChevronRight size={18} color="var(--ink-3)" />
                    </button>
                  ))}
                </div>
                <InfoNote label="More about this">
                  Nobody is fixed to a medic — pick the unit you're on today. Your name is stamped on
                  every line it puts on the log sheet.
                </InfoNote>
                <div style={styles.loginActions}>
                  <button style={styles.ghostBtn} onClick={() => setStage("chooseShift")}>
                    Back
                  </button>
                </div>
              </>
            )}

            {/* Right password, but seated on a truck from ANOTHER phone. */}
            {stage === "seatedElsewhere" && seatedElsewhere && (
              <>
                <div style={styles.loginSub}>
                  You are signed on as {seatedElsewhere.unitName} · {seatLabel(seatedElsewhere.slot)} from another phone.
                </div>
                <div style={styles.claimCodeBanner}>
                  Continuing here signs that phone OUT. A signed-out phone does not sound a call.
                  If you are changing phones, continue — your seat, shift and hours carry on. If you only
                  want to look at the board, go back and use a different account.
                </div>
                <button style={styles.loginSubmit} disabled={busy} onClick={continueDespiteSeat}>
                  Continue on this phone
                </button>
                {error && <div style={styles.loginError}>{error}</div>}
                <div style={styles.loginActions}>
                  <button style={styles.ghostBtn} onClick={() => { setSeatedElsewhere(null); setPw(""); resetAccountFlow(); }}>
                    Back
                  </button>
                </div>
              </>
            )}

            {/* Signing in again, on a second device. */}
            {stage === "resume" && (() => {
              const held = seatHeldBy(boardUnits, foundAccount && foundAccount.id);
              if (!held) return null;
              const meta = shiftMeta(held.member.shift);
              return (
                <>
                  <div style={styles.loginSub}>
                    Welcome back, {foundAccount.name || foundAccount.id}.
                  </div>
                  <div style={styles.resumeCard}>
                    <div style={styles.resumeWhat}>You are already signed on</div>
                    <div style={styles.resumeWho}>
                      {held.unit.name} · {seatLabel(held.slot)}
                    </div>
                    <div style={styles.resumeMeta}>
                      {meta ? `${meta.label} · ` : ""}
                      {held.member.signedOnAt
                        ? `on since ${clockStr(held.member.signedOnAt)}`
                        : "shift in progress"}
                    </div>
                  </div>
                  <button style={styles.loginSubmit} onClick={resumeSeat}>
                    Continue as {held.unit.name}
                  </button>
                  <div style={styles.formHint}>
                    Nothing is changed by this — your seat, your shift and your hours carry on
                    exactly as they are. Use it whenever you sign in on a second device.
                  </div>
                  <div style={styles.loginActions}>
                    <button style={styles.ghostBtn} onClick={resetAccountFlow}>
                      Not me
                    </button>
                    <button
                      style={styles.ghostBtn}
                      onClick={() => {
                        setPendingRole("team");
                        setStage(canJoinTeam(foundAccount.role) ? "roleChoice" : "chooseShift");
                      }}
                    >
                      Sign on somewhere else
                    </button>
                  </div>
                </>
              );
            })()}

            {stage === "chooseSeat" && (
              <>
                <div style={styles.loginSub}>
                  {seatUnit ? seatUnit.name : "Your team"} — choose your seat
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
                  {["alpha", "bravo"].map((seat) => {
                    const holder = seatUnit ? seatUnit[seat] : null;
                    const holderMeta = holder ? shiftMeta(holder.shift) : null;
                    const holderOt = holder ? overtimeMs(holder, Date.now()) : 0;
                    const waitingHere = seatUnit ? handoverRequest(seatUnit, seat) : null;
                    const waitingIsMe = !!waitingHere && waitingHere.accountId === foundAccount.id;
                    const holderGone = !!holder && seatShiftIsOver(holder, Date.now());
                    const liveCall = holder && seatUnit ? liveRequestFor(seatUnit, seatRequests) : null;
                    const truckStatus = seatUnit ? effectiveStatusMeta(seatUnit, seatRequests) : null;
                    return (
                      <button
                        key={seat}
                        style={styles.roleBtn}
                        disabled={busy}
                        onClick={() =>
                          holder && holder.accountId === foundAccount.id
                            ? resumeSeat()
                            : holder && waitingIsMe
                            ? resumeWaiting(seat)
                            : holder
                            ? takeOverSeat(seat, holder)
                            : finishTeamLogin(foundAccount, seat)
                        }
                      >
                        <div style={{ textAlign: "left" }}>
                          <div style={styles.roleBtnTitle}>{seatLabel(seat)}</div>
                          {holder && holder.accountId !== foundAccount.id && (
                            <div
                              style={{
                                fontSize: 12, fontWeight: 800, letterSpacing: 0.4, marginBottom: 3,
                                color: liveCall ? (truckStatus && truckStatus.color) || "var(--crit)" : "var(--ok)",
                              }}
                            >
                              {liveCall
                                ? `● ON A CALL${truckStatus ? ` — ${truckStatus.label}` : ""} · ${liveCall.nature || "call"}${callRoute(liveCall) ? ` · ${callRoute(liveCall)}` : ""}`
                                : "○ NOT ON A CALL"}
                            </div>
                          )}
                          <div style={styles.roleBtnSub}>
                            {!holder
                              ? "Available"
                              : holder.accountId === foundAccount.id
                              ? "This is you — continue"
                              : waitingIsMe
                              ? `Held by ${holder.name} — you are waiting for their answer · continue waiting`
                              : `Held by ${holder.name}` +
                                (holderMeta ? ` · ${holderMeta.short}` : "") +
                                (holderOt > 0 ? ` · ${shortDurationStr(holderOt)} overtime` : "") +
                                (waitingHere && !waitingIsMe ? ` · ${waitingHere.name} is waiting` : "") +
                                (liveCall
                                  ? " — queue: the seat is yours when they clear"
                                  : holderGone
                                  ? " — shift ended, take over"
                                  : " — ask to take over")}
                          </div>
                        </div>
                        <ChevronRight size={18} color="var(--ink-3)" />
                      </button>
                    );
                  })}
                </div>
                <InfoNote label="More about this">
                  A seat somebody is working is theirs until they hand it over: asking sends the request to
                  their phone, and you are signed on and waiting until they approve — or the dispatcher hands
                  it over if they cannot answer. A seat whose shift has ended and whose truck is not out is
                  taken over directly, and a crew still out on a call is queued for.
                </InfoNote>

                {/* Both crew on one tablet.
                    A two-person crew has one device between them more often than
                    not, and the second seat was being left empty — which put one
                    name against a call two people ran, and left the partner's
                    hours off the sheet. Entering their ID here signs them into
                    the other seat at the same time. It is their own ID, so the
                    name on the seat is still theirs and not a note typed by
                    somebody else. */}
                <div style={styles.partnerBox}>
                  <div style={styles.partnerHead}>
                    <Users size={12} style={{ verticalAlign: -1, marginRight: 5 }} />
                    SIGNING IN YOUR PARTNER TOO?
                  </div>
                  <InfoNote>
                    If you are both working off this one tablet, put their ID in and they will be
                    signed into the other seat with you. Leave it blank if they have their own device.
                  </InfoNote>
                  <input
                    style={{ ...styles.input, marginTop: 8 }}
                    value={partnerId}
                    onChange={(e) => {
                      setPartnerId(e.target.value);
                      setPartnerError("");
                    }}
                    placeholder="Partner's ID, e.g. F1122334"
                  />
                  {/* Their own password, typed by them.
                      Signing somebody onto a truck puts their name against every
                      call it runs and every hour it works. That has to be their
                      own act, not something a colleague can do for them from
                      memory of their ID — so the partner takes the tablet and
                      enters their password, exactly as they would on their own
                      device. */}
                  {partnerAccount && (
                    <input
                      style={{ ...styles.input, marginTop: 8 }}
                      type="password"
                      value={partnerPw}
                      onChange={(e) => {
                        setPartnerPw(e.target.value);
                        setPartnerError("");
                      }}
                      placeholder={`${partnerName}'s password — hand them the tablet`}
                    />
                  )}
                  {partnerError && <div style={styles.loginError}>{partnerError}</div>}
                  {partnerAccount && !partnerAccount.hasPassword && (
                    <div style={styles.formHint}>
                      {partnerName} has not set a password yet. They need to sign in once on any
                      device first.
                    </div>
                  )}
                  {partnerOk && (
                    <div style={styles.partnerFound}>
                      <CheckCircle2 size={12} style={{ verticalAlign: -1, marginRight: 5 }} />
                      {partnerName} will be signed into the other seat.
                    </div>
                  )}
                </div>

                <div style={styles.loginActions}>
                  <button style={styles.ghostBtn} onClick={() => setStage("chooseTeam")}>Back</button>
                </div>
              </>
            )}
        </div>

      </div>

      {/* At the foot of the page, under the card — not inside it.
          Sitting between the wordmark and the ID field, this was the first
          thing read on the way in, which is the wrong order: a crew signing on
          at handover wants the field. It is still on the one screen everybody
          sees, and it still carries the two links Google Play requires to be
          reachable without an account. */}
      <div style={styles.loginFoot}>
        <div style={styles.loginFootWhat}>
          {APP_NAME} — the ambulance board for Emergency Medical Services.
          Sign in with the ID your administrator gave you.
        </div>
        <div style={styles.legalNote}>
          This app is not a medical device. It does not diagnose, treat, cure or prevent
          any medical condition, and gives no clinical advice.
          {/* Through API_BASE, not as bare paths: inside the native shell a
              bare "/privacy" resolves against the app bundle, which has no such
              page, and both links dead-end — precisely the check Google runs. */}
          <div style={styles.legalLinks}>
            <a href={`${API_BASE}/privacy`} target="_blank" rel="noreferrer" style={styles.legalLink}>Privacy policy</a>
            <span aria-hidden="true">·</span>
            <a href={`${API_BASE}/data-deletion`} target="_blank" rel="noreferrer" style={styles.legalLink}>Account &amp; data deletion</a>
          </div>
        </div>
      </div>
    </div>
  );
}