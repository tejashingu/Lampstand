const Dashboard = (() => {
  let activeTab = 'overview';

  function setActiveTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.sidebar .navitem').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    render();
  }

  async function render() {
    const content = document.getElementById('dashboardContent');
    content.innerHTML = '<p class="muted">Loading…</p>';
    if (activeTab === 'overview') return renderOverview(content);
    if (activeTab === 'vhosts') return renderVhosts(content);
    if (activeTab === 'users') return renderUsers(content);
    if (activeTab === 'permissions') return renderPermissions(content);
    if (activeTab === 'services') return renderServices(content);
  }

  // ---------------- Overview ----------------
  async function renderOverview(content) {
    const stack = await window.api.checkStack();
    content.innerHTML = '';
    content.appendChild(el('h1', { class: 'page-title', text: 'Overview' }));
    content.appendChild(el('p', { class: 'page-sub', text: 'Status of your local server stack.' }));

    const grid = el('div', { class: 'grid' });
    const items = [
      ['Apache', stack.apache],
      ['PHP', stack.php],
      ['MySQL', stack.mysql],
      ['phpMyAdmin', stack.phpmyadmin],
      ['Node.js', stack.node],
      ['NVM (system-wide)', stack.nvm],
    ];
    items.forEach(([name, s]) => {
      grid.appendChild(el('div', { class: 'stack-item' }, [
        el('div', {}, [
          el('div', { class: 'name', text: name }),
          el('div', { class: 'ver', text: s.installed ? (s.version || 'installed') : 'not installed' }),
        ]),
        el('span', { class: `pill ${s.installed ? 'installed' : 'missing'}`, text: s.installed ? 'OK' : '—' }),
      ]));
    });
    content.appendChild(el('div', { class: 'card' }, [el('h2', { text: 'Stack status' }), grid]));

    content.appendChild(el('div', { class: 'card' }, [
      el('h2', { text: 'Re-run setup wizard' }),
      el('p', { class: 'sub', text: 'Already-installed components are detected and skipped automatically.' }),
      el('button', { class: 'primary', text: 'Open Setup Wizard', onclick: () => Wizard.start() }),
    ]));

    const autostartEnabled = await window.api.autostart.get();
    const autostartSwitch = toggleSwitch(autostartEnabled, async (checked, revert) => {
      const res = await window.api.autostart.set(checked);
      if (!res.ok) { toast(res.error || 'Failed to update', 'err'); revert(); }
      else toast(checked ? 'Lampstand will launch at login' : 'Removed from login items', 'ok');
    });
    const themeSelect = el('select', { style: 'width:auto;' },
      [
        ['system', 'Match System'],
        ['light', 'Light'],
        ['dark', 'Dark'],
      ].map(([value, label]) => el('option', { value, text: label }))
    );
    themeSelect.value = Theme.get();
    themeSelect.addEventListener('change', (e) => Theme.set(e.target.value));

    content.appendChild(el('div', { class: 'card' }, [
      el('h2', { text: 'Settings' }),
      el('div', { style: 'display:flex; align-items:center; gap:10px; margin-bottom:16px;' }, [
        autostartSwitch,
        el('span', { text: 'Launch Lampstand at login' }),
      ]),
      el('p', { class: 'faint', style: 'margin:-10px 0 16px;', text: 'Starts minimized to the tray — click the tray icon to open. Runs unprivileged; you\'ll be prompted for your password the first time you use an action that changes the system.' }),
      el('div', { style: 'display:flex; align-items:center; gap:10px;' }, [
        el('span', { text: 'Theme' }),
        themeSelect,
      ]),
    ]));
  }

  function toggleSwitch(checked, onChange) {
    const input = el('input', { type: 'checkbox', ...(checked ? { checked: 'checked' } : {}) });
    const wrap = el('label', { class: 'switch' }, [input, el('span', { class: 'slider' })]);
    input.addEventListener('change', (e) => {
      onChange(e.target.checked, () => { e.target.checked = !e.target.checked; });
    });
    return wrap;
  }

  // ---------------- Virtual Hosts ----------------
  async function renderVhosts(content) {
    const vhosts = await window.api.vhost.list();
    content.innerHTML = '';
    content.appendChild(el('h1', { class: 'page-title', text: 'Virtual Hosts' }));
    content.appendChild(el('p', { class: 'page-sub', text: 'Map a project folder to a local domain. This creates an Apache vhost, an /etc/hosts entry, and reloads Apache.' }));

    const formCard = el('div', { class: 'card' });
    formCard.appendChild(el('h2', { text: 'Add a virtual host' }));
    const domainInput = el('input', { type: 'text', placeholder: 'myproject.test' });
    const pathInput = el('input', { type: 'text', placeholder: '/home/you/projects/myproject', readonly: 'readonly' });
    const browseBtn = el('button', { text: 'Browse…' });
    browseBtn.addEventListener('click', async () => {
      const dir = await window.api.chooseFolder();
      if (dir) pathInput.value = dir;
    });

    formCard.appendChild(el('label', { class: 'field' }, [el('span', { text: 'Domain' }), domainInput]));
    formCard.appendChild(el('label', { class: 'field' }, [
      el('span', { text: 'Project folder' }),
      el('div', { class: 'row' }, [pathInput, browseBtn]),
    ]));
    const createBtn = el('button', { class: 'primary', text: 'Create Virtual Host' });
    formCard.appendChild(createBtn);
    createBtn.addEventListener('click', async () => {
      if (!domainInput.value || !pathInput.value) return toast('Enter a domain and folder', 'err');
      createBtn.disabled = true;
      try {
        const res = await window.api.vhost.create(domainInput.value.trim(), pathInput.value.trim());
        if (res.ok) {
          toast(`Virtual host ${domainInput.value} created`, 'ok');
          domainInput.value = '';
          pathInput.value = '';
          render();
        } else {
          toast(res.error || 'Failed to create virtual host', 'err');
        }
      } finally {
        createBtn.disabled = false;
      }
    });
    content.appendChild(formCard);

    const listCard = el('div', { class: 'card' });
    listCard.appendChild(el('h2', { text: `Existing virtual hosts (${vhosts.length})` }));
    if (!vhosts.length) {
      listCard.appendChild(el('div', { class: 'empty', text: 'No virtual hosts yet — create one above.' }));
    } else {
      const table = el('table');
      table.appendChild(el('tr', {}, [
        el('th', { text: 'Domain' }), el('th', { text: 'Document Root' }), el('th', { text: 'Enabled' }), el('th', { text: '' }),
      ]));
      vhosts.forEach((v) => {
        const toggle = el('label', { class: 'switch' }, [
          el('input', { type: 'checkbox', ...(v.enabled ? { checked: 'checked' } : {}) }),
          el('span', { class: 'slider' }),
        ]);
        toggle.querySelector('input').addEventListener('change', async (e) => {
          const res = await window.api.vhost.setEnabled(v.domain, e.target.checked);
          if (!res.ok) { toast(res.error || 'Failed', 'err'); e.target.checked = !e.target.checked; }
          else toast(`${v.domain} ${e.target.checked ? 'enabled' : 'disabled'}`, 'ok');
        });
        const delBtn = el('button', { class: 'danger small', text: 'Delete' });
        delBtn.addEventListener('click', async () => {
          if (!confirm(`Delete virtual host ${v.domain}? This removes the Apache config and /etc/hosts entry (project files are kept).`)) return;
          const res = await window.api.vhost.delete(v.domain);
          if (res.ok) { toast('Deleted', 'ok'); render(); } else toast(res.error || 'Failed', 'err');
        });
        table.appendChild(el('tr', {}, [
          el('td', {}, [el('strong', { text: v.domain })]),
          el('td', { class: 'mono', text: v.docRoot }),
          el('td', {}, [toggle]),
          el('td', {}, [delBtn]),
        ]));
      });
      listCard.appendChild(table);
    }
    content.appendChild(listCard);
  }

  // ---------------- Users & Groups ----------------
  async function renderUsers(content) {
    const users = await window.api.users.list();
    content.innerHTML = '';
    content.appendChild(el('h1', { class: 'page-title', text: 'Users & Groups' }));
    content.appendChild(el('p', { class: 'page-sub', text: 'Grant any system user write access to web files by adding them to the www-data group, and/or to the shared nvm group for Node.js version management.' }));

    const card = el('div', { class: 'card' });
    card.appendChild(el('h2', { text: `System users (${users.length})` }));
    if (!users.length) {
      card.appendChild(el('div', { class: 'empty', text: 'No regular user accounts found.' }));
    } else {
      const table = el('table');
      table.appendChild(el('tr', {}, [el('th', { text: 'User' }), el('th', { text: 'www-data' }), el('th', { text: 'nvm' })]));
      users.forEach((u) => {
        const wwwToggle = groupToggle(u.name, 'www-data', u.groups.includes('www-data'));
        const nvmToggle = groupToggle(u.name, 'nvm', u.groups.includes('nvm'));
        table.appendChild(el('tr', {}, [
          el('td', {}, [el('strong', { text: u.name }), el('span', { class: 'faint', text: `  uid ${u.uid}` })]),
          el('td', {}, [wwwToggle]),
          el('td', {}, [nvmToggle]),
        ]));
      });
      card.appendChild(table);
    }
    content.appendChild(card);

    const createCard = el('div', { class: 'card' });
    createCard.appendChild(el('h2', { text: 'Create a new user' }));
    const nameInput = el('input', { type: 'text', placeholder: 'deploy' });
    const passInput = el('input', { type: 'password', placeholder: 'Password (optional)' });
    createCard.appendChild(el('label', { class: 'field' }, [el('span', { text: 'Username' }), nameInput]));
    createCard.appendChild(el('label', { class: 'field' }, [el('span', { text: 'Password' }), passInput]));
    const createBtn = el('button', { class: 'primary', text: 'Create User' });
    createCard.appendChild(createBtn);
    createBtn.addEventListener('click', async () => {
      if (!nameInput.value) return toast('Enter a username', 'err');
      createBtn.disabled = true;
      try {
        const res = await window.api.users.create(nameInput.value.trim(), passInput.value);
        if (res.ok) { toast('User created', 'ok'); nameInput.value = ''; passInput.value = ''; render(); }
        else toast(res.error || 'Failed to create user', 'err');
      } finally {
        createBtn.disabled = false;
      }
    });
    content.appendChild(createCard);
  }

  function groupToggle(username, group, checked) {
    const wrap = el('label', { class: 'switch' }, [
      el('input', { type: 'checkbox', ...(checked ? { checked: 'checked' } : {}) }),
      el('span', { class: 'slider' }),
    ]);
    wrap.querySelector('input').addEventListener('change', async (e) => {
      const fn = e.target.checked ? window.api.users.addToGroup : window.api.users.removeFromGroup;
      const res = await fn(username, group);
      if (!res.ok) { toast(res.error || 'Failed', 'err'); e.target.checked = !e.target.checked; }
      else toast(`${username} ${e.target.checked ? 'added to' : 'removed from'} ${group}`, 'ok');
    });
    return wrap;
  }

  // ---------------- Permissions ----------------
  async function renderPermissions(content) {
    content.innerHTML = '';
    content.appendChild(el('h1', { class: 'page-title', text: 'Permissions' }));
    content.appendChild(el('p', { class: 'page-sub', text: 'Audit and fix ownership/permissions under /var/www/html — directories should be 775 (owned by www-data:www-data) and files 664.' }));

    const card = el('div', { class: 'card' });
    const targetInput = el('input', { type: 'text', value: '/var/www/html' });
    card.appendChild(el('label', { class: 'field' }, [el('span', { text: 'Target directory' }), targetInput]));

    const resultBox = el('div', {});
    card.appendChild(resultBox);

    const scanBtn = el('button', { text: 'Scan' });
    const fixBtn = el('button', { class: 'primary', text: 'Fix Permissions', disabled: 'disabled' });
    card.appendChild(el('div', { class: 'actions-inline', style: 'margin-top:10px;' }, [scanBtn, fixBtn]));
    content.appendChild(card);

    let lastScan = null;

    scanBtn.addEventListener('click', async () => {
      scanBtn.disabled = true;
      resultBox.innerHTML = '';
      resultBox.appendChild(el('p', { class: 'muted', text: 'Scanning…' }));
      const res = await window.api.permissions.scan(targetInput.value.trim());
      scanBtn.disabled = false;
      resultBox.innerHTML = '';
      if (!res.ok) { resultBox.appendChild(el('p', { class: 'muted', text: res.error || 'Scan failed' })); return; }
      lastScan = res;
      fixBtn.disabled = res.clean;

      if (res.clean) {
        resultBox.appendChild(el('div', { class: 'pill installed', text: `All good — ${res.dirCount} directories (775) and ${res.fileCount} files (664) correctly owned by www-data:www-data.` }));
      } else {
        resultBox.appendChild(el('div', { class: 'grid' }, [
          statBox('Directories scanned', res.dirCount),
          statBox('Wrong mode dirs', res.dirMismatchCount),
          statBox('Files scanned', res.fileCount),
          statBox('Wrong mode files', res.fileMismatchCount),
          statBox('Ownership mismatches', res.ownerMismatchCount),
        ]));
        if (res.dirMismatchCount + res.fileMismatchCount + res.ownerMismatchCount > 0) {
          const sample = [...res.dirMismatches, ...res.fileMismatches, ...res.ownerMismatches].slice(0, 20);
          resultBox.appendChild(el('p', { class: 'faint', style: 'margin-top:10px;', text: 'Sample of affected paths:' }));
          resultBox.appendChild(el('div', { class: 'console', style: 'height:140px;' },
            sample.map((p) => el('div', { class: 'line', text: p }))));
        }
      }
    });

    fixBtn.addEventListener('click', async () => {
      if (!confirm(`This will run chown -R www-data:www-data and set directories to 775 / files to 664 under ${targetInput.value}. Continue?`)) return;
      fixBtn.disabled = true;
      const res = await window.api.permissions.fix(targetInput.value.trim(), true);
      if (res.ok) toast('Permissions fixed', 'ok'); else toast('Some steps failed — see console', 'err');
      scanBtn.click();
    });
  }

  function statBox(label, value) {
    return el('div', { class: 'stack-item' }, [
      el('div', {}, [el('div', { class: 'ver', text: label }), el('div', { class: 'name', text: String(value) })]),
    ]);
  }

  // ---------------- Services ----------------
  async function renderServices(content) {
    content.innerHTML = '';
    content.appendChild(el('h1', { class: 'page-title', text: 'Services' }));
    content.appendChild(el('p', { class: 'page-sub', text: 'Start, stop and manage boot behaviour for your local server services.' }));

    const grid = el('div', { class: 'grid' });
    for (const svc of ['apache2', 'mysql']) {
      const status = await window.api.services.status(svc);
      const card = el('div', { class: 'card' });
      card.appendChild(el('h2', { text: svc }));
      card.appendChild(el('span', { class: `pill ${status.active ? 'active' : 'missing'}`, text: status.active ? 'Running' : 'Stopped' }));
      card.appendChild(el('div', { class: 'faint', style: 'margin:8px 0 14px;', text: status.enabled ? 'Starts on boot' : 'Does not start on boot' }));

      const startBtn = el('button', { class: 'small', text: 'Start' });
      const stopBtn = el('button', { class: 'small', text: 'Stop' });
      const restartBtn = el('button', { class: 'small', text: 'Restart' });
      [
        [startBtn, 'start'], [stopBtn, 'stop'], [restartBtn, 'restart'],
      ].forEach(([btn, action]) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const res = await window.api.services.control(svc, action);
          if (res.ok) toast(`${svc} ${action}ed`, 'ok'); else toast(res.error || 'Failed', 'err');
          render();
        });
      });
      card.appendChild(el('div', { class: 'actions-inline' }, [startBtn, stopBtn, restartBtn]));

      const bootToggle = el('label', { class: 'switch', style: 'margin-top:14px; display:inline-flex;' }, [
        el('input', { type: 'checkbox', ...(status.enabled ? { checked: 'checked' } : {}) }),
        el('span', { class: 'slider' }),
      ]);
      bootToggle.querySelector('input').addEventListener('change', async (e) => {
        const res = await window.api.services.setEnabledOnBoot(svc, e.target.checked);
        if (!res.ok) { toast(res.error || 'Failed', 'err'); e.target.checked = !e.target.checked; }
      });
      card.appendChild(el('div', { style: 'margin-top:10px; display:flex; align-items:center; gap:8px;' }, [bootToggle, el('span', { class: 'faint', text: 'Start on boot' })]));

      grid.appendChild(card);
    }
    content.appendChild(grid);
  }

  function init() {
    document.querySelectorAll('.sidebar .navitem').forEach((btn) => {
      btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
    });
  }

  return { init, render, setActiveTab };
})();
