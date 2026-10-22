'use strict';
// Web MIDI: port selection, sending to the S-4, MIDI clock tempo, controller input routing, monitor log.
(function (S4) {
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  // S-4 docs number notes so that 24 = C0.
  S4.noteName = n => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 2);

  const M = S4.midi = {
    status: 'init', // init | unsupported | denied | ready
    access: null,
    out: null,
    s4in: null,
    tempo: null,
    log: [],
    answer: null, // null | 'ok' | 'none': whether the S-4 answered the last START / STOP (see expectAnswer)
    reopened: 0, // fresh MIDI accesses tried since the S-4 last answered
    settings: Object.assign({ outId: null, inId: null, ctrlIds: null, pcCh: 16, transport: 'note' }, S4.store.get('midi', {})),
  };

  M.saveSettings = function () { S4.store.set('midi', M.settings); M.refresh(); };
  // On Windows the S-4's USB MIDI port shows up as the generic gadget name "MIDI function".
  M.isS4 = name => /(^|[^a-z0-9])s-?4([^a-z0-9]|$)|torso|^midi function/i.test(name || '');
  M.outputs = () => (M.access ? [...M.access.outputs.values()] : []);
  M.inputs = () => (M.access ? [...M.access.inputs.values()] : []);
  M.connected = () => !!(M.out && M.out.state === 'connected');

  M.init = async function () {
    if (!navigator.requestMIDIAccess) { M.status = 'unsupported'; S4.emit('midi-ports'); return; }
    try {
      M.access = await navigator.requestMIDIAccess({ sysex: false });
      M.status = 'ready';
      // A hot-plugged port can fire statechange before it is listed in access.inputs,
      // so attach to the event's own port and refresh again once the lists settle.
      M.access.onstatechange = e => {
        const p = e.port;
        if (p && p.type === 'input' && p.state === 'connected' && !p.onmidimessage) p.onmidimessage = ev => onMessage(p, ev);
        M.refresh();
        setTimeout(M.refresh, 300);
      };
    } catch (e) {
      console.warn('MIDI access', e);
      M.status = 'denied';
    }
    M.refresh();
  };

  M.refresh = function () {
    if (!M.access) { S4.emit('midi-ports'); return; }
    const outs = M.outputs().filter(p => p.state === 'connected');
    const ins = M.inputs().filter(p => p.state === 'connected');
    const was = M.out && M.out.id;
    M.out = outs.find(p => p.id === M.settings.outId) || outs.find(p => M.isS4(p.name)) || null;
    if ((M.out && M.out.id) !== was) M.answer = null; // another port: nothing known about it yet
    M.s4in = ins.find(p => p.id === M.settings.inId) || ins.find(p => M.isS4(p.name)) || null;
    for (const inp of M.inputs()) inp.onmidimessage = e => onMessage(inp, e);
    S4.emit('midi-ports');
  };

  M.isController = function (port) {
    if (M.s4in && port.id === M.s4in.id) return false;
    if (Array.isArray(M.settings.ctrlIds)) return M.settings.ctrlIds.includes(port.id);
    return !M.isS4(port.name);
  };

  // ---------- sending ----------
  M.send = function (bytes, ts) {
    const ok = M.connected();
    if (ok) {
      try { M.out.send(bytes, ts); } catch (e) { console.warn('MIDI send', e); }
    }
    addLog('out', ok ? M.out.name : 'no S-4 output', bytes);
    return ok;
  };
  M.cc = (ch, cc, v) => M.send([0xB0 | (ch - 1), cc & 127, v & 127]);
  M.noteOn = (ch, n, vel = 127) => M.send([0x90 | (ch - 1), n & 127, vel & 127]);
  M.noteOff = (ch, n) => M.send([0x80 | (ch - 1), n & 127, 0]);
  // at: a performance.now() time to send at (Web MIDI schedules it); now when left out
  M.noteTap = function (ch, n, at) {
    M.send([0x90 | (ch - 1), n & 127, 127], at);
    M.send([0x80 | (ch - 1), n & 127, 0], (at || performance.now()) + 40);
  };
  M.pc = (ch, prog) => M.send([0xC0 | (ch - 1), prog & 127]);
  M.realtime = (b, at) => M.send([b], at);

  // Send a batch spaced ~1.5 ms apart so slow MIDI parsers keep up.
  M.sendBatch = function (list) {
    const t0 = performance.now();
    list.forEach((bytes, i) => M.send(bytes, t0 + i * 1.5));
  };

  // ---------- receiving ----------
  let lastTick = 0, ticks = [], lastTempoEmit = 0;
  function onMessage(port, e) {
    const d = e.data;
    const s = d[0];
    const isS4In = M.s4in && port.id === M.s4in.id;
    if (s >= 0xF8) {
      if (!isS4In) return; // ignore controller clocks
      if (s === 0xF8) clock(e.timeStamp || performance.now());
      else if (s === 0xFA || s === 0xFB) { gotAnswer(); S4.emit('s4-transport', true); addLog('in', port.name, d); }
      else if (s === 0xFC) { gotAnswer(); S4.emit('s4-transport', false); addLog('in', port.name, d); }
      return;
    }
    addLog('in', port.name, d);
    if (M.isController(port)) S4.emit('ctrl-midi', port, d);
  }

  // USB MIDI timestamps jitter by several ms, so fit a line through up to
  // 8 beats of clock ticks (24 per beat) instead of averaging intervals.
  function clock(ts) {
    if (lastTick && ts - lastTick > 250) ticks = [];
    lastTick = ts;
    ticks.push(ts);
    if (ticks.length > 192) ticks.shift();
    if (ticks.length >= 48 && ts - lastTempoEmit > 300) {
      const n = ticks.length;
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (let i = 0; i < n; i++) { const y = ticks[i] - ticks[0]; sx += i; sy += y; sxx += i * i; sxy += i * y; }
      const msPerTick = (n * sxy - sx * sy) / (n * sxx - sx * sx);
      const bpm = Math.round((60000 / (msPerTick * 24)) * 10) / 10;
      lastTempoEmit = ts;
      if (bpm !== M.tempo) { M.tempo = bpm; S4.emit('tempo', bpm); }
    }
  }
  setInterval(() => {
    if (M.tempo != null && performance.now() - lastTick > 800) {
      M.tempo = null; ticks = []; lastTick = 0; S4.emit('tempo', null);
    }
  }, 400);

  // ---------- answer check ----------
  // The S-4 answers a START / STOP with its own START / STOP on its MIDI out. After it drops off USB (USB storage
  // mode, a replug), Chrome can keep a dead port that still reads "connected", and then nothing comes back.
  // A transport mode is checked only once the S-4 has answered it in this browser, so an S-4 that doesn't send
  // START / STOP never raises a false alarm.
  const ANSWER_MS = 1000;
  const answered = S4.store.get('midi.answered', {});
  let waiting = null;
  M.expectAnswer = function (onMiss, at) {
    if (waiting) clearTimeout(waiting.timer);
    const wait = ANSWER_MS + Math.max(0, (at || 0) - performance.now());
    const mode = M.settings.transport;
    waiting = {
      mode, timer: setTimeout(() => {
        waiting = null;
        if (!answered[mode] || !M.connected()) return;
        const tries = M.reopened;
        M.answer = 'none';
        S4.emit('midi-ports');
        M.reopen();
        onMiss(tries);
      }, wait),
    };
  };
  function gotAnswer() {
    if (waiting) {
      clearTimeout(waiting.timer);
      if (!answered[waiting.mode]) { answered[waiting.mode] = true; S4.store.set('midi.answered', answered); }
      waiting = null;
    }
    M.reopened = 0;
    if (M.answer !== 'ok') { M.answer = 'ok'; S4.emit('midi-ports'); }
  }

  // A fresh MIDI access, as a page reload gives (reloading fixed a dead port each time it was seen).
  M.reopen = async function () {
    M.reopened++;
    const old = M.access;
    if (old) {
      old.onstatechange = null;
      for (const p of old.inputs.values()) p.onmidimessage = null;
      await Promise.allSettled([...old.inputs.values(), ...old.outputs.values()].map(p => p.close()));
    }
    await M.init();
  };

  // ---------- monitor log ----------
  M.describe = function (d) {
    const s = d[0];
    if (s === 0xFA) return 'START';
    if (s === 0xFB) return 'CONTINUE';
    if (s === 0xFC) return 'STOP';
    const ch = (s & 15) + 1, t = s & 0xF0;
    if (t === 0xB0) return `CC ${d[1]} = ${d[2]} · CH ${ch}`;
    if (t === 0x90 && d[2]) return `NOTE ON ${d[1]} ${S4.noteName(d[1])} · VEL ${d[2]} · CH ${ch}`;
    if (t === 0x90 || t === 0x80) return `NOTE OFF ${d[1]} ${S4.noteName(d[1])} · CH ${ch}`;
    if (t === 0xC0) return `PROGRAM ${d[1]} · CH ${ch}`;
    if (t === 0xE0) return `PITCH BEND · CH ${ch}`;
    if (t === 0xD0) return `AFTERTOUCH · CH ${ch}`;
    return [...d].map(b => b.toString(16).padStart(2, '0')).join(' ');
  };
  let logQueued = false;
  function addLog(dir, port, bytes) {
    M.log.push({ t: performance.now(), dir, port, text: M.describe(bytes) });
    if (M.log.length > 200) M.log.splice(0, M.log.length - 200);
    if (!logQueued) { logQueued = true; requestAnimationFrame(() => { logQueued = false; S4.emit('midi-log'); }); }
  }
})(window.S4);
