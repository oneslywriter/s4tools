'use strict';
// Shared helpers: DOM builder, event bus, storage, toasts, icons.
window.S4 = window.S4 || {};
(function (S4) {
  S4.h = function (tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat(3)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  };

  S4.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  // keep a drag's pointer events on the element; a pointer that is already gone just doesn't get captured
  S4.capture = (el, id) => { try { el.setPointerCapture(id); } catch (e) { /* no such active pointer */ } };
  S4.pad3 = n => String(n).padStart(3, '0');
  S4.uid = () => Math.random().toString(36).slice(2, 10);
  S4.signed = v => (v > 0 ? '+' : '') + v;
  S4.debounce = (fn, ms) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };

  // --- event bus ---
  const subs = {};
  S4.on = (ev, fn) => { (subs[ev] || (subs[ev] = new Set())).add(fn); return () => subs[ev].delete(fn); };
  S4.emit = (ev, ...a) => { if (subs[ev]) subs[ev].forEach(fn => { try { fn(...a); } catch (e) { console.error(e); } }); };

  // --- localStorage (namespaced, failure tolerant) ---
  S4.store = {
    get(k, d) {
      try { const v = localStorage.getItem('s4tools.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem('s4tools.' + k, JSON.stringify(v)); } catch (e) { console.warn('storage', e); }
    },
  };

  // --- toast ---
  let toastTimer;
  S4.toast = function (msg, kind) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, kind === 'err' ? 6000 : 2600);
  };

  // --- download helper ---
  S4.download = function (blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };

  // --- file picker helper ---
  S4.pickFiles = function (opts = {}) {
    return new Promise(resolve => {
      const inp = document.createElement('input');
      inp.type = 'file';
      if (opts.accept) inp.accept = opts.accept;
      if (opts.multiple) inp.multiple = true;
      if (opts.directory) { inp.webkitdirectory = true; inp.multiple = true; }
      inp.style.display = 'none';
      inp.addEventListener('change', () => { resolve([...inp.files]); inp.remove(); });
      inp.addEventListener('cancel', () => { resolve([]); inp.remove(); });
      document.body.append(inp);
      inp.click();
    });
  };

  // --- icons (inline SVG, stroke = currentColor) ---
  const I = {
    // four tracks, four colours
    logo: '<svg viewBox="0 0 18 18"><rect x="1" y="1" width="7" height="7" rx="2" fill="var(--t1)" stroke="none"/><rect x="10" y="1" width="7" height="7" rx="3.5" fill="var(--t2)" stroke="none"/><rect x="1" y="10" width="7" height="7" rx="3.5" fill="var(--t3)" stroke="none"/><rect x="10" y="10" width="7" height="7" rx="2" fill="var(--t4)" stroke="none"/></svg>',
    chev: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M8 5.5l11 6.5-11 6.5z" fill="currentColor" stroke="none"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>',
    reset: '<svg viewBox="0 0 24 24"><path d="M5 12a7 7 0 1 0 2.2-5.1"/><path d="M5 4v4h4"/></svg>',
    random: '<svg viewBox="0 0 24 24"><path d="M4 7h3l10 10h3M4 17h3l3-3M14 10l3-3h3M18 4l2 3-2 3M18 14l2 3-2 3"/></svg>',
    bypass: '<svg viewBox="0 0 24 24"><path d="M3 12h5M16 12h5M8 12l7-5"/></svg>',
    export: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    prev: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
    up: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
    chain: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    expand: '<svg viewBox="0 0 24 24"><path d="M4 10V4h6M20 14v6h-6M4 4l6 6M20 20l-6-6"/></svg>',
    folder: '<svg viewBox="0 0 24 24"><path d="M3 6.5h6.5l2 2H21V19H3z"/></svg>',
    wave: '<svg viewBox="0 0 24 24"><path d="M3 12h2l2-6 3 12 3-9 2 6 2-3h4"/></svg>',
    pads: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg>',
    library: '<svg viewBox="0 0 24 24"><path d="M5 4v16M9.5 4v16M14 5l4.5 14.5"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="5.5"/><path d="M15 15l5 5"/></svg>',
    drawer: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M14.5 5v14"/></svg>',
    mon: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10"/></svg>',
    learn: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  };
  S4.icon = function (name, cls) {
    const s = document.createElement('span');
    s.className = 'ico' + (cls ? ' ' + cls : '');
    s.innerHTML = I[name] || '';
    return s;
  };
})(window.S4);
