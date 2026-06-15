import { JavaScriptParser } from './javascript';
import { PythonParser } from './python';
import { HtmlParser } from './html';
import { CssParser } from './css';
import { JavaParser } from './java';
import { RustParser } from './rust';
import { GoParser } from './go';
import { CCppParser } from './cpp';
import { RubyParser } from './ruby';
import { PhpParser } from './php';
import { SwiftParser } from './swift';
import { VueParser } from './vue';
import { SvelteParser } from './svelte';
import { LanguageParser } from './types';

/**
 * Array of all available language parsers for dependency analysis.
 */
export const ALL_PARSERS: LanguageParser[] = [
  new JavaScriptParser(),
  new PythonParser(),
  new HtmlParser(),
  new CssParser(),
  new JavaParser(),
  new RustParser(),
  new GoParser(),
  new CCppParser(),
  new RubyParser(),
  new PhpParser(),
  new SwiftParser(),
  new VueParser(),
  new SvelteParser(),
];

export * from './types';
export * from './utils';
