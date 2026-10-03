/**
 * POST /api/record-stat
 *
 * This is the only thing that's allowed to change a player's stats. It runs
 * on the server (Vercel Function), not in the browser, which is the whole
 * point: a player's own browser can be opened in devtools and told to do
 * anything, but it can't make this function do anything other than what's
 * written here.
 *
 * The request names an EVENT ("I won an AI match as Police"); this function
 * decides what that's worth. There is no field anywhere in the request for
 * a number — every action below is a hardcoded +1. A tampered request can
 * at absolute worst claim an event that didn't happen (see the note in the
 * README about this not being a referee server); it can never set a stat to
 * an arbitrary value, which is the attack this endpoint exists to close.
 *
 * Auth: the request must carry the player's real Clerk session token
 * (Authorization: Bearer <token>). We verify it here, server-side, with the
 * Clerk secret key — so the user ID this function trusts always comes from
 * Clerk's own verification, never from anything the client claims about
 * itself.
 */

const { createClerkClient, verifyToken } = require("@clerk/backend");

const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

// Every possible effect this endpoint can ever have, in one place. Adding a
// new kind of stat means adding a line here — there is deliberately no path
// that accepts a caller-supplied amount.
const ACTIONS = {
  ai_win_police: (s) => { s.ai.winsAsPolice += 1; },
  ai_win_thief: (s) => { s.ai.winsAsThief += 1; },
  online_match_win: (s) => { s.online.matches += 1; s.online.wins += 1; },
  online_match_loss: (s) => { s.online.matches += 1; s.online.losses += 1; },
  online_match_draw: (s) => { s.online.matches += 1; },
};

function emptyStats() {
  return {
    online: { matches: 0, wins: 0, losses: 0 },
    ai: { winsAsPolice: 0, winsAsThief: 0 },
  };
}

// Merge saved metadata over the blank shape so a first-time player (or a
// stats object saved before a field existed) always comes out complete.
function normalizeStats(saved) {
  const blank = emptyStats();
  saved = saved || {};
  return {
    online: { ...blank.online, ...saved.online },
    ai: { ...blank.ai, ...saved.ai },
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing session token" });

  let userId;
  try {
    const verifyOptions = { secretKey: process.env.CLERK_SECRET_KEY };
    // Restricts which site(s) a token can be used from, so a token can't be
    // lifted from elsewhere and replayed against this endpoint. Set
    // ALLOWED_ORIGIN in your Vercel project settings to your deployed URL(s),
    // comma-separated, e.g. "https://your-game.vercel.app".
    const allowed = (process.env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (allowed.length) verifyOptions.authorizedParties = allowed;

    const verified = await verifyToken(token, verifyOptions);
    userId = verified.sub;
  } catch (err) {
    return res.status(401).json({ error: "Invalid session" });
  }

  // Vercel's Node runtime parses a JSON body automatically when
  // Content-Type is application/json; this fallback just guards against a
  // body that somehow arrives as a raw string.
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (err) { body = {}; }
  }

  const apply = ACTIONS[body && body.action];
  if (!apply) {
    return res.status(400).json({ error: "Unknown action" });
  }

  // Read-modify-write: there's no atomic "+1" primitive in Clerk's metadata
  // API, so two requests from the same player landing within the same
  // instant could race and one could get overwritten. For how infrequently
  // a single player finishes two matches in the same second, that's an
  // acceptable, documented gap — not something this endpoint tries to solve.
  let user;
  try {
    user = await clerkClient.users.getUser(userId);
  } catch (err) {
    return res.status(500).json({ error: "Could not load user" });
  }

  const stats = normalizeStats(user.publicMetadata && user.publicMetadata.stats);
  apply(stats);

  try {
    const updated = await clerkClient.users.updateUserMetadata(userId, {
      publicMetadata: { stats },
    });
    return res.status(200).json({ stats: updated.publicMetadata.stats });
  } catch (err) {
    return res.status(500).json({ error: "Could not save stats" });
  }
};
