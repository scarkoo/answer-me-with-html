// 한국어 controlled writing: 불필요하게 장황한 동사 구조, 우회 표현, 이중 부정을 검사한다.
// 문맥 판단이 필요한 지시어/명사 사슬/용어 일관성은 SKILL.md 작성 규칙으로만 다룬다.

export const KO_VERBOSE_VERBS = Object.freeze([
  {
    re: /([가-힣A-Za-z0-9_-]+)(을|를)\s+(진행|수행|실시)(한다|합니다)/g,
    label: '불필요한 동사 중첩',
    suggest: (m) => `${m[1]}${m[4] === '합니다' ? '합니다' : '한다'}`,
  },
]);

export const KO_INDIRECT = Object.freeze([
  { re: /되어지(?:ㄴ다|는|고|면|게)|되어집니다/g, label: '이중 피동', suggestion: '직접적인 능동/피동 표현으로 바꾼다' },
  { re: /되게\s+(?:된다|됩니다)/g, label: '우회 표현', suggestion: '결과를 직접 서술한다' },
  { re: /[가-힣]+게\s+(?:된다|됩니다)/g, label: '우회 표현', suggestion: '주체와 결과를 직접 서술한다' },
  { re: /하도록\s+(?:한다|합니다)/g, label: '우회 지시', suggestion: '직접 명령형 또는 능동형으로 쓴다' },
]);

export const KO_DOUBLE_NEGATIVES = Object.freeze([
  { re: /않을\s+수\s+없(?:다|습니다)/g, suggestion: '해야 한다 / 반드시 한다처럼 긍정형으로 바꾼다' },
  { re: /불가능하지\s+않(?:다|습니다)/g, suggestion: '가능하다 / 가능합니다로 바꾼다' },
  { re: /실패하지\s+않은\s+경우/g, suggestion: '성공한 경우로 바꾼다' },
]);
