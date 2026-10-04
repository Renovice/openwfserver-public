import { createHash } from "node:crypto";
import type { IBoosterPack, IDojoDeco, IDojoResearch, ISyndicate, IVendor } from "warframe-public-export-plus";
import { ExportDojoRecipes, ExportSyndicates } from "warframe-public-export-plus";
import generatedMetadata from "../../static/generated/openwf-metadata/challenge-metadata.json" with { type: "json" };
import { logger } from "../utils/logger.ts";

export interface IGeneratedNightwaveDefinition {
    uniqueName: string;
    parent: string;
    templateTag: string;
    name: string;
    currency: string;
    vendorManifest: string;
    vendorPayloadAvailable: boolean;
    dailyChallenges: string[];
    weeklyChallenges: string[];
    titles: {
        level: number;
        name: string;
        minStanding: number;
        maxStanding: number;
        reward?: { ItemCount: number; ItemType: string };
        storeItemReward?: string;
    }[];
    featuredRewards: { ItemCount: number; ItemType: string }[];
    featuredStoreItemRewards: string[];
}

interface IGeneratedBundle {
    name: string;
    description: string;
    icon: string;
    isCosmetic?: boolean;
    components: { typeName: string; purchaseQuantity: number }[];
}

export interface IGeneratedCosmetic {
    typeName: string;
    storeItem: string;
    productCategory: "WeaponSkins" | "FlavourItems" | "ShipDecorations";
    localizeTag: string;
}

export interface IGeneratedItem {
    typeName: string;
    storeItem: string;
    productCategory: string;
    localizeTag: string;
    categorySourcePath: string;
    localizationSourcePath: string;
    publicExportDatasets: string[];
    serverRecordSource: "GeneratedCosmetic" | "PublicExport" | "None";
    effectiveMetadata?: Record<string, string>;
    effectiveMetadataSourcePaths?: Record<string, string>;
    boosterPack?: {
        components: {
            item: string;
            amount: number;
            probability?: number;
            pityIncreaseRate?: number;
            rarity: string;
        }[];
        rarityWeightsPerRoll: Record<string, number>[];
        canGiveDuplicates: boolean;
    };
}

interface IItemRegistrySummary {
    decodedTypeCount: number;
    storeWrapperCount: number;
    exactPairCount: number;
    admittedCount: number;
    rejectedCount: number;
    rejectionSha256: string;
    noExplicitServerRecordCount: number;
    noExplicitServerRecordSha256: string;
    publicExportPackageVersion?: string;
    rejectionCounts: Record<string, number>;
    categoryCounts: Record<string, number>;
    serverRecordSourceCounts: Record<string, number>;
}

export interface IGeneratedVendor extends IVendor {
    /** SHA-256 of the exact client binary datafile converted into this manifest. */
    sourceSha256: string;
}

interface IGeneratedSyndicateFavours {
    uniqueName: string;
    manifestPath: string;
    sourceSha256: string;
    sourceFavourCount?: number;
    favours: ISyndicate["favours"];
    rejectedFavours?: {
        favour: ISyndicate["favours"][number];
        reason: string;
    }[];
}

interface IGeneratedDojoRecipes {
    manifestPath: string;
    sourceSha256: string;
    currentManifestCount: number;
    research: Record<string, IDojoResearch>;
    decos: Record<string, IDojoDeco>;
}

type TGeneratedMetadata = {
    schemaVersion: number;
    source?: { executableFileVersion?: string };
    generatedNightwaveSyndicates?: Record<string, IGeneratedNightwaveDefinition>;
    generatedVendors?: Record<string, IGeneratedVendor>;
    generatedSyndicateFavours?: Record<string, IGeneratedSyndicateFavours>;
    generatedDojoRecipes?: IGeneratedDojoRecipes;
    generatedBundles?: Record<string, IGeneratedBundle>;
    generatedCosmetics?: Record<string, IGeneratedCosmetic>;
    generatedItems?: Record<string, IGeneratedItem>;
    itemRegistrySummary?: IItemRegistrySummary;
};

const metadata = generatedMetadata as TGeneratedMetadata;
if (metadata.schemaVersion != 1) {
    throw new Error(`unsupported generated OpenWF metadata schema ${metadata.schemaVersion}`);
}

