/**
 * game.js
 * Police vs Thief — 10x10 grid pursuit.
 * Requires pathfinding.js to be loaded first.
 */

const POLICE_VISION = 3;   // Chebyshev radius — police only "sees" the thief this close
const THIEF_VISION = 5;    // Chebyshev radius — thief sees the police this far
const POLICE_STEPS = 2;
const POLICE_JUMP_STEPS = 4;
const THIEF_STEPS = 1;
const MATCH_SECONDS = 5 * 60;
const TURN_SECONDS = 8;    // per-turn decision clock for whichever human is acting
const RECHARGE_MOVES = 5;  // a used power comes back after its owner has made this many moves

// Which powers belong to which side.
const ROLE_POWERS = {
  police: ["indicator", "jump"],
  thief: ["stopper", "teleport"],
};

// AI toughness presets: how long it "thinks", how often it plays a random
// (sub-optimal) move instead of the BFS-best one, and how reliably it uses
// its powers at the right moment.
const DIFFICULTIES = {
  easy: { thinkMs: [1300, 2000], randomMoveChance: 0.45, powerSkill: 0.3 },
  intermediate: { thinkMs: [800, 1300], randomMoveChance: 0.12, powerSkill: 0.65 },
  hard: { thinkMs: [350, 650], randomMoveChance: 0.0, powerSkill: 1.0 },
};

// The same 5 characters work as your avatar whether you end up Police or
// Thief — picked once at setup, shown on the board token from then on.
const CHARACTERS = [
  { id: "cat", emoji: "🐱", name: "Cat" },
  { id: "fox", emoji: "🦊", name: "Fox" },
  { id: "penguin", emoji: "🐧", name: "Penguin" },
  { id: "bear", emoji: "🐻", name: "Bear" },
  { id: "panda", emoji: "🐼", name: "Panda" },
];
const AI_AVATAR = "🤖"; // the AI opponent always shows this, never a player pick

function charEmoji(index) {
  return CHARACTERS[index] ? CHARACTERS[index].emoji : "❓";
}
function dashLabel(name, avatarIndex) {
  return avatarIndex != null ? `${charEmoji(avatarIndex)} ${name}` : name;
}

let state = null;
let offlineMatch = null; // { history: [{round, policeName, thiefName, captured, elapsedSeconds}] }
let clockIntervalId = null;

// Online play state (filled in by online.js). role: "host" | "guest" | null.
// The host runs the whole game; the guest is a thin client that renders
// snapshots and sends its clicks to the host.
const net = { role: null, peer: null, conn: null, name: "", oppName: "", avatar: 0, oppAvatar: 0, hostIsPolice: true, started: false, finished: false };
function isHost() { return net.role === "host"; }
function isGuest() { return net.role === "guest"; }

// ---------- DOM refs ----------
const menuScreen = document.getElementById("menu-screen");
const aiSetupScreen = document.getElementById("ai-setup-screen");
const offlineSetupScreen = document.getElementById("offline-setup-screen");
const onlineMenuScreen = document.getElementById("online-menu-screen");
const onlineHostScreen = document.getElementById("online-host-screen");
const onlineJoinScreen = document.getElementById("online-join-screen");
const gameScreen = document.getElementById("game-screen");
const roundResultScreen = document.getElementById("round-result-screen");
const resultScreen = document.getElementById("result-screen");
const statsScreen = document.getElementById("stats-screen");

const boardEl = document.getElementById("board");
const clockEl = document.getElementById("clock");
const dashClockEl = document.getElementById("dash-clock");
const turnEl = document.getElementById("turn-indicator");
const turnTimerEl = document.getElementById("turn-timer");
const indicatorReadoutEl = document.getElementById("indicator-readout");
const logEl = document.getElementById("log");
const powerRowEl = document.getElementById("power-row");
const hintEl = document.getElementById("hint");
const roundBannerEl = document.getElementById("round-banner");
const policeItemsEl = document.getElementById("police-items");
const thiefItemsEl = document.getElementById("thief-items");
const policeLabelEl = document.getElementById("police-label");
const thiefLabelEl = document.getElementById("thief-label");
const compassDialEl = document.getElementById("compass-dial");
const compassLabelEl = document.getElementById("compass-label");

const resultTitle = document.getElementById("result-title");
const resultDesc = document.getElementById("result-desc");
const resultDetailsEl = document.getElementById("result-details");
const passOverlayEl = document.getElementById("pass-overlay");
const soundToggleBtn = document.getElementById("sound-toggle-btn");

// ---------- sound ----------

function initSoundToggle() {
  let muted = false;
  try { muted = localStorage.getItem("gridpursuit-muted") === "1"; } catch (e) {}
  Sound.setMuted(muted);
  refreshSoundToggle();
  soundToggleBtn.addEventListener("click", () => {
    Sound.setMuted(!Sound.isMuted());
    try { localStorage.setItem("gridpursuit-muted", Sound.isMuted() ? "1" : "0"); } catch (e) {}
    refreshSoundToggle();
  });
}
function refreshSoundToggle() {
  soundToggleBtn.textContent = Sound.isMuted() ? "🔇" : "🔊";
  soundToggleBtn.setAttribute("aria-label", Sound.isMuted() ? "Unmute sound" : "Mute sound");
}
initSoundToggle();

