'use strict';
// Recorder (Live view): listens to the S-4's main out, the only pair Chrome gets from the S-4's USB audio
// (it offers 2 of the 10 channels: the main pair). It shows the level, records takes to the PC as 24-bit WAVs,
// and starts takes two ways:
//   Threshold: armed, the first sound above the threshold starts a take, either on the PC (with pre-roll, so
//     nothing is cut) or with the S-4's own REC on a track or the main out. An S-4 take misses the first ~45 ms
//     of the sound: its way to the PC, Chrome's 10 ms blocks, the REC note and the S-4's start (VERIFY.md).
//   Pre-click: 1 or 2 bars at the project's BPM (the Build project), heard on this computer, on the S-4 (its
//     main-out USB pair: no setup there) or only seen. On the downbeat the S-4 gets START (and the REC), sent
//     timestamped, and the take begins; it ends by hand or after a set number of bars, exactly on the bar.
//     Measured with a click at the start of bar 1 (2026-10-22): with the click on the S-4, its bar 1 lands
//     about 7 ms after the click's beat (-8 to +30 ms over 6 runs).
(function (S4) {
  const h = S4.h;
  const R = S4.rec = {
    on: false, armed: false, device: '',
    settings: Object.assign({
      inId: null, thresh: -30, target: 'pc', hold: 2,
      mode: 'thresh', bars: 1, click: 'local', localOut: '', takeBars: 0,
    }, S4.store.get('rec', {})),
  };
  // the click on the S-4 used to need a track in BYPASS; it now goes to the main out
  if (R.settings.click === 'bypass') R.settings.click = 's4';
  delete R.settings.clickTrack;
  const save = () => S4.store.set('rec', R.settings);
  const PRE = 0.5; // seconds of pre-roll for a PC take started by the threshold
  const TARGETS = [
    { value: 'pc', label: 'PC', hint: 'a WAV on this computer' },
    ...[0, 1, 2, 3].map(t => ({ value: 't' + t, label: 'T' + (t + 1), hint: `the S-4 records the track (note ${S4.NOTE.TRACK_REC + t})` })),
    { value: 'main', label: 'MAIN', hint: `the S-4 records its main out (note ${S4.NOTE.MAIN_REC})` },
  ];
  const targetLabel = v => (TARGETS.find(x => x.value === v) || TARGETS[0]).label;
  const lin = db => Math.pow(10, db / 20);
  R.bpm = () => { const p = S4.follow && S4.follow.project(); return (p && p.bpm) || 120; };

  let stream = null, sr = 48000, take = null; // take = { target, auto, count, date, quiet, blocks }
  let ring = []; // the last PRE seconds of blocks, for a threshold PC take
  let count = null; // a pre-click under way: { t0, beat, n, down, timers, click }
  const peak = [0, 0]; // highest sample since the meter last drew

  // ---------- devices ----------
  const listDevices = async kind => (await navigator.mediaDevices.enumerateDevices())
    .filter(d => d.kind === kind && !/^(default|communications)$/.test(d.deviceId));
  // On Windows the S-4's audio shows up as "Source/Sink"
  const isS4 = d => /source\/sink|(^|[^a-z0-9])s-?4([^a-z0-9]|$)|torso/i.test(d.label);
  async function devices(kind) {
    let list = await listDevices(kind);
    if (list.length && !list.some(d => d.label)) { // no names before microphone access is granted
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach(t => t.stop());
      list = await listDevices(kind);
    }
    return list;
  }

  // ---------- input ----------
  R.start = async function () {
    if (R.on) return true;
    if (typeof MediaStreamTrackProcessor !== 'function') { S4.toast('Recording needs Chrome or Edge', 'err'); return false; }
    let dev;
    try {
      const list = await devices('audioinput');
      dev = list.find(d => d.deviceId === R.settings.inId) || list.find(isS4);
      if (!dev) { S4.toast('The S-4\'s audio input isn\'t there. Connect it over USB, or choose the input with the arrow next to the meter.', 'err'); return false; }
      stream = await navigator.mediaDevices.getUserMedia({ audio: {
        deviceId: { exact: dev.deviceId }, channelCount: 2, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      S4.toast(e && e.name === 'NotAllowedError' ? 'This page may not use audio inputs. Allow the microphone for it in Chrome\'s site settings and try again.'
        : 'The S-4\'s audio input didn\'t open: ' + (e && e.message), 'err');
      return false;
    }
    R.on = true;
    R.device = dev.label;
    const track = stream.getAudioTracks()[0];
    track.addEventListener('ended', () => R.stop());
    pump(new MediaStreamTrackProcessor({ track }).readable.getReader());
    last = 0;
    requestAnimationFrame(draw);
    S4.emit('rec');
    return true;
  };

  R.stop = function () {
    if (!R.on) return;
    if (count) cancelCount();
    if (take) R.stopTake();
    R.armed = false;
    R.on = false;
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    ring = [];
    S4.emit('rec');
  };

  async function pump(reader) {
    for (;;) {
      let r;
      try { r = await reader.read(); } catch (e) { break; }
      if (r.done) break;
      block(r.value);
    }
    R.stop();
  }

  // Each block Chrome delivers (10 ms): meter, recording, threshold.
  function block(ad) {
    const n = ad.numberOfFrames, chans = [];
    let pk = 0;
    for (let c = 0; c < 2; c++) {
      const b = new Float32Array(n);
      ad.copyTo(b, { planeIndex: Math.min(c, ad.numberOfChannels - 1), format: 'f32-planar' });
      let p = 0;
      for (let i = 0; i < n; i++) { const v = b[i] < 0 ? -b[i] : b[i]; if (v > p) p = v; }
      if (p > peak[c]) peak[c] = p;
      if (p > pk) pk = p;
      chans.push(b);
    }
    sr = ad.sampleRate;
    ad.close();
    if (take && take.target === 'pc') take.blocks.push(chans);
    else {
      ring.push(chans);
      while (ring.length > 1 && ring.length * n > PRE * sr) ring.shift();
    }
    const thr = lin(R.settings.thresh);
    if (R.armed && !take && pk >= thr) fire();
    else if (take && take.auto && R.settings.hold > 0) {
      take.quiet = pk >= thr ? 0 : take.quiet + n / sr;
      if (take.quiet >= R.settings.hold) R.stopTake();
    }
  }

  // ---------- takes ----------
  // at: a performance.now() time to send the REC at (timestamped MIDI); now when left out
  const s4Rec = (target, at) => {
    const id = target === 'main' ? 'btn.rec' : 'btn.trec.' + target.slice(1);
    S4.ctl.press(id, true, { at });
    S4.ctl.press(id, false);
  };

  function fire() {
    R.armed = false;
    const target = R.settings.target;
    if (target !== 'pc') s4Rec(target); // first, before anything else delays it
    take = { target, auto: true, date: new Date(), quiet: 0, blocks: target === 'pc' ? ring.splice(0) : null };
    S4.emit('rec');
  }

  R.stopTake = function (at) {
    const tk = take;
    if (!tk) return;
    take = null;
    if (tk.timer) clearTimeout(tk.timer);
    if (tk.target === 'pc') savePc(tk);
    else s4Rec(tk.target, at);
    S4.emit('rec');
  };

  R.toggleRec = async function () {
    if (take && take.target === 'pc' && !take.count) return R.stopTake();
    if (take || R.armed || count) return;
    if (!(await R.start())) return;
    take = { target: 'pc', auto: false, date: new Date(), quiet: 0, blocks: [] };
    S4.emit('rec');
  };

  R.toggleArm = async function () {
    if (take && take.auto) return R.stopTake();
    if (R.armed) { R.armed = false; S4.emit('rec'); return; }
    if (take || count) return;
    const target = R.settings.target;
    if (target !== 'pc' && !S4.midi.connected()) return S4.toast('There is no MIDI connection to the S-4, so it can\'t be told to record', 'err');
    if (!(await R.start())) return;
    if (target !== 'pc' && !S4.state.playing) S4.ctl.setPlaying(true, true); // the S-4 only records while it plays
    R.armed = true;
    S4.emit('rec');
  };

  function savePc(tk) {
    const n = tk.blocks.reduce((a, b) => a + b[0].length, 0);
    if (!n) return;
    const chs = [0, 1].map(c => {
      const out = new Float32Array(n);
      let o = 0;
      tk.blocks.forEach(b => { out.set(b[c], o); o += b[c].length; });
      return out;
    });
    const d = tk.date, p = x => String(x).padStart(2, '0');
    const name = `s4 main ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}.wav`;
    S4.download(new Blob([S4.audio.encodeWav(chs, sr, 24)], { type: 'audio/wav' }), name);
    S4.toast(`${name} saved (${(n / sr).toFixed(1)} s)`);
  }

  // ---------- pre-click ----------
  // The click: on this computer (an output picked here), on the S-4 (the USB pair of its main out, as Play on
  // numbers them), or none. Each pre-click opens its own audio connection (one kept open between pre-clicks landed
  // the S-4's bar 1 about 20 ms later on average, measured 2026-10-22). The stream to the S-4 starts and ends with
  // silence, so the S-4 doesn't keep replaying a piece of click (it loops the last 1024 samples it got).
  async function clickOut() {
    const mode = R.settings.click;
    if (mode === 'visual') return null;
    let sinkId = R.settings.localOut || '';
    if (mode === 's4') {
      const out = (await devices('audiooutput')).find(isS4);
      if (!out) { S4.toast('The S-4\'s audio output isn\'t there, so the pre-click is silent', 'err'); return null; }
      sinkId = out.deviceId;
    }
    const ctx = new AudioContext(sinkId ? { sampleRate: 48000, sinkId, latencyHint: 'interactive' } : { sampleRate: 48000, latencyHint: 'interactive' });
    await Promise.race([ctx.resume(), new Promise(r => setTimeout(r, 1000))]);
    if (ctx.state !== 'running') { ctx.close(); S4.toast('This computer\'s audio didn\'t start, so the pre-click is silent', 'err'); return null; }
    const dest = ctx.createGain(); // muted to cancel the clicks still to come
    if (mode === 's4') {
      const n = ctx.destination.maxChannelCount;
      ctx.destination.channelCount = n;
      ctx.destination.channelInterpretation = 'discrete';
      const merger = ctx.createChannelMerger(n);
      merger.connect(ctx.destination);
      const main = S4.hw.ORDERS[S4.hw.order()].master;
      dest.connect(merger, 0, main);
      dest.connect(merger, 0, main + 1);
      const sil = ctx.createConstantSource();
      sil.offset.value = 0;
      sil.connect(merger, 0, 0);
      sil.start();
    } else dest.connect(ctx.destination);
    // the output's timestamp is what lines the clicks up with the timestamped MIDI: wait for it
    for (let i = 0; i < 15 && !(ctx.getOutputTimestamp().performanceTime > 0); i++) await new Promise(r => setTimeout(r, 20));
    // wall clock (performance.now) -> this context's time, through what the output is playing right now
    const at = w => {
      const ts = ctx.getOutputTimestamp();
      return ts.performanceTime > 0 ? ts.contextTime + (w - ts.performanceTime) / 1000 : ctx.currentTime + (w - performance.now()) / 1000;
    };
    return { ctx, dest, at };
  }
  function click(c, w, accent) {
    const t = c.at(w);
    if (t <= c.ctx.currentTime) return;
    const o = c.ctx.createOscillator(), g = c.ctx.createGain();
    o.frequency.value = accent ? 2000 : 1000;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(accent ? 0.5 : 0.3, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(g);
    g.connect(c.dest);
    o.start(t);
    o.stop(t + 0.06);
  }

  R.toggleCount = async function () {
    if (count) return cancelCount();
    if (take && take.count) return R.stopTake();
    if (take || R.armed) return;
    const target = R.settings.target, midi = S4.midi.connected();
    if (target !== 'pc' && !midi) return S4.toast('There is no MIDI connection to the S-4, so it can\'t be told to record', 'err');
    if (midi && S4.state.playing) return S4.toast('Stop the S-4 first: the pre-click starts it on the first beat', 'err');
    if (!(await R.start())) return;
    const c = await clickOut();
    const beat = 60000 / R.bpm(), n = R.settings.bars * 4;
    const t0 = performance.now() + 300, down = t0 + n * beat;
    count = { t0, beat, n, down, timers: [], click: c };
    count.timers.push(setInterval(showCount, 20)); // cleared with the timers (clearTimeout clears intervals too)
    if (c) for (let k = 0; k < n; k++) click(c, t0 + k * beat, k % 4 === 0);
    // shortly before the downbeat: START and the REC go out timestamped for it, and the take begins
    count.timers.push(setTimeout(() => {
      const cn = count;
      count = null;
      cn.timers.forEach(clearTimeout);
      if (midi) S4.ctl.setPlaying(true, true, down);
      if (target !== 'pc') s4Rec(target, down + 2);
      take = { target, count: true, date: new Date(Date.now() + (down - performance.now())), blocks: target === 'pc' ? [] : null };
      const bars = R.settings.takeBars;
      if (bars > 0) {
        const end = down + bars * 4 * cn.beat;
        // a PC take runs 120 ms past the bar, as the S-4's sound reaches the PC 20-60 ms after it plays (measured);
        // an S-4 take gets its REC timestamped for the bar
        take.timer = setTimeout(() => R.stopTake(target === 'pc' ? undefined : end), end - performance.now() - (target === 'pc' ? -120 : 30));
      }
      setTimeout(() => { if (cn.click) cn.click.ctx.close(); }, 600);
      S4.emit('rec');
    }, Math.max(0, down - performance.now() - 30)));
    S4.emit('rec');
  };
  function cancelCount() {
    const cn = count;
    if (!cn) return;
    count = null;
    cn.timers.forEach(clearTimeout);
    if (cn.click) {
      cn.click.dest.gain.value = 0; // the stream ends on silence, so the S-4 doesn't loop a click
      setTimeout(() => cn.click.ctx.close(), 300);
    }
    S4.emit('rec');
  }
  const countLeft = () => (count ? S4.clamp(count.n - Math.floor((performance.now() - count.t0) / count.beat), 1, count.n) : 0);
  function showCount() {
    if (!count) return;
    const left = String(countLeft());
    if (els.go.textContent !== left) { els.go.textContent = left; setStatus(); }
    els.go.classList.toggle('beat1', performance.now() >= count.t0 && (count.n - +left) % 4 === 0);
  }

  // ---------- bar ----------
  const els = {};
  const shown = [0, 0]; // meter ballistics: instant rise, fall 24 dB/s
  let last = 0;
  const pos = x => S4.clamp((20 * Math.log10(x || 1e-9) + 60) / 60, 0, 1); // -60..0 dBFS across the meter
  function draw(now) {
    if (!R.on) { els.fills.forEach(f => { f.style.width = '0'; }); return; }
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    for (let c = 0; c < 2; c++) {
      shown[c] = Math.max(peak[c], shown[c] * Math.pow(10, (-24 * dt) / 20));
      peak[c] = 0;
      els.fills[c].style.width = pos(shown[c]) * 100 + '%';
      els.fills[c].classList.toggle('over', R.settings.mode === 'thresh' && shown[c] >= lin(R.settings.thresh));
      els.fills[c].classList.toggle('clip', shown[c] >= 0.999);
    }
    if (take && !count) setStatus();
    requestAnimationFrame(draw);
  }

  const clickText = () => {
    const s = R.settings;
    return s.click === 'visual' ? 'no click' : s.click === 's4' ? 'click on the S-4' : 'click here';
  };
  const setStatus = () => { els.status.textContent = els.status.title = statusText(); };
  function statusText() {
    const s = R.settings, tg = s.target;
    if (count) return `Pre-click: ${countLeft()} · ${R.bpm()} bpm`;
    if (take) {
      const sec = ((Date.now() - take.date) / 1000).toFixed(1) + ' s';
      return take.target === 'pc' ? `Recording the main out here · ${sec}` : `The S-4 is recording ${targetLabel(take.target)} · ${sec}`;
    }
    if (R.armed) return `Waiting for sound above ${s.thresh} dB, then ${tg === 'pc' ? 'recording here' : 'REC on ' + targetLabel(tg)}`;
    if (!R.on) return 'Not listening. Click the meter to start.';
    if (s.mode === 'count') return `${R.bpm()} bpm, from the Build project. Then START${tg === 'pc' ? '' : ' and REC on ' + targetLabel(tg)}`;
    if (tg === 'pc') return R.device;
    return tg === 'main' ? 'On the S-4: MAIN RECORD quantisation at NONE' : `On the S-4: MON on for ${targetLabel(tg)}, TRACK RECORD quantisation at NONE`;
  }

  R.bar = function () {
    const thrMark = h('i', { class: 'rec-thr' });
    els.fills = [h('i', { class: 'rec-fill' }), h('i', { class: 'rec-fill' })];
    els.status = h('span', { class: 'rec-status' });
    const s = R.settings;
    const set = (k, v) => { s[k] = v; save(); render(); };
    const modeSeg = h('div', { class: 'seg mini rec-mode' });
    const meter = h('button', { class: 'rec-meter', title: 'The S-4\'s main out, -60 to 0 dB. Click to start or stop listening.',
      onclick: () => (R.on ? R.stop() : R.start()) },
    h('span', { class: 'rec-ch' }, els.fills[0]), h('span', { class: 'rec-ch' }, els.fills[1]), thrMark);
    const inBtn = h('button', { class: 'ib sm', title: 'What to listen to', onclick: async () => {
      let list;
      try { list = await devices('audioinput'); } catch (e) { return S4.toast('The inputs can only be listed once the page may use the microphone', 'err'); }
      S4.menu(inBtn, [{ head: 'Listen to' }, { label: 'The S-4 (found by its name)', checked: !s.inId, value: null },
        ...list.map(d => ({ label: d.label || 'Input', checked: d.deviceId === s.inId, value: d.deviceId }))], v => {
        set('inId', v);
        if (R.on) { R.stop(); R.start(); }
      });
    } }, S4.icon('chev'));
    const thr = S4.knob({
      label: 'Threshold', ccLabel: 'A take starts when the sound goes above this level', get: () => s.thresh, set: v => set('thresh', v),
      min: -60, max: 0, step: 1, def: -30, fmt: v => v + ' dB', parse: t => { const v = parseFloat(t); return isFinite(v) ? S4.clamp(Math.round(-Math.abs(v)), -60, 0) : null; },
    }, { size: 'inline' });
    const countBtn = h('button', { class: 'btn rec-count', title: 'How long the pre-click is, and where its click plays', onclick: async () => {
      let outs = [];
      try { outs = await devices('audiooutput'); } catch (e) { /* listed without names */ }
      S4.menu(countBtn, [
        { head: `Pre-click at ${R.bpm()} bpm (the Build project's tempo)` },
        ...[1, 2].map(b => ({ label: b === 1 ? '1 bar' : '2 bars', checked: s.bars === b, action: () => set('bars', b) })),
        { head: 'Click' },
        { label: 'Here: the default output', checked: s.click === 'local' && !s.localOut, action: () => { s.localOut = ''; set('click', 'local'); } },
        ...outs.filter(d => !isS4(d)).map(d => ({ label: 'Here: ' + (d.label || 'an output without a name'), checked: s.click === 'local' && s.localOut === d.deviceId, action: () => { s.localOut = d.deviceId; set('click', 'local'); } })),
        { label: 'On the S-4', hint: 'out of its main out', checked: s.click === 's4', action: () => set('click', 's4') },
        { label: 'None: the countdown only', checked: s.click === 'visual', action: () => set('click', 'visual') },
      ]);
    } });
    const hold = S4.knob({
      label: 'Stops after', ccLabel: 'A take that sound started stops after this much quiet (0: you stop it)', get: () => s.hold, set: v => set('hold', v),
      min: 0, max: 10, step: 0.5, def: 2, fmt: v => (v ? v + ' s quiet' : 'you stop it'),
    }, { size: 'inline' });
    const len = S4.knob({
      label: 'Length', ccLabel: 'How long a counted-in take runs (0: until you stop it)', get: () => s.takeBars, set: v => set('takeBars', v),
      min: 0, max: 16, step: 1, def: 0, fmt: v => (v ? v + (v === 1 ? ' bar' : ' bars') : 'you stop it'),
    }, { size: 'inline' });
    const recBtn = h('button', { class: 'btn rec-pc', onclick: () => R.toggleRec() });
    const tgtBtn = h('button', { class: 'btn rec-tgt', title: 'Where an armed or counted-in take is recorded', onclick: () => {
      S4.menu(tgtBtn, [{ head: 'Record into' }, ...TARGETS.map(x => ({ label: x.label, hint: x.hint, checked: x.value === s.target, value: x.value }))], v => set('target', v));
    } });
    const monSlot = h('span', { class: 'rec-mon' });
    const go = els.go = h('button', { class: 'btn rec-arm', onclick: () => (s.mode === 'count' ? R.toggleCount() : R.toggleArm()) });
    const slotA = h('span', { class: 'rec-slot' }), slotB = h('span', { class: 'rec-slot' });
    const el = h('div', { class: 'recbar' },
      modeSeg,
      h('div', { class: 'rec-in' }, h('div', { class: 'rec-in-top' }, meter, inBtn), els.status),
      slotA,
      h('span', { class: 'rec-sep' }),
      recBtn,
      h('span', { class: 'rec-sep' }),
      tgtBtn, monSlot, slotB, go);

    function render() {
      const tg = s.target, cnt = s.mode === 'count', pcTake = take && take.target === 'pc' && !take.auto && !take.count;
      const busy = !!(take || R.armed || count);
      modeSeg.replaceChildren(...[['thresh', 'Threshold'], ['count', 'Pre-click']].map(([v, label]) => h('button', {
        class: s.mode === v ? 'on' : '', disabled: busy || null, onclick: () => set('mode', v),
      }, label)));
      thrMark.style.display = cnt ? 'none' : '';
      thrMark.style.left = ((s.thresh + 60) / 60) * 100 + '%';
      meter.classList.toggle('on', R.on);
      slotA.replaceChildren(cnt ? countBtn : thr);
      slotB.replaceChildren(cnt ? len : hold);
      countBtn.replaceChildren(`${s.bars} bar${s.bars > 1 ? 's' : ''} · ${clickText()}`, S4.icon('chev'));
      recBtn.replaceChildren(h('i', { class: 'dot rec' }), pcTake ? 'Stop' : 'Record to PC');
      recBtn.classList.toggle('recording', !!pcTake);
      recBtn.disabled = busy && !pcTake;
      recBtn.title = pcTake ? 'Stop, and save the WAV' : 'Record the S-4\'s main out into a WAV on this computer, starting now';
      tgtBtn.replaceChildren('→ ' + targetLabel(tg), S4.icon('chev'));
      monSlot.replaceChildren(/^t\d$/.test(tg) ? S4.tbutton('btn.mon.' + tg.slice(1), [S4.icon('mon'), 'MON'], { cls: 'sm', title: `Monitor ${targetLabel(tg)}: it passes its input while it waits` }) : '');
      const ownTake = take && (cnt ? take.count : take.auto);
      go.classList.toggle('armed', R.armed || !!count);
      if (!count) go.classList.remove('beat1');
      go.classList.toggle('recording', !!ownTake);
      go.disabled = !!(take && !ownTake);
      if (cnt) {
        go.replaceChildren(ownTake ? 'Stop take' : count ? String(countLeft()) : 'Pre-click');
        go.title = ownTake ? 'Stop the take' : count ? 'Cancel the pre-click'
          : `A pre-click of ${s.bars} bar${s.bars > 1 ? 's' : ''} at ${R.bpm()} bpm; on the first beat the S-4 starts${tg === 'pc' ? ' and its main out is recorded here' : ' and REC goes to ' + targetLabel(tg)}. Stop the S-4 before you start.`;
      } else {
        go.replaceChildren(ownTake ? 'Stop take' : R.armed ? 'Armed' : 'Arm');
        go.title = ownTake ? 'Stop the take' : R.armed ? 'Stop waiting' : tg === 'pc'
          ? 'Wait for sound, then record it here, from half a second before it started'
          : 'Wait for sound, then send REC to the S-4 (starting it if it is stopped: it records only while it plays). The S-4 misses roughly the first 45 ms; a take on the PC keeps everything.';
      }
      setStatus();
      thr._update && thr._update();
    }
    S4.on('rec', render);
    render();
    return el;
  };
})(window.S4);
