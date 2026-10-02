/* eslint-disable */
"use strict";
// Replay the production controller with request/clock/save mocks and REAL
// acquisition into fresh Mongoose documents. No DB connection or player writes.
const fs = require("node:fs"),
    path = require("node:path"),
    vm = require("node:vm"),
    assert = require("node:assert/strict"),
    { pathToFileURL } = require("node:url");
const ts = require("typescript");
const repo = path.resolve(__dirname, "../..");
const importSource = relative => import(pathToFileURL(path.join(repo, relative)).href);
async function main() {
    const { config, loadConfig } = await importSource("src/services/configService.ts");
    const policy = await importSource("src/services/privateServerTuningService.ts");
    const { handleStoreItemAcquisition } = await importSource("src/services/purchaseService.ts");
    const { Inventory } = await importSource("src/models/inventoryModels/inventoryModel.ts");
    const { Types } = require("mongoose");
    const { initLogger, deinitLogger } = await importSource("src/utils/logger.ts");
    loadConfig();
    config.logger.files = false;
    config.logger.consoleLevel = "error";
    initLogger();
    const originalTuning = config.privateServerTuning;
    const email = "calendar-fixture@invalid.local";
    const baselineTuning = {
        enabled: true,
        targetEmails: [email],
        calendar1999RewardMultiplier: 3,
        archonHuntRewardMultiplier: 17,
        bountyRewardMultiplier: 19,
        kuvaRewardMultiplier: 10,
        dailyLoginMultiplier: 23
    };
    const source = fs.readFileSync(path.join(repo, "src/controllers/api/completeCalendarEventController.ts"), "utf8");
    const code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    const results = [];
    async function run(event, { tuning = baselineTuning, target = true, lastDay = false } = {}) {
        config.privateServerTuning = tuning;
        const inventory = new Inventory({
            accountOwnerId: new Types.ObjectId(),
            CalendarProgress: {
                Version: 19,
                Iteration: 1,
                YearProgress: { Upgrades: [] },
                SeasonProgress: {
                    SeasonType: "CST_SUMMER",
                    LastCompletedDayIdx: -1,
                    LastCompletedChallengeDayIdx: -1,
                    ActivatedChallenges: []
                }
            }
        });
        const account = {
            _id: inventory.accountOwnerId,
            email: target ? email : "other-calendar-fixture@invalid.local",
            DisplayName: "calendar-fixture"
        };
        const state = { quantity: null, saves: 0, clockAdvances: 0, response: null };
        inventory.save = async function () {
            assert.equal(this, inventory);
            assert.equal(inventory.validateSync(), undefined);
            state.saves++;
            return inventory;
        };
        const season = { Days: lastDay ? [{ events: [event] }] : [{ events: [event] }, { events: [] }] };
        const dependencies = {
            "../../services/inventoryService.ts": {
                getInventory: async () => inventory,
                getCalendarProgress: () => inventory.CalendarProgress,
                checkCalendarAutoAdvance: () => {}
            },
            "../../services/loginService.ts": { getAccountForRequest: async () => account },
            "../../services/purchaseService.ts": {
                handleStoreItemAcquisition: async (item, receivedInventory, quantity) => {
                    assert.equal(receivedInventory, inventory);
                    state.quantity = quantity;
                    return handleStoreItemAcquisition(item, inventory, quantity);
                }
            },
            "../../services/worldStateService.ts": { getWorldState: () => ({ KnownCalendarSeasons: [season] }) },
            "../../services/eventClockService.ts": {
                advanceEventClock: async name => {
                    assert.equal(name, "calendar");
                    state.clockAdvances++;
                }
            },
            "../../services/privateServerTuningService.ts": policy
        };
        const module = { exports: {} };
        vm.runInNewContext(code, {
            exports: module.exports,
            module,
            require: name => {
                assert.ok(Object.hasOwn(dependencies, name), name);
                return dependencies[name];
            }
        });
        await module.exports.completeCalendarEventController(
            { query: { CompletedEventIdx: "0" } },
            {
                json: value => {
                    state.response = value;
                }
            }
        );
        assert.equal(state.saves, 1);
        assert.equal(inventory.CalendarProgress.SeasonProgress.LastCompletedDayIdx, 0);
        assert.equal(state.clockAdvances, lastDay ? 1 : 0);
        assert.equal(state.response.CalendarProgress, inventory.CalendarProgress);
        return { ...state, inventory };
    }
    function itemCount(changes, key, type) {
        return changes[key].find(x => x.ItemType === type).ItemCount;
    }
    try {
        const shard = "/Lotus/StoreItems/Types/Gameplay/NarmerSorties/ArchonCrystalAmar";
        for (const [name, options, expected] of [
            ["target x3", {}, 3],
            ["untargeted x1", { target: false }, 1],
            ["disabled x1", { tuning: { ...baselineTuning, enabled: false } }, 1],
            ["missing field x1", { tuning: { ...baselineTuning, calendar1999RewardMultiplier: undefined } }, 1],
            ["explicit x1", { tuning: { ...baselineTuning, calendar1999RewardMultiplier: 1 } }, 1],
            ["last-day x3 and clock", { lastDay: true }, 3]
        ]) {
            const result = await run({ type: "CET_REWARD", reward: shard }, options);
            assert.equal(result.quantity, expected);
            assert.equal(
                itemCount(
                    result.response.InventoryChanges,
                    "MiscItems",
                    "/Lotus/Types/Gameplay/NarmerSorties/ArchonCrystalAmar"
                ),
                expected
            );
            assert.equal(
                itemCount(result.inventory, "MiscItems", "/Lotus/Types/Gameplay/NarmerSorties/ArchonCrystalAmar"),
                expected
            );
            results.push({ Case: name, Quantity: expected, InventoryAndPayload: "MATCH" });
        }
        for (const [name, reward, key] of [
            ["Forma", "/Lotus/StoreItems/Types/Items/MiscItems/Forma", "MiscItems"],
            ["blueprint", "/Lotus/StoreItems/Types/Recipes/Components/FormaBlueprint", "Recipes"],
            ["Kuva bundle", "/Lotus/Types/StoreItems/Packages/Calendar/CalendarKuvaBundleSmall", "MiscItems"]
        ]) {
            const normal = await run(
                { type: "CET_REWARD", reward },
                { tuning: { ...baselineTuning, calendar1999RewardMultiplier: 1 } }
            );
            const triple = await run({ type: "CET_REWARD", reward });
            assert.equal(triple.quantity, 3);
            for (const row of normal.response.InventoryChanges[key]) {
                assert.equal(itemCount(triple.response.InventoryChanges, key, row.ItemType), row.ItemCount * 3);
                assert.equal(itemCount(triple.inventory, key, row.ItemType), row.ItemCount * 3);
            }
            results.push({ Case: name, InventoryAndPayload: "BASE x3 (other multipliers do not stack)" });
        }
        const endo = "/Lotus/StoreItems/Upgrades/Mods/FusionBundles/CircuitSilverSteelPathFusionBundle";
        const baseEndo = await run(
            { type: "CET_REWARD", reward: endo },
            { tuning: { ...baselineTuning, calendar1999RewardMultiplier: 1 } }
        );
        const tripleEndo = await run({ type: "CET_REWARD", reward: endo });
        assert.ok(baseEndo.response.InventoryChanges.FusionPoints > 0);
        assert.equal(
            tripleEndo.response.InventoryChanges.FusionPoints,
            baseEndo.response.InventoryChanges.FusionPoints * 3
        );
        results.push({ Case: "Endo", InventoryAndPayload: "BASE x3" });
        const booster = await run({
            type: "CET_REWARD",
            reward: "/Lotus/Types/StoreItems/Boosters/AffinityBooster3DayStoreItem"
        });
        assert.equal(booster.response.InventoryChanges.Boosters.length, 1);
        assert.equal(booster.response.InventoryChanges.Boosters[0].ExpiryDate, 3 * 86400);
        results.push({ Case: "booster", Duration: "NATIVE 3 days (quantity setting does not alter duration)" });
        for (const event of [
            { type: "CET_UPGRADE", upgrade: "/Lotus/Upgrades/Calendar/AbilityStrength" },
            { type: "CET_PLOT" }
        ]) {
            const result = await run(event);
            assert.equal(result.quantity, null);
            if (event.upgrade)
                assert.deepEqual(Array.from(result.inventory.CalendarProgress.YearProgress.Upgrades), [event.upgrade]);
            results.push({ Case: event.type, Acquisitions: 0 });
        }
        const report = {
            Status: "PASS",
            Cases: results.length,
            DBConnections: 0,
            PlayerInventoryWrites: 0,
            Replay: "production controller, request/clock/save mocks, real acquisition/fresh inventory documents",
            Results: results
        };
        const output = process.argv[2];
        if (output) fs.writeFileSync(path.resolve(output), JSON.stringify(report, null, 2) + "\n");
        console.log(JSON.stringify(report, null, 2));
    } finally {
        config.privateServerTuning = originalTuning;
        deinitLogger();
    }
}
main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
