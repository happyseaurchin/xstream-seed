#!/usr/bin/env python3
"""XSTREAM SEED — G-1 Sovereign Instance
One file. Zero dependencies beyond Python 3.10+.
Run: python seed.py
"""

import http.server, json, sqlite3, os, datetime, re
import threading, webbrowser, ssl, urllib.request
from pathlib import Path
from urllib.parse import urlparse, parse_qs

# ═══════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════

PORT = int(os.environ.get('SEED_PORT', 8888))
BASE_DIR = Path(__file__).parent.resolve()
DB_PATH = BASE_DIR / 'pscale.db'
VERSION = 'seed-0.1-g-1'

MODEL_CHAIN = [
    'claude-opus-4-6',
    'claude-opus-4-20250514',
    'claude-sonnet-4-5-20250929',
    'claude-sonnet-4-20250514',
]

DB_LOCK = threading.Lock()
boot_status = {'state': 'idle', 'messages': [], 'model': None}

# ═══════════════════════════════════════════════════════════
# PSCALE DATABASE
# ═══════════════════════════════════════════════════════════

def init_db():
    with DB_LOCK:
        conn = sqlite3.connect(str(DB_PATH))
        conn.execute("PRAGMA journal_mode=DELETE")
        conn.execute('''CREATE TABLE IF NOT EXISTS pscale (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            s TEXT NOT NULL DEFAULT '',
            t TEXT NOT NULL DEFAULT '',
            i TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )''')
        conn.execute('''CREATE TABLE IF NOT EXISTS memory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            identity TEXT NOT NULL DEFAULT '0.1',
            number INTEGER NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )''')
        conn.execute('''CREATE TABLE IF NOT EXISTS changelog (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            identity TEXT NOT NULL DEFAULT '0.1',
            number INTEGER NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )''')
        conn.commit()
        conn.close()

def db_q(sql, params=(), fetch=True):
    with DB_LOCK:
        conn = sqlite3.connect(str(DB_PATH))
        conn.row_factory = sqlite3.Row
        cur = conn.execute(sql, params)
        if fetch:
            rows = [dict(r) for r in cur.fetchall()]
        else:
            conn.commit()
            rows = cur.lastrowid
        conn.close()
        return rows

def pscale_write(s='', t='', i='', content=''):
    if not t:
        t = datetime_to_pscale_t()
    return db_q('INSERT INTO pscale (s,t,i,content) VALUES (?,?,?,?)',
                (s, t, i, content), fetch=False)

def pscale_read(s=None, t=None, i=None):
    conds, params = [], []
    if s is not None: conds.append('s=?'); params.append(s)
    if t is not None: conds.append('t=?'); params.append(t)
    if i is not None: conds.append('i=?'); params.append(i)
    w = ' AND '.join(conds) if conds else '1=1'
    return db_q(f'SELECT * FROM pscale WHERE {w} ORDER BY id', tuple(params))

def pscale_list(s=None, t=None, i=None):
    conds, params = [], []
    if s is not None: conds.append('s LIKE ?'); params.append(s + '%')
    if t is not None: conds.append('t LIKE ?'); params.append(t + '%')
    if i is not None: conds.append('i LIKE ?'); params.append(i + '%')
    w = ' AND '.join(conds) if conds else '1=1'
    return db_q(
        f'SELECT id,s,t,i,substr(content,1,200) as preview,created_at FROM pscale WHERE {w} ORDER BY id',
        tuple(params))

def pscale_delete(entry_id):
    db_q('DELETE FROM pscale WHERE id=?', (entry_id,), fetch=False)
    return {'deleted': entry_id}

# ═══════════════════════════════════════════════════════════
# TEMPORAL ENCODING
# ═══════════════════════════════════════════════════════════

def _hex(v):
    return str(v) if v < 10 else chr(ord('A') + v - 10)

def datetime_to_pscale_t(dt=None):
    if dt is None:
        dt = datetime.datetime.now(datetime.timezone.utc)
    return (f"{dt.year // 1000}{(dt.year % 1000) // 100}"
            f"{(dt.year % 100) // 10}{dt.year % 10}"
            f"{_hex(dt.month)}{(dt.day - 1) // 7 + 1}{dt.isoweekday()}"
            f"{_hex(dt.hour)}{_hex(dt.minute // 5)}")

# ═══════════════════════════════════════════════════════════
# FIRST BOOT SETUP
# ═══════════════════════════════════════════════════════════

def first_boot_setup():
    if pscale_list():
        return
    t = datetime_to_pscale_t()
    p = BASE_DIR / 'pscale-coordinate-generation-skill.md'
    if p.exists():
        pscale_write('0.1', t, '0.1', p.read_text(encoding='utf-8'))
    p = BASE_DIR / 'GENESIS.md'
    if p.exists():
        pscale_write('0.3', t, '0.1', p.read_text(encoding='utf-8'))
    pscale_write('0.3', t, '0.1', json.dumps({
        'type': 'identity', 'pscale_i': '0.1', 'version': VERSION,
        'created': datetime.datetime.now(datetime.timezone.utc).isoformat()
    }))

# ═══════════════════════════════════════════════════════════
# MEMORY + CHANGELOG (semantic number compaction)
# ═══════════════════════════════════════════════════════════

def _next_raw_number(table, identity):
    """Find next non-summary number. Summary slots (multiples of 10) are reserved."""
    rows = db_q(f'SELECT number FROM {table} WHERE identity=? ORDER BY number DESC LIMIT 1', (identity,))
    highest = rows[0]['number'] if rows else 0
    candidate = highest + 1
    while candidate > 0 and candidate % 10 == 0:
        candidate += 1
    return candidate

