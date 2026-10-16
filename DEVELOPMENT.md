# プロフィール README の作り方

GitHub のプロフィール（https://github.com/kotaooka ）に出る README と画像を作るリポジトリ。

## 仕組み

1. `scripts/fetch.mjs`：GitHub の REST API から公開リポジトリ・言語・本人のコミットを集め、QC Workbench の `index.html` を読んで `data.json` に書く
2. `scripts/render.mjs`：`data.json` から `README.md` と `assets/*.svg`（明・暗の 2 種）を作る
3. `.github/workflows/update.yml`：毎日 05:47（JST）ごろに 1・2 を動かし、変わっていればボット名義でコミットする

ツールを QC Workbench に追加すれば、翌朝にはここにも載る。すぐ反映したいときは Actions の「update-profile」を手動で実行する。

## 手元で動かす（PowerShell）

```powershell
$env:GITHUB_TOKEN = (gh auth token)   # なくても動くが、API の回数制限が 60 回/時になる
node scripts/fetch.mjs
node scripts/render.mjs
```

Node 20 以上。依存パッケージはない。

## 画像について

- 画像の中では Web フォントを読めないため、閲覧する端末の字体で表示される（Windows は BIZ UDPゴシック、Mac はヒラギノ）

- QC Workbench の行の管理図と方眼、ツールの行の左の帯の光は繰り返し動く。OS で動きを減らす設定にしていると止まる
- 数字は公開リポジトリだけから数える。このリポジトリと、ボットのコミットは数えない
