# Shift Timeline — SOC L1

The monthly shift rotation for a 24/7 security operations centre, as a web page.
Replaces the hand-coloured spreadsheet. Runs on GitHub Pages; the schedule can
live in a Google Sheet or, for testing, just in your browser.

**One page.** The full month timeline — every engineer, every day, colour-coded
like the old timesheet — is the centrepiece, and it's public: anyone with the
link sees it, no login. Pick your name for a **today / tomorrow / next-days**
strip on top and your row highlighted. Browse other months with ‹ ›.

**Editing needs the password.** Everyone sees the timeline. The **Sign in** button
(top right) opens a password prompt; only then do the generate / save / fix
controls appear, and **Sign out** puts it back to the plain view. The rotation is
**built by the generator** following the rules below — pick a month, hit
*Generate*, review, *Save*. Small fixes by clicking a cell; no cell-by-cell
building from scratch. A sign-in lasts `EDIT_TOKEN_HOURS` (12 by default).

---

## The shift model

| Shift | Hours | Filed against |
|---|---|---|
| Morning | 07:00–15:00 | that day |
| Afternoon | 15:00–23:00 | that day |
| Night | 23:00–07:00 | the day it **starts** |
| Off | — | — |

### Rules the tool checks

**Hard conflicts** (red — the roster still saves, but fix before publishing):

- **Night → Morning** the next day. Zero rest; forbidden.
- A **4th consecutive work day**. An Off is due after three.

**Warnings** (amber — worth a look):

- **Backward rotation** (Night→Afternoon, Afternoon→Morning). The generator only
  ever rotates forward — Morning → Afternoon → Night — so these only appear after
  a manual edit.
- A **shift with nobody on it** on some day.
- An engineer with **fewer than 8 Off days** in the month.

Nothing ever blocks Save. Sometimes reality is short-staffed and you need to
print the gap to justify hiring.

### The 8-Off-days limit, honestly

With **exactly four engineers** you cannot have both full coverage *and* 8 Off
days each every month. Four people, three shifts, one resting = every engineer is
needed on most days. 30 days ÷ 4 = 7.5, so two engineers land on 7. The generator
splits the Off days as evenly as it can and flags whoever ends up at 7. To
actually guarantee 8 for everyone you need a **fifth engineer**, or you accept one
short day of coverage per month. Five or more engineers: everyone clears 8
comfortably and the surplus rest is spread evenly.

---

## The generator

`Edit schedule → Generate` stamps the canonical four-team rotation:

```
Engineer 1  M M M O  A A A O  N N N O   (repeats)
Engineer 2  ... three days behind ...
Engineer 3  ... six days behind  ...
Engineer 4  ... nine days behind ...
```

Three work days on one shift, an Off, then the next shift forward. Four teams
offset by three days cover all three shifts with one resting, every day, and
nobody rotates backward.

- **Engineer order in the list = team order.** Set it in *Engineers*.
- **Locked cells survive.** Lock a cell (click the 🔒 in its corner) before
  generating — for a leave request, a swap — and the generator works around it,
  shuffling the other engineers that day. Whatever it can't resolve is listed
  under *The generator could not fully resolve…* for you to hand-fix.
- **Carry-in is automatic.** A new month continues from the last three days of the
  previous one, so the rest rules hold across the boundary. The very first month
  has nothing to carry from, so a one-time **Starting point** dialog asks, for
  each engineer: *what shift were you on the day before this month started, and
  was it your 1st / 2nd / 3rd day in a row?* That lets the rules apply to the
  first few days (someone on their 3rd night gets an Off on day 1). Genuinely
  don't know? Leave everyone on **Off** — only the first ~3 days go unchecked.

The generator runs in your browser; it's instant, so re-run it freely as you
adjust locks. The backend only stores the result.

---

## Running it locally first

Leave `API_URL` empty in [`assets/js/config.js`](assets/js/config.js) and the
whole tool runs against your browser's `localStorage` — generate, edit, validate,
export, Save all work, nothing is published. **Sign in** with the local password
(`EDIT_PASSWORD` in config, default `admin`). Serve the folder and open it:

