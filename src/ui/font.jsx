
// ---------- font ----------

export function GlobalFont() {
  return (
    <style>{`
      * { box-sizing: border-box; }
      body { margin: 0; }
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-thumb { background: #28323D; border-radius: 4px; }
      button:focus-visible, select:focus-visible, input:focus-visible {
        outline: 2px solid #0A84FF;
        outline-offset: 2px;
      }
      /* The ambulance on the map. Built by Leaflet from an HTML string, so it
         cannot use the styles object and lives here instead. */
      .amb-icon { background: none; border: none; }
      .amb-marker {
        display: flex; flex-direction: column; align-items: center;
        line-height: 1; pointer-events: auto;
      }
      .amb-glyph {
        font-size: 26px; filter: drop-shadow(0 2px 4px rgba(0,0,0,.5));
        transform-origin: center;
      }
      .amb-label {
        margin-top: 2px; font-size: 10px; font-weight: 800; letter-spacing: .4px;
        color: #FFFFFF; background: rgba(10,14,20,.82); border-radius: 999px;
        padding: 2px 7px; white-space: nowrap;
      }
      /* A fix nobody has refreshed for three minutes stops looking certain. */
      .amb-stale { opacity: .45; }
      .amb-stale .amb-label { background: rgba(90,103,117,.9); }
      /* Leaflet paints its own controls light; the popup is made to match the
         board rather than the library. */
      .leaflet-popup-content-wrapper, .leaflet-popup-tip {
        background: #141A21; color: #F7F9FB;
      }
      .leaflet-popup-content { font-size: 12.5px; line-height: 1.5; }

      /* The two themes, as one set of tokens with two sets of values.
         Nothing in a component knows which is running: the attribute on the
         root element changes all of it at once. */
      :root {
        /* PulseOps. Navy, red and white, taken off the mark.
           The brand tokens are deliberately separate from the status ones. A
           board where red means "critical call" cannot also have red mean
           "our logo" in the same glance, so the brand red is used on the
           wordmark, the rules and the chrome — never to say something about a
           call. Status keeps its own five colours, untouched. */
        --brand:#E02B20; --brand-2:#F4564C; --brand-navy:#1E3A6E;
        --brand-navy-2:#2B54A0; --brand-deep:#132749;
        --ground:#070A11; --panel:#0D1219; --raised:#131A24; --inset:#101720;
        --inset-2:#16232F; --hair:#1B242F; --hair-2:#27323F; --hair-3:#33475A;
        --ink:#F7F9FB; --ink-alt:#F5F7FA; --ink-2:#D3DCE5; --ink-3:#93A2B1; --ink-4:#5A6775;
        --ok:#30D158; --flow:#0A84FF; --hold:#FF9F0A; --crit:#FF453A;
        --info:#5AC8FA; --gold:#E9C46A; --crit-2:#FF7A86; --hold-2:#FFC24D;
        --hold-3:#FFD98A; --flow-2:#93C5FD; --info-2:#6FD6F0; --move:#A78BFA; --land:#2DD4BF;
        --logo-plate:rgba(255,255,255,.94); --logo-pad:6px 10px; --logo-radius:10px;
        --veil:rgba(255,255,255,.055); --veil-2:rgba(255,255,255,.10);
        --lift:rgba(0,0,0,.38); --lift-2:rgba(0,0,0,.55);
        --bar:rgba(13,18,25,.78);
        color-scheme: dark;
      }
      /* Light is not the dark palette inverted — that gives grey text on grey.
         The surfaces go white and the ink goes near-black, and the status
         colours are darkened only as far as they need to read on white. */
      [data-theme="light"] {
        --brand:#C2201A; --brand-2:#9E1912; --brand-navy:#1E3A6E;
        --brand-navy-2:#2B54A0; --brand-deep:#EAF0FA;
        --ground:#F1F4F8; --panel:#FFFFFF; --raised:#FFFFFF; --inset:#EDF0F4;
        --inset-2:#E7EBF0; --hair:#DDE3EA; --hair-2:#C6D0DA; --hair-3:#AEBBC8;
        --ink:#0F1721; --ink-alt:#16202B; --ink-2:#2B3846; --ink-3:#59687A; --ink-4:#7A8798;
        --ok:#1E9E42; --flow:#0866CC; --hold:#B87200; --crit:#CC2A21;
        --info:#0E86B8; --gold:#9A7B1E; --crit-2:#C23B45; --hold-2:#9A6B00;
        --hold-3:#8A6410; --flow-2:#2563A8; --info-2:#0E7FA8; --move:#6D28D9; --land:#0F766E;
        --logo-plate:transparent; --logo-pad:0; --logo-radius:0;
        --veil:rgba(0,0,0,.07); --veil-2:rgba(0,0,0,.12);
        --lift:rgba(15,23,33,.10); --lift-2:rgba(15,23,33,.16);
        --bar:rgba(255,255,255,.82);
        color-scheme: light;
      }

      @keyframes pulse-dot {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.35; }
      }
      /* Motion, used only where it says something.

         Tiles arrive in sequence so the board reads as loading rather than
         appearing fully formed; a press physically compresses, so a tap is
         acknowledged before the network answers; and the no-coverage panel
         breathes, because the one state that must not be scrolled past should
         not sit still. Everything here stops under reduced motion. */
      @keyframes tile-rise {
        from { opacity: 0; transform: translateY(10px); }
        to   { opacity: 1; transform: none; }
      }
      @keyframes breathe {
        0%, 100% { box-shadow: 0 0 0 1px rgba(255,77,94,.18), 0 14px 34px rgba(255,77,94,.14); }
        50%      { box-shadow: 0 0 0 1px rgba(255,77,94,.45), 0 14px 40px rgba(255,77,94,.30); }
      }
      .tile-in { animation: tile-rise .45s cubic-bezier(.22,1,.36,1) backwards; }
      .tile-in:nth-child(1){ animation-delay:.02s } .tile-in:nth-child(2){ animation-delay:.05s }
      .tile-in:nth-child(3){ animation-delay:.08s } .tile-in:nth-child(4){ animation-delay:.11s }
      .tile-in:nth-child(5){ animation-delay:.14s } .tile-in:nth-child(6){ animation-delay:.17s }
      .tile-in:active { transform: scale(.975); }
      .breathing { animation: breathe 3.4s ease-in-out infinite; }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
          animation-duration: .001ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: .001ms !important;
        }
      }
      @keyframes slide-in {
        from { transform: translateY(-12px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      @keyframes alarm-flash {
        0%, 100% { background: rgba(127,14,14,0.96); }
        50% { background: rgba(220,38,38,0.96); }
      }
      @keyframes alarm-scale {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.04); }
      }
      /* The masthead has to survive a phone as well as a control-room screen:
         the crests stay at the two ends and the name stays between them, all
         three just smaller. Inline styles win over plain rules here, so these
         have to shout. */
      @media (max-width: 900px) {
        .brand-logo-wide { height: 52px !important; }
        .brand-logo-badge { height: 60px !important; }
      }
      @media (max-width: 620px) {
        .brand-bar { padding: 7px 12px !important; gap: 8px !important; }
        .brand-logo-wide { height: 38px !important; }
        .brand-logo-badge { height: 44px !important; }
      }
    `}</style>
  );
}