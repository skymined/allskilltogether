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

  // One collapsible <details> block per category that has subcategories,
  // in the same most-skills-first order as the main table, each listing
  // its subcategory chips as deep links (?category=X&subcategory=Y).
  const subcounts = new Map();
  for (const s of data.skills) {
    if (!s.subcategory) continue;
    const k = `${s.category}::${s.subcategory}`;
    subcounts.set(k, (subcounts.get(k) || 0) + 1);
  }
  const catsWithSubs = data.categories
    .map((c) => ({ ...c, count: counts.get(c.id) || 0 }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count)
    .filter((c) => (data.subcategories || []).some((sc) => sc.parent === c.id));

  const sections = catsWithSubs
    .map((c) => {
      const subs = (data.subcategories || [])
        .filter((sc) => sc.parent === c.id)
        .map((sc) => ({ ...sc, count: subcounts.get(`${c.id}::${sc.id}`) || 0 }))
        .filter((sc) => sc.count > 0)
        .sort((a, b) => b.count - a.count)
        .map((sc) => `- ${sc.en} (${sc.count}) → [Browse →](${SITE_URL}?category=${c.id}&subcategory=${sc.id})`)
        .join("\n");
      return `<details>\n<summary>${c.icon} ${c.en}</summary>\n\n${subs}\n\n</details>`;
    })
    .join("\n\n");
  readme = replaceBetween(readme, "<!-- SUBCATEGORY_SECTIONS:START -->", "<!-- SUBCATEGORY_SECTIONS:END -->", sections);

  await writeFile(path.join(ROOT, "README.md"), readme, "utf8");
  console.log(
    `Updated README.md stats + category table (${skillCount} skills, ${rows.split("\n").length} categories, ${catsWithSubs.length} with subcategories).`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
