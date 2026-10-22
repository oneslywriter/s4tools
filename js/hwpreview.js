'use strict';
// Play on S-4 (the hardware preview): play Build's scenes through the S-4 itself instead of simulating it.
// The S-4 is also a 10-in / 10-out USB audio interface with fixed inputs: one stereo pair per track plus
// one straight to the master. A track in BYPASS runs whatever arrives on its pair through its real
// effects and the S-4's mixer. So each track's audio (warped, trimmed, at the device LEVEL, dry) is sent
// to its own pair, and the scene's effect settings (GRANULAR, FILTER, COLOR, SPACE) go to the tracks over MIDI.
//
// While it is on, the stream to the S-4 never stops: between sounds it carries silence, and turning it off
// fades out and keeps sending silence for a moment first. (With no stream the S-4 keeps replaying the
// last 1024 samples it received, which is heard as a 47 Hz buzz on a track in BYPASS.)
(function (S4) {
  const A = S4.audio;
  const HW = S4.hw = {
    on: false, ctx: null, out: null, merger: null, outputs: null,
    settings: Object.assign({ sinkId: '', sinkLabel: '', order: 'auto', pushFx: true }, S4.store.get('hw', {})),
  };
  const save = () => S4.store.set('hw', HW.settings);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // First channel (0-based, as the browser numbers them) of each track's input pair, and of the pair that
  // goes straight to the master. Measured on Windows: the S-4's own "1/2" (master) is the browser's last
  // pair, so T1 is the browser's 1/2. The other order follows the S-4's own numbering.
  HW.ORDERS = {
    windows: { label: 'T1 = 1/2 … T4 = 7/8, master 9/10', pairs: [0, 2, 4, 6], master: 8 },
    s4: { label: 'master 1/2, T1 = 3/4 … T4 = 9/10', pairs: [2, 4, 6, 8], master: 0 },
  };
  HW.order = () => (HW.settings.order !== 'auto' ? HW.settings.order : /Windows/.test(navigator.userAgent) ? 'windows' : 's4');
  const map = () => HW.ORDERS[HW.order()] || HW.ORDERS.windows;

  // ---------- output device ----------
  // Chrome names output devices only once the page may use a microphone; ask for that only when choosing.
  HW.listOutputs = async function (ask) {
    let devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput');
    if (ask && !devs.some(d => d.label)) {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach(t => t.stop());
      devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput');
    }
    HW.outputs = devs.filter(d => d.deviceId !== 'communications');
    return HW.outputs;
  };
  HW.looksLikeS4 = label => /source\/sink|s-?4|torso/i.test(label || '');
  HW.setOutput = function (dev) {
    HW.settings.sinkId = dev ? dev.deviceId : '';
    HW.settings.sinkLabel = dev ? dev.label : '';
    save();
    if (HW.on) HW.stop().then(() => HW.start());
    S4.emit('hw');
  };

  // ---------- on / off ----------
  HW.start = async function () {
    if (HW.on) return;
    const opts = { latencyHint: 'interactive', sampleRate: 48000 };
    if (HW.settings.sinkId && HW.settings.sinkId !== 'default') opts.sinkId = HW.settings.sinkId;
    let ctx;
    try { ctx = new AudioContext(opts); } catch (e) {
      // the chosen device is gone: fall back to the default output
      delete opts.sinkId;
      ctx = new AudioContext(opts);
    }
    await ctx.resume();
    const n = ctx.destination.maxChannelCount;
    if (n < 10) {
      await ctx.close();
      throw new Error(`This output has ${n} channels. Play on S-4 needs the S-4's own output (10 channels).`);
    }
    ctx.destination.channelCount = n;
    ctx.destination.channelInterpretation = 'discrete';
    const merger = ctx.createChannelMerger(n), out = ctx.createGain();
    merger.connect(out);
    out.connect(ctx.destination);
    const m = map();
    const chains = m.pairs.map(base => {
      // mono samples are spread to both sides, then left/right go to the track's pair
      const input = ctx.createGain(), g = ctx.createGain(), sp = ctx.createChannelSplitter(2);
      input.channelCount = 2; input.channelCountMode = 'explicit'; input.channelInterpretation = 'speakers';
      input.connect(g); g.connect(sp);
      sp.connect(merger, 0, base); sp.connect(merger, 1, base + 1);
      return { input, g, hw: true };
    });
    Object.assign(HW, { ctx, out, merger, on: true });
    full.clear();
    A.useOutput({ ctx, chains, out });
    ctx.onstatechange = () => { if (ctx.state === 'closed' && HW.ctx === ctx) offline(); };
    S4.emit('hw');
    pushCurrent(true);
  };

  HW.stop = async function () {
    if (!HW.on) return;
    const { ctx, out } = HW;
    HW.on = false;
    out.gain.setTargetAtTime(0, ctx.currentTime, 0.008);
    await sleep(60);
    A.stop();
    A.stopHear();
    await sleep(250); // a moment of silence, so the S-4 holds zeros and not a stale block
    A.useOutput(null);
    HW.ctx = HW.out = HW.merger = null;
    try { await ctx.close(); } catch (e) { /* already closed */ }
    S4.emit('hw');
  };
  function offline() {
    if (!HW.on) return;
    HW.on = false;
    HW.ctx = HW.out = HW.merger = null;
    A.useOutput(null);
    S4.emit('hw');
    S4.toast('Play on S-4 stopped: the audio output went away', 'err');
  }
  HW.toggle = () => (HW.on ? HW.stop() : HW.start());

  // Leaving the page while a sound plays would leave that block looping on the S-4: silence it first.
  window.addEventListener('pagehide', () => { if (HW.on && HW.out) HW.out.gain.value = 0; });

  // ---------- test tones ----------
  // t: 0-3 for a track, 'master' for the pair that goes straight to the master. A short rising blip.
  HW.test = function (t) {
    if (!HW.on) return;
    const ctx = HW.ctx, m = map(), base = t === 'master' ? m.master : m.pairs[t];
    const t0 = ctx.currentTime + 0.03;
    [0, 4, 7].forEach((st, k) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), a = t0 + k * 0.16;
      o.frequency.value = (t === 'master' ? 330 : 440 * Math.pow(2, t / 12)) * Math.pow(2, st / 12);
      g.gain.setValueAtTime(0, a);
      g.gain.linearRampToValueAtTime(0.1, a + 0.01);
      g.gain.setTargetAtTime(0, a + 0.1, 0.02);
      o.connect(g);
      g.connect(HW.merger, 0, base);
      g.connect(HW.merger, 0, base + 1);
      o.start(a);
      o.stop(a + 0.3);
    });
  };

  // ---------- effects over MIDI ----------
  // Per track, on the track's channel, each exact value as its nearest CC (s4params.js):
  //   Each effect: its values when on; the S-4's defaults when not set (as the export leaves it); its wet(s) at
  //   0 when bypassed (MIDI can't bypass a device; the export does).
  //   A device set in a project imported before exact values, and not touched here, is left alone.
  // Only values that differ from what the app last sent (Live's copy of the S-4) go out, unless
  // forced; that copy is updated too, so the Live view follows.
  const DEV = S4.params.DEV;
  function wanted(tr) {
    const out = [];
    for (const [dev, d] of Object.entries(DEV)) {
      const e = tr.fx && tr.fx[dev], slot = d.slot;
      if (!e && tr.s4raw && tr.s4raw[slot] && Object.keys(tr.s4raw[slot]).length) continue;
      // a value in a mode goes out on that mode's curve (the S-4 reads it in whatever mode it has itself)
      if (e && e.on) d.params.forEach(sp => {
        const ms = S4.params.inMode(sp, e.md && e.md[sp.key]);
        out.push([slot, sp.cc, S4.params.cc(ms, e.n[sp.key] != null ? e.n[sp.key] : ms.def)]);
      });
      else if (!e) d.params.forEach(sp => out.push([slot, sp.cc, S4.params.cc(sp, sp.def)]));
      else d.params.filter(sp => /wet$/.test(sp.key)).forEach(sp => out.push([slot, sp.cc, 0]));
    }
    return out;
  }
  // The first time a device is on during a session all its values go out (the S-4 may hold values this app
  // never sent); after that only changes.
  const full = new Set();
  HW.pushTrack = function (t, tr, force) {
    if (!tr) return 0;
    const st = S4.state.tracks[t], bytes = [], fresh = new Set();
    for (const [dev, d] of Object.entries(DEV)) if (tr.fx && tr.fx[dev] && tr.fx[dev].on && !full.has(t + '.' + d.slot)) fresh.add(d.slot);
    for (const [slot, cc, v] of wanted(tr)) {
      // Live addresses a slot by its current device; Build only uses the S-4's defaults
      const dev = { space: 'VAST', granular: 'MOSAIC', filter: 'RING', color: 'DEFORM' }[slot];
      if (st.devices[slot] !== dev) S4.ctl.setDevice(t, slot, dev);
      const id = `p.${t}.${slot}.${cc}`;
      if (!force && !fresh.has(slot) && S4.ctl.get(id) === v) continue;
      S4.ctl.set(id, v, { send: false, force: true, src: 'build' });
      bytes.push([0xB0 | t, cc, v]);
    }
    fresh.forEach(slot => full.add(t + '.' + slot));
    if (bytes.length) S4.midi.sendBatch(bytes);
    return bytes.length;
  };
  HW.pushScene = function (idx, force) {
    const sc = idx >= 0 ? S4.cr.proj.scenes[idx] : null;
    if (!sc) return;
    if (!S4.midi.connected()) { warnNoMidi(); return; }
    sc.tracks.forEach((tr, t) => HW.pushTrack(t, tr, force));
  };
  let warned = false;
  function warnNoMidi() {
    if (warned) return;
    warned = true;
    S4.toast('Play on S-4: there is no MIDI connection to the S-4, so the effect settings aren\'t sent (the audio still plays)', 'err');
  }
  const sounding = () => (A.playing ? A.cur : S4.cr.sel.scene);
  function pushCurrent(force) { if (HW.on && HW.settings.pushFx) HW.pushScene(sounding(), force); }

  S4.on('audio-launch', idx => { if (HW.on && HW.settings.pushFx) HW.pushScene(idx); });
  S4.on('audio-hear', idx => { if (HW.on && HW.settings.pushFx) HW.pushScene(idx); });
  // an effect knob moved in Build: send it if that scene is the one sounding
  const edited = (idx, t) => {
    if (!HW.on || !HW.settings.pushFx || idx !== sounding()) return;
    if (!S4.midi.connected()) return warnNoMidi();
    HW.pushTrack(t, S4.cr.proj.scenes[idx].tracks[t]);
  };
  S4.on('build-vast', edited);
  S4.on('build-fx', edited);
  HW.setPushFx = function (on) {
    HW.settings.pushFx = on;
    save();
    if (on) pushCurrent(true);
    S4.emit('hw');
  };
  HW.setOrder = function (order) {
    HW.settings.order = order;
    save();
    if (HW.on) HW.stop().then(() => HW.start());
    S4.emit('hw');
  };
})(window.S4);
