import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server-core";
import type { Request, Response } from "express";
import { ExportUpgrades } from "warframe-public-export-plus";
import { currentRivenContracts } from "../../src/services/currentPublicExportService.ts";
import {
    getRivenSpliceRecipes,
    spliceRiven,
    RIVEN_SPLICER,
    RIVEN_MAX_QUALITY
} from "../../src/helpers/rivenSpliceHelper.ts";
import {
    randomiseRivenStats,
    resolveRivenCycleLocks,
    type IUnveiledRivenFingerprint
} from "../../src/helpers/rivenHelper.ts";
import { spliceRivenController } from "../../src/controllers/custom/spliceRivenController.ts";
import { Inventory } from "../../src/models/inventoryModels/inventoryModel.ts";
import { Account } from "../../src/models/loginModel.ts";
import { loadConfig, config } from "../../src/services/configService.ts";
import { initLogger, deinitLogger } from "../../src/utils/logger.ts";

const fp = (): IUnveiledRivenFingerprint => ({
    compat: "/Lotus/Weapons/Tenno/Rifle/LotusRifle",
    lim: 0,
    lvl: 8,
    lvlReq: 8,
    pol: "AP_ATTACK",
    rerolls: 17,
    buffs: [
        { Tag: "WeaponDamageAmountMod", Value: 100 },
        { Tag: "WeaponCritChanceMod", Value: 222 },
        { Tag: "WeaponFreezeDamageMod", Value: 333 }
    ],
    curses: [{ Tag: "WeaponZoomFovMod", Value: RIVEN_MAX_QUALITY }]
});
const rifle = ExportUpgrades["/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare"];
const recipe = getRivenSpliceRecipes(rifle).find(
    r => r.resultTag === "WeaponWeakpointDamage" && r.secondaryIngredient === "WeaponZoomFovMod"
)!;
const before = fp();
const after = spliceRiven(rifle, before, recipe.id, () => 0);
assert.deepEqual(before, fp());
assert.equal(after.buffs[0].Tag, "WeaponWeakpointDamage");
assert.equal(after.buffs[0].Value, RIVEN_MAX_QUALITY);
assert.equal(after.curses.length, 1);
assert.equal(after.buffs.length, 3);
assert.deepEqual(after.buffs.slice(1), before.buffs.slice(1));
assert.equal(after.rerolls, 17);
let cases = 0;
for (const [typeName] of Object.entries(currentRivenContracts)) {
    const meta = ExportUpgrades[typeName];
    const entries = meta.upgradeEntries!;
    for (const r of getRivenSpliceRecipes(meta).filter(r => r.available)) {
        for (const mixed of [false, true]) {
            const a = entries.find(e => e.tag === r.primaryIngredient)!;
            const b = entries.find(e => e.tag === r.secondaryIngredient)!;
            if (!a.canBeBuff || !(mixed ? b.canBeCurse : b.canBeBuff)) continue;
            const filler = entries.find(
                e =>
                    e.canBeBuff &&
                    e.tag !== a.tag &&
                    e.tag !== b.tag &&
                    !currentRivenContracts[typeName as keyof typeof currentRivenContracts].entries.find(
                        x => x.tag === e.tag
                    )?.isAdvancedTrait
            )!;
            const input = fp();
            input.buffs = [
                { Tag: a.tag, Value: 5 },
                { Tag: filler.tag, Value: 678 }
            ];
            input.curses = [];
            (mixed ? input.curses : input.buffs).push({ Tag: b.tag, Value: RIVEN_MAX_QUALITY - 12 });
            const result = spliceRiven(meta, input, r.id, () => 0.45);
            assert.equal(result.buffs.length, input.buffs.length);
            assert.equal(result.curses.length, input.curses.length);
            assert.equal(result.buffs.find(s => s.Tag === r.resultTag)!.Value, RIVEN_MAX_QUALITY - 12);
            for (let i = 0; i < 10; i++) {
                const lock = resolveRivenCycleLocks(meta, result, []);
                assert.equal(lock.costMultiplier, 1);
                randomiseRivenStats(meta, result, lock.tags);
                assert.equal(result.buffs.length, input.buffs.length);
                assert.equal(result.curses.length, input.curses.length);
                assert.equal(result.buffs.find(s => s.Tag === r.resultTag)!.Value, RIVEN_MAX_QUALITY - 12);
            }
            assert.throws(() => spliceRiven(meta, result, r.id));
            cases++;
        }
    }
}
assert.throws(() => spliceRiven(rifle, fp(), "made-up"));
const invalid = fp();
invalid.curses[0].Value = RIVEN_MAX_QUALITY + 1;
assert.throws(() => spliceRiven(rifle, invalid, recipe.id));
// A Riven class exposes splice recipes only when the current client gives it native advanced traits
// (44.0.0 modular classes had none; 44.0.2 added them). Never offer a recipe without a native result trait.
for (const [typeName, contract] of Object.entries(currentRivenContracts)) {
    const hasAdvanced = contract.entries.some(e => e.isAdvancedTrait);
    assert.equal(getRivenSpliceRecipes(ExportUpgrades[typeName]).some(r => r.available), hasAdvanced, typeName);
}

