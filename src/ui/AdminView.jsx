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
        {title}
        <span style={styles.foldCount}>
          {count} {countLabel}
        </span>
      </button>
      {open && <div style={styles.foldBody}>{children}</div>}
    </div>
  );
}