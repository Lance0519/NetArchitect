/**
 * NetArchitect validation layer.
 *
 * PURE MODULE. No React, no React Native, no Expo. Zod lives here and nowhere
 * else, so the form layer, the persistence layer and the CLI-shaped scripts all
 * agree on what valid input means.
 *
 * ## The one rule
 *
 * These schemas do not reimplement any networking logic. Every address, prefix
 * and CIDR is parsed by `ip-engine`, and every failure message is the
 * `friendlyMessage` of a typed error from `errors.ts`. The schema layer only
 * decides *when* to call the engine and *where to attach the message*.
 *
 * That is not a style preference. A second implementation of "is this a valid
 * IPv4 address" is a second set of answers, and the two will disagree at the
 * edges. Here they cannot, because there is only one.
 *
 * ## Output types
 *
 * Schemas transform to the ENGINE's types, not to strings: an address becomes
 * the unsigned integer the engine uses, a CIDR becomes a `Cidr`. The engine
 * therefore receives only validated, correctly typed input, and never a raw
 * `TextInput` value.
 *
 * ## Why not `z.coerce`
 *
 * `z.coerce.number()` maps `''`, `null`, `[]` and `true` to `0` and `'1e3'` to
 * `1000`. Since `/0` is a *valid* prefix and `0` is the whole of IPv4, coercion
 * would let an empty field silently validate as the entire address space. Every
 * schema here takes `unknown` and validates the raw shape itself.
 */

import { z } from 'zod';

import {
  MAX_ADDRESS_COUNT,
  assertNetworkBoundary,
  calculateSubnet,
  formatCidr,
  integerToIPv4,
  isWithin,
  parseCidr,
  parseIPv4,
  parsePrefix,
} from './ip-engine';
import { NETWORK_ROLE_TUPLE } from './roles';
import { packVLSM } from './vlsm-engine';
import {
  InvalidGatewayError,
  InvalidHostCountError,
  InvalidVLANError,
  isNetArchitectError,
  NetArchitectError,
  SubnetOverlapError,
} from './errors';
import type { Cidr, HostRequirement, NetworkRole, PlanProfile, SubnetInfo } from '../types/network';

/* ================================================================== *
 * Plumbing
 * ================================================================== */

type Outcome<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

const pass = <T>(value: T): Outcome<T> => ({ ok: true, value });
const fail = (message: string): Outcome<never> => ({ ok: false, message });

/**
 * Run an engine function and translate its typed error into a message.
 *
 * A `NetArchitectError` becomes `{ ok: false, message }`. Anything else is
 * rethrown: a `TypeError` from a genuine bug must never be laundered into
 * "Enter a valid IPv4 address", because that would hide the defect behind a
 * message about the user's typing.
 */
const fromEngine = <T>(run: () => T): Outcome<T> => {
  try {
    return pass(run());
  } catch (error) {
    if (isNetArchitectError(error)) return fail(error.friendlyMessage);
    throw error;
  }
};

/**
 * A schema that owns every one of its own error messages.
 *
 * The base is `z.unknown()`, so all input reaches the validator and Zod's
 * default wording ("Invalid input: expected string, received undefined") never
 * leaks into the UI. Missing, empty and malformed values are all handled by the
 * same code path, which is what keeps the copy consistent.
 */
const field = <T>(validate: (value: unknown) => Outcome<T>) =>
  z.unknown().transform((value, ctx): T => {
    const result = validate(value);
    if (result.ok) return result.value;
    ctx.addIssue({ code: 'custom', message: result.message });
    return z.NEVER;
  });

/** True for a value with no content: undefined, null, or whitespace only. */
const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === 'string' && value.trim().length === 0);

/**
 * Narrow to a non-blank string, or explain what was wrong.
 *
 * Returns an {@link Outcome} rather than a bare string so a missing or
 * non-string value becomes a user-facing message instead of reaching the engine
 * as `undefined`.
 */
