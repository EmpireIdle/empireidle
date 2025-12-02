// ---------- core game state ----------
let game = {
    food: 0,
    wood: 0,
    gold: 0,
    stone: 0,
    iron: 0,
    population: 1,
    units: { citizen: 1, scout: 0, hunter: 0 },
    buildings: { house: 0 },
};

// next IDs for units and groups
let nextUnitId = 1;
let nextGroupId = 1;

// unit templates
const unitTemplates = {
    citizen: {
        type: "citizen",
        baseHp: 100,
        speed: 1,
        description: "General worker for exploring, harvesting, and building."
    },
    scout: {
        type: "scout",
        baseHp: 70,
        speed: 2,
        description: "Faster explorer, weaker in direct conflict."
    },
    hunter: {
        type: "hunter",
        baseHp: 110,
        speed: 0.9,
        description: "Focused on game for food and basic defense."
    }
};

let unitInstances = []; // {id,name,order,orderLabel,members,exploreProgress?}
let groups = [];

const productionRates = {
    forest: { wood: 0.15 },
    berry:  { food: 0.12 },
    stone:  { stone: 0.12 },
    game:   { food: 0.20 },
    river:  { food: 0.05 },
    iron:   { iron: 0.08 },
    grass:  { food: 0.02 }
};

const UNIT_HARVEST_RATES = {
    food: 0.20,
    wood: 0.15,
    stone: 0.12,
    iron: 0.08
};

const BUILD_TIMES = { house: 30 };
const HOUSE_COST = { wood: 50, stone: 40 };
const HOUSE_HP = 500;
const HOUSE_POP = 4;

const UNIT_EXPLORE_TIME = 20; // one lone citizen takes 20s per tile
const GROUP_EXPLORE_TIME = 10; // groups explore faster

let worldMap = null;
let discoveredLog = [];
let discoveredTotals = { food: 0, wood: 0, stone: 0, iron: 0 };
let currentUser = null;

// Firebase configuration
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "SENDER_ID",
    appId: "APP_ID"
};

// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);
const db = firebase.firestore(app);
const auth = firebase.auth();

// ---------- save game state ----------
function saveGameStateToFirestore() {
    if (!currentUser) return;  // Ensure user is logged in

    const userRef = db.collection("gameSaves").doc(currentUser);  // Use email as user ID

    userRef.set({
        resources: {
            food: game.food,
            wood: game.wood,
            gold: game.gold,
            stone: game.stone,
            iron: game.iron,
        },
        population: game.population,
        buildings: game.buildings,
        units: unitInstances,  // Save the array of units to Firestore
    })
    .then(() => {
        console.log("Game state saved to Firestore.");
    })
    .catch((error) => {
        console.error("Error saving game state: ", error);
    });
}

// ---------- load game state ----------
function loadGameStateFromFirestore() {
    if (!currentUser) return;

    const userRef = db.collection("gameSaves").doc(currentUser);

    userRef.get().then((doc) => {
        if (doc.exists) {
            const data = doc.data();
            console.log("Game state loaded from Firestore:", data);

            game.food = data.resources.food;
            game.wood = data.resources.wood;
            game.gold = data.resources.gold;
            game.stone = data.resources.stone;
            game.iron = data.resources.iron;
            game.population = data.population;
            game.buildings = data.buildings || {};

            unitInstances = data.units || [];  // Load units from Firestore

            updateUI();  // Update UI with loaded data
        } else {
            console.log("No saved game found for this user.");
            startNewGameState();  // Optionally, start fresh game
        }
    }).catch((error) => {
        console.error("Error loading game state: ", error);
    });
}

// ---------- auth UI ----------
function updateAuthUI() {
    const authStatus = document.getElementById("authStatus");
    const authInputs = document.getElementById("authInputs");
    if (!currentUser) {
        authInputs.style.display = "flex";
        authStatus.style.display = "none";
    } else {
        authInputs.style.display = "none";
        authStatus.style.display = "inline-block";
        authStatus.textContent = `Logged in as ${currentUser}`;
    }
}

// ---------- user authentication ----------
function loginUser(email, password) {
    auth.signInWithEmailAndPassword(email, password)
        .then((userCredential) => {
            const user = userCredential.user;
            currentUser = user.email;
            loadGameStateFromFirestore();  // Load saved game after login
        })
        .catch((error) => {
            console.error("Error logging in: ", error);
        });
}

