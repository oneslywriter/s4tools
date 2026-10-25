'use strict';
// Build's audio: decoding, waveform peaks, scene preview playback, WAV export.
// DISC/TAPE loops in SYNC use varispeed (like the S-4's DISC SYNC mode); STRETCH plays the warp
// engine's render (warp.js). GRANULAR / FILTER / COLOR / SPACE are not simulated.
(function (S4) {
  const A = S4.audio = {
    ctx: null, out: null, chains: [],
    bufs: new Map(), peaks: new Map(), loading: new Map(), dcache: new Map(),
    playing: false, t0: 0, cur: -1, curStart: 0, curLen: 0, pending: null,
    voices: [null, null, null, null],
    hearing: -1, hearVoice: null,
    timer: null,
  };

  A.dbToGain = db => (db <= -95 ? 0 : Math.pow(10, db / 20));
  A.posToDb = p => (p >= 0.5 ? (p - 0.5) * 12 : Math.max(-96, 40 * Math.log10(Math.max(p, 1e-6) / 0.5)));
  A.dbToPos = db => (db >= 0 ? 0.5 + db / 12 : db <= -95 ? 0 : 0.5 * Math.pow(10, db / 40));

  // The app's own mix: four chains (input > FLTR > PAN > LVL) into one stereo gain. A.context plays it on this
  // computer (A.sinkId: the output chosen under Play on, '' the default); hwpreview.js swaps in its own context
  // with A.useOutput to play on the S-4 (its tracks, or this same mix on its main out).
  A.sinkId = '';
  A.makeChains = function (ctx) {
    const out = ctx.createGain(), chains = [];
    out.gain.value = 0.9;
    for (let i = 0; i < 4; i++) {
      const input = ctx.createGain(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      // the S-4's pan (A.panGains): a gain per side, mono sources upmixed to both
      input.channelCount = 2; input.channelCountMode = 'explicit'; input.channelInterpretation = 'speakers';
      const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
      const p = { L: ctx.createGain(), R: ctx.createGain() };
      f.type = 'lowpass'; f.frequency.value = 22000; f.Q.value = 0.8;
      input.connect(f); f.connect(split);
      split.connect(p.L, 0); split.connect(p.R, 1);
      p.L.connect(merge, 0, 0); p.R.connect(merge, 0, 1);
      merge.connect(g); g.connect(out);
      chains.push({ input, f, p, g });
    }
    return { chains, out };
  };
  A.context = function () {
    if (!A.appOut) {
      const AC = window.AudioContext || window.webkitAudioContext;
      let ctx;
      try { ctx = A.sinkId ? new AC({ sinkId: A.sinkId }) : new AC(); } catch (e) { ctx = new AC(); } // the chosen output is gone
      const { chains, out } = A.makeChains(ctx);
      out.connect(ctx.destination);
      A.appOut = { ctx, chains, out };
    }
    if (!A.ctx) A.useOutput(null);
    return A.ctx;
  };
  // the output on this computer the app's own mix plays on ('' the default)
  A.setSink = async function (id) {
    A.sinkId = id || '';
    if (A.appOut && A.appOut.ctx.setSinkId) {
      try { await A.appOut.ctx.setSinkId(A.sinkId); } catch (e) { /* gone: it stays where it was */ }
    }
  };
  // o: { ctx, chains, out } to play through, or null for the app's own output. Chains marked hw only
  // apply mute/solo and the device LEVEL; the hardware does the mixing.
  A.useOutput = function (o) {
    if (A.ctx) { A.stop(); A.stopHear(); }
    const t = o || A.appOut || { ctx: null, chains: [], out: null }; // no app output yet: A.context() makes it
    A.ctx = t.ctx; A.chains = t.chains; A.out = t.out; A.hw = !!(o && o.chains.some(c => c.hw));
    S4.emit('audio-output');
  };
  A.resume = function () {
    const c = A.context();
    if (c.state !== 'running') c.resume();
    return c;
  };

  // ---------- samples ----------
  A.decode = async function (id, bytes) {
    const buf = await A.context().decodeAudioData(bytes.slice(0));
    A.bufs.set(id, buf);
    A.peaks.set(id, peaksOf(buf, 2048));
    S4.emit('sample-ready', id);
    return buf;
  };
  A.need = function (id) {
    if (A.bufs.has(id)) return Promise.resolve(A.bufs.get(id));
    if (A.loading.has(id)) return A.loading.get(id);
    const p = S4.idb.get(id).then(rec => {
      if (!rec) throw new Error('sample missing from this browser');
      return A.decode(id, rec.bytes);
    });
    A.loading.set(id, p);
    p.catch(() => {}).then(() => A.loading.delete(id));
    return p;
  };

  function peaksOf(buf, n) {
    const len = buf.length, chs = [];
    for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
    const out = new Float32Array(n * 2);
    const per = len / n, stride = Math.max(1, Math.floor(per / 64));
    let norm = 0;
    for (let i = 0; i < n; i++) {
      let mn = 0, mx = 0;
      const a = Math.floor(i * per), b = Math.min(len, Math.floor((i + 1) * per));
      for (let j = a; j < b; j += stride) {
        let s = 0;
        for (let c = 0; c < chs.length; c++) s += chs[c][j];
        s /= chs.length;
        if (s < mn) mn = s;
        if (s > mx) mx = s;
      }
      out[i * 2] = mn; out[i * 2 + 1] = mx;
      norm = Math.max(norm, -mn, mx);
    }
    out.norm = norm || 1;
    return out;
  }

  // Draw a waveform. o: { hiFrom, hiTo } fractions of the sample drawn bright.
  A.draw = function (canvas, id, o = {}) {
    const w = canvas.clientWidth, ht = canvas.clientHeight;
    if (!w || !ht) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(ht * dpr);
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, ht);
    const pk = A.peaks.get(id);
    if (!pk) return;
    const n = pk.length / 2, mid = ht / 2, amp = (ht / 2) * 0.9 / pk.norm;
    const lo = o.hiFrom != null ? o.hiFrom : 0, hi = o.hiTo != null ? o.hiTo : 1;
    // the track's colour inside the region, a quiet line colour outside (both from the theme)
    const cs = getComputedStyle(canvas);
    const on = o.color || cs.getPropertyValue('--kc').trim() || '#888', off = cs.getPropertyValue('--rule2').trim() || '#ccc';
    for (let x = 0; x < w; x++) {
      const fa = x / w, fb = (x + 1) / w;
      let mn = 0, mx = 0;
      for (let i = Math.floor(fa * n), e = Math.min(n - 1, Math.floor(fb * n)); i <= e; i++) {
        if (pk[i * 2] < mn) mn = pk[i * 2];
        if (pk[i * 2 + 1] > mx) mx = pk[i * 2 + 1];
      }
      g.fillStyle = fa >= lo && fa < hi ? on : off;
      const y0 = mid - mx * amp, y1 = mid - mn * amp;
      g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
  };

  // Trimmed + faded copy of a track's sample, padded with silence to whole beats
  // (the S-4 also pads DISC loops up to the grid when loading).
  A.derived = function (tr) {
    const s = tr.sample;
    if (!s) return null;
    const raw = A.bufs.get(s.id);
    if (!raw) return null;
    const key = [s.id, tr.trimIn, tr.trimOut, tr.fadeIn, tr.fadeOut, s.bpm].join('|');
    let d = A.dcache.get(key);
    if (d) return d;
    const sr = raw.sampleRate;
    const a = Math.floor(tr.trimIn * raw.length), b = Math.max(a + 1, Math.floor(tr.trimOut * raw.length));
    const n = b - a;
    let len = n;
    if (s.bpm) {
      const beat = (60 / s.bpm) * sr;
      len = Math.max(n, Math.round(Math.ceil(n / beat - 1e-3) * beat));
    }
    d = new AudioBuffer({ length: len, numberOfChannels: raw.numberOfChannels, sampleRate: sr });
    const fi = Math.min(n, Math.round((tr.fadeIn / 1000) * sr)), fo = Math.min(n, Math.round((tr.fadeOut / 1000) * sr));
    for (let c = 0; c < raw.numberOfChannels; c++) {
      const dst = d.getChannelData(c);
      dst.set(raw.getChannelData(c).subarray(a, b));
      for (let i = 0; i < fi; i++) dst[i] *= i / fi;
      for (let i = 0; i < fo; i++) dst[n - 1 - i] *= i / fo;
    }
    if (A.dcache.size > 24) A.dcache.clear();
    A.dcache.set(key, d);
    return d;
  };

  // Loop region of a track, in seconds of its (trimmed, padded) sample.
  A.loopRegion = function (tr) {
    const d = A.derived(tr);
    if (!d) return null;
    const dur = d.duration, sb = tr.sample.bpm || 0;
    let ls = 0, le = dur;
    if (tr.device === 'POLY') {
      ls = (dur * (tr.pStart || 0)) / 100;
      le = Math.min(dur, ls + (dur * (tr.pLen != null ? tr.pLen : 100)) / 100);
    } else if (sb) {
      const beat = 60 / sb;
      ls = Math.min(dur - 0.005, (tr.start || 0) * beat);
      le = tr.length ? Math.min(dur, ls + tr.length * beat) : dur;
    }
    if (le - ls < 0.005) le = Math.min(dur, ls + 0.005);
    return { d, ls, le };
  };

  // STRETCH (tempo and pitch apart, see warp.js) works on DISC, which the S-4 can also do itself, and on
  // TAPE, where the app renders it.
  A.canStretch = tr => tr.device === 'DISC' || tr.device === 'TAPE';
  // Warp algorithm of a STRETCH track: beats | tones | complex, or s4 (DISC only: the S-4 stretches it
  // live; previewed with TONES). Tracks imported from an S-4 project keep the S-4's own stretch.
  A.warpMode = tr => {
    const w = tr.warp || (tr.s4raw ? 's4' : 'beats');
    return w === 's4' ? (tr.device === 'DISC' ? 's4' : 'beats') : S4.warp.MODES.includes(w) ? w : 'beats';
  };
  // Semitones a STRETCH track is transposed by: PITCH, FINE (cents; the S-4's own stretch has none) and
  // the shift into the project key.
  A.stretchSemis = tr => (tr.pitchSt || 0) + (A.warpMode(tr) === 's4' ? 0 : (tr.cents || 0) / 100) + S4.analysis.trackShift(tr, proj().key);

  // Loop region, buffer and playback rate for a track at the project tempo.
  //   SYNC     varispeed: rate = project / sample tempo (pitch follows), SPEED in octaves (TAPE: semitones)
  //   STRETCH  the sample is warped to the project tempo and transposed by PITCH + FINE + key shift,
  //            played at rate 1; scale = how much longer the played buffer is than the sample. Until the
  //            background render is ready it plays varispeed (approx) and is swapped when it arrives.
  //   AS RECORDED plays at its own speed (SPEED in octaves for DISC, semitones for TAPE)
  A.timing = function (tr, bpm) {
    const r = A.loopRegion(tr);
    if (!r) return null;
    const sb = tr.sample.bpm || 0;
    let { ls, le } = r, buf = r.d, rate = 1, scale = 1, approx = false, waiting = false;
    if (tr.device === 'POLY') rate = Math.pow(2, (tr.pitch || 0) / 12);
    else if (A.canStretch(tr) && tr.tempo === 'stretch' && sb) {
      const F = sb / bpm, semis = A.stretchSemis(tr);
      const st = A.warped(r.d, F, semis, A.warpMode(tr));
      if (st && st !== true) { buf = st; scale = F; ls *= F; le = Math.min(st.duration, le * F); }
      else { rate = (bpm / sb) * Math.pow(2, semis / 12); approx = true; waiting = st === true; }
    } else {
      if (tr.tempo === 'sync' && sb) rate = bpm / sb;
      // DISC SPEED in a scale (or FREE) mode holds semitones (speedSt) instead of octaves
      const dSemis = tr.dspMode && tr.dspMode !== 'octaves';
      rate *= tr.device === 'DISC' ? (dSemis ? Math.pow(2, (tr.speedSt || 0) / 12) : Math.pow(2, tr.speed || 0)) : Math.pow(2, (tr.speed || 0) / 12);
    }
    return { buf, rate, ls, le, len: le - ls, real: (le - ls) / rate, scale, approx, waiting };
  };

  // Warped copies, rendered in a background worker and cached (most recently used kept). Returns the
  // buffer, true while its render is under way, or null when it will not be rendered here (very long
  // files, or a failed render): those preview with varispeed.
  A.STRETCH_MAX_SECONDS = 150;
  const wcache = new Map(), wpending = new Set(), wfailed = new Set();
  let sid = 0;
  A.warped = function (d, F, semis, mode) {
    if (mode === 's4') mode = 'tones';
    if (Math.abs(F - 1) < 1e-6 && Math.abs(semis) < 1e-6) return d;
    if (d.duration > A.STRETCH_MAX_SECONDS) return null;
    if (!d.__sid) d.__sid = ++sid;
    const key = [d.__sid, mode, F.toFixed(6), semis.toFixed(4)].join('|');
    const hit = wcache.get(key);
    if (hit) { wcache.delete(key); wcache.set(key, hit); return hit; }
    if (wfailed.has(key)) return null;
    if (!wpending.has(key)) {
      wpending.add(key);
      S4.warp.renderAsync(d, { stretch: F, semis, mode })
        .then(b => { wcache.set(key, b); while (wcache.size > 16) wcache.delete(wcache.keys().next().value); })
        .catch(e => { console.error(e); wfailed.add(key); })
        .then(() => { wpending.delete(key); warpReady(); });
    }
    return true;
  };
  A.warpBusy = () => wpending.size > 0;
  // A render finished: swap it in for voices still playing their varispeed stand-in.
  function warpReady() {
    if (A.ctx) {
      if (A.playing) A.voices.forEach((v, i) => { if (v && !v.dead && v.tm && v.tm.waiting) A.restartTrack(i); });
      const hv = A.hearVoice;
      if (A.hearing >= 0 && hv && hv.tm && hv.tm.waiting) { const h = A.hearing; A.stopHear(); A.hear(h); }
    }
    S4.emit('warp-ready');
  }

  // Work out (and cache) every track's buffer for a scene before its start time is fixed,
  // so a slow stretch can't push one track late.
  A.prepare = function (idx) {
    const sc = idx >= 0 ? proj().scenes[idx] : null;
    if (sc) sc.tracks.forEach(tr => { if (tr.sample && A.bufs.has(tr.sample.id)) A.timing(tr, proj().bpm); });
  };

  // ---------- mixing ----------
  const proj = () => S4.cr.proj;
  const sceneAt = i => (i >= 0 ? proj().scenes[i] : null);

  // Track i of a scene through the project mixer: mixer LVL (dB) on top of the scene's device LEVEL,
  // mixer PAN and FLTR, mixer mute/solo.
  // The S-4 mixer's pan law, measured (VERIFY2 / VERIFY3): exactly centred is unity on both sides; otherwise
  // each side gets 2·cos / 2·sin of (pan + 1)·π/4, so a hard pan doubles that side (+6.02 dB) and ±0.5 gives
  // +5.33 / -2.32 dB. Measured at -1, -0.5, 0, +0.5, +1.
  A.panGains = p => (p === 0 ? [1, 1] : [2 * Math.cos(((p + 1) * Math.PI) / 4), 2 * Math.sin(((p + 1) * Math.PI) / 4)]);
  A.applyMix = function (i, tr) {
    if (!A.ctx || !tr) return;
    const mix = proj().mix, mt = mix.tracks[i];
    const anySolo = mix.tracks.some(t => t.solo);
    const c = A.chains[i], t = A.ctx.currentTime;
    const muted = mt.mute || (anySolo && !mt.solo);
    if (c.hw) { c.g.gain.setTargetAtTime(muted ? 0 : A.dbToGain(tr.lvl), t, 0.012); return; }
    c.g.gain.setTargetAtTime(muted ? 0 : A.dbToGain(mt.lvl) * A.dbToGain(tr.lvl), t, 0.012);
    const [pl, pr] = A.panGains(S4.clamp(mt.pan / 64, -1, 1));
    c.p.L.gain.setTargetAtTime(pl, t, 0.012);
    c.p.R.gain.setTargetAtTime(pr, t, 0.012);
    const v = mt.fltr;
    if (v < -1) { c.f.type = 'lowpass'; c.f.frequency.setTargetAtTime(20000 * Math.pow(2, (v / 64) * 9.6), t, 0.012); }
    else if (v > 1) { c.f.type = 'highpass'; c.f.frequency.setTargetAtTime(20 * Math.pow(2, (v / 63) * 9.6), t, 0.012); }
    else { c.f.type = 'lowpass'; c.f.frequency.setTargetAtTime(22000, t, 0.012); }
  };
  A.applySceneMix = function (idx) {
    const sc = sceneAt(idx);
    if (sc) sc.tracks.forEach((tr, i) => A.applyMix(i, tr));
  };
  // The project mixer changed: update whatever is sounding.
  A.mixChanged = function () {
    if (!A.ctx) return;
    if (A.playing) A.applySceneMix(A.cur);
    else if (A.hearing >= 0) A.applySceneMix(S4.cr.sel.scene);
  };

  // ---------- voices ----------
  const barDur = () => (4 * 60) / proj().bpm;

  function startVoice(i, tr, when, offset) {
    if (tr.device === 'BYPASS') return null; // live input on the S-4: nothing to play here
    const tm = A.timing(tr, proj().bpm);
    if (!tm) return null;
    if (tr.device === 'POLY') return { poly: true, tr, tm, next: when, hits: [] };
    const src = A.ctx.createBufferSource();
    src.buffer = tm.buf;
    src.playbackRate.value = tm.rate;
    src.loop = true;
    src.loopStart = tm.ls;
    src.loopEnd = tm.le;
    src.connect(A.chains[i].input);
    src.start(when, tm.ls + ((offset * tm.rate) % tm.len));
    return { src, tr, tm, ref: when - offset, started: when };
  }

  function polyHit(i, v, when, once) {
    const tr = v.tr, tm = v.tm;
    const src = A.ctx.createBufferSource();
    src.buffer = tm.buf;
    src.playbackRate.value = tm.rate;
    const g = A.ctx.createGain();
    // the S-4's POLY envelope in its own units (seconds, 0-1)
    const env = (tr.mx && tr.mx.POLY) || {};
    const att = Math.max(0.002, env.attack != null ? env.attack : 0.005);
    const dec = Math.max(0.01, env.decay != null ? env.decay : 0.2);
    const sus = env.sustain != null ? env.sustain : 0.5;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(1, when + att);
    g.gain.setTargetAtTime(sus, when + att, dec / 3);
    src.connect(g);
    g.connect(A.chains[i].input);
    if (tr.loopMode !== 'off' && !once) {
      src.loop = true; src.loopStart = tm.ls; src.loopEnd = tm.le;
      src.start(when, tm.ls);
      src.stop(when + barDur());
    } else {
      src.start(when, tm.ls, tm.len); // duration is in buffer time
    }
    v.hits = v.hits.filter(x => x.end > A.ctx.currentTime);
    v.hits.push({ src, end: when + tm.real + 4 });
    return src;
  }

  function stopVoice(v, T) {
    if (!v) return;
    v.dead = true;
    try { if (v.src) v.src.stop(T); } catch (e) { /* already stopped */ }
    if (v.hits) v.hits.forEach(x => { try { x.src.stop(T); } catch (e) { /* noop */ } });
  }

  function sceneLength(sc) {
    if (!sc) return barDur();
    let bars = 1;
    sc.tracks.forEach(tr => {
      if (!tr.sample || !A.bufs.has(tr.sample.id) || tr.device === 'POLY' || tr.device === 'BYPASS') return;
      const tm = A.timing(tr, proj().bpm);
      if (tm) bars = Math.max(bars, Math.ceil(tm.real / barDur() - 0.02));
    });
    return bars * barDur();
  }

  function loadMissing(idx) {
    const sc = sceneAt(idx);
    if (!sc) return;
    sc.tracks.forEach((tr, i) => {
      if (tr.sample && !A.bufs.has(tr.sample.id)) {
        A.need(tr.sample.id).then(() => { if (A.playing && A.cur === idx) A.restartTrack(i); }).catch(() => {});
      }
    });
  }

  A.launch = function (idx, T) {
    const sc = sceneAt(idx);
    A.voices.forEach(v => stopVoice(v, T));
    A.voices = [0, 1, 2, 3].map(i => {
      const tr = sc && sc.tracks[i];
      return tr && tr.sample && A.bufs.has(tr.sample.id) ? startVoice(i, tr, T, 0) : null;
    });
    A.cur = idx;
    A.curStart = T;
    A.curLen = sceneLength(sc);
    A.applySceneMix(idx);
    S4.emit('audio-launch', idx, T);
    loadMissing(idx);
    setTimeout(() => S4.emit('audio-scene'), Math.max(0, (T - A.ctx.currentTime) * 1000));
    // Without LOOP the next scene follows on its own: get its audio ready now.
    if (!proj().loop) setTimeout(() => { if (A.playing && A.cur === idx) A.prepare(nextScene(idx)); }, 50);
  };

  A.restartTrack = function (i) {
    if (!A.playing) return;
    const sc = sceneAt(A.cur);
    if (sc && sc.tracks[i] && sc.tracks[i].sample && A.bufs.has(sc.tracks[i].sample.id)) A.timing(sc.tracks[i], proj().bpm);
    const now = A.ctx.currentTime + 0.03;
    const T = Math.max(now, A.curStart);
    stopVoice(A.voices[i], T);
    const tr = sc && sc.tracks[i];
    A.voices[i] = tr && tr.sample && A.bufs.has(tr.sample.id) ? startVoice(i, tr, T, T - A.curStart) : null;
    if (A.voices[i] && A.voices[i].poly) {
      const bd = barDur();
      A.voices[i].next = A.curStart + Math.ceil((T - A.curStart) / bd) * bd;
    }
    A.curLen = sceneLength(sc);
    A.applySceneMix(A.cur);
  };

  // Called by the editor when a track of scene `idx` changed. structural=false for mix-only changes.
  const restartTimers = {};
  A.trackChanged = function (idx, i, structural = true) {
    if (!A.ctx) return;
    if (!structural) {
      if ((A.playing && A.cur === idx) || (A.hearing >= 0 && S4.cr.sel.scene === idx)) A.applySceneMix(idx);
      return;
    }
    clearTimeout(restartTimers[i]);
    restartTimers[i] = setTimeout(() => {
      if (A.playing && A.cur === idx) A.restartTrack(i);
      if (A.hearing === i && S4.cr.sel.scene === idx) { const h = A.hearing; A.stopHear(); A.hear(h); }
    }, 90);
  };

  // ---------- transport ----------
  const QUANT = { NOW: 0, BEAT: 0.25, BAR: 1, '2BAR': 2 };
  A.play = function (idx) {
    A.stopHear();
    A.resume();
    A.prepare(idx);
    const T = A.ctx.currentTime + 0.08;
    A.playing = true;
    A.t0 = T;
    A.pending = null;
    A.launch(idx, T);
    startTimer();
    S4.emit('audio-transport');
  };
  A.stop = function () {
    A.voices.forEach(v => stopVoice(v, 0));
    A.voices = [null, null, null, null];
    A.playing = false;
    A.pending = null;
    A.cur = -1;
    if (A.hearing < 0) stopTimer();
    S4.emit('audio-transport');
    S4.emit('audio-scene');
  };
  // Switch scenes on the beat without stopping.
  A.queue = function (idx) {
    if (!A.playing) return;
    A.prepare(idx);
    const q = QUANT[proj().launch] != null ? QUANT[proj().launch] * barDur() : barDur();
    const now = A.ctx.currentTime;
    if (!q) { A.t0 = now + 0.05; A.pending = { idx, T: A.t0 }; }
    else A.pending = { idx, T: A.t0 + Math.ceil((now + 0.06 - A.t0) / q) * q };
    S4.emit('audio-scene');
  };
  A.tempoChanged = function () {
    if (A.playing) { const idx = A.cur; A.play(idx); }
  };

  function nextScene(idx) {
    const sc = proj().scenes;
    for (let k = 1; k <= 128; k++) {
      const j = (idx + k) % 128;
      if (sc[j] && sc[j].tracks.some(t => t.sample)) return j;
    }
    return -1;
  }

  function tick() {
    if (!A.ctx) return;
    const now = A.ctx.currentTime;
    if (A.playing) {
      if (A.pending && now >= A.pending.T - 0.1) {
        const p = A.pending;
        A.pending = null;
        A.launch(p.idx, p.T);
      }
      if (!proj().loop && !A.pending && now >= A.curStart + A.curLen - 0.15) {
        const nx = nextScene(A.cur);
        if (nx >= 0) { A.pending = { idx: nx, T: A.curStart + A.curLen }; S4.emit('audio-scene'); }
      }
      const bd = barDur();
      A.voices.forEach((v, i) => {
        if (!v || !v.poly || v.dead) return;
        while (v.next < now + 0.12) { polyHit(i, v, v.next); v.next += bd; }
      });
    }
  }
  function startTimer() { if (!A.timer) A.timer = setInterval(tick, 25); }
  function stopTimer() { clearInterval(A.timer); A.timer = null; }

  // ---------- audition one track ----------
  A.hear = function (i) {
    if (A.hearing === i) return A.stopHear();
    if (A.playing) A.stop();
    A.stopHear();
    const sc = sceneAt(S4.cr.sel.scene), tr = sc && sc.tracks[i];
    if (!tr || !tr.sample || tr.device === 'BYPASS') return;
    A.resume();
    S4.emit('audio-hear', S4.cr.sel.scene, i);
    A.need(tr.sample.id).then(() => {
      A.timing(tr, proj().bpm); // stretch (if any) before the start time is fixed
      const T = A.ctx.currentTime + 0.04;
      A.hearing = i;
      const v = startVoice(i, tr, T, 0);
      if (v && v.poly) {
        const src = polyHit(i, v, T, true);
        src.onended = () => { if (A.hearVoice === v) A.stopHear(); };
      }
      A.hearVoice = v;
      A.applySceneMix(S4.cr.sel.scene);
      S4.emit('audio-transport');
    }).catch(e => S4.toast(e.message, 'err'));
  };
  A.stopHear = function () {
    if (A.hearing < 0) return;
    stopVoice(A.hearVoice, 0);
    A.hearVoice = null;
    A.hearing = -1;
    if (!A.playing) stopTimer();
    S4.emit('audio-transport');
  };

  // Playhead as a fraction of the full (untrimmed) sample, or null.
  A.position = function (i) {
    if (!A.ctx) return null;
    const v = A.hearing === i ? A.hearVoice : A.playing ? A.voices[i] : null;
    if (!v || !v.src || v.dead) return null;
    const now = A.ctx.currentTime;
    if (now < v.started) return null;
    const tm = v.tm, raw = A.bufs.get(v.tr.sample.id);
    if (!raw) return null;
    const pos = (tm.ls + (((now - v.ref) * tm.rate) % tm.len)) / (tm.scale || 1); // back to sample seconds
    return S4.clamp((v.tr.trimIn * raw.duration + pos) / raw.duration, 0, 1);
  };

  // ---------- export ----------
  // channels: force a channel count (mono is copied to both sides when 2). Other sample rates are converted
  // with the warp engine's windowed-sinc resampler.
  A.renderWav = async function (buf, sr = 48000, channels) {
    const chs = [];
    for (let c = 0; c < (channels || buf.numberOfChannels); c++) chs.push(buf.getChannelData(Math.min(c, buf.numberOfChannels - 1)));
    const n = Math.max(1, Math.round((buf.length * sr) / buf.sampleRate));
    return encodeWav(buf.sampleRate === sr ? chs : chs.map(c => S4.warp.resample(c, buf.sampleRate / sr, n)), sr, 24);
  };
  A.encodeWav = (chs, sr, bits) => encodeWav(chs, sr, bits);
  function encodeWav(chs, sr, bits) {
    const nch = chs.length, len = chs[0].length, bps = bits / 8;
    const dataLen = len * nch * bps;
    const ab = new ArrayBuffer(44 + dataLen), dv = new DataView(ab);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); str(8, 'WAVE');
    str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, nch, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * nch * bps, true); dv.setUint16(32, nch * bps, true); dv.setUint16(34, bits, true);
    str(36, 'data'); dv.setUint32(40, dataLen, true);
    const u8 = new Uint8Array(ab);
    let o = 44;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < nch; c++) {
        const s = Math.max(-1, Math.min(1, chs[c][i]));
        const v = Math.round(s < 0 ? s * 0x800000 : s * 0x7FFFFF);
        u8[o] = v & 255; u8[o + 1] = (v >> 8) & 255; u8[o + 2] = (v >> 16) & 255;
        o += 3;
      }
    }
    return u8;
  }
})(window.S4);
