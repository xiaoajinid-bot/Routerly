import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const optionalRuntimePaths = [
  'node_modules/@huggingface/transformers',
  'node_modules/onnxruntime-node',
  'node_modules/onnxruntime-common',
];

// The optimizer probes for this optional runtime and reports unavailable when it is absent.
await Promise.all(
  optionalRuntimePaths.map((path) => rm(resolve(process.cwd(), path), { recursive: true, force: true })),
);
