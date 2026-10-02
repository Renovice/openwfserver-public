import fs from "fs";
import path from "path";
import * as publicExportPlus from "warframe-public-export-plus";
import { ExportUpgrades } from "warframe-public-export-plus";
import { repoDir } from "../helpers/pathHelper.ts";
import { logger } from "../utils/logger.ts";

type TUpgradeRarity = "COMMON" | "UNCOMMON" | "RARE" | "LEGENDARY";
type TUpgradeField = "rarity" | "fusionLimit";
type TPathSegment = string | number;

interface IUpgradeOverride {
    rarity?: TUpgradeRarity;
    fusionLimit?: number;
}

interface IUpgradeOverrideDocument {
    schemaVersion: 1;
    upgrades: Record<string, IUpgradeOverride>;
}

export interface IGenericServerOverride {
    dataset: string;
    path: TPathSegment[];
    values: Record<string, unknown>;
}

interface IServerDefinitionDocument {
    schemaVersion: 1;
    overrides: IGenericServerOverride[];
}

interface IMetadataPatchManifest {
    schemaVersion: 1;
    id: string;
    name: string;
    version: string;
    components: {
        clientMetadata: boolean;
        serverDefinitions: true;
        inventoryMigration: false;
    };
}

export interface IServerMetadataPatch {
    directory: string;
    manifest: IMetadataPatchManifest;
    upgradeDefinitions?: IUpgradeOverrideDocument;
    serverDefinitions?: IServerDefinitionDocument;
}

const publicExportDatasets = publicExportPlus as unknown as Record<string, unknown>;
const validRarities = new Set<TUpgradeRarity>(["COMMON", "UNCOMMON", "RARE", "LEGENDARY"]);
const manifestKeys = new Set(["schemaVersion", "id", "name", "version", "components"]);
const componentKeys = new Set(["clientMetadata", "serverDefinitions", "inventoryMigration"]);
const forbiddenObjectKeys = new Set(["__proto__", "prototype", "constructor"]);
const patchIdPattern = /^[a-z0-9][a-z0-9._-]{2,127}$/;
const datasetPattern = /^Export[A-Za-z0-9]+$/;

export const metadataPatchRoot = path.join(repoDir, "Metadata Patches");
export const enabledMetadataPatchPath = path.join(metadataPatchRoot, "Enabled");
export const disabledMetadataPatchPath = path.join(metadataPatchRoot, "Disabled");

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value == "object" && value != null && !Array.isArray(value);

const assertOnlyKeys = (value: Record<string, unknown>, allowed: Set<string>, context: string): void => {
    const unknown = Object.keys(value).filter(key => !allowed.has(key));
    if (unknown.length != 0) {
        throw new Error(`${context} contains unsupported field(s): ${unknown.join(", ")}`);
    }
};

const validateJsonValue = (value: unknown, context: string): void => {
    if (value === null || typeof value == "string" || typeof value == "boolean") return;
    if (typeof value == "number") {
        if (!Number.isFinite(value)) throw new Error(`${context} contains a non-finite number`);
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => validateJsonValue(item, `${context}[${index}]`));
        return;
    }
    if (!isRecord(value)) throw new Error(`${context} contains a non-JSON value`);
    for (const [key, item] of Object.entries(value)) {
        if (forbiddenObjectKeys.has(key)) throw new Error(`${context} contains forbidden key ${key}`);
        validateJsonValue(item, `${context}.${key}`);
    }
};

const jsonKind = (value: unknown): string => (value === null ? "null" : Array.isArray(value) ? "array" : typeof value);