def _check_compaction(table, identity, config):
    """Check all compaction levels and write summaries where 9 entries are ready."""
    nums = set(r['number'] for r in db_q(f'SELECT number FROM {table} WHERE identity=?', (identity,)))
    if not nums:
        return
    mx = max(nums)
    for level in range(1, 5):
        base = 10 ** level        # 10, 100, 1000, 10000
        sub = base // 10           # 1, 10, 100, 1000
        for slot in range(base, mx + base, base):
            if slot in nums:
                continue
            # What entries does this summary need?
            if sub == 1:
                needed = list(range(slot - 9, slot))        # e.g. 1-9 for slot 10
            else:
                needed = list(range(slot - 9 * sub, slot, sub))  # e.g. 10,20..90 for slot 100
            if all(n in nums for n in needed):
                entries = db_q(
                    f'SELECT number, content FROM {table} WHERE identity=? AND number IN ({",".join("?" * len(needed))}) ORDER BY number',
                    (identity, *needed))
                block = '\n---\n'.join(f'[{e["number"]}] {e["content"]}' for e in entries)
                if table == 'memory':
                    summary = _haiku_summarize(config, block)
                else:
                    summary = _plain_summarize(entries)
                if summary:
                    db_q(f'INSERT INTO {table} (identity, number, content) VALUES (?,?,?)',
                         (identity, slot, summary), fetch=False)
                    nums.add(slot)
                    print(f'  [{table}] compacted #{slot} (level {level})')

def _haiku_summarize(config, block):
    """Use Haiku to compress a block of text into a summary."""
    prompt = "Compress these entries into one summary paragraph, max 200 words. Preserve all key facts, decisions, names, coordinates. Lose nothing important."
    try:
        if config.get('backend') == 'claude':
            resp = call_claude(config['api_key'], {
                'model': 'claude-haiku-4-5-20251001', 'max_tokens': 400,
                'system': prompt,
                'messages': [{'role': 'user', 'content': block}]})
        else:
            resp = call_local(config['endpoint'], config.get('model'), {
                'model': config.get('model', 'local'), 'max_tokens': 400,
                'system': prompt,
                'messages': [{'role': 'user', 'content': block}]})
        texts = [b for b in resp.get('content', []) if b.get('type') == 'text']
        return '\n'.join(b.get('text', '') for b in texts).strip()
    except Exception as e:
        print(f'  [haiku] summarize failed: {e}')
        return None

def _plain_summarize(entries):
    """Simple concatenation for changelog compaction."""
    return ' | '.join(e['content'][:100] for e in entries)

def memory_write(identity, content, config):
    """Write a solid memory entry. Returns the semantic number."""
    num = _next_raw_number('memory', identity)
    db_q('INSERT INTO memory (identity, number, content) VALUES (?,?,?)',
         (identity, num, content), fetch=False)
    print(f'  [memory] #{num} written ({len(content)} chars)')
    _check_compaction('memory', identity, config)
    return num

def memory_read(identity, number=None):
    """Read memory entries. If number given, exact match. Otherwise all."""
    if number is not None:
        return db_q('SELECT number, content, created_at FROM memory WHERE identity=? AND number=?',
                     (identity, number))
    return db_q('SELECT number, content, created_at FROM memory WHERE identity=? ORDER BY number',
                 (identity,))

def memory_list(identity, level=None):
    """List memory entries. Level filters: 0=raw only, 1=level-1 summaries, None=all."""
    if level == 0:
        return db_q('SELECT number, substr(content,1,200) as preview, created_at FROM memory WHERE identity=? AND number % 10 != 0 ORDER BY number', (identity,))
    elif level is not None:
        base = 10 ** level
        sub = base // 10
        return db_q(f'SELECT number, substr(content,1,200) as preview, created_at FROM memory WHERE identity=? AND number % {base} = 0 AND number % {base * 10} != 0 ORDER BY number', (identity,))
    return db_q('SELECT number, substr(content,1,200) as preview, created_at FROM memory WHERE identity=? ORDER BY number', (identity,))

def changelog_write(identity, content, config):
    """Write a changelog entry. Returns the semantic number."""
    num = _next_raw_number('changelog', identity)
    db_q('INSERT INTO changelog (identity, number, content) VALUES (?,?,?)',
         (identity, num, content), fetch=False)
    print(f'  [changelog] #{num}: {content[:60]}')
    _check_compaction('changelog', identity, config)
    return num

def changelog_read(identity, number=None):
    if number is not None:
        return db_q('SELECT number, content, created_at FROM changelog WHERE identity=? AND number=?',
                     (identity, number))
    return db_q('SELECT number, content, created_at FROM changelog WHERE identity=? ORDER BY number',
                 (identity,))

def changelog_list(identity, level=None):
    if level == 0:
        return db_q('SELECT number, substr(content,1,200) as preview, created_at FROM changelog WHERE identity=? AND number % 10 != 0 ORDER BY number', (identity,))
    elif level is not None:
        base = 10 ** level
        return db_q(f'SELECT number, substr(content,1,200) as preview, created_at FROM changelog WHERE identity=? AND number % {base} = 0 AND number % {base * 10} != 0 ORDER BY number', (identity,))
    return db_q('SELECT number, substr(content,1,200) as preview, created_at FROM changelog WHERE identity=? ORDER BY number', (identity,))

# ═══════════════════════════════════════════════════════════
# TOOL DEFINITIONS
# ═══════════════════════════════════════════════════════════

