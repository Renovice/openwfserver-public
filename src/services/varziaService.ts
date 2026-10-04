import { ExportBundles, ExportRelics, ExportResources } from "warframe-public-export-plus";
import varzia from "../constants/varzia.ts";
import gameToBuildVersionInt from "../constants/gameToBuildVersionInt.ts";
import { BV_LATEST } from "../constants/gameVersions.ts";
import type { IPrimeVaultTraderOffer } from "../types/worldStateTypes.ts";
import { buildVersionToInt } from "../helpers/versionHelper.ts";
import { config } from "./configService.ts";
import { generatedClientBuildVersion } from "./generatedMetadataService.ts";
import { toStoreItem } from "./itemDataService.ts";
import { SRng } from "./rngService.ts";

// Prime Resurgence (Varzia) rotation.
//
// The rotation is the set of Mega Prime Vault dual packs in ExportBundles. The hand table in
// constants/varzia.ts stays authoritative for the packs it lists (it carries offer order, prices that
// the exports do not contain, and per-pack minimum client builds). Every other dual pack in the
// current export is derived from the export data, so a new Resurgence pack appears after the normal
// data update without a new table row:
// - single packs: the MPV<Name>PrimeSinglePack bundles sharing a Warframe with the dual pack,
//   ordered by where <Name> appears in the dual pack name;
// - single pack offers: the single pack's components, without avatar images and the fusion bundle,
//   with Mega Prime Vault sub-bundles (armor sets, sentinel accessories, ...) offered as the bundle;
// - bobbleheads: ShipDecos/<Name>Prime*BobbleHead resources;
// - relics: Bronze VoidProjection<..>Vault<X> relics whose name contains both single pack names
//   (ExportRelics, including generated current-client relics), ordered by tier and letter;
// - minimum build: the client build the generated metadata was produced from.
// scripts/metadata-audit/audit-varzia.ts checks these rules against every hand table entry.

export interface IVarziaDualPack {
    SinglePacks: string[];
    Relics: string[];
    minBuildVersionInt: number;
}

export interface IVarziaSinglePack {
    Items: IPrimeVaultTraderOffer[];
    BobbleHeads: string[];
}

const megaPrimeVaultPrefix = "/Lotus/Types/StoreItems/Packages/MegaPrimeVault/";
const singlePackPattern = /^\/Lotus\/Types\/StoreItems\/Packages\/MegaPrimeVault\/MPV([A-Za-z]+)PrimeSinglePack$/;
const dualPackPattern = /^\/Lotus\/Types\/StoreItems\/Packages\/MegaPrimeVault\/MPV([A-Za-z]+)PrimeDualPack$/;
const vaultRelicPattern = /^\/Lotus\/Types\/Game\/Projections\/T(\d)VoidProjection([A-Za-z]+)Vault([A-Z])Bronze$/;
const lastChanceItem = "/Lotus/StoreItems/Types/StoreItems/Packages/MegaPrimeVault/LastChanceItemC";

const getBundleComponents = (bundleType: string): string[] =>
    (ExportBundles[bundleType] as (typeof ExportBundles)[string] | undefined)?.components.map(x => x.typeName) ?? [];

const isSinglePack = (typeName: string): boolean => singlePackPattern.test(typeName);
const isDualPack = (typeName: string): boolean => dualPackPattern.test(typeName);

const getSinglePackName = (singlePack: string): string | undefined => singlePackPattern.exec(singlePack)?.[1];

const getWarframes = (components: string[]): string[] =>
    components.filter(x => x.startsWith("/Lotus/StoreItems/Powersuits/") && !x.includes("/Powersuits/Archwing/"));

const getMegaPrimeVaultSubBundles = (): string[] =>
    Object.keys(ExportBundles).filter(
        x =>
            x.startsWith(megaPrimeVaultPrefix) &&
            !isSinglePack(x) &&
            !isDualPack(x) &&
            getBundleComponents(x).length > 1
    );

/** Aya price of a Prime Resurgence item. Reproduces the hand table except for its documented deviations. */
export const getVarziaPrimePrice = (itemType: string): number => {
    if (itemType.startsWith(megaPrimeVaultPrefix) && !isSinglePack(itemType) && !isDualPack(itemType)) {
        return Math.max(1, ...getBundleComponents(itemType).map(getVarziaPrimePrice));
    }
    if (itemType.includes("/Powersuits/Archwing/")) {
        return 2;
    }
    if (itemType.includes("/Powersuits/")) {
        return 3;
    }
    if (
        /\/Weapons\/|\/Types\/Sentinels\/SentinelPowersuits\/|\/Scarves\/|\/Upgrades\/Skins\/(Effects|Armor|Operator|Necramech|Kubrows\/Armor|Catbrows\/Armor)\//.test(
            itemType
        )
    ) {
        return 2;
    }
    return 1;
};

