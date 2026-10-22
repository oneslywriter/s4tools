'use strict';
// App shell: the header, the two views (Live: play the S-4; Build: make projects for it), keys, theme, startup.
(function (S4) {
  const h = S4.h;
  const VIEWS = { live: 'Live', build: 'Build' };
  const saved = S4.store.get('view', 'live');
  const app = S4.app = { view: saved === 'build' || saved === 'creator' ? 'build' : 'live' };
  const els = {};

  // Colour themes (css/themes.css). The stored choice may be "system", which follows the OS: Paper or Night.
  // index.html applies it before the first paint.
  const dark = matchMedia('(prefers-color-scheme: dark)');
  S4.theme = {
    LIST: [
      { id: 'system', label: 'System', hint: 'Paper or Night, as your computer is set' },
      { id: 'light', label: 'Paper' },
      { id: 'dark', label: 'Night' },
      { id: 'mono', label: 'Mono' },
      { id: 'chalk', label: 'Chalk' },
      { id: 'slate', label: 'Slate' },
      { id: 'meadow', label: 'Meadow' },
    ],
    get() {
      const t = S4.store.get('theme', 'system');
      return S4.theme.LIST.some(x => x.id === t) ? t : 'system';
    },
    resolve: t => (t === 'system' ? (dark.matches ? 'dark' : 'light') : t),
    apply() {
      document.documentElement.dataset.theme = S4.theme.resolve(S4.theme.get());
      S4.emit('theme');
    },
    set(t) {
      S4.store.set('theme', t);
      S4.theme.apply();
    },
  };
  dark.addEventListener('change', () => { if (S4.theme.get() === 'system') S4.theme.apply(); });

  function buildHeader() {
    const hdr = document.getElementById('hdr');
    const tab = v => h('button', { class: 'vtab', 'data-view': v, onclick: () => setView(v) }, VIEWS[v]);
    els.learn = h('button', { class: 'btn learn only-live', title: 'Teach s4tools your MIDI controller: click controls here, move knobs there (L). Or right-click any control.', onclick: () => S4.listen.toggle() }, S4.icon('learn'), 'Learn');
    els.mapCount = h('span', { class: 'count' });
    els.maps = h('button', { class: 'btn only-live', title: 'Control maps: your saved sets of learned controls', onclick: e => S4.listen.presetMenu(e.currentTarget) }, 'Control maps', els.mapCount, S4.icon('chev'));
    els.play = S4.tbutton('btn.play', '', { cls: 'icon-only', title: 'Start or stop the S-4 (Space)' });
    const upd = els.play._update;
    els.play._update = () => { upd(); els.play.innerHTML = ''; els.play.append(S4.icon(S4.ctl.get('btn.play') ? 'stop' : 'play')); };
    els.play._update();
    els.rec = S4.tbutton('btn.rec', [h('i', { class: 'dot rec' }), 'Rec'], { title: "The S-4's own recording of its main out (MAIN REC)" });
    els.tempo = h('span', { class: 'tempo', title: "The S-4's tempo, read from its MIDI clock while it plays" });
    els.conn = h('button', { class: 'conn', onclick: () => S4.settings.open() }, h('i', { class: 'dot' }), els.connTxt = h('span'));
    hdr.append(
      h('div', { class: 'brand', title: 's4tools for the Torso S-4' }, S4.icon('logo'), h('span', { class: 'wordmark' }, 's4tools')),
      h('nav', { class: 'vtabs' }, tab('live'), tab('build')),
      h('span', { class: 'sp' }),
      els.learn, els.maps,
      h('div', { class: 'transport only-live' }, els.play, els.rec, els.tempo),
      els.conn,
      h('button', { class: 'btn icon-only', title: 'Settings', onclick: () => S4.settings.open() }, S4.icon('gear')));
  }

  function renderConn() {
    const M = S4.midi;
    const silent = M.connected() && M.answer === 'none', ok = M.connected() && !silent;
    els.conn.classList.toggle('ok', ok);
    els.conn.classList.toggle('bad', silent || M.status === 'denied' || M.status === 'unsupported');
    els.connTxt.textContent = silent ? 'No reply' : ok ? 'Connected' : M.status === 'ready' ? 'Not connected' : M.status === 'init' ? 'MIDI…' : 'No MIDI';
    els.conn.title = silent ? "The S-4 didn't reply to the last start / stop. Click for help."
      : ok ? `Talking to ${M.out.name}` : 'No S-4 found. Click for MIDI settings.';
  }
  function renderTempo(bpm) {
    // the slot keeps its width without a clock, so nothing shifts under the cursor
    els.tempo.style.visibility = bpm == null ? 'hidden' : 'visible';
    els.tempo.textContent = bpm == null ? '' : `${bpm.toFixed(1)} bpm`;
  }
  const renderMapCount = () => { els.mapCount.textContent = S4.listen.maps.length || ''; };

  function setView(v) {
    app.view = v;
    S4.store.set('view', v);
    document.body.dataset.view = v;
    document.querySelectorAll('.vtab').forEach(t => t.classList.toggle('on', t.dataset.view === v));
    document.getElementById('view-live').hidden = v !== 'live';
    document.getElementById('view-build').hidden = v !== 'build';
    document.getElementById('subbar').hidden = v !== 'build';
    if (v !== 'live' && S4.listen.active) S4.listen.toggle(false);
    S4.closeMenu();
    S4.build.show(v === 'build');
  }

  document.addEventListener('keydown', e => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || document.querySelector('.modal-back') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' && tag !== 'BUTTON') {
      e.preventDefault();
      if (app.view === 'live') { S4.ctl.press('btn.play', true); S4.ctl.press('btn.play', false); }
      else S4.build.togglePlay();
    } else if (app.view === 'live' && (e.key === 'l' || e.key === 'L')) {
      S4.listen.toggle();
    } else if (app.view === 'live' && /^[1-4]$/.test(e.key)) {
      S4.ctl.select(+e.key - 1);
    }
  });

  window.addEventListener('DOMContentLoaded', () => {
    buildHeader();
    S4.live.mount(document.getElementById('view-live'));
    S4.build.mount(document.getElementById('view-build'), document.getElementById('subbar'));
    S4.on('listen', on => els.learn.classList.toggle('on', on));
    S4.on('mappings', renderMapCount);
    S4.on('midi-ports', renderConn);
    S4.on('tempo', renderTempo);
    renderMapCount();
    renderConn();
    renderTempo(null);
    setView(app.view);
    S4.midi.init();
  });
})(window.S4);
