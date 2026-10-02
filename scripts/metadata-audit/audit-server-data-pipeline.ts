/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
    applyCurrentSyndicateCorrections,
    applyPublicExportRewardCorrections
} from "../../src/constants/publicExportCorrections.ts";

type TRecord = Record<string, any>;
type TIssue = { severity: "Error" | "Warning" | "Info"; code: string; message: string; path?: string };

const option = (name: string): string | undefined => {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 ? process.argv[index + 1] : undefined;
};
const root = process.cwd();
const exportDirectory = path.resolve(
    option("public-export") ?? path.join(root, "node_modules/warframe-public-export-plus")
);
const generatedPath = path.resolve(
    option("generated") ?? path.join(root, "static/generated/openwf-metadata/challenge-metadata.json")
);
const acquisitionPath = path.resolve(
    option("acquisition") ?? path.join(root, "tmp/audits/complete-item-acquisition-classified.json")
);
const officialDropPath = path.resolve(
    option("official-drops") ?? path.join(root, "static/generated/openwf-metadata/official-drop-tables-2026-09-10.html")
);
const nonStoreAcquisitionPath = path.resolve(
    option("non-store-acquisition") ?? path.join(root, "tmp/audits/non-store-acquisition-audit.json")
);
const generatedCommercePath = path.resolve(
    option("generated-commerce") ?? path.join(root, "tmp/audits/generated-commerce-audit.json")
);
const generatedVendorRuntimePath = path.resolve(
    option("generated-vendors") ?? path.join(root, "tmp/audits/generated-vendor-runtime-audit.json")
);
const currentDatafileRuntimePath = path.resolve(
    option("current-datafiles") ?? path.join(root, "tmp/audits/current-datafile-runtime-audit.json")
);
const outputPath = path.resolve(option("output") ?? path.join(root, "tmp/audits/server-data-pipeline-audit.json"));

const readJson = <T = TRecord>(file: string): T => JSON.parse(fs.readFileSync(file, "utf8")) as T;
const sha256 = (buffer: Buffer | string): string => createHash("sha256").update(buffer).digest("hex");
const countBy = (values: string[]): Record<string, number> =>
    Object.fromEntries(
        Object.entries(
            values.reduce<Record<string, number>>((out, value) => ((out[value] = (out[value] ?? 0) + 1), out), {})
        ).sort(([a], [b]) => a.localeCompare(b))
    );
const unique = <T>(values: T[]): T[] => [...new Set(values)];
const objects = (value: unknown): TRecord[] =>
    value && typeof value == "object" && !Array.isArray(value) ? Object.values(value as TRecord) : [];
const lotusPaths = (value: unknown, result: string[] = []): string[] => {
    if (typeof value == "string") {
        if (value.startsWith("/Lotus/")) result.push(value);
    } else if (Array.isArray(value)) {
        for (const entry of value) lotusPaths(entry, result);
    } else if (value && typeof value == "object") {
        for (const [key, entry] of Object.entries(value)) {
            if (key.startsWith("/Lotus/")) result.push(key);
            lotusPaths(entry, result);
        }
    }
    return result;
};

const issues: TIssue[] = [];
const issue = (severity: TIssue["severity"], code: string, message: string, issuePath?: string): void => {
    issues.push({ severity, code, message, path: issuePath });
};

const packageJsonPath = path.join(exportDirectory, "package.json");
const packageJson = readJson<TRecord>(packageJsonPath);
const tableFiles = fs
    .readdirSync(exportDirectory)
    .filter(name => /^Export.+\.json$/.test(name))
    .sort();
const tables: Record<string, TRecord> = {};
const tableManifest = tableFiles.map(name => {
    const file = path.join(exportDirectory, name);
    const bytes = fs.readFileSync(file);
    const data = JSON.parse(bytes.toString("utf8")) as TRecord;
    tables[name] = data;
    return {
        name,
        bytes: bytes.length,
        sha256: sha256(bytes),
        topLevelKind: Array.isArray(data) ? "array" : "object",
        topLevelCount: Array.isArray(data) ? data.length : Object.keys(data).length
    };
});
if (tableFiles.length == 0) issue("Error", "EXPORT_TABLES_EMPTY", "No Export*.json files were found.", exportDirectory);
const currentExportPath = path.join(path.dirname(generatedPath), "current-public-export.json");
if (fs.existsSync(currentExportPath)) {
    const supplements = readJson<TRecord>(currentExportPath);
    for (const [name, rows] of Object.entries(supplements.datasets as TRecord)) {
        tables[`${name}.json`] = { ...(rows as TRecord), ...(tables[`${name}.json`] ?? {}) };
    }
}

