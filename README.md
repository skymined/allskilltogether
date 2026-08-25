# All Skill Together 🧩

Claude와 Codex의 Agent Skill을 한곳에 모아, **분야별로 탐색**하고 **원하는 것을 골라 바로 조합**해볼 수 있는 정적 웹사이트입니다. GitHub Pages로 배포되며, GitHub Actions가 매일 소스 저장소를 다시 스캔해 최신 스킬 목록과 업데이트 날짜를 자동으로 반영합니다.

## 어떻게 동작하나요

```
data/sources.json   → 스캔할 GitHub 저장소 목록 (Claude / Codex)
data/categories.json→ 분야(카테고리) 정의 + 자동 분류 키워드 규칙 + 수동 오버라이드
scripts/fetch-skills.mjs → 저장소를 스캔해 SKILL.md(등)을 파싱하고 data/skills.json 생성
data/skills.json    → 웹사이트가 실제로 읽는 최종 데이터 (자동 생성됨, 직접 수정 X)
index.html / assets/*.js,css → 정적 프론트엔드 (프레임워크 없음, 브라우저에서 바로 실행)
.github/workflows/update-skills.yml → 매일 자동 재수집 + 변경 시 자동 커밋
```

- 각 스킬 카드를 클릭하면 원본 `SKILL.md`를 **GitHub raw content에서 직접 가져와** 그 자리에서 렌더링합니다 (사이트에 내용을 복제해두지 않기 때문에 항상 최신 원문입니다).
- 카드의 `+` 버튼으로 여러 스킬을 **조합함(🧺)**에 담고, 하나의 마크다운으로 합쳐서 **복사** 또는 **다운로드**할 수 있습니다. 새 스킬을 만들거나 여러 스킬을 함께 검토할 때 참고 자료로 쓰기 좋습니다.

## 새 스킬 저장소 추가하기

`data/sources.json`의 `repos` 배열에 항목을 추가하세요.

```json
{
  "repo": "owner/repo",
  "branch": "main",
  "tool": "claude",
  "type": "collection",
  "match": ["SKILL.md"]
}
```

- `type: "collection"` — 저장소 전체를 훑어서 파일명이 `match`에 포함된 파일을 모두 스킬로 등록합니다 (모노레포용).
- `type: "single"` — 저장소 하나가 스킬 하나일 때 씁니다. `"path"`로 정확한 파일 경로를 지정하고, 필요하면 `"category"`로 분류를 직접 지정할 수 있습니다.

카테고리 자동 분류가 마음에 안 들면 `data/categories.json`의 `overrides`에 `"owner/repo#path/to/SKILL.md": "category-id"` 형식으로 추가하세요.

PR을 보내면 병합 후 다음 스케줄(매일 03:17 UTC) 또는 워크플로 수동 실행(`workflow_dispatch`) 때 자동으로 반영됩니다.

## 로컬 개발

```bash
# 데이터 다시 수집 (선택 사항 — GITHUB_TOKEN 있으면 API 제한 완화)
GITHUB_TOKEN=$(gh auth token) node scripts/fetch-skills.mjs

# 정적 서버로 미리보기 (fetch()가 파일 프로토콜에서 막히므로 서버 필요)
npx serve .
# 또는: python -m http.server 8080
```

## 배포

GitHub Pages를 저장소 설정에서 `main` 브랜치 `/ (root)`로 지정하면 별도 빌드 없이 그대로 서빙됩니다. `.nojekyll` 파일이 포함되어 있어 Jekyll 처리 없이 정적 파일 그대로 배포됩니다.