// ---------- game initialization ----------
function startNewGameState() {
    game = {
        food: 0,
        wood: 0,
        gold: 0,
        stone: 0,
        iron: 0,
        population: 1,
        units: { citizen: 1, scout: 0, hunter: 0 },
        buildings: { house: 0 },
    };

    unitInstances = [];
    groups = [];
    worldMap = null;
    discoveredTotals = { food: 0, wood: 0, stone: 0, iron: 0 };
    discoveredLog = [];
    nextUnitId = 1;
    nextGroupId = 1;

    const firstCitizen = {
        id: nextUnitId++,
        type: "citizen",
        order: "explore",
        orderLabel: "Explore",
        harvestResource: null,
        harvestRemainder: 0
    };
    unitInstances.push(firstCitizen);
}

// ---------- persist periodically ----------
setInterval(() => {
    if (currentUser) {
        saveGameStateToFirestore(currentUser);
    }
}, 5000);

// ---------- initial load ----------
(function init() {
    initWorldIfNeeded();
    const prev = loadCurrentUserFromStorage();
    if (prev) {
        const users = loadUsers();
        if (users[prev]) {
            currentUser = prev;
            updateAuthUI();
            if (!loadGameForUser(prev)) {
                startNewGameState();
            }
            addActivityEntry(`Welcome back, ${prev}.`);
            updateUI();
            setInterval(() => productionTick(1), 1000);
            return;
        }
    }
    setCurrentUser(null);
    startNewGameState();
    updateUI();
    setInterval(() => productionTick(1), 1000);
})();

// ---------- world map & exploration ----------
function initWorldIfNeeded() {
    if (worldMap) return;
    worldMap = {
        tiles: {}
    };
    for (let x = -2; x <= 2; x++) {
        for (let y = -2; y <= 2; y++) {
            const id = `${x},${y}`;
            const type = randomTileType();
            worldMap.tiles[id] = {
                id,
                x,
                y,
                type,
                assignedGroupId: null
            };
        }
    }
}

function randomTileType() {
    const types = ["forest", "berry", "stone", "game", "river", "iron", "grass"];
    return types[Math.floor(Math.random() * types.length)];
}

function exploreTileForUnitOrGroup(owner, dtSeconds) {
    if (!owner.exploreTarget) {
        const tile = pickNewTile();
        if (!tile) return;
        owner.exploreTarget = {
            tileId: tile.id,
            remaining: owner.isGroup ? GROUP_EXPLORE_TIME : UNIT_EXPLORE_TIME
        };
        addActivityEntry(`${owner.label} began exploring tile ${tile.id} (${tile.type}).`);
    }

    owner.exploreTarget.remaining -= dtSeconds * (owner.speed || 1);
    if (owner.exploreTarget.remaining <= 0) {
        completeExplore(owner);
    }
}

function pickNewTile() {
    if (!worldMap || !worldMap.tiles) return null;
    const tiles = Object.values(worldMap.tiles);
    const unexplored = tiles.filter(t => !t.discovered);
    let tile;
    if (unexplored.length) {
        tile = unexplored[Math.floor(Math.random() * unexplored.length)];
    } else {
        tile = tiles[Math.floor(Math.random() * tiles.length)];
    }
    tile.discovered = true;
    return tile;
}

function completeExplore(owner) {
    if (!owner.exploreTarget) return;
    const tile = worldMap.tiles[owner.exploreTarget.tileId];
    if (!tile) return;

    const prod = productionRates[tile.type] || {};
    let summaryParts = [];
    for (const res in prod) {
        const amount = Math.floor(prod[res] * 50 + 20);
        discoveredTotals[res] = (discoveredTotals[res] || 0) + amount;
        summaryParts.push(`${amount} ${res}`);
    }

    const summary = summaryParts.length ? summaryParts.join(", ") : "no usable resources";
    addActivityEntry(`${owner.label} completed exploration of ${tile.id} (${tile.type}), discovering ${summary}.`);

    discoveredLog.push({
        tileId: tile.id,
        type: tile.type,
        resources: summaryParts,
        time: Date.now()
    });

    owner.exploreTarget = null;
}

