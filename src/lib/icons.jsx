
// ---------- lightweight icon shims (no icon package needed for a static HTML file) ----------
export function makeIcon(glyph) {
  return function Icon({ size = 16, color, style, ...rest }) {
    return (
      <span
        {...rest}
        style={{
          display: "inline-block",
          fontSize: size,
          lineHeight: 1,
          color,
          fontStyle: "normal",
          ...style,
        }}
      >
        {glyph}
      </span>
    );
  };
}
export const AlertTriangle = makeIcon("⚠");
export const MapPin = makeIcon("📍");
export const Clock = makeIcon("🕒");
export const Radio = makeIcon("📡");
export const LogOut = makeIcon("⏻");
export const Users = makeIcon("👥");
export const PhoneIncoming = makeIcon("📞");
export const CheckCircle2 = makeIcon("✓");
export const Plus = makeIcon("+");
export const ChevronRight = makeIcon("›");
export const Bell = makeIcon("🔔");
export const ClipboardList = makeIcon("📋");
export const BookOpen = makeIcon("📖");
export const Share2 = makeIcon("⤴");
export const Trash = makeIcon("🗑");
export const CalendarClock = makeIcon("🗓");
export const Archive = makeIcon("🗂");
export const ArrowRight = makeIcon("→");
export const ChevronDown = makeIcon("⌄");
export const Volume2 = makeIcon("🔊");
export const Ambulance = makeIcon("🚑");
export const HandRaised = makeIcon("🙋");
export const Ban = makeIcon("⛔");
export const CircleSlash = makeIcon("🚫");
export const FileSignature = makeIcon("📝");
export const VolumeX = makeIcon("🔇");
export const Ruler = makeIcon("📏");
export const Tag = makeIcon("🏷");
export const PencilLine = makeIcon("✎");
export const ShieldAlert = makeIcon("🛡");
export const MessageSquare = makeIcon("💬");
export const Reply = makeIcon("↩");
export const Search = makeIcon("🔎");
export const RotateCcw = makeIcon("↺");
export const Save = makeIcon("💾");
export function Circle({ size = 8, fill, color, style, ...rest }) {
  return (
    <span
      {...rest}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: fill || color,
        ...style,
      }}
    />
  );
}