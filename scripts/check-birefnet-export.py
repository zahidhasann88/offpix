"""Equivalence of our BiRefNet Lite export with the upstream PyTorch model (and other exports).

    scripts/.venv/Scripts/python scripts/check-birefnet-export.py <upstream_dir> <ours.onnx> <image>... [--other x.onnx] [--tol 1e-4]

PyTorch runs the UNMODIFIED upstream model (torchvision's deform_conv2d, not the
decomposition), onnxruntime runs the ONNX file on CPU, both on the same preprocessed input
(resize to the model size, /255, ImageNet mean/std). Fails (exit 1) if the max |Δ| of the
sigmoid output exceeds --tol on any image.
"""
import argparse
import sys

import numpy as np
import onnxruntime as ort
import torch
from PIL import Image

MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def preprocess(path, size):
    im = Image.open(path).convert('RGB').resize((size, size), Image.BILINEAR)
    a = (np.asarray(im, dtype=np.float32) / 255.0 - MEAN) / STD
    return a.transpose(2, 0, 1)[None].astype(np.float32)


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('upstream')
    ap.add_argument('ours')
    ap.add_argument('images', nargs='+')
    ap.add_argument('--other', action='append', default=[])
    ap.add_argument('--tol', type=float, default=1e-4)
    a = ap.parse_args()
    from transformers import AutoModelForImageSegmentation
    model = AutoModelForImageSegmentation.from_pretrained(a.upstream, trust_remote_code=True).eval()
    sess = ort.InferenceSession(a.ours, providers=['CPUExecutionProvider'])
    size = sess.get_inputs()[0].shape[2]
    others = [(p, ort.InferenceSession(p, providers=['CPUExecutionProvider'])) for p in a.other]
    ok = True
    for path in a.images:
        x = preprocess(path, size)
        with torch.no_grad():
            ref = model(torch.from_numpy(x))[-1].numpy()
        ours = sess.run(None, {'input_image': x})[0]
        d_sig = np.abs(sigmoid(ref) - sigmoid(ours)).max()
        d_log = np.abs(ref - ours).max()
        line = f'{path.split("/")[-1]}: ours vs PyTorch max|Δ sigmoid| {d_sig:.2e}, max|Δ logit| {d_log:.2e}'
        for p, s in others:
            o = s.run(None, {'input_image': x})[0]
            line += f' | {p.split("/")[-1]} vs PyTorch {np.abs(sigmoid(ref) - sigmoid(o)).max():.2e}, vs ours {np.abs(sigmoid(ours) - sigmoid(o)).max():.2e} (mean {np.abs(sigmoid(ours) - sigmoid(o)).mean():.1e})'
        print(line, flush=True)
        if d_sig > a.tol:
            ok = False
    print('EQUIVALENT' if ok else f'NOT EQUIVALENT (tolerance {a.tol})')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
