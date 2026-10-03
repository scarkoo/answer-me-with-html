// am CLI：render / lint / list / help。main() 接收注入的流与环境变量，方便测试。

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { VERSION } from './assets.js';
import { join, resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { renderDoc, RenderError, LintError } from './render.js';
import { parseDoc, ParseError, CHOICES } from './parse.js';
import { lintDoc, formatWarning } from './lint/ste.js';
import { COMPONENTS } from './components/index.js';
import { THEMES } from './themes/index.js';
import { amHome, readConfig, setConfig, resetConfig, CONFIG_KEYS, ConfigError } from './config.js';

const MAX_LISTED_WARNINGS = 20;

const USAGE = `Answer me with HTML ${VERSION} — 把 Markdown 内容稿渲染成单文件 HTML 解释页

用法:
  am render <file|->  [-o 输出路径] [--no-open] [--theme blueprint|shadcn]
                      [--template sheet|doc] [--style off|80|strict] [--mode auto|light|dark]
  am lint   <file|->  [--style off|80|strict]     只做 STE 受控写作检查
  am config [set <键> <值> | get <键> | reset [键]] 查看或修改配置
  am list                                         列出模板、主题、组件
  am help [组件名|format]                          查看组件语法 / 稿件格式

- 文件参数写 - 表示从 stdin 读取（适合 heredoc：am render - <<'EOF' ... EOF）。
- 默认输出到 ~/.answer-me-with-html/pages/（可用环境变量 AM_HOME 修改）。
- 默认不自动打开浏览器。需要时显式传 --open；配置与其他默认值用 am config 查看。`;

const FORMAT = `稿件格式（扩展 Markdown）

---
template: sheet        # sheet 图纸板（默认，多面板网格）| doc 线性讲解（单栏 + 目录）
theme: blueprint       # blueprint 图纸风（默认）| shadcn 卡片风；页面内可切换
title: 页面标题         # 也可以用正文第一行 "# 标题" 代替
subtitle: 副标题        # 可选
cols: 3                # sheet 网格列数，默认 3
style: 80              # STE 检查严格度：off | 80（默认，只警告）| strict（不达标不生成）
mode: auto             # auto 跟随系统 | light | dark
source: asd-ste100.org # 其他任意键会显示在页头元信息行
---
导语（可选，显示在标题下方）

## A 面板标题 {span=2 meta="右上角说明"}
普通 Markdown：段落、列表、表格、引用、行内代码……
表格单元格写 ok / no / warn（可跟文字，如 "ok 已批准"）会渲染成 ✓ / ✗ / ! 徽章。

\`\`\`flow LR          ← 围栏块语言名 = 组件名，后面是组件参数
A -> B
\`\`\`

html / svg 围栏块会原样嵌入，可用于自定义布局、图形和交互。页面 CSP 会继续阻止外部网络与外部资源加载。

- "## " 开启一个面板；字母 ID 可省略（自动分配 A、B、C…）。span 让面板跨列。
- 组件列表见 am list；单个组件语法见 am help <组件名>。`;

export async function main(argv, io = {}) {
  const out = io.stdout ?? process.stdout;
  const err = io.stderr ?? process.stderr;
  const env = io.env ?? process.env;
  const print = (s = '') => out.write(`${s}\n`);
  const fail = (s) => err.write(`${s}\n`);

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: 'string', short: 'o' },
        'no-open': { type: 'boolean' },
        open: { type: 'boolean' },
        theme: { type: 'string' },
        template: { type: 'string' },
        style: { type: 'string' },
        mode: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (e) {
    fail(`✗ ${e.message}\n\n${USAGE}`);
    return 2;
  }
  const { values: opts, positionals: [cmd, arg, ...rest] } = parsed;

  if (opts.version) return print(VERSION), 0;
  if (opts.help || !cmd) return print(USAGE), 0;

  switch (cmd) {
    case 'render': return withSource(arg, io, fail, (src) => cmdRender(src, opts, { print, fail, env, cwd: io.cwd }));
    case 'lint': return withSource(arg, io, fail, (src) => cmdLint(src, opts, { print, fail }));
    case 'config': return cmdConfig([arg, ...rest].filter((x) => x !== undefined), { print, fail, env });
    case 'list': return cmdList(print), 0;
    case 'help': return cmdHelp(arg, { print, fail });
    default:
      fail(`✗ 未知命令 "${cmd}"\n\n${USAGE}`);
      return 2;
  }
}

