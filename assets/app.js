/**
 * NeuAlto Technologies — site behaviour
 * =====================================
 *
 * ARCHITECTURE
 * ------------
 * Every page loads this one file. It is organised as a registry of independent
 * feature modules, each of which:
 *
 *   1. declares the DOM it needs,
 *   2. exits quietly when that DOM is absent (pages share this script, so most
 *      modules are inert on most pages), and
 *   3. is initialised in isolation, so a failure in one cannot break the others.
 *
 * To add a feature: write a module object and append it to `MODULES`. To remove
 * one, delete it — nothing else references it.
 *
 * WHY A SINGLE FILE (rather than ES modules)?
 * The site is deployed as plain static files with no build step. A single
 * classic script keeps that true: one request, no bundler, and it still works
 * when the HTML is opened straight from disk (`file://`), which ES modules
 * cannot do because of their CORS rules. The module *structure* below gives the
 * separation of concerns; the single file is purely a delivery choice.
 *
 * CONVENTIONS
 * -----------
 * - Theme is applied by a small inline script in each page's <head> (to avoid a
 *   flash of the wrong theme). This file only handles *toggling* it.
 * - Anything animated must respect `Env.reducedMotion`.
 * - Anything that renders user-supplied strings must go through `escapeHtml`.
 */
(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════════
     1. ENVIRONMENT
     Capability and preference checks, resolved once at startup.
     ══════════════════════════════════════════════════════════════════════ */

  /** Viewport width (px) below which decorative canvases are skipped. */
  var LOW_POWER_MAX_WIDTH = 720;

  var Env = {
    /** True when the visitor has asked the OS to reduce animation. */
    reducedMotion: matches('(prefers-reduced-motion: reduce)'),

    /**
     * True for touch devices and narrow viewports. These get no benefit from
     * the pointer-reactive background canvases, so we skip the per-frame cost
     * entirely rather than burning battery on them.
     */
    lowPower: matches('(pointer: coarse)') || window.innerWidth < LOW_POWER_MAX_WIDTH,

    /** Current theme, read live because the toggle can change it at any time. */
    isDark: function () {
      return document.documentElement.getAttribute('data-theme') === 'dark';
    }
  };

  function matches(query) {
    return !!(window.matchMedia && window.matchMedia(query).matches);
  }

  /* ══════════════════════════════════════════════════════════════════════
     2. DOM HELPERS
     ══════════════════════════════════════════════════════════════════════ */

  /** @returns {Element|null} */
  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  /** @returns {Element[]} A real array, so map/filter/reduce are available. */
  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  /** Escapes a string for safe interpolation into an HTML template. */
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  /**
   * Calls `fn` at most once per animation frame, no matter how often the
   * returned function fires. Used for scroll handlers.
   */
  function rafThrottle(fn) {
    var queued = false;
    return function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        fn();
      });
    };
  }

  /** Calls `fn` only once `wait` ms have passed without another call. */
  function debounce(fn, wait) {
    var timer;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, wait);
    };
  }

  /* ══════════════════════════════════════════════════════════════════════
     3. CANVAS BACKGROUNDS

     One shared engine drives every decorative canvas. A "scene" is a setup
     function that receives the 2D context and returns a per-frame draw
     function — this split lets each scene allocate its buffers once and keep
     the hot loop allocation-free.

     Scenes are registered in `SCENES` by canvas element id. Adding a new
     background = adding one entry there and one <canvas id="..."> in the HTML.
     ══════════════════════════════════════════════════════════════════════ */

  /** Cap device-pixel-ratio: beyond 2 the extra pixels are not perceptible. */
  var MAX_DPR = 2;
  var TAU = Math.PI * 2;

  /**
   * Brand colours used by the canvas scenes, as `rgba(r,g,b,` prefixes ready
   * for an alpha suffix.
   *
   * Centralised here because all four scenes previously repeated these literals,
   * which made re-tuning the palette a find-and-replace across the file.
   *
   * @param {boolean} dark
   */
  function palette(dark) {
    return {
      red: dark ? 'rgba(239,68,68,' : 'rgba(166,20,20,',
      redDeep: dark ? 'rgba(220,38,38,' : 'rgba(140,12,12,',
      wave: dark ? 'rgba(239,68,68,' : 'rgba(176,20,20,',
      coral: dark ? 'rgba(255,122,89,' : 'rgba(200,48,28,'
    };
  }

  /** Canvases that have been mounted, so one resize listener can serve them all. */
  var mountedCanvases = [];

  /**
   * Mounts a scene onto a canvas element.
   *
   * Responsibilities: hi-DPI sizing, visibility-based pausing (an off-screen
   * canvas costs nothing), and honouring reduced-motion by painting a single
   * static frame instead of animating.
   *
   * @param {string} id    Canvas element id.
   * @param {Function} setup  `(ctx) => (tick, width, height) => void`
   */
  function mountCanvas(id, setup) {
    var canvas = document.getElementById(id);
    if (!canvas || !canvas.getContext) return;

    // Touch/small screens: hide it outright rather than paying for frames.
    if (Env.lowPower) {
      canvas.style.display = 'none';
      return;
    }

    var ctx = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    var width = 0;
    var height = 0;

    function resize() {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      // Draw in CSS pixels; the transform maps them onto the backing store.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    resize();
    mountedCanvases.push(resize);

    var draw = setup(ctx);
    var running = !Env.reducedMotion;
    var rafId = null;
    var tick = 0;

    function frame() {
      // The canvas may not have been laid out when we first ran; recover here.
      if (!width || !height) resize();
      if (width && height) {
        draw(tick, width, height);
        tick++;
      }
      if (running) rafId = requestAnimationFrame(frame);
    }

    frame(); // Always paint at least one frame, even under reduced-motion.

    // Pause whenever the canvas scrolls out of view.
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        if (Env.reducedMotion) return;
        var visible = entries[0].isIntersecting;
        if (visible && !running) {
          running = true;
          rafId = requestAnimationFrame(frame);
        } else if (!visible && running) {
          running = false;
          if (rafId) cancelAnimationFrame(rafId);
        }
      }).observe(canvas);
    }
  }

  // A single debounced resize listener drives every canvas, rather than each
  // canvas registering its own.
  window.addEventListener('resize', debounce(function () {
    mountedCanvases.forEach(function (resize) { resize(); });
  }, 150));

  /**
   * Scene definitions, keyed by canvas id.
   * @type {Object<string, function(CanvasRenderingContext2D): Function>}
   */
  var SCENES = {

    /** Hero: rotating particle globe that leans toward the pointer. */
    bg3d: function (ctx) {
      var COUNT = 240;
      var LINK_THRESHOLD = 0.972; // Dot product above which two points are linked.
      var FOV = 2.6;

      // Unit-sphere positions, and reusable buffers for the projected result.
      var px = new Float32Array(COUNT), py = new Float32Array(COUNT), pz = new Float32Array(COUNT);
      var sx = new Float32Array(COUNT), sy = new Float32Array(COUNT), depth = new Float32Array(COUNT);

      // Fibonacci sphere: even distribution without clustering at the poles.
      for (var i = 0; i < COUNT; i++) {
        var y = 1 - (i / (COUNT - 1)) * 2;
        var radius = Math.sqrt(Math.max(0, 1 - y * y));
        var theta = i * 2.39996323; // golden angle
        px[i] = Math.cos(theta) * radius;
        py[i] = y;
        pz[i] = Math.sin(theta) * radius;
      }

      // Neighbour pairs are fixed on the unit sphere, so resolve them once and
      // store flat (a, b, a, b, …) to keep the draw loop allocation-free.
      var links = [];
      for (var a = 0; a < COUNT; a++) {
        for (var b = a + 1; b < COUNT; b++) {
          if (px[a] * px[b] + py[a] * py[b] + pz[a] * pz[b] > LINK_THRESHOLD) links.push(a, b);
        }
      }

      var spinY = 0;
      var tiltX = -0.35;
      var targetTiltX = -0.35;
      var pointerX = 0;

      window.addEventListener('mousemove', function (e) {
        pointerX = e.clientX / window.innerWidth - 0.5;
        targetTiltX = -0.35 + (e.clientY / window.innerHeight - 0.5) * 0.5;
      }, { passive: true });

      return function (tick, W, H) {
        ctx.clearRect(0, 0, W, H);
        var dark = Env.isDark();
        var c = palette(dark);
        var i;

        spinY += 0.0022 + pointerX * 0.003;
        tiltX += (targetTiltX - tiltX) * 0.05; // ease toward the pointer

        var cosY = Math.cos(spinY), sinY = Math.sin(spinY);
        var cosX = Math.cos(tiltX), sinX = Math.sin(tiltX);
        var R = Math.min(W, H) * 0.55;
        var cx = W / 2, cy = H * 0.44;

        // Rotate around Y, then X, then apply perspective divide.
        for (i = 0; i < COUNT; i++) {
          var x1 = px[i] * cosY + pz[i] * sinY;
          var z1 = -px[i] * sinY + pz[i] * cosY;
          var y1 = py[i] * cosX - z1 * sinX;
          var z2 = py[i] * sinX + z1 * cosX;
          var scale = FOV / (FOV + z2);
          sx[i] = cx + x1 * R * scale;
          sy[i] = cy + y1 * R * scale * 0.92;
          depth[i] = (1 - z2) / 2; // 0 = far, 1 = near
        }

        ctx.lineWidth = 1;
        for (var l = 0; l < links.length; l += 2) {
          var ia = links[l], ib = links[l + 1];
          var d = Math.min(depth[ia], depth[ib]);
          if (d < 0.25) continue; // hide links on the far side
          ctx.strokeStyle = c.red + ((dark ? 0.05 : 0.07) + d * (dark ? 0.2 : 0.22)).toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(sx[ia], sy[ia]);
          ctx.lineTo(sx[ib], sy[ib]);
          ctx.stroke();
        }

        for (i = 0; i < COUNT; i++) {
          // Every sixth particle picks up the coral accent.
          ctx.fillStyle = (i % 6 === 0)
            ? c.coral + ((dark ? 0.14 : 0.22) + depth[i] * (dark ? 0.6 : 0.62)).toFixed(3) + ')'
            : c.red + ((dark ? 0.10 : 0.16) + depth[i] * (dark ? 0.5 : 0.55)).toFixed(3) + ')';
          ctx.beginPath();
          ctx.arc(sx[i], sy[i], 0.8 + depth[i] * 1.8, 0, TAU);
          ctx.fill();
        }
      };
    },

    /** Services: rolling perspective wave grid. */
    bgWave: function (ctx) {
      var COLS = 46;
      var ROWS = 15;
      // Each row's points are computed once, then reused by the line pass and
      // the dot pass below.
      var xs = new Float32Array(COLS);
      var ys = new Float32Array(COLS);

      return function (tick, W, H) {
        ctx.clearRect(0, 0, W, H);
        var dark = Env.isDark();
        var c = palette(dark).wave;
        var time = tick * 0.014;
        var col;

        ctx.lineWidth = 1;
        for (var row = 0; row < ROWS; row++) {
          var z = row / (ROWS - 1); // 0 = far, 1 = near
          var spread = 0.52 * (0.35 + 0.65 * z);
          var baseY = H * (0.16 + z * 0.74);
          var amplitude = H * 0.032 * (0.3 + z);

          for (col = 0; col < COLS; col++) {
            var x = (col / (COLS - 1) - 0.5) * 2;
            // Two out-of-phase waves so the grid never looks like it loops.
            var wave = Math.sin(x * 3.1 + time + z * 4.2) * Math.cos(x * 1.3 - time * 0.7);
            xs[col] = W * (0.5 + x * spread);
            ys[col] = baseY + wave * amplitude;
          }

          ctx.strokeStyle = c + ((dark ? 0.06 : 0.06) + z * (dark ? 0.13 : 0.16)).toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(xs[0], ys[0]);
          for (col = 1; col < COLS; col++) ctx.lineTo(xs[col], ys[col]);
          ctx.stroke();

          ctx.fillStyle = c + ((dark ? 0.09 : 0.10) + z * (dark ? 0.28 : 0.30)).toFixed(3) + ')';
          for (col = 0; col < COLS; col += 3) {
            ctx.beginPath();
            ctx.arc(xs[col], ys[col], 0.8 + z * 1.3, 0, TAU);
            ctx.fill();
          }
        }
      };
    },

    /** About: drifting constellation whose nodes link when they come close. */
    bgAbout: function (ctx) {
      var COUNT = 70;
      var LINK_DISTANCE = 130;
      var MARGIN = 20; // wrap-around padding, in px

      var px = new Float32Array(COUNT), py = new Float32Array(COUNT);
      var vx = new Float32Array(COUNT), vy = new Float32Array(COUNT);
      var radii = new Float32Array(COUNT);
      var seeded = false;

      return function (tick, W, H) {
        var i;

        // Seeding needs the real canvas size, which is not known at setup time.
        // Deterministic pseudo-random values keep the layout stable per reload.
        if (!seeded) {
          for (i = 0; i < COUNT; i++) {
            px[i] = ((i * 733) % 997) / 997 * W;
            py[i] = ((i * 389) % 991) / 991 * H;
            vx[i] = (((i * 7919) % 100) / 100 - 0.5) * 0.4;
            vy[i] = (((i * 104729) % 100) / 100 - 0.5) * 0.4;
            radii[i] = 1 + ((i * 31) % 18) / 10;
          }
          seeded = true;
        }

        ctx.clearRect(0, 0, W, H);
        var dark = Env.isDark();
        var c = palette(dark).red;

        for (i = 0; i < COUNT; i++) {
          px[i] += vx[i];
          py[i] += vy[i];
          if (px[i] < -MARGIN) px[i] = W + MARGIN;
          else if (px[i] > W + MARGIN) px[i] = -MARGIN;
          if (py[i] < -MARGIN) py[i] = H + MARGIN;
          else if (py[i] > H + MARGIN) py[i] = -MARGIN;
        }

        // Link pass: O(n²) but n is small and the squared-distance test avoids
        // a sqrt for the majority of pairs that are too far apart.
        ctx.lineWidth = 1;
        for (var a = 0; a < COUNT; a++) {
          for (var b = a + 1; b < COUNT; b++) {
            var dx = px[a] - px[b];
            var dy = py[a] - py[b];
            var distSq = dx * dx + dy * dy;
            if (distSq < LINK_DISTANCE * LINK_DISTANCE) {
              var alpha = (1 - Math.sqrt(distSq) / LINK_DISTANCE) * (dark ? 0.16 : 0.12);
              ctx.strokeStyle = c + alpha.toFixed(3) + ')';
              ctx.beginPath();
              ctx.moveTo(px[a], py[a]);
              ctx.lineTo(px[b], py[b]);
              ctx.stroke();
            }
          }
        }

        for (i = 0; i < COUNT; i++) {
          var twinkle = 0.7 + 0.3 * Math.sin(tick * 0.03 + i);
          ctx.fillStyle = c + ((dark ? 0.42 : 0.32) * twinkle).toFixed(3) + ')';
          ctx.beginPath();
          ctx.arc(px[i], py[i], radii[i], 0, TAU);
          ctx.fill();
        }
      };
    },

    /** Founders: tilted orbital rings carrying satellites. */
    bgOrbits: function (ctx) {
      var SEGMENTS = 72;
      var FOV = 2.8;
      var RINGS = [
        { tilt: 0.95, speed: 0.005, radius: 0.46, satellites: 5, light: '176,20,20', dark: '239,68,68' },
        { tilt: 2.25, speed: -0.004, radius: 0.36, satellites: 4, light: '200,48,28', dark: '255,122,89' },
        { tilt: -0.50, speed: 0.003, radius: 0.55, satellites: 6, light: '140,12,12', dark: '220,38,38' }
      ];

      return function (tick, W, H) {
        ctx.clearRect(0, 0, W, H);
        var isDark = Env.isDark();
        var cx = W / 2;
        var cy = H * 0.46;
        var scale = Math.min(W, H) * 0.75;

        for (var r = 0; r < RINGS.length; r++) {
          var ring = RINGS[r];
          var rgb = isDark ? ring.dark : ring.light;
          var rotation = tick * ring.speed;
          var cosTilt = Math.cos(ring.tilt), sinTilt = Math.sin(ring.tilt);
          var cosRot = Math.cos(rotation), sinRot = Math.sin(rotation);

          // Projects an angle on the ring to screen space. Declared per ring so
          // it closes over that ring's rotation/tilt.
          var project = function (angle) {
            var x = Math.cos(angle) * ring.radius;
            var z = Math.sin(angle) * ring.radius;
            var x1 = x * cosRot + z * sinRot;
            var z1 = -x * sinRot + z * cosRot;
            var y1 = -z1 * sinTilt;
            var z2 = z1 * cosTilt;
            var persp = FOV / (FOV + z2);
            return { x: cx + x1 * scale * persp, y: cy + y1 * scale * persp, depth: (1 - z2) / 2 };
          };

          ctx.lineWidth = 1;
          ctx.beginPath();
          for (var s = 0; s <= SEGMENTS; s++) {
            var p = project((s / SEGMENTS) * TAU);
            if (s === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          }
          ctx.strokeStyle = 'rgba(' + rgb + (isDark ? ',0.18)' : ',0.17)');
          ctx.stroke();

          for (var i = 0; i < ring.satellites; i++) {
            // Satellites orbit faster than the ring itself spins.
            var sat = project((i / ring.satellites) * TAU + rotation * 2.4);
            ctx.fillStyle = 'rgba(' + rgb + ',' +
              ((isDark ? 0.16 : 0.17) + sat.depth * (isDark ? 0.4 : 0.42)).toFixed(3) + ')';
            ctx.beginPath();
            ctx.arc(sat.x, sat.y, 1.4 + sat.depth * 2.4, 0, TAU);
            ctx.fill();
          }
        }
      };
    },

    /** Testimonials: drifting starfield with an occasional shooting star. */
    bgStars: function (ctx) {
      var COUNT = 130;
      var SHOOT_INTERVAL = 420; // frames between shooting stars
      var SHOOT_LIFETIME = 34;  // frames each one lasts

      // Deterministic scatter using irrational multipliers, so stars never fall
      // into a visible grid.
      var stars = [];
      for (var i = 0; i < COUNT; i++) {
        stars.push({
          x: (i * 0.618034) % 1,
          y: ((i * 0.381966 + 0.17) * 1.61803) % 1,
          z: 0.25 + ((i * 7919) % 100) / 133,  // depth → size, speed, brightness
          phase: (i * 997) % 63 / 10,          // twinkle offset
          coral: i % 4 === 0
        });
      }
      var shootingStar = null;

      return function (tick, W, H) {
        ctx.clearRect(0, 0, W, H);
        var dark = Env.isDark();

        for (var i = 0; i < COUNT; i++) {
          var star = stars[i];
          star.x += 0.00005 * star.z;
          if (star.x > 1.02) star.x = -0.02;

          var alpha = (0.20 + 0.45 * star.z) *
            (0.55 + 0.45 * Math.sin(tick * 0.025 + star.phase)) *
            (dark ? 1 : 0.75); // the light theme needs a gentler starfield

          ctx.fillStyle = star.coral
            ? (dark ? 'rgba(255,105,80,' : 'rgba(200,48,28,') + alpha.toFixed(3) + ')'
            : (dark ? 'rgba(255,155,145,' : 'rgba(166,20,20,') + alpha.toFixed(3) + ')';
          ctx.beginPath();
          ctx.arc(star.x * W, star.y * H, 0.4 + star.z * 1.2, 0, TAU);
          ctx.fill();
        }

        if (!shootingStar && tick > 0 && tick % SHOOT_INTERVAL === 0) {
          var seed = tick / SHOOT_INTERVAL;
          shootingStar = {
            x: 0.15 + (seed * 0.23) % 0.5,
            y: 0.05 + (seed * 0.37) % 0.4,
            life: 0
          };
        }

        if (shootingStar) {
          shootingStar.life++;
          shootingStar.x += 0.008;
          shootingStar.y += 0.004;
          var fade = 1 - shootingStar.life / SHOOT_LIFETIME;

          if (fade <= 0) {
            shootingStar = null;
          } else {
            var headX = shootingStar.x * W;
            var headY = shootingStar.y * H;
            var trail = ctx.createLinearGradient(headX - 70, headY - 35, headX, headY);
            trail.addColorStop(0, dark ? 'rgba(255,140,110,0)' : 'rgba(200,48,28,0)');
            trail.addColorStop(1, dark
              ? 'rgba(255,220,210,' + (0.7 * fade).toFixed(3) + ')'
              : 'rgba(166,20,20,' + (0.55 * fade).toFixed(3) + ')');
            ctx.strokeStyle = trail;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(headX - 70, headY - 35);
            ctx.lineTo(headX, headY);
            ctx.stroke();
          }
        }
      };
    }
  };

  /* ══════════════════════════════════════════════════════════════════════
     4. FEATURE MODULES
     Each has a `name` (used in error reporting) and an `init`.
     ══════════════════════════════════════════════════════════════════════ */

  /** Light/dark toggle. Initial theme is applied inline in <head>. */
  var themeToggle = {
    name: 'themeToggle',
    init: function () {
      var button = document.getElementById('themeToggle');
      if (!button) return;

      var sync = function () {
        button.setAttribute('aria-pressed', Env.isDark() ? 'true' : 'false');
      };
      sync();

      button.addEventListener('click', function () {
        var next = Env.isDark() ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        sync();
        // Private-mode browsers can throw on write; the toggle still works.
        try { localStorage.setItem('theme', next); } catch (e) { /* non-fatal */ }
      });
    }
  };

  /** Reading-progress bar, back-to-top button and nav scrollspy. */
  var scrollEffects = {
    name: 'scrollEffects',
    init: function () {
      var progress = document.getElementById('progress');
      var toTop = document.getElementById('toTop');

      // Scrollspy pairs each `data-spy` nav link with the section it tracks.
      var spy = $$('#spy a[data-spy]').map(function (link) {
        return { link: link, section: document.getElementById(link.getAttribute('data-spy')) };
      }).filter(function (pair) { return !!pair.section; });

      /** Offset (px) below the sticky header where "current section" flips. */
      var SPY_OFFSET = 140;
      var TO_TOP_AFTER = 600;

      var update = function () {
        var root = document.documentElement;
        var max = root.scrollHeight - root.clientHeight;

        // scaleX is compositor-only; animating width would force layout each frame.
        if (progress) {
          progress.style.transform = 'scaleX(' + (max > 0 ? root.scrollTop / max : 0) + ')';
        }
        if (toTop) toTop.classList.toggle('show', root.scrollTop > TO_TOP_AFTER);

        if (spy.length) {
          var position = root.scrollTop + SPY_OFFSET;
          var current = null;
          spy.forEach(function (pair) {
            if (pair.section.offsetTop <= position) current = pair;
          });
          spy.forEach(function (pair) {
            pair.link.classList.toggle('active', pair === current);
          });
        }
      };

      window.addEventListener('scroll', rafThrottle(update), { passive: true });
      update(); // set initial state (e.g. when loaded at an anchor)

      if (toTop) {
        toTop.addEventListener('click', function () {
          // Honour the OS preference: the CSS reduced-motion block cannot reach
          // a scroll issued from script.
          window.scrollTo({ top: 0, behavior: Env.reducedMotion ? 'auto' : 'smooth' });
        });
      }
    }
  };

  /** Hamburger drawer shown below the desktop nav breakpoint. */
  var mobileNav = {
    name: 'mobileNav',
    init: function () {
      var toggle = document.getElementById('navToggle');
      var drawer = document.getElementById('mobileNav');
      if (!toggle || !drawer) return;

      var setOpen = function (open) {
        drawer.classList.toggle('open', open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        document.body.classList.toggle('nav-open', open);
      };

      toggle.addEventListener('click', function () {
        setOpen(!drawer.classList.contains('open'));
      });

      // Close after following any link, so in-page anchors are not hidden
      // behind the open drawer.
      drawer.addEventListener('click', function (e) {
        if (e.target.closest('a')) setOpen(false);
      });

      window.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') setOpen(false);
      });
    }
  };

  /** Engagement-model tabs — full ARIA pattern with roving tabindex. */
  var tabs = {
    name: 'tabs',
    init: function () {
      var buttons = $$('.tab-btn');
      if (!buttons.length) return;
      var panels = $$('.tab-panel');
      var indicator = document.getElementById('tabInd');

      var select = function (button, moveFocus) {
        var index = parseInt(button.getAttribute('data-tab'), 10);

        buttons.forEach(function (b) {
          var active = b === button;
          b.classList.toggle('active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
          // Roving tabindex: only the selected tab is in the tab order.
          b.tabIndex = active ? 0 : -1;
        });

        panels.forEach(function (panel) {
          var active = parseInt(panel.getAttribute('data-panel'), 10) === index;
          panel.classList.toggle('active', active);
          if (active) panel.removeAttribute('hidden');
          else panel.setAttribute('hidden', '');
        });

        if (indicator) indicator.style.transform = 'translateX(' + (index * 100) + '%)';
        if (moveFocus) button.focus();
      };

      buttons.forEach(function (button, index) {
        button.addEventListener('click', function () { select(button); });

        // Arrow/Home/End navigation, per the WAI-ARIA tabs pattern.
        button.addEventListener('keydown', function (e) {
          var last = buttons.length - 1;
          var target = null;
          if (e.key === 'ArrowRight') target = buttons[(index + 1) % buttons.length];
          else if (e.key === 'ArrowLeft') target = buttons[(index - 1 + buttons.length) % buttons.length];
          else if (e.key === 'Home') target = buttons[0];
          else if (e.key === 'End') target = buttons[last];
          if (target) {
            e.preventDefault();
            select(target, true);
          }
        });
      });
    }
  };

  /** FAQ accordion — single-open, with `aria-expanded` kept in sync. */
  var accordion = {
    name: 'accordion',
    init: function () {
      var questions = $$('.faq-q');
      if (!questions.length) return;

      questions.forEach(function (question) {
        question.addEventListener('click', function () {
          var item = question.parentElement;
          var wasOpen = item.classList.contains('open');

          // Collapse everything, then re-open unless this one was already open.
          $$('.faq-item').forEach(function (other) {
            other.classList.remove('open');
            var button = $('.faq-q', other);
            if (button) button.setAttribute('aria-expanded', 'false');
          });

          if (!wasOpen) {
            item.classList.add('open');
            question.setAttribute('aria-expanded', 'true');
          }
        });
      });
    }
  };

  /** Hero headline word that cycles through the practice areas. */
  var rotatingHeadline = {
    name: 'rotatingHeadline',
    init: function () {
      var element = document.getElementById('rotWord');
      if (!element || Env.reducedMotion) return;

      var WORDS = ['enterprise technology', 'AI at scale', 'cloud-native systems', 'secure products'];
      var ROTATE_EVERY = 3000;
      var FADE_OUT = 400;
      var FADE_IN = 420;

      var index = 0;
      var started = false;

      var start = function () {
        if (started) return;
        started = true;
        setInterval(function () {
          // The headline rotates on a timer, not a CSS animation, so the
          // motionToggle module's animation-play-state cannot reach it. Check
          // the same attribute here so one control governs both.
          if (document.documentElement.getAttribute('data-motion') === 'paused') return;
          element.classList.add('out');
          setTimeout(function () {
            index = (index + 1) % WORDS.length;
            element.textContent = WORDS[index];
            element.classList.remove('out');
            element.classList.add('in');
            setTimeout(function () { element.classList.remove('in'); }, FADE_IN);
          }, FADE_OUT);
        }, ROTATE_EVERY);
      };

      // Deferred until the first interaction so the initial paint (and any
      // screenshot or crawler) always shows the complete headline.
      ['scroll', 'pointermove', 'keydown', 'touchstart'].forEach(function (event) {
        window.addEventListener(event, start, { once: true, passive: true });
      });
    }
  };

  /** Stat counters that ease from zero on load. */
  var counters = {
    name: 'counters',
    init: function () {
      if (Env.reducedMotion) return;
      var DURATION = 1300;

      $$('.tick').forEach(function (element) {
        var target = parseInt(element.getAttribute('data-to'), 10);
        if (isNaN(target)) return;

        var startedAt = null;
        // Deliberately NOT blanking to "0" here. The first animation frame
        // writes 0 anyway (progress is ~0), and leaving the real figure in the
        // markup until then means a throttled or never-firing rAF — a
        // background tab on load, say — degrades to the true number rather
        // than to a row of zeros.
        var step = function (timestamp) {
          if (!startedAt) startedAt = timestamp;
          var progress = Math.min((timestamp - startedAt) / DURATION, 1);
          // Cubic ease-out: fast start, gentle settle.
          element.textContent = Math.round(target * (1 - Math.pow(1 - progress, 3)));
          if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    }
  };

  /**
   * Pointer-reactive flourishes: magnetic CTA, spotlight cards, 3D tilt.
   * Grouped because they share one trait — all are hover-only, so they are
   * pure decoration on touch devices.
   */
  var pointerEffects = {
    name: 'pointerEffects',
    init: function () {
      // Spotlight runs even under reduced-motion: it follows the pointer
      // directly rather than animating on its own.
      $$('.spot-card').forEach(function (card) {
        card.addEventListener('mousemove', function (e) {
          var rect = card.getBoundingClientRect();
          card.style.setProperty('--mx', (e.clientX - rect.left) + 'px');
          card.style.setProperty('--my', (e.clientY - rect.top) + 'px');
        });
      });

      if (Env.reducedMotion) return;

      var magnetic = document.getElementById('magBtn');
      if (magnetic) {
        magnetic.addEventListener('mousemove', function (e) {
          var rect = magnetic.getBoundingClientRect();
          var dx = e.clientX - rect.left - rect.width / 2;
          var dy = e.clientY - rect.top - rect.height / 2;
          magnetic.style.transform = 'translate(' + dx * 0.22 + 'px,' + dy * 0.3 + 'px)';
        });
        magnetic.addEventListener('mouseleave', function () {
          magnetic.style.transform = '';
        });
      }

      var TILT_DEGREES = 10;
      var TILT_RESET_MS = 500;

      $$('.tilt').forEach(function (card) {
        card.addEventListener('mousemove', function (e) {
          var rect = card.getBoundingClientRect();
          var px = (e.clientX - rect.left) / rect.width - 0.5;
          var py = (e.clientY - rect.top) / rect.height - 0.5;
          card.style.transform =
            'rotateY(' + px * TILT_DEGREES + 'deg) rotateX(' + -py * TILT_DEGREES + 'deg)';
        });

        card.addEventListener('mouseleave', function () {
          // Add the transition only for the return trip, so tracking the
          // pointer stays instant while hovering.
          card.style.transition = 'transform .5s ease';
          card.style.transform = '';
          setTimeout(function () { card.style.transition = ''; }, TILT_RESET_MS);
        });
      });
    }
  };

  /**
   * Contact form.
   *
   * Deliberately front-end only: the site is static and has no backend, so the
   * form composes a pre-filled email rather than pretending to submit. Swapping
   * in a real endpoint (Formspree, Netlify Forms, a serverless function) means
   * replacing this one handler.
   */
  var contactForm = {
    name: 'contactForm',
    init: function () {
      var form = document.getElementById('contactForm');
      if (!form) return;

      var RECIPIENT = 'info@neualto.com';

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var data = new FormData(form);
        var value = function (key, fallback) {
          var raw = data.get(key);
          return (raw && String(raw).trim()) || fallback || '';
        };

        // Subject leads with the company and what they want to see, so the
        // inbox is triageable without opening anything.
        var who = value('company') || value('name', 'New enquiry');
        var interest = value('interest');
        // Middots, not dashes: the interest option text contains its own em
        // dash ("DeltaMax™ — data quality monitoring"), and three dashes in one
        // subject line reads as a run-on in an inbox list.
        var subject = 'Demo request · ' + who + (interest ? ' · ' + interest : '');

        var notes = value('message');
        var lines = [
          'Demo request from the NeuAlto website.',
          '',
          'Name:          ' + value('name'),
          'Company:       ' + value('company'),
          'Email:         ' + value('email'),
          'Phone:         ' + value('phone', '-'),
          'Interested in: ' + (interest || '-')
        ];
        // Only append the notes block when there is something in it, so an
        // empty optional field does not leave a dangling "Notes:" heading.
        if (notes) lines.push('', 'Notes:', notes);
        var body = lines.join('\n');

        window.location.href = 'mailto:' + RECIPIENT +
          '?subject=' + encodeURIComponent(subject) +
          '&body=' + encodeURIComponent(body);
      });
    }
  };

  /**
   * Blog feed — renders cards from `window.NEUALTO_POSTS` (posts-data.js) and
   * mounts the official LinkedIn embed for each.
   *
   * Post data is a plain script rather than a JSON file so the page keeps
   * working from `file://`, where `fetch` of a local path is blocked.
   *
   * Everything an editor could get wrong is absorbed here rather than pushed
   * onto them: they paste a LinkedIn URL in whatever shape LinkedIn gave it,
   * in any order, and the ordering, the filter buttons, and the embed URLs are
   * all derived. See posts-data.js for the authoring contract.
   */
  var blogFeed = {
    name: 'blogFeed',
    init: function () {
      var grid = document.getElementById('postGrid');
      if (!grid || !window.NEUALTO_POSTS) return;

      var emptyMessage = document.getElementById('postEmpty');
      var filterRow = document.getElementById('filterRow');
      var EMBED_BASE = 'https://www.linkedin.com/embed/feed/update/urn:li:activity:';
      var PERMALINK_BASE = 'https://www.linkedin.com/feed/update/urn:li:activity:';

      /**
       * Pulls the numeric activity id out of whatever LinkedIn handed over:
       * a /posts/ share link ("…-activity-7486023292294754304-uhN5"), a
       * /feed/update/ permalink ("urn:li:activity:7486023292294754304"), or an
       * id someone pasted on its own. Returns null when there is no id to find,
       * which is the signal to drop the post rather than render a dead embed.
       */
      var extractUrn = function (value) {
        var raw = String(value == null ? '' : value).trim();
        if (!raw) return null;
        if (/^\d{6,}$/.test(raw)) return raw;
        var match = raw.match(/activity[:\-](\d{6,})/i);
        return match ? match[1] : null;
      };

      /** Renders an ISO date as e.g. "Jul 23, 2026"; passes anything else through. */
      var formatDate = function (iso) {
        if (!iso) return '';
        var date = new Date(iso + 'T00:00:00');
        return isNaN(date) ? iso
          : date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      };

      var sortTime = function (iso) {
        var time = Date.parse(iso + 'T00:00:00');
        return isNaN(time) ? 0 : time; // undated posts sink to the bottom
      };

      // `link` is the documented field; `urn` is still accepted so older
      // entries keep working.
      var posts = window.NEUALTO_POSTS
        .map(function (post) {
          var urn = extractUrn(post.link || post.urn);
          if (!urn) {
            if (window.console && console.warn) {
              console.warn('[NeuAlto] blog post skipped — no LinkedIn id found in "' +
                (post.link || post.urn) + '" (post: "' + (post.title || 'untitled') + '")');
            }
            return null;
          }
          return {
            urn: urn,
            title: post.title || '',
            summary: post.summary || '',
            date: post.date || '',
            tags: post.tags || []
          };
        })
        .filter(Boolean)
        .sort(function (a, b) { return sortTime(b.date) - sortTime(a.date); });

      if (!posts.length) {
        if (emptyMessage) emptyMessage.hidden = false;
        return;
      }

      var renderCard = function (post) {
        var pills = post.tags.map(function (tag) {
          return '<span class="pill">' + escapeHtml(tag) + '</span>';
        }).join('');

        return '<article class="post-card" data-tags="' + escapeHtml(post.tags.join('|')) + '">' +
            '<div class="post-body">' +
              '<div class="post-meta">' +
                '<time datetime="' + escapeHtml(post.date) + '">' +
                  escapeHtml(formatDate(post.date)) +
                '</time>' +
                '<span class="post-src">LinkedIn</span>' +
              '</div>' +
              '<h2>' + escapeHtml(post.title) + '</h2>' +
              '<p>' + escapeHtml(post.summary) + '</p>' +
              '<div class="pill-row">' + pills + '</div>' +
            '</div>' +
            '<div class="post-embed" data-urn="' + escapeHtml(post.urn) + '">' +
              '<div class="embed-skeleton"><span></span><span></span><span></span></div>' +
            '</div>' +
            '<a class="svc-link post-link" href="' +
                escapeHtml(PERMALINK_BASE + post.urn) +
                '" target="_blank" rel="noopener">' +
              'Discuss on LinkedIn <svg width="15" height="15"><use href="#i-arrow"/></svg>' +
            '</a>' +
          '</article>';
      };

      grid.innerHTML = posts.map(renderCard).join('');

      // Native lazy-loading defers the offscreen iframes: more reliable than an
      // IntersectionObserver, and the browser picks the moment to fetch.
      $$('.post-embed', grid).forEach(function (holder) {
        var iframe = document.createElement('iframe');
        iframe.src = EMBED_BASE + holder.dataset.urn;
        iframe.title = 'LinkedIn post by NeuAlto';
        iframe.loading = 'lazy';
        iframe.setAttribute('frameborder', '0');
        iframe.setAttribute('allowfullscreen', '');
        iframe.addEventListener('load', function () {
          var skeleton = $('.embed-skeleton', holder);
          if (skeleton) skeleton.remove();
          holder.dataset.loaded = '1';
        });
        holder.appendChild(iframe);
      });

      // Filter buttons are built from the tags actually in use, so adding a
      // post with a new tag needs no second edit — and a tag can never point at
      // a button that does not exist (or vice versa).
      if (filterRow) {
        var seen = {};
        var tags = [];
        posts.forEach(function (post) {
          post.tags.forEach(function (tag) {
            if (!seen[tag]) { seen[tag] = true; tags.push(tag); }
          });
        });
        tags.sort();

        // aria-pressed, not just a class: without it a screen-reader user has no
        // way to tell which filter is currently applied.
        filterRow.innerHTML =
          '<button class="filter-chip active" data-filter="all" aria-pressed="true">All Posts</button>' +
          tags.map(function (tag) {
            return '<button class="filter-chip" data-filter="' + escapeHtml(tag) + '" aria-pressed="false">' +
              escapeHtml(tag) + '</button>';
          }).join('');
      }

      // Filtering changes the result set silently. A polite live region is the
      // only way that reaches a screen reader.
      var liveStatus = document.createElement('p');
      liveStatus.className = 'sr-only';
      liveStatus.setAttribute('role', 'status');
      liveStatus.setAttribute('aria-live', 'polite');
      grid.parentNode.insertBefore(liveStatus, grid);

      // Topic filtering. Tags are matched against a pipe-delimited list so that
      // a tag is never a substring match of another ("AI" vs "AI & ML").
      var chips = $$('.filter-chip');
      chips.forEach(function (chip) {
        chip.addEventListener('click', function () {
          var filter = chip.getAttribute('data-filter');
          chips.forEach(function (c) {
            var on = c === chip;
            c.classList.toggle('active', on);
            c.setAttribute('aria-pressed', on ? 'true' : 'false');
          });

          var shown = 0;
          $$('.post-card', grid).forEach(function (card) {
            var haystack = '|' + card.getAttribute('data-tags') + '|';
            var visible = filter === 'all' || haystack.indexOf('|' + filter + '|') > -1;
            card.hidden = !visible;
            if (visible) shown++;
          });

          if (emptyMessage) emptyMessage.hidden = shown > 0;
          liveStatus.textContent = shown
            ? shown + (shown === 1 ? ' post' : ' posts') + ' shown for ' +
              (filter === 'all' ? 'all topics' : filter)
            : 'No posts in ' + filter;
        });
      });
    }
  };

  /**
   * D-U-N-S Registered Seal fallback.
   *
   * D&B's seal script only renders on the domain registered with them. Off that
   * domain it still injects its <iframe>, but the frame paints nothing — so
   * treating "an iframe exists" as "the seal rendered" hid our certificate and
   * left an empty white plate in the footer on localhost and any staging host.
   *
   * The frame's contents are cross-origin, so whether it actually drew anything
   * cannot be inspected. The hostname can be, and it is what D&B keys off, so
   * that is the signal used here: trust the injected seal on the registered
   * domain, and everywhere else drop the blank frame and keep the certificate.
   */
  var dunsSeal = {
    name: 'dunsSeal',
    init: function () {
      var container = document.getElementById('dunsSeal');
      if (!container) return;

      var fallback = $('.duns-fallback', container);
      if (!fallback) return;

      /** The domain registered with D&B — the only place the seal renders. */
      var onRegisteredHost = /(^|\.)neualto\.com$/i.test(location.hostname);

      var settle = function () {
        // Anything the D&B script injected that is not our own fallback image.
        var injected = $$('img, a, iframe, object, embed', container).filter(function (node) {
          return node !== fallback;
        });

        // D&B writes an http:// iframe. On an https page every modern browser
        // blocks that as mixed content and the seal silently never paints, so
        // upgrade the scheme rather than inherit a blank box in production.
        injected.forEach(function (node) {
          var src = node.getAttribute && node.getAttribute('src');
          if (src && src.slice(0, 7) === 'http://') {
            node.setAttribute('src', 'https://' + src.slice(7));
          }
        });

        if (injected.length && onRegisteredHost) {
          fallback.hidden = true;
        } else {
          injected.forEach(function (node) {
            if (node.parentNode) node.parentNode.removeChild(node);
          });
          fallback.hidden = false;
        }
      };

      // The seal is written out synchronously, but give late-arriving markup a
      // moment before deciding the script did nothing.
      settle();
      window.addEventListener('load', settle);
      setTimeout(settle, 2000);
    }
  };

  /**
   * Motion pause control — WCAG 2.2.2 (Level A).
   *
   * The marquees run on 36s/42s infinite loops and the hero headline rotates
   * every 3s. Both previously paused only on :hover, which is mouse-only, so a
   * keyboard or touch user had no way to stop content that moves automatically
   * for more than five seconds. prefers-reduced-motion does not satisfy this
   * criterion either — it needs a mechanism, not just a preference.
   *
   * Injects one button into the marquee section rather than shipping it in nine
   * copies of hand-pasted markup.
   */
  var motionToggle = {
    name: 'motionToggle',
    init: function () {
      var host = $('.clients .sec-head') || $('.clients .wrap');
      if (!host) return;
      if (Env.reducedMotion) return; // nothing is moving; a pause button would be noise

      var KEY = 'motion';
      var paused = false;
      try { paused = localStorage.getItem(KEY) === 'paused'; } catch (e) { /* private mode */ }

      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'motion-toggle';

      var apply = function () {
        document.documentElement.setAttribute('data-motion', paused ? 'paused' : 'running');
        button.setAttribute('aria-pressed', paused ? 'true' : 'false');
        button.textContent = paused ? '▶ Resume motion' : '⏸ Pause motion';
      };
      apply();

      button.addEventListener('click', function () {
        paused = !paused;
        apply();
        try { localStorage.setItem(KEY, paused ? 'paused' : 'running'); } catch (e) { /* non-fatal */ }
      });

      host.appendChild(button);
    }
  };

  /** Mounts every decorative background canvas present on the page. */
  var backgrounds = {
    name: 'backgrounds',
    init: function () {
      Object.keys(SCENES).forEach(function (id) {
        mountCanvas(id, SCENES[id]);
      });
    }
  };

  /* ══════════════════════════════════════════════════════════════════════
     5. BOOTSTRAP
     ══════════════════════════════════════════════════════════════════════ */

  var MODULES = [
    themeToggle,
    scrollEffects,
    mobileNav,
    tabs,
    accordion,
    rotatingHeadline,
    counters,
    pointerEffects,
    contactForm,
    blogFeed,
    dunsSeal,
    motionToggle,
    backgrounds
  ];

  /**
   * Initialises every module in isolation.
   *
   * The previous single-block script meant one exception anywhere silently
   * killed every feature declared after it. Catching per module means a broken
   * feature degrades to "that one thing is missing" instead of "the page is dead".
   */
  MODULES.forEach(function (module) {
    try {
      module.init();
    } catch (error) {
      if (window.console && console.error) {
        console.error('[NeuAlto] module "' + module.name + '" failed to initialise:', error);
      }
    }
  });
})();
