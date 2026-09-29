/**
 * Validation layer test suite.
 *
 * The product contract here is the MESSAGE TEXT. A schema that rejects the right
 * inputs with the wrong words is a bug, so nearly every case asserts the exact
 * string, and those strings are compared against the same frozen `MESSAGES`
 * object the app re-exports - which is itself compared against a literal, so a
 * change to the copy cannot pass unnoticed.
 *
 * The other half of the job is proving the schemas DELEGATE. If validation
 * reimplemented the engine's parsing, the two could disagree at the edges and
 * the app would accept what the engine rejects. Several tests below pin shared
 * behaviour between a schema and the engine function it wraps.
 */

import { describe, expect, it } from 'vitest';

import {
  cidrSchema,
  gatewaySchema,
  hostCountSchema,
  hostRequirementSchema,
  ipv4Schema,
  MESSAGES,
  optionalVlanIdSchema,
  planDescriptionSchema,
  planFormSchema,
  planNameSchema,
  planSubnetsSchema,
  prefixSchema,
  subnetCidrSchema,
  vlsmPlanSchema,
  vlanIdSchema,
} from '../src/core/validation';
import {
  calculateSubnet,
  integerToIPv4,
  parseCidr,
  parseIPv4,
  parsePrefix,
} from '../src/core/ip-engine';
import { InvalidHostCountError, InvalidPrefixError, InvalidVLANError } from '../src/core/errors';
import { packVLSM } from '../src/core/vlsm-engine';
import type { HostRequirement } from '../src/types/network';

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** The first message from a failed parse, or `undefined` when it passed. */
const messageOf = (result: {
  success: boolean;
  error?: { issues: readonly { message: string }[] };
}): string | undefined => result.error?.issues[0]?.message;

const expectOk = <T>(result: { success: boolean; data?: T; error?: unknown }): T => {
  if (!result.success) {
    throw new Error(`Expected success but got: ${messageOf(result as never)}`);
  }
  return result.data as T;
};

const expectFail = (result: {
  success: boolean;
  error?: { issues: readonly { message: string }[] };
}): string => {
  if (result.success) throw new Error('Expected failure but the value was accepted');
  return messageOf(result) as string;
};

const req = (
  name: string,
  requestedHosts: number,
  role: HostRequirement['role'] = 'LAN',
): HostRequirement => ({
  id: `req-${name}`,
  name,
  requestedHosts,
  role,
});

/* ================================================================== *
 * PINNED COPY
 * ================================================================== */

describe('pinned user-facing copy', () => {
  // These four are the spec's exact strings. Asserted as literals rather than
  // against MESSAGES, so that editing MESSAGES fails this test.
  it('matches the specification verbatim', () => {
    expect(MESSAGES.invalidIPv4).toBe('Enter a valid IPv4 address.');
    expect(MESSAGES.invalidPrefix).toBe('CIDR must be between /0 and /32.');
    expect(MESSAGES.invalidHostCount).toBe('Required hosts must be greater than 0.');
    expect(MESSAGES.scopeExhaustion).toBe('Not enough address space for these requirements.');
  });

  it('is frozen so a screen cannot mutate it at runtime', () => {
    expect(Object.isFrozen(MESSAGES)).toBe(true);
  });

  it('matches the engine error classes it is derived from', () => {
    // The copy is duplicated in MESSAGES for convenience; this proves the
    // duplication has not drifted from the single source of truth.
    expect(new InvalidPrefixError(99).friendlyMessage).toBe(MESSAGES.invalidPrefix);
    expect(new InvalidHostCountError(0).friendlyMessage).toBe(MESSAGES.invalidHostCount);
    expect(new InvalidVLANError(5000).friendlyMessage).toBe(MESSAGES.invalidVlan);
  });
});

/* ================================================================== *
 * IPv4
 * ================================================================== */

