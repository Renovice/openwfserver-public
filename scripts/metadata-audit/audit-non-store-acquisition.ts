import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server-core";
import { ExportBundles, ExportResources } from "warframe-public-export-plus";
import { Inventory } from "../../src/models/inventoryModels/inventoryModel.ts";
import { PersonalRooms } from "../../src/models/personalRoomsModel.ts";
import { config, loadConfig } from "../../src/services/configService.ts";
import { generatedItems } from "../../src/services/generatedMetadataService.ts";
import { addItem } from "../../src/services/inventoryService.ts";
import { handleBundleAcquisition } from "../../src/services/purchaseService.ts";
import { deinitLogger, initLogger } from "../../src/utils/logger.ts";

type TResult = {
    kind: "Bundle" | "ResourceWithoutStoreWrapper";
    typeName: string;
    status: "Supported" | "SupportedStateMutation" | "IntentionalEmptyDefinition" | "Failed";
    inventoryDeltaKeys?: string[];
    error?: string;
};

const option = (name: string): string | undefined => {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 ? process.argv[index + 1] : undefined;
};

const outputPath = path.resolve(
    option("output") ?? path.join(process.cwd(), "tmp/audits/non-store-acquisition-audit.json")
);
const temporaryDatabase = fs.mkdtempSync(path.join(os.tmpdir(), "openwf-non-store-acquisition-audit-"));
const serializeState = (value: unknown): string =>
    JSON.stringify(value, (_key, entry: unknown) => (typeof entry == "bigint" ? entry.toString() : entry));

loadConfig();
config.logger.files = false;
config.logger.consoleLevel = "error";
initLogger();

const run = async (
    kind: TResult["kind"],
    typeName: string,
    acquire: (inventory: InstanceType<typeof Inventory>) => Promise<Record<string, unknown>>
): Promise<TResult> => {
    const inventory = new Inventory({ accountOwnerId: new Types.ObjectId() });
    await new PersonalRooms({
        personalRoomsOwnerId: inventory.accountOwnerId,
        activeShipId: new Types.ObjectId()
    }).save();
    const before = serializeState(inventory.toObject({ virtuals: false }));
    try {
        const changes = await acquire(inventory);
        const inventoryDeltaKeys = Object.keys(changes).sort();
        const mutated = before != serializeState(inventory.toObject({ virtuals: false }));
        const bundle = kind == "Bundle" ? ExportBundles[typeName] : undefined;
        const intentionallyEmpty = bundle != undefined && bundle.components.length == 0;
        return {
            kind,
            typeName,
            status:
                inventoryDeltaKeys.length != 0
                    ? "Supported"
                    : mutated
                      ? "SupportedStateMutation"
                      : intentionallyEmpty
                        ? "IntentionalEmptyDefinition"
                        : "Failed",
            inventoryDeltaKeys: inventoryDeltaKeys.length == 0 ? undefined : inventoryDeltaKeys,
            error:
                inventoryDeltaKeys.length == 0 && !mutated && !intentionallyEmpty
                    ? "acquisition produced no response delta and no inventory mutation"
                    : undefined
        };
    } catch (error) {
        return {
            kind,
            typeName,
            status: "Failed",
            error: error instanceof Error ? error.message : String(error)
        };
    } finally {
        await PersonalRooms.deleteOne({ personalRoomsOwnerId: inventory.accountOwnerId });
    }
};

let mongod: MongoMemoryServer | undefined;
try {
    mongod = await MongoMemoryServer.create({
        binary: { version: "7.0.34" },
        instance: { dbPath: temporaryDatabase, storageEngine: "wiredTiger" }
    });
    await mongoose.connect(mongod.getUri("openWF"));

    const results: TResult[] = [];
    for (const typeName of Object.keys(ExportBundles).sort()) {
        results.push(
            await run("Bundle", typeName, inventory =>
                handleBundleAcquisition(typeName, inventory, 1, {}, config.fallbackBuildLabel)
            )
        );
    }
    for (const typeName of Object.keys(ExportResources)
        .filter(typeName => !(typeName in generatedItems))
        .sort()) {
        results.push(
            await run("ResourceWithoutStoreWrapper", typeName, inventory =>
                addItem(inventory, typeName, 1, false, undefined, undefined, true, config.fallbackBuildLabel)
            )
        );
    }

    const grouped = results.reduce<Record<string, number>>((counts, result) => {
        const key = `${result.kind}\t${result.status}`;
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
    }, {});
    const failures = results.filter(result => result.status == "Failed");
    const summary = {
        denominator: results.length,
        bundles: Object.keys(ExportBundles).length,
        resourcesWithoutStoreWrapper: results.filter(result => result.kind == "ResourceWithoutStoreWrapper").length,
        supported: results.filter(result => result.status == "Supported").length,
        supportedStateMutation: results.filter(result => result.status == "SupportedStateMutation").length,
        intentionalEmptyDefinition: results.filter(result => result.status == "IntentionalEmptyDefinition").length,
        failed: failures.length,
        grouped: Object.fromEntries(Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)))
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify({ summary, failures, results }, null, 2) + "\n");
    console.log(JSON.stringify(summary, null, 2));
    console.log(`[non-store-acquisition] report=${outputPath}`);
    if (failures.length != 0) process.exitCode = 1;
} finally {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
    fs.rmSync(temporaryDatabase, { recursive: true, force: true });
    deinitLogger();
}
