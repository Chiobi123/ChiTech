/* The Dashboard's animated 0–100 health-score gauge, drawn as inline SVG.

   This replaced a small React island that used to live in
   js/react-widgets.js. The widget was the only thing in the whole app that
   needed React, and React + ReactDOM were two extra cross-origin CDN
   downloads (~140 KB) that every visitor paid for before they could even
   reach the sign-in screen. The gauge itself is a couple of SVG circles
   and one number, so it's built directly here and the React dependency is
   gone entirely.

   The public API is unchanged: mountHealthGauge(score) renders into
   #health-gauge-root and is safe to call as often as the score changes —
   it reuses the same SVG and animates from the previous value, which is
   what makes the sweep read as one continuous gauge rather than a flicker. */

(function(){
  'use strict';

  var RADIUS = 54;
  var CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  var ARC_FRACTION = 0.75;               // a 270° gauge, not a full circle
  var ARC_LENGTH = CIRCUMFERENCE * ARC_FRACTION;
  var SWEEP_MS = 550;

  // One set of nodes per mounted root, created lazily on first render.
  var nodes = null;
  var displayed = 0;                     // what's on screen right now
  var raf = null;

  function colorFor(pct){
    return pct >= 70 ? '#39FF88' : pct >= 40 ? '#FFD166' : '#FF5C5C';
  }

  function messageFor(pct){
    if(pct >= 70) return 'Healthy — trial balance, SoD and Benford checks are all in good shape.';
    if(pct >= 40) return 'Worth a look — one or more checks need attention.';
    return 'Needs attention — check the Audit page for specifics.';
  }

  function prefersReducedMotion(){
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function build(el){
    el.textContent = '';

    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:20px;flex-wrap:wrap;';

    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '140');
    svg.setAttribute('height', '140');
    svg.setAttribute('viewBox', '0 0 140 140');
    svg.style.transform = 'rotate(135deg)';

    var track = document.createElementNS(svgNS, 'circle');
    track.setAttribute('cx', '70'); track.setAttribute('cy', '70'); track.setAttribute('r', String(RADIUS));
    track.setAttribute('fill', 'none');
    track.setAttribute('stroke', 'rgba(255,255,255,0.08)');
    track.setAttribute('stroke-width', '12');
    track.setAttribute('stroke-dasharray', ARC_LENGTH + ' ' + CIRCUMFERENCE);
    track.setAttribute('stroke-linecap', 'round');

    var arc = document.createElementNS(svgNS, 'circle');
    arc.setAttribute('cx', '70'); arc.setAttribute('cy', '70'); arc.setAttribute('r', String(RADIUS));
    arc.setAttribute('fill', 'none');
    arc.setAttribute('stroke', colorFor(0));
    arc.setAttribute('stroke-width', '12');
    arc.setAttribute('stroke-dasharray', ARC_LENGTH + ' ' + CIRCUMFERENCE);
    arc.setAttribute('stroke-dashoffset', String(ARC_LENGTH));
    arc.setAttribute('stroke-linecap', 'round');
    arc.style.transition = 'stroke 0.3s ease';

    svg.appendChild(track);
    svg.appendChild(arc);

    var side = document.createElement('div');
    var value = document.createElement('div');
    value.style.cssText = 'font-size:34px;font-weight:800;line-height:1;';
    var caption = document.createElement('div');
    caption.className = 'text-muted';
    caption.style.cssText = 'font-size:12px;margin-top:6px;max-width:220px;';
    side.appendChild(value);
    side.appendChild(caption);

    wrap.appendChild(svg);
    wrap.appendChild(side);
    el.appendChild(wrap);

    nodes = { arc: arc, value: value, caption: caption, shown: null };
  }

  function paint(pct){
    var pctClamped = Math.max(0, Math.min(100, pct));
    var color = colorFor(pctClamped);
    nodes.arc.setAttribute('stroke-dashoffset', String(ARC_LENGTH * (1 - pctClamped / 100)));
    nodes.arc.setAttribute('stroke', color);
    nodes.value.textContent = Math.round(pctClamped) + '%';
    nodes.value.style.color = color;
    // Only rewrite the caption when the band actually changes, so a sweep
    // doesn't re-lay-out the sentence on every animation frame.
    var band = pctClamped >= 70 ? 2 : pctClamped >= 40 ? 1 : 0;
    if(nodes.shown !== band){
      nodes.shown = band;
      nodes.caption.textContent = messageFor(pctClamped);
    }
  }

  /** Call this any time the score changes (renderDashboard already does).
   *  Safe to call repeatedly.
   *  @param {number} score 0–100 health score. */
  function mountHealthGauge(score){
    var el = document.getElementById('health-gauge-root');
    if(!el) return;
    var fresh = !nodes || !el.firstChild;
    if(fresh){
      build(el);
      // First paint has no "previous value" to sweep from, so land on the
      // score directly — only later changes animate.
      var first = Number(score) || 0;
      displayed = first;
      paint(first);
      return;
    }

    var to = Number(score) || 0;
    var from = displayed;

    if(raf){ cancelAnimationFrame(raf); raf = null; }

    if(prefersReducedMotion() || from === to){
      displayed = to;
      paint(to);
      return;
    }

    var start = (window.performance && performance.now) ? performance.now() : Date.now();
    (function tick(now){
      var p = Math.min(1, (now - start) / SWEEP_MS);
      var eased = 1 - Math.pow(1 - p, 3);
      displayed = from + (to - from) * eased;
      paint(displayed);
      if(p < 1) raf = requestAnimationFrame(tick);
      else { raf = null; displayed = to; paint(to); }
    })(start);
  }

  window.mountHealthGauge = mountHealthGauge;
})();
