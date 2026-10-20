#!/usr/bin/env node
// Silence the ExperimentalWarning that node:sqlite emits on Node 22/24.
const origEmitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
    const text = typeof warning === 'string' ? warning : warning?.message ?? '';
    if (/SQLite/i.test(text))
        return;
    origEmitWarning(warning, ...rest);
};
const { main } = await import('./commands.js');
main(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
export {};
