import assert from 'node:assert/strict';
import { test } from 'node:test';
import { config } from './config.mjs';

test('allows only staging and explicit loopback origins', () => {
  for (const url of ['https://locato-staging.fly.dev', 'https://locato-staging.fly.dev/', 'http://localhost:3000', 'http://127.0.0.1:3000']) assert.ok(config({ BASE_URL: url }));
  for (const url of ['https://locato.quest', 'https://locato.fly.dev', 'https://locato-staging.fly.dev.evil.test', 'https://locato-staging.fly.dev@evil.test', 'https://locato-staging.fly.dev/path', 'http://localhost.evil.test', 'https://user:password@locato-staging.fly.dev']) assert.throws(() => config({ BASE_URL: url }));
});
test('profiles are bounded and finish at zero', () => {
  for (const scenario of ['traffic', 'solo', 'multiplayer']) for (const profile of ['smoke', 'baseline', 'ramp', 'spike', 'soak']) {
    const cfg = config({ TEST_SCENARIO: scenario, PROFILE: profile });
    assert.equal(cfg.steps.at(-1).target, 0);
    assert.equal(Math.max(...cfg.steps.map(step => step.target)), profile === 'smoke' ? 1 : cfg.units);
  }
});
test('invalid or excessive settings fail before starting a test', () => {
  for (const env of [{ UNITS: 101 }, { UNITS: 0 }, { UNITS: 2.5 }, { UNITS: '' }, { PLAYERS_PER_ROOM: 9 }, { PLAYERS_PER_ROOM: 1 }, { SESSION_SECONDS: 5 }, { TEST_SCENARIO: 'unknown' }, { PROFILE: 'unknown' }]) assert.throws(() => config(env));
  assert.equal(config({ ANALYTICS: '0' }).analytics, false);
});
