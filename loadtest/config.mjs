// Pure configuration: also imported by the Node launcher and its checks.
export function config(env = {}) {
  const target = env.BASE_URL || 'https://locato-staging.fly.dev';
  // Explicit allowlist, including port only for loopback. No credentials, paths or redirects.
  if (!/^https:\/\/locato-staging\.fly\.dev\/?$/.test(target) &&
      !/^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?\/?$/.test(target)) {
    throw new Error('BASE_URL must be https://locato-staging.fly.dev or an http loopback origin. Production is blocked.');
  }
  const scenario = env.TEST_SCENARIO || 'traffic';
  if (!['traffic', 'solo', 'multiplayer'].includes(scenario)) throw new Error('Unknown TEST_SCENARIO');
  const profile = env.PROFILE || 'smoke';
  if (!['smoke', 'baseline', 'ramp', 'spike', 'soak'].includes(profile)) throw new Error('Unknown PROFILE');
  const integer = (key, fallback, min, max) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} must be an integer from ${min} to ${max}`);
    return value;
  };
  const multiplayer = scenario === 'multiplayer';
  const units = integer('UNITS', multiplayer ? 5 : 20, 1, 100);
  const players = integer('PLAYERS_PER_ROOM', 4, 2, 8);
  const steps = profile === 'smoke' ? [{ duration: '1m', target: 1 }]
    : profile === 'baseline' ? [{ duration: '30s', target: units }, { duration: '5m', target: units }]
    : profile === 'soak' ? [{ duration: '1m', target: units }, { duration: '30m', target: units }]
    : profile === 'spike' ? [{ duration: '1m', target: 1 }, { duration: '10s', target: units }, { duration: '2m', target: units }, { duration: '30s', target: 1 }, { duration: '2m', target: 1 }]
    : [1, Math.ceil(units / 4), Math.ceil(units / 2), units].flatMap(target => [
      { duration: '30s', target }, { duration: '5m', target },
    ]);
  steps.push({ duration: '30s', target: 0 });
  return { baseUrl: target.replace(/\/$/, ''), scenario, profile, units, players, steps,
    analytics: env.ANALYTICS !== '0',
    httpP95: integer('HTTP_P95_MS', 1000, 1, 60000),
    sessionMs: integer('SESSION_SECONDS', 60, 15, 300) * 1000 };
}
