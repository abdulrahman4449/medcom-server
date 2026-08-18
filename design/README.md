# The approved design direction

Signed off on 18 August 2026. **When the ask is "remodel the app" or "the
next big patch", this is the target** — not a fresh exploration. Read this
before redesigning anything.

Canvas (six screens, pan/zoom, exportable):
<https://claude.ai/code/artifact/fc227bd3-e98e-48ae-979e-c0118fd43373>

The artboard sources sit next to this file. They are design mockups, not
application code — nothing here is loaded by the app, and `public/index.html`
is still the only thing that ships.

## The rule this direction is built on

A dispatcher must be able to read the state of the room in one second, from
across that room, at three in the morning. Every decision below serves that
and nothing else. If a change makes the board prettier and slower to read,
it is the wrong change.

## What was approved

| Screen | File | What it establishes |
|---|---|---|
| Dispatcher board (dark) | `Main.dc.html` | The main board: room-state strip, fleet grid, active calls rail |
| Call detail | `CallDetail.dc.html` | The five stamps as a real stepper |
| Crew "My call" | `CrewCall.dc.html` | Phone/tablet: one obvious next action |
| Admin statistics | `Stats.dc.html` | Per-person UHU, coverage, response |
| Sign in | `Login.dc.html` | Role tabs, disclaimer, policy links |
| Dispatcher board (light) | `BoardLight.dc.html` | The same board in the light theme |

## The five decisions that matter

1. **A room-state strip across the top of the board.** Available / on a call /
   out of service / calls this shift. Four numbers, large. This is the
   one-second read, and it is the single biggest change from today's board,
   where the same question is answered by counting cards.

2. **NO COVERAGE is the only thing allowed to alarm.** A full-width band with
   a running timer, and nothing else on the board competes with it. The
   moment a second element shouts, the first one stops meaning anything.

3. **Status is carried by colour *and* position.** A 4px bar across the top of
   every unit card, plus a dot, plus the word. It survives distance and it
   survives colour blindness. Colour alone never carries a state.

4. **The crew screen has exactly one primary button** — the next stamp,
   whatever it happens to be. Everything else is secondary and quieter. A
   paramedic at a bedside is not browsing.

5. **The call timeline is a stepper, not a list of times.** Ticks behind, a
   ring on the current step, nothing ahead. "Where are we in this call" has
   to be answerable without reading.

## Tokens — unchanged

This direction deliberately introduces **no new colours, fonts or radii**. It
uses the app's existing system, so it extends what is there instead of
replacing it. Anything built from these mockups must keep using the CSS
variables in `public/index.html`:

- Layers `--ground` `#07090C` · `--panel` `#0E1217` · `--raised` `#141A21` · `--inset` `#11161C`
- Text `--ink` `#F7F9FB` · `--ink-2` `#D3DCE5` · `--ink-3` `#93A2B1` · `--ink-4` `#5A6775`
- Status `--ok` `#30D158` · `--hold` `#FF9F0A` · `--flow` `#0A84FF` · `--crit` `#FF453A` · `--move` `#A78BFA`
- Cards: 16px radius, `1px solid var(--hair)`, `0 6px 18px var(--lift)`
- Type: the existing `display` system font stack. No webfont.
- Numbers that change (clocks, timers, MRNs) are tabular — `font-variant-numeric: tabular-nums`.

Light values come from the existing `[data-theme="light"]` block. Both themes
must keep working; the board is used in a lit office and a dark control room.

## Open questions, not yet decided

- The fleet grid is 4-up, which suits 8 vehicles. It needs a rethink at 20 —
  probably density tiers rather than more columns.
- The hour-by-hour coverage strip on the statistics screen is new. It may be
  more detail than anyone wants; confirm before building it.
- Touch targets in the mockups are sized for the crew tablet. The dispatcher
  board assumes a mouse and a large screen.

## Rebuilding or extending the canvas

Re-seed from the sources here with the `design` skill rather than starting
over, so the canvas keeps its URL and its history. If the canvas has been
edited in the browser since, read the live version back first — those edits
are the newer truth, not these files.
