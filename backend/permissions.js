const { runCommand } = require('./exec');
const { isSafePath } = require('./validate');

const DEFAULT_TARGET = '/var/www/html';
const DIR_MODE = '775';
const FILE_MODE = '664';
const OWNER = 'www-data';
const GROUP = 'www-data';

async function scan(target = DEFAULT_TARGET) {
  if (!isSafePath(target)) return { ok: false, error: 'Invalid path' };

  const [badDirs, badFiles, badOwner, dirTotal, fileTotal] = await Promise.all([
    runCommand('find', [target, '-type', 'd', '!', '-perm', DIR_MODE, '!', '-perm', '2' + DIR_MODE]),
    runCommand('find', [target, '-type', 'f', '!', '-perm', FILE_MODE]),
    runCommand('find', [target, '!', '-user', OWNER, '-o', '!', '-group', GROUP]),
    runCommand('find', [target, '-type', 'd']),
    runCommand('find', [target, '-type', 'f']),
  ]);

  const dirMismatches = badDirs.ok ? badDirs.stdout.split('\n').filter(Boolean) : [];
  const fileMismatches = badFiles.ok ? badFiles.stdout.split('\n').filter(Boolean) : [];
  const ownerMismatches = badOwner.ok ? badOwner.stdout.split('\n').filter(Boolean) : [];
  const dirCount = dirTotal.ok ? dirTotal.stdout.split('\n').filter(Boolean).length : 0;
  const fileCount = fileTotal.ok ? fileTotal.stdout.split('\n').filter(Boolean).length : 0;

  return {
    ok: true,
    target,
    dirCount,
    fileCount,
    dirMismatches: dirMismatches.slice(0, 50),
    dirMismatchCount: dirMismatches.length,
    fileMismatches: fileMismatches.slice(0, 50),
    fileMismatchCount: fileMismatches.length,
    ownerMismatches: ownerMismatches.slice(0, 50),
    ownerMismatchCount: ownerMismatches.length,
    clean: dirMismatches.length === 0 && fileMismatches.length === 0 && ownerMismatches.length === 0,
  };
}

async function fix(target = DEFAULT_TARGET, { setgid = true } = {}) {
  if (!isSafePath(target)) return { ok: false, error: 'Invalid path' };

  const steps = [];

  const chown = await runCommand('chown', ['-R', `${OWNER}:${GROUP}`, target]);
  steps.push({ step: 'chown -R www-data:www-data', ok: chown.ok, error: chown.stderr });

  const chmodDirs = await runCommand('bash', [
    '-lc',
    `find "${target}" -type d -exec chmod ${setgid ? '2' : ''}${DIR_MODE} {} +`,
  ]);
  steps.push({ step: `chmod dirs -> ${setgid ? '2' : ''}${DIR_MODE}`, ok: chmodDirs.ok, error: chmodDirs.stderr });

  const chmodFiles = await runCommand('bash', [
    '-lc',
    `find "${target}" -type f -exec chmod ${FILE_MODE} {} +`,
  ]);
  steps.push({ step: `chmod files -> ${FILE_MODE}`, ok: chmodFiles.ok, error: chmodFiles.stderr });

  return { ok: steps.every((s) => s.ok), steps };
}

module.exports = { scan, fix, DEFAULT_TARGET, DIR_MODE, FILE_MODE };
