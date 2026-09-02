import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Publish the boot token (when the server was started with one) to the CLI's rc
// file, so `shipcheck init` / `shipcheck scan` can discover it no matter how this
// server was started (`shipcheck server`, `npm run dev`, `next start -p N`).
if (process.env.SHIPCHECK_BOOT_TOKEN) {
  try {
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
    const rcFile = path.join(home, '.shipcheckrc');
    let existing = {};
    try {
      existing = JSON.parse(fs.readFileSync(rcFile, 'utf8'));
    } catch {
      // No rc file yet
    }
    fs.writeFileSync(
      rcFile,
      JSON.stringify({ ...existing, bootToken: process.env.SHIPCHECK_BOOT_TOKEN }, null, 2),
      'utf8',
    );
  } catch {
    // Best-effort write; the CLI also records the token itself.
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: false,
    optimizePackageImports: ['lucide-react'],
  },
  webpack(config, { isServer }) {
    if (isServer) {
      // Keep heavy Phase 3 scanning dependencies out of the server bundle so
      // they load via runtime `require` from node_modules at scan time only.
      // Bundling them (webpack static analysis) produces fragile
      // import.meta/expression warnings and bloats the server payload.
      const external = (ctx) =>
        ['lighthouse', 'puppeteer', '@sentry/node', '@opentelemetry/instrumentation', 'require-in-the-middle'].includes(
          ctx.request,
        );
      if (typeof config.externals === 'function') {
        const orig = config.externals;
        config.externals = (...args) => {
          if (external(args[0])) return true;
          return orig(...args);
        };
      } else if (Array.isArray(config.externals)) {
        config.externals.push(external);
      } else {
        config.externals = [external];
      }
    }
    return config;
  },
};

export default nextConfig;