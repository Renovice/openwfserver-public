import generatedMetadata from "../../static/generated/openwf-metadata/challenge-metadata.json" with { type: "json" };
import { Inventory } from "../../src/models/inventoryModels/inventoryModel.ts";
import { addItem } from "../../src/services/inventoryService.ts";
import { fromStoreItem, toStoreItem } from "../../src/services/itemDataService.ts";
import { handleStoreItemAcquisition } from "../../src/services/purchaseService.ts";
import { config } from "../../src/services/configService.ts";
import { deinitLogger, initLogger } from "../../src/utils/logger.ts";

type TCountedReward = { StoreItem: string; ItemCount: number };
type TItemReward = { ItemType: string; ItemCount: number };
type TNightwaveTitle = { level: number; reward?: TItemReward; storeItemReward?: string };
type TNightwave = {
    titles: TNightwaveTitle[];
    featuredRewards: TItemReward[];
    featuredStoreItemRewards: string[];
};
type TMetadata = {
    generatedChallenges?: Record<string, { countedRewards?: TCountedReward[] }>;
    generatedNightwaveSyndicates?: Record<string, TNightwave>;
};
type TAuditCase = {
    source: string;
    operation: "item" | "store";
    typeName: string;
    quantity: number;
};

const metadata = generatedMetadata as TMetadata;
const cases: TAuditCase[] = [];

for (const [challenge, definition] of Object.entries(metadata.generatedChallenges ?? {})) {
    for (const reward of definition.countedRewards ?? []) {
        cases.push({
            source: `challenge:${challenge}`,
            operation: "item",
            typeName: fromStoreItem(reward.StoreItem),
            quantity: reward.ItemCount
        });
    }
}

for (const [tag, definition] of Object.entries(metadata.generatedNightwaveSyndicates ?? {})) {
    for (const title of definition.titles) {
        if (title.storeItemReward) {
            cases.push({
                source: `nightwave:${tag}:rank:${title.level}`,
                operation: "store",
                typeName: title.storeItemReward,
                quantity: 1
            });
        } else if (title.reward) {
            cases.push({
                source: `nightwave:${tag}:rank:${title.level}`,
                operation: "store",
                typeName: toStoreItem(title.reward.ItemType),
                quantity: title.reward.ItemCount
            });
        }
    }
    for (const reward of definition.featuredRewards) {
        cases.push({
            source: `nightwave:${tag}:featured-item`,
            operation: "item",
            typeName: reward.ItemType,
            quantity: reward.ItemCount
        });
    }
    for (const storeItem of definition.featuredStoreItemRewards) {
        cases.push({
            source: `nightwave:${tag}:featured-store`,
            operation: "store",
            typeName: storeItem,
            quantity: 1
        });
    }
}

const uniqueCases = [
    ...new Map(cases.map(value => [`${value.operation}\0${value.typeName}\0${value.quantity}`, value])).values()
];

config.logger.files = false;
config.logger.consoleLevel = "error";
initLogger();

const failures: { test: TAuditCase; error: string }[] = [];
let passed = 0;
for (const test of uniqueCases) {
    try {
        const inventory = new Inventory();
        const changes =
            test.operation == "store"
                ? (await handleStoreItemAcquisition(test.typeName, inventory, test.quantity)).InventoryChanges
                : await addItem(inventory, test.typeName, test.quantity, true);
        if (Object.keys(changes).length == 0) {
            throw new Error("acquisition returned an empty inventory delta");
        }
        passed += 1;
    } catch (error) {
        failures.push({
            test,
            error: error instanceof Error ? error.message : String(error)
        });
    }
}

deinitLogger();

console.log(
    `[generated-reward-audit] references=${cases.length} unique=${uniqueCases.length} pass=${passed} fail=${failures.length}`
);
for (const failure of failures) {
    console.error(
        `[generated-reward-audit] FAIL ${failure.test.operation} ${failure.test.quantity}x ${failure.test.typeName} ` +
            `(${failure.test.source}): ${failure.error}`
    );
}
if (failures.length != 0) process.exitCode = 1;
