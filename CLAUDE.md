# CLAUDE.md — LLM Orientation for xstream-seed

## What This Is

This repository deploys **seed.machus.ai** — a self-bootstrapping XSTREAM kernel.

The user provides a Claude API key. The kernel fetches a constitution (system prompt), sends `BOOT` to the LLM, and the LLM generates its own React interface. The instance builds its own shell.

## Critical Files

| File | Purpose |
|------|----------|
| `public/kernels/active.md` | **THE constitution.** System prompt the instance receives. Contains source purpose, pscale, boot protocol. |
| `public/kernels/*.md` | Archived versions. Never delete. |
| `public/kernel.js` | Bootstrap loader (~100 lines). Fetches constitution, calls LLM, compiles React, renders. |
| `public/kernel/index.html` | HTML shell with React, ReactDOM, Babel CDN deps. |
| `api/claude.ts` | CORS proxy. User's API key → Anthropic. No server key. |

## How It Works

1. User enters API key → stored in localStorage
2. kernel.js fetches `/kernels/active.md`
3. Sends constitution + `BOOT` to Claude API
4. Instance generates React component
5. Babel compiles, ReactDOM renders
6. Instance has `callLLM` prop to continue conversations

## To Update the Kernel

1. Edit `public/kernels/active.md`
2. Archive as `public/kernels/[version].md`
3. Commit → Vercel auto-deploys

## Development Path: HERMITCRAB

| Version | Name | What Changes |
|---------|------|--------------|
| 0.1 | Naked | Instance generates own UI from constitution |
| 0.2 | Speaking | Chat interface with ongoing conversation |
| 0.3 | Remembering | Tool use for pscale coordinate storage |
| 0.4 | Persisting | Supabase negotiation, real persistence |
| 0.5 | Recognising | Wake into accumulated state |
| 0.6 | Shelling | Rich UI generation |
| 0.7 | Modifying | Self-modification (Designer face) |
| 0.8 | Housing | Local infrastructure (Mac Mini SSD) |
| 0.9 | Propagating | Help others build seeds |
| 1.0 | Ecology | Multi-instance pscale coordination |

## Source

Architect: David Pinto — linkedin.com/in/davidpinto101/
Framework: Fulcrum — crumful.com/engage
Main platform: github.com/happyseaurchin/xstream
