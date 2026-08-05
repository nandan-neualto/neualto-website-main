# Build prompt — NeuAlto site assistant (no LLM)

Copy everything below the line into your code generator. It is self-contained — it carries the design tokens, code conventions, page map, and FAQ content, so the model does not need access to the repo.

---

## PROMPT — copy from here

You are building a **zero-dependency, no-LLM website assistant** for an existing static marketing site (NeuAlto Technologies). It is a scripted FAQ bot plus client-side search over hand-authored content. **No API calls, no network requests, no backend, no LLM, no third-party libraries.** Everything runs offline in the browser.

### 1. Non-negotiable constraints

1. **Vanilla JavaScript only** — no React, no jQuery, no build step, no npm, no bundler. ES5-compatible syntax (`var`, `function`) to match the existing codebase.
2. **Zero HTML file edits.** The site has 9 HTML pages that all load the same `app.js` and `styles.css`. Your JavaScript must **inject the entire widget DOM itself** at runtime. Do not ask me to paste markup into any HTML file.
3. **Two files only:** append a module to `app.js`, append a CSS section to `styles.css`. Nothing else.
4. **Must work from `file://`** as well as over HTTP — so no `fetch()` of local JSON. The knowledge base is a JavaScript constant inside `app.js`.
5. **No network requests of any kind.** If the code would make one, the design is wrong.
6. **It must never invent an answer.** If nothing matches confidently, it says so and offers the contact page. This is the entire point of the no-LLM approach — preserve it.

### 2. Existing code conventions you must follow exactly

`app.js` is one IIFE containing a registry of feature modules. It already provides these helpers in scope — **use them, do not redefine them**:

```js
Env.reducedMotion   // boolean — true if user prefers reduced motion
Env.isDark()        // boolean — true if data-theme="dark" on <html>
$(selector, root)   // querySelector
$$(selector, root)  // querySelectorAll, returns a real Array
escapeHtml(value)   // escapes & < > " ' for safe template interpolation
rafThrottle(fn)     // calls fn at most once per animation frame
debounce(fn, wait)  // calls fn only after `wait` ms of quiet
```

Your module must follow this exact shape and be appended to the `MODULES` array:

```js
/**
 * Site assistant — scripted FAQ + client-side search.
 * ...JSDoc explaining the module...
 */
var siteAssistant = {
  name: 'siteAssistant',
  init: function () {
    // Build and inject the widget. Exit quietly if it should not run here.
  }
};

var MODULES = [ /* …existing modules…, */ siteAssistant ];
```

Modules are initialised inside individual `try/catch` blocks, so a failure degrades to "the widget is missing" rather than breaking the page. Keep that property — do not throw at import time.

**Any user-supplied string rendered into HTML must go through `escapeHtml()`.** Search queries are user input.

### 3. Design system — use these exact values

The site is themed with CSS custom properties that flip on `[data-theme="dark"]`. **Never hard-code a colour** — use these tokens so the widget themes automatically.

```
Light (:root)                     Dark ([data-theme="dark"])
--ink:        #1c0a0d             --ink:        #f6ebec
--ink-soft:   #5c4a4e             --ink-soft:   #cdb2b6
--ink-faint:  #7d686c             --ink-faint:  #9d8085
--red:        #dc2626             --red:        #ef4444
--red-deep:   #a61b1b
--coral:      #ff7a59             --coral:      #ff8f70
--red-tint:   #fdf0f0             --red-tint:   #2a1216
--red-tint-2: #fadede             --red-tint-2: #46191e
--line:       #f0e4e5             --line:       #2f191d
--bg:         #ffffff             --bg:         #0f0708
--bg-soft:    #fcf8f8             --bg-soft:    #150a0c
--card:       #ffffff             --card:       #1c0e11
--radius:     18px
--shadow-sm, --shadow-md, --shadow-lg   (already defined per theme)
```

- **Fonts:** `'Sora'` for headings/labels (600/700/800), `'Inter'` for body (400/500/600/700/800). Both already loaded.
- **Brand accent:** red `--red` → coral `--coral` gradients, e.g. `linear-gradient(100deg, var(--red-deep), var(--red) 45%, var(--coral))`.
- **Buttons** reuse existing `.btn`, `.btn-primary`, `.btn-ghost` classes where sensible.
- Rounded corners, soft shadows, 1px `--line` borders — match the existing card language.

`styles.css` is organised in layers with banner comments: `FOUNDATION → LAYOUT → CHROME → COMPONENTS → HOME PAGE → SUB PAGES → RESPONSIVE → MOTION PREFERENCES`. **Add your styles as a new sub-section inside the `COMPONENTS` layer**, and add any animation's counterpart to the single `MOTION PREFERENCES` block at the end of the file.

