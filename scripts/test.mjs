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

const ROOT = new URL("..", import.meta.url).pathname;

// Everything the tests reach for, re-exported from one place.
const ENTRY = `
export * from ${JSON.stringify(ROOT + "src/domain/op-day.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/coverage.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/in-service.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/uhu.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/checklist.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/restock.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/return-journeys.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/messages.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/uhu-person.jsx")};
export * from ${JSON.stringify(ROOT + "src/domain/crew-stamps.jsx")};
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

  const D = await import(pathToFileURL(outFile).href);
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
