import { createHash } from "node:crypto";
import {
    generatedCosmetics,
    generatedItems,
    getGeneratedCosmetic,
    getGeneratedItem,
    itemRegistrySummary,
    selfTestGeneratedMetadata
} from "../../src/services/generatedMetadataService.ts";

if (!itemRegistrySummary) throw new Error("generated metadata has no itemRegistrySummary");

const entries = Object.entries(generatedItems);
const noExplicitServerRecord = entries
    .filter(([, item]) => item.serverRecordSource == "None")
    .map(([typeName]) => typeName)
    .sort();
const sha256Lines = (values: string[]): string =>
    createHash("sha256")
        .update(values.map(value => `${value}\n`).join(""), "utf8")
        .digest("hex");
const countBy = (values: string[]): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
    return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
};
const sameCounts = (a: Record<string, number>, b: Record<string, number>): boolean =>
    Object.keys(a).length == Object.keys(b).length && Object.entries(a).every(([key, value]) => b[key] == value);

const failures: string[] = [];
if (!selfTestGeneratedMetadata()) failures.push("generated metadata runtime self-test failed");
if (entries.length == 0) failures.push("generatedItems is empty");
if (itemRegistrySummary.admittedCount != entries.length)
    failures.push(`admitted count ${itemRegistrySummary.admittedCount} != records ${entries.length}`);
if (itemRegistrySummary.admittedCount + itemRegistrySummary.rejectedCount != itemRegistrySummary.storeWrapperCount)
    failures.push("admitted + rejected does not equal the store-wrapper denominator");
if (
    Object.values(itemRegistrySummary.rejectionCounts).reduce((sum, count) => sum + count, 0) !=
    itemRegistrySummary.rejectedCount
)
    failures.push("rejection reason counts do not equal rejectedCount");
if (itemRegistrySummary.rejectionSha256.length != 64) failures.push("rejectionSha256 is not a SHA-256 hex length");
if (itemRegistrySummary.noExplicitServerRecordCount != noExplicitServerRecord.length)
    failures.push("no-explicit-server-record count does not match records");
if (itemRegistrySummary.noExplicitServerRecordSha256 != sha256Lines(noExplicitServerRecord))
    failures.push("no-explicit-server-record hash does not match canonical sorted paths");
if (!sameCounts(itemRegistrySummary.categoryCounts, countBy(entries.map(([, item]) => item.productCategory))))
    failures.push("category counts do not match generated items");
if (
    !sameCounts(
        itemRegistrySummary.serverRecordSourceCounts,
        countBy(entries.map(([, item]) => item.serverRecordSource))
    )
)
    failures.push("server-record-source counts do not match generated items");

const seenStoreItems = new Set<string>();
for (const [typeName, item] of entries) {
    const expectedStore = `/Lotus/StoreItems/${typeName.slice("/Lotus/".length)}`;
    if (typeName != item.typeName) failures.push(`${typeName}: map key differs from typeName`);
    if (!typeName.startsWith("/Lotus/") || typeName.startsWith("/Lotus/StoreItems/"))
        failures.push(`${typeName}: invalid inventory path`);
    if (item.storeItem != expectedStore) failures.push(`${typeName}: non-mirrored store path ${item.storeItem}`);
    if (seenStoreItems.has(item.storeItem)) failures.push(`${typeName}: duplicate store path ${item.storeItem}`);
    seenStoreItems.add(item.storeItem);
    if (!item.productCategory) failures.push(`${typeName}: empty ProductCategory`);
    if (!item.localizeTag.startsWith("/")) failures.push(`${typeName}: localization is not absolute`);
    if (!item.categorySourcePath.startsWith("/")) failures.push(`${typeName}: category owner is not absolute`);
    if (!item.localizationSourcePath.startsWith("/")) failures.push(`${typeName}: localization owner is not absolute`);
    if (
        new Set(item.publicExportDatasets).size != item.publicExportDatasets.length ||
        JSON.stringify(item.publicExportDatasets) != JSON.stringify([...item.publicExportDatasets].sort())
    )
        failures.push(`${typeName}: Public Export dataset list is not sorted and unique`);

    const cosmetic = getGeneratedCosmetic(typeName);
    if (item.serverRecordSource == "GeneratedCosmetic") {
        if (
            !cosmetic ||
            cosmetic.storeItem != item.storeItem ||
            cosmetic.productCategory != item.productCategory ||
            cosmetic.localizeTag != item.localizeTag
        )
            failures.push(`${typeName}: GeneratedCosmetic source disagrees with generated cosmetic record`);
    } else if (item.serverRecordSource == "PublicExport") {
        if (item.publicExportDatasets.length == 0)
            failures.push(`${typeName}: PublicExport source has no dataset evidence`);
    } else {
        if (cosmetic != undefined || item.publicExportDatasets.length != 0)
            failures.push(`${typeName}: None source conflicts with explicit record evidence`);
    }
}
for (const typeName of Object.keys(generatedCosmetics)) {
    if (getGeneratedItem(typeName)?.serverRecordSource != "GeneratedCosmetic")
        failures.push(`${typeName}: generated cosmetic is absent from complete item registry`);
}

console.log(
    JSON.stringify(
        {
            publicExportPackageVersion: itemRegistrySummary.publicExportPackageVersion,
            decodedTypes: itemRegistrySummary.decodedTypeCount,
            storeWrapperDenominator: itemRegistrySummary.storeWrapperCount,
            exactPairs: itemRegistrySummary.exactPairCount,
            admitted: itemRegistrySummary.admittedCount,
            rejected: itemRegistrySummary.rejectedCount,
            rejectionSha256: itemRegistrySummary.rejectionSha256,
            rejectionCounts: itemRegistrySummary.rejectionCounts,
            categoryCounts: itemRegistrySummary.categoryCounts,
            serverRecordSourceCounts: itemRegistrySummary.serverRecordSourceCounts,
            noExplicitServerRecordCount: noExplicitServerRecord.length,
            noExplicitServerRecordSha256: itemRegistrySummary.noExplicitServerRecordSha256,
            generatedCosmeticsCovered: Object.keys(generatedCosmetics).length,
            failures: failures.length
        },
        null,
        2
    )
);
for (const failure of failures) console.error(`[generated-item-registry-audit] FAIL ${failure}`);
if (failures.length != 0) process.exitCode = 1;
