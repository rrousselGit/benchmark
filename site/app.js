// Static viewer for the data stored by rrousselgit/benchmark on this branch.
// Layout: data/index.json lists suites and branch files; each branch file holds
// one entry per benchmarked commit, oldest first.

const $ = (id) => document.getElementById(id);
const els = {
  suite: $('suite'),
  branch: $('branch'),
  range: $('range'),
  machine: $('machine'),
  mode: $('mode'),
  filter: $('filter'),
  table: $('table-view'),
  charts: $('charts'),
  tooltip: $('tooltip'),
  subtitle: $('subtitle'),
};

let index;
let branchData;

async function fetchJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

function readHash() {
  return Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
}

function writeHash() {
  const params = new URLSearchParams({ suite: els.suite.value, branch: els.branch.value });
  if (els.filter.value) params.set('filter', els.filter.value);
  window.history.replaceState(null, '', `#${params}`);
}

function setOptions(select, values, preferred) {
  select.replaceChildren(...values.map((v) => new Option(v, v)));
  select.value = preferred.find((p) => values.includes(p)) ?? values[0];
}

async function init() {
  try {
    index = await fetchJson('data/index.json');
  } catch {
    showMessage('No benchmark results have been stored yet.');
    return;
  }
  const hash = readHash();
  setOptions(els.suite, Object.keys(index.suites).sort(), [hash.suite, 'default']);
  els.filter.value = hash.filter ?? '';
  els.suite.addEventListener('change', () => loadSuite([]));
  els.branch.addEventListener('change', loadBranch);
  for (const el of [els.range, els.table, els.machine, els.mode]) el.addEventListener('change', render);
  els.filter.addEventListener('input', () => { writeHash(); render(); });
  await loadSuite([hash.branch]);
}

async function loadSuite(preferredBranches) {
  const branches = Object.keys(index.suites[els.suite.value].branches).sort();
  setOptions(els.branch, branches, [...preferredBranches, 'main', 'master']);
  await loadBranch();
}