export const validateUpgradeOverrideDocument = (raw: unknown): IUpgradeOverrideDocument => {
    if (!isRecord(raw) || raw.schemaVersion !== 1 || !isRecord(raw.upgrades)) {
        throw new Error("upgrade-definitions.json must contain schemaVersion=1 and an upgrades object");
    }
    assertOnlyKeys(raw, new Set(["schemaVersion", "upgrades"]), "upgrade-definitions.json");

    const upgrades: Record<string, IUpgradeOverride> = {};
    for (const [uniqueName, value] of Object.entries(raw.upgrades)) {
        if (!uniqueName.startsWith("/Lotus/") || !(uniqueName in ExportUpgrades)) {
            throw new Error(`upgrade definition targets an unknown upgrade: ${uniqueName}`);
        }
        if (!isRecord(value)) throw new Error(`upgrade definition for ${uniqueName} must be an object`);
        const keys = Object.keys(value);
        if (keys.length == 0 || keys.some(key => key != "rarity" && key != "fusionLimit")) {
            throw new Error(`upgrade definition for ${uniqueName} contains no supported fields or an unknown field`);
        }

        const override: IUpgradeOverride = {};
        if (value.rarity !== undefined) {
            if (typeof value.rarity != "string" || !validRarities.has(value.rarity as TUpgradeRarity)) {
                throw new Error(`upgrade definition for ${uniqueName} has invalid rarity`);
            }
            override.rarity = value.rarity as TUpgradeRarity;
        }
        if (value.fusionLimit !== undefined) {
            if (
                !Number.isInteger(value.fusionLimit) ||
                (value.fusionLimit as number) < 0 ||
                (value.fusionLimit as number) > 10
            ) {
                throw new Error(`upgrade definition for ${uniqueName} has fusionLimit outside 0..10`);
            }
            override.fusionLimit = value.fusionLimit as number;
        }
        upgrades[uniqueName] = override;
    }
    return { schemaVersion: 1, upgrades };
};

const resolveDatasetTarget = (
    definition: Pick<IGenericServerOverride, "dataset" | "path">
): Record<string, unknown> => {
    if (!datasetPattern.test(definition.dataset) || !(definition.dataset in publicExportDatasets)) {
        throw new Error(`server definition targets an unknown Public Export dataset: ${definition.dataset}`);
    }
    let current = publicExportDatasets[definition.dataset];
    for (const [index, segment] of definition.path.entries()) {
        if (typeof segment == "number") {
            if (!Number.isInteger(segment) || segment < 0 || !Array.isArray(current) || segment >= current.length) {
                throw new Error(`${definition.dataset} path segment ${index} is not a valid array index: ${segment}`);
            }
            current = current[segment];
        } else {
            if (forbiddenObjectKeys.has(segment) || !isRecord(current) || !Object.hasOwn(current, segment)) {
                throw new Error(`${definition.dataset} path segment ${index} does not exist: ${segment}`);
            }
            current = current[segment];
        }
    }
    if (!isRecord(current)) {
        throw new Error(`${definition.dataset} target ${JSON.stringify(definition.path)} is not an object entry`);
    }
    return current;
};

export const validateServerDefinitionDocument = (raw: unknown): IServerDefinitionDocument => {
    if (!isRecord(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.overrides)) {
        throw new Error("server-definitions.json must contain schemaVersion=1 and an overrides array");
    }
    assertOnlyKeys(raw, new Set(["schemaVersion", "overrides"]), "server-definitions.json");
    if (raw.overrides.length == 0) throw new Error("server-definitions.json overrides must not be empty");

    const overrides: IGenericServerOverride[] = [];
    for (const [index, rawOverride] of raw.overrides.entries()) {
        if (!isRecord(rawOverride)) throw new Error(`server override ${index} must be an object`);
        assertOnlyKeys(rawOverride, new Set(["dataset", "path", "values"]), `server override ${index}`);
        if (
            typeof rawOverride.dataset != "string" ||
            !Array.isArray(rawOverride.path) ||
            rawOverride.path.length == 0
        ) {
            throw new Error(`server override ${index} requires a dataset string and non-empty path array`);
        }
        if (
            rawOverride.path.some(
                segment =>
                    (typeof segment != "string" && typeof segment != "number") ||
                    (typeof segment == "string" && (segment.length == 0 || forbiddenObjectKeys.has(segment))) ||
                    (typeof segment == "number" && (!Number.isInteger(segment) || segment < 0))
            )
        ) {
            throw new Error(`server override ${index} contains an invalid path segment`);
        }
        if (!isRecord(rawOverride.values) || Object.keys(rawOverride.values).length == 0) {
            throw new Error(`server override ${index} values must be a non-empty object`);
        }
        const definition: IGenericServerOverride = {
            dataset: rawOverride.dataset,
            path: rawOverride.path as TPathSegment[],
            values: rawOverride.values
        };
        const target = resolveDatasetTarget(definition);
        for (const [field, value] of Object.entries(definition.values)) {
            if (forbiddenObjectKeys.has(field))
                throw new Error(`server override ${index} contains forbidden field ${field}`);
            validateJsonValue(value, `server override ${index}.${field}`);
            if (Object.hasOwn(target, field) && target[field] !== null && value !== null) {
                const before = jsonKind(target[field]);
                const after = jsonKind(value);
                if (before != after) {
                    throw new Error(`server override ${index}.${field} changes JSON type from ${before} to ${after}`);
                }
            }
        }
        overrides.push(definition);
    }
    return { schemaVersion: 1, overrides };
};

