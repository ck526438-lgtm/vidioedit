/* VidioEdit — générateur de musiques et bruitages libres de droits
 * Tout est synthétisé localement (Web Audio) : chaque morceau est unique et
 * appartient à l'utilisateur, sans licence ni attribution.
 * Licence MIT — https://github.com/ck526438-lgtm/vidioedit
 */
(() => {
  'use strict';
  const SR = 44100;

  // Générateur pseudo-aléatoire reproductible
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
  }
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  const STYLES = {
    lofi: { name: 'Lo-fi chill', bpm: [72, 84], swing: 0.12, scale: 'minor', prog: [[0, 3, 6, 4], [0, 5, 3, 4], [1, 4, 0, 0]], drums: 'lofi', bass: 'soft', chords: 'keys', lead: 'none', crackle: true },
    upbeat: { name: 'Pop entraînante', bpm: [112, 124], swing: 0, scale: 'major', prog: [[0, 4, 5, 3], [0, 5, 3, 4], [5, 3, 0, 4]], drums: 'four', bass: 'octave', chords: 'pluck', lead: 'arp', crackle: false },
    chill: { name: 'Doux / vlog', bpm: [92, 104], swing: 0.05, scale: 'major', prog: [[0, 3, 4, 3], [0, 5, 3, 4], [3, 4, 0, 5]], drums: 'light', bass: 'soft', chords: 'piano', lead: 'arp', crackle: false },
    cinematic: { name: 'Cinématique épique', bpm: [84, 96], swing: 0, scale: 'minor', prog: [[0, 5, 2, 6], [0, 3, 5, 4], [0, 6, 5, 4]], drums: 'epic', bass: 'drone', chords: 'pad', lead: 'none', crackle: false },
    trap: { name: 'Hip-hop / trap', bpm: [136, 148], swing: 0, scale: 'minor', prog: [[0, 0, 5, 6], [0, 3, 5, 4], [0, 6, 5, 6]], drums: 'trap', bass: '808', chords: 'pad', lead: 'bell', crackle: false },
    afro: { name: 'Afrobeat / amapiano', bpm: [108, 114], swing: 0.08, scale: 'minor', prog: [[0, 5, 3, 6], [0, 3, 6, 4], [5, 3, 0, 6]], drums: 'afro', bass: 'log', chords: 'piano', lead: 'none', crackle: false },
    corporate: { name: 'Entreprise / présentation', bpm: [100, 110], swing: 0, scale: 'major', prog: [[0, 4, 5, 3], [3, 0, 4, 5], [0, 5, 3, 4]], drums: 'light', bass: 'octave', chords: 'pluck', lead: 'bell', crackle: false },
    suspense: { name: 'Suspense', bpm: [78, 88], swing: 0, scale: 'minor', prog: [[0, 1, 0, 6], [0, 0, 5, 6], [0, 6, 5, 1]], drums: 'epic', bass: 'drone', chords: 'pad', lead: 'bell', crackle: false },
  };
  const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };

  function chordNotes(root, scale, degree, size = 3) {
    const sc = SCALES[scale];
    const out = [];
    for (let i = 0; i < size; i++) {
      const idx = degree + i * 2;
      out.push(root + sc[idx % 7] + 12 * Math.floor(idx / 7));
    }
    return out;
  }

  // ------------------------------------------------------------ Instruments
  function makeNoise(ctx) {
    const b = ctx.createBuffer(1, SR * 2, SR);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function env(g, t, a, peak, dec, sus = 0, rel = 0.05, dur = 0) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    if (dur) {
      g.gain.setTargetAtTime(Math.max(0.0001, peak * sus), t + a, dec / 3);
      g.gain.setTargetAtTime(0.0001, t + dur, rel / 3);
    } else {
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
    }
  }
  function I(ctx, out, noise) {
    const osc = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; };
    const gain = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const filt = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    const nsrc = () => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; return s; };
    const play = (node, t, d) => { node.start(t, node.buffer ? Math.random() : undefined); node.stop(t + d + 0.1); };
    return {
      kick(t, v = 1) {
        const o = osc('sine', 150), g = gain();
        o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
        env(g, t, 0.003, 0.9 * v, 0.42);
        o.connect(g).connect(out); play(o, t, 0.5);
      },
      snare(t, v = 1, tone = 190) {
        const n = nsrc(), f = filt('highpass', 1400), g = gain();
        env(g, t, 0.002, 0.45 * v, 0.2);
        n.connect(f).connect(g).connect(out); play(n, t, 0.25);
        const o = osc('triangle', tone), g2 = gain();
        env(g2, t, 0.002, 0.35 * v, 0.1);
        o.connect(g2).connect(out); play(o, t, 0.15);
      },
      clap(t, v = 1) {
        const n = nsrc(), f = filt('bandpass', 1300, 1.2), g = gain();
        g.gain.setValueAtTime(0.0001, t);
        [0, 0.012, 0.024].forEach((dt) => { g.gain.setValueAtTime(0.5 * v, t + dt); g.gain.exponentialRampToValueAtTime(0.05, t + dt + 0.01); });
        g.gain.setValueAtTime(0.45 * v, t + 0.035); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        n.connect(f).connect(g).connect(out); play(n, t, 0.3);
      },
      hat(t, v = 1, open = false) {
        const n = nsrc(), f = filt('highpass', 7500), g = gain();
        env(g, t, 0.001, 0.22 * v, open ? 0.28 : 0.045);
        n.connect(f).connect(g).connect(out); play(n, t, open ? 0.35 : 0.08);
      },
      shaker(t, v = 1) {
        const n = nsrc(), f = filt('bandpass', 6500, 1.5), g = gain();
        env(g, t, 0.008, 0.14 * v, 0.06);
        n.connect(f).connect(g).connect(out); play(n, t, 0.1);
      },
      rim(t, v = 1) {
        const o = osc('square', 1700), f = filt('bandpass', 1800, 4), g = gain();
        env(g, t, 0.001, 0.25 * v, 0.03);
        o.connect(f).connect(g).connect(out); play(o, t, 0.05);
      },
      tom(t, note, v = 1) {
        const o = osc('sine', mtof(note) * 1.6), g = gain();
        o.frequency.exponentialRampToValueAtTime(mtof(note), t + 0.2);
        env(g, t, 0.003, 0.7 * v, 0.6);
        o.connect(g).connect(out); play(o, t, 0.7);
      },
      bass(t, note, dur, v = 1, bright = 700) {
        const o = osc('sawtooth', mtof(note)), o2 = osc('triangle', mtof(note - 12)), f = filt('lowpass', bright, 2), g = gain();
        f.frequency.setValueAtTime(bright * 1.8, t); f.frequency.exponentialRampToValueAtTime(bright * 0.6, t + 0.25);
        env(g, t, 0.01, 0.32 * v, 0.2, 0.7, 0.08, dur);
        o.connect(f); o2.connect(f); f.connect(g).connect(out);
        play(o, t, dur + 0.2); play(o2, t, dur + 0.2);
      },
      b808(t, note, dur, v = 1) {
        const o = osc('sine', mtof(note) * 1.5), g = gain(), sh = ctx.createWaveShaper();
        const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.2); } sh.curve = curve;
        o.frequency.setValueAtTime(mtof(note) * 1.5, t); o.frequency.exponentialRampToValueAtTime(mtof(note), t + 0.06);
        env(g, t, 0.004, 0.75 * v, 0.6, 0.6, 0.2, Math.max(0.3, dur));
        o.connect(sh).connect(g).connect(out); play(o, t, dur + 0.5);
      },
      logdrum(t, note, v = 1) {
        const o = osc('sine', mtof(note + 12)), f = filt('lowpass', 900), g = gain();
        o.frequency.setValueAtTime(mtof(note + 7), t); o.frequency.exponentialRampToValueAtTime(mtof(note), t + 0.05);
        env(g, t, 0.003, 0.8 * v, 0.35);
        o.connect(f).connect(g).connect(out); play(o, t, 0.45);
      },
      keys(t, notes, dur, v = 1) {
        notes.forEach((n) => {
          const o = osc('sine', mtof(n)), o2 = osc('triangle', mtof(n) * 2), g = gain(), g2 = gain(0.18), trem = osc('sine', 4.5), tg = gain(0.12);
          trem.connect(tg).connect(g.gain);
          env(g, t, 0.02, 0.13 * v, 0.9, 0.5, 0.4, dur);
          o.connect(g); o2.connect(g2).connect(g); g.connect(out);
          play(o, t, dur + 0.5); play(o2, t, dur + 0.5); play(trem, t, dur + 0.5);
        });
      },
      piano(t, notes, dur, v = 1) {
        notes.forEach((n) => {
          const f = mtof(n);
          [[1, 0.16], [2, 0.06], [3, 0.03], [4, 0.015]].forEach(([h, a]) => {
            const o = osc(h === 1 ? 'triangle' : 'sine', f * h), g = gain();
            env(g, t, 0.004, a * v, 1.6 / h);
            o.connect(g).connect(out); play(o, t, Math.min(dur + 1, 2.5));
          });
        });
      },
      pluck(t, notes, dur, v = 1) {
        notes.forEach((n) => {
          const o = osc('sawtooth', mtof(n)), o2 = osc('sawtooth', mtof(n) * 1.006), f = filt('lowpass', 3200, 3), g = gain();
          f.frequency.setValueAtTime(3800, t); f.frequency.exponentialRampToValueAtTime(500, t + 0.25);
          env(g, t, 0.003, 0.07 * v, 0.35);
          o.connect(f); o2.connect(f); f.connect(g).connect(out);
          play(o, t, 0.5); play(o2, t, 0.5);
        });
      },
      pad(t, notes, dur, v = 1, bright = 1400) {
        notes.forEach((n) => {
          const f = filt('lowpass', bright, 0.8), g = gain();
          [-0.08, 0.08, 12.03].forEach((det) => { const o = osc('sawtooth', mtof(n + det)); o.connect(f); play(o, t, dur + 1.2); });
          env(g, t, Math.min(0.8, dur * 0.3), 0.045 * v, 0.5, 0.9, 1.0, dur);
          f.connect(g).connect(out);
        });
      },
      bell(t, note, v = 1) {
        const f = mtof(note);
        [[1, 0.1], [2.76, 0.04], [5.4, 0.02]].forEach(([h, a]) => {
          const o = osc('sine', f * h), g = gain();
          env(g, t, 0.002, a * v, 1.2 / Math.sqrt(h));
          o.connect(g).connect(out); play(o, t, 1.4);
        });
      },
      lead(t, note, dur, v = 1) {
        const o = osc('triangle', mtof(note)), g = gain();
        env(g, t, 0.005, 0.1 * v, 0.25, 0.3, 0.1, dur);
        o.connect(g).connect(out); play(o, t, dur + 0.2);
      },
      noiseBed(t, dur, v = 1) {
        const n = nsrc(), f = filt('bandpass', 3000, 0.4), g = gain(0.012 * v);
        n.connect(f).connect(g).connect(out); play(n, t, dur);
        for (let x = t; x < t + dur; x += 0.07 + Math.random() * 0.4) {
          const c = nsrc(), cg = gain(); env(cg, x, 0.001, 0.05 * v * Math.random(), 0.01);
          c.connect(cg).connect(out); play(c, x, 0.02);
        }
      },
      sweep(t, dur, v = 1, up = true) {
        const n = nsrc(), f = filt('bandpass', up ? 300 : 6000, 2), g = gain();
        f.frequency.setValueAtTime(up ? 300 : 6000, t); f.frequency.exponentialRampToValueAtTime(up ? 8000 : 200, t + dur);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.18 * v, t + dur * (up ? 0.95 : 0.1)); g.gain.linearRampToValueAtTime(0.0001, t + dur);
        n.connect(f).connect(g).connect(out); play(n, t, dur);
      },
    };
  }

  function reverb(ctx, secs = 2.2, decay = 3) {
    const len = Math.floor(SR * secs);
    const b = ctx.createBuffer(2, len, SR);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    const cv = ctx.createConvolver(); cv.buffer = b; return cv;
  }

  // ------------------------------------------------------------ Composition
  async function generateTrack({ style = 'lofi', duration = 60, seed = Date.now() } = {}) {
    const S = STYLES[style] || STYLES.lofi;
    const R = rng(seed);
    const bpm = Math.round(S.bpm[0] + R() * (S.bpm[1] - S.bpm[0]));
    const beat = 60 / bpm, bar = beat * 4;
    const bars = Math.max(4, Math.round(duration / bar));
    const total = bars * bar;
    const ctx = new OfflineAudioContext(2, Math.ceil((total + 2) * SR), SR);
    const noise = makeNoise(ctx);
    const master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.2;
    const dry = ctx.createGain(), wet = ctx.createGain();
    wet.gain.value = style === 'cinematic' || style === 'suspense' ? 0.35 : 0.18;
    const rv = reverb(ctx, style === 'cinematic' ? 3.5 : 2);
    dry.connect(comp); wet.connect(rv).connect(comp);
    let finalIn = comp;
    if (style === 'lofi') { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200; comp.connect(lp); finalIn = lp; }
    finalIn.connect(master).connect(ctx.destination);
    master.gain.setValueAtTime(0, 0); master.gain.linearRampToValueAtTime(0.9, 1.2);
    master.gain.setValueAtTime(0.9, Math.max(1.3, total - 3)); master.gain.linearRampToValueAtTime(0, total + 0.5);
    // bus : batterie sèche, instruments avec réverbération
    const drumBus = ctx.createGain(); drumBus.connect(dry);
    const instBus = ctx.createGain(); instBus.connect(dry); instBus.connect(wet);
    const D = I(ctx, drumBus, noise), N = I(ctx, instBus, noise);

    const root = 45 + Math.floor(R() * 8); // La1 → Mi2
    const prog = S.prog[Math.floor(R() * S.prog.length)];
    const sw = (step) => (step % 2 === 1 ? S.swing * beat * 0.5 : 0);
    if (S.crackle) N.noiseBed(0, total, 1);

    for (let b = 0; b < bars; b++) {
      const t0 = b * bar;
      const deg = prog[b % prog.length];
      const ch = chordNotes(root + 12, S.scale, deg, 4);
      const bassNote = chordNotes(root, S.scale, deg, 1)[0];
      const intro = b < 2, outro = b >= bars - 1;
      const brk = bars > 12 && b % 16 >= 12 && b % 16 < 14;
      const full = !intro && !brk && !outro;

      // Harmonie
      if (S.chords === 'keys') N.keys(t0, ch.slice(0, 4), bar * 0.95, 1);
      else if (S.chords === 'piano') {
        if (style === 'afro') [0, 1.5, 3].forEach((x) => N.piano(t0 + x * beat, ch.slice(0, 3), beat * 1.2, 0.8));
        else [0, 2].forEach((x) => N.piano(t0 + x * beat, ch.slice(0, 3), beat * 2, 0.9));
      } else if (S.chords === 'pluck') [0, 0.75, 1.5, 2.5, 3].forEach((x) => N.pluck(t0 + x * beat, ch.slice(0, 3), beat, 1));
      else if (S.chords === 'pad') N.pad(t0, ch.slice(0, 3), bar, style === 'trap' ? 0.7 : 1, style === 'suspense' ? 700 : 1400);
      if (style === 'cinematic' && b >= 2) N.pad(t0, [ch[0] - 12], bar, 0.8, 600);

      // Basse
      if (!intro || style === 'cinematic' || style === 'suspense') {
        if (S.bass === 'soft') [0, 2.5].forEach((x) => N.bass(t0 + x * beat, bassNote, beat * 1.4, 0.8, 450));
        else if (S.bass === 'octave') for (let i = 0; i < 8; i++) N.bass(t0 + i * beat / 2, bassNote + (i % 2 ? 12 : 0), beat * 0.4, 0.7, 900);
        else if (S.bass === 'drone') N.bass(t0, bassNote, bar, 0.7, 250);
        else if (S.bass === '808' && full) [0, 1.5, 2.75].forEach((x, i) => D.b808(t0 + x * beat, bassNote + (i === 2 && R() > 0.5 ? 12 : 0) - 12 + 12, beat * 1.2, 0.9));
        else if (S.bass === 'log' && !intro) [0, 0.75, 1.5, 2.5, 3.25].forEach((x) => { if (R() > 0.15) D.logdrum(t0 + x * beat, bassNote + (R() > 0.7 ? 7 : 0), 0.9); });
      }

      // Mélodie
      if (S.lead === 'arp' && full) for (let i = 0; i < 8; i++) N.pluck(t0 + i * beat / 2 + sw(i), [ch[i % 3] + 12], beat / 2, 0.6);
      if (S.lead === 'bell' && !intro && b % 2 === 0) for (let i = 0; i < 4; i++) if (R() > 0.35) N.bell(t0 + i * beat, ch[Math.floor(R() * 3)] + 12, 0.8);

      // Batterie
      if (!intro && !outro) {
        for (let s = 0; s < 16; s++) {
          const t = t0 + (s * beat) / 4 + sw(s);
          const dv = brk ? 0.5 : 1;
          switch (S.drums) {
            case 'lofi':
              if (!brk && (s === 0 || s === 7 || s === 10)) D.kick(t, 0.8);
              if (s === 4 || s === 12) D.snare(t, 0.6 * dv, 200);
              if (s % 2 === 0) D.hat(t, 0.5 * dv);
              break;
            case 'four':
              if (!brk && s % 4 === 0) D.kick(t, 1);
              if (s === 4 || s === 12) D.clap(t, dv);
              if (s % 4 === 2) D.hat(t, 0.8 * dv, true); else if (s % 2 === 1) D.hat(t, 0.4 * dv);
              break;
            case 'light':
              if (!brk && (s === 0 || s === 8 || s === 11)) D.kick(t, 0.7);
              if (s === 4 || s === 12) D.rim(t, 0.8 * dv);
              if (s % 2 === 0) D.shaker(t, 0.8 * dv);
              break;
            case 'epic':
              if (s === 0 || (s === 8 && b % 2)) D.tom(t, 38, 1 * dv);
              if (b % 4 === 3 && s >= 12) D.tom(t, 43 - (s - 12) * 2, 0.6);
              if (!brk && s === 0 && b % 2 === 0) D.kick(t, 1);
              break;
            case 'trap':
              if (!brk && (s === 0 || s === 10)) D.kick(t, 1);
              if (s === 8) D.clap(t, dv);
              if (s % 2 === 0 || (b % 2 === 1 && s >= 12)) D.hat(t, 0.45 * dv);
              if (b % 2 === 1 && s >= 13) { D.hat(t + beat / 8, 0.3 * dv); }
              break;
            case 'afro':
              if (!brk && (s === 0 || s === 8)) D.kick(t, 0.9);
              if (s === 6 || s === 14) D.rim(t, 0.6 * dv);
              if (s === 4 || s === 12) D.clap(t, 0.5 * dv);
              D.shaker(t, (s % 4 === 2 ? 1 : 0.5) * dv);
              break;
            default: break;
          }
        }
      }
      if (brk && b % 16 === 13) N.sweep(t0, bar, 1, true);
      if (b === 1 && (style === 'upbeat' || style === 'cinematic' || style === 'trap')) N.sweep(t0, bar, 0.8, true);
    }
    const buf = await ctx.startRendering();
    return { wav: toWav(buf, total + 0.6), bpm, name: S.name, duration: total };
  }

  // ------------------------------------------------------------ Bruitages
  const SFX = {
    whoosh: { name: 'Whoosh', len: 1.0 },
    swoosh: { name: 'Transition', len: 0.6 },
    pop: { name: 'Pop', len: 0.25 },
    ding: { name: 'Ding', len: 1.6 },
    notif: { name: 'Notification', len: 0.8 },
    click: { name: 'Clic', len: 0.1 },
    camera: { name: 'Photo', len: 0.5 },
    boom: { name: 'Impact', len: 2.2 },
    riser: { name: 'Montée', len: 3.0 },
    error: { name: 'Erreur', len: 0.6 },
    success: { name: 'Succès', len: 1.2 },
    typing: { name: 'Clavier', len: 2.0 },
    heartbeat: { name: 'Cœur', len: 2.4 },
    applause: { name: 'Applaudir', len: 3.5 },
    coin: { name: 'Pièce', len: 0.7 },
    laser: { name: 'Laser', len: 0.5 },
  };
  async function generateSfx(type) {
    const def = SFX[type];
    if (!def) throw new Error('Bruitage inconnu');
    const ctx = new OfflineAudioContext(2, Math.ceil((def.len + 0.3) * SR), SR);
    const noise = makeNoise(ctx);
    const out = ctx.createGain();
    out.connect(ctx.destination);
    const X = I(ctx, out, noise);
    const tone = (type_, f0, f1, t, d, a = 0.4) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type_; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + d);
      env(g, t, 0.003, a, d);
      o.connect(g).connect(out); o.start(t); o.stop(t + d + 0.1);
    };
    switch (type) {
      case 'whoosh': X.sweep(0, 0.5, 2.5, true); X.sweep(0.45, 0.5, 2, false); break;
      case 'swoosh': X.sweep(0, 0.5, 2.5, false); break;
      case 'pop': tone('sine', 300, 1200, 0, 0.12, 0.6); break;
      case 'ding': [[1320, 0.35], [2640, 0.1], [3960, 0.05]].forEach(([f, a]) => tone('sine', f, f * 0.999, 0, 1.4, a)); break;
      case 'notif': tone('sine', 880, 880, 0, 0.25, 0.35); tone('sine', 1320, 1320, 0.15, 0.5, 0.35); break;
      case 'click': X.rim(0, 1.5); break;
      case 'camera': X.hat(0, 3); X.snare(0.02, 0.3, 900); X.hat(0.18, 2.5, false); break;
      case 'boom': X.kick(0, 1.6); tone('sine', 60, 30, 0, 1.8, 0.6); X.sweep(0, 1.5, 1.4, false); break;
      case 'riser': X.sweep(0, 2.9, 3, true); tone('sawtooth', 200, 1600, 0, 2.9, 0.06); break;
      case 'error': tone('square', 160, 150, 0, 0.18, 0.18); tone('square', 120, 110, 0.22, 0.3, 0.18); break;
      case 'success': [72, 76, 79, 84].forEach((n, i) => X.bell(i * 0.1, n, 2.2)); break;
      case 'typing': for (let t = 0; t < 1.9; t += 0.08 + Math.random() * 0.12) X.rim(t, 0.6 + Math.random() * 0.6); break;
      case 'heartbeat': [0, 1.0].forEach((t) => { X.kick(t, 0.9); X.kick(t + 0.22, 0.6); }); break;
      case 'applause': for (let t = 0; t < 3.2; t += 0.008 + Math.random() * 0.02) X.clap(t, Math.min(1, t * 2) * (1 - t / 3.4) * (0.15 + Math.random() * 0.3)); break;
      case 'coin': tone('square', 988, 988, 0, 0.08, 0.15); tone('square', 1319, 1319, 0.08, 0.5, 0.15); break;
      case 'laser': tone('sawtooth', 2400, 120, 0, 0.4, 0.2); break;
      default: break;
    }
    const buf = await ctx.startRendering();
    return { wav: toWav(buf, def.len + 0.3), name: def.name };
  }

  // ------------------------------------------------------------ Export WAV 16 bits
  function toWav(buf, secs) {
    const ch = buf.numberOfChannels;
    const len = Math.min(buf.length, Math.ceil(secs * SR));
    const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
    const w = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); data.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true); data.setUint32(24, SR, true);
    data.setUint32(28, SR * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true);
    w(36, 'data'); data.setUint32(40, len * ch * 2, true);
    const chans = [...Array(ch)].map((_, c) => buf.getChannelData(c));
    // normalisation douce
    let peak = 0;
    chans.forEach((d) => { for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i])); });
    const gain = peak > 0 ? Math.min(4, 0.89 / peak) : 1;
    let o = 44;
    for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, chans[c][i] * gain)); data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
    return data.buffer;
  }

  window.VidioMusic = { STYLES, SFX, generateTrack, generateSfx };
})();
