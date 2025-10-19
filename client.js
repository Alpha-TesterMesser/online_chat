// client.js (single consolidated file)
// Replace BACKEND_URL with your backend endpoint:
const BACKEND_URL = 'https://chat-backend-1-4k6l.onrender.com';

let socket = null;
const $ = (sel) => document.querySelector(sel);
const createEl = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
const escapeHtml = (s='') => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// ---------- Logging ----------
const Log = {
  info: (msg, ...rest) => console.log(`%c[INFO] %c${msg}`, 'color:#0af;font-weight:bold', 'color:inherit', ...rest),
  success: (msg, ...rest) => console.log(`%c[SUCCESS] %c${msg}`, 'color:#0a0;font-weight:bold', 'color:inherit', ...rest),
  warn: (msg, ...rest) => console.warn(`%c[WARN] %c${msg}`, 'color:#fa0;font-weight:bold', 'color:inherit', ...rest),
  error: (msg, ...rest) => console.error(`%c[ERROR] %c${msg}`, 'color:#f55;font-weight:bold', 'color:inherit', ...rest),
  group: (name) => console.group(`%c[GROUP] %c${name}`, 'color:#888;font-weight:bold', 'color:inherit'),
  groupEnd: () => console.groupEnd(),
};

// ---------- THEME ----------
(function themeInit(){
  try {
    const saved = localStorage.getItem('theme');
    const systemPrefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    const defaultTheme = saved || (systemPrefersLight ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', defaultTheme);

    function updateToggleBtn(theme) {
      const b = document.getElementById('themeToggle');
      if (!b) return;
      if (theme === 'dark') { b.textContent = '☀️ Light'; b.setAttribute('aria-pressed','true'); }
      else { b.textContent = '🌙 Dark'; b.setAttribute('aria-pressed','false'); }
    }

    document.addEventListener('DOMContentLoaded', () => {
      const btn = document.getElementById('themeToggle');
      updateToggleBtn(defaultTheme);
      if (!btn) return;
      btn.addEventListener('click', () => {
        const cur = document.documentElement.getAttribute('data-theme') || 'dark';
        const next = cur === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('theme', next); } catch(e){}
        updateToggleBtn(next);
        Log.info('Theme toggled to ' + next);
      });
    });
  } catch (e) { Log.warn('themeInit error', e); }
})();

