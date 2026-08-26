/* ============================================================
   Shift Desk — demo backend
   ------------------------------------------------------------
   Mirrors every action the Apps Script backend exposes, but
   keeps records in the browser. Used when API_URL is empty so
   you can click through the whole app before wiring up Sheets.
   Nothing here is secure; it is a fixture, not a server.
   ============================================================ */

(function () {
  'use strict';

  /* --- storage with a memory fallback ------------------------- */
  var mem = {};
  var KEY = 'shiftdesk.demo.v1';

  function load() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* storage blocked — use memory */ }
    if (mem[KEY]) return mem[KEY];
    return null;
  }

  function save(db) {
    mem[KEY] = db;
    try { window.localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* memory only */ }
  }

  /* --- helpers ------------------------------------------------ */
  function uid(p) { return p + '-' + Math.random().toString(36).slice(2, 9); }
  function iso(d) { return new Date(d).toISOString(); }
  function ymd(d) {
    d = new Date(d);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function minsBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 60000); }

  /* --- seed --------------------------------------------------- */
  function seed() {
    var shifts = [
      { id: 'sh-morning', name: 'Morning', start: '06:00', end: '14:00', grace: 10, min: 2, active: true },
      { id: 'sh-evening', name: 'Evening', start: '14:00', end: '22:00', grace: 10, min: 2, active: true },
      { id: 'sh-night',   name: 'Night',   start: '22:00', end: '06:00', grace: 15, min: 2, active: true }
    ];
    var users = [
      { id: 'u-admin', name: 'Dewi Anggraini', username: 'admin', pass: 'admin123', role: 'admin',    empId: 'SOC-001', email: 'dewi@example.com',  defaultShift: 'sh-morning', status: 'active' },
      { id: 'u-lead',  name: 'Bagus Pratama',  username: 'lead',  pass: 'lead123',  role: 'lead',     empId: 'SOC-004', email: 'bagus@example.com', defaultShift: 'sh-evening', status: 'active' },
      { id: 'u-eng',   name: 'Rizky Maulana',  username: 'eng',   pass: 'eng123',   role: 'engineer', empId: 'SOC-011', email: 'rizky@example.com', defaultShift: 'sh-night',   status: 'active' },
      { id: 'u-eng2',  name: 'Sinta Lestari',  username: 'sinta', pass: 'sinta123', role: 'engineer', empId: 'SOC-012', email: 'sinta@example.com', defaultShift: 'sh-morning', status: 'active' },
      { id: 'u-eng3',  name: 'Arif Nugroho',   username: 'arif',  pass: 'arif123',  role: 'engineer', empId: 'SOC-013', email: 'arif@example.com',  defaultShift: 'sh-evening', status: 'active' }
    ];

    // A couple of days of plausible history so the board is not blank.
    var att = [];
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var plan = [
      { u: 'u-eng2', s: 'sh-morning', dayOffset: -1, inMin: 0,   dur: 480 },
      { u: 'u-admin',s: 'sh-morning', dayOffset: -1, inMin: 22,  dur: 470 },
      { u: 'u-lead', s: 'sh-evening', dayOffset: -1, inMin: -6,  dur: 485 },
      { u: 'u-eng3', s: 'sh-evening', dayOffset: -1, inMin: 4,   dur: 480 },
      { u: 'u-eng',  s: 'sh-night',   dayOffset: -1, inMin: 3,   dur: 478 },
      { u: 'u-eng2', s: 'sh-morning', dayOffset: 0,  inMin: -4,  dur: 480 },
      { u: 'u-eng3', s: 'sh-morning', dayOffset: 0,  inMin: 31,  dur: 450 },
      { u: 'u-lead', s: 'sh-evening', dayOffset: 0,  inMin: 2,   dur: null }
    ];
    plan.forEach(function (p) {
      var sh = shifts.filter(function (x) { return x.id === p.s; })[0];
      var user = users.filter(function (x) { return x.id === p.u; })[0];
      var d = new Date(today.getTime() + p.dayOffset * 864e5);
      var hm = sh.start.split(':');
      var start = new Date(d); start.setHours(+hm[0], +hm[1], 0, 0);
      var ci = new Date(start.getTime() + p.inMin * 60000);
      var eh = sh.end.split(':');
      var end = new Date(start); end.setHours(+eh[0], +eh[1], 0, 0);
      if (end <= start) end = new Date(end.getTime() + 864e5);
      if (ci > new Date()) return;
      var co = p.dur ? new Date(ci.getTime() + p.dur * 60000) : null;
      if (co && co > new Date()) co = null;
      var late = Math.max(0, p.inMin - sh.grace);
      att.push({
        id: uid('att'), userId: user.id, name: user.name, empId: user.empId,
        shiftId: sh.id, shiftName: sh.name, date: ymd(d),
        checkIn: iso(ci), scheduledEnd: iso(end), checkOut: co ? iso(co) : '',
        durationMin: co ? minsBetween(ci, co) : '',
        lateMin: late, status: co ? (late > 0 ? 'Late' : 'On time') : 'Open',
        photoIn: '', photoOut: '', station: 'SOC-0' + (1 + (att.length % 6)),
        activity: 'Queue handover accepted; monitoring EDR and SIEM alert lanes.',
        handover: co ? 'No open P1. Two low-severity phishing reports pending user reply.' : '',
        alerts: co ? 20 + (att.length * 7) % 40 : '', incidents: co ? (att.length % 3) : '',
        createdAt: iso(ci)
      });
    });

    return { users: users, shifts: shifts, attendance: att, activity: [], audit: [], sessions: {} };
  }

  function db() {
    var d = load();
    if (!d) { d = seed(); save(d); }
    if (!d.activity) d.activity = []; // older saved demo DBs predate the activity log
    return d;
  }

  function log(d, actor, action, detail) {
    d.audit.unshift({ ts: iso(new Date()), actor: actor, action: action, detail: detail || '' });
    d.audit = d.audit.slice(0, 500);
  }

  function pub(u) {
    return { id: u.id, name: u.name, username: u.username, role: u.role, empId: u.empId, email: u.email, defaultShift: u.defaultShift, status: u.status };
  }

  function sessionUser(d, token) {
    var s = d.sessions[token];
    if (!s || new Date(s.exp) < new Date()) return null;
    var u = d.users.filter(function (x) { return x.id === s.userId; })[0];
    return (u && u.status === 'active') ? u : null;
  }

  var RANK = { engineer: 1, lead: 2, admin: 3 };
  function atLeast(user, role) { return RANK[user.role] >= RANK[role]; }

  /* --- action table ------------------------------------------- */
  var actions = {

    login: function (d, p) {
      var u = d.users.filter(function (x) {
        return x.username.toLowerCase() === String(p.username || '').toLowerCase();
      })[0];
      if (!u || u.pass !== p.password) throw new Error('Username or password is not recognised.');
      if (u.status !== 'active') throw new Error('This account is disabled. Ask your SOC administrator.');
      var token = uid('tok');
      d.sessions[token] = { userId: u.id, exp: iso(new Date(Date.now() + 8 * 36e5)) };
      log(d, u.username, 'login', '');
      return { token: token, user: pub(u) };
    },

    logout: function (d, p, me, token) { delete d.sessions[token]; return { ok: true }; },

    bootstrap: function (d, p, me) {
      var mine = d.attendance.filter(function (a) { return a.userId === me.id; });
      return {
        user: pub(me),
        shifts: d.shifts.filter(function (s) { return s.active !== false; }),
        users: atLeast(me, 'lead') ? d.users.map(pub) : [pub(me)],
        openRecord: mine.filter(function (a) { return !a.checkOut; })[0] || null
      };
    },

    checkIn: function (d, p, me) {
      var open = d.attendance.filter(function (a) { return a.userId === me.id && !a.checkOut; })[0];
      if (open) throw new Error('You are still signed on to the ' + open.shiftName + ' shift. Sign off first.');
      var sh = d.shifts.filter(function (s) { return s.id === p.shiftId; })[0];
      if (!sh) throw new Error('That shift no longer exists.');

      var ci = new Date(p.checkIn);
      var hm = sh.start.split(':');
      var start = new Date(ci); start.setHours(+hm[0], +hm[1], 0, 0);
      // Night shift signed on after midnight belongs to the previous day.
      if (sh.end < sh.start && ci.getHours() < 12) start = new Date(start.getTime() - 864e5);
      var late = Math.max(0, minsBetween(start, ci) - (sh.grace || 0));

      var rec = {
        id: uid('att'), userId: me.id, name: me.name, empId: me.empId,
        shiftId: sh.id, shiftName: sh.name, date: ymd(start),
        checkIn: iso(ci), scheduledEnd: iso(new Date(p.scheduledEnd)), checkOut: '',
        durationMin: '', lateMin: late, status: 'Open',
        photoIn: p.photo || '', photoOut: '', station: p.station || '',
        activity: p.activity || '', handover: '', alerts: '', incidents: '', resolved: '',
        createdAt: iso(new Date())
      };
      d.attendance.push(rec);
      log(d, me.username, 'check-in', sh.name + ' · ' + rec.date + (late ? ' · late ' + late + 'm' : ''));
      return { record: rec };
    },

    checkOut: function (d, p, me) {
      var rec = d.attendance.filter(function (a) { return a.id === p.id; })[0];
      if (!rec) throw new Error('That shift record was not found.');
      if (rec.userId !== me.id && !atLeast(me, 'admin')) throw new Error('You can only sign off your own shift.');
      if (rec.checkOut) throw new Error('That shift is already signed off.');

      var co = new Date();
      rec.checkOut = iso(co);
      rec.durationMin = minsBetween(rec.checkIn, co);
      rec.handover = p.handover || '';
      rec.alerts = p.alerts != null ? p.alerts : '';
      rec.incidents = p.incidents != null ? p.incidents : '';
      rec.resolved = p.resolved != null ? p.resolved : '';
      if (p.photo) rec.photoOut = p.photo;
      var early = minsBetween(co, rec.scheduledEnd);
      rec.status = rec.lateMin > 0 ? 'Late' : (early > 15 ? 'Early out' : 'On time');
      if (rec.lateMin > 0 && early > 15) rec.status = 'Late';
      rec.earlyMin = early > 0 ? early : 0;
      log(d, me.username, 'check-out', rec.shiftName + ' · ' + rec.date + ' · ' + rec.durationMin + 'm');
      return { record: rec };
    },

    addActivityUpdate: function (d, p, me) {
      var rec = d.attendance.filter(function (a) { return a.id === p.recordId; })[0];
      if (!rec) throw new Error('That shift record was not found.');
      if (rec.userId !== me.id && !atLeast(me, 'admin')) throw new Error('You can only log activity on your own shift.');
      if (rec.checkOut) throw new Error('That shift is already signed off.');
      var type = ['Note', 'Alert', 'Case', 'Resolved'].indexOf(p.type) >= 0 ? p.type : 'Note';
      var note = String(p.note || '').trim();
      if (!note) throw new Error('Write something before logging it.');
      var severity = ['Low', 'Medium', 'High', 'Critical'].indexOf(p.severity) >= 0 ? p.severity : '';
      var reference = String(p.reference || '').trim().slice(0, 40);
      var entry = { id: uid('act'), recordId: p.recordId, userId: me.id, name: me.name, ts: iso(new Date()), type: type, note: note, severity: severity, reference: reference };
      d.activity.push(entry);
      log(d, me.username, 'activity logged', type + ' · ' + note.slice(0, 80));
      return { record: entry };
    },

    listActivityUpdates: function (d, p, me) {
      var rec = d.attendance.filter(function (a) { return a.id === p.recordId; })[0];
      if (!rec) throw new Error('That shift record was not found.');
      if (rec.userId !== me.id && !atLeast(me, 'lead')) throw new Error('Your role does not allow that.');
      var rows = d.activity.filter(function (a) { return a.recordId === p.recordId; })
        .slice().sort(function (a, b) { return new Date(b.ts) - new Date(a.ts); });
      return { rows: rows };
    },

    boardData: function (d, p, me) {
      var full = atLeast(me, 'lead');
      var rows = d.attendance.filter(function (a) {
        return (!p.from || a.date >= p.from) && (!p.to || a.date <= p.to);
      }).map(function (a) {
        if (full || a.userId === me.id) return a;
        var o = {}; Object.keys(a).forEach(function (k) { o[k] = a[k]; });
        o.activity = ''; o.handover = ''; o.photoIn = ''; o.photoOut = '';
        return o;
      });
      return { rows: rows };
    },

    listAttendance: function (d, p, me) {
      var rows = d.attendance.slice();
      if (!atLeast(me, 'lead')) rows = rows.filter(function (a) { return a.userId === me.id; });
      if (p.mine) rows = rows.filter(function (a) { return a.userId === me.id; });
      if (p.from) rows = rows.filter(function (a) { return a.date >= p.from; });
      if (p.to) rows = rows.filter(function (a) { return a.date <= p.to; });
      if (p.shiftId) rows = rows.filter(function (a) { return a.shiftId === p.shiftId; });
      if (p.userId) rows = rows.filter(function (a) { return a.userId === p.userId; });
      if (p.status) rows = rows.filter(function (a) { return a.status === p.status; });
      rows.sort(function (a, b) { return new Date(b.checkIn) - new Date(a.checkIn); });
      return { rows: rows };
    },

    deleteAttendance: function (d, p, me) {
      if (!atLeast(me, 'admin')) throw new Error('Only an administrator can delete a shift record.');
      d.attendance = d.attendance.filter(function (a) { return a.id !== p.id; });
      log(d, me.username, 'delete attendance', p.id);
      return { ok: true };
    },

    listUsers: function (d, p, me) {
      if (!atLeast(me, 'lead')) throw new Error('You do not have access to the roster.');
      return { rows: d.users.map(pub) };
    },

    saveUser: function (d, p, me) {
      if (!atLeast(me, 'admin')) throw new Error('Only an administrator can change the roster.');
      var existing = p.id ? d.users.filter(function (u) { return u.id === p.id; })[0] : null;
      var clash = d.users.filter(function (u) {
        return u.username.toLowerCase() === String(p.username).toLowerCase() && u.id !== p.id;
      })[0];
      if (clash) throw new Error('That username is already taken.');
      if (existing) {
        existing.name = p.name; existing.username = p.username; existing.role = p.role;
        existing.empId = p.empId; existing.email = p.email;
        existing.defaultShift = p.defaultShift; existing.status = p.status;
        if (p.password) existing.pass = p.password;
        log(d, me.username, 'user updated', p.username);
        return { record: pub(existing) };
      }
      if (!p.password) throw new Error('Set an initial password for the new account.');
      var u = {
        id: uid('u'), name: p.name, username: p.username, pass: p.password, role: p.role,
        empId: p.empId || '', email: p.email || '', defaultShift: p.defaultShift || '', status: p.status || 'active'
      };
      d.users.push(u);
      log(d, me.username, 'user created', p.username);
      return { record: pub(u) };
    },

    deleteUser: function (d, p, me) {
      if (!atLeast(me, 'admin')) throw new Error('Only an administrator can remove an account.');
      if (p.id === me.id) throw new Error('You cannot remove your own account.');
      d.users = d.users.filter(function (u) { return u.id !== p.id; });
      log(d, me.username, 'user removed', p.id);
      return { ok: true };
    },

    listShifts: function (d) { return { rows: d.shifts }; },

    saveShift: function (d, p, me) {
      if (!atLeast(me, 'admin')) throw new Error('Only an administrator can change the shift pattern.');
      var s = p.id ? d.shifts.filter(function (x) { return x.id === p.id; })[0] : null;
      if (s) {
        s.name = p.name; s.start = p.start; s.end = p.end; s.grace = +p.grace; s.min = +p.min;
      } else {
        s = { id: uid('sh'), name: p.name, start: p.start, end: p.end, grace: +p.grace, min: +p.min, active: true };
        d.shifts.push(s);
      }
      log(d, me.username, 'shift saved', p.name);
      return { record: s };
    },

    deleteShift: function (d, p, me) {
      if (!atLeast(me, 'admin')) throw new Error('Only an administrator can remove a shift.');
      d.shifts = d.shifts.filter(function (s) { return s.id !== p.id; });
      log(d, me.username, 'shift removed', p.id);
      return { ok: true };
    },

    listAudit: function (d, p, me) {
      if (!atLeast(me, 'admin')) throw new Error('The audit trail is restricted to administrators.');
      return { rows: d.audit };
    },

    resetDemo: function (d) { save(seed()); return { ok: true }; }
  };

  /* --- dispatcher --------------------------------------------- */
  window.DemoBackend = {
    call: function (action, payload, token) {
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          try {
            var d = db();
            var fn = actions[action];
            if (!fn) throw new Error('Unknown action: ' + action);
            var me = null;
            if (action !== 'login' && action !== 'resetDemo') {
              me = sessionUser(d, token);
              if (!me) throw new Error('Your session has expired. Sign in again.');
            }
            var out = fn(d, payload || {}, me, token);
            save(d);
            resolve(out);
          } catch (err) { reject(err); }
        }, 140); // small delay so loading states are visible
      });
    }
  };
})();
