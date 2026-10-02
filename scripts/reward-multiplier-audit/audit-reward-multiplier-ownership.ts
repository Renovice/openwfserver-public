import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ExportCreditBundles, ExportRegions } from "warframe-public-export-plus";
import {
    NETRACELL_REWARD_DROP_TABLE,
    classifyPrivateServerMissionRewardDeliveryPath,
    getPrivateServerMissionRewardMultiplier,
    getPrivateServerMissionRewardSourceMultiplier,
    getPrivateServerRewardItemCountMultiplier,
    scalePrivateServerStrippedRewardItemCount,
    selectPrivateServerMissionRewardSubcomponentSource,
    type IMissionRewardMultiplierSource,
    type IPrivateServerMissionRewardContext,
    type TMissionRewardDeliveryPath,
    type TPrivateServerTuning
} from "../../src/services/privateServerTuningService.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath: string): string => fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

const configText = read("config.json");
const config = JSON.parse(configText) as {
    privateServerTuning?: Record<string, unknown>;
};
const tuning = config.privateServerTuning ?? {};
const missionService = read("src/services/missionInventoryUpdateService.ts");
const tuningService = read("src/services/privateServerTuningService.ts");
const missionController = read("src/controllers/api/missionInventoryUpdateController.ts");
const calendarController = read("src/controllers/api/completeCalendarEventController.ts");
const circuitController = read("src/controllers/api/endlessXpController.ts");
const sellController = read("src/controllers/api/sellController.ts");

const rewardPathConfigKeys = [
    "missionTypeRewardMultipliers",
    "spyVaultRewardMultiplier",
    "enemyCacheRewardMultiplier",
    "railjackMissionRewardMultiplier",
    "railjackMandatoryObjectiveRewardMultiplier",
    "railjackOptionalObjectiveRewardMultiplier",
    "railjackEndOfMissionBonusResourceBundleMultiplier",
    "railjackVoidStormRewardMultiplier",
    "bountyRewardMultiplier",
    "alertRewardMultiplier",
    "sortieRewardMultiplier",
    "archonHuntRewardMultiplier",
    "eventMissionRewardMultiplier",
    "questMissionRewardMultiplier",
    "duviriMissionRewardMultiplier",
    "periodicMissionRewardMultiplier",
    "netracellRewardMultiplier",
    "circuitRewardMultiplier"
] as const;

const errors: string[] = [];
const requireText = (text: string, expected: string, description: string): void => {
    if (!text.includes(expected)) errors.push(`missing ${description}: ${expected}`);
};
const forbidText = (text: string, forbidden: string, description: string): void => {
    if (text.includes(forbidden)) errors.push(`forbidden ${description}: ${forbidden}`);
};

for (const key of [
    "lootMultiplier",
    "missionRewardCountMultiplier",
    "affinityMultiplier",
    "creditMultiplier",
    "postMissionVisualBonusRewards",
    "focusGainMultiplier",
    "ducatSellMultiplier",
    "normalMissionRewardMultiplier",
    "railjackExtraResourceRewardMultiplier"
]) {
    if (Object.hasOwn(tuning, key)) errors.push(`obsolete config key remains: privateServerTuning.${key}`);
}

for (const sectionKey of [
    "_section_01_mission_type_reward_tables",
    "_section_02_spy_and_hidden_caches",
    "_section_03_railjack_rewards",
    "_section_04_named_mission_systems",
    "_section_05_endgame_reward_modes",
    "_section_06_duviri_and_circuit",
    "_section_07_currency_standing_and_login",
    "_section_08_other_private_server_features"
]) {
    if (!Object.hasOwn(tuning, sectionKey)) {
        errors.push(`visual configuration section marker missing: privateServerTuning.${sectionKey}`);
    }
}

for (const key of [
    ...rewardPathConfigKeys,
    "calendar1999RewardMultiplier",
    "kuvaRewardMultiplier",
    "entropicKuvaRewardMultiplier",
    "standingRewardMultiplier"
]) {
    if (!Object.hasOwn(tuning, key)) errors.push(`required config key missing: privateServerTuning.${key}`);
}

