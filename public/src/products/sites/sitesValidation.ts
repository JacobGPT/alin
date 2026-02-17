/**
 * Sites Validation — Completeness checks and deploy gate for Website Sprint.
 *
 * Validates that a "finished" Sites run produced all required HTML pages,
 * that Truth Guard passes, and that no PLACEHOLDER/INFERRED content remains
 * in critical sections.
 *
 * This module is pure logic — no React, no side-effects.
 */

import type { SiteBrief } from '../../api/dbService';
import { ContentTag } from '../../types/tbwo';
import type { TruthGuardResult } from './truthGuard';

// ============================================================================
// TYPES
// ============================================================================

export interface CompletenessCheck {
  check: string;
  passed: boolean;
  detail: string;
}

export interface CompletenessResult {
  passed: boolean;
  checks: CompletenessCheck[];
  missingFiles: string[];
  summary: string;
}

export interface DeployGateResult {
  canDeploy: boolean;
  blockers: string[];
  warnings: string[];
  truthGuardPassed: boolean;
  completenessValidatorPassed: boolean;
  noPlaceholdersInCritical: boolean;
  confidenceScore?: number;
  genericContentViolations?: number;
  contradictionsResolved?: boolean;
}

// ============================================================================
// COMPLETENESS VALIDATOR
// ============================================================================

/**
 * Validate that the site output contains all required pages and files.
 *
 * @param fileNames  — Array of file paths/names produced by the TBWO run
 * @param brief      — The approved SiteBrief (for navPages check)
 */
