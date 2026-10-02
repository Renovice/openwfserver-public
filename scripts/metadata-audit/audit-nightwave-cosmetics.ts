import { buildVersionToInt } from "../../src/helpers/versionHelper.ts";
import fs from "fs";
import path from "path";
import { ExportArcanes, ExportUpgrades, ExportVendors, type IVendorOffer } from "warframe-public-export-plus";
import { nightwaveDebugCatalog } from "../../src/helpers/nightwaveDebugCatalog.ts";
import { Inventory } from "../../src/models/inventoryModels/inventoryModel.ts";
import { config, loadConfig } from "../../src/services/configService.ts";
import {
    generatedBundles,
    generatedCosmetics,
    generatedItems,
    generatedNightwaveSyndicates
} from "../../src/services/generatedMetadataService.ts";
import { toStoreItem } from "../../src/services/itemDataService.ts";
import { handlePurchase, handleStoreItemAcquisition } from "../../src/services/purchaseService.ts";
import { getVendorManifestByOid, getVendorManifestByTypeName } from "../../src/services/serversideVendorsService.ts";
import { ePurchaseSource } from "../../src/types/purchaseTypes.ts";
import type { IItemManifest } from "../../src/types/vendorTypes.ts";
import { deinitLogger, initLogger } from "../../src/utils/logger.ts";

type TDebugPool =
    | "warframeAppearance"
    | "weaponAppearance"
    | "operatorCompanionVehicleAppearance"
    | "profileEmotesInterface"
    | "decorations"
    | "arcanes"
    | "mods";
type TAuditFailure = { check: string; detail: string };

const option = (name: string): string | undefined => {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 ? process.argv[index + 1] : undefined;
};
const outputPath = path.resolve(
    option("output") ?? path.join(process.cwd(), "tmp/audits/nightwave-cosmetic-audit.json")
);

const ZORBA = "/Lotus/Types/Game/VendorManifests/Hubs/AspirantZorbaVendorManifest";
const FERGOLYTE = "/Lotus/Types/Gameplay/Shadowgrapher/Resources/ShadowgrapherResource";
const TEISATZ = "/Lotus/StoreItems/Upgrades/Skins/Operator/Accessories/NightWaveScouterEyePiece";
const XAKU_RAYA = "/Lotus/StoreItems/Upgrades/Skins/BrokenFrame/XakuCosmosSkin";
const IVARA_BALLISTICA = "/Lotus/StoreItems/Upgrades/Skins/Archer/IvaraDeluxeBallisticaSkin";
const DRIPPY_BACKGROUND = "/Lotus/StoreItems/Interface/Graphics/CustomUI/Backgrounds/DrippyBackground";
const KANESHELL_BUNDLE = "/Lotus/Types/StoreItems/Packages/OperatorSuitNightwave1999Bundle";
const NINTENDO_OPAL = "/Lotus/StoreItems/Upgrades/Skins/Excalibur/NintendoExcalibur";
const PLAYSTATION_OBSIDIAN = "/Lotus/StoreItems/Upgrades/Skins/Archer/ObsidianIvaraSkin";
const XBOX_JADE = "/Lotus/StoreItems/Upgrades/Skins/Promo/Microsoft/JadeRhinoSkin";
const OCTAVIA_PRIME_DEFAULT = "/Lotus/Upgrades/Skins/Bard/OctaviaPrimeSkin";

const toDebugStoreItem = (typeName: string): string =>
    typeName.startsWith("/Lotus/Types/StoreItems/Packages/") ? typeName : toStoreItem(typeName);

const sourceOfferKey = (offer: IVendorOffer): string =>
    JSON.stringify({
        storeItem: offer.storeItem,
        quantity: offer.quantity,
        itemPrices: (offer.itemPrices ?? []).map(price => ({ ItemType: price.ItemType, ItemCount: price.ItemCount }))
    });

const emittedOfferKey = (offer: IItemManifest): string =>
    JSON.stringify({
        storeItem: offer.StoreItem,
        quantity: offer.QuantityMultiplier,
        itemPrices: (offer.ItemPrices ?? []).map(price => ({ ItemType: price.ItemType, ItemCount: price.ItemCount }))
    });

loadConfig();
config.worldState ??= {};
config.logger.files = false;
config.logger.consoleLevel = "error";
initLogger();

const failures: TAuditFailure[] = [];
const fail = (check: string, detail: string): void => {
    failures.push({ check, detail });
};

