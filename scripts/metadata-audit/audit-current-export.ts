import assert from "node:assert/strict";
import current from "../../static/generated/openwf-metadata/current-public-export.json" with { type: "json" };
import { currentRivenContracts } from "../../src/services/currentPublicExportService.ts";
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
import {
    getExportKeys,
    getExportResources,
    getExportRecipes,
    getExportWarframes,
    getExportWeapons,
    getExportUpgrades,
    getExportRelicArcane
} from "../../src/services/publicExportService.ts";
import {
    createUnveiledRivenFingerprint,
    randomiseRivenStats,
    resolveRivenCycleLocks
} from "../../src/helpers/rivenHelper.ts";
import { loadConfig } from "../../src/services/configService.ts";

loadConfig();
const tables = {
    ExportResources,
    ExportRecipes,
    ExportWarframes,
    ExportWeapons,
    ExportUpgrades,
    ExportRelics,
    ExportRewards,
    ExportKeys
};
for (const [name, rows] of Object.entries(current.datasets)) {
    const table = tables[name as keyof typeof tables] as Record<string, unknown>;
    for (const key of Object.keys(rows)) assert.ok(table[key], `${name}: missing ${key}`);
}
for (const key of Object.keys(current.datasets.ExportResources)) assert.ok(ExportResources[key].productCategory);
for (const key of [...Object.keys(current.datasets.ExportWarframes), ...Object.keys(current.datasets.ExportWeapons)]) {
    const item = ExportWarframes[key] ?? ExportWeapons[key];
    assert.ok(item.name && dict_en[item.name], `Missing localized name: ${key}`);
    assert.ok(Object.hasOwn(item, "productCategory") && item.parentName, `Incomplete equipment: ${key}`);
}
for (const key of Object.keys(current.datasets.ExportRelics)) {
    const relic = ExportRelics[key];
    assert.ok(["VPQ_BRONZE", "VPQ_SILVER", "VPQ_GOLD", "VPQ_PLATINUM"].includes(relic.quality));
    assert.equal(ExportRewards[relic.rewardManifest][0].length, 6, key);
    assert.deepEqual(ExportRewards[relic.rewardManifest][0].map(row => row.rarity).sort(), [
        "COMMON",
        "COMMON",
        "COMMON",
        "RARE",
        "UNCOMMON",
        "UNCOMMON"
    ]);
}
// Exercise the actual serializers; merely inserting JSON can hide shape errors.
for (const output of [
    getExportKeys("en"),
    getExportResources("en"),
    getExportRecipes(),
    getExportWarframes("en"),
    getExportWeapons("en"),
    getExportUpgrades("en"),
    getExportRelicArcane("en")
]) {
    assert.ok(JSON.stringify(output).length > 10);
}
let rolls = 0;
for (const [type, contract] of Object.entries(currentRivenContracts)) {
    const meta = ExportUpgrades[type];
    assert.ok(contract.compatibleItems.length);
    const advanced = new Set(contract.entries.filter(entry => entry.isAdvancedTrait).map(entry => entry.tag));
    for (let i = 0; i < 200; i++) {
        const fp = createUnveiledRivenFingerprint(meta, undefined);
        const before = structuredClone(fp);
        const all = [...fp.buffs, ...fp.curses];
        assert.equal(new Set(all.map(s => s.Tag)).size, all.length);
        assert.ok(all.every(s => !advanced.has(s.Tag) && s.Value >= 0 && s.Value < 0x40000000));
        const tags = all.filter((_, index) => index % 2 === 0).map(s => s.Tag);
        randomiseRivenStats(meta, fp, tags);
        assert.equal(fp.buffs.length, before.buffs.length);
        assert.equal(fp.curses.length, before.curses.length);
        for (const tag of tags)
            assert.deepEqual(
                [...fp.buffs, ...fp.curses].find(s => s.Tag === tag),
                all.find(s => s.Tag === tag)
            );
        const frozen = structuredClone(fp);
        randomiseRivenStats(
            meta,
            fp,
            [...fp.buffs, ...fp.curses].map(s => s.Tag)
        );
        assert.deepEqual(fp, frozen);
        assert.equal(resolveRivenCycleLocks(meta, fp, tags).costMultiplier, 2 * tags.length);
        assert.throws(() => resolveRivenCycleLocks(meta, fp, ["absent"]));
        rolls++;
    }
    const tag = contract.entries.find(entry => entry.isAdvancedTrait && entry.canBeBuff)?.tag;
    if (tag) {
        const fp = createUnveiledRivenFingerprint(meta, undefined);
        fp.buffs[0] = { Tag: tag, Value: 123456 };
        const lock = resolveRivenCycleLocks(meta, fp, []);
        assert.equal(lock.costMultiplier, 1);
        assert.ok(lock.tags.includes(tag));
        randomiseRivenStats(meta, fp, lock.tags);
        assert.deepEqual(
            fp.buffs.find(s => s.Tag === tag),
            { Tag: tag, Value: 123456 }
        );
        assert.ok(!resolveRivenCycleLocks(meta, fp, [], [tag]).tags.includes(tag));
    }
}
assert.ok(ExportResources["/Lotus/Types/Gameplay/Zariman/Resources/EntropicKuvaItem"]);
assert.ok(ExportResources["/Lotus/Types/Items/MiscItems/RivenSplicer"]);
console.log(
    JSON.stringify({
        status: "PASS",
        datasetCounts: Object.fromEntries(Object.entries(current.datasets).map(([k, v]) => [k, Object.keys(v).length])),
        rivenTypes: Object.keys(currentRivenContracts).length,
        rolls,
        serializers: 7
    })
);
