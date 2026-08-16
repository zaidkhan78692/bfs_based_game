const BOARD_SIZE = 10;
const boardElement = document.getElementById('board');
const turnIndicator = document.getElementById('turn-indicator');
const actionPointsText = document.getElementById('action-points');
const endTurnBtn = document.getElementById('end-turn-btn');

// Board and Player State
let boardMatrix = []; 
let policePos = { r: 0, c: 0 };
let thiefPos = { r: 0, c: 0 };

// Turn State
let currentPlayer = 'police'; // 'police' starts
let stepsLeft = 3; // Police starts with 3 steps
let isHiddenScreen = false;

// Teleport State
let thiefTeleportUsed = false;
let isTeleportMode = false;

function initGame() {
    generateBoard();
    spawnPlayers();
    thiefTeleportUsed = false;
    isTeleportMode = false;
    boardElement.classList.remove('teleport-active');
    updateUI();
    renderBoard();
}

function generateBoard() {
    boardMatrix = [];
    boardElement.innerHTML = ''; 

    for (let r = 0; r < BOARD_SIZE; r++) {
        let row = [];
        for (let c = 0; c < BOARD_SIZE; c++) {
            let isWall = 0;
            
            // 1. Lower the overall wall density to 18% (down from 25%)
            if (Math.random() < 0.18) {
                isWall = 1;

                if (r > 0 && c > 0) {
                    if (boardMatrix[r-1][c] === 1 && row[c-1] === 1) {
                        isWall = 0; 
                    }
                }
            }

            row.push(isWall);

            const cell = document.createElement('div');
            cell.classList.add('cell');
            cell.id = `cell-${r}-${c}`;
            if (isWall) cell.classList.add('wall');
            
            boardElement.appendChild(cell);
        }
        boardMatrix.push(row);
    }
}

function spawnPlayers() {
    policePos = getRandomEmptyCell();
    do {
        thiefPos = getRandomEmptyCell();
    } while (thiefPos.r === policePos.r && thiefPos.c === policePos.c);
}

function getRandomEmptyCell() {
    let r, c;
    do {
        r = Math.floor(Math.random() * BOARD_SIZE);
        c = Math.floor(Math.random() * BOARD_SIZE);
    } while (boardMatrix[r][c] === 1); 
    
    return { r, c };
}

function getDistance(pos1, pos2) {
    // Chebyshev Distance (calculates 8-way diagonal movement perfectly)
    return Math.max(Math.abs(pos1.r - pos2.r), Math.abs(pos1.c - pos2.c));
}

// ---------------------------------------------------------
// VISIBILITY & RENDERING LOGIC
// ---------------------------------------------------------
function renderBoard() {
    document.querySelectorAll('.cell').forEach(cell => {
        cell.classList.remove('police', 'thief');
    });

    if (isHiddenScreen) return; 

    if (currentPlayer === 'police') {
        document.getElementById(`cell-${policePos.r}-${policePos.c}`).classList.add('police');
    } 
    else if (currentPlayer === 'thief') {
        document.getElementById(`cell-${thiefPos.r}-${thiefPos.c}`).classList.add('thief');
        if (getDistance(policePos, thiefPos) <= 5) {
            document.getElementById(`cell-${policePos.r}-${policePos.c}`).classList.add('police');
        }
    }
}

function updateUI() {
    turnIndicator.innerText = `${currentPlayer.charAt(0).toUpperCase() + currentPlayer.slice(1)}'s Turn`;
    actionPointsText.innerText = `Steps remaining: ${stepsLeft}`;
    
    const powerUpsContainer = document.getElementById('power-ups');
    const policePowers = document.querySelectorAll('.police-power');
    const thiefPowers = document.querySelectorAll('.thief-power');
    const teleportBtn = document.getElementById('power-teleport');

    if (!isHiddenScreen) {
        powerUpsContainer.classList.remove('hidden');
        
        if (currentPlayer === 'police') {
            policePowers.forEach(btn => btn.style.display = 'inline-block');
            thiefPowers.forEach(btn => btn.style.display = 'none');
        } else {
            policePowers.forEach(btn => btn.style.display = 'none');
            thiefPowers.forEach(btn => btn.style.display = 'inline-block');
            
            // Handle the UI state of the Teleport button
            if (thiefTeleportUsed) {
                teleportBtn.innerText = "🌌 Teleport Used";
                teleportBtn.style.opacity = '0.5';
                teleportBtn.style.cursor = 'not-allowed';
            } else {
                teleportBtn.innerText = "🌌 Teleport (1 Use)";
                teleportBtn.style.opacity = '1';
                teleportBtn.style.cursor = 'pointer';
            }
        }
    } else {
        powerUpsContainer.classList.add('hidden');
    }
}

