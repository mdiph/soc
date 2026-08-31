/* ============================================================
   Shift Timeline — UI
   ------------------------------------------------------------
   One page. The full month timeline is the centrepiece for
   everyone. Pick your name for a "today / tomorrow / next"
   strip on top and your row highlighted. Sign in with the edit
   password to generate / save / fix the schedule.
   The rota maths lives in rota.js; the storage in api.js.
   ============================================================ */

(function () {
  'use strict';

  var R = window.Rota, CFG = window.ROSTER_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var now = new Date();
  var todayStr = ymd(now);
  var tomorrowStr = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  var todayKey = todayStr.slice(0, 7);

  // the month currently shown in the grid
  var state = {
    monthKey: todayKey, engineers: [], allEngineers: [], grid: {}, locks: {}, notes: {},
    opening: {}, tails: {}, savedAt: null, hasPrev: false, openingSet: false, dirty: false
  };
  var editing = false;
  var me = '';                       // picked engineer id (not persisted)
  var personal = {};                 // monthKey -> { engineers, grid } for the lens
  var months = [];
  var validation = { problems: [], perEngineer: {}, hard: 0, soft: 0 };

  /* ================= boot ================= */

  async function boot() {
    $('teamTag').textContent = CFG.TEAM_NAME || 'SOC L1';
    $('minOffTxt').textContent = R.MIN_OFF;
    wireEvents();
    try { months = await window.API.listMonths(); } catch (e) { months = []; }
    await loadMonth(todayKey);
    await renderLens();
    document.body.setAttribute('data-ready', '1');
  }

  async function loadMonth(key) {
    try {
      var d = await window.API.loadMonth(key);
      var conv = window.API.rowsToGrid(d.rows);
      state.monthKey = key;
      state.allEngineers = d.engineers || [];
      state.engineers = (d.engineers || [])
        .filter(function (e) { return e.active !== false || hasCells(conv.grid, e.id); })
        .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      state.grid = conv.grid; state.locks = conv.locks; state.notes = conv.notes;
      state.opening = d.opening || {};
      state.tails = d.tails || {};
      state.savedAt = d.savedAt || null;
      state.hasPrev = !!d.hasPrev;
      state.openingSet = hasOpening(d.opening) || !!(d.rows && d.rows.length);
      state.dirty = false;
      state.engineers.forEach(function (e) {
        if (!state.grid[e.id]) { state.grid[e.id] = {}; state.locks[e.id] = state.locks[e.id] || {}; state.notes[e.id] = state.notes[e.id] || {}; }
      });
      if (d.rows && d.rows.length && months.indexOf(key) < 0) { months.push(key); months.sort(); }
      render();
    } catch (e) {
      toast('Could not load ' + R.monthLabel(key) + ': ' + e.message, 'bad');
    }
  }

  function hasCells(grid, id) { return grid[id] && Object.keys(grid[id]).length > 0; }
  function hasOpening(op) { return op && Object.keys(op).some(function (k) { return op[k] && op[k].shift && op[k].shift !== 'O'; }); }
  function monthHasWork() {
    return state.engineers.some(function (e) {
      return Object.keys(state.grid[e.id] || {}).some(function (d) { return state.grid[e.id][d] !== 'O'; });
    });
  }

  /* ================= render ================= */

  function render() {
    document.body.classList.toggle('editing', editing);
    $('editActions').hidden = !editing;
    $('editPanels').hidden = !editing;
    $('editLegend').hidden = !editing;
    $('authBtn').textContent = editing ? 'Sign out' : 'Sign in';
    $('openingBtn').hidden = !editing || state.hasPrev;

    renderMonthBar();
    validation = R.validate(state.monthKey, state.engineers, state.grid, state.tails);
    renderGrid();
    if (editing) renderPanels();
    renderBanner();

    $('printHead').innerHTML = '<h1>' + esc(CFG.TEAM_NAME || 'SOC L1') + ' — Shift timeline · ' + R.monthLabel(state.monthKey) + '</h1>' +
      '<p>Morning 07:00–15:00 · Afternoon 15:00–23:00 · Night 23:00–07:00 · Off.</p>';
  }

  function renderMonthBar() {
    var opts = months.slice();
    [state.monthKey, todayKey, R.nextMonthKey(todayKey)].forEach(function (k) { if (opts.indexOf(k) < 0) opts.push(k); });
    opts = opts.filter(function (v, i) { return opts.indexOf(v) === i; }).sort();
    $('mSelect').innerHTML = opts.map(function (k) {
      return '<option value="' + k + '"' + (k === state.monthKey ? ' selected' : '') + '>' + R.monthLabel(k) + '</option>';
    }).join('');
    $('monthNote').textContent = state.monthKey === todayKey ? 'this month'
      : (state.monthKey < todayKey ? 'past' : '');
    $('editState').textContent = !editing ? '' : (state.dirty ? 'unsaved changes'
      : (state.savedAt ? 'saved ' + state.savedAt.slice(0, 16).replace('T', ' ') : 'not saved yet'));
  }

  function renderGrid() {
    var days = R.monthDays(state.monthKey);
    var groups = R.weekGroups(state.monthKey);

    // conflict markers only in edit mode (public gets the quiet banner only)
    var mark = {};
    if (editing) {
      validation.problems.forEach(function (p) {
        if (!p.date) return;
        var k = (p.engId || '*') + '|' + p.date;
        if (!mark[k] || p.sev === 'hard') mark[k] = p.sev;
      });
    }

    var html = '<colgroup><col class="c-name" />' +
      days.map(function () { return '<col class="c-day" />'; }).join('') + '</colgroup>';
    html += '<thead>';
    html += '<tr class="wk"><th class="namecol" rowspan="3">Engineer</th>';
    groups.forEach(function (g) { html += '<th class="wk-cell" colspan="' + g.span + '">' + esc(g.label) + '</th>'; });
    html += '</tr><tr class="dnum">';
    days.forEach(function (d) { html += '<th class="' + (R.isWeekend(d) ? 'weekend' : '') + (d === todayStr ? ' todaycol' : '') + '">' + R.jsDate(d).getDate() + '</th>'; });
    html += '</tr><tr class="dow">';
    days.forEach(function (d) { html += '<th class="' + (R.isWeekend(d) ? 'weekend' : '') + (d === todayStr ? ' todaycol' : '') + '">' + R.dowShort(d) + '</th>'; });
    html += '</tr></thead><tbody>';

    state.engineers.forEach(function (eng) {
      var per = validation.perEngineer[eng.id] || { M: 0, A: 0, N: 0, O: 0 };
      var mineCls = eng.id === me ? ' mine' : '';
      var mini = editing
        ? '<span class="mini">M' + per.M + ' · A' + per.A + ' · N' + per.N + ' · ' +
          (per.offShort ? '<span class="flag">Off ' + per.O + '</span>' : '<b>Off ' + per.O + '</b>') + '</span>'
        : '';
      html += '<tr class="engrow' + mineCls + '" data-eng="' + esc(eng.id) + '"><td class="namecol">' + esc(eng.name) + mini + '</td>';
      days.forEach(function (d) {
        var s = R.cell(state.grid, eng.id, d);
        var locked = !!(state.locks[eng.id] && state.locks[eng.id][d]);
        var m = mark[eng.id + '|' + d] || mark['*|' + d];
        var cls = 'cell s-' + s;
        if (R.isWeekend(d)) cls += ' weekendcol';
        if (d === todayStr) cls += ' today';
        if (locked) cls += ' locked';
        if (m === 'hard') cls += ' bad'; else if (m === 'soft') cls += ' soft';
        html += '<td class="' + cls + '" data-eng="' + esc(eng.id) + '" data-date="' + d + '"' +
          ' title="' + esc(eng.name) + ' — ' + R.dowShort(d) + ' ' + R.fmtShort(d) + ': ' + R.SHIFTS[s].name + '">' +
          (editing ? '<span class="celltag">' + s + '</span>' : '') +
          (locked ? '<span class="lock">●</span>' : '') +
          (editing ? '<span class="padhint" data-lock="1" title="' + (locked ? 'Unlock' : 'Lock for the generator') + '">' + (locked ? '🔓' : '🔒') + '</span>' : '') +
          '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody>';

    if (editing) {
      html += '<tfoot>';
      R.WORK.forEach(function (sh) {
        html += '<tr><td class="namecol">' + R.SHIFTS[sh].name + ' on</td>';
        days.forEach(function (d) {
          var n = state.engineers.filter(function (e) { return R.cell(state.grid, e.id, d) === sh; }).length;
          html += '<td class="' + (n === 0 ? 'gap' : '') + '">' + n + '</td>';
        });
        html += '</tr>';
      });
      html += '</tfoot>';
    }

    $('rotaTable').innerHTML = html;
  }

  function renderPanels() {
    var t = '<tr><th>Engineer</th><th>Morn</th><th>Aft</th><th>Night</th><th>Off</th><th>Max run</th><th>Wknd off</th></tr>';
    state.engineers.forEach(function (e) {
      var p = validation.perEngineer[e.id] || {};
      t += '<tr><td>' + esc(e.name) + '</td>' +
        '<td><span class="dot" style="background:var(--morning)"></span>' + (p.M || 0) + '</td>' +
        '<td><span class="dot" style="background:var(--afternoon)"></span>' + (p.A || 0) + '</td>' +
        '<td><span class="dot" style="background:var(--night)"></span>' + (p.N || 0) + '</td>' +
        '<td class="' + (p.offShort ? 'flag' : '') + '">' + (p.O || 0) + (p.offShort ? ' ⚑' : '') + '</td>' +
        '<td class="' + ((p.maxRun || 0) > R.MAX_RUN ? 'flag' : '') + '">' + (p.maxRun || 0) + '</td>' +
        '<td>' + (p.weekendsOff || 0) + '</td></tr>';
    });
    $('tallyTable').innerHTML = t;

    var pc = '';
    if (validation.hard) pc += '<span class="count-pill hard">' + validation.hard + ' hard</span> ';
    if (validation.soft) pc += '<span class="count-pill soft">' + validation.soft + ' warning' + (validation.soft === 1 ? '' : 's') + '</span>';
    if (!validation.hard && !validation.soft) pc = '<span class="count-pill ok">all clear</span>';
    $('probCounts').innerHTML = pc;

    if (!validation.problems.length) {
      $('problemList').innerHTML = '<div class="prob none"><span class="tag">ok</span>Every rule holds. Coverage is complete and everyone has enough rest.</div>';
    } else {
      $('problemList').innerHTML = validation.problems.map(function (p, i) {
        return '<div class="prob ' + p.sev + '" data-pi="' + i + '"><span class="tag">' + (p.sev === 'hard' ? 'hard' : 'warn') + '</span>' + esc(p.msg) + '</div>';
      }).join('');
    }
  }

  function renderBanner() {
    var b = $('conflictBanner');
    if (editing) {
      if (validation.hard) { b.hidden = false; b.className = 'banner'; b.textContent = validation.hard + ' unresolved hard conflict' + (validation.hard === 1 ? '' : 's') + ' — it still saves, but fix these before publishing.'; }
      else if (validation.soft) { b.hidden = false; b.className = 'banner warn'; b.textContent = validation.soft + ' warning' + (validation.soft === 1 ? '' : 's') + ' to review.'; }
      else b.hidden = true;
    } else {
      b.hidden = validation.hard === 0;
      b.className = 'banner';
      b.textContent = R.monthLabel(state.monthKey) + ' has unresolved scheduling conflicts — check with your shift lead.';
    }
  }

  /* ================= personal lens ================= */

  async function ensurePersonal(key) {
    if (personal[key]) return;
    try {
      var d = await window.API.loadMonth(key);
      var conv = window.API.rowsToGrid(d.rows);
      personal[key] = {
        engineers: (d.engineers || []).filter(function (e) { return e.active !== false || hasCells(conv.grid, e.id); })
          .sort(function (a, b) { return (a.order || 0) - (b.order || 0); }),
        grid: conv.grid
      };
    } catch (e) { personal[key] = { engineers: [], grid: {} }; }
  }

  function pLook(engId, dateStr) {
    var p = personal[dateStr.slice(0, 7)];
    if (!p || !p.grid[engId]) return null;
    return p.grid[engId][dateStr] || 'O';
  }

  async function renderLens() {
    await ensurePersonal(todayKey);
    await ensurePersonal(R.nextMonthKey(todayKey));

    var engs = personal[todayKey].engineers;
    var sel = $('mePick'), prev = sel.value || me;
    sel.innerHTML = '<option value="">Pick your name…</option>' +
      engs.map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(e.name) + '</option>'; }).join('');
    if (prev && engs.some(function (e) { return e.id === prev; })) sel.value = prev;
    me = sel.value;

    $('lensHint').hidden = !!me;
    $('lensBody').hidden = !me;
    if (!me) { renderGrid(); return; }

    fillDayCard('cardToday', 'todayDate', 'todayShift', 'todayWindow', todayStr, pLook(me, todayStr));
    fillDayCard('cardTomorrow', 'tmrDate', 'tmrShift', 'tmrWindow', tomorrowStr, pLook(me, tomorrowStr));

    // then: 5 days after tomorrow
    var base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
    var rows = '';
    for (var i = 0; i < 5; i++) {
      var ds = ymd(new Date(base.getFullYear(), base.getMonth(), base.getDate() + i));
      var s = pLook(me, ds);
      rows += '<div class="row"><span class="d">' + R.dowShort(ds) + ' ' + R.fmtShort(ds) + '</span>' +
        (s ? '<span class="p s-' + s + '">' + R.SHIFTS[s].name + '</span><span class="w">' + (R.shiftWindow(s) || '') + '</span>'
           : '<span class="w">not rostered yet</span>') + '</div>';
    }
    $('upNext').innerHTML = rows;

    // today's coverage
    var pg = personal[todayKey];
    var cov = '';
    R.WORK.concat(['O']).forEach(function (sh) {
      var names = pg.engineers.filter(function (e) { return (pg.grid[e.id] && pg.grid[e.id][todayStr] || 'O') === sh; });
      var list = names.length
        ? names.map(function (e) { return e.id === me ? '<span class="you">you</span>' : esc(e.name); }).join(', ')
        : '<em>nobody</em>';
      cov += '<div class="line"><span class="lbl s-' + sh + '">' + R.SHIFTS[sh].name + '</span><span class="who">' + list + '</span></div>';
    });
    $('todayCoverage').innerHTML = cov;

    renderGrid();   // repaint so the "mine" row highlight follows the picker
  }

  function fillDayCard(cardId, dateId, shiftId, winId, dateStr, s) {
    $(dateId).textContent = R.dowShort(dateStr) + ' ' + R.fmtShort(dateStr);
    var card = $(cardId);
    card.className = 'daycard s-' + (s || 'O');
    if (s == null) { $(shiftId).textContent = 'Not rostered'; $(winId).textContent = ''; }
    else if (s === 'O') { $(shiftId).textContent = 'Off'; $(winId).textContent = 'Rest day'; }
    else { $(shiftId).textContent = R.SHIFTS[s].name; $(winId).textContent = R.shiftWindow(s); }
  }

  /* ================= sign in / out ================= */

  function signIn() {
    if (window.API.hasEdit()) { editing = true; render(); return; }   // local mode, or token still valid
    openModal('unlockModal'); $('unlockPass').focus();
  }
  function signOut() {
    if (state.dirty && !confirm('Sign out? Unsaved changes to ' + R.monthLabel(state.monthKey) + ' will be lost.')) return;
    editing = false;
    window.API.lock();
    if (state.dirty) loadMonth(state.monthKey); else render();
  }

  /* ---- pick "me" by clicking a name in the grid ---- */

  function selectMe(id, toggle) {
    me = (toggle && me === id) ? '' : (id || '');
    var sel = $('mePick');
    if (sel) sel.value = me;
    renderLens();
  }

  /* ---- cell editing / row selecting ---- */

  function onCellClick(e) {
    var name = e.target.closest ? e.target.closest('td.namecol') : null;
    if (name) {
      var nrow = name.closest('tr.engrow');
      if (nrow) selectMe(nrow.getAttribute('data-eng'), true);
      return;
    }
    if (!editing) return;
    var td = e.target.closest ? e.target.closest('td.cell') : null;
    if (!td) return;
    if (!window.API.hasEdit()) { signIn(); return; }
    var id = td.getAttribute('data-eng'), d = td.getAttribute('data-date');
    if (e.target.getAttribute && e.target.getAttribute('data-lock')) {
      if (!state.locks[id]) state.locks[id] = {};
      if (state.locks[id][d]) delete state.locks[id][d]; else state.locks[id][d] = true;
    } else {
      R.setCell(state.grid, id, d, R.nextInCycle(R.cell(state.grid, id, d)));
    }
    state.dirty = true;
    validation = R.validate(state.monthKey, state.engineers, state.grid, state.tails);
    renderGrid(); renderPanels(); renderBanner(); renderMonthBar();
  }

  function onProblemClick(e) {
    var row = e.target.closest ? e.target.closest('.prob') : null;
    if (!row || row.getAttribute('data-pi') == null) return;
    var p = validation.problems[+row.getAttribute('data-pi')];
    if (!p || !p.date) return;
    var q = 'td.cell[data-date="' + p.date + '"]' + (p.engId ? '[data-eng="' + p.engId + '"]' : '');
    var cell = document.querySelector(q);
    if (cell) {
      cell.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      cell.style.outline = '3px solid #fff';
      setTimeout(function () { cell.style.outline = ''; }, 900);
    }
  }

  /* ---- generate / save / new month ---- */

  function doGenerate() {
    if (!window.API.hasEdit()) { signIn(); return; }
    if (!state.hasPrev && !state.openingSet) { openOpening(function () { doGenerate(); }); return; }
    if (monthHasWork() && !confirm('Regenerate ' + R.monthLabel(state.monthKey) + '? Locked cells stay; everything else is replaced.')) return;

    var out = R.generate({ monthKey: state.monthKey, engineers: state.engineers, tails: state.tails, locked: lockedValues() });
    state.grid = out.grid;
    state.dirty = true;
    render();
    renderGenNotes(out.notes);
    toast('Generated ' + R.monthLabel(state.monthKey) + '.', out.notes.length ? 'warn' : '');
  }

  function lockedValues() {
    var out = {};
    Object.keys(state.locks).forEach(function (id) {
      Object.keys(state.locks[id]).forEach(function (d) {
        if (!state.locks[id][d]) return;
        if (!out[id]) out[id] = {};
        out[id][d] = R.cell(state.grid, id, d);
      });
    });
    return out;
  }

  function renderGenNotes(notes) {
    if (!editing || !notes || !notes.length) { $('genNotes').innerHTML = ''; return; }
    $('genNotes').innerHTML = '<div class="notes-box"><b>The generator could not fully resolve:</b><ul>' +
      notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul></div>';
  }

  async function doSave() {
    if (!window.API.hasEdit()) { signIn(); return; }
    $('saveBtn').disabled = true;
    try {
      var res = await window.API.saveMonth(state.monthKey, state.grid, state.locks, state.notes, state.opening);
      state.savedAt = (res && res.savedAt) || new Date().toISOString();
      state.dirty = false;
      if (months.indexOf(state.monthKey) < 0) { months.push(state.monthKey); months.sort(); }
      personal = {};                 // lens data is stale now
      render();
      await renderLens();
      toast('Saved ' + R.monthLabel(state.monthKey) + '.');
    } catch (e) {
      toast('Save failed: ' + e.message, 'bad');
    }
    $('saveBtn').disabled = false;
  }

  async function doNewMonth() {
    if (!window.API.hasEdit()) { signIn(); return; }
    if (state.dirty && !confirm('Discard unsaved changes to ' + R.monthLabel(state.monthKey) + '?')) return;
    var next = R.nextMonthKey(months.length ? months[months.length - 1] : state.monthKey);
    await loadMonth(next);
    doGenerate();
  }

  /* ================= opening-state modal ================= */

  var openingThen = null;
  var ORD = ['', '1st', '2nd', '3rd'];
  function openOpening(then) {
    openingThen = then || null;

    var pdays = R.monthDays(R.prevMonthKey(state.monthKey));
    var lastDay = pdays[pdays.length - 1];
    $('openingTitle').textContent = 'Where is everyone on ' + R.dowShort(lastDay) + ' ' + R.fmtShort(lastDay) + '?';

    $('openingList').innerHTML =
      '<p class="op-head">On <b>' + R.dowShort(lastDay) + ' ' + R.fmtShort(lastDay) +
      '</b> — the day before ' + R.monthLabel(state.monthKey) + ' begins — each engineer was:</p>' +
      '<div class="eng-list">' + state.engineers.map(function (e) {
        var op = state.opening[e.id] || {};
        var run = op.run ? Math.max(1, Math.min(3, op.run | 0)) : 1;
        return '<div class="eng-row op-row" data-eng="' + esc(e.id) + '">' +
          '<span class="op-name">' + esc(e.name) + '</span>' +
          '<span class="op-sentence">on ' +
          '<select class="op-shift">' +
          ['O', 'M', 'A', 'N'].map(function (s) {
            return '<option value="' + s + '"' + ((op.shift || 'O') === s ? ' selected' : '') + '>' +
              (s === 'O' ? 'Off' : R.SHIFTS[s].name) + '</option>';
          }).join('') +
          '</select>' +
          '<span class="op-run-wrap"' + ((op.shift && op.shift !== 'O') ? '' : ' hidden') + '>, and it was their ' +
          '<select class="op-run">' +
          [1, 2, 3].map(function (n) { return '<option value="' + n + '"' + (run === n ? ' selected' : '') + '>' + ORD[n] + '</option>'; }).join('') +
          '</select> day in a row</span>' +
          '</span></div>';
      }).join('') + '</div>';

    openModal('openingModal');
  }

  function saveOpening() {
    var op = {};
    Array.prototype.forEach.call($('openingList').querySelectorAll('.op-row'), function (row) {
      var id = row.getAttribute('data-eng');
      var shift = row.querySelector('.op-shift').value;
      var run = +row.querySelector('.op-run').value || 1;
      op[id] = { shift: shift, run: shift === 'O' ? 0 : run };
    });
    state.opening = op;
    state.openingSet = true;
    state.engineers.forEach(function (e) { state.tails[e.id] = R.tailFromOpening(op[e.id]); });
    state.dirty = true;
    closeModal('openingModal');
    render();
    var then = openingThen; openingThen = null;
    if (then) then();
  }

  /* ================= engineers modal ================= */

  var engDraft = [];
  function openEngineers() {
    if (!window.API.hasEdit()) { signIn(); return; }
    engDraft = (state.allEngineers.length ? state.allEngineers : state.engineers).map(function (e, i) {
      return { id: e.id, name: e.name, active: e.active !== false, order: e.order != null ? e.order : i };
    }).sort(function (a, b) { return a.order - b.order; });
    renderEngList();
    openModal('engModal');
  }
  function renderEngList() {
    $('engError').hidden = true;
    $('engList').innerHTML = engDraft.map(function (e, i) {
      return '<div class="eng-row" data-i="' + i + '">' +
        '<span class="ord"><button type="button" data-mv="up">▲</button><button type="button" data-mv="down">▼</button></span>' +
        '<input type="text" class="eng-name" value="' + esc(e.name) + '" placeholder="Name" />' +
        '<label><input type="checkbox" class="eng-active"' + (e.active ? ' checked' : '') + ' /> active</label>' +
        '<button type="button" class="btn btn-danger btn-sm" data-del="' + i + '">Remove</button>' +
        '</div>';
    }).join('');
  }
  function syncEngNames() {
    Array.prototype.forEach.call($('engList').querySelectorAll('.eng-row'), function (row) {
      var i = +row.getAttribute('data-i');
      engDraft[i].name = row.querySelector('.eng-name').value.trim();
      engDraft[i].active = row.querySelector('.eng-active').checked;
    });
  }
  async function saveEngineers() {
    syncEngNames();
    if (engDraft.some(function (e) { return !e.name; })) { showErr('engError', 'Every engineer needs a name.'); return; }
    engDraft.forEach(function (e, i) { e.order = i; });
    try {
      await window.API.saveEngineers(engDraft);
      closeModal('engModal');
      personal = {};
      await loadMonth(state.monthKey);
      await renderLens();
      toast('Engineers saved.');
    } catch (e) { showErr('engError', e.message); }
  }

  /* ================= xlsx export ================= */

  function exportXlsx() {
    var days = R.monthDays(state.monthKey);
    var aoa = [
      [(CFG.TEAM_NAME || 'SOC L1') + ' — Shift timeline — ' + R.monthLabel(state.monthKey)], [],
      ['Engineer'].concat(days.map(function (d) { return R.jsDate(d).getDate(); })),
      [''].concat(days.map(function (d) { return R.dowShort(d); }))
    ];
    state.engineers.forEach(function (e) {
      aoa.push([e.name].concat(days.map(function (d) { return R.SHIFTS[R.cell(state.grid, e.id, d)].name; })));
    });
    aoa.push([]);
    R.WORK.forEach(function (sh) {
      aoa.push([R.SHIFTS[sh].name + ' on'].concat(days.map(function (d) {
        return state.engineers.filter(function (e) { return R.cell(state.grid, e.id, d) === sh; }).length;
      })));
    });
    aoa.push([], ['Totals', 'Morning', 'Afternoon', 'Night', 'Off', 'Max run', 'Weekends off']);
    state.engineers.forEach(function (e) {
      var p = validation.perEngineer[e.id] || {};
      aoa.push([e.name, p.M || 0, p.A || 0, p.N || 0, p.O || 0, p.maxRun || 0, p.weekendsOff || 0]);
    });

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Timeline');
    var rows = [['date', 'weekday', 'engineer', 'shift', 'locked', 'note']];
    days.forEach(function (d) {
      state.engineers.forEach(function (e) {
        var s = R.cell(state.grid, e.id, d);
        rows.push([d, R.dowShort(d), e.name, R.SHIFTS[s].name,
          (state.locks[e.id] && state.locks[e.id][d]) ? 'yes' : '',
          (state.notes[e.id] && state.notes[e.id][d]) || '']);
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Rows');
    XLSX.writeFile(wb, 'soc-shift-timeline-' + state.monthKey + '.xlsx');
  }

  /* ================= modals & toasts ================= */

  function openModal(id) { $(id).hidden = false; }
  function closeModal(id) { $(id).hidden = true; }
  function showErr(id, msg) { var e = $(id); e.textContent = msg; e.hidden = false; }

  function toast(msg, kind) {
    var t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 300); }, 3800);
  }

  function guardDirty() {
    if (!state.dirty) return true;
    return confirm('Discard unsaved changes to ' + R.monthLabel(state.monthKey) + '?');
  }

  /* ================= events ================= */

  function wireEvents() {
    $('authBtn').addEventListener('click', function () { editing ? signOut() : signIn(); });
    $('printBtn').addEventListener('click', function () { window.print(); });

    $('mePick').addEventListener('change', function () { selectMe(this.value, false); });

    $('mPrev').addEventListener('click', function () { if (guardDirty()) loadMonth(R.prevMonthKey(state.monthKey)); });
    $('mNext').addEventListener('click', function () { if (guardDirty()) loadMonth(R.nextMonthKey(state.monthKey)); });
    $('mSelect').addEventListener('change', function () { if (guardDirty()) loadMonth(this.value); else this.value = state.monthKey; });

    $('newMonthBtn').addEventListener('click', doNewMonth);
    $('openingBtn').addEventListener('click', function () { if (window.API.hasEdit()) openOpening(null); else signIn(); });
    $('engBtn').addEventListener('click', openEngineers);
    $('genBtn').addEventListener('click', doGenerate);
    $('xlsxBtn').addEventListener('click', exportXlsx);
    $('saveBtn').addEventListener('click', doSave);

    $('rotaTable').addEventListener('click', onCellClick);
    $('problemList').addEventListener('click', onProblemClick);

    $('unlockForm').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      $('unlockError').hidden = true;
      try {
        await window.API.unlock($('unlockPass').value);
        $('unlockPass').value = '';
        closeModal('unlockModal');
        editing = true;
        render();
      } catch (e) { showErr('unlockError', e.message); }
    });
    $('unlockClose').addEventListener('click', function () { closeModal('unlockModal'); });

    $('engClose').addEventListener('click', function () { closeModal('engModal'); });
    $('engCancel').addEventListener('click', function () { closeModal('engModal'); });
    $('engSave').addEventListener('click', saveEngineers);
    $('engAdd').addEventListener('click', function () {
      syncEngNames();
      engDraft.push({ id: 'e' + Date.now().toString(36), name: '', active: true, order: engDraft.length });
      renderEngList();
    });
    $('engList').addEventListener('click', function (ev) {
      var del = ev.target.getAttribute && ev.target.getAttribute('data-del');
      var mv = ev.target.getAttribute && ev.target.getAttribute('data-mv');
      if (del != null) { syncEngNames(); engDraft.splice(+del, 1); renderEngList(); }
      else if (mv) {
        syncEngNames();
        var i = +ev.target.closest('.eng-row').getAttribute('data-i');
        var j = mv === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= engDraft.length) return;
        var tmp = engDraft[i]; engDraft[i] = engDraft[j]; engDraft[j] = tmp;
        renderEngList();
      }
    });

    $('openingClose').addEventListener('click', function () { closeModal('openingModal'); openingThen = null; });
    $('openingCancel').addEventListener('click', function () { closeModal('openingModal'); openingThen = null; });
    $('openingSave').addEventListener('click', saveOpening);
    $('openingList').addEventListener('change', function (ev) {
      if (!ev.target.classList || !ev.target.classList.contains('op-shift')) return;
      var wrap = ev.target.closest('.op-row').querySelector('.op-run-wrap');
      wrap.hidden = ev.target.value === 'O';
    });

    window.addEventListener('beforeunload', function (e) { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
  }

  boot();
})();
