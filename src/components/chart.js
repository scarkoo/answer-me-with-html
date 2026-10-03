// CSV 기반 bar / line / scatter 차트. Node에서 CSV와 좌표를 계산해 순수 SVG로 렌더링한다.
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { esc, measure, wrap } from '../svg/text.js';
import { f, svgOpen, textLines } from '../svg/shapes.js';
import { ComponentError } from './error.js';

const TYPES = new Set(['bar', 'line', 'scatter']);
const OPTIONS = new Set(['x', 'y', 'series', 'unit', 'title', 'min', 'max', 'src']);
const MAX_ROWS = 2000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const COLORS = 5;

export default {
  name: 'chart',
  summary: 'CSV 수치 비교 / 추세 / 상관관계 차트',
  syntax: `\`\`\`chart <bar|line|scatter> [src="relative/path.csv"]
x: x축 컬럼
y: y축 컬럼
series: 그룹 컬럼 또는 wide CSV의 값 컬럼들(쉼표 구분, 선택)
unit: 단위(선택)
title: 차트 제목(선택)
min: y축 최소값(선택)
max: y축 최대값(선택)
---
x,series,y
A,방법1,10
A,방법2,20
\`\`\`
- inline CSV는 --- 아래에 쓴다.
- src는 현재 workspace 기준 상대경로만 허용한다.
- series가 CSV의 한 컬럼명이면 long-form, 여러 값 컬럼명이면 wide-form으로 처리한다.`,
  example: '```chart bar\\nx: method\\ny: time_s\\nunit: s\\ntitle: 처리 시간\\n---\\nmethod,time_s\\nDirect HTML,46\\nSkill,13\\n```',
  render(text, ctx = {}) {
    const spec = parseChart(text, ctx.args ?? '');
    const csvText = spec.src ? readWorkspaceCsv(spec.src, ctx.cwd) : spec.csv;
    const rows = parseCsv(csvText);
    return `<figure class="am-diagram am-chart am-chart--${spec.type}">${renderChart(spec, rows)}</figure>`;
  },
};

export function parseChart(text, args = '') {
  const argTokens = parseArgs(args);
  const type = (argTokens.shift() ?? '').toLowerCase();
  if (!TYPES.has(type)) throw new ComponentError('chart 첫 인수는 bar | line | scatter 중 하나여야 한다', 1);

  const argOptions = {};
  for (const token of argTokens) {
    const m = token.match(/^([\w-]+)=(.*)$/);
    if (!m) throw new ComponentError(`chart 인수를 해석할 수 없다: "${token}"`, 1);
    argOptions[m[1]] = unquote(m[2]);
  }

  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const sep = lines.findIndex((line) => line.trim() === '---');
  const optionLines = sep >= 0 ? lines.slice(0, sep) : lines;
  const csv = sep >= 0 ? lines.slice(sep + 1).join('\n').trim() : '';
  const options = { ...argOptions };

  for (let i = 0; i < optionLines.length; i++) {
    const raw = optionLines[i].trim();
    if (!raw || raw.startsWith('//')) continue;
    const m = raw.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!m) {
      if (sep < 0) throw new ComponentError('inline CSV 앞에는 --- 구분선이 필요하다', i + 1);
      throw new ComponentError(`chart 옵션은 key: value 형식이어야 한다: "${raw}"`, i + 1);
    }
    options[m[1]] = unquote(m[2].trim());
  }

  for (const key of Object.keys(options)) {
    if (!OPTIONS.has(key)) throw new ComponentError(`지원하지 않는 chart 옵션: ${key}`, 1);
  }
  if (!options.x) throw new ComponentError('chart에는 x: 컬럼이 필요하다', 1);
  if (!options.y && !options.series) throw new ComponentError('chart에는 y: 컬럼 또는 wide series: 컬럼 목록이 필요하다', 1);
  if (!options.src && !csv) throw new ComponentError('chart에는 inline CSV 또는 src가 필요하다', 1);
  if (options.src && csv) throw new ComponentError('chart는 src와 inline CSV를 동시에 사용할 수 없다', 1);

  const min = parseBound(options.min, 'min');
  const max = parseBound(options.max, 'max');
  if (min !== undefined && max !== undefined && min >= max) throw new ComponentError('chart min은 max보다 작아야 한다', 1);

  return {
    type,
    x: options.x,
    y: options.y || '',
    series: options.series || '',
    unit: options.unit || '',
    title: options.title || '',
    src: options.src || '',
    min,
    max,
    csv,
  };
}

