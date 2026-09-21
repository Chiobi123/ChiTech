/* ============================================================
   CHIITECH CHART ENGINE
   ------------------------------------------------------------
   WHY THIS FILE EXISTS:
   The first version of this app loaded Chart.js from a CDN
   (cdnjs.cloudflare.com). On some networks — including the one
   this app was built on — that request gets blocked (firewall,
   ad-blocker, offline use), and `Chart` is silently `undefined`.
   Every chart on the site then fails to draw, with no error the
   user can see. That's not acceptable for a business tool that
   needs to work the same way on every device, every time.

   The fix: this file draws every chart itself using the native
   <canvas> 2D API. No external library, no network request, no
   CDN to go down. It will always render, online or offline.

   WHAT'S IN HERE:
   1. Shared helpers (colour palette, responsive sizing, number
      formatting for axis labels)
   2. chiBar()      — grouped or stacked bar chart
   3. chiLine()     — multi-series line chart with area fill
   4. chiDoughnut()  — donut chart with a % legend
   5. chiBarLineCombo() — bars + an overlaid line (used by the
      Benford's Law check, which compares an observed bar value
      against an expected line value on the same axis)
   6. renderIsoBars() — the pure-CSS "3D style" bar look used as
      an alternative visual on the Growth engine page

   HOW RESPONSIVENESS WORKS:
   Every chart function attaches a ResizeObserver to the canvas's
   parent element (once per canvas) and stores its own "redraw
   with the latest data" function on the canvas itself. That means:
     - Resizing the browser window redraws the chart at the new size.
     - Switching browser zoom redraws the chart at the new size.
     - Navigating to a section that was previously hidden
       (display:none) and is now visible also triggers a redraw,
       because going from 0×0 to a real size IS a resize event.
   This is what makes charts on inactive tabs "just work" the
   moment you open that tab, instead of staying blank forever.
   ============================================================ */

const CHIITECH_CHART_COLORS = {
  neon: '#39FF88',
  neonDeep: '#12A64C',
  neonSoft: 'rgba(57,255,136,0.18)',
  grid: '#22302A',
  text: '#9AA69F',
  textStrong: '#F3F6F4',
  danger: '#FF5C5C',
  warn: '#FFD166',
  blue: '#6FB7FF',
  purple: '#B892FF',
};

/** Rotating palette used when a chart has more than one series/segment. */
const CHI_PALETTE = [
  CHIITECH_CHART_COLORS.neon,
  CHIITECH_CHART_COLORS.warn,
  CHIITECH_CHART_COLORS.blue,
  CHIITECH_CHART_COLORS.purple,
  CHIITECH_CHART_COLORS.danger,
];

/** Formats large numbers for axis labels: 1200 -> "1.2k", 1500000 -> "1.5m". */
function chiShortNumber(n){
  const abs = Math.abs(n);
  if(abs>=1000000) return (n/1000000).toFixed(1).replace(/\.0$/,'') + 'm';
  if(abs>=1000) return (n/1000).toFixed(1).replace(/\.0$/,'') + 'k';
  return String(Math.round(n));
}

/**
 * Every chart canvas lives inside a fixed-height ".chart-canvas-wrap" in
 * the HTML (so the layout doesn't jump while data loads). The problem:
 * when a chart has a legend (2+ series), that legend used to be appended
 * as extra content inside that same fixed-height box — so it just spilled
 * out underneath, overlapping whatever text came after the chart card.
 * This function fixes that once per canvas by inserting an inner,
 * fixed-height "box" that holds ONLY the canvas, and turning the outer
 * wrap into an auto-height flex column — so the legend can sit below the
 * box as a normal sibling and the card grows to fit it instead of
 * overlapping the next thing on the page.
 */
