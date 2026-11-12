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
    const chain = [`aresample=48000`, 'aformat=channel_layouts=stereo', ...atempoChain(a.speed), `volume=${a.volume.toFixed(3)}`];
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
  const { outPath, width, height, fps, duration, audio, quality } = opts;
  const crf = { high: 18, medium: 23, low: 28 }[quality] || 20;
  const args = ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', String(fps), '-i', 'pipe:0'];
  const graph = buildAudioGraph(audio || [], 1, duration);
  if (graph) args.push(...graph.inputs, '-filter_complex', graph.filter, '-map', '0:v', '-map', '[aout]');
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
  if (graph) args.push('-c:a', 'aac', '-b:a', '192k');
  args.push('-t', duration.toFixed(3), outPath);

  const proc = spawn(FFMPEG, args, { windowsHide: true });
  job = { proc, outPath, err: '', closed: false, code: null };
  proc.stderr.on('data', (d) => { job && (job.err += d.toString()); });
  proc.on('error', (e) => { if (job) { job.err += String(e.message); job.closed = true; } });
  job.done = new Promise((res) => proc.on('close', (code) => {
    if (job) { job.closed = true; job.code = code; }
    res(code);
  }));
  proc.stdin.on('error', () => { /* géré via le code de sortie */ });
  return true;
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