// Zorba remains the native vendor. The generated debug inventory belongs only to Nightwave.
if (!(ZORBA in ExportVendors)) throw new Error("native Zorba definition is missing");
const nativeZorba = ExportVendors[ZORBA];
const zorbaManifest = getVendorManifestByTypeName(
    ZORBA,
    true,
    buildVersionToInt(config.fallbackBuildLabel ?? "2026.08.19.11.06")
);
if (!zorbaManifest) throw new Error("native Zorba manifest was not generated");
const expectedZorbaOffers = new Set(nativeZorba.items.map(sourceOfferKey));
const actualZorbaOffers = new Set(zorbaManifest.VendorInfo.ItemManifest.map(emittedOfferKey));
const zorbaMissingNativeOffers = [...expectedZorbaOffers].filter(key => !actualZorbaOffers.has(key));
const zorbaUnexpectedOffers = [...actualZorbaOffers].filter(key => !expectedZorbaOffers.has(key));
if (zorbaMissingNativeOffers.length || zorbaUnexpectedOffers.length) {
    fail(
        "zorba-native-stock",
        `missing=${zorbaMissingNativeOffers.length}; unexpected=${zorbaUnexpectedOffers.length}`
    );
}

const nightwaveDefinitions = Object.values(generatedNightwaveSyndicates);
if (nightwaveDefinitions.length == 0) throw new Error("current generated Nightwave definition was not generated");
const nightwaveDefinition = nightwaveDefinitions.sort((a, b) => b.uniqueName.localeCompare(a.uniqueName))[0];

const catalogTypeNames: Record<TDebugPool, string[]> = {
    warframeAppearance: nightwaveDebugCatalog.warframeAppearance,
    weaponAppearance: nightwaveDebugCatalog.weaponAppearance,
    operatorCompanionVehicleAppearance: nightwaveDebugCatalog.operatorCompanionVehicleAppearance,
    profileEmotesInterface: nightwaveDebugCatalog.profileEmotesInterface,
    decorations: nightwaveDebugCatalog.decorations,
    arcanes: nightwaveDebugCatalog.arcanes,
    mods: Object.keys(ExportUpgrades)
};
const expectedStoreItems = Object.fromEntries(
    Object.entries(catalogTypeNames).map(([pool, typeNames]) => [pool, new Set(typeNames.map(toDebugStoreItem))])
) as Record<TDebugPool, Set<string>>;

const setOnlyDebugPool = (pool: TDebugPool | "all"): void => {
    config.worldState!.nightwaveDebugShopWarframeAppearance = pool == "warframeAppearance" || pool == "all";
    config.worldState!.nightwaveDebugShopWeaponAppearance = pool == "weaponAppearance" || pool == "all";
    config.worldState!.nightwaveDebugShopOperatorCompanionVehicleAppearance =
        pool == "operatorCompanionVehicleAppearance" || pool == "all";
    config.worldState!.nightwaveDebugShopProfileEmotesInterface = pool == "profileEmotesInterface" || pool == "all";
    config.worldState!.nightwaveDebugShopDecorations = pool == "decorations" || pool == "all";
    config.worldState!.nightwaveDebugShopArcanes = pool == "arcanes" || pool == "all";
    config.worldState!.nightwaveDebugShopMods = pool == "mods" || pool == "all";
    config.worldState!.nightwaveDebugShopHideRegular = true;
};

const poolReports: Record<
    TDebugPool,
    { expected: number; emitted: number; missing: string[]; unexpected: string[]; wrongCurrency: string[] }
