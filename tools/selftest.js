// Self-test for the whole app, run inside the page (it is not part of the site). It replaces MIDI with a fake S-4
// (which answers START / STOP) and a fake controller, the audio input with a generated signal, and downloads,
// prompts and file pickers with stubs; then it drives Live, Learn, the recorder, Build, the dialogs and every
// theme, and checks what goes out over MIDI, what lands in the project and what the screen shows.
// Usage (a test browser profile, never one with work in it: it replaces the Build project):
//   const src = await (await fetch('/tools/selftest.js', { cache: 'no-store' })).text(); await (0, eval)(src)
// -> { pass, fail: [...], notes: {...}, errors: [...] }
(async () => {
  const T = { pass: 0, fail: [], notes: {}, errors: [] };
  const ok = (cond, name, info) => { if (cond) T.pass++; else T.fail.push(name + (info !== undefined ? ' :: ' + JSON.stringify(info).slice(0, 300) : '')); return !!cond; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // a page in a hidden pane gets no animation frames: run them on a timer so drawing code still runs
  const rafOk = await Promise.race([new Promise(r => requestAnimationFrame(() => r(true))), sleep(150).then(() => false)]);
  if (!rafOk) { window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16); T.notes.raf = 'shimmed (hidden page)'; }
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const ce = console.error;
  console.error = (...a) => { T.errors.push(a.map(x => (x && x.stack) || String(x)).join(' ').slice(0, 300)); ce.apply(console, a); };
  const onErr = e => T.errors.push('uncaught: ' + (e.message || e.reason));
  addEventListener('error', onErr);
  addEventListener('unhandledrejection', onErr);
  const section = async (name, fn) => {
    const f0 = T.fail.length;
    try { await fn(); } catch (e) { T.fail.push(`${name}: threw ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`); }
    T.notes['section ' + name] = T.fail.length === f0 ? 'ok' : `${T.fail.length - f0} failed`;
    S4.closeMenu();
    $$('.modal-back').forEach(m => m.remove());
  };

  // ---------- fakes ----------
  const M = S4.midi, sent = [];
  let s4playing = false;
  const fakeS4in = { id: 'fake-s4-in', name: 'MIDI function', type: 'input', state: 'connected', onmidimessage: null, close: async () => {} };
  const fakeCtl = { id: 'fake-ctl', name: 'Fake Controller', type: 'input', state: 'connected', onmidimessage: null, close: async () => {} };
  const fakeOut = {
    id: 'fake-s4-out', name: 'MIDI function', type: 'output', state: 'connected', close: async () => {},
    send(b, ts) {
      const a = [...b];
      sent.push({ a, ts: ts || performance.now() });
      const play = a[0] === 0x9F && a[1] === 24 && a[2] > 0;
      if (play || a[0] === 0xFA || a[0] === 0xFC) { // the S-4 answers with its own START / STOP
        s4playing = a[0] === 0xFA ? true : a[0] === 0xFC ? false : !s4playing;
        const msg = s4playing ? 0xFA : 0xFC;
        setTimeout(() => fakeS4in.onmidimessage && fakeS4in.onmidimessage({ data: new Uint8Array([msg]), timeStamp: performance.now() }),
          Math.max(0, (ts || performance.now()) - performance.now()) + 30);
      }
    },
  };
  if (M.access) { M.access.onstatechange = null; for (const p of M.access.inputs.values()) p.onmidimessage = null; }
  M.init = async () => {};
  M.reopen = async () => { M.reopened++; };
  M.access = { inputs: new Map([[fakeS4in.id, fakeS4in], [fakeCtl.id, fakeCtl]]), outputs: new Map([[fakeOut.id, fakeOut]]), onstatechange: null };
  M.status = 'ready';
  Object.assign(M.settings, { outId: null, inId: null, ctrlIds: null, transport: 'note', pcCh: 16 });
  M.refresh();
  const hex = a => a.map(x => x.toString(16).padStart(2, '0')).join(' ');
  const take = () => sent.splice(0).map(x => hex(x.a));
  const ctlSend = (...bytes) => fakeCtl.onmidimessage({ data: new Uint8Array(bytes), timeStamp: performance.now() });
  const downloads = [];
  S4.download = (blob, name) => downloads.push({ blob, name });
  let promptAnswer = null;
  window.prompt = () => promptAnswer;
  window.confirm = () => true;
  let pickQueue = [];
  S4.pickFiles = async () => pickQueue.shift() || [];
  const press = (el, down = true) => el.dispatchEvent(new PointerEvent(down ? 'pointerdown' : 'pointerup', { bubbles: true, button: 0, pointerId: 1 }));
  const tap = el => { press(el, true); press(el, false); };
  const key = (el, k, extra) => el.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra)));
  // a menu item's text without its check mark
  const itemText = b => b.textContent.replace(/^●/, '');
  const menuItems = () => $$('.menu .menu-item').map(itemText);
  const pick = text => { const b = $$('.menu .menu-item').find(x => itemText(x).startsWith(text)); if (b) b.click(); return !!b; };
  const ctxmenu = el => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  const view = v => { $(`.vtab[data-view=${v}]`).click(); };
  // no colour transitions: a hidden page doesn't run them, and the contrast checks read the end colours
  document.head.append(Object.assign(document.createElement('style'), { textContent: '*, *::before, *::after { transition: none !important; }' }));

  // ---------- contrast ----------
  function parseColor(c) {
    c = (c || '').trim();
    let m;
    if ((m = /^#([0-9a-f]{6})$/i.exec(c))) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
    if ((m = /^rgba?\(([^)]+)\)/.exec(c))) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat); return [p[0], p[1], p[2], p[3] == null ? 1 : p[3]]; }
    if ((m = /^color\(srgb ([^)]+)\)/.exec(c))) { const p = m[1].split(/[\s/]+/).filter(Boolean).map(parseFloat); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] == null ? 1 : p[3]]; }
    return null;
  }
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const over = (top, bot) => [0, 1, 2].map(i => top[i] * top[3] + bot[i] * (1 - top[3])).concat(1);
  const tok = n => parseColor(getComputedStyle(document.documentElement).getPropertyValue(n));
  function bgOf(el) {
    const layers = [];
    for (let x = el; x && x.nodeType === 1; x = x.parentElement) {
      const c = parseColor(getComputedStyle(x).backgroundColor);
      if (c && c[3] > 0.02) { layers.push(c); if (c[3] > 0.99) break; }
    }
    let base = tok('--bg');
    for (let i = layers.length - 1; i >= 0; i--) base = layers[i][3] > 0.99 ? layers[i] : over(layers[i], base);
    return base;
  }
  // every visible element with its own text: contrast of its colour on what is behind it
  function audit(minRatio) {
    const low = [];
    for (const el of $$('#app *, .modal *, .menu *, .pop *')) {
      if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
      const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      let faded = false;
      for (let x = el; x; x = x.parentElement) { const s = getComputedStyle(x); if (+s.opacity < 0.9 || x.disabled) { faded = true; break; } }
      if (faded) continue;
      const fg = parseColor(getComputedStyle(el).color), bg = bgOf(el);
      if (!fg || !bg) continue;
      const q = ratio(over(fg, bg), bg);
      if (q < minRatio) low.push(`${el.className || el.tagName}:"${el.textContent.trim().slice(0, 18)}" ${q.toFixed(2)}`);
    }
    return low;
  }
  function overflow() {
    const bad = [];
    ['#hdr', '#subbar', '.lv-top', '.lane', '.tiles', '.lane-head', '.lane-mix', '.recbar', '.lv-insp', '.insp-head', '.bd-pads', '.pads-head',
      '.blane', '.bl-info', '.bl-head', '.bd-insp', '.ibody', '.itabs', '.lib-head', '.modal'].forEach(sel => $$(sel).forEach(el => {
      if (el.offsetParent && el.scrollWidth > el.clientWidth + 1) bad.push(`${sel} ${el.scrollWidth}>${el.clientWidth}`);
    }));
    $$('#hdr > *, #subbar > *, .recbar > *, .lv-top > *').forEach(el => {
      const r = el.getBoundingClientRect(), p = el.parentElement.getBoundingClientRect();
      if (el.offsetParent && r.right > p.right + 1) bad.push('clipped ' + (el.className || el.tagName));
    });
    if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('page ' + document.documentElement.scrollWidth);
    return bad;
  }
  T.audit = audit;
  T.overflow = overflow;

  await section('startup', async () => {
    ok(M.out === fakeOut && M.s4in === fakeS4in, 'fake ports picked');
    ok($('.conn').textContent.includes('Connected'), 'connection chip says Connected', $('.conn').textContent);
    ok(!!S4.live && !!S4.build && !!S4.rec && !!S4.listen, 'modules present');
    ok($$('.vtab').map(b => b.textContent).join() === 'Live,Build', 'view tabs', $$('.vtab').map(b => b.textContent));
  });

  // ---------- Live ----------
  await section('live layout', async () => {
    view('live');
    ok(document.body.dataset.view === 'live' && !$('#view-live').hidden && $('#view-build').hidden && $('#subbar').hidden, 'live view shown');
    ok($$('.lane').length === 4, 'four lanes');
    $$('.lane').forEach((l, t) => {
      ok($$('.tile', l).length === 6, `lane ${t} has six tiles`);
      ok($$('.lane-mix .knob', l).length === 3, `lane ${t} has three mixer knobs`);
      ok($$('[data-target]', l).filter(e => /^btn\.(mute|solo|tplay|trec|mon)\./.test(e.dataset.target)).length === 5, `lane ${t} has five buttons`);
    });
    ok($('.lv-master') && $$('.lv-master .knob').length === 2, 'master knobs');
    ok(!!$('.recbar'), 'recorder bar');
    ok(overflow().length === 0, 'live: nothing overflows', overflow());
  });

  await section('live knobs send', async () => {
    const st = S4.state;
    for (let t = 0; t < 4; t++) {
      for (const s of S4.SLOTS) {
        for (const dev of s.devices) {
          S4.ctl.setDevice(t, s.id, dev);
          S4.ctl.select(t, s.id);
          const ids = S4.ctl.paramIds(t, s.id);
          const knobs = $$('.lv-insp .knob');
          ok(knobs.length === ids.length, `T${t + 1} ${dev}: a knob per parameter`, [knobs.length, ids.length]);
          if (!ids.length) { ok(!!$('.lv-insp .insp-note'), `T${t + 1} ${dev}: explains why there are no knobs`); continue; }
          const tile = $$('.lane')[t].querySelectorAll('.tile')[S4.SLOTS.indexOf(s)];
          ok(tile.querySelector('.tile-dev').textContent.startsWith(dev), `T${t + 1} tile shows ${dev}`);
          ok(tile.querySelectorAll('.sky i').length === ids.length, `T${t + 1} ${dev}: a skyline bar per parameter`);
          take();
          for (const k of knobs) {
            const id = k.dataset.target, i = S4.ctl.info(id), v0 = S4.ctl.get(id);
            key(k, v0 >= 127 ? 'ArrowDown' : 'ArrowUp');
            const exp = hex([0xB0 | (t), i.cc, v0 >= 127 ? 126 : v0 + 1]);
            const got = take();
            if (!ok(got.length === 1 && got[0] === exp, `${id} sends CC ${i.cc} on ch ${t + 1}`, { got, exp })) break;
          }
          const k0 = knobs[0], bar = tile.querySelectorAll('.sky i')[0], h0 = bar.style.height;
          key(k0, 'End');
          ok(bar.style.height !== h0 || h0 === '100%', 'skyline follows the knob', [h0, bar.style.height]);
          take();
        }
      }
    }
    // restore the S-4 defaults per slot
    for (let t = 0; t < 4; t++) S4.SLOTS.forEach(s => S4.ctl.setDevice(t, s.id, s.devices[0]));
    take();
    ok(st.tracks.every(tr => tr.devices.material === 'DISC'), 'devices restored');
  });

  await section('live device menu, switch off, reset, roll', async () => {
    S4.ctl.select(1, 'filter');
    $('.lv-insp .insp-dev').click();
    ok(menuItems().some(x => x.includes('RING')) && menuItems().some(x => x.includes('Empty')), 'device menu lists RING and Empty', menuItems());
    pick('Empty');
    ok(S4.state.tracks[1].devices.filter === null && $$('.lane')[1].querySelectorAll('.tile')[2].classList.contains('off'), 'Empty makes the tile pale');
    S4.ctl.setDevice(1, 'filter', 'RING');
    S4.ctl.select(1, 'filter');
    const ids = S4.ctl.paramIds(1, 'filter'), wet = S4.DEVICES.RING.wet;
    S4.ctl.set(`p.1.filter.${wet[0]}`, 90);
    take();
    const tools = $$('.lv-insp .insp-tools .ib');
    ok(tools.length === 3, 'switch off, reset, roll buttons');
    tools[0].click();
    ok(S4.ctl.isBypassed(1, 'filter') && S4.ctl.get(`p.1.filter.${wet[0]}`) === 0, 'switch off zeroes the wet');
    ok(take().includes(hex([0xB1, wet[0], 0])), 'switch off sends wet 0');
    ok($$('.lane')[1].querySelectorAll('.tile')[2].classList.contains('off'), 'switched-off tile is pale');
    $$('.lv-insp .insp-tools .ib')[0].click();
    ok(!S4.ctl.isBypassed(1, 'filter') && S4.ctl.get(`p.1.filter.${wet[0]}`) === 90, 'switch on restores the wet');
    ok(take().includes(hex([0xB1, wet[0], 90])), 'switch on sends the old wet');
    $$('.lv-insp .insp-tools .ib')[1].click();
    ok(ids.every(id => S4.ctl.get(id) === S4.ctl.info(id).def), 'reset puts every knob at its default');
    // the defaults are the S-4's own (s4params.js): RING WET 100%, DISC TEMPO 120 BPM, LEVEL 0 dB
    ok(S4.ctl.get(`p.1.filter.${wet[0]}`) === 127 && S4.param('DISC', 47).def === 13 && S4.param('DISC', 56).def === 66 && S4.param('TAPE', 50).def === 66,
      'the defaults are the S-4\'s', [S4.ctl.get(`p.1.filter.${wet[0]}`), S4.param('DISC', 47).def, S4.param('DISC', 56).def]);
    take();
    $$('.lv-insp .insp-tools .ib')[2].click();
    const vals = ids.map(id => [id, S4.ctl.get(id), S4.ctl.info(id)]);
    ok(vals.every(([, v, i]) => v <= ((i.p && i.p.safeMax) || 127)), 'roll stays inside the safe range');
    take();
  });

  await section('live mods, mixer, master, macros', async () => {
    for (let t = 0; t < 4; t++) {
      $$('.lane')[t].querySelectorAll('.tile')[5].click();
      for (let m = 0; m < 4; m++) {
        $$('.lv-insp .insp-tabs .seg button')[m].click();
        const ks = $$('.lv-insp .knob');
        ok(ks.length === 8, `T${t + 1} MOD ${m + 1} has eight knobs`);
        take();
        key(ks[0], 'ArrowUp');
        const id = ks[0].dataset.target, i = S4.ctl.info(id);
        ok(i.cc === S4.modCC(m, 0) && take().length === 1, `T${t + 1} MOD ${m + 1} knob sends CC ${S4.modCC(m, 0)}`);
      }
      $('.lv-insp .insp-dev').click();
      pick('ADSR');
      ok(S4.state.tracks[t].modTypes[3] === 'ADSR' && $$('.lane')[t].querySelectorAll('.tile')[5].textContent.includes('ADSR'), `T${t + 1} MOD 4 type set to ADSR`);
      ok($$('.lv-insp .knob .k-label').map(x => x.textContent).includes('SUSTAIN'), 'ADSR knobs named');
      S4.state.tracks[t].modTypes[3] = 'WAVE';
      // mixer
      const lane = $$('.lane')[t];
      ['lvl', 'pan', 'fltr'].forEach((k, j) => {
        S4.ctl.set(`mix.${k}.${t}`, 64, { send: false });
        take();
        key(lane.querySelectorAll('.lane-mix .knob')[j], 'ArrowDown');
        const got = take(), cc = S4.MIX_CC[k] + t;
        ok(got.length === 1 && got[0].startsWith(hex([0xBF, cc])), `T${t + 1} ${k} sends CC ${cc} on ch 16`, got);
      });
    }
    S4.saveState();
    [['master.main', 61], ['master.comp', 58]].forEach(([id, cc]) => {
      take();
      key($(`.lv-master .knob[data-target="${id}"]`), 'ArrowUp');
      ok(take()[0].startsWith(hex([0xBF, cc])), `${id} sends CC ${cc}`);
    });
    $$('.lv-top .btn').find(b => b.textContent === 'Macros').click();
    ok($$('.lv-insp .knob').length === 8 && $$('.lv-insp .macro-btns .tb').length === 4, 'macros: eight knobs and four buttons');
    $$('.lv-insp .knob').forEach((k, n) => { S4.ctl.set('macro.' + (n + 1), 10, { send: false }); take(); key(k, 'ArrowUp'); ok(take()[0].startsWith(hex([0xBE, 46 + n])), `M${n + 1} sends CC ${46 + n} on ch 15`); });
    $$('.lv-insp .macro-btns .tb').forEach((b, n) => {
      take(); tap(b);
      ok(take().join() === [hex([0x9E, 24 + n, 127]), hex([0x8E, 24 + n, 0])].join(), `M${n + 9} plays note ${24 + n} on ch 15`);
    });
    $$('.lane')[0].querySelectorAll('.tile')[0].click();
    ok(!$('.lv-insp .macro-btns') && !$$('.lv-top .btn').find(b => b.textContent === 'Macros').classList.contains('on'), 'a tile click leaves the macros');
  });

  await section('live buttons and transport', async () => {
    S4.state.tracks.forEach(tr => { tr.mute = tr.solo = tr.s4muted = false; });
    S4.state.rec = false;
    S4.emit('mutes');
    for (let t = 0; t < 4; t++) {
      const lane = $$('.lane')[t];
      [['tplay', 29], ['trec', 37], ['mon', 41]].forEach(([k, base]) => {
        take();
        tap(lane.querySelector(`[data-target="btn.${k}.${t}"]`));
        const got = take();
        ok(got[0] === hex([0x9F, base + t, 127]), `T${t + 1} ${k} taps note ${base + t}`, got);
        tap(lane.querySelector(`[data-target="btn.${k}.${t}"]`));
        take();
      });
    }
    // mute and solo: the S-4's mute note toggles, so only changes go out
    tap($('[data-target="btn.mute.2"]'));
    ok(take()[0] === hex([0x9F, 27, 127]) && S4.ctl.effectiveMuted(2) && $$('.lane')[2].classList.contains('muted'), 'mute T3');
    tap($('[data-target="btn.solo.0"]'));
    const g = take().filter(x => x.startsWith('9f'));
    ok(g.length === 2 && [1, 3].every(t => S4.ctl.effectiveMuted(t)) && !S4.ctl.effectiveMuted(0), 'solo T1 mutes T2 and T4 (T3 already muted)', g);
    tap($('[data-target="btn.solo.0"]'));
    tap($('[data-target="btn.mute.2"]'));
    take();
    ok([0, 1, 2, 3].every(t => !S4.ctl.effectiveMuted(t)), 'all unmuted again');
    // play / stop through the header; the fake S-4 answers
    s4playing = false;
    S4.state.playing = false;
    tap($('[data-target="btn.play"]'));
    ok(take()[0] === hex([0x9F, 24, 127]) && S4.state.playing, 'play taps C0 on ch 16');
    await sleep(120);
    ok(M.answer === 'ok' && s4playing, 'the S-4 answered START');
    key(document.body, ' ');
    ok(!S4.state.playing, 'Space stops');
    await sleep(120);
    take();
    tap($('[data-target="btn.rec"]'));
    ok(take()[0] === hex([0x9F, 36, 127]), 'Rec taps note 36');
    tap($('[data-target="btn.rec"]'));
    take();
    // keys 1-4 and L
    key(document.body, '3');
    ok(S4.state.sel.track === 2 && $('.lv-insp').classList.contains('tc2'), 'key 3 picks track 3');
    key(document.body, 'l');
    ok(S4.listen.active && !$('#listenBar').hidden, 'L turns Learn on');
    key(document.body, 'Escape');
    ok(!S4.listen.active, 'Esc ends Learn');
  });

  await section('live scenes', async () => {
    S4.ctl.launch(1);
    take();
    $('.lv-top [data-target="scene.next"]').click();
    ok(take()[0] === hex([0xCF, 1]) && $('.scn-no').textContent === '002', 'next scene: program 1, shows 002');
    $('.lv-top [data-target="scene.prev"]').click();
    ok(take()[0] === hex([0xCF, 0]) && $('.scn-no').textContent === '001', 'previous scene');
    $('.scn-btn').click();
    ok($$('.pop .pad').length === 128 && $('.pop .pad.cur').textContent === '1', 'scene pads popover with the current one marked');
    $('.pop .pad[data-target="scene.77"]').click();
    ok(take()[0] === hex([0xCF, 76]) && $('.scn-no').textContent === '077' && $('.pop .pad.cur').textContent === '77', 'pad 77 launches program 76');
    key(document, 'Escape');
    ok(!$('.pop'), 'Esc closes the popover');
    S4.ctl.launch(1);
    take();
  });

  // ---------- Learn ----------
  await section('learn', async () => {
    const L = S4.listen;
    L.data.presets[L.data.current] = []; // start from an empty map
    L.data.opts.soft = true;
    L.data.opts.playNotes = false;
    L.data.opts.pc = true;
    const pan = $('[data-target="mix.pan.0"]');
    S4.ctl.set('mix.pan.0', 64);
    ctxmenu(pan);
    ok(menuItems()[0].startsWith('Learn from controller'), 'right-click offers Learn from controller', menuItems());
    pick('Learn from controller');
    ok(L.active && L.once && L.target === 'mix.pan.0' && $('#listenBar').textContent.includes('MIX PAN'), 'learning the pan knob');
    for (const v of [10, 20, 30, 40, 50]) { ctlSend(0xB0, 21, v); await sleep(30); }
    await sleep(650);
    const m = L.maps.find(x => x.target === 'mix.pan.0');
    ok(m && m.src.num === 21 && m.mode === 'abs' && !L.active, 'learned CC 21 as absolute, learning ended', m);
    await sleep(60);
    ok(pan.dataset.map === 'CC21', 'the knob shows its learned control', pan.dataset.map);
    take();
    ctlSend(0xB0, 21, 127);
    ok(S4.ctl.get('mix.pan.0') === 64 && !take().length, 'Catch: a far value does not jump');
    ctlSend(0xB0, 21, 65);
    ctlSend(0xB0, 21, 100);
    ok(S4.ctl.get('mix.pan.0') === 100 && take().length === 2, 'Catch: takes over once reached, then follows');
    L.data.opts.soft = false;
    ctlSend(0xB0, 21, 0);
    ok(S4.ctl.get('mix.pan.0') === 0, 'without Catch it jumps');
    L.data.opts.soft = true;
    // invert and range
    m.inv = true; m.min = 20; m.max = 40;
    ctlSend(0xB0, 21, 0);
    ok(S4.ctl.get('mix.pan.0') === 40, 'inverted, ranged: 0 gives 40', S4.ctl.get('mix.pan.0'));
    L.pick = {};
    S4.ctl.set('mix.pan.0', 30);
    ctlSend(0xB0, 21, 127);
    ok(S4.ctl.get('mix.pan.0') === 30 || S4.ctl.get('mix.pan.0') === 20, 'inverted, ranged: 127 gives 20 (or waits for Catch)', S4.ctl.get('mix.pan.0'));
    m.inv = false; m.min = 0; m.max = 127;
    // a relative encoder
    L.learnOne('mix.fltr.1');
    for (let k = 0; k < 6; k++) { ctlSend(0xB0, 22, 1); await sleep(20); }
    await sleep(650);
    const r = L.maps.find(x => x.target === 'mix.fltr.1');
    ok(r && r.mode === 'rel1', 'endless encoder detected as Relative 1', r);
    S4.ctl.set('mix.fltr.1', 64);
    ctlSend(0xB0, 22, 1); ctlSend(0xB0, 22, 1); ctlSend(0xB0, 22, 127);
    ok(S4.ctl.get('mix.fltr.1') === 65, 'relative: +1 +1 -1', S4.ctl.get('mix.fltr.1'));
    L.learnOne('mix.lvl.2');
    for (let k = 0; k < 6; k++) { ctlSend(0xB0, 23, 65); await sleep(20); }
    await sleep(650);
    ok((L.maps.find(x => x.target === 'mix.lvl.2') || {}).mode === 'rel2', 'offset encoder detected as Relative 2');
    // a pad on a button: toggle, then hold
    L.learnOne('btn.mute.3');
    ctlSend(0x90, 60, 100);
    const b = L.maps.find(x => x.target === 'btn.mute.3');
    ok(b && b.src.type === 'note' && !L.active, 'a pad learned for mute');
    take();
    ctlSend(0x90, 60, 100); ctlSend(0x80, 60, 0);
    ok(S4.state.tracks[3].mute && take()[0] === hex([0x9F, 28, 127]), 'toggle: press mutes');
    ctlSend(0x90, 60, 100); ctlSend(0x80, 60, 0);
    ok(!S4.state.tracks[3].mute, 'toggle: press again unmutes');
    b.btn = 'gate';
    ctlSend(0x90, 60, 100);
    ok(S4.state.tracks[3].mute, 'hold: muted while held');
    ctlSend(0x80, 60, 0);
    ok(!S4.state.tracks[3].mute, 'hold: released');
    take();
    // many in a row
    L.toggle(true);
    const lv = $('[data-target="mix.lvl.3"]');
    lv.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
    await sleep(20);
    ok(L.target === 'mix.lvl.3' && lv.classList.contains('learn-sel'), 'click picks the control while learning');
    ctlSend(0x90, 61, 90);
    ok(L.active && L.maps.some(x => x.target === 'mix.lvl.3'), 'learned and still learning');
    const sc = $('.lv-top [data-target="scene.next"]');
    sc.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
    take();
    sc.click();
    ok(!take().length && S4.state.scene === 1, 'a click while learning does not act');
    key(document, 'Escape');
    ok(!L.active, 'Esc ends learning');
    // forget
    ctxmenu(pan);
    ok(menuItems().some(x => x.startsWith('Forget CC 21')), 'right-click offers Forget', menuItems());
    pick('Forget');
    ok(!L.maps.some(x => x.target === 'mix.pan.0'), 'forgotten');
    // program changes and unlearned notes
    take();
    ctlSend(0xC0, 4);
    ok(take()[0] === hex([0xCF, 4]) && S4.state.scene === 5, 'program change from the controller picks scene 5');
    L.data.opts.playNotes = true;
    S4.ctl.select(1);
    ctlSend(0x90, 72, 99);
    ok(take()[0] === hex([0x91, 72, 99]), 'an unlearned key plays the picked track');
    L.data.opts.playNotes = false;
    S4.ctl.launch(1);
    take();
  });

  await section('control maps', async () => {
    const L = S4.listen;
    L.openPanel();
    ok($('.modal-head .lbl').textContent === 'Control maps', 'panel title');
    ok($$('.map-row').length === L.maps.length, 'a row per learned control', [$$('.map-row').length, L.maps.length]);
    const enc = $$('.map-row').find(r => r.querySelector('.btn.mode'));
    if (enc) {
      enc.querySelector('.btn.mode').click();
      ok(menuItems().length === 4, 'four encoder types');
      pick('Relative 3');
    }
    ok(L.maps.some(m => m.mode === 'rel3'), 'encoder type changed');
    const inv = $('.map-row .btn.inv');
    inv.click();
    ok(inv.classList.contains('on'), 'invert toggles');
    ok($$('.map-opt').length === 3 && $$('.map-opt .mo-title').map(x => x.textContent).join() === 'Catch,Play notes on the S-4,Scenes from program changes', 'three options');
    $('.modal-head .ib').click();
    // maps: new, copy, rename, delete, save, load
    const n0 = Object.keys(L.data.presets).length, cur = L.data.current;
    promptAnswer = 'Test map';
    L.presetMenu($('#hdr'));
    pick('New map');
    ok(L.data.current === 'Test map' && L.maps.length === 0, 'new empty map');
    promptAnswer = 'Copy test';
    L.data.current = cur;
    L.presetMenu($('#hdr')); pick('Copy this map');
    ok(L.data.current === 'Copy test' && L.maps.length === L.data.presets[cur].length, 'copied map');
    promptAnswer = 'Renamed test';
    L.presetMenu($('#hdr')); pick('Rename');
    ok(L.data.current === 'Renamed test' && !L.data.presets['Copy test'], 'renamed');
    L.presetMenu($('#hdr')); pick('Delete');
    ok(!L.data.presets['Renamed test'], 'deleted');
    L.data.current = 'Test map';
    L.presetMenu($('#hdr')); pick('Delete');
    L.data.current = cur;
    ok(Object.keys(L.data.presets).length === n0, 'back to the maps there were');
    L.presetMenu($('#hdr')); pick('Save maps to a file');
    const d = downloads.pop();
    const j = d && JSON.parse(await d.blob.text());
    ok(d && d.name === 's4tools-control-maps.json' && j.presets && j.presets[cur], 'maps saved to a file');
    pickQueue.push([new File([JSON.stringify({ presets: { Loaded: [] } })], 'm.json')]);
    L.presetMenu($('#hdr')); pick('Load maps');
    await sleep(50);
    ok(!!L.data.presets.Loaded, 'maps loaded from a file');
    delete L.data.presets.Loaded;
    L.data.current = cur;
    S4.store.set('mappings', L.data);
    S4.emit('mappings');
    ok($('#hdr .count').textContent === String(L.maps.length || ''), 'header count follows the map');
  });

  // ---------- recorder (a generated signal as the S-4's input) ----------
  await section('recorder', async () => {
    const R = S4.rec;
    if (typeof MediaStreamTrackGenerator !== 'function') { T.notes.recorder = 'no MediaStreamTrackGenerator: skipped'; return; }
    let amp = 0, gen = null, timer = null, tsu = 0;
    navigator.mediaDevices.enumerateDevices = async () => [{ kind: 'audioinput', deviceId: 'fake-in', label: 'Source/Sink (fake)', groupId: '' },
      { kind: 'audiooutput', deviceId: 'fake-out', label: 'Speakers (fake)', groupId: '' }];
    navigator.mediaDevices.getUserMedia = async () => {
      gen = new MediaStreamTrackGenerator({ kind: 'audio' });
      const w = gen.writable.getWriter();
      // 10 ms blocks, as many as the clock says are due (a throttled page fires its timers late)
      const start = performance.now();
      let written = 0;
      timer = setInterval(() => {
        const n = 480, due = Math.floor(((performance.now() - start) * 48) / n);
        for (; written < due; written++) {
          const d = new Float32Array(n * 2);
          for (let i = 0; i < n; i++) d[i] = d[n + i] = amp * Math.sin(i / 7);
          w.write(new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: tsu, data: d })).catch(() => {});
          tsu += 10000;
        }
      }, 10);
      return new MediaStream([gen]);
    };
    Object.assign(R.settings, { mode: 'thresh', thresh: -30, target: 'pc', hold: 0.3, click: 'visual', bars: 1, takeBars: 1 });
    S4.emit('rec');
    ok(await R.start(), 'input starts');
    ok(R.on && R.device.includes('Source/Sink'), 'listening to the S-4 input', R.device);
    await sleep(300);
    // record to PC by hand
    amp = 0.5;
    await R.toggleRec();
    ok($('.rec-pc').classList.contains('recording') && $('.rec-pc').textContent === 'Stop', 'Record to PC shows Stop');
    await sleep(500);
    await R.toggleRec();
    let d = downloads.pop();
    ok(d && /^s4 main \d{4}-\d\d-\d\d \d\d\.\d\d\.\d\d\.wav$/.test(d.name), 'a WAV with the date in its name', d && d.name);
    if (d) {
      const v = new DataView(await d.blob.arrayBuffer());
      ok(v.getUint32(0, false) === 0x52494646 && v.getUint16(22, true) === 2 && v.getUint32(24, true) === 48000 && v.getUint16(34, true) === 24, 'RIFF, stereo, 48 kHz, 24-bit');
      const secs = (d.blob.size - 44) / (48000 * 6);
      ok(secs > 0.35 && secs < 0.8, 'about half a second long', secs);
    }
    // threshold, to the PC: pre-roll, then stops after 0.3 s of quiet
    amp = 0;
    await sleep(700);
    await R.toggleArm();
    ok(R.armed && $('.rec-arm').classList.contains('armed') && $('.rec-arm').textContent === 'Armed', 'armed');
    ok($$('.rec-mode button').every(b => b.disabled), 'mode switch locked while armed');
    await sleep(200);
    amp = 0.5;
    await sleep(400);
    ok($('.rec-arm').classList.contains('recording'), 'sound started the take');
    amp = 0;
    await sleep(700);
    d = downloads.pop();
    ok(!!d, 'quiet ended the take and saved it');
    if (d) { const secs = (d.blob.size - 44) / (48000 * 6); ok(secs > 1.0 && secs < 1.6, 'pre-roll + sound + quiet ≈ 1.2 s', secs); }
    // threshold, into T2 on the S-4: starts the S-4, REC on the threshold and again on quiet
    R.settings.target = 't1';
    S4.emit('rec');
    ok($('.rec-mon .tb') && $('.rec-mon .tb').dataset.target === 'btn.mon.1', 'MON button for T2');
    s4playing = false; S4.state.playing = false;
    take();
    await R.toggleArm();
    ok(take()[0] === hex([0x9F, 24, 127]) && S4.state.playing, 'arming starts the S-4');
    await sleep(150);
    amp = 0.5;
    await sleep(150);
    const recOn = take();
    ok(recOn[0] === hex([0x9F, 38, 127]), 'sound sends REC on T2', recOn);
    amp = 0;
    await sleep(700);
    ok(take().some(x => x === hex([0x9F, 38, 127])), 'quiet sends REC again');
    tap($('[data-target="btn.play"]'));
    await sleep(100);
    take();
    // pre-click, then a one-bar take on the PC
    Object.assign(R.settings, { mode: 'count', target: 'pc', takeBars: 1, bars: 1, click: 'visual' });
    S4.cr.proj.bpm = 240;
    S4.emit('rec');
    ok($('.rec-count').textContent.startsWith('1 bar · no click'), 'pre-click button', $('.rec-count').textContent);
    s4playing = false; S4.state.playing = false;
    const t0 = performance.now();
    await R.toggleCount();
    await sleep(500);
    ok(/^[1-4]$/.test($('.rec-arm').textContent), 'counting down', $('.rec-arm').textContent);
    await sleep(900);
    const st = sent.find(x => x.a[0] === 0x9F && x.a[1] === 24);
    const down = t0 + 300 + 4 * 250;
    ok(st && Math.abs(st.ts - down) < 40, 'START timestamped for the downbeat', st && [st.ts - t0, down - t0]);
    await sleep(1400);
    d = downloads.pop();
    ok(!!d, 'the one-bar take saved itself');
    if (d) { const secs = (d.blob.size - 44) / (48000 * 6); ok(secs > 0.95 && secs < 1.3, 'one bar at 240 bpm ≈ 1 s', secs); }
    tap($('[data-target="btn.play"]'));
    await sleep(100);
    take();
    // pre-click into MAIN: REC timestamped just after START; cancel works
    R.settings.target = 'main';
    s4playing = false; S4.state.playing = false;
    await R.toggleCount();
    await sleep(200);
    await R.toggleCount();
    ok(!/^[1-4]$/.test($('.rec-arm').textContent) && !take().length, 'cancelled pre-click sends nothing');
    R.settings.takeBars = 0;
    const t1 = performance.now();
    await R.toggleCount();
    await sleep(1500);
    const s = sent.map(x => ({ h: hex(x.a), dt: x.ts - t1 }));
    const start = s.find(x => x.h === hex([0x9F, 24, 127])), rec = s.find(x => x.h === hex([0x9F, 36, 127]));
    ok(start && rec && rec.dt - start.dt > 1 && rec.dt - start.dt < 10, 'MAIN REC 2 ms after START', s.slice(0, 4));
    await R.toggleCount();
    ok(take().some(x => x === hex([0x9F, 36, 127])), 'Stop take sends REC');
    tap($('[data-target="btn.play"]'));
    await sleep(100);
    take();
    // on a busy S-4 the pre-click refuses
    S4.state.playing = true;
    await R.toggleCount();
    ok(!$('.rec-arm').classList.contains('armed') && $('#toast').textContent.startsWith('Stop the S-4 first'), 'pre-click refuses while playing');
    S4.state.playing = false;
    R.stop();
    clearInterval(timer);
    ok(!R.on && $('.rec-status').textContent.startsWith('Not listening'), 'input off');
    Object.assign(R.settings, { mode: 'thresh', target: 'pc', takeBars: 0, hold: 2 });
    S4.emit('rec');
  });

  // ---------- Build ----------
  const zipBlob = await (await fetch('/tools/uploads/S4T_VERIFY5.zip', { cache: 'no-store' })).blob();
  await section('build import', async () => {
    view('build');
    ok(!$('#view-build').hidden && !$('#subbar').hidden && $('#view-live').hidden, 'build view shown');
    const entries = S4.s4p.entriesFromZip(await S4.zip.read(new File([zipBlob], 'v5.zip')));
    const r = await S4.build.importEntries(entries, { noConfirm: true, quiet: true });
    ok(r && !r.missing.length, 'VERIFY5 imported with every sample', r && r.missing);
    ok($$('.bd-pads .pad.used').length === r.proj.scenes.filter(Boolean).length, 'a used pad per scene');
    ok($('.proj-name').value === r.proj.name, 'name in the toolbar');
    // the export is the original, field for field
    const b = await S4.s4p.build(S4.cr.proj);
    const orig = JSON.parse(new TextDecoder().decode((await S4.zip.read(new File([zipBlob], 'v5.zip'))).get([...(await S4.zip.read(new File([zipBlob], 'v5.zip'))).keys()].find(k => /project\.json$/.test(k)))));
    const mine = JSON.parse(b.files.find(f => /project\.json$/.test(f.name)).data);
    ok(JSON.stringify(orig) === JSON.stringify(mine), 'export round trip: identical project.json');
  });

  await section('build lanes and inspector', async () => {
    const P = S4.cr.proj;
    const used = P.scenes.map((s, i) => [s, i]).filter(([s]) => s);
    for (const [sc, i] of used) {
      $$('.bd-pads .pad')[i].click();
      ok(S4.cr.sel.scene === i && $$('.bd-pads .pad')[i].classList.contains('cur'), `pad ${i + 1} selects the scene`);
      for (let t = 0; t < 4; t++) {
        const lane = $$('.blane')[t], tr = sc.tracks[t];
        ok(lane.querySelector('.mat').textContent.startsWith(tr.device), `scene ${i + 1} T${t + 1} shows ${tr.device}`);
        press(lane);
        ok(S4.cr.sel.track === t && lane.classList.contains('sel'), 'clicking a lane selects the track');
        for (const tab of ['sample', 'fx', 'sends', 'mods']) {
          $(`.itab[data-tab="${tab}"]`).click();
          ok($(`.itab[data-tab="${tab}"]`).classList.contains('on'), `${tab} tab opens`);
          if (tab === 'fx') ok($$('.bd-insp .kgrid .knob').length > 0, `scene ${i + 1} T${t + 1} effect knobs`);
          if (tab === 'sends') ok($$('.bd-insp .kgrid .knob').length === 4, 'four send knobs');
          if (tab === 'mods') ok($$('.bd-insp .mod-ed .kgrid .knob').length === 8, 'eight modulator knobs');
          if (tab === 'sample' && tr.device !== 'BYPASS') ok($$('.bd-insp .kgrid .knob').length >= 4, `scene ${i + 1} T${t + 1} ${tr.device} knobs`);
        }
      }
    }
    $$('.bd-pads .pad')[used[0][1]].click();
    $('.itab[data-tab="sample"]').click();
  });

  await section('build materials and tempo', async () => {
    const lane = () => $$('.blane')[0];
    press(lane());
    const tr = S4.cr.proj.scenes[S4.cr.sel.scene].tracks[0];
    const dev0 = tr.device;
    for (const d of ['TAPE', 'POLY', 'BYPASS', 'DISC']) {
      lane().querySelector('.mat').click();
      pick(d);
      ok(tr.device === d && lane().querySelector('.mat').textContent.startsWith(d), `material ${d}`);
      if (d === 'BYPASS') ok($('.bd-insp .note').textContent.startsWith('BYPASS plays'), 'BYPASS explains itself');
      if (d === 'POLY') ok(!$$('.bd-insp .seg').some(s => s.textContent.includes('Sync')), 'POLY has no tempo modes');
    }
    lane().querySelector('.mat').click(); pick(dev0);
    if (tr.sample && tr.sample.bpm) {
      const segs = () => $$('.bd-insp .seg').find(s => s.textContent.includes('Stretch'));
      [...segs().children].find(b => b.textContent === 'Stretch').click();
      ok(tr.tempo === 'stretch' && $$('.bd-insp .keyrow').some(k => k.textContent.startsWith('Warp')), 'Stretch shows Warp');
      $$('.bd-insp .keyrow').find(k => k.textContent.startsWith('Warp')).querySelectorAll('button')[1].click();
      ok(tr.warp === S4.warp.MODES[1], 'warp mode set', tr.warp);
      [...segs().children].find(b => b.textContent === 'As recorded').click();
      ok(tr.tempo === 'recorded', 'As recorded');
      [...segs().children].find(b => b.textContent.startsWith('Sync')).click();
      ok(tr.tempo === 'sync', 'Sync');
      const bpm = tr.sample.bpm;
      lane().querySelector('.tag-btn').click();
      pick('Double');
      ok(Math.abs(tr.sample.bpm - bpm * 2) < 0.11, 'tempo doubled', [bpm, tr.sample.bpm]);
      lane().querySelector('.tag-btn').click();
      pick('Halve');
      ok(Math.abs(tr.sample.bpm - bpm) < 0.11, 'tempo halved back');
      // project key: loops with a key move into it
      tr.sample.key = 'A'; tr.sample.keySrc = 'user';
      S4.build.show(true);
      $$('#subbar .btn').find(b => b.textContent.includes('None')).click();
      pick('C');
      ok(S4.cr.proj.key === 'C' && tr.tempo === 'stretch', 'a key on the project switches the track to Stretch', [S4.cr.proj.key, tr.tempo]);
      ok(lane().textContent.includes('A→C'), 'the key tag shows the move', lane().querySelector('.bl-info').textContent);
      $$('#subbar .btn').find(b => b.textContent.startsWith('C')).click();
      pick('None');
      tr.tempo = 'sync';
    }
    // material switches
    const sw = $$('.bd-insp .sw-row .tb');
    if (sw.length) { const was = sw[0].classList.contains('on'); sw[0].click(); ok(sw[0].classList.contains('on') !== was && tr.ex && tr.ex.mat, 'material switch stored'); sw[0].click(); }
    // knobs write the project
    const k = $('.bd-insp .kgrid .knob');
    const before = JSON.stringify(tr);
    key(k, 'ArrowUp');
    ok(JSON.stringify(tr) !== before, 'a sample knob changes the track');
    $$('.bd-insp .ihead .btn').find(b => b.textContent === 'Reset').click();
  });

  await section('build effects, sends, mods', async () => {
    const tr = S4.cr.proj.scenes[S4.cr.sel.scene].tracks[S4.cr.sel.track];
    $('.itab[data-tab="fx"]').click();
    for (const dev of ['MOSAIC', 'RING', 'DEFORM', 'VAST']) {
      $$('.bd-insp .seg.wide button').find(b => b.textContent === dev).click();
      ok($$('.bd-insp .ihead .lbl.bright')[1].textContent.endsWith(dev), `${dev} shown`);
      const onoff = $('.bd-insp .fx-onoff');
      [...onoff.children].find(b => b.textContent === 'Bypass').click();
      ok(tr.fx && tr.fx[dev] && tr.fx[dev].on === false, `${dev} bypassed`);
      key($('.bd-insp .kgrid .knob'), 'ArrowUp');
      ok(tr.fx[dev].on === true && $('.bd-insp .fx-onoff button.on').textContent === 'On', `a ${dev} knob switches it on`);
      $$('.bd-insp .ihead .btn').find(b => b.textContent === 'Reset').click();
    }
    const chip = $('.bd-insp .kgrid .gridsel');
    if (chip) { chip.click(); ok(menuItems().length > 1, 'a mode chip offers modes'); S4.closeMenu(); }
    ok($('.itab[data-tab="fx"]').classList.contains('lit'), 'Effects tab lit');
    $('.itab[data-tab="sends"]').click();
    const sk = $$('.bd-insp .kgrid .knob');
    key(sk[1], 'End');
    const blk = S4.s4p.peek(tr, 'track_output');
    ok(blk && blk.track_output && blk.track_output.send2.value > -100, 'send to T2 stored', blk);
    ok($('.itab[data-tab="sends"]').classList.contains('lit'), 'Sends tab lit');
    $$('.bd-insp .ihead .btn').find(b => b.textContent === 'Reset').click();
    $('.itab[data-tab="mods"]').click();
    $$('.bd-insp .mod-slots button')[2].click();
    ok($('.bd-insp .mod-slots button.on').textContent === 'MOD 3', 'MOD 3 picked');
    $$('.bd-insp .mod-top .seg button').find(b => b.textContent === 'FOLLOW').click();
    ok($$('.bd-insp .kgrid .knob .k-label').map(x => x.textContent).includes('RISE'), 'FOLLOW knobs');
    $$('.bd-insp .mod-rh .btn')[0].click();
    const items = menuItems();
    ok(items.length > 10, 'targets listed', items.length);
    $$('.menu .menu-item')[0].click();
    ok($$('.bd-insp .mod-route').length === 1 && $('.itab[data-tab="mods"]').classList.contains('lit'), 'a routing added');
    $('.bd-insp .mod-route .ib').click();
    ok($$('.bd-insp .mod-route').length === 0, 'routing removed');
    $('.itab[data-tab="sample"]').click();
  });

  await section('build editor, audition, preview', async () => {
    const i = S4.cr.sel.track, tr = S4.cr.proj.scenes[S4.cr.sel.scene].tracks[i];
    if (!tr.sample) { T.notes.editor = 'no sample on the selected track'; return; }
    await sleep(300);
    const wave = $('.bd-insp .ed-wave'), mk = $('.bd-insp .mk-in'), r = wave.getBoundingClientRect();
    mk.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: r.left, clientY: r.top + 5 }));
    mk.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: r.left + r.width * 0.25, clientY: r.top + 5 }));
    mk.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: r.left + r.width * 0.25, clientY: r.top + 5 }));
    ok(Math.abs(tr.trimIn - 0.25) < 0.02, 'IN marker trims', tr.trimIn);
    tr.trimIn = 0;
    const fades = $$('.bd-insp .ed-row .knob');
    key(fades[0], 'ArrowUp');
    ok(tr.fadeIn === 5, 'fade in knob', tr.fadeIn);
    tr.fadeIn = 0;
    $('.bd-insp .hear').click();
    await sleep(200);
    ok(S4.audio.hearing === i && $('.bd-insp .hear').textContent === 'Stop', 'Audition plays the track');
    $('.bd-insp .hear').click();
    await sleep(50);
    ok(S4.audio.hearing < 0, 'Audition stops');
    $('.bd-insp .ed .ihead .ib').click();
    ok($('.bd-lanes').classList.contains('expand') && $('.big-ed'), 'editor opens big');
    $$('.big-ed .seg button')[(i + 1) % 4].click();
    ok(S4.cr.sel.track === (i + 1) % 4 && $('.big-ed').classList.contains('tc' + ((i + 1) % 4)), 'track switch inside the big editor');
    $('.big-ed .ihead .ib').click();
    ok(!$('.big-ed') && $$('.blane').length === 4, 'back to the lanes');
    // preview: play, queue another scene, stop
    const used = S4.cr.proj.scenes.map((s, k) => (s ? k : -1)).filter(k => k >= 0);
    S4.build.togglePlay();
    await sleep(400);
    ok(S4.audio.playing && $('#subbar .btn.on.icon-only'), 'preview plays');
    if (used.length > 1) {
      $$('.bd-pads .pad')[used[1]].click();
      ok(S4.audio.pending && S4.audio.pending.idx === used[1], 'another pad queues while playing');
    }
    key(document.body, ' ');
    ok(!S4.audio.playing, 'Space stops the preview');
  });

  await section('build mixer and scenes', async () => {
    const mx = S4.cr.proj.mix.tracks;
    const lane = $$('.blane')[2];
    key(lane.querySelectorAll('.bl-mix .knob')[0], 'ArrowDown');
    ok(mx[2].lvl < 0, 'LVL knob in dB', mx[2].lvl);
    key(lane.querySelectorAll('.bl-mix .knob')[1], 'ArrowUp');
    ok(mx[2].pan === 1, 'PAN knob');
    mx[2].lvl = 0; mx[2].pan = 0;
    lane.querySelector('.lane-btns .tb').click();
    ok(mx[2].mute && $$('.blane')[2].classList.contains('muted'), 'M mutes');
    $$('.blane')[2].querySelector('.lane-btns .tb').click();
    $$('.blane')[1].querySelectorAll('.lane-btns .tb')[1].click();
    ok(mx[1].solo && $$('.blane')[0].classList.contains('muted'), 'S solos (the others look muted)');
    $$('.blane')[1].querySelectorAll('.lane-btns .tb')[1].click();
    // scene operations
    const P = S4.cr.proj, from = S4.cr.sel.scene;
    const usedN = () => P.scenes.filter(sc => sc && sc.tracks.some(t => t.sample || t.libRef)).length, n0 = usedN();
    $$('.pads-head .btn').find(b => b.textContent === 'Copy').click();
    ok(usedN() === n0 + 1 && S4.cr.sel.scene !== from, 'Copy makes a new scene and goes there');
    const copy = S4.cr.sel.scene;
    promptAnswer = 'COPYTEST';
    $$('.bd-pads .pad')[copy].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    ok(P.scenes[copy].name === 'COPYTEST' && $$('.bd-pads .pad')[copy].title.includes('COPYTEST'), 'double-click renames');
    ctxmenu($$('.bd-pads .pad')[copy]);
    ok(menuItems().join('|').includes('Chain') && menuItems().join('|').includes('Lock'), 'pad menu', menuItems());
    pick('Chain');
    ok(!!$$('.bd-pads .pad')[copy].querySelector('.marks'), 'chain mark');
    ctxmenu($$('.bd-pads .pad')[copy]); pick('Chain');
    $$('.pads-head .btn').find(b => b.textContent === 'Clear').click();
    ok(usedN() === n0 && !P.scenes[copy].name && !$$('.bd-pads .pad')[copy].classList.contains('used'), 'Clear empties it');
    $$('.pads-head .btn').find(b => b.textContent.includes('New')).click();
    ok(!P.scenes[S4.cr.sel.scene] || !P.scenes[S4.cr.sel.scene].tracks.some(t => t.sample), 'New goes to an empty scene');
    $$('.bd-pads .pad')[from].click();
    // fold
    const pads = $('.bd-pads'), was = pads.classList.contains('short');
    $('.pads-head .ib:last-child').click();
    ok(pads.classList.contains('short') !== was && S4.store.get('build.padsShort') === !was, 'pads fold and remember');
    const visible = $$('.bd-pads .pad').filter(p => getComputedStyle(p).display !== 'none').length;
    ok(visible === (was ? 128 : 16), 'folded shows one row, unfolded all', [was, visible]);
    $('.pads-head .ib:last-child').click();
  });

  await section('build library', async () => {
    const idx = await (await fetch('/ext/index.json')).json();
    if (!idx.length) { T.notes.library = 'no test material served'; return; }
    if ($('.bd').classList.contains('lib-off')) $('.lib-toggle').click();
    const files = [];
    for (const p of idx.slice(0, 5)) files.push(new File([await (await fetch('/ext/' + p)).blob()], p.split('/')[1], { type: 'audio/wav' }));
    pickQueue.push(files);
    $$('.lib-head .btn')[0].click();
    await sleep(100);
    ok($$('.lib-item').length === 5 && $('.lib-count').textContent.includes('5 files'), 'folder in the Library', $('.lib-count') && $('.lib-count').textContent);
    const q = $('.lib-search input');
    q.value = files[2].name.slice(0, 7); q.dispatchEvent(new Event('input'));
    ok($$('.lib-item').length >= 1 && $$('.lib-item').length < 5, 'search narrows', $$('.lib-item').length);
    q.value = ''; q.dispatchEvent(new Event('input'));
    $$('.lib-item')[0].click();
    await sleep(400);
    ok($$('.lib-item')[0].classList.contains('playing'), 'click listens');
    ok(!!$$('.lib-item')[0].querySelector('.lib-dur'), 'its length shows');
    $$('.lib-item')[0].click();
    ok(!$('.lib-item.playing'), 'click again stops');
    $$('.lib-item')[1].click();
    key(document, 'Escape');
    ok(!$('.lib-item.playing'), 'Esc stops');
    const target = S4.cr.proj.scenes.findIndex(s => !s);
    $$('.bd-pads .pad')[target].click();
    $$('.lib-item')[1].querySelectorAll('.lib-to button')[2].click();
    await sleep(1200);
    ok((S4.cr.proj.scenes[target].tracks[2].sample || {}).file === files[1].name, 'the 3 button loads into T3');
    const dt = new DataTransfer();
    dt.setData('application/x-s4tools-sample', '3');
    $$('.blane')[0].dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    await sleep(1200);
    ok((S4.cr.proj.scenes[target].tracks[0].sample || {}).file === files[3].name, 'dragging onto T1 loads it');
    ok($$('.bd-pads .pad')[target].classList.contains('used'), 'the pad shows the scene in use');
    // several files dropped on a lane: the first loads, the rest go to the Library
    const dt2 = new DataTransfer();
    files.slice(0, 3).forEach(f => dt2.items.add(f));
    $$('.blane')[3].dispatchEvent(new DragEvent('drop', { dataTransfer: dt2, bubbles: true, cancelable: true }));
    await sleep(1500);
    ok((S4.cr.proj.scenes[target].tracks[3].sample || {}).file === files[0].name && $$('.lib-item').length === 3, 'drop of three: one loads, the Library holds them');
    $('.lib-toggle').click();
    ok($('.bd').classList.contains('lib-off') && S4.store.get('build.libOff') === true, 'Library folds away');
    $('.lib-toggle').click();
    // take the sample off a track
    $$('.blane')[3].querySelector('.bl-info .ib').click();
    ok(!S4.cr.proj.scenes[target].tracks[3].sample, '× takes the sample off');
    $$('.pads-head .btn').find(b => b.textContent === 'Clear').click();
  });

  await section('build dialogs and menus', async () => {
    $$('#subbar .btn')[0].click();
    const items = menuItems();
    ['New project', 'Project settings…', 'Perform: macros and modulators…', 'Mix modulators…', 'Import an S-4 project folder…', 'Import a project zip…',
      'Export as a zip for the S-4…', 'Back up for s4tools…', 'Clear out unused samples'].forEach(x => ok(items.some(y => y.startsWith(x)), 'Project menu: ' + x, items));
    pick('Project settings');
    ok($('.modal-head .lbl').textContent === 'Project settings' && $$('.modal .set-row').length > 20, 'Project settings open');
    $$('.modal .seg')[0].children[1].click();
    ok(S4.s4p.peekSettings(S4.cr.proj).audio_settings.input_source === 1, 'INPUT set to MIC');
    $$('.modal .seg')[0].children[0].click();
    key(document, 'Escape');
    ok(!$('.modal-back'), 'Esc closes the dialog');
    $$('#subbar .btn')[0].click(); pick('Perform');
    ok($('.modal-head .lbl').textContent === 'Perform' && $$('.modal .perf-dest').length === 5, 'Perform opens with four tracks and the mix');
    $$('.modal .seg.mini')[0].children[9].click();
    ok($('.modal .set-row .lbl').textContent.includes('action'), 'macro 10 is an action');
    key(document, 'Escape');
    $$('#subbar .btn')[0].click(); pick('Mix modulators');
    ok($('.modal-head .lbl').textContent === 'Mix modulators' && $$('.modal .knob').length === 8, 'Mix modulators open');
    key(document, 'Escape');
    $('.pads-head .ib[title^="Scene changes"]').click();
    ok($('.modal-head .lbl').textContent === 'Scene changes', 'Scene changes open');
    const rule = $$('.modal .seg')[0];
    rule.children[3].click();
    ok(S4.s4p.peekGlobal(S4.cr.proj).scene.scene.rule.value === 3, 'RULE RANDOM stored');
    rule.children[0].click();
    key(document, 'Escape');
    $$('#subbar .btn').find(b => b.classList.contains('hw')).click();
    ok(menuItems().some(x => x.startsWith('Play on the S-4')) && menuItems().some(x => x.startsWith('Beep on T1')), 'Play on S-4 menu', menuItems());
    S4.closeMenu();
    // bpm
    const b0 = S4.cr.proj.bpm;
    $('#subbar .bpm .ib').click();
    ok(S4.cr.proj.bpm === b0 - 1 && $('.bpm-val').textContent === String(b0 - 1), 'tempo −1');
    $$('#subbar .bpm .ib')[1].click();
    promptAnswer = '133';
    $('.bpm-val').click();
    ok(S4.cr.proj.bpm === 133, 'tempo typed');
    promptAnswer = String(b0);
    $('.bpm-val').click();
    $('.proj-name').value = 'SELFTEST'; $('.proj-name').dispatchEvent(new Event('input'));
    ok(S4.cr.proj.name === 'SELFTEST', 'name typed');
    // Loop
    const lp = $$('#subbar .btn').find(b => b.textContent === 'Loop'), l0 = S4.cr.proj.loop;
    lp.click();
    ok(S4.cr.proj.loop === !l0 && lp.classList.contains('on') === !l0, 'Loop toggles');
    lp.click();
  });

  await section('build export and backup', async () => {
    $$('#subbar .btn')[0].click(); pick('Export as a zip');
    for (let k = 0; k < 60 && !downloads.length; k++) await sleep(100);
    const d = downloads.pop();
    ok(d && /\.s4project\.zip$/.test(d.name), 'zip for the S-4', d && d.name);
    if (d) {
      const z = await S4.zip.read(new File([d.blob], d.name));
      const names = [...z.keys()];
      ok(names.some(n => /\.s4project\/project\.json$/.test(n)) && names.filter(n => /\.wav$/.test(n)).length > 0, 'project.json and WAVs inside', names.length);
    }
    ok($('.modal-head .lbl') && $('.modal-head .lbl').textContent === 'Ready for the S-4', 'export report');
    key(document, 'Escape');
    $$('#subbar .btn')[0].click(); pick('Back up');
    for (let k = 0; k < 100 && !downloads.length; k++) await sleep(100);
    const bk = downloads.pop();
    ok(bk && /\.zip$/.test(bk.name), 'backup zip', bk && bk.name);
    if (bk) {
      const used = S4.cr.proj.scenes.filter(Boolean).length, name = S4.cr.proj.name;
      pickQueue.push([new File([bk.blob], bk.name)]);
      $$('#subbar .btn')[0].click(); pick('Import a project zip');
      for (let k = 0; k < 100 && S4.cr.proj.name !== name; k++) await sleep(100);
      await sleep(300);
      ok(S4.cr.proj.name === name && S4.cr.proj.scenes.filter(Boolean).length === used, 'backup imports back', [S4.cr.proj.name, S4.cr.proj.scenes.filter(Boolean).length, used]);
    }
  });

  await section('follow the project', async () => {
    const entries = S4.s4p.entriesFromZip(await S4.zip.read(new File([zipBlob], 'v5.zip')));
    await S4.build.importEntries(entries, { noConfirm: true, quiet: true });
    view('live');
    S4.follow.settings.on = true;
    const used = S4.cr.proj.scenes.map((s, k) => (s ? k : -1)).filter(k => k >= 0);
    // make the second scene's MOSAIC on T1 differ for sure
    const mos = S4.params.DEV.MOSAIC, t1 = S4.cr.proj.scenes[used[1]].tracks[0];
    t1.fx = t1.fx || {};
    t1.fx.MOSAIC = { on: true, n: S4.params.defaults(mos.params) };
    const sp = mos.params.find(x => !x.modes) || mos.params[0], m0 = S4.params.inMode(sp, '');
    t1.fx.MOSAIC.n[sp.key] = m0.curve.to(S4.params.cc(m0, m0.def) > 64 ? 0 : 127);
    const snap = () => JSON.stringify(S4.state.tracks.map(t => [t.devices, t.vals, t.mods, t.modTypes]));
    take();
    S4.ctl.launch(used[0] + 1);
    const a = snap();
    S4.ctl.launch(used[1] + 1);
    const b = snap();
    ok(a !== b, 'picking another scene changes the knobs');
    S4.ctl.launch(used[0] + 1);
    ok(snap() === a, 'and back');
    const out = take();
    ok(out.length === 3 && out.every(x => x.startsWith('cf')), 'follow sends nothing but the program changes', out.slice(0, 5));
    // the material's SPEED and TEMPO follow too (curves from S4T CAL4)
    const lin = S4.params.curves.lin, sc0 = S4.cr.proj.scenes[used[0]], tr0 = sc0.tracks.find(t => t.device === 'DISC' && t.sample);
    if (tr0) {
      const ti = sc0.tracks.indexOf(tr0), sv = S4.s4p.stored(S4.cr.proj, tr0), vals = S4.state.tracks[ti].vals;
      const spd = S4.ctl.spec(`p.${ti}.material.46`), tmp = S4.ctl.spec(`p.${ti}.material.47`);
      ok(vals['DISC.46'] === Math.round(spd.curve.from(sv.speed)) && vals['DISC.47'] === Math.round(tmp.curve.from(sv.tempo)), 'DISC SPEED and TEMPO follow', [vals['DISC.46'], vals['DISC.47'], sv]);
      ok(S4.ctl.exact(`p.${ti}.material.47`) === sv.tempo, 'the TEMPO knob shows the project\'s exact value', [S4.ctl.exact(`p.${ti}.material.47`), sv.tempo]);
    }
    // the mixer belongs to the project: taken on the first launch after the import, then left to Live
    const mt = S4.cr.proj.mix.tracks[0], cs0 = S4.state.tracks[0];
    ok(cs0.lvl === Math.round(S4.params.curves.rexp(-100, 6, 3).from(mt.lvl <= -95 ? -100 : mt.lvl)), 'the project mixer on the first launch', [cs0.lvl, mt.lvl]);
    cs0.lvl = 5;
    S4.ctl.launch(used[1] + 1);
    ok(cs0.lvl === 5, 'later launches leave the mixer to Live');
    S4.follow.fresh();
    S4.ctl.launch(used[0] + 1);
    ok(cs0.lvl !== 5 && snap() === a, 'after an export or an import the next launch takes it again');
    take();
    S4.follow.settings.on = false;
    S4.ctl.launch(used[1] + 1);
    ok(snap() === a, 'off: knobs stay');
    S4.follow.settings.on = true;
    S4.ctl.launch(1);
    take();
  });

  // ---------- settings and themes ----------
  await section('settings', async () => {
    S4.settings.open();
    ok($('.modal-head .lbl').textContent === 'Settings', 'Settings open');
    ok($('.set-status').textContent.includes('Talking to MIDI function'), 'status names the S-4', $('.set-status').textContent);
    ok($$('.modal .swatch').length === S4.theme.LIST.length, 'a swatch per theme');
    ok($$('.modal select').length === 3, 'two ports and the scene channel');
    const sw = $$('.modal .swatch')[3];
    sw.click();
    ok(document.documentElement.dataset.theme === 'mono' && sw.classList.contains('on') && $$('.modal .swatch.on').length === 1, 'a swatch picks its theme');
    $$('.modal .swatch')[0].click();
    ok(['light', 'dark'].includes(document.documentElement.dataset.theme) && S4.theme.get() === 'system', 'System resolves to Paper or Night');
    const tr = $$('.modal .seg').find(s => s.textContent.includes('MIDI start'));
    tr.children[1].click();
    ok(M.settings.transport === 'realtime', 'start / stop: MIDI start');
    take();
    S4.state.playing = false; s4playing = false;
    tap($('[data-target="btn.play"]'));
    ok(take()[0] === 'fa', 'START is a MIDI start now');
    await sleep(100);
    tap($('[data-target="btn.play"]'));
    ok(take()[0] === 'fc', 'and STOP');
    tr.children[0].click();
    $$('.modal .btn').find(b => b.textContent.startsWith('Send every value')).click();
    ok(sent.length > 200, 'Resend sends every value', sent.length);
    take();
    await sleep(80);
    ok($$('.mon-row').length > 0, 'MIDI monitor lists messages');
    key(document, 'Escape');
  });

  await section('themes', async () => {
    const res = {};
    for (const th of S4.theme.LIST.map(x => x.id).filter(x => x !== 'system')) {
      S4.theme.set(th);
      await sleep(250); // past the colour transitions
      const ink = tok('--ink'), bg = tok('--bg'), card = tok('--card'), mute = tok('--mute'), oa = tok('--on-accent'), ot = tok('--on-t');
      const c = {
        ink: ratio(ink, bg), mute: ratio(mute, card),
        accent: Math.min(...['--learn', '--ok', '--err', '--rec', '--warn'].map(n => ratio(oa, tok(n)))),
        onTrack: Math.min(...['--t1', '--t2', '--t3', '--t4'].map(n => ratio(ot, tok(n)))),
        trackOnCard: Math.min(...['--t1', '--t2', '--t3', '--t4'].map(n => ratio(tok(n), card))),
      };
      res[th] = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, +v.toFixed(2)]));
      ok(c.ink >= 7, `${th}: text on the page`, c.ink);
      ok(c.mute >= 3, `${th}: muted labels`, c.mute);
      ok(c.accent >= 3, `${th}: text on accent fills`, c.accent);
      ok(c.onTrack >= 2.4, `${th}: numbers on track colours`, c.onTrack);
      ok(c.trackOnCard >= 2.2, `${th}: track colours on panels`, c.trackOnCard);
      for (const v of ['live', 'build']) {
        view(v);
        const low = audit(3);
        ok(low.length === 0, `${th} ${v}: every text readable`, low.slice(0, 8));
      }
      // learning bar and a dialog
      view('live');
      S4.listen.toggle(true);
      ok(audit(3).length === 0, `${th}: learn bar readable`, audit(3).slice(0, 5));
      S4.listen.toggle(false);
      S4.settings.open();
      ok(audit(3).length === 0, `${th}: settings readable`, audit(3).slice(0, 5));
      key(document, 'Escape');
    }
    T.notes.contrast = res;
    S4.theme.set('system');
  });

  await section('knob handling', async () => {
    view('live');
    S4.ctl.select(0, 'granular');
    const k = $('.lv-insp .knob'), id = k.dataset.target, r = k.getBoundingClientRect();
    const drag = (dy, shift) => {
      k.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: r.x + 20, clientY: r.y + 30, shiftKey: !!shift }));
      k.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: r.x + 20, clientY: r.y + 30 - dy, shiftKey: !!shift }));
      k.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    };
    S4.ctl.set(id, 64);
    drag(45);
    ok(Math.abs(S4.ctl.get(id) - 96) <= 2, 'dragging up a quarter of the way', S4.ctl.get(id));
    drag(-45);
    ok(Math.abs(S4.ctl.get(id) - 64) <= 2, 'and back down', S4.ctl.get(id));
    S4.ctl.set(id, 64);
    drag(45, true);
    ok(Math.abs(S4.ctl.get(id) - 70) <= 2, 'Shift-drag is five times finer', S4.ctl.get(id));
    S4.ctl.set(id, 64);
    k.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    ok(S4.ctl.get(id) === 65, 'wheel up');
    key(k, 'ArrowUp', { shiftKey: true });
    ok(S4.ctl.get(id) === 75, 'Shift-arrow steps by ten');
    key(k, 'End'); ok(S4.ctl.get(id) === 127, 'End');
    key(k, 'Home'); ok(S4.ctl.get(id) === 0, 'Home');
    k.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    ok(S4.ctl.get(id) === S4.ctl.info(id).def, 'double-click resets');
    take();
    // typing a value (Build: the send to T1, in dB)
    view('build');
    const used = S4.cr.proj.scenes.findIndex(sc => sc && sc.tracks.some(t => t.sample));
    if (used >= 0) $$('.bd-pads .pad')[used].click();
    $('.itab[data-tab="sends"]').click();
    const kv = $('.bd-insp .kgrid .knob .k-val.k-edit');
    ok(!!kv, 'send values can be typed');
    if (kv) {
      kv.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
      const inp = $('.bd-insp .k-input');
      ok(!!inp && document.activeElement === inp, 'a field opens, focused');
      inp.value = '-6';
      key(inp, 'Enter');
      const tr = S4.cr.proj.scenes[S4.cr.sel.scene].tracks[S4.cr.sel.track];
      const v = S4.s4p.peek(tr, 'track_output').track_output.send1.value;
      ok(Math.abs(v + 6) < 0.6 && !$('.bd-insp .k-input'), 'typed -6 dB', v);
      const kv2 = $('.bd-insp .kgrid .knob .k-val.k-edit');
      kv2.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
      $('.bd-insp .k-input').value = 'nonsense';
      key($('.bd-insp .k-input'), 'Enter');
      ok(Math.abs(S4.s4p.peek(tr, 'track_output').track_output.send1.value + 6) < 0.6, 'nonsense is ignored');
      $$('.bd-insp .ihead .btn').find(b => b.textContent === 'Reset').click();
    }
    $('.itab[data-tab="sample"]').click();
  });

  await section('learn bar buttons', async () => {
    view('live');
    const L = S4.listen;
    L.learnOne('mix.pan.2');
    ctlSend(0xB0, 40, 10); ctlSend(0xB0, 40, 30); ctlSend(0xB0, 40, 50); ctlSend(0xB0, 40, 70);
    await sleep(700);
    $('#hdr .learn').click();
    ok(L.active && !$('#listenBar').hidden && $('#hdr .learn').classList.contains('on'), 'header Learn button');
    $('[data-target="mix.pan.2"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
    const bar = $('#listenBar');
    ok(bar.textContent.includes('now: CC 40'), 'the bar shows what it is learned to', bar.textContent);
    $$('#listenBar .btn').find(b => b.textContent === 'Forget').click();
    ok(!L.maps.some(m => m.target === 'mix.pan.2'), 'Forget in the bar');
    $$('#listenBar .btn').find(b => b.textContent === 'Done').click();
    ok(!L.active && bar.hidden, 'Done ends learning');
    L.learnOne('mix.pan.2');
    ok($$('#listenBar .btn').some(b => b.textContent === 'Cancel'), 'learning one control offers Cancel');
    $$('#listenBar .btn').find(b => b.textContent === 'Cancel').click();
    ok(!L.active, 'Cancel');
    view('build');
    ok(!$('#hdr .learn').offsetParent && !$('#hdr .transport').offsetParent, 'Learn and the transport are Live only');
    view('live');
  });

  await section('more Build paths', async () => {
    view('build');
    // importing an S-4 project folder (as the folder picker hands it over)
    const z = await S4.zip.read(new File([zipBlob], 'v5.zip'));
    const files = [...z.entries()].filter(([n]) => !n.endsWith('/')).map(([n, b]) => Object.assign(new File([b], n.split('/').pop()), { _rel: 'PROJECTS/' + n }));
    pickQueue.push(files);
    $$('#subbar .btn')[0].click(); pick('Import an S-4 project folder');
    for (let k = 0; k < 80 && !$('.modal-back'); k++) await sleep(100);
    ok($('.modal-head .lbl') && $('.modal-head .lbl').textContent === 'S-4 project opened', 'S-4 folder imported with a report');
    ok($$('.bd-pads .pad.used').length > 0, 'its scenes are there');
    key(document, 'Escape');
    // Play on S-4 without an S-4 audio output: a message, no crash
    $$('#subbar .btn').find(b => b.classList.contains('hw')).click();
    pick('Play on the S-4');
    await sleep(800);
    ok(!S4.hw.on && $('#toast').classList.contains('show'), 'Play on S-4 explains why it cannot start', $('#toast').textContent);
    // the pre-click click here and on an S-4 track (none there)
    const R = S4.rec;
    if (typeof MediaStreamTrackGenerator === 'function') {
      Object.assign(R.settings, { mode: 'count', target: 'pc', click: 's4' });
      S4.state.playing = false;
      await R.toggleCount();
      ok(/isn.t there/.test($('#toast').textContent), 'bypass click without the S-4 output: silent pre-click', $('#toast').textContent);
      await R.toggleCount();
      R.settings.click = 'local';
      await R.toggleCount();
      await sleep(300);
      await R.toggleCount();
      ok(!$('.rec-arm').classList.contains('armed'), 'local click pre-click started and cancelled');
      R.stop();
      Object.assign(R.settings, { mode: 'thresh', click: 'visual' });
      S4.emit('rec');
    }
    take();
    // a new project, then clearing out the samples nothing uses
    $$('#subbar .btn')[0].click(); pick('New project');
    ok(S4.cr.proj.name === 'Untitled' && !$$('.bd-pads .pad.used').length && $('.proj-name').value === 'Untitled', 'New project starts empty');
    const before = (await S4.idb.keys()).length;
    $$('#subbar .btn')[0].click(); pick('Clear out unused samples');
    for (let k = 0; k < 100 && !/^Cleared out|^No unused/.test($('#toast').textContent); k++) await sleep(100);
    ok((await S4.idb.keys()).length === 0, 'unused samples cleared', [before, (await S4.idb.keys()).length]);
    // an empty project can't be exported
    $$('#subbar .btn')[0].click(); pick('Export as a zip');
    await sleep(100);
    ok(/Nothing to export yet/.test($('#toast').textContent), 'nothing to export', $('#toast').textContent);
  });

  await section('live units', async () => {
    view('live');
    const st = S4.state, C = S4.ctl, keep = JSON.stringify(st.tracks[0]), keepSt = { exact: st.exact, exactOnly: st.exactOnly };
    ok(st.tracks.some(t => t.mat && t.mat.dev), 'following a scene keeps the material\'s modes for the units');
    // exact values: a fresh knob shows the S-4's default; once Live sent a CC, what that CC sets; after following
    // a project, the project's value while the knob is still at its CC
    st.exact = {}; st.exactOnly = false;
    ok(C.format('mix.pan.0', 64) === '0' && C.format('mix.pan.0', 65) === '+2.4', 'a fresh PAN at CC 64 shows the S-4\'s default, 0', [C.format('mix.pan.0', 64), C.format('mix.pan.0', 65)]);
    const panKnob = $('#view-live .knob[data-target="mix.pan.0"]');
    st.tracks[0].pan = 64;
    panKnob._update();
    ok(panKnob.classList.contains('exact'), 'its pointer is hollow: the S-4 has the value exactly');
    C.set('mix.pan.0', 64, { force: true });
    ok(C.format('mix.pan.0', 64) === '+0.8', 'once Live sent CC 64, it shows what that sets: +0.8', C.format('mix.pan.0', 64));
    ok(!panKnob.classList.contains('exact'), 'and its pointer is solid');
    st.tracks[0].devices.material = 'DISC'; st.tracks[0].modes = {}; delete st.tracks[0].mat;
    S4.ctl.setExact(st.tracks[0], { 'DISC.56': -6 });
    ok(C.format('p.0.material.56', 55) === '-6 dB' && C.format('p.0.material.56', 56) !== '-6 dB', 'a project\'s -6 dB shows as such at its CC', C.format('p.0.material.56', 55));
    ok(C.format('p.0.material.47', 13) === '120 BPM' && C.format('p.0.material.47', 14) !== '120 BPM', 'after a project, values it didn\'t set show their CC\'s', C.format('p.0.material.47', 14));
    // the units, on CC values
    S4.ctl.setExact(st.tracks[0], {}); S4.ctl.setExact(st, {}); S4.emit('device');
    ok(C.format('mix.lvl.0', 96) === '0 dB' && C.format('mix.lvl.0', 0) === '-INF', 'mixer level in dB', C.format('mix.lvl.0', 96));
    ok(C.format('p.0.material.47', 13) === '120 BPM' && C.format('p.0.material.56', 66) === '-0.2 dB', 'DISC TEMPO in BPM, LEVEL in dB', [C.format('p.0.material.47', 13), C.format('p.0.material.56', 66)]);
    ok(C.format('p.0.granular.63', 85) === '1/16' && /\//.test(C.format('mod.0.14', 99)), 'rates as note lengths', C.format('mod.0.14', 99));
    ok(C.parse('p.0.material.56', '0 dB') === 66 && C.parse('p.0.granular.63', '1/32') === 106 && C.parse('p.0.material.47', 'nonsense') === null, 'typed values become CCs');
    st.tracks[0].modes = { 'MOSAIC.63': 'free' };
    ok(/Hz$/.test(C.format('p.0.granular.63', 64)), 'a FREE rate from the project shows Hz', C.format('p.0.granular.63', 64));
    st.tracks[0].devices.material = 'TAPE'; st.tracks[0].mat = { dev: 'TAPE', grid: 4, steps: 11.25, lengthMode: '1/1', speedMode: '' };
    ok(C.format('p.0.material.49', 127) === '11 bars' && C.parse('p.0.material.49', '5') === 50, 'TAPE LENGTH in bars at the project tempo (90 BPM)');
    // typing into a knob in the inspector
    Object.assign(st.tracks[0], JSON.parse(keep));
    st.tracks[0].devices.material = 'DISC'; S4.emit('device');
    $$('#view-live .lane')[0].querySelectorAll('.tile')[0].click();
    const k = $$('#view-live .lv-insp .knob').find(x => x.dataset.target === 'p.0.material.56'), kv = k && k.querySelector('.k-val.k-edit');
    ok(!!kv, 'Live values can be typed');
    if (kv) {
      C.set('p.0.material.56', 100, { send: false });
      take();
      kv.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
      const inp = $('#view-live .lv-insp .k-input');
      ok(!!inp, 'a field opens');
      if (inp) { inp.value = '-6 dB'; key(inp, 'Enter'); }
      ok(C.get('p.0.material.56') === 55 && take().includes(hex([0xB0, 56, 55])), 'typed -6 dB sends CC 55', C.get('p.0.material.56'));
    }
    Object.assign(st.tracks[0], JSON.parse(keep));
    Object.assign(st, keepSt);
    S4.emit('device');
    take();
  });

  await section('update notice', async () => {
    const U = S4.update, bar = $('#updateBar'), realFetch = window.fetch, was = { mine: U.mine, latest: U.latest, later: U.later };
    let served = null; // the version.json the "site" has (null: none)
    window.fetch = (url, o) => (/version\.json$/.test(String(url))
      ? Promise.resolve(served ? new Response(JSON.stringify({ version: served })) : new Response('', { status: 404 })) : realFetch(url, o));
    try {
      U.mine = 'dev'; served = 'b';
      await U.check();
      ok(bar.hidden, 'a copy without a version never shows the notice');
      U.mine = 'a'; served = 'a';
      await U.check();
      ok(bar.hidden, 'the same version on the site: no notice');
      served = 'b';
      await U.check();
      ok(!bar.hidden && /Ctrl\+Shift\+R/.test(bar.textContent), 'a newer version on the site: the notice asks for Ctrl+Shift+R', bar.textContent);
      for (const th of S4.theme.LIST.map(x => x.id).filter(id => id !== 'system')) {
        S4.theme.set(th);
        ok(audit(3).length === 0, `${th}: the notice is readable`, audit(3).slice(0, 5));
      }
      S4.theme.set('system');
      bar.querySelector('.btn').click();
      ok(bar.hidden, 'Later hides it');
      await U.check();
      ok(bar.hidden, 'and it stays hidden for a while');
      U.later = 0;
      await U.check();
      ok(!bar.hidden, 'then it comes back while the page is still old');
      served = null;
      await U.check();
      ok(!bar.hidden, 'a failed check changes nothing');
    } finally {
      window.fetch = realFetch;
      Object.assign(U, was);
      bar.hidden = true;
    }
  });

  await section('errors', async () => {
    ok(T.errors.length === 0, 'no console errors', T.errors.slice(0, 10));
  });

  console.error = ce;
  removeEventListener('error', onErr);
  removeEventListener('unhandledrejection', onErr);
  return T;
})();
