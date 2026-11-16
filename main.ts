import { readFileSync, mkdirSync, openSync, writeSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

// Environment overrides are paths for local harness runs, never rendering options.
const sourceDirectory = process.env.MAKEFUN_INPUT_DIR || '/input';
const destinationDirectory = process.env.MAKEFUN_OUTPUT_DIR || '/output';
const documents = JSON.parse(readFileSync(join(sourceDirectory, 'cases.json'), 'utf8'));
mkdirSync(destinationDirectory, { recursive: true });
const output = openSync(join(destinationDirectory, 'html.json'), 'w');
function emit(value) {
  const bytes = Buffer.from(value);
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(output, bytes, offset, bytes.length - offset);
}
try {
  emit('[');
  for (let index = 0; index < documents.length; ++index) {
    if (index) emit(',');
    emit(JSON.stringify(parse(documents[index].markdown)));
  }
  emit(']');
} finally {
  closeSync(output);
}
