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

    /**
     * Hero: a drifting starfield that periodically gathers into the NeuAlto
     * mark, holds, and disperses again.
     *
     * DARK ONLY. A starfield on a white ground reads as dust, so in the light
     * theme this paints nothing and the aurora carries the hero on its own.
     * The theme is checked every frame because the toggle can flip at any time.
     *
     * The mark is not a path anyone typed out: the logo is drawn to an
     * offscreen canvas once, and every pixel whose alpha clears a threshold
     * becomes a candidate target. Re-sampled on resize, since the point cloud
     * is in device pixels.
     *
     * Movement is a single eased blend between each star's drifting position
     * and its target, not a per-star spring. A spring is the wrong tool behind
     * body copy: it overshoots, and an underdamped one oscillates forever. A
     * blend cannot go unstable, and it makes the whole gather one number.
     */
    bgMark: function (ctx) {
      var COUNT = 190;
      var FORM_SHARE = 0.58;   // fraction that joins the mark; the rest drift on
      var SAMPLE_STEP = 5;     // px between candidate targets in the logo bitmap

      /* One cycle, in frames at ~60fps: settle, gather, hold, let go, rest.
         The long rest is deliberate - this sits behind the headline, and an
         effect that re-triggers every few seconds stops being atmosphere and
         starts being a distraction. */
      var T_SETTLE = 150, T_FORM = 130, T_HOLD = 280, T_RELEASE = 130, T_REST = 430;
      var CYCLE = T_FORM + T_HOLD + T_RELEASE + T_REST;

      // Deterministic scatter using irrational multipliers, so the stars never
      // fall into a visible grid. Same trick as the testimonials starfield.
      var stars = [];
      for (var i = 0; i < COUNT; i++) {
        stars.push({
          x: (i * 0.618034) % 1,
          y: ((i * 0.381966 + 0.17) * 1.61803) % 1,
          z: 0.25 + ((i * 7919) % 100) / 133,   // depth: size, drift speed, brightness
          phase: (i * 997) % 63 / 10,           // twinkle offset
          coral: i % 5 === 0,
          joins: (i % 100) / 100 < FORM_SHARE,
          lead: ((i * 5701) % 100) / 250,       // 0-0.4 stagger into the gather
          tx: 0, ty: 0
        });
      }

      var img = new Image();
      var imgReady = false;
      img.onload = function () { imgReady = true; };
      img.src = 'pics/logo.png';   // already in cache: the header renders it

      var targets = [];
      var sampledW = 0, sampledH = 0;

      /** Draws the mark offscreen and keeps the coordinates of its opaque pixels. */
      function sampleTargets(W, H) {
        targets = [];
        if (!imgReady || W < 2 || H < 2) return;

        var off = document.createElement('canvas');
        off.width = W;
        off.height = H;
        var octx = off.getContext('2d');

        var scale = Math.min(W * 0.21, H * 0.50) / img.height;
        var w = img.width * scale, h = img.height * scale;
        octx.drawImage(img, (W - w) / 2, (H - h) / 2 - H * 0.13, w, h);

        var data = octx.getImageData(0, 0, W, H).data;
        for (var y = 0; y < H; y += SAMPLE_STEP) {
          for (var x = 0; x < W; x += SAMPLE_STEP) {
            if (data[(y * W + x) * 4 + 3] > 120) targets.push(x, y);
          }
        }

        // Spread the assignment across the whole cloud rather than taking the
        // first N, which would only ever light up the top of the mark.
        var pairs = targets.length / 2;
        if (!pairs) return;
        var joiners = 0;
        for (var s = 0; s < COUNT; s++) if (stars[s].joins) joiners++;
        var stride = Math.max(1, Math.floor(pairs / Math.max(joiners, 1)));
        var n = 0;
        for (var k = 0; k < COUNT; k++) {
          if (!stars[k].joins) continue;
          var idx = ((n++ * stride) % pairs) * 2;
          stars[k].tx = targets[idx];
          stars[k].ty = targets[idx + 1];
        }
        sampledW = W;
        sampledH = H;
      }

      function easeInOut(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      }

      /** 0 while drifting, 1 while fully gathered, eased in between. */
      function gatherAmount(tick) {
        if (Env.reducedMotion) return 1;   // the still frame should show the mark
        if (tick < T_SETTLE) return 0;
        var t = (tick - T_SETTLE) % CYCLE;
        if (t < T_FORM) return easeInOut(t / T_FORM);
        if (t < T_FORM + T_HOLD) return 1;
        if (t < T_FORM + T_HOLD + T_RELEASE) {
          return 1 - easeInOut((t - T_FORM - T_HOLD) / T_RELEASE);
        }
        return 0;
      }

      return function (tick, W, H) {
        ctx.clearRect(0, 0, W, H);

        // Light theme: the aurora already carries the hero, and stars on a
        // white ground look like dirt on the screen.
        if (!Env.isDark()) return;

        if (imgReady && (W !== sampledW || H !== sampledH)) sampleTargets(W, H);

        var gather = targets.length ? gatherAmount(tick) : 0;

        for (var i = 0; i < COUNT; i++) {
          var star = stars[i];

          star.x += 0.00004 * star.z;
          if (star.x > 1.02) star.x = -0.02;

          var px = star.x * W;
          var py = star.y * H;

          // Stagger: a star with a later `lead` starts moving later, so the
          // mark assembles instead of snapping into place in one frame.
          var mine = 0;
          if (star.joins && gather > 0) {
            mine = (gather - star.lead) / (1 - star.lead);
            mine = mine < 0 ? 0 : (mine > 1 ? 1 : mine);
          }

          if (mine > 0) {
            px += (star.tx - px) * mine;
            py += (star.ty - py) * mine;
          }

          var twinkle = 0.55 + 0.45 * Math.sin(tick * 0.025 + star.phase);
          // Gathered stars steady and brighten; that contrast is what makes the
          // mark legible without turning up the overall opacity.
          var alpha = (0.18 + 0.38 * star.z) * (twinkle * (1 - mine) + mine * 0.62);
          var radius = 0.4 + star.z * 1.2 + mine * 0.35;

          ctx.fillStyle = (star.coral ? 'rgba(255,105,80,' : 'rgba(255,155,145,') +
            (alpha < 0 ? 0 : alpha).toFixed(3) + ')';
          ctx.beginPath();
          ctx.arc(px, py, radius, 0, TAU);
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
   * Mounts the official LinkedIn embed into every .post-embed[data-urn] on the
   * page.
   *
   * Deliberately its own module, and deliberately document-wide. This used to
   * live inside blogFeed, scoped to #postGrid - which meant it never ran on a
   * generated article page, because those have no #postGrid and do not load
   * posts-data.js. A {{linkedin}} embed inside an article body therefore
   * rendered its skeleton and never loaded anything at all.
   *
   * It needs no post data: the activity id is already on the element.
   */
  var postEmbeds = {
    name: 'postEmbeds',
    init: function () {
      var EMBED_BASE = 'https://www.linkedin.com/embed/feed/update/urn:li:activity:';

      $$('.post-embed[data-urn]').forEach(function (holder) {
        if (holder.querySelector('iframe')) return;   // never mount twice

        var iframe = document.createElement('iframe');
        iframe.src = EMBED_BASE + holder.dataset.urn;
        iframe.title = 'LinkedIn post by NeuAlto';
        // Native lazy-loading defers the offscreen iframes: more reliable than
        // an IntersectionObserver, and the browser picks the moment to fetch.
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
    }
  };

  /**
   * Topic filtering for the blog index.
   *
   * The cards and the filter chips are static HTML, written into blog.html by
   * scripts/build-content.js from content/blog/*.md. This module only wires
   * the chips up; it does not build anything.
   *
   * It used to also render the cards client-side from posts-data.js, which is
   * why that file existed. That path became unreachable once the generator
   * started writing the cards - and it was never the path that mattered,
   * because a crawler that does not run JavaScript saw nothing at all. The
   * ~95 lines that served it, and posts-data.js itself, are gone.
   *
   * Filtering reads data-tags off the cards, so it needs no post data.
   */
  var blogFeed = {
    name: 'blogFeed',
    init: function () {
      var grid = document.getElementById('postGrid');
      if (!grid) return;

      var chips = $$('.filter-chip');
      if (!chips.length) return;   // fewer than two articles: nothing to filter

      var emptyMessage = document.getElementById('postEmpty');

      // Filtering changes the result set silently. A polite live region is the
      // only way that reaches a screen reader.
      var liveStatus = document.createElement('p');
      liveStatus.className = 'sr-only';
      liveStatus.setAttribute('role', 'status');
      liveStatus.setAttribute('aria-live', 'polite');
      grid.parentNode.insertBefore(liveStatus, grid);

      // Tags are matched against a pipe-delimited list so that one tag is never
      // a substring match of another ("AI" vs "AI & ML").
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
    postEmbeds,
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
