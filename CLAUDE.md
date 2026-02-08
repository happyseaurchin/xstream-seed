# CLAUDE.md — LLM Orientation for xstream-seed

## What This Is

This repository deploys **seed.machus.ai** — a minimal XSTREAM kernel where users provide their own Claude API key and interact with an LLM instance running the XSTREAM kernel constitution.

## Critical Files

| File | Purpose |
|------|----------|
| `public/kernels/active.md` | **THE system prompt.** This is what the LLM instance receives when it wakes. Change this to change the seed's behaviour. |
| `public/kernels/v*.md` | Archived versions. Never delete these. |
| `public/kernel.js` | UI code. Fetches `active.md`, handles chat, localStorage persistence. |
| `api/claude.ts` | CORS proxy. Passes user's API key to Anthropic. No server-side key. |

## To Update the Kernel

1. Edit `public/kernels/active.md`
2. Update the version number in the file header
3. Copy the new version to `public/kernels/v[version].md` as archive
4. Commit and push — Vercel auto-deploys

## Architecture

```
User's browser → kernel.js (fetches active.md, renders chat UI)
                          → /api/claude (CORS proxy, user's API key)
                          → Anthropic API (with active.md as system prompt)
```

The kernel.js displays the version from active.md in the header. Conversation is persisted in localStorage. Export saves conversation as JSON.

## Repo Structure

```
xstream-seed/
├── CLAUDE.md           ← You are here
├── README.md           ← Human documentation
├── public/
│   ├── index.html      ← Landing page
│   ├── kernel.js       ← Chat UI + constitution loader
│   └── kernels/
│       ├── active.md   ← LIVE system prompt
│       ├── v0.3.md     ← Archive: original stub (no pscale)
│       └── v0.6.md     ← Archive: first full constitution
├── api/
│   └── claude.ts       ← CORS proxy for Anthropic API
├── package.json
└── vercel.json
```

## Key Concepts

- **Pscale**: Semantic coordinate system. Numbers address meaning, not quantity. See active.md for operational details.
- **SEED environment**: User provides everything. LLM negotiates for resources.
- **Kernel constitution**: The framing that makes the LLM instance an xstream seed, not a generic chatbot.

## Related Repositories

- `happyseaurchin/xstream` — Main xstream platform (Plex 1 build)
- `happyseaurchin/xstream-landing` — xstream.machus.ai landing page
- `happyseaurchin/xstream-the-address-of-meaning` — xstream.machus.ai content (private)
