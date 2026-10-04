import { test } from 'node:test';
import assert from 'node:assert/strict';
import { md, mdInline, parseSourceRef, vscodeSourceHref } from '../src/markdown.js';
import { renderDoc } from '../src/render.js';

test('source link: 상대경로 + line/column을 vscode://file URI로 변환', () => {
  assert.equal(
    vscodeSourceHref('apps/server/src/routes/assets.ts:123:4', '/Users/scarkoo/projects/visket'),
    'vscode://file/Users/scarkoo/projects/visket/apps/server/src/routes/assets.ts:123:4',
  );
  assert.equal(
    vscodeSourceHref('apps/server/src/routes/assets.ts:123', '/Users/scarkoo/projects/visket'),
    'vscode://file/Users/scarkoo/projects/visket/apps/server/src/routes/assets.ts:123:1',
  );
});

test('source link: GitHub 스타일 #LlineCcolumn도 허용', () => {
  assert.deepEqual(parseSourceRef('apps/server/src/routes/assets.ts#L81C3'), {
    file: 'apps/server/src/routes/assets.ts',
    line: 81,
    column: 3,
  });
});

test('source link: 공백과 특수문자가 있는 경로를 URI 인코딩', () => {
  assert.equal(
    vscodeSourceHref('src/My File #1.ts:9', '/workspace/project'),
    'vscode://file/workspace/project/src/My%20File%20%231.ts:9:1',
  );
});

test('source link: 절대경로와 workspace 밖 경로는 거부', () => {
  assert.equal(vscodeSourceHref('/etc/passwd:1', '/workspace/project'), null);
  assert.equal(vscodeSourceHref('../secret.ts:1', '/workspace/project'), null);
  assert.equal(vscodeSourceHref('file:///etc/passwd:1', '/workspace/project'), null);
});

test('markdown source: canonical 값은 상대경로로 보존하고 href만 절대 VS Code URI로 변환', () => {
  const html = md('[assets.ts:81](source:apps/server/src/routes/assets.ts:81)', {
    cwd: '/Users/scarkoo/projects/visket',
  });
  assert.match(html, /class="am-source-link"/);
  assert.match(html, /href="vscode:\/\/file\/Users\/scarkoo\/projects\/visket\/apps\/server\/src\/routes\/assets\.ts:81:1"/);
  assert.match(html, /data-source-ref="apps\/server\/src\/routes\/assets\.ts:81"/);
});

test('markdown source: workspace context가 없거나 밖을 가리키면 비활성 span으로 렌더링', () => {
  assert.match(mdInline('[x](source:../secret.ts:2)', { cwd: '/workspace/project' }), /am-source-link--invalid/);
  assert.doesNotMatch(mdInline('[x](source:../secret.ts:2)', { cwd: '/workspace/project' }), /vscode:\/\/file/);
  assert.match(mdInline('[x](source:src/x.ts:2)'), /am-source-link--invalid/);
});

test('renderDoc: 일반 Markdown과 callout source link 모두 workspace cwd를 사용', () => {
  const src = [
    '## A 코드',
    '[assets.ts:81](source:apps/server/src/routes/assets.ts:81)',
    '',
    '```callout info 구현',
    '[issues.ts:214](source:apps/server/src/jira/issues.ts:214)',
    '```',
  ].join('\n');
  const { html } = renderDoc(src, {}, {}, { cwd: '/Users/scarkoo/projects/visket' });
  assert.equal((html.match(/class="am-source-link"/g) || []).length, 2);
  assert.match(html, /vscode:\/\/file\/Users\/scarkoo\/projects\/visket\/apps\/server\/src\/jira\/issues\.ts:214:1/);
});