function chiEnsureBox(canvas){
  if(canvas.__chiBox) return canvas.__chiBox;
  const wrap = canvas.parentElement;
  const wrapHeight = wrap.style.height || getComputedStyle(wrap).height;
  const box = document.createElement('div');
  box.className = 'chi-canvas-box';
  box.style.height = wrapHeight;
  wrap.insertBefore(box, canvas);
  box.appendChild(canvas);
  wrap.style.height = 'auto';
  wrap.classList.add('chart-canvas-wrap--auto');
  canvas.__chiBox = box;
  return box;
}

/**
 * Sets a canvas's backing-store size to match its CSS box at the
 * device's actual pixel ratio, so lines and text stay crisp on
 * retina/high-DPI screens instead of looking blurry.
 * Returns the CSS (logical) width/height to draw with.
 */
function chiFitCanvas(canvas){
  const box = chiEnsureBox(canvas);
  const dpr = window.devicePixelRatio || 1;
  const rect = box.getBoundingClientRect();
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  canvas.width = w*dpr;
  canvas.height = h*dpr;
  canvas.style.width = w+'px';
  canvas.style.height = h+'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1,0,0,1,0,0);
  ctx.scale(dpr, dpr);
  return {ctx, w, h};
}

/**
 * Wires up a canvas so that calling `redraw()` any time in the
 * future (e.g. when new data comes in, or the container resizes)
 * repaints it correctly. Each canvas only gets ONE observer, no
 * matter how many times its chart function is called.
 */
function chiObserve(canvas, redraw){
  canvas.__chiRedraw = redraw;
  if(!canvas.__chiObserved){
    canvas.__chiObserved = true;
    const box = chiEnsureBox(canvas);
    const ro = new ResizeObserver(()=>{ if(canvas.__chiRedraw) canvas.__chiRedraw(); });
    ro.observe(box);
  }
  redraw();
}

/* ---------------- BAR CHART (grouped or stacked) ---------------- */
/**
 * chiBar('canvas-id', {
 *   labels: ['Mon','Tue',...],
 *   series: [{label:'Sales', data:[1,2,3], color:'#39FF88'}, ...],
 *   stacked: false,     // true = bars stack on top of each other
 *   currency: true       // true = format values as ₦ on hover/axis
 * })
 */
function chiBar(canvasId, opts){
  const canvas = document.getElementById(canvasId);
  if(!canvas) return;
  const series = opts.series.map((s,i)=>({ color: s.color || CHI_PALETTE[i%CHI_PALETTE.length], ...s }));

  chiObserve(canvas, function redraw(){
    const {ctx, w, h} = chiFitCanvas(canvas);
    ctx.clearRect(0,0,w,h);
    const labels = opts.labels;
    const padL = 38, padR = 10, padT = 14, padB = 26;
    const plotW = Math.max(10, w-padL-padR);
    const plotH = Math.max(10, h-padT-padB);

    const totals = labels.map((_,i)=> opts.stacked
      ? series.reduce((a,s)=>a+(s.data[i]||0),0)
      : Math.max(...series.map(s=>s.data[i]||0)));
    const maxVal = Math.max(1, ...totals) * 1.15;

    // gridlines + y-axis labels
    ctx.strokeStyle = CHIITECH_CHART_COLORS.grid;
    ctx.fillStyle = CHIITECH_CHART_COLORS.text;
    ctx.font = '10px Inter, Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const gridLines = 4;
    for(let i=0;i<=gridLines;i++){
      const y = padT + plotH - (plotH*i/gridLines);
      ctx.beginPath();
      ctx.moveTo(padL, y); ctx.lineTo(padL+plotW, y);
      ctx.lineWidth = 1; ctx.stroke();
      ctx.fillText(chiShortNumber(maxVal*i/gridLines), padL-6, y);
    }

    // bars
    const groupW = plotW/labels.length;
    const barGap = groupW*0.18;
    labels.forEach((label,i)=>{
      const x0 = padL + i*groupW + barGap/2;
      const barsAvailW = groupW - barGap;
      if(opts.stacked){
        let yCursor = padT+plotH;
        const bw = barsAvailW*0.6;
        const bx = x0 + (barsAvailW-bw)/2;
        series.forEach(s=>{
          const val = s.data[i]||0;
          const bh = (val/maxVal)*plotH;
          ctx.fillStyle = s.color;
          ctx.fillRect(bx, yCursor-bh, bw, bh);
          yCursor -= bh;
        });
      } else {
        const bw = barsAvailW/series.length*0.72;
        series.forEach((s,si)=>{
          const val = s.data[i]||0;
          const bh = (val/maxVal)*plotH;
          const bx = x0 + si*(barsAvailW/series.length) + (barsAvailW/series.length-bw)/2;
          const grad = ctx.createLinearGradient(0, padT+plotH-bh, 0, padT+plotH);
          grad.addColorStop(0, s.color);
          grad.addColorStop(1, CHIITECH_CHART_COLORS.neonDeep===s.color?s.color:s.color);
          ctx.fillStyle = s.color;
          ctx.beginPath();
          const r = Math.min(4, bw/2);
          chiRoundRect(ctx, bx, padT+plotH-bh, bw, bh, r);
          ctx.fill();
        });
      }
      // x label
      ctx.fillStyle = CHIITECH_CHART_COLORS.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(label, x0+barsAvailW/2, padT+plotH+8);
    });

    chiDrawLegend(canvas, series);
  });
}

