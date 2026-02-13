# XSTREAM SEED — G-1

## Quick Start

```bash
# 1. Find your thumb drive
ls /Volumes/                  # Mac — look for your drive name
# or
ls /media/                    # Linux

# 2. Navigate to seed folder
cd /Volumes/YOUR_DRIVE/seed   # Mac
# or
cd /media/YOUR_DRIVE/seed     # Linux

# 3. Run it
python3 seed.py
```

Browser opens automatically at `http://127.0.0.1:8888`

## Commands

| Action | Command |
|--------|---------|
| Start | `python3 seed.py` |
| Stop | `Ctrl+C` in terminal |
| Inspect database | `python3 inspect_db.py` |
| Fresh start | Delete `pscale.db`, then run seed.py |

## Browser URLs

| URL | Purpose |
|-----|---------|
| `localhost:8888` | Main interface |
| `localhost:8888/?scaffolding` | Bootloader (enter API key) |
| `localhost:8888/?reboot` | Clear shell, fresh boot |

## Files

| File | Touch? |
|------|--------|
| `seed.py` | The kernel — don't edit |
| `constitution.md` | Universal soul — edit to improve starting conditions |
| `environment.md` | G-1 specific brief — edit to improve boot behaviour |
| `GENESIS.md` | Origin document — shipped to LLM on first boot |
| `pscale-coordinate-generation-skill.md` | First skill |
| `pscale.db` | Created on first run — all LLM memory lives here |
| `inspect_db.py` | View database contents |

## Troubleshooting

**Port in use**: `SEED_PORT=9999 python3 seed.py`

**Stuck after boot**: Visit `/?reboot` in browser

**LLM errors**: Check terminal output — API errors show there

**Corrupted UI**: Delete `pscale.db` and restart

**Want to keep memory but reset UI**: Use `/?reboot` (keeps DB, clears shell)
