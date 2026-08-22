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
let html = fs.readFileSync(template, "utf8");
if (!html.includes("<!--APP-->")) throw new Error("template has no <!--APP--> marker");
if (!html.includes("<!--VENDOR-JS-->")) throw new Error("template has no <!--VENDOR-JS--> marker");

// The libraries go in too, from vendor/ rather than from a CDN.
//
// unpkg is a free service with nobody on call for it. Loading the board's
// React from it meant somebody else's outage was our outage - the app would
// not open at all, which on a dispatch board at three in the morning is not
// an inconvenience. Inlining costs no extra bytes over fetching them (the
// same code arrives either way) and turns five requests into one.
const vendorDir = path.join(root, "vendor");
const readVendor = (f) => {
  const p = path.join(vendorDir, f);
  if (!fs.existsSync(p)) throw new Error(`vendor/${f} is missing - see vendor/README.md`);
  let text = fs.readFileSync(p, "utf8");
  if (f === "xlsx.js") text = fixOutlineAttribute(text);
  return text;
};

// xlsx-js-style writes a grouped column as BOTH outlineLevel="1" (correct) and
// level="1" (not an attribute <col> has). The stray one makes the file fail a
// strict reader outright - openpyxl refuses to open it - and risks Excel
// offering to "repair" a shift log. The grouping is what puts the extra
// columns behind a + on the dispatch sheet, so it has to work.
//
// One exact replacement, and a hard failure if the library changes underneath
// it, so upgrading xlsx tells you rather than quietly shipping broken files.
function fixOutlineAttribute(text) {
  const bad = "r.outlineLevel=r.level=t.level";
  const good = "r.outlineLevel=t.level";
  if (!text.includes(bad)) {
    throw new Error(
      "vendor/xlsx.js: the outlineLevel patch no longer applies. The library has " +
      "changed - check whether it still emits an invalid `level` attribute on <col> " +
      "before removing this (see vendor/README.md)."
    );
  }
  return text.split(bad).join(good);
}
// Order matters: react before react-dom, and both before the app.
const vendorJs = ["react.js", "react-dom.js", "xlsx.js", "leaflet.js"];
const vendorBlock =
  `<style>\n${readVendor("leaflet.css")}\n</style>\n` +
  vendorJs
    .map((f) => `<script>\n${readVendor(f).replace(/<\/script>/gi, "<\\/script>")}\n</script>`)
    .join("\n");
const vendorBytes = vendorBlock.length;
html = html.replace("<!--VENDOR-JS-->", () => vendorBlock);

// The replacement MUST be a function. A minified bundle is full of `$&`
// (from `x && y`), and in a replacement *string* `$&` is a special token
// meaning "the matched text" - it silently rewrote part of the app to
// `<!--APP-->&`. A function replacement does no $-substitution at all.
// Stamped at pack time so a device can be asked which build it is running.
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
const tag =
  "<script>window.__BUILD__=" + JSON.stringify(stamp) + ";</script>\n" +
  '<script>\n' + js.replace(/<\/script>/gi, "<\\/script>") + '\n</script>';
const out = html.replace("<!--APP-->", () => tag);
fs.writeFileSync(outFile, out);

const kb = (n) => (n / 1024).toFixed(0) + " KB";
console.log(
  `app ${kb(js.length)} + libraries ${kb(vendorBytes)} -> public/index.html (${kb(out.length)}), self-contained`
);
