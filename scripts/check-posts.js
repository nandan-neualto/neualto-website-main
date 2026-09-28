/**
 * Validates content/blog/*.md before the generator turns it into pages.
 *
 *   node scripts/check-posts.js
 *
 * Loads the posts through lib.loadPosts - the same reader, required fields and
 * article/LinkedIn rules the generator builds from - so anything that would
 * stop build-content.js is an error here too. On top of that it catches what
 * the build would accept but a visitor would notice: the same LinkedIn post
 * added twice, a summary too thin to stand on its own, a malformed date, or a
 * tag that differs from an existing one only by capitalisation.
 *
 * Exits 1 on errors so it can gate a deploy; warnings alone exit 0.
 */
'use strict';

var lib = require('./content-lib.js');

var errors = [];
var warnings = [];

var POSTS = lib.loadPosts(function (where, message) {
  errors.push(where + ': ' + message);
});

var seenUrn = {};
var tagCasing = {};   // lowercased tag -> first spelling seen

POSTS.forEach(function (post) {
  var who = post.where;

  if (post.urn && seenUrn[post.urn]) {
    errors.push(who + ': duplicate of ' + seenUrn[post.urn] + ' — both point at post id ' + post.urn);
  } else if (post.urn) {
    seenUrn[post.urn] = who;
  }

  var summary = String(post.summary || '').trim();
  if (summary && summary.length < 80) {
    warnings.push(who + ': summary is very short (' + summary.length +
      ' chars). Aim for 1–3 real sentences so the post stands on its own.');
  }

  if (post.date && !/^\d{4}-\d{2}-\d{2}$/.test(post.date)) {
    errors.push(who + ': date "' + post.date + '" is not in YYYY-MM-DD form.');
  } else if (post.date && isNaN(Date.parse(post.date + 'T00:00:00'))) {
    errors.push(who + ': date "' + post.date + '" is not a real calendar date.');
  }

  if (post.tags && !Array.isArray(post.tags)) {
    errors.push(who + ': "tags" must be a list, like ["Leadership"].');
    return;
  }
  (post.tags || []).forEach(function (tag) {
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
  console.log('\nAll good. Tags in use: ' + tags.join(', '));
}

process.exitCode = errors.length ? 1 : 0;
