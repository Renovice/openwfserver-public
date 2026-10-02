import type { ISyndicate } from "warframe-public-export-plus";
import { config } from "../services/configService.ts";

export const getMaxStanding = (syndicate: ISyndicate, title: number): number => {
    const configuredCapacity = config.serversideQualityOfLife?.syndicateStandingCapacity;
    const capacity =
        configuredCapacity !== undefined && Number.isSafeInteger(configuredCapacity) && configuredCapacity > 0
            ? configuredCapacity
            : undefined;
    if (!syndicate.titles) {
        // LibrarySyndicate
        return capacity !== undefined && syndicate.uniqueName == "/Lotus/Syndicates/LibrarySyndicate"
            ? capacity
            : 125000;
    }
    if (title == 0) {
        return syndicate.titles.find(x => x.level == 1)!.minStanding;
    }
    const currentTitle = syndicate.titles.find(x => x.level == title)!;
    // The rank bounds are cumulative. Expand only the last standing-wallet rank;
    // Nightwave and the one-point Kahl/Nokko progression tracks keep their own contract.
    const finalLevel = Math.max(...syndicate.titles.map(x => x.level));
    if (
        capacity !== undefined &&
        title == finalLevel &&
        !syndicate.dailyChallenges &&
        currentTitle.maxStanding - currentTitle.minStanding > 1
    ) {
        return currentTitle.minStanding + capacity;
    }
    return currentTitle.maxStanding;
};

export const getMinStanding = (syndicate: ISyndicate, title: number): number => {
    if (!syndicate.titles) {
        // LibrarySyndicate
        return 0;
    }
    if (title == 0) {
        return syndicate.titles.find(x => x.level == -1)!.maxStanding;
    }
    return syndicate.titles.find(x => x.level == title)!.minStanding;
};
