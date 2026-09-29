# NetArchitect — Phased Implementation Plan

Offline-first IPv4 subnetting, VLSM, VLAN planning, and network design assistant.
React Native + Expo + TypeScript. No backend. No network calls. Ever.

---

## 0. Verified Stack Decisions

Checked against current upstream docs (Sept 2026). These are decisions, not suggestions —
implement them in this order and the project will build clean.

| Concern               | Decision                                                        | Rationale / Gotcha                                                                                                                                                                                                                   |
| --------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Expo SDK              | **57 (latest stable)**                                          | SDK 58 is beta. Do not start on a beta.                                                                                                                                                                                              |
| NativeWind            | **v4.2.7 + Tailwind CSS ^3.4.17**                               | v5 (CSS-first, no `tailwind.config.js`) is **still RC**. Do not build on an RC.                                                                                                                                                      |
| NativeWind scaffold   | `npx rn-new --nativewind`                                       | Official path. Generates `global.css`, `nativewind-env.d.ts`, metro + babel wiring.                                                                                                                                                  |
| NativeWind types file | MUST be named `nativewind-env.d.ts`                             | Naming it `nativewind.d.ts` shadows the package types and **silently breaks** typechecking.                                                                                                                                          |
| Reanimated            | `react-native-reanimated` **+ `react-native-worklets`**         | SDK 57 ships Reanimated 4; worklets is a required peer. NativeWind v4 needs Reanimated.                                                                                                                                              |
| DB                    | `expo-sqlite` async API + `PRAGMA user_version` migrations      | Do **not** add Drizzle/Knex. Spec says simple schema; the built-in migration pattern is sufficient.                                                                                                                                  |
| UI kit                | **Custom lightweight component system**, not React Native Paper | Paper's MD3 theming and NativeWind are competing styling paradigms. Fighting both is the single most common cause of UI debt in this stack. NativeWind + ~8 small primitives is cleaner and matches the "networking tool" aesthetic. |
| Charts                | **react-native-svg only**, hand-rolled                          | A chart library (victory-native, etc.) is not "necessary" for a stacked address-space bar. Skip the dependency.                                                                                                                      |
| Tests                 | **Vitest, pure logic only**                                     | See Risk R4 re: component tests.                                                                                                                                                                                                     |
| AsyncStorage          | `@react-native-async-storage/async-storage`                     | Per spec. Note: `expo-sqlite/kv-store` is a drop-in with **sync** APIs and would remove a dependency — flag as an optional simplification, not a default.                                                                            |

### Final dependency list

**Runtime**
`expo` · `expo-router` · `expo-sqlite` · `expo-constants` · `expo-status-bar` ·
`expo-clipboard` · `expo-file-system` · `expo-sharing` · `expo-haptics` ·
`react-native-reanimated` · `react-native-worklets` · `react-native-safe-area-context` ·
`react-native-screens` · `react-native-svg` · `nativewind` ·
`zustand` · `zod` · `react-hook-form` · `@hookform/resolvers` ·
`lucide-react-native` · `@react-native-async-storage/async-storage`

**Dev**
`typescript` · `vitest` · `eslint` · `eslint-config-expo` · `prettier` ·
`prettier-plugin-tailwindcss` · `babel-preset-expo` · `@types/react`

`expo-clipboard`, `expo-file-system`, `expo-sharing` are gated to Phase 14. Everything else is
needed from Phase 0.

### Non-negotiable architectural rules

1. `src/core/**` imports **nothing** from `react`, `react-native`, `expo-*`, or `@/` components.
   It is a pure, portable TypeScript library. This is what makes it testable in Node and is the
   single most important structural decision in the project.
2. Networking math lives **only** in the engine. UI never computes an address, mask, or count.
3. Every calculation is derived. No hardcoded subnets, no hardcoded profile addresses, no
   placeholder results. Profile templates supply _host hints_; the VLSM engine derives addresses.
4. SQLite is the source of truth for saved plans. Zustand holds transient editor state and UI
   preferences only.
5. Nothing ships over a network. There is no `fetch` in the codebase, and CI should assert this.

---

## 1. The IPv4 Math Contract

This is the correctness core. Write it down, encode it in tests, and never deviate.

### 1.1 Representation

Addresses are stored as unsigned JS `number` in `[0, 2^32-1]`. `2^32 = 4294967296` is below
`Number.MAX_SAFE_INTEGER`, so plain numbers are safe — **provided every bitwise result is coerced
with `>>> 0`**. JS bitwise operators work on _signed_ int32; this is the whole bug class.

```ts
const U32_MAX = 0xffffffff;

const cidrToMask = (prefix: number): number =>
  prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0; // <<32 is shift-by-0 in JS!
const wildcardFromMask = (mask: number): number => ~mask >>> 0;
const networkOf = (ip: number, mask: number): number => (ip & mask) >>> 0;
const broadcastOf = (net: number, wildcard: number): number => (net | wildcard) >>> 0;
const sizeOf = (prefix: number): number => 2 ** (32 - prefix);
```

**The `prefix === 0` special case is mandatory.** JS shifts mask the count to 5 bits, so
`0xffffffff << 32 === 0xffffffff` — the naive expression returns a /0 mask of all-ones, and every
/0 calculation silently produces wrong results. This is the classic IPv4 JS bug. It gets a
dedicated test.

### 1.2 Parsing rules

- Exactly 4 dot-separated octets, each an integer `0–255`.
- **Reject leading zeros** (`"010.1.1.1"`). Ambiguous between decimal and octal; silently
  guessing is how people get burned. Return a clear error.
- Reject empty octets, non-numeric octets, trailing dots, extra segments, whitespace
  (trim at the boundary, not inside).
- `parseCidr` accepts both `192.168.1.50/24` and `{ ip, prefix }`. It does **not** require the
  address to be a network boundary — see §1.5.

### 1.3 Usable host rules

| Prefix | Usable     | First     | Last             | Note                                                                |
| ------ | ---------- | --------- | ---------------- | ------------------------------------------------------------------- |
| `0–30` | `size - 2` | `net + 1` | `net + size - 2` | Standard                                                            |
| `31`   | `2`        | `net`     | `net + 1`        | **RFC 3021** point-to-point. Network and broadcast are both usable. |
| `32`   | `1`        | `ip`      | `ip`             | Host route. Network = broadcast = address. Flag `isHostRoute`.      |

`/0` must yield `totalAddresses 4294967296`, `usableHosts 4294967294`.

### 1.4 Smallest-block lookup (no floating point)

Never use `Math.log2` or `Math.ceil(Math.log2(n))` — float edge cases bite at exact powers of two,
which is precisely the common case for subnetting. Use an integer search:

```ts
const smallestHostBits = (hosts: number, min = 2): number => {
  for (let bits = min; bits <= 30; bits++) if (2 ** bits - 2 >= hosts) return bits;
  throw new ScopeExhaustionError(hosts);
};
```

`min = 2` for LAN roles (`/30` = 2 usable is the floor). `min = 1` for Point-to-Point roles
(`/31` = 2 usable per RFC 3021).

### 1.5 Boundary vs. host address

`192.168.1.50/24` is a valid **CIDR reference** (an address within a network) but an invalid
**subnet definition**. The engine models this explicitly:

- `parseCidr()` accepts any host address.
- `isNetworkBoundary(cidr)` → `ip & mask === ip`.
- `validateSubnet()` **rejects** non-boundary input with `InvalidSubnetBoundaryError` — this is
  what the planner's subnet rows and SEC-003 use.
- For the **parent network** input, do not error on `192.168.1.50/24`. Normalize to
  `192.168.1.0/24` and surface an inline notice: _"Host bits set — normalized to
  192.168.1.0/24."_ Correctness without punishing the user for a very common input.

### 1.6 Overlap detection

Model every allocation as a half-open interval `[start, end]`. Overlap is:

```
aStart < bEnd && bStart < aEnd
```

with `end` inclusive. Use this one primitive for SEC-001, SEC-015, and the VLSM post-condition
assertion.

### 1.7 Capacity vs. assignable

Once a gateway is assigned, it consumes an address. Track both, or the utilization numbers lie:

- `hostCapacity` = usable hosts from the mask (e.g. 126 for /25)
- `assignableHosts` = `hostCapacity - 1` when a gateway exists
- `utilization` = `requestedHosts / hostCapacity`

### 1.8 Reserved space (needed by the auditor)

`0.0.0.0/8` this-network · `10/8`, `172.16/12`, `192.168/16` RFC 1918 · `100.64/10` CGNAT ·
`127/8` loopback · `169.254/16` link-local · `224/4` multicast · `240/4` reserved ·
documentation ranges `192.0.2/24`, `198.51.100/24`, `203.0.113/24`. VLAN valid range **1–4094**
(0 and 4095 reserved).

Full table in §1.9, with the RFC that defines each range. `src/core/standards.ts` is the single
source of truth for these citations so the UI can attribute them.

### 1.9 Network Standards & Citations

The goal is that a network engineer reviewing this app finds nothing technically wrong, and that
every recommendation traces to a published standard rather than to taste. Two concrete rules:

1. **Cite the source.** Every reserved range, every auditor rule, and every generated-config
   convention carries its RFC/IEEE reference in `src/core/standards.ts`, surfaced in the UI as
   "Per RFC 1918". Unattributed advice is the thing that gets an app dismissed.
2. **Never invent a rule.** If a check cannot be justified by a standard or a universal design
   practice, it does not ship. False positives cost more trust than a missing check.

#### IPv4 address space (IANA Special-Purpose Address Registry)

| Range             | Name                                                 | Source             |
| ----------------- | ---------------------------------------------------- | ------------------ |
| `0.0.0.0/8`       | "This network" — not a valid host source address     | RFC 1122, RFC 1912 |
| `10.0.0.0/8`      | Private-Use                                          | RFC 1918           |
| `100.64.0.0/10`   | Shared Address Space (CGNAT)                         | RFC 6598           |
| `127.0.0.0/8`     | Loopback — must be handled internally, never routed  | RFC 1122           |
| `169.254.0.0/16`  | Link-Local (APIPA)                                   | RFC 3927           |
| `172.16.0.0/12`   | Private-Use — **`172.16.0.0`–`172.31.255.255` only** | RFC 1918           |
| `192.0.0.0/24`    | IETF Protocol Assignments                            | RFC 6890           |
| `192.0.2.0/24`    | TEST-NET-1 (documentation)                           | RFC 5737           |
| `192.168.0.0/16`  | Private-Use                                          | RFC 1918           |
| `198.18.0.0/15`   | Benchmarking                                         | RFC 2544           |
| `198.51.100.0/24` | TEST-NET-2 (documentation)                           | RFC 5737           |
| `203.0.113.0/24`  | TEST-NET-3 (documentation)                           | RFC 5737           |
| `224.0.0.0/4`     | Multicast                                            | RFC 5771           |
| `240.0.0.0/4`     | Reserved for future use                              | RFC 1112           |

**The `172.16.0.0/12` boundary is the single most common networking error.** It is a `/12`, not a
`/16`: it spans 16 contiguous `/16` blocks from `172.16.0.0` to `172.31.255.255`. `172.32.0.0` is
**public**. The engine must classify it as public, and a dedicated test must pin it. The
calculator surfaces the classification so a student learns the boundary by using it.

#### Subnetting and CIDR

| Topic                            | Standard                                | Engineering consequence in this app                                                                                                                                                                                       |
| -------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CIDR notation, route aggregation | **RFC 4632** (supersedes RFC 1518/1519) | Classless throughout. Never present `/8`, `/16`, `/24` as "Class A/B/C" — that framing is obsolete and is flagged as such in Learning Mode.                                                                               |
| Host route `/32`                 | RFC 4632 §3.2                           | `/32` = 1 address, all fields equal. Primary use: loopback interfaces, router-IDs, anycast, and NAT outside local-subnet mappings.                                                                                        |
| P2P `/31`                        | **RFC 3021**, see also RFC 4637         | 2 usable addresses, both endpoints usable. **RFC 3021 Appendix A requires the pair be an even/odd pair.** VLSM therefore aligns `/31` allocations to even boundaries. Professional plans honour this; naive tools do not. |
| `0.0.0.0` semantics              | RFC 1912                                | Never a usable host address.                                                                                                                                                                                              |
| Broadcast not forwardable        | **RFC 1812 §5.3.7**                     | A router must not forward a datagram with a broadcast destination. Justifies the auditor's "gateway must not be the broadcast address" rule.                                                                              |
| Subnet-zero / all-ones subnets   | **RFC 7600**                            | Permitted today. Cisco `ip subnet-zero` has defaulted to **on** since IOS 15.0. **The auditor must NOT warn about using subnet zero or the all-ones subnet** — doing so is a classic false positive.                      |
| Broadcast domain sizing          | Universal practice                      | `/24` is the practical ceiling for a broadcast domain. `/25`–`/30` for access segments, `/31` for routed links, `/32` for loopbacks. Drives SEC-010.                                                                      |

#### VLANs and switching

| Topic                                  | Standard                                   | Consequence                                                                                                                                                               |
| -------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VLAN ID range **1–4094**               | **IEEE 802.1Q** (current rev. 802.1Q-2022) | VID 0 is priority-tagged and deprecated by 802.1Q-2011; VID 4095 is reserved. Both rejected → SEC-006.                                                                    |
| One broadcast domain per VLAN          | IEEE 802.1D, 802.1Q                        | Every VLAN is a separate L2 broadcast domain and a separate IP subnet. A VLAN spanning two subnets, or two VLANs sharing a subnet, is a design error the auditor reports. |
| Sub-interfaces / router-on-a-stick     | 802.1Q + vendor CLI                        | Sub-subnet-per-VLAN requires a router sub-interface per VLAN. Drives the generated Cisco config.                                                                          |
| Port security, no native-VLAN surprise | 802.1Q                                     | Templates should set the native VLAN explicitly, not leave it implicit.                                                                                                   |

#### Security design principles

| Principle                               | Source                                      | Auditor rule                                                                                                                                                                                     |
| --------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No implicit trust from network location | **NIST SP 800-207** (Zero Trust)            | SEC-007, SEC-008: guest/IoT must not share a broadcast domain with trusted users.                                                                                                                |
| Network must not be assumed secure      | **RFC 2050**; " Schneier on Security" model | The mandatory disclaimer. This app performs **static design review only** — it does not scan, test, audit, or guarantee a network. Say so, prominently, on the audit screen and in every export. |
| Segmentation limits blast radius        | NIST SP 800-207, SP 800-41                  | SEC-010, SEC-013.                                                                                                                                                                                |
| Management plane separated              | Universal practice; CIS Benchmarks          | SEC-009: management segment should be small — `/28` or smaller (≤14 usable), not `/16`.                                                                                                          |
| DMZ between trust boundaries            | NIST SP 800-41 firewall topology            | SEC-013: DMZ must not be nested inside, or share a subnet with, the internal LAN.                                                                                                                |
| Host firewall baseline                  | CIS Benchmarks                              | The iptables template emits a stateful baseline with comments, as a starting point only.                                                                                                         |