// ---------- Delegated handlers (robust) ----------
(function delegatedHandlers() {
  // Toggle create panel (delegated) — uses data-open + inline style for deterministic behavior
  function toggleCreatePanel() {
    const panel = document.getElementById('createPanel');
    if (!panel) { Log.warn('toggleCreate clicked but createPanel not found'); return; }
    const isOpen = panel.getAttribute('data-open') === 'true';
    if (isOpen) {
      panel.setAttribute('data-open','false'); panel.style.display='none'; panel.classList.add('hidden');
      Log.info('Create panel closed (delegated)');
    } else {
      panel.setAttribute('data-open','true'); panel.style.display='block'; panel.classList.remove('hidden');
      Log.info('Create panel opened (delegated)');
      const name = document.getElementById('sv_name'); setTimeout(()=> { try { name && name.focus(); } catch(e){} }, 40);
    }
  }

  // Delegated click listener: toggle button and join-by-data attributes
  document.addEventListener('click', (ev) => {
    try {
      const t = ev.target;
      if (!t) return;

      // ToggleCreate (matches element or closest)
      const toggleButton = t.id === 'toggleCreate' ? t : (t.closest ? t.closest('#toggleCreate') : null);
      if (toggleButton) {
        ev.preventDefault && ev.preventDefault();
        // ensure button type is button so it doesn't submit forms
        try { toggleButton.type = 'button'; } catch(e) {}
        toggleCreatePanel();
        return;
      }

      // Join server buttons (data-server-id attribute)
      const joinBtn = (t.dataset && t.dataset.serverId) ? t : (t.closest ? t.closest('[data-server-id]') : null);
      if (joinBtn && joinBtn.dataset.serverId) {
        ev.preventDefault && ev.preventDefault();
        const sid = joinBtn.dataset.serverId;
        // find server object in state later (we'll emit event)
        const evt = new CustomEvent('client-join-server', { detail: { serverId: sid } });
        document.dispatchEvent(evt);
        return;
      }
    } catch (err) {
      Log.error('delegated click handler error', err);
    }
  }, true);

  // MutationObserver to ensure createPanel has deterministic initial state
  const mo = new MutationObserver(() => {
    const p = document.getElementById('createPanel');
    if (!p) return;
    if (!p.hasAttribute('data-open')) p.setAttribute('data-open','false');
    if (!p.style.display) p.style.display = p.classList.contains('hidden') ? 'none' : (p.style.display || 'none');
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();

// ---------- ClientApp ----------
const ClientApp = (function () {
  let state = { user: null, servers: [], pendingJoin: null };

  // Fetch servers from backend (REST)
  async function fetchServers() {
    Log.group('Fetch Servers');
    try {
      Log.info(`GET ${BACKEND_URL}/servers`);
      const res = await fetch(`${BACKEND_URL}/servers`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      state.servers = Array.isArray(json) ? json : [];
      Log.success(`Fetched ${state.servers.length} servers`);
      renderServers();
    } catch (e) {
      Log.error('fetchServers error', e);
      const list = $('#list'); if (list) list.innerHTML = '<div class="muted">Unable to load servers.</div>';
    } finally {
      Log.groupEnd();
    }
  }

  // Render server cards
  function renderServers() {
    const container = $('#list'); if (!container) return;
    const q = ($('#search') && $('#search').value.trim().toLowerCase()) || '';
    const tagq = ($('#tagFilter') && $('#tagFilter').value.trim().toLowerCase()) || '';
    const showPublic = $('#filterPublic') ? $('#filterPublic').checked : true;
    const showPrivate = $('#filterPrivate') ? $('#filterPrivate').checked : true;
    const onlyWithSpace = $('#filterHasSpace') ? $('#filterHasSpace').checked : false;
    const sortBy = $('#sortBy') ? $('#sortBy').value : 'created';

    let list = state.servers.slice();
    list = list.filter(s => {
      if (!showPublic && !s.hasPassword) return false;
      if (!showPrivate && s.hasPassword) return false;
      if (onlyWithSpace && s.occupancy >= s.max) return false;
      if (q) {
        const nameMatch = (s.name || '').toLowerCase().includes(q);
        const tagsMatch = (s.tags || []).join(' ').toLowerCase().includes(q);
        if (!nameMatch && !tagsMatch) return false;
      }
      if (tagq) {
        const tags = (s.tags || []).map(t=>t.toLowerCase());
        if (!tags.includes(tagq)) return false;
      }
      return true;
    });

    if (sortBy === 'name') list.sort((a,b)=> (a.name||'').localeCompare(b.name||''));
    else if (sortBy === 'availability') list.sort((a,b)=> ((b.max - b.occupancy) - (a.max - a.occupancy)));
    else list.sort((a,b)=> (b.createdAt||0) - (a.createdAt||0));

    container.innerHTML = '';
    if (list.length === 0) { container.innerHTML = '<div class="muted">No servers found.</div>'; return; }

    list.forEach(s => {
      const card = createEl('div','serverCard');
      const info = createEl('div','serverInfo');
      const ageMin = s.createdAt ? Math.floor((Date.now() - s.createdAt)/60000) : '?';
      info.innerHTML = `<strong>${escapeHtml(s.name)}</strong> • ${escapeHtml(s.creator || '')}<br/>
        <span class="meta">Tags: ${escapeHtml((s.tags||[]).join(', '))} • ${s.hasPassword ? '🔒 Private' : '🌐 Public'} • ${s.occupancy || 0}/${s.max || 0} • Created: ${s.createdAt ? new Date(s.createdAt).toLocaleString() : 'N/A'} (${ageMin} min ago)</span>`;
      const actions = createEl('div','serverActions');

      const joinBtn = createEl('button');
      joinBtn.type = 'button';
      joinBtn.textContent = 'Join';
      // use data attribute so delegated handler can pick it up
      joinBtn.dataset.serverId = s.id;
      joinBtn.classList.add('joinServerBtn');

      actions.appendChild(joinBtn);
      card.appendChild(info);
      card.appendChild(actions);
      container.appendChild(card);
    });
  }

  // Join flow: either immediate or show password modal
  function onJoinRequest(serverId) {
    const srv = state.servers.find(s => s.id === serverId);
    if (!srv) { alert('Server not found'); return; }
    if (!srv.hasPassword) return attemptJoin(serverId, '');
    // show modal
    state.pendingJoin = srv;
    const modal = $('#pwdModal'); if (!modal) { alert('Password required but modal missing'); return; }
    $('#pwdInput') && ($('#pwdInput').value = '');
    $('#pwdMsg') && ($('#pwdMsg').textContent = '');
    // ensure visible
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    setTimeout(()=>{ try { $('#pwdInput') && $('#pwdInput').focus(); } catch(e){} }, 40);
  }

  // Attempt join POST -> if ok navigate to chat
  async function attemptJoin(serverId, password) {
    Log.group(`Attempt join ${serverId}`);
    try {
      const user = localStorage.getItem('username');
      if (!user) { alert('Username missing — return to entry'); window.location = './index.html'; return; }
      Log.info(`Joining ${serverId} as ${user}`);
      const res = await fetch(`${BACKEND_URL}/join`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ serverId, username: user, password })
      });
      let body;
      try { body = await res.json(); } catch(e) { body = {}; }
      if (!res.ok) {
        const err = body.error || body.message || 'Unable to join';
        Log.warn('join failed: ' + err);
        const pwdMsg = $('#pwdMsg');
        if (pwdMsg && !$('#pwdModal').classList.contains('hidden')) pwdMsg.textContent = `Error: ${err}`;
        else alert(`Error: ${err}`);
        return;
      }
      Log.success('Join successful, navigating to chat');
      window.location = `./chat.html?server=${encodeURIComponent(serverId)}`;
    } catch (e) {
      Log.error('attemptJoin error', e);
      alert('Network error while joining');
    } finally {
      Log.groupEnd();
      state.pendingJoin = null;
      const modal = $('#pwdModal'); if (modal) { modal.classList.add('hidden'); modal.style.display='none'; }
    }
  }

  // Create server POST
  async function createServer() {
    const nameEl = $('#sv_name'), tagsEl = $('#sv_tags'), maxEl = $('#sv_max'), passEl = $('#sv_pass');
    const name = nameEl ? nameEl.value.trim() : '';
    const tags = tagsEl ? tagsEl.value.trim() : '';
    const max = maxEl ? Math.max(1, Number(maxEl.value) || 8) : 8;
    const password = passEl ? passEl.value : '';
    if (!name) { $('#createMsg') && ($('#createMsg').textContent = 'Name required'); return; }
    Log.group('Create Server');
    try {
      Log.info(`Creating server "${name}"`);
      const payload = { name, creator: state.user || 'unknown', tags, max, password };
      const res = await fetch(`${BACKEND_URL}/servers`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      let body;
      try { body = await res.json(); } catch(e) { body = {}; }
      if (!res.ok) {
        Log.warn('create failed', body);
        $('#createMsg') && ($('#createMsg').textContent = body.error || 'Create failed');
        return;
      }
      Log.success('Server created');
      $('#createMsg') && ($('#createMsg').textContent = 'Server created');
      const panel = $('#createPanel');
      if (panel) { panel.style.display='none'; panel.classList.add('hidden'); panel.setAttribute('data-open','false'); }
      await fetchServers();
    } catch (e) {
      Log.error('createServer error', e);
      $('#createMsg') && ($('#createMsg').textContent = 'Network error');
    } finally { Log.groupEnd(); }
  }

  // Wire pwd modal buttons (direct)
  function wirePwdModal() {
    const submit = $('#pwdSubmit'), back = $('#pwdBack');
    if (submit) {
      submit.addEventListener('click', (e) => {
        if (e && e.isTrusted === false) return;
        const pwd = $('#pwdInput') ? $('#pwdInput').value : '';
        const modal = $('#pwdModal'); if (modal) { modal.classList.add('hidden'); modal.style.display='none'; }
        if (!state.pendingJoin) return;
        attemptJoin(state.pendingJoin.id, pwd);
        state.pendingJoin = null;
      });
    }
    if (back) {
      back.addEventListener('click', () => {
        const modal = $('#pwdModal'); if (modal) { modal.classList.add('hidden'); modal.style.display='none'; }
        state.pendingJoin = null;
      });
    }
  }

  // Hook events and initialize
  async function initServers(opts = {}) {
    state.user = localStorage.getItem('username');
    if (!state.user) Log.warn('initServers: username missing');

    // wire filters + controls (defensive)
    $('#search') && $('#search').addEventListener('input', renderServers);
    $('#tagFilter') && $('#tagFilter').addEventListener('input', renderServers);
    $('#sortBy') && $('#sortBy').addEventListener('change', renderServers);
    $('#filterPublic') && $('#filterPublic').addEventListener('change', renderServers);
    $('#filterPrivate') && $('#filterPrivate').addEventListener('change', renderServers);
    $('#filterHasSpace') && $('#filterHasSpace').addEventListener('change', renderServers);

    // ensure create-panel initial state deterministic
    const panel = $('#createPanel');
    if (panel) {
      if (!panel.hasAttribute('data-open')) panel.setAttribute('data-open','false');
      panel.style.display = panel.classList.contains('hidden') ? 'none' : (panel.style.display || 'none');
      panel.classList.add('hidden');
    }

    // direct bindings (safe to have both direct + delegated)
    const toggleBtn = $('#toggleCreate');
    if (toggleBtn) {
      try { toggleBtn.type = 'button'; } catch(e){}
      toggleBtn.addEventListener('click', (e) => {
        e.preventDefault && e.preventDefault();
        const p = $('#createPanel');
        if (!p) { Log.warn('toggleCreate direct: panel missing'); return; }
        const nowOpen = p.style.display === 'none' || p.classList.contains('hidden') ? true : false;
        if (nowOpen) { p.style.display='block'; p.classList.remove('hidden'); p.setAttribute('data-open','true'); }
        else { p.style.display='none'; p.classList.add('hidden'); p.setAttribute('data-open','false'); }
        const name = $('#sv_name'); setTimeout(()=>{ try{ name && name.focus(); }catch(e){} }, 40);
        Log.info('Create panel toggled (direct)');
      });
    }

    $('#sv_cancel') && $('#sv_cancel').addEventListener('click', () => {
      const p = $('#createPanel'); if (p) { p.style.display='none'; p.classList.add('hidden'); p.setAttribute('data-open','false'); }
      $('#createMsg') && ($('#createMsg').textContent = '');
    });
    $('#sv_create') && $('#sv_create').addEventListener('click', createServer);
    $('#backToJoin') && $('#backToJoin').addEventListener('click', () => location.href = './join.html');

    wirePwdModal();

    // Listen for delegated join requests (fired by delegated handler)
    document.addEventListener('client-join-server', (ev) => {
      try { onJoinRequest(ev.detail.serverId); } catch (e) { Log.error('client-join-server handler', e); }
    });

    // Socket setup (optional / resilient)
    try {
      socket = io(BACKEND_URL, { autoConnect: true });
      socket.on('connect', () => Log.success(`Socket connected id=${socket.id}`));
      socket.on('disconnect', (r) => Log.warn('Socket disconnected: ' + r));
      socket.on('connect_error', (e) => Log.error('Socket connect_error', e));
      socket.on('servers-updated', (list) => {
        Log.info(`servers-updated (${(list && list.length) || 0})`);
        state.servers = list || [];
        renderServers();
      });
      socket.emit && socket.emit('request-servers');
    } catch (e) {
      Log.warn('socket init failed', e);
    }

    // initial fetch + show create if requested
    await fetchServers();
    if (opts.showCreate) {
      const p = $('#createPanel'); if (p) { p.style.display='block'; p.classList.remove('hidden'); p.setAttribute('data-open','true'); }
    }
    const me = $('#meLine'); if (me && state.user) me.textContent = `You are: ${state.user}`;
  }

  // Chat init
  async function initChat(opts = {}) {
    state.user = localStorage.getItem('username');
    if (!state.user) { Log.warn('initChat: user missing'); alert('Username missing'); window.location = './index.html'; return; }
    const serverId = opts.serverId;
    if (!serverId) { alert('No server specified'); window.location = './servers.html'; return; }

    // Hide modal state
    state.pendingJoin = null;
    const m = $('#pwdModal'); if (m) { m.classList.add('hidden'); m.style.display='none'; }

    // socket for chat
    socket = io(BACKEND_URL, { autoConnect: false });
    socket.connect();
    socket.on('connect', () => {
      Log.success('chat socket connected');
      socket.emit('join-room', { serverId, username: state.user });
    });
    socket.on('joined-ok', () => addSystem('Joined server'));
    socket.on('join-error', (d) => { Log.error('join-error', d); alert('Error: ' + (d.error || 'Join failed')); window.location = './servers.html'; });
    socket.on('chat-message', (m) => { Log.info('chat message', m); addChatMessage(m); });
    socket.on('system-message', (m) => { Log.info('system message', m); addSystem(m.text || m); });

    $('#msgForm') && $('#msgForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const txt = $('#msgInput') ? $('#msgInput').value.trim() : '';
      if (!txt) return;
      socket.emit('send-message', { serverId, text: txt });
      $('#msgInput').value = '';
    });

    $('#leaveBtn') && $('#leaveBtn').addEventListener('click', () => {
      socket.emit('leave-room'); try { socket.disconnect(); } catch(e){}
      Log.info('Left room');
      window.location = './servers.html';
    });

    // show room meta if present
    try {
      const res = await fetch(`${BACKEND_URL}/servers`);
      if (res.ok) {
        const list = await res.json();
        const s = (list || []).find(x => x.id === serverId);
        if (s) {
          $('#roomTitle') && ($('#roomTitle').textContent = s.name);
          $('#roomMeta') && ($('#roomMeta').textContent = `Created by ${s.creator} • ${s.occupancy}/${s.max} occupants`);
        }
      }
    } catch (e) { Log.warn('initChat metadata fetch failed', e); }
  }

  // Chat message helpers
  function addChatMessage(m) {
    const area = $('#messages'); if (!area) return;
    const d = createEl('div','msg');
    d.innerHTML = `<div class="meta">${escapeHtml(m.username)} • ${new Date(m.ts).toLocaleTimeString()}</div><div>${escapeHtml(m.text)}</div>`;
    area.appendChild(d); area.scrollTop = area.scrollHeight;
  }
  function addSystem(text) {
    const area = $('#messages'); if (!area) return;
    const d = createEl('div','msg');
    d.innerHTML = `<div class="meta">[system]</div><div>${escapeHtml(text)}</div>`;
    area.appendChild(d); area.scrollTop = area.scrollHeight;
  }

  // expose public methods
  return { initServers, initChat, _state: () => state };
})();

// Export to window for inline pages that call ClientApp.initServers/initChat
window.ClientApp = ClientApp;
