if (typeof require === "function") {
  require("./config.js");
  require("./sim.js");
}

var CONFIG = globalThis.SHOP_CONFIG;
var createRun = globalThis.ShopSim.createRun;

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function play(options) {
  var run = createRun(options);
  var guard = 0;
  while (!run.isOver()) {
    run.step(CONFIG.simStep);
    guard += 1;
    if (guard > 20000) throw new Error("模拟步数失控");
  }
  return run.buildReport(options.prev || null);
}

function approxEqual(a, b) {
  return Math.abs(a - b) < 1e-6;
}

function runInvariants() {
  var assignment = { kitchen: "aming", cashier: "xiaoyu", serve: "dazhuang" };
  var first = play({ seed: 7, menu: ["friedrice", "signature"], assignment: assignment });
  var again = play({ seed: 7, menu: ["friedrice", "signature"], assignment: assignment });
  assert(first.revenue === again.revenue && first.completed === again.completed, "同一种子结果不稳定");
  assert(first.arrived === first.completed + first.left + first.abandoned, "到店人数无法拆成完成/流失/未完成");
  assert(first.minRemaining >= -1e-8, "任务剩余时间为负");
  var price = {};
  var cost = {};
  CONFIG.dishes.forEach(function (dish) {
    price[dish.id] = dish.price;
    cost[dish.id] = dish.cost;
  });
  var revenue = 0;
  var ingredient = 0;
  var ids = {};
  first.ledger.forEach(function (entry) {
    assert(!ids[entry.id], "订单重复结算 " + entry.id);
    ids[entry.id] = true;
    revenue += price[entry.dishId];
    ingredient += cost[entry.dishId];
  });
  assert(revenue === first.revenue, "收入与菜品售价不一致");
  assert(ingredient === first.ingredientCost, "食材成本不一致");
  assert(first.profit === first.revenue - first.ingredientCost - first.staffCost, "净利润公式不一致");
  assert(first.staffCost === CONFIG.staffCost * 3, "三名员工的人工不对");
  var flex = { id: "xiaozhou", name: "小周", efficiency: 1, specialty: "any", bonus: 0.3, trait: "任意岗位" };
  var swapped = createRun({
    seed: 4,
    menu: ["noodles"],
    assignment: { kitchen: "dazhuang", cashier: "xiaoyu", serve: "aming" },
    staff: CONFIG.staff.concat([flex]),
    config: CONFIG
  });
  var guard = 0;
  var before = null;
  while (!swapped.isOver() && guard < 400) {
    swapped.step(CONFIG.simStep);
    guard += 1;
    var kitchen = swapped.getState().stations[0];
    if (kitchen.current && kitchen.efficiency === 1) {
      before = kitchen.current.remaining;
      break;
    }
  }
  assert(before > 0.2, "换班测试没有等到后厨开工");
  var beforeProgress = swapped.getState().stations[0].current.progress;
  swapped.setAssignment({ kitchen: ["xiaozhou"], cashier: "xiaoyu", serve: "aming" });
  var handed = swapped.getState().stations[0];
  assert(handed.staffName === "小周", "换班后后厨应是小周");
  assert(handed.current == null, "离开的人应把没做完的单放回队列");
  swapped.step(CONFIG.simStep);
  var after = swapped.getState();
  assert(approxEqual(after.stations[0].efficiency, 1.3), "小周在后厨应为 1.3×");
  assert(approxEqual(after.stations[1].efficiency, 1.3), "小周的加成不该影响仍在收银的小雨");
  assert(after.stations[0].current, "新来的人应接上这单");
  assert(after.stations[0].current.remaining < before - 1e-6, "换上更快的人后，手上这单应缩短");
  assert(after.stations[0].current.progress + 0.05 >= beforeProgress, "进度应接着做，而不是从头来");
  var duo = createRun({
    seed: 4,
    menu: ["noodles"],
    assignment: { kitchen: ["aming", "xiaozhou"], cashier: ["xiaoyu"], serve: ["dazhuang"] },
    staff: CONFIG.staff.concat([flex]),
    config: CONFIG
  });
  var duoGuard = 0;
  var duoJobs = 0;
  while (!duo.isOver() && duoGuard < 800) {
    duo.step(CONFIG.simStep);
    duoGuard += 1;
    var cooking = duo.getState().stoves || [];
    if (cooking.length > duoJobs) duoJobs = cooking.length;
    if (duoJobs >= 2) break;
  }
  assert(duoJobs >= 2, "后厨两个人应同时做两单");
  var capped = createRun({
    seed: 4,
    menu: ["noodles"],
    assignment: { kitchen: ["aming", "xiaozhou"], cashier: ["xiaoyu"], serve: ["dazhuang"] },
    staff: CONFIG.staff.concat([flex]),
    gear: { stoves: 1, tills: 1, tables: 4 },
    config: CONFIG
  });
  var capGuard = 0;
  var capJobs = 0;
  while (!capped.isOver() && capGuard < 800) {
    capped.step(CONFIG.simStep);
    capGuard += 1;
    var limited = (capped.getState().stoves || []).length;
    if (limited > capJobs) capJobs = limited;
  }
  assert(capped.getState().stations[0].staffIds.length === 1, "一个灶台只能站一个人");
  assert(capJobs <= 1, "一个灶台不能同时做两单");
  var seats = play({
    seed: 1,
    menu: ["noodles"],
    assignment: assignment,
    gear: { stoves: 1, tills: 1, tables: 1 },
    config: Object.assign({}, CONFIG, { eatTime: 100, dayDuration: 40 })
  });
  assert(seats.completed === 2, "一张桌子两个座位，客人没吃完之前只能完成两单，实际 " + seats.completed);
  assert((seats.abandonedBy.entrance || 0) + (seats.leftBy.entrance || 0) > 0, "座位满了之后后来的人应在门口等，不能再坐进去");
  var stuck = play({
    seed: 4,
    menu: ["noodles"],
    assignment: { kitchen: ["aming"], cashier: [], serve: ["dazhuang"] },
    config: CONFIG
  });
  var soloRun = createRun({
    seed: 3,
    menu: ["noodles"],
    assignment: { kitchen: ["aming"], cashier: ["aming"], serve: ["aming"] },
    staff: [CONFIG.staff[0]],
    gear: { stoves: 1, tills: 1, tables: 1 },
    config: Object.assign({}, CONFIG, { dayDuration: 30 })
  });
  var soloDoubled = false;
  while (!soloRun.isOver()) {
    soloRun.step(CONFIG.simStep);
    var hands = 0;
    soloRun.getState().stations.forEach(function (station) {
      (station.crew || []).forEach(function (member) {
        if (member.busy && member.staffId === "aming") hands += 1;
      });
    });
    if (hands > 1) soloDoubled = true;
  }
  var solo = soloRun.buildReport(null);
  assert(!soloDoubled, "同一个人不能同时做两个岗位");
  assert(solo.completed > 0, "一个人包三岗应能做完单");
  assert(solo.staffCost === CONFIG.staffCost, "一个人的人工不对");
  assert(stuck.completed === 0, "收银没人时不应有完成订单");
  assert(stuck.leftBy.cashier + stuck.abandonedBy.cashier > 0, "收银没人时单子应卡在收银");
  swapped.setRoster(CONFIG.staff.concat([flex]));
  assert(swapped.getState().staffCost === CONFIG.staffCost * 4, "请来第四人后人工不对");
  if (first.bottleneck) {
    var waitText = first.stations[first.bottleneck].avgQueueWait.toFixed(1);
    assert(first.diagnosis.some(function (line) { return line.indexOf(waitText) !== -1; }), "诊断没有引用真实等待时间");
  }

  var noodles = play({ seed: 3, menu: ["noodles"], assignment: assignment });
  Object.keys(noodles.dishesArrived).forEach(function (id) {
    if (id !== "noodles") assert(noodles.dishesArrived[id] === 0, "单品菜单出现了其他菜");
  });

  var clog = play({
    seed: 2,
    menu: ["noodles"],
    assignment: assignment,
    config: Object.assign({}, CONFIG, {
      dayDuration: 60,
      cashierBaseTime: 100,
      serveBaseTime: 100,
      customerPatience: 25
    })
  });
  assert(clog.completed === 0, "下游极慢时不应有完成订单");
  assert(clog.left > 0, "耐心耗尽后顾客应该离开");
  assert(clog.revenue === 0, "未完成订单不应产生收入");
  assert(clog.leftBy.cashier > clog.leftBy.kitchen, "拥堵测试的流失应主要发生在收银");

  var prev = play({ seed: 11, menu: ["noodles"], assignment: assignment });
  var next = play({ seed: 12, menu: ["noodles"], assignment: assignment, prev: prev });
  assert(next.diagnosis.length > 0, "诊断为空");

  var different = play({ seed: 8, menu: ["friedrice", "noodles"], assignment: assignment });
  assert(
    different.completed !== first.completed || different.revenue !== first.revenue,
    "不同经营方案不应永远完全相同"
  );

  function cookDuration(mood) {
    var staff = CONFIG.staff.map(function (person) {
      var copy = {};
      var key;
      for (key in person) copy[key] = person[key];
      if (copy.id === "aming" && mood) copy.mood = mood;
      return copy;
    });
    var run = createRun({
      seed: 3,
      menu: ["noodles"],
      assignment: { kitchen: "aming", cashier: "xiaoyu", serve: "dazhuang" },
      staff: staff,
      config: CONFIG
    });
    var guard = 0;
    while (!run.isOver() && guard < 500) {
      run.step(CONFIG.simStep);
      guard += 1;
      var job = run.getState().stations[0].current;
      if (job) return job.duration;
    }
    return null;
  }
  var plainCook = cookDuration("");
  var sadCook = cookDuration("沮丧");
  var gladCook = cookDuration("开心");
  assert(plainCook != null && sadCook != null && gladCook != null, "心情测试没有等到后厨开工");
  assert(approxEqual(plainCook, 3 / 1.3), "平常心情后厨应为 1.3×，实际 " + plainCook);
  assert(approxEqual(sadCook, 3 / (1.3 * 0.9)), "沮丧应把效率乘 0.9，实际 " + sadCook);
  assert(approxEqual(gladCook, 3 / (1.3 * 1.1)), "开心应把效率乘 1.1，实际 " + gladCook);
  assert(sadCook > plainCook && plainCook > gladCook, "沮丧应慢于平常，开心应快于平常");

  var carrier = createRun({
    seed: 1,
    menu: ["noodles"],
    assignment: { kitchen: ["aming"], cashier: ["aming"], serve: ["aming", "dazhuang"] },
    staff: CONFIG.staff,
    config: CONFIG
  });
  var firstServer = null;
  var carryGuard = 0;
  while (!carrier.isOver() && carryGuard < 4000) {
    carrier.step(CONFIG.simStep);
    carryGuard += 1;
    var busyServe = (carrier.getState().stations[2].crew || []).filter(function (member) {
      return member.busy;
    });
    if (!firstServer && busyServe.length === 1) firstServer = busyServe[0].staffId;
    if (firstServer) break;
  }
  assert(firstServer === "dazhuang", "第一单传菜应交给专人，实际是 " + firstServer);
}

