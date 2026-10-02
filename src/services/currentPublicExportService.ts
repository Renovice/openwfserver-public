import {
    ExportResources,
    ExportRecipes,
    ExportWarframes,
    ExportWeapons,
    ExportUpgrades,
    ExportRelics,
    ExportRewards,
    ExportKeys,
    dict_en
} from "warframe-public-export-plus";
import current from "../../static/generated/openwf-metadata/current-public-export.json" with { type: "json" };

// This module is imported before itemDataService's existing overrides. Existing
// PE+ records and local corrections retain precedence; only missing records are added.
const tables: Partial<Record<string, Record<string, unknown>>> = {
    ExportResources,
    ExportRecipes,
    ExportWarframes,
    ExportWeapons,
    ExportUpgrades,
    ExportRelics,
    ExportRewards,
    ExportKeys
};
for (const [tag, text] of Object.entries(current.dictionary)) {
    if (!Object.hasOwn(dict_en, tag)) dict_en[tag] = text;
}
for (const [dataset, records] of Object.entries(current.datasets)) {
    const table = tables[dataset];
    if (!table) throw new Error(`Unknown generated dataset ${dataset}`);
    for (const [typeName, record] of Object.entries(records)) {
        if (!typeName.startsWith("/Lotus/")) throw new Error(`Invalid current item path ${typeName}`);
        if (!Object.hasOwn(table, typeName)) table[typeName] = record;
    }
}
export const currentRivenContracts = current.rivenContracts;
/** Unrollable physical Riven traits per weapon (generated: market evidence, PE+ riven_unrollables, decoded client). */
export const currentRivenPhysicalRules: Readonly<Record<string, readonly string[]>> = current.rivenPhysicalRules;

// Preserve existing challenge/compatibility metadata, refresh trait coefficients
// and eligibility from the current client. Advanced traits never enter normal RNG.
for (const [typeName, contract] of Object.entries(currentRivenContracts)) {
    const item = (ExportUpgrades as Partial<typeof ExportUpgrades>)[typeName];
    if (!item) throw new Error(`Missing Riven type ${typeName}`);
    // All weapons this Riven type can be for; unveiling picks from the normal or companion list by IsSentinel.
    const compatibleItems = [...new Set([...contract.compatibleItems, ...contract.sentinelCompatibleItems])];
    Object.assign(item, { upgradeEntries: contract.entries, compatibleItems });
}
type CurrentRivenContract = (typeof currentRivenContracts)[keyof typeof currentRivenContracts];
export const getCurrentRivenContract = (meta: object): CurrentRivenContract | undefined => {
    const typeName = Object.keys(currentRivenContracts).find(key => ExportUpgrades[key] === meta);
    return typeName ? currentRivenContracts[typeName as keyof typeof currentRivenContracts] : undefined;
};
