/**
 * TBWO Optimization Slice — Section regeneration, improvement application
 */

import type { SectionRegenerationRequest, SectionRegenerationResult } from '../../types/tbwo';

export function createOptimizationSlice(set: any, get: any) {
  return {
    regenerateSection: async (tbwoId: string, request: SectionRegenerationRequest): Promise<SectionRegenerationResult> => {
      const tbwo = get().tbwos.get(tbwoId);
      if (!tbwo) throw new Error('TBWO not found');

      const { regenerateSection: regenFn, replaceSectionInHtml } = await import('../../products/sites/sectionRegenService');

      // Find CSS content for context
      let cssContent = '';
      for (const art of tbwo.artifacts || []) {
        if ((art.path || '').endsWith('.css') && typeof art.content === 'string') {
          cssContent += art.content + '\n';
        }
      }

      const result = await regenFn(request, cssContent);

      if (result.success) {
        // Update the artifact content with the new section
        set((state: any) => {
          const t = state.tbwos.get(tbwoId);
          if (!t) return;
          const artIndex = (t.artifacts || []).findIndex((a: any) => a.path === request.artifactPath);
          if (artIndex >= 0) {
            const art = t.artifacts[artIndex];
            if (typeof art.content === 'string') {
              art.content = replaceSectionInHtml(art.content, request.sectionSelector, result.newHtml);
              art.version = (art.version || 1) + 1;
            }
          }
          t.updatedAt = Date.now();
        });
      }

      return result;
    },

    applyImprovements: async (tbwoId: string, improvementIds: string[]): Promise<{ applied: number; failed: number }> => {
      const tbwo = get().tbwos.get(tbwoId);
      if (!tbwo) throw new Error('TBWO not found');

      const report = tbwo.metadata?.improvementReport as import('../../types/tbwo').SiteImprovementReport | undefined;
      if (!report) throw new Error('No improvement report found');

      let applied = 0;
      let failed = 0;

      for (const impId of improvementIds) {
        const imp = report.improvements.find((i: any) => i.id === impId);
        if (!imp || !imp.enabled || imp.applied) continue;

        try {
          // Find the HTML artifact for this page
          const htmlArt = (tbwo.artifacts || []).find((a: any) =>
            (a.path || '').endsWith('.html') && (a.path || '').includes(imp.page.replace('.html', '')),
          );
          if (!htmlArt || typeof htmlArt.content !== 'string') {
            failed++;
            continue;
          }

          // Extract the actual section HTML (not the full page)
          const { extractSectionFromHtml } = await import('../../products/sites/sectionRegenService');
          const extracted = extractSectionFromHtml(htmlArt.content, imp.fixAction.sectionSelector);
          const sectionHtml = extracted?.html || htmlArt.content.slice(0, 5000);

          const request: SectionRegenerationRequest = {
            tbwoId,
            artifactPath: htmlArt.path || '',
            sectionSelector: imp.fixAction.sectionSelector,
            sectionHtml,
            action: 'custom',
            customInstruction: imp.fixAction.instruction,
          };

          const result = await get().regenerateSection(tbwoId, request);
          if (result.success) {
            applied++;
            // Mark improvement as applied
            set((state: any) => {
              const t = state.tbwos.get(tbwoId);
              if (!t?.metadata?.improvementReport) return;
              const r = t.metadata.improvementReport as import('../../types/tbwo').SiteImprovementReport;
              const idx = r.improvements.findIndex((i: any) => i.id === impId);
              if (idx >= 0) {
                r.improvements[idx].applied = true;
                r.appliedCount = (r.appliedCount || 0) + 1;
              }
            });
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      }

      return { applied, failed };
    },
  };
}
