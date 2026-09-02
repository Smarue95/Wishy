const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
});

exports.handler = async function (event) {
  try {
    if (event.httpMethod === 'GET') {
      const key = event.queryStringParameters && event.queryStringParameters.key;
      if (!key) return { statusCode: 400, body: JSON.stringify({ error: 'missing key' }) };
      const value = await redis.get(key);
      if (value === null || value === undefined) return { statusCode: 404, body: JSON.stringify({ error: 'not found' }) };
      return { statusCode: 200, body: JSON.stringify({ value }) };
    }

    if (event.httpMethod === 'POST') {
      const { key, value } = JSON.parse(event.body || '{}');
      if (!key) return { statusCode: 400, body: JSON.stringify({ error: 'missing key' }) };
      await redis.set(key, value);
      if (key.startsWith('evento-')) {
        const code = key.slice('evento-'.length);
        await redis.sadd('known-codes', code);
      }
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'DELETE') {
      const key = event.queryStringParameters && event.queryStringParameters.key;
      if (!key) return { statusCode: 400, body: JSON.stringify({ error: 'missing key' }) };
      await redis.del(key);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: JSON.stringify({ error: 'server error' }) };
  }
};