const generated = readJson<TRecord>(generatedPath);
const generatedItems = (generated.generatedItems ?? {}) as TRecord;
const generatedCosmetics = (generated.generatedCosmetics ?? {}) as TRecord;
const generatedBundles = (generated.generatedBundles ?? {}) as TRecord;
const generatedVendors = (generated.generatedVendors ?? {}) as TRecord;
const generatedSyndicates = (generated.generatedNightwaveSyndicates ?? {}) as TRecord;
const generatedSyndicateFavours = (generated.generatedSyndicateFavours ?? {}) as TRecord;
const generatedDojoRecipes = (generated.generatedDojoRecipes ?? {}) as TRecord;
const registryStoreItems = new Map<string, string>(
    Object.entries(generatedItems).map(([typeName, item]) => [(item as TRecord).storeItem as string, typeName])
);
const acquisition = readJson<TRecord>(acquisitionPath);
const acquisitionByStoreItem = new Map<string, TRecord>(
    ((acquisition.results ?? []) as TRecord[]).map(result => [result.storeItem as string, result])
);
const acquisitionByTypeName = new Map<string, TRecord>(
    ((acquisition.results ?? []) as TRecord[]).map(result => [result.typeName as string, result])
);
const acquisitionSummary = acquisition.summary as TRecord;
if ((acquisitionSummary.failed as number) != 0 || (acquisitionSummary.noInventoryDelta as number) != 0) {
    issue(
        "Error",
        "ITEM_ACQUISITION_UNCLASSIFIED",
        `Acquisition audit has ${String(acquisitionSummary.failed)} failures and ${String(acquisitionSummary.noInventoryDelta)} empty results.`,
        acquisitionPath
    );
}
const nonStoreAcquisition = readJson<TRecord>(nonStoreAcquisitionPath);
const nonStoreAcquisitionSummary = nonStoreAcquisition.summary as TRecord;
const nonStoreAcquisitionByTypeName = new Map<string, TRecord>(
    ((nonStoreAcquisition.results ?? []) as TRecord[]).map(result => [result.typeName as string, result])
);
if ((nonStoreAcquisitionSummary.failed as number) != 0) {
    issue(
        "Error",
        "NON_STORE_ACQUISITION_FAILED",
        `${String(nonStoreAcquisitionSummary.failed)} bundle or unwrapped-resource acquisitions failed.`,
        nonStoreAcquisitionPath
    );
}
const generatedCommerce = readJson<TRecord>(generatedCommercePath);
const generatedCommerceSummary = generatedCommerce.summary as TRecord;
if ((generatedCommerceSummary.failed as number) != 0) {
    issue(
        "Error",
        "GENERATED_COMMERCE_FAILED",
        `${String(generatedCommerceSummary.failed)} generated name, category, or price lookups failed.`,
        generatedCommercePath
    );
}
const generatedVendorRuntime = readJson<TRecord>(generatedVendorRuntimePath);
const generatedVendorRuntimeSummary = generatedVendorRuntime.summary as TRecord;
if ((generatedVendorRuntimeSummary.failed as number) != 0) {
    issue(
        "Error",
        "GENERATED_VENDOR_RUNTIME_FAILED",
        `${String(generatedVendorRuntimeSummary.failed)} generated vendor runtime checks failed.`,
        generatedVendorRuntimePath
    );
}
const currentDatafileRuntime = readJson<TRecord>(currentDatafileRuntimePath);
const currentDatafileRuntimeSummary = currentDatafileRuntime.summary as TRecord;
if ((currentDatafileRuntimeSummary.failed as number) != 0) {
    issue(
        "Error",
        "CURRENT_DATAFILE_RUNTIME_FAILED",
        `${String(currentDatafileRuntimeSummary.failed)} current syndicate or Dojo runtime checks failed.`,
        currentDatafileRuntimePath
    );
}

const acquisitionStatusForPath = (itemPath: string): string => {
    const direct = acquisitionByTypeName.get(itemPath) ?? acquisitionByStoreItem.get(itemPath);
    if (direct) return String(direct.status);
    const nonStore = nonStoreAcquisitionByTypeName.get(itemPath);
    if (nonStore) return String(nonStore.status);
    if (itemPath.startsWith("/Lotus/StoreItems/")) {
        const typeName = registryStoreItems.get(itemPath);
        if (typeName) return String(acquisitionByTypeName.get(typeName)?.status ?? "Unclassified");
        const mirrored = `/Lotus/${itemPath.slice("/Lotus/StoreItems/".length)}`;
        const mirroredNonStore = nonStoreAcquisitionByTypeName.get(mirrored);
        if (mirroredNonStore) return String(mirroredNonStore.status);
    }
    return "Unclassified";
};

const unresolvedEnemyDropPath = "/Lotus/RESOLUTION_FAILURE/Region Resource";
const missionRuntimePickupPaths = new Set([
    "/Lotus/Types/Gameplay/1999Wf/PvPvE/Objectives/ExcavatorCellItem",
    "/Lotus/Types/PickUps/ExcavatorCellItem",
    "/Lotus/Types/PickUps/InfestedLichChipItem"
]);
const enemyDropStatusForPath = (itemPath: string): string => {
    if (itemPath == unresolvedEnemyDropPath) return "RejectedUnresolvedSourceReference";
    if (missionRuntimePickupPaths.has(itemPath)) return "MissionRuntimePickup";
    return acquisitionStatusForPath(itemPath);
};

const exportVendors = tables["ExportVendors.json"] ?? {};
const exportBundles = tables["ExportBundles.json"] ?? {};
const allVendors = { ...exportVendors, ...generatedVendors };
const vendorOffers: TRecord[] = [];
const vendorMissingRegistry: { vendor: string; storeItem: string }[] = [];
const vendorUnclassifiedAcquisition: { vendor: string; storeItem: string }[] = [];
const vendorPriceKinds: string[] = [];
const vendorCurrencyPaths: string[] = [];
const vendorAcquisitionStatuses: string[] = [];
const contextualVendorItems = (storeItem: string): boolean =>
    storeItem == "/Lotus/StoreItems/Types/Items/DummyPurchasingItem" ||
    storeItem.startsWith("/Lotus/StoreItems/Types/Items/Guild/GuildAdvertisement");
