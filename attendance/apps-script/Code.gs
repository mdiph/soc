/*  ============================================================
    Shift Desk — Google Apps Script backend
    ------------------------------------------------------------
    Bound to a Google Sheet. Handles authentication, role checks,
    attendance and absence records, and photo storage in Drive.

    First-time setup:
      1. Run setup() once from the editor and grant permissions.
      2. Deploy → New deployment → Web app
           Execute as:  Me
           Who has access:  Anyone
      3. Copy the /exec URL into assets/js/config.js
      4. Sign in as  admin / ChangeMe123!  and change that password.
    ============================================================ */

var SESSION_HOURS   = 8;
var PHOTO_FOLDER    = 'Shift Desk Photos';
var SHEETS = {
  users:      ['user_id','full_name','username','password_hash','salt','role','employee_id','email','default_shift','status','created_at'],
  shifts:     ['shift_id','name','start','end','grace_min','min_engineers','active'],
  attendance: ['record_id','user_id','employee_id','full_name','shift_id','shift_name','date','check_in','scheduled_end','check_out','duration_min','late_min','early_min','status','workstation','opening_activity','handover','alerts_triaged','incidents','photo_in','photo_out','created_at','updated_at'],
  absence:    ['absence_id','user_id','full_name','type','date_from','date_to','days','shift_id','cover','reason','status','reviewed_by','reviewed_at','created_at'],
  sessions:   ['token','user_id','expires_at','created_at'],
  audit:      ['timestamp','actor','action','detail']
};
var TITLES = { users:'Users', shifts:'Shifts', attendance:'Attendance', absence:'Absence', sessions:'Sessions', audit:'AuditLog' };
var RANK = { engineer:1, lead:2, admin:3 };

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
    // Store everything as text so Sheets does not reinterpret dates or IDs.
    sh.getRange(2, 1, sh.getMaxRows() - 1, cols.length).setNumberFormat('@');
  });

  // Columns C and D of Shifts hold "06:00" strings. Without an explicit text
  // format Sheets converts them to time values, which read back as 1899 dates.
  var shSheet = ss.getSheetByName(TITLES.shifts);
  shSheet.getRange(2, 3, shSheet.getMaxRows() - 1, 2).setNumberFormat('@');

  if (readAll('shifts').length === 0) {
    appendRow('shifts', { shift_id:'sh-morning', name:'Morning', start:'06:00', end:'14:00', grace_min:10, min_engineers:2, active:'TRUE' });
    appendRow('shifts', { shift_id:'sh-evening', name:'Evening', start:'14:00', end:'22:00', grace_min:10, min_engineers:2, active:'TRUE' });
    appendRow('shifts', { shift_id:'sh-night',   name:'Night',   start:'22:00', end:'06:00', grace_min:15, min_engineers:2, active:'TRUE' });
  }

  if (readAll('users').length === 0) {
    var salt = uid('s');
    appendRow('users', {
      user_id: uid('u'), full_name:'SOC Administrator', username:'admin',
      password_hash: hash('ChangeMe123!', salt), salt: salt, role:'admin',
      employee_id:'SOC-001', email:'', default_shift:'sh-morning', status:'active',
      created_at: new Date().toISOString()
    });
  }

  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }
  if (ui) ui.alert('Shift Desk is ready.\n\nSign in with  admin / ChangeMe123!  and change the password straight away.');
}

/* ================= web entry points ================= */

function doGet() {
  return json({ ok: true, data: { service: 'Shift Desk', status: 'up', time: new Date().toISOString() } });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var req = JSON.parse(e.postData.contents);
    var action = req.action;
    var payload = req.payload || {};
    var token = req.token || '';

    var me = null;
    if (action !== 'login') {
      me = sessionUser(token);
      if (!me) throw new Error('Your session has expired. Sign in again.');
    }
    var fn = HANDLERS[action];
    if (!fn) throw new Error('Unknown action: ' + action);
    return json({ ok: true, data: fn(payload, me, token) });

  } catch (err) {
    return json({ ok: false, error: err.message || String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
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
      cols.forEach(function (c, j) { o[c] = cell(r[j]); });
      return o;
    });
}

function cell(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
  return v === null || v === undefined ? '' : v;
}

function appendRow(key, obj) {
  var cols = SHEETS[key];
  sheet(key).appendRow(cols.map(function (c) { return obj[c] === undefined ? '' : obj[c]; }));
  return obj;
}

