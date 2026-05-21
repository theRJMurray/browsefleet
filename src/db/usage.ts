import { getDb } from './schema.js';
import type { UsageStats } from '../types.js';

export function recordSessionStart(
  sessionId: string,
  apiKey: string | undefined,
  opts: {
    proxyUrl?: string;
    stealthLevel?: string;
    viewportWidth?: number;
    viewportHeight?: number;
    profileId?: string;
  },
) {
  const db = getDb();
  const now = new Date().toISOString();
  const key = apiKey ?? 'anonymous';

  db.prepare(
    `
    INSERT INTO sessions (id, api_key, status, created_at, proxy_url, stealth_level, viewport_width, viewport_height, profile_id)
    VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    sessionId,
    key,
    now,
    opts.proxyUrl ?? null,
    opts.stealthLevel ?? null,
    opts.viewportWidth ?? 1280,
    opts.viewportHeight ?? 900,
    opts.profileId ?? null,
  );

  // Increment daily counter
  const date = now.slice(0, 10);
  db.prepare(
    `
    INSERT INTO daily_usage (api_key, date, sessions_created) VALUES (?, ?, 1)
    ON CONFLICT(api_key, date) DO UPDATE SET sessions_created = sessions_created + 1
  `,
  ).run(key, date);
}

export function recordSessionEnd(sessionId: string, browserHours: number) {
  const db = getDb();
  const now = new Date().toISOString();

  const session = db
    .prepare('SELECT api_key, created_at FROM sessions WHERE id = ?')
    .get(sessionId) as any;
  if (!session) return;

  const durationMs = new Date(now).getTime() - new Date(session.created_at).getTime();

  db.prepare(
    `
    UPDATE sessions SET status = 'released', released_at = ?, duration_ms = ?, browser_hours = ? WHERE id = ?
  `,
  ).run(now, durationMs, browserHours, sessionId);

  // Update daily browser hours
  const date = now.slice(0, 10);
  db.prepare(
    `
    INSERT INTO daily_usage (api_key, date, browser_hours) VALUES (?, ?, ?)
    ON CONFLICT(api_key, date) DO UPDATE SET browser_hours = browser_hours + ?
  `,
  ).run(session.api_key, date, browserHours, browserHours);
}

export function recordApiCall(
  apiKey: string | undefined,
  method: string,
  path: string,
  statusCode: number,
  durationMs: number,
) {
  const db = getDb();
  const key = apiKey ?? 'anonymous';

  db.prepare(
    `
    INSERT INTO api_calls (api_key, method, path, status_code, duration_ms) VALUES (?, ?, ?, ?, ?)
  `,
  ).run(key, method, path, statusCode, durationMs);

  const date = new Date().toISOString().slice(0, 10);
  db.prepare(
    `
    INSERT INTO daily_usage (api_key, date, api_calls) VALUES (?, ?, 1)
    ON CONFLICT(api_key, date) DO UPDATE SET api_calls = api_calls + 1
  `,
  ).run(key, date);
}

export function getUsageStats(apiKey?: string): UsageStats {
  const db = getDb();
  const key = apiKey ?? 'anonymous';

  const totalSessions =
    (db.prepare('SELECT count(*) as c FROM sessions WHERE api_key = ?').get(key) as any)?.c ?? 0;

  const activeSessions =
    (
      db
        .prepare('SELECT count(*) as c FROM sessions WHERE api_key = ? AND status = ?')
        .get(key, 'active') as any
    )?.c ?? 0;

  const totalBrowserHours =
    (
      db
        .prepare('SELECT COALESCE(SUM(browser_hours), 0) as h FROM sessions WHERE api_key = ?')
        .get(key) as any
    )?.h ?? 0;

  const today = new Date().toISOString().slice(0, 10);
  const todayRow = db
    .prepare('SELECT browser_hours, api_calls FROM daily_usage WHERE api_key = ? AND date = ?')
    .get(key, today) as any;

  const daily = db
    .prepare(
      'SELECT date, sessions_created as sessions, browser_hours as browserHours, api_calls as apiCalls FROM daily_usage WHERE api_key = ? ORDER BY date DESC LIMIT 30',
    )
    .all(key) as any[];

  return {
    totalSessions,
    activeSessions,
    totalBrowserHours,
    todayBrowserHours: todayRow?.browser_hours ?? 0,
    todayApiCalls: todayRow?.api_calls ?? 0,
    daily,
  };
}
