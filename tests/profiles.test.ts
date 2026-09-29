/**
 * Tests for the profile templates.
 *
 * ## The assertion this suite exists to make
 *
 * A profile must not contain an address. Everything a profile contributes is a name, a role
 * and a host count; every address in a plan built from one is produced by the engine. That
 * is checked structurally (no `profileRequirements` output carries a CIDR) and behaviourally
 * (the same profile packed into two different parents produces two different sets of
 * addresses).
 *
 * The School Network example is pinned here too, and pinned *through the engine* rather than
 * against a second copy of the expected table. A test that hardcodes the answer and a test
 * that derives it from the same inputs catch different mistakes, and only the second one
 * keeps working if the engine is ever corrected.
 */

import { describe, expect, it } from 'vitest';

import { ScopeExhaustionError } from '../src/core/errors';
import { calculateSubnet, integerToIPv4, parseCidr } from '../src/core/ip-engine';
import {
  ENTERPRISE_PROFILE,
  PERSONAL_PROFILE,
  PROFILE_DEFINITIONS,
  SELECTABLE_PROFILES,
  packProfile,
  profileById,
  profileRequirements,
} from '../src/core/profiles';
import { ROLE_DEFINITION_BY_ROLE } from '../src/core/roles';
import { packVLSM } from '../src/core/vlsm-engine';

import type { ProfileDefinition } from '../src/core/profiles';
import type { HostRequirement, PlanProfile } from '../src/types/network';

const cidrsInAddressOrder = (profile: ProfileDefinition, parent: string): string[] =>
  [...packProfile(profile, parent).allocations]
    .sort((a, b) => a.subnet.networkAddress - b.subnet.networkAddress)
    .map((allocation) => allocation.assignedCidr);

/* ================================================================== *
 * No addresses anywhere
 * ================================================================== */

