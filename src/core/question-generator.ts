/**
 * Question Generator for Learning Mode.
 *
 * Deterministic generators, not a random blob. Each generator produces a
 * question with plausible-but-wrong distractors and an explanation showing
 * the arithmetic after submission.
 *
 * Every answer is verified against the engine, so a wrong engine key would
 * fail the test suite.
 */

import { calculateSubnet, cidrToMask, classifyAddressSpace, smallestBlockForHosts } from './ip-engine';
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
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/** Generate a random integer in [min, max]. */
function randomInt(rand: () => number, min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

/** Shuffle an array in place (Fisher-Yates). */
function shuffle<T>(arr: readonly T[], rand: () => number): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** Format a mask as dotted decimal. */
function formatMask(prefix: number): string {
  const mask = cidrToMask(prefix);
  return [
    (mask >>> 24) & 0xff,
    (mask >>> 16) & 0xff,
    (mask >>> 8) & 0xff,
    mask & 0xff,
  ].join('.');
}

/** Format an IP address from an integer. */
function formatIp(ip: number): string {
  return [
    (ip >>> 24) & 0xff,
    (ip >>> 16) & 0xff,
    (ip >>> 8) & 0xff,
    ip & 0xff,
  ].join('.');
}

/** Generate a "smallest CIDR for N hosts" question. */
export function generateSmallestCidrQuestion(seed: number): Question {
  const rand = makeRandom(seed);
  const hosts = randomInt(rand, 2, 200);
  const correctBits = smallestBlockForHosts(hosts, 2);
  const correctPrefix = 32 - correctBits;

  // Distractors: ±1 bit (plausible off-by-one errors)
  const distractorBits = [correctBits - 1, correctBits + 1].filter((b) => b >= 2 && b <= 30);
  const options = shuffle(
    [correctPrefix, ...distractorBits.map((b) => 32 - b)],
    rand,
  );

  const correctIndex = options.indexOf(correctPrefix);
  const usable = 2 ** correctBits - 2;

  return {
    type: 'smallest-cidr',
    prompt: `What is the smallest subnet that can hold ${hosts} hosts?`,
    options: options.map((p) => `/${p}`),
    correctIndex,
    explanation: `${hosts} hosts need at least ${hosts} usable addresses. ` +
      `2^${correctBits} - 2 = ${usable} ≥ ${hosts}, so /${correctPrefix} is the smallest. ` +
      `A /${correctPrefix + 1} would only provide ${2 ** (correctBits - 1) - 2} usable addresses.`,
  };
}

/** Generate a "subnet from IP and prefix" question. */
export function generateSubnetFromIpQuestion(seed: number): Question {
  const rand = makeRandom(seed);
  const prefix = randomInt(rand, 24, 30);
  const hostBits = 32 - prefix;
  const blockSize = 2 ** hostBits;
  const networkBase = randomInt(rand, 1, 200) * blockSize;
  const hostOffset = randomInt(rand, 1, blockSize - 1);
  const ip = networkBase + hostOffset;

  const info = calculateSubnet(ip, prefix);
  const correctNetwork = formatIp(info.networkAddress);

  // Distractors: common mistakes
  const distractor1 = formatIp(networkBase + blockSize); // next network
  const distractor2 = formatIp(ip); // the IP itself
  const distractor3 = formatIp(info.broadcastAddress); // broadcast

  const options = shuffle([correctNetwork, distractor1, distractor2, distractor3], rand);
  const correctIndex = options.indexOf(correctNetwork);

  return {
    type: 'subnet-from-ip',
    prompt: `What is the network address of ${formatIp(ip)}/${prefix}?`,
    options,
    correctIndex,
    explanation: `The /${prefix} mask is ${formatMask(prefix)}. ` +
      `Performing bitwise AND: ${formatIp(ip)} AND ${formatMask(prefix)} = ${correctNetwork}. ` +
      `The network address has all host bits set to zero.`,
  };
}

/** Generate a "classify the address space" question. */
export function generateClassifySpaceQuestion(seed: number): Question {
  const rand = makeRandom(seed);

  // Mix of private and public addresses
  const addresses = [
    { ip: '10.0.0.0', kind: 'private' },
    { ip: '172.16.0.0', kind: 'private' },
    { ip: '192.168.1.0', kind: 'private' },
    { ip: '8.8.8.8', kind: 'public' },
    { ip: '1.1.1.1', kind: 'public' },
    { ip: '127.0.0.1', kind: 'loopback' },
    { ip: '169.254.0.1', kind: 'link-local' },
  ];

  const selected = addresses[randomInt(rand, 0, addresses.length - 1)]!;
  const classification = classifyAddressSpace(selected.ip);

  // Map classification to answer
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

  // Distractors: other classifications
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
    explanation: `${selected.ip} is classified as ${correctAnswer}. ` +
      `This is determined by checking the IANA Special-Purpose Address Registry.`,
  };
}

