// VidioEdit — processus principal Electron
// Licence MIT — https://github.com/ck526438-lgtm/vidioedit
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

// ---------- FFmpeg ----------
function resolveFfmpeg() {
  try {
    let p = require('ffmpeg-static');
    if (p) {
      p = p.replace('app.asar', 'app.asar.unpacked');
      if (fs.existsSync(p)) return p;
    }
  } catch (_) { /* ignore */ }
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}
const FFMPEG = resolveFfmpeg();

const VIDEO_EXT = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'wmv', 'flv', '3gp', 'mpg', 'mpeg', 'ts'];
const AUDIO_EXT = ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac', 'opus', 'wma'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];

let mainWindow = null;
let pendingOpenFile = process.argv.find((a) => a.toLowerCase().endsWith('.vedit')) || null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#101217',
    title: 'VidioEdit',
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const f = argv.find((a) => a.toLowerCase().endsWith('.vedit'));
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (f) mainWindow.webContents.send('project:open-path', f);
    }
  });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}

// ---------- Utilitaires ----------
function runFfmpeg(args, { collectStdout = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args, { windowsHide: true });
    const out = [];
    let err = '';
    p.stdout.on('data', (d) => { if (collectStdout) out.push(d); });
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) => resolve({ code, stdout: Buffer.concat(out), stderr: err }));
  });
}

function mediaTypeFromExt(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (VIDEO_EXT.includes(ext)) return 'video';
  return null;
}

async function probe(file) {
  const type = mediaTypeFromExt(file);
  const info = {
    path: file,
    url: pathToFileURL(file).href,
    name: path.basename(file),
    type,
    duration: type === 'image' ? 5 : 0,
    width: 0,
    height: 0,
    hasAudio: false,
  };
  try {
    const { stderr } = await runFfmpeg(['-hide_banner', '-i', file]);
    const d = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (d && type !== 'image') info.duration = (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]);
    info.hasAudio = /Stream #.*Audio:/.test(stderr);
    const v = stderr.match(/Stream #.*Video:.*?(\d{2,5})x(\d{2,5})/);
    if (v) { info.width = +v[1]; info.height = +v[2]; }
    const rot = stderr.match(/rotation of (-?[\d.]+) degrees/) || stderr.match(/rotate\s*:\s*(-?\d+)/);
    if (rot && Math.abs(Math.round(parseFloat(rot[1]))) % 180 === 90) { const w = info.width; info.width = info.height; info.height = w; }
    if (!info.type) info.type = v && !/attached pic/.test(stderr) ? 'video' : (info.hasAudio ? 'audio' : null);
  } catch (e) {
    info.error = String(e.message || e);
  }
  return info;
}

// ---------- IPC : médias ----------
ipcMain.handle('media:pick', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Importer des médias',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Médias', extensions: [...VIDEO_EXT, ...AUDIO_EXT, ...IMAGE_EXT] },
      { name: 'Vidéos', extensions: VIDEO_EXT },
      { name: 'Audio', extensions: AUDIO_EXT },
      { name: 'Images', extensions: IMAGE_EXT },
    ],
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('media:probe', (_e, file) => probe(file));

ipcMain.handle('media:waveform', async (_e, file) => {
  // 50 valeurs par seconde, mono — suffisant pour dessiner une forme d'onde
  const { stdout } = await runFfmpeg(
    ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '2000', '-f', 's16le', '-'],
    { collectStdout: true }
  );
  const samples = new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 2));
  const block = 40; // 2000 / 40 = 50 pics par seconde
  const peaks = [];
  for (let i = 0; i < samples.length; i += block) {
    let m = 0;
    for (let j = i; j < i + block && j < samples.length; j++) {
      const a = Math.abs(samples[j]);
      if (a > m) m = a;
    }
    peaks.push(Math.round((m / 32768) * 100) / 100);
  }
  return peaks;
});

// ---------- IPC : projets ----------
ipcMain.handle('project:save', async (_e, { data, filePath, saveAs }) => {
  let target = filePath;
  if (!target || saveAs) {
    const r = await dialog.showSaveDialog(mainWindow, {
      title: 'Enregistrer le projet',
      defaultPath: target || 'Mon projet.vedit',
      filters: [{ name: 'Projet VidioEdit', extensions: ['vedit'] }],
    });
    if (r.canceled) return null;
    target = r.filePath;
  }
  fs.writeFileSync(target, JSON.stringify(data, null, 2), 'utf8');
  return target;
});