// ---------- avatar picker (shared by AI / offline / online setup screens) ----------
// Swipe left/right (or tap the arrows) through the 5 characters. Each
// instance is fully independent — every setup screen that needs one gets
// its own, wired to its own DOM id.
function initAvatarPicker(rootId, startIndex = 0) {
  const root = document.getElementById(rootId);
  const emojiEl = root.querySelector(".avatar-emoji");
  const nameEl = root.querySelector(".avatar-name");
  const dotsEl = root.querySelector(".avatar-dots");
  let index = startIndex;

  function paint() {
    const c = CHARACTERS[index];
    emojiEl.textContent = c.emoji;
    nameEl.textContent = c.name;
    dotsEl.innerHTML = CHARACTERS.map(
      (_, i) => `<span class="avatar-dot${i === index ? " active" : ""}"></span>`
    ).join("");
  }
  function step(dir) {
    index = (index + dir + CHARACTERS.length) % CHARACTERS.length;
    paint();
  }

  root.querySelectorAll(".avatar-arrow").forEach((btn) => {
    btn.addEventListener("click", () => step(Number(btn.dataset.dir)));
  });

  // Swipe (pointer drag) support, in addition to the arrow buttons.
  const display = root.querySelector(".avatar-display");
  let dragStartX = null;
  display.addEventListener("pointerdown", (e) => {
    dragStartX = e.clientX;
  });
  display.addEventListener("pointerup", (e) => {
    if (dragStartX === null) return;
    const dx = e.clientX - dragStartX;
    dragStartX = null;
    const SWIPE_THRESHOLD = 30;
    if (dx > SWIPE_THRESHOLD) step(-1);
    else if (dx < -SWIPE_THRESHOLD) step(1);
  });
  display.addEventListener("pointercancel", () => {
    dragStartX = null;
  });

  paint();
  return {
    get: () => index,
    set: (i) => {
      index = ((i % CHARACTERS.length) + CHARACTERS.length) % CHARACTERS.length;
      paint();
    },
  };
}

const aiAvatarPicker = initAvatarPicker("ai-avatar-picker", 0);
const p1AvatarPicker = initAvatarPicker("p1-avatar-picker", 0);
const p2AvatarPicker = initAvatarPicker("p2-avatar-picker", 1);
const hostAvatarPicker = initAvatarPicker("host-avatar-picker", 0);
const joinAvatarPicker = initAvatarPicker("join-avatar-picker", 1);

// Tracks the last-seen values of everything that can trigger a sound, so we
// only ever fire on a genuine change (see maybePlaySounds). Reset whenever a
// new game/round's state object is created, so its first render never diffs
// against the previous match.
let soundBaseline = null;
function resetSoundBaseline() {
  soundBaseline = null;
}

function maybePlaySounds() {
  if (!state) return;
  const cur = {
    police: state.police ? state.police.join(",") : null,
    thief: state.thief ? state.thief.join(",") : null,
    turnSecondsLeft: state.turnSecondsLeft,
    secondsLeft: state.secondsLeft,
    over: state.over,
    cd: { ...state.cd },
  };
  const base = soundBaseline;
  soundBaseline = cur;
  if (!base) return; // first render of a new game/round — nothing to diff against yet

  if (!base.over && cur.over) {
    const captured = !!(
      state.police && state.thief && state.police[0] === state.thief[0] && state.police[1] === state.thief[1]
    );
    Sound.play(captured ? "capture" : "thiefWin");
    return; // don't also fire move/item sounds for the winning instant
  }
  if (cur.over) return;

  if (cur.police !== base.police && cur.police !== null && base.police !== null) Sound.play("move");
  if (cur.thief !== base.thief && cur.thief !== null && base.thief !== null) Sound.play("move");
  if (cur.turnSecondsLeft < base.turnSecondsLeft && cur.turnSecondsLeft > 0 && cur.turnSecondsLeft <= 3) {
    Sound.play("turnTick");
  }
  if (base.secondsLeft > 30 && cur.secondsLeft <= 30) Sound.play("matchLow");
  for (const kind of ["indicator", "jump", "stopper", "teleport"]) {
    if (base.cd[kind] === 0 && cur.cd[kind] > 0) Sound.play(kind);
  }
}

// ---------- centralized screen switching ----------
// Every top-level screen toggle goes through here, always. This guarantees
// exactly one of these is ever visible at a time and that leaving the game
// screen always kills its clock — no code path can leave two screens (or a
// dangling timer) alive at once, which is what caused the clock ticking on
// the setup screen and the setup screen appearing to "leak" into a match.
const SCREENS = {
  menu: menuScreen,
  aiSetup: aiSetupScreen,
  offlineSetup: offlineSetupScreen,
  onlineMenu: onlineMenuScreen,
  onlineHost: onlineHostScreen,
  onlineJoin: onlineJoinScreen,
  game: gameScreen,
  roundResult: roundResultScreen,
  result: resultScreen,
  stats: statsScreen,
};

function showScreen(name) {
  for (const key in SCREENS) {
    SCREENS[key].hidden = key !== name;
  }
  passOverlayEl.hidden = true;
  if (name !== "game") stopClocks();
}

// Stops any running match interval and marks the current match as over.
// Called by showScreen() whenever we leave the game screen for any reason —
// this was previously called but never defined, which silently threw and
// skipped the rest of whatever function called it (menu clock resets,
// result-screen text, etc.), and left the old interval running forever.
function stopClocks() {
  if (clockIntervalId !== null) {
    clearInterval(clockIntervalId);
    clockIntervalId = null;
  }
  if (state) state.over = true;
}

// ---------- menu navigation ----------

document.querySelectorAll(".mode-card").forEach((card) => {
  card.addEventListener("click", () => {
    showMenuNotice("");
    const target = { ai: "aiSetup", offline: "offlineSetup", online: "onlineMenu" }[card.dataset.mode];
    showScreen(target);
  });
});

function backToMenu() {
  showScreen("menu");
  resetClockDisplay();
}

// One-line message shown on the main menu (e.g. "opponent disconnected").
function showMenuNotice(msg) {
  const el = document.getElementById("menu-notice");
  el.textContent = msg || "";
  el.hidden = !msg;
}

document.getElementById("ai-back-btn").addEventListener("click", backToMenu);
document.getElementById("offline-back-btn").addEventListener("click", backToMenu);

// ---- AI setup screen ----

let chosenRole = null;
let chosenDifficulty = null;

document.querySelectorAll(".role-card").forEach((card) => {
  card.addEventListener("click", () => {
    document.querySelectorAll(".role-card").forEach((c) => c.classList.remove("selected"));
    card.classList.add("selected");
    chosenRole = card.dataset.role;
    updateAiStartEnabled();
  });
});

