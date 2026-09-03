// Standalone Lighthouse runner, spawned as a child Node process by the scan
// engine (src/lib/checks.ts). It is deliberately a plain CommonJS file kept
// OUTSIDE the Next.js webpack bundle so puppeteer/lighthouse load from
// node_modules at runtime without webpack static-analysis/require shims.
//
// Usage: node scripts/lighthouse-run.cjs <url>
// Prints a single JSON line to stdout: { perf, lcp, detail }

const { createRequire } = require('node:module');
const path = require('node:path');

const url = process.argv[2];
if (!url) {
  console.log(JSON.stringify({ perf: null, lcp: null, detail: 'Lighthouse runner: no URL provided' }));
  process.exit(0);
}

const nodeRequire = createRequire(path.join(__dirname, 'noop.js'));

(async () => {
  let browser;
  try {
    const puppeteer = nodeRequire('puppeteer');
    const lighthouseMod = nodeRequire('lighthouse');
    const lighthouse = typeof lighthouseMod === 'function' ? lighthouseMod : lighthouseMod.default;
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const page = await browser.newPage();
    const { lhr } = await lighthouse(
      url,
      { onlyCategories: ['performance'], output: 'json', logLevel: 'silent' },
      undefined,
      page,
    );
    const perf = lhr && lhr.categories && lhr.categories.performance && typeof lhr.categories.performance.score === 'number'
      ? Math.round(lhr.categories.performance.score * 100)
      : null;
    const lcpNumeric = lhr && lhr.audits && lhr.audits['largest-contentful-paint']
      ? lhr.audits['largest-contentful-paint'].numericValue
      : null;
    const lcp = typeof lcpNumeric === 'number' ? Math.round(lcpNumeric) : null;
    const detail = perf !== null
      ? `Lighthouse performance: ${perf}/100${lcp ? ` (LCP ${lcp}ms)` : ''}`
      : 'Lighthouse returned no performance score';
    console.log(JSON.stringify({ perf, lcp, detail }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(JSON.stringify({ perf: null, lcp: null, detail: `Lighthouse failed: ${msg}` }));
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
})();
