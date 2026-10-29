# Journal des évolutions

Toutes les évolutions notables de l'extension sont listées ici, de la plus récente à la plus ancienne.
Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et la numérotation suit
[Semantic Versioning](https://semver.org/lang/fr/) :

- **correctif** (`1.0.0` → `1.0.1`) : correction de bug, sans changement visible attendu ;
- **mineure** (`1.0.0` → `1.1.0`) : nouvelle fonctionnalité ;
- **majeure** (`1.0.0` → `2.0.0`) : changement qui modifie le comportement existant (ex. nouvelles permissions).

Ajoutez chaque évolution sous « Non publié » au fil de l'eau (rubriques _Ajouté_, _Modifié_, _Corrigé_,
_Supprimé_) ; `npm run release` transforme ensuite cette section en nouvelle version.

## [Non publié]

## [1.0.0] - 2026-10-29

Première version.

### Ajouté

- Export d'une page Microsoft Loop en Markdown depuis le bouton de l'extension (ou `Alt`+`Maj`+`L`) : aperçu
  modifiable, **Copier** et **Télécharger .md**.
- Conversion des titres, paragraphes, gras/italique/barré/code, liens, listes à puces, numérotées et imbriquées,
  listes de tâches, tableaux, blocs de code, citations et images.
- Export de la sélection seule quand du texte est sélectionné dans la page.
- En-tête optionnel (titre, lien de la page, date d'export) pour donner le contexte aux agents IA.
- Conversion d'un contenu collé depuis Loop (`Ctrl`+`A`, `Ctrl`+`C`, puis `Ctrl`+`V` dans l'extension), en secours.
