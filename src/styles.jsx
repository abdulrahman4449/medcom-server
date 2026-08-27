import { NO_TRANSPORT } from "./domain/outcomes.jsx";
import { App } from "./ui/App.jsx";

// ---------- styles ----------

// The fonts used to be fetched from Google on every load. In an ambulance that
// is the worst possible place to put a network dependency: underground, or on a
// bad signal, both fonts fail and the whole board reflows into fallbacks at the
// exact moment a crew is working a call — and it made an app we had just taught
// to work offline depend on the internet to look right.
//
// These are the fonts already on the device. On an iPhone that is SF Mono and
// San Francisco, on Android Roboto Mono and Roboto: designed for small screens,
// rendered natively, and there whether there is signal or not.
export const mono = "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, 'Roboto Mono', monospace";
// Chosen for reading, not for character.
//
// The system stack resolves to San Francisco on iOS and Roboto on Android, both
// drawn for screens at small sizes with open counters and unambiguous figures —
// which is what matters on a board read at arm's length in a moving vehicle.
// Nothing is downloaded, so nothing is missing when there is no signal.
export const display =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', " +
  "Roboto, 'Helvetica Neue', Arial, system-ui, sans-serif";

export const styles = {
  app: {
    minHeight: "100vh",
    // One light source, top right, so the masthead reads as the lit edge and
    // everything below it sits in its shadow. A flat ground is what makes a
    // screen look printed rather than lit.
    // Flat. The lit corner read as depth on black and as a dirty smudge on
    // white — and it sat directly under the status board, which is the one
    // place on the screen that has to be legible at a glance. Depth now comes
    // from the panels sitting on the ground, which works in both themes.
    background: "var(--ground)",
    color: "var(--ink)",
    fontFamily: display,
    display: "flex",
    flexDirection: "column",
  },
  loadingMark: {
    display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
  },
  loadingScreen: {
    minHeight: "100vh",
    background: "var(--ground)",
    color: "var(--ink-3)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: display,
    fontSize: 15,
    letterSpacing: 1,
  },
  loadingText: { animation: "pulse-dot 1.4s ease-in-out infinite" },
  connectErrorBox: {
    maxWidth: 340,
    textAlign: "left",
    padding: 24,
    background: "var(--raised)",
    border: "1px solid var(--hair)",
    borderRadius: 12,
  },
  connectErrorTitle: { fontFamily: display, fontWeight: 700, fontSize: 17, color: "var(--ink-alt)", marginBottom: 8 },
  connectErrorBody: { fontSize: 14.5, color: "var(--ink-3)", lineHeight: 1.5, marginBottom: 10 },
  connectErrorList: { fontSize: 14, color: "var(--ink-2)", lineHeight: 1.7, paddingLeft: 18, margin: "0 0 16px" },
  connectRetryBtn: {
    background: "var(--flow)",
    border: "none",
    color: "var(--ground)",
    fontWeight: 700,
    borderRadius: 8,
    padding: "9px 16px",
    cursor: "pointer",
    fontFamily: display,
    fontSize: 15,
  },
  // The masthead stays on screen. A dispatch board is scrolled all day — down
  // the call list, down the log sheet — and the two crests are what identifies
  // whose room this is to anyone walking past it, so they are pinned to the top
  // of the window rather than scrolling away with the first call. The clock and
  // the shift countdown ride up with them, which is where the eye already
  // looks for them.
  // The masthead follows the organisation's own app: a deep green field with a
  // curved lower edge, the name and the person on it, and the crests kept where
  // they have always been. Green because it is the hospital's colour and staff
  // already read it as "one of ours"; curved because that shape is the single
  // most recognisable thing about the app they use every day.
  headerWrap: {
    position: "sticky",
    top: 0,
    zIndex: 30,
    // The lit edge of the screen. A highlight in the top corner gives the
    // gradient somewhere to come from, so it reads as a surface catching light
    // rather than as a coloured rectangle.
    // Translucent, blurred, flat to the edge. The curved green slab was the
    // loudest thing on every screen and said nothing that changes; the board
    // underneath is now visible through the bar as it scrolls.
    background: "var(--bar)",
    backdropFilter: "saturate(180%) blur(24px)",
    WebkitBackdropFilter: "saturate(180%) blur(24px)",
    borderBottom: "0.5px solid var(--veil)",
    paddingTop: "env(safe-area-inset-top)",
    marginBottom: 0,
  },
  // The masthead: a white plate the full width of the board, a crest hard
  // against each end and the service name held in the middle of it. Three grid
  // columns rather than a flex row, because the two crests are different widths
  // and only equal side columns put the name in the true centre of the bar.
  brandBar: {
    // The crests keep their white plate — they are printed artwork and need it —
    // but it now floats as a rounded card on the green rather than spanning the
    // full width as a separate band.
    // The crests are printed artwork and need a light plate to read against, but
    // a hard white slab on a green field looks pasted on. A soft, slightly
    // translucent panel with a warm edge sits in the masthead rather than on it.
    background: "transparent",
    border: "none",
    borderRadius: 0,
    margin: "10px 16px 0",
    padding: 0,
    boxShadow: "none",
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "center",
    gap: 16,
  },
  // The same bar with the crests switched off: one centred row rather than the
  // three-column grid, which needs side content to centre anything.
  brandBarPlain: {
    background: "transparent",
    border: "none",
    margin: "10px 16px 0",
    padding: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  brandTitleWrap: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    minWidth: 0,
  },
  // Read from across a control room, so the crests are sized to be recognised
  // at that distance rather than to sit politely in a corner.
  // Sized to identify, not to announce. At 74 and 84 pixels the crests were the
  // largest thing on a phone screen and pushed the board below the fold; the
  // department knows whose app this is.
  // Big enough to be read, small enough not to be the headline. 74 and 84 was a
  // banner; 26 was a footnote.
  brandLogoWide: {
    height: 58, width: "auto", display: "block", justifySelf: "start",
    background: "var(--logo-plate)", padding: "var(--logo-pad)",
    borderRadius: "var(--logo-radius)",
  },
  brandLogoBadge: {
    height: 62, width: "auto", display: "block", justifySelf: "end",
    background: "var(--logo-plate)", padding: "var(--logo-pad)",
    borderRadius: "var(--logo-radius)",
  },
  headerBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "2px 16px 12px",
    flexWrap: "wrap",
    gap: 10,
  },
  headerBarGroup: { display: "flex", alignItems: "center", gap: 18 },
  themeBtn: {
    background: "none", border: "0.5px solid var(--hair-2)", color: "var(--ink-3)",
    borderRadius: 999, width: 32, height: 32, cursor: "pointer",
    fontSize: 14, lineHeight: 1, display: "inline-flex",
    alignItems: "center", justifyContent: "center",
  },

  clock: { display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: "var(--ink-2)" },
  userBadge: { display: "flex", flexDirection: "column", fontSize: 13, lineHeight: 1.3, textAlign: "right" },
  iconBtn: {
    background: "transparent",
    border: "1px solid var(--hair-2)",
    color: "var(--ink-3)",
    borderRadius: 8,
    padding: 7,
    cursor: "pointer",
    display: "flex",
  },
  body: { display: "flex", flex: 1, gap: 16, padding: 16, maxWidth: 1200, margin: "0 auto", width: "100%", flexWrap: "wrap" },
  mainCol: { flex: "2 1 480px", minWidth: 0 },
  sideCol: { flex: "1 1 300px", minWidth: 280 },

  // The organisation's app carries a floating pill at the bottom rather than a
  // bar welded to the edge of the screen. Same idea here: it lifts off the
  // background, clears the home indicator, and reads as part of the same family.
  footerBar: {
    position: "fixed",
    bottom: "calc(12px + env(safe-area-inset-bottom))",
    left: 14,
    right: 14,
    background: "var(--bar)",
    border: "1px solid var(--hair-2)",
    borderRadius: 22,
    padding: "10px 14px",
    display: "flex",
    justifyContent: "center",
    // Above anything a page can raise. Leaflet alone goes to 1000.
    zIndex: 1200,
    boxShadow: "0 12px 34px var(--lift-2)",
    backdropFilter: "blur(8px)",
  },
  shareBtn: {
    // A pill in the hospital's green, as the organisation's own primary buttons
    // are — not a square blue block.
    background: "linear-gradient(180deg,#0E6B4F,#0A5540)",
    border: "1px solid rgba(255,255,255,.14)",
    color: "#FFFFFF",
    fontWeight: 800,
    borderRadius: 999,
    padding: "13px 26px",
    cursor: "pointer",
    fontFamily: display,
    fontSize: 15.5,
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    maxWidth: 420,
    justifyContent: "center",
  },

  sectionHeaderRow: { display: "flex", alignItems: "center", justifyContent: "space-between", margin: "20px 0 10px" },
  // Section headings in the organisation's own idiom: a gold marker, the label
  // beside it, plenty of air above. It is the pattern staff already scan for.
  // A heading, not a rule with a gold tab on it. The bar and the letter-spacing
  // were doing the work a size and a weight should do.
  sectionHeader: {
    fontFamily: display,
    fontSize: 20,
    fontWeight: 650,
    letterSpacing: -0.42,
    color: "var(--ink)",
    margin: "26px 0 10px",
  },

  statusBoard: { padding: "6px 2px 2px" },
  statusBoardItem: { display: "flex", alignItems: "center", gap: 6, fontSize: 13 },
  statusBoardCount: { fontWeight: 700, color: "var(--ink)" },
  statusBoardLabel: { color: "var(--ink-3)", letterSpacing: 0.5 },

  staffingLine: { marginTop: 8, fontSize: 13.5, color: "var(--ink-3)", letterSpacing: 0.3 },
  staffingStrong: { color: "var(--ink)", fontWeight: 700 },
  staffingWarn: { color: "var(--hold)", fontWeight: 600 },
  selectHint: { fontSize: 12.5, color: "var(--ink-4)", marginTop: 5, lineHeight: 1.4 },
  unitCardNoCrew: { fontSize: 12, color: "var(--hold)", fontWeight: 600, letterSpacing: 0.4 },

  alertNotice: {
    marginTop: 10,
    background: "rgba(245,158,11,0.08)",
    border: "1px solid rgba(245,158,11,0.35)",
    borderRadius: 10,
    padding: "10px 12px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  alertNoticeText: { fontSize: 13.5, color: "var(--hold)", lineHeight: 1.5, flex: 1, minWidth: 220 },
  alertNoticeBtn: {
    background: "var(--hold)",
    border: "none",
    color: "var(--ground)",
    borderRadius: 8,
    padding: "7px 12px",
    cursor: "pointer",
    fontFamily: display,
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 0.4,
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
  },

  toneCheck: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  toneCheckLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 12.5,
    letterSpacing: 0.4,
    color: "var(--ink-3)",
  },
  toneCheckBtn: {
    background: "transparent",
    border: "1px solid var(--hair-2)",
    borderRadius: 999,
    padding: "4px 10px",
    cursor: "pointer",
    fontFamily: display,
    fontSize: 12.5,
    fontWeight: 700,
    letterSpacing: 0.4,
    whiteSpace: "nowrap",
  },
  toneCheckLabelMuted: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 12.5,
    letterSpacing: 0.4,
    color: "var(--hold-2)",
    fontWeight: 700,
  },

  // ---- silencing this device ----
  //
  // The chip carries its own state in the masthead; the notice below it is what
  // a crew screen shows for as long as the tone is off, so a tablet that has
  // been quietened can never be mistaken for one that simply has nothing to say.
  soundChip: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "var(--inset)",
    border: "1px solid var(--hair-2)",
    borderRadius: 999,
    padding: "5px 11px",
    cursor: "pointer",
    fontFamily: display,
    fontSize: 13.5,
    letterSpacing: 0.4,
  },
  soundMenuBtnOn: {
    background: "rgba(59,130,246,0.16)",
    border: "1px solid var(--flow)",
    borderRadius: 7,
    color: "var(--flow-2)",
    padding: "8px 10px",
    cursor: "pointer",
    fontFamily: display,
    fontSize: 13.5,
    fontWeight: 700,
    textAlign: "left",
  },
  alertNoticeMuted: {
    marginTop: 10,
    background: "rgba(245,158,11,0.12)",
    border: "1px solid var(--hold)",
    borderRadius: 10,
    padding: "10px 12px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  alertNoticeMutedText: { fontSize: 13.5, color: "var(--hold-2)", lineHeight: 1.5, flex: 1, minWidth: 220 },
  alertNoticeMutedBtn: {
    background: "var(--hold)",
    border: "none",
    color: "var(--ground)",
    borderRadius: 8,
    padding: "7px 12px",
    cursor: "pointer",
    fontFamily: display,
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 0.4,
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
  },

  requestForm: {
    background: "var(--raised)",
    border: "1px solid var(--hair)",
    borderRadius: 8,
    padding: 14,
    marginBottom: 14,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  formRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  label: { fontSize: 12, color: "var(--ink-3)", letterSpacing: 0.5, display: "block", marginBottom: 4 },
  formHint: { fontSize: 12.5, color: "var(--ink-4)", marginTop: -4, marginBottom: 4 },
  inputMissing: {
    borderColor: "var(--crit)",
    background: "rgba(255,69,58,.07)",
    boxShadow: "0 0 0 3px rgba(255,69,58,.12)",
  },

  timeFields: { display: "flex", alignItems: "center", gap: 6 },
  timeSelect: {
    background: "var(--inset)", border: "1px solid var(--hair-2)", color: "var(--ink)",
    borderRadius: 10, padding: "10px 12px", fontSize: 17, fontFamily: mono,
    fontVariantNumeric: "tabular-nums", minWidth: 68,
  },
  timeColon: { fontSize: 17, color: "var(--ink-3)", fontFamily: mono },

  input: {
    width: "100%",
    background: "var(--ground)",
    border: "1px solid var(--hair-2)",
    borderRadius: 8,
    color: "var(--ink)",
    padding: "9px 10px",
    fontFamily: display,
    fontSize: 16,
  },

  checklistRow: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 },
  checkPill: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "var(--ground)",
    border: "1px solid var(--hair-2)",
    borderRadius: 20,
    padding: "6px 12px",
    fontSize: 13.5,
    color: "var(--ink-3)",
    cursor: "pointer",
  },
  checkPillActive: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "var(--hair)",
    border: "1px solid var(--flow)",
    borderRadius: 20,
    padding: "6px 12px",
    fontSize: 13.5,
    color: "var(--ink)",
    fontWeight: 600,
    cursor: "pointer",
  },
  checkboxInput: { accentColor: "var(--flow)", width: 13, height: 13 },
  reqBadge: {
    fontSize: 12,
    color: "var(--ink-3)",
    border: "1px solid var(--hair-2)",
    borderRadius: 4,
    padding: "2px 7px",
  },
  mrnRow: { fontSize: 13, color: "var(--ink-3)", marginTop: 6 },
  timesRow: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 },
  timeChip: {
    display: "flex",
    flexDirection: "column",
    background: "var(--ground)",
    border: "1px solid var(--hair)",
    borderRadius: 8,
    padding: "5px 9px",
    minWidth: 92,
  },
  timeChipLabel: { fontSize: 11, color: "var(--ink-4)", letterSpacing: 0.3 },
  timeChipValue: { fontSize: 14, color: "var(--ink-2)", fontWeight: 600, marginTop: 2 },
  pendingAckTag: { fontSize: 13.5, color: "var(--hold)", fontWeight: 600 },
  ackTag: { fontSize: 13.5, color: "var(--ok)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 },

  alarmOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 200,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    paddingTop: "calc(20px + env(safe-area-inset-top))",
    paddingBottom: "calc(20px + env(safe-area-inset-bottom))",
    animation: "alarm-flash 1s ease-in-out infinite",
  },
  alarmCard: {
    width: "100%",
    maxWidth: 420,
    background: "var(--raised)",
    border: "2px solid var(--crit)",
    borderRadius: 14,
    padding: "28px 24px",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
    animation: "alarm-scale 1s ease-in-out infinite",
  },
  alarmPulseDot: {
    width: 14,
    height: 14,
    borderRadius: "50%",
    background: "var(--crit)",
    animation: "pulse-dot 0.8s ease-in-out infinite",
  },
  alarmTitle: { fontFamily: display, fontWeight: 800, fontSize: 22, letterSpacing: 1.5, color: "var(--crit-2)" },
  alarmAssistLine: { fontSize: 14, color: "var(--flow-2)", fontWeight: 600, letterSpacing: 0.3 },
  alarmPriority: { fontSize: 13, fontWeight: 800, color: "var(--ground)", padding: "4px 10px", borderRadius: 5, letterSpacing: 0.6 },
  alarmNature: { fontFamily: display, fontWeight: 700, fontSize: 20, color: "var(--ink-alt)", marginTop: 4 },
  alarmLocation: { display: "flex", alignItems: "center", gap: 6, fontSize: 15.5, color: "var(--ink)" },
  alarmRoute: { display: "flex", flexDirection: "column", gap: 4, alignItems: "center" },
  alarmLocationLabel: {
    fontSize: 11,
    letterSpacing: 1,
    fontWeight: 700,
    color: "var(--ink-3)",
    border: "1px solid var(--hair-2)",
    borderRadius: 4,
    padding: "1px 5px",
  },
  alarmMrn: { fontSize: 14, color: "var(--ink-2)" },
  alarmReqBadge: {
    fontSize: 12.5,
    color: "var(--ground)",
    background: "var(--ink-alt)",
    borderRadius: 4,
    padding: "3px 8px",
    fontWeight: 600,
  },
  // Geometry shared with alarmAckBtnBusy below. The two are one button in two
  // states, and they had different radii, padding and type sizes — so the
  // biggest button in the app visibly jumped and reshaped itself the moment a
  // crew pressed it, on the alarm screen, which is the worst place to look
  // unreliable. Change one and change the other.
  alarmAckBtn: {
    marginTop: 12,
    width: "100%",
    background: "var(--ink-alt)",
    color: "#FFFFFF",
    border: "1px solid transparent",
    borderRadius: 12,
    padding: "16px 16px",
    fontWeight: 800,
    fontSize: 17,
    letterSpacing: 0.5,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontFamily: display,
  },
  alarmFootnote: { fontSize: 12.5, color: "var(--crit-2)", marginTop: 4 },
  alarmFootnoteMuted: {
    fontSize: 12.5,
    color: "var(--hold-2)",
    marginTop: 4,
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontWeight: 700,
  },

  ambulanceRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "var(--raised)",
    border: "1px solid var(--hair)",
    borderRadius: 8,
    padding: 12,
    flexWrap: "wrap",
  },
  unitCardAdmin: {
    display: "flex", gap: 6, marginTop: 10,
    borderTop: "0.5px solid var(--hair)", paddingTop: 9,
  },
  unitCardAdminBtn: {
    background: "none", border: "0.5px solid var(--hair-2)", color: "var(--ink-3)",
    borderRadius: 999, padding: "5px 12px", fontSize: 12, fontWeight: 600,
    cursor: "pointer", fontFamily: display,
  },
  unitCardRemoveBtn: {
    background: "none", border: "0.5px solid color-mix(in srgb, var(--crit) 45%, transparent)",
    color: "var(--crit)", borderRadius: 999, padding: "5px 12px", fontSize: 12,
    fontWeight: 600, cursor: "pointer", fontFamily: display,
  },

  unitCardAmbulance: { fontSize: 12.5, color: "var(--ink-4)" },
  unitMemberRow: { display: "flex", justifyContent: "space-between", fontSize: 13, gap: 6 },
  unitMemberLabel: { color: "var(--ink-4)", letterSpacing: 0.4 },
  unitMemberRight: { display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" },
  unitMemberName: { color: "var(--ink-2)", fontWeight: 600 },

  // ---- shifts ----
  shiftChipWrap: { position: "relative" },
  shiftChip: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "var(--inset)",
    border: "1px solid var(--hair-2)",
    borderRadius: 999,
    padding: "5px 11px",
    cursor: "pointer",
    fontFamily: display,
    fontSize: 13.5,
    letterSpacing: 0.4,
  },
  shiftChipTime: { color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" },
  shiftMenu: {
    position: "absolute",
    top: "calc(100% + 8px)",
    right: 0,
    width: 268,
    background: "var(--inset)",
    border: "1px solid var(--hair-2)",
    borderRadius: 10,
    padding: 10,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    zIndex: 40,
    boxShadow: "0 12px 28px rgba(0,0,0,0.45)",
  },
  shiftMenuHead: { fontSize: 12.5, color: "var(--ink-3)", letterSpacing: 0.4, lineHeight: 1.5 },
  shiftMenuBtn: {
    background: "var(--ground)",
    border: "1px solid var(--hair-2)",
    borderRadius: 7,
    color: "var(--ink)",
    padding: "8px 10px",
    cursor: "pointer",
    fontFamily: display,
    fontSize: 13.5,
    textAlign: "left",
  },
  shiftMenuHint: { fontSize: 12, color: "var(--ink-4)", lineHeight: 1.5 },
  shiftTag: {
    border: "1px solid",
    borderRadius: 999,
    padding: "1px 6px",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: 0.4,
    whiteSpace: "nowrap",
  },
  otTag: {
    border: "1px solid var(--crit)",
    color: "var(--crit-2)",
    background: "rgba(239,68,68,0.12)",
    borderRadius: 999,
    padding: "1px 6px",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: 0.4,
    whiteSpace: "nowrap",
  },
  shiftCard: {
    background: "var(--inset)",
    border: "1px solid var(--hair)",
    borderLeft: "3px solid",
    borderRadius: 10,
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  shiftCardTop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" },
  shiftCardTitle: { fontFamily: display, fontWeight: 700, fontSize: 15, letterSpacing: 0.8 },
  shiftCardWindow: { fontSize: 13.5, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" },
  shiftCardRemaining: { fontSize: 15, color: "var(--ink)", fontVariantNumeric: "tabular-nums" },
  shiftCardOvertime: { display: "flex", alignItems: "center", gap: 8 },
  shiftCardOvertimeLabel: { fontSize: 12.5, letterSpacing: 1, fontWeight: 700, color: "var(--crit)" },
  shiftCardOvertimeTime: { marginLeft: "auto", fontSize: 16, color: "var(--ink-alt)", fontVariantNumeric: "tabular-nums" },
  shiftCardNote: { fontSize: 13, color: "var(--ink-3)", lineHeight: 1.5 },
  shiftBanner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    padding: "9px 12px",
    borderBottom: "1px solid var(--hair)",
  },
  shiftBannerWindow: { fontSize: 12.5, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" },
  shiftBannerCrew: { fontSize: 12.5, color: "var(--ink-4)", marginLeft: "auto" },
  shiftBannerDate: {
    fontSize: 12,
    color: "var(--ink-4)",
    padding: "0 12px 8px",
    borderBottom: "1px solid var(--hair)",
    fontVariantNumeric: "tabular-nums",
  },
  logScopeNote: {
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--ink-4)",
    padding: "8px 12px",
    borderBottom: "1px solid var(--hair)",
  },
  logTabs: { display: "flex", gap: 6, padding: "8px 12px", borderBottom: "1px solid var(--hair)" },
  shiftDetailRow: { display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", marginTop: 6 },
  shiftEventTag: {
    border: "1px solid",
    borderRadius: 4,
    padding: "1px 5px",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.5,
  },
  shiftDetailChip: {
    background: "var(--ground)",
    border: "1px solid var(--hair)",
    borderRadius: 4,
    padding: "1px 5px",
    fontSize: 11.5,
    color: "var(--ink-3)",
    whiteSpace: "nowrap",
  },

  emptyState: {
    color: "var(--ink-4)",
    fontSize: 14.5,
    padding: "18px 4px",
    fontStyle: "italic",
  },

  // The opened card is the tile grown up: the same gradient, the same lit edge,
  // the same soft shadow. It was still flat while the tiles around it had been
  // rebuilt, so opening one felt like leaving the app.
  // The approved card treatment — design/README.md, "Tokens — unchanged":
  // 16px radius, 1px solid var(--hair), 0 6px 18px var(--lift), on a flat
  // --raised surface. This card predated that direction and kept a 20px
  // radius, a --veil border, a much heavier shadow and a gradient, so the
  // busiest surface on the board was the one that did not match the pending
  // and unit cards sitting beside it.
  callCard: {
    background: "var(--raised)",
    border: "1px solid var(--hair)",
    borderLeft: "4px solid",
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    boxShadow: "0 6px 18px var(--lift)",
  },
  callCardFolded: { padding: "0", background: "none", boxShadow: "none" },
  // The booked-ahead card, at the weight of a pending call tile.
  //
  // Bookings were drawn with the full call-card treatment — 18px of padding, a
  // 20px radius and a deep shadow — which is right for the one call a crew is
  // running and wrong for a list of twenty transfers next Tuesday. At that
  // size a day's bookings do not fit on a phone and the desk scrolls to read
  // its own diary. Same information, a third of the height.
  // The one-time sign-in code, shown once. Deliberately the loudest thing on
  // the page while it is up: it cannot be read back, so an administrator who
  // scrolls past it has to issue another.
  claimCodeBanner: {
    marginTop: 14,
    background: "var(--raised)",
    border: "1px solid var(--gold)",
    borderRadius: 16,
    padding: "13px 14px 14px",
    boxShadow: "0 6px 18px var(--lift)",
  },
  claimCodeHead: {
    fontSize: 11, fontWeight: 800, letterSpacing: 0.8, color: "var(--gold)", marginBottom: 9,
  },
  claimCodeRow: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: 10, flexWrap: "wrap", padding: "6px 0",
    borderTop: "1px solid var(--hair)",
  },
  claimCodeWho: { fontSize: 14, fontWeight: 650, color: "var(--ink)" },
  claimCodeId: { fontSize: 12, color: "var(--ink-4)", marginLeft: 6 },
  claimCodeValue: {
    fontSize: 21, fontWeight: 800, letterSpacing: 3, color: "var(--ink)",
    fontVariantNumeric: "tabular-nums",
  },
  claimCodeNote: { fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5, margin: "9px 0 11px" },
  schedCard: {
    background: "var(--raised)",
    border: "1px solid var(--hair)",
    borderLeft: "4px solid",
    borderRadius: 16,
    padding: "11px 13px 12px",
    marginBottom: 8,
    boxShadow: "0 6px 18px var(--lift)",
  },
  schedCardNature: { fontFamily: display, fontWeight: 760, fontSize: 15, letterSpacing: -0.2 },
  schedCardMeta: {
    display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap",
    marginTop: 6, fontSize: 12, color: "var(--ink-3)",
  },
  schedCardActions: { display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" },
  // The repeating list: a standing arrangement, not an appointment. Its own
  // colour so it cannot be mistaken for something happening today.
  repeatDays: {
    display: "inline-flex", alignItems: "center", gap: 4,
    border: "1px solid var(--move)", color: "var(--move)",
    borderRadius: 999, padding: "1px 8px", fontSize: 11.5, fontWeight: 700,
  },
  repeatNext: { fontSize: 12, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" },

  foldedRow: {
    display: "flex", alignItems: "baseline", gap: 10, width: "100%",
    background: "none", border: "none", padding: "11px 14px",
    cursor: "pointer", textAlign: "left", color: "var(--ink)",
  },
  foldedNature: { fontSize: 14.5, fontWeight: 600, letterSpacing: -0.2, flex: "none", maxWidth: "42%",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  foldedRoute: { fontSize: 12.5, color: "var(--ink-4)", flex: 1, minWidth: 0,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  foldedTime: { fontFamily: mono, fontSize: 13, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" },
  foldedFlag: { fontSize: 12 },
  foldBack: {
    float: "right", background: "none", border: "0.5px solid var(--hair-2)", color: "var(--ink-3)",
    borderRadius: 999, padding: "4px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer",
  },

  callCardTop: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  callCardNature: { fontFamily: display, fontWeight: 780, fontSize: 19, letterSpacing: -0.4 },
  callCardMeta: { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 8, fontSize: 13, color: "var(--ink-3)" },
  callCardMetaItem: { display: "flex", alignItems: "center", gap: 4 },
  callCardActions: { display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" },

  routeFrom: { color: "var(--ink-2)" },
  routeTo: { color: "var(--ink)", fontWeight: 600 },

  historyNote: { fontSize: 15, color: "var(--ink-3)", lineHeight: 1.55, fontWeight: 500 },
  historyDuration: { fontSize: 13, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" },
  historyClosedBy: { fontSize: 12.5, color: "var(--ink-4)", marginTop: 8 },
  // Which leg of a there-and-back, and whether the booking is a standing one.
  legOut: {
    display: "inline-flex", alignItems: "center", gap: 4,
    fontSize: 9.5, fontWeight: 800, letterSpacing: 0.7, color: "var(--flow)",
    border: "1px solid var(--flow)", borderRadius: 5, padding: "1px 6px",
  },
  legReturn: {
    display: "inline-flex", alignItems: "center", gap: 4,
    fontSize: 9.5, fontWeight: 800, letterSpacing: 0.7, color: "var(--move)",
    border: "1px solid var(--move)", borderRadius: 5, padding: "1px 6px",
  },
  repeatTag: {
    display: "inline-flex", alignItems: "center", gap: 5,
    fontSize: 9.5, fontWeight: 800, letterSpacing: 0.7, color: "var(--land)",
    border: "1px solid var(--land)", borderRadius: 5, padding: "1px 6px",
  },
  legLink: {
    display: "flex", alignItems: "flex-start", gap: 7, marginTop: 9,
    padding: "8px 10px", borderRadius: 10,
    background: "rgba(167,139,250,.10)", border: "1px solid rgba(167,139,250,.34)",
    fontSize: 12, color: "var(--ink-3)", lineHeight: 1.45,
  },
  legLinkArrow: { fontSize: 15, lineHeight: 1, flex: "none", color: "var(--move)" },
  legLinkStrong: { color: "var(--move)", fontWeight: 750 },
  legWaiting: { color: "var(--hold)", fontWeight: 750 },
  scheduledTag: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    border: "1px solid var(--hair-2)",
    borderRadius: 999,
    padding: "1px 7px",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: 0.3,
    color: "var(--flow-2)",
    whiteSpace: "nowrap",
  },
  twoTimes: {
    marginTop: 7, fontSize: 12.5, color: "var(--ink-2)",
    display: "flex", gap: 6, flexWrap: "wrap", alignItems: "baseline",
  },
  twoTimesDim: { color: "var(--ink-4)", fontSize: 12 },

  schedCancelled: {
    background: "linear-gradient(180deg, rgba(255,77,94,.10), rgba(255,77,94,.03))",
    border: "1px solid rgba(255,77,94,.4)",
    borderLeftWidth: 4,
    opacity: 0.92,
  },

  callCardDueSoon: {
    border: "1px solid rgba(245,158,11,0.45)",
    boxShadow: "0 0 0 1px rgba(245,158,11,0.12) inset",
  },
  quickPickRow: { display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" },
  quickPickBtn: {
    background: "transparent",
    border: "1px solid var(--hair-2)",
    color: "var(--ink-3)",
    borderRadius: 999,
    padding: "3px 10px",
    cursor: "pointer",
    fontFamily: display,
    fontSize: 12.5,
  },

  // ---- the Gregorian date/time picker ----
  whenPicker: {
    background: "var(--ground)",
    border: "1px solid var(--hair-2)",
    borderRadius: 8,
    padding: 10,
  },
  whenReadoutRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
    flexWrap: "wrap",
    paddingBottom: 10,
    borderBottom: "1px solid var(--hair)",
  },
  whenReadoutTime: {
    fontFamily: display,
    fontWeight: 700,
    fontSize: 26,
    lineHeight: 1,
    color: "var(--ink)",
    fontVariantNumeric: "tabular-nums",
  },
  whenReadoutDate: { fontSize: 13.5, color: "var(--ink-3)", marginTop: 5, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  whenCalTag: {
    border: "1px solid var(--hair-2)",
    borderRadius: 999,
    padding: "1px 6px",
    fontSize: 11,
    letterSpacing: 0.4,
    color: "var(--ink-4)",
  },
  whenReadoutSide: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 },
  whenReadoutUntil: { fontSize: 13.5, color: "var(--flow)", fontWeight: 600, fontVariantNumeric: "tabular-nums" },
  whenSection: { marginTop: 10 },
  whenSectionLabel: {
    fontSize: 11.5,
    letterSpacing: 0.6,
    color: "var(--ink-4)",
    fontWeight: 700,
    marginBottom: 6,
  },
  calHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 },
  calMonthLabel: { fontFamily: display, fontWeight: 700, fontSize: 15, color: "var(--ink)", letterSpacing: 0.3 },
  calNavBtn: {
    background: "var(--raised)",
    border: "1px solid var(--hair-2)",
    color: "var(--ink-2)",
    borderRadius: 8,
    width: 26,
    height: 26,
    cursor: "pointer",
    fontFamily: display,
    fontSize: 17,
    lineHeight: 1,
  },
  calWeekRow: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 },
  calWeekday: {
    textAlign: "center",
    fontSize: 11,
    letterSpacing: 0.4,
    color: "var(--ink-4)",
    padding: "2px 0 4px",
    fontWeight: 700,
  },
  calDay: {
    background: "var(--raised)",
    border: "1px solid var(--hair)",
    color: "var(--ink-2)",
    borderRadius: 8,
    padding: "7px 0",
    cursor: "pointer",
    fontFamily: display,
    fontSize: 14,
    fontVariantNumeric: "tabular-nums",
  },
  calDayOutside: { color: "var(--ink-4)", background: "transparent" },
  calDayPast: { color: "var(--hair-2)", cursor: "not-allowed", background: "transparent", borderColor: "var(--panel)" },
  calDayToday: { borderColor: "var(--flow)", color: "var(--flow-2)" },
  calDaySelected: { background: "var(--flow)", borderColor: "var(--flow)", color: "var(--ground)", fontWeight: 700 },
  calDayHeading: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 6,
    paddingBottom: 4,
    borderBottom: "1px solid var(--hair)",
  },
  calDayHeadingText: { fontFamily: display, fontWeight: 700, fontSize: 14, color: "var(--ink-2)", letterSpacing: 0.3 },
  calDayHeadingCount: { fontSize: 12, color: "var(--ink-4)" },
  whenTimeRow: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  whenTimeSelect: {
    background: "var(--raised)",
    border: "1px solid var(--hair-2)",
    color: "var(--ink)",
    borderRadius: 8,
    padding: "8px 10px",
    fontFamily: mono,
    fontSize: 18,
    fontVariantNumeric: "tabular-nums",
  },
  whenTimeColon: { fontFamily: mono, fontSize: 18, color: "var(--ink-4)" },
  whenNudgeGroup: { display: "flex", gap: 4, marginLeft: 4, flexWrap: "wrap" },
  whenNudgeBtn: {
    background: "var(--raised)",
    border: "1px solid var(--hair-2)",
    color: "var(--ink-3)",
    borderRadius: 8,
    padding: "6px 8px",
    cursor: "pointer",
    fontFamily: display,
    fontSize: 12.5,
  },
  rescheduleBox: {
    marginTop: 10,
    paddingTop: 10,
    borderTop: "1px solid var(--hair)",
  },

  // ---- the cancellation banner ----
  // Amber, not red: at the point this appears nothing has been cancelled yet —
  // it is the desk being asked a question, and it can still be backed out of.
  // The one red thing on it is the button that actually does the cancelling.
  cancelReasonBanner: {
    marginTop: 10,
    background: "rgba(245,158,11,0.08)",
    border: "1px solid rgba(245,158,11,0.45)",
    borderRadius: 10,
    padding: "10px 12px",
  },
  cancelReasonHead: {
    fontFamily: display,
    fontWeight: 700,
    fontSize: 13.5,
    letterSpacing: 0.6,
    color: "var(--hold-2)",
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  cancelReasonNote: { fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.5, margin: "6px 0 8px" },
  reasonPill: {
    background: "var(--ground)",
    border: "1px solid var(--hair-2)",
    borderRadius: 20,
    padding: "6px 12px",
    fontSize: 13.5,
    color: "var(--ink-3)",
    cursor: "pointer",
    fontFamily: display,
    textAlign: "left",
  },
  reasonPillActive: {
    background: "color-mix(in srgb, var(--hold) 18%, var(--panel))",
    border: "1px solid var(--hold)",
    borderRadius: 20,
    padding: "6px 12px",
    fontSize: 13.5,
    color: "var(--hold-2)",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: display,
    textAlign: "left",
  },
  // The reason read back on a cancelled card — the same amber it was typed in,
  // so it is picked out of the grey line it sits on.
  cancelReasonSaid: { color: "var(--hold-3)" },
  dangerBtnSm: {
    background: "var(--crit)",
    border: "none",
    color: "#FFFFFF",
    fontWeight: 700,
    borderRadius: 8,
    padding: "6px 10px",
    cursor: "pointer",
    fontFamily: display,
    fontSize: 13.5,
    display: "flex",
    alignItems: "center",
    gap: 5,
  },

  // ---- a booking nobody can put a time on yet ----
  // The toggle sits where the calendar would be, full width, because on a busy
  // desk it is the first thing to reach for when the ward says "we'll call you".
  awaitCallToggle: {
    width: "100%",
    background: "var(--raised)",
    border: "1px dashed var(--hair-2)",
    color: "var(--ink-3)",
    borderRadius: 7,
    padding: "9px 11px",
    marginBottom: 8,
    cursor: "pointer",
    fontFamily: display,
    fontSize: 13.5,
    textAlign: "left",
    display: "flex",
    alignItems: "center",
    gap: 7,
    lineHeight: 1.4,
  },
  awaitCallToggleOn: {
    width: "100%",
    background: "rgba(245,158,11,0.12)",
    border: "1px solid rgba(245,158,11,0.55)",
    color: "var(--hold-2)",
    borderRadius: 7,
    padding: "9px 11px",
    marginBottom: 8,
    cursor: "pointer",
    fontFamily: display,
    fontSize: 13.5,
    fontWeight: 700,
    textAlign: "left",
    display: "flex",
    alignItems: "center",
    gap: 7,
    lineHeight: 1.4,
  },
  awaitCallNote: { fontSize: 13, color: "var(--ink-3)", lineHeight: 1.55 },
  awaitCallTag: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    border: "1px solid rgba(245,158,11,0.55)",
    background: "rgba(245,158,11,0.12)",
    borderRadius: 999,
    padding: "1px 7px",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: 0.4,
    color: "var(--hold-2)",
    whiteSpace: "nowrap",
  },
  readyNowBtn: {
    background: "var(--hold)",
    border: "none",
    color: "var(--ground)",
    fontWeight: 700,
    borderRadius: 8,
    padding: "7px 11px",
    cursor: "pointer",
    fontFamily: display,
    fontSize: 13.5,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  },

  // ---- the quarter-hour reminder ----
  preAlert: {
    marginTop: 10,
    background: "rgba(59,130,246,0.08)",
    border: "1px solid rgba(59,130,246,0.45)",
    borderRadius: 10,
    padding: "10px 12px",
  },
  preAlertHead: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  preAlertTitle: {
    fontFamily: display,
    fontWeight: 700,
    fontSize: 13.5,
    letterSpacing: 0.6,
    color: "var(--flow-2)",
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
  },
  preAlertCount: { fontSize: 13, color: "var(--ink-2)", flex: 1, minWidth: 140 },
  preAlertDismiss: {
    background: "transparent",
    border: "1px solid var(--hair-2)",
    color: "var(--ink-3)",
    borderRadius: 8,
    padding: "4px 10px",
    cursor: "pointer",
    fontFamily: display,
    fontSize: 12.5,
  },
  preAlertRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 8,
    fontSize: 13.5,
    color: "var(--ink-3)",
  },
  preAlertTime: {
    fontFamily: display,
    fontWeight: 700,
    fontSize: 17,
    color: "var(--ink)",
    fontVariantNumeric: "tabular-nums",
  },
  preAlertIn: { fontSize: 13, color: "var(--flow-2)", fontWeight: 600 },
  preAlertNature: { color: "var(--ink)", fontWeight: 600 },
  preAlertRoute: { color: "var(--ink-3)" },
  preAlertFoot: { marginTop: 8, fontSize: 12.5, color: "var(--ink-4)", lineHeight: 1.5 },
  preAlertArmBtn: {
    background: "transparent",
    border: "none",
    padding: 0,
    color: "var(--flow-2)",
    cursor: "pointer",
    fontFamily: display,
    fontSize: 12.5,
    textDecoration: "underline",
  },
  remindingTag: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    border: "1px solid rgba(59,130,246,0.5)",
    background: "rgba(59,130,246,0.12)",
    borderRadius: 999,
    padding: "1px 7px",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.4,
    color: "var(--flow-2)",
    whiteSpace: "nowrap",
  },

  pill: { fontSize: 11.5, fontWeight: 700, color: "var(--ground)", padding: "3px 7px", borderRadius: 4, letterSpacing: 0.4 },

  // ---- responded, nobody transported ----
  noTransportTag: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    border: `1px solid ${NO_TRANSPORT.color}`,
    background: "rgba(217,119,6,0.12)",
    borderRadius: 4,
    padding: "2px 7px",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: 0.4,
    color: NO_TRANSPORT.color,
    whiteSpace: "nowrap",
  },
  // ---- closed because it was called off, not because it was run ----
  cancelledCallTag: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    border: "1px solid #64748B",
    background: "rgba(100,116,139,0.14)",
    borderRadius: 4,
    padding: "2px 7px",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: 0.4,
    color: "var(--ink-3)",
    whiteSpace: "nowrap",
  },
  // ---- who is writing the patient care report ----
  //
  // The block sits between the call times and the timeline button because that
  // is the order the crew work in: the times, then the paperwork name, then the
  // press that ends the call. It is quiet while it is answered and outlined in
  // amber while it is the thing standing in the way.
  pcrBlock: {
    marginTop: 12,
    paddingTop: 10,
    borderTop: "1px solid #202936",
  },
  pcrBlockRequired: {
    marginTop: 12,
    padding: "10px 10px 10px 10px",
    border: "1px solid rgba(245,158,11,0.55)",
    background: "rgba(245,158,11,0.07)",
    borderRadius: 8,
  },
  pcrHeader: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: 0.5,
    color: "var(--ink-3)",
    marginBottom: 8,
  },
  pcrHeaderRequired: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: 0.5,
    color: "var(--hold)",
    marginBottom: 8,
  },
  pcrChoices: { display: "flex", flexWrap: "wrap", gap: 8 },
  // Deliberately wide targets: this is pressed with a thumb, in an ambulance,
  // and picking the wrong crew member puts the report on the wrong person.
  pcrChoice: {
    background: "transparent",
    border: "1px solid var(--hair-2)",
    color: "var(--ink-2)",
    borderRadius: 8,
    padding: "8px 12px",
    cursor: "pointer",
    fontFamily: display,
    fontSize: 13.5,
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: 5,
  },
  pcrChoiceOn: {
    background: "rgba(59,130,246,0.16)",
    border: "1px solid var(--flow)",
    color: "var(--flow-2)",
    borderRadius: 8,
    padding: "8px 12px",
    cursor: "pointer",
    fontFamily: display,
    fontSize: 13.5,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    gap: 5,
  },
  pcrNote: { fontSize: 13.5, color: "var(--ink-3)", marginTop: 8, lineHeight: 1.5 },

  // ---- category of call and loaded kilometers ----
  //
  // The block sits below the paperwork name, last of the three things the crew
  // record on a call. Quiet for most of the call — the codes can be answered at
  // any point, by either side — and outlined in the same amber as the paperwork
  // name once the crew are on the last step without them.
  codingBlock: {
    marginTop: 12,
    paddingTop: 10,
    borderTop: "1px solid #202936",
  },
  codingBlockRequired: {
    marginTop: 12,
    padding: "10px 10px 10px 10px",
    border: "1px solid rgba(245,158,11,0.55)",
    background: "rgba(245,158,11,0.07)",
    borderRadius: 8,
  },
  codingHeader: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: 0.5,
    color: "var(--ink-3)",
    marginBottom: 8,
  },
  codingHeaderRequired: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: 0.5,
    color: "var(--hold)",
    marginBottom: 8,
  },
  codingRowLabel: { fontSize: 11, color: "var(--ink-4)", letterSpacing: 0.6, marginBottom: 6, fontWeight: 700 },
  codingRowLabelRequired: { fontSize: 11, color: "var(--hold)", letterSpacing: 0.6, marginBottom: 6, fontWeight: 700 },
  codingChoices: { display: "flex", flexWrap: "wrap", gap: 6 },
  codeChoice: {
    background: "transparent",
    border: "1px solid var(--hair-2)",
    color: "var(--ink-3)",
    borderRadius: 8,
    padding: "6px 9px",
    cursor: "pointer",
    fontFamily: display,
    display: "flex",
    alignItems: "baseline",
    gap: 5,
  },
  codeChoiceOn: {
    background: "rgba(148,163,184,0.1)",
    border: "1px solid",
    color: "var(--ink)",
    borderRadius: 8,
    padding: "6px 9px",
    cursor: "pointer",
    fontFamily: display,
    fontWeight: 700,
    display: "flex",
    alignItems: "baseline",
    gap: 5,
  },
  codeChoiceKey: { fontSize: 15, fontWeight: 700, letterSpacing: 0.5 },
  codeChoiceName: { fontSize: 12, letterSpacing: 0.3, opacity: 0.85 },
  codingSuggestion: { fontSize: 12.5, color: "var(--hold-2)", marginTop: 6, lineHeight: 1.5 },
  codingNote: { fontSize: 12.5, color: "var(--ink-4)", marginTop: 8, lineHeight: 1.5 },
  codingNoteRequired: { fontSize: 13.5, color: "var(--ink-3)", marginTop: 8, lineHeight: 1.5 },
  codingClosedRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    marginTop: 10,
    paddingTop: 10,
    borderTop: "1px solid #202936",
  },
  codeTag: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    border: "1px solid",
    borderRadius: 4,
    padding: "2px 7px",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: 0.4,
    whiteSpace: "nowrap",
  },
  codeMissingTag: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    border: "1px dashed #3A4552",
    borderRadius: 4,
    padding: "2px 7px",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: 0.4,
    color: "var(--ink-4)",
    whiteSpace: "nowrap",
  },
  pcrEmpty: { fontSize: 13.5, color: "var(--hold)", lineHeight: 1.5 },
  pcrPendingNote: { fontSize: 13.5, color: "var(--hold)", fontWeight: 600, flex: 1, minWidth: 180 },
  pcrAuthorTag: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    border: "1px solid rgba(148,163,184,0.5)",
    background: "rgba(148,163,184,0.1)",
    borderRadius: 4,
    padding: "2px 7px",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: 0.4,
    color: "var(--ink-2)",
    whiteSpace: "nowrap",
  },
  pcrAuthorTagPending: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    border: "1px solid var(--hold)",
    background: "rgba(245,158,11,0.12)",
    borderRadius: 4,
    padding: "2px 7px",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: 0.4,
    color: "var(--hold-2)",
    whiteSpace: "nowrap",
  },
  // The exception actions sit in their own block, pushed down and away from the
  // button the crew press on every call, behind a rule that says plainly this
  // is different territory.
  exceptionBlock: {
    marginTop: 18,
    paddingTop: 10,
    borderTop: "1px dashed var(--hair-2)",
  },
  exceptionHeader: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: 0.5,
    color: "var(--ink-3)",
    marginBottom: 8,
  },
  exceptionActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
    flexWrap: "wrap",
  },
  refusalBtn: {
    background: "transparent",
    border: `1px solid ${NO_TRANSPORT.color}`,
    color: NO_TRANSPORT.color,
    borderRadius: 8,
    padding: "6px 10px",
    cursor: "pointer",
    fontFamily: mono,
    fontSize: 13.5,
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: 5,
  },

  // ---- a second ambulance on the same call ----
  assistBtn: {
    background: "transparent",
    border: "1px solid var(--crit)",
    color: "var(--crit-2)",
    borderRadius: 999,
    padding: "6px 10px",
    cursor: "pointer",
    fontFamily: display,
    fontSize: 13.5,
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: 5,
  },
  // The waiting state of assistBtn. A pill that turns into a rounded rectangle
  // the moment it is pressed reads as a different control, not a changed one.
  assistBtnPending: {
    background: "rgba(239,68,68,0.12)",
    border: "1px solid rgba(239,68,68,0.5)",
    color: "var(--crit-2)",
    borderRadius: 999,
    padding: "6px 10px",
    cursor: "default",
    fontFamily: display,
    fontSize: 13.5,
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: 5,
  },
  assistTag: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    border: "1px solid rgba(129,140,248,0.6)",
    background: "rgba(129,140,248,0.12)",
    borderRadius: 4,
    padding: "2px 7px",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: 0.4,
    color: "var(--flow-2)",
    whiteSpace: "nowrap",
  },
  assistTagUrgent: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    border: "1px solid var(--crit)",
    background: "rgba(239,68,68,0.14)",
    borderRadius: 4,
    padding: "2px 7px",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: 0.4,
    color: "var(--crit-2)",
    whiteSpace: "nowrap",
    animation: "pulse-dot 1.6s ease-in-out infinite",
  },
  assistNote: { fontSize: 13.5, color: "var(--ink-3)", flex: 1, minWidth: 180, lineHeight: 1.5 },

  // ---- escalations: the corner banner and the thread it opens ----
  //
  // The banner lives in the same corner of every call card, beside the priority
  // pill, so the crew always look in one place for it. Quiet until there is
  // something on it; the colour of the state it is in once there is.
  callCardTopRight: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 },
  escChipQuiet: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    background: "transparent",
    border: "1px dashed #3A4552",
    borderRadius: 4,
    padding: "3px 8px",
    fontFamily: display,
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: 0.4,
    color: "var(--ink-3)",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  escChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    border: "1px solid",
    borderRadius: 4,
    padding: "3px 8px",
    fontFamily: display,
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: 0.4,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  escStatePill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    border: "1px solid",
    borderRadius: 4,
    padding: "2px 7px",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: 0.4,
    whiteSpace: "nowrap",
  },
  escPanel: {
    marginTop: 14,
    paddingTop: 10,
    borderTop: "1px dashed var(--hair-2)",
  },
  escPanelHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 8,
  },
  escPanelTitle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: 0.5,
    color: "var(--ink-3)",
  },
  escEmpty: { fontSize: 13.5, color: "var(--ink-4)", fontStyle: "italic", marginBottom: 8 },
  escItem: {
    background: "var(--ground)",
    border: "1px solid var(--hair)",
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  escItemHead: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 6 },
  escItemWhen: { fontSize: 12.5, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" },
  escItemWho: { fontSize: 12.5, color: "var(--ink-2)", fontWeight: 600 },
  escAfterTag: {
    border: "1px solid var(--hair-2)",
    borderRadius: 999,
    padding: "1px 7px",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.3,
    color: "var(--ink-3)",
  },
  escMessage: { fontSize: 14.5, color: "var(--ink)", lineHeight: 1.55, whiteSpace: "pre-wrap" },
  escPreview: {
    marginTop: 8,
    fontSize: 14,
    color: "var(--ink-2)",
    lineHeight: 1.5,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  escReplies: { display: "flex", flexDirection: "column", gap: 6, marginTop: 8 },
  escReplyAdmin: {
    background: "rgba(59,130,246,0.10)",
    borderLeft: "2px solid var(--flow)",
    borderRadius: 4,
    padding: "6px 8px",
  },
  escReplyTeam: {
    background: "var(--raised)",
    borderLeft: "2px solid #3A4552",
    borderRadius: 4,
    padding: "6px 8px",
  },
  escReplyHead: { fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, color: "var(--ink-3)", marginBottom: 3 },
  escReplyBody: { fontSize: 14, color: "var(--ink)", lineHeight: 1.5, whiteSpace: "pre-wrap" },
  escResolvedNote: { fontSize: 12.5, color: "var(--ok)", marginTop: 8 },
  escItemActions: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 8 },
  escTextarea: {
    width: "100%",
    background: "var(--ground)",
    border: "1px solid var(--hair-2)",
    borderRadius: 8,
    color: "var(--ink)",
    padding: "8px 10px",
    fontFamily: display,
    fontSize: 16,
    lineHeight: 1.5,
    resize: "vertical",
  },
  // --- Call corrections -----------------------------------------------------
  refusalPanel: {
    marginTop: 10,
    background: "color-mix(in srgb, var(--crit) 12%, var(--panel))",
    border: "1px solid var(--crit)",
    borderRadius: 16,
    padding: 12,
    boxShadow: "0 6px 18px var(--lift)",
  },
  refusalPanelHead: {
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0.5,
    color: "var(--crit-2)",
    display: "flex",
    alignItems: "center",
    gap: 5,
  },
  refusalPanelNote: { fontSize: 13.5, color: "var(--ink-3)", lineHeight: 1.5, marginTop: 6 },
  refusalPanelActions: {
    marginTop: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  },
  refusalConfirmBtn: {
    background: "var(--crit)",
    border: "none",
    color: "#fff",
    borderRadius: 8,
    padding: "7px 12px",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
  },

  foldHeader: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    background: "var(--raised)",
    border: "1px solid var(--hair)",
    borderRadius: 9,
    padding: "11px 13px",
    color: "var(--ink-2)",
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0.7,
    cursor: "pointer",
    textAlign: "left",
  },
  foldCount: { marginLeft: "auto", fontSize: 11.5, fontWeight: 600, color: "var(--ink-4)", letterSpacing: 0.3 },
  foldBody: { paddingTop: 10 },

  handoverTag: {
    marginTop: 8,
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: 0.3,
    color: "var(--hold)",
    background: "rgba(255,176,32,.08)",
    border: "1px solid rgba(255,176,32,.35)",
    borderRadius: 8,
    padding: "6px 9px",
  },

  receiverPrompt: {
    marginTop: 12,
    marginBottom: 4,
    width: "100%",
    minHeight: 58,
    background: "linear-gradient(180deg,#3A2A05,#241A03)",
    border: "1px solid var(--gold)",
    color: "var(--hold-3)",
    borderRadius: 16,
    padding: "14px 16px",
    fontSize: 15.5,
    fontWeight: 800,
    letterSpacing: 0.2,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    boxShadow: "0 8px 22px rgba(233,196,106,.16)",
  },
  receiverDone: {
    marginTop: 10, background: "rgba(61,220,151,.07)",
    border: "1px solid rgba(61,220,151,.35)", borderRadius: 10,
    padding: "10px 12px", fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.5,
  },
  receiverBy: { color: "var(--ink-4)", fontSize: 12.5 },
  receiverEdit: {
    marginLeft: 8, background: "none", border: "none", color: "var(--info)",
    fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: 0,
  },
  receiverPanel: {
    marginTop: 10, background: "var(--ground)", border: "1px solid var(--ok)",
    borderRadius: 16, padding: 12,
    boxShadow: "0 6px 18px var(--lift)",
  },
  receiverHead: {
    fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, color: "var(--ok)",
  },

  // A row of indicators, sized so more can be added without rearranging.
  bandWrap: {
    background: "linear-gradient(180deg, var(--inset-2), var(--panel))",
    border: "1px solid var(--hair)",
    borderRadius: 16,
    padding: "14px 14px 12px",
    marginTop: 14,
    boxShadow: "0 6px 18px var(--lift)",
  },
  bandHead: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  bandTitle: {
    fontSize: 11.5, fontWeight: 800, letterSpacing: 1.4, color: "var(--gold)",
    textTransform: "uppercase",
  },
  bandPeriods: { marginLeft: "auto", display: "flex", gap: 5 },
  bandPeriod: {
    background: "none", border: "1px solid var(--hair-2)", color: "var(--ink-3)",
    borderRadius: 999, padding: "5px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer",
  },
  bandPeriodOn: {
    background: "var(--inset)", border: "1px solid var(--flow)", color: "var(--ink)",
    borderRadius: 999, padding: "5px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer",
  },
  bandFoot: { fontSize: 12.5, color: "var(--ink-3)", marginTop: 10, lineHeight: 1.5 },

  gaugeRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(168px, 1fr))",
    gap: 10,
    marginTop: 10,
  },
  photoRow: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 },
  photoChip: {
    display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer",
    background: "var(--veil)", border: "1px solid var(--hair-2)",
    borderRadius: 999, padding: "6px 14px 6px 6px", fontSize: 12.5, color: "var(--ink-2)",
  },
  photoThumb: { width: 28, height: 28, borderRadius: "50%", objectFit: "cover" },
  photoBlank: {
    width: 28, height: 28, borderRadius: "50%", background: "var(--inset)",
    border: "1px dashed var(--hair-3)", color: "var(--ink-4)",
    display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 15,
  },

  mixCard: {
    background: "linear-gradient(180deg, var(--raised), var(--panel))",
    border: "1px solid var(--hair)",
    borderRadius: 16, padding: "13px 14px", marginTop: 10,
    boxShadow: "0 6px 18px var(--lift)",
  },
  mixBar: {
    display: "flex", height: 12, borderRadius: 999, overflow: "hidden",
    marginTop: 11, background: "var(--inset)",
  },
  mixList: { marginTop: 11, display: "flex", flexDirection: "column", gap: 6 },
  mixRow: { display: "flex", alignItems: "center", gap: 9, fontSize: 12.5 },
  mixDot: { width: 9, height: 9, borderRadius: 3, flex: "none" },
  mixName: { flex: 1, minWidth: 0, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  mixPct: { fontFamily: mono, fontWeight: 700, color: "var(--ink)", minWidth: 38, textAlign: "right" },
  mixN: { fontFamily: mono, color: "var(--ink-4)", minWidth: 28, textAlign: "right" },

  gaugeCard: {
    background: "linear-gradient(180deg, var(--raised), var(--panel))",
    border: "1px solid var(--veil)",
    borderRadius: 18,
    padding: "14px 12px 12px",
    textAlign: "center",
    boxShadow: "0 8px 22px var(--lift)",
  },
  gaugeLabel: {
    fontSize: 11, fontWeight: 800, letterSpacing: 0.9, color: "var(--ink-3)",
    textTransform: "uppercase", lineHeight: 1.4,
  },
  gaugeCentre: {
    position: "absolute", inset: 0, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", pointerEvents: "none",
  },
  gaugeValue: {
    fontFamily: mono, fontSize: 34, fontWeight: 700, letterSpacing: -1.6,
    lineHeight: 1, fontVariantNumeric: "tabular-nums",
  },
  gaugePct: { fontSize: 15, fontWeight: 600, color: "var(--ink-4)", marginLeft: 1 },
  gaugeCaption: {
    fontSize: 11.5, color: "var(--ink-3)", marginTop: 8, lineHeight: 1.4, textAlign: "center",
  },
  gaugeNote: { fontSize: 11, color: "var(--ink-4)", marginTop: 8, lineHeight: 1.45 },

  statRow: {
    display: "flex", alignItems: "center", gap: 12,
    background: "var(--raised)", border: "1px solid var(--hair)", borderRadius: 12,
    padding: "10px 12px",
    boxShadow: "0 8px 22px var(--lift)",
  },
  statName: { fontSize: 14, fontWeight: 700, color: "var(--ink)" },
  statId: { fontSize: 12, fontWeight: 600, color: "var(--ink-4)", marginLeft: 6 },
  statMeta: { fontSize: 12, color: "var(--ink-4)", marginTop: 3 },
  statBarTrack: { height: 8, background: "var(--ground)", border: "1px solid var(--hair)", borderRadius: 6, overflow: "hidden" },
  statBarFill: { height: "100%", background: "linear-gradient(90deg,var(--ok),var(--flow))" },
  statValue: { fontSize: 13, fontWeight: 800, color: "var(--ink)", textAlign: "right", marginTop: 4 },
  statCalls: { fontSize: 22, fontWeight: 800, color: "var(--ink)", minWidth: 52, textAlign: "right" },
  statOriginRow: {
    display: "flex", alignItems: "center", gap: 8, fontSize: 13,
    color: "var(--ink-2)", padding: "6px 10px", background: "var(--panel)",
    border: "1px solid var(--hair)", borderRadius: 8,
  },
  statOriginNum: { width: 58, textAlign: "right", fontVariantNumeric: "tabular-nums" },

  reviewChangedTag: {
    marginLeft: 7, fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
    color: "var(--hold)", border: "1px solid rgba(255,176,32,.45)",
    borderRadius: 4, padding: "1px 5px",
  },
  reviewNewTag: {
    marginLeft: 7, fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
    color: "var(--ok)", border: "1px solid rgba(61,220,151,.45)",
    borderRadius: 4, padding: "1px 5px",
  },

  logHeaderBtn: {
    width: "100%", display: "flex", alignItems: "center", background: "none",
    border: "none", borderBottom: "1px solid var(--hair)", color: "var(--ink-2)",
    padding: "12px 14px", fontSize: 12.5, fontWeight: 800, letterSpacing: 0.9,
    cursor: "pointer", textAlign: "left",
  },
  logHeaderCount: { marginLeft: "auto", fontSize: 12, fontWeight: 600, color: "var(--ink-4)" },

  infoDot: {
    display: "inline-flex", alignItems: "center", gap: 6,
    background: "none", border: "none", padding: 0, cursor: "pointer",
    color: "var(--ink-4)", fontSize: 12.5, fontWeight: 600,
  },
  infoGlyph: {
    width: 17, height: 17, borderRadius: "50%",
    border: "1px solid var(--hair-3)", color: "var(--ink-3)",
    fontSize: 11, fontWeight: 800, fontStyle: "italic",
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    flex: "none",
  },
  infoBody: {
    marginTop: 7, fontSize: 13, color: "var(--ink-3)", lineHeight: 1.55,
    borderLeft: "2px solid var(--hair-2)", paddingLeft: 10,
  },

  reliefTag: {
    fontSize: 11, fontWeight: 700, color: "var(--gold)",
    border: "1px solid rgba(233,196,106,.45)", borderRadius: 5, padding: "1px 6px",
  },
  relieveBtn: {
    background: "none", border: "1px solid var(--hair-3)", color: "var(--ink-3)",
    borderRadius: 999, padding: "2px 8px", fontSize: 11.5, fontWeight: 700, cursor: "pointer",
  },

  reliefWait: {
    background: "linear-gradient(180deg,#3A2A05,#241A03)",
    border: "1px solid var(--gold)", borderRadius: 16, padding: 14, marginBottom: 14,
    boxShadow: "0 6px 18px var(--lift)",
  },
  reliefWaitHead: { fontSize: 14.5, fontWeight: 800, color: "var(--hold-3)", letterSpacing: 0.2 },
  reliefWaitBody: { fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6, marginTop: 8 },
  reliefWaitCall: { fontSize: 13, color: "var(--ink-3)", marginTop: 8, fontWeight: 600 },

  ambulancePrompt: {
    background: "linear-gradient(180deg,#123246,#0C2233)",
    border: "1px solid var(--flow)", borderRadius: 14,
    padding: "12px 14px", marginBottom: 10,
    boxShadow: "0 8px 22px var(--lift)",
  },
  ambulancePromptHead: { fontSize: 14, fontWeight: 800, color: "var(--info)", letterSpacing: 0.2 },
  ambulancePromptBody: { fontSize: 13, color: "var(--ink-3)", lineHeight: 1.55, marginTop: 6 },

  kindRow: { display: "flex", gap: 8, marginBottom: 12 },
  kindBtn: {
    flex: 1, minHeight: 48, borderRadius: 999, border: "1px solid",
    background: "none", fontFamily: display, fontSize: 13.5, fontWeight: 700,
    letterSpacing: 0.6, cursor: "pointer",
  },

  needsDetail: {
    marginTop: 10, background: "rgba(233,196,106,.07)",
    border: "1px solid rgba(233,196,106,.5)", borderRadius: 16, padding: "12px 14px",
    boxShadow: "0 6px 18px var(--lift)",
  },
  checkTodayRow: {
    display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
    background: "var(--panel)", border: "1px solid var(--hair)", borderRadius: 10, padding: "8px 11px",
  },
  checkTodayUnit: { fontSize: 13.5, fontWeight: 700, color: "var(--ink)" },
  checkTodayStation: { fontSize: 10.5, color: "var(--ink-4)", marginLeft: 6, fontWeight: 700 },
  checkTodayOk: { fontSize: 12.5, color: "var(--ok)" },
  checkTodayFlag: { fontSize: 12.5, color: "var(--hold)", flex: 1, minWidth: 0 },
  checkTodayMissing: { fontSize: 12.5, color: "var(--crit-2)", fontWeight: 700 },
  checkTodayWho: { fontSize: 12, color: "var(--ink-4)", marginLeft: "auto" },

  oosRefused: {
    marginTop: 10, background: "linear-gradient(180deg,#3A1218,#220A0E)",
    border: "1px solid var(--crit)", borderRadius: 14, padding: 13,
    fontSize: 13.5, color: "var(--crit-2)", lineHeight: 1.5,
  },
  oosRefusedWhy: { fontSize: 14, color: "#FFFFFF", marginTop: 7, fontStyle: "italic" },
  // The one thing that stops the tone, so it is the one thing on the banner
  // that looks like a button.
  standDownBtn: {
    width: "100%", marginTop: 4, padding: "13px 16px", borderRadius: 12,
    background: "#FFFFFF", border: "none", color: "#7F0000",
    fontSize: 15, fontWeight: 800, fontFamily: "inherit", cursor: "pointer",
  },
  // On a call: still there, still where the crew learned it is, plainly not
  // pressable.
  foundEmergencyBtnOff: {
    width: "100%", marginBottom: 12,
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
    background: "var(--inset)", border: "1px solid var(--hair)", color: "var(--ink-4)",
    borderRadius: 14, padding: "13px 16px", fontSize: 14.5, fontWeight: 700,
    fontFamily: "inherit", cursor: "not-allowed",
  },
  foundEmergencyWhy: {
    fontSize: 11, fontWeight: 600, letterSpacing: 0.3, color: "var(--ink-4)",
    textTransform: "uppercase",
  },
  calledOff: {
    background: "var(--crit)", color: "#FFFFFF",
    borderRadius: 16, padding: "16px 18px", marginBottom: 12,
    boxShadow: "0 8px 24px rgba(255,69,58,.32)",
    fontSize: 15, fontWeight: 700,
  },
  calledOffWhat: { fontSize: 19, fontWeight: 700, marginTop: 8 },
  calledOffWhy: { fontSize: 14, marginTop: 6, fontStyle: "italic", color: "rgba(255,255,255,.92)" },
  calledOffWho: { fontSize: 12.5, marginTop: 6, marginBottom: 12, color: "rgba(255,255,255,.78)", fontWeight: 600 },
  oosRefusedAsked: { fontSize: 12.5, color: "var(--ink-3)", marginTop: 6, marginBottom: 10 },

  crewRaiseAsk: {
    background: "color-mix(in srgb, var(--crit) 14%, var(--panel))",
    border: "1px solid color-mix(in srgb, var(--crit) 55%, transparent)",
    borderRadius: 16, padding: 14, marginBottom: 12,
  },
  crewRaiseHead: { fontSize: 15.5, fontWeight: 800, color: "var(--crit)" },
  crewRaiseWhat: { fontSize: 13.5, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.5 },

  oosAsk: {
    background: "linear-gradient(180deg,#2A2410,#181405)",
    border: "1px solid var(--gold)", borderRadius: 16, padding: 14, marginBottom: 12,
    boxShadow: "0 8px 22px rgba(233,196,106,.12)",
  },
  oosAskHead: { fontSize: 15, fontWeight: 800, color: "var(--hold-3)" },
  oosAskWhy: { fontSize: 13.5, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.5 },
  // The room-state strip. Cells divided by a hairline rather than spaced apart,
  // so it reads as one instrument across the top of the board instead of four
  // separate cards — the figures belong to each other.
  // The dock, closed. Sits clear of the footer bar so the two never overlap on
  // a phone, and carries its own count so the badge is readable without opening
  // anything.
  mapWrap: {
    background: "var(--panel)", border: "1px solid var(--hair)",
    borderRadius: 18, overflow: "hidden", marginBottom: 14,
    // Leaflet sets its own z-indexes internally — panes at 400, controls at
    // 800, the corners at 1000 — and those were beating the footer bar at 40,
    // so the map painted straight over the navigation. `isolation` gives the
    // wrapper its own stacking context, which contains every one of them: the
    // map can now only ever stack against itself.
    position: "relative",
    zIndex: 0,
    isolation: "isolate",
  },
  mapHead: {
    display: "flex", alignItems: "baseline", justifyContent: "space-between",
    gap: 10, padding: "13px 15px 11px", borderBottom: "1px solid var(--hair)",
  },
  mapTitle: {
    fontSize: 11.5, fontWeight: 700, letterSpacing: 1.4, color: "var(--ink-4)",
  },
  mapCount: { fontSize: 12, color: "var(--ink-3)" },
  // Tall enough to be worth looking at on a desk, capped so it never eats a
  // phone screen whole.
  mapCanvas: { width: "100%", height: "min(58vh, 520px)", background: "var(--inset)" },
  mapWarn: {
    padding: "10px 15px", fontSize: 12, lineHeight: 1.5, color: "var(--hold-2)",
    borderTop: "1px solid var(--hair)",
  },
  mapList: { padding: "10px 15px 14px", display: "flex", flexDirection: "column", gap: 6 },
  mapRow: {
    display: "flex", alignItems: "baseline", gap: 10, fontSize: 12.5, flexWrap: "wrap",
  },
  mapRowName: { fontWeight: 650, color: "var(--ink)", minWidth: 82 },
  mapRowStatus: { fontSize: 11, fontWeight: 700, letterSpacing: 0.8, minWidth: 96 },
  mapRowAge: { color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" },
  mapRowAgeStale: { color: "var(--hold)", fontWeight: 650, fontVariantNumeric: "tabular-nums" },
  mapRowAcc: { color: "var(--ink-4)", fontVariantNumeric: "tabular-nums" },
  mapRowNoFix: { color: "var(--ink-4)", fontStyle: "italic" },

  consentList: { display: "flex", flexDirection: "column", gap: 10, marginTop: 12 },
  consentRow: {
    background: "var(--raised)", border: "1px solid var(--hair)",
    borderRadius: 14, padding: "11px 13px",
  },
  consentRowHead: { display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" },
  consentRowName: { fontSize: 14, fontWeight: 650, color: "var(--ink)" },
  consentRowId: { fontSize: 11.5, color: "var(--ink-4)", flex: 1, minWidth: 70 },
  consentRowStatus: { fontSize: 10.5, fontWeight: 750, letterSpacing: 0.9 },
  consentRowWhen: { fontSize: 11.5, color: "var(--ink-4)", marginTop: 3 },
  consentRowReason: {
    fontSize: 12.5, fontStyle: "italic", color: "var(--ink-2)", marginTop: 7,
  },
  consentRowAcked: { fontSize: 11, color: "var(--ink-4)", marginTop: 7 },

  consentScrim: {
    position: "fixed", inset: 0, zIndex: 70,
    background: "rgba(4,7,10,.72)", backdropFilter: "blur(6px)",
    display: "flex", alignItems: "center", justifyContent: "center", padding: 18,
  },
  consentSheet: {
    background: "var(--panel)", border: "1px solid var(--hair-2)", borderRadius: 22,
    width: "min(480px, 100%)", maxHeight: "min(86vh, 760px)", overflowY: "auto",
    padding: "20px 22px 22px", boxShadow: "0 24px 64px var(--lift-2)",
  },
  consentEyebrow: {
    fontSize: 10.5, fontWeight: 700, letterSpacing: 1.4, color: "var(--ink-4)", marginBottom: 6,
  },
  consentTitle: {
    fontSize: 19, fontWeight: 650, color: "var(--ink)", lineHeight: 1.3, marginBottom: 15,
  },
  consentBody: { display: "flex", flexDirection: "column", gap: 11, marginBottom: 18 },
  consentPoint: { fontSize: 13, lineHeight: 1.55, color: "var(--ink-2)" },
  consentBtns: { display: "flex", gap: 10, flexWrap: "wrap" },
  consentYes: {
    flex: 1, minWidth: 170, background: "var(--flow)", border: "none", color: "#FFFFFF",
    borderRadius: 13, padding: "15px 16px", fontSize: 15, fontWeight: 700, cursor: "pointer",
  },
  consentNo: {
    background: "var(--raised)", border: "1px solid var(--hair-2)", color: "var(--ink-2)",
    borderRadius: 13, padding: "15px 16px", fontSize: 15, fontWeight: 650, cursor: "pointer",
  },
  consentNoOff: {
    background: "var(--inset)", border: "1px solid var(--hair)", color: "var(--ink-4)",
    borderRadius: 13, padding: "15px 16px", fontSize: 15, fontWeight: 650, cursor: "default",
  },
  consentRefuse: { display: "flex", flexDirection: "column", gap: 9 },
  consentReason: {
    background: "var(--inset)", border: "1px solid var(--hair-2)", borderRadius: 11,
    color: "var(--ink)", padding: "10px 12px", fontSize: 16, fontFamily: "inherit",
    resize: "vertical", lineHeight: 1.45,
  },
  consentNote: { fontSize: 11.5, lineHeight: 1.5, color: "var(--ink-4)" },

  trackBarOn: {
    display: "flex", alignItems: "center", gap: 9, marginBottom: 10,
    padding: "9px 13px", borderRadius: 12, fontSize: 12.5,
    background: "var(--inset)", border: "1px solid var(--hair)", color: "var(--ink-3)",
  },
  trackBarWarn: {
    display: "flex", alignItems: "center", gap: 9, marginBottom: 10,
    padding: "9px 13px", borderRadius: 12, fontSize: 12.5,
    background: "rgba(255,159,10,.12)", border: "1px solid rgba(255,159,10,.34)",
    color: "var(--hold-2)",
  },
  trackBarOff: {
    display: "flex", alignItems: "center", gap: 9, marginBottom: 10,
    padding: "9px 13px", borderRadius: 12, fontSize: 12.5,
    background: "var(--inset)", border: "1px solid var(--hair)", color: "var(--ink-4)",
  },
  trackDotOn: { width: 8, height: 8, borderRadius: 999, background: "var(--ok)", flex: "none" },
  trackDotWarn: { width: 8, height: 8, borderRadius: 999, background: "var(--hold)", flex: "none" },
  trackDotOff: { width: 8, height: 8, borderRadius: 999, background: "var(--ink-4)", flex: "none" },

  otRange: {
    display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap",
    marginBottom: 14,
  },
  otRangeField: { display: "flex", flexDirection: "column", gap: 5 },
  otRangeLabel: {
    fontSize: 10, fontWeight: 700, letterSpacing: 1.1, color: "var(--ink-4)",
  },
  otDate: {
    background: "var(--inset)", border: "1px solid var(--hair-2)", borderRadius: 10,
    color: "var(--ink)", padding: "8px 10px", fontSize: 16, fontFamily: "inherit",
  },
  otTotals: {
    display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: 1, background: "var(--hair)", border: "1px solid var(--hair)",
    borderRadius: 14, overflow: "hidden", marginBottom: 14,
  },
  otTotal: {
    background: "var(--panel)", padding: "12px 14px",
    display: "flex", flexDirection: "column", gap: 4,
  },
  otTotalFig: {
    fontSize: 21, fontWeight: 700, letterSpacing: -0.5, color: "var(--ok)",
    fontVariantNumeric: "tabular-nums",
  },
  otTotalLabel: { fontSize: 10.5, fontWeight: 700, letterSpacing: 1, color: "var(--ink-4)" },

  otLiveWrap: {
    background: "var(--inset)", border: "1px solid var(--hair)",
    borderLeft: "3px solid var(--hold)", borderRadius: 14,
    padding: "12px 13px", marginBottom: 14,
  },
  otLiveRow: {
    display: "flex", alignItems: "center", gap: 10, padding: "5px 0",
    fontSize: 12.5, flexWrap: "wrap",
  },
  otLiveName: { fontWeight: 650, color: "var(--ink-2)", minWidth: 110 },
  otLiveUnit: { color: "var(--ink-4)", flex: 1, minWidth: 110 },
  otLiveMs: {
    fontWeight: 700, color: "var(--hold)", fontVariantNumeric: "tabular-nums", minWidth: 62,
  },
  otGrantBtn: {
    background: "var(--inset-2)", border: "1px solid var(--hair-2)", color: "var(--ink-2)",
    borderRadius: 999, padding: "5px 12px", fontSize: 11.5, fontWeight: 650, cursor: "pointer",
  },
  otLiveNote: {
    marginTop: 9, paddingTop: 9, borderTop: "1px solid var(--hair)",
    fontSize: 11.5, lineHeight: 1.5, color: "var(--ink-4)",
  },

  otList: { display: "flex", flexDirection: "column", gap: 10 },
  otCard: {
    background: "var(--raised)", border: "1px solid var(--hair)",
    borderRadius: 14, padding: "12px 13px",
  },
  otCardPending: {
    background: "var(--raised)", border: "1px solid var(--hair)",
    borderLeft: "3px solid var(--hold)", borderRadius: 14, padding: "12px 13px",
  },
  otCardHead: {
    display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap", marginBottom: 5,
  },
  otCardName: { fontSize: 14.5, fontWeight: 650, color: "var(--ink)" },
  otCardWho: { fontSize: 12, color: "var(--ink-4)", flex: 1, minWidth: 130 },
  otCardStatus: { fontSize: 10.5, fontWeight: 750, letterSpacing: 0.9 },
  otCardMeta: { fontSize: 11.5, color: "var(--ink-4)", marginBottom: 7 },
  otCardFigures: {
    display: "flex", gap: 12, flexWrap: "wrap", alignItems: "baseline", marginBottom: 4,
  },
  otClaimed: { fontSize: 15, fontWeight: 700, color: "var(--ink)", fontVariantNumeric: "tabular-nums" },
  otApproved: { fontSize: 13.5, fontWeight: 650, color: "var(--ok)", fontVariantNumeric: "tabular-nums" },
  otHeld: { fontSize: 11.5, fontWeight: 650, color: "var(--flow-2)" },
  otNotHeld: { fontSize: 11.5, color: "var(--ink-4)" },
  otCardNote: { fontSize: 12.5, fontStyle: "italic", color: "var(--ink-3)", marginTop: 6 },
  otCardBy: { fontSize: 11, color: "var(--ink-4)", marginTop: 5 },
  otCardBtns: { display: "flex", gap: 8, marginTop: 11, flexWrap: "wrap" },

  invShortHead: {
    fontSize: 10.5, fontWeight: 700, letterSpacing: 1.3,
    color: "var(--ink-4)", marginBottom: 9,
  },

  invNameInput: {
    flex: 1, minWidth: 180, background: "var(--inset)", border: "1px solid var(--hair-2)",
    borderRadius: 10, color: "var(--ink)", padding: "10px 12px", fontSize: 16,
    fontFamily: "inherit",
  },

  // ---- the policy shelf ----
  policyPage: {
    background: "var(--panel)", border: "1px solid var(--hair)", borderRadius: 20,
    padding: "18px 18px 20px",
  },
  policyPageHead: {
    display: "flex", alignItems: "flex-start", justifyContent: "space-between",
    gap: 12, flexWrap: "wrap", marginBottom: 16,
  },
  policySize: {
    fontSize: 10, fontWeight: 700, color: "var(--ink-4)", flex: "none", marginLeft: 2,
  },
  shelfNote: {
    fontSize: 11.5, lineHeight: 1.5, color: "var(--ink-4)", marginBottom: 10,
  },
  shelfWarn: {
    fontSize: 12, lineHeight: 1.55, color: "var(--ink)", marginBottom: 10,
    background: "rgba(255,159,10,.12)", border: "1px solid rgba(255,159,10,.45)",
    borderRadius: 12, padding: "9px 12px",
  },
  policyAddRow: {
    display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
    background: "var(--inset)", border: "1px solid var(--hair)",
    borderRadius: 14, padding: 10, marginBottom: 14,
  },
  policyNameInput: {
    flex: 1, minWidth: 180, background: "var(--ground)", color: "var(--ink)",
    border: "1px solid var(--hair-2)", borderRadius: 10,
    padding: "9px 12px", fontSize: 16, fontFamily: "inherit", outline: "none",
  },
  policyAdd: {
    background: "var(--inset-2)", border: "1px solid var(--hair-3)", color: "var(--ink)",
    borderRadius: 999, padding: "9px 16px", fontSize: 13, fontWeight: 650,
    cursor: "pointer", flex: "none",
  },
  policyAddOff: {
    background: "var(--inset)", border: "1px solid var(--hair)", color: "var(--ink-4)",
    borderRadius: 999, padding: "9px 16px", fontSize: 13, fontWeight: 650,
    cursor: "default", flex: "none",
  },
  policyGrid: { display: "flex", flexDirection: "column", gap: 1, background: "var(--hair)",
    border: "1px solid var(--hair)", borderRadius: 14, overflow: "hidden" },
  policyItemName: { display: "flex", alignItems: "center", gap: 10, minWidth: 0 },
  policyKind: {
    fontSize: 9.5, fontWeight: 800, letterSpacing: 0.8, color: "var(--ink-4)",
    border: "1px solid var(--hair-2)", borderRadius: 5, padding: "2px 5px", flex: "none",
  },
  policyViewer: {
    background: "var(--inset)", padding: "12px 14px 14px",
    display: "flex", flexDirection: "column", gap: 10,
  },
  policyImage: {
    width: "100%", maxHeight: "70vh", objectFit: "contain",
    borderRadius: 10, background: "#FFFFFF",
  },
  // Tall enough to actually read a page of A4 rather than peer at a strip.
  policyPdf: { width: "100%", height: "min(72vh, 780px)", border: "none", borderRadius: 10 },
  policyNoView: { fontSize: 13, lineHeight: 1.6, color: "var(--ink-3)", padding: "18px 4px" },
  policyMeta: {
    fontSize: 11.5, color: "var(--ink-4)", display: "flex", alignItems: "center",
    gap: 12, flexWrap: "wrap",
  },
  policyRemove: {
    marginLeft: "auto", background: "none", border: "1px solid var(--hair-2)",
    color: "var(--crit-2)", borderRadius: 999, padding: "4px 12px",
    fontSize: 11.5, cursor: "pointer",
  },

  // ---- inventory, admin side ----
  //
  // One line per item. The old rows were a name, a full-width bar, a sentence
  // and three buttons — about 90px each, so a shelf of thirty items was a
  // three-thousand-pixel scroll. These are 34.
  // Categories are cards, laid out like the call cards on the board, so many
  // of them fit across a screen instead of one per full-width block.
  catGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(232px, 1fr))",
    gap: 10,
    marginTop: 10,
  },
  catCard: {
    background: "var(--raised)",
    border: "1px solid var(--hair)",
    boxShadow: "0 6px 18px var(--lift)",
    borderRadius: 16,
    padding: "9px 10px 8px",
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  catCardHead: {
    display: "flex", alignItems: "baseline", gap: 8,
    paddingBottom: 6, borderBottom: "1px solid var(--hair)", marginBottom: 2,
  },
  catCardName: {
    fontSize: 12.5, fontWeight: 800, letterSpacing: 0.2, color: "var(--ink)",
    minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  catCardCount: {
    marginLeft: "auto", fontSize: 10.5, fontWeight: 700, color: "var(--ink-4)",
    background: "var(--inset)", borderRadius: 999, padding: "0 7px", flex: "none",
  },
  catCardEmpty: { fontSize: 11, color: "var(--ink-4)", padding: "6px 2px" },

  // One item. Twenty-four pixels: name, a short bar, the percentage.
  tinyRow: { display: "flex", alignItems: "center", gap: 2, minWidth: 0 },
  tinyTap: {
    flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 7,
    background: "none", border: "none", color: "var(--ink-2)",
    padding: "4px 0", cursor: "pointer", textAlign: "left", font: "inherit",
  },
  tinyName: {
    fontSize: 11.5, flex: 1, minWidth: 0,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  tinyBarTrack: {
    width: 34, height: 3, flex: "none", borderRadius: 999,
    background: "var(--hair)", overflow: "hidden", display: "block",
  },
  tinyBarFill: { display: "block", height: "100%", borderRadius: 999 },
  tinyPct: {
    fontSize: 10.5, fontWeight: 800, width: 30, textAlign: "right", flex: "none",
    fontVariantNumeric: "tabular-nums",
  },
  tinyMore: {
    background: "none", border: "none", color: "var(--ink-4)",
    fontSize: 13, lineHeight: 1, padding: "3px 3px", cursor: "pointer", flex: "none",
  },
  tinyManage: {
    display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap",
    padding: "0 0 6px 0",
  },
  tinyManageNote: { fontSize: 10, color: "var(--ink-4)", width: "100%" },
  catCardFoot: {
    display: "flex", gap: 5, flexWrap: "wrap", marginTop: 7,
    paddingTop: 7, borderTop: "1px solid var(--veil)",
  },
  catCardAdd: {
    background: "var(--inset-2)", border: "1px solid var(--hair-2)", color: "var(--ink-3)",
    borderRadius: 999, padding: "2px 10px", fontSize: 10.5, fontWeight: 700,
    cursor: "pointer", fontFamily: "inherit",
  },
  catTools: { marginLeft: "auto", display: "flex", gap: 6 },
  catTool: {
    background: "none", border: "1px solid var(--hair-2)", color: "var(--ink-4)",
    borderRadius: 999, padding: "2px 9px", fontSize: 10.5, fontWeight: 700,
    cursor: "pointer", fontFamily: "inherit",
  },
  itemAddRow: { display: "flex", gap: 6, alignItems: "center", marginTop: 8, flexWrap: "wrap" },
  itemAddInput: {
    flex: 1, minWidth: 130, background: "var(--ground)", color: "var(--ink)",
    border: "1px solid var(--hair-2)", borderRadius: 9,
    padding: "7px 10px", fontSize: 16, fontFamily: "inherit", outline: "none",
  },

  // ---- restock, crew side: a tick-list ----
  // The queue of calls the truck has not been made up after. Amber, because it
  // is a job outstanding rather than an emergency.
  restockNudge: {
    width: "100%", display: "flex", alignItems: "center", gap: 12,
    background: "rgba(255,159,10,.11)", border: "1px solid rgba(255,159,10,.45)",
    borderRadius: 16, padding: "13px 14px", marginBottom: 12,
    cursor: "pointer", textAlign: "left", fontFamily: "inherit", color: "var(--ink)",
  },
  restockNudgeCount: {
    width: 34, height: 34, borderRadius: 999, flex: "none",
    background: "var(--crit)", color: "#fff",
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    fontSize: 15, fontWeight: 800,
  },
  restockNudgeBody: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 },
  restockNudgeTitle: { fontSize: 15, fontWeight: 750, color: "var(--hold)" },
  restockNudgeSub: { fontSize: 12, color: "var(--ink-4)", lineHeight: 1.4 },
  restockQueue: {
    border: "1px solid rgba(255,159,10,.34)",
    background: "rgba(255,159,10,.06)",
    borderRadius: 16, padding: "12px 12px 14px", marginBottom: 16,
  },
  restockQueueHead: { display: "flex", alignItems: "center", gap: 8 },
  restockQueueTitle: {
    fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: "var(--hold)",
  },
  restockQueueCount: {
    background: "var(--crit)", color: "#fff", borderRadius: 999,
    padding: "1px 9px", fontSize: 11.5, fontWeight: 800,
  },
  restockQueueNote: {
    fontSize: 11.5, lineHeight: 1.55, color: "var(--ink-4)", marginTop: 6,
  },
  restockWhen: {
    fontSize: 11.5, color: "var(--ink-4)", marginTop: 2, marginBottom: 4,
  },
  restockDoneBtn: {
    width: "100%", marginTop: 14, padding: "12px 16px", borderRadius: 12,
    background: "var(--ok)", border: "none", color: "var(--ground)",
    fontSize: 14.5, fontWeight: 800, fontFamily: "inherit", cursor: "pointer",
  },
  todoCat: { marginTop: 10 },
  todoCatHead: {
    display: "flex", alignItems: "center", gap: 7, width: "100%",
    background: "none", border: "none", color: "var(--ink-3)",
    padding: "5px 2px", cursor: "pointer", textAlign: "left", font: "inherit",
    fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase",
  },
  todoCatChev: { fontSize: 10, color: "var(--ink-4)", flex: "none" },
  todoCatName: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  todoCatTally: {
    marginLeft: "auto", background: "var(--ok)", color: "var(--ground)",
    borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 800,
  },
  todoRow: {
    display: "flex", alignItems: "center", gap: 6,
    borderTop: "1px solid var(--veil)",
  },
  todoRowOn: {
    display: "flex", alignItems: "center", gap: 6,
    borderTop: "1px solid var(--veil)", background: "rgba(48,209,88,.08)",
  },
  // A big target. This is tapped in the back of an ambulance, standing up.
  todoTap: {
    flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 11,
    background: "none", border: "none", color: "var(--ink)",
    padding: "11px 4px", cursor: "pointer", textAlign: "left", font: "inherit",
  },
  todoBox: {
    width: 21, height: 21, borderRadius: 6, flex: "none",
    border: "1.5px solid var(--hair-3)", display: "inline-block",
  },
  todoBoxOn: {
    width: 21, height: 21, borderRadius: 6, flex: "none",
    border: "1.5px solid var(--ok)", background: "var(--ok)", color: "var(--ground)",
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    fontSize: 13, fontWeight: 900,
  },
  todoName: {
    fontSize: 14, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  todoNameOn: {
    fontSize: 14, fontWeight: 650, minWidth: 0,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  todoQtyWrap: { display: "flex", alignItems: "center", gap: 2, flex: "none", paddingRight: 2 },
  todoStep: {
    width: 30, height: 30, borderRadius: 8, flex: "none",
    background: "var(--inset-2)", border: "1px solid var(--hair-2)", color: "var(--ink)",
    fontSize: 16, lineHeight: 1, cursor: "pointer", fontFamily: "inherit",
  },
  todoQty: {
    minWidth: 22, textAlign: "center", fontSize: 14, fontWeight: 800,
    fontVariantNumeric: "tabular-nums",
  },
  todoFoot: {
    marginTop: 12, fontSize: 12, color: "var(--ink-4)", lineHeight: 1.5,
  },

  stockAdd: { marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--hair)" },
  stockAddRow: { display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" },

  // The crew's side: one tap per item, sized for a gloved thumb.

  resetList: { display: "flex", flexDirection: "column", gap: 8, marginTop: 10 },
  resetRow: {
    display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
    background: "rgba(255,159,10,.08)", border: "1px solid rgba(255,159,10,.34)",
    borderRadius: 12, padding: "10px 12px",
  },
  resetName: { fontSize: 14, fontWeight: 700, color: "var(--ink)" },
  resetId: { fontSize: 12, fontWeight: 600, color: "var(--ink-4)", marginLeft: 6 },
  resetWhen: { fontSize: 11.5, color: "var(--ink-4)", marginTop: 3 },
  invMovesWrap: { marginTop: 18 },
  invMoveRow: {
    display: "flex", alignItems: "baseline", gap: 10, padding: "6px 0",
    borderBottom: "1px solid var(--hair)", fontSize: 12.5, flexWrap: "wrap",
  },
  invMoveDelta: {
    fontWeight: 800, minWidth: 34, fontVariantNumeric: "tabular-nums",
  },
  invMoveItem: { color: "var(--ink-2)", minWidth: 130 },
  invMoveWho: { color: "var(--ink-4)", flex: 1, minWidth: 140 },
  invMoveWhen: { color: "var(--ink-4)", fontVariantNumeric: "tabular-nums" },


  // The floating shape: anchored above the bottom bar, never taller than the
  // screen it is floating over.
  chatFloatWrap: {
    position: "fixed",
    left: 12,
    right: 12,
    bottom: "calc(140px + env(safe-area-inset-bottom))",
    zIndex: 1204,
    display: "flex",
    justifyContent: "flex-start",
    pointerEvents: "none",
  },
  chatPanelFloat: {
    pointerEvents: "auto",
    width: "min(420px, 100%)",
    height: "min(460px, calc(100vh - 300px))",
    background: "var(--panel)",
    border: "1px solid var(--hair-2)",
    borderRadius: 20,
    boxShadow: "0 24px 64px var(--lift-2)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  chatLauncher: {
    position: "fixed",
    left: 16,
    bottom: "calc(86px + env(safe-area-inset-bottom))",
    zIndex: 1205,
    display: "inline-flex", alignItems: "center", gap: 7,
    background: "var(--bar)",
    backdropFilter: "blur(18px) saturate(140%)",
    WebkitBackdropFilter: "blur(18px) saturate(140%)",
    border: "1px solid var(--veil-2)",
    color: "var(--ink-2)", borderRadius: 999,
    padding: "12px 18px", fontSize: 13.5, fontWeight: 700,
    cursor: "pointer", boxShadow: "0 12px 30px var(--lift-2)",
    // No overflow:hidden here. The unread badge is positioned outside the
    // pill's own box on purpose, and clipping the pill clipped the badge with
    // it - a red crescent bitten out of the corner with the number invisible,
    // which is the one thing on it worth reading. The label does its own
    // truncating, so nothing needs the pill to clip.
    maxWidth: "52vw",
  },
  chatLauncherHot: {
    position: "fixed",
    left: 16,
    bottom: "calc(86px + env(safe-area-inset-bottom))",
    zIndex: 1205,
    display: "inline-flex", alignItems: "center", gap: 7,
    background: "linear-gradient(180deg,#1D4E8F,#0A2F5E)",
    border: "1px solid rgba(255,255,255,.18)",
    color: "#FFFFFF", borderRadius: 999,
    padding: "12px 18px", fontSize: 13.5, fontWeight: 750,
    cursor: "pointer", boxShadow: "0 12px 30px rgba(10,47,94,.5)",
    maxWidth: "52vw",
  },
  chatLauncherOn: {
    position: "fixed",
    left: 16,
    bottom: "calc(86px + env(safe-area-inset-bottom))",
    zIndex: 1205,
    display: "inline-flex", alignItems: "center", gap: 7,
    background: "var(--raised)",
    border: "1px solid var(--hair-3)",
    color: "var(--ink)", borderRadius: 999,
    padding: "12px 18px", fontSize: 13.5, fontWeight: 700,
    cursor: "pointer", boxShadow: "0 12px 30px var(--lift-2)",
  },
  chatLauncherLabel: {
    // minWidth:0 is what lets a flex child actually shrink far enough for its
    // own ellipsis to engage; without it the label refuses to shrink and pushes
    // the pill past its maxWidth instead.
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0,
  },
  // Above the pill, not inside it.
  chatLauncherBadge: {
    position: "absolute",
    top: -9,
    right: -6,
    minWidth: 22,
    height: 22,
    borderRadius: 999,
    background: "var(--crit)",
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: 800,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 6px",
    border: "2px solid var(--ground)",
    boxShadow: "0 4px 12px rgba(255,69,58,.5)",
  },
  chatThreadHot: {
    background: "rgba(10,132,255,.16)",
    border: "1px solid rgba(10,132,255,.55)",
    color: "var(--ink)",
    borderRadius: 999, padding: "6px 12px", fontSize: 12.5, fontWeight: 800,
    cursor: "pointer", flex: "none", display: "inline-flex", alignItems: "center", gap: 6,
  },
  chatPanel: {
    width: "100%",
    height: "min(620px, calc(100vh - 260px))",
    background: "var(--panel)",
    border: "1px solid var(--hair-2)",
    borderRadius: 20,
    boxShadow: "0 24px 64px var(--lift-2)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  chatHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "12px 14px",
    borderBottom: "1px solid var(--hair)",
  },
  chatHeadTitle: {
    display: "flex", alignItems: "center", gap: 8,
    fontSize: 14.5, fontWeight: 650, color: "var(--ink)",
  },
  chatShiftNote: {
    fontSize: 10.5, fontWeight: 700, letterSpacing: 1, color: "var(--ink-4)",
  },
  chatThreads: {
    display: "flex", gap: 6, padding: "9px 12px", overflowX: "auto",
    borderBottom: "1px solid var(--hair)",
  },
  chatThread: {
    background: "var(--inset)", border: "1px solid var(--hair)", color: "var(--ink-3)",
    borderRadius: 999, padding: "6px 12px", fontSize: 12, fontWeight: 600,
    cursor: "pointer", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6,
  },
  chatThreadOn: {
    background: "var(--inset-2)", border: "1px solid var(--hair-3)", color: "var(--ink)",
    borderRadius: 999, padding: "6px 12px", fontSize: 12, fontWeight: 700,
    cursor: "pointer", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6,
  },
  chatThreadBadge: {
    background: "var(--crit)", color: "#FFFFFF", borderRadius: 999,
    padding: "0 5px", fontSize: 10.5, fontWeight: 800,
  },
  chatLog: {
    flex: 1, overflowY: "auto", padding: "12px 13px",
    display: "flex", flexDirection: "column", gap: 11,
  },
  chatEmpty: {
    fontSize: 12.5, lineHeight: 1.6, color: "var(--ink-4)",
    margin: "auto 0", textAlign: "center", padding: "0 8px",
  },
  chatRowMine: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 },
  chatRowTheirs: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3 },
  chatBubbleMine: {
    background: "var(--flow)", color: "#FFFFFF", borderRadius: "14px 14px 4px 14px",
    padding: "9px 12px", fontSize: 13.5, lineHeight: 1.45, maxWidth: "88%",
    whiteSpace: "pre-wrap", wordBreak: "break-word",
  },
  chatBubbleTheirs: {
    background: "var(--raised)", border: "1px solid var(--hair)", color: "var(--ink)",
    borderRadius: "14px 14px 14px 4px", padding: "9px 12px", fontSize: 13.5,
    lineHeight: 1.45, maxWidth: "88%", whiteSpace: "pre-wrap", wordBreak: "break-word",
  },
  chatMeta: { fontSize: 10.5, color: "var(--ink-4)", padding: "0 3px" },
  chatCompose: {
    display: "flex", gap: 8, padding: "10px 12px 12px",
    borderTop: "1px solid var(--hair)", alignItems: "flex-end",
  },
  soundDiag: {
    marginTop: 6,
    fontSize: 10.5,
    color: "var(--ink-4)",
    letterSpacing: ".02em",
    fontVariantNumeric: "tabular-nums",
  },
  chatInput: {
    flex: 1, background: "var(--inset)", border: "1px solid var(--hair-2)",
    borderRadius: 12, color: "var(--ink)", padding: "9px 11px", fontSize: 16,
    fontFamily: "inherit", resize: "none", lineHeight: 1.4,
  },
  chatSend: {
    background: "var(--flow)", border: "none", color: "#FFFFFF", borderRadius: 12,
    padding: "11px 15px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", flex: "none",
  },
  chatSendOff: {
    background: "var(--inset)", border: "1px solid var(--hair)", color: "var(--ink-4)",
    borderRadius: 12, padding: "11px 15px", fontSize: 13.5, fontWeight: 700,
    cursor: "default", flex: "none",
  },

  callProgress: { display: "flex", gap: 3, marginTop: 10, marginBottom: 2 },
  callProgressSeg: { flex: 1, height: 3, borderRadius: 999 },

  stepper: { display: "flex", flexDirection: "column", marginTop: 12 },
  stepperCompact: { display: "flex", flexDirection: "column", marginTop: 8 },
  stepperRow: { display: "flex", alignItems: "stretch", gap: 13 },
  stepperRail: { display: "flex", flexDirection: "column", alignItems: "center", width: 24, flex: "none" },
  stepperDot: {
    width: 24, height: 24, borderRadius: 999, flex: "none",
    border: "2px solid", display: "flex", alignItems: "center",
    justifyContent: "center", boxSizing: "border-box",
  },
  stepperTick: { color: "var(--ground)", fontSize: 12, fontWeight: 900, lineHeight: 1 },
  stepperPip: { width: 8, height: 8, borderRadius: 999, background: "var(--flow)" },
  stepperLine: { width: 2, flex: 1, minHeight: 16 },
  stepperText: {
    flex: 1, display: "flex", alignItems: "baseline",
    justifyContent: "space-between", gap: 10, paddingBottom: 14,
  },
  stepperTextLast: {
    flex: 1, display: "flex", alignItems: "baseline",
    justifyContent: "space-between", gap: 10,
  },
  stepperLabel: { fontSize: 14 },
  stepperTime: { fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums" },

  roomState: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))",
    gap: 1,
    background: "var(--hair)",
    border: "1px solid var(--hair)",
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 12,
  },
  roomCell: {
    background: "var(--panel)",
    padding: "13px 16px",
    display: "flex",
    alignItems: "baseline",
    gap: 9,
    flexWrap: "wrap",
  },
  roomCellWide: {
    background: "var(--panel)",
    padding: "13px 16px",
    display: "flex",
    alignItems: "baseline",
    gap: 9,
    flexWrap: "wrap",
    gridColumn: "span 1",
  },
  // Read from across a control room. Tabular figures so the numbers do not
  // shuffle sideways every time one of them ticks over.
  roomFigure: {
    fontSize: 30,
    fontWeight: 650,
    letterSpacing: -1,
    lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
  },
  roomLabel: {
    fontSize: 11.5,
    fontWeight: 650,
    letterSpacing: 1.1,
    color: "var(--ink-3)",
  },
  roomAside: {
    fontSize: 11.5,
    color: "var(--ink-4)",
    marginLeft: "auto",
    fontVariantNumeric: "tabular-nums",
  },

  policyBtn: {
    background: "var(--raised)", border: "1px solid var(--hair-2)",
    color: "var(--ink-3)", borderRadius: 999, padding: "8px 15px",
    fontSize: 12.5, fontWeight: 650, cursor: "pointer",
    display: "inline-flex", alignItems: "center", gap: 7, marginLeft: 8,
  },
  policyScrim: {
    position: "fixed", inset: 0, zIndex: 60,
    background: "rgba(4,7,10,.62)", backdropFilter: "blur(6px)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: 18,
  },
  policySheet: {
    background: "var(--panel)", border: "1px solid var(--hair-2)",
    borderRadius: 22, width: "min(620px, 100%)", maxHeight: "min(78vh, 760px)",
    display: "flex", flexDirection: "column",
    boxShadow: "0 24px 64px var(--lift-2)", overflow: "hidden",
  },
  policyHead: {
    display: "flex", alignItems: "flex-start", justifyContent: "space-between",
    gap: 12, padding: "18px 20px 14px", borderBottom: "1px solid var(--hair)",
  },
  policyEyebrow: {
    fontSize: 10.5, fontWeight: 700, letterSpacing: 1.5,
    color: "var(--ink-4)", marginBottom: 4,
  },
  policyTitle: { fontSize: 17, fontWeight: 650, color: "var(--ink)" },
  policyClose: {
    background: "none", border: "1px solid var(--hair-2)", color: "var(--ink-3)",
    borderRadius: 999, width: 30, height: 30, cursor: "pointer",
    fontSize: 13, lineHeight: 1, flex: "none",
  },
  policyBody: { overflowY: "auto", padding: "8px 12px 12px" },
  policyItem: { borderBottom: "1px solid var(--hair)" },
  policyItemHead: {
    width: "100%", background: "none", border: "none", cursor: "pointer",
    color: "var(--ink)", fontSize: 14.5, fontWeight: 600, textAlign: "left",
    padding: "14px 8px", display: "flex", alignItems: "center",
    justifyContent: "space-between", gap: 10,
  },
  policyChevron: { color: "var(--ink-4)", fontSize: 17, fontWeight: 400 },
  policyText: {
    padding: "0 8px 15px", fontSize: 13.5, lineHeight: 1.6,
    color: "var(--ink-2)", whiteSpace: "pre-wrap",
  },
  policyEmpty: { color: "var(--ink-4)", fontStyle: "italic" },
  policyFoot: {
    padding: "12px 20px 15px", borderTop: "1px solid var(--hair)",
    fontSize: 11.5, color: "var(--ink-4)", lineHeight: 1.5,
  },
  dayBookWrap: {
    marginTop: 14, background: "var(--inset)", border: "1px solid var(--hair)",
    borderRadius: 14, padding: "12px 13px",
  },
  dayBookEmpty: {
    marginTop: 14, fontSize: 12.5, color: "var(--ink-4)",
    background: "var(--inset)", border: "1px solid var(--hair)",
    borderRadius: 14, padding: "12px 13px",
  },
  dayBookHead: {
    fontSize: 11, fontWeight: 700, letterSpacing: 1.1, textTransform: "uppercase",
    color: "var(--ink-4)", display: "flex", justifyContent: "space-between",
    alignItems: "baseline", gap: 8, marginBottom: 9, flexWrap: "wrap",
  },
  dayBookCount: { letterSpacing: 0, textTransform: "none", fontWeight: 600 },
  dayBookList: { display: "flex", flexDirection: "column", gap: 5 },
  dayBookRow: {
    display: "flex", alignItems: "baseline", gap: 9, padding: "5px 7px",
    borderRadius: 8, fontSize: 12.5,
  },
  dayBookRowNear: {
    display: "flex", alignItems: "baseline", gap: 9, padding: "5px 7px",
    borderRadius: 8, fontSize: 12.5, background: "var(--inset-2)",
  },
  dayBookTime: {
    fontWeight: 700, color: "var(--ink-2)", minWidth: 44,
    fontVariantNumeric: "tabular-nums",
  },
  dayBookTimeNear: {
    fontWeight: 700, color: "var(--hold)", minWidth: 44,
    fontVariantNumeric: "tabular-nums",
  },
  dayBookWhat: { color: "var(--ink-2)", flex: 1, minWidth: 0 },
  dayBookRoute: { color: "var(--ink-4)" },
  dayBookFlag: {
    fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: "var(--hold)",
    whiteSpace: "nowrap",
  },
  dayBookWarn: {
    marginTop: 10, fontSize: 12, lineHeight: 1.5, color: "var(--hold-2)",
    borderTop: "1px solid var(--hair)", paddingTop: 9,
  },
  oosOffRun: {
    background: "var(--raised)", border: "1px solid var(--hair)",
    borderLeft: "3px solid var(--ink-4)", borderRadius: 14,
    padding: "11px 13px", marginBottom: 10,
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: 12, flexWrap: "wrap",
  },
  oosOffRunHead: { fontSize: 13.5, fontWeight: 600, color: "var(--ink-2)" },
  oosAskWho: { fontSize: 12, color: "var(--ink-3)" },

  foundEmergencyBtn: {
    width: "100%", minHeight: 54, marginBottom: 10,
    background: "color-mix(in srgb, var(--crit) 16%, var(--panel))",
    border: "1px solid color-mix(in srgb, var(--crit) 55%, transparent)",
    borderRadius: 16, color: "var(--crit)", fontFamily: display,
    fontSize: 15.5, fontWeight: 700, cursor: "pointer", letterSpacing: -0.2,
  },

  oosPending: {
    marginTop: 10, background: "rgba(255,176,32,.08)",
    border: "1px solid rgba(255,176,32,.4)", borderRadius: 12,
    padding: "10px 12px", fontSize: 13, color: "var(--hold-3)", lineHeight: 1.5,
  },
  oosCancel: {
    marginLeft: 8, background: "none", border: "none", color: "var(--ink-3)",
    fontSize: 12.5, fontWeight: 700, cursor: "pointer", textDecoration: "underline",
  },
  oosForm: {
    marginTop: 10, background: "var(--panel)", border: "1px solid var(--hair-2)",
    borderRadius: 14, padding: 12,
  },
  oosFormHead: { fontSize: 11.5, fontWeight: 800, letterSpacing: 0.6, color: "var(--gold)" },

  checkOpenBtn: {
    background: "none", border: "1px dashed var(--hair-3)", color: "var(--ink-3)",
    borderRadius: 999, padding: "8px 14px", fontSize: 13, fontWeight: 700,
    cursor: "pointer", whiteSpace: "nowrap",
  },
  // An optional list reads as an offer, not a demand: quieter than the
  // mandatory one, so a crew can tell at a glance which one they owe.
  // ---------- backups ----------
  backupGrid: {
    display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 10, margin: "4px 0 12px",
  },
  backupCell: {
    display: "flex", flexDirection: "column", gap: 3,
    background: "var(--panel-2)", border: "1px solid var(--hair-2)",
    borderRadius: 12, padding: "11px 13px",
  },
  backupLabel: {
    fontSize: 10.5, fontWeight: 800, letterSpacing: 1, color: "var(--ink-4)",
    textTransform: "uppercase",
  },
  backupValue: { fontSize: 19, fontWeight: 800, color: "var(--ink)", lineHeight: 1.2 },
  backupNote: {
    fontSize: 12, lineHeight: 1.55, color: "var(--ink-4)", wordBreak: "break-word",
    margin: "4px 0 0",
  },
  backupActions: {
    display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, margin: "10px 0 0",
  },
  backupDownload: {
    display: "flex", flexDirection: "column", gap: 2,
    borderTop: "1px solid var(--hair-2)", margin: "14px 0 0", padding: "12px 0 0",
  },
  // Said under a form that has refused, beside the boxes marked with
  // inputMissing above. The mark says which box; this says what to do. Neither
  // is any use alone.
  requiredNote: {
    fontSize: 12.5, lineHeight: 1.5, color: "var(--crit)", fontWeight: 600,
    margin: "8px 0 0",
  },
  checkOwingRow: {
    fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-3)",
    background: "rgba(240,180,60,.07)", border: "1px solid rgba(240,180,60,.28)",
    borderRadius: 10, padding: "8px 11px", margin: "0 0 10px",
  },
  checkOptionalBtn: {
    background: "none", border: "1px dashed var(--hair-2)", color: "var(--ink-4)",
    borderRadius: 999, padding: "8px 14px", fontSize: 12.5, fontWeight: 600,
    cursor: "pointer", whiteSpace: "nowrap",
  },
  checkDoneTag: {
    display: "inline-flex", alignItems: "center", gap: 5,
    fontSize: 12.5, fontWeight: 700, color: "var(--ok)",
    border: "1px solid rgba(61,220,151,.4)", background: "rgba(61,220,151,.08)",
    borderRadius: 999, padding: "6px 12px", whiteSpace: "nowrap",
  },
  checkCard: {
    background: "var(--panel)", border: "1px solid var(--hair-2)", borderRadius: 16,
    padding: 12, marginTop: 10,
    boxShadow: "0 6px 18px var(--lift)",
  },
  checkHead: {
    display: "flex", alignItems: "baseline", gap: 8,
    fontSize: 12.5, fontWeight: 800, color: "var(--gold)", letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  checkCount: { marginLeft: "auto", fontSize: 12, fontWeight: 600, color: "var(--ink-4)" },
  // The key, once, at the top of the card.
  checkKey: {
    display: "flex", gap: 12, flexWrap: "wrap",
    padding: "8px 2px 10px", fontSize: 10.5, color: "var(--ink-4)",
  },
  checkKeyItem: { display: "inline-flex", alignItems: "center", gap: 5 },
  checkKeyDot: { width: 8, height: 8, borderRadius: 3, display: "inline-block", flex: "none" },

  // A line the crew type into. The label sits above the box: a reading needs
  // the width, and there is no honest way to fit a text field beside a long
  // label at 390px.
  checkWriteRow: {
    borderTop: "1px solid var(--veil)", padding: "7px 0 8px",
    display: "flex", flexDirection: "column", gap: 6,
  },
  checkWriteLabel: {
    fontSize: 13, lineHeight: 1.35, color: "var(--ink-2)",
    display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap",
  },
  checkWriteTag: {
    fontSize: 8.5, fontWeight: 800, letterSpacing: 0.7, color: "var(--flow)",
    border: "1px solid var(--flow)", borderRadius: 4, padding: "1px 4px", flex: "none",
  },
  checkWriteInput: {
    width: "100%", boxSizing: "border-box",
    background: "var(--ground)", color: "var(--ink)",
    border: "1px solid var(--hair-2)", borderRadius: 9,
    padding: "9px 11px", fontSize: 14, fontFamily: "inherit", outline: "none",
  },
  checkWriteInputOn: {
    width: "100%", boxSizing: "border-box",
    background: "var(--ground)", color: "var(--ink)",
    border: "1px solid var(--ok)", borderRadius: 9,
    padding: "9px 11px", fontSize: 14, fontFamily: "inherit", outline: "none",
  },
  // Admin side: which kind an item is, and which kind the next one will be.
  kindTag: {
    fontSize: 8, fontWeight: 800, letterSpacing: 0.6, color: "var(--flow)",
    border: "1px solid var(--flow)", borderRadius: 4, padding: "0 3px",
    flex: "none", marginLeft: 6,
  },
  dayPick: { display: "flex", gap: 5, flexWrap: "wrap", marginTop: 2 },
  dayPickOn: {
    minWidth: 44, background: "var(--brand-navy-2)", border: "1px solid var(--brand-navy-2)",
    color: "#FFFFFF", borderRadius: 9, padding: "7px 6px",
    fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
  },
  dayPickOff: {
    minWidth: 44, background: "none", border: "1px solid var(--hair-2)",
    color: "var(--ink-4)", borderRadius: 9, padding: "7px 6px",
    fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
  },
  kindPick: { display: "flex", gap: 5, width: "100%", marginTop: 6 },
  kindPickOn: {
    flex: 1, background: "var(--inset-2)", border: "1px solid var(--hair-3)",
    color: "var(--ink)", borderRadius: 999, padding: "4px 8px",
    fontSize: 10.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
  },
  kindPickOff: {
    flex: 1, background: "none", border: "1px solid var(--hair)",
    color: "var(--ink-4)", borderRadius: 999, padding: "4px 8px",
    fontSize: 10.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
  },
  checkGroup: { marginBottom: 4 },
  checkGroupHead: {
    display: "flex", alignItems: "center", gap: 7, width: "100%",
    background: "none", border: "none", color: "var(--ink-3)",
    padding: "6px 2px", cursor: "pointer", textAlign: "left", font: "inherit",
    fontSize: 10.5, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase",
  },
  checkGroupChev: { fontSize: 9, color: "var(--ink-4)", flex: "none" },
  checkGroupName: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  checkGroupTally: {
    marginLeft: "auto", fontSize: 10.5, fontWeight: 800, color: "var(--ink-4)",
    fontVariantNumeric: "tabular-nums",
  },
  checkGroupTallyOn: {
    marginLeft: "auto", fontSize: 10.5, fontWeight: 800, color: "var(--ok)",
    fontVariantNumeric: "tabular-nums",
  },
  // One item, one line: the words on the left, the three answers on the right.
  // The old card put the three answers on a line of their own underneath every
  // item, which made a twenty-item list four screens on a phone.
  checkRow: {
    display: "flex", alignItems: "center", gap: 8,
    borderTop: "1px solid var(--veil)", padding: "5px 0",
  },
  checkRowText: {
    flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.35, color: "var(--ink-2)",
  },
  checkRowBtns: { display: "flex", gap: 4, flex: "none" },
  checkDot: {
    width: 30, height: 30, borderRadius: 8, flex: "none",
    background: "none", border: "1px solid", fontSize: 13, fontWeight: 800,
    lineHeight: 1, cursor: "pointer", fontFamily: "inherit",
    display: "inline-flex", alignItems: "center", justifyContent: "center",
  },
  checkList: { marginTop: 10, display: "flex", flexDirection: "column", gap: 1,
    background: "var(--hair)", border: "1px solid var(--hair)", borderRadius: 10, overflow: "hidden" },
  checkActions: { display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" },
  checkSubmit: {
    minHeight: 42, padding: "0 18px",
    background: "linear-gradient(180deg,#0E6B4F,#0A5540)",
    border: "1px solid rgba(255,255,255,.14)", borderRadius: 999,
    color: "#FFFFFF", fontSize: 14, fontWeight: 800, cursor: "pointer",
  },
  checkSubmitOff: {
    minHeight: 42, padding: "0 18px",
    background: "var(--inset)", border: "1px dashed var(--hair-3)", borderRadius: 999,
    color: "var(--ink-4)", fontSize: 14, fontWeight: 700, cursor: "not-allowed",
  },
  checkDone: {
    background: "rgba(61,220,151,.07)", border: "1px solid rgba(61,220,151,.35)",
    borderRadius: 14, padding: "11px 13px", marginBottom: 12,
  },
  checkDoneHead: { fontSize: 13.5, fontWeight: 700, color: "var(--ink-2)" },
  checkAllGood: { fontSize: 12.5, color: "var(--ink-4)", marginTop: 5 },
  checkFlagList: { marginTop: 8, display: "flex", flexDirection: "column", gap: 5 },
  checkFlagRow: { fontSize: 13, color: "var(--ink-2)", display: "flex", gap: 8, alignItems: "baseline" },
  checkFlagTag: { fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4, flex: "none" },
  checkNoteShown: { fontSize: 12.5, color: "var(--ink-3)", marginTop: 7, fontStyle: "italic" },

  truckClock: {
    fontFamily: mono, fontSize: 17, fontWeight: 500, letterSpacing: -0.7,
    fontVariantNumeric: "tabular-nums",
  },
  rail: { display: "flex", gap: 3, marginTop: 8 },
  railSeg: { flex: 1, height: 3, borderRadius: 2 },
  // Only the stage the crew is at is named. Five labels under every row was a
  // second sentence of the same information, and on six trucks that is thirty
  // words of chrome.

  callTile: {
    position: "relative",
    overflow: "hidden",
    textAlign: "left",
    background: "linear-gradient(180deg, var(--raised), var(--panel))",
    border: "1px solid var(--veil)",
    borderLeft: "4px solid",
    borderRadius: 16,
    padding: "13px 13px 14px",
    cursor: "pointer",
    color: "var(--ink)",
    display: "flex",
    flexDirection: "column",
    gap: 5,
    minHeight: 118,
    boxShadow: "0 8px 22px var(--lift)",
    transition: "transform .18s cubic-bezier(.22,1,.36,1), box-shadow .18s",
  },
  bottomBar: {
    position: "fixed",
    left: 12,
    right: 12,
    bottom: "calc(12px + env(safe-area-inset-bottom))",
    background: "var(--bar)",
    backdropFilter: "blur(18px) saturate(140%)",
    WebkitBackdropFilter: "blur(18px) saturate(140%)",
    border: "1px solid var(--veil-2)",
    borderRadius: 22,
    display: "flex",
    alignItems: "stretch",
    gap: 2,
    padding: 6,
    boxShadow: "0 18px 44px var(--lift-2)",
    // Above anything a page can raise. Leaflet alone goes to 1000.
    zIndex: 1200,
    // More tabs than fit on a phone scroll rather than squash: a label crushed
    // to three letters is not a label. The scrollbar itself is hidden — the
    // overflow is felt by dragging, not read.
    overflowX: "auto",
    scrollbarWidth: "none",
  },
  bottomTab: {
    flex: "1 1 0", minWidth: 62, position: "relative",
    display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", gap: 4,
    background: "none", border: "1px solid transparent", borderRadius: 16,
    cursor: "pointer", color: "var(--ink-4)", padding: "8px 4px 7px",
  },
  bottomTabOn: {
    flex: "1 1 0", minWidth: 62, position: "relative",
    display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", gap: 4,
    // The page you are on, said quietly and said twice — a filled panel and a
    // lit label. The old bright green outline shouted louder than anything on
    // the board above it, which is the wrong order of importance for a signpost.
    background: "var(--veil-2)",
    border: "1px solid var(--hair-2)",
    borderRadius: 16,
    cursor: "pointer", color: "var(--ink)", padding: "8px 4px 7px",
  },
  // One size for every glyph, so the row sits on one baseline instead of
  // stepping up and down with whatever each emoji happens to measure.
  bottomGlyph: {
    fontSize: 17, lineHeight: 1, height: 19,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  bottomTabLabel: {
    fontSize: 9.5, letterSpacing: 0.3, fontWeight: 650,
    whiteSpace: "nowrap", lineHeight: 1,
  },
  bottomBadge: {
    position: "absolute", top: 3, right: 8,
    background: "var(--crit)", color: "#fff", fontSize: 9, fontWeight: 800,
    borderRadius: 999, padding: "1px 5px", minWidth: 15, textAlign: "center",
  },
  // Floats clear of the row rather than sitting inside it.
  bottomAction: {
    position: "fixed",
    right: 16,
    bottom: "calc(86px + env(safe-area-inset-bottom))",
    zIndex: 1205,
    display: "inline-flex", alignItems: "center", gap: 7,
    background: "linear-gradient(180deg,#12805E,#0A5540)",
    border: "1px solid rgba(255,255,255,.16)",
    color: "#FFFFFF", borderRadius: 999,
    padding: "12px 18px", fontSize: 13.5, fontWeight: 700,
    cursor: "pointer", boxShadow: "0 12px 30px rgba(10,85,64,.45)",
  },
  bottomActionPlus: { fontSize: 16, fontWeight: 400, lineHeight: 1, marginTop: -1 },

  statusHeadline: { display: "flex", alignItems: "baseline", gap: 8 },
  statusBig: {
    fontSize: 34, fontWeight: 800, letterSpacing: -1.6, lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
  },
  statusOf: { fontSize: 13.5, fontWeight: 600, color: "var(--ink-4)" },
  statusBar: { display: "flex", gap: 3, marginTop: 11 },
  statusSeg: { height: 5, borderRadius: 3, flex: 1, opacity: 0.9 },
  statusLegend: { display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 },
  statusLegendItem: {
    display: "inline-flex", alignItems: "center", gap: 6,
    fontSize: 11.5, color: "var(--ink-3)", fontWeight: 600,
  },
  statusLegendDot: { width: 6, height: 6, borderRadius: "50%" },

  ribbonTrack: {
    position: "absolute", left: 0, top: 0, height: 3, width: "100%",
    background: "var(--veil)",
  },
  ribbonFill: { height: "100%", borderRadius: "0 3px 3px 0", transition: "width 1s linear" },
  callTilePill: {
    alignSelf: "flex-start", marginTop: 5,
    fontFamily: display, fontSize: 9.5, letterSpacing: 1.3, textTransform: "uppercase",
    padding: "3px 8px", borderRadius: 999, border: "1px solid",
  },
  callTileNature: {
    fontSize: 15, fontWeight: 750, letterSpacing: -0.25,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  callTileClock: {
    marginLeft: "auto", fontFamily: mono, fontSize: 21, fontWeight: 600,
    letterSpacing: -0.8, fontVariantNumeric: "tabular-nums", lineHeight: 1,
  },
  callTileRoute: {
    fontSize: 12, color: "var(--ink-3)", lineHeight: 1.4,
    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
  },
  callTileFoot: {
    marginTop: "auto", display: "flex", alignItems: "flex-end", gap: 8,
  },
  callTileUnit: {
    fontFamily: mono, fontSize: 11.5, fontWeight: 600, letterSpacing: 0.6, color: "var(--info)",
  },
  callTileTags: { display: "flex", gap: 5, flexWrap: "wrap" },
  callTileTag: { fontSize: 10, fontWeight: 800, letterSpacing: 0.4 },
  callTileAssist: {
    fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color: "var(--move)",
  },
  callTileHandover: {
    fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color: "var(--hold)",
  },
  calmBoard: {
    textAlign: "center", padding: "38px 20px",
    border: "0.5px dashed var(--veil-2)", borderRadius: 18, marginTop: 4,
  },
  calmTitle: { fontSize: 17, fontWeight: 600, color: "var(--ink-3)", letterSpacing: -0.25 },
  calmSub: { fontSize: 14, color: "var(--ink-4)", marginTop: 5 },
  standingRow: {
    display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12, alignItems: "center",
  },
  standingChip: {
    fontSize: 12.5, fontWeight: 600, letterSpacing: -0.1,
    padding: "6px 12px", borderRadius: 999,
    background: "rgba(48,209,88,.11)", color: "var(--ok)",
    border: "0.5px solid rgba(48,209,88,.26)",
  },

  // The two squares the board is read in: what is out, and what is waiting.
  // Same shape, different edge — the waiting one is amber because a call with
  // nobody on it is the thing the desk has to do something about.
  boardSquare: {
    background: "var(--panel)",
    border: "0.5px solid var(--veil)",
    borderRadius: 18,
    padding: 12,
    marginTop: 4,
    marginBottom: 12,
  },
  boardSquareWaiting: {
    background: "rgba(255,159,10,.06)",
    border: "0.5px solid rgba(255,159,10,.30)",
    borderRadius: 18,
    padding: 12,
    marginTop: 4,
    marginBottom: 12,
  },
  boardSquareHead: {
    display: "flex", alignItems: "center", gap: 8,
    padding: "1px 2px 10px",
  },
  boardSquareTitle: {
    fontSize: 10.5, fontWeight: 800, letterSpacing: 1.4, color: "var(--ink-4)",
  },
  boardSquareTitleWait: {
    fontSize: 10.5, fontWeight: 800, letterSpacing: 1.4, color: "var(--hold)",
  },
  boardSquareCount: {
    fontSize: 11, fontWeight: 800, color: "var(--ink-3)",
    background: "var(--inset)", border: "1px solid var(--hair)",
    borderRadius: 999, padding: "1px 8px",
  },
  boardSquareCountWait: {
    fontSize: 11, fontWeight: 800, color: "var(--hold)",
    background: "rgba(255,159,10,.12)", border: "1px solid rgba(255,159,10,.4)",
    borderRadius: 999, padding: "1px 8px",
  },
  callCardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
    gap: 10,
  },
  // The roster card, with a call in it. A button, so every part of it is the
  // target — a desk with a phone in one hand is not aiming at a chevron.
  callCardTile: {
    background: "var(--raised)",
    border: "1px solid var(--hair)",
    boxShadow: "0 6px 18px var(--lift)",
    borderRadius: 16,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    padding: 0,
    cursor: "pointer",
    textAlign: "left",
    color: "var(--ink)",
    width: "100%",
    font: "inherit",
  },
  callCardTileBody: {
    padding: "11px 13px 13px",
    display: "flex",
    flexDirection: "column",
    gap: 7,
  },
  callCardTileCrew: {
    fontSize: 12, color: "var(--ink-4)",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  callCardTileNature: {
    fontSize: 14, fontWeight: 650, letterSpacing: -0.2, color: "var(--ink)",
  },
  callCardTileRoute: {
    fontSize: 12, color: "var(--ink-4)",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  callCardTileWait: {
    fontSize: 10, fontWeight: 800, letterSpacing: 1, color: "var(--hold)",
  },
  callCardTileTags: { display: "flex", gap: 5, flexWrap: "wrap" },

  // Tighter, because a busy morning puts a dozen of these on one screen and a
  // desk needs to see the bottom of the list without scrolling.


  callTileGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
    gap: 8,
  },
  tileBackBtn: {
    background: "none", border: "1px solid var(--hair-2)", color: "var(--ink-3)",
    borderRadius: 999, padding: "6px 12px", fontSize: 12.5, fontWeight: 700,
    cursor: "pointer", marginBottom: 10,
  },

  needsDetailHeadBtn: {
    width: "100%", display: "flex", alignItems: "center", gap: 4,
    background: "none", border: "none", padding: 0, cursor: "pointer",
    fontSize: 14.5, fontWeight: 800, color: "var(--hold-3)", lineHeight: 1.45, textAlign: "left",
  },
  needsDetailHead: { fontSize: 14.5, fontWeight: 800, color: "var(--hold-3)", lineHeight: 1.45 },
  needsDetailBulb: { marginRight: 7, fontSize: 15 },
  needsDetailBody: { fontSize: 13, color: "var(--ink-3)", lineHeight: 1.55, marginTop: 6 },
  needsDetailList: { marginTop: 9, display: "flex", flexDirection: "column", gap: 5 },
  needsDetailItem: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" },
  needsDetailNature: { fontSize: 13.5, fontWeight: 700, color: "var(--ink)" },
  needsDetailWhat: { fontSize: 12.5, color: "var(--ink-3)" },
  needsDetailTag: {
    marginTop: 8, fontSize: 12.5, fontWeight: 700, color: "var(--hold-3)",
    background: "rgba(233,196,106,.08)", border: "1px solid rgba(233,196,106,.4)",
    borderRadius: 8, padding: "6px 9px",
  },

  coverageRow: { marginBottom: 12 },
  coverageTotal: {
    background: "var(--raised)", border: "1px solid var(--hair-2)", borderRadius: 12,
    padding: "10px 14px", minWidth: 150,
  },
  coverageTotalName: { fontSize: 11.5, fontWeight: 700, color: "var(--ink-3)", letterSpacing: 0.4 },
  coverageTotalVal: { fontSize: 19, fontWeight: 800, color: "var(--ink)", marginTop: 3 },
  coverageTotalMeta: { fontSize: 12, color: "var(--ink-4)", marginTop: 2 },
  coverageRowPast: {
    display: "flex", alignItems: "center", gap: 10,
    background: "var(--panel)", border: "1px solid var(--hair)", borderRadius: 12, padding: "10px 12px",
    boxShadow: "0 8px 22px var(--lift)",
  },
  coverageRowLive: {
    display: "flex", alignItems: "center", gap: 10,
    background: "rgba(255,77,94,.10)", border: "1px solid var(--crit)", borderRadius: 16, padding: "10px 12px",
    boxShadow: "0 8px 22px var(--lift)",
  },
  coverageRowHead: { fontSize: 14, fontWeight: 700, color: "var(--ink)", display: "flex", gap: 8, flexWrap: "wrap" },
  coverageRowWhen: { fontSize: 12, fontWeight: 600, color: "var(--ink-4)" },
  coverageRowMeta: { fontSize: 12.5, color: "var(--ink-3)", marginTop: 3 },
  coverageDur: { fontSize: 15, fontWeight: 800, color: "var(--ink-2)", minWidth: 78, textAlign: "right" },
  coverageDurLive: { fontSize: 15, fontWeight: 800, color: "var(--crit-2)", minWidth: 78, textAlign: "right" },
  coverageBtn: {
    display: "inline-flex", alignItems: "center", gap: 7,
    background: "rgba(255,77,94,.10)", border: "1px solid rgba(255,77,94,.55)",
    color: "var(--crit-2)", borderRadius: 999, padding: "10px 16px",
    fontSize: 13.5, fontWeight: 800, letterSpacing: 0.3, cursor: "pointer",
  },
  coverageBtnQuiet: {
    display: "inline-flex", alignItems: "center", gap: 7,
    background: "none", border: "1px solid var(--hair-2)",
    color: "var(--ink-4)", borderRadius: 999, padding: "10px 16px",
    fontSize: 13.5, fontWeight: 700, cursor: "pointer",
  },
  coverageHint: { fontSize: 11.5, fontWeight: 600, color: "var(--ink-4)", marginLeft: 4 },
  coverageOn: {
    background: "linear-gradient(180deg,#7F1D26,#4A0F16)",
    border: "1px solid var(--crit)", borderRadius: 14,
    padding: "12px 14px", color: "#FFFFFF",
    fontSize: 15, fontWeight: 800, letterSpacing: 0.3,
    boxShadow: "0 8px 24px rgba(255,77,94,.22)",
  },
  coverageSince: { display: "block", fontSize: 12.5, fontWeight: 600, color: "rgba(255,255,255,.75)", marginTop: 4 },

  partnerManage: {
    background: "var(--raised)", border: "1px solid var(--hair-2)", borderRadius: 14,
    padding: 12, marginBottom: 12,
    boxShadow: "0 8px 22px var(--lift)",
  },
  partnerManageHead: { fontSize: 12, fontWeight: 800, letterSpacing: 0.5, color: "var(--gold)" },

  partnerBox: {
    marginTop: 14, background: "var(--ground)", border: "1px dashed var(--hair-2)",
    borderRadius: 14, padding: 12,
    boxShadow: "0 8px 22px var(--lift)",
  },
  partnerHead: { fontSize: 11, fontWeight: 800, letterSpacing: 0.7, color: "var(--gold)" },
  partnerNote: { fontSize: 13, color: "var(--ink-3)", lineHeight: 1.55, marginTop: 6 },
  partnerFound: { marginTop: 8, fontSize: 13, fontWeight: 600, color: "var(--ok)" },

  ackBtnBusy: {
    opacity: 0.6, cursor: "wait",
  },
  // The pressed state of alarmAckBtn — same box, different colours only.
  alarmAckBtnBusy: {
    marginTop: 12,
    width: "100%", background: "var(--hair-2)", border: "1px solid var(--hair-3)",
    color: "var(--ink-3)", borderRadius: 12, padding: "16px 16px",
    fontSize: 17, fontWeight: 800, letterSpacing: 0.5, cursor: "wait",
  },

  deskAssistBtn: {
    background: "none", border: "1px solid rgba(176,124,240,.5)", color: "var(--move)",
    borderRadius: 999, padding: "6px 10px", fontSize: 13.5, fontWeight: 600,
    cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5,
  },

  handOverBtn: {
    background: "none", border: "1px solid rgba(255,176,32,.45)", color: "var(--hold)",
    borderRadius: 999, padding: "6px 10px", fontSize: 13.5, fontWeight: 600,
    cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5,
  },
  handBackBtn: {
    background: "rgba(255,176,32,.10)", border: "1px solid rgba(255,176,32,.55)", color: "var(--hold-2)",
    borderRadius: 999, padding: "6px 10px", fontSize: 13.5, fontWeight: 700,
    cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5,
  },

  stepBtn: {
    width: "100%",
    minHeight: 62,
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 10,
    padding: "16px 16px",
    // Filled with the moving colour and written on in white, in both themes.
    // It was a dark slab with light text, which on a white ground left the
    // writing barely there — on the one button a crew presses at speed.
    background: "linear-gradient(180deg, var(--flow), color-mix(in srgb, var(--flow) 78%, black))",
    border: "1px solid color-mix(in srgb, var(--flow) 70%, black)",
    borderRadius: 12,
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: 800,
    letterSpacing: -0.2,
    cursor: "pointer",
    boxShadow: "0 10px 26px var(--lift)",
    textAlign: "left",
  },
  stepBtnBlocked: {
    width: "100%",
    minHeight: 62,
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 10,
    padding: "16px 16px",
    background: "var(--inset)",
    border: "1px dashed var(--hair-3)",
    borderRadius: 12,
    color: "var(--ink-4)",
    fontSize: 17,
    fontWeight: 700,
    cursor: "not-allowed",
    textAlign: "left",
  },
  stepBtnCue: {
    fontSize: 10.5,
    fontWeight: 800,
    letterSpacing: 1.2,
    color: "var(--info)",
    border: "1px solid rgba(111,214,240,.45)",
    borderRadius: 5,
    padding: "2px 6px",
    flex: "none",
  },

  uhuScope: {
    marginLeft: "auto", fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
    color: "var(--ink-4)", textTransform: "uppercase",
  },

  uhuStationHead: {
    fontSize: 11, fontWeight: 800, letterSpacing: 0.8, color: "var(--info)",
    textTransform: "uppercase", padding: "10px 0 4px",
  },

  issueRow: {
    background: "var(--raised)", border: "1px solid var(--hair)", borderRadius: 16, padding: "11px 12px",
    boxShadow: "0 6px 18px var(--lift)",
  },
  issueHead: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  issueOpen: {
    fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, color: "var(--hold)",
    border: "1px solid rgba(255,176,32,.45)", borderRadius: 5, padding: "1px 6px",
  },
  issueClosed: {
    fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, color: "var(--ok)",
    border: "1px solid rgba(61,220,151,.4)", borderRadius: 5, padding: "1px 6px",
  },
  issueWho: { fontSize: 12.5, fontWeight: 700, color: "var(--ink-2)" },
  issueWhen: { fontSize: 12, color: "var(--ink-4)", marginLeft: "auto" },
  issueText: { fontSize: 14, color: "var(--ink)", lineHeight: 1.55, marginTop: 7 },
  issueCall: { fontSize: 12, color: "var(--ink-4)", marginTop: 5 },
  issueReply: {
    fontSize: 13, color: "var(--ink-3)", marginTop: 7, paddingLeft: 9,
    borderLeft: "2px solid var(--hair-2)",
  },

  archTabs: { display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" },
  archTab: {
    display: "inline-flex", alignItems: "center", gap: 8,
    background: "var(--raised)", border: "1px solid var(--hair)", color: "var(--ink-3)",
    borderRadius: 999, padding: "8px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer",
  },
  archTabOn: {
    display: "inline-flex", alignItems: "center", gap: 8,
    background: "var(--inset)", border: "1px solid var(--flow)", color: "var(--ink)",
    borderRadius: 999, padding: "8px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer",
  },
  archTabCount: { fontSize: 11.5, color: "var(--ink-4)", fontWeight: 600 },
  archDay: {
    fontSize: 12, fontWeight: 800, letterSpacing: 0.7, color: "var(--info)",
    marginBottom: 7, textTransform: "uppercase",
  },
  archOpenTag: {
    marginLeft: 8, fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
    color: "var(--hold)", border: "1px solid rgba(245,158,11,.4)", borderRadius: 5,
    padding: "1px 6px",
  },

  savedNote: { fontSize: 13.5, color: "var(--ink-3)", lineHeight: 1.55, marginTop: 8 },
  savedRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "var(--raised)",
    border: "1px solid var(--hair)",
    borderRadius: 16,
    padding: "10px 12px",
    flexWrap: "wrap",
    boxShadow: "0 8px 22px var(--lift)",
  },
  savedDay: { fontSize: 14, fontWeight: 700, color: "var(--ink)" },
  savedMeta: { fontSize: 12.5, color: "var(--ink-4)", marginTop: 3 },

  stationBoardLabel: {
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0.6,
    color: "var(--info)",
    marginBottom: 4,
  },

  logStationTag: {
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 0.5,
    color: "var(--info)",
    border: "1px solid #24425F",
    borderRadius: 4,
    padding: "1px 4px",
  },

  stationCount: { marginLeft: 8, fontSize: 12.5, fontWeight: 600, color: "var(--ink-4)", letterSpacing: 0.3 },
  addUnitRow: { display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" },

  grantOtBtn: {
    background: "rgba(255,159,10,.12)", border: "1px solid rgba(255,159,10,.45)",
    color: "var(--hold)", borderRadius: 999, padding: "3px 9px",
    fontSize: 10.5, fontWeight: 800, letterSpacing: 0.3, cursor: "pointer", flex: "none",
  },
  liveDayRow: {
    display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
    background: "rgba(48,209,88,.08)", border: "1px solid rgba(48,209,88,.34)",
    borderRadius: 14, padding: "12px 14px", marginTop: 10,
  },
  // Amber rather than red: a store that has grown is a thing to look at, not a
  // thing that has broken.
  bigKeyBanner: {
    margin: "0 12px 8px",
    background: "rgba(255,159,10,.12)",
    border: "1px solid rgba(255,159,10,.45)",
    color: "var(--ink)",
    borderRadius: 12,
    padding: "10px 14px",
    fontSize: 12.5,
    lineHeight: 1.5,
  },
  storageBanner: {
    margin: "0 12px 8px",
    background: "rgba(255,69,58,.14)",
    border: "1px solid rgba(255,69,58,.5)",
    color: "var(--ink)",
    borderRadius: 12,
    padding: "10px 14px",
    fontSize: 12.5,
    lineHeight: 1.5,
  },
  offlineBanner: {
    background: "color-mix(in srgb, var(--hold) 22%, var(--panel))",
    borderTop: "1px solid var(--hold)",
    borderBottom: "1px solid var(--hold)",
    color: "var(--hold-2)",
    fontSize: 14,
    fontWeight: 700,
    lineHeight: 1.5,
    padding: "9px 14px",
    textAlign: "center",
  },
  syncingBanner: {
    background: "color-mix(in srgb, var(--flow) 12%, var(--panel))",
    borderBottom: "1px solid #24425F",
    color: "var(--info)",
    fontSize: 14,
    fontWeight: 600,
    padding: "7px 14px",
    textAlign: "center",
  },

  stationBanner: {
    display: "flex",
    alignItems: "center",
    background: "var(--inset)",
    border: "1px solid #24425F",
    borderRadius: 8,
    padding: "7px 10px",
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: 0.5,
    color: "var(--info)",
    marginBottom: 10,
  },

  editInbox: {
    marginTop: 12,
    background: "color-mix(in srgb, var(--hold) 12%, var(--panel))",
    border: "1px solid var(--hold)",
    borderRadius: 16,
    padding: 12,
  },
  editInboxHead: {
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: 0.5,
    color: "var(--hold)",
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  editInboxNote: { fontSize: 13.5, color: "var(--ink-3)", lineHeight: 1.5, marginTop: 6 },
  editInboxCall: {
    marginTop: 10,
    borderTop: "1px solid #2A2110",
    paddingTop: 8,
  },
  editInboxCallHead: { display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8 },
  editInboxNature: { fontSize: 15.5, fontWeight: 700, color: "var(--ink)" },
  editInboxMeta: { fontSize: 13, color: "var(--ink-3)" },

  mrnMissingRow: {
    fontSize: 13.5,
    color: "var(--hold)",
    marginTop: 4,
  },
  editCrewBlock: { marginTop: 10 },
  editOpenBtn: {
    marginTop: 10,
    background: "var(--veil)",
    border: "1px solid var(--hair-2)",
    color: "var(--ink-3)",
    borderRadius: 999,
    padding: "8px 14px",
    minHeight: 38,
    fontSize: 13.5,
    fontWeight: 600,
    fontFamily: display,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  },
  editPanel: {
    marginTop: 10,
    background: "var(--ground)",
    border: "1px solid var(--flow)",
    borderRadius: 16,
    padding: 12,
    boxShadow: "0 6px 18px var(--lift)",
  },
  editPanelHead: {
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0.5,
    color: "var(--flow)",
    marginBottom: 6,
  },
  editPanelNote: { fontSize: 13.5, color: "var(--ink-3)", lineHeight: 1.5, marginBottom: 4 },
  editPanelActions: {
    marginTop: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  },
  editPanelCount: { fontSize: 13, color: "var(--ink-4)" },
  editReview: {
    marginTop: 10,
    background: "color-mix(in srgb, var(--hold) 12%, var(--panel))",
    border: "1px solid var(--hold)",
    borderRadius: 16,
    padding: 10,
  },
  editReviewHead: {
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0.5,
    color: "var(--hold)",
    marginBottom: 8,
    display: "flex",
    alignItems: "center",
    gap: 5,
  },
  editReviewRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "8px 0",
    borderTop: "1px solid #2A2110",
    flexWrap: "wrap",
  },
  editReviewField: { fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: "var(--ink-3)" },
  editReviewChange: { fontSize: 15, marginTop: 2 },
  editReviewFrom: { color: "var(--ink-3)", textDecoration: "line-through" },
  editReviewTo: { color: "var(--ink)", fontWeight: 700 },
  editReviewBy: { fontSize: 13, color: "var(--ink-4)", marginTop: 3 },
  editHistory: { marginTop: 8 },
  editHistoryRow: { fontSize: 13, color: "var(--ink-4)", lineHeight: 1.6 },
  editPendingNote: {
    fontSize: 13.5,
    color: "var(--hold)",
    background: "color-mix(in srgb, var(--hold) 12%, var(--panel))",
    border: "1px solid #2A2110",
    borderRadius: 8,
    padding: "6px 8px",
    marginBottom: 8,
    lineHeight: 1.5,
  },

  escComposer: {
    background: "color-mix(in srgb, var(--hold) 12%, var(--panel))",
    border: "1px dashed var(--hold)",
    borderRadius: 8,
    padding: 10,
    marginTop: 14,
  },
  escComposerHead: {
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0.5,
    color: "var(--hold)",
    marginBottom: 6,
  },
  escComposerActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 8,
  },
  escPrivacyNote: { fontSize: 12.5, color: "var(--ink-4)", lineHeight: 1.5, flex: 1, minWidth: 200 },
  escByTag: { fontSize: 13, color: "var(--ink-2)", fontWeight: 600 },

  // ---- finding a call again ----
  historyFilters: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    margin: "0 0 10px",
  },
  historyFilterInputWrap: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "var(--ground)",
    border: "1px solid var(--hair-2)",
    borderRadius: 8,
    padding: "0 10px",
    flex: 1,
    minWidth: 200,
  },
  historyFilterInput: {
    flex: 1,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--ink)",
    padding: "8px 0",
    fontFamily: display,
    fontSize: 16,
  },
  // ---- the history's Gregorian day filter ----
  dayPickerWrap: { position: "relative" },
  dayPickerBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "var(--ground)",
    border: "1px solid var(--hair-2)",
    borderRadius: 8,
    color: "var(--ink-3)",
    padding: "7px 10px",
    fontFamily: display,
    fontSize: 14,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  dayPickerBtnOn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "rgba(59,130,246,0.12)",
    border: "1px solid var(--flow)",
    borderRadius: 8,
    color: "var(--flow-2)",
    padding: "7px 10px",
    fontFamily: display,
    fontSize: 14,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  dayPickerPop: {
    position: "absolute",
    zIndex: 40,
    top: "calc(100% + 6px)",
    left: 0,
    width: 268,
    background: "var(--ground)",
    border: "1px solid var(--hair-2)",
    borderRadius: 8,
    padding: 10,
    boxShadow: "0 12px 30px rgba(0,0,0,0.55)",
  },
  filterChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    background: "transparent",
    border: "1px solid var(--hair-2)",
    borderRadius: 999,
    color: "var(--ink-3)",
    padding: "6px 12px",
    cursor: "pointer",
    fontFamily: display,
    fontSize: 13,
    whiteSpace: "nowrap",
  },
  filterChipOn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    background: "rgba(59,130,246,0.14)",
    border: "1px solid var(--flow)",
    borderRadius: 999,
    color: "var(--flow-2)",
    padding: "6px 12px",
    cursor: "pointer",
    fontFamily: display,
    fontSize: 13,
    whiteSpace: "nowrap",
  },
  assistStatusLine: { display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8, fontSize: 13.5 },
  assistStatusWaiting: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    color: "var(--crit-2)",
    fontWeight: 600,
  },
  assistStatusHelping: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    color: "var(--flow-2)",
    fontWeight: 600,
  },
  assistReason: { display: "block", marginTop: 4, color: "var(--ink)", fontWeight: 600 },
  assistStatusStood: { color: "var(--ink-3)" },
  assistStatusDone: { color: "var(--ink-4)" },
  assistPanel: {
    marginTop: 10,
    background: "rgba(239,68,68,0.08)",
    border: "1px solid rgba(239,68,68,0.5)",
    borderRadius: 10,
    padding: "10px 12px",
  },
  assistPanelHead: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  assistPanelTitle: {
    fontFamily: display,
    fontWeight: 700,
    fontSize: 13.5,
    letterSpacing: 0.6,
    color: "var(--crit-2)",
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
  },
  assistPanelCount: { fontSize: 13, color: "var(--ink-2)", flex: 1, minWidth: 160 },
  assistTaskRow: {
    marginTop: 8,
    paddingTop: 8,
    borderTop: "1px solid rgba(239,68,68,0.25)",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  assistTaskMain: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, fontSize: 13.5 },
  assistTaskUnit: {
    fontFamily: display,
    fontWeight: 700,
    fontSize: 16,
    color: "var(--ink)",
  },
  assistTaskDetail: {
    display: "block", fontSize: 14, color: "var(--ink)", fontWeight: 600,
    marginTop: 3, lineHeight: 1.45,
  },
  assistTaskNature: { color: "var(--ink)", fontWeight: 600 },
  assistTaskRoute: { color: "var(--ink-3)" },
  assistTaskWaiting: { color: "var(--crit-2)", fontWeight: 600 },
  assistTaskActions: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },

  assignSelect: {
    background: "var(--ground)",
    border: "1px solid var(--hair-2)",
    color: "var(--ink)",
    borderRadius: 8,
    padding: "6px 8px",
    fontFamily: display,
    fontSize: 16,
  },
  assignedTag: { fontSize: 13.5, color: "var(--flow)", fontWeight: 600 },

  unitGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 },
  unitCard: {
    background: "var(--raised)",
    border: "1px solid var(--hair)",
    boxShadow: "0 6px 18px var(--lift)",
    borderRadius: 16,
    // The padding moved onto the body so the status bar can run edge to edge.
    // A bar with a margin round it reads as decoration; one that touches both
    // sides reads as the card's state.
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  unitCardBar: { height: 4, width: "100%", flex: "none" },
  unitCardBody: {
    padding: "11px 13px 13px",
    display: "flex",
    flexDirection: "column",
    gap: 7,
  },
  unitCardTop: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
  },
  unitCardStatusRow: { display: "flex", alignItems: "center", gap: 7 },
  unitCardDot: { width: 7, height: 7, borderRadius: 999, flex: "none" },
  unitCardStatusText: { fontSize: 11.5, fontWeight: 700, letterSpacing: 1 },
  unitCardName: { fontSize: 16, fontWeight: 650, letterSpacing: -0.2 },

  myUnitCard: {
    background: "var(--raised)",
    border: "1px solid var(--hair)",
    borderRadius: 8,
    padding: 14,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
  },

  logPanel: {
    boxShadow: "0 6px 18px var(--lift)",
    background: "var(--raised)",
    border: "1px solid var(--hair)",
    borderRadius: 16,
    display: "flex",
    flexDirection: "column",
    maxHeight: 560,
  },
  logHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "10px 12px",
    borderBottom: "1px solid var(--hair)",
    fontSize: 13,
    letterSpacing: 1,
    color: "var(--ink-3)",
    fontWeight: 700,
  },
  logList: { overflowY: "auto", padding: "6px 0" },
  logEmpty: { color: "var(--ink-4)", fontSize: 14, padding: "12px", fontStyle: "italic" },
  logEntry: { borderLeft: "2px solid", padding: "6px 12px", fontSize: 13.5 },
  logTopRow: { display: "flex", alignItems: "center", gap: 8 },
  logTime: { color: "var(--ink-4)", fontSize: 12 },
  // The name stamp. Pushed to the end of the time row so the eye can run down
  // the right-hand edge of the log and read who did what without re-reading
  // every sentence — the name in white, where they were posted beside it.
  logStamp: {
    marginLeft: "auto",
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    maxWidth: "62%",
    background: "var(--ground)",
    border: "1px solid var(--hair)",
    borderRadius: 999,
    padding: "1px 7px",
  },
  logStampName: {
    color: "var(--ink-2)",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0.2,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  logStampPost: {
    color: "var(--ink-4)",
    fontSize: 11,
    letterSpacing: 0.5,
    whiteSpace: "nowrap",
    borderLeft: "1px solid var(--hair)",
    paddingLeft: 5,
  },
  logMessage: { color: "var(--ink-2)", marginTop: 2, lineHeight: 1.4 },

  uhuPanel: {
    boxShadow: "0 6px 18px var(--lift)",
    background: "var(--raised)",
    border: "1px solid var(--hair)",
    borderRadius: 16,
    display: "flex",
    flexDirection: "column",
  },
  uhuFocus: { padding: "16px 14px" },
  uhuFocusUnit: { fontFamily: display, fontSize: 15, fontWeight: 700, letterSpacing: 1, color: "var(--ink-3)" },
  uhuFocusTotal: {
    fontSize: 34,
    fontWeight: 600,
    letterSpacing: 1,
    color: "var(--ink-alt)",
    margin: "6px 0 2px",
    fontVariantNumeric: "tabular-nums",
  },
  uhuFocusCaption: { fontSize: 13.5, color: "var(--ink-4)" },
  uhuLiveBox: {
    marginTop: 14,
    padding: "10px 12px",
    background: "rgba(239,68,68,0.08)",
    border: "1px solid rgba(239,68,68,0.35)",
    borderRadius: 8,
  },
  uhuLiveRow: { display: "flex", alignItems: "center", gap: 8 },
  uhuLiveLabel: { fontSize: 12.5, letterSpacing: 1, fontWeight: 700, color: "var(--crit)" },
  uhuLiveTime: { marginLeft: "auto", fontSize: 16, color: "var(--ink-alt)", fontVariantNumeric: "tabular-nums" },
  uhuLiveNature: { fontSize: 13.5, color: "var(--ink-2)", marginTop: 5 },
  uhuIdleBox: {
    marginTop: 14,
    padding: "10px 12px",
    background: "var(--ground)",
    border: "1px solid var(--hair)",
    borderRadius: 8,
    fontSize: 13.5,
    color: "var(--ink-4)",
  },
  uhuList: { padding: "4px 0", maxHeight: 320, overflowY: "auto" },
  uhuRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "9px 12px",
    borderBottom: "1px solid #141B23",
  },
  uhuRowMain: { display: "flex", alignItems: "center", gap: 7, minWidth: 0 },
  uhuRowName: { fontSize: 14, fontWeight: 600, color: "var(--ink)" },
  uhuRowRight: { textAlign: "right" },
  uhuRowTime: { display: "block", fontSize: 15, color: "var(--ink-alt)", fontVariantNumeric: "tabular-nums" },
  uhuRowCalls: { display: "block", fontSize: 12, color: "var(--ink-4)", marginTop: 1 },
  uhuFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "10px 12px",
    borderTop: "1px solid var(--hair)",
    fontSize: 12.5,
    letterSpacing: 1,
    fontWeight: 700,
    color: "var(--ink-3)",
  },
  uhuFooterTime: { color: "var(--ink)", letterSpacing: 0.5, fontVariantNumeric: "tabular-nums" },

  toast: {
    position: "fixed",
    top: "calc(16px + env(safe-area-inset-top))",
    right: 16,
    background: "var(--hold)",
    color: "var(--ground)",
    borderRadius: 10,
    padding: "10px 12px",
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    maxWidth: 300,
    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    zIndex: 50,
    animation: "slide-in 0.25s ease",
  },
  toastTitle: { fontWeight: 800, fontSize: 13.5, letterSpacing: 0.5 },
  toastBody: { fontSize: 14, marginTop: 2 },
  toastClose: { background: "none", border: "none", color: "var(--ground)", fontSize: 18, cursor: "pointer", lineHeight: 1 },

  // login
  loginWrap: {
    minHeight: "100vh",
    // The same lit ground as the board behind it, so signing in feels like the
    // front door of one building rather than a separate app.
    // No card, no gradient, no plate. The sign-in is a front door: a name, a
    // question, three large targets. A dialogue box floating on a coloured field
    // is what an app looked like when every screen had to be a window.
    // A single soft light from the upper left, as the design has it. Flat black
    // behind a lone form reads as an error page; this reads as a room with a
    // light on in it, and costs one gradient.
    background:
      "radial-gradient(1000px 560px at 22% 14%, color-mix(in srgb, var(--brand-navy) 22%, var(--panel)) 0%, var(--ground) 62%)",
    position: "relative",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    fontFamily: display,
    color: "var(--ink)",
    padding: "40px 22px calc(40px + env(safe-area-inset-bottom))",
  },
  loginThemeBtn: {
    position: "absolute", top: "calc(18px + env(safe-area-inset-top))", right: 18,
    background: "none", border: "0.5px solid var(--hair-2)", color: "var(--ink-3)",
    borderRadius: 999, width: 36, height: 36, cursor: "pointer", fontSize: 15,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
  },

  loginMark: {
    display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
    marginBottom: 26,
  },
  loginWordmark: { display: "flex", flexDirection: "column", alignItems: "center", gap: 5 },

  // The tab strip along the top of the card: a tray with three slots, the
  // chosen one raised out of it.
  loginTabs: {
    display: "flex", gap: 6, padding: 4, borderRadius: 12,
    background: "var(--inset)", marginBottom: 18,
  },
  loginTab: {
    flex: 1, padding: "10px 8px", borderRadius: 9, border: "none",
    background: "none", color: "var(--ink-4)",
    fontSize: 13.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
  },
  loginTabOn: {
    flex: 1, padding: "10px 8px", borderRadius: 9,
    border: "1px solid var(--hair-2)",
    background: "var(--inset-2)", color: "var(--ink)",
    fontSize: 13.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
  },

  loginFieldLabel: {
    display: "block", fontSize: 10.5, fontWeight: 700, letterSpacing: 1.2,
    color: "var(--ink-4)", marginBottom: 7,
  },
  loginInput: {
    width: "100%", boxSizing: "border-box",
    padding: "14px 15px", borderRadius: 12,
    background: "var(--inset)", border: "1px solid var(--hair-2)",
    color: "var(--ink)", fontSize: 16, fontFamily: "inherit",
    letterSpacing: 0.6, outline: "none",
  },
  // The one blue thing on the screen, and the only thing to press.
  loginSubmit: {
    width: "100%", marginTop: 18, padding: "15px 16px", borderRadius: 13,
    background: "var(--brand-navy-2)", border: "none", color: "#FFFFFF",
    fontSize: 15.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
    boxShadow: "0 8px 24px rgba(43,84,160,.34)",
  },
  loginSubmitOff: {
    width: "100%", marginTop: 18, padding: "15px 16px", borderRadius: 13,
    background: "var(--inset-2)", border: "1px solid var(--hair)", color: "var(--ink-4)",
    fontSize: 15.5, fontWeight: 700, fontFamily: "inherit", cursor: "default",
  },
  forgotBtn: {
    display: "block", margin: "12px auto 0", background: "none", border: "none",
    color: "var(--ink-3)", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit",
    textDecoration: "underline", cursor: "pointer", padding: 4,
  },
  resumeCard: {
    background: "rgba(48,209,88,.09)", border: "1px solid rgba(48,209,88,.34)",
    borderRadius: 14, padding: "13px 15px", margin: "12px 0 4px",
  },
  resumeWhat: {
    fontSize: 10.5, fontWeight: 800, letterSpacing: 1.1, color: "var(--ok)",
    textTransform: "uppercase",
  },
  resumeWho: { fontSize: 19, fontWeight: 750, color: "var(--ink)", marginTop: 5 },
  resumeMeta: { fontSize: 12, color: "var(--ink-4)", marginTop: 4 },
  loginNote: {
    display: "flex", alignItems: "flex-start", gap: 9,
    padding: "11px 13px", borderRadius: 11, background: "var(--inset)",
    marginTop: 16, fontSize: 11.5, lineHeight: 1.5, color: "var(--ink-3)",
  },

  loginCard: {
    width: "100%",
    maxWidth: 440,
    margin: "0 auto",
    // The form sits on a panel again, as the design draws it. Without one it
    // floated on the ground with nothing holding it together, and the fields
    // read as three unrelated things rather than one door.
    background: "var(--panel)",
    border: "1px solid var(--hair)",
    borderRadius: 22,
    padding: "24px 24px 26px",
    boxShadow: "0 24px 64px var(--lift-2)",
  },
  // Small, grey, and out of the way of the sign-in box. It has to be present and
  // legible, not prominent — a crew signing on at handover should not have to
  // read past a legal notice to find the ID field.
  loginFoot: {
    width: "100%", maxWidth: 440, margin: "24px auto 0",
    display: "flex", flexDirection: "column", gap: 12,
  },
  loginFootWhat: {
    fontSize: 12, lineHeight: 1.6, color: "var(--ink-4)", textAlign: "center",
  },
  legalNote: {
    marginTop: 0, fontSize: 11.5, lineHeight: 1.5, color: "var(--ink-4)", textAlign: "center",
  },
  legalLinks: {
    marginTop: 6, display: "flex", justifyContent: "center", alignItems: "center",
    gap: 8, flexWrap: "wrap",
  },
  legalLink: { color: "var(--ink-3)", textDecoration: "underline" },
  loginHospitalLogo: {
    height: 76, width: "auto", display: "block",
    background: "var(--logo-plate)", padding: "var(--logo-pad)",
    borderRadius: "var(--logo-radius)",
  },
  loginDeptLogo: { height: 96, width: "auto", display: "block" },
  loginLogoDivider: { width: 1, alignSelf: "stretch", background: "var(--ink-2)" },
  logoPlateLogin: {
    background: "#FFFFFF",
    borderRadius: 12,
    padding: "14px 22px",
    marginBottom: 18,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
  },
  loginHeaderText: { fontFamily: display, fontWeight: 700, fontSize: 18, letterSpacing: 0.5 },
  loginSub: { color: "var(--ink-3)", fontSize: 14, marginTop: 6 },
  roleBtn: {
    background: "var(--panel)",
    border: "0.5px solid var(--veil)",
    borderRadius: 18,
    padding: "20px",
    minHeight: 78,
    color: "var(--ink)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    cursor: "pointer",
    fontFamily: display,
    textAlign: "left",
    boxShadow: "0 6px 18px var(--lift)",
    transition: "transform .16s cubic-bezier(.22,1,.36,1), border-color .16s",
  },
  shiftNowTag: {
    marginLeft: 8, fontSize: 11, fontWeight: 800, letterSpacing: 0.8,
    padding: "2px 8px", borderRadius: 999,
    background: "var(--ink)", color: "var(--panel)",
  },
  roleBtnTitle: { fontWeight: 600, fontSize: 20, letterSpacing: -0.42 },
  roleBtnSub: { fontSize: 13, color: "var(--ink-3)", marginTop: 2 },
  loginActions: { display: "flex", gap: 8, marginTop: 16 },
  loginFootnote: { fontSize: 12.5, color: "var(--ink-4)", marginTop: 20, lineHeight: 1.5 },
  loginError: { fontSize: 13.5, color: "var(--crit-2)", marginTop: 8 },
  accountList: { display: "flex", flexDirection: "column", gap: 6, marginTop: 14 },
  accountRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    background: "var(--ground)",
    border: "1px solid var(--hair)",
    borderRadius: 8,
    padding: "7px 10px",
    fontSize: 13.5,
  },
  accountRowName: { fontWeight: 700, color: "var(--ink)" },
  accountRowMeta: { color: "var(--ink-3)" },
  accountActiveTag: { marginLeft: "auto", color: "var(--ok)", fontSize: 12.5, fontWeight: 700 },
  accountPendingTag: { marginLeft: "auto", color: "var(--hold)", fontSize: 12.5, fontWeight: 700 },
  removeBtn: {
    background: "transparent",
    border: "1px solid #3A2429",
    color: "var(--crit-2)",
    borderRadius: 5,
    padding: "3px 7px",
    fontFamily: display,
    fontSize: 13.5,
    lineHeight: 1.2,
    display: "flex",
    alignItems: "center",
  },

  primaryBtn: {
    background: "var(--flow)",
    border: "none",
    color: "var(--ground)",
    fontWeight: 700,
    borderRadius: 8,
    padding: "9px 16px",
    cursor: "pointer",
    fontFamily: display,
    fontSize: 15,
  },
  // One button shape for the whole app: a pill, in the display face, with a
  // real target height. The old ones were small mono-font rectangles left over
  // from before the redesign, and every screen had a few.
  primaryBtnSm: {
    background: "linear-gradient(180deg,#12805E,#0A5540)",
    border: "1px solid rgba(255,255,255,.16)",
    color: "#FFFFFF",
    fontWeight: 800,
    borderRadius: 999,
    padding: "9px 16px",
    minHeight: 40,
    cursor: "pointer",
    fontFamily: display,
    fontSize: 13.5,
    letterSpacing: -0.1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    boxShadow: "0 5px 14px rgba(14,107,79,.35)",
  },
  // The timeline button while the call is still missing its PCR author: still
  // legible, plainly not pressable, and in the same place it always is so the
  // crew are not hunting for it once the name is on.
  // The unavailable state of primaryBtnSm. Same pill and the same 40px tap
  // target: a button that shrinks when it is disabled shifts everything around
  // it, so a row of them jumps about as the board updates.
  primaryBtnSmBlocked: {
    background: "var(--raised)",
    border: "1px solid var(--hair-2)",
    color: "var(--ink-4)",
    fontWeight: 700,
    borderRadius: 999,
    minHeight: 40,
    padding: "9px 16px",
    cursor: "not-allowed",
    fontFamily: display,
    fontSize: 13.5,
    display: "flex",
    alignItems: "center",
    gap: 5,
  },
  ghostBtn: {
    background: "transparent",
    border: "1px solid var(--hair-2)",
    color: "var(--ink-2)",
    borderRadius: 8,
    padding: "9px 16px",
    cursor: "pointer",
    fontFamily: display,
    fontSize: 15,
  },
  ghostBtnSm: {
    background: "var(--veil)",
    border: "1px solid var(--hair-2)",
    color: "var(--ink-2)",
    borderRadius: 999,
    padding: "9px 16px",
    minHeight: 40,
    cursor: "pointer",
    fontFamily: display,
    fontSize: 13.5,
    fontWeight: 600,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  tabBtn: {
    flex: 1,
    background: "transparent",
    border: "1px solid var(--hair-2)",
    color: "var(--ink-3)",
    borderRadius: 8,
    padding: "7px 10px",
    cursor: "pointer",
    fontFamily: display,
    fontSize: 13.5,
  },
  tabBtnActive: {
    flex: 1,
    background: "var(--hair)",
    border: "1px solid var(--flow)",
    color: "var(--ink)",
    borderRadius: 8,
    padding: "7px 10px",
    cursor: "pointer",
    fontFamily: display,
    fontSize: 13.5,
  },
};
