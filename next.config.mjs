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
};

export default nextConfig;