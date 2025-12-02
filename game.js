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

    // order types we support
    /**
     * unit.order in: "idle" | "explore" | "harvest" | "patrol" | "defend" | "attack" | "build"
     */
    let unitInstances = []; // {id,name,order,orderLabel,members,exploreProgress?}
    let groups = [];

    // discovered resource distribution per tile
    const productionRates = {
        forest: { wood: 0.15 },
        berry:  { food: 0.12 },
        stone:  { stone: 0.12 },
        game:   { food: 0.20 },
        river:  { food: 0.05 },
        iron:   { iron: 0.08 },
        grass:  { food: 0.02 }
    };

    // per-unit harvest rates per second
    const UNIT_HARVEST_RATES = {
        food: 0.20,
        wood: 0.15,
        stone: 0.12,
        iron: 0.08
    };

    // building stats
    const BUILD_TIMES = {
        house: 30
    };

    const HOUSE_COST = { wood: 50, stone: 40 };
    const HOUSE_HP = 500;
    const HOUSE_POP = 4;

    // exploration timing (seconds per new tile)
    const UNIT_EXPLORE_TIME  = 20; // one lone citizen takes 20s per tile
    const GROUP_EXPLORE_TIME = 10; // groups explore faster

    // discovered resources exist in the world until harvested
    let worldMap = null;
    let discoveredLog = [];
    let discoveredTotals = { food: 0, wood: 0, stone: 0, iron: 0 };
    let currentUser = null;

    // localStorage keys
    const LS_USERS_KEY   = "ee_idle_users";
    const LS_CURRENT_KEY = "ee_idle_current_user";
    const LS_SAVE_PREFIX = "ee_idle_save_";

    // ---------- helpers ----------
    function saveUsers(users) {
        localStorage.setItem(LS_USERS_KEY, JSON.stringify(users));
    }

    function loadUsers() {
        try {
            const raw = localStorage.getItem(LS_USERS_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch {
            return {};
        }
    }

    function saveGameForUser(username) {
        if (!username) return;
        const saveKey = LS_SAVE_PREFIX + username;
        const payload = {
            game,
            unitInstances,
            groups,
            worldMap,
            discoveredTotals,
            discoveredLog,
            nextUnitId,
            nextGroupId
        };
        localStorage.setItem(saveKey, JSON.stringify(payload));
    }

    function loadGameForUser(username) {
        const saveKey = LS_SAVE_PREFIX + username;
        const raw = localStorage.getItem(saveKey);
        if (!raw) return false;
        try {
            const data = JSON.parse(raw);
            game = data.game || game;
            unitInstances = data.unitInstances || [];
            groups = data.groups || [];
            worldMap = data.worldMap || null;
            discoveredTotals = data.discoveredTotals || { food: 0, wood: 0, stone: 0, iron: 0 };
            discoveredLog = data.discoveredLog || [];
            nextUnitId = data.nextUnitId || 1;
            nextGroupId = data.nextGroupId || 1;
            return true;
        } catch {
            return false;
        }
    }

    function setCurrentUser(username) {
        currentUser = username;
        if (username) {
            localStorage.setItem(LS_CURRENT_KEY, username);
        } else {
            localStorage.removeItem(LS_CURRENT_KEY);
        }
        updateAuthUI();
    }

    function loadCurrentUserFromStorage() {
        return localStorage.getItem(LS_CURRENT_KEY) || null;
    }

    function capitalize(str) {
        if (!str) return "";
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function buildingName(type) {
        if (type === "house") return "House";
        return capitalize(type);
    }

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

    // ---------- harvesting ----------
    function harvestResourceForUnit(u, dtSeconds) {
        const resKey = u.harvestResource;
        if (!resKey) return;
        if (!discoveredTotals[resKey] || discoveredTotals[resKey] <= 0) {
            if (u.order === "harvest") {
                u.order = "idle";
                u.harvestResource = null;
                u.harvestRemainder = 0;
                addActivityEntry(`${capitalize(u.type)} #${u.id} has exhausted that resource and is now idle.`);
            }
            return;
        }

        const rate = UNIT_HARVEST_RATES[resKey] || 0;
        if (!rate) return;

        u.harvestRemainder = (u.harvestRemainder || 0) + rate * dtSeconds;
        let whole = Math.floor(u.harvestRemainder);
        if (whole > discoveredTotals[resKey]) {
            whole = discoveredTotals[resKey];
        }

        u.harvestRemainder -= whole;

        if (whole > 0) {
            game[resKey] = (game[resKey] || 0) + whole;
            discoveredTotals[resKey] -= whole;
            if (discoveredTotals[resKey] < 0) discoveredTotals[resKey] = 0;
        }
    }

    function unitHarvestTick(dtSeconds) {
        unitInstances.forEach(u => {
            if (u.order !== "harvest") return;
            harvestResourceForUnit(u, dtSeconds);
        });
    }

    // ---------- building ----------
    function completeBuild(u, type) {
        if (!game.buildings) game.buildings = { house: 0 };
        if (type === "house") {
            game.buildings.house = (game.buildings.house || 0) + 1;
            game.population += HOUSE_POP;
            addActivityEntry(`${capitalize(u.type)} #${u.id} finished building a House. Population increased by ${HOUSE_POP}.`);
        } else {
            addActivityEntry(`${capitalize(u.type)} #${u.id} finished building a ${buildingName(type)}.`);
        }
    }

    function unitBuildTick(dtSeconds) {
        unitInstances.forEach(u => {
            if (u.order !== "build" || !u.currentBuild) return;
            u.currentBuild.remaining -= dtSeconds;
            if (u.currentBuild.remaining <= 0) {
                completeBuild(u, u.currentBuild.type);
                u.order = "idle";
                u.currentBuild = null;
            }
        });
    }

    // ---------- main production tick ----------
    function applyProductionForTile(tile, dtSeconds) {
        const prod = productionRates[tile.type] || {};
        for (const res in prod) {
            const amount = prod[res] * dtSeconds;
            game[res] = (game[res] || 0) + amount;
        }
    }

    function explorationTick(dtSeconds) {
        unitInstances.forEach(u => {
            if (u.order === "explore") {
                exploreTileForUnitOrGroup(u, dtSeconds);
            }
        });
        groups.forEach(g => {
            if (g.order === "explore") {
                exploreTileForUnitOrGroup(g, dtSeconds);
            }
        });
    }

    function productionTick(dtSeconds = 1) {
        if (!worldMap || !worldMap.tiles) return;
        const tiles = Object.values(worldMap.tiles);
        tiles.forEach(t => {
            if (t.assignedGroupId) applyProductionForTile(t, dtSeconds);
        });

        unitHarvestTick(dtSeconds);
        unitBuildTick(dtSeconds);
        explorationTick(dtSeconds);
        updateUI();
    }

    // ---------- UI update ----------
    function updateUI() {
        document.getElementById("food").textContent  = Math.floor(game.food);
        document.getElementById("wood").textContent  = Math.floor(game.wood);
        document.getElementById("gold").textContent  = Math.floor(game.gold);
        document.getElementById("stone").textContent = Math.floor(game.stone);
        document.getElementById("iron").textContent  = Math.floor(game.iron);
        document.getElementById("pop").textContent   = Math.floor(game.population);

        renderOwnedUnitsList();
        renderBuildingsList();
        renderGroupsList();
        renderDiscoveredList();
        renderQueuedStatus();
    }

    // ---------- Activity log ----------
    function addActivityEntry(message) {
        const log = document.getElementById("activityLog");
        if (!log) return;
        const entry = document.createElement("div");
        entry.className = "activityEntry";
        const timeSpan = document.createElement("span");
        timeSpan.className = "activityTime";
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, "0");
        const mm = String(now.getMinutes()).padStart(2, "0");
        timeSpan.textContent = `[${hh}:${mm}]`;
        const msgSpan = document.createElement("span");
        msgSpan.textContent = " " + message;
        entry.appendChild(timeSpan);
        entry.appendChild(msgSpan);
        log.appendChild(entry);
        log.scrollTop = log.scrollHeight;
    }

    // ---------- render helpers (units, buildings, groups, discovered, queued) ----------
    function renderOwnedUnitsList() {
        const ul = document.getElementById("ownedUnitsList");
        ul.innerHTML = "";
        unitInstances.forEach(u => {
            const li = document.createElement("li");
            li.textContent = `${capitalize(u.type)} #${u.id} — Order: ${u.orderLabel || capitalize(u.order)}`;
            li.dataset.unitId = String(u.id);
            li.addEventListener("click", () => showUnitDetails(u.id));
            ul.appendChild(li);
        });
    }

    function renderBuildingsList() {
        const ul = document.getElementById("buildingsList");
        ul.innerHTML = "";
        const houses = game.buildings?.house || 0;
        const li = document.createElement("li");
        li.textContent = `Houses: ${houses} (each adds ${HOUSE_POP} population capacity)`;
        ul.appendChild(li);
    }

    function renderGroupsList() {
        const ul = document.getElementById("groupsList");
        ul.innerHTML = "";
        groups.forEach(g => {
            const li = document.createElement("li");
            const membersCount = g.members.length;
            li.textContent = `${g.name} — ${membersCount} member(s), Order: ${g.orderLabel || capitalize(g.order)}`;
            li.dataset.groupId = String(g.id);
            li.addEventListener("click", () => showGroupDetails(g.id));
            ul.appendChild(li);
        });
    }

    function renderDiscoveredList() {
        const ul = document.getElementById("discoveredList");
        ul.innerHTML = "";
        ["food","wood","stone","iron"].forEach(res => {
            const li = document.createElement("li");
            const amount = Math.floor(discoveredTotals[res] || 0);
            li.textContent = `${capitalize(res)}: ${amount}`;
            ul.appendChild(li);
        });
    }

    function renderQueuedStatus() {
        const ul = document.getElementById("queuedList");
        ul.innerHTML = "";
        unitInstances.forEach(u => {
            if (u.order && u.order !== "idle") {
                const li = document.createElement("li");
                li.textContent = `${capitalize(u.type)} #${u.id} — ${u.orderLabel || capitalize(u.order)}`;
                ul.appendChild(li);
            }
        });
        groups.forEach(g => {
            if (g.order && g.order !== "idle") {
                const li = document.createElement("li");
                li.textContent = `${g.name} — ${g.orderLabel || capitalize(g.order)}`;
                ul.appendChild(li);
            }
        });
    }

    // ---------- detail panel ----------
    function showUnitDetails(unitId) {
        const u = unitInstances.find(x => x.id === unitId);
        if (!u) return;
        const panel = document.getElementById("detailPanel");
        panel.innerHTML = "";

        const header = document.createElement("div");
        header.className = "detailHeader";
        header.textContent = `${capitalize(u.type)} #${u.id}`;
        const sub = document.createElement("div");
        sub.className = "detailSubHeader";
        sub.textContent = "Individual unit tasks and orders.";
        panel.appendChild(header);
        panel.appendChild(sub);

        const statusBlock = document.createElement("div");
        statusBlock.className = "detailBlock";
        const statusTitle = document.createElement("div");
        statusTitle.className = "detailSectionTitle";
        statusTitle.textContent = "STATUS";
        statusBlock.appendChild(statusTitle);

        const statusText = document.createElement("div");
        statusText.className = "detailRow";
        let orderDesc = "is idle.";
        if (u.order === "explore") orderDesc = "is exploring.";
        else if (u.order === "harvest") orderDesc = `is harvesting ${u.harvestResource || "resources"}.`;
        else if (u.order === "build") orderDesc = u.currentBuild
            ? `is building a ${buildingName(u.currentBuild.type)}.`
            : "is assigned to build.";
        statusText.textContent = `${capitalize(u.type)} #${u.id} ${orderDesc}`;
        statusBlock.appendChild(statusText);

        const queuedText = document.createElement("div");
        queuedText.className = "detailRow";
        queuedText.textContent = `Queued Tasks: None`;
        statusBlock.appendChild(queuedText);

        panel.appendChild(statusBlock);

        const actionsBlock = document.createElement("div");
        actionsBlock.className = "detailBlock";
        const actionsTitle = document.createElement("div");
        actionsTitle.className = "detailSectionTitle";
        actionsTitle.textContent = "ACTIONS";
        actionsBlock.appendChild(actionsTitle);

        const exploreBtn = document.createElement("button");
        exploreBtn.textContent = "Explore";
        exploreBtn.className = "primaryBtn";
        exploreBtn.style.marginRight = "8px";
        exploreBtn.addEventListener("click", () => {
            u.order = "explore";
            u.orderLabel = "Explore";
            addActivityEntry(`${capitalize(u.type)} #${u.id} set to explore.`);
            updateUI();
        });
        actionsBlock.appendChild(exploreBtn);

        const harvestTitle = document.createElement("div");
        harvestTitle.className = "detailSectionTitle";
        harvestTitle.textContent = "Harvest / Mine";
        actionsBlock.appendChild(harvestTitle);

        const harvestRow = document.createElement("div");
        const select = document.createElement("select");
        const resOptions = ["", "food", "wood", "stone", "iron"];
        resOptions.forEach(v => {
            const opt = document.createElement("option");
            opt.value = v;
            opt.textContent = v ? capitalize(v) : "Select resource…";
            select.appendChild(opt);
        });
        harvestRow.appendChild(select);

        const harvestBtn = document.createElement("button");
        harvestBtn.textContent = "Start Harvesting";
        harvestBtn.className = "secondaryBtn";
        harvestBtn.style.marginLeft = "8px";
        harvestBtn.addEventListener("click", () => {
            const val = select.value;
            if (!val) return;
            u.order = "harvest";
            u.harvestResource = val;
            u.orderLabel = `Harvest ${capitalize(val)}`;
            addActivityEntry(`${capitalize(u.type)} #${u.id} set to harvest ${val}.`);
            updateUI();
        });
        harvestRow.appendChild(harvestBtn);
        actionsBlock.appendChild(harvestRow);

        const buildTitle = document.createElement("div");
        buildTitle.className = "detailSectionTitle";
        buildTitle.textContent = "Build";
        actionsBlock.appendChild(buildTitle);

        const buildRow = document.createElement("div");
        const buildBtn = document.createElement("button");
        buildBtn.className = "secondaryBtn";
        buildBtn.textContent = `Build House (${HOUSE_COST.wood} Wood, ${HOUSE_COST.stone} Stone)`;
        buildBtn.addEventListener("click", () => {
            if ((game.wood || 0) < HOUSE_COST.wood || (game.stone || 0) < HOUSE_COST.stone) {
                alert("Not enough resources to build a house.");
                return;
            }
            game.wood -= HOUSE_COST.wood;
            game.stone -= HOUSE_COST.stone;
            u.order = "build";
            u.currentBuild = {
                type: "house",
                remaining: BUILD_TIMES.house
            };
            u.orderLabel = "Build House";
            addActivityEntry(`${capitalize(u.type)} #${u.id} has started building a House.`);
            updateUI();
        });
        buildRow.appendChild(buildBtn);
        actionsBlock.appendChild(buildRow);

        const explainRow = document.createElement("div");
        explainRow.className = "detailRow";
        explainRow.style.marginTop = "8px";
        explainRow.style.fontSize = "12px";
        explainRow.style.color = "#666";
        explainRow.textContent = "Explore discovers new resource deposits. Harvest converts discovered resources into inventory over time. Houses increase your population by 4 when completed.";
        actionsBlock.appendChild(explainRow);

        panel.appendChild(actionsBlock);
    }

    function showGroupDetails(groupId) {
        // For now we keep groups simple; this can be expanded later.
        const g = groups.find(x => x.id === groupId);
        if (!g) return;
        const panel = document.getElementById("detailPanel");
        panel.innerHTML = "";

        const header = document.createElement("div");
        header.className = "detailHeader";
        header.textContent = g.name;
        const sub = document.createElement("div");
        sub.className = "detailSubHeader";
        sub.textContent = "Group-level orders, combining multiple units.";
        panel.appendChild(header);
        panel.appendChild(sub);

        const membersRow = document.createElement("div");
        membersRow.className = "detailRow";
        membersRow.textContent = `Members: ${g.members.map(id => "#" + id).join(", ") || "None"}`;
        panel.appendChild(membersRow);

        const actionsBlock = document.createElement("div");
        actionsBlock.className = "detailBlock";
        const actionsTitle = document.createElement("div");
        actionsTitle.className = "detailSectionTitle";
        actionsTitle.textContent = "ACTIONS";
        actionsBlock.appendChild(actionsTitle);

        const exploreBtn = document.createElement("button");
        exploreBtn.textContent = "Explore as Group";
        exploreBtn.className = "primaryBtn";
        exploreBtn.addEventListener("click", () => {
            g.order = "explore";
            g.orderLabel = "Explore";
            if (!g.speed) g.speed = 1.2;
            addActivityEntry(`${g.name} set to explore as a group.`);
            updateUI();
        });
        actionsBlock.appendChild(exploreBtn);

        panel.appendChild(actionsBlock);
    }

    // ---------- basic UI wiring ----------
    const leftTabButtons = Array.from(document.querySelectorAll(".leftTab"));
    leftTabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const tab = btn.dataset.tab;
            leftTabButtons.forEach(b => b.classList.toggle("active", b === btn));
            const pages = document.querySelectorAll(".leftTabPage");
            pages.forEach(p => {
                p.classList.toggle("hidden", p.dataset.tab !== tab);
            });
        });
    });

    const rightTabButtons = Array.from(document.querySelectorAll(".rightTab"));
    rightTabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const tab = btn.dataset["rightTab"];
            rightTabButtons.forEach(b => b.classList.toggle("active", b === btn));
            const pages = document.querySelectorAll(".rightTabPage");
            pages.forEach(p => {
                p.classList.toggle("hidden", p.dataset["rightTab"] !== tab);
            });
        });
    });

    document.getElementById("exploreBtn").addEventListener("click", () => {
        if (!unitInstances.length) {
            alert("No units available to explore.");
            return;
        }
        unitInstances.forEach(u => {
            u.order = "explore";
            u.orderLabel = "Explore";
        });
        addActivityEntry("All units set to explore.");
        updateUI();
    });

    const createGroupBtn = document.getElementById("createGroupBtn");
    if (createGroupBtn) {
        createGroupBtn.addEventListener("click", () => {
            if (unitInstances.length < 2) {
                alert("Need at least 2 units to form a group.");
                return;
            }
            const groupId = nextGroupId++;
            const members = unitInstances.map(u => u.id);
            const group = {
                id: groupId,
                name: `Group ${groupId}`,
                members,
                order: "idle",
                orderLabel: "Idle",
                speed: 1.2
            };
            groups.push(group);
            addActivityEntry(`${group.name} created with members ${members.map(id => "#" + id).join(", ")}.`);
            updateUI();
        });
    }

    // ---------- auth UI & simple local accounts ----------
    const loginBtn  = document.getElementById("loginBtn");
    const signupBtn = document.getElementById("signupBtn");
    const logoutBtn = document.getElementById("logoutBtn");

    function updateAuthUI() {
        const authStatus = document.getElementById("authStatus");
        const authInputs = document.getElementById("authInputs");
        if (!currentUser) {
            authInputs.style.display = "flex";
            authStatus.style.display = "none";
            logoutBtn.style.display = "none";
        } else {
            authInputs.style.display = "none";
            authStatus.style.display = "inline-block";
            authStatus.textContent = `Logged in as ${currentUser}`;
            logoutBtn.style.display = "inline-block";
        }
    }

    loginBtn.addEventListener("click", () => {
        const username = document.getElementById("username").value.trim();
        const password = document.getElementById("password").value;
        if (!username || !password) {
            alert("Enter username and password");
            return;
        }
        const users = loadUsers();
        if (!users[username]) {
            alert("Account not found. Sign up first.");
            return;
        }
        if (users[username].password !== password) {
            alert("Incorrect password.");
            return;
        }
        setCurrentUser(username);
        if (!loadGameForUser(username)) {
            startNewGameState();
        }
        addActivityEntry(`Welcome back, ${username}.`);
        updateUI();
    });

    signupBtn.addEventListener("click", () => {
        const username = document.getElementById("username").value.trim();
        const password = document.getElementById("password").value;
        if (!username || !password) {
            alert("Enter username and password to sign up");
            return;
        }
        const users = loadUsers();
        if (users[username]) {
            alert("That username is already taken.");
            return;
        }
        users[username] = { password };
        saveUsers(users);
        setCurrentUser(username);
        startNewGameState();
        addActivityEntry(`New empire started for ${username}.`);
        updateUI();
    });

    logoutBtn.addEventListener("click", () => {
        if (currentUser) {
            saveGameForUser(currentUser);
        }
        setCurrentUser(null);
        startNewGameState();
        addActivityEntry("Logged out and started a fresh local empire.");
        updateUI();
    });

    // ---------- game state bootstrap ----------
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

        initWorldIfNeeded();
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
            saveGameForUser(currentUser);
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

// Firebase Configuration
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