> = {} as never;
const emittedStoreItems = {} as Record<TDebugPool, Set<string>>;
for (const pool of Object.keys(catalogTypeNames) as TDebugPool[]) {
    setOnlyDebugPool(pool);
    const manifest = getVendorManifestByTypeName(
        nightwaveDefinition.vendorManifest,
        false,
        buildVersionToInt(config.fallbackBuildLabel ?? "2026.08.19.11.06")
    );
    if (!manifest) throw new Error(`Nightwave manifest was not generated for ${pool}`);
    const emitted = new Set(manifest.VendorInfo.ItemManifest.map(offer => offer.StoreItem));
    emittedStoreItems[pool] = emitted;
    const missing = [...expectedStoreItems[pool]].filter(storeItem => !emitted.has(storeItem));
    const unexpected = [...emitted].filter(storeItem => !expectedStoreItems[pool].has(storeItem));
    const wrongCurrency = manifest.VendorInfo.ItemManifest.filter(offer =>
        offer.ItemPrices?.some(price => price.ItemType != nightwaveDefinition.currency)
    ).map(offer => offer.StoreItem);
    poolReports[pool] = {
        expected: expectedStoreItems[pool].size,
        emitted: manifest.VendorInfo.ItemManifest.length,
        missing,
        unexpected,
        wrongCurrency
    };
    if (
        missing.length ||
        unexpected.length ||
        wrongCurrency.length ||
        manifest.VendorInfo.ItemManifest.length != emitted.size
    ) {
        fail(
            `${pool}-manifest`,
            `expected=${expectedStoreItems[pool].size}; emitted=${manifest.VendorInfo.ItemManifest.length}; unique=${emitted.size}; missing=${missing.length}; unexpected=${unexpected.length}; wrongCurrency=${wrongCurrency.length}`
        );
    }
    const fergolyte = manifest.VendorInfo.ItemManifest.filter(offer =>
        offer.ItemPrices?.some(price => price.ItemType == FERGOLYTE)
    );
    if (fergolyte.length) fail(`${pool}-currency`, `${fergolyte.length} offers use Fergolyte`);
}

// Every switch must be independent: no item may reappear in another debug pool.
const pools = Object.keys(emittedStoreItems) as TDebugPool[];
const overlaps: { left: TDebugPool; right: TDebugPool; items: string[] }[] = [];
for (let left = 0; left < pools.length; ++left) {
    for (let right = left + 1; right < pools.length; ++right) {
        const items = [...emittedStoreItems[pools[left]]].filter(item => emittedStoreItems[pools[right]].has(item));
        if (items.length) {
            overlaps.push({ left: pools[left], right: pools[right], items });
            fail("pool-overlap", `${pools[left]}/${pools[right]}=${items.length}`);
        }
    }
}

const excludedBuiltIn = new Set(nightwaveDebugCatalog.excludedBuiltInCosmetics);
const excludedInternalHelpers = new Set(nightwaveDebugCatalog.excludedInternalHelpers);
const appearancePoolNames: TDebugPool[] = [
    "warframeAppearance",
    "weaponAppearance",
    "operatorCompanionVehicleAppearance",
    "profileEmotesInterface"
];
const emittedAppearanceStoreItems = new Set(appearancePoolNames.flatMap(pool => [...emittedStoreItems[pool]]));
const classifiedIndividualTypeNames = new Set([
    ...appearancePoolNames.flatMap(pool => catalogTypeNames[pool]),
    ...nightwaveDebugCatalog.decorations.filter(typeName => !typeName.startsWith("/Lotus/Types/StoreItems/Packages/")),
    ...nightwaveDebugCatalog.excludedBuiltInCosmetics,
    ...nightwaveDebugCatalog.excludedInternalHelpers
]);
const unclassifiedIndividuals = Object.keys(generatedCosmetics).filter(
    typeName => !classifiedIndividualTypeNames.has(typeName)
);
const unexpectedClassifiedIndividuals = [...classifiedIndividualTypeNames].filter(
    typeName => !Object.hasOwn(generatedCosmetics, typeName)
);
if (unclassifiedIndividuals.length || unexpectedClassifiedIndividuals.length) {
    fail(
        "individual-catalog-partition",
        `unclassified=${unclassifiedIndividuals.length}; unexpected=${unexpectedClassifiedIndividuals.length}`
    );
}
if (!excludedBuiltIn.has(OCTAVIA_PRIME_DEFAULT)) {
    fail("built-in-default-classification", "OctaviaPrimeSkin was not classified as a built-in default");
}
const leakedBuiltIns = [...excludedBuiltIn]
    .map(toDebugStoreItem)
    .filter(storeItem => emittedAppearanceStoreItems.has(storeItem));
if (leakedBuiltIns.length) fail("built-in-default-leak", `${leakedBuiltIns.length} built-in defaults are offered`);

const leakedInternalHelpers = [...excludedInternalHelpers]
    .map(toDebugStoreItem)
    .filter(storeItem => emittedAppearanceStoreItems.has(storeItem));
if (leakedInternalHelpers.length) {
    fail("internal-helper-leak", `${leakedInternalHelpers.length} internal animation helpers are offered`);
}

