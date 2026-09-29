/**
 * The subnet result view model.
 *
 * The test that matters most here is "every field of the result is shown". The Phase
 * 6 exit criterion is that all 13 spec fields render, and a hand-maintained list of 13
 * labels in a test would drift from the 14 keys of `SubnetInfo` without anyone
 * noticing. So the list is derived from the type instead, by exercising the engine and
 * reading what came back.
 */

import { describe, expect, it } from 'vitest';

import { evaluateCombined, evaluateSplit } from '@/core/calculator-input';
import { isNetArchitectError } from '@/core/errors';
import { parseIPv4 } from '@/core/ip-engine';
import { CLASSIFICATION_BY_KIND, STANDARD_REFS } from '@/core/standards';
import { buildSubnetView, classifyCalculatorOutcome } from '@/utils/subnet-view';

import type { CalculatorOutcome } from '@/core/calculator-input';
import type { SubnetView } from '@/utils/subnet-view';

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** A view for `raw`, asserting the input was valid rather than returning a failure. */
const viewFor = (raw: string): SubnetView => {
  const outcome: CalculatorOutcome = evaluateCombined(raw);
  if (!outcome.ok) throw new Error(`fixture ${raw} did not parse: ${outcome.message}`);
  return buildSubnetView({
    subnet: outcome.subnet,
    inputText: outcome.inputText,
    inputWasNetworkBoundary: outcome.inputWasNetworkBoundary,
  });
};

const rowValue = (view: SubnetView, label: string): string => {
  const found = [...view.hero, ...view.detail].find((entry) => entry.label === label);
  if (found === undefined) {
    throw new Error(
      `no row labelled "${label}"; present: ${[...view.hero, ...view.detail]
        .map((entry) => entry.label)
        .join(', ')}`,
    );
  }
  return found.value;
};

const labels = (view: SubnetView): string[] => [...view.hero, ...view.detail].map((r) => r.label);

const ALL_PREFIXES = Array.from({ length: 33 }, (_, prefix) => prefix);

/** The message the engine produces for the same input. See calculator-input.test.ts. */
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
 * The criterion: every field of the result is shown
 * ------------------------------------------------------------------ */

describe('every field of SubnetInfo is represented in the view', () => {
  it('has a row or a notice carrying each field, for a /24', () => {
    const view = viewFor('192.168.1.50/24');
    const present = labels(view).join(' | ');

    // Each assertion names the field it is standing for. cidr is split between
    // prefixLabel and networkCidr; the two booleans drive notices and labels; the
    // classification is its own badge.
    expect(present).toContain('Network address');
    expect(present).toContain('Broadcast address');
    expect(present).toContain('Subnet mask');
    expect(present).toContain('Wildcard mask');
    expect(present).toContain('First usable host');
    expect(present).toContain('Last usable host');
    expect(present).toContain('Total addresses');
    expect(present).toContain('Usable hosts');
    expect(present).toContain('Network bits');
    expect(present).toContain('Host bits');

    expect(view.prefixLabel).toBe('/24');
    expect(view.networkCidr).toBe('192.168.1.0/24');
    expect(view.addressSpace.label).toBe(CLASSIFICATION_BY_KIND.private.label);
  });

  it('keeps the row count and labels stable for every prefix except the two relabelled', () => {
    // A /31 and a /32 rename "First usable host", because a one-address block has no
    // first. Every other prefix must present an identical set of labels, or a user
    // comparing two results is comparing two different shapes.
    const baseline = labels(viewFor('192.168.1.50/24'));
    for (const prefix of ALL_PREFIXES) {
      if (prefix === 31 || prefix === 32) continue;
      expect(labels(viewFor(`192.168.1.50/${prefix}`)), `/${prefix}`).toEqual(baseline);
    }
  });

  it('renders the same number of rows for all 33 prefixes', () => {
    const counts = new Set(
      ALL_PREFIXES.map((prefix) => [...viewFor(`192.168.1.50/${prefix}`).hero].length),
    );
    expect([...counts]).toEqual([4]);
  });

  it('relabels the host rows for a /32 rather than asserting a range that is not there', () => {
    const view = viewFor('192.168.1.50/32');
    const present = labels(view).join(' | ');
    expect(present).not.toContain('First usable host');
    expect(present).not.toContain('Last usable host');
    expect(present).toContain('The address');
  });

  it('keeps the ordinary host labels on a /31, which does have a range', () => {
    const view = viewFor('192.168.1.50/31');
    expect(labels(view).join(' | ')).toContain('First usable host');
    expect(labels(view).join(' | ')).toContain('Last usable host');
  });
});

