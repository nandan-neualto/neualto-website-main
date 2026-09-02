/**
 * Static SEO / structured-data linter for the NeuAlto site.
 *
 *   node scripts/check-seo.js
 *
 * Checks the things that silently cost rankings or break rich results and are
 * invisible until a crawler complains:
 *
 *   - every JSON-LD block actually parses (a malformed block is ignored
 *     wholesale by Google, so it is worse than having none)
 *   - FAQPage questions genuinely appear in the visible page text — Google
 *     requires this and penalises schema that promises content the page
 *     does not show
 *   - title / meta description present and within display length
 *   - canonical present, absolute, and self-consistent with the sitemap
 *   - Open Graph + Twitter card tags present
 *   - exactly one <h1> per page
 *   - every <img> has an alt attribute, and local image files exist
 *   - internal .html links point at files that exist
 *
 * Exits 1 on errors so it can gate a deploy; warnings alone exit 0.
 */
'use strict';

var fs = require('fs');
var path = require('path');

// Discovered from the filesystem, so generated article pages are validated
// too - see scripts/site-pages.js for why this is not a hardcoded list.
var sitePages = require('./site-pages.js');
var PAGES = sitePages.PAGES;
var NOINDEX = sitePages.NOINDEX;

var errors = [];
var warnings = [];

function err(page, msg) { errors.push(page + ': ' + msg); }
function warn(page, msg) { warnings.push(page + ': ' + msg); }

/** Crude tag-stripper — good enough to test whether text is visible on a page. */
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Length limits apply to what a searcher sees, not to the source, so entities
 * have to be decoded first — otherwise "&trade;" is counted as 7 characters
 * instead of 1 and every title with a symbol looks falsely over-length.
 */
function decodeEntities(s) {
  return String(s)
    .replace(/&trade;/g, '™').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&mdash;/g, '—')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function attr(tag, name) {
  var m = tag.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i'));
  return m ? m[1] : null;
}

function meta(html, key, kind) {
  var re = new RegExp('<meta\\s+' + (kind || 'name') + '="' + key + '"[^>]*>', 'i');
  var m = html.match(re);
  return m ? attr(m[0], 'content') : null;
}

var sitemapUrls = [];
if (fs.existsSync('sitemap.xml')) {
  var sm = fs.readFileSync('sitemap.xml', 'utf8');
  sitemapUrls = (sm.match(/<loc>([^<]+)<\/loc>/g) || [])
    .map(function (l) { return l.replace(/<\/?loc>/g, ''); });
} else {
  errors.push('sitemap.xml is missing');
}

