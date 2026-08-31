/* ============================================================
   Shift Roster — API adapter
   ------------------------------------------------------------
   One set of methods, two destinations:
     * API_URL set    -> the Google Apps Script web app.
                         Reads are public GETs, writes are POSTs
                         carrying an edit token.
     * API_URL empty  -> LOCAL mode. Everything lives in this
                         browser's localStorage and the builder
                         is always unlocked (no password).
   Requests go out as text/plain on purpose so the browser skips
   the CORS preflight, which Apps Script cannot answer.
   ============================================================ */

window.API = (function () {
  'use strict';

  var CFG = window.ROSTER_CONFIG || {};
  var LIVE = !!(CFG.API_URL && CFG.API_URL.indexOf('http') === 0);
  var LS = window.localStorage;

  var K = {
    engineers: 'roster.engineers',
    month: function (key) { return 'roster.month.' + key; },
    token: 'roster.edit'
  };

  /* ---- tiny storage helpers ---------------------------------- */

  function jget(key, dflt) {
    try { var v = LS.getItem(key); return v ? JSON.parse(v) : dflt; }
    catch (e) { return dflt; }
  }
  function jset(key, val) {
    try { LS.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode */ }
  }

  /* ---- edit token ------------------------------------------- */

  function tokenRec() { return jget(K.token, null); }

  function hasEdit() {
    var r = tokenRec();
    return !!(r && r.token && r.exp > Date.now());
  }
  function currentToken() { var r = tokenRec(); return r ? r.token : ''; }

  function storeToken(token) {
    var hours = CFG.EDIT_TOKEN_HOURS || 12;
    jset(K.token, { token: token, exp: Date.now() + hours * 3600 * 1000 });
  }
  function clearToken() { try { LS.removeItem(K.token); } catch (e) {} }

  /* ---- remote plumbing ------------------------------------- */

  async function rget(params) {
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    var res = await fetch(CFG.API_URL + '?' + qs, { method: 'GET', redirect: 'follow' });
    return unwrap(res);
  }
  async function rpost(action, payload) {
    var res = await fetch(CFG.API_URL, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, token: currentToken(), payload: payload || {} })
    });
    return unwrap(res);
  }
  async function unwrap(res) {
    if (!res.ok) throw new Error('The backend returned ' + res.status + '. Check the deployment URL and that access is set to "Anyone".');
    var text = await res.text();
    var data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error('The backend replied with something that is not JSON. The deployment is probably not published to "Anyone".'); }
    if (!data.ok) throw new Error(data.error || 'The request failed.');
    return data.data;
  }

  /* ---- rows <-> objects ------------------------------------ */
  // wire format is long: [{ date, engineerId, shift, locked, note }]

  function gridToRows(monthKey, grid, locks, notes) {
    var days = window.Rota.monthDays(monthKey);
    var rows = [];
    Object.keys(grid).forEach(function (id) {
      days.forEach(function (d) {
        var shift = grid[id][d] || 'O';
        var locked = !!(locks[id] && locks[id][d]);
        var note = (notes[id] && notes[id][d]) || '';
        if (shift === 'O' && !locked && !note) return;   // Off with nothing attached = omit
        rows.push({ date: d, engineerId: id, shift: shift, locked: locked, note: note });
      });
    });
    return rows;
  }

  function rowsToGrid(rows) {
    var grid = {}, locks = {}, notes = {};
    (rows || []).forEach(function (r) {
      if (!grid[r.engineerId]) { grid[r.engineerId] = {}; locks[r.engineerId] = {}; notes[r.engineerId] = {}; }
      grid[r.engineerId][r.date] = r.shift || 'O';
      if (r.locked) locks[r.engineerId][r.date] = true;
      if (r.note) notes[r.engineerId][r.date] = r.note;
    });
    return { grid: grid, locks: locks, notes: notes };
  }

  /* ---- local-mode implementations ------------------------- */

  function localEngineers() {
    var list = jget(K.engineers, null);
    if (!list) {
      list = [
        { id: 'e1', name: 'Engineer 1', active: true, order: 0 },
        { id: 'e2', name: 'Engineer 2', active: true, order: 1 },
        { id: 'e3', name: 'Engineer 3', active: true, order: 2 },
        { id: 'e4', name: 'Engineer 4', active: true, order: 3 }
      ];
      jset(K.engineers, list);
    }
    return list.slice().sort(function (a, b) { return a.order - b.order; });
  }

  function localMonth(key) {
    var rec = jget(K.month(key), null);
    var rows = rec ? rec.rows : [];
    var opening = rec ? rec.opening : {};
    var prevKey = window.Rota.prevMonthKey(key);
    var prevRec = jget(K.month(prevKey), null);
    var tails = computeTails(key, localEngineers(), prevRec ? prevRec.rows : null, opening);
    return {
      monthKey: key,
      engineers: localEngineers(),
      rows: rows,
      opening: opening || {},
      tails: tails,
      savedAt: rec ? rec.savedAt : null,
      hasPrev: !!prevRec
    };
  }

  function localMonthKeys() {
    var keys = [];
    for (var i = 0; i < LS.length; i++) {
      var k = LS.key(i);
      if (k && k.indexOf('roster.month.') === 0) keys.push(k.slice('roster.month.'.length));
    }
    return keys.sort();
  }

  /* ---- carry-in tails ------------------------------------- */
  // if the previous month has saved rows, take each engineer's last 3 shifts
  // from it; otherwise fall back to the one-time opening-state form.
  function computeTails(monthKey, engineers, prevRows, opening) {
    var prevKey = window.Rota.prevMonthKey(monthKey);
    var tails = {};
    if (prevRows && prevRows.length) {
      var prevGrid = rowsToGrid(prevRows).grid;
      engineers.forEach(function (e) {
        tails[e.id] = window.Rota.tailFromGrid(prevGrid, e.id, prevKey, 3);
      });
    } else {
      engineers.forEach(function (e) {
        tails[e.id] = window.Rota.tailFromOpening((opening || {})[e.id]);
      });
    }
    return tails;
  }

  /* ---- public surface ------------------------------------ */

  return {
    mode: LIVE ? 'Google Sheets' : 'Local (this browser)',
    isLive: LIVE,
    hasEdit: hasEdit,
    lock: function () { clearToken(); },

    // unlock editing. Local mode checks CFG.EDIT_PASSWORD; live mode asks the backend.
    unlock: async function (password) {
      if (!LIVE) {
        var want = CFG.EDIT_PASSWORD != null ? String(CFG.EDIT_PASSWORD) : 'admin';
        if (String(password || '') !== want) {
          await new Promise(function (r) { setTimeout(r, 400); });
          throw new Error('That password is not right.');
        }
        storeToken('local-' + Date.now().toString(36));
        return true;
      }
      var out = await rpost('unlock', { password: password || '' });
      storeToken(out.token);
      return true;
    },

    // public read of one month
    loadMonth: async function (key) {
      if (!LIVE) return localMonth(key);
      var out = await rget({ action: 'month', key: key });
      // backend already returns engineers, rows, opening, tails, savedAt
      return out;
    },

    // list month keys that have data (for the picker dropdown)
    listMonths: async function () {
      if (!LIVE) return localMonthKeys();
      var out = await rget({ action: 'months' });
      return out.months || [];
    },

    // save the whole month. payload built from grid/locks/notes + opening.
    saveMonth: async function (key, grid, locks, notes, opening) {
      var rows = gridToRows(key, grid, locks, notes);
      if (!LIVE) {
        jset(K.month(key), { rows: rows, opening: opening || {}, savedAt: new Date().toISOString() });
        return { savedAt: new Date().toISOString() };
      }
      if (!hasEdit()) throw new Error('Edit session expired. Unlock again.');
      return rpost('saveMonth', { key: key, rows: rows, opening: opening || {} });
    },

    saveEngineers: async function (list) {
      var clean = list.map(function (e, i) {
        return { id: e.id, name: e.name, active: e.active !== false, order: e.order != null ? e.order : i };
      });
      if (!LIVE) { jset(K.engineers, clean); return { ok: true }; }
      if (!hasEdit()) throw new Error('Edit session expired. Unlock again.');
      return rpost('saveEngineers', { engineers: clean });
    },

    // helpers the app reuses
    rowsToGrid: rowsToGrid,
    gridToRows: gridToRows
  };
})();
