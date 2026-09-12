# Changelog

All notable changes to this project will be documented in this file. See [Conventional Commits](https://www.conventionalcommits.org/) for commit guidelines.

## [0.16.1](https://github.com/Garblesnarff/infinite-realms-production/compare/v0.16.0...v0.16.1) (2026-09-12)


### Bug Fixes

* **voice:** resolve NPC TTS categories without narrator fallback ([#2000](https://github.com/Garblesnarff/infinite-realms-production/issues/2000)) ([1495f63](https://github.com/Garblesnarff/infinite-realms-production/commit/1495f631a367bebff8f79714dedc4f4b44807120))

## [0.16.0](https://github.com/Garblesnarff/infinite-realms-production/compare/v0.15.0...v0.16.0) (2026-09-12)


### Features

* **combat:** gate declared player attacks before LLM ([#1979](https://github.com/Garblesnarff/infinite-realms-production/issues/1979)) ([5572579](https://github.com/Garblesnarff/infinite-realms-production/commit/5572579bd2515a72886f5f3c19da6dfade7db149))


### Documentation

* reconcile agent instructions and push guard ([#1998](https://github.com/Garblesnarff/infinite-realms-production/issues/1998)) ([4512a6e](https://github.com/Garblesnarff/infinite-realms-production/commit/4512a6e0fa3744c98511a07afee72bae4b51ef75))

## [0.15.0](https://github.com/Garblesnarff/infinite-realms-production/compare/v0.14.3...v0.15.0) (2026-09-08)


### Features

* **sheet:** add spells section ([#1992](https://github.com/Garblesnarff/infinite-realms-production/issues/1992)) ([25264b2](https://github.com/Garblesnarff/infinite-realms-production/commit/25264b24246bc94868d40e2a7f5cabcc53acdcbe))

## [0.14.3](https://github.com/Garblesnarff/infinite-realms-production/compare/v0.14.2...v0.14.3) (2026-09-08)


### Bug Fixes

* **character:** use stored HP on sheet ([#1891](https://github.com/Garblesnarff/infinite-realms-production/issues/1891)) ([#1989](https://github.com/Garblesnarff/infinite-realms-production/issues/1989)) ([d6ef57d](https://github.com/Garblesnarff/infinite-realms-production/commit/d6ef57df691742c62a86651f193e3b5a73973515))
* **combat:** seat name-only combatants as 'monster', not 'other' ([#1988](https://github.com/Garblesnarff/infinite-realms-production/issues/1988)) ([1deb687](https://github.com/Garblesnarff/infinite-realms-production/commit/1deb687e5f34770a0c1a713fe1e76482cd258978))

## [0.14.2](https://github.com/Garblesnarff/infinite-realms-production/compare/v0.14.1...v0.14.2) (2026-09-07)


### Bug Fixes

* **auth:** stop token refresh storms and terminate ended sessions ([#1983](https://github.com/Garblesnarff/infinite-realms-production/issues/1983)) ([e7a2cd8](https://github.com/Garblesnarff/infinite-realms-production/commit/e7a2cd8008aa702092f83c3d95a9a51b192a031b))
* **combat:** make entry confirmation outcomes visible ([#1980](https://github.com/Garblesnarff/infinite-realms-production/issues/1980)) ([0a4a241](https://github.com/Garblesnarff/infinite-realms-production/commit/0a4a241381a0d85847486aabe17532349dc7cf58))
* **ui:** freeze campaign chapter until a DM chapter transition exists ([#1974](https://github.com/Garblesnarff/infinite-realms-production/issues/1974)) ([#1982](https://github.com/Garblesnarff/infinite-realms-production/issues/1982)) ([34efbeb](https://github.com/Garblesnarff/infinite-realms-production/commit/34efbeb72be37ce6262cadcc5db471b9a88d50be))
* **ui:** portal ability-check tooltips and drop dead attacks button ([#1975](https://github.com/Garblesnarff/infinite-realms-production/issues/1975)) ([#1981](https://github.com/Garblesnarff/infinite-realms-production/issues/1981)) ([91757bb](https://github.com/Garblesnarff/infinite-realms-production/commit/91757bbbe716c250c935903185d2d804557068c9))

## [0.14.1](https://github.com/Garblesnarff/infinite-realms-production/compare/v0.14.0...v0.14.1) (2026-09-05)


### Bug Fixes

* **db:** close six public anon tables ([#1964](https://github.com/Garblesnarff/infinite-realms-production/issues/1964)) ([74e353d](https://github.com/Garblesnarff/infinite-realms-production/commit/74e353d22314b8621ae98bf130004da8b4783d72))
* route issue 1784 browser table access through auth ([#1967](https://github.com/Garblesnarff/infinite-realms-production/issues/1967)) ([eb392ea](https://github.com/Garblesnarff/infinite-realms-production/commit/eb392eacf99f3b29a0bd7f2495812ce53c52aa59))

## [0.14.0](https://github.com/Garblesnarff/infinite-realms-production/compare/v0.13.1...v0.14.0) (2026-09-04)


### Features

* **combat:** add ask-first entry and pending intent promotion ([#1954](https://github.com/Garblesnarff/infinite-realms-production/issues/1954)) ([9a9e13a](https://github.com/Garblesnarff/infinite-realms-production/commit/9a9e13a64cad93a3a5cd2a5a97727900947aaaae))
* **combat:** split entry seating and pending intents ([#1935](https://github.com/Garblesnarff/infinite-realms-production/issues/1935)) ([52796a7](https://github.com/Garblesnarff/infinite-realms-production/commit/52796a786f1387b60907520eaee294c54ba49d79))


### Refactoring

* **combat:** retire legacy start and snapshot paths ([#1960](https://github.com/Garblesnarff/infinite-realms-production/issues/1960)) ([c6196c6](https://github.com/Garblesnarff/infinite-realms-production/commit/c6196c6f1bf5a606d23a37a5546862d072da7fcc))
* **headless:** use shared stripAssetTags helper ([#1963](https://github.com/Garblesnarff/infinite-realms-production/issues/1963)) ([357176d](https://github.com/Garblesnarff/infinite-realms-production/commit/357176d2aaa7787ebaa2f8d0c99046db8028d9d7)), closes [#1947](https://github.com/Garblesnarff/infinite-realms-production/issues/1947)

## [0.13.1](https://github.com/Garblesnarff/infinite-realms-production/compare/v0.13.0...v0.13.1) (2026-09-01)


### Bug Fixes

* show session companions in party rail ([#1950](https://github.com/Garblesnarff/infinite-realms-production/issues/1950)) ([a4bcbbf](https://github.com/Garblesnarff/infinite-realms-production/commit/a4bcbbfbb41fd8c115a7516a80bf74f188827e28))

## [0.13.0](https://github.com/Garblesnarff/infinite-realms-production/compare/v0.12.2...v0.13.0) (2026-08-31)


### Features

* add leave WebMCP companion tool ([#1957](https://github.com/Garblesnarff/infinite-realms-production/issues/1957)) ([d4fda11](https://github.com/Garblesnarff/infinite-realms-production/commit/d4fda11789ad0c9b321e9f7201143f1c60a20153))


### Bug Fixes

* leave option-less DM replies as free-text ([#1944](https://github.com/Garblesnarff/infinite-realms-production/issues/1944)) ([#1953](https://github.com/Garblesnarff/infinite-realms-production/issues/1953)) ([9c3ff09](https://github.com/Garblesnarff/infinite-realms-production/commit/9c3ff09b2fb082a5fc3f84d37f951597199542b7))
* seed character_stats for two statless characters ([#1939](https://github.com/Garblesnarff/infinite-realms-production/issues/1939)) ([#1951](https://github.com/Garblesnarff/infinite-realms-production/issues/1951)) ([fbd173c](https://github.com/Garblesnarff/infinite-realms-production/commit/fbd173c6530b924b0058ff5c238c4e9499da0537))

## [0.12.2](https://github.com/Garblesnarff/infinite-realms-production/compare/v0.12.1...v0.12.2) (2026-08-30)


### Bug Fixes

* preserve starter spell quotas and repair seeded rows ([#1937](https://github.com/Garblesnarff/infinite-realms-production/issues/1937)) ([66217ac](https://github.com/Garblesnarff/infinite-realms-production/commit/66217aca5877d87c0f12b218f744f6a8e2a89778))
* prevent asset tag leakage across narration surfaces ([#1947](https://github.com/Garblesnarff/infinite-realms-production/issues/1947)) ([90ab2ca](https://github.com/Garblesnarff/infinite-realms-production/commit/90ab2cacfa1b59a079c5e207239039810e9e5a98))
* stop the DM reusing a previous turn's action options ([#1944](https://github.com/Garblesnarff/infinite-realms-production/issues/1944)) ([#1945](https://github.com/Garblesnarff/infinite-realms-production/issues/1945)) ([ecaace2](https://github.com/Garblesnarff/infinite-realms-production/commit/ecaace207e888c80f6634457348a99e16437935f))
* unwrap array character_stats on playable character cards ([#1939](https://github.com/Garblesnarff/infinite-realms-production/issues/1939)) ([#1946](https://github.com/Garblesnarff/infinite-realms-production/issues/1946)) ([ab0b93a](https://github.com/Garblesnarff/infinite-realms-production/commit/ab0b93a5cd924079221a997a109a200754f0b269))
* **voice:** switch NPC voices per narration segment ([#1948](https://github.com/Garblesnarff/infinite-realms-production/issues/1948)) ([74ba192](https://github.com/Garblesnarff/infinite-realms-production/commit/74ba192a92bb6046b60c5578e73d37ff38f87f23)), closes [#1942](https://github.com/Garblesnarff/infinite-realms-production/issues/1942)

## [0.12.1](https://github.com/Garblesnarff/infinite-realms-production/compare/v0.12.0...v0.12.1) (2026-08-29)


### Bug Fixes

* stabilize progressive voice playback and skip engine lines ([#1931](https://github.com/Garblesnarff/infinite-realms-production/issues/1931)) ([71d3b95](https://github.com/Garblesnarff/infinite-realms-production/commit/71d3b958a86fbc89222dc4f8a77b87bc3c3408aa))

## [0.12.0](https://github.com/Garblesnarff/infinite-realms-production/compare/v0.11.5...v0.12.0) (2026-08-28)


### Features

* **webmcp:** add companion party surface ([#1930](https://github.com/Garblesnarff/infinite-realms-production/issues/1930)) ([15cc08e](https://github.com/Garblesnarff/infinite-realms-production/commit/15cc08e6cbc79f25632436eb8639d80a99c57d2a))


### Bug Fixes

* **webmcp:** harden companion join and scene smoke regressions ([#1933](https://github.com/Garblesnarff/infinite-realms-production/issues/1933)) ([b70e366](https://github.com/Garblesnarff/infinite-realms-production/commit/b70e36686c9b6b7fe4d1eeda88fce6a6bed98eea))

## [0.11.5](https://github.com/Garblesnarff/infinite-realms-production/compare/v0.11.4...v0.11.5) (2026-08-27)


### Bug Fixes

* **security:** keep ElevenLabs TTS key server-side ([#1927](https://github.com/Garblesnarff/infinite-realms-production/issues/1927)) ([77edb0e](https://github.com/Garblesnarff/infinite-realms-production/commit/77edb0efe6cb8a297b6c702a59f1176de5a14d7b))

## [0.11.4](https://github.com/Garblesnarff/infinite-realms-production/compare/v0.11.3...v0.11.4) (2026-08-26)


### Bug Fixes

* **character:** unify starter ability score normalization ([#1919](https://github.com/Garblesnarff/infinite-realms-production/issues/1919)) ([7239d38](https://github.com/Garblesnarff/infinite-realms-production/commit/7239d382c6545b8dc9bbf4507b867e1d78ef9a8d))
* **combat:** hide player-facing tracker controls ([#1923](https://github.com/Garblesnarff/infinite-realms-production/issues/1923)) ([3b7e4a5](https://github.com/Garblesnarff/infinite-realms-production/commit/3b7e4a5b564128682b87ae7106e6c3ef54012693))
* **game-ui:** use stored HP for existing-character displays ([#1922](https://github.com/Garblesnarff/infinite-realms-production/issues/1922)) ([e5847a6](https://github.com/Garblesnarff/infinite-realms-production/commit/e5847a6dd2d22d75309e0f1a6af9efda6ec3d4b8))

## [0.11.3](https://github.com/Garblesnarff/infinite-realms-production/compare/v0.11.2...v0.11.3) (2026-08-26)


### Bug Fixes

* **ai:** validate complete asset names and guard bare asset tags ([#1909](https://github.com/Garblesnarff/infinite-realms-production/issues/1909)) ([c458935](https://github.com/Garblesnarff/infinite-realms-production/commit/c458935f0df952d2cece4e0fe540f475333d1762))
* **combat:** derive player initiative from dexterity ([#1911](https://github.com/Garblesnarff/infinite-realms-production/issues/1911)) ([81a6b7a](https://github.com/Garblesnarff/infinite-realms-production/commit/81a6b7a03ca63b8ea61727506f501f93a42a07e7))

## [0.11.2](https://github.com/Garblesnarff/infinite-realms-production/compare/v0.11.1...v0.11.2) (2026-08-25)


### Bug Fixes

* **character:** accept both character_stats shapes ([#1900](https://github.com/Garblesnarff/infinite-realms-production/issues/1900)) ([#1902](https://github.com/Garblesnarff/infinite-realms-production/issues/1902)) ([82efd9d](https://github.com/Garblesnarff/infinite-realms-production/commit/82efd9df071dd0b10131acc8e1ac718466d6f4d7))
* **character:** preserve stored HP on sheet edits ([#1897](https://github.com/Garblesnarff/infinite-realms-production/issues/1897)) ([#1903](https://github.com/Garblesnarff/infinite-realms-production/issues/1903)) ([412eddd](https://github.com/Garblesnarff/infinite-realms-production/commit/412eddd6c773f0e1043cdabde4a4bb3d87ccc0b7))


### Tests

* **real-db:** guard monster attack fixtures ([#1901](https://github.com/Garblesnarff/infinite-realms-production/issues/1901)) ([#1904](https://github.com/Garblesnarff/infinite-realms-production/issues/1904)) ([d179827](https://github.com/Garblesnarff/infinite-realms-production/commit/d179827b0117b9d6657b385a2b29f0b7738ae4e9))

## [0.11.1](https://github.com/Garblesnarff/infinite-realms-production/compare/v0.11.0...v0.11.1) (2026-08-25)


### Bug Fixes

* **character:** render stored roster hover stats ([#1898](https://github.com/Garblesnarff/infinite-realms-production/issues/1898)) ([2b24d77](https://github.com/Garblesnarff/infinite-realms-production/commit/2b24d7709ad609b6ec2ef1728641ae5cbfb52b57))
* **character:** write class-based level-1 HP ([#1893](https://github.com/Garblesnarff/infinite-realms-production/issues/1893)) ([91361ba](https://github.com/Garblesnarff/infinite-realms-production/commit/91361ba0f1a87dfdfa601e66f4ea4df74812291c))

## [0.11.0](https://github.com/Garblesnarff/infinite-realms-production/compare/v0.10.4...v0.11.0) (2026-08-25)


### Features

* 🎨 Palette: RadioGroup accessibility improvements in character creation ([#1661](https://github.com/Garblesnarff/infinite-realms-production/issues/1661)) ([a7a0bfa](https://github.com/Garblesnarff/infinite-realms-production/commit/a7a0bfaa1c822a6788a5943a62d88fa316052a3b))
* **a11y:** improve accessibility of game session audio buttons and sliders ([#1601](https://github.com/Garblesnarff/infinite-realms-production/issues/1601)) ([b1b61d4](https://github.com/Garblesnarff/infinite-realms-production/commit/b1b61d4a68a46d47f471e7e0498e1ae69cfff62e))
* **auth:** add rate-limited WorkOS password login ([7c1a5f6](https://github.com/Garblesnarff/infinite-realms-production/commit/7c1a5f6c94b7de87556e05fac57303a1aaf4825a))
* **character:** character-scoped HP/consciousness — C0.5 PR1 ([#1852](https://github.com/Garblesnarff/infinite-realms-production/issues/1852)) ([5466501](https://github.com/Garblesnarff/infinite-realms-production/commit/5466501d51e1f9418861acefce1fcc0ec46d4ad4))
* **cli:** add agent playtesting terminal client ([d539d97](https://github.com/Garblesnarff/infinite-realms-production/commit/d539d9730a3df521d6c72c60537509cd2d5fb3de))
* **cli:** bootstrap fresh starter sessions ([bda2402](https://github.com/Garblesnarff/infinite-realms-production/commit/bda2402a335a174a55b11290bd45aed4b923f384))
* **cli:** improve agent playtest fidelity ([3c1d1a2](https://github.com/Garblesnarff/infinite-realms-production/commit/3c1d1a294eb2d1a5a50a9c582761b82c90f31824))
* **combat:** accept the legacy attack dialect instead of correcting it ([47205c1](https://github.com/Garblesnarff/infinite-realms-production/commit/47205c12f244f96e67b5e6bf82fa24545881eb3b))
* **combat:** enforce spatial coherence for combat actions ([0ff13ce](https://github.com/Garblesnarff/infinite-realms-production/commit/0ff13ce5c53a137f77772b042fa963dfec868464))
* **combat:** give monsters real attacks from catalog, bible or CR derivation ([0525400](https://github.com/Garblesnarff/infinite-realms-production/commit/0525400b47895d58f725b6e264e8ac3f33541a0f))
* **combat:** give tactical entities slugs so DM moves and spatial checks resolve ([e722735](https://github.com/Garblesnarff/infinite-realms-production/commit/e72273503cb1081b1011946cf940ae3182a56cb6))
* **combat:** HP write-through to character record — C0.5 PR2 ([#1826](https://github.com/Garblesnarff/infinite-realms-production/issues/1826)) ([#1862](https://github.com/Garblesnarff/infinite-realms-production/issues/1862)) ([b23057c](https://github.com/Garblesnarff/infinite-realms-production/commit/b23057c69afef4a94e130050ff5a1a2aa1a9cc18))
* **combat:** make campaign-authored monsters fight at their authored stats ([e98dc13](https://github.com/Garblesnarff/infinite-realms-production/commit/e98dc1320b199e86fb8470869afa301d8dab9ec6))
* **combat:** re-teach the elicitation dialect and floor it with prose intent ([5bfa69d](https://github.com/Garblesnarff/infinite-realms-production/commit/5bfa69dfad204df03aaf543364f9586e85520524))
* **combat:** resolve attacks through the engine so movement is a consequence ([9574bab](https://github.com/Garblesnarff/infinite-realms-production/commit/9574babd3cf4e37e5c6a75d05bcf858831a657f8))
* **combat:** scale monsters to the party, and let fights end out loud ([0abc738](https://github.com/Garblesnarff/infinite-realms-production/commit/0abc7383f6c5d7eebb2e84ecd22f20ccf4fb87ce))
* **combat:** the player rolls their own attack die ([#1716](https://github.com/Garblesnarff/infinite-realms-production/issues/1716)) ([29c1a20](https://github.com/Garblesnarff/infinite-realms-production/commit/29c1a203997fe7a74adefd7051451a3a70bf923f))
* **game:** add reusable headless client pipeline ([8d0385d](https://github.com/Garblesnarff/infinite-realms-production/commit/8d0385d6a19cb94ffa02f5e20b726b43e7774eab))
* **ingest:** stamp the embedding model into chunk metadata ([#1820](https://github.com/Garblesnarff/infinite-realms-production/issues/1820)) ([828ca75](https://github.com/Garblesnarff/infinite-realms-production/commit/828ca75934ce75a662868b48e4afb2d59c523147))
* **journal:** deliver authored and improvised handouts ([2d07e52](https://github.com/Garblesnarff/infinite-realms-production/commit/2d07e5221537bca435fe638ece932cb14830807c))
* **journal:** deliver authored and improvised handouts ([#1493](https://github.com/Garblesnarff/infinite-realms-production/issues/1493)) ([c4d2111](https://github.com/Garblesnarff/infinite-realms-production/commit/c4d21119b7aa31a6d9645c2e874befa735c42354))
* make campaign asset uploads manifest-driven ([#1772](https://github.com/Garblesnarff/infinite-realms-production/issues/1772)) ([1d78006](https://github.com/Garblesnarff/infinite-realms-production/commit/1d780066491ce5b9a7b7eb305f6716db46390df9))
* **memory:** embedding column + RPC to 768-dim — substrate PR1 ([#1851](https://github.com/Garblesnarff/infinite-realms-production/issues/1851)) ([e3f81f2](https://github.com/Garblesnarff/infinite-realms-production/commit/e3f81f2d4f1e5632e5c49ae16394f28b884f0280))
* **memory:** inject Previously On recap into opening generation prompt ([#1683](https://github.com/Garblesnarff/infinite-realms-production/issues/1683)) ([b7dce96](https://github.com/Garblesnarff/infinite-realms-production/commit/b7dce969e49cc6e08b23a63fb6f223d6eb80f4c2)), closes [#1677](https://github.com/Garblesnarff/infinite-realms-production/issues/1677)
* **memory:** narrative ledger — first deployment (rebased, closes [#1691](https://github.com/Garblesnarff/infinite-realms-production/issues/1691)) ([#1696](https://github.com/Garblesnarff/infinite-realms-production/issues/1696)) ([25b3eb2](https://github.com/Garblesnarff/infinite-realms-production/commit/25b3eb24381ec9b52b472ef5e27ce7f6ef9fef53))
* **memory:** persist DM handout possessions ([#1758](https://github.com/Garblesnarff/infinite-realms-production/issues/1758)) ([3f40606](https://github.com/Garblesnarff/infinite-realms-production/commit/3f406066f817879241028d9167e51b9acc63b3c3))
* **memory:** server-side embedding writes — substrate PR2 ([#1822](https://github.com/Garblesnarff/infinite-realms-production/issues/1822)) ([#1863](https://github.com/Garblesnarff/infinite-realms-production/issues/1863)) ([ffccff4](https://github.com/Garblesnarff/infinite-realms-production/commit/ffccff4b5ea165b3c220f66ec5fa24a23f31f040))
* **observability:** loud failures on continuity paths ([#1680](https://github.com/Garblesnarff/infinite-realms-production/issues/1680)) ([#1690](https://github.com/Garblesnarff/infinite-realms-production/issues/1690)) ([ca4910f](https://github.com/Garblesnarff/infinite-realms-production/commit/ca4910fc1191cb982d0492e43da71b6b42c234e2))
* **ops:** gate deploys with API smoke journey ([4974df6](https://github.com/Garblesnarff/infinite-realms-production/commit/4974df671a57399d71a34cd0fdc26f00bdc11d2d))
* replace native titles with Shadcn Tooltips in Race and Subrace Cards ([#1649](https://github.com/Garblesnarff/infinite-realms-production/issues/1649)) ([80eb403](https://github.com/Garblesnarff/infinite-realms-production/commit/80eb403de55a5487e402b534906c11c3e4ac1180))
* **scripts:** backfill memory embeddings — [#1822](https://github.com/Garblesnarff/infinite-realms-production/issues/1822) PR4 ([e9a7a67](https://github.com/Garblesnarff/infinite-realms-production/commit/e9a7a67024fb45590f6b89c21d6b3f298bc6fc54))
* **tactical:** make DM map actions server authoritative ([529140f](https://github.com/Garblesnarff/infinite-realms-production/commit/529140fdf54f7cd79d84ef88cd3e3d7ebfa2dfd5))
* **tactical:** make DM map actions server authoritative ([09efc37](https://github.com/Garblesnarff/infinite-realms-production/commit/09efc37825bbd0f185ed5fd749f5d8a761aeccfa))
* **tactical:** resolve AoE spell templates ([9d46640](https://github.com/Garblesnarff/infinite-realms-production/commit/9d46640c009b4a164f9b5ae051a837c444e314c5))
* **tactical:** resolve spell area templates ([0bac449](https://github.com/Garblesnarff/infinite-realms-production/commit/0bac4498a6bf00ea77125077b58c69385c40b98d))
* **telemetry:** per-section prompt token metrics, log-only ([#1689](https://github.com/Garblesnarff/infinite-realms-production/issues/1689)) ([66ae95c](https://github.com/Garblesnarff/infinite-realms-production/commit/66ae95c3a0e7bd14b2c173ea0b4546acdae0ad45)), closes [#1688](https://github.com/Garblesnarff/infinite-realms-production/issues/1688)
* **ui:** present engine dice results as a collapsible chip ([#1808](https://github.com/Garblesnarff/infinite-realms-production/issues/1808)) ([#1870](https://github.com/Garblesnarff/infinite-realms-production/issues/1870)) ([bed4313](https://github.com/Garblesnarff/infinite-realms-production/commit/bed4313e5bbcc7213d6b4cce688808088862ed48))
* **ux:** add custom tooltips and ARIA label support to ExportButton ([#1635](https://github.com/Garblesnarff/infinite-realms-production/issues/1635)) ([f5c8c22](https://github.com/Garblesnarff/infinite-realms-production/commit/f5c8c22081e64919460664d1cf112618c005f2a9))


### Bug Fixes

* accept live asset manifest schema ([#1776](https://github.com/Garblesnarff/infinite-realms-production/issues/1776)) ([c4bfb55](https://github.com/Garblesnarff/infinite-realms-production/commit/c4bfb55fe3e90cc2d18c5aaa413e6c29de494703))
* **ai:** carry target AC in structured roll requests ([de29da4](https://github.com/Garblesnarff/infinite-realms-production/commit/de29da4b4e91cf58cb3dba7615e3d5801d926e50))
* align full schema drift between db/schema/*.ts and prod (combat-start 500) ([17ebfd4](https://github.com/Garblesnarff/infinite-realms-production/commit/17ebfd47f19b7d8c814bce7cce4a65b54dce844b))
* **api:** keep public route responses intact ([fd20882](https://github.com/Garblesnarff/infinite-realms-production/commit/fd2088293c149ecc409d63eb9c7380b3ef781965))
* **api:** normalize postgres RowList responses ([bd37275](https://github.com/Garblesnarff/infinite-realms-production/commit/bd37275c6f6bd49c9889e1d598bcbabc6eeaa0f4))
* **assets:** support faction and starter character card assets ([#1825](https://github.com/Garblesnarff/infinite-realms-production/issues/1825), [#1876](https://github.com/Garblesnarff/infinite-realms-production/issues/1876)) ([#1880](https://github.com/Garblesnarff/infinite-realms-production/issues/1880)) ([bd0f524](https://github.com/Garblesnarff/infinite-realms-production/commit/bd0f524f2b1e6f835d01e846e163bc547edfa299))
* **auth:** prevent successful error responses ([71ee43c](https://github.com/Garblesnarff/infinite-realms-production/commit/71ee43c1edfbb73447e21675c588bc13468c901e))
* **auth:** refresh expired token on boot; gate user-data-api requests ([c83129f](https://github.com/Garblesnarff/infinite-realms-production/commit/c83129fbd71ca7598a918e8b98fda7f3af576993))
* **campaigns:** use honest artwork placeholder ([#1757](https://github.com/Garblesnarff/infinite-realms-production/issues/1757)) ([3e85d87](https://github.com/Garblesnarff/infinite-realms-production/commit/3e85d87f7b1dcc501ba0b413ef30c3be864a07d6))
* **character:** case-fold the skill proficiency lookup ([#1847](https://github.com/Garblesnarff/infinite-realms-production/issues/1847)) ([#1849](https://github.com/Garblesnarff/infinite-realms-production/issues/1849)) ([99f256f](https://github.com/Garblesnarff/infinite-realms-production/commit/99f256f4ffc3568e7daecde945de8085fe2f039b))
* **character:** compute AC from equipment — seeder, save path, backfill ([#1858](https://github.com/Garblesnarff/infinite-realms-production/issues/1858)) ([#1864](https://github.com/Garblesnarff/infinite-realms-production/issues/1864)) ([b8ff501](https://github.com/Garblesnarff/infinite-realms-production/commit/b8ff501503958e08aea3854bfe4eeef0abefedb4))
* **character:** hydrate canonical class and race data ([#1890](https://github.com/Garblesnarff/infinite-realms-production/issues/1890)) ([6970df5](https://github.com/Garblesnarff/infinite-realms-production/commit/6970df5d6e631aa69b5de0225351b28d4be847ed))
* **character:** normalize starter ability score keys ([#1881](https://github.com/Garblesnarff/infinite-realms-production/issues/1881)) ([f30471e](https://github.com/Garblesnarff/infinite-realms-production/commit/f30471e9277fe8e297579604cf07cdacfc69483a))
* **character:** restore the proficiency bonus on skills and saves ([#1827](https://github.com/Garblesnarff/infinite-realms-production/issues/1827)) ([#1829](https://github.com/Garblesnarff/infinite-realms-production/issues/1829)) ([16295ae](https://github.com/Garblesnarff/infinite-realms-production/commit/16295aed00a059f67a7146dd3e11fb13ba8ace2f))
* **character:** stop selecting a column that does not exist ([#1859](https://github.com/Garblesnarff/infinite-realms-production/issues/1859)) ([#1860](https://github.com/Garblesnarff/infinite-realms-production/issues/1860)) ([9a19304](https://github.com/Garblesnarff/infinite-realms-production/commit/9a193047612c5229ac043ae797ffe9737cbea914))
* **chat:** conjugate "you were" as "I was" when echoing a chosen option ([#1653](https://github.com/Garblesnarff/infinite-realms-production/issues/1653)) ([0cdf26b](https://github.com/Garblesnarff/infinite-realms-production/commit/0cdf26b82d85cfec14ff3050a9c09f38dcda9f85))
* **chat:** keep message history chronological when loading older pages ([#1682](https://github.com/Garblesnarff/infinite-realms-production/issues/1682)) ([b647c0e](https://github.com/Garblesnarff/infinite-realms-production/commit/b647c0e99949927f13f372e1089cd33ff7d171a4)), closes [#1678](https://github.com/Garblesnarff/infinite-realms-production/issues/1678)
* **checks:** derive roll modifiers from character records ([#1765](https://github.com/Garblesnarff/infinite-realms-production/issues/1765)) ([#1878](https://github.com/Garblesnarff/infinite-realms-production/issues/1878)) ([7d1af08](https://github.com/Garblesnarff/infinite-realms-production/commit/7d1af081d3a5a91fcd905997a92db69e75072b43))
* **chronicles:** source Previously On from full-session sample, both speakers ([#1684](https://github.com/Garblesnarff/infinite-realms-production/issues/1684)) ([1481602](https://github.com/Garblesnarff/infinite-realms-production/commit/14816028b1a3a01e8878e6b304a5e85c72caebf3)), closes [#1681](https://github.com/Garblesnarff/infinite-realms-production/issues/1681)
* **ci:** stop the schema-drift guard seeing phantom drift from AppleDouble files ([b389faf](https://github.com/Garblesnarff/infinite-realms-production/commit/b389faf41b122319c3152a2273dd1c2fa6f35ea3))
* **client:** observe malformed websocket frames ([#1801](https://github.com/Garblesnarff/infinite-realms-production/issues/1801)) ([63c9d2a](https://github.com/Garblesnarff/infinite-realms-production/commit/63c9d2adbf9767693076e55ae2f5189a61f22cdb))
* **client:** preserve structured greeting options ([#1828](https://github.com/Garblesnarff/infinite-realms-production/issues/1828)) ([5d9e551](https://github.com/Garblesnarff/infinite-realms-production/commit/5d9e5513d2b5480c82674eaa7c94c827c60f7c9d))
* **cli:** stop root flags shadowing reingest subcommand options ([#1806](https://github.com/Garblesnarff/infinite-realms-production/issues/1806)) ([372c503](https://github.com/Garblesnarff/infinite-realms-production/commit/372c503e291e4cf5963a2b4cf9c3a7454cfc9de2)), closes [#1805](https://github.com/Garblesnarff/infinite-realms-production/issues/1805)
* **combat:** absorb the DM's turn-cycle mistakes and close the abandoned-encounter path ([aeaaa6f](https://github.com/Garblesnarff/infinite-realms-production/commit/aeaaa6f556e1779798dea105b22245eaf2c2ca47))
* **combat:** align persistence route params to end the boot crash ([#1767](https://github.com/Garblesnarff/infinite-realms-production/issues/1767)) ([38675c6](https://github.com/Garblesnarff/infinite-realms-production/commit/38675c63e7d0a4b25c23574030f206cb3a8c4a5c))
* **combat:** build the DM's equipment block from the character sheet ([2dc05dc](https://github.com/Garblesnarff/infinite-realms-production/commit/2dc05dc86f2aae4459d77ad221c84f0d787ee5da))
* **combat:** deterministic server-side combat entry gate ([#1794](https://github.com/Garblesnarff/infinite-realms-production/issues/1794)) ([dac88f0](https://github.com/Garblesnarff/infinite-realms-production/commit/dac88f042ec7b7c4763040246c4d90364dce3973)), closes [#1779](https://github.com/Garblesnarff/infinite-realms-production/issues/1779)
* **combat:** force a structured action when the DM narrates instead of declaring ([#1702](https://github.com/Garblesnarff/infinite-realms-production/issues/1702)) ([b48b97c](https://github.com/Garblesnarff/infinite-realms-production/commit/b48b97c5fd3f5af99d78506d5e7569946831a084))
* **combat:** guard post-victory batch boundaries ([#1755](https://github.com/Garblesnarff/infinite-realms-production/issues/1755)) ([17fd20c](https://github.com/Garblesnarff/infinite-realms-production/commit/17fd20c22237d37efedba438f6eb705fc9251730))
* **combat:** honor declared unarmed strikes and one roll per action ([#1807](https://github.com/Garblesnarff/infinite-realms-production/issues/1807)) ([#1866](https://github.com/Garblesnarff/infinite-realms-production/issues/1866)) ([ef5b09e](https://github.com/Garblesnarff/infinite-realms-production/commit/ef5b09eb39b4a4b9b0ee809d7f6ea3e48f589403))
* **combat:** lazy-load attack resolver to avoid TDZ ([#1775](https://github.com/Garblesnarff/infinite-realms-production/issues/1775)) ([962f6c2](https://github.com/Garblesnarff/infinite-realms-production/commit/962f6c26535e0dc657a122993a82490d4166f408))
* **combat:** let the server own expectedVersion for DM intents, and say why on refusal ([c57788d](https://github.com/Garblesnarff/infinite-realms-production/commit/c57788d5140a89147cc721fab282fc80bcd1a07e))
* **combat:** log every attack roll and stop the encounter restart loop ([e23894a](https://github.com/Garblesnarff/infinite-realms-production/commit/e23894a470e0bef22c69c49f42746abd6e634838))
* **combat:** preserve structured entry audit signals ([#1792](https://github.com/Garblesnarff/infinite-realms-production/issues/1792)) ([0a18041](https://github.com/Garblesnarff/infinite-realms-production/commit/0a18041ba243603b5597657c58537853546d77ce))
* **combat:** prevent encounter tracker reopen crash ([#1710](https://github.com/Garblesnarff/infinite-realms-production/issues/1710)) ([861f493](https://github.com/Garblesnarff/infinite-realms-production/commit/861f493c6ef45e6ec450d1ca77594f0e0e582142))
* **combat:** prevent tracker reopen crash ([dbfab52](https://github.com/Garblesnarff/infinite-realms-production/commit/dbfab527f95dc3e8d563b67ae214878676611a01))
* **combat:** read combat state from the server on every browser turn ([0c47040](https://github.com/Garblesnarff/infinite-realms-production/commit/0c470401e1903158d41928ee3143c5c42145d1e4))
* **combat:** remove dead intent fallback chain ([#1709](https://github.com/Garblesnarff/infinite-realms-production/issues/1709)) ([f16c1ad](https://github.com/Garblesnarff/infinite-realms-production/commit/f16c1ad4c4c94e17cb16f5467d8bb11b50ab3e38))
* **combat:** resolve entity slugs at the intent gateway, split the turn error ([b489957](https://github.com/Garblesnarff/infinite-realms-production/commit/b489957bce420dd706266763436c92eea5418684))
* **combat:** resolve numbered entity slugs + validate refs at intent boundary ([#1700](https://github.com/Garblesnarff/infinite-realms-production/issues/1700)) ([1e08c59](https://github.com/Garblesnarff/infinite-realms-production/commit/1e08c595c84b36b6b419cc9dac3212fa5e0bc1ef))
* **combat:** restore slugged player dice popups ([#1786](https://github.com/Garblesnarff/infinite-realms-production/issues/1786)) ([202cee4](https://github.com/Garblesnarff/infinite-realms-production/commit/202cee499ae55384892f18e32526ae0be621dd3d))
* **combat:** route rolls NPC-unless-proven-player ([#1857](https://github.com/Garblesnarff/infinite-realms-production/issues/1857)) ([#1865](https://github.com/Garblesnarff/infinite-realms-production/issues/1865)) ([0ff4065](https://github.com/Garblesnarff/infinite-realms-production/commit/0ff406568bbfc235f5f1de9dd57b84b741842017))
* **combat:** surface engine outcomes in transcript ([#1787](https://github.com/Garblesnarff/infinite-realms-production/issues/1787)) ([9cf0a35](https://github.com/Garblesnarff/infinite-realms-production/commit/9cf0a358dea742bd3cbde9f337a50b1adfaa7b71))
* **combat:** surface intent failures without dead fallback ([422dfc9](https://github.com/Garblesnarff/infinite-realms-production/commit/422dfc9a6fc3a01a8244eb6539b885006f2cd80a))
* **combat:** tactical turn order in the DM prompt + one repair after a refusal ([#1701](https://github.com/Garblesnarff/infinite-realms-production/issues/1701)) ([6ac8ce2](https://github.com/Garblesnarff/infinite-realms-production/commit/6ac8ce2603e624dd9c4829df2d190837406afc97))
* **combat:** the engine ends an NPC's turn, and a refused action is never narrated ([#1744](https://github.com/Garblesnarff/infinite-realms-production/issues/1744)) ([49ef9a4](https://github.com/Garblesnarff/infinite-realms-production/commit/49ef9a4077d16c8e24dcc637623d2533eaba3737))
* **combat:** the engine ends an NPC's turn, and a refused action is never narrated ([#1744](https://github.com/Garblesnarff/infinite-realms-production/issues/1744)) ([62b9da7](https://github.com/Garblesnarff/infinite-realms-production/commit/62b9da703e20fa5b3c2308c545dbfe9df8d17437))
* **combat:** treat unset AC as NULL, never in-band 10 ([#1871](https://github.com/Garblesnarff/infinite-realms-production/issues/1871)) ([#1877](https://github.com/Garblesnarff/infinite-realms-production/issues/1877)) ([6b98123](https://github.com/Garblesnarff/infinite-realms-production/commit/6b98123329ba619918409b739526d66fa99a752f))
* **content:** dedupe campaign_chunks + unique index, upsert on ingest ([#1694](https://github.com/Garblesnarff/infinite-realms-production/issues/1694)) ([4a21fac](https://github.com/Garblesnarff/infinite-realms-production/commit/4a21facae5b23aed35528eadd88b17438ae70ec3)), closes [#1664](https://github.com/Garblesnarff/infinite-realms-production/issues/1664)
* **content:** normalize reingest trailing colons ([#1812](https://github.com/Garblesnarff/infinite-realms-production/issues/1812)) ([ffaf8d3](https://github.com/Garblesnarff/infinite-realms-production/commit/ffaf8d3420c99597f95e35ee471ea2446ff1ba9b))
* **content:** repair campaign bible ingestion ([#1800](https://github.com/Garblesnarff/infinite-realms-production/issues/1800)) ([63fb747](https://github.com/Garblesnarff/infinite-realms-production/commit/63fb747faf3b0ed3a50bee244b7662cc8b798f5d))
* **db:** backfill DDL that was never committed; replay gaps 14 -&gt; 6 ([393a1fa](https://github.com/Garblesnarff/infinite-realms-production/commit/393a1fab59773257b94bbd52802e03623aa19cb7))
* **db:** backfill three dashboard-created tables; replay gaps 6 -&gt; 3 ([1b731d8](https://github.com/Garblesnarff/infinite-realms-production/commit/1b731d82f1b3464fa9b2c8768034083282376255))
* **db:** eliminate the Drizzle insert-select bug class ([9dc0a40](https://github.com/Garblesnarff/infinite-realms-production/commit/9dc0a40e31a9142295feae3fa015ff37518fec2a))
* **db:** keep the backfill runnable without pgvector ([0ade95b](https://github.com/Garblesnarff/infinite-realms-production/commit/0ade95bfcbee101470f1d93bd448bdc948545472))
* **db:** revoke anon access on worlds ([#1762](https://github.com/Garblesnarff/infinite-realms-production/issues/1762)) ([8f585dc](https://github.com/Garblesnarff/infinite-realms-production/commit/8f585dcd4c95bc5d052abb362eda879dc869fdd4))
* **dm:** guarantee clickable action options on DM turns ([#1613](https://github.com/Garblesnarff/infinite-realms-production/issues/1613)) ([77f5666](https://github.com/Garblesnarff/infinite-realms-production/commit/77f566611232ee91b0197ebc8a93d5d878bdc68d))
* **docs:** correct nginx.conf.example root path and index.html caching ([ae9d620](https://github.com/Garblesnarff/infinite-realms-production/commit/ae9d620cfaacc15ef535ea4e1d86d55268f59da6))
* enforce structured combat transitions in agent play ([93a7b26](https://github.com/Garblesnarff/infinite-realms-production/commit/93a7b262d3c3816aa553c2115a6f89b888bb94db))
* exclude engine transcript from downstream processors ([#1811](https://github.com/Garblesnarff/infinite-realms-production/issues/1811)) ([9531d63](https://github.com/Garblesnarff/infinite-realms-production/commit/9531d635a2d9d8d3a4ba6efe706fc6ab41396736))
* **game:** resume sessions and preserve structured roll prompts ([085f611](https://github.com/Garblesnarff/infinite-realms-production/commit/085f61166f51104df23b4f13ead220042c7a52ee))
* guard campaign repo path at startup ([#1886](https://github.com/Garblesnarff/infinite-realms-production/issues/1886)) ([1b8448b](https://github.com/Garblesnarff/infinite-realms-production/commit/1b8448bca07bb4a128db5f30f635fe782a0c0ad4))
* harden Gemini fallback agent runs ([44d4eeb](https://github.com/Garblesnarff/infinite-realms-production/commit/44d4eeb7da2d66f988f5aa78a9083a0406ea9517))
* **ingest:** move embeddings to gemini-embedding-001 pinned at 768 dims ([#1815](https://github.com/Garblesnarff/infinite-realms-production/issues/1815)) ([e182fd7](https://github.com/Garblesnarff/infinite-realms-production/commit/e182fd73ed486cd9113ff5cb7b9450a84b7380db))
* **ingest:** run chunker test under bun:test ([7758b39](https://github.com/Garblesnarff/infinite-realms-production/commit/7758b39da0681242892f6abca881e7a81075b402))
* load OpenRouter pricing into usage tracking ([cf0f02d](https://github.com/Garblesnarff/infinite-realms-production/commit/cf0f02dd921be418e80be79f5a500154e12ece72))
* **lore-keeper:** pace embedding batches against the per-item Gemini quota ([#1879](https://github.com/Garblesnarff/infinite-realms-production/issues/1879)) ([f443952](https://github.com/Garblesnarff/infinite-realms-production/commit/f443952f873e54fc73710005f255d0d4272ab804))
* make git hooks work in a fresh clone ([5345259](https://github.com/Garblesnarff/infinite-realms-production/commit/5345259b830218af9adafbc39677339f91b26dc8))
* **memory:** normalize extracted memory types ([34b0471](https://github.com/Garblesnarff/infinite-realms-production/commit/34b0471e7e9546bfb18e325ec5cab32918770ea1))
* **memory:** normalize extracted memory types ([#1713](https://github.com/Garblesnarff/infinite-realms-production/issues/1713)) ([67f2124](https://github.com/Garblesnarff/infinite-realms-production/commit/67f2124cf7bf43bfbf3bc514d04bb2f5a5dad5b6))
* **memory:** preserve conjunction clause boundaries ([#1771](https://github.com/Garblesnarff/infinite-realms-production/issues/1771)) ([d53bd51](https://github.com/Garblesnarff/infinite-realms-production/commit/d53bd516150472d174aba0a4c7993a713f02606a))
* **memory:** strip action options before memory extraction ([#1675](https://github.com/Garblesnarff/infinite-realms-production/issues/1675)) ([a9a6288](https://github.com/Garblesnarff/infinite-realms-production/commit/a9a6288f33675619e6fec0981a701a11c87941c5)), closes [#1654](https://github.com/Garblesnarff/infinite-realms-production/issues/1654)
* **migrations:** replay 0005 after the combat tables it alters ([7aecd53](https://github.com/Garblesnarff/infinite-realms-production/commit/7aecd534d6c0be8e817b045fcc7f3a560ed5906a))
* number campaign sessions and silence empty reads ([#1774](https://github.com/Garblesnarff/infinite-realms-production/issues/1774)) ([3c2d396](https://github.com/Garblesnarff/infinite-realms-production/commit/3c2d396386e9dc65dd3be8c2c5e78d161cb031bc))
* **ops:** declare SLACK_ALERT_WEBHOOK_URL in pm2 config and log alerting state ([#1889](https://github.com/Garblesnarff/infinite-realms-production/issues/1889)) ([cfbbc40](https://github.com/Garblesnarff/infinite-realms-production/commit/cfbbc400b2742cbddc2fde5baab64cd592ccbfdf))
* preserve option pronoun case and strip asset tags ([#1756](https://github.com/Garblesnarff/infinite-realms-production/issues/1756)) ([fc4df52](https://github.com/Garblesnarff/infinite-realms-production/commit/fc4df520dfce464248b3380b7826a21c9498dc66))
* **prompt:** govern hostile combat entry actions ([#1793](https://github.com/Garblesnarff/infinite-realms-production/issues/1793)) ([aa38c33](https://github.com/Garblesnarff/infinite-realms-production/commit/aa38c334591272ea83fff1f05bf61c8a5e1b0228))
* **prompt:** govern out-of-combat checks ([#1770](https://github.com/Garblesnarff/infinite-realms-production/issues/1770)) ([387e602](https://github.com/Garblesnarff/infinite-realms-production/commit/387e602f87ea0eaeb6c591d4c15b51d9696eb4df))
* **prompt:** preserve DM action and HP narration rules ([#1738](https://github.com/Garblesnarff/infinite-realms-production/issues/1738)) ([917c643](https://github.com/Garblesnarff/infinite-realms-production/commit/917c643a5fb7acd7b07b08353ecc34f0d46ed166))
* remove starter campaign fallbacks without breaking custom sessions ([#1809](https://github.com/Garblesnarff/infinite-realms-production/issues/1809)) ([bdd5c54](https://github.com/Garblesnarff/infinite-realms-production/commit/bdd5c546b600dc5bb5ddce8ed36aea2517094e59))
* repair remaining embedding write paths ([#1816](https://github.com/Garblesnarff/infinite-realms-production/issues/1816)) ([#1821](https://github.com/Garblesnarff/infinite-realms-production/issues/1821)) ([601361f](https://github.com/Garblesnarff/infinite-realms-production/commit/601361f441c21c3b0b713c3383e4cdf6085aa94c))
* restore branded auth funnel ([#1761](https://github.com/Garblesnarff/infinite-realms-production/issues/1761)) ([ef0374f](https://github.com/Garblesnarff/infinite-realms-production/commit/ef0374f372de06b3441f32b3abeedfcd40601ce3))
* **rolls:** stop phantom roll requests from option text locking chat input ([#1676](https://github.com/Garblesnarff/infinite-realms-production/issues/1676)) ([7c45285](https://github.com/Garblesnarff/infinite-realms-production/commit/7c4528556b7134b57d5450a37121e755b7360b1a)), closes [#1658](https://github.com/Garblesnarff/infinite-realms-production/issues/1658)
* **security:** bound dice input parsing ([#1803](https://github.com/Garblesnarff/infinite-realms-production/issues/1803)) ([8d47c87](https://github.com/Garblesnarff/infinite-realms-production/commit/8d47c87380c84b45e81699f683516b2146f0436c))
* **security:** bound roll-request target parsing ([#1802](https://github.com/Garblesnarff/infinite-realms-production/issues/1802)) ([e383da8](https://github.com/Garblesnarff/infinite-realms-production/commit/e383da8e953b3aa4a00b73301f343124508dcbda))
* **security:** close issue 1673 ownership gaps ([#1686](https://github.com/Garblesnarff/infinite-realms-production/issues/1686)) ([a4406fd](https://github.com/Garblesnarff/infinite-realms-production/commit/a4406fd9e9cd27c652ca1116da931e37f9348daa))
* **security:** improve security-lint finding precision ([#1804](https://github.com/Garblesnarff/infinite-realms-production/issues/1804)) ([5d64394](https://github.com/Garblesnarff/infinite-realms-production/commit/5d6439465bd3e8c961e727f0c503e69b9eedc2cf))
* **security:** move combat persistence behind server routes ([#1764](https://github.com/Garblesnarff/infinite-realms-production/issues/1764)) ([de4876b](https://github.com/Garblesnarff/infinite-realms-production/commit/de4876b53e7d2a528176b96902f4517226725c22))
* **security:** route combat damage-log writes ([#1769](https://github.com/Garblesnarff/infinite-realms-production/issues/1769)) ([ac7c0cb](https://github.com/Garblesnarff/infinite-realms-production/commit/ac7c0cb32fab4f11e47b334bbb65c2a95acae757))
* **sessions:** enforce starter link list contract ([16a0eb8](https://github.com/Garblesnarff/infinite-realms-production/commit/16a0eb81cad03fe4fd2f2f5868cb760b6c476516))
* **sessions:** repair broken INSERT...SELECT in createSession (500 on new session) ([#1557](https://github.com/Garblesnarff/infinite-realms-production/issues/1557)) ([b4894d3](https://github.com/Garblesnarff/infinite-realms-production/commit/b4894d342c5361a604a151dfeeebf1b198464d6e))
* **spells:** parse 'line N feet long and M feet wide' phrasing in AoE backfill ([c5c8944](https://github.com/Garblesnarff/infinite-realms-production/commit/c5c89443c33fc94c98fd97eb0d0daad65fd9806e))
* structured combat start — logging black hole, 500 root cause, SRD combatants ([33537a6](https://github.com/Garblesnarff/infinite-realms-production/commit/33537a6723ca360fdd2dd5e8e0f73f23329397e1))
* **tactical:** reconcile server-authoritative merge with main ([26479d6](https://github.com/Garblesnarff/infinite-realms-production/commit/26479d64b6592fd9816e74d2202d4b636ad27b6d))
* **theme:** app-wide navy retheme, portal scope fixes, broken token repairs ([da0d6ed](https://github.com/Garblesnarff/infinite-realms-production/commit/da0d6edafaf38518b4a7a432005be4a689424e55))
* **ui:** detect stale SPA bundles ([#1747](https://github.com/Garblesnarff/infinite-realms-production/issues/1747)) ([#1753](https://github.com/Garblesnarff/infinite-realms-production/issues/1753)) ([de12f73](https://github.com/Garblesnarff/infinite-realms-production/commit/de12f7316760165f30d05a592ae99f36550b9538))
* **ui:** graceful starter portrait fallbacks ([#1853](https://github.com/Garblesnarff/infinite-realms-production/issues/1853)) ([9898af9](https://github.com/Garblesnarff/infinite-realms-production/commit/9898af9424fdbb8c2b37e7c4f6cd1c0613cdc483))
* **ui:** honest card artwork fallbacks + shared title overlay ([#1850](https://github.com/Garblesnarff/infinite-realms-production/issues/1850)) ([4a1190e](https://github.com/Garblesnarff/infinite-realms-production/commit/4a1190e41637ca22f860e945e84a39fa5d7729da))
* **ui:** stop roster cards claiming they are loading forever ([#1861](https://github.com/Garblesnarff/infinite-realms-production/issues/1861)) ([#1869](https://github.com/Garblesnarff/infinite-realms-production/issues/1869)) ([8cbd325](https://github.com/Garblesnarff/infinite-realms-production/commit/8cbd32516f62892cc0f16369cfcafa18858d0e6b))
* use canonical Academy starter slug ([#1773](https://github.com/Garblesnarff/infinite-realms-production/issues/1773)) ([9108580](https://github.com/Garblesnarff/infinite-realms-production/commit/91085804d9256371bc9e6e205943d863adc045b4))
* **ws:** stop double-parsing already-deserialized WebSocket frames ([#1791](https://github.com/Garblesnarff/infinite-realms-production/issues/1791)) ([6ec615f](https://github.com/Garblesnarff/infinite-realms-production/commit/6ec615f272482c07d6475cc45c9e3d4de3a47a73)), closes [#1788](https://github.com/Garblesnarff/infinite-realms-production/issues/1788)


### Performance

* **frontend:** memoize core custom hook return values for state stability ([#1569](https://github.com/Garblesnarff/infinite-realms-production/issues/1569)) ([b4d7f14](https://github.com/Garblesnarff/infinite-realms-production/commit/b4d7f14c7851a9543400832f486539219c990469))
* **hooks:** memoize core custom hook return values for state stability ([#1604](https://github.com/Garblesnarff/infinite-realms-production/issues/1604)) ([3c03d15](https://github.com/Garblesnarff/infinite-realms-production/commit/3c03d1573aa0c843888695123fcdcee7a43a8d5a))
* **hooks:** memoize useEntityLabel hook return value ([#1636](https://github.com/Garblesnarff/infinite-realms-production/issues/1636)) ([445dbe1](https://github.com/Garblesnarff/infinite-realms-production/commit/445dbe17b9d8e599999cc55a87a1e0227c689503))
* **hooks:** memoize useNPCRollQueue and useVoiceAudioControl ([#1638](https://github.com/Garblesnarff/infinite-realms-production/issues/1638)) ([ef0e610](https://github.com/Garblesnarff/infinite-realms-production/commit/ef0e6107c86d45cb21db81384a2654a3f16e0e78))
* memoize collaborative drawing hook return objects ([#1643](https://github.com/Garblesnarff/infinite-realms-production/issues/1643)) ([b109e7f](https://github.com/Garblesnarff/infinite-realms-production/commit/b109e7fe90aa71400a1889f42258fe49040e3a3c))
* memoize useUserPlan return value for state stability ([#1590](https://github.com/Garblesnarff/infinite-realms-production/issues/1590)) ([4d4d726](https://github.com/Garblesnarff/infinite-realms-production/commit/4d4d726bcaf56130fc9133398943dbaf47047ef8))
* optimize reference stability in voice custom hooks ([#1651](https://github.com/Garblesnarff/infinite-realms-production/issues/1651)) ([33274ef](https://github.com/Garblesnarff/infinite-realms-production/commit/33274efde9fd4d467eae5e4ab262b9d3afb8231e))
* stabilize hook return values and callback references ([#1605](https://github.com/Garblesnarff/infinite-realms-production/issues/1605)) ([2749365](https://github.com/Garblesnarff/infinite-realms-production/commit/2749365e2d070a392783cd5b933d43c85109bbc3))


### Refactoring

* 🔪 Scalpel: Extract abbreviations from sentence-segmenter.ts ([#1650](https://github.com/Garblesnarff/infinite-realms-production/issues/1650)) ([e2e77b5](https://github.com/Garblesnarff/infinite-realms-production/commit/e2e77b56ce81dd1637fd8d0f554027dd6806319a))
* 🔪 Scalpel: Extract Rogue sneak attack logic from classMechanics.ts ([#1669](https://github.com/Garblesnarff/infinite-realms-production/issues/1669)) ([860f8af](https://github.com/Garblesnarff/infinite-realms-production/commit/860f8af4b6b94e984996a2e1499abe7c5c00c000))
* **character:** extract basic-modifiers and roll-breakdown from characterModifiers ([#1634](https://github.com/Garblesnarff/infinite-realms-production/issues/1634)) ([9e84a92](https://github.com/Garblesnarff/infinite-realms-production/commit/9e84a9253fa6ce6bf62795093fc367ae63ea7d6d))
* **combat:** extract ActionPanel sub-sections into standalone components ([#1589](https://github.com/Garblesnarff/infinite-realms-production/issues/1589)) ([9cb06ee](https://github.com/Garblesnarff/infinite-realms-production/commit/9cb06ee1b427f2898092caa9426e8626a976b986))
* extract character description prompt templates ([#1606](https://github.com/Garblesnarff/infinite-realms-production/issues/1606)) ([4c4a79c](https://github.com/Garblesnarff/infinite-realms-production/commit/4c4a79c8391a2415d04e6ed158cf860eb2bb1663))
* extract DesktopGameSidePanel from MemoryPanel ([#1626](https://github.com/Garblesnarff/infinite-realms-production/issues/1626)) ([c1c552a](https://github.com/Garblesnarff/infinite-realms-production/commit/c1c552a0747b8656259791bc694fdb2b3ceee289))
* extract DesktopMemoryTab from MemoryPanel ([#1568](https://github.com/Garblesnarff/infinite-realms-production/issues/1568)) ([53916d4](https://github.com/Garblesnarff/infinite-realms-production/commit/53916d424d13ebd1e95b63e043eed9ee8dfd4f76))
* extract dice roll formatter from useMessageDiceRolls hook ([#1603](https://github.com/Garblesnarff/infinite-realms-production/issues/1603)) ([71ce235](https://github.com/Garblesnarff/infinite-realms-production/commit/71ce235f70ef2c181c9a1c323b51bee274c80418))
* Extract message queue hook ([#1629](https://github.com/Garblesnarff/infinite-realms-production/issues/1629)) ([3ca14be](https://github.com/Garblesnarff/infinite-realms-production/commit/3ca14be80a48f6201f5b2184829a56bd24f5a1ba))
* extract useSceneCreationWizard hook from SceneCreationWizard ([#1578](https://github.com/Garblesnarff/infinite-realms-production/issues/1578)) ([32e739b](https://github.com/Garblesnarff/infinite-realms-production/commit/32e739bd79e6142e4e25c482807962a0564e3c09))
* **hooks:** extract spell selection validation logic ([#1594](https://github.com/Garblesnarff/infinite-realms-production/issues/1594)) ([d4eb6d8](https://github.com/Garblesnarff/infinite-realms-production/commit/d4eb6d8b2c7cea0b0a8ad81da7f401d7ae335a26))
* **prompts:** extract outfit and weapons helpers from character-prompt-extractors ([#1640](https://github.com/Garblesnarff/infinite-realms-production/issues/1640)) ([f729093](https://github.com/Garblesnarff/infinite-realms-production/commit/f72909310b7a674a51559322ded35f05b71b5fc0))
* **services:** extract payload helpers from user-data-api.ts ([#1560](https://github.com/Garblesnarff/infinite-realms-production/issues/1560)) ([60b6bc3](https://github.com/Garblesnarff/infinite-realms-production/commit/60b6bc32154cf8bd6ff7cf27f07679811576bd73))
* **spells:** extract SpellFilterPanel sub-components into standalone modules ([#1596](https://github.com/Garblesnarff/infinite-realms-production/issues/1596)) ([f4afbce](https://github.com/Garblesnarff/infinite-realms-production/commit/f4afbceb927200505fa8f1bf528714d92db2dcd4))
* **utils:** extract raycasting and visibility polygon calculation from fog-calculations ([#1652](https://github.com/Garblesnarff/infinite-realms-production/issues/1652)) ([2eae7fc](https://github.com/Garblesnarff/infinite-realms-production/commit/2eae7fc5fd9309ce6200c09627a1f91b4e5925fd))
* **utils:** extract raycasting-core and raycasting-advanced ([#1660](https://github.com/Garblesnarff/infinite-realms-production/issues/1660)) ([28ea983](https://github.com/Garblesnarff/infinite-realms-production/commit/28ea983ca5ce3eee554288950080f71a0b56785e))
* **utils:** extract token filters and distance calculations from template-calculations ([#1639](https://github.com/Garblesnarff/infinite-realms-production/issues/1639)) ([6d9ac61](https://github.com/Garblesnarff/infinite-realms-production/commit/6d9ac614ed430f856232fb8b79cafb8a2321e1a4))
* **vision:** extract vision color and opacity utilities from vision-calculations.ts ([#1597](https://github.com/Garblesnarff/infinite-realms-production/issues/1597)) ([d86d2ac](https://github.com/Garblesnarff/infinite-realms-production/commit/d86d2acdb7e5628a118de229e946f84029ac9165))
* **voice:** extract dialogue parsing from VoiceDirector ([#1585](https://github.com/Garblesnarff/infinite-realms-production/issues/1585)) ([314aad4](https://github.com/Garblesnarff/infinite-realms-production/commit/314aad4c120e154ef4202ccc61a65ccca8f12cbb))


### Documentation

* **claude:** record the exFAT stat cache as the cause of failing rebases ([5f8722a](https://github.com/Garblesnarff/infinite-realms-production/commit/5f8722ab23aee323f5a327e85ed3bbf5e1de1501))
* **memory:** add Memory & Continuity v2 design + reconciled systems audit ([#1674](https://github.com/Garblesnarff/infinite-realms-production/issues/1674)) ([5d70af5](https://github.com/Garblesnarff/infinite-realms-production/commit/5d70af5540a54f78ced8ee8f9984ad1644786579))
* **memory:** RLS rides with the table it protects (v2 guardrail 7) ([#1699](https://github.com/Garblesnarff/infinite-realms-production/issues/1699)) ([142d54c](https://github.com/Garblesnarff/infinite-realms-production/commit/142d54c02b127c63ab43e6382bd2c80935ab0836))
* sweep stale architecture documentation ([#1777](https://github.com/Garblesnarff/infinite-realms-production/issues/1777)) ([1415be4](https://github.com/Garblesnarff/infinite-realms-production/commit/1415be48d02fda60457069b6950e8978b88da1bd))


### Styling

* **a11y:** align DeleteFolderDialog with WCAG 2.5.3 guidelines ([#1645](https://github.com/Garblesnarff/infinite-realms-production/issues/1645)) ([a9dee12](https://github.com/Garblesnarff/infinite-realms-production/commit/a9dee12b31fb7097eef45c7eb4a3f84ca71a2ac9))
* **a11y:** wrap disabled buttons in tooltip trigger with spans ([#1624](https://github.com/Garblesnarff/infinite-realms-production/issues/1624)) ([948ce8b](https://github.com/Garblesnarff/infinite-realms-production/commit/948ce8ba524520ebe5368464e9bfbf1c78d4b577))
* improve accessibility of BattleMapLoading component ([#1618](https://github.com/Garblesnarff/infinite-realms-production/issues/1618)) ([0475ac2](https://github.com/Garblesnarff/infinite-realms-production/commit/0475ac2444729a0443c9b05859e4b18d1a5924e7))
* **ux:** add accessible tooltips and labels to MoveCharactersDialog ([#1602](https://github.com/Garblesnarff/infinite-realms-production/issues/1602)) ([b8b31d1](https://github.com/Garblesnarff/infinite-realms-production/commit/b8b31d1e5ec68d4f130252b8f0872b4b414cbc55))


### Tests

* 🧪 Add comprehensive test coverage for combat actions detection ([#1642](https://github.com/Garblesnarff/infinite-realms-production/issues/1642)) ([6082ad9](https://github.com/Garblesnarff/infinite-realms-production/commit/6082ad99c125231d4ae0c5b2c08da1983714f40a))
* add comprehensive common environmental hazards integration tests ([#1648](https://github.com/Garblesnarff/infinite-realms-production/issues/1648)) ([18b7769](https://github.com/Garblesnarff/infinite-realms-production/commit/18b776970c790b852ad321551c350776788d1936))
* add comprehensive coverage for ensureActionOptions utility ([#1615](https://github.com/Garblesnarff/infinite-realms-production/issues/1615)) ([e911bc3](https://github.com/Garblesnarff/infinite-realms-production/commit/e911bc37924f138625096d27f23f79e312dee9eb))
* add comprehensive test suite for character proficiency calculations ([#1665](https://github.com/Garblesnarff/infinite-realms-production/issues/1665)) ([4e1cadb](https://github.com/Garblesnarff/infinite-realms-production/commit/4e1cadbc4a38814e2b9d6ebf58024874724b2f8d))
* Add comprehensive tests for basic-modifiers and roll-breakdown utilities ([#1646](https://github.com/Garblesnarff/infinite-realms-production/issues/1646)) ([5d8ebcf](https://github.com/Garblesnarff/infinite-realms-production/commit/5d8ebcfbd405c3a109f98d836e7ae7804cee7cc8))
* add comprehensive tests for useCampaignJournal and asi-levels ([#1562](https://github.com/Garblesnarff/infinite-realms-production/issues/1562)) ([bf2a0b5](https://github.com/Garblesnarff/infinite-realms-production/commit/bf2a0b5f5b89c2e09747f4f3e83bb0d697256f5e))
* add comprehensive unit tests for combat-action-executor.ts ([#1558](https://github.com/Garblesnarff/infinite-realms-production/issues/1558)) ([d104288](https://github.com/Garblesnarff/infinite-realms-production/commit/d1042880342f5df2f724c9cd5f23afb99d8d4fab))
* add comprehensive unit tests for spell validation utils ([#1625](https://github.com/Garblesnarff/infinite-realms-production/issues/1625)) ([da2a901](https://github.com/Garblesnarff/infinite-realms-production/commit/da2a901f4d29a66db21c8198ccb0ae721cdad838))
* add comprehensive unit tests for spellcasting combat actions ([#1662](https://github.com/Garblesnarff/infinite-realms-production/issues/1662)) ([aaeebe4](https://github.com/Garblesnarff/infinite-realms-production/commit/aaeebe4ee4e5c1192279537e38d9b5924eda75b2))
* add comprehensive unit tests for VoiceProfileService ([#1575](https://github.com/Garblesnarff/infinite-realms-production/issues/1575)) ([12a801d](https://github.com/Garblesnarff/infinite-realms-production/commit/12a801de3ace1505fa9c5433b178d98c5fc05ab7))
* add comprehensive unit tests for WorldBuilderRepository ([#1609](https://github.com/Garblesnarff/infinite-realms-production/issues/1609)) ([d8904c4](https://github.com/Garblesnarff/infinite-realms-production/commit/d8904c4cccaa87f0ddda5edd65b9a8b8d571d6e5))
* await spell selection validation assertions ([#1887](https://github.com/Garblesnarff/infinite-realms-production/issues/1887)) ([4f33be4](https://github.com/Garblesnarff/infinite-realms-production/commit/4f33be497b910ff2d34effb473c5810ca564baf5))
* **client:** align current Vitest API seams ([#1782](https://github.com/Garblesnarff/infinite-realms-production/issues/1782)) ([ddba648](https://github.com/Garblesnarff/infinite-realms-production/commit/ddba648b4480003e03306ce0c20cdd675026ff7d))
* **combat:** add comprehensive unit tests for combat start toasts ([#1600](https://github.com/Garblesnarff/infinite-realms-production/issues/1600)) ([a040ad3](https://github.com/Garblesnarff/infinite-realms-production/commit/a040ad3b01a616e0e743dd8142426c89b99b0e99))
* **combat:** refresh authoritative Vitest contracts ([#1781](https://github.com/Garblesnarff/infinite-realms-production/issues/1781)) ([1a820ea](https://github.com/Garblesnarff/infinite-realms-production/commit/1a820eac2b04f347334bbf649d6d16042833e366))
* fix initial greeting fallback fixtures ([#1785](https://github.com/Garblesnarff/infinite-realms-production/issues/1785)) ([7e1852b](https://github.com/Garblesnarff/infinite-realms-production/commit/7e1852b7cce4b663d8705cc9849678857d7ed7a1))
* **game:** repair DM context fixture and remove stale session suite ([5eed1d4](https://github.com/Garblesnarff/infinite-realms-production/commit/5eed1d4406db58b7961f4d08e5f8a80ae55591b8))
* **hooks:** add comprehensive unit tests for useSpellSelectionValidation ([#1598](https://github.com/Garblesnarff/infinite-realms-production/issues/1598)) ([90b10ad](https://github.com/Garblesnarff/infinite-realms-production/commit/90b10ad2ec793431de6d470f7c646833241d56dc))
* mock TacticalMapBoard in GameMainContent tests ([#1693](https://github.com/Garblesnarff/infinite-realms-production/issues/1693)) ([0075cd4](https://github.com/Garblesnarff/infinite-realms-production/commit/0075cd4e66f1cb96bd41dfe39d46f64318440f42)), closes [#1685](https://github.com/Garblesnarff/infinite-realms-production/issues/1685)
* **multiclass:** add comprehensive tests for validation and proficiencies ([#1599](https://github.com/Garblesnarff/infinite-realms-production/issues/1599)) ([ba5cd90](https://github.com/Garblesnarff/infinite-realms-production/commit/ba5cd90dd3afc483dcfd4828ae94997deac62ed0))
* **server:** align inventory Vitest fixtures with explicit writes ([#1724](https://github.com/Garblesnarff/infinite-realms-production/issues/1724)) ([65dee98](https://github.com/Garblesnarff/infinite-realms-production/commit/65dee98af8cacbe327fa790dc78dbd0bb1ca974d))
* **server:** isolate combat HTTP route dependencies ([ab47c53](https://github.com/Garblesnarff/infinite-realms-production/commit/ab47c5394e889c9ad53a10aebbd2724795545e52))
* **server:** isolate combat HTTP route dependencies ([ad4f4df](https://github.com/Garblesnarff/infinite-realms-production/commit/ad4f4dfff061ccc8afbbd86632ad1f3e8a61e1e1))
* **server:** isolate legacy Vitest suites ([#1723](https://github.com/Garblesnarff/infinite-realms-production/issues/1723)) ([c09b3dd](https://github.com/Garblesnarff/infinite-realms-production/commit/c09b3dd5927036f33bd4562579bcaa616cfef23c))
* **server:** isolate narrative fact route dependencies ([49e52eb](https://github.com/Garblesnarff/infinite-realms-production/commit/49e52eb141260c8f71026c6ae66ab36676d18cb9))
* **server:** isolate narrative HTTP auth dependencies ([6f2f06c](https://github.com/Garblesnarff/infinite-realms-production/commit/6f2f06cc483c50543fdef34a19ee40e4edc94506))
* **server:** scope process-wide mocks ([6f058f1](https://github.com/Garblesnarff/infinite-realms-production/commit/6f058f10e4c53b6884bfc1e861bcb685d2ff5b93))
* **server:** scope process-wide mocks ([#1719](https://github.com/Garblesnarff/infinite-realms-production/issues/1719)) ([0572b01](https://github.com/Garblesnarff/infinite-realms-production/commit/0572b01e03494405c55baed1c35026bff1fa542c))
* **server:** stabilize billing price fixture ([bd1a915](https://github.com/Garblesnarff/infinite-realms-production/commit/bd1a9151cecb8aef38a7d0b63f342b2cb733715b))
* **server:** stabilize billing price fixture ([688f368](https://github.com/Garblesnarff/infinite-realms-production/commit/688f368398b146b41493a47a683d9f49fa7c50fb))
* **utils:** add comprehensive tests for characterModifiers ([#1633](https://github.com/Garblesnarff/infinite-realms-production/issues/1633)) ([af6575c](https://github.com/Garblesnarff/infinite-realms-production/commit/af6575c34b0cf6638367f50b07998eac6e792b2e))
* **voice:** add comprehensive unit tests for VoiceDialogueParser ([#1608](https://github.com/Garblesnarff/infinite-realms-production/issues/1608)) ([8916b8c](https://github.com/Garblesnarff/infinite-realms-production/commit/8916b8cb97ce650b4651b93a22950c074613fd63))
* **voice:** add voice consistency service & repository tests ([#1616](https://github.com/Garblesnarff/infinite-realms-production/issues/1616)) ([12e8141](https://github.com/Garblesnarff/infinite-realms-production/commit/12e8141553f8779e9f9abe3fc3e02ed6e7db57d1))


### CI/CD

* add pre-push guard so --no-verify commits cannot escape the machine ([2ca06ce](https://github.com/Garblesnarff/infinite-realms-production/commit/2ca06ceacf19e1b08c3db339ec3bf85236051141))
* fail PRs that edit db/schema/*.ts without a migration; repair migration replay test ([9b0b486](https://github.com/Garblesnarff/infinite-realms-production/commit/9b0b4862919c12f86ad210036e3e1a36fcbddcaf))
* make server test gate execute the real Bun suite ([#1768](https://github.com/Garblesnarff/infinite-realms-production/issues/1768)) ([23dfe3b](https://github.com/Garblesnarff/infinite-realms-production/commit/23dfe3ba58111bd9ca9bb1fc677657660c4b94fc))
* move DB guards to a path-filtered workflow + husky pre-commit hook ([5879ced](https://github.com/Garblesnarff/infinite-realms-production/commit/5879ced15f8c5a5ce0965ee06ec886c0fe30f211))
* **release:** migrate to release-please PRs ([6b8f713](https://github.com/Garblesnarff/infinite-realms-production/commit/6b8f71328b74facd860140e6d0b58bcba13a18fa))

### [0.10.4](https://github.com/Garblesnarff/infinite-realms-production/compare/v0.10.3...v0.10.4) (2026-07-15)


### Bug Fixes

* **auth:** test-login always 404s in production; close bead -3n9 ([a132fd9](https://github.com/Garblesnarff/infinite-realms-production/commit/a132fd94e833fd09a272a22ba326a75690ecb658))


### Refactoring

* **auth:** centralize WorkOS token access ([2fbdca2](https://github.com/Garblesnarff/infinite-realms-production/commit/2fbdca24bfe9b911850dd58d737a30ef5a47e220))
* centralize AI response tactical transport ([4de1cbc](https://github.com/Garblesnarff/infinite-realms-production/commit/4de1cbcbcd49138f482a6d9a2398e67e6694e9a6))


### Documentation

* migration-tree consolidation plan (bead -a6f, investigated) ([effab55](https://github.com/Garblesnarff/infinite-realms-production/commit/effab5548a395c0fc32f557d397fb7451b9288dc))

### [0.10.3](https://github.com/Garblesnarff/infinite-realms-production/compare/v0.10.2...v0.10.3) (2026-07-15)


### Bug Fixes

* **auth:** exchange OAuth tokens with one-time code ([1d61f89](https://github.com/Garblesnarff/infinite-realms-production/commit/1d61f89ba22523d79286c2627d27b011ca1e7ab2))


### Tests

* **e2e:** start role auth servers ([719855e](https://github.com/Garblesnarff/infinite-realms-production/commit/719855e122ee788f1cd4ec3111867a46a0d94439))

### [0.10.2](https://github.com/Garblesnarff/infinite-realms-production/compare/v0.10.1...v0.10.2) (2026-07-15)


### Bug Fixes

* **combat:** validate combat intent requests ([8338f8c](https://github.com/Garblesnarff/infinite-realms-production/commit/8338f8c8e285fd3f6a671612d0ca4ef59413f084))
* **combat:** validate initiative route inputs ([70f0aef](https://github.com/Garblesnarff/infinite-realms-production/commit/70f0aeff99a72baace05fc62d04571e58613193e))
* **routes:** validate class feature requests ([7ae2266](https://github.com/Garblesnarff/infinite-realms-production/commit/7ae2266a7d4bd8a09d82ab1988956b1e3357cb80))
* **routes:** validate encounter telemetry inputs ([f5c81f9](https://github.com/Garblesnarff/infinite-realms-production/commit/f5c81f999f6694a7fb55115267522c1e1ca950e2))
* **routes:** validate progression requests ([494b3c8](https://github.com/Garblesnarff/infinite-realms-production/commit/494b3c810c04e2cd5573654e986abdd8241e9f35))
* **routes:** validate session route inputs ([3b5c981](https://github.com/Garblesnarff/infinite-realms-production/commit/3b5c98149a85172037793ff039e93bd9f0588f23))
* **routes:** validate spell route inputs ([a503c50](https://github.com/Garblesnarff/infinite-realms-production/commit/a503c50336f3b4c2b0f7f29e0996e1bbcaf93ce4))
* **routes:** validate spell slot inputs ([8fac970](https://github.com/Garblesnarff/infinite-realms-production/commit/8fac970053c364447250d7572118486042e1b61c))
* **security:** restore world builder ownership checks ([d727ee5](https://github.com/Garblesnarff/infinite-realms-production/commit/d727ee504d576482bfb59a607c517ab2bdb6081d))
* **server:** unauthenticated /v1/internal/release-post - scope all middleware hooks ([77906cc](https://github.com/Garblesnarff/infinite-realms-production/commit/77906cc20818800711a9fed3684a9f7e91805a65))


### Tests

* **server:** add API-boundary tests for auth, Stripe webhook, route smoke ([55d88d8](https://github.com/Garblesnarff/infinite-realms-production/commit/55d88d87f953a846ef5db45e928919cd8b929fd3))

### 0.10.1 (2026-07-15)


### Features

* 🧪 add unit tests for slug, validation, network, and analytics utils ([#519](https://github.com/Garblesnarff/infinite-realms-production/issues/519)) ([8ccc162](https://github.com/Garblesnarff/infinite-realms-production/commit/8ccc162bb68523b7ade65f844757a120cacf9be7))
* accessible selectable spell cards with keyboard nav ([b00b9bb](https://github.com/Garblesnarff/infinite-realms-production/commit/b00b9bb1217c75b409b2474c6a7393188255354c))
* Add /explore gallery page for browsing starter campaigns ([1e8d082](https://github.com/Garblesnarff/infinite-realms-production/commit/1e8d0822767330cbefb2fe7088028436360ad105))
* add Academy of Arcane Gastronomy campaign name mapping ([24561b0](https://github.com/Garblesnarff/infinite-realms-production/commit/24561b037cc40038f31503192f1e12068f059610))
* Add Bun/Elysia server migration ([985eef1](https://github.com/Garblesnarff/infinite-realms-production/commit/985eef1fea57c10f2a8a38714999802b34b1bb76))
* Add daily blog digest system for automated content generation ([a342b95](https://github.com/Garblesnarff/infinite-realms-production/commit/a342b959717f87a903ebd5afb385c9f2b2d5ef5c))
* add dedicated memory extraction endpoint with free model ([2ecf137](https://github.com/Garblesnarff/infinite-realms-production/commit/2ecf1377b63cc1011a665f96e09ab4a50f85aa85))
* add hero images for blog posts and document fal.ai workflow ([6315a78](https://github.com/Garblesnarff/infinite-realms-production/commit/6315a78fef709b50841dd5e03c539b009ad10696))
* Add llms.txt support for AI agent documentation discovery ([6ab7df8](https://github.com/Garblesnarff/infinite-realms-production/commit/6ab7df8d4b10d0d175d4f8af0891cd103e7b2adb))
* Add Lore Keeper system for starter campaigns ([5cf333b](https://github.com/Garblesnarff/infinite-realms-production/commit/5cf333b1d673d15f02e1c20884235ec4cc421888))
* add resilient LLM provider health checks ([7949bf2](https://github.com/Garblesnarff/infinite-realms-production/commit/7949bf259203e21759c34baf740b54af5bcc3ef6))
* Add robust error handling to lore-keeper-ingest ([71c8141](https://github.com/Garblesnarff/infinite-realms-production/commit/71c814158029a495586b843783a88ef9ed086960))
* add semantic versioning and automated release blog posts ([4ae2dd4](https://github.com/Garblesnarff/infinite-realms-production/commit/4ae2dd48e1842197dbe9e2fdbb8e160d8c1202c7))
* add Session Chronicle System for acquisition-driven social sharing ([6b52cbd](https://github.com/Garblesnarff/infinite-realms-production/commit/6b52cbdd62078e7d10284ac679ad0738130506f4))
* Add SSR landing pages for SEO/AEO optimization ([013f68b](https://github.com/Garblesnarff/infinite-realms-production/commit/013f68b3fa398c2044f095d3e85ffdcd7261e664))
* Add starter campaigns UI for launch page ([3e4df10](https://github.com/Garblesnarff/infinite-realms-production/commit/3e4df100f68623c530332d7f655d3a09d1497a7b))
* add starter character selection and campaign asset contexts ([ea32754](https://github.com/Garblesnarff/infinite-realms-production/commit/ea32754c184e49a6e5f372b47b33127cd88e40b8))
* Add Stripe subscription integration ([8fb3ba6](https://github.com/Garblesnarff/infinite-realms-production/commit/8fb3ba639d49152e7ed6ba80031c27f138c25169))
* add tactical combat map CM-2 foundations ([d11a4ce](https://github.com/Garblesnarff/infinite-realms-production/commit/d11a4ce2cff85cea58419d94033e0d2368eccf7c))
* add tests for raycasting utils and fix intersection bug ([#510](https://github.com/Garblesnarff/infinite-realms-production/issues/510)) ([4185246](https://github.com/Garblesnarff/infinite-realms-production/commit/4185246b17d4c8ec44230f41572fcde9a80e5d24))
* Add verbalized sampling to opening messages and enhance campaign name diversity ([05cad86](https://github.com/Garblesnarff/infinite-realms-production/commit/05cad868f21f8e98c6cffeedded78b42cdde68e2)), closes [#ds0](https://github.com/Garblesnarff/infinite-realms-production/issues/ds0)
* Aggressively eliminate LLM name patterns - force wild card tier only ([c935a24](https://github.com/Garblesnarff/infinite-realms-production/commit/c935a240af851aba8d2c4dd07d205a9b23760436)), closes [#8l6](https://github.com/Garblesnarff/infinite-realms-production/issues/8l6)
* **ai:** D&D 5E combat rules reference for AI DM prompts ([1d74db6](https://github.com/Garblesnarff/infinite-realms-production/commit/1d74db60cb63541a554948e4b3293b49116ff5a0))
* **ai:** record provider tokens and daily cost ([1c186da](https://github.com/Garblesnarff/infinite-realms-production/commit/1c186dae4a3f6cb540b39ceed1389ddba9f76efb))
* Apply PR [#12](https://github.com/Garblesnarff/infinite-realms-production/issues/12) and PR [#13](https://github.com/Garblesnarff/infinite-realms-production/issues/13) changes manually ([763f1ab](https://github.com/Garblesnarff/infinite-realms-production/commit/763f1abfc34025994bbfc47ad026f0dd73d18ba7))
* **assets:** display generated images in asset gallery ([30bd593](https://github.com/Garblesnarff/infinite-realms-production/commit/30bd59321e18ec6e75dd27095ad4954e56fd904a))
* **auth:** Add test authentication endpoint for automated testing ([08e434a](https://github.com/Garblesnarff/infinite-realms-production/commit/08e434a2cc199efc072ae490662323b95d46574c))
* **bead-zpr:** Switch campaign description to local service with verbalized sampling ([0da6f3e](https://github.com/Garblesnarff/infinite-realms-production/commit/0da6f3e2ae4c8e587e318e419666b2474b66bebb))
* **blog:** add 15 SEO landing pages for P1 marketing boost ([3f72a25](https://github.com/Garblesnarff/infinite-realms-production/commit/3f72a2534df38e8c3af87b3f3199b472a359a136))
* Campaign creation and character wizard improvements ([10f657c](https://github.com/Garblesnarff/infinite-realms-production/commit/10f657cfe985af6792ab1968ceb782ec0d75afdb))
* **campaign:** add milestone leveling mode ([6bc69e3](https://github.com/Garblesnarff/infinite-realms-production/commit/6bc69e30fabf1ca234214185cf527b5461263e4f))
* **character:** persist and select expertise ([07e2024](https://github.com/Garblesnarff/infinite-realms-production/commit/07e202457d345993c5a8b988d3a04a1f6d1449bd))
* **character:** select SRD starting equipment choices ([53441dc](https://github.com/Garblesnarff/infinite-realms-production/commit/53441dcfc8e3e0baff946a81f8d61f87a8d8ca9a))
* combat UI accessibility improvements ([f6e7210](https://github.com/Garblesnarff/infinite-realms-production/commit/f6e72103ff9e94a7f464a39bbbab22dce69a8864))
* **combat:** Critical rules validation layer (Hybrid Light) ([07c6b08](https://github.com/Garblesnarff/infinite-realms-production/commit/07c6b08787f6354629321fd37643877be5c1ebf9))
* **combat:** D&D 5E action economy service ([966c74f](https://github.com/Garblesnarff/infinite-realms-production/commit/966c74ffed8f88729a11427ab91a9089957202e7))
* **combat:** D&D 5E auto-crit for paralyzed/unconscious targets ([c56d6ca](https://github.com/Garblesnarff/infinite-realms-production/commit/c56d6cae20cb471f0ff5cbc6120cf4cad11eb621))
* **combat:** D&D 5E conditions mechanical enforcement utilities ([0746377](https://github.com/Garblesnarff/infinite-realms-production/commit/0746377656950482cf47e06cf9a12c5f4edca883))
* **combat:** D&D 5E exhaustion system with 6 cumulative levels ([e10115f](https://github.com/Garblesnarff/infinite-realms-production/commit/e10115f0a2b517794ad1b5ec98b5478ddd31bf88))
* **combat:** enforce authoritative server mechanics ([29afe0b](https://github.com/Garblesnarff/infinite-realms-production/commit/29afe0bf1664c70c01f650f1698e928ac4f51641))
* **combat:** hydrate UI from authoritative state ([c4effbd](https://github.com/Garblesnarff/infinite-realms-production/commit/c4effbdacfd127e7bfdb5f032ff233b9749cecbb))
* **combat:** Implement D&D 5E damage at 0 HP death save failures ([4933d4d](https://github.com/Garblesnarff/infinite-realms-production/commit/4933d4d8e6242163509242b730306925b25d29bc))
* **combat:** resolve grapple and shove checks ([3fe20c0](https://github.com/Garblesnarff/infinite-realms-production/commit/3fe20c045f40e297b03f34136a6ba72bd091b164))
* **combat:** use SRD monster stats and multiattack ([d1090d1](https://github.com/Garblesnarff/infinite-realms-production/commit/d1090d1e4148cbdb2b43494e79326ac6b16b528a))
* complete secured frontend data migration ([46ee750](https://github.com/Garblesnarff/infinite-realms-production/commit/46ee750d0a33dbb774d07dbdc91d2dde9ee72015))
* **content:** import Wave 4 SRD datasets ([c500e3d](https://github.com/Garblesnarff/infinite-realms-production/commit/c500e3d04ae1e1ae99e0522e429c0f8aff0f1bc5))
* **database:** Optimize getCampaignOverview query to reduce over-fetching ([1ca56ba](https://github.com/Garblesnarff/infinite-realms-production/commit/1ca56ba9b115aaf29487e66ca7ffbfc645531e0d))
* **database:** Optimize getPartyDetails to fix N+1 query ([3fa1e6a](https://github.com/Garblesnarff/infinite-realms-production/commit/3fa1e6abacab299038416d59a5e9bc4bde0e807e))
* **database:** Optimize getStarterParties query to reduce over-fetching ([f42bfd9](https://github.com/Garblesnarff/infinite-realms-production/commit/f42bfd9693aa44bc05e9d57a365c6ddf5c6aed1e))
* **dice:** real 3D physics dice (cannon-es), engine-authoritative, no snap/pull ([59870ee](https://github.com/Garblesnarff/infinite-realms-production/commit/59870ee195e6dbccf7703b2a726bf7147ee12687))
* enable minimal CI (build + vitest-no-new-failures gate) ([#1363](https://github.com/Garblesnarff/infinite-realms-production/issues/1363)) ([28f2b1b](https://github.com/Garblesnarff/infinite-realms-production/commit/28f2b1bb2f4b9843fa73b187229e1c82e2266c1b))
* Enable promo codes on Stripe checkout ([438b9d5](https://github.com/Garblesnarff/infinite-realms-production/commit/438b9d5d72ea376ff12685737bf7ad117e30f1f5))
* enhance InspirationTracker accessibility and UX ([#488](https://github.com/Garblesnarff/infinite-realms-production/issues/488)) ([c505c49](https://github.com/Garblesnarff/infinite-realms-production/commit/c505c496d923711a0d3f6beec21acacb38b781d5))
* extend navy/gold tabletop design system to all authenticated /app screens ([#1288](https://github.com/Garblesnarff/infinite-realms-production/issues/1288)) ([b7a08c5](https://github.com/Garblesnarff/infinite-realms-production/commit/b7a08c56adb1c981f15c3551759d15cb008b4314))
* **game-ui:** navy+gold 3-column game session layout (mockup match) ([5786e2a](https://github.com/Garblesnarff/infinite-realms-production/commit/5786e2a57feabd16f7ce5b67edca506ca8b42b5f))
* **game:** migrate live center stage to navy overhaul ([e9e2569](https://github.com/Garblesnarff/infinite-realms-production/commit/e9e25696349e31aba91fbf64af6f601179663acf))
* **game:** reskin memory and combat sheets ([5d5abd2](https://github.com/Garblesnarff/infinite-realms-production/commit/5d5abd23048588719dd22acbff01e62a428807b9))
* **images:** use campaign assets as reference images in scene generation ([399ca3c](https://github.com/Garblesnarff/infinite-realms-production/commit/399ca3c5b28c8fee193ebf436a0fa65e6eed6be8))
* implement NPC auto-roller system with "Behind the DM Screen" popup ([8735c30](https://github.com/Garblesnarff/infinite-realms-production/commit/8735c3009f869992f2faa77273f21abece467253)), closes [#33-40](https://github.com/Garblesnarff/infinite-realms-production/issues/33-40)
* implement Phase 2 HP tracking with real-time display + CR balancing ([240fa29](https://github.com/Garblesnarff/infinite-realms-production/commit/240fa29251691757fdf1f2bf682bcd1356ea8322)), closes [#b36](https://github.com/Garblesnarff/infinite-realms-production/issues/b36)
* implement verbalized sampling for maximum creative diversity ([7d11016](https://github.com/Garblesnarff/infinite-realms-production/commit/7d1101690067376e0b7c4e215b1664c84761ea8e))
* improve accessibility and UX in SimpleGameChatWithVoice ([b6c5980](https://github.com/Garblesnarff/infinite-realms-production/commit/b6c59800afae5ec1c507275e8b86ed83421c1dd4))
* Improve session management UX and extend session expiry ([deee6fa](https://github.com/Garblesnarff/infinite-realms-production/commit/deee6fa970465ac558435d069d04d1767a086124))
* improve starter character accessibility ([#830](https://github.com/Garblesnarff/infinite-realms-production/issues/830)) ([dca840c](https://github.com/Garblesnarff/infinite-realms-production/commit/dca840ce9494421346a1a1e6fefcc64724859574))
* improve user search keyboard navigation and accessibility in share dialog ([#948](https://github.com/Garblesnarff/infinite-realms-production/issues/948)) ([3ac2eb7](https://github.com/Garblesnarff/infinite-realms-production/commit/3ac2eb78091fdb1a6c2df45c2a409bc043718234))
* Inject starter campaign lore into AI prompts ([7c6971f](https://github.com/Garblesnarff/infinite-realms-production/commit/7c6971fb379f1052a0f214f313e61f438430a75a))
* inject tactical context into DM turns ([10704ed](https://github.com/Garblesnarff/infinite-realms-production/commit/10704ed01a02848aed893c078b4114b063ec1426))
* instrument billing funnel with analytics events ([#686](https://github.com/Garblesnarff/infinite-realms-production/issues/686)) ([b443272](https://github.com/Garblesnarff/infinite-realms-production/commit/b4432720ed54578b20b9a76ca72fd9e0600d88e6)), closes [#342](https://github.com/Garblesnarff/infinite-realms-production/issues/342) [#342](https://github.com/Garblesnarff/infinite-realms-production/issues/342)
* Integrate starter campaign lore with Franz DM agent ([4943f99](https://github.com/Garblesnarff/infinite-realms-production/commit/4943f9946dbf28939ca41481988e16b5bc02b87b))
* Phase 3 turn flow - prevent multiple player turns in combat ([1756a02](https://github.com/Garblesnarff/infinite-realms-production/commit/1756a028c96a1a177ce0e2350c29bd3801db260d)), closes [#9](https://github.com/Garblesnarff/infinite-realms-production/issues/9)
* Phase 4 edge cases - multiple enemies, death saves, healing, temp HP ([914fb13](https://github.com/Garblesnarff/infinite-realms-production/commit/914fb13766d15b307a627bdf2c01133ebf62bb03)), closes [#o7](https://github.com/Garblesnarff/infinite-realms-production/issues/o7) [#ci5](https://github.com/Garblesnarff/infinite-realms-production/issues/ci5) [#0](https://github.com/Garblesnarff/infinite-realms-production/issues/0)
* Phase 5 - Add core D&D 5e combat mechanics ([ede622f](https://github.com/Garblesnarff/infinite-realms-production/commit/ede622f6dff3af7046b659a70079e9ef2e9227b5)), closes [#1](https://github.com/Garblesnarff/infinite-realms-production/issues/1) [#ax4](https://github.com/Garblesnarff/infinite-realms-production/issues/ax4) [#8](https://github.com/Garblesnarff/infinite-realms-production/issues/8) [#3](https://github.com/Garblesnarff/infinite-realms-production/issues/3)
* polish equipment aliases and trinkets ([2ceaf02](https://github.com/Garblesnarff/infinite-realms-production/commit/2ceaf02f7328936286f84115e359ea94ebcf62e3))
* preserve DM scene specs in chat responses ([35f077a](https://github.com/Garblesnarff/infinite-realms-production/commit/35f077a7d22e655e8da9901258eee4dc4ff1d083))
* production deployment fixes and improvements ([89d1d67](https://github.com/Garblesnarff/infinite-realms-production/commit/89d1d67ab39dfb93f198d076ab9437b039759ff9))
* Replace OpenAI/Anthropic with Gemini/OpenRouter ([4ff322b](https://github.com/Garblesnarff/infinite-realms-production/commit/4ff322b44908093c94ae37c5178026a67d201641)), closes [#24](https://github.com/Garblesnarff/infinite-realms-production/issues/24) [#55](https://github.com/Garblesnarff/infinite-realms-production/issues/55)
* **rest:** wire persistent 5e recovery flow ([77df388](https://github.com/Garblesnarff/infinite-realms-production/commit/77df388b0f02c738644be773662b4247d32211ce))
* **rules:** wire multiclass advancement ([c2f3283](https://github.com/Garblesnarff/infinite-realms-production/commit/c2f3283137dce3e29086ceb8255e85ea2d57b4b0))
* **rules:** wire weapons items and class progression ([a5ba9a9](https://github.com/Garblesnarff/infinite-realms-production/commit/a5ba9a998e3844605cc95e30ccdf19006c5e9955))
* **schema:** Add Foundry VTT integration schema modules ([39bae88](https://github.com/Garblesnarff/infinite-realms-production/commit/39bae88a1195fdc0333f87b1a7168e9ad26e3150))
* start and end tactical maps from DM transitions ([dbdb05c](https://github.com/Garblesnarff/infinite-realms-production/commit/dbdb05c9b115fdd751f6fda6c581853dc253cdab))
* Switch campaign generation to local service with verbalized sampling ([dccf9c6](https://github.com/Garblesnarff/infinite-realms-production/commit/dccf9c68da8b73f0673d65e5d0f5e14cd70865e4)), closes [#8l6](https://github.com/Garblesnarff/infinite-realms-production/issues/8l6)
* Switch Lore Keeper embeddings from OpenAI to Gemini ([bc2cac0](https://github.com/Garblesnarff/infinite-realms-production/commit/bc2cac0a85aa15b7024ef1c64099696abbaa1782))
* **tactical:** add authoritative line of sight check ([45feb64](https://github.com/Garblesnarff/infinite-realms-production/commit/45feb6476ec9757dd4d182dca458a636fe3f0699))
* **tactical:** add deterministic maps and DM context ([c375286](https://github.com/Garblesnarff/infinite-realms-production/commit/c375286847f66ae1cd5ff86ef774a4fedd977e95))
* **tactical:** add retina canvas map renderer ([6696977](https://github.com/Garblesnarff/infinite-realms-production/commit/669697735782f1525913c3cea600f27d454e592b))
* **tactical:** add server-authoritative grid engine ([ccac42f](https://github.com/Garblesnarff/infinite-realms-production/commit/ccac42fc9ab089852f713472e9a4c37eba0887a4))
* **tactical:** integrate synchronized combat board ([211e9f5](https://github.com/Garblesnarff/infinite-realms-production/commit/211e9f5f40bd9819436866315289a3247ce7cd4d))
* **test:** add unit tests for DiceEngine service ([#644](https://github.com/Garblesnarff/infinite-realms-production/issues/644)) ([a4f3cac](https://github.com/Garblesnarff/infinite-realms-production/commit/a4f3cac203d037435f125810c39efc7cd223fad2))
* **testing:** add comprehensive tests for web-vitals utility ([#1193](https://github.com/Garblesnarff/infinite-realms-production/issues/1193)) ([28f58c1](https://github.com/Garblesnarff/infinite-realms-production/commit/28f58c1025eef91fcd51f4914d2539c4269a29bb))
* **tests:** add unit tests for CombatResponseValidator ([#413](https://github.com/Garblesnarff/infinite-realms-production/issues/413)) ([c2318d2](https://github.com/Garblesnarff/infinite-realms-production/commit/c2318d2dbfcc95411f04a17da748ac198c838766))
* **ui:** improve ability score selection UX and accessibility ([#540](https://github.com/Garblesnarff/infinite-realms-production/issues/540)) ([7e7da96](https://github.com/Garblesnarff/infinite-realms-production/commit/7e7da96f63b6c13c29f330e1d2c1915b652c79dc))
* **ui:** improve HPTracker accessibility and health display ([#660](https://github.com/Garblesnarff/infinite-realms-production/issues/660)) ([513b8d9](https://github.com/Garblesnarff/infinite-realms-production/commit/513b8d9baf422ee776b2531ffc6bf2ba9470efaf))
* **ui:** improve scene management tooltip accessibility ([#1146](https://github.com/Garblesnarff/infinite-realms-production/issues/1146)) ([a77d210](https://github.com/Garblesnarff/infinite-realms-production/commit/a77d2100f8328d40a8089c07ba1cb3952fd49ad4))
* **ui:** navy+gold theme overhaul (app-wide) ([#1275](https://github.com/Garblesnarff/infinite-realms-production/issues/1275)) ([c79f3ce](https://github.com/Garblesnarff/infinite-realms-production/commit/c79f3ce3e07afadafd0351fc73f26aac972d718a))
* **ui:** standardize sidebar z-index and enhance accessibility ([#327](https://github.com/Garblesnarff/infinite-realms-production/issues/327)) ([895b283](https://github.com/Garblesnarff/infinite-realms-production/commit/895b28337cf8e447ceba058f173fb98920665c9d))
* use dynamic aria-label and title in CampaignHeader ([#818](https://github.com/Garblesnarff/infinite-realms-production/issues/818)) ([b7834d1](https://github.com/Garblesnarff/infinite-realms-production/commit/b7834d1ac5e93074808fc34d6e8268d952eb74fb))
* Use silhouette for characters without avatars in scene images ([6f4f3f5](https://github.com/Garblesnarff/infinite-realms-production/commit/6f4f3f5511fc44ee41df5268f996e6e1c1b2e7a3))
* use SRD sizes for tactical participants ([8237363](https://github.com/Garblesnarff/infinite-realms-production/commit/82373635a8d6d524c9ff5bbc81f14502925dc0d2))
* wire tactical maps into combat lifecycle ([1efaf9e](https://github.com/Garblesnarff/infinite-realms-production/commit/1efaf9ebbeb7c2579ab7109c7c095ab35b26cbb2))


### Bug Fixes

* accept malformed roll request purpose ([ba027d2](https://github.com/Garblesnarff/infinite-realms-production/commit/ba027d2ed6e1f8b27b9410ac04b848f672448d65))
* Add aggressive deduplication for AI opening messages ([39cefb8](https://github.com/Garblesnarff/infinite-realms-production/commit/39cefb8c1ae67023c2b4b44b19081bef2d20740b))
* Add fallback to infer starter campaign from campaign name ([1abb762](https://github.com/Garblesnarff/infinite-realms-production/commit/1abb7623efef72f367d3afb864aa3209ff2489eb))
* Add generated_by column to locations and improve auth logging ([96050f7](https://github.com/Garblesnarff/infinite-realms-production/commit/96050f792d251f241fead71626f2c93585967d3a))
* Add missing database columns for AI DM chat ([f1f78ec](https://github.com/Garblesnarff/infinite-realms-production/commit/f1f78ec93ca488b3ec47618da00453f691ab7421))
* add missing inventory_items and consumable_usage_log tables ([65fbbd7](https://github.com/Garblesnarff/infinite-realms-production/commit/65fbbd7be18dc51922a5e347fe3330abb4f2280d))
* Add model field to Gemini batch embedding requests ([dba67a4](https://github.com/Garblesnarff/infinite-realms-production/commit/dba67a4ec86cb25aa2cdb1d66ffab59dca00e865))
* add tests and fix bugs in diceUtils.ts ([9651eb9](https://github.com/Garblesnarff/infinite-realms-production/commit/9651eb92f851714f3e8e4b3a68e748d560fa6a19))
* add tests and fix DM narration gating in useCombatAIIntegration ([380752a](https://github.com/Garblesnarff/infinite-realms-production/commit/380752a8dc11bed0951bdef8c5213915a2cef17a))
* **advancement:** prompt for expertise choices ([3b81b43](https://github.com/Garblesnarff/infinite-realms-production/commit/3b81b431c8e41585de64fe6a7b6c96488fb341c1))
* **ai:** cover blog and chronicle calls with circuit breakers ([69c2712](https://github.com/Garblesnarff/infinite-realms-production/commit/69c27128b4df96965d9c867c1a66c457263640b4))
* **ai:** preserve image attachment retries in canonical client ([e508ba0](https://github.com/Garblesnarff/infinite-realms-production/commit/e508ba09def4aa84cd1d62964592d64c6f41a14a))
* **ai:** replace retired and costly model defaults ([4644295](https://github.com/Garblesnarff/infinite-realms-production/commit/4644295675fe4fb458c9a10c77f7c27dab1c8726))
* **ai:** resolve message duplication with XML tag extraction ([9640776](https://github.com/Garblesnarff/infinite-realms-production/commit/9640776675781eb972841cafd44b807008dcd32c))
* **ai:** Revert broken XML extraction, add output rule for verbalized sampling ([1024f71](https://github.com/Garblesnarff/infinite-realms-production/commit/1024f7184c6962c7684bae675ab71778549c907c))
* align character_equipment schema with db/schema/inventory.ts ([01fe399](https://github.com/Garblesnarff/infinite-realms-production/commit/01fe3992db79a7bdcb3ed274c9270068c53233d6))
* Apply formatNarrative deduplication to DMChatBubble ([5012127](https://github.com/Garblesnarff/infinite-realms-production/commit/5012127231aa3e2a8abb8a7b42f3f7211bcfeedc))
* Apply verbalized sampling to ACTUAL code path (narration-service-impl) ([983f8fa](https://github.com/Garblesnarff/infinite-realms-production/commit/983f8faf6456857278e20314aed5265c38041880))
* Apply verbalized sampling to CORRECT file (ai-service.ts) ([34301f1](https://github.com/Garblesnarff/infinite-realms-production/commit/34301f1f2a2169f76763b4a37b7c36ea9f2cb497))
* Asset modal z-index - ensure lightbox appears above game UI ([0989409](https://github.com/Garblesnarff/infinite-realms-production/commit/0989409cde1fb4c97102919c854ae6cbf7a26585))
* **asset-tags:** only match full asset names to avoid false positives ([82c0bda](https://github.com/Garblesnarff/infinite-realms-production/commit/82c0bda011bc1f2ab506224f95c607ab467a83fd))
* **assets:** fix pre-existing lint errors in useImageGeneration.ts ([92a4fb4](https://github.com/Garblesnarff/infinite-realms-production/commit/92a4fb47cef22a8deaf6f519cb8d7bbdecc38150)), closes [#339](https://github.com/Garblesnarff/infinite-realms-production/issues/339)
* **assets:** handle Unicode quotes in asset key generation ([b86eede](https://github.com/Garblesnarff/infinite-realms-production/commit/b86eede2b4ef4355f78713e17156b88f39ca314d))
* **assets:** normalize quoted ASSET tag keys to prevent raw token leakage ([ea9c504](https://github.com/Garblesnarff/infinite-realms-production/commit/ea9c5043790c267441817779ef624a255b9ec6e4))
* **auth:** Add missing auth routes to Bun/Elysia server ([1842f3a](https://github.com/Garblesnarff/infinite-realms-production/commit/1842f3a526a405905b0500cbf57294db4026650c))
* backfill drizzle usage schema ([a976d99](https://github.com/Garblesnarff/infinite-realms-production/commit/a976d99ae09f8daf248b62e1ab8496026301dc84))
* character loader security, XML memory extraction, and stale log messages ([626531c](https://github.com/Garblesnarff/infinite-realms-production/commit/626531c69b8d9fd87c99a21dcd1843635aaf6907))
* check ANY contiguous subsequence for paragraph deduplication ([c5cffcb](https://github.com/Garblesnarff/infinite-realms-production/commit/c5cffcbc41e3bf54454c97f470893a54c4045b78))
* **checks:** apply tool proficiency and expertise ([d25ec04](https://github.com/Garblesnarff/infinite-realms-production/commit/d25ec04bc8d4e3317d4febd58699ab9cb0aa7132))
* clean up opening scene display pipeline ([68e55fb](https://github.com/Garblesnarff/infinite-realms-production/commit/68e55fbdc3fb15769d88beac8678e1bed9f23e48))
* clean up option button text formatting ([49eb942](https://github.com/Garblesnarff/infinite-realms-production/commit/49eb942a630ee065f2129e7465d58db5f375d4aa))
* **combat:** apply active magic item bonuses ([8098939](https://github.com/Garblesnarff/infinite-realms-production/commit/80989394a68d8ea7b464edc2c01646debd286a7a))
* **combat:** generate combat-specific options for /dm/options endpoint ([d263080](https://github.com/Garblesnarff/infinite-realms-production/commit/d263080b1c53d9573792467b8c1600d25e949980))
* **combat:** Initiative roll UI and HP tracking bugs ([650de51](https://github.com/Garblesnarff/infinite-realms-production/commit/650de51a777508b57a252ce12e6c20f393c6e43e))
* **combat:** Update combat persistence to match database schema ([cb459b9](https://github.com/Garblesnarff/infinite-realms-production/commit/cb459b91394a0517d8d50cc14b235946929d3224))
* consolidate rest state on server response ([ac87cd9](https://github.com/Garblesnarff/infinite-realms-production/commit/ac87cd9995eed8d4905630e6ef365accf7b7fb81))
* convert Tailwind semantic color tokens from hsl() to valid rgb()/var() ([#1364](https://github.com/Garblesnarff/infinite-realms-production/issues/1364)) ([3e41e24](https://github.com/Garblesnarff/infinite-realms-production/commit/3e41e248a75346ebde0e877be2bbcb2ab62f84c4))
* correct deduplication algorithm for accumulated paragraphs ([3083afc](https://github.com/Garblesnarff/infinite-realms-production/commit/3083afc3df62624f0c8897b850c78e6a6b9f522f))
* correct import paths in combat helpers to resolve server crash ([43caf6b](https://github.com/Garblesnarff/infinite-realms-production/commit/43caf6b7ec11fe8aded6a56c20e2956aa43d5b2b))
* correct two type errors introduced by prior as-any cleanup PRs ([#1300](https://github.com/Garblesnarff/infinite-realms-production/issues/1300)) ([139b8d4](https://github.com/Garblesnarff/infinite-realms-production/commit/139b8d42134a5fda0913f7be2d35a87c21d3e05c))
* **database:** add server-routed campaign columns ([e352b5b](https://github.com/Garblesnarff/infinite-realms-production/commit/e352b5b9696c3492795bcfe339a96708ae0a8060))
* **database:** add server-routed character columns ([7b108c3](https://github.com/Garblesnarff/infinite-realms-production/commit/7b108c33d143b0c1fa4b31a9cb7b064bfb3b0e48))
* **database:** add server-routed memory columns ([c852e21](https://github.com/Garblesnarff/infinite-realms-production/commit/c852e2100487af6a4653bc8d0e84e9f85160f0a9))
* **database:** tolerate absent legacy message table ([c3da25d](https://github.com/Garblesnarff/infinite-realms-production/commit/c3da25dd37ee333a7c7ebdf93dadee427e0116c8))
* Deduplicate accumulated paragraphs in AI DM messages ([253c4d9](https://github.com/Garblesnarff/infinite-realms-production/commit/253c4d9202d954ebc793bcb7a731996fc6719163))
* **dice:** Preserve dice roll context through message flow ([b4b521a](https://github.com/Garblesnarff/infinite-realms-production/commit/b4b521a4edb0c18228c47c5b51211b850de2d95e))
* **dice:** reduce MAX_CONTEXT_LOSS_RECOVERIES from 2 to 1 ([bf05b57](https://github.com/Garblesnarff/infinite-realms-production/commit/bf05b57c87d91a1f7698acad954eb5bc7d1d8326))
* eliminate orphan * artifacts in DM narrative rendering ([2e685ab](https://github.com/Garblesnarff/infinite-realms-production/commit/2e685ab1a75ece467ae7277f552a820d5dacbd06))
* enforce structured DM output integrity ([6aa91a4](https://github.com/Garblesnarff/infinite-realms-production/commit/6aa91a47dba72a0b9a0c750afa7ba6a6f06a7e9d))
* ensure roll-request truncation ends at sentence boundary ([824b887](https://github.com/Garblesnarff/infinite-realms-production/commit/824b8879062b8ea33a4d99f87dc3cbcce45651e9))
* Escape all backticks in template literals for build compatibility ([4e80ccf](https://github.com/Garblesnarff/infinite-realms-production/commit/4e80ccff17aea307a5b2db3b1cc059934fd9a2de))
* Escape all code block markers in template literals ([a625a97](https://github.com/Garblesnarff/infinite-realms-production/commit/a625a97a32f476556981bb0cd4d7cb60c7dee831))
* Escape backticks in code blocks within template literals ([6deb453](https://github.com/Garblesnarff/infinite-realms-production/commit/6deb453105d90cebe95c7f1c4b831f43dc513072))
* **formatNarrative:** Catch duplicate paragraphs at ANY position, not just from start ([eac303f](https://github.com/Garblesnarff/infinite-realms-production/commit/eac303f27132c01cf62423829b657d3c46001dc0))
* **formatNarrative:** Fix deduplication to catch AI-accumulated paragraphs ([293900e](https://github.com/Garblesnarff/infinite-realms-production/commit/293900e1fe06ee8cea996f2522a20a3c8182c6fe))
* **game-ui:** 2-column grid for AI action option cards ([af5d911](https://github.com/Garblesnarff/infinite-realms-production/commit/af5d911d7c26bd2eebf1d15a86c527d5f02dde0c))
* **game-ui:** action options span full chat width, equal-height cells ([dea1014](https://github.com/Garblesnarff/infinite-realms-production/commit/dea1014f2f5fe2ec787f94c214b65f79708ee447))
* **game-ui:** navy center column to match overhaul (remove purple banner) ([c0a736a](https://github.com/Garblesnarff/infinite-realms-production/commit/c0a736a6b04b4389496f45cd0291e50d32ece1c3))
* **game-ui:** navy+gold styling for AI action option cards ([d799a9e](https://github.com/Garblesnarff/infinite-realms-production/commit/d799a9e43eb0a1fb9a37271288d28f57922a7637))
* **game-ui:** retint white right-panel chrome + cream chat composer to navy ([74afce0](https://github.com/Garblesnarff/infinite-realms-production/commit/74afce00c690d59a0817cb0ad26ab02e23a2f9ec))
* handle **A. text** bold-letter option format ([7253a5d](https://github.com/Garblesnarff/infinite-realms-production/commit/7253a5d84a1aca62b47d6dd85c6cce97de6ba69a))
* Handle quoted dialogue in sentence cleanup regex ([d11acb7](https://github.com/Garblesnarff/infinite-realms-production/commit/d11acb73db4b1b5c603353d8a3d0fe3f3c153b9c))
* harden blog tRPC routers against IDOR ([a4f0ea6](https://github.com/Garblesnarff/infinite-realms-production/commit/a4f0ea6f37cb4dccacced4a861803663164640dd))
* harden combat participant and weapon attack ownership (IDOR) ([22c9138](https://github.com/Garblesnarff/infinite-realms-production/commit/22c91389f54861b2683b0bc2e960b3ca70ebac18))
* harden memory extraction input sanitization against scaffolding ([79b2f19](https://github.com/Garblesnarff/infinite-realms-production/commit/79b2f1961f6628ddcc4f5bda9db985c11d3ab0b6))
* harden memory sanitization, dice WebGL throttle, and truncation tests ([b8cf10f](https://github.com/Garblesnarff/infinite-realms-production/commit/b8cf10fd4e07587b378bc66bd161b0ed81999c94))
* harden TokenService.createToken with atomic ownership check (IDOR) ([4af3602](https://github.com/Garblesnarff/infinite-realms-production/commit/4af3602a8c3ee16d89917fe8940d906052198392))
* Implement PROPER verbalized sampling per Stanford paper ([eb5605c](https://github.com/Garblesnarff/infinite-realms-production/commit/eb5605c82e3485fa1033cb9e8eebc3887240c4a8))
* Implement WorkOS token auto-refresh to prevent 401 errors ([0ce83c0](https://github.com/Garblesnarff/infinite-realms-production/commit/0ce83c06904e3e29f490bf5f199f3d9483bdd0ad))
* improve AI DM message deduplication to handle expanded duplicates ([75fedd7](https://github.com/Garblesnarff/infinite-realms-production/commit/75fedd7e1aecdf080a055963b334f49fd0011798))
* Improve opening scene quality and auth robustness ([e7defd5](https://github.com/Garblesnarff/infinite-realms-production/commit/e7defd564cb950b5f4099cedcdfe2176cb66aba9))
* Inject campaign entities (NPCs, locations, items, monsters) into Franz prompts ([b9f1487](https://github.com/Garblesnarff/infinite-realms-production/commit/b9f14876d1c3e1aefbe5dc0853ef173cfffb0bf6))
* Inject canonical entities into local Gemini API path ([d62d090](https://github.com/Garblesnarff/infinite-realms-production/commit/d62d090c78be0dff94b83d232ab8b76880076864))
* **inventory:** persist and convert currency spending ([6153079](https://github.com/Garblesnarff/infinite-realms-production/commit/61530794d72453e1bf1529eb5cdf097859c6f100))
* isolate opening scene prompt ([098dc65](https://github.com/Garblesnarff/infinite-realms-production/commit/098dc65cbd099b015e241a09a400a4a02c50b351))
* isolate React into its own chunk to break Vite chunk cycle ([b77050d](https://github.com/Garblesnarff/infinite-realms-production/commit/b77050d71fe3aea4620600b6714b9e4952d2ca2a))
* keep tactical participant adapter permissive ([6142baf](https://github.com/Garblesnarff/infinite-realms-production/commit/6142baf1bb03df3900759df3c68b6b0f3de31ea5))
* **lint:** auto-fix 463 ESLint violations across 220 files ([#698](https://github.com/Garblesnarff/infinite-realms-production/issues/698)) ([48412a1](https://github.com/Garblesnarff/infinite-realms-production/commit/48412a1fadb20b1cd6725495c9cfc02b0c86d700))
* **lint:** remove unused imports across 47 files ([#709](https://github.com/Garblesnarff/infinite-realms-production/issues/709)) ([ce750e4](https://github.com/Garblesnarff/infinite-realms-production/commit/ce750e4c5a9dfebb5856df987e3b9d8e399e9e49))
* **lint:** resolve 275 ESLint errors across 110 files ([#707](https://github.com/Garblesnarff/infinite-realms-production/issues/707)) ([8d708fe](https://github.com/Garblesnarff/infinite-realms-production/commit/8d708fed425bdad2daed537533ea6f56b6e61370))
* **lint:** targeted ESLint error fixes across 19 files ([#703](https://github.com/Garblesnarff/infinite-realms-production/issues/703)) ([b425e90](https://github.com/Garblesnarff/infinite-realms-production/commit/b425e90333f4424e66d908a9c495805af8bde08f))
* log only actual successes in XML world expansion summary ([9e46c4b](https://github.com/Garblesnarff/infinite-realms-production/commit/9e46c4bcb3b77585e8268198edcfd0114304fcc5))
* **mechanics:** use character stats and recover pact slots ([018c273](https://github.com/Garblesnarff/infinite-realms-production/commit/018c273722c1b584c523e9cca4452c5fd93a28dd))
* **memory:** strip ASSET tags from extraction + sanitize fallback segment ([d3f291e](https://github.com/Garblesnarff/infinite-realms-production/commit/d3f291e793efd9319ece7527ef712a4b827d3895))
* **narrative:** unescape AI backslash-quote sequences before rendering ([dd73908](https://github.com/Garblesnarff/infinite-realms-production/commit/dd739085f16ab9433e469f6b53805f215c444c1f))
* normalize malformed asset tags ([786709a](https://github.com/Garblesnarff/infinite-realms-production/commit/786709ad5ed471b546e2ad4c2ed989c7d5eed57b))
* normalize pino logger argument order ([e82474f](https://github.com/Garblesnarff/infinite-realms-production/commit/e82474fa8b3dbbfad339b7e71544ef52b0046c20))
* port symbolic formula guard to the component actually used in production ([019d681](https://github.com/Garblesnarff/infinite-realms-production/commit/019d68151424024a3f4fbf949ebd9a0740d23b4d))
* preserve quick action exports and narrow watch voice match ([750cc32](https://github.com/Garblesnarff/infinite-realms-production/commit/750cc32cab8e655aa0e5a5202c0fb7182d73f93f))
* preserve server typecheck baseline ([c5e26c0](https://github.com/Garblesnarff/infinite-realms-production/commit/c5e26c04eabb26be2ee0e4cfffea787710cfac3e))
* preserve symbolic roll modifiers (+cha/+int/+wis) through processing chain ([55d781d](https://github.com/Garblesnarff/infinite-realms-production/commit/55d781d73d23096061b6480d5d09ff9b38537fa5))
* prevent memory pollution from dice roll scaffolding text ([38243d2](https://github.com/Garblesnarff/infinite-realms-production/commit/38243d2ff8fc80fb00de49df908be9c529b8bad1))
* price live models and remove client fallback loop ([e08c1f3](https://github.com/Garblesnarff/infinite-realms-production/commit/e08c1f32726880258908a09495a3f5e787cb5ae3))
* real types for last session's type regressions ([#1369](https://github.com/Garblesnarff/infinite-realms-production/issues/1369)) ([8bc0b6b](https://github.com/Garblesnarff/infinite-realms-production/commit/8bc0b6bfc322ab89ed26c2225cc76a3289632486))
* reduce API calls from 5-10 to ~1.3 per message, resolve 402 errors ([580e1bb](https://github.com/Garblesnarff/infinite-realms-production/commit/580e1bbcbda7f333599dae9b086423115871308d))
* reduce repeated WebGL context-loss events in 3D dice renderer ([#342](https://github.com/Garblesnarff/infinite-realms-production/issues/342)) ([#682](https://github.com/Garblesnarff/infinite-realms-production/issues/682)) ([b7b87cf](https://github.com/Garblesnarff/infinite-realms-production/commit/b7b87cfe370c590e57980004e0a310f0701726ea))
* **reliability:** correct message count window query ([0ce2c35](https://github.com/Garblesnarff/infinite-realms-production/commit/0ce2c35b6af988297ce570c07f3494012e42cbfa))
* **reliability:** harden AI, chronicle, and billing flows ([ae696e0](https://github.com/Garblesnarff/infinite-realms-production/commit/ae696e0d51952acafae9ddcd885555759ad64076))
* remove API key fingerprint/metadata from client console logs ([25233af](https://github.com/Garblesnarff/infinite-realms-production/commit/25233afc30282dc881280241ed3693a6d7d35670))
* remove bg-fixed from homepage banner for natural scroll behavior ([e03b7fb](https://github.com/Garblesnarff/infinite-realms-production/commit/e03b7fb3c163faea7b6dc289b708bff343ea9458))
* Remove contradictory prompt + delete dead/duplicate code ([ea57260](https://github.com/Garblesnarff/infinite-realms-production/commit/ea5726078367077adac44025d49f9d06e065a5f1))
* Remove contradictory prompt causing AI to output duplicate content ([e190dfd](https://github.com/Garblesnarff/infinite-realms-production/commit/e190dfd2a86d451ddb544feda48333360f7ebed9))
* remove fake character affordances ([72d8a36](https://github.com/Garblesnarff/infinite-realms-production/commit/72d8a3625208d44ca7bc1dd8af4326287a125f0e))
* remove generated_by from quest insert (column doesn't exist) ([2f50c40](https://github.com/Garblesnarff/infinite-realms-production/commit/2f50c40c2c9467d05f49e23e8aa306f8344ef5b2))
* remove undefined connectionStatus/retryCount refs in CharacterCard ([#1407](https://github.com/Garblesnarff/infinite-realms-production/issues/1407)) ([268ae8c](https://github.com/Garblesnarff/infinite-realms-production/commit/268ae8c4cfbac1b01405d9b62c6b3626fd5e0569))
* repair asset tag cleanup and render pipeline to prevent prose corruption ([252d451](https://github.com/Garblesnarff/infinite-realms-production/commit/252d4518b998e2819709acbfb68f9e89a5c311ff))
* replace smart quote string delimiters causing SWC parse failure ([#708](https://github.com/Garblesnarff/infinite-realms-production/issues/708)) ([8c46ae5](https://github.com/Garblesnarff/infinite-realms-production/commit/8c46ae5fa33e68a5a65e4af7da3e586eb2a0d327))
* resolve 22 failing tests across 4 test files ([#683](https://github.com/Garblesnarff/infinite-realms-production/issues/683)) ([89e494f](https://github.com/Garblesnarff/infinite-realms-production/commit/89e494fdb6e07a76d970f214e55d3fa71f79d7bf)), closes [#342](https://github.com/Garblesnarff/infinite-realms-production/issues/342) [#342](https://github.com/Garblesnarff/infinite-realms-production/issues/342)
* Resolve browser console errors after recent refactor ([c13e9c5](https://github.com/Garblesnarff/infinite-realms-production/commit/c13e9c5b864d1e1aff58829d1d793613433d0964))
* resolve conflict between PR [#318](https://github.com/Garblesnarff/infinite-realms-production/issues/318) and [#320](https://github.com/Garblesnarff/infinite-realms-production/issues/320), keep [#320](https://github.com/Garblesnarff/infinite-realms-production/issues/320)'s better trpc/auth implementation ([76f3e14](https://github.com/Garblesnarff/infinite-realms-production/commit/76f3e146564a8f1de0e482991ac71aee085bdcd0))
* Resolve dice roll flow, schema mismatches, and memory pollution ([dbbc7a6](https://github.com/Garblesnarff/infinite-realms-production/commit/dbbc7a64750011864a8aa296731c8759988bde4e))
* Resolve duplicate content in opening scenes and add rate limit fallback ([e0a1331](https://github.com/Garblesnarff/infinite-realms-production/commit/e0a1331927a789cce095656c15f802e795128a84))
* resolve duplicate paragraph rendering in DM messages ([f499984](https://github.com/Garblesnarff/infinite-realms-production/commit/f499984a0c927c6cf80e8566fc3bf8000d150389))
* resolve memory FK violations from stale session ID in processSendQueue ([fe5decf](https://github.com/Garblesnarff/infinite-realms-production/commit/fe5decf4d964bf6e199d5e1e171725a87ea5095e))
* resolve merge conflict and fix lint errors from PR [#306](https://github.com/Garblesnarff/infinite-realms-production/issues/306) ([39ba11b](https://github.com/Garblesnarff/infinite-realms-production/commit/39ba11bce8ecfe07502901f729f01388ef078b70))
* resolve merge conflict in vitest.config.ts ([e81f3a4](https://github.com/Garblesnarff/infinite-realms-production/commit/e81f3a4973fb208cb2f1ee80f3b508a07875b55f))
* resolve quest persistence PGRST204 error for session_id column ([dca6ebf](https://github.com/Garblesnarff/infinite-realms-production/commit/dca6ebfc0d748f43c2d23fd0452277c1e2a889fc))
* resolve race condition in dice roll batch completion ([dcb1950](https://github.com/Garblesnarff/infinite-realms-production/commit/dcb1950bb95e2c3bbb53d01f997c16537c3ac025))
* resolve skill_check rollType throw + synchronous effectiveManualMode ([3b20645](https://github.com/Garblesnarff/infinite-realms-production/commit/3b20645ce89923deb4bbb7622d00fcde9780a7a2))
* resolve starter equipment and preserve custom items ([36fd22a](https://github.com/Garblesnarff/infinite-realms-production/commit/36fd22a523fc40b57d070d37b243178095a69d05))
* resolve symbolic dice formulas before engine parse, add error recovery ([df7dd13](https://github.com/Garblesnarff/infinite-realms-production/commit/df7dd139dde99364b77b84e0332abc28205a1e3a))
* resolve TypeScript errors in database.types.ts and light-blend shader ([e6814ce](https://github.com/Garblesnarff/infinite-realms-production/commit/e6814ce8d9c45081ab1cb7fc5f04d06d0ee3289e))
* resolve vitest.config.ts conflict and fix lint errors from merged PRs ([8afe7ce](https://github.com/Garblesnarff/infinite-realms-production/commit/8afe7ce4c937be7affea6804cdfe83d00ea7e7d9))
* restore dice roll UI by increasing maxTokens and reordering prompt structure ([74287d4](https://github.com/Garblesnarff/infinite-realms-production/commit/74287d455a9de988dae6f02e1ab4314035dc383e))
* restore missing cn import in campaign-card causing dashboard crash ([7d93a70](https://github.com/Garblesnarff/infinite-realms-production/commit/7d93a70ee0a4adcdbe5125d16209ea9a90fed00d))
* Restore response structure and dice roll prompts in ContextBuilderPrompts ([dedb864](https://github.com/Garblesnarff/infinite-realms-production/commit/dedb86490332bc0b3b5239eefe63724495aae2b4))
* route background image loading through server-bun instead of direct Supabase queries ([#1412](https://github.com/Garblesnarff/infinite-realms-production/issues/1412)) ([935d38e](https://github.com/Garblesnarff/infinite-realms-production/commit/935d38e1a36c7fc578a464009af3389571ecd9cb))
* Route campaign generation through modular function with verbalized sampling ([5b16475](https://github.com/Garblesnarff/infinite-realms-production/commit/5b164757b2eb80b07f859d0b3af8b41bec4350a9))
* route gameplay context through server ([6817619](https://github.com/Garblesnarff/infinite-realms-production/commit/6817619a36a0c7e9d7d5dca738f517c43c9a57fc))
* Route opening messages through modular generator with verbalized sampling ([be87fc2](https://github.com/Garblesnarff/infinite-realms-production/commit/be87fc246a11032a4e3bba8726c3429ee34bb776))
* **rules:** correct 5e progression and character options ([8ee6820](https://github.com/Garblesnarff/infinite-realms-production/commit/8ee682001711ff4a0f74f75fc18d2dfcd16af509))
* **rules:** enforce armor penalties ([15717ae](https://github.com/Garblesnarff/infinite-realms-production/commit/15717ae7022398c1d5687ddeabbdcbe0ca6551a0))
* scope requireAuth to consumers, remove dead /dm/options frontend path ([#1418](https://github.com/Garblesnarff/infinite-realms-production/issues/1418)) ([857bfaf](https://github.com/Garblesnarff/infinite-realms-production/commit/857bfaf3869f98610f4ab218747a736b88943ca3))
* Secure Supabase key handling - fail if service role key missing ([f33cef2](https://github.com/Garblesnarff/infinite-realms-production/commit/f33cef2fa9b5b2b3e7a96cb976227d06d0752e6f))
* security and config remediation across 8 files ([4c30922](https://github.com/Garblesnarff/infinite-realms-production/commit/4c30922764788d96ad92cb3755eab5d7f4809f8c))
* **security:** align session message route parameter ([c6f8806](https://github.com/Garblesnarff/infinite-realms-production/commit/c6f8806a20e8738773d7f0eef44d08be842e9ee5))
* **security:** preserve session ownership aliases ([5e819e3](https://github.com/Garblesnarff/infinite-realms-production/commit/5e819e33fef2875c015eb868b00e13f2cfe69ee5))
* **security:** proxy browser AI credentials ([c18a562](https://github.com/Garblesnarff/infinite-realms-production/commit/c18a5628ed34b4c66e32328aa4ea1f6cfdf19620))
* **security:** route campaign data through server ([439a890](https://github.com/Garblesnarff/infinite-realms-production/commit/439a8909c3539f9605e04e96d4ecc084fc58803d))
* **security:** route character data through server ([521420a](https://github.com/Garblesnarff/infinite-realms-production/commit/521420ab0dfeee558df99c66f44071d92d311fdf))
* **security:** route memory data through server ([247fa0b](https://github.com/Garblesnarff/infinite-realms-production/commit/247fa0bee032053ab4610ab9f0cf6ef6c7d92570))
* **security:** route session messages through server ([4dff141](https://github.com/Garblesnarff/infinite-realms-production/commit/4dff1417776d8d0d2bc25a8b3a9bfd060ccb0c27))
* **server:** add Elysia schema validation to admin, internal, observability routes ([dfa8b1a](https://github.com/Garblesnarff/infinite-realms-production/commit/dfa8b1ac864d85284fab5406055e058186c7e476))
* **server:** rate limiters never fired - Elysia hooks need { as: 'scoped' } ([abfcd6c](https://github.com/Garblesnarff/infinite-realms-production/commit/abfcd6cb64af754aa5bd95e0670b026c6ac5d796))
* **server:** security hardening pass ([772c0b6](https://github.com/Garblesnarff/infinite-realms-production/commit/772c0b6e718c8c0784bf924b302a42daade49507))
* set VITE_MANIFEST_PATH for SSR landing pages ([c8653e6](https://github.com/Garblesnarff/infinite-realms-production/commit/c8653e6e9d585fae56ad9012a047ccd4c5adc4ba))
* stabilize 3D dice path after WebGL context loss ([62fb4de](https://github.com/Garblesnarff/infinite-realms-production/commit/62fb4defdda00e6dc8d4ab53aa5bf1c7fcd87b79))
* stabilize opening scene formatting ([9c3d9cc](https://github.com/Garblesnarff/infinite-realms-production/commit/9c3d9cc3135da046e9be661ee89c57ced55ffc33))
* stabilize WebGL context-loss during multi-roll dice play ([ad9bb80](https://github.com/Garblesnarff/infinite-realms-production/commit/ad9bb80acb82a0d8b351b11f035d0368660afb9c))
* standardize z-index and add accessibility to Memory Panel ([0100c4d](https://github.com/Garblesnarff/infinite-realms-production/commit/0100c4d0a1c390809ff7559445456f72b679be1d))
* starter character seeding, portrait fallback, greeting regeneration ([56d319f](https://github.com/Garblesnarff/infinite-realms-production/commit/56d319f4c9e04d91e357c9bc9126141b312ce5ac))
* Strengthen proper noun diversity enforcement - explicitly reject LLM patterns ([f309194](https://github.com/Garblesnarff/infinite-realms-production/commit/f3091949b4b03cb30264132989f0784d9218dc87))
* switch production to Bun/Elysia server ([e6b0a3e](https://github.com/Garblesnarff/infinite-realms-production/commit/e6b0a3e877beb2b2b1f03e7a66e6ee64702deaa4))
* synchronize PM2 graceful shutdown to stop leaking duplicate workers ([#1420](https://github.com/Garblesnarff/infinite-realms-production/issues/1420)) ([6dc2dc8](https://github.com/Garblesnarff/infinite-realms-production/commit/6dc2dc8c8519fb82553c81ad3e502fea3b319fcb))
* **tactical:** make line of sight symmetric ([7674c25](https://github.com/Garblesnarff/infinite-realms-production/commit/7674c253cbf32cde711d01ba3392e3624d2eb851))
* **test:** correct restMechanics test assertion for minimum hit dice ([#705](https://github.com/Garblesnarff/infinite-realms-production/issues/705)) ([e1322a5](https://github.com/Garblesnarff/infinite-realms-production/commit/e1322a5bab59df96cf0c8829c7fcae66974bcee3))
* **test:** resolve race condition in useAdvancedSpellcasting test ([#711](https://github.com/Garblesnarff/infinite-realms-production/issues/711)) ([16acc28](https://github.com/Garblesnarff/infinite-realms-production/commit/16acc28583801b10875b7e8444a836acdb8a7368))
* **tests:** resolve supabase client crash and missing pino module in test env ([#690](https://github.com/Garblesnarff/infinite-realms-production/issues/690)) ([ba060d9](https://github.com/Garblesnarff/infinite-realms-production/commit/ba060d9ab0c6c6bd49bb011666b7cb188ea9b078))
* Update Gemini image model after Jan 15 deprecation ([4bed3e5](https://github.com/Garblesnarff/infinite-realms-production/commit/4bed3e5fce04cc6a9f868eb491068f05b9f857a2))
* Update lore keeper ingestion for nested campaign directories ([68dd6fc](https://github.com/Garblesnarff/infinite-realms-production/commit/68dd6fc5fcd4dd05724ff16d719af48d0c138c05))
* Update OpenRouter free tier models for reliability ([94393d2](https://github.com/Garblesnarff/infinite-realms-production/commit/94393d2c7caf7ef674fa12d819b714f6d4b8015b))
* Update requireAuth middleware to use WorkOS tokens ([e45a1e8](https://github.com/Garblesnarff/infinite-realms-production/commit/e45a1e8a347e56b10aad78789888d25fa11ba954))
* update security-lint to scan server-bun instead of deprecated server ([4430457](https://github.com/Garblesnarff/infinite-realms-production/commit/4430457dbb69178c678522fdbf1b1c44047ca8cc))
* Use async constructEventAsync for Bun compatibility ([0e542ed](https://github.com/Garblesnarff/infinite-realms-production/commit/0e542ede567790af19090bd07da987fc3e398f11))
* use resolve() instead of derive() for ownership checks (campaigns/characters/rest 404 bug) ([#1415](https://github.com/Garblesnarff/infinite-realms-production/issues/1415)) ([7064aef](https://github.com/Garblesnarff/infinite-realms-production/commit/7064aef5b92316ef0a29bef49fbabc400e1e266d))
* use vi.stubEnv for VITE_API_URL in use-user-plan tests ([#1362](https://github.com/Garblesnarff/infinite-realms-production/issues/1362)) ([f4b3933](https://github.com/Garblesnarff/infinite-realms-production/commit/f4b393331406c768154f73d0e0347d11d8d44fff)), closes [#1295](https://github.com/Garblesnarff/infinite-realms-production/issues/1295)
* Validate reference images before sending to Gemini API ([3e2b685](https://github.com/Garblesnarff/infinite-realms-production/commit/3e2b6854966fb4947c2dfde778a287bf4b8a440c))


### Performance

* atomic JSONB UPSERT for fog of war revealArea ([6da3242](https://github.com/Garblesnarff/infinite-realms-production/commit/6da324264fdd6e1ef807fa15c1f2ee5725093a08))
* batch blog taxonomy insertions with UNNEST and Promise.all ([3b80916](https://github.com/Garblesnarff/infinite-realms-production/commit/3b80916fc425100f938ac2f77fa20bda1efcf49b))
* **blog:** optimize list query by excluding content field ([#544](https://github.com/Garblesnarff/infinite-realms-production/issues/544)) ([576dfb0](https://github.com/Garblesnarff/infinite-realms-production/commit/576dfb05174cecfd7d438aa445be9c18c5acd3ee))
* **character:** optimize equipment lookup and memoization in StartingEquipmentSelection ([#840](https://github.com/Garblesnarff/infinite-realms-production/issues/840)) ([839548c](https://github.com/Garblesnarff/infinite-realms-production/commit/839548c32ca7e39bfd393a4370322fee2ad01561))
* collapse blog getBySlug queries into single round-trip ([#411](https://github.com/Garblesnarff/infinite-realms-production/issues/411)) ([ab74793](https://github.com/Garblesnarff/infinite-realms-production/commit/ab747938741c8f48ea47a6ca535b13bc1af9ae54))
* **combat:** consolidate participant status queries ([#668](https://github.com/Garblesnarff/infinite-realms-production/issues/668)) ([7c3d458](https://github.com/Garblesnarff/infinite-realms-production/commit/7c3d4587117afd8b4786357f6771db7e81aafea7))
* **combat:** optimize participant filtering and turn detection ([#1162](https://github.com/Garblesnarff/infinite-realms-production/issues/1162)) ([55d7411](https://github.com/Garblesnarff/infinite-realms-production/commit/55d7411b0a75e2aceac775255437ee387bb5b0e6))
* consolidate DM message content processing into a single useMemo hook ([#718](https://github.com/Garblesnarff/infinite-realms-production/issues/718)) ([86ed6f7](https://github.com/Garblesnarff/infinite-realms-production/commit/86ed6f7b421afffde4959dcd838782e5dbca6ced))
* consolidate spell slot queries ([#453](https://github.com/Garblesnarff/infinite-realms-production/issues/453)) ([f4f4e54](https://github.com/Garblesnarff/infinite-realms-production/commit/f4f4e545796bf90a545a4d965ca43431a1ac7b9b))
* **db:** Optimize database - fix N+1 queries, tune PostgreSQL ([2c6a288](https://github.com/Garblesnarff/infinite-realms-production/commit/2c6a288d427e2ea95adb39d9c11e4167560d1b6c))
* eliminate memory retrieval bursts after writes ([b87c06d](https://github.com/Garblesnarff/infinite-realms-production/commit/b87c06d00ed868ce19ad4585599e438b56515cdf))
* hoist static data maps in character-calculations.ts ([#344](https://github.com/Garblesnarff/infinite-realms-production/issues/344)) ([ba29e29](https://github.com/Garblesnarff/infinite-realms-production/commit/ba29e29f0e44c9b5d319de08858c92ffa3c9bb8c))
* memoize AuthContext and CampaignContext values ([#87](https://github.com/Garblesnarff/infinite-realms-production/issues/87)) ([8c9e366](https://github.com/Garblesnarff/infinite-realms-production/commit/8c9e366912532ece64fe6e32e9af9c854f5842b1))
* memoize ChatInput component ([#609](https://github.com/Garblesnarff/infinite-realms-production/issues/609)) ([8bedefc](https://github.com/Garblesnarff/infinite-realms-production/commit/8bedefc63c9110d1672fe0d763268cafc58789e4))
* memoize game layout panels and improve type safety ([#854](https://github.com/Garblesnarff/infinite-realms-production/issues/854)) ([05721d9](https://github.com/Garblesnarff/infinite-realms-production/commit/05721d9283ae7990cc9bbee0437ac133b78211ec))
* memoize prepared assets in AI processor ([#1242](https://github.com/Garblesnarff/infinite-realms-production/issues/1242)) ([c623011](https://github.com/Garblesnarff/infinite-realms-production/commit/c623011fea51c62b52f46070f3e328cb60329ae9))
* memoize racial proficiency lookups in character calculations ([#1388](https://github.com/Garblesnarff/infinite-realms-production/issues/1388)) ([22b83ee](https://github.com/Garblesnarff/infinite-realms-production/commit/22b83ee977129e039cab896f8c532fb3391674a2))
* memoize TypingIndicator component ([#1083](https://github.com/Garblesnarff/infinite-realms-production/issues/1083)) ([6cd6f6e](https://github.com/Garblesnarff/infinite-realms-production/commit/6cd6f6ef7082a736f964feb8164df26ab4e0a6b4))
* **memory:** avoid over-fetching embeddings in MemoryLoader ([#476](https://github.com/Garblesnarff/infinite-realms-production/issues/476)) ([936c6fd](https://github.com/Garblesnarff/infinite-realms-production/commit/936c6fd4419c7dfbc635d66024ca6db81b5e0457))
* optimize backend service database queries by avoiding over-fetching ([#546](https://github.com/Garblesnarff/infinite-realms-production/issues/546)) ([96f4434](https://github.com/Garblesnarff/infinite-realms-production/commit/96f4434035113b589034e3bb017f99b446ed2420))
* optimize battle map rendering and scene data hook ([75088c9](https://github.com/Garblesnarff/infinite-realms-production/commit/75088c9dda1815dfa0500cc698eb509e34490bf8))
* optimize blog taxonomy queries by avoiding over-fetching ([#1064](https://github.com/Garblesnarff/infinite-realms-production/issues/1064)) ([7e3cbe3](https://github.com/Garblesnarff/infinite-realms-production/commit/7e3cbe3b15ff7417c9e79892b8830906cda24224))
* optimize chat and NPC roll display rendering ([c5098db](https://github.com/Garblesnarff/infinite-realms-production/commit/c5098db137554a6b1420fda85a9aac36ff29ed8a))
* optimize ClassFeaturesService with atomic batch queries ([36b6396](https://github.com/Garblesnarff/infinite-realms-production/commit/36b639609509ce51d829eb39fc034cc69e9ed60e))
* optimize combat start sequence - reduce DB round-trips from 6 to 3 ([3a314ec](https://github.com/Garblesnarff/infinite-realms-production/commit/3a314ece161f0f2b07617e5c895589decbcffeab))
* optimize DiceRollRequest by extracting static config ([#641](https://github.com/Garblesnarff/infinite-realms-production/issues/641)) ([c3e1dfa](https://github.com/Garblesnarff/infinite-realms-production/commit/c3e1dfac2cf6b851ca90ae7cc5fe304aa97d6171))
* optimize ISO timestamp comparisons across frontend and agent services ([#1154](https://github.com/Garblesnarff/infinite-realms-production/issues/1154)) ([7ee42de](https://github.com/Garblesnarff/infinite-realms-production/commit/7ee42de388413386b14d0d8e4efaa039c859673f))
* optimize LayersPanel and LayerControlItem memoization ([#601](https://github.com/Garblesnarff/infinite-realms-production/issues/601)) ([a5c1327](https://github.com/Garblesnarff/infinite-realms-production/commit/a5c13272d341c49e96d4e585fcbfb3e89a439065))
* optimize MemoryPanel re-renders with memoization ([a142ab0](https://github.com/Garblesnarff/infinite-realms-production/commit/a142ab000a868e310701afabd5e9252b4c211635))
* optimize message history fetching in useMessages hook ([#533](https://github.com/Garblesnarff/infinite-realms-production/issues/533)) ([d18cb64](https://github.com/Garblesnarff/infinite-realms-production/commit/d18cb643758c42c56c3ced11f0bc13b7c89a6c15))
* optimize TimelineRail scroll performance ([#508](https://github.com/Garblesnarff/infinite-realms-production/issues/508)) ([960bd1e](https://github.com/Garblesnarff/infinite-realms-production/commit/960bd1eb46bdcab1c7092a813aff4c577748b73b))
* optimize ValidationService by using explicit columns ([#1249](https://github.com/Garblesnarff/infinite-realms-production/issues/1249)) ([bb75796](https://github.com/Garblesnarff/infinite-realms-production/commit/bb75796aee11764526b8edbb3f8e92badfb4c95f))
* split vendor bundle into cacheable chunks ([#691](https://github.com/Garblesnarff/infinite-realms-production/issues/691)) ([e23dfba](https://github.com/Garblesnarff/infinite-realms-production/commit/e23dfba8f5df51cd095408807192bf429dbe84d8))
* **utils:** optimize saving throw modifier calculations ([#951](https://github.com/Garblesnarff/infinite-realms-production/issues/951)) ([01cad8c](https://github.com/Garblesnarff/infinite-realms-production/commit/01cad8cbf385fe8f885bba58973664cb92742fcd))


### Build System

* **deps:** delete nested Bun lockfile ([755199d](https://github.com/Garblesnarff/infinite-realms-production/commit/755199d8ef2b8711f8ca9b43bf0dcc832b61b30f))
* **deps:** make Bun server a workspace ([5629ba8](https://github.com/Garblesnarff/infinite-realms-production/commit/5629ba8f82002d09753853325d9acee7fe49eca3))


### Documentation

* Add blog system documentation to CLAUDE.md ([021ccb1](https://github.com/Garblesnarff/infinite-realms-production/commit/021ccb1a5ccc2395be80b317f9051ff8f9aabecf))
* Add dev-browser documentation for headless browser testing ([f1087c7](https://github.com/Garblesnarff/infinite-realms-production/commit/f1087c76e87a8900827d6569dc0dd9fd5725a9d5))
* Add JSDoc to lore-keeper-mcp-server ([632cb79](https://github.com/Garblesnarff/infinite-realms-production/commit/632cb7942026f6e9b8f3003ef640d316ae1818cf))
* add launch blog post hero image ([1a655f8](https://github.com/Garblesnarff/infinite-realms-production/commit/1a655f8ecb363b8d40907973c1dcf6126c97e0e9))
* **ai:** deprecate legacy narration facade ([d7a4e7d](https://github.com/Garblesnarff/infinite-realms-production/commit/d7a4e7dc40cbbfdc6402f1ab584b55ca0a1957fa))
* **brand:** record shipped navy app theme ([aaab6c3](https://github.com/Garblesnarff/infinite-realms-production/commit/aaab6c3724d7ccd677ad5e29b58cd4b0e2bf8eed))
* remove stale/broken/corrupted docs ([#1296](https://github.com/Garblesnarff/infinite-realms-production/issues/1296)) ([530ce30](https://github.com/Garblesnarff/infinite-realms-production/commit/530ce3065a29f7bbfe98f3884054338237e5d747))
* rewrite AGENTS.md and deduplicate Jules agent journals ([b109d9c](https://github.com/Garblesnarff/infinite-realms-production/commit/b109d9c632a57bf82bfd81a5c8d218805864408c))
* **security:** reference auth tokens from environment ([e7776e5](https://github.com/Garblesnarff/infinite-realms-production/commit/e7776e5f0f6b85b7c50710bc6fca19a449ddf4e3))
* **security:** scrub production database credentials ([2682be7](https://github.com/Garblesnarff/infinite-realms-production/commit/2682be70de31cf8e7908eba02edf70a1d2e7c5da))
* Update CLAUDE.md with Bun migration info ([7fd82ec](https://github.com/Garblesnarff/infinite-realms-production/commit/7fd82ec0d11144c4292cbf954588bdf96742ffde))


### Refactoring

* 🔪 Extract D&D 5E spell slot mechanics from SpellSlotsService ([3eabe14](https://github.com/Garblesnarff/infinite-realms-production/commit/3eabe149fee856b12a2e9decd129152fc19041b3))
* 🔪 Scalpel: Extract CombatReadyCard from CombatInterface ([#1379](https://github.com/Garblesnarff/infinite-realms-production/issues/1379)) ([65170c4](https://github.com/Garblesnarff/infinite-realms-production/commit/65170c40e327b572a624ca70dc737241a5fa448b))
* 🔪 Scalpel: Extract dice roll logic from MessageListContainer ([#355](https://github.com/Garblesnarff/infinite-realms-production/issues/355)) ([8c1b319](https://github.com/Garblesnarff/infinite-realms-production/commit/8c1b3196fd8e45e406c5450a9fe9f62f6fb9840e))
* **ai:** consolidate live DM transport and context budget ([0527fe3](https://github.com/Garblesnarff/infinite-realms-production/commit/0527fe3bcccb3e96de7cedf5288600d0aba78cd8))
* **ai:** delete inert enhancement generator ([234e0e7](https://github.com/Garblesnarff/infinite-realms-production/commit/234e0e7558657a0ae109e74cd7aa2f764670a643))
* **ai:** remove duplicate frontend LLM client ([1780946](https://github.com/Garblesnarff/infinite-realms-production/commit/178094672eb2b7415ea783fa36a95a403abc4985))
* **ai:** share embedding input ceiling ([3694403](https://github.com/Garblesnarff/infinite-realms-production/commit/369440331769ea68a6b8ff7503095fd5ffe883e8))
* **battle-map:** extract ToolOptions sub-components ([#423](https://github.com/Garblesnarff/infinite-realms-production/issues/423)) ([c219d2d](https://github.com/Garblesnarff/infinite-realms-production/commit/c219d2d657bce4a1cfea7548f295fc9ec1ebb7e3))
* **combat:** extract vitality handlers to useCombatVitalityHandlers hook ([#614](https://github.com/Garblesnarff/infinite-realms-production/issues/614)) ([496dea8](https://github.com/Garblesnarff/infinite-realms-production/commit/496dea898a4a16970ec99ba5b1f6510b54a1df9e))
* consolidate duplicate components and fix broken imports ([4d1d496](https://github.com/Garblesnarff/infinite-realms-production/commit/4d1d49695bef720810454596c0789d57f1af4212))
* decompose GameContent.tsx into useGameData hook and GameProviders ([94efbd5](https://github.com/Garblesnarff/infinite-realms-production/commit/94efbd5a5f982cb111d0a9880aca3d35f7c75a92))
* decompose god files, remove dead code, fix memory leaks ([52cf87c](https://github.com/Garblesnarff/infinite-realms-production/commit/52cf87ce62f19ad4312de6f5ff70800e2cb7d0bc))
* dedupe db and infrastructure ts-js modules ([d0c1b3c](https://github.com/Garblesnarff/infinite-realms-production/commit/d0c1b3c0e186681a947db3347c24f6b505b19bf2))
* enhance LayersPanel accessibility and UX with Tooltips and ARIA ([45f28e0](https://github.com/Garblesnarff/infinite-realms-production/commit/45f28e0043c45727c4ce25a1edc5fa4ee0686d75))
* extract 3D dice logic from DiceRollEmbed ([#374](https://github.com/Garblesnarff/infinite-realms-production/issues/374)) ([3134f9d](https://github.com/Garblesnarff/infinite-realms-production/commit/3134f9d26dd7545b662edaecc4692f36f6e933a6))
* extract ai-service.ts sub-modules ([3853a05](https://github.com/Garblesnarff/infinite-realms-production/commit/3853a053498ef59140a7edc5946b87ba4cf87540))
* extract blog auth middleware into reusable helpers ([5e13fd6](https://github.com/Garblesnarff/infinite-realms-production/commit/5e13fd6af6dc5815b424bfde3d7bec51d1daf60e))
* extract CampaignDetailHero from CampaignDetailPage ([#1236](https://github.com/Garblesnarff/infinite-realms-production/issues/1236)) ([4c33ef7](https://github.com/Garblesnarff/infinite-realms-production/commit/4c33ef723312688d33a2f2eb71b500e1049435d5))
* extract cards from CharacterSelectionModal ([#1243](https://github.com/Garblesnarff/infinite-realms-production/issues/1243)) ([e070124](https://github.com/Garblesnarff/infinite-realms-production/commit/e070124a66277c6ff1db7fb284332e7f179ef48d))
* extract character folder dialogs into separate modules ([#480](https://github.com/Garblesnarff/infinite-realms-production/issues/480)) ([433023a](https://github.com/Garblesnarff/infinite-realms-production/commit/433023a12e94beb71a552c49e5e726ea633b6734))
* extract character selection logic to custom hook ([#449](https://github.com/Garblesnarff/infinite-realms-production/issues/449)) ([49c5a43](https://github.com/Garblesnarff/infinite-realms-production/commit/49c5a4328473fe6d1582e74ecd307442e1597d87))
* extract characterReducer from CharacterContext ([#596](https://github.com/Garblesnarff/infinite-realms-production/issues/596)) ([842bddf](https://github.com/Garblesnarff/infinite-realms-production/commit/842bddf39ad9783c1dd27a1a44b370b12afad011))
* extract chat history logic into use-chat-history hook ([b546eb5](https://github.com/Garblesnarff/infinite-realms-production/commit/b546eb5c3ff8ede34e8aa03df3df97eebc345da1))
* extract combat detection from use-combat-ai-integration ([#780](https://github.com/Garblesnarff/infinite-realms-production/issues/780)) ([57f89d0](https://github.com/Garblesnarff/infinite-realms-production/commit/57f89d0113c1486c8a5c1df1be4b17a7fbcf1e02))
* extract combat prompts into CombatRulesPrompts class ([ee4d1dd](https://github.com/Garblesnarff/infinite-realms-production/commit/ee4d1dd5e71b36753b1d4d68ab7da7c2ac66846e))
* extract CombatTurnManager from CombatSequenceValidator ([4b6a759](https://github.com/Garblesnarff/infinite-realms-production/commit/4b6a759873920d98d301e2496c2453d325b70882))
* extract CombatVitals and useCombatState from MainTab ([3f18e5b](https://github.com/Garblesnarff/infinite-realms-production/commit/3f18e5bc0a81a06b83e7f3f9d611ebd51e9ae93b))
* extract EditorSidebar from blog-post-editor.tsx ([#1157](https://github.com/Garblesnarff/infinite-realms-production/issues/1157)) ([7642c0c](https://github.com/Garblesnarff/infinite-realms-production/commit/7642c0ceb31f7d708fb5fd4b8c6fe52f636681f6))
* extract EnhancedSpellCard and use useEnhancedSpellcasting hook in EnhancedSpellsTab ([#583](https://github.com/Garblesnarff/infinite-realms-production/issues/583)) ([662ed32](https://github.com/Garblesnarff/infinite-realms-production/commit/662ed3296c6b0f10624fbfa77a0c27b19cd33b0d))
* extract GameSidePanelContent from MemoryPanel.tsx ([#415](https://github.com/Garblesnarff/infinite-realms-production/issues/415)) ([8809aca](https://github.com/Garblesnarff/infinite-realms-production/commit/8809acac1b49a3befa664bf75550085d2d4c1315))
* extract gemini-client and context-builder from ai-service ([6b3764c](https://github.com/Garblesnarff/infinite-realms-production/commit/6b3764cc22c616955c279cd4f36fb7b19c823471))
* extract GenreCard and GENRES data from GenreSelection ([#678](https://github.com/Garblesnarff/infinite-realms-production/issues/678)) ([421ee21](https://github.com/Garblesnarff/infinite-realms-production/commit/421ee2152bbd7def2ac3f4db7ac4b3aa1d649947))
* Extract helper modules from large files ([6d5a55d](https://github.com/Garblesnarff/infinite-realms-production/commit/6d5a55d812acfc105bfaad540676471796a005f0))
* extract InitiativeMessage to its own module ([#1252](https://github.com/Garblesnarff/infinite-realms-production/issues/1252)) ([84403a4](https://github.com/Garblesnarff/infinite-realms-production/commit/84403a447b3d84fb9220a8cb5ab6af67fd85ff0a))
* extract InventoryMechanics from InventoryService ([#542](https://github.com/Garblesnarff/infinite-realms-production/issues/542)) ([3c3fad7](https://github.com/Garblesnarff/infinite-realms-production/commit/3c3fad76a87a7f7911e1a3718446b710e2cf3fcc))
* extract MapAdjustmentControls from MapUploader ([#1133](https://github.com/Garblesnarff/infinite-realms-production/issues/1133)) ([7488747](https://github.com/Garblesnarff/infinite-realms-production/commit/74887471adfd14ff36f1d26b8ac10a0508238d15))
* extract MeasurementMechanics from MeasurementService ([#810](https://github.com/Garblesnarff/infinite-realms-production/issues/810)) ([c9e5adf](https://github.com/Garblesnarff/infinite-realms-production/commit/c9e5adf4177f20f11c13729d4d558bf286a61881))
* extract memory classification patterns from patterns.ts ([#669](https://github.com/Garblesnarff/infinite-realms-production/issues/669)) ([14012d8](https://github.com/Garblesnarff/infinite-realms-production/commit/14012d854e2de1ffb8186251926c8173dc8fa921))
* extract ParticipantRow from InitiativeTracker ([#867](https://github.com/Garblesnarff/infinite-realms-production/issues/867)) ([de5384e](https://github.com/Garblesnarff/infinite-realms-production/commit/de5384e04d16f2d95435db46ccfeed2ba7f7b0fe))
* extract personality logic into usePersonalitySelection hook ([#855](https://github.com/Garblesnarff/infinite-realms-production/issues/855)) ([1828021](https://github.com/Garblesnarff/infinite-realms-production/commit/18280210264ca082d78a35a04d78394fc5b77d4f))
* extract point buy and rolling logic from use-ability-score-selection.ts ([#1239](https://github.com/Garblesnarff/infinite-realms-production/issues/1239)) ([c5a841d](https://github.com/Garblesnarff/infinite-realms-production/commit/c5a841dda5e2d305bfb5163f4f1c1e477bcae4c2))
* Extract rules and combat prompts from ContextBuilderPrompts ([c556a3e](https://github.com/Garblesnarff/infinite-realms-production/commit/c556a3ec05012f16ef49e2ea4567ece6771be309))
* extract shared CORS utility for Deno edge functions ([1e458de](https://github.com/Garblesnarff/infinite-realms-production/commit/1e458de765f44deb8d18e08b7e5b00c8d729d103))
* extract SimpleMessageList from SimpleGameChat ([#847](https://github.com/Garblesnarff/infinite-realms-production/issues/847)) ([52d9408](https://github.com/Garblesnarff/infinite-realms-production/commit/52d94082f854cb74f767c064bdbe96834ec70d35))
* extract sub-components from ClassFeatureTracker ([#1225](https://github.com/Garblesnarff/infinite-realms-production/issues/1225)) ([aadbeba](https://github.com/Garblesnarff/infinite-realms-production/commit/aadbeba32d9ec5101a75888619cc4c8fc9fdb900))
* extract Turn and Initiative Management from useCombatStore ([#844](https://github.com/Garblesnarff/infinite-realms-production/issues/844)) ([9bc97c2](https://github.com/Garblesnarff/infinite-realms-production/commit/9bc97c2d076d3c822d882436522d241836df398e))
* extract useShareCharacter hook from ShareCharacterDialog ([#954](https://github.com/Garblesnarff/infinite-realms-production/issues/954)) ([22b17f9](https://github.com/Garblesnarff/infinite-realms-production/commit/22b17f9cabd5c04c9603c83acb2c71093a339e35))
* extract validation and conflict logic from WorldGraph ([#157](https://github.com/Garblesnarff/infinite-realms-production/issues/157)) ([724f159](https://github.com/Garblesnarff/infinite-realms-production/commit/724f159fef6c33f9554170ebf62ac0d663dd056d))
* extract vision components from VisionPolygon.tsx ([3bc24d3](https://github.com/Garblesnarff/infinite-realms-production/commit/3bc24d37a4b34dfbbe03e565ecfc6d7ec88ee1e7))
* extract VoiceAudioService from VoiceDirector ([9c923eb](https://github.com/Garblesnarff/infinite-realms-production/commit/9c923eb8ff16455b7c9bd8b9825ca39994f9eef6))
* extract wizard validators from WizardContent.tsx ([e0bee72](https://github.com/Garblesnarff/infinite-realms-production/commit/e0bee72a88d5198c7a43278741b8b19e04c30728))
* extract world and memory processing from DM response processor ([#1263](https://github.com/Garblesnarff/infinite-realms-production/issues/1263)) ([64d5157](https://github.com/Garblesnarff/infinite-realms-production/commit/64d515796fe5f924edac799f674063fc14fa7189))
* **game:** extract NPCRollCard and useNPCRollQueue from NPCRollDisplay ([#1161](https://github.com/Garblesnarff/infinite-realms-production/issues/1161)) ([1a1f665](https://github.com/Garblesnarff/infinite-realms-production/commit/1a1f665a9d9e4aa3eda1c755ca8acd4ed1a9b5f9))
* **game:** move npc rolls into accessible dialog ([386d67a](https://github.com/Garblesnarff/infinite-realms-production/commit/386d67a1de04b169d0a3bfeeb0beb508f0d9da17))
* **hooks:** extract useVoiceApiKey from useProgressiveVoice ([#428](https://github.com/Garblesnarff/infinite-realms-production/issues/428)) ([a8f24f1](https://github.com/Garblesnarff/infinite-realms-production/commit/a8f24f1948527bb775c21e01b83846166b332ee9))
* **lore-keeper:** extract data mapping logic to dedicated module ([#1218](https://github.com/Garblesnarff/infinite-realms-production/issues/1218)) ([d8aa995](https://github.com/Garblesnarff/infinite-realms-production/commit/d8aa995fd71e4427e807dc4f1853ed9eb2f46123))
* modularize character class definitions ([#1272](https://github.com/Garblesnarff/infinite-realms-production/issues/1272)) ([d00266d](https://github.com/Garblesnarff/infinite-realms-production/commit/d00266d1697c7592caab8571207a0dd7cbe6d2f0))
* remove dead duplicate components (~3500 lines) ([cd6a353](https://github.com/Garblesnarff/infinite-realms-production/commit/cd6a35336adcb7be9ab6cf970735e0d3da5222eb))
* Remove Gemini abstraction layer, route all AI through server ([5452404](https://github.com/Garblesnarff/infinite-realms-production/commit/54524041101261043bd00f9251b9b869cdc59d43))
* replace any types with proper interfaces in engine and core files ([c060100](https://github.com/Garblesnarff/infinite-realms-production/commit/c060100147f45519808708ac9a99cc679bd50ddf))
* replace JSON.parse deep clones with structuredClone ([28476e4](https://github.com/Garblesnarff/infinite-realms-production/commit/28476e42ef19e0c24610006d59351352d146334d))
* **scenes:** extract SceneCreationWizard steps into modular components ([#425](https://github.com/Garblesnarff/infinite-realms-production/issues/425)) ([d8f1262](https://github.com/Garblesnarff/infinite-realms-production/commit/d8f1262b784ce7b2481abe4c31956a6098bae29a))
* **server-bun:** extract room management and Foundry VTT logic from ws.ts ([#800](https://github.com/Garblesnarff/infinite-realms-production/issues/800)) ([1cf7cab](https://github.com/Garblesnarff/infinite-realms-production/commit/1cf7cabe1356b41f5a306f9edb8fb3f20be5ab00))
* **spells:** extract spell management logic into useSpells hook ([#1285](https://github.com/Garblesnarff/infinite-realms-production/issues/1285)) ([b9efa81](https://github.com/Garblesnarff/infinite-realms-production/commit/b9efa810087cd3bfd4d43153099b24dd16c85cfe))
* split ai-service.ts into asset-processor.ts ([4a913e0](https://github.com/Garblesnarff/infinite-realms-production/commit/4a913e03adfc6c250c092007c7b173fd73838cee))
* split combat routes into modular sub-routes ([dded1b2](https://github.com/Garblesnarff/infinite-realms-production/commit/dded1b26212c36abb46f337b1ec5e8ec08a2c3b7))
* split supabase types into domain modules ([49a6499](https://github.com/Garblesnarff/infinite-realms-production/commit/49a6499c2b1010756d06fd0d909995161a9849ad))
* stabilize progressive voice callbacks ([45c6591](https://github.com/Garblesnarff/infinite-realms-production/commit/45c65915a351af0c78dfb8a3bf1ae0cd96ab0396))
* **tactical:** use rot A-star reachability ([dca190d](https://github.com/Garblesnarff/infinite-realms-production/commit/dca190d3fd9650dd4ce362a71fdffb875854c262))
* **theme:** consolidate shared glow shadows ([ba2beb0](https://github.com/Garblesnarff/infinite-realms-production/commit/ba2beb0af9d2a2d3f964ccfbddc8e4115b1ade51))
* **theme:** replace legacy purple card glows ([5c697e1](https://github.com/Garblesnarff/infinite-realms-production/commit/5c697e1933ce4ca9d0956cbaf8c8e28251b9bfaa))
* **ui:** route gold button through overhaul tokens ([11e0381](https://github.com/Garblesnarff/infinite-realms-production/commit/11e03819382a306ac0ec772ae7a85d7ca809ffb2))
* **ui:** use standard radius in overhaul rail ([6867ff9](https://github.com/Garblesnarff/infinite-realms-production/commit/6867ff98f6282ff7bdee1e881c0dade3d2f3ba59))
* **utils:** extract attack narration and types from attackUtils.ts ([#623](https://github.com/Garblesnarff/infinite-realms-production/issues/623)) ([dcb8589](https://github.com/Garblesnarff/infinite-realms-production/commit/dcb85896744e70cbd7b3895de73aa566980a0902))
* **utils:** extract template point generators ([#632](https://github.com/Garblesnarff/infinite-realms-production/issues/632)) ([23144de](https://github.com/Garblesnarff/infinite-realms-production/commit/23144ded97cfc8e35bf567b07d5970d5ee42bad4))


### CI/CD

* relocate workflows to repo root so they actually run ([fc20b1f](https://github.com/Garblesnarff/infinite-realms-production/commit/fc20b1fe9f7c5d4c5fe9397099db7b9fa5f525c8))
* run launch checks from repository root ([38af7d9](https://github.com/Garblesnarff/infinite-realms-production/commit/38af7d9b493e511bc72c49a534872ce1dd90eadb))


### Tests

* add 100% coverage for useCombatVitalityHandlers hook ([#1234](https://github.com/Garblesnarff/infinite-realms-production/issues/1234)) ([29fe7de](https://github.com/Garblesnarff/infinite-realms-production/commit/29fe7de3d177819dd0e5dee2c20cc09443ce0bbc))
* add comprehensive coverage for template-calculations ([#676](https://github.com/Garblesnarff/infinite-realms-production/issues/676)) ([de6c0af](https://github.com/Garblesnarff/infinite-realms-production/commit/de6c0afe244286ea8a85a2d4c90750f9e3ea9463))
* add comprehensive coverage for voice services ([#456](https://github.com/Garblesnarff/infinite-realms-production/issues/456)) ([b1c4e01](https://github.com/Garblesnarff/infinite-realms-production/commit/b1c4e01a75b6d075c808a574a94b0d3d8f97411f))
* add comprehensive tests for environment validation utility ([#514](https://github.com/Garblesnarff/infinite-realms-production/issues/514)) ([37e12da](https://github.com/Garblesnarff/infinite-realms-production/commit/37e12da8e153dadb5571b3f192e2516e54a38bf2))
* Add comprehensive unit tests and fix bugs in regex-parser ([#747](https://github.com/Garblesnarff/infinite-realms-production/issues/747)) ([de40d3f](https://github.com/Garblesnarff/infinite-realms-production/commit/de40d3f7cd49312d83758e36e93e5a54cfb8f5f1))
* add comprehensive unit tests for AABB utilities ([#680](https://github.com/Garblesnarff/infinite-realms-production/issues/680)) ([3feaa7e](https://github.com/Garblesnarff/infinite-realms-production/commit/3feaa7eb2c4fa314a3cfd0e3aa2dc4b2620239e5))
* add comprehensive unit tests for AIService ([#1061](https://github.com/Garblesnarff/infinite-realms-production/issues/1061)) ([c271c7d](https://github.com/Garblesnarff/infinite-realms-production/commit/c271c7dab1ba752327b30503a2efd0378eb36a04))
* add comprehensive unit tests for classFeatures utilities ([f41aa1d](https://github.com/Garblesnarff/infinite-realms-production/commit/f41aa1df87e751c0fae9af232922edc5cb8312d2))
* add comprehensive unit tests for CombatSequenceValidator ([8c536cb](https://github.com/Garblesnarff/infinite-realms-production/commit/8c536cb7f2811a073dd071fa4e14d247bc278634))
* add comprehensive unit tests for exhaustionUtils ([a45e9d2](https://github.com/Garblesnarff/infinite-realms-production/commit/a45e9d25f7d76802d32f4108f6df6049aa503d75))
* Add comprehensive unit tests for lore-keeper-mcp-server ([7d92855](https://github.com/Garblesnarff/infinite-realms-production/commit/7d9285574bbc72bd906d0c7ebf1c9004436814d7))
* add comprehensive unit tests for NPCAutoRoller service ([0398213](https://github.com/Garblesnarff/infinite-realms-production/commit/03982133c68b9ba1436488edcc0d59ba716e76d9))
* add comprehensive unit tests for useAdvancedSpellcasting hook ([#345](https://github.com/Garblesnarff/infinite-realms-production/issues/345)) ([a7b50cc](https://github.com/Garblesnarff/infinite-realms-production/commit/a7b50ccfa9434c02076ed8ca0528a74f9a28fd44))
* add comprehensive unit tests for verbalized-sampling parser ([#1270](https://github.com/Garblesnarff/infinite-realms-production/issues/1270)) ([66e238a](https://github.com/Garblesnarff/infinite-realms-production/commit/66e238a2f045a7d15515a28e29aea6283c821f55))
* add regression e2e for XML world-update accounting vs DB write outcomes ([477a62a](https://github.com/Garblesnarff/infinite-realms-production/commit/477a62a5916f5b1231c666b5865504ae76ec8e1e))
* add regression tests for session continuity and memory write integrity ([8236ea4](https://github.com/Garblesnarff/infinite-realms-production/commit/8236ea47365bae6e406d5469154c73898af7d7f5))
* add tests and fix null crash in useHotkeys hook ([2e0bf79](https://github.com/Garblesnarff/infinite-realms-production/commit/2e0bf79771bd97b7aae75fe644033a202f6e2014))
* add tests and fix type predicate in session-utils.ts ([e9798ca](https://github.com/Garblesnarff/infinite-realms-production/commit/e9798ca6596b2ee511ec8d3963c3009148686eb5))
* add tests for DiceRollRequest component ([ab50d42](https://github.com/Garblesnarff/infinite-realms-production/commit/ab50d4259c6a1acf45ef5a759d814fba7a720203))
* add tests for geometry and lighting-utils ([8f7815a](https://github.com/Garblesnarff/infinite-realms-production/commit/8f7815ae193344432509be99d975877b7496b856))
* add tests for useMagicItemAttunement hook ([0784404](https://github.com/Garblesnarff/infinite-realms-production/commit/07844048eccf77d70ffabcb1873ce5f88d700756))
* add tests for useMessageQueue hook ([f737a20](https://github.com/Garblesnarff/infinite-realms-production/commit/f737a20b995ec1ac3ae13776f7cd9c8d2557e3f0))
* add unit tests for blog-service.ts ([#1282](https://github.com/Garblesnarff/infinite-realms-production/issues/1282)) ([dd45f21](https://github.com/Garblesnarff/infinite-realms-production/commit/dd45f21fdea6b485bb7641484183ae763c20f4de))
* add unit tests for drawing undo/redo and keyboard shortcuts hooks ([#1376](https://github.com/Garblesnarff/infinite-realms-production/issues/1376)) ([0c08a2c](https://github.com/Garblesnarff/infinite-realms-production/commit/0c08a2c04bde8b495e8788a528534862808597ea))
* add unit tests for useExperienceManager hook ([#1235](https://github.com/Garblesnarff/infinite-realms-production/issues/1235)) ([d49f7c8](https://github.com/Garblesnarff/infinite-realms-production/commit/d49f7c8033dcc054dfa266af062cb4e95b4d6167))
* add unit tests for useGameData hook ([#1215](https://github.com/Garblesnarff/infinite-realms-production/issues/1215)) ([d59fb8c](https://github.com/Garblesnarff/infinite-realms-production/commit/d59fb8cac19e5abacf00f2d9b37deacdea47cd15))
* add unit tests for useIndexedDBCleanup hook ([#495](https://github.com/Garblesnarff/infinite-realms-production/issues/495)) ([a95ac21](https://github.com/Garblesnarff/infinite-realms-production/commit/a95ac2138f4b96b69a7eb8dae84016a7cbc14372))
* **ai:** add comprehensive tests for AI shared utilities ([#1245](https://github.com/Garblesnarff/infinite-realms-production/issues/1245)) ([1e185af](https://github.com/Garblesnarff/infinite-realms-production/commit/1e185af226a951c109f435419fb26d6cedce94a6))
* **ai:** add comprehensive tests for ContextBuilder ([af78997](https://github.com/Garblesnarff/infinite-realms-production/commit/af78997c43dfff9937e1f258a51921cbdeea3a95))
* **ai:** add unit tests for world-update-processor ([#1279](https://github.com/Garblesnarff/infinite-realms-production/issues/1279)) ([5214011](https://github.com/Garblesnarff/infinite-realms-production/commit/521401124ab183fe14d550c811ff73d5f4052de9))
* **ai:** observe retry rejection before fake timers ([014062c](https://github.com/Garblesnarff/infinite-realms-production/commit/014062ca0c1214f0221b37c806b61dc2d2867ab7))
* **combat:** Add deathSaveFailuresAdded to mock damage results ([6b50292](https://github.com/Garblesnarff/infinite-realms-production/commit/6b5029244491c20a19ccca8270d85771bbad6ea4))
* **combat:** cover three-turn responsive encounter ([44fe056](https://github.com/Garblesnarff/infinite-realms-production/commit/44fe056b83982f432157aacc6bf95de323c26c5e))
* cover bounded tactical retry dispatch ([86c7b90](https://github.com/Garblesnarff/infinite-realms-production/commit/86c7b90447a35600ef41258597f6c01970729084))
* fix messaging and memory test setup for IndexedDB/vitest environment ([242ce7f](https://github.com/Garblesnarff/infinite-realms-production/commit/242ce7f0e0e30e9dc7799c03dbe375e02aeb4d44))
* **hooks/ai:** add comprehensive unit tests for session-logger ([#375](https://github.com/Garblesnarff/infinite-realms-production/issues/375)) ([06ccfb5](https://github.com/Garblesnarff/infinite-realms-production/commit/06ccfb5941dced322f39beb3f5730f04cfaee72d))
* **hooks:** add comprehensive tests for useSessionManagement ([#588](https://github.com/Garblesnarff/infinite-realms-production/issues/588)) ([a3b91a2](https://github.com/Garblesnarff/infinite-realms-production/commit/a3b91a245befca91b0cd44b725a9c0784cfdc7a8))
* **hooks:** add comprehensive unit tests for useMulticlassing hook ([8230286](https://github.com/Garblesnarff/infinite-realms-production/commit/823028646372a6368ae9d6a53a033b826afd4168))
* replace vitest allowlist with globs; delete dead code ([4e5662f](https://github.com/Garblesnarff/infinite-realms-production/commit/4e5662f2403f2dea179c5613580b15ea00185c58))
* script tactical three-turn combat flow ([7a4ea1f](https://github.com/Garblesnarff/infinite-realms-production/commit/7a4ea1f860013dccaa40348d9b0c99094a4703d7))
* **services:** add comprehensive tests for PersonalityService ([#597](https://github.com/Garblesnarff/infinite-realms-production/issues/597)) ([ab7698a](https://github.com/Garblesnarff/infinite-realms-production/commit/ab7698aa5694febd03d1c98a3fd52c49dae99271))
* **tactical:** cover move refusal round trip ([2836ceb](https://github.com/Garblesnarff/infinite-realms-production/commit/2836ceb63ee6dbdf9c4ae93918e62554dbb921c6))
* **tactical:** validate engine and generated maps ([b23f7d0](https://github.com/Garblesnarff/infinite-realms-production/commit/b23f7d087ec3ac390246dcdf8a953914362b2ad7))
* **utils:** add comprehensive tests for conditionEffects.ts and fix logic bugs ([8fd5636](https://github.com/Garblesnarff/infinite-realms-production/commit/8fd56367fdfc7bca20c0bb875e1f2eab2f0d7a62))
* **utils:** add comprehensive tests for spell-id-mapping ([#532](https://github.com/Garblesnarff/infinite-realms-production/issues/532)) ([8c93349](https://github.com/Garblesnarff/infinite-realms-production/commit/8c9334992aa500b0558e4fe2e6e356297993b819))
* **utils:** improve visual prompt extraction and coverage ([#1127](https://github.com/Garblesnarff/infinite-realms-production/issues/1127)) ([832ed23](https://github.com/Garblesnarff/infinite-realms-production/commit/832ed2341ba94f4096be76c300aa9e4dd5b19bed))
