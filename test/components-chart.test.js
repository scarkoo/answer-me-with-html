import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMPONENTS, ComponentError } from '../src/components/index.js';
import { parseCsv, parseChart, readWorkspaceCsv } from '../src/components/chart.js';

const chart = COMPONENTS.get('chart');
const render = (text, args = 'bar', cwd) => chart.render(text, { args, cwd, uid: () => 'u1' });
const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

test('chart: CSV parser는 quoted comma와 escaped quote를 처리', () => {
  const rows = parseCsv('name,value\n"A, B",10\n"He said ""go""",20');
  assert.deepEqual(rows, [
    { name: 'A, B', value: '10' },
    { name: 'He said "go"', value: '20' },
  ]);
});

test('chart: inline bar chart를 순수 SVG로 렌더링', () => {
  const html = render('x: method\ny: time_s\nunit: s\ntitle: 처리 시간\n---\nmethod,time_s\nDirect HTML,46\nSkill,13');
  assert.match(html, /^<figure class="am-diagram am-chart am-chart--bar">/);
  assert.match(html, /<svg /);
  assert.equal((html.match(/class="am-chart-bar /g) || []).length, 2);
  assert.match(html, /Direct HTML · time_s: 46 s/);
  assert.doesNotMatch(html, /<script|(?:src|href)=["']https?:\/\//);
});

test('chart: long-form series는 grouped bar로 렌더링', () => {
  const html = render('x: topic\ny: time_s\nseries: method\n---\ntopic,method,time_s\nTCP,Direct,46\nTCP,Skill,13\nRedis,Direct,41\nRedis,Skill,12');
  assert.equal((html.match(/class="am-chart-bar /g) || []).length, 4);
  assert.match(html, />Direct<\/text>/);
  assert.match(html, />Skill<\/text>/);
});

test('chart: wide-form series도 지원', () => {
  const html = render('x: topic\nseries: direct,skill\n---\ntopic,direct,skill\nTCP,46,13\nRedis,41,12');
  assert.equal((html.match(/class="am-chart-bar /g) || []).length, 4);
  assert.match(html, />direct<\/text>/);
  assert.match(html, />skill<\/text>/);
});

test('chart: line과 scatter를 렌더링', () => {
  const line = render('x: version\ny: ms\n---\nversion,ms\n0.1,58\n0.2,51\n0.3,47', 'line');
  assert.match(line, /am-chart--line/);
  assert.match(line, /<polyline class="am-chart-line /);

  const scatter = render('x: input\ny: latency\nseries: model\n---\ninput,latency,model\n100,12,A\n200,18,A\n100,9,B\n200,14,B', 'scatter');
  assert.match(scatter, /am-chart--scatter/);
  assert.equal((scatter.match(/class="am-chart-point /g) || []).length, 4);
});

test('chart: min/max와 잘못된 숫자를 검증', () => {
  assert.throws(() => parseChart('x: a\ny: b\nmin: 10\nmax: 5\n---\na,b\nx,1', 'bar'), ComponentError);
  assert.throws(() => render('x: a\ny: b\n---\na,b\nx,nope'), ComponentError);
});

test('chart: workspace 내부 상대경로 CSV를 읽는다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-chart-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'bench'), { recursive: true });
  writeFileSync(join(dir, 'bench', 'results.csv'), 'method,time_s\nDirect,46\nSkill,13');

  const html = render('x: method\ny: time_s', 'bar src="bench/results.csv"', dir);
  assert.equal((html.match(/class="am-chart-bar /g) || []).length, 2);
  assert.equal(readWorkspaceCsv('bench/results.csv', dir).includes('Direct,46'), true);
});

test('chart: workspace 밖 src와 절대경로를 차단', () => {
  const root = mkdtempSync(join(tmpdir(), 'am-chart-root-'));
  const outside = mkdtempSync(join(tmpdir(), 'am-chart-out-'));
  dirs.push(root, outside);
  writeFileSync(join(outside, 'outside.csv'), 'x,y\na,1');

  assert.throws(() => readWorkspaceCsv(join(outside, 'outside.csv'), root), /상대경로/);
  assert.throws(() => readWorkspaceCsv('../outside.csv', root), /찾을 수 없다|workspace 밖/);
});

test('chart: src와 inline CSV를 동시에 쓰지 못한다', () => {
  assert.throws(
    () => parseChart('x: method\ny: time_s\n---\nmethod,time_s\nSkill,13', 'bar src="bench/results.csv"'),
    /동시에/,
  );
});


test('chart: 범례는 interactive series toggle 메타데이터를 출력', () => {
  const html = render('x: topic\ny: time\nseries: method\n---\ntopic,method,time\nA,Direct,46\nA,Skill,13');
  assert.equal((html.match(/data-chart-legend/g) || []).length, 2);
  assert.match(html, /data-chart-legend data-chart-series="0" role="button" tabindex="0" aria-pressed="true"/);
  assert.match(html, /data-chart-mark data-chart-series="0"/);
  assert.match(html, /data-chart-mark data-chart-series="1"/);
});

test('chart: legend 위치와 off 옵션을 지원', () => {
  assert.equal(parseChart('x: a\ny: b\nlegend: bottom\n---\na,b\nx,1', 'bar').legend, 'bottom');
  assert.equal(parseChart('x: a\ny: b\nlegend: off\n---\na,b\nx,1', 'bar').legend, 'off');
  assert.throws(() => parseChart('x: a\ny: b\nlegend: left\n---\na,b\nx,1', 'bar'), /legend/);

  const off = render('x: topic\ny: time\nseries: method\nlegend: off\n---\ntopic,method,time\nA,Direct,46\nA,Skill,13');
  assert.doesNotMatch(off, /data-chart-legend/);
});

test('chart: 긴 x축 라벨은 자동 줄바꿈/말줄임하고 전체 텍스트를 title에 보존', () => {
  const short = render('x: name\ny: value\n---\nname,value\nShort,10');
  const longLabel = '이것은 매우 긴 벤치마크 시나리오 이름이며 여러 단어로 구성되어 세 줄을 넘는 경우에도 전체 이름을 잃지 않아야 합니다';
  const long = render(`x: name\ny: value\nx-label: Benchmark scenario with an intentionally long axis title\n---\nname,value\n"${longLabel}",10`);
  const hShort = Number(short.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)[1]);
  const hLong = Number(long.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)[1]);
  assert.ok(hLong > hShort, `short=${hShort} long=${hLong}`);
  assert.match(long, new RegExp(`<title>${longLabel}</title>`));
  assert.match(long, /…/);
  assert.match(long, /class="am-chart-axis-title"/);
});

test('chart: 긴 y tick/unit과 y축 제목에 맞춰 왼쪽 여백을 자동 확장', () => {
  const short = render('x: name\ny: value\nunit: ms\n---\nname,value\nA,100');
  const long = render('x: name\ny: value\nunit: milliseconds-per-request-with-long-unit\ny-label: Extremely long latency measurement axis title that should stay readable\n---\nname,value\nA,100');
  const xShort = Number(short.match(/class="am-chart-grid" x1="([\d.]+)"/)[1]);
  const xLong = Number(long.match(/class="am-chart-grid" x1="([\d.]+)"/)[1]);
  assert.ok(xLong > xShort, `short=${xShort} long=${xLong}`);
  assert.match(long, /rotate\(-90/);
  assert.match(long, /Extremely long latency measurement axis title/);
});
