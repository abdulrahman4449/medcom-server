import { effectiveStatusMeta, liveRequestFor, statusMeta } from "../domain/in-service.jsx";
import { stationOf } from "../domain/live-sheet.jsx";
import { LOCATION_INTERVAL_MS, LOCATION_STALE_MS, clearPosition, mayTrack, positionAgeMs, writePosition } from "../domain/truck-locations.jsx";
import { useEffect, useRef, useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";

// ---------- the map ----------
//
// Leaflet, driven by hand rather than through a React wrapper: the whole
// surface is one div the library owns, and markers are created once and then
// moved. Re-rendering a map on every poll would make the trucks jump and would
// throw away whatever the dispatcher had panned to.
//
// A truck is an ambulance emoji rather than a pin, because the desk is reading
// this at a glance from across a room and a pin says "a place" while the emoji
// says "the vehicle". It rotates to its heading where the device reports one,
// and it fades as the fix ages — a dot that looks equally confident three
// minutes after its last update is a dot that lies.
// Leaflet takes HTML strings, so everything interpolated into one has to be
// escaped. Unit names are set by an administrator and call natures are typed at
// the desk — neither is hostile, but "typed by a person and rendered as HTML"
// is the whole shape of an injection, and a call nature is exactly the kind of
// free text somebody eventually pastes something odd into.
export function escHtml(v) {
  return String(v === null || v === undefined ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function FleetMap({ units, locations, requests, station }) {
  const holderRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());
  // Which set of trucks the view was last framed to.
  const framedRef = useRef("");
  const [tilesFailed, setTilesFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  // Build the map once.
  useEffect(() => {
    if (mapRef.current || !holderRef.current) return;
    if (typeof L === "undefined") return;
    const map = L.map(holderRef.current, {
      zoomControl: true,
      attributionControl: true,
    // Somewhere sane until the first truck reports. Zoomed out enough that a
    // desk seeing this before anybody is out does not think it is broken.
    }).setView([24.7136, 46.6753], 11);
    const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    });
    tiles.on("tileerror", () => setTilesFailed(true));
    tiles.addTo(map);
    mapRef.current = map;
    setReady(true);
    return () => {
      try {
        map.remove();
      } catch (e) {}
      mapRef.current = null;
      markersRef.current = new Map();
    };
  }, []);

  // Move the trucks.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || typeof L === "undefined") return;

    const mine = (units || []).filter((u) => !station || stationOf(u) === station);
    const live = [];

    mine.forEach((u) => {
      const fix = (locations || {})[u.id];
      const marker = markersRef.current.get(u.id);
      if (!fix || typeof fix.lat !== "number" || typeof fix.lng !== "number") {
        if (marker) {
          map.removeLayer(marker);
          markersRef.current.delete(u.id);
        }
        return;
      }
      live.push([fix.lat, fix.lng]);
      const age = positionAgeMs(fix, now) || 0;
      const stale = age > LOCATION_STALE_MS;
      const req = (requests || []).find((r) => r && r.id === fix.requestId);
      const html =
        `<div class="amb-marker${stale ? " amb-stale" : ""}">` +
        `<div class="amb-glyph"${fix.heading !== null && fix.heading !== undefined ? ` style="transform:rotate(${Math.round(fix.heading)}deg)"` : ""}>🚑</div>` +
        `<div class="amb-label">${escHtml(u.name)}</div>` +
        `</div>`;
      const icon = L.divIcon({
        html,
        className: "amb-icon",
        iconSize: [64, 46],
        iconAnchor: [32, 23],
      });
      const popup =
        `<strong>${escHtml(u.name)}</strong><br/>` +
        `${escHtml(effectiveStatusMeta(u, requests).label)}<br/>` +
        (req ? `${escHtml(req.nature)}<br/>` : "") +
        `Updated ${age < 60000 ? "just now" : `${Math.round(age / 60000)} min ago`}` +
        (fix.accuracy ? `<br/>Accurate to about ${Math.round(fix.accuracy)} m` : "") +
        (fix.byName ? `<br/>From ${escHtml(fix.byName)}` : "");

      if (marker) {
        marker.setLatLng([fix.lat, fix.lng]);
        marker.setIcon(icon);
        marker.setPopupContent(popup);
      } else {
        const m = L.marker([fix.lat, fix.lng], { icon }).addTo(map).bindPopup(popup);
        markersRef.current.set(u.id, m);
      }
    });

    // Frame whatever is out, but only when the SET of trucks changes.
    //
    // The old guard compared the marker count with the number of live fixes —
    // which the loop immediately above had just made equal, every time. It
    // could never be true, so the map never framed anything and sat on its
    // hard-coded default view while the ambulances were somewhere off-screen.
    // Comparing the ids catches a truck arriving or leaving and ignores the
    // per-minute movement, so a dispatcher who has panned somewhere stays
    // where they put themselves.
    const key = Array.from(markersRef.current.keys()).sort().join("|");
    if (live.length > 0 && key !== framedRef.current) {
      framedRef.current = key;
      try {
        map.fitBounds(L.latLngBounds(live), { padding: [50, 50], maxZoom: 15 });
      } catch (e) {}
    }
    if (live.length === 0) framedRef.current = "";
  }, [units, locations, requests, station, now, ready]);

  const mineHere = (units || []).filter((u) => !station || stationOf(u) === station);
  const tracked = mineHere.filter((u) => (locations || {})[u.id]);
  // Out on a call, but nothing is arriving from them. "Nobody out" while a
  // truck is plainly on a call is the sort of thing that gets read as the map
  // being broken; naming them says which truck and lets the desk ask.
  const outWithoutFix = mineHere.filter(
    (u) => !(locations || {})[u.id] && liveRequestFor(u, requests)
  );

  return (
    <div style={styles.mapWrap}>
      <div style={styles.mapHead}>
        <span style={styles.mapTitle}>LIVE POSITIONS</span>
        <span style={styles.mapCount}>
          {tracked.length
            ? `${tracked.length} truck${tracked.length === 1 ? "" : "s"} sharing`
            : outWithoutFix.length
            ? `${outWithoutFix.length} out · no position`
            : "nobody out"}
        </span>
      </div>

      <div ref={holderRef} style={styles.mapCanvas} />

      {tilesFailed && (
        <div style={styles.mapWarn}>
          The map background could not be loaded — the network may be blocking it. The ambulances
          below are still in the right places.
        </div>
      )}

      {/* The same trucks as a list, because the map answers "where" and this
          answers "how long ago", which is the question that decides whether to
          trust the dot. */}
      <div style={styles.mapList}>
        {tracked.length === 0 && outWithoutFix.length === 0 ? (
          <div style={styles.formHint}>
            Positions appear here while a truck is out on a call. Tracking starts when a crew is
            dispatched and stops when they go back in service.
          </div>
        ) : (
          tracked.map((u) => {
            const fix = locations[u.id];
            const age = positionAgeMs(fix, now) || 0;
            const stale = age > LOCATION_STALE_MS;
            return (
              <div key={u.id} style={styles.mapRow}>
                <span style={styles.mapRowName}>{u.name}</span>
                <span style={{ ...styles.mapRowStatus, color: effectiveStatusMeta(u, requests).color }}>
                  {effectiveStatusMeta(u, requests).label}
                </span>
                <span style={stale ? styles.mapRowAgeStale : styles.mapRowAge}>
                  {age < 60000 ? "just now" : `${Math.round(age / 60000)} min ago`}
                </span>
                {fix.accuracy ? <span style={styles.mapRowAcc}>±{fix.accuracy} m</span> : null}
              </div>
            );
          })
        )}

        {/* Out, but silent. Usually the crew's tablet is locked, or the Alpha
            seat has not answered the location question. Either way the desk
            should see the truck listed rather than conclude the map is
            broken. */}
        {outWithoutFix.map((u) => (
          <div key={u.id} style={styles.mapRow}>
            <span style={styles.mapRowName}>{u.name}</span>
            <span style={{ ...styles.mapRowStatus, color: effectiveStatusMeta(u, requests).color }}>
              {effectiveStatusMeta(u, requests).label}
            </span>
            <span style={styles.mapRowNoFix}>no position — tablet asleep, or not shared</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// The tracker itself.
//
// It runs only when all four of these are true: the crew are on a call, this
// device holds the Alpha seat, this person has said yes, and the browser will
// give a position. Any one of them going false stops it — and going back in
// service also deletes the stored fix, so the truck leaves the map rather than
// sitting on it at the last place it was seen.
//
// watchPosition rather than a timer around getCurrentPosition: the browser
// keeps one fix warm and hands it over, instead of waking the GPS cold every
// minute. What is throttled is the WRITING — one save a minute — because the
// board is sent whole on every write and a position every second would be a
// board sent every second.
export function useTracking({ unit, request, user, consents, setLocations, active, responsible }) {
  const [state, setState] = useState("off"); // off | on | refused
  const [lastTs, setLastTs] = useState(null);
  const [error, setError] = useState("");
  const watchRef = useRef(null);
  const lastWriteRef = useRef(0);
  const clearedForRef = useRef(null);

  const accountId = user && user.accountId;
  const allowed = mayTrack(consents, accountId);

  useEffect(() => {
    const stop = () => {
      if (watchRef.current !== null && navigator.geolocation) {
        try {
          navigator.geolocation.clearWatch(watchRef.current);
        } catch (e) {}
      }
      watchRef.current = null;
    };

    if (!active) {
      stop();
      setState("off");
      // Back in service: take the truck off the map.
      //
      // Only from the device that would have been sending. Bravo's tablet also
      // has `active` false — it is not the Alpha seat — and without this guard
      // it deleted the position Alpha was publishing, every poll, for the whole
      // call. The truck simply never appeared on the map whenever both crew had
      // the app open, which is most of the time.
      //
      // Guarded once per unit as well, so an idle screen is not writing to the
      // board on every render.
      if (responsible && unit && clearedForRef.current !== unit.id) {
        clearedForRef.current = unit.id;
        clearPosition(unit.id).then((next) => {
          if (next) setLocations(next);
        });
      }
      setLastTs(null);
      return;
    }

    clearedForRef.current = null;

    if (!allowed) {
      stop();
      setState("refused");
      return;
    }

    if (!navigator.geolocation) {
      stop();
      setState("on");
      setError("this device has no location service");
      return;
    }

    setState("on");
    setError("");
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setError("");
        const now = Date.now();
        if (now - lastWriteRef.current < LOCATION_INTERVAL_MS) return;
        lastWriteRef.current = now;
        writePosition({
          unit,
          coords: pos.coords,
          byName: (user && user.name) || "",
          accountId,
          requestId: request ? request.id : null,
        }).then((next) => {
          if (next) {
            setLocations(next);
            setLastTs(now);
          }
        });
      },
      (err) => {
        // Denied at the OS level is a different thing from consent given in the
        // app, and the crew should be told which one stopped it.
        setError(
          err && err.code === 1
            ? "the device refused permission — check location is on for this app"
            : err && err.code === 3
            ? "no fix yet"
            : "the device could not get a position"
        );
      },
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 25000 }
    );

    return stop;
  }, [active, responsible, allowed, unit && unit.id, request && request.id, accountId]);

  return { state, lastTs, error };
}