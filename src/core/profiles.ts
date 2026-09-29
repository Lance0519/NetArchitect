/**
 * Plan profile templates.
 *
 * PURE MODULE. No React, no React Native, no Expo.
 *
 * ## A profile is host hints, never addresses
 *
 * Every entry here supplies a **name, a role and a rough host count**. Not one address
 * appears anywhere in this file, and that is the single most important property of it.
 *
 * A profile that contained `192.168.1.0/25` would be wrong the moment the user picked a
 * different parent block, and wrong in a way that looks plausible: the address is a real
 * address inside a real block, so the plan would build, pack nothing, and silently
 * describe a network the user never chose. The addresses are the engine's output, from
 * the requirements these hints produce, for the parent the user typed.
 *
 * So `profileRequirements` is a pure function of the profile. There is no parent argument
 * and there never should be one - see the deviation note below.
 *
 * ## The hints have to actually be sensible
 *
 * A hint is "roughly this many hosts", and roughly is doing real work: 50 means a LAN of
 * about fifty devices, not a /26 chosen for a reason. The counts below are chosen to sit
 * comfortably inside the block each role is usually given, so that applying a profile to a
 * `/24` produces subnets that fit with room to grow and do not strand a quarter of the
 * address space.
 *
 * Where a role has a conventional size, the hint follows the convention and the comment
 * says which one. Where it does not, the hint is round because a round number is what a
 * person estimating a headcount would actually write.
 *
 * ## The spec example falls out of these counts
 *
 * The plan's School Network example is `192.168.1.0/24` with requirements of 100, 50, 25
 * and 10 hosts, and the expected result is `.0/25`, `.128/26`, `.192/27`, `.224/28`. Those
 * addresses are not written down anywhere in this project. They are what the engine
 * produces from those four counts, and `tests/profiles.test.ts` pins the derivation by
 * packing the profile's own hints and comparing against the engine's output rather than
 * against a second copy of the same table.
 *
 * ## Departure from the plan, recorded
 *
 * The plan sketches `profileTemplates.personal('192.168.1.0/24')` returning requirements.
 * **The parent argument is omitted deliberately.** A hint does not depend on the parent:
 * "about fifty hosts" is fifty hosts in a `/24` and in a `/20` alike. Accepting a parent
 * here would invite this module to start *scaling* hints to fit, and scaling is a policy
 * the plan nowhere specifies - silently halve every hint when the parent is small? Drop
 * the largest role? Both are defensible and neither is the reader's expectation, so a
 * caller doing it here would be making a design decision inside a data table.
 *
 * Packing is the engine's job, the caller does it, and when the hints do not fit the
 * caller gets the engine's own structured `ScopeExhaustionError` with its verified
 * wider-parent suggestion - the machinery built and tested in Phase 7. A profile that
 * cannot fit reports that rather than quietly shrinking itself.
 */

import { packVLSM } from './vlsm-engine';

import type { HostRequirement, NetworkRole, PlanProfile, VlsmResult } from '../types/network';

/* ------------------------------------------------------------------ *
 * One profile entry
 * ------------------------------------------------------------------ */

export interface ProfileEntry {
  /** Shown in the list and used as the subnet name. */
  readonly name: string;
  readonly role: NetworkRole;
  /**
   * A rough host count. A hint, not a commitment - the engine rounds it up to the next
   * power of two, which is the entire reason a VLSM plan exists.
   */
  readonly hosts: number;
  /** Why this count, in one line. Pinned in tests so a change is deliberate. */
  readonly rationale: string;
}

export interface ProfileDefinition {
  readonly id: Exclude<PlanProfile, 'custom'>;
  readonly label: string;
  readonly description: string;
  /** The entries, in the order they should be offered and packed. */
  readonly entries: readonly ProfileEntry[];
}

/* ------------------------------------------------------------------ *
 * The profiles
 * ------------------------------------------------------------------ */

/**
 * A home or small office.
 *
 * Ordered by trust rather than by size: the trusted LAN is listed first because it is what
 * a reader scans for, and the untrusted segments follow. `packVLSM` re-sorts by size
 * internally, so this order is presentation only - but it is the order a person reads the
 * picker in, and the order the table is generated in.
 */
export const PERSONAL_PROFILE: ProfileDefinition = Object.freeze({
  id: 'personal',
  label: 'Home / small office',
  description:
    'A trusted network for your own devices, with the things that should not be trusted kept apart: guest visitors, and the embedded devices that came with the house.',
  entries: Object.freeze([
    {
      name: 'Trusted LAN',
      role: 'LAN',
      // A typical household plus a home-lab's worth of spare kit. Two thirds of a /24
      // is generous, and being generous here is what leaves room for the other four.
      hosts: 100,
      rationale: 'A household, plus lab kit. Generous on purpose: this is the segment that absorbs new devices.',
    },
    {
      name: 'IoT',
      role: 'IOT',
      // Smart bulbs, plugs, a thermostat, two cameras and a hub: about twenty, and
      // every one of them is a device that was never asked whether it wanted a firewall.
      hosts: 25,
      rationale: 'Bulbs, plugs, cameras, a hub. Sized for what a house accumulates, not for what it declares.',
    },
    {
      name: 'Guest WiFi',
      role: 'GUEST',
      // Visitors, and their phones, over a long weekend.
      hosts: 25,
      rationale: 'Visitors and their devices. A large enough block that a full house of guests never sees it full.',
    },
    {
      name: 'Home Lab',
      role: 'SERVERS',
      // VMs, containers and a hypervisor host. The one block that is allowed to be
      // hungry, because it is the one that gets a second server before the first fills.
      hosts: 20,
      rationale: 'Virtual machines and containers, which are created long after the network is built.',
    },
    {
      name: 'Management',
      role: 'MANAGEMENT',
      // A switch, a router, an AP or two, and a hypervisor. The convention here is the
      // /28 ceiling, not the arithmetic: management does not need a segment proportional
      // to the rest of the network, and a small one is easier to keep locked down.
      hosts: 10,
      rationale: 'Switches, router, access points. Deliberately small: management is easier to secure when it is small.',
    },
  ] as const),
});

