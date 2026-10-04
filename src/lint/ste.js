// STE controlled writing 검사.
// 영어와 한국어 원고의 문장 길이, 문단 길이, 장황한 표현, 우회 표현, 대표적인 이중 부정을 검사한다.
// 코드/inline code/취소선 반례/no 상태 표 행/제목/대부분의 컴포넌트는 검사하지 않는다.

import { EN_WORDS } from './wordlist.en.js';
import { KO_VERBOSE_VERBS, KO_INDIRECT, KO_DOUBLE_NEGATIVES } from './wordlist.ko.js';

const LIMITS = {
  en: { procedural: 20, descriptive: 25 },
  ko: {
    procedural: { words: 18, chars: 60 },
    descriptive: { words: 25, chars: 90 },
  },
};
const MAX_SENTENCES = 6;
const ABBR = /\b(e\.g|i\.e|etc|vs|cf|approx|Fig|No)\./gi;
const PASSIVE = /\b(?:am|is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?(\w+ed|known|done|made|given|taken|seen|written|built|shown|sent|kept|held|found|set|put|run|begun|chosen|driven|broken)\b/i;
const EN_RE = Object.entries(EN_WORDS)
  .sort((a, b) => b[0].length - a[0].length)
  .map(([word, suggestion]) => ({ re: new RegExp(`\\b${word.replace(/ /g, '\\s+')}\\b`, 'gi'), word, suggestion }));

export function splitSentences(text) {
  const masked = text.replace(ABBR, (m) => m.replace(/\./g, '\u0000'));
  const parts = masked.match(/[^。！？!?;]+?(?:[。！？!?;]+|\.(?=\s|$)|$)|[^.]+?\.(?=\s|$)/g) ?? [];
  return parts.map((s) => s.replace(/\u0000/g, '.').trim()).filter(Boolean);
}

function koreanCharCount(sentence) {
  return [...sentence].filter((ch) => /[가-힣A-Za-z0-9]/.test(ch)).length;
}

function koreanWordCount(sentence) {
  return sentence
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/^[^가-힣A-Za-z0-9]+|[^가-힣A-Za-z0-9]+$/g, ''))
    .filter(Boolean).length;
}