const stringField = (value: unknown, message: string): Outcome<string> =>
  typeof value === 'string' && !isBlank(value) ? pass(value) : fail(message);

/**
 * Re-type an {@link Outcome} that is being propagated upward.
 *
 * Only safe on the failure branch, which is where it is used. Written once here
 * so no call site needs an `as` cast to satisfy the compiler - a cast here
 * would hide exactly the bug it is hiding now.
 */
const propagate = <T>(outcome: Outcome<unknown>): Outcome<T> =>
  outcome.ok ? pass(outcome.value as T) : fail(outcome.message);

/**
 * Run a field schema and report its first message onto an enclosing context.
 *
 * Needed because a nested `safeParse` returns a RESULT and does not throw.
 * Wrapping one in {@link fromEngine} therefore always "succeeds" - a check that
 * looks present and validates nothing. This helper inspects `.success`
 * explicitly, which is the whole point of it existing.
 *
 * @returns true when the value was valid.
 */
const reportField = (
  schema: z.ZodType,
  value: unknown,
  ctx: z.RefinementCtx,
  path: (string | number)[] = [],
): boolean => {
  const result = schema.safeParse(value);
  if (result.success) return true;
  ctx.addIssue({
    code: 'custom',
    message: result.error.issues[0]?.message ?? 'This value is not valid.',
    path,
  });
  return false;
};

/* ================================================================== *
 * Pinned user-facing copy
 *
 * These strings are part of the product contract and are asserted verbatim in
 * tests/validation.test.ts. They are exported so no screen retypes them and
 * drifts.
 *
 * This is the registry for the ZOD layer only. `CALCULATOR_MESSAGES` in
 * calculator-input.ts is a separate registry for the calculator's own input
 * rules, and the two are deliberately not merged: these are attached as schema
 * issues and read by the form layer, while those are returned as an outcome
 * discriminant and read by the screen. Merging them would mean one growing
 * object with two unrelated audiences, and the useful property here is that a
 * string appears in exactly one place.
 * ================================================================== */

export const MESSAGES = Object.freeze({
  invalidIPv4: 'Enter a valid IPv4 address.',
  invalidPrefix: 'CIDR must be between /0 and /32.',
  invalidHostCount: 'Required hosts must be greater than 0.',
  scopeExhaustion: 'Not enough address space for these requirements.',
  invalidVlan: 'VLAN ID must be between 1 and 4094 (0 and 4095 are reserved).',
  invalidCidr: 'Enter a valid CIDR block, for example 192.168.1.0/24.',
  /** A /0 is 4,294,967,296 addresses, two of which are reserved. */
  hostCountTooLarge: `Required hosts cannot exceed ${MAX_ADDRESS_COUNT - 2}.`,
  prefixRequired: 'Prefix length is required.',
  hostCountRequired: 'Required hosts is required.',
  vlanIdRequired: 'VLAN ID is required.',
  gatewayRequired: 'Gateway address is required.',
  nameRequired: 'Name is required.',
  nameTooLong: 'Name must be 80 characters or fewer.',
  descriptionTooLong: 'Description must be 500 characters or fewer.',
});

/* ================================================================== *
 * Primitive field schemas
 * ================================================================== */

/**
 * A single IPv4 address. `192.168.1.1` â†’ `3232235777`.
 *
 * Strict by delegation: leading zeros, wrong octet counts and octets above 255
 * are all rejected by `parseIPv4`, because an addressing tool that guesses is an
 * addressing tool that silently produces a plan for the wrong network.
 */
export const ipv4Schema = field<number>((value) => {
  if (typeof value !== 'string') return fail(MESSAGES.invalidIPv4);
  return fromEngine(() => parseIPv4(value));
});

/**
 * A prefix length. `24`, `"24"` and `"/24"` all yield `24`.
 *
 * The leading slash matters. `/` sits on most phone numeric pads, so a user
 * typing a prefix will frequently enter `/24`; rejecting that would be a hostile
 * response to a keystroke the platform invited. `parsePrefix` accepts it, and
 * this schema inherits that behaviour rather than restating it.
 *
 * `"24/24"` is still rejected. Two numbers in one field are ambiguous, and
 * quietly picking one of them is exactly the guessing this project refuses to do.
 */