function chiRoundRect(ctx, x, y, w, h, r){
  if(h<=0){ return; }
  r = Math.min(r, w/2, h/2);
  ctx.moveTo(x, y+h);
  ctx.lineTo(x, y+r);
  ctx.arcTo(x, y, x+r, y, r);
  ctx.lineTo(x+w-r, y);
  ctx.arcTo(x+w, y, x+w, y+r, r);
  ctx.lineTo(x+w, y+h);
  ctx.closePath();
}

/* ---------------- LINE CHART (multi-series, with area fill) ---------------- */
function chiLine(canvasId, opts){
  const canvas = document.getElementById(canvasId);
  if(!canvas) return;
  const series = opts.series.map((s,i)=>({ color: s.color || CHI_PALETTE[i%CHI_PALETTE.length], ...s }));

  chiObserve(canvas, function redraw(){
    const {ctx, w, h} = chiFitCanvas(canvas);
    ctx.clearRect(0,0,w,h);
    const labels = opts.labels;
    const padL = 38, padR = 12, padT = 14, padB = 26;
    const plotW = Math.max(10, w-padL-padR);
    const plotH = Math.max(10, h-padT-padB);
    const allVals = series.flatMap(s=>s.data);
    const maxVal = Math.max(1, ...allVals) * 1.15;
    const stepX = labels.length>1 ? plotW/(labels.length-1) : plotW;

    ctx.strokeStyle = CHIITECH_CHART_COLORS.grid;
    ctx.fillStyle = CHIITECH_CHART_COLORS.text;
    ctx.font = '10px Inter, Arial, sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for(let i=0;i<=4;i++){
      const y = padT + plotH - (plotH*i/4);
      ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(padL+plotW,y); ctx.lineWidth=1; ctx.stroke();
      ctx.fillText(chiShortNumber(maxVal*i/4), padL-6, y);
    }

    series.forEach(s=>{
      const pts = s.data.map((v,i)=>({ x: padL+i*stepX, y: padT+plotH-(v/maxVal)*plotH }));
      // area fill
      if(s.fill!==false){
        ctx.beginPath();
        ctx.moveTo(pts[0].x, padT+plotH);
        pts.forEach(p=>ctx.lineTo(p.x,p.y));
        ctx.lineTo(pts[pts.length-1].x, padT+plotH);
        ctx.closePath();
        ctx.fillStyle = s.color+'22';
        ctx.fillStyle = hexToRgba(s.color, 0.12);
        ctx.fill();
      }
      // line
      ctx.beginPath();
      pts.forEach((p,i)=> i===0 ? ctx.moveTo(p.x,p.y) : ctx.lineTo(p.x,p.y));
      ctx.strokeStyle = s.color; ctx.lineWidth = 2.5; ctx.lineJoin='round'; ctx.stroke();
      // points
      pts.forEach(p=>{
        ctx.beginPath(); ctx.arc(p.x,p.y,3,0,Math.PI*2);
        ctx.fillStyle = s.color; ctx.fill();
      });
    });

    ctx.fillStyle = CHIITECH_CHART_COLORS.text;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    labels.forEach((label,i)=> ctx.fillText(label, padL+i*stepX, padT+plotH+8));

    chiDrawLegend(canvas, series);
  });
}

