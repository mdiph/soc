/* ============================================================
   Shift Desk — API adapter
   ------------------------------------------------------------
   One call signature, two destinations: the Apps Script web app
   when API_URL is set, the in-browser fixture when it is not.
   Requests go out as text/plain on purpose — that keeps the
   browser from sending a CORS preflight, which Apps Script
   cannot answer.
   ============================================================ */

(function () {
  'use strict';

  var CFG = window.SHIFTDESK_CONFIG;
  var TOKEN_KEY = 'shiftdesk.token';
  var memToken = null;

  function getToken() {
    if (memToken) return memToken;
    try { return window.localStorage.getItem(TOKEN_KEY) || null; } catch (e) { return null; }
  }
  function setToken(t) {
    memToken = t;
    try {
      if (t) window.localStorage.setItem(TOKEN_KEY, t);
      else window.localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* memory only */ }
  }

  var isLive = !!(CFG.API_URL && CFG.API_URL.indexOf('http') === 0);

  async function remote(action, payload) {
    var res = await fetch(CFG.API_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, token: getToken(), payload: payload || {} })
    });
    if (!res.ok) throw new Error('The backend returned ' + res.status + '. Check the deployment URL and that access is set to "Anyone".');
    var text = await res.text();
    var data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error('The backend replied with something that is not JSON. The deployment is probably not published to "Anyone".'); }
    if (!data.ok) throw new Error(data.error || 'The request failed.');
    return data.data;
  }

  window.API = {
    mode: isLive ? 'Google Sheets' : 'Demo (in-browser)',
    isLive: isLive,
    getToken: getToken,
    setToken: setToken,

    call: function (action, payload) {
      return isLive ? remote(action, payload) : window.DemoBackend.call(action, payload, getToken());
    },

    login: async function (username, password) {
      var out = await this.call('login', { username: username, password: password });
      setToken(out.token);
      return out.user;
    },

    logout: async function () {
      try { await this.call('logout', {}); } catch (e) { /* token may already be dead */ }
      setToken(null);
    }
  };
})();
