// Generates tiny ONNX models for engine tests (no Python/onnx dependency):
//   tests/fixtures/models/identity.onnx  input [1,3,h,w] -> output (same)
//   tests/fixtures/models/nearest-x2.onnx input [1,3,h,w] -> output [1,3,2h,2w] (nearest Resize)
// The protobuf is hand-encoded; only the handful of fields ONNX needs are emitted.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'tests/fixtures/models')

const varint = (n) => {
  const out = []
  let v = BigInt(n)
  do {
    let b = Number(v & 0x7fn)
    v >>= 7n
    if (v > 0n) b |= 0x80
    out.push(b)
  } while (v > 0n)
  return Buffer.from(out)
}
const key = (field, wire) => varint((field << 3) | wire)
const vint = (field, n) => Buffer.concat([key(field, 0), varint(n)])
const bytes = (field, buf) => Buffer.concat([key(field, 2), varint(buf.length), buf])
const str = (field, s) => bytes(field, Buffer.from(s, 'utf8'))
const msg = (field, ...parts) => bytes(field, Buffer.concat(parts))

const FLOAT = 1
const dim = (d) => (typeof d === 'number' ? msg(1, vint(1, d)) : msg(1, str(2, d)))
const valueInfo = (field, name, dims) =>
  msg(field, str(1, name), msg(2, msg(1, vint(1, FLOAT), msg(2, ...dims.map(dim)))))
const node = (inputs, outputs, opType, name) =>
  msg(1, ...inputs.map((i) => str(1, i)), ...outputs.map((o) => str(2, o)), str(3, name), str(4, opType))
const floatTensor = (name, dims, values) => {
  const raw = Buffer.alloc(values.length * 4)
  values.forEach((v, i) => raw.writeFloatLE(v, i * 4))
  return msg(5, ...dims.map((d) => vint(1, d)), vint(2, FLOAT), str(8, name), bytes(9, raw))
}
const model = (graphParts) =>
  Buffer.concat([vint(1, 8), str(2, 'offpix-test'), msg(8, str(1, ''), vint(2, 13)), msg(7, ...graphParts)])

const identity = model([
  node(['input'], ['output'], 'Identity', 'id'),
  str(2, 'identity'),
  valueInfo(11, 'input', [1, 3, 'h', 'w']),
  valueInfo(12, 'output', [1, 3, 'h', 'w']),
])

const nearestX2 = model([
  node(['input', '', 'scales'], ['output'], 'Resize', 'up'),
  str(2, 'nearest_x2'),
  floatTensor('scales', [4], [1, 1, 2, 2]),
  valueInfo(11, 'input', [1, 3, 'h', 'w']),
  valueInfo(12, 'output', [1, 3, 'h2', 'w2']),
])

fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'identity.onnx'), identity)
fs.writeFileSync(path.join(outDir, 'nearest-x2.onnx'), nearestX2)
console.log(`wrote dummy models to ${path.relative(root, outDir)}`)