const configuredMissionTypes = (tuning.missionTypeRewardMultipliers as Record<string, unknown> | undefined) ?? {};
const explicitlyOwnedMissionTypes = new Set(["MT_RAILJACK", "MT_ENDLESS_DUVIRI"]);
for (const missionType of new Set(
    Object.values(ExportRegions)
        .filter(region => region.rewardManifests.length > 0)
        .map(region => region.missionType)
)) {
    if (!explicitlyOwnedMissionTypes.has(missionType) && !Object.hasOwn(configuredMissionTypes, missionType)) {
        errors.push(`reward-bearing mission type has no explicit multiplier: ${missionType}`);
    }
}

for (const [relativePath, source] of [
    ["missionInventoryUpdateService.ts", missionService],
    ["privateServerTuningService.ts", tuningService],
    ["missionInventoryUpdateController.ts", missionController],
    ["completeCalendarEventController.ts", calendarController],
    ["endlessXpController.ts", circuitController],
    ["sellController.ts", sellController]
] as const) {
    for (const key of [
        "lootMultiplier",
        "missionRewardCountMultiplier",
        "affinityMultiplier",
        "creditMultiplier",
        "postMissionVisualBonusRewards",
        "focusGainMultiplier",
        "ducatSellMultiplier",
        "normalMissionRewardMultiplier",
        "railjackExtraResourceRewardMultiplier"
    ]) {
        forbidText(source, key, `${relativePath} legacy multiplier ownership`);
    }
}

for (const key of rewardPathConfigKeys) {
    requireText(tuningService, `tuning?.${key}`, `${key} delivery-path lookup`);
}
requireText(
    missionService,
    "scaleTypeCountsForPrivateServer(value, 1, tuning)",
    "native pickup path using an unmultiplied delivery baseline"
);
requireText(
    missionService,
    "classifyPrivateServerMissionRewardDeliveryPath({",
    "mission reward delivery-path classification"
);
requireText(
    missionService,
    "scaleMissionRewards(MissionRewards, tuning, defaultRewardSource, rewardSources, explicitlyScaledMissionRewards)",
    "single per-row mission reward scaling pass"
);
for (const source of [
    "spyVault",
    "enemyCache",
    "railjackMission",
    "railjackMandatoryObjective",
    "railjackOptionalObjective",
    "railjackEndOfMissionBonusResourceBundle",
    "railjackVoidStorm"
]) {
    requireText(missionService, `sourceForStandardSubcomponent("${source}")`, `${source} per-row ownership tag`);
}
requireText(
    missionService,
    'getPrivateServerMissionRewardMultiplier(tuning, "netracell")',
    "Netracell-specific multiplier at its stripped-container grant"
);
requireText(
    missionService,
    "await addItem(inventory, reward.type, itemCount)",
    "stripped-container inventory grant using the scaled count"
);
requireText(
    missionService,
    "ItemCount: itemCount",
    "stripped-container MissionRewards row using the same scaled count"
);
forbidText(
    missionService,
    "temporalMultiplier > 1 ? temporalMultiplier",
    "Temporal Archimedea fallback to another multiplier"
);
forbidText(missionService, "deepMultiplier > 1 ? deepMultiplier", "Deep Archimedea fallback to another multiplier");
forbidText(missionService, "descMultiplier > 1 ? descMultiplier", "Descendia fallback to another multiplier");
requireText(tuningService, "if (isCreditBundleReward(itemType))", "native credit bundle exclusion");
requireText(tuningService, "return 1;", "native credit bundle multiplier result");
requireText(
    circuitController,
    'getPrivateServerMissionRewardMultiplier(tuning, "circuit")',
    "Circuit advertised reward multiplier"
);
requireText(
    calendarController,
    "handleStoreItemAcquisition(selection.reward!, inventory, rewardMultiplier)",
    "calendar dedicated-count grant"
);
requireText(
    calendarController,
    "getPrivateServerTuning(account)?.calendar1999RewardMultiplier",
    "scoped calendar owner"
);
forbidText(calendarController, "getPrivateServerMissionRewardMultiplier", "calendar stacking with mission owners");
forbidText(missionService, "applyArchonCrystalServerRule", "Archon Shard type-wide multiplier pass");
forbidText(missionController, "getPrivateServerPostMissionVisualBonusRewards", "synthetic pickup bonus rows");

