(function () {
  var CONFIG = window.SHOP_CONFIG;
  var createRun = window.ShopSim.createRun;
  var STATIONS = CONFIG.stations;
  var STAFF = CONFIG.staff;
  var DISHES = CONFIG.dishes;

  var game = {
    cash: CONFIG.startingCash,
    round: 1,
    outcome: null,
    assignment: { kitchen: ["aming"], cashier: ["aming"], serve: ["aming"] },
    menu: ["friedrice", "noodles"],
    selectedStaffId: "aming",
    hired: ["aming"],
    hiredTonight: null,
    guide: "goal",
    phase: "sim",
    run: null,
    lastReport: null,
    speed: 1,
    paused: false,
    accumulator: 0,
    lastTs: 0,
    closing: false,
    seedCursor: 1,
    simKey: "",
    hint: "",
    persona: {},
    flexHired: false,
    gear: {
      stoves: CONFIG.startingStoves,
      tills: CONFIG.startingTills,
      tables: 2
    },
    upgradeChoice: null,
    clockMin: CONFIG.dayStart,
    service: "closed",
    night: false,
    shiftIndex: 0,
    shifts: CONFIG.shifts.map(function (shift) {
      return { id: shift.id, name: shift.name, start: shift.start, end: shift.end };
    }),
    dayParts: [],
    modal: null,
    ffTarget: null
  };

  var configScreen = document.getElementById("screen-config");
  var simScreen = document.getElementById("screen-sim");
  var reportScreen = document.getElementById("screen-report");

  function dishById(id) {
    for (var i = 0; i < DISHES.length; i++) if (DISHES[i].id === id) return DISHES[i];
    return null;
  }

  function staffById(id) {
    for (var i = 0; i < STAFF.length; i++) if (STAFF[i].id === id) return STAFF[i];
    if (CONFIG.flexStaff && CONFIG.flexStaff.id === id) return CONFIG.flexStaff;
    return null;
  }

  function rosterPool() {
    var list = STAFF.slice();
    if (CONFIG.flexStaff) list.push(CONFIG.flexStaff);
    return list;
  }

  function activeRoster() {
    return rosterPool().filter(function (staff) {
      return game.hired.indexOf(staff.id) !== -1;
    });
  }

  function unhired() {
    return rosterPool().filter(function (staff) {
      return game.hired.indexOf(staff.id) === -1;
    });
  }

  function laborCost() {
    return CONFIG.staffCost * activeRoster().length;
  }

  function pickLabel(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function assignPersona() {
    game.persona = {};
    rosterPool().forEach(function (staff) {
      game.persona[staff.id] = {
        personality: pickLabel(CONFIG.personalities),
        mood: pickLabel(CONFIG.moods)
      };
    });
  }

  function personaOf(staffId) {
    if (!game.persona[staffId]) {
      game.persona[staffId] = {
        personality: pickLabel(CONFIG.personalities),
        mood: pickLabel(CONFIG.moods)
      };
    }
    return game.persona[staffId];
  }

  function moodMark(mood) {
    if (mood === "开心") return "mood-up";
    if (mood === "沮丧") return "mood-down";
    return "mood-ok";
  }

  function personaTags(personality, mood) {
    if (!personality && !mood) return "";
    return '<p class="persona"><span class="tag">' + escapeHtml(personality) + '</span><span class="tag ' + moodMark(mood) + '">' + escapeHtml(mood) + "</span></p>";
  }

  function staffKind(staffId) {
    if (staffId === "aming") return "staff-aming";
    if (staffId === "xiaoyu") return "staff-xiaoyu";
    if (staffId === "dazhuang") return "staff-dazhuang";
    return "staff-xiaozhou";
  }

  function stationName(id) {
    for (var i = 0; i < STATIONS.length; i++) if (STATIONS[i].id === id) return STATIONS[i].name;
    return id;
  }

  function efficiencyOf(staff, stationId) {
    if (!staff) return 0;
    var bonus = staff.specialty === "any" || staff.specialty === stationId ? staff.bonus : 0;
    return staff.efficiency * (1 + bonus);
  }

  function crewOf(stationId) {
    var raw = game.assignment[stationId];
    if (!raw) return [];
    if (typeof raw === "string") return [raw];
    return raw.filter(Boolean);
  }

  function ensureCrew(stationId) {
    if (!Array.isArray(game.assignment[stationId])) game.assignment[stationId] = crewOf(stationId);
    return game.assignment[stationId];
  }

  function comingRound() {
    return game.night ? game.round + 1 : game.round;
  }

  function postsOf(staffId) {
    var found = [];
    ["kitchen", "cashier", "serve"].forEach(function (id) {
      if (crewOf(id).indexOf(staffId) !== -1) found.push(id);
    });
    return found;
  }

  function stationOf(staffId) {
    var posts = postsOf(staffId);
    return posts.length ? posts[0] : null;
  }

  function shopTierFor(day) {
    if (day <= 1) return 1;
    if (day <= 4) return 2;
    return 3;
  }

  function shopTier() {
    return shopTierFor(game.round);
  }

  function tierLabel(tier) {
    if (tier === 1) return "小店";
    if (tier === 2) return "中店";
    return "大店";
  }

  function applyTier() {
    var tier = shopTier();
    if (!game.gear.stoves) game.gear.stoves = CONFIG.startingStoves;
    if (!game.gear.tills) game.gear.tills = CONFIG.startingTills;
    game.gear.tables = tier === 1 ? 2 : tier === 2 ? 3 : CONFIG.startingTables;
    refreshTables();
  }

  function stationCap(stationId) {
    if (stationId === "kitchen") return game.gear.stoves;
    if (stationId === "cashier") return game.gear.tills;
    return Infinity;
  }

  function gearNoun(stationId) {
    if (stationId === "kitchen") return "灶台";
    if (stationId === "cashier") return "收银台";
    return "";
  }

  function seatCount() {
    return game.gear.tables * (CONFIG.seatsPerTable || 2);
  }

  function trafficBand() {
    var tiers = CONFIG.traffic || [];
    return tiers[shopTier() - 1] || tiers[tiers.length - 1] || { name: "少", min: 7, max: 10 };
  }

  function gearLine() {
    return tierLabel(shopTier()) + " · 灶台 " + game.gear.stoves + " · 收银台 " + game.gear.tills + " · 吧台 " + seatCount() + " 个座位 · 人流" + trafficBand().name;
  }

  function crewNames(stationId) {
    return crewOf(stationId).map(function (id) {
      var staff = staffById(id);
      return staff ? staff.name : id;
    }).join("、");
  }

  function menuShare(dishId) {
    if (game.menu.indexOf(dishId) === -1) return null;
    var total = 0;
    game.menu.forEach(function (id) {
      var dish = dishById(id);
      if (dish) total += dish.weight;
    });
    var dish = dishById(dishId);
    if (!dish || !total) return null;
    return dish.weight / total;
  }

  function fmtTime(seconds) {
    var safe = Math.max(0, Math.floor(seconds + 1e-6));
    var m = Math.floor(safe / 60);
    var s = safe % 60;
    return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }

  function money(value) {
    var rounded = Math.round(value);
    return (rounded < 0 ? "-" : "") + Math.abs(rounded);
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function setText(id, text) {
    var node = document.getElementById(id);
    if (node) node.textContent = text;
  }

  function show(phase) {
    game.phase = phase;
    configScreen.hidden = true;
    reportScreen.hidden = true;
    simScreen.hidden = phase === "boot";
  }

  function renderChrome() {
    var cash = document.getElementById("cash");
    cash.textContent = money(game.cash);
    cash.classList.toggle("is-neg", game.cash < 0);
    setText("round", game.round + "/" + CONFIG.goalDays);
    setText("goal", String(CONFIG.goalCash));
    setText("clock-label", hourLabel(game.clockMin));
  }

  function hourLabel(min) {
    var wrapped = ((Math.floor(min) % 1440) + 1440) % 1440;
    var h = Math.floor(wrapped / 60);
    var m = wrapped % 60;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }

  function clampNum(value, lo, hi) {
    return Math.max(lo, Math.min(hi, value));
  }

  function clampShifts() {
    var open = CONFIG.dayStart;
    var close = CONFIG.lastHour * 60;
    var first = game.shifts[0];
    var second = game.shifts[1];
    first.start = clampNum(first.start, open, close - 180);
    first.end = clampNum(first.end, first.start + 60, close - 120);
    second.start = clampNum(second.start, first.end, close - 60);
    second.end = clampNum(second.end, second.start + 60, close);
  }

  function skyAt(min) {
    var h = ((Math.floor(min) % 1440) + 1440) % 1440;
    if (h >= 5 * 60 && h < 8 * 60) return "dawn";
    if (h >= 8 * 60 && h < 16 * 60 + 30) return "day";
    if (h >= 16 * 60 + 30 && h < 19 * 60 + 30) return "dusk";
    return "night";
  }

  function shiftSeconds(shift) {
    return Math.max(60, shift.end - shift.start) / CONFIG.minutesPerSimSecond;
  }

  function clockNote() {
    var sky = skyAt(game.clockMin);
    var light = sky === "dawn" ? "清晨" : sky === "day" ? "白天" : sky === "dusk" ? "黄昏" : "夜里";
    if (game.service === "open" && game.shifts[game.shiftIndex]) {
      return light + " · " + game.shifts[game.shiftIndex].name + "营业中";
    }
    if (game.night) return "夜里 · 打烊了，灯关着";
    if (game.shiftIndex < game.shifts.length) {
      var next = game.shifts[game.shiftIndex];
      return light + " · " + next.name + " " + hourLabel(next.start) + " 开门";
    }
    return light + " · 今天的班结束了";
  }

  var GUIDE_STEPS = {
    goal: { kicker: "目标", text: "你有 1000 元。10 天内把现金做到 10000。第 10 天打烊时结算，到了就成功。", selector: "#goal-stat", ack: true },
    staff: { kicker: "第 1 步 · 分工", text: "点阿明。今天后厨、收银、传菜都是他一个人的活。", selector: "#modal [data-staff='aming']" },
    posts: { kicker: "第 2 步 · 分工", text: "再点岗位。点「后厨」。他已经在岗上，这一下不会把他调走。", selector: "#modal [data-post='kitchen']" },
    close: { kicker: "第 3 步", text: "点「收起」，回到店里。", selector: "#modal [data-action='close-modal']" },
    rush: { kicker: "第 4 步", text: "点「快进到午市」开门。一天有午市和晚市，两班都会来客人。", selector: "[data-action='ff-shift']" },
    watch: { kicker: "第 5 步 · 面板", text: "点店里的人，打开他的面板。", selector: "#crew .worker" },
    panel: { kicker: "第 6 步 · 面板", text: "这里能看到他在做什么，也能改分工。看完点「关闭」。", selector: "#inspect.is-open" },
    hire: { kicker: "打烊", text: "今晚三选一：请一个人、加一台灶，或加一台收银台。灶和收银台决定后厨、收银能站几个人。", selector: "#modal [data-upgrade='hire']" },
    place: { kicker: "分工", text: "点「去传菜」，给新人一个岗位。擅长的岗位更快。", selector: "#modal [data-post='serve']" }
  };

  function guideStep() {
    if (game.round !== 1) return null;
    return GUIDE_STEPS[game.guide] || null;
  }

  function paintCoach() {
    var root = document.getElementById("guide");
    var step = guideStep();
    var target = step ? document.querySelector(step.selector) : null;
    if (!root) return;
    if (!step || !target) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    if (game.guideShown !== game.guide) {
      game.guideShown = game.guide;
      target.scrollIntoView({ block: "center", inline: "nearest" });
    }
    var rect = target.getBoundingClientRect();
    var pad = 8;
    var l = Math.max(0, rect.left - pad);
    var t = Math.max(0, rect.top - pad);
    var r = Math.min(window.innerWidth, rect.right + pad);
    var b = Math.min(window.innerHeight, rect.bottom + pad);
    var north = root.querySelector(".guide-n");
    var east = root.querySelector(".guide-e");
    var south = root.querySelector(".guide-s");
    var west = root.querySelector(".guide-w");
    north.style.cssText = "left:0;top:0;width:100%;height:" + t + "px";
    south.style.cssText = "left:0;top:" + b + "px;width:100%;bottom:0";
    west.style.cssText = "left:0;top:" + t + "px;width:" + l + "px;height:" + Math.max(0, b - t) + "px";
    east.style.cssText = "left:" + r + "px;top:" + t + "px;right:0;height:" + Math.max(0, b - t) + "px";
    var ring = document.getElementById("guide-ring");
    ring.style.left = l + "px";
    ring.style.top = t + "px";
    ring.style.width = Math.max(0, r - l) + "px";
    ring.style.height = Math.max(0, b - t) + "px";
    document.getElementById("guide-kicker").textContent = step.kicker;
    document.getElementById("guide-text").textContent = step.text;
    var next = document.getElementById("guide-next");
    if (next) next.hidden = !step.ack;
    var box = document.getElementById("guide-box");
    var width = box.offsetWidth || 300;
    var height = box.offsetHeight || 96;
    var left = rect.left;
    if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
    if (left < 12) left = 12;
    var top = rect.bottom + 14;
    if (top + height > window.innerHeight - 12) top = Math.max(12, rect.top - height - 14);
    box.style.left = left + "px";
    box.style.top = top + "px";
  }

  function startBlockReason() {
    if (!game.menu.length) return "至少选一道菜";
    if (game.menu.length > CONFIG.maxMenu) return "最多选择两种菜品";
    return "";
  }

  function timeControls() {
    return game.shifts.map(function (shift, index) {
      var locked = !game.night && index < game.shiftIndex;
      return (
        '<div class="time-shift">' +
          "<strong>" + shift.name + "</strong>" +
          "<b>" + hourLabel(shift.start) + " – " + hourLabel(shift.end) + "</b>" +
          '<button type="button" data-shift-time="' + index + '" data-edge="start" data-delta="-1"' + (locked ? " disabled" : "") + ">开始 −30分</button>" +
          '<button type="button" data-shift-time="' + index + '" data-edge="start" data-delta="1"' + (locked ? " disabled" : "") + ">开始 +30分</button>" +
          '<button type="button" data-shift-time="' + index + '" data-edge="end" data-delta="-1"' + (locked ? " disabled" : "") + ">结束 −30分</button>" +
          '<button type="button" data-shift-time="' + index + '" data-edge="end" data-delta="1"' + (locked ? " disabled" : "") + ">结束 +30分</button>" +
        "</div>"
      );
    }).join("");
  }

  function prepMarkup() {
    var people = activeRoster();
    var staffHtml = people.map(function (staff) {
      var posts = postsOf(staff.id);
      var selected = game.selectedStaffId === staff.id;
      var where = posts.length ? posts.map(stationName).join("、") : "待命";
      return (
        '<button type="button" class="card staff' + (selected ? " is-selected" : "") + '" data-staff="' + staff.id + '">' +
          staffFigure(staff.id) +
          "<strong>" + staff.name + "</strong>" +
          '<em class="trait">' + staff.trait + "</em>" +
          '<span class="meta">' + where + "</span>" +
        "</button>"
      );
    }).join("");

    var postHtml = STATIONS.map(function (station) {
      var list = crewOf(station.id);
      var cap = stationCap(station.id);
      var names = list.map(function (id) {
        var person = staffById(id);
        if (!person) return id;
        return person.name + " " + efficiencyOf(person, station.id).toFixed(1) + "×";
      }).join("、");
      var countLabel = cap === Infinity ? list.length + " 人 · 不限" : list.length + " / " + cap + " 人";
      var limit = station.id === "serve"
        ? "传菜不限人数"
        : gearNoun(station.id) + " " + cap + " 台，人不能比设备多";
      return (
        '<button type="button" class="post post-' + station.id + (list.length ? "" : " is-empty") + '" data-post="' + station.id + '">' +
          '<span class="post-kicker">' + station.name + "</span>" +
          (list.length
            ? "<strong>" + countLabel + "</strong>" +
              '<span class="eff is-hot">' + names + "</span>"
            : '<strong class="placeholder">空着</strong><span class="eff">没人的话，单子会卡在这里</span>') +
          '<span class="meta">' + limit + "</span>" +
        "</button>"
      );
    }).join("");

    var dishHtml = DISHES.map(function (dish) {
      var on = game.menu.indexOf(dish.id) !== -1;
      return (
        '<button type="button" class="card dish' + (on ? " is-on" : "") + '" data-dish="' + dish.id + '" aria-pressed="' + on + '">' +
          dishArt(dish.id) +
          "<strong>" + dish.name + "</strong>" +
          '<span class="meta">售价 ' + dish.price + " · 成本 " + dish.cost + "</span>" +
          '<span class="meta">制作 ' + dish.cookTime + " 秒</span>" +
        "</button>"
      );
    }).join("");

    var jump = "";
    if (game.outcome) jump = "";
    else if (game.night) jump = '<button type="button" data-action="ff-dawn" class="primary">快进到天亮</button>';
    else if (game.service !== "open" && game.shiftIndex < game.shifts.length) {
      jump = '<button type="button" data-action="ff-shift" class="primary">快进到' + game.shifts[game.shiftIndex].name + "</button>";
    }
    var prepLead = game.night ? "排明天的分工和菜单。" : "点人，再点岗位。菜单最多两种。";
    return (
      '<p class="lead">' + prepLead + "</p>" +
      '<p class="gear-line">' + gearLine() + "</p>" +
      '<div class="config-grid">' +
        '<section class="panel"><header><h2>两班时间</h2></header>' + timeControls() + "</section>" +
        '<section class="panel"><header><h2>员工</h2><p>点人，再点岗位。再点一次，他就离开这个岗位。</p></header><div class="card-row">' + staffHtml + "</div></section>" +
        '<section class="panel"><header><h2>岗位</h2></header><div class="post-row">' + postHtml + "</div></section>" +
        '<section class="panel"><header><h2>菜单</h2><p>最多两种。</p></header><div class="card-row">' + dishHtml + "</div></section>" +
      "</div>" +
      '<footer class="action-bar">' +
        (game.hint ? '<p class="hint is-warn">' + escapeHtml(game.hint) + "</p>" : "") +
        '<button type="button" data-action="close-modal">收起</button>' +
        jump +
      "</footer>"
    );
  }

  function stoolBlock(index) {
    var pos = barSeatSpots()[index];
    return '<div class="bar-stool" style="left:' + pos.x + "%;top:" + pos.y + '%"></div>';
  }

  function waitStoolBlock(index) {
    var pos = WAIT_STOOLS[index];
    return '<div class="wait-stool" style="left:' + pos.x + "%;top:" + pos.y + '%"></div>';
  }

  function renderSimShell() {
    var stools = "";
    var waitStools = "";
    var seatTotal = seatCount();
    var s;
    for (s = 0; s < seatTotal; s++) stools += stoolBlock(s);
    for (s = 0; s < WAIT_STOOLS.length; s++) waitStools += waitStoolBlock(s);
    simScreen.innerHTML =
      '<div class="sim-top">' +
        '<div class="dayclock">' +
          '<div class="clock-widget">' +
            '<svg class="clock-face" viewBox="0 0 100 100" aria-hidden="true">' +
              '<circle cx="50" cy="50" r="46"></circle>' +
              '<line id="hour-hand" x1="50" y1="50" x2="50" y2="24"></line>' +
              '<line id="minute-hand" x1="50" y1="50" x2="50" y2="16"></line>' +
              '<circle cx="50" cy="50" r="3"></circle>' +
            "</svg>" +
            '<i id="luminary" class="luminary"></i>' +
          "</div>" +
          '<div><strong id="clock-read">06:00</strong><span id="clock-note">清晨</span></div>' +
        "</div>" +
        '<div class="timebar" aria-hidden="true"><div id="time-fill"></div></div>' +
        '<div class="transport" id="transport"></div>' +
      "</div>" +
      '<p class="pause-flag" id="pause-flag" hidden>已暂停</p>' +
      '<p class="coach" id="coach" hidden></p>' +
      '<div class="shift" id="shift"></div>' +
      '<div class="sim-layout">' +
        '<div class="room-wrap" id="room-wrap" data-sky="dawn">' +
        '<div class="room izakaya" id="room">' +
          '<div class="shop-frame" aria-hidden="true"></div>' +
          '<div class="backsplash" aria-hidden="true"></div>' +
          '<div class="shop-bar" aria-hidden="true"></div>' +
          '<section class="zone kitchen" id="zone-kitchen">' +
            '<h2>后厨</h2>' +
            '<div class="stove"><div class="gear-row" id="stove-row"></div><span class="stove-art" id="stove-art"></span><span class="meter"><i id="stove-fill"></i></span><em id="stove-label">空闲</em></div>' +
            '<div class="fridge"></div>' +
            '<p class="zone-status" id="status-kitchen"></p>' +
          "</section>" +
          '<section class="zone cashier" id="zone-cashier">' +
            '<h2>收银台</h2>' +
            '<div class="counter"><div class="gear-row" id="till-row"></div><span class="meter"><i id="till-fill"></i></span><em id="till-label">空闲</em></div>' +
            '<p class="zone-status" id="status-cashier"></p>' +
          "</section>" +
          '<section class="zone dining" id="zone-dining"><p class="seat-note" id="seat-note"></p><div class="plant"></div></section>' +
          stools +
          '<div class="entrance"><span>门口</span><p id="door-note">客人即将进门</p></div>' +
          '<div class="sidewalk" aria-hidden="true"></div>' +
          waitStools +
          '<div class="street" aria-hidden="true"></div>' +
          '<div class="street-people" id="street-people"></div>' +
          '<div class="crew" id="crew"></div>' +
          '<div class="guests" id="guests"></div>' +
        "</div>" +
        '<div class="sky" id="sky"></div>' +
        "</div>" +
        '<aside class="panel live">' +
          '<section class="inspect" id="inspect"><p>点一个人，看他在做什么。</p></section>' +
          '<header><h2>今天</h2><p id="labor-note">人工每天 ' + laborCost() + " 元</p></header>" +
          '<dl class="metrics">' +
            '<div><dt>完成</dt><dd id="live-done">0</dd></div>' +
            '<div><dt>净利</dt><dd id="live-profit">0</dd></div>' +
            '<div><dt>流失</dt><dd id="live-left">0</dd></div>' +
          "</dl>" +
        "</aside>" +
      "</div>";
    game.simKey = "";
    game.sprites = {};
    game.crewSprites = {};
    syncTransport();
  }

  function barSeatSpots() {
    var count = Math.max(1, seatCount());
    var spots = [];
    var left = 18;
    var right = 82;
    var i;
    for (i = 0; i < count; i++) {
      var x = count === 1 ? (left + right) / 2 : left + (right - left) * (i / (count - 1));
      spots.push({ x: x, y: 37.5 });
    }
    return spots;
  }

  var WAIT_STOOLS = [
    { x: 18, y: 68 },
    { x: 30, y: 68 },
    { x: 42, y: 68 },
    { x: 54, y: 68 },
    { x: 66, y: 68 }
  ];
  var DOOR = { x: 16, y: 58 };
  var OUTSIDE = { wait: 1, "wait-front": 1, "pay-line": 1, paying: 1, "food-ready": 1 };

  function seatPos(table, seat) {
    var spots = barSeatSpots();
    var index = (table || 0) * (CONFIG.seatsPerTable || 2) + (seat || 0);
    if (index < 0) index = 0;
    if (index >= spots.length) index = spots.length - 1;
    return spots[index];
  }

  function placeOf(person) {
    if (person.table != null && person.where !== "leaving" && person.where !== "walkout") {
      return seatPos(person.table, person.seat);
    }
    if (person.where === "wait" || OUTSIDE[person.where]) {
      var stool = WAIT_STOOLS[Math.max(0, Math.min(person.slot || 0, WAIT_STOOLS.length - 1))];
      return { x: stool.x, y: stool.y };
    }
    if (person.where === "seating" || person.where === "eating" || person.where === "seated") return seatPos(person.table, person.seat);
    if (person.where === "leaving" || person.where === "walkout") return { x: person.id % 2 ? 108 : -8, y: 90 };
    return DOOR;
  }

  function shortDish(id) {
    if (id === "friedrice") return "饭";
    if (id === "noodles") return "面";
    if (id === "signature") return "菜";
    return "";
  }

  function dishArt(id) {
    if (id === "noodles") {
      return '<svg class="dish-art" viewBox="0 0 36 36" aria-hidden="true"><ellipse cx="18" cy="24" rx="13" ry="6" fill="#f7f1e4" stroke="#1b1916" stroke-width="1.7"/><path d="M8 16c2.2 2.4 2.2-2.2 4.4 0s2.2 2.4 4.4 0 2.2-2.2 4.4 0 2.2 2.4 4.6 0" fill="none" stroke="#e2b656" stroke-width="1.8" stroke-linecap="round"/><path d="M9 12.5c2 2 2-2 4 0s2 2 4 0 2-2 4 0 2 2 4.2 0" fill="none" stroke="#f0d48a" stroke-width="1.6" stroke-linecap="round"/><path d="M11 19.5c2 1.6 2-1.4 4 0s2 1.6 4 0 2-1.4 4 0" fill="none" stroke="#c9844a" stroke-width="1.5" stroke-linecap="round"/></svg>';
    }
    if (id === "signature") {
      return '<svg class="dish-art" viewBox="0 0 36 36" aria-hidden="true"><ellipse cx="18" cy="22" rx="14" ry="7" fill="#f7f1e4" stroke="#1b1916" stroke-width="1.7"/><ellipse cx="16" cy="18" rx="7" ry="4.2" fill="#a33b32" stroke="#1b1916" stroke-width="1.4"/><circle cx="24" cy="16" r="2.1" fill="#2f6f4e" stroke="#1b1916" stroke-width="1.2"/><path d="M12 15h6" stroke="#f4c95d" stroke-width="1.4" stroke-linecap="round"/></svg>';
    }
    return '<svg class="dish-art" viewBox="0 0 36 36" aria-hidden="true"><ellipse cx="18" cy="24" rx="13" ry="6" fill="#f7f1e4" stroke="#1b1916" stroke-width="1.7"/><ellipse cx="18" cy="18" rx="8" ry="5" fill="#f0c14e" stroke="#1b1916" stroke-width="1.4"/><circle cx="14" cy="17" r="1.1" fill="#c9844a"/><circle cx="18" cy="19" r="1.1" fill="#e07a3d"/><circle cx="21" cy="16.5" r="1.1" fill="#c9844a"/></svg>';
  }

  function lookOf(id) {
    var n = (id * 1103515245 + 12345) >>> 0;
    return {
      skin: n % 6,
      hair: (n >>> 3) % 6,
      style: (n >>> 6) % 5,
      shirt: (n >>> 9) % 8,
      extra: (n >>> 12) % 5
    };
  }

  function staffFigure(staffId) {
    return '<span class="mini-staff ' + staffKind(staffId) + '" aria-hidden="true"><span class="mark"></span><span class="face"></span><span class="torso"></span></span>';
  }

  function guestClass(person) {
    var look = lookOf(person.id);
    var styles = ["short", "bob", "bun", "long", "spike"];
    var extras = ["none", "glasses", "hat", "beard", "ribbon"];
    var picked = game.inspect && game.inspect.kind === "guest" && game.inspect.key === person.key;
    return "guest skin-" + look.skin + " hairc-" + look.hair + " style-" + styles[look.style] + " shirt-" + look.shirt + " extra-" + extras[look.extra] +
      (person.late ? " is-late" : "") +
      (person.where === "eating" ? " is-eating" : "") +
      (person.where === "seated" ? " is-seated" : "") +
      (person.where === "wait" ? " is-waiting" : "") +
      (person.where === "leaving" || person.where === "walkout" ? " is-leaving" : "") +
      (picked ? " is-picked" : "");
  }

  function syncGuests(people) {
    var layer = document.getElementById("guests");
    if (!layer) return;
    var keep = {};
    people.forEach(function (person) {
      keep[person.key] = true;
      var el = layer.querySelector('[data-key="' + person.key + '"]');
      var spot = placeOf(person);
      if (!game.sprites[person.key]) {
        var fromStreet = person.where === "wait";
        game.sprites[person.key] = fromStreet
          ? { x: person.id % 2 ? 112 : -12, y: 90 }
          : { x: spot.x, y: spot.y };
      }
      var sprite = game.sprites[person.key];
      var dx = spot.x - sprite.x;
      var dy = spot.y - sprite.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var step = 0.7;
      if (dist > step) {
        sprite.x += dx / dist * step;
        sprite.y += dy / dist * step;
      } else {
        sprite.x = spot.x;
        sprite.y = spot.y;
      }
      if (!el) {
        el = document.createElement("button");
        el.type = "button";
        el.dataset.key = person.key;
        el.innerHTML = '<span class="hair"></span><span class="face"></span><span class="torso"></span><i class="mini-plate">' + dishArt(person.dishId) + "</i><em></em>";
        layer.appendChild(el);
      }
      var meta = guestClass(person);
      if (el.dataset.meta !== meta) {
        el.dataset.meta = meta;
        el.className = meta;
        el.querySelector("em").textContent = person.where === "walkout"
          ? "离开"
          : person.where === "eating"
            ? shortDish(person.dishId)
            : "#" + person.id;
      }
      el.style.left = sprite.x + "%";
      el.style.top = sprite.y + "%";
    });
    Array.prototype.forEach.call(layer.children, function (child) {
      if (!keep[child.dataset.key]) child.remove();
    });
    Object.keys(game.sprites).forEach(function (key) {
      if (!keep[key]) delete game.sprites[key];
    });
  }

  var CREW_HOME = {
    kitchen: [{ x: 30, y: 28 }, { x: 22, y: 26 }, { x: 36, y: 26 }, { x: 18, y: 29 }],
    cashier: [{ x: 68, y: 28 }, { x: 76, y: 26 }, { x: 62, y: 26 }, { x: 80, y: 29 }],
    serve: [{ x: 48, y: 29 }, { x: 54, y: 27 }, { x: 42, y: 27 }, { x: 58, y: 29 }]
  };

  function crewStatus(station, queueWord) {
    if (!station.staffIds || !station.staffIds.length) return "没人 · 卡住 · " + queueWord + " " + station.queueLength;
    return station.staffName + " · " + station.crew.length + " 人 · " + queueWord + " " + station.queueLength;
  }

  function crewSpot(stationId, member) {
    var homes = CREW_HOME[stationId] || CREW_HOME.serve;
    var home = homes[member.index % homes.length];
    if (stationId === "serve" && member.busy && member.table != null) {
      var seat = seatPos(member.table, member.seat || 0);
      return {
        x: home.x + (seat.x - home.x) * member.progress,
        y: home.y
      };
    }
    return home;
  }

  function syncCrew(state) {
    var layer = document.getElementById("crew");
    if (!layer) return;
    if (!game.crewSprites) game.crewSprites = {};
    var best = {};
    var rank = { serve: 3, cashier: 2, kitchen: 1 };
    state.stations.forEach(function (station) {
      (station.crew || []).forEach(function (member) {
        var score = (member.busy ? 10 : 0) + (rank[station.id] || 0);
        var prev = best[member.staffId];
        if (!prev || score > prev.score) best[member.staffId] = { score: score, station: station.id, member: member };
      });
    });
    var keep = {};
    var bench = 0;
    activeRoster().forEach(function (staff) {
      keep[staff.id] = true;
      var chosen = best[staff.id];
      var el = layer.querySelector('[data-who="' + staff.id + '"]');
      if (!el) {
        el = document.createElement("button");
        el.type = "button";
        el.dataset.who = staff.id;
        el.innerHTML = '<span class="mark"></span><span class="face"></span><span class="torso"></span><em></em><i class="tray" hidden></i>';
        layer.appendChild(el);
      }
      var stationId = chosen ? chosen.station : "";
      var member = chosen ? chosen.member : null;
      el.dataset.station = stationId;
      var picked = game.inspect && game.inspect.kind === "staff" && game.inspect.staffId === staff.id;
      el.className = "worker " + staffKind(staff.id) + (picked ? " is-picked" : "");
      el.querySelector("em").textContent = staff.name;
      var spot = member
        ? crewSpot(stationId, member)
        : { x: 72 + bench * 6, y: 54 };
      if (!member) bench += 1;
      if (!game.crewSprites[staff.id]) game.crewSprites[staff.id] = { x: spot.x, y: spot.y };
      var body = game.crewSprites[staff.id];
      body.x += (spot.x - body.x) * 0.16;
      body.y += (spot.y - body.y) * 0.16;
      el.style.left = body.x + "%";
      el.style.top = body.y + "%";
      var tray = el.querySelector(".tray");
      if (stationId === "serve" && member && member.dishId) {
        tray.hidden = false;
        if (tray.dataset.dish !== member.dishId) {
          tray.dataset.dish = member.dishId;
          tray.innerHTML = dishArt(member.dishId);
        }
      } else if (tray) {
        tray.hidden = true;
        tray.dataset.dish = "";
      }
    });
    Array.prototype.forEach.call(layer.children, function (child) {
      if (!keep[child.dataset.who]) child.remove();
    });
    Object.keys(game.crewSprites).forEach(function (id) {
      if (!keep[id]) delete game.crewSprites[id];
    });
  }

  function paintGear(id, count, busy, kind) {
    var row = document.getElementById(id);
    if (!row) return;
    var safeCount = Math.max(0, count || 0);
    var sig = kind + ":" + safeCount + ":" + busy;
    if (row.dataset.sig === sig) return;
    row.dataset.sig = sig;
    var html = "";
    for (var i = 0; i < safeCount; i++) {
      html += '<i class="' + kind + (i < busy ? " is-busy" : "") + '"></i>';
    }
    row.innerHTML = html;
  }

  function idleState() {
    var stations = STATIONS.map(function (station) {
      var ids = crewOf(station.id);
      return {
        id: station.id,
        name: station.name,
        staffIds: ids,
        staffName: crewNames(station.id) || "空缺",
        queueLength: 0,
        crew: ids.map(function (id, index) {
          var staff = staffById(id);
          return {
            staffId: id,
            staffName: staff ? staff.name : id,
            index: index,
            efficiency: efficiencyOf(staff, station.id),
            dishId: "",
            dishName: "",
            progress: 0,
            table: null,
            busy: false
          };
        })
      };
    });
    return {
      people: [],
      events: [],
      stations: stations,
      stoves: [],
      tills: [],
      stove: null,
      till: null,
      revenue: 0,
      ingredientCost: 0,
      completed: 0,
      left: 0,
      gear: {
        stoves: game.gear.stoves,
        tills: game.gear.tills,
        tables: game.gear.tables,
        seats: seatCount(),
        taken: 0,
        free: seatCount()
      }
    };
  }

  function rolled() {
    var total = { revenue: 0, ingredientCost: 0, completed: 0, left: 0 };
    game.dayParts.forEach(function (part) {
      total.revenue += part.revenue;
      total.ingredientCost += part.ingredientCost;
      total.completed += part.completed;
      total.left += part.left;
    });
    return total;
  }

  function paintWorld() {
    var mins = ((Math.floor(game.clockMin) % 1440) + 1440) % 1440;
    var minutes = mins % 60;
    var hours = Math.floor(mins / 60) % 12;
    var hourHand = document.getElementById("hour-hand");
    var minuteHand = document.getElementById("minute-hand");
    if (hourHand) hourHand.setAttribute("transform", "rotate(" + (hours * 30 + minutes * 0.5) + " 50 50)");
    if (minuteHand) minuteHand.setAttribute("transform", "rotate(" + (minutes * 6) + " 50 50)");
    setText("clock-read", hourLabel(mins));
    setText("clock-note", clockNote());
    setText("clock-label", hourLabel(mins));
    var sky = skyAt(mins);
    var wrap = document.getElementById("room-wrap");
    var lit = game.service === "open" || sky !== "night";
    if (wrap) {
      wrap.dataset.sky = sky;
      wrap.dataset.size = String(shopTier());
      wrap.classList.toggle("is-night", sky === "night");
      wrap.classList.toggle("is-dark", sky === "night" && !lit);
      wrap.classList.toggle("is-lit", sky === "night" && lit);
    }
    var luminary = document.getElementById("luminary");
    if (luminary) {
      var ang = ((mins - CONFIG.dayStart + 1440) % 1440) / 1440 * 360;
      luminary.style.transform = "rotate(" + ang + "deg) translateY(-28px)";
      luminary.classList.toggle("is-moon", sky === "night");
    }
    var fill = document.getElementById("time-fill");
    var bar = fill ? fill.parentNode : null;
    if (fill) {
      var dayPos = (mins - CONFIG.dayStart + 1440) % 1440;
      fill.style.width = (dayPos / 1440) * 100 + "%";
    }
    if (bar && bar.classList) bar.classList.toggle("is-night", sky === "night");
    var flag = document.getElementById("pause-flag");
    if (flag) {
      if (game.outcome) {
        flag.hidden = false;
        flag.textContent = game.outcome === "win" ? "成功" : "失败";
      } else if (game.night && game.service !== "open") {
        flag.hidden = false;
        flag.textContent = "已打烊 · 灯关了";
      } else {
        flag.hidden = !game.paused;
        flag.textContent = "已暂停";
      }
    }
  }

  function controlsHtml() {
    if (game.service === "open") {
      return '<button type="button" data-action="pause">暂停</button>' +
        '<button type="button" data-action="resume">继续</button>' +
        '<button type="button" data-action="speed" data-speed="1">1×</button>' +
        '<button type="button" data-action="speed" data-speed="2">2×</button>' +
        '<button type="button" data-action="stop" class="stop">提前打烊</button>';
    }
    if (game.outcome) {
      return '<button type="button" data-action="pause">暂停</button>' +
        '<button type="button" data-action="resume">继续</button>';
    }
    var prep = '<button type="button" data-action="pause">暂停</button>' +
      '<button type="button" data-action="resume">继续</button>' +
      '<button type="button" data-action="prep">' + (game.night ? "准备明天" : "准备班次") + "</button>";
    if (game.night) return prep + '<button type="button" data-action="ff-dawn" class="primary">快进到天亮</button>';
    if (game.shiftIndex < game.shifts.length) {
      var html = prep + '<button type="button" data-action="ff-shift" class="primary">快进到' + game.shifts[game.shiftIndex].name + "</button>";
      if (game.shiftIndex > 0 && game.dayParts.length) html += '<button type="button" data-action="end-day">今晚不营业了</button>';
      return html;
    }
    return prep;
  }

  function syncControls() {
    var box = document.getElementById("transport");
    if (!box) return;
    var html = controlsHtml();
    if (box.dataset.view !== html) {
      box.dataset.view = html;
      box.innerHTML = html;
    }
    syncTransport();
  }

  function updateSim() {
    paintWorld();
    syncControls();
    var state = game.run ? game.run.getState() : idleState();
    var key = state.people.map(function (person) {
      return person.key + person.where + (person.late ? "!" : "");
    }).join("|") + ":" + state.events.map(function (event) { return event.text; }).join("/") +
      ":" + (state.gear ? state.gear.taken + "/" + state.gear.seats : "");

    if (!game.run) {
      if (game.night) setText("door-note", "打烊了");
      else if (game.shiftIndex < game.shifts.length) setText("door-note", game.shifts[game.shiftIndex].name + " " + hourLabel(game.shifts[game.shiftIndex].start));
      else setText("door-note", "今日打烊");
    } else {
      var waiting = state.people.filter(function (person) { return person.where === "wait"; }).length;
      var cap = CONFIG.entranceWaitCap || 5;
      var freeSeats = state.gear ? state.gear.free : 0;
      if (!state.accepting) setText("door-note", "本班即将结束");
      else if (waiting >= cap) setText("door-note", "坐满了");
      else if (waiting > 0) setText("door-note", "等位 " + waiting + "/" + cap);
      else if (freeSeats > 0) setText("door-note", "还有空位");
      else setText("door-note", "吧台满了");
    }

    var byId = {};
    state.stations.forEach(function (station) { byId[station.id] = station; });
    var kitchen = byId.kitchen;
    var cashier = byId.cashier;
    var serve = byId.serve;
    var kitchenZone = document.getElementById("zone-kitchen");
    var cashierZone = document.getElementById("zone-cashier");
    if (kitchenZone) {
      kitchenZone.classList.toggle("is-hot", kitchen.queueLength >= 4 && kitchen.staffIds && kitchen.staffIds.length > 0);
      kitchenZone.classList.toggle("is-stuck", !kitchen.staffIds || !kitchen.staffIds.length);
    }
    if (cashierZone) {
      cashierZone.classList.toggle("is-hot", cashier.queueLength >= 4 && cashier.staffIds && cashier.staffIds.length > 0);
      cashierZone.classList.toggle("is-stuck", !cashier.staffIds || !cashier.staffIds.length);
    }

    setText("status-kitchen", crewStatus(kitchen, "等候"));
    setText("status-cashier", crewStatus(cashier, "排队"));
    var stoveNames = (state.stoves || []).map(function (job) { return job.dishName; });
    var tillNames = (state.tills || []).map(function (job) { return job.dishName; });
    setText("stove-label", !kitchen.staffIds.length ? "没人" : stoveNames.length ? "正在做 " + stoveNames.join("、") : "空闲");
    setText("till-label", !cashier.staffIds.length ? "没人，卡在收银" : tillNames.length ? "结账 " + tillNames.join("、") : "空闲");
    var stoveFill = document.getElementById("stove-fill");
    var tillFill = document.getElementById("till-fill");
    if (stoveFill) stoveFill.style.width = (state.stove ? state.stove.progress * 100 : 0) + "%";
    if (tillFill) tillFill.style.width = (state.till ? state.till.progress * 100 : 0) + "%";
    var stoveBox = document.querySelector("#zone-kitchen .stove");
    var tillBox = document.querySelector("#zone-cashier .counter");
    if (stoveBox) stoveBox.classList.toggle("is-multi", (state.gear ? state.gear.stoves : 1) > 1);
    if (tillBox) tillBox.classList.toggle("is-multi", (state.gear ? state.gear.tills : 1) > 1);
    paintGear("stove-row", state.gear ? state.gear.stoves : 1, (state.stoves || []).length, "burner");
    paintGear("till-row", state.gear ? state.gear.tills : 1, (state.tills || []).length, "till-box");
    var dining = document.getElementById("zone-dining");
    var seatsFull = state.gear && state.gear.free === 0 && serve.queueLength > 0;
    if (dining) dining.classList.toggle("is-full", !!seatsFull);
    if (state.gear) {
      setText("seat-note", (seatsFull ? "座位满了，菜端不出去 · " : "在座 ") + state.gear.taken + "/" + state.gear.seats);
    }

    var stoveArt = document.getElementById("stove-art");
    if (stoveArt) {
      var stoveId = (state.stoves || []).map(function (job) { return job.dishId; }).join(",");
      if (stoveArt.dataset.dish !== stoveId) {
        stoveArt.dataset.dish = stoveId;
        stoveArt.innerHTML = (state.stoves || []).map(function (job) { return dishArt(job.dishId); }).join("");
      }
      stoveArt.classList.toggle("is-many", (state.stoves || []).length > 1);
    }
    setText("labor-note", "人工每天 " + laborCost() + " 元");
    syncCrew(state);
    renderShift();

    syncGuests(state.people);
    renderInspect(state);

    if (game.simKey !== key) {
      var log = document.getElementById("log");
      if (log) {
        log.innerHTML = state.events.slice().reverse().map(function (event) {
          return "<li>" + escapeHtml(event.text) + "</li>";
        }).join("");
      }
      var qstats = document.getElementById("qstats");
      if (qstats) {
        var eating = state.people.filter(function (person) { return person.where === "eating"; }).length;
        qstats.innerHTML =
          "<li><span>门口等候</span><b>" + kitchen.queueLength + "</b></li>" +
          "<li><span>收银台</span><b>" + cashier.queueLength + "</b></li>" +
          "<li><span>待上桌</span><b>" + serve.queueLength + "</b></li>" +
          "<li><span>正在吃饭</span><b>" + eating + "</b></li>" +
          "<li><span>座位</span><b>" + (state.gear ? state.gear.taken + "/" + state.gear.seats : "") + "</b></li>";
      }
    }

    var eatingNow = state.people.filter(function (person) { return person.where === "eating"; }).length;
    var book = rolled();
    var revenue = book.revenue + (game.run ? state.revenue : 0);
    var ingredient = book.ingredientCost + (game.run ? state.ingredientCost : 0);
    var profit = revenue - ingredient - laborCost();
    setText("live-done", String(book.completed + (game.run ? state.completed : 0)));
    setText("live-rev", money(revenue));
    setText("live-cost", money(ingredient));
    setText("live-left", String(book.left + (game.run ? state.left : 0)));
    setText("live-eating", String(eatingNow));
    var profitNode = document.getElementById("live-profit");
    if (profitNode) {
      profitNode.textContent = money(profit);
      profitNode.classList.toggle("is-neg", profit < 0);
    }
    game.simKey = key;
    tickStreet();
    paintCoach();
  }

  function whereLine(person) {
    if (person.where === "wait") return "吧台坐满了，坐在门口的小凳上等位子，前面还有 " + person.slot + " 人。";
    if (person.where === "seated") return "已经坐在吧台，这单还在做。";
    if (person.where === "wait-front") return "还坐在门口的小凳上，后厨正在做他的菜。";
    if (person.where === "pay-line") return "还坐在门口的小凳上，等着付钱。";
    if (person.where === "paying") return "还坐在门口的小凳上，正在把" + person.dishName + "的钱结掉。";
    if (person.where === "food-ready") return person.dishName + "已经做好，他还坐在门口，等一个吧台座位。";
    if (person.where === "seating") return "跟着菜往吧台走。";
    if (person.where === "eating") return "坐在吧台吃饭。";
    if (person.where === "leaving") return "吃完了，正往门口走。";
    return "等太久，决定离开。";
  }

  function tickStreet() {
    var layer = document.getElementById("street-people");
    if (!layer) return;
    if (!game.walkers) game.walkers = [];
    var frozen = game.paused || game.phase !== "sim" || game.modal;
    if (!frozen) {
      if (!game.walkerWait) game.walkerWait = 0;
      game.walkerWait += 1;
      if (game.walkerWait > 40 && game.walkers.length < 4) {
        game.walkerWait = 0;
        var dir = Math.random() < 0.5 ? 1 : -1;
        var look = Math.floor(Math.random() * 90) + 1;
        game.walkers.push({
          x: dir > 0 ? -14 : 114,
          y: 84 + (look % 3) * 1.6,
          dir: dir,
          speed: 0.26 + (look % 5) * 0.07,
          look: look,
          glance: look % 3 !== 2
        });
      }
      game.walkers.forEach(function (walker) {
        var nearDoor = Math.abs(walker.x - 22) < 12;
        if (walker.glance && nearDoor && !walker.glanced) {
          walker.y = Math.max(78, walker.y - 0.2);
          walker.speed = Math.max(0.06, walker.speed * 0.9);
          if (walker.y <= 78.3) walker.glanced = true;
        } else if (walker.glanced) {
          walker.speed = Math.min(0.62, walker.speed + 0.025);
          walker.y = Math.min(88, walker.y + 0.16);
        }
        walker.x += walker.dir * walker.speed;
      });
      game.walkers = game.walkers.filter(function (walker) {
        return walker.x > -18 && walker.x < 118;
      });
    }
    var styles = ["short", "bob", "bun", "long", "spike"];
    layer.innerHTML = game.walkers.map(function (walker) {
      var look = lookOf(walker.look + 7);
      var flip = walker.dir < 0 ? " is-flip" : "";
      return '<div class="guest passer skin-' + look.skin + " hairc-" + look.hair + " style-" + styles[look.style] + " shirt-" + look.shirt + flip +
        '" style="left:' + walker.x.toFixed(2) + "%;top:" + walker.y.toFixed(2) + '%"><span class="hair"></span><span class="face"></span><span class="torso"></span></div>';
    }).join("");
  }

  function guestNote(person) {
    var left = Math.max(0, CONFIG.customerPatience - person.wait);
    if (person.where === "eating") {
      var remain = Math.max(1, Math.round((1 - person.progress) * (CONFIG.eatTime || 6)));
      return "盘子还没空，大约还要吃 " + remain + " 秒。这时候他不会因为排队而离开。";
    }
    if (person.where === "leaving") return "这单已经算完成。看他从座位走到门口。";
    if (person.where === "walkout") return "他没有吃上这顿。未完成的单不会进账。";
    if (person.late) return "已经等了 " + person.wait.toFixed(0) + " 秒，耐心只剩 " + left.toFixed(0) + " 秒。再堵住，他就走了。";
    if (person.where === "wait") return "还愿意等 " + left.toFixed(0) + " 秒。等太久没有坐上吧台，他就会起身离开。门口外面最多五张小凳。";
    if (person.where === "seated") return "人已经在店里坐下。座位空着的时候，不会有人在门外排队。";
    if (person.where === "paying" || person.where === "pay-line") return "菜已经做好，卡在付钱这一步。收银慢的话，后面的桌就空着。";
    return "菜在出餐口。传菜一慢，做好的餐会堆在这里，客人还没坐下。";
  }

  function paintInspect(card, html) {
    if (card.dataset.view !== html) {
      card.dataset.view = html;
      card.innerHTML = html;
    }
  }

  function renderInspect(state) {
    var card = document.getElementById("inspect");
    if (!card) return;
    card.classList.toggle("is-open", !!game.inspect);
    if (!game.inspect) {
      paintInspect(card, '<p class="inspect-empty"><strong>点一个人看看</strong>看他正在做什么，也可以给他换岗位。</p>');
      return;
    }
    if (game.inspect.kind === "guest") {
      var person = null;
      state.people.forEach(function (item) {
        if (item.key === game.inspect.key) person = item;
      });
      if (!person) {
        game.inspect = null;
        card.classList.remove("is-open");
        paintInspect(card, '<p class="inspect-empty"><strong>点一个人看看</strong>看他正在做什么，也可以给他换岗位。</p>');
        return;
      }
      var dish = dishById(person.dishId);
      var patience = person.where === "eating" || person.where === "leaving" ? 1 : Math.max(0, 1 - person.wait / CONFIG.customerPatience);
      paintInspect(card,
        '<button type="button" class="inspect-close" id="inspect-close">关闭</button>' +
        '<div class="inspect-head">' +
          '<span class="' + guestClass(person) + ' portrait">' + '<span class="hair"></span><span class="face"></span><span class="torso"></span></span>' +
          '<div><p class="eyebrow">客人 #' + person.id + '</p>' + personaTags(person.personality, person.mood) + '<span>' + escapeHtml(whereLine(person)) + '</span></div>' +
        '</div>' +
        '<div class="inspect-dish">' + dishArt(person.dishId) +
          '<div><b>' + escapeHtml(person.dishName || "没有点菜") + '</b>' +
          (dish ? '<span>售价 ' + dish.price + ' · 成本 ' + dish.cost + ' · 后厨 ' + dish.cookTime + ' 秒</span>' : '') +
          '</div></div>' +
        '<div class="patience"><i></i></div>' +
        '<p data-live></p>');
      var bar = card.querySelector(".patience i");
      if (bar) bar.style.width = Math.round(patience * 100) + "%";
      var guestLive = card.querySelector("[data-live]");
      if (guestLive) guestLive.textContent = guestNote(person);
      return;
    }
    var staffId = game.inspect.staffId;
    var staff = staffById(staffId);
    if (!staff) {
      game.inspect = null;
      card.classList.remove("is-open");
      paintInspect(card, '<p class="inspect-empty"><strong>点一个人看看</strong>看他正在做什么，也可以给他换岗位。</p>');
      return;
    }
    var face = personaOf(staffId);
    var posts = postsOf(staffId);
    var focus = null;
    var member = null;
    state.stations.forEach(function (item) {
      (item.crew || []).forEach(function (crewMember) {
        if (crewMember.staffId !== staffId) return;
        if (crewMember.busy || !member) {
          member = crewMember;
          focus = item;
        }
      });
    });
    var station = focus;
    var matched = staff.specialty === "any" || (station && staff.specialty === station.id);
    var where = posts.length ? posts.map(stationName).join("、") : "待命";
    var doing = posts.length ? "现在负责" + where + "。同一时间只能做一件。" : "还在待命。点一个岗位，他就会过去。";
    var art = "";
    if (member && member.busy && station && station.id === "kitchen") {
      doing = "正在做" + member.dishName + "，完成了 " + Math.round(member.progress * 100) + "%。";
      art = dishArt(member.dishId);
    } else if (member && member.busy && station && station.id === "cashier") {
      doing = "正在收" + member.dishName + "的钱，完成了 " + Math.round(member.progress * 100) + "%。";
      art = dishArt(member.dishId);
    } else if (member && member.busy && station && station.id === "serve") {
      doing = "正在把" + member.dishName + "端上桌，走到 " + Math.round(member.progress * 100) + "%。";
      art = dishArt(member.dishId);
    }
    var moves = STATIONS.map(function (item) {
      if (posts.indexOf(item.id) !== -1) return '<button type="button" data-leave-post="' + item.id + '">离开' + item.name + "</button>";
      return '<button type="button" data-move="' + item.id + '">也去' + item.name + "</button>";
    }).join("");
    var personal = staff.efficiency * (matched ? (1 + staff.bonus) : 1);
    var effText = "效率 " + personal.toFixed(1) + "×";
    if (!station) {
      effText = staff.specialty === "any"
        ? "三个岗位都是 " + (staff.efficiency * (1 + staff.bonus)).toFixed(1) + "×"
        : "擅长" + stationName(staff.specialty) + "，换过去是 1.3×，其他岗位 1.0×";
    } else if (staff.specialty === "any") {
      effText = "效率 " + personal.toFixed(1) + "× · 任意岗位都熟练";
    } else if (matched) {
      effText = "效率 " + personal.toFixed(1) + "× · 擅长这个岗位";
    } else {
      effText = "效率 " + personal.toFixed(1) + "× · 没有加成，换到擅长的岗位是 1.3×";
    }
    paintInspect(card,
      '<button type="button" class="inspect-close" id="inspect-close">关闭</button>' +
      '<div class="inspect-head">' +
        staffFigure(staffId) +
        '<div><p class="eyebrow">' + escapeHtml(where) + '</p><strong>' + escapeHtml(staff.name) + '</strong><span>' + escapeHtml(staff.trait) + '</span>' + personaTags(face.personality, face.mood) + '</div>' +
      '</div>' +
      (art ? '<div class="inspect-dish">' + art + '<div><b>手上这单</b><span>' + effText + '</span></div></div>' : "<p>" + effText + "</p>") +
      '<p data-live></p>' +
      '<div class="shift-moves">' + moves + '</div>');
    var staffLive = card.querySelector("[data-live]");
    if (staffLive) staffLive.textContent = doing;
  }

  function syncTransport() {
    var buttons = simScreen.querySelectorAll("#transport button");
    buttons.forEach(function (button) {
      var action = button.getAttribute("data-action");
      var on = false;
      if (action === "pause") on = game.paused;
      if (action === "resume") on = !game.paused;
      if (action === "speed") on = Number(button.getAttribute("data-speed")) === game.speed;
      button.classList.toggle("is-on", on);
      if (action === "speed") button.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function reportMarkup() {
    var report = game.lastReport;
    if (!report) return "";
    var prev = report._prev || null;
    var maxWait = 1;
    report.stationList.forEach(function (station) {
      if (station.avgQueueWait > maxWait) maxWait = station.avgQueueWait;
    });
    var waits = report.stationList.map(function (station) {
      var width = Math.max(4, (station.avgQueueWait / maxWait) * 100);
      var mark = report.bottleneck === station.id ? " is-bottleneck" : "";
      return (
        '<div class="wait-row' + mark + '">' +
          "<span>" + station.name + "</span>" +
          '<div class="wait-track"><i class="wait-' + station.id + '" style="width:' + width + '%"></i></div>' +
          "<b>" + station.avgQueueWait.toFixed(1) + " 秒 · 峰值 " + station.maxQueue + "</b>" +
        "</div>"
      );
    }).join("");

    var compare = "";
    if (prev) {
      compare =
        '<section class="panel"><header><h2>和上一轮比</h2></header><div class="compare">' +
          compareStat("净利润", prev.profit, report.profit, true) +
          compareStat("完成", prev.completed, report.completed, false) +
          compareStat("流失", prev.left, report.left, false) +
          compareStat("平均等待", prev.avgWait, report.avgWait, false) +
        "</div></section>";
    }

    var grow = !game.outcome && shopTierFor(game.round + 1) > shopTier() ? "天亮后店面会大一档。" : "";
    var note = (report.diagnosis && report.diagnosis[0]) || "";
    var gap = CONFIG.goalCash - game.cash;
    var lead = "第 " + game.round + "/" + CONFIG.goalDays + " 天。现金 " + money(game.cash) + (gap > 0 ? "，还差 " + money(gap) + "。" : "，已经达到目标。");
    var leadClass = "lead";
    if (game.outcome === "win") {
      lead = "成功。现金 " + money(game.cash) + "，达到了 " + money(CONFIG.goalCash) + "。";
      leadClass = "lead is-win";
    } else if (game.outcome === "lose") {
      lead = "失败。现金 " + money(game.cash) + "，没有达到 " + money(CONFIG.goalCash) + "。";
      leadClass = "lead is-lose";
    }
    if (grow) lead += grow;
    var actions = game.outcome
      ? '<button type="button" data-action="close-modal">先看着店</button>'
      : '<button type="button" data-action="close-modal">先看着店</button>' +
        '<button type="button" data-action="prep">准备明天</button>' +
        '<button type="button" data-action="ff-dawn" class="primary">快进到天亮</button>';
    return (
      '<p class="' + leadClass + '">' + lead + "</p>" +
      '<div class="report-hero">' +
        '<div><span>净利润</span><strong class="' + (report.profit < 0 ? "is-neg" : "") + '">' + (report.profit > 0 ? "+" : "") + money(report.profit) + "</strong></div>" +
        '<div><span>现金</span><strong class="' + (game.cash < 0 ? "is-neg" : "") + '">' + money(game.cash) + "</strong></div>" +
      "</div>" +
      '<p class="report-line">目标 ' + money(CONFIG.goalCash) + " · 完成 " + report.completed + " · 流失 " + report.left + " · 人工 " + money(report.staffCost) + "</p>" +
      (note && !game.outcome ? '<p class="report-line">' + escapeHtml(note) + "</p>" : "") +
      (game.outcome ? "" : nightChoicePanel()) +
      '<footer class="action-bar">' + actions + "</footer>"
    );
  }

  function nightPick() {
    if (game.hiredTonight && game.hiredTonight !== "skip") return "hire";
    if (game.upgradeChoice === "stove" || game.upgradeChoice === "till") return game.upgradeChoice;
    if (game.upgradeChoice === "skip" || game.hiredTonight === "skip") return "skip";
    if (game.upgradeChoice === "hiring") return "hiring";
    return "";
  }

  function gearRoom() {
    return rosterPool().length;
  }

  function nightChoicePanel() {
    if (game.hiredTonight && game.hiredTonight !== "skip") {
      var person = staffById(game.hiredTonight);
      var posts = person ? postsOf(person.id) : [];
      return (
        '<section class="panel upgrades"><header><h2>新人</h2><p>' + (person ? person.name + " 来了。点一个岗位。后厨不能超过灶台，收银不能超过收银台。" : "") + "</p></header>" +
        '<div class="upgrade-row">' +
          STATIONS.map(function (station) {
            var on = posts.indexOf(station.id) !== -1;
            return '<button type="button" data-post="' + station.id + '"' + (on ? ' class="is-on"' : "") + "><strong>" +
              (on ? "离开" : "去") + station.name + "</strong><span>现在 " + crewOf(station.id).length + (stationCap(station.id) === Infinity ? " 人" : " / " + stationCap(station.id) + " 人") + "</span></button>";
          }).join("") +
        "</div></section>"
      );
    }
    if (game.upgradeChoice === "stove" || game.upgradeChoice === "till") {
      return '<p class="report-line">' + upgradeHint(game.upgradeChoice) + "</p>";
    }
    if (nightPick() === "skip") {
      return '<p class="report-line">今晚先不选。明天打烊还可以再选一次。</p>';
    }
    if (game.upgradeChoice === "hiring") {
      var waiting = unhired();
      return (
        '<section class="panel upgrades"><header><h2>请一位新人</h2><p>选一个。人工每天 +' + CONFIG.staffCost + " 元。今晚就不能再加灶台或收银台。</p></header>" +
        '<div class="upgrade-row">' +
          waiting.map(function (staff) {
            return '<button type="button" data-hire="' + staff.id + '">' +
              staffFigure(staff.id) +
              "<strong>" + staff.name + "</strong><span>" + staff.trait + "</span></button>";
          }).join("") +
        "</div>" +
        '<button type="button" class="upgrade-skip" data-upgrade="back">返回</button></section>'
      );
    }
    var peopleLeft = unhired().length;
    var stoveFull = game.gear.stoves >= gearRoom();
    var tillFull = game.gear.tills >= gearRoom();
    return (
      '<section class="panel upgrades"><header><h2>今晚选一样</h2><p>三选一。加一台设备，对应岗位就能多站一个人。请人会让每天人工 +' + CONFIG.staffCost + " 元。</p></header>" +
      '<div class="upgrade-row">' +
        '<button type="button" data-upgrade="stove"' + (stoveFull ? " disabled" : "") + "><strong>加一台灶台</strong><span>现在 " + game.gear.stoves + " 台，后厨能站 " + game.gear.stoves + " 人</span></button>" +
        '<button type="button" data-upgrade="till"' + (tillFull ? " disabled" : "") + "><strong>加一台收银台</strong><span>现在 " + game.gear.tills + " 台，收银能站 " + game.gear.tills + " 人</span></button>" +
        '<button type="button" data-upgrade="hire"' + (peopleLeft ? "" : " disabled") + "><strong>请一个人</strong><span>" + (peopleLeft ? "还有 " + peopleLeft + " 位可以请" : "人都到齐了") + "</span></button>" +
      "</div>" +
      '<button type="button" class="upgrade-skip" data-upgrade="skip">今晚先不选</button></section>'
    );
  }

  function applyUpgrade(kind) {
    var pick = nightPick();
    if (pick === "hire" || pick === "stove" || pick === "till") return;
    if (kind === "back") {
      game.upgradeChoice = null;
      game.hint = "";
      if (game.guide === "hire") GUIDE_STEPS.hire.selector = "#modal [data-upgrade='hire']";
      renderModal();
      return;
    }
    if (kind === "hire") {
      if (!unhired().length) return;
      game.upgradeChoice = "hiring";
      game.hint = "选一位新人。";
      if (game.guide === "hire") GUIDE_STEPS.hire.selector = "#modal [data-hire]:not([data-hire='skip'])";
      renderModal();
      return;
    }
    if (kind === "skip") {
      game.upgradeChoice = "skip";
      game.hiredTonight = "skip";
      game.guide = "done";
      game.hint = "今晚先不选。";
      renderModal();
      return;
    }
    if (kind === "stove") {
      if (game.gear.stoves >= gearRoom()) return;
      game.gear.stoves += 1;
    } else if (kind === "till") {
      if (game.gear.tills >= gearRoom()) return;
      game.gear.tills += 1;
    } else {
      return;
    }
    game.upgradeChoice = kind;
    game.hiredTonight = null;
    game.guide = "done";
    game.hint = upgradeHint(kind);
    refreshTables();
    renderModal();
  }

  function upgradeHint(choice) {
    if (choice === "stove") return "添了一台灶台。后厨现在可以站 " + game.gear.stoves + " 个人。人要放到后厨，多出来的灶才会一起做。";
    if (choice === "till") return "添了一台收银台。收银现在可以站 " + game.gear.tills + " 个人。人要放到收银，多出来的台才会一起结账。";
    return "";
  }

  function dishMix(report) {
    return DISHES.filter(function (dish) {
      return (report.dishesArrived[dish.id] || 0) > 0;
    }).map(function (dish) {
      return dish.name + " 完成 " + (report.dishesCompleted[dish.id] || 0) + " / 点单 " + report.dishesArrived[dish.id];
    }).join(" · ");
  }

  function metric(label, value) {
    return "<div><dt>" + label + "</dt><dd>" + value + "</dd></div>";
  }

  function compareStat(label, before, after, invertMoney) {
    var delta = after - before;
    var better = label === "流失" || label === "平均等待" ? delta < 0 : delta > 0;
    var worse = label === "流失" || label === "平均等待" ? delta > 0 : delta < 0;
    var cls = better ? "is-up" : worse ? "is-down" : "";
    var shownBefore = label === "平均等待" ? before.toFixed(1) : moneyLike(before, label);
    var shownAfter = label === "平均等待" ? after.toFixed(1) : moneyLike(after, label);
    var shownDelta = label === "平均等待"
      ? (delta > 0 ? "+" : "") + delta.toFixed(1)
      : (delta > 0 ? "+" : "") + Math.round(delta);
    return (
      '<div class="compare-item ' + cls + '"><span>' + label + "</span><b>" + shownBefore + " → " + shownAfter + "</b><small>" + shownDelta + "</small></div>"
    );
    function moneyLike(value, name) {
      if (name === "净利润") return (value > 0 ? "+" : "") + Math.round(value);
      return String(Math.round(value));
    }
  }

  function renderModal() {
    var modal = document.getElementById("modal");
    if (!modal) return;
    if (!game.modal) {
      modal.hidden = true;
      modal.innerHTML = "";
      paintCoach();
      return;
    }
    modal.hidden = false;
    var title = game.outcome === "win" ? "成功" : game.outcome === "lose" ? "失败" : game.modal === "report" ? "今天打烊了" : (game.night ? "准备明天" : "准备班次");
    modal.innerHTML = '<div class="modal-card" role="dialog" aria-label="' + title + '">' +
      (game.modal === "report" ? reportMarkup() : prepMarkup()) +
      "</div>";
    paintCoach();
  }

  function renderAll() {
    renderChrome();
    show(game.phase);
    renderModal();
  }

  function renderShift() {
    var box = document.getElementById("shift");
    if (!box) return;
    var people = activeRoster().map(function (staff) {
      var posts = postsOf(staff.id);
      return staff.name + " · " + (posts.length ? posts.map(stationName).join("、") : "待命");
    }).join("　");
    var html = "<p>" + tierLabel(shopTier()) + " · 人流" + trafficBand().name + " · " + people + "</p>";
    if (box.dataset.view !== html) {
      box.dataset.view = html;
      box.innerHTML = html;
    }
  }

  function applyLiveAssignment() {
    if (!game.run || game.phase !== "sim" || !game.run.setAssignment) return;
    game.run.setAssignment({
      kitchen: game.assignment.kitchen,
      cashier: game.assignment.cashier,
      serve: game.assignment.serve
    });
    if (game.hint && game.run.note) game.run.note(game.hint);
  }

  function hirePerson(id) {
    if (id === "skip") {
      game.hiredTonight = "skip";
      game.upgradeChoice = "skip";
      game.guide = "done";
      game.hint = "今晚先不选。";
      renderModal();
      return;
    }
    if (nightPick() === "stove" || nightPick() === "till" || nightPick() === "hire") return;
    if (game.hired.indexOf(id) !== -1) return;
    var person = staffById(id);
    if (!person) return;
    game.hired.push(id);
    game.hiredTonight = id;
    game.selectedStaffId = id;
    game.guide = "place";
    game.hint = person.name + "来了。点一个岗位。人工每天 +" + CONFIG.staffCost + " 元。";
    if (game.run && game.run.setRoster) game.run.setRoster(activeRoster());
    renderModal();
  }

  function moveStaffTo(staffId, stationId) {
    if (!staffId || !staffById(staffId)) return false;
    game.selectedStaffId = staffId;
    var moved = assignSelected(stationId);
    if (moved) applyLiveAssignment();
    var now = stationOf(staffId);
    game.inspect = { kind: "staff", station: now, staffId: staffId };
    return moved;
  }

  function assignSelected(stationId) {
    var staffId = game.selectedStaffId;
    if (!staffId) {
      var waiting = crewOf(stationId);
      if (!waiting.length) {
        game.hint = stationName(stationId) + "现在没人。先点一名员工。";
        return false;
      }
      game.selectedStaffId = waiting[0];
      game.hint = "已选中" + staffById(waiting[0]).name + "。再点岗位是加上，再点一次则离开。";
      return false;
    }
    var posts = postsOf(staffId);
    var crew = ensureCrew(stationId);
    if (posts.indexOf(stationId) !== -1) {
      var here = crew.indexOf(staffId);
      if (here !== -1) crew.splice(here, 1);
      game.hint = staffById(staffId).name + " 离开了" + stationName(stationId) + "。没人的岗位会卡住。";
      game.inspect = { kind: "staff", station: stationOf(staffId), staffId: staffId };
      return true;
    }
    var cap = stationCap(stationId);
    if (crew.length >= cap) {
      var gearName = stationId === "kitchen" ? "灶台" : stationId === "cashier" ? "收银台" : "";
      game.hint = gearName
        ? stationName(stationId) + "只能站 " + cap + " 个人，和" + gearName + "一样多。打烊时可以再加一台。"
        : stationName(stationId) + "只能站 " + cap + " 个人。先让现在的人离开。";
      return false;
    }
    crew.push(staffId);
    game.hint = staffById(staffId).name + " 也去" + stationName(stationId) + "。";
    game.inspect = { kind: "staff", station: stationId, staffId: staffId };
    if (game.guide === "place") game.guide = "done";
    return true;
  }

  function toggleDish(dishId) {
    var index = game.menu.indexOf(dishId);
    if (index !== -1) {
      game.menu.splice(index, 1);
      game.hint = "已拿下" + dishById(dishId).name + "。";
      return;
    }
    if (game.menu.length >= CONFIG.maxMenu) {
      game.hint = "最多选择两种菜品。先取消一道，再选新的。";
      return;
    }
    game.menu.push(dishId);
    game.hint = "已加入" + dishById(dishId).name + "。";
  }

  function nextSeed() {
    game.seedCursor += 1;
    return (Math.floor(performance.now() * 1000) ^ (game.seedCursor * 9973) ^ (game.round * 131)) >>> 0;
  }

  function refreshTables() {
    var room = document.getElementById("room");
    if (!room) return;
    Array.prototype.slice.call(room.querySelectorAll(".bar-stool")).forEach(function (node) {
      node.remove();
    });
    var html = "";
    var seats = seatCount();
    for (var i = 0; i < seats; i++) html += stoolBlock(i);
    var crew = document.getElementById("crew");
    if (crew) crew.insertAdjacentHTML("beforebegin", html);
  }

  function mergeDayReports(parts, prev) {
    var report = {
      elapsed: 0,
      endedEarly: false,
      revenue: 0,
      ingredientCost: 0,
      staffCost: laborCost(),
      arrived: 0,
      completed: 0,
      left: 0,
      abandoned: 0,
      avgWait: 0,
      avgTicket: 0,
      leftBy: { kitchen: 0, cashier: 0, serve: 0, entrance: 0 },
      abandonedBy: { kitchen: 0, cashier: 0, serve: 0 },
      dishesCompleted: {},
      dishesArrived: {},
      stationList: [],
      stations: {},
      bottleneck: null,
      diagnosis: [],
      seatDenied: 0,
      gear: {
        stoves: game.gear.stoves,
        tills: game.gear.tills,
        tables: game.gear.tables,
        seats: seatCount()
      }
    };
    var waitSum = 0;
    var waitWeight = 0;
    var stationWait = {};
    var stationCount = {};
    var stationMax = {};
    parts.forEach(function (part) {
      report.elapsed += part.elapsed || 0;
      report.endedEarly = report.endedEarly || !!part.endedEarly;
      report.revenue += part.revenue || 0;
      report.ingredientCost += part.ingredientCost || 0;
      report.arrived += part.arrived || 0;
      report.completed += part.completed || 0;
      report.left += part.left || 0;
      report.abandoned += part.abandoned || 0;
      report.seatDenied += part.seatDenied || 0;
      waitSum += (part.avgWait || 0) * (part.arrived || 0);
      waitWeight += part.arrived || 0;
      ["kitchen", "cashier", "serve", "entrance"].forEach(function (id) {
        report.leftBy[id] += (part.leftBy && part.leftBy[id]) || 0;
      });
      ["kitchen", "cashier", "serve"].forEach(function (id) {
        report.abandonedBy[id] += (part.abandonedBy && part.abandonedBy[id]) || 0;
      });
      Object.keys(part.dishesCompleted || {}).forEach(function (id) {
        report.dishesCompleted[id] = (report.dishesCompleted[id] || 0) + part.dishesCompleted[id];
      });
      Object.keys(part.dishesArrived || {}).forEach(function (id) {
        report.dishesArrived[id] = (report.dishesArrived[id] || 0) + part.dishesArrived[id];
      });
      (part.stationList || []).forEach(function (station) {
        var weight = station.queueWaitCount || 0;
        stationWait[station.id] = (stationWait[station.id] || 0) + station.avgQueueWait * weight;
        stationCount[station.id] = (stationCount[station.id] || 0) + weight;
        stationMax[station.id] = Math.max(stationMax[station.id] || 0, station.maxQueue || 0);
      });
    });
    report.avgWait = waitWeight ? waitSum / waitWeight : 0;
    report.avgTicket = report.completed ? report.revenue / report.completed : 0;
    report.profit = report.revenue - report.ingredientCost - report.staffCost;
    report.stationList = STATIONS.map(function (station) {
      var count = stationCount[station.id] || 0;
      var ids = crewOf(station.id);
      var lead = ids.length ? staffById(ids[0]) : null;
      return {
        id: station.id,
        name: station.name,
        staffName: crewNames(station.id) || "空缺",
        staffIds: ids,
        efficiency: lead ? efficiencyOf(lead, station.id) : 0,
        avgQueueWait: count ? stationWait[station.id] / count : 0,
        maxQueue: stationMax[station.id] || 0,
        queueWaitCount: count
      };
    });
    report.stationList.forEach(function (station) {
      report.stations[station.id] = station;
    });
    var ranked = report.stationList.slice().sort(function (a, b) {
      return b.avgQueueWait - a.avgQueueWait;
    });
    var top = ranked[0];
    var second = ranked[1] ? ranked[1].avgQueueWait : 0;
    var clearly = top.avgQueueWait >= second + 1 || top.avgQueueWait >= Math.max(0.5, second) * 1.45;
    if (top.avgQueueWait >= CONFIG.bottleneckMinWait && clearly) report.bottleneck = top.id;
    else if (top.avgQueueWait >= 4 && top.avgQueueWait >= second + 0.6) report.bottleneck = top.id;
    function biggest(map) {
      var best = null;
      var bestValue = -1;
      Object.keys(map).forEach(function (key) {
        if (map[key] > bestValue) {
          best = key;
          bestValue = map[key];
        }
      });
      return bestValue > 0 ? best : null;
    }
    report.mainLeftStage = biggest(report.leftBy);
    report.mainAbandonedStage = biggest(report.abandonedBy);
    report._prev = prev || null;
    report.diagnosis = window.ShopSim.diagnose(report, prev || null);
    return report;
  }

  function hideModal() {
    game.modal = null;
    var modal = document.getElementById("modal");
    if (modal) {
      modal.hidden = true;
      modal.innerHTML = "";
    }
  }

  function closeModal() {
    if (game.guide === "close") game.guide = "rush";
    hideModal();
    if (game.service !== "open" && !game.night && game.shiftIndex < game.shifts.length && game.clockMin >= game.shifts[game.shiftIndex].start) {
      startShift(game.shiftIndex);
    }
  }

  function openPrep() {
    if (game.outcome) return;
    game.modal = "prep";
    renderModal();
  }

  function bumpShift(index, edge, delta) {
    var shift = game.shifts[index];
    if (!shift) return;
    if (!game.night && index < game.shiftIndex) return;
    shift[edge] += delta * 30;
    clampShifts();
    game.hint = shift.name + " " + hourLabel(shift.start) + "–" + hourLabel(shift.end);
    renderModal();
  }

  function startShift(index) {
    if (game.service === "open") return;
    var reason = startBlockReason();
    if (reason) {
      game.hint = reason + "。";
      openPrep();
      return;
    }
    var shift = game.shifts[index];
    if (!shift) return;
    game.shiftIndex = index;
    game.service = "open";
    game.night = false;
    game.clockMin = shift.start;
    game.paused = false;
    game.speed = game.speed || 1;
    game.accumulator = 0;
    game.lastTs = 0;
    game.closing = false;
    game.inspect = null;
    game.simKey = "";
    hideModal();
    game.run = createRun({
      seed: nextSeed(),
      menu: game.menu.slice(),
      assignment: {
        kitchen: game.assignment.kitchen,
        cashier: game.assignment.cashier,
        serve: game.assignment.serve
      },
      staff: activeRoster(),
      gear: {
        stoves: game.gear.stoves,
        tills: game.gear.tills,
        tables: game.gear.tables
      },
      config: Object.assign({}, CONFIG, {
        dayDuration: shiftSeconds(shift),
        customerIntervalMin: trafficBand().min,
        customerIntervalMax: trafficBand().max
      })
    });
    game.hint = shift.name + "开门了。";
    if (game.guide === "close" || game.guide === "rush") game.guide = "watch";
  }

  function closeForNight(early) {
    if (game.night) return;
    var merged = mergeDayReports(game.dayParts.length ? game.dayParts : [{
      elapsed: 0,
      revenue: 0,
      ingredientCost: 0,
      arrived: 0,
      completed: 0,
      left: 0,
      abandoned: 0,
      avgWait: 0,
      leftBy: {},
      abandonedBy: {},
      dishesCompleted: {},
      dishesArrived: {},
      stationList: [],
      seatDenied: 0
    }], game.lastReport);
    if (early) merged.endedEarly = true;
    game.cash += merged.profit;
    game.lastReport = merged;
    if (game.round >= CONFIG.goalDays) {
      game.outcome = game.cash >= CONFIG.goalCash ? "win" : "lose";
      game.guide = "done";
    } else {
      game.guide = unhired().length ? "hire" : "done";
    }
    game.dayParts = [];
    game.run = null;
    game.service = "closed";
    game.night = true;
    game.closing = false;
    game.paused = false;
    game.upgradeChoice = null;
    game.hiredTonight = null;
    game.hint = "";
    game.inspect = null;
    game.modal = "report";
    renderChrome();
    renderModal();
  }

  function endShift(early) {
    if (!game.run || game.closing) return;
    game.closing = true;
    if (!game.run.isOver()) game.run.endNow();
    var part = game.run.buildReport(null);
    if (early) part.endedEarly = true;
    game.dayParts.push(part);
    game.run = null;
    game.service = "closed";
    game.closing = false;
    game.paused = false;
    var finished = game.shifts[game.shiftIndex];
    if (!early && finished) game.clockMin = finished.end;
    game.shiftIndex += 1;
    game.simKey = "";
    if (game.shiftIndex >= game.shifts.length) closeForNight(early);
  }

  function beginMorning() {
    if (game.outcome) return;
    game.night = false;
    game.round += 1;
    game.shiftIndex = 0;
    game.dayParts = [];
    game.clockMin = CONFIG.dayStart;
    game.service = "closed";
    game.closing = false;
    game.run = null;
    game.upgradeChoice = null;
    game.guide = "done";
    applyTier();
    renderChrome();
  }

  function fastForwardTo(target) {
    if (target <= game.clockMin) target += 1440;
    game.ffTarget = target;
    game.paused = false;
  }

  function skipTonight() {
    if (game.service === "open") endShift(true);
    else if (game.dayParts.length) closeForNight(true);
  }

  document.getElementById("guide").addEventListener("click", function (event) {
    if (!event.target.closest("#guide-next")) return;
    if (game.guide !== "goal") return;
    game.guide = "staff";
    game.modal = "prep";
    renderModal();
  });

  document.getElementById("modal").addEventListener("click", function (event) {
    var hireBtn = event.target.closest("[data-hire]");
    if (hireBtn) {
      hirePerson(hireBtn.getAttribute("data-hire"));
      return;
    }
    var timeBtn = event.target.closest("[data-shift-time]");
    if (timeBtn) {
      bumpShift(Number(timeBtn.getAttribute("data-shift-time")), timeBtn.getAttribute("data-edge"), Number(timeBtn.getAttribute("data-delta")));
      return;
    }
    var staffBtn = event.target.closest("[data-staff]");
    var postBtn = event.target.closest("[data-post]");
    var dishBtn = event.target.closest("[data-dish]");
    if (staffBtn) {
      var id = staffBtn.getAttribute("data-staff");
      if (game.guide === "staff") {
        game.selectedStaffId = id;
        game.guide = "posts";
        game.hint = "";
        renderModal();
        return;
      }
      game.selectedStaffId = game.selectedStaffId === id ? null : id;
      game.hint = game.selectedStaffId ? "再点击一个岗位。" : "已取消选择。";
      renderModal();
      return;
    }
    if (postBtn) {
      if (game.guide === "posts") {
        game.guide = "close";
        game.hint = "阿明留在原来的岗位上。";
        renderModal();
        return;
      }
      assignSelected(postBtn.getAttribute("data-post"));
      renderModal();
      return;
    }
    if (dishBtn) {
      toggleDish(dishBtn.getAttribute("data-dish"));
      renderModal();
      return;
    }
    var upgradeBtn = event.target.closest("[data-upgrade]");
    if (upgradeBtn) {
      applyUpgrade(upgradeBtn.getAttribute("data-upgrade"));
      return;
    }
    var actionBtn = event.target.closest("[data-action]");
    if (!actionBtn) return;
    var action = actionBtn.getAttribute("data-action");
    if (action === "close-modal") closeModal();
    if (action === "prep") openPrep();
    if (action === "ff-dawn") {
      hideModal();
      fastForwardTo(CONFIG.dayStart);
    }
    if (action === "ff-shift" && game.shiftIndex < game.shifts.length) {
      hideModal();
      fastForwardTo(game.shifts[game.shiftIndex].start);
    }
  });

  function sameInspect(next) {
    if (!game.inspect || !next || game.inspect.kind !== next.kind) return false;
    if (next.kind === "guest") return game.inspect.key === next.key;
    return game.inspect.staffId === next.staffId;
  }

  function closeInspect() {
    game.inspect = null;
    if (game.guide === "panel") game.guide = "day";
  }

  function openInspect(next) {
    if (sameInspect(next)) {
      closeInspect();
      return;
    }
    game.inspect = next;
    if (next.kind !== "staff") return;
    game.selectedStaffId = next.staffId;
    if (game.guide === "watch") game.guide = "panel";
    var whoStaff = staffById(next.staffId);
    game.hint = (whoStaff ? whoStaff.name : "这位") + " 已选中。可以让他去别的岗位一起做，或离开这里。";
  }

  simScreen.addEventListener("click", function (event) {
    if (game.phase !== "sim") return;
    if (game.guide === "panel") {
      if (event.target.closest("#inspect-close")) {
        closeInspect();
        updateSim();
      }
      return;
    }
    if (event.target.closest("[data-hire]")) {
      hirePerson(event.target.closest("[data-hire]").getAttribute("data-hire"));
      updateSim();
      return;
    }
    var shiftStaff = event.target.closest("[data-shift-staff]");
    if (shiftStaff) {
      var pickedId = shiftStaff.getAttribute("data-shift-staff");
      openInspect({ kind: "staff", station: stationOf(pickedId), staffId: pickedId });
      updateSim();
      return;
    }
    var shiftPost = event.target.closest("[data-shift-post]");
    if (shiftPost) {
      var targetPost = shiftPost.getAttribute("data-shift-post");
      if (game.selectedStaffId) moveStaffTo(game.selectedStaffId, targetPost);
      else assignSelected(targetPost);
      updateSim();
      return;
    }
    var moveBtn = event.target.closest("[data-move]");
    if (moveBtn && game.inspect && game.inspect.kind === "staff") {
      moveStaffTo(game.inspect.staffId, moveBtn.getAttribute("data-move"));
      updateSim();
      return;
    }
    var leaveBtn = event.target.closest("[data-leave-post]");
    if (leaveBtn && game.inspect && game.inspect.kind === "staff") {
      moveStaffTo(game.inspect.staffId, leaveBtn.getAttribute("data-leave-post"));
      updateSim();
      return;
    }
    var guestEl = event.target.closest(".guest");
    if (guestEl) {
      openInspect({ kind: "guest", key: guestEl.dataset.key });
      updateSim();
      return;
    }
    var workerEl = event.target.closest(".worker");
    if (workerEl) {
      var who = workerEl.getAttribute("data-who");
      openInspect({
        kind: "staff",
        station: workerEl.getAttribute("data-station") || stationOf(who),
        staffId: who
      });
      updateSim();
      return;
    }
    if (event.target.closest("#inspect-close")) {
      closeInspect();
      updateSim();
      return;
    }
    if (game.inspect && !event.target.closest("#inspect") && !event.target.closest("button")) {
      closeInspect();
      updateSim();
      return;
    }
    var button = event.target.closest("[data-action]");
    if (!button || game.phase !== "sim") return;
    var action = button.getAttribute("data-action");
    if (action === "pause") game.paused = true;
    if (action === "resume") {
      game.paused = false;
      game.lastTs = 0;
    }
    if (action === "speed") game.speed = Number(button.getAttribute("data-speed")) || 1;
    if (action === "stop") {
      endShift(true);
      return;
    }
    if (action === "prep") {
      openPrep();
      return;
    }
    if (action === "ff-dawn") {
      hideModal();
      fastForwardTo(CONFIG.dayStart);
    }
    if (action === "ff-shift" && game.shiftIndex < game.shifts.length) {
      hideModal();
      fastForwardTo(game.shifts[game.shiftIndex].start);
    }
    if (action === "end-day") {
      skipTonight();
      return;
    }
    syncControls();
    updateSim();
  });

  function arriveClock(absTarget) {
    game.clockMin = ((absTarget % 1440) + 1440) % 1440;
    if (game.night && game.clockMin === CONFIG.dayStart) {
      beginMorning();
      return;
    }
    if (!game.night && !game.modal && game.service !== "open" && game.shiftIndex < game.shifts.length && game.clockMin === game.shifts[game.shiftIndex].start) {
      startShift(game.shiftIndex);
    }
  }

  function frame(now) {
    if (!game.lastTs) game.lastTs = now;
    var dt = Math.min(0.25, Math.max(0, (now - game.lastTs) / 1000));
    game.lastTs = now;
    if (game.ffTarget != null && !game.paused) {
      var jump = 5;
      if (game.clockMin + jump >= game.ffTarget) {
        var landed = game.ffTarget;
        game.ffTarget = null;
        arriveClock(landed);
      } else {
        game.clockMin += jump;
      }
    } else if (game.service === "open" && game.run && !game.paused && !game.closing && !game.run.isOver()) {
      game.accumulator += dt * game.speed;
      if (game.accumulator > 1) game.accumulator = 1;
      var guard = 0;
      while (game.accumulator >= CONFIG.simStep && guard < 12) {
        game.run.step(CONFIG.simStep);
        game.clockMin += CONFIG.simStep * CONFIG.minutesPerSimSecond;
        game.accumulator -= CONFIG.simStep;
        guard += 1;
        if (game.run.isOver()) break;
      }
      if (game.run.isOver()) endShift(false);
    } else if (game.service !== "open" && !game.night && !game.modal && !game.paused && game.guide !== "rush" && game.guide !== "goal" && game.shiftIndex < game.shifts.length) {
      var dest = game.shifts[game.shiftIndex].start;
      var drift = 2;
      if (game.clockMin >= dest) startShift(game.shiftIndex);
      else if (game.clockMin + drift >= dest) {
        game.clockMin = dest;
        startShift(game.shiftIndex);
      } else {
        game.clockMin += drift;
      }
    }
    updateSim();
    requestAnimationFrame(frame);
  }

  function beginPlay() {
    var screen = document.getElementById("title-screen");
    if (screen) screen.hidden = true;
    game.phase = "sim";
    show("sim");
    assignPersona();
    applyTier();
    renderChrome();
    renderSimShell();
    renderModal();
    if (!game.loopStarted) {
      game.loopStarted = true;
      requestAnimationFrame(frame);
    }
  }

  document.getElementById("start-game").addEventListener("click", beginPlay);
  document.getElementById("open-settings").addEventListener("click", function () {
    var note = document.getElementById("title-note");
    if (note) note.hidden = false;
  });

  window.SHOP = {
    game: game,
    config: CONFIG,
    fastForward: function () {
      var guard = 0;
      while (guard < 4) {
        guard += 1;
        if (game.run && !game.run.isOver()) {
          var steps = 0;
          while (!game.run.isOver() && steps < 20000) {
            game.run.step(CONFIG.simStep);
            steps += 1;
          }
          endShift(false);
        } else if (!game.night && game.shiftIndex < game.shifts.length) {
          startShift(game.shiftIndex);
        } else break;
      }
      return game.lastReport;
    }
  };
})();