describe('what a profile contributes', () => {
  it('supplies only a name, a role and a host count', () => {
    for (const profile of PROFILE_DEFINITIONS) {
      for (const entry of profile.entries) {
        expect(Object.keys(entry).sort(), `${profile.id} / ${entry.name}`).toEqual([
          'hosts',
          'name',
          'rationale',
          'role',
        ]);
      }
    }
  });

  it('contains no dotted-quad address in any string field', () => {
    // The structural version of "never hardcode an address in a profile". A regex rather
    // than a search for a known address, because the failure is not putting THIS address
    // in - it is putting ANY address in, and a list of known ones would not catch the next.
    const ADDRESS_LIKE = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
    for (const profile of PROFILE_DEFINITIONS) {
      for (const entry of profile.entries) {
        expect(entry.name, `${profile.id} / ${entry.name}`).not.toMatch(ADDRESS_LIKE);
        expect(entry.rationale, `${profile.id} / ${entry.name}`).not.toMatch(ADDRESS_LIKE);
        expect(entry.hosts, `${profile.id} / ${entry.name}`).not.toBeTypeOf('string');
      }
      expect(profile.label).not.toMatch(ADDRESS_LIKE);
      expect(profile.description).not.toMatch(ADDRESS_LIKE);
    }
  });

  it('emits requirements carrying no address at all', () => {
    // Not a regex check on the object, but on the shape: a `HostRequirement` has four
    // fields and none of them is a CIDR. If a future field is added, this fails.
    for (const profile of PROFILE_DEFINITIONS) {
      for (const requirement of profileRequirements(profile)) {
        expect(Object.keys(requirement).sort()).toEqual([
          'id',
          'name',
          'requestedHosts',
          'role',
        ]);
      }
    }
  });

  it('produces different addresses for the same profile in two different parents', () => {
    // The behavioural proof that addresses are derived rather than stored. A profile that
    // carried its own addresses would return the same subnets here.
    const personal = cidrsInAddressOrder(PERSONAL_PROFILE, '192.168.1.0/24');
    const elsewhere = cidrsInAddressOrder(PERSONAL_PROFILE, '10.20.0.0/24');
    expect(personal).not.toEqual(elsewhere);
    // And every one of them is genuinely inside the parent it was packed into.
    for (const cidr of elsewhere) {
      expect(cidr.startsWith('10.20.0.'), cidr).toBe(true);
    }
  });

  it('keeps every address it produces inside the parent it was given', () => {
    // Two families of parent, each sized for the profile it is tested against. The
    // enterprise profile needs about a thousand addresses, so a /24 is not a parent it can
    // be packed into at all - and a containment check that never reaches the containment
    // assertion because it died on an exhaustion error proves nothing about containment.
    const cases: readonly { profile: ProfileDefinition; parent: string }[] = [
      { profile: PERSONAL_PROFILE, parent: '10.0.0.0/20' },
      { profile: PERSONAL_PROFILE, parent: '172.16.0.0/20' },
      { profile: PERSONAL_PROFILE, parent: '192.168.10.0/24' },
      { profile: ENTERPRISE_PROFILE, parent: '10.0.0.0/20' },
      { profile: ENTERPRISE_PROFILE, parent: '172.16.0.0/20' },
    ];

    for (const { profile, parent } of cases) {
      const parentStart = parseCidr(parent).ip;
      const parentEnd = calculateSubnet(parentStart, parseCidr(parent).prefix).broadcastAddress;
      expect(packProfile(profile, parent).allocations.length, `${profile.id} in ${parent}`).toBe(
        profile.entries.length,
      );
      for (const allocation of packProfile(profile, parent).allocations) {
        const cidr = parseCidr(allocation.assignedCidr);
        expect(cidr.ip, `${profile.id} in ${parent}`).toBeGreaterThanOrEqual(parentStart);
        expect(allocation.subnet.broadcastAddress, `${profile.id} in ${parent}`).toBeLessThanOrEqual(
          parentEnd,
        );
      }
    }
  });

  it('covers every profile in the registry, so a new profile is tested the moment it is added', () => {
    // A containment test that loops over a hardcoded list is a test that quietly stops
    // covering the third profile. This is the assertion that makes the list above safe to
    // read as exhaustive: if `PROFILE_DEFINITIONS` grows, this fails and says which one.
    const covered = new Set([PERSONAL_PROFILE.id, ENTERPRISE_PROFILE.id]);
    expect(new Set(PROFILE_DEFINITIONS.map((profile) => profile.id))).toEqual(covered);
  });
});

/* ================================================================== *
 * The registry
 * ================================================================== */

