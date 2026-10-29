/*
 * Injected in the Loop tab (every frame) when the popup opens, after markdown.js.
 * Exposes `globalThis.LoopToMarkdownExtract.extract(options)`, which returns
 * `{ title, url, markdown, selection }` for this frame.
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

    const regions = editableRegions(doc);
    let markdown;
    if (regions.length) {
      // Convert everything around the editable regions, but only what is inside them
      // (or contains them): toolbars, menus and side panels between them are left out.
      markdown = toMarkdown(commonAncestor(regions), {
        live: true,
        keep: (el) => !!(el.closest(EDITABLE) || el.querySelector(EDITABLE)),
        keepText: (node) => !!(node.parentElement && node.parentElement.closest(EDITABLE)),
      });
    } else {
      // Read-only page: no editor, convert the main content.
      markdown = toMarkdown(doc.querySelector('main, [role="main"]') || doc.body, { live: true });
    }
    return { ...base, selection: false, hasSelection: !!range, markdown };
  }

  root.LoopToMarkdownExtract = { extract, pageTitle };
})(globalThis);
