// data.json から README.md と assets/ の SVG を作る（依存パッケージなし）
// 使い方: node scripts/render.mjs
// 色・字体は QC Workbench の DESIGN.md に合わせる
import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const config = JSON.parse(await readFile(new URL("profile.config.json", root), "utf8"));
const data = JSON.parse(await readFile(new URL("data.json", root), "utf8"));

// ===== 色（DESIGN.md 1.1・1.3） =====
const THEMES = {
  light: {
    bg: "#eef1f4", surface: "#ffffff", ink: "#15212c", ink2: "#475563", muted: "#74818e",
    line: "#d5dce3", grid: "#e4e9ee", accent: "#1d5c96", accentWeak: "#e1ebf5",
    figWeak: "rgba(29,92,150,.14)", series: ["#2a78d6", "#eb6834", "#1baf7a", "#8c5bd6"]
  },
  dark: {
    bg: "#11161b", surface: "#19212a", ink: "#e6ecf2", ink2: "#a9b5c1", muted: "#7d8996",
    line: "#2b3641", grid: "#253039", accent: "#6ba6df", accentWeak: "#1c2f43",
    figWeak: "rgba(107,166,223,.16)", series: ["#3987e5", "#d95926", "#199e70", "#a07ae0"]
  }
};
// 画像の中では Web フォントを読めないので、端末にある字体を順に使う（Windows は BIZ UDPゴシック）
const F_UI = `'BIZ UDPGothic','Hiragino Sans','Yu Gothic UI','Meiryo','Noto Sans CJK JP',system-ui,sans-serif`;
const F_NUM = `'IBM Plex Mono',ui-monospace,Consolas,'SFMono-Regular',monospace`;

// ===== 文字まわり =====
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// 文字幅の見積もり（和文は 1em、英数字は字体に合わせて約 0.55〜0.62em）
function textWidth(s, size, mono = false) {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c >= 0x2e80 || (c >= 0xff00 && c <= 0xffef)) w += 1;
    else if (mono) w += 0.6;
    else if (ch === " ") w += 0.3;
    else if (/[A-Z0-9]/.test(ch)) w += 0.6;
    else w += 0.5;
  }
  return w * size;
}
// 幅に収まらなければ末尾を「…」にする
function clip(s, size, max, mono = false) {
  if (textWidth(s, size, mono) <= max) return s;
  const chars = [...s];
  while (chars.length && textWidth(chars.join("") + "…", size, mono) > max) chars.pop();
  return chars.join("") + "…";
}
// 幅で折り返す（最大 lines 行。あふれた最終行は「…」）
function wrap(s, size, max, lines) {
  const out = [];
  let cur = "";
  for (const ch of s) {
    if (textWidth(cur + ch, size) > max) {
      // 行頭に句読点を置かない
      if (/[、。，．）」』]/.test(ch)) { cur += ch; continue; }
      out.push(cur); cur = ch;
    } else cur += ch;
  }
  if (cur) out.push(cur);
  if (out.length > lines) {
    out.length = lines;
    out[lines - 1] = clip(out[lines - 1] + "…", size, max).replace(/……$/, "…");
  }
  return out;
}

// ===== 日付（JST） =====
const toJst = iso => new Date(new Date(iso).getTime() + 9 * 3600e3);
const ymd = iso => toJst(iso).toISOString().slice(0, 10);
const hm = iso => toJst(iso).toISOString().slice(11, 16);
const now = data.generatedAt;
const daysAgo = iso => (new Date(now) - new Date(iso)) / 86400e3;

// ===== QC Workbench の入口ページからツール一覧と図を取り出す =====
function loadPortal(html) {
  const start = html.indexOf("const groups");
  const end = html.indexOf("// ===== 表示テーマ");
  if (start < 0 || end < 0) throw new Error("入口ページの tools 配列が見つかりません");
  const ctx = vm.createContext({ Math });
  vm.runInContext(html.slice(start, end) + "\n;globalThis.__out = { groups, tools, figs };", ctx, { timeout: 2000 });
  return ctx.__out;
}
const { groups, tools, figs } = loadPortal(data.portalHtml);
const repoOf = t => t.repo.replace(/\/+$/, "").split("/").pop();
const toolByRepo = Object.fromEntries(tools.map(t => [repoOf(t).toLowerCase(), t]));
const nameOfRepo = r => r.toLowerCase() === `${config.owner}.github.io`.toLowerCase()
  ? "QC Workbench" : (toolByRepo[r.toLowerCase()]?.name || r);

