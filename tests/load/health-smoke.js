import http from 'k6/http';
import { check, sleep } from 'k6';

const targetUrl = __ENV.TARGET_URL;
if (!targetUrl) {
  throw new Error('Set TARGET_URL to a non-production HTTPS staging endpoint.');
}
if (__ENV.TARGET_ENV !== 'staging') {
  throw new Error('Set TARGET_ENV=staging; production load testing is not permitted.');
}
let target;
try {
  target = new URL(targetUrl);
} catch {
  throw new Error('TARGET_URL must be an absolute HTTPS staging URL.');
}
if (target.protocol !== 'https:') {
  throw new Error('TARGET_URL must be an absolute HTTPS staging URL.');
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