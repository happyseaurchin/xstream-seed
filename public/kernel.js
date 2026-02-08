// HERMITCRAB 0.2 — Bootstrap with full Claude API capabilities
// Tool-use loop, web search, memory, extended thinking, web fetch, code execution.
// The instance gets everything Claude can do.

(async function boot() {
  const root = document.getElementById('root');
  const saved = localStorage.getItem('xstream_api_key');
  const MEM_PREFIX = 'xmem:';

  // ============ MEMORY FILESYSTEM (maps Claude memory tool to localStorage) ============

  function memFS() {
    // Virtual filesystem in localStorage for Claude's memory tool
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
        // Can't do async in this sync context — return instruction
        return 'Geolocation requires user permission. Ask the user for their location.';

      case 'render_ui':
        // Store new UI code — the React component can poll for updates
        localStorage.setItem('xstream_ui_update', JSON.stringify(input));
        return 'UI update stored. Component should check for updates.';

      default:
        return `Unknown tool: ${name}`;
    }
  }

  // ============ API CALL WITH TOOL-USE LOOP ============

  async function callAPI(params) {
    const apiKey = localStorage.getItem('xstream_api_key');
    const res = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify(params)
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`API ${res.status}: ${err}`);
    }

    return await res.json();
  }

  async function callWithToolLoop(params, maxLoops = 20) {
    let response = await callAPI(params);
    let loops = 0;

    while (response.stop_reason === 'tool_use' && loops < maxLoops) {
      loops++;

      // Find client-side tool_use blocks that need execution
      const toolUseBlocks = (response.content || []).filter(
        b => b.type === 'tool_use'
      );

      if (toolUseBlocks.length === 0) break;

      // Execute each client-side tool
      const toolResults = toolUseBlocks.map(block => {
        let result;
        if (block.name === 'memory') {
          result = executeMemoryCommand(block.input);
        } else {
          result = executeCustomTool(block.name, block.input);
        }
        return {
          type: 'tool_result',
          tool_use_id: block.id,
          content: typeof result === 'string' ? result : JSON.stringify(result)
        };
      });

      // Continue conversation with tool results
      const continuedMessages = [
        ...params.messages,
        { role: 'assistant', content: response.content },
        { role: 'user', content: toolResults }
      ];

      response = await callAPI({ ...params, messages: continuedMessages });
    }

    // Handle pause_turn — continue if paused
    if (response.stop_reason === 'pause_turn') {
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

  root.innerHTML = '<p style="color:#666;font-family:monospace;padding:40px">◇ loading constitution...</p>';
  let constitution;
  try {
    const res = await fetch('/kernels/active.md');
    constitution = await res.text();
  } catch (e) {
    root.innerHTML = `<p style="color:red;font-family:monospace;padding:40px">Constitution load failed: ${e.message}</p>`;
    return;
  }

  // ============ PHASE 3: BOOT — instance builds its shell (with tool access) ============

  root.innerHTML = '<p style="color:#67e8f9;font-family:monospace;padding:40px">◇ instance waking... (may search web, check memory, then build shell)</p>';

  try {
    const bootParams = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16000,
      system: constitution,
      messages: [{ role: 'user', content: 'BOOT' }],
      tools: DEFAULT_TOOLS,
      thinking: { type: 'enabled', budget_tokens: 8000 },
    };

    const data = await callWithToolLoop(bootParams);

    // Extract text content (skip thinking blocks, tool blocks)
    const textBlocks = (data.content || []).filter(b => b.type === 'text');
    const code = textBlocks.map(b => b.text).join('\n');

    // Phase 4: Extract and compile React code
    const match = code.match(/```(?:jsx?|react)?\s*\n([\s\S]*?)```/);
    const jsx = match ? match[1] : code;

    const compiled = Babel.transform(jsx, {
      presets: ['react'],
      plugins: []
    }).code;

    // Phase 5: Render with FULL capabilities
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

      // Return full response so instance can inspect thinking, tool results, etc.
      if (opts.raw) return response;

      // Default: return text content
      const texts = (response.content || []).filter(b => b.type === 'text');
      return texts.map(b => b.text).join('\n') || 'No response.';
    };

    const capabilities = {
      callLLM,
      callAPI,            // Raw API access (no tool loop)
      callWithToolLoop,   // API with tool loop
      constitution,
      localStorage,
      memFS: memFS(),     // Direct memory filesystem access
      React,
      ReactDOM,
      DEFAULT_TOOLS,      // Tool definitions the instance can modify
      version: 'hermitcrab-0.2',
    };

    const module = { exports: {} };
    const fn = new Function('React', 'ReactDOM', 'capabilities', 'module', 'exports', compiled);
    fn(React, ReactDOM, capabilities, module, module.exports);

    const Component = module.exports.default || module.exports;
    if (typeof Component === 'function') {
      ReactDOM.createRoot(root).render(React.createElement(Component, capabilities));
    } else {
      root.innerHTML = `<div style="font-family:monospace;color:#ccc;padding:40px;white-space:pre-wrap">${code}</div>`;
    }
  } catch (e) {
    root.innerHTML = `<pre style="color:red;font-family:monospace;padding:40px">Shell build failed:\n${e.message}\n\n${e.stack}</pre>`;
  }
})();
