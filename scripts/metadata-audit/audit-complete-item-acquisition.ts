import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server-core";
import { Inventory } from "../../src/models/inventoryModels/inventoryModel.ts";
import { PersonalRooms } from "../../src/models/personalRoomsModel.ts";
import { config, loadConfig } from "../../src/services/configService.ts";
import { generatedItems } from "../../src/services/generatedMetadataService.ts";
import { handleStoreItemAcquisition } from "../../src/services/purchaseService.ts";
import { deinitLogger, initLogger } from "../../src/utils/logger.ts";
import { classifyNonDirectItem } from "./classify-non-direct-items.ts";

type TResult = {
    typeName: string;
    storeItem: string;
    productCategory: string;
    serverRecordSource: string;
    status:
        | "Supported"
        | "SupportedStateMutation"
        | "IntentionalNoInventoryMutation"
        | "RequiresAcquisitionContext"
        | "DefinitionOnly"
        | "NoInventoryDelta"
        | "Failed";
    inventoryDeltaKeys?: string[];
    error?: string;
    reason?: string;
    evidence?: string;
};

const option = (name: string): string | undefined => {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 ? process.argv[index + 1] : undefined;
};

const outputPath = path.resolve(
    option("output") ?? path.join(process.cwd(), "tmp/audits/complete-item-acquisition-classified.json")
);
const temporaryDatabase = fs.mkdtempSync(path.join(os.tmpdir(), "openwf-item-acquisition-audit-"));
const serializeState = (value: unknown): string =>
    JSON.stringify(value, (_key, entry: unknown) => (typeof entry == "bigint" ? entry.toString() : entry));

loadConfig();
config.logger.files = false;
config.logger.consoleLevel = "error";
initLogger();

let mongod: MongoMemoryServer | undefined;
try {
    mongod = await MongoMemoryServer.create({
        binary: { version: "7.0.34" },
        instance: { dbPath: temporaryDatabase, storageEngine: "wiredTiger" }
    });
    await mongoose.connect(mongod.getUri("openWF"));

    const results: TResult[] = [];
    const items = Object.values(generatedItems).sort((a, b) => a.typeName.localeCompare(b.typeName));
    let index = 0;
    for (const item of items) {
        const inventory = new Inventory({ accountOwnerId: new Types.ObjectId() });
        try {
            if (item.productCategory == "CrewShips") {
                await new PersonalRooms({
                    personalRoomsOwnerId: inventory.accountOwnerId,
                    activeShipId: new Types.ObjectId()
                }).save();
            }
            const inventoryBefore = serializeState(inventory.toObject({ virtuals: false }));
            const response = await handleStoreItemAcquisition(
                item.storeItem,
                inventory,
                1,
                3,
                true,
                true,
                BigInt(++index),
                config.fallbackBuildLabel
            );
            const inventoryDeltaKeys = Object.keys(response.InventoryChanges).sort();
            const inventoryMutated = inventoryBefore != serializeState(inventory.toObject({ virtuals: false }));
            const status: TResult["status"] =
                inventoryDeltaKeys.length != 0
                    ? "Supported"
                    : inventoryMutated
                      ? "SupportedStateMutation"
                      : item.typeName == "/Lotus/Upgrades/Boons/DuviriVendorBoonItem"
                        ? "IntentionalNoInventoryMutation"
                        : "NoInventoryDelta";
            results.push({
                typeName: item.typeName,
                storeItem: item.storeItem,
                productCategory: item.productCategory,
                serverRecordSource: item.serverRecordSource,
                status,
                inventoryDeltaKeys: inventoryDeltaKeys.length == 0 ? undefined : inventoryDeltaKeys
            });
        } catch (error) {
            const classification = classifyNonDirectItem(item.typeName);
            results.push({
                typeName: item.typeName,
                storeItem: item.storeItem,
                productCategory: item.productCategory,
                serverRecordSource: item.serverRecordSource,
                status: classification?.status ?? "Failed",
                reason: classification?.reason,
                evidence: classification?.evidence,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    const grouped = results.reduce<Record<string, number>>((counts, result) => {
        const key = `${result.status}\t${result.serverRecordSource}\t${result.productCategory}`;
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
    }, {});
    const failureReasons = results
        .filter((result): result is TResult & { error: string } => result.status == "Failed" && !!result.error)
        .reduce<Record<string, number>>((counts, result) => {
            counts[result.error] = (counts[result.error] ?? 0) + 1;
            return counts;
        }, {});
    const summary = {
        denominator: results.length,
        supported: results.filter(result => result.status == "Supported").length,
        supportedStateMutation: results.filter(result => result.status == "SupportedStateMutation").length,
        intentionalNoInventoryMutation: results.filter(result => result.status == "IntentionalNoInventoryMutation")
            .length,
        requiresAcquisitionContext: results.filter(result => result.status == "RequiresAcquisitionContext").length,
        definitionOnly: results.filter(result => result.status == "DefinitionOnly").length,
        noInventoryDelta: results.filter(result => result.status == "NoInventoryDelta").length,
        failed: results.filter(result => result.status == "Failed").length,
        grouped: Object.fromEntries(Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))),
        failureReasons: Object.fromEntries(Object.entries(failureReasons).sort(([a], [b]) => a.localeCompare(b)))
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify({ summary, results }, null, 2) + "\n");
    console.log(JSON.stringify(summary, null, 2));
    console.log(`[complete-item-acquisition] report=${outputPath}`);
} finally {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
    fs.rmSync(temporaryDatabase, { recursive: true, force: true });
    deinitLogger();
}
