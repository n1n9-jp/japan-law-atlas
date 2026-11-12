---
cursor:
  subagentId: "bc-4df76127-d762-50d3-a46d-8b372c20ac50"
---

# 検証で確かめた事実（2026-10-08 UTC 実測）

仕様書の前提になっている事実。実装担当はここに書いた挙動を前提にしてよい。違う挙動に出会ったら、仕様を勝手に変えずに coordinator に報告する。

## e-Gov 法令API v2（`https://laws.e-gov.go.jp/api/2/`）

- `GET laws?limit=1` の `total_count` は 9,576。これは廃止法令などを含む。内訳は `repeal_status=None` が 9,015、`Repeal` 418、`Expire` 38、`LossOfEffectiveness` 105、`Suspend` 0。
- `repeal_status=None` の 9,015 件の `revision_info.current_revision_status` は `CurrentEnforced` 8,924、`PreviousEnforced` 79、`UnEnforced` 12（まだ施行されていない新法）。
- `law_info.law_type` には `Act,CabinetOrder` のような複合値がある（太政官布告など。21件）。
- `revision_info.category` は 1法令に1つで、値は50種類（下に件数）。lawvis の50分野と同じ名前。
- `revision_info.abbrev` はカンマ区切りの略称（例: `失火責任法,失火法`）。2,382件が持つ。
- `laws` は `limit=1000` でページングできる（`next_offset`）。全件取得は約18秒。`asof=2017-04-01` は 8,297 件、`asof=2018-01-01` は 8,370 件を返す。
- `law_data/{law_id または law_revision_id}?law_full_text_format=json&elm=MainProvision-Article_3` は条1つを JSON 木（`{tag, attr, children}`、children は文字列か子ノード）で返す。約0.3秒。`elm=MainProvision-Article_398_2-Paragraph_1` のように項まで絞れる。条のない法令は `elm=MainProvision-Paragraph_1`。
- `law_full_text_format=xml` のときは `law_full_text` が base64 文字列になる。生のXMLが欲しいときは `law_file/xml/{id}` を使う（`application/octet-stream`）。
- 附則は `elm=SupplProvision-Paragraph_1` のように最初の附則の項しか指定できない。`SupplProvision-Article_1`、`SupplProvision_1` などは「要素に合致する要素が存在しません」（code 400021）。改正法由来の附則は API で個別に取れないと考える。
- `law_revision_id` を指定すると、その版の本文が返る（例: `129AC0000000089_20260624_508AC0000000045`）。
- `law_revisions/{law_id}` は未施行の版も含む全版の一覧（民法は37版）。
- `keyword?keyword=…&limit=1000` の `limit` は文の数。`items` は法令ごとにまとまり、各 `sentences[]` は `position`（`caption`、`mainprovision`、`amendsupplprovision` など）と `<span>` で強調された `text` を持つ。「不動産登記」で約20秒かかった。
- CORS: 通常のGETも `OPTIONS` プリフライトも `access-control-allow-origin: *`（`GET,HEAD,POST`、max-age 1800）。ブラウザから直接呼べる。レスポンスに付く CSP ヘッダは呼び出し側のページには影響しない。

## 全法令XMLの一括ダウンロード

