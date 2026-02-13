/**
 * Static Site Build Service
 *
 * Given a workspace/site directory, runs install + build if a package.json exists.
 * Falls back to serving the directory as-is for plain HTML sites.
 *
 * Static-first only. Next.js allowed only as `next export` (static output).
 */

import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';

/**
 * Build a static site from a workspace directory.
 *
 * @param {string} siteDir — absolute path to the site's files
 * @param {function} [onProgress] — optional progress callback: (step, detail?) => void
 * @returns {{ outputDir: string, buildLog: string }}
 */
export async function buildStaticSite(siteDir, onProgress) {
  let buildLog = '';

  // Check if there's a package.json (framework project)
  const pkgPath = path.join(siteDir, 'package.json');
  let hasPkg = false;
  try {
    await fs.access(pkgPath);
    hasPkg = true;
  } catch { /* no package.json */ }

  if (!hasPkg) {
    // Plain HTML/CSS/JS — the directory IS the output
    buildLog += 'No package.json found. Using directory as static output.\n';

    // Check for a site/ subdirectory (ALIN Website Sprint layout)
    const siteSubdir = path.join(siteDir, 'site');
    try {
      const stat = await fs.stat(siteSubdir);
      if (stat.isDirectory()) {
        buildLog += 'Found site/ subdirectory, using as output root.\n';
        if (onProgress) onProgress('built', { outputDir: 'site' });
        return { outputDir: siteSubdir, buildLog };
      }
    } catch { /* no site/ subdir */ }

    if (onProgress) onProgress('built', { outputDir: '.' });
    return { outputDir: siteDir, buildLog };
  }

  // Read package.json to determine framework
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
  const scripts = pkg.scripts || {};

  try {
    // Install dependencies
    if (onProgress) onProgress('installing');
    buildLog += '> npm ci --production=false\n';
    const installOut = execSync('npm ci --production=false', {
      cwd: siteDir,
      timeout: 120_000,
      stdio: 'pipe',
      env: { ...process.env, NODE_ENV: 'production' },
    });
    buildLog += installOut.toString().slice(-500) + '\n';
  } catch (err) {
    // Fallback to npm install
    try {
      buildLog += '> npm install (fallback)\n';
      execSync('npm install', {
        cwd: siteDir,
        timeout: 120_000,
        stdio: 'pipe',
      });
    } catch (installErr) {
      buildLog += `Install failed: ${installErr.message}\n`;
      throw new Error(`npm install failed: ${installErr.message}`);
    }
  }

  // Determine build command
  let buildCmd = 'npm run build';
  if (scripts.export) {
    buildCmd = 'npm run export'; // Next.js static export
  } else if (scripts['build:static']) {
    buildCmd = 'npm run build:static';
  }

  try {
    if (onProgress) onProgress('compiling');
    buildLog += `> ${buildCmd}\n`;
    const buildOut = execSync(buildCmd, {
      cwd: siteDir,
      timeout: 300_000, // 5 min max
      stdio: 'pipe',
      env: { ...process.env, NODE_ENV: 'production' },
    });
    buildLog += buildOut.toString().slice(-500) + '\n';
  } catch (err) {
    buildLog += `Build failed: ${err.message}\n`;
    throw new Error(`Build failed: ${err.message}`);
  }

  // Detect output directory (priority order)
  const candidates = ['out', 'dist', 'build', '.next/static', 'public'];
  for (const candidate of candidates) {
    const candidatePath = path.join(siteDir, candidate);
    try {
      const stat = await fs.stat(candidatePath);
      if (stat.isDirectory()) {
        buildLog += `Output directory: ${candidate}/\n`;
        if (onProgress) onProgress('built', { outputDir: candidate });
        return { outputDir: candidatePath, buildLog };
      }
    } catch { /* not found */ }
  }

  // Fallback: use siteDir itself
  buildLog += 'No build output directory detected. Using project root.\n';
  if (onProgress) onProgress('built', { outputDir: '.' });
  return { outputDir: siteDir, buildLog };
}