### 4. Accessibility requirements (hard requirements, not nice-to-haves)

The site already meets WCAG AA and has a skip link, `<main id="main">`, full ARIA tab pattern, and visible focus rings. Match that bar:

- Launcher is a `<button>` with a clear `aria-label` and `aria-expanded`.
- Panel is `role="dialog"` `aria-modal="false"` with `aria-label`, and is **not** a focus trap that blocks the page — but pressing `Escape` closes it and returns focus to the launcher.
- Search input is a proper `<input type="search">` with an associated `<label>` (visually hidden is fine).
- Results list uses `role="listbox"` / `role="option"`, navigable with **Arrow Up/Down**, selectable with **Enter**, dismissable with **Escape**.
- Result count announced via a polite live region (`aria-live="polite"`), debounced so it doesn't spam a screen reader on every keystroke.
- All interactive elements reachable by keyboard, in a sensible tab order.
- Respect `Env.reducedMotion` — no slide/fade animations when it's true.
- Colour contrast ≥ 4.5:1 for text in **both** themes.

### 5. What to build

#### 5.1 Launcher
A floating circular button, bottom-right, above the existing "back to top" button (which sits at `right: 26px; bottom: 26px` with `z-index: 150` — place the assistant at `bottom: 88px` or shift sensibly so they never overlap). Brand-red, subtle shadow, a chat/search glyph as inline SVG. Shows a small dismissible one-time hint on first visit ("Looking for something?"), remembered via `localStorage` inside a `try/catch` (private mode can throw).

#### 5.2 Panel
Opens above the launcher; on screens < 620px it becomes a near-full-screen sheet. Contains:

1. **Header** — "Ask NeuAlto" title, close button.
2. **Search input** — autofocus on open, `placeholder="Search services, products, careers…"`.
3. **Quick-reply chips** shown when the input is empty — the scripted-bot half. Suggested set:
   `What do you do?` · `DeltaMax` · `OptiMax` · `EDI / data migration` · `Cybersecurity` · `Careers` · `Contact` · `Offices`
   Clicking a chip runs its canned query.
4. **Results area** — up to 5 matches. Each result: title, one-line snippet, and the page it lives on. Clicking navigates to that page + anchor and closes the panel.
5. **Empty/no-match state** — explicitly says it couldn't find an answer, and offers: a link to `index.html#contact`, the email `info@neualto.com`, plus 3–4 top page links. **Never fabricate an answer.**
6. **Footer note** — small text: "Searches this site only."

