// client.js (iframe-friendly)
// Replace with your backend URL:
const BACKEND_URL = 'https://chat-backend-1-4k6l.onrender.com';

let socket = null;
const $ = (sel) => document.querySelector(sel);
const createEl = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
const escapeHtml = (s='') => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// ---------- Enhanced Logging ----------
const Log = {
  info: (msg, ...rest) => console.log(`%c[INFO] %c${msg}`, 'color: #0af; font-weight: bold;', 'color: inherit;', ...rest),
  success: (msg, ...rest) => console.log(`%c[SUCCESS] %c${msg}`, 'color: #0a0; font-weight: bold;', 'color: inherit;', ...rest),
  warn: (msg, ...rest) => console.warn(`%c[WARN] %c${msg}`, 'color: #fa0; font-weight: bold;', 'color: inherit;', ...rest),
  error: (msg, ...rest) => console.error(`%c[ERROR] %c${msg}`, 'color: #f00; font-weight: bold;', 'color: inherit;', ...rest),
  group: (name) => console.group(`%c[GROUP] %c${name}`, 'color: #888; font-weight: bold;', 'color: inherit;'),
  groupEnd: () => console.groupEnd(),
};

// ---------- THEME TOGGLER ----------
(function(){
  const saved = localStorage.getItem('theme');
  const systemPrefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  const defaultTheme = saved || (systemPrefersLight ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', defaultTheme);

  window.toggleTheme = function() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateToggleButton(next);
  };

  function updateToggleButton(theme) {
    const b = document.getElementById('themeToggle');
    if (!b) return;
    if (theme === 'dark') {
      b.textContent = '☀️ Light';
      b.setAttribute('aria-pressed', 'true');
    } else {
      b.textContent = '🌙 Dark';
      b.setAttribute('aria-pressed', 'false');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('themeToggle');
    if (btn) {
      btn.addEventListener('click', () => window.toggleTheme());
      updateToggleButton(document.documentElement.getAttribute('data-theme'));
    }
  });
})();

