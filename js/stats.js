/**
 * stats.js
 * Per-player stats, now backed by Clerk `publicMetadata` instead of
 * `unsafeMetadata`. The difference matters: `publicMetadata` is readable
 * from the browser but can only be WRITTEN by a server holding the Clerk
 * secret key — the browser can't edit it, not even through devtools. Every
 * write goes through our own server endpoint, api/record-stat.js, which is
 * the only thing allowed to touch it (see that file for why).
 *
 * This file never computes or sends a stat number. It only ever says "this
 * happened" (an action name) and displays whatever the server reports back.
 */

const Stats = (() => {
  let user = null; // the signed-in Clerk user, set by init()
  let current = null; // cached stats, as last reported by the server
  let callChain = Promise.resolve(); // serializes outgoing requests

  function emptyStats() {
    return {
      online: { matches: 0, wins: 0, losses: 0 },
      ai: { winsAsPolice: 0, winsAsThief: 0 },
    };
  }

  // Called once Clerk confirms who's signed in (see the bootstrap script at
  // the bottom of index.html), and again with null on sign-out.
  function init(signedInUser) {
    user = signedInUser;
    const saved = (user && user.publicMetadata && user.publicMetadata.stats) || {};
    const blank = emptyStats();
    current = {
      online: { ...blank.online, ...saved.online },
      ai: { ...blank.ai, ...saved.ai },
    };
    renderStatsScreen();
  }

  // Sends one event to the server and adopts whatever stats it reports back.
  // Requests are chained (not fired in parallel) so two events recorded in
  // quick succession hit the server one at a time rather than racing.
  function record(action) {
    if (!user) return;
    callChain = callChain
      .then(async () => {
        const token = await Clerk.session.getToken();
        const res = await fetch("/api/record-stat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action }),
        });
        if (!res.ok) throw new Error(`record-stat ${action}: HTTP ${res.status}`);
        const data = await res.json();
        current = data.stats;
        renderStatsScreen();
      })
      .catch((err) => {
        // The game keeps going either way — a failed stat write just means
        // this particular result doesn't get counted.
        console.error("Stats: failed to record", action, err);
      });
    return callChain;
  }

  // result: "win" | "loss" | "draw" — call once per *full* online match
  // (after round 2), never per round.
  function recordOnlineMatch(result) {
    const action =
      result === "win" ? "online_match_win" : result === "loss" ? "online_match_loss" : "online_match_draw";
    record(action);
  }

  // role: "police" | "thief" — call only on a human win against the AI.
  function recordAiWin(role) {
    record(role === "police" ? "ai_win_police" : "ai_win_thief");
  }

  function get() {
    return current;
  }
  function signedIn() {
    return !!user;
  }

  return { init, recordOnlineMatch, recordAiWin, get, signedIn };
})();

// ---------- stats screen ----------

function renderStatsScreen() {
  const el = document.getElementById("stats-screen");
  if (!el) return;
  const s = Stats.get();
  if (!Stats.signedIn() || !s) {
    el.querySelector(".stats-body").hidden = true;
    el.querySelector(".stats-empty").hidden = false;
    return;
  }
  el.querySelector(".stats-body").hidden = false;
  el.querySelector(".stats-empty").hidden = true;
  document.getElementById("stat-online-matches").textContent = s.online.matches;
  document.getElementById("stat-online-wins").textContent = s.online.wins;
  document.getElementById("stat-online-losses").textContent = s.online.losses;
  document.getElementById("stat-ai-police").textContent = s.ai.winsAsPolice;
  document.getElementById("stat-ai-thief").textContent = s.ai.winsAsThief;
}

document.getElementById("stats-btn").addEventListener("click", () => {
  renderStatsScreen();
  showScreen("stats");
});
document.getElementById("stats-back-btn").addEventListener("click", backToMenu);