/** Derives a single pack's offers and bobbleheads from the export; undefined if it is not a single pack. */
export const deriveVarziaSinglePack = (singlePack: string): IVarziaSinglePack | undefined => {
    const name = getSinglePackName(singlePack);
    if (!name || !(singlePack in ExportBundles)) {
        return undefined;
    }
    const components = getBundleComponents(singlePack).filter(
        x => !x.includes("/AvatarImages/") && !x.includes("/FusionBundles/")
    );
    const componentSet = new Set(components);
    const replacedBy = new Map<string, string>();
    for (const subBundle of getMegaPrimeVaultSubBundles()) {
        const subComponents = getBundleComponents(subBundle);
        if (subComponents.every(x => componentSet.has(x) && !replacedBy.has(x))) {
            for (const x of subComponents) {
                replacedBy.set(x, subBundle);
            }
        }
    }
    const itemTypes: string[] = [];
    for (const component of components) {
        const itemType = replacedBy.get(component) ?? component;
        if (!itemTypes.includes(itemType)) {
            itemTypes.push(itemType);
        }
    }
    const bobbleHeadPattern = new RegExp(`^/Lotus/Types/Items/ShipDecos/${name}Prime[A-Za-z]*BobbleHead$`);
    return {
        Items: itemTypes.map(ItemType => ({ ItemType, PrimePrice: getVarziaPrimePrice(ItemType) })),
        BobbleHeads: Object.keys(ExportResources)
            .filter(x => bobbleHeadPattern.test(x))
            .map(x => toStoreItem(x))
    };
};

/** Derives a dual pack's single packs and vault relics from the export; undefined if that is not possible. */
export const deriveVarziaDualPack = (dualPack: string): IVarziaDualPack | undefined => {
    const dualName = dualPackPattern.exec(dualPack)?.[1];
    if (!dualName || !(dualPack in ExportBundles)) {
        return undefined;
    }
    const warframes = new Set(getWarframes(getBundleComponents(dualPack)));
    const singlePacks = Object.keys(ExportBundles).filter(
        x => isSinglePack(x) && getWarframes(getBundleComponents(x)).some(y => warframes.has(y))
    );
    const names = singlePacks.map(x => getSinglePackName(x)!);
    if (singlePacks.length != 2 || names.some(x => !dualName.includes(x))) {
        return undefined;
    }
    const order = names.map(x => dualName.indexOf(x));
    if (order[1] < order[0]) {
        singlePacks.reverse();
        names.reverse();
    }
    const relics: { tier: number; letter: string; itemType: string }[] = [];
    for (const relic of Object.keys(ExportRelics)) {
        const match = vaultRelicPattern.exec(relic);
        if (match && names.every(x => match[2].includes(x))) {
            relics.push({ tier: parseInt(match[1]), letter: match[3], itemType: toStoreItem(relic) });
        }
    }
    relics.sort((a, b) => a.tier - b.tier || a.letter.localeCompare(b.letter));
    return {
        SinglePacks: singlePacks,
        Relics: relics.map(x => x.itemType),
        minBuildVersionInt: generatedClientBuildVersion ? buildVersionToInt(generatedClientBuildVersion) : BV_LATEST
    };
};

let dualPacksCache: Record<string, IVarziaDualPack> | undefined;
const singlePacksCache = new Map<string, IVarziaSinglePack>();

/** Hand table packs first (table order), then every other dual pack of the current export. */
export const getVarziaDualPacks = (): Record<string, IVarziaDualPack> => {
    if (!dualPacksCache) {
        const dualPacks: Record<string, IVarziaDualPack> = { ...varzia.primeDualPacks };
        for (const dualPack of Object.keys(ExportBundles).filter(isDualPack)) {
            if (!(dualPack in dualPacks)) {
                const derived = deriveVarziaDualPack(dualPack);
                if (derived) {
                    dualPacks[dualPack] = derived;
                }
            }
        }
        dualPacksCache = dualPacks;
    }
    return dualPacksCache;
};