// 入口ページの図（CSS 変数を使っている）を、画像の中で使える実際の色に置き換える
function figSvg(key, t) {
  const f = figs[key];
  if (!f) return "";
  return f.call(figs)
    .replaceAll("var(--fig-weak)", t.figWeak)
    .replaceAll("var(--panel)", t.surface)
    .replaceAll('"var(--f-num)"', `"${F_NUM}"`);
}

// ===== 動きの共通部品 =====
// 方眼。1 マスぶんずらして繰り返すので、継ぎ目なく流れて見える
function driftGrid(id, x, y, w, h, cell, color, opacity, sec) {
  let d = "";
  for (let gx = 0; gx <= w + cell; gx += cell) d += `M${gx} 0V${h + cell}`;
  for (let gy = 0; gy <= h + cell; gy += cell) d += `M0 ${gy}H${w + cell}`;
  return `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/></clipPath>
<g clip-path="url(#${id})"><g transform="translate(${x} ${y})"><path class="drift" style="animation-duration:${sec}s;--c:${-cell}px" d="${d}" stroke="${color}" stroke-opacity="${opacity}"/></g></g>`;
}
const MOTION_CSS = `
.drift{animation:drift linear infinite}
@keyframes drift{to{transform:translate(var(--c),var(--c))}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}`;

