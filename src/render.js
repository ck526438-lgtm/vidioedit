/* VidioEdit — moteur de composition (aperçu + export partagent le même code)
 * Licence MIT — https://github.com/ck526438-lgtm/vidioedit
 */
(function () {
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ease = (p) => 1 - Math.pow(1 - clamp(p, 0, 1), 3);
  const smooth = (p) => { p = clamp(p, 0, 1); return p * p * (3 - 2 * p); };
  const easeBack = (p) => { const c1 = 1.70158, c3 = c1 + 1; p = clamp(p, 0, 1); return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };
  const rnd = (n) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
  const TKEYS = ['x', 'y', 'scale', 'rotation', 'opacity'];

  // ------------------------------------------------------------ Fenêtres temporelles & transitions
  const ADJ = 0.02;
  function prepare(project) {
    const byTrack = {};
    project.clips.forEach((c) => { if (c.kind !== 'audio') (byTrack[c.trackId] = byTrack[c.trackId] || []).push(c); });
    const info = {};
    Object.values(byTrack).forEach((list) => {
      list.sort((a, b) => a.start - b.start);
      list.forEach((c, i) => {
        const prev = list[i - 1];
        let dIn = 0;
        const tr = c.transition;
        if (prev && tr && tr.type && tr.type !== 'none' && Math.abs(prev.start + prev.dur - c.start) < ADJ) {
          dIn = Math.max(0.05, Math.min(tr.dur || 0.5, prev.dur * 0.9, c.dur * 0.9));
        }
        info[c.id] = { dIn, dOut: 0, from: c.start - dIn / 2, to: c.start + c.dur, prev: dIn ? prev : null };
        if (dIn && info[prev.id]) { info[prev.id].dOut = dIn; info[prev.id].to = prev.start + prev.dur + dIn / 2; }
      });
    });
    project.clips.forEach((c) => { if (!info[c.id]) info[c.id] = { dIn: 0, dOut: 0, from: c.start, to: c.start + c.dur }; });
    return info;
  }

  /** Temps source d'un clip média au temps t de la timeline (gelé aux extrémités). */
  function srcTime(clip, t, mediaDur) {
    const s = clip.in + (t - clip.start) * clip.speed;
    return clamp(s, 0, Math.max(0, (mediaDur || Infinity) - 0.04));
  }

  // ------------------------------------------------------------ Images clés
  function kfValue(clip, key, local) {
    const base = clip.transform ? clip.transform[key] : undefined;
    const list = clip.keyframes && clip.keyframes[key];
    if (!list || !list.length) return base;
    if (local <= list[0].t) return list[0].v;
    const last = list[list.length - 1];
    if (local >= last.t) return last.v;
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i], b = list[i + 1];
      if (local >= a.t && local <= b.t) {
        const p = b.t > a.t ? (local - a.t) / (b.t - a.t) : 1;
        const e = clip.kfLinear ? p : smooth(p);
        return a.v + (b.v - a.v) * e;
      }
    }
    return base;
  }
  function transformAt(clip, local) {
    const out = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
    TKEYS.forEach((k) => { const v = kfValue(clip, k, local); if (v != null) out[k] = v; });
    return out;
  }

  // ------------------------------------------------------------ Animations
  function animState(clip, local, flags = {}) {
    const st = { alpha: 1, dx: 0, dy: 0, scale: 1, rot: 0, blur: 0, chars: 1 };
    const apply = (type, p, isIn) => {
      const e = type === 'pop' ? easeBack(p) : ease(p);
      const inv = 1 - ease(p);
      switch (type) {
        case 'fade': st.alpha *= ease(p); break;
        case 'zoomIn': st.scale *= isIn ? 0.4 + 0.6 * e : 1 + 0.6 * inv; st.alpha *= ease(p); break;
        case 'zoomOut': st.scale *= isIn ? 1 + 0.6 * inv : 0.4 + 0.6 * e; st.alpha *= ease(p); break;
        case 'slideLeft': st.dx += isIn ? inv : -inv; break;
        case 'slideRight': st.dx += isIn ? -inv : inv; break;
        case 'slideUp': st.dy += isIn ? inv : -inv; break;
        case 'slideDown': st.dy += isIn ? -inv : inv; break;
        case 'spin': st.rot += (isIn ? -1 : 1) * inv * Math.PI; st.scale *= 0.3 + 0.7 * e; st.alpha *= ease(p); break;
        case 'pop': st.scale *= Math.max(0.01, e); break;
        case 'blur': st.blur += inv * 30; st.alpha *= ease(p); break;
        case 'typewriter': st.chars = Math.min(st.chars, clamp(p, 0, 1)); break;
        default: break;
      }
    };
    const ai = clip.animIn || {}, ao = clip.animOut || {};
    if (!flags.noIn && ai.type && ai.type !== 'none' && ai.dur > 0 && local < ai.dur) apply(ai.type, local / ai.dur, true);
    if (!flags.noOut && ao.type && ao.type !== 'none' && ao.dur > 0 && local > clip.dur - ao.dur) apply(ao.type, (clip.dur - local) / ao.dur, false);
    if (!flags.noIn && clip.fadeIn > 0) st.alpha *= Math.min(1, local / clip.fadeIn);
    if (!flags.noOut && clip.fadeOut > 0) st.alpha *= Math.min(1, (clip.dur - local) / clip.fadeOut);
    return st;
  }

  function filterString(adj, extraBlur, k) {
    const a = Object.assign({}, window.PRESETS.defaultAdjust, adj || {});
    const parts = [];
    if (a.brightness !== 1) parts.push(`brightness(${a.brightness})`);
    if (a.contrast !== 1) parts.push(`contrast(${a.contrast})`);
    if (a.saturate !== 1) parts.push(`saturate(${a.saturate})`);
    if (a.hue) parts.push(`hue-rotate(${a.hue}deg)`);
    if (a.grayscale) parts.push(`grayscale(${a.grayscale})`);
    if (a.sepia) parts.push(`sepia(${a.sepia})`);
    if (a.invert) parts.push(`invert(${a.invert})`);
    const b = (a.blur || 0) * 4 + (extraBlur || 0);
    if (b > 0.05) parts.push(`blur(${(b * k).toFixed(2)}px)`);
    return parts.length ? parts.join(' ') : 'none';
  }

  // ------------------------------------------------------------ Texte & sous-titres
  function textFont(s, k, mul = 1) {
    return `${s.italic ? 'italic ' : ''}${s.bold ? 'bold ' : ''}${Math.round(s.size * k * mul)}px "${s.font}", "Segoe UI", sans-serif`;
  }
  function wrap(ctx, content, maxW) {
    const out = [];
    String(content).split('\n').forEach((para) => {
      if (!maxW || ctx.measureText(para).width <= maxW) { out.push(para); return; }
      let cur = '';
      para.split(' ').forEach((w) => {
        const test = cur ? `${cur} ${w}` : w;
        if (cur && ctx.measureText(test).width > maxW) { out.push(cur); cur = w; } else cur = test;
      });
      out.push(cur);
    });
    return out;
  }
  function measureText(ctx, s, k, content, maxW) {
    ctx.font = textFont(s, k);
    const lines = wrap(ctx, content, maxW);
    const lh = s.size * k * (s.lineHeight || 1.2);
    let w = 0;
    lines.forEach((l) => { w = Math.max(w, ctx.measureText(l || ' ').width); });
    return { lines, lh, w, h: lh * lines.length };
  }
  function setShadow(ctx, s, k) {
    if (s.shadow > 0) {
      ctx.shadowColor = `rgba(0,0,0,${0.75 * s.shadow})`;
      ctx.shadowBlur = 18 * k * s.shadow;
      ctx.shadowOffsetY = 4 * k * s.shadow;
    }
  }
  function bgBox(ctx, s, k, w, h) {
    if (!(s.bgOpacity > 0)) return;
    const pad = s.size * k * 0.3;
    ctx.save();
    ctx.globalAlpha *= s.bgOpacity;
    ctx.fillStyle = s.bg;
    const x = -w / 2 - pad, y = -h / 2 - pad * 0.6, ww = w + pad * 2, hh = h + pad * 1.2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, ww, hh, Math.min(pad, 18 * k)); else ctx.rect(x, y, ww, hh);
    ctx.fill();
    ctx.restore();
  }

  function drawText(ctx, clip, k, charsFrac, frameW) {
    const s = Object.assign({}, window.PRESETS.defaultText, clip.text || {});
    let content = String(s.content || '');
    if (charsFrac < 1) content = content.slice(0, Math.floor(content.length * charsFrac));
    const maxW = frameW ? (frameW * 0.9) / Math.max(0.2, Math.abs((clip.transform && clip.transform.scale) || 1)) : 0;
    const full = measureText(ctx, s, k, s.content || '', maxW);
    let m = measureText(ctx, s, k, content, maxW);
    if (charsFrac < 1) {
      // machine à écrire : mêmes retours à la ligne que le texte complet
      let left = content.length;
      const lines = [];
      full.lines.forEach((l) => { if (left > 0) { lines.push(l.slice(0, left)); left -= l.length + 1; } });
      m = Object.assign({}, full, { lines });
    }
    const pad = s.size * k * 0.3;
    bgBox(ctx, s, k, full.w, full.h);
    ctx.textBaseline = 'middle';
    ctx.textAlign = s.align;
    ctx.lineJoin = 'round';
    const xOf = s.align === 'left' ? -full.w / 2 : s.align === 'right' ? full.w / 2 : 0;
    m.lines.forEach((line, i) => {
      const y = -full.h / 2 + full.lh * (i + 0.5);
      setShadow(ctx, s, k);
      if (s.strokeWidth > 0) {
        ctx.strokeStyle = s.stroke;
        ctx.lineWidth = s.strokeWidth * 2 * k;
        ctx.strokeText(line, xOf, y);
        ctx.shadowColor = 'transparent';
      }
      ctx.fillStyle = s.color;
      ctx.fillText(line, xOf, y);
      ctx.shadowColor = 'transparent';
    });
    return { w: full.w + pad * 2, h: full.h + pad * 1.2 };
  }

  // Sous-titres mot à mot (style karaoké)
  function drawCaption(ctx, clip, k, local, frameW) {
    const s = Object.assign({}, window.PRESETS.defaultText, clip.text || {});
    const words = s.words || [];
    let active = -1;
    words.forEach((w, i) => { if (local >= w.t0 - 0.02) active = i; });
    const mode = s.highlightMode || 'color';
    const list = mode === 'single' ? (active >= 0 ? [words[active]] : []) : words;
    ctx.font = textFont(s, k);
    const space = ctx.measureText(' ').width;
    const maxW = frameW * 0.86 / Math.max(0.2, (clip.transform && clip.transform.scale) || 1);
    const lines = [];
    let cur = [], curW = 0;
    list.forEach((w) => {
      const ww = ctx.measureText(w.w).width;
      if (cur.length && curW + space + ww > maxW) { lines.push({ items: cur, w: curW }); cur = []; curW = 0; }
      cur.push({ word: w, w: ww });
      curW += (cur.length > 1 ? space : 0) + ww;
    });
    if (cur.length) lines.push({ items: cur, w: curW });
    const lh = s.size * k * (s.lineHeight || 1.2);
    const totalH = lh * lines.length;
    const totalW = lines.reduce((m, l) => Math.max(m, l.w), 0);
    bgBox(ctx, s, k, totalW, totalH);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    lines.forEach((line, li) => {
      let x = -line.w / 2;
      const y = -totalH / 2 + lh * (li + 0.5);
      line.items.forEach((it) => {
        const isActive = words.indexOf(it.word) === active;
        const hl = isActive && s.highlight && mode !== 'none';
        ctx.save();
        ctx.translate(x + it.w / 2, y);
        if (hl && (mode === 'pop' || mode === 'single')) {
          const age = clamp((local - it.word.t0) / 0.12, 0, 1);
          const sc = 1 + 0.18 * (1 - age) + (mode === 'pop' ? 0.08 : 0);
          ctx.scale(sc, sc);
        }
        if (hl && mode === 'box') {
          ctx.fillStyle = s.highlight;
          const ph = s.size * k * 0.12;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(-it.w / 2 - ph * 1.5, -lh * 0.45, it.w + ph * 3, lh * 0.9, ph * 2); else ctx.rect(-it.w / 2 - ph, -lh * 0.45, it.w + ph * 2, lh * 0.9);
          ctx.fill();
        }
        ctx.textAlign = 'center';
        setShadow(ctx, s, k);
        if (s.strokeWidth > 0) {
          ctx.strokeStyle = s.stroke;
          ctx.lineWidth = s.strokeWidth * 2 * k;
          ctx.strokeText(it.word.w, 0, 0);
          ctx.shadowColor = 'transparent';
        }
        ctx.fillStyle = hl && mode !== 'box' ? s.highlight : s.color;
        ctx.fillText(it.word.w, 0, 0);
        ctx.restore();
        x += it.w + space;
      });
    });
    return { w: totalW + s.size * k * 0.6, h: totalH + s.size * k * 0.36 };
  }

  // ------------------------------------------------------------ Médias & effets
  function mediaSize(el) {
    return { w: el.videoWidth || el.naturalWidth || el.width || 0, h: el.videoHeight || el.naturalHeight || el.height || 0 };
  }
  function isReady(el) {
    if (!el) return false;
    if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') return el.readyState >= 2;
    if (el.tagName === 'IMG') return el.complete && el.naturalWidth > 0;
    return true; // ImageBitmap / canvas
  }

  let noiseCanvas = null;
  function noise() {
    if (noiseCanvas) return noiseCanvas;
    noiseCanvas = document.createElement('canvas');
    noiseCanvas.width = noiseCanvas.height = 256;
    const c = noiseCanvas.getContext('2d');
    const d = c.createImageData(256, 256);
    for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    c.putImageData(d, 0, 0);
    return noiseCanvas;
  }
  let pixCanvas = null;

  // ------------------------------------------------------------ Traitement d'image (détourage, chroma, masque, courbes, LUT)
  const procCache = new Map();
  const lutCache = new Map(); // chemin -> { size, data }
  function curveTable(points) {
    const pts = (points && points.length ? points : [[0, 0], [1, 1]]).slice().sort((a, b) => a[0] - b[0]);
    const tab = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      const x = i / 255;
      let j = 0;
      while (j < pts.length - 2 && x > pts[j + 1][0]) j++;
      const a = pts[j], b = pts[Math.min(j + 1, pts.length - 1)];
      let y;
      if (x <= pts[0][0]) y = pts[0][1];
      else if (x >= pts[pts.length - 1][0]) y = pts[pts.length - 1][1];
      else {
        // interpolation monotone (Hermite) pour une courbe douce
        const p0 = pts[Math.max(0, j - 1)], p3 = pts[Math.min(pts.length - 1, j + 2)];
        const h = b[0] - a[0] || 1e-6, u = (x - a[0]) / h;
        const m1 = j > 0 ? ((b[1] - p0[1]) / (b[0] - p0[0] || 1e-6)) * h : b[1] - a[1];
        const m2 = j + 2 < pts.length ? ((p3[1] - a[1]) / (p3[0] - a[0] || 1e-6)) * h : b[1] - a[1];
        const u2 = u * u, u3 = u2 * u;
        y = (2 * u3 - 3 * u2 + 1) * a[1] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * b[1] + (u3 - u2) * m2;
      }
      tab[i] = Math.round(clamp(y, 0, 1) * 255);
    }
    return tab;
  }
  const isIdentityCurve = (p) => !p || !p.length || (p.length === 2 && p[0][0] === 0 && p[0][1] === 0 && p[1][0] === 1 && p[1][1] === 1);
  function curvesActive(c) { return c.curves && ['rgb', 'r', 'g', 'b'].some((k) => !isIdentityCurve(c.curves[k])); }
  function needsProcessing(c) {
    return !!(c.removeBg || (c.chroma && c.chroma.on) || (c.mask && c.mask.type && c.mask.type !== 'none') || curvesActive(c) || (c.lut && c.lut.path && lutCache.get(c.lut.path)));
  }

  function shapePath(x, m, w, h) {
    const cx = m.x * w, cy = m.y * h, mw = m.w * w, mh = m.h * h;
    x.save();
    x.translate(cx, cy);
    x.rotate(((m.rotation || 0) * Math.PI) / 180);
    x.beginPath();
    switch (m.type) {
      case 'circle': x.ellipse(0, 0, mw / 2, mh / 2, 0, 0, Math.PI * 2); break;
      case 'linear': x.rect(-w * 3, -h * 3, w * 6, h * 3); break; // garde la partie au-dessus de la ligne
      case 'band': x.rect(-w * 3, -mh / 2, w * 6, mh); break;
      case 'heart': {
        const s = Math.min(mw, mh) / 2;
        x.moveTo(0, s * 0.9);
        x.bezierCurveTo(-s * 1.6, -s * 0.2, -s * 0.7, -s * 1.3, 0, -s * 0.45);
        x.bezierCurveTo(s * 0.7, -s * 1.3, s * 1.6, -s * 0.2, 0, s * 0.9);
        break;
      }
      case 'star': {
        const R1 = Math.min(mw, mh) / 2, R2 = R1 * 0.45;
        for (let i = 0; i < 10; i++) {
          const r = i % 2 ? R2 : R1, a = -Math.PI / 2 + (i * Math.PI) / 5;
          i ? x.lineTo(Math.cos(a) * r, Math.sin(a) * r) : x.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        x.closePath();
        break;
      }
      default: x.rect(-mw / 2, -mh / 2, mw, mh);
    }
    x.restore();
  }

  function processSource(el, clip, src, sx, sy, sw, sh, sw0, sh0, maxDim) {
    const f = Math.min(1, maxDim / Math.max(sw, sh));
    const pw = Math.max(2, Math.round(sw * f)), ph = Math.max(2, Math.round(sh * f));
    let P = procCache.get(clip.id);
    if (!P) { P = document.createElement('canvas'); procCache.set(clip.id, P); }
    if (P.width !== pw || P.height !== ph) { P.width = pw; P.height = ph; }
    const x = P.getContext('2d', { willReadFrequently: true });
    x.globalCompositeOperation = 'source-over';
    x.filter = 'none';
    x.clearRect(0, 0, pw, ph);
    x.drawImage(el, sx, sy, sw, sh, 0, 0, pw, ph);

    const ck = clip.chroma && clip.chroma.on ? clip.chroma : null;
    const lut = clip.lut && clip.lut.path ? lutCache.get(clip.lut.path) : null;
    const curves = curvesActive(clip);
    if (ck || lut || curves) {
      const img = x.getImageData(0, 0, pw, ph);
      const d = img.data;
      let tR, tG, tB;
      if (curves) {
        const all = curveTable(clip.curves.rgb), cr = curveTable(clip.curves.r), cg = curveTable(clip.curves.g), cb = curveTable(clip.curves.b);
        tR = new Uint8ClampedArray(256); tG = new Uint8ClampedArray(256); tB = new Uint8ClampedArray(256);
        for (let i = 0; i < 256; i++) { tR[i] = cr[all[i]]; tG[i] = cg[all[i]]; tB[i] = cb[all[i]]; }
      }
      let kCb = 0, kCr = 0, tol = 0, soft = 0, spill = 0;
      if (ck) {
        const hex = (ck.color || '#00ff00').replace('#', '');
        const kr = parseInt(hex.slice(0, 2), 16), kg = parseInt(hex.slice(2, 4), 16), kb = parseInt(hex.slice(4, 6), 16);
        kCb = -0.1687 * kr - 0.3313 * kg + 0.5 * kb;
        kCr = 0.5 * kr - 0.4187 * kg - 0.0813 * kb;
        tol = 10 + (ck.tolerance != null ? ck.tolerance : 0.4) * 110;
        soft = 4 + (ck.softness != null ? ck.softness : 0.3) * 80;
        spill = ck.spill != null ? ck.spill : 0.5;
      }
      const N = lut ? lut.size : 0, L = lut ? lut.data : null, li = lut ? clamp(clip.lut.intensity != null ? clip.lut.intensity : 1, 0, 1) : 0;
      for (let i = 0; i < d.length; i += 4) {
        let r = d[i], g = d[i + 1], b = d[i + 2];
        if (ck) {
          const cb = -0.1687 * r - 0.3313 * g + 0.5 * b, cr = 0.5 * r - 0.4187 * g - 0.0813 * b;
          const dist = Math.hypot(cb - kCb, cr - kCr);
          const a = dist <= tol ? 0 : dist >= tol + soft ? 1 : (dist - tol) / soft;
          d[i + 3] = d[i + 3] * a;
          if (spill > 0 && a < 1 && a > 0) {
            // suppression du débordement de couleur (vert/bleu) sur les bords
            if (g > r && g > b) g = g - (g - Math.max(r, b)) * spill;
            else if (b > r && b > g) b = b - (b - Math.max(r, g)) * spill;
          }
        }
        if (L) {
          const fr = (r / 255) * (N - 1), fg = (g / 255) * (N - 1), fb = (b / 255) * (N - 1);
          const r0 = Math.floor(fr), g0 = Math.floor(fg), b0 = Math.floor(fb);
          const r1 = Math.min(N - 1, r0 + 1), g1 = Math.min(N - 1, g0 + 1), b1 = Math.min(N - 1, b0 + 1);
          const dr = fr - r0, dg = fg - g0, db = fb - b0;
          const idx = (R_, G_, B_) => (R_ + G_ * N + B_ * N * N) * 3;
          const out = [0, 0, 0];
          for (let c = 0; c < 3; c++) {
            const c000 = L[idx(r0, g0, b0) + c], c100 = L[idx(r1, g0, b0) + c], c010 = L[idx(r0, g1, b0) + c], c110 = L[idx(r1, g1, b0) + c];
            const c001 = L[idx(r0, g0, b1) + c], c101 = L[idx(r1, g0, b1) + c], c011 = L[idx(r0, g1, b1) + c], c111 = L[idx(r1, g1, b1) + c];
            const c00 = c000 + (c100 - c000) * dr, c10 = c010 + (c110 - c010) * dr, c01 = c001 + (c101 - c001) * dr, c11 = c011 + (c111 - c011) * dr;
            const c0 = c00 + (c10 - c00) * dg, c1 = c01 + (c11 - c01) * dg;
            out[c] = (c0 + (c1 - c0) * db) * 255;
          }
          r = r + (out[0] - r) * li; g = g + (out[1] - g) * li; b = b + (out[2] - b) * li;
        }
        if (tR) { r = tR[r | 0]; g = tG[g | 0]; b = tB[b | 0]; }
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
      }
      x.putImageData(img, 0, 0);
    }

    if (clip.removeBg) {
      const m = src.mask && src.mask(clip);
      if (m) {
        x.globalCompositeOperation = 'destination-in';
        x.filter = `blur(${Math.max(0.5, (clip.bgFeather != null ? clip.bgFeather : 0.2) * 5 * f * (sw / 640)).toFixed(1)}px)`;
        // le masque couvre l'image source entière : on applique le même recadrage
        const msx = (sx / sw0) * m.width, msy = (sy / sh0) * m.height, msw = (sw / sw0) * m.width, msh = (sh / sh0) * m.height;
        x.drawImage(m, msx, msy, msw, msh, 0, 0, pw, ph);
        // deuxième passe : resserre le contour (alpha²) pour limiter le liseré de l'ancien fond
        x.filter = 'none';
        x.drawImage(m, msx, msy, msw, msh, 0, 0, pw, ph);
        x.globalCompositeOperation = 'source-over';
      }
    }
    const mk = clip.mask;
    if (mk && mk.type && mk.type !== 'none') {
      x.globalCompositeOperation = mk.invert ? 'destination-out' : 'destination-in';
      const fe = (mk.feather || 0) * Math.max(pw, ph) * 0.08;
      if (fe > 0.3) x.filter = `blur(${fe.toFixed(1)}px)`;
      x.fillStyle = '#fff';
      shapePath(x, mk, pw, ph);
      x.fill();
      x.filter = 'none';
      x.globalCompositeOperation = 'source-over';
    }
    return P;
  }

  function drawMedia(ctx, el, clip, W, H, k, local, extraBlur, src) {
    const { w: sw0, h: sh0 } = mediaSize(el);
    if (!sw0 || !sh0 || !isReady(el)) return null;
    const cr = Object.assign({ l: 0, t: 0, r: 0, b: 0 }, clip.crop || {});
    let sx = sw0 * cr.l, sy = sh0 * cr.t;
    let sw = Math.max(1, sw0 * (1 - cr.l - cr.r)), sh = Math.max(1, sh0 * (1 - cr.t - cr.b));
    let fitW = sw, fitH = sh;
    if (needsProcessing(clip)) {
      el = processSource(el, clip, src || {}, sx, sy, sw, sh, sw0, sh0, src && src.procMax ? src.procMax : 1280);
      sx = 0; sy = 0; sw = el.width; sh = el.height;
    }
    const fit = clip.fit === 'cover' ? Math.max(W / fitW, H / fitH) : Math.min(W / fitW, H / fitH);
    const dw = fitW * fit, dh = fitH * fit;
    const fx = clip.effect && clip.effect.type !== 'none' ? clip.effect : null;
    const I = fx ? (fx.intensity != null ? fx.intensity : 0.5) : 0;
    ctx.filter = filterString(clip.adjust, extraBlur, k);
    const draw = (x, y, w, h) => ctx.drawImage(el, sx, sy, sw, sh, x, y, w, h);

    if (fx && fx.type === 'mirror') {
      const hw = dw / 2, hh = dh / 2;
      [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(([a, b], i) => {
        ctx.save();
        ctx.translate((i % 2 ? 1 : -1) * hw / 2, (i > 1 ? 1 : -1) * hh / 2);
        ctx.scale(a, b);
        draw(-hw / 2, -hh / 2, hw, hh);
        ctx.restore();
      });
    } else if (fx && fx.type === 'pixel') {
      const f = Math.max(8, Math.round(120 - I * 100));
      pixCanvas = pixCanvas || document.createElement('canvas');
      pixCanvas.width = f; pixCanvas.height = Math.max(1, Math.round((f * dh) / dw));
      const pc = pixCanvas.getContext('2d');
      pc.drawImage(el, sx, sy, sw, sh, 0, 0, pixCanvas.width, pixCanvas.height);
      const sm = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(pixCanvas, -dw / 2, -dh / 2, dw, dh);
      ctx.imageSmoothingEnabled = sm;
    } else if (fx && fx.type === 'rgb') {
      const off = (8 + 22 * I) * k * (0.6 + 0.4 * Math.sin(local * 9));
      draw(-dw / 2, -dh / 2, dw, dh);
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha *= 0.55;
      ctx.filter = 'sepia(1) saturate(8) hue-rotate(-45deg)';
      draw(-dw / 2 - off, -dh / 2, dw, dh);
      ctx.filter = 'sepia(1) saturate(8) hue-rotate(140deg)';
      draw(-dw / 2 + off, -dh / 2, dw, dh);
      ctx.restore();
    } else {
      draw(-dw / 2, -dh / 2, dw, dh);
    }
    ctx.filter = 'none';

    if (fx && fx.type === 'glitch') {
      const seed = Math.floor(local * 14);
      if (rnd(seed) < 0.35 + I * 0.4) {
        for (let i = 0; i < 7; i++) {
          const y = rnd(seed * 7 + i) * dh, h = (0.02 + rnd(seed * 3 + i) * 0.08) * dh;
          const dx = (rnd(seed * 11 + i) - 0.5) * dw * 0.12 * (0.5 + I);
          ctx.drawImage(el, sx, sy + (y / dh) * sh, sw, (h / dh) * sh, -dw / 2 + dx, -dh / 2 + y, dw, h);
        }
      }
    }
    if (fx && fx.type === 'vhs') {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      const step = Math.max(2, 3 * k);
      for (let y = -dh / 2; y < dh / 2; y += step * 2) ctx.fillRect(-dw / 2, y, dw, step);
      const band = ((local * 0.25) % 1) * dh - dh / 2;
      ctx.globalAlpha *= 0.25 * (0.5 + I);
      ctx.drawImage(noise(), 0, 0, 256, 32, -dw / 2, band, dw, dh * 0.06);
      ctx.restore();
    }
    if (fx && fx.type === 'film') {
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha *= 0.2 + 0.35 * I;
      const ox = rnd(Math.floor(local * 24)) * 200;
      ctx.drawImage(noise(), ox % 128, (ox * 3) % 128, 128, 128, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    }
    if (fx && fx.type === 'flash') {
      const ph = (local * (2 + I * 4)) % 1;
      if (ph < 0.18) { ctx.save(); ctx.fillStyle = `rgba(255,255,255,${(0.18 - ph) / 0.18 * 0.85})`; ctx.fillRect(-dw / 2, -dh / 2, dw, dh); ctx.restore(); }
    }
    const vig = (clip.adjust && clip.adjust.vignette) || (fx && fx.type === 'film' ? 0.5 : 0);
    if (vig > 0) {
      const g = ctx.createRadialGradient(0, 0, Math.min(dw, dh) * 0.3, 0, 0, Math.hypot(dw, dh) / 2);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${Math.min(1, vig)})`);
      ctx.fillStyle = g;
      ctx.fillRect(-dw / 2, -dh / 2, dw, dh);
    }
    return { w: dw, h: dh };
  }

  function effectMotion(clip, local) {
    const fx = clip.effect;
    const m = { dx: 0, dy: 0, scale: 1, rot: 0 };
    if (!fx || fx.type === 'none') return m;
    const I = fx.intensity != null ? fx.intensity : 0.5;
    switch (fx.type) {
      case 'kenburns': { const p = clamp(local / Math.max(0.1, clip.dur), 0, 1); m.scale = 1 + (0.08 + 0.2 * I) * p; m.dx = 0.03 * I * p; m.dy = -0.02 * I * p; break; }
      case 'zoomPulse': m.scale = 1 + (0.03 + 0.08 * I) * Math.pow(Math.abs(Math.sin(local * Math.PI * 2)), 4); break;
      case 'shake': { const f = Math.floor(local * 30); m.dx = (rnd(f) - 0.5) * 0.03 * (0.4 + I); m.dy = (rnd(f + 99) - 0.5) * 0.03 * (0.4 + I); m.rot = (rnd(f + 7) - 0.5) * 0.02 * I; m.scale = 1.04; break; }
      case 'glitch': { const f = Math.floor(local * 14); if (rnd(f + 5) < 0.2) m.dx = (rnd(f) - 0.5) * 0.04; break; }
      default: break;
    }
    return m;
  }

  // ------------------------------------------------------------ Dessin d'un clip
  function drawClip(ctx, project, clip, t, src, inf, bounds) {
    const W = ctx.canvas.width, H = ctx.canvas.height, k = H / 1080;
    const local = t - clip.start;
    const localA = clamp(local, 0, clip.dur);
    const a = animState(clip, localA, { noIn: inf.dIn > 0, noOut: inf.dOut > 0 });
    const tr = transformAt(clip, localA);
    const mo = effectMotion(clip, localA);
    const alpha = a.alpha * tr.opacity;
    if (alpha <= 0.002) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (clip.blend && clip.blend !== 'normal') ctx.globalCompositeOperation = clip.blend;
    const cx = W / 2 + tr.x * W / 2 + (a.dx + mo.dx) * W;
    const cy = H / 2 + tr.y * H / 2 + (a.dy + mo.dy) * H;
    ctx.translate(cx, cy);
    ctx.rotate((tr.rotation * Math.PI) / 180 + a.rot + mo.rot);
    const sc = tr.scale * a.scale * mo.scale;
    ctx.scale(sc * (clip.flipH ? -1 : 1), sc * (clip.flipV ? -1 : 1));
    let sz = null;
    if (clip.kind === 'text') {
      if (a.blur > 0) ctx.filter = `blur(${(a.blur * k).toFixed(1)}px)`;
      sz = clip.text && clip.text.words && clip.text.words.length ? drawCaption(ctx, clip, k, localA, W) : drawText(ctx, clip, k, a.chars, W);
    } else {
      const el = src.media(clip, t);
      if (el) sz = drawMedia(ctx, el, clip, W, H, k, localA, a.blur, src);
    }
    if (sz && bounds) bounds[clip.id] = { cx, cy, w: sz.w * Math.abs(sc), h: sz.h * Math.abs(sc) };
    ctx.restore();
  }

  // ------------------------------------------------------------ Transitions
  let layerA = null, layerB = null;
  function layer(which, W, H) {
    let c = which === 'A' ? layerA : layerB;
    if (!c) { c = document.createElement('canvas'); if (which === 'A') layerA = c; else layerB = c; }
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const x = c.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = 1;
    x.filter = 'none';
    x.clearRect(0, 0, W, H);
    return x;
  }

  function composite(ctx, type, p, A, B) {
    const W = ctx.canvas.width, H = ctx.canvas.height, k = H / 1080;
    const e = smooth(p);
    const drawAt = (img, x, y, s = 1, alpha = 1, rot = 0, filter = 'none') => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.filter = filter;
      ctx.translate(W / 2 + x, H / 2 + y);
      if (rot) ctx.rotate(rot);
      ctx.scale(s, s);
      ctx.drawImage(img, -W / 2, -H / 2);
      ctx.restore();
    };
    const clipped = (img, path) => { ctx.save(); ctx.beginPath(); path(); ctx.clip(); ctx.drawImage(img, 0, 0); ctx.restore(); };
    switch (type) {
      case 'black': case 'white':
        ctx.save(); ctx.fillStyle = type === 'black' ? '#000' : '#fff'; ctx.fillRect(0, 0, W, H); ctx.restore();
        if (p < 0.5) drawAt(A, 0, 0, 1, 1 - smooth(p * 2)); else drawAt(B, 0, 0, 1, smooth((p - 0.5) * 2));
        break;
      case 'flash': {
        drawAt(p < 0.5 ? A : B, 0, 0);
        ctx.save(); ctx.fillStyle = `rgba(255,255,255,${(1 - Math.abs(p - 0.5) * 2) * 0.95})`; ctx.fillRect(0, 0, W, H); ctx.restore();
        break;
      }
      case 'wipeLeft': ctx.drawImage(A, 0, 0); clipped(B, () => ctx.rect(W * (1 - e), 0, W * e, H)); break;
      case 'wipeRight': ctx.drawImage(A, 0, 0); clipped(B, () => ctx.rect(0, 0, W * e, H)); break;
      case 'wipeUp': ctx.drawImage(A, 0, 0); clipped(B, () => ctx.rect(0, H * (1 - e), W, H * e)); break;
      case 'wipeDown': ctx.drawImage(A, 0, 0); clipped(B, () => ctx.rect(0, 0, W, H * e)); break;
      case 'slideLeft': drawAt(A, -W * e, 0); drawAt(B, W * (1 - e), 0); break;
      case 'slideRight': drawAt(A, W * e, 0); drawAt(B, -W * (1 - e), 0); break;
      case 'slideUp': drawAt(A, 0, -H * e); drawAt(B, 0, H * (1 - e)); break;
      case 'slideDown': drawAt(A, 0, H * e); drawAt(B, 0, -H * (1 - e)); break;
      case 'zoomIn': drawAt(A, 0, 0, 1 + e * 0.8, 1 - e); drawAt(B, 0, 0, 1.25 - 0.25 * e, e); break;
      case 'zoomOut': drawAt(A, 0, 0, 1 - 0.5 * e, 1 - e); drawAt(B, 0, 0, 1.5 - 0.5 * e, e); break;
      case 'blur': drawAt(A, 0, 0, 1, 1 - e * 0.6, 0, `blur(${(e * 40 * k).toFixed(1)}px)`); drawAt(B, 0, 0, 1, e, 0, `blur(${((1 - e) * 40 * k).toFixed(1)}px)`); break;
      case 'circle': ctx.drawImage(A, 0, 0); clipped(B, () => ctx.arc(W / 2, H / 2, e * Math.hypot(W, H) / 2, 0, Math.PI * 2)); break;
      case 'doors': ctx.drawImage(A, 0, 0); clipped(B, () => ctx.rect(W / 2 - (W / 2) * e, 0, W * e, H)); break;
      case 'spin': drawAt(A, 0, 0, Math.max(0.01, 1 - e), 1 - e * 0.5, e * Math.PI); drawAt(B, 0, 0, Math.max(0.01, e), Math.min(1, e * 1.5), -(1 - e) * Math.PI); break;
      case 'glitch': {
        const base = p < 0.5 ? A : B, other = p < 0.5 ? B : A;
        ctx.drawImage(base, 0, 0);
        const I = 1 - Math.abs(p - 0.5) * 2;
        const seed = Math.floor(p * 30);
        for (let i = 0; i < 10; i++) {
          const y = rnd(seed * 13 + i) * H, h = (0.02 + rnd(seed * 5 + i) * 0.1) * H;
          const dx = (rnd(seed * 17 + i) - 0.5) * W * 0.25 * I;
          ctx.drawImage(rnd(seed + i) < 0.5 ? base : other, 0, y, W, h, dx, y, W, h);
        }
        break;
      }
      case 'fade': default:
        ctx.drawImage(A, 0, 0);
        drawAt(B, 0, 0, 1, e);
        break;
    }
  }

  // ------------------------------------------------------------ Fond flou (format vertical)
  function drawBlurBackground(ctx, project, t, src, info) {
    const W = ctx.canvas.width, H = ctx.canvas.height, k = H / 1080;
    const main = project.tracks.find((tr) => tr.main);
    if (!main || main.hidden) return;
    const cands = project.clips.filter((x) => x.trackId === main.id && (x.kind === 'video' || x.kind === 'image') && t >= info[x.id].from && t < info[x.id].to);
    const c = cands.find((x) => t >= x.start && t < x.start + x.dur) || cands[0];
    if (!c) return;
    const el = src.media(c, t);
    if (!el || !isReady(el)) return;
    const { w, h } = mediaSize(el);
    if (!w || !h) return;
    const s = Math.max(W / w, H / h) * 1.1;
    ctx.save();
    ctx.filter = `blur(${Math.round(45 * k)}px) brightness(0.7) saturate(1.2)`;
    ctx.drawImage(el, (W - w * s) / 2, (H - h * s) / 2, w * s, h * s);
    ctx.restore();
  }

  /**
   * Dessine l'image du projet au temps t.
   * src.media(clip, t) -> HTMLVideoElement | HTMLImageElement | ImageBitmap | canvas | null
   */
  function renderFrame(ctx, project, t, src, opts = {}) {
    const W = ctx.canvas.width, H = ctx.canvas.height, k = H / 1080;
    const info = prepare(project);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.fillStyle = project.bg || '#000';
    ctx.fillRect(0, 0, W, H);
    if (project.bgMode === 'blur') drawBlurBackground(ctx, project, t, src, info);
    const bounds = {};
    project.tracks.forEach((track) => {
      if (track.kind !== 'visual' || track.hidden) return;
      const active = project.clips
        .filter((c) => c.trackId === track.id && c.kind !== 'audio' && t >= info[c.id].from && t < info[c.id].to)
        .sort((a, b) => a.start - b.start);
      if (!active.length) return;
      const pairIdx = active.findIndex((c, i) => i > 0 && info[c.id].dIn > 0 && info[c.id].prev === active[i - 1]);
      if (pairIdx > 0) {
        const A = active[pairIdx - 1], B = active[pairIdx];
        const d = info[B.id].dIn;
        const p = clamp((t - (B.start - d / 2)) / d, 0, 1);
        const la = layer('A', W, H), lb = layer('B', W, H);
        drawClip(la, project, A, t, src, info[A.id], bounds);
        drawClip(lb, project, B, t, src, info[B.id], bounds);
        active.forEach((c, i) => { if (i !== pairIdx && i !== pairIdx - 1) drawClip(ctx, project, c, t, src, info[c.id], bounds); });
        composite(ctx, B.transition.type, p, la.canvas, lb.canvas);
      } else {
        active.forEach((c) => drawClip(ctx, project, c, t, src, info[c.id], bounds));
      }
    });
    if (opts.selectedId && bounds[opts.selectedId] && !opts.clean) {
      const b = bounds[opts.selectedId];
      ctx.save();
      ctx.strokeStyle = '#22c3e6';
      ctx.lineWidth = Math.max(2, 3 * k);
      ctx.setLineDash([12 * k, 8 * k]);
      ctx.strokeRect(b.cx - b.w / 2, b.cy - b.h / 2, b.w, b.h);
      ctx.restore();
    }
    ctx.restore();
    return bounds;
  }

  function parseCube(text) {
    let size = 0;
    const vals = [];
    let dmin = [0, 0, 0], dmax = [1, 1, 1];
    text.split(/\r?\n/).forEach((line) => {
      const l = line.trim();
      if (!l || l[0] === '#') return;
      if (/^LUT_3D_SIZE/i.test(l)) { size = parseInt(l.split(/\s+/)[1], 10); return; }
      if (/^DOMAIN_MIN/i.test(l)) { dmin = l.split(/\s+/).slice(1).map(Number); return; }
      if (/^DOMAIN_MAX/i.test(l)) { dmax = l.split(/\s+/).slice(1).map(Number); return; }
      if (/^[A-Z_]/i.test(l)) return;
      const p = l.split(/\s+/).map(Number);
      if (p.length >= 3 && p.every((n) => !isNaN(n))) vals.push(p[0], p[1], p[2]);
    });
    if (!size || vals.length < size * size * size * 3) throw new Error('Fichier .cube invalide (LUT 3D attendue)');
    const data = new Float32Array(size * size * size * 3);
    for (let i = 0; i < data.length; i++) { const c = i % 3; data[i] = (vals[i] - dmin[c]) / ((dmax[c] - dmin[c]) || 1); }
    return { size, data };
  }
  function registerLut(path, text) { lutCache.set(path, parseCube(text)); }
  function forgetClip(id) { procCache.delete(id); }

  window.Renderer = { renderFrame, animState, filterString, prepare, srcTime, kfValue, transformAt, TKEYS, registerLut, hasLut: (p) => lutCache.has(p), forgetClip, curveTable, needsProcessing };
})();
