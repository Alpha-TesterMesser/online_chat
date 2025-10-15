// client.js (REPLACE your existing file with this)
// IMPORTANT: set your backend URL here:
const BACKEND_URL = 'https://chat-backend-1-4k6l.onrender.com';

// socket instance for chat (created when needed)
let socket = null;

// DOM helpers
const $ = (sel) => document.querySelector(sel);
const createEl = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
const escapeHtml = (s='') => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// --- App closure ---
const ClientApp = (function () {
  // app state
  let state = {
    user: null,
    servers: [],
    pendingJoin: null // will only be set by onJoinClick (user action)
  };

  // --- Utility: ensure modal hidden and pending cleared ---
  function clearPendingAndHideModal() {
    state.pendingJoin = null;
    const modal = document.getElementById('pwdModal');
    if (modal && !modal.classList.contains('hidden')) modal.classList.add('hidden');
    const pwdMsg = document.getElementById('pwdMsg');
    if (pwdMsg) pwdMsg.textContent = '';
  }

  // --- REST: fetch servers ---
  async function fetchServers() {
    try {
      const res = await fetch(`${BACKEND_URL}/servers`);
      if (!res.ok) throw new Error('Failed to fetch servers');
      state.servers = await res.json();
      renderServers();
    } catch (err) {
      console.error(err);
      const list = $('#list');
      if (list) list.innerHTML = '<div class="muted">Unable to load servers.</div>';
    }
  }

  // --- Render server cards ---
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

    // Filters
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

    // Sort
    if (sortBy === 'name') list.sort((a,b)=> a.name.localeCompare(b.name));
    else if (sortBy === 'availability') list.sort((a,b) => ((b.max - b.occupancy) - (a.max - a.occupancy)));
    else list.sort((a,b)=> b.createdAt - a.createdAt); // newest first

    // Render
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

      // Join button: pass the event so we can check evt.isTrusted in handler
      const joinBtn = createEl('button');
      joinBtn.textContent = 'Join';
      joinBtn.addEventListener('click', (evt) => onJoinClick(s, evt));
      actions.appendChild(joinBtn);

      card.appendChild(info);
      card.appendChild(actions);
      container.appendChild(card);
    });
  }

  // --- Secure Join handler (only on user click) ---
  function onJoinClick(srv, evt) {
    // Ensure this is a real user interaction when available
    if (evt && evt.isTrusted === false) {
      console.warn('Ignored synthetic join click');
      return;
    }

    // Clear any previous pending state (defensive)
    clearPendingAndHideModal();

    // If no password required, attempt immediate join
    if (!srv.hasPassword) {
      attemptJoin(srv.id, '');
      return;
    }

    // else set pending join and show password modal
    state.pendingJoin = srv;

    const modal = document.getElementById('pwdModal');
    const pwdInput = document.getElementById('pwdInput');
    const pwdMsg = document.getElementById('pwdMsg');

    if (!modal) {
      console.error('Password modal missing from DOM');
      return;
    }

    if (pwdInput) pwdInput.value = '';
    if (pwdMsg) pwdMsg.textContent = '';
    modal.classList.remove('hidden');

    // focus input next tick
    setTimeout(() => { try { pwdInput && pwdInput.focus(); } catch(e){} }, 0);
  }
  function renderMessage(username, message, time) {
    const msgEl = document.createElement('div');
    msgEl.className = 'msg';
  
    const currentUser = localStorage.getItem('chatUsername');
  
    let tag = '';
    if (showOwnerTag && isOwner && username === currentUser) {
      tag = `
        <span class="owner-tag">
          👑 Owner
        </span>
      `;
    }
  
    msgEl.innerHTML = `
      <div class="meta">${username} ${tag} • ${time}</div>
      <div>${message}</div>
    `;
    return msgEl;
  }

  // --- Attempt join: call backend /join then navigate to chat ---
  async function attemptJoin(serverId, password) {
    try {
      const user = localStorage.getItem('username');
      if (!user) { alert('Username missing'); window.location = './index.html'; return; }

      const res = await fetch(`${BACKEND_URL}/join`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ serverId, username: user, password })
      });

      const body = await res.json();
      if (!res.ok) {
        const msg = body.error || 'Unable to join';
        // show error in modal if visible, else alert
        const pwdMsg = $('#pwdMsg');
        if (pwdMsg && !$('#pwdModal').classList.contains('hidden')) pwdMsg.textContent = `Error: ${msg}`;
        else alert(`Error: ${msg}`);
        return;
      }

      // success: navigate to chat page
      window.location = `./chat.html?server=${encodeURIComponent(serverId)}`;
    } catch (err) {
      console.error('attemptJoin error', err);
      alert('Network error while joining');
    } finally {
      // clear pending so stale state doesn't show modal
      state.pendingJoin = null;
      const modal = document.getElementById('pwdModal');
      if (modal && !modal.classList.contains('hidden')) modal.classList.add('hidden');
    }
  }

  // --- Create server ---
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
      await fetchServers();
    } catch (err) {
      console.error(err);
      $('#createMsg').textContent = 'Network error';
    }
  }

  // --- Password modal wiring (centralized) ---
  function wirePasswordModalButtons() {
    // handlers declared so removeEventListener works (defensive)
    function submitHandler(e) {
      if (e && e.isTrusted === false) {
        console.warn('Ignored synthetic submit');
        return;
      }
      const pwd = ($('#pwdInput') && $('#pwdInput').value) || '';
      const modal = $('#pwdModal');
      if (modal) modal.classList.add('hidden');

      if (!state.pendingJoin) {
        console.warn('No pendingJoin on submit');
        return;
      }
      attemptJoin(state.pendingJoin.id, pwd);
      state.pendingJoin = null;
    }
    function backHandler() {
      const modal = $('#pwdModal');
      if (modal) modal.classList.add('hidden');
      state.pendingJoin = null;
    }

    const submitBtn = $('#pwdSubmit');
    const backBtn = $('#pwdBack');
    if (submitBtn) {
      submitBtn.removeEventListener('click', submitHandler);
      submitBtn.addEventListener('click', submitHandler);
    }
    if (backBtn) {
      backBtn.removeEventListener('click', backHandler);
      backBtn.addEventListener('click', backHandler);
    }
  }

  // --- Public init for servers page ---
  async function initServers(opts = {}) {
    state.user = localStorage.getItem('username');
    if (!state.user) { alert('Username missing'); window.location='./index.html'; return; }

    // Defensive: hide password modal and clear pending any time we init
    clearPendingAndHideModal();

    // wire UI events
    const sSearch = $('#search'); if (sSearch) sSearch.addEventListener('input', renderServers);
    const sTag = $('#tagFilter'); if (sTag) sTag.addEventListener('input', renderServers);
    const sSort = $('#sortBy'); if (sSort) sSort.addEventListener('change', renderServers);
    const fPublic = $('#filterPublic'); if (fPublic) fPublic.addEventListener('change', renderServers);
    const fPrivate = $('#filterPrivate'); if (fPrivate) fPrivate.addEventListener('change', renderServers);
    const fHasSpace = $('#filterHasSpace'); if (fHasSpace) fHasSpace.addEventListener('change', renderServers);

    const toggleCreate = $('#toggleCreate'); if (toggleCreate) toggleCreate.addEventListener('click', () => $('#createPanel').classList.toggle('hidden'));
    const svCancel = $('#sv_cancel'); if (svCancel) svCancel.addEventListener('click', () => { $('#createPanel').classList.add('hidden'); $('#createMsg').textContent=''; });
    const svCreate = $('#sv_create'); if (svCreate) svCreate.addEventListener('click', createServer);
    const backBtn = $('#backToJoin'); if (backBtn) backBtn.addEventListener('click', () => window.location = './join.html');
    
    const OWNER_PASSWORD = "docs.google.com"; // change this to whatever you want

    const ownerTrigger = document.getElementById('ownerTrigger');
    const ownerPwdModal = document.getElementById('ownerPwdModal');
    const ownerPwdInput = document.getElementById('ownerPwdInput');
    const ownerPwdSubmit = document.getElementById('ownerPwdSubmit');
    const ownerPwdCancel = document.getElementById('ownerPwdCancel');
    const ownerPwdMsg = document.getElementById('ownerPwdMsg');
    
    const ownerPanel = document.getElementById('ownerPanel');
    const ownerTagToggle = document.getElementById('ownerTagToggle');
    const ownerClose = document.getElementById('ownerClose');
    
    let isOwner = false;
    let showOwnerTag = false;
    
    // Trigger hidden modal
    ownerTrigger.addEventListener('click', () => {
      ownerPwdInput.value = '';
      ownerPwdMsg.textContent = '';
      ownerPwdModal.classList.remove('hidden');
      ownerPwdInput.focus();
    });
    
    // Password submit
    ownerPwdSubmit.addEventListener('click', () => {
      if (ownerPwdInput.value === OWNER_PASSWORD) {
        isOwner = true;
        ownerPwdModal.classList.add('hidden');
        ownerPanel.classList.remove('hidden');
      } else {
        ownerPwdMsg.textContent = 'Incorrect password';
      }
    });
    
    // Password cancel
    ownerPwdCancel.addEventListener('click', () => {
      ownerPwdModal.classList.add('hidden');
    });
    
    // Owner panel close
    ownerClose.addEventListener('click', () => {
      ownerPanel.classList.add('hidden');
    });
    
    // Toggle owner tag
    ownerTagToggle.addEventListener('change', (e) => {
      showOwnerTag = e.target.checked;
    });


    // password modal wiring
    wirePasswordModalButtons();

    // Setup socket for live server updates (optional)
    try {
      socket = io(BACKEND_URL, { autoConnect: true });
      socket.on('servers-updated', (list) => {
        state.servers = list;
        renderServers();
      });
      socket.emit && socket.emit('request-servers');
    } catch (e) {
      console.warn('Socket not available for server updates', e);
    }

    // initial load
    await fetchServers();

    // show create panel if requested
    if (opts.showCreate) $('#createPanel').classList.remove('hidden');
  }


  
  // --- Chat page initialization ---
  async function initChat(opts) {
    state.user = localStorage.getItem('username');
    if (!state.user) { alert('Username missing'); window.location='./index.html'; return; }

    const serverId = opts.serverId;
    if (!serverId) { alert('No server'); window.location = './servers.html'; return; }

    // ensure modal not visible
    clearPendingAndHideModal();

    socket = io(BACKEND_URL, { autoConnect: false });
    socket.connect();

    socket.on('connect', () => {
      socket.emit('join-room', { serverId, username: state.user });
    });

    socket.on('joined-ok', () => addSystem(`Joined server`));
    socket.on('join-error', (d) => { alert('Error: ' + (d.error || 'Join failed')); window.location = './servers.html'; });
    socket.on('chat-message', (m) => addChatMessage(m));
    socket.on('system-message', (m) => addSystem(m.text || m));

    $('#msgForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const txt = ($('#msgInput') && $('#msgInput').value.trim()) || '';
      if (!txt) return;
      socket.emit('send-message', { serverId, text: txt });
      $('#msgInput').value = '';
    });

    $('#leaveBtn').addEventListener('click', () => {
      socket.emit('leave-room');
      try { socket.disconnect(); } catch(e){}
      window.location = './servers.html';
    });

    // optionally display server meta
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
    } catch(e){}
  }

  // Chat helpers
  function addChatMessage(m) {
    const area = $('#messages');
    if (!area) return;
    const d = createEl('div','msg');
    d.innerHTML = `<div class="meta">${escapeHtml(m.username)} • ${new Date(m.ts).toLocaleTimeString()}</div>
                   <div>${escapeHtml(m.text)}</div>`;
    area.appendChild(d);
    area.scrollTop = area.scrollHeight;
  }
  function addSystem(text) {
    const area = $('#messages');
    if (!area) return;
    const d = createEl('div','msg');
    d.innerHTML = `<div class="meta">[system]</div><div>${escapeHtml(text)}</div>`;
    area.appendChild(d);
    area.scrollTop = area.scrollHeight;
  }

  // public API
  return {
    initServers,
    initChat
  };
})(); // end ClientApp

