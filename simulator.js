'use strict';

const WAYS = 8;
const MEM_BLOCKS = 1024;
const CACHE_T = 1;
const MEM_T = 10;

const POLICY_COLOR = { lru: 'var(--blue)', mru: 'var(--amber)' };

const $ = (id) => document.getElementById(id);
const isPow2 = (x) => x >= 1 && (x & (x - 1)) === 0;

let hasRunBefore = false;

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seqSequential(n) {
  const out = [];
  for (let rep = 0; rep < 2; rep++) {
    for (let i = 0; i < 2 * n; i++) out.push(i);
  }
  return out;
}

function seqMidRepeat(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(i);
  for (let rep = 0; rep < 2; rep++) {
    for (let i = 0; i < 2 * n; i++) out.push(i);
  }
  for (let i = n - 1; i >= 0; i--) out.push(i);
  for (let rep = 0; rep < 2; rep++) {
    for (let i = 2 * n - 1; i >= 0; i--) out.push(i);
  }
  return out;
}

function seqRandom(seed) {
  const rnd = mulberry32(seed);
  const out = [];
  for (let i = 0; i < 64; i++) out.push(Math.floor(rnd() * MEM_BLOCKS));
  return out;
}

function simulate(seq, blocks, blockSize, policy, readPolicy) {
  const sets = blocks / WAYS;
  const cache = Array.from({ length: sets }, () => Array(WAYS).fill(null));

  let hits = 0;
  let misses = 0;
  let time = 0;
  let stamp = 0;
  const steps = [];

  const missTime =
    readPolicy === 'lt'
      ? CACHE_T + MEM_T * blockSize
      : CACHE_T + MEM_T * blockSize + CACHE_T;

  for (let i = 0; i < seq.length; i++) {
    const block = seq[i];
    const s = block % sets;
    const set = cache[s];
    stamp++;

    let hit = false;
    let way = -1;
    let evicted = null;

    for (let w = 0; w < WAYS; w++) {
      if (set[w] && set[w].block === block) {
        hit = true;
        way = w;
        break;
      }
    }

    if (hit) {
      hits++;
      time += CACHE_T;
      set[way].stamp = stamp;
    } else {
      misses++;
      time += missTime;
      way = set.findIndex((x) => x === null);
      if (way === -1) {
        way = 0;
        for (let w = 1; w < WAYS; w++) {
          const older = set[w].stamp < set[way].stamp;
          if (policy === 'lru' ? older : !older) way = w;
        }
        evicted = set[way].block;
      }
      set[way] = { block, stamp };
    }

    const snap = cache.map((st) => {
      const filled = st.filter(Boolean).slice().sort((a, b) => b.stamp - a.stamp);
      const rank = new Map(filled.map((x, idx) => [x.block, idx]));
      return st.map((x) =>
        x ? { block: x.block, rank: rank.get(x.block), filledCount: filled.length } : null
      );
    });

    steps.push({ i, block, set: s, hit, way, evicted, time, hits, misses, snap });
  }

  const n = seq.length;
  return {
    steps,
    summary: {
      n,
      hits,
      misses,
      hitRate: hits / n,
      missRate: misses / n,
      time,
      amat: time / n,
    },
    sets,
    blocks,
    blockSize,
    policy,
    readPolicy,
  };
}

let RUNS = null;
let ACTIVE = [];
let SEQ = [];
let STEPS = 0;
let animTimer = null;
let cur = -1;

function segVal(id) {
  return $(id).querySelector('button.on').dataset.v;
}

document.querySelectorAll('.seg').forEach((seg) => {
  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    seg.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
    btn.classList.add('on');
    if (seg.id === 'vm' && RUNS) applyViewMode();
  });
});

$('tc').addEventListener('change', () => {
  $('seedrow').style.display = $('tc').value === 'c' ? 'block' : 'none';
});

