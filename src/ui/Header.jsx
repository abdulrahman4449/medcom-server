import { BrandMark, DEPT_LOGO, HOSPITAL_LOGO, ORG_NAME, SHOW_LOGOS, Wordmark } from "../brand/artwork.jsx";
import { msDurationStr, otHoursStr, shortDurationStr } from "../domain/messages.jsx";
import { hhmm, overtimeMs, shiftMeta, shiftRemainingMs, shiftWindowStr } from "../domain/shift-helpers.jsx";
import { SHIFTS, SHIFT_KEYS } from "../domain/shifts.jsx";
import { areaLabel, areaSentence, isDelegatedAdmin } from "../domain/delegation.jsx";
import { changeOwnPassword } from "../lib/auth.jsx";
import { soundCallAlert } from "../lib/dates.jsx";
import { Clock, LogOut, Volume2, VolumeX } from "../lib/icons.jsx";
import { useState } from "../lib/react.jsx";
import { SOUND_LEVELS, setSoundLevel, soundLevelMeta, useSoundLevel } from "../lib/sound.jsx";
import { styles } from "../styles.jsx";
import { InfoNote } from "./AssistanceTasks.jsx";
import { SystemChip } from "./SystemChip.jsx";

// ---------- header ----------

export function Header({ user, clock, onLogout, onChangeShift, onSwitchRole, theme, onToggleTheme, audioCtxRef }) {
  return (
    <div style={styles.headerWrap}>
      {/* Two bodies own this service, so their crests take the two ends of the
          bar with the service's own name centred between them, rather than both
          being crowded into one corner. The bar is the full width of the board:
          it reads as the masthead of the room, visible from across it. */}
      <div style={SHOW_LOGOS ? styles.brandBar : styles.brandBarPlain} className="brand-bar">
        {/* Three grid columns only make sense while there is something in the
            outer two. With the crests off, one centred row puts the name in the
            middle of the bar instead of leaving it stranded in column one. */}
        {SHOW_LOGOS && (
          <img
            src={HOSPITAL_LOGO}
            alt={ORG_NAME || "Hospital crest"}
            style={styles.brandLogoWide}
            className="brand-logo-wide"
          />
        )}
        <div style={styles.brandTitleWrap}>
          <BrandMark size={22} />
          <Wordmark size={17} />
        </div>
        {SHOW_LOGOS && (
          <img
            src={DEPT_LOGO}
            alt={ORG_NAME ? `${ORG_NAME} Ambulance EMS` : "Ambulance EMS crest"}
            style={styles.brandLogoBadge}
            className="brand-logo-badge"
          />
        )}
      </div>
      {/* Everything that changes minute to minute sits on its own line under
          the masthead, so the shift countdown and clock stay where the eye
          already expects them without competing with the crests. */}
      <div style={styles.headerBar}>
        <div style={styles.headerBarGroup}>
          <ShiftChip user={user} onChangeShift={onChangeShift} />
          <div style={styles.clock}>
            <Clock size={14} color="var(--ink-3)" />
            <span>{clock}</span>
          </div>
          {/* Beside the clock, because that is where somebody looks when they
              are adjusting to the room rather than working. */}
          <button
            style={styles.themeBtn}
            onClick={() => onToggleTheme && onToggleTheme()}
            title={theme === "dark" ? "Switch to light" : "Switch to dark"}
          >
            {theme === "dark" ? "☀︎" : "☾"}
          </button>
        </div>
        <div style={styles.headerBarGroup}>
          <AccountChip user={user} />
          {/* Beside the name, because that is whose device it is. Quiet unless
              this phone has something wrong with it — the whole diagnostic
              line used to sit permanently on the crew screen, which taught
              everybody to read past the one shift it said something. */}
          <SystemChip audioCtxRef={audioCtxRef} />
          <RoleSwitch user={user} onSwitchRole={onSwitchRole} />
          <button style={styles.iconBtn} onClick={onLogout} title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

// The name in the masthead is also the way to your own account: tapping it
// opens the one thing everybody owns about themselves — the password.
//
// Changing it asks for the current password first, because the token alone
// must not be enough on a tablet left unlocked at the station; the server
// holds the same line. Nothing signs out afterwards — this device and any
// other holding the account carry on, which is right: changing a password is
// not a sign-out. The inputs are 16px like every field in the app, or iOS
// zooms the whole board on focus and leaves it there.
export function AccountChip({ user }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [fresh, setFresh] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // { ok, text }

  function close() {
    setOpen(false);
    setCurrent("");
    setFresh("");
    setAgain("");
    setNote(null);
  }

  async function submit() {
    if (!current) return setNote({ ok: false, text: "Type your current password first." });
    if (!fresh || fresh.length < 4) {
      return setNote({ ok: false, text: "Choose a new password of at least four characters." });
    }
    if (fresh !== again) return setNote({ ok: false, text: "The two copies of the new password do not match." });
    setBusy(true);
    setNote(null);
    try {
      await changeOwnPassword(current, fresh);
      setCurrent("");
      setFresh("");
      setAgain("");
      setNote({ ok: true, text: "Password changed. You stay signed in — use the new one from your next sign-in." });
    } catch (e) {
      // The server's own sentence: a wrong current password, the sign-in
      // limiter, or a lost signal all need different words and it says which.
      setNote({ ok: false, text: (e && e.message) || "That could not be saved. Try again." });
    } finally {
      setBusy(false);
    }
  }

  const pwInput = (value, set, placeholder) => (
    <input
      type="password"
      autoComplete="off"
      style={{ ...styles.input, marginTop: 6 }}
      value={value}
      placeholder={placeholder}
      onChange={(e) => set(e.target.value)}
      disabled={busy}
    />
  );

  return (
    <div style={styles.shiftChipWrap}>
      <button
        style={{
          ...styles.userBadge,
          // A button wearing a badge's clothes: the browser's own button
          // chrome would put a grey box around the name.
          background: "transparent", border: "none", padding: 0,
          font: "inherit", cursor: "pointer", alignItems: "flex-end",
        }}
        onClick={() => (open ? close() : setOpen(true))}
        title="Your account — change your password"
      >
        <span style={{ color: "var(--ink-3)" }}>{user.role === "dispatcher" ? "DISPATCH" : user.role === "admin" ? "ADMIN" : "CREW"}</span>
        <span style={{ color: "var(--ink)", fontWeight: 600 }}>{user.name}</span>
        {/* What they have been lent, next to who they are.
            Authority borrowed and authority held look identical on screen
            otherwise, and the person working it is the one most entitled
            to know which they are using — and which areas. */}
        <DelegatedTag user={user} />
      </button>

      {open && (
        <div style={styles.shiftMenu}>
          <div style={styles.shiftMenuHead}>
            CHANGE YOUR PASSWORD · {user.accountId || user.name}
          </div>
          {pwInput(current, setCurrent, "Current password")}
          {pwInput(fresh, setFresh, "New password (4+ characters)")}
          {pwInput(again, setAgain, "New password again")}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button style={styles.primaryBtnSm} disabled={busy} onClick={submit}>
              {busy ? "…" : "Change password"}
            </button>
            <button style={styles.ghostBtnSm} disabled={busy} onClick={close}>
              Close
            </button>
          </div>
          {note && (
            <div style={{ ...styles.formHint, marginTop: 8, color: note.ok ? "var(--ok)" : "var(--hold-2)" }}>
              {note.text}
            </div>
          )}
          {!note && (
            <div style={styles.shiftMenuHint}>
              Your current password is asked for on purpose — a screen someone
              left open must not be enough to re-key the account. Forgotten it
              entirely? Sign out and use “Forgot password” instead.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Moving between the seat somebody signed in on and the area they have been
// lent, without signing out of either.
//
// Lending an area used to mean signing out and back in to use it, which on a
// desk is not a small thing: it ends the dispatch session, writes a sign-off
// and a sign-on into the shift log, and leaves the board briefly showing
// nobody at the desk - all so one person could look at the overtime they were
// asked to look at. It is the same person doing another task, so it is one
// session, and nothing is written.
//
// Only shown to somebody who actually holds both: the server decides that and
// sends it as `roles`, re-derived from the account on every request, so a
// delegation taken back disappears from here on the next poll.
export function DelegatedTag({ user }) {
  const held = user && Array.isArray(user.delegatedScopes) ? user.delegatedScopes : null;
  const lent = held || (user && user.delegation && Array.isArray(user.delegation.scopes)
    ? user.delegation.scopes : null);
  if (!lent || !lent.length) return null;
  const on = isDelegatedAdmin(user);
  return (
    <span
      style={on ? styles.headerLentTagOn : styles.headerLentTag}
      title={`${on ? "Working on" : "Lent to you"}: ${areaSentence(lent)}`}
    >
      {on ? "ON LOAN · " : "LENT · "}
      {lent.map(areaLabel).join(", ")}
    </span>
  );
}

// The account and the session speak two vocabularies for the same seat: the
// server calls a crew member's role "crew", and a session working a truck is
// role "team". Compared raw, every plain crew member appeared to hold a second
// role — their own, under its other name — and was offered "My truck" as a
// switch into role "crew", which nothing in the app draws: an empty screen
// with nothing to press, on every crew phone. Translate before comparing, and
// only ever hand the app its own word back. "My truck" is the way BACK for a
// crew member working a lent area, so it also needs a seat to go back to —
// a delegate who signed straight into the lent area never took one.
// A SEAT IS A ROLE. `roles` comes from the account — the person's own role plus
// anything lent to them — and for an administrator or a dispatcher that list
// never contains "crew". So somebody whose account says `admin`, who joined a
// team for the shift, was offered "Administration" and then, from there,
// nothing: the way back to their own truck did not exist and the only route
// was to sign out and sign in again. Reported on the owner's account; it hit
// every dispatcher who took a truck as well.
//
// The seat is the proof. If this session is holding one, working the truck is
// a role they hold, whatever the account list says — so it is offered
// alongside the list rather than looked for inside it.
export function heldRoles(user) {
  const asSession = (r) => (r === "crew" ? "team" : r);
  const listed = Array.isArray(user && user.roles) ? user.roles.map(asSession) : [];
  const held = listed.filter((r) => r && (r !== "team" || (user && user.unitId)));
  if (user && user.unitId && !held.includes("team")) held.push("team");
  return held;
}

export function roleSwitchTarget(user) {
  return heldRoles(user).find((r) => r !== (user && user.role)) || null;
}

export function RoleSwitch({ user, onSwitchRole }) {
  const other = roleSwitchTarget(user);
  if (!other || !onSwitchRole) return null;
  const label = other === "admin" ? "Administration" : other === "dispatcher" ? "Dispatch desk" : "My truck";
  return (
    <button
      style={styles.roleSwitchBtn}
      onClick={() => onSwitchRole(other)}
      title={`Work on ${label} — you stay signed in, and the desk is not stood down`}
    >
      {label}
    </button>
  );
}

// The volume control for this device, in the masthead where it is reachable
// from every screen without going looking for a settings page: on a crew tablet
// that has started alerting, "where do I turn this down" has to be answerable in
// one tap.
//
// It stays visibly loud about being quiet. Muted, the chip itself goes amber and
// says MUTED rather than shrinking into the bar, because the failure this
// setting can cause — a crew who silenced the board on a quiet afternoon and
// forgot — is worse than the noise it fixes.
export function SoundChip() {
  const [open, setOpen] = useState(false);
  const level = useSoundLevel();
  const meta = soundLevelMeta(level);
  const muted = meta.gain <= 0;

  return (
    <div style={styles.shiftChipWrap}>
      <button
        style={{
          ...styles.soundChip,
          borderColor: muted ? "var(--hold)" : "var(--hair-2)",
          color: muted ? "var(--hold-2)" : "var(--ink)",
        }}
        onClick={() => setOpen((s) => !s)}
        title={
          muted
            ? "Alert tones are silenced on this device — tap to turn them back on"
            : `Alert tone volume: ${meta.label} — tap to change`
        }
      >
        {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
        <span style={{ fontWeight: 700 }}>{meta.short}</span>
      </button>

      {open && (
        <div style={styles.shiftMenu}>
          <div style={styles.shiftMenuHead}>
            ALERT TONE VOLUME — THIS DEVICE ONLY
          </div>
          {SOUND_LEVELS.map((l) => {
            const on = l.key === level;
            return (
              <button
                key={l.key}
                style={on ? styles.soundMenuBtnOn : styles.shiftMenuBtn}
                onClick={() => {
                  setSoundLevel(l.key);
                  // Play the new level back straight away, so "medium" is a
                  // loudness that has been heard rather than a word. Silent has
                  // nothing to play, and says so instead.
                  if (l.gain > 0) soundCallAlert(soundChipCtxRef, "routine");
                }}
              >
                {on ? "● " : "○ "}
                {l.label} — {l.note}
              </button>
            );
          })}
          <div style={styles.shiftMenuHint}>
            {muted
              ? "This device is silent. Calls still arrive — the full-screen alarm, the vibration and the call notification all still come through — but nothing will make a sound until you turn the tone back on."
              : "Your phone or tablet's own silent switch does not reach this board, so this is the only thing that quietens it. The setting is remembered on this device and does not affect anyone else's screen."}
          </div>
        </div>
      )}
    </div>
  );
}

// The chip's own audio context, so previewing a volume doesn't depend on being
// handed the one the app threads through the views.
export const soundChipCtxRef = { current: null };

// Live readout of the shift this session signed on for: how much of the 12
// hours is left and, once that runs out, how deep into overtime it is. Opening
// it swaps the shift on the record without signing out — what a crew carrying
// a call past 19:00 (or 07:00) does when they take the next shift as well.
// Admins aren't on either shift, so they don't get a chip.
export function ShiftChip({ user, onChangeShift }) {
  const [open, setOpen] = useState(false);
  const meta = shiftMeta(user.shift);
  if (!meta) return null;

  // The whole app re-renders every second off the header clock, so reading the
  // time here is enough to keep this counting down live.
  const now = Date.now();
  const ot = overtimeMs(user, now);
  const left = shiftRemainingMs(user, now);
  const starts = user.shiftStart && now < user.shiftStart;

  return (
    <div style={styles.shiftChipWrap}>
      <button
        style={{
          ...styles.shiftChip,
          borderColor: ot > 0 ? "var(--crit)" : meta.color,
          color: ot > 0 ? "#FCA5A5" : "var(--ink)",
        }}
        onClick={() => setOpen((s) => !s)}
        title={`${meta.label} ${shiftWindowStr(user)} — tap to swap shift`}
      >
        <span style={{ color: meta.color }}>{meta.glyph}</span>
        <span style={{ fontWeight: 700 }}>{meta.short}</span>
        <span style={styles.shiftChipTime}>
          {ot > 0
            ? `OT ${otHoursStr(ot)}`
            : starts
            ? `starts ${hhmm(user.shiftStart)}`
            : `${msDurationStr(left)} left`}
        </span>
      </button>

      {open && (
        <div style={styles.shiftMenu}>
          <div style={styles.shiftMenuHead}>
            On {meta.label} · {shiftWindowStr(user)}
            {ot > 0 ? ` · ${shortDurationStr(ot)} overtime` : ""}
          </div>
          {SHIFT_KEYS.filter((k) => k !== user.shift).map((k) => (
            <button
              key={k}
              style={styles.shiftMenuBtn}
              onClick={() => {
                setOpen(false);
                onChangeShift(k);
              }}
            >
              Swap to {SHIFTS[k].label} ({SHIFTS[k].window})
            </button>
          ))}
          <InfoNote>
            Swapping re-bases your 12 hours on the new shift and records the swap — with any overtime
            carried over — on the log sheet.
          </InfoNote>
        </div>
      )}
    </div>
  );
}