const getVarziaSinglePack = (singlePack: string): IVarziaSinglePack => {
    let entry = singlePacksCache.get(singlePack);
    if (!entry) {
        entry = (varzia.primeSinglePacks[singlePack] as IVarziaSinglePack | undefined) ??
            deriveVarziaSinglePack(singlePack) ?? { Items: [], BobbleHeads: [] };
        singlePacksCache.set(singlePack, entry);
    }
    return entry;
};

export const getVarziaRotation = (week: number, buildVersion: number): string => {
    const seed = new SRng(week).randomInt(0, 100_000);
    const rng = new SRng(seed);
    const [itemType, rotation] = rng.randomElement(Object.entries(getVarziaDualPacks()))!;
    // Offer the pack only to clients that know it (same condition as getVarziaManifest).
    if (buildVersion >= rotation.minBuildVersionInt) {
        return itemType;
    } else {
        return lastChanceItem;
    }
};

export const getVarziaManifest = (dualPack: string, buildVersion: number): IPrimeVaultTraderOffer[] => {
    const rotationManifest = getVarziaDualPacks()[dualPack] as IVarziaDualPack | undefined;
    if (!rotationManifest || buildVersion < rotationManifest.minBuildVersionInt) {
        return [];
    }
    const mainPack = [{ ItemType: dualPack, PrimePrice: 10 }];
    const singlePacks: IPrimeVaultTraderOffer[] = [];
    const vanguardRelics: IPrimeVaultTraderOffer[] = [];
    const items: IPrimeVaultTraderOffer[] = [];
    const bobbleHeads: IPrimeVaultTraderOffer[] = [];

    if (config.worldState?.vanguardVaultRelics && buildVersion >= gameToBuildVersionInt["41.0.0"]) {
        vanguardRelics.push(...varzia.vanguardVaultRelics);
    }

    for (const singlePackType of rotationManifest.SinglePacks) {
        singlePacks.push({ ItemType: singlePackType, PrimePrice: 6 });

        const sp = getVarziaSinglePack(singlePackType);
        items.push(...sp.Items);
        sp.BobbleHeads.forEach(bobbleHead => {
            bobbleHeads.push({ ItemType: bobbleHead, PrimePrice: 1 });
        });
    }

    const relics = rotationManifest.Relics.map(relic => ({ ItemType: relic, RegularPrice: 1 }));

    return [singlePacks[0], ...mainPack, singlePacks[1], ...vanguardRelics, ...items, ...bobbleHeads, ...relics];
};

export const getAllVarziaManifests = (buildVersion: number): IPrimeVaultTraderOffer[] => {
    const dualPacks: IPrimeVaultTraderOffer[] = [];
    const singlePacks: IPrimeVaultTraderOffer[] = [];
    const vanguardRelics: IPrimeVaultTraderOffer[] = [];
    const items: IPrimeVaultTraderOffer[] = [];
    const bobbleHeads: IPrimeVaultTraderOffer[] = [];
    const relics: IPrimeVaultTraderOffer[] = [];

    const singlePackSet = new Set<string>();
    const itemsSet = new Set<string>();
    const bobbleHeadsSet = new Set<string>();

    if (config.worldState?.vanguardVaultRelics && buildVersion >= gameToBuildVersionInt["41.0.0"]) {
        vanguardRelics.push(...varzia.vanguardVaultRelics);
    }

    Object.entries(getVarziaDualPacks())
        .filter(([_, dualPack]) => buildVersion >= dualPack.minBuildVersionInt)
        .forEach(([dualPackItemType, dualPack]) => {
            dualPacks.push({ ItemType: dualPackItemType, PrimePrice: 10 });

            dualPack.SinglePacks.forEach(singlePackKey => {
                if (!singlePackSet.has(singlePackKey)) {
                    singlePackSet.add(singlePackKey);
                    singlePacks.push({ ItemType: singlePackKey, PrimePrice: 6 });
                }

                const sp = getVarziaSinglePack(singlePackKey);

                sp.Items.forEach(item => {
                    if (!itemsSet.has(item.ItemType)) {
                        itemsSet.add(item.ItemType);
                        items.push(item);
                    }
                });

                sp.BobbleHeads.forEach(bobbleHead => {
                    if (!bobbleHeadsSet.has(bobbleHead)) {
                        bobbleHeadsSet.add(bobbleHead);
                        bobbleHeads.push({ ItemType: bobbleHead, PrimePrice: 1 });
                    }
                });
            });

            relics.push(...dualPack.Relics.map(relic => ({ ItemType: relic, RegularPrice: 1 })));
        });

    return [...dualPacks, ...vanguardRelics, ...singlePacks, ...items, ...bobbleHeads, ...relics];
};
