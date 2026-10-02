import { selfTestTransmutation } from "../controllers/api/artifactTransmutationController.ts";
import { selfTestGuildTech } from "../controllers/api/guildTechController.ts";
import { selfTestRandomProjection } from "./itemDataService.ts";
import { selfTestServersideVendors } from "./serversideVendorsService.ts";
import { selfTestUpgradeOverrides } from "./upgradeOverrideService.ts";
import { selfTestGeneratedMetadata } from "./generatedMetadataService.ts";
import { selfTestCurrentNightwave, selfTestEndlessXpChoices } from "./worldStateService.ts";

export const runSelfTests = (): boolean => {
    let allGood = true;
    allGood &&= selfTestServersideVendors();
    allGood &&= selfTestGuildTech();
    allGood &&= selfTestTransmutation();
    allGood &&= selfTestRandomProjection();
    allGood &&= selfTestUpgradeOverrides();
    allGood &&= selfTestGeneratedMetadata();
    allGood &&= selfTestEndlessXpChoices();
    allGood &&= selfTestCurrentNightwave();
    return allGood;
};
