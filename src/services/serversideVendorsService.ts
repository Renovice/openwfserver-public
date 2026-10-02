import { unixTimesInMs } from "../constants/timeConstants.ts";
import { catBreadHash } from "../helpers/stringHelpers.ts";
import { mixSeeds, SRng } from "./rngService.ts";
import type { ICachedVendorManifest, IItemManifest, IVendorInfo, IVendorManifest } from "../types/vendorTypes.ts";
import { logger } from "../utils/logger.ts";
import type { IRange, IVendor, IVendorOffer } from "warframe-public-export-plus";
import { ExportUpgrades, ExportVendors } from "warframe-public-export-plus";
import { config } from "./configService.ts";
import type { IAffiliation } from "../types/inventoryTypes/inventoryTypes.ts";
import { getNightwaveSyndicateTag, nightwaveTagToSeason } from "./worldStateService.ts";
import { legacyNightwaveVendorManifest } from "../constants/legacyNightwaveVendorManifest.ts";
import { BV_LATEST } from "../constants/gameVersions.ts";
import { getVendor, supplementalVendors, toStoreItem } from "./itemDataService.ts";
import {
    generatedNightwaveSyndicates,
    generatedVendors,
    getGeneratedNightwaveDefinition,
    getGeneratedVendor
} from "./generatedMetadataService.ts";
import { nightwaveDebugCatalog } from "../helpers/nightwaveDebugCatalog.ts";

interface IGeneratableVendorInfo extends Omit<IVendorInfo, "ItemManifest" | "Expiry"> {
    cycleOffset?: number;
    cycleDuration: number;
}

const generatableVendors: IGeneratableVendorInfo[] = [
    {
        _id: { $oid: "67dadc30e4b6e0e5979c8d84" },
        TypeName: "/Lotus/Types/Game/VendorManifests/TheHex/InfestedLichWeaponVendorManifest",
        RandomSeedType: "VRST_WEAPON",
        RequiredGoalTag: "",
        WeaponUpgradeValueAttenuationExponent: 2.25,
        cycleOffset: 1740960000_000,
        cycleDuration: 4 * unixTimesInMs.day
    },
    {
        _id: { $oid: "60ad3b6ec96976e97d227e19" },
        TypeName: "/Lotus/Types/Game/VendorManifests/Hubs/PerrinSequenceWeaponVendorManifest",
        RandomSeedType: "VRST_WEAPON",
        WeaponUpgradeValueAttenuationExponent: 2.25,
        cycleOffset: 1744934400_000,
        cycleDuration: 4 * unixTimesInMs.day
    }
];

const getVendorOid = (typeName: string): string => {
    return "5be4a159b144f3cd" + catBreadHash(typeName).toString(16).padStart(8, "0");
};

// Debug shop (config.worldState.nightwaveDebugShop*): turns the Nightwave Cred shop into a "buy anything" vendor.
// Every entry is alwaysOffered (never rotates) and priced 25-35 Nightwave Creds (stable per item). Built lazily + cached.
// Fallback Cred item (oldest seasons). Each Nightwave season actually uses its OWN Cred item (e.g.
// NoraIntermissionFifteenCreds for Time Tempests), so the debug price is built with the CURRENT season's currency
// read from its live manifest. Offers are cached per (kind, currency).
const DEFAULT_NIGHTWAVE_CRED_ITEM = "/Lotus/Types/Items/MiscItems/NoraWolfCreds";
const debugOffersCache = new Map<string, IVendorOffer[]>();
const buildDebugVendorOffers = (uniqueNames: string[], credItem: string): IVendorOffer[] => {
    const offers: IVendorOffer[] = [];
    for (const uniqueName of uniqueNames) {
        let storeItem: string;
        try {
            storeItem = uniqueName.startsWith("/Lotus/Types/StoreItems/Packages/")
                ? uniqueName
                : toStoreItem(uniqueName);
        } catch {
            continue;
        }
        offers.push({
            storeItem,
            quantity: 1,
            alwaysOffered: true,
            duplicates: 0,
            bin: 0,
            durationHours: 168,
            itemPrices: [{ ItemType: credItem, ItemCount: 25 + (Math.abs(catBreadHash(storeItem)) % 11) }]
        });
    }
    return offers;
};
const getDebugVendorOffers = (kind: string, uniqueNames: string[], credItem: string): IVendorOffer[] => {
    const key = kind + "|" + credItem;
    let offers = debugOffersCache.get(key);
    if (!offers) {
        offers = buildDebugVendorOffers(uniqueNames, credItem);
        debugOffersCache.set(key, offers);
    }
    return offers;
};

const warnedNightwaveVendorFallbacks = new Set<string>();
const getGeneratedNightwaveVendorFallback = (typeName: string): IVendor | undefined => {
    const generated = Object.values(generatedNightwaveSyndicates).find(x => x.vendorManifest == typeName);
    if (!generated || generated.vendorPayloadAvailable) return undefined;

    const templateManifest =
        "/Lotus/Types/Game/VendorManifests/Events/" + generated.templateTag.replace(/Syndicate$/, "VendorManifest");
    if (!(templateManifest in ExportVendors)) return undefined;
    const template = getVendor(templateManifest)!;

    if (!warnedNightwaveVendorFallbacks.has(typeName)) {
        warnedNightwaveVendorFallbacks.add(typeName);
        logger.warn(`using explicit prior-season Nightwave vendor rotation until current Public Export is available`, {
            requested: typeName,
            template: templateManifest,
            currency: generated.currency
        });
    }

    return {
        ...template,
        items: template.items.map(offer => ({
            ...offer,
            itemPrices: offer.itemPrices?.map(price => ({
                ...price,
                ItemType: /\/Nora(?:Intermission\w+|Wolf)Creds$/.test(price.ItemType)
                    ? generated.currency
                    : price.ItemType
            }))
        }))
    };
};

