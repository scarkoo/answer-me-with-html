---
name: answer-me-with-html
description: 복잡한 설명을 한 페이지 HTML로 시각화하는 Codex용 skill. 모델은 확장 Markdown 내용만 작성하고, 포함된 CLI가 레이아웃·다이어그램·단일 HTML 생성을 담당한다. 3개 이상의 연관 개념, 흐름/프로토콜/아키텍처, 다차원 비교, 계층 구조, 타임라인처럼 시각화가 이해에 도움이 될 때 사용한다. 짧은 답변, 즉시 실행할 명령, 순수 코드 수정, 사용자가 텍스트만 요구한 경우에는 사용하지 않는다.
---

# Answer me with HTML — Codex

복잡한 답변을 직접 HTML/CSS/SVG로 작성하지 않는다. **확장 Markdown 내용만 만들고 bundled CLI로 렌더링한다.**

## 1. 언제 사용할지

다음 중 하나면 HTML 페이지가 유용한지 우선 판단한다.

- 서로 연결된 개념이 3개 이상이다.
- 프로세스, 프로토콜, 호출 체인, 상태 전이, 아키텍처를 설명한다.
- 3개 이상의 기준으로 비교하거나 trade-off를 설명한다.
- 디렉터리/모듈/분류 같은 계층 구조가 있다.
- 시간에 따른 단계나 변화를 설명한다.
- 사용자가 시각화, 다이어그램, HTML 설명을 명시적으로 요청한다.

200자 안팎으로 충분한 짧은 답변, 순수 명령 출력, 코드 패치 자체가 목적이면 일반 텍스트를 사용한다.

## 2. Codex에서 CLI 실행

기본 전역 설치 경로는 다음과 같다.

```bash
AM="${CODEX_HOME:-$HOME/.codex}/skills/answer-me-with-html/scripts/am.mjs"
```

해당 경로가 없으면 **현재 로드한 이 SKILL.md의 디렉터리 기준으로 `scripts/am.mjs`의 절대 경로를 찾는다.** 현재 프로젝트의 working directory를 skill 경로라고 가정하지 않는다.

Node.js 20+가 필요하다. 기본 설정은 브라우저를 자동으로 열지 않는다.

````bash
node "$AM" render - --no-open <<'AM_EOF'
---
title: 제목
---
## A 핵심
```callout info 결론
핵심 내용을 짧게 쓴다.
```
AM_EOF
````

렌더 결과:

- `✓ <path>`: 성공. 최종 답변에 핵심 결론과 생성된 경로를 남긴다.
- `✗ L<line> [component] ...`: 안내된 줄만 수정하고 다시 렌더링한다.
- `STE n warnings`: 가능하면 문장을 고쳐 한 번 더 렌더링한다. 최대 2회까지만 재시도한다.

사용자가 명시적으로 브라우저 열기를 원할 때만 `--open`을 사용한다.

## 3. 설정

자연어 요청은 다음 명령으로 변환한다.

```bash
node "$AM" config
node "$AM" config set open off
node "$AM" config set theme shadcn
node "$AM" config reset theme
```

주요 설정은 `open`, `theme`, `mode`, `style`이다.

## 4. 문서 형식

````markdown
---
template: sheet
theme: blueprint
title: 페이지 제목
subtitle: 한 줄 설명
cols: 3
---
한두 문장의 핵심 결론.

## A 패널 제목 {span=2 meta="보조 정보"}
일반 Markdown, 표, 목록을 사용한다.

```flow LR
A -> B: 호출
B -> C: 결과
```
````

- `sheet`: 여러 패널을 한눈에 보는 기본 레이아웃.
- `doc`: 긴 설명을 순서대로 읽는 레이아웃.
- 한 패널에는 한 가지 질문만 담는다.
- 보통 3~8개 패널 안에서 끝낸다.
- 가장 중요한 결론을 먼저 배치한다.

### 보안 제약

- raw `html` / `svg` fence는 실행 가능한 마크업으로 삽입되지 않고 코드로 escape된다.
- 일반 Markdown에 포함된 raw HTML도 escape된다.
- 외부 스크립트/스타일/폰트/네트워크 요청은 생성 페이지의 CSP로 제한한다.
- 이 제한을 우회하려고 HTML 이벤트 핸들러나 `javascript:` URL을 만들지 않는다.

## 5. 컴포넌트 선택

| 정보 형태 | 컴포넌트 |
|---|---|
| 아키텍처, 호출 관계, 분기 | `flow [LR]` |
| 참여자 간 시간 순 메시지 | `sequence [num]` |
| 디렉터리, 모듈, 분류 | `tree [list]` |
| 역사, 단계, 릴리스 | `timeline [v]` |
| 수치와 상한 비교 | `limits` |
| 문장/코드 조각 주석 | `annot` |
| 키-값 메타 정보 | `kv [cols=2]` |
| 결론/주의/경고 | `callout info|ok|warn|err` |
| 다차원 비교 | Markdown 표 |

정확한 문법이 필요하면 `node "$AM" list`, `node "$AM" help <component>`, `node "$AM" help format`을 사용한다.

## 6. 문장 규칙

- 한 문장에는 한 가지 핵심만 담는다.
- 복잡한 내용은 문단보다 목록을 쓴다.
- 같은 개념은 같은 용어로 부른다.
- 수치를 만들지 않는다. 예시 수치는 명확히 예시라고 표시한다.
- STE 경고가 의미 있으면 문장을 단순화한다.
