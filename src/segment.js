/* VidioEdit — détourage de personnes par IA (MediaPipe Selfie Segmentation, Apache 2.0)
 * Le modèle est livré avec l'application : fonctionne hors-ligne.
 */
(() => {
  'use strict';
  let seg = null;
  let ready = null;
  let chain = Promise.resolve();
  let resolver = null;
  let input = null;

  function init() {
    if (ready) return ready;
    if (typeof window.SelfieSegmentation !== 'function') return Promise.reject(new Error('Module de détourage absent'));
    seg = new window.SelfieSegmentation({ locateFile: (f) => `../node_modules/@mediapipe/selfie_segmentation/${f}` });
    seg.setOptions({ modelSelection: 1, selfieMode: false });
    seg.onResults((r) => { if (resolver) { const fn = resolver; resolver = null; fn(r); } });
    ready = seg.initialize().then(() => seg);
    return ready;
  }

  /**
   * Calcule le masque (alpha = personne) d'une image.
   * src : vidéo, image, canvas ou ImageBitmap. Renvoie un canvas w×h.
   */
  function mask(src, w, h, out) {
    const job = chain.then(async () => {
      await init();
      // MediaPipe n'accepte pas les ImageBitmap : passage par un canvas
      const sw = src.videoWidth || src.naturalWidth || src.width, sh = src.videoHeight || src.naturalHeight || src.height;
      input = input || document.createElement('canvas');
      const iw = Math.min(512, sw), ih = Math.max(1, Math.round((iw * sh) / sw));
      if (input.width !== iw || input.height !== ih) { input.width = iw; input.height = ih; }
      input.getContext('2d').drawImage(src, 0, 0, iw, ih);
      const r = await new Promise((resolve, reject) => {
        resolver = resolve;
        seg.send({ image: input }).catch((e) => { resolver = null; reject(e); });
      });
      const c = out || document.createElement('canvas');
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const x = c.getContext('2d');
      x.clearRect(0, 0, w, h);
      x.drawImage(r.segmentationMask, 0, 0, w, h);
      return c;
    });
    chain = job.catch(() => {});
    return job;
  }

  /** Centre horizontal/vertical (0–1) de la personne détectée, ou null. */
  function centroid(maskCanvas) {
    const w = 64, h = Math.max(1, Math.round((64 * maskCanvas.height) / maskCanvas.width));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(maskCanvas, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;
    let sx = 0, sy = 0, s = 0;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      // le masque MediaPipe porte la confiance dans le canal rouge/alpha
      const v = Math.max(d[i], d[i + 3]) / 255;
      if (v > 0.5) { sx += (p % w) * v; sy += Math.floor(p / w) * v; s += v; }
    }
    if (s < w * h * 0.01) return null;
    return { x: sx / s / w, y: sy / s / h, area: s / (w * h) };
  }

  window.Segmenter = { init, mask, centroid };
})();
