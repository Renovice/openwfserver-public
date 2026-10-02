// Read-only audit for the U43.5.4 Arsenal crash triggered by filtering for Limbo.
const { MongoClient, ObjectId } = require("mongodb");

const URI = "mongodb://127.0.0.1:27117";
const DB = "openWF";
const email = process.argv.find(value => value.includes("@")) ?? "test1@openwf.local";
const LIMBO_SKIN_ID = "6a8a08da4a008d228eb4dd93";

const idString = value => {
    if (value instanceof ObjectId) return value.toHexString();
    if (value && typeof value == "object" && typeof value.$oid == "string") return value.$oid;
    return undefined;
};

const visit = (value, path, callback) => {
    callback(value, path);
    if (value == null || typeof value != "object") return;
    if (value instanceof ObjectId) return;
    if (Array.isArray(value)) {
        value.forEach((child, index) => visit(child, `${path}[${index}]`, callback));
        return;
    }
    for (const [key, child] of Object.entries(value)) {
        visit(child, path ? `${path}.${key}` : key, callback);
    }
};

const compactSuit = suit => ({
    id: idString(suit._id),
    ItemType: suit.ItemType,
    FocusLens: suit.FocusLens ?? null,
    ConfigCount: suit.Configs?.length ?? 0,
    ConfigSkinValues: (suit.Configs ?? []).flatMap(config => config.Skins ?? []).map(value => idString(value) ?? value),
    ArchonCrystalUpgrades: suit.ArchonCrystalUpgrades ?? [],
    UpgradeCount: suit.Upgrades?.length ?? 0,
    UpgradeVer: suit.UpgradeVer ?? null,
    XP: suit.XP ?? null,
    Features: suit.Features ?? null,
    IsNew: suit.IsNew ?? null,
    Polarity: suit.Polarity ?? null,
    Keys: Object.keys(suit).sort()
});

(async () => {
    const client = await MongoClient.connect(URI, { serverSelectionTimeoutMS: 5000 });
    try {
        const db = client.db(DB);
        const account = await db.collection("accounts").findOne({ email });
        if (!account) throw new Error(`account not found: ${email}`);
        const inventory = await db.collection("inventories").findOne({ accountOwnerId: account._id });
        const loadout = await db.collection("loadouts").findOne({ loadoutOwnerId: account._id });
        if (!inventory || !loadout) throw new Error("inventory or loadout missing");

        const inventoryItems = new Map();
        for (const [category, values] of Object.entries(inventory)) {
            if (!Array.isArray(values)) continue;
            for (const [index, item] of values.entries()) {
                const id = idString(item?._id);
                if (id) inventoryItems.set(id, { category, index, ItemType: item.ItemType ?? null });
            }
        }

        const loadoutObjectIds = [];
        visit(loadout, "", (value, path) => {
            const id = idString(value);
            if (!id || /(^|\.)(_id|loadoutOwnerId)$/.test(path)) return;
            loadoutObjectIds.push({ path, id, resolvesTo: inventoryItems.get(id) ?? null });
        });

        const lensSuits = (inventory.Suits ?? []).filter(suit => suit.FocusLens).map(compactSuit);
        const limboSuits = (inventory.Suits ?? [])
            .filter(suit => /\/Magician\/(Magician|LimboPrime)$/.test(suit.ItemType ?? ""))
            .map(compactSuit);
        const archonSuits = (inventory.Suits ?? [])
            .filter(suit => (suit.ArchonCrystalUpgrades?.length ?? 0) != 0)
            .map(compactSuit);

        const exactReferences = [];
        for (const { name } of await db.listCollections().toArray()) {
            for await (const document of db.collection(name).find({})) {
                visit(document, "", (value, path) => {
                    if (idString(value) == LIMBO_SKIN_ID || value == LIMBO_SKIN_ID) {
                        exactReferences.push({ collection: name, document: idString(document._id), path });
                    }
                });
            }
        }

        const archonUpgradeCounts = new Map();
        for (const suit of inventory.Suits ?? []) {
            for (const upgrade of suit.ArchonCrystalUpgrades ?? []) {
                const key = `${upgrade.UpgradeType ?? "<missing>"}|${upgrade.Color ?? "<missing>"}`;
                archonUpgradeCounts.set(key, (archonUpgradeCounts.get(key) ?? 0) + 1);
            }
        }

        console.log(
            JSON.stringify(
                {
                    account: {
                        email,
                        id: idString(account._id),
                        inventoryId: idString(inventory._id),
                        loadoutId: idString(loadout._id)
                    },
                    counts: {
                        suits: inventory.Suits?.length ?? 0,
                        lensSuits: lensSuits.length,
                        archonSuits: archonSuits.length,
                        loadoutObjectIds: loadoutObjectIds.length,
                        unresolvedLoadoutObjectIds: loadoutObjectIds.filter(entry => entry.resolvesTo == null).length
                    },
                    limboSuits,
                    lensSuits,
                    archonSuits,
                    archonUpgradeCounts: Object.fromEntries([...archonUpgradeCounts].sort()),
                    limboSkinReference: {
                        id: LIMBO_SKIN_ID,
                        inventoryItem: inventoryItems.get(LIMBO_SKIN_ID) ?? null,
                        exactReferences
                    },
                    loadoutObjectIds
                },
                null,
                2
            )
        );
    } finally {
        await client.close();
    }
})().catch(error => {
    console.error("LIMBO CRASH DATA AUDIT FAILED:", error.stack ?? error.message);
    process.exit(1);
});
