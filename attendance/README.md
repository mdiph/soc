# Shift Desk — SOC attendance

Attendance and shift-coverage tracking for a 24/7 security operations centre.
Frontend runs on GitHub Pages. Records land in a Google Sheet.

---

## How it fits together

GitHub Pages serves static files only — no server, no database, no place to keep a
secret. A login written purely in browser JavaScript is decoration: anyone can open
DevTools and read the password list. So the app splits in two:

```
  GitHub Pages                    Google Apps Script            Google Sheets
  ─────────────                   ──────────────────            ─────────────
  index.html                      doPost() router               Users
  app.css        ──── fetch ───▶  password hashing      ────▶   Shifts
  app.js                          session tokens                Attendance
  (public, no secrets)            role checks                   Sessions
                                  photo → Drive                 AuditLog
                                                                ActivityLog
```

Passwords are hashed and roles are enforced **inside Apps Script**, where the browser
can't reach them. The Sheet is your spreadsheet — open it any time, sort it, pivot it,
chart it. The app also exports a formatted `.xlsx` on demand.

Leave `API_URL` empty and the app runs in **demo mode** against an in-browser fixture,
so you can click through everything before setting up any of this.

---

## Part 1 — the backend (about 10 minutes)

1. Create a new Google Sheet. Name it something like `SOC Attendance`.
2. **Extensions → Apps Script**. Delete the placeholder `myFunction`.
3. Paste the whole of `apps-script/Code.gs` into the editor and save.
4. In the toolbar function dropdown pick **`setup`**, click **Run**, and grant the
   permissions it asks for. (Google will warn about an unverified app — that's your
   own script; choose *Advanced → Go to project*.)
   This creates the six tabs, three default shifts, and one admin account.
5. **Deploy → New deployment → Web app**
   - Description: `v1`
   - Execute as: **Me**
   - Who has access: **Anyone**  ← must be "Anyone", not "Anyone with a Google account"
6. Copy the **Web app URL**. It ends in `/exec`.

> **Whenever you edit `Code.gs`**, the live URL keeps serving the old code until you
> redeploy: **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**.
> The URL stays the same.

Default sign-in: **`admin` / `ChangeMe123!`** — change it on first login under
*Roster & shifts → Engineers → Edit*.

---

## Part 2 — GitHub Pages at `pradigta.com/soc/attendance`

Two GitHub repos are involved. That sounds like a lot, but only one holds the app.

| Repo | Job | Served at |
|---|---|---|
| `pradigta.github.io` | Holds the custom domain. Can be near-empty. | `pradigta.com/` |
| `soc` | Holds this app. | `pradigta.com/soc/` |

GitHub attaches a custom domain to the **root** of your account, then serves every
other repo underneath it as `/<repo-name>/`. So a repo called `soc` lands at
`pradigta.com/soc/`, and the `attendance/` folder inside it lands at
`pradigta.com/soc/attendance/` — exactly the URL you want.

**7. Claim the domain with a user site.**
Create a repo named exactly **`pradigta.github.io`** (your username, then `.github.io`).
Add a one-line `index.html` — a homepage, or just `<h1>pradigta</h1>`. Push it, then
**Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**.
Under **Custom domain** enter `pradigta.com` and Save. GitHub commits a `CNAME` file
containing `pradigta.com` for you.

*Already have `pradigta.com` live on GitHub Pages? Skip this step entirely.*

**8. Point DNS at GitHub.** At your registrar, on `pradigta.com`:

| Type | Host | Value |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| AAAA | `@` | `2606:50c0:8000::153` |
| AAAA | `@` | `2606:50c0:8001::153` |
| AAAA | `@` | `2606:50c0:8002::153` |
| AAAA | `@` | `2606:50c0:8003::153` |
| CNAME | `www` | `pradigta.github.io` |

Delete any existing A or CNAME record on `@` first — a leftover parking-page record
will quietly win. Propagation is usually minutes but can take up to 24 hours.

Back in **Settings → Pages**, wait for the green check, then tick **Enforce HTTPS**.
That box stays greyed out until GitHub has issued the certificate; give it a few
minutes rather than assuming something broke.

**9. Push this repo.** Name it exactly **`soc`** — the repo name *is* the URL segment.

```bash
cd soc
git init
git add .
git commit -m "SOC attendance console"
git branch -M main
git remote add origin https://github.com/pradigta/soc.git
git push -u origin main
```

**10. Turn on Pages for it.** In the `soc` repo: **Settings → Pages → Deploy from a
branch → `main` / `(root)` → Save.** Leave *Custom domain* blank here — it inherits
`pradigta.com` from the user site. Setting it again on this repo would steal the apex
and break step 7.

**11. Open it.** `https://pradigta.com/soc/attendance/`

Sign in with `admin` / `ChangeMe123!` and change the password immediately under
*Roster & shifts → Engineers → Edit*.

### If you don't want a separate user site

You can put the custom domain directly on the `soc` repo instead. But then that repo
serves at the apex, so `pradigta.com/` *is* this repo, and to keep the same URL you
need the files nested one level deeper — `soc/attendance/` **inside** the repo:

