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
  const snapshot = () => JSON.stringify({ tracks: project.tracks, clips: project.clips, ratio: project.ratio, bg: project.bg, res: project.res, fps: project.fps });
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
    project.media.forEach((m) => {
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
    media(clip) {
      const m = mediaById(clip.mediaId);
      if (!m || m.missing) return null;
      if (m.type === 'image') return getImage(m);
      return pool.get(clip.id) || null;
    },
  };

  function syncMedia(t) {
    const live = new Set();
    project.clips.forEach((c) => {
      if (c.kind !== 'video' && c.kind !== 'audio') return;
      const m = mediaById(c.mediaId);
      if (!m || m.missing) return;
      const active = t >= c.start && t < c.start + c.dur;
      const soon = !active && c.start > t && c.start - t < 1.5;
      if (!active && !soon && !pool.has(c.id)) return;
      const el = getPoolEl(c);
      if (!el) return;
      live.add(c.id);
      const track = trackById(c.trackId);
      if (active) {
        const target = c.in + (t - c.start) * c.speed;
        const drift = Math.abs(el.currentTime - target);
        if ((playing && drift > 0.25) || (!playing && drift > 0.01 && !el.seeking)) el.currentTime = target;
        el.playbackRate = clamp(c.speed, 0.0625, 16);
        el.muted = c.muted || (track && track.muted) || (c.kind === 'video' && track && track.hidden);
        el.volume = clamp(c.volume, 0, 1);
        if (playing && el.paused) el.play().catch(() => {});
        if (!playing && !el.paused) el.pause();
      } else {
        if (!el.paused) el.pause();
        if (soon && Math.abs(el.currentTime - c.in) > 0.05) el.currentTime = c.in;
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
      drag = { p0: p, x0: c.transform.x, y0: c.transform.y, pushed: false };
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
      c.transform.x = nx; c.transform.y = ny;
      requestRender();
    });
    window.addEventListener('mouseup', () => { if (drag) { drag = null; renderInspector(); } });
    stage.addEventListener('wheel', (e) => {
      const c = selected();
      if (!c || c.kind === 'audio') return;
      e.preventDefault();
      pushHistory();
      c.transform.scale = clamp(c.transform.scale * (e.deltaY < 0 ? 1.05 : 1 / 1.05), 0.05, 10);
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
      project.clips.filter((c) => c.trackId === t.id).forEach((c) => tr.appendChild(clipElement(c, t)));
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
    el.appendChild(label);
    if (m && m.peaks && (c.kind === 'audio')) el.appendChild(waveCanvas(c, m));
    if (c.fadeIn > 0) { const f = document.createElement('div'); f.className = 'fade in'; f.style.width = c.fadeIn * pps + 'px'; el.appendChild(f); }
    if (c.fadeOut > 0) { const f = document.createElement('div'); f.className = 'fade out'; f.style.width = c.fadeOut * pps + 'px'; el.appendChild(f); }
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
      ta.addEventListener('input', () => { beginEdit(); s.content = ta.value; requestRender(); });
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

    // --- Transformation
    if (c.kind !== 'audio') {
      const g = group('Position & taille');
      const tr = c.transform;
      slider(g, 'Position X', () => tr.x, (v) => (tr.x = v), -2, 2, 0.01, (v) => v.toFixed(2)).dataset.def = 0;
      slider(g, 'Position Y', () => tr.y, (v) => (tr.y = v), -2, 2, 0.01, (v) => v.toFixed(2)).dataset.def = 0;
      slider(g, 'Échelle', () => tr.scale, (v) => (tr.scale = v), 0.05, 5, 0.01, pct).dataset.def = 1;
      slider(g, 'Rotation', () => tr.rotation, (v) => (tr.rotation = v), -180, 180, 1, (v) => `${v}°`).dataset.def = 0;
      slider(g, 'Opacité', () => tr.opacity, (v) => (tr.opacity = v), 0, 1, 0.01, pct).dataset.def = 1;
      const items = [];
      if (c.kind !== 'text') {
        items.push(['Ajuster', () => { pushHistory(); c.fit = 'contain'; }, c.fit !== 'cover', 'Toute l\'image visible']);
        items.push(['Remplir', () => { pushHistory(); c.fit = 'cover'; }, c.fit === 'cover', 'Remplir le cadre (recadrage)']);
      }
      items.push(['⇋', () => { pushHistory(); c.flipH = !c.flipH; }, c.flipH, 'Miroir horizontal']);
      items.push(['⇵', () => { pushHistory(); c.flipV = !c.flipV; }, c.flipV, 'Miroir vertical']);
      items.push(['Réinitialiser', () => { pushHistory(); c.transform = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }; c.flipH = c.flipV = false; }, false]);
      buttons(g, items);
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
        audio.push({ path: m.path, in: c.in, dur: c.dur, speed: c.speed, volume: c.volume, start: c.start, fadeIn: c.fadeIn, fadeOut: c.fadeOut });
      }
    });

    // Éléments dédiés à l'export
    const expPool = new Map();
    const expImages = new Map();
    const loads = [];
    project.clips.forEach((c) => {
      const m = mediaById(c.mediaId);
      if (!m || m.missing) return;
      if (c.kind === 'video') {
        const v = document.createElement('video');
        v.muted = true; v.preload = 'auto'; v.src = m.url;
        expPool.set(c.id, v);
        loads.push(waitLoaded(v));
      } else if (c.kind === 'image' && !expImages.has(m.id)) {
        const img = new Image(); img.src = m.url;
        expImages.set(m.id, img);
        loads.push(waitImage(img));
      }
    });
    await Promise.all(loads);

    const src = {
      media(clip) {
        const m = mediaById(clip.mediaId);
        if (!m) return null;
        return m.type === 'image' ? expImages.get(m.id) : expPool.get(clip.id);
      },
    };
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    let error = null;
    try {
      await api.exportStart({ outPath, width: w, height: h, fps, duration: total, audio, quality });
      const frames = Math.max(1, Math.round(total * fps));
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) {
        if (abortExport) break;
        const t = i / fps;
        const seeks = [];
        project.clips.forEach((c) => {
          if (c.kind !== 'video' || t < c.start || t >= c.start + c.dur) return;
          const v = expPool.get(c.id);
          const m = mediaById(c.mediaId);
          if (!v || !m) return;
          const target = Math.min(c.in + (t - c.start) * c.speed, Math.max(0, (v.duration || m.duration) - 0.001));
          seeks.push(waitSeek(v, target));
        });
        await Promise.all(seeks);
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
    for (const v of expPool.values()) { v.removeAttribute('src'); v.load(); }
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
  };
  document.dispatchEvent(new Event('vidioedit-ready'));
})();