export const prefixSchema = field<number>((value) => {
  if (isBlank(value)) return fail(MESSAGES.prefixRequired);
  if (typeof value !== 'string' && typeof value !== 'number') return fail(MESSAGES.invalidPrefix);
  return fromEngine(() => parsePrefix(value));
});

/** A CIDR *reference*: `192.168.1.50/24` is accepted and yields the parsed pair. */
export const cidrSchema = field<Cidr>((value) => {
  const text = stringField(value, MESSAGES.invalidCidr);
  if (!text.ok) return propagate(text);
  return fromEngine(() => parseCidr(text.value));
});

/**
 * A CIDR used as a subnet *definition*, so the address must have no host bits.
 *
 * A planner row reading `192.168.1.50/24` is a mistake: the subnet it
 * describes is `192.168.1.0/24`, and storing the other value makes the plan
 * disagree with its own addressing. The message names the correct value rather
 * than only rejecting the wrong one.
 */
export const subnetCidrSchema = field<Cidr>((value) => {
  const parsed = cidrSchema.safeParse(value);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? MESSAGES.invalidCidr);
  return fromEngine(() => assertNetworkBoundary(parsed.data));
});

/**
 * IEEE 802.1Q VLAN ID. 1-4094, with 0 and 4095 reserved.
 *
 * Accepts a string because the field is a numeric keypad, and a number because
 * `valueAsNumber` is the natural implementation on a tablet. Both go through
 * `parseVlanInput`, which rejects blanks and non-digits rather than coercing.
 */
export const vlanIdSchema = field<number>((value) => {
  if (isBlank(value)) return fail(MESSAGES.vlanIdRequired);
  if (typeof value !== 'string' && typeof value !== 'number') return fail(MESSAGES.invalidVlan);
  return fromEngine(() => parseVlanInput(value));
});

/** A VLAN ID, or `undefined` when the segment is untagged. Untagged is legitimate. */
export const optionalVlanIdSchema = z.unknown().transform((value, ctx): number | undefined => {
  if (isBlank(value)) return undefined;
  const result = vlanIdSchema.safeParse(value);
  if (result.success) return result.data;
  ctx.addIssue({
    code: 'custom',
    message: result.error.issues[0]?.message ?? MESSAGES.invalidVlan,
  });
  return z.NEVER;
});

/**
 * Required host count, 1 to 4294967294.
 *
 * The ceiling is not arbitrary: a `/0` is 4,294,967,296 addresses, and the
 * network and broadcast addresses are unassignable, so 4294967294 is the most
 * hosts IPv4 can describe.
 */
export const hostCountSchema = field<number>((value) => {
  if (isBlank(value)) return fail(MESSAGES.hostCountRequired);
  if (typeof value !== 'string' && typeof value !== 'number')
    return fail(MESSAGES.invalidHostCount);
  return fromEngine(() => parseHostCountInput(value));
});

/* ================================================================== *
 * Numeric input parsers
 *
 * Both reject anything that is not a plain run of digits. `Number('1e3')` is
 * 1000, `Number(' 8 ')` is 8 and `Number('0x10')` is 16, none of which are
 * things a person means to type into a prefix or host-count field.
 * ================================================================== */

const DIGITS_ONLY = /^\d+$/;

const parseHostCountInput = (value: string | number): number => {
  const text = typeof value === 'number' ? String(value) : value.trim();

  if (!DIGITS_ONLY.test(text)) {
    throw new InvalidHostCountError(value, `"${text}" is not a whole number`);
  }

  const count = Number(text);
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new InvalidHostCountError(value, `"${text}" is not at least 1`);
  }
  if (count > MAX_ADDRESS_COUNT - 2) {
    throw new InvalidHostCountError(
      value,
      `${count} exceeds the maximum of ${MAX_ADDRESS_COUNT - 2} hosts in IPv4`,
      MESSAGES.hostCountTooLarge,
    );
  }
  return count;
};