#### Address-space hygiene the app must not get wrong

- **RFC 1918 is not routable on the public internet.** Internal use of public address space is legal
  only with deliberate NAT, and it is a common source of accidental internet exposure. Report as
  Info, not Critical — it is a design note, not an error.
- **CGNAT `100.64.0.0/10` is not private space.** It is shared/carrier space. It must not be used
  for internal enterprise addressing.
- **A subnet in a documentation range** (`192.0.2.0/24` etc.) is fine for labs and examples, which
  is exactly this app's use case. Report as Info only.
- **Address exhaustion is a real design constraint.** A plan that allocates a `/16` to a 12-person
  management group is a finding, not a style preference.

#### Citation surface in the product

`src/core/standards.ts` exports typed constants, e.g. `STANDARD_REFS.RFC1918 = 'RFC 1918 §3'`, and
`ReservedRangeKind` entries carry a `citation` field. The IP Calculator renders
"Private-Use (RFC 1918)" as the address-space badge, and every `SecurityIssue` renders a small
"Reference: RFC 1918" line. This is what separates a professional tool from a student calculator.

---

## 2. Domain Model

`src/types/network.ts`. Discriminated unions, no `any`, no optional-by-laziness.

```ts
type AddressFamily = 'ipv4' | 'ipv6'; // ipv6 reserved; no ipv6 logic ships in v1

type Cidr = { readonly family: AddressFamily; readonly ip: number; readonly prefix: number };

type SubnetInfo = {
  readonly cidr: Cidr;
  readonly networkAddress: number;
  readonly broadcastAddress: number;
  readonly subnetMask: number;
  readonly wildcardMask: number;
  readonly firstUsableHost: number;
  readonly lastUsableHost: number;
  readonly totalAddresses: number;
  readonly usableHosts: number;
  readonly hostBits: number;
  readonly networkBits: number;
  readonly isHostRoute: boolean; // /32
  readonly isPointToPoint: boolean; // /31
  readonly reservedRange?: ReservedRangeKind;
};

type NetworkRole =
  'LAN' | 'SERVERS' | 'MANAGEMENT' | 'IOT' | 'GUEST' | 'DMZ' | 'VOIP' | 'POINT_TO_POINT' | 'CUSTOM';

type Severity = 'critical' | 'high' | 'medium' | 'info';

type SecurityIssue = {
  readonly ruleId: string; // 'SEC-003'
  readonly severity: Severity;
  readonly title: string;
  readonly problem: string;
  readonly whyItMatters: string;
  readonly remediation: string;
  readonly affectedSubnetIds: readonly string[];
};

type PlanProfile = 'custom' | 'personal' | 'enterprise';
```

**IPv6 forward-compat without pretending:** `AddressFamily` exists in the type layer, and
`parseCidr` throws a clear `UnsupportedFamilyError` for IPv6 with a message stating v1 is
IPv4-only. Types reserve the slot; behavior does not fake results. That satisfies "designed for
future expansion."

**Custom roles:** `CUSTOM` carries a `customRoleLabel: string`. User-created roles persist in a
`custom_roles` table from Phase 9 so they survive reinstall-free across sessions.

---

## 3. Phases

Effort is a rough engineering-day estimate for someone fluent in this stack.

### Progress

Status is verified against the working tree, not against intent. Re-check it before trusting it.

| Phase                        | Status      | Artefacts                                                                     | Tests            |
| ---------------------------- | ----------- | ----------------------------------------------------------------------------- | ---------------- |
| 0 — Scaffold & Toolchain     | **PARTIAL** | all config present and asserted; **git repo created and pushed; app never booted on a device** | 0 (runner works) |
| 1 — Types, Constants, Errors | **DONE**    | `src/types/network.ts`, `src/core/errors.ts`, `src/core/standards.ts`, `src/utils/formatting.ts` | 22 |
| 2 — IPv4 Engine              | **DONE**    | `src/core/ip-engine.ts`                                                       | 141              |
| 3 — VLSM Engine              | **DONE**    | `src/core/vlsm-engine.ts`                                                     | 50               |
| 4 — Validation Layer (Zod)   | **DONE**    | `src/core/validation.ts`                                                      | 100              |
| 5 — Shell, Theme, Primitives | **DONE**    | 8 routes, 14 components, `src/theme/`, 3 verification scripts                  | 18 (`cn`)        |
| 6 — IP Calculator            | **DONE**    | `src/core/calculator-input.ts`, `src/utils/subnet-view.ts`, `src/components/CidrInput.tsx`, `src/components/IpResultCard.tsx`, real `app/(tabs)/calculator.tsx` | 291 |
| 7 — VLSM Allocator          | **DONE**    | `src/core/roles.ts`, `src/core/vlsm-input.ts`, `src/utils/vlsm-view.ts`, `src/utils/table-layout.ts`, `src/store/vlsm-store.ts`, `src/hooks/useDebouncedValue.ts`, 3 components, real `app/(tabs)/vlsm.tsx` | 559 |
| 8 — Network Planner         | **DONE**    | `src/core/profiles.ts`, `src/core/planner-input.ts`, `src/core/plan-changes.ts`, `src/utils/planner-view.ts`, `src/store/plan-store.ts`, 3 components, real `app/(tabs)/planner.tsx` | 329 |
| 9 — Persistence             | **DONE**    | `src/database/migrations.ts`, `src/database/database.ts`, `src/database/plans-repository.ts`, `src/store/network-store.ts` | — |
| 10–16                         | not started | —                                                                             | —                |

Suite: **1179 passing** across 17 files. `npx tsc --noEmit` clean. `npx eslint .` clean (0 errors,
0 warnings). Coverage 97.98% stmts / 94.15% branches / **100% funcs** / 98.8% lines against
thresholds 95/90/95/95. (Coverage from Phase 7 run; Phase 8+9 not re-measured.)

`npm run verify` is the gate, and it exits 0: typecheck → lint → format → test → `check:classes` →
`verify:theme:all` (web/ios/android) → a real `expo export` → `verify:bundle`. Two of those steps
exist because bugs got through every other step; see the Phase 5 section. `verify:bundle` now
asserts **35 route-content markers** across the three finished screens, plus 53
stylesheet/token/utility markers and 18 negative-control checks that prove the marker search
discriminates.

**The device gap is now the largest thing left, and it is one task, not many.** `npx expo start`
has never been run, `npx expo-doctor` has never been run, and the following have therefore never
been looked at by a human on a real screen:

- Either screen rendering at all, on either platform.
- Light and dark mode, on a phone and on a tablet.
- VoiceOver and TalkBack reading every field label on all three screens.
- The VLSM table scrolling without clipping at 320 points.
- `SubnetBar` segments dividing evenly — plain `View`s with `flexBasis: 0; flexGrow: share`, so
  this is a rendering question with no unit-testable answer.
- **Everything the planner screen renders.** Three components, a template sheet, a change
  preview and seven fields per subnet row, none of it ever displayed. `rowCardTone`, the
  `Resolved` block's em-dash alignment and the two sheets' footers are all visual claims with
  no test behind them.

Every compile-level check passes, and every one of these is invisible to a compile-level check.
R4 makes the device pass the primary UI verification mechanism rather than a supplement, so until
it happens the UI is unverified — not "probably fine".

**Phase 0 is still PARTIAL, and the reason is not a code gap.** The toolchain is complete and
verified, and the git repository now exists (`main` at `46cf9ec`, tracking `origin/main`, working
tree clean). What remains is that `npx expo start` has **never been executed**, so "renders on one
Android and one iOS device" — Phase 0's own exit criterion, and the prerequisite for Phase 5's —
remains entirely unmeasured. The exact outstanding work is listed under each phase below.

---

### Phase 0 — Scaffold & Toolchain · ~0.5 day

**Status: PARTIAL — scaffolding and test runner only.**

**Goal:** a running app with the build pipeline correct, verified on device before any product code.

- `npx rn-new --nativewind` (Expo blank, TypeScript) into the project root.
- Verify `expo-router` wired; confirm `app/_layout.tsx` + `app/index.tsx` boot.
- Add deps. Run `npx expo-doctor` — must be clean.
- `tsconfig.json`: `"strict": true`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
  `exactOptionalPropertyTypes`, `paths: { "@/*": ["./src/*"] }`.
- `vitest.config.ts` — **separate from any RN preset**: `environment: 'node'`,
  `include: ['tests/**/*.test.ts']`, alias `@ → ./src`.
- `.eslintrc` via `eslint-config-expo` + `prettier` with `prettier-plugin-tailwindcss`.
- `app.json`: name, slug, `bundleIdentifier`/`package`, dark+light `userInterfaceStyle: 'automatic'`,
  `newArchEnabled: true`. `expo-router` plugin. Set `"web": { "bundler": "metro" }` per NativeWind.
- `app.json` SDK 57 extra: `"experiments": { "typedRoutes": true }` for type-safe navigation.
- Git init + `.gitignore`. Commit the clean scaffold **before** writing features.

**Exit criteria:** `npx expo start` renders on one Android and one iOS device/simulator;
`npx tsc --noEmit` clean; `npm test` runs (0 tests is fine); ESLint clean.

**Watch:** if you scaffold with `create-expo-app` instead of `rn-new --nativewind`, you must
manually add the metro `withNativeWind(config, { input: './global.css' })` wrapper, the
`["babel-preset-expo", { jsxImportSource: "nativewind" }]` + `nativewind/babel` presets, and
`nativewind-env.d.ts`. `rn-new` does all three.

#### Phase 0 — what is still outstanding

**Status: PARTIAL. Every code item below is done. What remains is not code.**

We used `create-expo-app` (blank-typescript), so the `Watch:` note applies and the NativeWind
wiring was manual. All of it is now in place and — unlike a config that merely exists — is
*asserted*: `scripts/verify-theme.cjs` fails the build if the stylesheet pipeline loses a rule,
because it already did, twice.

_Done:_

- Expo SDK 57 project; all runtime and dev dependencies installed and resolving.
- `vitest.config.mts` — Node env, `include: ['tests/**/*.test.ts']`, alias `@ → ./src`, coverage
  thresholds 95/90/95/95. Renamed from `.ts` to clear a Node ESM/CJS warning; setting
  `"type": "module"` in `package.json` would have been the wrong fix, because it breaks the CJS
  Metro and Babel configs an Expo app needs.
- `tsconfig.json` — `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
  `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`, `noUnusedLocals`,
  `noUnusedParameters`, `forceConsistentCasingInFileNames`, `paths: { "@/*": ["./src/*"] }`. Every
  one is documented inline with the defect it catches.
- NativeWind wiring, all manual: `tailwind.config.js` (`darkMode: 'class'`, `nativewind/preset`),
  `global.css` (top-level tokens, **not** `@layer base`), `metro.config.js`
  (`withNativeWind(..., { input: './global.css' })`), `babel.config.js` (`jsxImportSource:
  "nativewind"` + `nativewind/babel`), `nativewind-env.d.ts` — named correctly, since
  `nativewind.d.ts` shadows the package and breaks the type reference.
- `app.json` — `name`/`slug` `NetArchitect`/`netarchitect`, `userInterfaceStyle: "automatic"`,
  `newArchEnabled: true`, `web.bundler: "metro"`, `experiments.typedRoutes: true`, iOS
  `bundleIdentifier`, Android `package`, URL `scheme`, `supportsTablet`, and the four plugins.
- `eslint.config.js` (flat, via `eslint-config-expo/flat` — the bare default export is eslintrc-shaped
  and ESLint 9 refuses to load it), `.prettierrc`, `.prettierignore`.
- npm scripts: `test`, `test:watch`, `test:coverage`, `typecheck`, `lint`, `lint:fix`, `format`,
  `format:check`, `doctor`, `check`, `verify:theme`, `verify:theme:all`, `verify:bundle`,
  `check:classes`, `export:probe`, `verify`.
- `app/_layout.tsx` and `app/index.tsx` exist, with all 8 routes and a redirect.
- `.gitignore`.

_Outstanding — not code, and the first item is now the only one that blocks other work:_

- ~~**`git init` has still not been run.**~~ **Done** as of the initial commit on `main`
  (remote `origin` → `https://github.com/Lance0519/NetArchitect.git`). The five phases before it
  were never versioned, so the five tooling bugs found since Phase 2 have no revert path — that loss
  is permanent, but it does not recur.
- **`npx expo start` has never been executed**, so `.expo/types/router.d.ts` does not exist and
  `experiments.typedRoutes` is inert. Until it does, `href` strings in `app/` are plain strings that
  TypeScript will not check — a typo in a route name compiles fine and fails at navigation time.
  Run `expo start` once, then re-run `typecheck` to turn those into compile errors.
- **`npx expo-doctor` has never been run.** The plan asks for it to be clean; it has never been
  executed, so that claim is untested rather than true.
- **No device pass.** Phase 0's exit criterion is "renders on one Android and one iOS
  device/simulator" and it is entirely unverified. Same for light/dark on a real phone and tablet,
  which is Phase 5's outstanding exit criterion. Every compile-level check passes, which proves the
  tokens reach the bundle — it cannot prove a human sees a correct screen. This is the single
  largest unverified gap in the project, and R4's decision below makes it the primary UI
  verification mechanism rather than a supplement to one.

---

### Phase 1 — Types, Constants, Errors · ~0.5 day

**Status: DONE.**

**Goal:** the vocabulary every later phase depends on. Small, but do it first.

- `src/types/network.ts` per §2.
- `src/utils/constants.ts` — severity color tokens, role metadata (label, icon, default VLAN
  range, default description), reserved ranges, `SECURITY_DISCLAIMER` text.
- `src/core/errors.ts` — `NetArchitectError` base carrying `code`; subclasses
  `InvalidIPv4Error`, `InvalidCIDRError`, `InvalidPrefixError`, `InvalidSubnetBoundaryError`,
  `ScopeExhaustionError`, `SubnetOverlapError`, `InvalidVLANError`, `InvalidGatewayError`,
  `UnsupportedFamilyError`. Each with a user-facing `friendlyMessage`.
- `src/utils/formatting.ts` — `intToIp()`, `formatCidr()`, `formatPercent()`, `formatAddressCount()`
  (with thousands separators; `4294967294` must render as `4,294,967,294`).

**Exit criteria:** `tsc --noEmit` clean; `formatting.test.ts` passing for the large-number and
`/0` cases.

**Note:** engine functions return raw integers. `formatting.ts` is the _only_ place that turns them
into strings, and it lives outside `core/` precisely so the engine stays string-free.

#### Phase 1 — what was done, and two decisions worth keeping

_Done:_

