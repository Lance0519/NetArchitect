/**
 * Binary Subnet Splitter Engine.
 *
 * PURE MODULE. No React, no React Native, no Expo.
 *
 * Implements a recursive binary tree for splitting and merging subnets
 * along power-of-two boundaries.
 */

import {
  calculateSubnet,
  integerToIPv4,
  parseCidr,
} from './ip-engine';

export interface SubnetTreeNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly cidr: string;
  readonly prefix: number;
  readonly networkAddress: string;
  readonly broadcastAddress: string;
  readonly usableHosts: number;
  readonly totalAddresses: number;
  readonly isSplit: boolean;
  readonly childIds: readonly [string, string] | null;
}

export interface SubnetTree {
  readonly rootId: string;
  readonly nodes: ReadonlyMap<string, SubnetTreeNode>;
}

/** Create a new tree starting with a single root subnet. */
export function createSubnetTree(rootCidrInput: string): SubnetTree {
  const cidr = parseCidr(rootCidrInput);
  const info = calculateSubnet(cidr.ip, cidr.prefix);

  const rootId = 'node-root';
  const rootNode: SubnetTreeNode = {
    id: rootId,
    parentId: null,
    cidr: `${integerToIPv4(info.networkAddress)}/${cidr.prefix}`,
    prefix: cidr.prefix,
    networkAddress: integerToIPv4(info.networkAddress),
    broadcastAddress: integerToIPv4(info.broadcastAddress),
    usableHosts: info.usableHosts,
    totalAddresses: info.totalAddresses,
    isSplit: false,
    childIds: null,
  };

  const map = new Map<string, SubnetTreeNode>();
  map.set(rootId, rootNode);

  return {
    rootId,
    nodes: map,
  };
}

/** Split a leaf node into two buddy subnets with prefix + 1. */
export function splitSubnetNode(tree: SubnetTree, nodeId: string): SubnetTree {
  const node = tree.nodes.get(nodeId);
  if (!node || node.isSplit || node.prefix >= 32) {
    return tree;
  }

  const nextPrefix = node.prefix + 1;
  const parsed = parseCidr(node.cidr);
  const halfSize = 2 ** (32 - nextPrefix);

  const net1 = parsed.ip;
  const net2 = (parsed.ip + halfSize) >>> 0;

  const info1 = calculateSubnet(net1, nextPrefix);
  const info2 = calculateSubnet(net2, nextPrefix);

  const child1Id = `${nodeId}-0`;
  const child2Id = `${nodeId}-1`;

  const child1: SubnetTreeNode = {
    id: child1Id,
    parentId: nodeId,
    cidr: `${integerToIPv4(info1.networkAddress)}/${nextPrefix}`,
    prefix: nextPrefix,
    networkAddress: integerToIPv4(info1.networkAddress),
    broadcastAddress: integerToIPv4(info1.broadcastAddress),
    usableHosts: info1.usableHosts,
    totalAddresses: info1.totalAddresses,
    isSplit: false,
    childIds: null,
  };

  const child2: SubnetTreeNode = {
    id: child2Id,
    parentId: nodeId,
    cidr: `${integerToIPv4(info2.networkAddress)}/${nextPrefix}`,
    prefix: nextPrefix,
    networkAddress: integerToIPv4(info2.networkAddress),
    broadcastAddress: integerToIPv4(info2.broadcastAddress),
    usableHosts: info2.usableHosts,
    totalAddresses: info2.totalAddresses,
    isSplit: false,
    childIds: null,
  };

  const updatedNode: SubnetTreeNode = {
    ...node,
    isSplit: true,
    childIds: [child1Id, child2Id],
  };

  const nextMap = new Map(tree.nodes);
  nextMap.set(nodeId, updatedNode);
  nextMap.set(child1Id, child1);
  nextMap.set(child2Id, child2);

  return {
    rootId: tree.rootId,
    nodes: nextMap,
  };
}

/** Recursively remove child nodes when merging. */
function collectDescendantIds(nodes: ReadonlyMap<string, SubnetTreeNode>, nodeId: string): string[] {
  const result: string[] = [];
  const node = nodes.get(nodeId);
  if (node && node.childIds) {
    const [c1, c2] = node.childIds;
    result.push(c1, c2);
    result.push(...collectDescendantIds(nodes, c1));
    result.push(...collectDescendantIds(nodes, c2));
  }
  return result;
}

/** Merge two buddy subnets back into their parent node. */
export function mergeSubnetNode(tree: SubnetTree, nodeId: string): SubnetTree {
  const node = tree.nodes.get(nodeId);
  if (!node || !node.isSplit) {
    return tree;
  }

  const descendantIds = collectDescendantIds(tree.nodes, nodeId);
  const nextMap = new Map(tree.nodes);

  for (const id of descendantIds) {
    nextMap.delete(id);
  }

  const updatedNode: SubnetTreeNode = {
    ...node,
    isSplit: false,
    childIds: null,
  };
  nextMap.set(nodeId, updatedNode);

  return {
    rootId: tree.rootId,
    nodes: nextMap,
  };
}

/** Get all current active (unsplit) leaf subnets in order. */
export function getActiveLeafSubnets(tree: SubnetTree): SubnetTreeNode[] {
  const leaves: SubnetTreeNode[] = [];

  function traverse(nodeId: string) {
    const node = tree.nodes.get(nodeId);
    if (!node) return;

    if (!node.isSplit) {
      leaves.push(node);
    } else if (node.childIds) {
      traverse(node.childIds[0]);
      traverse(node.childIds[1]);
    }
  }

  traverse(tree.rootId);
  return leaves;
}
