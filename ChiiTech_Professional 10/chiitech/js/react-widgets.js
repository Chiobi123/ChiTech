/* A couple of small, self-contained React islands mounted into specific
   containers already in index.html (see #health-gauge-root). This is
   deliberately NOT a framework migration — the rest of the app is
   untouched vanilla JS, and these components only ever read data that's
   handed to them; they never reach into `state` themselves. Loaded via
   CDN with no build step, so plain React.createElement is used instead
   of JSX (no Babel in the page to compile it). */

const h = React.createElement;

/** An animated arc gauge for the 0–100 health score. Sweeps from its
 *  previous value to the new one over half a second whenever the score
 *  it's given changes — small, cheap, one element animating, same
 *  "motion budget" rule as the rest of the app's CSS animations.
 *  Respects prefers-reduced-motion by jumping straight to the target. */
function HealthGauge({ score }) {
  const [displayed, setDisplayed] = React.useState(score);
  const fromRef = React.useRef(score);

  React.useEffect(() => {
    const from = fromRef.current;
    const to = score;
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || from === to) { setDisplayed(to); fromRef.current = to; return; }
    const duration = 550;
    const start = performance.now();
    let raf;
    function tick(now) {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplayed(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = to;
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [score]);

  const pct = Math.max(0, Math.min(100, displayed));
  const color = pct >= 70 ? '#39FF88' : pct >= 40 ? '#FFD166' : '#FF5C5C';
  const radius = 54, circumference = 2 * Math.PI * radius;
  const arcFraction = 0.75; // a 270° gauge, not a full circle
  const arcLength = circumference * arcFraction;
  const offset = arcLength * (1 - pct / 100);

  return h('div', { style: { display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' } },
    h('svg', { width: 140, height: 140, viewBox: '0 0 140 140', style: { transform: 'rotate(135deg)' } },
      h('circle', {
        cx: 70, cy: 70, r: radius, fill: 'none', stroke: 'rgba(255,255,255,0.08)',
        strokeWidth: 12, strokeDasharray: `${arcLength} ${circumference}`, strokeLinecap: 'round'
      }),
      h('circle', {
        cx: 70, cy: 70, r: radius, fill: 'none', stroke: color,
        strokeWidth: 12, strokeDasharray: `${arcLength} ${circumference}`,
        strokeDashoffset: offset, strokeLinecap: 'round',
        style: { transition: 'stroke 0.3s ease' }
      })
    ),
    h('div', null,
      h('div', { style: { fontSize: 34, fontWeight: 800, color, lineHeight: 1 } }, Math.round(pct) + '%'),
      h('div', { className: 'text-muted', style: { fontSize: 12, marginTop: 6, maxWidth: 220 } },
        pct >= 70 ? 'Healthy — trial balance, SoD and Benford checks are all in good shape.'
          : pct >= 40 ? 'Worth a look — one or more checks need attention.'
          : 'Needs attention — check the Audit page for specifics.'
      )
    )
  );
}

let healthGaugeRoot = null;
/** Call this any time the score changes (renderDashboard already does).
 *  Safe to call repeatedly — re-renders the same mounted root rather
 *  than remounting, which is what makes the sweep animation work. */
function mountHealthGauge(score) {
  const el = document.getElementById('health-gauge-root');
  if (!el) return;
  if (!healthGaugeRoot) healthGaugeRoot = ReactDOM.createRoot(el);
  healthGaugeRoot.render(h(HealthGauge, { score }));
}