async function withSource(arg, io, fail, fn) {
  if (!arg) {
    fail('✗ 缺少稿件参数：传入文件路径，或用 - 从 stdin 读取');
    return 2;
  }
  let src;
  try {
    src = arg === '-' ? await readStream(io.stdin ?? process.stdin) : readFileSync(resolve(io.cwd ?? process.cwd(), arg), 'utf8');
  } catch (e) {
    fail(`✗ 无法读取稿件：${e.message}`);
    return 2;
  }
  if (!src.trim()) {
    fail('✗ 稿件为空');
    return 2;
  }
  return fn(src);
}

async function readStream(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// 是否自动打开：--open 强制打开 > --no-open > AM_NO_OPEN（非 0）> CI 环境 > 配置 open。
export function shouldOpen(opts, env, config) {
  if (opts.open) return true;
  if (opts['no-open']) return false;
  if (env.AM_NO_OPEN && env.AM_NO_OPEN !== '0') return false;
  if (env.CI) return false;
  return config.open !== false;
}

function cmdRender(src, opts, { print, fail, env, cwd }) {
  const config = readConfig(env);
  if (config.warning) fail(`! ${config.warning}`);
  const { theme, mode, style } = config.values;
  let result;
  try {
    result = renderDoc(src, { theme: opts.theme, template: opts.template, style: opts.style, mode: opts.mode }, { theme, mode, style });
  } catch (e) {
    return reportError(e, fail);
  }
  const file = opts.out
    ? resolve(cwd ?? process.cwd(), opts.out)
    : join(amHome(env), 'pages', `${slug(result.meta.title)}-${stamp()}.html`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, result.html);

  const comps = Object.entries(result.stats.components).map(([k, v]) => `${k}×${v}`).join(' ');
  print(`✓ ${file}`);
  print(`  ${result.meta.template} · ${result.meta.theme} · ${result.stats.panels} 面板${comps ? ` · ${comps}` : ''}`);
  printWarnings(result.warnings, print, result.meta.style);
  if (shouldOpen(opts, env, config.values)) openFile(file);
  return 0;
}

function cmdLint(src, opts, { print, fail }) {
  let doc;
  try {
    doc = parseDoc(src);
  } catch (e) {
    return reportError(e, fail);
  }
  const style = opts.style ?? doc.meta.style;
  if (!CHOICES.style.includes(style)) {
    fail(`✗ style 的值 "${style}" 无效，可选：${CHOICES.style.join(' | ')}`);
    return 2;
  }
  const warnings = style === 'off' ? [] : lintDoc(doc);
  printWarnings(warnings, print, style);
  return style === 'strict' && warnings.length ? 1 : 0;
}

function printWarnings(warnings, print, style) {
  if (style === 'off') return print('  STE 检查已关闭');
  if (!warnings.length) return print('  STE ✓ 0 条警告');
  print(`  STE ${warnings.length} 条警告（修正稿件后重新执行）：`);
  warnings.slice(0, MAX_LISTED_WARNINGS).forEach((w) => print(`  ${formatWarning(w)}`));
  if (warnings.length > MAX_LISTED_WARNINGS) print(`  … 另有 ${warnings.length - MAX_LISTED_WARNINGS} 条，用 am lint 查看全部`);
}

function reportError(e, fail) {
  if (e instanceof RenderError) {
    fail(`✗ L${e.line} [${e.component}] ${e.message}`);
    if (e.example) fail(`  正确示例：\n${e.example.replace(/^/gm, '    ')}`);
    fail(`  完整语法：am help ${e.component}`);
    return 1;
  }
  if (e instanceof ParseError) {
    fail(`✗ ${e.line ? `L${e.line} ` : ''}稿件解析失败：${e.message}`);
    return 1;
  }
  if (e instanceof LintError) {
    fail(`✗ ${e.message}，未生成页面：`);
    e.warnings.forEach((w) => fail(`  ${formatWarning(w)}`));
    return 1;
  }
  throw e;
}

const showValue = (v) => (typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v));

