const STORAGE_KEY = "webforms-admin-v1";

const defaultState = () => ({
  apiBaseUrl: "https://contact-worker.example.workers.dev",
  sites: [],
});

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return {
      apiBaseUrl: parsed.apiBaseUrl || defaultState().apiBaseUrl,
      sites: Array.isArray(parsed.sites) ? parsed.sites : [],
    };
  } catch {
    return defaultState();
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function buildSiteConfig(state) {
  const out = {};
  const seen = new Map();

  for (const site of state.sites) {
    for (const origin of site.origins) {
      const key = origin.trim();
      if (!key) continue;
      if (seen.has(key)) {
        seen.get(key).push(site.slug);
      } else {
        seen.set(key, [site.slug]);
      }
      out[key] = {
        site: site.slug,
        notify_email: site.notifyEmail,
      };
    }
  }

  const duplicates = [...seen.entries()].filter(([, slugs]) => slugs.length > 1);
  return { json: out, duplicates };
}

function uuid() {
  return crypto.randomUUID();
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(
    () => toast("Copied"),
    () => toast("Copy failed")
  );
}

function normalizeOrigins(text) {
  return text
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((o) => {
      if (!/^https?:\/\//i.test(o)) return `https://${o}`;
      return o.replace(/\/+$/, "");
    });
}

function contactSnippet(state) {
  const base = state.apiBaseUrl.replace(/\/+$/, "");
  return `<script>
(function () {
  var ENDPOINT = "${base}/contact";
  var form = document.getElementById("contact-form");
  if (!form) return;
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    e.stopPropagation();
    var btn = form.querySelector('[type="submit"]');
    var t = btn.value || btn.textContent;
    btn.disabled = true;
    btn.value = btn.textContent = "Sending...";
    var q = function (n) { return (form.querySelector('[name="' + n + '"]') || {}).value || ""; };
    try {
      var res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site: window.location.hostname,
          first_name: q("first_name"),
          last_name: q("last_name"),
          email: q("email"),
          phone: q("phone"),
          company: q("company"),
          subject: q("subject"),
          message: q("message"),
          website_url: q("website_url"),
          status: "new",
          notes: ""
        })
      });
      if (res.ok) {
        form.style.display = "none";
        var done = form.parentElement.querySelector(".w-form-done");
        if (done) done.style.display = "block";
        else form.insertAdjacentHTML("afterend", '<div class="w-form-done" style="display:block"><div>Message sent.</div></div>');
      } else {
        var err = await res.json().catch(function () { return {}; });
        alert(err.error || "Something went wrong.");
      }
    } catch (x) {
      alert("Network error.");
    } finally {
      btn.disabled = false;
      btn.value = btn.textContent = t;
    }
  });
})();
</script>`;
}

function newsletterSnippet(state) {
  const base = state.apiBaseUrl.replace(/\/+$/, "");
  return `<script>
(function () {
  var ENDPOINT = "${base}/contact";
  var form = document.getElementById("newsletter-form");
  if (!form) return;
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    e.stopPropagation();
    var btn = form.querySelector('[type="submit"]');
    var t = btn.value || btn.textContent;
    btn.disabled = true;
    btn.value = btn.textContent = "…";
    var q = function (n) { return (form.querySelector('[name="' + n + '"]') || {}).value || ""; };
    try {
      var res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site: window.location.hostname,
          first_name: q("first_name") || "Subscriber",
          email: q("email"),
          message: "Newsletter subscription",
          subject: "Newsletter signup",
          website_url: "",
          status: "new",
          notes: ""
        })
      });
      if (res.ok) {
        form.style.display = "none";
        var done = form.parentElement.querySelector(".w-form-done");
        if (done) done.style.display = "block";
        else form.insertAdjacentHTML("afterend", '<div class="w-form-done" style="display:block"><div>Thanks for subscribing.</div></div>');
      } else alert("Could not subscribe.");
    } catch (x) {
      alert("Network error.");
    } finally {
      btn.disabled = false;
      btn.value = btn.textContent = t;
    }
  });
})();
</script>`;
}

function render(state) {
  saveState(state);

  document.getElementById("apiBaseUrl").value = state.apiBaseUrl;

  const { json, duplicates } = buildSiteConfig(state);
  const jsonStr = JSON.stringify(json, null, 2);
  document.getElementById("siteConfigOut").textContent =
    state.sites.length === 0
      ? "{}\n\n// Add at least one website below, then copy this into Cloudflare → Worker → SITE_CONFIG"
      : jsonStr;

  const dupEl = document.getElementById("dupWarning");
  if (duplicates.length) {
    dupEl.style.display = "block";
    dupEl.textContent =
      "Duplicate origins (last one wins in export): " +
      duplicates.map(([o, s]) => `${o} → ${[...new Set(s)].join(", ")}`).join(" | ");
  } else {
    dupEl.style.display = "none";
  }

  const list = document.getElementById("siteList");
  if (state.sites.length === 0) {
    list.innerHTML = '<li class="empty">No websites yet. Use the form on the right.</li>';
  } else {
    list.innerHTML = state.sites
      .map(
        (s) => `
      <li class="site-item" data-id="${s.id}">
        <strong>${escapeHtml(s.slug)}</strong>
        <span>Notify: ${escapeHtml(s.notifyEmail)}</span>
        <div class="origins">${s.origins.map(escapeHtml).join(" · ")}</div>
        <div class="actions">
          <button type="button" class="btn secondary btn-edit" data-id="${s.id}">Edit</button>
          <button type="button" class="btn danger btn-remove" data-id="${s.id}">Remove</button>
        </div>
      </li>`
      )
      .join("");
  }

  document.getElementById("snippetContact").textContent = contactSnippet(state);
  document.getElementById("snippetNewsletter").textContent = newsletterSnippet(state);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let state = loadState();
let editingId = null;

document.getElementById("apiBaseUrl").addEventListener("change", (e) => {
  state.apiBaseUrl = e.target.value.trim() || defaultState().apiBaseUrl;
  render(state);
});

document.getElementById("formAddSite").addEventListener("submit", (e) => {
  e.preventDefault();
  const slug = document.getElementById("slug").value.trim();
  const notifyEmail = document.getElementById("notifyEmail").value.trim();
  const origins = normalizeOrigins(document.getElementById("origins").value);

  if (!slug || !notifyEmail || origins.length === 0) {
    toast("Fill site, notify email, and at least one origin");
    return;
  }

  if (editingId) {
    const idx = state.sites.findIndex((s) => s.id === editingId);
    if (idx >= 0) {
      state.sites[idx] = { id: editingId, slug, notifyEmail, origins };
    }
  } else {
    state.sites.push({ id: uuid(), slug, notifyEmail, origins });
  }

  editingId = null;
  document.getElementById("btnSaveSite").textContent = "Add website";
  document.getElementById("formAddSite").reset();
  render(state);
});

document.getElementById("siteList").addEventListener("click", (e) => {
  const rm = e.target.closest(".btn-remove");
  const ed = e.target.closest(".btn-edit");
  if (rm) {
    state.sites = state.sites.filter((s) => s.id !== rm.dataset.id);
    if (editingId === rm.dataset.id) {
      editingId = null;
      document.getElementById("btnSaveSite").textContent = "Add website";
    }
    render(state);
  }
  if (ed) {
    const s = state.sites.find((x) => x.id === ed.dataset.id);
    if (!s) return;
    editingId = s.id;
    document.getElementById("slug").value = s.slug;
    document.getElementById("notifyEmail").value = s.notifyEmail;
    document.getElementById("origins").value = s.origins.join("\n");
    document.getElementById("btnSaveSite").textContent = "Update website";
    document.getElementById("slug").focus();
    toast("Editing — submit to save");
  }
});

document.getElementById("btnImport").addEventListener("click", () => {
  const ta = document.getElementById("importJson");
  try {
    const obj = JSON.parse(ta.value);
    const bySlug = new Map();

    for (const [origin, cfg] of Object.entries(obj)) {
      if (!cfg || typeof cfg !== "object") continue;
      const slug = cfg.site || "";
      const ne = cfg.notify_email || "";
      if (!slug || !ne) continue;
      if (!bySlug.has(slug)) {
        bySlug.set(slug, { id: uuid(), slug, notifyEmail: ne, origins: [] });
      }
      bySlug.get(slug).origins.push(origin.trim());
    }

    state.sites = [...bySlug.values()];
    ta.value = "";
    toast("Imported " + state.sites.length + " site(s)");
    render(state);
  } catch {
    toast("Invalid JSON");
  }
});

document.getElementById("btnLoadExample").addEventListener("click", () => {
  document.getElementById("importJson").value = `{
  "https://example.com": { "site": "example.com", "notify_email": "info@example.com" },
  "https://www.example.com": { "site": "example.com", "notify_email": "info@example.com" }
}`;
});

document.getElementById("btnCopyConfig").addEventListener("click", () => {
  const { json } = buildSiteConfig(state);
  copyText(JSON.stringify(json, null, 2));
});

document.getElementById("btnCopyContact").addEventListener("click", () => {
  copyText(contactSnippet(state));
});

document.getElementById("btnCopyNewsletter").addEventListener("click", () => {
  copyText(newsletterSnippet(state));
});

document.querySelectorAll(".tabs").forEach((tabBar) => {
  tabBar.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-tab]");
    if (!btn) return;
    const tab = btn.dataset.tab;
    const card = btn.closest(".card");
    card.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b === btn));
    card.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === tab));
  });
});

render(state);
