export const getCurrentPairedRightArmor = (
    leftArmor: string,
    itemExists: (itemType: string) => boolean
): string | undefined => {
    if (!leftArmor.endsWith("LeftArmor")) {
        return undefined;
    }
    const rightArmor = leftArmor.substring(0, leftArmor.length - "LeftArmor".length) + "RightArmor";
    return itemExists(rightArmor) ? rightArmor : undefined;
};

const currentClientUnsupportedInventoryFields = [
    "EchoesHexConquestBonusTokensGiven",
    "Mailbox",
    "PetBin",
    "WebFlags"
] as const;

export const applyCurrentClientInventoryCompatibility = (inventory: Record<string, unknown>): string[] => {
    const omitted: string[] = [];
    for (const field of currentClientUnsupportedInventoryFields) {
        if (field in inventory) {
            delete inventory[field];
            omitted.push(field);
        }
    }

    const presets = inventory.LoadOutPresets;
    if (presets != null && typeof presets == "object" && "GEAR" in presets) {
        delete (presets as Record<string, unknown>).GEAR;
        omitted.push("LoadOutPresets.GEAR");
    }
    return omitted;
};
