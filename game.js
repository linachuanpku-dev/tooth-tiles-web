/* 牙了个牙 —— 牙齿主题的堆叠三消小游戏
   生成算法参考开源项目 yulegeyu（github.com/liyupi/yulegeyu，玩法逻辑自行重写）：
   - 第 2 关按攻略视频的「立」形固定堆叠（头/柱/双三角/侧列/底横盲盒）
   - 底部两摞面朝下的暗牌堆，只能盲点最上面一张
   - 洗牌 = 重洗剩余方块的图案（位置不动） */
(function () {
  "use strict";

  // ---------- 方块图案（assets/tile_<key>.png 存在则自动换图） ----------
  const TYPES = [
    { key: "tooth",  emoji: "🦷", name: "小牙齿" },
    { key: "brush",  emoji: "🪥", name: "牙刷" },
    { key: "germ",   emoji: "🦠", name: "蛀牙菌" },
    { key: "candy",  emoji: "🍬", name: "糖果" },
    { key: "paste",  emoji: "🧴", name: "牙膏" },
    { key: "milk",   emoji: "🥛", name: "牛奶" },
    { key: "apple",  emoji: "🍎", name: "苹果" },
    { key: "floss",  emoji: "🧵", name: "牙线" },
    { key: "pill",   emoji: "💊", name: "维生素" },
    { key: "bubble", emoji: "🫧", name: "漱口泡泡" },
    { key: "soap",   emoji: "🧼", name: "洗手皂" },
    { key: "carrot", emoji: "🥕", name: "胡萝卜" },
    { key: "cheese", emoji: "🧀", name: "奶酪" },
  ];
  const IMGS = {};
  for (const t of TYPES) {
    const img = new Image();
    img.onload = () => { IMGS[t.key] = img.src; };
    img.src = "assets/tile_" + t.key + ".png";
  }

  const TIPS = [
    "每天早晚刷牙，每次至少 2 分钟哦！",
    "睡前刷完牙，就不要再吃东西啦。",
    "少喝甜饮料，喝完记得用清水漱漱口。",
    "牙线可以清理牙刷够不到的牙缝。",
    "含氟牙膏能给牙齿穿上小盔甲。",
    "每半年请牙医检查一次牙齿。",
    "吃完糖漱漱口，蛀牙菌就没饭吃啦。",
    "牙齿不舒服要早点告诉爸爸妈妈和牙医。",
  ];

  const MAX_LEVEL = 2;    // 只有教学关 + 正式关，没有第三关
  const GRID = 24;        // 横向 24 个格子单位
  const TILE_U = 3;       // 方块占 3x3 单位
  const BAR_SLOTS = 7;
  const OUT_LAYER = 4000; // 「移出」到棋盘的块永远在最上层

  // ---------- 关卡配置 ----------
  function levelCfg(n) {
    if (n === 1) return { types: 5 };
    return { types: 13 };
  }

  // ---------- 音效 ----------
  let audioCtx = null, muted = false;
  function initAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  }
  function tone(freq, dur, type, vol, delay) {
    if (muted || !audioCtx) return;
    const t = audioCtx.currentTime + (delay || 0);
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type || "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start(t);
    o.stop(t + dur);
  }
  const sfx = {
    click: () => tone(700, 0.06, "sine", 0.07),
    match: () => { tone(659, 0.1, "sine", 0.09); tone(988, 0.16, "sine", 0.09, 0.08); },
    tool:  () => tone(520, 0.1, "triangle", 0.08),
    win:   () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, "sine", 0.1, i * 0.16)),
    lose:  () => [392, 330, 262].forEach((f, i) => tone(f, 0.3, "triangle", 0.09, i * 0.2)),
  };

  // ---------- DOM ----------
  const stage = document.getElementById("stage");
  const boardEl = document.getElementById("board");
  const barEl = document.getElementById("bar");
  const hudLevel = document.getElementById("hudLevel");
  const hudLeft = document.getElementById("hudLeft");
  const startScreen = document.getElementById("startScreen");
  const endScreen = document.getElementById("endScreen");
  const toolBtns = {
    undo: document.getElementById("toolUndo"),
    shuffle: document.getElementById("toolShuffle"),
    out: document.getElementById("toolOut"),
  };

  // ---------- 布局 ----------
  let UNIT = 16, tilePx = 48, boardTop = 70, barTop = 0, barLeft = 0, maxYU = 10;

  function layoutMetrics() {
    const W = stage.clientWidth, H = stage.clientHeight;
    UNIT = (W - 16) / GRID;
    tilePx = TILE_U * UNIT;
    boardTop = 64;
    barTop = H - tilePx - 88;
    const innerW = BAR_SLOTS * tilePx + (BAR_SLOTS + 1) * 4;
    barLeft = (W - innerW) / 2;
    barEl.style.top = barTop + "px";
    barEl.style.left = barLeft + "px";
    barEl.style.width = innerW + "px";
    barEl.style.height = tilePx + 8 + "px";
    // 棋盘纵向可用单位：底部预留两侧盲堆 + 单列暗堆露边
    maxYU = Math.floor((barTop - 20 - boardTop) / UNIT) - TILE_U - 1.2;
  }

  // ---------- 游戏状态 ----------
  let level = 1, tiles = [], bar = [], piles = [[], []], stacks = [], history = [], toolUses = {}, playing = false;
  let quizLearn = 0, reviveUsed = false; // 答题学知识剩余次数 / 本关是否复活过

  function loadProgress() {
    try { return parseInt(localStorage.getItem("toothTilesLevel")) || 1; } catch (e) { return 1; }
  }
  function saveProgress(n) {
    try { localStorage.setItem("toothTilesLevel", String(n)); } catch (e) {}
  }

  function shuffleArr(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* 第 2 关按视频里的立字堆叠（总牌 228 / 76 组，辅助牌 22 张）：
     头顶层层错位 → 中间 2×3 深柱 → 两座浅三角腿 → 左右四列辅助 → 底横盲盒。 */
  function genLevel(n) {
    const cfg = levelCfg(n);
    const chosen = shuffleArr(TYPES.slice()).slice(0, cfg.types);
    piles = [[], []];
    stacks = [];
    bar = [];
    history = [];
    toolUses = { undo: 1, shuffle: 1, out: 1 };
    quizLearn = 2;
    reviveUsed = false;

    if (n === 1) {
      const bag = [];
      for (const t of chosen) for (let k = 0; k < 3; k++) bag.push(t);
      shuffleArr(bag);
      tiles = bag.map((type, i) => ({ id: i, type, x: 0, y: 0, layer: 1, state: "board", pile: -1, stackId: -1, node: null }));
      const placed = [];
      for (const t of tiles) {
        let ok = false;
        for (let tries = 0; tries < 400 && !ok; tries++) {
          t.x = 2 + Math.floor(Math.random() * (GRID - TILE_U - 4));
          t.y = 1 + Math.floor(Math.random() * Math.max(3, maxYU - 4));
          ok = !placed.some((q) => Math.abs(q.x - t.x) < TILE_U && Math.abs(q.y - t.y) < TILE_U);
        }
        placed.push(t);
      }
      return;
    }

    // 13 种：11 种各 6 组 + 2 种各 5 组 = 76 组 = 228 张
    const bag = [];
    for (let i = 0; i < chosen.length; i++) {
      const groups = i < 11 ? 6 : 5;
      for (let k = 0; k < groups * 3; k++) bag.push(chosen[i]);
    }
    shuffleArr(bag);

    const S = 1.5;
    function X(sx) { return sx * S; }
    function Y(sy) { return sy * Math.max(0.55, (maxYU - TILE_U - 0.8) / 19); }

    const jobs = [];
    function addBoard(sx, sy, layer) {
      jobs.push({ kind: "board", x: X(sx), y: Y(sy), layer: layer });
    }
    function addStack(sx, sy, depth) {
      jobs.push({ kind: "stack", x: X(sx), y: Y(sy), depth: depth });
    }
    function rect(sx0, sy0, cols, rows, layer, step) {
      step = step || 2;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) addBoard(sx0 + c * step, sy0 + r * step, layer);
    }

    // 头顶：6×4 → 5×3 → 4×2 → 顶上 2×2，半格错位
    rect(3, 0, 6, 4, 1, 2);
    rect(4, 1, 5, 3, 2, 2);
    rect(5, 2, 4, 2, 3, 2);
    rect(7, 3, 2, 2, 4, 2);

    // 中间深柱 2×3
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 2; c++) addStack(6 + c * 2, 8 + r * 2, 8);

    // 两座小三角（浅层，攻略里要先挖开的那两块）
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j <= i; j++) {
        addStack(5 - i, 14 + j, 2);
        addStack(9 + i, 14 + j, 2);
      }
    }

    // 左右四列辅助牌，合计 22 张
    addStack(0.15, 1.0, 6);
    addStack(13.85, 1.0, 6);
    addStack(0.15, 8.5, 5);
    addStack(13.85, 8.5, 5);

    let need = 0;
    for (const j of jobs) need += j.kind === "board" ? 1 : j.depth;
    const pileLeft = Math.max(0, bag.length - need);
    const pileEach = Math.floor(pileLeft / 2);

    tiles = [];
    let id = 0, bi = 0;
    function take() { return bag[bi++]; }

    function mint(type, extra) {
      const t = Object.assign({
        id: id++, type: type, x: 0, y: 0, layer: 1,
        state: "board", pile: -1, stackId: -1, node: null,
      }, extra);
      tiles.push(t);
      return t;
    }

    for (const j of jobs) {
      if (j.kind === "board") {
        mint(take(), { x: j.x, y: j.y, layer: j.layer, state: "board" });
      } else {
        const st = [];
        for (let d = 0; d < j.depth; d++) {
          st.push(mint(take(), { x: j.x, y: j.y, layer: d + 1, state: "stack", stackId: stacks.length }));
        }
        stacks.push(st);
      }
    }

    piles = [[], []];
    for (let p = 0; p < 2; p++) {
      for (let i = 0; i < pileEach && bi < bag.length; i++) {
        piles[p].push(mint(take(), { state: "pile", pile: p }));
      }
    }
    while (bi < bag.length) {
      piles[0].push(mint(take(), { state: "pile", pile: 0 }));
    }
  }

  // ---------- 渲染 ----------
  function setTileFace(t) {
    if (IMGS[t.type.key]) {
      t.node.innerHTML = '<img src="' + IMGS[t.type.key] + '" alt="">';
    } else {
      t.node.innerHTML = '<span class="em" style="font-size:' + tilePx * 0.62 + 'px">' + t.type.emoji + "</span>";
    }
  }

  function buildNodes() {
    boardEl.innerHTML = "";
    for (const t of tiles) {
      const div = document.createElement("div");
      div.className = "tile";
      div.style.width = tilePx + "px";
      div.style.height = tilePx + "px";
      div.addEventListener("click", () => onPick(t));
      t.node = div;
      setTileFace(t);
      boardEl.appendChild(div);
    }
    positionAll();
  }

  function boardXY(t) {
    return { px: 8 + t.x * UNIT, py: boardTop + t.y * UNIT };
  }

  function pileXY(p, depth) {
    const y = boardTop + (maxYU + 0.35) * UNIT;
    const edge = Math.max(6, Math.round(tilePx * 0.16));
    if (p === 0) {
      const inner = 8 + tilePx * 0.55;
      return { px: inner - depth * edge, py: y };
    }
    const inner = stage.clientWidth - 8 - tilePx * 1.55;
    return { px: inner + depth * edge, py: y };
  }

  // 暗堆里每张未翻开的牌都露出一条边，条数 = 还剩几张
  function stackEdge() {
    return Math.max(7, Math.round(tilePx * 0.14));
  }

  function positionAll() {
    for (const t of tiles) {
      if (!t.node || t.state === "gone" || t.state === "bar") continue;
      if (t.state === "board") {
        const { px, py } = boardXY(t);
        t.node.style.transform = "translate(" + px + "px," + py + "px)";
        t.node.style.zIndex = 10 + t.layer;
      }
    }
    for (let p = 0; p < 2; p++) {
      piles[p].forEach((t, i) => {
        const { px, py } = pileXY(p, i);
        t.node.style.transform = "translate(" + px + "px," + py + "px)";
        t.node.style.zIndex = 900 - i;
        t.node.classList.toggle("down", i > 0); // 只有最上面一张亮出图案
        t.node.classList.toggle("blocked", false);
        t.node.style.pointerEvents = i === 0 ? "auto" : "none";
      });
    }
    // 单格暗堆：只有顶牌亮图案；下面每张都往下错开一条边，数边就能知道还剩几张
    const edge = stackEdge();
    for (const st of stacks) {
      st.forEach((t, i) => {
        const top = i === st.length - 1;
        const { px, py } = boardXY(t);
        const buried = st.length - 1 - i;
        t.node.style.transform = "translate(" + px + "px," + (py + buried * edge) + "px)";
        t.node.style.zIndex = 300 + i;
        t.node.classList.toggle("down", !top);
        t.node.classList.toggle("blocked", false);
        t.node.style.pointerEvents = top ? "auto" : "none";
      });
    }
    layoutBar(bar);
    updateBlocked();
    updateHudLeft();
  }

  function updateHudLeft() {
    hudLeft.textContent = "剩余 " + tiles.filter((t) => t.state !== "gone").length + " 块";
  }

  function layoutBar(arr) {
    arr.forEach((t, i) => {
      const px = barLeft + 4 + i * (tilePx + 4);
      const py = barTop + 4;
      t.node.classList.remove("down");
      t.node.style.pointerEvents = "auto";
      t.node.style.transform = "translate(" + px + "px," + py + "px)";
      t.node.style.zIndex = 5000 + i;
    });
  }

  function updateBlocked() {
    const onBoard = tiles.filter((t) => t.state === "board");
    for (const a of onBoard) {
      const blocked = onBoard.some(
        (b) => b.layer > a.layer && Math.abs(b.x - a.x) < TILE_U && Math.abs(b.y - a.y) < TILE_U
      );
      a.blocked = blocked;
      a.node.classList.toggle("blocked", blocked);
    }
  }

  function updateTools() {
    for (const k of Object.keys(toolBtns)) {
      toolBtns[k].querySelector(".cnt").textContent = "×" + toolUses[k];
      toolBtns[k].disabled = toolUses[k] <= 0 || !playing;
    }
    toolQuizBtn.querySelector(".cnt").textContent = "×" + quizLearn;
    toolQuizBtn.disabled = quizLearn <= 0 || !playing;
  }

  // ---------- 交互 ----------
  function onPick(t) {
    if (!playing || bar.length >= BAR_SLOTS) return;
    if (t.state === "board") {
      if (t.blocked) return;
      history.push({ id: t.id, x: t.x, y: t.y, layer: t.layer });
    } else if (t.state === "stack") {
      const st = stacks[t.stackId];
      if (st[st.length - 1] !== t) return; // 暗堆只能点最顶一张
      st.pop();
      history.push({ id: t.id, stackId: t.stackId }); // 明牌，可撤销
    } else if (t.state === "pile") {
      if (piles[t.pile][0] !== t) return; // 盲堆只能点最上面一张
      piles[t.pile].shift();
      t.pile = -1;
      // 盲点的牌不可撤销（与 yulegeyu 一致），并清空撤销历史
      history = [];
    } else {
      return;
    }
    initAudio();
    sfx.click();
    t.state = "bar";
    // 插到同图案旁边
    let idx = -1;
    for (let i = bar.length - 1; i >= 0; i--) {
      if (bar[i].type === t.type) { idx = i; break; }
    }
    if (idx >= 0) bar.splice(idx + 1, 0, t);
    else bar.push(t);

    const same = bar.filter((x) => x.type === t.type);
    if (same.length >= 3) {
      const trio = same.slice(0, 3);
      layoutBar(bar); // 先按含三连的排布飞入
      for (const x of trio) x.state = "gone";
      bar = bar.filter((x) => trio.indexOf(x) < 0);
      history = []; // 消除后不可撤销
      sfx.match();
      setTimeout(() => { for (const x of trio) x.node.classList.add("pop"); }, 340);
      setTimeout(() => {
        for (const x of trio) x.node.remove();
        layoutBar(bar);
        checkEnd();
      }, 640);
    } else {
      layoutBar(bar);
      setTimeout(checkEnd, 380);
    }
    positionAll();
  }

  function checkEnd() {
    if (!playing) return;
    if (tiles.every((t) => t.state === "gone")) {
      playing = false;
      if (level >= MAX_LEVEL) {
        showEnd("🏆", "全部通关！你是护牙小卫士！", "再从第 1 关玩一遍", () => { level = 1; startLevel(); });
        saveProgress(1);
      } else {
        saveProgress(level + 1);
        showEnd("🎉", "第 " + level + " 关完成！", "下一关 →", () => { level++; startLevel(); });
      }
      sfx.win();
      return;
    }
    if (bar.length >= BAR_SLOTS) {
      playing = false;
      showEnd("🥺", "槽满啦…再试一次！", "重新挑战", () => startLevel(), !reviveUsed);
      sfx.lose();
    }
  }

  function showEnd(emoji, title, btnText, action, canRevive) {
    document.getElementById("endEmoji").textContent = emoji;
    document.getElementById("endTitle").textContent = title;
    document.getElementById("endTip").textContent =
      "🌟 护牙小贴士：" + TIPS[Math.floor(Math.random() * TIPS.length)];
    const btn = document.getElementById("endBtn");
    btn.textContent = btnText;
    btn.onclick = () => { endScreen.classList.add("hidden"); action(); };
    document.getElementById("reviveBtn").classList.toggle("hidden", !canRevive);
    endScreen.classList.remove("hidden");
  }

  // ---------- 道具 ----------
  toolBtns.undo.addEventListener("click", () => {
    if (toolUses.undo <= 0 || !history.length) return;
    // 找最近一个还留在槽里的操作
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      const t = tiles[h.id];
      if (t.state === "bar") {
        if (h.stackId != null) {
          t.state = "stack";
          stacks[h.stackId].push(t); // 放回暗堆顶
        } else {
          t.state = "board";
          t.x = h.x; t.y = h.y; t.layer = h.layer;
        }
        bar = bar.filter((x) => x !== t);
        history.splice(i, 1);
        toolUses.undo--;
        sfx.tool();
        positionAll();
        updateTools();
        return;
      }
    }
  });

  // 洗牌：位置不动，重洗所有剩余方块（含暗堆、盲堆）的图案（yulegeyu 做法）
  toolBtns.shuffle.addEventListener("click", () => {
    if (toolUses.shuffle <= 0) return;
    const remain = tiles.filter((t) => t.state === "board" || t.state === "pile" || t.state === "stack");
    const typePool = shuffleArr(remain.map((t) => t.type));
    remain.forEach((t, i) => { t.type = typePool[i]; setTileFace(t); });
    toolUses.shuffle--;
    sfx.tool();
    positionAll();
    updateTools();
  });

  toolBtns.out.addEventListener("click", () => {
    if (toolUses.out <= 0 || !bar.length) return;
    const outTiles = bar.slice(0, 3);
    bar = bar.slice(outTiles.length);
    outTiles.forEach((t, i) => {
      t.state = "board";
      t.layer = OUT_LAYER; // 永远在最上层，不会被盖住
      t.x = 7 + i * (TILE_U + 0.5);
      t.y = maxYU + TILE_U + 1; // 底部预留行（暗牌堆之间）
    });
    toolUses.out--;
    sfx.tool();
    positionAll();
    updateTools();
  });

  // ---------- 科普视频 + 答题 ----------
  const QUIZ = [
    { q: "每天应该刷几次牙？", opts: ["早晚各刷一次", "想起来才刷", "一周刷一次"], a: 0, why: "早晚各一次，每次至少 2 分钟，牙齿才干净。" },
    { q: "每次刷牙至少要刷多久？", opts: ["10 秒", "2 分钟", "刷一下就行"], a: 1, why: "至少 2 分钟，每颗牙的每个面都要刷到。" },
    { q: "吃完糖后最好马上做什么？", opts: ["再吃一颗", "睡一觉", "用清水漱漱口"], a: 2, why: "漱口能冲走糖分，蛀牙菌就没饭吃啦。" },
    { q: "牙刷够不到的牙缝用什么清理？", opts: ["牙线", "铁签子", "不用管"], a: 0, why: "牙线是牙缝清洁小能手，尖锐的东西会伤牙龈。" },
    { q: "多久应该找牙医检查一次牙齿？", opts: ["牙疼了才去", "每半年一次", "十年一次"], a: 1, why: "每半年检查一次，小问题早发现早处理。" },
    { q: "哪种牙膏能给牙齿穿上小盔甲？", opts: ["含氟牙膏", "只要是草莓味就行", "不用牙膏"], a: 0, why: "氟能加固牙齿表面，防蛀效果最好。" },
    { q: "睡前刷完牙还能吃东西吗？", opts: ["能吃一颗糖", "喝甜牛奶没事", "不能再吃啦"], a: 2, why: "刷完牙再吃东西等于白刷，蛀牙菌会开心一整夜。" },
    { q: "乳牙掉了以后会长出什么？", opts: ["恒牙", "新的乳牙", "什么都不长"], a: 0, why: "恒牙只有一副，要用一辈子，更要好好保护。" },
    { q: "哪种饮料最容易让牙齿蛀掉？", opts: ["白开水", "甜甜的碳酸饮料", "无糖牛奶"], a: 1, why: "又甜又酸的碳酸饮料是蛀牙菌的最爱。" },
    { q: "用牙齿咬瓶盖、咬硬壳对不对？", opts: ["牙齿很硬没关系", "不对，牙齿会崩裂", "咬小的没事"], a: 1, why: "牙齿虽然硬但是脆，崩掉一块就长不回来了。" },
  ];

  const quizScreen = document.getElementById("quizScreen");
  const videoBox = document.getElementById("videoBox");
  const quizBody = document.getElementById("quizBody");
  const quizQEl = document.getElementById("quizQ");
  const quizOptsEl = document.getElementById("quizOpts");
  const quizFbEl = document.getElementById("quizFb");
  const quizNextBtn = document.getElementById("quizNextBtn");
  const toolQuizBtn = document.getElementById("toolQuiz");
  let quizWin = null, quizVideoTimer = null;

  function openQuiz(prize, onWin) {
    quizWin = onWin;
    document.getElementById("quizPrize").textContent = prize;
    quizScreen.classList.remove("hidden");
    quizBody.classList.add("hidden");
    videoBox.classList.remove("hidden");
    playQuizVideo();
  }

  // 真实科普视频放到 assets/quiz.mp4 即自动播放；没有就用占位画面
  function playQuizVideo() {
    videoBox.innerHTML = "";
    const v = document.createElement("video");
    v.src = "assets/quiz.mp4";
    v.playsInline = true;
    v.autoplay = true;
    v.addEventListener("error", quizPlaceholder);
    v.addEventListener("ended", showQuizQuestion);
    videoBox.appendChild(v);
  }

  function quizPlaceholder() {
    if (!quizBody.classList.contains("hidden")) return; // 已经在答题了
    let s = 3;
    videoBox.innerHTML =
      '<div class="videoInner"><div class="big">🎬</div>科普视频（占位）<br>认真看完，等下要答题哦～<br><b id="videoCd"></b></div>';
    const cd = document.getElementById("videoCd");
    cd.textContent = s + " 秒后出题…";
    quizVideoTimer = setInterval(() => {
      s--;
      if (s <= 0) showQuizQuestion();
      else cd.textContent = s + " 秒后出题…";
    }, 1000);
  }

  function showQuizQuestion() {
    if (quizVideoTimer) { clearInterval(quizVideoTimer); quizVideoTimer = null; }
    videoBox.classList.add("hidden");
    videoBox.innerHTML = "";
    quizBody.classList.remove("hidden");
    quizFbEl.classList.add("hidden");
    quizNextBtn.classList.add("hidden");
    const item = QUIZ[Math.floor(Math.random() * QUIZ.length)];
    quizOptsEl.dataset.a = item.a; // 自动化测试用
    quizQEl.textContent = "📝 " + item.q;
    quizOptsEl.innerHTML = "";
    item.opts.forEach((opt, i) => {
      const b = document.createElement("button");
      b.className = "quizOpt";
      b.textContent = "ABC"[i] + ". " + opt;
      b.addEventListener("click", () => answerQuiz(item, i, b));
      quizOptsEl.appendChild(b);
    });
  }

  function answerQuiz(item, i, btn) {
    const btns = quizOptsEl.querySelectorAll(".quizOpt");
    btns.forEach((b) => (b.disabled = true));
    btns[item.a].classList.add("right");
    quizFbEl.classList.remove("hidden");
    quizNextBtn.classList.remove("hidden");
    if (i === item.a) {
      sfx.match();
      quizFbEl.textContent = "✅ 答对啦！" + item.why;
      quizNextBtn.textContent = "领取奖励 🎁";
      quizNextBtn.onclick = () => { closeQuiz(); if (quizWin) quizWin(); };
    } else {
      sfx.tool();
      btn.classList.add("wrong");
      quizFbEl.textContent = "❌ 正确答案是：" + item.opts[item.a] + "。" + item.why;
      quizNextBtn.textContent = "换一题再试";
      quizNextBtn.onclick = () => showQuizQuestion();
    }
  }

  function closeQuiz() {
    if (quizVideoTimer) { clearInterval(quizVideoTimer); quizVideoTimer = null; }
    videoBox.innerHTML = "";
    quizScreen.classList.add("hidden");
  }
  document.getElementById("quizCancelBtn").addEventListener("click", closeQuiz);

  // 学知识：答题成功三种道具各 +1（每关限 2 次）
  toolQuizBtn.addEventListener("click", () => {
    if (!playing || quizLearn <= 0) return;
    initAudio();
    openQuiz("三种道具各 +1", () => {
      quizLearn--;
      toolUses.undo++;
      toolUses.shuffle++;
      toolUses.out++;
      updateTools();
      sfx.win();
    });
  });

  // 复活：槽里的方块全部退回棋盘底部，继续玩（每关限一次）
  document.getElementById("reviveBtn").addEventListener("click", () => {
    openQuiz("复活机会", () => {
      reviveUsed = true;
      endScreen.classList.add("hidden");
      playing = true;
      const back = bar.slice();
      bar = [];
      back.forEach((t, i) => {
        t.state = "board";
        t.layer = OUT_LAYER;
        t.x = 4 + i * 2.2;
        t.y = maxYU + TILE_U + 1;
      });
      history = [];
      positionAll();
      updateTools();
      sfx.win();
    });
  });

  // ---------- 流程 ----------
  function startLevel() {
    layoutMetrics();
    genLevel(level);
    buildNodes();
    playing = true;
    hudLevel.textContent = "第 " + level + " 关";
    updateTools();
    // 视口尺寸可能在首帧后才稳定（地址栏收起等），补一次布局
    setTimeout(() => { if (playing) { layoutMetrics(); positionAll(); } }, 300);
  }

  document.getElementById("muteBtn").addEventListener("click", () => {
    muted = !muted;
    document.getElementById("muteBtn").textContent = muted ? "🔇" : "🔊";
  });

  const params = new URLSearchParams(location.search);

  document.getElementById("startBtn").addEventListener("click", () => {
    initAudio();
    startScreen.classList.add("hidden");
    startLevel();
  });

  window.addEventListener("resize", () => { if (playing) { layoutMetrics(); positionAll(); } });

  // 开始界面进度提示
  level = Math.min(loadProgress(), MAX_LEVEL);
  document.getElementById("progressHint").textContent =
    level > 1 ? "第 2 关已解锁，继续加油！" : "一共两关：第 1 关教学，第 2 关正式挑战";

  // ---------- 测试参数：?level=N 直开某关；&demo=1 自动演示；?quiz=1 打开答题（quiz=q 直接出题） ----------
  if (params.get("quiz")) {
    openQuiz("复活机会", () => {});
    if (params.get("quiz") === "q") showQuizQuestion();
    const qa = params.get("qa");
    if (qa) setTimeout(() => {
      const a = parseInt(quizOptsEl.dataset.a);
      const btns = quizOptsEl.querySelectorAll(".quizOpt");
      btns[qa === "right" ? a : (a + 1) % btns.length].click();
    }, 500);
  } else if (params.get("level")) {
    level = Math.min(parseInt(params.get("level")) || 1, MAX_LEVEL);
    startScreen.classList.add("hidden");
    startLevel();
    if (params.get("fill")) {
      // 自动点 7 个不同图案填满槽触发失败（测试复活用）
      setTimeout(() => {
        const seen = {};
        const picks = [];
        for (const t of tiles) {
          if (picks.length >= 7) break;
          if (t.state === "board" && !t.blocked && !seen[t.type.key]) { seen[t.type.key] = 1; picks.push(t); }
        }
        picks.forEach((t, i) => setTimeout(() => onPick(t), i * 150));
      }, 300);
      if (params.get("revive")) {
        setTimeout(() => document.getElementById("reviveBtn").click(), 3000);
        setTimeout(() => showQuizQuestion(), 3400);
        setTimeout(() => {
          const a = parseInt(quizOptsEl.dataset.a);
          quizOptsEl.querySelectorAll(".quizOpt")[a].click();
        }, 3800);
        setTimeout(() => quizNextBtn.click(), 4200);
      }
    }
    if (params.get("demo")) {
      setTimeout(() => {
        const free = tiles.filter((t) => t.state === "board" && !t.blocked);
        const byType = {};
        for (const t of free) (byType[t.type.key] = byType[t.type.key] || []).push(t);
        const groups = Object.values(byType).filter((arr) => arr.length >= 3);
        if (!groups.length) return;
        let picks;
        if (params.get("demo") === "full") picks = groups[0].slice(0, 3);
        else picks = [groups[0][0], groups[0][1], groups[1] ? groups[1][0] : groups[0][2]];
        picks.forEach((t, i) => setTimeout(() => onPick(t), i * 250));
      }, 400);
    }
  }
})();
