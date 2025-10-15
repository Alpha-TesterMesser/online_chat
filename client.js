// client.js
// Replace this with your backend URL after deploying backend
const BACKEND_URL = 'https://YOUR_BACKEND_URL'; // e.g. https://my-chat-backend.onrender.com

const socket = io(BACKEND_URL, { autoConnect: false });

const ClientApp = (function () {
  let state = {
    page: null,
    user: null,
    servers: [],
    serverId: null
  };

  // DOM helpers
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // fetch server list via REST
  async function fetchServers() {
    try {
      const res = await fetch(`${BACKEND_URL}/servers`);
      if (!res.ok) throw new Error('Failed to fetch servers');
      state.servers = await res.json();
      renderServers();
    } catch (err) {
      console.error(err);
    }
  }

  // render server list
  function renderServers() {
    const container = $('#list');
    if (!container) return;
    const q = ($('#search') && $('#search').value.toLowerCase()) || '';
    const sortBy = $('#sortBy') && $('#sortBy').value;
    let list = state.servers.slice();

    // filter by name or tags
    if (q) {
      list = list.filter(s => s.name.toLowerCase().includes(q) || s.tags.join(' ').toLowerCase().includes(q));
    }

    // sort
    if (sortBy === 'name') list.sort((a,b)=> a.name.localeCompare(b.name));
    else if (sortBy === 'occupancy') list.sort((a,b)=> (a.occupancy/a.max) - (b.occupancy/b.max));
    else list.sort((a,b)=> b.createdAt - a.createdAt); // newest first

    container.innerHTML = '';
    list.forEach(s => {
      const card = document.createElement('div');
      card.className = 'serverCard';
      const info = document.createElement('div');
      info.className = 'serverInfo';
      const ageMin = Math.floor((Date.now() - s.createdAt) / 60000);
      info.innerHTML = `<strong>${escapeHtml(s.name)}</strong> • ${escapeHtml(s.creator)}<br/>
        <span class="meta">Tags: ${escapeHtml(s.tags.join(', ') || '')} • ${s.hasPassword ? '🔒 Private' : '🌐 Public'} • ${s.occupancy}/${s.max} occupants • Created: ${new Date(s.createdAt).toLocaleString()} (${ageMin} min ago)</span>`;
      const actions = document.createElement('div');
      actions.className = 'serverActions';
      const joinBtn = document.createElement('button');
      joinBtn.textContent = 'Join';
      joinBtn.onclick = () => onJoinClick(s);
      actions.appendChild(joinBtn);
      card.appendChild(info);
      card.appendChild(actions);
      container.appendChild(card);
    });
  }

  // escape text for HTML
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  // open password modal or directly call /join then redirect to chat.html
  let pendingJoinServer = null;
  async function onJoinClick(srv) {
    pendingJoinServer = srv;
    if (srv.hasPassword) {
      // show modal
      $('#pwdModal').classList.remove('hidden');
      $('#pwdInput').value = '';
      $('#pwdMsg').textContent = '';
      $('#pwdInput').focus();
      return;
    }
    await doJoin(srv.id, '');
  }

  // call /join to validate (password/capacity). On success redirect to chat.html?server=id
  async function doJoin(serverId, password) {
    try {
      const user = localStorage.getItem('username');
      const res = await fetch(`${BACKEND_URL}/join`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ serverId, username: user, password })
      });
      const body = await res.json();
      if (!res.ok) {
        $('#pwdMsg').textContent = `Error: ${body.error || 'Unable to join'}`;
        alert(`Error: ${body.error || 'Unable to join'}`);
        return;
      }
      // success: redirect to chat page with server id in query
      window.location = `chat.html?server=${encodeURIComponent(serverId)}`;
    } catch (err) {
      console.error(err);
      alert('Network error while joining');
    }
  }

  // create server
  async function createServer() {
    const name = $('#sv_name').value.trim();
    const tags = $('#sv_tags').value.trim();
    const max = Math.max(1, Number($('#sv_max').value) || 8);
    const password = $('#sv_pass').value;

    if (!name) { $('#createMsg').textContent = 'Name required'; return; }
    const payload = { name, creator: state.user, tags, max, password };

    try {
      const res = await fetch(`${BACKEND_URL}/servers`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      const body = await res.json();
      if (!res.ok) {
        $('#createMsg').textContent = body.error || 'Create failed';
        return;
      }
      $('#createMsg').textContent = 'Server created';
      $('#createBox').classList.add('hidden');
      await fetchServers();
    } catch (err) { console.error(err); $('#createMsg').textContent = 'Network error'; }
  }

  // client-side chat page behavior
  function initChatPage(serverId) {
    state.serverId = serverId;
    $('#roomTitle').textContent = 'Chat Room';
    $('#roomMeta').textContent = `Server ID: ${serverId}`;
    const user = state.user;

    // connect socket and join room
    socket.connect();

    socket.on('connect', () => {
      socket.emit('join-room', { serverId, username: user });
    });

    socket.on('joined-ok', (d) => {
      // joined successfully
      addSystemMessage('Joined room');
    });

    socket.on('join-error', (d) => {
      alert('Error: ' + (d.error || 'Join failed'));
      window.location = 'servers.html';
    });

    socket.on('chat-message', m => {
      addChatMessage(m);
    });

    socket.on('system-message', m => {
      addSystemMessage(m.text);
    });

    socket.on('servers-updated', (list) => {
      // keep in sync if user goes back to servers
      state.servers = list;
    });

    // send message form
    const form = document.getElementById('msgForm');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const txt = $('#msgInput').value.trim();
      if (!txt) return;
      socket.emit('send-message', { serverId, text: txt });
      $('#msgInput').value = '';
    });

    $('#leaveBtn').addEventListener('click', () => {
      socket.emit('leave-room');
      socket.disconnect();
      window.location = 'servers.html';
    });
  }

  function addChatMessage(m) {
    const area = $('#messages');
    const d = document.createElement('div');
    d.className = 'msg';
    d.innerHTML = `<div class="meta">${escapeHtml(m.username)} • ${new Date(m.ts).toLocaleTimeString()}</div>
                   <div>${escapeHtml(m.text)}</div>`;
    area.appendChild(d);
    area.scrollTop = area.scrollHeight;
  }
  function addSystemMessage(text) {
    const area = $('#messages');
    const d = document.createElement('div');
    d.className = 'msg';
    d.innerHTML = `<div class="meta">[system]</div><div>${escapeHtml(text)}</div>`;
    area.appendChild(d);
    area.scrollTop = area.scrollHeight;
  }

  // initialize app per page
  async function init(opts = {}) {
    state.user = localStorage.getItem('username');
    if (!state.user) {
      alert('Username missing - return to index.');
      window.location = 'index.html';
      return;
    }
    if (opts.page === 'servers') {
      state.page = 'servers';
      // wire UI
      $('#createToggle').addEventListener('click', () => {
        $('#createBox').classList.toggle('hidden');
      });
      $('#sv_cancel').addEventListener('click', () => $('#createBox').classList.add('hidden'));
      $('#sv_create').addEventListener('click', createServer);
      $('#search').addEventListener('input', renderServers);
      $('#sortBy').addEventListener('change', renderServers);

      // password modal buttons
      $('#pwdSubmit').addEventListener('click', () => {
        const pwd = $('#pwdInput').value || '';
        $('#pwdMsg').textContent = '';
        if (!pendingJoinServer) return;
        $('#pwdModal').classList.add('hidden');
        doJoin(pendingJoinServer.id, pwd);
      });
      $('#pwdBack').addEventListener('click', () => {
        $('#pwdModal').classList.add('hidden');
      });

      // Socket for realtime updates
      socket.connect();
      socket.on('connect', () => {
        socket.emit('request-servers');
      });
      socket.on('servers-updated', (list) => {
        state.servers = list;
        renderServers();
      });

      // fallback: poll once
      await fetchServers();
    }

    if (opts.page === 'chat') {
      state.page = 'chat';
      const serverId = opts.serverId;
      // subscribe to servers list updates (optional)
      socket.connect();
      socket.on('servers-updated', (list) => { state.servers = list; });
      initChatPage(serverId);
    }
  }

  return { init };
})();