function parseArgs(args) {
  const out = [];
  const re = /(?:[^\s"']+|"[^"]*"|'[^']*')+/g;
  for (const m of String(args).matchAll(re)) out.push(m[0]);
  return out;
}

function unquote(value) {
  return /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
}

function parseBound(value, name) {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ComponentError(`chart ${name}은 숫자여야 한다`, 1);
  return n;
}

export function parseCsv(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  const matrix = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.trim());
      cell = '';
      if (row.some((v) => v !== '')) matrix.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  if (quoted) throw new ComponentError('CSV 따옴표가 닫히지 않았다', 1);
  row.push(cell.trim());
  if (row.some((v) => v !== '')) matrix.push(row);
  if (matrix.length < 2) throw new ComponentError('CSV에는 헤더와 데이터가 필요하다', 1);
  if (matrix.length - 1 > MAX_ROWS) throw new ComponentError(`CSV 행 수는 최대 ${MAX_ROWS}개까지 지원한다`, 1);

  const headers = matrix[0];
  if (!headers.length || headers.some((h) => !h)) throw new ComponentError('CSV 헤더에 빈 컬럼명이 있다', 1);
  if (new Set(headers).size !== headers.length) throw new ComponentError('CSV 헤더 컬럼명은 중복될 수 없다', 1);

  return matrix.slice(1).map((values, rowIndex) => {
    if (values.length !== headers.length) throw new ComponentError(`CSV ${rowIndex + 2}행의 컬럼 수가 헤더와 다르다`, rowIndex + 2);
    return Object.fromEntries(headers.map((h, i) => [h, values[i]]));
  });
}

export function readWorkspaceCsv(src, cwd) {
  if (!cwd) throw new ComponentError('src CSV를 읽으려면 workspace 경로가 필요하다', 1);
  if (isAbsolute(src) || /^[a-z]+:/i.test(src)) throw new ComponentError('chart src는 workspace 기준 상대경로만 허용한다', 1);
  if (!/\.csv$/i.test(src)) throw new ComponentError('chart src는 .csv 파일이어야 한다', 1);

  let root;
  let file;
  try {
    root = realpathSync(resolve(cwd));
    file = realpathSync(resolve(root, src));
  } catch {
    throw new ComponentError(`chart CSV 파일을 찾을 수 없다: ${src}`, 1);
  }
  const rel = relative(root, file);
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) {
    throw new ComponentError('chart src는 workspace 밖의 파일을 읽을 수 없다', 1);
  }
  if (statSync(file).size > MAX_FILE_BYTES) throw new ComponentError('chart CSV 파일은 2MB 이하여야 한다', 1);
  return readFileSync(file, 'utf8');
}

function renderChart(spec, rows) {
  if (!rows.length) throw new ComponentError('chart CSV에 데이터 행이 없다', 1);
  const headers = new Set(Object.keys(rows[0]));
  if (!headers.has(spec.x)) throw new ComponentError(`CSV에 x 컬럼 "${spec.x}"이 없다`, 1);

  const seriesList = resolveSeries(spec, headers);
  if (spec.type === 'scatter') return renderScatter(spec, rows, seriesList);
  return renderCategorical(spec, rows, seriesList);
}

function resolveSeries(spec, headers) {
  if (!spec.series) {
    if (!headers.has(spec.y)) throw new ComponentError(`CSV에 y 컬럼 "${spec.y}"이 없다`, 1);
    return [{ key: '', label: spec.y, y: spec.y }];
  }

  const requested = spec.series.split(',').map((s) => s.trim()).filter(Boolean);
  if (requested.length === 1 && headers.has(requested[0]) && spec.y) {
    if (!headers.has(spec.y)) throw new ComponentError(`CSV에 y 컬럼 "${spec.y}"이 없다`, 1);
    return { groupBy: requested[0], y: spec.y };
  }

  const wide = requested.length ? requested : [];
  if (!wide.length) throw new ComponentError('series 옵션이 비어 있다', 1);
  for (const key of wide) if (!headers.has(key)) throw new ComponentError(`CSV에 series 컬럼 "${key}"이 없다`, 1);
  return wide.map((key) => ({ key, label: key, y: key }));
}