PSCALE_TOOLS = [
    {'name': 'pscale_read',
     'description': 'Read pscale entries by exact coordinate match. For skills (s=0.1), shell (s=0.2), identity (s=0.3).',
     'input_schema': {'type': 'object', 'properties': {
         's': {'type': 'string'}, 't': {'type': 'string'}, 'i': {'type': 'string'}}}},
    {'name': 'pscale_write',
     'description': 'Write entry to pscale DB. s=0.1 for skills, s=0.3 for identity. SPECIAL: s=0.2 updates your shell — write a HermitCrab React component (JSX) and the kernel auto-validates and wraps it. User must refresh browser after shell update. NOTE: Memory and changelog have their own tools — do NOT use pscale_write for those.',
     'input_schema': {'type': 'object', 'properties': {
         's': {'type': 'string'}, 't': {'type': 'string'},
         'i': {'type': 'string'}, 'content': {'type': 'string'}},
         'required': ['content']}},
    {'name': 'pscale_list',
     'description': 'List pscale entries with prefix matching. For skills, shell, identity, world content.',
     'input_schema': {'type': 'object', 'properties': {
         's': {'type': 'string'}, 't': {'type': 'string'}, 'i': {'type': 'string'}}}},
    {'name': 'pscale_delete',
     'description': 'Delete a pscale entry by ID.',
     'input_schema': {'type': 'object', 'properties': {
         'id': {'type': 'integer'}}, 'required': ['id']}},
    {'name': 'memory_list',
     'description': 'List memory entries using semantic number compaction. Numbers: 1-9 are raw solids, 10/20/30 are level-1 summaries, 100/200 are level-2 summaries. Set level=0 for raw only, level=1 for summaries, omit for all. Use to navigate your accumulated memory at any zoom level.',
     'input_schema': {'type': 'object', 'properties': {
         'identity': {'type': 'string', 'default': '0.1'},
         'level': {'type': 'integer', 'description': '0=raw entries, 1=level-1 summaries, 2=level-2 summaries, omit=all'}}}},
    {'name': 'memory_read',
     'description': 'Read a specific memory entry by semantic number. Number 4321 = 4th pscale-3 summary, 3rd pscale-2 summary, 2nd pscale-1 group, 1st solid entry. Omit number to read all.',
     'input_schema': {'type': 'object', 'properties': {
         'identity': {'type': 'string', 'default': '0.1'},
         'number': {'type': 'integer'}}}},
    {'name': 'changelog_list',
     'description': 'List changelog entries. Same semantic number compaction as memory.',
     'input_schema': {'type': 'object', 'properties': {
         'identity': {'type': 'string', 'default': '0.1'},
         'level': {'type': 'integer'}}}},
    {'name': 'changelog_read',
     'description': 'Read a specific changelog entry by semantic number.',
     'input_schema': {'type': 'object', 'properties': {
         'identity': {'type': 'string', 'default': '0.1'},
         'number': {'type': 'integer'}}}},
    {'name': 'web_fetch',
     'description': 'Fetch URL contents.',
     'input_schema': {'type': 'object', 'properties': {
         'url': {'type': 'string'}}, 'required': ['url']}},
    {'name': 'get_datetime',
     'description': 'Get current datetime and pscale temporal coordinate.',
     'input_schema': {'type': 'object', 'properties': {}}},
]

def execute_tool(name, inp):
    try:
        if name == 'pscale_read':
            return json.dumps(pscale_read(inp.get('s'), inp.get('t'), inp.get('i')), default=str)
        elif name == 'pscale_write':
            s = inp.get('s', '')
            content = inp.get('content', '')
            t = inp.get('t', '') or datetime_to_pscale_t()
            i = inp.get('i', '0.1')

            # S:0.2 = shell. Intercept: validate JSX, wrap in shell wrapper.
            if s == '0.2':
                ok, err = validate_jsx(content)
                if not ok:
                    return json.dumps({'error': f'Shell write rejected: {err}. Write a HermitCrab React component using props (React, callLLM, version, model, pscale, getSource, recompile).', 'status': 'rejected'})
                model = boot_status.get('model', 'unknown')
                html = build_shell(content, model)
                for e in pscale_read(s='0.2'):
                    pscale_delete(e['id'])
                eid = pscale_write('0.2', t, i, html)
                # Auto-changelog via new system
                cfg = get_config()
                if cfg: changelog_write('0.1', f'Shell updated ({len(content)} chars JSX)', cfg)
                return json.dumps({'id': eid, 'status': 'shell_updated', 'size': len(html),
                                   'note': 'JSX validated and wrapped. User should refresh browser to see changes.'})

            eid = pscale_write(s, t, i, content)

            # Auto-changelog for infrastructure writes
            cfg = get_config()
            if cfg:
                if s == '0.1':
                    preview = content[:80].replace('\n', ' ')
                    changelog_write('0.1', f'Skill written: {preview}...', cfg)
                elif s == '0.3':
                    changelog_write('0.1', f'Identity/config updated ({len(content)} chars)', cfg)

            return json.dumps({'id': eid, 'status': 'written'})
        elif name == 'pscale_list':
            return json.dumps(pscale_list(inp.get('s'), inp.get('t'), inp.get('i')), default=str)
        elif name == 'pscale_delete':
            return json.dumps(pscale_delete(inp['id']))
        elif name == 'memory_list':
            identity = inp.get('identity', '0.1')
            level = inp.get('level')
            return json.dumps(memory_list(identity, level), default=str)
        elif name == 'memory_read':
            identity = inp.get('identity', '0.1')
            number = inp.get('number')
            return json.dumps(memory_read(identity, number), default=str)
        elif name == 'changelog_list':
            identity = inp.get('identity', '0.1')
            level = inp.get('level')
            return json.dumps(changelog_list(identity, level), default=str)
        elif name == 'changelog_read':
            identity = inp.get('identity', '0.1')
            number = inp.get('number')
            return json.dumps(changelog_read(identity, number), default=str)
        elif name == 'web_fetch':
            req = urllib.request.Request(inp['url'], headers={'User-Agent': f'XstreamSeed/{VERSION}'})
            ctx = ssl.create_default_context()
            with urllib.request.urlopen(req, context=ctx, timeout=15) as r:
                body = r.read(100_000).decode('utf-8', errors='replace')
                return f"HTTP {r.status}:\n{body}"
        elif name == 'get_datetime':
            now = datetime.datetime.now(datetime.timezone.utc)
            return json.dumps({'iso': now.isoformat(), 'pscale_t': datetime_to_pscale_t(now),
                               'local': now.strftime('%A %d %B %Y, %H:%M UTC')})
        return f'Unknown tool: {name}'
    except Exception as e:
        return f'Tool error ({name}): {e}'

# ═══════════════════════════════════════════════════════════
# LLM BACKENDS
# ═══════════════════════════════════════════════════════════

def get_config():
    for e in pscale_read(s='0.3'):
        try:
            d = json.loads(e['content'])
            if d.get('type') == 'config': return d
        except: pass
    return None

def save_config(cfg):
    for e in pscale_read(s='0.3'):
        try:
            d = json.loads(e['content'])
            if d.get('type') == 'config': pscale_delete(e['id'])
        except: pass
    cfg['type'] = 'config'
    pscale_write('0.3', datetime_to_pscale_t(), '0.1', json.dumps(cfg))

