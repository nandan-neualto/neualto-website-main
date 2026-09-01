/**
 * Header / footer parity checker.
 *
 *   node scripts/check-chrome.js
 *
 * The 9 pages each carry a hand-pasted copy of the site header and footer —
 * ~490 lines of duplication. That is a deliberate architectural choice for a
 * build-free static site (injecting the chrome with JS would strip the nav
 * links out of the served HTML, break with JS disabled, and break file://),
 * but nothing was enforcing that the copies stayed identical. They had not:
 * no two footers in the repo matched, one page was missing its FAQ link,
 * another its Founders link, another had no LinkedIn link at all.
 *
 * This compares the <header> and <footer> of every page against the most
 * common variant, ignoring the per-page bits that are *supposed* to differ
 * (the active-state marker, the scrollspy id, and the home page's #top logo
 * href). Anything left over is drift.
 *
 * Exits 1 on drift so it can gate a deploy.
 */
'use strict';

var fs = require('fs');

var PAGES = ['index.html', 'services.html', 'solutions.html', 'deltamax.html',
             'optimax.html', 'blog.html', 'careers.html', '404.html', 'privacy.html'];

// index.html intentionally carries a different, larger footer (the 3-column
// mega-footer). Compare its header, but exempt its footer from the diff.
var FOOTER_EXEMPT = ['index.html'];

var errors = [];
var warnings = [];

function extract(html, tag) {
  var open = html.indexOf('<' + tag);
  if (open === -1) return null;
  var close = html.indexOf('</' + tag + '>', open);
  if (close === -1) return null;
  return html.slice(open, close + tag.length + 3);
}

/**
 * Strips everything a page is legitimately allowed to differ on, so that what
 * remains is either identical across pages or is real drift.
 */