// https://stackoverflow.com/a/17445304
const gcd = (a: number, b: number): number => {
    return b ? gcd(b, a % b) : a;
};

const getCycleDuration = (manifest: IVendor): number => {
    let dur = 0;
    for (const item of manifest.items) {
        if (item.alwaysOffered) {
            continue;
        }
        const durationHours = item.rotatedWeekly ? 168 : item.durationHours;
        if (typeof durationHours != "number") {
            dur = 1;
            break;
        }
        if (dur != durationHours) {
            dur = gcd(dur, durationHours);
        }
    }
    return dur * unixTimesInMs.hour;
};

export const getVendorManifestByTypeName = (
    typeName: string,
    fullStock?: boolean,
    buildVersion: number = BV_LATEST
): ICachedVendorManifest | undefined => {
    for (const vendorInfo of generatableVendors) {
        if (vendorInfo.TypeName == typeName) {
            return generateVendorManifest(vendorInfo, fullStock ?? config.fullyStockedVendors);
        }
    }
    if (typeName.startsWith("/Lotus/Types/Game/VendorManifests/Events/RadioLegion")) {
        const manifestType = getLegacyNightwaveManifestType(buildVersion);
        // Base manifest: one of the 5 legacy manifests (seasons 0-4) when applicable; otherwise prefer the
        // updater-generated datafile from the installed client, then Public Export, then the explicit prior-season
        // fallback. The generated path preserves the current season's complete pool, bins, quotas and prices.
        const base =
            (manifestType ? legacyNightwaveVendorManifest[manifestType] : undefined) ??
            getGeneratedVendor(typeName) ??
            (typeName in ExportVendors ? getVendor(typeName) : undefined) ??
            getGeneratedNightwaveVendorFallback(typeName);
        if (base) {
            // Each debug-shop category is independent and always offered. The four appearance pools keep the client
            // from rendering the whole catalog at once; world/orbiter geometry, Arcanes, and Mods remain separate.
            // Price uses the CURRENT season's own Cred item rather than a hardcoded Wolf Cred.
            const credItem =
                base.items.find(o => o.itemPrices?.[0]?.ItemType)?.itemPrices?.[0]?.ItemType ??
                DEFAULT_NIGHTWAVE_CRED_ITEM;
            let manifest = base;
            const debugItems: IVendorOffer[] = [
                ...(config.worldState?.nightwaveDebugShopWarframeAppearance
                    ? getDebugVendorOffers("warframeAppearance", nightwaveDebugCatalog.warframeAppearance, credItem)
                    : []),
                ...(config.worldState?.nightwaveDebugShopWeaponAppearance
                    ? getDebugVendorOffers("weaponAppearance", nightwaveDebugCatalog.weaponAppearance, credItem)
                    : []),
                ...(config.worldState?.nightwaveDebugShopOperatorCompanionVehicleAppearance
                    ? getDebugVendorOffers(
                          "operatorCompanionVehicleAppearance",
                          nightwaveDebugCatalog.operatorCompanionVehicleAppearance,
                          credItem
                      )
                    : []),
                ...(config.worldState?.nightwaveDebugShopProfileEmotesInterface
                    ? getDebugVendorOffers(
                          "profileEmotesInterface",
                          nightwaveDebugCatalog.profileEmotesInterface,
                          credItem
                      )
                    : []),
                ...(config.worldState?.nightwaveDebugShopDecorations
                    ? getDebugVendorOffers("decorations", nightwaveDebugCatalog.decorations, credItem)
                    : []),
                ...(config.worldState?.nightwaveDebugShopArcanes
                    ? getDebugVendorOffers("arcanes", nightwaveDebugCatalog.arcanes, credItem)
                    : []),
                ...(config.worldState?.nightwaveDebugShopMods
                    ? getDebugVendorOffers("mods", Object.keys(ExportUpgrades), credItem)
                    : [])
            ];
            if (debugItems.length) {
                // nightwaveDebugShopHideRegular (default true) = REPLACE Nora's normal wares; set false to KEEP them
                // and add the debug items alongside. Either way strip the base manifest's counted-offer controls
                // (numItems / numItemsPerBin) so the all-alwaysOffered debug items don't roll from an empty pool
                // (the getOfferId(undefined) startup crash). When keeping the regular wares, drop debug rows for
                // items the season already sells: two rows with the same StoreItem and Cred share one offer id, so
                // the rotating scheduler could never reach its all-items target and looped forever.
                const regularStoreItems = new Set(base.items.map(offer => offer.storeItem));
                const items =
                    config.worldState?.nightwaveDebugShopHideRegular === false
                        ? [...base.items, ...debugItems.filter(offer => !regularStoreItems.has(offer.storeItem))]
                        : debugItems;
                manifest = { ...base, items, numItems: undefined, numItemsPerBin: undefined };
            }
            if (manifestType && typeName != manifestType) {
                logger.debug(`swapping ${typeName} to ${manifestType} for proper nightwave shop`);
            }
            return generateVendorManifest(
                {
                    _id: { $oid: getVendorOid(manifestType ?? typeName) },
                    TypeName: typeName,
                    RandomSeedType: manifest.randomSeedType,
                    cycleDuration: getCycleDuration(manifest) || unixTimesInMs.week
                },
                fullStock ?? config.fullyStockedVendors,
                manifest
            );
        }
    }
    if (typeName in generatedVendors || typeName in ExportVendors || typeName in supplementalVendors) {
        const manifest = getGeneratedVendor(typeName) ?? getVendor(typeName)!;
        return generateVendorManifest(
            {
                _id: { $oid: getVendorOid(typeName) },
                TypeName: typeName,
                RandomSeedType: manifest.randomSeedType,
                cycleDuration: getCycleDuration(manifest)
            },
            fullStock ?? config.fullyStockedVendors,
            manifest
        );
    }
    return undefined;
};

