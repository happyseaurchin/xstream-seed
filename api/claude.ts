import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * PASSTHROUGH Claude API Proxy
 *
 * User provides their OWN API key.
 * This proxy exists purely to bypass browser CORS restrictions.
 * No server-side API key. No storage. Just pass-through.
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  const origin = req.headers.origin || '';
  const allowedOrigins = [
    'https://seed.machus.ai',
    'http://localhost:5173',
    'http://localhost:3000',
  ];

  if (allowedOrigins.some(allowed => origin.startsWith(allowed))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get API key from request
  const apiKey = req.headers['x-api-key'] as string || req.body.apiKey;

  if (!apiKey) {
    return res.status(400).json({
      error: 'API key required. Provide your Anthropic API key via X-API-Key header.'
    });
  }

  if (!apiKey.startsWith('sk-ant-')) {
    return res.status(400).json({
      error: 'Invalid API key format. Anthropic keys start with sk-ant-'
    });
  }

  try {
    const { system, messages, max_tokens, temperature, model } = req.body;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-20250514',
        max_tokens: max_tokens || 4096,
        system,
        messages,
        temperature: temperature ?? 0.7,
      }),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Proxy error' });
  }
}
