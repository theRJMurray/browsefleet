// Stealth configuration levels for BrowseFleet
// none: vanilla puppeteer-core, no modifications
// basic: puppeteer-extra-plugin-stealth with default evasions
// full: all evasions + enhanced fingerprinting

export type StealthLevel = 'none' | 'basic' | 'full';

// Additional Chrome args for stealth
export function getStealthArgs(level: StealthLevel): string[] {
  if (level === 'none') return [];

  const args = ['--disable-blink-features=AutomationControlled'];

  if (level === 'full') {
    args.push(
      '--disable-features=IsolateOrigins,site-per-process',
      '--flag-switches-begin',
      '--flag-switches-end',
    );
  }

  return args;
}

// Random but realistic viewport dimensions
export function randomViewport(): { width: number; height: number } {
  const viewports = [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1536, height: 864 },
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 1600, height: 900 },
  ];
  return viewports[Math.floor(Math.random() * viewports.length)];
}

// Random realistic user agent
export function randomUserAgent(): string {
  const agents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  ];
  return agents[Math.floor(Math.random() * agents.length)];
}