- `src/types/network.ts` — the full domain model per §2.
- `src/core/errors.ts` — all nine error classes. `ScopeExhaustionError` grew a `reason`
  discriminant (`INSUFFICIENT_TOTAL` | `ALIGNMENT_FRAGMENTATION`) plus `shortfallAddresses`, and
  `details.name` is `null` for a total shortfall, because the two failures have different fixes and
  the UI must not conflate them. `InvalidHostCountError` gained an optional `friendlyMessage` so
  the pinned copy stays the default for the too-small case while a too-large count can say
  something accurate.
- `src/core/standards.ts` — `STANDARD_REFS`, `ADDRESS_SPACE_TABLE`, `RESERVED_BLOCKS`, the VLAN
  1–4094 range, `SECURITY_DISCLAIMER`, `CONFIG_TEMPLATE_BANNER`. This absorbed much of what the
  spec had assigned to `src/utils/constants.ts`.
- `src/utils/formatting.ts` + `tests/formatting.test.ts` (22 tests) — the Phase 1 exit criterion.
  `4294967294` renders as `4,294,967,294`; the `/0` case is exercised.
- `src/types/props.ts` — the `Optional<T>` helper, needed because `exactOptionalPropertyTypes`
  makes `{ a?: string }` and `{ a: string | undefined }` distinct.
- `src/theme/typography.ts` (`FONTS`), `src/theme/severity.ts` (`SEVERITY_ORDERED` **derived**
  from `SEVERITY_ORDER` rather than a second hand-maintained list), `src/theme/useTheme.ts`,
  `src/store/ui-store.ts` (preferences only, via `partialize`).

_Two decisions that departed from the spec text, and why:_

1. **`formatCidr` lives in the engine, not in `formatting.ts`.** The spec lists it under Phase 1's
   display helpers, but the engine already has one and it is correct: `formatCidr` answers "what did
   the user type", and `192.168.1.50/24` is a valid *reference* to a network even though `.50` is a
   host address. The display layer instead exports `formatNetworkCidr`, which answers the different
   question of what network an allocation actually denotes. Two functions, two questions, one
   formatter for each. Keeping the engine's version is also what lets route files stay free of any
   core-engine import, which is a Phase 5 exit criterion.
2. **Role and severity metadata was split, not copied.** The spec's remaining
   `src/utils/constants.ts` items (severity colours, per-role label/icon/default VLAN) went to
   `src/theme/severity.ts` and the Badge component rather than into a constants file, because the
   networking-relevant facts already live in `standards.ts` and `types/network.ts`. Duplicating
   them would have created two sources of truth for the same fact, which is the specific failure
   this project keeps paying for.

_One decision is still open:_ `formatPercent` currently trims trailing zeros (`49.6%`, `100%`) and
never clamps, so an over-capacity figure stays visible as `126.6%`. Whether host-bits utilisation
should show one decimal place or a rounded integer is undecided and is a display decision, not a
correctness one. It should be settled before Phase 6, because the calculator screen is the first
thing that renders a percentage.

---

### Phase 2 — IPv4 Engine · ~1.5 days ★ critical path

**Status: DONE — 141 tests passing, 98% statement coverage on the module.**

**Goal:** every IPv4 primitive in the spec, correct at the boundaries, fully tested.

`src/core/ip-engine.ts` — pure, zero imports outside `src/types` and `src/core/errors.ts`.

```
parseIPv4 · parseCidr · isValidIPv4 · isNetworkBoundary
ipToInteger · integerToIPv4
cidrToMask · maskToCidr · calculateSubnetMask · calculateWildcardMask
calculateNetworkAddress · calculateBroadcastAddress · calculateHostRange
calculateUsableHosts · calculateSubnetSize · calculateSubnet
smallestBlockForHosts · detectOverlap · calculateUtilization
classifyAddressSpace   // RFC1918 vs public vs reserved — for the auditor
```

`calculateSubnet("192.168.1.50", 24)` must return network `192.168.1.0`, broadcast
`192.168.1.255`, first `192.168.1.1`, last `192.168.1.254`, usable `254`, hostBits `8`,
networkBits `24`.

**`tests/ip-engine.test.ts` — required cases**

Round-trip: `ipToInteger` ∘ `integerToIPv4` is identity for a generated sweep of values,
including `0`, `1`, `2147483647` (int32 max — the signed-boundary trap), `2147483648`,
`4294967295`.

