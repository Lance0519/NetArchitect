/**
 * Network role metadata.
 *
 * PURE MODULE. No React, no React Native, no Expo.
 *
 * ## Why this table exists, and why it lives here
 *
 * `RoleDefinition` has been declared in `src/types/network.ts` since Phase 1, and until
 * now nothing in the project provided an instance of it. The role list itself was a
 * private array inside `validation.ts`, which is the right place for a list a Zod
 * enum needs and the wrong place for the thing a picker, a summary card and an auditor
 * all need to read. Four copies of the same nine roles would drift.
 *
 * So this file owns both, and `validation.ts` imports the list from here rather than
 * keeping its own. `src/core/` is the right home because the security auditor, the
 * planner and the VLSM engine are all engine-adjacent consumers, and none of them is a
 * component.
 *
 * ## The three booleans are not decoration
 *
 * `isUntrusted`, `isServiceFacing` and `expectsVlan` are the inputs the Phase 11 auditor
 * reasons over. Putting them in the type from the start rather than inferring them later
 * from the role string is what stops a rule like "guest traffic must not be routable to
 * corporate" from being written as a chain of string comparisons.
 *
 * ## Labels are user-facing copy
 *
 * Every `label` is asserted verbatim in `tests/roles.test.ts`. A role label is a product
 * decision - it appears in a picker, a table header, a summary card and a VLAN badge -
 * so a change to one should be a deliberate edit rather than a side effect of a
 * refactor.
 */

import type { NetworkRole, RoleDefinition } from '../types/network';

/**
 * Every role, in the order a picker should show them.
 *
 * The order is grouped by intent rather than alphabetically: trusted and user-facing
 * first, then infrastructure, then the roles that exist to be isolated. A list sorted by
 * name would put DMZ between GUEST and IOT and read as arbitrary to anyone who knows the
 * domain.
 */
export const NETWORK_ROLES: readonly NetworkRole[] = Object.freeze([
  'LAN',
  'SERVERS',
  'MANAGEMENT',
  'VOIP',
  'IOT',
  'GUEST',
  'DMZ',
  'POINT_TO_POINT',
  'CUSTOM',
]);

/**
 * The canonical role list as a non-empty tuple.
 *
 * `z.enum` needs a mutable `[A, ...A[]]`, so a frozen `readonly NetworkRole[]` will not
 * typecheck against it directly. Exposing the tuple here means the cast lives in one
 * place, in a file whose job is to be the source of truth, instead of at each call site.
 */
export const NETWORK_ROLE_TUPLE = NETWORK_ROLES as unknown as readonly [
  NetworkRole,
  ...NetworkRole[],
];