export const generatedNightwaveSyndicates = metadata.generatedNightwaveSyndicates ?? {};
export const generatedVendors = metadata.generatedVendors ?? {};
const generatedSyndicateFavours = metadata.generatedSyndicateFavours ?? {};
const generatedDojoRecipes = metadata.generatedDojoRecipes;
export const generatedBundles = metadata.generatedBundles ?? {};
export const generatedCosmetics = metadata.generatedCosmetics ?? {};
export const generatedItems = metadata.generatedItems ?? {};
export const itemRegistrySummary = metadata.itemRegistrySummary;
/** Client build (e.g. 2026.09.30.14.45) the generated metadata was produced from. */
export const generatedClientBuildVersion = metadata.source?.executableFileVersion;

export const getGeneratedNightwaveDefinition = (tag: string): IGeneratedNightwaveDefinition | undefined =>
    generatedNightwaveSyndicates[tag];

export const getGeneratedVendor = (typeName: string): IGeneratedVendor | undefined =>
    (generatedVendors as Record<string, IGeneratedVendor | undefined>)[typeName];
export const getGeneratedCosmetic = (typeName: string): IGeneratedCosmetic | undefined =>
    (generatedCosmetics as Record<string, IGeneratedCosmetic | undefined>)[typeName];
export const getGeneratedItem = (typeName: string): IGeneratedItem | undefined =>
    (generatedItems as Record<string, IGeneratedItem | undefined>)[typeName];

export const applyGeneratedCurrentDatafiles = (): void => {
    for (const [tag, current] of Object.entries(generatedSyndicateFavours)) {
        const existing = (ExportSyndicates as Record<string, ISyndicate | undefined>)[tag];
        if (!existing) {
            if (tag in generatedNightwaveSyndicates) continue;
            throw new Error(`generated current syndicate favours require missing syndicate ${tag}`);
        }
        if (existing.uniqueName != current.uniqueName)
            throw new Error(`generated current syndicate ${tag} uniqueName mismatch`);
        existing.favours = current.favours.map(favour => ({ ...favour }));
    }
    if (generatedDojoRecipes) {
        Object.assign(ExportDojoRecipes.research, generatedDojoRecipes.research);
        Object.assign(ExportDojoRecipes.decos, generatedDojoRecipes.decos);
    }
};

export const getGeneratedItemPrice = (typeName: string, usePremium: boolean): number | undefined => {
    const item = getGeneratedItem(typeName);
    const raw = item?.effectiveMetadata?.[usePremium ? "PremiumPrice" : "RegularPrice"];
    if (raw == undefined) return undefined;
    const price = Number(raw);
    return Number.isSafeInteger(price) && price >= 0 ? price : undefined;
};

export const getGeneratedBoosterPack = (typeName: string): IBoosterPack | undefined => {
    const item = getGeneratedItem(typeName);
    const pack = item?.boosterPack;
    if (!item || !pack) return undefined;
    const platinumCost = Number(item.effectiveMetadata?.PremiumPrice);
    return {
        name: item.localizeTag,
        description: item.effectiveMetadata?.LocalizeDescTag ?? "",
        icon: item.effectiveMetadata?.Icon,
        components: pack.components.map(component => ({
            Item: component.item,
            Amount: component.amount,
            Probability: component.probability,
            PityIncreaseRate: component.pityIncreaseRate,
            Rarity: component.rarity as IBoosterPack["components"][number]["Rarity"]
        })),
        rarityWeightsPerRoll: pack.rarityWeightsPerRoll.map(
            weights => ({ ...weights }) as IBoosterPack["rarityWeightsPerRoll"][number]
        ),
        canGiveDuplicates: pack.canGiveDuplicates,
        platinumCost: Number.isSafeInteger(platinumCost) && platinumCost > 0 ? platinumCost : undefined,
        excludeFromMarket: item.effectiveMetadata?.ShowInMarket == "0" ? true : undefined
    };
};

const countBy = (values: string[]): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
    return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
};

const sameCounts = (a: Record<string, number>, b: Record<string, number>): boolean =>
    Object.keys(a).length == Object.keys(b).length && Object.entries(a).every(([key, value]) => b[key] == value);

