// Fail-closed local migration for removing owned WeaponSkins and detected TennoGen FlavourItems.
// Dry-run: node scripts/migrations/reset-account-skins.cjs --email user@example.test
// Apply:   node scripts/migrations/reset-account-skins.cjs --email user@example.test --expected-count N --execute
const { MongoClient } = require("mongodb");
const { EJSON } = require("bson");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { ExportFlavour } = require("warframe-public-export-plus");

const args = process.argv.slice(2);
const value = name => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
};
const email = value("--email");
const expectedCountText = value("--expected-count");
const expectedTennogenFlavourCountText = value("--expected-tennogen-flavour-count");
const expectedSkinFlavourCountText = value("--expected-skin-flavour-count");
const execute = args.includes("--execute");
const uri = value("--uri") ?? "mongodb://127.0.0.1:27117";
const database = value("--database") ?? "openWF";
const requestedBackup = value("--backup");

if (!email) throw new Error("--email is required");
const expectedCount = expectedCountText === undefined ? undefined : Number(expectedCountText);
const expectedTennogenFlavourCount =
    expectedTennogenFlavourCountText === undefined ? undefined : Number(expectedTennogenFlavourCountText);
const expectedSkinFlavourCount =
    expectedSkinFlavourCountText === undefined ? undefined : Number(expectedSkinFlavourCountText);
if (expectedCount !== undefined && (!Number.isSafeInteger(expectedCount) || expectedCount < 0)) {
    throw new Error("--expected-count must be a non-negative integer");
}
if (
    expectedSkinFlavourCount !== undefined &&
    (!Number.isSafeInteger(expectedSkinFlavourCount) || expectedSkinFlavourCount < 0)
) {
    throw new Error("--expected-skin-flavour-count must be a non-negative integer");
}
if (
    expectedTennogenFlavourCount !== undefined &&
    (!Number.isSafeInteger(expectedTennogenFlavourCount) || expectedTennogenFlavourCount < 0)
) {
    throw new Error("--expected-tennogen-flavour-count must be a non-negative integer");
}

const tennogenPattern = /\/SW|SteamWorkshop|TennoGen|Tennogen|workshop/i;
const isTennogenFlavourItem = entry => {
    const item = ExportFlavour[entry.ItemType];
    return Boolean(item && tennogenPattern.test(`${entry.ItemType} ${typeof item.name === "string" ? item.name : ""}`));
};
const isSkinFlavourItem = entry => entry.ItemType.startsWith("/Lotus/Upgrades/Skins/");
const shouldRemoveFlavourItem = entry => isTennogenFlavourItem(entry) || isSkinFlavourItem(entry);

