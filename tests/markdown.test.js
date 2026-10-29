const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { toMarkdown, htmlToMarkdown, buildDocument } = require('../src/markdown.js');

const { DOMParser } = new JSDOM('').window;
const md = (html) => htmlToMarkdown(html, DOMParser);

test('headings, paragraphs and line breaks', () => {
  assert.equal(
    md('<h1>Refinement</h1><p>Première ligne<br>seconde ligne</p><div role="heading" aria-level="3">Décisions</div>'),
    '# Refinement\n\nPremière ligne  \nseconde ligne\n\n### Décisions\n'
  );
});

test('collapses whitespace and removes zero-width characters', () => {
  assert.equal(md('<p>  un\n   deux\u200b&nbsp; trois  </p>'), 'un deux trois\n');
});

test('inline formatting from tags and inline styles', () => {
  assert.equal(
    md(
      '<p><strong>gras</strong>, <em>italique</em>, <s>barré</s>, <code>a_b()</code>, ' +
        '<span style="font-weight:700">style</span> et <b style="font-weight:normal">pas gras</b></p>'
    ),
    '**gras**, *italique*, ~~barré~~, `a_b()`, **style** et pas gras\n'
  );
});

test('keeps spaces outside emphasis markers', () => {
  assert.equal(md('<p>un<b> mot </b>ici</p>'), 'un **mot** ici\n');
});

test('does not repeat nested formatting nor bold headings', () => {
  assert.equal(md('<p><b>a <strong>b</strong></b></p><h2><b>Titre</b></h2>'), '**a b**\n\n## Titre\n');
});

test('escapes Markdown syntax in text', () => {
  assert.equal(
    md('<p># pas un titre</p><p>1. pas une liste</p><p>a*b* snake_case _x_ &lt;div&gt;</p>'),
    '\\# pas un titre\n\n1\\. pas une liste\n\na\\*b\\* snake_case \\_x\\_ \\<div>\n'
  );
});

test('links and images', () => {
  assert.equal(
    md(
      '<p><a href="https://jira.example.com/browse/US-1">US-1</a> ' +
        '<a href="https://example.com">https://example.com</a> ' +
        '<img src="https://example.com/a.png" alt="schéma"> <img src="blob:xyz" alt="capture"> <img alt="👍"></p>'
    ),
    '[US-1](https://jira.example.com/browse/US-1) <https://example.com/> ![schéma](https://example.com/a.png) [image: capture] 👍\n'
  );
});

test('nested and ordered lists', () => {
  assert.equal(
    md('<ul><li>a<ul><li>a1</li><li>a2</li></ul></li><li>b</li></ul><ol start="3"><li>trois</li><li>quatre</li></ol>'),
    '- a\n  - a1\n  - a2\n- b\n\n3. trois\n4. quatre\n'
  );
});

test('list nested directly in a list and ARIA lists', () => {
  assert.equal(md('<ul><li>a</li><ul><li>a1</li></ul><li>b</li></ul>'), '- a\n  - a1\n- b\n');
  assert.equal(
    md('<div role="list"><div><div role="listitem">x</div></div><div role="listitem">y</div></div>'),
    '- x\n- y\n'
  );
});

test('flat lists indented with aria-level', () => {
  assert.equal(
    md(
      '<div role="list"><div role="listitem" aria-level="1">a</div><div role="listitem" aria-level="2">a1</div>' +
        '<div role="listitem" aria-level="1">b</div></div>'
    ),
    '- a\n  - a1\n- b\n'
  );
});

test('list items wrapped one by one are grouped, empty items dropped', () => {
  const item = (text, level = 1) => `<div class="p"><ol><li aria-level="${level}">${text}</li></ol></div>`;
  assert.equal(
    md(`<p>Avant</p>${item('a')}${item('a1', 2)}${item('')}${item('b')}<p>Après</p>`),
    'Avant\n\n1. a\n   1. a1\n2. b\n\nAprès\n'
  );
  // Bullets then numbers: two lists.
  assert.equal(md('<ul><li>a</li></ul><ol><li>un</li></ol>'), '- a\n\n1. un\n');
});

