const { runCommand } = require('./exec');

const ALLOWED = new Set(['apache2', 'mysql']);

function assertAllowed(service) {
  if (!ALLOWED.has(service)) throw new Error('Service not allowed: ' + service);
}

async function status(service) {
  assertAllowed(service);
  const active = await runCommand('systemctl', ['is-active', service]);
  const enabled = await runCommand('systemctl', ['is-enabled', service]);
  return {
    service,
    active: active.stdout.trim() === 'active',
    enabled: enabled.stdout.trim() === 'enabled',
  };
}

async function control(service, action) {
  assertAllowed(service);
  if (!['start', 'stop', 'restart', 'reload'].includes(action)) {
    return { ok: false, error: 'Invalid action' };
  }
  const res = await runCommand('systemctl', [action, service]);
  return { ok: res.ok, error: res.ok ? null : res.stderr };
}

async function setEnabledOnBoot(service, enabled) {
  assertAllowed(service);
  const res = await runCommand('systemctl', [enabled ? 'enable' : 'disable', service]);
  return { ok: res.ok, error: res.ok ? null : res.stderr };
}

module.exports = { status, control, setEnabledOnBoot };
