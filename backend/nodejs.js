const fs = require('fs');
const { runCommand, runAptInstall } = require('./exec');

const NVM_VERSION = 'v0.40.1';
const NVM_DIR = '/usr/local/nvm';
const PROFILE_SCRIPT = '/etc/profile.d/nvm.sh';

async function installNodeApt(onProgress, onData) {
  return runAptInstall(['nodejs', 'npm'], { onProgress, onData, ignoreMissing: true });
}

/**
 * Installs NVM into a shared, group-writable location so every user on the
 * machine can `source /etc/profile.d/nvm.sh` and use the same nvm install /
 * shared Node versions, instead of the default per-home-directory install.
 */
async function installNvmSystemWide(onData) {
  const log = (line) => onData && onData({ stream: 'stdout', line });

  const gitCheck = await runCommand('bash', ['-lc', 'command -v git']);
  if (!gitCheck.ok) {
    log('git not found, installing it first...');
    await runAptInstall(['git'], { onData });
  }

  log(`Creating shared "nvm" group...`);
  await runCommand('groupadd', ['-f', 'nvm']);

  log(`Creating ${NVM_DIR}...`);
  fs.mkdirSync(NVM_DIR, { recursive: true });

  log(`Cloning nvm ${NVM_VERSION} into ${NVM_DIR}...`);
  const clone = await runCommand(
    'git',
    ['clone', '--depth', '1', '--branch', NVM_VERSION, 'https://github.com/nvm-sh/nvm.git', NVM_DIR],
    { onData }
  );
  if (!clone.ok) {
    // Directory may already contain a previous attempt; try a plain fetch/checkout instead of failing outright.
    log('Clone failed or already present, checking existing install...');
    if (!fs.existsSync(`${NVM_DIR}/nvm.sh`)) {
      return { ok: false, stderr: clone.stderr };
    }
  }

  log(`Writing ${PROFILE_SCRIPT} so all users load nvm on login...`);
  fs.writeFileSync(
    PROFILE_SCRIPT,
    `# Installed by Lampstand — shared NVM for all users\n` +
      `export NVM_DIR="${NVM_DIR}"\n` +
      `[ -s "$NVM_DIR/nvm.sh" ] && \\. "$NVM_DIR/nvm.sh"\n` +
      `[ -s "$NVM_DIR/bash_completion" ] && \\. "$NVM_DIR/bash_completion"\n`,
    { mode: 0o644 }
  );

  log('Setting shared group ownership and permissions...');
  await runCommand('chgrp', ['-R', 'nvm', NVM_DIR]);
  await runCommand('chmod', ['-R', 'g+rwX', NVM_DIR]);
  await runCommand('chmod', ['g+s', NVM_DIR]);

  log('Installing latest Node.js LTS via nvm and setting it as the shared default...');
  const installLts = await runCommand(
    'bash',
    [
      '-lc',
      `export NVM_DIR=${NVM_DIR} && . "$NVM_DIR/nvm.sh" && nvm install --lts && nvm alias default 'lts/*'`,
    ],
    { onData }
  );

  await runCommand('chgrp', ['-R', 'nvm', NVM_DIR]);
  await runCommand('chmod', ['-R', 'g+rwX', NVM_DIR]);

  return { ok: installLts.ok, stdout: installLts.stdout, stderr: installLts.stderr };
}

module.exports = { installNodeApt, installNvmSystemWide, NVM_DIR };
