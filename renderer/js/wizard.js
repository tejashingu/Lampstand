const Wizard = (() => {
  const STEPS = [
    { key: 'welcome', label: 'Welcome' },
    { key: 'syscheck', label: 'System Check' },
    { key: 'apache', label: 'Apache' },
    { key: 'php', label: 'PHP' },
    { key: 'node', label: 'Node.js' },
    { key: 'mysql', label: 'MySQL' },
    { key: 'phpmyadmin', label: 'phpMyAdmin' },
    { key: 'finish', label: 'Finish' },
  ];

  let state = {
    index: 0,
    stack: null,
    osInfo: null,
    mysqlRootPassword: randomPassword(),
    pmaAppPassword: randomPassword(),
    installNode: true,
    installNvm: true,
  };

  // A single IPC listener is registered once (see start()) and dispatches to
  // whichever step is currently mounted, so listeners never pile up as the
  // user navigates back and forth between steps.
  let activeProgressHandler = null;
  let activeLogHandler = null;

  function randomPassword(len = 16) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  function renderStepper() {
    const wrap = document.getElementById('stepper');
    wrap.innerHTML = '';
    STEPS.forEach((s, i) => {
      const status = i < state.index ? 'done' : i === state.index ? 'active' : '';
      const circle = el('div', { class: 'circle', text: i < state.index ? '✓' : String(i + 1) });
      wrap.appendChild(el('div', { class: `step ${status}` }, [circle, el('span', { text: s.label })]));
      if (i < STEPS.length - 1) wrap.appendChild(el('div', { class: 'step-line' }));
    });
  }

  function goto(index) {
    state.index = index;
    renderStepper();
    renderStep();
  }
  function next() { goto(Math.min(state.index + 1, STEPS.length - 1)); }
  function back() { goto(Math.max(state.index - 1, 0)); }

  function navRow(opts = {}) {
    const row = el('div', { class: 'row', style: 'margin-top:20px; flex:0;' });
    if (state.index > 0 && !opts.hideBack) {
      row.appendChild(el('button', { class: 'ghost', onclick: back, text: '← Back' }));
    }
    const nextBtn = el('button', {
      class: 'primary',
      text: opts.nextLabel || 'Continue →',
      onclick: opts.onNext || next,
    });
    if (opts.nextDisabled) nextBtn.disabled = true;
    row.appendChild(nextBtn);
    return { row, nextBtn };
  }

  function progressBar(container) {
    const wrap = el('div', { class: 'progress-wrap' });
    const label = el('div', { class: 'progress-label' }, [el('span', { text: 'Waiting…' }), el('span', { text: '' })]);
    const track = el('div', { class: 'progress-track' });
    const fill = el('div', { class: 'progress-fill indeterminate' });
    track.appendChild(fill);
    wrap.appendChild(label);
    wrap.appendChild(track);
    container.appendChild(wrap);
    return {
      set(percent, text) {
        fill.classList.remove('indeterminate');
        fill.style.width = percent + '%';
        label.children[0].textContent = text || '';
        label.children[1].textContent = percent + '%';
      },
      indeterminate(text) {
        fill.classList.add('indeterminate');
        label.children[0].textContent = text || 'Working…';
        label.children[1].textContent = '';
      },
    };
  }

  function consoleBox(container) {
    const box = el('div', { class: 'console' });
    container.appendChild(box);
    return {
      log(line, cls = '') {
        const l = el('div', { class: `line ${cls}`, text: line });
        box.appendChild(l);
        box.scrollTop = box.scrollHeight;
      },
    };
  }

  function statusPill(installed, version) {
    if (installed) return el('span', { class: 'pill installed', text: version ? `Already installed · ${version}` : 'Already installed' });
    return el('span', { class: 'pill missing', text: 'Not installed' });
  }

  async function refreshStack() {
    state.stack = await window.api.checkStack();
    return state.stack;
  }

  // ---------------- step renderers ----------------

  function renderWelcome(container) {
    container.appendChild(el('div', { class: 'card' }, [
      el('h2', { text: 'Set up your local development server' }),
      el('p', { class: 'muted', text: 'This wizard installs Apache, PHP (with WordPress/Drupal/Laravel extensions), Node.js, MySQL and phpMyAdmin from your Ubuntu system\'s official apt repositories. Anything already installed is detected automatically and skipped.' }),
      el('p', { class: 'muted', text: 'After setup you\'ll be able to map folders to virtual hosts, manage www-data access for any user, and audit /var/www/html permissions — all from the dashboard.' }),
    ]));
    const { row } = navRow({ hideBack: true, nextLabel: 'Get Started →' });
    container.appendChild(row);
  }

  async function renderSyscheck(container) {
    const card = el('div', { class: 'card' }, [
      el('h2', { text: 'System check' }),
      el('p', { class: 'sub', text: 'Detecting your OS and refreshing package lists.' }),
    ]);
    container.appendChild(card);
    const info = el('div', { class: 'muted', text: 'Detecting…' });
    card.appendChild(info);
    const prog = progressBar(card);
    const cons = consoleBox(card);

    const { row, nextBtn } = navRow({ hideBack: true, nextDisabled: true });
    container.appendChild(row);

    const os = await window.api.getOsInfo();
    state.osInfo = os;
    document.getElementById('osBadge').textContent = os.prettyName;
    info.textContent = os.isUbuntu ? `Detected ${os.prettyName} ✓` : `${os.prettyName} — this tool targets Ubuntu, some steps may not apply.`;

    if (!(await window.api.isRoot())) {
      prog.set(0, 'Skipped (not root)');
      cons.log('Not running as root — skipping apt-get update. Restart with sudo to install packages.', 'err');
      nextBtn.disabled = false;
      return;
    }

    prog.indeterminate('Running apt-get update…');
    activeLogHandler = (evt) => { if (evt.step === 'apt-update') cons.log(evt.line, evt.stream === 'stderr' ? 'err' : ''); };
    const res = await window.api.install.aptUpdate();
    prog.set(100, res.ok ? 'Package lists updated' : 'apt-get update finished with warnings');
    cons.log(res.ok ? 'apt-get update complete.' : 'apt-get update reported issues (continuing).', res.ok ? 'ok' : 'err');
    await refreshStack();
    nextBtn.disabled = false;
  }

  function renderInstallStep(container, { title, desc, stackKey, installFn, disabled }) {
    const already = state.stack && state.stack[stackKey] && state.stack[stackKey].installed;
    const card = el('div', { class: 'card' }, [
      el('h2', { text: title }),
      el('p', { class: 'sub', text: desc }),
    ]);
    const statusRow = el('div', { style: 'margin-bottom:14px;' }, [
      statusPill(already, state.stack && state.stack[stackKey] && state.stack[stackKey].version),
    ]);
    card.appendChild(statusRow);
    container.appendChild(card);

    const { row, nextBtn } = navRow({ nextDisabled: !already });

    if (already) {
      card.appendChild(el('p', { class: 'faint', text: 'Detected on this system — skipping installation. You can reinstall later from the dashboard if needed.' }));
      container.appendChild(row);
      return;
    }

    if (disabled) {
      card.appendChild(el('p', { class: 'faint', text: disabled }));
      container.appendChild(row);
      return;
    }

    const prog = progressBar(card);
    prog.set(0, 'Not started');
    const cons = consoleBox(card);
    const installBtn = el('button', { class: 'primary', text: `Install ${title}` });
    card.appendChild(el('div', { style: 'margin-top:12px;' }, [installBtn]));
    container.appendChild(row);

    activeProgressHandler = (p) => {
      if (p.step !== stackKey) return;
      if (p.phase === 'installing') prog.set(p.percent, p.package ? `Installing ${p.package}…` : 'Installing…');
      if (p.phase === 'done') prog.set(100, p.ok ? 'Installed successfully' : 'Finished with errors');
    };
    activeLogHandler = (evt) => {
      if (evt.step !== stackKey) return;
      cons.log(evt.line, evt.stream === 'stderr' ? 'err' : '');
    };

    installBtn.addEventListener('click', async () => {
      installBtn.disabled = true;
      prog.indeterminate('Starting…');
      try {
        const res = await installFn();
        if (res.ok) {
          toast(`${title} installed`, 'ok');
          nextBtn.disabled = false;
          installBtn.textContent = 'Installed ✓';
        } else {
          toast(`${title} install reported errors — check the log`, 'err');
          installBtn.disabled = false;
          installBtn.textContent = `Retry install`;
        }
      } catch (e) {
        cons.log(String(e.message || e), 'err');
        toast(String(e.message || e), 'err');
        installBtn.disabled = false;
      }
      await refreshStack();
    });
  }

  function renderApache(container) {
    renderInstallStep(container, {
      title: 'Apache',
      desc: 'Installs the Apache2 web server from the Ubuntu repositories.',
      stackKey: 'apache',
      installFn: () => window.api.install.apache(),
    });
  }

  function renderPhp(container) {
    renderInstallStep(container, {
      title: 'PHP',
      desc: 'Installs PHP plus the extension set required by WordPress, Drupal and Laravel (mbstring, curl, gd, xml, zip, intl, bcmath, mysqli/PDO, opcache, imagick, soap and more).',
      stackKey: 'php',
      installFn: () => window.api.install.php(),
    });
  }

  function renderNode(container) {
    const already = state.stack && state.stack.node.installed && state.stack.nvm.installed;
    const card = el('div', { class: 'card' }, [
      el('h2', { text: 'Node.js & NVM' }),
      el('p', { class: 'sub', text: 'Installs Node.js from apt, and sets up NVM system-wide so every user on this machine can select and manage their own Node versions.' }),
    ]);
    container.appendChild(card);

    card.appendChild(el('div', { style: 'display:flex; gap:24px; margin-bottom:14px;' }, [
      el('div', {}, [statusPill(state.stack.node.installed, state.stack.node.version), el('div', { class: 'faint', style: 'margin-top:4px;', text: 'Node.js (apt)' })]),
      el('div', {}, [statusPill(state.stack.nvm.installed), el('div', { class: 'faint', style: 'margin-top:4px;', text: 'NVM (system-wide)' })]),
    ]));

    const { row, nextBtn } = navRow({ nextDisabled: !already });
    const prog = progressBar(card);
    prog.set(0, 'Not started');
    const cons = consoleBox(card);

    const installBtn = el('button', { class: 'primary', text: 'Install Node.js & NVM' });
    if (already) {
      installBtn.disabled = true;
      installBtn.textContent = 'Installed ✓';
      prog.set(100, 'Already installed');
    }
    card.appendChild(el('div', { style: 'margin-top:12px;' }, [installBtn]));
    container.appendChild(row);

    activeProgressHandler = (p) => {
      if (p.step === 'node') prog.set(p.percent, p.package ? `Installing ${p.package}…` : 'Installing Node.js…');
    };
    activeLogHandler = (evt) => {
      if (evt.step === 'node' || evt.step === 'nvm') cons.log(evt.line, evt.stream === 'stderr' ? 'err' : '');
    };

    installBtn.addEventListener('click', async () => {
      installBtn.disabled = true;
      try {
        if (!state.stack.node.installed) {
          prog.set(0, 'Installing Node.js via apt…');
          const r1 = await window.api.install.nodeApt();
          if (!r1.ok) throw new Error('Node.js (apt) install failed — see log');
        }
        if (!state.stack.nvm.installed) {
          prog.indeterminate('Installing NVM system-wide (cloning + fetching LTS)…');
          const r2 = await window.api.install.nvm();
          if (!r2.ok) throw new Error('NVM install failed — see log');
        }
        prog.set(100, 'Node.js & NVM ready');
        toast('Node.js & NVM installed', 'ok');
        nextBtn.disabled = false;
        installBtn.textContent = 'Installed ✓';
      } catch (e) {
        cons.log(String(e.message || e), 'err');
        toast(String(e.message || e), 'err');
        installBtn.disabled = false;
      }
      await refreshStack();
    });
  }

  function renderMysql(container) {
    const already = state.stack.mysql.installed;
    const card = el('div', { class: 'card' }, [
      el('h2', { text: 'MySQL' }),
      el('p', { class: 'sub', text: 'Installs mysql-server and applies the standard secure-installation hardening (removes anonymous users & the test database, sets a root password).' }),
      statusPill(already, state.stack.mysql.version),
    ]);
    container.appendChild(card);

    const { row, nextBtn } = navRow({ nextDisabled: !already });

    if (already) {
      card.appendChild(el('p', { class: 'faint', style: 'margin-top:12px;', text: 'MySQL already installed — leaving existing configuration untouched.' }));
      container.appendChild(row);
      return;
    }

    const pwField = el('label', { class: 'field' }, [
      el('span', { text: 'MySQL root password (auto-generated, feel free to change)' }),
      el('input', { type: 'text', id: 'mysqlRootPw', value: state.mysqlRootPassword }),
    ]);
    card.appendChild(pwField);
    card.querySelector('#mysqlRootPw').addEventListener('input', (e) => (state.mysqlRootPassword = e.target.value));

    const prog = progressBar(card);
    prog.set(0, 'Not started');
    const cons = consoleBox(card);
    const installBtn = el('button', { class: 'primary', text: 'Install MySQL' });
    card.appendChild(el('div', { style: 'margin-top:12px;' }, [installBtn]));
    container.appendChild(row);

    activeProgressHandler = (p) => {
      if (p.step === 'mysql') prog.set(p.percent, p.package ? `Installing ${p.package}…` : 'Installing…');
    };
    activeLogHandler = (evt) => { if (evt.step === 'mysql') cons.log(evt.line, evt.stream === 'stderr' ? 'err' : ''); };

    installBtn.addEventListener('click', async () => {
      installBtn.disabled = true;
      prog.indeterminate('Starting…');
      try {
        const res = await window.api.install.mysql(state.mysqlRootPassword);
        if (res.ok) {
          prog.set(100, 'MySQL installed & secured');
          toast('MySQL installed', 'ok');
          nextBtn.disabled = false;
          installBtn.textContent = 'Installed ✓';
        } else {
          throw new Error(res.stderr || 'MySQL install failed');
        }
      } catch (e) {
        cons.log(String(e.message || e), 'err');
        toast(String(e.message || e), 'err');
        installBtn.disabled = false;
      }
      await refreshStack();
    });
  }

  function renderPhpMyAdmin(container) {
    const already = state.stack.phpmyadmin.installed;
    const card = el('div', { class: 'card' }, [
      el('h2', { text: 'phpMyAdmin' }),
      el('p', { class: 'sub', text: 'Installs phpMyAdmin and wires it into Apache automatically (no interactive prompts).' }),
      statusPill(already),
    ]);
    container.appendChild(card);

    const { row, nextBtn } = navRow({ nextDisabled: !already });

    if (already) {
      card.appendChild(el('p', { class: 'faint', style: 'margin-top:12px;', text: 'phpMyAdmin already installed.' }));
      container.appendChild(row);
      return;
    }
    if (!state.stack.mysql.installed) {
      card.appendChild(el('p', { class: 'faint', style: 'margin-top:12px;', text: 'Install MySQL first (go back a step).' }));
      container.appendChild(row);
      return;
    }

    const pwField = el('label', { class: 'field' }, [
      el('span', { text: 'phpMyAdmin control-user password (auto-generated)' }),
      el('input', { type: 'text', id: 'pmaPw', value: state.pmaAppPassword }),
    ]);
    card.appendChild(pwField);
    card.querySelector('#pmaPw').addEventListener('input', (e) => (state.pmaAppPassword = e.target.value));

    const prog = progressBar(card);
    prog.set(0, 'Not started');
    const cons = consoleBox(card);
    const installBtn = el('button', { class: 'primary', text: 'Install phpMyAdmin' });
    card.appendChild(el('div', { style: 'margin-top:12px;' }, [installBtn]));
    container.appendChild(row);

    activeProgressHandler = (p) => {
      if (p.step === 'phpmyadmin') prog.set(p.percent, p.package ? `Installing ${p.package}…` : 'Installing…');
    };
    activeLogHandler = (evt) => { if (evt.step === 'phpmyadmin') cons.log(evt.line, evt.stream === 'stderr' ? 'err' : ''); };

    installBtn.addEventListener('click', async () => {
      installBtn.disabled = true;
      prog.indeterminate('Starting…');
      try {
        const res = await window.api.install.phpmyadmin(state.mysqlRootPassword, state.pmaAppPassword);
        if (res.ok) {
          prog.set(100, 'phpMyAdmin installed');
          toast('phpMyAdmin installed — available at /phpmyadmin', 'ok');
          nextBtn.disabled = false;
          installBtn.textContent = 'Installed ✓';
        } else {
          throw new Error(res.stderr || 'phpMyAdmin install failed');
        }
      } catch (e) {
        cons.log(String(e.message || e), 'err');
        toast(String(e.message || e), 'err');
        installBtn.disabled = false;
      }
      await refreshStack();
    });
  }

  function renderFinish(container) {
    container.appendChild(el('div', { class: 'card' }, [
      el('h2', { text: 'All set 🎉' }),
      el('p', { class: 'muted', text: 'Your local server stack is ready. Head to the dashboard to map project folders to virtual hosts, manage www-data access, and audit /var/www/html permissions.' }),
    ]));
    const row = el('div', { class: 'row', style: 'margin-top:20px; flex:0;' });
    row.appendChild(el('button', { class: 'ghost', onclick: back, text: '← Back' }));
    row.appendChild(el('button', { class: 'primary', text: 'Go to Dashboard →', onclick: () => App.showDashboard() }));
    container.appendChild(row);
  }

  async function renderStep() {
    const container = document.getElementById('stepContent');
    container.innerHTML = '';
    activeProgressHandler = null;
    activeLogHandler = null;
    const key = STEPS[state.index].key;
    if (!state.stack && key !== 'welcome' && key !== 'syscheck') await refreshStack();

    if (key === 'welcome') return renderWelcome(container);
    if (key === 'syscheck') return renderSyscheck(container);
    if (key === 'apache') return renderApache(container);
    if (key === 'php') return renderPhp(container);
    if (key === 'node') return renderNode(container);
    if (key === 'mysql') return renderMysql(container);
    if (key === 'phpmyadmin') return renderPhpMyAdmin(container);
    if (key === 'finish') return renderFinish(container);
  }

  let ipcRegistered = false;
  async function start() {
    document.getElementById('wizardView').hidden = false;
    document.getElementById('dashboardView').hidden = true;
    if (!ipcRegistered) {
      ipcRegistered = true;
      window.api.install.onProgress((p) => activeProgressHandler && activeProgressHandler(p));
      window.api.install.onLog((evt) => activeLogHandler && activeLogHandler(evt));
    }
    state.index = 0;
    await refreshStack();
    renderStepper();
    renderStep();
  }

  return { start, get state() { return state; } };
})();
