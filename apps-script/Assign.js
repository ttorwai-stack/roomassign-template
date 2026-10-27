/**
 * 방 배정 알고리즘 (순수 함수 — Sheets·UI에 의존하지 않음. node에서 그대로 테스트한다)
 *
 * people : [{id, name, gender:'M'|'F'|'', org, rank, role}]
 * choices: {id: {status:'none'|'commute'|'mate'|'stay'|'style', mates:[id], traits:[traitId], sameWish:bool, note}}
 * cfg    : defaultConfig() 형태
 * pins   : {id: roomId}  관리자가 직접 고정한 배정(자동 배정에서 건드리지 않음)
 */
var Assign = (function () {

  var DEFAULT_TRAITS = [
    { id: 'snore',     label: '코를 골아요', short: '코골이', together: true },
    { id: 'sensitive', label: '소리·빛에 예민해요', short: '예민', together: true },
    { id: 'late',      label: '늦게 돌아올 수 있어요', short: '늦은 귀가', together: true },
    { id: 'early',     label: '일찍 자고 일찍 일어나요', short: '일찍 기상', together: true },
    { id: 'quiet',     label: '조용한 방이 좋아요', short: '조용 선호', together: true }
  ];
  // 같은 방이 되면 서로 불편한 조합
  var DEFAULT_CONFLICTS = [
    ['sensitive', 'snore'], ['sensitive', 'late'], ['early', 'late'],
    ['quiet', 'snore'], ['quiet', 'late']
  ];

  // 연수생 선택 화면의 선택지. kind: commute(출근) | stay(숙박) | pick(숙박+같은 방 지정) | style(숙박+자동배정 유형)
  function defaultOptions() {
    var same = '같은 스타일의 분과 같은 방을 원해요';
    return [
      { id: 'commute',   title: '출근',                              desc: '집에서 출퇴근해요',            kind: 'commute', traits: [], use: true },
      { id: 'stay',      title: '숙박',                              desc: '특별히 원하는 분은 없어요',    kind: 'stay',    traits: [], use: true },
      { id: 'pick',      title: '숙박 · 같은 방 쓸 분이 정해져 있어요', desc: '같은 방을 쓸 분을 선택합니다', kind: 'pick',    traits: [], use: true },
      { id: 'snore',     title: '숙박 · 코골이가 심해요',            desc: same, kind: 'style', traits: ['snore'], use: true },
      { id: 'sensitive', title: '숙박 · 예민해서 조용히 쓰고 싶어요', desc: same, kind: 'style', traits: ['sensitive', 'quiet'], use: true },
      { id: 'late',      title: '숙박 · 늦게 들어올 수 있어요',      desc: same, kind: 'style', traits: ['late'], use: true },
      { id: 'early',     title: '숙박 · 일찍 자고 일찍 일어나요',    desc: same, kind: 'style', traits: ['early'], use: true }
    ];
  }

  function defaultRooms() {
    var rooms = [];
    function add(id, floor, type, use, note) {
      rooms.push({ id: String(id), floor: floor, type: type, cap: null, use: use, note: note || '' });
    }
    [102, 103, 104, 108, 109, 110].forEach(function (n) { add(n, 1, 'bed', true); });
    add(101, 1, 'bed', false, '배치도에 빗금(사용 안 함)');
    add(105, 1, 'bed', false, '배치도에 빗금(사용 안 함)');
    [106, 107].forEach(function (n) { add(n, 1, 'ondol', false); });
    for (var f = 2; f <= 4; f++) {
      for (var n = 1; n <= 15; n++) {
        var ondol = (n === 9 || n === 10);
        add(f * 100 + n, f, ondol ? 'ondol' : 'bed', !ondol);
      }
    }
    return rooms;
  }

  function defaultConfig() {
    return {
      courseName: '',
      deadline: '',         // 신청 마감(한국시간 'YYYY-MM-DDTHH:mm'). 비우면 마감 없음
      perRoom: 3,           // 방당 기본 인원
      ondolCap: 3,          // 온돌방 정원
      balance: true,        // 방별 인원을 고르게(마지막 방 1명 방지)
      undecided: 'exclude', // 미응답자: 'exclude'(배정 제외) | 'stay'(숙박으로 처리)
      allowCross: false,    // 자기 성별 층이 모자랄 때 다른 성별 층의 빈 방 사용
      floorGender: { '1': 'M', '2': 'F', '3': 'M', '4': 'F' }, // 'M' | 'F' | '' (혼용)
      floorOrder: [1, 2, 3, 4], // 앞쪽 층부터 채움
      rooms: defaultRooms(),
      options: defaultOptions(),
      traits: DEFAULT_TRAITS,
      conflicts: DEFAULT_CONFLICTS
    };
  }

  function capOf(room, cfg) {
    if (room.cap) return Number(room.cap);
    return room.type === 'ondol' ? Number(cfg.ondolCap || cfg.perRoom) : Number(cfg.perRoom);
  }

  function isStayStatus(s) { return s === 'mate' || s === 'stay' || s === 'style'; }

  // ── 특성 궁합 ─────────────────────────────────────
  function pairGain(ca, cb, cfg) {
    var ta = (ca && ca.traits) || [], tb = (cb && cb.traits) || [];
    var s = 0, i;
    var tmap = {};
    cfg.traits.forEach(function (t) { tmap[t.id] = t; });
    for (i = 0; i < ta.length; i++) {
      if (tb.indexOf(ta[i]) >= 0) {
        s += (tmap[ta[i]] && tmap[ta[i]].together) ? 2 : 1;
        if ((ca && ca.sameWish) || (cb && cb.sameWish)) s += 1;
      }
    }
    cfg.conflicts.forEach(function (c) {
      if ((ta.indexOf(c[0]) >= 0 && tb.indexOf(c[1]) >= 0) ||
          (ta.indexOf(c[1]) >= 0 && tb.indexOf(c[0]) >= 0)) s -= 6;
    });
    return s;
  }

  // 코골이 여부가 다른 두 사람은 같은 방이 되면 크게 불편하므로 큰 감점
  function snoreOf(c) { return !!c && (c.traits || []).indexOf('snore') >= 0; }
  function pairScore(ca, cb, cfg) {
    var s = pairGain(ca, cb, cfg);
    if (snoreOf(ca) !== snoreOf(cb)) s -= 50;
    return s;
  }

  // 방 크기 계획(공평 원칙): 정원 K로 채우고 남는 인원만 작은 방으로
  //  K=2: 남는 1명 → 1인실 / K≥3: 남는 1명 → (K+1)명을 두 방으로 쪼갬(3인실이면 2인실 둘), 남는 r(≥2)명 → r인실 하나
  function planSizes(N, K) {
    var sizes = [];
    if (N <= 0) return sizes;
    if (K <= 1) { for (var i = 0; i < N; i++) sizes.push(1); return sizes; }
    var full = Math.floor(N / K), r = N - full * K;
    for (var f = 0; f < full; f++) sizes.push(K);
    if (r === 0) return sizes;
    if (r === 1 && K >= 3 && full >= 1) { sizes.pop(); var t = K + 1; sizes.push(Math.ceil(t / 2), Math.floor(t / 2)); }
    else sizes.push(r);
    return sizes;
  }

  // 상호 선택(서로를 지목)된 합방 묶음 계산
  function mutualGroups(ids, choices, byId) {
    var set = {}; ids.forEach(function (i) { set[i] = true; });
    var parent = {};
    ids.forEach(function (i) { parent[i] = i; });
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    ids.forEach(function (a) {
      var ca = choices[a];
      if (!ca || !isStayStatus(ca.status)) return;
      (ca.mates || []).forEach(function (b) {
        var cb = choices[b];
        if (!set[b] || !cb || !isStayStatus(cb.status)) return;
        if ((cb.mates || []).indexOf(a) < 0) return;
        var ga = byId[a].gender, gb = byId[b].gender;
        if (ga && gb && ga !== gb) return;
        parent[find(a)] = find(b);
      });
    });
    var groups = {};
    ids.forEach(function (i) { (groups[find(i)] = groups[find(i)] || []).push(i); });
    return Object.keys(groups).map(function (k) { return groups[k]; });
  }

  // ── 자동 배정 ─────────────────────────────────────
  function run(people, choices, cfg, pins) {
    pins = pins || {};
    var byId = {}; people.forEach(function (p) { byId[p.id] = p; });
    var roomById = {}; cfg.rooms.forEach(function (r) { roomById[r.id] = r; });
    var rooms = {};   // roomId -> [personId]
    var rg = {};      // roomId -> 'M'|'F'
    var assign = {};
    var unplaced = [], undecided = [], warnings = [];
    function occ(rid) { return rooms[rid] || (rooms[rid] = []); }
    function put(pid, rid) {
      occ(rid).push(pid); assign[pid] = rid;
      var g = byId[pid].gender; if (g && !rg[rid]) rg[rid] = g;
    }

    // 1) 숙박 대상 가려내기
    var stayers = [];
    people.forEach(function (p) {
      var c = choices[p.id] || { status: 'none' };
      var pinned = pins[p.id] && roomById[pins[p.id]];
      if (p.role) { if (pinned && c.status !== 'commute') stayers.push(p.id); return; } // 강사·운영자: 직접 배치한 경우에만
      if (pinned && c.status !== 'commute') stayers.push(p.id);
      else if (isStayStatus(c.status)) stayers.push(p.id);
      else if (c.status === 'none') {
        if (cfg.undecided === 'stay') stayers.push(p.id);
        else undecided.push(p.id);
      }
    });
    var valid = [];
    stayers.forEach(function (id) {
      if (!byId[id].gender && !(pins[id] && roomById[pins[id]])) unplaced.push({ id: id, reason: '성별 미입력' });
      else valid.push(id);
    });

    // 2) 고정 배정 먼저
    valid.forEach(function (id) { if (pins[id] && roomById[pins[id]]) put(id, pins[id]); });

    // 3) 합방 묶음(unit) 만들기
    var maxCap = Math.max(1, Number(cfg.perRoom) || 1); // 합방 희망 묶음도 방 정원을 넘을 수 없다
    var units = [];
    mutualGroups(valid, choices, byId).forEach(function (g) {
      var pinnedMembers = g.filter(function (i) { return assign[i]; });
      var rest = g.filter(function (i) { return !assign[i]; });
      if (pinnedMembers.length && rest.length) {
        var room = assign[pinnedMembers[0]], cap = capOf(roomById[room], cfg);
        rest.slice().forEach(function (i) {
          if (occ(room).length < cap) { put(i, room); rest.splice(rest.indexOf(i), 1); }
        });
      }
      if (!rest.length) return;
      if (rest.length > maxCap) {
        warnings.push({ type: 'group', text: '합방 희망 묶음이 방 정원(' + maxCap + '명)보다 커서 나눴습니다: ' + rest.map(function (i) { return byId[i].name; }).join(', ') });
        while (rest.length) units.push({ ids: rest.splice(0, maxCap) });
      } else units.push({ ids: rest });
    });
    units.forEach(function (u) { u.gender = byId[u.ids[0]].gender; u.size = u.ids.length; });

    // 4) 성별별 배정 — 공평 원칙
    //  · 방 정원(방당 인원)을 넘기지 않는다.
    //  · 모두 같은 정원으로 채우고, 나누어떨어지지 않는 인원만 작은 방으로 묶는다.
    //      정원 2: 남는 1명은 독실 / 정원 3: 남는 2명은 2인실 하나, 남는 1명은 2인실 둘(3인실 하나를 쪼갬)
    //  · 방 크기가 정해진 뒤에는 생활 유형이 맞도록 최대한 맞춘다(코골이끼리, 안 코골이끼리, 예민한 분 따로).
    ['M', 'F'].forEach(function (g) {
      var U = units.filter(function (u) { return u.gender === g; });
      if (!U.length) return;
      var K = Math.max(1, Number(cfg.perRoom) || 1);
      var N = U.reduce(function (s, u) { return s + u.size; }, 0);

      // 쓸 수 있는 빈 방(선호 층 순서)
      var order = {}; cfg.floorOrder.forEach(function (f, i) { order[f] = i; });
      var elig = cfg.rooms.filter(function (r) {
        if (!r.use) return false;
        if (rg[r.id] && rg[r.id] !== g) return false;
        if (occ(r.id).length > 0) return false;
        var fg = cfg.floorGender[String(r.floor)] || '';
        return fg === g || fg === '' || cfg.allowCross;
      });
      function own(r) { var fg = cfg.floorGender[String(r.floor)] || ''; return fg === g ? 0 : (fg === '' ? 1 : 2); }
      elig.sort(function (a, b) {
        var d = own(a) - own(b); if (d) return d;
        var oa = order[a.floor] === undefined ? 99 : order[a.floor];
        var ob = order[b.floor] === undefined ? 99 : order[b.floor];
        if (oa !== ob) return oa - ob;
        return Number(a.id) - Number(b.id);
      });

      // 방 크기 계획: 큰 방부터 앞쪽(선호) 방에 배정
      var sizes = planSizes(N, K).sort(function (a, b) { return b - a; });
      var slots = [];
      sizes.forEach(function (sz) {
        for (var i = 0; i < elig.length; i++) {
          if (capOf(elig[i], cfg) >= sz) { slots.push({ room: elig.splice(i, 1)[0], size: sz, members: [] }); return; }
        }
      });
      if (!slots.length) {
        U.forEach(function (u) { u.ids.forEach(function (id) { unplaced.push({ id: id, reason: '배정 가능한 방 없음' }); }); });
        return;
      }
      var cnt = {}; sizes.forEach(function (s) { cnt[s] = (cnt[s] || 0) + 1; });
      warnings.push({ type: 'info', text: (g === 'M' ? '남자' : '여자') + ' ' + N + '명 → ' + Object.keys(cnt).sort(function (a, b) { return b - a; }).map(function (s) { return s + '인실 ' + cnt[s] + '개'; }).join(' + ') + ' (모두 같은 정원, 남는 인원만 작은 방)' });

      var rem = function (s) { return s.size - s.members.length; };
      // 합방 희망 묶음 먼저(큰 묶음부터, 딱 맞는 방에)
      var singles = [];
      U.filter(function (u) { return u.size > 1; }).sort(function (a, b) { return b.size - a.size; }).forEach(function (u) {
        var best = null;
        slots.forEach(function (s) { if (rem(s) >= u.size && (!best || rem(s) < rem(best))) best = s; });
        if (best) { u.ids.forEach(function (m) { best.members.push(m); }); }
        else {
          warnings.push({ type: 'group', text: '정원에 맞게 배정하다 보니 합방 희망을 지키지 못했습니다: ' + u.ids.map(function (i) { return byId[i].name; }).join(', ') });
          u.ids.forEach(function (m) { singles.push(m); });
        }
      });
      U.filter(function (u) { return u.size === 1; }).forEach(function (u) { singles.push(u.ids[0]); });

      // 나머지는 유형 궁합이 가장 좋게 배치 (여러 순서로 시작해 가장 좋은 결과를 고른다)
      var base = slots.map(function (s) { return s.members.slice(); });
      var cap0 = slots.map(function (s) { return rem(s); });
      var bestAssign = null, bestScore = -Infinity;
      for (var attempt = 0; attempt < 12; attempt++) {
        var ord = singles.slice();
        if (attempt % 2 === 1) ord.reverse();
        for (var rot = 0; rot < Math.floor(attempt / 2); rot++) ord.push(ord.shift());
        var mem = base.map(function (m) { return m.slice(); }), left = cap0.slice();
        var fixedCount = base.map(function (m) { return m.length; });
        ord.forEach(function (id) {
          var bi = -1, bs = -Infinity;
          for (var si = 0; si < mem.length; si++) {
            if (left[si] <= 0) continue;
            var sc = 0; mem[si].forEach(function (o) { sc += pairScore(choices[id], choices[o], cfg); });
            sc -= si * 0.001; // 같으면 앞쪽(선호) 방부터
            if (sc > bs) { bs = sc; bi = si; }
          }
          if (bi >= 0) { mem[bi].push(id); left[bi]--; }
        });
        var movable = {}; singles.forEach(function (id) { movable[id] = true; });
        var scoreOf = function (id, list, skip) { var t = 0; list.forEach(function (o) { if (o !== id && o !== skip) t += pairScore(choices[id], choices[o], cfg); }); return t; };
        for (var pass = 0; pass < 20; pass++) {
          var improved = false;
          for (var a = 0; a < mem.length; a++) for (var b = a + 1; b < mem.length; b++) {
            for (var x = 0; x < mem[a].length; x++) for (var y = 0; y < mem[b].length; y++) {
              var pa = mem[a][x], pb = mem[b][y];
              if (!movable[pa] || !movable[pb]) continue;
              var cur = scoreOf(pa, mem[a]) + scoreOf(pb, mem[b]);
              var swp = scoreOf(pa, mem[b], pb) + scoreOf(pb, mem[a], pa);
              if (swp > cur + 1e-9) { mem[a][x] = pb; mem[b][y] = pa; improved = true; }
            }
          }
          if (!improved) break;
        }
        var total = 0;
        mem.forEach(function (list) { for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) total += pairScore(choices[list[i]], choices[list[j]], cfg); });
        if (total > bestScore + 1e-9) { bestScore = total; bestAssign = mem; }
      }
      slots.forEach(function (s, si) {
        bestAssign[si].forEach(function (id) { put(id, s.room.id); });
      });
      // 방이 모자라 못 앉은 사람
      var placedNow = {}; bestAssign.forEach(function (l) { l.forEach(function (id) { placedNow[id] = true; }); });
      singles.forEach(function (id) { if (!placedNow[id]) unplaced.push({ id: id, reason: '정원 부족' }); });
    });

    Object.keys(rooms).forEach(function (rid) { if (!rooms[rid].length) delete rooms[rid]; });
    var res = { rooms: rooms, assign: assign, unplaced: unplaced, undecided: undecided };
    res.warnings = warnings.concat(evaluate(people, choices, cfg, assign));
    return res;
  }

  // ── 점검(경고) ────────────────────────────────────
  function evaluate(people, choices, cfg, assign) {
    var byId = {}; people.forEach(function (p) { byId[p.id] = p; });
    var roomById = {}; cfg.rooms.forEach(function (r) { roomById[r.id] = r; });
    var rooms = {};
    Object.keys(assign).forEach(function (id) {
      if (byId[id]) (rooms[assign[id]] = rooms[assign[id]] || []).push(id);
    });
    var w = [];
    Object.keys(rooms).forEach(function (rid) {
      var r = roomById[rid], list = rooms[rid];
      if (!r) { w.push({ type: 'room', text: rid + '호: 설정에 없는 방입니다.' }); return; }
      var genders = {};
      list.forEach(function (i) { if (byId[i].gender) genders[byId[i].gender] = 1; });
      if (Object.keys(genders).length > 1) w.push({ type: 'gender', room: rid, text: rid + '호: 남녀가 섞여 있습니다.' });
      var fg = cfg.floorGender[String(r.floor)] || '';
      list.forEach(function (i) {
        var g = byId[i].gender;
        if (fg && g && g !== fg) {
          w.push({ type: 'floor', room: rid, text: byId[i].name + ': ' + (g === 'M' ? '남' : '여') + '자인데 ' + r.floor + '층은 ' + (fg === 'M' ? '남' : '여') + '자 층으로 설정됨' });
        }
      });
      if (list.length > capOf(r, cfg)) w.push({ type: 'cap', room: rid, text: rid + '호: 정원(' + capOf(r, cfg) + ') 초과' });
      if (!r.use) w.push({ type: 'room', room: rid, text: rid + '호: 사용 안 함으로 설정된 방에 배정됨' });
      for (var a = 0; a < list.length; a++) {
        for (var b = a + 1; b < list.length; b++) {
          if (pairScore(choices[list[a]], choices[list[b]], cfg) <= -6) {
            w.push({ type: 'conflict', room: rid, text: rid + '호: ' + byId[list[a]].name + '·' + byId[list[b]].name + ' 생활 유형이 맞지 않을 수 있음' });
          }
        }
      }
    });
    // 합방 희망 점검
    Object.keys(assign).forEach(function (id) {
      var c = choices[id];
      if (!byId[id] || !c || !isStayStatus(c.status)) return;
      (c.mates || []).forEach(function (m) {
        if (!byId[m]) return;
        var cm = choices[m] || {};
        var mutual = isStayStatus(cm.status) && (cm.mates || []).indexOf(id) >= 0;
        if (mutual && assign[m] !== assign[id]) w.push({ type: 'mate', text: byId[id].name + '·' + byId[m].name + ': 서로 선택했지만 다른 방에 배정됨' });
        if (!mutual && id < m) w.push({ type: 'mate', text: byId[id].name + ' → ' + byId[m].name + ': 상대가 수락하지 않아 합방 희망이 반영되지 않음' });
      });
    });
    return w;
  }

  return {
    defaultConfig: defaultConfig, defaultRooms: defaultRooms, defaultOptions: defaultOptions, capOf: capOf,
    run: run, evaluate: evaluate, mutualGroups: mutualGroups, pairGain: pairGain, pairScore: pairScore, planSizes: planSizes, isStayStatus: isStayStatus
  };
})();

if (typeof module !== 'undefined') module.exports = Assign;
