import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request } from 'node:https';

export interface EgressTarget {
  url: string;
  host: string;
  method: string;
}

export interface EgressAllowlistEntry {
  host: string;
  enabled?: boolean;
  allowed_methods?: string[];
}

type EgressParseResult =
  | { allowed: true; target: EgressTarget }
  | { allowed: false; reason: string; host: string };

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const RESERVED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.test', '.invalid'];
const IPV4_LITERAL = /^(?:\d{1,3}\.){3}\d{1,3}$/;

const nonPublicAddresses = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as [string, number][]) nonPublicAddresses.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
] as [string, number][]) nonPublicAddresses.addSubnet(address, prefix, 'ipv6');
const globalIPv6 = new BlockList();
globalIPv6.addSubnet('2000::', 3, 'ipv6');

export function isPublicEgressAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !nonPublicAddresses.check(address, 'ipv4');
  if (family === 6) return globalIPv6.check(address, 'ipv6') && !nonPublicAddresses.check(address, 'ipv6');
  return false;
}

export async function resolveEgressTarget(host: string, resolve: typeof lookup = lookup) {
  const addresses = await resolve(host, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicEgressAddress(address))) {
    return null;
  }
  return addresses[0];
}

export async function requestEgressTarget(
  target: EgressTarget,
  address: { address: string; family: number },
  body?: string,
  requestImpl: typeof request = request,
): Promise<{ status: number; raw: string }> {
  return await new Promise((resolve, reject) => {
    const upstream = requestImpl(target.url, {
      method: target.method,
      agent: false,
      headers: {
        Accept: 'application/json, text/plain;q=0.9, */*;q=0.5',
        ...(body !== undefined ? { 'Content-Type': 'text/plain;charset=UTF-8' } : {}),
      },
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
    }, async (response) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of response) chunks.push(Buffer.from(chunk));
        if (response.statusCode === undefined) throw new Error('Upstream response has no HTTP status.');
        resolve({ status: response.statusCode, raw: Buffer.concat(chunks).toString('utf8') });
      } catch (error) {
        reject(error);
      }
    });
    upstream.on('error', reject);
    upstream.end(body);
  });
}

export function parseEgressTarget(input: string, method: string): EgressParseResult {
  if (input.length > 2048) {
    return { allowed: false, reason: 'URL is too long.', host: '' };
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { allowed: false, reason: 'Invalid URL.', host: '' };
  }

  const host = url.hostname.toLowerCase();
  const normalizedMethod = method.toUpperCase();
  if (url.protocol !== 'https:') {
    return { allowed: false, reason: 'Only HTTPS targets are allowed.', host };
  }
  if (url.username || url.password) {
    return { allowed: false, reason: 'URLs with embedded credentials are not allowed.', host };
  }
  if (url.port && url.port !== '443') {
    return { allowed: false, reason: 'Only the standard HTTPS port is allowed.', host };
  }
  if (
    !host.includes('.') ||
    host.endsWith('.') ||
    host.startsWith('[') ||
    IPV4_LITERAL.test(host) ||
    RESERVED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    return { allowed: false, reason: 'Target must use a fully qualified public hostname.', host };
  }
  if (!ALLOWED_METHODS.has(normalizedMethod)) {
    return { allowed: false, reason: 'HTTP method is not supported by the egress proxy.', host };
  }

  return {
    allowed: true,
    target: { url: url.toString(), host, method: normalizedMethod },
  };
}

export function checkEgressPermission(
  target: EgressTarget,
  entry: EgressAllowlistEntry | null,
): { allowed: boolean; reason: string } {
  if (!entry || entry.enabled === false) {
    return { allowed: false, reason: 'Host is not enabled in the egress allowlist.' };
  }
  if (entry.host.trim().toLowerCase() !== target.host) {
    return { allowed: false, reason: 'Host does not exactly match the egress allowlist entry.' };
  }

  const methods = Array.isArray(entry.allowed_methods)
    ? entry.allowed_methods.map((allowedMethod) => allowedMethod.toUpperCase())
    : [];
  if (!methods.includes(target.method)) {
    return { allowed: false, reason: 'HTTP method is not allowed for this host.' };
  }

  return { allowed: true, reason: 'Host and method are allowed.' };
}