const testTuning = {
    missionTypeRewardMultipliers: { MT_EXCAVATE: 2, MT_CAPTURE: 3 },
    spyVaultRewardMultiplier: 4,
    enemyCacheRewardMultiplier: 5,
    railjackMissionRewardMultiplier: 6,
    railjackMandatoryObjectiveRewardMultiplier: 7,
    railjackOptionalObjectiveRewardMultiplier: 8,
    railjackEndOfMissionBonusResourceBundleMultiplier: 9,
    railjackVoidStormRewardMultiplier: 10,
    bountyRewardMultiplier: 11,
    alertRewardMultiplier: 12,
    sortieRewardMultiplier: 13,
    archonHuntRewardMultiplier: 14,
    eventMissionRewardMultiplier: 15,
    questMissionRewardMultiplier: 16,
    duviriMissionRewardMultiplier: 17,
    periodicMissionRewardMultiplier: 18,
    netracellRewardMultiplier: 19,
    circuitRewardMultiplier: 20,
    kuvaRewardMultiplier: 21,
    entropicKuvaRewardMultiplier: 7
} as TPrivateServerTuning;

const deliveryPathCases: Array<{
    name: string;
    context: IPrivateServerMissionRewardContext;
    path: TMissionRewardDeliveryPath;
    multiplier: number;
}> = [
    {
        name: "Excavation mission type",
        context: { node: "SolNode1", missionType: "MT_EXCAVATE" },
        path: "missionType",
        multiplier: 2
    },
    { name: "bounty job", context: { jobId: "SomeJob" }, path: "bounty", multiplier: 11 },
    { name: "challenge bounty", context: { challengeMissionId: "HexSyndicate_0" }, path: "bounty", multiplier: 11 },
    { name: "alert", context: { alertId: "alert" }, path: "alert", multiplier: 12 },
    { name: "regular Sortie", context: { sortieId: "Node_123" }, path: "sortie", multiplier: 13 },
    { name: "Archon Hunt", context: { sortieId: "Node_Lite_123" }, path: "archonHunt", multiplier: 14 },
    { name: "world-state event", context: { goalId: "goal" }, path: "event", multiplier: 15 },
    { name: "GoalTag event", context: { goalTag: "EventTag" }, path: "event", multiplier: 15 },
    { name: "quest/key mission", context: { levelKeyName: "QuestKey" }, path: "quest", multiplier: 16 },
    { name: "Duviri encounter", context: { T: 13 }, path: "duviri", multiplier: 17 },
    { name: "periodic mission", context: { periodicMissionTag: "HardDaily1" }, path: "periodic", multiplier: 18 },
    { name: "invasion mission", context: { invasionId: "invasion" }, path: "periodic", multiplier: 18 },
    { name: "Nightmare mission", context: { nightmareMode: true }, path: "periodic", multiplier: 18 },
    { name: "Orokin Vault mission", context: { useVaultManifest: true }, path: "periodic", multiplier: 18 },
    { name: "Purgatory mission", context: { PurgatoryRewardQualifications: "1" }, path: "periodic", multiplier: 18 },
    {
        name: "Netracell exact node takes priority",
        context: { node: "SolNode720", challengeMissionId: "EntratiSyndicate_0" },
        path: "netracell",
        multiplier: 19
    },
    {
        name: "Circuit exact node takes priority",
        context: { node: "SolNode238", T: 1 },
        path: "circuit",
        multiplier: 20
    }
];

