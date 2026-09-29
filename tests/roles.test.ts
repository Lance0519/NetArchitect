/**
 * Tests for the role metadata table.
 *
 * The table looks like data, so it is exactly the kind of file a refactor edits without
 * thinking. These tests pin the parts that are decisions rather than labels: which roles
 * are untrusted, which expect a VLAN, and which face the internet. The Phase 11 auditor
 * will read those booleans directly, so changing one here silently changes security
 * findings.
 *
 * Exhaustiveness is NOT tested here, and deliberately so. `ROLE_DEFINITION_BY_ROLE` is
 * annotated `satisfies Record<NetworkRole, RoleDefinition>`, so adding a role to the
 * union without adding it to the table is a `tsc` failure, and adding a key that is not
 * a role is an excess-property failure. A runtime loop over a hand-copied array would be
 * a weaker version of a check the compiler already performs, and would be the copy most
 * likely to drift.
 */

import { describe, expect, it } from 'vitest';

import {
  NETWORK_ROLES,
  NETWORK_ROLE_TUPLE,
  ROLE_DEFINITION_BY_ROLE,
  isPointToPointRole,
  roleLabel,
} from '../src/core/roles';
import { packVLSM } from '../src/core/vlsm-engine';

import type { NetworkRole } from '../src/types/network';

const ALL: readonly NetworkRole[] = NETWORK_ROLES;

describe('the role list', () => {
  it('has no duplicates', () => {
    expect(new Set(ALL).size).toBe(ALL.length);
  });

  it('has a definition for every role in it', () => {
    for (const role of ALL) {
      expect(ROLE_DEFINITION_BY_ROLE[role], role).toBeDefined();
    }
  });

  it('holds no role that is not in the list', () => {
    // The other half of exhaustiveness, checked at runtime as well: a key added to the
    // table and forgotten in the list would be reachable through the record and absent
    // from every picker.
    expect(Object.keys(ROLE_DEFINITION_BY_ROLE).sort()).toEqual([...ALL].sort());
  });

  it('exposes a tuple that starts with a real role, for z.enum', () => {
    expect(NETWORK_ROLE_TUPLE.length).toBe(ALL.length);
    expect(ALL).toContain(NETWORK_ROLE_TUPLE[0]);
  });

  it('is frozen, so a component cannot extend it at runtime', () => {
    expect(Object.isFrozen(ALL)).toBe(true);
  });
});

