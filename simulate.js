/* 牙了个牙 难度蒙特卡洛模拟器
   生成逻辑与 game.js 保持一致，机器人模拟一个不错的人类玩家（只用可见信息），
   用来把「一遍过、不看视频答题」的通过率调到目标值（约 1%）。
   运行：node simulate.js [局数]
*/
"use strict";

const GRID = 24;
const TILE_U = 3;
const MAX_Y = 16; // 近似手机屏棋盘纵向可用单位
const BAR_SLOTS = 7;

// ---------- 可调配置 ----------
const CONFIGS = {
  // 现行第 2 关：14 种图案 + 8 个单格暗堆
  official: { types: 14, batches: 8, perBatch: 16, pileEach: 10, stacks: 8, stackDepth: 6 },
  // 当前线上版（无单格暗堆）
  current: { types: 10, batches: 10, perBatch: 18, pileEach: 12, stacks: 0, stackDepth: 0 },
  // 候选：加单格暗堆、加图案种数
  a: { types: 12, batches: 8, perBatch: 14, pileEach: 12, stacks: 8, stackDepth: 6 },
  b: { types: 14, batches: 8, perBatch: 14, pileEach: 15, stacks: 10, stackDepth: 6 },
  c: { types: 14, batches: 7, perBatch: 12, pileEach: 18, stacks: 12, stackDepth: 7 },
  d: { types: 12, batches: 8, perBatch: 16, pileEach: 12, stacks: 10, stackDepth: 5 },
  e: { types: 14, batches: 9, perBatch: 16, pileEach: 12, stacks: 8, stackDepth: 5 },
  // 健全性检查用：应该高胜率
  sanity1: { types: 5, batches: 2, perBatch: 10, pileEach: 0, stacks: 0, stackDepth: 0 },
  sanity2: { types: 8, batches: 4, perBatch: 12, pileEach: 5, stacks: 0, stackDepth: 0 },
  sanity3: { types: 8, batches: 6, perBatch: 15, pileEach: 8, stacks: 4, stackDepth: 4 },
  // 200+ 总牌数、带单格暗堆，扫描图案数与暗堆占比
  f: { types: 8, batches: 8, perBatch: 16, pileEach: 12, stacks: 8, stackDepth: 6 },
  g: { types: 8, batches: 10, perBatch: 16, pileEach: 8, stacks: 6, stackDepth: 5 },
  h: { types: 9, batches: 10, perBatch: 16, pileEach: 8, stacks: 6, stackDepth: 4 },
  i: { types: 8, batches: 11, perBatch: 16, pileEach: 6, stacks: 4, stackDepth: 4 },
  j: { types: 7, batches: 9, perBatch: 16, pileEach: 10, stacks: 8, stackDepth: 6 },
  k: { types: 9, batches: 11, perBatch: 17, pileEach: 6, stacks: 4, stackDepth: 3 },
  // f(0.66%) 与 j(3.16%) 之间微调
  f2: { types: 8, batches: 8, perBatch: 16, pileEach: 10, stacks: 8, stackDepth: 6 },
  f3: { types: 8, batches: 8, perBatch: 16, pileEach: 12, stacks: 8, stackDepth: 5 },
  f4: { types: 8, batches: 9, perBatch: 16, pileEach: 10, stacks: 7, stackDepth: 5 },
};

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* 生成一局（与 game.js 同思路）：
   牌 = 中央散铺区（部分重叠，暗牌可见图案） + 单格暗堆（完全重叠，只见最顶） + 两摞盲堆 */
