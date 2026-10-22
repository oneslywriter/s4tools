'use strict';
// UI building blocks: faders, buttons, menus, modals, segmented switches.
(function (S4) {
  const h = S4.h;

  // Re-render every element bound to a control id when its value changes.
  S4.on('val', id => {
    document.querySelectorAll(`[data-target="${id}"]`).forEach(el => el._update && el._update());
  });

  // Model for a fader bound to an S4.ctl id.
  S4.ctlModel = function (id, label) {
    const info = S4.ctl.info(id);
    return {
      id,
      get: () => S4.ctl.get(id),
      set: v => S4.ctl.set(id, v, { src: 'ui' }),
      min: 0, max: 127, step: 1, center: 64,
      def: info.def, bi: info.bi,
      fmt: v => S4.ctl.format(id, v),
      label: label || info.short,
      ccLabel: `CC ${info.cc} · CH ${info.ch}`,
    };
  };

  /**
   * Horizontal fader.
   * model: { id?, get, set, min, max, step, def, bi, center?, fmt?, label, ccLabel?, ticks?, disabled? }
   * Precise values (optional): taper { pos(v) -> 0..1, val(pos) -> v } for a curved fader, quant(v) instead
   * of step rounding, detent (a value dragging snaps to), nudge(v, dir, big) for keys and wheel, and
   * parse(text) -> value, which makes the value clickable to type an exact number.
   * opts.layout: 'row' (label | bar | value) or 'stack' (label+value over bar)
   */
  S4.fader = function (model, opts = {}) {
    const step = model.step || 1;
    const tp = model.taper || null;
    const center = model.center != null ? model.center : model.detent != null ? model.detent : (model.min < 0 && model.max > 0 ? 0 : (model.min + model.max) / 2);
    const fill = h('div', { class: 'f-fill' });
    const tick = h('div', { class: 'f-tick' });
    const bar = h('div', { class: 'f-bar' }, fill, tick);
    const val = h('span', { class: 'f-val' });
    const label = h('span', { class: 'f-label' }, model.label);
    const el = h('div', {
      class: 'fader ' + (opts.layout || 'stack') + (model.bi ? ' bi' : '') + (model.disabled ? ' disabled' : '') + (opts.cls ? ' ' + opts.cls : ''),
      tabindex: model.disabled ? null : 0,
      'data-target': model.id || null,
    }, label, val, bar, model.ccLabel ? h('span', { class: 'f-cc' }, model.ccLabel) : null);

    if (model.ticks) {
      const n = Math.round((model.max - model.min) / step);
      for (let i = 0; i <= n; i++) bar.append(h('i', { class: 'f-step', style: { left: (i / n) * 100 + '%' } }));
    }

    const range = () => (model.max - model.min) || 1;
    // position (0..1) <-> value, straight or along the model's curve
    const posOf = v => (tp ? tp.pos(v) : S4.clamp((v - model.min) / range(), 0, 1));
    const valOf = f => (tp ? tp.val(f) : model.min + f * range());
    const snap = v => {
      if (model.quant) return model.quant(v);
      const s = Math.round((v - model.min) / step) * step + model.min;
      return S4.clamp(Math.round(s * 1e6) / 1e6, model.min, model.max);
    };
    // dragging close to the detent lands exactly on it
    const detent = v => (model.detent != null && Math.abs(posOf(v) - posOf(model.detent)) < 0.012 ? model.detent : v);
    const upd = el._update = () => {
      const v = model.get();
      const f = posOf(v);
      if (model.bi) {
        const c = posOf(center);
        fill.style.left = Math.min(c, f) * 100 + '%';
        fill.style.width = Math.abs(f - c) * 100 + '%';
      } else {
        fill.style.left = '0';
        fill.style.width = f * 100 + '%';
      }
      tick.style.left = f * 100 + '%';
      val.textContent = model.fmt ? model.fmt(v) : String(v);
    };
    const apply = v => { if (model.disabled) return; model.set(snap(v)); upd(); };

    // click the value to type an exact one
    if (model.parse) {
      val.classList.add('f-edit');
      val.title = 'Click to type a value';
      val.addEventListener('pointerdown', e => {
        if (model.disabled || e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        const input = h('input', { class: 'f-input', value: val.textContent, spellcheck: 'false' });
        let finished = false; // removing the input fires its blur: finish once
        const done = ok => {
          if (finished || !input.isConnected) return;
          finished = true;
          const v = ok ? model.parse(input.value) : null;
          input.replaceWith(val);
          if (v != null) apply(v); else upd();
          el.focus({ preventScroll: true });
        };
        input.addEventListener('keydown', ev => {
          ev.stopPropagation();
          if (ev.key === 'Enter') done(true);
          else if (ev.key === 'Escape') done(false);
        });
        input.addEventListener('blur', () => done(true));
        input.addEventListener('pointerdown', ev => ev.stopPropagation());
        val.replaceWith(input);
        input.focus();
        input.select();
      });
    }

    el.addEventListener('pointerdown', e => {
      if (e.button !== 0 || model.disabled) return;
      e.preventDefault();
      el.focus({ preventScroll: true });
      const rect = bar.getBoundingClientRect();
      const onBar = e.clientY >= rect.top - 7 && e.clientY <= rect.bottom + 7;
      const startF = posOf(model.get()), startX = e.clientX;
      const fromX = x => valOf(S4.clamp((x - rect.left) / rect.width, 0, 1));
      if (onBar && !e.shiftKey) apply(detent(fromX(e.clientX)));
      S4.capture(el, e.pointerId);
      el.classList.add('drag');
      // on the bar the value follows the pointer; shift (or dragging the label) moves relatively, shift = 10x finer
      const move = ev => {
        if (onBar && !ev.shiftKey) apply(detent(fromX(ev.clientX)));
        else apply(detent(valOf(S4.clamp(startF + ((ev.clientX - startX) / rect.width) * (ev.shiftKey ? 0.1 : 1), 0, 1))));
      };
      const up = () => {
        el.classList.remove('drag');
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    el.addEventListener('dblclick', e => { if (e.target !== val && model.def != null) apply(model.def); });
    const nudge = (dir, big) => (model.nudge ? model.nudge(model.get(), dir, big) : model.get() + dir * step * (big ? 10 : 1));
    el.addEventListener('wheel', e => {
      if (model.disabled) return;
      e.preventDefault();
      apply(nudge(e.deltaY < 0 || e.deltaX > 0 ? 1 : -1, e.shiftKey));
    }, { passive: false });
    el.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') apply(nudge(1, e.shiftKey));
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') apply(nudge(-1, e.shiftKey));
      else if (e.key === 'Home') apply(model.min);
      else if (e.key === 'End') apply(model.max);
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
    upd();
    return el;
  };

  /**
   * Rotary knob: the same model as S4.fader. A 270° arc in the surrounding --kc colour. Drag up or down
   * (Shift for fine moves), wheel, arrow keys, Home / End; double-click resets; click the value to type one.
   * opts.size: 'sm' | 'lg' | 'inline' (label, dial and value in a row; default medium); opts.cls
   */
  const NS = 'http://www.w3.org/2000/svg';
  const A0 = -135, A1 = 135;
  const polar = (a, r) => { const t = ((a - 90) * Math.PI) / 180; return [20 + r * Math.cos(t), 20 + r * Math.sin(t)]; };
  const arcPath = (a, b, r) => {
    if (b < a) [a, b] = [b, a];
    if (b - a < 0.5) return '';
    const [x0, y0] = polar(a, r), [x1, y1] = polar(b, r);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  S4.knob = function (model, opts = {}) {
    const step = model.step || 1;
    const tp = model.taper || null;
    const center = model.center != null ? model.center : model.detent != null ? model.detent : (model.min < 0 && model.max > 0 ? 0 : model.min);
    const range = () => (model.max - model.min) || 1;
    const posOf = v => (tp ? tp.pos(v) : S4.clamp((v - model.min) / range(), 0, 1));
    const valOf = f => (tp ? tp.val(f) : model.min + f * range());
    const snap = v => {
      if (model.quant) return model.quant(v);
      const s = Math.round((v - model.min) / step) * step + model.min;
      return S4.clamp(Math.round(s * 1e6) / 1e6, model.min, model.max);
    };
    const detent = v => (model.detent != null && Math.abs(posOf(v) - posOf(model.detent)) < 0.015 ? model.detent : v);

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 40 40');
    svg.setAttribute('class', 'k-dial');
    const add = (tag, cls, attrs) => { const e = document.createElementNS(NS, tag); e.setAttribute('class', cls); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); svg.append(e); return e; };
    add('path', 'k-track', { d: arcPath(A0, A1, 15) });
    if (model.ticks) {
      const n = Math.round((model.max - model.min) / step);
      if (n <= 24) for (let i = 0; i <= n; i++) {
        const [x, y] = polar(A0 + (A1 - A0) * posOf(model.min + i * step), 19);
        add('circle', 'k-step', { cx: x.toFixed(2), cy: y.toFixed(2), r: 0.9 });
      }
    }
    const arc = add('path', 'k-arc'), ptr = add('line', 'k-ptr');
    const val = h('span', { class: 'k-val' });
    const el = h('div', {
      class: 'knob' + (opts.size ? ' k-' + opts.size : '') + (model.bi ? ' bi' : '') + (model.disabled ? ' disabled' : '') + (opts.cls ? ' ' + opts.cls : ''),
      tabindex: model.disabled ? null : 0,
      'data-target': model.id || null,
      title: model.ccLabel || null,
    }, h('span', { class: 'k-label' }, model.label), svg, val);

    const upd = el._update = () => {
      const v = model.get(), a = A0 + (A1 - A0) * posOf(v);
      arc.setAttribute('d', arcPath(model.bi ? A0 + (A1 - A0) * posOf(center) : A0, a, 15));
      const [x0, y0] = polar(a, 6), [x1, y1] = polar(a, 12);
      ptr.setAttribute('x1', x0.toFixed(2)); ptr.setAttribute('y1', y0.toFixed(2));
      ptr.setAttribute('x2', x1.toFixed(2)); ptr.setAttribute('y2', y1.toFixed(2));
      val.textContent = model.fmt ? model.fmt(v) : String(v);
    };
    const apply = v => { if (model.disabled) return; model.set(snap(v)); upd(); };

    if (model.parse) {
      val.classList.add('k-edit');
      val.title = 'Click to type a value';
      val.addEventListener('pointerdown', e => {
        if (model.disabled || e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        const input = h('input', { class: 'k-input', value: val.textContent, spellcheck: 'false' });
        let finished = false;
        const done = ok => {
          if (finished || !input.isConnected) return;
          finished = true;
          const v = ok ? model.parse(input.value) : null;
          input.replaceWith(val);
          if (v != null) apply(v); else upd();
          el.focus({ preventScroll: true });
        };
        input.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') done(true); else if (ev.key === 'Escape') done(false); });
        input.addEventListener('blur', () => done(true));
        input.addEventListener('pointerdown', ev => ev.stopPropagation());
        val.replaceWith(input);
        input.focus();
        input.select();
      });
    }

    // drag: up / right raises the value; 180 px for the whole range, 900 px with Shift
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0 || model.disabled) return;
      e.preventDefault();
      el.focus({ preventScroll: true });
      let f = posOf(model.get()), lastY = e.clientY, lastX = e.clientX;
      S4.capture(el, e.pointerId);
      el.classList.add('drag');
      const move = ev => {
        const d = (lastY - ev.clientY) + (ev.clientX - lastX) * 0.5;
        lastY = ev.clientY;
        lastX = ev.clientX;
        f = S4.clamp(f + d / (ev.shiftKey ? 900 : 180), 0, 1);
        apply(detent(valOf(f)));
      };
      const up = () => {
        el.classList.remove('drag');
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    el.addEventListener('dblclick', e => { if (e.target !== val && model.def != null) apply(model.def); });
    const nudge = (dir, big) => (model.nudge ? model.nudge(model.get(), dir, big) : model.get() + dir * step * (big ? 10 : 1));
    el.addEventListener('wheel', e => {
      if (model.disabled) return;
      e.preventDefault();
      apply(nudge(e.deltaY < 0 ? 1 : -1, e.shiftKey));
    }, { passive: false });
    el.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') apply(nudge(1, e.shiftKey));
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') apply(nudge(-1, e.shiftKey));
      else if (e.key === 'Home') apply(model.min);
      else if (e.key === 'End') apply(model.max);
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
    upd();
    return el;
  };

  // Button bound to an S4.ctl button id (mute, solo, play, rec, macro 9-12...).
  S4.tbutton = function (id, content, opts = {}) {
    const el = h('button', { class: 'tb ' + (opts.cls || ''), 'data-target': id, title: opts.title || S4.ctl.info(id).label }, content);
    el._update = () => el.classList.toggle('on', !!S4.ctl.get(id));
    let down = false;
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      down = true;
      S4.capture(el, e.pointerId);
      S4.ctl.press(id, true);
    });
    const release = () => { if (down) { down = false; S4.ctl.press(id, false); } };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('keydown', e => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); S4.ctl.press(id, true); S4.ctl.press(id, false); }
    });
    el._update();
    return el;
  };

  // Plain icon/text button.
  S4.btn = function (content, onclick, cls, title) {
    return h('button', { class: 'btn ' + (cls || ''), onclick, title: title || null }, content);
  };

  // Segmented switch: options [{label, value}], returns element; onChange(value).
  S4.seg = function (options, value, onChange, cls) {
    const el = h('div', { class: 'seg ' + (cls || '') });
    options.forEach(o => {
      el.append(h('button', {
        class: o.value === value ? 'on' : '',
        disabled: o.disabled || null,
        onclick: () => {
          el.querySelectorAll('button').forEach(b => b.classList.remove('on'));
          el.children[options.indexOf(o)].classList.add('on');
          onChange(o.value);
        },
      }, o.label));
    });
    return el;
  };
  S4.onoff = (value, onChange) => S4.seg([{ label: 'On', value: true }, { label: 'Off', value: false }], !!value, onChange, 'onoff');

  // ---------- popup menu ----------
  let openMenu = null;
  S4.closeMenu = () => { if (openMenu) { openMenu(); openMenu = null; } };
  S4.menu = function (anchor, items, onPick) {
    S4.closeMenu();
    const m = h('div', { class: 'menu' });
    items.forEach(it => {
      if (it.sep) return m.append(h('div', { class: 'menu-sep' }));
      if (it.head) return m.append(h('div', { class: 'menu-head' }, it.head));
      m.append(h('button', {
        class: 'menu-item' + (it.checked ? ' on' : '') + (it.danger ? ' danger' : ''),
        disabled: it.disabled || null,
        onclick: () => { S4.closeMenu(); (it.action || onPick)(it.value !== undefined ? it.value : it); },
      }, h('span', { class: 'mi-check' }, it.checked ? '●' : ''), it.label, it.hint ? h('span', { class: 'mi-hint' }, it.hint) : null));
    });
    document.body.append(m);
    const r = anchor.getBoundingClientRect();
    const mw = m.offsetWidth, mh = m.offsetHeight;
    let left = r.left, top = r.bottom + 4;
    if (left + mw > innerWidth - 8) left = Math.max(8, innerWidth - mw - 8);
    if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 4);
    m.style.left = left + 'px';
    m.style.top = top + 'px';
    const outside = e => { if (!m.contains(e.target) && !anchor.contains(e.target)) S4.closeMenu(); };
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); S4.closeMenu(); } };
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
    document.addEventListener('keydown', esc, true);
    openMenu = () => {
      m.remove();
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', esc, true);
    };
  };

  // a panel under its anchor (the scene pads); closes like a menu
  S4.popover = function (anchor, content) {
    S4.closeMenu();
    const m = h('div', { class: 'pop' }, content);
    document.body.append(m);
    const r = anchor.getBoundingClientRect();
    let left = r.left, top = r.bottom + 6;
    if (left + m.offsetWidth > innerWidth - 8) left = Math.max(8, innerWidth - m.offsetWidth - 8);
    if (top + m.offsetHeight > innerHeight - 8) top = Math.max(8, r.top - m.offsetHeight - 6);
    m.style.left = left + 'px';
    m.style.top = top + 'px';
    const outside = e => { if (!m.contains(e.target) && !anchor.contains(e.target)) S4.closeMenu(); };
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); S4.closeMenu(); } };
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
    document.addEventListener('keydown', esc, true);
    openMenu = () => {
      m.remove();
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', esc, true);
    };
    return m;
  };

  // ---------- modal ----------
  S4.modal = function (title, body, opts = {}) {
    const close = () => {
      back.remove();
      document.removeEventListener('keydown', esc, true);
      if (opts.onClose) opts.onClose();
    };
    const esc = e => { if (e.key === 'Escape' && !document.querySelector('.menu')) { e.stopPropagation(); close(); } };
    const back = h('div', { class: 'modal-back', onpointerdown: e => { if (e.target === back) close(); } },
      h('div', { class: 'modal ' + (opts.cls || '') },
        h('div', { class: 'modal-head' },
          h('span', { class: 'lbl' }, title),
          h('span', { class: 'sp' }),
          opts.headExtra || null,
          h('button', { class: 'ib', title: 'Close', onclick: close }, S4.icon('x'))),
        h('div', { class: 'modal-body' }, body)));
    document.getElementById('modal-root').append(back);
    document.addEventListener('keydown', esc, true);
    return { close, el: back };
  };
})(window.S4);