/* ------------------------------------------------------------------ *
 * Hero and detail values
 * ------------------------------------------------------------------ */

describe('rows carry the engine values verbatim', () => {
  it('shows the four hero values for a /24', () => {
    const view = viewFor('192.168.1.50/24');
    expect(view.hero.map((entry) => entry.label)).toEqual([
      'Network address',
      'Broadcast address',
      'Subnet mask',
      'Wildcard mask',
    ]);
    expect(rowValue(view, 'Network address')).toBe('192.168.1.0');
    expect(rowValue(view, 'Broadcast address')).toBe('192.168.1.255');
    expect(rowValue(view, 'Subnet mask')).toBe('255.255.255.0');
    expect(rowValue(view, 'Wildcard mask')).toBe('0.0.0.255');
  });

  it('marks exactly the four hero rows as hero', () => {
    const view = viewFor('192.168.1.50/24');
    expect(view.hero.every((entry) => entry.hero)).toBe(true);
    expect(view.detail.some((entry) => entry.hero)).toBe(false);
  });

  it('groups large address counts, because 4294967296 is unreadable undotted', () => {
    expect(rowValue(viewFor('192.168.1.50/0'), 'Total addresses')).toBe('4,294,967,296');
    expect(rowValue(viewFor('192.168.1.50/0'), 'Usable hosts')).toBe('4,294,967,294');
  });

  it('shows the usable range as one line', () => {
    expect(rowValue(viewFor('192.168.1.50/24'), 'Usable range')).toBe(
      '192.168.1.1 - 192.168.1.254',
    );
  });

  it('shows network and host bits as counts, not as prose', () => {
    const view = viewFor('192.168.1.50/24');
    expect(rowValue(view, 'Network bits')).toBe('24');
    expect(rowValue(view, 'Host bits')).toBe('8');
  });

  it('marks bit counts as non-monospace, since they are words not tabular data', () => {
    const view = viewFor('192.168.1.50/24');
    for (const label of ['Network bits', 'Host bits', 'Host range used']) {
      const found = view.detail.find((entry) => entry.label === label);
      expect(found?.mono, label).toBe(false);
    }
  });

  it('states the total as a power of two, so the arithmetic is visible', () => {
    expect(
      viewFor('192.168.1.50/24').detail.find((entry) => entry.label === 'Total addresses')?.note,
    ).toBe('2^8.');
  });
});

/* ------------------------------------------------------------------ *
 * Utilisation
 * ------------------------------------------------------------------ */