/**
 * An office or campus.
 *
 * Carries the roles that only make sense at this size: a DMZ for internet-facing
 * services, a voice segment, and a point-to-point link. `PACK_ORDER` is the presentation
 * order and does not match the size order - the engine re-sorts, and a table that appeared
 * to jump about on every edit would be unreadable.
 */
export const ENTERPRISE_PROFILE: ProfileDefinition = Object.freeze({
  id: 'enterprise',
  label: 'Office / campus',
  description:
    'A segmented office: user network, servers, voice, management, a DMZ for internet-facing services, guest wireless, and a routed link to somewhere else.',
  entries: Object.freeze([
    {
      name: 'Corporate Users',
      role: 'LAN',
      hosts: 500,
      rationale: 'Desktops, laptops and their phones. The largest block in almost every real plan.',
    },
    {
      name: 'Servers',
      role: 'SERVERS',
      hosts: 100,
      rationale: 'Physical hosts and their virtualisation capacity, which is always larger than the physical count.',
    },
    {
      name: 'Guest',
      role: 'GUEST',
      hosts: 100,
      rationale: 'Visitors, contractors and conference-room overflow. Cheap to over-provision and expensive to under-provision.',
    },
    {
      name: 'VoIP',
      role: 'VOIP',
      // One address per handset, plus the voice gateway, plus headroom for a floor being
      // re-numbered. The arithmetic is 1:1 and it is the one role where that is exact.
      hosts: 100,
      rationale: 'One address per handset, plus the voice gateway. The one role where one address per device is exact.',
    },
    {
      name: 'IoT',
      role: 'IOT',
      hosts: 50,
      rationale: 'Printers, badge readers, cameras, building management. Devices nobody chose and nobody patches.',
    },
    {
      name: 'Management',
      role: 'MANAGEMENT',
      hosts: 25,
      rationale: 'Switches, routers, hypervisors, out-of-band access. Kept to a block small enough to be worth locking down.',
    },
    {
      name: 'DMZ',
      role: 'DMZ',
      hosts: 25,
      rationale: 'Reverse proxies, mail and web-facing systems. Small on purpose: everything in it is reachable from outside.',
    },
    {
      name: 'Branch Link',
      role: 'POINT_TO_POINT',
      // A routed link is two addresses and nothing else. The engine gives it a /31 under
      // RFC 3021, where both addresses are usable, so the hint is the real requirement
      // rather than a rounding-up of a larger fiction.
      hosts: 2,
      rationale: 'A /31 to the branch: two addresses, both usable under RFC 3021. Nothing here is spare.',
    },
  ] as const),
});

/* ------------------------------------------------------------------ *
 * Registry
 * ------------------------------------------------------------------ */

/**
 * Every selectable profile, in picker order.
 *
 * `custom` is absent because it is the absence of a profile: the user is building the
 * subnet list by hand. It stays a member of `PlanProfile` so a stored plan can record
 * "no template", which is a different statement from "the personal template".
 */
export const PROFILE_DEFINITIONS: readonly ProfileDefinition[] = Object.freeze([
  PERSONAL_PROFILE,
  ENTERPRISE_PROFILE,
] as const);

/** Profiles a picker can offer, in order. Derived, so a new profile appears once added. */
export const SELECTABLE_PROFILES: readonly Exclude<PlanProfile, 'custom'>[] = Object.freeze(
  PROFILE_DEFINITIONS.map((definition) => definition.id),
);

/**
 * A profile by id, or `null` for `custom` and for anything unrecognised.
 *
 * Returning `null` rather than throwing is deliberate. A stored plan can name a profile
 * this build of the app does not have - the data outlives the code - and a reader that
 * throws turns a downgrade into a crash. A missing profile is a plan the user can still
 * open and edit, which is the correct outcome.
 */
export const profileById = (id: PlanProfile): ProfileDefinition | null =>
  PROFILE_DEFINITIONS.find((definition) => definition.id === id) ?? null;

/* ------------------------------------------------------------------ *
 * Requirements
 * ------------------------------------------------------------------ */

/**
 * The host requirements a profile stands for.
 *
 * `id` is derived from the profile id and the entry's position, so the same profile always
 * produces the same ids: applying a profile twice is idempotent, which matters because
 * the result is compared against a previous plan to build a diff.
 */
export const profileRequirements = (profile: ProfileDefinition): readonly HostRequirement[] =>
  profile.entries.map((entry, index) => ({
    id: `${profile.id}-${index}`,
    name: entry.name,
    requestedHosts: entry.hosts,
    role: entry.role,
  }));

/**
 * The result of packing a profile's hints into a parent, or the engine's own failure.
 *
 * This is the module's only bridge to the engine, and it exists so a caller gets the
 * structured error rather than a message. It never catches: a `ScopeExhaustionError` from
 * here carries its `reason` and `shortfallAddresses`, and the Phase 7 screen turns that
 * into a verified wider-parent suggestion. A profile that cannot fit a parent must say so
 * through the same channel as any other set of requirements that cannot - not through a
 * quieter path of its own.
 */
export const packProfile = (profile: ProfileDefinition, parentCidr: string): VlsmResult =>
  packVLSM(parentCidr, profileRequirements(profile));
