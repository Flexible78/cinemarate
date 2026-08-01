// Gear menu for the AI model plus the "describe what you want" search block.
//
// The browser never holds an API key: it asks the server which providers are
// configured and which models they really offer, and sends back only names.
// Loaded as a separate file so the single-page markup above stays untouched.
(function () {
  var API = "api/ai";
  var TOKEN_KEY = "movieRatings.syncToken";
  var state = { providers: [], selection: null, loaded: false };
  var ui = {};

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function hdrs(extra) {
    var h = extra || {};
    var t = token();
    if (t) h["X-Favorites-Token"] = t;
    return h;
  }
  function el(tag, css, text) {
    var n = document.createElement(tag);
    if (css) n.className = css;
    if (text != null) n.textContent = text;
    return n;
  }
  function link(url, text) {
    var a = el("a", null, text);
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.style.marginRight = "8px";
    return a;
  }

  function anchorBox() {
    var box = el("div");
    box.style.margin = "10px 0 0";
    var btn = document.getElementById("pickbtn");
    var bar = btn && btn.parentNode ? btn.parentNode : null;
    if (bar && bar.parentNode) { bar.parentNode.insertBefore(box, bar.nextSibling); return box; }
    var sub = document.querySelector(".sub");
    if (sub && sub.parentNode) { sub.parentNode.insertBefore(box, sub.nextSibling); return box; }
    document.body.appendChild(box);
    return box;
  }

  function fillModels() {
    var prov = ui.provider.value;
    ui.model.innerHTML = "";
    if (prov === "auto") {
      ui.model.appendChild(new Option("best available (checked automatically)", ""));
      ui.model.disabled = true;
      return;
    }
    ui.model.disabled = false;
    var row = null;
    state.providers.forEach(function (p) { if (p.provider === prov) row = p; });
    var models = (row && row.models) || [];
    if (!models.length) ui.model.appendChild(new Option("no models reported", ""));
    models.forEach(function (m) { ui.model.appendChild(new Option(m, m)); });
    if (state.selection && state.selection.provider === prov && state.selection.model) {
      ui.model.value = state.selection.model;
    }
    if (row && row.error) ui.status.textContent = prov + ": " + row.error;
  }

  function describe() {
    var s = state.selection;
    if (!s) return "engine: automatic";
    return "engine: " + s.provider + "/" + s.model + (s.manual ? " (chosen manually)" : " (auto-verified)");
  }

  async function loadCatalog() {
    ui.status.textContent = "loading providers\u2026";
    try {
      var r = await fetch(API + "?action=models", { headers: hdrs({}) });
      var data = await r.json();
      if (!r.ok) throw new Error(data && data.error ? data.error : "code " + r.status);
      state.providers = data.providers || [];
      state.selection = data.selection || null;
      state.loaded = true;
      ui.provider.innerHTML = "";
      ui.provider.appendChild(new Option("automatic (recommended)", "auto"));
      state.providers.forEach(function (p) {
        ui.provider.appendChild(new Option(p.provider + " (" + p.models.length + " models)", p.provider));
      });
      if (state.selection && state.selection.manual) ui.provider.value = state.selection.provider;
      if (data.pinned) ui.status.textContent = "pinned by AI_PROVIDER=" + data.pinned + " \u00b7 " + describe();
      else ui.status.textContent = describe();
      fillModels();
    } catch (e) {
      ui.status.textContent = "could not load providers: " + (e && e.message ? e.message : e);
    }
  }

  async function saveChoice() {
    var prov = ui.provider.value;
    var model = ui.model.value;
    ui.status.textContent = prov === "auto"
      ? "switching to automatic\u2026"
      : "checking " + prov + "/" + model + "\u2026";
    try {
      var r = await fetch(API, {
        method: "POST",
        headers: hdrs({ "Content-Type": "application/json" }),
        body: JSON.stringify({ action: "select", provider: prov, model: model })
      });
      var data = await r.json();
      if (!r.ok || !data.ok) throw new Error((data && data.error) || ("code " + r.status));
      state.selection = data.selection;
      ui.status.textContent = describe() + (data.sample ? " \u00b7 answered: " + data.sample : "");
    } catch (e) {
      ui.status.textContent = "not saved: " + (e && e.message ? e.message : e);
    }
  }

  async function recheck() {
    ui.status.textContent = "checking every configured provider\u2026";
    try {
      var r = await fetch("api/pick?probe=1", { headers: hdrs({}) });
      var data = await r.json();
      var lines = (data.results || []).map(function (x) {
        return x.provider + ": " + (x.ok ? "ok \u00b7 " + x.model : "failed \u00b7 " + (x.error || "unknown"));
      });
      ui.status.textContent = lines.join(" | ") || "nothing configured";
      await loadCatalog();
    } catch (e) {
      ui.status.textContent = "check failed: " + (e && e.message ? e.message : e);
    }
  }

  function card(item) {
    var box = el("div");
    box.style.cssText = "display:flex;gap:10px;padding:8px 0;border-top:1px solid rgba(128,128,128,.25)";
    if (item.poster) {
      var img = document.createElement("img");
      img.src = item.poster;
      img.alt = "";
      img.loading = "lazy";
      img.style.cssText = "width:60px;height:90px;object-fit:cover;border-radius:6px;flex:0 0 auto";
      box.appendChild(img);
    }
    var right = el("div");
    right.style.cssText = "flex:1 1 auto;min-width:0";
    var head = el("div", null, item.title + (item.year ? " (" + item.year + ")" : ""));
    head.style.fontWeight = "600";
    right.appendChild(head);
    var meta = [];
    if (item.kind) meta.push(item.kind);
    if (item.average != null) {
      meta.push("score " + item.average + "/100" + (item.votes ? " \u00b7 " + item.votes + " votes" : ""));
    }
    if (!item.found) meta.push("not verified in the database - use the links");
    right.appendChild(el("div", "tip", meta.join(" \u00b7 ")));
    if (item.why) right.appendChild(el("div", "tip", "\u2192 " + item.why));
    if (item.overview) right.appendChild(el("div", "tip", item.overview));
    var links = el("div", "tip");
    var L = item.links || {};
    if (L.tmdb) links.appendChild(link(L.tmdb, "TMDB"));
    if (L.imdb) links.appendChild(link(L.imdb, "IMDb"));
    if (L.rottenTomatoes) links.appendChild(link(L.rottenTomatoes, "Rotten Tomatoes"));
    if (L.metacritic) links.appendChild(link(L.metacritic, "Metacritic"));
    if (L.kinopoisk) links.appendChild(link(L.kinopoisk, "Kinopoisk"));
    if (L.trailer) links.appendChild(link(L.trailer, "Trailer"));
    right.appendChild(links);
    right.appendChild(actions(item));
    box.appendChild(right);
    return box;
  }

  // The list used to be read-only: the titles were plain text, so nothing could
  // be opened or saved. Every row now reuses the app's own pipeline - the same
  // one the plain search and the discovery panel use - so a card opens with all
  // ratings and the entry lands in the shared Favorites store.
  function cats() {
    if (typeof CATS !== "undefined" && CATS && CATS.length) return CATS;
    return ["Want to watch", "Maybe", "Loved", "Watched"];
  }

  function candFor(item, imdb) {
    return {
      key: imdb ? "tt:" + imdb : "q:" + item.title,
      imdb_id: imdb || null,
      kp_id: null,
      title: item.title,
      orig_title: "",
      year: item.year || null,
      years: "",
      series: item.mediaType === "tv" || item.kind === "series",
      poster: item.poster || "",
      kp_score: null,
      stars: "TMDB",
      src: "TMDB"
    };
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // The IMDb lookup used to hang forever when the request stalled, which left
  // the row stuck on the progress message. It is aborted after a few seconds
  // now and always resolves.
  async function imdbIdFast(item, ms) {
    if (!item.tmdbId) return "";
    var type = item.mediaType === "tv" ? "tv" : "movie";
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, ms || 8000) : null;
    try {
      var url = "api/discover?mode=imdb&type=" + type + "&id=" + encodeURIComponent(item.tmdbId);
      var r = await fetch(url, ctl ? { signal: ctl.signal } : {});
      var d = await r.json();
      return (d && d.imdb_id) || "";
    } catch (e) {
      return "";
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function imdbId(item) {
    return await imdbIdFast(item, 8000);
  }

  // The card is rendered by the app below this panel, so bring it into view as
  // soon as it appears - open1 fills it progressively.
  function focusCard() {
    var tries = 0;
    var tick = setInterval(function () {
      tries++;
      var cardEl = document.getElementById("card");
      if (cardEl && !cardEl.classList.contains("hide")) {
        cardEl.scrollIntoView({ behavior: "smooth", block: "start" });
        clearInterval(tick);
      } else if (tries > 24) {
        clearInterval(tick);
      }
    }, 250);
  }

  function searchByTitle(item) {
    var box = document.getElementById("q");
    if (!box) return false;
    box.value = item.title + (item.year ? " " + item.year : "");
    if (typeof run === "function") { run(); focusCard(); return true; }
    var go = document.getElementById("go");
    if (go) { go.click(); focusCard(); return true; }
    return false;
  }

  // Open the full rating card. The IMDb id is resolved here and the candidate
  // goes straight to the app's own opener, so the card is built by the same
  // pipeline the plain search uses. Every path ends visibly: nothing can wait
  // forever, the progress message is always cleared and the card is scrolled
  // into view.
  async function openItem(item, say) {
    var failed = false;
    say("opening the card\u2026");
    try {
      var imdb = await imdbIdFast(item, 8000);
      if (typeof note === "function") note("");
      if (imdb && typeof open1 === "function") {
        focusCard();
        await Promise.race([open1(candFor(item, imdb), item.title), wait(20000)]);
        return;
      }
      if (searchByTitle(item)) return;
      if (imdb) {
        window.open("https://www.imdb.com/title/" + imdb + "/", "_blank");
        return;
      }
      failed = true;
      say("could not open this title");
    } catch (e) {
      failed = true;
      say("could not open: " + (e && e.message ? e.message : e));
    } finally {
      if (!failed) say("");
    }
  }

  // storeFav writes into the card's status line, which does not exist while the
  // AI list is the only thing on screen, so a temporary one is provided.
  function saveEntry(cardObj, category) {
    var tmp = null;
    if (!document.getElementById("favmsg")) {
      tmp = el("span");
      tmp.id = "favmsg";
      tmp.style.display = "none";
      document.body.appendChild(tmp);
    }
    try {
      storeFav(cardObj, category);
    } finally {
      if (tmp && tmp.parentNode) tmp.parentNode.removeChild(tmp);
    }
  }

  async function addItem(item, category, say) {
    if (typeof storeFav !== "function" || typeof buildCard !== "function") {
      say("this build cannot save from the list");
      return;
    }
    say("resolving and saving\u2026");
    try {
      var imdb = await imdbId(item);
      var cand = candFor(item, imdb);
      if (!imdb && typeof smartSearch === "function") {
        var list = [];
        try { list = await smartSearch(item.title + (item.year ? " " + item.year : "")); } catch (e) { list = []; }
        if (!list.length) { try { list = await smartSearch(item.title); } catch (e) { list = []; } }
        if (list.length) cand = list[0];
      }
      var built = null;
      try { built = await buildCard(cand); } catch (e) { built = null; }
      if (built && typeof isResolved === "function" && isResolved(built)) {
        saveEntry(built, category);
        say("saved to \u00ab" + category + "\u00bb");
        return;
      }
      saveEntry({
        key: cand.key,
        title: item.title,
        orig_title: "",
        year: item.year || null,
        kind: item.kind || "",
        poster: item.poster || "",
        series: cand.series,
        genres: [],
        average: item.average != null ? item.average : null,
        imdb_id: cand.imdb_id,
        kp_id: null,
        sources: [],
        watch: []
      }, category);
      say("saved to \u00ab" + category + "\u00bb");
    } catch (e) {
      say("not saved: " + (e && e.message ? e.message : e));
    }
  }

  function actions(item) {
    var row = el("div");
    row.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0 0";
    var openBtn = el("button", "small", "Open card");
    openBtn.type = "button";
    var pick = document.createElement("select");
    pick.className = "small";
    cats().forEach(function (c) { pick.appendChild(new Option(c, c)); });
    var addBtn = el("button", "primary small", "\u2605 Add");
    addBtn.type = "button";
    var msg = el("span", "tip", "");
    msg.style.margin = "0";
    function say(t) { msg.textContent = t; }
    openBtn.addEventListener("click", function () {
      openBtn.disabled = true;
      Promise.resolve(openItem(item, say)).catch(function (e) {
        say("could not open: " + (e && e.message ? e.message : e));
      }).then(function () { openBtn.disabled = false; });
    });
    addBtn.addEventListener("click", function () {
      addBtn.disabled = true;
      Promise.resolve(addItem(item, pick.value, say)).catch(function (e) {
        say("not saved: " + (e && e.message ? e.message : e));
      }).then(function () { addBtn.disabled = false; });
    });
    row.appendChild(openBtn);
    row.appendChild(pick);
    row.appendChild(addBtn);
    row.appendChild(msg);
    return row;
  }

  async function search() {
    var wish = ui.wish.value.trim();
    if (!wish) { ui.searchInfo.textContent = "describe what you feel like watching first"; return; }
    ui.searchInfo.textContent = "asking the model, then verifying every title\u2026";
    ui.results.innerHTML = "";
    try {
      var r = await fetch(API, {
        method: "POST",
        headers: hdrs({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          action: "suggest",
          wish: wish,
          kind: ui.kind.value,
          count: 6,
          yearFrom: Number(ui.yearFrom.value) || null,
          yearTo: Number(ui.yearTo.value) || null
        })
      });
      var data = await r.json();
      if (!r.ok) {
        throw new Error(((data && data.error) || ("code " + r.status)) + (data && data.detail ? ": " + data.detail : ""));
      }
      var bits = [(data.items || []).length + " ideas", data.engine];
      if (data.years) bits.push("years " + data.years.from + "-" + data.years.to);
      if (data.source) bits.push(data.source);
      if (data.note) bits.push(data.note);
      ui.searchInfo.textContent = bits.join(" \u00b7 ");
      (data.items || []).forEach(function (it) { ui.results.appendChild(card(it)); });
    } catch (e) {
      ui.searchInfo.textContent = "search failed: " + (e && e.message ? e.message : e);
    }
  }

  function build() {
    var box = anchorBox();

    var row = el("div");
    row.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;align-items:center";
    var gear = el("button", "small", "\u2699\ufe0f AI model");
    gear.type = "button";
    var find = el("button", "small", "\ud83d\udd0e Describe what you want");
    find.type = "button";
    ui.status = el("span", "tip", "");
    ui.status.style.margin = "0";
    row.appendChild(gear);
    row.appendChild(find);
    row.appendChild(ui.status);
    box.appendChild(row);

    var panel = el("div");
    panel.style.cssText = "display:none;margin:8px 0 0;padding:8px;border:1px solid rgba(128,128,128,.35);border-radius:8px";
    ui.provider = document.createElement("select");
    ui.provider.className = "small";
    ui.model = document.createElement("select");
    ui.model.className = "small";
    var saveBtn = el("button", "small", "Save");
    saveBtn.type = "button";
    var checkBtn = el("button", "small", "Re-check all");
    checkBtn.type = "button";
    var line = el("div");
    line.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;align-items:center";
    line.appendChild(ui.provider);
    line.appendChild(ui.model);
    line.appendChild(saveBtn);
    line.appendChild(checkBtn);
    panel.appendChild(line);
    panel.appendChild(el("div", "tip",
      "Only provider and model names travel between browser and server. API keys stay in the server environment."));
    box.appendChild(panel);

    var searchPanel = el("div");
    searchPanel.style.cssText = "display:none;margin:8px 0 0;padding:8px;border:1px solid rgba(128,128,128,.35);border-radius:8px";
    ui.wish = document.createElement("textarea");
    ui.wish.rows = 2;
    ui.wish.placeholder = "e.g. a clever gripping detective story, 2024-2026 - years in the text are respected";
    ui.wish.style.cssText = "width:100%;box-sizing:border-box";
    ui.kind = document.createElement("select");
    ui.kind.className = "small";
    [["any", "anything"], ["movie", "movie"], ["series", "series"], ["documentary", "documentary"], ["animation", "animation"]]
      .forEach(function (o) { ui.kind.appendChild(new Option(o[1], o[0])); });
    var goBtn = el("button", "small", "Find");
    goBtn.type = "button";
    var line2 = el("div");
    line2.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0 0";
    line2.appendChild(ui.kind);
    ui.yearFrom = document.createElement("input");
    ui.yearFrom.type = "number";
    ui.yearFrom.placeholder = "year from";
    ui.yearFrom.min = "1900";
    ui.yearFrom.max = "2100";
    ui.yearFrom.style.cssText = "width:96px";
    ui.yearTo = document.createElement("input");
    ui.yearTo.type = "number";
    ui.yearTo.placeholder = "year to";
    ui.yearTo.min = "1900";
    ui.yearTo.max = "2100";
    ui.yearTo.style.cssText = "width:96px";
    line2.appendChild(ui.yearFrom);
    line2.appendChild(ui.yearTo);
    line2.appendChild(goBtn);
    ui.searchInfo = el("span", "tip", "");
    ui.searchInfo.style.margin = "0";
    line2.appendChild(ui.searchInfo);
    ui.results = el("div");
    ui.results.style.margin = "8px 0 0";
    searchPanel.appendChild(ui.wish);
    searchPanel.appendChild(line2);
    searchPanel.appendChild(ui.results);
    box.appendChild(searchPanel);

    gear.addEventListener("click", function () {
      var open = panel.style.display === "none";
      panel.style.display = open ? "block" : "none";
      if (open && !state.loaded) loadCatalog();
    });
    find.addEventListener("click", function () {
      searchPanel.style.display = searchPanel.style.display === "none" ? "block" : "none";
      if (searchPanel.style.display === "block") ui.wish.focus();
    });
    ui.provider.addEventListener("change", fillModels);
    saveBtn.addEventListener("click", function () {
      saveBtn.disabled = true;
      Promise.resolve(saveChoice()).then(function () { saveBtn.disabled = false; });
    });
    checkBtn.addEventListener("click", function () {
      checkBtn.disabled = true;
      Promise.resolve(recheck()).then(function () { checkBtn.disabled = false; });
    });
    goBtn.addEventListener("click", function () {
      goBtn.disabled = true;
      Promise.resolve(search()).then(function () { goBtn.disabled = false; });
    });
    ui.wish.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") goBtn.click();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
