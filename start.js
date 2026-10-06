import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns';
import { pipeline } from 'node:stream/promises';
import { config, validateConfig } from './src/config.js';

// Prioritize IPv4 DNS lookups to avoid container IPv6 connect timeouts on cloud hosts
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}

const LAVALINK_JAR = path.resolve('Lavalink.jar');
const LAVALINK_MIRRORS = [
  'https://github.com/lavalink-devs/Lavalink/releases/download/4.2.2/Lavalink.jar',
  'https://github.com/lavalink-devs/Lavalink/releases/latest/download/Lavalink.jar',
];

let lavalinkProcess = null;
let botProcess = null;

/**
 * Recursively searches a directory for a java binary.
 */
function searchForJavaInDir(dir) {
  if (!fs.existsSync(dir)) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = searchForJavaInDir(fullPath);
        if (nested) return nested;
      } else if (entry.isFile() && (entry.name === 'java' || entry.name === 'java.exe')) {
        if (fullPath.includes(`${path.sep}bin${path.sep}`)) {
          return fullPath;
        }
      }
    }
  } catch {}
  return null;
}

/**
 * Finds an existing Java 17+ binary on the system.
 */
function findJavaBinary() {
  const isWindows = process.platform === 'win32';
  const candidates = [];

  // 1. Local .jre directory if present
  const localJre = searchForJavaInDir(path.resolve('.jre'));
  if (localJre) {
    if (process.platform === 'linux') {
      try { fs.chmodSync(localJre, 0o755); } catch {}
    }
    candidates.push(localJre);
  }

  // 2. JAVA_HOME environment variable
  if (process.env.JAVA_HOME) {
    candidates.push(path.join(process.env.JAVA_HOME, 'bin', isWindows ? 'java.exe' : 'java'));
  }

  // 3. Windows specific common paths
  if (isWindows) {
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const adoptiumDir = path.join(programFiles, 'Eclipse Adoptium');
    if (fs.existsSync(adoptiumDir)) {
      const subdirs = fs.readdirSync(adoptiumDir);
      for (const sub of subdirs) {
        const binPath = path.join(adoptiumDir, sub, 'bin', 'java.exe');
        if (fs.existsSync(binPath)) candidates.push(binPath);
      }
    }
  }

  // 4. Default system PATH
  candidates.push('java');

  for (const bin of candidates) {
    try {
      const output = execSync(`"${bin}" -version`, { stdio: 'pipe', encoding: 'utf8', timeout: 5000 });
      const match = output.match(/version "(1[7-9]|[2-9][0-9])\./) || output.match(/openjdk (1[7-9]|[2-9][0-9])\./);
      if (match) {
        return bin;
      }
    } catch {
      // Continue checking next candidate
    }
  }

  return null;
}

/**
 * Downloads and extracts a portable headless OpenJDK 17 for Linux containers (e.g. Wispbyte / Bot-Hosting.net).
 */
async function ensureLinuxJavaRuntime() {
  const jreDir = path.resolve('.jre');
  if (!fs.existsSync(jreDir)) {
    fs.mkdirSync(jreDir, { recursive: true });
  }

  const existingJava = searchForJavaInDir(jreDir);
  if (existingJava) {
    try {
      fs.chmodSync(existingJava, 0o755);
      execSync(`"${existingJava}" -version`, { stdio: 'pipe', timeout: 5000 });
      return existingJava;
    } catch {}
  }

  console.log('[Host Bootstrapper] No Java 17+ found in Node container. Auto-provisioning portable Linux OpenJDK 17...');
  const tarPath = path.join(jreDir, 'jre.tar.gz');

  const JRE_MIRRORS = [
    'https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jre/hotspot/normal/eclipse',
    'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.12%2B7/OpenJDK17U-jre_x64_linux_hotspot_17.0.12_7.tar.gz',
  ];

  let downloaded = false;
  for (const url of JRE_MIRRORS) {
    try {
      console.log(`[Host Bootstrapper] Fetching JRE from mirror...`);
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(45000) });
      if (!res.ok) continue;

      const fileStream = fs.createWriteStream(tarPath);
      await pipeline(res.body, fileStream);
      downloaded = true;
      break;
    } catch (err) {
      console.warn(`[Host Bootstrapper] JRE mirror attempt failed: ${err.message}`);
      try { fs.unlinkSync(tarPath); } catch {}
    }
  }

  if (!downloaded) {
    throw new Error('All portable JRE download mirrors failed. Please ensure network access or upload .jre folder.');
  }

  console.log('[Host Bootstrapper] Extracting portable Java runtime...');
  execSync(`tar -xzf "${tarPath}" -C "${jreDir}"`, { stdio: 'pipe' });
  try { fs.unlinkSync(tarPath); } catch {}

  const javaBinary = searchForJavaInDir(jreDir);
  if (!javaBinary) {
    throw new Error('Portable JRE extracted, but java binary was not found.');
  }

  try {
    fs.chmodSync(javaBinary, 0o755);
  } catch {}

  console.log(`[Host Bootstrapper] Portable Java 17 successfully installed: ${javaBinary}`);
  return javaBinary;
}

