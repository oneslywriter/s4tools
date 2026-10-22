'use strict';
// Background renderer for S4.warp (see warp.js): { id, chs, sr, o } in, { id, chs } or { id, error } out.
self.window = self;
self.S4 = {};
importScripts('analysis.js', 'warp.js');
self.onmessage = e => {
  const { id, chs, sr, o } = e.data;
  try {
    const out = self.S4.warp.renderArrays(chs, sr, o);
    self.postMessage({ id, chs: out }, out.map(c => c.buffer));
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
