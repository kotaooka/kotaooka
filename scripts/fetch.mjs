// GitHub の REST API から公開リポジトリ・言語・コミットを集め、data.json に書く
// 使い方: GITHUB_TOKEN=... node scripts/fetch.mjs
// GitHub Actions では GITHUB_TOKEN が自動で入る（依存パッケージなし、Node 20 以上）
import { readFile, writeFile } from "node:fs/promises";

const config = JSON.parse(await readFile(new URL("../profile.config.json", import.meta.url), "utf8"));
const OWNER = config.owner;
const TOKEN = process.env.GITHUB_TOKEN || "";
const API = "https://api.github.com";

// API を 1 回呼ぶ。空のリポジトリ（409）は null を返す
async function call(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": `${OWNER}-profile`,
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {})
    }
  });
  if (res.status === 409) return { body: null, next: null };
  if (!res.ok) throw new Error(`${res.status} ${url}\n${await res.text()}`);
  const link = res.headers.get("link") || "";
  const next = (link.match(/<([^>]+)>;\s*rel="next"/) || [])[1] || null;
  return { body: await res.json(), next };
}

// ページ送りをたどって全件を集める
async function callAll(path) {
  let url = API + path, out = [];
  while (url) {
    const { body, next } = await call(url);
    if (!body) break;
    out = out.concat(body);
    url = next;
  }
  return out;
}

// 公開・自作（フォークでない）のリポジトリ。プロフィール用のこのリポジトリは数えない
const repos = (await callAll(`/users/${OWNER}/repos?type=owner&per_page=100`))
  .filter(r => !r.fork && !r.private && r.name.toLowerCase() !== OWNER.toLowerCase())
  .map(r => ({ name: r.name, archived: r.archived, createdAt: r.created_at, pushedAt: r.pushed_at, language: r.language }));

const languages = {};
const commits = [];
for (const r of repos) {
  if (!r.archived) languages[r.name] = (await call(`${API}/repos/${OWNER}/${r.name}/languages`)).body || {};
  // 本人が書いたコミットだけ（Actions のボットなどは入れない）
  const list = await callAll(`/repos/${OWNER}/${r.name}/commits?author=${OWNER}&per_page=100`);
  for (const c of list) {
    commits.push({
      repo: r.name,
      date: c.commit.author.date,
      message: (c.commit.message || "").split("\n")[0]
    });
  }
}

// プロフィール画像。画像の中からは外部の画像を読めないので、データとして埋め込む
const user = (await call(`${API}/users/${OWNER}`)).body;
const avRes = await fetch(`${user.avatar_url}${user.avatar_url.includes("?") ? "&" : "?"}s=160`);
const avatar = avRes.ok
  ? `data:${avRes.headers.get("content-type") || "image/png"};base64,${Buffer.from(await avRes.arrayBuffer()).toString("base64")}`
  : "";

// 入口ページ（QC Workbench）からツール一覧と図を取り出す元の HTML
const portalRes = await fetch(config.portalSource);
if (!portalRes.ok) throw new Error(`${portalRes.status} ${config.portalSource}`);
const portalHtml = await portalRes.text();

await writeFile(
  new URL("../data.json", import.meta.url),
  JSON.stringify({ generatedAt: new Date().toISOString(), avatar, repos, languages, commits, portalHtml }, null, 1)
);
console.log(`repos ${repos.length} / commits ${commits.length}`);
