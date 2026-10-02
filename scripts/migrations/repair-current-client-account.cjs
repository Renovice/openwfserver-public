// Non-destructive current-client account repair.
// Dry-run: node scripts/migrations/repair-current-client-account.cjs test1@openwf.local
// Apply:   node scripts/migrations/repair-current-client-account.cjs test1@openwf.local --apply
const { MongoClient, ObjectId } = require("mongodb");
const { ExportWeapons } = require("warframe-public-export-plus");

const URI = "mongodb://127.0.0.1:27117";
const DB = "openWF";
const email = process.argv.find(value => value.includes("@")) ?? "test1@openwf.local";
const apply = process.argv.includes("--apply");

const HOVERBOARD = "/Lotus/Types/Vehicles/Hoverboard/HoverboardSuit";
const HOVERBOARD_PARTS = [
    "/Lotus/Types/Vehicles/Hoverboard/HoverboardParts/PartComponents/HoverboardCorpusA/HoverboardCorpusADeck",
    "/Lotus/Types/Vehicles/Hoverboard/HoverboardParts/PartComponents/HoverboardCorpusA/HoverboardCorpusAEngine",
    "/Lotus/Types/Vehicles/Hoverboard/HoverboardParts/PartComponents/HoverboardCorpusA/HoverboardCorpusAFront",
    "/Lotus/Types/Vehicles/Hoverboard/HoverboardParts/PartComponents/HoverboardCorpusA/HoverboardCorpusAJet"
];
const REQUIRED_PART_TYPES = new Set(["LWPT_HB_DECK", "LWPT_HB_ENGINE", "LWPT_HB_FRONT", "LWPT_HB_JET"]);

const FOCUS_PATHS = new Map([
    [
        "/Lotus/Upgrades/Focus/Power/EnergyOverTimeFocusUpgrade",
        "/Lotus/Upgrades/Focus/Power/Residual/EnergyOverTimeFocusUpgrade"
    ],
    [
        "/Lotus/Upgrades/Focus/Power/FreeAbilityCastsFocusUpgrade",
        "/Lotus/Upgrades/Focus/Power/Residual/FreeAbilityCastsFocusUpgrade"
    ]
]);
const MERGED_ARMOR_PATHS = new Map([
    [
        "/Lotus/Upgrades/Skins/Armor/WarframeDefaults/SWBansheeBotLArmRightArmor",
        "/Lotus/Upgrades/Skins/Armor/WarframeDefaults/SWBansheeBotLArmLeftArmor"
    ],
    [
        "/Lotus/Upgrades/Skins/Armor/WarframeDefaults/SWSonorityArmRightArmor",
        "/Lotus/Upgrades/Skins/Armor/WarframeDefaults/SWSonorityArmLeftArmor"
    ]
]);

const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};

const containsIdOutsideInventoryEntry = async (db, inventoryId, itemId) => {
    const needle = String(itemId);
    const visit = (value, path, matches) => {
        if (value == null) return;
        if (String(value) == needle) matches.push(path);
        if (typeof value != "object") return;
        for (const [key, child] of Object.entries(value)) {
            visit(child, path ? `${path}.${key}` : key, matches);
        }
    };
    const references = [];
    for (const collection of await db.listCollections().toArray()) {
        for await (const document of db.collection(collection.name).find({})) {
            const matches = [];
            visit(document, "", matches);
            for (const path of matches) {
                const ownsInventoryEntry =
                    collection.name == "inventories" &&
                    String(document._id) == String(inventoryId) &&
                    /^WeaponSkins\.\d+\._id$/.test(path);
                if (!ownsInventoryEntry) references.push(`${collection.name}:${String(document._id)}:${path}`);
            }
        }
    }
    return references;
};

