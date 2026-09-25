<p align="center"><img src="renderer/assets/logo.png" width="96" height="96" alt="Lampstand logo" /></p>

# Lampstand

A modern, self-contained Electron app that turns a fresh Ubuntu machine into a local LAMP
development server, and gives you a GUI to manage virtual hosts, user access, and file
permissions afterwards.

## What it does

**Setup wizard** (auto-detects what's already installed and skips it):
- Apache2
- PHP + the extension set needed by WordPress, Drupal and Laravel (`mbstring`, `curl`, `gd`,
  `xml`, `zip`, `intl`, `bcmath`, `mysqli`/`PDO`, `opcache`, `imagick`, `soap`, ...)
- Node.js (via apt) and **NVM installed system-wide** (`/usr/local/nvm`, loaded for every user
  via `/etc/profile.d/nvm.sh`, shared `nvm` group for write access)
- MySQL Server, with the standard `mysql_secure_installation` hardening applied automatically
- phpMyAdmin, wired into Apache with zero interactive prompts

All packages come from Ubuntu's official apt repositories — nothing is downloaded from
third-party PPAs.

**Dashboard**, once set up:
- **Virtual Hosts** — pick a project folder, give it a local domain, and it creates the Apache
  vhost config, adds the `/etc/hosts` entry, and reloads Apache. Enable/disable or delete from
  the same screen — deleting can optionally remove the project files and database as well.
  - **Framework installs** — optionally install a fresh project into an empty folder: WordPress
    (with its MySQL database, user and `wp-config.php` created for you), Laravel, Laravel +
    Inertia (React or Vue) and Laravel + Livewire starter kits (assets built with npm), Symfony,
    Drupal, CodeIgniter 4, CakePHP, Yii 2 or Slim. Composer/npm run as the folder's owner, not
    root, and Composer is installed from apt if it's missing.
  - **Existing-folder scan** — point it at a folder that already has a project and it detects
    WordPress (incl. Bedrock), Laravel (and which Inertia/Livewire stack), Drupal, Symfony,
    CodeIgniter, CakePHP, Yii, Craft CMS, Slim or Joomla, sets the right document root
    (`public/`, `web/`, `webroot/`, ...), and can give Apache write access to the cache/upload
    folders. You can override the detected framework if the scan gets it wrong.
  - `mod_rewrite` is enabled automatically, and you're warned if Apache can't reach the folder
    (e.g. a private home directory).
- **Users & Groups** — toggle any system user's membership in `www-data` (so they can write to
  the web root) and the shared `nvm` group, or create a brand-new user.
- **Permissions** — scans `/var/www/html` for anything that isn't `www-data:www-data`,
  directories at `775`, and files at `664`, then fixes it all in one click (with the setgid bit
  set on directories so new files inherit the group).
- **Services** — start/stop/restart Apache and MySQL, and toggle whether they start on boot.
- **Settings** — a "Launch Lampstand at login" toggle (Overview tab) adds/removes a standard
  XDG autostart entry in your own `~/.config/autostart/`, correctly attributed to you even
  though the app itself runs as root. The autostart launch is unprivileged and starts minimized
  to a system tray icon (open it from there, or Quit) — no password prompt interrupts your login,
  and you still get the usual prompt the first time you use a privileged action in that session.
  The same card has a **Theme** picker (Match System / Light / Dark) — "Match System" follows
  the OS light/dark setting automatically via `prefers-color-scheme`; the explicit choices
  override it and persist locally.

## Running from source

Everything that touches the system (apt, systemctl, chown, usermod, Apache/hosts config) needs
root, so the whole app runs as root — there's no per-action password prompting.

```bash
npm install        # as your normal user
sudo ./scripts/start.sh
```

The script re-execs itself with `sudo` if needed and launches Electron with `--no-sandbox`
(required by Chromium when running as root).

## Distribution

### 1. Build installable packages

```bash
npm run dist
```

`electron-builder` (already configured in `package.json`) produces two artifacts in `dist/`:

- **`Lampstand-1.2.0.AppImage`** — a single portable executable, no installation needed.
  `chmod +x` it and double-click, or run it from a terminal.
