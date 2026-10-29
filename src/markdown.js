/*
 * DOM → Markdown conversion.
 *
 * Works on any DOM: the live Loop page (with `live: true`, formatting and
 * visibility are read from computed styles since Loop's markup relies on CSS
 * classes), HTML pasted from the clipboard, or jsdom in the unit tests.
 *
 * Loaded in the page and in the popup (exposes `globalThis.LoopToMarkdown`)
 * and as a CommonJS module by the unit tests.
 */
(function (root) {
  'use strict';

  const ELEMENT_NODE = 1;
  const TEXT_NODE = 3;
  // Placeholder for <br> while whitespace is collapsed, turned into a Markdown hard break afterwards.
  const BREAK = '';
  const HARD_BREAK = '  \n';

  const SKIP_TAGS = new Set([
    'script', 'style', 'noscript', 'template', 'svg', 'math', 'button', 'select', 'option', 'textarea',
    'canvas', 'iframe', 'object', 'embed', 'audio', 'video', 'head', 'meta', 'link', 'title',
    'nav', 'header', 'footer', 'aside',
  ]);
  // Application chrome that never holds page content.
  const SKIP_ROLES = new Set([
    'toolbar', 'menu', 'menubar', 'tooltip', 'dialog', 'alertdialog', 'progressbar', 'search', 'searchbox',
    'combobox', 'listbox', 'slider', 'scrollbar', 'spinbutton', 'tablist', 'navigation', 'banner',
    'complementary', 'contentinfo', 'status', 'alert', 'log', 'timer', 'marquee',
  ]);
  const BLOCK_TAGS = new Set([
    'address', 'article', 'blockquote', 'caption', 'dd', 'details', 'div', 'dl', 'dt', 'fieldset',
    'figcaption', 'figure', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'li', 'main', 'ol', 'p',
    'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul', 'body',
  ]);
  const BLOCK_DISPLAY = /^(block|flex|grid|list-item|table|flow-root|table-row|table-cell|table-row-group)$/;
  const BLOCK_SELECTOR =
    [...BLOCK_TAGS].join(',') + ',[role="heading"],[role="list"],[role="listitem"],[role="table"],[role="grid"],[role="row"]';
  const BOLD_TAGS = new Set(['b', 'strong']);
  const ITALIC_TAGS = new Set(['i', 'em', 'cite', 'dfn']);
  const STRIKE_TAGS = new Set(['s', 'del', 'strike']);
  const CODE_TAGS = new Set(['code', 'kbd', 'samp', 'tt']);
  const MONOSPACE = /mono|courier|consolas|menlo|monaco/i;
  const UNORDERED_STYLES = new Set(['', 'none', 'disc', 'circle', 'square', 'disclosure-open', 'disclosure-closed']);
  const ZERO_WIDTH = /[​⁠﻿]/g;
  const PICTOGRAPH = /^\p{Extended_Pictographic}/u;

  // ---------------------------------------------------------------------------
  // Element classification

  function roleOf(el) {
    return (el.getAttribute('role') || '').trim().split(/\s+/)[0].toLowerCase();
  }

  function computed(el, ctx) {
    if (!ctx.live || !el || el.nodeType !== ELEMENT_NODE) return null;
    let style = ctx.styles.get(el);
    if (!style) {
      style = el.ownerDocument.defaultView.getComputedStyle(el);
      ctx.styles.set(el, style);
    }
    return style;
  }

  /** Screen-reader-only text (announcements such as "bulleted list") that is not displayed. */
  function isVisuallyHidden(el, style) {
    if (style.position !== 'absolute' && style.position !== 'fixed') return false;
    const rect = el.getBoundingClientRect();
    return rect.width <= 1 || rect.height <= 1;
  }

  function isSkipped(el, tag, role, ctx) {
    if (SKIP_TAGS.has(tag) || SKIP_ROLES.has(role)) return true;
    if (el.hidden || el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('data-md-skip')) return true;
    if (tag === 'input' && (el.getAttribute('type') || '').toLowerCase() !== 'checkbox') return true;
    if (ctx.range && !ctx.range.intersectsNode(el)) return true;
    if (ctx.keep && !ctx.keep(el)) return true;
    const style = computed(el, ctx);
    if (style) {
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return true;
      if (isVisuallyHidden(el, style)) return true;
    }
    return false;
  }

  function isBlock(el, tag, ctx) {
    if (BLOCK_TAGS.has(tag)) return true;
    const style = computed(el, ctx);
    return !!style && BLOCK_DISPLAY.test(style.display);
  }

  function isMonospace(style) {
    return !!style && MONOSPACE.test(style.fontFamily || '');
  }

  /** Content drawn as a list bullet or number by CSS (`::before`) rather than with <li>. */
  function pseudoMarker(el, ctx) {
    if (!ctx.live) return null;
    const content = el.ownerDocument.defaultView.getComputedStyle(el, '::before').content || '';
    if (/counter\(/.test(content)) return 'ordered';
    if (/^"[•◦▪▫‣⁃●○■□]"$/.test(content)) return 'unordered';
    return null;
  }

  function kindOf(el, ctx) {
    let kind = ctx.kinds.get(el);
    if (!kind) {
      kind = classify(el, ctx);
      ctx.kinds.set(el, kind);
    }
    return kind;
  }

  function classify(el, ctx) {
    const tag = el.localName;
    const role = roleOf(el);
    if (isSkipped(el, tag, role, ctx)) return 'skip';
    if (/^h[1-6]$/.test(tag) || role === 'heading') return 'heading';
    if (tag === 'ul' || tag === 'ol' || role === 'list') return 'list';
    if (tag === 'li' || role === 'listitem') return 'listitem';
    if (tag === 'table' && (role === 'presentation' || role === 'none')) return 'block';
    if (tag === 'table' || role === 'table' || role === 'grid' || role === 'treegrid') return 'table';
    if (tag === 'pre') return 'pre';
    if (tag === 'blockquote') return 'quote';
    if (tag === 'hr' || role === 'separator') return 'hr';
    if (tag === 'br') return 'br';
    if (tag === 'img' || role === 'img') return 'img';
    if (tag === 'input' || role === 'checkbox') return 'checkbox';
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (!isBlock(el, tag, ctx)) {
      // An inline wrapper around blocks (e.g. a <span> holding paragraphs) is treated as a block.
      return el.querySelector(BLOCK_SELECTOR) ? 'block' : 'inline';
    }
    const style = computed(el, ctx);
    if (style) {
      if (tag !== 'summary' && (style.display === 'list-item' || pseudoMarker(el, ctx))) return 'listitem';
      if (isMonospace(style) && !isMonospace(computed(el.parentElement, ctx)) && el.textContent.trim()) return 'pre';
    }
    return 'block';
  }

  function isRow(el) {
    return el.localName === 'tr' || roleOf(el) === 'row';
  }

  function isCell(el) {
    return /^(td|th)$/.test(el.localName) || /^(cell|gridcell|columnheader|rowheader)$/.test(roleOf(el));
  }

  // ---------------------------------------------------------------------------
  // Text

  function rawText(node, ctx) {
    let text = node.nodeValue || '';
    const range = ctx.range;
    if (range) {
      if (node !== range.startContainer && node !== range.endContainer && !range.intersectsNode(node)) return '';
      if (node === range.endContainer) text = text.slice(0, range.endOffset);
      if (node === range.startContainer) text = text.slice(range.startOffset);
    }
    return text.replace(ZERO_WIDTH, '');
  }

  function escapeInline(text) {
    return text
      .replace(/[\\`*]/g, '\\$&')
      .replace(/~~/g, '\\~\\~')
      .replace(/<(?=[A-Za-z/!?])/g, '\\<')
      // `snake_case` is safe in CommonMark; only underscores at a word boundary can start emphasis.
      .replace(/_/g, (match, offset, string) =>
        /[\p{L}\p{N}]/u.test(string[offset - 1] || '') && /[\p{L}\p{N}]/u.test(string[offset + 1] || '')
          ? '_'
          : '\\_'
      );
  }

  /** Escapes what would turn a plain line into a heading, quote, list item or rule. */
  function escapeLineStart(line) {
    return line
      .replace(/^(#{1,6})(?=\s|$)/, '\\$1')
      .replace(/^>/, '\\>')
      .replace(/^([-+])(?=\s)/, '\\$1')
      .replace(/^(\d+)([.)])(?=\s|$)/, '$1\\$2')
      .replace(/^([-=])(?=\1\1+\s*$)/, '\\$1');
  }

  function renderText(node, ctx) {
    if (ctx.keepText && !ctx.keepText(node)) return '';
    const text = rawText(node, ctx).replace(/[\s ]+/g, ' ');
    return ctx.code ? text : escapeInline(text);
  }

  /** Text of a code element, keeping line breaks from <br> and block children. */
  function codeText(el, ctx) {
    let text = '';
    for (const child of el.childNodes) {
      if (child.nodeType === TEXT_NODE) {
        text += rawText(child, ctx).replace(/ /g, ' ');
      } else if (child.nodeType === ELEMENT_NODE) {
        const kind = kindOf(child, ctx);
        if (kind === 'skip') continue;
        if (kind === 'br') text += '\n';
        else if (kind === 'inline' || kind === 'link') text += codeText(child, ctx);
        else text += `${text && !text.endsWith('\n') ? '\n' : ''}${codeText(child, ctx)}\n`;
      }
    }
    return text;
  }

  function fenceFor(text, char) {
    const longest = Math.max(0, ...(text.match(new RegExp(`${char}+`, 'g')) || []).map((run) => run.length));
    return char.repeat(longest + 1);
  }

  function codeSpan(text) {
    const code = text.replace(/\n/g, ' ');
    if (!code.trim()) return code;
    const fence = fenceFor(code, '`');
    const pad = code.startsWith('`') || code.endsWith('`') ? ' ' : '';
    return `${fence}${pad}${code}${pad}${fence}`;
  }

  // ---------------------------------------------------------------------------
  // Inline content

  function isBoldWeight(weight) {
    return weight === 'bold' || weight === 'bolder' || parseInt(weight, 10) >= 600;
  }

  function inlineFormat(el, ctx) {
    const tag = el.localName;
    const style = computed(el, ctx);
    if (style) {
      const parent = computed(el.parentElement, ctx);
      const decorations = (s) => `${s.textDecorationLine || ''} ${s.textDecoration || ''}`;
      return {
        bold: isBoldWeight(style.fontWeight) && !(parent && isBoldWeight(parent.fontWeight)),
        italic: /italic|oblique/.test(style.fontStyle) && !(parent && /italic|oblique/.test(parent.fontStyle)),
        strike: /line-through/.test(decorations(style)) && !(parent && /line-through/.test(decorations(parent))),
        code: CODE_TAGS.has(tag) || (isMonospace(style) && !isMonospace(parent)),
      };
    }
    const format = {
      bold: BOLD_TAGS.has(tag),
      italic: ITALIC_TAGS.has(tag),
      strike: STRIKE_TAGS.has(tag),
      code: CODE_TAGS.has(tag),
    };
    const inline = el.style;
    if (inline) {
      if (inline.fontWeight) format.bold = isBoldWeight(inline.fontWeight);
      if (inline.fontStyle) format.italic = /italic|oblique/.test(inline.fontStyle);
      if (/line-through/.test(`${inline.textDecorationLine || ''} ${inline.textDecoration || ''}`)) format.strike = true;
      if (MONOSPACE.test(inline.fontFamily || '')) format.code = true;
    }
    return format;
  }

  /** Wraps `content` in `marker`, keeping surrounding spaces outside (`** a**` is not bold in Markdown). */
  function wrap(content, marker) {
    const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(content);
    if (!match[2] || match[2] === BREAK) return content;
    return `${match[1]}${marker}${match[2]}${marker}${match[3]}`;
  }

  function renderFormatted(el, ctx) {
    const format = inlineFormat(el, ctx);
    if (format.code && !ctx.code) return codeSpan(codeText(el, ctx));
    const inner = {
      ...ctx,
      bold: ctx.bold || format.bold,
      italic: ctx.italic || format.italic,
      strike: ctx.strike || format.strike,
    };
    let content = renderInlineChildren(el, inner);
    if (format.strike && !ctx.strike) content = wrap(content, '~~');
    if (format.italic && !ctx.italic) content = wrap(content, '*');
    if (format.bold && !ctx.bold && !ctx.heading) content = wrap(content, '**');
    return content;
  }

  function encodeUrl(url) {
    return url.replace(/[ ()<>]/g, (char) => encodeURIComponent(char));
  }

  function renderLink(el, ctx) {
    const href = (typeof el.href === 'string' && el.href) || el.getAttribute('href') || '';
    const text = renderInlineChildren(el, ctx);
    if (!href || /^javascript:/i.test(href) || href.startsWith('#')) return text;
    const [, before, label, after] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
    const bare = (url) => url.replace(/\\/g, '').replace(/\/$/, '');
    if (!label || bare(label) === bare(href)) return `${before}<${encodeUrl(href)}>${after}`;
    return `${before}[${label}](${encodeUrl(href)})${after}`;
  }

  function renderImage(el, ctx) {
    if (el.localName !== 'img') return renderInlineChildren(el, ctx); // role="img": emoji, icons…
    const alt = (el.getAttribute('alt') || el.getAttribute('title') || '').trim();
    if (PICTOGRAPH.test(alt) && [...alt].length <= 4) return alt; // emoji drawn as an image
    const src = (typeof el.src === 'string' && el.src) || el.getAttribute('src') || '';
    const label = escapeInline(alt).replace(/[[\]]/g, '\\$&');
    if (/^https?:/i.test(src)) return `![${label}](${encodeUrl(src)})`;
    return label ? `[image: ${label}]` : '';
  }

  function isChecked(el) {
    if (el.localName === 'input') return !!el.checked || el.hasAttribute('checked');
    return el.getAttribute('aria-checked') === 'true';
  }

  function renderInlineElement(el, kind, ctx) {
    switch (kind) {
      case 'br':
        return BREAK;
      case 'checkbox':
        return `${isChecked(el) ? '[x]' : '[ ]'} ${el.localName === 'input' ? '' : renderInlineChildren(el, ctx)}`;
      case 'img':
        return renderImage(el, ctx);
      case 'link':
        return renderLink(el, ctx);
      default:
        return renderFormatted(el, ctx);
    }
  }

  function renderInlineChildren(el, ctx) {
    let text = '';
    for (const child of el.childNodes) {
      if (child.nodeType === TEXT_NODE) {
        text += renderText(child, ctx);
      } else if (child.nodeType === ELEMENT_NODE) {
        const kind = kindOf(child, ctx);
        if (kind === 'skip') continue;
        if (kind === 'inline' || kind === 'link' || kind === 'img' || kind === 'checkbox' || kind === 'br') {
          text += renderInlineElement(child, kind, ctx);
        } else {
          // A block where only inline content is possible (heading, link, table cell…): keep it on its own line.
          const blocks = renderBlockElement(child, kind, ctx);
          if (blocks.length) text += `${BREAK}${blocks.join(BREAK)}${BREAK}`;
        }
      }
    }
    return text;
  }

  /** Turns collected inline content into Markdown lines. */
  function finishInline(text, escapeStarts = true) {
    const lines = text
      .split(BREAK)
      .map((line) => line.replace(/ {2,}/g, ' ').trim())
      .map((line) => (escapeStarts ? escapeLineStart(line) : line));
    while (lines.length && !lines[0]) lines.shift();
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    return lines.join(HARD_BREAK).replace(/ {2}\n(?: {2}\n)+/g, '\n\n');
  }

  function finishParagraph(text) {
    const paragraph = finishInline(text);
    // A checkbox in front of a line is a task list item.
    return /^\[[ x]\] /.test(paragraph) ? `- ${paragraph}` : paragraph;
  }

  // ---------------------------------------------------------------------------
  // Blocks

  function renderBlocks(container, ctx) {
    const blocks = [];
    let inline = '';
    let items = [];
    const flushInline = () => {
      const paragraph = finishParagraph(inline);
      if (paragraph) blocks.push(paragraph);
      inline = '';
    };
    const flushItems = () => {
      if (items.length) blocks.push(...renderList(items, null, ctx));
      items = [];
    };

    for (const child of container.childNodes) {
      if (child.nodeType === TEXT_NODE) {
        if (items.length && !rawText(child, ctx).trim()) continue;
        flushItems();
        inline += renderText(child, ctx);
        continue;
      }
      if (child.nodeType !== ELEMENT_NODE) continue;
      const kind = kindOf(child, ctx);
      if (kind === 'skip') continue;
      // List items outside a list (e.g. bullets drawn with CSS) are grouped into one list.
      if (kind === 'listitem') {
        flushInline();
        items.push(child);
        continue;
      }
      flushItems();
      if (kind === 'inline' || kind === 'link' || kind === 'img' || kind === 'checkbox' || kind === 'br') {
        inline += renderInlineElement(child, kind, ctx);
      } else {
        flushInline();
        blocks.push(...renderBlockElement(child, kind, ctx));
      }
    }
    flushItems();
    flushInline();
    return blocks;
  }

  function renderBlockElement(el, kind, ctx) {
    switch (kind) {
      case 'heading':
        return renderHeading(el, ctx);
      case 'list':
        return renderList(listChildren(el, ctx), el, ctx);
      case 'listitem':
        return renderList([el], null, ctx);
      case 'table':
        return renderTable(el, ctx);
      case 'pre':
        return renderCode(el, ctx);
      case 'quote': {
        const content = renderBlocks(el, ctx).join('\n\n');
        return content ? [content.replace(/^/gm, '> ').replace(/^> $/gm, '>')] : [];
      }
      case 'hr':
        return ['---'];
      default:
        return renderBlocks(el, ctx);
    }
  }

  function renderHeading(el, ctx) {
    const level = /^h[1-6]$/.test(el.localName)
      ? Number(el.localName[1])
      : Math.min(6, Math.max(1, parseInt(el.getAttribute('aria-level'), 10) || 2));
    const text = finishInline(renderInlineChildren(el, { ...ctx, heading: true }), false).replace(/ {2}\n/g, ' ');
    return text ? [`${'#'.repeat(level)} ${text}`] : [];
  }

  function renderCode(el, ctx) {
    const text = codeText(el, ctx).replace(/\n+$/, '');
    if (!text.trim()) return [];
    const hint = [el, el.querySelector('code')]
      .filter(Boolean)
      .map((node) => node.getAttribute('data-language') || (/(?:^|\s)lang(?:uage)?-(\S+)/.exec(node.className || '') || [])[1])
      .find(Boolean);
    const fence = fenceFor(text, '`').length < 3 ? '```' : fenceFor(text, '`');
    return [`${fence}${hint || ''}\n${text}\n${fence}`];
  }

  // --- Lists

  /** Items of a list element, looking through wrappers; nested lists keep their position. */
  function listChildren(list, ctx) {
    const children = [];
    for (const child of list.children) {
      const kind = kindOf(child, ctx);
      if (kind === 'skip') continue;
      if (kind === 'listitem' || kind === 'list') children.push(child);
      else children.push(...listChildren(child, ctx));
    }
    return children;
  }

  function isOrderedItem(el, list, ctx) {
    if (list && list.localName === 'ol') return true;
    if (el.parentElement && el.parentElement.localName === 'ol') return true;
    const style = computed(el, ctx);
    if (style && style.display === 'list-item' && !UNORDERED_STYLES.has(style.listStyleType)) return true;
    return pseudoMarker(el, ctx) === 'ordered';
  }

  /**
   * Nesting level of each item of a flat list (no nested list elements): from
   * `aria-level` when present, otherwise from the visual indentation of the item.
   */
  function flatLevels(items, ctx) {
    const ariaLevels = items.map((item) => parseInt(item.getAttribute('aria-level'), 10));
    if (ariaLevels.some((level) => level > 0)) {
      const min = Math.min(...ariaLevels.filter((level) => level > 0));
      return ariaLevels.map((level) => (level > 0 ? level - min : 0));
    }
    if (!ctx.live) return items.map(() => 0);
    const lefts = items.map((item) => {
      const style = computed(item, ctx);
      const left = item.getBoundingClientRect().left + parseFloat(style.paddingLeft || 0) + parseFloat(style.textIndent || 0);
      return Math.round(left / 4);
    });
    const distinct = [...new Set(lefts)].sort((a, b) => a - b);
    return lefts.map((left) => distinct.indexOf(left));
  }

  /** Indents every line but the first. */
  function indentLines(text, pad) {
    return text.replace(/\n(?=.)/g, `\n${pad}`);
  }

  function indentAll(text, pad) {
    return pad ? text.replace(/^(?=.)/gm, pad) : text;
  }

  function renderListItem(item, marker, ctx) {
    const blocks = renderBlocks(item, ctx);
    let first = blocks.shift() || '';
    if (/^- \[[ x]\] /.test(first)) first = first.slice(2);
    if (item.hasAttribute('aria-checked') && !/^\[[ x]\] /.test(first)) first = `${isChecked(item) ? '[x]' : '[ ]'} ${first}`;
    let body = first;
    // A nested list stays tight under its item; other blocks are separated by a blank line.
    for (const block of blocks) body += /^([-*+]|\d+\.) /.test(block) ? `\n${block}` : `\n\n${block}`;
    return `${marker}${indentLines(body, ' '.repeat(marker.length))}`.trimEnd();
  }

  /** `children`: list item and nested list elements, in order. */
  function renderList(children, list, ctx) {
    const items = children.filter((child) => kindOf(child, ctx) === 'listitem');
    if (!children.length) return [];
    const ordered = items.length > 0 && isOrderedItem(items[0], list, ctx);
    const flat = items.length === children.length && items.every((item) => !item.querySelector('ul,ol,[role="list"]'));
    const levels = flat ? flatLevels(items, ctx) : children.map(() => 0);
    const start = list && list.localName === 'ol' ? parseInt(list.getAttribute('start'), 10) || 1 : 1;
    const counters = [];
    const lines = [];
    let itemPad = '';

    children.forEach((child, index) => {
      if (kindOf(child, ctx) === 'list') {
        // Nested list placed directly in the list instead of inside an item: indent it under the previous item.
        const nested = renderList(listChildren(child, ctx), child, ctx).join('\n');
        if (nested) lines.push(indentAll(nested, itemPad));
        return;
      }
      const level = levels[index];
      counters.length = level + 1;
      counters[level] = (counters[level] || (level === 0 ? start - 1 : 0)) + 1;
      const marker = ordered ? `${counters[level]}. ` : '- ';
      const indent = ' '.repeat(level * (ordered ? 3 : 2));
      lines.push(indentAll(renderListItem(child, marker, ctx), indent));
      itemPad = indent + ' '.repeat(marker.length);
    });
    return lines.length ? [lines.join('\n')] : [];
  }

  // --- Tables

  function tableRows(el, ctx) {
    const rows = [];
    for (const child of el.children) {
      if (kindOf(child, ctx) === 'skip') continue;
      if (isRow(child)) rows.push(child);
      else if (child.localName === 'caption') continue;
      else if (kindOf(child, ctx) !== 'table') rows.push(...tableRows(child, ctx));
    }
    return rows;
  }

  function rowCells(row, ctx) {
    const cells = [];
    for (const child of row.children) {
      if (kindOf(child, ctx) === 'skip') continue;
      if (isCell(child)) cells.push(child);
      else if (!isRow(child)) cells.push(...rowCells(child, ctx));
    }
    return cells;
  }

  function renderCell(cell, ctx) {
    return renderBlocks(cell, ctx)
      .join('\n')
      .replace(/ {2}\n/g, '<br>')
      .replace(/\n+/g, '<br>')
      .replace(/\|/g, '\\|')
      .trim();
  }

  function renderTable(el, ctx) {
    const rows = tableRows(el, ctx)
      .map((row) => rowCells(row, ctx))
      .filter((cells) => cells.length);
    if (!rows.length) return renderBlocks(el, ctx);
    const texts = rows.map((cells) => cells.map((cell) => renderCell(cell, ctx)));
    const width = Math.max(...texts.map((cells) => cells.length));
    const line = (cells) => `| ${Array.from({ length: width }, (_, i) => cells[i] || '').join(' | ')} |`;
    // GFM tables need a header row: the first row is used when the table has none.
    const lines = [line(texts[0]), `|${' --- |'.repeat(width)}`, ...texts.slice(1).map(line)];
    const caption = el.querySelector('caption');
    const blocks = caption ? renderBlocks(caption, ctx) : [];
    return [...blocks, lines.join('\n')];
  }

  // ---------------------------------------------------------------------------
  // Entry points

  /**
   * Converts a DOM node (element, document or fragment) to Markdown.
   * Options:
   *   live      read formatting and visibility from computed styles (live page)
   *   range     only convert what this Range covers (the user's selection)
   *   keep      (element) => boolean, elements to convert (default: all)
   *   keepText  (textNode) => boolean, text nodes to convert (default: all)
   */
  function toMarkdown(node, options = {}) {
    const start = node.nodeType === 9 ? node.body || node.documentElement : node;
    const ctx = {
      live: !!options.live,
      range: options.range || null,
      keep: options.keep || null,
      keepText: options.keepText || null,
      styles: new Map(),
      kinds: new Map(),
    };
    const kind = start.nodeType === ELEMENT_NODE ? kindOf(start, ctx) : 'block';
    const blocks = kind === 'skip' ? [] : kind === 'block' ? renderBlocks(start, ctx) : renderBlockElement(start, kind, ctx);
    const markdown = blocks
      .filter((block) => block.trim())
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return markdown ? `${markdown}\n` : '';
  }

  /** Converts an HTML string (e.g. copied from Loop) with the given DOMParser. */
  function htmlToMarkdown(html, Parser = root.DOMParser) {
    const doc = new Parser().parseFromString(html, 'text/html');
    return toMarkdown(doc.body);
  }

  function yamlString(value) {
    return JSON.stringify(String(value));
  }

  function plainText(markdown) {
    return markdown.replace(/^#+\s+/, '').replace(/[*_~`\\]/g, '').trim();
  }

  /**
   * Final document: `# title` (unless the content already starts with it) and,
   * with `header`, a YAML front matter giving the source to the AI agent.
   */
  function buildDocument({ markdown, title, url, date, header = true }) {
    let body = (markdown || '').trim();
    if (header && title) {
      const [first, ...rest] = body.split('\n');
      if (first && plainText(first) === title.trim()) {
        body = [/^#{1,6} /.test(first) ? first : `# ${first}`, ...rest].join('\n');
      } else {
        body = `# ${escapeLineStart(escapeInline(title.trim()))}${body ? `\n\n${body}` : ''}`;
      }
    }
    if (!header) return body ? `${body}\n` : '';
    const meta = ['---'];
    if (title) meta.push(`title: ${yamlString(title.trim())}`);
    if (url) meta.push(`source: ${yamlString(url)}`);
    if (date) meta.push(`exported: ${date}`);
    meta.push('---');
    return `${meta.join('\n')}\n\n${body}\n`;
  }

  const api = { toMarkdown, htmlToMarkdown, buildDocument, escapeInline };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.LoopToMarkdown = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
