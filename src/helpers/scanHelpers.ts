import allScans from "../../static/fixed_responses/allScans.json" with { type: "json" };
import { ExportCodex, ExportEnemies } from "warframe-public-export-plus";

const eximusAliasSuffixes = [":EXIMUS", "|EXIMUS", "/EXIMUS", "Eximus"];

const addScanType = (scanTypes: Set<string>, type: unknown): void => {
    if (typeof type == "string" && type.length > 0) {
        scanTypes.add(type);
    }
};

const addEximusAliases = (scanTypes: Set<string>, type: unknown): void => {
    if (typeof type != "string" || type.length == 0) return;

    for (const suffix of eximusAliasSuffixes) {
        scanTypes.add(`${type}${suffix}`);
    }

    if (type.endsWith("Avatar")) {
        const leaderType = `${type}Leader`;
        scanTypes.add(leaderType);
        for (const suffix of eximusAliasSuffixes) {
            scanTypes.add(`${leaderType}${suffix}`);
        }
    }
};

export const getAllEnemyAndObjectScanTypes = (): string[] => {
    const scanTypes = new Set<string>(allScans);

    for (const type of Object.keys(ExportEnemies.avatars)) {
        addScanType(scanTypes, type);
    }

    for (const [agentType, agent] of Object.entries(ExportEnemies.agents)) {
        addScanType(scanTypes, agentType);
        addEximusAliases(scanTypes, agentType);

        for (const [variant, avatarType] of Object.entries(agent.avatarTypes)) {
            addScanType(scanTypes, avatarType);
            if (variant == "EXIMUS") {
                addEximusAliases(scanTypes, agentType);
                addEximusAliases(scanTypes, avatarType);
            } else if (variant == "STANDARD") {
                // Some Simulacrum/Codex Eximus tiles are generated from the base agent/avatar
                // even when the public export has no separate EXIMUS avatar entry.
                addEximusAliases(scanTypes, avatarType);
            }
        }
    }

    for (const type of Object.keys(ExportCodex.objects)) {
        addScanType(scanTypes, type);
    }

    return [...scanTypes].sort();
};