```
your-repo/
├── CNAME              ← contains: pradigta.com
├── .nojekyll
└── soc/
    └── attendance/
        ├── index.html
        └── assets/
```

This works, but it consumes your whole domain for one internal tool. The two-repo
setup above leaves `pradigta.com` free for anything else.

---

## Roles

Three roles, checked on the server for every request. The sidebar hides what you
can't use, but the enforcement is in Apps Script, not the menu.

| | Engineer | Shift lead | Admin |
|---|:---:|:---:|:---:|
| Sign on / sign off own shift | ● | ● | ● |
| See own log | ● | ● | ● |
| Coverage board — names and times | ● | ● | ● |
| Colleagues' handover notes, photos, activity | ○ | ● | ● |
| Full team log, filters, `.xlsx` export | ○ | ● | ● |
| Add, edit, disable accounts | ○ | ○ | ● |
| Edit the shift pattern | ○ | ○ | ● |
| Delete a shift record | ○ | ○ | ● |
| Audit trail | ○ | ○ | ● |

Engineers can see *that* Sinta is on the evening shift and when she signed on — that's
the point of a coverage board — but not what she wrote in her handover.

---

## What a shift record holds

Sign-on captures name, timestamp, shift, desk photo, scheduled end, workstation and
opening activity. Sign-off adds the rest:

| Field | Why it's there |
|---|---|
| Handover notes *(required)* | The single most useful thing in a SOC shift log. You can't sign off without one. |
| Alerts triaged / cases raised / issues resolved | Turns attendance into workload data — you can see whether the night shift is drowning. Pre-filled from the shift activity log below, but stay editable. |
| Late minutes | Measured against shift start **plus a per-shift grace period**, so a 3-minute overrun isn't a mark against anyone. |
| Early out | Flagged when sign-off is more than 15 minutes before scheduled end. |
| Workstation | Distinguishes on-site from `Remote / VPN`. |
| Sign-off photo *(optional)* | Some SOCs want both ends; capture again before signing off if so. |

Night shifts that cross midnight are filed against the date the shift **started**, so
a 22:00–06:00 shift stays one row instead of splitting across two days.

### Shift activity log

While signed on, the *Shift check-in* page shows a **Log update** box: pick a type
(Note, Alert, Case raised, Issue resolved), optionally a severity and a ticket/case
reference, write a line, and it's timestamped against the open shift immediately — no
need to remember it all at sign-off. Entries land in a separate `ActivityLog` tab
(`record_id` ties each entry back to its shift), and the counts of Alert/Case/Resolved
entries pre-fill the sign-off counters automatically.

The desk-photo camera only actually matters twice — the sign-on shot, and an optional
one at sign-off — so once you're signed on it collapses to a small thumbnail of what was
already captured, and *Add sign-off photo* brings the full camera back on demand. That
gives the activity log the space instead of a live camera preview sitting idle.

Both **My log** and **Team log** truncate the handover text to fit a table cell — click
**Details** on any row for the full picture: both photos, opening activity, handover,
the Alerts/Cases/Resolved counters, and the complete activity log for that shift.

---

## The coverage ribbon

The dashboard's main element. The upper band is the planned rotation for the selected
day; the lower band is one lane per engineer showing when they were actually signed on.

- **Teal** — shift met its minimum engineer count
- **Amber** — someone was on, but below the minimum
- **Coral, hatched** — nobody signed on for that block

The "Uncovered" figure in the stat strip is the number of hours in that day with no
one signed on at all. That's the number to take to a staffing conversation.

---

## Settings worth changing

In `assets/js/config.js`:

| Setting | Default | Notes |
|---|---|---|
| `REQUIRE_PHOTO` | `true` | Set `false` if photos aren't wanted or the floor has no webcams. |
| `PHOTO_MAX_EDGE` | `640` | Photos are downscaled and JPEG-compressed in the browser before upload. Raising this grows Drive usage fast. |
| `SESSION_HOURS` | `8` | Keep in step with `SESSION_HOURS` in `Code.gs`. One shift long is sensible. |
| `NO_SHOW_AFTER` | `60` | Minutes past shift start before an absence counts as a no-show. |

Shifts, grace periods and minimum staffing are edited in the app itself, under
*Roster & shifts*, not in code.

---

## Honest limits

Read these before putting real staff data in it.

- **Password hashing is SHA-256 with a per-user salt**, not bcrypt or Argon2 — Apps
  Script has no native slow-hash function. It resists casual snooping at the sheet
  level; it would not hold up to a determined offline attack. Enforce decent password
  length, and don't reuse corporate passwords here.
- **A "Anyone" web app URL is unauthenticated by design.** Anyone with the URL can
  reach the endpoint. Every action past `login` demands a valid session token, so the
  data is protected, but the endpoint is reachable. Treat the URL as semi-secret.
