import { ChevronRight } from "../lib/icons.jsx";
import { createContext, useContext } from "../lib/react.jsx";
import { styles } from "../styles.jsx";

// True inside an opened launcher tile. Somebody who chose a section from the
// tiles has already said "show me this" — a second, collapsed drawer inside
// the screen they chose is a door behind a door. Under this flag a
// FoldingSection renders as a plain title banner with its body open; the five
// account drawers opt out (SectionScreen flat={false}) because there they ARE
// the content, five siblings, not the chosen section repeated.
export const FlatSections = createContext(false);

// ---------- admin view ----------

export const ROLE_LABELS = { crew: "team member", dispatcher: "dispatcher", admin: "admin" };

// ---------- the section launcher ----------
//
// The admin pages used to stack every section one under the other — the
// statistics page was the KPIs and then five departments of the job in a
// column, and Teams opened on a wall of account drawers. The launcher draws
// one tile per section, the way a person actually asks for one — "the
// overtime", "the backups" — and opening a tile shows that section alone with
// the way back at the top. Tiles wear the card contract like everything else;
// the icon is the working blue, never red — red is a critical call and NO
// COVERAGE, not "our archive". A tile that needs somebody now (a password
// reset waiting) says so in amber on its own line.
export function SectionTile({ title, icon, note, tone, onClick }) {
  return (
    <button style={styles.sectionTile} onClick={onClick}>
      <span style={styles.sectionTileTitle}>{title}</span>
      <span style={styles.sectionTileIcon}>{icon}</span>
      {note ? (
        <span style={{ ...styles.sectionTileNote, ...(tone ? { color: tone, fontWeight: 700 } : null) }}>
          {note}
        </span>
      ) : null}
    </button>
  );
}

// `tiles` may hold falsy entries so callers can gate each tile on `canArea`
// inline — a delegate sees only the tiles of the areas they hold.
export function SectionHub({ tiles, onOpen }) {
  return (
    <div style={styles.sectionTileGrid}>
      {(tiles || []).filter(Boolean).map((t) => (
        <SectionTile key={t.key} title={t.title} icon={t.icon} note={t.note} tone={t.tone} onClick={() => onOpen(t.key)} />
      ))}
    </div>
  );
}

// One open section, alone, with the way back where the tiles were. `flat`
// (the default) turns the section's own drawer into a plain title with its
// body open — the tile was the press; pass flat={false} where the screen
// holds several sibling drawers that are the content themselves.
export function SectionScreen({ onBack, flat, children }) {
  return (
    <div>
      <button style={styles.sectionBackRow} onClick={onBack}>
        <ChevronRight size={13} style={{ transform: "rotate(180deg)", marginRight: 6 }} />
        ALL SECTIONS
      </button>
      <FlatSections.Provider value={flat !== false}>{children}</FlatSections.Provider>
    </div>
  );
}

// The kept days, newest first. This is where a supervisor goes back to a night
// three weeks ago — the calls, the crews, both stations, in one workbook.
// Account admin is set up once and then rarely touched, but it sat open above
// everything an administrator actually watches. These fold away and say how many
// are on file, so the screen opens on the board rather than on three forms.
// `always` is the part of a section that stays on screen when it is folded.
//
// A fold is the right shape for a shelf of history and the wrong shape for the
// one row somebody actually came for. The operational-day panel is both: a
// growing list of days that have been kept, and above it the day running now
// with the button that exports it. Folding hid the second to tidy away the
// first; not folding put a year of kept days on the page. What stays out is
// what is still happening.
export function FoldingSection({ title, count, countLabel, open, onToggle, always, children }) {
  // Inside an opened tile the fold flattens: title banner, body open, nothing
  // to press. See `FlatSections` above.
  const flat = useContext(FlatSections);
  if (flat) {
    return (
      <div style={{ marginTop: 14 }}>
        <SectionBanner title={title} count={count} countLabel={countLabel} />
        <div style={styles.foldBody}>
          {always}
          {children}
        </div>
      </div>
    );
  }
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
      {(always || open) && (
        <div style={styles.foldBody}>
          {always}
          {open && children}
        </div>
      )}
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