const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
});

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
  }
  try {
    const { code, subscription } = JSON.parse(event.body || '{}');
    if (!code || !subscription) return { statusCode: 400, body: JSON.stringify({ error: 'missing fields' }) };
    await redis.sadd(`subs:${code}`, JSON.stringify(subscription));
    await redis.sadd('known-codes', code);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: JSON.stringify({ error: 'server error' }) };
  }
};