```bash
cd shift-timeline
python3 -m http.server 8000
# http://localhost:8000/
```

Build a month or two, make sure the rotation looks right, then wire up the
backend and set `API_URL`.

---

## The backend (about 10 minutes)

Google Apps Script + a Google Sheet, same pattern as the attendance console.
Read access is **public** (anyone with the link sees the current roster);
editing needs one shared password.

1. Create a Google Sheet. Name it e.g. `SOC Shift Roster`.
2. **Extensions → Apps Script**. Delete the placeholder, paste all of
   [`apps-script/Code.gs`](apps-script/Code.gs), save.
3. Run **`setup`** from the function dropdown and grant permissions. It creates
   four tabs (`Roster`, `Engineers`, `Settings`, `Sessions`), seeds four
   engineers, and sets the edit password to `ChangeMe123!`.
4. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**  ← must be "Anyone", not "Anyone with a Google account"
5. Copy the **Web app URL** (ends in `/exec`) into `API_URL` in
   [`assets/js/config.js`](assets/js/config.js).
6. Rename the engineers in the *Engineers* tab or in the app under *Engineers*.

**Change the edit password:** in the `Settings` tab add a row with `key` =
`edit_password` and `value` = your new password (plain text), then run
**`rehashPassword`** from the editor. It hashes it and deletes the plain copy.

> **Whenever you edit `Code.gs`**, redeploy: **Deploy → Manage deployments → ✏️ →
> Version: New version → Deploy**. The URL stays the same. Re-run `setup` if you
> added a tab or column — it only adds what's missing.

---

## Config

[`assets/js/config.js`](assets/js/config.js):

| Setting | Default | Notes |
|---|---|---|
| `API_URL` | `""` | Apps Script `/exec` URL. Empty = local mode. |
| `TEAM_NAME` | `SOC L1` | Shown in the header and on exports. |
| `EDIT_PASSWORD` | `admin` | Sign-in password **in local mode only**. Live mode uses the Sheet's Settings tab. |
| `MIN_OFF_PER_MONTH` | `8` | Generator tops up to this; validator flags anyone below. |
| `MAX_CONSECUTIVE_WORK` | `3` | A work day beyond this is a hard conflict. |
| `EDIT_TOKEN_HOURS` | `12` | How long edit mode stays unlocked. |

---

## Export & print

- **Print** — `Ctrl/⌘-P` gives a full-page landscape wall chart: big colour-only
  cells (no text), tall rows, and a large colour key with shift hours at the
  bottom. Turn on "Background graphics" in the print dialog if the colours don't
  show.
- **Export .xlsx** — two sheets: `Timeline` (the grid + coverage + per-engineer
  totals) and `Rows` (one row per engineer per day, for pivoting).

The underlying Google Sheet is always there too — open it, sort it, chart it.

---

## Files

```
shift-timeline/                       → pradigta.com/soc/shift-timeline/
├── index.html                        the whole page
├── assets/css/app.css
├── assets/js/config.js               ← your API_URL goes here
├── assets/js/rota.js                 shift model, validation, generator (no DOM)
├── assets/js/api.js                  storage adapter: Apps Script or localStorage
├── assets/js/app.js                  UI, grid, panels, export
└── apps-script/Code.gs               ← paste into the Sheet's Apps Script editor
```

`Code.gs` does not run from GitHub — it has to be pasted into the Apps Script
editor bound to your Sheet. The copy here is for version history.

All asset paths are relative, so the app works at any depth.

---

## Honest limits

- **One shared edit password**, compared server-side, hashed at rest (SHA-256).
  Fine for one shift lead; it is not per-user auth. Treat the `/exec` URL as
  semi-secret.
- **Sheets is not a database.** Writes are serialised with `LockService`. A few
  years of monthly rosters is comfortable; nothing here is high-volume.
- **The generator is a starting point, not an oracle.** It produces a valid
  rotation and flags what it can't fix. The shift lead still reviews it.
