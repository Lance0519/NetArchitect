/**
 * Calculator input rules.
 *
 * The Phase 6 exit criterion is "all 33 prefixes produce correct output, and no
 * layout overflows a 320 pt screen". The second half needs a device; the first is
 * testable here, and this file is what makes it checkable without a render mock.
 */

import { describe, expect, it } from 'vitest';

import {
  CALCULATOR_MESSAGES,
  CALCULATOR_PLACEHOLDER,
  CALCULATOR_PLACEHOLDER_ADDRESS,
  CALCULATOR_PLACEHOLDER_PREFIX,
  composeSplit,
  decomposeCombined,
  evaluateCombined,
  evaluateSplit,
} from '@/core/calculator-input';
import { isNetArchitectError } from '@/core/errors';
import { classifyAddressSpace, integerToIPv4, parseIPv4, parsePrefix } from '@/core/ip-engine';

import type { CalculatorOutcome, CalculatorField } from '@/core/calculator-input';

/* ------------------------------------------------------------------ *
 * Helpers
 *
 * A reference helper that throws on an out-of-range index, never `?? 0`. A silent
 * zero here would make an assertion compare two wrong values and pass, which is
 * worse than no assertion at all.
 * ------------------------------------------------------------------ */

/** Assert failure and return the message, so a test can assert on both halves. */
const expectFailure = (outcome: CalculatorOutcome, field?: CalculatorField): string => {
  if (outcome.ok) {
    throw new Error(
      `expected a failure, got a success for ${outcome.subnet.cidr.ip}/${outcome.subnet.cidr.prefix}`,
    );
  }
  if (field !== undefined) {
    expect(outcome.field).toBe(field);
  }
  return outcome.message;
};

const expectSuccess = (outcome: CalculatorOutcome) => {
  if (!outcome.ok) throw new Error(`expected a success, got failure: ${outcome.message}`);
  return outcome;
};

const evaluated = (raw: string) => expectSuccess(evaluateCombined(raw)).subnet;

/**
 * The message the engine produces for the same input.
 *
 * Asserting against this rather than a string typed in here makes the test a
 * property - "the calculator surfaces the engine's message, verbatim" - instead of a
 * snapshot. A snapshot would drift: the engine's copy can legitimately change, and
 * then this test fails with nothing being wrong. Or worse, it gets updated to the new
 * text and quietly stops noticing that the calculator started inventing its own.
 */
const engineMessageFor = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (isNetArchitectError(error)) return error.friendlyMessage;
    throw error;
  }
  throw new Error('expected the engine to reject this input');
};

/* ------------------------------------------------------------------ *
 * Fixtures
 *
 * Pinned from RFC/IEEE arithmetic, not from a previous run of this code. If the
 * engine regresses, these are what notice.
 * ------------------------------------------------------------------ */

const HOST_IN_24 = parseIPv4('192.168.1.50');
const NETWORK_IN_24 = parseIPv4('192.168.1.0');

describe('the fixtures are the values they claim to be', () => {
  // A test built on a wrong fixture asserts nothing. 192.168.1.50 is 3232235826.
  it.each([
    ['192.168.1.50', HOST_IN_24, 3_232_235_826],
    ['192.168.1.0', NETWORK_IN_24, 3_232_235_776],
  ])('pins %s', (ip, parsed, expected) => {
    expect(parseIPv4(ip)).toBe(expected);
    expect(parsed).toBe(expected);
  });
});

describe('CALCULATOR_MESSAGES', () => {
  it('has no duplicate copy, so one edit cannot silently change two screens', () => {
    const values = Object.values(CALCULATOR_MESSAGES);
    expect(new Set(values).size).toBe(values.length);
  });

  it('never ends mid-sentence, since every one of these is shown to a user', () => {
    for (const [key, value] of Object.entries(CALCULATOR_MESSAGES)) {
      expect(value.endsWith('.'), `${key} should end with a period`).toBe(true);
      expect(value.trim(), `${key} should not be empty or padded`).toBe(value);
    }
  });

  it('keeps the placeholders in agreement, so both input modes show the same example', () => {
    expect(CALCULATOR_PLACEHOLDER).toBe(
      `${CALCULATOR_PLACEHOLDER_ADDRESS}/${CALCULATOR_PLACEHOLDER_PREFIX}`,
    );
  });
});