for (const testCase of deliveryPathCases) {
    const actualPath = classifyPrivateServerMissionRewardDeliveryPath(testCase.context);
    if (actualPath != testCase.path) {
        errors.push(`${testCase.name}: expected path ${testCase.path}, got ${actualPath}`);
        continue;
    }
    const actualMultiplier = getPrivateServerMissionRewardMultiplier(
        testTuning,
        actualPath,
        testCase.context.missionType
    );
    if (actualMultiplier != testCase.multiplier) {
        errors.push(`${testCase.name}: expected multiplier ${testCase.multiplier}, got ${actualMultiplier}`);
    }
}

const firstCreditBundle = Object.keys(ExportCreditBundles)[0];
const sourceCases: Array<{ name: string; source: IMissionRewardMultiplierSource; multiplier: number }> = [
    { name: "Excavation", source: { path: "missionType", missionType: "MT_EXCAVATE" }, multiplier: 2 },
    {
        name: "unknown mission type fails closed",
        source: { path: "missionType", missionType: "MT_FUTURE" },
        multiplier: 1
    },
    { name: "Spy vault", source: { path: "spyVault" }, multiplier: 4 },
    { name: "enemy cache", source: { path: "enemyCache" }, multiplier: 5 },
    { name: "Railjack mission", source: { path: "railjackMission" }, multiplier: 6 },
    { name: "Railjack mandatory objective", source: { path: "railjackMandatoryObjective" }, multiplier: 7 },
    { name: "Railjack optional objective", source: { path: "railjackOptionalObjective" }, multiplier: 8 },
    {
        name: "Railjack end-of-mission bonus resource bundle",
        source: { path: "railjackEndOfMissionBonusResourceBundle" },
        multiplier: 9
    },
    { name: "Railjack Void Storm", source: { path: "railjackVoidStorm" }, multiplier: 10 }
];
for (const testCase of sourceCases) {
    const actual = getPrivateServerMissionRewardSourceMultiplier(testTuning, testCase.source);
    if (actual != testCase.multiplier) {
        errors.push(`${testCase.name}: expected source multiplier ${testCase.multiplier}, got ${actual}`);
    }
}

const netracellSource: IMissionRewardMultiplierSource = { path: "netracell" };
const attemptedCacheOverride = selectPrivateServerMissionRewardSubcomponentSource(netracellSource, "enemyCache");
if (attemptedCacheOverride.path != "netracell") {
    errors.push(`Netracell source was incorrectly replaced by ${attemptedCacheOverride.path}`);
}
const excavationSource: IMissionRewardMultiplierSource = { path: "missionType", missionType: "MT_EXCAVATE" };
const excavationCacheSource = selectPrivateServerMissionRewardSubcomponentSource(excavationSource, "enemyCache");
if (excavationCacheSource.path != "enemyCache") {
    errors.push(`ordinary Excavation cache failed to select enemyCache owner`);
}

const multiplierCases = [
    ...[1, 3, 19].map(delivery => ({
        name: `Entropic Kuva has one owner for delivery ${delivery}`,
        actual: getPrivateServerRewardItemCountMultiplier(
            "/Lotus/Types/Gameplay/Zariman/Resources/EntropicKuvaItem",
            testTuning,
            delivery
        ),
        expected: 7
    })),
    {
        name: "Explicit Entropic x1 overrides a mission bonus",
        actual: getPrivateServerRewardItemCountMultiplier(
            "/Lotus/Types/Gameplay/Zariman/Resources/EntropicKuvaItem",
            { entropicKuvaRewardMultiplier: 1 },
            3
        ),
        expected: 1
    },

    {
        name: "Excavation server-generated mission reward",
        actual: getPrivateServerRewardItemCountMultiplier(
            "/Lotus/Types/Items/MiscItems/Ferrite",
            testTuning,
            getPrivateServerMissionRewardSourceMultiplier(testTuning, {
                path: "missionType",
                missionType: "MT_EXCAVATE"
            })
        ),
        expected: 2
    },
    {
        name: "Kuva replaces its delivery-path multiplier",
        actual: getPrivateServerRewardItemCountMultiplier(
            "/Lotus/Types/Items/MiscItems/Kuva",
            testTuning,
            getPrivateServerMissionRewardSourceMultiplier(testTuning, {
                path: "missionType",
                missionType: "MT_EXCAVATE"
            })
        ),
        expected: 21
    },
    {
        name: "credit bundle remains native-owned",
        actual: getPrivateServerRewardItemCountMultiplier(
            firstCreditBundle,
            testTuning,
            getPrivateServerMissionRewardSourceMultiplier(testTuning, {
                path: "missionType",
                missionType: "MT_EXCAVATE"
            })
        ),
        expected: 1
    },
    {
        name: "ordinary native pickup remains at client-reported count",
        actual: getPrivateServerRewardItemCountMultiplier("/Lotus/Types/Items/MiscItems/Ferrite", testTuning, 1),
        expected: 1
    }
];
for (const testCase of multiplierCases) {
    if (testCase.actual != testCase.expected) {
        errors.push(`${testCase.name}: expected ${testCase.expected}, got ${testCase.actual}`);
    }
}

