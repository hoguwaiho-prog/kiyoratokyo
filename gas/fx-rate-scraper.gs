/**
 * 外貨両替レート スクレイパー（Google Apps Script）
 *
 * 対象:
 *   - 銀座エクスチェンジ          https://ginza.exchange/
 *   - Akihabara Money Exchange   https://createarc.moneyxhub.com/rates
 *   - 新和エクスチェンジ          https://shinwa-exchange.jp/
 *
 * 用語（3店とも店舗側から見た表記に統一）:
 *   buy  = 買取レート（お客様が外貨 → 日本円 に両替するときのレート）
 *   sell = 販売レート（お客様が日本円 → 外貨 に両替するときのレート）
 *   いずれも「外貨1単位あたりの円」。品切れ等で数値がない場合は空欄。
 *
 * 使い方:
 *   1. スプレッドシートを開き「拡張機能 > Apps Script」にこのファイルを貼り付けて保存
 *   2. 実行したい関数を選んで「実行」
 *        scrapeGinzaExchange()          … 銀座エクスチェンジだけ取得 → シート「銀座エクスチェンジ」
 *        scrapeAkihabaraMoneyExchange() … 秋葉原だけ取得 → シート「Akihabara Money Exchange」
 *        scrapeShinwaExchange()         … 新和だけ取得 → シート「新和エクスチェンジ」
 *        scrapeAll()                    … 3店まとめて取得 → 上記3シートを更新＋「履歴」に追記
 *
 *   店舗シートの形式: A列=通貨 / B列=SELL / C列=BUY、通貨は FX_ORDER の順（扱いのない通貨は空欄）
 *   3. 定期実行したい場合は createDailyTrigger() を一度実行（毎日12時台に scrapeAll）
 *
 *   単体スクリプトの場合は、初回にスプレッドシート「外貨両替レート」を自動作成します（URLは実行ログに表示）。
 */

const FX_SHOPS = {
  ginza: {
    name: '銀座エクスチェンジ',
    url: 'https://ginza.exchange/',
    parser: parseGinzaExchange_,
  },
  akihabara: {
    name: 'Akihabara Money Exchange',
    url: 'https://createarc.moneyxhub.com/rates',
    parser: parseAkihabaraMoneyExchange_,
  },
  shinwa: {
    name: '新和エクスチェンジ',
    url: 'https://shinwa-exchange.jp/',
    parser: parseShinwaExchange_,
  },
};

const FX_HEADERS = ['取得日時', '店舗', '通貨コード', '通貨名', 'buy（買取 外貨→円）', 'sell（販売 円→外貨）', '在庫', 'サイト上の更新表記', 'URL'];
/** 店舗シートに並べる通貨の順番 */
const FX_ORDER = ['USD', 'GBP', 'EUR', 'CAD', 'CHF', 'AUD', 'NZD', 'IDR', 'KRW', 'CNY', 'HKD', 'MYR', 'PHP', 'SGD', 'TWD', 'THB', 'VND'];
const FX_HISTORY_SHEET = '履歴';

/* ===================== 実行用（それぞれ単独で実行可） ===================== */

/** 3店まとめて取得し、店舗ごとのシートを更新。1店が失敗しても他の店は続行する。 */
function scrapeAll() {
  const ss = getSpreadsheet_();
  const all = [];
  const errors = [];
  Object.keys(FX_SHOPS).forEach(function (key) {
    try {
      const rows = fetchShopRates(key);
      writeShopSheet_(ss, FX_SHOPS[key].name, rows);
      all.push.apply(all, rows);
    } catch (e) {
      errors.push(FX_SHOPS[key].name + ': ' + e.message);
      Logger.log('[ERROR] ' + FX_SHOPS[key].name + ': ' + e.message);
    }
  });

  appendRows_(ss, FX_HISTORY_SHEET, all);
  logRows_(all);
  if (errors.length) throw new Error('一部の店舗で取得に失敗しました:\n' + errors.join('\n'));
  return all;
}

function scrapeGinzaExchange() {
  return runShop_('ginza');
}

function scrapeAkihabaraMoneyExchange() {
  return runShop_('akihabara');
}

function scrapeShinwaExchange() {
  return runShop_('shinwa');
}

