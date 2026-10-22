'use strict';
// Settings: theme, MIDI ports, the scene channel, how start / stop is sent, follow, the MIDI monitor.
(function (S4) {
  const h = S4.h;
  const M = S4.midi;

  function statusText() {
    if (M.status === 'unsupported') return ['This browser has no Web MIDI. Chrome, Edge or Opera on a computer have it.', 'err'];
    if (M.status === 'denied') return ['This page may not use MIDI. Allow it in the browser\'s site settings, then press Try again.', 'err'];
    if (M.status === 'init') return ['Asking for MIDI…', ''];
    if (M.connected() && M.answer === 'none') return ['The S-4 didn\'t reply to the last start / stop, so MIDI isn\'t getting through. Reloading the page reconnects. If that doesn\'t do it, make sure the S-4 isn\'t in USB storage mode, plug it in again, or restart the browser.', 'err'];
    const outs = M.outputs().filter(p => p.state === 'connected').length, ins = M.inputs().filter(p => p.state === 'connected').length;
    const ports = `${outs} MIDI output${outs === 1 ? '' : 's'} and ${ins} input${ins === 1 ? '' : 's'} here.`;
    return [M.connected() ? `Talking to ${M.out.name}. ${ports}` : `No S-4 yet: connect it over USB, or choose its port below. ${ports}`, M.connected() ? 'ok' : 'warn'];
  }

  function portSelect(list, current, auto, onChange) {
    return h('select', { onchange: e => onChange(e.target.value || null) },
      h('option', { value: '' }, auto ? `Found by name: ${auto.name}` : 'Find it by name (S-4, Torso or "MIDI function")'),
      list.map(p => h('option', { value: p.id, selected: p.id === current || null }, p.name + (p.state !== 'connected' ? ' (unplugged)' : ''))));
  }

  S4.settings = {
    open() {
      const body = h('div', { class: 'settings' });
      const logEl = h('div', { class: 'mon-list' });
      const renderLog = () => {
        logEl.innerHTML = '';
        M.log.slice(-80).reverse().forEach(e => logEl.append(h('div', { class: 'mon-row ' + e.dir },
          h('span', { class: 'mon-dir' }, e.dir === 'out' ? 'OUT →' : '← IN'), h('span', { class: 'mon-txt' }, e.text), h('span', { class: 'mon-port' }, e.port))));
        if (!M.log.length) logEl.append(h('div', { class: 'note padded' }, 'Quiet so far. Turn a knob here or on your controller.'));
      };
      const render = () => {
        body.innerHTML = '';
        const [txt, kind] = statusText();
        const autoOut = M.settings.outId ? null : M.out;
        const autoIn = M.settings.inId ? null : M.s4in;
        const proj = S4.follow.project();
        body.append(
          h('div', { class: 'set-status ' + kind }, h('i', { class: 'dot' }), h('span', null, txt), M.status === 'denied' ? S4.btn('Try again', () => M.init(), 'sm')
            : M.connected() && M.answer === 'none' ? S4.btn('Reload', () => location.reload(), 'sm') : null),
          row('Theme', 'The colours of s4tools and its guide. System follows your computer: Paper by day, Night after dark.', themePicker()),
          row('S-4 output', 'Knobs, notes and scene changes go out here.',
            portSelect(M.outputs(), M.settings.outId, autoOut, v => { M.settings.outId = v; M.saveSettings(); })),
          row('S-4 input', 'The S-4\'s clock and start / stop come in here (SYNC OUT on in the S-4\'s MIDI settings).',
            portSelect(M.inputs(), M.settings.inId, autoIn, v => { M.settings.inId = v; M.saveSettings(); })),
          row('Controllers', 'The MIDI inputs Learn and your control maps listen to.', ctrlList()),
          row('Scene channel', 'The channel of the program change that picks a scene.',
            h('select', { onchange: e => { M.settings.pcCh = +e.target.value; M.saveSettings(); } },
              Array.from({ length: 16 }, (_, i) => h('option', { value: i + 1, selected: M.settings.pcCh === i + 1 || null }, 'Channel ' + (i + 1))))),
          row('Start / stop', 'Note C0 on channel 16 toggles the transport. MIDI start / stop needs START STOP on in the S-4\'s MIDI settings. Once the S-4 has replied to one, s4tools tells you when a start or stop gets no reply.',
            S4.seg([{ label: 'Note C0, channel 16', value: 'note' }, { label: 'MIDI start / stop', value: 'realtime' }], M.settings.transport, v => { M.settings.transport = v; M.saveSettings(); })),
          row('Follow the project', `When you pick a scene in Live, its knobs jump to that scene's values in the Build project${proj ? ` (${proj.name || 'untitled'})` : ''}. Nothing is sent, the S-4 loads the scene by itself. Values whose curve isn't measured yet (mixer levels, pans and filters, MAIN, COMPRESS, the macros, SPEED, START and LENGTH) stay where they were.`,
            S4.onoff(S4.follow.settings.on, v => { S4.follow.settings.on = v; S4.follow.save(); })),
          row('Resend', 'The S-4 can\'t tell s4tools where its knobs are, so Live shows what was last sent. This sends all of it again so the two match.',
            S4.btn('Send every value to the S-4', () => { const n = S4.ctl.dumpAll(); S4.toast(`${n} values sent`); }, 'sm')),
          row('Guide', 'Setting up, each view, recording, building projects, and what to do when something goes wrong.',
            h('a', { class: 'btn sm', href: 'docs/guide.html', target: '_blank', rel: 'noopener' }, 'Read the guide')),
          h('div', { class: 'set-mon' },
            h('div', { class: 'map-opts-head' }, h('span', { class: 'lbl' }, 'MIDI monitor'), h('span', { class: 'sp' }), S4.btn('Clear', () => { M.log.length = 0; renderLog(); }, 'sm')),
            logEl));
        renderLog();
      };
      // the inside of each swatch wears its own theme (data-theme), so it shows that theme's real colours
      const themePicker = () => {
        const cur = S4.theme.get();
        return h('div', { class: 'themes' }, S4.theme.LIST.map(t => h('button', {
          class: 'swatch' + (t.id === cur ? ' on' : ''), 'data-pick': t.id, title: t.hint || t.label,
          onclick: e => {
            S4.theme.set(t.id);
            e.currentTarget.parentElement.querySelectorAll('.swatch').forEach(b => b.classList.toggle('on', b === e.currentTarget));
          },
        }, h('span', { class: 'sw-in', 'data-theme': S4.theme.resolve(t.id) },
          h('span', { class: 'sw-dots' }, [1, 2, 3, 4].map(n => h('i', { style: { background: `var(--t${n})` } }))),
          h('span', { class: 'sw-name' }, t.label)))));
      };
      const row = (title, desc, ctl) => h('div', { class: 'set-row' },
        h('div', null, h('div', { class: 'mo-title' }, title), h('div', { class: 'mo-desc' }, desc)), h('div', { class: 'set-ctl' }, ctl));
      const ctrlList = () => {
        const ins = M.inputs();
        if (!ins.length) return h('span', { class: 'dim' }, 'No MIDI inputs here');
        return h('div', { class: 'ctrl-list' }, ins.map(p => h('label', { class: 'chk' },
          h('input', {
            type: 'checkbox', checked: M.isController(p) || null,
            onchange: e => {
              const ids = Array.isArray(M.settings.ctrlIds) ? M.settings.ctrlIds.slice() : ins.filter(x => M.isController(x)).map(x => x.id);
              const k = ids.indexOf(p.id);
              if (e.target.checked && k < 0) ids.push(p.id);
              if (!e.target.checked && k >= 0) ids.splice(k, 1);
              M.settings.ctrlIds = ids;
              M.saveSettings();
            },
          }), p.name)));
      };
      const offs = [S4.on('midi-ports', render), S4.on('midi-log', renderLog)];
      render();
      S4.modal('Settings', body, { cls: 'wide', onClose: () => offs.forEach(f => f()) });
    },
  };
})(window.S4);
