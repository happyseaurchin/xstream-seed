// XSTREAM KERNEL — SEED
// Fetches constitution from /kernels/active.md
// Vanilla JS, no dependencies

let state = {
  apiKey: localStorage.getItem('xstream_api_key') || '',
  apiKeyStored: !!localStorage.getItem('xstream_api_key'),
  messages: JSON.parse(localStorage.getItem('xstream_messages') || '[]'),
  constitution: null,
  kernelVersion: 'loading...',
  vapor: '',
  isThinking: false,
  turn: parseInt(localStorage.getItem('xstream_turn') || '0'),
};

// Fetch constitution on load
async function loadConstitution() {
  try {
    const res = await fetch('/kernels/active.md');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.constitution = await res.text();
    // Parse version from header
    const match = state.constitution.match(/^#\s+XSTREAM KERNEL\s+(v[\d.]+)/m);
    state.kernelVersion = match ? match[1] : 'unknown';
    // Parse environment
    const envMatch = state.constitution.match(/Environment:\s*(\w+)/m);
    const env = envMatch ? envMatch[1] : '';
    state.kernelVersion += env ? ` • ${env}` : '';
  } catch (e) {
    state.constitution = 'KERNEL LOAD FAILED. Operating without constitution. Error: ' + e.message;
    state.kernelVersion = 'ERROR';
  }
  render();
}

function saveMessages() {
  localStorage.setItem('xstream_messages', JSON.stringify(state.messages.slice(-50)));
  localStorage.setItem('xstream_turn', String(state.turn));
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function render() {
  const root = document.getElementById('root');
  root.innerHTML = `
    <div class="min-h-screen bg-gray-950 text-gray-100 font-mono">
      <div class="max-w-3xl mx-auto p-4">
        
        <header class="border-b border-gray-800 pb-3 mb-4">
          <div class="flex justify-between items-start">
            <div>
              <h1 class="text-lg text-cyan-400">◇ XSTREAM SEED</h1>
              <p class="text-gray-500 text-xs mt-1">KERNEL ${escapeHtml(state.kernelVersion)}</p>
            </div>
            <div class="text-right text-xs space-y-1">
              <div class="${state.apiKeyStored ? 'text-green-400' : 'text-yellow-400'}">
                ${state.apiKeyStored ? '● connected' : '○ API key needed'}
              </div>
              <div class="text-gray-600">turn ${state.turn}</div>
            </div>
          </div>
        </header>

        ${!state.apiKeyStored ? `
          <div class="bg-gray-900 border border-yellow-800/50 rounded p-4 mb-4">
            <p class="text-gray-400 text-sm mb-3">
              This kernel needs YOUR Claude API key to think. The key stays on your machine, 
              proxied only to Anthropic's API. Nothing is stored server-side.
            </p>
            <div class="flex gap-2">
              <input
                type="password"
                id="apiKeyInput"
                value="${escapeHtml(state.apiKey)}"
                placeholder="sk-ant-api03-..."
                class="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:border-cyan-700 focus:outline-none"
              />
              <button id="setupBtn"
                class="bg-cyan-900 hover:bg-cyan-800 px-4 py-2 rounded text-sm whitespace-nowrap">
                Connect
              </button>
            </div>
            <p class="text-gray-600 text-xs mt-2">
              Get a key at <a href="https://console.anthropic.com" target="_blank" class="text-cyan-700 hover:text-cyan-500">console.anthropic.com</a>
            </p>
          </div>
        ` : ''}

        <div class="space-y-3 mb-4 max-h-[55vh] overflow-y-auto" id="messages">
          ${state.messages.length === 0 && state.apiKeyStored ? `
            <div class="text-center text-gray-600 text-sm py-8">
              <p>Kernel loaded. Say something to begin.</p>
            </div>
          ` : ''}
          ${state.messages.map(msg => `
            <div class="p-3 rounded ${msg.from === 'kernel' 
              ? 'bg-gray-900 border-l-2 border-cyan-800' 
              : 'bg-gray-900/50 border-l-2 border-green-800'}">
              <div class="text-xs text-gray-500 mb-1">${msg.from === 'kernel' ? '◇ kernel' : '◆ you'}${msg.coord ? ` • coord ${msg.coord}` : ''}</div>
              <div class="text-sm whitespace-pre-wrap leading-relaxed">${escapeHtml(msg.content)}</div>
            </div>
          `).join('')}
          ${state.isThinking ? `
            <div class="p-3 bg-gray-900 border-l-2 border-yellow-800 rounded">
              <div class="text-xs text-yellow-400 animate-pulse">◇ thinking...</div>
            </div>
          ` : ''}
        </div>

        ${state.apiKeyStored ? `
          <div class="mb-4">
            <textarea
              id="vaporInput"
              placeholder="Speak to your kernel... (Enter to send, Shift+Enter for newline)"
              class="w-full bg-gray-900 border border-gray-700 rounded p-3 text-sm resize-none h-20 focus:border-cyan-700 focus:outline-none"
            >${escapeHtml(state.vapor)}</textarea>
            <div class="flex gap-2 mt-2">
              <button id="sendBtn" class="bg-cyan-900 hover:bg-cyan-800 px-4 py-2 rounded text-sm">Send</button>
              <button id="exportBtn" class="bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded text-sm text-gray-400">Export</button>
              <div class="flex-1"></div>
              <button id="clearBtn" class="bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded text-sm text-gray-500">Clear chat</button>
              <button id="resetBtn" class="bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded text-sm text-red-400/60">Reset key</button>
            </div>
          </div>
        ` : ''}

        <footer class="text-center text-xs text-gray-700 pt-4 border-t border-gray-900">
          <p>Your instance. Your key. Your resources.</p>
          <p class="mt-1">
            <a href="https://xstream.machus.ai" target="_blank" class="text-gray-600 hover:text-gray-400">about xstream</a>
            · <a href="https://xstream.onen.ai/dev-journey.html" target="_blank" class="text-gray-600 hover:text-gray-400">dev journey</a>
          </p>
        </footer>
      </div>
    </div>
  `;
  attachEvents();
  scrollMessages();
}

function scrollMessages() {
  const el = document.getElementById('messages');
  if (el) el.scrollTop = el.scrollHeight;
}

function attachEvents() {
  const apiInput = document.getElementById('apiKeyInput');
  const setupBtn = document.getElementById('setupBtn');
  const vaporInput = document.getElementById('vaporInput');
  const sendBtn = document.getElementById('sendBtn');
  const exportBtn = document.getElementById('exportBtn');
  const clearBtn = document.getElementById('clearBtn');
  const resetBtn = document.getElementById('resetBtn');

  if (apiInput) apiInput.addEventListener('input', (e) => { state.apiKey = e.target.value; });
  if (setupBtn) setupBtn.addEventListener('click', handleSetup);
  if (vaporInput) {
    vaporInput.addEventListener('input', (e) => { state.vapor = e.target.value; });
    vaporInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    });
  }
  if (sendBtn) sendBtn.addEventListener('click', handleSend);
  if (exportBtn) exportBtn.addEventListener('click', handleExport);
  if (clearBtn) clearBtn.addEventListener('click', handleClear);
  if (resetBtn) resetBtn.addEventListener('click', handleReset);
}

