"""Export BiRefNet Lite to a fixed-size ONNX model for offpix, from the upstream checkpoint.

    scripts/.venv/Scripts/python scripts/export-birefnet.py <upstream_dir> <out.onnx> [--size 512]

<upstream_dir>: a download of huggingface.co/ZhengPeng7/BiRefNet_lite at the commit pinned in
src/models/manifest.json (birefnet.py + BiRefNet_config.py + config.json + model.safetensors).

The model's deformable convolution (torchvision.ops.deform_conv2d) has no ONNX operator. It is
replaced by an exact decomposition: all kernel taps are sampled with ONE GridSample (bilinear,
zero padding, align_corners=True, which is torchvision's sampling rule), multiplied by the
modulation mask, and contracted with the reshaped weight in ONE MatMul. No GatherND (the
GatherND-based decompositions in other exports break onnxruntime-web's WebGPU kernel).
The decomposition is checked against torchvision before exporting.

    scripts/.venv/Scripts/python scripts/export-birefnet.py fp16 <fp32.onnx> <fp16.onnx> [ops kept fp32]

Output: input "input_image" [1, 3, S, S] (ImageNet-normalised RGB), output "output_image"
[1, 1, S, S] logits (apply sigmoid), opset 17.
"""
import argparse
import hashlib
import inspect
import os
import sys

import torch
import torch.nn.functional as F

VERSION = '1'


def _pair(v):
    return tuple(v) if isinstance(v, (tuple, list)) else (v, v)


def deform_conv2d_gridsample(input, offset, weight, bias=None, stride=(1, 1), padding=(0, 0), dilation=(1, 1), mask=None):
    """torchvision.ops.deform_conv2d (offset_groups = 1) as GridSample + MatMul."""
    n, c, h, w = input.shape
    cout, cin, kh, kw = weight.shape
    sh, sw = _pair(stride)
    ph, pw = _pair(padding)
    dh, dw = _pair(dilation)
    ho, wo = offset.shape[2], offset.shape[3]
    k = kh * kw
    dev, dt = input.device, input.dtype
    # Regular sampling grid per kernel tap, in input pixel coordinates.
    ky = (torch.arange(kh, device=dev, dtype=dt) * dh).repeat_interleave(kw)  # [K]
    kx = (torch.arange(kw, device=dev, dtype=dt) * dw).repeat(kh)  # [K]
    base_y = (torch.arange(ho, device=dev, dtype=dt) * sh - ph)[None, :, None] + ky[:, None, None]  # [K, Ho, 1]
    base_x = (torch.arange(wo, device=dev, dtype=dt) * sw - pw)[None, None, :] + kx[:, None, None]  # [K, 1, Wo]
    off = offset.view(n, k, 2, ho, wo)  # torchvision layout: (dy, dx) per tap
    y = base_y[None] + off[:, :, 0]
    x = base_x[None] + off[:, :, 1]
    # align_corners=True: -1 / +1 are the centres of the first / last pixel, like integer coordinates.
    gx = 2.0 * x / max(w - 1, 1) - 1.0
    gy = 2.0 * y / max(h - 1, 1) - 1.0
    grid = torch.stack([gx, gy], dim=-1).view(n, k * ho, wo, 2)
    s = F.grid_sample(input, grid, mode='bilinear', padding_mode='zeros', align_corners=True)  # [N, C, K*Ho, Wo]
    s = s.view(n, c, k, ho, wo)
    if mask is not None:
        s = s * mask.view(n, 1, k, ho, wo)
    cols = s.reshape(n, c * k, ho * wo)
    out = torch.matmul(weight.reshape(cout, cin * k), cols).view(n, cout, ho, wo)
    if bias is not None:
        out = out + bias.view(1, -1, 1, 1)
    return out