const strippedRewardCases = [
    {
        name: "Netracell uses only its own reward multiplier",
        actual: scalePrivateServerStrippedRewardItemCount(
            NETRACELL_REWARD_DROP_TABLE,
            "/Lotus/Types/Gameplay/NarmerSorties/ArchonCrystalAmar",
            1,
            testTuning,
            testTuning.netracellRewardMultiplier
        ),
        expected: 19
    },
    {
        name: "unrelated stripped-container reward keeps its native count",
        actual: scalePrivateServerStrippedRewardItemCount(
            "/Lotus/Types/DropTables/SomeOtherContainerDropTable",
            "/Lotus/Types/Items/MiscItems/Ferrite",
            1,
            testTuning,
            testTuning.netracellRewardMultiplier
        ),
        expected: 1
    }
];
for (const testCase of strippedRewardCases) {
    if (testCase.actual != testCase.expected) {
        errors.push(`${testCase.name}: expected ${testCase.expected}, got ${testCase.actual}`);
    }
}

if (errors.length > 0) {
    console.error(JSON.stringify({ status: "FAIL", errors }, null, 2));
    process.exitCode = 1;
} else {
    console.log(
        JSON.stringify(
            {
                status: "PASS",
                ownership: {
                    nativeVisible: ["ordinary credits", "equipment affinity", "live resource pickups"],
                    clientVisibleMetadata: ["Focus gains", "Ducat sale values"],
                    serverVisible: [
                        "explicit mission-type and per-row reward sources",
                        "Netracell stripped-container rewards",
                        "Deep and Temporal Archimedea rewards",
                        "Circuit advertised reward entries"
                    ],
                    serverOnly: ["Circuit progress during the active run"],
                    baselinePendingSynchronization: [
                        "Calendar reward preview (claim quantities have a dedicated owner)",
                        "daily login reward counts"
                    ]
                },
                deliveryPaths: Object.fromEntries(
                    deliveryPathCases.map(testCase => [testCase.name, `${testCase.path}:${testCase.multiplier}`])
                ),
                invariants: [
                    "client-reported pickups are not multiplied again",
                    "server Focus and Ducat multiplier settings do not exist while client metadata owns their visible values",
                    "the obsolete broad missionRewardCountMultiplier does not exist",
                    "the temporary normalMissionRewardMultiplier umbrella does not exist",
                    "each reward row selects one exact mission-type, named-system, cache, Spy, or Railjack owner",
                    "unknown future mission types default to vanilla quantity",
                    "credit bundles remain native-owned",
                    "Archon Shards have no second type-wide multiplier pass",
                    "Netracell inventory grants and MissionRewards rows use one identical path-owned count",
                    "EDA, ETA, and Descendia use only their dedicated multiplier",
                    "1999 calendar item claims use their dedicated scoped multiplier once"
                ]
            },
            null,
            2
        )
    );
}