function handleSetup() {
  if (!state.apiKey.trim()) return;
  if (!state.apiKey.startsWith('sk-ant-')) {
    alert('Invalid key format. Anthropic keys start with sk-ant-');
    return;
  }
  localStorage.setItem('xstream_api_key', state.apiKey);
  state.apiKeyStored = true;
  render();
}

// Pscale memory coordinate calculation
function getCoord(turn, base = 6) {
  const cycle = Math.floor((turn - 1) / base);
  const pos = ((turn - 1) % base) + 1;
  return (cycle * 10) + pos;
}

async function handleSend() {
  if (!state.vapor.trim() || state.isThinking) return;

  const userMessage = state.vapor;
  state.vapor = '';
  state.turn++;
  const userCoord = getCoord(state.turn);

  state.messages.push({ from: 'user', content: userMessage, coord: userCoord, ts: Date.now() });
  state.isThinking = true;
  saveMessages();
  render();

  const response = await callLLM(userMessage);

  state.turn++;
  const kernelCoord = getCoord(state.turn);
  state.messages.push({ from: 'kernel', content: response, coord: kernelCoord, ts: Date.now() });
  state.isThinking = false;
  saveMessages();
  render();
}

function handleExport() {
  const data = {
    kernel_version: state.kernelVersion,
    exported_at: new Date().toISOString(),
    turn_count: state.turn,
    messages: state.messages,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `xstream-seed-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function handleClear() {
  if (!confirm('Clear conversation? (API key kept)')) return;
  state.messages = [];
  state.turn = 0;
  saveMessages();
  render();
}

function handleReset() {
  if (!confirm('Reset everything? API key and conversation will be cleared.')) return;
  localStorage.removeItem('xstream_api_key');
  localStorage.removeItem('xstream_messages');
  localStorage.removeItem('xstream_turn');
  state.apiKey = '';
  state.apiKeyStored = false;
  state.messages = [];
  state.turn = 0;
  render();
}

async function callLLM(userMessage) {
  // Build message history (last 20 messages for context)
  const history = state.messages.slice(-20).map(m => ({
    role: m.from === 'kernel' ? 'assistant' : 'user',
    content: m.content
  }));
  history.push({ role: 'user', content: userMessage });

  try {
    const response = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': state.apiKey },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: state.constitution || 'Kernel constitution failed to load.',
        messages: history,
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return `Error (${response.status}): ${err}`;
    }

    const data = await response.json();
    return data.content?.[0]?.text || 'No response generated.';
  } catch (error) {
    return `Connection error: ${error.message}`;
  }
}

// Boot
loadConstitution();
render();
