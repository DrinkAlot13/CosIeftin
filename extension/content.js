// ── CoșMic content script. Adds a panel; changes nothing else on the page.
//
// FIVE RULES, and every one of them is a thing an extension can easily get wrong:
//
//   1. NEVER MODIFY THE MERCHANT'S PAGE. No price is rewritten, no element is hidden, no style
//      is injected into their DOM. We append one fixed-position panel and that is the entire
//      footprint. An extension that edits a shop's own prices is indistinguishable from one
//      that lies about them.
//   2. NEVER COVER THE PRICE OR THE BUY BUTTON. The panel is bottom-anchored and bounded; on a
//      narrow screen it collapses to a bar rather than growing over the page.
//   3. ONE API CALL PER PRODUCT PAGE. No prefetching, no crawling, no speculative lookups. An
//      extension that walks a category page on the user's connection is a crawler wearing a
//      user's IP address.
//   4. "NO COMPARISON" IS A CLEAN ANSWER, not silence. 89% of priced products have exactly one
//      shop, so this is the COMMON case; showing nothing would be a bug that looks like working.
//   5. IF THE API IS DOWN OR SLOW, SAY SO AND GO AWAY. The panel must never break the page it
//      sits on, and a shopper mid-purchase does not need our spinner.
//
// It sends `location.href` and nothing else. See PRIVACY.md.