const sha256Lines = (values: string[]): string =>
    createHash("sha256")
        .update(values.map(value => `${value}\n`).join(""), "utf8")
        .digest("hex");

/**
 * Packages.bin supplies the update-specific rank/challenge contract, while Public Export supplies
 * stable presentation fields inherited by every modern Nightwave syndicate. The merge is explicit:
 * generated data never silently replaces icon/colour/favour fields it did not prove.
 */
export const getGeneratedNightwaveSyndicate = (tag: string): ISyndicate | undefined => {
    const generated = getGeneratedNightwaveDefinition(tag);
    if (!generated) return undefined;
    const template = (ExportSyndicates as Record<string, ISyndicate | undefined>)[generated.templateTag];
    if (!template) {
        throw new Error(`generated Nightwave ${tag} requires missing template ${generated.templateTag}`);
    }
    return {
        ...template,
        uniqueName: generated.uniqueName,
        name: generated.name,
        dailyChallenges: [...generated.dailyChallenges],
        weeklyChallenges: [...generated.weeklyChallenges],
        titles: generated.titles.map(title => ({ ...title, reward: title.reward ? { ...title.reward } : undefined })),
        favours: (
            (generatedSyndicateFavours as Record<string, IGeneratedSyndicateFavours | undefined>)[tag]?.favours ??
            template.favours
        ).map(favour => ({ ...favour }))
    };
};