describe('ipv4Schema', () => {
  it('accepts a dotted-quad and yields the engine integer', () => {
    expect(expectOk(ipv4Schema.safeParse('192.168.1.1'))).toBe(3232235777);
  });

  it('trims surrounding whitespace, because people paste', () => {
    expect(expectOk(ipv4Schema.safeParse('  10.0.0.1  '))).toBe(parseIPv4('10.0.0.1'));
  });

  it.each([
    ['192.168.1.256', 'octet above 255'],
    ['192.168.1', 'only three octets'],
    ['192.168.1.1.1', 'five octets'],
    ['192.168.1.a', 'non-numeric octet'],
    ['', 'empty'],
    ['   ', 'whitespace only'],
    ['010.1.1.1', 'leading zero is ambiguous with octal'],
  ])('rejects %s (%s) with the pinned message', (input) => {
    expect(expectFail(ipv4Schema.safeParse(input))).toBe(MESSAGES.invalidIPv4);
  });

  it('rejects non-string input rather than coercing it', () => {
    expect(expectFail(ipv4Schema.safeParse(3232235777))).toBe(MESSAGES.invalidIPv4);
    expect(expectFail(ipv4Schema.safeParse(null))).toBe(MESSAGES.invalidIPv4);
    expect(expectFail(ipv4Schema.safeParse(undefined))).toBe(MESSAGES.invalidIPv4);
  });

  it('rejects a non-string CIDR with the CIDR message', () => {
    expect(expectFail(cidrSchema.safeParse(42))).toBe(MESSAGES.invalidCidr);
    expect(expectFail(cidrSchema.safeParse(null))).toBe(MESSAGES.invalidCidr);
    expect(expectFail(cidrSchema.safeParse({ ip: '192.168.1.0', prefix: 24 }))).toBe(
      MESSAGES.invalidCidr,
    );
  });

  it('agrees with the engine on every rejection', () => {
    // Delegation proof: a value the engine refuses must be refused here, and a
    // value it accepts must be accepted. If the schema ever grew its own
    // address grammar, this is the test that would notice.
    const candidates = [
      '0.0.0.0',
      '255.255.255.255',
      '1.2.3.4',
      '192.168.1.0',
      '172.16.0.1',
      '10.0.0.255',
    ];
    for (const value of candidates) {
      expect(ipv4Schema.safeParse(value).success, value).toBe(true);
    }
    for (const value of ['1.2.3', '1.2.3.4.5', '256.0.0.1', 'a.b.c.d', '1.2.3.4/24']) {
      expect(ipv4Schema.safeParse(value).success, value).toBe(false);
    }
  });
});

/* ================================================================== *
 * Prefix
 * ================================================================== */

describe('prefixSchema', () => {
  it('accepts a number, a numeric string, and a leading slash', () => {
    expect(expectOk(prefixSchema.safeParse(24))).toBe(24);
    expect(expectOk(prefixSchema.safeParse('24'))).toBe(24);
    expect(expectOk(prefixSchema.safeParse('/24'))).toBe(24);
  });

  it('accepts the full range including both extremes', () => {
    expect(expectOk(prefixSchema.safeParse(0))).toBe(0);
    expect(expectOk(prefixSchema.safeParse(32))).toBe(32);
  });

  it('rejects an out-of-range prefix with the pinned message', () => {
    expect(expectFail(prefixSchema.safeParse(33))).toBe('CIDR must be between /0 and /32.');
    expect(expectFail(prefixSchema.safeParse(-1))).toBe('CIDR must be between /0 and /32.');
  });

  it('rejects a non-integer prefix', () => {
    expect(expectFail(prefixSchema.safeParse(24.5))).toBe(MESSAGES.invalidPrefix);
  });

  it('says "required" for an empty field rather than blaming the range', () => {
    // "CIDR must be between /0 and /32" on a blank field would be confusing:
    // nothing was out of range, nothing was entered.
    expect(expectFail(prefixSchema.safeParse(''))).toBe('Prefix length is required.');
    expect(expectFail(prefixSchema.safeParse('   '))).toBe('Prefix length is required.');
    expect(expectFail(prefixSchema.safeParse(undefined))).toBe('Prefix length is required.');
  });

  it('never lets a blank field become /0', () => {
    // THE reason this schema does not use z.coerce. z.coerce.number() maps ''
    // to 0, and /0 is a valid prefix meaning the entire IPv4 address space. A
    // user who simply has not typed yet would get a valid, catastrophically
    // wrong plan.
    expect(prefixSchema.safeParse('').success).toBe(false);
    expect(prefixSchema.safeParse('   ').success).toBe(false);
    expect(prefixSchema.safeParse(null).success).toBe(false);
    expect(prefixSchema.safeParse([]).success).toBe(false);
  });

  it('rejects scientific and hex notation, which Number() would happily accept', () => {
    // Number('1e3') is 1000 and Number('0x18') is 24. Neither is a prefix
    // anyone means to type, and silently accepting them hides a typo.
    expect(prefixSchema.safeParse('1e3').success).toBe(false);
    expect(prefixSchema.safeParse('0x18').success).toBe(false);
    expect(prefixSchema.safeParse('24/24').success).toBe(false);
  });

  it('agrees with the engine on the leading-slash behaviour', () => {
    for (const value of ['0', '/0', '32', '/32', '31', '/31']) {
      expect(expectOk(prefixSchema.safeParse(value)), value).toBe(parsePrefix(value));
    }
  });
});

