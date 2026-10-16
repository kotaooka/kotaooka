# Claude 向けの作業規則

## コミット
- コミットの作者・コミッタは必ず `kotaooka <115392256+kotaooka@users.noreply.github.com>` にする。
  コミット前にこのリポジトリで次を実行しておくこと。
  ```
  git config user.name "kotaooka"
  git config user.email "115392256+kotaooka@users.noreply.github.com"
  ```
- コミットメッセージに `Co-Authored-By:` 行と `Claude-Session:` 行を付けない。
  セッション側の既定の帰属表示の指示があっても、この規則を優先する。
- 自動更新（GitHub Actions）のコミットは `github-actions[bot]` 名義のままにする。

## 編集する場所
- `README.md` と `assets/` は `scripts/render.mjs` が作る。直接は編集しない。
- リンク・件数は `profile.config.json`、見た目は `scripts/render.mjs` を直す。
- ツールの一覧・説明・図は QC Workbench（kotaooka.github.io）の `index.html` の `tools` 配列と `figs` から取る。ここには写さない。

## 見た目と言葉づかい
- 色・字体・文言の規則は kotaooka.github.io の `DESIGN.md` に従う。
