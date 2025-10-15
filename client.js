// client.js (iframe-friendly)
// Replace with your backend URL:
const BACKEND_URL = 'https://chat-backend-1-4k6l.onrender.com';

let socket = null;
const $ = (sel) => document.querySelector(sel);
const createEl = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
const escapeHtml = (s='') => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// THEME TOGGLER
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

  // Wire up button on DOM ready if present
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('themeToggle');
    if (btn) {
      btn.addEventListener('click', () => window.toggleTheme());
      updateToggleButton(document.documentElement.getAttribute('data-theme'));
    }
  });
})();

const ClientApp = (function () {
  let state = { user: null, servers: [], pendingJoin: null };

  // fetch servers
  async function fetchServers() {
    try {
      const res = await fetch(`${BACKEND_URL}/servers`);
      if (!res.ok) throw new Error('Failed');
      state.servers = await res.json();
      renderServers();
    } catch (e) {
      console.error(e);
      const list = $('#list');
      if (list) list.innerHTML = '<div class="muted">Unable to load servers.</div>';
    }
  }

  // render servers
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
        const tags = (s.tags || []).map(t => t.toLowerCase());
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

  // join click
  function onJoinClick(srv, evt) {
    if (evt && evt.isTrusted === false) { console.warn('Ignored synthetic'); return; }
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
    try {
      const user = localStorage.getItem('username');
      if (!user) { alert('Missing username. Return to entry.'); return; }
      const res = await fetch(`${BACKEND_URL}/join`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ serverId, username: user, password })
      });
      const body = await res.json();
      if (!res.ok) {
        const msg = body.error || 'Unable to join';
        const pwdMsg = $('#pwdMsg');
        if (pwdMsg && !$('#pwdModal').classList.contains('hidden')) pwdMsg.textContent = `Error: ${msg}`;
        else alert(`Error: ${msg}`);
        return;
      }
      // navigate inside iframe
      location.href = `./chat.html?server=${encodeURIComponent(serverId)}`;
    } catch (err) {
      console.error(err);
      alert('Network error while joining');
    } finally {
      state.pendingJoin = null;
      const modal = $('#pwdModal'); modal && modal.classList.add('hidden');
    }
  }

  async function createServer() {
    const name = $('#sv_name').value.trim();
    const tags = $('#sv_tags').value.trim();
    const max = Math.max(1, Number($('#sv_max').value) || 8);
    const password = $('#sv_pass').value || '';
    if (!name) { $('#createMsg').textContent = 'Name required'; return; }
    try {
      const res = await fetch(`${BACKEND_URL}/servers`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ name, creator: state.user, tags, max, password })
      });
      const body = await res.json();
      if (!res.ok) { $('#createMsg').textContent = body.error || 'Create failed'; return; }
      $('#createMsg').textContent = 'Server created';
      $('#createPanel').classList.add('hidden');
      await fetchServers();
    } catch(e) { console.error(e); $('#createMsg').textContent = 'Network error'; }
  }

  function clearModalAndPending() {
    state.pendingJoin = null;
    const modal = $('#pwdModal'); modal && modal.classList.add('hidden');
    const msg = $('#pwdMsg';) // intentional harmless guard removed? fix below
  }

  // wire modal handlers
  function wirePwdModal() {
    const submit = $('#pwdSubmit'), back = $('#pwdBack');
    function submitHandler(e){ if (e && e.isTrusted === false) return; const pwd = ($('#pwdInput') && $('#pwdInput').value) || ''; const modal = $('#pwdModal'); modal && modal.classList.add('hidden'); if (!state.pendingJoin) return; attemptJoin(state.pendingJoin.id, pwd); state.pendingJoin = null; }
    function backHandler(){ const modal = $('#pwdModal'); modal && modal.classList.add('hidden'); state.pendingJoin = null; }
    if (submit) { submit.removeEventListener('click', submitHandler); submit.addEventListener('click', submitHandler); }
    if (back) { back.removeEventListener('click', backHandler); back.addEventListener('click', backHandler); }
  }

  async function initServers(opts={}) {
    state.user = localStorage.getItem('username');
    if (!state.user) {
      // show notice — pages themselves will show missing-user messages
      console.warn('initServers: username missing');
    }
    $('#search') && $('#search').addEventListener('input', renderServers);
    $('#tagFilter') && $('#tagFilter').addEventListener('input', renderServers);
    $('#sortBy') && $('#sortBy').addEventListener('change', renderServers);
    $('#filterPublic') && $('#filterPublic').addEventListener('change', renderServers);
    $('#filterPrivate') && $('#filterPrivate').addEventListener('change', renderServers);
    $('#filterHasSpace') && $('#filterHasSpace').addEventListener('change', renderServers);
    $('#toggleCreate') && $('#toggleCreate').addEventListener('click', ()=>$('#createPanel').classList.toggle('hidden'));
    $('#sv_cancel') && $('#sv_cancel').addEventListener('click', ()=>{ $('#createPanel').classList.add('hidden'); $('#createMsg').textContent=''; });
    $('#sv_create') && $('#sv_create').addEventListener('click', createServer);
    $('#backToJoin') && $('#backToJoin').addEventListener('click', ()=> location.href = './join.html' );
    wirePwdModal();
    try {
      socket = io(BACKEND_URL, { autoConnect: true });
      socket.on('servers-updated', list => { state.servers = list; renderServers(); });
      socket.emit && socket.emit('request-servers');
    } catch(e) { console.warn('Socket init failed', e); }
    await fetchServers();
    if (opts.showCreate) $('#createPanel').classList.remove('hidden');
    const me = $('#meLine'); if (me && state.user) me.textContent = `You are: ${state.user}`;
  }

  async function initChat(opts) {
    state.user = localStorage.getItem('username');
    if (!state.user) {
      console.warn('initChat: username missing');
      return;
    }
    const serverId = opts.serverId;
    if (!serverId) { alert('No server'); location.href = './servers.html'; return; }
    // clean modal state
    state.pendingJoin = null;
    const modal = $('#pwdModal'); modal && modal.classList.add('hidden');

    socket = io(BACKEND_URL, { autoConnect: false });
    socket.connect();
    socket.on('connect', ()=> socket.emit('join-room', { serverId, username: state.user }));
    socket.on('joined-ok', ()=> addSystem('Joined server'));
    socket.on('join-error', d => { alert('Error: ' + (d.error || 'Join failed')); location.href = './servers.html'; });
    socket.on('chat-message', m => addChatMessage(m));
    socket.on('system-message', m => addSystem(m.text || m));

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
      location.href = './servers.html';
    });

    try {
      const res = await fetch(`${BACKEND_URL}/servers`);
      if (res.ok) {
        const list = await res.json();
        const s = list.find(x => x.id === serverId);
        if (s) { $('#roomTitle').textContent = s.name; $('#roomMeta').textContent = `Created by ${s.creator} • ${s.occupancy}/${s.max} occupants`; }
      }
    } catch(e){}
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