$('run').addEventListener('click', () => {
  stopAnim();

  const blockSize = +$('bs').value;
  const numBlocks = +$('nb').value;
  const err = $('err');
  err.style.display = 'none';

  const problems = [];
  if (!(isPow2(blockSize) && blockSize >= 2)) {
    problems.push('Block size must be a power of 2 and at least 2.');
  }
  if (!(isPow2(numBlocks) && numBlocks >= 8)) {
    problems.push('Cache blocks must be a power of 2 and at least 8 (8-way needs a full set).');
  }
  if (numBlocks > MEM_BLOCKS) {
    problems.push('Cache cannot exceed 1024 blocks.');
  }
  if (problems.length) {
    err.textContent = problems.join(' ');
    err.style.display = 'block';
    return;
  }

  const tc = $('tc').value;
  const polChoice = segVal('pol');
  const readPolicy = segVal('rp');

  ACTIVE = polChoice === 'both' ? ['lru', 'mru'] : [polChoice];

  SEQ =
    tc === 'a' ? seqSequential(numBlocks)
    : tc === 'b' ? seqMidRepeat(numBlocks)
    : seqRandom(+$('seed').value || 0);
  STEPS = SEQ.length;

  RUNS = {};
  for (const pol of ACTIVE) {
    RUNS[pol] = simulate(SEQ, numBlocks, blockSize, pol, readPolicy);
  }
  const first = RUNS[ACTIVE[0]];

  const missNs = readPolicy === 'lt'
    ? CACHE_T + MEM_T * blockSize
    : CACHE_T + MEM_T * blockSize + CACHE_T;

  $('cfgsum').textContent =
    `sets=${first.sets} x 8 ways | block=${blockSize} words | seq len=${STEPS} | ` +
    `hit=1 ns, miss=${missNs} ns`;
  $('dielabel').textContent =
    ` - ${first.sets} set${first.sets > 1 ? 's' : ''} x 8 ways, ` +
    `${ACTIVE.map((p) => p.toUpperCase()).join(' vs ')}, ` +
    `${readPolicy === 'lt' ? 'load-through' : 'non-load-through'}`;
  $('seqview').innerHTML = '<b>sequence:</b> ' + SEQ.join(', ');

  buildDies();
  renderLog();
  renderCompare();
  applyViewMode();

  if (hasRunBefore && segVal('vm') === 'anim') {
    $('btnPlay').click();
  }
  hasRunBefore = true;
});

function applyViewMode() {
  const vm = segVal('vm');
  $('animbar').style.display = vm === 'anim' ? 'flex' : 'none';
  if (vm === 'final') {
    gotoStep(STEPS - 1, false);
  } else {
    gotoStep(-1, false);
    $('scrub').max = STEPS;
    $('scrub').value = 0;
  }
}

function buildDies() {
  const host = $('dies');
  host.innerHTML = '';
  host.classList.toggle('dual', ACTIVE.length === 2);

  for (const pol of ACTIVE) {
    const res = RUNS[pol];
    const col = document.createElement('div');
    col.className = 'diecol';

    const title = document.createElement('div');
    title.className = 'dietitle';
    title.innerHTML =
      `<span style="color:${POLICY_COLOR[pol]}">${pol.toUpperCase()}</span>` +
      `<span class="dielive" id="live-${pol}"></span>`;
    col.appendChild(title);

    const die = document.createElement('div');
    die.className = 'die';
    for (let s = 0; s < res.sets; s++) {
      const setEl = document.createElement('div');
      setEl.className = 'set';
      setEl.innerHTML =
        `<div class="shead"><span>SET ${s}</span>` +
        `<span>addr mod ${res.sets} = ${s}</span></div>`;
      const ways = document.createElement('div');
      ways.className = 'ways';
      for (let w = 0; w < WAYS; w++) {
        const cell = document.createElement('div');
        cell.className = 'way';
        cell.id = `w-${pol}-${s}-${w}`;
        cell.innerHTML = `<div class="wtag">W${w}</div><div class="empty">-</div>`;
        ways.appendChild(cell);
      }
      setEl.appendChild(ways);
      die.appendChild(setEl);
    }
    col.appendChild(die);
    host.appendChild(col);
  }
}