/** 毎日12時台に scrapeAll を実行するトリガーを作成（重複作成しない） */
function createDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'scrapeAll') ScriptApp.deleteTrigger(t);
  });
  // 各店の更新: 銀座 11:00（土12:00）/ 新和 平日11:30頃 / 秋葉原 随時
  ScriptApp.newTrigger('scrapeAll').timeBased().everyDays(1).atHour(12).inTimezone('Asia/Tokyo').create();
}

/* ===================== 取得本体 ===================== */

/**
 * 指定店舗のレートを取得してオブジェクト配列で返す（シートには書かない）。
 * 他の関数から使いたい場合はこれを呼ぶ。
 * @param {'ginza'|'akihabara'|'shinwa'} key
 */
function fetchShopRates(key) {
  const shop = FX_SHOPS[key];
  if (!shop) throw new Error('未知の店舗キー: ' + key);
  const html = fetchHtml_(shop.url);
  const parsed = shop.parser(html);
  if (!parsed.rates.length) {
    throw new Error('レートが1件も取れませんでした。サイトの構造が変わった可能性があります: ' + shop.url);
  }
  const fetchedAt = new Date();
  return parsed.rates.map(function (r) {
    return {
      fetchedAt: fetchedAt,
      shop: shop.name,
      code: r.code,
      name: r.name,
      buy: r.buy,
      sell: r.sell,
      stock: r.stock || '',
      siteUpdated: parsed.updated || '',
      url: shop.url,
    };
  });
}

function runShop_(key) {
  const rows = fetchShopRates(key);
  const ss = getSpreadsheet_();
  writeShopSheet_(ss, FX_SHOPS[key].name, rows);
  logRows_(rows);
  return rows;
}

/* ===================== パーサー ===================== */

/**
 * 銀座エクスチェンジ:
 * ページ内の JS に `rates = {"USD":{"label":"米ドル","buy_rate":"156.50","sell_rate":"159.30"}, ...};`
 * が埋め込まれているのでそれを JSON として読む。
 * 在庫（◯/△/✕）は表示用の <div class="rates-display"> から補完。
 */
function parseGinzaExchange_(html) {
  const m = html.match(/\brates\s*=\s*(\{[\s\S]*?\}\s*\})\s*;/);
  if (!m) throw new Error('銀座エクスチェンジ: rates オブジェクトが見つかりません');
  const data = JSON.parse(m[1]);

  // 表示ブロックから在庫を取得: ...>米ドル<br>外貨→円: 156.50<br>円→外貨: 159.30<br>在庫: ◯<br></div>
  const stockByLabel = {};
  const blockRe = /<div class="rates-display">([\s\S]*?)<\/div>/g;
  let b;
  while ((b = blockRe.exec(html)) !== null) {
    const text = b[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
    const lines = text.split('\n').map(function (s) { return s.trim(); }).filter(String);
    const stockLine = lines.filter(function (s) { return s.indexOf('在庫') === 0; })[0];
    if (lines.length && stockLine) stockByLabel[lines[0]] = stockLine.replace(/^在庫\s*[:：]\s*/, '');
  }

  const rates = Object.keys(data).map(function (code) {
    const d = data[code];
    return {
      code: code,
      name: d.label,
      buy: toNumber_(d.buy_rate),
      sell: toNumber_(d.sell_rate),
      stock: stockByLabel[d.label] || (isSoldOut_(d.sell_rate) ? '販売品切れ' : ''),
    };
  });

  const t = html.match(/id="rates-timestamp"[^>]*>([^<]*)</);
  return { rates: rates, updated: t ? t[1].replace(/^更新日時\s*[:：]\s*/, '').trim() : '' };
}

/**
 * Akihabara Money Exchange (/rates):
 * <table> の各行が [通貨(コード+名称), 買取(外貨→JPY), 販売(JPY→外貨)] の3列。
 */