const parseVlanInput = (value: string | number): number => {
  const text = typeof value === 'number' ? String(value) : value.trim();

  if (!DIGITS_ONLY.test(text)) {
    throw new InvalidVLANError(value);
  }
  const id = Number(text);
  // 0 and 4095 are reserved by IEEE 802.1Q: 0 means "untagged/priority" and
  // 4095 is the reserved boundary value.
  if (id < 1 || id > 4094) {
    throw new InvalidVLANError(value);
  }
  return id;
};

/* ================================================================== *
 * Gateway
 * ================================================================== */

/** Normalise the subnet argument into a fully resolved {@link SubnetInfo}. */
const resolveSubnet = (subnet: Cidr | SubnetInfo | string): SubnetInfo => {
  if (typeof subnet === 'string') {
    const cidr = parseCidr(subnet);
    return calculateSubnet(cidr.ip, cidr.prefix);
  }
  if ('cidr' in subnet) return subnet;
  return calculateSubnet(subnet.ip, subnet.prefix);
};

/**
 * A gateway address for a given subnet.
 *
 * Three separate rules, in order, because they are three different mistakes:
 *
 *  1. It must parse as an address at all.
 *  2. It must fall inside the subnet. A gateway on the wrong subnet cannot
 *     route for this segment, and no amount of configuration makes it one.
 *  3. It must be *assignable*, which excludes the network and broadcast
 *     addresses for a /0-/30.
 *
 * Rule 3 is delegated to the engine's own `firstUsableHost` / `lastUsableHost`
 * rather than reimplemented. That is what makes /31 and /32 come out right
 * without a special case in this file: for a /31 both endpoints are usable per
 * RFC 3021, and for a /32 the single address is. A naive "reject the first and
 * last address" check would forbid every possible gateway on both.
 *
 * @param subnet the subnet the gateway belongs to. Accepted as a CIDR string,
 *               a parsed `Cidr`, or a resolved `SubnetInfo`.
 */
export const gatewaySchema = (subnet: Cidr | SubnetInfo | string) => {
  const resolved = resolveSubnet(subnet);
  // Print the CANONICAL network form, not whatever address the caller supplied.
  // Given "192.168.1.50/24", saying "not inside 192.168.1.50/24" is nonsense:
  // the address may well be inside that very network, and the reader is left
  // checking the arithmetic by hand. Always name the network itself.
  const subnetText = formatCidr({
    family: 'ipv4',
    ip: resolved.networkAddress,
    prefix: resolved.cidr.prefix,
  });

  return field<number>((value) => {
    if (isBlank(value)) return fail(MESSAGES.gatewayRequired);

    const text = stringField(value, MESSAGES.invalidIPv4);
    if (!text.ok) return propagate(text);

    const address = fromEngine(() => parseIPv4(text.value));
    if (!address.ok) return address;

    const gatewayText = integerToIPv4(address.value);

    if (address.value < resolved.networkAddress || address.value > resolved.broadcastAddress) {
      return fail(
        new InvalidGatewayError(
          gatewayText,
          subnetText,
          `Gateway ${gatewayText} is not inside ${subnetText}.`,
        ).friendlyMessage,
      );
    }

    if (address.value < resolved.firstUsableHost || address.value > resolved.lastUsableHost) {
      // Inside the subnet, so it is specifically the reserved edge address.
      const isNetworkAddress = address.value === resolved.networkAddress;
      const usable = integerToIPv4(
        isNetworkAddress ? resolved.firstUsableHost : resolved.lastUsableHost,
      );
      const which = isNetworkAddress ? 'network address' : 'broadcast address';
      return fail(
        new InvalidGatewayError(
          gatewayText,
          subnetText,
          `Gateway ${gatewayText} is the ${which} of ${subnetText}. Use ${usable} instead.`,
        ).friendlyMessage,
      );
    }

    return address;
  });
};

