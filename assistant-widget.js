/**
 * NeuAlto Assistant — zero-dependency FAQ & client-side search widget
 * =====================================================================
 *
 * A mascot companion that answers questions using only content already on
 * this site. No network calls, no build step, no dependencies. Renders in a
 * Shadow DOM so the host page's CSS can never leak in (and this widget's CSS
 * can never leak out). Works from `file://`.
 *
 * FILE LAYOUT
 * -----------
 *   1. CONFIG           — defaults, overridable via window.NeuAltoAssistantConfig
 *   2. KNOWLEDGE BASE   — the content (id / c / q / alts / k / a / href / rel)
 *   3. SYNONYMS         — domain acronym + spelling expansion
 *   4. SEARCH ENGINE    — tokenizer, stemmer, edit distance, weighted scorer
 *   5. INTENTS          — small-talk detection (greeting/thanks/bye/…)
 *   6. INSIGHTS         — local-only log of unanswered / unhelpful questions
 *   7. MARKDOWN → DOM   — tiny **bold** / [link]() / "- " / paragraph parser
 *   8. UI               — Shadow DOM: mascot launcher, companion card, chat, browse
 *   9. PUBLIC API       — window.NeuAltoAssistant
 *
 * Sections 1–6 have no DOM dependency and are exported via `module.exports`
 * under Node — that's what lets `assistant-widget.test.js` exercise the search
 * engine directly, without a browser.
 */
