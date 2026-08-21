// The checks that have to pass before public/index.html is rebuilt.
//
//   npm run check
//
// The app used to be one text/babel block and these ran over that block. It is
// now src/, so they run per module instead. What they are looking for has not
// changed:
//
//   1. every module parses;
//   2. every name a module uses is either a browser global, declared locally,
//      or imported. Babel and esbuild both build a module that names something
//      it never imported - it only fails when that line runs, which is how a
//      black screen ships;
//   3. nothing is declared twice, including keys inside the styles object.
import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import * as t from "@babel/types";
const traverse = _traverse.default || _traverse;

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SRC = path.join(root, "src");

const GLOBALS = new Set([
  "window","document","console","navigator","location","localStorage","sessionStorage",
  "fetch","Promise","Symbol","Map","Set","WeakMap","JSON","Math","Date","Object","Array",
  "String","Number","Boolean","Error","RegExp","isNaN","parseInt","parseFloat","isFinite",
  "setTimeout","clearTimeout","setInterval","clearInterval","requestAnimationFrame",
  "cancelAnimationFrame","encodeURIComponent","decodeURIComponent","encodeURI","decodeURI",
  "alert","confirm","prompt","FileReader","Blob","File","FormData","URL","URLSearchParams",
  "Notification","AudioContext","webkitAudioContext","SpeechSynthesisUtterance","speechSynthesis",
  "Intl","TextEncoder","TextDecoder","btoa","atob","crypto","Uint8Array","ArrayBuffer",
  "React","ReactDOM","L","XLSX","undefined","NaN","Infinity",
  "globalThis","self","performance","structuredClone","AbortController","Event","CustomEvent",
  "Image","Audio","MutationObserver","IntersectionObserver","ResizeObserver","matchMedia",
  "DataView","Float32Array","Int32Array","Uint8ClampedArray","Proxy","Reflect","WeakSet",
  "queueMicrotask","history","screen","getComputedStyle","HTMLElement","Node","process",
  "caches","indexedDB",
]);

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith(".jsx")) files.push(p);
  }
})(SRC);

let failures = 0;
const declared = new Map(); // name -> module, for the summary line
// What each module exports, and what each module asks other modules for. An
// import statement creates a binding whether or not the other file actually
// exports that name, so "every name resolves" is not enough on its own: a
// component imported from the wrong module passes that check and fails the
// build. Collected here and cross-checked once every file has been read.
const exportsOf = new Map();
const importsOf = [];

for (const file of files) {
  const rel = path.relative(root, file);
  const src = fs.readFileSync(file, "utf8");
  let ast;
  try {
    ast = parse(src, { sourceType: "module", plugins: ["jsx"] });
  } catch (e) {
    console.log(`${rel}: DOES NOT PARSE - ${e.message}`);
    failures++;
    continue;
  }

  // 2. names that nothing binds
  const missing = new Map();
  traverse(ast, {
    ReferencedIdentifier(p) {
      const n = p.node.name;
      if (t.isJSXIdentifier(p.node) && !/^[A-Z]/.test(n)) return; // <div>, <span>
      if (GLOBALS.has(n)) return;
      if (p.scope.hasBinding(n, true)) return;                    // includes imports
      if (!missing.has(n)) missing.set(n, p.node.loc.start.line);
    },
  });
  if (missing.size) {
    failures++;
    console.log(`${rel}: ${missing.size} unresolved`);
    for (const [n, line] of missing) console.log(`   line ${line}  ${n}`);
  }

  // 3a. the same top-level name declared twice in this module. Two modules may
  // of course each have their own `req` - that is what module scope is for -
  // so this is per file, not across the tree.
  const here = new Set();
  for (let node of ast.program.body) {
    if (node.type === "ExportNamedDeclaration" && node.declaration) node = node.declaration;
    let names = [];
    if (node.type === "FunctionDeclaration") names = node.id ? [node.id.name] : [];
    // getBindingIdentifiers on a function would also hand back its parameters.
    else if (node.type === "VariableDeclaration")
      names = node.declarations.flatMap((d) => Object.keys(t.getBindingIdentifiers(d.id)));
    else continue;
    for (const name of names) {
      if (here.has(name)) { console.log(`${rel}: declared twice - ${name}`); failures++; }
      here.add(name);
      declared.set(name, rel);
    }
  }

  // 2b. what this module exports, and what it asks of others
  const exported = new Set();
  for (const node of ast.program.body) {
    if (node.type !== "ExportNamedDeclaration") continue;
    if (node.declaration) {
      for (const n of Object.keys(t.getBindingIdentifiers(node.declaration))) exported.add(n);
    }
    for (const sp of node.specifiers || []) exported.add(sp.exported.name || sp.exported.value);
  }
  exportsOf.set(rel, exported);
  for (const node of ast.program.body) {
    if (node.type !== "ImportDeclaration") continue;
    const from = node.source.value;
    if (!from.startsWith(".")) continue;
    const target = path.relative(root, path.resolve(path.dirname(file), from));
    for (const sp of node.specifiers || []) {
      if (sp.type !== "ImportSpecifier") continue;
      importsOf.push({ file: rel, name: sp.imported.name, target, line: node.loc.start.line });
    }
  }

  // 3b. duplicate keys inside the one styles object, where the later silently wins
  traverse(ast, {
    VariableDeclarator(p) {
      if (p.node.id.name !== "styles" || p.node.init?.type !== "ObjectExpression") return;
      const keys = new Map();
      for (const pr of p.node.init.properties) {
        const k = pr.key && (pr.key.name || pr.key.value);
        if (k == null) continue;
        if (keys.has(k)) { console.log(`${rel}: duplicate style key "${k}" (lines ${keys.get(k)} and ${pr.loc.start.line})`); failures++; }
        else keys.set(k, pr.loc.start.line);
      }
    },
  });
}

// Every named import must actually be exported by the file it names.
for (const imp of importsOf) {
  const has = exportsOf.get(imp.target);
  if (!has) { console.log(`${imp.file}:${imp.line} imports from ${imp.target}, which is not a module here`); failures++; continue; }
  if (!has.has(imp.name)) {
    console.log(`${imp.file}:${imp.line} imports "${imp.name}" from ${imp.target}, which does not export it`);
    failures++;
  }
}

console.log(failures
  ? `\nFAILED - ${failures} problem${failures === 1 ? "" : "s"} across ${files.length} modules`
  : `OK - ${files.length} modules parse, resolve, import and declare cleanly`);
process.exit(failures ? 1 : 0);