function generate(cfg) {
  const unit = cfg.types * 3;
  const minBlocks =
    cfg.batches * cfg.perBatch + cfg.pileEach * 2 + cfg.stacks * cfg.stackDepth;
  const total = Math.ceil(minBlocks / unit) * unit;

  const bag = [];
  for (let i = 0; i < total; i++) bag.push(i % cfg.types);
  shuffle(bag);

  const tiles = bag.map((type, i) => ({
    id: i, type, x: 0, y: 0, layer: 0,
    zone: "board", // board / stack / pile / bar / gone
    stackId: -1, pileId: -1,
  }));

  let pos = 0;
  // 两摞盲堆（数组头 = 顶）
  const piles = [[], []];
  for (let p = 0; p < 2; p++) {
    for (let i = 0; i < cfg.pileEach; i++) {
      const t = tiles[pos++];
      t.zone = "pile";
      t.pileId = p;
      piles[p].push(t);
    }
  }

  // 单格暗堆：互不重叠的格位，完全重叠堆放（数组尾 = 顶）
  const stacks = [];
  const stackCells = [];
  for (let s = 0; s < cfg.stacks; s++) {
    for (let tries = 0; tries < 500; tries++) {
      const x = 0.5 + Math.floor(Math.random() * ((GRID - TILE_U - 1) / 1.5)) * 1.5;
      const y = 0.5 + Math.floor(Math.random() * ((MAX_Y - 0.5) / 1.5)) * 1.5;
      if (!stackCells.some((c) => Math.abs(c.x - x) < TILE_U && Math.abs(c.y - y) < TILE_U)) {
        stackCells.push({ x, y });
        break;
      }
    }
  }
  for (const cell of stackCells) {
    const st = [];
    for (let d = 0; d < cfg.stackDepth; d++) {
      const t = tiles[pos++];
      t.zone = "stack";
      t.stackId = stacks.length;
      t.x = cell.x; t.y = cell.y;
      st.push(t);
    }
    stacks.push(st);
  }

  // 散铺区：分批生成，边界轮流收缩，同批禁止完全重合，且避开暗堆格位
  const placed = [];
  let minX = 0, maxX = GRID - TILE_U, minY = 0, maxY = MAX_Y;
  let left = total - pos;
  for (let b = 0; b < cfg.batches && left > 0; b++) {
    if (b > 0) {
      const dir = b % 4;
      if (dir === 0 && maxX - minX > 8) minX += 1;
      else if (dir === 1 && maxY - minY > 6) maxY -= 1;
      else if (dir === 2 && maxY - minY > 6) minY += 1;
      else if (maxX - minX > 8) maxX -= 1;
    }
    const count = b === cfg.batches - 1 ? left : Math.min(cfg.perBatch, left);
    const batchSet = new Set();
    for (let i = 0; i < count; i++) {
      const t = tiles[pos++];
      let x = 0, y = 0;
      for (let tries = 0; tries < 500; tries++) {
        x = minX + Math.floor(Math.random() * (maxX - minX + 1));
        y = minY + Math.floor(Math.random() * (maxY - minY + 1));
        const key = x + "," + y;
        if (batchSet.has(key)) continue;
        if (stackCells.some((c) => Math.abs(c.x - x) < TILE_U && Math.abs(c.y - y) < TILE_U)) continue;
        batchSet.add(key);
        break;
      }
      t.x = x; t.y = y;
      let maxL = 0;
      for (const q of placed) {
        if (Math.abs(q.x - x) < TILE_U && Math.abs(q.y - y) < TILE_U) maxL = Math.max(maxL, q.layer);
      }
      t.layer = maxL + 1;
      placed.push(t);
    }
    left -= count;
  }

  return { tiles, piles, stacks, total };
}

/* 机器人：贪心策略，只用人类可见的信息
   可见牌：散铺区所有牌（含被压的，图案可见）、每个暗堆顶、每摞盲堆顶
   可点牌：散铺区未被压的、暗堆顶、盲堆顶 */
