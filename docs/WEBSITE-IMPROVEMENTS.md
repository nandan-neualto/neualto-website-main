# NeuAlto Website — Improvement Audit

**Date:** July 22, 2026
**Scope:** `index.html`, `careers.html`, `styles.css`, `app.js` — static code review + live browser probe (desktop & mobile viewports, both pages).

> **Status note (July 25, 2026):** most items below have since been implemented — mobile nav, contact form, privacy policy, service links, ARIA, og:image, sitemap/robots, 404, contrast, and performance. Kept for the original record. See the "Suggested order of attack" at the bottom for what was worked through.

**Overall:** The site is in good shape — zero console errors on both pages, no horizontal overflow on desktop or mobile, no broken in-page anchors, valid structured data, reduced-motion support, and a working dark theme. The issues below are ranked by impact.

---

## 🔴 High priority

### 1. No mobile navigation at all
At ≤980px the nav links are simply hidden (`.nav-links { display: none }`) and **no hamburger menu replaces them** (verified live at 375px). Mobile visitors — likely the majority for a marketing site — cannot reach Services, Engagement, Founders, FAQ, or Careers except by scrolling or finding the footer.
**Fix:** Add a hamburger button that toggles a slide-down/drawer menu. This is the single biggest UX gap on the site.

### 2. Contact is a bare `mailto:` link — no contact form
Every "Contact Us" CTA opens `mailto:info@neualto.com`. On machines without a configured mail client (most corporate desktops, many mobiles), the button silently does nothing — you lose the lead at the moment of highest intent.
**Fix:** Add a short contact form (name, email, message) wired to a form backend (Formspree, Basin, Netlify Forms, or a tiny serverless endpoint). Keep the email visible as plain text fallback. Same applies to the careers "Apply Now" buttons — at minimum show the address as copyable text.

### 3. Dead "Privacy Policy" link + no legal pages
The footer Privacy Policy link is `href="#"` — it scrolls to top and goes nowhere. For a company selling security/vCISO services, a missing privacy policy undermines credibility (and is legally required in many jurisdictions if you ever add a form or analytics).
**Fix:** Write a real privacy page (and ideally terms), or remove the link until it exists.

### 4. "Explore now" links go nowhere
All six service cards end with an "Explore now →" affordance that is a non-interactive `<span class="svc-link">`. Users will click it and nothing happens — it reads as broken.
**Fix:** Either create per-service detail pages/sections and make the whole card an `<a>`, or remove/relabel the fake CTA.

### 5. Job postings look stale and schema is incomplete
Both roles say "Posted Feb 19, 2026" — five months old as of today, which signals a dead careers page. The `JobPosting` JSON-LD is also missing `validThrough` and `baseSalary`; Google may treat postings without `validThrough` as expired and drop them from the jobs rich-results carousel.
**Fix:** Refresh `datePosted`, add `validThrough` (and re-up it periodically), add `baseSalary` if you can, plus `directApply: false`.

---

## 🟠 Medium priority

### 6. Accessibility gaps (WCAG)
- **No `<main>` landmark and no skip link** on either page — screen-reader and keyboard users have no way to bypass the header.
- **Tabs are half-ARIA'd:** `role="tablist"`/`role="tab"` are declared but there are **no `role="tabpanel"`, no `aria-selected`, no `aria-controls`, and no arrow-key navigation** (verified live: 0 tabs with `aria-selected`). Partial ARIA is worse than none — screen readers announce a tab widget that doesn't behave like one. Either complete the pattern or remove the roles.
- **FAQ accordion buttons lack `aria-expanded`/`aria-controls`** — state changes are invisible to assistive tech.
- **Color contrast failures:** `.client-chip` text `#a58b8e` on white ≈ **3.1:1** (fails AA 4.5:1); `--ink-faint: #8a767a` at 13.5px ≈ **4.25:1** (marginal fail) — used for stat labels, office text, footer bottom. Darken both a step.
- **Rotating headline** swaps `<h1>` text every 3s once the user interacts; screen readers can re-announce it. Wrap the rotator in `aria-hidden="true"` with a visually-hidden static phrase for AT.
- **Theme toggle** could expose state via `aria-pressed`.

