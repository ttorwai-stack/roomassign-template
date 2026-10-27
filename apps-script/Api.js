/**
 * 서버 API — 웹앱 화면(Index.html)이 google.script.run 으로 호출한다.
 * pub_*  : 연수생(전화번호로 본인 확인)
 * adm_*  : 관리자(비밀번호)
 */
var PEOPLE_H = ['id', 'name', 'gender', 'org', 'rank', 'role', 'phoneHash', 'phoneLast4'];
var CHOICE_H = ['id', 'status', 'mates', 'traits', 'sameWish', 'note', 'updatedAt'];
var ASSIGN_H = ['id', 'room'];
var PIN_H = ['id', 'room'];

// ── 연수(이벤트)별 데이터 분리 ─────────────────────
// 연수마다 시트(people_<id> 등)와 설정 키(<id>_config 등)가 따로 생긴다.
// 처음 만든 연수 'main'은 예전 이름(people, config …)을 그대로 쓴다(기존 데이터 이동 없음).
var CUR = 'main';
function tn_(base) { return CUR === 'main' ? base : base + '_' + CUR; }
function kk_(key) { return CUR === 'main' ? key : CUR + '_' + key; }
function events_() {
  var e = Store.getKV('events');
  if (!e) {
    var c = Store.getKV('config') || {};
    e = [{ id: 'main', name: c.courseName || '연수', created: Store.now(), archived: false }];
    Store.setKV('events', e);
  }
  return e;
}
function useEv_(ev, admin) {
  var e = events_().filter(function (x) { return x.id === String(ev || ''); })[0];
  if (!e) throw new Error('연수 주소가 올바르지 않아요. 연수 담당자가 보낸 주소로 다시 들어와 주세요.');
  if (!admin && e.archived) throw new Error('종료된 연수예요.');
  CUR = e.id;
  return e;
}

