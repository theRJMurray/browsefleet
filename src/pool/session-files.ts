import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';

export function validateSessionId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) {
    throw Object.assign(
      new Error(
        'Invalid sessionId: use 1-128 letters, digits, underscores or hyphens, starting with a letter or digit',
      ),
      { status: 400 },
    );
  }
}

export function containedPath(root: string, ...parts: string[]): string {
  const target = path.resolve(root, ...parts);
  const relative = path.relative(path.resolve(root), target);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw Object.assign(new Error('File path is outside session storage'), { status: 400 });
  }
  // Refuse links, including broken links, before any access or recursive removal.
  let current = path.resolve(root);
  for (const part of ['', ...relative.split(path.sep)]) {
    current = path.join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink())
        throw new Error('Session storage cannot contain symbolic links');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return target;
}

function fileName(name: string): string {
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    /[\\/:]/.test(name) ||
    [...name].some((char) => char.charCodeAt(0) < 32) ||
    /[. ]$/.test(name)
  ) {
    throw Object.assign(new Error('Invalid file name'), { status: 400 });
  }
  return name;
}

export class SessionFiles {
  private root: string | undefined;
  private parent: string | undefined;
  private closed = false;

  private assertOpen(): void {
    if (this.closed) throw Object.assign(new Error('Session storage is closed'), { status: 409 });
  }

  write(name: string, buffer: Buffer): void {
    this.assertOpen();
    fileName(name);
    if (!this.root) {
      this.parent = realpathSync(tmpdir());
      this.root = mkdtempSync(path.join(this.parent, 'bf-session-'));
    }
    const dir = containedPath(this.root, 'uploads');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(containedPath(this.root, 'uploads', name), buffer);
  }

  list(): string[] {
    this.assertOpen();
    if (!this.root) return [];
    return ['uploads', 'downloads'].flatMap((kind) => {
      const dir = containedPath(this.root!, kind);
      return existsSync(dir) ? readdirSync(dir).map((name) => `${kind}/${name}`) : [];
    });
  }

  read(name: string): Buffer | undefined {
    this.assertOpen();
    fileName(name);
    if (!this.root) return undefined;
    for (const kind of ['uploads', 'downloads']) {
      const target = containedPath(this.root, kind, name);
      if (existsSync(target)) return readFileSync(target);
    }
    return undefined;
  }

  dispose(): void {
    this.closed = true;
    if (!this.root) return;
    const target = containedPath(this.parent!, path.basename(this.root));
    rmSync(target, { recursive: true, force: true });
    this.root = undefined;
  }
}
