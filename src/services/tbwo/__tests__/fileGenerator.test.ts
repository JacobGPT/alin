import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileGenerator } from '../fileGenerator';
import { ArtifactType } from '../../../types/tbwo';

// Mock fetch for backend API calls
const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) });
vi.stubGlobal('fetch', mockFetch);

describe('FileGenerator', () => {
  let generator: FileGenerator;

  beforeEach(() => {
    vi.clearAllMocks();
    generator = new FileGenerator('/tmp/test-project');
  });

  describe('constructor', () => {
    it('should create with base directory', () => {
      expect(generator).toBeDefined();
      expect(generator.getFileCount()).toBe(0);
    });
  });

  describe('generateFromArtifacts', () => {
    it('should write files from artifacts', async () => {
      const artifacts = [
        { id: 'a1', tbwoId: 't1', name: 'index.html', type: ArtifactType.CODE, content: '<html></html>', path: 'index.html', createdBy: 'pod-1', createdAt: Date.now(), version: 1, status: 'draft' as const },
        { id: 'a2', tbwoId: 't1', name: 'styles.css', type: ArtifactType.CODE, content: 'body {}', path: 'css/styles.css', createdBy: 'pod-1', createdAt: Date.now(), version: 1, status: 'draft' as const },
      ];

      const result = await generator.generateFromArtifacts(artifacts);
      expect(result.filesCreated.length).toBe(2);
      expect(result.errors.length).toBe(0);
    });

    it('should skip artifacts without path', async () => {
      const artifacts = [
        { id: 'a1', tbwoId: 't1', name: 'note', type: ArtifactType.DOCUMENT, content: 'Just a note', createdBy: 'pod-1', createdAt: Date.now(), version: 1, status: 'draft' as const },
      ];

      const result = await generator.generateFromArtifacts(artifacts);
      expect(result.filesCreated.length).toBe(0);
    });

    it('should handle write errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      const artifacts = [
        { id: 'a1', tbwoId: 't1', name: 'fail.html', type: ArtifactType.CODE, content: '<html></html>', path: 'fail.html', createdBy: 'pod-1', createdAt: Date.now(), version: 1, status: 'draft' as const },
      ];

      const result = await generator.generateFromArtifacts(artifacts);
      expect(result.errors.length).toBe(1);
      expect(result.success).toBe(false);
    });
  });

  describe('generateWebsiteStructure', () => {
    it('should create full website structure', async () => {
      const result = await generator.generateWebsiteStructure({
        name: 'Test Site',
        pages: [
          { name: 'Home', path: '/', sections: ['hero', 'features'] },
          { name: 'About', path: '/about', sections: ['hero', 'about'] },
        ],
        designTokens: ':root { --color-primary: blue; }',
      });

      expect(result.filesCreated.length).toBeGreaterThan(0);
    });
  });

  describe('state', () => {
    it('should track generated files', async () => {
      const artifacts = [
        { id: 'a1', tbwoId: 't1', name: 'test.html', type: ArtifactType.CODE, content: '<html></html>', path: 'test.html', createdBy: 'pod-1', createdAt: Date.now(), version: 1, status: 'draft' as const },
      ];
      await generator.generateFromArtifacts(artifacts);
      expect(generator.getFileCount()).toBe(1);
      expect(generator.getTotalSize()).toBeGreaterThan(0);
    });
  });
});