async function loadBranch() {
  writeHash();
  const file = index.suites[els.suite.value].branches[els.branch.value];
  showMessage('Loading…');
  try {
    branchData = await fetchJson(`data/${encodeURIComponent(els.suite.value)}/${encodeURIComponent(file)}`);
  } catch (e) {
    showMessage(`Could not load results: ${e.message}`);
    return;
  }
  // Shared CI runners differ in hardware, which shifts every benchmark at
  // once, so the history can be narrowed to one kind of machine.
  const counts = new Map();
  for (const e of branchData.entries) {
    const m = e.machine ?? 'Unknown machine';
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  const options = [new Option('All machines', '')];
  for (const [m, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    options.push(new Option(`${m} (${n})`, m));
  }
  const previous = els.machine.value;
  els.machine.replaceChildren(...options);
  els.machine.value = counts.has(previous) ? previous : '';
  render();
}

function showMessage(text) {
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = text;
  els.charts.replaceChildren(p);
}

function render() {
  const limit = Number(els.range.value);
  const machine = els.machine.value;
  const relative = els.mode.value === 'relative';
  els.machine.disabled = relative;
  // Relative values only compare against the same reference commit: use the
  // latest one. Raw timings can be narrowed to one kind of machine instead.
  const reference = branchData.entries.at(-1)?.reference?.sha;
  const matching = relative
    ? branchData.entries.filter((e) => e.reference && e.reference.sha === reference)
    : machine
      ? branchData.entries.filter((e) => (e.machine ?? 'Unknown machine') === machine)
      : branchData.entries;
  if (relative && matching.length === 0) {
    showMessage('No results were measured against a reference commit yet. Switch to raw timings.');
    return;
  }
  const entries = limit > 0 ? matching.slice(-limit) : matching;
  const last = entries.at(-1);
  els.subtitle.textContent = last
    ? `${entries.length} commit${entries.length === 1 ? '' : 's'} on ${branchData.branch}, latest ${shortDate(last.commit.timestamp)}` +
      (relative ? `. Values are % versus reference ${reference.slice(0, 7)}, measured on the same machine as each commit.` : '')
    : '';

  const names = [];
  const seen = new Set();
  for (const entry of entries) {
    for (const b of entry.benchmarks) {
      if (!seen.has(b.name)) { seen.add(b.name); names.push(b.name); }
    }
  }
  const query = els.filter.value.trim().toLowerCase();
  const shown = names.filter((n) => n.toLowerCase().includes(query)).sort((a, b) => a.localeCompare(b));
  if (shown.length === 0) {
    showMessage(entries.length === 0 ? 'No results on this branch yet.' : 'No benchmark matches this filter.');
    return;
  }
  const cards = shown.map((name) => card(name, entries)).filter(Boolean);
  if (cards.length === 0) {
    showMessage('The reference commit has none of these benchmarks. Switch to raw timings.');
    return;
  }
  els.charts.replaceChildren(...cards);
}

function seriesFor(name, entries) {
  const relative = els.mode.value === 'relative';
  const points = [];
  entries.forEach((entry, i) => {
    const b = entry.benchmarks.find((x) => x.name === name);
    if (!b) return;
    const lowerIsBetter = b.lowerIsBetter !== false;
    if (!relative) {
      points.push({ i, entry, value: b.value, unit: b.unit, raw: b, lowerIsBetter });
      return;
    }
    const ref = entry.reference.benchmarks.find((x) => x.name === name);
    if (!ref || ref.value === 0) return;
    points.push({ i, entry, value: (b.value / ref.value - 1) * 100, unit: '%', raw: b, lowerIsBetter, relative: true });
  });
  return points;
}

function card(name, entries) {
  const points = seriesFor(name, entries);
  if (points.length === 0) return null;
  const el = document.createElement('section');
  el.className = 'card';
  const h = document.createElement('h2');
  h.textContent = name;
  el.append(h);

  const latest = points.at(-1);
  const previous = points.at(-2);
  const row = document.createElement('div');
  row.className = 'latest';
  const value = document.createElement('span');
  value.className = 'value';
  value.textContent = formatPoint(latest);
  row.append(value);
  if (previous && latest.relative) {
    const change = latest.value - previous.value;
    const worse = latest.lowerIsBetter ? change > 0 : change < 0;
    const span = document.createElement('span');
    span.className = `change ${Math.abs(change) < 0.05 ? '' : worse ? 'worse' : 'better'}`;
    span.textContent = `${change > 0 ? '+' : ''}${change.toFixed(1)} points vs previous commit`;
    row.append(span);
  } else if (previous && previous.value !== 0) {
    const change = ((latest.value - previous.value) / Math.abs(previous.value)) * 100;
    const worse = latest.lowerIsBetter ? change > 0 : change < 0;
    const span = document.createElement('span');
    span.className = `change ${Math.abs(change) < 0.05 ? '' : worse ? 'worse' : 'better'}`;
    span.textContent = `${change > 0 ? '+' : ''}${change.toFixed(1)}% vs previous commit${latest.lowerIsBetter ? '' : ' (higher is better)'}`;
    row.append(span);
  }
  el.append(row);
  el.append(els.table.checked ? table(points) : chart(points, entries.length));
  return el;
}

function table(points) {
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  const t = document.createElement('table');
  t.innerHTML = '<thead><tr><th>Commit</th><th>Date</th><th class="num">Value</th></tr></thead>';
  const body = document.createElement('tbody');
  for (const p of [...points].reverse()) {
    const tr = body.insertRow();
    const link = document.createElement('a');
    link.href = p.entry.commit.url;
    link.textContent = p.entry.commit.sha.slice(0, 7);
    link.title = p.entry.commit.message;
    tr.insertCell().append(link);
    tr.insertCell().textContent = shortDate(p.entry.commit.timestamp);
    const v = tr.insertCell();
    v.className = 'num';
    v.textContent = formatPoint(p);
  }
  t.append(body);
  wrap.append(t);
  return wrap;
}

const SVG = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function chart(points, count) {
  const width = 400;
  const height = 180;
  const pad = { top: 8, right: 8, bottom: 8, left: 52 };
  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, role: 'img' });
  svg.setAttribute('aria-label', `${points.length} results, latest ${formatPoint(points.at(-1))}`);

  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  // Start at zero when it costs little room, so small changes don't look dramatic.
  if (min > 0 && min < (max - min) * 2) min = 0;
  if (min === max) { min = min === 0 ? 0 : min * 0.9; max = max === 0 ? 1 : max * 1.1; }
  const span = max - min;
  min -= span * 0.05; max += span * 0.05;
  if (values.every((v) => v >= 0) && min < 0) min = 0;

  const x = (i) => pad.left + (count <= 1 ? (width - pad.left - pad.right) / 2 : (i / (count - 1)) * (width - pad.left - pad.right));
  const y = (v) => pad.top + (1 - (v - min) / (max - min)) * (height - pad.top - pad.bottom);

  for (const t of ticks(min, max, 4)) {
    svg.append(svgEl('line', { class: 'grid', x1: pad.left, x2: width - pad.right, y1: y(t), y2: y(t), 'vector-effect': 'non-scaling-stroke' }));
    const label = svgEl('text', { class: 'axis', x: pad.left - 6, y: y(t) + 4, 'text-anchor': 'end' });
    label.textContent = formatNumber(t) + (points[0].relative ? '%' : '');
    svg.append(label);
  }

  // Break the line where a commit has no result for this benchmark.
  let d = '';
  points.forEach((p, k) => {
    const joined = k > 0 && points[k - 1].i === p.i - 1;
    d += `${joined ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.value).toFixed(1)}`;
  });
  svg.append(svgEl('path', { class: 'line', d, 'vector-effect': 'non-scaling-stroke' }));
  if (points.length <= 40) {
    for (const p of points) {
      svg.append(svgEl('circle', { class: 'dot', cx: x(p.i), cy: y(p.value), r: 3, 'vector-effect': 'non-scaling-stroke' }));
    }
  }

  const cross = svgEl('line', { class: 'crosshair', y1: pad.top, y2: height - pad.bottom, 'vector-effect': 'non-scaling-stroke', visibility: 'hidden' });
  const marker = svgEl('circle', { class: 'dot', r: 5, visibility: 'hidden', 'vector-effect': 'non-scaling-stroke' });
  svg.append(cross, marker);
  const hit = svgEl('rect', { class: 'hit', x: 0, y: 0, width, height });
  svg.append(hit);

  const nearest = (event) => {
    const box = svg.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * width;
    let best = points[0];
    for (const p of points) if (Math.abs(x(p.i) - px) < Math.abs(x(best.i) - px)) best = p;
    return best;
  };
  hit.addEventListener('pointermove', (event) => {
    const p = nearest(event);
    cross.setAttribute('x1', x(p.i)); cross.setAttribute('x2', x(p.i));
    marker.setAttribute('cx', x(p.i)); marker.setAttribute('cy', y(p.value));
    cross.setAttribute('visibility', 'visible'); marker.setAttribute('visibility', 'visible');
    showTooltip(p, event);
  });
  hit.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden'); marker.setAttribute('visibility', 'hidden');
    els.tooltip.hidden = true;
  });
  hit.addEventListener('click', (event) => window.open(nearest(event).entry.commit.url, '_blank', 'noopener'));
  return svg;
}

