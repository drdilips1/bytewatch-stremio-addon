"""Reshapes the newer exporter's ONNX graphs to the layout of the sherpa-onnx English Pocket
pack the apps already run (sherpa-onnx-pocket-tts-int8-2026-01-26):

lm_main: per layer, the newer graph keeps K and V apart in float16 ([1,1000,16,64] each) and a
  step counter; the English pack has one float32 [2,1,1000,16,64] K/V cache, an empty float
  state and the counter. conditioning [1024] -> [1,1024], eos_logit [1] -> [1,1].
lm_flow: c [1024] -> [1,1024].
encoder: the voice embedding gets the BOS vector in front (insert_bos_before_voice in the
  model config), which the older runtime doesn't add itself.

usage: adapt.py <exported dir> <out dir>
"""
import os, sys
import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

src, out = sys.argv[1:3]
os.makedirs(out, exist_ok=True)


def opset(m):
    return next(o.version for o in m.opset_import if o.domain in ("", "ai.onnx"))


def const(g, name, arr):
    g.initializer.append(numpy_helper.from_array(np.asarray(arr), name))
    return name


def unsqueeze(g, m, x, y, axis):
    if opset(m) >= 13:
        g.node.append(helper.make_node("Unsqueeze", [x, const(g, y + "_axes", np.array([axis], np.int64))], [y]))
    else:
        g.node.append(helper.make_node("Unsqueeze", [x], [y], axes=[axis]))


def reshape(g, x, y, shape):
    g.node.append(helper.make_node("Reshape", [x, const(g, y + "_shape", np.array(shape, np.int64))], [y]))


def rename_output(g, old, new):
    for n in g.node:
        n.output[:] = [new if o == old else o for o in n.output]
    for n in g.node:
        n.input[:] = [new if i == old else i for i in n.input]


def fix_empty_reshapes(m):
    """A Reshape whose target has a -1 fails on an empty input (the runtime primes the model
    with zero-length steps). In the rotary embedding, the target shape is rebuilt from the
    input's own first three sizes plus the known rest: [B, T, H, 64] -> [B, T, H, 32, 2] and
    back, so no -1 is left."""
    g = m.graph
    inferred = onnx.shape_inference.infer_shapes(m)
    lengths = {}
    for vi in list(inferred.graph.value_info) + list(inferred.graph.output):
        dims = vi.type.tensor_type.shape.dim
        if len(dims) == 1 and dims[0].HasField("dim_value"):
            lengths[vi.name] = dims[0].dim_value
    consts = {i.name for i in g.initializer}
    consts |= {o for n in g.node if n.op_type == "Constant" for o in n.output}
    fixed = 0
    k = 0
    while k < len(g.node):
        n = g.node[k]
        if n.op_type == "Reshape" and "rope" in n.name.lower() and n.input[1] not in consts:
            L = lengths.get(n.input[1])
            tail = {5: [32, 2], 4: [64]}.get(L)
            print(f"  {n.name}: target length {L}" + ("" if tail else " (left as is)"))
            if tail:
                tag = n.name.replace("/", "_")
                nodes = [
                    helper.make_node("Shape", [n.input[0]], [tag + "_s"]),
                    helper.make_node("Slice", [tag + "_s", const(g, tag + "_b", np.array([0], np.int64)),
                                               const(g, tag + "_e", np.array([3], np.int64)),
                                               const(g, tag + "_a", np.array([0], np.int64))], [tag + "_s3"]),
                    helper.make_node("Concat", [tag + "_s3", const(g, tag + "_t", np.array(tail, np.int64))],
                                     [tag + "_shape"], axis=0),
                ]
                n.input[1] = tag + "_shape"
                for j, nn in enumerate(nodes):
                    g.node.insert(k + j, nn)
                k += len(nodes)
                fixed += 1
        k += 1
    print(f"fixed {fixed} empty-input reshapes")