function hexToRgba(hex, alpha){
  const h = hex.replace('#','');
  const bigint = parseInt(h.length===3 ? h.split('').map(c=>c+c).join('') : h, 16);
  const r = (bigint>>16)&255, g=(bigint>>8)&255, b=bigint&255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ---------------- DOUGHNUT CHART ---------------- */
function chiDoughnut(canvasId, opts){
  const canvas = document.getElementById(canvasId);
  if(!canvas) return;
  const colors = opts.labels.map((_,i)=> (opts.colors&&opts.colors[i]) || CHI_PALETTE[i%CHI_PALETTE.length]);

  chiObserve(canvas, function redraw(){
    const {ctx, w, h} = chiFitCanvas(canvas);
    ctx.clearRect(0,0,w,h);
    const total = opts.values.reduce((a,b)=>a+b,0) || 1;
    const cx = w*0.32, cy = h/2;
    const radius = Math.max(6, Math.min(cx, cy)-10);
    const inner = radius*0.6;
    let start = -Math.PI/2;

    opts.values.forEach((v,i)=>{
      const angle = (v/total)*Math.PI*2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, start, start+angle);
      ctx.arc(cx, cy, inner, start+angle, start, true);
      ctx.closePath();
      ctx.fillStyle = colors[i];
      ctx.fill();
      start += angle;
    });

    if(opts.values.every(v=>v===0)){
      ctx.fillStyle = CHIITECH_CHART_COLORS.grid;
      ctx.beginPath(); ctx.arc(cx,cy,radius,0,Math.PI*2); ctx.arc(cx,cy,inner,0,Math.PI*2,true); ctx.closePath(); ctx.fill();
    }

    // centre label
    ctx.fillStyle = CHIITECH_CHART_COLORS.textStrong;
    ctx.font = '700 15px Inter, Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(opts.centerLabel || chiShortNumber(total), cx, cy);

    // legend with percentages, to the right
    const legendX = w*0.62;
    let legendY = h/2 - (opts.labels.length*18)/2;
    ctx.font = '11px Inter, Arial, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    opts.labels.forEach((label,i)=>{
      const pct = total ? Math.round(opts.values[i]/total*100) : 0;
      ctx.fillStyle = colors[i];
      ctx.fillRect(legendX, legendY-5, 10, 10);
      ctx.fillStyle = CHIITECH_CHART_COLORS.text;
      ctx.fillText(`${label} (${pct}%)`, legendX+16, legendY);
      legendY += 20;
    });
  });
}