- URL: `https://laws.e-gov.go.jp/bulkdownload?file_section=1&only_xml_flag=true`（`all_xml.zip`、約300MB、展開後3.3GB）。ダウンロードは数秒。
- 中身は `all_law_list.csv`（BOM付きUTF-8）と、`{law_revision_id}/{law_revision_id}.xml` が 10,438 個。現行版だけでなく未施行の版も入っている（例: 租税特別措置法施行令は11版）。
- CSV の列: `法令種別, 法令番号, 法令名, 法令名読み, 旧法令名, 公布日, 改正法令名, 改正法令番号, 改正法令公布日, 施行日, 施行日備考, 法令ID, 本文URL, 未施行`。`未施行` が空の行が現行版で、9,005行・9,004法令ID（1件重複）。本文URLの末尾が版IDの後半になる。
- API の施行中 9,015 件との差は約11件。足りない分は API の `law_file/xml/{law_revision_id}` で補う。
- 現行版XMLの合計は 1.18GB。本則の条は 242,823、附則の条は 143,668、本則の項は 508,282、本則の号は 470,613、附則は 160,987 個（うち `AmendLawNum` 属性つき＝改正法由来が 152,132）、別表は 3,801。本則に `Article` がない法令が 1,219。制定文（`EnactStatement`）を持つ法令は 6,847。1法令の条数は中央値9、90パーセンタイル62、99パーセンタイル291、最大1,348。
- 本文中のタグの出現数: `Sup` 30,043、`ArithFormula` 23,006、`StyleStruct` 17,679、`TableStruct` 16,555、`Ruby` 14,171、`List` 10,555、`Sub` 7,533、`QuoteStruct` 7,185、`FigStruct` 1,983。`AmendProvision` はほぼない（2ファイル）。改正の指示は普通の `Sentence` として書かれている。
- 条番号は `Article Num="47_2"`（第四十七条の二）の形。附則は `<SupplProvision AmendLawNum="昭和四四年四月八日政令第八六号" Extract="true">` の形。
- Python の lxml で現行版9,005件を走査すると約10秒。

## 本文の表現の頻度（現行版の全文に対する grep）

- 「以下「X」という」76,613、「以下この条において「X」という」18,893、「以下この項において…」12,051、「以下この号において…」4,212、「以下単に「X」という」1,743、「以下この章において…」1,326、「以下この節において…」1,132。
- 「同法」107,005、「準用する」132,193、「読み替え」44,467、「の例による」69,992、「乃至」515、「（政令|内閣府令|省令|主務省令|規則）で定める」191,987。
- 「…の一部を次のように改正する。」は30、「…を「…」に改める」を含む文は1,707。

## 法令番号つき参照の試作（抽出器の見積り用、Python の正規表現だけ）

- 本則に出てくる「法令名（元号…年…第…号）」は 71,018 件。そのうち 62,990 件が法令番号から法令IDに引けた。他法令への法令ペアは 59,305 組。附則には同じ形が 55,137 件ある。
- 引けなかった番号の多くは、e-Gov に単独で収録されない改正法（例: `令和八年法律第十二号`）。

## lawvis（www.lawvis.info）

- 分野ごとのグラフは `https://www.lawvis.info/data/graphs/{key}.json`。`User-Agent` ヘッダなしだと 403 になる。
- 形式は `{key, label, nodes[{id(=law_id), label, x, y, size, color, degree, lawId, url, categories[]}], edges[[src, tgt]]}`。
- 50分野すべて取れる。ノードは「その分野の法令と、それにつながる法令」で、和集合は 8,685 法令、有向エッジ 113,641（無向にすると 102,972）。
- エッジの向きは「参照する側 → 参照される側」（河川法施行令 → 河川法 はあり、逆はない）。相互に参照し合うペアは 18.8%。
- key の一覧: bouei, bunka, chihoujichi, chihouzaisei, denkitsushin, douro, gaiji, gaikokukawaseboueki, gyouseisoshiki, gyouseitetsuzuki, jigyou, kaiun, kamotsuunsou, kankou, kankyohozen, kasen, keiji, keisatsu, kenchikujutaku, kenpo, kinyuhoken, kokudokaihatsu, kokusai, kokuyuzaisan, kokuzei, kotsukai, kotsukakoumuin, kougyo, kougyo2, kouku, kousei, kyouiku, minji, nougyou, rikuun, ringyou, roudou, saigaitaisaku, sangyotsusoku, shihou, suisangyou, syakaifukushi, syakaihoshou, syoubou, syougyou, tochi, toshikeikaku, toukei, yumu, zaimutsusoku。

## JLaw-CiteGraph（github.com/yabooung/jp-law-citation-graph）

