'use strict';

const { buildDocument, htmlToMarkdown } = globalThis.LoopToMarkdown;

const output = document.getElementById('output');
const status = document.getElementById('status');
const stats = document.getElementById('stats');
const headerOption = document.getElementById('header');
const selectionOption = document.getElementById('selection-option');
const selectionOnly = document.getElementById('selection-only');
const copyButton = document.getElementById('copy');
const downloadButton = document.getElementById('download');

// What was exported: { title, url, markdown, selection, hasSelection }.
let source = { title: '', url: '', markdown: '' };

const HEADER_KEY = 'loop-to-markdown:header';
try {
  headerOption.checked = localStorage.getItem(HEADER_KEY) !== 'false';
} catch {
  // Storage unavailable: keep the default.
}

function setStatus(message, type = '') {
  status.textContent = message;
  status.className = type;
}

function today() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function updateStats() {
  const text = output.value;
  const words = (text.match(/[\p{L}\p{N}]+/gu) || []).length;
  stats.textContent = text ? `${words.toLocaleString('fr-FR')} mots · ${text.split('\n').length} lignes` : '';
  copyButton.disabled = downloadButton.disabled = !text.trim();
}

function render() {
  output.value = source.markdown.trim()
    ? buildDocument({ ...source, date: today(), header: headerOption.checked })
    : '';
  selectionOption.hidden = !source.hasSelection;
  updateStats();
}

/** Converts the page in every frame of the tab and keeps the most relevant result. */
async function extractFromTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/.test(tab.url || '')) throw new Error('Cette page ne peut pas être exportée.');

  const run = async (allFrames) => {
    const target = { tabId: tab.id, allFrames };
    await chrome.scripting.executeScript({ target, files: ['src/markdown.js', 'src/extract.js'] });
    return chrome.scripting.executeScript({
      target,
      func: (options) => globalThis.LoopToMarkdownExtract.extract(options),
      args: [{ selectionOnly: selectionOnly.checked }],
    });
  };
  let results;
  try {
    results = await run(true);
  } catch {
    results = await run(false); // a frame refused the injection: the main page alone
  }

  const found = results.map((result) => result.result).filter((result) => result && result.markdown.trim());
  const best =
    found.find((result) => result.selection) ||
    found.sort((a, b) => b.markdown.length - a.markdown.length)[0] ||
    { markdown: '', selection: false, hasSelection: false };
  const top = results.find((result) => result.frameId === 0)?.result;
  return {
    ...best,
    title: top?.title || best.title || tab.title || '',
    url: top?.url || tab.url,
    hasSelection: found.some((result) => result.hasSelection),
  };
}

async function exportPage() {
  setStatus('Export en cours…');
  try {
    source = await extractFromTab();
    render();
    if (!source.markdown.trim()) setStatus('Aucun contenu trouvé : copiez-collez la page (voir ci-dessous).', 'error');
    else setStatus(source.selection ? 'Sélection exportée' : 'Page exportée');
  } catch (error) {
    setStatus(error.message || String(error), 'error');
    render();
  }
}

output.addEventListener('paste', (event) => {
  const html = event.clipboardData.getData('text/html');
  if (!html) return; // plain text: normal paste
  event.preventDefault();
  source = { ...source, markdown: htmlToMarkdown(html), selection: false };
  render();
  setStatus('Contenu collé converti', 'success');
});

output.addEventListener('input', updateStats);

headerOption.addEventListener('change', () => {
  try {
    localStorage.setItem(HEADER_KEY, String(headerOption.checked));
  } catch {
    // Not remembered: fine.
  }
  render();
});

selectionOnly.addEventListener('change', exportPage);

copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(output.value);
    setStatus('Copié dans le presse-papiers ✓', 'success');
  } catch (error) {
    output.select();
    setStatus('Copie impossible : sélectionnez le texte et faites Ctrl+C.', 'error');
  }
});

function fileName() {
  const name = (source.title || 'loop')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return `${name || 'loop'}.md`;
}

downloadButton.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([output.value], { type: 'text/markdown;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: fileName() });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus('Fichier téléchargé ✓', 'success');
});

exportPage();
