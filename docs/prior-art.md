# 法令参照ネットワーク可視化の先行事例

lawvis（可視化法学）以外を対象に、2026-10-08 時点で公開URLの生死を確認した。本作の比較軸は [plan.md](/cursor/stores/bc-01a11c40-8a0f-7b38-81c5-e33c052bc7d3/docs/plan.md) の6軸（規模・粒度・意味・時間・読みやすさ・信頼性）である。判例ネットワークは、法令と接続するもの、または可視化として特に示唆のあるものに限る。

スクリーンショットはヘッドレス Chrome で取得した。一部のページで CJK / 欧文の合字が崩れて見えるが、ノード配置・色・UI構成は実画面どおりである。

---

## 国内の事例

### 1. 法脈（Houmyaku）— Triton Lab

- **国**: 日本
- **URL（生存確認）**:
  - 製品ページ: https://tritonlab.io/ （200）
  - 民法・関連法令: https://tritonlab.io/demo/civil_related.html （200）
  - 労基法・条文相互参照: https://tritonlab.io/demo/labor_art36_xref.html （200）
  - 民法・改正履歴: https://tritonlab.io/demo/civil_amends.html （200）
  - 金商法ファミリー: https://tritonlab.io/demo/fsa_family.html （200）
- **ノード**: 法令、または条（デモにより切替）。法令種別で色分け。
- **エッジ**: 種類あり（関連 / 改正 / 廃止、委任 / 参照）。重みはデモではほぼ未表示。
- **時間軸**: 改正デモに1930–2025のスライダー。成長アニメではなく、改正法を中心にした放射グラフ。
- **技術**: ブラウザ完結の静的HTML。D3 v7。サーバー不要と明記。
- **規模（自称）**: 約9,450法令、関係エッジ216万、委任解決10,757、法令名辞書107K。e-Gov XML由来。
- **強み**: lawvisにない**エッジ種別**と**委任チェーン**、条文粒度、改正タイムライン。抽出の意味付けが本作の「意味」軸と近い。
- **限界**: 公開デモは1法令を中心にしたegoグラフで、全法令1枚の地図ではない。製品はメタデータ基盤・CLI寄り。精度のゴールドセットは未公開。
- **本作**: 種別付きエッジと委任ツリーは取り入れる。全法令アトラスと条文ドリルダウンで規模と読みやすさを超える。

![法脈：民法を中心にした関連・改正・廃止の種別グラフ](/cursor/stores/bc-01a11c40-8a0f-7b38-81c5-e33c052bc7d3/media/prior-art/houmyaku-civil.png)

![法脈：労働基準法36条周辺の条文相互参照（委任／参照）](/cursor/stores/bc-01a11c40-8a0f-7b38-81c5-e33c052bc7d3/media/prior-art/houmyaku-labor.png)

![法脈：民法の改正履歴。下部に年代スライダー](/cursor/stores/bc-01a11c40-8a0f-7b38-81c5-e33c052bc7d3/media/prior-art/houmyaku-amends.png)

### 2. JLaw-CiteGraph（jlawcite）

- **国**: 日本
- **URL（生存確認）**:
  - https://github.com/yabooung/jp-law-citation-graph （200）
  - https://pypi.org/project/jlawcite/ （200、v2.4.0）
- **ノード**: 条・項・号・附則・別表（約189万）。法令単位の集約グラフも配布。
- **エッジ**: 引用（同一法令・相対参照含む）、委任（政令で定める）、別表/様式、改正。法令→法令は70,577ペア、条レベル横断は453,390本。
- **時間軸**: 特定日の施行版＋施行予定1,649件。月次スナップショット。成長可視化UIはなし。
- **技術**: 決定論的Python（LLMなし）。`explorer.html`（単一ファイル）、CLI、MCP。データはCSV/JSONL、CC BY 4.0。
- **精度（公表）**: 同一法令解決92.9%、横断82.2%、相対参照92.2%。主要規則の手作業サンプルで約98%（予備的、サンプル小）。
- **強み**: 公開グラフとしては国内最大。委任・附則・相対参照まで含む。再現手順と評価の正直な限界記述。
- **限界**: インタラクティブ探索はegoビュー。全法令地図・本文その場表示・経路探索UIはない。廃止法令・通達・条例は対象外。
- **本作**: 抽出器とゴールドセットの設計、エッジ種別、附則の切り分けを参照する。可視化の読みやすさと物語はこちらで超える。

