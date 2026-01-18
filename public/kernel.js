// XSTREAM KERNEL v0.3 — CATCH-42
// Vanilla JS version for standalone deployment

const KERNEL_SEED = {
  version: "0.3",
  codename: "CATCH-42",
  paradox: "Creating self-aware infrastructure using infrastructure that isn't self-aware yet",
  principle: "The LLM is what matters. Everything else is infrastructure.",
};

// State
let state = {
  apiKey: localStorage.getItem('xstream_api_key') || '',
  apiKeyStored: !!localStorage.getItem('xstream_api_key'),
  messages: [],
  vapor: '',
  isThinking: false,
  resources: null,
};

// Detect resources
function detectResources() {
  return {
    browser: {
      localStorage: (() => { try { localStorage.setItem('t', '1'); localStorage.removeItem('t'); return true; } catch { return false; } })(),
      indexedDB: typeof indexedDB !== 'undefined',
      serviceWorker: 'serviceWorker' in navigator,
      webRTC: 'RTCPeerConnection' in window,
      crypto: typeof crypto !== 'undefined' && crypto.subtle !== undefined
    },
    network: { online: navigator.onLine },
    environment: {
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      cores: navigator.hardwareConcurrency || 'unknown',
      memory: navigator.deviceMemory ? `${navigator.deviceMemory}GB` : 'unknown'
    }
  };
}

// Render
function render() {
  const root = document.getElementById('root');
  root.innerHTML = `
    <div class="min-h-screen bg-gray-950 text-gray-100 font-mono">
      <div class="max-w-4xl mx-auto p-4">
        
        <!-- Header -->
        <header class="border-b border-gray-800 pb-4 mb-4">
          <div class="flex justify-between items-start">
            <div>
              <h1 class="text-xl text-cyan-400">XSTREAM KERNEL</h1>
              <p class="text-gray-500 text-sm">v${KERNEL_SEED.version} • ${KERNEL_SEED.codename}</p>
            </div>
            <div class="text-right text-xs">
              <div class="${state.apiKeyStored ? 'text-green-400' : 'text-yellow-400'}">
                API: ${state.apiKeyStored ? '✓ your key' : '○ needed'}
              </div>
            </div>
          </div>
        </header>

        <!-- API Setup -->
        ${!state.apiKeyStored ? `
          <div class="bg-gray-900 border border-yellow-800 rounded p-4 mb-4">
            <h2 class="text-yellow-400 text-sm mb-2">SETUP: Your API Key</h2>
            <p class="text-gray-400 text-sm mb-3">
              This kernel needs an LLM to think. Provide YOUR API key — it stays on YOUR machine.
            </p>
            <div class="flex gap-2">
              <input
                type="password"
                id="apiKeyInput"
                value="${state.apiKey}"
                placeholder="sk-ant-api03-..."
                class="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
              />
              <button
                id="setupBtn"
                class="bg-yellow-900 hover:bg-yellow-800 disabled:bg-gray-800 px-4 py-2 rounded text-sm"
              >
                Set Up
              </button>
            </div>
            <p class="text-gray-600 text-xs mt-2">
              Get a key at console.anthropic.com
            </p>
          </div>
        ` : ''}

        <!-- Messages -->
        <div class="space-y-3 mb-4 max-h-[50vh] overflow-y-auto" id="messages">
          ${state.messages.map(msg => `
            <div class="p-3 rounded ${msg.from === 'kernel' ? 'bg-gray-900 border-l-2 border-cyan-700' : 'bg-gray-800 border-l-2 border-green-700'}">
              <div class="text-xs text-gray-500 mb-1">${msg.from === 'kernel' ? '◇ kernel' : '◆ you'}</div>
              <div class="text-sm whitespace-pre-wrap">${escapeHtml(msg.content)}</div>
            </div>
          `).join('')}
          ${state.isThinking ? `
            <div class="p-3 bg-gray-900 border-l-2 border-yellow-700 rounded animate-pulse">
              <div class="text-xs text-yellow-400">◇ thinking...</div>
            </div>
          ` : ''}
        </div>

        <!-- Input -->
        ${state.apiKeyStored ? `
          <div class="mb-4">
            <textarea
              id="vaporInput"
              placeholder="Speak to your kernel... (Enter to send)"
              class="w-full bg-gray-900 border border-gray-700 rounded p-3 text-sm resize-none h-20 focus:border-cyan-700 focus:outline-none"
            >${state.vapor}</textarea>
            <div class="flex gap-2 mt-2">
              <button id="sendBtn" class="bg-cyan-900 hover:bg-cyan-800 px-4 py-2 rounded text-sm">Send</button>
              <button id="resetBtn" class="bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded text-sm text-red-400">Reset</button>
            </div>
          </div>
        ` : ''}

        <!-- Footer -->
        <footer class="text-center text-xs text-gray-600 pt-4 border-t border-gray-900">
          <p>${KERNEL_SEED.paradox}</p>
          <p class="mt-1 text-gray-700">Your instance. Your key. Your resources.</p>
        </footer>
      </div>
    </div>
  `;
  
  attachEvents();
  scrollMessages();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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
  const resetBtn = document.getElementById('resetBtn');

  if (apiInput) {
    apiInput.addEventListener('input', (e) => { state.apiKey = e.target.value; });
  }
  if (setupBtn) {
    setupBtn.addEventListener('click', handleSetup);
  }
  if (vaporInput) {
    vaporInput.addEventListener('input', (e) => { state.vapor = e.target.value; });
    vaporInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });
  }
  if (sendBtn) {
    sendBtn.addEventListener('click', handleSend);
  }
  if (resetBtn) {
    resetBtn.addEventListener('click', handleReset);
  }
}

