Kawaii とインターバンクの Googleマップの口コミ総数と評価を記録してください。

## 手順
1. 実装前に、Google Places API (New) の最新ドキュメントをWebで確認する（エンドポイント、FieldMask、料金・無料枠）。料金の要点をユーザーに一言伝える。
2. `scripts/review_count.py` を作る。
   - 初回だけ Text Search で両店の place_id を取得し、`data/places.json` に保存する（検索語の例：「Kawaii Money Exchange Yokocho 西新宿」「外貨両替のインターバンク 西新宿」）。候補が複数ある場合は住所を表示してユーザーに選んでもらう。
   - 以降は Place Details で `rating` と `userRatingCount` だけを取得する（FieldMaskを最小にして料金を抑える）。
   - `data/review_counts.csv` に `date, store, rating, review_count` を追記する。
   - APIキーは `.env` の `GOOGLE_MAPS_API_KEY` から読む。
3. 1回実行して結果を表示する。
4. 週1回の自動実行の設定方法（macOSならcron/launchd、Windowsならタスクスケジューラ）を、ユーザーのOSを確認してから提案する。登録はユーザーの了承後に行う。
5. 記録が2週以上たまっていれば、両店の週あたり増加件数と「このペースで何週後に件数が並ぶか」を計算して表示する。並ばない場合はそう書く。

## 注意
- Googleマップの画面をスクレイピングしない。
- APIで取得できる口コミ本文は数件だけなので、本文の分析は `/review-analyze` で行う。