/* ------------------------------------------------------------------ *
 * Accepted input
 * ------------------------------------------------------------------ */

describe('evaluateCombined - accepted forms', () => {
  it('accepts the canonical a.b.c.d/p', () => {
    const subnet = evaluated('192.168.1.50/24');
    expect(subnet.networkAddress).toBe(NETWORK_IN_24);
  });

  it('accepts a space as the separator, because a paste from a document looks like this', () => {
    const subnet = evaluated('192.168.1.50 24');
    expect(subnet.networkAddress).toBe(NETWORK_IN_24);
  });

  it('accepts a leading slash on the prefix, which the user confirmed we should', () => {
    const subnet = evaluated('192.168.1.50/24');
    expect(subnet.cidr.prefix).toBe(24);
  });

  it('accepts /p after a space separator', () => {
    const subnet = evaluated('192.168.1.50 /24');
    expect(subnet.cidr.prefix).toBe(24);
  });

  it('accepts a space before a bare prefix', () => {
    const subnet = evaluated('192.168.1.50 24');
    expect(subnet.cidr.prefix).toBe(24);
  });

  it('tolerates surrounding whitespace, which a paste or a keyboard brings along', () => {
    expect(evaluated('   192.168.1.50/24   ').networkAddress).toBe(NETWORK_IN_24);
  });

  it('treats a run of separators as one, so a stray slash cannot change the answer', () => {
    for (const raw of [
      '192.168.1.50//24',
      '192.168.1.50  24',
      '192.168.1.50/ 24',
      '192.168.1.50 /  24',
      ' 192.168.1.50\t/24',
    ]) {
      const subnet = evaluated(raw);
      expect(subnet.cidr.prefix, `${raw} should parse as /24`).toBe(24);
      expect(subnet.networkAddress, `${raw} should resolve to 192.168.1.0`).toBe(NETWORK_IN_24);
    }
  });

  /**
   * Negative control for the separator set.
   *
   * `split(/[/\\s]+/)` - the form a string-escaping instinct produces - is a class of
   * slash, BACKSLASH and the letter `s`. It was written that way, and every test above
   * that used a space separator failed while the slash ones passed, which is the worst
   * kind of bug: the majority of the suite stayed green.
   *
   * Asserting only that a space works would not catch it, because that is the case the
   * broken version fails. What pins the behaviour is asserting that the two
   * unintended characters are NOT separators, so the class can never quietly widen
   * again. A backslash in an address field is nonsense, and the letter `s` appears in
   * no valid entry, so both must leave the input unsplit.
   */
  it.each(['192.168.1.50\\24', '192.168.1.50s24'])(
    'does not treat %s as a separator',
    (raw) => {
      // Unsplit, so there is no prefix slot to fill and the answer is a missing prefix.
      expect(expectFailure(evaluateCombined(raw), 'input'), raw).toBe(
        CALCULATOR_MESSAGES.missingPrefix,
      );
    },
  );

  it('reports whether the typed address was a boundary or a host inside the network', () => {
    // The distinction matters to the user: typing 192.168.1.50/24 and being shown
    // 192.168.1.0/24 is correct, but only if the screen says why.
    expect(expectSuccess(evaluateCombined('192.168.1.0/24')).inputWasNetworkBoundary).toBe(true);
    expect(expectSuccess(evaluateCombined('192.168.1.50/24')).inputWasNetworkBoundary).toBe(false);
  });

  it('echoes the input back, so the copy text can show what was typed', () => {
    expect(expectSuccess(evaluateCombined('  192.168.1.50/24  ')).inputText).toBe(
      '192.168.1.50/24',
    );
  });

  it('accepts a bare address that is itself a valid prefix, without confusing the two', () => {
    // 0.0.0.0 is both a legal address and the /0 prefix as text. It is an address
    // here, because an address came first and the prefix slot was never filled.
    const subnet = evaluated('0.0.0.0/0');
    expect(subnet.totalAddresses).toBe(4_294_967_296);
  });
});