export const getVendorManifestByOid = (oid: string, buildVersion: number): ICachedVendorManifest | undefined => {
    for (const vendorInfo of generatableVendors) {
        if (vendorInfo._id.$oid == oid) {
            return generateVendorManifest(vendorInfo, config.fullyStockedVendors);
        }
    }
    // Purchases identify the source vendor by OID. Resolve every Nightwave OID back through the
    // TypeName path so the purchase validator sees the same debug-expanded/current-season manifest
    // that was advertised to the client. Falling through to the generic generated/export loops would
    // rebuild only the native base manifest and reject valid debug-shop offers as unknown.
    const nightwaveTypeNames = new Set([
        ...Object.keys(generatedVendors),
        ...Object.keys(ExportVendors),
        ...Object.values(generatedNightwaveSyndicates).map(definition => definition.vendorManifest)
    ]);
    for (const typeName of nightwaveTypeNames) {
        if (
            typeName.startsWith("/Lotus/Types/Game/VendorManifests/Events/RadioLegion") &&
            getVendorOid(typeName) == oid
        ) {
            return getVendorManifestByTypeName(typeName, config.fullyStockedVendors, buildVersion);
        }
    }
    for (const [typeName, manifest] of Object.entries(generatedVendors)) {
        const typeNameOid = getVendorOid(typeName);
        if (typeNameOid == oid) {
            return generateVendorManifest(
                {
                    _id: { $oid: typeNameOid },
                    TypeName: typeName,
                    RandomSeedType: manifest.randomSeedType,
                    cycleDuration: getCycleDuration(manifest)
                },
                config.fullyStockedVendors,
                manifest
            );
        }
    }
    for (const [typeName, manifest] of Object.entries(ExportVendors)) {
        const typeNameOid = getVendorOid(typeName);
        if (typeNameOid == oid) {
            return generateVendorManifest(
                {
                    _id: { $oid: typeNameOid },
                    TypeName: typeName,
                    RandomSeedType: manifest.randomSeedType,
                    cycleDuration: getCycleDuration(manifest)
                },
                config.fullyStockedVendors,
                getVendor(typeName) ?? manifest
            );
        }
    }
    for (const [typeName, manifest] of Object.entries(supplementalVendors)) {
        const typeNameOid = getVendorOid(typeName);
        if (typeNameOid == oid) {
            return generateVendorManifest(
                {
                    _id: { $oid: typeNameOid },
                    TypeName: typeName,
                    RandomSeedType: manifest.randomSeedType,
                    cycleDuration: getCycleDuration(manifest)
                },
                config.fullyStockedVendors,
                getVendor(typeName) ?? manifest
            );
        }
    }
    {
        const manifestType = getLegacyNightwaveManifestType(buildVersion);
        if (manifestType) {
            const nightwaveOid = getVendorOid(manifestType);
            if (nightwaveOid == oid) {
                const manifest = legacyNightwaveVendorManifest[manifestType];
                return generateVendorManifest(
                    {
                        _id: { $oid: nightwaveOid },
                        TypeName: manifestType,
                        RandomSeedType: manifest.randomSeedType,
                        cycleDuration: getCycleDuration(manifest)
                    },
                    config.fullyStockedVendors,
                    manifest
                );
            }
        }
    }
    return undefined;
};

// Returned manifest is a partial copy, but some readonly refs are retained, hence ICachedVendorManifest.
export const applyStandingToVendorManifest = (
    vendorManifest: ICachedVendorManifest,
    affiliations: IAffiliation[]
): ICachedVendorManifest => {
    return {
        VendorInfo: {
            ...vendorManifest.VendorInfo,
            ItemManifest: [...vendorManifest.VendorInfo.ItemManifest].map(offer => {
                if (offer.Affiliation && offer.ReductionPerPositiveRank && offer.IncreasePerNegativeRank) {
                    const title: number = affiliations.find(x => x.Tag == offer.Affiliation)?.Title ?? 0;
                    const factor =
                        1 + (title < 0 ? offer.IncreasePerNegativeRank : offer.ReductionPerPositiveRank) * title * -1;
                    logger.trace(`applying standing to vendor offer`, {
                        Affiliations: offer.Affiliation,
                        title,
                        factor
                    });
                    if (factor) {
                        offer = { ...offer };
                        if (offer.RegularPrice) {
                            offer.RegularPriceBeforeDiscount = offer.RegularPrice;
                            offer.RegularPrice = [
                                Math.trunc(offer.RegularPriceBeforeDiscount[0] * factor),
                                Math.trunc(offer.RegularPriceBeforeDiscount[1] * factor)
                            ];
                        }
                        if (offer.ItemPrices) {
                            offer.ItemPricesBeforeDiscount = offer.ItemPrices;
                            offer.ItemPrices = [];
                            for (const item of offer.ItemPricesBeforeDiscount) {
                                offer.ItemPrices.push({ ...item, ItemCount: Math.trunc(item.ItemCount * factor) });
                            }
                        }
                    }
                }
                return offer;
            })
        }
    };
};

