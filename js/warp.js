'use strict';
// Warping, like a DAW's clip warp modes: change a sample's tempo without its pitch, and its pitch without
// its tempo, rendered offline into a new AudioBuffer.
//   BEATS    slices at the transients. Each slice keeps its attack untouched (transposed by resampling the
//            slice, as a sampler would); the rest of the slice is stretched to fill its new slot, or cut
//            short when the slot shrinks. For drums and percussive loops.
//   TONES    WSOLA: overlapping 40 ms grains placed where they continue the waveform best. For single
//            voices, basses, simple material.
//   COMPLEX  phase vocoder with identity phase locking, a phase reset on transients and one phase track
//            shared by both channels (keeps the stereo image). For chords, pads and full mixes.
// Pitch shifting is "stretch by the pitch ratio, then resample", with a windowed-sinc resampler.
(function (S4) {
  const W = S4.warp = {};
  const AN = S4.analysis;
  W.MODES = ['beats', 'tones', 'complex'];
  W.LABELS = { beats: 'BEATS', tones: 'TONES', complex: 'COMPLEX', s4: 'S-4' };

  // ---------- resampling ----------
  // Blackman-windowed sinc, 16 zero crossings each side, tabulated. rate = input samples per output sample;
  // above 1 the kernel is widened so it also low-passes below the new Nyquist (no aliasing on pitch-up).
  // Polyphase: the kernel is tabulated for PHASES fractional positions, per rate (cached).
  const ZC = 16, PHASES = 512, ptabs = new Map();
  const kern = x => {
    const ax = Math.abs(x);
    if (ax >= ZC) return 0;
    const u = ax / ZC, sinc = ax ? Math.sin(Math.PI * ax) / (Math.PI * ax) : 1;
    return sinc * (0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u));
  };
  function polyTable(fc) {
    const key = fc.toFixed(6);
    let t = ptabs.get(key);
    if (t) return t;
    const half = Math.ceil(ZC / fc), taps = 2 * half, coef = new Float32Array((PHASES + 1) * taps);
    for (let p = 0; p <= PHASES; p++) {
      const frac = p / PHASES;
      for (let k = -half + 1; k <= half; k++) coef[p * taps + k + half - 1] = kern((k - frac) * fc) * fc;
    }
    if (ptabs.size > 24) ptabs.clear();
    ptabs.set(key, (t = { half, taps, coef }));
    return t;
  }
  W.resample = function (x, rate, outLen) {
    if (outLen == null) outLen = Math.max(1, Math.round(x.length / rate));
    const out = new Float32Array(outLen), n = x.length;
    const { half, taps, coef } = polyTable(Math.min(1, 1 / rate));
    for (let i = 0; i < outLen; i++) {
      const pos = i * rate, c = Math.floor(pos), base = Math.round((pos - c) * PHASES) * taps, j0 = c - half + 1;
      let s = 0;
      if (j0 >= 0 && j0 + taps <= n) for (let k = 0; k < taps; k++) s += x[j0 + k] * coef[base + k];
      else for (let k = Math.max(0, -j0); k < taps && j0 + k < n; k++) s += x[j0 + k] * coef[base + k];
      out[i] = s;
    }
    return out;
  };

  // ---------- WSOLA ----------
  // chs: Float32Array per channel; f: output length / input length. The grain offset is chosen on the
  // channel mix and applied to every channel.
  W.wsola = function (chs, f, sr, frameSec = 0.04) {
    const inLen = chs[0].length, nch = chs.length;
    const outLen = Math.max(1, Math.round(inLen * f));
    const out = chs.map(() => new Float32Array(outLen));
    if (Math.abs(f - 1) < 1e-6) { chs.forEach((c, i) => out[i].set(c.subarray(0, outLen))); return out; }
    const N = Math.max(64, (Math.round(sr * frameSec) >> 1) << 1), H = N / 2, Ha = H / f, tol = Math.round(sr * 0.008);
    const m = mix(chs), win = AN.hann(N), norm = new Float32Array(outLen);
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
        const w = k === 0 && j < H ? 1 : win[j]; // nothing before the first grain: start at full level
        for (let c = 0; c < nch; c++) out[c][o] += chs[c][i] * w;
        norm[o] += w;
      }
      prevPos = pos;
    }
    for (let o = 0; o < outLen; o++) {
      const g = norm[o] > 0.05 ? 1 / norm[o] : 0;
      for (let c = 0; c < nch; c++) out[c][o] *= g;
    }
    return out;
  };

  function mix(chs) {
    if (chs.length === 1) return chs[0];
    const n = chs[0].length, m = new Float32Array(n);
    for (const c of chs) for (let i = 0; i < n; i++) m[i] += c[i] / chs.length;
    return m;
  }

  // ---------- phase vocoder ----------
  // Two channels share one complex FFT (left real, right imaginary). The phase advance is worked out once,
  // on the channel mix, and every channel is rotated by the same amount, so their phase differences stay.
  W.pvoc = function (chs, f, sr) {
    const inLen = chs[0].length, nch = chs.length;
    const outLen = Math.max(1, Math.round(inLen * f));
    if (Math.abs(f - 1) < 1e-6) return chs.map(c => c.slice(0, outLen));
    const N = 1 << Math.round(Math.log2(sr * 0.085)), half = N >> 1, Hs = N >> 2, Ha = Hs / f;
    const win = AN.hann(N), pad = half;
    const L = chs[0], R = nch > 1 ? chs[1] : null;
    const re = new Float64Array(N), im = new Float64Array(N);
    const phPrev = new Float64Array(half + 1), synPrev = new Float64Array(half + 1);
    const mag = new Float64Array(half + 1), ph = new Float64Array(half + 1), syn = new Float64Array(half + 1);
    const lr = new Float64Array(half + 1), li = new Float64Array(half + 1), rr = new Float64Array(half + 1), ri = new Float64Array(half + 1);
    const peaks = new Int32Array(half + 1);
    const outL = new Float32Array(outLen + N + pad), outR = R ? new Float32Array(outLen + N + pad) : null, norm = new Float32Array(outLen + N + pad);
    // Transients, as input positions: the frame whose centre first passes one resets its phases.
    const trans = W.transients(mix(chs), sr);
    let ti = 1;
    const frames = Math.ceil((outLen + pad) / Hs) + 1;
    for (let t = 0; t < frames; t++) {
      const centre = Math.round(t * Ha), a = centre - pad; // analysis start (input centred on the frame)
      for (let i = 0; i < N; i++) {
        const j = a + i, w = win[i];
        re[i] = j >= 0 && j < inLen ? L[j] * w : 0;
        im[i] = R && j >= 0 && j < inLen ? R[j] * w : 0;
      }
      AN.fft(re, im);
      // unpack the two real spectra, and the mix spectrum for the phase track
      for (let k = 0; k <= half; k++) {
        const k2 = (N - k) & (N - 1);
        if (R) {
          lr[k] = 0.5 * (re[k] + re[k2]); li[k] = 0.5 * (im[k] - im[k2]);
          rr[k] = 0.5 * (im[k] + im[k2]); ri[k] = -0.5 * (re[k] - re[k2]);
        } else { lr[k] = re[k]; li[k] = im[k]; }
        const mr = R ? lr[k] + rr[k] : lr[k], mi = R ? li[k] + ri[k] : li[k];
        mag[k] = Math.hypot(mr, mi);
        ph[k] = Math.atan2(mi, mr);
      }
      // transient: reset the phases to the analysis phases so the attack stays sharp
      let transient = t === 0;
      while (ti < trans.length && trans[ti] <= centre) { transient = true; ti++; }
      if (transient) {
        for (let k = 0; k <= half; k++) syn[k] = ph[k];
      } else {
        // peaks, then each bin follows its nearest peak's phase (identity phase locking)
        let np = 0;
        for (let k = 1; k < half; k++) if (mag[k] > mag[k - 1] && mag[k] >= mag[k + 1]) peaks[np++] = k;
        if (!np) peaks[np++] = 1;
        for (let p = 0; p < np; p++) {
          const k = peaks[p], omega = (2 * Math.PI * k) / N;
          let d = ph[k] - phPrev[k] - omega * Ha;
          d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
          syn[k] = synPrev[k] + (omega + d / Ha) * Hs;
        }
        let p = 0;
        for (let k = 0; k <= half; k++) {
          while (p + 1 < np && Math.abs(peaks[p + 1] - k) < Math.abs(peaks[p] - k)) p++;
          const pk = peaks[p];
          if (k !== pk) syn[k] = syn[pk] + (ph[k] - ph[pk]);
        }
      }
      // rotate every channel by (synthesis - analysis) phase and rebuild one packed spectrum
      for (let k = 0; k <= half; k++) {
        const rot = k && k < half ? syn[k] - ph[k] : 0; // DC and Nyquist stay real
        const c = Math.cos(rot), s = Math.sin(rot);
        const yl_r = lr[k] * c - li[k] * s, yl_i = lr[k] * s + li[k] * c;
        if (R) {
          const yr_r = rr[k] * c - ri[k] * s, yr_i = rr[k] * s + ri[k] * c;
          // Z = Yl + i*Yr (both Hermitian), so Z[k] = Yl[k] + i Yr[k], Z[N-k] = conj(Yl[k]) + i conj(Yr[k])
          re[k] = yl_r - yr_i; im[k] = yl_i + yr_r;
          if (k && k < half) { re[N - k] = yl_r + yr_i; im[N - k] = -yl_i + yr_r; }
        } else {
          re[k] = yl_r; im[k] = yl_i;
          if (k && k < half) { re[N - k] = yl_r; im[N - k] = -yl_i; }
        }
        phPrev[k] = ph[k]; synPrev[k] = syn[k];
      }
      AN.fft(re, im, true);
      const o = t * Hs;
      for (let i = 0; i < N; i++) {
        const w = win[i], idx = o + i;
        if (idx >= outL.length) break;
        outL[idx] += (re[i] / N) * w;
        if (outR) outR[idx] += (im[i] / N) * w;
        norm[idx] += w * w;
      }
    }
    const res = [new Float32Array(outLen)];
    if (outR) res.push(new Float32Array(outLen));
    for (let i = 0; i < outLen; i++) {
      const j = i + pad, g = norm[j] > 1e-3 ? 1 / norm[j] : 0;
      res[0][i] = outL[j] * g;
      if (outR) res[1][i] = outR[j] * g;
    }
    // more than two channels: process the rest in pairs
    for (let c = 2; c < nch; c += 2) res.push(...W.pvoc(chs.slice(c, c + 2), f, sr));
    return res;
  };

  // ---------- transients ----------
  // Sample positions where a new sound starts: rises of the high-passed energy in 5 ms steps, above an
  // adaptive threshold and at least about 2.5x in energy (so a steady tone has none), at least 45 ms apart.
  W.transients = function (m, sr) {
    const hop = Math.round(sr * 0.005), n = Math.floor(m.length / hop);
    if (n < 4) return [0];
    const e = new Float32Array(n);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = i * hop, end = j + hop; j < end; j++) { const d = m[j] - prev; prev = m[j]; s += d * d; }
      e[i] = Math.log(1 + (1e4 * s) / hop);
    }
    const flux = new Float32Array(n);
    for (let i = 2; i < n; i++) flux[i] = Math.max(0, e[i] - Math.min(e[i - 1], e[i - 2]));
    let mx = 0;
    for (let i = 0; i < n; i++) mx = Math.max(mx, flux[i]);
    const out = [0], minGap = Math.round(0.045 / 0.005), w = 40;
    let last = -minGap;
    for (let i = 2; i < n - 1; i++) {
      if (!(flux[i] > flux[i - 1] && flux[i] >= flux[i + 1])) continue;
      let loc = 0;
      for (let j = Math.max(0, i - w); j < Math.min(n, i + w); j++) loc += flux[j];
      loc /= 2 * w;
      if (flux[i] < 0.9 || flux[i] < 0.12 * mx || flux[i] < 2 * loc || i - last < minGap) continue;
      const pos = Math.max(0, (i - 1) * hop);
      if (pos > out[out.length - 1] + hop) out.push(pos);
      last = i;
    }
    return out;
  };

  // ---------- BEATS ----------
  function beats(chs, f, P, sr) {
    const inLen = chs[0].length, nch = chs.length;
    const outLen = Math.max(1, Math.round(inLen * f));
    const out = chs.map(() => new Float32Array(outLen));
    const pre = Math.round(sr * 0.004), atk = Math.round(sr * 0.03), fade = Math.round(sr * 0.004);
    const starts = W.transients(mix(chs), sr).map(p => Math.max(0, p - pre));
    starts[0] = 0;
    for (let s = 0; s < starts.length; s++) {
      const a = starts[s], b = s + 1 < starts.length ? starts[s + 1] : inLen;
      const oa = Math.round(a * f), ob = s + 1 < starts.length ? Math.round(b * f) : outLen;
      const need = ob - oa;
      if (need <= 0 || b <= a) continue;
      // the slice, transposed by resampling (a little past its end so the resampler has context)
      let src = chs.map(c => c.subarray(a, Math.min(inLen, b)));
      if (Math.abs(P - 1) > 1e-6) src = src.map(c => W.resample(c, P));
      const have = src[0].length;
      let body;
      if (have >= need) body = src.map(c => c.subarray(0, need));
      else if (have > atk + Math.round(sr * 0.06)) {
        // keep the attack, stretch the rest of the slice into the remaining room
        const head = src.map(c => c.subarray(0, atk)), tail = src.map(c => c.subarray(atk));
        // (the stretched tail starts exactly where the attack ends, so the seam is continuous)
        const st = W.wsola(tail, (need - atk) / tail[0].length, sr, 0.03);
        body = head.map((hd, c) => { const o = new Float32Array(need); o.set(hd); o.set(st[c].subarray(0, need - atk), atk); return o; });
      } else body = src; // too short to stretch: the rest of the slot stays silent
      // Slices start a few ms before their transient, so short fades at both ends never touch an attack.
      const len = Math.min(need, body[0].length), fin = s ? Math.round(sr * 0.001) : 0;
      for (let c = 0; c < nch; c++) {
        const dst = out[c], bd = body[c];
        for (let j = 0; j < len; j++) {
          let g = 1;
          if (j < fin) g = j / fin;
          if (j >= len - fade) g = Math.min(g, (len - j) / fade);
          dst[oa + j] += bd[j] * g;
        }
      }
    }
    return out;
  }

  // ---------- render ----------
  // chs: Float32Array per channel. o.stretch: output length / input length; o.semis: transposition
  // (may be fractional); o.mode: 'beats' | 'tones' | 'complex' | 'repitch'. Returns one new
  // Float32Array per channel, each exactly round(length * stretch) long.
  W.renderArrays = function (chs, sr, o) {
    const f = o.stretch || 1, P = Math.pow(2, (o.semis || 0) / 12);
    const outLen = Math.max(1, Math.round(chs[0].length * f));
    let res;
    if (o.mode === 'repitch') res = chs.map(c => W.resample(c, 1 / f, outLen));
    else if (o.mode === 'beats') res = beats(chs, f, P, sr);
    else {
      // stretch by f * P keeping pitch, then resample by P: length f, pitch P
      const st = o.mode === 'tones' ? W.wsola(chs, f * P, sr) : W.pvoc(chs, f * P, sr);
      res = Math.abs(P - 1) < 1e-6 ? st : st.map(c => W.resample(c, P, outLen));
    }
    return res.map(c => {
      if (c.length === outLen && c.byteOffset === 0 && c.buffer.byteLength === c.byteLength) return c;
      const o2 = new Float32Array(outLen);
      o2.set(c.length > outLen ? c.subarray(0, outLen) : c);
      return o2;
    });
  };
  const toBuffer = (chs, sr) => {
    const out = new AudioBuffer({ length: chs[0].length, numberOfChannels: chs.length, sampleRate: sr });
    chs.forEach((c, i) => out.getChannelData(i).set(c));
    return out;
  };
  const channels = buf => { const chs = []; for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c)); return chs; };
  W.render = (buf, o) => toBuffer(W.renderArrays(channels(buf), buf.sampleRate, o), buf.sampleRate);

  // Same, in a background worker so the page stays responsive (falls back to the page when workers fail).
  let worker = null, seq = 0;
  const waiting = new Map();
  function getWorker() {
    if (worker !== null) return worker;
    try {
      worker = new Worker('js/warpworker.js');
      worker.onmessage = e => {
        const w = waiting.get(e.data.id);
        if (!w) return;
        waiting.delete(e.data.id);
        if (e.data.error) w.reject(new Error(e.data.error));
        else w.resolve(toBuffer(e.data.chs, w.sr));
      };
      worker.onerror = () => { worker = false; waiting.forEach(w => w.fallback()); waiting.clear(); };
    } catch (e) { worker = false; }
    return worker;
  }
  W.renderAsync = function (buf, o) {
    const wk = typeof Worker !== 'undefined' && typeof window !== 'undefined' && window.document ? getWorker() : false;
    if (!wk) return new Promise(res => setTimeout(() => res(W.render(buf, o)), 0));
    return new Promise((resolve, reject) => {
      const id = ++seq, chs = channels(buf).map(c => c.slice());
      waiting.set(id, { resolve, reject, sr: buf.sampleRate, fallback: () => resolve(W.render(buf, o)) });
      wk.postMessage({ id, chs, sr: buf.sampleRate, o }, chs.map(c => c.buffer));
    });
  };
})(window.S4);
