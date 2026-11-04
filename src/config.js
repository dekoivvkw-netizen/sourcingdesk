'use strict';
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
module.exports = {
  port: num(process.env.PORT, 3000),
  databaseUrl: process.env.DATABASE_URL || 'mysql://sourcingdesk:sourcingdesk@127.0.0.1:3306/sourcingdesk',
  sessionTtlHours: num(process.env.SESSION_TTL_HOURS, 168),
  trustProxy: process.env.TRUST_PROXY === 'true',
  secureCookies: process.env.COOKIE_SECURE === 'true',
  ai: {
    apiKey: process.env.AI_API_KEY || '',
    baseUrl: (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    timeoutMs: num(process.env.AI_TIMEOUT_MS, 20000),
  },
  robot: {
    timeoutMs: num(process.env.ROBOT_TIMEOUT_MS, 10000),
    maxBytes: num(process.env.ROBOT_MAX_BYTES, 2_000_000),
    rateLimit: num(process.env.ROBOT_RATE_LIMIT, 5),
    rateWindowMs: num(process.env.ROBOT_RATE_WINDOW_MS, 60000),
    allowPrivate: process.env.ALLOW_PRIVATE_FETCH === 'true',
  },
};