- **`lampstand_1.2.0_amd64.deb`** — a normal Debian package for `sudo apt install ./lampstand_*.deb`
  or `sudo dpkg -i` (installs to `/opt/Lampstand`).

The app menu icon these create launches Lampstand **unprivileged** — you get the dashboard
(status, browsing vhosts/users/permissions) straight away, with a "Not root" banner. Any action
that changes the system (installs, `chown`/`chmod`, `usermod`, editing Apache config, ...) will
error asking you to relaunch with elevated privileges. Two ways to get those:

- Run it from a terminal with `sudo lampstand` (or `pkexec lampstand`).
- Or install the bundled **admin launcher**: copy
  `build/lampstand-admin.desktop.template` to `~/.local/share/applications/lampstand-admin.desktop`
  (drop the `.template` suffix). It adds a second "Lampstand (Admin)" icon to your app menu that
  launches via `pkexec`, showing a native polkit password prompt — no terminal needed. It assumes
  the `.deb` install path (`/opt/Lampstand/lampstand`); adjust the `Exec=` line if you're running
  the AppImage instead.

### 2. Share the build

The simplest path for getting this to other people/machines:

1. Run `npm run dist` on a machine with the right Node/Electron toolchain.
2. Create a GitHub repository (or use an existing one) and push this project — `git init`,
   commit, `git remote add origin ...`, `git push`.
3. Create a **GitHub Release** and attach the `.deb` and `.AppImage` from `dist/`. Users then
   just download the asset that matches their preference and run it — no build step on their
   end.
4. Optionally add a one-line install script to your release notes, e.g.:
   ```bash
   wget https://github.com/<you>/lampstand/releases/latest/download/lampstand_1.2.0_amd64.deb
   sudo apt install ./lampstand_1.2.0_amd64.deb
   ```

### 3. Further options (not set up yet, worth knowing about)

- **PPA / apt repository** — lets users `add-apt-repository` and get updates via `apt upgrade`.
  Needs a Launchpad account and GPG-signed uploads; more setup than most personal tools need.
- **Snap Store** — very Ubuntu-native, but Lampstand needs broad root access (apt, systemctl,
  usermod, arbitrary file ownership) that doesn't fit cleanly into Snap's confinement model
  without `classic` confinement, which requires manual Snap Store approval.
- **Self-hosted download page** — if you don't want a public GitHub repo, you can host the
  `.deb`/`.AppImage` files anywhere (your own site, a private release, etc.) — the install steps
  for the end user stay the same.

For most cases, GitHub Releases (#2 above) is the right amount of effort: no server to run, free
hosting, and versioned downloads users can trust.

## Safety notes

- On first launch you'll be asked to accept a short terms notice: this software modifies system
  packages and files, is provided with no warranty, and is released under the MIT license (see
  [LICENSE](LICENSE)).
- Deleting a virtual host opens a dialog showing the site's framework, project folder and
  database (read from `wp-config.php`, `.env`, Drupal's `settings.php`, ...). By default only the
  Apache config and `/etc/hosts` entry are removed. You can also tick **Delete all project
  files** and/or **Drop the MySQL database** (its MySQL user is dropped too, unless it has
  access to other databases); either one requires typing the domain to confirm. Lampstand
  refuses to delete system folders, home folders, `/var/www/html`, or any folder another site
  still uses, and won't drop system or remote databases.
- The Permissions tool only ever targets the directory you point it at (default
  `/var/www/html`); it validates the path before running `chown`/`chmod`.

## Project layout

```
main.js                     Electron main process, IPC handlers, root check
preload.js                  contextBridge API surface exposed to the renderer
backend/                    System automation: apt, apache, mysql, phpmyadmin, users, permissions, services
renderer/                   UI (vanilla HTML/CSS/JS, no build step)
scripts/start.sh            Dev launcher (sudo + --no-sandbox)
build/icon.png                        App icon used by electron-builder
build/lampstand-admin.desktop.template  Optional pkexec-based admin launcher (see Distribution)
```

## License

MIT — see [LICENSE](LICENSE).

---

Built by [Tejas Hingu](mailto:tejas@tejashingu.com).
