import { describe, expect, it } from 'vitest';
import {
  createSubnetTree,
  splitSubnetNode,
  mergeSubnetNode,
  getActiveLeafSubnets,
} from '../src/core/splitter-engine';

describe('splitter-engine (Binary Subnet Splitter)', () => {
  it('creates a tree with a single root subnet', () => {
    const tree = createSubnetTree('192.168.1.0/24');
    expect(tree.rootId).toBe('node-root');
    expect(tree.nodes.size).toBe(1);

    const leaves = getActiveLeafSubnets(tree);
    expect(leaves).toHaveLength(1);
    expect(leaves[0]?.cidr).toBe('192.168.1.0/24');
    expect(leaves[0]?.usableHosts).toBe(254);
  });

  it('splits /24 into two /25 buddy subnets', () => {
    let tree = createSubnetTree('192.168.1.0/24');
    tree = splitSubnetNode(tree, tree.rootId);

    const leaves = getActiveLeafSubnets(tree);
    expect(leaves).toHaveLength(2);
    expect(leaves[0]?.cidr).toBe('192.168.1.0/25');
    expect(leaves[0]?.usableHosts).toBe(126);
    expect(leaves[1]?.cidr).toBe('192.168.1.128/25');
    expect(leaves[1]?.usableHosts).toBe(126);
  });

  it('splits recursively: splits first /25 into two /26 subnets', () => {
    let tree = createSubnetTree('10.0.0.0/24');
    tree = splitSubnetNode(tree, tree.rootId); // -> two /25s: 10.0.0.0/25 and 10.0.0.128/25

    const child0Id = 'node-root-0';
    tree = splitSubnetNode(tree, child0Id); // -> two /26s: 10.0.0.0/26, 10.0.0.64/26

    const leaves = getActiveLeafSubnets(tree);
    expect(leaves).toHaveLength(3);
    expect(leaves[0]?.cidr).toBe('10.0.0.0/26');
    expect(leaves[1]?.cidr).toBe('10.0.0.64/26');
    expect(leaves[2]?.cidr).toBe('10.0.0.128/25');
  });

  it('merges buddy subnets back into parent', () => {
    let tree = createSubnetTree('192.168.1.0/24');
    tree = splitSubnetNode(tree, tree.rootId);
    expect(getActiveLeafSubnets(tree)).toHaveLength(2);

    tree = mergeSubnetNode(tree, tree.rootId);
    const leaves = getActiveLeafSubnets(tree);
    expect(leaves).toHaveLength(1);
    expect(leaves[0]?.cidr).toBe('192.168.1.0/24');
  });
});
