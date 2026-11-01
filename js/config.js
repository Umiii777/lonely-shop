(function (root) {
  // 可调参数集中在这里。菜品、耐心、到店间隔、员工加成来自需求；
  // 收银/传菜基础耗时需求未给定，用来把岗位依赖调到能看出来的程度。
  var CONFIG = {
    title: "孤独的美食店",
    startingCash: 1000,
    goalCash: 10000,
    goalDays: 10,
    dayDuration: 90,
    simStep: 0.1,
    // 钟面从清晨 6:00 走到次日 6:00。营业时段按这个比例换算成模拟秒，避免一天拉得太长。
    dayStart: 6 * 60,
    lastHour: 23,
    minutesPerSimSecond: 5,
    shifts: [
      { id: "lunch", name: "午市", start: 11 * 60, end: 14 * 60 },
      { id: "dinner", name: "晚市", start: 17 * 60, end: 21 * 60 }
    ],
    customerIntervalMin: 2,
    customerIntervalMax: 4,
    // 按天数分三档，不跟店面设备联动。第 1 天少，第 2–4 天中，第 5 天起多。
    traffic: [
      { name: "少", min: 7, max: 10 },
      { name: "中", min: 4, max: 7 },
      { name: "多", min: 2, max: 4 }
    ],
    customerPatience: 25,
    // 剩余耐心低于这个秒数时，客人头上变色。
    patienceWarn: 8,
    // 门口外面最多这么多张等位小凳。坐满后新来的人不会停下。
    entranceWaitCap: 5,
    staffCost: 40,
    cashierBaseTime: 3.8,
    serveBaseTime: 3.5,
    eatTime: 6,
    maxMenu: 2,
    startingStoves: 1,
    startingTills: 1,
    startingTables: 4,
    seatsPerTable: 2,
    // 平均队列等待低于此值，且没有明显领先者，视为运转均衡
    bottleneckMinWait: 3,
    stations: [
      { id: "kitchen", name: "后厨", action: "制作" },
      { id: "cashier", name: "收银", action: "结算" },
      { id: "serve", name: "传菜", action: "交付" }
    ],
    staff: [
      { id: "aming", name: "阿明", efficiency: 1, specialty: "kitchen", bonus: 0.3, trait: "炒菜效率 +30%" },
      { id: "xiaoyu", name: "小雨", efficiency: 1, specialty: "cashier", bonus: 0.3, trait: "收银效率 +30%" },
      { id: "dazhuang", name: "大壮", efficiency: 1, specialty: "serve", bonus: 0.3, trait: "传菜效率 +30%" }
    ],
    flexStaff: {
      id: "xiaozhou",
      name: "小周",
      efficiency: 1,
      specialty: "any",
      bonus: 0.3,
      trait: "任意岗位效率 +30%"
    },
    personalities: ["内向", "外向", "随和"],
    moods: ["开心", "平常", "沮丧"],
    // 乘在岗位效率上。开心 +0.1，沮丧降到 0.9，平常不变。每天开始时重抽。
    moodFactor: { "开心": 1.1, "平常": 1, "沮丧": 0.9 },
    // 营业中员工掉线。时间用模拟秒，1× 时约等于真实秒。心情「不佳」对应沮丧。
    outage: {
      checkEvery: 1.5,
      startAfter: 20,
      durationMin: 12,
      durationMax: 18,
      baseChance: 0.06,
      badMood: "沮丧",
      badMoodMultiplier: 2,
      soloMultiplier: 0.15,
      chanceCap: 0.35,
      maxPerService: 1,
      // 一次掉线结束后，至少这么多模拟秒内不再检查下一次。
      cooldown: 25
    },
    dishes: [
      { id: "friedrice", name: "炒饭", price: 96, cost: 32, cookTime: 4, weight: 50 },
      { id: "noodles", name: "面条", price: 80, cost: 24, cookTime: 3, weight: 35 },
      { id: "signature", name: "招牌大菜", price: 160, cost: 64, cookTime: 8, weight: 15 }
    ]
  };

  root.SHOP_CONFIG = CONFIG;
})(typeof globalThis !== "undefined" ? globalThis : this);