- **Login lockout.** Five wrong passwords in a row locks that account for 15 minutes —
  checked before the password itself, so a correct guess during the lockout still
  doesn't get in. An admin resetting the password (*Roster & shifts → Engineers →
  Edit*) clears the lockout immediately rather than making the user wait it out.
  Tune `MAX_LOGIN_ATTEMPTS` / `LOGIN_LOCKOUT_MINUTES` at the top of `Code.gs`.
- **Photos in Drive are shared "anyone with the link."** Unguessable, but not private.
  If your Workspace blocks link-sharing, `savePhoto` degrades gracefully and stores an
  empty link rather than failing the sign-on.
- **Apps Script quotas** are generous for this (roughly 20k URL-fetch calls and 6
  minutes of runtime per execution on consumer accounts) but not unlimited. A roster
  of a few dozen engineers is comfortable; a few thousand is not.
- **Sheets is not a transactional database.** Writes are serialised with `LockService`,
  which prevents the common corruption, but if this grows past a few thousand rows a
  month, move the backend to Supabase or Firebase and keep the same frontend — the API
  adapter in `assets/js/api.js` is the only file that would change.

If this is going to hold real HR-relevant records, the honest upgrade path is a proper
backend with real password hashing and an audited database. This design is the right
trade for a small team that wants something working this week at zero cost.

---

## Files

The `soc` repo, as pushed:

```
soc/                                    → pradigta.com/soc/
├── .nojekyll                           keeps Pages from hiding assets/
├── README.md                           this file
├── index.html                          redirects /soc/ → /soc/attendance/
└── attendance/                         → pradigta.com/soc/attendance/
    ├── index.html                      single-page shell, all views
    ├── assets/css/app.css              styling
    ├── assets/js/config.js             ← your Apps Script URL goes here
    ├── assets/js/api.js                adapter: Apps Script or demo
    ├── assets/js/backend-demo.js       in-browser fixture for demo mode
    ├── assets/js/app.js                routing, RBAC nav, ribbon, forms, export
    └── apps-script/Code.gs             ← reference copy only; see note
```

**`Code.gs` does not run from GitHub.** It has to be pasted into the Apps Script editor
attached to your Google Sheet (Part 1). The copy in the repo is for version history and
for whoever maintains this after you. Editing it here changes nothing until you paste it
back in and redeploy.

**Whenever `Code.gs` adds a sheet or a column** (as it did for the `ActivityLog` tab and
the `issues_resolved` column), paste the updated code in and run **`setup`** from the
function dropdown again before redeploying — it's safe to re-run any time; it only adds
what's missing and never touches existing rows.

All asset paths in `index.html` are relative, so the app works at any depth — root,
`/soc/attendance/`, or anywhere else you move it. Nothing hard-codes the URL.

---

## Demo accounts

Only when `API_URL` is empty:

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | Administrator |
| `lead` | `lead123` | Shift lead |
| `eng` | `eng123` | Engineer |

Demo data lives in your browser. Clearing site data resets it.

---

## Troubleshooting

**"The backend replied with something that is not JSON"** — the deployment isn't set to
*Anyone*, or you're using the `/dev` URL. Use `/exec`.

**Changes to `Code.gs` do nothing** — you didn't redeploy a new version. See Part 1.

**Date column shows "Invalid Date" on My Log** — a handful of Sheets quirks can make a
cell that should hold a plain calendar day ("2026-08-26") come back as an actual Date
value instead of text, even with the column formatted as Plain Text (that format only
governs values entered from now on, not ones already stored as a date). Fixed by reading
that column defensively — redeploy the current `Code.gs` and it self-corrects on the
next read, no need to touch the Sheet.

**Photo shows as a broken image or just the words "Attendance photo"** — records written
before this fix used `drive.google.com/uc?export=view`, a link format Google now blocks
from loading inside an `<img>` tag for most files, so the browser falls back to the alt
text. New sign-ons use `drive.google.com/thumbnail?id=…`, which still works. Old photo
links already saved in the Sheet won't retroactively fix themselves — re-share/re-upload
if an old one matters, or leave it; it's cosmetic on historical rows.

**Camera won't open** — `getUserMedia` needs HTTPS. GitHub Pages is HTTPS, so this is
fine in production, but a page opened as `file://` won't work. Use *Upload instead*, or
serve locally with `python3 -m http.server`.

**Blank page or 404** — check `.nojekyll` was committed, that Pages points at the
branch root rather than `/docs`, and that you used the trailing slash:
`pradigta.com/soc/attendance/`.

**`pradigta.com/soc/attendance` shows the wrong site** — you set the custom domain on
the `soc` repo as well as the user site. Two repos claiming one apex domain fight, and
the loser 404s. Remove it from `soc` under *Settings → Pages → Custom domain → Remove*.

**"Enforce HTTPS" is greyed out** — GitHub is still issuing the certificate. It needs
DNS to resolve first. Check with `dig pradigta.com +noall +answer -t A`; if you see the
four `185.199.*` addresses, just wait.

**Custom domain keeps unsetting itself** — the `CNAME` file got wiped by a force-push.
It must contain exactly `pradigta.com` on one line, in the `pradigta.github.io` repo.
