const { schedule } = require('@netlify/functions');
const { Redis } = require('@upstash/redis');
const webpush = require('web-push');

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
});

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:tucorreo@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function getSchedule(sweet) {
  const duration = parseInt(sweet && sweet.durationDays, 10);
  const interval = parseInt(sweet && sweet.intervalDays, 10);
  if (!sweet || !sweet.startDate || !duration || duration <= 0) return null;
  const revealDate = addDays(sweet.startDate, duration);
  const step = interval && interval > 0 ? interval : duration;
  const sweetenDates = [];
  for (let d = step; d < duration; d += step) sweetenDates.push(addDays(sweet.startDate, d));
  return { revealDate, sweetenDates };
}

const runReminders = async () => {
  const codes = (await redis.smembers('known-codes')) || [];
  const today = todayStr();
  let notified = 0;

  for (const code of codes) {
    try {
      const raw = await redis.get(`evento-${code}`);
      if (!raw) continue;
      const state = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const sched = getSchedule(state.sweet);
      if (!sched) continue;

      const isSweeten = sched.sweetenDates.includes(today);
      const isReveal = today === sched.revealDate;
      if (!isSweeten && !isReveal) continue;

      const lastNotified = await redis.get(`lastNotified-${code}`);
      if (lastNotified === today) continue;

      const subsRaw = (await redis.smembers(`subs:${code}`)) || [];
      const body = isReveal
        ? '¡Hoy es la revelación final del amigo secreto!'
        : 'Hoy toca endulzar a tu angelito 🍬';

      for (const s of subsRaw) {
        try {
          const sub = JSON.parse(s);
          await webpush.sendNotification(sub, JSON.stringify({ title: 'Wishy', body }));
          notified++;
        } catch (err) {
          if (err.statusCode === 410 || err.statusCode === 404) {
            await redis.srem(`subs:${code}`, s);
          }
        }
      }
      await redis.set(`lastNotified-${code}`, today);
    } catch (e) {
      console.error('error checking code', code, e);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, checked: codes.length, notified }) };
};

exports.handler = schedule('0 13 * * *', runReminders);
