// Markdown → HTML（GFM）。附加表格/状态徽章装饰，并把 source: 相对路径链接转换为 VS Code 파일 URI。

import { Marked } from 'marked';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { esc } from './svg/text.js';

const marked = new Marked({ gfm: true });

const STATUS = {
  ok: { cls: 'ok', icon: '✓' },
  no: { cls: 'no', icon: '✗' },
  warn: { cls: 'warn', icon: '!' },
};
const STATUS_ALIAS = { '✓': 'ok', '✔': 'ok', '✗': 'no', '✘': 'no', '⚠': 'warn' };

export function statusHtml(word, label = '') {
  const kind = STATUS[STATUS_ALIAS[word] ?? word];
  if (!kind) return null;
  const text = label.trim();
  return `<span class="am-status am-status--${kind.cls}"><span class="am-status-icon" aria-hidden="true">${kind.icon}</span>${text}</span>`;
}

const CELL_STATUS = /<td([^>]*)>\s*(ok|no|warn|✓|✔|✗|✘|⚠)(?:\s+([^<]*?))?\s*<\/td>/g;
const SOURCE_ANCHOR = /<a href="source:([^"]+)"([^>]*)>([\s\S]*?)<\/a>/g;

function decodeRef(raw) {
  const htmlDecoded = String(raw)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  try {
    return decodeURIComponent(htmlDecoded);
  } catch {
    return htmlDecoded;
  }
}

export function parseSourceRef(raw) {
  let ref = decodeRef(raw).trim();
  if (!ref || ref.includes('\0')) return null;

  let line = 1;
  let column = 1;

  const hash = ref.match(/^(.*)#L(\d+)(?:C(\d+))?$/i);
  if (hash) {
    ref = hash[1];
    line = Number(hash[2]);
    column = Number(hash[3] || 1);
  } else {
    const lineColumn = ref.match(/^(.*):(\d+):(\d+)$/);
    if (lineColumn) {
      ref = lineColumn[1];
      line = Number(lineColumn[2]);
      column = Number(lineColumn[3]);
    } else {
      const lineOnly = ref.match(/^(.*):(\d+)$/);
      if (lineOnly) {
        ref = lineOnly[1];
        line = Number(lineOnly[2]);
      }
    }
  }

  const file = ref.trim();
  if (!file || !Number.isInteger(line) || line < 1 || !Number.isInteger(column) || column < 1) return null;
  return { file, line, column };
}

function encodeVsCodePath(path) {
  const normalized = path.replace(/\\/g, '/');
  const encoded = normalized
    .split('/')
    .map((part) => (/^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)))
    .join('/');
  return encoded.startsWith('/') ? encoded : `/${encoded}`;
}

export function vscodeSourceHref(raw, cwd) {
  const parsed = parseSourceRef(raw);
  if (!parsed || !cwd) return null;
  if (isAbsolute(parsed.file) || /^[A-Za-z]:[\\/]/.test(parsed.file) || /^[a-z][a-z0-9+.-]*:/i.test(parsed.file)) return null;

  const root = resolve(cwd);
  const absolute = resolve(root, parsed.file);
  const rel = relative(root, absolute);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;

  return `vscode://file${encodeVsCodePath(absolute)}:${parsed.line}:${parsed.column}`;
}

function decorateSourceLinks(html, cwd) {
  return html.replace(SOURCE_ANCHOR, (_whole, rawRef, attrs = '', body) => {
    const ref = decodeRef(rawRef);
    const href = vscodeSourceHref(ref, cwd);
    if (!href) {
      return `<span class="am-source-link am-source-link--invalid" data-source-ref="${esc(ref)}" title="Source link is outside the current workspace or the workspace path is unavailable">${body}</span>`;
    }
    return `<a class="am-source-link" href="${esc(href)}" data-source-ref="${esc(ref)}"${attrs}>${body}</a>`;
  });
}

function decorate(html, { cwd } = {}) {
  return decorateSourceLinks(
    html
      .replace(/<table>/g, '<div class="am-table-wrap"><table>')
      .replace(/<\/table>/g, '</table></div>')
      .replace(CELL_STATUS, (_, attrs, word, label = '') => `<td${attrs}>${statusHtml(word, label)}</td>`),
    cwd,
  );
}

export function md(text, options = {}) {
  return decorate(marked.parse(String(text ?? '')), options);
}

export function mdInline(text, options = {}) {
  return decorateSourceLinks(marked.parseInline(String(text ?? '')), options.cwd);
}