function parseAkihabaraMoneyExchange_(html) {
  html = html.replace(/<!-- -->/g, ''); // React の区切りコメントを除去
  const table = findTable_(html, function (t) { return /買取|Buy/.test(t) && /販売|Sell/.test(t); });
  if (!table) throw new Error('Akihabara Money Exchange: レート表が見つかりません');

  // ヘッダー位置を確認して買取/販売の列を決める（通常は 1, 2 列目）
  const head = table.match(/<thead[\s\S]*?<\/thead>/);
  let buyCol = 1, sellCol = 2;
  if (head) {
    const ths = matchAll_(head[0], /<th[^>]*>([\s\S]*?)<\/th>/g).map(stripTags_);
    ths.forEach(function (h, i) {
      if (/買取|Buy/i.test(h)) buyCol = i;
      if (/販売|Sell/i.test(h)) sellCol = i;
    });
  }

  const rates = [];
  rowsOf_(table).forEach(function (cells) {
    if (cells.length <= Math.max(buyCol, sellCol)) return;
    const codeM = cells[0].match(/<div class="font-bold">\s*([A-Z]{3})\s*<\/div>/) || stripTags_(cells[0]).match(/\b([A-Z]{3})\b/);
    if (!codeM) return;
    const nameM = cells[0].match(/<div class="text-sm[^"]*">([\s\S]*?)<\/div>/);
    rates.push({
      code: codeM[1],
      name: nameM ? stripTags_(nameM[1]) : '',
      buy: toNumber_(stripTags_(cells[buyCol])),
      sell: toNumber_(stripTags_(cells[sellCol])),
    });
  });

  const t = stripTags_(html).match(/(?:最終更新|Last updated)\s*[:：]\s*([^\n]+?\d{1,2}:\d{2})/);
  return { rates: rates, updated: t ? t[1].trim() : '' };
}

/**
 * 新和エクスチェンジ:
 * 「買取価格」表（ヘッダー: 外貨⇒日本円）と「販売価格」表（ヘッダー: 日本円⇒外貨）の2つの表を
 * 通貨名で突き合わせる。
 */
function parseShinwaExchange_(html) {
  const buyTable = findTable_(html, function (t) { return /外貨\s*[⇒→]\s*日本円/.test(t); });
  const sellTable = findTable_(html, function (t) { return /日本円\s*[⇒→]\s*外貨/.test(t); });
  if (!buyTable && !sellTable) throw new Error('新和エクスチェンジ: レート表が見つかりません');

  const order = [];
  const byName = {};
  function collect(table, field) {
    if (!table) return;
    rowsOf_(table).forEach(function (cells) {
      if (cells.length < 2) return;
      const name = stripTags_(cells[0]);
      const value = toNumber_(stripTags_(cells[1]));
      if (!name || name === 'ー' || value === '') return;
      if (!byName[name]) {
        byName[name] = { code: SHINWA_CODE_MAP[name] || '', name: name, buy: '', sell: '' };
        order.push(name);
      }
      byName[name][field] = value;
    });
  }
  collect(buyTable, 'buy');
  collect(sellTable, 'sell');

  const t = html.match(/更新日\s*[:：]\s*([0-9]{4}\/[0-9]{1,2}\/[0-9]{1,2})/);
  return { rates: order.map(function (n) { return byName[n]; }), updated: t ? t[1] : '' };
}

const SHINWA_CODE_MAP = {
  '米ドル': 'USD', 'ユーロ': 'EUR', '中国元': 'CNY', '人民元': 'CNY', '韓国ウォン': 'KRW',
  '香港ドル': 'HKD', 'シンガポールドル': 'SGD', '台湾ドル': 'TWD', 'タイバーツ': 'THB',
  'フィリピンペソ': 'PHP', '英ポンド': 'GBP', 'イギリスポンド': 'GBP', 'カナダドル': 'CAD',
  '豪ドル': 'AUD', 'オーストラリアドル': 'AUD', 'NZドル': 'NZD', 'ニュージーランドドル': 'NZD',
  'マレーシアリンギット': 'MYR', 'ベトナムドン': 'VND', 'スイスフラン': 'CHF',
  'インドルピー': 'INR', 'インドネシアルピア': 'IDR', 'UAEディルハム': 'AED',
};

/* ===================== ヘルパー ===================== */

function fetchHtml_(url) {
  const res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'ja,en;q=0.8',
    },
  });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('HTTP ' + code + ' ' + url);
  return res.getContentText('UTF-8');
}

/** 条件に合う最初の <table>...</table> を返す */
function findTable_(html, predicate) {
  const tables = matchAll_(html, /<table[\s\S]*?<\/table>/g, 0);
  for (let i = 0; i < tables.length; i++) if (predicate(tables[i])) return tables[i];
  return null;
}

/** テーブル内の <tr> ごとに <td> の中身（HTMLのまま）の配列を返す。<th> だけの行は除外 */
function rowsOf_(table) {
  return matchAll_(table, /<tr[^>]*>([\s\S]*?)<\/tr>/g)
    .map(function (tr) { return matchAll_(tr, /<td[^>]*>([\s\S]*?)<\/td>/g); })
    .filter(function (cells) { return cells.length > 0; });
}

