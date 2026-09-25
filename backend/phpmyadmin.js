const { runCommand, runAptInstall } = require('./exec');
const { escapeDebconfValue } = require('./validate');

function preseedLines(mysqlRootPassword, appPassword) {
  const mrp = escapeDebconfValue(mysqlRootPassword);
  const app = escapeDebconfValue(appPassword);
  return [
    'phpmyadmin phpmyadmin/dbconfig-install boolean true',
    'phpmyadmin phpmyadmin/app-password-confirm password ' + app,
    'phpmyadmin phpmyadmin/mysql/admin-user string root',
    'phpmyadmin phpmyadmin/mysql/admin-pass password ' + mrp,
    'phpmyadmin phpmyadmin/mysql/app-pass password ' + app,
    'phpmyadmin phpmyadmin/password-confirm password ' + app,
    'phpmyadmin phpmyadmin/reconfigure-webserver multiselect apache2',
  ].join('\n') + '\n';
}

async function installPhpMyAdmin(mysqlRootPassword, appPassword, onProgress, onData) {
  const preseed = await runCommand('debconf-set-selections', [], {
    input: preseedLines(mysqlRootPassword, appPassword),
  });
  if (!preseed.ok) {
    return { ok: false, code: preseed.code, stdout: preseed.stdout, stderr: preseed.stderr, step: 'preseed' };
  }

  const result = await runAptInstall(['phpmyadmin'], { onProgress, onData, ignoreMissing: true });

  // Ensure apache config is enabled even if the postinst step didn't fire
  // (some non-interactive installs skip the webserver reconfigure trigger).
  await runCommand('a2enconf', ['phpmyadmin']);
  await runCommand('systemctl', ['reload', 'apache2']);

  return result;
}

module.exports = { installPhpMyAdmin };
