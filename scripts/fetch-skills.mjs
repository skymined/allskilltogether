#!/usr/bin/env node
// Scans the repos listed in data/sources.json for skill-definition files
// (SKILL.md and friends), parses their frontmatter, categorizes them, and
// writes the combined result to data/skills.json.
//
// Usage: node scripts/fetch-skills.mjs
// Auth:  set GITHUB_TOKEN (or GH_TOKEN) to raise the GitHub API rate limit.
//        In GitHub Actions the built-in GITHUB_TOKEN is used automatically.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const API = "https://api.github.com";

function headers(extra = {}) {
  const h = {
    Accept: "application/vnd.github+json",
    "User-Agent": "awesome-claude-codex-skills-crawler",
    ...extra,
  };
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  return h;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function gh(urlPath, extra, attempt = 0) {
  const url = urlPath.startsWith("http") ? urlPath : `${API}${urlPath}`;
  const res = await fetch(url, { headers: headers(extra) });
  if ((res.status === 403 || res.status === 429) && attempt < 3) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    const resetHeader = res.headers.get("x-ratelimit-reset");
    let waitMs = 2000 * (attempt + 1);
    if (remaining === "0" && resetHeader) {
      waitMs = Math.max(waitMs, parseInt(resetHeader, 10) * 1000 - Date.now() + 1000);
    }
    waitMs = Math.min(waitMs, 30000);
    console.warn(`  ! rate limited on ${url} (attempt ${attempt + 1}), waiting ${Math.round(waitMs / 1000)}s...`);
    await sleep(waitMs);
    return gh(urlPath, extra, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status} for ${url}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function ghRaw(repo, branch, filePath, attempt = 0) {
  const url = `https://raw.githubusercontent.com/${repo}/${branch}/${filePath}`;
  const res = await fetch(url, { headers: { "User-Agent": "awesome-claude-codex-skills-crawler" } });
  if (!res.ok) {
    if (res.status >= 500 && attempt < 2) {
      await sleep(1500 * (attempt + 1));
      return ghRaw(repo, branch, filePath, attempt + 1);
    }
    throw new Error(`raw ${res.status} for ${url}`);
  }
  return res.text();
}

// Runs `fn` over `items` with at most `limit` in flight at once.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const current = idx++;
      results[current] = await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Very small YAML front-matter reader: only needs top-level `key: value`
// pairs (name, description, license, ...) from Agent Skill files, which
// never use nested structures for those fields.
function parseFrontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  const lines = m[1].split(/\r?\n/);
  let curKey = null;
  for (const line of lines) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) {
      curKey = kv[1];
      let val = kv[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      out[curKey] = val;
    } else if (curKey && /^\s+\S/.test(line)) {
      // continuation of a folded/multi-line value
      out[curKey] += " " + line.trim();
    }
  }
  return out;
}

// A few source repos ship SKILL.md files with no YAML frontmatter at all
// (spec-noncompliant, but the file is otherwise real content). Fall back to
// the first real paragraph of the markdown body so we don't end up with an
// empty description for those.
function extractBodyFallbackDescription(md) {
  const body = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("**DISCLAIMER")) continue;
    return trimmed.slice(0, 400);
  }
  return "";
}

// Cheap fallback for skills that don't have a curated one-liner yet in
// data/summaries.json (e.g. brand-new skills from a scheduled scan, before
// a human/Claude has run the summarization pass). Strips the common
// "Use this skill when..." framing and takes the first sentence.
function heuristicSummary(description) {
  if (!description) return "";
  let s = description
    .replace(/^Use this skill (whenever|when)\s+(the user wants to\s+)?/i, "")
    .replace(/^Use (whenever|when)\s+(the user|someone)\s+wants to\s+/i, "")
    .replace(/^This skill (helps you |allows you to )?/i, "")
    .trim();
  const firstSentence = s.split(/(?<=[.!?])\s/)[0] || s;
  s = firstSentence.replace(/[.!?]+$/, "").trim();
  if (s.length > 0) s = s[0].toUpperCase() + s.slice(1);
  if (s.length > 90) s = s.slice(0, 87).trim() + "…";
  return s;
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Matches at a word-START boundary only (not a full \b...\b word match), so
// stemmed keywords like "vulnerab" still match "vulnerability" while short
// keywords like "nda" no longer accidentally match inside "standard".
function keywordRegex(kw) {
  return new RegExp(`\\b${escapeRegex(kw)}`, "i");
}

function categorize(rules, overrides, key, name, description) {
  if (overrides[key]) return overrides[key];
  const hay = `${name} ${description}`;
  let best = null;
  let bestScore = 0;
  for (const rule of rules) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (keywordRegex(kw).test(hay)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = rule.category;
    }
  }
  return best || "other";
}