ipcMain.handle('project:open', async (_e, givenPath) => {
  let target = givenPath;
  if (!target) {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Ouvrir un projet',
      properties: ['openFile'],
      filters: [{ name: 'Projet VidioEdit', extensions: ['vedit'] }],
    });
    if (r.canceled) return null;
    target = r.filePaths[0];
  }
  return { filePath: target, data: JSON.parse(fs.readFileSync(target, 'utf8')) };
});

ipcMain.handle('project:pending', () => {
  const f = pendingOpenFile;
  pendingOpenFile = null;
  return f;
});

ipcMain.handle('file:exists', (_e, f) => fs.existsSync(f));
ipcMain.handle('file:url', (_e, f) => pathToFileURL(f).href);

ipcMain.handle('shell:show', (_e, f) => shell.showItemInFolder(f));
ipcMain.handle('shell:open', (_e, url) => shell.openExternal(url));
ipcMain.handle('app:info', () => ({ version: app.getVersion(), ffmpeg: FFMPEG }));

// ---------- IPC : export ----------
let job = null;

function atempoChain(speed) {
  // atempo accepte 0.5–2.0 : on enchaîne pour les autres valeurs
  const parts = [];
  let s = speed;
  while (s > 2.0) { parts.push('atempo=2.0'); s /= 2.0; }
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-3) parts.push(`atempo=${s.toFixed(4)}`);
  return parts;
}

function buildAudioGraph(audio, firstIndex, total) {
  const inputs = [];
  const filters = [];
  const labels = [];
  audio.forEach((a, i) => {
    const idx = firstIndex + i;
    const srcLen = a.dur * a.speed;
    inputs.push('-ss', a.in.toFixed(3), '-t', srcLen.toFixed(3), '-i', a.path);
    const chain = [`aresample=48000`, 'aformat=channel_layouts=stereo', ...atempoChain(a.speed)];
    if (a.denoise) chain.push('highpass=f=80', 'afftdn=nf=-25');
    chain.push(`volume=${a.volume.toFixed(3)}`);
    if (a.fadeIn > 0) chain.push(`afade=t=in:st=0:d=${a.fadeIn.toFixed(3)}`);
    if (a.fadeOut > 0) chain.push(`afade=t=out:st=${Math.max(0, a.dur - a.fadeOut).toFixed(3)}:d=${a.fadeOut.toFixed(3)}`);
    const ms = Math.max(0, Math.round(a.start * 1000));
    chain.push(`adelay=${ms}|${ms}`);
    filters.push(`[${idx}:a]${chain.join(',')}[a${i}]`);
    labels.push(`[a${i}]`);
  });
  if (!labels.length) return null;
  filters.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,apad,atrim=0:${total.toFixed(3)}[aout]`);
  return { inputs, filter: filters.join(';') };
}

ipcMain.handle('export:pick', async (_e, defName) => {
  const r = await dialog.showSaveDialog(mainWindow, {
    title: 'Exporter la vidéo',
    defaultPath: defName || 'VidioEdit.mp4',
    filters: [{ name: 'Vidéo MP4', extensions: ['mp4'] }],
  });
  return r.canceled ? null : r.filePath;
});

ipcMain.handle('export:start', async (_e, opts) => {
  if (job) throw new Error('Un export est déjà en cours.');
  const { outPath, width, height, fps, duration, audio, quality, hw } = opts;
  const crf = { high: 18, medium: 23, low: 28 }[quality] || 20;
  const encoders = hw ? await detectHwEncoders() : [];
  const enc = encoders[0] || 'libx264';
  const args = ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', String(fps), '-i', 'pipe:0'];
  const graph = buildAudioGraph(audio || [], 1, duration);
  if (graph) args.push(...graph.inputs, '-filter_complex', graph.filter, '-map', '0:v', '-map', '[aout]');
  args.push(...encoderArgs(enc, crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
  if (graph) args.push('-c:a', 'aac', '-b:a', '192k');
  args.push('-t', duration.toFixed(3), outPath);

  const proc = spawn(FFMPEG, args, { windowsHide: true });
  job = { proc, outPath, err: '', closed: false, code: null, encoder: enc };
  proc.stderr.on('data', (d) => { job && (job.err += d.toString()); });
  proc.on('error', (e) => { if (job) { job.err += String(e.message); job.closed = true; } });
  job.done = new Promise((res) => proc.on('close', (code) => {
    if (job) { job.closed = true; job.code = code; }
    res(code);
  }));
  proc.stdin.on('error', () => { /* géré via le code de sortie */ });
  return { encoder: enc };
});

ipcMain.handle('export:frame', async (_e, buf) => {
  if (!job || job.closed) throw new Error(job ? `FFmpeg s'est arrêté : ${job.err}` : 'Aucun export en cours.');
  const ok = job.proc.stdin.write(Buffer.from(buf));
  if (!ok) await new Promise((r) => job.proc.stdin.once('drain', r));
  return true;
});

