(function (root) {
  var NEXT = { kitchen: "cashier", cashier: "serve", serve: null };
  var STATION_ORDER = ["kitchen", "cashier", "serve"];

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function dishMap(config) {
    var map = {};
    config.dishes.forEach(function (dish) {
      map[dish.id] = dish;
    });
    return map;
  }

  function staffMap(config) {
    var map = {};
    config.staff.forEach(function (staff) {
      map[staff.id] = staff;
    });
    return map;
  }

  function createRun(options) {
    var config = options.config || root.SHOP_CONFIG;
    var rng = mulberry32(options.seed >>> 0);
    var dishes = dishMap(config);
    var roster = (options.staff || config.staff).slice();
    var staffById = {};
    function indexRoster(list) {
      roster = list.slice();
      staffById = {};
      roster.forEach(function (staff) {
        staffById[staff.id] = staff;
      });
    }
    indexRoster(roster);
    var menu = options.menu.slice();
    function asCrew(value) {
      if (!value) return [];
      if (typeof value === "string") return [value];
      return value.filter(Boolean).slice();
    }
    var seatsPerTable = config.seatsPerTable || 2;
    var gear = {
      stoves: options.gear && options.gear.stoves != null ? Math.max(0, options.gear.stoves) : null,
      tills: options.gear && options.gear.tills != null ? Math.max(0, options.gear.tills) : null,
      tables: options.gear && options.gear.tables != null
        ? Math.max(1, options.gear.tables)
        : (config.startingTables || 4)
    };
    function stationCap(id) {
      if (id === "kitchen") return gear.stoves == null ? Infinity : gear.stoves;
      if (id === "cashier") return gear.tills == null ? Infinity : gear.tills;
      return Infinity;
    }
    function fitCrew(id, list) {
      var crew = asCrew(list);
      var cap = stationCap(id);
      if (crew.length > cap) return crew.slice(0, cap);
      return crew;
    }
    var assignment = {
      kitchen: fitCrew("kitchen", options.assignment.kitchen),
      cashier: fitCrew("cashier", options.assignment.cashier),
      serve: fitCrew("serve", options.assignment.serve)
    };

    var stations = {};
    STATION_ORDER.forEach(function (id) {
      stations[id] = {
        id: id,
        queue: [],
        slots: assignment[id].map(function (staffId) {
          return { staffId: staffId, current: null };
        }),
        maxQueue: 0,
        processed: 0,
        queueWaitSum: 0,
        queueWaitCount: 0,
        busyTime: 0
      };
    });

    var run = {
      config: config,
      time: 0,
      over: false,
      endedEarly: false,
      customers: [],
      nextId: 1,
      nextArrival: 0,
      ledger: [],
      left: 0,
      leftBy: { kitchen: 0, cashier: 0, serve: 0, entrance: 0 },
      abandoned: 0,
      abandonedBy: { kitchen: 0, cashier: 0, serve: 0 },
      events: [],
      recentLeft: [],
      diners: [],
      departures: [],
      seatDenied: 0,
      minRemaining: Infinity,
      stepId: 0,
      report: null
    };

    function interval() {
      var span = config.customerIntervalMax - config.customerIntervalMin;
      return config.customerIntervalMin + rng() * span;
    }

    run.nextArrival = interval();

    function pushEvent(text) {
      run.events.push({ t: run.time, text: text });
      if (run.events.length > 8) run.events.shift();
    }

    function efficiencyOfStaff(staffId, stationId) {
      var staff = staffById[staffId];
      if (!staff) return 0;
      var bonus = staff.specialty === "any" || staff.specialty === stationId ? staff.bonus : 0;
      return staff.efficiency * (1 + bonus);
    }

    function efficiencyAt(stationId) {
      var crew = assignment[stationId] || [];
      if (!crew.length) return 0;
      return efficiencyOfStaff(crew[0], stationId);
    }

    function laborCost() {
      return config.staffCost * roster.length;
    }

    function durationFor(stationId, customer, staffId) {
      var eff = efficiencyOfStaff(staffId, stationId);
      if (eff <= 0) return Infinity;
      var base = stationId === "kitchen"
        ? dishes[customer.dishId].cookTime
        : stationId === "cashier"
          ? config.cashierBaseTime
          : config.serveBaseTime;
      return base / eff;
    }

    function pickDish() {
      var pool = [];
      var total = 0;
      menu.forEach(function (id) {
        var dish = dishes[id];
        if (!dish) return;
        pool.push(dish);
        total += dish.weight;
      });
      if (!pool.length || total <= 0) return null;
      var roll = rng() * total;
      for (var i = 0; i < pool.length; i++) {
        roll -= pool[i].weight;
        if (roll <= 0) return pool[i];
      }
      return pool[pool.length - 1];
    }

    function isImpatient(customer) {
      return run.time - customer.enterTime > config.customerPatience;
    }

    function recordQueueWait(customer) {
      if (customer.queueWaitSaved) return;
      if (!stations[customer.station]) return;
      customer.queueWaitSaved = true;
      var wait = Math.max(0, run.time - customer.queueEnterTime);
      var stat = stations[customer.station];
      stat.queueWaitSum += wait;
      stat.queueWaitCount += 1;
    }

    function detach(customer) {
      var station = stations[customer.station];
      if (!station) return;
      station.queue = station.queue.filter(function (item) {
        return item !== customer;
      });
      station.slots.forEach(function (slot) {
        if (slot.current && slot.current.customer === customer) slot.current = null;
      });
    }

    function leave(customer, stationId) {
      if (customer.status !== "active") return;
      if (customer.phase === "queue") recordQueueWait(customer);
      detach(customer);
      customer.status = "left";
      customer.resolveTime = run.time;
      customer.leftStage = stationId;
      run.left += 1;
      if (run.leftBy[stationId] === undefined) run.leftBy[stationId] = 0;
      run.leftBy[stationId] += 1;
      var where = stationId === "entrance" ? "门口" : stationName(stationId);
      pushEvent("#" + customer.id + " 失去耐心，在" + where + "离开");
      run.departures.push({
        id: customer.id,
        dishId: customer.dishId,
        dishName: customer.dishId && dishes[customer.dishId] ? dishes[customer.dishId].name : "",
        until: run.time + 1.5
      });
      run.recentLeft.push({
        id: customer.id,
        dishId: customer.dishId,
        dishName: customer.dishId && dishes[customer.dishId] ? dishes[customer.dishId].name : "",
        until: run.time + 2.4
      });
    }

    function stationName(id) {
      var found = config.stations.filter(function (station) { return station.id === id; })[0];
      return found ? found.name : id;
    }

    function seatSnapshot() {
      var used = occupiedSeats();
      var total = gear.tables * seatsPerTable;
      var taken = 0;
      Object.keys(used).forEach(function (key) {
        var table = Number(key.split(":")[0]);
        if (table >= 0 && table < gear.tables) taken += 1;
      });
      return {
        stoves: gear.stoves == null ? stations.kitchen.slots.length : gear.stoves,
        tills: gear.tills == null ? stations.cashier.slots.length : gear.tills,
        tables: gear.tables,
        seats: total,
        taken: taken,
        free: Math.max(0, total - taken),
        capped: gear.stoves != null || gear.tills != null
      };
    }

    function occupiedSeats() {
      var used = {};
      function mark(table, seat) {
        if (table == null || seat == null) return;
        used[table + ":" + seat] = true;
      }
      run.diners.forEach(function (diner) { mark(diner.table, diner.seat); });
      run.customers.forEach(function (customer) {
        if (customer.status === "active") mark(customer.table, customer.seat);
      });
      return used;
    }

    function claimSeat() {
      var used = occupiedSeats();
      var table;
      var seat;
      for (table = 0; table < gear.tables; table++) {
        for (seat = 0; seat < seatsPerTable; seat++) {
          if (!used[table + ":" + seat]) return { table: table, seat: seat };
        }
      }
      return null;
    }

    function enqueue(stationId, customer) {
      customer.station = stationId;
      customer.phase = "queue";
      customer.queueEnterTime = run.time;
      customer.queueWaitSaved = false;
      stations[stationId].queue.push(customer);
    }

    function settle(customer) {
      if (customer.status !== "active") return;
      var dish = dishes[customer.dishId];
      customer.status = "done";
      customer.resolveTime = run.time;
      run.ledger.push({
        id: customer.id,
        dishId: customer.dishId,
        price: dish.price,
        cost: dish.cost
      });
      var tableNo = customer.table == null ? 1 : customer.table + 1;
      run.diners.push({
        id: customer.id,
        dishId: customer.dishId,
        dishName: dish.name,
        table: customer.table == null ? 0 : customer.table,
        seat: customer.seat == null ? 0 : customer.seat,
        phase: "eating",
        start: run.time,
        until: run.time + (config.eatTime || 6)
      });
      pushEvent("#" + customer.id + " 坐到 " + tableNo + " 号桌吃" + dish.name + " +" + dish.price);
    }

    function complete(station, slot) {
      var current = slot.current;
      if (!current) return;
      var customer = current.customer;
      if (customer.completedStepId === run.stepId) {
        throw new Error("同一订单在同一步内完成了多个岗位");
      }
      customer.completedStepId = run.stepId;
      customer.workedFraction = 0;
      slot.current = null;
      if (customer.status !== "active") return;
      station.processed += 1;
      if (isImpatient(customer)) {
        leave(customer, station.id);
        return;
      }
      var next = NEXT[station.id];
      if (!next) settle(customer);
      else enqueue(next, customer);
    }

    function pickLabel(list) {
      var source = list && list.length ? list : ["内向"];
      return source[Math.floor(Math.random() * source.length)];
    }

    function spawnOne(arrivalTime) {
      var customer = {
        id: run.nextId++,
        dishId: null,
        status: "active",
        station: null,
        phase: null,
        enterTime: arrivalTime,
        queueEnterTime: arrivalTime,
        resolveTime: null,
        queueWaitSaved: false,
        completedStepId: -1,
        leftStage: null,
        personality: pickLabel(config.personalities),
        mood: pickLabel(config.moods)
      };
      run.customers.push(customer);
      var dish = pickDish();
      if (!dish) {
        customer.status = "left";
        customer.resolveTime = arrivalTime;
        customer.leftStage = "entrance";
        run.left += 1;
        run.leftBy.entrance += 1;
        pushEvent("顾客到店，菜单是空的，直接离开");
        return;
      }
      customer.dishId = dish.id;
      enqueue("kitchen", customer);
      customer.queueEnterTime = arrivalTime;
      pushEvent("#" + customer.id + " 到店，点了" + dish.name);
    }

    function spawn() {
      while (run.nextArrival <= run.time && run.nextArrival <= config.dayDuration + 1e-8) {
        spawnOne(run.nextArrival);
        run.nextArrival += interval();
      }
    }

    function expire() {
      STATION_ORDER.forEach(function (id) {
        var station = stations[id];
        station.queue.slice().forEach(function (customer) {
          if (customer.status === "active" && isImpatient(customer)) leave(customer, id);
        });
        station.slots.forEach(function (slot) {
          if (slot.current && slot.current.customer.status === "active" && isImpatient(slot.current.customer)) {
            leave(slot.current.customer, id);
          }
        });
      });
    }

    function pickup() {
      var blockedSeat = false;
      var busy = {};
      STATION_ORDER.forEach(function (id) {
        stations[id].slots.forEach(function (slot) {
          if (slot.current) busy[slot.staffId] = true;
        });
      });
      // 同一个人可以同时挂在几个岗位上，但手上只能有一单。先接传菜，再收银，再后厨，
      // 一个人包三岗时单子才走得完。每个岗位是不同的人时，这个顺序不改变结果。
      ["serve", "cashier", "kitchen"].forEach(function (id) {
        var station = stations[id];
        if (!station.slots.length) return;
        station.slots.forEach(function (slot) {
          if (slot.current || !station.queue.length) return;
          if (busy[slot.staffId]) return;
          if (efficiencyOfStaff(slot.staffId, id) <= 0) return;
          var customer = station.queue[0];
          if (!customer || customer.status !== "active") {
            station.queue.shift();
            return;
          }
          if (id === "serve") {
            var held = customer.table != null && customer.seat != null;
            var seat = held ? { table: customer.table, seat: customer.seat } : claimSeat();
            if (!seat) {
              blockedSeat = true;
              return;
            }
            customer.table = seat.table;
            customer.seat = seat.seat;
          }
          station.queue.shift();
          recordQueueWait(customer);
          customer.phase = "work";
          var duration = durationFor(id, customer, slot.staffId);
          var fraction = customer.workedFraction || 0;
          customer.workedFraction = 0;
          slot.current = {
            customer: customer,
            duration: duration,
            remaining: Math.max(0, duration * (1 - fraction))
          };
          busy[slot.staffId] = true;
        });
      });
      if (blockedSeat) run.seatDenied += 1;
    }

    function progress(dt) {
      STATION_ORDER.forEach(function (id) {
        var station = stations[id];
        station.slots.forEach(function (slot) {
          if (!slot.current) return;
          var remaining = slot.current.remaining;
          var worked = Math.min(dt, remaining);
          slot.current.remaining = remaining - worked;
          station.busyTime += worked;
          if (slot.current.remaining < run.minRemaining) run.minRemaining = slot.current.remaining;
          if (slot.current.remaining <= 1e-8) complete(station, slot);
        });
      });
    }

    function tickDiners() {
      var eatTime = config.eatTime || 6;
      run.diners.forEach(function (diner) {
        if (diner.phase === "eating" && run.time >= diner.until) {
          diner.phase = "leaving";
          diner.start = run.time;
          diner.until = run.time + 1.4;
          pushEvent("#" + diner.id + " 吃完，离开小店");
        } else if (diner.phase === "eating") {
          diner.progress = Math.min(1, (run.time - diner.start) / eatTime);
        }
      });
      run.diners = run.diners.filter(function (diner) {
        return !(diner.phase === "leaving" && run.time >= diner.until);
      });
      run.departures = run.departures.filter(function (item) {
        return item.until >= run.time;
      });
    }

    function sampleQueues() {
      STATION_ORDER.forEach(function (id) {
        var station = stations[id];
        if (station.queue.length > station.maxQueue) station.maxQueue = station.queue.length;
      });
    }

    run.setRoster = function (list) {
      indexRoster(list || []);
    };

    run.setAssignment = function (next) {
      STATION_ORDER.forEach(function (id) {
        var wanted = fitCrew(id, next && next[id]);
        assignment[id] = wanted;
        var station = stations[id];
        var kept = [];
        var displaced = [];
        station.slots.forEach(function (slot) {
          if (wanted.indexOf(slot.staffId) !== -1) {
            kept.push(slot);
            return;
          }
          if (slot.current && slot.current.customer.status === "active") {
            var job = slot.current;
            job.customer.workedFraction = job.duration > 0 ? Math.min(1, 1 - job.remaining / job.duration) : 0;
            job.customer.phase = "queue";
            job.customer.queueWaitSaved = true;
            displaced.push(job.customer);
          }
        });
        wanted.forEach(function (staffId) {
          var exists = false;
          kept.forEach(function (slot) {
            if (slot.staffId === staffId) exists = true;
          });
          if (!exists) kept.push({ staffId: staffId, current: null });
        });
        station.slots = kept;
        displaced.reverse().forEach(function (customer) {
          customer.station = id;
          station.queue.unshift(customer);
        });
      });
    };

    run.note = function (text) {
      if (text) pushEvent(text);
    };

    run.step = function (dt) {
      if (run.over) return;
      var room = config.dayDuration - run.time;
      var slice = Math.min(dt, Math.max(0, room));
      if (slice <= 0) {
        run.over = true;
        return;
      }
      run.stepId += 1;
      run.time += slice;
      spawn();
      expire();
      pickup();
      progress(slice);
      expire();
      tickDiners();
      sampleQueues();
      if (run.time >= config.dayDuration - 1e-8) run.over = true;
    };

    run.endNow = function () {
      run.endedEarly = true;
      run.over = true;
    };

    run.isOver = function () {
      return run.over;
    };

    function finalize() {
      STATION_ORDER.forEach(function (id) {
        var station = stations[id];
        station.queue.slice().forEach(function (customer) {
          if (customer.status !== "active") return;
          recordQueueWait(customer);
          customer.status = "abandoned";
          customer.resolveTime = run.time;
          run.abandoned += 1;
          run.abandonedBy[id] += 1;
        });
        station.queue = [];
        station.slots.forEach(function (slot) {
          if (!slot.current || slot.current.customer.status !== "active") return;
          var customer = slot.current.customer;
          customer.status = "abandoned";
          customer.resolveTime = run.time;
          run.abandoned += 1;
          run.abandonedBy[id] += 1;
          slot.current = null;
        });
      });
    }

    function sum(list, key) {
      return list.reduce(function (total, item) { return total + item[key]; }, 0);
    }

    function avgQueue(station) {
      if (!station.queueWaitCount) return 0;
      return station.queueWaitSum / station.queueWaitCount;
    }

    function argmax(map) {
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

    function compose(prev) {
      var revenue = sum(run.ledger, "price");
      var ingredientCost = sum(run.ledger, "cost");
      var staffCost = laborCost();
      var profit = revenue - ingredientCost - staffCost;
      var arrived = run.customers.length;
      var waitSum = 0;
      run.customers.forEach(function (customer) {
        var end = customer.resolveTime == null ? run.time : customer.resolveTime;
        waitSum += Math.max(0, end - customer.enterTime);
      });
      var dishesCompleted = { friedrice: 0, noodles: 0, signature: 0 };
      var dishesArrived = { friedrice: 0, noodles: 0, signature: 0 };
      run.customers.forEach(function (customer) {
        if (!customer.dishId) return;
        if (dishesArrived[customer.dishId] === undefined) dishesArrived[customer.dishId] = 0;
        dishesArrived[customer.dishId] += 1;
      });
      run.ledger.forEach(function (entry) {
        if (dishesCompleted[entry.dishId] === undefined) dishesCompleted[entry.dishId] = 0;
        dishesCompleted[entry.dishId] += 1;
      });

      var stationList = STATION_ORDER.map(function (id) {
        var station = stations[id];
        var crew = assignment[id] || [];
        var names = crew.map(function (staffId) {
          return staffById[staffId] ? staffById[staffId].name : staffId;
        });
        return {
          id: id,
          name: stationName(id),
          staffId: crew[0] || null,
          staffIds: crew.slice(),
          staffName: names.length ? names.join("、") : "空缺",
          efficiency: efficiencyAt(id),
          avgQueueWait: avgQueue(station),
          maxQueue: station.maxQueue,
          processed: station.processed,
          busyTime: station.busyTime,
          queueWaitCount: station.queueWaitCount
        };
      });

      var ranked = stationList.slice().sort(function (a, b) {
        return b.avgQueueWait - a.avgQueueWait;
      });
      var top = ranked[0];
      var secondWait = ranked[1] ? ranked[1].avgQueueWait : 0;
      var bottleneck = null;
      var clearlyAhead = top.avgQueueWait >= secondWait + 1 || top.avgQueueWait >= Math.max(0.5, secondWait) * 1.45;
      if (top.avgQueueWait >= config.bottleneckMinWait && clearlyAhead) bottleneck = top.id;
      else if (top.avgQueueWait >= 4 && top.avgQueueWait >= secondWait + 0.6) bottleneck = top.id;

      var report = {
        seed: options.seed >>> 0,
        elapsed: run.time,
        endedEarly: run.endedEarly,
        menu: menu.slice(),
        assignment: {
          kitchen: assignment.kitchen,
          cashier: assignment.cashier,
          serve: assignment.serve
        },
        revenue: revenue,
        ingredientCost: ingredientCost,
        staffCost: staffCost,
        profit: profit,
        arrived: arrived,
        completed: run.ledger.length,
        left: run.left,
        abandoned: run.abandoned,
        avgWait: arrived ? waitSum / arrived : 0,
        avgTicket: run.ledger.length ? revenue / run.ledger.length : 0,
        leftBy: {
          kitchen: run.leftBy.kitchen,
          cashier: run.leftBy.cashier,
          serve: run.leftBy.serve,
          entrance: run.leftBy.entrance
        },
        abandonedBy: {
          kitchen: run.abandonedBy.kitchen,
          cashier: run.abandonedBy.cashier,
          serve: run.abandonedBy.serve
        },
        mainLeftStage: argmax(run.leftBy),
        mainAbandonedStage: argmax(run.abandonedBy),
        dishesCompleted: dishesCompleted,
        dishesArrived: dishesArrived,
        stationList: stationList,
        stations: {},
        bottleneck: bottleneck,
        minRemaining: run.minRemaining === Infinity ? 0 : run.minRemaining,
        ledger: run.ledger.slice(),
        seatDenied: run.seatDenied,
        gear: {
          stoves: gear.stoves,
          tills: gear.tills,
          tables: gear.tables,
          seats: gear.tables * seatsPerTable
        }
      };
      stationList.forEach(function (station) {
        report.stations[station.id] = station;
      });
      report.diagnosis = diagnose(report, prev);
      return report;
    }

    run.buildReport = function (prev) {
      if (!run.report) {
        finalize();
        run.over = true;
        run.report = compose(prev || null);
      }
      return run.report;
    };

    run.getState = function () {
      var revenue = sum(run.ledger, "price");
      var ingredientCost = sum(run.ledger, "cost");
      var activeWaits = run.customers.filter(function (customer) {
        return customer.status === "active";
      }).map(function (customer) {
        return run.time - customer.enterTime;
      });
      var longestWait = activeWaits.length ? Math.max.apply(null, activeWaits) : 0;
      var people = [];
      function customerById(id) {
        var i;
        for (i = 0; i < run.customers.length; i++) {
          if (run.customers[i].id === id) return run.customers[i];
        }
        return null;
      }
      function pushGuest(customer, where, slot) {
        var dish = dishes[customer.dishId];
        people.push({
          key: "c" + customer.id,
          id: customer.id,
          dishId: customer.dishId,
          dishName: dish ? dish.name : "",
          where: where,
          slot: slot || 0,
          table: customer.table,
          seat: customer.seat,
          wait: run.time - customer.enterTime,
          late: run.time - customer.enterTime > config.customerPatience * 0.72,
          progress: 0,
          personality: customer.personality || "",
          mood: customer.mood || ""
        });
      }
      stations.kitchen.queue.forEach(function (customer, index) { pushGuest(customer, "wait", index); });
      stations.kitchen.slots.forEach(function (slot, index) {
        if (slot.current) pushGuest(slot.current.customer, "wait-front", index);
      });
      stations.cashier.queue.forEach(function (customer, index) { pushGuest(customer, "pay-line", index); });
      stations.cashier.slots.forEach(function (slot, index) {
        if (slot.current) pushGuest(slot.current.customer, "paying", index);
      });
      stations.serve.queue.forEach(function (customer, index) { pushGuest(customer, "food-ready", index); });
      stations.serve.slots.forEach(function (slot) {
        if (!slot.current) return;
        pushGuest(slot.current.customer, "seating", 0);
        var seating = slot.current;
        var walking = people[people.length - 1];
        walking.progress = seating.duration > 0 ? 1 - seating.remaining / seating.duration : 1;
      });
      run.diners.forEach(function (diner) {
        var source = customerById(diner.id);
        people.push({
          key: "c" + diner.id,
          id: diner.id,
          dishId: diner.dishId,
          dishName: diner.dishName,
          where: diner.phase === "leaving" ? "leaving" : "eating",
          slot: 0,
          table: diner.table,
          seat: diner.seat,
          wait: 0,
          late: false,
          progress: diner.phase === "eating" ? Math.min(1, (run.time - diner.start) / (config.eatTime || 6)) : 1,
          personality: source ? source.personality || "" : "",
          mood: source ? source.mood || "" : ""
        });
      });
      run.departures.forEach(function (item) {
        var source = customerById(item.id);
        people.push({
          key: "c" + item.id,
          id: item.id,
          dishId: item.dishId,
          dishName: item.dishName,
          where: "walkout",
          slot: 0,
          table: null,
          seat: null,
          wait: config.customerPatience,
          late: true,
          progress: 1,
          personality: source ? source.personality || "" : "",
          mood: source ? source.mood || "" : ""
        });
      });
      function jobOf(slot) {
        if (!slot.current) return null;
        var customer = slot.current.customer;
        var dish = dishes[customer.dishId];
        var duration = slot.current.duration;
        return {
          staffId: slot.staffId,
          customerId: customer.id,
          dishId: customer.dishId,
          dishName: dish ? dish.name : "",
          table: customer.table,
          duration: duration,
          remaining: Math.max(0, slot.current.remaining),
          progress: duration > 0 ? 1 - slot.current.remaining / duration : 1,
          wait: run.time - customer.enterTime
        };
      }
      function jobsOf(station) {
        var jobs = [];
        station.slots.forEach(function (slot) {
          var job = jobOf(slot);
          if (job) jobs.push(job);
        });
        return jobs;
      }
      var kitchenJobs = jobsOf(stations.kitchen);
      var cashierJobs = jobsOf(stations.cashier);
      var serveJobs = jobsOf(stations.serve);
      var stove = kitchenJobs[0] || null;
      var till = cashierJobs[0] || null;
      var carry = serveJobs[0] || null;
      return {
        time: run.time,
        dayDuration: config.dayDuration,
        over: run.over,
        arrived: run.customers.length,
        completed: run.ledger.length,
        left: run.left,
        abandoned: run.abandoned,
        revenue: revenue,
        ingredientCost: ingredientCost,
        staffCost: laborCost(),
        longestWait: longestWait,
        patience: config.customerPatience,
        nextArrival: Math.max(0, run.nextArrival - run.time),
        accepting: run.nextArrival <= config.dayDuration && run.time < config.dayDuration,
        recentLeft: run.recentLeft.filter(function (item) { return item.until >= run.time; }),
        events: run.events.slice(),
        people: people,
        stove: stove,
        till: till,
        carry: carry,
        stoves: kitchenJobs,
        tills: cashierJobs,
        carries: serveJobs,
        gear: seatSnapshot(),
        stations: STATION_ORDER.map(function (id) {
          var station = stations[id];
          var crewIds = assignment[id] || [];
          var names = crewIds.map(function (staffId) {
            return staffById[staffId] ? staffById[staffId].name : staffId;
          });
          var jobs = jobsOf(station);
          var current = jobs[0] || null;
          return {
            id: id,
            name: stationName(id),
            staffName: names.length ? names.join("、") : "空缺",
            staffIds: crewIds.slice(),
            crew: station.slots.map(function (slot, index) {
              var staff = staffById[slot.staffId];
              var job = jobOf(slot);
              return {
                staffId: slot.staffId,
                staffName: staff ? staff.name : slot.staffId,
                index: index,
                efficiency: efficiencyOfStaff(slot.staffId, id),
                dishId: job ? job.dishId : "",
                dishName: job ? job.dishName : "",
                progress: job ? job.progress : 0,
                table: job ? job.table : null,
                busy: !!job
              };
            }),
            efficiency: efficiencyAt(id),
            queueLength: station.queue.length,
            current: current,
            queue: station.queue.map(function (customer) {
              var dish = dishes[customer.dishId];
              return {
                id: customer.id,
                dishId: customer.dishId,
                dishName: dish ? dish.name : "",
                wait: run.time - customer.enterTime
              };
            })
          };
        })
      };
    };

    return run;
  }

  function diagnose(report, prev) {
    var name = { kitchen: "后厨", cashier: "收银", serve: "传菜", entrance: "门口" };
    var lines = [];
    if (!report.bottleneck) {
      var maxWait = 0;
      report.stationList.forEach(function (station) {
        if (station.avgQueueWait > maxWait) maxWait = station.avgQueueWait;
      });
      if (maxWait >= 3) lines.push("本轮各岗位等待都偏长，但没有单一岗位明显更堵。");
      else lines.push("本轮各岗位运转较为均衡。");
    } else {
      var station = report.stations[report.bottleneck];
      var waitText = station.avgQueueWait.toFixed(1);
      if (report.bottleneck === "kitchen") {
        lines.push("后厨平均等待时间最高（" + waitText + " 秒），制作速度限制了整体出餐量。");
      } else if (report.bottleneck === "cashier") {
        lines.push("收银平均等待时间最高（" + waitText + " 秒），结算速度限制了后续出餐。");
      } else {
        lines.push("传菜队列持续积压，平均等待 " + waitText + " 秒，部分已制作完成的餐品未能及时交付。");
      }
      if (!station.staffIds.length) {
        lines.push(name[report.bottleneck] + "没有人，新来的单都会卡在这里，后面的岗位等不到活。");
      } else if (station.efficiency < 1.05) {
        lines.push(name[report.bottleneck] + "当前效率 " + station.efficiency.toFixed(1) + "×，员工没有吃到该岗位的特性加成。");
      }
      if (report.bottleneck === "kitchen" && (report.dishesArrived.signature || 0) > 0) {
        lines.push("菜单里有招牌大菜，制作耗时更长，后厨更容易堆积。");
      }
    }
    if (report.seatDenied >= 15 && report.gear) {
      lines.push("座位满过一阵：店里 " + report.gear.tables + " 张桌子、" + report.gear.seats + " 个座位。满座时传菜端不出去，后面的单堵在出餐口。");
    }
    if (report.left > 0 && report.mainLeftStage) {
      lines.push("本轮顾客流失 " + report.left + " 人，主要发生在" + name[report.mainLeftStage] + "等待阶段。");
    }
    if (report.abandoned >= 5 && report.mainAbandonedStage) {
      lines.push("打烊时仍有 " + report.abandoned + " 位顾客未完成消费，主要积压在" + name[report.mainAbandonedStage] + "。");
    } else if (report.abandoned > 0) {
      lines.push("打烊时还有 " + report.abandoned + " 位顾客留在流程里，这些订单没有收入。");
    }
    if (prev) {
      var sig = share(report, "signature");
      var prevSig = share(prev, "signature");
      if (
        report.completed > prev.completed &&
        sig < prevSig - 0.05 &&
        report.avgTicket + 0.05 < prev.avgTicket
      ) {
        lines.push("本轮完成订单数增加，但招牌大菜占比降低，平均单笔收入下降。");
      } else if (report.profit > prev.profit) {
        lines.push("净利润比上一轮增加 " + (report.profit - prev.profit) + " 元。");
      } else if (report.profit < prev.profit) {
        lines.push("净利润比上一轮减少 " + (prev.profit - report.profit) + " 元。");
      }
    }
    if (!lines.length) lines.push("本轮各岗位运转较为均衡。");
    return lines;
  }

  function share(report, dishId) {
    if (!report.completed) return 0;
    return (report.dishesCompleted[dishId] || 0) / report.completed;
  }

  root.ShopSim = {
    createRun: createRun,
    diagnose: diagnose
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
