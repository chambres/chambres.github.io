const http = require('http');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  white: '\x1b[97m', green: '\x1b[32m', cyan: '\x1b[36m',
  gray: '\x1b[90m', orange: '\x1b[38;5;209m',
};

const SRC = 'curl rhl.sh';
const FULL = 'rahul saravanakumar';

const W = (d) => Math.max(SRC.length, d.length);
const bw = (ch) => C.bold + C.white + ch + C.reset;

// ---------------------------------------------------------------------------
// Terminals line-buffer curl's stdout — nothing appears until a newline lands.
// So every redraw ends with \n, and we step the cursor back up next frame.
// ---------------------------------------------------------------------------
function makeLine(res, startOnPreviousLine) {
  let live = startOnPreviousLine;
  return {
    draw(text) {
      res.write((live ? '\x1b[1A' : '') + '\r\x1b[2K' + text + '\n');
      live = true;
    },
    finish() { live = false; },
  };
}

// NOTE on the two modes:
//   plain — writes below your command; nothing above is ever touched, so it
//           is safe on every prompt, width and theme.
//   b     — wipes the whole screen first and plays on a blank terminal.
//           \x1b[2J clears the visible screen, \x1b[H parks the cursor at the
//           top-left. Scrollback is deliberately left alone (that would be
//           \x1b[3J) so nobody loses their history to a curl.
//           Both modes still use \x1b[1A frame-to-frame — that's how makeLine
//           overwrites its own line — but neither one now steps up ONTO your
//           prompt, so a two-line prompt or a wrapped command can't be
//           clobbered the way the old line-takeover could.

// ========================= v1 — every letter migrates ======================
// each surviving letter of "curl rhl.sh" travels to its slot in the name
const MOVES = [
  { ch: 'c', from: 0, to: null },
  { ch: 'u', from: 1, to: 3 },
  { ch: 'r', from: 2, to: 0 },
  { ch: 'l', from: 3, to: 4 },
  { ch: ' ', from: 4, to: 5 },
  { ch: 'r', from: 5, to: 8 },
  { ch: 'h', from: 6, to: 2 },
  { ch: 'l', from: 7, to: null },
  { ch: '.', from: 8, to: null },
  { ch: 's', from: 9, to: 6 },
  { ch: 'h', from: 10, to: null },
];

function place(buf, pos, styled, width) {
  if (buf[pos] === null) { buf[pos] = styled; return; }
  for (let d = 1; d < width; d++) {
    if (pos + d < width && buf[pos + d] === null) { buf[pos + d] = styled; return; }
    if (pos - d >= 0 && buf[pos - d] === null) { buf[pos - d] = styled; return; }
  }
}

function migFrame(t, N, born, dst, width, moves, tint) {
  const buf = new Array(width).fill(null);
  const p = t / N;
  const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  const style = tint ? (ch) => C.bold + C.orange + ch + C.reset : bw;
  for (const m of moves) {
    if (m.to === null || m.ch === ' ') continue;
    place(buf, Math.round(m.from + (m.to - m.from) * e), style(m.ch), width);
  }
  for (const i of born) buf[i] = bw(dst[i]);
  for (const m of moves) {
    if (m.to !== null || m.ch === ' ') continue;
    const dp = 0.35 + (m.from % 3) * 0.12;
    if (p < dp && buf[m.from] === null) {
      buf[m.from] = p > dp * 0.5 ? C.dim + m.ch + C.reset : m.ch;
    }
  }
  let out = '';
  for (let i = 0; i < width; i++) out += buf[i] === null ? ' ' : buf[i];
  return out.replace(/\s+$/, '');
}