function playBot(g) {
  const { tiles, piles, stacks } = g;
  const bar = []; // 元素为 type
  let outUsed = false, shuffleUsed = false;

  const boardTiles = () => tiles.filter((t) => t.zone === "board");

  function freeBoard() {
    const onBoard = boardTiles();
    return onBoard.filter(
      (a) => !onBoard.some(
        (b) => b.layer > a.layer && Math.abs(b.x - a.x) < TILE_U && Math.abs(b.y - a.y) < TILE_U
      )
    );
  }

  function clickable() {
    const list = freeBoard();
    for (const st of stacks) if (st.length) list.push(st[st.length - 1]);
    for (const p of piles) if (p.length) list.push(p[0]);
    return list;
  }

  // 可见牌统计（人类视野）：散铺区全部 + 各堆顶
  function visibleCount(type) {
    let n = 0;
    for (const t of boardTiles()) if (t.type === type) n++;
    for (const st of stacks) if (st.length && st[st.length - 1].type === type) n++;
    for (const p of piles) if (p.length && p[0].type === type) n++;
    return n;
  }

  function take(t) {
    if (t.zone === "stack") stacks[t.stackId].pop();
    else if (t.zone === "pile") piles[t.pileId].shift();
    t.zone = "bar";
    bar.push(t.type);
    // 三消
    const same = bar.filter((x) => x === t.type);
    if (same.length >= 3) {
      let removed = 0;
      for (let i = bar.length - 1; i >= 0 && removed < 3; i--) {
        if (bar[i] === t.type) { bar.splice(i, 1); removed++; }
      }
      for (const x of tiles) {
        if (x.zone === "bar" && x.type === t.type && removed > 0) { x.zone = "gone"; }
      }
      return true;
    }
    return false;
  }

  const barCount = (type) => bar.filter((x) => x === type).length;

  for (let step = 0; step < 2000; step++) {
    const remain = tiles.filter((t) => t.zone !== "gone" && t.zone !== "bar").length;
    if (remain === 0 && bar.length === 0) return true; // 赢
    if (remain === 0) return false; // 场上空了但槽里有死牌

    let cand = clickable();
    if (!cand.length) return false;

    const space = BAR_SLOTS - bar.length;

    // 1. 能凑成三消的直接拿
    let pick = cand.find((t) => barCount(t.type) === 2);
    if (!pick) {
      // 2. 槽紧张时：只做安全操作，否则用道具
      const scored = cand
        .map((t) => {
          const inBar = barCount(t.type);
          const vis = visibleCount(t.type);
          let s = 0;
          if (inBar === 1) s += 50 + vis * 3;   // 凑成对
          else s += vis * 4;                     // 场上同类可见越多越好
          if (t.zone === "board") s += 3;        // 散铺优先（挖开视野）
          if (t.zone === "pile") s -= 4;         // 盲堆信息少，非必要不抽
          return { t, s };
        })
        .sort((a, b) => b.s - a.s);

      if (space <= 1) {
        // 槽只剩 1 格：只有凑对才敢拿（拿完还剩 0 格等三消不行——凑对不消还是死）
        const pair = scored.find((o) => barCount(o.t.type) === 2);
        pick = pair ? pair.t : null;
        if (!pick && !outUsed) {
          // 道具「移出」：槽头 3 张变成可点的自由牌
          outUsed = true;
          const back = bar.splice(0, 3);
          for (const ty of back) {
            const tile = tiles.find((x) => x.zone === "bar" && x.type === ty);
            if (tile) { tile.zone = "board"; tile.layer = 9999; tile.x = -10; tile.y = -10 - Math.random(); }
          }
          continue;
        }
        if (!pick && !shuffleUsed) {
          // 道具「洗牌」：重洗所有剩余牌的图案
          shuffleUsed = true;
          const rem = tiles.filter((t) => t.zone === "board" || t.zone === "stack" || t.zone === "pile");
          const typesArr = shuffle(rem.map((t) => t.type));
          rem.forEach((t, i) => (t.type = typesArr[i]));
          continue;
        }
        if (!pick) return false; // 没救了
      } else if (space === 2) {
        // 剩 2 格：优先凑对；否则拿场上可见同类最多的
        pick = scored[0].t;
        if (barCount(pick.type) === 0 && visibleCount(pick.type) < 2 && !outUsed) {
          outUsed = true;
          const back = bar.splice(0, 3);
          for (const ty of back) {
            const tile = tiles.find((x) => x.zone === "bar" && x.type === ty);
            if (tile) { tile.zone = "board"; tile.layer = 9999; tile.x = -10; tile.y = -10 - Math.random(); }
          }
          continue;
        }
      } else {
        pick = scored[0].t;
      }
    }
    if (!pick) return false;
    take(pick);
    if (bar.length >= BAR_SLOTS) return false;
  }
  return false;
}

// ---------- 跑模拟 ----------
const N = parseInt(process.argv[3]) || 3000;
const names = process.argv[2] ? process.argv[2].split(",") : Object.keys(CONFIGS);
for (const name of names) {
  const cfg = CONFIGS[name];
  if (!cfg) continue;
  let wins = 0, totalCards = 0;
  for (let i = 0; i < N; i++) {
    const g = generate(cfg);
    totalCards = g.total;
    if (playBot(g)) wins++;
  }
  const rate = ((wins / N) * 100).toFixed(2);
  console.log(
    `${name}: ${rate}%  (${wins}/${N})  总牌数=${totalCards}  图案=${cfg.types}  暗堆=${cfg.stacks}x${cfg.stackDepth}  盲堆=2x${cfg.pileEach}  散铺=${cfg.batches}x${cfg.perBatch}`
  );
}
