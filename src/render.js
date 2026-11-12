/* VidioEdit — moteur de composition (aperçu + export partagent le même code) */
(function () {
  const ease = (p) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3);
  const easeBack = (p) => { const c1 = 1.70158, c3 = c1 + 1; p = Math.min(1, Math.max(0, p)); return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };

  function animState(clip, local) {
    const st = { alpha: 1, dx: 0, dy: 0, scale: 1, rot: 0, blur: 0, chars: 1 };
    const apply = (type, p, isIn) => {
      // p : 0 = invisible / hors champ, 1 = état normal
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
        case 'typewriter': st.chars = Math.min(st.chars, Math.min(1, p)); break;
        default: break;
      }
    };
    const ai = clip.animIn || {}, ao = clip.animOut || {};
    if (ai.type && ai.type !== 'none' && ai.dur > 0 && local < ai.dur) apply(ai.type, local / ai.dur, true);
    if (ao.type && ao.type !== 'none' && ao.dur > 0 && local > clip.dur - ao.dur) apply(ao.type, (clip.dur - local) / ao.dur, false);
    if (clip.fadeIn > 0) st.alpha *= Math.min(1, local / clip.fadeIn);
    if (clip.fadeOut > 0) st.alpha *= Math.min(1, (clip.dur - local) / clip.fadeOut);
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

  function textFont(s, k) {
    return `${s.italic ? 'italic ' : ''}${s.bold ? 'bold ' : ''}${Math.round(s.size * k)}px "${s.font}", "Segoe UI", sans-serif`;
  }

  function measureText(ctx, s, k, content) {
    ctx.font = textFont(s, k);
    const lines = String(content).split('\n');
    const lh = s.size * k * (s.lineHeight || 1.2);
    let w = 0;
    lines.forEach((l) => { w = Math.max(w, ctx.measureText(l || ' ').width); });
    return { lines, lh, w, h: lh * lines.length };
  }

  function drawText(ctx, clip, k, charsFrac) {
    const s = Object.assign({}, window.PRESETS.defaultText, clip.text || {});
    let content = String(s.content || '');
    if (charsFrac < 1) content = content.slice(0, Math.floor(content.length * charsFrac));
    const full = measureText(ctx, s, k, s.content || '');
    const m = measureText(ctx, s, k, content);
    const pad = s.size * k * 0.3;
    if (s.bgOpacity > 0) {
      ctx.save();
      ctx.globalAlpha *= s.bgOpacity;
      ctx.fillStyle = s.bg;
      const r = Math.min(pad, 18 * k);
      const x = -full.w / 2 - pad, y = -full.h / 2 - pad * 0.6, w = full.w + pad * 2, h = full.h + pad * 1.2;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
      ctx.fill();
      ctx.restore();
    }
    ctx.textBaseline = 'middle';
    ctx.textAlign = s.align;
    ctx.lineJoin = 'round';
    const xOf = s.align === 'left' ? -full.w / 2 : s.align === 'right' ? full.w / 2 : 0;
    m.lines.forEach((line, i) => {
      const y = -full.h / 2 + full.lh * (i + 0.5);
      if (s.shadow > 0) {
        ctx.shadowColor = `rgba(0,0,0,${0.75 * s.shadow})`;
        ctx.shadowBlur = 18 * k * s.shadow;
        ctx.shadowOffsetY = 4 * k * s.shadow;
      }
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

  /**
   * Dessine l'image du projet au temps t.
   * src.media(clip) -> HTMLVideoElement | HTMLImageElement | null
   */
  function renderFrame(ctx, project, t, src, opts = {}) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const k = H / 1080; // tailles exprimées pour une hauteur de référence de 1080 px
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.fillStyle = project.bg || '#000';
    ctx.fillRect(0, 0, W, H);
    const bounds = {};
    project.tracks.forEach((track) => {
      if (track.kind !== 'visual' || track.hidden) return;
      project.clips.forEach((clip) => {
        if (clip.trackId !== track.id || clip.kind === 'audio') return;
        if (t < clip.start || t >= clip.start + clip.dur) return;
        const local = t - clip.start;
        const a = animState(clip, local);
        const tr = Object.assign({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, clip.transform || {});
        const alpha = a.alpha * tr.opacity;
        if (alpha <= 0.002) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        const cx = W / 2 + tr.x * W / 2 + a.dx * W;
        const cy = H / 2 + tr.y * H / 2 + a.dy * H;
        ctx.translate(cx, cy);
        ctx.rotate((tr.rotation * Math.PI) / 180 + a.rot);
        const sc = tr.scale * a.scale;
        ctx.scale(sc * (clip.flipH ? -1 : 1), sc * (clip.flipV ? -1 : 1));
        if (clip.kind === 'text') {
          if (a.blur > 0) ctx.filter = `blur(${(a.blur * k).toFixed(1)}px)`;
          const sz = drawText(ctx, clip, k, a.chars);
          bounds[clip.id] = { cx, cy, w: sz.w * sc, h: sz.h * sc };
        } else {
          const el = src.media(clip);
          if (el) {
            const sw = el.videoWidth || el.naturalWidth || el.width;
            const sh = el.videoHeight || el.naturalHeight || el.height;
            const ready = el.tagName === 'VIDEO' ? el.readyState >= 2 : el.complete;
            if (sw && sh && ready) {
              const fit = clip.fit === 'cover' ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
              const dw = sw * fit, dh = sh * fit;
              ctx.filter = filterString(clip.adjust, a.blur, k);
              ctx.drawImage(el, -dw / 2, -dh / 2, dw, dh);
              ctx.filter = 'none';
              const vig = (clip.adjust && clip.adjust.vignette) || 0;
              if (vig > 0) {
                const g = ctx.createRadialGradient(0, 0, Math.min(dw, dh) * 0.3, 0, 0, Math.hypot(dw, dh) / 2);
                g.addColorStop(0, 'rgba(0,0,0,0)');
                g.addColorStop(1, `rgba(0,0,0,${Math.min(1, vig)})`);
                ctx.fillStyle = g;
                ctx.fillRect(-dw / 2, -dh / 2, dw, dh);
              }
              bounds[clip.id] = { cx, cy, w: dw * sc, h: dh * sc };
            }
          }
        }
        ctx.restore();
      });
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

  window.Renderer = { renderFrame, animState, filterString };
})();
