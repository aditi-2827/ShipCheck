#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');

const DEFAULT_SERVER_URL = 'http://localhost:3140';

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const NEXT_BIN = path.join(PACKAGE_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');

function getHomeDir() {
  return process.env.HOME || process.env.USERPROFILE || process.cwd();
}

function getGlobalRcPath() {
  return path.join(getHomeDir(), '.shipcheckrc');
}

function readGlobalRc() {
  try {
    const rcFile = getGlobalRcPath();
    if (fs.existsSync(rcFile)) {
      return JSON.parse(fs.readFileSync(rcFile, 'utf8'));
    }
  } catch {
    // Ignore corrupt rc
  }
  return {};
}

function writeGlobalRc(data) {
  try {
    const rcFile = getGlobalRcPath();
    const existing = readGlobalRc();
    fs.writeFileSync(rcFile, JSON.stringify({ ...existing, ...data }, null, 2), 'utf8');
  } catch {
    // Best-effort write
  }
}

async function requestApi(serverUrl, apiPath, method = 'GET', body = null, cookie = null, token = null) {
  const url = new URL(apiPath, serverUrl);
  const isHttps = url.protocol === 'https:';
  const client = isHttps ? https : http;

  const payload = body ? JSON.stringify(body) : null;
  const headers = {
    'Content-Type': 'application/json',
  };
  if (payload) {
    headers['Content-Length'] = Buffer.byteLength(payload);
  }
  if (cookie) {
    headers['Cookie'] = cookie;
  }
  if (token) {
    headers['x-shipcheck-token'] = token;
  }

  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method,
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let json;
          try {
            json = JSON.parse(raw);
          } catch {
            return reject(new Error(`Server returned status ${res.statusCode}: ${raw.slice(0, 100)}`));
          }

          const setCookieHeader = res.headers['set-cookie'];
          let sessionCookie = cookie;
          if (setCookieHeader && Array.isArray(setCookieHeader)) {
            const sc = setCookieHeader.find((c) => c.startsWith('sc_session=') || c.startsWith('shipcheck_session='));
            if (sc) {
              sessionCookie = sc.split(';')[0];
            }
          }

          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: json,
            cookie: sessionCookie,
          });
        });
      },
    );

    req.on('error', (err) => {
      reject(
        new Error(
          `Could not connect to ShipCheck server at ${serverUrl}: ${err.message}\n` +
            `Start it with \`shipcheck server\`, or if it runs on a different port ` +
            `(e.g. \`npm run dev\` on 3000), set SHIPCHECK_SERVER_URL.`,
        ),
      );
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

// Resolve how the CLI authenticates with the server. Priority:
//   1. Boot token (SHIPCHECK_BOOT_TOKEN env when the CLI spawned the server, or
//      the last token persisted to ~/.shipcheckrc by `shipcheck server`) sent as
//      x-shipcheck-token.
//   2. Persisted session cookie.
//   3. Password login (SHIPCHECK_PASSWORD) -> gets a fresh session cookie.
// Returns { token, cookie }; at least one is set on success.
async function authenticate(serverUrl) {
  const globalRc = readGlobalRc();
  const bootToken = process.env.SHIPCHECK_BOOT_TOKEN || globalRc.bootToken || null;

  if (bootToken) {
    try {
      const meRes = await requestApi(serverUrl, '/api/auth/me', 'GET', null, null, bootToken);
      if (
        meRes.statusCode === 200 &&
        meRes.data &&
        meRes.data.ok &&
        meRes.data.data &&
        meRes.data.data.authenticated
      ) {
        return { token: bootToken, cookie: null };
      }
    } catch {
      // Ignore
    }
  }

  if (globalRc.sessionCookie) {
    try {
      const meRes = await requestApi(serverUrl, '/api/auth/me', 'GET', null, globalRc.sessionCookie);
      if (
        meRes.statusCode === 200 &&
        meRes.data &&
        meRes.data.ok &&
        meRes.data.data &&
        meRes.data.data.authenticated
      ) {
        return { token: null, cookie: globalRc.sessionCookie };
      }
    } catch {
      // Ignore
    }
  }

  const password = process.env.SHIPCHECK_PASSWORD;
  if (password) {
    try {
      const loginRes = await requestApi(serverUrl, '/api/auth/login', 'POST', { password });
      if (loginRes.cookie) {
        writeGlobalRc({ sessionCookie: loginRes.cookie });
        return { token: null, cookie: loginRes.cookie };
      }
    } catch {
      // Ignore
    }
  }

  return { token: null, cookie: null };
}

function parseArgs(args) {
  const out = { command: args[0], flags: {}, positionals: [] };
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--dev') {
      out.flags.dev = true;
    } else if (arg === '--port') {
      out.flags.port = Number(args[++i]);
    } else if (arg === '--host') {
      out.flags.host = args[++i];
    } else {
      out.positionals.push(arg);
    }
  }
  return out;
}

