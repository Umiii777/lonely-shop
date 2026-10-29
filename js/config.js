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
    customerPatience: 25,
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
    dishes: [
      { id: "friedrice", name: "炒饭", price: 96, cost: 32, cookTime: 4, weight: 50 },
      { id: "noodles", name: "面条", price: 80, cost: 24, cookTime: 3, weight: 35 },
      { id: "signature", name: "招牌大菜", price: 160, cost: 64, cookTime: 8, weight: 15 }
    ]
  };

  root.SHOP_CONFIG = CONFIG;
})(typeof globalThis !== "undefined" ? globalThis : this);