function numeric(value, column, row) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ComponentError(`CSV ${row + 2}행 "${column}" 값은 숫자여야 한다: "${value}"`, row + 2);
  return n;
}

function normalizeCategorical(spec, rows, seriesDef) {
  const categories = [];
  const seen = new Set();
  for (const row of rows) {
    const x = row[spec.x];
    if (!seen.has(x)) {
      seen.add(x);
      categories.push(x);
    }
  }

  if (Array.isArray(seriesDef)) {
    const series = seriesDef.map((s) => ({ ...s, values: new Map() }));
    rows.forEach((row, i) => {
      for (const s of series) {
        if (s.values.has(row[spec.x])) throw new ComponentError(`x "${row[spec.x]}"가 중복됐다. 반복 측정은 별도 x 값으로 구분한다`, i + 2);
        s.values.set(row[spec.x], numeric(row[s.y], s.y, i));
      }
    });
    return { categories, series };
  }

  const labels = [];
  const labelSet = new Set();
  for (const row of rows) {
    const label = row[seriesDef.groupBy];
    if (!labelSet.has(label)) {
      labelSet.add(label);
      labels.push(label);
    }
  }
  const series = labels.map((label) => ({ key: label, label, y: seriesDef.y, values: new Map() }));
  rows.forEach((row, i) => {
    const s = series.find((item) => item.label === row[seriesDef.groupBy]);
    if (s.values.has(row[spec.x])) throw new ComponentError(`x/series 조합이 중복됐다: ${row[spec.x]} / ${s.label}`, i + 2);
    s.values.set(row[spec.x], numeric(row[seriesDef.y], seriesDef.y, i));
  });
  return { categories, series };
}

function renderCategorical(spec, rows, seriesDef) {
  const { categories, series } = normalizeCategorical(spec, rows, seriesDef);
  const values = series.flatMap((s) => [...s.values.values()]);
  const yMin = spec.min ?? Math.min(0, ...values);
  const yMax = spec.max ?? Math.max(0, ...values);
  if (yMax === yMin) return renderEmptyRange(spec, categories.length);
  const ticks = niceTicks(yMin, yMax, 5);

  const width = Math.max(680, categories.length * Math.max(78, series.length * 34));
  const titleH = spec.title ? 28 : 4;
  const legendH = series.length > 1 ? 28 : 4;
  const margin = { left: 62, right: 20, top: 18 + titleH + legendH, bottom: 62 };
  const plotW = width - margin.left - margin.right;
  const plotH = 280;
  const height = margin.top + plotH + margin.bottom;
  const xStep = plotW / Math.max(categories.length, 1);
  const y = (v) => margin.top + plotH - ((v - ticks.min) / (ticks.max - ticks.min)) * plotH;
  const zeroY = y(Math.max(ticks.min, Math.min(ticks.max, 0)));

  const grid = ticks.values.map((v) => {
    const py = y(v);
    return `<line class="am-chart-grid" x1="${f(margin.left)}" y1="${f(py)}" x2="${f(width - margin.right)}" y2="${f(py)}"/><text class="am-chart-axis-label" x="${f(margin.left - 9)}" y="${f(py)}" text-anchor="end" dominant-baseline="central">${esc(formatValue(v, spec.unit))}</text>`;
  }).join('');

  const xLabels = categories.map((label, i) => {
    const cx = margin.left + xStep * (i + 0.5);
    const lines = wrap(label, Math.max(52, xStep - 8), 11).slice(0, 2);
    return textLines(lines, cx, margin.top + plotH + 24, 13, ' class="am-chart-axis-label"');
  }).join('');

  const marks = spec.type === 'bar'
    ? renderBars(spec, categories, series, margin, plotH, xStep, y, zeroY)
    : renderLines(spec, categories, series, margin, xStep, y);

  const title = spec.title ? `<text class="am-chart-title" x="${f(margin.left)}" y="18">${esc(spec.title)}</text>` : '';
  const legend = series.length > 1 ? renderLegend(series, margin.left, 18 + titleH) : '';
  const axis = `<line class="am-chart-axis" x1="${f(margin.left)}" y1="${f(zeroY)}" x2="${f(width - margin.right)}" y2="${f(zeroY)}"/>`;

  return `${svgOpen(width, height, spec.title || `${spec.type} chart`)}${title}${legend}${grid}${axis}${marks}${xLabels}</svg>`;
}

