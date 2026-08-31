// npm test — the domain rules, run for real.
//
// `npm run check` reads the code; this runs it. The modules are .jsx and import
// each other, so they are bundled with the esbuild that is already a dependency
// and executed in one go, with the handful of browser globals the domain layer
// touches stubbed out. No test framework: a hundred and fifty assertions do not
// need one, and a dependency that has to be installed is a dependency that will
// one day not be.
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = new URL("..", import.meta.url).pathname;

// Everything the tests reach for, re-exported from one place.
const ENTRY = `
export * from ${JSON.stringify(ROOT + "src/domain/op-day.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/coverage.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/in-service.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/uhu.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/checklist.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/restock.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/close-reasons.jsx")};
export { responseCompliance, responseMsFor, isInternalEmergency, RESPONSE_TARGET_MS } from ${JSON.stringify(ROOT + "src/domain/compliance.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/return-journeys.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/messages.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/uhu-person.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/crew-stamps.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/overtime.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/patient-records.jsx")};
export * from ${JSON.stringify(ROOT + "src/ui/booking-cancel.jsx")};
export * from ${JSON.stringify(ROOT + "src/ui/PastCall.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/delegation.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/stat-range.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/crew-roster.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/return-journeys.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/stat-source.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/rush.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/shift-log.jsx")};
export { dedupeById } from ${JSON.stringify(ROOT + "src/lib/helpers.jsx")};
export { staffStatsFor, departmentUhu, categoryMixRows, responseNote } from ${JSON.stringify(ROOT + "src/ui/Statistics.jsx")};
export { CALL_CATEGORIES } from ${JSON.stringify(ROOT + "src/domain/sheet-vocabulary.jsx")};
export * from ${JSON.stringify(ROOT + "src/lib/board-size.jsx")};
export { toneKeyFor } from ${JSON.stringify(ROOT + "src/lib/dates.jsx")};
export { REQ_STATUS, reqStatusMeta } from ${JSON.stringify(ROOT + "src/domain/constants.jsx")};
export { requestOutcomeKey, requestOutcomeLabel } from ${JSON.stringify(ROOT + "src/domain/second-ambulance.jsx")};
`;

const dir = mkdtempSync(join(tmpdir(), "pulseops-test-"));
try {
  const entryFile = join(dir, "entry.mjs");
  writeFileSync(entryFile, ENTRY);
  const outFile = join(dir, "domain.mjs");
  await build({
    entryPoints: [entryFile],
    bundle: true,
    format: "esm",
    outfile: outFile,
    loader: { ".jsx": "jsx" },
    jsxFactory: "h",
    logLevel: "silent",
  });

  // The domain layer reads a few browser things at module scope. None of them
  // are exercised by these rules; they only have to exist.
  globalThis.window = {
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout, clearTimeout, Capacitor: null,
  };
  globalThis.document = { title: "", addEventListener() {} };
  globalThis.localStorage = globalThis.window.localStorage;
  // navigator is a getter-only global on modern Node, so it is defined rather
  // than assigned. It only has to answer vibrate() without throwing.
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { vibrate() {}, userAgent: "node" },
  });
  globalThis.React = {
    useState() {}, useEffect() {}, useRef: () => ({ current: null }),
    useCallback: (f) => f,
  };

  const bundled = await import(pathToFileURL(outFile).href);
  // The record merge is the server's, and the server is CommonJS. It is pulled
  // in beside the domain because it is now the thing standing between a device
  // with an old copy of the board and everybody else's work.
  const require_ = createRequire(pathToFileURL(join(ROOT, "package.json")).href);
  const D = {
    ...bundled,
    ...require_(join(ROOT, "lib/merge-records.cjs")),
    // Namespaced, because the app has a list of the same areas for its screens
    // and the point of the test is that the two agree.
    serverDelegation: require_(join(ROOT, "lib/delegation.cjs")),
  };
  const { run } = await import(pathToFileURL(join(ROOT, "tests/domain.test.mjs")).href);

  let passed = 0;
  const failures = [];
  const t = {
    ok(name, cond, detail = "") {
      if (cond) passed++;
      else failures.push(name + (detail ? "\n      " + detail : ""));
    },
    is(name, got, want) {
      const same = JSON.stringify(got) === JSON.stringify(want);
      if (same) passed++;
      else failures.push(`${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
    },
  };

  run(D, t);

  if (failures.length) {
    console.error(`\n${passed} passed, ${failures.length} FAILED\n`);
    failures.forEach((f) => console.error("  x " + f));
    process.exit(1);
  }
  console.log(`OK - ${passed} domain rules hold`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
