const BOARD_SIZE = 16;
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
let stepsLeft = 2;
let isHiddenScreen = false;

function initGame() {
    generateBoard();
    spawnPlayers();
    updateUI();
    renderBoard();
}

function generateBoard() {
    boardMatrix = [];
    boardElement.innerHTML = ''; 

    for (let r = 0; r < BOARD_SIZE; r++) {
        let row = [];
        for (let c = 0; c < BOARD_SIZE; c++) {
            const isWall = Math.random() < 0.25 ? 1 : 0;
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

// Math helper to calculate grid distance (Manhattan Distance)
function getDistance(pos1, pos2) {
    return Math.abs(pos1.r - pos2.r) + Math.abs(pos1.c - pos2.c);
}

// ---------------------------------------------------------
// NEW VISIBILITY & RENDERING LOGIC
// ---------------------------------------------------------
function renderBoard() {
    // 1. Wipe the board clean of players
    document.querySelectorAll('.cell').forEach(cell => {
        cell.classList.remove('police', 'thief');
    });

    if (isHiddenScreen) return; // Don't draw anyone on the transition screen

    // 2. Draw based on whose turn it is (Fog of War)
    if (currentPlayer === 'police') {
        // Police can NEVER see the Thief (until powerups are added)
        document.getElementById(`cell-${policePos.r}-${policePos.c}`).classList.add('police');
    } 
    else if (currentPlayer === 'thief') {
        // Thief can always see themselves
        document.getElementById(`cell-${thiefPos.r}-${thiefPos.c}`).classList.add('thief');
        
        // Thief can ONLY see Police if within 5 grid steps
        if (getDistance(policePos, thiefPos) <= 5) {
            document.getElementById(`cell-${policePos.r}-${policePos.c}`).classList.add('police');
        }
    }
}

function updateUI() {
    turnIndicator.innerText = `${currentPlayer.charAt(0).toUpperCase() + currentPlayer.slice(1)}'s Turn`;
    actionPointsText.innerText = `Steps remaining: ${stepsLeft}`;
}

// ---------------------------------------------------------
// NEW MOVEMENT & CLICK LOGIC
// ---------------------------------------------------------
boardElement.addEventListener('click', (e) => {
    // Ignore clicks if transition screen is active or out of steps
    if (isHiddenScreen || stepsLeft <= 0) return;
    
    const clickedCell = e.target.closest('.cell');
    if (!clickedCell) return;

    // Extract row and col from the clicked cell's ID (e.g., "cell-4-5")
    const [_, r, c] = clickedCell.id.split('-');
    const targetR = parseInt(r);
    const targetC = parseInt(c);

    // Stop if they clicked a wall
    if (boardMatrix[targetR][targetC] === 1) return;

    const activePos = currentPlayer === 'police' ? policePos : thiefPos;

    // Ensure they only clicked exactly 1 block away (up, down, left, or right)
    if (getDistance(activePos, {r: targetR, c: targetC}) === 1) {
        // Move the player
        activePos.r = targetR;
        activePos.c = targetC;
        stepsLeft--;
        
        updateUI();
        renderBoard();
        checkWinCondition();
    }
});

function checkWinCondition() {
    if (policePos.r === thiefPos.r && policePos.c === thiefPos.c) {
        alert("🚨 The Police caught the Thief! 🚨");
        initGame(); // Reset the game
    }
}

// ---------------------------------------------------------
// NEW HOT-SEAT TURN SWITCHER
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
    } else {
        // Phase 2: Start next player's turn
        isHiddenScreen = false;
        currentPlayer = currentPlayer === 'police' ? 'thief' : 'police';
        stepsLeft = 2;
        
        boardElement.classList.remove('hidden');
        endTurnBtn.innerText = "End Turn / Hide Screen";
        
        updateUI();
        renderBoard();
    }
});

// Start the game!
initGame();

// ---------------------------------------------------------
// BREADTH-FIRST SEARCH ALGORITHM
// ---------------------------------------------------------
function findShortestPathBFS(start, target) {
    let queue = [start];
    
    // We use a Map to keep track of where we came from. 
    // This prevents infinite loops and lets us reconstruct the path!
    let cameFrom = new Map();
    cameFrom.set(`${start.r},${start.c}`, null);
    
    // Up, Down, Left, Right
    const directions = [
        { r: -1, c: 0 }, 
        { r: 1, c: 0 },  
        { r: 0, c: -1 }, 
        { r: 0, c: 1 }   
    ];
    
    let found = false;
    
    while (queue.length > 0) {
        let current = queue.shift(); // Get the first item in the queue
        
        // Did we find the thief?
        if (current.r === target.r && current.c === target.c) {
            found = true;
            break;
        }
        
        // Check all 4 adjacent squares
        for (let dir of directions) {
            let nextR = current.r + dir.r;
            let nextC = current.c + dir.c;
            let key = `${nextR},${nextC}`;
            
            // Ensure the next step is on the board, is not a wall (0), and hasn't been visited yet
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
    
    if (!found) return null; // Edge case: The thief is entirely boxed in by walls
    
    // Reconstruct the path by walking backward from the target to the start
    let path = [];
    let current = target;
    while (current !== null) {
        path.push(current);
        current = cameFrom.get(`${current.r},${current.c}`);
    }
    
    return path.reverse(); // Flip it so it goes Start -> Target
}

// ---------------------------------------------------------
// POWER-UP EVENT LISTENERS
// ---------------------------------------------------------
document.getElementById('power-dist').addEventListener('click', () => {
    const path = findShortestPathBFS(policePos, thiefPos);
    if (path) {
        // path.length includes the starting square, so we subtract 1
        alert(`📏 RADAR: The Thief is exactly ${path.length - 1} actual walking steps away!`);
    } else {
        alert(`📏 RADAR ERROR: The Thief is completely blocked off by walls!`);
    }
});

document.getElementById('power-ping').addEventListener('click', () => {
    const path = findShortestPathBFS(policePos, thiefPos);
    if (path) {
        // Highlight up to 3 steps of the path
        const stepsToShow = Math.min(4, path.length); 
        
        for (let i = 1; i < stepsToShow; i++) {
            const hintCell = document.getElementById(`cell-${path[i].r}-${path[i].c}`);
            hintCell.classList.add('path-hint');
            
            // Automatically erase the hint after 2 seconds
            setTimeout(() => {
                hintCell.classList.remove('path-hint');
            }, 2000);
        }
    }
});