// ===== ツールの行（入口ページの一覧と同じ並び・図・文言） =====
function toolRow(tool, t, dateLabel, index = 0) {
  const W = 840, H = 120, fx = 20, fy = 16, tx = 176, avail = W - tx - 48;
  const desc = wrap(tool.desc, 13.5, avail, 2);
  let tagX = tx, tags = "";
  for (const s of tool.std || []) {
    const jp = /[　-鿿]/.test(s);
    const w = textWidth(s, 11.5, !jp) + 16;
    if (tagX + w > tx + avail) break;
    tags += `<rect x="${tagX}" y="${H - 34}" width="${w.toFixed(1)}" height="20" rx="4" fill="none" stroke="${t.line}"/>
<text x="${(tagX + 8).toFixed(1)}" y="${H - 20}" font-size="11.5" fill="${t.muted}" font-family="${jp ? F_UI : F_NUM}">${esc(s)}</text>`;
    tagX += w + 6;
  }
  const extra = [tool.android ? "Android版あり" : "", dateLabel || ""].filter(Boolean).join(" / ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(tool.name)}：${esc(tool.desc)}">
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="10" fill="${t.surface}" stroke="${t.line}"/>
<style>${MOTION_CSS}
.glint{animation:glint 5s ${(index * 0.8).toFixed(1)}s ease-in-out infinite;opacity:0}
@keyframes glint{0%{transform:translateY(-40px);opacity:0}8%{opacity:1}30%{transform:translateY(${H}px);opacity:0}100%{transform:translateY(${H}px);opacity:0}}
</style>
<clipPath id="stripe"><path d="M.5 10.5a10 10 0 0 1 3-7V${H - 3.5}a10 10 0 0 1-3-7Z"/></clipPath>
<path d="M.5 10.5a10 10 0 0 1 3-7V${H - 3.5}a10 10 0 0 1-3-7Z" fill="${t.accent}"/>
<g clip-path="url(#stripe)"><rect class="glint" x="0" y="0" width="4" height="40" fill="${t === THEMES.dark ? "#d6e8fa" : "#9cc6ee"}"/></g>
<rect x="${fx}" y="${fy}" width="132" height="88" rx="6" fill="${t.bg}"/>
${driftGrid("fg", fx, fy, 132, 88, 11, t.grid, t === THEMES.dark ? .8 : 1, 6)}
<svg x="${fx}" y="${fy}" width="132" height="88" viewBox="0 0 132 88" overflow="visible"><g color="${t.accent}">${figSvg(tool.fig, t)}</g></svg>
<g font-family="${F_UI}">
  <text x="${tx}" y="36" font-size="18" font-weight="700" fill="${t.ink}">${esc(clip(tool.name, 18, avail - textWidth(extra, 11.5) - 16))}</text>
  <text x="${W - 24}" y="36" font-size="11.5" fill="${t.muted}" text-anchor="end">${esc(extra)}</text>
  ${desc.map((l, i) => `<text x="${tx}" y="${58 + i * 19}" font-size="13.5" fill="${t.ink2}">${esc(l)}</text>`).join("")}
  ${tags}
</g>
<path d="M${W - 26} ${H / 2 + 6}l6 -6l-6 -6" fill="none" stroke="${t.muted}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 6)"/>
</svg>`;
}

// ===== QC Workbench の行（入口ページのロゴ・見出しの一文・ツール名を並べる） =====
const portalLead = ((data.portalHtml.match(/<p class="lead">([^<]+)<\/p>/) || [])[1] || "").trim();
function portalRow(t) {
  const W = 840, H = 140, px = 20, py = 16, pw = 132, ph = H - 32, tx = 176, avail = W - tx - 48;
  const count = k => tools.filter(x => x.section === k).length;
  const names = clip(tools.map(x => x.name).join("、"), 13, avail);
  let tagX = tx, tags = "";
  for (const [k, g] of Object.entries(groups)) {
    const label = `${g.title} ${count(k)}`;
    const w = textWidth(label, 11.5) + 16;
    tags += `<rect x="${tagX}" y="${H - 36}" width="${w.toFixed(1)}" height="20" rx="4" fill="${t.accentWeak}"/>
<text x="${(tagX + 8).toFixed(1)}" y="${H - 22}" font-size="11.5" fill="${t.accent}" font-weight="700">${esc(label)}</text>`;
    tagX += w + 6;
  }
  const mark = t === THEMES.dark ? "#0d1620" : "#ffffff";
  // 左の四角：右から左へ流れ続ける管理図（中心線と管理限界つき）
  const v = [0.15, -0.45, 0.55, -0.1, 0.8, -0.65, 0.3, -0.2, 0.5, -0.85, 0.05, 0.4];
  const sp = pw / v.length, cy = py + ph / 2, amp = ph * 0.3;
  const pts = [...Array(v.length * 2 + 1)].map((_, i) => [px + i * sp + sp / 2, cy - v[i % v.length] * amp]);
  const line = "M" + pts.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("L");
  const dots = pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.6" fill="${t.accent}" stroke="${mark}" stroke-width="1.6"/>`).join("");
  const lim = y => `<line x1="${px}" y1="${y}" x2="${px + pw}" y2="${y}" stroke="${mark}" stroke-opacity=".55" stroke-dasharray="4 3"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="QC Workbench：${esc(portalLead)}">
<style>${MOTION_CSS}
.flow{animation:flow 7s linear infinite}
@keyframes flow{to{transform:translateX(${-pw}px)}}
.sheen{animation:sheen 9s ease-in-out infinite}
@keyframes sheen{0%{transform:translateX(-240px) skewX(-18deg)}35%,100%{transform:translateX(${W + 40}px) skewX(-18deg)}}
</style>
<defs>
  <linearGradient id="sh" x1="0" x2="1"><stop offset="0" stop-color="${t.accent}" stop-opacity="0"/><stop offset=".5" stop-color="${t.accent}" stop-opacity="${t === THEMES.dark ? .12 : .08}"/><stop offset="1" stop-color="${t.accent}" stop-opacity="0"/></linearGradient>
  <linearGradient id="fade" x1="0" x2="1"><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></linearGradient>
  <mask id="gm"><rect width="${W}" height="${H}" fill="url(#fade)"/></mask>
  <clipPath id="card"><rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="10"/></clipPath>
  <clipPath id="panel"><rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="6"/></clipPath>
</defs>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="10" fill="${t.surface}"/>
<g clip-path="url(#card)">
  <g mask="url(#gm)">${driftGrid("pg", 0, 0, W, H, 20, t.grid, 1, 10)}</g>
  <rect class="sheen" x="0" y="-20" width="200" height="${H + 40}" fill="url(#sh)"/>
</g>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="10" fill="none" stroke="${t.accent}"/>
<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="6" fill="${t.accent}"/>
<g clip-path="url(#panel)">
  ${lim(cy)}${lim(cy - amp * 1.15)}${lim(cy + amp * 1.15)}
  <g class="flow"><path d="${line}" fill="none" stroke="${mark}" stroke-width="1.8" stroke-linejoin="round"/>${dots}</g>
</g>
<g font-family="${F_UI}">
  <text x="${tx}" y="40" font-size="20" font-weight="700" fill="${t.ink}">QC Workbench</text>
  <text x="${W - 24}" y="40" font-size="11.5" fill="${t.muted}" text-anchor="end">kotaooka.github.io</text>
  <text x="${tx}" y="64" font-size="13.5" fill="${t.ink2}">${esc(portalLead)}</text>
  <text x="${tx}" y="85" font-size="13" fill="${t.muted}">${esc(names)}</text>
  ${tags}
</g>
<path d="M${W - 26} ${H / 2 + 6}l6 -6l-6 -6" fill="none" stroke="${t.accent}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 6)"/>
</svg>`;
}

