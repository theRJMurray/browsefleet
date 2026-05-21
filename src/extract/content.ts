import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

export function extractContent(html: string, url: string) {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  // Extract metadata
  const title = doc.querySelector('title')?.textContent?.trim() ?? '';
  const description =
    doc.querySelector('meta[name="description"]')?.getAttribute('content') ?? undefined;
  const ogImage =
    doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? undefined;
  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? undefined;

  // Extract links
  const links: Array<{ href: string; text: string }> = [];
  doc.querySelectorAll('a[href]').forEach((a: Element) => {
    const href = a.getAttribute('href') ?? '';
    const text = a.textContent?.trim() ?? '';
    if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
      links.push({ href, text });
    }
  });

  // Cleaned HTML — remove scripts, styles, hidden elements
  const cleanDoc = new JSDOM(html, { url }).window.document;
  cleanDoc
    .querySelectorAll('script, style, noscript, iframe, svg, link[rel="stylesheet"]')
    .forEach((el: Element) => el.remove());
  cleanDoc
    .querySelectorAll(
      '[style*="display:none"], [style*="display: none"], [hidden], [aria-hidden="true"]',
    )
    .forEach((el: Element) => el.remove());
  cleanDoc.querySelectorAll('nav, header, footer').forEach((el: Element) => el.remove());
  const cleanedHtml = cleanDoc.body?.innerHTML?.trim() ?? '';

  // Markdown
  const markdown = turndown.turndown(cleanedHtml);

  // Readability
  const readDoc = new JSDOM(html, { url }).window.document;
  const reader = new Readability(readDoc);
  const article = reader.parse();
  const readability = article?.textContent?.trim() ?? '';

  return {
    title,
    cleanedHtml,
    markdown,
    readability,
    links,
    metadata: { description, ogImage, canonical },
  };
}
