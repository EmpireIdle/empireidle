// ---------- Game state in browser's localStorage ----------
let game = {
    food: 0,
    wood: 0,
    gold: 0,
    stone: 0,
    iron: 0,
    population: 1,
    populationLimit: 0, // NEW
    units: { citizen: 1, scout: 0, hunter: 0 },
    buildings: { house: 0 },
};

let currentUser = null;

// ---------- Auth helpers ----------
function loadUsers() {
    try {
        const raw = localStorage.getItem("ee_idle_users");
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function saveUsers(users) {
    localStorage.setItem("ee_idle_users", JSON.stringify(users));
}

function setCurrentUser(username) {
    currentUser = username;
    if (username) localStorage.setItem("ee_idle_current", username);
    else localStorage.removeItem("ee_idle_current");
    updateAuthUI();
}

function loadCurrentUserFromStorage() {
    return localStorage.getItem("ee_idle_current") || null;
}

function saveGameForCurrentUser() {
    if (!currentUser) return;
    const saveKey = "ee_idle_save_" + currentUser;
    const payload = { game };
    localStorage.setItem(saveKey, JSON.stringify(payload));
}

function loadGameForUser(username) {
    const saveKey = "ee_idle_save_" + username;
    const raw = localStorage.getItem(saveKey);
    if (!raw) return false;
    try {
        const data = JSON.parse(raw);
        game = data.game || game;

        // Ensure populationLimit exists for old saves
        if (typeof game.populationLimit !== "number") {
            game.populationLimit = 0;
        }

        return true;
    } catch {
        return false;
    }
}

// ---------- Game helpers ----------
function updateResourcesDisplay() {
    document.getElementById("food").textContent = game.food;
    document.getElementById("wood").textContent = game.wood;
    document.getElementById("gold").textContent = game.gold;
    document.getElementById("stone").textContent = game.stone;
    document.getElementById("iron").textContent = game.iron;
    document.getElementById("pop").textContent = `${game.population}/${game.populationLimit}`;
}

// ---------- UI Event listeners ----------
const loginBtn = document.getElementById("loginBtn");
const signupBtn = document.getElementById("signupBtn");
const logoutBtn = document.getElementById("logoutBtn");

loginBtn.addEventListener("click", () => {
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    if (!username || !password) { alert("Enter username and password"); return; }
    const users = loadUsers();
    if (!users[username]) { alert("Account not found. Sign up first."); return; }
    if (users[username].password !== password) { alert("Incorrect password."); return; }
    setCurrentUser(username);
    if (!loadGameForUser(username)) startNewGameState();
    updateResourcesDisplay();
});

signupBtn.addEventListener("click", () => {
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    if (!username || !password) { alert("Enter username and password to sign up"); return; }
    const users = loadUsers();
    if (users[username]) { alert("That username is already taken."); return; }
    users[username] = { password };
    saveUsers(users);
    setCurrentUser(username);
    startNewGameState();
    updateResourcesDisplay();
});

logoutBtn.addEventListener("click", () => {
    setCurrentUser(null);
    startNewGameState();
    updateResourcesDisplay();
});

// Start a new game
function startNewGameState() {
    game = {
        food: 0,
        wood: 0,
        gold: 0,
        stone: 0,
        iron: 0,
        population: 1,
        populationLimit: 0, // NEW
        units: { citizen: 1, scout: 0, hunter: 0 },
        buildings: { house: 0 },
    };
}

// Example of a game action: Spawn a unit
function spawnUnit(type) {
    if (type === 'citizen') {
        if (game.population >= game.populationLimit) {
            alert("Population cap reached! Build more houses.");
            return;
        }

        game.units.citizen++;
        game.population++;
    }
    updateResourcesDisplay();
}

// For simplicity, load saved game data and update display on page load
(function init() {
    const prev = loadCurrentUserFromStorage();
    if (prev) {
        setCurrentUser(prev);
        if (!loadGameForUser(prev)) startNewGameState();
        updateResourcesDisplay();
    } else {
        // fresh start, make sure populationLimit exists
        startNewGameState();
        updateResourcesDisplay();
    }
})();