document.querySelectorAll(".diff-card").forEach((card) => {
  card.addEventListener("click", () => {
    document.querySelectorAll(".diff-card").forEach((c) => c.classList.remove("selected"));
    card.classList.add("selected");
    chosenDifficulty = card.dataset.diff;
    updateAiStartEnabled();
  });
});

function updateAiStartEnabled() {
  const ready = Boolean(chosenRole && chosenDifficulty);
  document.getElementById("ai-start-btn").disabled = !ready;
  const hint = document.getElementById("ai-setup-hint");
  if (ready) {
    hint.textContent = "Ready — hit Start Pursuit.";
    hint.classList.add("ok");
  } else {
    const missing = [];
    if (!chosenRole) missing.push("a side");
    if (!chosenDifficulty) missing.push("a difficulty");
    hint.textContent = `Pick ${missing.join(" and ")} to continue.`;
    hint.classList.remove("ok");
  }
}

document.getElementById("ai-start-btn").addEventListener("click", () => {
  const name = (document.getElementById("ai-player-name").value || "You").trim().slice(0, 16);
  showScreen("game");
  startGame({
    mode: "ai",
    playerRole: chosenRole,
    difficulty: chosenDifficulty,
    playerName: name,
    playerAvatar: aiAvatarPicker.get(),
  });
});

// ---- Offline setup screen ----

let p1IsPolice = true;

document.getElementById("swap-roles-btn").addEventListener("click", (e) => {
  p1IsPolice = !p1IsPolice;
  e.target.textContent = p1IsPolice
    ? "⇄ Player 1 = Police · Player 2 = Thief"
    : "⇄ Player 1 = Thief · Player 2 = Police";
});

let p1Avatar = 0;
let p2Avatar = 0;

document.getElementById("offline-start-btn").addEventListener("click", () => {
  const p1 = (document.getElementById("p1-name").value || "Player 1").trim().slice(0, 16);
  const p2 = (document.getElementById("p2-name").value || "Player 2").trim().slice(0, 16);
  p1Avatar = p1AvatarPicker.get();
  p2Avatar = p2AvatarPicker.get();
  offlineMatch = { history: [] };
  showScreen("game");
  startGame({
    mode: "offline",
    round: 1,
    policeName: p1IsPolice ? p1 : p2,
    thiefName: p1IsPolice ? p2 : p1,
    policeAvatar: p1IsPolice ? p1Avatar : p2Avatar,
    thiefAvatar: p1IsPolice ? p2Avatar : p1Avatar,
  });
});

document.getElementById("next-round-btn").addEventListener("click", () => {
  if (isHost()) return startOnlineRound(2);
  const last = offlineMatch.history[0];
  showScreen("game");
  // roles (and each player's own avatar) swap sides for round 2
  startGame({
    mode: "offline",
    round: 2,
    policeName: last.thiefName,
    thiefName: last.policeName,
    policeAvatar: p1IsPolice ? p2Avatar : p1Avatar,
    thiefAvatar: p1IsPolice ? p1Avatar : p2Avatar,
  });
});

document.getElementById("restart-btn").addEventListener("click", () => {
  leaveOnline();
  showMenuNotice("");
  offlineMatch = null;
  chosenRole = null;
  chosenDifficulty = null;
  document.querySelectorAll(".role-card, .diff-card").forEach((c) => c.classList.remove("selected"));
  document.getElementById("ai-start-btn").disabled = true;
  document.getElementById("p1-name").value = "";
  document.getElementById("p2-name").value = "";
  document.getElementById("ai-player-name").value = "";
  updateAiStartEnabled();
  backToMenu();
});

// ---------- game setup ----------

function randomPos() {
  return [Math.floor(Math.random() * GRID_SIZE), Math.floor(Math.random() * GRID_SIZE)];
}

function startGame(config) {
  resetClockDisplay();
  resetSoundBaseline();
  let police = randomPos();
  let thief = randomPos();
  while (sightDistance(police, thief) < 4) {
    thief = randomPos();
  }

  state = {
    mode: config.mode,
    police,
    thief,
    turn: "thief", // thief always moves first each round
    secondsLeft: MATCH_SECONDS,
    turnSecondsLeft: TURN_SECONDS,
    over: false,
    pendingAction: null, // 'jump' | 'teleport' | null
    // Power cooldowns, in the owner's own moves. 0 = ready. A used power is
    // set to RECHARGE_MOVES and ticks down as its owner makes moves.
    cd: { stopper: 0, teleport: 0, indicator: 0, jump: 0 },
    usedThisTurn: null, // power spent this turn — doesn't tick down on the turn it was used
    policeAvatar: null, // index into CHARACTERS — null only for the AI's side in AI mode
    thiefAvatar: null,
    log: "",
    distance: null, // only set on the online guest, from the host's snapshot
    extraTurn: false, // Stopper: the side that used it gets one more turn right after this one
    lastKnownThief: null, // AI memory when playing police
    indicatorReading: null, // persistent compass reading once revealed, e.g. "SE"
    locked: false, // true while a reveal or hand-off overlay is showing — input ignored
    passSecondsLeft: null, // counts down the offline hand-off blur; null when not showing
    itemPauseLabel: null, // which item is being "used" during a pause, e.g. "Jump"
    itemPauseSecondsLeft: null, // counts down the 5s item-use pause; null when not active
    timerPaused: false, // true while deciding where to Jump/Teleport — frozen, but input still allowed
  };

  if (config.mode === "ai") {
    state.playerRole = config.playerRole;
    state.aiRole = config.playerRole === "police" ? "thief" : "police";
    state.difficulty = config.difficulty;
    state.playerName = config.playerName;
    if (config.playerRole === "police") state.policeAvatar = config.playerAvatar;
    else state.thiefAvatar = config.playerAvatar;
    policeLabelEl.textContent =
      config.playerRole === "police" ? dashLabel(`${config.playerName} (you)`, config.playerAvatar) : `${AI_AVATAR} AI`;
    thiefLabelEl.textContent =
      config.playerRole === "thief" ? dashLabel(`${config.playerName} (you)`, config.playerAvatar) : `${AI_AVATAR} AI`;
    roundBannerEl.hidden = true;
  } else if (config.mode === "online") {
    state.round = config.round;
    state.policeName = config.policeName;
    state.thiefName = config.thiefName;
    state.myRole = config.myRole;
    state.policeAvatar = config.policeAvatar;
    state.thiefAvatar = config.thiefAvatar;
    applyRoundLabels();
  } else {
    state.round = config.round;
    state.policeName = config.policeName;
    state.thiefName = config.thiefName;
    state.policeAvatar = config.policeAvatar;
    state.thiefAvatar = config.thiefAvatar;
    policeLabelEl.textContent = dashLabel(config.policeName, config.policeAvatar);
    thiefLabelEl.textContent = dashLabel(config.thiefName, config.thiefAvatar);
    roundBannerEl.hidden = false;
    roundBannerEl.textContent = `Round ${state.round} of 2 — ${state.policeName} (Police) vs ${state.thiefName} (Thief)`;
  }

  buildBoard();
  render();
  logMessage(
    config.mode === "ai"
      ? "The chase begins. " + (config.playerRole === "police" ? "You are the Police." : "You are the Thief.")
      : `Round ${state.round}: ${state.policeName} hunts, ${state.thiefName} hides.`
  );
  startClocks();
  // Offline: hide the just-randomized starting positions behind the hand-off
  // blur first, so the player who isn't about to move doesn't see them either.
  if (config.mode === "offline") {
    beginPassScreen();
  } else {
    runTurn();
  }
}