ipcMain.handle('export:finish', async () => {
  if (!job) return { ok: false, error: 'Aucun export en cours.' };
  const j = job;
  j.proc.stdin.end();
  const code = await j.done;
  job = null;
  return code === 0 ? { ok: true, outPath: j.outPath } : { ok: false, error: j.err || `Code ${code}` };
});

ipcMain.handle('export:cancel', async () => {
  if (!job) return true;
  const j = job;
  job = null;
  try { j.proc.stdin.destroy(); } catch (_) { /* */ }
  try { j.proc.kill('SIGKILL'); } catch (_) { /* */ }
  await j.done.catch(() => {});
  try { fs.unlinkSync(j.outPath); } catch (_) { /* */ }
  return true;
});

// =====================================================================
// Assistant IA : analyse (silences, scènes) + connexion aux modèles
// =====================================================================
const { safeStorage } = require('electron');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function readSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    if (s.apiKeyEnc && safeStorage.isEncryptionAvailable()) {
      s.apiKey = safeStorage.decryptString(Buffer.from(s.apiKeyEnc, 'base64'));
    }
    delete s.apiKeyEnc;
    return s;
  } catch (_) {
    return {};
  }
}
function writeSettings(s) {
  const out = Object.assign({}, s);
  if (out.apiKey && safeStorage.isEncryptionAvailable()) {
    out.apiKeyEnc = safeStorage.encryptString(out.apiKey).toString('base64');
    delete out.apiKey;
  }
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(out, null, 2), 'utf8');
}
ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:set', (_e, s) => { writeSettings(Object.assign(readSettings(), s)); return true; });

// Détection des silences dans un segment [start, start+len] du fichier source
ipcMain.handle('ai:silences', async (_e, { file, start, len, noiseDb = -35, minDur = 0.5 }) => {
  const { stderr } = await runFfmpeg(['-hide_banner', '-nostats', '-ss', String(start), '-t', String(len), '-i', file,
    '-vn', '-af', `silencedetect=noise=${noiseDb}dB:d=${minDur}`, '-f', 'null', '-']);
  const out = [];
  let cur = null;
  stderr.split('\n').forEach((line) => {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    const e = line.match(/silence_end:\s*(-?[\d.]+)/);
    if (s) cur = Math.max(0, parseFloat(s[1]));
    if (e && cur != null) { out.push([cur, parseFloat(e[1])]); cur = null; }
  });
  if (cur != null) out.push([cur, len]);
  return out; // temps relatifs au début du segment
});