// ---------- CLIENT APP ----------
const ClientApp = (function () {
  let state = { user: null, servers: [], pendingJoin: null };

  // Fetch servers
  async function fetchServers() {
    Log.group('Fetch Servers');
    try {
      Log.info(`Fetching from ${BACKEND_URL}/servers`);
      const res = await fetch(`${BACKEND_URL}/servers`);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      state.servers = await res.json();
      Log.success(`Fetched ${state.servers.length} servers`);
      renderServers();
    } catch (e) {
      Log.error('Failed to fetch servers', e);
      const list = $('#list');
      if (list) list.innerHTML = '<div class="muted">Unable to load servers.</div>';
    } finally {
      Log.groupEnd();
    }
  }

  // Render server list
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
        const nameMatch = s.name.toLowerCase().includes(q);
        const tagsMatch = (s.tags || []).join(' ').toLowerCase().includes(q);
        if (!nameMatch && !tagsMatch) return false;
      }
      if (tagq) {
        const tags = (s.tags || []).map(t=>t.toLowerCase());
        if (!tags.includes(tagq)) return false;
      }
      return true;
    });

    if (sortBy === 'name') list.sort((a,b)=> a.name.localeCompare(b.name));
    else if (sortBy === 'availability') list.sort((a,b) => ((b.max - b.occupancy) - (a.max - a.occupancy)));
    else list.sort((a,b)=> b.createdAt - a.createdAt);

    container.innerHTML = '';
    if (list.length === 0) { container.innerHTML = '<div class="muted">No servers found.</div>'; return; }

    list.forEach(s => {
      const card = createEl('div','serverCard');
      const info = createEl('div','serverInfo');
      const ageMin = Math.floor((Date.now() - s.createdAt)/60000);
      info.innerHTML = `<strong>${escapeHtml(s.name)}</strong> • ${escapeHtml(s.creator)}<br/>
        <span class="meta">Tags: ${escapeHtml((s.tags||[]).join(', '))} • ${s.hasPassword ? '🔒 Private' : '🌐 Public'} • ${s.occupancy}/${s.max} • Created: ${new Date(s.createdAt).toLocaleString()} (${ageMin} min ago)</span>`;
      const actions = createEl('div','serverActions');
      const joinBtn = createEl('button');
      joinBtn.textContent = 'Join';
      joinBtn.addEventListener('click', (evt) => onJoinClick(s, evt));
      actions.appendChild(joinBtn);
      card.appendChild(info);
      card.appendChild(actions);
      container.appendChild(card);
    });
  }

  // Join click
  function onJoinClick(srv, evt) {
    if (evt && evt.isTrusted === false) { Log.warn('Ignored synthetic join click'); return; }
    clearModalAndPending();
    if (!srv.hasPassword) { attemptJoin(srv.id, ''); return; }
    state.pendingJoin = srv;
    const modal = $('#pwdModal'); if (!modal) return;
    $('#pwdInput') && ($('#pwdInput').value = '');
    $('#pwdMsg') && ($('#pwdMsg').textContent = '');
    modal.classList.remove('hidden');
    setTimeout(()=>{ try{ $('#pwdInput') && $('#pwdInput').focus(); }catch(e){} },0);
  }

  async function attemptJoin(serverId, password) {
    Log.group(`Join Server: ${serverId}`);
    try {
      const user = localStorage.getItem('username');
      if (!user) {
        Log.error('Missing username — cannot join');
        alert('Missing username. Return to entry.');
        return;
      }
      Log.info(`Joining as ${user}`);
      const res = await fetch(`${BACKEND_URL}/join`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ serverId, username: user, password })
      });
      const body = await res.json();
      if (!res.ok) {
        Log.error(`Join failed: ${body.error || res.statusText}`);
        const msg = body.error || 'Unable to join';
        const pwdMsg = $('#pwdMsg');
        if (pwdMsg && !$('#pwdModal').classList.contains('hidden')) pwdMsg.textContent = `Error: ${msg}`;
        else alert(`Error: ${msg}`);
        return;
      }
      Log.success(`Joined server ${serverId}`);
      location.href = `./chat.html?server=${encodeURIComponent(serverId)}`;
    } catch (err) {
      Log.error('Network error while joining', err);
      alert('Network error while joining');
    } finally {
      Log.groupEnd();
      state.pendingJoin = null;
      const modal = $('#pwdModal'); modal && modal.classList.add('hidden');
    }
  }

  function clearModalAndPending() {
    state.pendingJoin = null;
    const modal = $('#pwdModal'); modal && modal.classList.add('hidden');
    const msg = $('#pwdMsg'); if (msg) msg.textContent = '';
  }

  // Create server
  async function createServer() {
    const name = $('#sv_name').value.trim();
    const tags = $('#sv_tags').value.trim();
    const max = Math.max(1, Number($('#sv_max').value) || 8);
    const password = $('#sv_pass').value || '';
    if (!name) { $('#createMsg').textContent = 'Name required'; return; }
    Log.group('Create Server');
    try {
      Log.info(`Creating server "${name}"`);
      const res = await fetch(`${BACKEND_URL}/servers`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ name, creator: state.user, tags, max, password })
      });
      const body = await res.json();
      if (!res.ok) {
        Log.error(`Create failed: ${body.error || res.statusText}`);
        $('#createMsg').textContent = body.error || 'Create failed';
        return;
      }
      Log.success(`Server "${name}" created`);
      $('#createMsg').textContent = 'Server created';
      $('#createPanel').classList.add('hidden');
      await fetchServers();
    } catch(e) {
      Log.error('Network error creating server', e);
      $('#createMsg').textContent = 'Network error';
    } finally {
      Log.groupEnd();
    }
  }

  // Wire password modal
  function wirePwdModal() {
    const submit = $('#pwdSubmit'), back = $('#pwdBack');
    function submitHandler(e){ 
      if (e && e.isTrusted === false) return; 
      const pwd = ($('#pwdInput') && $('#pwdInput').value) || ''; 
      const modal = $('#pwdModal'); modal && modal.classList.add('hidden'); 
      if (!state.pendingJoin) return; 
      attemptJoin(state.pendingJoin.id, pwd); 
      state.pendingJoin = null; 
    }
    function backHandler(){ const modal = $('#pwdModal'); modal && modal.classList.add('hidden'); state.pendingJoin = null; }
    if (submit) { submit.removeEventListener('click', submitHandler); submit.addEventListener('click', submitHandler); }
    if (back) { back.removeEventListener('click', backHandler); back.addEventListener('click', backHandler); }
  }

  // Init servers page
  async function initServers(opts={}) {
    state.user = localStorage.getItem('username');
    if (!state.user) Log.warn('initServers: username missing');

    $('#search') && $('#search').addEventListener('input', renderServers);
    $('#tagFilter') && $('#tagFilter').addEventListener('input', renderServers);
    $('#sortBy') && $('#sortBy').addEventListener('change', renderServers);
    $('#filterPublic') && $('#filterPublic').addEventListener('change', renderServers);
    $('#filterPrivate') && $('#filterPrivate').addEventListener('change', renderServers);
    $('#filterHasSpace') && $('#filterHasSpace').addEventListener('change', renderServers);

    // ✅ Make sure the New Server button always works
    const toggleBtn = $('#toggleCreate');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        $('#createPanel').classList.toggle('hidden');
      });
    }

    $('#sv_cancel') && $('#sv_cancel').addEventListener('click', ()=>{ 
      $('#createPanel').classList.add('hidden'); 
      $('#createMsg').textContent='';
    });
    $('#sv_create') && $('#sv_create').addEventListener('click', createServer);
    $('#backToJoin') && $('#backToJoin').addEventListener('click', ()=> location.href = './join.html' );
    wirePwdModal();

    // Socket events
    try {
      socket = io(BACKEND_URL, { autoConnect: true });
      socket.on('connect', () => Log.success(`Socket connected (id: ${socket.id})`));
      socket.on('disconnect', (reason) => Log.warn(`Socket disconnected: ${reason}`));
      socket.on('connect_error', (err) => Log.error('Socket connection error', err));
      socket.on('servers-updated', list => {
        Log.info(`Received server update (${list.length} servers)`);
        state.servers = list;
        renderServers();
      });
      socket.emit && socket.emit('request-servers');
    } catch(e) {
      Log.error('Socket init failed', e);
    }

    await fetchServers();
    if (opts.showCreate) $('#createPanel').classList.remove('hidden');
    const me = $('#meLine'); if (me && state.user) me.textContent = `You are: ${state.user}`;
  }

  // Init chat page
  async function initChat(opts) {
    state.user = localStorage.getItem('username');
    if (!state.user) {
      Log.warn('initChat: username missing');
      return;
    }
    const serverId = opts.serverId;
    if (!serverId) { alert('No server'); location.href = './servers.html'; return; }

    state.pendingJoin = null;
    const modal = $('#pwdModal'); modal && modal.classList.add('hidden');

    socket = io(BACKEND_URL, { autoConnect: false });
    socket.connect();
    socket.on('connect', ()=> {
      Log.success('Chat socket connected');
      socket.emit('join-room', { serverId, username: state.user });
    });
    socket.on('joined-ok', ()=> addSystem('Joined server'));
    socket.on('join-error', d => { Log.error('Join-error', d); alert('Error: ' + (d.error || 'Join failed')); location.href = './servers.html'; });
    socket.on('chat-message', m => {
      Log.info(`Chat message from ${m.username}`, m);
      addChatMessage(m);
    });
    socket.on('system-message', m => {
      Log.info(`System message: ${m.text || m}`);
      addSystem(m.text || m);
    });

    $('#msgForm') && $('#msgForm').addEventListener('submit', e => {
      e.preventDefault();
      const txt = ($('#msgInput') && $('#msgInput').value.trim()) || '';
      if (!txt) return;
      socket.emit('send-message', { serverId, text: txt });
      $('#msgInput').value = '';
    });

    $('#leaveBtn') && $('#leaveBtn').addEventListener('click', ()=> {
      socket.emit('leave-room');
      try { socket.disconnect(); } catch(e){}
      Log.info('Left server, returning to server list');
      location.href = './servers.html';
    });

    try {
      const res = await fetch(`${BACKEND_URL}/servers`);
      if (res.ok) {
        const list = await res.json();
        const s = list.find(x => x.id === serverId);
        if (s) {
          $('#roomTitle').textContent = s.name; 
          $('#roomMeta').textContent = `Created by ${s.creator} • ${s.occupancy}/${s.max} occupants`;
        }
      }
    } catch(e){
      Log.error('Failed to fetch server info for chat', e);
    }
  }

  function addChatMessage(m) {
    const area = $('#messages'); if (!area) return;
    const d = createEl('div','msg');
    d.innerHTML = `<div class="meta">${escapeHtml(m.username)} • ${new Date(m.ts).toLocaleTimeString()}</div><div>${escapeHtml(m.text)}</div>`;
    area.appendChild(d); area.scrollTop = area.scrollHeight;
  }
  function addSystem(text) {
    const area = $('#messages'); if (!area) return;
    const d = createEl('div','msg'); d.innerHTML = `<div class="meta">[system]</div><div>${escapeHtml(text)}</div>`; area.appendChild(d); area.scrollTop = area.scrollHeight;
  }

  return { initServers, initChat };
})();
