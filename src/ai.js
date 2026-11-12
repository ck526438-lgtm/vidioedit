/* VidioEdit — Assistant IA de montage automatique
 * - Mode « Local » : commandes en français comprises hors-ligne (gratuit, sans compte)
 * - Mode modèle de langage : Ollama (local), API compatible OpenAI, Anthropic Claude
 * L'IA ne modifie jamais le projet directement : elle produit une liste d'actions JSON
 * exécutées par le moteur ci-dessous (toutes annulables en un seul Ctrl+Z).
 */
(() => {
  'use strict';
  const api = window.api;
  const $ = (s) => document.querySelector(s);
  const V = () => window.__vidioedit;
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const num = (s) => parseFloat(String(s).replace(',', '.'));

  let history = []; // conversation pour le modèle
  let settings = { provider: 'local' };
  let busy = false;

  // ------------------------------------------------------------ Contexte du projet
  function orderedClips() {
    const v = V();
    const order = v.project.tracks.map((t) => t.id);
    return v.project.clips.slice().sort((a, b) => a.start - b.start || order.indexOf(a.trackId) - order.indexOf(b.trackId));
  }

  function summarize() {
    const v = V();
    const p = v.project;
    const lines = [
      `Projet "${p.name}" — format ${p.ratio}, durée totale ${v.totalDuration().toFixed(2)} s, curseur à ${v.time.toFixed(2)} s.`,
      `Pistes : ${p.tracks.map((t) => `${t.name} (${t.kind === 'audio' ? 'audio' : 'visuelle'}${t.main ? ', principale' : ''})`).join(', ')}.`,
      'Clips :',
    ];
    const clips = orderedClips();
    if (!clips.length) lines.push('  (aucun clip — la timeline est vide)');
    clips.forEach((c, i) => {
      const m = v.mediaById(c.mediaId);
      const t = v.trackById(c.trackId);
      const name = c.kind === 'text' ? `texte "${(c.text && c.text.content) || ''}"` : `${c.kind} "${m ? m.name : '?'}"`;
      lines.push(`  #${i + 1} ${name} | piste ${t ? t.name : '?'} | début ${c.start.toFixed(2)} s | durée ${c.dur.toFixed(2)} s | vitesse ${c.speed} | volume ${Math.round(c.volume * 100)}%${c.muted ? ' (muet)' : ''} | filtre ${c.filterId || 'none'}${m && m.hasAudio ? ' | contient du son' : ''}${c.id === v.selectedId ? ' | SÉLECTIONNÉ' : ''}`);
    });
    const unused = p.media.filter((m) => !p.clips.some((c) => c.mediaId === m.id));
    if (unused.length) lines.push(`Médias importés non utilisés : ${unused.map((m) => `"${m.name}" (${m.type}, ${m.duration.toFixed(1)} s)`).join(', ')}.`);
    return lines.join('\n');
  }

  function systemPrompt() {
    const P = V().P;
    return `Tu es l'assistant de montage de VidioEdit, un éditeur vidéo de type CapCut.
L'utilisateur te demande des modifications en langage naturel. Tu réponds UNIQUEMENT avec un objet JSON :
{"reply": "phrase courte en français expliquant ce que tu fais", "actions": [ ... ]}

Référence de clips ("clips") : un numéro (#1 = 1), une liste de numéros [1,3], ou "selected", "all", "video", "image", "audio", "text", "visual".

Actions disponibles :
- {"action":"remove_silences","clips":..., "threshold_db":-35, "min_silence":0.5, "padding":0.1}  supprime les blancs/silences et referme les trous
- {"action":"split_scenes","clips":..., "threshold":0.35}  coupe aux changements de plan
- {"action":"split","clips":..., "at":secondes}  coupe au temps donné de la timeline
- {"action":"delete","clips":...}
- {"action":"compact"}  colle les clips de la piste principale (supprime les trous)
- {"action":"speed","clips":..., "speed":0.25-4}
- {"action":"volume","clips":..., "volume":0-2}   (1 = 100 %)
- {"action":"mute","clips":..., "muted":true|false}
- {"action":"filter","clips":..., "filter":"${P.filters.map((f) => f.id).join('|')}"}
- {"action":"adjust","clips":..., "brightness":1, "contrast":1, "saturate":1, "hue":0, "blur":0, "grayscale":0, "sepia":0, "vignette":0}
- {"action":"add_text","content":"...", "start":s, "duration":s, "style":"${P.textPresets.map((t) => t.name).join('|')}", "position":"top|center|bottom", "color":"#hex", "size":90}
- {"action":"edit_text","clips":..., "content":"...", "color":"#hex", "size":90}
- {"action":"animate","clips":..., "in":"${P.animIn.map((a) => a.id).join('|')}", "out":"${P.animOut.map((a) => a.id).join('|')}", "duration":0.5}
- {"action":"fade","clips":..., "duration":0.5}   fondu en entrée et en sortie (transition douce)
- {"action":"transform","clips":..., "x":-1..1, "y":-1..1, "scale":1, "rotation":0, "opacity":1}
- {"action":"fit","clips":..., "mode":"cover|contain"}
- {"action":"duration","clips":..., "duration":s}   (images et textes, ou raccourcir une vidéo)
- {"action":"move","clips":..., "start":s}
- {"action":"add_media","name":"nom du fichier importé", "start":s (optionnel)}
- {"action":"ratio","ratio":"${P.ratios.map((r) => r.id).join('|')}"}
- {"action":"background","color":"#hex"}
- {"action":"undo"}

Règles : utilise seulement ces actions ; enchaîne-en plusieurs si besoin ; si la demande est impossible ou floue, renvoie "actions": [] et pose une question dans "reply". Les temps sont en secondes.`;
  }

  // ------------------------------------------------------------ Moteur d'actions
  function resolve(ref) {
    const v = V();
    const clips = orderedClips();
    if (ref == null || ref === 'selected') {
      const s = v.clipById(v.selectedId);
      return s ? [s] : [];
    }
    if (Array.isArray(ref)) return ref.flatMap((r) => resolve(r));
    if (typeof ref === 'number') return clips[ref - 1] ? [clips[ref - 1]] : [];
    const r = String(ref).toLowerCase().replace('#', '');
    if (/^\d+$/.test(r)) return clips[+r - 1] ? [clips[+r - 1]] : [];
    if (r === 'all') return clips;
    if (r === 'visual') return clips.filter((c) => c.kind !== 'audio');
    if (['video', 'image', 'audio', 'text'].includes(r)) return clips.filter((c) => c.kind === r);
    const byId = v.clipById(ref);
    return byId ? [byId] : [];
  }
  const media = (c) => (c.kind === 'video' || c.kind === 'image');

  function shiftAfter(trackId, fromT, delta, exceptId) {
    V().project.clips.forEach((x) => { if (x.trackId === trackId && x.id !== exceptId && x.start >= fromT - 1e-4) x.start = Math.max(0, x.start + delta); });
  }

  async function removeSilences(a, log) {
    const v = V();
    const targets = resolve(a.clips || 'all').filter((c) => {
      const m = v.mediaById(c.mediaId);
      return m && m.hasAudio && !m.missing && (c.kind === 'video' || c.kind === 'audio');
    }).sort((x, y) => y.start - x.start);
    if (!targets.length) { log.push('Aucun clip avec du son à analyser.'); return; }
    const pad = a.padding != null ? a.padding : 0.1;
    let removedTotal = 0;
    for (const c of targets) {
      const m = v.mediaById(c.mediaId);
      const len = c.dur * c.speed;
      status(`Analyse des silences : ${m.name}…`);
      const sil = await api.aiSilences({ file: m.path, start: c.in, len, noiseDb: a.threshold_db || -35, minDur: a.min_silence || 0.5 });
      // segments à garder (temps source relatifs)
      const keep = [];
      let pos = 0;
      sil.forEach(([s, e]) => {
        const ks = pos, ke = Math.min(len, s + pad);
        if (ke - ks > 0.15) keep.push([ks, ke]);
        pos = Math.max(pos, e - pad);
      });
      if (len - pos > 0.15) keep.push([pos, len]);
      if (!keep.length || (keep.length === 1 && keep[0][0] < 0.01 && keep[0][1] > len - 0.01)) continue;
      const oldEnd = c.start + c.dur;
      const baseIn = c.in;
      let t = c.start;
      const parts = [];
      keep.forEach(([ks, ke], i) => {
        const part = i === 0 ? c : Object.assign(v.clone(c), { id: v.uid() });
        part.in = baseIn + ks;
        part.dur = (ke - ks) / c.speed;
        part.start = t;
        if (i > 0) { part.animIn = { type: 'none', dur: c.animIn.dur }; part.fadeIn = 0; }
        if (i < keep.length - 1) { part.animOut = { type: 'none', dur: c.animOut.dur }; part.fadeOut = 0; }
        t += part.dur;
        if (i > 0) v.project.clips.push(part);
        parts.push(part);
      });
      const removed = oldEnd - t;
      removedTotal += removed;
      shiftAfter(c.trackId, oldEnd, -removed, null);
      parts.forEach((pp, i) => { if (i > 0) pp.start = parts[i - 1].start + parts[i - 1].dur; });
      parts[0].start = parts[0].start; // inchangé
    }
    log.push(removedTotal > 0.05 ? `Silences supprimés : ${removedTotal.toFixed(1)} s retirées.` : 'Aucun silence significatif trouvé.');
  }

  async function splitScenes(a, log) {
    const v = V();
    const targets = resolve(a.clips || 'video').filter((c) => c.kind === 'video');
    let n = 0;
    for (const c of targets) {
      const m = v.mediaById(c.mediaId);
      if (!m || m.missing) continue;
      status(`Détection des plans : ${m.name}…`);
      const times = await api.aiScenes({ file: m.path, start: c.in, len: c.dur * c.speed, threshold: a.threshold || 0.35 });
      let cur = c;
      times.sort((x, y) => x - y).forEach((rel) => {
        const t = c.start + rel / c.speed;
        if (t > cur.start + 0.2 && t < cur.start + cur.dur - 0.2) { cur = v.splitClip(cur, t); n++; }
      });
    }
    log.push(n ? `${n} coupe(s) aux changements de plan.` : 'Aucun changement de plan détecté.');
  }

  async function runAction(a, log) {
    const v = V();
    const P = v.P;
    const list = () => resolve(a.clips);
    switch (a.action) {
      case 'remove_silences': return removeSilences(a, log);
      case 'split_scenes': return splitScenes(a, log);
      case 'split': {
        const t = num(a.at != null ? a.at : v.time);
        const cs = (a.clips ? list() : v.project.clips.slice()).filter((c) => t > c.start + 0.05 && t < c.start + c.dur - 0.05);
        cs.forEach((c) => v.splitClip(c, t));
        log.push(cs.length ? `Coupé à ${v.fmtTime(t)}.` : `Rien à couper à ${v.fmtTime(t)}.`);
        return;
      }
      case 'delete': {
        const cs = list();
        cs.sort((x, y) => y.start - x.start).forEach((c) => {
          v.project.clips = v.project.clips.filter((x) => x.id !== c.id);
          if (c.trackId === 'v1') shiftAfter('v1', c.start + c.dur, -c.dur);
        });
        if (cs.some((c) => c.id === v.selectedId)) v.selectedId = null;
        log.push(`${cs.length} clip(s) supprimé(s).`);
        return;
      }
      case 'compact': {
        let pos = 0;
        v.project.clips.filter((c) => c.trackId === 'v1').sort((x, y) => x.start - y.start).forEach((c) => { c.start = pos; pos += c.dur; });
        log.push('Trous supprimés sur la piste principale.');
        return;
      }
      case 'speed': {
        const s = Math.min(4, Math.max(0.25, num(a.speed) || 1));
        const cs = list().filter((c) => c.kind === 'video' || c.kind === 'audio');
        cs.sort((x, y) => y.start - x.start).forEach((c) => {
          const oldEnd = c.start + c.dur;
          c.dur = (c.dur * c.speed) / s;
          c.speed = s;
          if (c.trackId === 'v1') shiftAfter('v1', oldEnd, c.start + c.dur - oldEnd, c.id);
        });
        log.push(`Vitesse ${s}× sur ${cs.length} clip(s).`);
        return;
      }
      case 'volume': list().forEach((c) => { c.volume = Math.min(2, Math.max(0, num(a.volume))); c.muted = false; }); log.push(`Volume réglé à ${Math.round(num(a.volume) * 100)} %.`); return;
      case 'mute': list().forEach((c) => { c.muted = a.muted !== false; }); log.push(a.muted !== false ? 'Son coupé.' : 'Son réactivé.'); return;
      case 'filter': {
        const f = P.filters.find((x) => x.id === a.filter || norm(x.name) === norm(a.filter)) || P.filters[0];
        const cs = list().filter(media);
        cs.forEach((c) => { c.adjust = v.clone(f.adjust); c.filterId = f.id; });
        log.push(`Filtre « ${f.name} » appliqué à ${cs.length} clip(s).`);
        return;
      }
      case 'adjust': {
        const keys = Object.keys(P.defaultAdjust);
        const cs = list().filter(media);
        cs.forEach((c) => { c.adjust = c.adjust || {}; keys.forEach((k) => { if (a[k] != null) c.adjust[k] = num(a[k]); }); c.filterId = 'custom'; });
        log.push(`Réglages modifiés sur ${cs.length} clip(s).`);
        return;
      }
      case 'add_text': {
        const start = a.start != null ? Math.max(0, num(a.start)) : v.time;
        const dur = Math.max(0.3, num(a.duration) || 3);
        const preset = P.textPresets.find((t) => norm(t.name) === norm(a.style)) || P.textPresets[1];
        const text = Object.assign(v.clone(P.defaultText), v.clone(preset.style), { content: a.content || 'Titre' });
        if (a.color) text.color = a.color;
        if (a.size) text.size = num(a.size);
        const y = a.position === 'top' ? -0.7 : a.position === 'bottom' ? 0.72 : 0;
        const trackId = v.findFreeTrack('visual', start, start + dur, 't1');
        const c = v.makeClip('text', trackId, start, dur, {
          text, transform: { x: 0, y, scale: 1, rotation: 0, opacity: 1 },
          animIn: { type: 'fade', dur: 0.4 }, animOut: { type: 'fade', dur: 0.4 },
        });
        v.project.clips.push(c);
        v.selectedId = c.id;
        log.push(`Texte « ${text.content} » ajouté à ${v.fmtTime(start)}.`);
        return;
      }
      case 'edit_text': {
        const cs = list().filter((c) => c.kind === 'text');
        cs.forEach((c) => { if (a.content != null) c.text.content = a.content; if (a.color) c.text.color = a.color; if (a.size) c.text.size = num(a.size); });
        log.push(`${cs.length} texte(s) modifié(s).`);
        return;
      }
      case 'animate': {
        const d = num(a.duration) || 0.5;
        const cs = list().filter((c) => c.kind !== 'audio');
        cs.forEach((c) => {
          if (a.in) c.animIn = { type: a.in, dur: Math.min(d, c.dur / 2) };
          if (a.out) c.animOut = { type: a.out, dur: Math.min(d, c.dur / 2) };
        });
        log.push(`Animations appliquées à ${cs.length} clip(s).`);
        return;
      }
      case 'fade': {
        const d = num(a.duration) || 0.5;
        const cs = list();
        cs.forEach((c) => { c.fadeIn = c.fadeOut = Math.min(d, c.dur / 2); });
        log.push(`Fondus de ${d} s sur ${cs.length} clip(s).`);
        return;
      }
      case 'transform': list().filter((c) => c.kind !== 'audio').forEach((c) => {
        ['x', 'y', 'scale', 'rotation', 'opacity'].forEach((k) => { if (a[k] != null) c.transform[k] = num(a[k]); });
      }); log.push('Position / taille modifiée.'); return;
      case 'fit': list().filter(media).forEach((c) => { c.fit = a.mode === 'contain' ? 'contain' : 'cover'; }); log.push(a.mode === 'contain' ? 'Image entière visible.' : 'Cadre rempli (recadrage).'); return;
      case 'duration': {
        const cs = list();
        cs.forEach((c) => {
          const m = v.mediaById(c.mediaId);
          let d = Math.max(0.1, num(a.duration));
          if (m && m.type !== 'image' && c.kind !== 'text') d = Math.min(d, (m.duration - c.in) / c.speed);
          const oldEnd = c.start + c.dur;
          c.dur = d;
          if (c.trackId === 'v1') shiftAfter('v1', oldEnd, c.start + c.dur - oldEnd, c.id);
        });
        log.push(`Durée modifiée sur ${cs.length} clip(s).`);
        return;
      }
      case 'move': list().forEach((c) => { c.start = Math.max(0, num(a.start)); }); log.push('Clip déplacé.'); return;
      case 'add_media': {
        const m = v.project.media.find((x) => norm(x.name).includes(norm(a.name)));
        if (!m) { log.push(`Média « ${a.name} » introuvable.`); return; }
        v.addMediaToTimeline(m, a.start != null ? num(a.start) : null);
        undoMerge = true; // addMediaToTimeline a déjà poussé un historique
        log.push(`« ${m.name} » ajouté à la timeline.`);
        return;
      }
      case 'ratio': if (P.ratios.find((r) => r.id === a.ratio)) { v.project.ratio = a.ratio; v.applyCanvasSize(); log.push(`Format ${a.ratio}.`); } return;
      case 'background': v.project.bg = a.color || '#000000'; log.push('Couleur de fond modifiée.'); return;
      case 'undo': v.undo(); log.push('Dernière action annulée.'); return;
      default: log.push(`Action inconnue ignorée : ${a.action}`);
    }
  }

  let undoMerge = false;
  async function execute(actions) {
    const v = V();
    const log = [];
    if (!actions || !actions.length) return log;
    const onlyUndo = actions.every((a) => a.action === 'undo');
    if (!onlyUndo) v.pushHistory();
    for (const a of actions) {
      try { await runAction(a, log); } catch (e) { console.error(e); log.push(`Erreur (${a.action}) : ${e.message || e}`); }
    }
    status('');
    v.markDirty();
    v.refreshAll();
    return log;
  }

  // ------------------------------------------------------------ Compréhension locale (hors-ligne)
  function localParse(text) {
    const v = V();
    const P = v.P;
    const t = norm(text);
    const actions = [];
    const hasSel = !!v.clipById(v.selectedId);
    const clipNum = t.match(/clips?\s*(?:n[o°]?\s*)?#?(\d+)/);
    const scopeAll = /(partout|tout|tous|toutes|chaque|ensemble|l'ensemble)/.test(t);
    const scope = clipNum ? +clipNum[1] : scopeAll || !hasSel ? 'all' : 'selected';
    const secs = (() => { const m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:s\b|sec|seconde)/); return m ? num(m[1]) : null; })();
    const quoted = (() => { const m = String(text).match(/["«“'](.+?)["»”']/) || String(text).match(/:\s*(.+)$/); return m ? m[1].trim() : null; })();

    if (/^(annule|undo|retour)/.test(t)) return { reply: 'J\'annule la dernière modification.', actions: [{ action: 'undo' }] };

    const auto = /(montage auto|automatique|monte (la|ma|cette) video|fais (le|un) montage|edit auto)/.test(t);
    if (auto) {
      actions.push({ action: 'remove_silences', clips: 'all' }, { action: 'compact' },
        { action: 'fade', clips: 'visual', duration: 0.3 }, { action: 'animate', clips: 'image', in: 'zoomIn', out: 'fade', duration: 0.6 });
      if (!v.project.clips.some((c) => c.kind === 'text')) actions.push({ action: 'add_text', content: quoted || v.project.name, start: 0, duration: 3, style: 'Titre' });
    }
    if (!auto && /(silence|blanc|pause)/.test(t) && /(supprim|enlev|retir|coup|vire|nettoi)/.test(t)) actions.push({ action: 'remove_silences', clips: scope === 'selected' ? 'selected' : 'all' });
    if (/(scene|plan)/.test(t) && /(coup|decoup|detect|separ|divis)/.test(t)) actions.push({ action: 'split_scenes', clips: scope });
    if (!auto && /(trou|vide|espace|ecart)/.test(t) && /(supprim|enlev|ferm|colle|retir)/.test(t)) actions.push({ action: 'compact' });

    // Coupe à un instant
    const cutAt = t.match(/coup\w*\s+(?:a|au|vers)\s+(?:(\d+):(\d{1,2})|(\d+(?:[.,]\d+)?)\s*s)/);
    if (cutAt) actions.push({ action: 'split', at: cutAt[3] ? num(cutAt[3]) : (+cutAt[1]) * 60 + (+cutAt[2]) });

    // Filtres
    const filterWords = [
      ['bw', /(noir (et|&) blanc|n&b|n et b|monochrome)/], ['vintage', /(vintage|retro|ancien)/], ['vivid', /(vif|vives|eclatant)/],
      ['warm', /\bchaud/], ['cold', /\bfroid/], ['cinema', /(cinema|cinematique|film)(?!.*format)/], ['fade', /delave/],
      ['drama', /dramatique/], ['dream', /(reve|onirique)/], ['noir', /polar/], ['pop', /\bpop\b/], ['none', /(sans filtre|enleve le filtre|retire le filtre|original)/],
    ];
    if (!/format/.test(t)) {
      const f = filterWords.find(([, re]) => re.test(t));
      if (f) actions.push({ action: 'filter', clips: scope === 'selected' ? 'selected' : clipNum ? scope : 'visual', filter: f[0] });
    }

    // Vitesse
    const sp = t.match(/(?:x|×)\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:x|×|fois)\b/);
    if (/(vitesse|accelere|accelerer|rapide|ralenti|lent)/.test(t) || (sp && /(video|clip)/.test(t))) {
      let s = sp ? num(sp[1] || sp[2]) : null;
      if (!s) s = /(ralenti|lent)/.test(t) ? 0.5 : 2;
      if (/(ralenti|lent)/.test(t) && s > 1) s = 1 / s;
      actions.push({ action: 'speed', clips: scope, speed: s });
    }

    // Son
    const vol = t.match(/volume\s*(?:a|de)?\s*(\d+)\s*%?/);
    if (vol) actions.push({ action: 'volume', clips: scope, volume: +vol[1] / 100 });
    else if (/(remets|reactive|active) le son/.test(t)) actions.push({ action: 'mute', clips: scope, muted: false });
    else if (/(coupe le son|muet|sans son|enleve le son|mute)/.test(t)) actions.push({ action: 'mute', clips: scope === 'all' ? 'video' : scope, muted: true });

    // Format
    if (/(9:16|tiktok|reels?|shorts?|vertical|story)/.test(t)) actions.push({ action: 'ratio', ratio: '9:16' });
    else if (/(16:9|youtube|horizontal|paysage)/.test(t)) actions.push({ action: 'ratio', ratio: '16:9' });
    else if (/(1:1|carre|instagram)/.test(t)) actions.push({ action: 'ratio', ratio: '1:1' });
    else if (/4:5/.test(t)) actions.push({ action: 'ratio', ratio: '4:5' });
    else if (/(21:9|format cinema)/.test(t)) actions.push({ action: 'ratio', ratio: '21:9' });
    if (/(remplir|plein ecran|sans bandes|bandes noires)/.test(t)) actions.push({ action: 'fit', clips: 'visual', mode: 'cover' });

    // Texte
    if (!auto && /(ajoute|mets|met|ecris|insere|place).*(titre|texte|sous-titre|legende|ecriture)/.test(t)) {
      actions.push({
        action: 'add_text', content: quoted || 'Votre texte', start: /debut/.test(t) ? 0 : /fin/.test(t) ? Math.max(0, v.totalDuration() - 3) : v.time,
        duration: secs || 3, style: /sous-titre|legende/.test(t) ? 'Sous-titre' : /neon/.test(t) ? 'Néon' : 'Titre',
        position: /(haut)/.test(t) ? 'top' : /(bas|sous-titre|legende)/.test(t) ? 'bottom' : 'center',
      });
    }

    // Transitions / animations
    if (!auto && /(fondu|transition|enchaine)/.test(t)) actions.push({ action: 'fade', clips: scope === 'selected' ? 'selected' : 'visual', duration: secs || 0.5 });
    if (/zoom/.test(t)) actions.push({ action: 'animate', clips: scope === 'selected' ? 'selected' : 'visual', in: /arriere|dezoom/.test(t) ? 'zoomOut' : 'zoomIn', duration: secs || 0.6 });
    if (/(rebond|pop)\b.*anim|anim.*(rebond)/.test(t)) actions.push({ action: 'animate', clips: scope, in: 'pop', duration: 0.5 });

    // Lumière / couleurs
    if (/(plus lumineu|eclairci|plus clair|lumineux)/.test(t)) actions.push({ action: 'adjust', clips: scope === 'selected' ? 'selected' : 'visual', brightness: 1.2 });
    if (/(plus sombre|assombri)/.test(t)) actions.push({ action: 'adjust', clips: scope === 'selected' ? 'selected' : 'visual', brightness: 0.8 });
    if (/contraste/.test(t)) actions.push({ action: 'adjust', clips: scope === 'selected' ? 'selected' : 'visual', contrast: /(moins|baisse|reduis)/.test(t) ? 0.8 : 1.25 });

    // Suppression
    if (/(supprim|efface|enleve|retire)\w*\s+(le |la )?(clip|selection)/.test(t) && !/(silence|trou|filtre|son)/.test(t)) actions.push({ action: 'delete', clips: scope === 'all' && !scopeAll ? 'selected' : scope });

    if (!actions.length) {
      return {
        reply: 'Je n\'ai pas compris. Exemples : « supprime les silences », « coupe aux changements de plan », « filtre vintage partout », '
          + '« accélère le clip 2 x2 », « ajoute le titre \"Mon voyage\" en haut », « format TikTok », « fondus partout », « montage automatique ». '
          + 'Pour des demandes libres, branchez un modèle IA dans ⚙ Réglages.',
        actions: [],
      };
    }
    return { reply: auto ? 'Montage automatique : silences supprimés, trous fermés, transitions et titre.' : 'C\'est parti :', actions };
  }

  // ------------------------------------------------------------ Modèle de langage
  function parseJson(txt) {
    if (!txt) throw new Error('Réponse vide du modèle');
    const m = String(txt).match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Réponse non JSON du modèle');
    const o = JSON.parse(m[0]);
    if (!Array.isArray(o.actions)) o.actions = [];
    return o;
  }

  async function askModel(text) {
    const user = `État actuel du projet :\n${summarize()}\n\nDemande : ${text}`;
    const msgs = history.slice(-8).concat([{ role: 'user', content: user }]);
    const raw = await api.aiChat({ system: systemPrompt(), messages: msgs });
    const o = parseJson(raw);
    history.push({ role: 'user', content: text }, { role: 'assistant', content: JSON.stringify(o) });
    return o;
  }

  // ------------------------------------------------------------ Interface du chat
  function addMsg(role, text, extra) {
    const log = $('#aiLog');
    const d = document.createElement('div');
    d.className = `ai-msg ${role}`;
    const p = document.createElement('div');
    p.textContent = text;
    d.appendChild(p);
    if (extra && extra.length) {
      const ul = document.createElement('ul');
      extra.forEach((x) => { const li = document.createElement('li'); li.textContent = x; ul.appendChild(li); });
      d.appendChild(ul);
    }
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }
  function status(s) { const el = $('#aiStatus'); if (el) el.textContent = s; }

  async function send(text) {
    text = (text || '').trim();
    if (!text || busy) return;
    busy = true;
    $('#aiSend').disabled = true;
    addMsg('user', text);
    $('#aiInput').value = '';
    const v = V();
    if (!v.project.clips.length && !/(format|fond|ratio|titre|texte|ajoute)/.test(norm(text))) {
      addMsg('bot', 'La timeline est vide : importez d\'abord une vidéo (onglet Médias), puis redemandez-moi.');
      busy = false; $('#aiSend').disabled = false; return;
    }
    let result;
    try {
      if (settings.provider && settings.provider !== 'local') {
        status('L\'IA réfléchit…');
        try {
          result = await askModel(text);
        } catch (e) {
          console.error(e);
          addMsg('bot', `Modèle IA indisponible (${String(e.message || e).slice(0, 160)}). J'utilise le mode local.`);
          result = localParse(text);
        }
      } else {
        result = localParse(text);
      }
      status('Application des modifications…');
      const log = await execute(result.actions);
      const m = addMsg('bot', result.reply || 'Terminé.', log);
      if (result.actions.length && !result.actions.every((a) => a.action === 'undo')) {
        const b = document.createElement('button');
        b.className = 'ghost small';
        b.textContent = '↶ Annuler ces modifications';
        b.onclick = () => { V().undo(); b.disabled = true; b.textContent = 'Annulé'; };
        m.appendChild(b);
      }
    } catch (e) {
      addMsg('bot', `Erreur : ${e.message || e}`);
    }
    status('');
    busy = false;
    $('#aiSend').disabled = false;
  }

  const PROVIDERS = {
    local: { label: 'Local (hors-ligne, gratuit)', model: '', endpoint: '', key: false },
    ollama: { label: 'Ollama (IA locale gratuite)', model: 'llama3.1', endpoint: 'http://localhost:11434', key: false },
    openai: { label: 'Compatible OpenAI (OpenAI, Groq, OpenRouter, Mistral, Gemini, LM Studio…)', model: 'gpt-4o-mini', endpoint: 'https://api.openai.com/v1', key: true },
    anthropic: { label: 'Anthropic Claude', model: 'claude-sonnet-5-5', endpoint: '', key: true },
  };

  function renderSettings() {
    const sel = $('#aiProvider');
    sel.innerHTML = '';
    Object.entries(PROVIDERS).forEach(([id, p]) => { const o = document.createElement('option'); o.value = id; o.textContent = p.label; sel.appendChild(o); });
    sel.value = settings.provider || 'local';
    const upd = () => {
      const p = PROVIDERS[sel.value];
      $('#aiModelRow').classList.toggle('hidden', sel.value === 'local');
      $('#aiEndpointRow').classList.toggle('hidden', sel.value === 'local' || sel.value === 'anthropic');
      $('#aiKeyRow').classList.toggle('hidden', !p.key);
      $('#aiModel').placeholder = p.model;
      $('#aiEndpoint').placeholder = p.endpoint;
    };
    sel.onchange = upd;
    $('#aiModel').value = settings.model || '';
    $('#aiEndpoint').value = settings.endpoint || '';
    $('#aiKey').value = settings.apiKey || '';
    upd();
    updateModeChip();
  }
  function updateModeChip() {
    const p = settings.provider || 'local';
    $('#aiMode').textContent = p === 'local' ? 'Mode local' : PROVIDERS[p].label.split(' (')[0];
  }

  async function init() {
    try { settings = Object.assign({ provider: 'local' }, await api.getSettings()); } catch (_) { /* */ }
    renderSettings();
    $('#aiSend').onclick = () => send($('#aiInput').value);
    $('#aiInput').addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send($('#aiInput').value); }
    });
    document.querySelectorAll('#aiChips button').forEach((b) => { b.onclick = () => send(b.dataset.q || b.textContent); });
    $('#aiSettingsBtn').onclick = () => $('#aiSettings').classList.toggle('hidden');
    $('#aiSave').onclick = async () => {
      settings = { provider: $('#aiProvider').value, model: $('#aiModel').value.trim(), endpoint: $('#aiEndpoint').value.trim(), apiKey: $('#aiKey').value.trim() };
      await api.setSettings(settings);
      updateModeChip();
      $('#aiSettings').classList.add('hidden');
      V().toast('Réglages IA enregistrés');
    };
    addMsg('bot', 'Bonjour ! Je suis l\'assistant de montage. Dites-moi ce que vous voulez : « supprime les silences », « montage automatique », « filtre cinéma partout », « format TikTok »… '
      + 'Toutes mes modifications s\'annulent en un clic.');
  }

  window.VidioAI = { send, localParse, execute, summarize };
  if (window.__vidioedit) init(); else document.addEventListener('vidioedit-ready', init, { once: true });
})();
