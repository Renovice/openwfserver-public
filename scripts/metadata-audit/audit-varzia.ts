// Prime Resurgence (Varzia) audit.
// 1. The export derivation rules in varziaService reproduce every hand table entry in constants/varzia.ts,
//    except the deviations listed below (the hand table stays authoritative for those packs).
// 2. Every Mega Prime Vault dual pack in the current export is offered, with existing single packs,
//    relics, bobbleheads and items.
// 3. The weekly rotation offers a pack exactly when getVarziaManifest has a manifest for it.
import assert from "node:assert/strict";
import {
    ExportBundles,
    ExportCustoms,
    ExportFlavour,
    ExportRelics,
    ExportResources,
    ExportSentinels,
    ExportWarframes,
    ExportWeapons
} from "warframe-public-export-plus";
import varzia from "../../src/constants/varzia.ts";
import gameToBuildVersionInt from "../../src/constants/gameToBuildVersionInt.ts";
import { buildVersionToInt } from "../../src/helpers/versionHelper.ts";
import { generatedClientBuildVersion } from "../../src/services/generatedMetadataService.ts";
import { fromStoreItem } from "../../src/services/itemDataService.ts";
import {
    deriveVarziaDualPack,
    deriveVarziaSinglePack,
    getAllVarziaManifests,
    getVarziaDualPacks,
    getVarziaManifest,
    getVarziaPrimePrice,
    getVarziaRotation
} from "../../src/services/varziaService.ts";

const mpv = "/Lotus/Types/StoreItems/Packages/MegaPrimeVault/";
const lastChanceItem = "/Lotus/StoreItems/Types/StoreItems/Packages/MegaPrimeVault/LastChanceItemC";

// Known differences between the hand table and the export derivation (hand table wins).
// Item sets: none. The Hildryn (MPVLarkspurGravimag) and Gauss (alt helmet, plush) packs follow the export since
// 2026-10-04 (user decision: DE's data). Prices: the exports carry none; the table prices are DE's live values and
// the derivation rule is a reconstruction, so these three keep the table price.
const expectedItemSetDeviations: Record<string, string> = {};
const expectedPriceDeviations: Record<string, number> = {
    "/Lotus/StoreItems/Upgrades/Skins/MeleeDangles/SurakaPrimeDangle": 2, // rule: 1 (other melee dangles are 1)
    [mpv + "MPVAtavistPrimeArmorSet"]: 1, // rule: 2 (other armor sets are 2)
    [mpv + "MPVHeimtPrimeSentAccessories"]: 2 // rule: 1 (other sentinel accessory sets are 1)
};
const expectedOrderDeviations = new Set([
    mpv + "MPVNezhaOctaviaPrimeDualPack", // table relics: T1 B before T1 A
    mpv + "MPVMesaLimboPrimeDualPack", // table relics: T1 B before T1 A
    mpv + "MPVFrostMagPrimeDualPack", // table single packs: Mag, Frost
    mpv + "MPVMagRhinoPrimeDualPack", // table single packs: Rhino, Mag
    mpv + "MPVEquinoxPrimeSinglePack" // table bobbleheads: Night before Day
]);

let checks = 0;
const check = (condition: boolean, message: string): void => {
    checks++;
    assert.ok(condition, message);
};
const sameSet = (a: string[], b: string[]): boolean => a.length == b.length && a.every(x => b.includes(x));
const sameList = (a: string[], b: string[]): boolean => a.length == b.length && a.every((x, i) => b[i] == x);

const itemTables: Record<string, unknown>[] = [
    ExportBundles,
    ExportWarframes,
    ExportWeapons,
    ExportSentinels,
    ExportCustoms,
    ExportFlavour,
    ExportResources
];
const isKnownItem = (itemType: string): boolean =>
    itemTables.some(table => itemType in table || fromStoreItem(itemType) in table);

// 1. Derivation rules against the hand table.
let orderDeviations = 0;
let itemSetDeviations = 0;
let priceDeviations = 0;
let tableItems = 0;
for (const [dualPack, entry] of Object.entries(varzia.primeDualPacks)) {
    const derived = deriveVarziaDualPack(dualPack);
    check(derived !== undefined, `cannot derive table dual pack ${dualPack}`);
    check(sameSet(derived!.SinglePacks, entry.SinglePacks), `single packs differ for ${dualPack}`);
    check(sameSet(derived!.Relics, entry.Relics), `relics differ for ${dualPack}`);
    if (!sameList(derived!.SinglePacks, entry.SinglePacks) || !sameList(derived!.Relics, entry.Relics)) {
        orderDeviations++;
        check(expectedOrderDeviations.has(dualPack), `unexpected order difference for ${dualPack}`);
    }
}
for (const [singlePack, entry] of Object.entries(varzia.primeSinglePacks)) {
    const derived = deriveVarziaSinglePack(singlePack);
    check(derived !== undefined, `cannot derive table single pack ${singlePack}`);
    check(sameSet(derived!.BobbleHeads, entry.BobbleHeads), `bobbleheads differ for ${singlePack}`);
    if (!sameList(derived!.BobbleHeads, entry.BobbleHeads)) {
        orderDeviations++;
        check(expectedOrderDeviations.has(singlePack), `unexpected bobblehead order for ${singlePack}`);
    }
    const tableItemTypes = entry.Items.map(x => x.ItemType);
    if (
        !sameSet(
            derived!.Items.map(x => x.ItemType),
            tableItemTypes
        )
    ) {
        itemSetDeviations++;
        check(singlePack in expectedItemSetDeviations, `unexpected item set difference for ${singlePack}`);
    }
    for (const item of entry.Items) {
        tableItems++;
        check(item.PrimePrice !== undefined, `table item without aya price ${item.ItemType}`);
        if (getVarziaPrimePrice(item.ItemType) != item.PrimePrice) {
            priceDeviations++;
            check(
                expectedPriceDeviations[item.ItemType] === item.PrimePrice,
                `unexpected price rule mismatch for ${item.ItemType}: table ${item.PrimePrice}, rule ${getVarziaPrimePrice(item.ItemType)}`
            );
        }
    }
}
check(itemSetDeviations == Object.keys(expectedItemSetDeviations).length, "stale item set deviation list");
check(priceDeviations == Object.keys(expectedPriceDeviations).length, "stale price deviation list");
check(orderDeviations == expectedOrderDeviations.size, "stale order deviation list");