PAGES.forEach(function (page) {
  if (!fs.existsSync(page)) { err(page, 'file missing'); return; }
  var html = fs.readFileSync(page, 'utf8');
  var text = visibleText(html);
  var indexable = NOINDEX.indexOf(page) === -1;

  /* ── JSON-LD ─────────────────────────────────────────────────────── */
  var ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) || [];
  ld.forEach(function (block, i) {
    var body = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '');
    var parsed;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      err(page, 'JSON-LD block #' + (i + 1) + ' is not valid JSON — ' + e.message);
      return;
    }
    if (!parsed['@context']) warn(page, 'JSON-LD block #' + (i + 1) + ' has no @context');
    if (!parsed['@type']) warn(page, 'JSON-LD block #' + (i + 1) + ' has no @type');

    // FAQ answers must be visible on the page, per Google's rich-result rules.
    if (parsed['@type'] === 'FAQPage' && Array.isArray(parsed.mainEntity)) {
      parsed.mainEntity.forEach(function (q) {
        var name = (q && q.name) || '';
        // compare on a distinctive slice, ignoring punctuation differences
        var probe = name.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).slice(0, 6).join(' ');
        if (probe && text.replace(/[^a-z0-9 ]/g, '').indexOf(probe) === -1) {
          err(page, 'FAQ schema question is not visible on the page: "' + name + '"');
        }
      });
    }
  });
  if (indexable && !ld.length) warn(page, 'no structured data (JSON-LD) at all');

  /* ── Title / description ─────────────────────────────────────────── */
  var titleM = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (!titleM) err(page, 'no <title>');
  else {
    var t = decodeEntities(titleM[1].trim());
    if (t.length > 65) warn(page, 'title is ' + t.length + ' chars — likely truncated in results');
    if (t.length < 15) warn(page, 'title is very short (' + t.length + ' chars)');
  }

  var desc = meta(html, 'description');
  if (desc) desc = decodeEntities(desc);
  if (!desc) err(page, 'no meta description');
  else {
    if (desc.length > 165) warn(page, 'meta description is ' + desc.length + ' chars — likely truncated');
    if (desc.length < 70) warn(page, 'meta description is only ' + desc.length + ' chars');
  }

  /* ── Canonical ───────────────────────────────────────────────────── */
  var canonM = html.match(/<link\s+rel="canonical"[^>]*>/i);
  var canon = canonM ? attr(canonM[0], 'href') : null;
  if (indexable) {
    if (!canon) err(page, 'no canonical link');
    else {
      if (!/^https:\/\//.test(canon)) err(page, 'canonical is not an absolute https URL: ' + canon);
      if (sitemapUrls.length && sitemapUrls.indexOf(canon) === -1) {
        err(page, 'canonical ' + canon + ' is not listed in sitemap.xml');
      }
    }
  }

  /* ── Social tags ─────────────────────────────────────────────────── */
  if (indexable) {
    [['og:title', 'property'], ['og:description', 'property'], ['og:url', 'property'],
     ['og:image', 'property'], ['twitter:card', 'name']].forEach(function (pair) {
      if (!meta(html, pair[0], pair[1])) warn(page, 'missing ' + pair[0]);
    });
    var ogUrl = meta(html, 'og:url', 'property');
    if (ogUrl && canon && ogUrl !== canon) {
      warn(page, 'og:url (' + ogUrl + ') does not match canonical (' + canon + ')');
    }
  }

  /* ── Headings ────────────────────────────────────────────────────── */
  var h1s = html.match(/<h1[\s>]/gi) || [];
  if (h1s.length === 0) err(page, 'no <h1>');
  else if (h1s.length > 1) warn(page, h1s.length + ' <h1> elements — should be exactly one');

  /* ── Images ──────────────────────────────────────────────────────── */
  (html.match(/<img\s[^>]*>/gi) || []).forEach(function (tag) {
    var src = attr(tag, 'src');
    if (attr(tag, 'alt') === null) err(page, 'img without alt attribute: ' + (src || tag).slice(0, 70));
    if (src && !/^https?:|^data:/.test(src)) {
      var f = decodeURIComponent(src.split('?')[0]);
      if (!fs.existsSync(f)) err(page, 'img src not found on disk: ' + f);
    }
  });

  /* ── Stylesheets and scripts ──────────────────────────── */
  /* A page that links a stylesheet or script that is not on disk renders
     unstyled or dead, and nothing else here would notice: the img check only
     covers <img>, and the internal-link check only matches .html hrefs. This
     gap let a mistyped asset path pass CI silently. */
  (html.match(/<link\s[^>]*rel="stylesheet"[^>]*>/gi) || []).forEach(function (tag) {
    var href = attr(tag, 'href');
    if (href && !/^https?:|^data:|^\/\//.test(href)) {
      var f = decodeURIComponent(href.split('?')[0]);
      if (!fs.existsSync(f)) err(page, 'stylesheet not found on disk: ' + f);
    }
  });
  (html.match(/<script\s[^>]*src="[^"]*"[^>]*>/gi) || []).forEach(function (tag) {
    var src = attr(tag, 'src');
    if (src && !/^https?:|^data:|^\/\//.test(src)) {
      var f = decodeURIComponent(src.split('?')[0]);
      if (!fs.existsSync(f)) err(page, 'script src not found on disk: ' + f);
    }
  });

  /* ── Internal links ──────────────────────────────────────────────── */
  (html.match(/href="([^"]+\.html[^"]*)"/gi) || []).forEach(function (h) {
    var href = h.replace(/^href="/i, '').replace(/"$/, '');
    if (/^https?:/.test(href)) return;
    var parts = href.split('#');
    var file = parts[0];
    var frag = parts[1];
    if (file && !fs.existsSync(file)) {
      err(page, 'internal link to missing file: ' + href);
      return;
    }
    // The fragment used to be split off and thrown away, so a renamed section
    // id broke every deep link in silence. The unified footer alone points at
    // five services.html anchors from nine pages.
    if (frag) {
      var target = fs.readFileSync(file || page, 'utf8');
      if (target.indexOf('id="' + frag + '"') === -1) {
        err(page, 'link to a fragment that does not exist: ' + href);
      }
    }
  });

  /* Same for same-page anchors (href="#foo"), which were never checked. */
  (html.match(/href="#[^"]+"/g) || []).forEach(function (h) {
    var frag = h.slice(7, -1);
    if (!frag || frag === 'top') return;
    if (html.indexOf('id="' + frag + '"') === -1) {
      err(page, 'same-page link to a missing id: #' + frag);
    }
  });
});