function matchAll_(str, re, group) {
  const g = group === undefined ? 1 : group;
  const out = [];
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(str)) !== null) out.push(m[g]);
  return out;
}

function stripTags_(s) {
  return String(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t　]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

/** "¥ 1,234.50" / "￥0.1141" / "156.50" → 数値。数値でなければ ''（品切れ等） */
function toNumber_(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/[¥￥,\s円]/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return '';
  return Number(s);
}

function isSoldOut_(v) {
  return /sold\s*out|品切/i.test(String(v));
}

/**
 * 書き込み先のスプレッドシートを返す。
 *   1. スプレッドシートから開いたスクリプトなら、そのスプレッドシート
 *   2. 単体スクリプトなら、初回に「外貨両替レート」を自動作成して以後それを使う
 * どちらの場合も書き込み先URLを実行ログに出す。
 */
function getSpreadsheet_() {
  let ss = null;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {}
  if (!ss) {
    const props = PropertiesService.getScriptProperties();
    const id = props.getProperty('FX_SPREADSHEET_ID');
    if (id) {
      try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; }
    }
    if (!ss) {
      ss = SpreadsheetApp.create('外貨両替レート');
      props.setProperty('FX_SPREADSHEET_ID', ss.getId());
      Logger.log('新しいスプレッドシートを作成しました');
    }
  }
  Logger.log('書き込み先: ' + ss.getUrl());
  return ss;
}

function toSheetRow_(r) {
  return [r.fetchedAt, r.shop, r.code, r.name, r.buy, r.sell, r.stock, r.siteUpdated, r.url];
}

/**
 * 店舗シートを書く: A=通貨 / B=SELL / C=BUY を FX_ORDER の順で。
 * 右側(E〜F列)に取得日時・サイト上の更新表記・URL を表示。
 */
function writeShopSheet_(ss, sheetName, rows) {
  const byCode = {};
  rows.forEach(function (r) { byCode[r.code] = r; });
  const table = [['通貨', 'SELL', 'BUY']].concat(FX_ORDER.map(function (code) {
    const r = byCode[code];
    return [code, r ? r.sell : '', r ? r.buy : ''];
  }));

  const sh = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  sh.clear();
  sh.getRange(1, 1, table.length, 3).setValues(table);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#f1f3f4');
  sh.getRange(2, 2, FX_ORDER.length, 2).setNumberFormat('0.00##');
  sh.setFrozenRows(1);

  const first = rows[0] || {};
  const info = [
    ['取得日時', first.fetchedAt || ''],
    ['サイト更新', first.siteUpdated || ''],
    ['URL', first.url || ''],
    ['SELL', '販売（円→外貨）'],
    ['BUY', '買取（外貨→円）'],
  ];
  sh.getRange(1, 5, info.length, 2).setValues(info);
  sh.getRange(1, 5, info.length, 1).setFontWeight('bold');
  sh.getRange(1, 6).setNumberFormat('yyyy-mm-dd hh:mm');
}

/** 履歴シートに追記 */
function appendRows_(ss, sheetName, rows) {
  if (!rows.length) return;
  const sh = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, FX_HEADERS.length).setValues([FX_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  const start = sh.getLastRow() + 1;
  sh.getRange(start, 1, rows.length, FX_HEADERS.length).setValues(rows.map(toSheetRow_));
  sh.getRange(start, 1, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm');
}

function logRows_(rows) {
  rows.forEach(function (r) {
    Logger.log([r.shop, r.code, r.name, 'buy=' + r.buy, 'sell=' + r.sell, r.stock, r.siteUpdated].join(' | '));
  });
}

/* ===================== スプレッドシートのメニュー ===================== */

/** スプレッドシートを開くと上部に「為替レート」メニューが出る */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('為替レート')
    .addItem('3店まとめて取得', 'scrapeAll')
    .addSeparator()
    .addItem('銀座エクスチェンジだけ取得', 'scrapeGinzaExchange')
    .addItem('Akihabara Money Exchangeだけ取得', 'scrapeAkihabaraMoneyExchange')
    .addItem('新和エクスチェンジだけ取得', 'scrapeShinwaExchange')
    .addSeparator()
    .addItem('毎日自動取得を設定', 'createDailyTrigger')
    .addToUi();
}