def guard_empty(m):
    """The runtime sometimes steps the model with nothing in it (no latent frames, no text).
    The newer graph can't run on an empty input, and an empty step changes nothing anyway:
    in that case the states pass through unchanged (zero conditioning and EOS logit, unused)."""
    g = m.graph
    outs = list(g.output)
    ins = list(g.input)
    for o in outs:
        rename_output(g, o.name, o.name + "_else")
    else_outs = []
    for o in outs:
        vi = onnx.ValueInfoProto()
        vi.CopyFrom(o)
        vi.name = o.name + "_else"
        else_outs.append(vi)
    else_graph = helper.make_graph(list(g.node), "full_step", [], else_outs, initializer=list(g.initializer))

    then_nodes, then_outs = [], []
    zeros = {0: np.zeros((1, 1024), np.float32), 1: np.zeros((1, 1), np.float32)}
    for idx, o in enumerate(outs):
        name = o.name + "_then"
        if idx in zeros:
            then_nodes.append(helper.make_node("Constant", [], [name], value=numpy_helper.from_array(zeros[idx])))
        else:
            then_nodes.append(helper.make_node("Identity", [ins[idx].name], [name]))  # state k in -> state k out
        vi = onnx.ValueInfoProto()
        vi.CopyFrom(o)
        vi.name = name
        then_outs.append(vi)
    then_graph = helper.make_graph(then_nodes, "empty_step", [], then_outs)

    del g.node[:]
    del g.initializer[:]
    lens = []
    for i, x in enumerate((ins[0].name, ins[1].name)):
        g.node.append(helper.make_node("Shape", [x], [f"guard_s{i}"]))
        g.node.append(helper.make_node("Gather", [f"guard_s{i}", const(g, f"guard_i{i}", np.array(1, np.int64))], [f"guard_l{i}"], axis=0))
        lens.append(f"guard_l{i}")
    g.node.append(helper.make_node("Add", lens, ["guard_total"]))
    g.node.append(helper.make_node("Equal", ["guard_total", const(g, "guard_zero", np.array(0, np.int64))], ["guard_empty"]))
    g.node.append(helper.make_node("If", ["guard_empty"], [o.name for o in outs], then_branch=then_graph, else_branch=else_graph))
    print("guarded empty steps")


