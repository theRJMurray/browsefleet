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

function isPrivateIp(ip: string): boolean {
  return isIPv6(ip) ? isPrivateIpv6(ip) : isPrivateIpv4(ip);
}

/**
 * Expands an IPv6 address into its eight 16-bit hextets. Handles `::`
 * compression and a trailing embedded IPv4 dotted-quad (`::ffff:127.0.0.1`).
 * Returns null if the string is not parseable as IPv6.
 */
function expandIpv6(ip: string): number[] | null {
  let s = ip.toLowerCase();

  // Fold a trailing embedded IPv4 (a.b.c.d) into two hextets.
  const v4 = s.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const oct = v4.slice(1, 5).map(Number);
    if (oct.some((o) => o > 255)) return null;
    const hi = ((oct[0] << 8) | oct[1]).toString(16);
    const lo = ((oct[2] << 8) | oct[3]).toString(16);
    s = s.slice(0, v4.index) + `${hi}:${lo}`;
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;

  const parseGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    for (const g of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  const head = parseGroups(halves[0]);
  const tail = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (head === null || tail === null) return null;

  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    return [...head, ...new Array<number>(fill).fill(0), ...tail];
  }
  return head.length === 8 ? head : null;
}

function isPrivateIpv6(ip: string): boolean {
  const h = expandIpv6(ip);
  if (!h) return false;

  // :: unspecified
  if (h.every((x) => x === 0)) return true;
  // ::1 loopback
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return true;
  // fc00::/7 unique local (covers both fc00::/8 and fd00::/8)
  if ((h[0] & 0xfe00) === 0xfc00) return true;
  // fe80::/10 link-local
  if ((h[0] & 0xffc0) === 0xfe80) return true;

  // IPv4-in-IPv6 embeddings: range-check the trailing 32 bits. Covers the
  // mapped (::ffff:0:0/96), translatable (::ffff:0:0:0/96), NAT64
  // (64:ff9b::/96), and deprecated compatible (::/96) prefixes.
  const z = (lo: number, hi: number) => h.slice(lo, hi).every((x) => x === 0);
  const mapped = z(0, 5) && h[5] === 0xffff;
  const translatable = z(0, 4) && h[4] === 0xffff && h[5] === 0;
  const nat64 = h[0] === 0x64 && h[1] === 0xff9b && z(2, 6);
  const compatible = z(0, 6);
  if (mapped || translatable || nat64 || compatible) {
    return isPrivateIpv4(`${(h[6] >> 8) & 0xff}.${h[6] & 0xff}.${(h[7] >> 8) & 0xff}.${h[7] & 0xff}`);
  }

  return false;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return false;
  }

  const [a, b] = parts;

  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 0 && b === 0 && parts[2] === 0 && parts[3] === 0) return true; // 0.0.0.0

  return false;
}