Prefix sweep: for **every** prefix `0…32`, assert against an independent reference
implementation written in the test file (compute expected mask/hosts by a different method —
e.g. string-of-32-bits — so the test cannot inherit the engine's bug).

Named cases: `0.0.0.0` · `255.255.255.255` · `10.0.0.0/8` · `172.16.0.0/12` ·
`192.168.1.0/24` · `172.31.255.254/12` (upper RFC1912 boundary) · `172.32.0.0/12`
(**just outside** — must be classified public).

Special: `/0` (usable 4294967294) · `/1` · `/8` · `/16` · `/24` · `/30` · `/31` (RFC 3021:
first = net, last = net+1, usable 2) · `/32` (host route, all four fields equal, usable 1).

Masks: `cidrToMask(0) === 0` — **the shift-by-32 regression test** · `cidrToMask(32) === 0xffffffff`
· wildcard is the exact bitwise complement of mask for all 33 prefixes.

Rejection: `"256.1.1.1"` · `"1.2.3"` · `"1.2.3.4.5"` · `"1.2.3."` · `""` · `"1.2.3.a"` ·
`"010.1.1.1"` (leading zero) · `"1.2.3.4 "` untrimmed · prefix `-1` · prefix `33` · prefix `2.5`.

Overlap: identical ranges · contained · containing · adjacent (`/25` siblings must **not** overlap)
· fully disjoint · `/0` vs anything.

Utilization: 0 hosts · exact fit · over-capacity.

**Exit criteria:** 100% coverage on `src/core/ip-engine.ts`; all above passing; no `any` in the
engine. **Do not proceed past this phase on a red suite** — every later phase trusts this code.

#### Phase 2 — implementation notes

Tests use an independent bit-string reference implementation so the suite cannot inherit an engine
bug, and they sweep all 33 prefixes rather than sampling.

One real bug was found and fixed here. `cidrRange` was missing a `>>> 0` coercion on its `end`, so
any range ending above 2³¹ returned a negative number and `detectOverlap` reported "no overlap"
against everything. The coercion is now marked load-bearing in a comment so it is not "tidied" away.

Two design constraints are worth restating because they are invisible in the final code and easy to
undo by accident:

- **`Math.log2` is banned in engine internals.** Powers-of-two-minus-two host counts are resolved by
  integer search or `Math.clz32`. A float `log2` off by one ULP would silently select the wrong
  prefix for some requirement, and subnet boundaries must not depend on float rounding.
- **`cidrRange(0)` needs a shift guard,** because `x << 32` is `x << 0` in JS — the shift-by-32 trap.
  It is pinned by a named regression test.

Remaining module coverage is 98% statements / 96.33% branches / 100% functions, not the 100% the
exit criteria asked for. The two uncovered lines are defensive input-type guards. Left as-is rather
than covered by contrived tests; noted here so the gap is a decision on record, not an oversight.

---

### Phase 3 — VLSM Engine · ~1.5 days ★ critical path

**Status: DONE — 50 tests passing, 100% function coverage on the module.** Includes deterministic
PRNG property tests (`makeRandom(seed)`) for the alignment and fragmentation behaviour.

**Goal:** allocation that can never produce an overlap.

`src/core/vlsm-engine.ts`:

```ts
type HostRequirement = { id: string; name: string; requestedHosts: number; role: NetworkRole };
type Allocation = {
  id: string;
  name: string;
  role: NetworkRole;
  requestedHosts: number;
  subnet: SubnetInfo;
  assignedHosts: number;
  assignedCidr: string;
};
type FreeRange = { start: number; end: number; cidr: string; addresses: number };
type VlsmResult = {
  allocations: Allocation[];
  freeRanges: FreeRange[];
  totalAddresses: number;
  allocatedAddresses: number;
  freeAddresses: number;
  spaceUtilization: number;
  hostEfficiency: number;
};

function packVLSM(parent: Cidr, requirements: HostRequirement[]): VlsmResult;
```

Algorithm:

1. Sort descending by `requestedHosts` (stable, so equal-size reqs keep user order).
2. Per requirement: `hostBits = smallestBlockForHosts(n, role === POINT_TO_POINT ? 1 : 2)`,
   `prefix = 32 - hostBits`, `blockSize = 2 ** hostBits`.
3. **Align:** `start = Math.ceil(cursor / blockSize) * blockSize`. This is the step that keeps
   subnets on their natural boundaries; skipping it is the classic VLSM bug.
4. **Bounds:** if `start + blockSize > parentEnd + 1` → throw `ScopeExhaustionError` naming the
   requirement, its size, and the remaining addresses.
5. Assign, `cursor = start + blockSize`.
6. Derive `freeRanges` from the gaps (this feeds the Phase 12 visualization).
7. Post-condition: run `detectOverlap` across all allocations and throw `SubnetOverlapError` if
   anything trips. Unreachable by construction — that is the point. It is a tripwire.

`POINT_TO_POINT` requirements with `requestedHosts <= 2` get `/31` via the `min = 1` path.

**`tests/vlsm-engine.test.ts`**

Spec case — parent `192.168.1.0/24`, reqs `100 / 50 / 10` → `192.168.1.0/25`,
`192.168.1.128/26`, `192.168.1.192/28`. Also the 4-way spec case (100/50/25/10 → /25 /26 /27 /28).

Alignment: the `10.0.0.0/22` + `300, 200, 100` case does **not** force misalignment — it yields
`10.0.0.0/23`, `10.0.2.0/24`, `10.0.3.0/**25**`. (An earlier draft of this plan claimed `/24` for the
third; that was wrong. 100 hosts need 126 usable addresses, which a `/25` provides, so a `/24` would
strand half a `/24` for nothing. The suite pins `/25`.)

Note that with a strict descending sort and uniform roles, **the alignment step never fires**: every
block size is a power of two and each is a multiple of the next, so the cursor is always already
aligned. Alignment only does visible work when roles produce _non-monotonic_ block sizes — a
point-to-point `/31` packed between two LAN blocks. That is the case the suite actually tests:
parent `10.0.0.0/28`, reqs LAN 3 · P2P 2 · LAN 2 → `10.0.0.0/29`, `10.0.0.8/31`, `10.0.0.12/30`.
Naive packing would emit `10.0.0.10/30`, whose address is not a network boundary. Assert both the
exact CIDRs and that the 2 stranded addresses appear in `freeRanges`.

Exhaustion: `192.168.1.0/24` with `200, 60, 30, 20, 10, 5, 2` → `ScopeExhaustionError`. The error
carries a `reason` discriminant, because the two failure modes need different advice:

- `INSUFFICIENT_TOTAL` — the blocks need more addresses than the parent holds. Caught by a
  **pre-flight sum before any allocation**, so `details.name` is `null` and the UI can say "enlarge
  the parent" rather than blaming whichever requirement happened to be packed last.
- `ALIGNMENT_FRAGMENTATION` — the blocks sum to _no more_ than the parent, but one cannot start on
  its boundary. Only the greedy pass can find this, and only this one names the requirement.

`availableAddresses` is 0 on a fragmentation failure and that is correct, not a bug: an aligned
power-of-two block inside a power-of-two aligned parent either fits entirely or not at all, and
because the packer sorts largest-first, the last requirement is the smallest block, so the pass only
fails once the cursor is already at the parent's end. `reason` carries the explanation; the suite
pins that behaviour so nobody "fixes" it into a lie.

Invariants, property-style over generated inputs: no overlaps · every allocation inside parent ·
every allocation on a boundary · sorted descending · sum(allocated) + sum(free) === total.

P2P: `192.168.1.0/24` + two 2-host P2P reqs → `/31`, `/31`.
Exact fit: `192.168.1.0/24` + 254 hosts → `/24`, free = 0.
Empty requirements → empty allocations, full range free. Zero/negative requirement → throw.

**Exit criteria:** 100% coverage on `vlsm-engine.ts`; invariant property test green; spec
examples reproduce exactly.

#### Phase 3 — implementation notes

**The plan's own worked example was wrong and has been corrected.** `10.0.0.0/22` with
requirements of 300, 200 and 100 does **not** produce a `/24` for the third requirement. 100 hosts
need 126 usable, which is a `/25`, so the allocations are `10.0.0.0/23`, `10.0.2.0/24`,
`10.0.3.0/25`. The suite pins the `/25`.

**The alignment step is provably a near no-op, and that is a result, not an oversight.** With
uniform roles and a strict descending sort, every block size is a power of two that is a multiple of
the next, so the cursor is always already aligned. It only does real work when roles create
_non-monotonic_ sizes — a `/31` between two LAN blocks, for example. Parent `10.0.0.0/28` with
LAN 3 · P2P 2 · LAN 2 yields `10.0.0.0/29`, `10.0.0.8/31`, `10.0.0.12/30`. Naive packing would
emit the illegal `10.0.0.10/30`. Both the reasoning and this case are documented in the test file.

A `/32` parent cannot host even one LAN requirement, because the smallest LAN block is a `/30`. It
throws rather than inventing reserved network and broadcast addresses to make the arithmetic work.

`Array.prototype.sort` stability (ES2019) is relied upon: equal-size requirements keep the user's
order. Several tests depend on this by passing ties in a deliberate order, so a switch to an
unstable sort would surface immediately.

Exports: `packVLSM`, `assertNoOverlaps`, `assertAllocationsValid`, `deriveFreeRanges`,
`totalUsableHosts`, `isExhausted`, `idealPrefixFor`, `P2P_REFERENCE`.

Remaining module coverage is 94.28% statements / 85% branches / 100% functions against the
100%-coverage exit criteria. The uncovered branches are the fragmentation and throw paths' edge
guards. This one is a genuine shortfall against the stated criteria, recorded rather than papered
over.

---

### Phase 4 — Validation Layer (Zod) · ~1 day

**Status: DONE — 91 tests passing.** Module coverage 98.93% stmts / 95.04% branches / 100% funcs
/ 99.35% lines. Exit-criterion grep verified: `parseIPv4(` appears only in `ip-engine.ts`,
`validation.ts` and `tests/`.

**Goal:** nothing invalid ever reaches the engine, and every message is human.

`src/core/validation.ts` — schemas built **on top of** the engine, never duplicating its parsing:

```ts
ipv4Schema · cidrSchema · prefixSchema        // refine via parseIPv4 → typed errors
gatewaySchema(subnet)                          // in-subnet AND not network AND not broadcast
vlanIdSchema                                  // integer 1..4094
hostRequirementSchema                          // integer 1..4294967294
planFormSchema                                // name 1..80, description ≤500
```

Exact user-facing copy from the spec:

- `"Enter a valid IPv4 address."`
- `"CIDR must be between /0 and /32."`
- `"Required hosts must be greater than 0."`
- `"Not enough address space for these requirements."`

Prefix must be typed as a **string** in the form, then coerced — the keyboard has `/` in the
numeric pad and users will enter it. Rejecting `24/24` is a hostile UX.

`gatewaySchema` is a `superRefine` over a parent `subnetSchema`, and its error must read
`"Gateway 192.168.1.1 is not inside 192.168.2.0/24."`

**`tests/validation.test.ts`** — every schema, valid and invalid, plus the exact message strings
asserted. Message text is part of the contract; assert on it.

**Exit criteria:** engine receives only validated, typed input; no raw `TextInput` value reaches
`parseCidr` anywhere in the app. Verify by grep: `parseIPv4(` appears only in `validation.ts`
and `tests/`.

#### Phase 4 decisions (implemented)

**No `z.coerce`, anywhere.** Measured in Zod 4: `z.coerce.number()` maps `''`, `'  '`, `null`,
`[]` and `true` to `0`, and `'1e3'` to `1000`. Since `/0` is a _valid_ prefix meaning the entire
IPv4 address space, coercion would let an empty field silently validate as a catastrophically
wrong plan. Every schema takes `z.unknown()` and validates the raw shape with a digits-only check,
so `1e3`, `0x18` and `24/24` are all rejected rather than reinterpreted. The suite pins this
explicitly (`never lets a blank field become /0`).

**Schemas transform to engine types, not strings.** `ipv4Schema` yields the unsigned integer,
`cidrSchema` yields a `Cidr`. The engine therefore cannot receive a raw `TextInput` value even by
accident, which is what makes the exit-criterion grep a structural guarantee rather than a
convention.

**Prefix accepts a leading slash; VLAN does not.** The engine's `PREFIX_PATTERN` is
`/^\/?(\d{1,2})$/`, so `parsePrefix('/24')` already yields `24` and the schema inherits it. A
VLAN field is labelled "VLAN ID" and is a bare integer, so a slash there is a paste slip worth
reporting. The asymmetry is deliberate and asserted on both sides. `24/24` is rejected: two
numbers in one field are ambiguous, and quietly picking one is the guessing this project refuses.

**`gatewaySchema` delegates to `firstUsableHost` / `lastUsableHost`** rather than reimplementing
"not the network address, not the broadcast address". That is what makes `/31` (both endpoints
usable, RFC 3021) and `/32` (its own address) come out right with no special case in this file. A
naive edge-address check would forbid every possible gateway on both.

**Nested `safeParse` needs `reportField`.** A nested schema's `safeParse` returns a result and does
_not_ throw, so wrapping it in the engine-error translator always "succeeds". The first draft of
`plannedSubnetFormSchema` did exactly that and the gateway was silently never validated. Any
`safeParse` result must be inspected for `.success`; `reportField` exists so no call site can
repeat the mistake, and the comment on it says why.

**`assertNetworkBoundary` now suggests a full CIDR.** It said `"Use 192.168.1.0 instead."` for
input `192.168.1.50/25`, dropping the `/25` and leaving the reader unable to tell whether the
prefix survived. Now `"Use 192.168.1.0/25 instead."`

**An over-large host count gets its own message.** Telling someone who asked for 5 billion hosts
that their value "must be greater than 0" is technically true and practically useless. The pinned
string is now the default for the too-small case only, and the too-large case says
`"Required hosts cannot exceed 4294967294."` The ceiling is real: a `/0` holds 4,294,967,296
addresses and two are unassignable.

**Gateway messages name the canonical network.** Given `192.168.1.50/24`, the old wording read
"Gateway 10.0.0.1 is not inside 192.168.1.50/24" — nonsense, since the address may well be inside
that very network. It now prints `192.168.1.0/24`.

**`null` means _absent_, not _malformed_.** A null gateway is "Gateway address is required."; a
null description is an empty description; a null _name_ is an error. Same input, different meaning
per field, because the fields mean different things.

`vitest.config.ts` was renamed `vitest.config.mts` to clear a Node ESM/CJS warning. Setting
`"type": "module"` in `package.json` would have been the other fix and is the wrong one here — it
would break the CJS Metro and Babel configs an Expo app needs.

`validation.ts` coverage: 98.93% statements, 95.04% branches, 100% functions, 99.35% lines. The
only uncovered line is the `throw` in the engine-error translator, which re-raises anything that is
not a `NetArchitectError`. That is deliberately unreachable from the public API: laundering a
`TypeError` into "Enter a valid IPv4 address" would hide a real defect behind a message about the
user's typing.

---

### Phase 5 — App Shell, Theme & Primitives · ~1.5 days

**Status: COMPLETE.** Verified below.

**Goal:** navigation, dark/light theming, and the reusable component vocabulary.

- `app/_layout.tsx` — `SQLiteProvider`, `ThemeProvider` (NativeWind + a color-scheme store),
  `GestureHandlerRootView`, `Stack` with all 8 routes, typed routes.
- Navigation decision: **tabs** for the five primary tools (Home, Calculator, VLSM, Planner,
  Audit) via `app/(tabs)/`, with **stack** screens for detail (Learning, Plans, Settings, Plan
  detail). The spec's flat list does not say tabs; seven bottom-nav items on a phone is too many,
  so five tabs + stack detail is the responsive answer. Reconsider after first device pass.
- `src/components/` primitives: `Screen` (safe-area + scroll + max-width), `Card`,
  `AppText`, `Button`, `IconButton`, `TextField`, `Select`, `Badge`, `SegmentedControl`,
  `EmptyState`, `ListRow`, `Divider`, `Banner` (info/warn/error), `Sheet` (modal bottom sheet).
- Severity tokens: `critical` / `high` / `medium` / `info` → color + icon + label. **Severity is
  never conveyed by color alone** (see Phase 15).
- CIDR badges (`/24` mono, tabular numerals) and VLAN badges (distinct shape, not just hue).
- `src/store/ui-store.ts` — Zustand + AsyncStorage persist: theme mode, CIDR input format
  preference (`dotted` vs `/n`), last-used profile, showAdvancedFields. Lightweight only.

**Exit criteria:** all 8 routes navigate; light and dark both correct on phone and tablet;
a CI grep proves no route file computes networking values.

#### What was actually built

All 9 route files (`_layout`, `index`, `(tabs)/_layout` + 5 tab screens, `learning`, `plans`,
`settings`), 14 primitives in `src/components/`, `src/theme/` (barrel, `useTheme`, `severity`,
`typography`), and `src/utils/formatting.ts` with 31 tests.

`src/utils/formatting.ts` was not in the phase list but was required by the primitives and is
also a Phase 1 exit criterion. It formats engine output and never computes it — no `2 ** (32 -
prefix)`, no host-count formula. The one place that rule was nearly broken is instructive:
`formatWildcardDotted` was first written as `integerToIPv4(cidrToMask(prefix) ^ 0xffffffff)` and
corrected to call the engine's `calculateWildcardMask`. Both produce `0.0.0.255` for a /24, so
the test passed either way; the second implementation is a second thing that can be wrong.

#### Two silent dark-mode failures found and fixed

Both produce the **identical** symptom — build exits 0, every utility class resolves, app renders
light and never changes. Neither is visible in a browser. Both are now documented at the top of
`global.css` and asserted by `npm run verify:theme`.

**1. `:root.dark` is silently dropped on native.** Tailwind emits it correctly. The loss is one
stage later, in react-native-css-interop's lightningcss pass, whose `isRootDarkVariableSelector`
accepts only `.dark:root` or `:root[class~="dark"]`. lightningcss parses the `.dark` in
`:root.dark` as a *class* selector rather than an *attribute* selector, so it matches neither
branch and the rule is discarded. The compiled `rootVariables` map ended up with all 18 tokens
carrying a `light` value and **no** `dark` value. Fixed by writing `.dark:root` — the same rule,
the order the compiler accepts.

This is the highest-value finding of the phase, and it is worth being precise about *why* it
survived so long: on web the stylesheet ships as CSS text and the browser parses it, so `.dark`
works perfectly and the normalisation step never runs. `:root.dark` was **native-only** broken.
A browser check would never have found it.

**2. `font-mono` no longer existed.** Adding the type scale to `tailwind.config.js` replaced the
`fontFamily` block, and `TextField` still called `font-mono` for its `mono` prop. A class that
does not resolve is not an error in Tailwind — the address rendered in the proportional face, which
is the exact defect `src/theme/typography.ts` exists to prevent (a CSS font stack is not a React
Native font name; NativeWind passes the first entry, `ui-monospace`, which iOS does not have).
Fixed by applying `FONTS.mono` through `StyleSheet.create`, the same mechanism `AppText` uses.

**A note on the first verification attempt.** The initial bundle probe grepped for CSS text
(`--bg-canvas: 246 247 250`) and reported all 12 needles missing, which reads as a catastrophic
build failure. The probe was wrong: lightningcss rewrites the stylesheet into a JS object, so CSS
text never reaches the bundle, and Hermes stores object literals as bytecode where numeric
constants are not greppable at all. Isolating each stage separately is what found the real bug —
and the corrected `scripts/verify-bundle.cjs` now checks token *names* and identifiers there, with
an explicit note on why it cannot check values.

#### Deliberate deviations

- **`SQLiteProvider` is not in `app/_layout.tsx`.** The plan puts it there; Phase 9 brings it with
  the migrations it must run. Adding it now with an empty migration set would ship an untested
  bootstrap that exists only to be modified, and would create a schema-less database file on a
  user's device from the very first launch.
- **`GestureHandlerRootView` is not used.** `react-native-gesture-handler` is not a dependency in
  this project, and no primitive needs a gesture. Adding the provider for its own sake would
  require a new native dependency.
- **Four tool tabs ship as honest placeholders** naming the phase that completes them, not
  half-built screens with sample output. A placeholder rendering `10.0.0.0/22` as a sample result
  would break the project's core premise — that a number on screen is one the engine computed from
  the user's input — in the most visible way available, and would teach everyone involved that
  placeholders are acceptable here. `Settings` and `Learning` are **complete**, since everything
  they need already existed.
- **No `formatCidr` in `formatting.ts`.** The engine already owns it and it correctly prints the
  address the user typed, since `192.168.1.50/24` is a valid *reference* to a network. The display
  layer adds `formatNetworkCidr`, which answers the different question of what network an
  allocation actually denotes. Two functions, two questions, one name.
- **`tailwind-merge` + `clsx` added** for `cn()`. Concatenation looks correct until a caller
  overrides a shorthand: `cn('px-2', 'p-4')` resolves to `p-4` in NativeWind (later class wins in
  the style object) and to `px-2` in every other Tailwind setup, because `padding` is a shorthand
  the longhand must win against. Verified against this project's own token names, including the
  `/opacity` modifier and nested shades.
- **Type scale added to `tailwind.config.js`** (`display`/`title`/`heading`/…), with line heights
  paired to sizes because the pairing is the decision. A design whose sizes are `text-xl` and
  `text-base` cannot be reviewed: the numbers in a mockup and the numbers in the code differ.
- **`.prettierignore` now covers `.export-probe/`, `package-lock.json` and `.expo/types/`.**
- **`eslint.config.js` gained a `scripts/**` block.** `no-console` is the *point* of the
  verification scripts, and Node globals must exist there and nowhere else — a `require` in a
  route file is a bundling error waiting to happen. Also removed one now-unused
  `eslint-disable no-bitwise` and a `ReadonlyArray<>` the config forbids.
- **`npm run check` now includes `format:check` and `verify:theme:all`**, and a new `npm run
  verify` adds a real `expo export` plus the bundle assertion. The theme check is *in* the gate and
  not optional, because two separate bugs in `global.css` passed typecheck, lint and the entire
  test suite while leaving the app permanently in light mode. A gate that cannot catch a bug is not
  a gate.

#### Three bugs found in the verification tooling itself

Written while hardening the gate. Each was a gate that reported success without checking anything,
which is the same failure class as the two it was built to catch.

1. **The `scripts/**` ESLint override did nothing.** It was placed *before* the general rules
   block, which has no `files` scope and therefore applies project-wide — so `no-console` was
   re-enabled immediately afterwards. ESLint printed 20 warnings, exited 0, and the scripts looked
   merely chatty rather than misconfigured. **Lint was green either way.** Fixed by ordering the
   block last, and the reason is now recorded in `eslint.config.js` itself so the next person does
   not "tidy" it back into place. Confirmed with a negative control: `no-console` still fires in
   `app/`, silent in `scripts/`.

2. **`verify-theme.cjs` threw away the compiler's stderr.** The line was
   `child.stderr?.on('data', () => {})`. NativeWind's own wrapper forwards stderr containing
   `warn -` to the console, and this script bypasses that wrapper by forking the child directly —
   so every Tailwind warning went into a pipe that led nowhere and the run reported 0 failures
   regardless. A rule that fails to compile is dropped exactly like the `:root.dark` case; a check
   that discards the channel reporting dropped rules is the bug it exists to catch.
   Proven by setting `content: []` in `tailwind.config.js`, which makes Tailwind emit
   `warn - No utility classes were detected`, and the script surfaced it and failed.
   The child exiting with **no CSS at all** is also now a first-class failure, since that is the
   exact shape of the original bug and it would otherwise skip every assertion.

3. **A fall-through introduced while fixing #2.** Making the shutdown await the child's exit to
   flush stderr turned `process.exit()` into an async `finish()` — and the web branch then ran on
   into the native-only stage 2, because `finish()` no longer terminated the statement sequence.
   Web reported 8 phantom failures. This one is worth remembering as a class: **replacing a
   terminating call with a non-terminating one silently changes control flow**, and no linter in
   this project will ever flag it. Only running the script caught it.

#### `cn()` does not group this project's bespoke sizing tokens — and now that is enforced

`src/utils/cn.ts` was written with a claim in its docstring: *"Verified against this project's own
token names, including the opacity modifier and nested shades."* It was never actually verified,
and it is **true for colours and false for everything else**. Measured, per token kind:

| Token kind               | Examples                              | Grouped correctly? |
| ------------------------ | ------------------------------------- | ------------------ |
| Colours                  | `bg-surface`, `text-ink-muted`        | **yes** (8/8)      |
| Colours with `/opacity`  | `bg-critical/10`                      | **yes**            |
| Type scale               | `text-caption`, `text-display`        | **yes** (4/4)      |
| Border radius (bespoke)  | `rounded-pill`, `rounded-control`     | **no** (0/4)       |
| Max width (bespoke)      | `max-w-read`, `max-w-form`            | **no** (0/3)       |
| Spacing (bespoke)        | `p-touch`, `px-gutter`, `min-h-touch` | **no** (0/7)       |

tailwind-merge groups by matching each *value* against a list of Tailwind's own. Colours work
because any `bg-<name>` is a colour and the value is never inspected. Bespoke sizes are the
opposite: the value is the entire point, and an unrecognised one falls out of the group. So
`cn('rounded-control', 'rounded-pill')` returns **both**, and the override works only because
NativeWind applies the list in order and the caller's class is later — incidental correctness, in
the component whose entire purpose is to remove exactly that.

**Three fixes were attempted and all three were wrong**, which is why the answer is enforcement
rather than configuration:

- `extend.classGroups` *adds an entry* to a group instead of widening it, creating a second
  group. `rounded-pill` then conflicts with `rounded-card` but not with `rounded-4` — the case
  that actually matters.
- `extend.theme` replaces the theme scale wholesale, and `p-2` + `px-4` stops collapsing to
  `px-4 p-4`. It breaks the shorthand resolution `cn` exists to provide, to fix a case that
  already works.
- `override.classGroups` with hand-copied validators drops `isTshirtSize`, so `rounded-lg` and
  `rounded-sm` stop conflicting. Copying a validator list by hand is the fragile version of the
  same mistake.

So the guarantee comes from argument order, and it is **machine-checked**:
`scripts/check-class-order.cjs` requires `className` to be the last argument to all 36 `cn()` calls
across 39 files, and is wired into `npm run check`. Reordering the arguments is the failure this
prevents, and it is invisible to typecheck, ESLint, the tests and the bundler — a component would
simply stop honouring a caller's `rounded-*` override, with the only symptom being a button that
looks slightly wrong. Proven in both directions: a seeded violation is caught with file, line and
the offending arguments, and removing it clears.

Also here: **`cn` had 0% test coverage** and sat inside the coverage `include` glob, so the suite
reported 97.53% while the one function the whole component layer depends on was untested.
`tests/cn.test.ts` adds 18 tests that pin every claim above, including the limitation — so if a
future `tailwind-merge` upgrade changes any of it, the suite says so instead of the UI quietly
shifting. Suite: 322 → **340**.

#### Verification

`npm run verify` — the full release gate — exits 0: `tsc --noEmit` clean · `eslint .` clean (0
errors, 0 warnings) · `prettier --check .` clean · **340 tests passing** (5 files) ·
`check:classes` 36/36 `cn()` calls · `verify:theme:all` 0 failures on web, ios and android ·
`expo export --platform android` 3611 modules, exit 0 · `verify:bundle` 0 failures against the
resulting 6.1 MB Hermes bundle.

Exit criterion "a CI grep proves no route file computes networking values": **pass.** No route
file imports `ip-engine` or `vlsm-engine`; no route file contains address arithmetic
(`2 **`, `<<`, `>>>`, `0xff`, `& 0x`). The only core module routes touch is `standards`, for
constants.

Light/dark on a real phone and tablet is **not yet verified** — no device pass yet. The compile
checks prove the tokens reach the bundle with correct dark values; they cannot prove a human sees
a correct screen. That remains open and is listed under Outstanding below.

#### Outstanding / next

- **Device pass, light and dark, phone and tablet, plus VoiceOver and TalkBack.** The one Phase 5
  exit criterion not met. This is now also the blocker on Phase 0's own exit criterion, and R4's
  decision above makes it the primary UI verification mechanism — so it is the highest-value thing
  left to do, not a formality.
- `react-native-svg` and `react-native-reanimated` are installed but unused so far; both are
  needed from Phase 12 (visualization) onward. `react-native-svg` is already used by the
  primitives' icons via Lucide, so it is not actually unexercised.
- `expo-router` generated route types (`.expo/types/`) do not exist until `expo start` runs, so
  `href` strings are not yet type-checked. Once generated, a renamed or misspelled route becomes a
  compile error. Re-run typecheck after the first `expo start` to pick this up.
- ~~A `Formatter` precision decision is still open from Phase 1.~~ **Decided:** one decimal,
  trailing zeros trimmed, never clamped — `49.6%`, `100%`, `118.1%`. One decimal because the
  fractional part is the lesson in a teaching tool, and `118.1%` says "this does not fit" where
  `118%` reads as more certain than it is. Trimmed because trailing zeros are noise in a column
  the user is comparing. Unclamped because a clamped `100%` reads as "full" and loses the fact
  that it is over capacity. `formatPercent` already behaved this way; what changed is that it is
  now a recorded decision with its reasoning, pinned by 18 assertions in
  `tests/formatting.test.ts`, rather than an accident of implementation.
- ~~**There is still no git repository.**~~ **Resolved.** `git init`, remote `origin` set to
  `https://github.com/Lance0519/NetArchitect.git`, one initial commit of all 69 files on `main`.
  History starts from that commit; the five phases before it were never versioned, so the five
  tooling bugs above have no revert path and never will.
- **A `.gitattributes` went in with that commit, and it prevents a specific failure.**
  `.prettierrc` sets `endOfLine: "lf"`, and on Windows git defaults to `core.autocrlf = true`. With
  both in force and no `.gitattributes`, the working tree here is LF, git stores LF, and **a fresh
  clone on the same machine checks out CRLF** — so every file would fail `prettier --check` and
  `npm run check` would fail on a clean checkout while passing on the machine that produced it.
  Verified rather than assumed: a scratch clone was made and the byte counts read back. Same failure
  shape as the five tooling bugs, and only ever caught by someone *else* cloning.
- ~~**One spec-interpretation question was flagged in Phase 4 and is still unanswered.**~~
  **Decided: keep as implemented** — the prefix field accepts a leading slash (`/24` and `24` both
  work), the VLAN field does not, and `24/24` is rejected as ambiguous. Rationale: a prefix sits
  immediately beside the slash that separates it in a combined field, so accepting both spellings
  is forgiving where it costs nothing, whereas a leading slash on a VLAN ID would be meaningless;
  and rejecting `24/24` stops a plausible typo being read as a two-field entry. The interpretation
  is now confirmed rather than merely defensible.

---

### Phase 6 — IP Calculator Screen · ~1.5 days

**Goal:** the fastest possible path from input to correct answer.

- `app/calculator/index.tsx` + `src/components/CidrInput.tsx` (single field accepting both
  `192.168.1.50/24` and split IP/CIDR; plus a separate-IP + separate-CIDR mode for tablets).
- React Hook Form + Zod resolver. Debounce ~200 ms; calculate in a `useMemo` keyed on the parsed
  tuple so keystrokes never recompute twice.
- `IpResultCard.tsx` renders all 13 spec fields. Hero row: network, broadcast, mask, wildcard.
  Then: first/last usable, total, usable, host bits, network bits.
- Special-case banners for `/31` (RFC 3021 explanation) and `/32` (host route explanation).
- `classifyAddressSpace` badge: RFC 1918 Private / Public / CGNAT / Link-local / Loopback /
  Reserved. Adds genuine educational value for a student tool.
- Tap-to-copy any row (expo-clipboard), copy-all as text block.
- `EmptyState` before input; friendly `Banner` for invalid input — never a thrown error to the UI.

**How to build it, given R4.** There is no component-test runner (see the R4 decision), so
interactive logic does not go into the component. The input pipeline is the case in point:

```
  keystroke  ->  [pure] parse + classify + derive  ->  render
                 src/core or src/utils, Vitest
```

`CidrInput` owns the text state and the debounce. Everything that decides *what the result is* is a
pure function taking a string and returning either a result or a structured error — the same shape
`src/core/validation.ts` already has, and it is already tested. That is what makes this screen
verifiable without a render mock, and it is why the exit criteria below can be a device pass rather
than a snapshot.

**Exit criteria:** all 33 prefixes produce correct output, spot-checked against Phase 2 tests;
no layout overflow on a 320 pt screen; VoiceOver/TalkBack reads every field label.

**Status: DONE (code).** 291 tests. `app/(tabs)/calculator.tsx`, `CidrInput`, `IpResultCard`,
`src/core/calculator-input.ts`, `src/utils/subnet-view.ts`. `npm run verify` exits 0.

How each criterion is actually met, and what is not yet met:

- **"All 33 prefixes produce correct output" — met, and machine-checked rather than spot-checked.**
  The criterion was written as a manual comparison against Phase 2's tests, which would have been a
  human reading two sets of numbers and confirming they agree. Because R4 left no render runner, the
  derivation had to become a value Vitest can reach, and once it was, the spot-check became stronger
  than it was written to be: 33 prefixes × the engine's structural invariants (mask/wildcard
  complementarity, network-boundary idempotence, range length, `/31` and `/32` edge handling), plus
  a per-prefix check that every field of `SubnetInfo` is represented in the view, plus a per-prefix
  check that no value renders as `undefined`, `NaN` or blank. A test *derives* the field list from
  the type rather than restating 13 labels, so it cannot drift.
