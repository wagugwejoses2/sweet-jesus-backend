(function(){
  'use strict';

  // ============ STATE ============
  // Admin key is held only in memory (a plain JS variable), never written
  // to localStorage/sessionStorage/cookies. Reloading the page requires
  // logging in again — a deliberate tradeoff for not leaving a credential
  // sitting in browser storage. See the login screen's own note to the user.
  var state = {
    apiBase: '',
    adminKey: '',
    stories: [],
    resources: [],
    impactMetrics: []
  };

  // ============ DOM HELPERS ============
  function $(id){ return document.getElementById(id); }
  function escapeHtml(str){
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  // ============ API ============
  function apiCall(method, path, body){
    var opts = {
      method: method,
      headers: {
        'x-admin-key': state.adminKey,
        'Content-Type': 'application/json'
      }
    };
    if(body !== undefined) opts.body = JSON.stringify(body);

    return fetch(state.apiBase + path, opts)
      .then(function(res){
        return res.json().then(function(data){
          return { status: res.status, data: data };
        }).catch(function(){
          // Response wasn't valid JSON at all — surface a clear error
          // rather than letting a cryptic parse failure propagate.
          return { status: res.status, data: { ok: false, errors: ['Server returned an unexpected response (status ' + res.status + ').'] } };
        });
      });
  }

  // ============ LOGIN ============
  function attemptLogin(){
    var apiBase = $('apiBaseInput').value.trim().replace(/\/+$/, ''); // strip trailing slash
    var adminKey = $('adminKeyInput').value.trim();
    var errorEl = $('loginError');
    errorEl.textContent = '';

    if(!apiBase || !/^https?:\/\//i.test(apiBase)){
      errorEl.textContent = 'Enter a valid backend address starting with http:// or https://';
      return;
    }
    if(!adminKey){
      errorEl.textContent = 'Enter your admin key.';
      return;
    }

    var loginBtn = $('loginBtn');
    loginBtn.disabled = true;
    loginBtn.textContent = 'Checking…';

    state.apiBase = apiBase;
    state.adminKey = adminKey;

    // Verify the key actually works before showing the dashboard, using
    // a lightweight real request rather than just trusting the input.
    apiCall('GET', '/admin/stories').then(function(result){
      loginBtn.disabled = false;
      loginBtn.textContent = 'Log in';

      if(result.status === 401){
        errorEl.textContent = 'That admin key was rejected. Check it and try again.';
        state.adminKey = '';
        return;
      }
      if(result.status === 503){
        errorEl.textContent = 'The backend has no ADMIN_API_KEY configured yet — set one in its environment variables.';
        return;
      }
      if(!result.data.ok && result.status !== 500){
        // 500 here likely means Supabase isn't API_KEY configuonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfiguonfigu