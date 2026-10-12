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
