import fs from "node:fs";
import path from "node:path";
import { config, loadConfig } from "../../src/services/configService.ts";
import { generatedItems, getGeneratedItemPrice } from "../../src/services/generatedMetadataService.ts";
import {
    getItemCategoryByUniqueName,
    getItemName,
    getPrice,
    getProductCategory
} from "../../src/services/itemDataService.ts";
import { deinitLogger, initLogger } from "../../src/utils/logger.ts";

type TFailure = {
    typeName: string;
    field: "Name" | "Category" | "PremiumPrice" | "RegularPrice";
    expected: string | number;
    actual?: string | number;
    error?: string;
};

const option = (name: string): string | undefined => {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 ? process.argv[index + 1] : undefined;
};
const outputPath = path.resolve(
    option("output") ?? path.join(process.cwd(), "tmp/audits/generated-commerce-audit.json")
);

loadConfig();
config.logger.files = false;
config.logger.consoleLevel = "error";
initLogger();

const failures: TFailure[] = [];
let premiumPriceTests = 0;
let regularPriceTests = 0;
let generatedFallbackItems = 0;
let explicitlyMarketVisible = 0;
let marketVisibleWithoutDirectPrice = 0;
const integrationCandidates: { typeName: string; storeItem: string; usePremium: boolean; expected: number }[] = [];

for (const item of Object.values(generatedItems)) {
    const name = getItemName(item.typeName);
    const category = getItemCategoryByUniqueName(item.typeName);
    let publicProductCategory: string | undefined;
    try {
        publicProductCategory = getProductCategory(item.typeName);
    } catch {
        // Recorded as a category failure below.
    }
    if (name == undefined) failures.push({ typeName: item.typeName, field: "Name", expected: item.localizeTag });
    if (category == undefined || publicProductCategory == undefined) {
        failures.push({
            typeName: item.typeName,
            field: "Category",
            expected: item.productCategory,
            actual: category ?? publicProductCategory
        });
    }

    if (item.serverRecordSource != "PublicExport") generatedFallbackItems++;
    const metadata = item.effectiveMetadata ?? {};
    const explicitlyVisible = metadata.ShowInMarket == "1" || metadata.MarketMode == "MM_VISIBLE";
    const explicitlyHidden = metadata.ShowInMarket == "0" || metadata.MarketMode == "MM_HIDDEN";
    if (explicitlyVisible && !explicitlyHidden) {
        explicitlyMarketVisible++;
        if (!Object.hasOwn(metadata, "PremiumPrice") && !Object.hasOwn(metadata, "RegularPrice"))
            marketVisibleWithoutDirectPrice++;
    }

    // Existing Public Export records intentionally remain authoritative. Exercise the generated
    // fallback only where there is no explicit public item dataset.
    if (item.serverRecordSource == "PublicExport") continue;
    for (const [field, usePremium] of [
        ["PremiumPrice", true],
        ["RegularPrice", false]
    ] as const) {
        if (!Object.hasOwn(metadata, field)) continue;
        const raw = metadata[field];
        const expected = Number(raw);
        if (!Number.isSafeInteger(expected) || expected < 0) continue;
        if (usePremium) premiumPriceTests++;
        else regularPriceTests++;
        const actual = getGeneratedItemPrice(item.typeName, usePremium);
        if (actual != expected) failures.push({ typeName: item.typeName, field, expected, actual });
        if (!integrationCandidates.some(candidate => candidate.usePremium == usePremium)) {
            integrationCandidates.push({ typeName: item.typeName, storeItem: item.storeItem, usePremium, expected });
        }
    }
}

for (const candidate of integrationCandidates) {
    const field = candidate.usePremium ? "PremiumPrice" : "RegularPrice";
    try {
        const actual = getPrice(
            candidate.storeItem,
            1,
            0,
            candidate.usePremium,
            config.fallbackBuildLabel ?? "2026.07.11.00.00"
        );
        if (actual != candidate.expected) {
            failures.push({ typeName: candidate.typeName, field, expected: candidate.expected, actual });
        }
    } catch (error) {
        failures.push({
            typeName: candidate.typeName,
            field,
            expected: candidate.expected,
            error: error instanceof Error ? error.message : String(error)
        });
    }
}

const summary = {
    denominator: Object.keys(generatedItems).length,
    generatedFallbackItems,
    nameLookups: Object.keys(generatedItems).length,
    categoryLookups: Object.keys(generatedItems).length,
    premiumPriceTests,
    regularPriceTests,
    explicitlyMarketVisible,
    marketVisibleWithoutDirectPrice,
    integrationPriceTests: integrationCandidates.length,
    failed: failures.length
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify({ summary, failures }, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
console.log(`[generated-commerce] report=${outputPath}`);
deinitLogger();
if (failures.length != 0) process.exitCode = 1;