// Exact U44 development definitions: both use [HC] placeholder localization;
// KuvaKeyTest explicitly says it uses 'kk' global overrides for testing.
// They remain reported, never counted as supported purchasable inventory.
const definitionOnlyVendorItems = new Set([
    "/Lotus/StoreItems/Types/Items/KuvaKeys/KuvaKeyOne",
    "/Lotus/StoreItems/Types/Items/KuvaKeys/KuvaKeyTest"
]);
const vendorDefinitionOnly: { vendor: string; storeItem: string }[] = [];
for (const [vendorPath, vendor] of Object.entries(allVendors)) {
    for (const offer of ((vendor as TRecord).items ?? []) as TRecord[]) {
        vendorOffers.push(offer);
        const storeItem = String(offer.storeItem ?? "");
        const developmentDefinition =
            vendorPath == "/Lotus/Types/Game/VendorManifests/KuvaKeys/KuvaKeysVendorManifest" &&
            definitionOnlyVendorItems.has(storeItem);
        if (developmentDefinition) {
            vendorDefinitionOnly.push({ vendor: vendorPath, storeItem });
            issue(
                "Warning",
                "DEVELOPMENT_VENDOR_DEFINITION",
                "Client development KuvaKey definition; no supported purchase or released gameplay contract.",
                storeItem
            );
        }
        vendorAcquisitionStatuses.push(
            developmentDefinition
                ? "DefinitionOnly"
                : contextualVendorItems(storeItem)
                  ? "RequiresAcquisitionContext"
                  : acquisitionStatusForPath(storeItem)
        );
        if (!storeItem.startsWith("/Lotus/StoreItems/") && !storeItem.startsWith("/Lotus/Types/StoreItems/")) {
            issue(
                "Error",
                "VENDOR_OFFER_PATH_INVALID",
                "Vendor offer is not a StoreItem path.",
                `${vendorPath}:${storeItem}`
            );
        }
        const inventoryType =
            registryStoreItems.get(storeItem) ?? (storeItem in generatedItems ? storeItem : undefined);
        const acquisitionRecord = inventoryType
            ? acquisitionByStoreItem.get(String((generatedItems[inventoryType] as TRecord).storeItem))
            : undefined;
        if (
            !inventoryType &&
            !(storeItem in exportBundles) &&
            !(storeItem in generatedBundles) &&
            !contextualVendorItems(storeItem) &&
            !developmentDefinition
        ) {
            vendorMissingRegistry.push({ vendor: vendorPath, storeItem });
        } else if (
            inventoryType &&
            !acquisitionRecord &&
            !(storeItem in exportBundles) &&
            !(storeItem in generatedBundles) &&
            !contextualVendorItems(storeItem)
        ) {
            vendorUnclassifiedAcquisition.push({ vendor: vendorPath, storeItem });
        }
        const kinds: string[] = [];
        if (Number(offer.credits) > 0) kinds.push("Credits");
        if (Number(offer.platinum) > 0) kinds.push("Platinum");
        if (Array.isArray(offer.itemPrices) && offer.itemPrices.length != 0) kinds.push("Items");
        if (offer.syndicate && Number((offer.syndicate as TRecord).standingCost) > 0) kinds.push("Standing");
        if (offer.focusXpCost) kinds.push("FocusXp");
        if (Number(offer.numRandomItemPrices) > 0) kinds.push("RandomItems");
        vendorPriceKinds.push(kinds.length == 0 ? "NoExplicitPrice" : kinds.sort().join("+"));
        for (const price of (offer.itemPrices ?? []) as TRecord[]) {
            if (Number(price.ItemCount) <= 0 || !String(price.ItemType).startsWith("/Lotus/")) {
                issue(
                    "Error",
                    "VENDOR_ITEM_PRICE_INVALID",
                    "Vendor item price is malformed.",
                    `${vendorPath}:${storeItem}`
                );
            }
            vendorCurrencyPaths.push(String(price.ItemType));
        }
    }
}

const exportSyndicates = tables["ExportSyndicates.json"] ?? {};
const syndicateCorrections = applyCurrentSyndicateCorrections(exportSyndicates);
const syndicates = { ...exportSyndicates } as TRecord;
for (const [tag, syndicate] of Object.entries(generatedSyndicates)) {
    syndicates[tag] = {
        ...(exportSyndicates[(syndicate as TRecord).templateTag] ?? {}),
        ...syndicate,
        favours: ((generatedSyndicateFavours[tag] as TRecord | undefined)?.favours ??
            exportSyndicates[(syndicate as TRecord).templateTag]?.favours ??
            []) as TRecord[]
    };
}
for (const [tag, current] of Object.entries(generatedSyndicateFavours)) {
    const existing = syndicates[tag] as TRecord | undefined;
    if (!existing) {
        issue("Error", "CURRENT_SYNDICATE_MISSING", "Current favour data has no server syndicate definition.", tag);
        continue;
    }
    if (existing.uniqueName != (current as TRecord).uniqueName) {
        issue("Error", "CURRENT_SYNDICATE_IDENTITY_MISMATCH", "Current syndicate identity does not match.", tag);
        continue;
    }
    existing.favours = (current as TRecord).favours;
}
let syndicateTitles = 0;
let syndicateInvalidTitles = 0;
const syndicateFavourStatuses: string[] = [];
const syndicateSacrificeStatuses: string[] = [];
const syndicateMedallionStatuses: string[] = [];
const syndicatePaths = unique(lotusPaths(syndicates));
for (const [tag, syndicate] of Object.entries(syndicates)) {
    const data = syndicate as TRecord;
    const titles = ((syndicate as TRecord).titles ?? []) as TRecord[];
    syndicateTitles += titles.length;
    const levels = titles.map(title => Number(title.level));
    const invalid =
        new Set(levels).size != levels.length ||
        titles.some(
            title => !Number.isFinite(Number(title.minStanding)) || !Number.isFinite(Number(title.maxStanding))
        );
    if (invalid) {
        syndicateInvalidTitles++;
        issue("Error", "SYNDICATE_TITLES_INVALID", "Syndicate ranks are duplicated or have invalid thresholds.", tag);
    }
    for (const favour of (data.favours ?? []) as TRecord[]) {
        syndicateFavourStatuses.push(acquisitionStatusForPath(String(favour.storeItem ?? "")));
    }
    for (const sacrifice of [data.initiationSacrifice, ...titles.map(title => title.sacrifice)].filter(
        Boolean
    ) as TRecord[]) {
        for (const item of (sacrifice.items ?? []) as TRecord[]) {
            syndicateSacrificeStatuses.push(acquisitionStatusForPath(String(item.ItemType ?? "")));
        }
    }
    for (const medallion of (data.medallions ?? []) as TRecord[]) {
        syndicateMedallionStatuses.push(acquisitionStatusForPath(String(medallion.itemType ?? "")));
    }
}

const missionTypes = tables["ExportMissionTypes.json"] ?? {};
const regions = tables["ExportRegions.json"] ?? {};
const rewardTables = tables["ExportRewards.json"] ?? {};
const rewardCorrections = applyPublicExportRewardCorrections(rewardTables);
const missingMissionTypes: { node: string; missionType: string }[] = [];
const missingRewardManifests: { node: string; rewardManifest: string }[] = [];
for (const [node, region] of Object.entries(regions)) {
    const missionType = String((region as TRecord).missionType ?? "");
    if (!(missionType in missionTypes)) missingMissionTypes.push({ node, missionType });
    for (const manifest of [
        ...(((region as TRecord).rewardManifests ?? []) as string[]),
        ...(((region as TRecord).cacheRewardManifest ? [(region as TRecord).cacheRewardManifest] : []) as string[])
    ]) {
        if (!(manifest in rewardTables)) missingRewardManifests.push({ node, rewardManifest: manifest });
    }
}

