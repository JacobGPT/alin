#!/usr/bin/env node
/**
 * ALIN SiteModel Check — CLI utility
 *
 * Usage:
 *   node scripts/siteModelCheck.mjs <path-to-site-directory>
 *
 * Reads alin.site.json from the given directory (or infers a model from
 * the file structure) and prints validation results + summary.
 *
 * Examples:
 *   node scripts/siteModelCheck.mjs output/tbwo/my-website
 *   node scripts/siteModelCheck.mjs ./dist
 */

import { readFile, stat } from 'fs/promises';
import { join } from 'path';

const MANIFEST_FILENAME = 'alin.site.json';

// ---- Arg parsing ----
const targetPath = process.argv[2];
if (!targetPath) {
  console.error('Usage: node scripts/siteModelCheck.mjs <path-to-site-directory>');
  process.exit(1);
}

// ---- Main ----
async function main() {
  const absPath = join(process.cwd(), targetPath);

  // Check directory exists
  try {
    const s = await stat(absPath);
    if (!s.isDirectory()) {
      console.error(`Error: "${absPath}" is not a directory`);
      process.exit(1);
    }
  } catch {
    console.error(`Error: "${absPath}" does not exist`);
    process.exit(1);
  }

  const manifestPath = join(absPath, MANIFEST_FILENAME);
  let manifest;
  let source = 'manifest';

  try {
    const raw = await readFile(manifestPath, 'utf-8');
    manifest = JSON.parse(raw);

    if (manifest.$schema !== 'alin-site-manifest' || !manifest.site) {
      console.error('Error: Invalid alin.site.json — missing $schema or site payload');
      process.exit(1);
    }

    console.log(`\nFound ${MANIFEST_FILENAME} (v${manifest.manifestVersion})`);
    console.log(`Generated: ${manifest.generatedAt}`);
    console.log(`Generator: ${manifest.generator}\n`);
  } catch {
    console.log(`\nNo ${MANIFEST_FILENAME} found in "${targetPath}".`);
    console.log('Run a Website Sprint to generate one, or create it manually.\n');
    source = 'none';

    // Quick directory scan for HTML files
    const { readdir } = await import('fs/promises');
    try {
      const entries = await readdir(join(absPath, 'site'));
      const htmlFiles = entries.filter(e => e.endsWith('.html'));
      if (htmlFiles.length > 0) {
        console.log(`Found ${htmlFiles.length} HTML file(s) in site/:  ${htmlFiles.join(', ')}`);
        console.log('Tip: Run a Website Sprint with SiteModel enabled to get a manifest.\n');
      }
    } catch {
      try {
        const entries = await readdir(absPath);
        const htmlFiles = entries.filter(e => e.endsWith('.html'));
        if (htmlFiles.length > 0) {
          console.log(`Found ${htmlFiles.length} HTML file(s):  ${htmlFiles.join(', ')}\n`);
        }
      } catch { /* ignore */ }
    }
    process.exit(0);
  }

  // ---- Validate ----
  const site = manifest.site;
  const errors = [];
  const warnings = [];

  // Required fields
  if (!site.id) errors.push('Missing site.id');
  if (!site.name) errors.push('Missing site.name');
  if (!site.version) errors.push('Missing site.version');
  if (!site.pages || site.pages.length === 0) errors.push('No pages defined');

  // Route uniqueness
  const routes = new Set();
  for (const page of (site.pages || [])) {
    const norm = (page.route || '/').toLowerCase().replace(/\/+$/, '') || '/';
    if (routes.has(norm)) errors.push(`Duplicate route: "${page.route}"`);
    routes.add(norm);
  }

  // Homepage check
  const hasHome = (site.pages || []).some(p =>
    p.route === '/' || p.route === '/index' || p.route === '/index.html'
  );
  if (!hasHome) warnings.push('No homepage (route "/")');

  // Hero on homepage
  const homepage = (site.pages || []).find(p =>
    p.route === '/' || p.route === '/index'
  );
  if (homepage) {
    const hasHero = (homepage.sections || []).some(s => s.type === 'hero');
    if (!hasHero) warnings.push('Homepage missing hero section');
  }

  // Per-page checks
  for (let i = 0; i < (site.pages || []).length; i++) {
    const page = site.pages[i];
    if (!page.title) warnings.push(`pages[${i}]: missing title`);
    if (!page.route) errors.push(`pages[${i}]: missing route`);
    if (!page.route?.startsWith('/')) errors.push(`pages[${i}]: route must start with "/"`);
    if (!page.sections?.length) warnings.push(`pages[${i}] "${page.title}": no sections`);

    // Check blocks in sections
    for (const section of (page.sections || [])) {
      for (const block of (section.blocks || [])) {
        if (block.type === 'button' && !block.content?.label) {
          errors.push(`pages[${i}] > ${section.type}: button has empty label`);
        }
        if (block.type === 'pricing-table') {
          for (const plan of (block.content?.plans || [])) {
            if (!plan.currency) errors.push(`pages[${i}] > pricing: plan "${plan.name}" missing currency`);
            if (!plan.price && plan.price !== '0') errors.push(`pages[${i}] > pricing: plan "${plan.name}" missing price`);
          }
        }
      }
    }
  }

  // Provenance — check for PLACEHOLDERs on critical fields
  function scanProvenance(prov, context) {
    if (!prov) return;
    for (const [field, tag] of Object.entries(prov)) {
      if (tag === 'PLACEHOLDER') {
        const isCritical = /price|checkout|href|stripe|cta/i.test(field);
        if (isCritical) {
          warnings.push(`PLACEHOLDER on critical field: ${context}.${field}`);
        } else {
          warnings.push(`PLACEHOLDER: ${context}.${field}`);
        }
      }
    }
  }

  scanProvenance(site.provenance, 'model');
  for (const page of (site.pages || [])) {
    scanProvenance(page.provenance, `page "${page.title}"`);
    for (const section of (page.sections || [])) {
      scanProvenance(section.provenance, `page "${page.title}" > ${section.type}`);
      for (const block of (section.blocks || [])) {
        scanProvenance(block.provenance, `page "${page.title}" > ${section.type} > ${block.type}`);
      }
    }
  }

  // ---- Print results ----
  console.log('='.repeat(60));
  console.log(`  Site: ${site.name}`);
  console.log(`  Framework: ${site.framework}`);
  console.log(`  Pages: ${(site.pages || []).length}`);
  console.log(`  Deploy target: ${site.deployment?.provider || 'none'}`);
  console.log(`  TBWO: ${site.tbwoId || 'n/a'}`);
  console.log('='.repeat(60));

  // Page summary
  console.log('\nPages:');
  for (const page of (site.pages || [])) {
    const sectionCount = (page.sections || []).length;
    const blockCount = (page.sections || []).reduce((sum, s) => sum + (s.blocks?.length || 0), 0);
    const status = page.status || 'draft';
    console.log(`  ${page.route.padEnd(20)} ${page.title.padEnd(20)} ${sectionCount} sections  ${blockCount} blocks  [${status}]`);
  }

  // Theme
  if (site.theme?.colors) {
    const c = site.theme.colors;
    console.log(`\nTheme: primary=${c.primary}  secondary=${c.secondary}  text=${c.text}`);
  }

  // Errors & warnings
  if (errors.length > 0) {
    console.log(`\n\x1b[31mErrors (${errors.length}):\x1b[0m`);
    for (const e of errors) console.log(`  \x1b[31m✗\x1b[0m ${e}`);
  }

  if (warnings.length > 0) {
    console.log(`\n\x1b[33mWarnings (${warnings.length}):\x1b[0m`);
    for (const w of warnings) console.log(`  \x1b[33m!\x1b[0m ${w}`);
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log(`\n\x1b[32m✓ Valid — no errors or warnings\x1b[0m`);
  } else if (errors.length === 0) {
    console.log(`\n\x1b[32m✓ Valid\x1b[0m (${warnings.length} warning${warnings.length > 1 ? 's' : ''})`);
  } else {
    console.log(`\n\x1b[31m✗ Invalid\x1b[0m (${errors.length} error${errors.length > 1 ? 's' : ''}, ${warnings.length} warning${warnings.length > 1 ? 's' : ''})`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