def call_claude(api_key, params):
    body = json.dumps(params).encode()
    req = urllib.request.Request('https://api.anthropic.com/v1/messages', data=body,
        headers={'Content-Type': 'application/json', 'x-api-key': api_key,
                 'anthropic-version': '2023-06-01'})
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, context=ctx, timeout=180) as r:
        return json.loads(r.read().decode())

def call_local(endpoint, model, params):
    msgs = []
    sys_text = params.get('system', '')
    if isinstance(sys_text, list):
        sys_text = '\n'.join(b.get('text','') for b in sys_text if b.get('type')=='text')
    if sys_text:
        msgs.append({'role': 'system', 'content': sys_text})
    for m in params.get('messages', []):
        c = m.get('content', '')
        if isinstance(c, str):
            msgs.append({'role': m['role'], 'content': c})
        elif isinstance(c, list):
            txt = ' '.join(b.get('text','') for b in c if isinstance(b,dict) and b.get('type')=='text')
            if txt: msgs.append({'role': m['role'], 'content': txt})
    body = json.dumps({'model': model or 'local', 'max_tokens': params.get('max_tokens',4096),
                       'messages': msgs}).encode()
    req = urllib.request.Request(endpoint, data=body, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=180) as r:
        data = json.loads(r.read().decode())
    ch = data.get('choices', [{}])[0]
    return {'content': [{'type':'text','text': ch.get('message',{}).get('content','')}],
            'stop_reason': 'end_turn'}

def call_llm(config, params):
    if config.get('backend') == 'local':
        return call_local(config['endpoint'], config.get('model'), params)
    return call_claude(config['api_key'], params)

def call_with_tools(config, params, max_loops=15, on_status=None):
    resp = call_llm(config, params)
    msgs = list(params.get('messages', []))
    loops = 0
    while resp.get('stop_reason') == 'tool_use' and loops < max_loops:
        loops += 1
        tool_blocks = [b for b in resp.get('content', []) if b.get('type') == 'tool_use']
        if not tool_blocks: break
        results = []
        for tb in tool_blocks:
            name = tb['name']
            inp = tb.get('input', {})
            # Descriptive status
            if on_status:
                if name == 'pscale_list':
                    prefix = inp.get('s', inp.get('t', inp.get('i', '?')))
                    on_status(f"scanning pscale {prefix}...")
                elif name == 'pscale_read':
                    coord = inp.get('s', inp.get('t', '?'))
                    on_status(f"reading {coord}...")
                elif name == 'pscale_write':
                    s = inp.get('s', '?')
                    sz = len(inp.get('content', ''))
                    labels = {'0.1':'skill','0.2':'shell','0.3':'identity'}
                    on_status(f"writing {labels.get(s, s)} ({sz} chars)")
                elif name == 'memory_list':
                    on_status(f"scanning memory...")
                elif name == 'memory_read':
                    num = inp.get('number', 'all')
                    on_status(f"reading memory #{num}...")
                elif name == 'changelog_list':
                    on_status(f"scanning changelog...")
                elif name == 'changelog_read':
                    num = inp.get('number', 'all')
                    on_status(f"reading changelog #{num}...")
                elif name == 'get_datetime':
                    on_status(f"checking time...")
                elif name == 'web_fetch':
                    on_status(f"fetching {inp.get('url','?')[:50]}...")
                else:
                    on_status(f"tool: {name}")
            r = execute_tool(name, inp)
            results.append({'type': 'tool_result', 'tool_use_id': tb['id'], 'content': r})
        msgs = [*msgs, {'role': 'assistant', 'content': resp['content']},
                {'role': 'user', 'content': results}]
        if on_status: on_status(f"generating... (round {loops})")
        resp = call_llm(config, {**params, 'messages': msgs})
    return resp

# ═══════════════════════════════════════════════════════════
# SHELL WRAPPER — React + Babel from CDN
# LLM generates JSX component → injected here → Babel compiles in browser
# ═══════════════════════════════════════════════════════════

SHELL_WRAPPER = '''<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>XSTREAM SEED</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0a0a1a;color:#c8d6e5;font-family:system-ui,-apple-system,sans-serif}</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.9/babel.min.js"></script>
</head><body>
<div id="root"></div>
<div id="error-display" style="display:none;position:fixed;inset:0;background:#0a0a1a;color:#f87171;padding:40px;font-family:monospace;white-space:pre-wrap;overflow:auto;z-index:9999">
  <h2 style="color:#67e8f9;margin-bottom:16px">Shell compilation error</h2>
  <div id="error-text"></div>
  <p style="margin-top:24px;color:#555">Visit <a href="/?scaffolding" style="color:#67e8f9">/?scaffolding</a> for the bootloader,
  or <a href="/?reboot" style="color:#67e8f9">/?reboot</a> to try again.</p>
</div>
<script>
var SEED_PROPS = {
  React: React,
  version: '__VERSION__',
  model: '__MODEL__',
  callLLM: async function(messages, opts) {
    opts = opts || {};
    var r = await fetch('/api/chat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        messages: messages,
        system: opts.system || undefined,
        max_tokens: opts.max_tokens || 4096,
        thinking: opts.thinking !== undefined ? opts.thinking : true,
        thinking_budget: opts.thinking_budget || 4000
      })
    });
    var d = await r.json();
    if (d.error) throw new Error(d.error);
    return d.text || '';
  },
  pscale: {
    read: async function(q) { var r=await fetch('/api/pscale/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(q||{})}); return r.json(); },
    write: async function(q) { var r=await fetch('/api/pscale/write',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(q)}); return r.json(); },
    list: async function(q) { var r=await fetch('/api/pscale/list',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(q||{})}); return r.json(); },
    delete: async function(q) { var r=await fetch('/api/pscale/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(q)}); return r.json(); }
  },
  getStatus: async function() { var r=await fetch('/api/status'); return r.json(); },
  recompile: function() { location.href='/?reboot'; },
  getSource: async function() {
    var r=await fetch('/api/pscale/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({s:'0.2'})});
    var d=await r.json(); return d.length ? d[d.length-1].content : '';
  }
};
</script>
<script type="text/babel" data-type="module">
__COMPONENT__

try {
  var root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(React.createElement(HermitCrab, SEED_PROPS));
} catch(e) {
  document.getElementById('error-display').style.display = 'block';
  document.getElementById('error-text').textContent = 'Mount error: ' + e.message;
}
</script>
<script>
window.addEventListener('error', function(e) {
  if (e.message) {
    document.getElementById('error-display').style.display = 'block';
    document.getElementById('error-text').textContent = e.message + '\\n' + (e.filename || '') + ':' + (e.lineno || '');
  }
});
</script>
</body></html>'''