// 最近作ったツール（リポジトリの作成日の新しい順）
const repoInfo = tool => data.repos.find(r => r.name.toLowerCase() === repoOf(tool).toLowerCase());
const recent = tools
  .filter(x => repoInfo(x)?.createdAt)
  .sort((a, b) => repoInfo(b).createdAt.localeCompare(repoInfo(a).createdAt))
  .slice(0, config.recentCount);

// ===== 活動の記録（表の形） =====
function sumBy(arr, f) { return arr.reduce((a, x) => a + f(x), 0); }
const mine = data.commits.slice().sort((a, b) => b.date.localeCompare(a.date));
const in30 = mine.filter(c => daysAgo(c.date) <= 30);
const in7 = mine.filter(c => daysAgo(c.date) <= 7);
const firstMonth = mine.length ? ymd(mine[mine.length - 1].date).slice(0, 7) : "";

// 言語ごとの量（アーカイブしたリポジトリは除く）
const langTotals = {};
for (const langs of Object.values(data.languages)) for (const [k, v] of Object.entries(langs)) langTotals[k] = (langTotals[k] || 0) + v;
const langAll = sumBy(Object.values(langTotals), v => v) || 1;
let langs = Object.entries(langTotals).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: k, share: v / langAll }));
if (langs.length > 4) langs = [...langs.slice(0, 4), { name: "その他", share: sumBy(langs.slice(4), l => l.share) }];

// 直近30日の日ごとのコミット数（JST の日付で数える。今日を右端にする）
const today = ymd(now);
const days = [...Array(30)].map((_, i) => {
  const d = new Date(new Date(today + "T00:00:00Z").getTime() - (29 - i) * 86400e3).toISOString().slice(0, 10);
  return { d, n: mine.filter(c => ymd(c.date) === d).length };
});

// 動きを減らす設定のときは動かさない
const REDUCED = `@media (prefers-reduced-motion: reduce){*{animation:none!important}}`;