let rewardRotations = 0;
let rewardEntries = 0;
let invalidRewardEntries = 0;
const probabilityGroupMismatches: { manifest: string; rotation: number; sum: number; entries: number }[] = [];
const probabilityGroupSemantics: {
    manifest: string;
    rotation: number;
    sum: number;
    entries: number;
    classification: "RoundedCategoricalPool" | "ConditionalNoDrop" | "CategoricalPoolPlusGuaranteedRewards";
}[] = [];
const rewardStoreItems = new Set<string>();
const rewardMissingRegistry = new Set<string>();
for (const [manifest, rotationsRaw] of Object.entries(rewardTables)) {
    if (!Array.isArray(rotationsRaw)) {
        issue("Error", "REWARD_TABLE_INVALID", "Reward manifest is not an array of rotations.", manifest);
        continue;
    }
    for (const [rotationIndex, rotation] of (rotationsRaw as unknown[]).entries()) {
        if (!Array.isArray(rotation)) {
            invalidRewardEntries++;
            continue;
        }
        rewardRotations++;
        let sum = 0;
        let probabilityEntries = 0;
        for (const reward of rotation as TRecord[]) {
            rewardEntries++;
            const type = String(reward.type ?? "");
            const probability = Number(reward.probability);
            const hasProbability = reward.probability != undefined && probability >= 0 && probability <= 1;
            const hasRarity = ["COMMON", "UNCOMMON", "RARE", "LEGENDARY"].includes(String(reward.rarity));
            if (hasProbability) {
                sum += probability;
                probabilityEntries++;
            }
            if (!type.startsWith("/Lotus/") || !(Number(reward.itemCount) > 0) || (!hasProbability && !hasRarity)) {
                invalidRewardEntries++;
            }
            if (type.startsWith("/Lotus/StoreItems/")) {
                rewardStoreItems.add(type);
                if (!registryStoreItems.has(type) && !(type in generatedBundles)) rewardMissingRegistry.add(type);
            }
        }
        if (rotation.length != 0 && probabilityEntries == rotation.length) {
            const roundedSum = Number(sum.toFixed(12));
            const roundingTolerance = rotation.length * 0.00005 + 1e-9;
            const guaranteedRewards = (rotation as TRecord[]).filter(reward => Number(reward.probability) == 1).length;
            const classification =
                Math.abs(sum - 1) <= roundingTolerance
                    ? "RoundedCategoricalPool"
                    : sum < 1
                      ? "ConditionalNoDrop"
                      : guaranteedRewards > 0 && Math.abs(sum - guaranteedRewards - 1) <= roundingTolerance
                        ? "CategoricalPoolPlusGuaranteedRewards"
                        : undefined;
            if (classification) {
                if (Math.abs(sum - 1) > 0.0025) {
                    probabilityGroupSemantics.push({
                        manifest,
                        rotation: rotationIndex,
                        sum: roundedSum,
                        entries: rotation.length,
                        classification
                    });
                }
            } else if (Math.abs(sum - 1) > 0.0025) {
                probabilityGroupMismatches.push({
                    manifest,
                    rotation: rotationIndex,
                    sum: roundedSum,
                    entries: rotation.length
                });
            }
        }
    }
}
const rewardAcquisitionStatuses = countBy([...rewardStoreItems].map(acquisitionStatusForPath));

const enemies = tables["ExportEnemies.json"] ?? {};
const enemyAgents = (enemies.agents ?? {}) as TRecord;
const enemyAvatars = (enemies.avatars ?? {}) as TRecord;
const enemyDamageControllers = (enemies.damageControllers ?? {}) as TRecord;
const enemyDropTables = (enemies.droptables ?? {}) as TRecord;
let enemyDropPools = 0;
let enemyDropEntries = 0;
let invalidEnemyDropEntries = 0;
let missingEnemyDropTables = 0;
let missingEnemyDamageControllers = 0;
const enemyDropAcquisitionStatuses: string[] = [];
const enemyDropSpecialPaths = new Map<string, { status: string; occurrences: number }>();
for (const [avatarPath, avatar] of Object.entries(enemyAvatars)) {
    const data = avatar as TRecord;
    const dropTable = String(data.droptable ?? "");
    if (dropTable && !(dropTable in enemyDropTables)) {
        missingEnemyDropTables++;
        issue("Error", "ENEMY_DROP_TABLE_MISSING", "Enemy avatar references an unknown drop table.", avatarPath);
    }
    const damageController = String(data.damageController ?? "");
    if (damageController && !(damageController in enemyDamageControllers)) {
        missingEnemyDamageControllers++;
        issue(
            "Error",
            "ENEMY_DAMAGE_CONTROLLER_MISSING",
            "Enemy avatar references an unknown damage controller.",
            avatarPath
        );
    }
}
for (const [dropTablePath, pools] of Object.entries(enemyDropTables)) {
    if (!Array.isArray(pools)) {
        issue("Error", "ENEMY_DROP_TABLE_INVALID", "Enemy drop table is not an array.", dropTablePath);
        continue;
    }
    for (const pool of pools as TRecord[]) {
        enemyDropPools++;
        const chance = Number(pool.chance);
        const entries = (pool.items ?? []) as TRecord[];
        // The pool-level field is a roll/count value in some tables (for example Thumper pools use 2, 4, 6, or 8),
        // so only the per-entry probability below is constrained to the [0, 1] interval.
        if (!Number.isFinite(chance) || chance <= 0 || entries.length == 0) invalidEnemyDropEntries++;
        for (const entry of entries) {
            enemyDropEntries++;
            const itemType = String(entry.type ?? "");
            const probability = Number(entry.probability);
            if (!itemType.startsWith("/Lotus/") || !Number.isFinite(probability) || probability < 0 || probability > 1)
                invalidEnemyDropEntries++;
            const status = enemyDropStatusForPath(itemType);
            enemyDropAcquisitionStatuses.push(status);
            if (status == "RejectedUnresolvedSourceReference" || status == "MissionRuntimePickup") {
                const current = enemyDropSpecialPaths.get(itemType);
                enemyDropSpecialPaths.set(itemType, {
                    status,
                    occurrences: (current?.occurrences ?? 0) + 1
                });
            }
        }
    }
}
if (invalidEnemyDropEntries != 0)
    issue(
        "Error",
        "ENEMY_DROP_ENTRIES_INVALID",
        `${invalidEnemyDropEntries} enemy drop pools or entries are malformed.`
    );