const toRange = (value: IRange | number): IRange => {
    if (typeof value == "number") {
        return { minValue: value, maxValue: value };
    }
    return value;
};

const getCycleDurationRange = (manifest: IVendor): IRange | undefined => {
    const res: IRange = { minValue: Number.MAX_SAFE_INTEGER, maxValue: 0 };
    for (const offer of manifest.items) {
        if (offer.durationHours) {
            const range = toRange(offer.durationHours);
            if (res.minValue > range.minValue) {
                res.minValue = range.minValue;
            }
            if (res.maxValue < range.maxValue) {
                res.maxValue = range.maxValue;
            }
        }
    }
    return res.maxValue != 0 ? res : undefined;
};

interface IOfferIdentifiers {
    storeItem: string;
    quantity: number;
    firstItemPriceType?: string;
}

const getOfferIdentifiers = (offer: IVendorOffer | IItemManifest, manifest: IVendor): IOfferIdentifiers => {
    let obj: IOfferIdentifiers;
    if ("storeItem" in offer) {
        // IVendorOffer
        obj = {
            storeItem: offer.storeItem,
            quantity: offer.quantity
        };
        if ((offer.itemPrices?.length ?? 0) > 0) {
            obj.firstItemPriceType = offer.itemPrices![0].ItemType;
        }
    } else {
        // IItemManifest
        obj = {
            storeItem: offer.StoreItem,
            quantity: offer.QuantityMultiplier
        };
        const rawItem = manifest.items.find(i => i.storeItem == offer.StoreItem && "BIN_" + i.bin == offer.Bin);
        if (rawItem?.itemPrices?.length) {
            obj.firstItemPriceType = rawItem.itemPrices![0].ItemType;
        }
    }
    return obj;
};

type TOfferId = string;

const getOfferId = (offer: IVendorOffer | IItemManifest, manifest: IVendor): TOfferId => {
    const { storeItem, quantity, firstItemPriceType } = getOfferIdentifiers(offer, manifest);
    let str = storeItem + "x" + quantity;
    if (firstItemPriceType) {
        str += ":" + firstItemPriceType;
    }
    return str;
};

let vendorManifestCacheMode = "";
const vendorManifestCache: Record<string, IVendorManifest> = {};

const clearVendorCache = (): void => {
    for (const k of Object.keys(vendorManifestCache)) {
        delete vendorManifestCache[k];
    }
};

