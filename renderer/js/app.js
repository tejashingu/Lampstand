const App = (() => {
  async function showDashboard() {
    document.getElementById('wizardView').hidden = true;
    document.getElementById('dashboardView').hidden = false;
    Dashboard.setActiveTab('overview');
  }

  async function updateTopbar() {
    const [isRoot, osInfo] = await Promise.all([window.api.isRoot(), window.api.getOsInfo()]);
    const rootBadge = document.getElementById('rootBadge');
    const osBadge = document.getElementById('osBadge');
    osBadge.textContent = osInfo.prettyName;
    if (isRoot) {
      rootBadge.textContent = 'Running as root';
      rootBadge.className = 'badge root';
      document.getElementById('rootBanner').hidden = true;
    } else {
      rootBadge.textContent = 'Not root';
      rootBadge.className = 'badge noroot';
      document.getElementById('rootBanner').hidden = false;
    }
    return isRoot;
  }

  function initTermsModal() {
    return new Promise((resolve) => {
      let accepted = false;
      try { accepted = localStorage.getItem('vhm_tos_accepted') === 'true'; } catch (e) { /* ignore */ }
      if (accepted) return resolve();

      const modal = document.getElementById('tosModal');
      const checkbox = document.getElementById('tosCheckbox');
      const acceptBtn = document.getElementById('tosAccept');
      modal.hidden = false;
      checkbox.addEventListener('change', () => { acceptBtn.disabled = !checkbox.checked; });
      acceptBtn.addEventListener('click', () => {
        try { localStorage.setItem('vhm_tos_accepted', 'true'); } catch (e) { /* ignore */ }
        modal.hidden = true;
        resolve();
      });
    });
  }

  async function boot() {
    await initTermsModal();
    Dashboard.init();
    await updateTopbar();

    const stack = await window.api.checkStack();
    const coreInstalled = stack.apache.installed && stack.php.installed && stack.mysql.installed && stack.phpmyadmin.installed;

    if (coreInstalled) {
      showDashboard();
    } else {
      Wizard.start();
    }
  }

  document.addEventListener('DOMContentLoaded', boot);

  return { showDashboard };
})();
