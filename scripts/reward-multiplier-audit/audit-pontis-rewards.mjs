// Run the production reward functions in isolation: no database, account, or server startup.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { ExportRegions, ExportRewards, ExportRelics } from "warframe-public-export-plus";
import { buildVersionToInt, wikiDateToBuildVersionInt } from "../../src/helpers/versionHelper.ts";
import { SRng, getRandomReward } from "../../src/services/rngService.ts";
import {
    getPrivateServerMissionRewardSourceMultiplier,
    scalePrivateServerRewardItemCount,
    selectPrivateServerMissionRewardSubcomponentSource
} from "../../src/services/privateServerTuningService.ts";

const root = new URL("../../", import.meta.url);
const filename = "src/services/missionInventoryUpdateService.ts";
const baseline = process.argv.includes("--baseline");
const baselineRefIndex = process.argv.indexOf("--baseline-ref");
const baselineRef =
    baselineRefIndex >= 0 ? process.argv[baselineRefIndex + 1] : "9596ce47a54282ecb173b36ae9419500c2ef4593";
const source = baseline
    ? execFileSync("git", ["show", `${baselineRef}:${filename}`], { cwd: root, encoding: "utf8" })
    : fs.readFileSync(new URL(filename, root), "utf8");
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
const names = [
    "getRotations",
    "getRandomRewardByChance",
    "getRandomMissionDrops",
    "scaleMissionRewards",
    "addFixedLevelRewards"
];
const selected = ast.statements.filter(statement => {
    const name = ts.isFunctionDeclaration(statement)
        ? statement.name?.text
        : ts.isVariableStatement(statement)
          ? statement.declarationList.declarations[0].name.getText(ast)
          : undefined;
    return names.includes(name);
});
assert.equal(selected.length, names.length);
const js = ts.transpile(selected.map(s => s.getText(ast).replace(/^export /, "")).join("\n"), {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None
});
let endpoint = "min";
const context = vm.createContext({
    ExportRewards,
    ExportRelics,
    buildVersionToInt,
    wikiDateToBuildVersionInt,
    SRng,
    getRandomReward,
    getRandomInt: (min, max) => (endpoint === "min" ? min : max),
    generateRewardSeed: () => 123n,
    getRegion: async node => ExportRegions[node],
    fromStoreItem: type => type.replace("/Lotus/StoreItems/", "/Lotus/"),
    getMissionDeck: name => ExportRewards[name],
    gameToBuildVersion: { "27.2.0": "2020.03.05.00.00" },
    shouldDoServerQol: () => true,
    logger: {
        debug() {},
        error(message) {
            throw new Error(message);
        }
    },
    getPrivateServerMissionRewardSourceMultiplier,
    scalePrivateServerRewardItemCount,
    selectPrivateServerMissionRewardSubcomponentSource
});
vm.runInContext(js, context);
const generate = vm.runInContext("getRandomMissionDrops", context);
const scale = vm.runInContext("scaleMissionRewards", context);
const fixed = vm.runInContext("addFixedLevelRewards", context);
const defaultSource = { path: "missionType", missionType: "MT_RAILJACK" };
const failures = [];
let passed = 0;
async function check(name, test) {
    try {
        await test();
        passed++;
    } catch (error) {
        failures.push({ name, error: error.message });
    }
}
async function run(node, tier, completes = 1, qualifications = "") {
    const sources = new Map();
    const rewards = await generate(
        "2026.09.23.00.00",
        {},
        { node, rewardQualifications: qualifications, rewardSeed: 123n },
        undefined,
        { Tag: node, Tier: tier, Completes: completes },
        undefined,
        false,
        1,
        ExportRegions[node],
        defaultSource,
        sources
    );
    return { rewards, sources };
}
for (const [node, resource] of [
    ["CrewBattleNode560", "AshFavor"],
    ["CrewBattleNode561", "GarudaFavor"]
]) {
    for (const tier of [0, 1]) {
        for (const edge of ["min", "max"]) {
            await check(`${node} tier=${tier} ${edge}: complete rewards and one x3 pass`, async () => {
                endpoint = edge;
                const { rewards, sources } = await run(node, tier);
                const talent = rewards.filter(r => r.StoreItem.endsWith(`/${resource}`));
                assert.equal(talent.length, 1, "missing guaranteed Talent payout");
                const count = tier ? (edge === "min" ? 18 : 22) : edge === "min" ? 12 : 16;
                assert.equal(talent[0].ItemCount, count);
                assert.equal(rewards.filter(r => r.StoreItem.includes("/Recipes/")).length, 1, "missing blueprint");
                assert.equal(rewards.filter(r => r.StoreItem.includes("/CosmeticEnhancers/")).length, 1);
                assert.equal(rewards.find(r => r.StoreItem.endsWith("/SteelEssence"))?.ItemCount ?? 0, tier ? 2 : 0);
                scale(
                    rewards,
                    { railjackMissionRewardMultiplier: 3, railjackEndOfMissionBonusResourceBundleMultiplier: 3 },
                    defaultSource,
                    sources
                );
                assert.equal(talent[0].ItemCount, count * 3, "multiplier must apply exactly once");
            });
        }
    }
    await check(`${node}: incomplete report cannot grant completion Talents or blueprint`, async () => {
        const { rewards } = await run(node, 1, 0);
        assert.equal(
            rewards.filter(
                r =>
                    r.StoreItem.endsWith(`/${resource}`) ||
                    r.StoreItem.endsWith("/SteelEssence") ||
                    r.StoreItem.includes("/Recipes/")
            ).length,
            0
        );
    });
    await check(`${node}: stale rotation string does not duplicate completion rewards`, async () => {
        const { rewards } = await run(node, 1, 1, "AAAA");
        assert.equal(rewards.filter(r => r.StoreItem.includes("/Recipes/")).length, 1);
    });
}
await check("ordinary Railjack keeps two independent resource bundle rolls", async () => {
    // Force the first item on both rolls so sampling without replacement is detectable.
    context.SRng = class extends SRng {
        randomReward(pool) {
            return pool[0];
        }
    };
    const node = Object.keys(ExportRegions).find(
        n =>
            n.startsWith("CrewBattleNode") &&
            ExportRegions[n].faction === "FC_GRINEER" &&
            ExportRegions[n].rewardManifests.length
    );
    const { rewards, sources } = await run(node, 1, 1, "A");
    const bundles = rewards.filter(r => sources.get(r)?.path === "railjackEndOfMissionBonusResourceBundle");
    assert.equal(bundles.length, 2);
    assert.equal(bundles[0].StoreItem, bundles[1].StoreItem);
    assert.equal(rewards.filter(r => r.StoreItem.endsWith("/SteelEssence")).length, 1);
    assert.equal(rewards.filter(r => /\/(AshFavor|GarudaFavor)$/.test(r.StoreItem)).length, 0);
    context.SRng = SRng;
});
await check("Long Shadow fixed reward rolls once despite four defense rotations", async () => {
    const rewards = [];
    await fixed(
        { droptable: "/Lotus/Types/Game/MissionDecks/ProjectNightwatchBonusRewards" },
        rewards,
        "2026.09.23.00.00",
        { node: "SolNode18", rewardQualifications: "AAAA" }
    );
    assert.equal(rewards.length, 1);
});
console.log(JSON.stringify({ baseline, passed, failures }, null, 2));
process.exitCode = failures.length ? 1 : 0;
