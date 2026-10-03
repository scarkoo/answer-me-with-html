import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDoc } from '../src/parse.js';
import { lintDoc, splitSentences, sentenceLength, formatWarning } from '../src/lint/ste.js';

const lint = (body) => lintDoc(parseDoc(body));
const rules = (ws) => ws.map((w) => w.rule);

test('splitSentences: 한국어/영어 문장 부호를 처리하고 영어 약어는 보존', () => {
  assert.deepEqual(splitSentences('밸브를 닫습니다. 펌프를 분리합니다! 괜찮습니까?'), ['밸브를 닫습니다.', '펌프를 분리합니다!', '괜찮습니까?']);
  assert.deepEqual(splitSentences('Close the valve. Remove the pump, e.g. the main one.'), ['Close the valve.', 'Remove the pump, e.g. the main one.']);
  assert.deepEqual(splitSentences('Version 3.5 is out.'), ['Version 3.5 is out.']);
});

test('sentenceLength: 한국어는 어절과 공백 제외 문자 수, 영어는 word 수를 센다', () => {
  assert.deepEqual(sentenceLength('설정 값을 지금 저장합니다.'), { lang: 'ko', count: 4, chars: 11 });
  assert.deepEqual(sentenceLength('Close the valve now.'), { lang: 'en', count: 4 });
});

test('한국어 일반 설명은 25어절 또는 공백 제외 90자 초과 시 sentence-length 경고', () => {
  const longWords = Array.from({ length: 26 }, () => '값').join(' ') + '.';
  assert.deepEqual(rules(lint(`## A\n${longWords}`)), ['sentence-length']);

  const longChars = `${'가'.repeat(91)}.`;
  assert.deepEqual(rules(lint(`## A\n${longChars}`)), ['sentence-length']);
});

test('한국어 절차는 18어절 또는 공백 제외 60자 기준을 사용', () => {
  const procedural = Array.from({ length: 19 }, () => '실행').join(' ');
  assert.deepEqual(rules(lint(`## A\n1. ${procedural}`)), ['sentence-length']);
  assert.deepEqual(rules(lint(`## A\n- ${procedural}`)), [], '무순서 목록은 일반 설명 기준을 사용한다');

  const en = Array.from({ length: 21 }, () => 'go').join(' ');
  assert.deepEqual(rules(lint(`## A\n1. ${en}.`)), ['sentence-length']);
});

test('문단은 6문장을 초과하면 paragraph-length 경고', () => {
  const ws = lint(`## A\n하나. 둘. 셋.\n넷. 다섯. 여섯. 일곱.`);
  assert.deepEqual(rules(ws), ['paragraph-length']);
  assert.equal(ws[0].line, 2);
});

test('영어 금지/비추천 단어는 짧은 대체어를 제안', () => {
  const ws = lint('## A\nUtilize the tool prior to the test.');
  assert.deepEqual(ws.map((w) => w.suggestion), ['use', 'before']);
});

test('영어 피동태 휴리스틱', () => {
  assert.deepEqual(rules(lint('## A\nThe valve is closed by the operator.')), ['passive']);
  assert.deepEqual(rules(lint('## A\nThe operator closes the valve.')), []);
});

test('한국어 장황한 동사 중첩을 직접 동사로 제안', () => {
  const ws = lint('## A\n검토를 진행합니다. 테스트를 수행한다.');
  assert.deepEqual(rules(ws), ['word', 'word']);
  assert.deepEqual(ws.map((w) => w.suggestion), ['검토합니다', '테스트한다']);
});

test('한국어 우회 표현을 직접적인 문장으로 바꾸도록 경고', () => {
  const ws = lint('## A\n값이 저장되게 됩니다. 사용하도록 합니다. 결과가 되어집니다.');
  assert.deepEqual(rules(ws), ['indirect', 'indirect', 'indirect']);
});

test('한국어 대표 이중 부정을 긍정형으로 바꾸도록 경고', () => {
  const ws = lint('## A\n이 설정을 사용하지 않을 수 없습니다. 이 동작은 불가능하지 않습니다. 실패하지 않은 경우 계속합니다.');
  assert.deepEqual(rules(ws), ['double-negative', 'double-negative', 'double-negative']);
});

test('중국어 전용 lexical 규칙은 더 이상 적용하지 않는다', () => {
  assert.deepEqual(lint('## A\n我们对接口进行优化。这个步骤至关重要。'), []);
});

test('검사 제외: code, inline code, 취소선 반례, no 상태 표 행, 제목, 일반 컴포넌트', () => {
  const src = `## A
\`\`\`python
utilize = 1
\`\`\`
호출 \`utilize()\` 함수.~~Commence pumping.~~
| 작성 | 상태 |
|---|---|
| Commence pumping. | no |
### Utilize 제목
\`\`\`annot
[Utilize]{!Not approved} the tool.
\`\`\``;
  assert.deepEqual(lint(src), []);
});

test('callout 본문과 일반 표 셀은 검사', () => {
  const ws = lint('## A\n\`\`\`callout warn 주의\nUtilize it.\n\`\`\`\n| a |\n|---|\n| Commence now. |');
  assert.deepEqual(ws.map((w) => [w.line, w.suggestion]), [[3, 'use'], [7, 'start']]);
});

test('intro 도입부도 검사', () => {
  assert.equal(lint('도입부에서 utilize 합니다.\n## A\nx').length, 1);
});

test('formatWarning: 줄 번호 + 규칙 + 메시지 + 제안', () => {
  const s = formatWarning({ line: 4, rule: 'word', message: '권장하지 않는 영어 표현 "utilize"', suggestion: 'use' });
  assert.equal(s, 'L4 [word] 권장하지 않는 영어 표현 "utilize" → use');
});
