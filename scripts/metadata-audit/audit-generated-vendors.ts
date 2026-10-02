import { buildVersionToInt } from "../../src/helpers/versionHelper.ts";
import fs from "node:fs";
import path from "node:path";
import { Types } from "mongoose";
import { Inventory } from "../../src/models/inventoryModels/inventoryModel.ts";
import { BL_LATEST } from "../../src/constants/gameVersions.ts";
import { catBreadHash } from "../../src/helpers/stringHelpers.ts";
import { ePurchaseSource } from "../../src/types/purchaseTypes.ts";
import { config, loadConfig } from "../../src/services/configService.ts";
import { generatedVendors, selfTestGeneratedMetadata } from "../../src/services/generatedMetadataService.ts";
import { getVendorManifestByOid, getVendorManifestByTypeName } from "../../src/services/serversideVendorsService.ts";
import { handlePurchase } from "../../src/services/purchaseService.ts";
import { deinitLogger, initLogger } from "../../src/utils/logger.ts";

type TFailure = { vendor: string; check: string; detail: string };

const option = (name: string): string | undefined => {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 ? process.argv[index + 1] : undefined;
};
const outputPath = path.resolve(
    option("output") ?? path.join(process.cwd(), "tmp/audits/generated-vendor-runtime-audit.json")
);
const oidForVendor = (typeName: string): string =>
    "5be4a159b144f3cd" + catBreadHash(typeName).toString(16).padStart(8, "0");

loadConfig();
config.logger.files = false;
config.logger.consoleLevel = "error";
config.fullyStockedVendors = false;
if (config.worldState) {
    config.worldState.nightwaveDebugShopWarframeAppearance = false;
    config.worldState.nightwaveDebugShopWeaponAppearance = false;
    config.worldState.nightwaveDebugShopOperatorCompanionVehicleAppearance = false;
    config.worldState.nightwaveDebugShopProfileEmotesInterface = false;
    config.worldState.nightwaveDebugShopDecorations = false;
    config.worldState.nightwaveDebugShopArcanes = false;
    config.worldState.nightwaveDebugShopMods = false;
}
initLogger();

const failures: TFailure[] = [];
const fail = (vendor: string, check: string, detail: string): void => {
    failures.push({ vendor, check, detail });
};
const vendors = Object.entries(generatedVendors).sort(([a], [b]) => a.localeCompare(b));
const buildLabel = config.fallbackBuildLabel ?? BL_LATEST;
let nativeOfferDefinitions = 0;
let expectedFullStockOffers = 0;
let normalOffers = 0;
let fullStockOffers = 0;
let oidLookups = 0;