/* ================================================================== *
 * Composite schemas
 * ================================================================== */

// The role list lives in `roles.ts`, which is its single source of truth: the picker, the
// summary card and the Phase 11 auditor all need it, and a second copy here is a second
// list to keep in step. See the comment on NETWORK_ROLE_TUPLE for why the tuple form
// exists.
const PLAN_PROFILES: readonly PlanProfile[] = ['custom', 'personal', 'enterprise'];

/**
 * 1-80 characters after trimming. Trimming is part of validation, not a side
 * effect, so trailing spaces do not cost the user characters of their budget.
 */
export const planNameSchema = z.unknown().transform((value, ctx): string => {
  if (typeof value !== 'string') {
    ctx.addIssue({ code: 'custom', message: MESSAGES.nameRequired });
    return z.NEVER;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    ctx.addIssue({ code: 'custom', message: MESSAGES.nameRequired });
    return z.NEVER;
  }
  if (trimmed.length > 80) {
    ctx.addIssue({ code: 'custom', message: MESSAGES.nameTooLong });
    return z.NEVER;
  }
  return trimmed;
});

/**
 * Optional, at most 500 characters, trimmed. A missing value is an empty
 * string, not an error: a description is genuinely optional.
 *
 * `.optional()` is required on the base, not a nicety: in Zod 4 `z.unknown()`
 * no longer implies that a key may be absent, so without it a plan with no
 * description fails with "expected nonoptional, received undefined" before the
 * transform ever runs. That is exactly the kind of Zod-internal wording this
 * layer exists to keep out of the UI.
 */
export const planDescriptionSchema = z
  .unknown()
  .optional()
  .transform((value, ctx): string => {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') {
      ctx.addIssue({ code: 'custom', message: MESSAGES.descriptionTooLong });
      return z.NEVER;
    }
    const trimmed = value.trim();
    if (trimmed.length > 500) {
      ctx.addIssue({ code: 'custom', message: MESSAGES.descriptionTooLong });
      return z.NEVER;
    }
    return trimmed;
  });

/**
 * A single host requirement awaiting allocation.
 *
 * `id` is generated here rather than trusted, because a requirement arriving
 * from a form or an import has no business choosing its own primary key.
 */
export const hostRequirementSchema = z
  .object({
    id: z.string().min(1).optional(),
    // `planNameSchema`, not a local "trim then require non-empty". This used to be its
    // own weaker rule, which meant a requirement name was the one user-facing name in the
    // app with no length limit: a pasted paragraph reached a table cell verbatim, and
    // `MESSAGES.nameTooLong` was unreachable from this schema. The two name rules are
    // now one rule.
    name: planNameSchema,
    requestedHosts: hostCountSchema,
    role: z.enum(NETWORK_ROLE_TUPLE as unknown as [NetworkRole, ...NetworkRole[]]),
  })
  .transform((value): HostRequirement => ({
    id: value.id ?? nextRequirementId(),
    name: value.name,
    requestedHosts: value.requestedHosts,
    role: value.role,
  }));

/** A VLSM plan: a parent CIDR and the requirements to fit inside it. */
export const vlsmPlanSchema = z
  .object({
    parentCidr: cidrSchema,
    requirements: z.array(hostRequirementSchema),
  })
  .superRefine((value, ctx) => {
    // Delegates to the engine, so the "does it fit" answer cannot drift from
    // the "what would the subnets be" answer.
    const outcome = fromEngine(() => packVLSM(value.parentCidr, value.requirements));
    if (outcome.ok) return;
    ctx.addIssue({ code: 'custom', message: outcome.message, path: ['requirements'] });
  });

/** Plan identity fields: name 1-80, description at most 500. */
export const planFormSchema = z.object({
  name: planNameSchema,
  description: planDescriptionSchema,
  profile: z.enum(PLAN_PROFILES as [PlanProfile, ...PlanProfile[]]).default('custom'),
});