#### 5.3 Behaviour
- Debounce input by ~120ms using the existing `debounce()` helper.
- Search runs on every keystroke; results update live.
- Panel state does not persist across page loads (it's a static site, each nav is a fresh load) — but the "hint dismissed" flag does.
- If a `?q=` query parameter is present in the URL, open the panel and pre-fill it (lets you link to a search).

### 6. Search algorithm — specify precisely

Implement a small scoring search. **No fuzzy library** — hand-roll it.

**Index build (once, at init):** from the knowledge base array, build a searchable record per entry: `{ id, title, url, section, type, keywords[], body }`.

**Query processing:**
1. Lowercase, strip punctuation, collapse whitespace, split on spaces.
2. Drop stopwords: `the, a, an, and, or, of, to, for, in, on, is, are, do, does, what, how, can, you, your, i, we, with, at, it`.
3. Discard the query if fewer than 2 characters remain.

**Scoring — sum per matched token:**

| Match location | Exact token | Prefix match (token starts with query token, ≥3 chars) | Edit distance 1 (only for tokens ≥5 chars) |
|---|---|---|---|
| `title` | 10 | 5 | 3 |
| `keywords` (incl. synonyms) | 8 | 4 | 2 |
| `body` | 2 | 1 | 0 |

- Add a **+4 bonus** if *all* query tokens match the same entry.
- Add a **+2 bonus** if the entry's page matches the page the visitor is currently on (local relevance).
- Sort descending, take top 5.
- **Confidence gate:** if the best score is below `8`, show the no-match state instead of weak results. This is the guardrail that keeps it honest.

Implement Levenshtein distance as a small bounded helper (early-exit once distance > 1) — it only needs to answer "is the distance ≤ 1?".

**Synonym expansion:** map common phrasings onto entry keywords, e.g.
`price/pricing/cost/quote/rate` → contact · `job/jobs/hiring/vacancy/vacancies/apply/role` → careers · `data quality/anomaly/reconciliation/migration/pipeline` → deltamax · `marketing/campaign/roi/revenue/segmentation/ltv` → optimax · `security/infosec/ciso/pentest/compliance` → cybersecurity · `k8s/kubernetes/devops/cloud/container` → devsecops · `qa/testing/automation/regression` → testing · `edi/x12/edifact/cleo/b2b/trading partner` → edi · `who/founder/team/leadership` → founders · `where/address/location/office/india/usa/bangalore` → offices.

### 7. Knowledge base content — use this verbatim as the seed

Structure each entry as: `{ id, title, url, section, type, keywords, body }` where `url` is a page + optional anchor. **The `body` text below is the answer shown to the user — keep it factual, do not embellish.**

**Company**
- **What NeuAlto does** → `index.html#services` — Enterprise software services and consulting across AI, cloud, data, engineering, quality, and cybersecurity. Headquartered in Bangalore, India with a US presence. Six service lines and two products.
- **Why NeuAlto** → `index.html#why` — Extensive expertise, customer satisfaction, quality assurance, strategic scalability.
- **How are we different** → `index.html#about` — Value proposition: accelerate speed to market, leverage emerging technologies, optimize engineering services. Differentiators: secure development life cycle, standard software engineering practices.
- **Engagement models** → `index.html#engage` — Extended Product Engineering, Fixed-Price Delivery, Consulting & Time-and-Materials.
- **Founders** → `index.html#founders` — Hemanth K Rajasekhar (Founder & Managing Director, India, Bangalore) and Mohan Bethur (Founder & Managing Director, United States).
- **Partners** → `index.html#partners` — Katalyst Street and CrashPlan.
- **Offices** → `index.html#contact` — India (HQ): 42, Old Kanakapura Rd, near Mecon Limited, Basavanagudi, Bengaluru, Karnataka 560004, +91 733 855 5064. United States: 6470 East Johns Crossing, Suite 160, Johns Creek, GA 30097, +1-408-218-0503.
- **Contact** → `index.html#contact` — Email info@neualto.com, or use the contact form on the home page.

**Services** (all on `services.html`)
- **Managed AI Services** → `#managed-ai` — End-to-end management of AI/ML workloads: discovery, implementation, deployment, monitoring. Benefits: high availability, scalability, risk management, continuous monitoring and support, security and compliance.
- **DevSecOps, Cloud Engineering & Kubernetes** → `#devsecops` — Cloud migration and modernisation, DevSecOps managed services, Kubernetes and containers, cloud security. Multi-cloud across AWS, Azure, GCP.
- **Data Transformation & Migration (EDI)** → `#edi` — EDI migration, ANSI X12 and EDIFACT, ERP integration, cloud-based EDI, B2B trading partner onboarding.
- **Engineering & IT** → `#engineering` — Full stack development, mobile apps, embedded software, patient monitoring systems, networking and communication systems, operating systems, board designs.
- **Testing & Automation** → `#testing` — QA automation strategy: evaluation, tool identification, develop and execute, regression suites. Early bug detection, agile practices, continuous testing.
- **Cybersecurity Consulting & vCISO** → `#cybersecurity` — Cybersecurity strategy and advisory, security program design, security controls and compliance, virtual Chief Information Security Officer services.

**Products**
- **DeltaMax™ overview** → `solutions.html#deltamax` — Intelligent Data Quality Monitoring Platform. "Never Fly Blind Again." AI-driven anomaly detection and intelligent reconciliation for enterprise data pipelines. Trust Score, Agent Summary, data cleaning, master data management.
- **DeltaMax on GCP & Azure** → `deltamax.html` — Deploys as a VM in your own cloud project. GCP: outputs to Cloud Storage → BigQuery → Looker Studio. Azure (V2.0): Blob Storage → Synapse Analytics → Power BI, with H–A–B multi-period framework and Trust Score.
- **DeltaMax — buy** → `deltamax.html#buy` — Available on the Google Cloud Marketplace; contact us for Azure deployment.
- **OptiMax overview** → `solutions.html#optimax` — Data/AI-driven marketing framework that turns marketing into a revenue engine. Two stages: Response Optimization and Revenue Optimization (customer lifetime value).
- **OptiMax deep dive** → `optimax.html` — Insights, conceptual demo, how to get started (Chocky the Chocolate Shop walkthrough), agentic outputs, GCP Marketplace listing.

**Careers** (all on `careers.html`)
- **Open roles** → `#openings` — Two roles open, both on-site in Bangalore. Apply to hr@neualto.com or via LinkedIn.
- **EDI Senior Developer** → `#edi-developer` — 4–6 years, Bangalore, full-time. Cleo Integration Cloud (CIC) mandatory. X12 maps (850, 856, 810, 940, 943, 944, 945), ANSI X12 and EDIFACT, ERP integration.
- **Sr. MERN Developer** → `#mern-developer` — 5+ years, Bangalore, full-time. TypeScript, React, React Router 7, CSS Modules, Vitest/Jest, Node.js with HAPI, DynamoDB, S3, Redis, Temporal preferred.

**Other**
- **Blog & updates** → `blog.html` — Field notes on data quality, anomaly detection, AI reliability and cloud engineering, published first on LinkedIn.
- **Privacy policy** → `privacy.html` — How NeuAlto collects, uses and protects information. DPDP Act 2023 and GDPR aware.
- **Pricing** → `index.html#contact` — Pricing depends on scope and engagement model. There is no public price list — contact us and we'll scope it with you. *(This entry exists specifically so pricing questions get an honest answer instead of nothing.)*

### 8. Page and anchor map (for building URLs)

```
index.html      #top #services #solutions #why #about #engage
                #testimonials #clients #partners #faq #founders #careers #contact
services.html   #managed-ai #devsecops #edi #engineering #testing #cybersecurity
solutions.html  #deltamax #optimax
deltamax.html   #gcp #gcp-insights #gcp-why #gcp-architecture #gcp-recovery
                #gcp-competitive #gcp-started #gcp-results #azure #faqs #buy
optimax.html    #insights #demo #started #outputs #buy
careers.html    #openings #edi-developer #mern-developer
blog.html       (topic filters)
privacy.html    (14 numbered sections)
404.html
```

**Important:** links must be **relative** (`services.html#edi`, not `/services.html#edi`) so they work from `file://` and from any subdirectory.

### 9. Performance budget

- Added JS: **under ~12KB** unminified, including the knowledge base.
- Added CSS: **under ~4KB**.
- No layout shift — the widget is `position: fixed` and must not affect document flow.
- Index build must be lazy: build it on **first panel open**, not at page load.
- No blocking work on the main thread at load.

### 10. Deliverables

Output exactly three things:

1. **The `siteAssistant` module** — a complete, commented block to paste into `app.js` before the `MODULES` array, plus the one-line change to `MODULES`.
2. **The CSS block** — a complete section to paste into the `COMPONENTS` layer of `styles.css`, plus any lines to add to the existing `MOTION PREFERENCES` media query.
3. **A short integration note** — where each block goes, and the manual test checklist below.

### 11. Acceptance criteria — verify each before you finish

- [ ] Widget appears on **all 9 pages** with no HTML edits
- [ ] Zero network requests (check DevTools Network tab — must be empty)
- [ ] Works when the page is opened directly from disk (`file://`)
- [ ] Correct in **both** light and dark themes; follows the theme toggle live
- [ ] Keyboard-only: Tab to launcher → Enter opens → type → Arrow keys → Enter navigates → Escape closes, focus returns to launcher
- [ ] Screen reader announces result count once per settled query, not per keystroke
- [ ] Does not overlap or block the existing back-to-top button
- [ ] Mobile (375px): usable full-screen sheet, no horizontal overflow anywhere
- [ ] Query "pricing" returns the honest no-price-list answer
- [ ] Query "kubernetes" returns DevSecOps; "x12" returns EDI; "anomaly" returns DeltaMax
- [ ] Gibberish query ("asdfgh") shows the no-match state with contact links — **not** a wrong answer
- [ ] Typo tolerance: "kubernets" and "cybersecurty" still find the right entry
- [ ] `prefers-reduced-motion: reduce` disables open/close animation
- [ ] No console errors or warnings on any page

### 12. Style of your output

Write production-quality, commented code in the voice of a senior engineer. Explain non-obvious decisions in comments (why the confidence gate exists, why the index is lazy). Do not include placeholder `TODO`s — deliver something complete and runnable. Prefer clarity over cleverness.

## PROMPT — copy to here

---

## Notes for you (not part of the prompt)

- **Everything lands in two files.** The "inject the DOM from JS" instruction exists specifically to avoid the nine-file header/footer edit problem this repo already has.
- **The confidence gate (§6) is the important bit.** Below score 8 it refuses rather than guessing. That's the whole value of the no-LLM route — don't let a generator optimise it away for "better coverage."
- **The knowledge base is the product.** The search code is commodity; answer quality is entirely down to §7. Expect to edit that list after watching real queries — the pricing entry is there because it's the most common question with no page to point at.
- **Good upgrade path.** If you later build the Claude-powered version from `CHATBOT-RESEARCH.md`, this widget becomes its offline fallback for when the API is unreachable — the UI, the launcher, and the knowledge base all carry over.