/* ------------------------------------------------------------------ *
 * Rejected input
 *
 * The confirmed rules: forgiving about a leading slash on a prefix, strict about a
 * doubled one, and never a guess.
 * ------------------------------------------------------------------ */

describe('evaluateCombined - rejected forms', () => {
  it('reports the empty field with an example, not a complaint', () => {
    expect(expectFailure(evaluateCombined(''), 'input')).toBe(CALCULATOR_MESSAGES.empty);
    expect(expectFailure(evaluateCombined('   '), 'input')).toBe(CALCULATOR_MESSAGES.empty);
  });

  it('names the fix for a bare address, which is the most common first mistake', () => {
    expect(expectFailure(evaluateCombined('192.168.1.50'), 'input')).toBe(
      CALCULATOR_MESSAGES.missingPrefix,
    );
  });

  it('names the fix for a bare prefix, and does not tell the user to add what they typed', () => {
    // The distinction from missingPrefix is the point. "Add a prefix length" in
    // reply to a user who typed 24 reads as the app not understanding them.
    expect(expectFailure(evaluateCombined('24'), 'input')).toBe(
      CALCULATOR_MESSAGES.prefixOnly,
    );
    expect(expectFailure(evaluateCombined('/24'), 'input')).toBe(
      CALCULATOR_MESSAGES.prefixOnly,
    );
  });

  it('rejects 24/24 as ambiguous rather than guessing which prefix was meant', () => {
    expect(expectFailure(evaluateCombined('24/24'), 'input')).toBe(
      CALCULATOR_MESSAGES.noAddress,
    );
  });

  it('recognises the ambiguous shape by form, not by value, so 0/0 is caught too', () => {
    // Special-casing the literal string "24/24" would have passed a test on 24/24 and
    // quietly accepted 0/0, which is the same mistake wearing a different number.
    for (const raw of ['0/0', '32/32', '8/24', '24/8']) {
      expect(expectFailure(evaluateCombined(raw), 'input'), raw).toBe(
        CALCULATOR_MESSAGES.noAddress,
      );
    }
  });

  it('rejects a trailing separator as a missing prefix, since the slot is empty', () => {
    expect(expectFailure(evaluateCombined('192.168.1.50/'), 'input')).toBe(
      CALCULATOR_MESSAGES.missingPrefix,
    );
  });

  it('rejects more than two parts, and never truncates to the first two', () => {
    // Truncating would report success on 1.2.3.4/24/24 and answer a question the
    // user did not ask.
    expect(expectFailure(evaluateCombined('1.2.3.4/24/24'), 'input')).toBe(
      CALCULATOR_MESSAGES.tooManyParts,
    );
    expect(expectFailure(evaluateCombined('1.2.3.4 24 24'), 'input')).toBe(
      CALCULATOR_MESSAGES.tooManyParts,
    );
  });

  it('lets the engine describe a malformed address, rather than inventing a message', () => {
    // The engine owns what a valid address is. Reimplementing that check here would
    // create a second set of answers, and the two would disagree at the edges. This
    // asserts the calculator adds nothing, which is the property worth pinning.
    for (const address of ['192.168.1.500', 'foo', '192.168.1', '1.2.3.4.5', '192.168.1.01x']) {
      const message = expectFailure(evaluateCombined(`${address}/24`), 'address');
      expect(message, address).toBe(engineMessageFor(() => parseIPv4(address)));
    }
  });

  it('attributes a malformed address to the address, not to the whole field', () => {
    // A single combined box means the screen marks one field, but the message still
    // has to say which half is wrong, or the user retypes the prefix that was fine.
    expect(expectFailure(evaluateCombined('999.1.1.1/24'), 'address')).toBe(
      engineMessageFor(() => parseIPv4('999.1.1.1')),
    );
  });

  it('lets the engine describe an out-of-range prefix', () => {
    for (const prefix of ['33', '-1', '99', '2.4', 'twenty-four']) {
      const message = expectFailure(evaluateCombined(`192.168.1.50/${prefix}`), 'prefix');
      expect(message, prefix).toBe(engineMessageFor(() => parsePrefix(prefix)));
    }
  });

  it('reports a trailing separator as a missing prefix, not as an invalid one', () => {
    // The splitter collapses `192.168.1.50/` to a single part, so the prefix slot is
    // empty rather than invalid. "Add a prefix length" is the honest description;
    // "must be between /0 and /32" would describe a value the user never typed.
    expect(expectFailure(evaluateCombined('192.168.1.50/'), 'input')).toBe(
      CALCULATOR_MESSAGES.missingPrefix,
    );
  });

  it('attributes an out-of-range prefix to the prefix', () => {
    expect(expectFailure(evaluateCombined('192.168.1.50/33'), 'prefix')).toBe(
      engineMessageFor(() => parsePrefix('33')),
    );
  });
});

