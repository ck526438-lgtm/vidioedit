/* VidioEdit — logique de l'interface
 * Licence MIT — https://github.com/ck526438-lgtm/vidioedit
 */
(() => {
  'use strict';
  const P = window.PRESETS;
  const R = window.Renderer;
  const api = window.api;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const EPS = 1e-4;
  const MIN_DUR = 0.1;

  // ---------------------------------------------------------------- État
  function newProject() {
    return {
      app: 'VidioEdit',
      format: 1,
      name: 'Projet sans titre',
      ratio: '16:9',
      res: 1080,
      fps: 30,
      bg: '#000000',
      bgMode: 'color',
      media: [],
      tracks: [
        { id: 'v1', kind: 'visual', name: 'Principale', hidden: false, muted: false, main: true },
        { id: 'v2', kind: 'visual', name: 'Superposition', hidden: false, muted: false },
        { id: 't1', kind: 'visual', name: 'Texte', hidden: false, muted: false },
        { id: 'a1', kind: 'audio', name: 'Audio', hidden: false, muted: false },
      ],
      clips: [],
    };
  }

  let project = newProject();
  let filePath = null;
  let dirty = false;
  let selectedId = null;
  let time = 0;
  let playing = false;
  let pps = 80; // pixels par seconde
  let undoStack = [];
  let redoStack = [];

  const mediaById = (id) => project.media.find((m) => m.id === id);
  const clipById = (id) => project.clips.find((c) => c.id === id);
  const trackById = (id) => project.tracks.find((t) => t.id === id);
  const selected = () => clipById(selectedId);
  const totalDuration = () => project.clips.reduce((m, c) => Math.max(m, c.start + c.dur), 0);

  // ---------------------------------------------------------------- Historique
  const snapshot = () => JSON.stringify({ tracks: project.tracks, clips: project.clips, ratio: project.ratio, bg: project.bg, bgMode: project.bgMode, res: project.res, fps: project.fps });
  function pushHistory() {
    undoStack.push(snapshot());
    if (undoStack.length > 150) undoStack.shift();
    redoStack = [];
    markDirty();
  }
  function restore(s) {
    const o = JSON.parse(s);
    Object.assign(project, o);
    if (selectedId && !clipById(selectedId)) selectedId = null;
    applyCanvasSize();
    refreshAll();
  }
  function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); markDirty(); }
  function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); markDirty(); }
  function markDirty() { dirty = true; updateTitle(); }
  function updateTitle() { document.title = `${dirty ? '● ' : ''}${project.name} — VidioEdit`; }

  // ---------------------------------------------------------------- Utilitaires
  function fmtTime(t, short) {
    t = Math.max(0, t);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), cs = Math.floor((t * 100) % 100);
    const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
    if (short) return h ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
    return `${h ? h + ':' : ''}${mm}:${ss}.${String(cs).padStart(2, '0')}`;
  }
  let toastTimer = null;
  function toast(msg, ms = 2200) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }
  function exportDims(ratioId, res) {
    const r = P.ratios.find((x) => x.id === ratioId) || P.ratios[0];
    const even = (n) => Math.round(n / 2) * 2;
    if (r.w >= r.h) return { w: even((res * r.w) / r.h), h: even(res) };
    return { w: even(res), h: even((res * r.h) / r.w) };
  }

  // ---------------------------------------------------------------- Clips
  function makeClip(kind, trackId, start, dur, extra = {}) {
    return Object.assign({
      id: uid(), kind, trackId, mediaId: null, start, dur, in: 0, speed: 1, volume: 1, muted: false,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, fit: 'contain',
      adjust: {}, filterId: 'none', fadeIn: 0, fadeOut: 0,
      animIn: { type: 'none', dur: 0.5 }, animOut: { type: 'none', dur: 0.5 },
      flipH: false, flipV: false,
      transition: { type: 'none', dur: 0.5 }, keyframes: {}, crop: { l: 0, t: 0, r: 0, b: 0 },
      effect: { type: 'none', intensity: 0.5 }, denoise: false,
    }, extra);
  }
  const trackKindFor = (clipKind) => (clipKind === 'audio' ? 'audio' : 'visual');

  function isFree(trackId, start, end, excludeId) {
    return !project.clips.some((c) => c.trackId === trackId && c.id !== excludeId && c.start < end - EPS && c.start + c.dur > start + EPS);
  }
  function addTrack(kind, opts = {}) {
    const n = project.tracks.filter((t) => t.kind === kind).length + 1;
    const t = { id: uid(), kind, name: kind === 'audio' ? `Audio ${n}` : `Vidéo ${n}`, hidden: false, muted: false };
    if (opts.below) {
      const idx = project.tracks.findIndex((x) => x.id === opts.below);
      project.tracks.splice(idx, 0, t);
    } else project.tracks.push(t);
    return t;
  }
  function findFreeTrack(kind, start, end, preferId, excludeId) {
    if (preferId && trackById(preferId) && isFree(preferId, start, end, excludeId)) return preferId;
    const list = project.tracks.filter((t) => t.kind === kind && !t.main);
    for (const t of list) if (isFree(t.id, start, end, excludeId)) return t.id;
    return addTrack(kind).id;
  }
  function trackEnd(trackId) {
    return project.clips.filter((c) => c.trackId === trackId).reduce((m, c) => Math.max(m, c.start + c.dur), 0);
  }
  function maxDurFor(clip) {
    const m = mediaById(clip.mediaId);
    if (!m || m.type === 'image' || clip.kind === 'text') return Infinity;
    return (m.duration - clip.in) / clip.speed;
  }

  function addMediaToTimeline(m, at, trackId) {
    pushHistory();
    let clip;
    if (m.type === 'audio') {
      const start = at != null ? at : time;
      clip = makeClip('audio', null, start, m.duration, { mediaId: m.id });
      clip.trackId = findFreeTrack('audio', start, start + clip.dur, trackId || 'a1');
    } else {
      const dur = m.type === 'image' ? 5 : m.duration;
      if (at == null) {
        const start = trackEnd('v1');
        clip = makeClip(m.type, 'v1', start, dur, { mediaId: m.id });
      } else {
        clip = makeClip(m.type, null, at, dur, { mediaId: m.id });
        const pref = trackId && trackById(trackId) && trackById(trackId).kind === 'visual' ? trackId : 'v1';
        clip.trackId = isFree(pref, at, at + dur) ? pref : findFreeTrack('visual', at, at + dur);
      }
    }
    project.clips.push(clip);
    selectedId = clip.id;
    refreshAll();
    ensureVisible(clip.start);
    return clip;
  }

  function addText(style = {}) {
    pushHistory();
    const dur = 3;
    const trackId = findFreeTrack('visual', time, time + dur, 't1');
    const clip = makeClip('text', trackId, time, dur, {
      text: Object.assign(clone(P.defaultText), style),
      animIn: { type: 'fade', dur: 0.4 }, animOut: { type: 'fade', dur: 0.4 },
    });
    project.clips.push(clip);
    selectedId = clip.id;
    refreshAll();
  }

  function splitAt(t) {
    let targets = selected() ? [selected()] : project.clips.filter((c) => c.trackId === 'v1');
    targets = targets.filter((c) => t > c.start + 0.05 && t < c.start + c.dur - 0.05);
    if (!targets.length) { toast('Placez le curseur sur un clip pour le couper'); return; }
    pushHistory();
    targets.forEach((c) => { selectedId = splitClip(c, t).id; });
    refreshAll();
  }

  function shiftKeyframes(c, d) {
    if (!c.keyframes) return;
    Object.keys(c.keyframes).forEach((k) => {
      c.keyframes[k] = c.keyframes[k].map((f) => ({ t: f.t + d, v: f.v }));
      if (!c.keyframes[k].length) delete c.keyframes[k];
    });
  }
  const localTime = (c) => Math.min(c.dur, Math.max(0, time - c.start));
  function hasKf(c, key) { return !!(c.keyframes && c.keyframes[key] && c.keyframes[key].length); }
  function getProp(c, key) { return R.kfValue(c, key, localTime(c)); }
  function setProp(c, key, v) {
    if (!hasKf(c, key)) { c.transform[key] = v; return; }
    const lt = localTime(c);
    const list = c.keyframes[key];
    const tol = 0.5 / project.fps;
    const f = list.find((x) => Math.abs(x.t - lt) < tol);
    if (f) f.v = v; else { list.push({ t: lt, v }); list.sort((a, b) => a.t - b.t); }
  }
  function toggleKf(c, key) {
    c.keyframes = c.keyframes || {};
    const lt = localTime(c);
    const tol = 0.5 / project.fps;
    const cur = getProp(c, key);
    const list = c.keyframes[key] || [];
    const i = list.findIndex((x) => Math.abs(x.t - lt) < tol);
    if (i >= 0) {
      list.splice(i, 1);
      if (!list.length) { delete c.keyframes[key]; c.transform[key] = cur; }
    } else {
      list.push({ t: lt, v: cur });
      list.sort((a, b) => a.t - b.t);
      c.keyframes[key] = list;
    }
  }
  function kfTimes(c) {
    const set = new Set();
    Object.values(c.keyframes || {}).forEach((l) => l.forEach((f) => set.add(Math.round(f.t * 1000) / 1000)));
    return [...set].sort((a, b) => a - b);
  }

  // Coupe un clip au temps t (sans historique) et renvoie la seconde partie
  function splitClip(c, t) {
    const local = t - c.start;
    const b = clone(c);
    b.id = uid();
    b.start = t;
    b.dur = c.dur - local;
    b.in = c.in + local * c.speed;
    b.animIn = { type: 'none', dur: c.animIn.dur };
    b.fadeIn = 0;
    b.transition = { type: 'none', dur: (c.transition && c.transition.dur) || 0.5 };
    shiftKeyframes(b, -local);
    c.dur = local;
    c.animOut = { type: 'none', dur: c.animOut.dur };
    c.fadeOut = 0;
    project.clips.push(b);
    return b;
  }

  function deleteSelected() {
    const c = selected();
    if (!c) return;
    pushHistory();
    project.clips = project.clips.filter((x) => x.id !== c.id);
    if (c.trackId === 'v1') {
      // piste principale magnétique : on referme le trou
      project.clips.forEach((x) => { if (x.trackId === 'v1' && x.start >= c.start + c.dur - EPS) x.start = Math.max(0, x.start - c.dur); });
    }
    selectedId = null;
    refreshAll();
  }

  function duplicateSelected() {
    const c = selected();
    if (!c) return;
    pushHistory();
    const d = clone(c);
    d.id = uid();
    d.start = c.start + c.dur;
    d.trackId = isFree(c.trackId, d.start, d.start + d.dur) ? c.trackId : findFreeTrack(trackKindFor(c.kind), d.start, d.start + d.dur);
    project.clips.push(d);
    selectedId = d.id;
    refreshAll();
  }

  function detachAudio(c) {
    const m = mediaById(c.mediaId);
    if (!m || !m.hasAudio) { toast('Ce clip ne contient pas de son'); return; }
    pushHistory();
    const a = makeClip('audio', null, c.start, c.dur, { mediaId: m.id, in: c.in, speed: c.speed, volume: c.volume, fadeIn: c.fadeIn, fadeOut: c.fadeOut });
    a.trackId = findFreeTrack('audio', a.start, a.start + a.dur, 'a1');
    project.clips.push(a);
    c.muted = true;
    refreshAll();
    toast('Audio détaché sur une piste audio');
  }

  // ---------------------------------------------------------------- Import de médias
  async function importPaths(paths) {
    if (!paths || !paths.length) return [];
    const added = [];
    toast(`Import de ${paths.length} fichier(s)…`);
    for (const p of paths) {
      try {
        const info = await api.probe(p);
        if (!info.type) { toast(`Format non pris en charge : ${info.name}`); continue; }
        if (info.type !== 'image' && !(info.duration > 0)) { toast(`Fichier illisible : ${info.name}`); continue; }
        const m = Object.assign({ id: uid() }, info);
        project.media.push(m);
        added.push(m);
        renderMediaGrid();
        await prepareMedia(m);
        renderMediaGrid();
      } catch (e) {
        console.error(e);
        toast(`Erreur à l'import : ${e.message || e}`);
      }
    }
    markDirty();
    updateEmptyState();
    if (added.length) toast(`${added.length} média(s) importé(s)`);
    return added;
  }

  async function prepareMedia(m) {
    if (!m.thumb && m.type !== 'audio') m.thumb = await makeThumb(m).catch(() => null);
    if (m.hasAudio || m.type === 'audio') {
      m.peaks = await api.waveform(m.path).catch(() => null);
      renderTimeline();
    }
  }

  function makeThumb(m) {
    return new Promise((resolve, reject) => {
      const c = document.createElement('canvas');
      const draw = (el, w, h) => {
        const tw = 192, th = Math.round((192 * h) / w) || 108;
        c.width = tw; c.height = th;
        c.getContext('2d').drawImage(el, 0, 0, tw, th);
        resolve(c.toDataURL('image/jpeg', 0.7));
      };
      if (m.type === 'image') {
        const img = new Image();
        img.onload = () => draw(img, img.naturalWidth, img.naturalHeight);
        img.onerror = reject;
        img.src = m.url;
      } else {
        const v = document.createElement('video');
        v.muted = true;
        v.preload = 'auto';
        v.onloadeddata = () => { v.currentTime = Math.min(1, m.duration / 3); };
        v.onseeked = () => { draw(v, v.videoWidth, v.videoHeight); v.removeAttribute('src'); v.load(); };
        v.onerror = reject;
        v.src = m.url;
      }
    });
  }

  function renderMediaGrid() {
    const grid = $('#mediaGrid');
    grid.innerHTML = '';
    project.media.filter((m) => !m.hidden).forEach((m) => {
      const el = document.createElement('div');
      el.className = 'media-item' + (m.missing ? ' missing' : '');
      el.draggable = true;
      el.title = m.missing ? `Fichier introuvable : ${m.path}` : m.name;
      el.innerHTML = (m.thumb ? `<img src="${m.thumb}" alt="">` : `<div class="ph">${m.type === 'audio' ? '♪' : '▶'}</div>`) +
        `<span class="dur">${m.type === 'image' ? 'IMG' : fmtTime(m.duration, true)}</span>` +
        `<div class="meta"></div><button class="add" title="Ajouter à la timeline">+</button>`;
      el.querySelector('.meta').textContent = m.name;
      el.querySelector('.add').onclick = (e) => { e.stopPropagation(); if (!m.missing) addMediaToTimeline(m); };
      el.ondblclick = () => { if (!m.missing) addMediaToTimeline(m); };
      el.ondragstart = (e) => {
        e.dataTransfer.setData('application/x-vidio-media', m.id);
        e.dataTransfer.effectAllowed = 'copy';
      };
      grid.appendChild(el);
    });
  }

  // ---------------------------------------------------------------- Lecture / aperçu
  const stage = $('#stage');
  const sctx = stage.getContext('2d');
  const pool = new Map(); // clipId -> HTMLMediaElement (aperçu)
  const images = new Map(); // mediaId -> HTMLImageElement
  let lastBounds = {};
  let renderQueued = false;
  let playT0 = 0, playPerf0 = 0;

  function applyCanvasSize() {
    const d = exportDims(project.ratio, 720);
    if (stage.width !== d.w || stage.height !== d.h) { stage.width = d.w; stage.height = d.h; }
    $('#ratioLabel').textContent = project.ratio;
  }

  function getImage(m) {
    let img = images.get(m.id);
    if (!img) {
      img = new Image();
      img.onload = requestRender;
      img.src = m.url;
      images.set(m.id, img);
    }
    return img;
  }

  function getPoolEl(clip) {
    let el = pool.get(clip.id);
    const m = mediaById(clip.mediaId);
    if (!m) return null;
    if (el && el.dataset.src !== m.url) { el.pause(); pool.delete(clip.id); el = null; }
    if (!el) {
      el = clip.kind === 'audio' ? new Audio() : document.createElement('video');
      el.preload = 'auto';
      el.playsInline = true;
      el.dataset.src = m.url;
      el.src = m.url;
      el.addEventListener('loadeddata', requestRender);
      el.addEventListener('seeked', requestRender);
      pool.set(clip.id, el);
    }
    return el;
  }

  const previewSrc = {
    media(clip, _t) {
      const m = mediaById(clip.mediaId);
      if (!m || m.missing) return null;
      if (m.type === 'image') return getImage(m);
      return pool.get(clip.id) || null;
    },
  };

  function syncMedia(t) {
    const live = new Set();
    const info = R.prepare(project);
    project.clips.forEach((c) => {
      if (c.kind !== 'video' && c.kind !== 'audio') return;
      const m = mediaById(c.mediaId);
      if (!m || m.missing) return;
      const w = info[c.id] || { from: c.start, to: c.start + c.dur };
      const active = t >= w.from && t < w.to;
      const soon = !active && w.from > t && w.from - t < 1.5;
      if (!active && !soon && !pool.has(c.id)) return;
      const el = getPoolEl(c);
      if (!el) return;
      live.add(c.id);
      const track = trackById(c.trackId);
      if (active) {
        const target = R.srcTime(c, t, m.duration);
        const inBody = t >= c.start && t < c.start + c.dur;
        const drift = Math.abs(el.currentTime - target);
        if ((playing && drift > 0.25) || (!playing && drift > 0.01 && !el.seeking)) el.currentTime = target;
        el.playbackRate = clamp(c.speed, 0.0625, 16);
        el.muted = !inBody || c.muted || (track && track.muted) || (c.kind === 'video' && track && track.hidden);
        el.volume = clamp(c.volume, 0, 1);
        if (playing && el.paused) el.play().catch(() => {});
        if (!playing && !el.paused) el.pause();
      } else {
        if (!el.paused) el.pause();
        if (soon) { const s0 = R.srcTime(c, w.from, m.duration); if (Math.abs(el.currentTime - s0) > 0.05) el.currentTime = s0; }
      }
    });
    for (const [id, el] of pool) {
      if (!clipById(id)) { el.pause(); el.removeAttribute('src'); el.load(); pool.delete(id); }
      else if (!live.has(id) && !el.paused) el.pause();
    }
  }

  function draw() {
    renderQueued = false;
    syncMedia(time);
    lastBounds = R.renderFrame(sctx, project, time, previewSrc, { selectedId: playing ? null : selectedId });
    $('#timeNow').textContent = fmtTime(time);
    positionPlayhead();
  }
  function requestRender() {
    if (renderQueued || playing) return;
    renderQueued = true;
    requestAnimationFrame(draw);
  }

  function loop() {
    if (!playing) return;
    time = playT0 + (performance.now() - playPerf0) / 1000;
    const total = totalDuration();
    if (time >= total) { time = total; pause(); draw(); return; }
    draw();
    followPlayhead();
    requestAnimationFrame(loop);
  }
  function play() {
    if (!project.clips.length) return;
    if (time >= totalDuration() - 0.01) time = 0;
    playing = true;
    playT0 = time;
    playPerf0 = performance.now();
    $('#btnPlay').textContent = '❚❚';
    requestAnimationFrame(loop);
  }
  function pause() {
    playing = false;
    $('#btnPlay').textContent = '▶';
    for (const el of pool.values()) el.pause();
    requestRender();
  }
  function togglePlay() { playing ? pause() : play(); }
  function seek(t) {
    time = clamp(t, 0, Math.max(totalDuration(), 0));
    if (playing) { playT0 = time; playPerf0 = performance.now(); }
    requestRender();
    positionPlayhead();
    const sc = selected();
    if (!playing && sc && sc.keyframes && Object.keys(sc.keyframes).length) renderInspector();
  }

  // Déplacement / zoom direct sur l'aperçu
  (function stageInteraction() {
    let drag = null;
    const toCanvas = (e) => {
      const r = stage.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * stage.width, y: ((e.clientY - r.top) / r.height) * stage.height };
    };
    stage.addEventListener('mousedown', (e) => {
      const p = toCanvas(e);
      const order = [];
      project.tracks.forEach((t) => { if (t.kind === 'visual') project.clips.forEach((c) => { if (c.trackId === t.id && lastBounds[c.id]) order.push(c); }); });
      const hit = order.reverse().find((c) => {
        const b = lastBounds[c.id];
        return Math.abs(p.x - b.cx) <= b.w / 2 && Math.abs(p.y - b.cy) <= b.h / 2;
      });
      if (hit) { selectedId = hit.id; renderTimeline(); renderInspector(); }
      const c = selected();
      if (!c || c.kind === 'audio') { requestRender(); return; }
      drag = { p0: p, x0: getProp(c, 'x'), y0: getProp(c, 'y'), pushed: false };
      requestRender();
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const c = selected();
      if (!c) return;
      const p = toCanvas(e);
      if (!drag.pushed) { pushHistory(); drag.pushed = true; }
      let nx = drag.x0 + ((p.x - drag.p0.x) / stage.width) * 2;
      let ny = drag.y0 + ((p.y - drag.p0.y) / stage.height) * 2;
      if (Math.abs(nx) < 0.02) nx = 0; // aimant au centre
      if (Math.abs(ny) < 0.02) ny = 0;
      setProp(c, 'x', nx); setProp(c, 'y', ny);
      requestRender();
    });
    window.addEventListener('mouseup', () => { if (drag) { drag = null; renderInspector(); } });
    stage.addEventListener('wheel', (e) => {
      const c = selected();
      if (!c || c.kind === 'audio') return;
      e.preventDefault();
      pushHistory();
      setProp(c, 'scale', clamp(getProp(c, 'scale') * (e.deltaY < 0 ? 1.05 : 1 / 1.05), 0.05, 10));
      requestRender();
      renderInspector();
    }, { passive: false });
  })();

  // ---------------------------------------------------------------- Timeline
  const tlScroll = $('#tlScroll');
  const tracksEl = $('#tracks');
  const ruler = $('#ruler');
  const playheadEl = $('#playhead');

  function orderedTracks() {
    const vis = project.tracks.filter((t) => t.kind === 'visual').reverse();
    const aud = project.tracks.filter((t) => t.kind === 'audio');
    return [...vis, ...aud];
  }

  function timelineWidth() {
    return Math.max(tlScroll.clientWidth, (totalDuration() + 30) * pps);
  }

  function renderTimeline() {
    const w = timelineWidth();
    $('#tlInner').style.width = w + 'px';
    tracksEl.innerHTML = '';
    const heads = $('#trackHeads');
    heads.innerHTML = '';
    orderedTracks().forEach((t) => {
      // en-tête
      const h = document.createElement('div');
      h.className = 'track-head';
      const icon = t.kind === 'audio' ? '♪' : t.main ? '★' : '▣';
      h.innerHTML = `<span class="name"></span>`;
      h.querySelector('.name').textContent = `${icon} ${t.name}`;
      const mute = document.createElement('button');
      mute.textContent = t.muted ? '🔇' : '🔊';
      mute.title = t.muted ? 'Réactiver le son' : 'Couper le son';
      mute.className = t.muted ? 'on' : '';
      mute.onclick = () => { pushHistory(); t.muted = !t.muted; refreshAll(); };
      h.appendChild(mute);
      if (t.kind === 'visual') {
        const eye = document.createElement('button');
        eye.textContent = t.hidden ? '◌' : '👁';
        eye.title = t.hidden ? 'Afficher la piste' : 'Masquer la piste';
        eye.className = t.hidden ? 'on' : '';
        eye.onclick = () => { pushHistory(); t.hidden = !t.hidden; refreshAll(); };
        h.appendChild(eye);
      }
      if (!t.main && !project.clips.some((c) => c.trackId === t.id) && project.tracks.filter((x) => x.kind === t.kind).length > 1) {
        const del = document.createElement('button');
        del.textContent = '✕';
        del.title = 'Supprimer la piste vide';
        del.onclick = () => { pushHistory(); project.tracks = project.tracks.filter((x) => x.id !== t.id); refreshAll(); };
        h.appendChild(del);
      }
      heads.appendChild(h);

      // piste
      const tr = document.createElement('div');
      tr.className = 'track';
      tr.dataset.trackId = t.id;
      tr.dataset.kind = t.kind;
      tr.addEventListener('mousedown', (e) => {
        if (e.target !== tr) return;
        selectedId = null;
        seek((e.offsetX) / pps);
        renderTimeline();
        renderInspector();
      });
      tr.addEventListener('dragover', (e) => {
        if (!e.dataTransfer.types.includes('application/x-vidio-media')) return;
        e.preventDefault();
        tr.classList.add('drop-target');
      });
      tr.addEventListener('dragleave', () => tr.classList.remove('drop-target'));
      tr.addEventListener('drop', (e) => {
        const id = e.dataTransfer.getData('application/x-vidio-media');
        tr.classList.remove('drop-target');
        if (!id) return;
        e.preventDefault();
        e.stopPropagation();
        const m = mediaById(id);
        if (!m || m.missing) return;
        const r = tr.getBoundingClientRect();
        const at = Math.max(0, (e.clientX - r.left) / pps);
        addMediaToTimeline(m, snapTime(at, null).t, t.id);
      });
      const tclips = project.clips.filter((c) => c.trackId === t.id);
      tclips.forEach((c) => tr.appendChild(clipElement(c, t)));
      if (t.kind === 'visual') {
        tclips.forEach((c) => {
          const prev = tclips.find((x) => x.id !== c.id && Math.abs(x.start + x.dur - c.start) < 0.02);
          if (!prev || c.kind === 'text') return;
          const has = c.transition && c.transition.type !== 'none';
          const b = document.createElement('div');
          b.className = 'trans-btn' + (has ? ' on' : '');
          b.style.left = c.start * pps + 'px';
          b.textContent = has ? (P.transitions.find((x) => x.id === c.transition.type) || {}).icon || '⧓' : '+';
          b.title = has ? `Transition : ${(P.transitions.find((x) => x.id === c.transition.type) || {}).name}` : 'Ajouter une transition';
          b.addEventListener('mousedown', (ev) => {
            ev.stopPropagation();
            selectedId = c.id;
            openTab('transitions');
            renderTimeline(); renderInspector(); requestRender();
          });
          tr.appendChild(b);
        });
      }
      tracksEl.appendChild(tr);
    });
    drawRuler();
    positionPlayhead();
    $('#timeTotal').textContent = fmtTime(totalDuration());
    updateEmptyState();
  }

  function clipElement(c, track) {
    const m = mediaById(c.mediaId);
    const el = document.createElement('div');
    el.className = `clip ${c.kind}${c.id === selectedId ? ' selected' : ''}`;
    el.style.left = c.start * pps + 'px';
    el.style.width = Math.max(4, c.dur * pps) + 'px';
    el.dataset.id = c.id;
    if (track.hidden || (track.kind === 'audio' && track.muted)) el.style.opacity = 0.45;
    if (m && m.thumb && c.kind !== 'audio') el.style.backgroundImage = `url(${m.thumb})`;
    const label = document.createElement('div');
    label.className = 'label';
    let name = c.kind === 'text' ? `T  ${(c.text && c.text.content) || ''}` : m ? m.name : '(média manquant)';
    label.textContent = name;
    if (c.speed !== 1) label.insertAdjacentHTML('beforeend', `<span class="badge">${c.speed}×</span>`);
    if (c.muted && c.kind === 'video') label.insertAdjacentHTML('beforeend', `<span class="badge">🔇</span>`);
    if (c.filterId && c.filterId !== 'none') label.insertAdjacentHTML('beforeend', `<span class="badge">◐</span>`);
    if (c.effect && c.effect.type !== 'none') label.insertAdjacentHTML('beforeend', `<span class="badge">✦</span>`);
    if (c.reversedFrom) label.insertAdjacentHTML('beforeend', `<span class="badge">⇄</span>`);
    if (c.denoise) label.insertAdjacentHTML('beforeend', `<span class="badge">🎧</span>`);
    el.appendChild(label);
    if (m && m.peaks && (c.kind === 'audio')) el.appendChild(waveCanvas(c, m));
    if (c.fadeIn > 0) { const f = document.createElement('div'); f.className = 'fade in'; f.style.width = c.fadeIn * pps + 'px'; el.appendChild(f); }
    if (c.fadeOut > 0) { const f = document.createElement('div'); f.className = 'fade out'; f.style.width = c.fadeOut * pps + 'px'; el.appendChild(f); }
    kfTimes(c).forEach((kt) => {
      const d = document.createElement('div');
      d.className = 'kf';
      d.style.left = kt * pps + 'px';
      d.title = `Image clé à ${fmtTime(c.start + kt)}`;
      d.addEventListener('mousedown', (ev) => { ev.stopPropagation(); selectedId = c.id; seek(c.start + kt); renderTimeline(); renderInspector(); });
      el.appendChild(d);
    });
    const hl = document.createElement('div'); hl.className = 'handle l';
    const hr = document.createElement('div'); hr.className = 'handle r';
    el.append(hl, hr);
    el.addEventListener('mousedown', (e) => startClipDrag(e, c, e.target === hl ? 'l' : e.target === hr ? 'r' : 'move'));
    return el;
  }

  function waveCanvas(c, m) {
    const cv = document.createElement('canvas');
    cv.className = 'wave';
    const w = Math.min(4000, Math.max(4, Math.round(c.dur * pps)));
    cv.width = w; cv.height = 40;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = 'rgba(160,255,200,.75)';
    const rate = 50;
    for (let x = 0; x < w; x++) {
      const srcT = c.in + ((x / w) * c.dur) * c.speed;
      const v = m.peaks[Math.floor(srcT * rate)] || 0;
      const h = Math.max(1, v * 38 * Math.min(1.5, c.volume));
      ctx.fillRect(x, 40 - h, 1, h);
    }
    return cv;
  }

  // Aimantation
  let snapLine = null;
  function snapTime(t, excludeId, extraPoints = []) {
    if (!$('#snapToggle').checked) return { t, snapped: false };
    const pts = [0, time, ...extraPoints];
    project.clips.forEach((c) => { if (c.id !== excludeId) pts.push(c.start, c.start + c.dur); });
    const thr = 8 / pps;
    let best = null;
    pts.forEach((p) => { const d = Math.abs(p - t); if (d < thr && (!best || d < best.d)) best = { p, d }; });
    return best ? { t: best.p, snapped: true } : { t, snapped: false };
  }
  function showSnap(t) {
    if (!snapLine) { snapLine = document.createElement('div'); snapLine.className = 'snap-line'; $('#tlInner').appendChild(snapLine); }
    snapLine.style.display = t == null ? 'none' : 'block';
    if (t != null) snapLine.style.left = t * pps + 'px';
  }

  function startClipDrag(e, c, mode) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (selectedId !== c.id) { selectedId = c.id; renderInspector(); }
    $$('.clip.selected').forEach((x) => x.classList.remove('selected'));
    e.currentTarget.classList.add('selected');
    requestRender();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const orig = clone(c);
    let el = e.currentTarget;
    let pushed = false;
    let moved = false;
    const kind = trackKindFor(c.kind);

    const onMove = (ev) => {
      const dt = (ev.clientX - x0) / pps;
      if (!moved && Math.abs(ev.clientX - x0) < 3 && Math.abs(ev.clientY - y0) < 8) return;
      moved = true;
      if (!pushed) { undoStack.push(JSON.stringify(Object.assign(JSON.parse(snapshot()), { clips: project.clips.map((x) => (x.id === c.id ? orig : x)) }))); redoStack = []; pushed = true; markDirty(); }
      if (mode === 'move') {
        let ns = Math.max(0, orig.start + dt);
        const s1 = snapTime(ns, c.id);
        const s2 = snapTime(ns + c.dur, c.id);
        if (s1.snapped) { ns = s1.t; showSnap(ns); } else if (s2.snapped) { ns = s2.t - c.dur; showSnap(s2.t); } else showSnap(null);
        ns = Math.max(0, ns);
        // changement de piste
        const tu = trackUnder(ev);
        let target = c.trackId;
        if (tu && tu.dataset.kind === kind) target = tu.dataset.trackId;
        if (isFree(target, ns, ns + c.dur, c.id)) {
          c.start = ns;
          if (target !== c.trackId) {
            c.trackId = target;
            renderTimeline();
            el = tracksEl.querySelector(`.clip[data-id="${c.id}"]`) || el;
            requestRender();
            return;
          }
        } else if (isFree(c.trackId, ns, ns + c.dur, c.id)) {
          c.start = ns;
        }
        el.style.left = c.start * pps + 'px';
      } else if (mode === 'l') {
        let ns = orig.start + dt;
        const sn = snapTime(ns, c.id); ns = sn.t; showSnap(sn.snapped ? ns : null);
        const minStart = c.kind === 'text' || (mediaById(c.mediaId) || {}).type === 'image' ? -Infinity : orig.start - orig.in / orig.speed;
        // borne gauche : clip précédent sur la piste
        const prevEnd = project.clips.filter((x) => x.trackId === c.trackId && x.id !== c.id && x.start + x.dur <= orig.start + EPS).reduce((m, x) => Math.max(m, x.start + x.dur), 0);
        ns = clamp(ns, Math.max(0, minStart, prevEnd), orig.start + orig.dur - MIN_DUR);
        const d = ns - orig.start;
        c.start = ns;
        c.dur = orig.dur - d;
        c.in = Math.max(0, orig.in + d * orig.speed);
        if (orig.keyframes) { c.keyframes = clone(orig.keyframes); shiftKeyframes(c, -d); }
        el.style.left = c.start * pps + 'px';
        el.style.width = c.dur * pps + 'px';
      } else if (mode === 'r') {
        let ne = orig.start + orig.dur + dt;
        const sn = snapTime(ne, c.id); ne = sn.t; showSnap(sn.snapped ? ne : null);
        const nextStart = project.clips.filter((x) => x.trackId === c.trackId && x.id !== c.id && x.start >= orig.start + orig.dur - EPS).reduce((m, x) => Math.min(m, x.start), Infinity);
        const maxEnd = Math.min(nextStart, orig.start + maxDurFor(orig));
        ne = clamp(ne, orig.start + MIN_DUR, maxEnd);
        c.dur = ne - orig.start;
        el.style.width = c.dur * pps + 'px';
      }
      requestRender();
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      showSnap(null);
      renderTimeline();
      renderInspector();
      requestRender();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function trackUnder(ev) {
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    return el && el.closest ? el.closest('.track') : null;
  }

  function drawRuler() {
    const w = tlScroll.clientWidth;
    const dpr = window.devicePixelRatio || 1;
    ruler.width = w * dpr; ruler.height = 26 * dpr;
    ruler.style.width = w + 'px'; ruler.style.height = '26px';
    const ctx = ruler.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#161921'; ctx.fillRect(0, 0, w, 26);
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const major = steps.find((s) => s * pps >= 80) || 600;
    const minor = major / 5;
    const off = tlScroll.scrollLeft;
    const i0 = Math.floor(off / pps / minor);
    ctx.fillStyle = '#8a92a3';
    ctx.strokeStyle = '#3a4150';
    ctx.font = '10px Segoe UI, sans-serif';
    for (let i = i0; i * minor * pps - off < w; i++) {
      const t = Math.round(i * minor * 1000) / 1000;
      const x = Math.round(t * pps - off) + 0.5;
      const isMajor = i % 5 === 0;
      ctx.beginPath(); ctx.moveTo(x, isMajor ? 12 : 19); ctx.lineTo(x, 26); ctx.stroke();
      if (isMajor) ctx.fillText(major < 1 ? `${t.toFixed(1)}s` : fmtTime(t, true), x + 3, 11);
    }
    ctx.strokeStyle = '#2a2f3b'; ctx.beginPath(); ctx.moveTo(0, 25.5); ctx.lineTo(w, 25.5); ctx.stroke();
  }

  function positionPlayhead() { playheadEl.style.left = time * pps + 'px'; }
  function followPlayhead() {
    const x = time * pps;
    if (x > tlScroll.scrollLeft + tlScroll.clientWidth - 40) tlScroll.scrollLeft = x - 80;
  }
  function ensureVisible(t) {
    const x = t * pps;
    if (x < tlScroll.scrollLeft || x > tlScroll.scrollLeft + tlScroll.clientWidth - 60) tlScroll.scrollLeft = Math.max(0, x - 80);
  }
  function setZoom(v, anchorT) {
    const a = anchorT != null ? anchorT : time;
    const screenX = a * pps - tlScroll.scrollLeft;
    pps = clamp(v, 10, 400);
    $('#zoom').value = pps;
    renderTimeline();
    tlScroll.scrollLeft = Math.max(0, a * pps - screenX);
    drawRuler();
  }

  // Défilement / clic sur la règle
  tlScroll.addEventListener('scroll', () => { drawRuler(); $('#trackHeads').scrollTop = tlScroll.scrollTop; });
  tlScroll.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const r = tlScroll.getBoundingClientRect();
      const t = (e.clientX - r.left + tlScroll.scrollLeft) / pps;
      setZoom(pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15), t);
    } else if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX) && tlScroll.scrollHeight <= tlScroll.clientHeight + 2) {
      tlScroll.scrollLeft += e.deltaY;
    }
  }, { passive: false });
  ruler.addEventListener('mousedown', (e) => {
    const scrub = (ev) => {
      const r = ruler.getBoundingClientRect();
      seek((ev.clientX - r.left + tlScroll.scrollLeft) / pps);
    };
    scrub(e);
    const up = () => { window.removeEventListener('mousemove', scrub); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', scrub);
    window.addEventListener('mouseup', up);
  });

  // ---------------------------------------------------------------- Inspecteur
  let editSession = false;
  function beginEdit() { if (!editSession) { pushHistory(); editSession = true; } }
  function endEdit() { editSession = false; renderTimeline(); }

  function renderInspector() {
    const c = selected();
    $('#inspectorEmpty').classList.toggle('hidden', !!c);
    const ins = $('#inspector');
    ins.classList.toggle('hidden', !c);
    highlightPresets();
    if (!c) return;
    ins.innerHTML = '';
    const m = mediaById(c.mediaId);
    const kindName = { video: 'Vidéo', image: 'Image', audio: 'Audio', text: 'Texte' }[c.kind];
    const h = document.createElement('h3');
    h.innerHTML = `<span class="tag">${kindName}</span><span class="t"></span>`;
    h.querySelector('.t').textContent = c.kind === 'text' ? 'Texte' : m ? m.name : '';
    ins.appendChild(h);

    const group = (title) => {
      const g = document.createElement('div');
      g.className = 'group';
      g.innerHTML = `<h4>${title}</h4>`;
      ins.appendChild(g);
      return g;
    };
    const slider = (g, label, get, set, min, max, step, fmt = (v) => v) => {
      const f = document.createElement('div');
      f.className = 'field';
      f.innerHTML = `<label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}"><span class="val"></span>`;
      const inp = f.querySelector('input');
      const val = f.querySelector('.val');
      inp.value = get();
      val.textContent = fmt(+inp.value);
      inp.addEventListener('input', () => { beginEdit(); set(+inp.value); val.textContent = fmt(+inp.value); requestRender(); });
      inp.addEventListener('change', endEdit);
      inp.addEventListener('dblclick', () => { beginEdit(); const d = inp.dataset.def; if (d != null) { set(+d); inp.value = d; val.textContent = fmt(+d); requestRender(); } endEdit(); });
      g.appendChild(f);
      return inp;
    };
    const fieldRaw = (g, label, node) => {
      const f = document.createElement('div');
      f.className = 'field two';
      f.innerHTML = `<label>${label}</label>`;
      f.appendChild(node);
      g.appendChild(f);
      return node;
    };
    const buttons = (g, items) => {
      const row = document.createElement('div');
      row.className = 'btn-row';
      items.forEach(([label, fn, active, title]) => {
        const b = document.createElement('button');
        b.className = 'ghost small' + (active ? ' active' : '');
        b.textContent = label;
        if (title) b.title = title;
        b.onclick = () => { fn(); refreshAll(); };
        row.appendChild(b);
      });
      g.appendChild(row);
    };
    const pct = (v) => `${Math.round(v * 100)}%`;

    // --- Texte
    if (c.kind === 'text') {
      const s = c.text;
      const g = group('Texte');
      const ta = document.createElement('textarea');
      ta.value = s.content;
      ta.addEventListener('input', () => {
        beginEdit();
        s.content = ta.value;
        if (s.words && s.words.length) {
          const ws = ta.value.split(/\s+/).filter(Boolean);
          if (ws.length === s.words.length) ws.forEach((w, i) => { s.words[i].w = w; });
          else {
            const d = c.dur / Math.max(1, ws.length);
            s.words = ws.map((w, i) => ({ w, t0: i * d, t1: (i + 1) * d }));
          }
        }
        requestRender();
      });
      ta.addEventListener('change', endEdit);
      g.appendChild(ta);
      const sel = document.createElement('select');
      P.fonts.forEach((f) => { const o = document.createElement('option'); o.value = o.textContent = f; o.style.fontFamily = f; sel.appendChild(o); });
      sel.value = s.font;
      sel.onchange = () => { pushHistory(); s.font = sel.value; requestRender(); };
      fieldRaw(g, 'Police', sel);
      slider(g, 'Taille', () => s.size, (v) => (s.size = v), 16, 400, 1, (v) => v);
      const color = document.createElement('input'); color.type = 'color'; color.value = s.color;
      color.oninput = () => { beginEdit(); s.color = color.value; requestRender(); }; color.onchange = endEdit;
      fieldRaw(g, 'Couleur', color);
      buttons(g, [
        ['G', () => { pushHistory(); s.bold = !s.bold; }, s.bold, 'Gras'],
        ['I', () => { pushHistory(); s.italic = !s.italic; }, s.italic, 'Italique'],
        ['⟸', () => { pushHistory(); s.align = 'left'; }, s.align === 'left', 'Aligner à gauche'],
        ['≡', () => { pushHistory(); s.align = 'center'; }, s.align === 'center', 'Centrer'],
        ['⟹', () => { pushHistory(); s.align = 'right'; }, s.align === 'right', 'Aligner à droite'],
      ]);
      if (s.words && s.words.length) {
        const gc = group('Sous-titre animé');
        const ms = document.createElement('select');
        [['color', 'Mot coloré'], ['box', 'Mot surligné'], ['pop', 'Mot qui rebondit'], ['single', 'Un mot à la fois'], ['none', 'Sans effet']].forEach(([v, n]) => { const o = document.createElement('option'); o.value = v; o.textContent = n; ms.appendChild(o); });
        ms.value = s.highlightMode || 'color';
        ms.onchange = () => { pushHistory(); s.highlightMode = ms.value; requestRender(); };
        fieldRaw(gc, 'Animation', ms);
        const hc = document.createElement('input'); hc.type = 'color'; hc.value = s.highlight || '#ffde00';
        hc.oninput = () => { beginEdit(); s.highlight = hc.value; requestRender(); }; hc.onchange = endEdit;
        fieldRaw(gc, 'Surbrillance', hc);
        buttons(gc, [['Appliquer ce style à tous les sous-titres', () => {
          pushHistory();
          const keep = ['font', 'size', 'color', 'bold', 'italic', 'stroke', 'strokeWidth', 'bg', 'bgOpacity', 'shadow', 'highlight', 'highlightMode', 'lineHeight'];
          project.clips.filter((x) => x.caption && x.id !== c.id).forEach((x) => { keep.forEach((k) => { x.text[k] = s[k]; }); x.transform = clone(c.transform); });
          toast('Style appliqué à tous les sous-titres');
        }, false]]);
      }
      const g2 = group('Contour & fond');
      const sc = document.createElement('input'); sc.type = 'color'; sc.value = s.stroke;
      sc.oninput = () => { beginEdit(); s.stroke = sc.value; requestRender(); }; sc.onchange = endEdit;
      fieldRaw(g2, 'Contour', sc);
      slider(g2, 'Épaisseur', () => s.strokeWidth, (v) => (s.strokeWidth = v), 0, 20, 1);
      const bc = document.createElement('input'); bc.type = 'color'; bc.value = s.bg;
      bc.oninput = () => { beginEdit(); s.bg = bc.value; requestRender(); }; bc.onchange = endEdit;
      fieldRaw(g2, 'Fond', bc);
      slider(g2, 'Opacité fond', () => s.bgOpacity, (v) => (s.bgOpacity = v), 0, 1, 0.05, pct);
      slider(g2, 'Ombre', () => s.shadow, (v) => (s.shadow = v), 0, 1, 0.05, pct);
      slider(g2, 'Interligne', () => s.lineHeight, (v) => (s.lineHeight = v), 0.8, 2.5, 0.05, (v) => v.toFixed(2));
    }

    // --- Transformation (avec images clés)
    if (c.kind !== 'audio') {
      const g = group('Position & taille');
      const head = g.querySelector('h4');
      head.insertAdjacentHTML('beforeend', ' <span class="kf-hint">◆ = image clé au curseur</span>');
      const kfSlider = (key, label, min, max, step, fmt, def) => {
        const f = document.createElement('div');
        f.className = 'field kfield';
        f.innerHTML = `<label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}"><span class="val"></span><button class="kfbtn" title="Ajouter / retirer une image clé à la position du curseur">◆</button>`;
        const inp = f.querySelector('input'), val = f.querySelector('.val'), kb = f.querySelector('.kfbtn');
        const lt = localTime(c);
        const onKf = hasKf(c, key) && c.keyframes[key].some((x) => Math.abs(x.t - lt) < 0.5 / project.fps);
        kb.classList.toggle('has', hasKf(c, key));
        kb.classList.toggle('on', onKf);
        inp.value = getProp(c, key);
        val.textContent = fmt(+inp.value);
        inp.addEventListener('input', () => { beginEdit(); setProp(c, key, +inp.value); val.textContent = fmt(+inp.value); requestRender(); });
        inp.addEventListener('change', () => { endEdit(); renderInspector(); });
        inp.addEventListener('dblclick', () => { beginEdit(); setProp(c, key, def); endEdit(); renderInspector(); requestRender(); });
        kb.onclick = () => { pushHistory(); toggleKf(c, key); refreshAll(); };
        g.appendChild(f);
      };
      kfSlider('x', 'Position X', -2, 2, 0.01, (v) => v.toFixed(2), 0);
      kfSlider('y', 'Position Y', -2, 2, 0.01, (v) => v.toFixed(2), 0);
      kfSlider('scale', 'Échelle', 0.05, 5, 0.01, pct, 1);
      kfSlider('rotation', 'Rotation', -180, 180, 1, (v) => `${v}°`, 0);
      kfSlider('opacity', 'Opacité', 0, 1, 0.01, pct, 1);
      const items = [];
      if (c.kind !== 'text') {
        items.push(['Ajuster', () => { pushHistory(); c.fit = 'contain'; }, c.fit !== 'cover', 'Toute l\'image visible']);
        items.push(['Remplir', () => { pushHistory(); c.fit = 'cover'; }, c.fit === 'cover', 'Remplir le cadre (recadrage)']);
      }
      items.push(['⇋', () => { pushHistory(); c.flipH = !c.flipH; }, c.flipH, 'Miroir horizontal']);
      items.push(['⇵', () => { pushHistory(); c.flipV = !c.flipV; }, c.flipV, 'Miroir vertical']);
      items.push(['Réinitialiser', () => { pushHistory(); c.transform = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }; c.keyframes = {}; c.flipH = c.flipV = false; }, false]);
      buttons(g, items);
      if (kfTimes(c).length) {
        const nav = [];
        const ts = kfTimes(c);
        nav.push(['◀ ◆', () => { const lt = localTime(c); const p = ts.filter((x) => x < lt - 1e-3).pop(); if (p != null) seek(c.start + p); }, false, 'Image clé précédente']);
        nav.push(['◆ ▶', () => { const lt = localTime(c); const n = ts.find((x) => x > lt + 1e-3); if (n != null) seek(c.start + n); }, false, 'Image clé suivante']);
        nav.push([c.kfLinear ? 'Linéaire' : 'Adouci', () => { pushHistory(); c.kfLinear = !c.kfLinear; }, false, 'Courbe entre images clés']);
        nav.push(['Effacer les ◆', () => { pushHistory(); Object.keys(c.keyframes).forEach((k) => { c.transform[k] = getProp(c, k); }); c.keyframes = {}; }, false]);
        buttons(g, nav);
      }
    }

    // --- Transition d'entrée
    if (c.kind === 'video' || c.kind === 'image') {
      const prev = project.clips.find((x) => x.trackId === c.trackId && x.id !== c.id && Math.abs(x.start + x.dur - c.start) < 0.02);
      if (prev) {
        const g = group('Transition depuis le clip précédent');
        c.transition = c.transition || { type: 'none', dur: 0.5 };
        const sel = document.createElement('select');
        P.transitions.forEach((x) => { const o = document.createElement('option'); o.value = x.id; o.textContent = `${x.icon} ${x.name}`; sel.appendChild(o); });
        sel.value = c.transition.type;
        sel.onchange = () => { pushHistory(); c.transition.type = sel.value; refreshAll(); seek(Math.max(0, c.start - c.transition.dur)); };
        fieldRaw(g, 'Type', sel);
        slider(g, 'Durée', () => c.transition.dur, (v) => (c.transition.dur = v), 0.1, 3, 0.05, (v) => `${v.toFixed(2)} s`);
      }
    }

    // --- Recadrage
    if (c.kind === 'video' || c.kind === 'image') {
      const g = group('Recadrage');
      c.crop = c.crop || { l: 0, t: 0, r: 0, b: 0 };
      const cr = c.crop;
      slider(g, 'Gauche', () => cr.l, (v) => (cr.l = Math.min(v, 0.95 - cr.r)), 0, 0.9, 0.005, pct).dataset.def = 0;
      slider(g, 'Droite', () => cr.r, (v) => (cr.r = Math.min(v, 0.95 - cr.l)), 0, 0.9, 0.005, pct).dataset.def = 0;
      slider(g, 'Haut', () => cr.t, (v) => (cr.t = Math.min(v, 0.95 - cr.b)), 0, 0.9, 0.005, pct).dataset.def = 0;
      slider(g, 'Bas', () => cr.b, (v) => (cr.b = Math.min(v, 0.95 - cr.t)), 0, 0.9, 0.005, pct).dataset.def = 0;
      buttons(g, [['Sans recadrage', () => { pushHistory(); c.crop = { l: 0, t: 0, r: 0, b: 0 }; }, false]]);
    }

    // --- Durée & vitesse
    {
      const g = group('Durée & vitesse');
      const info = document.createElement('p');
      info.className = 'hint';
      info.textContent = `Début ${fmtTime(c.start)} · Durée ${fmtTime(c.dur)}`;
      g.appendChild(info);
      if (c.kind === 'text' || c.kind === 'image') {
        const inp = document.createElement('input');
        inp.type = 'number'; inp.min = MIN_DUR; inp.step = 0.1; inp.value = c.dur.toFixed(2);
        inp.onchange = () => {
          let v = Math.max(MIN_DUR, +inp.value || MIN_DUR);
          const nextStart = project.clips.filter((x) => x.trackId === c.trackId && x.id !== c.id && x.start >= c.start + c.dur - EPS).reduce((mm, x) => Math.min(mm, x.start), Infinity);
          if (c.start + v > nextStart) { v = nextStart - c.start; toast('Durée limitée par le clip suivant'); }
          pushHistory(); c.dur = v; refreshAll();
        };
        fieldRaw(g, 'Durée (s)', inp);
      }
      if (c.kind === 'video' || c.kind === 'audio') {
        const speeds = [0.25, 0.5, 1, 1.5, 2, 3, 4];
        buttons(g, speeds.map((s) => [`${s}×`, () => setSpeed(c, s), Math.abs(c.speed - s) < 1e-3]));
      }
    }

    // --- Audio
    if (c.kind === 'video' || c.kind === 'audio') {
      const g = group('Audio');
      if (c.kind === 'video' && m && !m.hasAudio) {
        g.insertAdjacentHTML('beforeend', '<p class="hint">Cette vidéo ne contient pas de piste audio.</p>');
      } else {
        slider(g, 'Volume', () => c.volume, (v) => (c.volume = v), 0, 2, 0.01, pct).dataset.def = 1;
        const items = [[c.muted ? '🔇 Muet' : '🔊 Son actif', () => { pushHistory(); c.muted = !c.muted; }, c.muted]];
        if (c.kind === 'video') items.push(['Détacher l\'audio', () => detachAudio(c), false, 'Place le son sur une piste audio séparée']);
        items.push(['🎧 Réduire le bruit', () => { pushHistory(); c.denoise = !c.denoise; }, c.denoise, 'Réduction du bruit de fond (appliquée à l\'export)']);
        buttons(g, items);
      }
    }

    // --- Réglages couleur
    if (c.kind === 'video' || c.kind === 'image') {
      const g = group('Réglages');
      const a = (c.adjust = c.adjust || {});
      const D = P.defaultAdjust;
      const adj = (key, label, min, max, step, fmt) => {
        slider(g, label, () => (a[key] != null ? a[key] : D[key]), (v) => { a[key] = v; c.filterId = 'custom'; }, min, max, step, fmt).dataset.def = D[key];
      };
      adj('brightness', 'Luminosité', 0, 2, 0.01, pct);
      adj('contrast', 'Contraste', 0, 2, 0.01, pct);
      adj('saturate', 'Saturation', 0, 3, 0.01, pct);
      adj('hue', 'Teinte', -180, 180, 1, (v) => `${v}°`);
      adj('blur', 'Flou', 0, 10, 0.1, (v) => v.toFixed(1));
      adj('grayscale', 'N&B', 0, 1, 0.01, pct);
      adj('sepia', 'Sépia', 0, 1, 0.01, pct);
      adj('vignette', 'Vignette', 0, 1, 0.01, pct);
      buttons(g, [['Réinitialiser', () => { pushHistory(); c.adjust = {}; c.filterId = 'none'; }, false]]);
    }

    // --- Effet vidéo
    if (c.kind === 'video' || c.kind === 'image') {
      const g = group('Effet vidéo');
      c.effect = c.effect || { type: 'none', intensity: 0.5 };
      const sel = document.createElement('select');
      P.effects.forEach((x) => { const o = document.createElement('option'); o.value = x.id; o.textContent = x.name; sel.appendChild(o); });
      sel.value = c.effect.type;
      sel.onchange = () => { pushHistory(); c.effect.type = sel.value; refreshAll(); };
      fieldRaw(g, 'Effet', sel);
      if (c.effect.type !== 'none') slider(g, 'Intensité', () => c.effect.intensity, (v) => (c.effect.intensity = v), 0, 1, 0.01, pct);
    }

    // --- Animations & fondus
    if (true) {
      const g = group('Animations & fondus');
      if (c.kind !== 'audio') {
        const mk = (list, obj, label) => {
          const sel = document.createElement('select');
          list.forEach((x) => { const o = document.createElement('option'); o.value = x.id; o.textContent = x.name; sel.appendChild(o); });
          sel.value = obj.type;
          sel.onchange = () => { pushHistory(); obj.type = sel.value; requestRender(); renderAnimGrids(); };
          fieldRaw(g, label, sel);
          slider(g, 'Durée anim.', () => obj.dur, (v) => (obj.dur = v), 0.1, 3, 0.05, (v) => `${v.toFixed(2)} s`);
        };
        mk(P.animIn, c.animIn, 'Entrée');
        mk(P.animOut, c.animOut, 'Sortie');
      }
      slider(g, 'Fondu entrée', () => c.fadeIn, (v) => (c.fadeIn = Math.min(v, c.dur / 2)), 0, 5, 0.05, (v) => `${v.toFixed(2)} s`);
      slider(g, 'Fondu sortie', () => c.fadeOut, (v) => (c.fadeOut = Math.min(v, c.dur / 2)), 0, 5, 0.05, (v) => `${v.toFixed(2)} s`);
    }

    const g = group('Actions');
    if (c.kind === 'video') {
      buttons(g, [
        ['❄ Figer l\'image', () => freezeFrame(c), false, 'Insère une image fixe de 3 s au curseur'],
        [c.reversedFrom ? '⇄ Annuler l\'inversion' : '⇄ Inverser', () => reverseClip(c), !!c.reversedFrom, 'Lire le clip à l\'envers'],
      ]);
    }
    buttons(g, [
      ['✂ Couper', () => splitAt(time), false],
      ['⧉ Dupliquer', duplicateSelected, false],
      ['🗑 Supprimer', deleteSelected, false],
    ]);
  }

  function setSpeed(c, s) {
    pushHistory();
    const srcLen = c.dur * c.speed;
    let nd = srcLen / s;
    const nextStart = project.clips.filter((x) => x.trackId === c.trackId && x.id !== c.id && x.start >= c.start + c.dur - EPS).reduce((m, x) => Math.min(m, x.start), Infinity);
    if (c.start + nd > nextStart) nd = nextStart - c.start;
    c.speed = s;
    c.dur = Math.max(MIN_DUR, nd);
  }

  // ---------------------------------------------------------------- Fonctions v1.1
  function openTab(name) {
    const b = document.querySelector(`#leftTabs button[data-tab="${name}"]`);
    if (b) b.click();
  }

  async function freezeFrame(c) {
    const m = mediaById(c.mediaId);
    if (!m || c.kind !== 'video') return;
    if (time < c.start || time > c.start + c.dur) { toast('Placez le curseur sur le clip'); return; }
    toast('Capture de l\'image…');
    try {
      const info = await api.frameToImage({ file: m.path, time: R.srcTime(c, time, m.duration) });
      const im = Object.assign({ id: uid() }, info);
      im.name = `Image figée — ${m.name}`;
      im.thumb = await makeThumb(im).catch(() => null);
      project.media.push(im);
      pushHistory();
      const t = time;
      const dur = 3;
      if (t > c.start + 0.05 && t < c.start + c.dur - 0.05) splitClip(c, t);
      project.clips.forEach((x) => { if (x.trackId === c.trackId && x.start >= t - 1e-4) x.start += dur; });
      const f = makeClip('image', c.trackId, t, dur, { mediaId: im.id, fit: c.fit, adjust: clone(c.adjust || {}), filterId: c.filterId, crop: clone(c.crop || {}), transform: clone(c.transform) });
      project.clips.push(f);
      selectedId = f.id;
      refreshAll();
      toast('Image figée insérée (3 s)');
    } catch (e) { toast(`Échec : ${e.message || e}`, 4000); }
  }

  async function reverseClip(c) {
    if (c.reversedFrom) {
      pushHistory();
      c.mediaId = c.reversedFrom.mediaId; c.in = c.reversedFrom.in; delete c.reversedFrom;
      refreshAll();
      return;
    }
    const m = mediaById(c.mediaId);
    if (!m) return;
    const len = c.dur * c.speed;
    if (len > 120) { toast('Inversion limitée aux clips de moins de 2 minutes — coupez le clip d\'abord', 4000); return; }
    toast('Inversion en cours… (quelques secondes)', 6000);
    try {
      const info = await api.reverseMedia({ file: m.path, start: c.in, len, hasAudio: m.hasAudio });
      let rm = project.media.find((x) => x.path === info.path);
      if (!rm) {
        rm = Object.assign({ id: uid() }, info, { name: `${m.name} (inversé)`, hidden: true });
        rm.thumb = await makeThumb(rm).catch(() => null);
        project.media.push(rm);
        prepareMedia(rm);
      }
      pushHistory();
      c.reversedFrom = { mediaId: c.mediaId, in: c.in };
      c.mediaId = rm.id;
      c.in = 0;
      refreshAll();
      toast('Clip inversé');
    } catch (e) { toast(`Échec de l'inversion : ${e.message || e}`, 5000); }
  }

  function cutsOnTrack(trackId) {
    const list = project.clips.filter((c) => c.trackId === trackId && c.kind !== 'text' && c.kind !== 'audio').sort((a, b) => a.start - b.start);
    return list.filter((c, i) => i > 0 && Math.abs(list[i - 1].start + list[i - 1].dur - c.start) < 0.02);
  }
  function applyTransition(type, dur, scope) {
    let targets;
    if (scope === 'all') targets = cutsOnTrack('v1');
    else {
      const c = selected();
      targets = c && cutsOnTrack(c.trackId).includes(c) ? [c] : [];
    }
    if (!targets.length) return 0;
    targets.forEach((c) => { c.transition = { type, dur: dur || (c.transition && c.transition.dur) || 0.5 }; });
    return targets.length;
  }

  function addSticker(emoji) {
    pushHistory();
    const dur = 3;
    const trackId = findFreeTrack('visual', time, time + dur, 't1');
    const clip = makeClip('text', trackId, time, dur, {
      text: Object.assign(clone(P.defaultText), { content: emoji, font: 'Segoe UI Emoji', size: 220, bold: false, shadow: 0.3, strokeWidth: 0 }),
      animIn: { type: 'pop', dur: 0.4 }, animOut: { type: 'fade', dur: 0.3 },
      transform: { x: 0.45, y: -0.45, scale: 1, rotation: 0, opacity: 1 },
      sticker: true,
    });
    project.clips.push(clip);
    selectedId = clip.id;
    refreshAll();
  }

  // Sous-titres automatiques
  let captionBusy = false;
  async function generateCaptions(opts = {}) {
    if (captionBusy) return { ok: false, error: 'Génération déjà en cours' };
    const lang = opts.lang || 'fr';
    const model = opts.model || 'base';
    const engine = opts.engine || 'local';
    const styleDef = P.captionStyles.find((x) => x.id === (opts.style || 'karaoke')) || P.captionStyles[0];
    const maxWords = opts.maxWords || 4;
    // clips sources
    let sources = [];
    const sel = selected();
    const withAudio = (c) => {
      const m = mediaById(c.mediaId); const t = trackById(c.trackId);
      return m && !m.missing && m.hasAudio && !c.muted && !(t && t.muted) && (c.kind === 'video' || c.kind === 'audio');
    };
    if (opts.scope === 'selected' && sel && withAudio(sel)) sources = [sel];
    else {
      sources = project.clips.filter((c) => c.kind === 'video' && withAudio(c));
      if (!sources.length || opts.scope === 'all') sources = project.clips.filter(withAudio);
    }
    if (!sources.length) return { ok: false, error: 'Aucun clip avec du son à transcrire.' };
    captionBusy = true;
    try {
      const status = await api.captionsStatus();
      if (engine === 'local') {
        if (!status.binary) throw new Error('Le moteur Whisper n\'est pas inclus dans cette version. Utilisez le moteur « API » (réglages IA) ou la version Windows officielle.');
        if (!status.models[model].installed) {
          if (opts.onStatus) opts.onStatus(`Téléchargement du modèle ${status.models[model].label}…`);
          await api.captionsDownload(model);
        }
      }
      if (opts.onStatus) opts.onStatus('Transcription en cours…');
      const items = sources.map((c) => { const m = mediaById(c.mediaId); return { key: c.id, path: m.path, start: c.in, len: c.dur * c.speed }; });
      const res = await api.captionsTranscribe({ items, lang, model, engine });
      // mots -> temps timeline
      let words = [];
      res.forEach((r) => {
        const c = clipById(r.key);
        if (!c) return;
        r.words.forEach((w) => {
          const t0 = c.start + w.t0 / c.speed, t1 = c.start + w.t1 / c.speed;
          if (t0 < c.start + c.dur - 0.02) words.push({ w: w.w, t0: Math.max(c.start, t0), t1: Math.min(c.start + c.dur, Math.max(t1, t0 + 0.08)) });
        });
      });
      words.sort((a, b) => a.t0 - b.t0);
      if (!words.length) return { ok: false, error: 'Aucune parole détectée.' };
      // regroupement en phrases courtes
      const chunks = [];
      let cur = [];
      words.forEach((w, i) => {
        const prev = cur[cur.length - 1];
        const brk = cur.length && (cur.length >= maxWords || w.t0 - prev.t1 > 0.6 || w.t1 - cur[0].t0 > 3 || /[.!?…]$/.test(prev.w));
        if (brk) { chunks.push(cur); cur = []; }
        cur.push(w);
        if (i === words.length - 1) chunks.push(cur);
      });
      pushHistory();
      // piste dédiée (remplace les anciens sous-titres)
      project.clips = project.clips.filter((c) => !c.caption);
      let track = project.tracks.find((t) => t.captions);
      if (!track) { track = addTrack('visual'); track.name = 'Sous-titres'; track.captions = true; }
      const vertical = (P.ratios.find((r) => r.id === project.ratio) || { w: 16, h: 9 }).h > (P.ratios.find((r) => r.id === project.ratio) || { w: 16 }).w;
      const y = opts.position === 'center' ? 0 : opts.position === 'top' ? -0.7 : vertical ? 0.45 : 0.72;
      chunks.forEach((ch, i) => {
        const start = ch[0].t0;
        const nextStart = chunks[i + 1] ? chunks[i + 1][0].t0 : Infinity;
        const end = Math.min(nextStart, ch[ch.length - 1].t1 + 0.35);
        const dur = Math.max(0.25, end - start);
        const text = Object.assign(clone(P.defaultText), clone(styleDef.style), {
          content: ch.map((w) => w.w).join(' '),
          words: ch.map((w) => ({ w: w.w, t0: +(w.t0 - start).toFixed(3), t1: +(w.t1 - start).toFixed(3) })),
        });
        if (opts.upper) { text.content = text.content.toUpperCase(); text.words.forEach((w) => { w.w = w.w.toUpperCase(); }); }
        project.clips.push(makeClip('text', track.id, start, dur, {
          text, caption: true, transform: { x: 0, y, scale: 1, rotation: 0, opacity: 1 },
          animIn: { type: 'none', dur: 0.2 }, animOut: { type: 'none', dur: 0.2 },
        }));
      });
      refreshAll();
      return { ok: true, count: chunks.length, words: words.length };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    } finally {
      captionBusy = false;
    }
  }

  // ---------------------------------------------------------------- Panneau gauche (préréglages)
  function buildLeftPanel() {
    $$('#leftTabs button').forEach((b) => {
      b.onclick = () => {
        $$('#leftTabs button').forEach((x) => x.classList.toggle('active', x === b));
        $$('.tab-body').forEach((x) => x.classList.toggle('hidden', x.dataset.body !== b.dataset.tab));
      };
    });

    const tp = $('#textPresets');
    P.textPresets.forEach((p) => {
      const s = Object.assign({}, P.defaultText, p.style);
      const d = document.createElement('div');
      d.className = 'preset';
      const span = document.createElement('span');
      span.textContent = p.name;
      Object.assign(span.style, {
        fontFamily: s.font, fontWeight: s.bold ? 700 : 400, fontStyle: s.italic ? 'italic' : 'normal', color: s.color, fontSize: '16px',
        WebkitTextStroke: s.strokeWidth ? `1px ${s.stroke}` : '', background: s.bgOpacity ? s.bg : 'transparent', padding: '2px 6px', borderRadius: '4px',
        textShadow: s.shadow ? '0 2px 6px #000' : 'none',
      });
      d.appendChild(span);
      d.onclick = () => addText(clone(p.style));
      tp.appendChild(d);
    });

    const fg = $('#filterGrid');
    P.filters.forEach((f) => {
      const d = document.createElement('div');
      d.className = 'preset';
      d.dataset.filter = f.id;
      const sw = document.createElement('div');
      sw.className = 'swatch';
      sw.style.filter = R.filterString(f.adjust, 0, 0.2);
      d.appendChild(sw);
      d.appendChild(document.createTextNode(f.name));
      d.onclick = () => {
        const c = selected();
        if (!c || (c.kind !== 'video' && c.kind !== 'image')) { toast('Sélectionnez un clip vidéo ou image'); return; }
        pushHistory();
        c.adjust = clone(f.adjust);
        c.filterId = f.id;
        refreshAll();
      };
      fg.appendChild(d);
    });

    renderAnimGrids();

    $$('[data-fade]').forEach((b) => {
      b.onclick = () => {
        const c = selected();
        if (!c) { toast('Sélectionnez un clip'); return; }
        pushHistory();
        const v = Math.min(+b.dataset.fade, c.dur / 2);
        c.fadeIn = c.fadeOut = v;
        refreshAll();
      };
    });

    const rg = $('#ratioGrid');
    P.ratios.forEach((r) => {
      const d = document.createElement('div');
      d.className = 'preset';
      d.dataset.ratio = r.id;
      const box = document.createElement('div');
      const s = 26 / Math.max(r.w, r.h);
      Object.assign(box.style, { width: r.w * s + 'px', height: r.h * s + 'px', border: '2px solid currentColor', borderRadius: '3px' });
      d.append(box, document.createTextNode(r.label));
      d.title = r.sub;
      d.onclick = () => { pushHistory(); project.ratio = r.id; applyCanvasSize(); refreshAll(); };
      rg.appendChild(d);
    });
    $('#resSelect').onchange = (e) => { pushHistory(); project.res = +e.target.value; };
    $('#fpsSelect').onchange = (e) => { pushHistory(); project.fps = +e.target.value; };
    $('#bgColor').oninput = (e) => { project.bg = e.target.value; markDirty(); requestRender(); };
    $('#bgModeColor').onclick = () => { pushHistory(); project.bgMode = 'color'; refreshAll(); };
    $('#bgModeBlur').onclick = () => { pushHistory(); project.bgMode = 'blur'; refreshAll(); };

    // Transitions
    const tg = $('#transGrid');
    P.transitions.forEach((x) => {
      const d = document.createElement('div');
      d.className = 'preset';
      d.dataset.trans = x.id;
      d.innerHTML = `<span class="ticon">${x.icon}</span><span></span>`;
      d.lastChild.textContent = x.name;
      d.onclick = () => {
        pushHistory();
        const n = applyTransition(x.id, +$('#transDur').value, selected() ? 'selected' : 'all');
        if (!n) { undoStack.pop(); toast('Sélectionnez un clip qui suit directement un autre clip'); return; }
        refreshAll();
        const c = selected();
        if (c && x.id !== 'none') { seek(Math.max(0, c.start - (+$('#transDur').value) * 0.75)); play(); }
      };
      tg.appendChild(d);
    });
    $('#transAll').onclick = () => {
      const c = selected();
      const type = c && c.transition && c.transition.type !== 'none' ? c.transition.type : 'fade';
      pushHistory();
      const n = applyTransition(type, +$('#transDur').value, 'all');
      if (!n) { undoStack.pop(); toast('Aucune coupe sur la piste principale'); return; }
      refreshAll();
      toast(`Transition appliquée à ${n} coupe(s)`);
    };
    $('#transNone').onclick = () => { pushHistory(); project.clips.forEach((c) => { if (c.transition) c.transition.type = 'none'; }); refreshAll(); };

    // Effets vidéo
    const eg = $('#effectGrid');
    P.effects.forEach((x) => {
      const d = document.createElement('div');
      d.className = 'preset';
      d.dataset.effect = x.id;
      d.textContent = x.name;
      d.onclick = () => {
        const c = selected();
        if (!c || (c.kind !== 'video' && c.kind !== 'image')) { toast('Sélectionnez un clip vidéo ou image'); return; }
        pushHistory();
        c.effect = { type: x.id, intensity: (c.effect && c.effect.intensity) || 0.5 };
        refreshAll();
        if (!playing && x.id !== 'none') { seek(c.start); play(); }
      };
      eg.appendChild(d);
    });

    // Autocollants
    const sg = $('#stickerGrid');
    P.stickers.forEach((e) => { const b = document.createElement('button'); b.textContent = e; b.onclick = () => addSticker(e); sg.appendChild(b); });

    // Sous-titres
    let capStyle = 'karaoke';
    const cs = $('#capStyles');
    P.captionStyles.forEach((x) => {
      const d = document.createElement('div');
      d.className = 'preset' + (x.id === capStyle ? ' active' : '');
      const st = x.style;
      d.innerHTML = `<span class="cap-prev">Le <span>mot</span> actif</span><span class="dim" style="font-size:11px"></span>`;
      d.querySelector('.dim').textContent = x.name;
      const prev = d.querySelector('.cap-prev');
      prev.style.color = st.color;
      prev.style.fontFamily = st.font;
      prev.style.textShadow = '0 1px 2px #000, 0 0 3px #000';
      if (st.bgOpacity) { prev.style.background = st.bg; prev.style.padding = '1px 4px'; }
      const w = prev.querySelector('span');
      if (st.highlightMode === 'box') { w.style.background = st.highlight; w.style.borderRadius = '3px'; w.style.padding = '0 2px'; } else if (st.highlight) w.style.color = st.highlight;
      d.onclick = () => { capStyle = x.id; cs.querySelectorAll('.preset').forEach((p) => p.classList.toggle('active', p === d)); };
      cs.appendChild(d);
    });
    const refreshModels = async () => {
      const st = await api.captionsStatus().catch(() => null);
      const sel = $('#capModel');
      const cur = sel.value || 'base';
      sel.innerHTML = '';
      if (!st) return;
      Object.entries(st.models).forEach(([k, m]) => {
        const o = document.createElement('option');
        o.value = k;
        o.textContent = `${m.label}${m.installed ? ' ✓' : ' — à télécharger'}`;
        sel.appendChild(o);
      });
      sel.value = cur;
    };
    refreshModels();
    $('#capEngine').onchange = () => $('#capModelRow').classList.toggle('hidden', $('#capEngine').value !== 'local');
    api.onCaptionsProgress((p) => {
      $('#capBar').style.width = `${p.pct}%`;
      $('#capStatus').textContent = p.phase === 'download' ? `Téléchargement du modèle… ${p.pct}%` : `Transcription… ${p.pct}%`;
    });
    $('#capGo').onclick = async () => {
      if (!project.clips.length) { toast('Ajoutez d\'abord une vidéo à la timeline'); return; }
      $('#capGo').disabled = true;
      $('#capProgress').classList.remove('hidden');
      $('#capBar').style.width = '0%';
      const r = await generateCaptions({
        lang: $('#capLang').value, engine: $('#capEngine').value, model: $('#capModel').value || 'base', style: capStyle,
        maxWords: +$('#capWords').value, position: $('#capPos').value, upper: $('#capUpper').checked,
        onStatus: (t) => { $('#capStatus').textContent = t; },
      });
      $('#capGo').disabled = false;
      refreshModels();
      if (r.ok) { $('#capStatus').textContent = `✔ ${r.count} sous-titres créés (${r.words} mots)`; toast('Sous-titres générés'); }
      else { $('#capStatus').textContent = `✖ ${r.error}`; }
    };
  }

  function renderAnimGrids() {
    const c = selected();
    const build = (el, list, key) => {
      el.innerHTML = '';
      list.forEach((a) => {
        const d = document.createElement('div');
        d.className = 'preset' + (c && c[key] && c[key].type === a.id ? ' active' : '');
        d.textContent = a.name;
        d.onclick = () => {
          const cc = selected();
          if (!cc || cc.kind === 'audio') { toast('Sélectionnez un clip visuel'); return; }
          pushHistory();
          cc[key].type = a.id;
          if (a.id !== 'none') {
            // aperçu de l'animation
            seek(key === 'animIn' ? cc.start : Math.max(cc.start, cc.start + cc.dur - cc[key].dur - 0.05));
            if (!playing) play();
          }
          refreshAll();
        };
        el.appendChild(d);
      });
    };
    build($('#animInGrid'), P.animIn, 'animIn');
    build($('#animOutGrid'), P.animOut, 'animOut');
  }

  function highlightPresets() {
    const c = selected();
    $$('#filterGrid .preset').forEach((d) => d.classList.toggle('active', !!c && c.filterId === d.dataset.filter));
    $$('#ratioGrid .preset').forEach((d) => d.classList.toggle('active', project.ratio === d.dataset.ratio));
    $$('#transGrid .preset').forEach((d) => d.classList.toggle('active', !!c && !!c.transition && c.transition.type === d.dataset.trans));
    $$('#effectGrid .preset').forEach((d) => d.classList.toggle('active', !!c && !!c.effect && c.effect.type === d.dataset.effect));
    $('#bgModeColor').classList.toggle('active', project.bgMode !== 'blur');
    $('#bgModeBlur').classList.toggle('active', project.bgMode === 'blur');
    renderAnimGrids();
  }

  function updateEmptyState() {
    $('#emptyState').classList.toggle('hidden', project.clips.length > 0);
  }

  function refreshAll() {
    renderTimeline();
    renderInspector();
    renderMediaGrid();
    $('#resSelect').value = project.res;
    $('#fpsSelect').value = project.fps;
    $('#bgColor').value = project.bg;
    $('#projectName').value = project.name;
    if (time > totalDuration()) time = totalDuration();
    requestRender();
  }

  // ---------------------------------------------------------------- Projets
  async function saveProject(saveAs = false) {
    const data = clone(project);
    data.media.forEach((m) => { delete m.peaks; delete m.url; delete m.missing; });
    const p = await api.saveProject({ data, filePath, saveAs });
    if (p) { filePath = p; dirty = false; updateTitle(); toast('Projet enregistré'); }
  }
  async function confirmDiscard() {
    if (!dirty || (!project.clips.length && !project.media.length)) return true;
    return window.confirm('Les modifications non enregistrées seront perdues. Continuer ?');
  }
  async function openProject(givenPath) {
    if (!(await confirmDiscard())) return;
    try {
      const r = await api.openProject(givenPath);
      if (!r) return;
      const d = r.data;
      if (d.app !== 'VidioEdit') throw new Error('Fichier de projet invalide');
      pause();
      for (const el of pool.values()) el.pause();
      pool.clear(); images.clear();
      project = Object.assign(newProject(), d);
      filePath = r.filePath;
      selectedId = null; time = 0; undoStack = []; redoStack = [];
      for (const m of project.media) {
        m.missing = !(await api.fileExists(m.path));
        m.url = await api.fileUrl(m.path);
      }
      applyCanvasSize();
      refreshAll();
      dirty = false; updateTitle();
      const missing = project.media.filter((m) => m.missing).length;
      toast(missing ? `${missing} média(s) introuvable(s)` : 'Projet ouvert');
      project.media.filter((m) => !m.missing).forEach((m) => prepareMedia(m).then(renderMediaGrid));
    } catch (e) {
      toast(`Impossible d'ouvrir : ${e.message || e}`, 4000);
    }
  }
  async function newProj() {
    if (!(await confirmDiscard())) return;
    pause();
    pool.clear(); images.clear();
    project = newProject();
    filePath = null; selectedId = null; time = 0; undoStack = []; redoStack = [];
    dirty = false;
    applyCanvasSize();
    refreshAll();
    updateTitle();
  }

  // ---------------------------------------------------------------- Export
  let exporting = false;
  let abortExport = false;

  function openExportModal() {
    const total = totalDuration();
    if (!total) { toast('La timeline est vide'); return; }
    pause();
    $('#expRes').value = project.res;
    $('#expFps').value = project.fps;
    const upd = () => {
      const d = exportDims(project.ratio, +$('#expRes').value);
      $('#expInfo').textContent = `${d.w} × ${d.h} · ${project.ratio} · durée ${fmtTime(total)} · H.264 + AAC`;
    };
    $('#expRes').onchange = upd;
    upd();
    $('#expHwLabel').textContent = 'Accélération matérielle (détection…)';
    api.exportHw().then((list) => {
      const names = { h264_nvenc: 'NVIDIA NVENC', h264_qsv: 'Intel Quick Sync', h264_amf: 'AMD AMF' };
      $('#expHw').disabled = !list.length;
      $('#expHw').checked = !!list.length;
      $('#expHwLabel').textContent = list.length ? `Accélération matérielle : ${names[list[0]] || list[0]}` : 'Accélération matérielle : non disponible (processeur)';
    }).catch(() => {});
    $('#exportForm').classList.remove('hidden');
    $('#exportProgress').classList.add('hidden');
    $('#exportDone').classList.add('hidden');
    $('#exportModal').classList.remove('hidden');
  }

  function waitSeek(el, target) {
    return new Promise((resolve) => {
      if (Math.abs(el.currentTime - target) < 0.0005 && el.readyState >= 2) return resolve();
      let done = false;
      const fin = () => { if (done) return; done = true; el.removeEventListener('seeked', fin); clearTimeout(to); resolve(); };
      const to = setTimeout(fin, 3000);
      el.addEventListener('seeked', fin);
      el.currentTime = target;
    });
  }
  function waitLoaded(el) {
    return new Promise((resolve) => {
      if (el.readyState >= 2) return resolve();
      const to = setTimeout(resolve, 8000);
      el.addEventListener('loadeddata', () => { clearTimeout(to); resolve(); }, { once: true });
    });
  }
  function waitImage(img) {
    return new Promise((resolve) => { if (img.complete) resolve(); else { img.onload = img.onerror = () => resolve(); } });
  }

  async function runExport() {
    const res = +$('#expRes').value;
    const fps = +$('#expFps').value;
    const quality = $('#expQuality').value;
    const { w, h } = exportDims(project.ratio, res);
    const total = totalDuration();
    const outPath = await api.exportPick(`${project.name.replace(/[\\/:*?"<>|]/g, '_') || 'VidioEdit'}.mp4`);
    if (!outPath) return;

    $('#exportForm').classList.add('hidden');
    $('#exportProgress').classList.remove('hidden');
    $('#expBar').style.width = '0%';
    $('#expStatus').textContent = 'Chargement des médias…';
    exporting = true;
    abortExport = false;

    // Pistes audio
    const audio = [];
    project.clips.forEach((c) => {
      const m = mediaById(c.mediaId);
      const t = trackById(c.trackId);
      if (!m || m.missing || !t || t.muted || c.muted || c.volume <= 0) return;
      if (c.kind === 'audio' || (c.kind === 'video' && m.hasAudio && !t.hidden)) {
        audio.push({ path: m.path, in: c.in, dur: c.dur, speed: c.speed, volume: c.volume, start: c.start, fadeIn: c.fadeIn, fadeOut: c.fadeOut, denoise: !!c.denoise });
      }
    });

    // Sources dédiées à l'export : décodage FFmpeg image par image (rapide), repli sur <video>
    const info = R.prepare(project);
    const fallback = new Map(); // clipId -> HTMLVideoElement
    const decoders = new Map(); // clipId -> { key, from, w, h, ok }
    const bitmaps = new Map(); // clipId -> ImageBitmap (image courante)
    const expImages = new Map();
    const loads = [];
    project.clips.forEach((c) => {
      const m = mediaById(c.mediaId);
      if (!m || m.missing) return;
      if (c.kind === 'video') {
        const sw = m.width || 1920, sh = m.height || 1080;
        const maxScale = Math.max(1, c.transform.scale, ...((c.keyframes && c.keyframes.scale) || []).map((f) => f.v));
        const cr = c.crop || { l: 0, t: 0, r: 0, b: 0 };
        const vis = Math.max(0.05, Math.min(1 - cr.l - cr.r, 1 - cr.t - cr.b));
        const f = Math.min(1, (Math.max(w / sw, h / sh) * maxScale) / vis);
        const dw = Math.max(2, Math.round((sw * f) / 2) * 2), dh = Math.max(2, Math.round((sh * f) / 2) * 2);
        decoders.set(c.id, { key: c.id, from: R.srcTime(c, Math.max(0, info[c.id].from), m.duration), w: dw, h: dh, opened: false, ok: true });
      } else if (c.kind === 'image' && !expImages.has(m.id)) {
        const img = new Image(); img.src = m.url;
        expImages.set(m.id, img);
        loads.push(waitImage(img));
      }
    });
    await Promise.all(loads);
    const fallbackEl = async (c) => {
      let v = fallback.get(c.id);
      if (!v) {
        const m = mediaById(c.mediaId);
        v = document.createElement('video');
        v.muted = true; v.preload = 'auto'; v.src = m.url;
        fallback.set(c.id, v);
        await waitLoaded(v);
      }
      return v;
    };

    const src = {
      media(clip) {
        const m = mediaById(clip.mediaId);
        if (!m) return null;
        if (m.type === 'image') return expImages.get(m.id);
        return bitmaps.get(clip.id) || fallback.get(clip.id) || null;
      },
    };
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    let error = null;
    let encoder = 'libx264';
    try {
      const st = await api.exportStart({ outPath, width: w, height: h, fps, duration: total, audio, quality, hw: $('#expHw').checked });
      encoder = (st && st.encoder) || encoder;
      const frames = Math.max(1, Math.round(total * fps));
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) {
        if (abortExport) break;
        const t = i / fps;
        const jobs = [];
        project.clips.forEach((c) => {
          if (c.kind !== 'video') return;
          const d = decoders.get(c.id);
          if (!d) return;
          const inf = info[c.id];
          if (t < inf.from || t >= inf.to) {
            const old = bitmaps.get(c.id);
            if (old) { old.close(); bitmaps.delete(c.id); }
            return;
          }
          const m = mediaById(c.mediaId);
          const s = R.srcTime(c, t, m.duration);
          jobs.push((async () => {
            if (d.ok) {
              try {
                if (!d.opened) { await api.decodeOpen({ key: d.key, path: m.path, from: d.from, speed: c.speed, fps, w: d.w, h: d.h }); d.opened = true; }
                const idx = Math.max(0, Math.round(((s - d.from) * fps) / c.speed));
                const buf = await api.decodeFrame({ key: d.key, index: idx });
                if (buf && buf.byteLength >= d.w * d.h * 4) {
                  const bmp = await createImageBitmap(new ImageData(new Uint8ClampedArray(buf.buffer, buf.byteOffset, d.w * d.h * 4), d.w, d.h));
                  const old = bitmaps.get(c.id);
                  if (old) old.close();
                  bitmaps.set(c.id, bmp);
                  return;
                }
                if (!bitmaps.get(c.id)) throw new Error('aucune image');
                return; // fin du flux : on garde la dernière image
              } catch (err) {
                console.warn('Décodage FFmpeg indisponible, repli', err);
                d.ok = false;
              }
            }
            const v = await fallbackEl(c);
            await waitSeek(v, Math.min(s, Math.max(0, (v.duration || m.duration) - 0.001)));
          })());
        });
        await Promise.all(jobs);
        R.renderFrame(ctx, project, t, src, { clean: true });
        const data = ctx.getImageData(0, 0, w, h).data;
        await api.exportFrame(data.buffer);
        if (i % 3 === 0 || i === frames - 1) {
          const p = (i + 1) / frames;
          const el = (performance.now() - t0) / 1000;
          const eta = el / p - el;
          $('#expBar').style.width = `${(p * 100).toFixed(1)}%`;
          $('#expStatus').textContent = `Image ${i + 1} / ${frames} · ${Math.round(p * 100)}% · ${((i + 1) / el).toFixed(1)} ips · reste ~${fmtTime(eta, true)}`;
        }
      }
      if (abortExport) {
        await api.exportCancel();
      } else {
        $('#expStatus').textContent = 'Finalisation (mixage audio + encodage)…';
        const r = await api.exportFinish();
        if (!r.ok) error = r.error;
      }
    } catch (e) {
      error = e.message || String(e);
      await api.exportCancel().catch(() => {});
    }
    for (const v of fallback.values()) { v.removeAttribute('src'); v.load(); }
    for (const b of bitmaps.values()) b.close();
    api.decodeCloseAll().catch(() => {});
    window.__lastExport = { encoder, outPath };
    exporting = false;

    if (abortExport) { $('#exportModal').classList.add('hidden'); toast('Export annulé'); return; }
    if (error) {
      $('#exportModal').classList.add('hidden');
      console.error(error);
      alert(`L'export a échoué :\n\n${String(error).slice(0, 800)}`);
      return;
    }
    $('#exportProgress').classList.add('hidden');
    $('#exportDone').classList.remove('hidden');
    $('#expPath').textContent = outPath;
    $('#expShow').onclick = () => api.showInFolder(outPath);
  }

  // ---------------------------------------------------------------- Événements globaux
  function bindUI() {
    $('#btnImport').onclick = async () => importPaths(await api.pickMedia());
    $('#btnAddText').onclick = () => addText();
    $('#btnPlay').onclick = togglePlay;
    $('#btnStart').onclick = () => seek(0);
    $('#btnEnd').onclick = () => seek(totalDuration());
    $('#btnSplit').onclick = () => splitAt(time);
    $('#btnDelete').onclick = deleteSelected;
    $('#btnDuplicate').onclick = duplicateSelected;
    $('#btnUndo').onclick = undo;
    $('#btnRedo').onclick = redo;
    $('#btnNew').onclick = newProj;
    $('#btnOpen').onclick = () => openProject();
    $('#btnSave').onclick = () => saveProject(false);
    $('#btnExport').onclick = openExportModal;
    $('#btnAddVideoTrack').onclick = () => { pushHistory(); addTrack('visual'); refreshAll(); };
    $('#btnAddAudioTrack').onclick = () => { pushHistory(); addTrack('audio'); refreshAll(); };
    $('#zoom').oninput = (e) => setZoom(+e.target.value);
    $('#btnFit').onclick = () => setZoom((tlScroll.clientWidth - 60) / Math.max(5, totalDuration()), 0);
    $('#btnFull').onclick = () => { const w = $('#stageWrap'); document.fullscreenElement ? document.exitFullscreen() : w.requestFullscreen(); };
    $('#projectName').onchange = (e) => { project.name = e.target.value.trim() || 'Projet sans titre'; markDirty(); };

    $('#expCancelForm').onclick = () => $('#exportModal').classList.add('hidden');
    $('#expGo').onclick = runExport;
    $('#expAbort').onclick = () => { abortExport = true; $('#expStatus').textContent = 'Arrêt…'; };
    $('#expClose').onclick = () => $('#exportModal').classList.add('hidden');

    $('#btnAbout').onclick = async () => {
      const i = await api.appInfo();
      $('#aboutVersion').textContent = `Version ${i.version}`;
      $('#aboutModal').classList.remove('hidden');
    };
    $('#aboutClose').onclick = () => $('#aboutModal').classList.add('hidden');
    $('#aboutGithub').onclick = () => api.openExternal('https://github.com/ck526438-lgtm/vidioedit');

    // Glisser-déposer depuis l'explorateur Windows
    let dragDepth = 0;
    const isFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    window.addEventListener('dragenter', (e) => { if (isFiles(e)) { dragDepth++; $('#dropOverlay').classList.remove('hidden'); } });
    window.addEventListener('dragleave', (e) => { if (isFiles(e) && --dragDepth <= 0) { dragDepth = 0; $('#dropOverlay').classList.add('hidden'); } });
    window.addEventListener('dragover', (e) => { if (isFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', async (e) => {
      if (!isFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      $('#dropOverlay').classList.add('hidden');
      const files = Array.from(e.dataTransfer.files).map((f) => api.pathForFile(f)).filter(Boolean);
      const vedit = files.find((f) => f.toLowerCase().endsWith('.vedit'));
      if (vedit) return openProject(vedit);
      const added = await importPaths(files);
      // dépôt sur la timeline : ajout direct
      if (e.target.closest && e.target.closest('#timelineArea')) added.forEach((m) => addMediaToTimeline(m));
    });

    window.addEventListener('resize', () => { renderTimeline(); });

    window.addEventListener('keydown', (e) => {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) && document.activeElement.type !== 'range';
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(e.shiftKey); return; }
      if (ctrl && e.key.toLowerCase() === 'o') { e.preventDefault(); openProject(); return; }
      if (ctrl && e.key.toLowerCase() === 'n') { e.preventDefault(); newProj(); return; }
      if (ctrl && e.key.toLowerCase() === 'e') { e.preventDefault(); openExportModal(); return; }
      if (ctrl && e.key.toLowerCase() === 'i') { e.preventDefault(); $('#btnImport').click(); return; }
      if (typing || exporting) return;
      if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return; }
      switch (e.key) {
        case ' ': e.preventDefault(); togglePlay(); break;
        case 's': case 'S': if (!ctrl) splitAt(time); break;
        case 'Delete': case 'Backspace': deleteSelected(); break;
        case 'ArrowLeft': e.preventDefault(); seek(time - (e.shiftKey ? 1 : 1 / project.fps)); break;
        case 'ArrowRight': e.preventDefault(); seek(time + (e.shiftKey ? 1 : 1 / project.fps)); break;
        case 'Home': seek(0); break;
        case 'End': seek(totalDuration()); break;
        case 'Escape': selectedId = null; renderTimeline(); renderInspector(); requestRender(); break;
        case '+': case '=': setZoom(pps * 1.25); break;
        case '-': setZoom(pps / 1.25); break;
        default: break;
      }
    });

    api.onOpenProjectPath((p) => openProject(p));
  }

  // ---------------------------------------------------------------- Démarrage
  buildLeftPanel();
  bindUI();
  applyCanvasSize();
  refreshAll();
  updateTitle();
  api.pendingProject().then((p) => { if (p) openProject(p); });

  // Accès pour le débogage / tests
  window.__vidioedit = {
    get project() { return project; },
    get time() { return time; },
    get selectedId() { return selectedId; },
    set selectedId(v) { selectedId = v; },
    P, uid, clone, makeClip, isFree, findFreeTrack, addTrack, trackById, mediaById, clipById, totalDuration,
    importPaths, addMediaToTimeline, addText, splitAt, splitClip, setSpeed, detachAudio, seek, play, pause,
    pushHistory, undo, redo, refreshAll, applyCanvasSize, toast, fmtTime, markDirty,
    generateCaptions, applyTransition, addSticker, freezeFrame, reverseClip, setProp, toggleKf, openTab, runExport, openExportModal,
  };
  document.dispatchEvent(new Event('vidioedit-ready'));
})();