// ---------------------------------------------------------
// MOVEMENT & CLICK LOGIC
// ---------------------------------------------------------
// ---------------------------------------------------------
// MOVEMENT & CLICK LOGIC
// ---------------------------------------------------------
boardElement.addEventListener('click', (e) => {
    if (isHiddenScreen || stepsLeft <= 0) return;
    
    const clickedCell = e.target.closest('.cell');
    if (!clickedCell) return;

    const [_, r, c] = clickedCell.id.split('-');
    const targetR = parseInt(r);
    const targetC = parseInt(c);

    // Stop if they clicked a wall
    if (boardMatrix[targetR][targetC] === 1) return;

    const activePos = currentPlayer === 'police' ? policePos : thiefPos;
    const targetPos = { r: targetR, c: targetC };

    // 1. Execute Teleport (Ignores walls and distance)
    if (currentPlayer === 'thief' && isTeleportMode) {
        activePos.r = targetR;
        activePos.c = targetC;
        stepsLeft--; // Teleporting costs 1 step
        isTeleportMode = false;
        thiefTeleportUsed = true;
        boardElement.classList.remove('teleport-active');
        
        updateUI();
        renderBoard();
        checkWinCondition();
        return;
    }

    // 2. Execute Normal BFS Movement
    // Run the BFS algorithm to find the exact walking path
    const path = findShortestPathBFS(activePos, targetPos);
    
    // path.length includes the starting square, so we subtract 1 for the actual steps taken
    if (path) {
        const stepsRequired = path.length - 1;
        
        // If the click is valid (greater than 0 steps, and within their remaining steps)
        if (stepsRequired > 0 && stepsRequired <= stepsLeft) {
            activePos.r = targetR;
            activePos.c = targetC;
            stepsLeft -= stepsRequired; // Deduct the exact amount of steps taken
            
            updateUI();
            renderBoard();
            checkWinCondition();
        }
    }
    // If the path requires too many steps, or is entirely blocked by walls, 
    // the code does nothing, matching your requirement for no annoying pop-ups.
});

function checkWinCondition() {
    if (policePos.r === thiefPos.r && policePos.c === thiefPos.c) {
        alert("🚨 The Police caught the Thief! 🚨");
        initGame(); 
    }
}

// ---------------------------------------------------------
// HOT-SEAT TURN SWITCHER
// ---------------------------------------------------------
endTurnBtn.addEventListener('click', () => {
    if (!isHiddenScreen) {
        // Phase 1: Hide the screen
        isHiddenScreen = true;
        boardElement.classList.add('hidden');
        
        const nextPlayer = currentPlayer === 'police' ? 'Thief' : 'Police';
        endTurnBtn.innerText = `Pass device to ${nextPlayer} - Click when ready`;
        turnIndicator.innerText = "Screen Hidden";
        actionPointsText.innerText = "Swap seats without peeking!";
        
        // Cancel teleport mode if the thief forgot to use it after clicking
        isTeleportMode = false; 
        boardElement.classList.remove('teleport-active');
        
    } else {
        // Phase 2: Start next player's turn
        isHiddenScreen = false;
        currentPlayer = currentPlayer === 'police' ? 'thief' : 'police';
        
        // Set steps based on who is playing (Police gets 3, Thief gets 2)
        stepsLeft = currentPlayer === 'police' ? 3 : 2;
        
        boardElement.classList.remove('hidden');
        endTurnBtn.innerText = "End Turn / Hide Screen";
        
        updateUI();
        renderBoard();
    }
});

initGame();

// ---------------------------------------------------------
// BFS ALGORITHM & POWER-UPS
// ---------------------------------------------------------
function findShortestPathBFS(start, target) {
    let queue = [start];
    let cameFrom = new Map();
    cameFrom.set(`${start.r},${start.c}`, null);
    
    // Up, Down, Left, Right, AND all 4 Diagonals
    const directions = [
        { r: -1, c: 0 }, { r: 1, c: 0 }, { r: 0, c: -1 }, { r: 0, c: 1 },
        { r: -1, c: -1 }, { r: -1, c: 1 }, { r: 1, c: -1 }, { r: 1, c: 1 }
    ];
    
    let found = false;
    
    while (queue.length > 0) {
        let current = queue.shift(); 
        
        if (current.r === target.r && current.c === target.c) {
            found = true;
            break;
        }
        
        for (let dir of directions) {
            let nextR = current.r + dir.r;
            let nextC = current.c + dir.c;
            let key = `${nextR},${nextC}`;
            
            if (
                nextR >= 0 && nextR < BOARD_SIZE && 
                nextC >= 0 && nextC < BOARD_SIZE && 
                boardMatrix[nextR][nextC] === 0 && 
                !cameFrom.has(key)
            ) {
                queue.push({ r: nextR, c: nextC });
                cameFrom.set(key, current);
            }
        }
    }
    
    if (!found) return null; 
    
    let path = [];
    let current = target;
    while (current !== null) {
        path.push(current);
        current = cameFrom.get(`${current.r},${current.c}`);
    }
    
    return path.reverse(); 
}

document.getElementById('power-dist').addEventListener('click', () => {
    const path = findShortestPathBFS(policePos, thiefPos);
    if (path) {
        alert(`📏 RADAR: The Thief is exactly ${path.length - 1} walking steps away!`);
    } else {
        alert(`📏 RADAR ERROR: The Thief is entirely boxed in by walls!`);
    }
});

document.getElementById('power-ping').addEventListener('click', () => {
    const path = findShortestPathBFS(policePos, thiefPos);
    if (path) {
        const stepsToShow = Math.min(4, path.length); 
        
        for (let i = 1; i < stepsToShow; i++) {
            const hintCell = document.getElementById(`cell-${path[i].r}-${path[i].c}`);
            hintCell.classList.add('path-hint');
            
            setTimeout(() => {
                hintCell.classList.remove('path-hint');
            }, 2000);
        }
    }
});

document.getElementById('power-teleport').addEventListener('click', () => {
    if (thiefTeleportUsed) return;
    
    // Toggle teleport mode
    isTeleportMode = !isTeleportMode; 
    
    if (isTeleportMode) {
        boardElement.classList.add('teleport-active');
        alert("🌌 Teleport Primed! Click ANY empty square on the board to jump there. (Costs 1 step)");
    } else {
        boardElement.classList.remove('teleport-active');
    }
});