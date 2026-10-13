import { build } from 'esbuild';

// Each action is bundled into a single self-contained file, since GitHub
// runs actions straight from the repository without installing dependencies.
const actions = {
  run: 'dist/index.mjs',
  comment: 'comment/dist/index.mjs',
  check: 'check/dist/index.mjs',
};

for (const [entry, outfile] of Object.entries(actions)) {
  await build({
    entryPoints: [`src/${entry}.ts`],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    legalComments: 'none',
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
    logLevel: 'warning',
  });
}