const bounties = tables["ExportBounties.json"] ?? {};
let bountyStageTiers = 0;
let bountyStageOptions = 0;
let invalidBounties = 0;
for (const [bountyPath, bounty] of Object.entries(bounties)) {
    const data = bounty as TRecord;
    const stages = (data.stages ?? []) as unknown[];
    bountyStageTiers += stages.length;
    for (const tier of stages) {
        if (!Array.isArray(tier)) {
            invalidBounties++;
            continue;
        }
        bountyStageOptions += tier.length;
        if (tier.length == 0 || tier.some(stage => typeof stage != "string" || !stage.startsWith("/Lotus/")))
            invalidBounties++;
    }
    if (
        !bountyPath.startsWith("/Lotus/") ||
        !String(data.name).startsWith("/") ||
        !String(data.description).startsWith("/") ||
        !String(data.icon).startsWith("/") ||
        stages.length == 0
    )
        invalidBounties++;
}
if (invalidBounties != 0) issue("Error", "BOUNTIES_INVALID", `${invalidBounties} bounty definitions are malformed.`);

const relics = tables["ExportRelics.json"] ?? {};
let invalidRelics = 0;
let missingRelicRewardManifests = 0;
for (const [relicPath, relic] of Object.entries(relics)) {
    const data = relic as TRecord;
    const rewardManifest = String(data.rewardManifest ?? "");
    if (!relicPath.startsWith("/Lotus/") || !rewardManifest.startsWith("/Lotus/")) invalidRelics++;
    if (!(rewardManifest in rewardTables)) missingRelicRewardManifests++;
}
if (invalidRelics != 0) issue("Error", "RELICS_INVALID", `${invalidRelics} relic definitions are malformed.`);
if (missingRelicRewardManifests != 0)
    issue(
        "Error",
        "RELIC_REWARD_MANIFESTS_MISSING",
        `${missingRelicRewardManifests} relics reference reward manifests absent from ExportRewards.`
    );

const recipes = tables["ExportRecipes.json"] ?? {};
let invalidRecipes = 0;
let recipeIngredients = 0;
const recipeResultTypes: string[] = [];
for (const [recipePath, recipe] of Object.entries(recipes)) {
    const data = recipe as TRecord;
    const resultType = String(data.resultType ?? "");
    recipeResultTypes.push(resultType);
    const ingredients = (data.ingredients ?? []) as TRecord[];
    recipeIngredients += ingredients.length;
    if (
        !recipePath.startsWith("/Lotus/") ||
        !resultType.startsWith("/Lotus/") ||
        !Number.isFinite(Number(data.buildTime)) ||
        ingredients.some(
            ingredient => !String(ingredient.ItemType).startsWith("/Lotus/") || Number(ingredient.ItemCount) <= 0
        )
    ) {
        invalidRecipes++;
    }
}

const dojoRecipes = tables["ExportDojoRecipes.json"] ?? {};
const dojoResearch = {
    ...((dojoRecipes.research ?? {}) as TRecord),
    ...((generatedDojoRecipes.research ?? {}) as TRecord)
};
const dojoDecos = {
    ...((dojoRecipes.decos ?? {}) as TRecord),
    ...((generatedDojoRecipes.decos ?? {}) as TRecord)
};
const dojoAll = {
    ...dojoResearch,
    ...((dojoRecipes.fabrications ?? {}) as TRecord),
    ...((dojoRecipes.rooms ?? {}) as TRecord),
    ...dojoDecos,
    ...((dojoRecipes.colours ?? {}) as TRecord),
    ...((dojoRecipes.backdrops ?? {}) as TRecord)
};
const dojoIngredientStatuses: string[] = [];
let invalidDojoRecipes = 0;
for (const [recipePath, recipe] of Object.entries({ ...dojoResearch, ...dojoDecos })) {
    const data = recipe as TRecord;
    const ingredients = (data.ingredients ?? []) as TRecord[];
    if (
        !recipePath.startsWith("/Lotus/") ||
        ingredients.some(
            ingredient => !String(ingredient.ItemType).startsWith("/Lotus/") || Number(ingredient.ItemCount) <= 0
        )
    ) {
        invalidDojoRecipes++;
    }
    dojoIngredientStatuses.push(
        ...ingredients.map(ingredient => acquisitionStatusForPath(String(ingredient.ItemType)))
    );
}
const isU44Dojo =
    generatedDojoRecipes.sourceSha256 == "095316aa1dd1a1c394773d2085b7ef13536b08d9847d6d6f66fb87ec04e5719e";
const expectedDojo = isU44Dojo ? { total: 3219, research: 0, decos: 68 } : { total: 3151, research: 27, decos: 2 };
if ((generatedDojoRecipes.currentManifestCount as number | undefined) != expectedDojo.total)
    issue(
        "Error",
        "CURRENT_DOJO_COUNT",
        `Current Dojo manifest does not contain the proven ${expectedDojo.total} recipes.`
    );
if (Object.keys((generatedDojoRecipes.research ?? {}) as TRecord).length != expectedDojo.research)
    issue(
        "Error",
        "CURRENT_DOJO_RESEARCH_SUPPLEMENT",
        `Current Dojo research supplement is not exactly ${expectedDojo.research} recipes.`
    );
if (Object.keys((generatedDojoRecipes.decos ?? {}) as TRecord).length != expectedDojo.decos)
    issue(
        "Error",
        "CURRENT_DOJO_DECO_SUPPLEMENT",
        `Current Dojo decoration supplement is not exactly ${expectedDojo.decos} recipes.`
    );
