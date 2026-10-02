import { ExportSentinels } from "warframe-public-export-plus";
import { modularWeaponTypes } from "../../src/helpers/modularWeaponHelper.ts";

export type TNonDirectItemClassification = {
    status: "RequiresAcquisitionContext" | "DefinitionOnly";
    reason: string;
    evidence: string;
};

const definitionOnly = new Set([
    "/Lotus/Types/Game/KeyItems/VoidKeyItem",
    "/Lotus/Types/Game/LotusFightingFistsWeapon",
    "/Lotus/Types/Game/LotusGadget",
    "/Lotus/Types/Game/LotusMeleeWeapon",
    "/Lotus/Types/Game/LotusSpeedballMeleeWeapon",
    "/Lotus/Types/Game/LotusWeapon",
    "/Lotus/Types/Game/LotusWeapon2D",
    "/Lotus/Types/Game/PowerSuits/PlayerPowerSuit",
    "/Lotus/Types/Game/VoidProjectionItem",
    "/Lotus/Types/Items/PhotoBooth/Vania/PhotoboothTileMallHubTennoProtoRelayBase",
    "/Lotus/Types/Restoratives/TitaniaQuest/SpecterSummonBase",
    "/Lotus/Upgrades/Mods/FusionBundles/BaseFusionBundle",
    "/Lotus/Upgrades/Mods/FusionBundles/CrewShipFusionBundles/BaseCrewShipFusionBundle",
    "/Lotus/Weapons/Operator/Antiques/LotusAntique",
    "/Lotus/Weapons/Operator/LotusAntiqueWeapon",
    "/Lotus/Weapons/Tenno/LotusLongGun",
    "/Lotus/Weapons/Tenno/Pistol/AutoPistolVariant",
    "/Lotus/Weapons/Tenno/Pistol/CoHLoanerPistol",
    "/Lotus/Weapons/Tenno/Pistol/HandShotGunVariant",
    "/Lotus/Weapons/Tenno/Pistol/HeavyPistolVariant",
    "/Lotus/Weapons/Tenno/Pistol/LotusPistol",
    "/Lotus/Weapons/Tenno/Pistol/PistolVariant",
    "/Lotus/Weapons/Tenno/Shotgun/QuadShotgunBase"
]);

// Exact client development definitions admitted by the 44.0.2 item registry (2026.09.28.13.06): the
// StoreItem wrappers resolve only to the placeholder /Lotus/Language/GameModes/TestKey localization, and the
// KuvaKeysVendorManifest offers are already reported as DEVELOPMENT_VENDOR_DEFINITION. No released
// inventory contract exists, so they are reported rather than counted as supported acquisitions.
const developmentDefinitions = new Set([
    "/Lotus/Types/Items/KuvaKeys/KuvaKey",
    "/Lotus/Types/Items/KuvaKeys/KuvaKeyOne",
    "/Lotus/Types/Items/KuvaKeys/KuvaKeyTest"
]);