function renderBars(spec, categories, series, margin, plotH, xStep, y, zeroY) {
  const groupW = Math.min(xStep * 0.72, 80);
  const barW = Math.max(4, groupW / Math.max(series.length, 1) - 3);
  return categories.map((category, i) => {
    const center = margin.left + xStep * (i + 0.5);
    return series.map((s, si) => {
      if (!s.values.has(category)) return '';
      const value = s.values.get(category);
      const py = y(value);
      const top = Math.min(py, zeroY);
      const h = Math.max(1, Math.abs(zeroY - py));
      const x = center - groupW / 2 + si * (barW + 3);
      const tip = `${category} · ${s.label}: ${formatValue(value, spec.unit)}`;
      return `<rect class="am-chart-bar am-chart-series-${si % COLORS}" x="${f(x)}" y="${f(top)}" width="${f(barW)}" height="${f(h)}" rx="2" data-label="${esc(tip)}"><title>${esc(tip)}</title></rect>`;
    }).join('');
  }).join('');
}

function renderLines(spec, categories, series, margin, xStep, y) {
  return series.map((s, si) => {
    const pts = categories.map((category, i) => s.values.has(category)
      ? { category, value: s.values.get(category), x: margin.left + xStep * (i + 0.5) }
      : null).filter(Boolean);
    const path = pts.length > 1
      ? `<polyline class="am-chart-line am-chart-series-${si % COLORS}" points="${pts.map((p) => `${f(p.x)},${f(y(p.value))}`).join(' ')}"/>`
      : '';
    const dots = pts.map((p) => {
      const tip = `${p.category} · ${s.label}: ${formatValue(p.value, spec.unit)}`;
      return `<circle class="am-chart-point am-chart-series-${si % COLORS}" cx="${f(p.x)}" cy="${f(y(p.value))}" r="4" data-label="${esc(tip)}"><title>${esc(tip)}</title></circle>`;
    }).join('');
    return path + dots;
  }).join('');
}

