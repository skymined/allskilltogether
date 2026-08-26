#!/usr/bin/env node
// Re-applies the category rules in data/categories.json AND the curated
// summaries in data/summaries.json to the skills already in
// data/skills.json, without re-fetching anything from GitHub. Useful
// right after editing keyword_rules/overrides or merging new summaries.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
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

// Finer-grained classification within one top-level category (e.g.
// "stocks" -> "technical-analysis"). Returns null if the category has no
// defined subcategories, or nothing scored a match.
function subcategorize(subcategoryConfig, categoryId, overrides, key, name, description) {
  const conf = subcategoryConfig[categoryId];
  if (!conf) return null;
  if (overrides[key]) return overrides[key];
  const hay = `${name} ${description}`;
  let best = null;
  let bestScore = 0;
  for (const rule of conf.keyword_rules) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (keywordRegex(kw).test(hay)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = rule.subcategory;
    }
  }
  return best;
}

function flattenSubcategories(subcategoryConfig) {
  const out = [];
  for (const [parent, conf] of Object.entries(subcategoryConfig || {})) {
    for (const item of conf.list) out.push({ ...item, parent });
  }
  return out;
}

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

async function main() {
  const categories = JSON.parse(await readFile(path.join(DATA_DIR, "categories.json"), "utf8"));
  const data = JSON.parse(await readFile(path.join(DATA_DIR, "skills.json"), "utf8"));
  let summaries = {};
  try {
    summaries = JSON.parse(await readFile(path.join(DATA_DIR, "summaries.json"), "utf8"));
  } catch {
    // no curated summaries yet
  }

  const before = JSON.stringify(data.skills);

  let changed = 0;
  for (const s of data.skills) {
    const key = `${s.repo}#${s.path}`;
    const next = categorize(categories.keyword_rules, categories.overrides, key, s.name, s.description);
    if (next !== s.category) changed++;
    s.category = next;
    s.subcategory = subcategorize(
      categories.subcategories || {},
      next,
      categories.subcategory_overrides || {},
      key,
      s.name,
      s.description
    );
    s.summary = summaries[s.id] || heuristicSummary(s.description);
  }
  data.categories = categories.list;
  data.subcategories = flattenSubcategories(categories.subcategories);

  // Same freshness-timestamp rule as fetch-skills.mjs: only bump generated_at
  // when something actually changed (category/subcategory/summary reshuffle
  // counts as a real change — visitors browsing by category see it).
  if (JSON.stringify(data.skills) !== before) {
    data.generated_at = process.env.SKILLS_BUILD_TIME || new Date().toISOString();
  }

  await writeFile(path.join(DATA_DIR, "skills.json"), JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`Recategorized ${data.skills.length} skills, ${changed} category changes; summaries reapplied.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
