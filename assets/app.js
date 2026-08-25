(() => {
  "use strict";

  const state = {
    skills: [],
    categories: [],
    generatedAt: null,
    tool: "all",
    activeCats: new Set(),
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
    state.generatedAt = data.generated_at || null;
  }

  async function fetchContent(skill) {
    if (contentCache.has(skill.raw_url)) return contentCache.get(skill.raw_url);
    const res = await fetch(skill.raw_url);
    if (!res.ok) throw new Error(`콘텐츠를 불러오지 못했습니다 (${res.status})`);
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
    if (!iso) return "날짜 미상";
    const d = new Date(iso);
    if (isNaN(d)) return "날짜 미상";
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days <= 0) return "오늘 업데이트";
    if (days === 1) return "어제 업데이트";
    if (days < 30) return `${days}일 전 업데이트`;
    return d.toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" }) + " 업데이트";
  }

  function categoryMeta(id) {
    return state.categories.find((c) => c.id === id) || { id, ko: id, icon: "✨" };
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
      btn.textContent = `${cat.icon} ${cat.ko} (${count})`;
      btn.addEventListener("click", () => {
        if (state.activeCats.has(cat.id)) state.activeCats.delete(cat.id);
        else state.activeCats.add(cat.id);
        renderChips();
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
      if (q) {
        const hay = `${s.name} ${s.description} ${s.repo}`.toLowerCase();
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
          <span class="badge badge-cat">${cat.icon} ${cat.ko}</span>
        </div>
        <button class="add-btn${added ? " added" : ""}" title="조합함에 추가/제거" aria-label="조합함에 추가">${added ? "✓" : "+"}</button>
      </div>
      <h3></h3>
      <p class="desc"></p>
      <div class="card-foot">
        <span class="repo"></span>
        <span class="updated"></span>
      </div>
    `;
    el("h3", card).textContent = skill.name;
    el(".desc", card).textContent = skill.description || "(설명 없음)";
    el(".repo", card).textContent = skill.repo;
    el(".updated", card).textContent = formatDate(skill.updated_at);

    el(".add-btn", card).addEventListener("click", (e) => {
      e.stopPropagation();
      toggleTray(skill.id);
      const btn = e.currentTarget;
      const isAdded = state.tray.has(skill.id);
      btn.classList.toggle("added", isAdded);
      btn.textContent = isAdded ? "✓" : "+";
      btn.setAttribute("aria-label", isAdded ? "조합함에서 제거" : "조합함에 추가");
    });

    card.addEventListener("click", () => openDrawer(skill));
    return card;
  }

  function renderBoard() {
    const board = el("#board");
    const list = getFiltered();
    board.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const skill of list) frag.appendChild(cardTemplate(skill));
    board.appendChild(frag);

    el("#result-count").textContent = `${list.length}개의 스킬`;
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
        <span class="badge badge-cat">${cat.icon} ${cat.ko}</span>
      </div>
      <h2 class="detail-title" id="drawer-title"></h2>
      <p class="detail-desc"></p>
      <dl class="detail-meta">
        <dt>저장소</dt><dd></dd>
        <dt>경로</dt><dd></dd>
        <dt>업데이트</dt><dd></dd>
        <dt>스타</dt><dd></dd>
      </dl>
      <div class="detail-actions">
        <a class="btn" target="_blank" rel="noopener" href="${escapeHtml(skill.html_url)}">GitHub에서 원본 보기 ↗</a>
        <button class="btn btn-primary" id="drawer-add">${added ? "조합함에서 제거" : "🧺 조합함에 추가"}</button>
      </div>
      <div class="detail-body"><p class="detail-loading">스킬 내용을 불러오는 중…</p></div>
    `;
    el(".detail-title", body).textContent = skill.name;
    el(".detail-desc", body).textContent = skill.description || "(설명 없음)";
    const dds = els(".detail-meta dd", body);
    dds[0].textContent = skill.repo;
    dds[1].textContent = skill.path;
    dds[2].textContent = formatDate(skill.updated_at);
    dds[3].textContent = skill.stars != null ? `⭐ ${skill.stars}` : "—";

    const addBtn = el("#drawer-add", body);
    addBtn.addEventListener("click", () => {
      toggleTray(skill.id);
      const isAdded = state.tray.has(skill.id);
      addBtn.textContent = isAdded ? "조합함에서 제거" : "🧺 조합함에 추가";
      renderBoard();
    });

    drawer.setAttribute("aria-hidden", "false");

    fetchContent(skill)
      .then((md) => {
        el(".detail-body", body).innerHTML = renderMarkdownLite(md);
      })
      .catch((err) => {
        el(".detail-body", body).innerHTML = `<p class="detail-loading">내용을 불러오지 못했습니다: ${escapeHtml(err.message)}. GitHub 링크로 확인해주세요.</p>`;
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
      list.innerHTML = `<p class="combine-empty">아직 담은 스킬이 없어요. 카드의 + 버튼으로 담아보세요.</p>`;
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
        <button aria-label="제거">✕</button>
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
          content = "(내용을 불러오지 못했습니다 — " + skill.html_url + " 참고)";
        }
        return `\n\n---\n\n# ${skill.name} (${skill.tool})\n출처: ${skill.repo}/${skill.path}\n${skill.html_url}\n\n${content}`;
      })
    );
    return `# All Skill Together — 조합된 스킬 모음\n생성: ${new Date().toISOString()}\n${parts.join("")}`.trim();
  }

  function openCombineModal() {
    renderCombineModal();
    el("#combine-modal").setAttribute("aria-hidden", "false");
  }
  function closeCombineModal() {
    el("#combine-modal").setAttribute("aria-hidden", "true");
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
    el("#search").addEventListener("input", (e) => {
      clearTimeout(debounce);
      const v = e.target.value;
      debounce = setTimeout(() => {
        state.query = v;
        renderBoard();
      }, 120);
    });

    el("#sort").addEventListener("change", (e) => {
      state.sort = e.target.value;
      renderBoard();
    });

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
      btn.textContent = "불러오는 중…";
      try {
        const text = await buildCombinedText();
        await navigator.clipboard.writeText(text);
        btn.textContent = "복사됨 ✓";
      } catch {
        btn.textContent = "복사 실패";
      }
      setTimeout(() => (btn.textContent = original), 1600);
    });

    el("#combine-download").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const original = btn.textContent;
      btn.textContent = "준비 중…";
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
      pill.textContent = "업데이트 정보 없음";
      return;
    }
    const d = new Date(state.generatedAt);
    pill.textContent = "🔄 " + d.toLocaleString("ko-KR", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) + " 기준";
  }

  async function init() {
    loadTray();
    wireControls();
    try {
      await loadData();
    } catch (e) {
      el("#board").innerHTML = `<p class="empty-state">스킬 데이터를 불러오지 못했습니다.</p>`;
      console.error(e);
      return;
    }
    renderLastUpdated();
    renderChips();
    renderBoard();
    updateTrayUI();
  }

  init();
})();
