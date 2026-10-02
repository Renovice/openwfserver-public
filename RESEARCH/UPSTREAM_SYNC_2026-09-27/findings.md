# OpenWF upstream integration — 2026-09-27

## Scope and revisions

Active server: C:/Users/Bartek/OneDrive/Dokumenter/OpenWF Server 23.09.2026/SpaceNinjaServer.
Upstream: https://onlyg.it/OpenWF/SpaceNinjaServer (configured origin https://openwf.io/SpaceNinjaServer.git).
Upstream main: 15b95ea27a099ec840e4592859be99f958650ab8 (2026-09-26).
Local pre-integration checkpoint: c277f6d5 (includes the preceding Pontis repair); original source before Pontis: 9596ce47a54282ecb173b36ae9419500c2ef4593.
Merge base: 88a36b542a802c7b54ee76116155a1c1e513f7ad. 83 upstream commits integrated in an isolated worktree, then fast-forwarded into the custom branch. This is an upstream main snapshot, not a claim about a separately tagged release. No push performed.

## Evidence and decisions

- SUPPORTED: the previous reward-only pass was not a full upstream update. git rev-list HEAD..origin/main showed 83 absent upstream commits before integration.
- SUPPORTED: upstream changed build-version interfaces from strings to integers and split Baro data into versioned TypeScript constants. Adapted custom market/vendor callers and audit callers to those interfaces.
- SUPPORTED: blindly adopting upstream calendar lookup would bypass our manually advanced event clock. getCurrentCalendarSeason now supplies both advertised world state and claim/progress handlers from the existing calendar clock. A manually advanced in-memory clock was tested against advertised world state; no real database was connected.
- SUPPORTED: all 534 prior Baro offer definitions remain in the new 541 definitions, with no previous price changes. Custom extra stock moved to src/constants/privateBaroExtraStock.ts. Runtime configured Baro emits 751 offers including existing syndicate additions.
- SUPPORTED: custom multiplier ownership audit passes. Pontis base completion rolls remain 12–16 normal / 18–22 Steel Path before the existing configured multiplier. Reported pickups are not multiplied again. Previous repairs for independent Railjack resource rolls, one Long Shadow rotation, and guarded Steel Essence completion remain.
- SUPPORTED: PE+ upgraded to 0.6.10. Its 27 Railjack research recipes and two dojo teleporters exactly match our extracted supplements. It now includes five previously supplementary cosmetic/Umbral vendor items. The audit was updated to require exact new upstream recipe parity; it still checks all source rows and five remaining Kahl-only offers. Historical extraction metadata correctly retains its 0.6.8 provenance; it was not relabeled as a new extraction.

## Reward fixes brought forward from upstream

- Sister Hounds receive their default weapons and precepts.
- Kahl weekly completion/reset handling and ProcessedWeeklyMissionChallengeInfos.
- Railjack Steel Path region rewards; preserve our independently guarded essence/multiplier path.
- Special and legacy alert rewards, corrected Long Shadow reward-table roll count.
- Legacy login milestone rewards and current Nightwave data.
- Vendor randomized-price identifier handling, credit-priced syndicate purchases, and duplicate potato-charge fix.

Custom reward configuration, generated metadata, cosmetic category toggles, repeat/full-stock vendors, custom standing settings, calendar rewards, market additions, event clocks, and client-build compatibility were retained. All local-only function names in changed source files were checked against the common ancestor; none were removed. That inventory is a preservation check, not proof of every runtime interaction.

## Validation

- npm ci --ignore-scripts --no-audit --no-fund: succeeded in isolated worktree. One dependency deprecation warning: node-domexception@1.0.0 (upstream dependency; not a failing build).
- npm run verify: PASS, including typecheck, reward-multiplier ownership, 14/14 Pontis cases, 60/60 unique generated reward references (214 references total), and item-registry consistency.
- npm run audit:metadata-end-to-end: PASS. Includes isolated acquisition, non-store acquisition, commerce, Nightwave purchase routes, all 96 vendors / 4,747 full-stock offers, current datafiles and pipeline.
- Acquisition audit classifies 23,170 entries: 23,084 supported grants, 1 supported state mutation, 1 intentional no-inventory mutation, 62 needing acquisition context, and 22 definition-only entries; zero unexplained failures. These categories are not a claim that every listed object is directly grantable.
- npm run lint:ci: PASS. Prettier applied to changed supported files.
- npm run build: PASS.
- runSelfTests(): PASS (vendors, guild tech, transmutation, relics, upgrade overrides, generated metadata, Circuit, Nightwave).
- node --experimental-strip-types RESEARCH/UPSTREAM_SYNC_2026-09-27/scripts/calendar-clock-parity.mjs: PASS, in-memory persistence only.
- git diff --check and conflict-marker scan: PASS.
- Active config.json matched its backup and test copy exactly: SHA-256 9262754685cf1168dc4f07bf80292e2da9d388ec1f84c85f4d2d55f31d1b3ed5.

Logs are in artifacts/. Test acquisition does not write the player's account. No game files, bootstrapper, Lua injector, or player database were edited.

## Limits and next live checks

This proves source integration and the stated automated checks, not every mission in-game. Test Pontis normal and Steel Path completion with existing x3 settings, then a Nightwave purchase and calendar claim. Client reward preview behavior remains a separate acceptance gate. Existing source still notes Dark Sector fixed completion-credit / Railjack bonus investigation (missionInventoryUpdateService.ts); no unsupported amount was invented here. The generic acquisition-context and definition-only classifications remain intentional, not new missing rewards introduced by this update.

Rollback source checkpoint is c277f6d5. Stop the server before restoring a prior checkout and reinstall dependencies from that checkpoint's lockfile. Preserve ignored config, database, generated metadata and backups. Do not run the stock UPDATE AND START SERVER script to maintain this custom branch: it explicitly checks out origin/main and would bypass the custom merge.