// ---------- board ----------

// Names on the dashboard + the round banner for online rounds (host and guest).
function applyRoundLabels() {
  const you = (role) => (state.myRole === role ? " (you)" : "");
  policeLabelEl.textContent = dashLabel(state.policeName + you("police"), state.policeAvatar);
  thiefLabelEl.textContent = dashLabel(state.thiefName + you("thief"), state.thiefAvatar);
  roundBannerEl.hidden = false;
  roundBannerEl.textContent = `Round ${state.round} of 2 — ${state.policeName} (Police) vs ${state.thiefName} (Thief)`;
}

function buildBoard() {
  boardEl.innerHTML = "";
  boardEl.style.gridTemplateColumns = `repeat(${GRID_SIZE}, 1fr)`;
  boardEl.style.gridTemplateRows = `repeat(${GRID_SIZE}, 1fr)`;
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.dataset.x = x;
      tile.dataset.y = y;
      tile.addEventListener("click", () => onTileClick(x, y));
      boardEl.appendChild(tile);
    }
  }
}

function tileEl(x, y) {
  return boardEl.children[y * GRID_SIZE + x];
}

// Whose eyes we're rendering the board through. In AI mode that's always the
// human's fixed side; in offline hot-seat mode it's whoever's turn it is.
function perspective() {
  if (state.mode === "ai") return state.playerRole;
  if (state.mode === "online") return state.myRole;
  return state.turn;
}

function isHumanTurn() {
  if (state.over) return false;
  if (state.mode === "offline") return true;
  if (state.mode === "online") return state.turn === state.myRole;
  return state.turn === state.playerRole;
}

// Which side a click on *this* device acts for.
function localRole() {
  if (state.mode === "ai") return state.playerRole;
  if (state.mode === "online") return state.myRole;
  return state.turn;
}

function powerReady(kind) { return state.cd[kind] === 0; }

function startCooldown(kind) {
  state.cd[kind] = RECHARGE_MOVES;
  state.usedThisTurn = kind;
}

// Called as a side finishes a turn: its used powers recharge one move closer.
function tickCooldowns(role) {
  for (const kind of ROLE_POWERS[role]) {
    if (state.cd[kind] > 0 && kind !== state.usedThisTurn) state.cd[kind]--;
  }
  state.usedThisTurn = null;
}

function render() {
  maybePlaySounds();
  for (const t of boardEl.children) {
    t.className = "tile";
    t.innerHTML = "";
  }

  const iAmPolice = perspective() === "police";
  // On the online guest the host already hides an out-of-sight opponent
  // (position = null), so a null position simply isn't drawn.
  const drawPolice = !!state.police && (iAmPolice || !state.thief || sightDistance(state.thief, state.police) <= THIEF_VISION);
  const drawThief = !!state.thief && (!iAmPolice || !state.police || sightDistance(state.police, state.thief) <= POLICE_VISION);

  const visionRadius = iAmPolice ? POLICE_VISION : THIEF_VISION;
  const selfPos = iAmPolice ? state.police : state.thief;
  // selfPos is null only on the online guest in the instant before the host's
  // first snapshot arrives — nothing to draw yet.
  for (let y = 0; selfPos && y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (sightDistance(selfPos, [x, y]) <= visionRadius) {
        tileEl(x, y).style.setProperty("--range-overlay", "rgba(255,255,255,0.02)");
      }
    }
  }

  if (isHumanTurn() && selfPos) {
    for (const [x, y] of currentReachableTiles()) {
      tileEl(x, y).classList.add("in-range");
    }
  }

  if (drawPolice) {
    const [px, py] = state.police;
    tileEl(px, py).innerHTML = `<div class="token police">${policeTokenGlyph()}</div>`;
  }
  if (drawThief) {
    const [tx, ty] = state.thief;
    tileEl(tx, ty).innerHTML = `<div class="token thief">${thiefTokenGlyph()}</div>`;
  }

  renderHud();
  renderDash();
  if (typeof sendSnapshot === "function") sendSnapshot(); // online host -> guest
}

// The AI opponent always shows the robot glyph; a human side shows whichever
// character was picked for it at setup (falls back to "P"/"T" if somehow unset).
function policeTokenGlyph() {
  if (state.mode === "ai" && state.aiRole === "police") return AI_AVATAR;
  return state.policeAvatar != null ? charEmoji(state.policeAvatar) : "P";
}
function thiefTokenGlyph() {
  if (state.mode === "ai" && state.aiRole === "thief") return AI_AVATAR;
  return state.thiefAvatar != null ? charEmoji(state.thiefAvatar) : "T";
}