(() => {
  "use strict";

  // `browser` in Firefox, `chrome` in Chromium. Both expose the same promise-based storage in
  // MV3; aliasing is all the cross-browser handling this needs.
  const ext = typeof browser !== "undefined" ? browser : chrome;

  const API = "https://cosmic.ro"; // replaced at packaging time for staging builds
  const TIMEOUT_MS = 4000;         // a shopper does not wait for us
  const DISMISS_KEY = "cosmic_panel_dismissed_until";
  const SNOOZE_MS = 24 * 60 * 60 * 1000;

  const money = (bani) =>
    `${(bani / 100).toFixed(2).replace(".", ",")} lei`;

  /** "acum 3 ore" / "acum 6 zile" — the age is never optional. */
  function ageLabel(hours) {
    if (hours == null) return "dată necunoscută";
    if (hours < 1) return "verificat acum sub o oră";
    if (hours < 24) return `verificat acum ${Math.round(hours)} ${Math.round(hours) === 1 ? "oră" : "ore"}`;
    const d = Math.round(hours / 24);
    return `verificat acum ${d} ${d === 1 ? "zi" : "zile"}`;
  }

  function panelRoot() {
    let el = document.getElementById("cosmic-panel");
    if (el) return el;
    el = document.createElement("div");
    el.id = "cosmic-panel";
    el.setAttribute("role", "complementary");
    el.setAttribute("aria-label", "CoșMic — comparație de prețuri");
    // Appended to <body>, never inserted into the merchant's own layout tree, so nothing of
    // theirs reflows and no stylesheet of ours can cascade into their markup.
    document.body.appendChild(el);
    return el;
  }

  function render(html) {
    const el = panelRoot();
    el.innerHTML = html;
    const close = el.querySelector("[data-cosmic-close]");
    if (close) {
      close.addEventListener("click", () => {
        el.remove();
        try { ext.storage.local.set({ [DISMISS_KEY]: Date.now() + SNOOZE_MS }); } catch { /* ignore */ }
      });
    }
  }

  function renderOffers(data) {
    const offers = (data.offers || []).filter((o) => o.inStock && !o.isStale);
    const here = new URL(location.href).hostname.replace(/^www\./, "");

    // The shop the person is ALREADY on is not a comparison — it is the price in front of them.
    const others = offers.filter((o) => {
      const u = o.productUrl ? new URL(o.productUrl).hostname.replace(/^www\./, "") : "";
      return u !== here;
    });

    const name = data.product ? data.product.name : "";

    // RULE 4. This is the common case, not an edge case, and it gets a real sentence.
    if (others.length === 0) {
      return render(`
        <div class="cosmic-head">
          <span class="cosmic-brand">CoșMic</span>
          <button class="cosmic-x" data-cosmic-close aria-label="Închide">×</button>
        </div>
        <p class="cosmic-none">Nu avem un preț de comparație pentru acest produs.</p>
        <p class="cosmic-sub">Îl găsim la un singur magazin — cel pe care îl vezi acum.</p>
      `);
    }

    const rows = others
      .slice(0, 4)
      .map((o) => `
        <li>
          <a class="cosmic-row" href="${o.productUrl || "#"}" target="_blank" rel="noopener nofollow">
            <span class="cosmic-shop">${escapeHtml(o.merchant.name)}</span>
            <span class="cosmic-price">${money(o.priceBani)}</span>
          </a>
          <div class="cosmic-when">
            ${escapeHtml(ageLabel(o.observedAgeHours))}${o.requiresLoyaltyCard ? " · 💳 doar cu card" : ""}
          </div>
        </li>`)
      .join("");

    render(`
      <div class="cosmic-head">
        <span class="cosmic-brand">CoșMic</span>
        <button class="cosmic-x" data-cosmic-close aria-label="Închide">×</button>
      </div>
      <p class="cosmic-name">${escapeHtml(name)}</p>
      <ul class="cosmic-list">${rows}</ul>
      <p class="cosmic-sub">Prețurile sunt colectate automat. Prețul valabil este cel din magazin.</p>
    `);
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  async function run() {
    // RULE 3, enforced structurally: this file runs once per document, and there is exactly one
    // fetch below. There is no code path that issues a second.
    if (window.__cosmicRan) return;
    window.__cosmicRan = true;

    try {
      const stored = await ext.storage.local.get(DISMISS_KEY);
      if (stored && stored[DISMISS_KEY] && Date.now() < stored[DISMISS_KEY]) return;
    } catch { /* storage unavailable is not a reason to fail loudly */ }

    const url = location.href;
    // A listing page is not a product page. Without this the extension would ask about every
    // category page a person browses — which is the crawling rule 3 exists to prevent.
    if (!looksLikeProductPage(url)) return;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let data;
    try {
      const res = await fetch(`${API}/api/v1/lookup?url=${encodeURIComponent(url)}`, {
        signal: ctrl.signal,
        credentials: "omit",   // no cookies, ever — there is no session to send
        cache: "default",
      });
      clearTimeout(timer);
      if (!res.ok) return;     // RULE 5: a failure is silence, not an error box on their page
      data = await res.json();
    } catch {
      clearTimeout(timer);
      return;                  // timeout, offline, API down — the page is unaffected
    }

    // RULE: never claim a comparison we would withhold on our own site. The API already refuses
    // to emit withheld rows, so "trust the payload" is the same rule, enforced server-side.
    if (!data || !data.match || data.match.status === "none" || data.match.status === "unsupported") {
      return; // we do not know this product; saying nothing is correct
    }
    // A `review`-grade match is explicitly NOT an assertion — the API returns product: null for
    // those, and an extension that rendered it anyway would be making the claim the API declined.
    if (!data.product) return;

    renderOffers(data);
  }

  /**
   * Is this a product page rather than a listing?
   *
   * The eleven usable merchants all expose a product by URL (measured — see
   * `probe:extension-ids`), and every one of their product URLs carries a segment that a
   * category URL does not. This is deliberately conservative: a missed product page shows
   * nothing, while a false positive asks our API about a category listing.
   */
  function looksLikeProductPage(href) {
    let p;
    try { p = new URL(href).pathname; } catch { return false; }
    return (
      /\/p\/|\/product\/|\/produs\//.test(p) ||   // mega-image, penny, selgros, freshful
      /\/p$/.test(p) ||                            // auchan VTEX
      /\/produse\//.test(p) ||                     // carrefour
      /-\d{3,}(?:\/|$)/.test(p) ||                 // sezamo: /<id>-<slug>
      /\/\d{3,}(?:\/|$)/.test(p)                   // dcneu, metro numeric ids
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
})();