def check_decomposition():
    from torchvision.ops import deform_conv2d
    g = torch.Generator().manual_seed(0)
    worst = 0.0
    for (c, cout, h, w, stride, pad, dil) in [(8, 6, 13, 17, 1, 1, 1), (5, 4, 16, 16, 2, 1, 1), (4, 3, 12, 9, 1, 2, 2)]:
        x = torch.randn(2, c, h, w, generator=g)
        wt = torch.randn(cout, c, 3, 3, generator=g)
        b = torch.randn(cout, generator=g)
        ho = (h + 2 * pad - dil * 2 - 1) // stride + 1
        wo = (w + 2 * pad - dil * 2 - 1) // stride + 1
        off = torch.randn(2, 18, ho, wo, generator=g) * 3  # large offsets: many taps fall outside
        m = torch.rand(2, 9, ho, wo, generator=g) * 2
        ref = deform_conv2d(x, off, wt, b, stride=stride, padding=pad, dilation=dil, mask=m)
        ours = deform_conv2d_gridsample(x, off, wt, b, stride=stride, padding=pad, dilation=dil, mask=m)
        worst = max(worst, (ref - ours).abs().max().item())
    assert worst < 1e-4, f'deform_conv2d decomposition differs from torchvision by {worst}'
    print(f'decomposition check ok: max |diff| vs torchvision {worst:.2e}')


def load_model(upstream):
    from transformers import AutoModelForImageSegmentation
    model = AutoModelForImageSegmentation.from_pretrained(upstream, trust_remote_code=True)
    model.eval()
    return model


def use_decomposition(model):
    """Point the model's deform_conv2d at the decomposition (module-level import in birefnet.py)."""
    mods = {inspect.getmodule(type(m)) for m in model.modules() if type(m).__name__ == 'DeformableConv2d'}
    for mod in mods:
        mod.deform_conv2d = deform_conv2d_gridsample
    return len(mods)


class LastPred(torch.nn.Module):
    """BiRefNet returns a list of predictions; the final full-resolution logits are the last."""

    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, x):
        return self.m(x)[-1]


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('upstream')
    ap.add_argument('out')
    ap.add_argument('--size', type=int, default=512)
    a = ap.parse_args()
    torch.manual_seed(0)
    check_decomposition()
    model = load_model(a.upstream)
    n = use_decomposition(model)
    print(f'deform_conv2d replaced in {n} module(s)')
    x = torch.randn(1, 3, a.size, a.size)
    with torch.no_grad():
        torch.onnx.export(LastPred(model), (x,), a.out, opset_version=17, input_names=['input_image'],
                          output_names=['output_image'], do_constant_folding=True, dynamo=False)
    import onnx
    m = onnx.load(a.out)
    m.producer_name = f'offpix export-birefnet v{VERSION} (torch {torch.__version__})'
    onnx.save(m, a.out)
    print(f'exported v{VERSION}: {a.out} size {os.path.getsize(a.out)} sha256 {sha256(a.out)}')




def to_fp16(src, dst, block=()):
    """fp16 weights and compute, fp32 graph inputs/outputs (the app feeds float32)."""
    import onnx
    from onnxconverter_common import float16
    m = onnx.load(src)
    m16 = float16.convert_float_to_float16(m, keep_io_types=True, op_block_list=list(block) or None)
    # onnxconverter-common leaves some Cast(to=FLOAT) whose output it typed float16 (and vice
    # versa); make every Cast agree with the type declared for its output.
    from onnx import TensorProto
    declared = {v.name: v.type.tensor_type.elem_type for v in list(m16.graph.value_info) + list(m16.graph.output)}
    fixed = 0
    for node in m16.graph.node:
        if node.op_type != 'Cast' or node.output[0] not in declared:
            continue
        want = declared[node.output[0]]
        for at in node.attribute:
            if at.name == 'to' and at.i in (TensorProto.FLOAT, TensorProto.FLOAT16) and want in (TensorProto.FLOAT, TensorProto.FLOAT16) and at.i != want:
                at.i = want
                fixed += 1
    print(f'fp16: {fixed} Cast nodes made consistent with their output type')
    m16.producer_name = m.producer_name + ' fp16'
    onnx.save(m16, dst)
    print(f'fp16: {dst} size {os.path.getsize(dst)} sha256 {sha256(dst)}')


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'fp16':
        # export-birefnet.py fp16 <fp32.onnx> <fp16.onnx> [op to keep in fp32 ...]
        to_fp16(sys.argv[2], sys.argv[3], sys.argv[4:])
    else:
        sys.exit(main())