function currentReachableTiles() {
  if (state.turn === "police") {
    const steps = state.pendingAction === "jump" ? POLICE_JUMP_STEPS : POLICE_STEPS;
    return reachableWithin(state.police, steps).filter(
      (p) => !(p[0] === state.police[0] && p[1] === state.police[1])
    );
  }
  if (state.pendingAction === "teleport") {
    const out = [];
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        if (sightDistance(state.thief, [x, y]) >= 4) out.push([x, y]);
      }
    }
    return out;
  }
  return reachableWithin(state.thief, THIEF_STEPS).filter(
    (p) => !(p[0] === state.thief[0] && p[1] === state.thief[1])
  );
}

// ---------- HUD ----------

function activeName() {
  if (state.mode === "ai") return state.turn === state.playerRole ? state.playerName || "You" : "AI";
  return state.turn === "police" ? state.policeName : state.thiefName;
}

function renderHud() {
  const human = isHumanTurn();

  if (state.over) {
    turnEl.textContent = "Match over";
  } else if (state.passSecondsLeft !== null) {
    turnEl.textContent = "🔒 Passing the device…";
  } else if (state.itemPauseSecondsLeft !== null) {
    turnEl.textContent = `⏸ Using ${state.itemPauseLabel}…`;
  } else if (state.timerPaused) {
    turnEl.textContent = "⏸ Choosing a tile…";
  } else if (state.mode === "offline") {
    turnEl.textContent = `${activeName()}'s turn`;
  } else if (state.mode === "online") {
    const oppName = state.myRole === "police" ? state.thiefName : state.policeName;
    turnEl.textContent = human ? "Your move" : `${oppName} is moving…`;
  } else {
    turnEl.textContent = human ? "Your move" : "Opponent is moving…";
  }
  turnEl.className = "turn-indicator " + (state.turn === "police" ? "police-turn" : "thief-turn");

  if (state.itemPauseSecondsLeft !== null) {
    turnTimerEl.hidden = false;
    turnTimerEl.textContent = `⏸ Timer frozen — ${state.itemPauseSecondsLeft}s`;
    turnTimerEl.classList.remove("low");
  } else if (state.timerPaused) {
    turnTimerEl.hidden = false;
    turnTimerEl.textContent = "⏸ Timer frozen — take your time";
    turnTimerEl.classList.remove("low");
  } else if (!state.over && (human || state.mode === "online") && !state.locked) {
    updateTurnTimerEl();
  } else {
    turnTimerEl.hidden = true;
  }

  // The Indicator reading is the Police's private intel in online play.
  const seesReading = state.mode !== "online" || state.myRole === "police";
  if (state.indicatorReading && seesReading) {
    indicatorReadoutEl.hidden = false;
    indicatorReadoutEl.textContent = `🧭 Last reading: thief is roughly ${state.indicatorReading}`;
  } else {
    indicatorReadoutEl.hidden = true;
  }

  powerRowEl.innerHTML = "";
  if (state.passSecondsLeft !== null) {
    hintEl.textContent = "Board hidden — passing the device.";
    return;
  }
  if (state.locked) {
    hintEl.textContent = state.itemPauseLabel
      ? `${state.itemPauseLabel} in effect — timer frozen.`
      : "Locking onto a direction…";
    return;
  }
  if (!human || state.over) {
    hintEl.textContent = state.over ? "Match finished." : "Waiting…";
    return;
  }

  if (state.turn === "police") {
    addPowerButton("Indicator", "Reveal the thief's general direction (no distance). Recharges in 5 moves.", "indicator", () => usePower("indicator"));
    addPowerButton("Jump", "Move up to 4 tiles this turn instead of 2. Recharges in 5 moves.", "jump", () => armAction("jump"));
    hintEl.textContent = state.pendingAction === "jump"
      ? "Jump armed, timer frozen — click a highlighted tile up to 4 away."
      : "Click a highlighted tile to move up to 2 tiles.";
  } else {
    addPowerButton("Stopper", "Take your turn twice in a row. Recharges in 5 moves.", "stopper", () => usePower("stopper"));
    addPowerButton("Teleport", "Jump to a far tile on the board. Recharges in 5 moves.", "teleport", () => armAction("teleport"));
    hintEl.textContent = state.pendingAction === "teleport"
      ? "Teleport armed, timer frozen — click any far highlighted tile."
      : "Click a highlighted tile to move 1 tile.";
  }
}

// Shows the turn clock. In online play it also runs during the opponent's turn.
function updateTurnTimerEl() {
  const mine = state.mode !== "online" || isHumanTurn();
  turnTimerEl.hidden = false;
  turnTimerEl.textContent = mine
    ? `⏱ ${state.turnSecondsLeft}s to act`
    : `⏱ Opponent has ${state.turnSecondsLeft}s`;
  turnTimerEl.classList.toggle("low", mine && state.turnSecondsLeft <= 3);
}

function movesLabel(n) { return n === 1 ? "1 move" : `${n} moves`; }

function addPowerButton(name, desc, kind, onClick) {
  const cooling = state.cd[kind] > 0;
  const btn = document.createElement("button");
  btn.className = "power-btn";
  btn.disabled = cooling;
  btn.innerHTML = `<strong>${name}${cooling ? ` — recharging (${movesLabel(state.cd[kind])})` : ""}</strong><span>${desc}</span>`;
  btn.addEventListener("click", onClick);
  powerRowEl.appendChild(btn);
}

function armAction(kind) {
  if (isGuest()) {
    if (!isHumanTurn() || state.locked) return;
    return netSend({ t: "arm", kind });
  }
  actArm(localRole(), kind);
}

function actArm(role, kind) {
  if (state.over || state.locked || state.turn !== role) return;
  if (!ROLE_POWERS[role].includes(kind) || kind === "indicator" || kind === "stopper") return;
  if (!powerReady(kind)) return;
  const arming = state.pendingAction !== kind;
  state.pendingAction = arming ? kind : null;
  // Jump/Teleport need thinking time to pick a destination — freeze the
  // clock the moment the power is armed, not after a tile is chosen.
  state.timerPaused = arming;
  render();
}