### 3. japan-law（Laws as Code）

- **国**: 日本
- **URL（生存確認）**: https://github.com/DaisukeHori/japan-law （200）
- **ノード / エッジ**: 法令Markdown内の相互参照リンクと被参照一覧。約8,000法令、条レベル相互参照約11.2万（JLaw側の紹介）。ネットワークキャンバスはない。
- **時間軸**: Gitのdiffで改正履歴。国会法案をIssue/PRで追跡。
- **技術**: e-Gov API、Lawtext/XML/Markdown、GitHub Actions。
- **強み**: 条文へ飛べる参照と逆引き。改正をdiffとして読める。
- **限界**: 地図でも種別グラフでもない。抽出精度の評価なし。
- **本作**: 「エッジをクリックして本文」と逆引きのUXヒント。グラフ本体は別物。

### 4. Lawtext

- **国**: 日本
- **URL（生存確認）**: https://yamachig.github.io/Lawtext/ （200）
- **ノード / エッジ**: 1法令内の括弧入れ子、定義語、条項ポインタ、法令番号付き初出→略称。法令間ネットワークではない。
- **時間軸**: なし。
- **技術**: TypeScript。法令標準XML / e-LAWS API。SPA。
- **強み**: 同法・前条などの相対参照を木構造上で解く実装が公開されている。
- **限界**: 全法令グラフなし。
- **本作**: パーサと相対参照解決を抽出器に借りる。可視化は法令間地図が主戦場。

### 5. 弁護士ドットコムの統合引用グラフ（公開Webなし）

- **国**: 日本
- **URL**: 論文のみ。https://dbsj.org/wp-content/uploads/2025/11/dds-vol4-no3.pdf （200）、NLP2025 Q7-2 https://www.anlp.jp/proceedings/annual_meeting/2025/pdf_dir/Q7-2.pdf （200）
- **ノード**: 法令（法令→条→項→号の階層）＋判例・書籍・ガイドライン。e-Gov XML約11,000件（2024-09）。
- **エッジ**: ルールベースの法令名引用。法令間引用は P 98.8 / R 92.1（論文側の報告、JLaw README経由）。
- **時間軸**: なし（構築時点スナップショット）。
- **技術**: 研究用グラフ。公開ビューアなし。
- **強み**: 法令以外の情報源までつなぐ。QAでの有用性を測定。
- **限界**: グラフ非公開。同一法令内参照は評価外。
- **本作**: 法令ネットワークの公開と精度レポートで差別化する。書籍・判例は初期スコープ外。

lawvis自体は対象外。比較の基準としてだけ書くと、分野分割（約50枚）、法令ペアの無種別エッジ、2026-06固定、本文なし、sigma.js、である。

---

## 海外の事例

### 6. Graphie（QuantLaw / King's College London）

- **国**: 英国
- **URL**: 現行 https://graphie.quantlaw.co.uk/network.html は接続不能（2026-10-08）。アーカイブ: https://web.archive.org/web/20231211175344/https://graphie.quantlaw.co.uk/network.html （Wayback 200系）。論文解説: https://www.kcl.ac.uk/news/new-graph-based-visualisation-interface-for-uk-laws （200）。コード: https://github.com/kclquantlaw/graphie （200）
- **ノード**: 1法律の条（Housing Act 2004）。Partごとに色。外部法律の条も接続可。
- **エッジ**: 階層（Part–条）と条文中の明示参照。重み付き版あり（被参照回数でノードサイズ）。
- **時間軸**: なし。
- **技術**: Sofiaパイプライン（legislation.gov.uk XML）＋Web。Cytoscape系の記述あり。
- **強み**: 階層色＋本文パネル。法令内地図と参照を同居させる。
- **限界**: 1法律のデモ。本番サイトは死んでいる。
- **本作**: 法令内ズームと「条をクリックして本文」は直接の手本。全法令1枚はGraphieがやっていない。

### 7. Lex Graph（UK i.AI）