(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════════
     1. CONFIG
     ══════════════════════════════════════════════════════════════════════ */

  var hasWindow = typeof window !== 'undefined';
  var userConfig = (hasWindow && window.NeuAltoAssistantConfig) || {};

  function opt(key, fallback) {
    return userConfig[key] !== undefined ? userConfig[key] : fallback;
  }

  var CONFIG = {
    title: opt('title', 'NeuAlto Bot'),
    subtitle: opt('subtitle', 'Your friendly helper'),
    accent: opt('accent', '#dc2626'),
    accentDeep: opt('accentDeep', '#a61b1b'),
    mascot: opt('mascot', 'pics/chat-widget.webp'),
    position: userConfig.position === 'left' ? 'left' : 'right',
    storageKey: opt('storageKey', 'neualto_assistant_v2'),
    insightsKey: opt('insightsKey', 'neualto_assistant_insights'),
    /** Scroll depth (px) before the launcher appears. */
    revealAfter: opt('revealAfter', 420),
    tipDelayMs: opt('tipDelayMs', 9000),
    tipIntervalMs: opt('tipIntervalMs', 45000),
    tipMaxPerSession: opt('tipMaxPerSession', 2),
    /** Log unanswered / thumbs-down questions to localStorage (never sent anywhere). */
    collectInsights: opt('collectInsights', true),
    /** Optional callback: fn(query, topResult|null, answered:boolean) */
    onQuery: opt('onQuery', null),
    /**
     * Tuned empirically by assistant-widget.test.js, which reports the measured
     * gap between the weakest true positive and the strongest false positive.
     * Do not hand-adjust without re-running it.
     */
    confidenceThreshold: opt('confidenceThreshold', 3.6)
  };

  /* ══════════════════════════════════════════════════════════════════════
     2. KNOWLEDGE BASE
     Loaded from kb-data.js — NOT inline here. That is the file to edit; this
     just wires it in. See kb-data.js's header comment for the field
     reference and the schema every entry follows.
     ══════════════════════════════════════════════════════════════════════ */

  var ENTRIES;
  if (hasWindow && window.NEUALTO_KB) {
    ENTRIES = window.NEUALTO_KB;
  } else if (typeof module !== 'undefined' && module.exports) {
    ENTRIES = require('./kb-data.js');
  } else {
    ENTRIES = []; // kb-data.js <script> tag missing on this page
  }

  var ENTRY_BY_ID = {};
  ENTRIES.forEach(function (entry) { ENTRY_BY_ID[entry.id] = entry; });

  /* ══════════════════════════════════════════════════════════════════════
     3. SYNONYMS
     Domain acronyms and spelling variants a visitor will realistically type
     but which don't appear verbatim in the copy. Deliberately high-precision:
     every pair here is unambiguous in this domain. Expansions score at a
     discount (SYNONYM_WEIGHT) so a real word always beats a synonym match.
     ══════════════════════════════════════════════════════════════════════ */

  /**
   * Synonym matches score just below a literal one. These are hand-curated
   * exact equivalences ("k8s" *is* Kubernetes), not guesses, so the discount is
   * small — set too low, a precise domain acronym loses to a vague everyday
   * word that happens to appear verbatim.
   */
  var SYNONYM_WEIGHT = 0.9;

  var SYNONYMS = {
    k8s: ['kubernetes'], kube: ['kubernetes'],
    ml: ['machine', 'learning'], genai: ['generative'],
    devops: ['devsecops'], ciso: ['vciso'],
    x12: ['edi'], edifact: ['edi'], b2b: ['edi'],
    gcp: ['google', 'cloud'], aws: ['amazon', 'cloud'],
    qa: ['testing', 'quality'],
    // The site uses both spellings of the city, in different places.
    bangalore: ['bengaluru'], bengaluru: ['bangalore'],
    hq: ['headquarters'], usa: ['us', 'america'],
    job: ['career', 'hiring'], jobs: ['career', 'hiring'],
    role: ['job', 'career'], vacancy: ['job', 'career'],
    resume: ['cv', 'apply'], cv: ['resume', 'apply'],
    cost: ['price', 'pricing'], price: ['cost', 'pricing'],
    pricing: ['cost', 'price'], rates: ['cost', 'price'],
    buy: ['purchase', 'price'], purchase: ['buy'],
    email: ['contact'], phone: ['contact'], call: ['contact'],
    docs: ['documentation'], sdlc: ['development'],
    mdm: ['master', 'data'], psi: ['drift'],
    ltv: ['lifetime', 'value'], cltv: ['lifetime', 'value'],
    cac: ['acquisition', 'cost'], roi: ['revenue', 'return']
  };

  /* ══════════════════════════════════════════════════════════════════════
     4. SEARCH ENGINE
     A small weighted scorer — no fuzzy-string library. Every design choice
     below exists because a naive version gets ranking wrong in a specific way,
     noted inline.
     ══════════════════════════════════════════════════════════════════════ */

  var FIELD_WEIGHTS = { q: 10, alts: 8, k: 6, c: 3, a: 1 };
  /**
   * Function words plus low-information filler ("know", "tell", "like") that
   * appears in how people phrase questions rather than in what they're asking
   * about. Filler must be removed here rather than discounted later: left in,
   * it drags down the coverage ratio of an otherwise perfect question
   * ("do you know k8s" is a one-word question wearing a four-word coat).
   * Genuine off-topic words must NOT go here — penalising those is the whole
   * job of the coverage ratio.
   */
  var STOPWORDS = {
    a: 1, an: 1, the: 1, is: 1, are: 1, do: 1, does: 1, i: 1, to: 1, of: 1,
    for: 1, you: 1, your: 1, we: 1, what: 1, how: 1, can: 1, with: 1, and: 1,
    in: 1, on: 1, me: 1, my: 1, it: 1, at: 1, be: 1, or: 1,
    know: 1, tell: 1, about: 1, there: 1, this: 1, that: 1, these: 1, those: 1,
    have: 1, has: 1, had: 1, been: 1, was: 1, were: 1, will: 1, would: 1,
    should: 1, could: 1, may: 1, might: 1, must: 1, just: 1, really: 1,
    very: 1, please: 1, us: 1, our: 1, their: 1, them: 1, they: 1,
    from: 1, by: 1, as: 1, but: 1, if: 1, then: 1, than: 1, so: 1,
    more: 1, most: 1, much: 1, many: 1, also: 1, too: 1,
    like: 1, look: 1, get: 1, give: 1, show: 1, want: 1, need: 1, any: 1, some: 1
  };

  /** Strips the markdown subset down to plain words, for the answer-body field. */
  function stripMarkdown(text) {
    return String(text || '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/[*_`#\n-]/g, ' ');
  }

  /**
   * Light stemming — only long, unambiguous suffixes. Deliberately not clever:
   * aggressive stemming (dropping "-e", collapsing "-y") creates false matches
   * between unrelated words, which is worse than under-stemming.
   */
  function stem(word) {
    if (word.length > 6 && /ing$/.test(word)) return undouble(word.slice(0, -3));
    if (word.length > 5 && /ed$/.test(word) && !/eed$/.test(word)) return undouble(word.slice(0, -2));
    if (word.length > 4 && /ies$/.test(word)) return word.slice(0, -3) + 'y';
    if (word.length > 4 && /s$/.test(word) && !/ss$/.test(word) && !/us$/.test(word) && !/is$/.test(word)) return word.slice(0, -1);
    return word;
  }

  /**
   * Collapses the doubled consonant English adds before -ing/-ed, so that
   * "mapping" and "maps" both reduce to "map" instead of stranding "mapp".
   * Restricted to consonants that actually get doubled, so "pass" or "add"
   * (where the doubling is part of the word) are left alone.
   */
  function undouble(word) {
    return /([bdgklmnprt])\1$/.test(word) ? word.slice(0, -1) : word;
  }

  function tokenize(text) {
    var raw = String(text || '').toLowerCase().match(/[a-z0-9][a-z0-9'&./-]*[a-z0-9]|[a-z0-9]/g) || [];
    var out = [];
    raw.forEach(function (word) {
      word = word.replace(/^['./-]+|['./-]+$/g, '');
      if (!word) return;
      if (STOPWORDS[word] && raw.length > 1) return;
      out.push(stem(word));
    });
    return out;
  }

  /**
   * Turns a query into terms, each carrying its own variants. Grouping the
   * synonyms *under* their source term (rather than flattening them into the
   * token list) keeps the coverage maths honest: "k8s" stays one term the user
   * typed, not two terms they didn't.
   */
  function queryTerms(query) {
    var raw = String(query || '').toLowerCase().match(/[a-z0-9][a-z0-9'&./-]*[a-z0-9]|[a-z0-9]/g) || [];
    var terms = [];
    raw.forEach(function (word) {
      word = word.replace(/^['./-]+|['./-]+$/g, '');
      if (!word) return;
      if (STOPWORDS[word] && raw.length > 1) return;
      var variants = [{ tok: stem(word), weight: 1 }];
      var syns = SYNONYMS[word];
      if (syns) {
        syns.forEach(function (s) { variants.push({ tok: stem(s), weight: SYNONYM_WEIGHT }); });
      }
      terms.push({ variants: variants });
    });
    return terms;
  }

  /** Bounded Levenshtein — bails out as soon as the bound is provably exceeded. */
  function editDistance(a, b, maxDist) {
    if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
    var prev = [];
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      var cur = [i];
      var rowMin = i;
      for (var jj = 1; jj <= b.length; jj++) {
        var cost = a[i - 1] === b[jj - 1] ? 0 : 1;
        var val = Math.min(prev[jj] + 1, cur[jj - 1] + 1, prev[jj - 1] + cost);
        cur[jj] = val;
        if (val < rowMin) rowMin = val;
      }
      if (rowMin > maxDist) return maxDist + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  function maxFuzzyDistance(len) {
    if (len >= 7) return 2;
    if (len >= 4) return 1;
    return 0;
  }

  /**
   * Scores one query token against one field token.
   * Returns { score, strong } or null when there is no match at all.
   *
   * Prefix matches are scaled by how much of the LONGER word the shorter one
   * covers — 4 letters hitting a 4-letter word is a full match; the same 4
   * letters hitting a 12-letter word should barely count. Without this,
   * short/generic query words wrongly favour long unrelated field words that
   * merely happen to start the same way.
   */
  function matchToken(queryTok, fieldTok) {
    if (queryTok === fieldTok) return { score: 1, strong: true };
    var minLen = Math.min(queryTok.length, fieldTok.length);
    var maxLen = Math.max(queryTok.length, fieldTok.length);
    if (minLen >= 3 && (fieldTok.indexOf(queryTok) === 0 || queryTok.indexOf(fieldTok) === 0)) {
      return { score: 0.35 + 0.55 * (minLen / maxLen), strong: true };
    }
    var bound = maxFuzzyDistance(minLen);
    if (bound > 0 && editDistance(queryTok, fieldTok, bound) <= bound) {
      return { score: 0.32, strong: false };
    }
    return null;
  }

  function fieldTokens(entry, field) {
    if (field === 'a') return tokenize(stripMarkdown(entry.a));
    if (field === 'alts') return tokenize((entry.alts || []).join(' '));
    if (field === 'k') return tokenize((entry.k || []).join(' '));
    if (field === 'c') return tokenize(entry.c);
    return tokenize(entry.q);
  }

  function indexEntry(entry) {
    var fields = {};
    Object.keys(FIELD_WEIGHTS).forEach(function (f) { fields[f] = fieldTokens(entry, f); });
    return {
      entry: entry,
      fields: fields,
      qJoined: fields.q.join(' '),
      altsJoined: fields.alts.join(' '),
      haystack: (entry.q + ' ' + (entry.alts || []).join(' ')).toLowerCase()
    };
  }

  /**
   * The index is built on first search rather than at load, so simply loading
   * the script on a page nobody opens the widget on costs nothing.
   */
  var INDEX = null;
  var DF = null;      // token -> how many entries contain it
  var DOC_COUNT = 0;

  function buildDf(index) {
    var df = {};
    index.forEach(function (indexed) {
      var seen = {};
      Object.keys(FIELD_WEIGHTS).forEach(function (field) {
        indexed.fields[field].forEach(function (tok) {
          if (seen[tok]) return;
          seen[tok] = 1;
          df[tok] = (df[tok] || 0) + 1;
        });
      });
    });
    return df;
  }

  function getIndex() {
    if (!INDEX) {
      INDEX = ENTRIES.map(indexEntry);
      DF = buildDf(INDEX);
      DOC_COUNT = INDEX.length;
    }
    return INDEX;
  }

  /**
   * Inverse document frequency, squashed into [0.4, 1].
   *
   * Without this every query word counts the same, so a common word like
   * "experience" outweighs a rare, highly diagnostic one like "kubernetes" —
   * which is precisely how "kube experience" used to land on the wrong entry.
   * Bounding the range (rather than using raw IDF) keeps scores in the same
   * numeric ballpark as before, so the tuned threshold stays meaningful.
   */
  function idf(token) {
    if (!DF) return 1;
    var freq = DF[token] || 0;
    if (!freq) return 1; // out of vocabulary: never actually matches anything
    var raw = Math.log(1 + DOC_COUNT / (1 + freq));
    var max = Math.log(1 + DOC_COUNT);
    return 0.4 + 0.6 * (raw / max);
  }

  /**
   * How much it costs to leave this query term unmatched.
   *
   * A word the corpus uses constantly ("experience", "service") is cheap to
   * miss — the question can still be well understood without it. A word the
   * corpus has never seen ("shoes") is expensive, because not matching it is
   * the strongest evidence we have that the visitor is asking about something
   * this site simply doesn't cover. idf() already returns its maximum for
   * out-of-vocabulary tokens, so that fallback is automatic.
   */
  function termImportance(term) {
    var lowest = null;
    for (var i = 0; i < term.variants.length; i++) {
      var tok = term.variants[i].tok;
      if (DF && DF[tok]) {
        var value = idf(tok);
        if (lowest === null || value < lowest) lowest = value;
      }
    }
    return lowest === null ? 1 : lowest;
  }

  function scoreEntry(indexed, terms, queryRaw, pageContext) {
    if (!terms.length) return null;
    var matchedStrong = 0;
    var matchedAny = 0;
    var raw = 0;

    var totalImportance = 0;
    var matchedImportance = 0;

    for (var t = 0; t < terms.length; t++) {
      var variants = terms[t].variants;
      var best = null;
      var bestWeighted = 0;
      var importance = termImportance(terms[t]);
      totalImportance += importance;

      for (var v = 0; v < variants.length; v++) {
        var variant = variants[v];
        var fieldNames = Object.keys(FIELD_WEIGHTS);
        for (var f = 0; f < fieldNames.length; f++) {
          var field = fieldNames[f];
          var fieldWeight = FIELD_WEIGHTS[field];
          var tokens = indexed.fields[field];
          for (var i = 0; i < tokens.length; i++) {
            var m = matchToken(variant.tok, tokens[i]);
            if (!m) continue;
            // IDF makes a rare word count for more than a common one.
            var weighted = m.score * fieldWeight * variant.weight * idf(tokens[i]);
            if (!best || weighted > bestWeighted) { best = m; bestWeighted = weighted; }
          }
        }
      }

      if (best) {
        raw += bestWeighted;
        matchedAny++;
        matchedImportance += importance;
        if (best.strong) matchedStrong++;
      }
    }

    if (!matchedAny) return null;

    // Coverage: matching part of a query should score far below matching all
    // of it, not merely proportionally lower. Weighting by importance means an
    // unmatched everyday word barely counts, while an unmatched word the site
    // has never used dilutes hard — which is what separates a terse-but-valid
    // question ("kube experience") from an off-topic one ("do you sell shoes").
    var coverageMultiplier = Math.pow(matchedImportance / totalImportance, 1.6);

    // Weak-match discount: if nothing matched strongly this is very likely
    // fuzzy noise — typo-tolerance stacking coincidentally on an unrelated
    // entry — so discount hard rather than letting weak hits accumulate into a
    // confident-looking score.
    var weakMultiplier = 0.35 + 0.65 * (matchedStrong / matchedAny);

    var score = raw * coverageMultiplier * weakMultiplier;

    // Phrase / bigram bonus, so specific queries outrank generic ones that
    // merely share scattered keywords.
    var qLower = String(queryRaw || '').toLowerCase().trim();
    if (qLower.length > 3 && indexed.haystack.indexOf(qLower) !== -1) {
      score += 8;
    } else {
      var flat = [];
      for (var b = 0; b < terms.length; b++) flat.push(terms[b].variants[0].tok);
      for (var g = 0; g < flat.length - 1; g++) {
        var bigram = flat[g] + ' ' + flat[g + 1];
        if (indexed.qJoined.indexOf(bigram) !== -1 || indexed.altsJoined.indexOf(bigram) !== -1) {
          score += 4;
          break;
        }
      }
    }

    // Page context: on the DeltaMax page, DeltaMax answers are marginally more
    // likely to be what was meant. Kept small — it breaks ties, it must never
    // manufacture confidence for an otherwise-irrelevant entry.
    if (pageContext && indexed.entry.href && indexed.entry.href.indexOf(pageContext) === 0) {
      score *= 1.08;
    }

    return { entry: indexed.entry, score: score, strong: matchedStrong > 0 };
  }

  function currentPageFile() {
    if (typeof location === 'undefined') return null;
    var path = location.pathname.split('/').pop();
    return path || 'index.html';
  }

  /**
   * Ranked search over the knowledge base.
   * @returns {Array<{entry, score, strong}>} sorted descending by score
   */
  function search(query) {
    var terms = queryTerms(query);
    if (!terms.length) return [];
    var page = currentPageFile();
    var index = getIndex();
    var results = [];
    for (var i = 0; i < index.length; i++) {
      var r = scoreEntry(index[i], terms, query, page);
      if (r) results.push(r);
    }
    results.sort(function (a, b) { return b.score - a.score; });
    return results;
  }

  /**
   * Suggestions must clear a floor as well as being non-fuzzy: a single
   * coincidental exact-token hit (the word "like" inside "…look like?") is
   * technically strong but not actually close, and offering it as a "did you
   * mean" is worse than offering nothing.
   */
  function suggestions(results, limit) {
    var floor = CONFIG.confidenceThreshold * 0.35;
    return results.filter(function (r) {
      return r.strong && r.score >= floor;
    }).slice(0, limit || 3);
  }

  /* ══════════════════════════════════════════════════════════════════════
     5. CONVERSATIONAL INTENTS
     Checked BEFORE search(). Every pattern is anchored end to end so it only
     fires on messages that are *just* small talk — "who are YOUR partners"
     must never be swallowed by a loose "who are you" pattern. The boundary
     cases this guards against are asserted in assistant-widget.test.js.
     ══════════════════════════════════════════════════════════════════════ */

  var INTENTS = [
    {
      name: 'greeting',
      re: /^(hi|hello|hey|hiya|yo|howdy|good\s?morning|good\s?afternoon|good\s?evening)(\s+(there|team|neualto|folks|alto))?[\s!.,]*$/i,
      reply: "Hey there! I'm NeuAlto Bot, your friendly helper"
    },
    {
      name: 'thanks',
      re: /^(thanks|thank\s?you|thx|ty|much\s+appreciated|appreciate\s+it|cheers|perfect|great|awesome)[\s!.,]*$/i,
      reply: "Happy to help! Anything else you'd like to know?"
    },
    {
      name: 'goodbye',
      re: /^(bye|goodbye|good\s?bye|see\s?ya|see\s+you(\s+later)?|later|farewell|good\s?night)[\s!.,]*$/i,
      reply: "Thanks for stopping by. Reach us anytime at **[info@neualto.com](mailto:info@neualto.com)**."
    },
    {
      name: 'capability',
      re: /^(what\s+can\s+you\s+(do|help(\s+with)?)|what\s+do\s+you\s+know|how\s+can\s+you\s+help(\s+me)?|who\s+are\s+you)\??$/i,
      reply: "I search everything published on this site and answer from it — services, DeltaMax and OptiMax, engagement models, careers, and contact details. I never make anything up: if I can't find it here, I'll say so and point you to a human.\n\nTry one of these, or just type your question."
    },
    {
      name: 'human',
      re: /^(?:(?:i\s+want\s+to\s+|i'd\s+like\s+to\s+|can\s+i\s+|please\s+)?(?:talk|speak|chat)\s+(?:to|with)|connect\s+me\s+(?:to|with)|get\s+me|i\s+want|i\s+need)\s+(?:a\s+|an\s+)?(?:human|person|someone|real\s+person|agent|sales|support)\b.*$/i,
      reply: "Of course — email **[info@neualto.com](mailto:info@neualto.com)** and a real person on our team will get back to you. For careers questions that's **[hr@neualto.com](mailto:hr@neualto.com)**."
    }
  ];

  function detectIntent(message) {
    var trimmed = String(message || '').trim();
    for (var i = 0; i < INTENTS.length; i++) {
      if (INTENTS[i].re.test(trimmed)) return INTENTS[i];
    }
    return null;
  }

  /* ══════════════════════════════════════════════════════════════════════
     6. INSIGHTS
     What visitors asked that we couldn't answer is the single most useful
     signal for improving the knowledge base. Stored in localStorage only —
     never transmitted anywhere — and readable via
     NeuAltoAssistant.getInsights() from the browser console.
     ══════════════════════════════════════════════════════════════════════ */

  var INSIGHT_LIMIT = 100;

  function readInsights() {
    if (typeof localStorage === 'undefined') return { unanswered: [], unhelpful: [] };
    try {
      var raw = localStorage.getItem(CONFIG.insightsKey);
      var parsed = raw ? JSON.parse(raw) : null;
      return {
        unanswered: (parsed && parsed.unanswered) || [],
        unhelpful: (parsed && parsed.unhelpful) || []
      };
    } catch (e) {
      return { unanswered: [], unhelpful: [] };
    }
  }

  function recordInsight(bucket, payload) {
    if (!CONFIG.collectInsights || typeof localStorage === 'undefined') return;
    try {
      var data = readInsights();
      data[bucket].unshift(payload);
      data[bucket] = data[bucket].slice(0, INSIGHT_LIMIT);
      localStorage.setItem(CONFIG.insightsKey, JSON.stringify(data));
    } catch (e) { /* quota or private mode — insights are best-effort */ }
  }

  /* ══════════════════════════════════════════════════════════════════════
     Node / browser boundary.
     Everything above is pure logic with no DOM dependency, which is what lets
     assistant-widget.test.js exercise it under plain `node`. Everything below
     builds and mounts UI.
     ══════════════════════════════════════════════════════════════════════ */

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      CONFIG: CONFIG, ENTRIES: ENTRIES, SYNONYMS: SYNONYMS, INTENTS: INTENTS,
      tokenize: tokenize, queryTerms: queryTerms, stem: stem,
      editDistance: editDistance, matchToken: matchToken,
      search: search, suggestions: suggestions, detectIntent: detectIntent
    };
  }

  if (typeof document === 'undefined' || !hasWindow) return;

  /* ══════════════════════════════════════════════════════════════════════
     7. MARKDOWN → DOM
     Parses the tiny subset into real nodes. Never uses innerHTML — even though
     the content is first-party, this is the habit that matters once
     addEntries() lets runtime code extend the knowledge base.
     ══════════════════════════════════════════════════════════════════════ */

  var doc = document;

  function isExternal(href) {
    return /^https?:\/\//i.test(href) || /^mailto:/i.test(href) || /^tel:/i.test(href);
  }

  function makeLink(text, href) {
    var a = doc.createElement('a');
    a.textContent = text;
    a.href = href;
    a.className = 'nw-link';
    if (/^https?:\/\//i.test(href)) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    return a;
  }

  /**
   * Inline markdown: **bold**, [text](url), and **[text](url)**.
   * The bold-link branch is tried first — a link emphasised for importance is
   * the natural way to write one in this subset, and if the plain-bold branch
   * matched first it would swallow the link syntax as literal text.
   */
  function parseInline(parent, text) {
    var re = /\*\*\[([^\]]+)\]\(([^)]+)\)\*\*|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
    var lastIndex = 0;
    var match;
    while ((match = re.exec(text))) {
      if (match.index > lastIndex) parent.appendChild(doc.createTextNode(text.slice(lastIndex, match.index)));
      if (match[1] !== undefined) {
        var strongLink = doc.createElement('strong');
        strongLink.appendChild(makeLink(match[1], match[2]));
        parent.appendChild(strongLink);
      } else if (match[3] !== undefined) {
        var b = doc.createElement('strong');
        b.textContent = match[3];
        parent.appendChild(b);
      } else {
        parent.appendChild(makeLink(match[4], match[5]));
      }
      lastIndex = re.lastIndex;
    }
    if (lastIndex < text.length) parent.appendChild(doc.createTextNode(text.slice(lastIndex)));
  }

  /** Block markdown: paragraphs, "- " bullets, "1. " ordered items. */
  function markdownToFragment(text) {
    var frag = doc.createDocumentFragment();
    String(text || '').split(/\n\n+/).forEach(function (block) {
      var lines = block.split('\n').filter(function (l) { return l.trim().length; });
      if (!lines.length) return;
      var bullets = lines.every(function (l) { return /^-\s+/.test(l); });
      var ordered = lines.every(function (l) { return /^\d+\.\s+/.test(l); });
      if (bullets || ordered) {
        var list = doc.createElement(ordered ? 'ol' : 'ul');
        list.className = 'nw-list';
        lines.forEach(function (line) {
          var li = doc.createElement('li');
          parseInline(li, line.replace(/^-\s+/, '').replace(/^\d+\.\s+/, ''));
          list.appendChild(li);
        });
        frag.appendChild(list);
      } else {
        var p = doc.createElement('p');
        parseInline(p, lines.join(' '));
        frag.appendChild(p);
      }
    });
    return frag;
  }

  /* ══════════════════════════════════════════════════════════════════════
     8. UI
     ══════════════════════════════════════════════════════════════════════ */

  var STARTERS = ['company-overview', 'deltamax-what', 'services-overview', 'careers-openings'];

  var TIPS = [
    { text: 'Wondering what DeltaMax™ does?', ask: 'What is DeltaMax?' },
    { text: 'I can explain how we like to work together.', ask: 'What engagement models do you offer?' },
    { text: "We're hiring in Bangalore — want the roles?", ask: 'What jobs are open at NeuAlto?' },
    { text: 'Curious how OptiMax turns marketing into revenue?', ask: 'What is OptiMax?' },
    { text: 'Need a human? I can point you the right way.', ask: 'How do I contact NeuAlto?' }
  ];

  function el(tag, className, text) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function icon(pathData) {
    var svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    var p = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', pathData);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '2');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
    return svg;
  }

  /**
   * The mascot renders bare — no disc, frame or padding behind it. The CSS
   * (see `.nw-mascot`) crops away the artwork's built-in transparent margin so
   * the visible character exactly fills its box.
   */
  function mascot(className) {
    var holder = el('span', 'nw-mascot' + (className ? ' ' + className : ''));
    var img = doc.createElement('img');
    img.src = CONFIG.mascot;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    holder.appendChild(img);
    return holder;
  }

  function navigateTo(href) {
    if (!href) return;
    if (/^mailto:|^tel:/i.test(href)) { location.href = href; return; }
    if (/^https?:\/\//i.test(href)) { window.open(href, '_blank', 'noopener'); return; }
    var hashIdx = href.indexOf('#');
    var file = hashIdx === -1 ? href : href.slice(0, hashIdx);
    var hash = hashIdx === -1 ? '' : href.slice(hashIdx);
    if (!file || file === currentPageFile()) {
      if (hash) {
        var target = doc.getElementById(hash.slice(1));
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          if (history.pushState) history.pushState(null, '', hash); else location.hash = hash;
          return true;
        }
      }
      if (!file) return false;
    }
    location.href = href;
    return true;
  }

  function build() {
    var host = el('div');
    host.id = 'neualto-assistant-root';
    doc.body.appendChild(host);
    var root = host.attachShadow({ mode: 'open' });

    var styleEl = el('style');
    styleEl.textContent = CSS;
    root.appendChild(styleEl);

    var wrap = el('div', 'nw-wrap nw-pos-' + CONFIG.position);
    root.appendChild(wrap);

    /* ── Theme ────────────────────────────────────────────────────────────
       The widget follows the SITE's theme, not the operating system's.
       The page sets html[data-theme] from its own toggle (and from
       localStorage on load), so honouring prefers-color-scheme instead would
       put a dark panel on a light page for anyone whose OS is dark but who
       chose light here. The OS preference is only a fallback for pages that
       never set the attribute. */
    var darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

    function applyTheme() {
      var siteTheme = doc.documentElement.getAttribute('data-theme');
      var dark = siteTheme
        ? siteTheme === 'dark'
        : !!(darkQuery && darkQuery.matches);
      wrap.classList.toggle('nw-dark', dark);
    }
    applyTheme();

    // React to the site's own toggle flipping the attribute.
    if (window.MutationObserver) {
      new MutationObserver(applyTheme).observe(doc.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme']
      });
    }
    // …and to the OS changing, for pages with no explicit theme set.
    if (darkQuery && darkQuery.addEventListener) {
      darkQuery.addEventListener('change', applyTheme);
    }

    var state = {
      open: false,
      tab: 'chat',
      messages: [],
      revealed: false,
      tipsShown: 0,
      lastFocused: null,
      lastRole: null
    };

    /* ── Launcher ─────────────────────────────────────────────────────── */
    var launcher = el('button', 'nw-launcher');
    launcher.type = 'button';
    launcher.tabIndex = -1;
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.appendChild(mascot('nw-mascot-launcher'));
    wrap.appendChild(launcher);

    /* ── Tip bubble ───────────────────────────────────────────────────── */
    var tip = el('button', 'nw-tip');
    tip.type = 'button';
    tip.hidden = true;
    wrap.appendChild(tip);

    /* ── Scrim (mobile only) ──────────────────────────────────────────── */
    var scrim = el('div', 'nw-scrim');
    wrap.appendChild(scrim);

    /* ── Card ─────────────────────────────────────────────────────────── */
    var card = el('div', 'nw-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'false');
    card.setAttribute('aria-label', CONFIG.title + ' — ' + CONFIG.subtitle);
    card.hidden = true;
    wrap.appendChild(card);

    var header = el('div', 'nw-header');
    header.appendChild(mascot('nw-mascot-header'));
    var headText = el('div', 'nw-headtext');
    headText.appendChild(el('div', 'nw-title', CONFIG.title));
    var status = el('div', 'nw-status');
    status.appendChild(el('span', 'nw-dot'));
    status.appendChild(doc.createTextNode(CONFIG.subtitle));
    headText.appendChild(status);
    header.appendChild(headText);

    var actions = el('div', 'nw-actions');
    var resetBtn = el('button', 'nw-iconbtn');
    resetBtn.type = 'button';
    resetBtn.title = 'Start over';
    resetBtn.setAttribute('aria-label', 'Start a new conversation');
    resetBtn.appendChild(icon('M3 12a9 9 0 1 0 3-6.7M3 4v5h5'));
    var closeBtn = el('button', 'nw-iconbtn');
    closeBtn.type = 'button';
    closeBtn.title = 'Close';
    closeBtn.setAttribute('aria-label', 'Close assistant');
    closeBtn.appendChild(icon('M6 6l12 12M18 6L6 18'));
    actions.appendChild(resetBtn);
    actions.appendChild(closeBtn);
    header.appendChild(actions);
    card.appendChild(header);

    var tablist = el('div', 'nw-tabs');
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', 'Assistant views');
    var chatTab = el('button', 'nw-tab is-active', 'Chat');
    chatTab.type = 'button';
    chatTab.id = 'nw-tab-chat';
    chatTab.setAttribute('role', 'tab');
    chatTab.setAttribute('aria-selected', 'true');
    chatTab.setAttribute('aria-controls', 'nw-panel-chat');
    var browseTab = el('button', 'nw-tab', 'Browse all');
    browseTab.type = 'button';
    browseTab.id = 'nw-tab-browse';
    browseTab.setAttribute('role', 'tab');
    browseTab.setAttribute('aria-selected', 'false');
    browseTab.setAttribute('aria-controls', 'nw-panel-browse');
    browseTab.tabIndex = -1;
    tablist.appendChild(chatTab);
    tablist.appendChild(browseTab);
    card.appendChild(tablist);

    /* Chat panel */
    var chatPanel = el('div', 'nw-panel nw-chat');
    chatPanel.id = 'nw-panel-chat';
    chatPanel.setAttribute('role', 'tabpanel');
    chatPanel.setAttribute('aria-labelledby', 'nw-tab-chat');
    card.appendChild(chatPanel);

    var log = el('div', 'nw-log');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');
    log.setAttribute('aria-relevant', 'additions');
    chatPanel.appendChild(log);

    var composer = el('div', 'nw-composer');
    var inputWrap = el('div', 'nw-inputwrap');

    var listboxId = 'nw-suggest';
    var suggestBox = el('ul', 'nw-suggest');
    suggestBox.id = listboxId;
    suggestBox.setAttribute('role', 'listbox');
    suggestBox.setAttribute('aria-label', 'Suggested questions');
    suggestBox.hidden = true;
    inputWrap.appendChild(suggestBox);

    var input = doc.createElement('textarea');
    input.className = 'nw-input';
    input.rows = 1;
    input.placeholder = 'Ask about services, products, careers…';
    input.setAttribute('aria-label', 'Ask a question');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', listboxId);
    input.setAttribute('aria-autocomplete', 'list');
    inputWrap.appendChild(input);
    composer.appendChild(inputWrap);

    var send = el('button', 'nw-send');
    send.type = 'button';
    send.setAttribute('aria-label', 'Send question');
    send.appendChild(icon('M5 12h14M13 6l6 6-6 6'));
    composer.appendChild(send);
    chatPanel.appendChild(composer);

    /* Browse panel */
    var browsePanel = el('div', 'nw-panel nw-browse');
    browsePanel.id = 'nw-panel-browse';
    browsePanel.setAttribute('role', 'tabpanel');
    browsePanel.setAttribute('aria-labelledby', 'nw-tab-browse');
    browsePanel.hidden = true;
    card.appendChild(browsePanel);

    var filter = doc.createElement('input');
    filter.type = 'search';
    filter.className = 'nw-filter';
    filter.placeholder = 'Filter ' + ENTRIES.length + ' questions…';
    filter.setAttribute('aria-label', 'Filter questions');
    browsePanel.appendChild(filter);
    var browseList = el('div', 'nw-browselist');
    browsePanel.appendChild(browseList);

    /* ── Rendering ────────────────────────────────────────────────────── */

    function renderBrowse(term) {
      browseList.textContent = '';
      var needle = String(term || '').trim().toLowerCase();
      var groups = {};
      var order = [];
      var matched = 0;

      ENTRIES.forEach(function (entry) {
        if (needle) {
          var hay = (entry.q + ' ' + (entry.alts || []).join(' ') + ' ' + (entry.k || []).join(' ') + ' ' + entry.c).toLowerCase();
          if (hay.indexOf(needle) === -1) return;
        }
        matched++;
        if (!groups[entry.c]) { groups[entry.c] = []; order.push(entry.c); }
        groups[entry.c].push(entry);
      });

      if (!matched) {
        browseList.appendChild(el('p', 'nw-empty', 'No questions match "' + term + '".'));
        return;
      }

      order.forEach(function (cat) {
        var section = el('section', 'nw-cat');
        var head = el('h3', 'nw-cathead');
        head.appendChild(doc.createTextNode(cat));
        head.appendChild(el('span', 'nw-count', String(groups[cat].length)));
        section.appendChild(head);
        groups[cat].forEach(function (entry) {
          var item = el('button', 'nw-browseitem', entry.q);
          item.type = 'button';
          item.addEventListener('click', function () {
            switchTab('chat');
            ask(entry.q);
          });
          section.appendChild(item);
        });
        browseList.appendChild(section);
      });
    }

    function chipRow(chips) {
      var row = el('div', 'nw-chips');
      chips.forEach(function (chip) {
        var b = el('button', 'nw-chip', chip.label);
        b.type = 'button';
        b.addEventListener('click', chip.onClick);
        row.appendChild(b);
      });
      return row;
    }

    function addRow(role, contentNode, opts) {
      opts = opts || {};
      var row = el('div', 'nw-row nw-row-' + role);
      if (role === 'bot') {
        var avatarSlot = el('div', 'nw-avatar');
        // Only the first bot message in a run carries the mascot, so a long
        // answer thread doesn't turn into a column of repeated faces.
        if (state.lastRole !== 'bot') avatarSlot.appendChild(mascot('nw-mascot-avatar'));
        row.appendChild(avatarSlot);
      }
      var bubble = el('div', 'nw-bubble');
      bubble.appendChild(contentNode);
      row.appendChild(bubble);
      log.appendChild(row);
      state.lastRole = role;
      log.scrollTop = log.scrollHeight;
      if (opts.record !== false) {
        state.messages.push({ role: role, text: opts.raw !== undefined ? opts.raw : bubble.textContent });
        persist();
      }
      return row;
    }

    function addText(role, text, opts) {
      var holder = el('div');
      holder.appendChild(markdownToFragment(text));
      return addRow(role, holder, opts);
    }

    function feedbackRow(query, entry) {
      var row = el('div', 'nw-feedback');
      row.appendChild(el('span', 'nw-fblabel', 'Did that help?'));
      var yes = el('button', 'nw-fbbtn', '👍');
      yes.type = 'button';
      yes.setAttribute('aria-label', 'Yes, that helped');
      var no = el('button', 'nw-fbbtn', '👎');
      no.type = 'button';
      no.setAttribute('aria-label', "No, that didn't help");

      function settle(message) {
        row.textContent = '';
        row.appendChild(el('span', 'nw-fblabel', message));
      }
      yes.addEventListener('click', function () { settle('Thanks!'); });
      no.addEventListener('click', function () {
        recordInsight('unhelpful', { q: query, matched: entry ? entry.id : null, at: Date.now() });
        settle('Thanks — noted.');
        addText('bot', "Sorry about that. You can browse every question from the **Browse all** tab, or email **[info@neualto.com](mailto:info@neualto.com)** to reach a person.", { record: false });
      });
      row.appendChild(yes);
      row.appendChild(no);
      return row;
    }

    /**
     * Appends a small rounded "extras" card under the log — indented to align
     * with the bubble above it, not stacked inside it. A chat bubble that also
     * contains a pill button, an uppercase label, a chip row, and a feedback
     * bar reads as a form, not a message; keeping the reply text as a plain
     * bubble and giving actions their own quieter surface is what makes the
     * conversation feel like a conversation.
     */
    function addExtras(children) {
      var extras = el('div', 'nw-extras');
      children.forEach(function (child) { extras.appendChild(child); });
      log.appendChild(extras);
      log.scrollTop = log.scrollHeight;
      return extras;
    }

    function relatedGroup(label, items, onPick) {
      var group = el('div', 'nw-relgroup');
      group.appendChild(el('div', 'nw-rellabel', label));
      group.appendChild(chipRow(items.map(function (item) {
        return { label: item.q, onClick: function () { onPick(item); } };
      })));
      return group;
    }

    function addBotAnswer(query, entry) {
      var bubbleContent = el('div');
      bubbleContent.appendChild(markdownToFragment(entry.a));
      addRow('bot', bubbleContent, { raw: entry.a });

      var children = [];

      if (entry.href) {
        var jump = el('button', 'nw-jump');
        jump.type = 'button';
        var external = /^https?:\/\//i.test(entry.href);
        var mail = /^mailto:|^tel:/i.test(entry.href);
        jump.textContent = external ? 'Open page ↗' : (mail ? 'Get in touch' : 'Show me on this site →');
        jump.addEventListener('click', function () { navigateTo(entry.href); });
        children.push(jump);
      }

      var rel = (entry.rel || []).map(function (id) { return ENTRY_BY_ID[id]; }).filter(Boolean).slice(0, 3);
      if (rel.length) children.push(relatedGroup('Related', rel, function (r) { ask(r.q); }));

      children.push(feedbackRow(query, entry));
      addExtras(children);
    }

    function addBotNoMatch(query, results) {
      addText('bot', "I couldn't find that on this site, and I'd rather say so than guess.", { raw: "I couldn't find that on this site." });

      var close = suggestions(results, 3);
      if (close.length) {
        addExtras([relatedGroup('Did you mean', close.map(function (r) { return r.entry; }), function (e) { ask(e.q); })]);
      } else {
        addExtras([chipRow([
          { label: 'Browse all questions', onClick: function () { switchTab('browse'); } },
          { label: 'Email the team', onClick: function () { navigateTo('mailto:info@neualto.com'); } }
        ])]);
      }
    }

    /* ── Conversation flow ────────────────────────────────────────────── */

    var thinkingRow = null;
    function showThinking() {
      thinkingRow = el('div', 'nw-row nw-row-bot');
      var avatarSlot = el('div', 'nw-avatar');
      if (state.lastRole !== 'bot') avatarSlot.appendChild(mascot('nw-mascot-avatar'));
      thinkingRow.appendChild(avatarSlot);
      var bubble = el('div', 'nw-bubble nw-thinking');
      bubble.appendChild(el('span'));
      bubble.appendChild(el('span'));
      bubble.appendChild(el('span'));
      thinkingRow.appendChild(bubble);
      log.appendChild(thinkingRow);
      log.scrollTop = log.scrollHeight;
    }
    function hideThinking() {
      if (thinkingRow && thinkingRow.parentNode) thinkingRow.parentNode.removeChild(thinkingRow);
      thinkingRow = null;
    }

    function ask(query) {
      query = String(query || '').trim();
      if (!query) return;
      hideSuggest();
      addText('user', query);
      showThinking();

      var delay = 380 + Math.random() * 340;
      setTimeout(function () {
        hideThinking();
        state.lastRole = 'user'; // force the mascot back onto the reply

        var intent = detectIntent(query);
        if (intent) {
          addText('bot', intent.reply);
          if (intent.name === 'capability') showStarters();
          if (CONFIG.onQuery) { try { CONFIG.onQuery(query, null, true); } catch (e) {} }
          return;
        }

        var results = search(query);
        var top = results[0];
        var answered = !!(top && top.score >= CONFIG.confidenceThreshold);

        if (answered) {
          addBotAnswer(query, top.entry);
        } else {
          addBotNoMatch(query, results);
          recordInsight('unanswered', {
            q: query,
            best: top ? top.entry.id : null,
            score: top ? Math.round(top.score * 10) / 10 : 0,
            at: Date.now()
          });
        }
        if (CONFIG.onQuery) { try { CONFIG.onQuery(query, top || null, answered); } catch (e) {} }
      }, delay);
    }

    function showStarters() {
      addExtras([chipRow(STARTERS.map(function (id) {
        var entry = ENTRY_BY_ID[id];
        return { label: entry.q, onClick: function () { ask(entry.q); } };
      }))]);
    }

    function greet() {
      state.lastRole = null;
      addText('bot', "Hi, I'm **NeuAlto Bot**, your friendly helper!", { record: false });
      showStarters();
    }

    /* ── Suggestions (combobox listbox) ───────────────────────────────── */

    var activeSuggest = -1;
    var suggestItems = [];

    function hideSuggest() {
      suggestBox.hidden = true;
      suggestBox.textContent = '';
      suggestItems = [];
      activeSuggest = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }

    function highlightSuggest(idx) {
      suggestItems.forEach(function (item, i) {
        var on = i === idx;
        item.classList.toggle('is-active', on);
        item.setAttribute('aria-selected', String(on));
      });
      activeSuggest = idx;
      if (idx >= 0) input.setAttribute('aria-activedescendant', suggestItems[idx].id);
      else input.removeAttribute('aria-activedescendant');
    }

    function renderSuggest() {
      var q = input.value.trim();
      if (q.length < 2) { hideSuggest(); return; }
      var found = suggestions(search(q), 4);
      if (!found.length) { hideSuggest(); return; }
      suggestBox.textContent = '';
      suggestItems = found.map(function (r, i) {
        var li = el('li', 'nw-suggestitem', r.entry.q);
        li.id = 'nw-suggest-' + i;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.addEventListener('mousedown', function (e) {
          e.preventDefault();
          input.value = '';
          grow();
          ask(r.entry.q);
        });
        suggestBox.appendChild(li);
        return li;
      });
      suggestBox.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      highlightSuggest(-1);
    }

    function grow() {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 92) + 'px';
    }

    function submit() {
      if (activeSuggest >= 0 && suggestItems[activeSuggest]) {
        var chosen = suggestItems[activeSuggest].textContent;
        input.value = '';
        grow();
        ask(chosen);
        return;
      }
      var value = input.value.trim();
      if (!value) return;
      input.value = '';
      grow();
      ask(value);
    }

    input.addEventListener('input', function () { grow(); renderSuggest(); });
    input.addEventListener('blur', function () { setTimeout(hideSuggest, 120); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' && !suggestBox.hidden) {
        e.preventDefault();
        highlightSuggest((activeSuggest + 1) % suggestItems.length);
      } else if (e.key === 'ArrowUp' && !suggestBox.hidden) {
        e.preventDefault();
        highlightSuggest(activeSuggest <= 0 ? suggestItems.length - 1 : activeSuggest - 1);
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        if (!suggestBox.hidden) { e.stopPropagation(); hideSuggest(); }
        else close();
      }
    });
    send.addEventListener('click', submit);

    /* ── Tabs ─────────────────────────────────────────────────────────── */

    function switchTab(name) {
      state.tab = name;
      var isChat = name === 'chat';
      chatTab.classList.toggle('is-active', isChat);
      browseTab.classList.toggle('is-active', !isChat);
      chatTab.setAttribute('aria-selected', String(isChat));
      browseTab.setAttribute('aria-selected', String(!isChat));
      chatTab.tabIndex = isChat ? 0 : -1;
      browseTab.tabIndex = isChat ? -1 : 0;
      chatPanel.hidden = !isChat;
      browsePanel.hidden = isChat;
      if (!isChat && !browseList.childNodes.length) renderBrowse('');
      (isChat ? input : filter).focus();
    }

    chatTab.addEventListener('click', function () { switchTab('chat'); });
    browseTab.addEventListener('click', function () { switchTab('browse'); });
    tablist.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      switchTab(state.tab === 'chat' ? 'browse' : 'chat');
    });

    var filterTimer = null;
    filter.addEventListener('input', function () {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(function () { renderBrowse(filter.value); }, 120);
    });

    /* ── Open / close ─────────────────────────────────────────────────── */

    function focusables() {
      return Array.prototype.slice.call(
        card.querySelectorAll('button, textarea, input, a[href]')
      ).filter(function (n) { return !n.disabled && n.offsetParent !== null; });
    }

    function onDocKeydown(e) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      var items = focusables();
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      var active = root.activeElement;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    }

    function open() {
      if (state.open) return;
      state.open = true;
      state.lastFocused = doc.activeElement;
      card.hidden = false;
      hideTip();
      wrap.classList.add('is-open');
      requestAnimationFrame(function () { card.classList.add('is-open'); });
      launcher.setAttribute('aria-expanded', 'true');
      launcher.setAttribute('aria-label', 'Close ' + CONFIG.title);
      doc.addEventListener('keydown', onDocKeydown);
      setTimeout(function () { input.focus(); }, 240);
      persist();
    }

    function close() {
      if (!state.open) return;
      state.open = false;
      card.classList.remove('is-open');
      wrap.classList.remove('is-open');
      launcher.setAttribute('aria-expanded', 'false');
      launcher.setAttribute('aria-label', 'Open ' + CONFIG.title + ', the NeuAlto assistant');
      doc.removeEventListener('keydown', onDocKeydown);
      setTimeout(function () { card.hidden = true; }, 280);
      if (state.lastFocused && state.lastFocused.focus) state.lastFocused.focus();
      else launcher.focus();
      persist();
    }

    function toggle() { state.open ? close() : open(); }

    launcher.setAttribute('aria-label', 'Open ' + CONFIG.title + ', the NeuAlto assistant');
    launcher.addEventListener('click', toggle);
    closeBtn.addEventListener('click', close);
    scrim.addEventListener('click', close);
    resetBtn.addEventListener('click', function () {
      log.textContent = '';
      state.messages = [];
      state.lastRole = null;
      persist();
      greet();
      input.focus();
    });

    doc.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        toggle();
      }
    });

    /* ── Persistence ──────────────────────────────────────────────────── */

    function persist() {
      try {
        sessionStorage.setItem(CONFIG.storageKey, JSON.stringify({
          open: state.open,
          messages: state.messages.slice(-40),
          tipsShown: state.tipsShown
        }));
      } catch (e) { /* private mode */ }
    }

    var saved = null;
    try {
      var rawSaved = sessionStorage.getItem(CONFIG.storageKey);
      saved = rawSaved ? JSON.parse(rawSaved) : null;
    } catch (e) { saved = null; }

    if (saved && saved.messages && saved.messages.length) {
      state.tipsShown = saved.tipsShown || 0;
      saved.messages.forEach(function (m) {
        state.lastRole = m.role === 'bot' ? 'user' : 'bot'; // keep avatars sensible on restore
        addText(m.role, m.text, { record: false });
      });
      state.messages = saved.messages;
    } else {
      greet();
    }

    /* ── Reveal on scroll ─────────────────────────────────────────────── */

    function updateReveal() {
      var y = window.scrollY || doc.documentElement.scrollTop || 0;
      var should = y > CONFIG.revealAfter || state.open;
      if (should === state.revealed) return;
      state.revealed = should;
      wrap.classList.toggle('is-revealed', should);
      launcher.tabIndex = should ? 0 : -1;
      if (should) scheduleTip(); else hideTip();
    }
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { updateReveal(); ticking = false; });
    }, { passive: true });
    updateReveal();

    /* ── Tips ─────────────────────────────────────────────────────────── */

    var tipTimer = null;
    var lastTip = -1;

    function hideTip() {
      tip.classList.remove('is-shown');
      clearTimeout(tipTimer);
      tipTimer = setTimeout(function () { tip.hidden = true; }, 240);
    }

    function scheduleTip() {
      if (state.open || state.tipsShown >= CONFIG.tipMaxPerSession) return;
      clearTimeout(tipTimer);
      tipTimer = setTimeout(showTip, state.tipsShown === 0 ? CONFIG.tipDelayMs : CONFIG.tipIntervalMs);
    }

    function showTip() {
      if (state.open || !state.revealed || state.tipsShown >= CONFIG.tipMaxPerSession) return;
      var idx = Math.floor(Math.random() * TIPS.length);
      while (TIPS.length > 1 && idx === lastTip) idx = Math.floor(Math.random() * TIPS.length);
      lastTip = idx;
      var chosen = TIPS[idx];
      tip.textContent = chosen.text;
      tip.setAttribute('aria-label', 'Ask: ' + chosen.ask);
      tip.onclick = function () {
        hideTip();
        open();
        setTimeout(function () { ask(chosen.ask); }, 260);
      };
      tip.hidden = false;
      requestAnimationFrame(function () { tip.classList.add('is-shown'); });
      state.tipsShown++;
      persist();
      clearTimeout(tipTimer);
      tipTimer = setTimeout(function () { hideTip(); scheduleTip(); }, 7000);
    }

    if (saved && saved.open) open();

    return {
      open: open,
      close: close,
      toggle: toggle,
      ask: function (q) { open(); setTimeout(function () { ask(q); }, 240); },
      search: search,
      getInsights: readInsights,
      clearInsights: function () {
        try { localStorage.removeItem(CONFIG.insightsKey); } catch (e) {}
      },
      addEntries: function (list) {
        (list || []).forEach(function (entry) {
          if (!entry || !entry.id || ENTRY_BY_ID[entry.id]) return;
          entry.alts = entry.alts || [];
          entry.k = entry.k || [];
          entry.rel = entry.rel || [];
          ENTRIES.push(entry);
          ENTRY_BY_ID[entry.id] = entry;
          if (INDEX) INDEX.push(indexEntry(entry));
        });
        browseList.textContent = '';
        filter.placeholder = 'Filter ' + ENTRIES.length + ' questions…';
      }
    };
  }

  /* ══════════════════════════════════════════════════════════════════════
     STYLES
     A template literal is safe here: any browser implementing attachShadow
     (ES6-era) also implements template literals, so this can't be the thing
     that breaks an old browser the widget would otherwise have supported.
     ══════════════════════════════════════════════════════════════════════ */

  var CSS = `
  :host { all: initial; }
  .nw-wrap, .nw-wrap * { box-sizing: border-box; }
  .nw-wrap {
    --nw-accent: ${CONFIG.accent};
    --nw-accent-deep: ${CONFIG.accentDeep};
    --nw-ink: #22131a;
    --nw-ink-soft: #6b545c;
    --nw-ink-faint: #8f747b;
    --nw-bg: #ffffff;
    --nw-soft: #fbf6f6;
    --nw-line: #f0e0e1;
    --nw-bot: #f8f0f1;
    --nw-shadow: 0 22px 54px -14px rgba(34,19,26,.22), 0 0 0 1px rgba(34,19,26,.04);
    --nw-edge: 26px;
    --nw-size: 62px;
    --nw-lift: 88px;
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    position: fixed; inset: 0; pointer-events: none; z-index: 2147483000;
    color: var(--nw-ink);
  }
  /* A lighter, warmer "dusk" dark theme — plum, not near-black, so the card
     never reads as a hole punched in the page.
     Driven by the .nw-dark class, not a prefers-color-scheme media query: the
     site has its own theme toggle (html[data-theme]), and a media query would
     ignore it — leaving a dark chat panel sitting on a light page whenever the
     visitor's OS is dark but they've chosen light here. See applyTheme(). */
  .nw-wrap.nw-dark {
    --nw-ink: #f8eef0; --nw-ink-soft: #d6bcc1; --nw-ink-faint: #ab9096;
    --nw-bg: #271821; --nw-soft: #31202a; --nw-line: #4a3038; --nw-bot: #382330;
    --nw-shadow: 0 22px 54px -14px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.06);
  }

  /* ── Mascot ──────────────────────────────────────────────────────────
     The artwork carries uneven transparent padding (measured L92 R75 T60 B92
     in a 532x469 canvas). These figures scale and shift it so the *visible*
     character exactly fills its box — no disc, no padding, no frame. That
     also keeps the clickable area equal to the art and lets the launcher's
     right edge line up with the site's existing back-to-top button.
     Box height must stay width x 0.8685 (the artwork's own aspect ratio).
     Recompute all four numbers if the artwork is ever replaced. */
  .nw-mascot { position: relative; display: block; overflow: hidden; flex: none; }
  .nw-mascot img { position: absolute; width: 145.75%; left: -25.21%; top: -18.93%; height: auto; display: block; }

  /* ── Launcher — the mascot itself, nothing else ───────────────────── */
  .nw-launcher {
    position: fixed; right: var(--nw-edge); bottom: var(--nw-lift);
    width: var(--nw-size); height: calc(var(--nw-size) * .8685);
    border: none; padding: 0; background: none; border-radius: 10px;
    cursor: pointer; pointer-events: auto; display: block;
    opacity: 0; visibility: hidden; transform: translateY(14px) scale(.8);
    transition: opacity .34s cubic-bezier(.2,.9,.3,1.2), transform .34s cubic-bezier(.2,.9,.3,1.2);
  }
  .nw-pos-left .nw-launcher { right: auto; left: var(--nw-edge); }
  .nw-wrap.is-revealed .nw-launcher { opacity: 1; visibility: visible; transform: none; }
  .nw-launcher:focus-visible { outline: 3px solid var(--nw-accent); outline-offset: 4px; }
  .nw-mascot-launcher { width: 100%; height: 100%; transition: transform .3s cubic-bezier(.2,.9,.3,1.2); }
  .nw-wrap.is-revealed .nw-mascot-launcher { animation: nw-idle 4.5s ease-in-out 1.2s infinite; }
  .nw-launcher:hover .nw-mascot-launcher { transform: scale(1.09) rotate(-4deg); animation: none; }
  .nw-wrap.is-open .nw-mascot-launcher { transform: scale(.92); animation: none; }
  @keyframes nw-idle {
    0%, 88%, 100% { transform: translateY(0) rotate(0); }
    92% { transform: translateY(-3px) rotate(-5deg); }
    96% { transform: translateY(-1px) rotate(4deg); }
  }

  /* ── Tip ──────────────────────────────────────────────────────────── */
  .nw-tip {
    position: fixed; right: calc(var(--nw-edge) + var(--nw-size) + 12px);
    bottom: calc(var(--nw-lift) + 8px);
    max-width: 232px; text-align: left; cursor: pointer; pointer-events: auto;
    background: var(--nw-bg); color: var(--nw-ink);
    border: 1px solid var(--nw-line); border-radius: 16px 16px 4px 16px;
    padding: 11px 14px; font-family: inherit; font-weight: 500; font-size: 13.5px; line-height: 1.45;
    box-shadow: var(--nw-shadow);
    opacity: 0; transform: translateX(10px) scale(.94); transform-origin: bottom right;
    transition: opacity .28s, transform .28s;
  }
  .nw-pos-left .nw-tip {
    right: auto; left: calc(var(--nw-edge) + var(--nw-size) + 12px);
    border-radius: 16px 16px 16px 4px; transform-origin: bottom left;
    transform: translateX(-10px) scale(.94);
  }
  .nw-tip.is-shown { opacity: 1; transform: none; }
  .nw-tip:focus-visible { outline: 2px solid var(--nw-accent); outline-offset: 2px; }

  /* ── Scrim (mobile) ───────────────────────────────────────────────── */
  .nw-scrim { position: fixed; inset: 0; background: rgba(15,7,8,.4); opacity: 0; pointer-events: none; transition: opacity .3s; }

  /* ── Card ─────────────────────────────────────────────────────────── */
  .nw-card {
    position: fixed; right: var(--nw-edge);
    bottom: calc(var(--nw-lift) + var(--nw-size) + 14px);
    width: 396px; max-width: calc(100vw - var(--nw-edge) * 2);
    height: 604px; max-height: calc(100vh - var(--nw-lift) - var(--nw-size) - 34px);
    background: var(--nw-bg); border-radius: 24px; box-shadow: var(--nw-shadow);
    display: flex; flex-direction: column; overflow: hidden; pointer-events: auto;
    opacity: 0; transform: translateY(14px) scale(.97); transform-origin: bottom right;
    transition: opacity .28s cubic-bezier(.2,.9,.3,1), transform .28s cubic-bezier(.2,.9,.3,1);
  }
  .nw-pos-left .nw-card { right: auto; left: var(--nw-edge); transform-origin: bottom left; }
  .nw-card.is-open { opacity: 1; transform: none; }

  /* ── Header ───────────────────────────────────────────────────────── */
  .nw-header {
    display: flex; align-items: center; gap: 12px; padding: 16px 16px 15px;
    border-bottom: 1px solid var(--nw-line);
    background: linear-gradient(180deg, rgba(220,38,38,.07), transparent);
  }
  .nw-mascot-header { width: 44px; height: calc(44px * .8685); }
  .nw-headtext { flex: 1; min-width: 0; }
  .nw-title { font-family: inherit; font-weight: 700; font-size: 16px; line-height: 1.25; letter-spacing: -.01em; }
  .nw-status { display: flex; align-items: center; gap: 6px; font-family: inherit; font-weight: 500; font-size: 12.5px; line-height: 1.4; color: var(--nw-ink-soft); margin-top: 1px; }
  .nw-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; flex: none; }
  .nw-actions { display: flex; gap: 2px; }
  .nw-iconbtn {
    width: 32px; height: 32px; border: none; border-radius: 9px; cursor: pointer;
    background: transparent; color: var(--nw-ink-soft); display: grid; place-items: center;
    transition: background .18s, color .18s;
  }
  .nw-iconbtn svg { width: 17px; height: 17px; }
  .nw-iconbtn:hover { background: var(--nw-soft); color: var(--nw-ink); }
  .nw-iconbtn:focus-visible { outline: 2px solid var(--nw-accent); outline-offset: 1px; }

  /* ── Tabs ─────────────────────────────────────────────────────────── */
  .nw-tabs { display: flex; gap: 4px; padding: 10px 14px 0; }
  .nw-tab {
    flex: 1; border: none; cursor: pointer; border-radius: 9px; padding: 8px 10px;
    font-family: inherit; font-weight: 600; font-size: 12.5px; line-height: 1; background: var(--nw-soft); color: var(--nw-ink-soft);
    transition: background .18s, color .18s;
  }
  .nw-tab.is-active { background: var(--nw-accent); color: #fff; }
  .nw-tab:focus-visible { outline: 2px solid var(--nw-accent); outline-offset: 2px; }

  /* ── Panels ───────────────────────────────────────────────────────── */
  .nw-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .nw-panel[hidden] { display: none; }
  .nw-log { flex: 1; overflow-y: auto; padding: 18px 16px; display: flex; flex-direction: column; gap: 13px; scroll-behavior: smooth; }

  .nw-row { display: flex; align-items: flex-end; gap: 8px; }
  .nw-row-user { justify-content: flex-end; }
  .nw-avatar { width: 30px; flex: none; }
  .nw-mascot-avatar { width: 30px; height: calc(30px * .8685); }
  .nw-bubble {
    max-width: 82%; padding: 12px 16px; border-radius: 18px;
    font-family: inherit; font-weight: 400; font-size: 14px; line-height: 1.62; overflow-wrap: anywhere;
  }
  .nw-row-bot .nw-bubble { background: var(--nw-bot); border-bottom-left-radius: 6px; }
  .nw-row-user .nw-bubble { background: var(--nw-accent); color: #fff; border-bottom-right-radius: 6px; }
  .nw-bubble p { margin: 0 0 9px; }
  .nw-bubble p:last-child { margin-bottom: 0; }
  .nw-bubble strong { font-weight: 700; }
  .nw-list { margin: 7px 0 9px; padding-left: 18px; }
  .nw-list li { margin-bottom: 6px; }
  .nw-list li:last-child { margin-bottom: 0; }
  .nw-link { color: var(--nw-accent-deep); text-decoration: underline; text-underline-offset: 2px; }
  .nw-row-user .nw-link { color: #fff; }
  .nw-dark .nw-link { color: #ff9d9d; }

  /*
   * Extras: everything that follows a reply — a jump link, related
   * questions, feedback — lives in its own soft rounded card, indented to
   * align under the bubble (30px avatar + 8px gap) rather than crammed
   * inside it. Keeps the chat bubble reading as a message, not a form.
   */
  .nw-extras {
    margin: 0 0 0 38px; padding: 12px 14px; border-radius: 16px;
    background: var(--nw-soft); border: 1px solid var(--nw-line);
    display: flex; flex-direction: column; gap: 10px;
  }
  .nw-extras > * + * { padding-top: 10px; border-top: 1px solid var(--nw-line); }

  .nw-jump {
    display: inline-flex; align-self: flex-start; border: 1.5px solid var(--nw-accent);
    background: transparent; color: var(--nw-accent-deep); cursor: pointer;
    font-family: inherit; font-weight: 600; font-size: 12.5px; line-height: 1; padding: 8px 13px; border-radius: 999px;
    transition: background .18s, color .18s;
  }
  .nw-jump:hover { background: var(--nw-accent); color: #fff; }
  .nw-jump:focus-visible { outline: 2px solid var(--nw-accent); outline-offset: 2px; }
  .nw-dark .nw-jump { color: #ff9d9d; } .nw-dark .nw-jump:hover { color: #fff; }

  .nw-relgroup { display: flex; flex-direction: column; gap: 8px; }
  .nw-rellabel {
    font-family: inherit; font-weight: 700; font-size: 10px; line-height: 1; letter-spacing: .08em;
    text-transform: uppercase; color: var(--nw-ink-faint);
  }
  .nw-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .nw-chip {
    border: 1px solid var(--nw-line); background: var(--nw-bg); color: var(--nw-ink);
    cursor: pointer; font-family: inherit; font-weight: 500; font-size: 12.5px; line-height: 1.3; padding: 8px 12px;
    border-radius: 999px; text-align: left; transition: border-color .18s, color .18s, background .18s;
  }
  .nw-chip:hover { border-color: var(--nw-accent); color: var(--nw-accent-deep); background: var(--nw-bg); }
  .nw-chip:focus-visible { outline: 2px solid var(--nw-accent); outline-offset: 1px; }
  .nw-dark .nw-chip:hover { color: #ff9d9d; }

  .nw-feedback { display: flex; align-items: center; gap: 7px; }
  .nw-fblabel { font-family: inherit; font-weight: 500; font-size: 12px; line-height: 1; color: var(--nw-ink-faint); }
  .nw-fbbtn {
    border: 1px solid var(--nw-line); background: var(--nw-bg); cursor: pointer;
    border-radius: 8px; padding: 4px 8px; font-size: 12.5px; line-height: 1.4;
    transition: border-color .18s, transform .18s;
  }
  .nw-fbbtn:hover { border-color: var(--nw-accent); transform: translateY(-1px); }
  .nw-fbbtn:focus-visible { outline: 2px solid var(--nw-accent); outline-offset: 1px; }

  .nw-thinking { display: flex; gap: 4px; padding: 13px; }
  .nw-thinking span { width: 6px; height: 6px; border-radius: 50%; background: var(--nw-ink-faint); animation: nw-bounce 1.1s ease-in-out infinite; }
  .nw-thinking span:nth-child(2) { animation-delay: .15s; }
  .nw-thinking span:nth-child(3) { animation-delay: .3s; }
  @keyframes nw-bounce { 0%, 65%, 100% { transform: translateY(0); opacity: .45; } 32% { transform: translateY(-4px); opacity: 1; } }

  /* ── Composer ─────────────────────────────────────────────────────── */
  .nw-composer { display: flex; gap: 8px; padding: 11px 14px 13px; border-top: 1px solid var(--nw-line); align-items: flex-end; }
  .nw-inputwrap { flex: 1; position: relative; min-width: 0; }
  .nw-input {
    width: 100%; resize: none; border: 1.5px solid var(--nw-line); border-radius: 13px;
    padding: 10px 12px; font-family: inherit; font-weight: 400; font-size: 13.5px; line-height: 1.45; color: var(--nw-ink);
    background: var(--nw-soft); max-height: 92px; overflow-y: auto;
  }
  .nw-input::placeholder { color: var(--nw-ink-faint); }
  .nw-input:focus { outline: none; border-color: var(--nw-accent); background: var(--nw-bg); }
  .nw-send {
    width: 40px; height: 40px; flex: none; border: none; border-radius: 12px; cursor: pointer;
    background: var(--nw-accent); color: #fff; display: grid; place-items: center;
    transition: background .18s, transform .18s;
  }
  .nw-send svg { width: 17px; height: 17px; }
  .nw-send:hover { background: var(--nw-accent-deep); transform: translateY(-1px); }
  .nw-send:focus-visible { outline: 2px solid var(--nw-accent-deep); outline-offset: 2px; }

  .nw-suggest {
    position: absolute; left: 0; right: 0; bottom: calc(100% + 7px);
    margin: 0; padding: 5px; list-style: none; z-index: 3;
    background: var(--nw-bg); border: 1px solid var(--nw-line); border-radius: 13px;
    box-shadow: var(--nw-shadow); max-height: 178px; overflow-y: auto;
  }
  .nw-suggestitem {
    padding: 8px 10px; border-radius: 9px; cursor: pointer;
    font-family: inherit; font-weight: 400; font-size: 12.8px; line-height: 1.4; color: var(--nw-ink);
  }
  .nw-suggestitem:hover, .nw-suggestitem.is-active { background: var(--nw-soft); color: var(--nw-accent-deep); }
  .nw-dark .nw-suggestitem:hover, .nw-dark .nw-suggestitem.is-active { color: #ff8a8a; }

  /* ── Browse ───────────────────────────────────────────────────────── */
  .nw-browse { padding: 12px 14px 14px; }
  .nw-filter {
    width: 100%; border: 1.5px solid var(--nw-line); border-radius: 11px; padding: 9px 12px;
    font-family: inherit; font-weight: 400; font-size: 13px; line-height: 1.4; color: var(--nw-ink); background: var(--nw-soft); margin-bottom: 11px; flex: none;
  }
  .nw-filter::placeholder { color: var(--nw-ink-faint); }
  .nw-filter:focus { outline: none; border-color: var(--nw-accent); background: var(--nw-bg); }
  .nw-browselist { flex: 1; overflow-y: auto; min-height: 0; }
  .nw-cat { margin-bottom: 15px; }
  .nw-cathead {
    display: flex; align-items: center; gap: 7px; margin: 0 0 7px;
    font-family: inherit; font-weight: 700; font-size: 10px; line-height: 1; letter-spacing: .08em; text-transform: uppercase; color: var(--nw-accent-deep);
  }
  .nw-dark .nw-cathead { color: #ff8a8a; }
  .nw-count {
    font-size: 9.5px; letter-spacing: 0; background: var(--nw-soft); color: var(--nw-ink-faint);
    border-radius: 999px; padding: 2px 6px;
  }
  .nw-browseitem {
    display: block; width: 100%; text-align: left; margin-bottom: 5px; cursor: pointer;
    border: 1px solid var(--nw-line); border-radius: 10px; background: var(--nw-bg);
    color: var(--nw-ink); font-family: inherit; font-weight: 400; font-size: 12.8px; line-height: 1.45; padding: 9px 11px;
    transition: border-color .18s, color .18s, background .18s;
  }
  .nw-browseitem:hover { border-color: var(--nw-accent); color: var(--nw-accent-deep); background: var(--nw-soft); }
  .nw-browseitem:focus-visible { outline: 2px solid var(--nw-accent); outline-offset: 1px; }
  .nw-dark .nw-browseitem:hover { color: #ff8a8a; }
  .nw-empty { font-family: inherit; font-weight: 400; font-size: 13px; line-height: 1.5; color: var(--nw-ink-soft); text-align: center; padding: 22px 0; }

  /* ── Mobile: full-screen sheet ────────────────────────────────────── */
  @media (max-width: 560px) {
    .nw-wrap { --nw-edge: 16px; --nw-size: 56px; --nw-lift: 80px; }
    .nw-card {
      right: 0; left: 0; bottom: 0; top: 0;
      width: 100%; max-width: 100%; height: 100%; max-height: 100%;
      border-radius: 0; transform: translateY(100%); transform-origin: center;
    }
    .nw-pos-left .nw-card { left: 0; right: 0; }
    .nw-card.is-open { transform: none; }
    .nw-wrap.is-open .nw-scrim { opacity: 1; pointer-events: auto; }
    .nw-wrap.is-open .nw-launcher, .nw-wrap.is-open .nw-tip { opacity: 0; pointer-events: none; }
    .nw-bubble { max-width: 88%; }
  }

  /* ── Reduced motion ───────────────────────────────────────────────── */
  @media (prefers-reduced-motion: reduce) {
    .nw-launcher, .nw-card, .nw-tip, .nw-scrim, .nw-mascot-launcher,
    .nw-thinking span, .nw-chip, .nw-jump, .nw-send,
    .nw-browseitem, .nw-iconbtn, .nw-fbbtn {
      transition: none !important; animation: none !important;
    }
    .nw-log { scroll-behavior: auto; }
  }
  `;

  window.NeuAltoAssistant = build();
})();