function stats(t) {
  const W = 840, H = 362, x0 = 24;
  const count = k => tools.filter(x => x.section === k).length;
  const groupColor = { calc: t.series[0], drill: t.series[2], other: t.series[3] };

  // --- 左：直近30日のコミット（日ごとの棒） ---
  const cx = x0, cw = 512, cTop = 132, cBot = 262;
  const max = Math.max(1, ...days.map(d => d.n));
  const step = cw / days.length, bw = step - 4;
  let bars = "";
  days.forEach((d, i) => {
    const x = cx + i * step + 2;
    if (!d.n) { bars += `<rect x="${x.toFixed(1)}" y="${cBot - 2}" width="${bw.toFixed(1)}" height="2" fill="${t.line}"/>`; return; }
    const h = Math.max(3, (cBot - cTop) * d.n / max);
    bars += `<rect class="bar" style="animation-delay:${(i * 0.02).toFixed(2)}s" x="${x.toFixed(1)}" y="${(cBot - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${d.d === today ? t.accent : t.series[0]}" fill-opacity="${d.d === today ? 1 : .55}"${d.d === today ? ' data-today="1"' : ""}/>`;
  });
  const dateLabel = i => days[i].d.slice(5);
  const axis = [0, 14, 29].map(i => `<text x="${(cx + i * step + step / 2).toFixed(1)}" y="${cBot + 20}" font-size="11" font-family="${F_NUM}" fill="${t.muted}" text-anchor="${i === 0 ? "start" : i === 29 ? "end" : "middle"}" ${i === 0 ? `dx="-${(step / 2 - 2).toFixed(1)}"` : i === 29 ? `dx="${(step / 2 - 2).toFixed(1)}"` : ""}>${dateLabel(i)}</text>`).join("");
  const left = `
  <text x="${cx}" y="84" font-size="13" fill="${t.ink2}">直近30日のコミット</text>
  <text x="${cx}" y="118" font-size="32" font-weight="600" font-family="${F_NUM}" fill="${t.ink}">${in30.length}</text>
  <text x="${cx + textWidth(String(in30.length), 32, true) + 12}" y="117" font-size="12.5" fill="${t.muted}">直近7日 <tspan font-family="${F_NUM}">${in7.length}</tspan></text>
  <line x1="${cx}" y1="${cTop}" x2="${cx + cw}" y2="${cTop}" stroke="${t.grid}" stroke-dasharray="3 3"/>
  <text x="${cx + cw}" y="${cTop - 6}" font-size="11" font-family="${F_NUM}" fill="${t.muted}" text-anchor="end">${max}/日</text>
  ${bars}
  <line x1="${cx}" y1="${cBot}" x2="${cx + cw}" y2="${cBot}" stroke="${t.line}"/>
  ${axis}`;

  // --- 右：使っている言語（ドーナツ） ---
  const dx = 628, dy = 190, r = 46, sw = 16;
  let acc = 0, ring = "", legend = "";
  langs.forEach((l, j) => {
    const col = l.name === "その他" ? t.muted : t.series[j % 4];
    const len = l.share * 100;
    ring += `<circle class="seg" style="animation-delay:${(0.3 + j * 0.12).toFixed(2)}s" cx="${dx}" cy="${dy}" r="${r}" pathLength="100" fill="none" stroke="${col}" stroke-width="${sw}" stroke-dasharray="${Math.max(len - 0.6, 0.2).toFixed(2)} 100" stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 ${dx} ${dy})"/>`;
    acc += len;
    const ly = 132 + j * 26;
    legend += `<circle cx="${dx + 66}" cy="${ly - 4}" r="4.5" fill="${col}"/>
<text x="${dx + 78}" y="${ly}" font-size="12.5" fill="${t.ink2}">${esc(l.name)}</text>
<text x="${W - x0}" y="${ly}" font-size="12" font-family="${F_NUM}" fill="${t.muted}" text-anchor="end">${(l.share * 100).toFixed(1)}%</text>`;
  });
  const right = `
  <text x="${dx - r - sw / 2}" y="84" font-size="13" fill="${t.ink2}">使っている言語</text>
  <circle cx="${dx}" cy="${dy}" r="${r}" fill="none" stroke="${t.bg}" stroke-width="${sw}"/>
  ${ring}
  ${legend}`;

  // --- 下：公開中のツール（1 件 1 マス）とこれまでのコミット ---
  const by = 314;
  let cells = "", k = 0, gl = "", glx = x0 + 300;
  for (const [key, g] of Object.entries(groups)) {
    const n = count(key);
    for (let i = 0; i < n; i++, k++) cells += `<rect class="cell" style="animation-delay:${(0.6 + k * 0.04).toFixed(2)}s" x="${x0 + k * 20}" y="${by + 14}" width="16" height="16" rx="3" fill="${groupColor[key] || t.muted}"/>`;
    gl += `<circle cx="${glx}" cy="${by + 22}" r="4.5" fill="${groupColor[key] || t.muted}"/><text x="${glx + 10}" y="${by + 26}" font-size="12" fill="${t.ink2}">${esc(g.title)} <tspan font-family="${F_NUM}" fill="${t.muted}">${n}</tspan></text>`;
    glx += textWidth(`${g.title} ${n}`, 12) + 30;
  }
  const bottom = `
  <line x1="${x0}" y1="${by - 14}" x2="${W - x0}" y2="${by - 14}" stroke="${t.line}"/>
  <text x="${x0}" y="${by + 4}" font-size="13" fill="${t.ink2}">公開中のツール <tspan font-family="${F_NUM}" font-weight="600" fill="${t.ink}">${tools.length}</tspan></text>
  ${cells}${gl}
  <text x="${W - x0}" y="${by + 4}" font-size="13" fill="${t.ink2}" text-anchor="end">これまでのコミット <tspan font-family="${F_NUM}" font-weight="600" fill="${t.ink}">${mine.length}</tspan></text>
  <text x="${W - x0}" y="${by + 26}" font-size="12" fill="${t.muted}" text-anchor="end">${firstMonth} から、${new Set(mine.map(c => c.repo)).size} のリポジトリで</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="活動の記録：直近30日のコミット ${in30.length}、公開中のツール ${tools.length}">
<style>
.bar{transform-box:fill-box;transform-origin:50% 100%;animation:grow .5s cubic-bezier(.2,.7,.2,1) both}
.seg{animation:ring .7s ease-out both}
.cell{animation:pop .3s ease-out both}
[data-today]{animation:grow .5s cubic-bezier(.2,.7,.2,1) both,blink 2.4s 1.2s ease-in-out infinite}
@keyframes blink{50%{opacity:.35}}
@keyframes grow{from{transform:scaleY(0)}}
@keyframes ring{from{stroke-dasharray:0 100}}
@keyframes pop{from{opacity:0}}
${REDUCED}
</style>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="10" fill="${t.surface}" stroke="${t.line}"/>
<g font-family="${F_UI}">
  <text x="${x0}" y="40" font-size="16" font-weight="700" fill="${t.ink}">活動の記録</text>
  <text x="${W - x0}" y="40" font-size="12" fill="${t.muted}" text-anchor="end"><tspan font-family="${F_NUM}">${ymd(now)} ${hm(now)}</tspan> 時点</text>
  <line x1="556" y1="72" x2="556" y2="282" stroke="${t.line}"/>
  ${left}${right}${bottom}
</g>
</svg>`;
}

