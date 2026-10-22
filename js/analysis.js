'use strict';
// Audio analysis and processing for Build:
//   tempo(buf)          tempo detection from the audio (onset envelope + autocorrelation)
//   stretch(buf, f)     time-stretch keeping pitch (WSOLA), f > 1 = longer
//   keyShift / trackShift  semitones to move a sample's key into the project key
(function (S4) {
  const AN = S4.analysis = {};

  // ---------- keys ----------
  const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  // Minor keys are compared through their relative major (Am ~ C), so Am -> C is no shift.
  const keyRoot = k => { const minor = k.endsWith('m'); const i = NOTES.indexOf(minor ? k.slice(0, -1) : k); return i < 0 ? null : minor ? (i + 3) % 12 : i; };
  AN.keyShift = function (from, to) {
    const a = keyRoot(from), b = keyRoot(to);
    if (a == null || b == null) return 0;
    const d = (((b - a) % 12) + 12) % 12;
    return d > 6 ? d - 12 : d; // smallest move, -5..+6
  };
  // Shift applied to a track: only with a project key, a known sample key, and FOLLOW KEY on.
  AN.trackShift = (tr, projKey) =>
    tr && tr.sample && tr.sample.key && projKey && projKey !== 'NONE' && tr.followKey !== false ? AN.keyShift(tr.sample.key, projKey) : 0;

  // ---------- helpers ----------
  function mono(buf, maxSec) {
    const n = Math.min(buf.length, Math.round(maxSec * buf.sampleRate));
    const out = new Float32Array(n), nch = buf.numberOfChannels;
    for (let c = 0; c < nch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i] / nch; }
    return out;
  }

  // ---------- FFT ----------
  // In-place radix-2 complex FFT; inv = true gives the inverse without the 1/n scaling.
  const fftTabs = new Map();
  function fftTables(n) {
    let t = fftTabs.get(n);
    if (t) return t;
    const bits = Math.round(Math.log2(n)), rev = new Uint32Array(n), cos = new Float64Array(n >> 1), sin = new Float64Array(n >> 1);
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
    for (let i = 0; i < n >> 1; i++) { cos[i] = Math.cos((-2 * Math.PI * i) / n); sin[i] = Math.sin((-2 * Math.PI * i) / n); }
    fftTabs.set(n, (t = { rev, cos, sin }));
    return t;
  }
  AN.fft = function (re, im, inv) {
    const n = re.length, { rev, cos, sin } = fftTables(n);
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const c = cos[k], s = inv ? -sin[k] : sin[k], a = i + j, b = a + half;
          const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
  };
  AN.hann = n => { const w = new Float32Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n); return w; };

  // ---------- key ----------
  // Spectral peaks (55 Hz - 2.1 kHz, ~3 Hz resolution) give a tuning offset and a 12-bin chroma, which
  // is matched against major/minor key profiles. Returns { key, confidence, tonal, tuning (cents), chroma }.
  const PROFILES = {
    kk: [[6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]],
    temperley: [[5, 2, 3.5, 2, 4.5, 4, 2, 4.5, 2, 3.5, 1.5, 4], [5, 2, 3.5, 4.5, 2, 4, 2, 4.5, 3.5, 2, 1.5, 4]],
  };
  const corr = (a, b) => {
    let ma = 0, mb = 0;
    for (let i = 0; i < 12; i++) { ma += a[i]; mb += b[i]; }
    ma /= 12; mb /= 12;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < 12; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
    return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
  };
  AN.keyPeaks = function (buf, lo = AN._keyLo || 27) {
    const sr = buf.sampleRate, x = mono(buf, 120);
    const N = 1 << Math.round(Math.log2(sr / 3)), hop = N >> 2, win = AN.hann(N);
    const k0 = Math.max(3, Math.floor((lo * N) / sr)), k1 = Math.min((N >> 1) - 2, Math.ceil((2100 * N) / sr));
    const re = new Float64Array(N), im = new Float64Array(N), mag = new Float32Array(k1 + 3);
    const pitch = [], weight = [];
    for (let s = 0; s + N <= Math.max(N, x.length); s += hop) {
      for (let i = 0; i < N; i++) { re[i] = (x[s + i] || 0) * win[i]; im[i] = 0; }
      AN.fft(re, im);
      for (let k = k0 - 2; k <= k1 + 2; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      // local average over about a third of an octave, for a whitened peak threshold
      for (let k = k0; k <= k1; k++) {
        const m = mag[k];
        if (!(m > mag[k - 1] && m >= mag[k + 1] && m > mag[k - 2] && m >= mag[k + 2])) continue;
        const span = Math.max(3, Math.round(k * 0.12));
        let avg = 0, c = 0;
        for (let j = Math.max(1, k - span); j <= Math.min(k1 + 2, k + span); j++) { avg += mag[j]; c++; }
        avg /= c;
        if (m < 2.5 * avg) continue;
        const a = Math.log(mag[k - 1] + 1e-12), b = Math.log(m + 1e-12), g = Math.log(mag[k + 1] + 1e-12);
        const d = a - 2 * b + g ? (0.5 * (a - g)) / (a - 2 * b + g) : 0;
        const f = ((k + d) * sr) / N;
        pitch.push(69 + 12 * Math.log2(f / 440));
        weight.push(m - avg);
      }
    }
    return { pitch, weight };
  };
  AN.key = function (buf, opts = {}) {
    if (buf.duration < 0.5) return null;
    const { pitch, weight } = opts.peaks || AN.keyPeaks(buf);
    if (!pitch.length) return null;
    // Tuning: weighted circular mean of each peak's distance from the A440 grid, from 110 Hz up (a kick's
    // falling pitch says little about tuning). Used for the chroma only when it is consistent.
    let sc = 0, ss = 0, sw = 0;
    for (let i = 0; i < pitch.length; i++) {
      if (pitch[i] < 45) continue;
      const t = 2 * Math.PI * pitch[i];
      sc += weight[i] * Math.cos(t); ss += weight[i] * Math.sin(t); sw += weight[i];
    }
    const tuning = sw ? Math.atan2(ss, sc) / (2 * Math.PI) : 0; // semitones, -0.5..0.5
    const tuningStrength = sw ? Math.hypot(sc, ss) / sw : 0;
    const grid = tuningStrength >= (AN._tuneMin != null ? AN._tuneMin : 0.6) ? tuning : 0;
    const chroma = new Array(12).fill(0);
    for (let i = 0; i < pitch.length; i++) {
      const q = pitch[i] - grid, r = Math.round(q), dev = q - r;
      chroma[((r % 12) + 12) % 12] += weight[i] * Math.cos(Math.PI * dev) ** 2;
    }
    // Profile match. A single dominant note (a tuned kick) fits its major and minor key almost equally;
    // loops are far more often minor, so minor gets a small head start.
    const prof = PROFILES[opts.profile || 'kk'], minorBias = AN._minorBias != null ? AN._minorBias : 0.03;
    let best = null, second = null;
    for (let mode = 0; mode < 2; mode++) {
      for (let root = 0; root < 12; root++) {
        const rot = new Array(12);
        for (let i = 0; i < 12; i++) rot[(i + root) % 12] = prof[mode][i];
        const c = corr(chroma, rot) + (mode ? minorBias : 0), k = NOTES[root] + (mode ? 'm' : '');
        if (!best || c > best.c) { second = best; best = { k, c }; } else if (!second || c > second.c) second = { k, c };
      }
    }
    // tonal: how peaked the chroma is (a flat, noisy chroma is ~1)
    const mx = Math.max(...chroma), mean = chroma.reduce((a, b) => a + b, 0) / 12;
    return {
      key: best.k, confidence: Math.round(best.c * 100) / 100, margin: Math.round((best.c - second.c) * 100) / 100,
      tonal: Math.round((mx / Math.max(1e-12, mean)) * 100) / 100, tuning: Math.round(tuning * 100),
      tuningStrength: Math.round(tuningStrength * 100) / 100, chroma,
    };
  };

  // ---------- tempo ----------
  // Onset strength every ~10 ms: rise in compressed energy of the differentiated signal,
  // minus its local average, half-wave rectified.
  function onsets(x, sr) {
    const hop = Math.round(sr * 0.01), n = Math.floor(x.length / hop);
    const c = new Float32Array(n);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      let e = 0;
      for (let j = i * hop, end = j + hop; j < end; j++) { const d = x[j] - prev; prev = x[j]; e += d * d; }
      c[i] = Math.log(1 + 1000 * e / hop);
    }
    const flux = new Float32Array(n);
    for (let i = 1; i < n; i++) flux[i] = Math.max(0, c[i] - c[i - 1]);
    const w = 25, o = new Float32Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += flux[i];
      if (i >= 2 * w) acc -= flux[i - 2 * w];
      const mean = acc / Math.min(i + 1, 2 * w);
      o[i] = Math.max(0, flux[i] - mean);
    }
    return { o, hopSec: hop / sr };
  }

  // Returns { bpm, confidence, loop, free, loopRatio } or null. loop: the tempo makes the file a whole
  // number of bars; free / loopRatio: the strongest pulse and how the whole-bar pick compares to it.
  // opts.near (e.g. the project tempo) settles half/double-time ambiguity.
  AN.tempo = function (buf, opts = {}) {
    const dur = buf.duration;
    if (dur < 1.5) return null;
    const { o, hopSec } = onsets(mono(buf, 60), buf.sampleRate);
    const n = o.length;
    // Lags up to half the file (so a long lag still overlaps half of it), and at least 4.8 s.
    const longLag = Math.min(n - 1, Math.max(Math.ceil(4.8 / hopSec), Math.floor(n / 2)));
    let mean = 0;
    for (let i = 0; i < n; i++) mean += o[i];
    mean /= n;
    const ac = new Float32Array(longLag + 2);
    for (let lag = 1; lag <= longLag + 1 && lag < n; lag++) {
      let s = 0;
      for (let i = 0; i + lag < n; i++) s += (o[i] - mean) * (o[i + lag] - mean);
      ac[lag] = s / (n - lag);
    }
    const acAt = l => { const i = Math.floor(l), f = l - i; return i + 1 < ac.length ? ac[i] * (1 - f) + ac[i + 1] * f : 0; };
    // Comb over the beat, half bar, bar, 2 and 4 bars (4/4). Grooves repeat by the bar, while a
    // dotted or 4:3 / 5:4 cross-pulse lines up with the bar only every third or fifth tooth, so the
    // bar-level teeth keep those from winning. A mild preference for tempos near 110 settles
    // half/double time.
    const TEETH = [1, 2, 4, 8, 16];
    const score = bpm => {
      const lag = 60 / bpm / hopSec;
      let s = 0, w = 0;
      for (const k of TEETH) if (k * lag <= longLag) { s += acAt(k * lag); w++; }
      return w ? s / w : 0;
    };
    const prior = bpm => Math.exp(-0.5 * Math.pow(Math.log2(bpm / 110) / 0.75, 2));
    let free = 0, bestS = -Infinity, sum = 0, sum2 = 0, cnt = 0;
    for (let bpm = 55; bpm <= 200; bpm += 0.25) {
      const s = score(bpm);
      sum += s; sum2 += s * s; cnt++;
      if (s * prior(bpm) > bestS) { bestS = s * prior(bpm); free = bpm; }
    }
    if (!(free > 0)) return null;
    // The search steps and the few teeth place the tempo only to about 1%. Refine it on every beat
    // up to 32: the beat grid must still line up 16 or 32 beats later.
    const longScore = b => {
      const lag = 60 / b / hopSec;
      let s = 0, m = 0;
      for (let k = 1; k <= 32 && k * lag <= longLag; k++, m++) s += acAt(k * lag);
      return m ? s / m : 0;
    };
    const peakNear = (b, w) => {
      let at = b, best = -Infinity;
      for (let x = b * (1 - w); x <= b * (1 + w); x += b * 0.0005) { const s = longScore(x); if (s > best) { best = s; at = x; } }
      return at;
    };
    free = peakNear(free, 0.025);
    // Loops are a whole number of bars, so the file length allows only a few tempos (a 22.6 s file is
    // 32 beats at 85, never 113.3). Strong dotted/polyrhythmic pulses can beat the real beat in the
    // free search; take the best whole-bar tempo unless its pulse is clearly weaker. A candidate only
    // counts when it sits on a peak of its own: in a file cut at an arbitrary length the whole-bar
    // tempos fall between the real pulses.
    const onPeak = b => Math.abs(peakNear(b, 0.03) / b - 1) < SNAP;
    let bpm = free, loop = false, loopBest = null;
    for (const beats of LOOP_BEATS) {
      const b = (beats * 60) / dur;
      if (b < 50 || b > 210 || !onPeak(b)) continue;
      const v = score(b) * prior(b);
      if (!loopBest || v > loopBest.v) loopBest = { bpm: b, v };
    }
    const loopRatio = loopBest ? score(loopBest.bpm) / Math.max(1e-12, score(free)) : 0;
    const wholeBars = LOOP_BEATS.find(n => Math.abs((free * dur) / 60 / n - 1) < SNAP);
    if (wholeBars) { bpm = (wholeBars * 60) / dur; loop = true; } // the strongest pulse already fits: snap exactly
    else if (loopBest && loopRatio >= (opts.loopRatio != null ? opts.loopRatio : LOOP_RATIO)) { bpm = loopBest.bpm; loop = true; }
    // Half or double time often fits almost as well (a 172 loop has a strong 86 pulse): switch when
    // that lands near the project tempo. The wrong octave would play the loop at twice or half speed,
    // so even a clearly weaker pulse wins there (a half-time 120 groove scores only 0.35 at 120).
    if (opts.near) {
      for (const k of [2, 0.5]) {
        const alt = bpm * k;
        if (alt >= 50 && alt <= 220 && Math.abs(Math.log(alt / opts.near)) < Math.log(1.15) && score(alt) >= NEAR_RATIO * score(bpm)) { bpm = alt; break; }
      }
    }
    const sd = Math.sqrt(Math.max(1e-12, sum2 / cnt - (sum / cnt) ** 2));
    const confidence = (score(bpm) - sum / cnt) / sd;
    return { bpm: Math.round(bpm * 10) / 10, confidence: Math.round(confidence * 100) / 100, loop, free, loopRatio: Math.round(loopRatio * 100) / 100 };
  };
  // Musical loop lengths in beats (1, 2, 3, 4, 6, 8, 12, 16, 24, 32 bars of 4/4).
  const LOOP_BEATS = [4, 8, 12, 16, 24, 32, 48, 64, 96, 128];
  const LOOP_RATIO = 0.5;
  const SNAP = 0.006; // how close (relative) a pulse must be to a whole-bar tempo to count as one
  const NEAR_RATIO = 0.3;

  // ---------- time-stretch (WSOLA) ----------
  // Each 40 ms frame is taken near its nominal position, at the offset that best continues the
  // previous frame, and overlap-added with a Hann window. Pitch is kept; length becomes length * f.
  AN.stretch = function (buf, f) {
    if (Math.abs(f - 1) < 1e-4) return buf;
    const sr = buf.sampleRate, nch = buf.numberOfChannels, inLen = buf.length;
    const N = (Math.round(sr * 0.04) >> 1) << 1, H = N / 2, Ha = H / f, tol = Math.round(sr * 0.008);
    const outLen = Math.max(1, Math.ceil(inLen * f));
    const out = new AudioBuffer({ length: outLen, numberOfChannels: nch, sampleRate: sr });
    const ins = [], outs = [];
    for (let c = 0; c < nch; c++) { ins.push(buf.getChannelData(c)); outs.push(out.getChannelData(c)); }
    const m = mono(buf, Infinity);
    const win = new Float32Array(N);
    for (let j = 0; j < N; j++) win[j] = 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / N);
    const norm = new Float32Array(outLen);
    let prevPos = 0;
    for (let k = 0; k * H < outLen; k++) {
      const outPos = k * H;
      let pos = Math.min(Math.round(k * Ha), Math.max(0, inLen - N));
      if (k > 0) {
        const nat = prevPos + H;
        if (nat + H < inLen) {
          let best = pos, bestC = -Infinity;
          for (let d = -tol; d <= tol; d += 2) {
            const c0 = pos + d;
            if (c0 < 0 || c0 + H >= inLen) continue;
            let c = 0;
            for (let j = 0; j < H; j += 4) c += m[nat + j] * m[c0 + j];
            if (c > bestC) { bestC = c; best = c0; }
          }
          pos = best;
        }
      }
      for (let j = 0; j < N; j++) {
        const i = pos + j, o = outPos + j;
        if (i >= inLen || o >= outLen) break;
        const w = win[j];
        for (let c = 0; c < nch; c++) outs[c][o] += ins[c][i] * w;
        norm[o] += w;
      }
      prevPos = pos;
    }
    for (let o = 0; o < outLen; o++) {
      const g = norm[o] > 0.05 ? 1 / norm[o] : 0;
      for (let c = 0; c < nch; c++) outs[c][o] *= g;
    }
    return out;
  };
})(window.S4);