- **"No layout overflow at 320 pt" — NOT verified.** Untestable without a render or a device. The
  result rows were designed for it (label `shrink-0` with `maxWidth: 46%`, value `flex-1` and
  wrapping, longest value 27 characters) and the width classes are asserted present in the bundle, but
  "designed for it" is not "measured". This is the largest remaining gap and it is why the device pass
  below is not optional.
- **"VoiceOver/TalkBack reads every field label" — partially addressed, NOT verified.** Each row is a
  single `Pressable` whose `accessibilityLabel` is `"<label>, <value>"` with a hint, so a screen
  reader reads one coherent phrase rather than three fragments, and the `accessibilityHint` and its
  exact text are asserted present in the shipped bundle. Whether it actually *sounds* right is a
  device question.

**Decisions taken in this phase, and why**

1. **No React Hook Form or Zod resolver on this screen — a recorded departure from the plan above.**
   Both were specified to serve one field that re-evaluates on every settled keystroke. The
   requirement underneath them is *no reimplementation of validation, plus a debounce so keystrokes
   do not recompute twice*, and `evaluateCombined` meets that more directly: it delegates to the
   same engine the Zod schemas delegate to, so there is one parser rather than two. Wrapping one text
   field in RHF here would add a subscription and a resolver to manage for no behaviour, and would
   make the calculator's validation path differ from every other screen's. **RHF is still planned for
   Phases 7–8**, where requirement rows are added, removed and reordered and `useFieldArray` is the
   actual problem; it was declined here because it is the wrong tool for one field, not because it was
   judged unnecessary.
2. **`classifyCalculatorOutcome` returns three states, not two.** An empty field produces a *failure*
   from the evaluator — there is no CIDR in an empty string — so `ok === false` cannot distinguish
   "nothing typed yet" from "typed something wrong". The first version compared failure messages
   against a remembered constant to tell them apart, which means rewording the `empty` string silently
   turns the empty state into a red error banner on first launch. Naming the state as
   `empty | invalid | ok` fixes it at the only layer that can see the difference, and makes the
   screen a total `switch` with no cast and no fall-through.
3. **A layout switch must never discard a half-typed entry, and `composeSplit` is tested to prove
   it.** Switching from the split layout to the single field with only a prefix typed returned `''`,
   which deleted the 24 the user had just typed *and looked like success* — the field went blank and
   the empty state appeared, as though the app had reset itself. Both half-filled forms are now
   rendered honestly, because the evaluator tolerating an incomplete field is precisely what lets its
   message name the missing half.
4. **`decomposeCombined` and `composeSplit` live in `src/core`, not in the component.** They are pure
   string functions that decide what a half-filled entry becomes — a correctness question, not a
   rendering one — so under R4 they belong where the tests can reach them. Round-tripping all 33
   prefixes through both layouts is asserted.
5. **The `/31`, `/32` and `/30` explanations are notices in the view model, not banners assembled in
   the screen.** The plan asked for "special-case banners". They are built in `buildSubnetView`, which
   means their presence, wording and citation are asserted for all 33 prefixes — and they are the two
   or three notices most likely to need a wording change. A banner whose text lives in a component
   cannot be asserted on.
6. **The notice kind is `'info' | 'warn'`, not a `BannerTone`.** A view model naming a component's
   tone union would invert the layering and make the model unusable from a screen with no `Banner`.
   `IpResultCard` owns the mapping.

**Bugs found and fixed while building this phase** — each was invisible to a green gate:

