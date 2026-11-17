調査用の環境を準備してください。

1. Python の仮想環境 `.venv` を作り、`requirements.txt` を作成してインストールする。最低限：requests, pandas, matplotlib, python-dotenv, langdetect, beautifulsoup4, playwright（`playwright install chromium` も実行）。カメラ処理が必要になった時点で ultralytics と opencv-python を追加する（今は入れない）。
2. `.env.example` を作る（中身：`GOOGLE_MAPS_API_KEY=`）。`.env` が無ければユーザーにAPIキーの準備状況を聞く。キーが無くても他のコマンドは使えると伝える。
3. `.gitignore` を作る：`.env`, `.venv/`, `data/camera/`, `__pycache__/`
4. `output/` フォルダを作る。
5. 最後に、各コマンドで何ができるかと、ユーザーが手で用意するもの（APIキー、口コミのコピー、カメラデータ、自社の欠品記録）を一覧で示す。