### 7. Reduced-motion coverage is incomplete
The `prefers-reduced-motion` block stops the hero, aurora, marquee, and beam — but the **sticker animations keep running**: `stickerWiggle`, `spinSlow`, `orbit`, `beat`, `twinkle`, `flicker`, `rocketBob`, plus the terminal typing animation. Add them to the reduced-motion override.

### 8. No social share image
There's `og:title`/`og:description` but **no `og:image` or `twitter:image`** on either page. Links shared on LinkedIn/Slack/WhatsApp — the main channels for a B2B services firm — render with no visual. Add a 1200×630 branded card and switch `twitter:card` to `summary_large_image`.

### 9. Placeholder LinkedIn link
The footer social icon points to `https://www.linkedin.com/` — the generic homepage, not the company profile. Point it at the actual NeuAlto page or remove it.

### 10. Canonical/URL mismatch on careers page
Canonical is `https://neualto.com/careers` but the file is `careers.html` and all internal links use `careers.html`. Unless the host rewrites extensionless URLs, the canonical points at a 404 (and JobPosting `url` values inherit the problem). Align the canonical with the real served URL, and add a `robots.txt` + `sitemap.xml` while you're at it.

### 11. Performance: fonts and always-on canvases
- **Nine font files** load render-blocking from Google Fonts (Inter ×5 weights, Sora ×3). Trim to ~4 weights, and consider self-hosting with `<link rel="preload">`.
- **Four canvas animations** run per frame. The IntersectionObserver pause is good, but on mobile/touch devices the hero globe still burns battery for zero hover benefit. Consider skipping canvas init when `matchMedia('(pointer: coarse)')` or viewport < ~720px.
- The scroll progress bar animates `width` — use `transform: scaleX()` to stay off the layout/paint path.
- The `resize` handler is unthrottled — debounce it.

---

## 🟡 Low priority / polish

- **`spoorthy@neualto.com` is plain text**, not a `mailto:` link, in both job cards.
- **Announcement bar isn't dismissible** — a small ✕ with a `localStorage` flag would help repeat visitors.
- **No 404 page** — add a branded `404.html` (most static hosts pick it up automatically).
- **Rotating word causes layout shift**: the four phrases differ in length, so the centered `<h1>` reflows every 3s. Reserve width with `min-width`/grid-stack or accept it.
- **FAQ JSON-LD text drifts slightly from visible text** — Google prefers exact matches; sync them.
- **Inline style** on the careers page (`style="color:var(--red)..."`) — move to a class.
- **Footer `h4` headings** appear without a preceding `h2`/`h3` in the footer region — harmless, but cleaner as styled `<p>`/`<div>`.
- **Trust content is thin**: testimonials have names/companies but no photos or links; client marquee is text chips. Even one short case study would materially strengthen conversion.
- **Analytics**: nothing is measured. Add a privacy-friendly analytics tool (Plausible, Fathom, GA4) so future improvements can be validated.
- **Deployment hardening** (host-level): security headers (CSP, `X-Content-Type-Options`, HSTS), asset minification, and long-cache headers for CSS/JS.

---

## What's already good ✅

- Zero JS console errors on both pages; no horizontal overflow at desktop or 375px mobile.
- All in-page anchor links resolve; no missing `alt`s; icon buttons all have `aria-label`s.
- Solid SEO baseline: titles, meta descriptions, canonicals, Organization/FAQ/JobPosting/Breadcrumb JSON-LD.
- Dark mode with FOUC-free inline init, `color-scheme`, and per-theme `theme-color`.
- `prefers-reduced-motion` respected for the heaviest animations.
- Performant animation engineering: rAF-throttled scroll handler, typed arrays, IntersectionObserver-paused canvases, DPR capped at 2.
- Lightweight by design — no image payloads, no JS frameworks, SVG favicon.

## Suggested order of attack

1. Mobile hamburger nav (highest traffic impact)
2. Contact form + fix Apply flow
3. Privacy policy page + fix dead link + real LinkedIn URL
4. Resolve "Explore now" dead CTAs
5. Refresh job postings + complete JobPosting schema
6. Accessibility pass (landmarks, tabs/accordion ARIA, contrast)
7. og:image + canonical fix + sitemap/robots
8. Font diet + canvas gating on mobile
