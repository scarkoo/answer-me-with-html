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
  assert.doesNotMatch(html, /<script|https?:\/\//);
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