describe('role metadata', () => {
  it('gives every role a non-empty label, description and guidance', () => {
    for (const role of ALL) {
      const definition = ROLE_DEFINITION_BY_ROLE[role];
      expect(definition.label.length, role).toBeGreaterThan(0);
      expect(definition.description.length, role).toBeGreaterThan(0);
      expect(definition.guidance.length, role).toBeGreaterThan(0);
      expect(definition.icon.length, role).toBeGreaterThan(0);
    }
  });

  it('keeps each definition self-consistent with its key', () => {
    // A table keyed one way and labelled another is how a row ends up saying "DMZ" in a
    // table whose own record says role: 'GUEST'.
    for (const role of ALL) {
      expect(ROLE_DEFINITION_BY_ROLE[role].role, role).toBe(role);
    }
  });

  it('gives no two roles the same label', () => {
    // Labels are a column header and a filter value; duplicates make both ambiguous.
    const labels = ALL.map((role) => ROLE_DEFINITION_BY_ROLE[role].label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('resolves a label through the helper', () => {
    expect(roleLabel('SERVERS')).toBe(ROLE_DEFINITION_BY_ROLE.SERVERS.label);
    expect(roleLabel('POINT_TO_POINT')).toBe(ROLE_DEFINITION_BY_ROLE.POINT_TO_POINT.label);
  });

  it('ends every guidance sentence with a full stop, so the table reads as prose', () => {
    // A trailing inconsistency here is a visible one: the guidance renders directly into
    // a card in the Phase 8 planner.
    for (const role of ALL) {
      const { guidance } = ROLE_DEFINITION_BY_ROLE[role];
      expect(guidance.endsWith('.'), role).toBe(true);
    }
  });
});

describe('trust classification', () => {
  it('treats the roles that face users or devices as untrusted', () => {
    // This is the set the Phase 11 auditor will isolate. Widening it changes findings;
    // narrowing it silently exempts a subnet from every rule that depends on trust.
    const untrusted = ALL.filter((role) => ROLE_DEFINITION_BY_ROLE[role].isUntrusted);
    expect(untrusted.sort()).toEqual(['CUSTOM', 'GUEST', 'IOT']);
  });

  it('treats the internal infrastructure roles as trusted', () => {
    for (const role of ['LAN', 'SERVERS', 'MANAGEMENT', 'VOIP', 'DMZ', 'POINT_TO_POINT'] as const) {
      expect(ROLE_DEFINITION_BY_ROLE[role].isUntrusted, role).toBe(false);
    }
  });

  it('treats an undefined custom role as untrusted', () => {
    // Pinned because the safe direction is the debatable one. A role the project has
    // never seen cannot be vouched for, so it needs isolation until the person defining
    // it says otherwise. Defaulting this to false would exempt a typo from every
    // trust-dependent rule.
    expect(ROLE_DEFINITION_BY_ROLE.CUSTOM.isUntrusted).toBe(true);
  });

  it('marks only the roles that legitimately receive internet traffic as service-facing', () => {
    const facing = ALL.filter((role) => ROLE_DEFINITION_BY_ROLE[role].isServiceFacing);
    expect(facing.sort()).toEqual(['DMZ', 'SERVERS']);
  });

  it('never marks a role as both untrusted and service-facing', () => {
    // A role in both sets is a contradiction the auditor cannot resolve: the same subnet
    // would be told it is both isolated from the internet and exposed to it.
    for (const role of ALL) {
      const definition = ROLE_DEFINITION_BY_ROLE[role];
      expect(definition.isUntrusted && definition.isServiceFacing, role).toBe(false);
    }
  });
});

describe('VLAN expectations', () => {
  it('expects a VLAN everywhere except on point-to-point links', () => {
    // Untagged router-to-router and WAN circuits are the norm. Requiring a VLAN ID here
    // would ask for a value with no meaning, and the planner would either block on it or
    // invent one.
    for (const role of ALL) {
      const expected = role !== 'POINT_TO_POINT';
      expect(ROLE_DEFINITION_BY_ROLE[role].expectsVlan, role).toBe(expected);
    }
  });
});

describe('the point-to-point rule', () => {
  it('is true for exactly one role', () => {
    expect(ALL.filter(isPointToPointRole)).toEqual(['POINT_TO_POINT']);
  });

  it('actually drives the packer, rather than sitting beside it', () => {
    // Behavioural, not an identity check against a second copy. `vlsm-engine.ts` imports
    // this function, so the only thing worth asserting is the effect: the same host
    // count packs differently by role, and it is this rule that decides which.
    const sized = (role: NetworkRole) =>
      packVLSM('192.168.1.0/24', [{ id: 'x', name: 'X', requestedHosts: 2, role }])
        .allocations[0]?.assignedCidr;

    // Two hosts on a point-to-point link is a /31 with both addresses usable.
    expect(sized('POINT_TO_POINT')).toBe('192.168.1.0/31');
    // The same two hosts on a LAN is a /30, because a LAN reserves network and broadcast.
    expect(sized('LAN')).toBe('192.168.1.0/30');
  });
});

describe('the table is not mutable at runtime', () => {
  it('is frozen, so a screen cannot add a role by assignment', () => {
    // Custom roles are a Phase 8 feature and will need their own store. Until then, an
    // accidental write here would change the security classification of every subsequent
    // render with no error and no test failure.
    expect(Object.isFrozen(ROLE_DEFINITION_BY_ROLE)).toBe(true);
  });
});
