// Prepares a new version of the extension:
//   npm run release -- patch|minor|major|<x.y.z>
//
// - turns the "Non publié" section of CHANGELOG.md into the new version (dated today);
// - sets the version in manifest.json and package.json;
// - builds the Chrome Web Store zip;
// - prints the release notes.
// Nothing is committed: review the changes, then commit, merge and tag (see README).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const UNRELEASED = '## [Non publié]';

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match && match.slice(1).map(Number);
}

function nextVersion(current, bump) {
  const [major, minor, patch] = parseVersion(current);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (parseVersion(bump)) return bump;
  fail(`Usage: npm run release -- patch|minor|major|<x.y.z> (reçu : "${bump || ''}")`);
}

function isGreater(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/** Replaces the `"version": "…"` value while keeping the file's formatting. */
function setJsonVersion(file, version) {
  const absolute = path.join(root, file);
  const text = fs.readFileSync(absolute, 'utf8');
  const updated = text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
  if (updated === text && JSON.parse(text).version !== version) fail(`Aucune clé "version" dans ${file}`);
  fs.writeFileSync(absolute, updated);
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const current = manifest.version;
if (!parseVersion(current)) fail(`Version actuelle invalide dans manifest.json : ${current}`);

const version = nextVersion(current, process.argv[2]);
// Both stores reject a version that is not strictly greater than the published one.
if (!isGreater(version, current)) fail(`La nouvelle version (${version}) doit être supérieure à ${current}.`);

const changelogPath = path.join(root, 'CHANGELOG.md');
const changelog = fs.readFileSync(changelogPath, 'utf8');
const start = changelog.indexOf(UNRELEASED);
if (start === -1) fail(`Section "${UNRELEASED}" introuvable dans CHANGELOG.md.`);
const bodyStart = start + UNRELEASED.length;
const nextSection = changelog.indexOf('\n## [', bodyStart);
const notes = changelog.slice(bodyStart, nextSection === -1 ? undefined : nextSection).trim();
if (!notes) fail('La section "Non publié" de CHANGELOG.md est vide : décrivez les évolutions de cette version.');

const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(
  changelogPath,
  `${changelog.slice(0, start)}${UNRELEASED}\n\n## [${version}] - ${today}\n\n${notes}\n` +
    (nextSection === -1 ? '' : changelog.slice(nextSection))
);
setJsonVersion('manifest.json', version);
setJsonVersion('package.json', version);

execFileSync(process.execPath, [path.join(__dirname, 'package.js')], { stdio: 'inherit' });

console.log(`
✔ Version ${current} → ${version}

Notes de version :
------------------------------------------------------------
${notes}
------------------------------------------------------------

Étapes suivantes :
  1. Vérifier les changements (git diff) puis commiter : "Release ${version}"
  2. Une fois sur main : git tag v${version} && git push origin v${version}
  3. Envoyer dist/loop-to-markdown-${version}.zip sur le Chrome Web Store`);