/**
 * One row of a hand-authored plan.
 *
 * The gateway is checked against the row's OWN subnet, not the parent: a row
 * whose gateway sits in a different subnet is the single most common structural
 * mistake in a spreadsheet-turned-plan.
 */
export const plannedSubnetFormSchema = z
  .object({
    id: z.string().min(1),
    name: planNameSchema,
    role: z.enum(NETWORK_ROLE_TUPLE as unknown as [NetworkRole, ...NetworkRole[]]),
    vlanId: optionalVlanIdSchema.optional(),
    cidr: subnetCidrSchema,
    gateway: z.string().optional(),
    requestedHosts: hostCountSchema,
    sortOrder: z.number().int().min(0).default(0),
  })
  .superRefine((value, ctx) => {
    if (isBlank(value.gateway)) return;
    reportField(gatewaySchema(value.cidr), value.gateway, ctx, ['gateway']);
  });

/**
 * A whole plan: every subnet inside the parent, and no two overlapping.
 *
 * Overlap is checked here rather than left to the engine because a hand-authored
 * plan is not packed by `packVLSM`; the planner validates the user's own
 * subnets, and two of them claiming the same addresses is the failure that
 * would otherwise ship.
 */
export const planSubnetsSchema = z
  .object({
    parentCidr: cidrSchema,
    subnets: z.array(plannedSubnetFormSchema),
  })
  .superRefine((value, ctx) => {
    // parentCidr has already been through cidrSchema, so it is a Cidr here, not
    // a string. No second parse, and no way for the two to disagree.
    const parent = value.parentCidr;

    value.subnets.forEach((subnet, index) => {
      if (!isWithin(subnet.cidr, parent)) {
        ctx.addIssue({
          code: 'custom',
          path: ['subnets', index, 'cidr'],
          message: `${formatCidr(subnet.cidr)} is not inside ${formatCidr(parent)}.`,
        });
      }
    });

    for (let i = 0; i < value.subnets.length; i += 1) {
      for (let j = i + 1; j < value.subnets.length; j += 1) {
        const a = value.subnets[i];
        const b = value.subnets[j];
        if (!a || !b) continue;
        if (subnetsOverlap(a.cidr, b.cidr)) {
          ctx.addIssue({
            code: 'custom',
            path: ['subnets', j, 'cidr'],
            message: new SubnetOverlapError(formatCidr(a.cidr), formatCidr(b.cidr)).friendlyMessage,
          });
        }
      }
    }
  });

/* ================================================================== *
 * Helpers
 * ================================================================== */

let requirementCounter = 0;

/**
 * Monotonic id for a requirement that arrived without one.
 *
 * Module-scoped rather than random so a form re-validation produces a stable
 * result and a failing test is reproducible. The persistence layer replaces
 * these with real primary keys.
 */
const nextRequirementId = (): string => {
  requirementCounter += 1;
  return `req-${requirementCounter}`;
};

/** Two subnets overlap unless one contains the other... which is still an overlap. */
const subnetsOverlap = (a: Cidr, b: Cidr): boolean => {
  const sizeA = 2 ** (32 - a.prefix);
  const sizeB = 2 ** (32 - b.prefix);
  const startA = Math.floor(a.ip / sizeA) * sizeA;
  const startB = Math.floor(b.ip / sizeB) * sizeB;
  return startA < startB + sizeB && startB < startA + sizeA;
};

/* ================================================================== *
 * Type helpers
 * ================================================================== */

/** Inferred output types, for the screens that consume these schemas. */
export type Ipv4Input = z.input<typeof ipv4Schema>;
export type CidrInput = z.input<typeof cidrSchema>;
export type PlanFormValues = z.input<typeof planFormSchema>;
export type PlanFormOutput = z.output<typeof planFormSchema>;
export type VlsmPlanInput = z.input<typeof vlsmPlanSchema>;

/** Re-exported so a form can branch on a failure without importing errors.ts. */
export type { NetArchitectError };
export { InvalidGatewayError, InvalidHostCountError, InvalidVLANError, SubnetOverlapError };
