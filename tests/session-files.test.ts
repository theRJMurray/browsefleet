import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  mkdirSync,
  symlinkSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { SessionFiles, containedPath } from '../src/pool/session-files.js';
import { BrowserSession } from '../src/pool/session.js';
import { filesRoutes } from '../src/routes/files.js';
import type { BrowserPool } from '../src/pool/browser-pool.js';
import type { Browser } from 'puppeteer-core';
const location = vi.hoisted(() => ({ root: '' }));
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  tmpdir: () => location.root,
}));
let storage: SessionFiles;
beforeEach(() => {
  location.root = mkdtempSync(path.join(process.cwd(), '.test-storage-'));
  storage = new SessionFiles();
});
afterEach(() => {
  // The absolute target must be a direct child of this worktree.
  const target = path.resolve(location.root);
  if (path.dirname(target) !== process.cwd() || !path.basename(target).startsWith('.test-storage-'))
    throw new Error('Unsafe test cleanup');
  rmSync(target, { recursive: true, force: true });
});
describe('session file containment', () => {
  it('uses private generated storage and deletes it idempotently', () => {
    storage.write('hello.txt', Buffer.from('hello'));
    expect(storage.list()).toEqual(['uploads/hello.txt']);
    expect(storage.read('hello.txt')?.toString()).toBe('hello');
    expect(readdirSync(location.root)).toHaveLength(1);
    expect(readdirSync(location.root)[0]).toMatch(/^bf-session-/);
    storage.dispose();
    storage.dispose();
    expect(readdirSync(location.root)).toEqual([]);
    expect(() => storage.write('late.txt', Buffer.from('late'))).toThrow('closed');
  });
  it.each([
    '../outside',
    '..\\outside',
    '/absolute',
    'C:\\outside',
    'x/../../audit-target',
    '.',
    '..',
    'a:b',
    'bad\0name',
    'trailing.',
    'trailing ',
  ])('rejects file name %j before creating storage', (name) => {
    expect(() => storage.write(name, Buffer.from('bad'))).toThrow('Invalid file name');
    expect(() => storage.read(name)).toThrow('Invalid file name');
    expect(readdirSync(location.root)).toEqual([]);
  });
  it('rejects escape and sibling-prefix paths with an untouched external sentinel', () => {
    const root = path.join(location.root, 'owned');
    mkdirSync(root);
    const sentinel = path.join(location.root, 'outside');
    writeFileSync(sentinel, 'keep');
    for (const value of ['..', '../outside', root, `${root}-sibling`])
      expect(() => containedPath(root, value)).toThrow('outside');
    expect(readFileSync(sentinel, 'utf8')).toBe('keep');
  });
  it('refuses directory links before reads and writes without touching their target', () => {
    const outside = path.join(location.root, 'outside');
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'keep.txt'), 'keep');
    storage.write('initial.txt', Buffer.from('hello'));
    const root = path.join(
      location.root,
      readdirSync(location.root).find((n) => n.startsWith('bf-session-'))!,
    );
    const uploads = containedPath(root, 'uploads');
    rmSync(uploads, { recursive: true });
    symlinkSync(outside, uploads, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => storage.read('keep.txt')).toThrow('symbolic links');
    expect(() => storage.write('keep.txt', Buffer.from('bad'))).toThrow('symbolic links');
    expect(() => storage.list()).toThrow('symbolic links');
    storage.dispose();
    expect(readFileSync(path.join(outside, 'keep.txt'), 'utf8')).toBe('keep');
  });
  it('refuses a replaced storage root during recursive cleanup', () => {
    const outside = path.join(location.root, 'outside');
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'keep.txt'), 'keep');
    storage.write('initial.txt', Buffer.from('hello'));
    const root = path.join(
      location.root,
      readdirSync(location.root).find((n) => n.startsWith('bf-session-'))!,
    );
    const verified = containedPath(location.root, path.basename(root));
    rmSync(verified, { recursive: true });
    symlinkSync(outside, root, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => storage.dispose()).toThrow('symbolic links');
    expect(readFileSync(path.join(outside, 'keep.txt'), 'utf8')).toBe('keep');
  });
  it('HTTP upload, list, and download use the same storage and release removes it', async () => {
    const browser = { close: vi.fn().mockResolvedValue(undefined) } as unknown as Browser;
    const session = new BrowserSession('caller-id', browser, 'ws://fake', {}, () => {});
    const p = { getSession: () => session } as unknown as BrowserPool;
    const app = filesRoutes(p);
    try {
      const body = new FormData();
      body.append('file', new File(['payload'], 'hello.txt'));
      expect((await app.request('/caller-id/files', { method: 'POST', body })).status).toBe(200);
      expect(await (await app.request('/caller-id/files')).json()).toEqual({
        files: ['uploads/hello.txt'],
      });
      expect(await (await app.request('/caller-id/files/hello.txt')).text()).toBe('payload');
      expect(readdirSync(location.root)[0]).not.toContain('caller-id');
      await session.release();
      expect(readdirSync(location.root)).toEqual([]);
    } finally {
      await session.release();
    }
  });
  it('release during multipart parsing cannot recreate deleted storage', async () => {
    const browser = { close: vi.fn().mockResolvedValue(undefined) } as unknown as Browser;
    const session = new BrowserSession('late', browser, 'ws://fake', {}, () => {});
    const app = filesRoutes({ getSession: () => session } as unknown as BrowserPool);
    const form = new FormData();
    form.append('file', new File(['late'], 'late.txt'));
    const request = new Request('http://localhost/late/files', { method: 'POST', body: form });
    const body = await request.arrayBuffer();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    const response = app.request('/late/files', {
      method: 'POST',
      headers: request.headers,
      body: stream,
      duplex: 'half',
    } as RequestInit);
    await session.release();
    controller.enqueue(new Uint8Array(body));
    controller.close();
    expect((await response).status).toBe(409);
    expect(readdirSync(location.root)).toEqual([]);
    expect(existsSync(path.join(location.root, 'late.txt'))).toBe(false);
  });
});
