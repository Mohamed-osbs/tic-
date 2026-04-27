/**
 * script.js — Neon Tic-Tac-Toe
 * ─────────────────────────────
 * Architecture: an IIFE (Immediately Invoked Function Expression) wraps
 * everything to avoid polluting the global scope.
 *
 * Modules inside:
 *   AudioEngine  – Web Audio API sound effects (no external files needed)
 *   State        – Single source of truth for all game data
 *   DOM          – Cached element references
 *   UI           – All DOM-writing functions (renderBoard, updateStatus, …)
 *   Logic        – Pure game logic (checkWinner, minimax AI, …)
 *   Game         – Orchestrator that wires Logic + UI together
 */

(function () {
  'use strict';

  /* ================================================================
     AUDIO ENGINE
     Uses the Web Audio API to synthesize tones on the fly.
     No audio files required — pure JavaScript sound generation.
  ================================================================ */
  const AudioEngine = (() => {
    // Create AudioContext lazily (browsers require a user gesture first)
    let ctx = null;

    function getCtx() {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      return ctx;
    }

    /**
     * playTone – play a synthesised beep
     * @param {number} freq  - Frequency in Hz
     * @param {number} dur   - Duration in seconds
     * @param {string} type  - Oscillator waveform: 'sine' | 'square' | 'sawtooth'
     * @param {number} vol   - Volume 0..1
     */
    function playTone(freq, dur, type = 'sine', vol = 0.25) {
      try {
        const ac  = getCtx();
        const osc = ac.createOscillator();
        const gain = ac.createGain();

        osc.connect(gain);
        gain.connect(ac.destination);

        osc.type = type;
        osc.frequency.setValueAtTime(freq, ac.currentTime);

        // Fade out to avoid click artifacts
        gain.gain.setValueAtTime(vol, ac.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);

        osc.start(ac.currentTime);
        osc.stop(ac.currentTime + dur);
      } catch (_) {
        // Silently fail if Web Audio is unavailable
      }
    }

    return {
      click() { playTone(440, 0.07, 'square', 0.18); },
      win()   {
        // Ascending victory arpeggio
        [523, 659, 784, 1047].forEach((f, i) => {
          setTimeout(() => playTone(f, 0.18, 'sine', 0.22), i * 90);
        });
      },
      draw()  { playTone(220, 0.3, 'sawtooth', 0.15); },
    };
  })();


  /* ================================================================
     STATE
     The single source of truth. All game data lives here.
  ================================================================ */
  const State = {
    // 'X' | 'O' — whose turn it is
    currentPlayer: 'X',

    // 9-element array: null | 'X' | 'O'
    board: Array(9).fill(null),

    // 'playing' | 'won' | 'draw'
    phase: 'playing',

    // Indices of the three winning cells (null if no winner yet)
    winningCombo: null,

    // Persistent scores (survive restarts)
    scores: { X: 0, O: 0, draw: 0 },

    // 'pvp' | 'ai'
    mode: 'pvp',

    // Which symbol the human plays in AI mode
    humanPlayer: 'X',
  };


  /* ================================================================
     DOM
     Cache every element we'll touch so we never query the DOM twice.
  ================================================================ */
  const DOM = {
    board:        document.getElementById('board'),
    statusBanner: document.getElementById('status-banner'),
    statusText:   document.getElementById('status-text'),
    scoreX:       document.getElementById('score-x-val'),
    scoreO:       document.getElementById('score-o-val'),
    scoreDraw:    document.getElementById('score-draw-val'),
    scoreCardX:   document.getElementById('score-x'),
    scoreCardO:   document.getElementById('score-o'),
    btnRestart:   document.getElementById('btn-restart'),
    btnResetScore:document.getElementById('btn-reset-score'),
    btnPvP:       document.getElementById('btn-pvp'),
    btnAI:        document.getElementById('btn-ai'),
    cells: [],   // populated in UI.renderBoard()
  };


  /* ================================================================
     LOGIC
     Pure functions — no DOM side-effects, no state mutations.
     Takes data in, returns results. Easy to test in isolation.
  ================================================================ */
  const Logic = (() => {

    // All possible winning index triples on a 3×3 board
    const WIN_COMBOS = [
      [0,1,2], [3,4,5], [6,7,8], // rows
      [0,3,6], [1,4,7], [2,5,8], // columns
      [0,4,8], [2,4,6],           // diagonals
    ];

    /**
     * checkWinner
     * Scans every win combo. Returns the winning symbol and the
     * matching combo, or null if there's no winner yet.
     *
     * @param  {Array}        board  - 9-element board array
     * @returns {{ player: string, combo: number[] } | null}
     */
    function checkWinner(board) {
      for (const combo of WIN_COMBOS) {
        const [a, b, c] = combo;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
          return { player: board[a], combo };
        }
      }
      return null;
    }

    /**
     * checkDraw
     * All cells are filled AND no winner → draw.
     *
     * @param  {Array} board
     * @returns {boolean}
     */
    function checkDraw(board) {
      return board.every(cell => cell !== null);
    }

    /**
     * getAvailableMoves
     * Returns indices of empty cells.
     *
     * @param  {Array} board
     * @returns {number[]}
     */
    function getAvailableMoves(board) {
      return board.reduce((acc, v, i) => (v === null ? [...acc, i] : acc), []);
    }

    /**
     * minimax
     * Classic minimax algorithm with alpha-beta pruning.
     * The CPU always plays as 'O', the human as 'X'.
     *
     * @param {Array}   board       - Current board state
     * @param {boolean} isMaximizing - true when it's the CPU's turn
     * @param {number}  alpha        - Best score maximiser can guarantee
     * @param {number}  beta         - Best score minimiser can guarantee
     * @returns {number} Heuristic score of the position
     */
    function minimax(board, isMaximizing, alpha = -Infinity, beta = Infinity) {
      const winner = checkWinner(board);

      // Terminal states
      if (winner?.player === 'O') return  10;  // CPU wins → positive
      if (winner?.player === 'X') return -10;  // Human wins → negative
      if (checkDraw(board))       return   0;  // Draw → neutral

      const moves = getAvailableMoves(board);

      if (isMaximizing) {
        // CPU (O) wants the highest score
        let best = -Infinity;
        for (const move of moves) {
          board[move] = 'O';
          best = Math.max(best, minimax(board, false, alpha, beta));
          board[move] = null;
          alpha = Math.max(alpha, best);
          if (beta <= alpha) break; // Beta cut-off
        }
        return best;
      } else {
        // Human (X) wants the lowest score
        let best = Infinity;
        for (const move of moves) {
          board[move] = 'X';
          best = Math.min(best, minimax(board, true, alpha, beta));
          board[move] = null;
          beta = Math.min(beta, best);
          if (beta <= alpha) break; // Alpha cut-off
        }
        return best;
      }
    }

    /**
     * getBestMove
     * Wraps minimax to pick the best cell index for the CPU.
     *
     * @param  {Array} board
     * @returns {number} Best move index
     */
    function getBestMove(board) {
      const moves = getAvailableMoves(board);
      let bestScore = -Infinity;
      let bestMove  = moves[0];

      for (const move of moves) {
        board[move] = 'O';
        const score = minimax(board, false);
        board[move] = null;
        if (score > bestScore) {
          bestScore = score;
          bestMove  = move;
        }
      }
      return bestMove;
    }

    // Expose only what's needed
    return { checkWinner, checkDraw, getBestMove };
  })();


  /* ================================================================
     UI
     All DOM-writing functions live here.
     They read from State but never run game logic themselves.
  ================================================================ */
  const UI = (() => {

    /**
     * renderBoard
     * Clears the board container and re-creates 9 cell divs.
     * Attaches click listeners via the Game.handleMove callback.
     */
    function renderBoard() {
      DOM.board.innerHTML = '';
      DOM.cells = [];

      for (let i = 0; i < 9; i++) {
        const cell = document.createElement('div');
        cell.classList.add('cell');
        cell.setAttribute('role', 'gridcell');
        cell.setAttribute('data-index', i);
        cell.setAttribute('aria-label', `Cell ${i + 1}`);

        // Render existing marks (e.g. after restart isn't needed, but keeps renderBoard reusable)
        if (State.board[i]) {
          cell.classList.add(State.board[i].toLowerCase());
          cell.innerHTML = `<span class="mark">${State.board[i]}</span>`;
          cell.classList.add('taken', 'disabled');
        }

        cell.addEventListener('click', () => Game.handleMove(i));
        DOM.board.appendChild(cell);
        DOM.cells.push(cell);
      }
    }

    /**
     * markCell
     * Stamps 'X' or 'O' into a single cell with a pop-in animation.
     *
     * @param {number} index  - 0-8
     * @param {string} player - 'X' | 'O'
     */
    function markCell(index, player) {
      const cell = DOM.cells[index];
      cell.classList.add(player.toLowerCase(), 'taken');
      cell.innerHTML = `<span class="mark">${player}</span>`;
      cell.setAttribute('aria-label', `Cell ${index + 1}: ${player}`);
    }

    /**
     * disableBoard
     * Prevents further clicks by adding 'disabled' class to all cells.
     */
    function disableBoard() {
      DOM.cells.forEach(c => c.classList.add('disabled'));
    }

    /**
     * highlightWinners
     * Adds a glowing class to the three winning cells.
     *
     * @param {number[]} combo  - e.g. [0, 4, 8]
     * @param {string}   player - 'X' | 'O'
     */
    function highlightWinners(combo, player) {
      const cls = `winner-${player.toLowerCase()}`;
      combo.forEach(i => DOM.cells[i].classList.add(cls));
    }

    /**
     * updateStatus
     * Sets the status banner text and CSS class to reflect game state.
     */
    function updateStatus() {
      const banner = DOM.statusBanner;
      banner.className = 'status-banner'; // reset classes

      if (State.phase === 'won') {
        const who = State.mode === 'ai' && State.currentPlayer === 'O'
          ? 'CPU' : `Player ${State.currentPlayer}`;
        DOM.statusText.textContent = `${who} Wins! 🏆`;
        banner.classList.add('win', `turn-${State.currentPlayer.toLowerCase()}`);
      } else if (State.phase === 'draw') {
        DOM.statusText.textContent = "It's a Draw!";
        banner.classList.add('draw');
      } else {
        const isAITurn = State.mode === 'ai' && State.currentPlayer === 'O';
        DOM.statusText.textContent = isAITurn
          ? 'CPU is thinking…'
          : `Player ${State.currentPlayer}'s Turn`;
        banner.classList.add(`turn-${State.currentPlayer.toLowerCase()}`);
      }
    }

    /**
     * updateScores
     * Syncs score display with State.scores.
     */
    function updateScores() {
      DOM.scoreX.textContent    = State.scores.X;
      DOM.scoreO.textContent    = State.scores.O;
      DOM.scoreDraw.textContent = State.scores.draw;
    }

    /**
     * updateActiveCard
     * Highlights the score card of the current player.
     */
    function updateActiveCard() {
      DOM.scoreCardX.classList.toggle('active-x', State.currentPlayer === 'X' && State.phase === 'playing');
      DOM.scoreCardO.classList.toggle('active-o', State.currentPlayer === 'O' && State.phase === 'playing');
    }

    // Expose rendering functions
    return { renderBoard, markCell, disableBoard, highlightWinners, updateStatus, updateScores, updateActiveCard };
  })();


  /* ================================================================
     GAME
     The orchestrator. Wires Logic + UI together and manages state.
  ================================================================ */
  const Game = (() => {

    /**
     * init
     * First-time setup: render the board and hook up buttons.
     */
    function init() {
      UI.renderBoard();
      UI.updateStatus();
      UI.updateScores();
      UI.updateActiveCard();
      bindButtons();
    }

    /**
     * bindButtons
     * Attaches event listeners to all control buttons (done once).
     */
    function bindButtons() {
      DOM.btnRestart.addEventListener('click', restart);
      DOM.btnResetScore.addEventListener('click', resetScore);

      DOM.btnPvP.addEventListener('click', () => {
        if (State.mode === 'pvp') return;
        State.mode = 'pvp';
        DOM.btnPvP.classList.add('active');
        DOM.btnAI.classList.remove('active');
        restart();
      });

      DOM.btnAI.addEventListener('click', () => {
        if (State.mode === 'ai') return;
        State.mode = 'ai';
        DOM.btnAI.classList.add('active');
        DOM.btnPvP.classList.remove('active');
        restart();
      });
    }

    /**
     * handleMove
     * Main entry point for a player placing their mark.
     * Called by cell click listeners.
     *
     * @param {number} index - Cell index 0-8
     */
    function handleMove(index) {
      // Guard: ignore clicks on taken cells or when game is over
      if (State.board[index] !== null || State.phase !== 'playing') return;

      // In AI mode, ignore clicks when it's the CPU's turn
      if (State.mode === 'ai' && State.currentPlayer !== State.humanPlayer) return;

      placeMarker(index);

      // After human moves in AI mode, trigger CPU
      if (State.mode === 'ai' && State.phase === 'playing') {
        scheduleCPUMove();
      }
    }

    /**
     * placeMarker
     * Applies a move: updates state, updates UI, checks for end.
     *
     * @param {number} index - Cell index 0-8
     */
    function placeMarker(index) {
      const player = State.currentPlayer;

      // 1. Update state
      State.board[index] = player;

      // 2. Render the mark
      UI.markCell(index, player);
      AudioEngine.click();

      // 3. Check for winner
      const result = Logic.checkWinner(State.board);
      if (result) {
        State.phase = 'won';
        State.winningCombo = result.combo;
        State.scores[player]++;
        UI.highlightWinners(result.combo, player);
        UI.disableBoard();
        UI.updateStatus();
        UI.updateScores();
        UI.updateActiveCard();
        AudioEngine.win();
        return;
      }

      // 4. Check for draw
      if (Logic.checkDraw(State.board)) {
        State.phase = 'draw';
        State.scores.draw++;
        UI.disableBoard();
        UI.updateStatus();
        UI.updateScores();
        UI.updateActiveCard();
        AudioEngine.draw();
        return;
      }

      // 5. Switch player and update UI
      State.currentPlayer = player === 'X' ? 'O' : 'X';
      UI.updateStatus();
      UI.updateActiveCard();
    }

    /**
     * scheduleCPUMove
     * Adds a small delay so the CPU doesn't feel instant (more natural).
     */
    function scheduleCPUMove() {
      UI.updateStatus(); // show "CPU is thinking…"

      setTimeout(() => {
        if (State.phase !== 'playing') return; // game ended before timeout
        const move = Logic.getBestMove([...State.board]);
        placeMarker(move);
      }, 420);
    }

    /**
     * restart
     * Resets the board for a new round. Scores are preserved.
     */
    function restart() {
      State.board         = Array(9).fill(null);
      State.phase         = 'playing';
      State.winningCombo  = null;
      State.currentPlayer = 'X';

      UI.renderBoard();
      UI.updateStatus();
      UI.updateActiveCard();
    }

    /**
     * resetScore
     * Zeroes out all scores and starts a fresh round.
     */
    function resetScore() {
      State.scores = { X: 0, O: 0, draw: 0 };
      UI.updateScores();
      restart();
    }

    // Expose what's needed externally (cell click listeners need handleMove)
    return { init, handleMove };
  })();


  /* ================================================================
     BOOTSTRAP — kick everything off once the DOM is ready.
  ================================================================ */
  Game.init();

})(); // end IIFE