function waitForServerReady(serverUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = async () => {
      if (Date.now() > deadline) {
        return reject(new Error('Timed out waiting for the ShipCheck server to start.'));
      }
      try {
        const res = await requestApi(serverUrl, '/api/feed', 'GET');
        if (res.statusCode === 200 && res.data && res.data.ok) {
          return resolve(true);
        }
      } catch {
        // Not up yet; keep polling.
      }
      setTimeout(poll, 400);
    };
    poll();
  });
}

// Run `next build` in the package root so `shipcheck server` always works
// regardless of whether a `.next` production build already exists.
function runNextBuild() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [NEXT_BIN, 'build'], { cwd: PACKAGE_ROOT, stdio: 'inherit' });
    child.on('error', (err) => reject(new Error(`Could not run \`next build\`: ${err.message}`)));
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`\`next build\` failed with exit code ${code}`))));
  });
}

async function isServerUp(serverUrl) {
  try {
    const res = await requestApi(serverUrl, '/api/feed', 'GET');
    return res.statusCode === 200 && res.data && res.data.ok;
  } catch {
    return false;
  }
}

// `shipcheck server` - start the bundled Next.js server (production `next start`
// unless --dev), print the clickable dashboard link, and stay attached until the
// server exits. If a ShipCheck server is already running on the port, it is
// reused instead of spawning a duplicate.
async function handleServer(flags) {
  const dev = Boolean(flags.dev);
  const port = Number(flags.port) || Number(process.env.SHIPCHECK_PORT) || 3140;
  const host = flags.host || process.env.SHIPCHECK_HOST || '127.0.0.1';
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;
  const baseUrl = `http://${displayHost}:${port}`;

  // Reuse the previous boot token when possible so links and `shipcheck init` /
  // `shipcheck scan` keep working across server restarts on the same machine.
  const bootToken = readGlobalRc().bootToken || crypto.randomBytes(32).toString('hex');

  // Something already answers on this port - reuse it when our token matches.
  if (await isServerUp(baseUrl)) {
    let tokenOk = false;
    try {
      const meRes = await requestApi(baseUrl, '/api/auth/me', 'GET', null, null, bootToken);
      tokenOk = meRes.statusCode === 200 && meRes.data && meRes.data.data && meRes.data.data.authenticated === true;
    } catch {
      tokenOk = false;
    }
    if (tokenOk) {
      writeGlobalRc({ bootToken, serverUrl: baseUrl });
      console.log('\nShipCheck server is already running.\n');
      console.log(`Dashboard:  ${baseUrl}/?token=${bootToken}\n`);
      return;
    }
    throw new Error(
      `A ShipCheck server is already running at ${baseUrl} but it was started with a different token.\n` +
        `Use that instance's own dashboard link, or start a separate one with \`shipcheck server --port N\`.`,
    );
  }

  if (!fs.existsSync(NEXT_BIN)) {
    throw new Error(`Next.js binary not found at ${NEXT_BIN}. Are the dependencies installed?`);
  }
  const buildFile = path.join(PACKAGE_ROOT, '.next', 'BUILD_ID');
  if (!dev && !fs.existsSync(buildFile)) {
    console.log('No production build found. Building ShipCheck first (can take a minute)...\n');
    await runNextBuild();
  }

  // Persist the token/URL before starting so the CLI can authenticate even if
  // the server takes a moment to boot.
  writeGlobalRc({ bootToken, serverUrl: baseUrl });

  const mode = dev ? 'dev' : 'start';
  const nextArgs = [NEXT_BIN, mode, '-p', String(port), '-H', host];
  const child = spawn(process.execPath, nextArgs, {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, SHIPCHECK_BOOT_TOKEN: bootToken },
    stdio: 'inherit',
  });

  child.on('error', (err) => {
    console.error(`\n✖ Failed to start Next.js: ${err.message}`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.exit(0);
    }
    process.exit(code ?? 0);
  });
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));

  await waitForServerReady(baseUrl, dev ? 60000 : 20000);

  // Confirm our boot token is accepted; otherwise warn that an already running
  // server (with a different token) is occupying the port.
  let tokenOk = false;
  try {
    const meRes = await requestApi(baseUrl, '/api/auth/me', 'GET', null, null, bootToken);
    tokenOk = meRes.statusCode === 200 && meRes.data && meRes.data.data && meRes.data.data.authenticated === true;
  } catch {
    tokenOk = false;
  }

  console.log('\nShipCheck server is running.\n');
  console.log(`Dashboard:  ${baseUrl}/?token=${bootToken}`);
  if (!tokenOk) {
    console.log(
      `\nWarning: this port is already serving a ShipCheck instance with a different token.\n` +
        `Use a different port (\`shipcheck server --port N\`) or open the other instance's link.`,
    );
  }
  console.log(`\nToken:      ${bootToken}`);
  console.log('Tip: append ?token=<token> to a project link to open it directly.\n');
}