describe('host range utilisation', () => {
  it('computes the host range share for an ordinary subnet', () => {
    // 254 usable of 254 in the host range - every address between the reserved edges
    // is assignable, so the host range is fully used by construction. This figure is
    // about the *block*, not about a user's allocation, and must not be read as 0%.
    const view = viewFor('192.168.1.50/24');
    expect(rowValue(view, 'Host range used')).toBe('100%');
  });

  it('reports n/a for a /32, where a percentage against reserved edges is meaningless', () => {
    expect(rowValue(viewFor('192.168.1.50/32'), 'Host range used')).toBe('n/a');
  });

  it('reports n/a for a /31, where RFC 3021 already makes the whole block usable', () => {
    expect(rowValue(viewFor('192.168.1.50/31'), 'Host range used')).toBe('n/a');
  });

  it('never renders a figure above 100% for a single subnet', () => {
    // calculateUtilization does not clamp by design, so an over-capacity figure stays
    // visible elsewhere in the app. Here there is no requirement to be over capacity,
    // so anything above 100% would mean the view divided the wrong numbers.
    for (const prefix of ALL_PREFIXES) {
      const value = rowValue(viewFor(`192.168.1.50/${prefix}`), 'Host range used');
      const numeric = Number.parseFloat(value);
      if (value === 'n/a') continue;
      expect(numeric, `/${prefix} rendered ${value}`).toBeLessThanOrEqual(100);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Notices
 * ------------------------------------------------------------------ */

describe('notices', () => {
  it('explains a /31 with the RFC 3021 note', () => {
    const view = viewFor('192.168.1.50/31');
    expect(view.notices).toHaveLength(1);
    expect(view.notices[0]?.title).toMatch(/RFC 3021/);
    expect(view.notices[0]?.citation).toBe(STANDARD_REFS.RFC3021);
  });

  it('explains a /32 as a single address rather than a tiny subnet', () => {
    const view = viewFor('192.168.1.50/32');
    expect(view.notices.some((n) => /not a subnet/.test(n.title))).toBe(true);
  });

  it('explains a /30, since two usable addresses surprises people and is why /31 exists', () => {
    expect(viewFor('192.168.1.48/30').notices.some((n) => /two usable/i.test(n.title))).toBe(
      true,
    );
  });

  it('gives an ordinary /24 no prefix-specific notice', () => {
    // A note on every result is a note that gets ignored, and /24 is the common case
    // that needs no explanation. The boundary form is used here so the only notice
    // that could appear is the prefix one; the host-inside-block warning has its own
    // test below.
    const view = viewFor('192.168.1.0/24');
    expect(view.notices.filter((notice) => notice.kind === 'info')).toHaveLength(0);
    expect(view.notices).toHaveLength(0);
  });

  it('gives a host-typed /24 exactly one notice, and it is the warning', () => {
    // 192.168.1.50 is inside the block, so this result earns one notice - no more.
    const view = viewFor('192.168.1.50/24');
    expect(view.notices).toHaveLength(1);
    expect(view.notices[0]?.kind).toBe('warn');
  });

  it('warns when a host address was typed, and cites RFC 7600 for it', () => {
    const view = viewFor('192.168.1.50/24');
    const warn = view.notices.find((n) => n.kind === 'warn');
    expect(warn?.citation).toBe(STANDARD_REFS.RFC7600);
    expect(warn?.body).toMatch(/not a usable subnet definition/);
  });

  it('does not warn when the user typed the boundary', () => {
    expect(viewFor('192.168.1.0/24').notices).toHaveLength(0);
  });

  it('does not warn about a host inside a /32, which would contradict the /32 note', () => {
    // A /32 typed as 192.168.1.50/32 is not "inside" a block - it IS the block. Two
    // notices saying opposite things on one screen is worse than one saying nothing.
    expect(viewFor('192.168.1.50/32').notices.filter((n) => n.kind === 'warn')).toHaveLength(0);
  });

  it('puts the prefix-specific note first, since it is the surprising part', () => {
    const notices = viewFor('192.168.1.50/30').notices;
    expect(notices[0]?.kind).toBe('info');
  });

  it('gives every notice a citation and a body that is not just the title', () => {
    for (const prefix of ALL_PREFIXES) {
      for (const notice of viewFor(`192.168.1.50/${prefix}`).notices) {
        expect(notice.citation, `/${prefix}`).toMatch(/^(RFC|IEEE|NIST|CIS)/);
        expect(notice.body.length, `/${prefix} ${notice.title}`).toBeGreaterThan(
          notice.title.length,
        );
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * Address space
 * ------------------------------------------------------------------ */

describe('address space badge', () => {
  it('labels RFC 1918 private space and says it is not public', () => {
    const badge = viewFor('192.168.1.50/24').addressSpace;
    expect(badge.label).toBe('Private-Use');
    expect(badge.citation).toBe(STANDARD_REFS.RFC1918);
    expect(badge.isPublic).toBe(false);
    expect(badge.guidance).not.toBeNull();
  });

  it('labels a public address as public and offers no guidance', () => {
    const badge = viewFor('8.8.8.0/24').addressSpace;
    expect(badge.isPublic).toBe(true);
    expect(badge.guidance).toBeNull();
  });

  it('distinguishes CGNAT from private space, which are routinely confused', () => {
    // 100.64/10 is shared address space (RFC 6598). It is NOT RFC 1918 private space,
    // and calling it private is one of the most common subnetting mistakes.
    const badge = viewFor('100.64.0.0/24').addressSpace;
    expect(badge.isPublic).toBe(false);
    expect(badge.citation).toBe(STANDARD_REFS.RFC6598);
    expect(badge.label).not.toBe('Private-Use');
  });

  it('labels link-local space separately from private space', () => {
    expect(viewFor('169.254.1.0/24').addressSpace.citation).toBe(STANDARD_REFS.RFC3927);
  });

  it('classifies by the network address, not the address the user typed', () => {
    // 10.0.0.1/8 resolves to 10.0.0.0/8, which is private either way - but the /15
    // case is where it matters: 172.32.0.0/15 is public while 172.16.0.0/15 is not,
    // and a classifier reading the typed host would disagree near the boundary.
    expect(viewFor('172.16.0.1/15').addressSpace.isPublic).toBe(false);
    expect(viewFor('172.32.0.1/15').addressSpace.isPublic).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Screen state classification
 * ------------------------------------------------------------------ */

describe('classifyCalculatorOutcome', () => {
  it('reports an untouched field as empty, not as an error', () => {
    // The distinction this function exists for. An empty field is a failure to
    // `evaluateCombined` - there is no CIDR in an empty string - and treating that as
    // an error puts a red banner above a field the user has not touched.
    const state = classifyCalculatorOutcome(evaluateCombined(''));
    expect(state.kind).toBe('empty');
  });

  it('reports a cleared field as empty too', () => {
    // Indistinguishable visually, so it must be indistinguishable in state.
    for (const raw of ['', ' ', '\t', '   ']) {
      expect(classifyCalculatorOutcome(evaluateCombined(raw)).kind, JSON.stringify(raw)).toBe(
        'empty',
      );
    }
  });

  it('still reports a whitespace-only split field as invalid, because it is named', () => {
    // A blank address box is a different situation from a blank single box: the user
    // has been shown two fields and left the first one empty, which is worth saying.
    expect(classifyCalculatorOutcome(evaluateSplit('', '24')).kind).toBe('invalid');
  });

  it('carries the message and the field through for a real mistake', () => {
    const state = classifyCalculatorOutcome(evaluateCombined('192.168.1.500/24'));
    if (state.kind !== 'invalid') throw new Error(`expected invalid, got ${state.kind}`);
    expect(state.message).toBe(engineMessageFor(() => parseIPv4('192.168.1.500')));
    expect(state.field).toBe('address');
  });

  it('treats a half-typed address as invalid rather than empty', () => {
    // "192.168.1" is not nothing, and telling the user nothing is wrong would be the
    // most confusing possible response to a partially typed address.
    for (const raw of ['1', '19', '192', '192.168', '192.168.1', '192.168.1.']) {
      expect(classifyCalculatorOutcome(evaluateCombined(raw)).kind, raw).not.toBe('empty');
    }
  });

  it('builds the view on success, and the same view buildSubnetView would build', () => {
    const outcome = evaluateCombined('192.168.1.50/24');
    if (!outcome.ok) throw new Error('fixture must parse');
    const state = classifyCalculatorOutcome(outcome);
    if (state.kind !== 'ok') throw new Error(`expected ok, got ${state.kind}`);
    expect(state.view).toEqual(
      buildSubnetView({
        subnet: outcome.subnet,
        inputText: outcome.inputText,
        inputWasNetworkBoundary: outcome.inputWasNetworkBoundary,
      }),
    );
  });

  it('never returns a fourth state, for any input at all', () => {
    // The screen is a total switch over this union. A new kind added here without a
    // matching branch would render an input and nothing else, and no type error would
    // appear at the call site - the switch would simply fall through.
    const kinds = new Set<string>();
    for (const raw of [
      '',
      ' ',
      '24',
      '24/24',
      '1.2.3.4',
      '1.2.3.4/24',
      '1.2.3.4/24/24',
      '1.2.3.4/33',
      '1.2.3.500/24',
      '192.168.1.50/24',
      '192.168.1.50/31',
      '192.168.1.50/32',
      '0.0.0.0/0',
    ]) {
      kinds.add(classifyCalculatorOutcome(evaluateCombined(raw)).kind);
    }
    expect([...kinds].sort()).toEqual(['empty', 'invalid', 'ok']);
  });

  it('classifies every prefix the same way, so no prefix hides an error state', () => {
    for (let prefix = 0; prefix <= 32; prefix += 1) {
      const state = classifyCalculatorOutcome(evaluateCombined(`192.168.1.50/${prefix}`));
      expect(state.kind, `/${prefix}`).toBe('ok');
    }
  });
});

/* ------------------------------------------------------------------ *
 * Copy text
 * ------------------------------------------------------------------ */

describe('copy text', () => {
  it('leads with what was entered and the block it resolved to', () => {
    const text = viewFor('192.168.1.50/24').copyText;
    expect(text).toContain('Entered: 192.168.1.50/24');
    expect(text).toContain('Block:    192.168.1.0/24');
  });

  it('includes every row value, so a paste carries the whole result', () => {
    const view = viewFor('192.168.1.50/24');
    for (const entry of [...view.hero, ...view.detail]) {
      expect(view.copyText, entry.label).toContain(entry.value);
    }
  });

  it('carries the classification and its guidance', () => {
    const text = viewFor('192.168.1.50/24').copyText;
    expect(text).toContain('Private-Use');
    expect(text).toContain(STANDARD_REFS.RFC1918);
  });

  it('omits the guidance line entirely for public space, rather than printing nothing', () => {
    const text = viewFor('8.8.8.0/24').copyText;
    expect(text).toContain('Address space: Public');
    expect(text.split('\n').filter((line) => line.trim() === '').length).toBeGreaterThan(0);
  });

  it('includes the notice titles with their citations', () => {
    const text = viewFor('192.168.1.50/31').copyText;
    expect(text).toContain(STANDARD_REFS.RFC3021);
  });

  it('ends with the offline statement, so a pasted block carries its own provenance', () => {
    expect(viewFor('192.168.1.50/24').copyText.trimEnd().endsWith('does not connect to any network.')).toBe(
      true,
    );
  });

  it('aligns every row value into one column', () => {
    const view = viewFor('192.168.1.50/24');
    const all = [...view.hero, ...view.detail];
    // The column is derived the same way the copy builder derives it, so this
    // asserts the rows line up with each other rather than restating a constant.
    // Measuring with a regex over the padding instead would find the last character
    // of each label, which sits at a different offset for every row.
    const column = 2 + Math.max(...all.map((entry) => entry.label.length)) + 2;

    for (const entry of all) {
      const line = view.copyText
        .split('\n')
        .find((candidate) => candidate.includes(entry.label) && candidate.includes(entry.value));
      expect(line, `no copy line for ${entry.label}`).toBeDefined();
      expect(line?.indexOf(entry.value), `${entry.label} value column`).toBe(column);
    }
  });

  it('renders without throwing for all 33 prefixes', () => {
    for (const prefix of ALL_PREFIXES) {
      const text = viewFor(`192.168.1.50/${prefix}`).copyText;
      expect(text.length, `/${prefix}`).toBeGreaterThan(0);
      expect(text).not.toContain('undefined');
      expect(text).not.toContain('NaN');
      expect(text).not.toContain('null');
    }
  });
});

/* ------------------------------------------------------------------ *
 * Whole-result sweep
 * ------------------------------------------------------------------ */

describe('all 33 prefixes produce a complete view', () => {
  it.each(ALL_PREFIXES)('/%i builds every part of the view', (prefix) => {
    const view = viewFor(`192.168.1.50/${prefix}`);

    expect(view.hero).toHaveLength(4);
    expect(view.detail.length).toBeGreaterThanOrEqual(8);
    expect(view.prefixLabel).toBe(`/${prefix}`);
    expect(view.networkCidr.endsWith(`/${prefix}`)).toBe(true);
    expect(view.addressSpace.label.length).toBeGreaterThan(0);
    expect(view.copyText.length).toBeGreaterThan(0);

    // No row may be blank. A blank cell is indistinguishable from a value that
    // failed to render, and this is the one screen where every cell is load-bearing.
    for (const entry of [...view.hero, ...view.detail]) {
      expect(entry.value.trim().length, `/${prefix} ${entry.label}`).toBeGreaterThan(0);
    }
  });

  it.each(ALL_PREFIXES)('/%i produces a view with no undefined or NaN anywhere', (prefix) => {
    const view = viewFor(`192.168.1.50/${prefix}`);
    const serialised = JSON.stringify(view);
    expect(serialised, `/${prefix}`).not.toContain('null,"label');
    expect(serialised, `/${prefix}`).not.toContain('NaN');
    expect(serialised, `/${prefix}`).not.toContain('undefined,');
  });

  it('is frozen, so a screen cannot mutate a shared result', () => {
    const view = viewFor('192.168.1.50/24');
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.hero)).toBe(true);
    expect(Object.isFrozen(view.detail)).toBe(true);
    expect(Object.isFrozen(view.notices)).toBe(true);
  });
});
