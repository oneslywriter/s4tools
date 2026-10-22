'use strict';
// Read and write S-4 projects directly on the S-4's drive (USB storage mode) with the
// File System Access API (Chrome / Edge). The PROJECTS folder is picked once and remembered;
// Chrome asks for permission once per visit (or never, with "Allow on every visit").
(function (S4) {
  const D = S4.drive = {
    supported: typeof window.showDirectoryPicker === 'function',
    label: '', // name of the remembered folder, for menus
  };

  const stored = async key => { try { return (await S4.idb.handle.get(key)) || null; } catch (e) { return null; } };

  // Needs to run soon after a click: requestPermission requires a user gesture.
  async function allowed(handle, mode) {
    const opts = { mode };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    return (await handle.requestPermission(opts)) === 'granted';
  }

  async function reachable(dir) {
    try { for await (const k of dir.keys()) break; return true; } catch (e) { return false; }
  }

  async function hasProjects(dir) {
    for await (const [name, h] of dir.entries()) if (h.kind === 'directory' && /\.s4project$/i.test(name)) return true;
    return false;
  }

  async function exists(dir, name) {
    try { await dir.getDirectoryHandle(name); return true; } catch (e) { return false; }
  }

  D.init = async function () {
    const h = await stored('projects');
    D.label = h ? h.name : '';
  };

  // Ask for the S-4 folder. Accepts the drive itself (then SAMPLES is remembered too), its PROJECTS
  // folder, or - after a warning - any folder.
  D.pick = async function () {
    const dir = await window.showDirectoryPicker({ id: 's4-drive', mode: 'readwrite' });
    let projects = null, samples = null;
    if (/^projects$/i.test(dir.name) || await hasProjects(dir)) projects = dir;
    else {
      try { projects = await dir.getDirectoryHandle('PROJECTS'); } catch (e) { /* not the drive root */ }
      if (projects) { try { samples = await dir.getDirectoryHandle('SAMPLES'); } catch (e) { /* no SAMPLES */ } }
    }
    if (!projects) {
      if (!confirm(`"${dir.name}" does not look like the S-4's PROJECTS folder (it has no NAME.s4project folders). Use it anyway?`)) return null;
      projects = dir;
    }
    await S4.idb.handle.put('projects', projects);
    if (samples) await S4.idb.handle.put('samples', samples);
    D.label = projects.name;
    return { projects, samples };
  };

  // The remembered PROJECTS folder (asking for permission if needed), or a new pick.
  D.projects = async function () {
    let h = await stored('projects');
    if (h && !(await allowed(h, 'readwrite'))) h = null;
    if (h && !(await reachable(h))) {
      S4.toast('The S-4 folder can\'t be reached. Is the S-4 in USB storage mode? Then choose it again.', 'err');
      h = null;
    }
    if (!h) {
      S4.toast('Choose the S-4 drive (or its PROJECTS folder), then let Chrome edit files there');
      const r = await D.pick();
      h = r && r.projects;
    }
    return h;
  };

  // Write a built project (S4.s4p.build result) as <NAME>.s4project. Never overwrites: on a name
  // clash, onConflict(name) is asked for another name (default: a prompt); null cancels.
  D.write = async function (built, projectsDir, onConflict) {
    const ask = onConflict || (n => prompt(`A project called "${n}" is already on the S-4. Name for this one:`, nextName(n)));
    let name = built.name;
    while (await exists(projectsDir, name + '.s4project')) {
      const next = ask(name);
      if (!next) return null;
      name = S4.s4p.projectName(next);
    }
    const root = await projectsDir.getDirectoryHandle(name + '.s4project', { create: true });
    try {
      for (const f of built.files) {
        const parts = f.name.slice(built.dir.length).split('/');
        let dir = root;
        for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true });
        const leaf = parts[parts.length - 1];
        if (!leaf) continue; // directory entry
        const w = await (await dir.getFileHandle(leaf, { create: true })).createWritable();
        try {
          await w.write(typeof f.data === 'string' ? new Blob([f.data]) : f.data);
          await w.close();
        } catch (e) {
          try { await w.abort(); } catch (e2) { /* already closed */ } // an open stream would lock the folder
          throw e;
        }
      }
    } catch (e) {
      // Leave nothing half-written behind.
      try { await projectsDir.removeEntry(name + '.s4project', { recursive: true }); } catch (e2) { /* ignore */ }
      throw e;
    }
    return name;
  };
  const nextName = n => {
    const m = n.match(/^(.*?)\s*(\d+)$/);
    const base = m ? m[1] : n, k = m ? +m[2] + 1 : 2;
    return (base.slice(0, 12 - String(k).length - 1) + ' ' + k).trim();
  };

  D.list = async function (projectsDir) {
    const out = [];
    for await (const [n, h] of projectsDir.entries()) if (h.kind === 'directory' && /\.s4project$/i.test(n)) out.push(n.replace(/\.s4project$/i, ''));
    return out.sort((a, b) => a.localeCompare(b));
  };

  // Import entries for one project: project.json, discs/, tapes/, plus any samples it uses from the
  // S-4's SAMPLES folder when that folder is known (picked as part of the drive).
  D.entries = async function (projectsDir, name, samplesDir) {
    const dir = await projectsDir.getDirectoryHandle(name + '.s4project');
    const prefix = name + '.s4project/';
    const entries = new Map();
    const add = async (key, fh) => { const f = await fh.getFile(); entries.set(key, { size: f.size, read: () => f.arrayBuffer() }); };
    await add(prefix + 'project.json', await dir.getFileHandle('project.json'));
    for (const sub of ['discs', 'tapes', 'granular_buffers']) {
      let d;
      try { d = await dir.getDirectoryHandle(sub); } catch (e) { continue; }
      for await (const [n, h] of d.entries()) if (h.kind === 'file') await add(`${prefix}${sub}/${n}`, h);
    }
    const samples = samplesDir !== undefined ? samplesDir : await stored('samples');
    if (samples && (await allowed(samples, 'read'))) {
      const json = JSON.parse(new TextDecoder().decode(await entries.get(prefix + 'project.json').read()));
      const paths = new Set();
      for (const sc of Object.values((json.data && json.data.scenes) || {})) {
        for (const tr of sc.tracks || []) {
          const m = tr.material || {};
          for (const k of ['disc', 'tape', 'poly']) { const p = m[k] && (m[k].library_sample_path || m[k].sample_path); if (p) paths.add(p); }
        }
      }
      for (const p of paths) {
        const rel = (p.match(/\/SAMPLES\/02_USER\/(.+)$/i) || p.match(/^\/data\/SAMPLES\/(.+)$/i) || [])[1];
        const fh = rel && await walk(samples, rel);
        if (fh) await add('SAMPLES/' + rel, fh);
      }
    }
    return entries;
  };

  async function walk(dir, rel) {
    try {
      const parts = rel.split('/');
      for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
      return await dir.getFileHandle(parts[parts.length - 1]);
    } catch (e) { return null; }
  }
})(window.S4);
