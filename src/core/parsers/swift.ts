import {
  CosmosDependency,
  DependencyType,
  DependencyReferenceKind,
  DependencyResolutionKind,
  DependencyLayer,
} from '../../types';
import { LanguageParser, ParserContext, createDirectDependency } from './types';
import { normalizePath } from './utils';

/**
 * Parser for Swift files to extract import dependencies.
 */
export class SwiftParser implements LanguageParser {
  /** Supported file extensions for this parser. */
  extensions = ['swift'];

  /**
   * Parses Swift content to find 'import' statements, excluding system frameworks.
   * @param context The parser context containing file content and settings.
   * @returns An array of extracted dependencies.
   */
  parse(context: ParserContext): CosmosDependency[] {
    const { content, fileId, normalizedFileIds } = context;
    const deps: CosmosDependency[] = [];
    const sourceDir = normalizePath(fileId).replace(/\/[^\/]+$/, '');

    const importRegex = /^import\s+(\w+)$/gm;
    const SYSTEM_FRAMEWORKS = new Set([
      'UIKit',
      'Foundation',
      'SwiftUI',
      'AppKit',
      'Combine',
      'CoreData',
      'CoreLocation',
      'MapKit',
      'StoreKit',
      'XCTest',
    ]);

    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(content)) !== null) {
      const name = match[1];
      if (SYSTEM_FRAMEWORKS.has(name)) {
        continue;
      }
      const candidate = normalizePath(`${sourceDir}/${name}.swift`);
      const resolved = normalizedFileIds[candidate];
      if (resolved && resolved !== fileId) {
        deps.push({
          sourceId: fileId,
          targetId: resolved,
          layer: DependencyLayer.DIRECT,
          type: DependencyType.IMPORT,
          specifier: name,
          referenceKind: DependencyReferenceKind.STATIC_IMPORT,
          resolvedBy: DependencyResolutionKind.RELATIVE,
        });
      }
    }

    return deps;
  }
}
