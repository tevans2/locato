import http from 'k6/http';
import { sleep } from 'k6';
import { cfg, options as makeOptions, httpThresholds, requestOptions, record, warmup } from './common.js';

export const options = makeOptions(httpThresholds);
export function setup() {
  warmup();
  const page = http.get(cfg.baseUrl + '/', requestOptions('discover_assets'));
  if (page.status !== 200) throw new Error('Landing page unavailable');
  const assets = new Set();
  const assetElements = page.html().find('script[src],link[rel="stylesheet"][href],link[rel="modulepreload"][href]');
  assetElements.each((index) => {
    // each() supplies a raw Element; attr() belongs to a Selection.
    const element = assetElements.eq(index);
    const path = element.attr('src') || element.attr('href');
    // Only fetch same-origin build assets. Never follow third-party links.
    if (/^(\.\/|\/)assets\/[A-Za-z0-9_./-]+$/.test(path)) assets.add('/' + path.replace(/^\.?\//, ''));
  });
  if (assets.size === 0) throw new Error('No built assets found. Deploy the built frontend first.');
  return { assets: [...assets].slice(0, 10) };
}
export default function (data) {
  record(http.get(cfg.baseUrl + '/', requestOptions('landing')), 200, 'landing served');
  const responses = http.batch(data.assets.map(path => ['GET', cfg.baseUrl + path, null, requestOptions('build_asset')]));
  for (const response of responses) record(response, 200, 'asset served');
  // One synthetic arrival per VU roughly every 15 seconds, plus network time.
  sleep(12 + Math.random() * 6);
}