(async () => {
    const client = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 5000 });
    try {
        const db = client.db(database);
        const account = await db.collection("accounts").findOne({ email });
        if (!account) throw new Error(`account not found for exact email ${email}`);
        const inventory = await db.collection("inventories").findOne({ accountOwnerId: account._id });
        if (!inventory) throw new Error(`inventory not found for account ${account._id}`);

        const skins = Array.isArray(inventory.WeaponSkins) ? inventory.WeaponSkins : [];
        const flavourItems = Array.isArray(inventory.FlavourItems) ? inventory.FlavourItems : [];
        const tennogenFlavourItems = flavourItems.filter(isTennogenFlavourItem);
        const skinFlavourItems = flavourItems.filter(isSkinFlavourItem);
        const removableFlavourItems = flavourItems.filter(shouldRemoveFlavourItem);
        if (expectedCount !== undefined && skins.length !== expectedCount) {
            throw new Error(
                `WeaponSkins count changed: expected ${expectedCount}, found ${skins.length}; refusing mutation`
            );
        }
        if (
            expectedTennogenFlavourCount !== undefined &&
            tennogenFlavourItems.length !== expectedTennogenFlavourCount
        ) {
            throw new Error(
                `TennoGen FlavourItems count changed: expected ${expectedTennogenFlavourCount}, found ${tennogenFlavourItems.length}; refusing mutation`
            );
        }
        if (expectedSkinFlavourCount !== undefined && skinFlavourItems.length !== expectedSkinFlavourCount) {
            throw new Error(
                `skin-path FlavourItems count changed: expected ${expectedSkinFlavourCount}, found ${skinFlavourItems.length}; refusing mutation`
            );
        }

        const stamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
        const backupPath = path.resolve(
            requestedBackup ??
                path.join(
                    __dirname,
                    "..",
                    "..",
                    "RESEARCH",
                    "ZORBA_COMPLETE_COSMETICS_AND_BARTEK_RESET_2026-09-10",
                    "backups",
                    `account-skins-${stamp}.ejson.json`
                )
        );
        fs.mkdirSync(path.dirname(backupPath), { recursive: true });
        const payload = EJSON.stringify(
            {
                account: { _id: account._id, email: account.email, DisplayName: account.DisplayName },
                inventory: {
                    _id: inventory._id,
                    accountOwnerId: inventory.accountOwnerId,
                    WeaponSkins: skins,
                    FlavourItems: flavourItems,
                    DetectedTennogenFlavourItems: tennogenFlavourItems,
                    DetectedSkinFlavourItems: skinFlavourItems,
                    RemovableFlavourItems: removableFlavourItems
                }
            },
            { relaxed: false, indent: 2 }
        );
        fs.writeFileSync(backupPath, payload + "\n", { encoding: "utf8", flag: "wx" });
        const backupSha256 = crypto.createHash("sha256").update(fs.readFileSync(backupPath)).digest("hex");

        let modified = 0;
        if (execute) {
            const result = await db
                .collection("inventories")
                .updateOne(
                    { _id: inventory._id },
                    { $set: { WeaponSkins: [], FlavourItems: flavourItems.filter(x => !shouldRemoveFlavourItem(x)) } }
                );
            const shouldModify = skins.length !== 0 || removableFlavourItems.length !== 0;
            if (result.matchedCount !== 1 || result.modifiedCount !== (shouldModify ? 1 : 0)) {
                throw new Error(
                    `unexpected update result matched=${result.matchedCount} modified=${result.modifiedCount}`
                );
            }
            modified = result.modifiedCount;
        }

        const after = await db
            .collection("inventories")
            .findOne({ _id: inventory._id }, { projection: { WeaponSkins: 1, FlavourItems: 1 } });
        const afterCount = Array.isArray(after?.WeaponSkins) ? after.WeaponSkins.length : 0;
        const afterFlavourItems = Array.isArray(after?.FlavourItems) ? after.FlavourItems : [];
        const afterTennogenFlavourCount = afterFlavourItems.filter(isTennogenFlavourItem).length;
        const afterSkinFlavourCount = afterFlavourItems.filter(isSkinFlavourItem).length;
        if (execute && afterCount !== 0) throw new Error(`postcondition failed: ${afterCount} WeaponSkins remain`);
        if (execute && afterTennogenFlavourCount !== 0) {
            throw new Error(`postcondition failed: ${afterTennogenFlavourCount} TennoGen FlavourItems remain`);
        }
        if (execute && afterSkinFlavourCount !== 0) {
            throw new Error(`postcondition failed: ${afterSkinFlavourCount} skin-path FlavourItems remain`);
        }

        console.log(
            JSON.stringify(
                {
                    mode: execute ? "execute" : "dry-run",
                    accountId: account._id.toHexString(),
                    email: account.email,
                    displayName: account.DisplayName,
                    beforeCount: skins.length,
                    afterCount,
                    tennogenFlavourBeforeCount: tennogenFlavourItems.length,
                    tennogenFlavourAfterCount: afterTennogenFlavourCount,
                    skinFlavourBeforeCount: skinFlavourItems.length,
                    skinFlavourAfterCount: afterSkinFlavourCount,
                    removableFlavourBeforeCount: removableFlavourItems.length,
                    flavourItemsBeforeCount: flavourItems.length,
                    flavourItemsAfterCount: afterFlavourItems.length,
                    modified,
                    backupPath,
                    backupSha256
                },
                null,
                2
            )
        );
    } finally {
        await client.close();
    }
})().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