loadConfig();
config.logger.files = false;
config.logger.consoleLevel = "error";
initLogger();
const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), "openwf-riven-splice-audit-"));
if (
    path.dirname(dbPath) !== path.resolve(os.tmpdir()) ||
    !path.basename(dbPath).startsWith("openwf-riven-splice-audit-")
)
    throw new Error("Unexpected temporary database path");
let mongo: MongoMemoryServer | undefined;
try {
    mongo = await MongoMemoryServer.create({
        binary: { version: "7.0.34" },
        instance: { dbPath, storageEngine: "wiredTiger" }
    });
    await mongoose.connect(mongo.getUri(), { dbName: "riven_splice_audit" });
    const owner = new Types.ObjectId(),
        other = new Types.ObjectId(),
        item = new Types.ObjectId(),
        invId = new Types.ObjectId();
    await Account.collection.insertMany([
        { _id: owner, Nonce: 7654321, email: "owner@test.invalid", DisplayName: "splice-owner" },
        { _id: other, Nonce: 1234567, email: "other@test.invalid", DisplayName: "splice-other" }
    ]);
    const fingerprint = JSON.stringify(fp());
    const reset = async (count = 2, pending = false): Promise<void> => {
        await Inventory.collection.deleteMany({});
        await Inventory.collection.insertOne({ accountOwnerId: other, Upgrades: [], MiscItems: [] });
        await Inventory.collection.insertOne({
            _id: invId,
            accountOwnerId: owner,
            Upgrades: [
                {
                    _id: item,
                    ItemType: "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare",
                    UpgradeFingerprint: fingerprint,
                    ...(pending ? { PendingRerollFingerprint: fingerprint } : {})
                }
            ],
            MiscItems: [{ ItemType: RIVEN_SPLICER, ItemCount: count }]
        });
    };
    const call = async (
        body: Record<string, unknown>,
        account = owner,
        nonce = 7654321
    ): Promise<{ status: number; body: Record<string, unknown> }> => {
        let status = 200;
        let result: Record<string, unknown> = {};
        const req = { query: { accountId: account.toString(), nonce: String(nonce) }, body } as unknown as Request;
        const res = {
            status(code: number) {
                status = code;
                return this;
            },
            json(data: Record<string, unknown>) {
                result = data;
                return this;
            }
        } as unknown as Response;
        await spliceRivenController(req, res, () => {});
        return { status, body: result };
    };
    const request = {
        action: "commit",
        itemId: item.toString(),
        recipeId: recipe.id,
        expectedFingerprint: fingerprint
    };
    await reset();
    const preview = await call({ ...request, action: "preview" });
    assert.equal(preview.status, 200);
    assert.equal((await Inventory.findById(invId))!.MiscItems[0].ItemCount, 2);
    assert.equal((await call(request, other, 1234567)).status, 404);
    await assert.rejects(call(request, owner, 99));
    assert.equal((await call({ ...request, expectedFingerprint: "stale" })).status, 409);
    assert.equal((await call({ ...request, recipeId: "bad" })).status, 400);
    const raced = await Promise.all([call(request), call(request)]);
    assert.equal(raced.filter(r => r.status === 200).length, 1);
    const saved = (await Inventory.findById(invId))!;
    assert.equal(saved.MiscItems[0].ItemCount, 1);
    assert.notEqual(saved.Upgrades.id(item)!.UpgradeFingerprint, fingerprint);
    assert.notEqual((await call(request)).status, 200);
    assert.equal((await Inventory.findById(invId))!.MiscItems[0].ItemCount, 1);
    await reset(0);
    assert.equal((await call(request)).status, 409);
    assert.equal((await Inventory.findById(invId))!.Upgrades.id(item)!.UpgradeFingerprint, fingerprint);
    await reset(2, true);
    assert.equal((await call(request)).status, 409);
    assert.equal((await Inventory.findById(invId))!.MiscItems[0].ItemCount, 2);
    console.log(
        JSON.stringify({
            status: "PASS",
            recipeSignCases: cases,
            rerolls: cases * 10,
            atomicDebit: true,
            replayAndRace: true,
            ownership: true,
            pendingAndInsufficientFunds: true
        })
    );
} finally {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
    deinitLogger();

    fs.rmSync(dbPath, { recursive: true, force: true });
}
