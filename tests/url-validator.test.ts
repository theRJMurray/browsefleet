import { describe, it, expect } from 'vitest';
import { validateUrl } from '../src/utils/url-validator.js';

describe('validateUrl', () => {
  describe('schemes', () => {
    it('accepts https URLs', async () => {
      await expect(validateUrl('https://example.com')).resolves.toBeUndefined();
    });

    it('accepts http URLs', async () => {
      await expect(validateUrl('http://example.com')).resolves.toBeUndefined();
    });

    it('rejects file: scheme', async () => {
      await expect(validateUrl('file:///etc/passwd')).rejects.toThrow(/Blocked URL scheme/);
    });

    it('rejects ftp: scheme', async () => {
      await expect(validateUrl('ftp://example.com')).rejects.toThrow(/Blocked URL scheme/);
    });

    it('rejects javascript: scheme', async () => {
      await expect(validateUrl('javascript:alert(1)')).rejects.toThrow(/Blocked URL scheme/);
    });

    it('rejects data: scheme', async () => {
      await expect(validateUrl('data:text/html,<script>')).rejects.toThrow(/Blocked URL scheme/);
    });

    it('rejects malformed URLs', async () => {
      await expect(validateUrl('not a url')).rejects.toThrow(/Invalid URL/);
    });
  });

  describe('SSRF protection', () => {
    it('blocks IPv4 loopback', async () => {
      await expect(validateUrl('http://127.0.0.1/')).rejects.toThrow(/private\/reserved/);
    });

    it('blocks IPv4 loopback non-127.0.0.1 address in the 127/8 range', async () => {
      await expect(validateUrl('http://127.1.2.3/')).rejects.toThrow(/private\/reserved/);
    });

    it('blocks IPv6 loopback ::1', async () => {
      await expect(validateUrl('http://[::1]/')).rejects.toThrow(/private\/reserved/);
    });

    it('blocks IPv6 unspecified ::', async () => {
      await expect(validateUrl('http://[::]/')).rejects.toThrow(/private\/reserved/);
    });

    it('blocks IPv4-mapped IPv6 loopback ::ffff:127.0.0.1', async () => {
      await expect(validateUrl('http://[::ffff:127.0.0.1]/')).rejects.toThrow(/private\/reserved/);
    });

    it('blocks IPv4-mapped IPv6 private ::ffff:10.0.0.1', async () => {
      await expect(validateUrl('http://[::ffff:10.0.0.1]/')).rejects.toThrow(/private\/reserved/);
    });

    it('blocks fc00::/7 unique-local (fc half)', async () => {
      await expect(validateUrl('http://[fc00::1]/')).rejects.toThrow(/private\/reserved/);
    });

    it('blocks fd00::/8 unique-local', async () => {
      await expect(validateUrl('http://[fd12:3456::1]/')).rejects.toThrow(/private\/reserved/);
    });

    it('blocks fe80::/10 link-local', async () => {
      await expect(validateUrl('http://[fe80::1]/')).rejects.toThrow(/private\/reserved/);
    });

    it('blocks NAT64-embedded loopback 64:ff9b::7f00:1', async () => {
      await expect(validateUrl('http://[64:ff9b::7f00:1]/')).rejects.toThrow(/private\/reserved/);
    });

    it('blocks translatable-mapped loopback ::ffff:0:7f00:1', async () => {
      await expect(validateUrl('http://[::ffff:0:7f00:1]/')).rejects.toThrow(/private\/reserved/);
    });

    it('does NOT block a public IPv6 literal', async () => {
      await expect(validateUrl('http://[2606:4700::1111]/')).resolves.toBeUndefined();
    });

    it('blocks 10.0.0.0/8 private range', async () => {
      await expect(validateUrl('http://10.5.5.5/')).rejects.toThrow(/private\/reserved/);
    });

    it('blocks 192.168.0.0/16 private range', async () => {
      await expect(validateUrl('http://192.168.1.1/')).rejects.toThrow(/private\/reserved/);
    });

    it('blocks 172.16.0.0/12 private range', async () => {
      await expect(validateUrl('http://172.20.0.1/')).rejects.toThrow(/private\/reserved/);
    });

    it('does NOT block 172.15.x.x (outside the private range)', async () => {
      // This validates that the range check is exclusive. It will only fail because
      // 172.15.x.x is not routable here; if we ever change to allow private IPs,
      // this test would catch the regression in the range arithmetic.
      await expect(validateUrl('http://172.15.0.1/')).resolves.toBeUndefined();
    });

    it('blocks 169.254.0.0/16 link-local range', async () => {
      await expect(validateUrl('http://169.254.169.254/')).rejects.toThrow(/private\/reserved/);
    });

    it('blocks 0.0.0.0', async () => {
      await expect(validateUrl('http://0.0.0.0/')).rejects.toThrow(/private\/reserved/);
    });
  });
});