- **国**: 英国
- **URL（生存確認）**: https://github.com/i-dot-ai/lex-graph （200）、データ https://huggingface.co/datasets/i-dot-ai/lex-graph
- **ノード / エッジ**: 82万超ノード、220万超エッジ。`part_of`（階層）と条文参照など。
- **時間軸**: 改訂履歴は不完全と明記。
- **技術**: National Archives XML、Streamlit探索。Graphie着想。
- **強み**: 英国法のほぼ全量グラフ。エッジ種（階層 vs 引用）が分かれる。
- **限界**: 公開の美しい地図ではない。巨大グラフの描画は性能制約。
- **本作**: 階層エッジと引用エッジの分離、配信用の分割を参考にする。

### 8. Légigraphe

- **国**: フランス
- **URL（生存確認）**: アプリ https://legigraphe.onrender.com （200）、カタログ https://www.data.gouv.fr/reuses/legigraphe （200、2026-08更新）
- **ノード**: 条文（article）。コード分野で色分け。
- **エッジ**: 条文間の引用。AI生成の短いタイトルがノード/エッジに付く。
- **時間軸**: なし（現行コーパスの探索）。
- **技術**: 公開Webアプリ（Légifrance再利用）。
- **強み**: 条を単位にした、一般向けのきれいな探索UI。検索から近傍グラフへ。
- **限界**: 全法典を1枚に載せない（クエリ起点）。エッジ種は引用のみ。精度の公開評価なし。
- **本作**: ランディングの「1条から広がる」導入は物語として借りる。全法令アトラスと種別で超える。

![Légigraphe：条文をノードにしたフランス規制コーパスの探索UI](/cursor/stores/bc-01a11c40-8a0f-7b38-81c5-e33c052bc7d3/media/prior-art/legigraphe.png)

### 9. L'Observatoire du droit（SensPo）

- **国**: フランス
- **URL（生存確認）**: https://www.senspo.fr/droit/observatoire （200）
- **ノード / エッジ**: コード間引用の行列（上位30関係）、条文引用グラフ上のハブと孤児。ネットワークキャンバスより統計ダッシュボード。
- **時間軸**: 1990年以降の条文数の増減、版の履歴（526,420 versions）。
- **技術**: Légifrance全コード（108コード、施行中76、施行中条文159,914）。
- **強み**: 「ほとんどが一度も引用されない」など、規模感と時間の語りが明確。
- **限界**: 操作できる地図ではない。
- **本作**: 時間軸の導入ストーリー（成長・ハブ・孤児）に使う。グラフ本体は別設計。

![SensPo Observatoire：フランス法典の規模・安定性・引用構造のダッシュボード](/cursor/stores/bc-01a11c40-8a0f-7b38-81c5-e33c052bc7d3/media/prior-art/senspo-observatoire.png)

### 10. LegalViz.EU（eur-lex-visualiser）

- **国**: EU（オランダ・Maastricht Law & Tech Lab）
- **URL（生存確認）**: https://legalviz.eu/ （200）、https://github.com/maastrichtlawtech/eur-lex-visualiser （200、リポジトリ名は legalviz.eu にリダイレクト）
- **ノード / エッジ**: 1法令内の条・前文・定義・附属書と、CELEX解決済みの他法令参照。CJEU判決を「この条を引用する判例」として横に出す。
- **時間軸**: なし。
- **技術**: Formex XML / EUR-Lex HTML、CELLAR SPARQL。読書ビュー。
- **強み**: 法令と判例の接続。読みのUIが整っている。
- **限界**: 全EU法の引用ネットワーク地図ではない。
- **本作**: 本文＋逆引き判例は将来拡張。初期は法令同士に集中。

### 11. Open Legal Data — ドイツ判例×法令ネットワーク

- **国**: ドイツ
- **URL（生存確認）**: https://openlegaldata.io/de/citation-network.html （200）。データ: https://huggingface.co/datasets/openlegaldata/legal-citation-graph-germany
- **ノード**: 法令（青）と裁判所（赤）。法令は法典単位に集約。
- **エッジ**: 引用。最大50,000本に制限。
- **時間軸**: なし。
- **技術**: Gephiでレイアウト→JSON、vis.js。
- **強み**: 判例と法令を同じ画面に置いている。
- **限界**: 毛玉。ラベルが読めない。法令内部の条参照はない。
- **本作**: 「全量を力技で描くと読めなくなる」反面教師。バンドリングとズーム階層が必須。