function normalise(block) {
  return block
    .replace(/\s+class="([^"]*)\s*active\s*([^"]*)"/g, function (_m, a, b) {
      var rest = (a + ' ' + b).trim();
      return rest ? ' class="' + rest + '"' : '';
    })
    .replace(/\s+class=""/g, '')
    .replace(/\s+id="spy"/g, '')            // scrollspy only exists on the home page
    .replace(/\s+data-spy="[^"]*"/g, '')
    .replace(/href="#top"/g, 'href="index.html"')   // home page self-link
    // The primary CTA is deliberately page-specific: careers.html offers
    // "Send Resume" where the rest of the site offers "Request a Demo".
    // That is intentional variance, and this checker exists to catch the
    // accidental kind.
    .replace(/(<a class="btn btn-primary[^"]*"[^>]*>)[^<]*(<\/a>)/g, '$1CTA$2')
    .replace(/href="mailto:[^"]*"/g, 'href="mailto:CTA"')
    .replace(/href="index\.html#/g, 'href="#')      // in-page vs cross-page anchors
    .replace(/href="(\w+)\.html"/g, function (_m, p) {
      return 'href="' + p + '.html"';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pulls the visible link labels out of a chrome block, for readable reporting. */
function links(block) {
  var out = [];
  var re = /<a\b[^>]*>([\s\S]*?)<\/a>/g;
  var m;
  while ((m = re.exec(block))) {
    var text = m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
    if (text) out.push(text);
  }
  return out;
}

/* A nav that lists the same href twice. This is its own check because the
   link-set comparison below cannot see it: that compares membership with
   indexOf, so a repeated link is present in both sets and reads as identical.
   careers.html shipped with a duplicated "Founders" in the desktop nav and
   none in the mobile nav, and the set comparison downgraded it to a markup
   warning. Scoped per <nav> deliberately - a <header> holds both the desktop
   and the mobile nav, so every href legitimately appears twice at header
   level, and footers have no <nav> at all. */
function duplicateHrefs(page, block, tag) {
  var navs = block.match(/<nav\b[\s\S]*?<\/nav>/g) || [];
  navs.forEach(function (nav) {
    var label = (nav.match(/aria-label="([^"]*)"/) || [])[1] || tag;
    var seen = {};
    var dupes = [];
    (nav.match(/href="([^"]*)"/g) || []).forEach(function (h) {
      if (seen[h] && dupes.indexOf(h) === -1) dupes.push(h);
      seen[h] = true;
    });
    if (dupes.length) {
      errors.push(page + ' <' + tag + '> nav "' + label + '" lists the same link twice: ' +
                  dupes.join(', '));
    }
  });
}

function majority(values) {
  var counts = {};
  values.forEach(function (v) { counts[v] = (counts[v] || 0) + 1; });
  var best = null;
  Object.keys(counts).forEach(function (k) {
    if (best === null || counts[k] > counts[best]) best = k;
  });
  return best;
}

function compare(tag, pages) {
  var blocks = {};
  pages.forEach(function (p) {
    if (!fs.existsSync(p)) { errors.push(p + ': file missing'); return; }
    var block = extract(fs.readFileSync(p, 'utf8'), tag);
    if (!block) { errors.push(p + ': no <' + tag + '>'); return; }
    blocks[p] = block;
  });

  var names = Object.keys(blocks);
  if (!names.length) return;

  names.forEach(function (p) { duplicateHrefs(p, blocks[p], tag); });

  var normalised = {};
  names.forEach(function (p) { normalised[p] = normalise(blocks[p]); });

  var canonical = majority(names.map(function (p) { return normalised[p]; }));
  var canonicalPage = names.filter(function (p) { return normalised[p] === canonical; })[0];
  var matching = names.filter(function (p) { return normalised[p] === canonical; });

  console.log('  <' + tag + '>: ' + matching.length + '/' + names.length +
              ' pages match the majority variant (' + canonicalPage + ')');

  names.forEach(function (p) {
    if (normalised[p] === canonical) return;

    // A missing or extra nav/footer item is the bug this checker exists for -
    // that is how blog.html lost its FAQ link and 404.html its LinkedIn link.
    // Pure markup differences (indentation, an in-page #anchor where another
    // page uses a full href) are reported as warnings: they are usually
    // legitimate per-page variation, and treating them as failures would make
    // the checker something people switch off.
    var mine = links(normalise(blocks[p]));
    var theirs = links(normalise(blocks[canonicalPage]));
    var missing = theirs.filter(function (l) { return mine.indexOf(l) === -1; });
    var extra = mine.filter(function (l) { return theirs.indexOf(l) === -1; });

    if (missing.length || extra.length) {
      var detail = [];
      if (missing.length) detail.push('missing: ' + missing.join(', '));
      if (extra.length) detail.push('extra: ' + extra.join(', '));
      errors.push(p + ' <' + tag + '> link set differs from ' + canonicalPage +
                  ' - ' + detail.join(' | '));
    } else {
      warnings.push(p + ' <' + tag + '> has the right links but different markup to ' +
                    canonicalPage + ' (indentation or in-page anchors)');
    }
  });
}

console.log('Comparing site chrome across ' + PAGES.length + ' pages.\n');
compare('header', PAGES);
compare('footer', PAGES.filter(function (p) { return FOOTER_EXEMPT.indexOf(p) === -1; }));

/* A pre-JS state check: app.js sets aria-pressed on the theme toggle at init,
   but a deferred script means the control is a nameless-state toggle until
   then, and reports nothing at all if JS fails. */
PAGES.forEach(function (p) {
  if (!fs.existsSync(p)) return;
  var html = fs.readFileSync(p, 'utf8');
  if (html.indexOf('id="themeToggle"') !== -1 && html.indexOf('aria-pressed') === -1) {
    warnings.push(p + ': theme toggle has no static aria-pressed (added by app.js at runtime only)');
  }
});

console.log('');
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
if (!errors.length && !warnings.length) console.log('Chrome is consistent across all pages.');

process.exitCode = errors.length ? 1 : 0;
