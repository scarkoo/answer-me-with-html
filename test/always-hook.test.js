import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => JSON.parse(readFileSync(`${ROOT}/${p}`, 'utf8'));

test('always 插件：hook 输出合法的 UserPromptSubmit additionalContext', () => {
  const r = spawnSync(process.execPath, [`${ROOT}/plugins/answer-me-with-html-always/hooks/remind.mjs`], {
    input: '{"prompt":"讲讲 TCP"}', encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(out.hookSpecificOutput.additionalContext, /^\[answer-me-with-html always-on\]/);
  assert.ok(out.hookSpecificOutput.additionalContext.length < 600, '提醒要短，每轮都会注入');
});

test('always 插件：hooks.json 指向存在的脚本，marketplace 已登记', () => {
  const hooks = read('plugins/answer-me-with-html-always/hooks/hooks.json');
  const cmd = hooks.hooks.UserPromptSubmit[0].hooks[0];
  assert.equal(cmd.command, 'node');
  assert.equal(cmd.args[0], '${CLAUDE_PLUGIN_ROOT}/hooks/remind.mjs');
  const names = read('.claude-plugin/marketplace.json').plugins.map((p) => p.name);
  assert.deepEqual(names, ['answer-me-with-html', 'answer-me-with-html-always']);
});

test('Codex SKILL.md 不依赖 Claude always-on reminder', () => {
  const skill = readFileSync(`${ROOT}/skills/answer-me-with-html/SKILL.md`, 'utf8');
  assert.doesNotMatch(skill, /\[answer-me-with-html always-on\]/);
  assert.doesNotMatch(skill, /CLAUDE_SKILL_DIR/);
  assert.match(skill, /CODEX_HOME/);
});

test('always 插件：提醒要求 --no-open，不弹浏览器', () => {
  const r = spawnSync(process.execPath, [`${ROOT}/plugins/answer-me-with-html-always/hooks/remind.mjs`], { encoding: 'utf8' });
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /--no-open/);
});

test('always 插件：配置 always=off 时不注入提醒；配置损坏时照常注入', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const home = mkdtempSync(`${tmpdir()}/am-always-`);
  const run = () => spawnSync(process.execPath, [`${ROOT}/plugins/answer-me-with-html-always/hooks/remind.mjs`], {
    encoding: 'utf8', env: { ...process.env, AM_HOME: home },
  });
  try {
    assert.match(run().stdout, /always-on/, '无配置文件时默认开启');
    writeFileSync(`${home}/config.json`, JSON.stringify({ always: false }));
    const off = run();
    assert.equal(off.status, 0);
    assert.equal(off.stdout, '');
    writeFileSync(`${home}/config.json`, '{ broken');
    assert.match(run().stdout, /always-on/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
