# Space Ninja Server

<!-- public-variant-note -->
> **Public variant.** This repository is a periodically updated, scrubbed public snapshot of a private development repository; personal data (account emails, display names) has been replaced with placeholders, and history starts fresh at the first public snapshot.
>
> It is a modified fork of [OpenWF SpaceNinjaServer](https://onlyg.it/OpenWF/SpaceNinjaServer) (part of the [OpenWF](https://about.openwf.io/) preservation project). All credit for the original server goes to its authors. It is distributed under the same terms as upstream: GNU AGPL-3.0 with the Commons Clause condition; see [LICENSE](LICENSE).
<!-- public-variant-note -->


A source-available reimplementation of Warframe's web services. This project is part of the larger community preservation project "OpenWF": [Website](https://about.openwf.io/), [Discord](https://discord.gg/PNNZ3asUuY).

## Project Status

This project is in active development at <https://onlyg.it/OpenWF/SpaceNinjaServer>.

To get an idea of what functionality you can expect to be missing [have a look through the issues](https://onlyg.it/OpenWF/SpaceNinjaServer/issues). However, many things have been implemented and *should* work as expected. Please open an issue for anything where that's not the case and/or the server is reporting errors.

## config.json

SpaceNinjaServer requires a `config.json`. To set it up, you can copy the [config-vanilla.json](config-vanilla.json), which has most cheats disabled.

- `skipTutorial` affects only newly created accounts, so you may wish to change it before logging in for the first time.
- `database` defaults to an object to configure the _embedded_ mongod, but can be a string like `"mongodb://127.0.0.1:27017/openWF"` to simply connect to an existing MongoDB instance.
- `logger.fileLevel` and `logger.consoleLevel` can be `error`, `warn`, `info`, `http`, `debug`, or `trace`. Messages with lower priorities than the configured level will not be seen in the respective output.
- `bindAddress`, `httpPort`, and `httpsPort` are related to how SpaceNinjaServer is reached on the network. Under Docker, these options are unchangable; modify your `docker-compose.yml`, instead.
- `ircExecutable` and `hubExecutable` can be provided with relative paths to executables which will be ran as child processes of SpaceNinjaServer.
- `ircAddress`, `hubServers`, and `nrsAddresses` configure how clients contact these secondary servers. For `ircAddress`, a null value is equivalent to `%THIS_MACHINE%`, which should just work when SpaceNinjaServer and the secondary servers are on the same machine.
- `worldState.eidolonOverride` can be set to `day` or `night` to lock the time to day/fass and night/vome on Plains of Eidolon/Cambion Drift.
- `worldState.vallisOverride` can be set to `warm` or `cold` to lock the temperature on Orb Vallis.
- `worldState.duviriOverride` can be set to `joy`, `anger`, `envy`, `sorrow`, or `fear` to lock the Duviri spiral.
- `worldState.nightwaveOverride` will lock the nightwave season, assuming the client is new enough for it. Valid values:
  - `RadioLegionIntermission16Syndicate` for Nightwave Mix: Amir's Shockwave
  - `RadioLegionIntermission15Syndicate` for Nora's Mix: Time Tempests
  - `RadioLegionIntermission14Syndicate` for Nora's Mix: Dreams of the Dead
  - `RadioLegionIntermission13Syndicate` for Nora's Mix Vol. 9
  - `RadioLegionIntermission12Syndicate` for Nora's Mix Vol. 8
  - `RadioLegionIntermission11Syndicate` for Nora's Mix Vol. 7
  - `RadioLegionIntermission10Syndicate` for Nora's Mix Vol. 6
  - `RadioLegionIntermission9Syndicate` for Nora's Mix Vol. 5
  - `RadioLegionIntermission8Syndicate` for Nora's Mix Vol. 4
  - `RadioLegionIntermission7Syndicate` for Nora's Mix Vol. 3
  - `RadioLegionIntermission6Syndicate` for Nora's Mix Vol. 2
  - `RadioLegionIntermission5Syndicate` for Nora's Mix Vol. 1
  - `RadioLegionIntermission4Syndicate` for Nora's Choice
  - `RadioLegionIntermission3Syndicate` for Intermission III
  - `RadioLegion3Syndicate` for Glassmaker
  - `RadioLegionIntermission2Syndicate` for Intermission II
  - `RadioLegion2Syndicate` for The Emissary
  - `RadioLegionIntermissionSyndicate` for Intermission I
  - `RadioLegionSyndicate` for The Wolf of Saturn Six
- `worldState.allTheFissures` can be set to `normal` or `hard` to enable all fissures either in normal or steel path, respectively.
- `worldState.circuitGameModes` can be set to an array of game modes which will override the otherwise-random pattern in The Circuit. Valid element values are `Survival`, `VoidFlood`, `Excavation`, `Defense`, `Exterminate`, `Assassination`, and `Alchemy`.
- `fullyStockedVendors` keeps all build-compatible rotating offers available from server-side vendors. It also gives Baro and Varzia their complete stock and advertises the complete Steel Path Circuit Incarnon choice pool instead of the normal weekly five. The dedicated Baro and Varzia options remain valid as narrower overrides. The default is `false`.

## Full rotational stock behavior

When `fullyStockedVendors` is `false`, vendor bins and Steel Path Circuit Incarnon choices retain their normal time-based rotations. When it is `true`, the server returns all eligible offers from every supported vendor manifest, both Coda weapon bins, complete Baro and Varzia inventories, and every Incarnon choice supported by the connecting client build. Normal Circuit Warframe choices remain on their intended three-frame rotation.

The Cavalero Incarnon manifest already contains the complete bundle pool. The game filters that shop using the same Steel Path Circuit choice data, so the expanded world-state choice list is also the server-side input needed for the full Cavalero selection. Actual client presentation still requires in-game validation on the selected build.

`fullyStockedVendors` changes the stock advertised by vendor manifests. Account purchase history is a
separate contract: `noVendorPurchaseLimits` bypasses `RecentVendorPurchases` only for the account on
which that cheat is enabled. Enable both only when a limited offer must be visible and repeatedly
purchasable.

## Generated current-client metadata

`static/generated/openwf-metadata/challenge-metadata.json` is the hash-pinned output of the RENOVICE
OpenWF Metadata Updater. The server loads its complete admitted item/cosmetic registry, current
challenge and Nightwave supplements, all 96 current vendor manifests, 39 current syndicate favour
sets, and the exact current Dojo supplements. Native Aspirant Zorba stock is unchanged. The Nightwave
debug shop has independent `worldState.nightwaveDebugShopWarframeAppearance`,
`worldState.nightwaveDebugShopWeaponAppearance`,
`worldState.nightwaveDebugShopOperatorCompanionVehicleAppearance`,
`worldState.nightwaveDebugShopProfileEmotesInterface`,
`worldState.nightwaveDebugShopDecorations`, `worldState.nightwaveDebugShopArcanes`, and
`worldState.nightwaveDebugShopMods` switches. The four appearance switches divide all 6,881
retained individual appearance items into mutually exclusive pools. `ShipDecorations` and
decoration-only bundles remain isolated under Decorations. Built-in default Warframe body skins and
helmets, internal animation-unlock helpers, appearance bundle wrappers, and mixed bundle wrappers
are omitted because their usable appearance components are already offered individually. Arcanes
exclude the four internal ability-listener records hidden from the Codex.
Every debug offer uses the active Nightwave season's cred rather than Fergolyte. Set
`worldState.nightwaveDebugShopHideRegular` to `false` to keep the season's normal offers beside the
selected debug pools.

Run the complete offline production-path audit after every applied metadata snapshot:

```powershell
npm run audit:metadata-end-to-end
```

The audit executes acquisition for every admitted StoreItem, bundle, and unwrapped resource; pricing
lookups; current vendor scheduling/OID lookup and standing purchase; current syndicate and Dojo
integration; and structural/reference validation for missions, rewards, enemy drops, bounties, relics,
and recipes. A passing audit proves the server paths offline. Arsenal/shop presentation and mission
gameplay remain a separate current-client in-game check.

Within `privateServerTuning`, `suppressAutomaticCosmeticGrantsForEmails` is an exact email list for accounts that should earn or buy cosmetics after an ownership reset. For a listed account, the TennoGen bulk grant is skipped and skin records are skipped from the completed-event bulk grant. Other targeted accounts and non-skin event rewards retain the configured grant behavior.

## Local metadata definition patches

Optional local definition packages live under `Metadata Patches/Enabled/<package>/`. Each package has
one `patch.json` manifest plus `upgrade-definitions.json`, `server-definitions.json`, or both. The
typed upgrade format handles mod `rarity` and numeric `fusionLimit`. The generic format addresses any
entry in the installed Public Export Plus datasets with an exact dataset/path/value overlay:

```json
{
  "schemaVersion": 1,
  "overrides": [
    {
      "dataset": "ExportWarframes",
      "path": ["/Lotus/Powersuits/Bard/OctaviaPrime"],
      "values": { "health": 999 }
    }
  ]
}
```

All enabled packages are parsed and validated before any definition is applied. Malformed packages,
duplicate IDs, unknown datasets or paths, incompatible JSON type changes, unsafe prototype keys, and
field-level conflicts stop startup instead of producing a partial configuration. Array indices use
non-negative integers; object properties use strings. A package may add a JSON field, but that field
only has an effect if server code consumes it.

Move a whole package folder between `Enabled` and `Disabled`, then restart SpaceNinjaServer, to toggle
it. These packages overlay the effective server definition used by Public Export and server tools.
They never modify the installed dependency, account inventory, or save data. The RENOVICE Metadata
Editor can discover exact Public Export mappings, generate either package format, enable it, and
disable it. `npm run dev` watches the package root and automatically coalesces a folder move/write
burst into one clean server restart.
