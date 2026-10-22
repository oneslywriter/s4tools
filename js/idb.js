'use strict';
// Tiny IndexedDB store: sample bytes (so a Build project survives reloads) and
// remembered folder handles (the S-4's PROJECTS / SAMPLES folders).
(function (S4) {
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open('s4tools', 2);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains('samples')) d.createObjectStore('samples', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('handles')) d.createObjectStore('handles');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  }
  function tx(store, mode, fn) {
    return db().then(d => new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }
  S4.idb = {
    put: rec => tx('samples', 'readwrite', s => s.put(rec)),
    get: id => tx('samples', 'readonly', s => s.get(id)),
    del: id => tx('samples', 'readwrite', s => s.delete(id)),
    keys: () => tx('samples', 'readonly', s => s.getAllKeys()),
    clear: () => tx('samples', 'readwrite', s => s.clear()),
    handle: {
      get: key => tx('handles', 'readonly', s => s.get(key)),
      put: (key, h) => tx('handles', 'readwrite', s => s.put(h, key)),
      del: key => tx('handles', 'readwrite', s => s.delete(key)),
    },
  };
})(window.S4);