/* ---------------- BAR + LINE COMBO (used by Benford's Law check) ---------------- */
function chiBarLineCombo(canvasId, {labels, bar, line}){
  const canvas = document.getElementById(canvasId);
  if(!canvas) return;
  chiObserve(canvas, function redraw(){
    const {ctx, w, h} = chiFitCanvas(canvas);
    ctx.clearRect(0,0,w,h);
    const padL=34, padR=10, padT=14, padB=24;
    const plotW = Math.max(10,w-padL-padR), plotH = Math.max(10,h-padT-padB);
    const maxVal = Math.max(1, ...bar.data, ...line.data)*1.15;

    ctx.strokeStyle = CHIITECH_CHART_COLORS.grid;
    ctx.fillStyle = CHIITECH_CHART_COLORS.text;
    ctx.font = '10px Inter, Arial, sans-serif';
    ctx.textAlign='right'; ctx.textBaseline='middle';
    for(let i=0;i<=4;i++){
      const y = padT+plotH-(plotH*i/4);
      ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(padL+plotW,y); ctx.lineWidth=1; ctx.stroke();
      ctx.fillText(Math.round(maxVal*i/4)+'%', padL-6, y);
    }

    const groupW = plotW/labels.length;
    labels.forEach((label,i)=>{
      const bw = groupW*0.5;
      const bx = padL+i*groupW+(groupW-bw)/2;
      const val = bar.data[i]||0;
      const bh = (val/maxVal)*plotH;
      ctx.fillStyle = CHIITECH_CHART_COLORS.neon;
      ctx.beginPath(); chiRoundRect(ctx, bx, padT+plotH-bh, bw, bh, 3); ctx.fill();
      ctx.fillStyle = CHIITECH_CHART_COLORS.text;
      ctx.textAlign='center'; ctx.textBaseline='top';
      ctx.fillText(label, padL+i*groupW+groupW/2, padT+plotH+6);
    });

    const stepX = labels.length>1 ? plotW/(labels.length-1) : plotW;
    const pts = line.data.map((v,i)=>({x:padL+i*stepX+groupW/2-stepX/2+ (labels.length>1?0:0), y: padT+plotH-(v/maxVal)*plotH}));
    // align line points to bar-group centers precisely
    const pts2 = labels.map((_,i)=>({ x: padL+i*groupW+groupW/2, y: padT+plotH-((line.data[i]||0)/maxVal)*plotH }));
    ctx.beginPath();
    pts2.forEach((p,i)=> i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y));
    ctx.strokeStyle = CHIITECH_CHART_COLORS.warn; ctx.lineWidth=2; ctx.stroke();
    pts2.forEach(p=>{ ctx.beginPath(); ctx.arc(p.x,p.y,2.5,0,Math.PI*2); ctx.fillStyle=CHIITECH_CHART_COLORS.warn; ctx.fill(); });

    chiDrawLegend(canvas, [{label:bar.label||'Observed', color:CHIITECH_CHART_COLORS.neon},{label:line.label||'Expected', color:CHIITECH_CHART_COLORS.warn}]);
  });
}

/* ---------------- shared legend, drawn as HTML under the canvas ---------------- */
function chiDrawLegend(canvas, series){
  const box = canvas.__chiBox || canvas.parentElement;
  const wrap = box.parentElement; // the auto-height outer .chart-canvas-wrap
  let legend = wrap.querySelector('.chi-legend');
  if(series.length<2){ if(legend) legend.remove(); return; }
  if(!legend){
    legend = document.createElement('div');
    legend.className = 'chi-legend';
    wrap.appendChild(legend); // sibling AFTER the fixed-height box, not inside it
  }
  legend.innerHTML = series.map(s=>`<span class="chi-legend-item"><i style="background:${s.color}"></i>${s.label}</span>`).join('');
}

/* ---------------- CSS isometric "3D style" bars (no canvas needed) ---------------- */
function renderIsoBars(containerId, labels, values){
  const el = document.getElementById(containerId);
  if(!el) return;
  const max = Math.max(1, ...values);
  el.innerHTML = `<div class="iso-wrap">` + values.map((v,i)=>{
    const h = Math.max(10, v/max*140);
    return `<div class="iso-bar-group">
      <div class="iso-bar" style="--h:${h}px">
        <div class="iso-top"></div>
        <div class="iso-side"></div>
        <div class="iso-front"></div>
      </div>
      <div class="iso-label">${labels[i]}</div>
    </div>`;
  }).join('') + `</div>`;
}