export function validateCompleteness(
  fileNames: string[],
  brief: SiteBrief | null,
): CompletenessResult {
  const checks: CompletenessCheck[] = [];
  const missingFiles: string[] = [];

  const normalizedFiles = new Set(
    fileNames.map(f => f.toLowerCase().replace(/\\/g, '/').replace(/^\.\//, ''))
  );

  // 1. index.html MUST exist
  const hasIndex = normalizedFiles.has('index.html');
  checks.push({
    check: 'index.html exists',
    passed: hasIndex,
    detail: hasIndex ? 'Found index.html' : 'MISSING: index.html is required',
  });
  if (!hasIndex) missingFiles.push('index.html');

  // 2. CSS file must exist
  const hasCSS = [...normalizedFiles].some(f => f.endsWith('.css'));
  checks.push({
    check: 'CSS stylesheet exists',
    passed: hasCSS,
    detail: hasCSS ? 'Found CSS file(s)' : 'MISSING: No CSS stylesheet found',
  });

  // 3. JavaScript file must exist
  const hasJS = [...normalizedFiles].some(f => f.endsWith('.js'));
  checks.push({
    check: 'JavaScript file exists',
    passed: hasJS,
    detail: hasJS ? 'Found JS file(s)' : 'MISSING: No JavaScript file found',
  });

  // 4. Each navPage in brief must have a corresponding HTML file
  if (brief) {
    const navPages = brief.navPages.length > 0 ? brief.navPages : brief.pages;
    for (const pageName of navPages) {
      const expectedFile = pageNameToFile(pageName);
      const found = normalizedFiles.has(expectedFile);
      checks.push({
        check: `Page "${pageName}" (${expectedFile})`,
        passed: found,
        detail: found ? `Found ${expectedFile}` : `MISSING: ${expectedFile}`,
      });
      if (!found) missingFiles.push(expectedFile);
    }
  }

  // 5. Check that HTML files were actually produced (not just markdown)
  const htmlFiles = [...normalizedFiles].filter(f => f.endsWith('.html'));
  const mdFiles = [...normalizedFiles].filter(f => f.endsWith('.md'));
  if (htmlFiles.length === 0 && mdFiles.length > 0) {
    checks.push({
      check: 'HTML output (not just markdown)',
      passed: false,
      detail: 'Frontend render step did not produce HTML outputs — only markdown files found',
    });
  } else if (htmlFiles.length > 0) {
    checks.push({
      check: 'HTML output produced',
      passed: true,
      detail: `${htmlFiles.length} HTML file(s) generated`,
    });
  }

  const passed = checks.every(c => c.passed);
  const failedChecks = checks.filter(c => !c.passed);

  const summary = passed
    ? `Completeness check passed: ${checks.length} checks, all clear.`
    : `Completeness check FAILED: ${failedChecks.length} issue(s) — ${failedChecks.map(c => c.detail).join('; ')}`;

  return { passed, checks, missingFiles, summary };
}

// ============================================================================
// PLACEHOLDER SCANNER
// ============================================================================

/**
 * Scan file contents for PLACEHOLDER or INFERRED markers in critical sections.
 * Critical sections: hero, pricing, social proof, footer trust badges, security.
 */
export function scanForPlaceholders(
  files: Map<string, string>,
): { found: boolean; locations: Array<{ file: string; marker: string; context: string }> } {
  const locations: Array<{ file: string; marker: string; context: string }> = [];

  const PLACEHOLDER_PATTERNS = [
    /\[PLACEHOLDER\]/gi,
    /\[TODO\]/gi,
    /\[REPLACE\]/gi,
    /\[INSERT .+?\]/gi,
    /\[YOUR .+?\]/gi,
    /Acme Corp/gi,
    /john@example\.com/gi,
    /example\.com/gi,
    /\(555\)\s*\d{3}[- ]\d{4}/g,         // Fake phone
    /123 Main St/gi,                       // Fake address
    /Lorem ipsum/gi,
  ];

  // Only scan critical HTML files
  for (const [fileName, content] of files) {
    if (!fileName.endsWith('.html') && !fileName.endsWith('.htm')) continue;

    for (const pattern of PLACEHOLDER_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        // Check if this is in a critical section
        const sectionContext = getCriticalSectionContext(content, match.index);
        if (sectionContext) {
          locations.push({
            file: fileName,
            marker: match[0],
            context: sectionContext,
          });
        }
      }
    }
  }

  return { found: locations.length > 0, locations };
}

/**
 * Check if a match position is within a critical HTML section.
 * Returns section name if yes, null if no.
 */
function getCriticalSectionContext(html: string, matchIndex: number): string | null {
  // Look backward from match to find nearest section/class indicator
  const before = html.slice(Math.max(0, matchIndex - 2000), matchIndex).toLowerCase();

  const criticalPatterns: Array<[RegExp, string]> = [
    [/(?:class|id)="[^"]*hero[^"]*"/g, 'hero section'],
    [/(?:class|id)="[^"]*pricing[^"]*"/g, 'pricing section'],
    [/(?:class|id)="[^"]*testimonial[^"]*"/g, 'testimonials section'],
    [/(?:class|id)="[^"]*social[- ]?proof[^"]*"/g, 'social proof section'],
    [/(?:class|id)="[^"]*trust[^"]*"/g, 'trust badges'],
    [/(?:class|id)="[^"]*security[^"]*"/g, 'security section'],
    [/<footer/g, 'footer'],
    [/(?:class|id)="[^"]*footer[^"]*"/g, 'footer'],
    [/(?:class|id)="[^"]*contact[^"]*"/g, 'contact section'],
    [/<nav/g, 'navigation'],
  ];

  for (const [pattern, sectionName] of criticalPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(before)) return sectionName;
  }

  // Also flag hero-like elements (first main section)
  if (before.includes('<main') && !before.includes('</section')) {
    return 'first section (likely hero)';
  }

  return null;
}

// ============================================================================
// DEPLOY GATE
// ============================================================================

/**
 * Run deploy gate: checks Truth Guard, Completeness, and Placeholder status.
 * Deployment is BLOCKED unless all pass.
 */