/** Metadata for one role. */
export const ROLE_DEFINITION_BY_ROLE: Readonly<Record<NetworkRole, RoleDefinition>> =
  Object.freeze({
    LAN: {
      role: 'LAN',
      label: 'LAN',
      description: 'General-purpose internal network for ordinary endpoints.',
      icon: 'network',
      expectsVlan: true,
      isUntrusted: false,
      isServiceFacing: false,
      guidance:
        'Standard internal segmentation. Hosts here may reach the gateway and routed networks, so keep this separate from guest and IoT traffic.',
    },
    SERVERS: {
      role: 'SERVERS',
      label: 'Servers',
      description: 'Systems that provide services to other subnets.',
      icon: 'server',
      expectsVlan: true,
      isUntrusted: false,
      isServiceFacing: true,
      guidance:
        'Size for headroom rather than current count: capacity here is consumed by virtual machines, containers and replication, all of which are planned after the subnet is carved.',
    },
    MANAGEMENT: {
      role: 'MANAGEMENT',
      label: 'Management',
      description: 'Out-of-band access to infrastructure: switches, routers, hypervisors.',
      icon: 'terminal',
      expectsVlan: true,
      isUntrusted: false,
      isServiceFacing: false,
      guidance:
        'Keep this small and reachable from an operator network only. Access to device management interfaces should come from a jump host on this subnet, never from a user LAN.',
    },
    VOIP: {
      role: 'VOIP',
      label: 'VoIP',
      description: 'IP phones and the voice gateway.',
      icon: 'phone',
      expectsVlan: true,
      isUntrusted: false,
      isServiceFacing: false,
      guidance:
        'Phones need LLDP-MED, DHCP options and QoS marking to work. Give the voice VLAN priority over the user LAN, and remember the one-address-per-phone rule when sizing it.',
    },
    IOT: {
      role: 'IOT',
      label: 'IoT',
      description: 'Embedded devices: sensors, printers, cameras, hubs.',
      icon: 'cpu',
      expectsVlan: true,
      // Untrusted in practice even when the owner believes otherwise. A compromised
      // consumer device is the most common lateral-movement starting point, and the
      // cheapest mitigation available is a separate broadcast domain.
      isUntrusted: true,
      isServiceFacing: false,
      guidance:
        'Assume these devices are not trustworthy: many have no update path and ship with default credentials. Segregate them onto their own subnet, and do not let them initiate traffic to user networks.',
    },
    GUEST: {
      role: 'GUEST',
      label: 'Guest',
      description: 'Unauthenticated visitors. Internet-only, isolated from everything internal.',
      icon: 'users',
      expectsVlan: true,
      isUntrusted: true,
      isServiceFacing: false,
      guidance:
        'Guest traffic should reach the internet and nothing else. Client isolation and a deny-any internal rule are the two controls that matter, and both are a function of being on a separate subnet rather than of any setting on the guest SSID.',
    },
    DMZ: {
      role: 'DMZ',
      label: 'DMZ',
      description: 'Internet-facing services, reachable from outside and hardened.',
      icon: 'shield',
      expectsVlan: true,
      isUntrusted: false,
      isServiceFacing: true,
      guidance:
        'The only subnet that should be directly reachable from the internet. Permit inbound only to the specific published ports, and never let the DMZ initiate a connection to a trusted subnet - that rule is what contains a compromised web server.',
    },
    POINT_TO_POINT: {
      role: 'POINT_TO_POINT',
      label: 'Point to point',
      description: 'A single link between two devices.',
      icon: 'link',
      // Untagged links are the norm for router-to-router and WAN circuits, so requiring a
      // VLAN ID here would be asking for a value that has no meaning.
      expectsVlan: false,
      isUntrusted: false,
      isServiceFacing: false,
      guidance:
        'A /31 under RFC 3021, where both addresses are usable. Sizing this as a LAN would reserve two of four addresses for nothing; sizing it as a /30 by habit is the most common VLSM error in a plan.',
    },
    CUSTOM: {
      role: 'CUSTOM',
      label: 'Custom',
      description: 'A role you define yourself. Carries a label you supply.',
      icon: 'tag',
      expectsVlan: true,
      // Deliberately untrusted. A role the project has never seen cannot be vouched for,
      // so it is treated as needing isolation until the person defining it says
      // otherwise. The alternative - defaulting to trusted - makes a typo silently
      // exempt a subnet from every rule that depends on trust.
      isUntrusted: true,
      isServiceFacing: false,
      guidance:
        'Until you describe what this subnet is, NetArchitect treats it as untrusted: no routed access from user networks, and no inbound from the internet. Change that only once you know what is on it.',
    },
  } satisfies Record<NetworkRole, RoleDefinition>);

/** The label for a role, or the role itself if the key is somehow absent. */
export const roleLabel = (role: NetworkRole): string => ROLE_DEFINITION_BY_ROLE[role].label;

/**
 * Whether a role should be packed as an RFC 3021 point-to-point link.
 *
 * This is the single implementation. `vlsm-engine.ts` imports it rather than keeping its
 * own copy, because this is role *semantics* - it belongs beside the table that defines
 * what the roles mean - and because a second copy is a second answer. An earlier version
 * of this file documented itself as re-exporting the engine's copy while actually
 * duplicating it, which is the kind of drift that only shows up when a /31 stops being
 * the right size and nobody can tell which of the two rules is stale.
 */
export const isPointToPointRole = (role: NetworkRole): boolean => role === 'POINT_TO_POINT';