def adapt_lm_main(path, dst):
    m = onnx.load(path)
    g = m.graph
    fix_empty_reshapes(m)
    ins, outs = list(g.input), list(g.output)
    head_in, states_in = ins[:2], ins[2:]
    head_out, states_out = outs[:2], outs[2:]
    assert len(states_in) % 3 == 0 and len(states_out) == len(states_in), (len(states_in), len(states_out))
    new_in, new_out = list(head_in), []
    for k in range(len(states_in) // 3):
        K, V, P = states_in[3 * k: 3 * k + 3]
        Ko, Vo, Po = states_out[3 * k: 3 * k + 3]
        kt = K.type.tensor_type.elem_type
        shape = [d.dim_value for d in K.type.tensor_type.shape.dim]  # [1, 1000, 16, 64]
        kv = f"state_kv_{k}"
        empty = f"state_empty_{k}"
        new_in += [
            helper.make_tensor_value_info(kv, TensorProto.FLOAT, [2] + shape),
            helper.make_tensor_value_info(empty, TensorProto.FLOAT, [0]),
            P,
        ]
        for idx, (dst_name) in enumerate((K.name, V.name)):
            picked = f"{kv}_{idx}"
            g.node.insert(0, helper.make_node("Gather", [kv, const(g, picked + "_i", np.array(idx, np.int64))], [picked], axis=0))
            if kt != TensorProto.FLOAT:
                g.node.insert(1, helper.make_node("Cast", [picked], [dst_name], to=kt))
            else:
                g.node.insert(1, helper.make_node("Identity", [picked], [dst_name]))
        parts = []
        for idx, o in enumerate((Ko, Vo)):
            f = f"out_{kv}_{idx}_f"
            g.node.append(helper.make_node("Cast", [o.name], [f], to=TensorProto.FLOAT))
            u = f"out_{kv}_{idx}_u"
            unsqueeze(g, m, f, u, 0)
            parts.append(u)
        g.node.append(helper.make_node("Concat", parts, [f"out_{kv}"], axis=0))
        g.node.append(helper.make_node("Identity", [empty], [f"out_{empty}"]))
        new_out += [
            helper.make_tensor_value_info(f"out_{kv}", TensorProto.FLOAT, [2] + shape),
            helper.make_tensor_value_info(f"out_{empty}", TensorProto.FLOAT, [0]),
            Po,
        ]
    # conditioning [1024] -> [1, 1024]; eos_logit [1] -> [1, 1]
    heads = []
    for o, shape in zip(head_out, ([1, 1024], [1, 1])):
        raw = o.name + "_raw"
        rename_output(g, o.name, raw)
        reshape(g, raw, o.name, shape)
        heads.append(helper.make_tensor_value_info(o.name, TensorProto.FLOAT, shape))
    del g.input[:]
    g.input.extend(new_in)
    del g.output[:]
    g.output.extend(heads + new_out)
    guard_empty(m)
    onnx.checker.check_model(m)
    onnx.save(m, dst)
    print("adapted", path, "->", dst)


def adapt_lm_flow(path, dst):
    m = onnx.load(path)
    g = m.graph
    c = next(i for i in g.input if i.name == "c")
    if len(c.type.tensor_type.shape.dim) == 2:
        onnx.save(m, dst)
        return
    for n in g.node:
        n.input[:] = ["c_flat" if i == "c" else i for i in n.input]
    reshape(g, "c", "c_flat", [1024])
    g.node.insert(0, g.node.pop())
    c.type.tensor_type.shape.ClearField("dim")
    for d in (1, 1024):
        c.type.tensor_type.shape.dim.add().dim_value = d
    onnx.checker.check_model(m)
    onnx.save(m, dst)
    print("adapted", path, "->", dst)


def adapt_encoder(path, dst, bos_path):
    m = onnx.load(path)
    g = m.graph
    bos = np.load(bos_path).astype(np.float32)  # (1, 1, 1024)
    o = g.output[0]
    raw = o.name + "_raw"
    rename_output(g, o.name, raw)
    g.node.append(helper.make_node("Concat", [const(g, "bos_before_voice", bos), raw], [o.name], axis=1))
    onnx.checker.check_model(m)
    onnx.save(m, dst)
    print("adapted", path, "->", dst, "(BOS in front of the voice)")


def pick(*names):
    for n in names:
        p = os.path.join(src, n)
        if os.path.exists(p):
            return p
    sys.exit(f"missing: {names}")


full = os.path.join(out, "..", os.path.basename(out) + "_fp32")
os.makedirs(full, exist_ok=True)
adapt_lm_main(pick("flow_lm_main_int8.onnx"), os.path.join(out, "flow_lm_main_int8.onnx"))
adapt_lm_flow(pick("flow_lm_flow_int8.onnx"), os.path.join(out, "flow_lm_flow_int8.onnx"))
# The same without the int8 shrinking, to see if it blurs the end-of-sentence signal.
adapt_lm_main(pick("flow_lm_main.onnx"), os.path.join(full, "flow_lm_main.onnx"))
adapt_lm_flow(pick("flow_lm_flow.onnx"), os.path.join(full, "flow_lm_flow.onnx"))
bos = os.path.join(src, "bos_before_voice.npy")
for d, enc in ((out, pick("mimi_encoder_int8.onnx", "mimi_encoder.onnx")), (full, pick("mimi_encoder.onnx"))):
    if os.path.exists(bos):
        adapt_encoder(enc, os.path.join(d, "mimi_encoder.onnx"), bos)
    else:
        os.system(f"cp {enc} {d}/mimi_encoder.onnx")
    os.system(f"cp {pick('text_conditioner.onnx')} {d}/text_conditioner.onnx")