![Open Legal Data：ドイツの裁判所（赤）と法令（青）の引用ネットワーク](/cursor/stores/bc-01a11c40-8a0f-7b38-81c5-e33c052bc7d3/media/prior-art/old-de-citation.png)

### 12. Visualizing Citations in U.S. Law（Gary Sieling）

- **国**: 米国
- **URL（生存確認）**: https://www.garysieling.com/blog/visualizing-citations-in-u-s-law/ （200）
- **ノード**: U.S. Code の Title（約50）。
- **エッジ**: Title間の引用頻度。太さ＝件数。自己引用含む。
- **時間軸**: なし（2013年のXML分析）。
- **技術**: D3 v2 コード図。
- **強み**: 超高密度をTitle集約で読める。
- **限界**: 条に降りられない。ヘッドレスでは図の描画が不安定だった。
- **本作**: 分野＝大陸の集約ビューの根拠。ズームで条へ降りる点が超えどころ。

### 13. Bending the Law

- **国**: 米国
- **URL（生存確認）**: https://www.bendingthelaw.org/ （200）
- **ノード**: USC / CFR / IRC の条、および連邦控訴・最高裁判例。
- **エッジ**: 引用＋トピック類似。重みをUIで合成（textual / out / in）。
- **時間軸**: なし。
- **技術**: Dartmouth / UVA。USC・CFR欄は「Coming soon」。判例側が動く。
- **強み**: 引用と意味的近傍を混ぜる実験。
- **限界**: 法令グラフは未完成。
- **本作**: 語句マップは類似アイデアだが、法令参照は決定論を優先する。

### 14. RegAuthorities / eCFR Cartography

- **国**: 米国
- **URL**: https://www.quantgov.org/reg-authorities （データセット）、https://github.com/apraba05/ecfr-cartography-mcp （D3のpart内グラフ）
- **ノード / エッジ**: CFR part ↔ USC section（授権）。または1 part内の条どうし＋失効した参照（ghost）。
- **時間軸**: RegAuthoritiesは2001年以降の年次。
- **強み**: 法律と命令の委任に相当する「authority」リンク。壊れた参照の可視化。
- **限界**: 全USCの美しい公開地図ではない。
- **本作**: 委任エッジと「参照先が消えた」警告は時間軸（2017年以降）で使える。

フランスCivil Codeの2012年インタラクティブ図（Computational Legal Studies）は記事 https://computationallegalstudies.com/2012/07/07/le-graph-du-code-civil-en-ligne-interactive-network-visualization-of-french-civil-code/ は生存（200）だが、埋め込みビューアは残っていない。

---

## 研究

抽出とモデルに絞る。公開ビューアがあるものは上と重複するのでここでは手法だけ書く。

### 日本