function showTooltip(p, event) {
  const tt = els.tooltip;
  const { commit } = p.entry;
  const value = document.createElement('div');
  value.className = 'tt-value';
  value.textContent = formatPoint(p);
  const raw = document.createElement('div');
  raw.textContent = p.relative ? `${formatValue(p.raw.value, p.raw.unit)} on this machine` : '';
  const meta = document.createElement('div');
  meta.textContent = `${commit.sha.slice(0, 7)} · ${shortDate(commit.timestamp)}${commit.author ? ` · ${commit.author}` : ''}`;
  const message = document.createElement('div');
  message.className = 'tt-message';
  message.textContent = commit.message.split('\n')[0];
  const machine = document.createElement('div');
  machine.className = 'tt-message';
  machine.textContent = p.entry.machine ?? 'Unknown machine';
  tt.replaceChildren(value, raw, meta, message, machine);
  tt.hidden = false;
  const margin = 12;
  const { width, height } = tt.getBoundingClientRect();
  let left = event.clientX + margin;
  if (left + width > window.innerWidth - margin) left = event.clientX - width - margin;
  let top = event.clientY + margin;
  if (top + height > window.innerHeight - margin) top = event.clientY - height - margin;
  tt.style.left = `${Math.max(margin, left)}px`;
  tt.style.top = `${Math.max(margin, top)}px`;
}

function ticks(min, max, count) {
  const step0 = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-9; t += step) out.push(Number(t.toPrecision(12)));
  return out;
}

function formatNumber(v) {
  const abs = Math.abs(v);
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-3)) return v.toExponential(1);
  return Number(v.toPrecision(abs >= 1000 ? 6 : 4)).toLocaleString();
}

function formatPoint(p) {
  if (!p.relative) return formatValue(p.value, p.unit);
  return `${p.value > 0 ? '+' : ''}${p.value.toFixed(1)}% vs reference`;
}

function formatValue(v, unit) {
  return unit ? `${formatNumber(v)} ${unit}` : formatNumber(v);
}

function shortDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

init();