if (invalidDojoRecipes != 0)
    issue("Error", "CURRENT_DOJO_RECIPES_INVALID", `${invalidDojoRecipes} Dojo recipes are malformed.`);

const resources = tables["ExportResources.json"] ?? {};
const resourceCategories = countBy(objects(resources).map(resource => String(resource.productCategory ?? "Missing")));
const resourceRegistryCount = Object.keys(resources).filter(typeName => typeName in generatedItems).length;
const resourceAcquisitionStatuses = countBy(
    Object.keys(resources)
        .map(typeName => {
            const item = generatedItems[typeName] as TRecord | undefined;
            return item
                ? String(acquisitionByStoreItem.get(String(item.storeItem))?.status ?? "Unclassified")
                : "NoStoreWrapper";
        })
        .sort()
);
const resourcesWithoutStoreWrapper = Object.keys(resources).filter(typeName => !(typeName in generatedItems));

const cosmetics = Object.values(generatedCosmetics) as TRecord[];
const cosmeticItems = cosmetics.map(cosmetic => generatedItems[String(cosmetic.typeName)] as TRecord);
const hasMetadata = (item: TRecord, field: string): boolean =>
    Object.prototype.hasOwnProperty.call((item.effectiveMetadata ?? {}) as TRecord, field);
const cosmeticMetadataCoverage = {
    total: cosmetics.length,
    premiumPrice: cosmeticItems.filter(item => hasMetadata(item, "PremiumPrice")).length,
    regularPrice: cosmeticItems.filter(item => hasMetadata(item, "RegularPrice")).length,
    itemCompatibility: cosmeticItems.filter(item => hasMetadata(item, "ItemCompatibility")).length,
    compatibleTarget: cosmeticItems.filter(item => hasMetadata(item, "Compatible")).length,
    compatibleSlots: cosmeticItems.filter(item => hasMetadata(item, "CompatibleSlots")).length,
    exactTargetAndSlots: cosmeticItems.filter(
        item => hasMetadata(item, "Compatible") && hasMetadata(item, "CompatibleSlots")
    ).length,
    showInMarket: cosmeticItems.filter(item => hasMetadata(item, "ShowInMarket")).length,
    platformGate: cosmeticItems.filter(item =>
        Object.keys((item.effectiveMetadata ?? {}) as TRecord).some(key => key.startsWith("AvailableOnPlatform"))
    ).length,
    compatibilityClasses: countBy(
        cosmetics.map(cosmetic => {
            const metadata = (generatedItems[String(cosmetic.typeName)] as TRecord).effectiveMetadata as TRecord;
            if (metadata.Compatible && metadata.CompatibleSlots) return "TargetAndSlots";
            if (metadata.Compatible) return "TargetWithIntrinsicSlot";
            if (metadata.CompatibleSlots) return "GlobalTargetWithSlots";
            if (["FlavourItems", "ShipDecorations"].includes(String(cosmetic.productCategory))) return "GlobalCategory";
            return "Unclassified";
        })
    )
};
const unclassifiedCosmetics =
    Object.entries(cosmeticMetadataCoverage.compatibilityClasses).find(([key]) => key == "Unclassified")?.[1] ?? 0;
if (unclassifiedCosmetics != 0) {
    issue(
        "Error",
        "COSMETIC_COMPATIBILITY_UNCLASSIFIED",
        `${unclassifiedCosmetics} cosmetics have no exact target, slot, or global-category classification.`
    );
}

const missionUpdateSource = fs.readFileSync(path.join(root, "src/services/missionInventoryUpdateService.ts"), "utf8");
const specializedMissionTypes = unique(missionUpdateSource.match(/MT_[A-Z_]+/g) ?? [])
    .filter(missionType => missionType in missionTypes)
    .sort();
const genericMissionTypes = Object.keys(missionTypes)
    .filter(missionType => !specializedMissionTypes.includes(missionType))
    .sort();

const allItems = Object.values(generatedItems) as TRecord[];
const commerceCoverage = {
    total: allItems.length,
    premiumPrice: allItems.filter(item => hasMetadata(item, "PremiumPrice")).length,
    regularPrice: allItems.filter(item => hasMetadata(item, "RegularPrice")).length,
    sellingPrice: allItems.filter(item => hasMetadata(item, "SellingPrice")).length,
    marketFlag: allItems.filter(item => hasMetadata(item, "ShowInMarket")).length,
    compatibility: allItems.filter(item => hasMetadata(item, "ItemCompatibility")).length,
    platformGate: allItems.filter(item =>
        Object.keys((item.effectiveMetadata ?? {}) as TRecord).some(key => key.startsWith("AvailableOnPlatform"))
    ).length,
    noExplicitPrice: allItems.filter(item => !hasMetadata(item, "PremiumPrice") && !hasMetadata(item, "RegularPrice"))
        .length
};