export const validateMetadataPatchManifest = (raw: unknown): IMetadataPatchManifest => {
    if (!isRecord(raw)) throw new Error("patch.json must contain an object");
    assertOnlyKeys(raw, manifestKeys, "patch.json");
    if (raw.schemaVersion !== 1) throw new Error("patch.json must use schemaVersion=1");
    if (typeof raw.id != "string" || !patchIdPattern.test(raw.id)) {
        throw new Error("patch.json id must be 3-128 lowercase letters, numbers, dots, underscores, or hyphens");
    }
    if (typeof raw.name != "string" || raw.name.trim().length == 0 || raw.name.length > 160) {
        throw new Error("patch.json name must be a non-empty string no longer than 160 characters");
    }
    if (typeof raw.version != "string" || raw.version.trim().length == 0 || raw.version.length > 64) {
        throw new Error("patch.json version must be a non-empty string no longer than 64 characters");
    }
    if (!isRecord(raw.components)) throw new Error("patch.json components must be an object");
    assertOnlyKeys(raw.components, componentKeys, "patch.json components");
    if (
        typeof raw.components.clientMetadata != "boolean" ||
        raw.components.serverDefinitions !== true ||
        raw.components.inventoryMigration !== false
    ) {
        throw new Error(
            "server packages require boolean clientMetadata, serverDefinitions=true, and inventoryMigration=false"
        );
    }
    return {
        schemaVersion: 1,
        id: raw.id,
        name: raw.name,
        version: raw.version,
        components: {
            clientMetadata: raw.components.clientMetadata,
            serverDefinitions: true,
            inventoryMigration: false
        }
    };
};

const parseJsonFile = (file: string): unknown => {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
        throw new Error(`failed to parse ${file}: ${(error as Error).message}`);
    }
};