const generateVendorManifest = (
    vendorInfo: IGeneratableVendorInfo,
    fullStock: boolean | undefined,
    manifest?: IVendor
): ICachedVendorManifest => {
    fullStock ??= config.fullyStockedVendors;
    fullStock ??= false;
    // The WebUI edits these flags at runtime. Include them in the cache identity so the next
    // manifest request reflects the selected pools instead of serving the prior debug catalog
    // until its far-future always-offered expiry.
    const cacheMode = [
        fullStock ? 1 : 0,
        config.worldState?.nightwaveDebugShopWarframeAppearance ? 1 : 0,
        config.worldState?.nightwaveDebugShopWeaponAppearance ? 1 : 0,
        config.worldState?.nightwaveDebugShopOperatorCompanionVehicleAppearance ? 1 : 0,
        config.worldState?.nightwaveDebugShopProfileEmotesInterface ? 1 : 0,
        config.worldState?.nightwaveDebugShopDecorations ? 1 : 0,
        config.worldState?.nightwaveDebugShopArcanes ? 1 : 0,
        config.worldState?.nightwaveDebugShopMods ? 1 : 0,
        config.worldState?.nightwaveDebugShopHideRegular === false ? 0 : 1
    ].join("");
    if (vendorManifestCacheMode != cacheMode) {
        vendorManifestCacheMode = cacheMode;
        clearVendorCache();
    }

    if (
        vendorInfo.TypeName in vendorManifestCache &&
        vendorManifestCache[vendorInfo.TypeName].VendorInfo._id.$oid != vendorInfo._id.$oid
    ) {
        delete vendorManifestCache[vendorInfo.TypeName];
    }

    if (!(vendorInfo.TypeName in vendorManifestCache)) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { cycleOffset, cycleDuration, ...clientVendorInfo } = vendorInfo;
        vendorManifestCache[vendorInfo.TypeName] = {
            VendorInfo: {
                ...clientVendorInfo,
                ItemManifest: [],
                Expiry: { $date: { $numberLong: "0" } }
            }
        };
    }
    const cacheEntry = vendorManifestCache[vendorInfo.TypeName];
    const info = cacheEntry.VendorInfo;
    if (!manifest) manifest = getVendor(vendorInfo.TypeName)!;
    const cycleDurationRange = getCycleDurationRange(manifest);
    let now = Date.now();
    if (cycleDurationRange && cycleDurationRange.minValue != cycleDurationRange.maxValue) {
        now -= (cycleDurationRange.maxValue - 1) * unixTimesInMs.hour;
    }
    while (Date.now() >= parseInt(info.Expiry.$date.$numberLong)) {
        // Remove expired offers
        for (let i = 0; i != info.ItemManifest.length; ) {
            if (now >= parseInt(info.ItemManifest[i].Expiry.$date.$numberLong)) {
                info.ItemManifest.splice(i, 1);
            } else {
                ++i;
            }
        }

        // Add new offers
        const vendorSeed = parseInt(vendorInfo._id.$oid.substring(16), 16);
        const cycleOffset = vendorInfo.cycleOffset ?? 1734307200_000;
        const cycleDuration = vendorInfo.cycleDuration;
        const cycleIndex = Math.trunc((now - cycleOffset) / cycleDuration);
        const rng = new SRng(mixSeeds(vendorSeed, cycleIndex));
        const offersToAdd: IVendorOffer[] = [];
        if (fullStock) {
            // Full stock is a non-rotating catalog. Generate every native offer and each explicitly declared
            // duplicate once, then keep them alive until the setting changes and clears the cache. Feeding the
            // normal expiry scheduler here allowed short/variable-duration manifests to lose most of their pool.
            for (const rawItem of manifest.items) {
                for (let duplicate = 0; duplicate <= rawItem.duplicates; ++duplicate) {
                    offersToAdd.push(rawItem);
                }
            }
        } else if (manifest.isOneBinPerCycle) {
            const binThisCycle = cycleIndex % 2; // Note: May want to check the actual number of bins, but this is only used for coda weapons right now.
            for (const rawItem of manifest.items) {
                if (rawItem.bin == binThisCycle) {
                    offersToAdd.push(rawItem);
                }
            }
        } else {
            // Compute vendor requirements, subtracting existing offers
            const remainingItemCapacity: Record<TOfferId, number> = {};
            const missingItemsPerBin: Record<number, number> = {};
            let numOffersThatNeedToMatchABin = 0;
            if (manifest.numItemsPerBin) {
                for (let bin = 0; bin != manifest.numItemsPerBin.length; ++bin) {
                    missingItemsPerBin[bin] = manifest.numItemsPerBin[bin];
                    numOffersThatNeedToMatchABin += manifest.numItemsPerBin[bin];
                }
            }
            for (const item of manifest.items) {
                // A random-price offer is a template, not a unique catalog row. Some native
                // manifests deliberately request more scheduled offers than template types
                // (for example five Entrati Lab tasks from three rank templates), with each
                // instance receiving independently rolled currencies. Preserve that upstream
                // count contract while ordinary offers retain their exact duplicate limit.
                remainingItemCapacity[getOfferId(item, manifest)] = item.numRandomItemPrices
                    ? Math.max(1 + item.duplicates, manifest.numItems?.maxValue ?? 1)
                    : 1 + item.duplicates;
            }
            for (const offer of info.ItemManifest) {
                remainingItemCapacity[getOfferId(offer, manifest)] -= 1;
                const bin = parseInt(offer.Bin.substring(4));
                if (missingItemsPerBin[bin]) {
                    missingItemsPerBin[bin] -= 1;
                    numOffersThatNeedToMatchABin -= 1;
                }
            }

            // Add permanent offers
            let numUncountedOffers = 0;
            let numCountedOffers = 0;
            let offset = 0;
            for (const item of manifest.items) {
                if (item.alwaysOffered || item.rotatedWeekly) {
                    ++numUncountedOffers;
                    const id = getOfferId(item, manifest);
                    if (remainingItemCapacity[id] != 0) {
                        remainingItemCapacity[id] -= 1;
                        offersToAdd.push(item);
                        ++offset;
                    }
                    if (missingItemsPerBin[item.bin]) {
                        missingItemsPerBin[item.bin] -= 1;
                        numOffersThatNeedToMatchABin -= 1;
                    }
                } else {
                    numCountedOffers += 1 + item.duplicates;
                }
            }

            // Add counted offers
            const useRng =
                manifest.numItems &&
                (manifest.numItems.minValue != manifest.numItems.maxValue ||
                    manifest.numItems.minValue != numCountedOffers);
            const numItemsTarget = manifest.numItems
                ? numUncountedOffers +
                  Math.min(
                      Object.values(remainingItemCapacity).reduce((a, b) => a + b, 0),
                      useRng
                          ? rng.randomInt(manifest.numItems.minValue, manifest.numItems.maxValue)
                          : manifest.numItems.minValue
                  )
                : manifest.items.length;
            let i = 0;
            const rollableOffers = manifest.items.filter(x => x.probability !== undefined) as (Omit<
                IVendorOffer,
                "probability"
            > & { probability: number })[];
            while (info.ItemManifest.length + offersToAdd.length < numItemsTarget) {
                const item = useRng ? rng.randomReward(rollableOffers)! : rollableOffers[i++];
                if (
                    remainingItemCapacity[getOfferId(item, manifest)] != 0 &&
                    (numOffersThatNeedToMatchABin == 0 || missingItemsPerBin[item.bin])
                ) {
                    remainingItemCapacity[getOfferId(item, manifest)] -= 1;
                    if (missingItemsPerBin[item.bin]) {
                        missingItemsPerBin[item.bin] -= 1;
                        numOffersThatNeedToMatchABin -= 1;
                    }
                    offersToAdd.splice(offset, 0, item);
                }
                if (i == rollableOffers.length) {
                    i = 0;
                }
            }
        }
        const cycleStart = cycleOffset + cycleIndex * cycleDuration;
        for (const rawItem of offersToAdd) {
            const durationHoursRange = toRange(rawItem.durationHours ?? cycleDuration);
            const expiry =
                fullStock || rawItem.alwaysOffered
                    ? 2051240400_000
                    : cycleStart +
                      (rawItem.rotatedWeekly
                          ? unixTimesInMs.week
                          : rng.randomInt(durationHoursRange.minValue, durationHoursRange.maxValue) *
                            unixTimesInMs.hour);
            const item: IItemManifest = {
                StoreItem: rawItem.storeItem,
                ItemPrices: rawItem.itemPrices?.map(itemPrice => ({ ...itemPrice, ProductCategory: "MiscItems" })),
                Bin: "BIN_" + rawItem.bin,
                QuantityMultiplier: rawItem.quantity,
                Expiry: { $date: { $numberLong: expiry.toString() } },
                PurchaseQuantityLimit: rawItem.purchaseLimit,
                RotatedWeekly: rawItem.rotatedWeekly,
                Affiliation: rawItem.syndicate?.tag,
                MinAffiliationRank: rawItem.syndicate?.minRank,
                ReductionPerPositiveRank: rawItem.syndicate?.reductionPerPositiveRank,
                IncreasePerNegativeRank: rawItem.syndicate?.increasePerNegativeRank,
                StandingCost: rawItem.syndicate?.standingCost,
                AllowMultipurchase: rawItem.purchaseLimit !== 1,
                Id: {
                    $oid:
                        ((cycleStart / 1000) & 0xffffffff).toString(16).padStart(8, "0") +
                        vendorInfo._id.$oid.substring(8, 16) +
                        rng.randomInt(0, 0xffff_ffff).toString(16).padStart(8, "0")
                }
            };
            if (rawItem.numRandomItemPrices) {
                item.ItemPrices ??= [];
                for (let i = 0; i != rawItem.numRandomItemPrices; ++i) {
                    let itemPrice: { type: string; count: IRange };
                    do {
                        itemPrice = rng.randomElement(manifest.randomItemPricesPerBin![rawItem.bin])!;
                    } while (item.ItemPrices.find(x => x.ItemType == itemPrice.type));
                    item.ItemPrices.push({
                        ItemType: itemPrice.type,
                        ItemCount: rng.randomInt(itemPrice.count.minValue, itemPrice.count.maxValue),
                        ProductCategory: "MiscItems"
                    });
                }
            }
            if (rawItem.credits) {
                const value =
                    typeof rawItem.credits == "number"
                        ? rawItem.credits
                        : rng.randomInt(
                              rawItem.credits.minValue / rawItem.credits.step,
                              rawItem.credits.maxValue / rawItem.credits.step
                          ) * rawItem.credits.step;
                item.RegularPrice = [value, value];
            }
            if (rawItem.platinum) {
                const value =
                    typeof rawItem.platinum == "number"
                        ? rawItem.platinum
                        : rng.randomInt(rawItem.platinum.minValue, rawItem.platinum.maxValue);
                item.PremiumPrice = [value, value];
            }
            if (vendorInfo.RandomSeedType) {
                item.LocTagRandSeed = rng.randomInt(0, 0xffff_ffff);
                if (vendorInfo.RandomSeedType == "VRST_WEAPON") {
                    const highDword = rng.randomInt(0, 0xffff_ffff);
                    item.LocTagRandSeed = (BigInt(highDword) << 32n) | (BigInt(item.LocTagRandSeed) & 0xffffffffn);
                }
            }
            info.ItemManifest.push(item);
        }

        if (manifest.numItemsPerBin) {
            info.ItemManifest.sort((a, b) => {
                const aBin = parseInt(a.Bin.substring(4));
                const bBin = parseInt(b.Bin.substring(4));
                return aBin == bBin ? 0 : aBin < bBin ? +1 : -1;
            });
        }

        // Update vendor expiry
        let soonestOfferExpiry: number = Number.MAX_SAFE_INTEGER;
        for (const offer of info.ItemManifest) {
            const offerExpiry = parseInt(offer.Expiry.$date.$numberLong);
            if (soonestOfferExpiry > offerExpiry) {
                soonestOfferExpiry = offerExpiry;
            }
        }
        info.Expiry.$date.$numberLong = soonestOfferExpiry.toString();

        now += unixTimesInMs.hour;
    }
    return cacheEntry;
};

