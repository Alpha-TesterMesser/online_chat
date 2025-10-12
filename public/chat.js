// public/chat.js
const socket = io();

const loginSection = document.getElementById('loginSection');
const chatSection = document.getElementById('chatSection');
const usernameInput = document.getElementById('usernameInput');
const enterBtn = document.getElementById('enterBtn');

const messagesEl = document.getElementById('messages');
const msgForm = document.getElementById('msgForm');
const msgInput = document.getElementById('msgInput');

let myUsername = null;

function addMessage(message, isSystem = false) {
  const div = document.createElement('div');
  div.className = 'message';
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = isSystem ? `[system] ${message}` : `${message.username} • ${new Date(message.ts).toLocaleTimeString()}`;
  const text = document.createElement('div');
  text.className = 'text';
  text.textContent = isSystem ? '' : message.text;

  if (isSystem) {
    div.textContent = message;
  } else {
    div.appendChild(meta);
    div.appendChild(text);
  }

  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

enterBtn.addEventListener('click', () => {
  const val = usernameInput.value.trim();
  myUsername = val || 'Anonymous';
  socket.emit('set-username', myUsername);
  loginSection.classList.add('hidden');
  chatSection.classList.remove('hidden');
  msgInput.focus();
});

usernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') enterBtn.click();
});

msgForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const txt = msgInput.value.trim();
  if (!txt) return;
  socket.emit('chat-message', txt);
  msgInput.value = '';
});

socket.on('connect', () => {
  console.log('connected to server');
});

socket.on('history', (hist) => {
  // hist is array of messages
  messagesEl.innerHTML = '';
  hist.forEach(m => addMessage(m));
});

socket.on('chat-message', (msg) => {
  addMessage(msg);
});

socket.on('system', (msg) => {
  // small system notifications
  const d = document.createElement('div');
  d.className = 'message';
  d.style.background = '#fff7ed';
  d.textContent = `[system] ${msg}`;
  messagesEl.appendChild(d);
  messagesEl.scrollTop = messagesEl.scrollHeight;
});
