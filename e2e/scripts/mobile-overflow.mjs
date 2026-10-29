// Measures page-level horizontal overflow on phone viewports and saves screenshots.
// Usage: node scripts/mobile-overflow.mjs <baseUrl> <label> <outDir>
// Env: API_BASE (default <baseUrl>/api), ADMIN_EMAIL/ADMIN_PASSWORD, MEMBER_EMAIL/MEMBER_PASSWORD (demo seed accounts).
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const [baseUrl, label, outDir] = process.argv.slice(2);
if (!baseUrl || !label || !outDir) {
  console.error('usage: mobile-overflow.mjs <baseUrl> <label> <outDir>');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
const apiBase = process.env.API_BASE || `${baseUrl}/api`;

const viewports = [
  { width: 375, height: 812 },
  { width: 390, height: 844 },
];

// ADMIN_ROUTES / MEMBER_ROUTES (space-separated) override the default page lists.
const routes = (v) => v && v.split(' ').filter(Boolean).map((r) => [r.replace(/^\/nl\/dashboard\/?/, '').replace(/\//g, '-') || 'root', r]);

const accounts = [
  {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
    pages: routes(process.env.ADMIN_ROUTES) || [
      ['admin', '/nl/dashboard/admin'],
      ['admin-shareholders', '/nl/dashboard/admin/shareholders'],
      ['admin-transactions', '/nl/dashboard/admin/transactions'],
    ],
  },
  {
    email: process.env.MEMBER_EMAIL,
    password: process.env.MEMBER_PASSWORD,
    pages: routes(process.env.MEMBER_ROUTES) || [['member', '/nl/dashboard']],
  },
];

async function login(email, password) {
  const res = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${email} failed: ${res.status}`);
  return res.json();
}

const browser = await chromium.launch();
const rows = [];
let failed = false;

for (const account of accounts) {
  if (!account.email) continue;
  const auth = await login(account.email, account.password);
  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: vp,
      deviceScaleFactor: 2,
      isMobile: process.env.MOBILE !== '0',
      hasTouch: true,
    });
    await context.addInitScript((a) => {
      localStorage.setItem('accessToken', a.accessToken);
      if (a.refreshToken) localStorage.setItem('refreshToken', a.refreshToken);
      localStorage.setItem('user', JSON.stringify(a.user));
      localStorage.setItem('opencoop-cookie-notice-dismissed', '1');
    }, auth);
    const page = await context.newPage();
    for (const [name, route] of account.pages) {
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      // On a phone, a too-wide page widens the layout viewport (innerWidth > device width)
      // and Safari pans it, clipping the left edge. Measure against the device width.
      const m = await page.evaluate((deviceWidth) => {
        const clips = (el) => {
          for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
            const ox = getComputedStyle(a).overflowX;
            if (ox !== 'visible') return true;
          }
          return false;
        };
        const offenders = [];
        for (const el of document.querySelectorAll('body *')) {
          if (el.closest('aside')) continue; // closed off-canvas sidebar
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.right <= deviceWidth + 1) continue;
          if (clips(el)) continue;
          const pr = el.parentElement.getBoundingClientRect();
          if (pr.right > deviceWidth + 1 && el.parentElement !== document.body) continue;
          offenders.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.getAttribute('class') || '').slice(0, 100),
            left: Math.round(r.left),
            right: Math.round(r.right),
          });
        }
        return {
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          offenders: offenders.slice(0, 6),
        };
      }, vp.width);
      const overflow = Math.max(m.scrollWidth, m.innerWidth) - vp.width;
      if (overflow > 0) failed = true;
      rows.push({ label, page: name, viewport: `${vp.width}x${vp.height}`, ...m, overflow });
      await page.screenshot({
        path: path.join(outDir, `${label}-${name}-${vp.width}.png`),
        fullPage: false,
      });
    }
    await context.close();
  }
}
await browser.close();

for (const r of rows) {
  console.log(`${r.label}\t${r.page}\t${r.viewport}\tscrollWidth=${r.scrollWidth}\tinnerWidth=${r.innerWidth}\tdevice=${r.viewport}\toverflow=${r.overflow}`);
  for (const o of r.offenders) console.log(`    ${o.tag} [${o.left}..${o.right}] ${o.cls}`);
}
fs.writeFileSync(path.join(outDir, `${label}-measurements.json`), JSON.stringify(rows, null, 2));
process.exit(failed ? 1 : 0);
