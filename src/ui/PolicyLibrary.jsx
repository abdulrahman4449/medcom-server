import { gregDateTimeStr } from "../lib/dates.jsx";
import { uid } from "../lib/helpers.jsx";
import { useState } from "../lib/react.jsx";
import { styles } from "../styles.jsx";
import { bytesStr } from "./storage-banner.jsx";

// ---------- department policies ----------
//
// The desk is where the policy questions land — can this patient travel with a
// relative, who authorises an out-of-area transfer, what happens when a ward
// disputes a category — and the answers currently live in a folder somebody has
// to get up and find, or in the memory of whoever has been there longest.
//
// So they belong on the board, one tap from the screen the question arrives at.
// The content is the department's to write; the shelf it sits on is this. Each
// policy is a heading and a body, held in the same key/value store as
// everything else, so the department edits them in one place and every desk has
// them immediately.
export const POLICY_KEY = "ems:policies";

// A policy is a document the department already has — a PDF signed off by
// somebody, or a photograph of the laminated sheet on the wall. Retyping it
// into a text box would create a second version that can drift from the real
// one, and a dispatcher acting on a stale copy of a policy is worse off than
// one who went and found the folder.
//
// So administration uploads the file and the app shows it. Crews and
// dispatchers can only read.
//
// Held as a data URL in the board store like everything else. That caps what is
// sensible to upload — a few megabytes, not a scanned book — and the uploader
// is told so rather than left wondering why a save failed.
export const POLICY_MAX_BYTES = 4 * 1024 * 1024;

export function policyList(policies) {
  return Array.isArray(policies) ? policies.filter(Boolean) : [];
}

export function policyIsImage(pol) {
  return !!(pol && pol.mime && pol.mime.startsWith("image/"));
}


// What everybody except administration sees: the shelf, read-only.
export function PolicyLibrary({ policies, canManage, onAdd, onRemove, busy }) {
  const list = policyList(policies);
  // What the shelf costs. Held as data URLs, so roughly a third bigger on the
  // wire than the file was on disk.
  const shelfBytes = list.reduce(
    (n, p) => n + (p.bytes || (p.data ? p.data.length * 0.75 : 0)),
    0
  );
  const [openId, setOpenId] = useState(null);
  // A name, then the file. The name is what the shelf is read by, and a
  // scanner's filename is not a name — "SCAN_0043" tells a dispatcher at 3am
  // nothing about which policy they are looking at. It is still optional: see
  // the button below for why.
  const [draftName, setDraftName] = useState("");

  return (
    <div style={styles.policyPage}>
      <div style={styles.policyPageHead}>
        <div>
          <div style={styles.policyEyebrow}>DEPARTMENT POLICIES</div>
          <div style={styles.policyTitle}>What the desk is expected to do</div>
        </div>
      </div>

      {/* The one store in the app with no cap on it.
          Everything else — the filed logs, the archive, the event log, the
          checklists — keeps a fixed window and settles at a ceiling. Scanned
          PDFs do not, so this is the thing that will actually fill a disk if
          anything does, and it says how much room it is taking. */}
      {canManage && list.length > 0 && (
        <div style={shelfBytes >= 60e6 ? styles.shelfWarn : styles.shelfNote}>
          {list.length} file{list.length === 1 ? "" : "s"} · {bytesStr(shelfBytes)} on the shelf
          {shelfBytes >= 60e6
            ? " — this is the only part of the board that grows without limit. Remove what is out of date, or scan at a lower resolution."
            : ". Nothing else on the board grows without limit; this does, so keep an eye on it."}
        </div>
      )}

      {canManage && (
        <div style={styles.policyAddRow}>
          <input
            style={styles.policyNameInput}
            value={draftName}
            maxLength={120}
            placeholder="Name of the policy (optional)"
            onChange={(e) => setDraftName(e.target.value)}
          />
          {/* The name is optional now.
              It used to be required, and the button sat grey until something
              was typed — with nothing on screen saying so. From the other side
              of it that is a dead button on a page with no way forward, which
              is exactly how it was reported. A file already has a name; if
              nobody types a better one, that is the name. */}
          <label style={busy ? styles.policyAddOff : styles.policyAdd}>
            {busy ? "Adding…" : "Attach PDF or picture"}
            <input
              type="file"
              accept="application/pdf,image/*"
              style={{ display: "none" }}
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                e.target.value = "";
                if (!f) return;
                // "Fleet Safety Policy v3.pdf" -> "Fleet Safety Policy v3"
                const fromFile = String(f.name || "").replace(/\.[^.]+$/, "").trim();
                onAdd(draftName.trim() || fromFile || "Untitled policy", f);
                setDraftName("");
              }}
            />
          </label>
        </div>
      )}

      {list.length === 0 ? (
        <div style={styles.formHint}>
          {canManage
            ? "Nothing here yet. Add the department's policies as PDFs or photographs of the printed sheets — whatever is already the signed-off version."
            : "No policies have been published yet. Administration adds them."}
        </div>
      ) : (
        <div style={styles.policyGrid}>
          {list.map((pol) => {
            const isOpen = openId === pol.id;
            return (
              <div key={pol.id} style={styles.policyItem}>
                <button
                  style={styles.policyItemHead}
                  onClick={() => setOpenId(isOpen ? null : pol.id)}
                >
                  <span style={styles.policyItemName}>
                    <span style={styles.policyKind}>{policyIsImage(pol) ? "IMAGE" : "PDF"}</span>
                    {pol.title}
                    {pol.bytes ? (
                      <span style={styles.policySize}>{bytesStr(pol.bytes)}</span>
                    ) : null}
                  </span>
                  <span style={styles.policyChevron}>{isOpen ? "−" : "+"}</span>
                </button>

                {isOpen && (
                  <div style={styles.policyViewer}>
                    {policyIsImage(pol) ? (
                      <img src={pol.data} alt={pol.title} style={styles.policyImage} />
                    ) : (
                      // A PDF in an object tag rather than an iframe: the
                      // fallback inside it is what a webview without a PDF
                      // renderer shows, instead of a blank rectangle.
                      <object data={pol.data} type="application/pdf" style={styles.policyPdf}>
                        <div style={styles.policyNoView}>
                          This device cannot show a PDF inline.
                          <a href={pol.data} target="_blank" rel="noreferrer" style={styles.legalLink}>
                            {" "}Open it in a new tab
                          </a>
                          .
                        </div>
                      </object>
                    )}
                    <div style={styles.policyMeta}>
                      Added {pol.addedAt ? gregDateTimeStr(pol.addedAt) : "—"}
                      {pol.addedBy ? ` by ${pol.addedBy}` : ""}
                      {canManage && (
                        <button style={styles.policyRemove} onClick={() => onRemove(pol)}>
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Reading the file in, and the two guards that matter: a size the board store
// can carry, and a type somebody can actually open.
export function readPolicyFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("no file"));
    const ok = file.type === "application/pdf" || file.type.startsWith("image/");
    if (!ok) return reject(new Error("Only a PDF or an image can be added."));
    if (file.size > POLICY_MAX_BYTES) {
      return reject(
        new Error(
          `That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${POLICY_MAX_BYTES / 1048576} MB — ` +
            `scan it at a lower resolution, or split it.`
        )
      );
    }
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("The file could not be read."));
    fr.onload = () =>
      resolve({
        id: uid("pol"),
        title: file.name.replace(/\.[^.]+$/, ""),
        mime: file.type,
        bytes: file.size,
        data: String(fr.result || ""),
        addedAt: Date.now(),
      });
    fr.readAsDataURL(file);
  });
}