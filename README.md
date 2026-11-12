<p align="center">
  <img src="assets/logo.png" alt="VidioEdit" width="520">
</p>

<p align="center">
  <b>Éditeur vidéo gratuit et open source pour Windows, inspiré de CapCut — avec un assistant IA de montage automatique.</b><br>
  <a href="https://github.com/ck526438-lgtm/vidioedit/releases/latest"><b>⬇ Télécharger pour Windows</b></a>
</p>

---

![Capture de VidioEdit](docs/capture.png)

## ✨ Fonctionnalités

**Montage**
- Timeline multipiste : vidéo principale, superpositions, textes, sous-titres, pistes audio illimitées
- Glisser-déposer depuis l'Explorateur, miniatures et formes d'onde
- Couper (`S`), supprimer, dupliquer, rogner, déplacer entre pistes, piste principale magnétique
- **Images clés (◆)** sur la position, l'échelle, la rotation et l'opacité, avec courbe adoucie ou linéaire
- **Recadrage**, miroir, ajuster / remplir le cadre, **fond flou** automatique pour le format vertical
- **Figer l'image**, **lecture à l'envers**, vitesse de 0,25× à 4×
- Annuler / rétablir illimité, zoom de la timeline (`Ctrl` + molette)

**Transitions & effets**
- **19 transitions** entre clips : fondu, fondu noir/blanc, flash, balayages, pousser, zoom, flou, cercle, portes, tourbillon, glitch
- **10 effets vidéo** : Ken Burns, pulsation, secousse, glitch, RVB décalé, VHS, stroboscope, kaléidoscope, pixels, grain film
- 12 filtres + réglages (luminosité, contraste, saturation, teinte, flou, sépia, vignette)
- Animations d'entrée/sortie (zoom, glissement, rotation, rebond, machine à écrire…)

**Texte, sous-titres & autocollants**
- **Sous-titres automatiques** avec Whisper (sur votre PC, gratuit, hors-ligne) : 5 styles animés (karaoké, surligné, pop, mot à mot, sobre), 15 langues dont le français
- 10 styles de texte, retour à la ligne automatique
- 40 autocollants emoji animés

**IA visuelle**
- **Suppression de l'arrière-plan** des personnes, sans fond vert (MediaPipe, hors-ligne)
- **Recadrage automatique** : suit la personne et pose les images clés (idéal pour passer du 16:9 au 9:16)
- **Incrustation fond vert / bleu** (chroma key) avec pipette, tolérance, douceur et anti-reflet

**Couleur & composition**
- **Courbes** RVB / rouge / vert / bleu avec éditeur graphique et préréglages (contraste S, ciné, chaud, froid…)
- **LUT 3D** (.cube) avec intensité réglable
- **Masques** : rectangle, ellipse, linéaire, bande, cœur, étoile — contour doux, inversion
- **16 modes de fusion** (écran, produit, incrustation, lumière douce…)

**Audio & voix**
- **Bibliothèque musicale générée** : 8 styles (lo-fi, pop, vlog, cinématique, trap, **afrobeat/amapiano**, entreprise, suspense), chaque morceau est unique et **100 % libre de droits**
- **16 bruitages** : whoosh, pop, ding, impact, montée, applaudissements, clavier…
- **Synthèse vocale** (voix Windows hors-ligne ou API) et « Lire ce texte à voix haute »
- **9 effets de voix** : grave, aiguë, monstre, robot, écho, grotte, radio, téléphone, chuchotement
- **Baisse automatique de la musique** quand quelqu'un parle (ducking)
- Volume jusqu'à 200 %, fondus, détacher l'audio, **réduction du bruit de fond**
- Liens vers des bibliothèques gratuites (Pixabay Music, Free Music Archive, Mixkit, Freesound)

**Formats** — 16:9 (YouTube), 9:16 (TikTok / Reels / Shorts), 1:1, 4:5, 4:3, 21:9

**Export rapide** — MP4 H.264 + AAC jusqu'en 4K / 60 ips, décodage FFmpeg et **accélération matérielle** NVIDIA NVENC, Intel Quick Sync ou AMD AMF détectée automatiquement

