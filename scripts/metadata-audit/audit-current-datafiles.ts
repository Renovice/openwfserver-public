import { createHash } from "node:crypto";
import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import type { IDojoDeco, IDojoResearch, ISyndicate } from "warframe-public-export-plus";
import { BL_LATEST } from "../../src/constants/gameVersions.ts";
import { config, loadConfig } from "../../src/services/configService.ts";
import { deinitLogger, initLogger } from "../../src/utils/logger.ts";

type TGeneratedSyndicate = {
    uniqueName: string;
    manifestPath: string;
    sourceSha256: string;
    sourceFavourCount?: number;
    favours: ISyndicate["favours"];
    rejectedFavours?: { favour: ISyndicate["favours"][number]; reason: string }[];
};
type TGeneratedDojo = {
    manifestPath: string;
    sourceSha256: string;
    currentManifestCount: number;
    research: Record<string, IDojoResearch>;
    decos: Record<string, IDojoDeco>;
};
type TFailure = { scope: string; check: string; detail: string };

const option = (name: string): string | undefined => {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 ? process.argv[index + 1] : undefined;
};
const root = process.cwd();
const generatedPath = path.resolve(
    option("generated") ?? path.join(root, "static/generated/openwf-metadata/challenge-metadata.json")
);
const publicSyndicatesPath = path.resolve(
    option("public-syndicates") ?? path.join(root, "node_modules/warframe-public-export-plus/ExportSyndicates.json")
);
const publicDojoPath = path.resolve(
    option("public-dojo") ?? path.join(root, "node_modules/warframe-public-export-plus/ExportDojoRecipes.json")
);
const outputPath = path.resolve(option("output") ?? path.join(root, "tmp/audits/current-datafile-runtime-audit.json"));
const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, "utf8")) as T;
const sha256 = (file: string): string => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const stable = (value: unknown): string => JSON.stringify(value);
const unique = (values: string[]): string[] => [...new Set(values)].sort();

const generated = readJson<{
    generatedSyndicateFavours: Record<string, TGeneratedSyndicate>;
    generatedDojoRecipes: TGeneratedDojo;
}>(generatedPath);
const publicSyndicates = readJson<Record<string, ISyndicate>>(publicSyndicatesPath);
const publicDojo = readJson<{
    research: Record<string, IDojoResearch>;
    fabrications: Record<string, unknown>;
    rooms: Record<string, unknown>;
    decos: Record<string, IDojoDeco>;
    colours: Record<string, unknown>;
    backdrops: Record<string, unknown>;
}>(publicDojoPath);

loadConfig();
config.logger.files = false;
config.logger.consoleLevel = "error";
initLogger();

const failures: TFailure[] = [];
const fail = (scope: string, check: string, detail: string): void => {
    failures.push({ scope, check, detail });
};

