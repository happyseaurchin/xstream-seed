#!/usr/bin/env python3
"""Quick pscale.db viewer — run from the seed directory"""
import sqlite3, sys
from pathlib import Path

db = Path(__file__).parent / 'pscale.db'
if not db.exists():
    print("No pscale.db found"); sys.exit(1)

conn = sqlite3.connect(str(db))
conn.row_factory = sqlite3.Row

# ── Pscale table ──
rows = conn.execute('SELECT * FROM pscale ORDER BY id').fetchall()
LABELS = {'0.1':'skill','0.2':'shell','0.3':'identity/config'}

print(f"\n  ◇ PSCALE — {len(rows)} entries\n")
for r in rows:
    s, label = r['s'], LABELS.get(r['s'], r['s'])
    content = r['content']
    preview = f"[shell: {len(content)} chars]" if s == '0.2' else (content[:120] + '...' if len(content) > 120 else content)
    print(f"  #{r['id']:3d}  S:{s:<6} T:{r['t']:<12} I:{r['i']:<6}  ({label})")
    print(f"         {preview}\n")

# ── Memory table ──
def show_semantic_table(name):
    try:
        rows = conn.execute(f'SELECT * FROM {name} ORDER BY number').fetchall()
    except:
        print(f"  ◇ {name.upper()} — table not yet created\n"); return
    print(f"  ◇ {name.upper()} — {len(rows)} entries\n")
    for r in rows:
        num, level, n = r['number'], 0, r['number']
        while n > 0 and n % 10 == 0: level += 1; n //= 10
        marker = '★' * level if level > 0 else '·'
        preview = r['content'][:120] + ('...' if len(r['content']) > 120 else '')
        print(f"  {marker} #{num:<6}  I:{r['identity']:<6}  {r['created_at']}")
        print(f"         {preview}\n")
    if not rows: print("  (empty)\n")

show_semantic_table('memory')
show_semantic_table('changelog')
conn.close()