function findProjectConfig(dir) {
  const file = path.join(dir, '.shipcheck.json');
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }
  return null;
}

// Register the current directory as a tracked project.
async function handleInit() {
  const currentDir = process.cwd();
  const folderName = path.basename(currentDir);

  const existingConfig = findProjectConfig(currentDir);
  const serverUrl = process.env.SHIPCHECK_SERVER_URL || existingConfig?.serverUrl || DEFAULT_SERVER_URL;

  console.log(`Registering project "${folderName}" with ShipCheck server (${serverUrl})...\n`);

  const auth = await authenticate(serverUrl);
  if (!auth.token && !auth.cookie) {
    throw new Error(
      'Authentication required. Start the server with `shipcheck server` and open the link it prints, ' +
        'or set SHIPCHECK_PASSWORD. If your server runs on a port other than 3140, set SHIPCHECK_SERVER_URL.',
    );
  }

  const res = await requestApi(
    serverUrl,
    '/api/projects/init',
    'POST',
    { name: folderName, targetDir: currentDir },
    auth.cookie,
    auth.token,
  );
  if (res.statusCode !== 201 && res.statusCode !== 200) {
    const msg = res.data && res.data.error ? res.data.error.message : `HTTP ${res.statusCode}`;
    throw new Error(`Project initialization failed: ${msg}`);
  }

  const project = res.data.data;
  const configFile = path.join(currentDir, '.shipcheck.json');
  const configContent = {
    projectId: project.id,
    projectName: project.name,
    serverUrl,
  };

  fs.writeFileSync(configFile, JSON.stringify(configContent, null, 2), 'utf8');

  const dashSuffix = auth.token ? `?token=${auth.token}` : '';
  console.log('✓ Project registered');
  console.log(`Project:    ${project.name}`);
  console.log(`Project ID: ${project.id}\n`);
  console.log('Dashboard:');
  console.log(`${serverUrl}/project/${project.id}${dashSuffix}`);
}