async function listTreeFiles(repo, branch) {
  const data = await gh(`/repos/${repo}/git/trees/${branch}?recursive=1`);
  if (data.truncated) {
    console.warn(`  ! warning: tree for ${repo}@${branch} was truncated by the API`);
  }
  return (data.tree || []).filter((t) => t.type === "blob");
}

async function lastCommitDate(repo, branch, filePath) {
  try {
    const commits = await gh(
      `/repos/${repo}/commits?path=${encodeURIComponent(filePath)}&sha=${branch}&per_page=1`
    );
    if (Array.isArray(commits) && commits[0]) {
      return commits[0].commit?.committer?.date || commits[0].commit?.author?.date || null;
    }
  } catch (e) {
    console.warn(`  ! could not get commit date for ${repo}/${filePath}: ${e.message}`);
  }
  return null;
}

async function repoMeta(repo) {
  try {
    const data = await gh(`/repos/${repo}`);
    return { stars: data.stargazers_count ?? null, pushedAt: data.pushed_at ?? null, description: data.description ?? "" };
  } catch (e) {
    console.warn(`  ! could not get repo metadata for ${repo}: ${e.message}`);
    return { stars: null, pushedAt: null, description: "" };
  }
}

async function processCollection(source, catRules, overrides) {
  const {
    repo,
    branch = "main",
    tool,
    match = ["SKILL.md"],
    exclude = [],
    excludePrefixes = [],
    excludeDotDirs = false,
    includePrefix = null,
  } = source;
  console.log(`Scanning collection ${repo}@${branch} for ${match.join(", ")} ...`);
  const files = await listTreeFiles(repo, branch);
  const hits = files.filter((f) => {
    if (!match.includes(f.path.split("/").pop())) return false;
    if (exclude.includes(f.path)) return false;
    if (excludePrefixes.some((p) => f.path.startsWith(p))) return false;
    if (excludeDotDirs && f.path.split("/")[0].startsWith(".")) return false;
    if (includePrefix && !f.path.startsWith(includePrefix)) return false;
    return true;
  });
  console.log(`  found ${hits.length} match(es)`);

  const meta = await repoMeta(repo);
  const results = await mapLimit(hits, 6, async (hit) => {
    try {
      const raw = await ghRaw(repo, branch, hit.path);
      const fm = parseFrontmatter(raw);
      const name = fm.name || path.basename(path.dirname(hit.path));
      const description = fm.description || extractBodyFallbackDescription(raw);
      const key = `${repo}#${hit.path}`;
      const category = categorize(catRules, overrides, key, name, description);
      const updatedAt = (await lastCommitDate(repo, branch, hit.path)) || meta.pushedAt;
      return {
        id: slugify(`${tool}-${repo}-${hit.path}`),
        name,
        description,
        tool,
        category,
        repo,
        path: hit.path,
        raw_url: `https://raw.githubusercontent.com/${repo}/${branch}/${hit.path}`,
        html_url: `https://github.com/${repo}/blob/${branch}/${hit.path}`,
        repo_url: `https://github.com/${repo}`,
        stars: meta.stars,
        updated_at: updatedAt,
      };
    } catch (e) {
      console.warn(`  ! skipping ${repo}/${hit.path}: ${e.message}`);
      return null;
    }
  });
  return results.filter(Boolean);
}

