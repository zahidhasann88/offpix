"""Make the official BiRefNet Lite ONNX export runnable on onnxruntime-web's WebGPU backend.

    python scripts/patch-birefnet-webgpu.py <official.onnx> <patched.onnx>

What it changes (graph structure only, never a weight):
  * Concat with more than MAX_FANIN inputs -> a balanced tree of Concats with at most
    MAX_FANIN inputs each. A WebGPU kernel binds every input as a storage buffer; with the
    output that must stay within maxStorageBuffersPerShaderStage (8 on many GPUs, the default
    device limit ORT requests), and very wide Concats also generate WGSL whose if/else chain
    exceeds the 127 nesting limit.
  * Split with more than MAX_FANIN outputs -> one Slice per output (same reason, outputs).
New constants (Slice starts/ends/axes) are Constant nodes, so the initializer list stays
exactly the official one (checked by --verify). Concatenation along one axis is associative
and slicing reproduces Split exactly, so the result is mathematically identical.

    python scripts/patch-birefnet-webgpu.py --verify <official.onnx> <patched.onnx>
checks that every initializer is byte-identical and nothing else changed except the rewritten
nodes. Output equivalence was checked with onnxruntime (tests/unit/patched-birefnet.test.ts,
removed in the v1.0.2 cleanup; see git history).
"""
import sys
import hashlib
import onnx
from onnx import helper, numpy_helper, TensorProto

VERSION = '1'
MAX_FANIN = 6


def const_i64(name, values):
    return helper.make_node('Constant', [], [name], name=name + '_c',
                            value=helper.make_tensor(name + '_v', TensorProto.INT64, [len(values)], values))


def constant_values(graph, name):
    """Values of a tensor produced by an initializer or a Constant node (Split sizes)."""
    for init in graph.initializer:
        if init.name == name:
            return numpy_helper.to_array(init).tolist()
    for node in graph.node:
        if node.op_type == 'Constant' and node.output[0] == name:
            for a in node.attribute:
                if a.name == 'value':
                    return numpy_helper.to_array(a.t).tolist()
    raise ValueError(f'split sizes {name} are not constant')


def patch(model):
    g = model.graph
    out_nodes = []
    stats = {'concat': 0, 'split': 0, 'new_nodes': 0}
    uid = [0]

    def fresh(base):
        uid[0] += 1
        return f'{base}__wg{uid[0]}'

    for node in g.node:
        if node.op_type == 'Concat' and len(node.input) > MAX_FANIN:
            axis = next(a.i for a in node.attribute if a.name == 'axis')
            level = list(node.input)
            # Balanced tree: concatenate groups of <= MAX_FANIN, in order, until one remains.
            while len(level) > MAX_FANIN:
                nxt = []
                for k in range(0, len(level), MAX_FANIN):
                    group = level[k:k + MAX_FANIN]
                    if len(group) == 1:
                        nxt.append(group[0])
                        continue
                    t = fresh(node.output[0])
                    out_nodes.append(helper.make_node('Concat', group, [t], name=fresh(node.name), axis=axis))
                    stats['new_nodes'] += 1
                    nxt.append(t)
                level = nxt
            out_nodes.append(helper.make_node('Concat', level, list(node.output), name=node.name, axis=axis))
            stats['concat'] += 1
            continue
        if node.op_type == 'Split' and len(node.output) > MAX_FANIN:
            axis = next((a.i for a in node.attribute if a.name == 'axis'), 0)
            if len(node.input) < 2 or not node.input[1]:
                raise ValueError(f'{node.name}: Split without explicit sizes is not supported')
            sizes = constant_values(g, node.input[1])
            start = 0
            for k, (size, out) in enumerate(zip(sizes, node.output)):
                s, e, ax = fresh(node.name + '_s'), fresh(node.name + '_e'), fresh(node.name + '_a')
                out_nodes += [const_i64(s, [start]), const_i64(e, [start + size]), const_i64(ax, [axis])]
                out_nodes.append(helper.make_node('Slice', [node.input[0], s, e, ax], [out], name=f'{node.name}_slice{k}'))
                stats['new_nodes'] += 4
                start += size
            stats['split'] += 1
            continue
        out_nodes.append(node)
    del g.node[:]
    g.node.extend(out_nodes)
    model.producer_name = (model.producer_name or '') + f' + offpix patch-birefnet-webgpu v{VERSION}'
    return stats


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def verify(official_path, patched_path):
    a, b = onnx.load(official_path), onnx.load(patched_path)
    ia = {i.name: i.SerializeToString() for i in a.graph.initializer}
    ib = {i.name: i.SerializeToString() for i in b.graph.initializer}
    assert ia.keys() == ib.keys(), f'initializer names differ: {set(ia) ^ set(ib)}'
    bad = [k for k in ia if ia[k] != ib[k]]
    assert not bad, f'{len(bad)} initializers differ, e.g. {bad[:3]}'
    assert [i.SerializeToString() for i in a.graph.input] == [i.SerializeToString() for i in b.graph.input], 'graph inputs differ'
    assert [o.SerializeToString() for o in a.graph.output] == [o.SerializeToString() for o in b.graph.output], 'graph outputs differ'
    # Every node that is not a rewritten Concat/Split must be unchanged and in order.
    kept_a = [n.SerializeToString() for n in a.graph.node if not ((n.op_type == 'Concat' and len(n.input) > MAX_FANIN) or (n.op_type == 'Split' and len(n.output) > MAX_FANIN))]
    names_b = {n.name for n in b.graph.node}
    kept_b = [n.SerializeToString() for n in b.graph.node if '__wg' not in n.name and '_slice' not in n.name and not (n.op_type == 'Concat' and n.name in {m.name for m in a.graph.node if m.op_type == 'Concat' and len(m.input) > MAX_FANIN})]
    assert kept_a == kept_b, 'unrewritten nodes differ'
    assert all(len(n.input) <= MAX_FANIN for n in b.graph.node if n.op_type == 'Concat'), 'a Concat is still too wide'
    assert not any(n.op_type == 'Split' and len(n.output) > MAX_FANIN for n in b.graph.node), 'a Split is still too wide'
    del names_b
    print(f'verify ok: {len(ia)} initializers byte-identical, {len(kept_a)} other nodes unchanged')


if __name__ == '__main__':
    if sys.argv[1] == '--verify':
        verify(sys.argv[2], sys.argv[3])
        sys.exit(0)
    src, dst = sys.argv[1], sys.argv[2]
    m = onnx.load(src)
    stats = patch(m)
    onnx.checker.check_model(m, full_check=False)
    onnx.save(m, dst)
    print(f'patched v{VERSION}: {stats}; sha256 {sha256(dst)}; size {__import__("os").path.getsize(dst)}')