let officialDrops: TRecord | undefined;
if (fs.existsSync(officialDropPath)) {
    const html = fs.readFileSync(officialDropPath, "utf8");
    const lastUpdate = /<b>Last Update:<\/b>\s*([^<\r\n]+)/i.exec(html)?.[1]?.trim();
    const tableSections = [...html.matchAll(/<h3 id="([^"]+)">/g)].map(match => match[1]);
    const probabilityRows = [...html.matchAll(/<tr>(.*?)<\/tr>/g)]
        .map(match => [...match[1].matchAll(/<td(?: class="[^"]*")?>(.*?)<\/td>/g)].map(cell => cell[1]))
        .filter(cells => cells.length >= 2 && /\(([\d.]+)%\)$/.test(cells.at(-1)!))
        .map(cells => ({
            name: cells
                .at(-2)!
                .replace(/<[^>]+>/g, "")
                .trim(),
            probability: Number(/\(([\d.]+)%\)$/.exec(cells.at(-1)!)![1])
        }));
    const displayNameRows = probabilityRows.filter(row => !/^\d+(?:\.\d+)?%$/.test(row.name));
    const invalidRows = probabilityRows.filter(
        row => row.name.length == 0 || !Number.isFinite(row.probability) || row.probability < 0 || row.probability > 100
    ).length;
    const dictionary = readJson<Record<string, string>>(path.join(exportDirectory, "dict.en.json"));
    const localizedNames = new Set(Object.values(dictionary).map(value => value.toLowerCase()));
    const normalizedOfficialNames = displayNameRows.map(row =>
        row.name
            .replace(/^\d+[xX]\s+/, "")
            .replace(/^\d[\d,]*\s+/, "")
            .toLowerCase()
    );
    const unmatchedDisplayNames = unique(normalizedOfficialNames.filter(name => !localizedNames.has(name))).sort();
    officialDrops = {
        path: officialDropPath,
        bytes: Buffer.byteLength(html),
        sha256: sha256(html),
        lastUpdate,
        sections: unique(tableSections),
        probabilityRows: probabilityRows.length,
        displayNameRows: displayNameRows.length,
        invalidProbabilityRows: invalidRows,
        exactLocalizedNameMatches: normalizedOfficialNames.filter(name => localizedNames.has(name)).length,
        unmatchedDisplayNameCount: unmatchedDisplayNames.length,
        unmatchedDisplayNameSha256: sha256(unmatchedDisplayNames.join("\n") + "\n"),
        unmatchedDisplayNameSample: unmatchedDisplayNames.slice(0, 100)
    };
    if (invalidRows != 0)
        issue("Error", "OFFICIAL_DROP_ROW_INVALID", `${invalidRows} official drop rows are malformed.`);
} else {
    issue(
        "Warning",
        "OFFICIAL_DROP_TABLE_MISSING",
        "No official DE drop-table snapshot was supplied.",
        officialDropPath
    );
}

if (vendorMissingRegistry.length != 0)
    issue(
        "Error",
        "VENDOR_ITEMS_MISSING_REGISTRY",
        `${vendorMissingRegistry.length} vendor offers lack an admitted item record.`
    );
if (vendorUnclassifiedAcquisition.length != 0)
    issue(
        "Error",
        "VENDOR_ITEMS_UNCLASSIFIED",
        `${vendorUnclassifiedAcquisition.length} vendor offers lack an acquisition classification.`
    );
if (missingMissionTypes.length != 0)
    issue("Error", "MISSION_TYPES_MISSING", `${missingMissionTypes.length} nodes reference unknown mission types.`);
if (missingRewardManifests.length != 0)
    issue(
        "Error",
        "REWARD_MANIFESTS_MISSING",
        `${missingRewardManifests.length} nodes reference missing reward manifests.`
    );
if (invalidRewardEntries != 0)
    issue("Error", "REWARD_ENTRIES_INVALID", `${invalidRewardEntries} reward entries are malformed.`);
if (rewardMissingRegistry.size != 0)
    issue(
        "Error",
        "REWARD_ITEMS_MISSING_REGISTRY",
        `${rewardMissingRegistry.size} reward StoreItems lack an admitted item record.`
    );
if (probabilityGroupMismatches.length != 0)
    issue(
        "Warning",
        "REWARD_PROBABILITY_GROUP_SUM",
        `${probabilityGroupMismatches.length} reward rotations do not sum to one within tolerance; inspect nested/conditional deck semantics.`
    );
if (invalidRecipes != 0) issue("Error", "RECIPES_INVALID", `${invalidRecipes} recipes are malformed.`);
const unsupportedStatuses = new Set(["Failed", "NoInventoryDelta", "Unclassified"]);
const assertStatuses = (code: string, label: string, statuses: string[]): void => {
    const invalid = statuses.filter(status => unsupportedStatuses.has(status));
    if (invalid.length != 0) issue("Error", code, `${invalid.length} ${label} have no supported acquisition path.`);
};
assertStatuses("VENDOR_OFFER_ACQUISITION_FAILED", "vendor offers", vendorAcquisitionStatuses);
assertStatuses(
    "VENDOR_CURRENCY_ACQUISITION_FAILED",
    "vendor currencies",
    vendorCurrencyPaths.map(acquisitionStatusForPath)
);
assertStatuses("SYNDICATE_FAVOUR_ACQUISITION_FAILED", "syndicate favours", syndicateFavourStatuses);
assertStatuses("SYNDICATE_SACRIFICE_ACQUISITION_FAILED", "syndicate sacrifices", syndicateSacrificeStatuses);
assertStatuses("SYNDICATE_MEDALLION_ACQUISITION_FAILED", "syndicate medallions", syndicateMedallionStatuses);
assertStatuses("DOJO_INGREDIENT_ACQUISITION_FAILED", "Dojo recipe ingredients", dojoIngredientStatuses);
assertStatuses(
    "REWARD_ACQUISITION_FAILED",
    "mission reward items",
    [...rewardStoreItems].map(acquisitionStatusForPath)
);
assertStatuses("ENEMY_DROP_ACQUISITION_FAILED", "enemy drop entries", enemyDropAcquisitionStatuses);

const report = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    inputs: {
        publicExportDirectory: exportDirectory,
        publicExportPackageVersion: packageJson.version,
        generatedMetadata: { path: generatedPath, sha256: sha256(fs.readFileSync(generatedPath)) },
        acquisitionAudit: { path: acquisitionPath, sha256: sha256(fs.readFileSync(acquisitionPath)) },
        nonStoreAcquisitionAudit: {
            path: nonStoreAcquisitionPath,
            sha256: sha256(fs.readFileSync(nonStoreAcquisitionPath))
        },
        generatedCommerceAudit: {
            path: generatedCommercePath,
            sha256: sha256(fs.readFileSync(generatedCommercePath))
        },
        generatedVendorRuntimeAudit: {
            path: generatedVendorRuntimePath,
            sha256: sha256(fs.readFileSync(generatedVendorRuntimePath))
        },
        currentDatafileRuntimeAudit: {
            path: currentDatafileRuntimePath,
            sha256: sha256(fs.readFileSync(currentDatafileRuntimePath))
        },
        officialDrops: officialDrops ? { path: officialDropPath, sha256: officialDrops.sha256 } : undefined
    },
    summary: {
        errors: issues.filter(entry => entry.severity == "Error").length,
        warnings: issues.filter(entry => entry.severity == "Warning").length,
        exportTables: tableManifest.length,
        itemRegistry: generated.itemRegistrySummary,
        itemAcquisition: acquisitionSummary,
        nonStoreAcquisition: nonStoreAcquisitionSummary,
        generatedCommerce: generatedCommerceSummary,
        generatedVendorRuntime: generatedVendorRuntimeSummary,
        currentDatafileRuntime: currentDatafileRuntimeSummary,
        cosmetics: cosmeticMetadataCoverage,
        commerce: commerceCoverage,
        resources: {
            total: Object.keys(resources).length,
            withAdmittedStoreWrapper: resourceRegistryCount,
            categories: resourceCategories,
            acquisitionStatuses: resourceAcquisitionStatuses,
            withoutStoreWrapper: resourcesWithoutStoreWrapper.length,
            withoutStoreWrapperStatuses: countBy(resourcesWithoutStoreWrapper.map(acquisitionStatusForPath))
        },
        syndicates: {
            publicExport: Object.keys(exportSyndicates).length,
            generatedCurrent: Object.keys(generatedSyndicates).length,
            currentFavourSets: Object.keys(generatedSyndicateFavours).length,
            normalizedTotal: Object.keys(syndicates).length,
            titles: syndicateTitles,
            invalidTitles: syndicateInvalidTitles,
            referencedLotusPaths: syndicatePaths.length,
            favourAcquisitionStatuses: countBy(syndicateFavourStatuses),
            sacrificeAcquisitionStatuses: countBy(syndicateSacrificeStatuses),
            medallionAcquisitionStatuses: countBy(syndicateMedallionStatuses),
            currentSourceCorrectionsRemoved: syndicateCorrections.removed.length,
            currentSourceCorrectionsAlreadyAbsent: syndicateCorrections.alreadyAbsent.length
        },
        vendors: {
            publicExport: Object.keys(exportVendors).length,
            generatedCurrent: Object.keys(generatedVendors).length,
            normalizedTotal: Object.keys(allVendors).length,
            offers: vendorOffers.length,
            priceKinds: countBy(vendorPriceKinds),
            currencyPaths: unique(vendorCurrencyPaths).length,
            offerAcquisitionStatuses: countBy(vendorAcquisitionStatuses),
            currencyAcquisitionStatuses: countBy(vendorCurrencyPaths.map(acquisitionStatusForPath)),
            missingRegistry: vendorMissingRegistry.length,
            unclassifiedAcquisition: vendorUnclassifiedAcquisition.length
        },
        missions: {
            missionTypes: Object.keys(missionTypes).length,
            nodes: Object.keys(regions).length,
            missingMissionTypes: missingMissionTypes.length,
            missingRewardManifests: missingRewardManifests.length,
            specializedServerBranches: specializedMissionTypes,
            genericRewardPipeline: genericMissionTypes
        },
        rewards: {
            manifests: Object.keys(rewardTables).length,
            rotations: rewardRotations,
            entries: rewardEntries,
            invalidEntries: invalidRewardEntries,
            probabilityGroupMismatches: probabilityGroupMismatches.length,
            probabilityGroupSemantics: countBy(probabilityGroupSemantics.map(entry => entry.classification)),
            sourceCorrectionsApplied: rewardCorrections.applied.length,
            sourceCorrectionsAlreadyPresent: rewardCorrections.alreadyPresent.length,
            uniqueStoreItems: rewardStoreItems.size,
            acquisitionStatuses: rewardAcquisitionStatuses,
            missingRegistry: rewardMissingRegistry.size
        },
        enemyDrops: {
            agents: Object.keys(enemyAgents).length,
            avatars: Object.keys(enemyAvatars).length,
            damageControllers: Object.keys(enemyDamageControllers).length,
            dropTables: Object.keys(enemyDropTables).length,
            pools: enemyDropPools,
            entries: enemyDropEntries,
            invalid: invalidEnemyDropEntries,
            missingDropTables: missingEnemyDropTables,
            missingDamageControllers: missingEnemyDamageControllers,
            acquisitionStatuses: countBy(enemyDropAcquisitionStatuses),
            specialNonInventoryPaths: [...enemyDropSpecialPaths.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([itemType, classification]) => ({ itemType, ...classification }))
        },
        bounties: {
            definitions: Object.keys(bounties).length,
            stageTiers: bountyStageTiers,
            stageOptions: bountyStageOptions,
            invalid: invalidBounties
        },
        relics: {
            definitions: Object.keys(relics).length,
            invalid: invalidRelics,
            missingRewardManifests: missingRelicRewardManifests
        },
        recipes: {
            total: Object.keys(recipes).length,
            ingredients: recipeIngredients,
            uniqueResultTypes: unique(recipeResultTypes).length,
            invalid: invalidRecipes
        },
        dojoRecipes: {
            publicExportEntries: Object.values(dojoRecipes).reduce(
                (sum, group) => sum + (group && typeof group == "object" ? Object.keys(group as TRecord).length : 0),
                0
            ),
            normalizedEntries: Object.keys(dojoAll).length,
            currentManifestRecipes: Number(generatedDojoRecipes.currentManifestCount ?? 0),
            currentOnlyResearch: Object.keys((generatedDojoRecipes.research ?? {}) as TRecord).length,
            currentOnlyDecorations: Object.keys((generatedDojoRecipes.decos ?? {}) as TRecord).length,
            invalid: invalidDojoRecipes,
            ingredientAcquisitionStatuses: countBy(dojoIngredientStatuses)
        },
        officialDrops
    },
    tableManifest,
    unresolved: {
        vendorMissingRegistry,
        vendorDefinitionOnly,
        vendorUnclassifiedAcquisition,
        missingMissionTypes,
        missingRewardManifests,
        rewardMissingRegistry: [...rewardMissingRegistry].sort(),
        probabilityGroupMismatches,
        probabilityGroupSemantics,
        enemyDropSpecialPaths: [...enemyDropSpecialPaths.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([itemType, classification]) => ({ itemType, ...classification })),
        rewardCorrections,
        syndicateCorrections
    },
    issues
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report.summary, null, 2));
console.log(`[server-data-pipeline] report=${outputPath}`);
if (report.summary.errors != 0) process.exitCode = 1;
