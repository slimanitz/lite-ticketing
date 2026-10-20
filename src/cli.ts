#!/usr/bin/env node
// Silence the ExperimentalWarning that node:sqlite emits on Node 22/24.
const origEmitWarning = process.emitWarning.bind(process);
(process as { emitWarning: unknown }).emitWarning = (warning: unknown, ...rest: unknown[]) => {
  const text = typeof warning === 'string' ? warning : (warning as Error)?.message ?? '';
  if (/SQLite/i.test(text)) return;
  (origEmitWarning as (...a: unknown[]) => void)(warning, ...rest);
};

const { main } = await import('./commands.js');
main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