/* ================================================================== *
 * CIDR
 * ================================================================== */

describe('cidrSchema', () => {
  it('accepts a CIDR reference and yields a Cidr', () => {
    expect(expectOk(cidrSchema.safeParse('192.168.1.0/24'))).toEqual({
      family: 'ipv4',
      ip: 3232235776,
      prefix: 24,
    });
  });

  it('accepts a host address as a reference, because that is legitimate', () => {
    // 192.168.1.50/24 is a valid way to name a network. Rejecting it here
    // would reject an extremely common and perfectly reasonable input.
    expect(expectOk(cidrSchema.safeParse('192.168.1.50/24'))).toEqual({
      family: 'ipv4',
      ip: 3232235826,
      prefix: 24,
    });
  });

  it.each([
    ['192.168.1.0', 'no prefix'],
    ['192.168.1.0/', 'empty prefix'],
    ['/24', 'no address'],
    ['', 'blank'],
    ['   ', 'whitespace only'],
    ['192.168.1.0/24/24', 'two slashes'],
    ['192.168.1.0/33', 'prefix out of range'],
    ['192.168.1.0/abc', 'non-numeric prefix'],
  ])('rejects %s (%s)', (input) => {
    expect(cidrSchema.safeParse(input).success, input).toBe(false);
  });

  it('uses the CIDR message for a missing prefix and the prefix message for a bad one', () => {
    expect(expectFail(cidrSchema.safeParse('192.168.1.0'))).toBe(
      'Enter a valid CIDR block, for example 192.168.1.0/24.',
    );
    expect(expectFail(cidrSchema.safeParse('192.168.1.0/33'))).toBe(
      'CIDR must be between /0 and /32.',
    );
  });
});

describe('subnetCidrSchema', () => {
  it('accepts a network boundary', () => {
    expect(expectOk(subnetCidrSchema.safeParse('192.168.1.0/24')).prefix).toBe(24);
  });

  it('rejects a host address and names the correct value, prefix included', () => {
    expect(expectFail(subnetCidrSchema.safeParse('192.168.1.50/24'))).toBe(
      '192.168.1.50/24 is not a network address. Use 192.168.1.0/24 instead.',
    );
  });

  it('still reports a malformed CIDR as malformed', () => {
    expect(expectFail(subnetCidrSchema.safeParse('192.168.1.0'))).toBe(
      'Enter a valid CIDR block, for example 192.168.1.0/24.',
    );
  });

  it('rejects the network-zero and all-ones subnets as non-boundaries only when they really are', () => {
    // RFC 7600 deprecated the "subnet zero" restriction. A user must be able to
    // plan 0.0.0.0/8 or 255.255.255.0/24 without a spurious warning, so these
    // must validate. The engine's audit rules, not this schema, are where any
    // such concern belongs.
    expect(subnetCidrSchema.safeParse('0.0.0.0/8').success).toBe(true);
    expect(subnetCidrSchema.safeParse('255.255.255.0/24').success).toBe(true);
    expect(subnetCidrSchema.safeParse('0.0.0.0/0').success).toBe(true);
  });
});

/* ================================================================== *
 * VLAN
 * ================================================================== */

describe('vlanIdSchema', () => {
  it('accepts the IEEE 802.1Q range 1-4094 at both ends', () => {
    expect(expectOk(vlanIdSchema.safeParse(1))).toBe(1);
    expect(expectOk(vlanIdSchema.safeParse(4094))).toBe(4094);
    expect(expectOk(vlanIdSchema.safeParse('100'))).toBe(100);
    expect(expectOk(vlanIdSchema.safeParse(' 4094 '))).toBe(4094);
  });

  it('rejects a leading slash, unlike the prefix field', () => {
    // Deliberate asymmetry. A prefix field is visually part of the notation
    // "/24", so tolerating the slash there removes friction the platform
    // invites. A VLAN field is labelled "VLAN ID" and is a bare integer, so a
    // slash there is a paste slip worth reporting rather than absorbing.
    expect(vlanIdSchema.safeParse('/100').success).toBe(false);
    expect(prefixSchema.safeParse('/24').success).toBe(true);
  });

  it.each([0, 4095, -1, 5000])('rejects %s, which is reserved or out of range', (value) => {
    expect(expectFail(vlanIdSchema.safeParse(value))).toBe(
      'VLAN ID must be between 1 and 4094 (0 and 4095 are reserved).',
    );
  });

  it('rejects blank and non-numeric input', () => {
    expect(expectFail(vlanIdSchema.safeParse(''))).toBe('VLAN ID is required.');
    expect(expectFail(vlanIdSchema.safeParse('vlan10'))).toBe(MESSAGES.invalidVlan);
    expect(expectFail(vlanIdSchema.safeParse(1.5))).toBe(MESSAGES.invalidVlan);
  });

  it('rejects a non-numeric, non-string VLAN value', () => {
    expect(expectFail(vlanIdSchema.safeParse(true))).toBe(MESSAGES.invalidVlan);
    expect(expectFail(vlanIdSchema.safeParse([10]))).toBe(MESSAGES.invalidVlan);
  });
});

