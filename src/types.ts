// ─── Session Types ─────────────────────────────────────────────────────────

export interface CreateSessionRequest {
  sessionId?: string;
  proxyUrl?: string;
  stealth?: 'none' | 'basic' | 'full';
  headless?: boolean;
  userAgent?: string;
  viewport?: { width: number; height: number };
  timeout?: number;
  profileId?: string;
  operatorMode?: boolean;
  sensitiveMode?: boolean;
  blockAds?: boolean;
  cookies?: Array<{ name: string; value: string; domain: string; path?: string }>;
  timezone?: string;
  locale?: string;
  headers?: Record<string, string>;
}

export type SessionControlMode = 'agent' | 'human' | 'paused';

export interface Session {
  id: string;
  status: 'active' | 'released' | 'expired' | 'error';
  websocketUrl: string;
  viewerUrl: string;
  eventsUrl: string;
  createdAt: string;
  expiresAt: string;
  timeout: number;
  proxyUrl?: string;
  stealth: string;
  viewport: { width: number; height: number };
  profileId?: string;
  operatorMode: boolean;
  controlMode: SessionControlMode;
  sensitiveMode: boolean;
  currentUrl?: string;
  title?: string;
}

export interface ReleaseRequest {
  ids?: string[];
}

export interface ControlSessionRequest {
  controlMode?: SessionControlMode;
  sensitiveMode?: boolean;
  reason?: string;
}

// ─── Quick Action Types ────────────────────────────────────────────────────

export interface ScrapeRequest {
  url: string;
  waitFor?: string | number;
  headers?: Record<string, string>;
  cookies?: Array<{ name: string; value: string; domain: string }>;
  proxyUrl?: string;
  stealth?: 'none' | 'basic' | 'full';
  timeout?: number;
}

export interface ScrapeResponse {
  url: string;
  statusCode: number;
  title: string;
  html: string;
  cleanedHtml: string;
  markdown: string;
  readability: string;
  links: Array<{ href: string; text: string }>;
  metadata: {
    description?: string;
    ogImage?: string;
    canonical?: string;
  };
}

export interface ScreenshotRequest {
  url: string;
  fullPage?: boolean;
  viewport?: { width: number; height: number };
  quality?: number;
  format?: 'png' | 'jpeg' | 'webp';
  waitFor?: string | number;
  proxyUrl?: string;
  stealth?: 'none' | 'basic' | 'full';
  timeout?: number;
}

export interface PdfRequest {
  url: string;
  format?: 'A4' | 'Letter' | 'Legal';
  landscape?: boolean;
  printBackground?: boolean;
  margin?: { top?: string; right?: string; bottom?: string; left?: string };
  waitFor?: string | number;
  proxyUrl?: string;
  stealth?: 'none' | 'basic' | 'full';
  timeout?: number;
}

// ─── Computer API Types ────────────────────────────────────────────────────

export type BrowserAction =
  | { type: 'screenshot' }
  | { type: 'click'; x: number; y: number; button?: 'left' | 'right' | 'middle'; clickCount?: number }
  | { type: 'type'; text: string }
  | { type: 'press_key'; key: string }
  | { type: 'scroll'; x?: number; y?: number; deltaX?: number; deltaY?: number }
  | { type: 'move_mouse'; x: number; y: number }
  | { type: 'wait'; duration: number }
  | { type: 'navigate'; url: string };

export interface ActionRequest {
  actions: BrowserAction[];
}

export interface ActionResponse {
  results: Array<{
    type: string;
    success: boolean;
    screenshot?: string;
    error?: string;
  }>;
}

// ─── CAPTCHA Types ─────────────────────────────────────────────────────────

export interface CaptchaSolveRequest {
  type?: 'auto' | 'recaptcha' | 'hcaptcha' | 'turnstile';
}

export interface CaptchaSolveResponse {
  success: boolean;
  type: string;
  duration: number;
  error?: string;
}

// ─── Profile Types ─────────────────────────────────────────────────────────

export interface Profile {
  id: string;
  name: string;
  provider?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

export interface CreateProfileRequest {
  name: string;
  provider?: string;
}

// ─── Agent Types ──────────────────────────────────────────────────────────

export interface AgentRequest {
  task: string;
  url?: string;
  provider?: 'anthropic' | 'openai';
  model?: string;
  maxIterations?: number;
  apiKey?: string;
}

export interface AgentResult {
  success: boolean;
  result?: string;
  error?: string;
  steps: Array<{
    iteration: number;
    reasoning: string;
    actions: Array<Record<string, unknown>>;
    screenshot?: string;
  }>;
  totalIterations: number;
  sessionId?: string;
}

// ─── Usage Types ───────────────────────────────────────────────────────────

export interface UsageStats {
  totalSessions: number;
  activeSessions: number;
  totalBrowserHours: number;
  todayBrowserHours: number;
  todayApiCalls: number;
  daily: Array<{ date: string; sessions: number; browserHours: number; apiCalls: number }>;
}