// Analyze the current project against the running server.
async function handleScan() {
  const currentDir = process.cwd();
  const config = findProjectConfig(currentDir);

  if (!config || !config.projectId) {
    console.error('Error: Project is not initialized with ShipCheck.');
    console.error('Run `shipcheck init` in this directory first.');
    process.exit(1);
  }

  const serverUrl = process.env.SHIPCHECK_SERVER_URL || config.serverUrl || DEFAULT_SERVER_URL;
  const projectId = config.projectId;
  const projectName = config.projectName || path.basename(currentDir);

  console.log(`Scanning project... (${currentDir})\n`);

  const auth = await authenticate(serverUrl);
  if (!auth.token && !auth.cookie) {
    throw new Error(
      'Authentication required. Start the server with `shipcheck server` and open the link it prints, ' +
        'or set SHIPCHECK_PASSWORD. If your server runs on a port other than 3140, set SHIPCHECK_SERVER_URL.',
    );
  }

  const scanRes = await requestApi(
    serverUrl,
    '/api/scan',
    'POST',
    {
      projectId,
      targetDir: currentDir,
    },
    auth.cookie,
    auth.token,
  );

  if (scanRes.statusCode !== 201 && scanRes.statusCode !== 200) {
    const msg = scanRes.data && scanRes.data.error ? scanRes.data.error.message : `HTTP ${scanRes.statusCode}`;
    throw new Error(`Scan failed: ${msg}`);
  }

  const result = scanRes.data.data;
  const dashSuffix = auth.token ? `?token=${auth.token}` : '';
  const dashboardUrl = `${serverUrl}/project/${projectId}${dashSuffix}`;
  const durationSec = ((result.env?.durationMs || 0) / 1000).toFixed(1);

  console.log('SHIPCHECK');
  console.log('────────────────────────────────\n');
  console.log(`Project       ${projectName}`);
  console.log(`Commit        ${result.env?.commit || 'n/a'}`);
  console.log(`Branch        ${result.env?.branch || 'n/a'}\n`);

  console.log(`SHIP SCORE    ${result.score}/100`);
  console.log(`STATUS        ${result.status}\n`);

  if (Array.isArray(result.categories)) {
    for (const cat of result.categories) {
      const statusTag = cat.status === 'pass' ? 'PASS' : cat.status === 'critical' ? 'FAIL' : 'WARN';
      const paddedName = cat.name.padEnd(14, ' ');
      console.log(`${paddedName}${statusTag}`);
    }
  }

  console.log('\n────────────────────────────────');

  if (result.comparison) {
    const delta = result.comparison.scoreDelta;
    const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;
    console.log(`CHANGE        ${deltaStr}\n`);

    const resolved = result.comparison.resolvedIssues || [];
    const introduced = result.comparison.introducedIssues || [];

    if (resolved.length > 0) {
      console.log(`✓ ${resolved.length} issue(s) resolved:`);
      for (const item of resolved) {
        console.log(`  • ${item.title}`);
      }
    } else {
      console.log(`✓ 0 issues resolved`);
    }

    if (introduced.length > 0) {
      console.log(`⚠ ${introduced.length} issue(s) introduced:`);
      for (const item of introduced) {
        console.log(`  • ${item.title}`);
      }
    } else {
      console.log(`⚠ 0 warnings introduced`);
    }
  } else {
    console.log(`CHANGE        (first scan)\n`);
  }

  console.log('\nDashboard');
  console.log(dashboardUrl);
  console.log(`\nScan completed in ${durationSec}s`);
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));

  try {
    if (command === 'server') {
      await handleServer(flags);
    } else if (command === 'init') {
      await handleInit();
    } else if (command === 'scan') {
      await handleScan();
    } else {
      console.log('ShipCheck CLI\n');
      console.log('Usage:');
      console.log('  shipcheck server   - Start the ShipCheck server and print the dashboard link');
      console.log('  shipcheck init     - Register the current project with ShipCheck');
      console.log('  shipcheck scan     - Analyze the current project\n');
      console.log('Server options:');
      console.log('  --port N     Port to bind (default 3140, or SHIPCHECK_PORT)');
      console.log('  --host H     Host to bind (default 127.0.0.1, or SHIPCHECK_HOST)');
      console.log('  --dev        Run `next dev` instead of the production `next start`');
      process.exit(command ? 1 : 0);
    }
  } catch (err) {
    console.error(`\n✖ Error: ${err.message}`);
    process.exit(1);
  }
}

main();