// 2. Every current dual pack is offered with resolvable contents.
check(generatedClientBuildVersion !== undefined, "generated metadata has no client build");
const currentBuild = buildVersionToInt(generatedClientBuildVersion!);
const dualPacks = getVarziaDualPacks();
const exportDualPacks = Object.keys(ExportBundles).filter(x => /\/MegaPrimeVault\/MPV[A-Za-z]+PrimeDualPack$/.test(x));
check(exportDualPacks.length > 0, "no Mega Prime Vault dual packs in ExportBundles");
for (const dualPack of exportDualPacks) {
    check(dualPack in dualPacks, `dual pack not offered: ${dualPack}`);
}
const all = getAllVarziaManifests(currentBuild);
const offered = all.map(x => x.ItemType);
check(new Set(offered).size == offered.length, "duplicate Varzia offers");
for (const [dualPack, entry] of Object.entries(dualPacks)) {
    check(entry.minBuildVersionInt <= currentBuild, `dual pack not available to the current client: ${dualPack}`);
    check(offered.includes(dualPack), `getAllVarziaManifests misses ${dualPack}`);
    check(entry.SinglePacks.length == 2, `dual pack needs two single packs: ${dualPack}`);
    for (const relic of entry.Relics) {
        check(fromStoreItem(relic) in ExportRelics, `unknown relic ${relic}`);
    }
    for (const singlePack of entry.SinglePacks) {
        check(singlePack in ExportBundles, `unknown single pack ${singlePack}`);
    }
    const manifest = getVarziaManifest(dualPack, currentBuild);
    check(manifest[1].ItemType == dualPack, `manifest does not feature ${dualPack}`);
    for (const offer of manifest) {
        check(
            isKnownItem(offer.ItemType) || fromStoreItem(offer.ItemType) in ExportRelics,
            `unknown offer ${offer.ItemType}`
        );
        check(offered.includes(offer.ItemType), `getAllVarziaManifests misses ${offer.ItemType}`);
    }
}

// Protea Prime + Ivara Prime (first pack added only by the export derivation).
const proteaIvara = mpv + "MPVProteaIvaraPrimeDualPack";
check(!(proteaIvara in varzia.primeDualPacks), "Protea/Ivara must come from the export derivation");
check(
    sameList(dualPacks[proteaIvara].SinglePacks, [mpv + "MPVProteaPrimeSinglePack", mpv + "MPVIvaraPrimeSinglePack"]),
    "Protea/Ivara single packs"
);
check(dualPacks[proteaIvara].Relics.length == 6, "Protea/Ivara vault relics");
const proteaIvaraManifest = getVarziaManifest(proteaIvara, currentBuild);
for (const [itemType, price] of [
    ["/Lotus/StoreItems/Powersuits/Odalisk/ProteaPrime", 3],
    ["/Lotus/StoreItems/Powersuits/Ranger/IvaraPrime", 3],
    ["/Lotus/StoreItems/Weapons/Tenno/Pistols/PrimeVelox/PrimeVeloxPistol", 2],
    ["/Lotus/StoreItems/Weapons/Tenno/Melee/Swords/PrimeOkina/PrimeOkina", 2],
    ["/Lotus/StoreItems/Types/Items/ShipDecos/ProteaPrimeBobbleHead", 1]
] as const) {
    check(
        proteaIvaraManifest.some(x => x.ItemType == itemType && x.PrimePrice == price),
        `Protea/Ivara manifest misses ${itemType} at ${price}`
    );
}
check(
    proteaIvaraManifest.some(
        x => x.ItemType == "/Lotus/StoreItems/Types/Game/Projections/T1VoidProjectionProteaIvaraVaultABronze"
    ),
    "Protea/Ivara manifest misses its T1 vault relic"
);

// 3. Rotation and manifest agree on availability.
for (const buildVersion of [currentBuild, gameToBuildVersionInt["31.0.0"], gameToBuildVersionInt["31.0.0"] - 1]) {
    for (let week = 0; week != 300; ++week) {
        const rotation = getVarziaRotation(week, buildVersion);
        const manifest = getVarziaManifest(rotation, buildVersion);
        check(
            rotation == lastChanceItem ? manifest.length == 0 : manifest.length > 0,
            `rotation/manifest disagree in week ${week} for build ${buildVersion}`
        );
        if (buildVersion == currentBuild) {
            check(rotation != lastChanceItem, `current client gets no pack in week ${week}`);
        }
    }
}

console.log(
    `Varzia audit passed: ${checks} checks; ${Object.keys(dualPacks).length} dual packs ` +
        `(${Object.keys(varzia.primeDualPacks).length} hand table, ${Object.keys(dualPacks).length - Object.keys(varzia.primeDualPacks).length} derived); ` +
        `${all.length} offers; price rule ${tableItems - priceDeviations}/${tableItems} table items; ` +
        `documented deviations: ${itemSetDeviations} item sets, ${priceDeviations} prices, ${orderDeviations} orders`
);
