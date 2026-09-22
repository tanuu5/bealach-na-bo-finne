# 白き牛の道 — *Bealach na Bó Finne*

ルーナサの夜の星祭。石の環のなかの湖は、常若の国（ティル・ナ・ノーグ）の空を映している。
火に、石に、サンザシに捧げものをするたび、空に星がひとつ生まれる。
湖に刻まれた三つ巴の渦が満ちると、天の川が〈白い牛の道〉となって地上に降り、環をめぐり、火を通って空へ還る。

アイルランドでは天の川を *Bealach na Bó Finne*（白い牛の道）とも呼ぶ。
ルーナサ（8月初頭の収穫祭）は旧暦の七夕とほぼ同じ季節にあたり、ペルセウス座流星群の季節でもある。

**▶ ブラウザで見る: https://tanuu5.github.io/bealach-na-bo-finne/**

## 見る

```bash
open dist/index.html
```

`dist/index.html` は three.js まで含めた単体ファイル（約1.1MB）。
ダブルクリックで開くだけで動く。外部から読み込むのは HUD の Google Fonts だけで、
3D・テクスチャ・音はすべてコード内で生成している（画像・モデル・音声ファイルは一切なし）。

WebGL2 対応ブラウザが必要。**音は最初のクリック／タップで鳴りはじめる**（ブラウザの制約）。左上の「音」ボタンで切り替え。

## 触れる

| 操作 | 起きること |
|---|---|
| **火をクリック** | 火が立ち、火の粉が三つ巴に舞う。一粒が空へ昇って星になる |
| **石をクリック** | オガム文字が下から灯り、金の糸が天の川の星へのびる。石ごとに音程が違う（D ドリアン）|
| **サンザシをクリック** | 願いの布（*ribín*）が結ばれ、光が空へ昇って星になる |
| **湖・空・地面をクリック** | 波紋、流れ星、ラ・テーヌ文様の三つ葉の波紋 |
| **長押し** | 火＝熾火が渦を巻く／石＝糸が震える／サンザシ＝オガムの言葉が垂れる／何もない所＝**帳がひらく**（常若の国が透けて見える）|
| **ドラッグ** | カメラを回す。**日の巡りと同じ向き（時計回り）に一周**すると、8つの石がいっせいに鳴る（*deiseal*）|
| **キー** | `1`–`8` 石、`0` 火、`Space` 帳、`a`–`z` + `Enter` → 打った言葉がオガム文字になって空へ |

放っておくと塚の民（*aos sí*）が代わりに捧げものをするので、何もしなくても祭りは進む。

**クライマックス**は渦が満ちると自動的に始まる（触れていれば1〜2分、放置でも約80秒）。
静寂 → 天の川が柱として立つ → 塚へ降りそそぐ → 環を抜けて湖を三度めぐる → 火を通って空へ還る、で約32秒。
そのあと90秒ほど常若の国の余韻が続き、やがて元の夜に戻る。そこから何度でも繰り返せる。

## 開発

```bash
npm install
npm run dev      # http://localhost:5173/ で index.html（モジュール版）を配信
npm run build    # dist/index.html を再生成
node scripts/shot.mjs --url "index.html?noauto&warm=12&shot" --out shots/x.png   # ヘッドレス撮影＋コンソール検査
```

デバッグ用 URL パラメータ: `?only=sky,loch`（モジュール単体）`?q=low`（低品質パス）`?warm=12`（12秒ぶん先送りして描画）
`?phaseT=20&freezeT`（クライマックスの任意の瞬間で静止）`?climax=1` `?veil=1` `?energy=0.8` `?seed=7` `?noauto` `?nofonts`

## 構成

```
index.html          開発用（importmap で node_modules の three を読む。node_modules が必要）
dist/index.html     単体版（three.js 込み。ダブルクリックで動く／GitHub Pages で配信）
src/core/           描画・入力・音・ポストプロセスの土台（レンダラ、OrbitControls、ブルーム、
                    クリック/長押し判定、Web Audio の音源＝ハープ・鐘・風・バウロン）
src/modules/        9つの機能モジュール
  conductor         音楽の時計と通奏（ドローン、風、水、心拍、和音、クライマックスの譜面）
  sky               空・天の川・星・流星・大気（霧・ブルーム・グレーディングの唯一の管理者）
  terrain           地形・妖精塚・丘・草
  loch              湖（常若の空の魚眼像、星の軌跡、三つ巴の渦）
  fire              火・火の粉・遠い丘の狼煙
  stones            11の立石・オガム・星への糸
  sceach            サンザシ・聖泉・願いの布
  bealach           祭りの進行役とクライマックス（天の川の降下）
  hud               文字まわりすべて
docs/DESIGN.md      作品の設計書（配色・座標・イベント・演出の台本。実装の根拠はすべてここ）
docs/CORE_CONTRACT.md  コアとモジュールの取り決め
```