function paintSnap(stepIdx, flash) {
  for (const pol of ACTIVE) {
    const res = RUNS[pol];
    const snap = stepIdx >= 0 ? res.steps[stepIdx].snap : null;

    for (let s = 0; s < res.sets; s++) {
      for (let w = 0; w < WAYS; w++) {
        const cell = $(`w-${pol}-${s}-${w}`);
        cell.classList.remove('flash-hit', 'flash-miss', 'flash-evict');
        const entry = snap ? snap[s][w] : null;
        if (!entry) {
          cell.innerHTML = `<div class="wtag">W${w}</div><div class="empty">-</div>`;
          continue;
        }
        const pct =
          entry.filledCount > 1
            ? (100 * (entry.filledCount - 1 - entry.rank)) / (entry.filledCount - 1)
            : 100;
        let badge = '';
        if (entry.rank === 0) badge = '<span class="badge mru">MRU</span>';
        else if (entry.rank === entry.filledCount - 1 && entry.filledCount === WAYS)
          badge = '<span class="badge lru">LRU</span>';
        cell.innerHTML =
          `<div class="wtag">W${w}</div><div class="blk">${entry.block}</div>` +
          badge +
          `<div class="rec" style="width:${Math.max(pct, 6)}%"></div>`;
      }
    }

    const live = $(`live-${pol}`);
    if (stepIdx >= 0) {
      const st = res.steps[stepIdx];
      live.textContent = `${st.hit ? 'HIT' : 'MISS'}  |  ${st.hits}H / ${st.misses}M`;
      live.style.color = st.hit ? 'var(--hit)' : 'var(--miss)';
      if (flash) {
        const cell = $(`w-${pol}-${st.set}-${st.way}`);
        cell.classList.add(st.hit ? 'flash-hit' : 'flash-miss');
        if (st.evicted !== null && !st.hit) cell.classList.add('flash-evict');
      }
    } else {
      live.textContent = '';
    }
  }
}

function statBox(label, values) {
  const inner = values
    .map((x, i) => {
      const tag =
        ACTIVE.length === 2
          ? `<span class="ptag" style="color:${POLICY_COLOR[ACTIVE[i]]}">${ACTIVE[i].toUpperCase()}</span>`
          : '';
      return `<div class="v ${x.cls || ''}">${tag}${x.v}</div>`;
    })
    .join('');
  return `<div class="stat"><div class="k">${label}</div>${inner}</div>`;
}

function renderStats(stepIdx) {
  const per = ACTIVE.map((pol) => {
    if (stepIdx < 0) return { n: 0, h: 0, m: 0, t: 0 };
    const st = RUNS[pol].steps[stepIdx];
    return { n: st.i + 1, h: st.hits, m: st.misses, t: st.time };
  });
  const pct = (x, n) => (n ? ((100 * x) / n).toFixed(2) + '%' : '0.00%');
  const amat = (t, n) => (n ? (t / n).toFixed(2) : '0.00') + ' ns';

  $('stats').innerHTML =
    statBox('Memory accesses', [{ v: per[0].n }]) +
    statBox('Cache hits', per.map((p) => ({ v: p.h, cls: 'hit' }))) +
    statBox('Cache misses', per.map((p) => ({ v: p.m, cls: 'miss' }))) +
    statBox('Hit rate', per.map((p) => ({ v: pct(p.h, p.n), cls: 'hit' }))) +
    statBox('Miss rate', per.map((p) => ({ v: pct(p.m, p.n), cls: 'miss' }))) +
    statBox('AMAT', per.map((p) => ({ v: amat(p.t, p.n), cls: 'amber' }))) +
    statBox('Total time', per.map((p) => ({ v: p.t.toLocaleString() + ' ns', cls: 'amber' })));
}