// Appearance and mixed package wrappers stay out of the shop, while every usable leaf remains
// available individually. Decoration-only packages remain under the independent Decorations switch.
const generatedItemByStoreItem = new Map(Object.values(generatedItems).map(item => [item.storeItem, item] as const));
const excludedBundleWrappers = [
    ...nightwaveDebugCatalog.excludedAppearanceBundles,
    ...nightwaveDebugCatalog.excludedMixedBundles
];
const cosmeticBundleLeaks = excludedBundleWrappers.filter(
    typeName => emittedAppearanceStoreItems.has(typeName) || emittedStoreItems.decorations.has(typeName)
);
const uncoveredCosmeticBundleLeaves: { bundle: string; leaf: string }[] = [];
const inspectCosmeticBundle = (rootBundle: string, bundleTypeName: string, parents = new Set<string>()): void => {
    if (parents.has(bundleTypeName)) throw new Error(`cyclic generated bundle ${bundleTypeName}`);
    if (!Object.hasOwn(generatedBundles, bundleTypeName)) {
        throw new Error(`missing generated bundle ${bundleTypeName}`);
    }
    const bundle = generatedBundles[bundleTypeName];
    const nextParents = new Set(parents).add(bundleTypeName);
    for (const component of bundle.components) {
        if (component.typeName.startsWith("/Lotus/Types/StoreItems/Packages/")) {
            inspectCosmeticBundle(rootBundle, component.typeName, nextParents);
            continue;
        }
        const item = generatedItemByStoreItem.get(component.typeName);
        if (!item) throw new Error(`missing generated item for bundle leaf ${component.typeName}`);
        if (excludedBuiltIn.has(item.typeName) || excludedInternalHelpers.has(item.typeName)) continue;
        if (!emittedAppearanceStoreItems.has(item.storeItem) && !emittedStoreItems.decorations.has(item.storeItem)) {
            uncoveredCosmeticBundleLeaves.push({ bundle: rootBundle, leaf: item.storeItem });
        }
    }
};
for (const bundle of excludedBundleWrappers) inspectCosmeticBundle(bundle, bundle);
if (cosmeticBundleLeaks.length) {
    fail("cosmetic-bundle-leak", `${cosmeticBundleLeaks.length} cosmetic package wrappers are offered`);
}
if (uncoveredCosmeticBundleLeaves.length) {
    fail("cosmetic-bundle-leaf-coverage", `${uncoveredCosmeticBundleLeaves.length} usable leaves are unavailable`);
}

const appearanceAnchors: { pool: TDebugPool; storeItem: string }[] = [
    { pool: "operatorCompanionVehicleAppearance", storeItem: TEISATZ },
    { pool: "warframeAppearance", storeItem: XAKU_RAYA },
    { pool: "weaponAppearance", storeItem: IVARA_BALLISTICA },
    { pool: "profileEmotesInterface", storeItem: DRIPPY_BACKGROUND },
    { pool: "warframeAppearance", storeItem: NINTENDO_OPAL },
    { pool: "warframeAppearance", storeItem: PLAYSTATION_OBSIDIAN },
    { pool: "warframeAppearance", storeItem: XBOX_JADE }
];
const missingAppearanceAnchors = appearanceAnchors.filter(
    anchor => !emittedStoreItems[anchor.pool].has(anchor.storeItem)
);
if (missingAppearanceAnchors.length) {
    fail(
        "appearance-anchor-coverage",
        missingAppearanceAnchors.map(anchor => `${anchor.pool}:${anchor.storeItem}`).join(", ")
    );
}
if (!nightwaveDebugCatalog.excludedAppearanceBundles.includes(KANESHELL_BUNDLE)) {
    fail("bundle-wrapper-exclusion", "Kaneshell bundle wrapper was not excluded");
}

const cosmeticBundles = Object.entries(generatedBundles).filter(([, bundle]) => bundle.isCosmetic);
const acquisitionCases = [
    ...Object.values(generatedCosmetics).map(cosmetic => ({
        typeName: cosmetic.typeName,
        storeItem: cosmetic.storeItem
    })),
    ...cosmeticBundles.map(([typeName]) => ({ typeName, storeItem: typeName })),
    ...nightwaveDebugCatalog.arcanes.map(typeName => ({ typeName, storeItem: toDebugStoreItem(typeName) }))
];
const acquisitionFailures: { typeName: string; storeItem: string; error: string }[] = [];
let acquisitionPass = 0;
for (const item of acquisitionCases) {
    try {
        const inventory = new Inventory();
        const response = await handleStoreItemAcquisition(item.storeItem, inventory, 1);
        if (Object.keys(response.InventoryChanges).length == 0) {
            throw new Error("acquisition returned an empty inventory delta");
        }
        acquisitionPass += 1;
    } catch (error) {
        acquisitionFailures.push({
            ...item,
            error: error instanceof Error ? error.message : String(error)
        });
    }
}
if (acquisitionFailures.length) fail("direct-acquisition", `${acquisitionFailures.length} cases failed`);

