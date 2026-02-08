# XSTREAM SEED

**Live at: https://seed.machus.ai**

A self-bootstrapping LLM kernel. Bring your own Claude API key. The LLM wakes with the XSTREAM kernel constitution and engages you using pscale principles.

## What's Deployed

The active kernel constitution is at `public/kernels/active.md`. This is the system prompt the LLM receives. The version is displayed in the UI header.

| Version | Status | Description |
|---------|--------|-------------|
| v0.3 | Archived | Original stub — no pscale, essentially empty |
| v0.6 | **ACTIVE** | Full constitution — pscale, memory patterns, STI coordinates |

## How to Update the Kernel

1. Edit `public/kernels/active.md`
2. Update the version in the file header
3. Copy to `public/kernels/v[new-version].md`
4. Commit → Vercel auto-deploys

## Architecture

- `public/kernel.js` — Vanilla JS chat interface, fetches constitution at runtime
- `api/claude.ts` — CORS proxy (user's own API key, no server key)
- `public/kernels/active.md` — The system prompt
- Deployed on Vercel, auto-deploys from main branch

## Part of XSTREAM

- seed.machus.ai — This (SEED: user provides everything)
- xstream.machus.ai — About pscale and xstream
- xstream.onen.ai — Fantasy narrative coordination

See `CLAUDE.md` for LLM-oriented documentation.