function cmdConfig(args, { print, fail, env }) {
  const [action, key, value] = args;
  try {
    if (action === 'set') {
      if (key === undefined || value === undefined) throw new ConfigError('用法：am config set <键> <值>');
      print(`✓ ${key} = ${showValue(setConfig(key, value, env))}`);
      return 0;
    }
    if (action === 'get') {
      if (!CONFIG_KEYS[key]) throw new ConfigError(`没有配置项 "${key}"。可用：${Object.keys(CONFIG_KEYS).join(' | ')}`);
      print(showValue(readConfig(env).values[key]));
      return 0;
    }
    if (action === 'reset') {
      resetConfig(key, env);
      print(key ? `✓ ${key} 已恢复默认` : '✓ 全部配置已恢复默认');
      return 0;
    }
    if (action !== undefined) throw new ConfigError(`未知操作 "${action}"。用法：am config [set <键> <值> | get <键> | reset [键]]`);
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    fail(`✗ ${e.message}`);
    return 2;
  }
  const { values, stored, warning, path } = readConfig(env);
  if (warning) fail(`! ${warning}`);
  print(`配置文件：${path}`);
  for (const [k, spec] of Object.entries(CONFIG_KEYS)) {
    const mark = k in stored ? '*' : ' ';
    const options = spec.type === 'bool' ? 'on | off' : spec.choices.join(' | ');
    print(`${mark} ${k.padEnd(7)}${showValue(values[k]).padEnd(10)}${spec.label}（${options}）`);
  }
  if (env.AM_NO_OPEN && env.AM_NO_OPEN !== '0') print('注意：环境变量 AM_NO_OPEN 生效中，会覆盖 open 配置。');
  print('* 表示你改过的值。修改：am config set <键> <值>；恢复默认：am config reset [键]');
  return 0;
}

function cmdList(print) {
  print('模板 (template):');
  print('  sheet   图纸板：字母编号面板网格，适合一屏总览（默认）');
  print('  doc     线性讲解：单栏阅读，≥3 个面板时带目录');
  print('\n主题 (theme):');
  for (const [name, t] of Object.entries(THEMES)) print(`  ${name.padEnd(10)}${t.label}`);
  print('\n组件（围栏块语言名）:');
  for (const c of COMPONENTS.values()) print(`  ${c.name.padEnd(10)}${c.summary}`);
  print('  html/svg  原样嵌入（交互可用；外部通信由 CSP 限制）');
  print('\n语法：am help <组件名>；稿件格式：am help format');
}

function cmdHelp(name, { print, fail }) {
  if (!name) return print(USAGE), 0;
  if (name === 'format') return print(FORMAT), 0;
  const comp = COMPONENTS.get(name);
  if (!comp) {
    fail(`✗ 没有组件 "${name}"。可用：${[...COMPONENTS.keys()].join(', ')}, format`);
    return 2;
  }
  print(`${comp.name} — ${comp.summary}\n\n${comp.syntax}\n\n示例：\n${comp.example}`);
  return 0;
}

function slug(title) {
  const s = String(title || 'page').trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s || 'page';
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function openFile(file) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [file]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', file]]
      : ['xdg-open', [file]];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  } catch {
    // 打不开浏览器不影响产物，路径已打印。
  }
}
