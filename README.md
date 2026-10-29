# Loop to Markdown — extension Chrome

Exporte une page [Microsoft Loop](https://loop.cloud.microsoft/) en Markdown, par exemple les notes prises en
refinement, pour la donner en contexte à un agent IA qui rédige les user stories.

1. Ouvrir la page Loop.
2. Cliquer sur l'icône de l'extension (ou `Alt`+`Maj`+`L`).
3. Relire le Markdown dans l'aperçu (il est modifiable), puis **Copier** ou **Télécharger .md**.

Exemple de résultat :

```markdown
---
title: "Refinement Sprint 12"
source: "https://loop.cloud.microsoft/p/…"
exported: 2026-10-29
---

# Refinement Sprint 12

## Contexte

Le PO veut **simplifier** l'*onboarding*, sans ~~SSO~~ et avec l'API `POST /users`.

- Écran d'accueil
  - Logo
- [x] Valider la maquette avec @Alice

| US | Points |
| --- | --- |
| Connexion | 3 |
```

- **Sélection** : si du texte est sélectionné dans la page, seule la sélection est exportée (case
  « Uniquement la sélection » pour exporter toute la page).
- **En-tête** : la case « Ajouter titre, lien et date » ajoute un front matter YAML et le titre de la page. Le
  choix est mémorisé.
- **Secours par copier-coller** : si l'export semble incomplet, faire `Ctrl`+`A` puis `Ctrl`+`C` dans la page
  Loop, et coller avec `Ctrl`+`V` dans l'aperçu de l'extension : le contenu copié est converti en Markdown. Cela
  marche aussi pour un composant Loop ouvert dans Teams ou Outlook.

## Installation (mode développeur)

Aucune étape de build n'est nécessaire.

1. Ouvrir `chrome://extensions` (ou `edge://extensions`).
2. Activer le **mode développeur**.
3. Cliquer sur **Charger l'extension non empaquetée** et sélectionner ce dossier.

## Fonctionnement

L'éditeur de Loop ne produit pas du HTML sémantique (le gras, les puces… sont rendus par des classes CSS). La
conversion s'appuie donc sur ce qui est stable :

- les rôles d'accessibilité (`heading` + `aria-level`, `list`/`listitem`, `checkbox` + `aria-checked`,
  `grid`/`row`/`gridcell`…) en plus des balises HTML ;
- les **styles calculés** du navigateur : un texte en gras est exporté en `**gras**` quelle que soit la classe
  utilisée, une puce dessinée en CSS (`::before`) ou un élément `display: list-item` devient un élément de liste,
  le décalage horizontal d'un élément de liste donne son niveau d'imbrication, une police à chasse fixe donne du
  code ;
- les zones éditables (`contenteditable`) : seul leur contenu est exporté, ce qui écarte barre latérale, barres
  d'outils et panneau de commentaires. Sur une page en lecture seule, c'est le contenu principal (`main`) qui est
  exporté.

Le texte invisible (masqué, ou réservé aux lecteurs d'écran), les boutons et les menus sont ignorés. Quand la
page Loop contient des iframes, la conversion tourne dans chacune et garde le résultat le plus complet.

| Fichier | Rôle |
| --- | --- |
| `src/markdown.js` | Conversion DOM → Markdown, utilisable sur la page réelle, sur du HTML collé ou dans les tests. |
| `src/extract.js` | Injecté dans la page à l'ouverture du popup : repère le contenu de la page et le convertit. |
| `popup/` | Aperçu, options, copie et téléchargement. |
| `tests/fixtures/loop-like.html` | Page qui imite la structure de Loop, pour tester l'extension sans compte Microsoft. |

**Permissions** : `activeTab` et `scripting` pour lire la page quand on clique sur l'extension, et l'accès aux
domaines Loop (`loop.cloud.microsoft`, `loop.microsoft.com`) pour lire aussi leurs iframes. L'extension
fonctionne sur n'importe quel autre site via `activeTab`. Rien n'est envoyé sur le réseau : la conversion se fait
entièrement dans le navigateur.

### Limites connues

- La structure de Loop n'est pas documentée et peut changer : en cas d'export incorrect, utiliser le
  copier-coller, et ouvrir une issue avec le diagnostic (lien **Copier un diagnostic** de l'extension). Il décrit
  la structure de la page et les styles utilisés par la conversion ; il contient aussi le texte de la page,
  à retirer si besoin avant de le partager.
- Les images collées dans Loop ne sont pas accessibles hors de Loop : elles sont exportées sous la forme
  `[image: texte alternatif]`.
- Les sections repliées ou les longues pages que Loop n'a pas encore affichées peuvent manquer : les déplier ou
  faire défiler la page jusqu'en bas avant d'exporter.

## Développement

```bash
npm install        # installe jsdom pour les tests
npm test           # tests unitaires de la conversion
npm run package    # crée dist/loop-to-markdown-<version>.zip → Chrome Web Store
```

Pour essayer l'extension sans Loop : ouvrir `tests/fixtures/loop-like.html` (servi en local, par exemple avec
`npx http-server tests/fixtures`) et cliquer sur l'extension.

Après une modification, cliquer sur ↻ dans `chrome://extensions`, puis rouvrir le popup.

## Publier une nouvelle version

Les évolutions sont tenues à jour dans [`CHANGELOG.md`](CHANGELOG.md), sous « Non publié ». Pour publier :

1. `npm run release -- patch|minor|major` : date la section « Non publié » du changelog sous le nouveau numéro, met
   à jour la version dans `manifest.json` et `package.json`, génère le zip dans `dist/` et affiche les notes de
   version.
2. Commiter (« Release x.y.z »), merger dans `main`, puis tagger : `git tag vx.y.z && git push origin vx.y.z`.
3. Chrome Web Store : console développeur → l'extension → **Package** → **Importer un nouveau package** avec
   `dist/loop-to-markdown-x.y.z.zip`, puis **Envoyer pour examen**.

`npm test` vérifie que `manifest.json` et `package.json` ont la même version et que le changelog la documente.
