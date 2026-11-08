import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';
import { config } from './config.mjs';

export const cfg = config(__ENV);
export const rejected = new Rate('rate_limited');
export const failures = new Rate('request_errors');
export const headers = { Origin: cfg.baseUrl, 'User-Agent': 'LocatoLoadTest/1.0', 'Content-Type': 'application/json' };
export const requestOptions = name => ({ headers, redirects: 0, timeout: '10s', tags: { name } });
export function record(response, status, name) {
  rejected.add(response.status === 429);
  failures.add(response.status !== status);
  return check(response, { [name]: r => r.status === status });
}
export function options(extra = {}) {
  return {
    scenarios: { load: { executor: 'ramping-vus', startVUs: cfg.profile === 'smoke' ? 1 : 0, stages: cfg.steps, gracefulRampDown: `${Math.ceil(cfg.sessionMs / 1000) + 30}s`, gracefulStop: `${Math.ceil(cfg.sessionMs / 1000) + 30}s` } },
    userAgent: headers['User-Agent'],
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(95)', 'p(99)'],
    thresholds: {
      checks: ['rate>0.99'],
      ...extra,
    },
    tags: { test: cfg.scenario, profile: cfg.profile, run: __ENV.RUN_ID || 'direct' },
  };
}
export const httpThresholds = {
  request_errors: [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '30s' }],
  rate_limited: ['rate<0.01'],
  'http_req_duration{scenario:load}': [{ threshold: `p(95)<${cfg.httpP95}`, abortOnFail: true, delayAbortEval: '30s' }],
};
export function warmup() {
  // This intentionally separates cold start from the steady-state measurement.
  const response = http.get(`${cfg.baseUrl}/health`, requestOptions('warmup_health'));
  if (response.status !== 200) throw new Error(`Warm-up failed: HTTP ${response.status}`);
}
