/*
 * Injected in the Loop tab (every frame) when the popup opens, after markdown.js.
 * Exposes `globalThis.LoopToMarkdownExtract.extract(options)`, which returns
 * `{ title, url, markdown, selection }` for this frame, and `diagnose()`,
 * which describes the page structure to fix a wrong export.
 */
(function (root) {
  'use strict';

  const EDITABLE = '[contenteditable]:not([contenteditable="false"])';
  // Editors that are not part of the page (comment box, search…).
  const NOT_CONTENT = '[role="dialog"],[role="search"],[role="combobox"],[role="searchbox"],nav,header,aside';

  /** Loop titles its tabs "Page name | Loop" (or similar): keep the page name. */
  function pageTitle(doc) {
    const parts = (doc.title || '').split(/\s+[|–—-]\s+/);
    while (parts.length > 1 && /loop|microsoft/i.test(parts[parts.length - 1])) parts.pop();
    return parts.join(' - ').trim();
  }

  function selectionRange(doc) {
    const selection = doc.getSelection && doc.getSelection();
    if (!selection || !selection.rangeCount || selection.isCollapsed || !selection.toString().trim()) return null;
    return selection.getRangeAt(0);
  }

  /** Outermost editable regions holding text: the page body, its title, embedded components… */
  function editableRegions(doc) {
    return [...doc.querySelectorAll(EDITABLE)].filter(
      (el) =>
        !(el.parentElement && el.parentElement.closest(EDITABLE)) &&
        !el.closest(NOT_CONTENT) &&
        el.textContent.trim()
    );
  }

  function commonAncestor(elements) {
    let ancestor = elements[0];
    while (ancestor && !elements.every((el) => ancestor.contains(el))) ancestor = ancestor.parentElement;
    return ancestor;
  }

  const keep = (el) => !!(el.closest(EDITABLE) || el.querySelector(EDITABLE));
  const keepText = (node) => !!(node.parentElement && node.parentElement.closest(EDITABLE));

  /** What is converted: the editable regions (and what is around them), or the main content of a read-only page. */
  function contentRoot(doc) {
    const regions = editableRegions(doc);
    if (regions.length) return { root: commonAncestor(regions), filters: { keep, keepText } };
    return { root: doc.querySelector('main, [role="main"]') || doc.body, filters: {} };
  }

  function extract({ selectionOnly = true } = {}) {
    const doc = document;
    const { toMarkdown } = root.LoopToMarkdown;
    const base = { title: pageTitle(doc), url: location.href };
    const range = selectionRange(doc);

    if (range && selectionOnly) {
      const container = range.commonAncestorContainer;
      const start = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
      return { ...base, selection: true, hasSelection: true, markdown: toMarkdown(start, { live: true, range }) };
    }

    // Toolbars, menus and side panels between the editable regions are left out by the filters.
    const { root: start, filters } = contentRoot(doc);
    const markdown = toMarkdown(start, { live: true, ...filters });
    return { ...base, selection: false, hasSelection: !!range, markdown };
  }

  const DIAGNOSTIC_LIMIT = 400000;
  const SHOWN_ATTRIBUTES = /^(role|aria-.*|contenteditable|class|id|data-.*|type|checked|start|href|src|alt)$/;

  /** Computed styles that the conversion relies on, when they are not the default. */
  function describeStyle(el) {
    const view = el.ownerDocument.defaultView;
    const style = view.getComputedStyle(el);
    const before = view.getComputedStyle(el, '::before').content;
    const parts = [`display:${style.display}`];
    if (style.display === 'list-item' || el.localName === 'li') parts.push(`list-style:${style.listStyleType}`);
    if (before && before !== 'none' && before !== 'normal') parts.push(`before:${before}`);
    if (parseInt(style.fontWeight, 10) >= 600) parts.push(`weight:${style.fontWeight}`);
    if (style.fontStyle !== 'normal') parts.push(`style:${style.fontStyle}`);
    if (style.textDecorationLine !== 'none') parts.push(`decoration:${style.textDecorationLine}`);
    if (/mono|courier|consolas|menlo/i.test(style.fontFamily)) parts.push('monospace');
    if (style.visibility !== 'visible') parts.push(`visibility:${style.visibility}`);
    const rect = el.getBoundingClientRect();
    parts.push(`left:${Math.round(rect.left)}`);
    return parts.join('; ');
  }

  /**
   * Indented outline of the content: tags, roles, classes and the computed styles used by the
   * conversion. It contains the page text: meant to be shared deliberately to report a bug.
   */
  function diagnose() {
    const doc = document;
    const { root: start } = contentRoot(doc);
    const lines = [`Loop to Markdown — diagnostic`, `URL: ${location.origin}${location.pathname}`, ''];
    let size = 0;
    const push = (line) => {
      size += line.length + 1;
      if (size <= DIAGNOSTIC_LIMIT) lines.push(line);
    };
    const walk = (node, depth) => {
      if (size > DIAGNOSTIC_LIMIT) return;
      const pad = '  '.repeat(depth);
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.nodeValue.replace(/\s+/g, ' ').trim();
        if (text) push(`${pad}${JSON.stringify(text)}`);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.localName;
      const attributes = [...node.attributes]
        .filter((attribute) => SHOWN_ATTRIBUTES.test(attribute.name))
        .map((attribute) => `${attribute.name}="${attribute.value.slice(0, 80)}"`);
      if (/^(script|style|svg|noscript|template)$/.test(tag)) {
        push(`${pad}<${[tag, ...attributes].join(' ')} />`);
        return;
      }
      push(`${pad}<${[tag, ...attributes].join(' ')}> {${describeStyle(node)}}`);
      for (const child of node.childNodes) walk(child, depth + 1);
    };
    walk(start, 0);
    if (size > DIAGNOSTIC_LIMIT) lines.push('… (tronqué)');
    return lines.join('\n');
  }

  root.LoopToMarkdownExtract = { extract, diagnose, pageTitle };
})(globalThis);
