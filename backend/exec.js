const { spawn } = require('child_process');

/**
 * Run a command with streaming stdout/stderr.
 * onData receives { stream: 'stdout'|'stderr', line: string }
 */
function runCommand(cmd, args = [], { onData, env = {}, input } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive', ...env },
    });

    let stdout = '';
    let stderr = '';

    const pump = (buf, stream) => {
      const text = buf.toString();
      stream === 'stdout' ? (stdout += text) : (stderr += text);
      if (onData) {
        text
          .split('\n')
          .filter((l) => l.length)
          .forEach((line) => onData({ stream, line }));
      }
    };

    child.stdout.on('data', (b) => pump(b, 'stdout'));
    child.stderr.on('data', (b) => pump(b, 'stderr'));

    child.on('error', (err) => {
      resolve({ code: -1, stdout, stderr: stderr + '\n' + err.message, ok: false });
    });

    child.on('close', (code) => {
      resolve({ code, stdout, stderr, ok: code === 0 });
    });

    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

/**
 * Install apt packages with real progress reporting.
 * Uses --dry-run to compute a total package count, then parses live
 * "Unpacking"/"Setting up" lines during the real install to drive a
 * determinate progress bar.
 */
async function runAptInstall(packages, { onProgress, onData, ignoreMissing = false } = {}) {
  const baseArgs = ['-y'];
  if (ignoreMissing) baseArgs.push('--ignore-missing');

  // Dry run to estimate total steps
  const dry = await runCommand('apt-get', ['install', ...baseArgs, '--dry-run', ...packages]);
  const total = (dry.stdout.match(/^Inst\s/gm) || []).length || packages.length;

  let done = 0;
  onProgress && onProgress({ phase: 'installing', done: 0, total, percent: 0, package: null });

  const result = await runCommand(
    'apt-get',
    ['install', ...baseArgs, ...packages],
    {
      onData: (evt) => {
        onData && onData(evt);
        const m = evt.line.match(/^(Setting up|Unpacking)\s+([^\s(]+)/);
        if (m) {
          done += 1;
          const percent = Math.min(100, Math.round((done / total) * 100));
          onProgress && onProgress({ phase: 'installing', done, total, percent, package: m[2] });
        }
      },
    }
  );

  onProgress && onProgress({ phase: 'done', done: total, total, percent: 100, package: null, ok: result.ok });
  return result;
}

function isRoot() {
  return typeof process.getuid === 'function' && process.getuid() === 0;
}

module.exports = { runCommand, runAptInstall, isRoot };
