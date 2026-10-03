// 稿件 → 单文件 HTML。流程：parse → STE lint → 渲染面板（markdown / 组件 / raw）→ 套模板 → 内联 CSS 与运行时。

import { parseDoc, ParseError, CHOICES } from './parse.js';
import { md } from './markdown.js';
import { COMPONENTS, RAW_LANGS, ComponentError } from './components/index.js';
import { TEMPLATES } from './templates/index.js';
import { pageCss } from './themes/index.js';
import { lintDoc } from './lint/ste.js';
import { esc, isCJK } from './svg/text.js';
import { VERSION, RUNTIME_JS } from './assets.js';



export class RenderError extends Error {
  constructor(message, { line, component, example } = {}) {
    super(message);
    this.name = 'RenderError';
    this.line = line;
    this.component = component;
    this.example = example;
  }
}

export class LintError extends Error {
  constructor(warnings) {
    super(`STE 检查未通过（style: strict）：${warnings.length} 条`);
    this.name = 'LintError';
    this.warnings = warnings;
  }
}

const UI = {
  ko: {
    theme: { blueprint: '테마: 도면', shadcn: '테마: 카드' },
    mode: { auto: '명암: 시스템 설정', light: '명암: 라이트', dark: '명암: 다크' },
    copy: '원고 복사', done: '복사됨 ✓',
  },
  zh: {
    theme: { blueprint: '主题：图纸', shadcn: '主题：卡片' },
    mode: { auto: '明暗：跟随系统', light: '明暗：亮', dark: '明暗：暗' },
    copy: '复制源稿', done: '已复制 ✓',
  },
  en: {
    theme: { blueprint: 'Theme: Blueprint', shadcn: 'Theme: Cards' },
    mode: { auto: 'Mode: Auto', light: 'Mode: Light', dark: 'Mode: Dark' },
    copy: 'Copy source', done: 'Copied ✓',
  },
};

export function detectLang(text) {
  let hangul = 0;
  let cjk = 0;
  let latin = 0;
  for (const ch of String(text)) {
    if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(ch)) hangul++;
    else if (isCJK(ch)) cjk++;
    else if (/[a-z]/i.test(ch)) latin++;
  }
  if (hangul > 0 && hangul * 3 >= latin) return 'ko';
  return cjk * 3 >= latin ? 'zh' : 'en';
}

export function renderDoc(source, overrides = {}, defaults = {}, runtime = {}) {
  const doc = parseDoc(source, { defaults });
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    if (CHOICES[key] && !CHOICES[key].includes(String(value))) {
      throw new ParseError(`${key} 的值 "${value}" 无效，可选：${CHOICES[key].join(' | ')}`, 0);
    }
    doc.meta[key] = value;
  }

  const warnings = doc.meta.style === 'off' ? [] : lintDoc(doc);
  if (doc.meta.style === 'strict' && warnings.length) throw new LintError(warnings);

  const stats = { panels: doc.panels.length, components: {} };
  const ctx = { seq: 0, stats, ...runtime };
  const introHtml = renderBlocks(doc.intro, ctx);
  const panels = doc.panels.map((p) => ({ ...p, html: renderBlocks(p.blocks, ctx) }));
  const lang = doc.meta.lang || detectLang(source);
  const body = TEMPLATES[doc.meta.template]({ meta: doc.meta, introHtml, panels });
  const html = shell({ meta: doc.meta, lang, body, source });
  return { html, warnings, stats, meta: doc.meta };
}

function renderBlocks(blocks, ctx) {
  return blocks.map((b) => (b.type === 'md' ? `<div class="am-md">${md(b.text)}</div>` : renderFence(b, ctx))).join('\n');
}

function renderFence(block, ctx) {
  const { lang, args, text, line } = block;
  if (RAW_LANGS.has(lang)) return text;
  const comp = COMPONENTS.get(lang);
  if (!comp) {
    return `<pre class="am-code"><code${lang ? ` data-lang="${esc(lang)}"` : ''}>${esc(text)}</code></pre>`;
  }
  ctx.stats.components[lang] = (ctx.stats.components[lang] ?? 0) + 1;
  try {
    return comp.render(text, { args, uid: () => `am${++ctx.seq}`, cwd: ctx.cwd });
  } catch (err) {
    if (!(err instanceof ComponentError)) throw err;
    throw new RenderError(err.message, {
      line: line + (err.line || 0),
      component: lang,
      example: comp.example,
    });
  }
}

function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function shell({ meta, lang, body, source }) {
  const normalizedLang = String(lang || 'en').toLowerCase();
  const ui = normalizedLang.startsWith('ko') ? UI.ko
    : normalizedLang.startsWith('zh') ? UI.zh
      : UI.en;
  const htmlLang = normalizedLang.startsWith('ko') ? 'ko'
    : normalizedLang.startsWith('zh') ? 'zh-CN'
      : (normalizedLang || 'en');
  return `<!doctype html>
<html lang="${esc(htmlLang)}" data-theme="${esc(meta.theme)}" data-mode="${esc(meta.mode)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; font-src https: data:; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="generator" content="Answer me with HTML ${VERSION}">
<title>${esc(meta.title || 'Answer me with HTML')}</title>
<style>
${pageCss()}
</style>
</head>
<body>
<div class="am-toolbar">
<button class="am-btn" type="button" data-am="theme" data-labels="${esc(JSON.stringify(ui.theme))}">${esc(ui.theme[meta.theme])}</button>
<button class="am-btn" type="button" data-am="mode" data-labels="${esc(JSON.stringify(ui.mode))}">${esc(ui.mode[meta.mode])}</button>
<button class="am-btn" type="button" data-am="copy" data-done="${esc(ui.done)}">${esc(ui.copy)}</button>
</div>
${body}
<footer class="am-colophon">Generated by Answer me with HTML ${VERSION} · ${esc(timestamp())}</footer>
<textarea id="am-source" hidden readonly aria-hidden="true">${esc(source)}</textarea>
<script>
${RUNTIME_JS}</script>
</body>
</html>
`;
}