export const loadUpgradeMetadataPatchPlan = (enabledRoot = enabledMetadataPatchPath): IServerMetadataPatch[] => {
    if (!fs.existsSync(enabledRoot)) return [];
    const packageDirectories = fs
        .readdirSync(enabledRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
        .map(entry => entry.name)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    const patches: IServerMetadataPatch[] = [];
    for (const directory of packageDirectories) {
        const packageRoot = path.join(enabledRoot, directory);
        const manifest = validateMetadataPatchManifest(parseJsonFile(path.join(packageRoot, "patch.json")));
        const upgradeFile = path.join(packageRoot, "upgrade-definitions.json");
        const serverFile = path.join(packageRoot, "server-definitions.json");
        if (!fs.existsSync(upgradeFile) && !fs.existsSync(serverFile)) {
            throw new Error(`${packageRoot} contains no upgrade-definitions.json or server-definitions.json`);
        }
        patches.push({
            directory,
            manifest,
            upgradeDefinitions: fs.existsSync(upgradeFile)
                ? validateUpgradeOverrideDocument(parseJsonFile(upgradeFile))
                : undefined,
            serverDefinitions: fs.existsSync(serverFile)
                ? validateServerDefinitionDocument(parseJsonFile(serverFile))
                : undefined
        });
    }
    return validateUpgradeMetadataPatchPlan(patches);
};

const ownershipKey = (dataset: string, entryPath: TPathSegment[], field: string): string =>
    `${dataset}\u0000${JSON.stringify(entryPath)}\u0000${field}`;

export const validateUpgradeMetadataPatchPlan = (patches: IServerMetadataPatch[]): IServerMetadataPatch[] => {
    const manifestIds = new Map<string, string>();
    const owners = new Map<string, string>();
    const claim = (key: string, owner: string, description: string): void => {
        const priorOwner = owners.get(key);
        if (priorOwner !== undefined) {
            throw new Error(`PATCH CONFLICT: ${owner} and ${priorOwner} both define ${description}`);
        }
        owners.set(key, owner);
    };

    for (const patch of patches) {
        const priorDirectory = manifestIds.get(patch.manifest.id);
        if (priorDirectory !== undefined) {
            throw new Error(
                `duplicate enabled patch id ${patch.manifest.id}: ${priorDirectory} and ${patch.directory}`
            );
        }
        manifestIds.set(patch.manifest.id, patch.directory);
        for (const [uniqueName, override] of Object.entries(patch.upgradeDefinitions?.upgrades ?? {})) {
            for (const field of Object.keys(override) as TUpgradeField[]) {
                claim(
                    ownershipKey("ExportUpgrades", [uniqueName], field),
                    patch.manifest.id,
                    `ExportUpgrades.${uniqueName}.${field}`
                );
            }
        }
        for (const definition of patch.serverDefinitions?.overrides ?? []) {
            for (const field of Object.keys(definition.values)) {
                claim(
                    ownershipKey(definition.dataset, definition.path, field),
                    patch.manifest.id,
                    `${definition.dataset}.${JSON.stringify(definition.path)}.${field}`
                );
            }
        }
    }
    return patches;
};

export const applyServerMetadataPatchPlan = (patches: IServerMetadataPatch[], logPatches = false): number => {
    validateUpgradeMetadataPatchPlan(patches);
    let fieldCount = 0;
    for (const patch of patches) {
        for (const [uniqueName, override] of Object.entries(patch.upgradeDefinitions?.upgrades ?? {})) {
            Object.assign(ExportUpgrades[uniqueName], override);
            fieldCount += Object.keys(override).length;
        }
        for (const definition of patch.serverDefinitions?.overrides ?? []) {
            Object.assign(resolveDatasetTarget(definition), definition.values);
            fieldCount += Object.keys(definition.values).length;
        }
        if (logPatches) logger.info(`PATCH LOAD PASS: ${patch.manifest.id}`);
    }
    return fieldCount;
};

export const applyUpgradeOverrides = (): number => {
    fs.mkdirSync(enabledMetadataPatchPath, { recursive: true });
    fs.mkdirSync(disabledMetadataPatchPath, { recursive: true });
    const patches = loadUpgradeMetadataPatchPlan();
    const fieldCount = applyServerMetadataPatchPlan(patches, true);
    if (patches.length == 0) {
        logger.info(`No enabled metadata patches in ${enabledMetadataPatchPath}`);
    } else {
        logger.info(`Applied ${fieldCount} server metadata field(s) from ${patches.length} enabled package(s)`);
    }
    return fieldCount;
};

export const selfTestUpgradeOverrides = (): boolean => {
    const stretch = "/Lotus/Upgrades/Mods/Warframe/AvatarAbilityRangeMod";
    const octavia = "/Lotus/Powersuits/Bard/OctaviaPrime";
    try {
        const manifest = validateMetadataPatchManifest({
            schemaVersion: 1,
            id: "renovice.legendary-rank10-stretch",
            name: "Legendary Rank-10 Stretch",
            version: "1.0.0",
            components: { clientMetadata: true, serverDefinitions: true, inventoryMigration: false }
        });
        const upgrades = validateUpgradeOverrideDocument({
            schemaVersion: 1,
            upgrades: { [stretch]: { rarity: "LEGENDARY", fusionLimit: 10 } }
        });
        const generic = validateServerDefinitionDocument({
            schemaVersion: 1,
            overrides: [{ dataset: "ExportWarframes", path: [octavia], values: { health: 999, codexSecret: true } }]
        });
        if (
            manifest.id != "renovice.legendary-rank10-stretch" ||
            upgrades.upgrades[stretch].fusionLimit != 10 ||
            generic.overrides[0].values.health != 999
        ) {
            return false;
        }
        for (const invalid of [
            { schemaVersion: 1, upgrades: { [stretch]: { rarity: "MYTHIC" } } },
            { schemaVersion: 1, upgrades: { [stretch]: { fusionLimit: 11 } } },
            { schemaVersion: 1, upgrades: { "/Lotus/DoesNotExist": { fusionLimit: 5 } } },
            { schemaVersion: 1, upgrades: { [stretch]: { unknown: 1 } } }
        ]) {
            try {
                validateUpgradeOverrideDocument(invalid);
                return false;
            } catch {
                // Expected rejection.
            }
        }
        for (const invalid of [
            { schemaVersion: 1, overrides: [{ dataset: "ExportFake", path: [octavia], values: { health: 1 } }] },
            {
                schemaVersion: 1,
                overrides: [{ dataset: "ExportWarframes", path: ["/missing"], values: { health: 1 } }]
            },
            {
                schemaVersion: 1,
                overrides: [{ dataset: "ExportWarframes", path: [octavia], values: { health: "wrong" } }]
            },
            { schemaVersion: 1, overrides: [{ dataset: "ExportWarframes", path: [octavia], values: {} }] }
        ]) {
            try {
                validateServerDefinitionDocument(invalid);
                return false;
            } catch {
                // Expected rejection.
            }
        }
        const basePatch: IServerMetadataPatch = {
            directory: "A",
            manifest,
            upgradeDefinitions: upgrades
        };

        const genericPatch: IServerMetadataPatch = {
            directory: "Generic",
            manifest: { ...manifest, id: "renovice.generic-octavia", name: "Generic Octavia" },
            serverDefinitions: generic
        };
        const octaviaTarget = resolveDatasetTarget(generic.overrides[0]);
        const originalValues = new Map(
            Object.keys(generic.overrides[0].values).map(field => [
                field,
                { exists: Object.hasOwn(octaviaTarget, field), value: octaviaTarget[field] }
            ])
        );
        try {
            if (
                applyServerMetadataPatchPlan([genericPatch]) != 2 ||
                octaviaTarget.health != 999 ||
                octaviaTarget.codexSecret !== true
            ) {
                return false;
            }
        } finally {
            for (const [field, original] of originalValues) {
                if (original.exists) octaviaTarget[field] = original.value;
                else delete octaviaTarget[field];
            }
        }
        try {
            validateUpgradeMetadataPatchPlan([
                basePatch,
                {
                    directory: "B",
                    manifest: { ...manifest, id: "renovice.second-patch", name: "Second Patch" },
                    serverDefinitions: validateServerDefinitionDocument({
                        schemaVersion: 1,
                        overrides: [{ dataset: "ExportUpgrades", path: [stretch], values: { fusionLimit: 9 } }]
                    })
                }
            ]);
            return false;
        } catch (error) {
            if (!(error instanceof Error) || !error.message.startsWith("PATCH CONFLICT:")) return false;
        }
        try {
            validateUpgradeMetadataPatchPlan([basePatch, { ...basePatch, directory: "B" }]);
            return false;
        } catch (error) {
            if (!(error instanceof Error) || !error.message.startsWith("duplicate enabled patch id")) return false;
        }
        return true;
    } catch {
        return false;
    }
};
