type TReward = {
    type: string;
    itemCount: number;
    probability?: number;
};

export type TRewardCorrection = {
    manifest: string;
    rotation: number;
    reward: TReward;
    evidence: string;
};

// Exact corrections for source rows present in DE's official drop table but absent from the
// pinned public-export-plus package. Keep these narrow and idempotent so a later package update
// automatically takes ownership when it contains the same reward.
const publicExportRewardCorrections: TRewardCorrection[] = [
    {
        manifest: "/Lotus/Types/Game/MissionDecks/1999ConquestRewards/1999ConquestGoldRewards",
        rotation: 0,
        reward: {
            type: "/Lotus/StoreItems/Types/Items/MiscItems/ValenceAdapter",
            itemCount: 1,
            probability: 0.0284
        },
        evidence: "DE official drop table: Temporal Archimedea Gold Rewards, Elemental Vice, Rare (2.84%)."
    }
];

export const applyPublicExportRewardCorrections = (
    rewards: Record<string, readonly (readonly TReward[])[] | undefined>
): { applied: TRewardCorrection[]; alreadyPresent: TRewardCorrection[] } => {
    const applied: TRewardCorrection[] = [];
    const alreadyPresent: TRewardCorrection[] = [];
    for (const correction of publicExportRewardCorrections) {
        const rotations = rewards[correction.manifest];
        const rotation = rotations?.[correction.rotation];
        if (!rotation) {
            throw new Error(
                `cannot apply reward correction: missing ${correction.manifest} rotation ${correction.rotation}`
            );
        }
        const present = rotation.some(
            reward =>
                reward.type == correction.reward.type &&
                reward.itemCount == correction.reward.itemCount &&
                reward.probability == correction.reward.probability
        );
        if (present) {
            alreadyPresent.push(correction);
        } else {
            rewards[correction.manifest] = rotations.map((current, index) =>
                index == correction.rotation ? [...current, { ...correction.reward }] : current
            );
            applied.push(correction);
        }
    }
    return { applied, alreadyPresent };
};

export const retiredCurrentSyndicateFavours = [
    {
        syndicate: "ZarimanSyndicate",
        storeItem: "/Lotus/StoreItems/Types/Items/ShipDecos/ZarimanApartment/ZARxMomPortrait",
        evidence:
            "Current Packages.bin has the display localization and scene decoration, but no inventory type or StoreItem wrapper."
    }
] as const;

export const applyCurrentSyndicateCorrections = (
    syndicates: Record<string, { readonly favours?: readonly { storeItem: string }[] } | undefined>
): {
    removed: (typeof retiredCurrentSyndicateFavours)[number][];
    alreadyAbsent: (typeof retiredCurrentSyndicateFavours)[number][];
} => {
    const removed: (typeof retiredCurrentSyndicateFavours)[number][] = [];
    const alreadyAbsent: (typeof retiredCurrentSyndicateFavours)[number][] = [];
    for (const correction of retiredCurrentSyndicateFavours) {
        const syndicate = syndicates[correction.syndicate];
        if (!syndicate?.favours) {
            alreadyAbsent.push(correction);
            continue;
        }
        const before = syndicate.favours.length;
        const favours = syndicate.favours.filter(favour => favour.storeItem != correction.storeItem);
        syndicates[correction.syndicate] = { ...syndicate, favours };
        if (favours.length == before) alreadyAbsent.push(correction);
        else removed.push(correction);
    }
    return { removed, alreadyAbsent };
};