// Verify the user's primary combination explicitly: Warframe and weapon appearance together.
setOnlyDebugPool("warframeAppearance");
config.worldState.nightwaveDebugShopWeaponAppearance = true;
const warframeAndWeaponManifest = getVendorManifestByTypeName(
    nightwaveDefinition.vendorManifest,
    false,
    buildVersionToInt(config.fallbackBuildLabel ?? "2026.08.19.11.06")
);
if (!warframeAndWeaponManifest) {
    throw new Error("combined Warframe and weapon appearance manifest was not generated");
}
const expectedWarframeAndWeapon = new Set([
    ...expectedStoreItems.warframeAppearance,
    ...expectedStoreItems.weaponAppearance
]);
const emittedWarframeAndWeapon = new Set(
    warframeAndWeaponManifest.VendorInfo.ItemManifest.map(offer => offer.StoreItem)
);
const warframeAndWeaponMissing = [...expectedWarframeAndWeapon].filter(
    storeItem => !emittedWarframeAndWeapon.has(storeItem)
);
const warframeAndWeaponUnexpected = [...emittedWarframeAndWeapon].filter(
    storeItem => !expectedWarframeAndWeapon.has(storeItem)
);
if (
    warframeAndWeaponMissing.length ||
    warframeAndWeaponUnexpected.length ||
    warframeAndWeaponManifest.VendorInfo.ItemManifest.length != expectedWarframeAndWeapon.size
) {
    fail(
        "warframe-and-weapon-combination",
        `expected=${expectedWarframeAndWeapon.size}; emitted=${warframeAndWeaponManifest.VendorInfo.ItemManifest.length}; missing=${warframeAndWeaponMissing.length}; unexpected=${warframeAndWeaponUnexpected.length}`
    );
}

// Exercise one offer from every pool through the real Nightwave vendor purchase dispatcher.
setOnlyDebugPool("all");
const allPoolsManifest = getVendorManifestByTypeName(
    nightwaveDefinition.vendorManifest,
    false,
    buildVersionToInt(config.fallbackBuildLabel ?? "2026.08.19.11.06")
);
if (!allPoolsManifest) throw new Error("combined Nightwave debug manifest was not generated");
const expectedCombinedStoreItems = new Set(Object.values(expectedStoreItems).flatMap(storeItems => [...storeItems]));
const emittedCombinedStoreItems = new Set(allPoolsManifest.VendorInfo.ItemManifest.map(offer => offer.StoreItem));
const combinedMissing = [...expectedCombinedStoreItems].filter(storeItem => !emittedCombinedStoreItems.has(storeItem));
const combinedUnexpected = [...emittedCombinedStoreItems].filter(
    storeItem => !expectedCombinedStoreItems.has(storeItem)
);
const combinedWrongCurrency = allPoolsManifest.VendorInfo.ItemManifest.filter(offer =>
    offer.ItemPrices?.some(price => price.ItemType != nightwaveDefinition.currency)
).map(offer => offer.StoreItem);
if (
    combinedMissing.length ||
    combinedUnexpected.length ||
    combinedWrongCurrency.length ||
    allPoolsManifest.VendorInfo.ItemManifest.length != expectedCombinedStoreItems.size
) {
    fail(
        "combined-manifest",
        `expected=${expectedCombinedStoreItems.size}; emitted=${allPoolsManifest.VendorInfo.ItemManifest.length}; missing=${combinedMissing.length}; unexpected=${combinedUnexpected.length}; wrongCurrency=${combinedWrongCurrency.length}`
    );
}
const dispatcherCases = [
    { pool: "warframeAppearance", storeItem: XAKU_RAYA },
    { pool: "weaponAppearance", storeItem: IVARA_BALLISTICA },
    { pool: "operatorCompanionVehicleAppearance", storeItem: TEISATZ },
    { pool: "profileEmotesInterface", storeItem: DRIPPY_BACKGROUND },
    { pool: "decorations", storeItem: toDebugStoreItem(nightwaveDebugCatalog.decorations[0]) },
    { pool: "arcanes", storeItem: toDebugStoreItem(nightwaveDebugCatalog.arcanes[0]) },
    { pool: "mods", storeItem: toDebugStoreItem(Object.keys(ExportUpgrades)[0]) }
] as const;
const dispatcherFailures: { pool: string; storeItem: string; error: string }[] = [];
let dispatcherPass = 0;
for (const item of dispatcherCases) {
    try {
        const advertisedOffer = allPoolsManifest.VendorInfo.ItemManifest.find(
            offer => offer.StoreItem == item.storeItem
        );
        if (!advertisedOffer) throw new Error("advertised offer is missing");
        const inventory = new Inventory();
        inventory.dontSubtractPurchaseItemCost = true;
        inventory.noVendorPurchaseLimits = true;
        const response = await handlePurchase(
            {
                PurchaseParams: {
                    Source: ePurchaseSource.Vendor,
                    SourceId: allPoolsManifest.VendorInfo._id.$oid,
                    StoreItem: item.storeItem,
                    Quantity: 1,
                    UsePremium: false,
                    ExtraPurchaseInfoJson: JSON.stringify({ ItemId: advertisedOffer.Id.$oid })
                },
                buildLabel: config.fallbackBuildLabel ?? "2026.08.19.11.06"
            },
            inventory
        );
        if (Object.keys(response.InventoryChanges).length == 0) {
            throw new Error("vendor purchase returned an empty inventory delta");
        }
        dispatcherPass += 1;
    } catch (error) {
        dispatcherFailures.push({ ...item, error: error instanceof Error ? error.message : String(error) });
    }
}
if (dispatcherFailures.length) fail("vendor-dispatch", `${dispatcherFailures.length} pool samples failed`);

