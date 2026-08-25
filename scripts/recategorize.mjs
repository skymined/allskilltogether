#!/usr/bin/env node
// Re-applies the category rules in data/categories.json to the skills
// already in data/skills.json, without re-fetching anything from GitHub.
// Useful right after editing keyword_rules/overrides.
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

async function main() {
  const categories = JSON.parse(await readFile(path.join(DATA_DIR, "categories.json"), "utf8"));
  const data = JSON.parse(await readFile(path.join(DATA_DIR, "skills.json"), "utf8"));

  let changed = 0;
  for (const s of data.skills) {
    const key = `${s.repo}#${s.path}`;
    const next = categorize(categories.keyword_rules, categories.overrides, key, s.name, s.description);
    if (next !== s.category) changed++;
    s.category = next;
  }
  data.categories = categories.list;

  await writeFile(path.join(DATA_DIR, "skills.json"), JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`Recategorized ${data.skills.length} skills, ${changed} changed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