try {
    const generatedService = await import("../../src/services/generatedMetadataService.ts");
    if (!generatedService.selfTestGeneratedMetadata())
        fail("generated", "metadata-self-test", "selfTestGeneratedMetadata returned false");

    // Importing itemDataService applies the generated current-datafile overlays to the shared
    // Public Export objects. These are the same objects consumed by the server controllers.
    const itemData = await import("../../src/services/itemDataService.ts");
    const publicExport = await import("warframe-public-export-plus");
    const buildLabel = config.fallbackBuildLabel ?? BL_LATEST;

    const generatedSyndicates = generated.generatedSyndicateFavours;
    const activeRows = Object.values(generatedSyndicates).flatMap(entry => entry.favours);
    const rejectedRows = Object.values(generatedSyndicates).flatMap(entry =>
        (entry.rejectedFavours ?? []).map(rejection => rejection.favour)
    );
    const currentRows = [...activeRows, ...rejectedRows];
    const publicRows = Object.values(publicSyndicates).flatMap(entry => entry.favours);
    const currentStoreItems = unique(currentRows.map(row => row.storeItem));
    const publicStoreItems = new Set(publicRows.map(row => row.storeItem));
    const currentOnlyStoreItems = currentStoreItems.filter(storeItem => !publicStoreItems.has(storeItem));
    const publicOnlyStoreItems = unique(publicRows.map(row => row.storeItem)).filter(
        storeItem => !currentStoreItems.includes(storeItem)
    );
    let runtimeSyndicates = 0;
    let runtimeSyndicateRows = 0;
    for (const [tag, current] of Object.entries(generatedSyndicates)) {
        const runtime = await itemData.getSyndicate(tag, buildLabel);
        if (!runtime) {
            fail(tag, "runtime-syndicate", "getSyndicate returned undefined");
            continue;
        }
        runtimeSyndicates++;
        runtimeSyndicateRows += runtime.favours.length;
        if (runtime.uniqueName != current.uniqueName)
            fail(tag, "unique-name", `got ${runtime.uniqueName}; expected ${current.uniqueName}`);
        if (stable(runtime.favours) != stable(current.favours))
            fail(
                tag,
                "favour-parity",
                `runtime returned ${runtime.favours.length}; expected ${current.favours.length}`
            );
    }

    // PE+ 0.6.10 now supplies the five cosmetic/Umbral favours formerly supplemented here.
    const isU44 =
        generated.generatedDojoRecipes.sourceSha256 ==
        "095316aa1dd1a1c394773d2085b7ef13536b08d9847d6d6f66fb87ec04e5719e";
    const expectedCurrentOnly = [
        ...(isU44
            ? [
                  "/Lotus/StoreItems/Powersuits/DemonFrame/DemonFrameFireBallAugmentCard",
                  "/Lotus/StoreItems/Powersuits/Devourer/DevourerPassiveAugmentCard",
                  "/Lotus/StoreItems/Powersuits/Frost/IceShieldAugmentTwoCard",
                  "/Lotus/StoreItems/Powersuits/Oraxia/BroodAugmentCard"
              ]
            : []),
        "/Lotus/StoreItems/Upgrades/Mods/Warframe/Kahl/KahlAvatarAbilityDurationMod",
        "/Lotus/StoreItems/Upgrades/Mods/Warframe/Kahl/KahlAvatarAbilityRangeMod",
        "/Lotus/StoreItems/Upgrades/Mods/Warframe/Kahl/KahlAvatarAbilityStrengthMod",
        "/Lotus/StoreItems/Upgrades/Mods/Warframe/Kahl/KahlAvatarHealthMaxMod",
        "/Lotus/StoreItems/Upgrades/Mods/Warframe/Kahl/KahlAvatarPowerMaxMod"
    ].sort();
    if (stable(currentOnlyStoreItems) != stable(expectedCurrentOnly))
        fail(
            "syndicates",
            "current-only-set",
            `got ${currentOnlyStoreItems.length}; expected ${expectedCurrentOnly.length} proven current-only items`
        );
    if (publicOnlyStoreItems.length != 0)
        fail(
            "syndicates",
            "public-only-set",
            `${publicOnlyStoreItems.length} Public Export favours are absent from current datafiles`
        );
    if (currentRows.length != (isU44 ? 1_936 : 1_928))
        fail("syndicates", "current-row-count", `got ${currentRows.length}; expected ${isU44 ? 1936 : 1928}`);
    if (currentStoreItems.length != (isU44 ? 1_646 : 1_642))
        fail("syndicates", "current-unique-count", `got ${currentStoreItems.length}; expected ${isU44 ? 1646 : 1642}`);

    const kahl = await itemData.getSyndicate("KahlSyndicate", buildLabel);
    if (kahl?.favours.length != 5 || kahl.favours.some(favour => favour.standingCost != 50))
        fail(
            "KahlSyndicate",
            "known-current-contract",
            "expected five current Kahl avatar mods costing 50 standing each"
        );
    const event = await itemData.getSyndicate("EventSyndicate", buildLabel);
    if (!event?.favours.some(favour => favour.storeItem == "/Lotus/StoreItems/Types/Items/MiscItems/FormaUmbra"))
        fail("EventSyndicate", "known-current-contract", "current Umbra Forma favour is missing");

    const dojo = generated.generatedDojoRecipes;
    const rawDojoKeys = unique([
        ...Object.keys(publicDojo.research),
        ...Object.keys(publicDojo.fabrications),
        ...Object.keys(publicDojo.rooms),
        ...Object.keys(publicDojo.decos),
        ...Object.keys(publicDojo.colours),
        ...Object.keys(publicDojo.backdrops)
    ]);
    const generatedDojoKeys = unique([...Object.keys(dojo.research), ...Object.keys(dojo.decos)]);
    const runtimeResearch = publicExport.ExportDojoRecipes.research;
    const runtimeDecos = publicExport.ExportDojoRecipes.decos;
    for (const [recipePath, exact] of Object.entries(dojo.research)) {
        if (stable(runtimeResearch[recipePath]) != stable(exact))
            fail(recipePath, "runtime-research-parity", "generated research recipe was not applied exactly");
    }
    for (const [recipePath, exact] of Object.entries(dojo.decos)) {
        if (stable(runtimeDecos[recipePath]) != stable(exact))
            fail(recipePath, "runtime-deco-parity", "generated decoration recipe was not applied exactly");
    }
    if (dojo.currentManifestCount != (isU44 ? 3_219 : 3_151))
        fail("dojo", "current-manifest-count", `got ${dojo.currentManifestCount}; expected ${isU44 ? 3219 : 3151}`);
    if (Object.keys(dojo.research).length != (isU44 ? 0 : 27) || Object.keys(dojo.decos).length != (isU44 ? 68 : 2))
        fail(
            "dojo",
            "supplement-count",
            `got ${Object.keys(dojo.research).length} research and ${Object.keys(dojo.decos).length} decorations`
        );
    // PE+ 0.6.10 caught up with all 29 extracted recipes. Require exact parity, not merely presence.
    for (const kind of ["research", "decos"] as const) {
        for (const [recipePath, exact] of Object.entries(dojo[kind])) {
            if (isU44 && !Object.hasOwn(publicDojo[kind], recipePath)) continue;
            if (!isDeepStrictEqual(publicDojo[kind][recipePath], exact)) {
                fail(recipePath, "upstream-recipe-parity", "Public Export recipe differs from the extracted recipe");
            }
        }
    }
    if (isU44 && unique([...rawDojoKeys, ...generatedDojoKeys]).length != dojo.currentManifestCount)
        fail(
            "dojo",
            "complete-manifest-union",
            "Public Export plus supplements must cover every current manifest recipe"
        );
    const lavan = (runtimeResearch as Record<string, IDojoResearch | undefined>)[
        "/Lotus/Types/Recipes/Railjack/Weapons/Lavan/LavanAutoCannonDBlueprint"
    ];
    if (
        !lavan ||
        lavan.resultType != "/Lotus/Weapons/CrewShip/MassDriver/AutoCannon/LavanAutoCannonTierD" ||
        lavan.replicatePrice != 15_000
    )
        fail("dojo", "known-research-contract", "Tier-D Lavan AutoCannon research recipe is missing or changed");
    const teleporter = (runtimeDecos as Record<string, IDojoDeco | undefined>)[
        "/Lotus/Levels/ClanDojo/ComponentPropRecipes/DojoGroupedTeleporterRecipe"
    ];
    if (
        !teleporter ||
        teleporter.resultType != "/Lotus/Objects/Tenno/Props/DojoGroupedTeleporterDeco" ||
        teleporter.capacityCost != 3
    )
        fail("dojo", "known-deco-contract", "grouped teleporter decoration recipe is missing or changed");

    const summary = {
        syndicates: {
            currentSets: Object.keys(generatedSyndicates).length,
            sourceRows: currentRows.length,
            activeRows: activeRows.length,
            rejectedRows: rejectedRows.length,
            currentUniqueStoreItems: currentStoreItems.length,
            currentOnlyStoreItems: currentOnlyStoreItems.length,
            publicOnlyStoreItems: publicOnlyStoreItems.length,
            runtimeResolved: runtimeSyndicates,
            runtimeRows: runtimeSyndicateRows
        },
        dojo: {
            currentManifestRecipes: dojo.currentManifestCount,
            publicExportEntries: rawDojoKeys.length,
            generatedCurrentOnlyResearch: Object.keys(dojo.research).length,
            generatedCurrentOnlyDecorations: Object.keys(dojo.decos).length,
            generatedCurrentOnlyTotal: generatedDojoKeys.length,
            runtimeResearchEntries: Object.keys(runtimeResearch).length,
            runtimeDecorationEntries: Object.keys(runtimeDecos).length
        },
        failed: failures.length
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(
        outputPath,
        JSON.stringify(
            {
                inputs: {
                    generatedMetadata: { path: generatedPath, sha256: sha256(generatedPath) },
                    publicSyndicates: { path: publicSyndicatesPath, sha256: sha256(publicSyndicatesPath) },
                    publicDojoRecipes: { path: publicDojoPath, sha256: sha256(publicDojoPath) }
                },
                summary,
                currentOnlySyndicateStoreItems: currentOnlyStoreItems,
                failures
            },
            null,
            2
        ) + "\n"
    );
    console.log(JSON.stringify(summary, null, 2));
    console.log(`[current-datafile-runtime] report=${outputPath}`);
    if (failures.length != 0) process.exitCode = 1;
} finally {
    deinitLogger();
}