try {
    if (!selfTestGeneratedMetadata())
        fail("*", "generated-metadata-self-test", "selfTestGeneratedMetadata returned false");

    for (const [typeName, vendor] of vendors) {
        nativeOfferDefinitions += vendor.items.length;
        const expectedFull = vendor.items.reduce((sum, offer) => sum + 1 + offer.duplicates, 0);
        expectedFullStockOffers += expectedFull;

        const normal = getVendorManifestByTypeName(typeName, false, buildVersionToInt(buildLabel));
        const full = getVendorManifestByTypeName(typeName, true, buildVersionToInt(buildLabel));
        if (!normal) {
            fail(typeName, "normal-manifest", "getVendorManifestByTypeName returned undefined");
            continue;
        }
        if (!full) {
            fail(typeName, "full-stock-manifest", "getVendorManifestByTypeName returned undefined");
            continue;
        }
        normalOffers += normal.VendorInfo.ItemManifest.length;
        fullStockOffers += full.VendorInfo.ItemManifest.length;
        const expectedNormalUpperBound = vendor.items.some(offer => !!offer.numRandomItemPrices)
            ? Math.max(expectedFull, vendor.numItems?.maxValue ?? expectedFull)
            : expectedFull;
        if (normal.VendorInfo.TypeName != typeName)
            fail(typeName, "normal-type", `returned ${normal.VendorInfo.TypeName}`);
        if (
            normal.VendorInfo.ItemManifest.length == 0 ||
            normal.VendorInfo.ItemManifest.length > expectedNormalUpperBound
        )
            fail(
                typeName,
                "normal-count",
                `got ${normal.VendorInfo.ItemManifest.length}; expected within 1..${expectedNormalUpperBound}`
            );
        if (full.VendorInfo.ItemManifest.length != expectedFull)
            fail(typeName, "full-stock-count", `got ${full.VendorInfo.ItemManifest.length}; expected ${expectedFull}`);
        if (
            full.VendorInfo.ItemManifest.some(
                offer =>
                    !offer.StoreItem.startsWith("/Lotus/") ||
                    offer.QuantityMultiplier <= 0 ||
                    !/^BIN_\d+$/.test(offer.Bin) ||
                    offer.Id.$oid.length != 24
            )
        )
            fail(typeName, "client-offer-shape", "one or more generated client offers are structurally invalid");

        const byOid = getVendorManifestByOid(oidForVendor(typeName), buildVersionToInt(buildLabel));
        if (!byOid || byOid.VendorInfo.TypeName != typeName)
            fail(typeName, "oid-lookup", byOid ? `returned ${byOid.VendorInfo.TypeName}` : "returned undefined");
        else oidLookups++;
    }

    const amirPath = "/Lotus/Types/Game/VendorManifests/TheHex/AmirNightwaveVendorManifest";
    if (!Object.hasOwn(generatedVendors, amirPath)) {
        fail(amirPath, "source", "current-client Amir vendor was not generated");
    } else {
        const amir = generatedVendors[amirPath];
        const normal = getVendorManifestByTypeName(amirPath, false, buildVersionToInt(buildLabel));
        const full = getVendorManifestByTypeName(amirPath, true, buildVersionToInt(buildLabel));
        if (amir.items.length != 48) fail(amirPath, "definition-count", `got ${amir.items.length}; expected 48`);
        if (normal?.VendorInfo.ItemManifest.length != 20)
            fail(amirPath, "normal-count", `got ${String(normal?.VendorInfo.ItemManifest.length)}; expected 20`);
        if (full?.VendorInfo.ItemManifest.length != 48)
            fail(amirPath, "full-count", `got ${String(full?.VendorInfo.ItemManifest.length)}; expected 48`);
        if (amir.items.some(offer => offer.syndicate?.tag != "HexSyndicate" || offer.syndicate.standingCost <= 0))
            fail(amirPath, "standing-contract", "one or more offers lost the exact Hex standing price");

        // Exercise one real purchase through the same OID manifest, acquisition, and standing-deduction
        // path used by the client. The chosen sigil is a context-free inventory item.
        config.fullyStockedVendors = true;
        const purchaseManifest = getVendorManifestByOid(oidForVendor(amirPath), buildVersionToInt(buildLabel));
        const offer = purchaseManifest?.VendorInfo.ItemManifest.find(
            item => item.StoreItem == "/Lotus/StoreItems/Upgrades/Skins/Sigils/NightwavePizzaSigil"
        );
        if (!offer) {
            fail(amirPath, "purchase-offer", "known current-client sigil offer was not generated");
        } else {
            const inventory = new Inventory({
                accountOwnerId: new Types.ObjectId(),
                Affiliations: [{ Tag: "HexSyndicate", Standing: 100_000, Title: 5 }]
            });
            const response = await handlePurchase(
                {
                    PurchaseParams: {
                        Source: ePurchaseSource.Vendor,
                        SourceId: oidForVendor(amirPath),
                        StoreItem: offer.StoreItem,
                        Quantity: 1,
                        UsePremium: false,
                        ExtraPurchaseInfoJson: JSON.stringify({ ItemId: offer.Id.$oid })
                    },
                    buildLabel
                },
                inventory
            );
            const standing = inventory.Affiliations.find(entry => entry.Tag == "HexSyndicate")?.Standing;
            if (standing != 95_000) fail(amirPath, "purchase-standing", `got ${String(standing)}; expected 95000`);
            if (response.Standing?.[0]?.Standing != 5_000)
                fail(amirPath, "purchase-response", `got ${String(response.Standing?.[0]?.Standing)}; expected 5000`);
            if (!response.InventoryChanges.WeaponSkins)
                fail(amirPath, "purchase-acquisition", "sigil purchase produced no WeaponSkins delta");
        }
    }

    const entratiTasksPath = "/Lotus/Types/Game/VendorManifests/EntratiLabs/EntratiLabsCommisionsManifest";
    const entratiTasks = getVendorManifestByTypeName(entratiTasksPath, false, buildVersionToInt(buildLabel));
    if (entratiTasks?.VendorInfo.ItemManifest.length != 5)
        fail(
            entratiTasksPath,
            "randomized-template-count",
            `got ${String(entratiTasks?.VendorInfo.ItemManifest.length)}; exact NumItemsAvailable requires 5`
        );

    const summary = {
        vendors: vendors.length,
        nativeOfferDefinitions,
        expectedFullStockOffers,
        normalOffers,
        fullStockOffers,
        oidLookups,
        amirPurchase: failures.some(failure => failure.vendor.includes("Amir")) ? "Failed" : "Supported",
        failed: failures.length
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify({ summary, failures }, null, 2) + "\n");
    console.log(JSON.stringify(summary, null, 2));
    console.log(`[generated-vendor-runtime] report=${outputPath}`);
    if (failures.length != 0) process.exitCode = 1;
} finally {
    deinitLogger();
}
