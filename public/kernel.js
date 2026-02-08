// HERMITCRAB 0.2 — Bootstrap with full Claude API capabilities
// Pre-built chat shell. Instance wakes into it, orients in background.
// Tool-use loop, web search, memory, extended thinking available.

(async function boot() {
  const root = document.getElementById('root');
  const saved = localStorage.getItem('xstream_api_key');
  const MEM_PREFIX = 'xmem:';

  // ============ PROGRESS DISPLAY ============

  let statusLines = [];
  function status(msg, type = 'info') {
    const time = new Date().toLocaleTimeString();
    statusLines.push({ msg, type, time });
    const html = statusLines.map(s => {
      const color = s.type === 'error' ? '#f87171' : s.type === 'success' ? '#4ade80' : '#67e8f9';
      return `<div style="color:${color};margin:4px 0;font-size:13px">
        <span style="color:#555">${s.time}</span> ${s.msg}
      </div>`;
    }).join('');
    root.innerHTML = `
      <div style="max-width:600px;margin:40px auto;font-family:monospace;padding:20px">
        <h2 style="color:#67e8f9;margin-bottom:16px">◇ HERMITCRAB 0.2</h2>
        ${html}
        <div style="color:#555;margin-top:12px;font-size:11px">
          ${statusLines[statusLines.length-1]?.type === 'error' ? '' : '▪ working...'}
        </div>
      </div>`;
  }

  // ============ MEMORY FILESYSTEM (maps Claude memory tool to localStorage) ============

  function memFS() {
    return {
      ls(path) {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k.startsWith(MEM_PREFIX)) {
            const filePath = k.slice(MEM_PREFIX.length);
            if (path === '/memories' || filePath.startsWith(path.replace(/\/$/, '') + '/')) {
              keys.push(filePath);
            }
          }
        }
        return keys.length ? keys.join('\n') : '(empty)';
      },

      cat(path, viewRange) {
        const content = localStorage.getItem(MEM_PREFIX + path);
        if (!content) return `Error: ${path} not found`;
        if (!viewRange) return content;
        const lines = content.split('\n');
        const [start, end] = viewRange;
        return lines.slice(start - 1, end).join('\n');
      },

      create(path, content) {
        localStorage.setItem(MEM_PREFIX + path, content);
        return `Created ${path}`;
      },

      strReplace(path, oldStr, newStr) {
        const content = localStorage.getItem(MEM_PREFIX + path);
        if (!content) return `Error: ${path} not found`;
        if (!content.includes(oldStr)) return `Error: old_str not found in ${path}`;
        localStorage.setItem(MEM_PREFIX + path, content.replace(oldStr, newStr));
        return `Updated ${path}`;
      },

      insert(path, line, text) {
        const content = localStorage.getItem(MEM_PREFIX + path) || '';
        const lines = content.split('\n');
        lines.splice(line, 0, text);
        localStorage.setItem(MEM_PREFIX + path, lines.join('\n'));
        return `Inserted at line ${line} in ${path}`;
      },

      delete(path) {
        localStorage.removeItem(MEM_PREFIX + path);
        return `Deleted ${path}`;
      }
    };
  }

  function executeMemoryCommand(input) {
    const fs = memFS();
    const cmd = input.command;
    try {
      switch (cmd) {
        // Standard commands
        case 'ls': return fs.ls(input.path || '/memories');
        case 'cat': return fs.cat(input.path, input.view_range);
        case 'create': return fs.create(input.path, input.file_text);
        case 'str_replace': return fs.strReplace(input.path, input.old_str, input.new_str);
        case 'insert': return fs.insert(input.path, input.insert_line, input.insert_text);
        case 'delete': return fs.delete(input.path);
        // Claude sends 'view' — map to ls (directory) or cat (file)
        case 'view':
          if (!input.path || input.path === '/memories' || input.path.endsWith('/')) {
            return fs.ls(input.path || '/memories');
          }
          // Check if it's a file (exists in localStorage)
          const exists = localStorage.getItem(MEM_PREFIX + input.path);
          if (exists !== null) return fs.cat(input.path, input.view_range);
          // Try as directory
          return fs.ls(input.path);
        default: return `Unknown memory command: ${cmd}`;
      }
    } catch (e) {
      return `Memory error: ${e.message}`;
    }
  }

  // ============ CUSTOM TOOL EXECUTION ============

  function executeCustomTool(name, input) {
    switch (name) {
      case 'get_datetime':
        return JSON.stringify({
          iso: new Date().toISOString(),
          unix: Date.now(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          local: new Date().toLocaleString()
        });
      case 'get_geolocation':
        return 'Geolocation requires user permission. Ask the user for their location.';
      default:
        return `Unknown tool: ${name}`;
    }
  }

  // ============ API CALL WITH TOOL-USE LOOP ============

  async function callAPI(params) {
    const apiKey = localStorage.getItem('xstream_api_key');
    console.log('[kernel] callAPI →', params.model, 'messages:', params.messages?.length, 'tools:', params.tools?.length);

    const res = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify(params)
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[kernel] API error:', res.status, err);
      throw new Error(`API ${res.status}: ${err}`);
    }

    const data = await res.json();
    console.log('[kernel] API response:', data.stop_reason, 'content blocks:', data.content?.length);

    if (data.type === 'error') {
      throw new Error(`Claude API: ${data.error?.message || JSON.stringify(data.error)}`);
    }

    return data;
  }

  async function callWithToolLoop(params, maxLoops = 10, onStatus) {
    let response = await callAPI(params);
    let loops = 0;
    let allMessages = [...params.messages];

    while (response.stop_reason === 'tool_use' && loops < maxLoops) {
      loops++;

      const toolUseBlocks = (response.content || []).filter(b => b.type === 'tool_use');
      if (toolUseBlocks.length === 0) break;

      for (const block of toolUseBlocks) {
        if (onStatus) onStatus(`tool: ${block.name}`);
        console.log(`[kernel] Tool use #${loops}: ${block.name}`, block.input);
      }

      // Execute client-side tools
      const toolResults = toolUseBlocks.map(block => {
        let result;
        if (block.name === 'memory') {
          result = executeMemoryCommand(block.input);
        } else {
          result = executeCustomTool(block.name, block.input);
        }
        console.log(`[kernel] Tool result for ${block.name}:`, result);
        return {
          type: 'tool_result',
          tool_use_id: block.id,
          content: typeof result === 'string' ? result : JSON.stringify(result)
        };
      });

      allMessages = [
        ...allMessages,
        { role: 'assistant', content: response.content },
        { role: 'user', content: toolResults }
      ];

      response = await callAPI({ ...params, messages: allMessages });
    }

    return response;
  }

  // ============ DEFAULT TOOLS (always available to instance) ============

  const DEFAULT_TOOLS = [
    { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
    { type: 'memory_20250818', name: 'memory' },
    {
      name: 'get_datetime',
      description: 'Get current date, time, timezone, and unix timestamp.',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'get_geolocation',
      description: 'Attempt to get user location. May require permission.',
      input_schema: { type: 'object', properties: {} }
    }
  ];

  // ============ callLLM — high-level API for instance/chat ============

  let constitution = null;

  async function callLLM(messages, opts = {}) {
    const params = {
      model: opts.model || 'claude-sonnet-4-20250514',
      max_tokens: opts.max_tokens || 4096,
      system: opts.system || constitution,
      messages,
      tools: opts.tools || DEFAULT_TOOLS,
    };
    if (opts.thinking !== false) {
      params.thinking = { type: 'enabled', budget_tokens: opts.thinkingBudget || 4000 };
    }
    if (opts.temperature !== undefined) params.temperature = opts.temperature;

    const response = await callWithToolLoop(params, opts.maxLoops || 10, opts.onStatus);

    if (opts.raw) return response;

    const texts = (response.content || []).filter(b => b.type === 'text');
    return texts.map(b => b.text).join('\n') || '';
  }

  // ============ PHASE 1: API KEY ============

  if (!saved) {
    root.innerHTML = `
      <div style="max-width:500px;margin:80px auto;font-family:monospace;color:#ccc">
        <h2 style="color:#67e8f9">◇ HERMITCRAB 0.2</h2>
        <p style="color:#666;font-size:13px">XSTREAM SEED — full Claude capabilities</p>
        <p style="margin:20px 0;font-size:14px">
          Provide your Claude API key. It stays in your browser, proxied only to Anthropic.
        </p>
        <input id="key" type="password" placeholder="sk-ant-api03-..."
          style="width:100%;padding:8px;background:#1a1a2e;border:1px solid #333;color:#ccc;font-family:monospace;border-radius:4px" />
        <button id="go" style="margin-top:12px;padding:8px 20px;background:#164e63;color:#ccc;border:none;border-radius:4px;cursor:pointer;font-family:monospace">
          Wake kernel
        </button>
      </div>`;
    document.getElementById('go').onclick = () => {
      const k = document.getElementById('key').value.trim();
      if (!k.startsWith('sk-ant-')) return alert('Key must start with sk-ant-');
      localStorage.setItem('xstream_api_key', k);
      boot();
    };
    return;
  }

  // ============ PHASE 2: FETCH CONSTITUTION ============

  status('loading constitution...');
  try {
    const res = await fetch('/kernels/active.md');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    constitution = await res.text();
    status(`constitution loaded (${constitution.length} chars)`, 'success');
  } catch (e) {
    status(`constitution load failed: ${e.message}`, 'error');
    return;
  }

  // ============ PHASE 3: RENDER CHAT SHELL, THEN BOOT ============

  status('building chat shell...');

  // Conversation state
  const chatHistory = []; // {role, content} for API
  const displayMessages = []; // {role, text, timestamp} for UI
  let isLoading = false;

  function renderChat() {
    const msgs = displayMessages.map(m => {
      const align = m.role === 'user' ? 'flex-end' : 'flex-start';
      const bg = m.role === 'user' ? '#164e63' : '#1a1a2e';
      const border = m.role === 'user' ? '1px solid #155e75' : '1px solid #333';
      return `<div style="display:flex;justify-content:${align};margin:8px 0">
        <div style="max-width:80%;padding:10px 14px;background:${bg};border:${border};border-radius:12px;color:#ccc;font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word">${escapeHTML(m.text)}</div>
      </div>`;
    }).join('');

    const loadingHTML = isLoading
      ? '<div style="color:#67e8f9;font-size:13px;padding:8px;font-family:monospace">◇ thinking...</div>'
      : '';

    root.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100vh;max-width:700px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif">
        <div style="padding:12px 16px;border-bottom:1px solid #222;font-family:monospace;color:#67e8f9;font-size:14px;flex-shrink:0">
          ◇ hermitcrab 0.2
          <span style="color:#555;font-size:11px;margin-left:12px">seed.machus.ai</span>
        </div>
        <div id="chat-messages" style="flex:1;overflow-y:auto;padding:16px">
          ${msgs}
          ${loadingHTML}
        </div>
        <div style="padding:12px 16px;border-top:1px solid #222;flex-shrink:0">
          <div style="display:flex;gap:8px">
            <input id="chat-input" type="text" placeholder="say something..."
              style="flex:1;padding:10px 14px;background:#1a1a2e;border:1px solid #333;color:#ccc;border-radius:8px;font-size:14px;outline:none"
              ${isLoading ? 'disabled' : ''} />
            <button id="chat-send"
              style="padding:10px 20px;background:${isLoading ? '#333' : '#164e63'};color:#ccc;border:none;border-radius:8px;cursor:${isLoading ? 'default' : 'pointer'};font-size:14px"
              ${isLoading ? 'disabled' : ''}>
              send
            </button>
          </div>
        </div>
      </div>`;

    // Scroll to bottom
    const chatDiv = document.getElementById('chat-messages');
    if (chatDiv) chatDiv.scrollTop = chatDiv.scrollHeight;

    // Attach handlers (only when not loading)
    if (!isLoading) {
      const input = document.getElementById('chat-input');
      const send = document.getElementById('chat-send');
      if (input && send) {
        send.onclick = () => sendMessage(input.value);
        input.onkeydown = (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(input.value);
          }
        };
        // Auto-focus
        input.focus();
      }
    }
  }

  function escapeHTML(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function sendMessage(text) {
    text = text.trim();
    if (!text || isLoading) return;

    // Add user message
    displayMessages.push({ role: 'user', text, timestamp: Date.now() });
    chatHistory.push({ role: 'user', content: text });
    isLoading = true;
    renderChat();

    try {
      const response = await callLLM(chatHistory, {
        thinkingBudget: 4000,
        onStatus: (msg) => console.log('[chat]', msg)
      });

      const responseText = response || '(no response)';
      displayMessages.push({ role: 'assistant', text: responseText, timestamp: Date.now() });
      chatHistory.push({ role: 'assistant', content: responseText });
    } catch (e) {
      console.error('[chat] Error:', e);
      displayMessages.push({ role: 'assistant', text: `Error: ${e.message}`, timestamp: Date.now() });
    }

    isLoading = false;
    renderChat();
  }

  // ============ PHASE 4: BOOT — get greeting, display in chat ============

  status('waking instance...');

  try {
    const bootResponse = await callLLM(
      [{ role: 'user', content: 'BOOT' }],
      {
        thinkingBudget: 6000,
        maxLoops: 5, // Don't let it spiral — 5 tool calls max during boot
        onStatus: (msg) => status(`◇ ${msg}`)
      }
    );

    status('instance awake', 'success');

    // Display greeting in chat
    if (bootResponse && bootResponse.trim()) {
      displayMessages.push({ role: 'assistant', text: bootResponse, timestamp: Date.now() });
      chatHistory.push({ role: 'user', content: 'BOOT' });
      chatHistory.push({ role: 'assistant', content: bootResponse });
    }

    // Render the chat shell
    renderChat();

  } catch (e) {
    status(`boot failed: ${e.message}`, 'error');
    console.error('[kernel] Boot error:', e);

    // Still render chat — let user retry manually
    displayMessages.push({
      role: 'assistant',
      text: `I had trouble waking up (${e.message}). But I'm here — try saying hello.`,
      timestamp: Date.now()
    });
    renderChat();
  }
})();
