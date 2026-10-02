import { model, Schema } from "mongoose";
import { EPOCH, unixTimesInMs } from "../constants/timeConstants.ts";

// "Child clocks": each weekly / daily activity gets its own self-contained clock = a rotation index (fed to the
// worldState content generators) + an expiry timestamp (the visible "resets in X" countdown the client shows). A
// clock ticks forward naturally with wall-clock time when left alone, but the moment the player FULLY completes the
// activity its clock is advanced early AND its timer reset to a fresh full period -- so finishing a weekly rolls it
// straight to the next instance with a fresh, visible countdown. Server-global, which is correct on a single-player
// private server (no other accounts to desync).

export type TEventClock = "archonHunt" | "circuit" | "calendar" | "sorties" | "eda" | "eta";

const EVENT_CLOCKS: readonly TEventClock[] = ["archonHunt", "circuit", "calendar", "sorties", "eda", "eta"];

// One "period" of each activity. Everything is weekly except the daily sortie.
const PERIOD_MS: Record<TEventClock, number> = {
    archonHunt: unixTimesInMs.week,
    circuit: unixTimesInMs.week,
    calendar: unixTimesInMs.week,
    eda: unixTimesInMs.week,
    eta: unixTimesInMs.week,
    sorties: unixTimesInMs.day
};

export interface IEventClockState {
    index: number; // rotation index handed to the worldState generators (week number; day number for sorties)
    expiryMs: number; // end of the current period -> the countdown the client renders
}

interface IEventClockDoc {
    _id: string;
    clocks: Partial<Record<TEventClock, IEventClockState>>;
}

const eventClockSchema = new Schema<IEventClockDoc>({
    _id: { type: String, default: "global" },
    clocks: { type: Schema.Types.Mixed, default: {} }
});

const EventClockModel = model<IEventClockDoc>("EventClock", eventClockSchema);

const cache: Partial<Record<TEventClock, IEventClockState>> = {};
let loadPromise: Promise<void> | undefined;

const loadEventClocks = async (): Promise<void> => {
    const doc = await EventClockModel.findById("global");
    if (doc?.clocks) {
        for (const key of EVENT_CLOCKS) {
            const stored = doc.clocks[key];
            if (stored && typeof stored.index === "number" && typeof stored.expiryMs === "number") {
                cache[key] = { index: stored.index, expiryMs: stored.expiryMs };
            }
        }
    }
};

// Kick off a one-time lazy load; safe to call from the sync worldState path (a clock reads as its natural wall-clock
// value until the load resolves a few ms later, which is harmless).
/** @public Also used by RESEARCH/UPSTREAM_SYNC_2026-09-27/scripts/calendar-clock-parity.mjs. */
export const ensureEventClocksLoaded = (): Promise<void> => {
    if (!loadPromise) {
        loadPromise = loadEventClocks().catch(() => {
            loadPromise = undefined; // allow a retry on the next read if the DB wasn't ready yet
        });
    }
    return loadPromise;
};

const persist = async (): Promise<void> => {
    await EventClockModel.findByIdAndUpdate("global", { clocks: cache }, { upsert: true });
};

// What a clock reads at `nowMs` with no hand-advances -- the real wall-clock period. Used to seed a fresh clock.
const naturalState = (event: TEventClock, nowMs: number): IEventClockState => {
    const period = PERIOD_MS[event];
    const index = Math.trunc((nowMs - EPOCH) / period);
    return { index, expiryMs: EPOCH + (index + 1) * period };
};

// Read a clock, seeding it on first use and ticking it forward so it never sits expired when left alone. The tick is
// deterministic from the stored state + nowMs, so it isn't persisted here (it's recomputed identically on reload);
// only a real completion (advanceEventClock) writes to the DB.
export const getEventClock = (event: TEventClock, nowMs: number): IEventClockState => {
    void ensureEventClocksLoaded();
    let state = cache[event];
    if (!state) {
        state = naturalState(event, nowMs);
        cache[event] = state;
    }
    const period = PERIOD_MS[event];
    while (nowMs >= state.expiryMs) {
        state.index += 1;
        state.expiryMs += period;
    }
    return state;
};

// Player fully completed the activity: roll to the next instance and reset the visible timer to a fresh period.
export const advanceEventClock = async (event: TEventClock, nowMs: number): Promise<void> => {
    const state = cache[event] ?? naturalState(event, nowMs);
    state.index += 1;
    state.expiryMs = nowMs + PERIOD_MS[event];
    cache[event] = state;
    await persist();
};
