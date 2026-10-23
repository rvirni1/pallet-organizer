// Pallet Organizer AI relay (Cloudflare Worker)
// Passes the app's AI requests to Anthropic using a key stored as the secret ANTHROPIC_API_KEY,
// so the key is never in the public page. Only the app's own site may use it.

const ALLOWED_ORIGINS = ['https://rvirni1.github.io'];
const MODEL = 'claude-haiku-5-5';
const MAX_TOKENS = 3000;
const MAX_BODY = 8 * 1024 * 1024;      // pictures are sent shrunk, so 8 MB is plenty
const PER_IP = { limit: 60, windowMs: 10 * 60 * 1000 }; // 60 AI calls per 10 minutes per visitor

const hits = new Map();
function limited(ip) {
  const now = Date.now(), h = (hits.get(ip) || []).filter(t => now - t < PER_IP.windowMs);
  h.push(now); hits.set(ip, h);
  if (hits.size > 5000) hits.clear();
  return h.length > PER_IP.limit;
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const ok = ALLOWED_ORIGINS.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    const reply = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'content-type': 'application/json' } });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method === 'GET') return reply(200, { ok: true, service: 'pallet-organizer-ai', key_set: !!env.ANTHROPIC_API_KEY });
    if (req.method !== 'POST') return reply(405, { error: 'method' });
    if (!ok) return reply(403, { error: 'This relay only answers the Pallet Organizer site.' });
    if (!env.ANTHROPIC_API_KEY) return reply(500, { error: 'ANTHROPIC_API_KEY secret is not set on the worker.' });
    if (limited(req.headers.get('CF-Connecting-IP') || 'x')) return reply(429, { error: 'Too many AI requests. Wait a few minutes.' });
    if (+(req.headers.get('content-length') || 0) > MAX_BODY) return reply(413, { error: 'Request too large.' });

    let body;
    try { body = await req.json(); } catch { return reply(400, { error: 'Bad JSON.' }); }
    if (!Array.isArray(body.messages) || !body.messages.length) return reply(400, { error: 'No messages.' });

    const out = {
      model: MODEL,
      max_tokens: Math.min(+body.max_tokens || MAX_TOKENS, MAX_TOKENS),
      messages: body.messages,
    };
    if (typeof body.system === 'string') out.system = body.system.slice(0, 30000);
    if (Array.isArray(body.tools) && body.tools.length) out.tools = body.tools.slice(0, 12);

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(out),
    });
    return new Response(r.body, { status: r.status, headers: { ...cors, 'content-type': 'application/json' } });
  },
};