function migration(dst, bornIdx, hold, frameMs, bornMs, moves = MOVES, tint = false) {
  return async (line) => {
    const width = W(dst), N = 16;
    line.draw(SRC.split('').map(bw).join(''));
    await sleep(hold);
    let prev = null;
    for (let t = 1; t <= N; t++) {
      const f = migFrame(t, N, [], dst, width, moves, tint);
      if (f === prev) continue;
      prev = f;
      line.draw(f);
      await sleep(frameMs);
    }
    const born = [];
    for (const i of bornIdx) {
      born.push(i);
      line.draw(migFrame(N, N, born, dst, width, moves, false));
      await sleep(bornMs);
    }
    await sleep(400);
    line.finish();
  };
}
const BORN_FULL = [1, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

// ============= v3 — rhl survives whole; curl lends only its u =============
// "rhl" is the actual domain, so all three of its letters live on as the
// r, h and l of rahul. They travel LEFT while curl's u travels RIGHT past
// them — the two strands interleave. Everything else in "curl" dies.
const MOVES_V3 = [
  { ch: 'c', from: 0, to: null },
  { ch: 'u', from: 1, to: 3 },    // the only letter curl donates
  { ch: 'r', from: 2, to: null },
  { ch: 'l', from: 3, to: null },
  { ch: ' ', from: 4, to: 5 },
  { ch: 'r', from: 5, to: 0 },    // rhl -> r a h u l
  { ch: 'h', from: 6, to: 2 },
  { ch: 'l', from: 7, to: 4 },
  { ch: '.', from: 8, to: null },
  { ch: 's', from: 9, to: 6 },    // the s of .sh starts saravanakumar
  { ch: 'h', from: 10, to: null },
];
const BORN_V3 = [1, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

// ================= v2 — greyscale crossfade, anchored on rhl ===============
// rhl is the domain, so rhl is what survives: those three letters slide left
// into the r, h and l of rahul while everything else (the u included) fades
// out. The rest of the name then fades in, spreading outward from them.
async function v2(line) {
  const dst = FULL, width = W(dst), FRAME_MS = 62;
  const RAMP = { 1: 236, 2: 241, 3: 246, 4: 251 };
  const lvl = (l) => (l >= 5 ? C.bold + '\x1b[38;5;255m' : '\x1b[38;5;' + RAMP[l] + 'm');

  const KEEP = [{ ch: 'r', from: 5, to: 0 }, { ch: 'h', from: 6, to: 2 }, { ch: 'l', from: 7, to: 4 }];
  const ANCHOR = KEEP.map((k) => k.to);
  const TRAVEL_START = 4, TRAVEL_END = 14;

  const DIE = [0, 1, 2, 3, 8, 9, 10]; // c u r l . s h — everything not rhl
  const fadeStart = {};
  DIE.forEach((i, k) => { fadeStart[i] = Math.floor(k * 0.7); });

  const distA = (i) => Math.min(...ANCHOR.map((a) => Math.abs(i - a)));
  const MAT = dst.split('').map((_, i) => i)
    .filter((i) => !ANCHOR.includes(i) && dst[i] !== ' ')
    .sort((a, b) => distA(a) - distA(b) || a - b);
  const matStart = {};
  MAT.forEach((i, k) => { matStart[i] = 12 + k; });
  const LAST = Math.max(...Object.values(matStart)) + 5;

  const frame = (f) => {
    const buf = new Array(width).fill(null);
    for (const i of DIE) {
      const l = Math.max(0, Math.min(5, 5 - (f - fadeStart[i])));
      if (l > 0) buf[i] = lvl(l) + SRC[i] + C.reset;
    }
    for (const i of MAT) {
      const l = Math.max(0, Math.min(5, f - matStart[i]));
      if (l > 0) buf[i] = lvl(l) + dst[i] + C.reset;
    }
    // the surviving rhl, drawn last so nothing covers it
    const t = Math.max(0, Math.min(1, (f - TRAVEL_START) / (TRAVEL_END - TRAVEL_START)));
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const moving = f >= TRAVEL_START && f < TRAVEL_END + 4;
    for (const k of KEEP) {
      const pos = Math.round(k.from + (k.to - k.from) * e);
      buf[pos] = (moving ? C.bold + C.orange : C.bold + C.white) + k.ch + C.reset;
    }
    let out = '';
    for (let i = 0; i < width; i++) out += buf[i] === null ? ' ' : buf[i];
    return out.replace(/\s+$/, '');
  };

  line.draw(frame(0)); await sleep(600);
  for (let f = 1; f <= LAST; f++) { line.draw(frame(f)); await sleep(FRAME_MS); }
  line.draw(frame(LAST + 8)); await sleep(450);
  line.finish();
}

// ================================ shared outro ==============================
// one knob for how fast the text types — raise it to speed everything up
const TYPE_SPEED = 2.8;
// beat between sections so each one can be read before the next arrives
const SECTION_PAUSE = 750;

async function typeLine(res, segs, cps) {
  const line = makeLine(res, false);
  const total = segs.reduce((n, s) => n + s.t.length, 0);
  for (let shown = 1; shown <= total; shown++) {
    let out = '', count = 0;
    for (const s of segs) {
      if (count >= shown) break;
      const take = Math.min(s.t.length, shown - count);
      out += (s.c || '') + s.t.slice(0, take) + C.reset;
      count += take;
    }
    line.draw(out);
    await sleep(1000 / (cps * TYPE_SPEED));
  }
  line.finish();
}

// ------------------------- live GitHub stats -------------------------------
// same numbers the site pulls from the GitHub API, cached 10 min so a burst of
// curls can't blow the 60/hr unauthenticated rate limit
let statsCache = null, statsAt = 0;
async function getStats() {
  if (statsCache && Date.now() - statsAt < 600000) return statsCache;
  try {
    const h = { 'User-Agent': 'rhl.sh-terminal' };
    const [u, repos, events] = await Promise.all([
      fetch('https://api.github.com/users/chambres', { headers: h }).then((r) => r.json()),
      fetch('https://api.github.com/users/chambres/repos?per_page=100', { headers: h }).then((r) => r.json()),
      fetch('https://api.github.com/users/chambres/events/public?per_page=100', { headers: h }).then((r) => r.json()),
    ]);
    if (!Array.isArray(repos)) throw new Error('rate limited');
    const langs = {};
    for (const r of repos) if (r.language) langs[r.language] = (langs[r.language] || 0) + 1;
    const tot = Object.values(langs).reduce((a, b) => a + b, 0) || 1;
    statsCache = {
      repos: u.public_repos,
      followers: u.followers,
      stars: repos.reduce((n, r) => n + (r.stargazers_count || 0), 0),
      events: Array.isArray(events) ? events.length : 0,
      langs: Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([n, c]) => [n, Math.round((c / tot) * 100)]),
    };
    statsAt = Date.now();
  } catch (e) {
    statsCache = null; // the section is simply skipped if GitHub is unreachable
  }
  return statsCache;
}

// ------------- résumé text, one source shared with the website -------------
// Tries the live site first so the site and this share one file; falls back to
// the local copy until data/resume.json is committed to the repo.
let resumeCache = null, resumeAt = 0;
async function getResume() {
  if (resumeCache && Date.now() - resumeAt < 600000) return resumeCache;
  try {
    const r = await fetch('https://rhl.sh/data/resume.json',
      { headers: { 'User-Agent': 'rhl.sh-terminal' } });
    if (!r.ok) throw new Error('not deployed yet');
    resumeCache = await r.json();
  } catch (e) {
    resumeCache = JSON.parse(
      require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'resume.json'), 'utf8'));
  }
  resumeAt = Date.now();
  return resumeCache;
}

