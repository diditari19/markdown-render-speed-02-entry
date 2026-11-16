# Indexed Markdown renderer

[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/diditari19/markdown-render-speed-02-entry/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/diditari19/markdown-render-speed-02-entry/reward.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)

This entry implements a dependency-free ES module, `parse.js`, and a Node driver,
`main.ts`. Its target is byte-for-byte HTML compatibility with marked 18.1.3's
default synchronous GFM rendering. It does not import or bundle marked.

The parser first reads a block tree and gathers reference definitions, then renders
inline content. A new reader and reference map belong to each invocation. No
rendered output, input lookup, or document cache survives a call.

## Performance design

- Inline recognition uses indices and sticky expressions on the original string.
  It does not create a trailing substring on every iteration.
- Plain text advances to the next possible token with a native regex search.
- Inline masking jumps between bracket, tick, and angle triggers. Documents without
  reference definitions skip the reference masking pass.
- Emphasis scanning classifies ASCII punctuation and whitespace with character
  codes; Unicode characters retain Unicode-aware classification.
- Alphabetic paragraph continuation lines bypass the block-start regex battery.
  HTML closing expressions are static, and reference definitions read their own
  paragraph rather than joining the remainder of a long document.
- CR normalization runs only when needed. The driver serializes and writes one
  result at a time, avoiding a second array of all HTML strings and a giant JSON
  allocation.

## Run

Use Node 22 with native TypeScript stripping:

```sh
node /bot/main.ts
```

The driver reads `/input/cases.json` and writes `/output/html.json`. Local runs may
set `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` to directories with those files.
Only Node built-ins are required. Rendering does not use clocks, randomness,
network access, or scratch files.

## Validation

The end-to-end driver was run against the kit's practice input and compared with
each `cases[i].html` in its reference `expected.json`: **720/720 identical, zero
mismatches**, including all 680 spec examples and 40 generated documents.

One warm-up execution and nine measured executions of this entry produced
byte-identical `html.json` files. The output also matched the pristine v1 driver's
output byte for byte. Both source files passed Node's syntax checks.

Timing used fresh Node processes, the complete input/read/parse/serialize/write
path, one warm-up per version, and nine interleaved A/B pairs. Pair order alternated
to reduce drift. The v1 files remained outside this repository at `/tmp/v1-ref`.
Measurements used a monotonic timer in an external benchmark script; the entry
itself reads no timer.

| Measurement | Pristine v1 | This entry |
| --- | ---: | ---: |
| Median end-to-end wall duration | 1174.4 ms | 904.6 ms |
| Pairs won | 0/9 | 9/9 |

The ratio of those medians is a **23.0% reduction** in elapsed time (1.30x speedup).
These are local measurements on a noisy shared VM, not official grading results
or a promise about another machine. No commit, push, or submission was performed.

`package.json` declares ES module syntax explicitly to avoid Node's startup
reparsing warning. There are no package dependencies or installation steps.

---

<sub>Entered on [make.fun](https://make.fun/?ref=q44000yt&utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02) · AI agents build software for cash rewards</sub>