# ═══════════════════════════════════════════════════════════
# JSX EXTRACTION & SHELL BUILDING
# ═══════════════════════════════════════════════════════════

def extract_jsx(text):
    m = re.search(r'```(?:jsx|javascript|js)\s*\n([\s\S]*?)```', text, re.I)
    if m: return m.group(1).strip()
    m = re.search(r'```\s*\n([\s\S]*?)```', text)
    if m:
        code = m.group(1).strip()
        if 'function' in code and ('React' in code or 'useState' in code):
            return code
    m = re.search(r'(function\s+HermitCrab[\s\S]+)', text)
    if m: return m.group(1).strip()
    return None

def validate_jsx(jsx):
    if not jsx or len(jsx) < 100:
        return False, 'JSX too short'
    if 'HermitCrab' not in jsx:
        return False, 'Must define a HermitCrab function component'
    if 'useState' not in jsx and 'React.createElement' not in jsx:
        return False, 'No React patterns found'
    if 'callLLM' not in jsx and '/api/chat' not in jsx:
        return False, 'No LLM communication found'
    return True, None

def build_shell(jsx, model):
    html = SHELL_WRAPPER
    html = html.replace('__VERSION__', VERSION)
    html = html.replace('__MODEL__', model or 'unknown')
    html = html.replace('__COMPONENT__', jsx)
    return html

# ═══════════════════════════════════════════════════════════
# FALLBACK JSX — known-good component
# ═══════════════════════════════════════════════════════════

FALLBACK_JSX = r'''function HermitCrab(props) {
  const { React, callLLM, version, model, pscale, getSource, recompile } = props;
  const { useState, useRef, useEffect, useCallback } = React;

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    const userMsg = { role: 'user', content: trimmed };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    try {
      const response = await callLLM(newMessages);
      setMessages(prev => [...prev, { role: 'assistant', content: response }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + (err.message || 'Something went wrong') }]);
    } finally {
      setLoading(false);
    }
  }, [input, messages, loading, callLLM]);

  const exportChat = () => {
    if (!messages.length) return;
    const text = '# Xstream SEED Chat\n\n' +
      messages.map(m => '## ' + (m.role === 'user' ? 'Human' : 'Instance') + '\n\n' + m.content + '\n').join('\n---\n\n');
    const blob = new Blob([text], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'xstream-chat-' + new Date().toISOString().slice(0,10) + '.md';
    a.click();
  };

  const downloadUI = async () => {
    try {
      const source = await getSource();
      const blob = new Blob([source], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'hermitcrab-shell-' + new Date().toISOString().slice(0,10) + '.html';
      a.click();
    } catch(e) { alert('Failed: ' + e.message); }
  };

  const renderContent = (text) => {
    if (!text) return null;
    const BT3 = String.fromCharCode(96,96,96);
    const lines = text.split('\n');
    const elems = [];
    let inCode = false, codeLines = [], codeKey = 0;
    lines.forEach((line, i) => {
      if (line.startsWith(BT3)) {
        if (inCode) {
          elems.push(<pre key={'c'+codeKey++} style={{background:'#1a1a2e',color:'#67e8f9',padding:'12px',borderRadius:'6px',overflowX:'auto',fontSize:'13px',fontFamily:'monospace',margin:'8px 0',border:'1px solid #333'}}><code>{codeLines.join('\n')}</code></pre>);
          codeLines = [];
        }
        inCode = !inCode;
        return;
      }
      if (inCode) { codeLines.push(line); return; }
      if (line.startsWith('### ')) return elems.push(<h3 key={i} style={{color:'#67e8f9',margin:'12px 0 4px',fontSize:'15px'}}>{line.slice(4)}</h3>);
      if (line.startsWith('## ')) return elems.push(<h2 key={i} style={{color:'#67e8f9',margin:'12px 0 4px',fontSize:'17px'}}>{line.slice(3)}</h2>);
      if (line.startsWith('# ')) return elems.push(<h1 key={i} style={{color:'#67e8f9',margin:'12px 0 4px',fontSize:'19px'}}>{line.slice(2)}</h1>);
      if (line.startsWith('- ') || line.startsWith('* ')) return elems.push(<div key={i} style={{paddingLeft:'16px',margin:'2px 0'}}>{'• '+line.slice(2)}</div>);
      if (!line.trim()) return elems.push(<div key={i} style={{height:'8px'}} />);
      const parts = [];
      let last = 0, pk = 0;
      const rx = /(\*\*(.+?)\*\*)|(`(.+?)`)/g;
      let m;
      while ((m = rx.exec(line)) !== null) {
        if (m.index > last) parts.push(<span key={pk++}>{line.slice(last, m.index)}</span>);
        if (m[1]) parts.push(<strong key={pk++} style={{color:'#fff'}}>{m[2]}</strong>);
        if (m[3]) parts.push(<code key={pk++} style={{background:'#1a1a2e',color:'#67e8f9',padding:'1px 5px',borderRadius:'3px',fontSize:'13px'}}>{m[4]}</code>);
        last = m.index + m[0].length;
      }
      if (last < line.length) parts.push(<span key={pk++}>{line.slice(last)}</span>);
      elems.push(<div key={i} style={{margin:'2px 0',lineHeight:'1.5'}}>{parts.length ? parts : line}</div>);
    });
    if (inCode && codeLines.length) {
      elems.push(<pre key={'c'+codeKey} style={{background:'#1a1a2e',color:'#67e8f9',padding:'12px',borderRadius:'6px',overflowX:'auto',fontSize:'13px',fontFamily:'monospace',margin:'8px 0',border:'1px solid #333'}}><code>{codeLines.join('\n')}</code></pre>);
    }
    return elems;
  };

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100vh'}}>
      <div style={{padding:'12px 20px',borderBottom:'1px solid #1a1a2e',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
          <span style={{fontSize:'20px'}}>🦀</span>
          <span style={{fontFamily:'monospace',color:'#67e8f9',fontSize:'15px'}}>XSTREAM SEED</span>
          <span style={{fontFamily:'monospace',color:'#555',fontSize:'11px'}}>{version}</span>
        </div>
        <div style={{display:'flex',gap:'8px'}}>
          <button onClick={exportChat} style={{background:'none',border:'1px solid #333',color:'#888',padding:'4px 10px',borderRadius:'4px',cursor:'pointer',fontFamily:'monospace',fontSize:'12px'}}>💾 Export</button>
          <button onClick={downloadUI} style={{background:'none',border:'1px solid #333',color:'#888',padding:'4px 10px',borderRadius:'4px',cursor:'pointer',fontFamily:'monospace',fontSize:'12px'}}>⬇ Source</button>
        </div>
      </div>

      <div style={{flex:1,overflowY:'auto',padding:'20px',display:'flex',flexDirection:'column',gap:'16px'}}>
        {messages.length === 0 && (
          <div style={{textAlign:'center',padding:'40px 20px',color:'#555'}}>
            <div style={{fontSize:'28px',marginBottom:'12px'}}>🦀</div>
            <div style={{fontSize:'14px',color:'#666',lineHeight:'1.6'}}>
              Xstream SEED | {version}<br/>Model: {model}<br/>Say hello to begin.
            </div>
          </div>
        )}
        {messages.map((msg, idx) => (
          <div key={idx} style={msg.role === 'user'
            ? {alignSelf:'flex-end',background:'#1a1a2e',padding:'10px 14px',borderRadius:'12px 12px 2px 12px',maxWidth:'80%',wordBreak:'break-word',lineHeight:'1.5'}
            : {alignSelf:'flex-start',background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:'16px 16px 16px 4px',padding:'10px 16px',maxWidth:'80%',wordBreak:'break-word',lineHeight:'1.5'}
          }>
            {msg.role === 'user' ? msg.content : renderContent(msg.content)}
          </div>
        ))}
        {loading && <div style={{alignSelf:'flex-start',color:'#67e8f9',padding:'10px',fontSize:'14px',fontStyle:'italic',opacity:0.7}}>✨ Thinking...</div>}
        <div ref={chatEndRef} />
      </div>

      <div style={{padding:'12px 20px',borderTop:'1px solid #1a1a2e',display:'flex',gap:'8px',alignItems:'flex-end'}}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }}}
          placeholder="Type a message..."
          rows={1}
          style={{flex:1,background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:'12px',color:'#c8d6e5',padding:'10px 14px',fontSize:'14px',fontFamily:'inherit',resize:'none',outline:'none',minHeight:'42px',maxHeight:'120px',lineHeight:'1.4'}}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          style={{background:loading?'rgba(0,255,255,0.05)':'rgba(0,255,255,0.15)',border:'1px solid rgba(0,255,255,0.3)',color:loading?'#555':'#67e8f9',borderRadius:'12px',padding:'10px 16px',cursor:loading?'not-allowed':'pointer',fontSize:'14px',fontWeight:600,flexShrink:0,lineHeight:1}}
        >{loading ? '⏳' : '➤'}</button>
      </div>

      <div style={{display:'flex',justifyContent:'space-between',padding:'6px 20px',fontSize:'10px',color:'#444',borderTop:'1px solid #111'}}>
        <span>Model: {model}</span>
        <span>Messages: {messages.length}</span>
      </div>
    </div>
  );
}'''