## 制作について

この作品は **Anthropic の Claude（Claude Opus 5）** が [Claude Code](https://claude.com/claude-code) 上で、
設計・実装・レビュー・修正まで一貫して制作した。
モデル名は制作時の表示に従ったもので、Anthropic が表示名を据え置いたまま改訂版を検証している場合もあるため、
実体が 5.x 系である可能性は排除できない（その意味で「Opus 5（推定）」）。

制作方法は、1人のリードと複数のサブエージェントによる分業である。

| | |
|---|---|
| 進め方 | 設計 → 9モジュールの並行実装 → 4観点レビュー（アート／演出／統合／操作）→ 担当別修正 → 出荷検査 → 不具合修正 |
| ワークフロー実行 | 11 回（利用上限による中断からの再開を含む） |
| エージェント | 起動 74 体（完走 43・失敗 27）。失敗は全件が利用上限によるもの |
| API 呼び出し | 11,001 回（サブエージェント 10,514・リードセッション 487） |
| 消費トークン | 処理 計 **約 25.2 億**（内訳: キャッシュ読み出し 24.5 億／キャッシュ書き込み 6,011 万／生成 805 万／新規入力 2.2 万） |
| API 換算コスト | 約 **$1,800**（≈ 27 万円 @150円）。キャッシュ無しなら $12,800 相当で、約 86% を削減。定額プラン内で実行しており、実際に請求された額ではない |
| 規模 | 実装 18,040 行（src/ の .js 44ファイル）、設計書 [docs/DESIGN.md](docs/DESIGN.md) 1,669 行 |

設計書がすべての根拠になっており、配色・座標・イベント・演出の台本・受け入れ基準まで数値で確定させてから実装している。
検証はヘッドレス Chrome のスクリーンショットとコンソール検査で自動化した（`scripts/shot.mjs`）。

なお最後に見つかった「画面が突然真っ黒になる」不具合は、霧シェーダの `pow(1.0 - vP.y, 1.8)` が
補間誤差で負の底になり NaN を生み、それがブルームのぼかしで全画面に広がるというもので、
ソフトウェアGLのヘッドレス検証では再現せず、実機のブラウザでレンダーターゲットを読み出して特定した。

## ライセンス

MIT License（[LICENSE](LICENSE)）© 2026 たぬ。同梱の three.js も MIT（© 2010–2026 three.js authors）。

## English

**Bealach na Bó Finne** — an interactive Celtic-Otherworld star festival on Lughnasa night, built with Three.js.
A loch inside a stone circle mirrors the sky of Tír na nÓg. Offerings at the fire, the harp-stones and the
rag-tree each kindle a star; when the triple spiral in the water fills, the Milky Way comes down to earth,
circles the fire three times sunwise, and returns to the sky.
Everything — geometry, textures, and the D-Dorian music — is generated in code; there are no asset files.
Click, long-press, drag a full sunwise turn, or type a word to send it to the sky as ogham.
Designed and written end to end by Anthropic's Claude (Claude Opus 5) in Claude Code. MIT licensed.

## クレジット・注意

- [three.js](https://threejs.org/) r186（MIT License, © 2010–2026 three.js authors）
- フォント: Shippori Mincho B1 / Zen Kaku Gothic New / Cormorant Unicase / Noto Sans Ogham（Google Fonts, OFL）
- モチーフはコーク＝ケリー型の環状列石、ニューグレンジ様式の三つ巴と石英の壁、オガム文字、聖泉のぼろ布の木（*clootie tree*）など、実在のアイルランドの事物に基づく。
- **アイルランド語とオガム表記は、公開前にネイティブスピーカーの確認をおすすめします。**
- 音階は D ドリアンのペンタトニックに固定してあるので、どう触れても不協和にならない。
