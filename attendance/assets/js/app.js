/* ============================================================
   Shift Desk — application
   ============================================================ */

(function () {
  'use strict';

  var CFG = window.SHIFTDESK_CONFIG;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var S = {
    user: null, shifts: [], users: [], open: null,
    page: 'board', boardDate: null, photo: null,
    teamRows: [], myRows: []
  };

  var RANK = { engineer: 1, lead: 2, admin: 3 };
  var can = function (min) { return S.user && RANK[S.user.role] >= RANK[min]; };

  var NAV = [
    { group: 'Watch floor', items: [
      { id: 'board',     label: 'Live board',     min: 'engineer', title: 'Live board',     sub: 'Who is on the floor and where the gaps are.' },
      { id: 'checkin',   label: 'Shift check-in', min: 'engineer', title: 'Shift check-in', sub: 'Sign on when you take the desk, sign off when you hand over.' },
      { id: 'mylog',     label: 'My log',         min: 'engineer', title: 'My log',         sub: 'Your own attendance history.' }
    ]},
    { group: 'Supervision', items: [
      { id: 'team',      label: 'Team log',       min: 'lead', title: 'Team log',            sub: 'All attendance across the roster, filterable and exportable.' }
    ]},
    { group: 'Administration', items: [
      { id: 'roster',    label: 'Roster & shifts', min: 'admin', title: 'Roster & shifts', sub: 'Accounts, roles and the shift pattern.' },
      { id: 'audit',     label: 'Audit trail',     min: 'admin', title: 'Audit trail',     sub: 'Every sign-in, edit and approval.' }
    ]}
  ];

  /* ================= utilities ================= */

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { d = new Date(d); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function hm(d) { d = new Date(d); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function hms(d) { d = new Date(d); return hm(d) + ':' + pad(d.getSeconds()); }
  function localInput(d) { d = new Date(d); return ymd(d) + 'T' + hm(d); }
  function dayLabel(s) {
    // Accepts a plain "2026-08-26" or, defensively, a full timestamp that
    // shouldn't be here — pull just the calendar-day prefix either way so a
    // malformed value never renders as the literal text "Invalid Date".
    var m = String(s == null ? '' : s).match(/^(\d{4}-\d{2}-\d{2})/);
    if (!m) return '—';
    var d = new Date(m[1] + 'T00:00:00');
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
  }
  function dur(min) {
    if (min === '' || min == null || isNaN(min)) return '—';
    min = Math.max(0, Math.round(min));
    return Math.floor(min / 60) + 'h ' + pad(min % 60) + 'm';
  }
  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  }
  function addDays(s, n) { var d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d); }

  /* Accepts "06:00", an ISO timestamp, or anything Date can parse, and
     returns [hours, minutes]. Guards against Sheets turning times into dates. */
  function hmParts(v) {
    if (v == null) return [0, 0];
    var str = String(v);
    var m = str.match(/^(\d{1,2}):(\d{2})/);
    if (m) return [+m[1], +m[2]];
    m = str.match(/T(\d{2}):(\d{2})/);
    if (m) return [+m[1], +m[2]];
    var d = new Date(str);
    if (!isNaN(d.getTime())) return [d.getUTCHours(), d.getUTCMinutes()];
    return [0, 0];
  }

  function shiftWindow(shift, at) {
    var ref = new Date(at);
    var sp = hmParts(shift.start), ep = hmParts(shift.end);
    var start = new Date(ref); start.setHours(sp[0], sp[1], 0, 0);
    var wraps = (ep[0] * 60 + ep[1]) <= (sp[0] * 60 + sp[1]);
    if (wraps && ref.getHours() < 12) start.setDate(start.getDate() - 1);
    var end = new Date(start); end.setHours(ep[0], ep[1], 0, 0);
    if (end <= start) end.setDate(end.getDate() + 1);
    return { start: start, end: end };
  }
  function shiftById(id) { return S.shifts.filter(function (s) { return s.id === id; })[0] || null; }
  function currentShift() {
    var now = new Date();
    for (var i = 0; i < S.shifts.length; i++) {
      var w = shiftWindow(S.shifts[i], now);
      if (now >= w.start && now < w.end) return { shift: S.shifts[i], win: w };
    }
    return null;
  }

  function toast(msg, kind) {
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(function () { el.remove(); }, 4200);
  }
  function showErr(sel, msg) {
    var el = $(sel);
    if (!msg) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false; el.textContent = msg;
  }
  function busy(btn, on, label) {
    if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.textContent = label || 'Working…'; }
    else { btn.disabled = false; btn.textContent = btn.dataset.label || btn.textContent; }
  }

  function statusPill(row) {
    if (!row.checkOut) return '<span class="pill info">On shift</span>';
    if (row.status === 'Late') return '<span class="pill warn">Late ' + row.lateMin + 'm</span>';
    if (row.status === 'Early out') return '<span class="pill warn">Early out</span>';
    return '<span class="pill ok">On time</span>';
  }
  function thumb(src, alt) {
    return src
      ? '<img class="thumb" src="' + esc(src) + '" alt="' + esc(alt) + '" data-zoom="' + esc(src) + '" onerror="window.imgFail(this)">'
      : '<span class="no-thumb" title="No photo">–</span>';
  }

  // A Drive link can stop resolving (sharing revoked, file moved) long after
  // the record was written. Rather than a silent broken-image icon plus
  // stray alt text, swap it for an explicit placeholder.
  window.imgFail = function (img) {
    var cls = img.classList.contains('card-av') ? 'card-av' : 'no-thumb';
    img.outerHTML = '<span class="' + cls + '" title="Photo failed to load">' + (img.dataset.fallback || '!') + '</span>';
  };
  window.imgFailBox = function (img) {
    img.replaceWith(Object.assign(document.createElement('p'), { className: 'lightbox-fail', textContent: 'Photo failed to load.' }));
  };

  document.addEventListener('click', function (e) {
    var z = e.target.closest('[data-zoom]');
    if (z) {
      var box = document.createElement('div');
      box.className = 'lightbox';
      box.innerHTML = '<img src="' + esc(z.dataset.zoom) + '" alt="Attendance photo" onerror="window.imgFailBox(this)">';
      box.addEventListener('click', function () { box.remove(); });
      document.body.appendChild(box);
    }
  });

  /* ================= boot & auth ================= */

  function tickClock() {
    var now = new Date();
    var c = $('#clock'); if (c) c.textContent = hms(now);
    var l = $('#loginNow'); if (l) l.textContent = ymd(now) + '  ' + hms(now);
    var cur = currentShift();
    if ($('#onAirShift')) {
      $('#onAirShift').textContent = cur ? cur.shift.name.toUpperCase() : 'NO SHIFT';
      $('#onAirWindow').textContent = cur ? cur.shift.start + '–' + cur.shift.end : 'outside rota';
    }
  }
  setInterval(tickClock, 1000);

  async function start() {
    $('#modeLabel').textContent = window.API.mode;
    $('#demoHint').hidden = window.API.isLive;
    $('#loginShiftList').textContent = '3 shifts · 24h';

    if (window.API.getToken()) {
      try { await enterApp(); return; } catch (e) { window.API.setToken(null); }
    }
    document.body.dataset.view = 'login';
    $('#login').hidden = false;
    tickClock();
  }

  async function enterApp() {
    var stage = 'bootstrap';
    try {
    var b = await window.API.call('bootstrap', {});
    stage = 'state';
    S.user = b.user;
    S.shifts = (b.shifts || []).map(function (s) {
      var a = hmParts(s.start), z = hmParts(s.end);
      s.start = pad(a[0]) + ':' + pad(a[1]);
      s.end = pad(z[0]) + ':' + pad(z[1]);
      return s;
    });
    S.users = b.users || [];
    S.open = b.openRecord;
    S.boardDate = ymd(new Date());

    stage = 'show app';
    document.body.dataset.view = 'app';
    $('#login').hidden = true;
    $('#app').hidden = false;

    stage = 'identity';
    $('#whoName').textContent = S.user.name;
    $('#whoRole').textContent = S.user.role === 'lead' ? 'Shift lead' : S.user.role;
    $('#whoAv').textContent = initials(S.user.name);

    stage = 'buildNav';    buildNav();
    stage = 'shiftSelects'; fillShiftSelects();
    stage = 'clock';       tickClock();
    stage = 'render page'; go(S.page === 'board' ? 'board' : S.page);
    } catch (err) {
      console.error('[shiftdesk] enterApp FAILED at stage "' + stage + '":', err);
      throw new Error('Sign-in failed while loading the app (' + stage + '): ' + err.message);
    }
  }

  $('#loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    showErr('#loginError', '');
    var btn = $('#loginBtn'); busy(btn, true, 'Checking…');
    try {
      await window.API.login($('#loginUser').value.trim(), $('#loginPass').value);
      await enterApp();
    } catch (err) {
      console.error('[shiftdesk] login handler caught:', err, err && err.stack);
      showErr('#loginError', err.message);
    } finally { busy(btn, false); }
  });

  $$('#demoHint .chip').forEach(function (c) {
    c.addEventListener('click', function () {
      var map = { admin: ['admin', 'admin123'], lead: ['lead', 'lead123'], eng: ['eng', 'eng123'] };
      var v = map[c.dataset.fill];
      $('#loginUser').value = v[0]; $('#loginPass').value = v[1];
    });
  });

  $('#logoutBtn').addEventListener('click', async function () {
    await window.API.logout();
    location.reload();
  });

  /* ================= navigation ================= */

  function buildNav() {
    var html = '';
    NAV.forEach(function (g) {
      var items = g.items.filter(function (i) { return can(i.min); });
      if (!items.length) return;
      html += '<div class="nav-group">' + esc(g.group) + '</div>';
      items.forEach(function (i) {
        html += '<button class="nav-item" type="button" data-go="' + i.id + '"><span>' + esc(i.label) + '</span></button>';
      });
    });
    $('#railNav').innerHTML = html;
    $$('#railNav [data-go]').forEach(function (b) {
      b.addEventListener('click', function () { go(b.dataset.go); });
    });
  }

  function meta(id) {
    var found = null;
    NAV.forEach(function (g) { g.items.forEach(function (i) { if (i.id === id) found = i; }); });
    return found;
  }

  function go(page) {
    var m = meta(page);
    if (!m || !can(m.min)) { page = 'board'; m = meta('board'); }
    S.page = page;
    $$('.view').forEach(function (v) { v.classList.toggle('is-on', v.dataset.page === page); });
    $$('#railNav [data-go]').forEach(function (b) { b.classList.toggle('is-on', b.dataset.go === page); });
    $('#pageTitle').textContent = m.title;
    $('#pageSub').textContent = m.sub;
    var render = { board: renderBoard, checkin: renderCheckin, mylog: renderMyLog,
       team: renderTeam, roster: renderRoster, audit: renderAudit }[page];
    if (!render) return;
    try {
      var out = render();
      if (out && out.catch) out.catch(function (e) { toast('Could not load this page: ' + e.message, 'bad'); });
    } catch (e) { toast('Could not load this page: ' + e.message, 'bad'); }
  }

  function fillShiftSelects() {
    var opts = S.shifts.map(function (s) {
      return '<option value="' + esc(s.id) + '">' + esc(s.name) + ' · ' + esc(s.start) + '–' + esc(s.end) + '</option>';
    }).join('');
    $('#ciShift').innerHTML = opts;
    $('#uShift').innerHTML = '<option value="">None</option>' + opts;
    $('#fShift').innerHTML = '<option value="">All shifts</option>' + opts;
    $('#fUser').innerHTML = '<option value="">All engineers</option>' + S.users.map(function (u) {
      return '<option value="' + esc(u.id) + '">' + esc(u.name) + '</option>';
    }).join('');
    if (S.user.defaultShift) $('#ciShift').value = S.user.defaultShift;
  }

  /* ================= live board ================= */

  $('#boardDate').addEventListener('change', function () { S.boardDate = this.value; renderBoard(); });
  $('#dayPrev').addEventListener('click', function () { S.boardDate = addDays(S.boardDate, -1); renderBoard(); });
  $('#dayNext').addEventListener('click', function () { S.boardDate = addDays(S.boardDate, 1); renderBoard(); });
  $('#dayToday').addEventListener('click', function () { S.boardDate = ymd(new Date()); renderBoard(); });

  async function renderBoard() {
    $('#boardDate').value = S.boardDate;
    var D = S.boardDate;
    var res = await window.API.call('boardData', { from: addDays(D, -1), to: addDays(D, 1) });
    var rows = res.rows;

    drawAxis();
    var gapHours = drawPlan(rows, D);
    drawLanes(rows, D);

    var today = rows.filter(function (r) { return r.date === D; });
    var open = rows.filter(function (r) { return !r.checkOut; });
    var late = today.filter(function (r) { return r.lateMin > 0; });

    $('#statStrip').innerHTML = [
      stat(open.length, 'On the floor', 'live'),
      stat(today.length, 'Signed on ' + dayLabel(D)),
      stat(late.length, 'Late arrivals', late.length ? 'warn' : ''),
      stat(gapHours.toFixed(1) + 'h', 'Uncovered', gapHours > 0 ? 'alarm' : 'live')
    ].join('');

    $('#onFloor').innerHTML = open.length ? open.map(function (r) {
      var w = shiftWindow(shiftById(r.shiftId) || { start: '00:00', end: '00:00' }, r.checkIn);
      var left = Math.round((w.end - new Date()) / 60000);
      return card(r.photoIn, r.name, statusPill(r),
        r.shiftName + ' shift · on since <span class="mono">' + hm(r.checkIn) + '</span>' +
        (r.station ? ' · ' + esc(r.station) : '') +
        ' · ' + (left > 0 ? dur(left) + ' left' : 'past scheduled end'),
        r.activity);
    }).join('') : '<p class="empty">Nobody is signed on right now.</p>';

    var ex = [];
    late.forEach(function (r) { ex.push(card(r.photoIn, r.name, '<span class="pill warn">Late ' + r.lateMin + 'm</span>', r.shiftName + ' · signed on <span class="mono">' + hm(r.checkIn) + '</span>', '')); });
    today.filter(function (r) { return r.status === 'Early out'; }).forEach(function (r) {
      ex.push(card(r.photoOut || r.photoIn, r.name, '<span class="pill warn">Early out</span>', r.shiftName + ' · signed off <span class="mono">' + hm(r.checkOut) + '</span>', r.handover));
    });
    $('#exceptions').innerHTML = ex.length ? ex.join('') : '<p class="empty">Clean day. No late arrivals or early departures.</p>';
  }

  function stat(n, l, k) {
    return '<div class="stat ' + (k || '') + '"><span class="n">' + esc(n) + '</span><span class="l">' + esc(l) + '</span></div>';
  }
  function card(photo, name, pill, meta, note) {
    return '<div class="card">' +
      (photo ? '<img class="card-av" src="' + esc(photo) + '" alt="" data-zoom="' + esc(photo) + '" data-fallback="' + esc(initials(name)) + '" onerror="window.imgFail(this)">'
             : '<span class="card-av">' + esc(initials(name)) + '</span>') +
      '<div class="card-body"><div class="card-title"><strong>' + esc(name) + '</strong>' + (pill || '') + '</div>' +
      '<div class="card-meta">' + meta + '</div>' +
      (note ? '<div class="card-note">' + esc(note) + '</div>' : '') + '</div></div>';
  }

  function drawAxis() {
    var h = '';
    for (var i = 0; i <= 24; i += 3) h += '<span class="tick" style="left:' + (i / 24 * 100) + '%">' + pad(i % 24) + '</span>';
    $('#ribbonAxis').innerHTML = h;
  }

  /* Planned blocks for the day, coloured by how well they were staffed.
     Returns the number of hours with nobody signed on. */
  function drawPlan(rows, D) {
    var segs = [];
    S.shifts.forEach(function (s) {
      var sp = hmParts(s.start), ep = hmParts(s.end);
      var a = sp[0] + sp[1] / 60, b = ep[0] + ep[1] / 60;
      if (b > a) segs.push({ s: s, from: a, to: b, date: D });
      else { segs.push({ s: s, from: a, to: 24, date: D }); segs.push({ s: s, from: 0, to: b, date: addDays(D, -1) }); }
    });

    var gap = 0;
    var html = segs.filter(function (g) { return g.to > g.from; }).map(function (g) {
      var staff = rows.filter(function (r) { return r.shiftId === g.s.id && r.date === g.date; }).length;
      var need = +g.s.min || 1;
      var cls = staff === 0 ? 'gap' : (staff < need ? 'warn' : 'ok');
      if (staff === 0) gap += (g.to - g.from);
      return '<div class="plan-seg ' + cls + '" style="left:' + (g.from / 24 * 100) + '%;width:' + ((g.to - g.from) / 24 * 100) + '%" ' +
        'title="' + esc(g.s.name) + ' — ' + staff + ' of ' + need + ' engineers signed on">' +
        '<b>' + esc(g.s.name) + '</b><i>' + staff + '/' + need + '</i></div>';
    }).join('');

    $('#ribbonPlan').innerHTML = html;
    return gap;
  }

  /* One lane per engineer showing when they were actually signed on. */
  function drawLanes(rows, D) {
    var dayStart = new Date(D + 'T00:00:00');
    var dayEnd = new Date(dayStart.getTime() + 864e5);
    var now = new Date();
    var byUser = {};

    rows.forEach(function (r) {
      var a = new Date(r.checkIn);
      var b = r.checkOut ? new Date(r.checkOut) : (now < new Date(r.scheduledEnd) ? now : new Date(r.scheduledEnd));
      if (b <= dayStart || a >= dayEnd) return;
      (byUser[r.userId] = byUser[r.userId] || { name: r.name, bars: [] }).bars.push({
        from: Math.max(0, (a - dayStart) / 36e5),
        to: Math.min(24, (b - dayStart) / 36e5),
        late: r.lateMin > 0, open: !r.checkOut, label: hm(a) + '→' + (r.checkOut ? hm(r.checkOut) : 'now')
      });
    });

    var keys = Object.keys(byUser);
    if (!keys.length) {
      $('#ribbonLanes').innerHTML = '<p class="lane-empty">No desk time recorded on ' + esc(dayLabel(D)) + '.</p>';
      return;
    }
    $('#ribbonLanes').innerHTML = keys.map(function (k) {
      var u = byUser[k];
      return '<div class="lane"><span class="lane-name" title="' + esc(u.name) + '">' + esc(u.name) + '</span>' +
        '<span class="lane-track">' + u.bars.map(function (b) {
          return '<span class="lane-bar' + (b.late ? ' late' : '') + (b.open ? ' open' : '') + '" ' +
            'style="left:' + (b.from / 24 * 100) + '%;width:' + Math.max(1.2, (b.to - b.from) / 24 * 100) + '%" ' +
            'title="' + esc(b.label) + '">' + esc(b.label) + '</span>';
        }).join('') + '</span></div>';
    }).join('');
  }

  /* ================= camera ================= */

  var stream = null;

  async function camOn() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false });
      var v = $('#cam'); v.srcObject = stream; await v.play();
      $('#camEmpty').hidden = true; $('#camShoot').disabled = false;
    } catch (e) {
      toast('The camera could not be opened. Use "Upload instead", or check that the site has camera permission.', 'bad');
    }
  }
  function camOff() {
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
  }
  function downscale(srcCanvasOrImg, w, h) {
    var max = CFG.PHOTO_MAX_EDGE, scale = Math.min(1, max / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    c.getContext('2d').drawImage(srcCanvasOrImg, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', CFG.PHOTO_QUALITY);
  }
  function setShot(dataUrl) {
    S.photo = dataUrl;
    var img = $('#camShot');
    img.src = dataUrl; img.hidden = false;
    $('#cam').hidden = true; $('#camEmpty').hidden = true;
    $('#camShoot').hidden = true; $('#camRetake').hidden = false;
    camOff();
  }

  $('#camStart').addEventListener('click', camOn);
  $('#camShoot').addEventListener('click', function () {
    var v = $('#cam'), c = $('#camCanvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    setShot(downscale(c, c.width, c.height));
  });
  $('#camRetake').addEventListener('click', function () {
    S.photo = null;
    $('#camShot').hidden = true; $('#cam').hidden = false;
    $('#camRetake').hidden = true; $('#camShoot').hidden = false; $('#camShoot').disabled = true;
    $('#camEmpty').hidden = false;
  });
  $('#camFile').addEventListener('change', function (e) {
    var f = e.target.files[0]; if (!f) return;
    var img = new Image();
    img.onload = function () { setShot(downscale(img, img.naturalWidth, img.naturalHeight)); };
    img.src = URL.createObjectURL(f);
  });
  $('#camAddOut').addEventListener('click', function () {
    $('#camSummary').hidden = true;
    $('#camCapture').hidden = false;
  });

  /* ================= check in / out ================= */

  function renderCheckin() {
    $('#ciName').value = S.user.name;
    $('#ciNew').hidden = !!S.open;
    $('#ciOpen').hidden = !S.open;

    // The camera only matters twice — the sign-on shot, and an optional
    // sign-off shot. Once signed on, collapse it to a small summary of what
    // was already captured so the shift-activity form gets the room instead;
    // "Add sign-off photo" reveals the full capture UI again on demand.
    camOff();
    $('#camSummary').hidden = !S.open;
    $('#camCapture').hidden = !!S.open;
    if (S.open) $('#camSummaryPhoto').innerHTML = thumb(S.open.photoIn, 'Sign-on photo');

    if (S.open) {
      $('#ciOpenAt').textContent = hm(S.open.checkIn);
      $('#ciOpenShift').textContent = S.open.shiftName;
      renderActivityLog();
    } else {
      // Default to whatever shift is running right now; fall back to the
      // engineer's usual one. Stops a 06:10 sign-on being filed against
      // last night's shift by accident.
      var cur = currentShift();
      $('#ciShift').value = cur ? cur.shift.id : (S.user.defaultShift || S.shifts[0] && S.shifts[0].id);
      syncShiftTimes();
    }
  }

  function syncShiftTimes() {
    var s = shiftById($('#ciShift').value);
    if (!s) return;
    var now = new Date();
    var w = shiftWindow(s, now);
    $('#ciTime').value = localInput(now);
    $('#ciEnd').value = localInput(w.end);

    var lateBy = Math.round((now - w.start) / 60000) - (+s.grace || 0);
    if (now >= w.end) {
      showErr('#ciLateWarn', 'The ' + s.name + ' shift you picked ran ' + hm(w.start) + '–' + hm(w.end) + ' and has already ended. Pick the shift you are actually covering, or correct the sign-on time below.');
    } else if (now < w.start) {
      showErr('#ciLateWarn', 'This shift does not start until ' + hm(w.start) + '. Signing on early is fine, it is just logged as early.');
    } else if (lateBy > 0) {
      showErr('#ciLateWarn', 'This shift started at ' + hm(w.start) + '. Signing on now is recorded as ' + lateBy + ' minutes late.');
    } else {
      showErr('#ciLateWarn', '');
    }
  }
  $('#ciShift').addEventListener('change', syncShiftTimes);

  $('#checkinForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    showErr('#ciError', '');
    if (CFG.REQUIRE_PHOTO && !S.photo) { showErr('#ciError', 'Capture a desk photo before signing on.'); return; }
    var btn = e.target.querySelector('button[type=submit]'); busy(btn, true, 'Signing on…');
    try {
      var out = await window.API.call('checkIn', {
        shiftId: $('#ciShift').value,
        checkIn: new Date($('#ciTime').value).toISOString(),
        scheduledEnd: new Date($('#ciEnd').value).toISOString(),
        station: $('#ciStation').value.trim(),
        activity: $('#ciActivity').value.trim(),
        photo: S.photo || ''
      });
      S.open = out.record; S.photo = null;
      $('#camRetake').click();
      toast('Signed on to the ' + out.record.shiftName + ' shift at ' + hm(out.record.checkIn) + '.');
      renderCheckin();
    } catch (err) { showErr('#ciError', err.message); }
    finally { busy(btn, false); }
  });

  $('#checkoutForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    showErr('#coError', '');
    if (!$('#coHandover').value.trim()) { showErr('#coError', 'Write handover notes so the next shift knows what they are picking up.'); return; }
    var btn = e.target.querySelector('button[type=submit]'); busy(btn, true, 'Signing off…');
    try {
      var out = await window.API.call('checkOut', {
        id: S.open.id,
        handover: $('#coHandover').value.trim(),
        alerts: +$('#coAlerts').value || 0,
        incidents: +$('#coIncidents').value || 0,
        resolved: +$('#coResolved').value || 0,
        photo: S.photo || ''
      });
      toast('Shift signed off. ' + dur(out.record.durationMin) + ' on the desk.');
      S.open = null; S.photo = null;
      $('#checkoutForm').reset();
      renderCheckin();
    } catch (err) { showErr('#coError', err.message); }
    finally { busy(btn, false); }
  });

  /* ---- shift activity log: a running log the engineer can add to at any
     point during an open shift, instead of writing everything up cold at
     sign-off. Tallies of Alert/Case/Resolved entries pre-fill the sign-off
     counters, which stay editable. ---- */

  var ACT_LABEL = { Note: 'Note', Alert: 'Alert', Case: 'Case raised', Resolved: 'Resolved' };
  var ACT_CLASS = { Note: 'mute', Alert: 'warn', Case: 'info', Resolved: 'ok' };
  var SEV_CLASS = { Low: 'mute', Medium: 'warn', High: 'warn', Critical: 'bad' };

  function activityItemHtml(r) {
    var sev = r.severity ? ' <span class="pill ' + SEV_CLASS[r.severity] + '">' + esc(r.severity) + '</span>' : '';
    var ref = r.reference ? ' <span class="activity-ref mono">' + esc(r.reference) + '</span>' : '';
    return '<div class="activity-item"><span class="pill ' + ACT_CLASS[r.type] + '">' + esc(ACT_LABEL[r.type] || r.type) + '</span>' + sev +
      '<span class="activity-note">' + esc(r.note) + ref + '</span>' +
      '<span class="activity-time mono">' + esc(hm(r.ts)) + '</span></div>';
  }

  async function renderActivityLog() {
    if (!S.open) return;
    var list = $('#actList');
    list.innerHTML = '<p class="empty">Loading…</p>';
    try {
      var res = await window.API.call('listActivityUpdates', { recordId: S.open.id });
      var rows = res.rows || [];
      list.innerHTML = rows.length ? rows.map(activityItemHtml).join('') : '<p class="empty">Nothing logged yet this shift.</p>';

      var tally = { Alert: 0, Case: 0, Resolved: 0 };
      rows.forEach(function (r) { if (tally[r.type] != null) tally[r.type]++; });
      $('#coAlerts').value = tally.Alert;
      $('#coIncidents').value = tally.Case;
      $('#coResolved').value = tally.Resolved;
    } catch (err) {
      list.innerHTML = '<p class="empty">Could not load the activity log.</p>';
    }
  }

  $('#actForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    showErr('#actError', '');
    var note = $('#actNote').value.trim();
    if (!note) { showErr('#actError', 'Write something before logging it.'); return; }
    var btn = e.target.querySelector('button[type=submit]'); busy(btn, true, 'Logging…');
    try {
      await window.API.call('addActivityUpdate', {
        recordId: S.open.id, type: $('#actType').value, note: note,
        severity: $('#actSeverity').value, reference: $('#actReference').value.trim()
      });
      $('#actNote').value = ''; $('#actSeverity').value = ''; $('#actReference').value = '';
      await renderActivityLog();
    } catch (err) { showErr('#actError', err.message); }
    finally { busy(btn, false); }
  });

  /* ================= my log ================= */

  var MY_COLS = ['Date', 'Shift', 'On', 'Off', 'Hours', 'Status', 'Photo', 'Handover', ''];

  async function renderMyLog() {
    var res = await window.API.call('listAttendance', { mine: true });
    var rows = res.rows;
    S.myRows = rows;
    var done = rows.filter(function (r) { return r.checkOut; });
    var mins = done.reduce(function (a, r) { return a + (+r.durationMin || 0); }, 0);
    var late = rows.filter(function (r) { return r.lateMin > 0; }).length;
    $('#myStats').innerHTML = [
      stat(rows.length, 'Shifts logged'),
      stat(dur(mins), 'Total desk time', 'live'),
      stat(late, 'Late arrivals', late ? 'warn' : ''),
      stat(rows.length ? Math.round((rows.length - late) / rows.length * 100) + '%' : '—', 'Punctuality')
    ].join('');
    $('#myTable').innerHTML = table(MY_COLS, rows, function (r) {
      return '<td class="num">' + esc(dayLabel(r.date)) + '</td><td>' + esc(r.shiftName) + '</td>' +
        '<td class="num">' + esc(hm(r.checkIn)) + '</td>' +
        '<td class="num">' + (r.checkOut ? esc(hm(r.checkOut)) : '—') + '</td>' +
        '<td class="num">' + esc(dur(r.durationMin)) + '</td>' +
        '<td>' + statusPill(r) + '</td><td>' + thumb(r.photoIn, 'Sign-on photo') + '</td>' +
        '<td>' + esc((r.handover || r.activity || '—').slice(0, 90)) + '</td>' +
        '<td><button class="btn btn-ghost btn-sm" data-detail="' + esc(r.id) + '">Details</button></td>';
    }, 'You have not signed on to a shift yet.');

    $$('#myTable [data-detail]').forEach(function (b) {
      b.addEventListener('click', function () { showRecordDetail(rowById(S.myRows, b.dataset.detail)); });
    });
  }

  function rowById(rows, id) { return (rows || []).filter(function (r) { return r.id === id; })[0] || null; }

  /* ---- shift record detail modal: the team/my-log tables only have room
     for a truncated line of handover text, so a Details button opens the
     full picture — both photos, opening activity, handover, the counters,
     and the full mid-shift activity log for that record. ---- */

  async function showRecordDetail(row) {
    if (!row) return;
    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = '<div class="modal-box"><button class="modal-close" type="button" aria-label="Close">×</button><div class="modal-body"><p class="empty">Loading…</p></div></div>';
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
    modal.querySelector('.modal-close').addEventListener('click', function () { modal.remove(); });
    document.body.appendChild(modal);

    var acts = [];
    try { acts = (await window.API.call('listActivityUpdates', { recordId: row.id })).rows || []; }
    catch (err) { /* older record predating the log, or view not permitted — just show what we have */ }

    modal.querySelector('.modal-body').innerHTML = recordDetailHtml(row, acts);
  }

  function recordDetailHtml(r, acts) {
    var photos = (r.photoIn ? '<div class="detail-photo">' + thumb(r.photoIn, 'Sign-on photo') + '<span>Sign-on</span></div>' : '') +
      (r.photoOut ? '<div class="detail-photo">' + thumb(r.photoOut, 'Sign-off photo') + '<span>Sign-off</span></div>' : '');

    var counters = [
      stat(r.alerts === '' || r.alerts == null ? '—' : r.alerts, 'Alerts triaged'),
      stat(r.incidents === '' || r.incidents == null ? '—' : r.incidents, 'Cases raised'),
      stat(r.resolved === '' || r.resolved == null ? '—' : r.resolved, 'Issues resolved')
    ].join('');

    var log = acts.length ? acts.map(activityItemHtml).join('') : '<p class="empty">Nothing logged during this shift.</p>';

    return '<div class="detail-head"><h3>' + esc(r.name) + '</h3>' + statusPill(r) +
      '<p>' + esc(dayLabel(r.date)) + ' · ' + esc(r.shiftName) + ' shift · ' +
      '<span class="mono">' + esc(hm(r.checkIn)) + '–' + (r.checkOut ? esc(hm(r.checkOut)) : 'now') + '</span>' +
      (r.station ? ' · ' + esc(r.station) : '') + '</p></div>' +
      (photos ? '<div class="detail-photos">' + photos + '</div>' : '') +
      '<div class="stat-strip">' + counters + '</div>' +
      (r.activity ? '<div class="detail-block"><h4>Opening activity</h4><p>' + esc(r.activity) + '</p></div>' : '') +
      (r.handover ? '<div class="detail-block"><h4>Handover notes</h4><p>' + esc(r.handover) + '</p></div>' : '') +
      '<div class="detail-block"><h4>Shift activity log</h4><div class="activity-list">' + log + '</div></div>';
  }

  function table(cols, rows, rowFn, emptyMsg) {
    if (!rows.length) return '<tbody><tr><td class="empty" colspan="' + cols.length + '">' + esc(emptyMsg) + '</td></tr></tbody>';
    return '<thead><tr>' + cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead>' +
      '<tbody>' + rows.map(function (r) { return '<tr>' + rowFn(r) + '</tr>'; }).join('') + '</tbody>';
  }

  /* ================= team log ================= */

  var TEAM_COLS = ['Photo', 'Engineer', 'Date', 'Shift', 'On', 'Off', 'Hours', 'Status', 'Station', 'Handover', ''];

  $('#fApply').addEventListener('click', renderTeam);
  $('#fClear').addEventListener('click', function () {
    ['#fFrom', '#fTo', '#fShift', '#fUser', '#fStatus'].forEach(function (s) { $(s).value = ''; });
    renderTeam();
  });

  async function renderTeam() {
    var res = await window.API.call('listAttendance', {
      from: $('#fFrom').value || undefined, to: $('#fTo').value || undefined,
      shiftId: $('#fShift').value || undefined, userId: $('#fUser').value || undefined,
      status: $('#fStatus').value || undefined
    });
    S.teamRows = res.rows;
    $('#teamTable').innerHTML = table(TEAM_COLS, res.rows, function (r) {
      return '<td>' + thumb(r.photoIn, 'Sign-on photo') + '</td>' +
        '<td>' + esc(r.name) + (r.empId ? ' <span class="mono" style="color:var(--dim-2)">' + esc(r.empId) + '</span>' : '') + '</td>' +
        '<td class="num">' + esc(r.date) + '</td><td>' + esc(r.shiftName) + '</td>' +
        '<td class="num">' + esc(hm(r.checkIn)) + '</td>' +
        '<td class="num">' + (r.checkOut ? esc(hm(r.checkOut)) : '—') + '</td>' +
        '<td class="num">' + esc(dur(r.durationMin)) + '</td>' +
        '<td>' + statusPill(r) + '</td><td>' + esc(r.station || '—') + '</td>' +
        '<td>' + esc((r.handover || r.activity || '—').slice(0, 70)) + '</td>' +
        '<td><button class="btn btn-ghost btn-sm" data-detail="' + esc(r.id) + '">Details</button> ' +
        (can('admin') ? '<button class="btn btn-danger btn-sm" data-del="' + esc(r.id) + '">Delete</button>' : '') + '</td>';
    }, 'No shift records match those filters.');

    $$('#teamTable [data-detail]').forEach(function (b) {
      b.addEventListener('click', function () { showRecordDetail(rowById(S.teamRows, b.dataset.detail)); });
    });
    $$('#teamTable [data-del]').forEach(function (b) {
      b.addEventListener('click', async function () {
        if (!confirm('Delete this shift record? The audit trail keeps a note of the deletion.')) return;
        try { await window.API.call('deleteAttendance', { id: b.dataset.del }); toast('Shift record deleted.'); renderTeam(); }
        catch (err) { toast(err.message, 'bad'); }
      });
    });
  }

  /* ================= export ================= */

  $('#exportBtn').addEventListener('click', async function () {
    var btn = this; busy(btn, true, 'Building…');
    try {
      var att = S.teamRows.length ? S.teamRows : (await window.API.call('listAttendance', {})).rows;

      var attSheet = att.map(function (r) {
        return {
          'Record ID': r.id, 'Employee ID': r.empId || '', 'Engineer': r.name,
          'Date': r.date, 'Shift': r.shiftName,
          'Sign on': r.checkIn ? new Date(r.checkIn).toLocaleString() : '',
          'Sign off': r.checkOut ? new Date(r.checkOut).toLocaleString() : '',
          'Scheduled end': r.scheduledEnd ? new Date(r.scheduledEnd).toLocaleString() : '',
          'Hours': r.durationMin ? +(r.durationMin / 60).toFixed(2) : '',
          'Late (min)': r.lateMin || 0, 'Status': r.status,
          'Workstation': r.station || '', 'Alerts triaged': r.alerts, 'Cases raised': r.incidents,
          'Issues resolved': r.resolved || 0,
          'Opening activity': r.activity || '', 'Handover': r.handover || '',
          'Photo on': r.photoIn && r.photoIn.indexOf('http') === 0 ? r.photoIn : (r.photoIn ? 'embedded' : ''),
          'Photo off': r.photoOut && r.photoOut.indexOf('http') === 0 ? r.photoOut : (r.photoOut ? 'embedded' : '')
        };
      });

      var byPerson = {};
      att.forEach(function (r) {
        var p = byPerson[r.name] = byPerson[r.name] || { 'Engineer': r.name, 'Shifts': 0, 'Hours': 0, 'Late': 0, 'Early out': 0, 'Alerts': 0, 'Cases raised': 0, 'Issues resolved': 0 };
        p.Shifts++; p.Hours += (+r.durationMin || 0) / 60;
        if (r.lateMin > 0) p.Late++;
        if (r.status === 'Early out') p['Early out']++;
        p.Alerts += +r.alerts || 0; p['Cases raised'] += +r.incidents || 0; p['Issues resolved'] += +r.resolved || 0;
      });
      var summary = Object.keys(byPerson).map(function (k) {
        var p = byPerson[k]; p.Hours = +p.Hours.toFixed(2);
        p['Punctuality %'] = p.Shifts ? Math.round((p.Shifts - p.Late) / p.Shifts * 100) : 0;
        return p;
      });

      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary.length ? summary : [{}]), 'Summary');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(attSheet.length ? attSheet : [{}]), 'Attendance');
      XLSX.writeFile(wb, 'soc-attendance-' + ymd(new Date()) + '.xlsx');
      toast('Spreadsheet downloaded.');
    } catch (err) { toast(err.message, 'bad'); }
    finally { busy(btn, false); }
  });

  /* ================= roster ================= */

  $$('#rosterTabs .tab').forEach(function (t) {
    t.addEventListener('click', function () {
      $$('#rosterTabs .tab').forEach(function (x) { x.classList.toggle('is-on', x === t); });
      $$('[data-tabpane]').forEach(function (p) { p.hidden = p.dataset.tabpane !== t.dataset.tab; });
    });
  });

  async function renderRoster() { await renderUsers(); renderShifts(); }

  var USER_COLS = ['Name', 'Username', 'Employee ID', 'Role', 'Default shift', 'Status', ''];

  async function renderUsers() {
    var res = await window.API.call('listUsers', {});
    S.users = res.rows;
    fillShiftSelects();
    $('#userTable').innerHTML = table(USER_COLS, res.rows, function (u) {
      var s = shiftById(u.defaultShift);
      return '<td>' + esc(u.name) + '</td><td class="num">' + esc(u.username) + '</td>' +
        '<td class="num">' + esc(u.empId || '—') + '</td>' +
        '<td><span class="pill ' + (u.role === 'admin' ? 'bad' : u.role === 'lead' ? 'info' : 'mute') + '">' + esc(u.role === 'lead' ? 'shift lead' : u.role) + '</span></td>' +
        '<td>' + esc(s ? s.name : '—') + '</td>' +
        '<td>' + (u.status === 'active' ? '<span class="pill ok">Active</span>' : '<span class="pill mute">Disabled</span>') + '</td>' +
        '<td><button class="btn btn-ghost btn-sm" data-edit-u="' + esc(u.id) + '">Edit</button> ' +
        '<button class="btn btn-danger btn-sm" data-del-u="' + esc(u.id) + '">Remove</button></td>';
    }, 'No accounts yet.');

    $$('#userTable [data-edit-u]').forEach(function (b) {
      b.addEventListener('click', function () {
        var u = S.users.filter(function (x) { return x.id === b.dataset.editU; })[0];
        $('#uId').value = u.id; $('#uName').value = u.name; $('#uUser').value = u.username;
        $('#uEmp').value = u.empId || ''; $('#uEmail').value = u.email || '';
        $('#uRole').value = u.role; $('#uShift').value = u.defaultShift || ''; $('#uStatus').value = u.status;
        $('#uPass').value = ''; $('#uPassHint').textContent = 'leave blank to keep current';
        $('#userFormTitle').textContent = 'Edit ' + u.name;
        $('#uSave').textContent = 'Save changes'; $('#uCancel').hidden = false;
        $('#uName').focus();
      });
    });
    $$('#userTable [data-del-u]').forEach(function (b) {
      b.addEventListener('click', async function () {
        if (!confirm('Remove this account? Their past shift records stay in the spreadsheet.')) return;
        try { await window.API.call('deleteUser', { id: b.dataset.delU }); toast('Account removed.'); renderUsers(); }
        catch (err) { toast(err.message, 'bad'); }
      });
    });
  }

  $('#uCancel').addEventListener('click', resetUserForm);
  function resetUserForm() {
    $('#userForm').reset(); $('#uId').value = '';
    $('#userFormTitle').textContent = 'Add engineer';
    $('#uSave').textContent = 'Add engineer'; $('#uCancel').hidden = true;
    $('#uPassHint').textContent = 'required';
    showErr('#uError', '');
  }

  $('#userForm').addEventListener('submit', async function (e) {
    e.preventDefault(); showErr('#uError', '');
    var btn = $('#uSave'); busy(btn, true, 'Saving…');
    try {
      await window.API.call('saveUser', {
        id: $('#uId').value || '', name: $('#uName').value.trim(), username: $('#uUser').value.trim(),
        empId: $('#uEmp').value.trim(), email: $('#uEmail').value.trim(), role: $('#uRole').value,
        defaultShift: $('#uShift').value, status: $('#uStatus').value, password: $('#uPass').value
      });
      toast('Roster updated.');
      resetUserForm(); renderUsers();
    } catch (err) { showErr('#uError', err.message); }
    finally { busy(btn, false); }
  });

  var SHIFT_COLS = ['Shift', 'Window', 'Length', 'Grace', 'Min engineers', ''];

  function renderShifts() {
    $('#shiftTable').innerHTML = table(SHIFT_COLS, S.shifts, function (s) {
      var sp = hmParts(s.start), ep = hmParts(s.end);
      var len = ((ep[0] * 60 + ep[1]) - (sp[0] * 60 + sp[1]) + 1440) % 1440 || 1440;
      return '<td><strong>' + esc(s.name) + '</strong></td>' +
        '<td class="num">' + esc(s.start) + ' – ' + esc(s.end) + (ep[0] * 60 + ep[1] <= sp[0] * 60 + sp[1] ? ' <span class="pill mute">+1d</span>' : '') + '</td>' +
        '<td class="num">' + esc(dur(len)) + '</td><td class="num">' + esc(s.grace) + 'm</td>' +
        '<td class="num">' + esc(s.min) + '</td>' +
        '<td><button class="btn btn-ghost btn-sm" data-edit-s="' + esc(s.id) + '">Edit</button> ' +
        '<button class="btn btn-danger btn-sm" data-del-s="' + esc(s.id) + '">Remove</button></td>';
    }, 'No shifts defined. Add at least one.');

    $$('#shiftTable [data-edit-s]').forEach(function (b) {
      b.addEventListener('click', function () {
        var s = shiftById(b.dataset.editS);
        $('#sId').value = s.id; $('#sName').value = s.name; $('#sStart').value = s.start;
        $('#sEnd').value = s.end; $('#sGrace').value = s.grace; $('#sMin').value = s.min;
        $('#shiftFormTitle').textContent = 'Edit ' + s.name;
        $('#sSave').textContent = 'Save changes'; $('#sCancel').hidden = false;
      });
    });
    $$('#shiftTable [data-del-s]').forEach(function (b) {
      b.addEventListener('click', async function () {
        if (!confirm('Remove this shift from the pattern?')) return;
        try {
          await window.API.call('deleteShift', { id: b.dataset.delS });
          S.shifts = (await window.API.call('listShifts', {})).rows;
          fillShiftSelects(); renderShifts(); toast('Shift removed.');
        } catch (err) { toast(err.message, 'bad'); }
      });
    });
  }

  $('#sCancel').addEventListener('click', function () {
    $('#shiftForm').reset(); $('#sId').value = '';
    $('#shiftFormTitle').textContent = 'Add shift';
    $('#sSave').textContent = 'Add shift'; $('#sCancel').hidden = true;
  });

  $('#shiftForm').addEventListener('submit', async function (e) {
    e.preventDefault(); showErr('#sError', '');
    var btn = $('#sSave'); busy(btn, true, 'Saving…');
    try {
      await window.API.call('saveShift', {
        id: $('#sId').value || '', name: $('#sName').value.trim(), start: $('#sStart').value,
        end: $('#sEnd').value, grace: $('#sGrace').value, min: $('#sMin').value
      });
      S.shifts = (await window.API.call('listShifts', {})).rows;
      $('#sCancel').click();
      fillShiftSelects(); renderShifts(); toast('Shift pattern updated.');
    } catch (err) { showErr('#sError', err.message); }
    finally { busy(btn, false); }
  });

  /* ================= audit ================= */

  async function renderAudit() {
    var res = await window.API.call('listAudit', {});
    $('#auditTable').innerHTML = table(['When', 'Who', 'Action', 'Detail'], res.rows, function (r) {
      return '<td class="num">' + esc(new Date(r.ts).toLocaleString()) + '</td>' +
        '<td class="num">' + esc(r.actor) + '</td><td>' + esc(r.action) + '</td><td>' + esc(r.detail) + '</td>';
    }, 'Nothing logged yet.');
  }

  /* ================= go ================= */
  window.addEventListener('beforeunload', camOff);
  start().catch(function (e) {
    document.body.dataset.view = 'login';
    $('#login').hidden = false;
    showErr('#loginError', e.message);
  });
})();