// ---------- left dashboard ----------

const POLICE_ITEM_DEFS = [
  { key: "indicator", name: "Indicator" },
  { key: "jump", name: "Jump" },
];
const THIEF_ITEM_DEFS = [
  { key: "stopper", name: "Stopper" },
  { key: "teleport", name: "Teleport" },
];

function renderItemList(el, defs) {
  el.innerHTML = "";
  for (const item of defs) {
    const left = state.cd[item.key];
    const li = document.createElement("li");
    li.innerHTML = `<span>${item.name}</span><span class="tag ${left ? "spent" : "ready"}">${left ? `recharging · ${left}` : "ready"}</span>`;
    el.appendChild(li);
  }
}

function proximityTier(distance) {
  if (distance > 7) return { label: "Far", cls: "tier-far" };       // 8+ tiles
  if (distance >= 5) return { label: "Distant", cls: "tier-distant" }; // 5–7 tiles
  return { label: "Close", cls: "tier-close" };                     // under 5 tiles
}

function renderDash() {
  renderItemList(policeItemsEl, POLICE_ITEM_DEFS);
  renderItemList(thiefItemsEl, THIEF_ITEM_DEFS);

  const distance = state.distance ?? (state.police && state.thief ? sightDistance(state.police, state.thief) : null);
  if (distance === null) {
    compassLabelEl.textContent = "—";
    compassDialEl.className = "compass-dial";
    return;
  }
  const tier = proximityTier(distance);
  compassLabelEl.textContent = tier.label;
  compassDialEl.className = "compass-dial " + tier.cls;
}

// ---------- human interaction ----------

function onTileClick(x, y) {
  if (!isHumanTurn() || state.locked) return;
  if (isGuest()) {
    // Guest only forwards the click; the host validates and applies it.
    if (!currentReachableTiles().some((p) => p[0] === x && p[1] === y)) return;
    return netSend({ t: "tile", x, y });
  }
  actTile(localRole(), x, y);
}

function actTile(role, x, y) {
  if (state.over || state.locked || state.turn !== role) return;
  const legal = currentReachableTiles().some((p) => p[0] === x && p[1] === y);
  if (!legal) return;

  if (state.turn === "police") {
    if (state.pendingAction === "jump") startCooldown("jump");
    state.police = [x, y];
  } else {
    if (state.pendingAction === "teleport") startCooldown("teleport");
    state.thief = [x, y];
  }
  state.pendingAction = null;
  state.timerPaused = false; // resolved — the clock was frozen for the decision, not for what comes after

  if (checkCapture()) return;
  advanceTurn();
}

function usePower(kind) {
  if (isGuest()) {
    if (!isHumanTurn() || state.locked) return;
    return netSend({ t: "power", kind });
  }
  actPower(localRole(), kind);
}

function actPower(role, kind) {
  if (state.over || state.locked || state.turn !== role) return;
  if (!ROLE_POWERS[role].includes(kind) || !powerReady(kind)) return;

  if (kind === "indicator") {
    startCooldown("indicator");
    const dir = compassDirection(state.police, state.thief);
    state.indicatorReading = dir;
    logMessage(`Indicator locks on: the thief is roughly to the ${dir}.`);
    return beginItemPause("Indicator");
  }

  if (kind === "stopper") {
    startCooldown("stopper");
    state.extraTurn = true;
    logMessage("Stopper deployed — move again after this one!");
    render();
    return;
  }
}

function autoMoveTimeout() {
  if (state.over) return;
  state.pendingAction = null;
  const tiles = currentReachableTiles();
  const choice = tiles[Math.floor(Math.random() * tiles.length)];
  logMessage(`⏱ Time's up for ${activeName()} — auto move.`);
  if (choice) {
    if (state.turn === "police") state.police = choice;
    else state.thief = choice;
    resolveMoveAndAdvance();
  } else {
    advanceTurn();
  }
}

// ---------- turn engine ----------

function resolveMoveAndAdvance() {
  if (checkCapture()) return;
  advanceTurn();
}

function checkCapture() {
  if (state.police[0] === state.thief[0] && state.police[1] === state.thief[1]) {
    handleMatchEnd(true);
    return true;
  }
  return false;
}

function advanceTurn() {
  const actingRole = state.turn;
  tickCooldowns(actingRole); // the side that just finished gets one move closer to recharging
  // A fresh turn should never inherit a stale armed Jump/Teleport or its
  // frozen clock — e.g. if a power was armed but a different one used instead.
  state.pendingAction = null;
  state.timerPaused = false;

  let turnChanged = true;
  if (state.extraTurn) {
    // Stopper: same side goes again, one time only — nothing to hand off.
    state.extraTurn = false;
    turnChanged = false;
    logMessage(`${activeName()} moves again — Stopper!`);
  } else {
    state.turn = actingRole === "thief" ? "police" : "thief";
  }
  state.turnSecondsLeft = TURN_SECONDS;

  if (state.mode === "offline" && turnChanged && !state.over) {
    beginPassScreen();
    return;
  }

  render();
  runTurn();
}

// Offline hot-seat privacy screen: blurs the board for a few seconds between
// turns so whoever is about to hand the device over doesn't leave their
// position visible to the player picking it up next.
const PASS_SECONDS = 3;
const passNameEl = document.getElementById("pass-name");
const passCountEl = document.getElementById("pass-count");

function beginPassScreen() {
  state.locked = true;
  state.passSecondsLeft = PASS_SECONDS;
  passNameEl.textContent = activeName();
  passCountEl.textContent = state.passSecondsLeft;
  passOverlayEl.hidden = false;
  render();
}

function endPassScreen() {
  passOverlayEl.hidden = true;
  state.locked = false;
  state.passSecondsLeft = null;
  render();
  runTurn();
}

// Using any one-time item pauses the match clock and the turn clock for a
// few seconds, so its effect is clearly seen before control moves on.
const ITEM_PAUSE_SECONDS = 5;