/* ------------------------------------------------------------------ *
 * Split fields
 * ------------------------------------------------------------------ */

describe('evaluateSplit', () => {
  it('resolves a valid pair', () => {
    const subnet = expectSuccess(evaluateSplit('192.168.1.50', '24')).subnet;
    expect(subnet.networkAddress).toBe(NETWORK_IN_24);
  });

  it('accepts a leading slash on the prefix, matching the combined field', () => {
    // A user who learned the forgiving behaviour in one mode should not be punished
    // for it in the other. The two modes are the same calculator.
    const subnet = expectSuccess(evaluateSplit('192.168.1.50', '/24')).subnet;
    expect(subnet.cidr.prefix).toBe(24);
  });

  it('rejects a doubled prefix in the prefix field, deferring to the engine', () => {
    // "Not more forgiving" is the claim: the prefix field does not become a second
    // combined field just because the layout is wider.
    expect(expectFailure(evaluateSplit('192.168.1.50', '24/24'), 'prefix')).toBe(
      engineMessageFor(() => parsePrefix('24/24')),
    );
  });

  it('blanks in the address field and in the prefix field are distinguishable', () => {
    // Both are "required", but they are different fields and the screen marks them
    // separately, so they cannot share one message.
    expect(expectFailure(evaluateSplit('', '24'), 'address')).toBe(
      CALCULATOR_MESSAGES.addressRequired,
    );
    expect(expectFailure(evaluateSplit('192.168.1.50', ''), 'prefix')).toBe(
      CALCULATOR_MESSAGES.prefixRequired,
    );
  });

  it('checks the address before the prefix, so the error does not flicker mid-typing', () => {
    // With both fields blank, the address is the one the user started filling in.
    expect(expectFailure(evaluateSplit('', ''), 'address')).toBe(
      CALCULATOR_MESSAGES.addressRequired,
    );
  });

  it('tolerates whitespace in either field', () => {
    const subnet = expectSuccess(evaluateSplit('  192.168.1.50  ', '  24 ')).subnet;
    expect(subnet.cidr.prefix).toBe(24);
  });

  it('echoes the pair in canonical form, without a double slash', () => {
    expect(expectSuccess(evaluateSplit('192.168.1.50', '/24')).inputText).toBe('192.168.1.50/24');
  });

  it('echoes the pair canonically even when the fields are padded', () => {
    // The regression `barePrefix` had: stripping a leading slash before trimming left
    // the slash attached whenever the field was `'  /24 '` rather than `'/24'`, so
    // the echoed text read `192.168.1.50//24` and the layout switch produced two
    // different fields for one entry. Only the unpadded spelling had been tested.
    expect(expectSuccess(evaluateSplit('  192.168.1.50  ', '  /24  ')).inputText).toBe(
      '192.168.1.50/24',
    );
  });

  it('agrees with the combined field on the same address, for every accepted spelling', () => {
    // One engine, one set of answers. If the two modes ever disagreed, the screen
    // would show a different subnet depending on how the user happened to type.
    for (const raw of [
      '192.168.1.50/24',
      '192.168.1.50 24',
      '192.168.1.50 /24',
      '192.168.1.50 / 24',
    ]) {
      const combined = expectSuccess(evaluateCombined(raw)).subnet;
      const split = expectSuccess(evaluateSplit('192.168.1.50', '24')).subnet;
      expect(split, raw).toEqual(combined);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Converting between the two layouts
 *
 * Both functions decide what a half-filled entry becomes. That is a correctness
 * question, not a rendering one, which is why they live in the pure module where these
 * tests can reach them.
 * ------------------------------------------------------------------ */

describe('decomposeCombined', () => {
  it('splits a valid entry into its two halves', () => {
    expect(decomposeCombined('192.168.1.50/24')).toEqual({
      address: '192.168.1.50',
      prefix: '24',
    });
  });

  it('strips the leading slash, because the prefix field takes a bare number', () => {
    expect(decomposeCombined('192.168.1.50/24')?.prefix).toBe('24');
  });

  it('handles a space separator and a mixed one', () => {
    for (const raw of ['192.168.1.50 24', '192.168.1.50 /24', '192.168.1.50 / 24']) {
      expect(decomposeCombined(raw), raw).toEqual({ address: '192.168.1.50', prefix: '24' });
    }
  });

  it('echoes the typed address, not the network it resolves to', () => {
    // The engine resolves 192.168.1.50/24 to 192.168.1.0/24. Switching layouts must
    // not silently rewrite what the user typed, or the entry changes under them.
    expect(decomposeCombined('192.168.1.50/24')?.address).toBe('192.168.1.50');
  });

  it('refuses anything it cannot decompose exactly', () => {
    // Returning a partial decomposition would mean inventing a half of the entry.
    for (const raw of ['', ' ', '24', '192.168.1.50', '24/24', '1.2.3.4/24/24', 'foo/24', '1.2.3.4/33']) {
      expect(decomposeCombined(raw), raw).toBeNull();
    }
  });
});

describe('composeSplit', () => {
  it('joins a complete pair', () => {
    expect(composeSplit('192.168.1.50', '24')).toBe('192.168.1.50/24');
  });

  it('normalises a leading slash, so the two forms cannot disagree', () => {
    expect(composeSplit('192.168.1.50', '/24')).toBe('192.168.1.50/24');
  });

  it('keeps a prefix typed on its own, rather than discarding it', () => {
    // The regression this function exists to prevent: returning '' here made the field
    // go blank and the app look as though it had reset itself. `24` is reported as "a
    // prefix on its own", which names the missing half instead of hiding the entry.
    expect(composeSplit('', '24')).toBe('24');
    expect(composeSplit('   ', '  /24 ')).toBe('24');
  });

  it('keeps an address typed on its own, so its own message can be shown', () => {
    expect(composeSplit('192.168.1.50', '')).toBe('192.168.1.50');
    expect(composeSplit('192.168.1.50', '  ')).toBe('192.168.1.50');
  });

  it('is empty only when both fields are', () => {
    // `as const` so the pair is a tuple: destructured through `string[][]` instead,
    // `noUncheckedIndexedAccess` makes both halves `string | undefined` and the call
    // needs a non-null assertion that would only be there to satisfy the compiler.
    const cases = [
      ['', ''],
      ['   ', '   '],
      ['\t', '\n'],
    ] as const;
    for (const [address, prefix] of cases) {
      expect(composeSplit(address, prefix), `${address}|${prefix}`).toBe('');
    }
  });

  it('round-trips every prefix through both layouts without drift', () => {
    // The property that matters for the mode switch: decompose then compose must
    // return exactly what was typed, for all 33 prefixes and for each accepted
    // spelling. A round trip that normalised or truncated would change the entry.
    for (let prefix = 0; prefix <= 32; prefix += 1) {
      for (const raw of [
        `192.168.1.50/${prefix}`,
        `192.168.1.50 ${prefix}`,
        `192.168.1.50/${prefix} `,
      ]) {
        const parts = decomposeCombined(raw);
        if (parts === null) throw new Error(`failed to decompose ${raw}`);
        expect(composeSplit(parts.address, parts.prefix), raw).toBe(`192.168.1.50/${prefix}`);
      }
    }
  });

  it('round-trips the /31 and /32 spellings, where the fields are most easily confused', () => {
    for (const raw of ['192.168.1.50/31', '192.168.1.50/32', '0.0.0.0/0']) {
      const parts = decomposeCombined(raw);
      if (parts === null) throw new Error(`failed to decompose ${raw}`);
      expect(composeSplit(parts.address, parts.prefix), raw).toBe(raw);
    }
  });
});

/* ------------------------------------------------------------------ *
 * The Phase 6 exit criterion, first half: all 33 prefixes
 * ------------------------------------------------------------------ */

describe('all 33 prefixes on 192.168.1.50', () => {
  /**
   * The usable-host rule, written out rather than computed, because computing it
   * would use the same reasoning the engine does and so could not catch an error
   * in that reasoning.
   */
  const usableFor = (prefix: number): number => {
    if (prefix === 32) return 1;
    if (prefix === 31) return 2; // RFC 3021: both addresses are usable.
    return 2 ** (32 - prefix) - 2;
  };

  it.each(Array.from({ length: 33 }, (_, prefix) => prefix))(
    'prefix /%i satisfies every structural invariant',
    (prefix) => {
      const subnet = evaluated(`192.168.1.50/${prefix}`);

      expect(subnet.cidr.prefix).toBe(prefix);
      expect(subnet.networkBits).toBe(prefix);
      expect(subnet.hostBits).toBe(32 - prefix);
      expect(subnet.totalAddresses).toBe(2 ** (32 - prefix));
      expect(subnet.usableHosts).toBe(usableFor(prefix));

      // The network address must be a boundary: ANDing it with its own mask is
      // idempotent. This is the property a wrong mask breaks first.
      const mask = subnet.subnetMask;
      expect((subnet.networkAddress & mask) >>> 0).toBe(subnet.networkAddress);
      expect((subnet.broadcastAddress & mask) >>> 0).toBe(subnet.networkAddress);
      // A mask and its wildcard are exact complements: no bit is set in both, and no
      // bit is clear in both. Checked as OR as well as AND because /0 has an all-zero
      // mask, where AND alone is trivially true and would prove nothing.
      expect((subnet.subnetMask & subnet.wildcardMask) >>> 0).toBe(0);
      expect((subnet.subnetMask | subnet.wildcardMask) >>> 0).toBe(0xffffffff);

      // Broadcast is the last address, and the range is exactly totalAddresses long.
      expect((subnet.networkAddress + subnet.totalAddresses - 1) >>> 0).toBe(
        subnet.broadcastAddress,
      );

      // The host range is inside the block and no longer than the block.
      expect(subnet.firstUsableHost).toBeGreaterThanOrEqual(subnet.networkAddress);
      expect(subnet.lastUsableHost).toBeLessThanOrEqual(subnet.broadcastAddress);
      expect(subnet.usableHosts).toBe(
        subnet.lastUsableHost - subnet.firstUsableHost + 1,
      );

      // /32 and /31 do not reserve the edge addresses, and nothing else does.
      expect(subnet.isHostRoute).toBe(prefix === 32);
      expect(subnet.isPointToPoint).toBe(prefix === 31);

      // The classification follows the network address the engine resolved, not the
      // address the user typed. Those differ for most prefixes here, so this catches
      // a classifier reading the wrong operand.
      expect(subnet.addressSpace).toBe(classifyAddressSpace(subnet.networkAddress));
    },
  );

  it.each([
    [32, '192.168.1.50', '192.168.1.50'],
    [31, '192.168.1.50', '192.168.1.51'],
    [30, '192.168.1.48', '192.168.1.51'],
    [29, '192.168.1.48', '192.168.1.55'],
    [28, '192.168.1.48', '192.168.1.63'],
    [27, '192.168.1.32', '192.168.1.63'],
    [26, '192.168.1.0', '192.168.1.63'],
    [25, '192.168.1.0', '192.168.1.127'],
    [24, '192.168.1.0', '192.168.1.255'],
    [16, '192.168.0.0', '192.168.255.255'],
    [8, '192.0.0.0', '192.255.255.255'],
    [0, '0.0.0.0', '255.255.255.255'],
  ] as const)('prefix /%i spans %s to %s', (prefix, network, broadcast) => {
    const subnet = evaluated(`192.168.1.50/${prefix}`);
    expect(integerToIPv4(subnet.networkAddress)).toBe(network);
    expect(integerToIPv4(subnet.broadcastAddress)).toBe(broadcast);
  });

  it('reserves the edge addresses for /0 through /30 and for nothing shorter', () => {
    for (let prefix = 0; prefix <= 30; prefix += 1) {
      const subnet = evaluated(`192.168.1.50/${prefix}`);
      expect(subnet.firstUsableHost, `/${prefix}`).toBe(subnet.networkAddress + 1);
      expect(subnet.lastUsableHost, `/${prefix}`).toBe(subnet.broadcastAddress - 1);
    }
  });

  it('assigns both addresses of a /31, per RFC 3021', () => {
    const subnet = evaluated('192.168.1.50/31');
    expect(subnet.firstUsableHost).toBe(parseIPv4('192.168.1.50'));
    expect(subnet.lastUsableHost).toBe(parseIPv4('192.168.1.51'));
    expect(subnet.usableHosts).toBe(2);
  });

  it('aligns a /31 to the even boundary, so the pair is stable whichever end was typed', () => {
    // 192.168.1.51/31 is the same link as 192.168.1.50/31. A user who types the
    // upper address must not see a different subnet.
    expect(evaluated('192.168.1.51/31').networkAddress).toBe(
      evaluated('192.168.1.50/31').networkAddress,
    );
  });

  it('treats a /32 as a single address with no reserved edges', () => {
    const subnet = evaluated('192.168.1.50/32');
    expect(subnet.firstUsableHost).toBe(parseIPv4('192.168.1.50'));
    expect(subnet.lastUsableHost).toBe(parseIPv4('192.168.1.50'));
    expect(subnet.broadcastAddress).toBe(parseIPv4('192.168.1.50'));
    expect(subnet.usableHosts).toBe(1);
  });

  it('keeps the whole address space intact at /0', () => {
    // 2^32 does not fit in a signed 32-bit integer but does fit in a JS double, so
    // this is exactly where a signed-int contamination bug would show up.
    const subnet = evaluated('192.168.1.50/0');
    expect(subnet.totalAddresses).toBe(4_294_967_296);
    expect(subnet.networkAddress).toBe(0);
    expect(subnet.broadcastAddress).toBe(4_294_967_295);
    expect(subnet.usableHosts).toBe(4_294_967_294);
  });
});

/* ------------------------------------------------------------------ *
 * Coverage-shaped cases
 * ------------------------------------------------------------------ */

describe('every prefix is reachable through both input modes', () => {
  it.each(Array.from({ length: 33 }, (_, prefix) => prefix))(
    'split mode reaches /%i with the same answer as combined',
    (prefix) => {
      const combined = evaluated(`192.168.1.50/${prefix}`);
      const split = expectSuccess(evaluateSplit('192.168.1.50', String(prefix))).subnet;
      expect(split).toEqual(combined);
    },
  );

  it.each(Array.from({ length: 33 }, (_, prefix) => prefix))(
    'a leading slash reaches /%i as well',
    (prefix) => {
      const combined = evaluated(`192.168.1.50/${prefix}`);
      const split = expectSuccess(evaluateSplit('192.168.1.50', `/${prefix}`)).subnet;
      expect(split).toEqual(combined);
    },
  );
});

describe('boundary addresses', () => {
  it.each([
    '0.0.0.0/0',
    '0.0.0.0/32',
    '255.255.255.255/32',
    '255.255.255.255/0',
    '255.255.255.255/31',
    '128.0.0.0/1',
    '10.0.0.0/8',
    '172.16.0.0/12',
    '172.31.255.255/12',
    '192.168.0.0/16',
  ])('resolves %s without throwing', (raw) => {
    expect(() => evaluated(raw)).not.toThrow();
  });

  it('handles 172.16.0.0/12 at its real boundary, not as two /16s', () => {
    // 172.16.0.0/12 spans 172.16.0.0 to 172.31.255.255. Handling it as 172.16.0.0/16
    // would silently halve it.
    const subnet = evaluated('172.16.0.0/12');
    expect(integerToIPv4(subnet.networkAddress)).toBe('172.16.0.0');
    expect(integerToIPv4(subnet.broadcastAddress)).toBe('172.31.255.255');
  });
});
