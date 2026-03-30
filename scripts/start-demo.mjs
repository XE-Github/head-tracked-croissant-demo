import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const packageLockPath = join(projectRoot, 'package-lock.json');
const installedLockPath = join(projectRoot, 'node_modules', '.package-lock.json');
const isDryRun = process.argv.includes('--dry-run');

assertSupportedNodeVersion();
ensureDependenciesInstalled();

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

  const installArgs = ['ci'];
  const installLabel = 'Installing dependencies for the first run...';

  console.log(installLabel);
  const installer = spawnSync(npmCommand, installArgs, {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  if (installer.status !== 0) {
    process.exit(installer.status ?? 1);
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

  const child = spawn(npmCommand, ['run', 'dev:open'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}
