/* ============================================================
   Shift Roster — rota logic (no DOM, no network)
   ------------------------------------------------------------
   Shift model, calendar helpers, the validation engine and the
   schedule generator. Everything here is pure: give it the grid
   and it tells you what is wrong or hands you a new grid back.
   ============================================================ */

window.Rota = (function () {
  'use strict';

  var CFG = window.ROSTER_CONFIG || {};
  var MIN_OFF = CFG.MIN_OFF_PER_MONTH || 8;
  var MAX_RUN = CFG.MAX_CONSECUTIVE_WORK || 3;

  /* ---- shift model ------------------------------------------------ */

  // order matters: it defines "forward" rotation  Morning -> Afternoon -> Night
  var SHIFTS = {
    M: { key: 'M', name: 'Morning',   short: 'Morn',  tag: 'MORN',  start: '07:00', end: '15:00', order: 0 },
    A: { key: 'A', name: 'Afternoon', short: 'Aft',   tag: 'AFT',   start: '15:00', end: '23:00', order: 1 },
    N: { key: 'N', name: 'Night',     short: 'Night', tag: 'NIGHT', start: '23:00', end: '07:00', order: 2 },
    O: { key: 'O', name: 'Off',       short: 'Off',   tag: 'OFF' }
  };
  var WORK = ['M', 'A', 'N'];
  var CYCLE = ['M', 'A', 'N', 'O'];            // click-to-cycle order
  var ALL = ['M', 'A', 'N', 'O'];

  function isWork(s) { return s === 'M' || s === 'A' || s === 'N'; }
  function shiftName(s) { return (SHIFTS[s] || SHIFTS.O).name; }
  function shiftWindow(s) {
    var d = SHIFTS[s];
    return d && d.start ? d.start + '–' + d.end : '';
  }

  /* ---- calendar helpers ----------------------------------------- */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // month key "YYYY-MM"
  function monthKey(year, month1) { return year + '-' + pad2(month1); }

  function parseMonthKey(key) {
    var p = String(key).split('-');
    return { year: +p[0], month1: +p[1] };
  }

  function daysInMonth(year, month1) { return new Date(year, month1, 0).getDate(); }

  // ordered list of "YYYY-MM-DD" for a month
  function monthDays(key) {
    var m = parseMonthKey(key), out = [];
    var n = daysInMonth(m.year, m.month1);
    for (var d = 1; d <= n; d++) out.push(monthKey(m.year, m.month1) + '-' + pad2(d));
    return out;
  }

  function prevMonthKey(key) {
    var m = parseMonthKey(key);
    return m.month1 === 1 ? monthKey(m.year - 1, 12) : monthKey(m.year, m.month1 - 1);
  }
  function nextMonthKey(key) {
    var m = parseMonthKey(key);
    return m.month1 === 12 ? monthKey(m.year + 1, 1) : monthKey(m.year, m.month1 + 1);
  }

  function dateParts(dateStr) {
    var p = dateStr.split('-');
    return { y: +p[0], m: +p[1], d: +p[2] };
  }
  function jsDate(dateStr) { var p = dateParts(dateStr); return new Date(p.y, p.m - 1, p.d); }

  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function dow(dateStr) { return jsDate(dateStr).getDay(); }
  function isWeekend(dateStr) { var w = dow(dateStr); return w === 0 || w === 6; }
  function dowShort(dateStr) { return DOW[dow(dateStr)]; }
  function fmtShort(dateStr) { var p = dateParts(dateStr); return MON[p.m - 1] + ' ' + p.d; }
  function monthLabel(key) { var m = parseMonthKey(key); return MON[m.month1 - 1] + ' ' + m.year; }

  // week groups for the header band, mirroring the manual sheet:
  // Week 1 = days 1-7, Week 2 = 8-14, ...
  function weekGroups(key) {
    var days = monthDays(key), groups = [];
    for (var i = 0; i < days.length; i += 7) {
      var slice = days.slice(i, i + 7);
      var a = dateParts(slice[0]).d, b = dateParts(slice[slice.length - 1]).d;
      groups.push({ label: 'Week ' + (groups.length + 1) + ' (' + a + '–' + b + ')', days: slice, span: slice.length });
    }
    return groups;
  }

  /* ---- grid helpers -------------------------------------------- */

  // grid: { engineerId: { "YYYY-MM-DD": "M"|"A"|"N"|"O" } }
  function cell(grid, engId, dateStr) {
    return (grid[engId] && grid[engId][dateStr]) || 'O';
  }
  function setCell(grid, engId, dateStr, val) {
    if (!grid[engId]) grid[engId] = {};
    grid[engId][dateStr] = val;
  }
  function cloneGrid(grid) {
    var out = {};
    Object.keys(grid).forEach(function (k) { out[k] = {}; Object.keys(grid[k]).forEach(function (d) { out[k][d] = grid[k][d]; }); });
    return out;
  }

  // the last up-to-3 shifts an engineer worked, oldest -> newest, drawn from
  // the previous month's grid. Used so the rest rules hold across the boundary.
  function tailFromGrid(prevGrid, engId, prevKey, n) {
    n = n || 3;
    var days = monthDays(prevKey);
    var tail = [];
    for (var i = Math.max(0, days.length - n); i < days.length; i++) {
      tail.push(cell(prevGrid, engId, days[i]));
    }
    return tail;
  }

  // synthesise a tail from the one-time opening-state form:
  // { shift: "N", run: 2 }  ->  ["O","N","N"]  (2 nights in a row so far)
  function tailFromOpening(op) {
    if (!op || !op.shift || op.shift === 'O' || !op.run) return ['O', 'O', 'O'];
    var run = Math.max(1, Math.min(3, op.run | 0));
    var t = [];
    while (t.length < 3 - run) t.push('O');
    while (t.length < 3) t.push(op.shift);
    return t;
  }

  /* ---- validation --------------------------------------------- */

  // returns { problems:[...], perEngineer:{id:{M,A,N,O,maxRun,weekendsOff,offShort}}, hard:n, soft:n }
  function validate(monthKeyStr, engineers, grid, tails) {
    tails = tails || {};
    var days = monthDays(monthKeyStr);
    var problems = [];
    var per = {};

    engineers.forEach(function (eng) {
      var tail = (tails[eng.id] || []).slice(-3);
      var offset = tail.length;
      var seq = tail.slice();
      days.forEach(function (d) { seq.push(cell(grid, eng.id, d)); });

      var counts = { M: 0, A: 0, N: 0, O: 0 };
      var run = 0, maxRun = 0, weekendsOff = 0;

      // seed the run counter from the carry-in tail
      for (var t = 0; t < tail.length; t++) { run = isWork(tail[t]) ? run + 1 : 0; }

      for (var i = offset; i < seq.length; i++) {
        var s = seq[i];
        var prev = seq[i - 1];
        var date = days[i - offset];

        counts[s] = (counts[s] || 0) + 1;
        if (s === 'O' && isWeekend(date)) weekendsOff++;

        if (isWork(s)) {
          run++;
          if (run > maxRun) maxRun = run;
          if (run > MAX_RUN) {
            problems.push({
              sev: 'hard', kind: 'streak', engId: eng.id, date: date,
              msg: eng.name + ' works a ' + ordinal(run) + ' day running on ' + fmtShort(date) + ' — needs an Off by day ' + (MAX_RUN + 1)
            });
          }
        } else {
          run = 0;
        }

        if (prev && isWork(prev) && isWork(s)) {
          if (prev === 'N' && s === 'M') {
            problems.push({
              sev: 'hard', kind: 'rest', engId: eng.id, date: date,
              msg: eng.name + ': Night into Morning on ' + fmtShort(date) + ' — no rest gap'
            });
          } else if (SHIFTS[s].order < SHIFTS[prev].order) {
            problems.push({
              sev: 'soft', kind: 'backward', engId: eng.id, date: date,
              msg: eng.name + ' rotates backward (' + shiftName(prev) + ' → ' + shiftName(s) + ') on ' + fmtShort(date)
            });
          }
        }
      }

      var offShort = counts.O < MIN_OFF;
      if (offShort) {
        problems.push({
          sev: 'soft', kind: 'quota', engId: eng.id, date: null,
          msg: eng.name + ' has ' + counts.O + ' Off day' + (counts.O === 1 ? '' : 's') + ' this month — minimum is ' + MIN_OFF
        });
      }

      per[eng.id] = { M: counts.M, A: counts.A, N: counts.N, O: counts.O, maxRun: maxRun, weekendsOff: weekendsOff, offShort: offShort };
    });

    // coverage: at least one engineer on each work shift, every day
    days.forEach(function (d) {
      WORK.forEach(function (sh) {
        var n = 0;
        engineers.forEach(function (e) { if (cell(grid, e.id, d) === sh) n++; });
        if (n === 0) {
          problems.push({
            sev: 'soft', kind: 'coverage', engId: null, date: d,
            msg: 'No one on ' + shiftName(sh) + ' — ' + fmtShort(d)
          });
        }
      });
    });

    var hard = 0, soft = 0;
    problems.forEach(function (p) { if (p.sev === 'hard') hard++; else soft++; });

    // stable-ish ordering: hard first, then by date
    problems.sort(function (a, b) {
      if (a.sev !== b.sev) return a.sev === 'hard' ? -1 : 1;
      return String(a.date || '') < String(b.date || '') ? -1 : 1;
    });

    return { problems: problems, perEngineer: per, hard: hard, soft: soft };
  }

  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  /* ---- generator --------------------------------------------- */

  // The canonical 4-team rotation. One 12-day super-cycle: three work days
  // on a shift, one Off, then the next shift forward. Four teams offset by
  // three days each cover Morning / Afternoon / Night with one resting,
  // every day, and nobody ever rotates backward or goes Night -> Morning.
  var BASE = ['M', 'M', 'M', 'O', 'A', 'A', 'A', 'O', 'N', 'N', 'N', 'O'];

  function baseAt(pos) { return BASE[((pos % 12) + 12) % 12]; }

  // One global phase for the whole team, so engineers keep their stagger
  // (team k always sits 3 days behind team k-1). We slide the 12-day cycle
  // to the offset that best continues everyone's carry-in tail at once.
  // Engineer order in the list = team order in the rotation.
  function bestGlobalOffset(engineers, tails) {
    var meaningful = engineers.some(function (e) {
      var t = tails[e.id];
      return t && t.some(function (s) { return s !== 'O'; });
    });
    if (!meaningful) return 0;                    // fresh start -> canonical layout
    var n = Math.max(4, engineers.length);
    var best = 0, bestScore = -1;
    for (var off = 0; off < 12; off++) {
      var score = 0;
      engineers.forEach(function (e, idx) {
        var t = tails[e.id] || [];
        var basePos = (Math.round(idx * 12 / n) + off) % 12;
        for (var j = 0; j < t.length; j++) {
          // t[last] is the day before day 0  ->  baseAt(basePos - 1)
          if (baseAt(basePos - (t.length - j)) === t[j]) score++;
        }
      });
      if (score > bestScore) { bestScore = score; best = off; }
    }
    return best;
  }

  /*
    generate(opts) -> { grid, notes:[] }
      opts.monthKey    "YYYY-MM"
      opts.engineers   [{id,name}]           (order = team offset)
      opts.tails       { id: ["M","M","O"] } carry-in, optional
      opts.locked      { id: { date: "M" } } cells to keep fixed, optional
  */
  function generate(opts) {
    var days = monthDays(opts.monthKey);
    var engineers = opts.engineers || [];
    var tails = opts.tails || {};
    var locked = opts.locked || {};
    var grid = {};
    var notes = [];

    // 1. stamp the template for every engineer. Four engineers land exactly
    //    3 days apart (one per shift, one resting). More than four are spread
    //    evenly around the 12-day cycle; the doubled days get thinned in
    //    step 3 so the extra rest is shared out.
    var n = engineers.length;
    var offset = bestGlobalOffset(engineers, tails);
    engineers.forEach(function (eng, idx) {
      var startPos = ((Math.round(idx * 12 / Math.max(4, n)) + offset) % 12 + 12) % 12;
      grid[eng.id] = {};
      days.forEach(function (d, di) {
        grid[eng.id][d] = baseAt(startPos + di);
      });
    });

    // 2. force locked cells in
    Object.keys(locked).forEach(function (id) {
      if (!grid[id]) grid[id] = {};
      Object.keys(locked[id]).forEach(function (d) { grid[id][d] = locked[id][d]; });
    });

    var isLocked = function (id, d) { return !!(locked[id] && locked[id][d]); };

    // 3. thin out doubled shifts (only bites with >4 engineers): if a work
    //    shift has 2+ people and every shift is already covered, send the
    //    "extra" to Off. Rotate which engineer yields, day by day, so the
    //    surplus rest is spread evenly.
    if (engineers.length > 4) {
      var offCount = {};
      engineers.forEach(function (e) { offCount[e.id] = countOff(grid, e.id, days); });
      days.forEach(function (d) {
        WORK.forEach(function (sh) {
          var on = engineers.filter(function (e) { return grid[e.id][d] === sh && !isLocked(e.id, d); });
          while (on.length > 1 && everyShiftCovered(grid, engineers, d)) {
            // rest goes to whoever has had the least so far -> evens out
            on.sort(function (a, b) { return offCount[a.id] - offCount[b.id]; });
            var victim = on.shift();
            grid[victim.id][d] = 'O';
            offCount[victim.id]++;
          }
        });
      });
    }

    // 4. repair coverage broken by locks: for each uncovered work shift find
    //    a donor who is Off (or doubled) that day and can take it without a
    //    hard conflict. Whatever can't be fixed is left for the panel.
    days.forEach(function (d) {
      WORK.forEach(function (sh) {
        if (coverOn(grid, engineers, d, sh) > 0) return;
        var donor = pickDonor(grid, engineers, d, sh, isLocked, tails, days);
        if (donor) grid[donor][d] = sh;
        else notes.push('Could not staff ' + shiftName(sh) + ' on ' + fmtShort(d) + ' — not enough people free.');
      });
    });

    // 5. top up Off days to the monthly minimum. Convert a work day whose
    //    shift is over-covered, preferring days that keep 3-on-1-off intact.
    engineers.forEach(function (eng) {
      var need = MIN_OFF - countOff(grid, eng.id, days);
      if (need <= 0) return;
      var moved = 0;
      // candidate work days where this engineer's shift has a spare body
      var cand = days.filter(function (d) {
        if (grid[eng.id][d] === 'O' || isLocked(eng.id, d)) return false;
        return coverOn(grid, engineers, d, grid[eng.id][d]) > 1;
      });
      // space them out: take every Nth
      var step = Math.max(1, Math.floor(cand.length / need));
      for (var i = 0; i < cand.length && moved < need; i += step) {
        grid[eng.id][cand[i]] = 'O';
        moved++;
      }
      if (moved < need) {
        var missing = need - moved;
        notes.push(eng.name + ' is ' + missing + ' Off day' + (missing === 1 ? '' : 's') + ' short of ' + MIN_OFF +
          (engineers.length <= 4
            ? ' — with only ' + engineers.length + ' engineers every shift needs all of them, so an 8th Off means a coverage gap that day. Add a 5th engineer or accept the gap.'
            : ' — no day where their shift has a spare body.'));
      }
    });

    return { grid: grid, notes: notes };
  }

  function coverOn(grid, engineers, d, sh) {
    var n = 0;
    engineers.forEach(function (e) { if (cell(grid, e.id, d) === sh) n++; });
    return n;
  }
  function everyShiftCovered(grid, engineers, d) {
    return WORK.every(function (sh) { return coverOn(grid, engineers, d, sh) > 0; });
  }
  function countOff(grid, id, days) {
    var n = 0;
    days.forEach(function (d) { if (cell(grid, id, d) === 'O') n++; });
    return n;
  }

  // an engineer who can move onto shift `sh` on day `d` without creating a
  // hard conflict (Night->Morning, or a 4th day running).
  function pickDonor(grid, engineers, d, sh, isLocked, tails, days) {
    var di = days.indexOf(d);
    var free = [], doubled = [];
    engineers.forEach(function (e) {
      if (isLocked(e.id, d)) return;
      var cur = grid[e.id][d];
      if (cur === 'O') free.push(e);
      else if (coverOn(grid, engineers, d, cur) > 1) doubled.push(e);
    });
    var pool = free.concat(doubled);
    for (var i = 0; i < pool.length; i++) {
      var e = pool[i];
      var before = di > 0 ? grid[e.id][days[di - 1]] : lastOfTail(tails[e.id]);
      var after = di < days.length - 1 ? grid[e.id][days[di + 1]] : null;
      if (before === 'N' && sh === 'M') continue;
      if (after === 'M' && sh === 'N') continue;
      if (wouldOverrun(grid, e.id, days, di, tails)) continue;
      return e.id;
    }
    return null;
  }
  function lastOfTail(tail) { return tail && tail.length ? tail[tail.length - 1] : null; }

  function wouldOverrun(grid, id, days, di, tails) {
    // count consecutive work days if day di became work
    var run = 1;
    for (var i = di - 1; i >= 0; i--) { if (isWork(grid[id][days[i]])) run++; else break; }
    if (di - (run - 1) <= 0) {
      var tail = (tails && tails[id]) || [];
      for (var t = tail.length - 1; t >= 0; t--) { if (isWork(tail[t])) run++; else break; }
    }
    for (var j = di + 1; j < days.length; j++) { if (isWork(grid[id][days[j]])) run++; else break; }
    return run > MAX_RUN;
  }

  /* ---- export ------------------------------------------------- */

  return {
    SHIFTS: SHIFTS, WORK: WORK, CYCLE: CYCLE, ALL: ALL,
    isWork: isWork, shiftName: shiftName, shiftWindow: shiftWindow,
    MIN_OFF: MIN_OFF, MAX_RUN: MAX_RUN,

    monthKey: monthKey, parseMonthKey: parseMonthKey, monthDays: monthDays,
    daysInMonth: daysInMonth, prevMonthKey: prevMonthKey, nextMonthKey: nextMonthKey,
    monthLabel: monthLabel, weekGroups: weekGroups,
    dow: dow, dowShort: dowShort, isWeekend: isWeekend, fmtShort: fmtShort, jsDate: jsDate,

    cell: cell, setCell: setCell, cloneGrid: cloneGrid,
    tailFromGrid: tailFromGrid, tailFromOpening: tailFromOpening,

    validate: validate,
    generate: generate,
    nextInCycle: function (s) {
      var i = CYCLE.indexOf(s);
      return CYCLE[(i + 1) % CYCLE.length];
    }
  };
})();
