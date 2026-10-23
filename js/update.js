'use strict';
// Tells a page left open that the site has been updated. The deploy writes the commit into index.html (the
// s4tools-version meta tag: the version this page is) and into version.json (the version the site has now),
// which it uploads after everything else. The page checks version.json every few minutes and when it comes back
// into view; when the two differ, a bar under the header asks for a reload with Ctrl+Shift+R. It never reloads
// by itself, since a take may be recording. A copy without a version (run from the repo: "dev") doesn't check.
(function (S4) {
  const h = S4.h;
  const EVERY = 5 * 60 * 1000;  // between checks
  const AGAIN = 30 * 60 * 1000; // "Later" hides the bar this long
  const meta = document.querySelector('meta[name="s4tools-version"]');
  const U = S4.update = { mine: meta ? meta.content : '', latest: null, later: 0 };
  const on = () => !!U.mine && U.mine !== 'dev';
  U.outdated = () => !!U.latest && U.latest !== U.mine;

  U.check = async function () {
    if (!on()) return null;
    try {
      const r = await fetch('version.json', { cache: 'no-store' });
      const v = r.ok ? (await r.json()).version : null;
      if (typeof v === 'string' && v) U.latest = v;
    } catch (e) { /* offline, or the file is being replaced: next time */ }
    render();
    return U.latest;
  };

  function render() {
    const bar = document.getElementById('updateBar');
    if (!bar) return;
    bar.hidden = !(U.outdated() && Date.now() >= U.later);
    if (!bar.hidden && !bar.firstChild) {
      bar.append(
        h('span', null, h('b', null, 's4tools has been updated.'), ' Reload with Ctrl+Shift+R (Cmd+Shift+R on a Mac) to get the new version. Your work in Build is kept.'),
        h('span', { class: 'sp' }),
        h('button', { class: 'btn', title: 'Hide this for half an hour', onclick: () => { U.later = Date.now() + AGAIN; render(); } }, 'Later'));
    }
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden) U.check(); });
  window.addEventListener('DOMContentLoaded', () => {
    if (!on()) return;
    U.check();
    setInterval(() => { if (!document.hidden) U.check(); }, EVERY);
  });
})(window.S4);
