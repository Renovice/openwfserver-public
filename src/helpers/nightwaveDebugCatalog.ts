import { ExportArcanes } from "warframe-public-export-plus";
import {
    generatedBundles,
    generatedCosmetics,
    generatedItems,
    type IGeneratedItem
} from "../services/generatedMetadataService.ts";

type TNightwaveAppearancePool =
    | "warframeAppearance"
    | "weaponAppearance"
    | "operatorCompanionVehicleAppearance"
    | "profileEmotesInterface";

type TCosmeticBundleClass = "Appearance" | "Decoration" | "Mixed";

export interface INightwaveDebugCatalog {
    warframeAppearance: string[];
    weaponAppearance: string[];
    operatorCompanionVehicleAppearance: string[];
    profileEmotesInterface: string[];
    decorations: string[];
    arcanes: string[];
    excludedBuiltInCosmetics: string[];
    excludedInternalHelpers: string[];
    excludedAppearanceBundles: string[];
    excludedMixedBundles: string[];
}

const isBuiltInDefaultCosmetic = (item: IGeneratedItem): boolean => {
    const metadata = item.effectiveMetadata;
    if (!metadata) return false;
    if (
        item.productCategory != "WeaponSkins" ||
        metadata.AlwaysAvailable != "1" ||
        metadata.ShowInMarket != "0" ||
        Object.hasOwn(metadata, "PremiumPrice") ||
        Object.hasOwn(metadata, "RegularPrice")
    ) {
        return false;
    }

    const compatibleSlots = Object.hasOwn(metadata, "CompatibleSlots") ? metadata.CompatibleSlots : "";
    return compatibleSlots.includes("BodySkin") || /Helmet$/.test(item.typeName);
};

// These records unlock an animation style internally. The corresponding AgileAnims/NobleAnims
// products are the player-facing appearance entries and remain in the catalog.
const isInternalAnimationUnlock = (typeName: string): boolean => /\/Unlock[^/]*(?:Agile|Noble)$/.test(typeName);

const isProfileEmoteOrInterface = (typeName: string): boolean =>
    /\/AvatarImages\/|\/Titles\/|\/Emotes\/|\/PoseSets\/|\/Interface\/Graphics\/CustomUI\/|ActionFigureDioramas|NotePacks|QuartersWallpapers|ShipScenes|VideoWallSoundscapes/i.test(
        typeName
    );

const isOperatorCompanionOrVehicleAppearance = (typeName: string): boolean =>
    /Operator|Drifter|TOSS_|Kubrow|Catbrow|Kavat|Sentinel|Companion|MoaPet|ZanukaPet|InfestedPet|Hoverboard|Motorcycle|ErsatzHorse|Kaithe|Railjack|CrewShip|LandingCraft|DefaultShip|InsectShip|Necramech|EntratiMech|Vehicle|Kahl|ControllableGrineer/i.test(
        typeName
    );

const isWeaponAppearance = (typeName: string): boolean =>
    /\/Weapons\/|WeaponCustomization|PlayerMeleeWeapon|Lotus(?:Melee|LongSword|DualSword|Heavy|Polearm|Katana|SinglePistol|Pistol|Rifle|Shotgun|Bow)|\/Skins\/(?:Weapons|SteamWorkshop\/(?:Melee|Primary|Secondary)|MeleeDangles|HolsterCustomizations)/i.test(
        typeName
    );

const isWarframeAppearance = (typeName: string): boolean =>
    /PowerSuits|PowerSuit|LotusSuitCustomization|BodySkin|Neckwear|Sigil|SpecialFxSet|AnimationSet|\/Skins\/(?:Armor|Scarves|Effects|Sigils|[A-Z][A-Za-z0-9]+)\//i.test(
        typeName
    );

const classifyNightwaveAppearance = (item: IGeneratedItem): TNightwaveAppearancePool => {
    const typeName = item.typeName;
    const metadata = item.effectiveMetadata ?? {};
    const evidence = [
        typeName,
        item.categorySourcePath,
        Object.hasOwn(metadata, "Compatible") ? metadata.Compatible : "",
        Object.hasOwn(metadata, "CompatibleSlots") ? metadata.CompatibleSlots : ""
    ].join("|");

    // Test specific path families before the broad FlavourItems fallback. Operator and vehicle
    // appearances, for example, are FlavourItems but belong in their own player-facing switch.
    if (isProfileEmoteOrInterface(evidence)) return "profileEmotesInterface";
    if (isOperatorCompanionOrVehicleAppearance(evidence)) return "operatorCompanionVehicleAppearance";
    if (item.productCategory == "FlavourItems") return "profileEmotesInterface";
    if (isWeaponAppearance(evidence)) return "weaponAppearance";
    if (isWarframeAppearance(evidence)) return "warframeAppearance";

    throw new Error(`generated cosmetic ${typeName} has no verified Nightwave appearance category`);
};

