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
    if (activeTab === 'about') return renderAbout(content);
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
  let vhostListCard = null;

  async function renderVhosts(content) {
    const form = await vhostForm();
    content.innerHTML = '';
    content.appendChild(el('h1', { class: 'page-title', text: 'Virtual Hosts' }));
    content.appendChild(el('p', { class: 'page-sub', text: 'Map a project folder to a local domain — optionally installing WordPress, Laravel or another framework into it. Lampstand scans existing folders to pick the right document root, then creates the Apache vhost and /etc/hosts entry.' }));

    content.appendChild(form);
    vhostListCard = el('div', { class: 'card' });
    content.appendChild(vhostListCard);
    await refreshVhostList();
  }

  // Group filter state. Groups are shared by all logins; the default group and
  // hidden sites belong to whoever launched Lampstand.
  let groupState = null;      // { user, canEditGroups, groups, defaultFilter, hidden }
  let currentFilter = null;   // 'all' | 'ungrouped' | group id — this session only
  let showHidden = false;

  const groupOf = (domain) => groupState.groups.find((g) => g.domains.includes(domain)) || null;

  async function saveGroups(groups) {
    const res = await window.api.vhostGroups.saveGroups(groups);
    if (!res.ok) { toast(res.error || 'Could not save groups', 'err'); return false; }
    groupState.groups = res.groups;
    return true;
  }

  async function saveView(patch) {
    const res = await window.api.vhostGroups.saveView({ defaultFilter: groupState.defaultFilter, hidden: groupState.hidden, ...patch });
    if (!res.ok) { toast(res.error || 'Could not save', 'err'); return false; }
    groupState.defaultFilter = res.defaultFilter;
    groupState.hidden = res.hidden;
    return true;
  }

  // Moves a site into a group (or out of all groups when groupId is null).
  function withSiteInGroup(domain, groupId) {
    return groupState.groups.map((g) => ({
      ...g,
      domains: g.id === groupId ? [...g.domains.filter((d) => d !== domain), domain] : g.domains.filter((d) => d !== domain),
    }));
  }

  // A newly created site joins whichever group is being viewed.
  async function addNewSiteToCurrentGroup(domain) {
    if (!groupState || !groupState.canEditGroups) return;
    if (!groupState.groups.some((g) => g.id === currentFilter)) return;
    await saveGroups(withSiteInGroup(domain, currentFilter));
  }

  function openGroupNameDialog(title, initial, submitLabel, onSubmit) {
    const overlay = el('div', { class: 'modal-overlay' });
    const input = el('input', { type: 'text', value: initial, maxlength: '40', placeholder: 'e.g. Client projects' });
    const okBtn = el('button', { class: 'primary', text: submitLabel });
    const close = () => overlay.remove();
    const submit = async () => {
      const name = input.value.trim();
      if (!name) return input.focus();
      if (groupState.groups.some((g) => g.name.toLowerCase() === name.toLowerCase() && g.name !== initial)) {
        return toast(`A group named "${name}" already exists`, 'err');
      }
      okBtn.disabled = true;
      if (await onSubmit(name)) close();
      else okBtn.disabled = false;
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') close(); });
    okBtn.addEventListener('click', submit);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.appendChild(el('div', { class: 'modal' }, [
      el('h2', { text: title }),
      el('div', { class: 'body' }, [el('label', { class: 'field' }, [el('span', { text: 'Group name' }), input])]),
      el('div', { class: 'actions' }, [el('button', { class: 'ghost', text: 'Cancel', onclick: close }), okBtn]),
    ]));
    document.body.appendChild(overlay);
    input.focus();
    input.select();
  }

  function openDeleteGroupDialog(group) {
    const overlay = el('div', { class: 'modal-overlay' });
    const close = () => overlay.remove();
    const delBtn = el('button', { class: 'danger', text: 'Delete group' });
    delBtn.addEventListener('click', async () => {
      delBtn.disabled = true;
      if (!(await saveGroups(groupState.groups.filter((g) => g.id !== group.id)))) { delBtn.disabled = false; return; }
      if (groupState.defaultFilter === group.id) await saveView({ defaultFilter: 'all' });
      currentFilter = 'all';
      toast(`Group "${group.name}" deleted`, 'ok');
      close();
      refreshVhostList();
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.appendChild(el('div', { class: 'modal' }, [
      el('h2', { text: `Delete group "${group.name}"?` }),
      el('div', { class: 'body', text: `Its ${group.domains.length} site${group.domains.length === 1 ? '' : 's'} move to Ungrouped. The sites themselves aren't touched. This affects every user on this machine.` }),
      el('div', { class: 'actions' }, [el('button', { class: 'ghost', text: 'Cancel', onclick: close }), delBtn]),
    ]));
    document.body.appendChild(overlay);
  }

  function groupToolbar(vhosts) {
    const { groups, defaultFilter, canEditGroups } = groupState;
    const current = groups.find((g) => g.id === currentFilter) || null;
    const star = (id) => (id === defaultFilter ? '  ★' : '');
    const inGroup = new Set(groups.flatMap((g) => g.domains));

    const select = el('select', { style: 'width:auto; min-width:200px;' }, [
      el('option', { value: 'all', text: `All sites (${vhosts.length})${star('all')}` }),
      ...groups.map((g) => el('option', { value: g.id, text: `${g.name} (${g.domains.length})${star(g.id)}` })),
      el('option', { value: 'ungrouped', text: `Ungrouped (${vhosts.filter((v) => !inGroup.has(v.domain)).length})${star('ungrouped')}` }),
    ]);
    select.value = currentFilter;
    select.addEventListener('change', (e) => { currentFilter = e.target.value; refreshVhostList(); });

    const defaultBtn = el('button', {
      class: 'small', text: currentFilter === defaultFilter ? '★ Default view' : '☆ Set as default',
      title: 'Open this group by default when you launch Lampstand',
      ...(currentFilter === defaultFilter ? { disabled: 'disabled' } : {}),
    });
    defaultBtn.addEventListener('click', async () => {
      if (await saveView({ defaultFilter: currentFilter })) { toast('Default view saved', 'ok'); refreshVhostList(); }
    });

    const editAttrs = canEditGroups ? {} : { disabled: 'disabled', title: 'Editing groups needs Lampstand running as root' };
    const newBtn = el('button', { class: 'small', text: '+ New group', ...editAttrs });
    newBtn.addEventListener('click', () => openGroupNameDialog('New group', '', 'Create group', async (name) => {
      const id = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      if (!(await saveGroups([...groupState.groups, { id, name, domains: [] }]))) return false;
      currentFilter = id;
      toast(`Group "${name}" created — assign sites from the Group column`, 'ok');
      refreshVhostList();
      return true;
    }));

    const tools = [select, defaultBtn, newBtn];
    if (current) {
      const renameBtn = el('button', { class: 'small', text: 'Rename', ...editAttrs });
      renameBtn.addEventListener('click', () => openGroupNameDialog('Rename group', current.name, 'Rename', async (name) => {
        if (!(await saveGroups(groupState.groups.map((g) => (g.id === current.id ? { ...g, name } : g))))) return false;
        refreshVhostList();
        return true;
      }));
      const delBtn = el('button', { class: 'small danger', text: 'Delete group', ...editAttrs });
      delBtn.addEventListener('click', () => openDeleteGroupDialog(current));
      tools.push(renameBtn, delBtn);
    }

    const hiddenCount = groupState.hidden.length;
    const hiddenBox = el('input', { type: 'checkbox', ...(showHidden ? { checked: 'checked' } : {}) });
    hiddenBox.addEventListener('change', (e) => { showHidden = e.target.checked; refreshVhostList(); });

    return el('div', { class: 'group-toolbar' }, [
      el('div', { class: 'tools' }, tools),
      el('label', { class: 'checkline', style: 'margin:0;' }, [hiddenBox, `Show hidden (${hiddenCount})`]),
    ]);
  }

  // Redraws only the list, so the create form's log stays visible.
  async function refreshVhostList() {
    const [vhosts, groups] = await Promise.all([window.api.vhost.list(), window.api.vhostGroups.get()]);
    groupState = groups;
    const validFilters = ['all', 'ungrouped', ...groupState.groups.map((g) => g.id)];
    if (!validFilters.includes(currentFilter)) currentFilter = groupState.defaultFilter;

    const inGroup = new Set(groupState.groups.flatMap((g) => g.domains));
    const hidden = new Set(groupState.hidden);
    const current = groupState.groups.find((g) => g.id === currentFilter);
    const inFilter = vhosts.filter((v) => (currentFilter === 'all' ? true
      : currentFilter === 'ungrouped' ? !inGroup.has(v.domain)
        : current.domains.includes(v.domain)));
    const shown = inFilter.filter((v) => showHidden || !hidden.has(v.domain));
    const hiddenHere = inFilter.length - inFilter.filter((v) => !hidden.has(v.domain)).length;

    const listCard = vhostListCard;
    listCard.innerHTML = '';
    listCard.appendChild(el('h2', { text: `Existing virtual hosts (${shown.length}${shown.length !== vhosts.length ? ` of ${vhosts.length}` : ''})` }));
    listCard.appendChild(groupToolbar(vhosts));

    if (!shown.length) {
      const msg = !vhosts.length ? 'No virtual hosts yet — create one above.'
        : hiddenHere ? `All ${hiddenHere} site${hiddenHere === 1 ? '' : 's'} in this view ${hiddenHere === 1 ? 'is' : 'are'} hidden — tick "Show hidden" to see ${hiddenHere === 1 ? 'it' : 'them'}.`
          : currentFilter === 'ungrouped' ? 'Every site is in a group.'
            : 'No sites in this group yet — pick "All sites" and assign some from the Group column.';
      listCard.appendChild(el('div', { class: 'empty', text: msg }));
      return;
    }

    const table = el('table');
    table.appendChild(el('tr', {}, [
      el('th', { text: 'Domain' }), el('th', { text: 'Group' }), el('th', { text: 'Framework' }), el('th', { text: 'Document Root' }), el('th', { text: 'Enabled' }), el('th', { text: '' }),
    ]));
    shown.forEach((v) => {
      const toggle = el('label', { class: 'switch' }, [
        el('input', { type: 'checkbox', ...(v.enabled ? { checked: 'checked' } : {}) }),
        el('span', { class: 'slider' }),
      ]);
      toggle.querySelector('input').addEventListener('change', async (e) => {
        const res = await window.api.vhost.setEnabled(v.domain, e.target.checked);
        if (!res.ok) { toast(res.error || 'Failed', 'err'); e.target.checked = !e.target.checked; }
        else toast(`${v.domain} ${e.target.checked ? 'enabled' : 'disabled'}`, 'ok');
      });

      const group = groupOf(v.domain);
      const groupSelect = el('select', { class: 'compact', ...(groupState.canEditGroups ? {} : { disabled: 'disabled' }) }, [
        el('option', { value: '', text: '— none —' }),
        ...groupState.groups.map((g) => el('option', { value: g.id, text: g.name })),
      ]);
      groupSelect.value = group ? group.id : '';
      groupSelect.addEventListener('change', async (e) => {
        if (await saveGroups(withSiteInGroup(v.domain, e.target.value || null))) refreshVhostList();
        else e.target.value = group ? group.id : '';
      });

      const isHidden = hidden.has(v.domain);
      const hideBtn = el('button', { class: 'small', text: isHidden ? 'Show' : 'Hide', title: isHidden ? 'Show this site in the list again' : 'Hide from the list (the site keeps running)' });
      hideBtn.addEventListener('click', async () => {
        const next = isHidden ? groupState.hidden.filter((d) => d !== v.domain) : [...groupState.hidden, v.domain];
        if (await saveView({ hidden: next })) {
          toast(isHidden ? `${v.domain} is visible again` : `${v.domain} hidden — tick "Show hidden" to see it`, 'ok');
          refreshVhostList();
        }
      });
      const delBtn = el('button', { class: 'danger small', text: 'Delete' });
      delBtn.addEventListener('click', () => openDeleteDialog(v.domain));
      table.appendChild(el('tr', { class: isHidden ? 'is-hidden' : '' }, [
        el('td', {}, [el('strong', { text: v.domain }), isHidden ? el('span', { class: 'faint', text: '  (hidden)' }) : null]),
        el('td', {}, [groupSelect]),
        el('td', { class: v.framework ? '' : 'faint', text: v.framework || '—' }),
        el('td', { class: 'mono', text: v.docRoot }),
        el('td', {}, [toggle]),
        el('td', {}, [el('div', { class: 'actions-inline' }, [hideBtn, delBtn])]),
      ]));
    });
    listCard.appendChild(table);
  }

  // Single site:log listener, dispatched to whichever form is mounted.
  let activeSiteLog = null;
  let frameworkList = null;

  async function vhostForm() {
    if (!frameworkList) frameworkList = await window.api.site.frameworks();
    const byKey = Object.fromEntries(frameworkList.map((f) => [f.key, f]));

    const card = el('div', { class: 'card' });
    card.appendChild(el('h2', { text: 'Add a virtual host' }));

    const domainInput = el('input', { type: 'text', placeholder: 'myproject.test' });
    const pathInput = el('input', { type: 'text', placeholder: '/home/you/projects/myproject' });
    const browseBtn = el('button', { text: 'Browse…' });
    card.appendChild(el('label', { class: 'field' }, [el('span', { text: 'Domain' }), domainInput]));
    card.appendChild(el('label', { class: 'field' }, [
      el('span', { text: 'Project folder' }),
      el('div', { class: 'row' }, [pathInput, el('div', { style: 'flex:0;' }, [browseBtn])]),
    ]));

    // --- what's in the folder ---
    const scanBox = el('div', { class: 'scan-box', hidden: 'hidden' });
    card.appendChild(scanBox);

    const modeSelect = el('select', {}, [
      el('option', { value: 'existing', text: 'Use the existing files in this folder' }),
      el('option', { value: 'install', text: 'Install a new project into this folder' }),
    ]);
    const frameworkSelect = el('select');
    const modeField = el('label', { class: 'field' }, [el('span', { text: 'Project setup' }), modeSelect]);
    const frameworkLabel = el('span', { text: 'Framework' });
    const frameworkField = el('label', { class: 'field' }, [frameworkLabel, frameworkSelect]);
    const frameworkHint = el('div', { class: 'faint', style: 'margin:-6px 0 12px; font-size:12px;' });
    const docRootHint = el('div', { class: 'mono', style: 'margin:-4px 0 12px;' });

    const mysqlInput = el('input', { type: 'password', placeholder: 'MySQL root password' });
    const mysqlField = el('label', { class: 'field' }, [
      el('span', { text: 'MySQL root password (used once to create the site\'s database and user)' }),
      mysqlInput,
    ]);
    const fixPermsInput = el('input', { type: 'checkbox', checked: 'checked' });
    const fixPermsField = el('label', { class: 'checkline' }, [fixPermsInput, 'Give Apache write access to the framework\'s cache/upload folders']);

    [modeField, frameworkField, frameworkHint, docRootHint, mysqlField, fixPermsField].forEach((n) => card.appendChild(n));

    const createBtn = el('button', { class: 'primary', text: 'Create Virtual Host' });
    card.appendChild(createBtn);

    const progressWrap = el('div', { hidden: 'hidden', style: 'margin-top:16px;' });
    const stageLabel = el('div', { class: 'progress-label' }, [el('span', { text: 'Working…' }), el('span')]);
    const fill = el('div', { class: 'progress-fill indeterminate' });
    const logBox = el('div', { class: 'console' });
    progressWrap.appendChild(el('div', { class: 'progress-wrap' }, [stageLabel, el('div', { class: 'progress-track' }, [fill])]));
    progressWrap.appendChild(logBox);
    card.appendChild(progressWrap);

    let scan = null;

    function logLine(text, cls = '') {
      logBox.appendChild(el('div', { class: `line ${cls}`, text }));
      logBox.scrollTop = logBox.scrollHeight;
    }

    function fillFrameworkOptions() {
      const mode = modeSelect.value;
      const prev = frameworkSelect.value;
      frameworkSelect.innerHTML = '';
      if (mode === 'install') {
        frameworkSelect.appendChild(el('option', { value: 'none', text: 'Nothing — just create an empty folder' }));
        frameworkList.filter((f) => f.installable).forEach((f) => frameworkSelect.appendChild(el('option', { value: f.key, text: f.label })));
        frameworkSelect.value = byKey[prev] && byKey[prev].installable ? prev : 'wordpress';
      } else {
        frameworkList.forEach((f) => {
          const detected = scan && scan.framework === f.key;
          frameworkSelect.appendChild(el('option', { value: f.key, text: detected ? `${f.label} (detected)` : f.label }));
        });
        frameworkSelect.value = scan && scan.framework ? scan.framework : 'php';
      }
      updateHints();
    }

    function updateHints() {
      const dir = pathInput.value.trim().replace(/\/+$/, '');
      const mode = modeSelect.value;
      const key = frameworkSelect.value;
      const fw = byKey[key];

      frameworkLabel.textContent = mode === 'install' ? 'Framework to install' : 'Detected framework (change it if the scan got it wrong)';
      frameworkHint.textContent = mode === 'install' && fw ? fw.description : '';
      frameworkHint.hidden = !frameworkHint.textContent;

      let rel = fw ? fw.docRoot : '';
      if (mode === 'existing' && scan && key === scan.framework) rel = scan.docRootRel;
      docRootHint.textContent = dir ? `Apache will serve: ${rel ? `${dir}/${rel}` : dir}` : '';
      docRootHint.hidden = !dir;

      mysqlField.hidden = !(mode === 'install' && fw && fw.needsMysql);
      fixPermsField.hidden = !(mode === 'existing' && key !== 'php');
      createBtn.textContent = mode === 'install' && fw ? `Install ${fw.label} & Create Virtual Host` : 'Create Virtual Host';
    }

    async function runScan() {
      const dir = pathInput.value.trim();
      scan = null;
      scanBox.innerHTML = '';
      if (!dir) { scanBox.hidden = true; modeField.hidden = frameworkField.hidden = true; updateHints(); return; }

      const res = await window.api.site.detect(dir);
      if (pathInput.value.trim() !== dir) return; // user kept typing
      scanBox.hidden = false;
      if (!res.ok) {
        scanBox.appendChild(el('div', { class: 'pill missing', text: res.error }));
        modeField.hidden = frameworkField.hidden = true;
        return;
      }
      scan = res;
      modeField.hidden = frameworkField.hidden = false;

      if (res.empty) {
        scanBox.appendChild(el('div', { class: 'pill active', text: res.exists ? 'Empty folder — you can install a new project here' : 'New folder — it will be created' }));
        modeSelect.value = 'install';
        modeSelect.querySelector('option[value="existing"]').disabled = true;
      } else {
        scanBox.appendChild(el('div', { class: 'pill installed', text: `Detected: ${res.label}` }));
        modeSelect.value = 'existing';
        modeSelect.querySelector('option[value="existing"]').disabled = false;
        modeSelect.querySelector('option[value="install"]').disabled = true;
      }
      if (res.empty) modeSelect.querySelector('option[value="install"]').disabled = false;
      (res.warnings || []).forEach((w) => scanBox.appendChild(el('div', { class: 'faint', style: 'margin-top:8px;', text: `⚠️ ${w}` })));
      fillFrameworkOptions();
    }

    let scanTimer = null;
    pathInput.addEventListener('input', () => { clearTimeout(scanTimer); scanTimer = setTimeout(runScan, 400); });
    browseBtn.addEventListener('click', async () => {
      const dir = await window.api.chooseFolder();
      if (dir) { pathInput.value = dir; runScan(); }
    });
    modeSelect.addEventListener('change', fillFrameworkOptions);
    frameworkSelect.addEventListener('change', updateHints);
    modeField.hidden = frameworkField.hidden = true;
    updateHints();

    createBtn.addEventListener('click', async () => {
      const domain = domainInput.value.trim();
      const projectDir = pathInput.value.trim().replace(/\/+$/, '');
      if (!domain || !projectDir) return toast('Enter a domain and folder', 'err');
      if (!scan) return toast('Pick a valid project folder first', 'err');
      const mode = modeSelect.value;
      const framework = frameworkSelect.value;
      if (!mysqlField.hidden && !mysqlInput.value) return toast('Enter the MySQL root password', 'err');

      createBtn.disabled = true;
      progressWrap.hidden = false;
      logBox.innerHTML = '';
      fill.className = 'progress-fill indeterminate';
      stageLabel.children[0].textContent = 'Working…';
      activeSiteLog = (evt) => {
        if (evt.kind === 'stage') { stageLabel.children[0].textContent = evt.line; logLine(`▸ ${evt.line}`, 'ok'); }
        else logLine(evt.line);
      };
      try {
        const res = await window.api.vhost.create({
          domain, projectDir, mode, framework,
          mysqlRootPassword: mysqlInput.value,
          fixPermissions: fixPermsInput.checked,
        });
        if (res.ok) {
          fill.className = 'progress-fill';
          fill.style.width = '100%';
          stageLabel.children[0].textContent = `Done — http://${domain} is ready`;
          logLine(`✓ Virtual host ${domain} → ${res.docRoot}`, 'ok');
          (res.notes || []).forEach((n) => logLine(`• ${n}`));
          toast(`Virtual host ${domain} created`, 'ok');
          await addNewSiteToCurrentGroup(domain);
          refreshVhostList();
        } else {
          fill.className = 'progress-fill';
          fill.style.width = '100%';
          stageLabel.children[0].textContent = 'Failed';
          logLine(res.error || 'Failed to create virtual host', 'err');
          toast(res.error || 'Failed to create virtual host', 'err');
        }
      } catch (e) {
        logLine(e.message, 'err');
        toast(e.message, 'err');
      } finally {
        activeSiteLog = null;
        createBtn.disabled = false;
      }
    });

    return card;
  }

  // ---------------- Delete dialog ----------------
  async function openDeleteDialog(domain) {
    const info = await window.api.vhost.inspect(domain);
    if (!info.ok) return toast(info.error || 'Could not read virtual host', 'err');

    const overlay = el('div', { class: 'modal-overlay' });
    const modal = el('div', { class: 'modal' });
    overlay.appendChild(modal);
    const close = () => { if (!busy) overlay.remove(); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    let busy = false;

    modal.appendChild(el('h2', { text: `Delete ${domain}?` }));
    const body = el('div', { class: 'body' });
    modal.appendChild(body);

    const facts = el('table', { class: 'facts' });
    const fact = (k, v, cls = '') => facts.appendChild(el('tr', {}, [el('td', { class: 'faint', text: k }), el('td', { class: cls, text: v })]));
    fact('Framework', info.framework || 'Unknown / plain PHP');
    fact('Project folder', info.projectDir || '—', 'mono');
    if (info.database && info.database.engine === 'mysql') {
      fact('Database', `MySQL "${info.database.name}"${info.database.user ? ` · user "${info.database.user}"` : ''}${info.database.host ? ` · ${info.database.host}` : ''}`, 'mono');
    } else if (info.database && info.database.engine === 'sqlite') {
      fact('Database', `SQLite · ${info.database.path}`, 'mono');
    } else {
      fact('Database', 'None found');
    }
    body.appendChild(facts);

    const option = (label, hint, disabledReason) => {
      const input = el('input', { type: 'checkbox', ...(disabledReason ? { disabled: 'disabled' } : {}) });
      const row = el('label', { class: `delete-option${disabledReason ? ' disabled' : ''}` }, [
        input,
        el('div', {}, [el('div', { text: label }), el('div', { class: 'faint', text: disabledReason || hint })]),
      ]);
      body.appendChild(row);
      return input;
    };

    option('Remove the virtual host', 'Apache config and /etc/hosts entry. Always done.', null).checked = true;
    body.lastChild.querySelector('input').disabled = true;

    const filesBox = option(
      'Delete all project files',
      `Permanently deletes ${info.projectDir} and everything in it${info.database && info.database.engine === 'sqlite' ? ', including the SQLite database' : ''}. This cannot be undone.`,
      info.filesBlocked ? `Not available: ${info.filesBlocked}` : null
    );

    const db = info.database && info.database.engine === 'mysql' ? info.database : null;
    const dbBox = db
      ? option(
        `Drop the MySQL database "${db.name}"`,
        'Deletes all its tables and data, plus its MySQL user if no other database uses it. This cannot be undone.',
        db.droppable ? null : `Not available: ${db.reason}`
      )
      : null;

    const pwInput = el('input', { type: 'password', placeholder: 'MySQL root password' });
    const pwField = el('label', { class: 'field', hidden: 'hidden' }, [el('span', { text: 'MySQL root password' }), pwInput]);
    body.appendChild(pwField);

    const confirmInput = el('input', { type: 'text', placeholder: domain });
    const confirmField = el('label', { class: 'field', hidden: 'hidden' }, [el('span', { text: `Type ${domain} to confirm` }), confirmInput]);
    body.appendChild(confirmField);

    const status = el('div', { class: 'console', style: 'height:110px;', hidden: 'hidden' });
    body.appendChild(status);

    const cancelBtn = el('button', { class: 'ghost', text: 'Cancel', onclick: close });
    const deleteBtn = el('button', { class: 'danger', text: 'Delete virtual host' });
    modal.appendChild(el('div', { class: 'actions' }, [cancelBtn, deleteBtn]));

    function update() {
      const files = filesBox.checked;
      const drop = Boolean(dbBox && dbBox.checked);
      pwField.hidden = !drop;
      confirmField.hidden = !(files || drop);
      deleteBtn.textContent = files && drop ? 'Delete everything' : files ? 'Delete site & files' : drop ? 'Delete site & database' : 'Delete virtual host';
      deleteBtn.disabled = (files || drop) && confirmInput.value.trim() !== domain;
    }
    [filesBox, dbBox, confirmInput].filter(Boolean).forEach((n) => n.addEventListener('input', update));
    [filesBox, dbBox].filter(Boolean).forEach((n) => n.addEventListener('change', update));
    update();

    deleteBtn.addEventListener('click', async () => {
      const opts = { deleteFiles: filesBox.checked, dropDatabase: Boolean(dbBox && dbBox.checked), mysqlRootPassword: pwInput.value };
      busy = true;
      deleteBtn.disabled = cancelBtn.disabled = true;
      status.hidden = false;
      status.innerHTML = '';
      const logLine = (text, cls = '') => { status.appendChild(el('div', { class: `line ${cls}`, text })); status.scrollTop = status.scrollHeight; };
      activeSiteLog = (evt) => logLine(`▸ ${evt.line}`);
      try {
        const res = await window.api.vhost.delete(domain, opts);
        (res.notes || []).forEach((n) => logLine(`• ${n}`, 'ok'));
        if (res.ok) {
          toast(`${domain} deleted`, 'ok');
          busy = false;
          overlay.remove();
          refreshVhostList();
        } else {
          logLine(res.error || 'Delete failed', 'err');
          toast(res.error || 'Delete failed', 'err');
          busy = false;
          cancelBtn.disabled = false;
          update();
          refreshVhostList();
        }
      } catch (e) {
        logLine(e.message, 'err');
        busy = false;
        cancelBtn.disabled = false;
        update();
      } finally {
        activeSiteLog = null;
      }
    });

    document.body.appendChild(overlay);
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

  // ---------------- About ----------------
  async function renderAbout(content) {
    const version = await window.api.getVersion();
    content.innerHTML = '';
    content.appendChild(el('h1', { class: 'page-title', text: 'About' }));
    content.appendChild(el('p', { class: 'page-sub', text: 'Local LAMP stack installer and virtual host manager for Ubuntu.' }));

    // Opening a browser can fail when running as root; fall back to copying the link.
    const link = (label, url) => el('a', {
      class: 'link',
      href: '#',
      text: label,
      onclick: async (e) => {
        e.preventDefault();
        const res = await window.api.openExternal(url);
        if (res.ok) return;
        try {
          await navigator.clipboard.writeText(label);
          toast(`Couldn't open a browser — copied ${label} to the clipboard`, 'ok');
        } catch {
          toast(res.error || 'Could not open link', 'err');
        }
      },
    });

    const facts = el('table', { class: 'facts' });
    const fact = (label, value) => facts.appendChild(el('tr', {}, [el('td', { class: 'faint', text: label }), el('td', {}, [value])]));
    fact('Version', version);
    fact('Author', 'Tejas Hingu');
    fact('Email', link('tejas@tejashingu.com', 'mailto:tejas@tejashingu.com'));
    fact('Website', link('tejashingu.com', 'https://tejashingu.com'));
    fact('Source', link('github.com/tejashingu/Lampstand', 'https://github.com/tejashingu/Lampstand'));
    fact('Report a bug', link('github.com/tejashingu/Lampstand/issues', 'https://github.com/tejashingu/Lampstand/issues'));
    fact('License', 'MIT');

    content.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'about-head' }, [
        el('img', { src: 'assets/logo.png', alt: '', class: 'about-logo' }),
        el('div', {}, [
          el('h2', { text: 'Lampstand' }),
          el('div', { class: 'faint', text: `Version ${version}` }),
        ]),
      ]),
      facts,
    ]));

    content.appendChild(el('div', { class: 'card' }, [
      el('h2', { text: 'Privacy' }),
      el('p', { class: 'sub', text: 'Lampstand does not collect any telemetry, analytics or usage data, and has no crash reporting or update check. It only goes online for actions you start, and only to official sources: Ubuntu\'s apt repositories, wordpress.org for WordPress, Packagist (Composer) for the official Laravel, Symfony, Drupal and other starter projects, the npm registry for their frontend dependencies, and NVM\'s GitHub repository.' }),
    ]));
  }

  function init() {
    window.api.site.onLog((evt) => activeSiteLog && activeSiteLog(evt));
    document.querySelectorAll('.sidebar .navitem').forEach((btn) => {
      btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
    });
  }

  return { init, render, setActiveTab };
})();