function logLines() {
  const first = RUNS[ACTIVE[0]];
  const missNs = first.readPolicy === 'lt'
    ? CACHE_T + MEM_T * first.blockSize
    : CACHE_T + MEM_T * first.blockSize + CACHE_T;

  const L = [];
  L.push(`# Machine 9 - 8-way BSA, ${ACTIVE.map((p) => p.toUpperCase()).join(' vs ')}, ` +
         `${first.readPolicy === 'lt' ? 'load-through' : 'non-load-through'}`);
  L.push(`# blocks=${first.blocks} (sets=${first.sets}x8), block size=${first.blockSize} words, MM=1024 blocks`);
  L.push(`# hit=1 ns, miss=${missNs} ns`);
  L.push('#'.padEnd(78, '-'));

  const fmtEv = (e) => (e === null ? '-'.padStart(5) : String(e).padStart(5));

  if (ACTIVE.length === 2) {
    L.push(`${'idx'.padStart(4)} ${'blk'.padStart(5)} ${'set'.padStart(4)} | ` +
           `LRU: way res  evict | MRU: way res  evict`);
    for (let i = 0; i < STEPS; i++) {
      const a = RUNS.lru.steps[i];
      const b = RUNS.mru.steps[i];
      L.push(
        `${String(i).padStart(4)} ${String(a.block).padStart(5)} ${String(a.set).padStart(4)} | ` +
        `     ${String(a.way).padStart(3)} ${a.hit ? 'HIT ' : 'MISS'} ${fmtEv(a.evicted)} | ` +
        `     ${String(b.way).padStart(3)} ${b.hit ? 'HIT ' : 'MISS'} ${fmtEv(b.evicted)}`
      );
    }
    L.push('#'.padEnd(78, '-'));
    for (const pol of ACTIVE) {
      const s = RUNS[pol].summary;
      L.push(`# ${pol.toUpperCase()}: accesses=${s.n}  hits=${s.hits}  misses=${s.misses}  ` +
             `hit rate=${(100 * s.hitRate).toFixed(2)}%  miss rate=${(100 * s.missRate).toFixed(2)}%  ` +
             `AMAT=${s.amat.toFixed(2)} ns  total=${s.time} ns`);
    }
  } else {
    const res = RUNS[ACTIVE[0]];
    L.push(`${'idx'.padStart(4)} ${'blk'.padStart(5)} ${'set'.padStart(4)} ${'way'.padStart(4)}  result  evicted   cum.time(ns)`);
    for (const st of res.steps) {
      L.push(
        `${String(st.i).padStart(4)} ${String(st.block).padStart(5)} ` +
        `${String(st.set).padStart(4)} ${String(st.way).padStart(4)}  ` +
        `${st.hit ? 'HIT  ' : 'MISS '}  ` +
        `${st.evicted === null ? '-'.padStart(7) : String(st.evicted).padStart(7)}   ` +
        `${String(st.time).padStart(10)}`
      );
    }
    const s = res.summary;
    L.push('#'.padEnd(78, '-'));
    L.push(`# accesses=${s.n}  hits=${s.hits}  misses=${s.misses}  ` +
           `hit rate=${(100 * s.hitRate).toFixed(2)}%  miss rate=${(100 * s.missRate).toFixed(2)}%`);
    L.push(`# AMAT=${s.amat.toFixed(2)} ns  total time=${s.time} ns`);
  }
  return L;
}

function renderLog() {
  $('log').innerHTML = logLines()
    .map((l) => {
      if (l.startsWith('#')) return `<span class="d">${l}</span>`;
      if (ACTIVE.length === 1) {
        if (l.includes('HIT')) return `<span class="h">${l}</span>`;
        if (l.includes('MISS')) return `<span class="m">${l}</span>`;
      } else {
        return l
          .replaceAll('HIT ', '<span class="h">HIT </span>')
          .replaceAll('MISS', '<span class="m">MISS</span>');
      }
      return l;
    })
    .join('\n');
}