const appearancePools: Record<TNightwaveAppearancePool, string[]> = {
    warframeAppearance: [],
    weaponAppearance: [],
    operatorCompanionVehicleAppearance: [],
    profileEmotesInterface: []
};
const decorations: string[] = [];
const excludedBuiltInCosmetics: string[] = [];
const excludedInternalHelpers: string[] = [];
const excludedAppearanceBundles: string[] = [];
const excludedMixedBundles: string[] = [];

for (const [typeName, cosmetic] of Object.entries(generatedCosmetics)) {
    if (!Object.hasOwn(generatedItems, typeName)) {
        throw new Error(`generated cosmetic ${typeName} has no generated item record`);
    }
    const item = generatedItems[typeName];

    if (cosmetic.productCategory == "ShipDecorations") {
        decorations.push(typeName);
    } else if (isBuiltInDefaultCosmetic(item)) {
        excludedBuiltInCosmetics.push(typeName);
    } else if (isInternalAnimationUnlock(typeName)) {
        excludedInternalHelpers.push(typeName);
    } else {
        appearancePools[classifyNightwaveAppearance(item)].push(typeName);
    }
}

const generatedItemByStoreItem = new Map(Object.values(generatedItems).map(item => [item.storeItem, item] as const));
const bundleClassCache = new Map<string, TCosmeticBundleClass>();
const classifyCosmeticBundle = (typeName: string, parents: Set<string> = new Set()): TCosmeticBundleClass => {
    const cached = bundleClassCache.get(typeName);
    if (cached) return cached;
    if (parents.has(typeName)) throw new Error(`cyclic generated cosmetic bundle ${typeName}`);
    if (!Object.hasOwn(generatedBundles, typeName)) {
        throw new Error(`missing generated cosmetic bundle ${typeName}`);
    }

    const bundle = generatedBundles[typeName];
    if (!bundle.isCosmetic) throw new Error(`cannot classify non-cosmetic generated bundle ${typeName}`);
    const nextParents = new Set(parents).add(typeName);
    const classes = new Set<Exclude<TCosmeticBundleClass, "Mixed">>();
    for (const component of bundle.components) {
        if (component.typeName.startsWith("/Lotus/Types/StoreItems/Packages/")) {
            const nestedClass = classifyCosmeticBundle(component.typeName, nextParents);
            if (nestedClass == "Mixed") {
                classes.add("Appearance");
                classes.add("Decoration");
            } else {
                classes.add(nestedClass);
            }
            continue;
        }

        const item = generatedItemByStoreItem.get(component.typeName);
        if (!item || !Object.hasOwn(generatedCosmetics, item.typeName)) {
            throw new Error(`generated cosmetic bundle ${typeName} has unclassified component ${component.typeName}`);
        }
        classes.add(item.productCategory == "ShipDecorations" ? "Decoration" : "Appearance");
    }

    if (classes.size == 0) throw new Error(`generated cosmetic bundle ${typeName} has no classifiable components`);
    const bundleClass: TCosmeticBundleClass = classes.size == 1 ? [...classes][0] : "Mixed";
    bundleClassCache.set(typeName, bundleClass);
    return bundleClass;
};

for (const [typeName, bundle] of Object.entries(generatedBundles)) {
    if (!bundle.isCosmetic) continue;
    switch (classifyCosmeticBundle(typeName)) {
        case "Appearance":
            // Appearance package products duplicate their individually offered leaves and make the
            // client render hundreds of extra cards.
            excludedAppearanceBundles.push(typeName);
            break;
        case "Decoration":
            decorations.push(typeName);
            break;
        case "Mixed":
            // Each usable leaf is already offered by its matching appearance or decoration switch.
            excludedMixedBundles.push(typeName);
            break;
    }
}

for (const pool of Object.values(appearancePools)) pool.sort();
decorations.sort();
excludedBuiltInCosmetics.sort();
excludedInternalHelpers.sort();
excludedAppearanceBundles.sort();
excludedMixedBundles.sort();

export const nightwaveDebugCatalog: INightwaveDebugCatalog = {
    ...appearancePools,
    decorations,
    arcanes: Object.entries(ExportArcanes)
        .filter(([, arcane]) => !arcane.excludeFromCodex)
        .map(([typeName]) => typeName)
        .sort(),
    excludedBuiltInCosmetics,
    excludedInternalHelpers,
    excludedAppearanceBundles,
    excludedMixedBundles
};
