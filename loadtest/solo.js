import http from 'k6/http';
import { sleep, check } from 'k6';
import { cfg, options as makeOptions, httpThresholds, requestOptions, record, warmup, failures } from './common.js';

export const options = makeOptions(httpThresholds);
export function setup() { warmup(); }
export default function () {
  const round = http.get(cfg.baseUrl + '/api/maptap/round?difficulty=easy', requestOptions('maptap_round'));
  if (!record(round, 200, 'round served')) { sleep(5); return; }
  let target;
  try { target = round.json('target.id'); } catch { /* captured by content check below */ }
  if (!target) { failuresForContent(); return; }
  sleep(8 + Math.random() * 4);
  const guess = http.post(cfg.baseUrl + '/api/maptap/guess', JSON.stringify({ targetId: target, guessLat: 0, guessLng: 0 }), requestOptions('maptap_guess'));
  record(guess, 200, 'guess scored');
  if (cfg.analytics) {
    const id = `lt-${__ENV.RUN_ID || 'direct'}-${__VU}-${__ITER}`;
    const time = Date.now();
    const events = [
      { name: 'visit', time, screen: 'landing' },
      { name: 'view', time, screen: 'map-tap', game: 'map-tap', mode: 'practice' },
      { name: 'game_complete', time, game: 'map-tap', mode: 'practice' },
    ];
    const res = http.post(cfg.baseUrl + '/api/events', JSON.stringify({ visitorId: id, sessionId: id, events,
      touch: { source: 'loadtest', medium: 'synthetic', campaign: 'capacity', landing: 'landing', device: 'desktop' },
    }), requestOptions('analytics_write'));
    record(res, 202, 'analytics accepted');
    if (res.status === 202) {
      check(res, { 'analytics actually persisted': r => r.json('accepted') === events.length });
    }
  }
  sleep(18 + Math.random() * 4);
}
function failuresForContent() {
  failures.add(true);
  check(null, { 'round contains target id': () => false });
  sleep(5);
}
