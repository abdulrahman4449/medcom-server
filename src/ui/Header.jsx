import { BrandMark, DEPT_LOGO, HOSPITAL_LOGO, ORG_NAME, SHOW_LOGOS, Wordmark } from "../brand/artwork.jsx";
import { msDurationStr, otHoursStr, shortDurationStr } from "../domain/messages.jsx";
import { hhmm, overtimeMs, shiftMeta, shiftRemainingMs, shiftWindowStr } from "../domain/shift-helpers.jsx";
import { SHIFTS, SHIFT_KEYS } from "../domain/shifts.jsx";
import { soundCallAlert } from "../lib/dates.jsx";
import { Clock, LogOut, Volume2, VolumeX } from "../lib/icons.jsx";
import { useState } from "../lib/react.jsx";
import { SOUND_LEVELS, setSoundLevel, soundLevelMeta, useSoundLevel } from "../lib/sound.jsx";
import { styles } from "../styles.jsx";
import { InfoNote } from "./AssistanceTasks.jsx";

// ---------- header ----------

export function Header({ user, clock, onLogout, onChangeShift, onSwitchRole, theme, onToggleTheme }) {
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
          <div style={styles.userBadge}>
            <span style={{ color: "var(--ink-3)" }}>{user.role === "dispatcher" ? "DISPATCH" : user.role === "admin" ? "ADMIN" : "CREW"}</span>
            <span style={{ color: "var(--ink)", fontWeight: 600 }}>{user.name}</span>
          </div>
          <RoleSwitch user={user} onSwitchRole={onSwitchRole} />
          <button style={styles.iconBtn} onClick={onLogout} title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </div>
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
export function RoleSwitch({ user, onSwitchRole }) {
  const roles = Array.isArray(user && user.roles) ? user.roles : [];
  const other = roles.find((r) => r && r !== user.role);
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