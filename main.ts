import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parse } from './parse.js';
const source = process.env.MAKEFUN_INPUT_DIR || '/input';
const destination = process.env.MAKEFUN_OUTPUT_DIR || '/output';
const documents = JSON.parse(readFileSync(`${source}/cases.json`, 'utf8'));
const encoded: string[] = new Array(documents.length);
for (let index = 0; index < documents.length; index++) {
  encoded[index] = JSON.stringify(parse(documents[index].markdown));
  documents[index] = null;
}
mkdirSync(destination, { recursive: true });
writeFileSync(`${destination}/html.json`, '[' + encoded.join(',') + ']');
