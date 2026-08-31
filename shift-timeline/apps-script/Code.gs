/*  ============================================================
    Shift Roster — Google Apps Script backend
    ------------------------------------------------------------
    Bound to a Google Sheet. Stores the monthly shift roster,
    the engineer list, and one shared edit password. Reads are
    public (no auth); writes need an edit token minted from the
    password.

    First-time setup:
      1. Run setup() once from the editor and grant permissions.
      2. Deploy -> New deployment -> Web app
           Execute as:      Me
           Who has access:  Anyone
      3. Copy the /exec URL into assets/js/config.js  (API_URL)
      4. Change the edit password: edit the Settings tab row
         'edit_password' -> put the new password in the 'value'
         column in PLAIN TEXT and run rehashPassword() once.
         (setup() seeds it as  ChangeMe123!)
    ============================================================ */

var EDIT_TOKEN_HOURS = 12;

var SHEETS = {
  roster:    ['date', 'engineer_id', 'shift', 'locked', 'note', 'updated_at'],
  engineers: ['engineer_id', 'name', 'active', 'sort_order'],
  settings:  ['key', 'value'],
  sessions:  ['token', 'expires_at', 'created_at']
};
var TITLES = { roster: 'Roster', engineers: 'Engineers', settings: 'Settings', sessions: 'Sessions' };

/* ================= setup ================= */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(function (key) {
    var sh = ss.getSheetByName(TITLES[key]);
    if (!sh) sh = ss.insertSheet(TITLES[key]);
    var cols = SHEETS[key];
    sh.getRange(1, 1, 1, cols.length).setValues([cols])
      .setFontWeight('bold').setBackground('#1D222F').setFontColor('#E9ECF4');
    sh.setFrozenRows(1);
    sh.getRange(2, 1, sh.getMaxRows() - 1, cols.length).setNumberFormat('@');
  });

  if (readAll('engineers').length === 0) {
    ['Engineer 1', 'Engineer 2', 'Engineer 3', 'Engineer 4'].forEach(function (n, i) {
      appendRow('engineers', { engineer_id: 'e' + (i + 1), name: n, active: 'TRUE', sort_order: i });
    });
  }

  if (!getSetting('edit_password_hash')) {
    var salt = Utilities.getUuid().slice(0, 12);
    setSetting('edit_password_salt', salt);
    setSetting('edit_password_hash', hash('ChangeMe123!', salt));
  }

  var ui; try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }
  if (ui) ui.alert('Shift Roster is ready.\n\nEdit password:  ChangeMe123!\nChange it in the Settings tab, then run rehashPassword().');
}

/* Put a plain-text password in Settings!value for key "edit_password",
   then run this once. It hashes it and removes the plain copy. */
function rehashPassword() {
  var plain = getSetting('edit_password');
  if (!plain) throw new Error('Add a row: key = edit_password, value = <new password> first.');
  var salt = Utilities.getUuid().slice(0, 12);
  setSetting('edit_password_salt', salt);
  setSetting('edit_password_hash', hash(String(plain), salt));
  deleteSetting('edit_password');
  var ui; try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }
  if (ui) ui.alert('Password updated. The plain-text copy has been removed.');
}

/* ================= web entry points ================= */

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'status';
    if (action === 'month') return json({ ok: true, data: monthPayload(e.parameter.key) });
    if (action === 'months') return json({ ok: true, data: { months: monthKeysWithData() } });
    return json({ ok: true, data: { service: 'Shift Roster', status: 'up', time: new Date().toISOString() } });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var req = JSON.parse(e.postData.contents);
    var action = req.action;
    var payload = req.payload || {};

    if (action === 'unlock') return json({ ok: true, data: unlock(payload) });

    // everything else needs a live token
    if (!validToken(req.token)) throw new Error('Edit session expired. Unlock again.');

    if (action === 'saveMonth') return json({ ok: true, data: saveMonth(payload) });
    if (action === 'saveEngineers') return json({ ok: true, data: saveEngineers(payload) });
    throw new Error('Unknown action: ' + action);
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ================= handlers ================= */

function unlock(p) {
  var salt = getSetting('edit_password_salt') || '';
  var want = getSetting('edit_password_hash') || '';
  if (!want || hash(String(p.password || ''), salt) !== want) {
    Utilities.sleep(600);
    throw new Error('That password is not right.');
  }
  var token = Utilities.getUuid();
  appendRow('sessions', {
    token: token,
    expires_at: new Date(Date.now() + EDIT_TOKEN_HOURS * 36e5).toISOString(),
    created_at: new Date().toISOString()
  });
  purgeSessions();
  return { token: token };
}

function saveMonth(p) {
  var key = String(p.key || '');
  if (!/^\d{4}-\d{2}$/.test(key)) throw new Error('Bad month key.');
  var rows = p.rows || [];

  // wipe existing rows for this month, then write the new set
  var sh = sheet('roster');
  var all = readAll('roster');
  var keep = all.filter(function (r) { return String(r.date).slice(0, 7) !== key; });
  var now = new Date().toISOString();
  var out = keep.map(function (r) { return [r.date, r.engineer_id, r.shift, r.locked, r.note, r.updated_at]; });
  rows.forEach(function (r) {
    out.push([r.date, r.engineerId, r.shift, r.locked ? 'TRUE' : '', r.note || '', now]);
  });

  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, SHEETS.roster.length).clearContent();
  if (out.length) sh.getRange(2, 1, out.length, SHEETS.roster.length).setValues(out);

  setSetting('opening', JSON.stringify(p.opening || {}));
  setSetting('saved.' + key, now);
  return { savedAt: now };
}

