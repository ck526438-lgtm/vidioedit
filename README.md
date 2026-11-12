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
- Timeline multipiste : vidéo principale, superpositions, textes, pistes audio illimitées
- Glisser-déposer des fichiers depuis l'Explorateur, miniatures et formes d'onde
- Couper (`S`), supprimer, dupliquer, rogner par les bords, déplacer entre pistes
- Piste principale magnétique, aimantation au curseur et aux clips
- Annuler / rétablir illimité, zoom de la timeline (`Ctrl` + molette)

**Effets**
- 12 filtres (Vif, Noir & blanc, Vintage, Cinéma, Chaud, Froid…)
- Réglages : luminosité, contraste, saturation, teinte, flou, sépia, vignette
- Animations d'entrée/sortie (fondu, zoom, glissement, rotation, rebond, machine à écrire…)
- Fondus enchaînés, opacité, position, échelle, rotation, miroir — directement à la souris sur l'aperçu
- Vitesse de 0,25× à 4×, volume jusqu'à 200 %, détacher l'audio d'une vidéo

**Texte** — 10 styles prêts à l'emploi, polices, contour, fond, ombre, alignement

**Formats** — 16:9 (YouTube), 9:16 (TikTok / Reels / Shorts), 1:1, 4:5, 4:3, 21:9

**Export** — MP4 H.264 + AAC, de 720p à 4K, 24 à 60 images/s

**Projets** — fichiers `.vedit` (s'ouvrent par double-clic)

## 🤖 Assistant IA

Onglet **✨ IA** : décrivez le montage, l'assistant l'applique (et tout s'annule en un clic).

| Exemple de demande | Effet |
|---|---|
| « Montage automatique » | Supprime les silences, ferme les trous, ajoute fondus et titre |
| « Supprime les silences » | Analyse l'audio et retire les blancs |
| « Coupe aux changements de plan » | Détecte les scènes et découpe |
| « Filtre cinéma partout » | Applique le filtre à tous les clips |
| « Accélère le clip 2 x2 » | Change la vitesse |
| « Ajoute le titre « Mon voyage » en haut » | Ajoute un texte animé |
| « Format TikTok et remplir l'écran » | Passe en 9:16 sans bandes noires |

Moteurs disponibles (⚙ dans l'onglet IA) :
- **Local** — par défaut, hors-ligne, gratuit : comprend les commandes en français ci-dessus
- **Ollama** — IA locale gratuite sur votre PC ([ollama.com](https://ollama.com)), pour des demandes libres
- **Compatible OpenAI** — OpenAI, Groq, OpenRouter, Mistral, Gemini, LM Studio…
- **Anthropic Claude**

Les clés API sont chiffrées sur votre ordinateur (Windows DPAPI).

## ⬇ Installation

Téléchargez dans [Releases](https://github.com/ck526438-lgtm/vidioedit/releases/latest) :
- `VidioEdit-x.y.z-x64-nsis.exe` — installateur (raccourcis bureau et menu Démarrer)
- `VidioEdit-x.y.z-x64-portable.exe` — version portable, sans installation

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

Architecture :
- `main.js` — processus principal Electron : fichiers, FFmpeg (analyse, export, silences, scènes), appels IA
- `src/render.js` — moteur de composition partagé entre l'aperçu et l'export (ce que vous voyez = ce que vous exportez)
- `src/app.js` — interface : timeline, inspecteur, lecture, export
- `src/ai.js` — assistant IA : compréhension des commandes et exécution des actions
- `src/presets.js` — filtres, styles de texte, animations, formats

Publier une nouvelle version : changez `version` dans `package.json` et poussez sur `main` — GitHub Actions compile et publie les `.exe` dans une release `v<version>` automatiquement.

## 🗺 Feuille de route

- Sous-titres automatiques (Whisper)
- Transitions entre clips (balayage, zoom…)
- Images clés (keyframes)
- Suppression d'arrière-plan
- Export GIF / WebM, accélération GPU

Les contributions sont les bienvenues : ouvrez une *issue* ou une *pull request*.

## 📄 Licence

[MIT](LICENSE) — libre et gratuit, y compris pour un usage commercial.
VidioEdit utilise [Electron](https://www.electronjs.org/) et [FFmpeg](https://ffmpeg.org/) (via `ffmpeg-static`, licence GPL).