function average(list, key) {
  var total = 0;
  list.forEach(function (item) { total += item[key]; });
  return total / list.length;
}

function mode(list) {
  var count = {};
  list.forEach(function (item) {
    var key = item || "均衡";
    count[key] = (count[key] || 0) + 1;
  });
  return Object.keys(count).sort(function (a, b) { return count[b] - count[a]; })[0] + " " + count[Object.keys(count).sort(function (a, b) { return count[b] - count[a]; })[0]] + "/" + list.length;
}

var scenarios = [
  {
    name: "均衡分配 · 只卖面条",
    assignment: { kitchen: "aming", cashier: "xiaoyu", serve: "dazhuang" },
    menu: ["noodles"]
  },
  {
    name: "均衡分配 · 炒饭+面条",
    assignment: { kitchen: "aming", cashier: "xiaoyu", serve: "dazhuang" },
    menu: ["friedrice", "noodles"]
  },
  {
    name: "后厨快、下游慢 · 只卖面条",
    assignment: { kitchen: "aming", cashier: "dazhuang", serve: "xiaoyu" },
    menu: ["noodles"]
  },
  {
    name: "均衡分配 · 炒饭+招牌大菜",
    assignment: { kitchen: "aming", cashier: "xiaoyu", serve: "dazhuang" },
    menu: ["friedrice", "signature"]
  },
  {
    name: "传菜无加成 · 只卖面条",
    assignment: { kitchen: "dazhuang", cashier: "xiaoyu", serve: "aming" },
    menu: ["noodles"]
  }
];