function saveEngineers(p) {
  var list = p.engineers || [];
  var sh = sheet('engineers');
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, SHEETS.engineers.length).clearContent();
  var out = list.map(function (e, i) {
    return [e.id, e.name, e.active === false ? 'FALSE' : 'TRUE', e.order != null ? e.order : i];
  });
  if (out.length) sh.getRange(2, 1, out.length, SHEETS.engineers.length).setValues(out);
  return { ok: true };
}

/* ================= month payload ================= */

function monthPayload(key) {
  if (!/^\d{4}-\d{2}$/.test(String(key || ''))) throw new Error('Bad month key.');
  var engineers = readAll('engineers').map(function (e) {
    return { id: e.engineer_id, name: e.name, active: String(e.active).toUpperCase() !== 'FALSE', order: Number(e.sort_order) || 0 };
  }).sort(function (a, b) { return a.order - b.order; });

  var all = readAll('roster');
  var rows = all.filter(function (r) { return String(r.date).slice(0, 7) === key; })
    .map(function (r) {
      return { date: String(r.date), engineerId: r.engineer_id, shift: r.shift || 'O',
        locked: String(r.locked).toUpperCase() === 'TRUE', note: r.note || '' };
    });

  var prevKey = prevMonth(key);
  var prevRows = all.filter(function (r) { return String(r.date).slice(0, 7) === prevKey; });
  var opening = {};
  try { opening = JSON.parse(getSetting('opening') || '{}'); } catch (e) { opening = {}; }

  var tails = computeTails(key, engineers, prevRows, opening);

  return {
    monthKey: key,
    engineers: engineers,
    rows: rows,
    opening: opening,
    tails: tails,
    savedAt: getSetting('saved.' + key) || null,
    hasPrev: prevRows.length > 0
  };
}

function monthKeysWithData() {
  var seen = {};
  readAll('roster').forEach(function (r) { seen[String(r.date).slice(0, 7)] = true; });
  return Object.keys(seen).sort();
}

/* the last up-to-3 shifts each engineer worked in the previous month,
   oldest -> newest; or synthesised from the opening-state form. */
function computeTails(key, engineers, prevRows, opening) {
  var tails = {};
  var prevKey = prevMonth(key);
  if (prevRows && prevRows.length) {
    var days = monthDays(prevKey);
    var last3 = days.slice(-3);
    var byCell = {};
    prevRows.forEach(function (r) { byCell[r.engineer_id + '|' + String(r.date)] = r.shift || 'O'; });
    engineers.forEach(function (e) {
      tails[e.id] = last3.map(function (d) { return byCell[e.id + '|' + d] || 'O'; });
    });
  } else {
    engineers.forEach(function (e) {
      var op = (opening || {})[e.id];
      if (!op || !op.shift || op.shift === 'O' || !op.run) { tails[e.id] = ['O', 'O', 'O']; return; }
      var run = Math.max(1, Math.min(3, op.run | 0));
      var t = [];
      while (t.length < 3 - run) t.push('O');
      while (t.length < 3) t.push(op.shift);
      tails[e.id] = t;
    });
  }
  return tails;
}

/* ================= sheet helpers ================= */

function sheet(key) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TITLES[key]);
  if (!sh) throw new Error('Sheet "' + TITLES[key] + '" is missing. Run setup() again.');
  return sh;
}

function readAll(key) {
  var sh = sheet(key), cols = SHEETS[key];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, cols.length).getValues();
  return values.filter(function (r) { return String(r[0]).trim() !== ''; })
    .map(function (r, i) {
      var o = { _row: i + 2 };
      cols.forEach(function (c, j) { o[c] = cellVal(r[j]); });
      return o;
    });
}

function cellVal(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return v === null || v === undefined ? '' : v;
}

function appendRow(key, obj) {
  var cols = SHEETS[key];
  sheet(key).appendRow(cols.map(function (c) { return obj[c] === undefined ? '' : obj[c]; }));
  return obj;
}

/* ---- settings ---- */

function getSetting(k) {
  var row = readAll('settings').filter(function (r) { return r.key === k; })[0];
  return row ? row.value : '';
}
function setSetting(k, v) {
  var sh = sheet('settings');
  var row = readAll('settings').filter(function (r) { return r.key === k; })[0];
  if (row) sh.getRange(row._row, 2).setValue(v);
  else sh.appendRow([k, v]);
}
function deleteSetting(k) {
  var sh = sheet('settings');
  var row = readAll('settings').filter(function (r) { return r.key === k; })[0];
  if (row) sh.deleteRow(row._row);
}

/* ---- sessions ---- */

function validToken(token) {
  if (!token) return false;
  var s = readAll('sessions').filter(function (x) { return x.token === token; })[0];
  if (!s) return false;
  return new Date(s.expires_at) > new Date();
}
function purgeSessions() {
  var now = new Date();
  var stale = readAll('sessions').filter(function (s) { return new Date(s.expires_at) < now; });
  stale.sort(function (a, b) { return b._row - a._row; }).forEach(function (s) { sheet('sessions').deleteRow(s._row); });
}

/* ---- misc ---- */

function hash(pw, salt) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '::' + pw, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }
function prevMonth(key) {
  var p = key.split('-'), y = +p[0], m = +p[1];
  return m === 1 ? (y - 1) + '-12' : y + '-' + pad2(m - 1);
}
function monthDays(key) {
  var p = key.split('-'), y = +p[0], m = +p[1];
  var n = new Date(y, m, 0).getDate();
  var out = [];
  for (var d = 1; d <= n; d++) out.push(key + '-' + pad2(d));
  return out;
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('purgeSessions').timeBased().everyHours(6).create();
}