// ---------------- projects, loaded live from the site's own JSON -----------
// same file the site reads, so adding a project to data/projects.json shows up
// here on the next curl with no change to this server
let projCache = null, projAt = 0;
async function getProjects() {
  if (projCache && Date.now() - projAt < 600000) return projCache;
  try {
    const r = await fetch('https://rhl.sh/data/projects.json',
      { headers: { 'User-Agent': 'rhl.sh-terminal' } });
    const j = await r.json();
    if (!Array.isArray(j)) throw new Error('bad json');
    projCache = j;
    projAt = Date.now();
  } catch (e) {
    projCache = null; // section is skipped if the site is unreachable
  }
  return projCache;
}

// soft-wrap a long string to `w` columns, returning an array of lines
function wrap(s, w) {
  const out = [];
  let cur = '';
  for (const word of s.split(' ')) {
    if ((cur + ' ' + word).trim().length > w) { out.push(cur.trim()); cur = word; }
    else cur += ' ' + word;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// print whole lines with a small stagger — per-character typing would make a
// full résumé take minutes
async function printLines(res, lines, per = 30) {
  for (const l of lines) { res.write(l + '\n'); await sleep(per); }
}
// A 3-row mini font for section headings. Small on purpose — banner fonts eat
// the whole screen, and the resume is the point.
const GLYPH = {
  A: ['╭─╮', '├─┤', '╵ ╵'], B: ['│─╮', '│─┤', '│─╯'], C: ['╭─╴', '│  ', '╰─╴'],
  D: ['│─╮', '│ │', '│─╯'], E: ['╭──', '├─ ', '╰──'], F: ['╭──', '├─ ', '╵  '],
  G: ['╭─╴', '│ ╮', '╰─╯'], H: ['╷ ╷', '├─┤', '╵ ╵'], I: ['─┬─', ' │ ', '─┴─'],
  J: ['──┬', '  │', '╰─╯'], K: ['╷ ╷', '├─╯', '╵ ╵'], L: ['╷  ', '│  ', '╰──'],
  M: ['┌┬┐', '│││', '╵╵╵'], N: ['╭╮╷', '│╰┤', '╵ ╵'], O: ['╭─╮', '│ │', '╰─╯'],
  P: ['╭─╮', '├─╯', '╵  '], Q: ['╭─╮', '│ │', '╰─╴'], R: ['╭─╮', '├┬╯', '╵╰╴'],
  S: ['╭─╴', '╰─╮', '╰─╯'], T: ['─┬─', ' │ ', ' ╵ '], U: ['╷ ╷', '│ │', '╰─╯'],
  V: ['╷ ╷', '│ │', ' ╰ '], W: ['╷╷╷', '│││', '╰┴╯'], X: ['╷ ╷', '╶┼╴', '╵ ╵'],
  Y: ['╷ ╷', '╰┬╯', ' ╵ '], Z: ['╶─╮', ' ╭╯', '╰─╴'], ' ': ['  ', '  ', '  '],
};
function artHead(text, colour) {
  const rows = ['', '', ''];
  for (const ch of text.toUpperCase()) {
    const g = GLYPH[ch] || GLYPH[' '];
    for (let i = 0; i < 3; i++) rows[i] += g[i] + ' ';
  }
  return rows.map((r) => '  ' + (colour || C.orange) + r.replace(/\s+$/, '') + C.reset);
}
const HEAD = (t) => '  ' + C.bold + C.white + t + C.reset;
// pad to 40 so even the longest row stays inside 80 columns
const ROW = (l, r) => '  ' + C.white + l + C.reset
  + ' '.repeat(Math.max(1, 40 - l.length)) + C.gray + r + C.reset;
const BUL = (t) => '    ' + C.green + '• ' + C.reset + C.gray + t + C.reset;
const CONT = (t) => '      ' + C.gray + t + C.reset; // wrapped bullet, no marker
const TAGS = (t) => '    ' + C.cyan + t.map((x) => '[' + x + ']').join(' ') + C.reset;

// Content mirrors what's actually coded on rhl.sh — the about blurb and the
// HEBPath copy are verbatim from index.html, the links are its real nav, and
// the recent list comes from data/projects.json.
async function outro(res) {
  const stats = getStats();       // kick the network fetches off now,
  const projects = getProjects(); // await them once the resume has printed
  const cv = await getResume();   // all resume text comes from data/resume.json

  // The JSON carries inline markup so the website can bold the lead-in of each
  // bullet and highlight its stat. Here **bold** becomes white and __stat__
  // becomes orange — same emphasis, different medium.
  // Expand the markup into one {ch, colour} per character. Doing it at the
  // character level is what lets a bullet wrap mid-emphasis without either
  // losing text or leaking a marker onto the screen.
  const charStyles = (s, base) => {
    const out = [];
    const push = (txt, c) => { for (const ch of txt) out.push({ ch, c }); };
    const re = /(\*\*[^*]+\*\*|__[^_]+__)/g;
    let last = 0, m;
    while ((m = re.exec(s))) {
      if (m.index > last) push(s.slice(last, m.index), base);
      push(m[0].slice(2, -2), m[0].startsWith('**') ? C.bold + C.white : C.orange);
      last = m.index + m[0].length;
    }
    if (last < s.length) push(s.slice(last), base);
    return out;
  };

  // word-wrap the styled characters, re-emitting colour codes per line
  const wrapStyled = (chars, width) => {
    const rows = [];
    let line = [], lastSpace = -1;
    for (const c of chars) {
      line.push(c);
      if (c.ch === ' ') lastSpace = line.length - 1;
      if (line.length > width) {
        const cut = lastSpace > 0 ? lastSpace : line.length - 1;
        rows.push(line.slice(0, cut));
        line = line.slice(lastSpace > 0 ? cut + 1 : cut);
        lastSpace = -1;
        for (let i = 0; i < line.length; i++) if (line[i].ch === ' ') lastSpace = i;
      }
    }
    if (line.length) rows.push(line);
    return rows.map((r) => {
      let out = '', cur = null;
      for (const { ch, c } of r) { if (c !== cur) { out += C.reset + c; cur = c; } out += ch; }
      return out + C.reset;
    });
  };

  // a dated entry: heading row, bullets (soft-wrapped), then its tags
  const entry = (e) => {
    const left = e.title;
    const right = e.meta || '';
    // keep every row inside 80 columns. ROW pads the title out to col 40, so
    // the real width is that padding plus the meta — not just the two lengths
    const rowWidth = 2 + Math.max(left.length + 1, 40) + right.length;
    // a card with no dates and only label/value rows (the skills block) would
    // just repeat its section heading — skip the title row there
    const out = (!right && e.rows) ? []
      : (rowWidth > 78)
      ? [...wrap(left, 76).map((w) => '  ' + C.white + w + C.reset),
         ...(right ? ['  ' + C.gray + right + C.reset] : [])]
      : [ROW(left, right)];
    if (e.subtitle) for (const w of wrap(e.subtitle, 68)) out.push('    ' + C.gray + w + C.reset);
    for (const b of e.bullets || []) {
      const styled = wrapStyled(charStyles(b, C.gray), 66);
      out.push(BUL(styled[0]));
      for (const s of styled.slice(1)) out.push(CONT(s));
    }
    for (const r of e.rows || []) {
      // the label sits on the same line, so it eats into the wrap width
      const pre = '    ' + r.label + ': ';
      const ws = wrap(r.value, Math.max(30, 77 - pre.length));
      out.push('    ' + C.cyan + r.label + ':' + C.reset + ' ' + C.gray + ws[0] + C.reset);
      for (const w of ws.slice(1)) out.push(' '.repeat(pre.length) + C.gray + w + C.reset);
    }
    if (e.tags) out.push(TAGS(e.tags.map((t) => t.toLowerCase())));
    return out;
  };

  res.write('\n');
  for (const w of wrap(cv.about, 62)) {
    await typeLine(res, [{ t: '  ' + w, c: C.gray }], 130);
  }

  const intro = ['', ...artHead("what i'm working on"), '',
    '  ' + C.bold + C.white + cv.workingOn.title + C.reset];
  for (const w of wrap(cv.workingOn.description, 66)) {
    intro.push('    ' + C.gray + w + C.reset);
  }
  await printLines(res, intro);
  await sleep(SECTION_PAUSE);

  // one section at a time, with a beat in between so it can be read
  for (const sec of cv.sections || []) {
    const block = ['', ...artHead(sec.heading), ''];
    (sec.items || []).forEach((e, i) => { if (i) block.push(''); block.push(...entry(e)); });
    // the resume lists a couple of projects; the rest live on the site. Count
    // comes from projects.json so it stays right as projects are added.
    if (/^projects$/i.test(sec.heading)) {
      const projs = await projects;
      block.push('', '  ' + C.gray + (projs ? 'all ' + projs.length : 'the rest')
        + ' → ' + C.reset + C.orange + 'rhl.sh/projects.html' + C.reset);
    }
    await printLines(res, block);
    await sleep(SECTION_PAUSE);
  }

  const s = await stats;
  if (s) {
    await printLines(res, ['', ...artHead('github'),
      '  ' + C.gray + '@chambres' + C.reset, '',
      '  ' + C.bold + C.orange + String(s.repos) + C.reset + C.gray + ' repositories    ' + C.reset
        + C.bold + C.orange + String(s.stars) + C.reset + C.gray + ' stars earned    ' + C.reset
        + C.bold + C.orange + String(s.followers) + C.reset + C.gray + ' followers    ' + C.reset
        + C.bold + C.orange + String(s.events) + C.reset + C.gray + ' recent events' + C.reset,
      '  ' + s.langs.map(([n, p]) => C.white + n + C.reset + C.gray + ' ' + p + '%' + C.reset).join('   '),
    ]);
  }

  await printLines(res, [''], 0);
  for (const [l, v] of [
    ['  projects   ', 'https://rhl.sh/projects.html'],
    ['  github     ', 'https://github.com/chambres'],
    ['  linkedin   ', 'https://linkedin.com/in/rahulsaravanakumar'],
    ['  resume     ', 'https://rhl.sh/resume.pdf'],
  ]) await typeLine(res, [{ t: l, c: C.cyan }, { t: v, c: C.white }], 150);
  res.write('\n');
  await typeLine(res, [{ t: '  the pretty version → ', c: C.gray },
    { t: 'https://rhl.sh', c: C.orange }], 120);
  res.write('\n');
}

// ================================== routes =================================
// /vN   — in line: runs below your command, nothing above is touched
// /vNb  — clears the command line outright, then plays there
const VERSIONS = {
  '/v1': ['every letter migrates to its slot in the name', migration(FULL, BORN_FULL, 500, 80, 85)],
  '/v2': ['crossfade anchored on rhl — it survives, the name grows out of it', v2],
  '/v3': ['rhl survives whole — curl lends only its u (tinted)',
    migration(FULL, BORN_V3, 700, 110, 90, MOVES_V3, true)],
};

const PORT = 7878;
http.createServer(async (req, res) => {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  const url = req.url.replace(/\/$/, '') || '/';

  if (!/curl|wget|httpie|powershell/.test(ua)) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<pre style="font:15px monospace;padding:2rem">terminal versions:\n\n'
      + Object.entries(VERSIONS).map(([p, [d]]) =>
        '  curl localhost:' + PORT + p + '   ' + d).join('\n')
      + '\n\nadd b to clear the screen and play on a blank terminal:\n\n'
      + Object.keys(VERSIONS).map((p) =>
        '  curl localhost:' + PORT + p + 'b').join('\n')
      + '</pre>');
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
  let closed = false;
  req.on('close', () => { closed = true; });
  const w = res.write.bind(res);
  res.write = (c) => (closed ? false : w(c));

  try {
    // /v2  — in line, below your command
    // /v2b — clears the screen, then plays there
    const clears = /b$/.test(url);
    const base = clears ? url.slice(0, -1) : url;

    if (!VERSIONS[base]) {
      res.write('\n' + C.bold + C.white + '  every version, in the order we built them' + C.reset + '\n\n');
      for (const [p, [d]] of Object.entries(VERSIONS)) {
        res.write('  ' + C.orange + ('curl localhost:' + PORT + p).padEnd(26) + C.reset
          + C.gray + d + C.reset + '\n');
        await sleep(80);
      }
      res.write('\n' + C.gray + '  those run in line — nothing above is touched.'
        + C.reset + '\n' + C.gray + '  add ' + C.reset + C.bold + C.white + 'b' + C.reset
        + C.gray + ' to clear the screen and play on a blank terminal:  ' + C.reset
        + C.orange + 'curl localhost:' + PORT + '/v2b' + C.reset + '\n\n');
      return res.end();
    }

    const [, fn] = VERSIONS[base];
    await sleep(350);
    if (clears) {
      res.write('\x1b[2J\x1b[H\n'); // blank screen, cursor home
      await fn(makeLine(res, false));
    } else {
      res.write('\n');
      await fn(makeLine(res, false));
    }
    await outro(res);
    res.end();
  } catch (e) {
    if (!closed) res.end();
  }
}).listen(PORT, () => console.log('→ curl localhost:' + PORT));
