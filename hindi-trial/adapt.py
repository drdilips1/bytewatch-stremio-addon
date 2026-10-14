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


def adapt_lm_main(path, dst):
    m = onnx.load(path)
    g = m.graph
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


adapt_lm_main(pick("flow_lm_main_int8.onnx"), os.path.join(out, "flow_lm_main_int8.onnx"))
adapt_lm_flow(pick("flow_lm_flow_int8.onnx"), os.path.join(out, "flow_lm_flow_int8.onnx"))
bos = os.path.join(src, "bos_before_voice.npy")
if os.path.exists(bos):
    adapt_encoder(pick("mimi_encoder_int8.onnx", "mimi_encoder.onnx"), os.path.join(out, "mimi_encoder.onnx"), bos)
else:
    os.system(f"cp {pick('mimi_encoder_int8.onnx', 'mimi_encoder.onnx')} {out}/mimi_encoder.onnx")
os.system(f"cp {pick('text_conditioner.onnx')} {out}/text_conditioner.onnx")