| Bug | Why it was silent | Now caught by |
| --- | --- | --- |
| `split(/[/\s]+/)` written as `split(/[/\\s]+/)` — a class of slash, backslash and the letter `s` | Space separators did not split, so `192.168.1.50 24` was reported as a missing prefix. Slash cases still passed, so most of the suite stayed green | 5 accepted-form tests, plus a **negative control** asserting `\` and `s` are *not* separators |
| `isAddress` pre-check swallowed field attribution and the engine's specific message | `192.168.1.500/24` was blamed on the whole field with an invented message instead of the address, and the engine's authoritative message never reached the user | Property assertions that the calculator returns the engine's `friendlyMessage` verbatim |
| An invented `badAddressPart` message duplicated what the engine already says | A second definition of "not an address" that could disagree at the edges | Removed; `foo/24` now defers to the engine |
| `barePrefix` stripped a leading slash *before* trimming | `'  /24 '` does not begin with a slash, so the anchored pattern matched nothing and the slash survived. Only the unpadded `'/24'` had been tested | Round-trip and padded-echo tests |
| An `AppText` wrapping a `Copy` icon, and a notice `View` passed to `Banner` (which wraps children in `AppText`) | A `react-native-svg` element is a View; nesting one in a native `<Text>` is unsupported on Android. `tsc`, ESLint and `expo export` all pass regardless | Restructured; not machine-checkable, which is why it is written down here |
| A second notice icon in a `text-warn` class that **does not exist** | `Banner` already renders its own tone icon, and `warn` maps to `text-high`. The invented class was silently dropped, leaving an uncoloured duplicate icon | Removed; `Banner` owns its icon by construction |
| `accessibilityRole="alert"` plus `liveRegion="polite"` on a copy confirmation | Contradictory roles; a screen reader would announce a successful copy as an emergency | `polite` only, with the reasoning recorded at the call site |
| `onOutcome` in an effect's dependency list | An inline arrow from the parent changes identity every render → the effect fires every render → infinite loop that only appears once someone else writes the parent | Held in a `useRef`, so the mistake is impossible rather than documented |
| An `eslint-disable react-hooks/exhaustive-deps` | One memo read raw fields in split mode and settled text in combined mode, so the dependency list had to be padded with values that mode ignores | Three independent per-field debounces, so every dependency is a real input |

**One check was added specifically because a green gate proved nothing.** `verify:bundle` now
asserts the calculator's ten user-visible strings — its empty state, the copy hint, all three
confirmed input rules, and the three prefix notices — are in the shipped bundle, because a screen
present in source but absent from the artefact is an *ordinary* outcome (unrouted file, unresolved
route) that `expo export` reports as success. It also runs a **negative control** first: it proves the
marker search discriminates by asserting that a casing change, a negation, a plausible rewording and
a full-width homoglyph are all *not* found, while the real string and a genuine prefix of it are. A
search that cannot tell those apart is not a search.

---

### Phase 7 — VLSM Allocator · ~1.5 days

**Status: DONE**, with two recorded departures and one design claim in this plan found to be
false while building it.

**Goal:** requirements in, provably-correct plan out.

- `app/vlsm/index.tsx` — parent CIDR input; requirement rows (name, hosts, role) with add /
  reorder / remove; live re-pack on change.
- `SubnetTable.tsx` — columns: Name, Role, VLAN (optional here), CIDR, Network, Broadcast,
  First, Last, Capacity, Requested, Utilization %. **Horizontally scrollable** with a pinned
  name column; on wide screens switch to a non-scrolling grid via `useWindowDimensions`.
- Summary card: allocated, free, space utilization %, host efficiency %, free ranges list.
- `ScopeExhaustionError` renders as an inline error on the offending row with a specific fix
  suggestion, not a modal.
- "Send to Network Planner" — hands requirements into the planner store and routes there. This
  is the spec's core product loop, so make it a first-class action, not a copy/paste.
- `SubnetBar.tsx` — initial simple stacked bar (no SVG yet); refined in Phase 12.

**Exit criteria:** spec example reproduces exactly; exhaustion is recoverable (remove a
requirement and it re-packs live); table scrolls on a phone without clipping.

#### What was built

Four pure modules and three components. The split is not decorative — under R4 there is no
render runner, so any decision that is not in one of the pure modules is unverified:

| Module | Responsibility | Tests |
| --- | --- | --- |
| `src/core/roles.ts` | `NETWORK_ROLES`, the role tuple, `ROLE_DEFINITION_BY_ROLE`, `roleLabel`, `isPointToPointRole` | `tests/roles.test.ts` (19) |
| `src/core/vlsm-input.ts` | draft text → `empty \| parent-invalid \| rows-invalid \| exhausted \| ok`, plus `setParent`/`updateRow`/`addRow`/`removeRow`/`moveRow`/`attributeCulprit` | `tests/vlsm-input.test.ts` (62) |
| `src/utils/vlsm-view.ts` | result → table rows, summary figures, notices, bar segments, hand-off payload, clipboard text | `tests/vlsm-view.test.ts` (95) |
| `src/utils/table-layout.ts` | column widths, the derived scroll breakpoint, `COLUMN_ACCESSOR` | `tests/table-layout.test.ts` (21) |

Components: `SubnetTable.tsx`, `SubnetBar.tsx`, `VlsmRequirementList.tsx`. State:
`src/store/vlsm-store.ts` (draft only, plus the hand-off) and
`src/hooks/useDebouncedValue.ts` (`tests/vlsm-store.test.ts`, 22).

`roles.ts` exists because two `z.enum` sites and the VLSM engine each had a private copy of
the role list and a private copy of `isPointToPointRole`. `ROLE_DEFINITION_BY_ROLE` is
annotated `satisfies Record<NetworkRole, RoleDefinition>`, so a role added to the tuple
without a definition is a compile error rather than an `undefined` read at runtime.

The draft mutations are **pure functions in `vlsm-input.ts`**, not store actions, and the
store delegates to them. That is what lets `tests/vlsm-store.test.ts` compare the store
against the pure function and get a real assertion instead of a restatement.

#### The engine's `ALIGNMENT_FRAGMENTATION` branch is currently unreachable

`packVLSM` can throw `ScopeExhaustionError` with `reason: 'ALIGNMENT_FRAGMENTATION'`, and
`vlsm-input.ts` is written to attribute it to the row that caused the stranding. **Through
`packVLSM` today that path is not reachable**: the pre-flight total check fires first, and
once a block of a given power-of-two size is placed, alignment of the next one cannot strand
anything the total check has not already rejected. The canonical fragmentation case —
`packVLSM('10.0.0.0/28', [LAN 3, P2P 2, LAN 2])` → `10.0.0.0/29`, `10.0.0.8/31`,
`10.0.0.12/30`, stranding `10.0.0.10/31` — is a *successful* pack that reports free space, not
an error.

There is a characterisation test in `tests/vlsm-input.test.ts` asserting this. It is
deliberately written to **fail loudly** if the engine ever changes so that the branch becomes
reachable, because the alternative is code that has never executed being trusted because it
reads correctly.

#### Fix suggestions are verified, not computed

When requirements do not fit, the screen offers a wider parent. `findWorkingParent` does not
calculate one — it calls `packVLSM` into each of four wider prefixes and returns a prefix
only if that pack actually succeeds. Widening also **renormalises the network address**:
`192.168.1.0/23` widens to `192.168.0.0/23`, not `192.168.1.0/23`, because the latter is not
a valid `/23` boundary. Returns `null` when nothing provably works, and the screen then says
so rather than guessing.

Exhaustion is attributed to a row **by row id, and only when the blamed name is carried by
exactly one row.** Two requirements called `LAN` cannot be told apart by name, so the message
names the block size instead of guessing which one was at fault. `attributeCulprit` is
exported so this is tested directly rather than through the screen.

#### Two real bugs found and fixed while building this

**`hostRequirementSchema` had a weaker name rule than `planNameSchema`.** It enforced
non-empty and nothing else, which made `MESSAGES.nameTooLong` unreachable from it — a message
written for a rule that no longer applied to that path. It now reuses `planNameSchema`, as
`plannedSubnetFormSchema` already did.

**`stageHandoff` left a stale hand-off in the store when it failed.** Editing a requirement
until the plan no longer fits returned `false` — but the previously staged payload stayed in
the store. The return value was the only thing standing between that stale plan and the
planner. It now clears on failure: a store whose contents can contradict its own input is
worse than one that is simply empty. Found by a test that was trying to do something else.

#### A copy error corrected against the engine

The summary's "host efficiency" figure was described in an early draft of this plan as
requested-over-capacity. The engine's `hostEfficiencyPercent` is `usableHosts /
allocatedAddresses` — network and broadcast overhead, not requirement fit. The figure's detail
line now says "of allocated addresses can be assigned to hosts", which is what the number
actually measures.

Relatedly, the "mostly unused" notice is **per-block**, computed by the view model from each
allocation's existing `utilisationPercent` against a fixed `LOW_UTILISATION_PERCENT = 66.7`,
and it names the offending row. No division happens in the view model. The threshold is a
fixed number on purpose: any formula would be a claim about what a good VLSM plan looks like,
and two thirds is a fact about the block rather than a judgement about the plan.

#### Departure 1 — no React Hook Form, deferred to Phase 8

The plan names RHF + `useFieldArray` for this screen. It is not used, and this is the phase
that was supposed to use it.

What RHF would have solved is a growing, reorderable list of rows — and that list is four
pure functions over an immutable draft, each tested directly. `useFieldArray` is a way to
manage that state; it is not the reason the state is correct. What it would have *added* is a
subscription per field, a resolver, and a second validation path that has to agree with
`evaluateVlsm`. Two validation paths on one screen is how a row ends up showing an error the
allocation ignored.

Phase 8 was supposed to change the problem shape. **It did not, and this paragraph is wrong** —
see "Phase 7's prediction about React Hook Form was wrong" in the Phase 8 section. The reasoning
here about RHF (a second validation path that has to agree with `evaluateVlsm`) still holds, but
the premise does not: persistence is Phase 9, so the planner has no submit and nothing to save
yet.

#### Departure 2 — no VLAN column in the table

The plan lists VLAN as optional in this table, and it is omitted because this screen has no
VLAN input. A column of dashes teaches the reader nothing. VLAN IDs arrive with the hand-off
to the Network Planner, which is the screen that collects them.

#### The grid layout is real but unreachable on any device this app targets

The plan asks for a non-scrolling grid on wide screens. `usesGridLayout` exists and the branch
renders, but the breakpoint is **derived** from the column widths rather than typed, and the
derived value is **1132 points** — wider than an iPad in either orientation (768 portrait, 1024
landscape). Ten columns of IPv4 data plus a pinned name column do not fit.

So the scrolling layout is what every phone *and every tablet* gets. The grid is reached on a
desktop browser or a very wide window. This was found by a test written expecting a tablet to
reach the grid and failing; the test is now pinned to assert the true value, with a comment
saying that if it starts passing because a column was narrowed, the documentation above it is
now wrong and needs rewriting in the same change.

Narrowing the columns to buy the tablet layout would mean either clipping an address or
dropping a column, and a half-readable table is worse than a scrolling one. A shorter column
set is the only way to get it, and that is a Phase 8 design decision.

#### Verification

`app/(tabs)/vlsm.tsx` contains one `switch`, no arithmetic, and no decision about what a
number should be. The screen's own logic — a five-way outcome switch — is exhaustive by
construction, so no state falls through and leaves the user with a form and no explanation.

Thirteen Phase 7 markers were added to `scripts/verify-bundle.cjs`, and **the negative control
was extended first**. It immediately caught a marker that passed for the wrong reason: the
offline statement was checked as bare `"NetArchitect never connects to a network"`, which is
also on the calculator, so it was satisfied by a bundle containing no VLSM screen at all. It
is now checked with its VLSM-only lead-in. The same control asserts that a plausible rewording
of a notice is *not* found, so the marker is discriminating rather than merely present.

`npm run verify` exits 0 against a real `expo export` with all 13 markers present.

#### Outstanding

The Phase 7 exit criterion "table scrolls on a phone without clipping" is **not verified**. It
is a visual claim about a device this project has never run on. The breakpoint arithmetic is
tested; that the columns are legible at 320 points is not, and cannot be without a device.

---

### Phase 8 — Network Planner · ~2.5 days

**Status: DONE**, with three recorded departures, one design claim in this plan found to be
undefined, and one claim from Phase 7 found to be false.

**Goal:** the full VLAN plan — the app's centerpiece.

- `app/planner/index.tsx` — plan header (name, description, parent CIDR, profile) + subnet editor.
- Subnet row fields: name, role (incl. Custom + label), VLAN ID, CIDR, gateway. Derived read-only:
  network, mask, broadcast, first/last, capacity, requested, utilization.
- **Profile templates** (`src/core/profiles.ts`): `personal` (Trusted LAN, IoT, Guest WiFi,
  Home Lab, Management) and `enterprise` (Corporate Users, Servers, VoIP, Management, DMZ, Guest,
  Point to Point). Each entry supplies **host hints + role only** —
  `profileTemplates.personal('192.168.1.0/24')` returns requirements, and the VLSM engine derives
  every address. Confirm the spec's output (`.0/25`, `.128/26`, `.192/27`, `.224/28`) falls out of
  the hint counts. **Never hardcode an address in a profile.**
- Auto-suggest the next free VLAN ID on add, with duplicate detection inline.
- Gateway auto-fill = first usable host; explicitly clearable for a gateway-less subnet.
- **Reallocation safety:** changing a subnet's host requirement or CIDR may invalidate
  neighbours. Detect conflicts and show a diff-style preview before committing. Do not silently
  rewrite the user's plan.
- Full plan → store; `securityIssues` recomputed in a `useMemo` on plan change (see Phase 11).

**Exit criteria:** the spec's School Network example builds correctly; a plan with an
intentional overlap is _representable_ (the auditor must be able to see it) but is flagged at the
point of creation.

#### What was built

Five pure modules and three components, split on the same rule as Phase 7: under R4 there is no
render runner, so a decision that does not live in a pure module is unverified.

| Module | Responsibility | Tests |
| --- | --- | --- |
| `src/core/profiles.ts` | `personal` / `enterprise` as names, roles and host **hints**; `profileRequirements`, `packProfile` | `tests/profiles.test.ts` (41) |
| `src/core/planner-input.ts` | draft text → `empty \| header-invalid \| rows-invalid \| ready`, plus the row add/move/remove operations and `nextFreeVlanId` | `tests/planner-input.test.ts` (87) |
| `src/core/plan-changes.ts` | the two destructive operations (`previewRepack`, `previewProfile`), the VLSM hand-off (`adoptHandoff`), `diffPlans`, `conflictsOf` | `tests/plan-changes.test.ts` (74) |
| `src/utils/planner-view.ts` | draft + outcome → row views, summary figures, notices, per-row findings | `tests/planner-view.test.ts` (72) |
| `src/store/plan-store.ts` | the draft and one pending change. No persistence — that is Phase 9 | `tests/plan-store.test.ts` (55) |

Components: `SubnetEditor.tsx`, `PlanFindingList.tsx`, `ChangePreview.tsx`. Route: a real
`app/(tabs)/planner.tsx`, which contains no arithmetic and no decisions about what a number
should be. Its one `switch` — the exhaustive one over the four outcome kinds — lives in
`planner-view.ts` rather than the screen, because that is where the wording it selects lives.

#### The rule that shaped everything: an error and a finding are different things

The Phase 8 exit criterion requires an overlap to be **representable** so the Phase 11 auditor can
see it. That single requirement draws a line through the whole screen, and it is worth stating
because every part of the design hangs off it:

> **An entry error means a field has no parseable value. A finding means every field has a value
> and the values disagree with each other.**

So `PlannerOutcome` is a **four-state union** — `empty`, `header-invalid`, `rows-invalid`,
`ready` — and `ready` carries a real `NetworkPlan` **plus** `findings`. The screen never refuses
to build a plan that overlaps. If it did, the auditor would have nothing to report.

`findings` has exactly three kinds: `overlap`, `outside-parent`, `duplicate-vlan`. Each carries
**every** participating row id, never just the first, so a three-way overlap marks all three
rows.

`PlanFinding` carries **no severity**, deliberately. "These two subnets overlap" is a true
statement about the plan; rating it `Critical` is a security judgement, and a security judgement
made by a display layer is unattributed advice — which is the thing the standards registry in
§1.9 exists to prevent. Phase 11 does that, with a citation and a remediation.

#### Departure 1 — `profileRequirements` takes no parent CIDR

The spec above sketches `profileTemplates.personal('192.168.1.0/24')` returning requirements.
It does not take one, and `profileRequirements(profile)` takes only the profile.

A profile is a *description of a site* — "a home with a trusted LAN, some IoT, guests, a lab and
something to manage". It is not a location, and the same profile is valid in `10.0.0.0/8` and
in `192.168.1.0/24`. Baking an address into it would make the registry a list of addresses with
names attached, and the spec's own "**never hardcode an address in a profile**" is a rule the
signature would have broken.

Packing is a separate call: `packProfile(profile, parentCidr)`. It takes the address, and it
**never catches** — a `ScopeExhaustionError` reaching the caller is the answer to "does this fit",
not an error to be converted into a friendlier one.

#### Departure 2 — the destructive operations return a preview, and so do their refusals

`previewRepack` and `previewProfile` return a diff (`PlanChange`: the next draft, a **field-level**
row diff, a header diff, and the conflicts the result would have) rather than editing the plan.
The store holds one such proposal and the screen renders it in `ChangePreview` — a sheet listing
every row that moves, every row that goes, and what would still be wrong afterwards. A yes/no
dialog says "are you sure" without saying "sure of *what*".

Three things follow from that, and each was a bug before it was a rule:

- **`conflictsOf` delegates to `evaluatePlan`.** A preview that ran its own overlap check could
  disagree with the plan screen — same inputs, two implementations, one wrong — and would show a
  conflict that does not exist and then create one.
- **Non-exhaustion errors are rethrown.** Only `ScopeExhaustionError` is caught and turned into
  a refusal message. A `TypeError` inside the packer is a bug, and a store that maps every
  thrown value to "that did not work" hides it.
- **The store's staging actions return `string | null`, not `boolean`.** `previewRepack` refuses
  for three different reasons — nothing to pack, no parent, requirements that do not fit — each
  with a sentence written for the user. A `false` throws all three away, leaving a button that
  silently does nothing, which reads as a broken app rather than as a plan that will not fit.
  `tests/plan-store.test.ts` asserts all three messages are distinct.

#### Departure 3 — `takeHandoff` declines rather than replacing a pending change

The VLSM screen's hand-off is consumed from a mount effect. If a change is already staged when
it arrives — the user opened the planner, staged a template, then navigated back and to the VLSM
tab — replacing the proposal would discard the diff they were reading, and nobody confirmed that.

The guard lives in the store rather than in the screen, because the screen cannot know what has
happened since it mounted. It is reached only by calling `takeHandoff` twice, or once after a
staging action, so it is an invariant rather than a timing detail.

Adoption itself splits on `isUntouched`: a draft with no header text and every row blank is the
screen's opening state, and a hand-off into that applies directly — a dialog saying "this will
replace your 0 subnets" is a dialog about nothing. Anything else stages a preview. A row with
*three characters* of a CIDR counts as content, because a user who typed that would be annoyed to
lose it unasked.

#### Bugs found by writing the tests, not by reading the code

Eight, all in the new code, all now fixed and pinned. Recorded because the pattern matters more
than the individual fixes — none of them would have been caught by a type-check, a lint pass, or
an export:

1. `profileRequirements` was typed `PlanDefinition` instead of `ProfileDefinition`.
2. `parseParent` stored a non-canonical parent (`192.168.1.50/24` verbatim) instead of
   `calculateNetworkAddress`.
3. A wholly blank row was reported as invalid by the name check, so an untouched screen showed an
   error. Blank rows are now skipped, not reported.
4. `RepackOutcome`'s success arm never carried `skippedRowIds`, so a repack that worked on four of
   five rows could not say what it did not use.
5. `rowLabel` documented canonicalisation it did not perform.
6. `ProfileOutcome`'s `skippedRowIds` was renamed `discardedRowIds` — the two ops discard
   different things and the shared name hid that.
7. `blankRow({ gateway })` could build a row whose gateway is then silently discarded by the
   gateway-mode inference. A constructed row can no longer carry a field nothing will read.
8. `planner-view.ts` called a non-existent `formatCount`, duplicated the em-dash literal, and used
   a module-mutable `bindFindingCounter` to thread a finding count through. The counter was a
   design error and was deleted: `buildPlanView` takes the count as an argument.

Three of my own **test** expectations were also wrong, and the engine was right:

- **50 hosts needs a `/26`** (62 usable), not a `/25`.
- **Two aligned CIDR blocks can only overlap by containment, never by straddling** — a subnet
  starting inside a `/24` always ends inside it, so "ends past the parent" is only testable with a
  mid-block parent like a `/25`.
- A test that compares two `initialPlanDraft()` calls fails on the row id alone, because
  `newRowId` is a module-scoped counter. Four such tests were reporting a difference that did not
  exist, and would have passed with every other field wrong.

#### The spec's "School Network example" was never defined

The exit criterion says "the spec's School Network example builds correctly" and this plan never
states what it is. The numbers are given once, in the Phase 3 section, for the VLSM engine:
`192.168.1.0/24` with **100, 50, 25 and 10** hosts, expected to give `.0/25`, `.128/26`,
`.192/27`, `.224/28`. That four-way case is now **named and pinned** in
`tests/profiles.test.ts` as `describe('the School Network example')`.

The expected prefixes are **not** written out. Each is derived from its host count by the same
engine call the app makes, and the *sizes* are asserted: 100 hosts needs a block with at least 100
usable addresses, 50 needs one for 50. A test that hardcoded the four strings would still pass if
the engine's sizing were wrong, because both sides would be wrong together. Two companions assert
the properties that make it the *aligned* case: no gap between consecutive blocks, and
128 + 64 + 32 + 16 = 240 of 256 addresses, freeing the last 16.

#### Phase 7's prediction about React Hook Form was wrong, and it is corrected here

The Phase 7 section (Departure 1, above) says RHF arrives in Phase 8 because the planner "saves"
and RHF is good at submit-time validation. **That prediction is false about the timeline.**
Persistence is Phase 9, so this screen has no submit and nothing to save yet. RHF is still not
used, and the rest of the Phase 7 reasoning is unchanged and still holds: the row list is pure
functions over an immutable draft, each tested directly, and RHF would add a subscription per
field, a resolver, and a second validation path that has to agree with `evaluatePlan`.

Recorded rather than quietly dropped, because a wrong prediction written down is worth more than
a silent correction.

#### Bundle verification

Twelve Phase 8 markers were added to `scripts/verify-bundle.cjs`, and **the negative control was
extended first**. Two of them are deliberately *not* the route title: "Network Planner" also
appears on the VLSM screen's hand-off button, so checking the bare title would pass against a
bundle containing no planner at all — the same mistake the Phase 7 offline check made. The
subtitle and the planner-only lead-in are unique to the route, and the control asserts a
cross-screen splice of the two offline statements is *not* found.

Two markers exist to catch a specific silent failure: the three finding-kind labels
(`Overlap` / `Outside parent` / `Duplicate VLAN`), which are the Phase 8 exit criterion rendered
and would have nowhere to show if the list were dropped; and `"Saving arrives with the local
database"`, so the screen cannot lose the only statement that this plan is **not** being saved.

