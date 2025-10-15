// client.js
const BACKEND_URL = 'https://chat-backend-1-4k6l.onrender.com';
// socket instance for chat (created when needed)
let socket = null;

// Utility helpers
const $ = (sel) => document.querySelector(sel);
const createEl = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
const escapeHtml = (s='') => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// --- Servers UI logic ---
const ClientApp = (function () {
  let state = {
    user: null,
    servers: [],
    pendingJoin: null, // server object when password required
  };

  // Fetch servers from backend (REST)
  async function fetchServers() {
    try {
      const res = await fetch(`${BACKEND_URL}/servers`);
      if (!res.ok) throw new Error('Failed to fetch servers');
      state.servers = await res.json();
      renderServers();
    } catch (err) {
      console.error(err);
      // show fallback
      $('#list').innerHTML = '<div class="muted">Unable to load servers.</div>';
    }
  }

  // Render server cards with filters/sorting
  function renderServers() {
    const container = $('#list');
    if (!container) return;
    const q = ($('#search') && $('#search').value.trim().toLowerCase()) || '';
    const tagq = ($('#tagFilter') && $('#tagFilter').value.trim().toLowerCase()) || '';
    const showPublic = $('#filterPublic') ? $('#filterPublic').checked : true;
    const showPrivate = $('#filterPrivate') ? $('#filterPrivate').checked : true;
    const onlyWithSpace = $('#filterHasSpace') ? $('#filterHasSpace').checked : false;
    const sortBy = $('#sortBy') ? $('#sortBy').value : 'created';

    let list = state.servers.slice();

    // filters
    list = list.filter(s => {
      if (!showPublic && !s.hasPassword && !s.hasPassword) return false;
      if (!showPrivate && s.hasPassword) return false;
      if (onlyWithSpace && s.occupancy >= s.max) return false;
      if (q) {
        const nameMatch = s.name.toLowerCase().includes(q);
        const tagsMatch = s.tags.join(' ').toLowerCase().includes(q);
        if (!nameMatch && !tagsMatch) return false;
      }
      if (tagq) {
        const tags = s.tags.map(t => t.toLowerCase());
        if (!tags.includes(tagq)) return false;
      }
      return true;
    });

    // sort
    if (sortBy === 'name') list.sort((a,b)=> a.name.localeCompare(b.name));
    else if (sortBy === 'availability') list.sort((a,b) => ((b.max - b.occupancy) - (a.max - a.occupancy)));
    else list.sort((a,b)=> b.createdAt - a.createdAt); // newest first

    // render
    container.innerHTML = '';
    if (list.length === 0) {
      container.innerHTML = '<div class="muted">No servers found.</div>';
      return;
    }

    list.forEach(s => {
      const card = createEl('div','serverCard');
      const info = createEl('div','serverInfo');
      const ageMin = Math.floor((Date.now() - s.createdAt) / 60000);
      info.innerHTML = `<strong>${escapeHtml(s.name)}</strong> • ${escapeHtml(s.creator)}<br/>
        <span class="meta">Tags: ${escapeHtml((s.tags || []).join(', '))} • ${s.hasPassword ? '🔒 Private' : '🌐 Public'} • ${s.occupancy}/${s.max} • Created: ${new Date(s.createdAt).toLocaleString()} (${ageMin} min ago)</span>`;
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

  // Join click handler — only prompt for password when button clicked
  function onJoinClick(srv) {
    if (!srv.hasPassword) {
      attemptJoin(srv.id, '');
      return;
    }
    // show password modal
    state.pendingJoin = srv;
    $('#pwdInput').value = '';
    $('#pwdMsg').textContent = '';
    $('#pwdModal').classList.remove('hidden');
    $('#pwdInput').focus();
  }

  // Join click handler — only prompt for password when button clicked (safe version)
function onJoinClick(srv, evt) {
  // Optional guard: ensure this came from a real user gesture
  if (evt && evt.isTrusted === false) {
    console.warn('Ignored synthetic/non-trusted event for join.');
    return;
  }

  // clear previous pending join
  state.pendingJoin = null;

  // If the server is public, attempt immediate join
  if (!srv.hasPassword) {
    attemptJoin(srv.id, '');
    return;
  }

  // Otherwise prepare modal for password input
  state.pendingJoin = srv;

  const modal = document.getElementById('pwdModal');
  const pwdInput = document.getElementById('pwdInput');
  const pwdMsg = document.getElementById('pwdMsg');

  if (!modal) {
    console.error('Password modal not found in DOM.');
    return;
  }

  // reset modal UI
  if (pwdInput) pwdInput.value = '';
  if (pwdMsg) pwdMsg.textContent = '';

  // show modal
  modal.classList.remove('hidden');

  // focus input on next tick so browsers will focus properly
  setTimeout(() => {
    try { pwdInput && pwdInput.focus(); } catch(e){}
  }, 0);
}

  // Create server
  async function createServer() {
    const name = $('#sv_name').value.trim();
    const tags = $('#sv_tags').value.trim();
    const max = Math.max(1, Number($('#sv_max').value) || 8);
    const password = $('#sv_pass').value || '';
    if (!name) { $('#createMsg').textContent = 'Name required'; return; }
    const payload = { name, creator: state.user, tags, max, password };
    try {
      const res = await fetch(`${BACKEND_URL}/servers`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      const body = await res.json();
      if (!res.ok) {
        $('#createMsg').textContent = body.error || 'Create failed';
        return;
      }
      $('#createMsg').textContent = 'Server created';
      $('#createPanel').classList.add('hidden');
      // refresh list
      await fetchServers();
    } catch (err) {
      console.error(err);
      $('#createMsg').textContent = 'Network error';
    }
  }
  // Install password modal handlers (call once during init)
  function wirePasswordModalButtons() {
    function pwdSubmitHandler(e) {
      if (e && e.isTrusted === false) {
        console.warn('Ignored synthetic submit');
        return;
      }
      const pwd = (document.getElementById('pwdInput') || {}).value || '';
      const modal = document.getElementById('pwdModal');
      if (modal) modal.classList.add('hidden');
  
      if (!state.pendingJoin) {
        console.warn('No pending server to join.');
        return;
      }
      attemptJoin(state.pendingJoin.id, pwd);
      state.pendingJoin = null;
    }
  
    function pwdBackHandler(e) {
      const modal = document.getElementById('pwdModal');
      if (modal) modal.classList.add('hidden');
      state.pendingJoin = null;
    }
  
    const submit = document.getElementById('pwdSubmit');
    const back = document.getElementById('pwdBack');
  
    if (submit) {
      // remove previous listeners (defensive)
      submit.removeEventListener('click', pwdSubmitHandler);
      submit.addEventListener('click', pwdSubmitHandler);
    }
    if (back) {
      back.removeEventListener('click', pwdBackHandler);
      back.addEventListener('click', pwdBackHandler);
    }
  }

  // Public interface for servers page init
  async function initServers(opts = {}) {
    state.user = localStorage.getItem('username');
    if (!state.user) { alert('Username missing'); window.location='./index.html'; return; }

    // wire UI events
    $('#search').addEventListener('input', renderServers);
    $('#tagFilter').addEventListener('input', renderServers);
    $('#sortBy').addEventListener('change', renderServers);
    $('#filterPublic').addEventListener('change', renderServers);
    $('#filterPrivate').addEventListener('change', renderServers);
    $('#filterHasSpace').addEventListener('change', renderServers);
    $('#toggleCreate').addEventListener('click', () => $('#createPanel').classList.toggle('hidden'));
    $('#sv_cancel').addEventListener('click', () => { $('#createPanel').classList.add('hidden'); $('#createMsg').textContent=''; });
    $('#sv_create').addEventListener('click', createServer);
    $('#backToJoin').addEventListener('click', () => window.location = './join.html');

    // Password modal buttons
    // Wire modal once (see wirePasswordModalButtons below)
    wirePasswordModalButtons();


    // If socket updates desired: open socket and subscribe to servers list updates
    try {
      socket = io(BACKEND_URL, { autoConnect: true });
      socket.on('servers-updated', (list) => {
        state.servers = list;
        renderServers();
      });
      // ask for list if socket didn't push anything
      socket.emit && socket.emit('request-servers');
    } catch (e) {
      console.warn('Socket not available for server updates', e);
    }

    // fetch once
    await fetchServers();

    // show create panel if requested via query param
    if (opts.showCreate) $('#createPanel').classList.remove('hidden');
  }

  // --- Chat page logic ---
  async function initChat(opts) {
    state.user = localStorage.getItem('username');
    if (!state.user) { alert('Username missing'); window.location='./index.html'; return; }

    const serverId = opts.serverId;
    if (!serverId) { alert('No server'); window.location = './servers.html'; return; }

    // create socket and hook events
    socket = io(BACKEND_URL, { autoConnect: false });
    socket.connect();

    socket.on('connect', () => {
      socket.emit('join-room', { serverId, username: state.user });
    });

    socket.on('joined-ok', (d) => {
      addSystem(`Joined server`);
    });

    socket.on('join-error', (d) => {
      alert('Error: ' + (d.error || 'Join failed'));
      window.location = './servers.html';
    });

    socket.on('chat-message', (m) => {
      addChatMessage(m);
    });

    socket.on('system-message', (m) => {
      addSystem(m.text || m);
    });

    // message sending
    $('#msgForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const txt = $('#msgInput').value.trim();
      if (!txt) return;
      socket.emit('send-message', { serverId, text: txt });
      $('#msgInput').value = '';
    });

    $('#leaveBtn').addEventListener('click', () => {
      socket.emit('leave-room');
      try { socket.disconnect(); } catch(e){}
      window.location = './servers.html';
    });

    // show server meta (if available from REST)
    try {
      const res = await fetch(`${BACKEND_URL}/servers`);
      if (res.ok) {
        const list = await res.json();
        const s = list.find(x => x.id === serverId);
        if (s) {
          $('#roomTitle').textContent = s.name;
          $('#roomMeta').textContent = `Created by ${s.creator} • ${s.occupancy}/${s.max} occupants`;
        } else {
          $('#roomTitle').textContent = 'Chat Room';
        }
      }
    } catch(e){}
  }

  // DOM helpers for chat messages
  function addChatMessage(m) {
    const area = $('#messages');
    const d = createEl('div','msg');
    d.innerHTML = `<div class="meta">${escapeHtml(m.username)} • ${new Date(m.ts).toLocaleTimeString()}</div>
                   <div>${escapeHtml(m.text)}</div>`;
    area.appendChild(d);
    area.scrollTop = area.scrollHeight;
  }
  function addSystem(text) {
    const area = $('#messages');
    const d = createEl('div','msg');
    d.innerHTML = `<div class="meta">[system]</div><div>${escapeHtml(text)}</div>`;
    area.appendChild(d);
    area.scrollTop = area.scrollHeight;
  }

  return {
    initServers,
    initChat
  };
})();

