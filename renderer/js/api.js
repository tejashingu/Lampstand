// Thin helpers shared by wizard.js / dashboard.js / app.js

function toast(message, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c === null || c === undefined) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// Theme: 'system' (default, follows OS light/dark via CSS prefers-color-scheme),
// or an explicit 'light'/'dark' override persisted per-machine in localStorage.
const Theme = (() => {
  const KEY = 'vhm_theme';

  function get() {
    try { return localStorage.getItem(KEY) || 'system'; } catch (e) { return 'system'; }
  }

  function apply(theme) {
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  function set(theme) {
    try { localStorage.setItem(KEY, theme); } catch (e) { /* ignore */ }
    apply(theme);
  }

  // Applied immediately (not on DOMContentLoaded) so there's no flash of the
  // wrong theme before the rest of the scripts finish loading.
  apply(get());

  return { get, set };
})();