/* ── sitemap coverage ──────────────────────────────────────────────── */
PAGES.forEach(function (page) {
  if (NOINDEX.indexOf(page) !== -1) return;
  var expect = page === 'index.html'
    ? 'https://neualto.com/'
    : 'https://neualto.com/' + page;
  if (sitemapUrls.length && sitemapUrls.indexOf(expect) === -1) {
    warn('sitemap.xml', 'does not list ' + expect);
  }
});

/* ── robots.txt vs sitemap.xml ─────────────────────────────────────────
   These three signals (robots, sitemap, meta robots) contradicted each other
   on privacy.html: it was Disallowed, listed in the sitemap, AND marked
   noindex - and the Disallow meant Google could never fetch the page to read
   the noindex. Nothing caught it because the NOINDEX skip below returns before
   either check. Assert the combination stays coherent. */
if (fs.existsSync('robots.txt')) {
  var robots = fs.readFileSync('robots.txt', 'utf8');
  var disallowed = (robots.match(/^Disallow:\s*(\S+)/gm) || [])
    .map(function (l) { return l.replace(/^Disallow:\s*/, '').trim(); })
    .filter(function (v) { return v && v !== '/'; });

  disallowed.forEach(function (path) {
    var asUrl = 'https://neualto.com' + path;
    if (sitemapUrls.indexOf(asUrl) !== -1) {
      errors.push('robots.txt Disallows ' + path + ' but sitemap.xml lists it');
    }
    var file = path.replace(/^\//, '');
    if (fs.existsSync(file) && /noindex/i.test(fs.readFileSync(file, 'utf8'))) {
      errors.push('robots.txt Disallows ' + path + ' which also has meta noindex - ' +
                  'the Disallow stops crawlers ever reading the noindex');
    }
  });
} else {
  warnings.push('robots.txt is missing');
}

PAGES.forEach(function (page) {
  if (NOINDEX.indexOf(page) === -1) return;
  var expect = page === 'index.html' ? 'https://neualto.com/' : 'https://neualto.com/' + page;
  if (sitemapUrls.indexOf(expect) !== -1) {
    errors.push('sitemap.xml lists ' + expect + ' but the page is noindex');
  }
});

/* ── kb-data.js link targets ───────────────────────────────────────────
   ~50 chatbot answers carry markdown links, none of which were validated.
   A dead link inside an answer is worse than one on a page: the visitor was
   explicitly told to go there. */
if (fs.existsSync('assets/kb-data.js')) {
  var kb = require('../assets/kb-data.js');
  kb.forEach(function (entry) {
    var targets = [];
    var re = /\]\(([^)]+)\)/g;
    var m;
    while ((m = re.exec(entry.a || ''))) targets.push(m[1]);
    if (entry.href) targets.push(entry.href);

    targets.forEach(function (t) {
      if (/^(https?:|mailto:|tel:)/i.test(t)) return;
      var parts = t.split('#');
      var file = parts[0];
      var frag = parts[1];
      if (file && !fs.existsSync(file)) {
        errors.push('kb-data.js [' + entry.id + '] links to a missing file: ' + t);
        return;
      }
      if (frag && file) {
        if (fs.readFileSync(file, 'utf8').indexOf('id="' + frag + '"') === -1) {
          errors.push('kb-data.js [' + entry.id + '] links to a missing fragment: ' + t);
        }
      }
    });
  });
}

/* ── report ────────────────────────────────────────────────────────── */
console.log('Checked ' + PAGES.length + ' pages.\n');

if (errors.length) {
  console.log('ERRORS (' + errors.length + '):');
  errors.forEach(function (m) { console.log('  x ' + m); });
  console.log('');
}
if (warnings.length) {
  console.log('WARNINGS (' + warnings.length + '):');
  warnings.forEach(function (m) { console.log('  ! ' + m); });
  console.log('');
}
if (!errors.length && !warnings.length) console.log('All clean.');

process.exitCode = errors.length ? 1 : 0;