// Détection des changements de plan
ipcMain.handle('ai:scenes', async (_e, { file, start, len, threshold = 0.35 }) => {
  const { stderr } = await runFfmpeg(['-hide_banner', '-nostats', '-ss', String(start), '-t', String(len), '-i', file,
    '-an', '-vf', `scale=320:-2,select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-']);
  const times = [];
  stderr.split('\n').forEach((line) => {
    const m = line.match(/showinfo.*pts_time:\s*([\d.]+)/);
    if (m) times.push(parseFloat(m[1]));
  });
  return times;
});

// Appel d'un modèle de langage (Ollama local, API compatible OpenAI, Anthropic)
ipcMain.handle('ai:chat', async (_e, { system, messages }) => {
  const s = readSettings();
  const provider = s.provider || 'local';
  const model = s.model || '';
  const timeout = AbortSignal.timeout(120000);
  if (provider === 'ollama') {
    const base = (s.endpoint || 'http://localhost:11434').replace(/\/$/, '');
    const r = await fetch(`${base}/api/chat`, {
      method: 'POST', signal: timeout, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model || 'llama3.1', stream: false, format: 'json', messages: [{ role: 'system', content: system }, ...messages] }),
    });
    if (!r.ok) throw new Error(`Ollama : ${r.status} ${await r.text()}`);
    const j = await r.json();
    return j.message && j.message.content;
  }
  if (provider === 'openai') {
    const base = (s.endpoint || 'https://api.openai.com/v1').replace(/\/$/, '');
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST', signal: timeout,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey || ''}` },
      body: JSON.stringify({ model: model || 'gpt-4o-mini', temperature: 0.2, messages: [{ role: 'system', content: system }, ...messages] }),
    });
    if (!r.ok) throw new Error(`API : ${r.status} ${await r.text()}`);
    const j = await r.json();
    return j.choices && j.choices[0] && j.choices[0].message.content;
  }
  if (provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: timeout,
      headers: { 'Content-Type': 'application/json', 'x-api-key': s.apiKey || '', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: model || 'claude-sonnet-5-5', max_tokens: 2048, system, messages }),
    });
    if (!r.ok) throw new Error(`Anthropic : ${r.status} ${await r.text()}`);
    const j = await r.json();
    return (j.content || []).map((c) => c.text || '').join('');
  }
  throw new Error('Aucun modèle IA configuré');
});

// =====================================================================
// v1.1 — Encodeurs matériels, décodage rapide, Whisper, inversion, gel
// =====================================================================
const os = require('os');
const crypto = require('crypto');
const cacheDir = () => { const d = path.join(app.getPath('userData'), 'cache'); fs.mkdirSync(d, { recursive: true }); return d; };

let hwEncoders = null;
async function detectHwEncoders() {
  if (hwEncoders) return hwEncoders;
  hwEncoders = [];
  for (const e of ['h264_nvenc', 'h264_qsv', 'h264_amf']) {
    try {
      const { code } = await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=320x240:d=0.2', '-c:v', e, '-f', 'null', '-']);
      if (code === 0) hwEncoders.push(e);
    } catch (_) { /* indisponible */ }
  }
  return hwEncoders;
}
function encoderArgs(enc, crf) {
  switch (enc) {
    case 'h264_nvenc': return ['-c:v', enc, '-preset', 'p5', '-rc', 'vbr', '-cq', String(crf), '-b:v', '0'];
    case 'h264_qsv': return ['-c:v', enc, '-global_quality', String(crf), '-preset', 'medium'];
    case 'h264_amf': return ['-c:v', enc, '-rc', 'cqp', '-qp_i', String(crf), '-qp_p', String(crf), '-quality', 'balanced'];
    default: return ['-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf)];
  }
}
ipcMain.handle('export:hw', () => detectHwEncoders());

// ---------- Décodage d'images par FFmpeg (export rapide et compatible HEVC, ProRes…)
class FrameReader {
  constructor({ path: file, from, speed, fps, w, h }) {
    this.size = w * h * 4;
    this.frames = [];
    this.waiters = [];
    this.pending = null;
    this.pos = -1;
    this.last = null;
    this.ended = false;
    this.err = '';
    const vf = `setpts=(PTS-STARTPTS)/${speed},fps=${fps},scale=${w}:${h}:flags=bicubic`;
    this.proc = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-ss', from.toFixed(3), '-i', file, '-an', '-sn',
      '-vf', vf, '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1'], { windowsHide: true });
    this.proc.stdout.on('data', (chunk) => this.onData(chunk));
    this.proc.stderr.on('data', (d) => { this.err += d.toString(); });
    const end = () => { this.ended = true; this.wake(); };
    this.proc.on('close', end);
    this.proc.on('error', end);
  }
  wake() { const w = this.waiters; this.waiters = []; w.forEach((r) => r()); }
  onData(chunk) {
    let buf = this.pending ? Buffer.concat([this.pending, chunk]) : chunk;
    while (buf.length >= this.size) {
      this.frames.push(Buffer.from(buf.subarray(0, this.size)));
      buf = buf.subarray(this.size);
    }
    this.pending = buf.length ? Buffer.from(buf) : null;
    if (this.frames.length > 4) this.proc.stdout.pause();
    this.wake();
  }
  async next() {
    while (!this.frames.length) {
      if (this.ended) return null;
      await new Promise((r) => this.waiters.push(r));
    }
    const f = this.frames.shift();
    if (this.frames.length < 3) this.proc.stdout.resume();
    return f;
  }
  async get(index) {
    while (this.pos < index) {
      const f = await this.next();
      if (!f) break;
      this.last = f;
      this.pos++;
    }
    return this.last;
  }
  close() { try { this.proc.kill('SIGKILL'); } catch (_) { /* */ } }
}
const readers = new Map();
ipcMain.handle('decode:open', (_e, o) => {
  if (readers.has(o.key)) readers.get(o.key).close();
  readers.set(o.key, new FrameReader(o));
  return true;
});
ipcMain.handle('decode:frame', async (_e, { key, index }) => {
  const r = readers.get(key);
  if (!r) return null;
  const f = await r.get(index);
  if (!f && r.err) throw new Error(r.err.slice(0, 400));
  return f;
});
ipcMain.handle('decode:closeAll', () => { for (const r of readers.values()) r.close(); readers.clear(); return true; });

