/**
 * Shared loading and parsing for content/, plus the repo-relative file access
 * every script uses.
 *
 * Both the generator (build-content.js) and the validator (check-posts.js) read
 * the same markdown files, and used to carry their own copy of the front-matter
 * parser, the LinkedIn id extractor and the post rules. Two copies drift: the
 * point of check-posts.js is to fail on exactly what build-content.js would
 * choke on, which only holds if they parse and classify identically. Now they
 * do, because it is the same function (loadPosts).
 *
 * Errors are reported through an `onError(where, message)` callback rather than
 * thrown, so each caller collects them its own way and can report every problem
 * in one run instead of stopping at the first.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');

/** Reads a file with line endings normalised, so CRLF checkouts match CI. */
function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
}

/** Whether a repo-relative path exists, independent of the working directory. */
function exists(file) {
  return fs.existsSync(path.join(ROOT, file));
}

var readCache = {};

/**
 * read(), memoised. For the checkers, which look at the same few pages many
 * times over (every #fragment link re-opens its target). Never use it for a
 * file the running script also writes.
 */
function readCached(file) {
  if (!Object.prototype.hasOwnProperty.call(readCache, file)) readCache[file] = read(file);
  return readCache[file];
}

/**
 * JSON front matter between `---` fences, then the markdown body.
 *
 * JSON rather than YAML: this repo has no dependencies, and adding a YAML
 * parser to read a handful of files would be the largest dependency in the
 * project. JSON.parse is built in and fails loudly on a typo, which is what you
 * want from content someone just saved. Pages CMS writes this shape natively.
 */
function parseFrontMatter(raw, where, onError) {
  var match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    onError(where, 'no JSON front matter block (expected --- ... --- at the top)');
    return null;
  }
  var data;
  try {
    data = JSON.parse(match[1]);
  } catch (e) {
    onError(where, 'front matter is not valid JSON - ' + e.message);
    return null;
  }
  data.body = match[2].trim();
  return data;
}

/** Every .md in `dir`, parsed, with `slug` (the filename) and `where` attached. */
function loadCollection(dir, onError) {
  var abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs).sort()        // sort: readdir order is not guaranteed
    .filter(function (f) { return /\.md$/.test(f); })
    .map(function (file) {
      var slug = file.replace(/\.md$/, '');
      var where = dir + '/' + file;
      if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
        onError(where, 'slug must be lowercase letters, digits and hyphens - it becomes the URL');
      }
      var entry = parseFrontMatter(read(dir + '/' + file), where, onError);
      if (!entry) return null;
      entry.slug = slug;
      entry.where = where;
      return entry;
    })
    .filter(Boolean);
}

/**
 * Pulls the numeric activity id out of whatever LinkedIn handed over: a
 * /posts/ share link, a /feed/update/ permalink, or a bare id. Returns null
 * when there is none, which is the signal that a post has no embed.
 */
function extractUrn(value) {
  var raw = String(value == null ? '' : value).trim();
  if (!raw) return null;
  if (/^\d{6,}$/.test(raw)) return raw;
  var match = raw.match(/activity[:\-](\d{6,})/i);
  return match ? match[1] : null;
}

/** Reports every field that is absent, empty, or an empty array. */
function requireFields(entry, fields, onError) {
  fields.forEach(function (f) {
    var v = entry[f];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) {
      onError(entry.where, 'missing required field "' + f + '"');
    }
  });
}

/**
 * The published blog posts, validated and classified the one way both the
 * generator and the checker see them - so a clean `check-posts` run means the
 * build will accept the same files.
 *
 * Required fields are checked on every file, drafts included; drafts are then
 * dropped. Each remaining post gains `urn` (its LinkedIn activity id, or null)
 * and `hasPage` (whether it gets an article page of its own, which is also
 * what puts it in the articles band rather than the LinkedIn one).
 */
function loadPosts(onError) {
  return loadCollection('content/blog', onError).filter(function (p) {
    requireFields(p, ['title', 'date', 'tags', 'summary'], onError);
    if (p.draft) return false;           // draft: keep in git, keep off the site

    p.urn = extractUrn(p.linkedin);
    if (p.linkedinOnly && !p.urn) {
      onError(p.where, 'linkedinOnly is set but no LinkedIn activity id could be found in "linkedin".' +
        ' Use a URL like https://www.linkedin.com/feed/update/urn:li:activity:1234567890123456789/');
    }
    if (!p.linkedinOnly && !p.body) {
      onError(p.where, 'no body. Either write the article, or set "linkedinOnly": true to publish it as a card only');
    }
    p.hasPage = !p.linkedinOnly && !!p.body;
    return true;
  });
}

module.exports = {
  ROOT: ROOT,
  read: read,
  exists: exists,
  readCached: readCached,
  parseFrontMatter: parseFrontMatter,
  loadCollection: loadCollection,
  loadPosts: loadPosts,
  extractUrn: extractUrn,
  requireFields: requireFields
};