$('dl').addEventListener('click', () => {
  if (!RUNS) return;
  const blob = new Blob([logLines().join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cache-trace-log.txt';
  a.click();
});

function renderCompare() {
  const first = RUNS[ACTIVE[0]];
  const rows = ['lru', 'mru'].map((pol) => ({
    pol,
    ...(RUNS[pol]
      ? RUNS[pol].summary
      : simulate(SEQ, first.blocks, first.blockSize, pol, first.readPolicy).summary),
  }));

  const better = (a, b, lowerIsBetter) => (lowerIsBetter ? a < b : a > b);
  const cell = (val, mine, theirs, lowerIsBetter, fmt) =>
    `<td class="${better(mine, theirs, lowerIsBetter) ? 'win' : ''}">${fmt(val)}</td>`;

  $('cmp').innerHTML =
    `<tr><th>Policy</th><th>Hits</th><th>Misses</th><th>Hit rate</th>` +
    `<th>Miss rate</th><th>AMAT (ns)</th><th>Total time (ns)</th></tr>` +
    rows
      .map((r, i) => {
        const o = rows[1 - i];
        return `<tr>
          <td style="color:${POLICY_COLOR[r.pol]};font-weight:600">${r.pol.toUpperCase()}</td>
          ${cell(r.hits, r.hits, o.hits, false, (v) => v)}
          ${cell(r.misses, r.misses, o.misses, true, (v) => v)}
          ${cell(r.hitRate, r.hitRate, o.hitRate, false, (v) => (100 * v).toFixed(2) + '%')}
          ${cell(r.missRate, r.missRate, o.missRate, true, (v) => (100 * v).toFixed(2) + '%')}
          ${cell(r.amat, r.amat, o.amat, true, (v) => v.toFixed(2))}
          ${cell(r.time, r.time, o.time, true, (v) => v.toLocaleString())}
        </tr>`;
      })
      .join('');
}

function gotoStep(idx, flash = true) {
  cur = idx;
  paintSnap(idx, flash);
  renderStats(idx);
  $('scrub').max = STEPS;
  $('scrub').value = idx + 1;
  if (idx >= 0) {
    const blk = SEQ[idx];
    $('stepinfo').textContent = `${idx + 1}/${STEPS} - blk ${blk}`;
  } else {
    $('stepinfo').textContent = `0/${STEPS}`;
  }
}

function stopAnim() {
  if (animTimer) {
    clearInterval(animTimer);
    animTimer = null;
    $('btnPlay').textContent = 'Play';
  }
}

function openLogModal() {
  if (!RUNS) return;
  $('logFull').innerHTML = $('log').innerHTML;
  const first = RUNS[ACTIVE[0]];
  $('modalMeta').textContent =
    `${first.sets}x8 ways, ${ACTIVE.map((p) => p.toUpperCase()).join(' vs ')}, ` +
    `${first.readPolicy === 'lt' ? 'load-through' : 'non-load-through'} - ${STEPS} accesses`;
  $('logModal').classList.add('open');
}

function closeLogModal() {
  $('logModal').classList.remove('open');
}

$('expandLog').addEventListener('click', openLogModal);
$('closeLog').addEventListener('click', closeLogModal);
$('logModal').addEventListener('click', (e) => {
  if (e.target.id === 'logModal') closeLogModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('logModal').classList.contains('open')) closeLogModal();
});
$('dlModal').addEventListener('click', () => $('dl').click());

$('btnPlay').addEventListener('click', () => {
  if (!RUNS) return;
  if (animTimer) { stopAnim(); return; }
  if (cur >= STEPS - 1) gotoStep(-1, false);
  $('btnPlay').textContent = 'Pause';
  animTimer = setInterval(() => {
    if (cur >= STEPS - 1) { stopAnim(); return; }
    gotoStep(cur + 1);
  }, +$('spd').value);
});

$('btnStep').addEventListener('click', () => {
  if (RUNS && cur < STEPS - 1) { stopAnim(); gotoStep(cur + 1); }
});
$('btnBack').addEventListener('click', () => {
  if (RUNS && cur >= 0) { stopAnim(); gotoStep(cur - 1); }
});
$('btnReset').addEventListener('click', () => {
  if (RUNS) { stopAnim(); gotoStep(-1, false); }
});
$('scrub').addEventListener('input', (e) => {
  if (RUNS) { stopAnim(); gotoStep(+e.target.value - 1, true); }
});
$('spd').addEventListener('change', () => {
  if (animTimer) { stopAnim(); $('btnPlay').click(); }
});

$('run').click();