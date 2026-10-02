import type { IInventoryDatabase } from "../../src/types/inventoryTypes/inventoryTypes.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server-core";
import type { Request, Response, RequestHandler } from "express";
import {
    iceBladeChallengeController,
    ICE_BLADE_KEYS,
    ICE_BLADE_REWARDS
} from "../../src/controllers/api/iceBladeChallengeController.ts";
import { heartbeatController } from "../../src/controllers/api/heartbeatController.ts";
import { hubBlessingController } from "../../src/controllers/api/hubBlessingController.ts";
import { Inventory } from "../../src/models/inventoryModels/inventoryModel.ts";
import { Loadout } from "../../src/models/inventoryModels/loadoutModel.ts";
import { Account } from "../../src/models/loginModel.ts";
import { loadConfig, config } from "../../src/services/configService.ts";
import { initLogger, deinitLogger } from "../../src/utils/logger.ts";

loadConfig();
config.logger.files = false;
config.logger.consoleLevel = "error";
initLogger();
const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), "openwf-u44-endpoint-audit-"));
if (
    path.dirname(dbPath) !== path.resolve(os.tmpdir()) ||
    !path.basename(dbPath).startsWith("openwf-u44-endpoint-audit-")
) {
    throw new Error("Unexpected temporary database path");
}
let mongo: MongoMemoryServer | undefined;
let checks = 0;
try {
    mongo = await MongoMemoryServer.create({
        binary: { version: "7.0.34" },
        instance: { dbPath, storageEngine: "wiredTiger" }
    });
    await mongoose.connect(mongo.getUri(), { dbName: "u44_endpoints_audit" });
    const owner = new Types.ObjectId(),
        suit = new Types.ObjectId(),
        preset = new Types.ObjectId();
    await Account.collection.insertOne({
        _id: owner,
        Nonce: 7654321,
        email: "u44@test.invalid",
        DisplayName: "endpoint-audit"
    });
    await Loadout.collection.insertOne({
        loadoutOwnerId: owner,
        NORMAL: [{ _id: preset, s: { ItemId: suit, cus: 0 } }]
    });
    const reset = async (): Promise<void> => {
        await Inventory.collection.deleteMany({});
        await Inventory.collection.insertOne({
            accountOwnerId: owner,
            PlayerLevel: 31,
            CurrentLoadOutIds: [preset],
            Suits: [
                {
                    _id: suit,
                    ItemType: "/Lotus/Powersuits/Duelist/Duelist",
                    Configs: [{ Skins: [] }],
                    ArchonCrystalUpgrades: Array.from({ length: 5 }, (_, i) => ({
                        Color: i % 2 ? "ACC_BLUE_MYTHIC" : "ACC_BLUE",
                        UpgradeType: "/Lotus/Upgrades/Invigorations/ArchonCrystalUpgrades/ArchonUpgradeHealth"
                    }))
                }
            ],
            TitleType: "/Lotus/Types/Items/Titles/NarinTitle",
            EquippedGear: ICE_BLADE_KEYS,
            NodeIntrosCompleted: ["NarinPoemPoster"],
            WeaponSkins: [],
            FlavourItems: [],
            Boosters: [],
            MiscItems: [{ ItemType: "/test/unchanged", ItemCount: 37 }]
        });
    };
    const call = async (
        controller: RequestHandler,
        body: object = {},
        query: Record<string, string> = {}
    ): Promise<{ result: Record<string, unknown>; ended: boolean }> => {
        let result: Record<string, unknown> = {},
            ended = false;
        const req = {
            query: { accountId: owner.toString(), nonce: "7654321", ...query },
            body: JSON.stringify(body)
        } as unknown as Request;
        const res = {
            json(data: Record<string, unknown>) {
                result = data;
                return this;
            },
            end() {
                ended = true;
                return this;
            }
        } as unknown as Response;
        await controller(req, res, () => {});
        return { result, ended };
    };
    await reset();
    const original = await Inventory.collection.findOne<IInventoryDatabase>({ accountOwnerId: owner });
    assert.equal((await call(heartbeatController, { PS: "redacted-test" })).ended, true);
    assert.deepEqual(await Inventory.collection.findOne<IInventoryDatabase>({ accountOwnerId: owner }), original);
    await assert.rejects(call(heartbeatController, {}, { nonce: "1" }));
    await assert.rejects(call(iceBladeChallengeController, {}, { nonce: "1" }));
    checks += 4;

    // Every reported prerequisite independently blocks the puzzle; basic blessing remains separate.
    for (const patch of [
        { PlayerLevel: 30 },
        { "Suits.0.ItemType": "/Lotus/Powersuits/Frost/Frost" },
        { "Suits.0.ArchonCrystalUpgrades": [] },
        { "Suits.0.ArchonCrystalUpgrades.0.Color": "ACC_RED" },
        { "Suits.0.ArchonCrystalUpgrades.0.UpgradeType": "" },
        { EquippedGear: ICE_BLADE_KEYS.slice(1) },
        { TitleType: "" },
        { NodeIntrosCompleted: [] },
        { CurrentLoadOutIds: [] }
    ]) {
        await reset();
        await Inventory.collection.updateOne({ accountOwnerId: owner }, { $set: patch });
        assert.deepEqual((await call(iceBladeChallengeController)).result, { Completed: false, GrantBlessing: true });
        const inv = await Inventory.collection.findOne<IInventoryDatabase>({ accountOwnerId: owner });
        assert.equal(inv?.iceBladeChallengeCompleted, undefined);
        assert.deepEqual(inv?.WeaponSkins, []);
        checks++;
    }
    await reset();
    await Inventory.collection.updateOne({ accountOwnerId: owner }, { $set: { PlayerLevel: 29 } });
    assert.deepEqual((await call(iceBladeChallengeController)).result, { Completed: false, GrantBlessing: false });
    await Inventory.collection.updateOne(
        { accountOwnerId: owner },
        { $set: { PlayerLevel: 30, BlessingCooldown: new Date(Date.now() + 3600000) } }
    );
    assert.equal((await call(iceBladeChallengeController)).result.GrantBlessing, false);
    await Inventory.collection.updateOne({ accountOwnerId: owner }, { $set: { noBlessingCooldown: true } });
    assert.equal((await call(iceBladeChallengeController)).result.GrantBlessing, true);
    checks += 3;

    await reset();
    await Inventory.collection.updateOne(
        { accountOwnerId: owner },
        { $set: { BlessingCooldown: new Date(Date.now() + 3600000) } }
    );
    const pulls = await Promise.all(Array.from({ length: 5 }, () => call(iceBladeChallengeController)));
    assert.equal(pulls.filter(p => p.result.Rewards !== undefined).length, 1);
    assert.deepEqual(pulls.find(p => p.result.Rewards !== undefined)?.result.Rewards, ICE_BLADE_REWARDS);
    assert.ok(pulls.every(p => p.result.GrantBlessing === false));
    const saved = await Inventory.collection.findOne<IInventoryDatabase>({ accountOwnerId: owner });
    assert.equal(saved?.iceBladeChallengeCompleted, true);
    assert.equal(saved.WeaponSkins.length, 1);
    assert.equal(saved.FlavourItems.length, 1);
    assert.deepEqual(saved.EquippedGear, ICE_BLADE_KEYS);
    assert.deepEqual(saved.MiscItems, original?.MiscItems);
    assert.deepEqual((await call(iceBladeChallengeController)).result, { Completed: true, GrantBlessing: false });
    assert.equal((await Inventory.findOne({ accountOwnerId: owner }))?.toJSON().iceBladeChallengeCompleted, undefined);
    checks += 10;

    // Already-owned debug/shop cosmetics are not duplicated by the puzzle.
    await Inventory.collection.updateOne({ accountOwnerId: owner }, { $unset: { iceBladeChallengeCompleted: "" } });
    assert.deepEqual((await call(iceBladeChallengeController)).result.Rewards, []);
    assert.equal(
        (await Inventory.collection.findOne<IInventoryDatabase>({ accountOwnerId: owner }))?.WeaponSkins.length,
        1
    );
    checks += 2;

    await reset();
    const narin = "/Lotus/Types/StoreItems/Boosters/NarinBlessingStoreItem";
    const legacy = "/Lotus/Types/StoreItems/Boosters/AffinityBlessingStoreItem";
    for (const booster of [narin, legacy]) {
        const send = await call(hubBlessingController, { booster }, { mode: "send" });
        assert.equal(typeof send.result.Token, "string");
        assert.equal((send.result.Token as string).length, 32);
        assert.equal(
            (await call(hubBlessingController, { PendingHubBlessings: [{ booster, sendTime: send.result.SendTime }] }))
                .ended,
            true
        );
        assert.equal((await call(hubBlessingController, { booster, senderId: "test" })).result.BoosterType, booster);
        checks += 4;
    }
    const boosted = await Inventory.collection.findOne<IInventoryDatabase>({ accountOwnerId: owner });
    assert.ok(boosted?.Boosters.some(b => b.ItemType === "/Lotus/Types/Boosters/NarinBlessing"));
    assert.ok(boosted?.Boosters.some(b => b.ItemType === "/Lotus/Types/Boosters/AffinityBlessing"));
    checks += 2;
    console.log(
        JSON.stringify({ checks, result: "PASS", puzzleRules: "RECONSTRUCTED", database: "isolated temporary MongoDB" })
    );
} finally {
    await mongoose.disconnect();
    await mongo?.stop();
    deinitLogger();
    fs.rmSync(dbPath, { recursive: true, force: true });
}
