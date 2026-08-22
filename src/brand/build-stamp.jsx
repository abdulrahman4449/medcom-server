// Which build is actually on this device.
//
// Written because a whole round of testing was spent on a fault that had
// already been fixed: the phone was still running the previous build, and
// nothing on the screen could tell anybody that. "Did the new version land?"
// has to be answerable by looking, not by remembering which commands were run.
//
// The value is stamped in by build.mjs at the moment the file is packed, so it
// cannot drift from the bundle it sits in.
export const BUILD_STAMP =
  (typeof window !== "undefined" && window.__BUILD__) || "dev";