/** Generate a "compute the mask" question. */
export function generateComputeMaskQuestion(seed: number): Question {
  const rand = makeRandom(seed);
  const prefix = randomInt(rand, 8, 30);
  const correctMask = formatMask(prefix);

  // Distractors: masks for adjacent prefixes
  const distractorPrefixes = [prefix - 1, prefix + 1, prefix + 2].filter(
    (p) => p >= 0 && p <= 32,
  );
  const options = shuffle(
    [correctMask, ...distractorPrefixes.map(formatMask)],
    rand,
  );
  const correctIndex = options.indexOf(correctMask);

  return {
    type: 'compute-mask',
    prompt: `What is the subnet mask for /${prefix}?`,
    options,
    correctIndex,
    explanation: `A /${prefix} prefix means ${prefix} network bits. ` +
      `The mask is ${correctMask}. ` +
      `Each octet of 8 bits contributes 255 if fully network, 0 if fully host, ` +
      `or a partial value for the boundary octet.`,
  };
}

/** Generate a "VLSM allocation" question. */
export function generateVlsmAllocationQuestion(seed: number): Question {
  const rand = makeRandom(seed);
  const parentPrefix = randomInt(rand, 22, 26);
  const parentBits = 32 - parentPrefix;
  const parentSize = 2 ** parentBits;

  // Generate 2-3 requirements that fit
  const reqs: { hosts: number; name: string }[] = [];
  let remaining = parentSize;
  const count = randomInt(rand, 2, 3);
  for (let i = 0; i < count; i++) {
    const maxHosts = Math.min(remaining - 2, 100);
    if (maxHosts < 2) break;
    const hosts = randomInt(rand, 2, maxHosts);
    reqs.push({ hosts, name: `Subnet ${i + 1}` });
    const bits = smallestBlockForHosts(hosts, 2);
    remaining -= 2 ** bits;
  }

  const parentIp = randomInt(rand, 1, 200) * parentSize;
  const parentCidr = `${formatIp(parentIp)}/${parentPrefix}`;

  // Run the engine to get the correct answer
  const result = packVLSM(
    parentCidr,
    reqs.map((r) => ({ id: r.name, name: r.name, requestedHosts: r.hosts, role: 'LAN' as const })),
  );

  const correctAnswer = result.allocations
    .map((a: { name: string; assignedCidr: string }) => `${a.name}: ${a.assignedCidr}`)
    .join(', ');

  // Distractor: wrong order (smallest first)
  const wrongAnswer = [...reqs]
    .sort((a, b) => a.hosts - b.hosts)
    .map((r, i) => {
      const bits = smallestBlockForHosts(r.hosts, 2);
      return `Subnet ${i + 1}: /${32 - bits}`;
    })
    .join(', ');

  const options = shuffle([correctAnswer, wrongAnswer], rand);
  const correctIndex = options.indexOf(correctAnswer);

  const reqStr = reqs.map((r) => `${r.hosts} hosts`).join(', ');

  return {
    type: 'vlsm-allocation',
    prompt: `Allocate subnets for ${reqStr} from ${parentCidr}. What is the correct order?`,
    options,
    correctIndex,
    explanation: `VLSM allocates largest first to prevent fragmentation. ` +
      `The engine packs ${reqStr} from ${parentCidr} as: ${correctAnswer}. ` +
      `Allocating smallest first would fragment the remaining space.`,
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