const getLegacyNightwaveManifestType = (buildVersion: number): string | undefined => {
    const affiliationTag = getNightwaveSyndicateTag(buildVersion);
    const manifests = Object.keys(legacyNightwaveVendorManifest);
    if (!affiliationTag) return undefined;
    const season = nightwaveTagToSeason[affiliationTag];
    return season >= 0 && season < manifests.length ? manifests[season] : undefined;
};

export const selfTestServersideVendors = (): boolean => {
    let allGood = true;

    if (
        getCycleDuration(ExportVendors["/Lotus/Types/Game/VendorManifests/Hubs/TeshinHardModeVendorManifest"]) !=
        unixTimesInMs.week
    ) {
        logger.warn(`getCycleDuration self test failed`);
        allGood = false;
    }

    for (let i = 0; i != 2; ++i) {
        const fullStock = !!i;

        const ads = getVendorManifestByTypeName(
            "/Lotus/Types/Game/VendorManifests/Hubs/GuildAdvertisementVendorManifest",
            fullStock
        )!.VendorInfo.ItemManifest;
        if (
            ads.length != 5 ||
            ads[0].Bin != "BIN_4" ||
            ads[1].Bin != "BIN_3" ||
            ads[2].Bin != "BIN_2" ||
            ads[3].Bin != "BIN_1" ||
            ads[4].Bin != "BIN_0"
        ) {
            logger.warn(
                `self test failed for /Lotus/Types/Game/VendorManifests/Hubs/GuildAdvertisementVendorManifest with fullStock=${fullStock}`
            );
            allGood = false;
        }
    }

    const cms = getVendorManifestByTypeName(
        "/Lotus/Types/Game/VendorManifests/Hubs/RailjackCrewMemberVendorManifest",
        false
    )!.VendorInfo.ItemManifest;
    if (
        cms.length != 9 ||
        cms[0].Bin != "BIN_2" ||
        cms[8].Bin != "BIN_0" ||
        cms.reduce((a, x) => a + (x.Bin == "BIN_2" ? 1 : 0), 0) < 2 ||
        cms.reduce((a, x) => a + (x.Bin == "BIN_1" ? 1 : 0), 0) < 2 ||
        cms.reduce((a, x) => a + (x.Bin == "BIN_0" ? 1 : 0), 0) < 4
    ) {
        logger.warn(`self test failed for /Lotus/Types/Game/VendorManifests/Hubs/RailjackCrewMemberVendorManifest`);
        allGood = false;
    }

    const temple = getVendorManifestByTypeName(
        "/Lotus/Types/Game/VendorManifests/TheHex/Temple1999VendorManifest",
        false
    )!.VendorInfo.ItemManifest;
    if (!temple.find(x => x.StoreItem == "/Lotus/StoreItems/Types/Items/MiscItems/Kuva")) {
        logger.warn(`self test failed for /Lotus/Types/Game/VendorManifests/TheHex/Temple1999VendorManifest`);
        allGood = false;
    }

    const nakak = getVendorManifestByTypeName("/Lotus/Types/Game/VendorManifests/Ostron/MaskSalesmanManifest", false)!
        .VendorInfo.ItemManifest;
    if (
        nakak.length != 10 ||
        nakak[0].StoreItem != "/Lotus/StoreItems/Upgrades/Skins/Ostron/RevenantMask" ||
        nakak[1].StoreItem != "/Lotus/StoreItems/Types/Items/ShipDecos/Plushies/PlushyThumper" ||
        nakak[1].ItemPrices?.length != 4 ||
        nakak[2].StoreItem != "/Lotus/StoreItems/Types/Items/ShipDecos/Plushies/PlushyThumperMedium" ||
        nakak[2].ItemPrices?.length != 4 ||
        nakak[3].StoreItem != "/Lotus/StoreItems/Types/Items/ShipDecos/Plushies/PlushyThumperLarge" ||
        nakak[3].ItemPrices?.length != 4
        // The remaining offers should be computed by weighted RNG.
    ) {
        logger.warn(`self test failed for /Lotus/Types/Game/VendorManifests/Ostron/MaskSalesmanManifest`);
        allGood = false;
    }

    // The current client declares five commission slots drawn with replacement from three tier
    // templates. Preserve all five offers; repeated StoreItems have independently generated costs.
    const loidType = "/Lotus/Types/Game/VendorManifests/EntratiLabs/EntratiLabsCommisionsManifest";
    const loid = getVendorManifestByTypeName(loidType, false)!.VendorInfo.ItemManifest;
    const loidDefinition = getVendor(loidType)!;
    const loidTemplates = new Set(loidDefinition.items.map(offer => offer.storeItem));
    if (loid.length != 5 || loid.some(offer => !loidTemplates.has(offer.StoreItem))) {
        logger.warn(`self test failed for ${loidType}`);
        allGood = false;
    }

    // Full stock must expose the complete native catalog. The normal rotation/quota scheduler used to keep
    // running after expansion, which could expire entries or collapse declared duplicates from these manifests.
    const codaType = "/Lotus/Types/Game/VendorManifests/TheHex/InfestedLichWeaponVendorManifest";
    const rotatedCoda = getVendorManifestByTypeName(codaType, false)!.VendorInfo.ItemManifest;
    const fullCoda = getVendorManifestByTypeName(codaType, true)!.VendorInfo.ItemManifest;
    if (rotatedCoda.length != 7 || fullCoda.length != 14) {
        logger.warn(`full-stock self test failed for ${codaType}`);
        allGood = false;
    }

    const grandmotherType = "/Lotus/Types/Game/VendorManifests/Deimos/HivemindCommisionsManifestTokenVendor";
    const grandmotherDefinition = getVendor(grandmotherType)!;
    const fullGrandmother = getVendorManifestByTypeName(grandmotherType, true)!.VendorInfo.ItemManifest;
    const expectedGrandmotherCount = grandmotherDefinition.items.reduce(
        (count, offer) => count + 1 + offer.duplicates,
        0
    );
    if (
        fullGrandmother.length != expectedGrandmotherCount ||
        grandmotherDefinition.items.some(
            rawOffer => !fullGrandmother.some(generatedOffer => generatedOffer.StoreItem == rawOffer.storeItem)
        )
    ) {
        logger.warn(`full-stock self test failed for ${grandmotherType}`);
        allGood = false;
    }

    const acrithisType = "/Lotus/Types/Game/VendorManifests/Duviri/AcrithisVendorManifest";
    const acrithisDefinition = getVendor(acrithisType)!;
    const fullAcrithis = getVendorManifestByTypeName(acrithisType, true)!.VendorInfo.ItemManifest;
    const expectedAcrithisCount = acrithisDefinition.items.reduce((count, offer) => count + 1 + offer.duplicates, 0);
    if (
        fullAcrithis.length != expectedAcrithisCount ||
        new Set(fullAcrithis.map(offer => offer.StoreItem)).size != acrithisDefinition.items.length
    ) {
        logger.warn(`full-stock self test failed for ${acrithisType}`);
        allGood = false;
    }

    // Hunhow sells the same Sirius/Orion blueprints for two different currencies. The first price type must be part
    // of the offer identity so those intentional variants do not collide and trap stock generation in an infinite loop.
    const hunhowType = "/Lotus/Types/Game/VendorManifests/Hubs/HunhowVendorManifest";
    const dualCurrencyBlueprints = [
        "/Lotus/StoreItems/Types/Recipes/WarframeRecipes/SiriusOrionBlueprint",
        "/Lotus/StoreItems/Types/Recipes/WarframeRecipes/SiriusOrionChassisBlueprint",
        "/Lotus/StoreItems/Types/Recipes/WarframeRecipes/SiriusOrionHelmetBlueprint",
        "/Lotus/StoreItems/Types/Recipes/WarframeRecipes/SiriusOrionSystemsBlueprint"
    ];
    const ashFavor = "/Lotus/Types/JadeShadowsPart2Mission/Gameplay/Resources/AshFavor";
    const garudaFavor = "/Lotus/Types/JadeShadowsPart2Mission/Gameplay/Resources/GarudaFavor";
    for (let i = 0; i != 2; ++i) {
        const fullStock = !!i;
        const hunhow = getVendorManifestByTypeName(hunhowType, fullStock)!.VendorInfo.ItemManifest;
        const hasBothCurrencyVariants = dualCurrencyBlueprints.every(storeItem => {
            const variants = hunhow.filter(offer => offer.StoreItem == storeItem);
            const priceTypes = variants.map(offer => offer.ItemPrices?.[0].ItemType);
            return variants.length == 2 && priceTypes.includes(ashFavor) && priceTypes.includes(garudaFavor);
        });
        if (hunhow.length != 53 || !hasBothCurrencyVariants) {
            logger.warn(`self test failed for ${hunhowType} with fullStock=${fullStock}`);
            allGood = false;
        }
    }

    // This should not produce an infinite loop.
    getVendorManifestByTypeName(
        "/Lotus/Types/Game/VendorManifests/Events/RadioLegionIntermission15VendorManifest",
        true
    );
    const currentNightwave = getGeneratedNightwaveDefinition("RadioLegionIntermission16Syndicate");
    if (currentNightwave) {
        const generatedVendor = getGeneratedVendor(currentNightwave.vendorManifest);
        clearVendorCache();
        const currentManifest = generatedVendor
            ? generateVendorManifest(
                  {
                      _id: { $oid: getVendorOid(currentNightwave.vendorManifest) },
                      TypeName: currentNightwave.vendorManifest,
                      RandomSeedType: generatedVendor.randomSeedType,
                      cycleDuration: getCycleDuration(generatedVendor) || unixTimesInMs.week
                  },
                  true,
                  generatedVendor
              )
            : undefined;
        if (!generatedVendor || !currentManifest) {
            logger.warn(`self test failed for generated Nightwave vendor ${currentNightwave.vendorManifest}`);
            allGood = false;
        } else if (
            currentManifest.VendorInfo.ItemManifest.length != generatedVendor.items.length ||
            currentManifest.VendorInfo.ItemManifest.some(offer =>
                offer.ItemPrices?.some(
                    price =>
                        /\/Nora(?:Intermission\w+|Wolf)Creds$/.test(price.ItemType) &&
                        price.ItemType != currentNightwave.currency
                )
            )
        ) {
            logger.warn(`self test found stale Nightwave currency in ${currentNightwave.vendorManifest}`);
            allGood = false;
        } else {
            const rotatingManifest = generateVendorManifest(
                {
                    _id: { $oid: getVendorOid(currentNightwave.vendorManifest) },
                    TypeName: currentNightwave.vendorManifest,
                    RandomSeedType: generatedVendor.randomSeedType,
                    cycleDuration: getCycleDuration(generatedVendor) || unixTimesInMs.week
                },
                false,
                generatedVendor
            );
            const permanentCount = generatedVendor.items.filter(offer => offer.alwaysOffered).length;
            const rotatingCount = generatedVendor.numItems
                ? typeof generatedVendor.numItems == "number"
                    ? generatedVendor.numItems
                    : generatedVendor.numItems.minValue
                : generatedVendor.items.length - permanentCount;
            if (
                rotatingManifest.VendorInfo.ItemManifest.length != permanentCount + rotatingCount ||
                rotatingManifest.VendorInfo.ItemManifest.some(offer =>
                    offer.ItemPrices?.some(price => price.ItemType != currentNightwave.currency)
                )
            ) {
                logger.warn(`self test failed deterministic rotation for ${currentNightwave.vendorManifest}`);
                allGood = false;
            }
        }
        // The self-test intentionally bypasses optional debug-shop augmentation. Drop its cache entry so a
        // developer-mode server rebuilds the next request from the actual runtime configuration.
        clearVendorCache();
    }
    return allGood;
};
