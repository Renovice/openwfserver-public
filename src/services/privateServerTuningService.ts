import { config } from "./configService.ts";
import { fromStoreItem } from "./itemDataService.ts";
import type { TAccountDocument } from "./loginService.ts";
import { ExportBundles, ExportCreditBundles } from "warframe-public-export-plus";

export type TPrivateServerTuning = NonNullable<typeof config.privateServerTuning>;

export type TMissionRewardDeliveryPath =
    | "missionType"
    | "spyVault"
    | "enemyCache"
    | "railjackMission"
    | "railjackMandatoryObjective"
    | "railjackOptionalObjective"
    | "railjackEndOfMissionBonusResourceBundle"
    | "railjackVoidStorm"
    | "bounty"
    | "alert"
    | "sortie"
    | "archonHunt"
    | "event"
    | "quest"
    | "duviri"
    | "periodic"
    | "netracell"
    | "circuit";

export interface IMissionRewardMultiplierSource {
    path: TMissionRewardDeliveryPath;
    missionType?: string;
}

export const selectPrivateServerMissionRewardSubcomponentSource = (
    defaultSource: IMissionRewardMultiplierSource,
    subcomponentPath: TMissionRewardDeliveryPath
): IMissionRewardMultiplierSource => (defaultSource.path == "missionType" ? { path: subcomponentPath } : defaultSource);

export interface IPrivateServerMissionRewardContext {
    alertId?: string;
    challengeMissionId?: string;
    goalId?: string;
    goalTag?: string;
    invasionId?: string;
    jobId?: string;
    levelKeyName?: string;
    missionType?: string;
    nightmareMode?: boolean;
    node?: string;
    periodicMissionTag?: string;
    PurgatoryRewardQualifications?: string;
    sortieId?: string;
    T?: number;
    useVaultManifest?: boolean;
}

const entropicKuvaItemType = "/Lotus/Types/Gameplay/Zariman/Resources/EntropicKuvaItem";
const kuvaItemType = "/Lotus/Types/Items/MiscItems/Kuva";

export const NETRACELL_REWARD_DROP_TABLE =
    "/Lotus/Types/DropTables/ContainerDropTables/VoidVaultMissionRewardsDropTable";

export const positivePrivateServerMultiplier = (value: number | undefined): number => {
    const multiplier = Math.trunc(value ?? 1);
    return multiplier > 1 ? multiplier : 1;
};

export const classifyPrivateServerMissionRewardDeliveryPath = (
    context: IPrivateServerMissionRewardContext
): TMissionRewardDeliveryPath => {
    // These exact nodes have their own server reward/progress systems and take priority over generic fields.
    if (context.node == "SolNode720") return "netracell";
    if (context.node == "SolNode238") return "circuit";

    if (context.jobId || context.challengeMissionId) return "bounty";
    if (context.alertId) return "alert";
    if (context.sortieId) return context.sortieId.split("_")[1] == "Lite" ? "archonHunt" : "sortie";
    if (context.T !== undefined) return "duviri";
    if (context.goalId || context.goalTag) return "event";
    if (context.levelKeyName) return "quest";
    if (
        context.periodicMissionTag ||
        context.invasionId ||
        context.nightmareMode ||
        context.useVaultManifest ||
        context.PurgatoryRewardQualifications
    ) {
        return "periodic";
    }
    return "missionType";
};

export const getPrivateServerMissionRewardMultiplier = (
    tuning: TPrivateServerTuning | undefined,
    deliveryPath: TMissionRewardDeliveryPath,
    missionType?: string
): number => {
    switch (deliveryPath) {
        case "missionType":
            return positivePrivateServerMultiplier(
                missionType ? tuning?.missionTypeRewardMultipliers?.[missionType] : undefined
            );
        case "spyVault":
            return positivePrivateServerMultiplier(tuning?.spyVaultRewardMultiplier);
        case "enemyCache":
            return positivePrivateServerMultiplier(tuning?.enemyCacheRewardMultiplier);
        case "railjackMission":
            return positivePrivateServerMultiplier(tuning?.railjackMissionRewardMultiplier);
        case "railjackMandatoryObjective":
            return positivePrivateServerMultiplier(tuning?.railjackMandatoryObjectiveRewardMultiplier);
        case "railjackOptionalObjective":
            return positivePrivateServerMultiplier(tuning?.railjackOptionalObjectiveRewardMultiplier);
        case "railjackEndOfMissionBonusResourceBundle":
            return positivePrivateServerMultiplier(tuning?.railjackEndOfMissionBonusResourceBundleMultiplier);
        case "railjackVoidStorm":
            return positivePrivateServerMultiplier(tuning?.railjackVoidStormRewardMultiplier);
        case "bounty":
            return positivePrivateServerMultiplier(tuning?.bountyRewardMultiplier);
        case "alert":
            return positivePrivateServerMultiplier(tuning?.alertRewardMultiplier);
        case "sortie":
            return positivePrivateServerMultiplier(tuning?.sortieRewardMultiplier);
        case "archonHunt":
            return positivePrivateServerMultiplier(tuning?.archonHuntRewardMultiplier);
        case "event":
            return positivePrivateServerMultiplier(tuning?.eventMissionRewardMultiplier);
        case "quest":
            return positivePrivateServerMultiplier(tuning?.questMissionRewardMultiplier);
        case "duviri":
            return positivePrivateServerMultiplier(tuning?.duviriMissionRewardMultiplier);
        case "periodic":
            return positivePrivateServerMultiplier(tuning?.periodicMissionRewardMultiplier);
        case "netracell":
            return positivePrivateServerMultiplier(tuning?.netracellRewardMultiplier);
        case "circuit":
            return positivePrivateServerMultiplier(tuning?.circuitRewardMultiplier);
    }
};