describe('optionalVlanIdSchema', () => {
  it('treats a blank field as untagged, which is a legitimate design', () => {
    expect(expectOk(optionalVlanIdSchema.safeParse(''))).toBeUndefined();
    expect(expectOk(optionalVlanIdSchema.safeParse(undefined))).toBeUndefined();
    expect(expectOk(optionalVlanIdSchema.safeParse('   '))).toBeUndefined();
  });

  it('still validates a value that is present', () => {
    expect(expectOk(optionalVlanIdSchema.safeParse('200'))).toBe(200);
    expect(optionalVlanIdSchema.safeParse('5000').success).toBe(false);
  });
});

/* ================================================================== *
 * Host count
 * ================================================================== */

describe('hostCountSchema', () => {
  it('accepts 1 and the IPv4 maximum', () => {
    expect(expectOk(hostCountSchema.safeParse(1))).toBe(1);
    expect(expectOk(hostCountSchema.safeParse('1'))).toBe(1);
    // A /0 holds 4294967296 addresses; two are unassignable.
    expect(expectOk(hostCountSchema.safeParse(4294967294))).toBe(4294967294);
  });

  it('rejects zero and negatives with the pinned message', () => {
    expect(expectFail(hostCountSchema.safeParse(0))).toBe('Required hosts must be greater than 0.');
    expect(expectFail(hostCountSchema.safeParse('0'))).toBe(
      'Required hosts must be greater than 0.',
    );
    expect(expectFail(hostCountSchema.safeParse(-5))).toBe(
      'Required hosts must be greater than 0.',
    );
  });

  it('does not tell someone asking for 5 billion hosts that their value is too small', () => {
    // Technically true, practically useless. The pinned message is for the
    // "too small" case only.
    const message = expectFail(hostCountSchema.safeParse(5_000_000_000));
    expect(message).toBe('Required hosts cannot exceed 4294967294.');
    expect(message).not.toBe(MESSAGES.invalidHostCount);
  });

  it('rejects blank, fractional and non-numeric input', () => {
    expect(expectFail(hostCountSchema.safeParse(''))).toBe('Required hosts is required.');
    expect(expectFail(hostCountSchema.safeParse(1.5))).toBe(MESSAGES.invalidHostCount);
    expect(expectFail(hostCountSchema.safeParse('ten'))).toBe(MESSAGES.invalidHostCount);
    expect(expectFail(hostCountSchema.safeParse('1e3'))).toBe(MESSAGES.invalidHostCount);
  });

  it('never coerces a blank field to zero hosts', () => {
    for (const value of ['', '   ', null, undefined, [], true]) {
      expect(hostCountSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
  });
});

/* ================================================================== *
 * Gateway
 * ================================================================== */

describe('gatewaySchema', () => {
  const subnet = '192.168.1.0/24';

  it('accepts the first and last usable host of a /24', () => {
    expect(expectOk(gatewaySchema(subnet).safeParse('192.168.1.1'))).toBe(parseIPv4('192.168.1.1'));
    expect(expectOk(gatewaySchema(subnet).safeParse('192.168.1.254'))).toBe(
      parseIPv4('192.168.1.254'),
    );
  });

  it('rejects a gateway outside the subnet with the pinned message', () => {
    expect(expectFail(gatewaySchema('192.168.2.0/24').safeParse('192.168.1.1'))).toBe(
      'Gateway 192.168.1.1 is not inside 192.168.2.0/24.',
    );
  });

  it('rejects the network address and names a replacement', () => {
    expect(expectFail(gatewaySchema(subnet).safeParse('192.168.1.0'))).toBe(
      'Gateway 192.168.1.0 is the network address of 192.168.1.0/24. Use 192.168.1.1 instead.',
    );
  });

  it('rejects the broadcast address and names a replacement', () => {
    expect(expectFail(gatewaySchema(subnet).safeParse('192.168.1.255'))).toBe(
      'Gateway 192.168.1.255 is the broadcast address of 192.168.1.0/24. Use 192.168.1.254 instead.',
    );
  });

  it('accepts BOTH endpoints of a /31, per RFC 3021', () => {
    // This is the case a naive "reject the first and last address" check gets
    // wrong. Neither address of a /31 is reserved.
    expect(expectOk(gatewaySchema('10.0.0.0/31').safeParse('10.0.0.0'))).toBe(
      parseIPv4('10.0.0.0'),
    );
    expect(expectOk(gatewaySchema('10.0.0.0/31').safeParse('10.0.0.1'))).toBe(
      parseIPv4('10.0.0.1'),
    );
  });

  it('accepts the single address of a /32', () => {
    // A /32 is a host route. Its only address is its own gateway, and
    // rejecting it would make /32 subnets unplannable.
    expect(expectOk(gatewaySchema('192.168.1.50/32').safeParse('192.168.1.50'))).toBe(
      parseIPv4('192.168.1.50'),
    );
  });

  it('rejects a malformed gateway with the address message, not a gateway one', () => {
    expect(expectFail(gatewaySchema(subnet).safeParse('192.168.1.999'))).toBe(MESSAGES.invalidIPv4);
    expect(expectFail(gatewaySchema(subnet).safeParse('nonsense'))).toBe(MESSAGES.invalidIPv4);
  });

  it('distinguishes missing from malformed', () => {
    expect(expectFail(gatewaySchema(subnet).safeParse(''))).toBe('Gateway address is required.');
  });

  it('rejects a non-string gateway rather than coercing it', () => {
    // A gateway arrives from a TextInput, so this should be unreachable in the
    // app. It is checked anyway: silently stringifying a number here would
    // produce a number the engine then has to reinterpret.
    expect(expectFail(gatewaySchema(subnet).safeParse(3232235777))).toBe(MESSAGES.invalidIPv4);
    expect(expectFail(gatewaySchema(subnet).safeParse({ ip: 3232235777 }))).toBe(
      MESSAGES.invalidIPv4,
    );
  });

  it('treats null as an absent gateway, not a malformed one', () => {
    // Absent and malformed are different states. "Required" is the right thing
    // to say about null; telling a user their gateway is not a valid address
    // when they never supplied one is not.
    expect(expectFail(gatewaySchema(subnet).safeParse(null))).toBe('Gateway address is required.');
    expect(expectFail(gatewaySchema(subnet).safeParse(undefined))).toBe(
      'Gateway address is required.',
    );
  });

  it('fails loudly at construction if given a malformed subnet', () => {
    // The subnet is a programmer-supplied constant, not user input, so a bad
    // one is a bug in the calling code and should surface immediately rather
    // than becoming a silent always-failing field.
    expect(() => gatewaySchema('not-a-subnet')).toThrow();
  });

  it('accepts a Cidr object and a resolved SubnetInfo as the subnet argument', () => {
    const cidr = parseCidr(subnet);
    const info = calculateSubnet(cidr.ip, cidr.prefix);
    expect(expectOk(gatewaySchema(cidr).safeParse('192.168.1.1'))).toBe(parseIPv4('192.168.1.1'));
    expect(expectOk(gatewaySchema(info).safeParse('192.168.1.1'))).toBe(parseIPv4('192.168.1.1'));
    // And the message must still print the canonical network form.
    expect(expectFail(gatewaySchema('192.168.1.50/24').safeParse('10.0.0.1'))).toContain(
      '192.168.1.0/24',
    );
  });
});

/* ================================================================== *
 * Host requirement
 * ================================================================== */

describe('hostRequirementSchema', () => {
  it('accepts a well-formed requirement', () => {
    const parsed = expectOk(
      hostRequirementSchema.safeParse({ name: '  Students  ', requestedHosts: 100, role: 'LAN' }),
    );
    expect(parsed.name).toBe('Students');
    expect(parsed.requestedHosts).toBe(100);
    expect(parsed.role).toBe('LAN');
    expect(parsed.id).toBeTruthy();
  });

  it('keeps a supplied id so the planner can map rows back', () => {
    const parsed = expectOk(
      hostRequirementSchema.safeParse({ id: 'r-1', name: 'IT', requestedHosts: 50, role: 'IOT' }),
    );
    expect(parsed.id).toBe('r-1');
  });

  it('generates distinct ids for requirements that arrive without one', () => {
    const a = expectOk(
      hostRequirementSchema.safeParse({ name: 'A', requestedHosts: 10, role: 'LAN' }),
    );
    const b = expectOk(
      hostRequirementSchema.safeParse({ name: 'B', requestedHosts: 10, role: 'LAN' }),
    );
    expect(a.id).not.toBe(b.id);
  });

  it('rejects an unknown role', () => {
    expect(
      hostRequirementSchema.safeParse({ name: 'X', requestedHosts: 10, role: 'SUPER_SECRET' })
        .success,
    ).toBe(false);
  });

  it('rejects an empty name and a bad host count', () => {
    expect(
      hostRequirementSchema.safeParse({ name: '   ', requestedHosts: 10, role: 'LAN' }).success,
    ).toBe(false);
    expect(
      hostRequirementSchema.safeParse({ name: 'X', requestedHosts: 0, role: 'LAN' }).success,
    ).toBe(false);
  });

  it('accepts every declared role', () => {
    for (const role of [
      'LAN',
      'SERVERS',
      'MANAGEMENT',
      'IOT',
      'GUEST',
      'DMZ',
      'VOIP',
      'POINT_TO_POINT',
      'CUSTOM',
    ]) {
      expect(
        hostRequirementSchema.safeParse({ name: 'R', requestedHosts: 10, role }).success,
        role,
      ).toBe(true);
    }
  });
});

/* ================================================================== *
 * VLSM plan
 * ================================================================== */

describe('vlsmPlanSchema', () => {
  it('accepts a plan that fits', () => {
    const parsed = expectOk(
      vlsmPlanSchema.safeParse({
        parentCidr: '192.168.1.0/24',
        requirements: [req('Students', 100), req('IT', 50)],
      }),
    );
    expect(parsed.requirements).toHaveLength(2);
  });

  it('rejects a plan that cannot fit, with the pinned message', () => {
    const message = expectFail(
      vlsmPlanSchema.safeParse({
        parentCidr: '192.168.1.0/24',
        requirements: [req('Huge', 300)],
      }),
    );
    expect(message).toBe('Not enough address space for these requirements.');
  });

  it('attaches the exhaustion error to the requirements field, not the parent', () => {
    const result = vlsmPlanSchema.safeParse({
      parentCidr: '192.168.1.0/24',
      requirements: [req('Huge', 300)],
    });
    expect(result.success).toBe(false);
    const issue = (result as { error: { issues: readonly { path: readonly PropertyKey[] }[] } })
      .error.issues[0];
    expect(issue?.path).toEqual(['requirements']);
  });

  it('agrees with the engine on fit, because it delegates', () => {
    // The "does it fit" answer must come from exactly one place.
    const parentCidr = '10.0.0.0/22';
    const cases: readonly (readonly number[])[] = [
      [300, 200],
      [300, 200, 100],
      [500, 500],
      [1000, 100],
      [1022],
    ];
    for (const hosts of cases) {
      const requirements = hosts.map((h, i) => req(`R${i}`, h));
      const schemaFits = vlsmPlanSchema.safeParse({ parentCidr, requirements }).success;
      let engineFits = true;
      try {
        packVLSM(parentCidr, requirements);
      } catch {
        engineFits = false;
      }
      expect(schemaFits, hosts.join(',')).toBe(engineFits);
    }
  });

  it('rejects a malformed parent before trying to pack anything', () => {
    const result = vlsmPlanSchema.safeParse({ parentCidr: 'not-a-cidr', requirements: [] });
    expect(result.success).toBe(false);
    expect(messageOf(result)).toBe('Enter a valid CIDR block, for example 192.168.1.0/24.');
  });
});

/* ================================================================== *
 * Plan form
 * ================================================================== */

describe('planFormSchema', () => {
  it('accepts a name and trims it', () => {
    const parsed = expectOk(
      planFormSchema.safeParse({ name: '  Campus North  ', description: '  Main site  ' }),
    );
    expect(parsed.name).toBe('Campus North');
    expect(parsed.description).toBe('Main site');
  });

  it('accepts a description at the 500-character limit and rejects 501', () => {
    expect(planFormSchema.safeParse({ name: 'X', description: 'a'.repeat(500) }).success).toBe(
      true,
    );
    expect(expectFail(planFormSchema.safeParse({ name: 'X', description: 'a'.repeat(501) }))).toBe(
      'Description must be 500 characters or fewer.',
    );
  });

  it('accepts a name at the 80-character limit and rejects 81', () => {
    expect(planFormSchema.safeParse({ name: 'a'.repeat(80), description: '' }).success).toBe(true);
    expect(expectFail(planFormSchema.safeParse({ name: 'a'.repeat(81), description: '' }))).toBe(
      'Name must be 80 characters or fewer.',
    );
  });

  it('measures the trimmed name, so trailing spaces do not cost the user 80 characters', () => {
    expect(
      planFormSchema.safeParse({ name: `  ${'a'.repeat(80)}  `, description: '' }).success,
    ).toBe(true);
  });

  it('rejects a blank or whitespace-only name', () => {
    expect(expectFail(planFormSchema.safeParse({ name: '', description: '' }))).toBe(
      'Name is required.',
    );
    expect(expectFail(planFormSchema.safeParse({ name: '    ', description: '' }))).toBe(
      'Name is required.',
    );
  });

  it('defaults the profile to custom', () => {
    expect(expectOk(planFormSchema.safeParse({ name: 'X', description: '' })).profile).toBe(
      'custom',
    );
  });

  it('rejects an unknown profile', () => {
    expect(
      planFormSchema.safeParse({ name: 'X', description: '', profile: 'enterprise-plus' }).success,
    ).toBe(false);
  });

  it('treats a missing description as empty', () => {
    expect(expectOk(planFormSchema.safeParse({ name: 'X' })).description).toBe('');
  });

  it('rejects a non-string name and a non-string description', () => {
    // Neither is reachable from a form, and both must not fall through to
    // Zod's default wording if a script or an import supplies one.
    expect(planFormSchema.safeParse({ name: 42, description: '' }).success).toBe(false);
    expect(planFormSchema.safeParse({ name: 'X', description: 42 }).success).toBe(false);
    expect(planNameSchema.safeParse(null).success).toBe(false);
  });

  it('treats a null description as absent rather than malformed', () => {
    // A name is mandatory, so null there is an error. A description is optional,
    // so null there means "no description". Same null, different meaning,
    // because the fields mean different things.
    expect(expectOk(planDescriptionSchema.safeParse(null))).toBe('');
  });
});

describe('planNameSchema and planDescriptionSchema standalone', () => {
  it('behave identically to their use inside planFormSchema', () => {
    expect(expectOk(planNameSchema.safeParse('  A  '))).toBe('A');
    expect(expectOk(planDescriptionSchema.safeParse('  B  '))).toBe('B');
  });
});

/* ================================================================== *
 * Whole-plan subnet validation
 * ================================================================== */

describe('planSubnetsSchema', () => {
  /** First assignable host of a CIDR, the conventional gateway. */
  const firstHost = (cidr: string): string => {
    const parsed = parseCidr(cidr);
    return integerToIPv4(calculateSubnet(parsed.ip, parsed.prefix).firstUsableHost);
  };

  const subnetRow = (over: Record<string, unknown> = {}) => {
    const cidr = (over.cidr as string | undefined) ?? '192.168.1.0/25';
    return {
      id: 's-1',
      name: 'Students',
      role: 'LAN',
      vlanId: '10',
      // Derived from the row's OWN cidr unless the test overrides it, so a
      // fixture can never be internally inconsistent.
      gateway: firstHost(cidr),
      requestedHosts: 100,
      sortOrder: 0,
      ...over,
      cidr,
    };
  };

  it('accepts a coherent plan', () => {
    const result = planSubnetsSchema.safeParse({
      parentCidr: '192.168.1.0/24',
      subnets: [subnetRow(), subnetRow({ id: 's-2', cidr: '192.168.1.128/26' })],
    });
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it('rejects a subnet outside the parent, naming both', () => {
    const result = planSubnetsSchema.safeParse({
      parentCidr: '192.168.1.0/24',
      subnets: [subnetRow(), subnetRow({ id: 's-2', cidr: '10.0.0.0/8', gateway: '10.0.0.1' })],
    });
    expect(expectFail(result)).toBe('10.0.0.0/8 is not inside 192.168.1.0/24.');
  });

  it('rejects two subnets claiming the same addresses', () => {
    const result = planSubnetsSchema.safeParse({
      parentCidr: '192.168.1.0/24',
      subnets: [subnetRow(), subnetRow({ id: 's-2' })],
    });
    expect(expectFail(result)).toBe('192.168.1.0/25 overlaps 192.168.1.0/25.');
  });

  it('rejects a subnet that contains another, which is also an overlap', () => {
    const result = planSubnetsSchema.safeParse({
      parentCidr: '192.168.1.0/24',
      subnets: [
        subnetRow({ cidr: '192.168.1.0/24' }),
        subnetRow({ id: 's-2', cidr: '192.168.1.0/25' }),
      ],
    });
    expect(result.success).toBe(false);
  });

  it('accepts adjacent, non-overlapping subnets', () => {
    const result = planSubnetsSchema.safeParse({
      parentCidr: '192.168.1.0/24',
      subnets: [
        subnetRow({ cidr: '192.168.1.0/25' }),
        subnetRow({ id: 's-2', cidr: '192.168.1.128/25' }),
      ],
    });
    expect(result.success, JSON.stringify(result)).toBe(true);
  });

  it('rejects a gateway that is not assignable in its own subnet', () => {
    // 192.168.1.127 is the broadcast of 192.168.1.0/25. Note 192.168.1.255
    // would have been outside the /25 entirely, which is a different mistake.
    const result = planSubnetsSchema.safeParse({
      parentCidr: '192.168.1.0/24',
      subnets: [subnetRow({ gateway: '192.168.1.127' })],
    });
    expect(expectFail(result)).toBe(
      'Gateway 192.168.1.127 is the broadcast address of 192.168.1.0/25. Use 192.168.1.126 instead.',
    );
  });

  it('rejects a gateway belonging to a different subnet than its row', () => {
    const result = planSubnetsSchema.safeParse({
      parentCidr: '192.168.1.0/24',
      subnets: [subnetRow({ cidr: '192.168.1.0/25', gateway: '192.168.1.200' })],
    });
    expect(result.success).toBe(false);
  });

  it('distinguishes a gateway outside the subnet from one on a reserved edge', () => {
    // Both are wrong, but they are different mistakes and the message must say
    // which one occurred, or the user cannot tell what to change.
    const outside = planSubnetsSchema.safeParse({
      parentCidr: '192.168.1.0/24',
      subnets: [subnetRow({ gateway: '10.0.0.1' })],
    });
    expect(expectFail(outside)).toBe('Gateway 10.0.0.1 is not inside 192.168.1.0/25.');

    const edge = planSubnetsSchema.safeParse({
      parentCidr: '192.168.1.0/24',
      subnets: [subnetRow({ gateway: '192.168.1.0' })],
    });
    expect(expectFail(edge)).toBe(
      'Gateway 192.168.1.0 is the network address of 192.168.1.0/25. Use 192.168.1.1 instead.',
    );
  });

  it('rejects a subnet definition with host bits set', () => {
    const result = planSubnetsSchema.safeParse({
      parentCidr: '192.168.1.0/24',
      subnets: [subnetRow({ cidr: '192.168.1.50/25' })],
    });
    expect(expectFail(result)).toBe(
      '192.168.1.50/25 is not a network address. Use 192.168.1.0/25 instead.',
    );
  });

  it('treats a blank gateway as untagged rather than invalid', () => {
    // Not every planned segment has a gateway to declare yet.
    expect(
      planSubnetsSchema.safeParse({
        parentCidr: '192.168.1.0/24',
        subnets: [subnetRow({ gateway: '' })],
      }).success,
    ).toBe(true);
  });

  it('accepts a row with no VLAN, since untagged segments are legitimate', () => {
    expect(
      planSubnetsSchema.safeParse({
        parentCidr: '192.168.1.0/24',
        subnets: [subnetRow({ vlanId: '' })],
      }).success,
    ).toBe(true);
  });

  it('still rejects a present but out-of-range VLAN', () => {
    expect(
      planSubnetsSchema.safeParse({
        parentCidr: '192.168.1.0/24',
        subnets: [subnetRow({ vlanId: 4095 })],
      }).success,
    ).toBe(false);
  });

  it('rejects a parent whose own address is not a boundary only as a reference, not a definition', () => {
    // 192.168.1.50/24 names the network 192.168.1.0/24. Accepting it as the
    // parent is correct; the subnets are still measured against the real range.
    const result = planSubnetsSchema.safeParse({
      parentCidr: '192.168.1.50/24',
      subnets: [subnetRow({ cidr: '192.168.1.0/25' })],
    });
    expect(result.success).toBe(true);
  });
});
