(() => {
  "use strict";

  const state = {
    skills: [],
    categories: [],
    subcategories: [],
    generatedAt: null,
    tool: "all",
    activeCats: new Set(),
    activeSubcats: new Set(),
    query: "",
    sort: "updated",
    tray: new Set(),
  };

  const contentCache = new Map(); // raw_url -> markdown text

  const el = (sel, root = document) => root.querySelector(sel);
  const els = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---- persistence for the combine tray ---------------------------------
  function loadTray() {
    try {
      const raw = localStorage.getItem("ast:tray");
      if (raw) JSON.parse(raw).forEach((id) => state.tray.add(id));
    } catch {}
  }
  function saveTray() {
    try {
      localStorage.setItem("ast:tray", JSON.stringify([...state.tray]));
    } catch {}
  }

  // ---- data loading -------------------------------------------------------
  async function loadData() {
    const res = await fetch("data/skills.json", { cache: "no-store" });
    const data = await res.json();
    state.skills = data.skills || [];
    state.categories = data.categories || [];
    state.subcategories = data.subcategories || [];
    state.generatedAt = data.generated_at || null;
  }

  async function loadCombos() {
    try {
      const res = await fetch("data/combos.json", { cache: "no-store" });
      if (!res.ok) return [];
      const data = await res.json();
      return data.combos || [];
    } catch {
      return [];
    }
  }

  async function fetchContent(skill) {
    if (contentCache.has(skill.raw_url)) return contentCache.get(skill.raw_url);
    const res = await fetch(skill.raw_url);
    if (!res.ok) throw new Error(`Couldn't load content (${res.status})`);
    const text = await res.text();
    contentCache.set(skill.raw_url, text);
    return text;
  }

  // ---- tiny, safe markdown renderer ---------------------------------------
  // Escapes everything first, then wraps text in whitelisted tags only —
  // no raw HTML from the source ever reaches innerHTML.
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderMarkdownLite(md) {
    // strip frontmatter block
    const body = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
    const lines = escapeHtml(body).split(/\r?\n/);
    let html = "";
    let inCode = false;
    let listOpen = false;

    const closeList = () => {
      if (listOpen) {
        html += "</ul>";
        listOpen = false;
      }
    };

    for (const line of lines) {
      if (line.startsWith("```")) {
        if (!inCode) {
          html += "<pre><code>";
          inCode = true;
        } else {
          html += "</code></pre>";
          inCode = false;
        }
        continue;
      }
      if (inCode) {
        html += line + "\n";
        continue;
      }
      const h = line.match(/^(#{1,3})\s+(.*)$/);
      if (h) {
        closeList();
        const level = h[1].length;
        html += `<h${level}>${inline(h[2])}</h${level}>`;
        continue;
      }
      const li = line.match(/^[-*]\s+(.*)$/);
      if (li) {
        if (!listOpen) {
          html += "<ul>";
          listOpen = true;
        }
        html += `<li>${inline(li[1])}</li>`;
        continue;
      }
      closeList();
      if (line.trim() === "") continue;
      html += `<p>${inline(line)}</p>`;
    }
    closeList();
    if (inCode) html += "</code></pre>";
    return html;

    function inline(s) {
      return s
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*]+)\*/g, "<em>$1</em>");
    }
  }

  // ---- formatting -----------------------------------------------------
  function formatDate(iso) {
    if (!iso) return "Date unknown";
    const d = new Date(iso);
    if (isNaN(d)) return "Date unknown";
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days <= 0) return "Updated today";
    if (days === 1) return "Updated yesterday";
    if (days < 30) return `Updated ${days}d ago`;
    return "Updated " + d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }

  function categoryMeta(id) {
    return state.categories.find((c) => c.id === id) || { id, en: id, icon: "✨" };
  }

  function cardDesc(skill) {
    return skill.summary || skill.description || "(no description)";
  }

  // ---- rendering: chips -------------------------------------------------
  function renderChips() {
    const wrap = el("#category-chips");
    wrap.innerHTML = "";
    for (const cat of state.categories) {
      const count = state.skills.filter((s) => s.category === cat.id).length;
      if (count === 0) continue;
      const btn = document.createElement("button");
      btn.className = "chip" + (state.activeCats.has(cat.id) ? " active" : "");
      btn.textContent = `${cat.icon} ${cat.en} (${count})`;
      btn.addEventListener("click", () => {
        if (state.activeCats.has(cat.id)) state.activeCats.delete(cat.id);
        else state.activeCats.add(cat.id);
        // Subcategories only make sense scoped to exactly one active
        // top-level category — clear them whenever that stops being true.
        if (state.activeCats.size !== 1) state.activeSubcats.clear();
        renderChips();
        renderSubcategoryChips();
        renderBoard();
      });
      wrap.appendChild(btn);
    }
    renderSubcategoryChips();
  }

  function renderSubcategoryChips() {
    const wrap = el("#subcategory-chips");
    if (!wrap) return;
    wrap.innerHTML = "";
    if (state.activeCats.size !== 1) {
      wrap.hidden = true;
      return;
    }
    const [catId] = state.activeCats;
    const subs = state.subcategories.filter((sc) => sc.parent === catId);
    if (subs.length === 0) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    for (const sub of subs) {
      const count = state.skills.filter((s) => s.category === catId && s.subcategory === sub.id).length;
      if (count === 0) continue;
      const btn = document.createElement("button");
      btn.className = "chip chip-sub" + (state.activeSubcats.has(sub.id) ? " active" : "");
      btn.textContent = `${sub.en} (${count})`;
      btn.addEventListener("click", () => {
        if (state.activeSubcats.has(sub.id)) state.activeSubcats.delete(sub.id);
        else state.activeSubcats.add(sub.id);
        renderSubcategoryChips();
        renderBoard();
      });
      wrap.appendChild(btn);
    }
  }

  // ---- rendering: board -------------------------------------------------
  function getFiltered() {
    const q = state.query.trim().toLowerCase();
    let list = state.skills.filter((s) => {
      if (state.tool !== "all" && s.tool !== state.tool) return false;
      if (state.activeCats.size > 0 && !state.activeCats.has(s.category)) return false;
      if (state.activeSubcats.size > 0 && !state.activeSubcats.has(s.subcategory)) return false;
      if (q) {
        const hay = `${s.name} ${s.description} ${s.summary || ""} ${s.repo}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    list = list.slice().sort((a, b) => {
      if (state.sort === "name") return a.name.localeCompare(b.name);
      if (state.sort === "stars") return (b.stars || 0) - (a.stars || 0);
      const da = a.updated_at ? Date.parse(a.updated_at) : 0;
      const db = b.updated_at ? Date.parse(b.updated_at) : 0;
      return db - da;
    });
    return list;
  }

  function cardTemplate(skill) {
    const cat = categoryMeta(skill.category);
    const added = state.tray.has(skill.id);
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <div class="card-top">
        <div class="badge-row">
          <span class="badge badge-${skill.tool}">${skill.tool}</span>
          <span class="badge badge-cat">${cat.icon} ${cat.en}</span>
        </div>
        <button class="add-btn${added ? " added" : ""}" title="Add/remove from combo tray" aria-label="Add to combo tray">${added ? "✓" : "+"}</button>
      </div>
      <h3></h3>
      <p class="desc"></p>
      <div class="card-foot">
        <span class="repo"></span>
        <span class="updated"></span>
      </div>
    `;
    el("h3", card).textContent = skill.name;
    el(".desc", card).textContent = cardDesc(skill);
    el(".repo", card).textContent = skill.repo;
    el(".updated", card).textContent = formatDate(skill.updated_at);

    el(".add-btn", card).addEventListener("click", (e) => {
      e.stopPropagation();
      toggleTray(skill.id);
      const btn = e.currentTarget;
      const isAdded = state.tray.has(skill.id);
      btn.classList.toggle("added", isAdded);
      btn.textContent = isAdded ? "✓" : "+";
      btn.setAttribute("aria-label", isAdded ? "Remove from combo tray" : "Add to combo tray");
    });

    card.addEventListener("click", () => openDrawer(skill));
    return card;
  }

  function renderBoard() {
    const board = el("#board");
    if (!board) return; // no-op on pages without a skill board (e.g. combos.html)
    const list = getFiltered();
    board.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const skill of list) frag.appendChild(cardTemplate(skill));
    board.appendChild(frag);

    el("#result-count").textContent = `${list.length} skill${list.length === 1 ? "" : "s"}`;
    el("#empty-state").hidden = list.length !== 0;
  }

  // ---- drawer (detail view) ----------------------------------------------
  function openDrawer(skill) {
    const drawer = el("#drawer");
    const body = el("#drawer-body");
    const cat = categoryMeta(skill.category);
    const added = state.tray.has(skill.id);
    body.innerHTML = `
      <div class="detail-badges">
        <span class="badge badge-${skill.tool}">${skill.tool}</span>
        <span class="badge badge-cat">${cat.icon} ${cat.en}</span>
      </div>
      <h2 class="detail-title" id="drawer-title"></h2>
      <p class="detail-desc"></p>
      <dl class="detail-meta">
        <dt>Repo</dt><dd></dd>
        <dt>Path</dt><dd></dd>
        <dt>Updated</dt><dd></dd>
        <dt>Stars</dt><dd></dd>
      </dl>
      <div class="detail-actions">
        <a class="btn" target="_blank" rel="noopener" href="${escapeHtml(skill.html_url)}">View source on GitHub ↗</a>
        <button class="btn btn-primary" id="drawer-add">${added ? "Remove from combo tray" : "🧺 Add to combo tray"}</button>
      </div>
      <div class="detail-body"><p class="detail-loading">Loading skill content…</p></div>
    `;
    el(".detail-title", body).textContent = skill.name;
    el(".detail-desc", body).textContent = cardDesc(skill);
    const dds = els(".detail-meta dd", body);
    dds[0].textContent = skill.repo;
    dds[1].textContent = skill.path;
    dds[2].textContent = formatDate(skill.updated_at);
    dds[3].textContent = skill.stars != null ? `⭐ ${skill.stars}` : "—";

    const addBtn = el("#drawer-add", body);
    addBtn.addEventListener("click", () => {
      toggleTray(skill.id);
      const isAdded = state.tray.has(skill.id);
      addBtn.textContent = isAdded ? "Remove from combo tray" : "🧺 Add to combo tray";
      renderBoard();
    });

    drawer.setAttribute("aria-hidden", "false");

    fetchContent(skill)
      .then((md) => {
        el(".detail-body", body).innerHTML = renderMarkdownLite(md);
      })
      .catch((err) => {
        el(".detail-body", body).innerHTML = `<p class="detail-loading">Couldn't load content: ${escapeHtml(err.message)}. Check the GitHub link instead.</p>`;
      });
  }

  function closeDrawer() {
    el("#drawer").setAttribute("aria-hidden", "true");
  }

  // ---- combine tray ------------------------------------------------------
  function toggleTray(id) {
    if (state.tray.has(id)) state.tray.delete(id);
    else state.tray.add(id);
    saveTray();
    updateTrayUI();
  }

  function addManyToTray(ids) {
    let anyAdded = false;
    for (const id of ids) {
      if (!state.skills.some((s) => s.id === id)) continue;
      if (!state.tray.has(id)) anyAdded = true;
      state.tray.add(id);
    }
    saveTray();
    updateTrayUI();
    return anyAdded;
  }

  function updateTrayUI() {
    const tray = el("#tray");
    const count = state.tray.size;
    el("#tray-count").textContent = String(count);
    tray.hidden = count === 0;
  }

  function renderCombineModal() {
    const list = el("#combine-list");
    list.innerHTML = "";
    const items = [...state.tray]
      .map((id) => state.skills.find((s) => s.id === id))
      .filter(Boolean);

    if (items.length === 0) {
      list.innerHTML = `<p class="combine-empty">Nothing in your tray yet. Use the + button on any card to add one.</p>`;
      return;
    }

    for (const skill of items) {
      const row = document.createElement("div");
      row.className = "combine-item";
      row.innerHTML = `
        <div>
          <div class="ci-name">${escapeHtml(skill.name)} <span class="badge badge-${skill.tool}" style="margin-left:6px">${skill.tool}</span></div>
          <div class="ci-sub">${escapeHtml(skill.repo)}</div>
        </div>
        <button aria-label="Remove">✕</button>
      `;
      el("button", row).addEventListener("click", () => {
        toggleTray(skill.id);
        renderCombineModal();
        renderBoard();
      });
      list.appendChild(row);
    }
  }

  async function buildCombinedText() {
    const items = [...state.tray]
      .map((id) => state.skills.find((s) => s.id === id))
      .filter(Boolean);
    const parts = await Promise.all(
      items.map(async (skill) => {
        let content = "";
        try {
          content = await fetchContent(skill);
        } catch {
          content = "(Couldn't load content — see " + skill.html_url + ")";
        }
        return `\n\n---\n\n# ${skill.name} (${skill.tool})\nSource: ${skill.repo}/${skill.path}\n${skill.html_url}\n\n${content}`;
      })
    );
    return `# All Skill Together — combined skill bundle\nGenerated: ${new Date().toISOString()}\n${parts.join("")}`.trim();
  }

  function openCombineModal() {
    renderCombineModal();
    el("#combine-modal").setAttribute("aria-hidden", "false");
  }
  function closeCombineModal() {
    el("#combine-modal").setAttribute("aria-hidden", "true");
  }

  // ---- recommended combos -------------------------------------------------
  // Combos reference skills by their exact `id` (not name) since several
  // skills share the same short name across different source repos.
  function matchSkillsByIds(ids) {
    return ids.map((id) => state.skills.find((s) => s.id === id)).filter(Boolean);
  }

  function renderCombos(combos) {
    const row = el("#combos-grid");
    if (!row) return;
    row.innerHTML = "";

    const usable = combos
      .map((c) => ({ ...c, matched: matchSkillsByIds(c.skill_ids || []) }))
      .filter((c) => c.matched.length >= 2);

    const empty = el("#combos-empty");
    if (usable.length === 0) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    for (const combo of usable) {
      const card = document.createElement("article");
      card.className = "combo-card";
      const originLabel =
        combo.origin === "official_plugin_bundle"
          ? "Official bundle"
          : combo.origin === "repo_readme_recommendation"
          ? "From a repo README"
          : "Community-discussed";
      card.innerHTML = `
        <div class="combo-top">
          <span class="combo-origin">${escapeHtml(originLabel)}</span>
        </div>
        <h3></h3>
        <p class="combo-use-case"></p>
        <div class="combo-skills"></div>
        <div class="combo-actions">
          <button class="btn btn-primary combo-add">🧺 Add all to tray</button>
          ${combo.source_url ? `<a class="btn btn-ghost" target="_blank" rel="noopener" href="${escapeHtml(combo.source_url)}">Source ↗</a>` : ""}
        </div>
      `;
      el("h3", card).textContent = combo.title;
      el(".combo-use-case", card).textContent = combo.use_case;
      const skillsWrap = el(".combo-skills", card);
      for (const s of combo.matched) {
        const chip = document.createElement("span");
        chip.className = "combo-skill-chip";
        chip.textContent = s.name;
        chip.addEventListener("click", () => openDrawer(s));
        skillsWrap.appendChild(chip);
      }
      el(".combo-add", card).addEventListener("click", () => {
        addManyToTray(combo.matched.map((s) => s.id));
        renderBoard();
        openCombineModal();
      });
      row.appendChild(card);
    }
  }

  // ---- wiring -------------------------------------------------------------
  function wireControls() {
    els(".tool-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        els(".tool-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.tool = btn.dataset.tool;
        renderBoard();
      });
    });

    let debounce;
    const searchEl = el("#search");
    if (searchEl) {
      searchEl.addEventListener("input", (e) => {
        clearTimeout(debounce);
        const v = e.target.value;
        debounce = setTimeout(() => {
          state.query = v;
          renderBoard();
        }, 120);
      });
    }

    const sortEl = el("#sort");
    if (sortEl) {
      sortEl.addEventListener("change", (e) => {
        state.sort = e.target.value;
        renderBoard();
      });
    }

    els("[data-close-drawer]").forEach((n) => n.addEventListener("click", closeDrawer));
    els("[data-close-modal]").forEach((n) => n.addEventListener("click", closeCombineModal));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeDrawer();
        closeCombineModal();
      }
    });

    el("#tray-toggle").addEventListener("click", openCombineModal);

    el("#combine-clear").addEventListener("click", () => {
      state.tray.clear();
      saveTray();
      updateTrayUI();
      renderCombineModal();
      renderBoard();
    });

    el("#combine-copy").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const original = btn.textContent;
      btn.textContent = "Loading…";
      try {
        const text = await buildCombinedText();
        await navigator.clipboard.writeText(text);
        btn.textContent = "Copied ✓";
      } catch {
        btn.textContent = "Copy failed";
      }
      setTimeout(() => (btn.textContent = original), 1600);
    });

    el("#combine-download").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const original = btn.textContent;
      btn.textContent = "Preparing…";
      const text = await buildCombinedText();
      const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "all-skill-together-combo.md";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      btn.textContent = original;
    });
  }

  function renderLastUpdated() {
    const pill = el("#last-updated");
    if (!state.generatedAt) {
      pill.textContent = "No update info";
      return;
    }
    const d = new Date(state.generatedAt);
    pill.textContent = "🔄 as of " + d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  // Lets external links (e.g. the README's per-category links) deep-link
  // straight into a filtered view: index.html?category=writing
  function applyUrlParams() {
    const params = new URLSearchParams(location.search);
    const cat = params.get("category");
    if (cat) state.activeCats.add(cat);
    const sub = params.get("subcategory");
    if (sub && state.activeCats.size === 1) state.activeSubcats.add(sub);
    const q = params.get("q");
    if (q) {
      state.query = q;
      const searchEl = el("#search");
      if (searchEl) searchEl.value = q;
    }
  }

  async function init() {
    loadTray();
    wireControls();
    try {
      await loadData();
    } catch (e) {
      const board = el("#board");
      if (board) board.innerHTML = `<p class="empty-state">Couldn't load skill data.</p>`;
      console.error(e);
      return;
    }
    renderLastUpdated();
    if (el("#board")) {
      applyUrlParams();
      renderChips();
      renderBoard();
    }
    updateTrayUI();
    if (el("#combos-grid")) {
      loadCombos().then(renderCombos);
    }
  }

  init();
})();
