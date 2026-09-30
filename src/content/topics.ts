/**
 * Learning Mode topics.
 *
 * Written as data, not JSX, so the content can be rendered by any UI and
 * tested without a component tree. Each topic has a title, 3–6 short
 * sections, a worked example, and 2–3 takeaways.
 *
 * The goal is to teach the same math the engine implements, so every
 * worked example is verified against the engine's own calculations.
 */

export interface TopicSection {
  readonly heading: string;
  readonly body: string;
}

export interface WorkedExample {
  readonly title: string;
  readonly problem: string;
  readonly steps: readonly string[];
  readonly answer: string;
}

export interface Topic {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly sections: readonly TopicSection[];
  readonly workedExample: WorkedExample;
  readonly takeaways: readonly string[];
}

export const TOPICS: readonly Topic[] = Object.freeze([
  {
    id: 'ipv4-addressing',
    title: 'IPv4 Addressing',
    description: 'What an IPv4 address is and how it is structured.',
    sections: [
      {
        heading: 'The 32-bit address',
        body: 'An IPv4 address is a 32-bit number, written as four octets separated by dots (e.g. 192.168.1.1). Each octet is 8 bits, so four octets × 8 bits = 32 bits. The maximum value is 255.255.255.255.',
      },
      {
        heading: 'Network and host portions',
        body: 'Every IPv4 address has two parts: a network portion (which network it belongs to) and a host portion (which device on that network). The boundary between them is determined by the subnet mask or prefix length.',
      },
      {
        heading: 'Why 2^32 matters',
        body: 'There are 2^32 = 4,294,967,296 possible IPv4 addresses. This finite pool is why efficient allocation matters — wasting addresses means running out.',
      },
    ],
    workedExample: {
      title: 'Identifying the network portion',
      problem: 'Given 192.168.1.50/24, what is the network address?',
      steps: [
        'The /24 prefix means the first 24 bits are the network portion.',
        'The first three octets (192.168.1) are the network part.',
        'The last octet (50) is the host part.',
        'The network address is 192.168.1.0.',
      ],
      answer: '192.168.1.0',
    },
    takeaways: [
      'An IPv4 address is 32 bits, written as four octets.',
      'The prefix length determines how many bits are the network portion.',
      'The network address has all host bits set to zero.',
    ],
  },
  {
    id: 'cidr',
    title: 'CIDR Notation',
    description: 'Classless Inter-Domain Routing and prefix lengths.',
    sections: [
      {
        heading: 'What CIDR means',
        body: 'CIDR (Classless Inter-Domain Routing) is a method for allocating IP addresses and routing IP packets. It replaces the older class-based system (Class A, B, C) with a flexible prefix length.',
      },
      {
        heading: 'The slash notation',
        body: 'A CIDR block is written as an IP address followed by a slash and a number (e.g. 10.0.0.0/8). The number is the prefix length — how many bits are the network portion. /8 means 8 bits, /24 means 24 bits.',
      },
      {
        heading: 'Why classless matters',
        body: 'In the old class system, a network was always /8, /16, or /24. CIDR allows any prefix length, so you can allocate exactly the size you need — no more, no less.',
      },
    ],
    workedExample: {
      title: 'Calculating the address count',
      problem: 'How many addresses are in 10.0.0.0/22?',
      steps: [
        'The prefix is 22, so the host portion is 32 - 22 = 10 bits.',
        'The number of addresses is 2^10 = 1024.',
        'The range is 10.0.0.0 to 10.0.3.255.',
      ],
      answer: '1024 addresses',
    },
    takeaways: [
      'CIDR replaces the rigid class system with flexible prefix lengths.',
      'The prefix length is the number of network bits.',
      'Address count = 2^(32 - prefix).',
    ],
  },
  {
    id: 'subnet-masks',
    title: 'Subnet Masks',
    description: 'How subnet masks define the network boundary.',
    sections: [
      {
        heading: 'The mask as a bit pattern',
        body: 'A subnet mask is a 32-bit number where the network bits are 1 and the host bits are 0. For /24, the mask is 255.255.255.0 — three octets of 1s (255) and one octet of 0s.',
      },
      {
        heading: 'Network address calculation',
        body: 'To find the network address, perform a bitwise AND between the IP address and the subnet mask. This zeros out the host bits, leaving only the network portion.',
      },
      {
        heading: 'Common masks',
        body: '/8 = 255.0.0.0, /16 = 255.255.0.0, /24 = 255.255.255.0, /25 = 255.255.255.128, /26 = 255.255.255.192. Each step doubles or halves the network size.',
      },
    ],
    workedExample: {
      title: 'Finding the network address',
      problem: 'What is the network address of 172.16.45.200/20?',
      steps: [
        'The /20 mask is 255.255.240.0.',
        'Perform bitwise AND: 172.16.45.200 AND 255.255.240.0.',
        'The third octet: 45 AND 240 = 32 (binary: 00101101 AND 11110000 = 00110000).',
        'The network address is 172.16.32.0.',
      ],
      answer: '172.16.32.0',
    },
    takeaways: [
      'A subnet mask is all 1s for the network, all 0s for the host.',
      'Network address = IP AND mask.',
      'Each prefix step doubles or halves the network size.',
    ],
  },
  {
    id: 'wildcard-masks',
    title: 'Wildcard Masks',
    description: 'The inverse of the subnet mask, used in ACLs and routing.',
    sections: [
      {
        heading: 'What a wildcard mask is',
        body: 'A wildcard mask is the bitwise inverse of a subnet mask. Where the subnet mask has 1s, the wildcard has 0s, and vice versa. It is used in access control lists (ACLs) and OSPF network statements.',
      },
      {
        heading: 'Calculating the wildcard',
        body: 'Subtract the subnet mask from 255.255.255.255. For /24 (255.255.255.0), the wildcard is 0.0.0.255. For /25 (255.255.255.128), the wildcard is 0.0.0.127.',
      },
      {
        heading: 'Why wildcards are useful',
        body: 'Wildcard masks allow matching ranges of addresses. A wildcard of 0.0.0.255 matches any address in the last octet, which is useful for "allow any host on this network" rules.',
      },
    ],
    workedExample: {
      title: 'Calculating a wildcard mask',
      problem: 'What is the wildcard mask for /26?',
      steps: [
        'The /26 subnet mask is 255.255.255.192.',
        'Subtract from 255.255.255.255: 255.255.255.255 - 255.255.255.192 = 0.0.0.63.',
        'The wildcard mask is 0.0.0.63.',
      ],
      answer: '0.0.0.63',
    },
    takeaways: [
      'A wildcard mask is the inverse of the subnet mask.',
      'Wildcard = 255.255.255.255 - subnet mask.',
      'Wildcards are used in ACLs and routing protocols.',
    ],
  },
  {
    id: 'network-broadcast',
    title: 'Network & Broadcast Addresses',
    description: 'The two special addresses in every subnet.',
    sections: [
      {
        heading: 'The network address',
        body: 'The network address is the first address in a subnet. All host bits are 0. It identifies the network itself and cannot be assigned to a host.',
      },
      {
        heading: 'The broadcast address',
        body: 'The broadcast address is the last address in a subnet. All host bits are 1. It is used to send traffic to all hosts on the network and cannot be assigned to a host.',
      },
      {
        heading: 'Usable hosts',
        body: 'The usable host addresses are all addresses between the network and broadcast addresses. For a /24, that is 256 - 2 = 254 usable hosts.',
      },
    ],
    workedExample: {
      title: 'Finding the broadcast address',
      problem: 'What is the broadcast address of 192.168.1.0/26?',
      steps: [
        'A /26 has 64 addresses (2^6).',
        'The network address is 192.168.1.0.',
        'The broadcast address is 192.168.1.0 + 63 = 192.168.1.63.',
        'The usable range is 192.168.1.1 to 192.168.1.62.',
      ],
      answer: '192.168.1.63',
    },
    takeaways: [
      'Network address = all host bits 0.',
      'Broadcast address = all host bits 1.',
      'Usable hosts = total addresses - 2.',
    ],
  },
  {
    id: 'usable-hosts',
    title: 'Usable Hosts',
    description: 'How many devices can connect to a subnet.',
    sections: [
      {
        heading: 'The formula',
        body: 'Usable hosts = 2^(32 - prefix) - 2. The -2 accounts for the network and broadcast addresses, which cannot be assigned to hosts.',
      },
      {
        heading: 'Special cases: /31 and /32',
        body: 'A /31 has 2 usable addresses (RFC 3021 point-to-point links). A /32 has 1 usable address (host route). These are exceptions to the -2 rule.',
      },
      {
        heading: 'Why this matters',
        body: 'When designing a network, you must ensure the subnet has enough usable hosts for all devices. A /29 (6 usable) is fine for a small office but not for a department of 20.',
      },
    ],
    workedExample: {
      title: 'Calculating usable hosts',
      problem: 'How many usable hosts are in 10.0.0.0/28?',
      steps: [
        'The prefix is 28, so host bits = 32 - 28 = 4.',
        'Total addresses = 2^4 = 16.',
        'Usable hosts = 16 - 2 = 14.',
      ],
      answer: '14 usable hosts',
    },
    takeaways: [
      'Usable hosts = 2^(32 - prefix) - 2.',
      '/31 and /32 are special cases.',
      'Always size subnets for the number of devices, plus growth.',
    ],
  },
  {
    id: 'vlsm',
    title: 'VLSM',
    description: 'Variable Length Subnet Masking for efficient allocation.',
    sections: [
      {
        heading: 'What VLSM solves',
        body: 'VLSM allows different subnets to have different prefix lengths. Without VLSM, every subnet must be the same size, which wastes addresses when subnets have different host requirements.',
      },
      {
        heading: 'The allocation order',
        body: 'Always allocate the largest subnet first. This prevents fragmentation — if you allocate small subnets first, the remaining space may not be contiguous enough for a large subnet.',
      },
      {
        heading: 'Alignment matters',
        body: 'Each subnet must start on a boundary that is a multiple of its size. A /25 (128 addresses) must start at .0 or .128 in the last octet. Misaligned subnets cause routing failures.',
      },
    ],
    workedExample: {
      title: 'Allocating with VLSM',
      problem: 'Allocate subnets for 100, 50, and 10 hosts from 192.168.1.0/24.',
      steps: [
        '100 hosts need /25 (126 usable). Allocate 192.168.1.0/25.',
        '50 hosts need /26 (62 usable). Allocate 192.168.1.128/26.',
        '10 hosts need /28 (14 usable). Allocate 192.168.1.192/28.',
        'Remaining: 192.168.1.208/28 (16 addresses).',
      ],
      answer: '192.168.1.0/25, 192.168.1.128/26, 192.168.1.192/28',
    },
    takeaways: [
      'VLSM allows different subnet sizes in the same network.',
      'Always allocate largest first.',
      'Each subnet must be aligned to its size boundary.',
    ],
  },
  {
    id: 'vlans',
    title: 'VLANs',
    description: 'Virtual LANs for broadcast domain segmentation.',
    sections: [
      {
        heading: 'What a VLAN is',
        body: 'A VLAN (Virtual LAN) is a logical grouping of network devices that appear to be on the same LAN regardless of their physical location. Each VLAN is a separate broadcast domain.',
      },
      {
        heading: 'VLAN IDs',
        body: 'VLANs are identified by a 12-bit VLAN ID (1–4094). VID 0 is reserved for priority tagging, and VID 4095 is reserved. The valid range is 1–4094.',
      },
      {
        heading: 'Why VLANs matter',
        body: 'Without VLANs, all devices on a switch share one broadcast domain. VLANs allow segmentation — separating guest, IoT, and corporate traffic without separate physical switches.',
      },
    ],
    workedExample: {
      title: 'Assigning VLAN IDs',
      problem: 'Assign VLAN IDs to Corporate (100 hosts), Guest (50 hosts), and IoT (20 hosts).',
      steps: [
        'Corporate: VLAN 10, subnet 192.168.10.0/25.',
        'Guest: VLAN 20, subnet 192.168.20.0/26.',
        'IoT: VLAN 30, subnet 192.168.30.0/27.',
        'Each VLAN is a separate broadcast domain and subnet.',
      ],
      answer: 'VLAN 10, 20, 30 with corresponding subnets',
    },
    takeaways: [
      'Each VLAN is a separate broadcast domain.',
      'Valid VLAN IDs are 1–4094.',
      'VLANs enable logical segmentation without physical separation.',
    ],
  },
  {
    id: 'segmentation',
    title: 'Network Segmentation',
    description: 'Dividing a network for security and performance.',
    sections: [
      {
        heading: 'The security case',
        body: 'Segmentation limits the blast radius of a breach. If a guest device is compromised, segmentation prevents the attacker from reaching corporate servers or management interfaces.',
      },
      {
        heading: 'The performance case',
        body: 'Broadcast traffic is limited to the segment. A /24 with 200 devices generates significant broadcast traffic; splitting it into four /26 segments reduces broadcast load by 75%.',
      },
      {
        heading: 'Common patterns',
        body: 'Typical segmentation: corporate LAN, guest WiFi, IoT, servers, management, and DMZ. Each has its own subnet and VLAN, with firewall rules controlling traffic between them.',
      },
    ],
    workedExample: {
      title: 'Designing segments',
      problem: 'Segment a /24 for 150 corporate, 50 guest, and 20 IoT devices.',
      steps: [
        'Corporate: 150 hosts need /24 (254 usable). Use 192.168.1.0/24.',
        'Guest: 50 hosts need /26 (62 usable). Use 192.168.2.0/26.',
        'IoT: 20 hosts need /27 (30 usable). Use 192.168.2.64/27.',
        'Each segment is a separate VLAN and subnet.',
      ],
      answer: 'Three segments: /24, /26, /27',
    },
    takeaways: [
      'Segmentation limits blast radius and broadcast traffic.',
      'Each segment is a separate subnet and VLAN.',
      'Firewall rules control inter-segment traffic.',
    ],
  },
  {
    id: 'rfc1918-bogons',
    title: 'RFC 1918 & Bogon Filtering',
    description: 'Private address ranges, unallocated blocks, and edge security filtering.',
    sections: [
      {
        heading: 'The three RFC 1918 blocks',
        body: 'RFC 1918 reserves three private address spaces: 10.0.0.0/8 (16.7M hosts for large enterprise intranets), 172.16.0.0/12 (1M hosts spanning sixteen contiguous /16 blocks from 172.16.0.0 to 172.31.255.255), and 192.168.0.0/16 (65,536 hosts spanning 256 /24 blocks).',
      },
      {
        heading: 'What is a Bogon?',
        body: 'A bogon prefix is an IP address block that should never appear in the public Internet routing table. Bogons include unallocated IANA address blocks and reserved spaces (RFC 1918 private, Carrier-Grade NAT 100.64.0.0/10 per RFC 6598, loopback 127.0.0.0/8, APIPA 169.254.0.0/16, and multicast 224.0.0.0/4).',
      },
      {
        heading: 'Perimeter filtering & spoofing prevention',
        body: 'Because private and reserved addresses cannot be routed across the public Internet, any packet with a bogon source address entering an external WAN interface is spoofed or misconfigured. Edge firewalls must filter bogons both inbound and outbound to prevent IP spoofing attacks and route leakage.',
      },
    ],
    workedExample: {
      title: 'Classifying Bogon & Private Traffic',
      problem: 'A border router receives packets from 172.24.5.10, 100.64.1.20, and 8.8.8.8 on its external WAN. Which must be blocked?',
      steps: [
        '172.24.5.10 falls inside 172.16.0.0/12 (172.16.0.0 - 172.31.255.255). It is RFC 1918 private space and must be dropped.',
        '100.64.1.20 falls inside 100.64.0.0/10 (RFC 6598 Shared Carrier-Grade NAT). It is non-routable on the public Internet and must be dropped.',
        '8.8.8.8 is a globally routable public unicast address (Google Public DNS) and is permitted.',
      ],
      answer: 'Drop 172.24.5.10 (RFC 1918) and 100.64.1.20 (RFC 6598); permit 8.8.8.8.',
    },
    takeaways: [
      'RFC 1918 specifies 10.0.0.0/8, 172.16.0.0/12, and 192.168.0.0/16 for private LANs.',
      'Bogons are addresses that should never be seen or routed on the public Internet.',
      'Edge firewalls must drop bogon traffic to protect against IP spoofing.',
    ],
  },
  {
    id: 'rfc3021-links',
    title: 'RFC 3021: /31 Point-to-Point Links',
    description: 'Conserving IPv4 address space on router-to-router point-to-point connections.',
    sections: [
      {
        heading: 'The waste of /30 subnets',
        body: 'Historically, point-to-point router links used /30 subnets (4 addresses). However, 2 addresses were lost to network and broadcast overhead (255.255.255.252), meaning 50% of allocated addresses were wasted on every inter-router link.',
      },
      {
        heading: 'The RFC 3021 standard',
        body: 'RFC 3021 defines 31-bit subnet masks (255.255.255.254) for point-to-point links. With only two nodes on the wire, directed broadcast is unnecessary. Both addresses (Host 0 and Host 1) are treated as fully usable host addresses.',
      },
      {
        heading: 'Operational requirements',
        body: 'Both router interfaces must support RFC 3021. Cisco IOS, JunOS, Linux, and modern appliances support /31 natively. For an enterprise with dozens of point-to-point WAN links, migrating from /30 to /31 cuts IPv4 address consumption in half.',
      },
    ],
    workedExample: {
      title: 'Configuring a /31 Point-to-Point Link',
      problem: 'Assign addresses from 10.1.1.0/31 to a serial link between Router 1 and Router 2.',
      steps: [
        'The /31 subnet mask is 255.255.255.254.',
        'The block contains exactly 2 addresses: 10.1.1.0 and 10.1.1.1.',
        'Per RFC 3021, there is no network or broadcast address overhead.',
        'Assign 10.1.1.0/31 to Router 1 and 10.1.1.1/31 to Router 2.',
      ],
      answer: 'Router 1: 10.1.1.0/31, Router 2: 10.1.1.1/31 (both usable hosts).',
    },
    takeaways: [
      'A /31 subnet has exactly 2 addresses and both are usable hosts.',
      'RFC 3021 eliminates the 50% address waste of traditional /30 links.',
      'Only applicable to point-to-point links with exactly two endpoints.',
    ],
  },
]);
