exports.handler = async function () {
  return { statusCode: 200, body: JSON.stringify({ publicKey: process.env.VAPID_PUBLIC_KEY || '' }) };
};