function renderScatter(spec, rows, seriesDef) {
  if (!spec.y) throw new ComponentError('scatter에는 y: 컬럼이 필요하다', 1);
  const headers = new Set(Object.keys(rows[0]));
  if (!headers.has(spec.y)) throw new ComponentError(`CSV에 y 컬럼 "${spec.y}"이 없다`, 1);

  let groups;
  if (Array.isArray(seriesDef)) {
    if (seriesDef.length > 1 || seriesDef[0].y !== spec.y) throw new ComponentError('scatter의 wide series는 지원하지 않는다. series에는 그룹 컬럼 하나를 사용한다', 1);
    groups = [{ label: spec.y, rows }];
  } else {
    const labels = [];
    const map = new Map();
    for (const row of rows) {
      const label = row[seriesDef.groupBy];
      if (!map.has(label)) { map.set(label, []); labels.push(label); }
      map.get(label).push(row);
    }
    groups = labels.map((label) => ({ label, rows: map.get(label) }));
  }

  const points = [];
  groups.forEach((g, gi) => g.rows.forEach((row, i) => {
    points.push({ group: g.label, gi, x: numeric(row[spec.x], spec.x, i), y: numeric(row[spec.y], spec.y, i) });
  }));
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xTicks = niceTicks(Math.min(...xs), Math.max(...xs), 5);
  const yTicks = niceTicks(spec.min ?? Math.min(...ys), spec.max ?? Math.max(...ys), 5);
  const width = 720;
  const titleH = spec.title ? 28 : 4;
  const legendH = groups.length > 1 ? 28 : 4;
  const margin = { left: 64, right: 24, top: 18 + titleH + legendH, bottom: 54 };
  const plotW = width - margin.left - margin.right;
  const plotH = 290;
  const height = margin.top + plotH + margin.bottom;
  const sx = (v) => margin.left + ((v - xTicks.min) / (xTicks.max - xTicks.min || 1)) * plotW;
  const sy = (v) => margin.top + plotH - ((v - yTicks.min) / (yTicks.max - yTicks.min || 1)) * plotH;

  const gridY = yTicks.values.map((v) => `<line class="am-chart-grid" x1="${margin.left}" y1="${f(sy(v))}" x2="${width - margin.right}" y2="${f(sy(v))}"/><text class="am-chart-axis-label" x="${margin.left - 9}" y="${f(sy(v))}" text-anchor="end" dominant-baseline="central">${esc(formatValue(v, spec.unit))}</text>`).join('');
  const ticksX = xTicks.values.map((v) => `<line class="am-chart-grid am-chart-grid--v" x1="${f(sx(v))}" y1="${margin.top}" x2="${f(sx(v))}" y2="${margin.top + plotH}"/><text class="am-chart-axis-label" x="${f(sx(v))}" y="${margin.top + plotH + 22}" text-anchor="middle">${esc(formatNumber(v))}</text>`).join('');
  const dots = points.map((p) => {
    const tip = `${p.group}: ${spec.x}=${formatNumber(p.x)}, ${spec.y}=${formatValue(p.y, spec.unit)}`;
    return `<circle class="am-chart-point am-chart-series-${p.gi % COLORS}" cx="${f(sx(p.x))}" cy="${f(sy(p.y))}" r="4.5" data-label="${esc(tip)}"><title>${esc(tip)}</title></circle>`;
  }).join('');
  const title = spec.title ? `<text class="am-chart-title" x="${margin.left}" y="18">${esc(spec.title)}</text>` : '';
  const legend = groups.length > 1 ? renderLegend(groups, margin.left, 18 + titleH) : '';
  return `${svgOpen(width, height, spec.title || 'scatter chart')}${title}${legend}${gridY}${ticksX}<line class="am-chart-axis" x1="${margin.left}" y1="${margin.top + plotH}" x2="${width - margin.right}" y2="${margin.top + plotH}"/>${dots}</svg>`;
}

function renderLegend(series, x, y) {
  let cursor = x;
  return series.map((s, i) => {
    const label = s.label ?? s.key ?? '';
    const w = measure(label, 11) + 32;
    const out = `<g class="am-chart-legend am-chart-series-${i % COLORS}" transform="translate(${f(cursor)} ${f(y)})"><rect x="0" y="-8" width="12" height="12" rx="2"/><text x="18" y="-2" dominant-baseline="central">${esc(label)}</text></g>`;
    cursor += w;
    return out;
  }).join('');
}

function niceTicks(min, max, count) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, values: [0, 1] };
  if (min === max) {
    const pad = Math.abs(min || 1) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / Math.max(count - 1, 1);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const frac = raw / pow;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  const step = nice * pow;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const values = [];
  for (let v = lo, guard = 0; v <= hi + step * 1e-9 && guard < 20; v += step, guard++) values.push(round(v));
  return { min: round(lo), max: round(hi), values };
}

function renderEmptyRange(spec, categoryCount) {
  const width = Math.max(680, categoryCount * 78);
  return `${svgOpen(width, 180, spec.title || 'chart')}<text class="am-chart-empty" x="${width / 2}" y="90" text-anchor="middle">모든 값이 동일합니다.</text></svg>`;
}

function round(n) {
  return Math.round(n * 1e9) / 1e9;
}

function formatNumber(n) {
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${round(n / 1e9)}B`;
  if (abs >= 1e6) return `${round(n / 1e6)}M`;
  if (abs >= 1e3) return `${round(n / 1e3)}K`;
  return String(round(n));
}

function formatValue(n, unit) {
  const value = formatNumber(n);
  return unit ? `${value} ${unit}` : value;
}
