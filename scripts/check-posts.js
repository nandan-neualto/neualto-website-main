/**
 * Validates content/blog/*.md before the generator turns it into pages.
 *
 *   node scripts/check-posts.js
 *
 * Catches the mistakes that are invisible until someone loads the blog and
 * sees a dead embed or a duplicated filter button: an unreadable LinkedIn
 * link, the same post added twice, a missing summary (the only text Google
 * can index), a malformed date, or a tag that differs from an existing one
 * only by capitalisation.
 *
 * Exits 1 on errors so it can gate a deploy; warnings alone exit 0.
 */
'use strict';

var lib = require('./content-lib.js');

var errors = [];
var warnings = [];

/* The same reader the generator builds from, so this fails on exactly what
   build-content.js would choke on. Load errors (bad front matter, a bad slug)
   land in the same list as the content errors below. */
var POSTS = lib.loadCollection('content/blog', function (where, message) {
  errors.push(where + ': ' + message);
});

/* Name the file, not the array index: "#2" tells an editor nothing about
   which post to open. */
function label(post) {
  return post.where;
}


var seenUrn = {};
var tagCasing = {};   // lowercased tag -> first spelling seen

POSTS.forEach(function (post) {
  var who = label(post);
  var urn = lib.extractUrn(post.linkedin);
  var hasArticle = !post.linkedinOnly && !!post.body;
  /* A LinkedIn link is only required for a post with no article page of its
     own. Native articles (content/blog/<slug>.md with a body) live at
     blog-<slug>.html and need no embed - requiring one here would make it
     impossible to publish anything that did not start life on LinkedIn. */
  if (!urn && !hasArticle) {
    errors.push(who + ': has neither an article page nor a LinkedIn post id.' +
      '\n      Give it a body in content/blog/, or set "linkedin" to a URL like' +
      '\n      https://www.linkedin.com/feed/update/urn:li:activity:1234567890123456789/');
  } else if (urn && seenUrn[urn]) {
    errors.push(who + ': duplicate of ' + seenUrn[urn] + ' — both point at post id ' + urn);
  } else if (urn) {
    seenUrn[urn] = who;
  }

  if (!post.title || !String(post.title).trim()) {
    errors.push(who + ': missing "title".');
  }

  if (!post.summary || !String(post.summary).trim()) {
    errors.push(who + ': missing "summary". This is the only text search engines can ' +
      'read for this post — the LinkedIn embed is an iframe and is never indexed.');
  } else if (String(post.summary).trim().length < 80) {
    warnings.push(who + ': summary is very short (' + String(post.summary).trim().length +
      ' chars). Aim for 1–3 real sentences so the post stands on its own.');
  }

  if (!post.date) {
    warnings.push(who + ': no "date" — it will sort to the bottom of the page.');
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(post.date)) {
    errors.push(who + ': date "' + post.date + '" is not in YYYY-MM-DD form.');
  } else if (isNaN(Date.parse(post.date + 'T00:00:00'))) {
    errors.push(who + ': date "' + post.date + '" is not a real calendar date.');
  }

  var tags = post.tags;
  if (!tags || !Array.isArray(tags) || !tags.length) {
    warnings.push(who + ': no "tags" — the post shows only under "All Posts".');
  } else {
    tags.forEach(function (tag) {
      var text = String(tag).trim();
      if (!text) {
        warnings.push(who + ': has an empty tag.');
        return;
      }
      var key = text.toLowerCase();
      if (tagCasing[key] && tagCasing[key] !== text) {
        warnings.push(who + ': tag "' + text + '" differs from "' + tagCasing[key] +
          '" only by case/spacing — that produces two separate filter buttons.');
      } else if (!tagCasing[key]) {
        tagCasing[key] = text;
      }
    });
  }
});

console.log('Checked ' + POSTS.length + ' post' + (POSTS.length === 1 ? '' : 's') + ' in content/blog/.');

if (errors.length) {
  console.log('\nERRORS (' + errors.length + ') — these will break the page:');
  errors.forEach(function (message) { console.log('  ✗ ' + message); });
}

if (warnings.length) {
  console.log('\nWARNINGS (' + warnings.length + ') — worth fixing, page still works:');
  warnings.forEach(function (message) { console.log('  ! ' + message); });
}

if (!errors.length && !warnings.length) {
  var tags = Object.keys(tagCasing).map(function (k) { return tagCasing[k]; }).sort();
  console.log('\nAll good. Filter buttons that will appear: All Posts, ' + tags.join(', '));
}

process.exitCode = errors.length ? 1 : 0;