export const getPrivateServerMissionRewardSourceMultiplier = (
    tuning: TPrivateServerTuning | undefined,
    source: IMissionRewardMultiplierSource
): number => getPrivateServerMissionRewardMultiplier(tuning, source.path, source.missionType);

export const scalePrivateServerPositiveAmount = (value: number, multiplier: number): number => {
    return value > 0 ? Math.round(value * positivePrivateServerMultiplier(multiplier)) : value;
};

const toRawItemType = (itemType: string): string => {
    try {
        return fromStoreItem(itemType);
    } catch {
        return itemType;
    }
};

const bundleHasComponent = (itemType: string, componentType: string): boolean => {
    if (!Object.hasOwn(ExportBundles, itemType)) return false;
    return ExportBundles[itemType].components.some(component => toRawItemType(component.typeName) == componentType);
};

const isKuvaReward = (itemType: string): boolean => {
    const rawItemType = toRawItemType(itemType);
    return rawItemType == kuvaItemType || bundleHasComponent(itemType, kuvaItemType);
};

const isCreditBundleReward = (itemType: string): boolean => {
    const rawItemType = toRawItemType(itemType);
    return rawItemType in ExportCreditBundles || itemType in ExportCreditBundles;
};

export const getPrivateServerRewardItemCountMultiplier = (
    itemType: string,
    tuning: TPrivateServerTuning | undefined,
    deliveryPathMultiplier: number | undefined
): number => {
    const fallbackMultiplier = positivePrivateServerMultiplier(deliveryPathMultiplier);
    if (toRawItemType(itemType) === entropicKuvaItemType || bundleHasComponent(itemType, entropicKuvaItemType)) {
        return positivePrivateServerMultiplier(tuning?.entropicKuvaRewardMultiplier ?? fallbackMultiplier);
    }
    if (isKuvaReward(itemType)) {
        return positivePrivateServerMultiplier(tuning?.kuvaRewardMultiplier ?? fallbackMultiplier);
    }
    if (isCreditBundleReward(itemType)) {
        // Credits are owned by the native GAMEPLAY_MONEY_REWARD_AMOUNT world-state boost.
        // Multiplying a credit bundle here would stack a hidden server bonus on top of it.
        return 1;
    }
    return fallbackMultiplier;
};

export const scalePrivateServerRewardItemCount = (
    itemType: string,
    itemCount: number,
    tuning: TPrivateServerTuning | undefined,
    deliveryPathMultiplier: number | undefined
): number => {
    return scalePrivateServerPositiveAmount(
        itemCount,
        getPrivateServerRewardItemCountMultiplier(itemType, tuning, deliveryPathMultiplier)
    );
};

export const scalePrivateServerStrippedRewardItemCount = (
    dropTable: string,
    itemType: string,
    itemCount: number,
    tuning: TPrivateServerTuning | undefined,
    netracellRewardMultiplier: number | undefined
): number => {
    if (dropTable != NETRACELL_REWARD_DROP_TABLE) return itemCount;
    return scalePrivateServerRewardItemCount(itemType, itemCount, tuning, netracellRewardMultiplier);
};

export const scalePrivateServerCountedStoreItemReward = <T extends { StoreItem: string; ItemCount: number }>(
    reward: T,
    tuning: TPrivateServerTuning | undefined,
    deliveryPathMultiplier: number | undefined
): T => ({
    ...reward,
    ItemCount: scalePrivateServerRewardItemCount(reward.StoreItem, reward.ItemCount, tuning, deliveryPathMultiplier)
});

export const getPrivateServerTuning = (
    account: Pick<TAccountDocument, "email" | "DisplayName">
): TPrivateServerTuning | undefined => {
    const tuning = config.privateServerTuning;
    if (!tuning?.enabled) return undefined;

    const targetEmails = tuning.targetEmails?.map(email => email.toLowerCase()) ?? [];
    const targetDisplayNames = tuning.targetDisplayNames?.map(name => name.toLowerCase()) ?? [];
    if (targetEmails.length == 0 && targetDisplayNames.length == 0) {
        return tuning;
    }

    if (targetEmails.includes(account.email.toLowerCase())) return tuning;
    if (targetDisplayNames.includes(account.DisplayName.toLowerCase())) return tuning;

    return undefined;
};
