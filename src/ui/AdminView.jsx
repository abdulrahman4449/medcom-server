import { ChevronRight } from "../lib/icons.jsx";
import { styles } from "../styles.jsx";

// ---------- admin view ----------

export const ROLE_LABELS = { crew: "team member", dispatcher: "dispatcher", admin: "admin" };

// The kept days, newest first. This is where a supervisor goes back to a night
// three weeks ago — the calls, the crews, both stations, in one workbook.
// Account admin is set up once and then rarely touched, but it sat open above
// everything an administrator actually watches. These fold away and say how many
// are on file, so the screen opens on the board rather than on three forms.
export function FoldingSection({ title, count, countLabel, open, onToggle, children }) {
  return (
    <div style={{ marginTop: 14 }}>
      <button style={styles.foldHeader} onClick={onToggle}>
        <ChevronRight
          size={13}
          style={{
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform .15s ease",
            marginRight: 8,
          }}
        />
        <span style={styles.bannerTitle}>{title}</span>
        <span style={styles.foldCount}>
          {count} {countLabel}
        </span>
      </button>
      {open && <div style={styles.foldBody}>{children}</div>}
    </div>
  );
}

// ---------- one banner, on every page ----------
//
// A section heading was one of three things depending on which screen you were
// on: a 20px display heading in capitals on the crew and dispatch screens, a
// bordered strip on everything an administrator opens, and a 10.5px grey line
// inside half a dozen panels. Three vocabularies for one job, and on the
// schedule the first two sat one above the other — a shouting heading that wrapped
// across its own button, above a quiet strip saying the same kind of thing.
//
// This is the one treatment. It is the fold header's, because that is what most
// of the app was already using and what the card contract in design/README.md
// wants: a raised strip, a hair border, the title in the app's small-caps
// voice, and whatever the section counts on the right.
//
// Deliberately quiet. `design/README.md` is explicit that NO COVERAGE is the
// only thing on this board allowed to shout, and a heading that competes with a
// call card is a heading that has taken something from it.
export function SectionBanner({ title, count, countLabel, icon, action, children }) {
  return (
    <div style={styles.banner}>
      {icon ? <span style={styles.bannerIcon}>{icon}</span> : null}
      <span style={styles.bannerTitle}>{title}</span>
      {count !== undefined && count !== null && (
        <span style={styles.foldCount}>
          {count}
          {countLabel ? ` ${countLabel}` : ""}
        </span>
      )}
      {/* An action belonging to the section sits inside its banner rather than
          floating beside it. Outside, it pushed the title into a second line
          and then collided with it. */}
      {action ? <span style={styles.bannerAction}>{action}</span> : null}
      {children}
    </div>
  );
}