const contextual: Partial<Record<string, { reason: string; evidence: string }>> = {
    "/Lotus/Types/Enemies/Corpus/Vip/Arachnoid/ArachnoidCamperCoolantItem": {
        reason: "MissionRuntimeObject",
        evidence: "The type is owned by an enemy mission namespace and has no Public Export inventory record."
    },
    "/Lotus/Types/Enemies/TennoReplicants/OraxiaEnemy/OraxiaEnemyMeleeWeapon": {
        reason: "EnemyOwnedWeapon",
        evidence: "ExportEnemies references this weapon; it is not player equipment."
    },
    "/Lotus/Types/Game/KubrowPet/ImprintedTraitPrint": {
        reason: "PetTraitRecipeOutput",
        evidence: "The claim-recipe path creates this print from a selected pet and copies that pet's traits."
    },
    "/Lotus/Types/Game/SolarRails/BasicSolarRail": {
        reason: "GuildOwnedConstruction",
        evidence: "ExportDojoRecipes and guildService place this result in guild state rather than account inventory."
    },
    "/Lotus/Types/Items/SupplyDropItems/Hoverboard": {
        reason: "MissionSupplyObject",
        evidence: "This SupplyDrop type represents a spawned mission vehicle rather than persistent account ownership."
    },
    "/Lotus/Types/Items/SupplyDropItems/SquadLinkGroundSupportAmmo": {
        reason: "MissionSupplyObject",
        evidence: "This SupplyDrop type represents mission support state rather than persistent account ownership."
    },
    "/Lotus/Types/Items/SupplyDropItems/SquadLinkSpaceSupportSatelliteHealth": {
        reason: "MissionSupplyObject",
        evidence: "This SupplyDrop type represents mission support state rather than persistent account ownership."
    },
    "/Lotus/Upgrades/Focus/Ward/Objects/DamageBoostItem": {
        reason: "EmbeddedFocusObject",
        evidence: "The path is a Focus ability object and is absent from ExportFocusUpgrades."
    },
    "/Lotus/Weapons/CrewShip/HealthAmmoItem": {
        reason: "CrewShipMissionAmmo",
        evidence: "The client vendor references its StoreItem, while mission inventory owns CrewShipAmmo state."
    },
    "/Lotus/Weapons/CrewShip/Laser/MegaLaser": {
        reason: "BuiltInCrewShipWeapon",
        evidence: "This is the built-in Railjack super-weapon; its separate ammo item is the inventory resource."
    },
    "/Lotus/Weapons/CrewShip/RailjackOrdnanceWeapon": {
        reason: "CrewShipWeaponBase",
        evidence: "ExportRailjackWeapons uses this path as a parent/base, not as acquired salvage."
    },
    "/Lotus/Weapons/CrewShip/RailjackTurretWeapon": {
        reason: "CrewShipWeaponBase",
        evidence: "ExportRailjackWeapons uses this path as a parent/base, not as acquired salvage."
    },
    "/Lotus/Weapons/CrewShip/RailjackWeapon": {
        reason: "CrewShipWeaponBase",
        evidence: "ExportRailjackWeapons uses this path as a parent/base, not as acquired salvage."
    },
    "/Lotus/Weapons/Mitw/MITWOctopedeSweepWeapon": {
        reason: "EnemyOwnedWeapon",
        evidence: "ExportEnemies references this weapon; it is not player equipment."
    },
    "/Lotus/Weapons/Orokin/BallasSword/TNWQuestBallasSwordWeapon": {
        reason: "QuestRuntimeWeapon",
        evidence: "The type is an excluded New War quest variant rather than the persistent Ballas weapon."
    },
    "/Lotus/Weapons/Syndicates/SteelMeridian/Melee/SMSydonSpecialUpgrade": {
        reason: "EmbeddedWeaponUpgrade",
        evidence: "ItemCompatibility binds the hidden upgrade directly to Vaykor Sydon behavior."
    },
    "/Lotus/Weapons/Tenno/Bows/ValentinesConclaveVariantBow": {
        reason: "EventModeWeapon",
        evidence: "The hidden Conclave event variant is mode-owned rather than persistent equipment."
    },
    "/Lotus/Weapons/Tenno/Melee/MeleeTrees/RedVeilMeleeTree": {
        reason: "EmbeddedMeleeTree",
        evidence: "The type is a weapon combo tree, not an account-owned Mod instance."
    },
    "/Lotus/Weapons/Tenno/Speedball/SpeedballWeaponTest": {
        reason: "GameModeWeapon",
        evidence: "The hidden Lunaro test weapon is assigned by the game mode."
    },
    "/Lotus/Weapons/Tenno/ThrowingWeapons/VariantSnowBalls": {
        reason: "EventModeWeapon",
        evidence: "The hidden snowball variant is assigned by its event mode."
    },
    "/Lotus/Weapons/Tenno/ThrowingWeapons/VariantTennoStars": {
        reason: "GameModeWeapon",
        evidence: "The hidden throwing-star variant is assigned by its mode."
    }
};

export const classifyNonDirectItem = (typeName: string): TNonDirectItemClassification | undefined => {
    if (typeName in modularWeaponTypes) {
        return {
            status: "RequiresAcquisitionContext",
            reason: "ModularAssembly",
            evidence:
                "modularWeaponTypes maps the base type to its inventory bin; modularWeaponSaleController creates it with exact ModularParts."
        };
    }
    if (typeName.startsWith("/Lotus/Types/Friendly/Pets/BeastWeapons/")) {
        const owners = Object.entries(ExportSentinels)
            .filter(([, sentinel]) => sentinel.exalted?.includes(typeName))
            .map(([owner]) => owner)
            .sort();
        if (owners.length == 0) return undefined;
        return {
            status: "RequiresAcquisitionContext",
            reason: "CompanionOwnedWeapon",
            evidence: `ExportSentinels assigns this innate weapon to ${owners.join(", ")}; addKubrowPet grants companion exalted items.`
        };
    }
    if (typeName.startsWith("/Lotus/Weapons/Tenno/Gear/MiningLaser")) {
        return {
            status: "RequiresAcquisitionContext",
            reason: "GearRuntimeWeapon",
            evidence:
                "The owned mining tool is a Gear item; this hidden weapon is the runtime implementation it equips."
        };
    }
    const knownContext = contextual[typeName];
    if (knownContext) return { status: "RequiresAcquisitionContext", ...knownContext };
    if (developmentDefinitions.has(typeName)) {
        return {
            status: "DefinitionOnly",
            reason: "ClientDevelopmentDefinition",
            evidence:
                "The StoreItem localizes only to /Lotus/Language/GameModes/TestKey and has no released inventory contract."
        };
    }
    if (definitionOnly.has(typeName)) {
        return {
            status: "DefinitionOnly",
            reason: "BaseOrTemplateType",
            evidence:
                "The record is a hidden base/template with no explicit server inventory record; concrete descendants use separate acquisition records."
        };
    }
    return undefined;
};