function beginItemPause(itemName) {
  state.locked = true;
  state.itemPauseLabel = itemName;
  state.itemPauseSecondsLeft = ITEM_PAUSE_SECONDS;
  render();
}

function endItemPause() {
  state.locked = false;
  state.itemPauseLabel = null;
  state.itemPauseSecondsLeft = null;
  advanceTurn();
}

function runTurn() {
  if (state.over) return;
  render();
  if (state.mode === "ai" && state.turn === state.aiRole) {
    setTimeout(aiTakeTurn, getAiThinkDelay());
  }
}

// ---------- AI ----------

function getAiThinkDelay() {
  const diff = DIFFICULTIES[state.difficulty] || DIFFICULTIES.intermediate;
  const [lo, hi] = diff.thinkMs;
  return lo + Math.random() * (hi - lo);
}

function aiTakeTurn() {
  if (state.over) return;
  if (state.aiRole === "police") aiPoliceTurn();
  else aiThiefTurn();
}

function randomLegalMove(role) {
  const pos = role === "police" ? state.police : state.thief;
  const steps = role === "police" ? POLICE_STEPS : THIEF_STEPS;
  const options = reachableWithin(pos, steps).filter((p) => !(p[0] === pos[0] && p[1] === pos[1]));
  return options[Math.floor(Math.random() * options.length)];
}

function aiPoliceTurn() {
  const diff = DIFFICULTIES[state.difficulty] || DIFFICULTIES.intermediate;

  if (Math.random() < diff.randomMoveChance) {
    const move = randomLegalMove("police");
    if (move) state.police = move;
    return finishAiMove();
  }

  const seesThief = sightDistance(state.police, state.thief) <= POLICE_VISION;
  if (seesThief) state.lastKnownThief = [...state.thief];

  const target = state.lastKnownThief;
  const distToTarget = target ? shortestDistance(state.police, target) : Infinity;

  if (!seesThief && powerReady("indicator") && (!target || distToTarget > 5) && Math.random() < diff.powerSkill) {
    startCooldown("indicator");
    state.lastKnownThief = [...state.thief];
    logMessage("Police use Indicator to get a fix on the thief's direction.");
    return finishAiActionOnly();
  }

  const effectiveTarget = state.lastKnownThief ?? centerTile();
  const useJump = powerReady("jump")
    && shortestDistance(state.police, effectiveTarget) > POLICE_STEPS
    && Math.random() < diff.powerSkill;
  const steps = useJump ? POLICE_JUMP_STEPS : POLICE_STEPS;
  if (useJump) {
    startCooldown("jump");
    logMessage("Police use Jump to close the distance fast.");
  }

  const path = shortestPath(state.police, effectiveTarget);
  if (path) {
    const idx = Math.min(steps, path.length - 1);
    state.police = path[idx];
  }

  finishAiMove();
}

function aiThiefTurn() {
  const diff = DIFFICULTIES[state.difficulty] || DIFFICULTIES.intermediate;

  if (Math.random() < diff.randomMoveChance) {
    const move = randomLegalMove("thief");
    if (move) state.thief = move;
    return finishAiMove();
  }

  const seesPolice = sightDistance(state.thief, state.police) <= THIEF_VISION;
  const dist = seesPolice ? shortestDistance(state.thief, state.police) : Infinity;

  if (seesPolice && dist <= 2 && powerReady("teleport") && Math.random() < diff.powerSkill) {
    const far = farthestTileFrom(state.police);
    startCooldown("teleport");
    state.thief = far;
    logMessage("Thief teleports to safety!");
    return finishAiMove();
  }

  if (seesPolice && dist <= 1 && powerReady("stopper") && Math.random() < diff.powerSkill) {
    startCooldown("stopper");
    state.extraTurn = true;
    logMessage("Thief jams the police radio with Stopper — moving again!");
    return finishAiActionOnly();
  }

  const options = reachableWithin(state.thief, THIEF_STEPS).filter(
    (p) => !(p[0] === state.thief[0] && p[1] === state.thief[1])
  );
  let best = options[Math.floor(Math.random() * options.length)];
  if (seesPolice) {
    let bestScore = -1;
    for (const opt of options) {
      const score = shortestDistance(opt, state.police);
      if (score > bestScore) {
        bestScore = score;
        best = opt;
      }
    }
  }
  if (best) state.thief = best;
  finishAiMove();
}

function finishAiMove() {
  if (checkCapture()) return;
  advanceTurn();
}

function finishAiActionOnly() {
  advanceTurn();
}

function centerTile() {
  return [Math.floor(GRID_SIZE / 2), Math.floor(GRID_SIZE / 2)];
}

function farthestTileFrom(pos) {
  let best = [0, 0];
  let bestDist = -1;
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const d = sightDistance(pos, [x, y]);
      if (d > bestDist) {
        bestDist = d;
        best = [x, y];
      }
    }
  }
  return best;
}

// ---------- clocks ----------

function startClocks() {
  // Each new game/round gets its own interval — explicitly stop any
  // previous one rather than trusting it to notice `state` changed under it.
  if (clockIntervalId !== null) clearInterval(clockIntervalId);

  clockIntervalId = setInterval(tickClock, 1000);
}