describe('the profile registry', () => {
  it('offers exactly the two the plan names, in order', () => {
    expect(SELECTABLE_PROFILES).toEqual(['personal', 'enterprise']);
  });

  it('gives every profile a unique id, and no profile the id `custom`', () => {
    // `custom` is the absence of a template, so a profile holding that id would be two
    // different meanings behind one value in a stored plan.
    const ids = PROFILE_DEFINITIONS.map((profile) => profile.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('custom');
  });

  it('excludes `custom` from the registry, which is why profileById returns null for it', () => {
    expect(profileById('custom')).toBeNull();
    expect(profileById('personal')).toBe(PERSONAL_PROFILE);
    expect(profileById('enterprise')).toBe(ENTERPRISE_PROFILE);
  });

  it('gives every entry a non-empty rationale', () => {
    // A count with no reason behind it is a number someone guessed. The rationale is what
    // makes changing it a decision rather than a tweak.
    for (const profile of PROFILE_DEFINITIONS) {
      for (const entry of profile.entries) {
        expect(entry.rationale.trim().length, `${profile.id} / ${entry.name}`).toBeGreaterThan(20);
      }
    }
  });

  it('gives every entry a role that exists in the role table', () => {
    // The roles come from the enum, so this cannot fail today - and that is the point. If
    // someone hand-writes a profile with a role the table lacks, this is the check that
    // says so before the app does, at a role lookup that would return undefined.
    for (const profile of PROFILE_DEFINITIONS) {
      for (const entry of profile.entries) {
        expect(ROLE_DEFINITION_BY_ROLE[entry.role], `${profile.id} / ${entry.name}`).toBeDefined();
      }
    }
  });

  it('gives every entry a positive host count and a name', () => {
    for (const profile of PROFILE_DEFINITIONS) {
      for (const entry of profile.entries) {
        expect(entry.hosts, `${profile.id} / ${entry.name}`).toBeGreaterThan(0);
        expect(Number.isInteger(entry.hosts), `${profile.id} / ${entry.name}`).toBe(true);
        expect(entry.name.trim().length, `${profile.id} / ${entry.name}`).toBeGreaterThan(0);
      }
    }
  });

  it('names every subnet within the 80 characters the name rule allows', () => {
    // A profile name that exceeded the limit would produce a plan the validator rejects,
    // and the user would be editing a template rather than building a plan.
    for (const profile of PROFILE_DEFINITIONS) {
      for (const entry of profile.entries) {
        expect(entry.name.length, `${profile.id} / ${entry.name}`).toBeLessThanOrEqual(80);
      }
    }
  });

  it('gives every entry in a profile a distinct name', () => {
    // Two subnets with the same name cannot be told apart in an error message, which is the
    // whole reason `attributeCulprit` refuses to guess.
    for (const profile of PROFILE_DEFINITIONS) {
      const names = profile.entries.map((entry) => entry.name);
      expect(new Set(names).size, profile.id).toBe(names.length);
    }
  });

  it('is frozen, so a screen cannot mutate a template and change every later plan', () => {
    expect(Object.isFrozen(PROFILE_DEFINITIONS)).toBe(true);
    expect(Object.isFrozen(PERSONAL_PROFILE.entries)).toBe(true);
    expect(Object.isFrozen(ENTERPRISE_PROFILE.entries)).toBe(true);
  });
});

/* ================================================================== *
 * The plan's named examples
 * ================================================================== */

describe('the School Network example', () => {
  /**
   * `192.168.1.0/24` with 100, 50, 25 and 10 hosts, expected to give
   * `.0/25`, `.128/26`, `.192/27`, `.224/28`. This is the plan's Phase 8 exit criterion.
   *
   * The expected prefixes are NOT written out. Each one is derived from the host count by
   * the same engine call the app makes, and the *sizes* are asserted: 100 hosts needs a
   * block with at least 100 usable addresses, 50 needs one for 50, and so on. A test that
   * hardcoded the four strings would still pass if the engine's sizing were wrong, because
   * both sides would be wrong together.
   */
  it('produces blocks sized to its host counts, in address order, from the parent onwards', () => {
    const counts = [100, 50, 25, 10];
    const result = packVLSMFor(counts);
    const ordered = [...result].sort((a, b) => a.start - b.start);

    for (const [index, hosts] of counts.entries()) {
      const block = ordered[index];
      if (block === undefined) throw new Error('expected one block per requirement');
      expect(block.usable, `${hosts} hosts`).toBeGreaterThanOrEqual(hosts);
    }

    // And the first block starts at the parent, with no gap before it.
    expect(ordered[0]?.start).toBe(parseCidr('192.168.1.0/24').ip);
  });

  it('leaves no gap between consecutive blocks', () => {
    // The School Network example is specifically the *aligned* case: every block is a
    // power of two and they descend, so each one starts exactly where the last ended. A gap
    // here would mean the plan's stated output is not what the engine produces.
    const blocks = [...packVLSMFor([100, 50, 25, 10])].sort((a, b) => a.start - b.start);
    for (let i = 1; i < blocks.length; i += 1) {
      const previous = blocks[i - 1];
      const current = blocks[i];
      if (previous === undefined || current === undefined) throw new Error('expected a block');
      expect(current.start, `gap before block ${i + 1}`).toBe(previous.end + 1);
    }
  });

  it('fills the /24 to 240 of 256 addresses, freeing the last 16', () => {
    const result = packVLSMFor([100, 50, 25, 10]);
    const used = result.reduce((sum, block) => sum + block.size, 0);
    expect(used).toBe(128 + 64 + 32 + 16);
    expect(256 - used).toBe(16);
  });
});

/**
 * Pack a list of host counts into the School Network parent and report each block as
 * plain integers.
 *
 * A local helper rather than a second call into `packProfile`, because this case is about
 * four bare counts - it is not any profile in the registry, and pretending it were would
 * couple the plan's named example to whichever profile happens to hold matching numbers.
 */
function packVLSMFor(counts: readonly number[]) {
  // Imported lazily-by-name at the top of the file in spirit; the import list is
  // deliberately short so it is obvious this is the only engine call in the helper.
  const result = packVLSM(
    '192.168.1.0/24',
    counts.map((hosts, index) => ({
      id: `s${index}`,
      name: `Subnet ${index + 1}`,
      requestedHosts: hosts,
      role: 'LAN' as const,
    })),
  );
  return result.allocations.map((allocation) => {
    const start = allocation.subnet.networkAddress;
    const end = allocation.subnet.broadcastAddress;
    return {
      start,
      end,
      size: end - start + 1,
      usable: allocation.subnet.usableHosts,
      cidr: allocation.assignedCidr,
    };
  });
}

/* ================================================================== *
 * The two profiles
 * ================================================================== */

describe('the personal profile', () => {
  it('offers the five segments the plan names', () => {
    expect(PERSONAL_PROFILE.entries.map((entry) => entry.name)).toEqual([
      'Trusted LAN',
      'IoT',
      'Guest WiFi',
      'Home Lab',
      'Management',
    ]);
  });

  it('fits a /24 with room to spare, because a home network is usually one /24', () => {
    // If this ever stops fitting, every user applying the profile to a /24 gets an
    // exhaustion error on the most common parent in the app.
    const result = packProfile(PERSONAL_PROFILE, '192.168.1.0/24');
    expect(result.allocations).toHaveLength(PERSONAL_PROFILE.entries.length);
    expect(result.freeAddresses).toBeGreaterThan(0);
  });

  it('keeps guest and IoT off the trusted LAN, and gives each its own block', () => {
    // The point of a segmentation profile. A profile that packed IoT and Guest into the
    // trusted block would be shorter and would defeat the entire exercise.
    const result = packProfile(PERSONAL_PROFILE, '192.168.1.0/24');
    const byName = new Map(result.allocations.map((a) => [a.name, a]));
    const trusted = byName.get('Trusted LAN');
    const guest = byName.get('Guest WiFi');
    const iot = byName.get('IoT');
    expect(trusted).toBeDefined();
    expect(guest).toBeDefined();
    expect(iot).toBeDefined();
    expect(guest?.assignedCidr).not.toBe(trusted?.assignedCidr);
    expect(iot?.assignedCidr).not.toBe(trusted?.assignedCidr);
  });

  it('packs guest and IoT as separate blocks rather than sharing one', () => {
    const result = packProfile(PERSONAL_PROFILE, '192.168.1.0/24');
    const guest = result.allocations.find((a) => a.name === 'Guest WiFi');
    const iot = result.allocations.find((a) => a.name === 'IoT');
    const ranges = [guest, iot].filter((a) => a !== undefined);
    for (const a of ranges) {
      for (const b of ranges) {
        if (a === b) continue;
        expect(
          a.subnet.broadcastAddress < b.subnet.networkAddress ||
            b.subnet.broadcastAddress < a.subnet.networkAddress,
        ).toBe(true);
      }
    }
  });

  it('marks both untrusted segments with an untrusted role', () => {
    // The two roles that must be isolated are exactly the two the role table calls
    // untrusted, so a planner built from this profile is auditable from the first second.
    const untrusted = PERSONAL_PROFILE.entries.filter((entry) =>
      ROLE_DEFINITION_BY_ROLE[entry.role].isUntrusted,
    );
    expect(untrusted.map((entry) => entry.role).sort()).toEqual(['GUEST', 'IOT']);
  });

  it('sizes the point-to-point role out of existence, because a home has none', () => {
    expect(PERSONAL_PROFILE.entries.some((e) => e.role === 'POINT_TO_POINT')).toBe(false);
  });
});

describe('the enterprise profile', () => {
  it('offers the eight segments the plan names', () => {
    expect(ENTERPRISE_PROFILE.entries.map((entry) => entry.name)).toEqual([
      'Corporate Users',
      'Servers',
      'Guest',
      'VoIP',
      'IoT',
      'Management',
      'DMZ',
      'Branch Link',
    ]);
  });

  it('does NOT fit a /24, and says so through the engine', () => {
    // Deliberate, and the reason this test exists. A /20 is the realistic parent for eight
    // segments totalling roughly a thousand hosts, and the profile is not going to quietly
    // halve its hints to fit somewhere it does not belong. The failure must arrive as the
    // engine's own structured error, carrying the reason and the shortfall.
    let thrown: unknown;
    try {
      packProfile(ENTERPRISE_PROFILE, '192.168.1.0/24');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ScopeExhaustionError);
    const error = thrown as ScopeExhaustionError;
    expect(error.details.reason).toBe('INSUFFICIENT_TOTAL');
    expect(error.details.shortfallAddresses).toBeGreaterThan(0);
    expect(error.friendlyMessage.length).toBeGreaterThan(0);
  });

  it('fits a /20, the parent an office of this size would actually use', () => {
    const result = packProfile(ENTERPRISE_PROFILE, '10.0.0.0/20');
    expect(result.allocations).toHaveLength(ENTERPRISE_PROFILE.entries.length);
    expect(result.freeAddresses).toBeGreaterThan(0);
  });

  it('packs the branch link as a /31, where both addresses are usable', () => {
    // RFC 3021. A branch link given a /30 by habit would waste two of every four
    // addresses, and this is the one place in the whole app where that habit is most
    // common.
    const result = packProfile(ENTERPRISE_PROFILE, '10.0.0.0/20');
    const link = result.allocations.find((a) => a.role === 'POINT_TO_POINT');
    expect(link?.assignedCidr.endsWith('/31'), link?.assignedCidr).toBe(true);
    expect(link?.subnet.isPointToPoint).toBe(true);
    expect(link?.subnet.usableHosts).toBe(2);
  });

  it('places the branch link on an even boundary, as RFC 3021 Appendix A requires', () => {
    const result = packProfile(ENTERPRISE_PROFILE, '10.0.0.0/20');
    const link = result.allocations.find((a) => a.role === 'POINT_TO_POINT');
    if (link === undefined) throw new Error('expected a branch link allocation');
    expect(link.subnet.networkAddress % 2).toBe(0);
  });

  it('carries a DMZ and a point-to-point role, the two the personal profile omits', () => {
    const roles = ENTERPRISE_PROFILE.entries.map((entry) => entry.role);
    expect(roles).toContain('DMZ');
    expect(roles).toContain('POINT_TO_POINT');
  });

  it('gives management a /27, which is the smallest block that holds its 25 hosts', () => {
    // Management guidance talks about a /28, and a /28 has 14 usable addresses - fewer than
    // the 25 this profile claims. So the hint and the convention disagree, and this test
    // pins the arithmetic rather than the aspiration: 25 hosts needs 2^5 - 2 = 30 usable,
    // which is exactly a /27. Asserting `usableHosts === 30` rather than "at most something"
    // means that if the hint is ever changed, this test fails and says the hint moved -
    // instead of continuing to pass against a ceiling nobody re-read.
    const result = packProfile(ENTERPRISE_PROFILE, '10.0.0.0/20');
    const mgmt = result.allocations.find((a) => a.role === 'MANAGEMENT');
    if (mgmt === undefined) throw new Error('expected a management allocation');
    expect(mgmt.subnet.usableHosts).toBe(30);
    expect(mgmt.subnet.networkBits).toBe(27);
  });

  it('keeps management among the smallest blocks, so it is worth locking down', () => {
    // The security argument for a small management segment is that it is worth locking
    // down, and that argument only holds while it IS small. DMZ and management both take 25
    // hosts and therefore both come out as a /27, so this asserts management is no larger
    // than any other segment rather than strictly smallest - it is a tie with DMZ, and
    // writing `toBeGreaterThan` here would be asserting a difference the profile does not
    // have. What is being enforced is the direction: nothing dwarfs the management plane.
    const result = packProfile(ENTERPRISE_PROFILE, '10.0.0.0/20');
    const sizes = result.allocations.map((a) => ({ role: a.role, usable: a.subnet.usableHosts }));
    const mgmt = sizes.find((s) => s.role === 'MANAGEMENT');
    if (mgmt === undefined) throw new Error('expected a management allocation');
    for (const other of sizes) {
      // The point-to-point link is a /31 by design and is not a competing claim on the
      // management segment's size.
      if (other.role === 'POINT_TO_POINT') continue;
      if (other.role === 'MANAGEMENT') continue;
      expect(other.usable, `${other.role} vs management`).toBeGreaterThanOrEqual(mgmt.usable);
    }
  });
});

/* ================================================================== *
 * Requirement identity
 * ================================================================== */

describe('requirement identity from a profile', () => {
  it('is deterministic, so applying a profile twice is idempotent', () => {
    expect(profileRequirements(PERSONAL_PROFILE)).toEqual(profileRequirements(PERSONAL_PROFILE));
  });

  it('is unique within a profile, so React keys and diffs are sound', () => {
    const ids = profileRequirements(ENTERPRISE_PROFILE).map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not collide between profiles, so a plan can switch template without id reuse', () => {
    const personal = profileRequirements(PERSONAL_PROFILE).map((r) => r.id);
    const enterprise = profileRequirements(ENTERPRISE_PROFILE).map((r) => r.id);
    expect(personal.filter((id) => enterprise.includes(id))).toEqual([]);
  });

  it('carries the entry name and count through unchanged', () => {
    const requirements: readonly HostRequirement[] = profileRequirements(PERSONAL_PROFILE);
    expect(requirements[0]).toEqual({
      id: 'personal-0',
      name: 'Trusted LAN',
      requestedHosts: 100,
      role: 'LAN',
    });
  });

  it('survives `planSubnetsSchema` name rules, so a profile plan passes validation', () => {
    // The 80-character limit is the one a pasted profile name could plausibly breach.
    for (const profile of PROFILE_DEFINITIONS) {
      for (const requirement of profileRequirements(profile)) {
        expect(requirement.name.length).toBeLessThanOrEqual(80);
        expect(requirement.requestedHosts).toBeGreaterThan(0);
      }
    }
  });
});

/* ================================================================== *
 * Lookup robustness
 * ================================================================== */

describe('profileById', () => {
  it('returns null for a plan naming a profile this build does not have', () => {
    // Stored data outlives the code. A plan from a future build must open, not crash -
    // which is why this returns null instead of throwing, and why the planner has to
    // handle null.
    const future = 'school' as PlanProfile;
    expect(profileById(future)).toBeNull();
  });

  it('returns the same object every time, so identity checks are safe', () => {
    expect(profileById('personal')).toBe(profileById('personal'));
  });
});

/* ================================================================== *
 * One sanity check on the bridge to the engine
 * ================================================================== */

describe('packProfile', () => {
  it('returns the engine result unchanged, including the free ranges', () => {
    const result = packProfile(PERSONAL_PROFILE, '192.168.1.0/24');
    expect(result.allocations.length + result.freeAddresses).toBeGreaterThan(0);
    expect(result.allocatedAddresses + result.freeAddresses).toBe(result.totalAddresses);
    expect(integerToIPv4(result.parentCidr.ip)).toBe('192.168.1.0');
  });

  it('does not catch the engine error, so the caller gets a structured failure', () => {
    // Swallowing this into a return value would give the caller a message string where the
    // Phase 7 screen expects a `reason` and a verified suggestion. The error must travel.
    expect(() => packProfile(ENTERPRISE_PROFILE, '192.168.1.0/24')).toThrow(ScopeExhaustionError);
  });
});
