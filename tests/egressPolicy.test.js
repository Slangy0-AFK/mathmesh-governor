import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEgressPermission, parseEgressTarget } from '../governor/shared/egressPolicy.ts';

test('egress parsing allows HTTPS requests to fully qualified hosts', () => {
  const result = parseEgressTarget('https://api.example.com/v1/items', 'get');

  assert.equal(result.allowed, true);
  if (result.allowed) {
    assert.equal(result.target.host, 'api.example.com');
    assert.equal(result.target.method, 'GET');
    assert.equal(result.target.url, 'https://api.example.com/v1/items');
  }
});

test('egress parsing denies non-HTTPS, credentialed, nonstandard-port, and local targets', () => {
  for (const url of [
    'http://api.example.com/',
    'https://user:pass@api.example.com/',
    'https://api.example.com:8443/',
    'https://localhost/',
    'https://service.internal/',
    'https://127.0.0.1/',
    'https://[::1]/',
  ]) {
    const result = parseEgressTarget(url, 'GET');
    assert.equal(result.allowed, false, url);
  }
});

test('egress parsing denies unsupported methods and oversized URLs', () => {
  assert.equal(parseEgressTarget('https://api.example.com/', 'OPTIONS').allowed, false);
  assert.equal(parseEgressTarget(`https://api.example.com/${'x'.repeat(2048)}`, 'GET').allowed, false);
});

test('egress permissions require an enabled exact host and an explicitly allowed method', () => {
  const parsed = parseEgressTarget('https://api.example.com/v1', 'GET');
  assert.equal(parsed.allowed, true);
  if (!parsed.allowed) return;

  assert.equal(checkEgressPermission(parsed.target, null).allowed, false);
  assert.equal(checkEgressPermission(parsed.target, {
    host: 'other.example.com',
    enabled: true,
    allowed_methods: ['GET'],
  }).allowed, false);
  assert.equal(checkEgressPermission(parsed.target, {
    host: 'api.example.com',
    enabled: false,
    allowed_methods: ['GET'],
  }).allowed, false);
  assert.equal(checkEgressPermission(parsed.target, {
    host: 'api.example.com',
    enabled: true,
    allowed_methods: ['POST'],
  }).allowed, false);
  assert.equal(checkEgressPermission(parsed.target, {
    host: 'api.example.com',
    enabled: true,
    allowed_methods: ['get'],
  }).allowed, true);
});
