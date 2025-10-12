// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const xss = require('xss');

const app = express();
const server = http.createServer(app);

// If deploying behind proxy/loadbalancer set the correct CORS/origin as needed.
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const MAX_HISTORY = 200; // keep last 200 messages in memory

app.use(express.static('public'));

// In-memory message history (not persistent — fine for simple use)
let history = [];

// Utility: sanitize and limit length
function sanitizeText(text, maxLen = 1000) {
  if (!text) return '';
  let s = xss(String(text)).slice(0, maxLen);
  return s;
}

io.on('connection', (socket) => {
  console.log('client connected', socket.id);

  // send recent history
  socket.emit('history', history);

  // set username on socket (optional)
  socket.on('set-username', (username) => {
    username = sanitizeText(username, 50) || 'Anonymous';
    socket.data.username = username;
    socket.emit('system', `Username set to ${username}`);
  });

  socket.on('chat-message', (msg) => {
    const username = sanitizeText(socket.data.username || 'Anonymous', 50);
    const text = sanitizeText(msg, 1000);
    if (!text.trim()) return;

    const message = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2,8),
      username,
      text,
      ts: new Date().toISOString()
    };

    // push to history (with cap)
    history.push(message);
    if (history.length > MAX_HISTORY) history.shift();

    // broadcast to everyone
    io.emit('chat-message', message);
  });

  socket.on('disconnect', (reason) => {
    console.log('client disconnected', socket.id, reason);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
