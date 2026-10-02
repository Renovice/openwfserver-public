import assert from "node:assert/strict";
import fs from "node:fs";
import { Types } from "mongoose";
import { ExportSyndicates } from "warframe-public-export-plus";
import { config, loadConfig } from "../../src/services/configService.ts";
import { getMaxStanding } from "../../src/helpers/syndicateStandingHelper.ts";
import { Inventory } from "../../src/models/inventoryModels/inventoryModel.ts";
import { addStanding, eStandingSource } from "../../src/services/inventoryService.ts";
import { BL_LATEST } from "../../src/constants/gameVersions.ts";
import type { IAffiliationMods } from "../../src/types/purchaseTypes.ts";
import { initLogger, deinitLogger } from "../../src/utils/logger.ts";

loadConfig();
config.logger.files = false;
config.logger.consoleLevel = "error";
initLogger();
const qol = config.serversideQualityOfLife;
assert.ok(qol, "Declare serversideQualityOfLife in the local test config");
const originalCapacity = qol.syndicateStandingCapacity;
qol.syndicateStandingCapacity = 999999;
const results: { tag: string; check: string; status: string }[] = [];
try {
    const walletEntries = Object.entries(ExportSyndicates).filter(([tag, data]) => {
        if (data.dailyChallenges || tag == "KahlSyndicate" || tag == "NightcapJournalSyndicate") return false;
        return !data.titles || data.titles.some(t => t.level > 0 && t.maxStanding - t.minStanding > 1);
    });
    assert.equal(walletEntries.length, 19);
    for (const [tag, data] of walletEntries) {
        const top = data.titles?.reduce((a, b) => (a.level > b.level ? a : b));
        const minimum = top?.minStanding ?? 0;
        const title = top?.level ?? 0;
        const inventory = new Inventory({
            accountOwnerId: new Types.ObjectId(),
            noDailyStandingLimits: true,
            Affiliations: [{ Tag: tag, Title: title, Standing: minimum + 950000 }]
        });
        const mods: IAffiliationMods[] = [];
        await addStanding(inventory, BL_LATEST, tag, 100000, mods, eStandingSource.Misc);
        const affiliation = inventory.Affiliations.find(x => x.Tag == tag)!;
        assert.equal(affiliation.Standing - minimum, 999999, tag);
        assert.equal(mods[0].Standing, 49999, tag);
        assert.equal(affiliation.Title ?? 0, title, tag);
        await inventory.validate();
        const overflow: IAffiliationMods[] = [];
        await addStanding(inventory, BL_LATEST, tag, 5000, overflow);
        assert.equal(overflow[0].Standing, 0, tag);
        assert.equal(affiliation.Standing - minimum, 999999, tag);
        await addStanding(inventory, BL_LATEST, tag, -20000);
        assert.equal(affiliation.Standing - minimum, 979999, tag);
        await addStanding(inventory, BL_LATEST, tag, 50000);
        assert.equal(affiliation.Standing - minimum, 999999, tag);
        for (const lower of data.titles ?? []) {
            if (lower.level != title) assert.equal(getMaxStanding(data, lower.level), lower.maxStanding, tag);
        }
        results.push({ tag, check: "real grant, overflow, spend/refill, rank and response delta", status: "PASS" });
    }
    for (const [tag, data] of Object.entries(ExportSyndicates)) {
        if (data.dailyChallenges || tag == "KahlSyndicate" || tag == "NightcapJournalSyndicate") {
            for (const title of data.titles ?? []) assert.equal(getMaxStanding(data, title.level), title.maxStanding);
            results.push({ tag, check: "progression-track bounds unchanged", status: "PASS" });
        }
    }
    const dailyInventory = new Inventory({
        accountOwnerId: new Types.ObjectId(),
        DailyAffiliationHex: 10,
        Affiliations: [{ Tag: "HexSyndicate", Title: 5, Standing: 240000 }]
    });
    await addStanding(dailyInventory, BL_LATEST, "HexSyndicate", 20);
    assert.equal(dailyInventory.Affiliations[0].Standing, 240010);
    assert.equal(dailyInventory.DailyAffiliationHex, 0);
    results.push({
        tag: "HexSyndicate",
        check: "stored cap does not bypass a finite daily earning allowance",
        status: "PASS"
    });
    qol.syndicateStandingCapacity = undefined;
    assert.equal(getMaxStanding(ExportSyndicates.HexSyndicate, 5), 372000);
    assert.equal(getMaxStanding(ExportSyndicates.LibrarySyndicate, 0), 125000);
    assert.equal(getMaxStanding(ExportSyndicates.ArbitersSyndicate, 0), 5000);
    results.push({ tag: "defaults", check: "missing capacity retains native rank and Simaris bounds", status: "PASS" });
    const output = {
        status: "PASS",
        walletSyndicates: walletEntries.length,
        cases: results.length,
        dbConnections: 0,
        playerInventoryWrites: 0,
        results
    };
    if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(output, null, 2) + "\n");
    console.log(JSON.stringify(output, null, 2));
} finally {
    qol.syndicateStandingCapacity = originalCapacity;
    deinitLogger();
}