export const selfTestGeneratedMetadata = (): boolean => {
    let allGood = true;
    for (const [tag, generated] of Object.entries(generatedNightwaveSyndicates)) {
        const syndicate = getGeneratedNightwaveSyndicate(tag);
        const levels = new Set(generated.titles.map(title => title.level));
        if (
            !syndicate ||
            generated.currency.length == 0 ||
            generated.vendorManifest.length == 0 ||
            generated.dailyChallenges.length == 0 ||
            generated.weeklyChallenges.length == 0 ||
            generated.titles.length < 30 ||
            levels.size != generated.titles.length
        ) {
            logger.warn(`self test failed for generated Nightwave metadata ${tag}`);
            allGood = false;
        }
    }
    for (const [typeName, bundle] of Object.entries(generatedBundles)) {
        if (
            !typeName.startsWith("/Lotus/Types/StoreItems/Packages/") ||
            bundle.components.length == 0 ||
            (bundle.isCosmetic !== undefined && typeof bundle.isCosmetic != "boolean") ||
            bundle.components.some(
                component =>
                    (!component.typeName.startsWith("/Lotus/StoreItems/") &&
                        !component.typeName.startsWith("/Lotus/Types/StoreItems/Packages/")) ||
                    component.purchaseQuantity <= 0
            )
        ) {
            logger.warn(`self test failed for generated bundle metadata ${typeName}`);
            allGood = false;
        }
    }
    for (const [typeName, vendor] of Object.entries(generatedVendors)) {
        const nightwave = Object.values(generatedNightwaveSyndicates).find(x => x.vendorManifest == typeName);
        const invalidCommonOffer = vendor.items.some(
            offer =>
                (!offer.storeItem.startsWith("/Lotus/StoreItems/") &&
                    !offer.storeItem.startsWith("/Lotus/Types/StoreItems/")) ||
                offer.quantity <= 0 ||
                offer.bin < 0 ||
                (!offer.alwaysOffered && (!offer.probability || offer.probability <= 0)) ||
                (!offer.credits &&
                    !offer.platinum &&
                    !offer.itemPrices?.length &&
                    !offer.numRandomItemPrices &&
                    !offer.syndicate?.standingCost &&
                    !offer.focusXpCost?.cost)
        );
        const invalidNightwaveOffer =
            nightwave != undefined &&
            vendor.items.some(
                offer =>
                    (!offer.itemPrices?.length && !offer.numRandomItemPrices) ||
                    (offer.itemPrices?.some(price => price.ItemCount <= 0 || price.ItemType != nightwave.currency) ??
                        false)
            );
        if (
            !typeName.startsWith("/Lotus/Types/Game/VendorManifests/") ||
            vendor.sourceSha256.length != 64 ||
            vendor.items.length == 0 ||
            invalidCommonOffer ||
            (nightwave != undefined && (!nightwave.vendorPayloadAvailable || !vendor.isDynamic)) ||
            invalidNightwaveOffer
        ) {
            logger.warn(`self test failed for generated vendor metadata ${typeName}`);
            allGood = false;
        }
    }
    for (const [tag, current] of Object.entries(generatedSyndicateFavours)) {
        if (
            !tag.endsWith("Syndicate") ||
            current.uniqueName.split("/").at(-1) != tag ||
            !current.manifestPath.startsWith("/Lotus/Syndicates/") ||
            current.sourceSha256.length != 64 ||
            (current.sourceFavourCount != undefined &&
                current.sourceFavourCount != current.favours.length + (current.rejectedFavours?.length ?? 0)) ||
            current.favours.length == 0 ||
            current.favours.some(
                favour =>
                    (!favour.storeItem.startsWith("/Lotus/StoreItems/") &&
                        !favour.storeItem.startsWith("/Lotus/Types/StoreItems/")) ||
                    favour.standingCost < 0 ||
                    favour.creditsCost < 0 ||
                    favour.requiredLevel < 0
            )
        ) {
            logger.warn(`self test failed for generated syndicate favour metadata ${tag}`);
            allGood = false;
        }
    }
    if (
        generatedDojoRecipes &&
        (generatedDojoRecipes.manifestPath != "/Lotus/Types/Game/Store/DojoRecipeManifest" ||
            generatedDojoRecipes.sourceSha256.length != 64 ||
            generatedDojoRecipes.currentManifestCount <= 0 ||
            // These are supplements to Public Export: a current snapshot may
            // have only new decorations and no missing research recipes.
            Object.keys(generatedDojoRecipes.research).length + Object.keys(generatedDojoRecipes.decos).length == 0 ||
            Object.entries(generatedDojoRecipes.research).some(
                ([typeName, recipe]) =>
                    !typeName.startsWith("/Lotus/") ||
                    recipe.price < 0 ||
                    recipe.time < 0 ||
                    recipe.skipTimePrice < 0 ||
                    recipe.replicatePrice < 0 ||
                    recipe.ingredients.some(
                        ingredient => !ingredient.ItemType.startsWith("/Lotus/") || ingredient.ItemCount <= 0
                    )
            ) ||
            Object.entries(generatedDojoRecipes.decos).some(
                ([typeName, recipe]) =>
                    !typeName.startsWith("/Lotus/") ||
                    !recipe.resultType.startsWith("/Lotus/") ||
                    recipe.ingredients.some(
                        ingredient => !ingredient.ItemType.startsWith("/Lotus/") || ingredient.ItemCount <= 0
                    )
            ))
    ) {
        logger.warn("self test failed for generated current Dojo recipe metadata");
        allGood = false;
    }
    for (const [typeName, cosmetic] of Object.entries(generatedCosmetics)) {
        if (
            typeName != cosmetic.typeName ||
            !cosmetic.typeName.startsWith("/Lotus/") ||
            cosmetic.typeName.startsWith("/Lotus/StoreItems/") ||
            !cosmetic.storeItem.startsWith("/Lotus/StoreItems/") ||
            !["WeaponSkins", "FlavourItems", "ShipDecorations"].includes(cosmetic.productCategory) ||
            !cosmetic.localizeTag.startsWith("/")
        ) {
            logger.warn(`self test failed for generated cosmetic metadata ${typeName}`);
            allGood = false;
        }
    }
    if (itemRegistrySummary || Object.keys(generatedItems).length != 0) {
        const records = Object.entries(generatedItems);
        const noExplicitServerRecord = records
            .filter(([, item]) => item.serverRecordSource == "None")
            .map(([typeName]) => typeName)
            .sort();
        if (
            !itemRegistrySummary ||
            itemRegistrySummary.storeWrapperCount <= 0 ||
            itemRegistrySummary.admittedCount != records.length ||
            itemRegistrySummary.admittedCount + itemRegistrySummary.rejectedCount !=
                itemRegistrySummary.storeWrapperCount ||
            itemRegistrySummary.exactPairCount < itemRegistrySummary.admittedCount ||
            itemRegistrySummary.exactPairCount > itemRegistrySummary.storeWrapperCount ||
            itemRegistrySummary.rejectionSha256.length != 64 ||
            itemRegistrySummary.noExplicitServerRecordCount != noExplicitServerRecord.length ||
            itemRegistrySummary.noExplicitServerRecordSha256 != sha256Lines(noExplicitServerRecord) ||
            !sameCounts(itemRegistrySummary.categoryCounts, countBy(records.map(([, item]) => item.productCategory))) ||
            !sameCounts(
                itemRegistrySummary.serverRecordSourceCounts,
                countBy(records.map(([, item]) => item.serverRecordSource))
            )
        ) {
            logger.warn("self test failed for generated item registry summary");
            allGood = false;
        }
        const seenStoreItems = new Set<string>();
        for (const [typeName, item] of records) {
            const cosmetic = getGeneratedCosmetic(typeName);
            const datasetsSorted = [...item.publicExportDatasets].sort();
            const effectiveMetadata = item.effectiveMetadata ?? {};
            const effectiveMetadataSourcePaths = item.effectiveMetadataSourcePaths ?? {};
            const metadataKeys = Object.keys(effectiveMetadata).sort();
            const metadataSourceKeys = Object.keys(effectiveMetadataSourcePaths).sort();
            const boosterPackValid =
                item.boosterPack == undefined ||
                (item.boosterPack.components.length != 0 &&
                    item.boosterPack.rarityWeightsPerRoll.length != 0 &&
                    item.boosterPack.components.every(
                        component =>
                            component.item.startsWith("/Lotus/") &&
                            component.amount > 0 &&
                            ["COMMON", "UNCOMMON", "RARE", "LEGENDARY"].includes(component.rarity)
                    ) &&
                    item.boosterPack.rarityWeightsPerRoll.every(
                        weights =>
                            Object.keys(weights).sort().join(",") == "COMMON,LEGENDARY,RARE,UNCOMMON" &&
                            Object.values(weights).every(weight => Number.isFinite(weight) && weight >= 0)
                    ));
            const validSource =
                (item.serverRecordSource == "GeneratedCosmetic" &&
                    cosmetic != undefined &&
                    cosmetic.storeItem == item.storeItem &&
                    cosmetic.productCategory == item.productCategory &&
                    cosmetic.localizeTag == item.localizeTag) ||
                (item.serverRecordSource == "PublicExport" && item.publicExportDatasets.length != 0) ||
                (item.serverRecordSource == "None" && cosmetic == undefined && item.publicExportDatasets.length == 0);
            if (
                typeName != item.typeName ||
                !typeName.startsWith("/Lotus/") ||
                typeName.startsWith("/Lotus/StoreItems/") ||
                item.storeItem != `/Lotus/StoreItems/${typeName.slice("/Lotus/".length)}` ||
                seenStoreItems.has(item.storeItem) ||
                item.productCategory.length == 0 ||
                !item.localizeTag.startsWith("/") ||
                !item.categorySourcePath.startsWith("/") ||
                !item.localizationSourcePath.startsWith("/") ||
                JSON.stringify(item.publicExportDatasets) != JSON.stringify(datasetsSorted) ||
                new Set(item.publicExportDatasets).size != item.publicExportDatasets.length ||
                JSON.stringify(Object.keys(effectiveMetadata)) != JSON.stringify(metadataKeys) ||
                JSON.stringify(metadataKeys) != JSON.stringify(metadataSourceKeys) ||
                Object.values(effectiveMetadataSourcePaths).some(sourcePath => !sourcePath.startsWith("/")) ||
                !boosterPackValid ||
                !validSource
            ) {
                logger.warn(`self test failed for generated item registry record ${typeName}`);
                allGood = false;
            }
            seenStoreItems.add(item.storeItem);
        }
        for (const typeName of Object.keys(generatedCosmetics)) {
            if (getGeneratedItem(typeName)?.serverRecordSource != "GeneratedCosmetic") {
                logger.warn(`self test failed: generated cosmetic absent from item registry ${typeName}`);
                allGood = false;
            }
        }
    }
    return allGood;
};
