#!/usr/bin/env node
// Regenerates the stats line and category table in README.md from
// data/skills.json, between marker comments. Run after fetch-skills.mjs.
// Safe to run repeatedly — it only touches the marked regions.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SITE_URL = "https://skymined.github.io/awesome-claude-codex-skills/";

function replaceBetween(content, startMarker, endMarker, replacement) {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Markers ${startMarker} / ${endMarker} not found in README.md`);
  }
  return content.slice(0, start + startMarker.length) + "\n" + replacement + "\n" + content.slice(end);
}

async function main() {
  const data = JSON.parse(await readFile(path.join(ROOT, "data", "skills.json"), "utf8"));
  const sources = JSON.parse(await readFile(path.join(ROOT, "data", "sources.json"), "utf8"));
  let readme = await readFile(path.join(ROOT, "README.md"), "utf8");

  const repoCount = sources.repos.length;
  const skillCount = data.skills.length;
  const claudeCount = data.skills.filter((s) => s.tool === "claude").length;
  const codexCount = data.skills.filter((s) => s.tool === "codex").length;
  const syncedDate = data.generated_at ? new Date(data.generated_at).toISOString().slice(0, 10) : "unknown";

  const statsLine =
    `**${skillCount.toLocaleString()} skills** (${claudeCount.toLocaleString()} Claude · ${codexCount.toLocaleString()} Codex) ` +
    `from **${repoCount} source repos**, rescanned automatically every day. Last synced: ${syncedDate}.`;
  readme = replaceBetween(readme, "<!-- STATS:START -->", "<!-- STATS:END -->", statsLine);

  const counts = new Map();
  for (const s of data.skills) counts.set(s.category, (counts.get(s.category) || 0) + 1);
  const rows = data.categories
    .map((c) => ({ ...c, count: counts.get(c.id) || 0 }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((c) => `| ${c.icon} ${c.en} | ${c.count} | [Browse →](${SITE_URL}?category=${c.id}) |`)
    .join("\n");
  const table = `| Category | Skills | |\n| --- | ---: | --- |\n${rows}`;
  readme = replaceBetween(readme, "<!-- CATEGORY_TABLE:START -->", "<!-- CATEGORY_TABLE:END -->", table);

  await writeFile(path.join(ROOT, "README.md"), readme, "utf8");
  console.log(`Updated README.md stats + category table (${skillCount} skills, ${rows.split("\n").length} categories).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