(async () => {
    const partTypes = new Set(HOVERBOARD_PARTS.map(part => ExportWeapons[part]?.partType));
    assert(
        partTypes.size == 4 && [...REQUIRED_PART_TYPES].every(type => partTypes.has(type)),
        "hoverboard parts do not satisfy the four current public-export slots"
    );

    const client = await MongoClient.connect(URI, { serverSelectionTimeoutMS: 5000 });
    try {
        const db = client.db(DB);
        const account = await db.collection("accounts").findOne({ email });
        assert(account, `account not found: ${email}`);
        const inventory = await db.collection("inventories").findOne({ accountOwnerId: account._id });
        const loadout = await db.collection("loadouts").findOne({ loadoutOwnerId: account._id });
        assert(inventory, `inventory not found for ${email}`);
        assert(loadout, `loadout not found for ${email}`);

        const actions = [];
        for (const [oldPath, currentPath] of FOCUS_PATHS) {
            const oldEntry = inventory.FocusUpgrades?.find(entry => entry.ItemType == oldPath);
            if (oldEntry) actions.push({ type: "focus-path", oldPath, currentPath, level: oldEntry.Level });
        }

        const mergedArmorIds = [];
        for (const [obsoletePath, currentPath] of MERGED_ARMOR_PATHS) {
            const obsolete = inventory.WeaponSkins?.find(entry => entry.ItemType == obsoletePath);
            if (!obsolete) continue;
            assert(
                inventory.WeaponSkins.some(entry => entry.ItemType == currentPath),
                `cannot merge ${obsoletePath}: current ownership ${currentPath} is missing`
            );
            const externalReferences = await containsIdOutsideInventoryEntry(db, inventory._id, obsolete._id);
            assert(
                externalReferences.length == 0,
                `cannot merge referenced obsolete skin ${String(obsolete._id)}: ${externalReferences.join(", ")}`
            );
            mergedArmorIds.push(obsolete._id);
            actions.push({ type: "merged-armor", obsoletePath, currentPath, obsoleteId: String(obsolete._id) });
        }

        let hoverboard = inventory.Hoverboards?.[0];
        let newHoverboard;
        if (!hoverboard) {
            assert((inventory.SpaceSuitBin?.Slots ?? 0) > 0, "cannot grant hoverboard: no free SpaceSuitBin slot");
            newHoverboard = {
                _id: new ObjectId(),
                ItemType: HOVERBOARD,
                Configs: [],
                UpgradeVer: 101,
                XP: 0,
                ModularParts: HOVERBOARD_PARTS,
                IsNew: true
            };
            hoverboard = newHoverboard;
            actions.push({ type: "grant-hoverboard", itemId: String(hoverboard._id), parts: HOVERBOARD_PARTS });
        }
        const currentKdriveSuit = loadout.KDRIVE?.[0]?.s?.ItemId;
        if (String(currentKdriveSuit ?? "") != String(hoverboard._id)) {
            actions.push({
                type: "equip-hoverboard",
                previous: currentKdriveSuit == null ? null : String(currentKdriveSuit),
                itemId: String(hoverboard._id),
                preservedFields: ["p", "m"]
            });
        }

        console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", email, actions }, null, 2));
        if (!apply) return;

        for (const [oldPath, currentPath] of FOCUS_PATHS) {
            await db
                .collection("inventories")
                .updateOne(
                    { _id: inventory._id },
                    { $set: { "FocusUpgrades.$[entry].ItemType": currentPath } },
                    { arrayFilters: [{ "entry.ItemType": oldPath }] }
                );
        }
        if (mergedArmorIds.length != 0) {
            await db
                .collection("inventories")
                .updateOne({ _id: inventory._id }, { $pull: { WeaponSkins: { _id: { $in: mergedArmorIds } } } });
        }
        if (newHoverboard) {
            await db
                .collection("inventories")
                .updateOne(
                    { _id: inventory._id, Hoverboards: { $size: 0 }, "SpaceSuitBin.Slots": { $gt: 0 } },
                    { $push: { Hoverboards: newHoverboard }, $inc: { "SpaceSuitBin.Slots": -1 } }
                );
        }
        if (!loadout.KDRIVE?.[0]) {
            await db
                .collection("loadouts")
                .updateOne(
                    { _id: loadout._id },
                    { $push: { KDRIVE: { _id: new ObjectId(), s: { ItemId: hoverboard._id, mod: 0, cus: 0 } } } }
                );
        } else {
            await db
                .collection("loadouts")
                .updateOne(
                    { _id: loadout._id },
                    { $set: { "KDRIVE.0.s": { ItemId: hoverboard._id, mod: 0, cus: 0 } } }
                );
        }

        const repairedInventory = await db.collection("inventories").findOne({ _id: inventory._id });
        const repairedLoadout = await db.collection("loadouts").findOne({ _id: loadout._id });
        assert(
            repairedInventory.Hoverboards.some(item => String(item._id) == String(hoverboard._id)),
            "postcondition failed: hoverboard missing"
        );
        assert(
            String(repairedLoadout.KDRIVE?.[0]?.s?.ItemId) == String(hoverboard._id),
            "postcondition failed: KDRIVE suit does not reference hoverboard"
        );
        assert(
            [...FOCUS_PATHS.keys()].every(
                path => !repairedInventory.FocusUpgrades?.some(entry => entry.ItemType == path)
            ),
            "postcondition failed: obsolete Focus path remains"
        );
        assert(
            [...MERGED_ARMOR_PATHS.keys()].every(
                path => !repairedInventory.WeaponSkins?.some(entry => entry.ItemType == path)
            ),
            "postcondition failed: obsolete merged RightArmor remains"
        );
        assert(
            JSON.stringify(loadout.KDRIVE?.[0]?.p) == JSON.stringify(repairedLoadout.KDRIVE?.[0]?.p) &&
                JSON.stringify(loadout.KDRIVE?.[0]?.m) == JSON.stringify(repairedLoadout.KDRIVE?.[0]?.m),
            "postcondition failed: valid KDRIVE p/m selections changed"
        );
        console.log("ACCOUNT REPAIR PASS");
    } finally {
        await client.close();
    }
})().catch(error => {
    console.error("ACCOUNT REPAIR FAILED:", error.message);
    process.exit(1);
});
