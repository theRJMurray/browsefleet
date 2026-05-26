import { lookup } from 'node:dns/promises';
import { isIPv4, isIPv6 } from 'node:net';

/**
 * Validates a URL to prevent SSRF attacks.
 * Rejects non-HTTP(S) schemes and private/loopback/link-local IP addresses.
 */
export async function validateUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL');
  }

  // Only allow http and https schemes
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked URL scheme: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname;

  // IPv6 literals are bracketed in URLs (http://[::1]/ -> hostname "[::1]").
  // Strip the brackets so the literal-IP fast path and isIPv6() check below fire;
  // otherwise a bracketed literal slips past the IP check and gets DNS-resolved,
  // which both fails on IPv6-less hosts (CI) and bypasses the SSRF guard.
  const host =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;

  // If the host is already an IP, check it directly. Never DNS-resolve a literal IP.
  if (isIPv4(host) || isIPv6(host)) {
    assertNotPrivateIp(host);
    return;
  }

  // Resolve hostname and check the resulting IP
  try {
    const { address } = await lookup(host);
    assertNotPrivateIp(address);
  } catch (err: any) {
    if (err.message?.startsWith('Blocked')) throw err;
    throw new Error(`DNS resolution failed for ${hostname}: ${err.message}`);
  }
}

function assertNotPrivateIp(ip: string): void {
  if (isPrivateIp(ip)) {
    throw new Error(`Blocked request to private/reserved IP: ${ip}`);
  }
}

/**
 * Extracts the embedded IPv4 address from the tail of an IPv4-mapped IPv6
 * address (the part after `::ffff:`). Accepts either dotted-quad (`127.0.0.1`)
 * or the two-hextet form Node normalizes to (`7f00:1`). Returns null if the
 * tail is not a recognizable IPv4 embedding.
 */
function embeddedIpv4(tail: string): string | null {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(tail)) return tail;
  const groups = tail.split(':');
  if (groups.length !== 2) return null;
  const hi = parseInt(groups[0] || '0', 16);
  const lo = parseInt(groups[1] || '0', 16);
  if (Number.isNaN(hi) || Number.isNaN(lo) || hi > 0xffff || lo > 0xffff) return null;
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

function isPrivateIp(ip: string): boolean {
  // IPv6
  const lower = ip.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower === '::') return true; // unspecified
  if (lower.startsWith('fd')) return true; // fd00::/8 unique local
  if (lower.startsWith('fe80')) return true; // link-local
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — range-check the embedded IPv4 address.
  // Node normalizes the dotted tail to two hex hextets (::ffff:7f00:1 for
  // 127.0.0.1), so handle both the dotted and hextet representations.
  if (lower.startsWith('::ffff:')) {
    const tail = lower.slice('::ffff:'.length);
    const embedded = embeddedIpv4(tail);
    if (embedded) return isPrivateIp(embedded);
  }

  // IPv4
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;

  const [a, b] = parts;

  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 10.0.0.0/8 — private
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 — link-local
  if (a === 169 && b === 254) return true;
  // 0.0.0.0
  if (a === 0 && b === 0 && parts[2] === 0 && parts[3] === 0) return true;

  return false;
}
