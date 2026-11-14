import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { checkEgressPermission, isPublicEgressAddress, parseEgressTarget, requestEgressTarget, resolveEgressTarget } from '../governor/shared/egressPolicy.ts';

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

test('egress rejects private, local, special, mapped, and malformed IP addresses', () => {
  for (const address of [
    '0.1.2.3', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254',
    '172.31.0.1', '192.168.1.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2001:db8::1',
    '2002:7f00:1::', 'not-an-ip',
  ]) assert.equal(isPublicEgressAddress(address), false, address);
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
    assert.equal(isPublicEgressAddress(address), true, address);
  }
});

test('DNS requires every answer to be public and fails closed on empty or failed lookups', async () => {
  const resolve = (answers) => async () => answers;
  const publicAnswer = { address: '8.8.8.8', family: 4 };
  assert.deepEqual(await resolveEgressTarget('api.example.com', resolve([publicAnswer])), publicAnswer);
  assert.equal(await resolveEgressTarget('api.example.com', resolve([publicAnswer, { address: '127.0.0.1', family: 4 }])), null);
  assert.equal(await resolveEgressTarget('api.example.com', resolve([])), null);
  await assert.rejects(resolveEgressTarget('api.example.com', async () => { throw new Error('DNS unavailable'); }), /DNS unavailable/);
});

test('outbound HTTPS connects using the validated address without changing the hostname', async () => {
  const parsed = parseEgressTarget('https://api.example.com/v1', 'POST');
  assert.equal(parsed.allowed, true);
  const address = { address: '8.8.8.8', family: 4 };
  const result = await requestEgressTarget(parsed.target, address, 'payload', (url, options, onResponse) => {
    assert.equal(url, 'https://api.example.com/v1');
    assert.equal(options.agent, false);
    options.lookup('api.example.com', { all: false }, (error, ip, family) => {
      assert.ifError(error);
      assert.equal(ip, address.address);
      assert.equal(family, address.family);
    });
    options.lookup('api.example.com', { all: true }, (error, addresses) => {
      assert.ifError(error);
      assert.deepEqual(addresses, [address]);
    });
    const req = new EventEmitter();
    req.end = (body) => {
      assert.equal(body, 'payload');
      const response = Readable.from(['ok']);
      response.statusCode = 200;
      onResponse(response);
    };
    return req;
  });
  assert.deepEqual(result, { status: 200, raw: 'ok' });
});