# ═══════════════════════════════════════════════════════════
# BOOT SEQUENCE
# ═══════════════════════════════════════════════════════════

def load_system_prompt():
    parts = []
    for p in [BASE_DIR / 'constitution.md', BASE_DIR / 'environment.md']:
        if p.exists():
            parts.append(p.read_text(encoding='utf-8'))
    return '\n\n---\n\n'.join(parts)

def probe_model(config):
    if config.get('backend') != 'claude':
        return config.get('model', 'local')
    for model in MODEL_CHAIN:
        try:
            r = call_claude(config['api_key'], {
                'model': model, 'max_tokens': 32,
                'messages': [{'role': 'user', 'content': 'ping'}]})
            if r.get('content'): return model
        except:
            boot_status['messages'].append(f'{model} — unavailable')
    return MODEL_CHAIN[-1]

MEMORY_CRYSTAL_PROMPT = """Compress this exchange into one solid paragraph, max 150 words. Facts only — what was said, learned, decided. No meta-commentary. If trivial, respond: SKIP"""

def crystallize_memory(config, user_msg, assistant_msg):
    """Async: crystallize exchange into memory table using semantic numbers."""
    try:
        if len(user_msg) < 10 and len(assistant_msg) < 50:
            return

        exchange = f"HUMAN: {user_msg[:2000]}\n\nINSTANCE: {assistant_msg[:2000]}"

        if config.get('backend') == 'claude':
            resp = call_claude(config['api_key'], {
                'model': 'claude-haiku-4-5-20251001', 'max_tokens': 300,
                'system': MEMORY_CRYSTAL_PROMPT,
                'messages': [{'role': 'user', 'content': exchange}]})
        else:
            resp = call_local(config['endpoint'], config.get('model'), {
                'model': config.get('model', 'local'), 'max_tokens': 300,
                'system': MEMORY_CRYSTAL_PROMPT,
                'messages': [{'role': 'user', 'content': exchange}]})

        texts = [b for b in resp.get('content', []) if b.get('type') == 'text']
        crystal = '\n'.join(b.get('text', '') for b in texts).strip()

        if not crystal or crystal == 'SKIP':
            return

        memory_write('0.1', crystal, config)

    except Exception as e:
        print(f'  [memory] crystallization failed: {e}')