- コードは Apache-2.0、データ（`data/`、release の nodes など）は CC BY 4.0。
- `data/cites_law_to_law.csv`（`src_law_id,src_law,tgt_law_id,tgt_law,n_citations`、70,577行）、`data/laws.csv`（8,998件）、`data/release_stats.json`（e-Gov スナップショット 2026-09-27）。
- 評価用の公開サンプル: `eval/precision_sample.csv`（1,104行。`via, source_law, source_id, source_article, cited_name, resolved_id, ctx_before, ctx_hit, ctx_after, label_O_X` など）と `eval/recall_gold_sample.csv`（505行。注記は韓国語）。
- 略称辞書: `src/jlawcite/jp_abbrev_kit.json`（68件）と `jp_law_aliases.json`（108件）。Apache-2.0 なので出典を書けば使える。
- release_stats: `CITES` 1,417,648、`DELEGATES_TO` 67,666、`REFERS_TO_ATTACHMENT` 37,377、`AMENDS` 117。他法令への参照 526,919。

## Vercel

- MCP から見えるチームは `team_tR0SdGrqjRVReiZNOCkzBGdU`（スコープのスラッグ `n1n9jps-projects`）。dataviz-jp、dataviz-jp-app、book-library などがある。MCP では `teamId` を付けると 403 になり、付けないと通る。
- 既存プロジェクトは `ssoProtection: all_except_custom_domains`。本番エイリアス（例: `dataviz-jp-app.vercel.app`、`book-library-five-ochre.vercel.app`）は認証なしで 200。デプロイ固有URLとチームURL（`*-n1n9jps-projects.vercel.app`）は `vercel.com/sso-api` に 302 で飛ばされる。共有するのは本番エイリアスだけにする。
- `hourei-atlas.vercel.app` は 2026-10-08 時点で 404（未使用）。
- この環境には `VERCEL_TOKEN` がない（シークレットは `ESTAT_APP_ID` と `GH_TOKEN` だけ）。MCP の `create_deployment` と `upload_file` は中身を引数に直接書く必要があり、数十MBのデータは送れない。CLI のデプロイにはトークンが要る。
- `vercel deploy --archive=tgz` を使うと、ファイル数の多いデプロイでも上限に当たりにくい。

## npm の最新版（2026-10-08）

- next 16.4.0、react 19.3.0、deck.gl 9.4.0、@base-ui/react 1.8.0、graphology 0.26.0、graphology-layout-forceatlas2 0.10.1、graphology-communities-louvain 2.0.2、graphology-metrics 2.4.2、graphology-layout-noverlap 0.4.2、d3-contour 4.0.2、htmlparser2 12.0.0、tsx 4.23.15、vitest 5.0.3、@playwright/test 1.64.0。
- deck.gl 9.4 の型定義で確認したこと: `DataFilterExtension` の `categorySize`（0〜4）、`TextLayer` の `characterSet: 'auto'`、`CollisionFilterExtension`、`PathLayer` の `getColor` が頂点ごとの色の配列を受け付けること。
- 実行環境は Node 22.14.0、npm 10.9.7、Python 3.12.3。ディスクの空きは 246GB。

## e-Gov の分類（施行中 9,015 件の件数）

行政組織 646、厚生 525、工業 467、産業通則 441、国家公務員 377、災害対策 350、社会福祉 346、農業 325、民事 323、環境保全 310、金融・保険 299、財務通則 297、労働 259、教育 257、国税 252、警察 214、海運 209、地方自治 200、外事 188、陸運 176、社会保険 161、刑事 155、行政手続 151、国土開発 147、都市計画 141、商業 138、建築・住宅 135、電気通信 135、文化 131、地方財政 120、国債 104、水産業 102、司法 82、憲法 81、統計 70、鉱業 69、道路 66、消防 63、林業 62、防衛 61、国有財産 56、土地 50、国会 50、外国為替・貿易 50、観光 48、航空 41、郵務 37、事業 20、河川 16、貨物運送 12。

法令種別: MinisterialOrdinance 4,110、CabinetOrder 2,328、Act 2,081、Rule 408、ImperialOrder 66、複合値 21、Constitution 1。