test('task lists', () => {
  assert.equal(
    md(
      '<ul><li><input type="checkbox" checked> fait</li><li><input type="checkbox"> à faire</li></ul>' +
        '<div><span role="checkbox" aria-checked="true"></span> valider la maquette</div>' +
        '<div role="listitem" aria-checked="false">relancer le PO</div>'
    ),
    '- [x] fait\n- [ ] à faire\n\n- [x] valider la maquette\n\n- [ ] relancer le PO\n'
  );
});

test('list item with several paragraphs', () => {
  assert.equal(md('<ul><li><p>a</p><p>suite</p></li><li>b</li></ul>'), '- a\n\n  suite\n- b\n');
});

test('tables', () => {
  assert.equal(
    md(
      '<table><thead><tr><th>US</th><th>Estimation</th></tr></thead>' +
        '<tbody><tr><td>Connexion | SSO</td><td><p>3</p><p>points</p></td></tr><tr><td>Export</td></tr></tbody></table>'
    ),
    '| US | Estimation |\n| --- | --- |\n| Connexion \\| SSO | 3<br>points |\n| Export |  |\n'
  );
});

test('ARIA grids, without a header row', () => {
  assert.equal(
    md(
      '<div role="grid"><div role="rowgroup"><div role="row"><div role="gridcell">a</div><div role="gridcell">b</div></div>' +
        '<div role="row"><div role="gridcell">c</div><div role="gridcell">d</div></div></div></div>'
    ),
    '| a | b |\n| --- | --- |\n| c | d |\n'
  );
});

test('code blocks and quotes', () => {
  assert.equal(
    md('<pre><code class="language-json">{\n  "a": 1\n}</code></pre><blockquote><p>cité</p><p>deux</p></blockquote><hr>'),
    '```json\n{\n  "a": 1\n}\n```\n\n> cité\n>\n> deux\n\n---\n'
  );
  assert.equal(md('<pre>a ``` b</pre>'), '````\na ``` b\n````\n');
});

test('skips hidden content and application chrome', () => {
  assert.equal(
    md(
      '<p>visible</p><p hidden>caché</p><span aria-hidden="true">icône</span><button>Partager</button>' +
        '<div role="toolbar">Gras Italique</div><script>x()</script><style>p{}</style><nav>menu</nav>'
    ),
    'visible\n'
  );
});

test('keep and keepText filters', () => {
  const { document } = new JSDOM(
    '<div id="root"><div role="presentation">Barre</div><div contenteditable="true"><p>Contenu</p>' +
      '<span contenteditable="false">@Alice</span></div></div>'
  ).window;
  const editable = '[contenteditable]:not([contenteditable="false"])';
  assert.equal(
    toMarkdown(document.getElementById('root'), {
      keep: (el) => !!(el.closest(editable) || el.querySelector(editable)),
      keepText: (node) => !!node.parentElement.closest(editable),
    }),
    'Contenu\n\n@Alice\n'
  );
});

test('only converts the selected range', () => {
  const { document } = new JSDOM('<div id="root"><p id="a">premier paragraphe</p><p id="b">second</p><p>troisième</p></div>').window;
  const range = document.createRange();
  range.setStart(document.getElementById('a').firstChild, 8);
  range.setEnd(document.getElementById('b').firstChild, 3);
  assert.equal(toMarkdown(document.getElementById('root'), { range }), 'paragraphe\n\nsec\n');
});

test('buildDocument adds front matter and title', () => {
  const options = { title: 'Refinement "Sprint 12"', url: 'https://loop.cloud.microsoft/p/x', date: '2026-10-29' };
  assert.equal(
    buildDocument({ ...options, markdown: 'Notes\n' }),
    '---\ntitle: "Refinement \\"Sprint 12\\""\nsource: "https://loop.cloud.microsoft/p/x"\nexported: 2026-10-29\n---\n\n' +
      '# Refinement "Sprint 12"\n\nNotes\n'
  );
  // The page title already starts the content: not repeated, turned into a heading.
  assert.match(buildDocument({ ...options, markdown: 'Refinement "Sprint 12"\n\nNotes' }), /---\n\n# Refinement "Sprint 12"\n\nNotes\n$/);
  assert.equal(buildDocument({ ...options, markdown: 'Notes', header: false }), 'Notes\n');
});
