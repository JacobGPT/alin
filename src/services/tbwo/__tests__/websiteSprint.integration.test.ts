import { describe, it, expect } from 'vitest';
import { createWebsiteSprintTBWO, DEFAULT_WEBSITE_SPRINT_CONFIG } from '../templates/websiteSprint';
import { TBWOType, TBWOStatus, QualityTarget, PodRole, AuthorityLevel } from '../../../types/tbwo';
import { ArtifactBuilder } from '../artifactBuilder';
import { PackageService } from '../packageService';

describe('Website Sprint Integration', () => {

  describe('createWebsiteSprintTBWO', () => {
    it('should create a complete TBWO', () => {
      const tbwo = createWebsiteSprintTBWO('Build a portfolio website');

      expect(tbwo.id).toBeDefined();
      expect(tbwo.type).toBe(TBWOType.WEBSITE_SPRINT);
      expect(tbwo.status).toBe(TBWOStatus.AWAITING_APPROVAL);
      expect(tbwo.objective).toBe('Build a portfolio website');
    });

    it('should create pods for all roles', () => {
      const tbwo = createWebsiteSprintTBWO('Build a website');
      const roles = new Set<PodRole>();
      tbwo.pods.forEach(pod => roles.add(pod.role));

      expect(roles.has(PodRole.ORCHESTRATOR)).toBe(true);
      expect(roles.has(PodRole.DESIGN)).toBe(true);
      expect(roles.has(PodRole.FRONTEND)).toBe(true);
      expect(roles.has(PodRole.COPY)).toBe(true);
      expect(roles.has(PodRole.QA)).toBe(true);
    });

    it('should have an execution plan', () => {
      const tbwo = createWebsiteSprintTBWO('Build a website');
      expect(tbwo.plan).toBeDefined();
      expect(tbwo.plan!.phases.length).toBeGreaterThan(0);
    });

    it('should respect custom options', () => {
      const tbwo = createWebsiteSprintTBWO('Build a website', {}, {
        timeBudget: 120,
        qualityTarget: QualityTarget.PREMIUM,
        authorityLevel: AuthorityLevel.AUTONOMOUS,
      });

      expect(tbwo.timeBudget.total).toBe(120);
      expect(tbwo.qualityTarget).toBe(QualityTarget.PREMIUM);
      expect(tbwo.authorityLevel).toBe(AuthorityLevel.AUTONOMOUS);
    });

    it('should include custom website config', () => {
      const tbwo = createWebsiteSprintTBWO('Build a blog', {
        pages: [
          { name: 'Home', path: '/', sections: [{ type: 'hero' }], isInMainNav: true },
          { name: 'Blog', path: '/blog', sections: [{ type: 'custom' }], isInMainNav: true },
          { name: 'About', path: '/about', sections: [{ type: 'about' }], isInMainNav: true },
          { name: 'Contact', path: '/contact', sections: [{ type: 'cta' }], isInMainNav: true },
        ],
        aesthetic: 'minimal',
        includeBlog: true,
      });

      expect(tbwo.plan).toBeDefined();
    });
  });

  describe('createWebsiteSprintPlan', () => {
    it('should create phases in correct order', () => {
      const tbwo = createWebsiteSprintTBWO('Build a website');
      const plan = tbwo.plan!;

      const phaseNames = plan.phases.map(p => p.name);
      expect(phaseNames[0]).toBe('Design System');
      expect(phaseNames[phaseNames.length - 1]).toBe('QA & Polish');
    });

    it('should set phase dependencies', () => {
      const tbwo = createWebsiteSprintTBWO('Build a website');
      const plan = tbwo.plan!;

      // Frontend depends on Design + Content
      const frontendPhase = plan.phases.find(p => p.name === 'Frontend Development');
      expect(frontendPhase?.dependsOn.length).toBeGreaterThan(0);

      // QA depends on all previous
      const qaPhase = plan.phases.find(p => p.name === 'QA & Polish');
      expect(qaPhase?.dependsOn.length).toBeGreaterThan(0);
    });

    it('should assign tasks to correct pods', () => {
      const tbwo = createWebsiteSprintTBWO('Build a website');
      const plan = tbwo.plan!;

      // All tasks should have assignedPod
      for (const phase of plan.phases) {
        for (const task of phase.tasks) {
          expect(task.assignedPod).toBeDefined();
        }
      }
    });

    it('should include animations phase when enabled', () => {
      const tbwo = createWebsiteSprintTBWO('Build a website', { includeAnimations: true });
      const phaseNames = tbwo.plan!.phases.map(p => p.name);
      expect(phaseNames).toContain('Motion & Animation');
    });

    it('should exclude animations phase when disabled', () => {
      const tbwo = createWebsiteSprintTBWO('Build a website', { includeAnimations: false });
      const phaseNames = tbwo.plan!.phases.map(p => p.name);
      expect(phaseNames).not.toContain('Motion & Animation');
    });

    it('should include contact form task when enabled', () => {
      const tbwo = createWebsiteSprintTBWO('Build a website', { includeContactForm: true });
      const allTasks = tbwo.plan!.phases.flatMap(p => p.tasks);
      const contactTask = allTasks.find(t => t.name.toLowerCase().includes('contact form'));
      expect(contactTask).toBeDefined();
    });
  });

  describe('ArtifactBuilder integration', () => {
    it('should build artifacts collection', () => {
      const builder = new ArtifactBuilder('tbwo-1');
      builder.addArtifact({
        id: 'a1', tbwoId: 'tbwo-1', name: 'index.html', type: 'CODE' as any,
        content: '<html></html>', path: 'index.html', createdBy: 'pod-1',
        createdAt: Date.now(), version: 1, status: 'draft',
      });
      builder.addArtifact({
        id: 'a2', tbwoId: 'tbwo-1', name: 'styles.css', type: 'CODE' as any,
        content: 'body {}', path: 'css/styles.css', createdBy: 'pod-2',
        createdAt: Date.now(), version: 1, status: 'draft',
      });

      const collection = builder.getCollection();
      expect(collection.all.length).toBe(2);
      expect(collection.byPod.size).toBe(2);
    });

    it('should merge conflicting artifacts', () => {
      const builder = new ArtifactBuilder('tbwo-1');
      builder.addArtifact({
        id: 'a1', tbwoId: 'tbwo-1', name: 'styles.css', type: 'CODE' as any,
        content: 'v1', path: 'css/styles.css', createdBy: 'pod-1',
        createdAt: 1000, version: 1, status: 'draft',
      });
      builder.addArtifact({
        id: 'a2', tbwoId: 'tbwo-1', name: 'styles.css', type: 'CODE' as any,
        content: 'v2', path: 'css/styles.css', createdBy: 'pod-2',
        createdAt: 2000, version: 2, status: 'draft',
      });

      const { merged, conflicts } = builder.mergeArtifacts();
      expect(conflicts.length).toBe(1);
      // Should keep the latest version
      const cssArtifact = merged.find(a => a.path === 'css/styles.css');
      expect(cssArtifact?.content).toBe('v2');
    });
  });

  describe('PackageService integration', () => {
    it('should build downloadable package', () => {
      const tbwo = createWebsiteSprintTBWO('Build a website');
      const packageService = new PackageService();

      const artifacts = [
        { id: 'a1', tbwoId: tbwo.id, name: 'index.html', type: 'CODE' as any, content: '<html></html>', path: 'index.html', createdBy: 'pod-1', createdAt: Date.now(), version: 1, status: 'final' as const },
      ];

      const pkg = packageService.buildPackage(tbwo, artifacts);
      expect(pkg.manifest.tbwoId).toBe(tbwo.id);
      expect(pkg.files.size).toBe(1);
    });

    it('should export as JSON', () => {
      const tbwo = createWebsiteSprintTBWO('Build a website');
      const packageService = new PackageService();

      const pkg = packageService.buildPackage(tbwo, []);
      const json = packageService.exportAsJSON(pkg);
      const parsed = JSON.parse(json);
      expect(parsed.manifest).toBeDefined();
    });
  });

  describe('DEFAULT_WEBSITE_SPRINT_CONFIG', () => {
    it('should have default pages', () => {
      expect(DEFAULT_WEBSITE_SPRINT_CONFIG.pages.length).toBeGreaterThan(0);
    });

    it('should have responsive enabled', () => {
      expect(DEFAULT_WEBSITE_SPRINT_CONFIG.responsive).toBe(true);
    });

    it('should have SEO enabled', () => {
      expect(DEFAULT_WEBSITE_SPRINT_CONFIG.seoOptimized).toBe(true);
    });
  });
});
