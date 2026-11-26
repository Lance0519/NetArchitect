/**
 * Question Generator for Learning Mode.
 *
 * Deterministic generators, not a random blob. Each generator produces a
 * 4-option question with plausible-but-wrong distractors in uniform format
 * and an explanation showing the arithmetic after submission.
 *
 * Every answer is verified against the engine, so a wrong engine key would
 * fail the test suite.
 */

import {
  calculateSubnet,
  cidrToMask,
  classifyAddressSpace,
  integerToIPv4,
  smallestBlockForHosts,
} from './ip-engine';
import { packVLSM } from './vlsm-engine';

export type QuestionType =
  | 'smallest-cidr'
  | 'subnet-from-ip'
  | 'classify-space'
  | 'compute-mask'
  | 'vlsm-allocation';

export interface Question {
  readonly type: QuestionType;
  readonly prompt: string;
  readonly options: readonly string[];
  readonly correctIndex: number;
  readonly explanation: string;
}

/** Seeded PRNG for deterministic question generation. */
function makeRandom(seed: number): () => number {
  let state = (Math.abs(Math.floor(seed)) || 1) & 0x7fffffff;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/** Generate a random integer in [min, max]. */
function randomInt(rand: () => number, min: number, max: number): number {
  if (max <= min) return min;
  return Math.floor(rand() * (max - min + 1)) + min;
}

/** Shuffle an array (Fisher-Yates). */
function shuffle<T>(arr: readonly T[], rand: () => number): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** Format a mask as dotted decimal. */
function formatMask(prefix: number): string {
  return integerToIPv4(cidrToMask(prefix));
}

/** Generate a "smallest CIDR for N hosts" question. */
export function generateSmallestCidrQuestion(seed: number): Question {
  const rand = makeRandom(seed);
  const hosts = randomInt(rand, 2, 200);
  const correctBits = smallestBlockForHosts(hosts, 2);
  const correctPrefix = 32 - correctBits;

  // Pick 3 distinct plausible adjacent prefixes in [23..32] so there are always 4 options.
  const candidates = [
    correctPrefix - 1,
    correctPrefix + 1,
    correctPrefix - 2,
    correctPrefix + 2,
    correctPrefix - 3,
  ].filter((p) => p >= 23 && p <= 32 && p !== correctPrefix);

  const distractors: number[] = [];
  for (const candidate of candidates) {
    if (!distractors.includes(candidate)) distractors.push(candidate);
    if (distractors.length === 3) break;
  }

  const options = shuffle([correctPrefix, ...distractors], rand);
  const correctIndex = options.indexOf(correctPrefix);

  const explanation =
    correctPrefix === 31
      ? `${hosts} hosts on a point-to-point link fit in a /31 per RFC 3021, which makes both addresses usable (no network/broadcast overhead). A /32 only provides 1 address.`
      : `${hosts} hosts need at least ${hosts} usable addresses. ` +
        `2^${correctBits} - 2 = ${2 ** correctBits - 2} >= ${hosts}, so /${correctPrefix} is the smallest. ` +
        `A /${correctPrefix + 1} would only provide ${correctPrefix + 1 === 31 ? 2 : Math.max(0, 2 ** (correctBits - 1) - 2)} usable addresses.`;

  return {
    type: 'smallest-cidr',
    prompt: `What is the smallest subnet that can hold ${hosts} hosts?`,
    options: options.map((p) => `/${p}`),
    correctIndex,
    explanation,
  };
}

/** Generate a "subnet from IP and prefix" question. */
export function generateSubnetFromIpQuestion(seed: number): Question {
  const rand = makeRandom(seed);
  const prefix = randomInt(rand, 24, 29);
  const hostBits = 32 - prefix;
  const blockSize = 2 ** hostBits;
  // Base inside 10.0.0.0/8 for clean realistic private addresses.
  const baseBlock = (0x0a000000 + randomInt(rand, 1, 200) * blockSize) >>> 0;
  // Choose an interior host (strictly between network and broadcast) so every distractor is unique.
  const hostOffset = randomInt(rand, 1, blockSize - 2);
  const ip = (baseBlock + hostOffset) >>> 0;

  const info = calculateSubnet(ip, prefix);
  const correctNetwork = integerToIPv4(info.networkAddress);

  const distractorPool = [
    integerToIPv4((baseBlock + blockSize) >>> 0), // next network
    integerToIPv4(ip), // the host IP itself
    integerToIPv4(info.broadcastAddress), // broadcast address
    integerToIPv4((baseBlock - blockSize) >>> 0), // previous network
  ].filter((addr) => addr !== correctNetwork);

  const uniqueDistractors = Array.from(new Set(distractorPool)).slice(0, 3);
  const options = shuffle([correctNetwork, ...uniqueDistractors], rand);
  const correctIndex = options.indexOf(correctNetwork);

  return {
    type: 'subnet-from-ip',
    prompt: `What is the network address of ${integerToIPv4(ip)}/${prefix}?`,
    options,
    correctIndex,
    explanation:
      `The /${prefix} mask is ${formatMask(prefix)}. ` +
      `Performing bitwise AND: ${integerToIPv4(ip)} AND ${formatMask(prefix)} = ${correctNetwork}. ` +
      `The network address has all host bits set to zero.`,
  };
}

/** Generate a "classify the address space" question. */
export function generateClassifySpaceQuestion(seed: number): Question {
  const rand = makeRandom(seed);

  const addresses = [
    { ip: '10.0.0.0' },
    { ip: '172.16.0.0' },
    { ip: '192.168.1.0' },
    { ip: '8.8.8.8' },
    { ip: '1.1.1.1' },
    { ip: '127.0.0.1' },
    { ip: '169.254.0.1' },
    { ip: '100.64.0.1' },
    { ip: '192.0.2.1' },
    { ip: '224.0.0.1' },
  ];

  const selected = addresses[randomInt(rand, 0, addresses.length - 1)]!;
  const classification = classifyAddressSpace(selected.ip);

  const answerMap: Record<string, string> = {
    private: 'RFC 1918 Private',
    public: 'Public',
    loopback: 'Loopback',
    link_local: 'Link-Local',
    this_network: 'This Network',
    cgnat: 'CGNAT',
    multicast: 'Multicast',
    reserved: 'Reserved',
    documentation: 'Documentation',
    benchmark: 'Benchmark',
    ietf_protocol_assignments: 'IETF Protocol',
  };

  const correctAnswer = answerMap[classification] ?? 'Unknown';

  const allAnswers = Object.values(answerMap);
  const distractors = shuffle(
    allAnswers.filter((a) => a !== correctAnswer),
    rand,
  ).slice(0, 3);

  const options = shuffle([correctAnswer, ...distractors], rand);
  const correctIndex = options.indexOf(correctAnswer);

  return {
    type: 'classify-space',
    prompt: `How is ${selected.ip} classified?`,
    options,
    correctIndex,
    explanation:
      `${selected.ip} is classified as ${correctAnswer}. ` +
      `This is determined by checking the IANA Special-Purpose Address Registry.`,
  };
}

/** Generate a "compute the mask" question. */
export function generateComputeMaskQuestion(seed: number): Question {
  const rand = makeRandom(seed);
  const prefix = randomInt(rand, 8, 30);
  const correctMask = formatMask(prefix);

  const distractorPrefixes = [prefix - 1, prefix + 1, prefix + 2, prefix - 2]
    .filter((p) => p >= 0 && p <= 32 && p !== prefix)
    .slice(0, 3);
  const options = shuffle([correctMask, ...distractorPrefixes.map(formatMask)], rand);
  const correctIndex = options.indexOf(correctMask);

  return {
    type: 'compute-mask',
    prompt: `What is the subnet mask for /${prefix}?`,
    options,
    correctIndex,
    explanation:
      `A /${prefix} prefix means ${prefix} network bits. ` +
      `The mask is ${correctMask}. ` +
      `Each octet of 8 bits contributes 255 if fully network, 0 if fully host, ` +
      `or a partial value for the boundary octet.`,
  };
}

/** Format a list of `(name, ip, prefix)` assignments uniformly for VLSM options. */
function formatVlsmAssignments(
  items: readonly { readonly name: string; readonly ip: number; readonly prefix: number }[],
): string {
  return items.map((item) => `${item.name}: ${integerToIPv4(item.ip)}/${item.prefix}`).join(', ');
}

/** Generate a "VLSM allocation" question guaranteed never to exhaust the parent block. */
export function generateVlsmAllocationQuestion(seed: number): Question {
  const rand = makeRandom(seed);
  // /23 (512) through /25 (128) gives plenty of space for 2-3 distinct-size subnets.
  const parentPrefix = randomInt(rand, 23, 25);
  const parentSize = 2 ** (32 - parentPrefix);
  const parentIp = (0x0a000000 + randomInt(rand, 1, 200) * parentSize) >>> 0;
  const parentCidr = `${integerToIPv4(parentIp)}/${parentPrefix}`;

  const count = randomInt(rand, 2, 3);
  const reqs: { readonly hosts: number; readonly name: string }[] = [];
  let remaining = parentSize;

  for (let i = 0; i < count; i += 1) {
    // Reserve at least 8 addresses (/29) for each remaining subnet so every power-of-2
    // block we pick is mathematically guaranteed to fit inside `parentSize`.
    const reserve = (count - 1 - i) * 8;
    const budget = remaining - reserve;
    // Largest power of two <= budget, capped at 128 (/25) for realistic drills.
    const maxBlock = Math.min(128, 2 ** Math.floor(Math.log2(Math.max(4, budget))));
    const maxHosts = Math.max(2, maxBlock - 2);
    const minHosts = maxBlock >= 8 ? 3 : 2;
    const hosts = randomInt(rand, minHosts, maxHosts);
    const bits = smallestBlockForHosts(hosts, 2);
    const blockSize = 2 ** bits;

    if (blockSize > remaining) break;
    reqs.push({ hosts, name: `Subnet ${i + 1}` });
    remaining -= blockSize;
  }

  // Run the engine to get the verified answer (always fits because sum(blockSize) <= parentSize).
  const result = packVLSM(
    parentCidr,
    reqs.map((r) => ({ id: r.name, name: r.name, requestedHosts: r.hosts, role: 'LAN' as const })),
  );

  const correctItems = result.allocations.map((a) => ({
    name: a.name,
    ip: a.subnet.networkAddress,
    prefix: a.subnet.cidr.prefix,
  }));
  const correctAnswer = formatVlsmAssignments(correctItems);

  // Build 3 plausible distractors in the EXACT SAME `<name>: <ip>/<prefix>` format:
  const distractorCandidates: string[] = [];

  // 1. Reversed / smallest-first order placed contiguously from parentIp (misaligned/wrong order).
  {
    const reversed = [...correctItems].reverse();
    let cursor = parentIp;
    const items = reversed.map((item) => {
      const entry = { name: item.name, ip: cursor, prefix: item.prefix };
      cursor = (cursor + 2 ** (32 - item.prefix)) >>> 0;
      return entry;
    });
    distractorCandidates.push(formatVlsmAssignments(items));
  }

  // 2. Oversized first subnet (prefix - 1) shifting subsequent blocks.
  {
    let cursor = parentIp;
    const items = correctItems.map((item, idx) => {
      const p = idx === 0 && item.prefix > parentPrefix ? item.prefix - 1 : item.prefix;
      const entry = { name: item.name, ip: cursor, prefix: p };
      cursor = (cursor + 2 ** (32 - p)) >>> 0;
      return entry;
    });
    distractorCandidates.push(formatVlsmAssignments(items));
  }

  // 3. Undersized first subnet (prefix + 1) shifting subsequent blocks.
  {
    let cursor = parentIp;
    const items = correctItems.map((item, idx) => {
      const p = idx === 0 && item.prefix < 30 ? item.prefix + 1 : item.prefix;
      const entry = { name: item.name, ip: cursor, prefix: p };
      cursor = (cursor + 2 ** (32 - p)) >>> 0;
      return entry;
    });
    distractorCandidates.push(formatVlsmAssignments(items));
  }

  // 4. Shifted second subnet (leaving a gap of one block).
  {
    const items = correctItems.map((item, idx) =>
      idx === 1
        ? {
            name: item.name,
            ip: (item.ip + 2 ** (32 - item.prefix)) >>> 0,
            prefix: item.prefix,
          }
        : item,
    );
    distractorCandidates.push(formatVlsmAssignments(items));
  }

  // 5. Fallback: bump last subnet prefix by +1 if any earlier candidates collided.
  {
    const items = correctItems.map((item, idx) =>
      idx === correctItems.length - 1
        ? { name: item.name, ip: item.ip, prefix: item.prefix < 30 ? item.prefix + 1 : item.prefix - 1 }
        : item,
    );
    distractorCandidates.push(formatVlsmAssignments(items));
  }

  const uniqueDistractors = Array.from(
    new Set(distractorCandidates.filter((c) => c !== correctAnswer)),
  ).slice(0, 3);

  const options = shuffle([correctAnswer, ...uniqueDistractors], rand);
  const correctIndex = options.indexOf(correctAnswer);
  const reqStr = reqs.map((r) => `${r.name} (${r.hosts} hosts)`).join(', ');

  return {
    type: 'vlsm-allocation',
    prompt: `Allocate subnets for ${reqStr} from ${parentCidr}. What is the optimal VLSM layout?`,
    options,
    correctIndex,
    explanation:
      `VLSM allocates the largest subnet first on aligned power-of-two boundaries to avoid fragmentation. ` +
      `Packing ${reqStr} from ${parentCidr} produces: ${correctAnswer}.`,
  };
}

/** Generate a question by type and seed. */
export function generateQuestion(type: QuestionType, seed: number): Question {
  switch (type) {
    case 'smallest-cidr':
      return generateSmallestCidrQuestion(seed);
    case 'subnet-from-ip':
      return generateSubnetFromIpQuestion(seed);
    case 'classify-space':
      return generateClassifySpaceQuestion(seed);
    case 'compute-mask':
      return generateComputeMaskQuestion(seed);
    case 'vlsm-allocation':
      return generateVlsmAllocationQuestion(seed);
  }
}

/** All question types, for iteration. */
export const QUESTION_TYPES: readonly QuestionType[] = Object.freeze([
  'smallest-cidr',
  'subnet-from-ip',
  'classify-space',
  'compute-mask',
  'vlsm-allocation',
]);