/**
 * Ensures a working Java 17+ binary is available.
 */
async function ensureJavaBinary() {
  const found = findJavaBinary();
  if (found) return found;

  if (process.platform === 'linux') {
    return await ensureLinuxJavaRuntime();
  }

  throw new Error('Java 17+ is required to run Lavalink. Please install OpenJDK 17 or set JAVA_HOME.');
}

/**
 * Automatically downloads Lavalink.jar if missing.
 */
async function ensureLavalinkJar() {
  if (fs.existsSync(LAVALINK_JAR)) {
    const stats = fs.statSync(LAVALINK_JAR);
    if (stats.size > 10_000_000) {
      console.log(`[Host Bootstrapper] Lavalink.jar detected (${(stats.size / 1024 / 1024).toFixed(1)} MB).`);
      return false; // Not a fresh download
    }
  }

  console.log('[Host Bootstrapper] Lavalink.jar missing. Downloading from release mirrors...');
  for (const url of LAVALINK_MIRRORS) {
    try {
      console.log(`[Host Bootstrapper] Downloading Lavalink.jar...`);
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
      if (!res.ok) continue;

      const fileStream = fs.createWriteStream(LAVALINK_JAR);
      await pipeline(res.body, fileStream);
      console.log('[Host Bootstrapper] Lavalink.jar downloaded successfully!');
      return true; // Fresh download
    } catch (err) {
      console.warn(`[Host Bootstrapper] Lavalink download attempt failed: ${err.message}`);
      try { fs.unlinkSync(LAVALINK_JAR); } catch {}
    }
  }

  throw new Error('Failed to download Lavalink.jar from all available mirrors.');
}

/**
 * Polls Lavalink REST API until it is healthy and accepting connections.
 */