// ---------- Inverser / figer
ipcMain.handle('media:reverse', async (_e, { file, start, len, hasAudio }) => {
  const id = crypto.createHash('md5').update(`${file}|${start}|${len}`).digest('hex').slice(0, 10);
  const out = path.join(cacheDir(), `inverse_${id}.mp4`);
  if (!fs.existsSync(out)) {
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(start), '-t', String(len), '-i', file, '-vf', 'reverse'];
    if (hasAudio) args.push('-af', 'areverse', '-c:a', 'aac', '-b:a', '192k'); else args.push('-an');
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', out);
    const r = await runFfmpeg(args);
    if (r.code !== 0) throw new Error(r.stderr.slice(-400));
  }
  return probe(out);
});
ipcMain.handle('media:frame', async (_e, { file, time }) => {
  const out = path.join(cacheDir(), `image_${Date.now()}.png`);
  const r = await runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', out]);
  if (r.code !== 0 || !fs.existsSync(out)) throw new Error(r.stderr.slice(-400) || 'Capture impossible');
  return probe(out);
});

// ---------- Sous-titres automatiques (Whisper)
const MODELS = {
  tiny: { file: 'ggml-tiny.bin', label: 'Très rapide (75 Mo)' },
  base: { file: 'ggml-base.bin', label: 'Rapide (142 Mo)' },
  small: { file: 'ggml-small.bin', label: 'Précis (466 Mo)' },
  medium: { file: 'ggml-medium.bin', label: 'Très précis (1,5 Go)' },
};
const modelsDir = () => { const d = path.join(app.getPath('userData'), 'models'); fs.mkdirSync(d, { recursive: true }); return d; };
function modelPath(size) {
  if (process.env.VIDIOEDIT_WHISPER_MODEL) return process.env.VIDIOEDIT_WHISPER_MODEL;
  return path.join(modelsDir(), (MODELS[size] || MODELS.base).file);
}
function whisperBin() {
  const exe = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  const cands = [process.env.VIDIOEDIT_WHISPER, path.join(process.resourcesPath || '', 'whisper', exe), path.join(__dirname, 'vendor', 'whisper', exe)];
  return cands.find((c) => c && fs.existsSync(c)) || null;
}
const sendProgress = (o) => { if (mainWindow) mainWindow.webContents.send('captions:progress', o); };

ipcMain.handle('captions:status', () => {
  const models = {};
  Object.keys(MODELS).forEach((k) => { models[k] = { label: MODELS[k].label, installed: fs.existsSync(modelPath(k)) }; });
  return { binary: !!whisperBin(), models };
});

