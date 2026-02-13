/**
 * Sites Store — manages site records, deployment state, and patch plans
 * for the Sites Dashboard + Operator Loop.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import * as dbService from '../api/dbService';
import type { DbSite, DbDeployment, DbSitePatch, DbSiteVersion, SiteFile, DbCfImage, DbCfVideo, DeployProgressEvent } from '../api/dbService';

interface SitesState {
  sites: DbSite[];
  currentSite: DbSite | null;
  deployments: DbDeployment[];
  loading: boolean;
  deploying: boolean;
  error: string | null;

  // Patch state
  currentPatch: DbSitePatch | null;
  patches: DbSitePatch[];
  patchLoading: boolean;
  patchError: string | null;

  // R2 files + versions
  files: SiteFile[];
  versions: DbSiteVersion[];
  filesLoading: boolean;

  // CF Images + Videos
  images: DbCfImage[];
  videos: DbCfVideo[];
  imagesLoading: boolean;
  videosLoading: boolean;

  // Deploy progress SSE
  deployProgress: DeployProgressEvent[];
  deployStreamClose: (() => void) | null;
}

interface SitesActions {
  loadSites: () => Promise<void>;
  loadSite: (siteId: string) => Promise<void>;
  createSite: (name: string, tbwoRunId?: string) => Promise<DbSite>;
  deploySite: (siteId: string) => Promise<void>;
  deploySiteR2: (siteId: string) => Promise<void>;
  loadDeployments: (siteId: string) => Promise<void>;
  pollDeployment: (siteId: string, deploymentId: string) => void;
  clearError: () => void;

  // R2 files + versions
  loadSiteFiles: (siteId: string) => Promise<void>;
  loadSiteVersions: (siteId: string) => Promise<void>;
  rollbackSite: (siteId: string, version: number) => Promise<void>;

  // CF Images
  loadImages: () => Promise<void>;
  uploadImage: (file: File, siteId?: string) => Promise<void>;
  deleteImage: (imageId: string) => Promise<void>;

  // CF Videos
  loadVideos: () => Promise<void>;
  getUploadUrl: (siteId?: string) => Promise<{ uploadUrl: string; uid: string }>;
  deleteVideo: (videoId: string) => Promise<void>;

  // Patch actions
  requestChange: (siteId: string, changeRequest: string) => Promise<void>;
  pollPatch: (siteId: string, patchId: string) => void;
  loadPatches: (siteId: string) => Promise<void>;
  approvePatch: (siteId: string, patchId: string, replacements?: Record<string, string>) => Promise<void>;
  rejectPatch: (siteId: string, patchId: string) => Promise<void>;
  clearPatch: () => void;
}

export const useSitesStore = create<SitesState & SitesActions>()(
  immer((set, get) => ({
    sites: [],
    currentSite: null,
    deployments: [],
    loading: false,
    deploying: false,
    error: null,

    // Patch state
    currentPatch: null,
    patches: [],
    patchLoading: false,
    patchError: null,

    // R2 files + versions
    files: [],
    versions: [],
    filesLoading: false,

    // CF Images + Videos
    images: [],
    videos: [],
    imagesLoading: false,
    videosLoading: false,

    // Deploy progress SSE
    deployProgress: [],
    deployStreamClose: null,

    loadSites: async () => {
      set((s) => { s.loading = true; s.error = null; });
      try {
        const sites = await dbService.listSites();
        set((s) => { s.sites = sites; s.loading = false; });
      } catch (err) {
        set((s) => { s.error = (err as Error).message; s.loading = false; });
      }
    },

    loadSite: async (siteId: string) => {
      set((s) => { s.loading = true; s.error = null; });
      try {
        const site = await dbService.getSite(siteId);
        set((s) => { s.currentSite = site; s.loading = false; });
      } catch (err) {
        set((s) => { s.error = (err as Error).message; s.loading = false; });
      }
    },

    createSite: async (name: string, tbwoRunId?: string) => {
      set((s) => { s.loading = true; s.error = null; });
      try {
        // Generate SiteModel manifest if creating from a TBWO
        let manifest: string | undefined;
        if (tbwoRunId) {
          try {
            const { useTBWOStore } = await import('./tbwoStore');
            const tbwo = useTBWOStore.getState().getTBWOById(tbwoRunId);
            if (tbwo) {
              const { generateSiteModelFromTBWO, serializeSiteModel } = await import('../products/sites/model');
              const siteModel = generateSiteModelFromTBWO(tbwo);
              manifest = serializeSiteModel(siteModel);
            }
          } catch {
            // SiteModel generation is best-effort
          }
        }
        const site = await dbService.createSite({ name, tbwoRunId, manifest });
        set((s) => {
          s.sites.unshift(site);
          s.currentSite = site;
          s.loading = false;
        });
        return site;
      } catch (err) {
        set((s) => { s.error = (err as Error).message; s.loading = false; });
        throw err;
      }
    },

    deploySite: async (siteId: string) => {
      set((s) => { s.deploying = true; s.error = null; });
      try {
        // Run product validators before deploy (if registered)
        try {
          const { productRegistry } = await import('../alin-executive/productRegistry');
          const sitesProduct = productRegistry.get('website_sprint');
          if (sitesProduct?.validators) {
            for (const validator of sitesProduct.validators) {
              // Find the associated TBWO from the site record
              const site = get().currentSite;
              if (site?.tbwo_run_id) {
                const { useTBWOStore } = await import('./tbwoStore');
                const tbwo = useTBWOStore.getState().getTBWOById(site.tbwo_run_id);
                if (tbwo) {
                  const result = validator(tbwo);
                  if (!result.valid) {
                    set((s) => {
                      s.error = `Deploy blocked: ${result.errors.join('; ')}`;
                      s.deploying = false;
                    });
                    return;
                  }
                }
              }
            }
          }
        } catch {
          // Validator check is best-effort — if imports fail, proceed
        }

        // Cognitive launch readiness gate (fail-safe)
        try {
          const site = get().currentSite;
          if (site?.tbwo_run_id) {
            const { useTBWOStore } = await import('./tbwoStore');
            const tbwo = useTBWOStore.getState().getTBWOById(site.tbwo_run_id);
            if (tbwo?.metadata?.cognitiveBrief) {
              const { isLaunchReady } = await import('../products/sites/cognitive');
              const cogBrief = tbwo.metadata.cognitiveBrief as any;
              const launchResult = cogBrief.confidence ? isLaunchReady(cogBrief.confidence) : null;
              if (launchResult && !launchResult.ready) {
                const gaps = launchResult.blockers || [];
                set((s) => {
                  s.error = `Deploy blocked by cognitive analysis: confidence ${cogBrief.confidence.overall}/100. Blocking gaps: ${gaps.join('; ') || 'low overall score'}`;
                  s.deploying = false;
                });
                return;
              }
            }
          }
        } catch {
          // Cognitive check is best-effort — if imports fail, proceed
        }

        // Site Model deploy validation gate (fail-safe)
        try {
          const site = get().currentSite;
          if (site?.tbwo_run_id) {
            const { useTBWOStore } = await import('./tbwoStore');
            const tbwo = useTBWOStore.getState().getTBWOById(site.tbwo_run_id);
            if (tbwo) {
              const { generateSiteModelFromTBWO, validateForDeploy } = await import('../products/sites/model');
              const siteModel = generateSiteModelFromTBWO(tbwo);
              const deployResult = validateForDeploy(siteModel);
              if (!deployResult.canDeploy && deployResult.blockingIssues.length > 0) {
                set((s) => {
                  s.error = `Deploy blocked: ${deployResult.blockingIssues.join('; ')}`;
                  s.deploying = false;
                });
                return;
              }
              if (deployResult.warnings.length > 0) {
                console.warn('[sitesStore] Deploy warnings:', deployResult.warnings);
              }
            }
          }
        } catch {
          // Site model validation is best-effort — if imports fail, proceed
        }

        const deployment = await dbService.deploySite(siteId);
        set((s) => {
          s.deployments.unshift(deployment);
          s.deploying = false;
          s.deployProgress = [];
        });
        // Open SSE stream for live progress
        const closeStream = dbService.streamDeployProgress(siteId, deployment.id, (event) => {
          set((s) => { s.deployProgress = [...s.deployProgress, event]; });
          if (event.event === 'done') {
            set((s) => { s.deployStreamClose = null; });
            // Refresh site + deployments on completion
            get().loadSite(siteId);
            get().loadDeployments(siteId);
          }
        });
        set((s) => { s.deployStreamClose = closeStream; });
        // Also poll as fallback
        get().pollDeployment(siteId, deployment.id);
      } catch (err) {
        set((s) => { s.error = (err as Error).message; s.deploying = false; });
      }
    },

    loadDeployments: async (siteId: string) => {
      try {
        const deployments = await dbService.listDeployments(siteId);
        set((s) => { s.deployments = deployments; });
      } catch (err) {
        console.warn('[sitesStore] Failed to load deployments:', err);
      }
    },

    pollDeployment: (siteId: string, deploymentId: string) => {
      let attempts = 0;
      const maxAttempts = 60; // 5 minutes at 5s intervals
      const interval = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
          clearInterval(interval);
          return;
        }
        try {
          const deployments = await dbService.listDeployments(siteId, 5);
          const target = deployments.find(d => d.id === deploymentId);
          set((s) => { s.deployments = deployments; });

          if (target && (target.status === 'success' || target.status === 'failed')) {
            clearInterval(interval);
            // Refresh site to get updated status/URL
            const site = await dbService.getSite(siteId);
            set((s) => { s.currentSite = site; });
          }
        } catch { /* ignore polling errors */ }
      }, 5000);
    },

    deploySiteR2: async (siteId: string) => {
      set((s) => { s.deploying = true; s.error = null; });
      try {
        const deployment = await dbService.deployR2(siteId);
        set((s) => {
          s.deployments.unshift(deployment);
          s.deploying = false;
          s.deployProgress = [];
        });
        // Open SSE stream for live progress
        const closeStream = dbService.streamDeployProgress(siteId, deployment.id, (event) => {
          set((s) => { s.deployProgress = [...s.deployProgress, event]; });
          if (event.event === 'done') {
            set((s) => { s.deployStreamClose = null; });
            get().loadSite(siteId);
            get().loadDeployments(siteId);
          }
        });
        set((s) => { s.deployStreamClose = closeStream; });
        get().pollDeployment(siteId, deployment.id);
      } catch (err) {
        set((s) => { s.error = (err as Error).message; s.deploying = false; });
      }
    },

    loadSiteFiles: async (siteId: string) => {
      set((s) => { s.filesLoading = true; });
      try {
        const { files } = await dbService.listSiteFiles(siteId);
        set((s) => { s.files = files; s.filesLoading = false; });
      } catch {
        set((s) => { s.filesLoading = false; });
      }
    },

    loadSiteVersions: async (siteId: string) => {
      try {
        const versions = await dbService.listSiteVersions(siteId);
        set((s) => { s.versions = versions; });
      } catch {
        // ignore
      }
    },

    rollbackSite: async (siteId: string, version: number) => {
      set((s) => { s.deploying = true; s.error = null; });
      try {
        const deployment = await dbService.rollbackSite(siteId, version);
        set((s) => {
          s.deployments.unshift(deployment);
          s.deploying = false;
        });
        // Refresh site to get updated URL
        const site = await dbService.getSite(siteId);
        set((s) => { s.currentSite = site; });
      } catch (err) {
        set((s) => { s.error = (err as Error).message; s.deploying = false; });
      }
    },

    loadImages: async () => {
      set((s) => { s.imagesLoading = true; });
      try {
        const images = await dbService.listCfImages();
        set((s) => { s.images = images; s.imagesLoading = false; });
      } catch {
        set((s) => { s.imagesLoading = false; });
      }
    },

    uploadImage: async (file: File, siteId?: string) => {
      try {
        const image = await dbService.uploadCfImage(file, siteId);
        set((s) => { s.images.unshift(image); });
      } catch (err) {
        set((s) => { s.error = (err as Error).message; });
      }
    },

    deleteImage: async (imageId: string) => {
      try {
        await dbService.deleteCfImage(imageId);
        set((s) => { s.images = s.images.filter(i => i.id !== imageId); });
      } catch (err) {
        set((s) => { s.error = (err as Error).message; });
      }
    },

    loadVideos: async () => {
      set((s) => { s.videosLoading = true; });
      try {
        const videos = await dbService.listVideos(50);
        set((s) => {
          s.videos = (videos || []).map((v: any) => ({
            id: v.id || v.uid,
            user_id: v.user_id || '',
            cf_uid: v.uid || v.cf_uid || '',
            status: v.status?.state || v.status || 'ready',
            thumbnail: v.thumbnail || null,
            preview: v.preview || null,
            duration: v.duration || null,
            metadata: v.meta || v.metadata || {},
            site_id: v.site_id || null,
            created_at: v.created ? new Date(v.created).getTime() : Date.now(),
          }));
          s.videosLoading = false;
        });
      } catch {
        set((s) => { s.videosLoading = false; });
      }
    },

    getUploadUrl: async (siteId?: string) => {
      const result = await dbService.getVideoUploadUrl(siteId);
      const video: DbCfVideo = {
        id: result.id,
        user_id: '',
        cf_uid: result.uid,
        status: 'uploading',
        thumbnail: null,
        preview: null,
        duration: null,
        metadata: {},
        site_id: siteId || null,
        created_at: Date.now(),
      };
      set((s) => { s.videos.unshift(video); });
      return { uploadUrl: result.uploadUrl, uid: result.uid };
    },

    deleteVideo: async (videoId: string) => {
      try {
        await dbService.deleteVideo(videoId);
        set((s) => { s.videos = s.videos.filter(v => v.id !== videoId); });
      } catch (err) {
        set((s) => { s.error = (err as Error).message; });
      }
    },

    clearError: () => {
      set((s) => { s.error = null; });
    },

    // ========================================================================
    // PATCH ACTIONS
    // ========================================================================

    requestChange: async (siteId: string, changeRequest: string) => {
      set((s) => { s.patchLoading = true; s.patchError = null; s.currentPatch = null; });
      try {
        const { patchId } = await dbService.createPatchPlan(siteId, changeRequest);
        // Start polling for plan completion
        get().pollPatch(siteId, patchId);
      } catch (err) {
        set((s) => { s.patchError = (err as Error).message; s.patchLoading = false; });
      }
    },

    pollPatch: (siteId: string, patchId: string) => {
      let attempts = 0;
      const maxAttempts = 60; // 5 min at 5s intervals
      const interval = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
          clearInterval(interval);
          set((s) => { s.patchLoading = false; s.patchError = 'Patch planning timed out'; });
          return;
        }
        try {
          const patch = await dbService.getPatchPlan(siteId, patchId);
          if (patch.status === 'planned' || patch.status === 'failed') {
            clearInterval(interval);
            set((s) => {
              s.currentPatch = patch;
              s.patchLoading = false;
              if (patch.status === 'failed') {
                const result = patch.apply_result as unknown as { error?: string } | null;
                s.patchError = result?.error || 'Plan generation failed';
              }
            });
          }
        } catch { /* ignore polling errors */ }
      }, 3000);
    },

    loadPatches: async (siteId: string) => {
      try {
        const patches = await dbService.listPatches(siteId);
        set((s) => { s.patches = patches; });
      } catch (err) {
        console.warn('[sitesStore] Failed to load patches:', err);
      }
    },

    approvePatch: async (siteId: string, patchId: string, replacements?: Record<string, string>) => {
      set((s) => { s.patchLoading = true; s.patchError = null; });
      try {
        const result = await dbService.applyPatch(siteId, patchId, replacements);
        // Refresh patch to get updated status
        const patch = await dbService.getPatchPlan(siteId, patchId);
        set((s) => {
          s.currentPatch = patch;
          s.patchLoading = false;
        });

        // If fully applied, auto-redeploy
        if (result.failed === 0) {
          get().deploySite(siteId);
        }
      } catch (err) {
        set((s) => { s.patchError = (err as Error).message; s.patchLoading = false; });
      }
    },

    rejectPatch: async (siteId: string, patchId: string) => {
      try {
        await dbService.rejectPatch(siteId, patchId);
        set((s) => { s.currentPatch = null; });
      } catch (err) {
        set((s) => { s.patchError = (err as Error).message; });
      }
    },

    clearPatch: () => {
      set((s) => { s.currentPatch = null; s.patchError = null; s.patchLoading = false; });
    },
  }))
);