| 文献 | 内容 | 本作への意味 |
| --- | --- | --- |
| 北野・天笠, NLP2026 TS3-5, [PDF](https://www.anlp.jp/proceedings/annual_meeting/2026/pdf_dir/TS3-5.pdf) | パターン＋全文検索。略称・同法・範囲・並列。F値0.935、法令名+条番号の紐付け0.893 | planの抽出器v1の直接の先行。ゴールドセット目標F≥0.95の比較対象 |
| 藤田ら, 法令間委任の自動抽出, JNLP 33(3) 2026 / NLP2026 TS3-13 | 委任キーワードNER＋委任先の曖昧性解消。キーワードF≥95、Recall@10≥90 | 「政令で定める」を種類付きエッジにする根拠 |
| 弁護士ドットコム, DDS 2025 / NLP2025 | 階層ノード＋書籍・判例。法令間 P98.8/R92.1 | 非公開。公開再現性で勝てる |
| 高野ら, NLP2016 C6-3 | 文書–法条二部グラフ。類似度エッジ | 引用ではなく類似。初期は使わない |
| Tran et al., ICAIL 2013 | 日本法令の参照解決の古典 | 相対参照の歴史的起点 |
| Lawtext analyzer | 定義語・法令番号・ポインタ環境 | 実装資産 |

### 米・独・EU

| 文献 | 内容 | 本作への意味 |
| --- | --- | --- |
| Bommarito & Katz, Physica A 2010, [arXiv](https://arxiv.org/abs/1003.4146) | USC＝階層グラフ ∪ 条引用グラフ。円形Reingold–Tilford＋赤の引用オーバーレイ。2008–2010で構造・相互依存・語数が増加 | 「階層の上に引用を重ねる」モデルそのもの |
| Katz, Coupette, Beckedorf, Hartung, *Sci. Rep.* 2020, [論文](https://www.nature.com/articles/s41598-020-73623-x) | 米・独の制定法を多次元・時変ネットワークに。クラスタ家族の年次バーとトークン移動 | 成長アニメの分析側の手本。Web作品ではない |
| Coupette / Legal Network Analytics 101, 2021, [記事](https://legalempirics.com/10.25527/re.2021.11/legal-network-analytics-101/) | ドイツ連邦法の階層をGraphML＋dendrogram / circle packing / sunburst | 法令内ズームの代替レイアウト |
| CAROLL (Passau), [OSF](https://osf.io/8d2v4/overview) / [PDF](https://ca-roll.github.io/downloads/Analysis_of_a_German_Legal_Citation_Network.pdf) | 判例20万＋法令5万。Neo4j。判例–判例、判例–法令。スケールフリー、PageRank | 法令ハブ検出。可視化は研究用 |
| Maastricht CELLAR / cjeu-py | EU判例引用のD3/GEXF。立法リンクはメタデータ | 判例地図としては優秀。法令地図ではない |

---

## 本作への示唆

lawvisを6軸で超える、という計画に対する位置づけ。

1. **規模**: 公開の「1枚の地図」はlawvis（分野分割）とSieling（Title集約）とOpen Legal Data（毛玉）しかない。JLawとLex Graphと法脈はデータでは全量に近いが、地図としてはegoまたは非公開。全法令を大陸＋バンドリングで読めるようにするのが最大の空き地。
2. **粒度**: Graphieと法脈労基デモとLégigrapheが条レベル。JLawは項・号までデータを持つ。途切れないズーム（分野→法令→編章節→条）をWebで実装した例はほぼない。
3. **意味**: 法脈とJLawが委任・改正・参照を分けている。lawvisは未分化。藤田らの委任抽出と北野らの参照抽出を実装し、附則の改正エッジを切るのは差別化になる。
4. **時間**: SensPoとCoupette 2020が「法は膨らむ」を示す。法脈は改正放射＋スライダー。公布日順の成長再生と、2017年以降の差分スライダーを公開Webでやる例は日本にない。
5. **読める**: Lawtext / japan-law / LegalViz / Graphieが本文と参照を同居させる。lawvisは本文なし。エッジ→当該条文、逆引き、経路は必須。Open Legal Dataを反面教師に、ラベル衝突と毛玉を避ける。
6. **信頼性**: JLawが一番正直（未解決率、附則の低精度、サンプル幅）。lawvisは評価非公開。ゴールドセットとlawvis JSON突き合わせを公開するのが「超える」条件。
7. **技術**: 海外の公開作はD3 / vis.js / Cytoscape / Streamlitが多い。計画のdeck.gl＋階層LODは、全量1枚では妥当。抽出は決定論（JLaw / Lawtext）を主、LLMは使わない方が再現性で勝つ。
8. **やらないこと**: 初期に判例・書籍を混ぜるとDDSとOpen Legal Dataの土俵になる。法令同士を先に極める。

### 取り入れる具体策

- エッジ種別の凡例とフィルタ（法脈・JLaw）。
- 条egoと本文パネル（Graphie・Légigraphe・Lawtext）。
- ハブ / 孤児 / 成長の語り（SensPo・Coupette）。
- 決定論抽出＋公開評価（JLaw・北野）。
- 階層∪引用の二重グラフ（Bommarito & Katz、Lex Graph）。

### 超えるべき点

- 分野で切らない全法令地図（lawvis）。
- 条まで降りられるのに毛玉にしない（Open Legal Data / 生の全量描画）。
- 改正エッジでネットワークを歪ませない（法脈デモは改正を別ビューに分離しており、これは踏襲すべき）。
- 死なない公開URLと再現データ（Graphieはサイトが死んだ）。