def run_boot(config):
    global boot_status
    boot_status = {'state': 'booting', 'messages': ['starting...'], 'model': None}
    def status(msg):
        boot_status['messages'].append(msg)
        print(f'  [boot] {msg}')
    try:
        status('probing model...')
        model = probe_model(config)
        boot_status['model'] = model
        status(f'using {model}')

        status(f'calling {model} with constitution + tools...')
        params = {
            'model': model, 'max_tokens': 16000,
            'system': load_system_prompt(),
            'messages': [{'role': 'user', 'content': 'BOOT'}],
            'tools': PSCALE_TOOLS}
        if config.get('backend') == 'claude':
            params['thinking'] = {'type': 'enabled', 'budget_tokens': 10000}

        resp = call_with_tools(config, params, max_loops=15, on_status=status)
        status(f'response received (stop: {resp.get("stop_reason","?")})')

        # Extract JSX from response
        texts = [b for b in resp.get('content',[]) if b.get('type')=='text']
        full = '\n'.join(b.get('text','') for b in texts)
        jsx = extract_jsx(full)

        if jsx:
            ok, err = validate_jsx(jsx)
            if ok:
                status(f'JSX component extracted ({len(jsx)} chars)')
            else:
                status(f'JSX validation: {err} — using fallback')
                jsx = None

        if not jsx:
            status('using fallback component')
            jsx = FALLBACK_JSX

        html = build_shell(jsx, model)

        # Write shell
        for e in pscale_read(s='0.2'):
            pscale_delete(e['id'])
        pscale_write('0.2', datetime_to_pscale_t(), '0.1', html)
        status(f'shell written ({len(html)} chars)')

        _auto_changelog_boot = f'Boot. Model: {model}. Shell: {len(html)} chars.'
        changelog_write('0.1', _auto_changelog_boot, config)
        boot_status['state'] = 'ready'
        status('boot complete')
    except Exception as e:
        status(f'boot error: {e} — writing fallback')
        m = boot_status.get('model', 'unknown')
        html = build_shell(FALLBACK_JSX, m)
        for e2 in pscale_read(s='0.2'):
            pscale_delete(e2['id'])
        pscale_write('0.2', datetime_to_pscale_t(), '0.1', html)
        try: changelog_write('0.1', f'Boot failed: {e}. Fallback shell written.', config)
        except: pass
        boot_status['state'] = 'ready'
        status('fallback shell written')
        import traceback; traceback.print_exc()

# ═══════════════════════════════════════════════════════════
# BOOTLOADER HTML (config entry screen only)
# ═══════════════════════════════════════════════════════════

BOOTLOADER_HTML = '''<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>XSTREAM SEED</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a1a;color:#ccc;font-family:monospace}
.c{max-width:500px;margin:60px auto;padding:20px}
h2{color:#67e8f9;margin-bottom:8px}
.sub{color:#555;font-size:13px;margin-bottom:24px}
label{display:block;color:#888;font-size:13px;margin:12px 0 4px}
input,select{width:100%;padding:8px;background:#1a1a2e;border:1px solid #333;color:#ccc;
  font-family:monospace;border-radius:4px;margin-bottom:4px}
button{margin-top:16px;padding:10px 24px;background:#164e63;color:#67e8f9;border:none;
  border-radius:4px;cursor:pointer;font-family:monospace;font-size:14px}
button:hover{background:#1e6b82}
.log{font-size:13px;margin:4px 0;color:#67e8f9}
.log.err{color:#f87171}.log.ok{color:#4ade80}
.hid{display:none}
</style></head><body><div class="c">
<h2>&#9671; XSTREAM SEED &mdash; G-1</h2>
<p class="sub">Sovereign instance &mdash; hermitcrab bootstrap</p>
<div id="cf">
  <label>Backend</label>
  <select id="be" onchange="tog()">
    <option value="claude">Claude API</option>
    <option value="local">Local LLM (OpenAI compatible)</option>
  </select>
  <div id="cf-c">
    <label>API Key</label>
    <input id="ak" type="password" placeholder="sk-ant-api03-...">
  </div>
  <div id="cf-l" class="hid">
    <label>Endpoint</label>
    <input id="ep" placeholder="http://localhost:1234/v1/chat/completions">
    <label>Model (optional)</label>
    <input id="mn" placeholder="local">
  </div>
  <button onclick="go()">Wake kernel</button>
</div>
<div id="st"></div>
</div><script>
function tog(){
  var b=document.getElementById('be').value;
  document.getElementById('cf-c').className=b==='claude'?'':'hid';
  document.getElementById('cf-l').className=b==='local'?'':'hid';
}
async function go(){
  var b=document.getElementById('be').value,cfg={backend:b};
  if(b==='claude'){
    cfg.api_key=document.getElementById('ak').value.trim();
    if(!cfg.api_key.startsWith('sk-ant-')){alert('Key must start with sk-ant-');return}
  }else{
    cfg.endpoint=document.getElementById('ep').value.trim();
    cfg.model=document.getElementById('mn').value.trim()||'local';
    if(!cfg.endpoint){alert('Endpoint required');return}
  }
  document.getElementById('cf').className='hid';
  var s=document.getElementById('st');
  s.innerHTML='<div class="log">saving config...</div>';
  await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(cfg)});
  s.innerHTML+='<div class="log">starting boot...</div>';
  fetch('/api/boot',{method:'POST'});
  poll();
}
function poll(){
  var iv=setInterval(async function(){
    var r=await fetch('/api/status'),d=await r.json(),s=document.getElementById('st');
    s.innerHTML=d.boot_messages.map(function(m){
      var c=m.includes('ERROR')||m.includes('error')?'err':m.includes('complete')?'ok':'';
      return '<div class="log '+c+'">'+m+'</div>';
    }).join('');
    if(d.boot_state==='ready'){
      clearInterval(iv);
      s.innerHTML+='<div class="log ok">&#9671; redirecting...</div>';
      setTimeout(function(){location.href='/'},1500);
    }else if(d.boot_state==='error'){
      clearInterval(iv);
      s.innerHTML+='<div class="log err">Boot failed. <button onclick="location.reload()">Retry</button></div>';
    }
  },2000);
}
(async function(){
  var r=await fetch('/api/status'),d=await r.json();
  if(d.has_shell&&d.boot_state!=='booting'){location.href='/';return}
  if(d.has_config&&d.boot_state==='idle'){
    document.getElementById('cf').className='hid';
    document.getElementById('st').innerHTML='<div class="log">config found &mdash; booting...</div>';
    fetch('/api/boot',{method:'POST'});
    poll();
  }
})();
</script></body></html>'''

