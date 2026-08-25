# All Skill Together 🧩

A static website that aggregates Claude and Codex Agent Skills in one place — **browse by category**, and **pick a few and combine them** on the spot. Deployed on GitHub Pages; GitHub Actions rescans the source repos every day and automatically refreshes the skill list and update dates.

## How it works

```
data/sources.json    → GitHub repos to scan (Claude / Codex)
data/categories.json → category definitions + keyword-based auto-classification + manual overrides
data/summaries.json  → curated one-line card summaries, keyed by skill id
scripts/fetch-skills.mjs → scans the repos, parses SKILL.md files, writes data/skills.json
data/skills.json     → the final data the website actually reads (auto-generated — don't edit by hand)
data/combos.json     → curated "recommended combo" bundles shown at the top of the page
index.html / assets/*.js,css → static frontend (no framework, runs straight in the browser)
.github/workflows/update-skills.yml → daily rescan + auto-commit on change
```

- Clicking a skill card fetches the original `SKILL.md` **directly from GitHub raw content** and renders it on the spot (the site never mirrors the content, so it's always the current upstream text).
- Use each card's `+` button to add skills to the **combo tray (🧺)**, then **copy** or **download** them merged into one markdown file — handy when building a new skill or reviewing several at once.
- The **Recommended combos** row at the top surfaces skills that are genuinely bundled together upstream (an official plugin manifest) or discussed together in the community — each card links back to its source so nothing is presented as "trending" without evidence.

## Adding a new skill source

Add an entry to the `repos` array in `data/sources.json`.

```json
{
  "repo": "owner/repo",
  "branch": "main",
  "tool": "claude",
  "type": "collection",
  "match": ["SKILL.md"]
}
```

- `type: "collection"` — walks the whole repo and registers every file whose name is in `match` as a skill (for monorepos).
- `type: "single"` — for a repo that holds exactly one skill. Set `"path"` to the exact file, and optionally `"category"` to force its classification.

If the automatic categorization gets something wrong, add an override to `data/categories.json` under `overrides`, keyed as `"owner/repo#path/to/SKILL.md": "category-id"`.

Once a PR merges, changes are picked up automatically at the next schedule (daily, 03:17 UTC) or via a manual `workflow_dispatch` run.

## Local development

```bash
# Re-scan sources (optional — a GITHUB_TOKEN raises the API rate limit)
GITHUB_TOKEN=$(gh auth token) node scripts/fetch-skills.mjs

# Preview with a static server (fetch() is blocked on file://, so a server is required)
npx serve .
# or: python -m http.server 8080
```

## Deployment

Point GitHub Pages at the `main` branch, `/ (root)` in the repo settings — no build step needed. A `.nojekyll` file is included so the static files are served as-is, without Jekyll processing.
