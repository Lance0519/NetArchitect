/**
 * Structured error types.
 *
 * NetArchitect must never crash on bad network input. Every failure mode in the
 * engine and the validation layer raises a typed error that carries a stable
 * machine-readable `code` and a `friendlyMessage` that is safe to show a user
 * verbatim in the UI.
 *
 * Engine functions THROW (they are called from pure code where returning a union
 * would force every call site to unwrap). The UI never calls the engine directly
 * with unvalidated input, so in practice these are caught at the validation
 * boundary and rendered as an inline message.
 */

/** Stable, machine-readable error identifiers. Safe to switch on. */
export type NetArchitectErrorCode =
  | 'INVALID_IPV4'
  | 'INVALID_CIDR'
  | 'INVALID_PREFIX'
  | 'INVALID_SUBNET_BOUNDARY'
  | 'SCOPE_EXHAUSTION'
  | 'SUBNET_OVERLAP'
  | 'INVALID_VLAN'
  | 'INVALID_GATEWAY'
  | 'UNSUPPORTED_FAMILY'
  | 'INVALID_HOST_COUNT';

/**
 * Base class for all NetArchitect errors.
 *
 * `setPrototypeOf` is explicit because `class X extends Error` silently breaks
 * `instanceof` when TypeScript downlevels to ES5. Expo/Hermes does not need it,
 * but the app also runs through Jest/Vitest transforms where target settings can
 * drift, and a broken `instanceof` here would be extremely hard to debug.
 */
export class NetArchitectError extends Error {
  readonly code: NetArchitectErrorCode;
  readonly friendlyMessage: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: NetArchitectErrorCode,
    friendlyMessage: string,
    details: Record<string, unknown> = {},
  ) {
    super(friendlyMessage);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = new.target.name;
    this.code = code;
    this.friendlyMessage = friendlyMessage;
    this.details = Object.freeze({ ...details });
  }
}

/** Thrown when a string is not a syntactically valid dotted-quad IPv4 address. */
export class InvalidIPv4Error extends NetArchitectError {
  constructor(input: string, reason = 'not a dotted-quad IPv4 address') {
    super('INVALID_IPV4', 'Enter a valid IPv4 address.', { input, reason });
  }
}

/** Thrown when CIDR notation is malformed, e.g. `192.168.1.0/33` or `192.168.1.0/`. */
export class InvalidCIDRError extends NetArchitectError {
  constructor(input: string, reason = 'malformed CIDR notation') {
    super('INVALID_CIDR', 'Enter a valid CIDR block, for example 192.168.1.0/24.', {
      input,
      reason,
    });
  }
}

/** Thrown when a prefix length is not an integer in the range 0-32. */
export class InvalidPrefixError extends NetArchitectError {
  constructor(prefix: unknown) {
    super('INVALID_PREFIX', 'CIDR must be between /0 and /32.', { prefix });
  }
}

/**
 * Thrown when an address used as a *subnet definition* has host bits set.
 *
 * `192.168.1.50/24` is a valid CIDR *reference* (an address within a network) but
 * an invalid subnet *definition*. A planner row describing a subnet must be
 * `192.168.1.0/24`.
 */
export class InvalidSubnetBoundaryError extends NetArchitectError {
  constructor(input: string, networkAddress: string) {
    super(
      'INVALID_SUBNET_BOUNDARY',
      `${input} is not a network address. Use ${networkAddress} instead.`,
      { input, networkAddress },
    );
  }
}

/**
 * Why a pack ran out of address space.
 *
 * These are different problems with different fixes, so the UI must not
 * conflate them.
 *
 * - `INSUFFICIENT_TOTAL`  the requirements need more addresses than the parent
 *   holds. Fix by enlarging the parent, or by shrinking a requirement.
 * - `ALIGNMENT_FRAGMENTATION` the requirements add up to less than the parent,
 *   but the blocks cannot be tiled into it: some block has to start on its own
 *   boundary, and the addresses below that boundary are stranded. Fix by
 *   changing a block size, which usually means changing a host count by one.
 */
export type ScopeExhaustionReason = 'INSUFFICIENT_TOTAL' | 'ALIGNMENT_FRAGMENTATION';

/**
 * Thrown when a set of requirements cannot fit inside the parent network.
 *
 * Carries more than "it did not fit".
 *
 * Note on `availableAddresses`: for power-of-two blocks inside a power-of-two
 * aligned parent, an aligned sub-block either fits entirely or does not fit at
 * all, so this figure is 0 on a fragmentation failure. The `ALIGNMENT_FRAGMENTATION`
 * reason is what actually explains it, and `shortfallAddresses` is what the UI
 * needs to suggest a concrete change.
 */
export class ScopeExhaustionError extends NetArchitectError {
  constructor(
    name: string | null,
    requestedHosts: number,
    requiredAddresses: number,
    availableAddresses: number,
    reason: ScopeExhaustionReason = 'ALIGNMENT_FRAGMENTATION',
  ) {
    super('SCOPE_EXHAUSTION', 'Not enough address space for these requirements.', {
      // null when no single requirement is at fault, which is the signature of
      // a total shortfall rather than one oversized block.
      name,
      requestedHosts,
      requiredAddresses,
      availableAddresses,
      shortfallAddresses: Math.max(0, requiredAddresses - availableAddresses),
      reason,
    });
  }
}

/** Thrown when two allocations claim overlapping address space. */
export class SubnetOverlapError extends NetArchitectError {
  constructor(a: string, b: string) {
    super('SUBNET_OVERLAP', `${a} overlaps ${b}.`, { a, b });
  }
}

/** Thrown when a VLAN ID is outside the IEEE 802.1Q valid range of 1-4094. */
export class InvalidVLANError extends NetArchitectError {
  constructor(vlanId: unknown) {
    super('INVALID_VLAN', 'VLAN ID must be between 1 and 4094 (0 and 4095 are reserved).', {
      vlanId,
    });
  }
}

/**
 * Thrown when a gateway is not a valid host address inside its own subnet.
 * A gateway may not be the network address or the broadcast address: RFC 1812
 * requires routers to drop datagrams with a broadcast destination, and the
 * network address of a subnet is not assignable to an interface.
 */
export class InvalidGatewayError extends NetArchitectError {
  constructor(gateway: string, subnet: string, reason: string) {
    super('INVALID_GATEWAY', reason, { gateway, subnet });
  }
}

/** Thrown when a non-IPv4 family is encountered. v1 ships IPv4 only. */
export class UnsupportedFamilyError extends NetArchitectError {
  constructor(family: string) {
    super(
      'UNSUPPORTED_FAMILY',
      `IPv4 is the only supported address family in this version. "${family}" is not supported.`,
      {
        family,
      },
    );
  }
}

/**
 * Thrown when a host requirement is not a positive integer within IPv4 capacity.
 *
 * The default message is the spec's pinned copy. A count that is too *large* is
 * a different mistake and gets its own wording, because telling someone who
 * asked for 5 billion hosts that their value "must be greater than 0" is
 * technically true and practically useless.
 */
export class InvalidHostCountError extends NetArchitectError {
  constructor(
    value: unknown,
    reason = 'not a positive integer',
    friendlyMessage = 'Required hosts must be greater than 0.',
  ) {
    super('INVALID_HOST_COUNT', friendlyMessage, { value, reason });
  }
}

/** Type guard for NetArchitect errors across module/realm boundaries. */
export const isNetArchitectError = (value: unknown): value is NetArchitectError =>
  value instanceof NetArchitectError;
