# Draw Road Rush (YouTube Playables 試作版)

線を1本描くと、その上を車が走る物理パズル。縦画面・指1本・文字ほぼなし。

## 動かし方

```
npm run serve      # http://localhost:5173/ で遊べる
npm run verify     # 全ステージを自動で走らせて検証（手作り10面＋その後の20面）
npm run build      # dist/draw-road-rush-playables.zip を作成（サイズ上限チェック付き）
node tools/inspect-level.mjs 8     # 1ステージの挙動を詳しく見る（設計用）
node tools/inspect-level.mjs 11 2  # ロングステージの2区間目
```

開発用URLパラメータ（YouTube外でのみ有効）: `?level=5`（面を指定）、`?auto=1`（お手本の線で自動プレイ）、`?reset=1`（セーブ消去）

## ステージ構成

- **1〜10面:** 手作り（チュートリアル → ジャンプ → スキージャンプ）
- **11面以降:** 自動生成（終わりなし）。50面にかけてインクが厳しくなり、難しい仕掛けが増える
- **ロングステージ:** 11, 15, 19… と4面ごと。3区間（30面〜4区間、50面〜5区間）を緑の旗（チェックポイント）でつなぐ。区間ごとに線を引き、失敗したらその区間から再開。星は各区間に1つずつ
- **仕掛け:** 橋渡し / 柱越え / トゲの谷 / 浮島 / 急降下 / ジャンプ台（インク不足で飛ぶしかない）/ トンネル（岩の天井とトゲの間を低く通す）

## 構成

| ファイル | 役割 |
|---|---|
| `game/index.html`, `style.css` | 画面とHUD。Playables SDKを最初に読み込む |
| `game/src/sim.js` | 物理（planck.js）とルール（勝ち負け判定・星）。DOMなしでNodeでも動く |
| `game/src/levels.js` | 手作り10面＋無限の自動生成（ロングステージ含む）。生成した区間は実際に走らせて合格したものだけ採用 |
| `game/src/main.js` | 描く→走る→結果→次へ の流れ、広告、セーブ、一時停止 |
| `game/src/render.js` | 描画（画像ファイルなし、全部コードで描画） |
| `game/src/audio.js` | 効果音（WebAudioで合成、音声ファイルなし） |
| `game/src/platform.js` | YouTube Playables SDKの薄いラッパー（YouTube外ではlocalStorageとダミー広告） |

## ステージの品質保証

`npm run verify` は各面の各区間について次を確認する:
- お手本の線でクリアできる
- お手本の線がインク量に収まる
- 線なしではクリアできない
- 手ブレした線（12パターン）でも60%以上クリアできる

さらにステージ全体を、チェックポイントでの停車も含めて1つの世界で通しで走らせ、クリアと星の全取得を確認する。
星の位置は、お手本の線で走った車の軌道上に自動で配置される。ゲーム内の生成も同じ基準（ブレた線6本中5本以上クリア）で合格した区間だけを使う。

## Playables要件への対応

- [x] SDKをゲームコードより先に読み込み / `firstFrameReady` → `loadData` 完了 → `gameReady`
- [x] セーブは `saveData` のみ（クリア時・一時停止時）、`loadData` 完了前は保存しない
- [x] `onPause`/`onResume` でループと音を停止・再開（Page Visibility APIは不使用）
- [x] `isAudioEnabled`/`onAudioEnabledChange` に従う。ゲーム内ミュートボタンなし
- [x] 終了ボタン・外部リンク・シェア誘導・課金なし。広告はYouTube提供のもののみ
- [x] タッチとマウス両対応、全アスペクト比対応、画面サイズ変更で状態維持、Escでモーダルを閉じる
- [x] 初回バンドル455KiB（推奨15MiB未満）、全ファイル512KiB未満
- [x] 言語は `getLanguage` で英語/日本語を切り替え
- [x] 広告: 報酬型（ヒント、インク+50%）、インタースティシャル（3面ごと）
- [ ] 公開前に `game/src/main.js` の `ALL_LEVELS_OPEN` を `false` にする（今は試作用に全ステージをメニューから選べる）
- [ ] サムネイル（1:1, 5:7, 16:9）と16:9紹介動画
- [ ] 実機（Android/iOSのYouTubeアプリ）での動作確認、Playables公式テストスイート
- [ ] 公開はパブリッシャー経由（Playgama / Mediacube など）
