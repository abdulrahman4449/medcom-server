// Builds public/index.html from src/ and public/index.template.html.
//
// The app used to be one hand-written 28,000-line file that every phone
// compiled in its own browser at launch. Now the source lives in src/ as
// ~78 modules, esbuild packs them into one script here, and the result is
// inlined into a single self-contained index.html - the same one file the
// server serves and the native shell bundles.
//
//   npm run build
//
// public/index.html is GENERATED. Never edit it by hand: the next build
// overwrites it. Edit the files in src/ instead.
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const root = path.dirname(new URL(import.meta.url).pathname);
const template = path.join(root, "public", "index.template.html");
const outFile = path.join(root, "public", "index.html");

const result = await esbuild.build({
  entryPoints: [path.join(root, "src", "main.jsx")],
  bundle: true,
  write: false,
  format: "iife",
  target: ["es2019"],
  // React, ReactDOM, XLSX and Leaflet stay as page globals, exactly as the
  // hand-written file expected them. Classic runtime, so JSX compiles to
  // React.createElement rather than an import of react/jsx-runtime.
  jsx: "transform",
  jsxFactory: "React.createElement",
  jsxFragment: "React.Fragment",
  loader: { ".jsx": "jsx" },
  legalComments: "none",
  minify: process.env.NO_MINIFY ? false : true,
  logLevel: "warning",
});

const js = result.outputFiles[0].text;
const html = fs.readFileSync(template, "utf8");
if (!html.includes("<!--APP-->")) throw new Error("template has no <!--APP--> marker");

// The replacement MUST be a function. A minified bundle is full of `$&`
// (from `x && y`), and in a replacement *string* `$&` is a special token
// meaning "the matched text" - it silently rewrote part of the app to
// `<!--APP-->&`. A function replacement does no $-substitution at all.
const tag = '<script>\n' + js.replace(/<\/script>/gi, "<\\/script>") + '\n</script>';
const out = html.replace("<!--APP-->", () => tag);
fs.writeFileSync(outFile, out);

const kb = (n) => (n / 1024).toFixed(0) + " KB";
console.log(`bundled ${kb(js.length)} of script -> public/index.html (${kb(out.length)})`);