export function runDeployGate(
  truthGuardResult: TruthGuardResult,
  completenessResult: CompletenessResult,
  files: Map<string, string>,
  pauseRequests?: Array<{ status: string; contentTag?: string }>,
  cognitiveData?: { confidenceScore?: number; genericViolations?: number; contradictionsResolved?: boolean },
): DeployGateResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  // 1. Truth Guard
  if (!truthGuardResult.passed) {
    const critical = truthGuardResult.violations.filter(v => v.critical && !v.resolved);
    blockers.push(
      `Truth Guard: ${critical.length} unresolved critical claim(s) — ` +
      critical.slice(0, 3).map(v => `"${v.matchedText}" in ${v.file}`).join(', ') +
      (critical.length > 3 ? ` and ${critical.length - 3} more` : '')
    );
  }

  // 2. Completeness
  if (!completenessResult.passed) {
    blockers.push(`Completeness: ${completenessResult.missingFiles.join(', ')} missing`);
  }

  // 3. Placeholder scan
  const placeholderScan = scanForPlaceholders(files);
  if (placeholderScan.found) {
    const criticalLocs = placeholderScan.locations;
    blockers.push(
      `Placeholders in critical sections: ${criticalLocs.slice(0, 3).map(l => `"${l.marker}" in ${l.file} (${l.context})`).join(', ')}` +
      (criticalLocs.length > 3 ? ` and ${criticalLocs.length - 3} more` : '')
    );
  }

  // 4. Check for unresolved pause requests with PLACEHOLDER tag
  if (pauseRequests) {
    const unresolvedPlaceholders = pauseRequests.filter(
      p => p.status === 'pending' || p.contentTag === ContentTag.PLACEHOLDER
    );
    if (unresolvedPlaceholders.length > 0) {
      blockers.push(`${unresolvedPlaceholders.length} unresolved pause request(s) with PLACEHOLDER status`);
    }
  }

  // Non-blocking warnings
  const nonCriticalViolations = truthGuardResult.violations.filter(v => !v.critical && !v.resolved);
  if (nonCriticalViolations.length > 0) {
    warnings.push(`${nonCriticalViolations.length} non-critical truth warning(s)`);
  }

  // 5. Cognitive layer checks (if available)
  let confidenceScore: number | undefined;
  let genericContentViolations: number | undefined;
  let contradictionsResolved: boolean | undefined;

  if (cognitiveData) {
    confidenceScore = cognitiveData.confidenceScore;
    genericContentViolations = cognitiveData.genericViolations;
    contradictionsResolved = cognitiveData.contradictionsResolved;

    if (confidenceScore != null && confidenceScore < 50) {
      blockers.push(`Brief confidence too low: ${confidenceScore}/100 (need 50+)`);
    } else if (confidenceScore != null && confidenceScore < 70) {
      warnings.push(`Brief confidence is moderate: ${confidenceScore}/100`);
    }

    if (genericContentViolations != null && genericContentViolations > 3) {
      blockers.push(`${genericContentViolations} generic content violations found (max 3 allowed)`);
    } else if (genericContentViolations != null && genericContentViolations > 0) {
      warnings.push(`${genericContentViolations} generic content violation(s) detected`);
    }

    if (contradictionsResolved === false) {
      warnings.push('Some contradictions in the brief remain unresolved');
    }
  }

  return {
    canDeploy: blockers.length === 0,
    blockers,
    warnings,
    truthGuardPassed: truthGuardResult.passed,
    completenessValidatorPassed: completenessResult.passed,
    noPlaceholdersInCritical: !placeholderScan.found,
    confidenceScore,
    genericContentViolations,
    contradictionsResolved,
  };
}

// ============================================================================
// PAGESPEC-AWARE VALIDATION
// ============================================================================

import type { PageSpec, SiteValidationReport, SiteValidationIssue } from '../../types/tbwo';

/**
 * Validate artifacts against PageSpec. Checks that every route has HTML,
 * every section spec is represented, and nav is consistent.
 */
