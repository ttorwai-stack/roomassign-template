/**
 * 저장소 — 구글 시트 구현. (로컬 개발용 메모리 구현은 dev/server.js 에 있고, 같은 인터페이스를 쓴다)
 * 데이터 시트: people(명단) / choices(숙박 선택) / assign(배정) / pins(관리자 고정) / kv(설정 등)
 *
 * 속도: 시트·속성 읽기는 느리다(호출마다 0.3~1초). 그래서
 *  - 한 번의 실행 안에서는 메모(memo_)에 담아 같은 데이터를 다시 읽지 않고,
 *  - 실행 사이에는 CacheService(스크립트 캐시)에 담아 시트를 열지 않고도 읽는다.
 *  쓸 때는 시트·속성에 쓴 뒤 캐시를 같은 내용으로 갱신한다. (시트를 손으로 고쳤다면 clearCache 필요 — 최대 30분 뒤 자동 반영)
 */
var Store = (function () {
  var cache_ = null;   // 스프레드시트 객체
  var memo_ = {};      // 실행 한 번 동안의 읽기 결과
  var TTL = 1800;      // 캐시 유지 시간(초)
  var NULL = '__null__';

  function cs_() { return CacheService.getScriptCache(); }
  function clone_(x) { return x === undefined ? x : JSON.parse(JSON.stringify(x)); }
  function cget_(key) {
    try { var v = cs_().get(key); return v === null ? undefined : JSON.parse(v); } catch (e) { return undefined; }
  }
  function cput_(key, val) {
    try { var s = JSON.stringify(val); if (s.length < 90000) cs_().put(key, s, TTL); else cs_().remove(key); } catch (e) { /* 캐시 실패는 무시 */ }
  }

  function ss_() {
    if (cache_) return cache_;
    var props = PropertiesService.getScriptProperties();
    var id = props.getProperty('SSID');
    var ss = null;
    if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
    if (!ss) {
      ss = SpreadsheetApp.create('방배정 데이터');
      props.setProperty('SSID', ss.getId());
    }
    cache_ = ss;
    return ss;
  }

  function sheet_(name, headers) {
    var ss = ss_();
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@'); // 방 번호·전화 끝자리가 숫자로 바뀌지 않게 텍스트로
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.setFrozenRows(1);
    }
    return sh;
  }

  function readSheet_(name, headers) {
    var sh = sheet_(name, headers);
    var last = sh.getLastRow();
    if (last < 2) return [];
    var vals = sh.getRange(2, 1, last - 1, headers.length).getValues();
    return vals.map(function (row) {
      var o = {};
      headers.forEach(function (h, i) { o[h] = row[i] === '' ? '' : row[i]; });
      return o;
    });
  }

  function remember_(key, val) { memo_[key] = clone_(val); cput_(key, val); }

  return {
    getTable: function (name, headers) {
      var key = 'T:' + name;
      if (memo_[key] !== undefined) return clone_(memo_[key]);
      var v = cget_(key);
      if (v === undefined) { v = readSheet_(name, headers); cput_(key, v); }
      memo_[key] = clone_(v);
      return clone_(v);
    },
    setTable: function (name, headers, rows) {
      var sh = sheet_(name, headers);
      var last = sh.getLastRow();
      if (last > 1) sh.getRange(2, 1, last - 1, headers.length).clearContent();
      if (rows.length) {
        var out = rows.map(function (o) { return headers.map(function (h) { return o[h] === undefined || o[h] === null ? '' : o[h]; }); });
        sh.getRange(2, 1, out.length, headers.length).setValues(out);
      }
      remember_('T:' + name, rows);
    },
    // 한 줄만 바꾸거나 추가(첫 열 id 기준). 전체를 다시 쓰는 것보다 훨씬 빠르다.
    upsertRow: function (name, headers, row) {
      var rows = this.getTable(name, headers);
      var sh = sheet_(name, headers);
      var vals = [headers.map(function (h) { return row[h] === undefined || row[h] === null ? '' : row[h]; })];
      var idx = -1;
      for (var i = 0; i < rows.length; i++) if (String(rows[i].id) === String(row.id)) { idx = i; break; }
      if (idx >= 0) { sh.getRange(idx + 2, 1, 1, headers.length).setValues(vals); rows[idx] = row; }
      else { sh.getRange(rows.length + 2, 1, 1, headers.length).setValues(vals); rows.push(row); }
      remember_('T:' + name, rows);
    },
    getKV: function (key) {
      var k = 'K:' + key;
      if (memo_[k] !== undefined) return memo_[k] === NULL ? null : clone_(memo_[k]);
      var c = cget_(k);
      if (c === undefined) {
        var v = PropertiesService.getScriptProperties().getProperty('kv_' + key);
        c = v === null ? NULL : JSON.parse(v);
        cput_(k, c);
      }
      memo_[k] = clone_(c);
      return c === NULL ? null : clone_(c);
    },
    setKV: function (key, val) {
      PropertiesService.getScriptProperties().setProperty('kv_' + key, JSON.stringify(val));
      remember_('K:' + key, val);
    },
    clearCache: function () { memo_ = {}; try { cs_().removeAll(['x']); } catch (e) { /* 키 목록 없이는 일괄 삭제 불가 — TTL로 만료 */ } },
    lock: function (fn) {
      var lock = LockService.getScriptLock();
      lock.waitLock(30000);
      try { return fn(); } finally { lock.releaseLock(); }
    },
    hash: function (s) {
      var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
      return d.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
    },
    now: function () { return new Date().toISOString(); },
    nowKst: function () { return Utilities.formatDate(new Date(), 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm"); },
    spreadsheetUrl: function () { return ss_().getUrl(); }
  };
})();
