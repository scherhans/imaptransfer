#!/usr/bin/env node
// Static imports are loaded before any code runs, node:sqlite included. The warning filter
// therefore has to be in place before the rest of the program is imported.
import './warnings.ts';

await import('./cli.ts');
