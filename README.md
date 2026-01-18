# XSTREAM Seed

Minimal LLM kernel. Bring your own API key.

## What is this?

A self-bootstrapping kernel that operates with YOUR resources:
- You provide your Claude API key
- It stays on your machine (localStorage)
- The proxy exists only to bypass browser CORS restrictions

## Structure

```
api/claude.ts    - Pass-through proxy (no server-side key)
public/          - Landing page and kernel UI
```

## Deploy

Connect this repo to Vercel, add seed.machus.ai as custom domain.

That's it.