var expectBottleneck = {
  "均衡分配 · 只卖面条": null,
  "后厨快、下游慢 · 只卖面条": "cashier",
  "均衡分配 · 炒饭+招牌大菜": "kitchen",
  "传菜无加成 · 只卖面条": "serve"
};

function emit(text) {
  if (typeof console !== "undefined" && console.log) console.log(text);
  else if (typeof print === "function") print(text);
}

runInvariants();

var seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
emit("invariants ok");
scenarios.forEach(function (scenario) {
  var reports = seeds.map(function (seed) {
    return play({ seed: seed, menu: scenario.menu, assignment: scenario.assignment });
  });
  if (Object.prototype.hasOwnProperty.call(expectBottleneck, scenario.name)) {
    reports.forEach(function (report, index) {
      assert(
        report.bottleneck === expectBottleneck[scenario.name],
        scenario.name + " seed " + seeds[index] + " 瓶颈=" + report.bottleneck
      );
    });
  }
  emit([
    scenario.name,
    "完成", average(reports, "completed").toFixed(1),
    "流失", average(reports, "left").toFixed(1),
    "未完成", average(reports, "abandoned").toFixed(1),
    "等待", average(reports, "avgWait").toFixed(1),
    "净利", average(reports, "profit").toFixed(1),
    "瓶颈", mode(reports.map(function (report) { return report.bottleneck; }))
  ].join(" | "));
});
