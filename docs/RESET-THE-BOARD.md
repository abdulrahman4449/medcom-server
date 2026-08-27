# Starting the board again from nothing

Everything the app has ever been told lives in **one SQLite file** on the
Render disk. There is no "reset" button in the app on purpose — wiping a
department's board is not something a mis-tap should be able to do — so it is
done from the Render shell, and it takes about two minutes.

Nothing below is reversible except from a backup, so **read the backup step
first**.

---

## 0. Before anything: take a backup you can actually get back

The server already makes its own copies — on every start and every 24 hours —
into `BACKUP_DIR` (by default `/data/backups`, beside the database). Deleting
the database does **not** delete those, so a reset done by mistake is
recoverable. Make a fresh one anyway, so the newest copy is from a minute ago
rather than from this morning:

1. Render → your `medcom-dispatch` service → **Shell**.
2. Run:

   ```
   curl -s -X POST http://localhost:$PORT/api/backups
   ```

   It answers with the file it wrote. `ls -lh /data/backups` shows them all.

**These files contain patient MRNs.** If you pull one off the server, it goes
where the department keeps confidential records — not a personal laptop folder
and not a consumer cloud drive.

---

## 1. Which reset do you actually want?

| | What it clears | What it keeps |
|---|---|---|
| **A — everything** | calls, crews, shifts, logs, kept days, inventory, policies, checklists, messages, **and every account** | nothing |
| **B — the board only** | calls, crews, shifts, logs, kept days, inventory, policies, checklists, messages | **all accounts and passwords** |
| **C — named keys** | only what you list | everything else |

For "start the next phase with a clean slate but the same staff already on
file", **B** is the one you want. For a genuine factory reset, **A**.

---

## A. Everything, including the accounts

In the Render shell:

```
ls -l /data
rm -f /data/board.db /data/board.db-wal /data/board.db-shm
```

The two sidecar files matter. SQLite keeps recent writes in `-wal`, so deleting
only `board.db` leaves the last few minutes of the old board behind to be
replayed.

Then **Manual Deploy → Restart service**.

On the next start the server creates an empty database and seeds the two
accounts it always seeds, **neither with a password**:

- `F1525518` — administrator
- `D1000001` — dispatcher

**Read the deploy log.** A fresh board prints a one-time sign-in code for
`F1525518`, in a box, once:

```
  ┌──────────────────────────────────────────────────────────┐
  │  FIRST SIGN-IN                                           │
  │  Employee ID    F1525518                                 │
  │  Sign-in code   XXXX-XXXX                                │
  │  Valid for 7 days, and once only.                        │
  └──────────────────────────────────────────────────────────┘
```

That code is the only way into a new board — an employee ID on its own is not
enough, deliberately. Sign in as `F1525518` with it, choose a password, then add
the real staff from **Teams → Add crew / Add dispatcher / Add admin**. Each new
account comes with its own code, shown once on screen; write it down before
dismissing it, because it cannot be read back.

If your `DB_PATH` is set to something other than `/data/board.db`, use that
path instead. `GET /api/health` tells you which file is in use.

---

## B. The board only, keeping every account

Accounts live in their own table, not on the board, so they can be kept while
everything else goes. In the Render shell:

```
node -e "const D=require('better-sqlite3');const d=new D(process.env.DB_PATH||'/data/board.db');const n=d.prepare('DELETE FROM board').run().changes;console.log('cleared',n,'keys');d.close()"
```

Then **Restart service** so nothing in memory writes the old board back.

Every ID, name, role and password survives. The app re-seeds the default
medics on the first load, exactly as it does on a new board.

---

## C. Just some of it

Same idea, naming the keys. For example, to clear the calls and the log but
keep the roster, the inventory and the policies:

```
node -e "const D=require('better-sqlite3');const d=new D(process.env.DB_PATH||'/data/board.db');const k=['ems:requests','ems:log','ems:messages','ems:archives','ems:scheduled'];k.forEach(x=>d.prepare('DELETE FROM board WHERE key=?').run(x));console.log('cleared',k.length,'keys');d.close()"
```

`GET /api/health` lists every key currently on the board with its size, which
is the easiest way to see what there is to choose from.

---

## 2. What the phones and tablets do next

Nothing needs to be reinstalled.

- After **A**, every signed-in device is signed out on its next poll — within
  three seconds. The server checks that a token's account still exists, and
  when it does not it answers 401 and the app returns to the sign-in screen.
- After **B** or **C**, devices stay signed in and simply see an empty board.

A device that was offline mid-reset may still be holding a queued write from
before it. It drains on the next poll with signal, which would put a handful of
old rows back on the clean board. If you want to be certain, do the reset when
nobody is signed on, and have each device open the app once afterwards and
check the board is empty before the shift starts.

---

## 3. If you reset the wrong thing

Backups are `.db` files in `/data/backups`. To go back to one:

```
ls -lt /data/backups
cp /data/backups/<the file you want> /data/board.db
rm -f /data/board.db-wal /data/board.db-shm
```

Then **Restart service**. This has been tested end to end — a restored file
comes back with the board, the accounts and the passwords exactly as they were
when the copy was taken.
