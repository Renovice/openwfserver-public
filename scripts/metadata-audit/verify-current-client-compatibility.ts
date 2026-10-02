import {
    applyCurrentClientInventoryCompatibility,
    getCurrentPairedRightArmor
} from "../../src/helpers/inventoryCompatibility.ts";

let failures = 0;
const check = (condition: boolean, label: string): void => {
    console.log(`${condition ? "PASS" : "FAIL"}\t${label}`);
    if (!condition) {
        failures += 1;
    }
};

const mergedLeft = "/Lotus/Upgrades/Skins/Armor/WarframeDefaults/SWBansheeBotLArmLeftArmor";
check(
    getCurrentPairedRightArmor(mergedLeft, () => false) == undefined,
    "merged current armour does not manufacture a missing RightArmor item"
);
check(
    getCurrentPairedRightArmor(mergedLeft, item => item.endsWith("RightArmor"))?.endsWith("RightArmor") == true,
    "a real exported RightArmor companion remains grantable"
);
check(
    getCurrentPairedRightArmor("/Lotus/Upgrades/Skins/Decree/BansheeHelmet", () => true) == undefined,
    "non-armour skins do not acquire a companion"
);

const response: Record<string, unknown> = {
    EchoesHexConquestBonusTokensGiven: 1,
    Mailbox: {},
    PetBin: {},
    WebFlags: {},
    LoadOutPresets: { NORMAL: [{}], GEAR: [{}] },
    Suits: [{}]
};
const omitted = applyCurrentClientInventoryCompatibility(response);
check(omitted.length == 5, "all five captured U43.5.4 parser rejections are omitted");
check(
    !("EchoesHexConquestBonusTokensGiven" in response) &&
        !("Mailbox" in response) &&
        !("PetBin" in response) &&
        !("WebFlags" in response),
    "unsupported top-level fields are absent from the wire response"
);
check(
    !("GEAR" in (response.LoadOutPresets as Record<string, unknown>)) &&
        "NORMAL" in (response.LoadOutPresets as Record<string, unknown>) &&
        "Suits" in response,
    "only the unsupported GEAR preset is omitted and valid data remains"
);

console.log(`CURRENT CLIENT COMPATIBILITY RESULT failures=${failures}`);
process.exitCode = failures == 0 ? 0 : 1;