export function validateAgainstPageSpec(
  artifacts: Map<string, string>,
  pageSpec: PageSpec,
): SiteValidationReport {
  const issues: SiteValidationIssue[] = [];
  const normalizedArtifacts = new Map<string, string>();
  for (const [path, content] of artifacts) {
    normalizedArtifacts.set(path.toLowerCase().replace(/\\/g, '/').replace(/^\.\//, ''), content);
  }

  // 1. Check every route in PageSpec has a corresponding HTML file
  for (const route of pageSpec.routes) {
    const fileName = route.fileName.toLowerCase();
    if (!normalizedArtifacts.has(fileName)) {
      issues.push({
        severity: 'error',
        file: route.fileName,
        rule: 'MISSING_PAGE',
        message: `Route "${route.route}" (${route.fileName}) defined in PageSpec but no HTML artifact found`,
        fix: `Create ${route.fileName} with sections: ${route.sections.map(s => s.type).join(', ')}`,
      });
    }
  }

  // 2. Check nav consistency across all HTML files
  const navIssues = validateNavConsistency(normalizedArtifacts, pageSpec);
  issues.push(...navIssues);

  // 3. Check internal links
  const linkIssues = validateInternalLinks(normalizedArtifacts);
  issues.push(...linkIssues);

  // 4. Placeholder scan
  const placeholderPatterns = [
    /\[PLACEHOLDER\]/gi, /\[TODO\]/gi, /\[INSERT .+?\]/gi,
    /\[YOUR .+?\]/gi, /Lorem ipsum/gi, /example\.com/gi,
  ];
  for (const [fileName, content] of normalizedArtifacts) {
    if (!fileName.endsWith('.html')) continue;
    for (const pattern of placeholderPatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const lineNum = content.slice(0, match.index).split('\n').length;
        issues.push({
          severity: 'error',
          file: fileName,
          line: lineNum,
          rule: 'PLACEHOLDER_TEXT',
          message: `Found "${match[0]}" — placeholders block deployment`,
          fix: 'Replace with real content from the site brief',
        });
      }
    }
  }

  // 5. Check product name consistency
  if (pageSpec.productName) {
    for (const [fileName, content] of normalizedArtifacts) {
      if (!fileName.endsWith('.html')) continue;
      if (!content.includes(pageSpec.productName)) {
        issues.push({
          severity: 'warning',
          file: fileName,
          rule: 'PRODUCT_NAME_MISSING',
          message: `Product name "${pageSpec.productName}" not found in ${fileName}`,
          fix: `Ensure the product name appears in the page title, nav, or content`,
        });
      }
    }
  }

  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;
  const score = Math.max(0, 100 - (errorCount * 15) - (warningCount * 5));

  return {
    passed: errorCount === 0,
    score,
    issues,
    summary: errorCount === 0
      ? `Validation passed with ${warningCount} warning(s). Score: ${score}/100`
      : `${errorCount} error(s), ${warningCount} warning(s). Fix errors before deployment. Score: ${score}/100`,
  };
}

/**
 * Check that all HTML files have consistent navigation structure.
 */
function validateNavConsistency(
  artifacts: Map<string, string>,
  pageSpec: PageSpec,
): SiteValidationIssue[] {
  const issues: SiteValidationIssue[] = [];
  const htmlFiles = [...artifacts.entries()].filter(([f]) => f.endsWith('.html'));

  if (htmlFiles.length < 2) return issues;

  const expectedNavItems = pageSpec.globalNav?.items || [];
  if (expectedNavItems.length === 0) return issues;

  for (const [fileName, content] of htmlFiles) {
    const navMatch = content.match(/<nav[\s\S]*?<\/nav>/i);
    if (!navMatch) {
      issues.push({
        severity: 'error',
        file: fileName,
        rule: 'MISSING_NAV',
        message: `No <nav> element found in ${fileName}`,
        fix: 'Add navigation matching the global nav spec',
      });
      continue;
    }

    const navHtml = navMatch[0].toLowerCase();
    for (const item of expectedNavItems) {
      const href = item.href.toLowerCase();
      if (!navHtml.includes(href)) {
        issues.push({
          severity: 'warning',
          file: fileName,
          rule: 'NAV_LINK_MISSING',
          message: `Nav link to "${item.label}" (${item.href}) missing in ${fileName}`,
          fix: `Add <a href="${item.href}">${item.label}</a> to nav`,
        });
      }
    }
  }

  return issues;
}

/**
 * Check that internal links between pages resolve to existing artifacts.
 */
function validateInternalLinks(artifacts: Map<string, string>): SiteValidationIssue[] {
  const issues: SiteValidationIssue[] = [];
  const htmlFiles = [...artifacts.entries()].filter(([f]) => f.endsWith('.html'));
  const existingFiles = new Set(artifacts.keys());

  for (const [fileName, content] of htmlFiles) {
    const hrefPattern = /href="([^"#][^"]*?)"/gi;
    let match;
    while ((match = hrefPattern.exec(content)) !== null) {
      const href = match[1]!;
      // Skip external links, anchors, mailto, tel, javascript
      if (/^(https?:|mailto:|tel:|javascript:)/i.test(href)) continue;

      const normalized = href.toLowerCase().replace(/^\.\//, '').replace(/^\//, '');
      if (normalized && !existingFiles.has(normalized) && !normalized.includes('#')) {
        const lineNum = content.slice(0, match.index).split('\n').length;
        issues.push({
          severity: 'warning',
          file: fileName,
          line: lineNum,
          rule: 'BROKEN_INTERNAL_LINK',
          message: `Link to "${href}" but no matching file found`,
          fix: `Create ${normalized} or fix the href`,
        });
      }
    }
  }

  return issues;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Convert page name to expected HTML filename.
 * "Home" → "index.html", "About Us" → "about-us.html"
 */
function pageNameToFile(name: string): string {
  const lower = name.toLowerCase().trim();
  if (lower === 'home' || lower === 'index' || lower === 'homepage') return 'index.html';
  return lower.replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') + '.html';
}
