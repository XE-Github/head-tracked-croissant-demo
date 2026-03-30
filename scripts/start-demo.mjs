import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const nodeBinDir = dirname(process.execPath);
const packageLockPath = join(projectRoot, 'package-lock.json');
const installedLockPath = join(projectRoot, 'node_modules', '.package-lock.json');
const startupLogPath = join(projectRoot, 'artifacts', 'startup', 'last-install.log');
const isDryRun = process.argv.includes('--dry-run');
const spawnEnv = createSpawnEnv();

assertSupportedNodeVersion();
const npmCommand = resolveNpmCommand();
ensureDependenciesInstalled();
printRunGuide();

if (isDryRun) {
  console.log('Dry run complete. Startup prerequisites are ready.');
  process.exit(0);
}

startDevServer();

function assertSupportedNodeVersion() {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  const supported = major > 20 || (major === 20 && minor >= 19);

  if (supported) {
    return;
  }

  console.error('This project requires Node.js 20.19.0 or newer.');
  console.error(`Current version: ${process.versions.node}`);
  process.exit(1);
}

function ensureDependenciesInstalled() {
  const nodeModulesPath = join(projectRoot, 'node_modules');
  const hasNodeModules = existsSync(nodeModulesPath);
  const hasCorePackages =
    existsSync(join(projectRoot, 'node_modules', 'vite')) &&
    existsSync(join(projectRoot, 'node_modules', 'three')) &&
    existsSync(join(projectRoot, 'node_modules', '@mediapipe', 'tasks-vision'));
  const lockfileChanged = isLockfileNewerThanInstalledState();

  if (hasNodeModules && hasCorePackages) {
    if (lockfileChanged) {
      console.log('Detected package changes. Existing dependencies are being reused for a stable startup.');
      console.log('If startup ever fails after pulling updates, run `npm install` once and try again.');
    }
    return;
  }

  const installAttempts = [
    {
      args: ['ci', '--no-fund', '--no-audit'],
      label: 'Installing dependencies for the first run with npm ci...',
    },
    {
      args: ['install', '--no-fund', '--no-audit'],
      label: 'npm ci did not complete successfully. Trying npm install as a compatibility fallback...',
    },
  ];

  for (const [index, attempt] of installAttempts.entries()) {
    console.log(attempt.label);
    const installer = runNpmCommandSync(attempt.args, {
      cwd: projectRoot,
      stdio: 'inherit',
    });

    if (installer.error) {
      reportInstallFailure(attempt.args, installer);
      process.exit(1);
    }

    if (installer.status === 0) {
      if (index > 0) {
        console.log('Dependencies were installed successfully by the fallback installer.');
      }
      return;
    }
  }

  reportInstallFailure(installAttempts.at(-1)?.args ?? ['install'], { status: 1 });
  process.exit(1);
}

function printRunGuide() {
  console.log('');
  console.log('Usage guide');
  console.log('1. The browser will open http://127.0.0.1:5173 automatically.');
  console.log('2. Allow camera access to enable head tracking and gesture recognition.');
  console.log('3. Move your head left/right/up/down to inspect the fixed cube and room box.');
  console.log('4. Single-hand pinch rotates the cube; dual-hand pinch scales and twists it.');
  console.log('5. If the camera is unavailable, the demo will fall back to mouse preview mode.');
  console.log('6. Press Ctrl+C in this terminal when you want to stop the demo.');
  console.log('');
}

function resolveNpmCommand() {
  const candidates = process.platform === 'win32'
    ? ['npm.cmd', 'npm']
    : [
        join(nodeBinDir, 'npm'),
        'npm',
      ];

  for (const candidate of candidates) {
    const isAbsoluteCandidate = candidate.includes(nodeBinDir);
    if (isAbsoluteCandidate && !existsSync(candidate)) {
      continue;
    }

    const probe = process.platform === 'win32'
      ? spawnSync(`${candidate} --version`, {
          cwd: projectRoot,
          stdio: 'pipe',
          encoding: 'utf8',
          shell: true,
          env: spawnEnv,
        })
      : spawnSync(candidate, ['--version'], {
          cwd: projectRoot,
          stdio: 'pipe',
          encoding: 'utf8',
          env: spawnEnv,
        });

    if (!probe.error && probe.status === 0) {
      return candidate;
    }
  }

  console.error('npm could not be found even though Node.js is available.');
  console.error(`Node executable: ${process.execPath}`);
  console.error('Please reinstall Node.js from https://nodejs.org/ and then run start-demo.bat again.');
  process.exit(1);
}

function createSpawnEnv() {
  const env = { ...process.env };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  const currentEntries = (env[pathKey] ?? '').split(delimiter).filter(Boolean);

  if (!currentEntries.includes(nodeBinDir)) {
    env[pathKey] = [nodeBinDir, ...currentEntries].join(delimiter);
  }

  env.npm_config_audit = 'false';
  env.npm_config_fund = 'false';

  return env;
}

function runNpmCommandSync(args, options = {}) {
  if (process.platform === 'win32') {
    return spawnSync(`npm.cmd ${args.join(' ')}`, {
      ...options,
      shell: true,
      env: {
        ...spawnEnv,
        ...(options.env ?? {}),
      },
    });
  }

  return spawnSync(npmCommand, args, {
    ...options,
    env: {
      ...spawnEnv,
      ...(options.env ?? {}),
    },
  });
}

function spawnNpmCommand(args, options = {}) {
  if (process.platform === 'win32') {
    return spawn(`npm.cmd ${args.join(' ')}`, {
      ...options,
      shell: true,
      env: {
        ...spawnEnv,
        ...(options.env ?? {}),
      },
    });
  }

  return spawn(npmCommand, args, {
    ...options,
    env: {
      ...spawnEnv,
      ...(options.env ?? {}),
    },
  });
}

function reportInstallFailure(args, result) {
  const lines = [
    `Timestamp: ${new Date().toISOString()}`,
    `Node version: ${process.versions.node}`,
    `Node executable: ${process.execPath}`,
    `Resolved npm command: ${npmCommand}`,
    `Attempted command: ${[npmCommand, ...args].join(' ')}`,
    `Exit status: ${result.status ?? 'null'}`,
    `Signal: ${result.signal ?? 'none'}`,
  ];

  if (result.error) {
    lines.push(`Launch error: ${result.error.message}`);
    if (result.error.stack) {
      lines.push('');
      lines.push(result.error.stack);
    }
  }

  mkdirSync(dirname(startupLogPath), { recursive: true });
  writeFileSync(startupLogPath, `${lines.join('\n')}\n`, 'utf8');

  console.error('');
  console.error('Dependency installation did not complete successfully.');
  console.error(`A startup log was written to: ${startupLogPath}`);

  if (result.error) {
    console.error(`Installer launch error: ${result.error.message}`);
    console.error('This usually means npm is not available on PATH or was not installed with Node.js.');
  } else {
    console.error('The npm installer exited with a non-zero code.');
    console.error('Please open the log above and rerun the command in a terminal to see the full npm output.');
  }
}

function isLockfileNewerThanInstalledState() {
  if (!existsSync(packageLockPath) || !existsSync(installedLockPath)) {
    return true;
  }

  return statSync(packageLockPath).mtimeMs > statSync(installedLockPath).mtimeMs;
}

function startDevServer() {
  console.log('Starting local demo server at http://127.0.0.1:5173 ...');

  const child = spawnNpmCommand(['run', 'dev:open'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    console.error('The local dev server could not be started.');
    console.error(error.message);
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}