function updateRow(key, rowIndex, obj) {
  var cols = SHEETS[key];
  var sh = sheet(key);
  var current = sh.getRange(rowIndex, 1, 1, cols.length).getValues()[0];
  var out = cols.map(function (c, i) { return obj[c] !== undefined ? obj[c] : current[i]; });
  sh.getRange(rowIndex, 1, 1, cols.length).setValues([out]);
}

function deleteRow(key, rowIndex) { sheet(key).deleteRow(rowIndex); }

function uid(p) { return p + '-' + Utilities.getUuid().slice(0, 8); }

function hash(pw, salt) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '::' + pw, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function audit(actor, action, detail) {
  appendRow('audit', { timestamp: new Date().toISOString(), actor: actor, action: action, detail: detail || '' });
}

function needRole(me, role) {
  if (RANK[me.role] < RANK[role]) throw new Error('Your role does not allow that.');
}

function ymd(d) { return Utilities.formatDate(new Date(d), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function minsBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 60000); }

/* ================= sessions ================= */

function sessionUser(token) {
  if (!token) return null;
  var s = readAll('sessions').filter(function (x) { return x.token === token; })[0];
  if (!s) return null;
  if (new Date(s.expires_at) < new Date()) { deleteRow('sessions', s._row); return null; }
  var u = readAll('users').filter(function (x) { return x.user_id === s.user_id; })[0];
  return (u && u.status === 'active') ? u : null;
}

function pubUser(u) {
  return {
    id: u.user_id, name: u.full_name, username: u.username, role: u.role,
    empId: u.employee_id, email: u.email, defaultShift: u.default_shift, status: u.status
  };
}

function pubShift(s) {
  return {
    id: s.shift_id, name: s.name, start: asHM(s.start), end: asHM(s.end),
    grace: Number(s.grace_min) || 0, min: Number(s.min_engineers) || 1,
    active: String(s.active).toUpperCase() !== 'FALSE'
  };
}

/* Sheets happily reinterprets "06:00" as a time value, which comes back as
   an 1899 date. Accept whatever the cell holds and return plain "HH:MM". */
function asHM(v) {
  if (v === null || v === undefined || v === '') return '00:00';
  var str = String(v);
  var m = str.match(/^(\d{1,2}):(\d{2})/);                       // already "HH:MM"
  if (m) return pad2(m[1]) + ':' + pad2(m[2]);
  m = str.match(/T(\d{2}):(\d{2})/);                             // ISO timestamp
  if (m) return m[1] + ':' + m[2];
  var d = new Date(str);
  if (!isNaN(d.getTime())) return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
  return '00:00';
}
function pad2(n) { return ('0' + n).slice(-2); }

function pubAtt(a) {
  return {
    id: a.record_id, userId: a.user_id, empId: a.employee_id, name: a.full_name,
    shiftId: a.shift_id, shiftName: a.shift_name, date: a.date,
    checkIn: a.check_in, scheduledEnd: a.scheduled_end, checkOut: a.check_out,
    durationMin: a.duration_min === '' ? '' : Number(a.duration_min),
    lateMin: Number(a.late_min) || 0, earlyMin: Number(a.early_min) || 0,
    status: a.status, station: a.workstation, activity: a.opening_activity,
    handover: a.handover, alerts: a.alerts_triaged, incidents: a.incidents,
    photoIn: a.photo_in, photoOut: a.photo_out
  };
}

function pubAbs(a) {
  return {
    id: a.absence_id, userId: a.user_id, name: a.full_name, type: a.type,
    from: a.date_from, to: a.date_to, days: Number(a.days) || 0,
    shiftId: a.shift_id, cover: a.cover, reason: a.reason, status: a.status,
    reviewedBy: a.reviewed_by, reviewedAt: a.reviewed_at, createdAt: a.created_at
  };
}

/* ================= photos ================= */

function savePhoto(dataUrl, label) {
  if (!dataUrl || dataUrl.indexOf('data:image') !== 0) return '';
  try {
    var folders = DriveApp.getFoldersByName(PHOTO_FOLDER);
    var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(PHOTO_FOLDER);
    var parts = dataUrl.split(',');
    var mime = parts[0].match(/data:([^;]+)/)[1];
    var blob = Utilities.newBlob(Utilities.base64Decode(parts[1]), mime, label + '.jpg');
    var file = folder.createFile(blob);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* domain policy may block */ }
    return 'https://drive.google.com/uc?export=view&id=' + file.getId();
  } catch (e) {
    return '';
  }
}

/* ================= handlers ================= */

