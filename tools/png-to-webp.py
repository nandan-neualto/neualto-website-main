# -*- coding: utf-8 -*-
"""
One-time asset migration: PNG -> WebP across pics/, then rewrite every
reference in the HTML and JS that points at a converted file.

    python tools/png-to-webp.py --dry-run     # report only, touch nothing
    python tools/png-to-webp.py               # convert + rewrite references

This is NOT a build step. It runs once, the .webp files are committed, and the
site keeps being served as flat static files. Originals are moved to
pics-original/ (gitignored) so the migration can be undone locally; they also
remain recoverable from git history.

WHY THESE SETTINGS
  quality=90 under pics/solutions/  - 80+ of those are UI screenshots, and
                                      text is exactly where lossy WebP shows
                                      artefacts first. The extra ~1.5 MB
                                      site-wide is worth crisp screenshots.
  quality=82 everywhere else        - photos, logos, banners.
  method=6                          - slowest/best encoder search. This is a
                                      one-time run, so the time is free.
  No resizing                       - measured: resizing to display size buys
                                      only ~0.4 MB site-wide over the plain
                                      format swap, at the cost of permanent
                                      quality loss and irreversibility.

CARVE-OUTS (never converted, see SKIP below)
  og-card.png  - og:image / twitter:image / JSON-LD "image". Referenced by
                 absolute URL in 8 HTML files, and LinkedIn's crawler handles
                 WebP og:image inconsistently.
  logo.png     - <link rel="icon"> and JSON-LD "logo". Favicon WebP support is
                 uneven and Google's logo consumer expects PNG/JPG.
"""
import io
import os
import shutil
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PICS = os.path.join(ROOT, 'pics')
BACKUP = os.path.join(ROOT, 'pics-original')

SKIP = {'og-card.png', 'logo.png'}

# Files whose text references need rewriting. assets/assistant-widget.js matters:
# it carries `mascot: opt('mascot', 'pics/chat-widget.png')` as a JS default,
# which an HTML-only pass would silently miss and break the chat avatar.
REWRITE_TARGETS = [
    '404.html', 'blog.html', 'careers.html', 'deltamax.html', 'index.html',
    'optimax.html', 'privacy.html', 'services.html', 'solutions.html',
    'assets/assistant-widget.js',
]

DRY = '--dry-run' in sys.argv


def quality_for(rel_path):
    return 90 if rel_path.replace('\\', '/').startswith('solutions/') else 82


def convert(png_path):
    """Returns (rel_png, rel_webp, old_bytes, new_bytes) or None if skipped."""
    rel = os.path.relpath(png_path, PICS)
    if os.path.basename(png_path) in SKIP:
        return None

    webp_path = os.path.splitext(png_path)[0] + '.webp'
    old_bytes = os.path.getsize(png_path)

    im = Image.open(png_path)
    if im.mode in ('P', 'LA'):
        im = im.convert('RGBA')
    # 111 of these PNGs carry a fully-opaque alpha plane the encoder would
    # otherwise pay for. Dropping a constant channel is free.
    if im.mode == 'RGBA' and im.getchannel('A').getextrema() == (255, 255):
        im = im.convert('RGB')

    if not DRY:
        im.save(webp_path, 'WEBP', quality=quality_for(rel), method=6)
    new_bytes = os.path.getsize(webp_path) if not DRY else 0

    rel_png = 'pics/' + rel.replace('\\', '/')
    rel_webp = rel_png[:-4] + '.webp'
    return (rel_png, rel_webp, old_bytes, new_bytes, png_path)


def main():
    pngs = []
    for dirpath, _dirnames, filenames in os.walk(PICS):
        for fn in filenames:
            if fn.lower().endswith('.png'):
                pngs.append(os.path.join(dirpath, fn))
    pngs.sort()

    results = [r for r in (convert(p) for p in pngs) if r]
    total_old = sum(r[2] for r in results)
    total_new = sum(r[3] for r in results)

    print('%s %d PNG -> WebP' % ('[dry-run]' if DRY else 'Converted', len(results)))
    print('  skipped (carve-outs): %s' % ', '.join(sorted(SKIP)))
    if not DRY:
        print('  %.2f MB -> %.2f MB  (-%.1f%%)'
              % (total_old / 1048576.0, total_new / 1048576.0,
                 100.0 * (total_old - total_new) / total_old))

    if DRY:
        return

    # Move originals out of pics/ so nothing stale is served or committed.
    for _rel_png, _rel_webp, _o, _n, abs_png in results:
        dest = os.path.join(BACKUP, os.path.relpath(abs_png, PICS))
        d = os.path.dirname(dest)
        if not os.path.isdir(d):
            os.makedirs(d)
        shutil.move(abs_png, dest)
    print('  originals moved to pics-original/ (gitignored)')

    # Rewrite references. Match the quoted full path so "Deltamax.png" cannot
    # accidentally hit "Deltamax-page4.png".
    mapping = [(r[0], r[1]) for r in results]
    mapping.sort(key=lambda kv: len(kv[0]), reverse=True)

    total_refs = 0
    for target in REWRITE_TARGETS:
        path = os.path.join(ROOT, target)
        if not os.path.exists(path):
            continue
        s = io.open(path, encoding='utf-8').read()
        orig = s
        n = 0
        for old, new in mapping:
            for quote in ('"', "'"):
                token = quote + old + quote
                c = s.count(token)
                if c:
                    s = s.replace(token, quote + new + quote)
                    n += c
        if s != orig:
            io.open(path, 'w', encoding='utf-8').write(s)
            print('  %-24s %d references rewritten' % (target, n))
            total_refs += n
    print('  %d references rewritten in total' % total_refs)


if __name__ == '__main__':
    main()
