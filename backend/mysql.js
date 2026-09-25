const { runCommand, runAptInstall } = require('./exec');
const { escapeSqlString } = require('./validate');

async function installMysql(onProgress, onData) {
  return runAptInstall(['mysql-server'], { onProgress, onData });
}

async function waitForMysql(retries = 15) {
  for (let i = 0; i < retries; i++) {
    const res = await runCommand('mysqladmin', ['ping']);
    if (res.ok) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/**
 * Equivalent of mysql_secure_installation, run non-interactively as the
 * linux root user via the local unix-socket auth that Ubuntu's mysql-server
 * ships with by default. Also switches root auth to a password so tools
 * like phpMyAdmin can authenticate.
 */
async function secureInstall(rootPassword) {
  const pw = escapeSqlString(rootPassword);
  const sql = `
    ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '${pw}';
    DELETE FROM mysql.user WHERE User='';
    DELETE FROM mysql.user WHERE User='root' AND Host NOT IN ('localhost','127.0.0.1','::1');
    DROP DATABASE IF EXISTS test;
    DELETE FROM mysql.db WHERE Db='test' OR Db='test\\_%';
    FLUSH PRIVILEGES;
  `;
  return runCommand('mysql', ['-u', 'root'], { input: sql });
}

async function testRootPassword(rootPassword) {
  const pw = escapeSqlString(rootPassword);
  const res = await runCommand('mysql', ['-u', 'root', `-p${rootPassword}`, '-e', 'SELECT 1;']);
  return res.ok;
}

module.exports = { installMysql, waitForMysql, secureInstall, testRootPassword };