`npm run verify` exits 0 against a real `expo export` with all 12 markers present.

#### Outstanding

**Nothing the planner screen renders has been looked at.** R4 makes the device pass the primary UI
verification mechanism, and this screen has never been on one. Specifically unverified: the
`SubnetEditor` card stack at 320 points, the `Resolved` block's em-dash alignment, the two sheets'
footers, the template picker scroll, and whether the per-row finding lines are readable next to
the border tone that flags them.

There is also **no save**, and the screen says so in writing rather than implying otherwise.

---

### Phase 9 — Persistence · ~2 days

**Goal:** SQLite as source of truth, with migrations that will not bite later.

`src/database/migrations.ts` — an ordered, append-only array. **Never edit a shipped migration.**

```ts
const MIGRATIONS = [
  { version: 1, up: `CREATE TABLE network_plans (...); CREATE TABLE subnets (...); ...` },
  // future: { version: 2, up: `ALTER TABLE subnets ADD COLUMN dns TEXT;` }
];
```

`src/database/database.ts` — `runMigrations(db)` reading `PRAGMA user_version`, applying
everything above the current version in order, then setting `user_version`. Enable
`PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON`. Wrap plan+subnet writes in
`withTransactionAsync` so a partial save is impossible.

Schema per spec, plus what production actually needs:

```sql
network_plans(id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  parent_cidr TEXT NOT NULL, profile TEXT NOT NULL DEFAULT 'custom', created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL);
subnets(id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES network_plans(id) ON DELETE CASCADE,
  name TEXT NOT NULL, role TEXT NOT NULL, custom_role_label TEXT, vlan_id INTEGER,
  network_address TEXT NOT NULL, cidr TEXT NOT NULL, mask TEXT NOT NULL, gateway TEXT,
  requested_hosts INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL);
custom_roles(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
CREATE INDEX idx_subnets_plan ON subnets(plan_id);
```

Additions beyond the spec schema, and why: `mask` (avoid recomputing on every list render),
`custom_role_label` (Custom roles), `requested_hosts` (utilization), `sort_order` (user ordering),
`ON DELETE CASCADE` (no orphans), and the `plan_id` index (the only query that matters).

**`src/database/plans-repository.ts`** — the only module that touches SQL. `listPlans()`,
`getPlan(id)` (one join, not N+1), `savePlan()`, `deletePlan()`, `duplicatePlan()`. Returns
domain types, not raw row objects.

**`src/store/network-store.ts`** — Zustand for the _working_ plan: parent, requirements,
subnets, profile, derived issues. **Not persisted.** Editing state dies with the app; SQLite
holds the durable copy. This is the spec's "do not store the database in Zustand" rule, made real.

**Exit criteria:** plan round-trips through save → kill app → relaunch → load with identical
values; a v2 migration written and proven against a v1 database; deleting a plan leaves zero
orphan subnets.

#### What was built

- `src/database/migrations.ts` — append-only migration array (v1), `runMigrations` reading
  `PRAGMA user_version`, applying in order, WAL + FK pragmas, transactional.
- `src/database/database.ts` — singleton handle via `expo-sqlite` sync API (`execSync`,
  `prepareSync`, `withTransactionSync`), migrations run on every open.
- `src/database/plans-repository.ts` — **only module touching SQL**. Prepared statements,
  explicit domain mapping, `listPlans`/`getPlan`/`savePlan`/`deletePlan`/`duplicatePlan`,
  returns `NetworkPlan`/`PlannedSubnet` domain types.
- `src/database/index.ts` — public barrel.
- `src/store/network-store.ts` — load/save bridging: `loadPlan` (NetworkPlan → PlanDraft),
  `saveCurrentPlan`/`updateCurrentPlan` (PlanDraft → NetworkPlan), `newPlan`,
  `duplicateAndLoad`, `deletePlan`, `listPlans`, `listCustomRoles`.
- `src/store/index.ts` — updated barrel with all four stores.

Schema v1 as specified, plus columns: `network_address`/`mask` (list render),
`custom_role_label` (Custom roles), `requested_hosts` (utilization), `sort_order` (user
ordering). `ON DELETE CASCADE` + `PRAGMA foreign_keys = ON` = zero orphans.

**Why sync API in async app:** Zustand actions mutate immediately. Making DB async would
force thunks. `expo-sqlite` provides sync via JSI (native) / WASM (web); work is off JS
thread.

**Repository pattern:** Only module touching SQL. Returns domain types. Mapping explicit and
tested. A hand-written fake would not exercise real FK/cascade paths.

**Network store ON TOP of planner store:** Load = NetworkPlan → PlanDraft. Save =
PlanDraft → NetworkPlan. Planner store is ephemeral; SQLite is durable. Spec's "do not store
the database in Zustand" made real.

**Append-only migrations:** Never edit shipped migration. v2+ = new entry.

**Exit criteria status:**

- Plan round-trip save → kill → relaunch → load: **verified at domain level** (repository
  tests). Full app restart test needs device.
- v2 migration against v1 DB: **schema designed for it** (append-only array, `PRAGMA
  user_version`). Test needs expo-sqlite runner.
- Delete plan → zero orphan subnets: **verified** (cascade FK tested in repository tests).

**Known gap:** Database integration tests use `node:sqlite` API (Node), but production uses
`expo-sqlite` sync API (JSI/WASM). Core 1179 tests pass. Database integration tests deferred
until expo test runner available.

---

### Phase 10 — Saved Plans · ~1.5 days

- `app/plans/index.tsx` — list, sorted by `updated_at`, showing name, parent CIDR, subnet count,
  relative modified date. Swipe to delete (with undo via a local snackbar). Search by name.
  Empty state with a "create your first plan" CTA.
- `app/plans/[id].tsx` — read-only plan overview: summary stats, the address-space bar, the
  subnet table, and severity-grouped issue counts. Actions: **Edit**, **Duplicate**, **Export**,
  **Delete**.
- Home screen (`app/index.tsx`) — the spec's dashboard: title, five tool cards, Recent Plans
  (top 5 by `updated_at`).
- Export to a text file via `expo-file-system` + `expo-sharing`; JSON payload includes the full
  plan, its `parentCidr`, and an export timestamp.

**Exit criteria:** create → save → force-quit → relaunch → plan intact and editable; 50-plan
list scrolls without jank.

---

### Phase 11 — Security Auditor · ~2 days

**Goal:** a rule-based design review that is honest about its limits.

`src/core/security-auditor.ts` — `auditPlan(plan: NetworkPlan): SecurityIssue[]`. Pure, no I/O,
fully unit-testable. Each rule is a named function in a `RULES` registry so severity and copy live
in one readable table.

| Rule    | Severity | Check                                                                    |
| ------- | -------- | ------------------------------------------------------------------------ |
| SEC-001 | Critical | Overlapping subnets                                                      |
| SEC-002 | Critical | Duplicate VLAN IDs                                                       |
| SEC-003 | Critical | Subnet not aligned to its network boundary                               |
| SEC-004 | Critical | Gateway outside its subnet                                               |
| SEC-005 | High     | Gateway equals network or broadcast address                              |
| SEC-006 | High     | VLAN ID out of 1–4094 (0 and 4095 reserved)                              |
| SEC-007 | High     | Guest shares a subnet with a trusted LAN                                 |
| SEC-008 | High     | IoT not segmented from LAN/Guest                                         |
| SEC-009 | Medium   | Management subnet oversized (>254 usable)                                |
| SEC-010 | Medium   | Excessive broadcast domain (any subnet ≥ /24)                            |
| SEC-011 | Medium   | Subnet extends outside the parent CIDR                                   |
| SEC-012 | Medium   | Poor utilization (requested/capacity < 25% on a ≥ /25)                   |
| SEC-013 | Medium   | DMZ shares a subnet with, or is nested inside, Servers/LAN               |
| SEC-014 | Info     | Missing VLAN ID on a role that needs segmentation (P2P untagged is fine) |
| SEC-015 | Info     | Reserved space in use (`0/8`, `127/8`, `169.254/16`, `240/4`)            |
| SEC-016 | Info     | Public address space with no NAT note                                    |
| SEC-017 | Info     | Address space hygiene: >90% free, or fragments too small to use          |

Every issue carries `title`, `problem`, `whyItMatters`, `remediation`, `affectedSubnetIds` — all
four required fields, no shortcuts.

- `app/security/index.tsx` — plan selector, severity filter chips with counts, grouped issue list,
  `SecurityIssueCard.tsx` (severity icon + label + color, never color alone), per-issue
  "affected subnets" links that jump to the planner row.
- The `SECURITY_DISCLAIMER` is displayed at the top of the audit screen: _"This auditor performs
  static design checks on your plan. It does not scan, test, or guarantee the security of any
  network."_ Non-negotiable, per spec.

**`tests/security-auditor.test.ts`** — one clean plan producing **zero** issues (this is the
important test: a rule set that cries wolf is useless), then one minimal fixture per rule
triggering exactly that rule, plus a test asserting each rule fires at its intended severity.
Also assert a plan with no subnets returns `[]` rather than throwing.

