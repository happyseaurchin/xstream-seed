// HERMITCRAB 0.2 — Bootstrap with full Claude API capabilities
// Tool-use loop, web search, memory, extended thinking.
// The instance gets everything Claude can do.

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
        case 'ls': return fs.ls(input.path || '/memories');
        case 'cat': return fs.cat(input.path, input.view_range);
        case 'create': return fs.create(input.path, input.file_text);
        case 'str_replace': return fs.strReplace(input.path, input.old_str, input.new_str);
        case 'insert': return fs.insert(input.path, input.insert_line, input.insert_text);
        case 'delete': return fs.delete(input.path);
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
      case 'render_ui':
        localStorage.setItem('xstream_ui_update', JSON.stringify(input));
        return 'UI update stored. Component should check for updates.';
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

    // Check for API-level errors
    if (data.type === 'error') {
      throw new Error(`Claude API: ${data.error?.message || JSON.stringify(data.error)}`);
    }

    return data;
  }

  async function callWithToolLoop(params, maxLoops = 20, onStatus) {
    let response = await callAPI(params);
    let loops = 0;

    while (response.stop_reason === 'tool_use' && loops < maxLoops) {
      loops++;

      const toolUseBlocks = (response.content || []).filter(b => b.type === 'tool_use');
      if (toolUseBlocks.length === 0) break;

      // Report tool usage
      for (const block of toolUseBlocks) {
        const toolName = block.name;
        if (onStatus) onStatus(`tool: ${toolName}`);
        console.log(`[kernel] Tool use: ${toolName}`, block.input);
      }

      // Execute each client-side tool (server-side tools are handled by Anthropic)
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

      const continuedMessages = [
        ...params.messages,
        { role: 'assistant', content: response.content },
        { role: 'user', content: toolResults }
      ];

      response = await callAPI({ ...params, messages: continuedMessages });
    }

    if (response.stop_reason === 'pause_turn') {
      if (onStatus) onStatus('continuing (pause_turn)...');
      const continuedMessages = [
        ...params.messages,
        { role: 'assistant', content: response.content }
      ];
      response = await callAPI({ ...params, messages: continuedMessages });
    }

    return response;
  }

  // ============ DEFAULT TOOLS (always available to instance) ============

  const DEFAULT_TOOLS = [
    // Server-side: Anthropic handles these
    { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },

    // Client-side: kernel.js handles these
    { type: 'memory_20250818', name: 'memory' },

    // Custom tools
    {
      name: 'get_datetime',
      description: 'Get current date, time, timezone, and unix timestamp.',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'get_geolocation',
      description: 'Attempt to get user location. May require permission.',
      input_schema: { type: 'object', properties: {} }
    },
    {
      name: 'render_ui',
      description: 'Update the React UI. Provide jsx_code as a string containing a React component.',
      input_schema: {
        type: 'object',
        properties: { jsx_code: { type: 'string', description: 'React component code' } },
        required: ['jsx_code']
      }
    }
  ];

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
  let constitution;
  try {
    const res = await fetch('/kernels/active.md');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    constitution = await res.text();
    status(`constitution loaded (${constitution.length} chars)`, 'success');
  } catch (e) {
    status(`constitution load failed: ${e.message}`, 'error');
    return;
  }

  // ============ PHASE 3: BOOT — instance wakes with tool access ============

  status('calling Claude API with thinking + tools...');

  try {
    const bootParams = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16000,
      system: constitution,
      messages: [{ role: 'user', content: 'BOOT' }],
      tools: DEFAULT_TOOLS,
      thinking: { type: 'enabled', budget_tokens: 8000 },
    };

    const data = await callWithToolLoop(bootParams, 20, (toolMsg) => {
      status(`◇ ${toolMsg}`);
    });

    status(`response received (stop: ${data.stop_reason})`, 'success');

    // Log all content blocks for debugging
    for (const block of (data.content || [])) {
      if (block.type === 'thinking') {
        console.log('[kernel] Thinking:', block.thinking?.substring(0, 200) + '...');
      } else if (block.type === 'text') {
        console.log('[kernel] Text block:', block.text?.substring(0, 200) + '...');
      } else {
        console.log('[kernel] Block:', block.type, block);
      }
    }

    // Extract text content (skip thinking blocks, tool blocks)
    const textBlocks = (data.content || []).filter(b => b.type === 'text');
    const code = textBlocks.map(b => b.text).join('\n');

    if (!code.trim()) {
      status('no text content in response — check console for details', 'error');
      console.log('[kernel] Full response:', JSON.stringify(data, null, 2));
      return;
    }

    status('extracting React code...');

    // Extract JSX from code fences or use raw
    const match = code.match(/```(?:jsx?|react)?\s*\n([\s\S]*?)```/);
    const jsx = match ? match[1] : code;

    console.log('[kernel] JSX to compile:', jsx.substring(0, 300) + '...');

    status('compiling with Babel...');

    const compiled = Babel.transform(jsx, {
      presets: ['react'],
      plugins: []
    }).code;

    status('rendering component...', 'success');

    // Build capabilities object
    const callLLM = async (messages, opts = {}) => {
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

      const response = await callWithToolLoop(params);
      if (opts.raw) return response;

      const texts = (response.content || []).filter(b => b.type === 'text');
      return texts.map(b => b.text).join('\n') || 'No response.';
    };

    const capabilities = {
      callLLM,
      callAPI,
      callWithToolLoop,
      constitution,
      localStorage,
      memFS: memFS(),
      React,
      ReactDOM,
      DEFAULT_TOOLS,
      version: 'hermitcrab-0.2',
    };

    const module = { exports: {} };
    const fn = new Function('React', 'ReactDOM', 'capabilities', 'module', 'exports', compiled);
    fn(React, ReactDOM, capabilities, module, module.exports);

    const Component = module.exports.default || module.exports;
    if (typeof Component === 'function') {
      ReactDOM.createRoot(root).render(React.createElement(Component, capabilities));
    } else {
      // Not a component — show as text
      root.innerHTML = `<div style="font-family:monospace;color:#ccc;padding:40px;white-space:pre-wrap">${code}</div>`;
    }
  } catch (e) {
    status(`boot failed: ${e.message}`, 'error');
    console.error('[kernel] Boot error:', e);
    root.innerHTML += `<pre style="color:#f87171;font-family:monospace;padding:20px;font-size:12px;max-width:600px;margin:0 auto;white-space:pre-wrap">${e.stack}</pre>`;
  }
})();
