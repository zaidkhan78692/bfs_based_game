/**
 * online.js
 * Online 2-player over WebRTC using PeerJS (peer-to-peer, no server of our own).
 *
 * Model: the HOST runs the entire game (same engine as offline mode) and is
 * the single source of truth. The GUEST is a thin client: it sends its clicks
 * (tile / power / arm) to the host and renders the snapshots it gets back.
 * Snapshots are filtered per player, so the guest is never sent the position
 * of an opponent it can't currently see (fog of war holds up online too).
 *
 * Requires game.js (loaded first) and the PeerJS script from index.html.
 */

const ROOM_PREFIX = "gridpursuit-";
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 — easy to read out loud
const ROOM_CODE_LEN = 5;
const JOIN_TIMEOUT_MS = 15000;

const hostNameInput = document.getElementById("host-name");
const joinNameInput = document.getElementById("join-name");
const joinCodeInput = document.getElementById("join-code");
const hostFormEl = document.getElementById("host-form");
const hostLobbyEl = document.getElementById("host-lobby");
const roomCodeEl = document.getElementById("room-code");
const hostStatusEl = document.getElementById("host-status");
const joinStatusEl = document.getElementById("join-status");
const nextRoundBtnEl = document.getElementById("next-round-btn");

// ---------- small helpers ----------

function setStatus(el, msg, kind) {
  el.textContent = msg;
  el.classList.toggle("ok", kind === "ok");
  el.classList.toggle("err", kind === "err");
}

function cleanName(raw, fallback) {
  return (raw || "").trim().slice(0, 16) || fallback;
}

function randomRoomCode() {
  let out = "";
  for (let i = 0; i < ROOM_CODE_LEN; i++) {
    out += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  }
  return out;
}

function netSend(msg) {
  if (net.conn && net.conn.open) {
    try { net.conn.send(msg); } catch (e) { /* connection closing — close handler deals with it */ }
  }
}

// Tears down the peer + connection. Safe to call any time, including when
// nothing is connected. Clears net.role first so late close events are ignored.
function leaveOnline() {
  const { conn, peer } = net;
  net.role = null;
  net.conn = null;
  net.peer = null;
  net.started = false;
  net.finished = false;
  try { if (conn) conn.close(); } catch (e) {}
  try { if (peer) peer.destroy(); } catch (e) {}
}

function libraryMissing(statusEl) {
  if (typeof Peer !== "undefined") return false;
  setStatus(statusEl, "Couldn't load the networking library. Check your internet connection and reload the page.", "err");
  return true;
}

// ---------- menu wiring ----------

document.getElementById("online-host-btn").addEventListener("click", () => {
  hostFormEl.hidden = false;
  hostLobbyEl.hidden = true;
  setStatus(hostStatusEl, "", null);
  showScreen("onlineHost");
});

document.getElementById("online-join-btn").addEventListener("click", () => {
  setStatus(joinStatusEl, "Enter your name and the host's room code.", null);
  showScreen("onlineJoin");
});

document.getElementById("online-back-btn").addEventListener("click", backToMenu);
document.getElementById("host-back-btn").addEventListener("click", () => { leaveOnline(); showScreen("onlineMenu"); });
document.getElementById("host-cancel-btn").addEventListener("click", () => { leaveOnline(); showScreen("onlineMenu"); });
document.getElementById("join-back-btn").addEventListener("click", () => { leaveOnline(); showScreen("onlineMenu"); });

document.getElementById("host-role-btn").addEventListener("click", (e) => {
  net.hostIsPolice = !net.hostIsPolice;
  e.target.textContent = net.hostIsPolice
    ? "⇄ You = Police · Opponent = Thief"
    : "⇄ You = Thief · Opponent = Police";
});

document.getElementById("host-create-btn").addEventListener("click", hostCreateRoom);
document.getElementById("join-go-btn").addEventListener("click", joinRoom);

document.getElementById("copy-code-btn").addEventListener("click", (e) => {
  const code = roomCodeEl.textContent;
  if (navigator.clipboard) navigator.clipboard.writeText(code).catch(() => {});
  e.target.textContent = "Copied ✓";
  setTimeout(() => { e.target.textContent = "Copy code"; }, 1500);
});

