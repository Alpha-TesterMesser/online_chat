// server.js
const express = require('express');
const cors = require('cors');
const xss = require('xss');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(cors()); // allow requests from GitHub Pages
app.use(express.json());

// --- In-memory store for servers (ephemeral) ---
/*
 server = {
   id: string,
   name: string,
   creator: string,
   tags: [string],
   hasPassword: boolean,
   password: string|null,
   occupancy: number,
   max: number,
   createdAt: number (ms),
   lastActivity: number (ms)
 }
*/
const servers = new Map();

// TTL: default 30 minutes; override with SERVER_TTL_MS env var
const TTL_MS = Number(process.env.SERVER_TTL_MS) || 30 * 60 * 1000;

// Helper: sanitize input
const sanitize = (s, max = 2000) => xss(String(s || '')).slice(0, max);

// create a simple id
const makeId = () => Date.now().toString(36) + Math.random().toString(36).slice(2,8);

// remove expired servers periodically
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, srv] of servers.entries()) {
    if (now - srv.lastActivity > TTL_MS) {
      servers.delete(id);
      changed = true;
      console.log(`Server ${id} expired and was removed (TTL)`);
    }
  }
  if (changed && io) {
    io.emit('servers-updated', serializeServers());
  }
}, 60 * 1000); // check every minute

// Helpers:
function serializeServers() {
  // send safe copy to clients (do not include plain password)
  return Array.from(servers.values()).map(s => ({
    id: s.id,
    name: s.name,
    creator: s.creator,
    tags: s.tags,
    hasPassword: s.hasPassword,
    occupancy: s.occupancy,
    max: s.max,
    createdAt: s.createdAt,
    lastActivity: s.lastActivity
  }));
}

// --- REST endpoints ---

// GET /servers -> list current servers
app.get('/servers', (req, res) => {
  res.json(serializeServers());
});

// POST /servers -> create a new server
app.post('/servers', (req, res) => {
  try {
    const name = sanitize(req.body.name || '').trim();
    const creator = sanitize(req.body.creator || 'Anonymous', 50);
    const tagsRaw = req.body.tags || '';
    const tags = String(tagsRaw).split(',').map(t => sanitize(t.trim(), 50)).filter(Boolean);
    const max = Math.max(1, Number(req.body.max) || 10);
    const password = req.body.password ? sanitize(req.body.password, 200) : null;

    if (!name) return res.status(400).json({ error: 'Server name required' });

    const id = makeId();
    const now = Date.now();
    const server = {
      id, name, creator, tags, hasPassword: Boolean(password), password,
      occupancy: 0, max, createdAt: now, lastActivity: now
    };
    servers.set(id, server);

    // notify all clients
    if (io) io.emit('servers-updated', serializeServers());
    console.log(`Server created: ${id} "${name}" by ${creator}`);
    return res.json({ ok: true, id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /join -> validate joining (checks only; actual occupancy handled at socket join)
app.post('/join', (req, res) => {
  try {
    const serverId = req.body.serverId;
    const password = req.body.password || '';
    const srv = servers.get(serverId);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    if (srv.hasPassword && srv.password !== String(password)) {
      return res.status(403).json({ error: 'Wrong password' });
    }
    if (srv.occupancy >= srv.max) {
      return res.status(403).json({ error: 'Server Full' });
    }
    // OK to proceed (we do NOT increment occupancy here to avoid leaking slots if socket fails).
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Serve static if desired (not necessary for GH pages)
// app.use(express.static('client'));

// start http + socket.io
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET','POST']
  }
});

// Socket.IO handlers
io.on('connection', (socket) => {
  console.log('Socket connected', socket.id);

  // When client requests current server list via socket
  socket.on('request-servers', () => {
    socket.emit('servers-updated', serializeServers());
  });

  // Client emits join-room after successful /join check
  socket.on('join-room', ({ serverId, username }) => {
    const srv = servers.get(serverId);
    if (!srv) {
      socket.emit('join-error', { error: 'Server not found' });
      return;
    }
    if (srv.occupancy >= srv.max) {
      socket.emit('join-error', { error: 'Server Full' });
      return;
    }

    // join the Socket.IO room
    socket.join(serverId);
    socket.data.serverId = serverId;
    socket.data.username = sanitize(username || 'Anonymous', 50);
    srv.occupancy = Math.min(srv.max, srv.occupancy + 1);
    srv.lastActivity = Date.now();

    // Notify room
    io.to(serverId).emit('system-message', {
      text: `${socket.data.username} joined`,
      ts: new Date().toISOString()
    });

    // Update all clients with latest server list
    io.emit('servers-updated', serializeServers());

    // Send ack to joining socket
    socket.emit('joined-ok', { serverId });
    console.log(`${socket.data.username} joined server ${serverId}`);
  });

  socket.on('send-message', ({ serverId, text }) => {
    const srv = servers.get(serverId);
    if (!srv) return;
    const cleanText = sanitize(text || '', 2000).trim();
    if (!cleanText) return;
    srv.lastActivity = Date.now();
    const payload = {
      username: socket.data.username || 'Anonymous',
      text: cleanText,
      ts: new Date().toISOString()
    };
    io.to(serverId).emit('chat-message', payload);
  });

  socket.on('leave-room', () => {
    const serverId = socket.data.serverId;
    if (!serverId) return;
    const srv = servers.get(serverId);
    if (srv) {
      srv.occupancy = Math.max(0, srv.occupancy - 1);
      srv.lastActivity = Date.now();
    }
    socket.leave(serverId);
    socket.data.serverId = null;
    io.emit('servers-updated', serializeServers());
  });

  socket.on('disconnect', () => {
    const serverId = socket.data.serverId;
    if (serverId) {
      const srv = servers.get(serverId);
      if (srv) {
        srv.occupancy = Math.max(0, srv.occupancy - 1);
        srv.lastActivity = Date.now();
      }
      io.emit('servers-updated', serializeServers());
      io.to(serverId).emit('system-message', {
        text: `${socket.data.username || 'A user'} left`,
        ts: new Date().toISOString()
      });
    }
    console.log('Socket disconnected', socket.id);
  });
});

// Start
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Chat backend listening on port ${PORT} (TTL_MS=${TTL_MS})`);
});