ipcMain.handle('captions:download', async (_e, size) => {
  const m = MODELS[size] || MODELS.base;
  const dest = modelPath(size);
  if (fs.existsSync(dest)) return true;
  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${m.file}`;
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`Téléchargement impossible (${r.status})`);
  const total = +r.headers.get('content-length') || 0;
  const tmp = `${dest}.part`;
  const out = fs.createWriteStream(tmp);
  let got = 0, lastPct = -1;
  for await (const chunk of r.body) {
    got += chunk.length;
    if (!out.write(chunk)) await new Promise((res) => out.once('drain', res));
    const pct = total ? Math.floor((got / total) * 100) : 0;
    if (pct !== lastPct) { lastPct = pct; sendProgress({ phase: 'download', pct }); }
  }
  await new Promise((res) => out.end(res));
  fs.renameSync(tmp, dest);
  return true;
});

async function extractWav(file, start, len) {
  const out = path.join(os.tmpdir(), `vidioedit_${process.pid}_${Date.now()}.wav`);
  const r = await runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(start), '-t', String(len), '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out]);
  if (r.code !== 0) throw new Error(r.stderr.slice(-300));
  return out;
}
const cleanWord = (w) => String(w || '').replace(/\s+/g, ' ').trim();
const isNoise = (w) => !w || /^\[.*\]$|^\(.*\)$/.test(w) || /^[♪♫\s]+$/.test(w);

function runWhisper(bin, model, wav, lang, idx, count) {
  return new Promise((resolve, reject) => {
    const base = wav.replace(/\.wav$/, '');
    const threads = String(Math.max(2, Math.min(8, os.cpus().length - 1)));
    const p = spawn(bin, ['-m', model, '-f', wav, '-l', lang || 'auto', '-ml', '1', '-sow', '-oj', '-of', base, '-t', threads, '-pp'], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => {
      const s = d.toString();
      err += s;
      const m = s.match(/progress\s*=\s*(\d+)%/);
      if (m) sendProgress({ phase: 'transcribe', pct: Math.round(((idx + +m[1] / 100) / count) * 100) });
    });
    p.on('error', reject);
    p.on('close', (code) => {
      try {
        if (code !== 0) throw new Error(err.slice(-400));
        const j = JSON.parse(fs.readFileSync(`${base}.json`, 'utf8'));
        fs.unlinkSync(`${base}.json`);
        const words = (j.transcription || []).map((x) => ({ w: cleanWord(x.text), t0: x.offsets.from / 1000, t1: x.offsets.to / 1000 })).filter((x) => !isNoise(x.w));
        resolve(words);
      } catch (e) { reject(e); }
    });
  });
}

async function transcribeApi(wav, lang) {
  const s = readSettings();
  const base = (s.endpoint || 'https://api.openai.com/v1').replace(/\/$/, '');
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(wav)], { type: 'audio/wav' }), 'audio.wav');
  fd.append('model', s.sttModel || 'whisper-1');
  fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'word');
  if (lang && lang !== 'auto') fd.append('language', lang);
  const r = await fetch(`${base}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${s.apiKey || ''}` }, body: fd });
  if (!r.ok) throw new Error(`API : ${r.status} ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  if (Array.isArray(j.words) && j.words.length) return j.words.map((w) => ({ w: cleanWord(w.word), t0: w.start, t1: w.end })).filter((x) => !isNoise(x.w));
  // repli : segments découpés en mots répartis uniformément
  const out = [];
  (j.segments || []).forEach((sg) => {
    const ws = cleanWord(sg.text).split(' ').filter(Boolean);
    const d = (sg.end - sg.start) / Math.max(1, ws.length);
    ws.forEach((w, i) => out.push({ w, t0: sg.start + i * d, t1: sg.start + (i + 1) * d }));
  });
  return out;
}

ipcMain.handle('captions:transcribe', async (_e, { items, lang, model, engine }) => {
  const results = [];
  const bin = whisperBin();
  if (engine !== 'api') {
    if (!bin) throw new Error('Moteur Whisper introuvable dans cette installation.');
    if (!fs.existsSync(modelPath(model))) throw new Error('MODEL_MISSING');
  }
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    sendProgress({ phase: 'transcribe', pct: Math.round((i / items.length) * 100) });
    const wav = await extractWav(it.path, it.start, it.len);
    try {
      const words = engine === 'api' ? await transcribeApi(wav, lang) : await runWhisper(bin, modelPath(model), wav, lang, i, items.length);
      results.push({ key: it.key, words });
    } finally {
      try { fs.unlinkSync(wav); } catch (_) { /* */ }
    }
  }
  sendProgress({ phase: 'transcribe', pct: 100 });
  return results;
});