joinCodeInput.addEventListener("input", () => {
  joinCodeInput.value = joinCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

// ---------- HOST ----------

function hostCreateRoom() {
  if (libraryMissing(hostStatusEl)) return;
  leaveOnline();
  net.role = "host";
  net.name = cleanName(hostNameInput.value, "Host");
  net.avatar = hostAvatarPicker.get();
  createHostPeer(0);
}

function createHostPeer(attempt) {
  const code = randomRoomCode();
  const peer = new Peer(ROOM_PREFIX + code);
  net.peer = peer;

  peer.on("open", () => {
    if (net.peer !== peer) return;
    roomCodeEl.textContent = code;
    hostFormEl.hidden = true;
    hostLobbyEl.hidden = false;
    setStatus(hostStatusEl, "Waiting for your opponent to join…", null);
  });

  peer.on("error", (err) => {
    if (net.peer !== peer) return;
    if (err.type === "unavailable-id" && attempt < 5) {
      // Someone else happens to have that code right now — roll a new one.
      net.peer = null;
      try { peer.destroy(); } catch (e) {}
      return createHostPeer(attempt + 1);
    }
    setStatus(hostStatusEl, `Couldn't create the room (${err.type || "network error"}). Check your connection and try again.`, "err");
    hostFormEl.hidden = false;
    hostLobbyEl.hidden = true;
  });

  peer.on("connection", (conn) => {
    if (net.peer !== peer) return;
    if (net.conn) {
      // Room already has an opponent — politely turn this one away.
      conn.on("open", () => { conn.send({ t: "full" }); setTimeout(() => conn.close(), 300); });
      return;
    }
    net.conn = conn;
    wireConnection(conn);
  });
}

function guestRole() {
  return state.myRole === "police" ? "thief" : "police";
}

// Host starts (or continues with) round 1 or 2. Roles swap for round 2.
function startOnlineRound(round) {
  const hostIsPolice = round === 1 ? net.hostIsPolice : !net.hostIsPolice;
  const policeName = hostIsPolice ? net.name : net.oppName;
  const thiefName = hostIsPolice ? net.oppName : net.name;
  const policeAvatar = hostIsPolice ? net.avatar : net.oppAvatar;
  const thiefAvatar = hostIsPolice ? net.oppAvatar : net.avatar;
  // The host's own *final* name for this round, post name-collision dedup —
  // used (not net.name) when comparing the match result for stats, since
  // net.name alone wouldn't reflect a trailing " (2)" added below.
  net.myName = hostIsPolice ? policeName : thiefName;
  // Tell the guest first so it has a board ready before the first snapshot.
  netSend({ t: "roundStart", round, policeName, thiefName, policeAvatar, thiefAvatar, myRole: hostIsPolice ? "thief" : "police" });
  showScreen("game");
  startGame({ mode: "online", round, policeName, thiefName, policeAvatar, thiefAvatar, myRole: hostIsPolice ? "police" : "thief" });
}

// Builds what the guest is allowed to know. An out-of-sight opponent is null.
function buildSnapshot(forRole) {
  const s = state;
  const forPolice = forRole === "police";
  const dist = sightDistance(s.police, s.thief);
  const canSeeOpponent = dist <= (forPolice ? POLICE_VISION : THIEF_VISION);
  return {
    turn: s.turn,
    secondsLeft: s.secondsLeft,
    turnSecondsLeft: s.turnSecondsLeft,
    over: s.over,
    locked: s.locked,
    timerPaused: s.timerPaused,
    pendingAction: s.turn === forRole ? s.pendingAction : null,
    cd: s.cd,
    itemPauseLabel: s.itemPauseLabel,
    itemPauseSecondsLeft: s.itemPauseSecondsLeft,
    indicatorReading: forPolice ? s.indicatorReading : null,
    police: forPolice || canSeeOpponent ? s.police : null,
    thief: !forPolice || canSeeOpponent ? s.thief : null,
    distance: dist,
    log: s.log,
  };
}

// Called from render() and every clock tick (see game.js). Only the host sends.
function sendSnapshot() {
  if (!isHost() || !state || state.mode !== "online") return;
  if (!net.conn || !net.conn.open) return;
  netSend({ t: "snap", s: buildSnapshot(guestRole()) });
}

function hostHandle(msg) {
  switch (msg.t) {
    case "hello":
      if (net.started) return;
      net.started = true;
      net.oppName = cleanName(msg.name, "Player 2");
      if (net.oppName.toLowerCase() === net.name.toLowerCase()) net.oppName += " (2)";
      net.oppAvatar = Number.isInteger(msg.avatar) ? msg.avatar : 0;
      offlineMatch = { history: [] }; // same two-round bookkeeping as offline mode
      startOnlineRound(1);
      break;
    case "tile":
      if (state && state.mode === "online" && Number.isInteger(msg.x) && Number.isInteger(msg.y)) {
        actTile(guestRole(), msg.x, msg.y);
      }
      break;
    case "power":
      if (state && state.mode === "online") actPower(guestRole(), msg.kind);
      break;
    case "arm":
      if (state && state.mode === "online") actArm(guestRole(), msg.kind);
      break;
  }
}

// ---------- GUEST ----------

function joinRoom() {
  if (libraryMissing(joinStatusEl)) return;
  const code = joinCodeInput.value.trim().toUpperCase();
  if (code.length !== ROOM_CODE_LEN) {
    return setStatus(joinStatusEl, `Room codes are ${ROOM_CODE_LEN} characters.`, "err");
  }
  leaveOnline();
  net.role = "guest";
  net.name = cleanName(joinNameInput.value, "Guest");
  net.avatar = joinAvatarPicker.get();
  setStatus(joinStatusEl, "Connecting…", null);

  const peer = new Peer();
  net.peer = peer;
  let done = false;
  const fail = (msg) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    leaveOnline();
    setStatus(joinStatusEl, msg, "err");
  };
  const timer = setTimeout(() => fail("Couldn't reach that room. Check the code and try again."), JOIN_TIMEOUT_MS);

  peer.on("error", (err) => {
    if (net.peer !== peer) return;
    fail(err.type === "peer-unavailable"
      ? "Room not found. Check the code with your host."
      : `Connection problem (${err.type || "network error"}). Try again.`);
  });

  peer.on("open", () => {
    if (net.peer !== peer) return;
    const conn = peer.connect(ROOM_PREFIX + code, { reliable: true, serialization: "json" });
    net.conn = conn;
    conn.on("open", () => {
      done = true;
      clearTimeout(timer);
      conn.send({ t: "hello", name: net.name, avatar: net.avatar });
      setStatus(joinStatusEl, "Connected — waiting for the host to start…", "ok");
    });
    wireConnection(conn);
  });
}

function setupGuestRound(m) {
  showScreen("game");
  resetClockDisplay();
  resetSoundBaseline();
  net.myName = m.myRole === "police" ? m.policeName : m.thiefName;
  state = {
    mode: "online",
    myRole: m.myRole,
    round: m.round,
    policeName: m.policeName,
    thiefName: m.thiefName,
    police: null,
    thief: null,
    policeAvatar: m.policeAvatar,
    thiefAvatar: m.thiefAvatar,
    turn: "thief",
    secondsLeft: MATCH_SECONDS,
    turnSecondsLeft: TURN_SECONDS,
    over: false,
    locked: false,
    timerPaused: false,
    pendingAction: null,
    cd: { stopper: 0, teleport: 0, indicator: 0, jump: 0 },
    usedThisTurn: null,
    itemPauseLabel: null,
    itemPauseSecondsLeft: null,
    passSecondsLeft: null,
    indicatorReading: null,
    distance: null,
    log: "",
  };
  applyRoundLabels();
  buildBoard();
  render();
  logMessage(`Round ${m.round}: ${m.policeName} hunts, ${m.thiefName} hides.`);
}

function applySnapshot(snap) {
  if (!state || state.mode !== "online" || !isGuest()) return;
  Object.assign(state, snap);
  if (snap.log) logEl.textContent = snap.log;
  updateClock();
  render();
}

function guestHandle(msg) {
  switch (msg.t) {
    case "full":
      leaveOnline();
      setStatus(joinStatusEl, "That room already has two players.", "err");
      break;
    case "roundStart":
      setupGuestRound(msg);
      break;
    case "snap":
      applySnapshot(msg.s);
      break;
    case "roundEnd":
      showScreen("roundResult");
      document.getElementById("round-result-title").textContent = `Round ${msg.round} complete`;
      document.getElementById("round-result-desc").textContent = `${msg.text} Waiting for the host to start round 2…`;
      nextRoundBtnEl.hidden = true; // only the host starts round 2
      break;
    case "final":
      offlineMatch = { history: msg.history };
      net.finished = true;
      showFinalOfflineResult();
      break;
  }
}

// ---------- shared connection plumbing ----------

function wireConnection(conn) {
  conn.on("data", (msg) => {
    if (net.conn !== conn || !msg || typeof msg !== "object") return;
    if (isHost()) hostHandle(msg);
    else if (isGuest()) guestHandle(msg);
  });
  conn.on("close", () => onConnectionGone(conn));
  conn.on("error", () => onConnectionGone(conn));
}

function onConnectionGone(conn) {
  if (net.conn !== conn || !net.role) return; // stale, or we left on purpose

  // Host still in the lobby: just keep the room open for someone else.
  if (isHost() && !net.started) {
    net.conn = null;
    setStatus(hostStatusEl, "Your opponent left. Still waiting…", null);
    return;
  }

  const finished = net.finished; // final result is already on screen — leave it be
  leaveOnline();
  if (!finished) {
    showScreen("menu");
    resetClockDisplay();
    showMenuNotice("Your opponent disconnected, so the match was ended.");
  }
}