async function waitForLavalink(host, port, password, maxWaitMs = 180000) {
  const url = `http://${host}:${port}/v4/info`;
  const start = Date.now();
  let lastLoggedSec = 0;

  console.log(`[Host Bootstrapper] Waiting for Lavalink to initialize on ${host}:${port} (up to ${maxWaitMs / 1000}s)...`);

  while (Date.now() - start < maxWaitMs) {
    if (lavalinkProcess && lavalinkProcess.exitCode !== null) {
      throw new Error(`Lavalink process terminated prematurely with code ${lavalinkProcess.exitCode}`);
    }

    try {
      const res = await fetch(url, {
        headers: { Authorization: password },
        signal: AbortSignal.timeout(2000),
      });

      if (res.ok) {
        console.log('[Host Bootstrapper] Lavalink server is ready and healthy!');
        return true;
      }
    } catch {
      // Still booting or loading plugins
    }

    const elapsedSec = Math.floor((Date.now() - start) / 1000);
    if (elapsedSec > 0 && elapsedSec % 15 === 0 && elapsedSec !== lastLoggedSec) {
      console.log(`[Host Bootstrapper] Still waiting for Lavalink (${elapsedSec}s elapsed)...`);
      lastLoggedSec = elapsedSec;
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error(`Lavalink failed to become ready within ${maxWaitMs / 1000} seconds.`);
}

/**
 * Starts the Lavalink server process.
 */
function startLavalink(javaBin) {
  // Purge stale/cached plugin jars before launch.
  // Lavalink will re-download ONLY what application.yml declares (youtube-plugin only).
  // This prevents lavasrc-plugin from being loaded from a leftover cached jar.
  try {
    const pluginsDir = path.resolve('plugins');
    if (fs.existsSync(pluginsDir)) {
      const files = fs.readdirSync(pluginsDir);
      let removed = 0;
      for (const file of files) {
        if (!file.toLowerCase().includes('youtube')) {
          // Delete anything that is NOT the youtube plugin
          fs.unlinkSync(path.join(pluginsDir, file));
          removed++;
        }
      }
      if (removed > 0) {
        console.log(`[Host Bootstrapper] Cleaned ${removed} stale plugin file(s) from plugins/ directory.`);
      }
    }
  } catch (e) {
    console.warn('[Host Bootstrapper] Could not clean plugins directory:', e.message);
  }

  // Aggressive memory minimization for Pterodactyl free-tier containers.
  // SerialGC uses ~30% less native memory than G1GC. MetaspaceSize caps JVM class metadata.
  // TieredStopAtLevel=1 disables the heavy C2 JIT compiler (saves 30-50MB).
  const jvmArgs = [
    '-Xmx128m',                    // Hard heap cap (was 256m — cut in half)
    '-Xms32m',                     // Start with minimal heap footprint
    '-XX:+UseSerialGC',            // Lowest memory overhead GC (no G1 region bookkeeping)
    '-XX:MaxMetaspaceSize=64m',    // Cap class metadata memory
    '-XX:CompressedClassSpaceSize=32m', // Cap compressed class pointer space
    '-Xss512k',                    // Reduce per-thread stack size (was default 512k-1m)
    '-XX:TieredStopAtLevel=1',     // Disable C2 JIT compiler — saves 30-50MB RAM
    '-XX:+DisableExplicitGC',      // Ignore System.gc() calls from plugins
    '-jar',
    LAVALINK_JAR,
  ];

  console.log(`[Host Bootstrapper] Spawning Lavalink with: "${javaBin}" ${jvmArgs.join(' ')}`);

  lavalinkProcess = spawn(javaBin, jvmArgs, {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  lavalinkProcess.stdout.on('data', (chunk) => {
    process.stdout.write(`[Lavalink] ${chunk.toString()}`);
  });

  lavalinkProcess.stderr.on('data', (chunk) => {
    process.stderr.write(`[Lavalink ERR] ${chunk.toString()}`);
  });

  lavalinkProcess.on('exit', (code, signal) => {
    console.warn(`[Lavalink] Process exited with code ${code} (${signal})`);
  });
}

/**
 * Launches the Discord music bot.
 */
function startBot() {
  console.log('[Host Bootstrapper] Launching Discord Music Bot...');

  botProcess = spawn('node', ['src/index.js'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });

  botProcess.on('exit', (code, signal) => {
    console.log(`[Bot] Bot process exited with code ${code} (${signal})`);
    if (code !== 0 && lavalinkProcess) {
      shutdown(code || 1);
    }
  });
}

/**
 * Clean shutdown handler for hosting environments (SIGTERM/SIGINT).
 */
function shutdown(exitCode = 0) {
  console.log('\n[Host Bootstrapper] Shutting down all services...');

  if (botProcess) {
    try {
      botProcess.kill('SIGTERM');
    } catch {}
  }

  if (lavalinkProcess) {
    try {
      lavalinkProcess.kill('SIGTERM');
    } catch {}
  }

  setTimeout(() => process.exit(exitCode), 1500);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// --- Main Orchestrator ---
async function bootstrap() {
  console.log('=============================================');
  console.log('🚀 Automated Hosting Orchestrator Starting');
  console.log('=============================================');

  validateConfig();

  const resolvedPort = config.lavalink.port;
  console.log(`[Host Bootstrapper] Lavalink port resolved to: ${resolvedPort} (SERVER_PORT=${process.env.SERVER_PORT || 'not set'}, LAVALINK_PORT=${process.env.LAVALINK_PORT || 'not set'})`);

  const isLocalLavalink = config.lavalink.host === '127.0.0.1' || config.lavalink.host === 'localhost';

  if (isLocalLavalink) {
    // 1. Ensure Lavalink.jar binary exists
    const isColdStart = await ensureLavalinkJar();

    // 2. Locate Java 17+ runtime
    const javaBin = await ensureJavaBinary();
    console.log(`[Host Bootstrapper] Java runtime resolved: ${javaBin}`);

    // 3. Start Lavalink
    startLavalink(javaBin);

    // 4. Wait for health check
    // Cold start (first ever boot) = 5 minutes: must download plugins + initialize all sources.
    // Warm start (plugins cached)  = 2 minutes: only needs to load from disk.
    const lavalinkTimeout = isColdStart ? 300_000 : 120_000;
    if (isColdStart) {
      console.log('[Host Bootstrapper] Cold start detected (Lavalink.jar was freshly downloaded). Allowing up to 5 minutes for plugin downloads...');
    }
    await waitForLavalink(config.lavalink.host, config.lavalink.port, config.lavalink.password, lavalinkTimeout);
  } else {
    console.log(`[Host Bootstrapper] Connecting to remote Lavalink node: ${config.lavalink.host}:${config.lavalink.port}`);
  }

  // 5. Deploy slash commands to Discord
  try {
    console.log('[Host Bootstrapper] Verifying slash commands registration...');
    execSync('node src/deploy-commands.js', { stdio: 'inherit' });
  } catch (err) {
    console.warn('[Host Bootstrapper] Command deployment warning:', err.message);
  }

  // 6. Start the Discord Bot
  startBot();
}

bootstrap().catch((err) => {
  console.error('[Host Bootstrapper Fatal Error]:', err);
  shutdown(1);
});