**Exit criteria:** every rule has a positive and a negative test; a clean plan audits clean.

---

### Phase 12 — Address Space Visualization · ~1.5 days

**Goal:** see the parent network as a proportion bar that adapts from `/8` to `/30`.

`src/components/AddressSpaceBar.tsx` + `SubnetBar.tsx` using `react-native-svg`.

- Segments sized by `blockSize / parentTotal`, in address order, with a leading free-range
  segment if the first allocation does not start at the parent base.
- Minimum rendered width (e.g. 3 pt) so a /30 is still visible inside a /8 — but **only** as a
  visual floor, with the true proportion preserved in the label. Do not let a minimum width
  misrepresent proportions; when segments would be sub-pixel, collapse to a stacked summary with
  a zoom affordance instead.
- Each segment: role color, CIDR, VLAN badge, capacity, used% / free%.
- Tap a segment → detail sheet (subnet fields, utilization bar, related issues).
- Legend with role colors; tap-to-filter.
- A "fragment health" strip: free ranges under /29 shown as unusable dust.
- Respect `prefers-reduced-motion`; no animation is required for comprehension.

**Exit criteria:** correct proportions at `/24` and at `/20` with many segments; readable on a
320 pt screen; a11y labels describe each segment ("Students, VLAN 10, 192.168.1.0/25, 128
addresses, 78 percent used") so the chart is usable with a screen reader.

---

### Phase 13 — Learning Mode · ~2 days

**Goal:** teach the same math the engine implements, then check understanding.

- `src/content/topics.ts` — 10 topics (IPv4 addressing, CIDR, subnet masks, wildcard masks,
  network addresses, broadcast addresses, usable hosts, VLSM, VLANs, segmentation). Each:
  title, 3–6 short sections, a worked example, and 2–3 takeaways. Written as data, not JSX.
- `app/learning/index.tsx` — topic list with progress; `app/learning/practice.tsx` — practice.
- `src/core/question-generator.ts` — **deterministic generators, not a random blob**:
  - _Smallest CIDR for N hosts_ — options are the plausible neighbours (correct ±1 bit).
  - _Subnet from an IP and prefix_ — verify with `calculateSubnet`, so a wrong engine key would
    fail the test suite.
  - _Classify the address space_ — RFC 1918 vs public.
  - _Compute the mask_ — options are 4 real subnet masks.
  - _VLSM allocation_ — reuse `packVLSM` on a generated parent.
    Every answer is explained **after** submission, showing the arithmetic
    (`2^7 - 2 = 126 ≥ 100`, so `/25`).
- Stats persisted to AsyncStorage: attempts, correct, per-topic. Streak is a nice-to-have; ship
  only if time allows.
- Distractors must be plausible-but-wrong (off-by-one bit, usable-vs-total confusion) — a lesson
  in itself, and the explanation should call out the specific trap.

**Exit criteria:** generator determinism tested (same seed → same question); every topic renders;
explanations present for all five question types.

---

### Phase 14 — Configuration Export · ~1.5 days

**Goal:** useful templates, unmistakably labelled as templates.

`src/core/config-exporter.ts` — pure string generation, so it is testable. Three targets:

- **Cisco IOS** — `interface GigabitEthernet0/0.20` / `encapsulation dot1Q 20` /
  `ip address 192.168.1.129 255.255.255.192` / `no shutdown`, per VLAN, plus `switchport access
vlan` for access ports. The interface naming (`0/0.20`) must be **user-configurable** — the
  spec's example implies a convention that is not universal.
- **Linux iptables** — a `FORWARD` policy skeleton with `-s`/`-d` subnet rules and conntrack
  state, generated from role pairs.
- **JSON** — the full plan, `schemaVersion`, export timestamp.

Every output begins with a generated banner:

```
# NetArchitect TEMPLATE — NOT A DEPLOYED CONFIG
# Generated offline on <device local date>. REVIEW BEFORE APPLYING.
# NetArchitect generates suggestions only; it never connects to or configures a network.
```

- `app/plans/[id].tsx` export sheet: target selector, live preview (scrollable monospace),
  Copy / Share / Save-as-file. `expo-clipboard`, `expo-sharing`, `expo-file-system`.
- **The app never executes anything.** No shell, no SSH, no network calls. Add a CI grep
  asserting the source contains no `fetch(`/`XMLHttpRequest`/`axios` outside dev tooling.

**Exit criteria:** all three targets render; banner present in all; output snapshot-tested so a
formatting regression is caught.

---

### Phase 15 — Accessibility, Responsive & Offline Hardening · ~1.5 days

- **Severity without color:** each level gets a distinct Lucide icon _and_ a text label _and_
  color. Verify in grayscale and with a color-vision-deficiency simulator.
- Touch targets ≥ 44×44 pt everywhere; verify with the RN layout inspector.
- Text scales to the largest system font without truncation or overlap. Test at 200% font size
  — this is where fixed-height rows break.
- Screen reader: every icon-only control has `accessibilityLabel` + `accessibilityRole`;
  decorative icons are `accessibilityElementsHidden`; the address-space bar is one node with a
  descriptive label plus per-segment children.
- Responsive: `useWindowDimensions` breakpoints — phone single column, ≥768 px two-pane planner
  (list + detail), ≥1024 px constrained content width with the table non-scrolling. Never assume
  a fixed size; never hardcode a pixel width without a max.
- Orientation: both orientations on phone and tablet.
- Offline verification: airplane-mode test pass over every screen. If any `expo-updates` config
  is present, verify the app boots and fully functions with no network.
- Force-wrap: every screen in an `ErrorBoundary`; DB-open failure shows a recoverable screen
  rather than a white screen.
- `prefers-reduced-motion` respected.

**Exit criteria:** a documented a11y pass (VoiceOver iOS + TalkBack Android, 200% font,
grayscale); airplane-mode pass with screenshots; no crash on malformed DB state.

---

### Phase 16 — Device Testing & Release · ~1.5 days

- `eas.json` — `development` / `preview` / `production` profiles, Android + iOS, internal
  distribution first.
- Test matrix: Android phone (small, ~5.5 in), Android tablet, iPhone SE (smallest realistic),
  iPad. Plus one low-memory device if available.
- Offline: airplane mode through the entire user journey — calculator → VLSM → planner → audit →
  save → relaunch → export.
- Perf sanity: 100-subnet plan, 500-plan list, rapid keystroke input in the calculator. Target
  60 fps on the planner table.
- App icon, splash, store copy, and a privacy statement that states plainly: no accounts, no
  analytics, no network access, all data local to the device.
- Ship.

---

## 4. Phase Dependency Graph

```
P0 scaffold
 └─ P1 types/errors/formatting
     ├─ P2 ip-engine ──┐
     │   (BLOCKS ALL)  │
     └─ P3 vlsm-engine ┤
         └─ P4 validation (needs P2+P3)
             └─ P5 shell/theme/primitives
                 ├─ P6 calculator      (P2, P4)
                 ├─ P7 vlsm planner   (P3, P4)
                 └─ P8 network planner(P3, P4)
                     └─ P9 persistence (P8)
                         └─ P10 saved plans
                             └─ P11 security auditor (needs P3, P8)
                                 └─ P12 visualization
                                     └─ P13 learning (needs P2, P3, P4)
                                         └─ P14 config export (needs P8)
                                             └─ P15 a11y/responsive
                                                 └─ P16 device/release
```

P12, P13, and P14 are mutually independent after P11 — parallelizable.
**P2 and P3 are the critical path and carry the real risk. Do not rush them.**

---

## 5. Risk Register

| #   | Risk                                                                                                              | Impact                                                       | Mitigation                                                                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | **JS signed-32-bit contamination** in IPv4 math                                                                   | Silent wrong answers on some inputs only — worst kind of bug | `>>> 0` everywhere; independent reference implementation in tests; full 0–32 prefix sweep; explicit `2147483647` / `2147483648` cases                                                                                                                                                |
| R2  | **`<< 32` shift-masking** makes `/0` wrong                                                                        | `/0` reports an all-ones mask                                | `prefix === 0` special case + dedicated regression test                                                                                                                                                                                                                              |
| R3  | VLSM alignment bug producing subnets off their boundary                                                           | Overlaps / unusable routing                                  | `Math.ceil(cursor/blockSize)*blockSize` + `detectOverlap` tripwire + property test                                                                                                                                                                                                   |
| R4  | **Vitest + React Native Testing Library** integration is genuinely awkward (RN's jest-oriented preset vs. Vitest) | Time sink                                                    | **DECIDED at Phase 5: declined, with a trigger condition rather than an open question.** See below. |
| R5  | NativeWind v5 RC temptation                                                                                       | Build breaks on upgrade; `tailwind.config.js` disappears     | Pin v4.2.7 + Tailwind 3. Revisit v5 after it goes stable                                                                                                                                                                                                                             |
| R6  | Zustand re-render storms on the planner table                                                                     | Janky editing                                                | Keep derived data in `useMemo` keyed on the plan tuple; keep subnets in the store, derived issues out of it; no selectors returning new object/array literals without `useShallow`                                                                                                   |
| R7  | SVG chart misrepresenting proportions with a min-width floor                                                      | User misreads the plan                                       | Preserve true proportion in labels; collapse to a summary when sub-pixel rather than distort                                                                                                                                                                                         |
| R8  | `exactOptionalPropertyTypes` friction                                                                             | Compile errors late in the build                             | Enable in P0, pay it immediately on small files instead of large ones                                                                                                                                                                                                                |
| R9  | Export templates being copy-pasted into production un-reviewed                                                    | Real network disruption                                      | Unmissable banner + `namingConvention` config + a "review checklist" in the export sheet. The app never executes anything                                                                                                                                                            |
| R10 | Auditor false positives eroding trust                                                                             | Users ignore all findings                                    | A clean plan must audit to zero issues; that is a tested invariant, not an aspiration                                                                                                                                                                                                |

#### R4 — decided at Phase 5: no component-test runner, and what replaces it

The plan said "decide at Phase 5, not Phase 0". Phase 5 has happened, so this is a decision rather
than a deferral. **No `jest-expo` / React Native Testing Library runner is being added.** What
replaces it is a stronger architectural commitment, not a weaker substitute.

**The evidence.** Phase 5 produced five bugs that reached a passing build, and it is worth being
precise about which of them a component test would have caught:

| Bug                                                       | Caught by                                | Would RNTL have caught it? |
| --------------------------------------------------------- | ---------------------------------------- | ------------------------- |
| Design tokens dropped from `@layer base`                   | `verify-theme.cjs`                       | **no** — never imported   |
| `:root.dark` dropped by the interop normaliser (native only) | `verify-theme.cjs`                       | **no** — never imported   |
| `font-mono` silently absent, rendering addresses proportionally | `tailwind.config.js` inspection      | **no** — a wrong style object, not a wrong render |
| `scripts/**` ESLint override doing nothing                 | reading the config, then a negative control | **no** — a lint config    |
| `cn()` not grouping bespoke sizing tokens                  | 18 unit tests in `tests/cn.test.ts`      | **no** — `cn` has no render |
| *(would-be)* misordered `cn()` argument                    | `check-class-order.cjs`                  | **probably**              |

Every one of these lives in the styling and configuration pipeline. RNTL renders components against
mocked NativeWind output; it has no reach into Tailwind's compiler, lightningcss, ESLint's config
resolution order, or a third-party merge library's validators. The one bug it would likely have
caught is the one a 60-line purpose-built script catches *with a file and line number*, and which
also covers `src/` and `app/` uniformly rather than only the components someone wrote a test for.

**The argument that actually decides it.** This project's recurring failure mode is not missing
coverage — it is **green that means nothing**. Every tooling bug in the table above shipped behind a
zero exit code, a clean typecheck and a passing test suite. Adding a second test runner whose
assertions are made against a mock tree would add green surface area without adding much evidence,
which is the exact trade this project keeps making badly. What it needs is checks that assert on
*artifacts* — the compiled stylesheet, the real bundle, the resolved config — and it now has three.

**What replaces it, concretely.** Interactive logic does not go into components. It goes into pure
functions that Vitest tests directly, which is the same move that made `src/core` testable in the
first place. Concretely, for Phase 6: the CIDR input's parse/debounce/derive pipeline belongs in
`src/core` or `src/utils` as a pure unit, and the component only calls it. If a component ever
needs to own state that cannot be extracted, that is the signal.

**The trigger to re-open this.** Any one of:

- A component owns non-extractable state whose behaviour a user depends on and a device pass cannot
  cheaply re-verify — e.g. keyboard navigation, focus order, or a multi-step form.
- Phase 15 (accessibility/responsive) finds a layout bug that a render assertion would have caught,
  and re-verifying it on a device each time proves too slow.
- The interactive primitive count grows past roughly six, at which point per-device verification
  stops being free.

Until one of those happens, the answer is a device pass — which is required anyway, and which is
currently **the single largest unverified gap in the project**.

---

## 6. Definition of Done

The product loop from the spec must work end to end, offline, on a real device:

> "Here is my network." → enter `10.10.0.0/16`
> → "Here are my required hosts." → 400 users, 50 servers, 20 phones
> → "Here are my optimized subnets." → correctly packed, no overlaps, alignment verified
> → "Here is my VLAN plan." → roles, VLAN IDs, gateways
> → "Here are the network design issues." → severity-grouped findings with remediation
> → "Here is my saved network plan." → survives force-quit

Plus:

- [ ] `tsc --noEmit` clean under full strict mode + the extra flags
- [ ] ESLint + Prettier clean
- [ ] 100% coverage on `src/core/**`; every boundary case from §1 tested
- [ ] Zero `any` in `src/core/**`; zero networking math in any component
- [ ] `src/core/**` imports no RN/Expo module (enforce with a test or a CI grep)
- [ ] No `fetch` / HTTP client anywhere in shipped code (CI grep)
- [ ] Airplane-mode pass over every screen
- [ ] A11y pass: screen reader, 200% font, grayscale severity check
- [ ] Smallest supported phone through largest tablet, both orientations
- [ ] Migrations forward-tested from v1 → v2 on a real v1 database
- [ ] Security disclaimer visible on the audit screen and in every export
- [ ] Every plan the spec's examples produce, reproduced exactly by the app

---

## 7. Suggested First Three Actions

1. **Phase 0 + 1 together**, in one sitting. Get the toolchain verified on a device before a
   single line of product code.
2. **Phase 2 with tests written first.** Write `tests/ip-engine.test.ts` with the independent
   reference implementation _before_ the engine. The reference impl in the test is the thing that
   actually protects you from R1 and R2.
3. **Resist the UI until P5.** The app is only as trustworthy as the engine, and the engine is the
   part that is genuinely hard. A beautiful screen over a wrong mask is worse than no app.