// 웹앱 주소로 화면을 직접 열 때: 주소의 ?c=(연수코드), ?admin=1, 이 웹앱의 배포ID를 화면에 넘겨 준다.
// (웹앱 화면은 iframe 안이라 화면 쪽에서는 주소의 ?c= 를 볼 수 없다.) /dev(테스트) 주소는 배포ID를 비워 둔다.
function doGet(e) {
  var p = (e && e.parameter) || {};
  var id = '';
  try {
    var u = ScriptApp.getService().getUrl() || '';
    var m = /\/macros\/s\/([A-Za-z0-9_-]+)\/exec$/.exec(u);
    if (m) id = m[1];
  } catch (x) { /* 배포ID를 못 구해도 화면은 열린다 */ }
  var boot = {
    c: String(p.c || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40),
    admin: p.admin === '1' || p.admin === 'true',
    id: id
  };
  var html = HtmlService.createHtmlOutputFromFile('Index').getContent()
    .replace('/*BOOT*/null/*END*/', function () { return JSON.stringify(boot); });
  return HtmlService.createHtmlOutput(html)
    .setTitle('방 배정')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// 외부 주소(GitHub Pages 등)에서 fetch로 호출하는 통로. 허용된 기능만 실행한다.
var API_ = {
  pub_bootstrap: pub_bootstrap, pub_login: pub_login, pub_me: pub_me, pub_submit: pub_submit, pub_setGender: pub_setGender,
  adm_status: adm_status, adm_init: adm_init, adm_events: adm_events, adm_createEvent: adm_createEvent, adm_renameEvent: adm_renameEvent,
  adm_archiveEvent: adm_archiveEvent, adm_state: adm_state, adm_saveConfig: adm_saveConfig, adm_importPeople: adm_importPeople,
  adm_updatePerson: adm_updatePerson, adm_updatePeople: adm_updatePeople, adm_addStaff: adm_addStaff, adm_setGenders: adm_setGenders, adm_deletePeople: adm_deletePeople, adm_resetPhone: adm_resetPhone,
  adm_setChoice: adm_setChoice, adm_clearChoices: adm_clearChoices, adm_run: adm_run, adm_resetAssign: adm_resetAssign, adm_move: adm_move, adm_unpin: adm_unpin, adm_publish: adm_publish
};
function doPost(e) {
  var out;
  try {
    var req = JSON.parse(e.postData.contents);
    var f = Object.prototype.hasOwnProperty.call(API_, req.fn) ? API_[req.fn] : null;
    if (!f) throw new Error('없는 기능입니다.');
    var r = f.apply(null, req.args || []);
    out = { result: r === undefined ? null : r };
  } catch (err) {
    out = { error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// ── 공통 로드/저장 ─────────────────────────────────
function cfg_() {
  var c = Store.getKV(kk_('config'));
  var d = Assign.defaultConfig();
  if (!c) return d;
  c.traits = d.traits; c.conflicts = d.conflicts; // 유형 목록은 코드 기준
  Object.keys(d).forEach(function (k) { if (c[k] === undefined) c[k] = d[k]; });
  return c;
}
function people_() { return Store.getTable(tn_('people'), PEOPLE_H); }
function choices_() {
  var m = {};
  Store.getTable(tn_('choices'), CHOICE_H).forEach(function (r) {
    m[r.id] = {
      id: r.id, status: r.status || 'none', mates: parse_(r.mates, []), traits: parse_(r.traits, []),
      sameWish: r.sameWish === true || r.sameWish === 'TRUE' || r.sameWish === 'true' || r.sameWish === 1,
      note: r.note || '', updatedAt: r.updatedAt || ''
    };
  });
  return m;
}
function choiceRow_(c) {
  return { id: c.id, status: c.status, mates: JSON.stringify(c.mates || []), traits: JSON.stringify(c.traits || []),
    sameWish: c.sameWish ? 'true' : '', note: c.note || '', updatedAt: c.updatedAt || '' };
}
function saveChoices_(m) {
  Store.setTable(tn_('choices'), CHOICE_H, Object.keys(m).map(function (id) { return choiceRow_(m[id]); }));
}
function map_(headers, name) {
  var m = {};
  Store.getTable(tn_(name), headers).forEach(function (r) { if (r.room !== '') m[r.id] = String(r.room); });
  return m;
}
function saveMap_(name, headers, m) {
  Store.setTable(tn_(name), headers, Object.keys(m).map(function (id) { return { id: id, room: m[id] }; }));
}
function parse_(s, d) { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } }
function digits_(s) {
  var d = String(s || '').replace(/\D/g, '');
  if (/^1\d{9}$/.test(d)) d = '0' + d; // 엑셀에서 앞 0이 사라진 경우
  return d;
}
function checkPhone_(s) {
  var d = digits_(s);
  if (!/^01\d{8,9}$/.test(d)) throw new Error('휴대전화 번호를 010-0000-0000 형식으로 입력해 주세요.');
  return d;
}
function phoneHash_(d) { return Store.hash('ra|' + d); }
// 신청 마감: 마감 시각이 지나면 연수생은 선택·성별을 바꿀 수 없다(관리자는 계속 배정 가능)
function closed_(cfg) { return !!cfg.deadline && Store.nowKst() > cfg.deadline; }
function deadlineText_(d) { return d ? d.replace('T', ' ') : ''; }
function emptyChoice_() { return { status: 'none', mates: [], traits: [], sameWish: false, note: '' }; }

// ── 연수생 ────────────────────────────────────────
function pub_bootstrap(ev) {
  var e = useEv_(ev, false);
  var cfg = cfg_();
  return {
    courseName: e.name,
    published: !!Store.getKV(kk_('published')),
    traits: cfg.traits,
    options: cfg.options.filter(function (o) { return o.use; }),
    deadline: cfg.deadline || '', closed: closed_(cfg),
    maxMates: Math.max(1, Number(cfg.perRoom) - 1)
  };
}

function verify_(person, phone, claim) {
  var d = checkPhone_(phone), h = phoneHash_(d);
  if (person.phoneHash) {
    if (person.phoneHash !== h) throw new Error('이 이름표에 등록된 전화번호와 달라요. 번호를 다시 확인하거나 관리자에게 문의하세요.');
  } else if (claim) {
    var dup = people_().filter(function (p) { return p.phoneHash === h && p.id !== person.id; })[0];
    if (dup) throw new Error('이 전화번호는 이미 다른 이름표에 등록되어 있어요.');
    return { claimHash: h, last4: d.slice(-4) };
  }
  return null;
}

function guide_(me, people, ch, cfg) {
  var byId = {}; people.forEach(function (p) { byId[p.id] = p; });
  var stayIds = people.filter(function (p) { return Assign.isStayStatus((ch[p.id] || {}).status); }).map(function (p) { return p.id; });
  var groups = Assign.mutualGroups(stayIds, ch, byId);
  var groupOf = {}; groups.forEach(function (g) { g.forEach(function (i) { groupOf[i] = g; }); });
  var cap = Number(cfg.perRoom);
  var mine = ch[me.id] || emptyChoice_();
  var nameCount = {};
  people.forEach(function (p) { if (p.role) return; var k = p.name + '|' + (p.org || ''); nameCount[k] = (nameCount[k] || 0) + 1; });
  return people.filter(function (p) { return !p.role && p.id !== me.id && !(me.gender && p.gender && me.gender !== p.gender); }).map(function (p) {
    var c = ch[p.id] || emptyChoice_();
    var state, note;
    if (me.gender && p.gender && me.gender !== p.gender) { state = 'otherGender'; note = '성별이 달라 같은 방이 될 수 없어요'; }
    else if (c.status === 'commute') { state = 'commute'; note = '출근을 선택했어요'; }
    else if (Assign.isStayStatus(c.status) && c.mates.indexOf(me.id) >= 0) {
      state = 'choseMe';
      note = mine.mates.indexOf(p.id) >= 0 ? '서로 선택 → 합방 확정!' : '이 분이 나를 선택했어요. 선택하면 합방이 확정돼요';
    }
    else if (groupOf[p.id] && groupOf[p.id].length >= cap) { state = 'full'; note = '이미 다른 분들과 합방이 확정되어 자리가 없어요'; }
    else if (Assign.isStayStatus(c.status) && c.mates.length) { state = 'otherPending'; note = '다른 분을 선택했어요. 같은 방을 원하면 직접 알려주세요'; }
    else if (c.status === 'stay' || c.status === 'style' || c.status === 'mate') { state = 'stay'; note = '숙박 선택함. 내가 선택한 뒤 상대도 나를 선택해야 확정돼요'; }
    else { state = 'undecided'; note = '아직 선택 전이에요. 같은 방을 원하면 직접 알려주세요'; }
    return { id: p.id, name: p.name, org: p.org || '', state: state, note: note, dup: nameCount[p.name + '|' + (p.org || '')] > 1 };
  });
}

function meView_(id, phone) {
  var people = people_(), cfg = cfg_(), ch = choices_();
  var me = people.filter(function (p) { return p.id === id; })[0];
  if (!me) throw new Error('명단에서 이름을 찾을 수 없어요.');
  verify_(me, phone, false);
  var published = !!Store.getKV(kk_('published'));
  var out = {
    eventName: events_().filter(function (x) { return x.id === CUR; })[0].name,
    me: { id: me.id, name: me.name, org: me.org || '', gender: me.gender || '', claimed: !!me.phoneHash },
    choice: ch[id] || emptyChoice_(), published: published, deadline: cfg.deadline || '', closed: closed_(cfg),
    candidates: guide_(me, people, ch, cfg),
    incoming: people.filter(function (p) {
      var c = ch[p.id]; return c && Assign.isStayStatus(c.status) && c.mates.indexOf(id) >= 0;
    }).map(function (p) { return p.id; })
  };
  if (published) {
    var asg = map_(ASSIGN_H, 'assign');
    var rid = asg[id];
    if (rid) {
      var room = cfg.rooms.filter(function (r) { return r.id === rid; })[0] || {};
      out.rooms = cfg.rooms.map(function (r) { return { id: r.id, floor: r.floor, type: r.type }; });
      out.room = {
        id: rid, floor: room.floor, type: room.type,
        mates: people.filter(function (p) { return p.id !== id && asg[p.id] === rid; }).map(function (p) { return { name: p.name, org: p.org || '' }; })
      };
    } else out.room = null;
  }
  return out;
}

function pub_me(ev, id, phone) { useEv_(ev, false); return meView_(id, phone); }

// 전화번호로 본인 찾기 — 관리자가 등록한 번호만 들어올 수 있다
function pub_login(ev, phone) {
  useEv_(ev, false);
  var d = checkPhone_(phone), h = phoneHash_(d);
  var me = people_().filter(function (p) { return p.phoneHash === h; })[0];
  if (!me) throw new Error('등록되지 않은 번호예요. 번호를 다시 확인하거나 연수 담당자에게 문의해 주세요.');
  return meView_(me.id, phone);
}

function pub_submit(ev, id, phone, choice) {
  useEv_(ev, false);
  return Store.lock(function () {
    var people = people_(), cfg = cfg_();
    var me = people.filter(function (p) { return p.id === id; })[0];
    if (!me) throw new Error('명단에서 이름을 찾을 수 없어요.');
    if (Store.getKV(kk_('published'))) throw new Error('방 배정이 확정되어 더 이상 바꿀 수 없어요. 관리자에게 문의하세요.');
    if (closed_(cfg)) throw new Error('신청이 마감되었어요 (마감: ' + deadlineText_(cfg.deadline) + '). 변경이 필요하면 연수 담당자에게 문의해 주세요.');
    var claim = verify_(me, phone, true);
    if (claim) {
      me.phoneHash = claim.claimHash; me.phoneLast4 = claim.last4;
      Store.setTable(tn_('people'), PEOPLE_H, people);
    }
    var st = String(choice.status);
    if (['none', 'commute', 'mate', 'stay', 'style'].indexOf(st) < 0) throw new Error('잘못된 선택입니다.');
    if (Assign.isStayStatus(st) && !me.gender) throw new Error('성별을 먼저 선택해 주세요. (성별이 없으면 방을 배정할 수 없어요)');
    var ids = {}; people.forEach(function (p) { ids[p.id] = true; });
    var maxMates = Math.max(1, Number(cfg.perRoom) - 1);
    var stay = Assign.isStayStatus(st);
    var mates = (stay ? (choice.mates || []) : []).filter(function (m, i, a) { return m !== id && ids[m] && a.indexOf(m) === i; });
    if (mates.length > maxMates) throw new Error('같은 방 희망은 최대 ' + maxMates + '명까지 고를 수 있어요.');
    var tmap = {}; cfg.traits.forEach(function (t) { tmap[t.id] = true; });
    var traits = (stay ? (choice.traits || []) : []).filter(function (t) { return tmap[t]; });
    // 자기 줄만 저장(전체를 다시 쓰지 않아 빠르고, 동시에 몰려도 잠금 시간이 짧다)
    Store.upsertRow(tn_('choices'), CHOICE_H, choiceRow_({
      id: id, status: st, mates: mates, traits: traits, sameWish: stay && !!choice.sameWish,
      note: stay ? String(choice.note || '').slice(0, 100) : '', updatedAt: Store.now()
    }));
    return meView_(id, phone);
  });
}

// 성별이 비어 있는 사람만 본인이 입력할 수 있다(관리자가 넣은 값은 본인이 바꿀 수 없음)
function pub_setGender(ev, id, phone, gender) {
  useEv_(ev, false);
  return Store.lock(function () {
    if (gender !== 'M' && gender !== 'F') throw new Error('성별을 선택해 주세요.');
    var people = people_();
    var me = people.filter(function (p) { return p.id === id; })[0];
    if (!me) throw new Error('명단에서 이름을 찾을 수 없어요.');
    if (Store.getKV(kk_('published'))) throw new Error('방 배정이 확정되어 바꿀 수 없어요.');
    if (closed_(cfg_())) throw new Error('신청이 마감되어 성별을 입력할 수 없어요. 연수 담당자에게 문의해 주세요.');
    var claim = verify_(me, phone, true);
    if (claim) { me.phoneHash = claim.claimHash; me.phoneLast4 = claim.last4; }
    if (me.gender && me.gender !== gender) throw new Error('성별이 이미 입력되어 있어요. 틀렸다면 관리자에게 문의하세요.');
    me.gender = gender;
    Store.setTable(tn_('people'), PEOPLE_H, people);
    return { ok: true };
  });
}

// ── 관리자 ────────────────────────────────────────
function adm_status() { return { hasPw: !!Store.getKV('adminHash') }; }

function adm_init(pw) {
  return Store.lock(function () {
    if (Store.getKV('adminHash')) throw new Error('이미 비밀번호가 설정되어 있습니다.');
    if (String(pw || '').length < 4) throw new Error('비밀번호는 4자 이상으로 정해 주세요.');
    Store.setKV('adminHash', Store.hash('adm|' + pw));
    return { ok: true };
  });
}
function auth_(pw) {
  var h = Store.getKV('adminHash');
  if (!h) throw new Error('관리자 비밀번호가 아직 설정되지 않았습니다.');
  if (Store.hash('adm|' + pw) !== h) throw new Error('비밀번호가 맞지 않습니다.');
}
function pubPerson_(p) {
  return { role: p.role || '', id: p.id, name: p.name, gender: p.gender || '', org: p.org || '', rank: p.rank || '', role: p.role || '', claimed: !!p.phoneHash, last4: p.phoneLast4 || '' };
}

function adm_state(pw, ev) {
  auth_(pw); useEv_(ev, true);
  return state_();
}
function state_() {
  var people = people_(), cfg = cfg_(), ch = choices_(), asg = map_(ASSIGN_H, 'assign'), pins = map_(PIN_H, 'pins');
  var evw = Assign.evaluate(people, ch, cfg, asg);
  var stayers = people.filter(function (p) {
    var c = ch[p.id] || emptyChoice_();
    if (p.role) return !!pins[p.id];
    return Assign.isStayStatus(c.status) || (c.status === 'none' && cfg.undecided === 'stay') || (pins[p.id] && c.status !== 'commute');
  }).map(function (p) { return p.id; });
  return {
    config: cfg, people: people.map(pubPerson_), choices: ch, assign: asg, pins: pins,
    published: !!Store.getKV(kk_('published')), warnings: evw, event: { id: CUR, name: events_().filter(function (x) { return x.id === CUR; })[0].name }, stayers: stayers,
    unplaced: stayers.filter(function (id) { return !asg[id]; }),
    sheetUrl: Store.spreadsheetUrl ? Store.spreadsheetUrl() : ''
  };
}

function cleanOptions_(list, d) {
  if (!list || !list.length) return d.options;
  var tmap = {}; d.traits.forEach(function (t) { tmap[t.id] = true; });
  var seen = {}, out = [];
  list.forEach(function (o, i) {
    var id = String(o.id || ('o' + i)).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20) || ('o' + i);
    while (seen[id]) id += 'x';
    seen[id] = true;
    var kind = ['commute', 'stay', 'pick', 'style'].indexOf(o.kind) >= 0 ? o.kind : 'stay';
    out.push({
      id: id, title: String(o.title || '').trim().slice(0, 40) || '선택지', desc: String(o.desc || '').trim().slice(0, 80), kind: kind,
      traits: kind === 'style' ? (o.traits || []).filter(function (t) { return tmap[t]; }) : [], use: !!o.use
    });
  });
  if (!out.some(function (o) { return o.use; })) throw new Error('사용 중인 선택지가 하나는 있어야 해요.');
  return out;
}

function adm_saveConfig(pw, ev, cfg) {
  auth_(pw); useEv_(ev, true);
  return Store.lock(function () {
    var d = Assign.defaultConfig();
    var c = {
      courseName: String(cfg.courseName || '').slice(0, 80),
      deadline: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(cfg.deadline || '')) ? String(cfg.deadline) : '',
      perRoom: Math.min(6, Math.max(1, Number(cfg.perRoom) || d.perRoom)),
      ondolCap: Math.min(8, Math.max(1, Number(cfg.ondolCap) || d.ondolCap)),
      balance: !!cfg.balance, undecided: cfg.undecided === 'stay' ? 'stay' : 'exclude', allowCross: !!cfg.allowCross,
      floorGender: cfg.floorGender || d.floorGender, floorOrder: (cfg.floorOrder || d.floorOrder).map(Number),
      rooms: (cfg.rooms || d.rooms).map(function (r) {
        return { id: String(r.id), floor: Number(r.floor), type: r.type === 'ondol' ? 'ondol' : 'bed', cap: r.cap ? Number(r.cap) : null, use: !!r.use, note: String(r.note || '') };
      }),
      traits: d.traits, conflicts: d.conflicts,
      options: cleanOptions_(cfg.options, d)
    };
    Store.setKV(kk_('config'), c);
    return state_();
  });
}

// mode: 'replace' = 명단을 새로 구성(이름·소속이 같은 사람은 기존 선택·전화번호 유지) | 'append' = 중복 제외하고 추가
function adm_importPeople(pw, ev, rows, mode) {
  auth_(pw); useEv_(ev, true);
  return Store.lock(function () {
    var cur = people_();
    var key = function (r) { return String(r.name).trim() + '|' + String(r.org || '').trim(); };
    var maxN = cur.reduce(function (m, p) { return Math.max(m, Number(String(p.id).replace(/\D/g, '')) || 0); }, 0);
    var byKey = {}; cur.forEach(function (p) { (byKey[key(p)] = byKey[key(p)] || []).push(p); });
    var out = mode === 'replace' ? cur.filter(function (p) { return !!p.role; }) : cur.slice();
    var seen = {}, bad = [];
    rows.forEach(function (r) {
      var name = String(r.name || '').trim(); if (!name) return;
      var g = r.gender === 'M' || r.gender === 'F' ? r.gender : '';
      var k = key({ name: name, org: r.org });
      var ex = (byKey[k] || []).filter(function (x) { return !seen[x.id]; })[0]; // 이름·소속이 같은 동명이인은 줄마다 따로 매칭
      var ph = null;
      if (r.phone) { var dd = digits_(r.phone); if (/^01\d{8,9}$/.test(dd)) ph = dd; else bad.push(name); }
      if (ex) {
        seen[ex.id] = true;
        if (mode === 'replace') { if (g) ex.gender = g; ex.rank = r.rank || ex.rank; out.push(ex); }
        else if (g && !ex.gender) ex.gender = g;
        if (ph) { ex.phoneHash = phoneHash_(ph); ex.phoneLast4 = ph.slice(-4); }
        return;
      }
      maxN++;
      var p = { id: 'p' + ('000' + maxN).slice(-3), name: name, gender: g, org: String(r.org || '').trim(), rank: String(r.rank || '').trim(), role: String(r.role || ''), phoneHash: '', phoneLast4: '' };
      if (ph) { p.phoneHash = phoneHash_(ph); p.phoneLast4 = ph.slice(-4); }
      out.push(p); (byKey[k] = byKey[k] || []).push(p); seen[p.id] = true;
    });
    Store.setTable(tn_('people'), PEOPLE_H, out);
    // 명단에서 빠진 사람의 선택·배정 정리
    var ids = {}; out.forEach(function (p) { ids[p.id] = true; });
    var ch = choices_(); Object.keys(ch).forEach(function (id) { if (!ids[id]) delete ch[id]; }); saveChoices_(ch);
    ['assign', 'pins'].forEach(function (n) {
      var m = map_(PIN_H, n); Object.keys(m).forEach(function (id) { if (!ids[id]) delete m[id]; }); saveMap_(n, PIN_H, m);
    });
    var st = state_(); st.badPhones = bad;
    return st;
  });
}

function applyPerson_(people, id, f) {
  var p = people.filter(function (x) { return x.id === id; })[0];
  if (!p) throw new Error('없는 사람입니다.');
  if (f.name !== undefined) { var nm = String(f.name).trim(); if (!nm) throw new Error('성명은 비울 수 없어요.'); p.name = nm; }
  if (f.gender !== undefined) p.gender = f.gender === 'M' || f.gender === 'F' ? f.gender : '';
  if (f.org !== undefined) p.org = String(f.org).trim();
  if (f.rank !== undefined) p.rank = String(f.rank).trim();
  if (f.role !== undefined) p.role = String(f.role).trim();
  if (f.phone !== undefined) {
    if (!digits_(f.phone)) { p.phoneHash = ''; p.phoneLast4 = ''; }
    else {
      var d = checkPhone_(f.phone), h = phoneHash_(d);
      if (people.some(function (x) { return x.id !== id && x.phoneHash === h; })) throw new Error(p.name + ': 이미 다른 사람에게 등록된 번호입니다.');
      p.phoneHash = h; p.phoneLast4 = d.slice(-4);
    }
  }
  return p;
}

function adm_updatePerson(pw, ev, id, f) {
  auth_(pw); useEv_(ev, true);
  return Store.lock(function () {
    var people = people_();
    var p = applyPerson_(people, id, f);
    Store.setTable(tn_('people'), PEOPLE_H, people);
    return { ok: true, last4: p.phoneLast4 };
  });
}

// 명단 표의 여러 수정을 한 번에 저장
function adm_updatePeople(pw, ev, list) {
  auth_(pw); useEv_(ev, true);
  return Store.lock(function () {
    var people = people_();
    (list || []).forEach(function (f) { applyPerson_(people, f.id, f); });
    Store.setTable(tn_('people'), PEOPLE_H, people);
    return state_();
  });
}

// 강사·보조강사·운영자 추가: 전화번호·선택 없이 이름·성별·구분만. 자동 배정에서 빠지고, 관리자가 빈방에 직접 배치한다.
function adm_addStaff(pw, ev, list) {
  auth_(pw); useEv_(ev, true);
  return Store.lock(function () {
    var people = people_();
    var maxN = people.reduce(function (m, p) { return Math.max(m, Number(String(p.id).replace(/\D/g, '')) || 0); }, 0);
    var asg = null, pins = null;
    (list || []).forEach(function (r) {
      var role = String(r.role || '강사').trim().slice(0, 10) || '강사';
      var name = String(r.name || '').trim().slice(0, 30) || role;   // 이름을 안 넣으면 구분(강사 등)을 이름처럼 쓴다
      maxN++;
      var newId = 'p' + ('000' + maxN).slice(-3);
      if (r.room) {   // 추가와 동시에 이 방에 배치(고정)
        asg = asg || map_(ASSIGN_H, 'assign'); pins = pins || map_(PIN_H, 'pins');
        asg[newId] = String(r.room); pins[newId] = String(r.room);
      }
      people.push({ id: newId, name: name, gender: r.gender === 'M' || r.gender === 'F' ? r.gender : '', org: String(r.org || '').trim(),
        rank: '', role: role, phoneHash: '', phoneLast4: '' });
    });
    Store.setTable(tn_('people'), PEOPLE_H, people);
    if (asg) { saveMap_('assign', ASSIGN_H, asg); saveMap_('pins', PIN_H, pins); }
    return state_();
  });
}

// 성별 일괄 입력: genders = ['M','F','',...] 를 명단 순서(order = id 배열)대로 적용
function adm_setGenders(pw, ev, ids, genders) {
  auth_(pw); useEv_(ev, true);
  return Store.lock(function () {
    var people = people_(), idx = {}; people.forEach(function (p) { idx[p.id] = p; });
    ids.forEach(function (id, i) {
      if (idx[id] && (genders[i] === 'M' || genders[i] === 'F')) idx[id].gender = genders[i];
    });
    Store.setTable(tn_('people'), PEOPLE_H, people);
    return state_();
  });
}

function adm_deletePeople(pw, ev, ids) {
  auth_(pw); useEv_(ev, true);
  return Store.lock(function () {
    var del = {}; ids.forEach(function (i) { del[i] = true; });
    Store.setTable(tn_('people'), PEOPLE_H, people_().filter(function (p) { return !del[p.id]; }));
    var ch = choices_(); ids.forEach(function (i) { delete ch[i]; }); saveChoices_(ch);
    ['assign', 'pins'].forEach(function (n) { var m = map_(PIN_H, n); ids.forEach(function (i) { delete m[i]; }); saveMap_(n, PIN_H, m); });
    return state_();
  });
}

function adm_resetPhone(pw, ev, id) {
  auth_(pw); useEv_(ev, true);
  return Store.lock(function () {
    var people = people_();
    people.forEach(function (p) { if (p.id === id) { p.phoneHash = ''; p.phoneLast4 = ''; } });
    Store.setTable(tn_('people'), PEOPLE_H, people);
    return state_();
  });
}

function adm_setChoice(pw, ev, id, choice) {
  auth_(pw); useEv_(ev, true);
  return Store.lock(function () {
    var ch = choices_();
    var st = ['none', 'commute', 'mate', 'stay', 'style'].indexOf(choice.status) >= 0 ? choice.status : 'none';
    var stay = Assign.isStayStatus(st);
    ch[id] = { id: id, status: st, mates: stay ? (choice.mates || []) : [], traits: stay ? (choice.traits || []) : [],
      sameWish: stay && !!choice.sameWish, note: choice.note || '', updatedAt: Store.now() };
    saveChoices_(ch);
    return state_();
  });
}

function adm_clearChoices(pw, ev) {
  auth_(pw); useEv_(ev, true);
  return Store.lock(function () { saveChoices_({}); saveMap_('assign', ASSIGN_H, {}); saveMap_('pins', PIN_H, {}); Store.setKV(kk_('published'), false); return state_(); });
}

// 배정 전부 지우기: 방 배정·관리자 고정(📌)을 모두 지우고 공개를 끈다. 연수생의 선택은 그대로 둔다.
function adm_resetAssign(pw, ev) {
  auth_(pw); useEv_(ev, true);
  return Store.lock(function () {
    saveMap_('assign', ASSIGN_H, {}); saveMap_('pins', PIN_H, {});
    Store.setKV(kk_('published'), false);
    return state_();
  });
}

function adm_run(pw, ev, keepPins) {
  auth_(pw); useEv_(ev, true);
  return Store.lock(function () {
    var people = people_(), cfg = cfg_(), ch = choices_();
    var pins = keepPins === false ? {} : map_(PIN_H, 'pins');
    if (keepPins === false) saveMap_('pins', PIN_H, {});
    var r = Assign.run(people, ch, cfg, pins);
    saveMap_('assign', ASSIGN_H, r.assign);
    Store.setKV(kk_('published'), false);
    return state_();
  });
}

// 사람을 방으로 옮김(관리자 수동 조정). room='' 이면 배정 해제. 옮기면 자동으로 '고정'된다.
function adm_move(pw, ev, id, room) {
  auth_(pw); useEv_(ev, true);
  return Store.lock(function () {
    var asg = map_(ASSIGN_H, 'assign'), pins = map_(PIN_H, 'pins');
    if (room) { asg[id] = String(room); pins[id] = String(room); } else { delete asg[id]; delete pins[id]; }
    saveMap_('assign', ASSIGN_H, asg); saveMap_('pins', PIN_H, pins);
    return state_();
  });
}

function adm_unpin(pw, ev, id) {
  auth_(pw); useEv_(ev, true);
  return Store.lock(function () {
    var pins = map_(PIN_H, 'pins'); delete pins[id]; saveMap_('pins', PIN_H, pins);
    return state_();
  });
}

function adm_publish(pw, ev, on) {
  auth_(pw); useEv_(ev, true);
  Store.setKV(kk_('published'), !!on);
  return state_();
}

// ── 연수(이벤트) 관리 ──────────────────────────────
function adm_events(pw) {
  auth_(pw);
  var out = events_().map(function (e) {
    CUR = e.id;
    var n = 0, pub = false;
    try { n = people_().length; pub = !!Store.getKV(kk_('published')); } catch (x) { /* 시트가 아직 없으면 0 */ }
    return { id: e.id, name: e.name, archived: !!e.archived, created: e.created, people: n, published: pub };
  });
  CUR = 'main';
  return out;
}

function newEventId_(used) {
  var chars = 'abcdefghjkmnpqrstuvwxyz23456789', id;
  do {
    id = '';
    for (var i = 0; i < 6; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
  } while (used[id] || id === 'main');
  return id;
}

// copyFrom: 방 설정(층별 성별·방 사용·정원 등)을 복사할 연수 id (없으면 기본값)
function adm_createEvent(pw, name, copyFrom) {
  auth_(pw);
  return Store.lock(function () {
    name = String(name || '').trim().slice(0, 60);
    if (!name) throw new Error('연수 이름을 입력해 주세요.');
    var evs = events_(), used = {};
    evs.forEach(function (e) { used[e.id] = true; });
    var id = newEventId_(used), cfg = null;
    if (copyFrom) { useEv_(copyFrom, true); cfg = Store.getKV(kk_('config')); }
    evs.push({ id: id, name: name, created: Store.now(), archived: false });
    Store.setKV('events', evs);
    CUR = id;
    if (cfg) Store.setKV(kk_('config'), cfg);
    Store.setKV(kk_('published'), false);
    return { id: id, events: adm_events(pw) };
  });
}

function adm_renameEvent(pw, ev, name) {
  auth_(pw);
  return Store.lock(function () {
    name = String(name || '').trim().slice(0, 60);
    if (!name) throw new Error('연수 이름을 입력해 주세요.');
    var evs = events_();
    evs.forEach(function (e) { if (e.id === ev) e.name = name; });
    Store.setKV('events', evs);
    return adm_events(pw);
  });
}

function adm_archiveEvent(pw, ev, flag) {
  auth_(pw);
  return Store.lock(function () {
    var evs = events_();
    evs.forEach(function (e) { if (e.id === ev) e.archived = !!flag; });
    Store.setKV('events', evs);
    return adm_events(pw);
  });
}