// ===== 改訂履歴（最近のコミット。同じ日・同じ内容の一括変更は 1 行にまとめる） =====
function history() {
  const groupsMap = new Map();
  for (const c of mine) {
    const key = ymd(c.date) + "|" + c.message;
    if (!groupsMap.has(key)) groupsMap.set(key, { date: ymd(c.date), message: c.message, repos: [] });
    const g = groupsMap.get(key);
    if (!g.repos.includes(c.repo)) g.repos.push(c.repo);
  }
  return [...groupsMap.values()].slice(0, config.historyRows);
}
function historySvg(t) {
  const W = 840, x0 = 24, cDate = x0, cWho = 128, cWhat = 330, rowH = 34, top = 56;
  const rows = history();
  const H = top + 32 + rows.length * rowH + 16;
  let body = `<g font-size="12" fill="${t.muted}">
<text x="${cDate}" y="${top + 21}">日付</text><text x="${cWho}" y="${top + 21}">対象</text><text x="${cWhat}" y="${top + 21}">内容</text></g>
<rect x="${x0}" y="${top}" width="${W - 2 * x0}" height="32" fill="${t.bg}"/>`;
  // 見出し行は背景を敷いてから文字を重ねる
  body = `<rect x="${x0}" y="${top}" width="${W - 2 * x0}" height="32" rx="4" fill="${t.bg}"/>
<g font-size="12" fill="${t.muted}"><text x="${cDate + 10}" y="${top + 21}">日付</text><text x="${cWho}" y="${top + 21}">対象</text><text x="${cWhat}" y="${top + 21}">内容</text></g>`;
  rows.forEach((r, i) => {
    const y = top + 32 + i * rowH;
    const who = r.repos.length > 1 ? `${nameOfRepo(r.repos[0])} ほか ${r.repos.length - 1}` : nameOfRepo(r.repos[0]);
    if (i) body += `<line x1="${x0}" y1="${y}" x2="${W - x0}" y2="${y}" stroke="${t.line}"/>`;
    if (r.date === today) body += `<circle class="live" cx="${cDate + 3}" cy="${y + 17.5}" r="3" fill="${t.accent}"/>`;
    body += `<text x="${cDate + 10}" y="${y + 22}" font-size="12.5" font-family="${F_NUM}" fill="${r.date === today ? t.accent : t.muted}">${r.date}</text>`;
    body += `<text x="${cWho}" y="${y + 22}" font-size="13" font-weight="700" fill="${t.ink}">${esc(clip(who, 13, cWhat - cWho - 16))}</text>`;
    body += `<text x="${cWhat}" y="${y + 22}" font-size="13" fill="${t.ink2}">${esc(clip(r.message, 13, W - x0 - cWhat - 4))}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="最近の更新">
<style>.live{animation:live 1.6s ease-in-out infinite}@keyframes live{50%{opacity:.2}}@media (prefers-reduced-motion: reduce){*{animation:none!important}}</style>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="10" fill="${t.surface}" stroke="${t.line}"/>
<g font-family="${F_UI}">
  <text x="${x0}" y="36" font-size="16" font-weight="700" fill="${t.ink}">最近の更新</text>
  <text x="${W - x0}" y="36" font-size="12" fill="${t.muted}" text-anchor="end">公開リポジトリのコミットから</text>
  ${body}
</g>
</svg>`;
}

// ===== 書き出し =====
const out = new URL("assets/", root);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const files = {};
for (const [mode, t] of Object.entries(THEMES)) {
  files[`stats-${mode}.svg`] = stats(t);
  files[`history-${mode}.svg`] = historySvg(t);
  files[`portal-${mode}.svg`] = portalRow(t);
  for (const [i, tool] of recent.entries()) {
    files[`tool-${repoOf(tool).toLowerCase()}-${mode}.svg`] = toolRow(tool, t, `作成 ${ymd(repoInfo(tool).createdAt)}`, i);
  }
}
for (const [name, svg] of Object.entries(files)) await writeFile(new URL(name, out), svg);

// 画像を明暗で出し分ける（GitHub は <picture> の prefers-color-scheme に従う）
const pic = (base, alt, width = "100%") =>
  `<picture><source media="(prefers-color-scheme: dark)" srcset="./assets/${base}-dark.svg"><img src="./assets/${base}-light.svg" width="${width}" alt="${esc(alt)}"></picture>`;

let md = `<!-- このファイルは scripts/render.mjs が自動で作ります。直接は編集せず、profile.config.json か scripts/ を直してください -->

`;
md += `
<a href="${config.portal}">${pic("portal", `QC Workbench：${portalLead}`)}</a>

### 最近作ったツール

`;
md += recent.map(tool => `<a href="${tool.open}">${pic(`tool-${repoOf(tool).toLowerCase()}`, `${tool.name}：${tool.desc}`)}</a>`).join("\n") + "\n";
md += `
<br>

${pic("stats", "活動の記録")}

${pic("history", "最近の更新")}

`;
await writeFile(new URL("README.md", root), md);
console.log(`svg ${Object.keys(files).length} / tools ${tools.length} / history ${history().length}`);
