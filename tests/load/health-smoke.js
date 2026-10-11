import http from 'k6/http';
import { check, sleep } from 'k6';

const targetUrl = __ENV.TARGET_URL;
if (!targetUrl) {
  throw new Error('Set TARGET_URL to a non-production staging HTTP endpoint.');
}
if (new URL(targetUrl).hostname === 'lean-math-mesh.base44.app') {
  throw new Error('Load testing the published production app is blocked.');
}

export const options = {
  vus: 3,
  duration: '20s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1500'],
  },
};

export default function () {
  const headers = { Accept: 'application/json' };
  if (__ENV.AUTH_TOKEN) headers.Authorization = `Bearer ${__ENV.AUTH_TOKEN}`;
  const response = http.get(targetUrl, { headers });
  check(response, { 'HTTP request succeeds': (res) => res.status >= 200 && res.status < 400 });
  sleep(1);
}