function tickClock() {
  if (state.over) return clearInterval(clockIntervalId);

  // A one-time item's 5-second reveal pause takes priority and freezes
  // everything else (including the match clock) until it clears.
  if (state.itemPauseSecondsLeft !== null) {
    state.itemPauseSecondsLeft--;
    if (state.itemPauseSecondsLeft <= 0) {
      endItemPause();
    } else {
      render();
    }
    return;
  }

  // Offline hand-off blur has its own short countdown and pauses everything
  // else (match clock included) until it clears.
  if (state.passSecondsLeft !== null) {
    state.passSecondsLeft--;
    if (state.passSecondsLeft <= 0) {
      endPassScreen();
    } else {
      passCountEl.textContent = state.passSecondsLeft;
    }
    return;
  }

  // Jump/Teleport armed and awaiting a destination tile: freeze both
  // clocks entirely (no auto-timeout) while the player decides — but,
  // unlike the states above, input stays live so they can still click.
  if (state.timerPaused) {
    return;
  }

  state.secondsLeft--;
  updateClock();
  if (state.secondsLeft <= 0) {
    clearInterval(clockIntervalId);
    handleMatchEnd(false);
    return;
  }

  // Online: both players are human, so the turn clock runs on either side's turn.
  if ((isHumanTurn() || state.mode === "online") && !state.locked) {
    state.turnSecondsLeft--;
    if (state.turnSecondsLeft <= 0) {
      autoMoveTimeout();
      return; // autoMoveTimeout resolves a move and re-renders on its own
    }
  }
  // Rendering every tick (not just on moves) is what lets the turn-tick and
  // match-low sounds fire, and — since render() also broadcasts a snapshot —
  // is what keeps the online guest's clocks and sounds live every second.
  render();
}

function updateClock() {
  const m = Math.floor(state.secondsLeft / 60).toString().padStart(2, "0");
  const s = (state.secondsLeft % 60).toString().padStart(2, "0");
  clockEl.textContent = `${m}:${s}`;
  clockEl.classList.toggle("low", state.secondsLeft <= 30);
  dashClockEl.textContent = `${m}:${s}`;
  dashClockEl.classList.toggle("low", state.secondsLeft <= 30);
}

// The topbar/dash clocks only ever update from the running interval's tick,
// so without this they keep showing whatever a *previous* match last left
// them at — right up until the next match's first tick a second later.
function resetClockDisplay() {
  const text = `${Math.floor(MATCH_SECONDS / 60).toString().padStart(2, "0")}:00`;
  clockEl.textContent = text;
  clockEl.classList.remove("low");
  dashClockEl.textContent = text;
  dashClockEl.classList.remove("low");
}

// ---------- end of match / round ----------

function logMessage(msg) {
  logEl.textContent = msg;
  if (state) state.log = msg;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// captured = true if the police caught the thief; false if the clock ran out
function handleMatchEnd(captured) {
  state.over = true;
  if (clockIntervalId !== null) {
    clearInterval(clockIntervalId);
    clockIntervalId = null;
  }
  render();

  if (state.mode === "ai") {
    endGameAI(captured);
  } else {
    endRoundOffline(captured);
  }
}

function endGameAI(captured) {
  const winner = captured ? "police" : "thief";
  const playerWon = winner === state.playerRole;
  if (playerWon && typeof Stats !== "undefined") Stats.recordAiWin(state.playerRole);

  showScreen("result");
  resultDetailsEl.hidden = true;

  resultTitle.textContent = playerWon ? "You win" : "You lose";
  resultTitle.className = playerWon ? "win" : "lose";

  if (winner === "police") {
    resultDesc.textContent = playerWon
      ? "You caught the thief before time ran out."
      : "The police tracked you down and closed the distance.";
  } else {
    resultDesc.textContent = playerWon
      ? "You stayed out of reach for the full five minutes."
      : "The clock ran out and the thief got away.";
  }
}

function endRoundOffline(captured) {
  const elapsedSeconds = captured ? MATCH_SECONDS - state.secondsLeft : MATCH_SECONDS;
  offlineMatch.history.push({
    round: state.round,
    policeName: state.policeName,
    thiefName: state.thiefName,
    captured,
    elapsedSeconds,
  });

  if (state.round === 1) {
    const text = captured
      ? `${state.policeName} caught ${state.thiefName} in ${formatTime(elapsedSeconds)}. Now roles swap for round 2.`
      : `${state.policeName} couldn't catch ${state.thiefName} — time ran out. Now roles swap for round 2.`;
    showScreen("roundResult");
    document.getElementById("round-result-title").textContent = "Round 1 complete";
    document.getElementById("round-result-desc").textContent = text;
    document.getElementById("next-round-btn").hidden = false;
    if (state.mode === "online") netSend({ t: "roundEnd", round: 1, text });
  } else {
    showFinalOfflineResult();
    if (state.mode === "online") {
      net.finished = true;
      netSend({ t: "final", history: offlineMatch.history });
    }
  }
}

function showFinalOfflineResult() {
  const [r1, r2] = offlineMatch.history; // r1.policeName caught (or not) r2.thiefName-as-police...
  // r1: round1 police vs round1 thief. r2: roles swapped.
  const a = { name: r1.policeName, captured: r1.captured, time: r1.elapsedSeconds };
  const b = { name: r2.policeName, captured: r2.captured, time: r2.elapsedSeconds };

  showScreen("result");
  resultDetailsEl.hidden = false;
  resultDetailsEl.innerHTML = "";

  let winner = null; // null = draw
  if (a.captured && b.captured) {
    if (a.time < b.time) winner = a;
    else if (b.time < a.time) winner = b;
  } else if (a.captured && !b.captured) {
    winner = a;
  } else if (!a.captured && b.captured) {
    winner = b;
  }

  if (winner) {
    resultTitle.textContent = `🏆 ${winner.name} wins!`;
    resultTitle.className = "win";
    resultDesc.textContent = `${winner.name} made the faster capture as Police.`;
  } else {
    resultTitle.textContent = "It's a draw";
    resultTitle.className = "draw";
    resultDesc.textContent = "Neither of you caught the other as Police within the time limit.";
  }

  // Record one online match (win/loss/draw, from *this* device's own player)
  // exactly once, after both rounds — never per round.
  if (state.mode === "online" && typeof Stats !== "undefined") {
    const result = !winner ? "draw" : winner.name === net.myName ? "win" : "loss";
    Stats.recordOnlineMatch(result);
  }

  for (const p of [a, b]) {
    const row = document.createElement("div");
    row.className = "result-row" + (winner === p ? " winner-row" : "");
    row.innerHTML = `<span class="name">${p.name} as Police</span><span class="time">${p.captured ? formatTime(p.time) : "No capture (DNF)"}</span>`;
    resultDetailsEl.appendChild(row);
  }
}