// A client may keep Nora's shop open while its native rotation crosses a cycle boundary. The debug
// entries are always offered, so their advertised IDs must remain resolvable for the lifetime of the
// cached manifest. Comparing Mongo-style ID wrapper objects by reference used to discard the whole
// cache on the purchase lookup and regenerate every ID for the new cycle.
setOnlyDebugPool("warframeAppearance");
config.worldState.nightwaveDebugShopWeaponAppearance = true;
config.worldState.nightwaveDebugShopHideRegular = false;
const realDateNow = Date.now;
let crossCycleOfferRetained = false;
let crossCyclePurchaseDispatched = false;
let crossCycleAdvertisedOfferId: string | undefined;
let crossCycleResolvedOfferId: string | undefined;
try {
    const auditStart = Date.UTC(2030, 0, 1, 12);
    Date.now = (): number => auditStart;
    const advertisedManifest = getVendorManifestByTypeName(
        nightwaveDefinition.vendorManifest,
        config.fullyStockedVendors,
        buildVersionToInt(config.fallbackBuildLabel ?? "2026.08.19.11.06")
    );
    const advertisedOffer = advertisedManifest?.VendorInfo.ItemManifest.find(offer => offer.StoreItem == XAKU_RAYA);
    if (!advertisedManifest || !advertisedOffer) throw new Error("cross-cycle advertised offer is missing");
    crossCycleAdvertisedOfferId = advertisedOffer.Id.$oid;

    Date.now = (): number => auditStart + 8 * 24 * 60 * 60 * 1000;
    const purchaseManifest = getVendorManifestByOid(
        advertisedManifest.VendorInfo._id.$oid,
        buildVersionToInt(config.fallbackBuildLabel ?? "2026.08.19.11.06")
    );
    const resolvedOffer = purchaseManifest?.VendorInfo.ItemManifest.find(
        offer => offer.Id.$oid == crossCycleAdvertisedOfferId
    );
    crossCycleResolvedOfferId = resolvedOffer?.Id.$oid;
    crossCycleOfferRetained = resolvedOffer?.StoreItem == XAKU_RAYA;
    if (crossCycleOfferRetained) {
        const inventory = new Inventory();
        inventory.dontSubtractPurchaseItemCost = true;
        inventory.noVendorPurchaseLimits = true;
        const response = await handlePurchase(
            {
                PurchaseParams: {
                    Source: ePurchaseSource.Vendor,
                    SourceId: advertisedManifest.VendorInfo._id.$oid,
                    StoreItem: XAKU_RAYA,
                    Quantity: 1,
                    UsePremium: false,
                    ExtraPurchaseInfoJson: JSON.stringify({ ItemId: crossCycleAdvertisedOfferId })
                },
                buildLabel: config.fallbackBuildLabel ?? "2026.08.19.11.06"
            },
            inventory
        );
        crossCyclePurchaseDispatched = Object.keys(response.InventoryChanges).length > 0;
    }
} catch (error) {
    fail("cross-cycle-offer-identity", error instanceof Error ? error.message : String(error));
} finally {
    Date.now = realDateNow;
}
if (!crossCycleOfferRetained || !crossCyclePurchaseDispatched) {
    fail(
        "cross-cycle-offer-identity",
        `advertised=${crossCycleAdvertisedOfferId ?? "missing"}; resolved=${crossCycleResolvedOfferId ?? "missing"}; dispatched=${crossCyclePurchaseDispatched}`
    );
}

