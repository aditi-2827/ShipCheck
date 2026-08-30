#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const DEFAULT_SERVER_URL = 'http://localhost:3140';

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

async function requestApi(serverUrl, apiPath, method = 'GET', body = null, cookie = null) {
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
      reject(new Error(`Could not connect to ShipCheck server at ${serverUrl}: ${err.message}`));
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function authenticate(serverUrl) {
  const password = process.env.SHIPCHECK_PASSWORD;
  const globalRc = readGlobalRc();

  if (globalRc.sessionCookie) {
    try {
      const meRes = await requestApi(serverUrl, '/api/auth/me', 'GET', null, globalRc.sessionCookie);
      if (meRes.statusCode === 200 && meRes.data && meRes.data.ok) {
        return globalRc.sessionCookie;
      }
    } catch {
      // Ignore
    }
  }

  if (password) {
    try {
      const loginRes = await requestApi(serverUrl, '/api/auth/login', 'POST', { password });
      if (loginRes.cookie) {
        writeGlobalRc({ sessionCookie: loginRes.cookie });
        return loginRes.cookie;
      }
    } catch {
      // Ignore
    }
  }

  return null;
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

async function handleInit() {
  const currentDir = process.cwd();
  const folderName = path.basename(currentDir);

  const existingConfig = findProjectConfig(currentDir);
  const serverUrl = process.env.SHIPCHECK_SERVER_URL || existingConfig?.serverUrl || DEFAULT_SERVER_URL;

  console.log(`Registering project "${folderName}" with ShipCheck server (${serverUrl})...\n`);

  const cookie = await authenticate(serverUrl);

  const res = await requestApi(serverUrl, '/api/projects/init', 'POST', { name: folderName }, cookie);
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

  console.log('✓ Project registered');
  console.log(`Project:    ${project.name}`);
  console.log(`Project ID: ${project.id}\n`);
  console.log('Dashboard:');
  console.log(`${serverUrl}/project/${project.id}`);
}

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

  const cookie = await authenticate(serverUrl);

  const scanRes = await requestApi(
    serverUrl,
    '/api/scan',
    'POST',
    {
      projectId,
      targetDir: currentDir,
    },
    cookie,
  );

  if (scanRes.statusCode !== 201 && scanRes.statusCode !== 200) {
    const msg = scanRes.data && scanRes.data.error ? scanRes.data.error.message : `HTTP ${scanRes.statusCode}`;
    throw new Error(`Scan failed: ${msg}`);
  }

  const result = scanRes.data.data;
  const dashboardUrl = `${serverUrl}/project/${projectId}`;
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
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    if (command === 'init') {
      await handleInit();
    } else if (command === 'scan') {
      await handleScan();
    } else {
      console.log('ShipCheck CLI\n');
      console.log('Usage:');
      console.log('  shipcheck init   - Register the current project with ShipCheck');
      console.log('  shipcheck scan   - Analyze the current project');
      process.exit(command ? 1 : 0);
    }
  } catch (err) {
    console.error(`\n✖ Error: ${err.message}`);
    process.exit(1);
  }
}

main();
