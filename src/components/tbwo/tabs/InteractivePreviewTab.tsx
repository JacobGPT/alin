import { useState, useMemo, useEffect } from 'react';
import {
  DevicePhoneMobileIcon,
  ComputerDesktopIcon,
  ArrowTopRightOnSquareIcon,
  RocketLaunchIcon,
  EyeIcon,
  ArrowPathIcon,
  ArrowDownTrayIcon,
  XCircleIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';

import type { TBWO, Artifact, LayoutVariant, SectionRegenerationAction } from '../../../types/tbwo';
import { Button } from '@components/ui/Button';
import { useTBWOStore } from '@store/tbwoStore';
import { useSitesStore } from '@store/sitesStore';
import { inlineAssetsIntoHtml } from '../utils/assetInliner';
import { downloadTBWOZip } from '../../../services/tbwo/zipService';

export function InteractivePreviewTab({ tbwo }: { tbwo: TBWO }) {
  const artifacts = tbwo.artifacts || [];
  const htmlArtifacts = artifacts.filter(a => (a.path || '').endsWith('.html'));
  const isLive = ['executing', 'paused', 'paused_waiting_for_user'].includes(tbwo.status);
  const [selectedPage, setSelectedPage] = useState(htmlArtifacts[0]?.path || '');
  const [viewMode, setViewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [isDownloading, setIsDownloading] = useState(false);
  const [motionIntensity, setMotionIntensity] = useState<'minimal' | 'standard' | 'premium'>(
    (tbwo.metadata?.motionIntensity as 'minimal' | 'standard' | 'premium') || 'standard'
  );
  const [sectionPopover, setSectionPopover] = useState<{
    sectionHtml: string;
    sectionSelector: string;
    rect: { top: number; left: number };
  } | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenAction, setRegenAction] = useState<string>('');
  const [customInstruction, setCustomInstruction] = useState('');
  const [showLayoutPicker, setShowLayoutPicker] = useState(false);
  const [layoutVariants, setLayoutVariants] = useState<LayoutVariant[]>([]);

  const regenerateSection = useTBWOStore((state) => state.regenerateSection);

  // Auto-select first page when artifacts appear, or keep selection
  useEffect(() => {
    if (htmlArtifacts.length > 0 && !htmlArtifacts.find(a => a.path === selectedPage)) {
      setSelectedPage(htmlArtifacts[0]?.path || '');
    }
  }, [htmlArtifacts.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedArtifact = htmlArtifacts.find(a => a.path === selectedPage);

  // Build preview HTML with section interaction script injected
  const previewHtml = useMemo(() => {
    if (!selectedArtifact || typeof selectedArtifact.content !== 'string') return '';
    let html = inlineAssetsIntoHtml(selectedArtifact.content, artifacts);

    // Inject section interaction script before </body>
    const interactionScript = `
<script>
(function() {
  var sections = document.querySelectorAll('section, [class*="hero"], [class*="feature"], [class*="pricing"], [class*="testimonial"], [class*="cta"], [class*="faq"], [class*="footer"]');
  var overlay = null;
  sections.forEach(function(el, i) {
    el.addEventListener('mouseenter', function(e) {
      if (overlay) overlay.remove();
      overlay = document.createElement('div');
      overlay.style.cssText = 'position:absolute;top:'+el.offsetTop+'px;left:'+el.offsetLeft+'px;width:'+el.offsetWidth+'px;height:'+el.offsetHeight+'px;border:2px solid #3b82f6;pointer-events:none;z-index:9999;border-radius:8px;';
      var label = document.createElement('div');
      label.textContent = 'Edit Section';
      label.style.cssText = 'position:absolute;top:-28px;right:8px;background:#3b82f6;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-family:system-ui;';
      overlay.appendChild(label);
      document.body.appendChild(overlay);
    });
    el.addEventListener('mouseleave', function() {
      if (overlay) { overlay.remove(); overlay = null; }
    });
    el.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      var sectionType = (el.className.match(/hero|feature|pricing|testimonial|cta|faq|footer|about|team/) || ['section'])[0];
      var selector = el.tagName.toLowerCase() + ':nth-of-type(' + (i+1) + ')';
      if (el.id) selector = '#' + el.id;
      else if (el.className) {
        var cls = el.className.split(' ').find(function(c) { return /hero|feature|pricing|testimonial|cta|faq|footer|about/.test(c); });
        if (cls) selector = el.tagName.toLowerCase() + '.' + cls;
      }
      window.parent.postMessage({
        type: 'alin-section-click',
        sectionType: sectionType,
        sectionHtml: el.outerHTML,
        sectionSelector: selector,
        rect: el.getBoundingClientRect()
      }, '*');
    });
  });
})();
</script>`;
    html = html.replace('</body>', interactionScript + '</body>');
    return html;
  }, [selectedArtifact, artifacts]);

  // Listen for section clicks from iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'alin-section-click') {
        setSectionPopover({
          sectionHtml: e.data.sectionHtml,
          sectionSelector: e.data.sectionSelector,
          rect: { top: 200, left: 400 },
        });

        // Load layout variants for this section type
        import('../../../products/sites/layoutVariants').then(({ getLayoutVariantsForSection }) => {
          setLayoutVariants(getLayoutVariantsForSection(e.data.sectionType || 'hero'));
        });
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const handleRegenerate = async (action: SectionRegenerationAction, instruction?: string) => {
    if (!sectionPopover || !selectedPage) return;
    setIsRegenerating(true);
    setRegenAction(action);
    try {
      await regenerateSection(tbwo.id, {
        tbwoId: tbwo.id,
        artifactPath: selectedPage,
        sectionSelector: sectionPopover.sectionSelector,
        sectionHtml: sectionPopover.sectionHtml,
        action,
        customInstruction: instruction,
      });
      setSectionPopover(null);
    } catch (err) {
      console.error('[Preview] Section regen failed:', err);
    } finally {
      setIsRegenerating(false);
      setRegenAction('');
    }
  };

  const handleDownloadZip = async () => {
    setIsDownloading(true);
    try { await downloadTBWOZip(tbwo, tbwo.receipts); } catch (e) { console.error(e); } finally { setIsDownloading(false); }
  };

  if (htmlArtifacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        {isLive ? (
          <>
            <ArrowPathIcon className="mb-4 h-12 w-12 animate-spin text-brand-primary" />
            <h3 className="mb-2 font-semibold text-text-primary">Building pages...</h3>
            <p className="text-sm text-text-tertiary">Preview will appear automatically once pods create HTML files</p>
          </>
        ) : (
          <>
            <EyeIcon className="mb-4 h-12 w-12 text-text-tertiary" />
            <h3 className="mb-2 font-semibold text-text-primary">No Pages to Preview</h3>
            <p className="text-sm text-text-tertiary">HTML pages will appear here when the sprint completes</p>
          </>
        )}
      </div>
    );
  }

  const ACTIONS: Array<{ action: SectionRegenerationAction; label: string; color: string }> = [
    { action: 'improve_conversion', label: 'Improve Conversion', color: 'text-green-400' },
    { action: 'rewrite_tone', label: 'Rewrite Tone', color: 'text-blue-400' },
    { action: 'make_premium', label: 'Make Premium', color: 'text-purple-400' },
    { action: 'make_aggressive', label: 'Make Aggressive', color: 'text-red-400' },
    { action: 'shorten_copy', label: 'Shorten Copy', color: 'text-yellow-400' },
    { action: 'add_social_proof', label: 'Add Social Proof', color: 'text-cyan-400' },
    { action: 'add_urgency', label: 'Add Urgency', color: 'text-orange-400' },
  ];

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between rounded-xl border border-border-primary bg-background-secondary p-4">
        <div className="flex items-center gap-3">
          <select value={selectedPage} onChange={(e) => setSelectedPage(e.target.value)}
            className="rounded-lg border border-border-primary bg-background-tertiary px-3 py-1.5 text-sm text-text-primary focus:border-brand-primary focus:outline-none">
            {htmlArtifacts.map((a) => {
              const rawName = (a.path || a.name || 'Page').split('/').pop() || 'Page';
              const cleanName = rawName.replace(/\.html?$/i, '').replace(/[-_]/g, ' ');
              return <option key={a.id} value={a.path}>{cleanName.charAt(0).toUpperCase() + cleanName.slice(1)}</option>;
            })}
          </select>
          <div className="flex rounded-lg border border-border-primary overflow-hidden">
            <button onClick={() => setViewMode('desktop')} className={`flex items-center gap-1 px-2.5 py-1.5 text-xs ${viewMode === 'desktop' ? 'bg-brand-primary text-white' : 'bg-background-tertiary text-text-secondary hover:bg-background-hover'}`}>
              <ComputerDesktopIcon className="h-3.5 w-3.5" /> Desktop
            </button>
            <button onClick={() => setViewMode('mobile')} className={`flex items-center gap-1 px-2.5 py-1.5 text-xs ${viewMode === 'mobile' ? 'bg-brand-primary text-white' : 'bg-background-tertiary text-text-secondary hover:bg-background-hover'}`}>
              <DevicePhoneMobileIcon className="h-3.5 w-3.5" /> Mobile
            </button>
          </div>
          {/* Motion Intensity Toggle */}
          <div className="flex items-center gap-1.5 ml-2">
            <SparklesIcon className="h-3.5 w-3.5 text-text-quaternary" />
            <div className="flex rounded-lg border border-border-primary overflow-hidden">
              {(['minimal', 'standard', 'premium'] as const).map((level) => (
                <button
                  key={level}
                  onClick={() => {
                    setMotionIntensity(level);
                    useTBWOStore.getState().updateTBWO(tbwo.id, { metadata: { ...tbwo.metadata, motionIntensity: level } });
                  }}
                  className={`px-2 py-1.5 text-xs capitalize ${
                    motionIntensity === level
                      ? 'bg-brand-primary text-white'
                      : 'bg-background-tertiary text-text-secondary hover:bg-background-hover'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { const blob = new Blob([previewHtml], { type: 'text/html' }); window.open(URL.createObjectURL(blob), '_blank'); }}
            className="flex items-center gap-1 text-xs text-brand-primary hover:underline">
            <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" /> Open in New Tab
          </button>
          <button onClick={handleDownloadZip} disabled={isDownloading}
            className="flex items-center gap-1 text-xs text-brand-primary hover:underline disabled:opacity-50">
            <ArrowDownTrayIcon className="h-3.5 w-3.5" /> {isDownloading ? 'Zipping...' : 'Download ZIP'}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <p className="text-xs text-text-tertiary">Click any section in the preview to edit it with AI</p>
        {isLive && (
          <span className="flex items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
            LIVE — updating as pods build
          </span>
        )}
      </div>

      {/* Preview iframe */}
      <div className="relative flex justify-center rounded-xl border border-border-primary bg-[#f5f5f5] p-4" style={{ minHeight: '640px' }}>
        <div className={`bg-white shadow-xl rounded-lg overflow-hidden transition-all ${viewMode === 'mobile' ? 'w-[375px]' : 'w-full max-w-[1200px]'}`} style={{ height: '640px' }}>
          <div className="flex items-center gap-2 bg-[#e8e8e8] px-3 py-2 border-b border-[#d0d0d0]">
            <div className="flex gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <div className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
              <div className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            </div>
            <div className="flex-1 mx-2 rounded-md bg-white px-3 py-1 text-xs text-[#999] text-center truncate">
              {selectedPage ? selectedPage.split('/').pop()?.replace(/\.html?$/i, '') || 'preview' : 'preview'}
            </div>
          </div>
          <iframe srcDoc={previewHtml} className="w-full border-0" style={{ height: 'calc(100% - 36px)' }} sandbox="allow-scripts" title="Site Preview" />
        </div>

        {/* Section Action Popover */}
        {sectionPopover && (
          <div className="absolute right-4 top-4 z-20 w-72 rounded-xl border border-border-primary bg-background-secondary p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-text-primary">Section Actions</h4>
              <button onClick={() => setSectionPopover(null)} className="text-text-tertiary hover:text-text-primary">
                <XCircleIcon className="h-4 w-4" />
              </button>
            </div>

            {isRegenerating ? (
              <div className="flex items-center gap-2 py-4 text-sm text-text-secondary">
                <ArrowPathIcon className="h-4 w-4 animate-spin" />
                <span>Regenerating section...</span>
              </div>
            ) : (
              <div className="space-y-1">
                {ACTIONS.map(({ action, label, color }) => (
                  <button key={action} onClick={() => handleRegenerate(action)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-background-hover transition-colors ${color}`}>
                    {label}
                  </button>
                ))}

                {/* Layout Switcher */}
                <button onClick={() => setShowLayoutPicker(!showLayoutPicker)}
                  className="w-full rounded-lg px-3 py-2 text-left text-sm text-text-secondary hover:bg-background-hover">
                  Change Layout {showLayoutPicker ? '\u25B2' : '\u25BC'}
                </button>
                {showLayoutPicker && layoutVariants.length > 0 && (
                  <div className="ml-2 space-y-1 border-l-2 border-border-primary pl-2">
                    {layoutVariants.map(v => (
                      <button key={v.id} onClick={() => handleRegenerate('switch_layout', v.id)}
                        className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-text-secondary hover:bg-background-hover">
                        <span className="font-medium">{v.name}</span>
                        <p className="text-text-quaternary">{v.description}</p>
                      </button>
                    ))}
                  </div>
                )}

                {/* Custom instruction */}
                <div className="mt-2 pt-2 border-t border-border-primary">
                  <input type="text" value={customInstruction} onChange={(e) => setCustomInstruction(e.target.value)}
                    placeholder="Custom instruction..."
                    className="w-full rounded-lg border border-border-primary bg-background-tertiary px-3 py-1.5 text-xs text-text-primary focus:border-brand-primary focus:outline-none"
                    onKeyDown={(e) => { if (e.key === 'Enter' && customInstruction.trim()) handleRegenerate('custom', customInstruction); }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Deploy CTA */}
      {tbwo.type === 'website_sprint' && tbwo.status === 'completed' && (
        <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/20">
                <RocketLaunchIcon className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <h3 className="font-semibold text-text-primary">Ready to Deploy</h3>
                <p className="text-sm text-text-tertiary">Create a site record and deploy to Cloudflare Pages</p>
              </div>
            </div>
            <Button variant="primary" size="sm" leftIcon={<RocketLaunchIcon className="h-4 w-4" />}
              onClick={async () => {
                try {
                  const _briefName = (tbwo.metadata?.siteBrief as Record<string, unknown>)?.productName as string;
                  const site = await useSitesStore.getState().createSite(_briefName || tbwo.objective || 'Untitled Site', tbwo.id);
                  window.location.href = `/sites/${site.id}`;
                } catch (e) { console.error('[TBWO] Create site failed:', e); }
              }}>
              Create Site & Deploy
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
