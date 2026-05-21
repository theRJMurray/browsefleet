import { describe, it, expect } from 'vitest';
import { extractContent } from '../src/extract/content.js';

const SIMPLE_HTML = `
<!DOCTYPE html>
<html>
  <head>
    <title>Test Page</title>
    <meta name="description" content="A test page for extractContent" />
    <meta property="og:image" content="https://example.com/image.png" />
    <link rel="canonical" href="https://example.com/canonical" />
  </head>
  <body>
    <h1>Main heading</h1>
    <p>First paragraph of body text. This is long enough to survive readability.</p>
    <p>Second paragraph with more content to give readability something to chew on.</p>
    <a href="https://other.example.com/page">Outbound link</a>
    <a href="/relative/path">Relative link</a>
  </body>
</html>
`;

describe('extractContent', () => {
  it('returns the page title', () => {
    const out = extractContent(SIMPLE_HTML, 'https://example.com/test');
    expect(out.title).toBe('Test Page');
  });

  it('produces non-empty markdown', () => {
    const out = extractContent(SIMPLE_HTML, 'https://example.com/test');
    expect(out.markdown.length).toBeGreaterThan(0);
    expect(out.markdown).toContain('Main heading');
    expect(out.markdown).toContain('First paragraph');
  });

  it('extracts links', () => {
    const out = extractContent(SIMPLE_HTML, 'https://example.com/test');
    expect(out.links.length).toBeGreaterThanOrEqual(1);
    const hrefs = out.links.map((l) => l.href);
    expect(hrefs).toContain('https://other.example.com/page');
  });

  it('captures metadata fields', () => {
    const out = extractContent(SIMPLE_HTML, 'https://example.com/test');
    expect(out.metadata.description).toBe('A test page for extractContent');
    expect(out.metadata.ogImage).toBe('https://example.com/image.png');
    expect(out.metadata.canonical).toBe('https://example.com/canonical');
  });

  it('does not throw on minimal HTML', () => {
    expect(() =>
      extractContent('<html><body>just text</body></html>', 'https://example.com'),
    ).not.toThrow();
  });

  it('does not throw on empty HTML', () => {
    expect(() => extractContent('', 'https://example.com')).not.toThrow();
  });
});