var HANDLERS = {

  login: function (p) {
    var u = readAll('users').filter(function (x) {
      return String(x.username).toLowerCase() === String(p.username || '').toLowerCase();
    })[0];
    if (!u || hash(p.password || '', u.salt) !== u.password_hash) {
      throw new Error('Username or password is not recognised.');
    }
    if (u.status !== 'active') throw new Error('This account is disabled. Ask your SOC administrator.');

    var token = Utilities.getUuid();
    appendRow('sessions', {
      token: token, user_id: u.user_id,
      expires_at: new Date(Date.now() + SESSION_HOURS * 36e5).toISOString(),
      created_at: new Date().toISOString()
    });
    audit(u.username, 'login', '');
    purgeSessions();
    return { token: token, user: pubUser(u) };
  },

  logout: function (p, me, token) {
    var s = readAll('sessions').filter(function (x) { return x.token === token; })[0];
    if (s) deleteRow('sessions', s._row);
    return { ok: true };
  },

  bootstrap: function (p, me) {
    var mine = readAll('attendance').filter(function (a) { return a.user_id === me.user_id && !a.check_out; });
    var pending = 0;
    if (RANK[me.role] >= RANK.lead) {
      pending = readAll('absence').filter(function (a) { return a.status === 'Pending'; }).length;
    }
    return {
      user: pubUser(me),
      shifts: readAll('shifts').map(pubShift).filter(function (s) { return s.active; }),
      users: RANK[me.role] >= RANK.lead ? readAll('users').map(pubUser) : [pubUser(me)],
      openRecord: mine.length ? pubAtt(mine[mine.length - 1]) : null,
      pendingAbsence: pending
    };
  },

  checkIn: function (p, me) {
    var open = readAll('attendance').filter(function (a) { return a.user_id === me.user_id && !a.check_out; })[0];
    if (open) throw new Error('You are still signed on to the ' + open.shift_name + ' shift. Sign off first.');

    var sh = readAll('shifts').filter(function (s) { return s.shift_id === p.shiftId; })[0];
    if (!sh) throw new Error('That shift no longer exists.');

    var ci = new Date(p.checkIn);
    var sp = String(sh.start).split(':');
    var start = new Date(ci); start.setHours(Number(sp[0]), Number(sp[1]), 0, 0);
    var wraps = String(sh.end) <= String(sh.start);
    if (wraps && ci.getHours() < 12) start.setDate(start.getDate() - 1);
    var late = Math.max(0, minsBetween(start, ci) - (Number(sh.grace_min) || 0));

    var rec = {
      record_id: uid('att'), user_id: me.user_id, employee_id: me.employee_id, full_name: me.full_name,
      shift_id: sh.shift_id, shift_name: sh.name, date: ymd(start),
      check_in: ci.toISOString(), scheduled_end: new Date(p.scheduledEnd).toISOString(), check_out: '',
      duration_min: '', late_min: late, early_min: '', status: 'Open',
      workstation: p.station || '', opening_activity: p.activity || '', handover: '',
      alerts_triaged: '', incidents: '',
      photo_in: savePhoto(p.photo, 'in_' + me.username + '_' + ymd(start)), photo_out: '',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    };
    appendRow('attendance', rec);
    audit(me.username, 'check-in', sh.name + ' · ' + rec.date + (late ? ' · late ' + late + 'm' : ''));
    return { record: pubAtt(rec) };
  },

  checkOut: function (p, me) {
    var rec = readAll('attendance').filter(function (a) { return a.record_id === p.id; })[0];
    if (!rec) throw new Error('That shift record was not found.');
    if (rec.user_id !== me.user_id && RANK[me.role] < RANK.admin) throw new Error('You can only sign off your own shift.');
    if (rec.check_out) throw new Error('That shift is already signed off.');

    var co = new Date();
    var duration = minsBetween(rec.check_in, co);
    var early = minsBetween(co, rec.scheduled_end);
    var late = Number(rec.late_min) || 0;
    var status = late > 0 ? 'Late' : (early > 15 ? 'Early out' : 'On time');

    var patch = {
      check_out: co.toISOString(), duration_min: duration,
      early_min: early > 0 ? early : 0, status: status,
      handover: p.handover || '', alerts_triaged: p.alerts != null ? p.alerts : '',
      incidents: p.incidents != null ? p.incidents : '',
      updated_at: co.toISOString()
    };
    if (p.photo) patch.photo_out = savePhoto(p.photo, 'out_' + me.username + '_' + rec.date);

    updateRow('attendance', rec._row, patch);
    audit(me.username, 'check-out', rec.shift_name + ' · ' + rec.date + ' · ' + duration + 'm');

    Object.keys(patch).forEach(function (k) { rec[k] = patch[k]; });
    return { record: pubAtt(rec) };
  },

  /* Everyone can see who is covering the floor. Engineers get names and
     times only; handover notes, photos and activity stay with leads. */
  boardData: function (p, me) {
    var full = RANK[me.role] >= RANK.lead;
    var rows = readAll('attendance').filter(function (a) {
      return (!p.from || a.date >= p.from) && (!p.to || a.date <= p.to);
    }).map(function (a) {
      var o = pubAtt(a);
      if (full || o.userId === me.user_id) return o;
      return {
        id: o.id, userId: o.userId, name: o.name, shiftId: o.shiftId, shiftName: o.shiftName,
        date: o.date, checkIn: o.checkIn, scheduledEnd: o.scheduledEnd, checkOut: o.checkOut,
        durationMin: o.durationMin, lateMin: o.lateMin, status: o.status, station: o.station,
        activity: '', handover: '', photoIn: '', photoOut: ''
      };
    });
    var abs = readAll('absence').filter(function (a) { return a.status === 'Approved'; }).map(function (a) {
      var o = pubAbs(a);
      if (!full && o.userId !== me.user_id) o.reason = '';
      return o;
    });
    return { rows: rows, absence: abs };
  },

  listAttendance: function (p, me) {
    var rows = readAll('attendance').map(pubAtt);
    if (RANK[me.role] < RANK.lead || p.mine) {
      rows = rows.filter(function (a) { return a.userId === me.user_id; });
    }
    if (p.from)    rows = rows.filter(function (a) { return a.date >= p.from; });
    if (p.to)      rows = rows.filter(function (a) { return a.date <= p.to; });
    if (p.shiftId) rows = rows.filter(function (a) { return a.shiftId === p.shiftId; });
    if (p.userId)  rows = rows.filter(function (a) { return a.userId === p.userId; });
    if (p.status)  rows = rows.filter(function (a) { return a.status === p.status; });
    rows.sort(function (a, b) { return new Date(b.checkIn) - new Date(a.checkIn); });
    return { rows: rows };
  },

  deleteAttendance: function (p, me) {
    needRole(me, 'admin');
    var rec = readAll('attendance').filter(function (a) { return a.record_id === p.id; })[0];
    if (!rec) throw new Error('That shift record was not found.');
    deleteRow('attendance', rec._row);
    audit(me.username, 'delete attendance', rec.full_name + ' · ' + rec.date + ' · ' + rec.shift_name);
    return { ok: true };
  },

  createAbsence: function (p, me) {
    var from = new Date(p.from), to = new Date(p.to);
    if (to < from) throw new Error('The last day cannot fall before the first day.');
    var rec = {
      absence_id: uid('abs'), user_id: me.user_id, full_name: me.full_name, type: p.type,
      date_from: p.from, date_to: p.to, days: Math.round((to - from) / 864e5) + 1,
      shift_id: p.shiftId || '', cover: p.cover || '', reason: p.reason || '',
      status: 'Pending', reviewed_by: '', reviewed_at: '', created_at: new Date().toISOString()
    };
    appendRow('absence', rec);
    audit(me.username, 'absence filed', p.type + ' ' + p.from + '→' + p.to);
    return { record: pubAbs(rec) };
  },

  listAbsence: function (p, me) {
    var rows = readAll('absence');
    if (RANK[me.role] < RANK.lead || p.mine) {
      rows = rows.filter(function (a) { return a.user_id === me.user_id; });
    }
    rows = rows.map(pubAbs).sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
    return { rows: rows };
  },

  reviewAbsence: function (p, me) {
    needRole(me, 'lead');
    var rec = readAll('absence').filter(function (a) { return a.absence_id === p.id; })[0];
    if (!rec) throw new Error('That absence request was not found.');
    if (['Approved', 'Rejected'].indexOf(p.decision) < 0) throw new Error('Decision must be Approved or Rejected.');
    updateRow('absence', rec._row, { status: p.decision, reviewed_by: me.full_name, reviewed_at: new Date().toISOString() });
    audit(me.username, 'absence ' + p.decision.toLowerCase(), rec.full_name + ' · ' + rec.date_from);
    rec.status = p.decision; rec.reviewed_by = me.full_name;
    return { record: pubAbs(rec) };
  },

  listUsers: function (p, me) {
    needRole(me, 'lead');
    return { rows: readAll('users').map(pubUser) };
  },

  saveUser: function (p, me) {
    needRole(me, 'admin');
    var users = readAll('users');
    var clash = users.filter(function (u) {
      return String(u.username).toLowerCase() === String(p.username).toLowerCase() && u.user_id !== p.id;
    })[0];
    if (clash) throw new Error('That username is already taken.');

    var existing = p.id ? users.filter(function (u) { return u.user_id === p.id; })[0] : null;
    if (existing) {
      var patch = {
        full_name: p.name, username: p.username, role: p.role, employee_id: p.empId || '',
        email: p.email || '', default_shift: p.defaultShift || '', status: p.status || 'active'
      };
      if (p.password) { patch.salt = uid('s'); patch.password_hash = hash(p.password, patch.salt); }
      updateRow('users', existing._row, patch);
      audit(me.username, 'user updated', p.username);
      Object.keys(patch).forEach(function (k) { existing[k] = patch[k]; });
      return { record: pubUser(existing) };
    }

    if (!p.password) throw new Error('Set an initial password for the new account.');
    var salt = uid('s');
    var rec = {
      user_id: uid('u'), full_name: p.name, username: p.username,
      password_hash: hash(p.password, salt), salt: salt, role: p.role,
      employee_id: p.empId || '', email: p.email || '', default_shift: p.defaultShift || '',
      status: p.status || 'active', created_at: new Date().toISOString()
    };
    appendRow('users', rec);
    audit(me.username, 'user created', p.username + ' · ' + p.role);
    return { record: pubUser(rec) };
  },

  deleteUser: function (p, me) {
    needRole(me, 'admin');
    if (p.id === me.user_id) throw new Error('You cannot remove your own account.');
    var u = readAll('users').filter(function (x) { return x.user_id === p.id; })[0];
    if (!u) throw new Error('That account was not found.');
    deleteRow('users', u._row);
    audit(me.username, 'user removed', u.username);
    return { ok: true };
  },

  listShifts: function () { return { rows: readAll('shifts').map(pubShift) }; },

  saveShift: function (p, me) {
    needRole(me, 'admin');
    var existing = p.id ? readAll('shifts').filter(function (s) { return s.shift_id === p.id; })[0] : null;
    var body = { name: p.name, start: p.start, end: p.end, grace_min: Number(p.grace) || 0, min_engineers: Number(p.min) || 1 };
    if (existing) {
      updateRow('shifts', existing._row, body);
      audit(me.username, 'shift updated', p.name);
      return { record: pubShift(Object.assign(existing, body)) };
    }
    body.shift_id = uid('sh'); body.active = 'TRUE';
    appendRow('shifts', body);
    audit(me.username, 'shift created', p.name);
    return { record: pubShift(body) };
  },

  deleteShift: function (p, me) {
    needRole(me, 'admin');
    var s = readAll('shifts').filter(function (x) { return x.shift_id === p.id; })[0];
    if (!s) throw new Error('That shift was not found.');
    deleteRow('shifts', s._row);
    audit(me.username, 'shift removed', s.name);
    return { ok: true };
  },

  listAudit: function (p, me) {
    needRole(me, 'admin');
    var rows = readAll('audit').map(function (r) {
      return { ts: r.timestamp, actor: r.actor, action: r.action, detail: r.detail };
    }).reverse().slice(0, 400);
    return { rows: rows };
  }
};

/* ================= housekeeping ================= */

/* Run once if your Shifts tab shows dates or times instead of plain "06:00".
   Rewrites both columns as text and restores the HH:MM values. */
function repairShiftTimes() {
  var sh = sheet('shifts');
  var rows = readAll('shifts');
  sh.getRange(2, 3, Math.max(1, sh.getMaxRows() - 1), 2).setNumberFormat('@');
  rows.forEach(function (r) {
    sh.getRange(r._row, 3).setValue(asHM(r.start));
    sh.getRange(r._row, 4).setValue(asHM(r.end));
  });
  var ui; try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }
  if (ui) ui.alert('Repaired ' + rows.length + ' shift rows.\n\nReload the app and sign in again.');
}

function purgeSessions() {
  var now = new Date();
  var stale = readAll('sessions').filter(function (s) { return new Date(s.expires_at) < now; });
  stale.sort(function (a, b) { return b._row - a._row; }).forEach(function (s) { deleteRow('sessions', s._row); });
}

/* Optional: install a nightly trigger that flags anyone who was
   rostered but never signed on. Run installTriggers() once. */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('purgeSessions').timeBased().everyHours(6).create();
}
