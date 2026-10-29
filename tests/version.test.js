const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const manifest = require('../manifest.json');
const pkg = require('../package.json');

test('manifest.json and package.json share the same x.y.z version', () => {
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.version, manifest.version);
});

test('CHANGELOG.md documents the current version', () => {
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.ok(changelog.includes('## [Non publié]'), 'missing "Non publié" section');
  assert.ok(changelog.includes(`## [${manifest.version}] - `), `missing entry for ${manifest.version}`);
});