export function sentenceLength(sentence) {
  const hangul = sentence.match(/[가-힣]/g)?.length ?? 0;
  if (hangul >= 2) {
    return { lang: 'ko', count: koreanWordCount(sentence), chars: koreanCharCount(sentence) };
  }
  const words = sentence.match(/[A-Za-z0-9][\w'’-]*/g)?.length ?? 0;
  return { lang: 'en', count: words };
}

export function formatWarning(w) {
  return `L${w.line} [${w.rule}] ${w.message}${w.suggestion ? ` → ${w.suggestion}` : ''}`;
}

export function lintDoc(doc) {
  const warnings = [];
  const blocks = [...doc.intro, ...doc.panels.flatMap((p) => p.blocks)];
  for (const b of blocks) {
    if (b.type === 'md') lintMarkdown(b.text, b.line, warnings);
    else if (b.lang === 'callout') lintMarkdown(b.text, b.line + 1, warnings);
  }
  return warnings;
}

function clean(text) {
  return text
    .replace(/~~[^~]*~~/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_]{1,3}/g, '');
}

function lintMarkdown(text, startLine, out) {
  let para = null;
  const flush = () => {
    if (para && para.count > MAX_SENTENCES) {
      out.push({ line: para.line, rule: 'paragraph-length', message: `문단 ${para.count}문장 (상한 ${MAX_SENTENCES})` });
    }
    para = null;
  };

  let inHtml = false;
  text.split('\n').forEach((raw, i) => {
    const line = startLine + i;
    const t = raw.trim();
    if (/^<(div|svg|table|details|figure)/i.test(t)) inHtml = true;
    if (inHtml) {
      if (/<\/(div|svg|table|details|figure)>\s*$/i.test(t)) inHtml = false;
      return flush();
    }
    if (!t || /^#{1,6}\s/.test(t) || /^[-*_]{3,}$/.test(t)) return flush();

    if (t.startsWith('|')) {
      flush();
      if (/^\|?[\s:|-]+\|?$/.test(t)) return;
      const cells = t.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (cells.some((c) => /^(no|✗|✘)(\s|$)/.test(c))) return;
      cells.forEach((c) => checkUnit(clean(c.replace(/^(ok|warn|✓|✔|⚠)(\s|$)/, '')), line, 'descriptive', out));
      return;
    }

    const list = t.match(/^(?:([-*+])|(\d+)[.)])\s+(.*)$/);
    if (list) {
      flush();
      checkUnit(clean(list[3]), line, list[2] ? 'procedural' : 'descriptive', out);
      return;
    }

    const body = clean(t.replace(/^>\s*/, ''));
    const n = checkUnit(body, line, 'descriptive', out);
    if (!para) para = { line, count: 0 };
    para.count += n;
  });
  flush();
}

function checkKoreanStyle(text, line, out) {
  const warnings = [];

  for (const item of KO_VERBOSE_VERBS) {
    for (const m of text.matchAll(item.re)) {
      warnings.push({
        index: m.index,
        rule: 'word',
        message: `장황한 표현 "${m[0]}" (${item.label})`,
        suggestion: item.suggest(m),
      });
    }
  }

  for (const item of KO_INDIRECT) {
    for (const m of text.matchAll(item.re)) {
      warnings.push({
        index: m.index,
        rule: 'indirect',
        message: `우회 표현 "${m[0]}" (${item.label})`,
        suggestion: item.suggestion,
      });
    }
  }

  for (const item of KO_DOUBLE_NEGATIVES) {
    for (const m of text.matchAll(item.re)) {
      warnings.push({
        index: m.index,
        rule: 'double-negative',
        message: `이중 부정 "${m[0]}"`,
        suggestion: item.suggestion,
      });
    }
  }

  out.push(...warnings.sort((a, b) => a.index - b.index).map(({ index, ...w }) => ({ line, ...w })));
}

// 목록 항목, 표 셀, 문단의 한 줄을 검사하고 문장 수를 반환한다.
function checkUnit(text, line, kind, out) {
  const sentences = splitSentences(text);

  for (const s of sentences) {
    const metrics = sentenceLength(s);
    if (metrics.lang === 'ko') {
      const limit = LIMITS.ko[kind];
      if (metrics.count > limit.words || metrics.chars > limit.chars) {
        const preview = s.length > 32 ? `${s.slice(0, 32)}…` : s;
        out.push({
          line,
          rule: 'sentence-length',
          message: `${kind === 'procedural' ? '절차' : '문장'} ${metrics.count}어절 / ${metrics.chars}자 (상한 ${limit.words}어절 · 공백 제외 ${limit.chars}자): "${preview}"`,
        });
      }
    } else {
      const limit = LIMITS.en[kind];
      if (metrics.count > limit) {
        const preview = s.length > 32 ? `${s.slice(0, 32)}…` : s;
        out.push({
          line,
          rule: 'sentence-length',
          message: `${kind === 'procedural' ? '절차' : '문장'} ${metrics.count} words (상한 ${limit}): "${preview}"`,
        });
      }
      if (PASSIVE.test(s)) {
        out.push({
          line,
          rule: 'passive',
          message: `영어 피동 표현 "${s.match(PASSIVE)[0]}"`,
          suggestion: '능동태로 바꾼다',
        });
      }
    }
  }

  const lexical = EN_RE.flatMap(({ re, suggestion }) =>
    [...text.matchAll(re)].map((m) => ({
      index: m.index,
      rule: 'word',
      message: `권장하지 않는 영어 표현 "${m[0]}"`,
      suggestion,
    })),
  );
  out.push(...lexical.sort((a, b) => a.index - b.index).map(({ index, ...w }) => ({ line, ...w })));

  if (/[가-힣]/.test(text)) checkKoreanStyle(text, line, out);
  return sentences.length;
}