async function processSingle(source, catRules, overrides) {
  const { repo, branch = "main", tool, path: filePath, category: forcedCategory } = source;
  console.log(`Fetching single skill ${repo}/${filePath} ...`);
  try {
    const raw = await ghRaw(repo, branch, filePath);
    const fm = parseFrontmatter(raw);
    const name = fm.name || source.name || repo.split("/")[1];
    const description = fm.description || source.description || extractBodyFallbackDescription(raw);
    const meta = await repoMeta(repo);
    const key = `${repo}#${filePath}`;
    const category = forcedCategory || categorize(catRules, overrides, key, name, description);
    const updatedAt = (await lastCommitDate(repo, branch, filePath)) || meta.pushedAt;
    return [
      {
        id: slugify(`${tool}-${repo}-${filePath}`),
        name,
        description,
        tool,
        category,
        repo,
        path: filePath,
        raw_url: `https://raw.githubusercontent.com/${repo}/${branch}/${filePath}`,
        html_url: `https://github.com/${repo}/blob/${branch}/${filePath}`,
        repo_url: `https://github.com/${repo}`,
        stars: meta.stars,
        updated_at: updatedAt,
      },
    ];
  } catch (e) {
    console.warn(`  ! skipping single source ${repo}/${filePath}: ${e.message}`);
    return [];
  }
}

async function main() {
  const sources = JSON.parse(await readFile(path.join(DATA_DIR, "sources.json"), "utf8"));
  const categories = JSON.parse(await readFile(path.join(DATA_DIR, "categories.json"), "utf8"));

  let existing = { skills: [] };
  try {
    existing = JSON.parse(await readFile(path.join(DATA_DIR, "skills.json"), "utf8"));
  } catch {
    // first run, no existing file yet
  }

  // Curated one-liners for skill cards (see scripts/README or the
  // summarize-skill-cards workflow). Falls back to a heuristic trim of the
  // raw frontmatter description for anything not yet curated.
  let summaries = {};
  try {
    summaries = JSON.parse(await readFile(path.join(DATA_DIR, "summaries.json"), "utf8"));
  } catch {
    // no curated summaries yet
  }

  const allResults = [];
  for (const source of sources.repos) {
    try {
      if (source.type === "single") {
        allResults.push(...(await processSingle(source, categories.keyword_rules, categories.overrides)));
      } else {
        allResults.push(...(await processCollection(source, categories.keyword_rules, categories.overrides)));
      }
    } catch (e) {
      console.error(`Failed to process source ${source.repo}: ${e.message}`);
    }
  }

  // Keep any manually-curated skills that aren't sourced from a scanned repo
  // (marked with "curated": true) so hand-added entries survive re-runs.
  const curated = (existing.skills || []).filter((s) => s.curated);
  const byId = new Map();
  for (const s of [...curated, ...allResults]) byId.set(s.id, s);
  const merged = [...byId.values()]
    .map((s) => ({ ...s, summary: summaries[s.id] || heuristicSummary(s.description) }))
    .sort((a, b) => {
      const da = a.updated_at ? Date.parse(a.updated_at) : 0;
      const db = b.updated_at ? Date.parse(b.updated_at) : 0;
      return db - da;
    });

  // Only bump generated_at when the actual content changed — otherwise a
  // no-op scheduled run would still produce a commit every day just from
  // the timestamp, and the "last updated" pill would lie about freshness.
  const canonical = (list) => JSON.stringify([...list].sort((a, b) => a.id.localeCompare(b.id)));
  const contentUnchanged =
    canonical(merged) === canonical(existing.skills || []) &&
    JSON.stringify(categories.list) === JSON.stringify(existing.categories || []);
  const generatedAt = process.env.SKILLS_BUILD_TIME || new Date().toISOString();

  const output = {
    generated_at: contentUnchanged && existing.generated_at ? existing.generated_at : generatedAt,
    categories: categories.list,
    count: merged.length,
    skills: merged,
  };

  await writeFile(path.join(DATA_DIR, "skills.json"), JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(
    `\nWrote ${merged.length} skills to data/skills.json` + (contentUnchanged ? " (no content changes)" : "")
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