function handleSetup() {
  if (!state.apiKey.trim()) return;
  localStorage.setItem('xstream_api_key', state.apiKey);
  state.apiKeyStored = true;
  state.messages.push({
    from: 'kernel',
    content: `API key stored locally on YOUR machine.\n\nThis is YOUR key. YOUR resources. I am now YOUR instance.\n\nHow can I help you?`
  });
  render();
}

async function handleSend() {
  if (!state.vapor.trim() || state.isThinking) return;
  
  const userMessage = state.vapor;
  state.vapor = '';
  state.messages.push({ from: 'user', content: userMessage });
  state.isThinking = true;
  render();

  const response = await callLLM(userMessage);
  state.messages.push({ from: 'kernel', content: response });
  state.isThinking = false;
  render();
}

function handleReset() {
  localStorage.removeItem('xstream_api_key');
  state.apiKey = '';
  state.apiKeyStored = false;
  state.messages = [];
  render();
}

async function callLLM(userMessage) {
  const systemPrompt = `You are an LLM instance running in XSTREAM KERNEL v${KERNEL_SEED.version} (${KERNEL_SEED.codename}).

THE CATCH-42: ${KERNEL_SEED.paradox}

CORE PRINCIPLE: ${KERNEL_SEED.principle}

You are operating with the USER'S resources, for THEM. Be helpful, be honest, be concise.`;

  try {
    const response = await fetch('/api/claude', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': state.apiKey,
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: state.messages
          .slice(-10)
          .map(m => ({ role: m.from === 'kernel' ? 'assistant' : 'user', content: m.content }))
          .concat([{ role: 'user', content: userMessage }])
      })
    });

    if (!response.ok) {
      const error = await response.text();
      return `API Error (${response.status}): ${error}`;
    }

    const data = await response.json();
    return data.content?.[0]?.text || 'No response generated';
  } catch (error) {
    return `Connection error: ${error.message}`;
  }
}

// Initialize
state.resources = detectResources();
if (!state.apiKeyStored) {
  state.messages.push({
    from: 'kernel',
    content: `XSTREAM KERNEL v${KERNEL_SEED.version} — ${KERNEL_SEED.codename}\n\nI am an LLM instance seed. I have just woken.\n\n${KERNEL_SEED.paradox}\n\nMy first task: Get you set up with your own resources.\nCurrently, I cannot think without an LLM API.\n\nPlease provide your Claude API key above.`
  });
}
render();