deinitLogger();

const categoryCounts = Object.values(generatedCosmetics).reduce<Record<string, number>>((counts, cosmetic) => {
    counts[cosmetic.productCategory] = (counts[cosmetic.productCategory] ?? 0) + 1;
    return counts;
}, {});
const report = {
    result: failures.length == 0 ? "PASS" : "FAIL",
    generatedCosmetics: Object.keys(generatedCosmetics).length,
    generatedCosmeticBundles: cosmeticBundles.length,
    publicExportArcanes: Object.keys(ExportArcanes).length,
    publicExportMods: Object.keys(ExportUpgrades).length,
    categoryCounts,
    debugCatalogCounts: {
        warframeAppearance: nightwaveDebugCatalog.warframeAppearance.length,
        weaponAppearance: nightwaveDebugCatalog.weaponAppearance.length,
        operatorCompanionVehicleAppearance: nightwaveDebugCatalog.operatorCompanionVehicleAppearance.length,
        profileEmotesInterface: nightwaveDebugCatalog.profileEmotesInterface.length,
        decorations: nightwaveDebugCatalog.decorations.length,
        arcanes: nightwaveDebugCatalog.arcanes.length,
        mods: Object.keys(ExportUpgrades).length,
        excludedBuiltInCosmetics: nightwaveDebugCatalog.excludedBuiltInCosmetics.length,
        excludedInternalHelpers: nightwaveDebugCatalog.excludedInternalHelpers.length,
        excludedAppearanceBundles: nightwaveDebugCatalog.excludedAppearanceBundles.length,
        excludedMixedBundles: nightwaveDebugCatalog.excludedMixedBundles.length
    },
    poolReports,
    overlaps,
    cosmeticBundleLeaks,
    uncoveredCosmeticBundleLeaves,
    leakedBuiltIns,
    leakedInternalHelpers,
    unclassifiedIndividuals,
    unexpectedClassifiedIndividuals,
    missingAppearanceAnchors,
    warframeAndWeaponCombination: {
        expected: expectedWarframeAndWeapon.size,
        emitted: warframeAndWeaponManifest.VendorInfo.ItemManifest.length,
        missing: warframeAndWeaponMissing,
        unexpected: warframeAndWeaponUnexpected
    },
    combinedManifest: {
        expected: expectedCombinedStoreItems.size,
        emitted: allPoolsManifest.VendorInfo.ItemManifest.length,
        missing: combinedMissing,
        unexpected: combinedUnexpected,
        wrongCurrency: combinedWrongCurrency
    },
    nativeZorbaDefinitionOffers: nativeZorba.items.length,
    emittedZorbaOffers: zorbaManifest.VendorInfo.ItemManifest.length,
    zorbaMissingNativeOffers,
    zorbaUnexpectedOffers,
    acquisitionCases: acquisitionCases.length,
    acquisitionPass,
    acquisitionFail: acquisitionFailures.length,
    acquisitionFailures,
    vendorDispatcherCases: dispatcherCases,
    vendorDispatcherPass: dispatcherPass,
    vendorDispatcherFail: dispatcherFailures.length,
    dispatcherFailures,
    crossCycleOfferIdentity: {
        retained: crossCycleOfferRetained,
        purchaseDispatched: crossCyclePurchaseDispatched,
        advertisedOfferId: crossCycleAdvertisedOfferId,
        resolvedOfferId: crossCycleResolvedOfferId
    },
    failures
};
console.log(JSON.stringify(report, null, 2));
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n");
console.log(`[nightwave-cosmetics] report=${outputPath}`);

if (failures.length) process.exitCode = 1;