**Projets** — fichiers `.vedit` (s'ouvrent par double-clic)

## 🤖 Assistant IA

Onglet **✨ IA** : décrivez le montage, l'assistant l'applique (et tout s'annule en un clic).

| Exemple de demande | Effet |
|---|---|
| « Montage automatique » | Supprime les silences, ferme les trous, ajoute transitions, effets et titre |
| « Sous-titres automatiques en français » | Transcrit la parole et crée des sous-titres animés |
| « Supprime les silences » | Analyse l'audio et retire les blancs |
| « Coupe aux changements de plan » | Détecte les scènes et découpe |
| « Transitions glitch partout » | Transition sur chaque coupe |
| « Effet secousse sur le clip 2 » | Effet vidéo sur un clip |
| « Zoom progressif sur le clip 1 » | Images clés automatiques |
| « Format TikTok et fond flou » | Passe en 9:16 et remplit les bandes noires |
| « Enlève le bruit de fond » | Réduction du bruit à l'export |
| « Ajoute un sticker 🔥 » | Autocollant animé au curseur |
| « Supprime l'arrière-plan du clip 1 » | Détourage IA de la personne |
| « Format TikTok puis recadrage auto » | 9:16 qui suit la personne |
| « Ajoute une musique afro de 30 s » | Musique libre de droits générée |
| « Voix off "Bienvenue sur ma chaîne" » | Synthèse vocale au curseur |
| « Voix de robot sur le clip 2 » | Effet de voix |
| « Baisse la musique quand on parle » | Ducking à l'export |
| « Masque cœur », « courbes chaudes » | Masque et étalonnage |

Moteurs disponibles (⚙ dans l'onglet IA) :
- **Local** — par défaut, hors-ligne, gratuit : comprend les commandes en français ci-dessus
- **Ollama** — IA locale gratuite sur votre PC ([ollama.com](https://ollama.com)), pour des demandes libres
- **Compatible OpenAI** — OpenAI, Groq, OpenRouter, Mistral, Gemini, LM Studio…
- **Anthropic Claude**

Les clés API sont chiffrées sur votre ordinateur (Windows DPAPI).

### Sous-titres : modèles Whisper

Au premier usage, VidioEdit télécharge le modèle choisi depuis Hugging Face : Très rapide (75 Mo), Rapide (142 Mo), Précis (466 Mo, recommandé pour le français) ou Très précis (1,5 Go). Ensuite tout fonctionne hors-ligne. Le moteur « API » utilise à la place le service configuré dans l'onglet IA (ex. Groq `whisper-large-v3-turbo`, OpenAI `whisper-1`).

## ⬇ Installation

Téléchargez dans [Releases](https://github.com/ck526438-lgtm/vidioedit/releases/latest) :
- `VidioEdit-Setup-x.y.z.exe` — installateur (raccourcis bureau et menu Démarrer)
- `VidioEdit-Portable-x.y.z.exe` — version portable, sans installation

> L'application n'est pas signée : si Windows SmartScreen s'affiche, cliquez sur **Informations complémentaires → Exécuter quand même**.

## ⌨ Raccourcis

| Touche | Action |
|---|---|
| `Espace` | Lecture / pause |
| `S` | Couper au curseur |
| `Suppr` | Supprimer le clip |
| `Ctrl+D` | Dupliquer |
| `Ctrl+Z` / `Ctrl+Y` | Annuler / rétablir |
| `←` `→` | Image précédente / suivante (`Maj` : 1 s) |
| `Ctrl+S` / `Ctrl+O` | Enregistrer / ouvrir |
| `Ctrl+I` | Importer |
| `Ctrl+E` | Exporter |

## 🛠 Développement

```bash
git clone https://github.com/ck526438-lgtm/vidioedit.git
cd vidioedit
npm install
npm start          # lancer l'application
npm run dist       # créer l'installateur Windows dans dist/
```

Pour les sous-titres en développement, placez `whisper-cli(.exe)` de [whisper.cpp](https://github.com/ggml-org/whisper.cpp) dans `vendor/whisper/` (la CI le compile automatiquement pour Windows).

Architecture :
- `main.js` — processus principal Electron : fichiers, FFmpeg (analyse, décodage, export, silences, scènes, inversion), Whisper, appels IA
- `src/render.js` — moteur de composition partagé entre l'aperçu et l'export (transitions, images clés, effets, sous-titres) : ce que vous voyez = ce que vous exportez
- `src/app.js` — interface : timeline, inspecteur, lecture, export
- `src/ai.js` — assistant IA : compréhension des commandes et exécution des actions
- `src/segment.js` — détourage IA (MediaPipe) et recadrage automatique
- `src/music.js` — synthétiseur de musiques et bruitages libres de droits
- `src/presets.js` — filtres, styles de texte, animations, formats

Publier une nouvelle version : changez `version` dans `package.json` et poussez sur `main` — GitHub Actions compile et publie les `.exe` dans une release `v<version>` automatiquement.

## 🗺 Feuille de route

- Suppression d'arrière-plan pour les objets (pas seulement les personnes)
- Voix neuronales hors-ligne (Piper) et clonage de voix
- Modèles de montage prêts à l'emploi, détection du rythme pour couper au tempo
- Export GIF / WebM, publication directe TikTok / YouTube
- Version macOS / Linux

Les contributions sont les bienvenues : ouvrez une *issue* ou une *pull request*.

## 📄 Licence

[MIT](LICENSE) — libre et gratuit, y compris pour un usage commercial.
VidioEdit utilise [Electron](https://www.electronjs.org/), [FFmpeg](https://ffmpeg.org/) (via `ffmpeg-static`, licence GPL), [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (MIT) et [MediaPipe Selfie Segmentation](https://github.com/google-ai-edge/mediapipe) (Apache 2.0).
Les musiques et bruitages générés par VidioEdit vous appartiennent et sont utilisables sans attribution, y compris commercialement.
