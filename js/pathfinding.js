/**
 * pathfinding.js
 *
 * Shortest-distance logic for an open grid (size set by GRID_SIZE below),
 * 4-directional movement.
 * Implemented as a plain BFS so it keeps working unchanged if the board
 * later gains walls/obstacles — swap GRID_SIZE or add a blocked-tile
 * check inside neighborsOf() and every function below still holds.
 */

const GRID_SIZE = 10;

function inBounds(x, y) {
  return x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE;
}

function neighborsOf(x, y) {
  const deltas = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const out = [];
  for (const [dx, dy] of deltas) {
    const nx = x + dx, ny = y + dy;
    if (inBounds(nx, ny)) out.push([nx, ny]);
  }
  return out;
}

/**
 * Breadth-first search from a single origin.
 * Returns { dist: Map("x,y" -> steps), prev: Map("x,y" -> "x,y") }
 */
function bfsFrom(origin) {
  const key = (x, y) => `${x},${y}`;
  const dist = new Map([[key(...origin), 0]]);
  const prev = new Map();
  const queue = [origin];
  let head = 0;

  while (head < queue.length) {
    const [cx, cy] = queue[head++];
    const d = dist.get(key(cx, cy));
    for (const [nx, ny] of neighborsOf(cx, cy)) {
      const k = key(nx, ny);
      if (!dist.has(k)) {
        dist.set(k, d + 1);
        prev.set(k, key(cx, cy));
        queue.push([nx, ny]);
      }
    }
  }
  return { dist, prev };
}

/** Shortest step-count between two tiles (BFS, not just Manhattan — obstacle-ready). */
function shortestDistance(a, b) {
  const { dist } = bfsFrom(a);
  return dist.get(`${b[0]},${b[1]}`) ?? Infinity;
}

/** Every tile reachable within `steps` moves from origin, including origin. */
function reachableWithin(origin, steps) {
  const { dist } = bfsFrom(origin);
  const out = [];
  for (const [k, d] of dist.entries()) {
    if (d <= steps) {
      const [x, y] = k.split(",").map(Number);
      out.push([x, y]);
    }
  }
  return out;
}

/** Full shortest path (array of [x,y], including both ends) from a to b. */
function shortestPath(a, b) {
  const { dist, prev } = bfsFrom(a);
  const bKey = `${b[0]},${b[1]}`;
  if (!dist.has(bKey)) return null;

  const path = [b];
  let cur = bKey;
  while (cur !== `${a[0]},${a[1]}`) {
    cur = prev.get(cur);
    const [x, y] = cur.split(",").map(Number);
    path.push([x, y]);
  }
  return path.reverse();
}

/** Chebyshev "sight" distance — used for vision radius checks, not movement. */
function sightDistance(a, b) {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

/** One step in the given direction, clamped to the board — used by fleeing/patrol AI. */
function stepToward(from, to) {
  const path = shortestPath(from, to);
  if (!path || path.length < 2) return from;
  return path[1];
}

/** Coarse 8-way compass label from `from` toward `to`, for the police Indicator power. */
function compassDirection(from, to) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (dx === 0 && dy === 0) return "HERE";
  const h = dx === 0 ? "" : dx > 0 ? "E" : "W";
  const v = dy === 0 ? "" : dy > 0 ? "S" : "N";
  return (v + h) || "HERE";
}
