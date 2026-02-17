import type { Artifact } from '../../../types/tbwo';

export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Inline CSS and JS artifacts into an HTML string for self-contained preview.
 * Handles various href/src patterns: relative paths, absolute paths, bare filenames.
 * Falls back to injecting ALL CSS/JS before </head> if no link/script tags matched.
 */
export function inlineAssetsIntoHtml(html: string, artifacts: Artifact[]): string {
  let result = html;

  // Inline CSS files — track which artifacts were matched to inject unmatched ones
  const cssArtifacts = artifacts.filter(a => (a.path || '').endsWith('.css'));
  const matchedCssIds = new Set<string>();
  for (const css of cssArtifacts) {
    const filename = (css.path || '').split('/').pop() || '';
    if (!filename) continue;
    const cssContent = typeof css.content === 'string' ? css.content : '';
    const linkRegex = new RegExp(
      `<link[^>]*href=["'][^"']*${escapeRegExp(filename)}["'][^>]*/?>`,
      'gi'
    );
    const before = result;
    result = result.replace(linkRegex, `<style>${cssContent}</style>`);
    if (result !== before) matchedCssIds.add(css.id);
  }
  // Inject UNMATCHED CSS artifacts before </head> (not just when zero matched)
  const unmatchedCss = cssArtifacts.filter(css => !matchedCssIds.has(css.id));
  if (unmatchedCss.length > 0) {
    const extraCss = unmatchedCss
      .map(css => typeof css.content === 'string' ? css.content : '')
      .filter(Boolean)
      .join('\n');
    if (extraCss) {
      const headClose = result.indexOf('</head>');
      if (headClose >= 0) {
        result = result.slice(0, headClose) + `<style>${extraCss}</style>\n` + result.slice(headClose);
      } else {
        result = `<style>${extraCss}</style>\n` + result;
      }
    }
  }

  // Inline JS files — track which artifacts were matched to inject unmatched ones
  const jsArtifacts = artifacts.filter(a => (a.path || '').endsWith('.js'));
  const matchedJsIds = new Set<string>();
  for (const js of jsArtifacts) {
    const filename = (js.path || '').split('/').pop() || '';
    if (!filename) continue;
    const jsContent = typeof js.content === 'string' ? js.content : '';
    const scriptRegex = new RegExp(
      `<script[^>]*src=["'][^"']*${escapeRegExp(filename)}["'][^>]*>\\s*</script>`,
      'gi'
    );
    const before = result;
    result = result.replace(scriptRegex, `<script>${jsContent}</script>`);
    if (result !== before) matchedJsIds.add(js.id);
  }
  // Inject UNMATCHED JS artifacts before </body>
  const unmatchedJs = jsArtifacts.filter(js => !matchedJsIds.has(js.id));
  if (unmatchedJs.length > 0) {
    const extraJs = unmatchedJs
      .map(js => typeof js.content === 'string' ? js.content : '')
      .filter(Boolean)
      .join('\n');
    if (extraJs) {
      const bodyClose = result.indexOf('</body>');
      if (bodyClose >= 0) {
        result = result.slice(0, bodyClose) + `<script>${extraJs}</script>\n` + result.slice(bodyClose);
      } else {
        result += `\n<script>${extraJs}</script>`;
      }
    }
  }

  return result;
}