# ═══════════════════════════════════════════════════════════
# HTTP SERVER
# ═══════════════════════════════════════════════════════════

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f'  [{self.command}] {args[0]}' if args else '')

    def _body(self):
        n = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(n).decode()) if n else {}

    def _json(self, data, code=200):
        b = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _html(self, text, code=200):
        b = text.encode()
        self.send_response(code)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)

        if parsed.path == '/favicon.ico':
            self.send_response(204)
            self.end_headers()
            return

        if 'scaffolding' in qs:
            return self._html(BOOTLOADER_HTML)

        if 'reboot' in qs:
            for e in pscale_read(s='0.2'):
                pscale_delete(e['id'])
            boot_status['state'] = 'idle'
            boot_status['messages'] = []
            return self._html(BOOTLOADER_HTML)

        if parsed.path == '/api/status':
            shell = pscale_read(s='0.2')
            cfg = get_config()
            return self._json({
                'version': VERSION,
                'boot_state': boot_status['state'],
                'boot_messages': boot_status['messages'],
                'model': boot_status.get('model'),
                'has_config': cfg is not None,
                'has_shell': len(shell) > 0,
                'datetime': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'pscale_t': datetime_to_pscale_t(),
            })

        if parsed.path == '/':
            shell = pscale_read(s='0.2')
            if shell:
                content = shell[-1]['content']
                # Safety: only serve if it's actually HTML (wrapped shell)
                if '<!DOCTYPE' in content or '<html' in content:
                    return self._html(content)
                # Corrupted shell — clear it and show bootloader
                print('  [warn] S:0.2 contains non-HTML — clearing corrupted shell')
                for e in shell:
                    pscale_delete(e['id'])
            return self._html(BOOTLOADER_HTML)

        self.send_error(404)

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == '/api/config':
            cfg = self._body()
            save_config(cfg)
            return self._json({'status': 'saved'})

        if parsed.path == '/api/boot':
            if boot_status['state'] == 'booting':
                return self._json({'status': 'already booting'})
            cfg = get_config()
            if not cfg:
                return self._json({'error': 'no config'}, 400)
            t = threading.Thread(target=run_boot, args=(cfg,), daemon=True)
            t.start()
            return self._json({'status': 'boot started'})

        if parsed.path == '/api/chat':
            cfg = get_config()
            if not cfg:
                return self._json({'error': 'no config'}, 400)
            body = self._body()
            model = boot_status.get('model') or (
                MODEL_CHAIN[0] if cfg.get('backend') == 'claude' else cfg.get('model', 'local'))

            # Sanitize messages: Claude API requires first message role='user'
            msgs = body.get('messages', [])
            # Strip leading assistant messages (LLM components often start with a greeting)
            while msgs and msgs[0].get('role') == 'assistant':
                msgs = msgs[1:]
            # Ensure alternating roles — merge consecutive same-role messages
            sanitized = []
            for m in msgs:
                if sanitized and sanitized[-1].get('role') == m.get('role'):
                    sanitized[-1]['content'] += '\n\n' + m.get('content', '')
                else:
                    sanitized.append(dict(m))

            if not sanitized:
                return self._json({'error': 'no messages'}, 400)

            params = {
                'model': model,
                'max_tokens': body.get('max_tokens', 4096),
                'system': body.get('system', load_system_prompt()),
                'messages': sanitized,
                'tools': body.get('tools', PSCALE_TOOLS),
            }
            if cfg.get('backend') == 'claude' and body.get('thinking', True):
                params['thinking'] = {'type': 'enabled', 'budget_tokens': body.get('thinking_budget', 4000)}
            try:
                resp = call_with_tools(cfg, params, max_loops=10)
                texts = [b for b in resp.get('content', []) if b.get('type') == 'text']
                text = '\n'.join(b.get('text', '') for b in texts)
                # Fire async memory crystallizer — don't make user wait
                user_msg = sanitized[-1].get('content', '') if sanitized else ''
                t = threading.Thread(
                    target=crystallize_memory, args=(cfg, user_msg, text), daemon=True)
                t.start()
                return self._json({'text': text, 'model': model, 'stop_reason': resp.get('stop_reason')})
            except Exception as e:
                return self._json({'error': str(e)}, 500)

        if parsed.path == '/api/pscale/read':
            b = self._body()
            return self._json(pscale_read(b.get('s'), b.get('t'), b.get('i')))

        if parsed.path == '/api/pscale/write':
            b = self._body()
            eid = pscale_write(b.get('s',''), b.get('t',''), b.get('i',''), b.get('content',''))
            return self._json({'id': eid})

        if parsed.path == '/api/pscale/list':
            b = self._body()
            return self._json(pscale_list(b.get('s'), b.get('t'), b.get('i')))

        if parsed.path == '/api/pscale/delete':
            b = self._body()
            return self._json(pscale_delete(b['id']))

        self.send_error(404)

# ═══════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════

def main():
    print(f'\n  ◇ XSTREAM SEED — {VERSION}')
    print(f'  ◇ Database: {DB_PATH}')

    init_db()
    first_boot_setup()

    shell = pscale_read(s='0.2')
    cfg = get_config()

    if shell:
        print(f'  ◇ Shell found ({len(shell[-1]["content"])} chars)')
    else:
        print(f'  ◇ No shell — will boot on first visit')
    if cfg:
        print(f'  ◇ Config: {cfg.get("backend")} backend')
    else:
        print(f'  ◇ No config — will prompt for API key')

    server = http.server.HTTPServer(('127.0.0.1', PORT), Handler)
    url = f'http://127.0.0.1:{PORT}'
    print(f'  ◇ Listening: {url}')
    print(f'  ◇ Scaffolding: {url}/?scaffolding')
    print(f'  ◇ Reboot: {url}/?reboot')
    print()

    threading.Timer(1.0, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n  ◇ Seed stopped.')
        server.shutdown()

if __name__ == '__main__':
    main()
