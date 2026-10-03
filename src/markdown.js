// Markdown → HTML（GFM）。附加两项装饰：表格包一层可横向滚动容器；单元格里的状态词渲染为徽章。

import { Marked } from 'marked';

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const UNSAFE_URL = /^\s*(?:javascript|vbscript|data):/i;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

function safeHref(value) {
  const href = String(value ?? '');
  return UNSAFE_URL.test(href) ? '#' : href;
}

const marked = new Marked({ gfm: true });
marked.use({
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, title, tokens }) {
      const body = this.parser.parseInline(tokens);
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${escapeHtml(safeHref(href))}"${titleAttr} rel="noreferrer noopener">${body}</a>`;
    },
  },
});

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

function decorate(html) {
  return html
    .replace(/<table>/g, '<div class="am-table-wrap"><table>')
    .replace(/<\/table>/g, '</table></div>')
    .replace(CELL_STATUS, (_, attrs, word, label = '') => `<td${attrs}>${statusHtml(word, label)}</td>`);
}

export function md(text) {
  return decorate(marked.parse(String(text ?? '')));
}

export function mdInline(text) {
  return marked.parseInline(String(text ?? ''));
}
