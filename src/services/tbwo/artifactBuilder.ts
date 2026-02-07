import type { Artifact } from '../../types/tbwo';
import { ArtifactType as ArtifactTypeEnum } from '../../types/tbwo';

interface ArtifactCollection {
  code: Artifact[];
  design: Artifact[];
  documents: Artifact[];
  config: Artifact[];
  all: Artifact[];
  byPod: Map<string, Artifact[]>;
  fileTree: FileTreeNode[];
}

interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: FileTreeNode[];
  artifactId?: string;
}

interface MergeResult {
  merged: Artifact[];
  conflicts: Array<{
    path: string;
    artifacts: Artifact[];
    resolution: string;
  }>;
}

export class ArtifactBuilder {
  private artifacts = new Map<string, Artifact>();

  constructor(_tbwoId: string) {
    // tbwoId reserved for future use (e.g., scoped queries)
  }

  // Add artifact
  addArtifact(artifact: Artifact): void {
    this.artifacts.set(artifact.id, artifact);
  }

  // Add multiple
  addArtifacts(artifacts: Artifact[]): void {
    for (const a of artifacts) this.addArtifact(a);
  }

  // Get organized collection
  getCollection(): ArtifactCollection {
    const all = Array.from(this.artifacts.values());
    const code = all.filter((a) => a.type === ArtifactTypeEnum.CODE);
    const design = all.filter((a) => a.type === ArtifactTypeEnum.DESIGN);
    const documents = all.filter((a) => a.type === ArtifactTypeEnum.DOCUMENT);
    const config = all.filter((a) => a.type === ArtifactTypeEnum.CONFIG);

    const byPod = new Map<string, Artifact[]>();
    for (const a of all) {
      const existing = byPod.get(a.createdBy) || [];
      existing.push(a);
      byPod.set(a.createdBy, existing);
    }

    return {
      code,
      design,
      documents,
      config,
      all,
      byPod,
      fileTree: this.buildFileTree(all),
    };
  }

  // Merge artifacts that target the same file
  mergeArtifacts(): MergeResult {
    const byPath = new Map<string, Artifact[]>();
    const merged: Artifact[] = [];
    const conflicts: MergeResult['conflicts'] = [];

    for (const artifact of this.artifacts.values()) {
      if (artifact.path) {
        const existing = byPath.get(artifact.path) || [];
        existing.push(artifact);
        byPath.set(artifact.path, existing);
      } else {
        merged.push(artifact);
      }
    }

    for (const [path, pathArtifacts] of byPath) {
      if (pathArtifacts.length === 1) {
        merged.push(pathArtifacts[0]!);
      } else {
        // Multiple artifacts for same path - take latest version
        const sorted = pathArtifacts.sort((a, b) => b.createdAt - a.createdAt);
        merged.push(sorted[0]!);
        if (pathArtifacts.length > 1) {
          conflicts.push({
            path,
            artifacts: pathArtifacts,
            resolution: `Used latest version from ${sorted[0]!.createdBy} (${new Date(sorted[0]!.createdAt).toISOString()})`,
          });
        }
      }
    }

    return { merged, conflicts };
  }

  // Build file tree from artifacts
  private buildFileTree(artifacts: Artifact[]): FileTreeNode[] {
    const root: Map<string, FileTreeNode> = new Map();

    for (const artifact of artifacts) {
      if (!artifact.path) continue;
      const parts = artifact.path.replace(/\\/g, '/').split('/');
      let currentLevel = root;
      let currentPath = '';

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        currentPath += (currentPath ? '/' : '') + part;
        const isFile = i === parts.length - 1;

        if (!currentLevel.has(part)) {
          const node: FileTreeNode = {
            name: part,
            path: currentPath,
            type: isFile ? 'file' : 'directory',
            ...(isFile
              ? {
                  size:
                    typeof artifact.content === 'string'
                      ? artifact.content.length
                      : 0,
                  artifactId: artifact.id,
                }
              : { children: [] }),
          };
          currentLevel.set(part, node);
        }

        if (!isFile) {
          const dirNode = currentLevel.get(part)!;
          if (!dirNode.children) dirNode.children = [];
          const childMap = new Map<string, FileTreeNode>();
          for (const child of dirNode.children) childMap.set(child.name, child);
          currentLevel = childMap;
        }
      }
    }

    return Array.from(root.values());
  }

  // Generate summary stats
  getSummary(): {
    totalArtifacts: number;
    byType: Record<string, number>;
    byPod: Record<string, number>;
    totalSize: number;
    filesCount: number;
  } {
    const all = Array.from(this.artifacts.values());
    const byType: Record<string, number> = {};
    const byPod: Record<string, number> = {};
    let totalSize = 0;
    let filesCount = 0;

    for (const a of all) {
      byType[a.type] = (byType[a.type] || 0) + 1;
      byPod[a.createdBy] = (byPod[a.createdBy] || 0) + 1;
      if (typeof a.content === 'string') totalSize += a.content.length;
      if (a.path) filesCount++;
    }

    return { totalArtifacts: all.length, byType, byPod, totalSize, filesCount };
  }

  // Get files ready for writing
  getFilesToWrite(): Array<{ path: string; content: string }> {
    const { merged } = this.mergeArtifacts();
    return merged
      .filter((a) => a.path && typeof a.content === 'string')
      .map((a) => ({ path: a.path!, content: a.content as string }));
  }

  // Clear
  clear(): void {
    this.artifacts.clear();
  }

  getArtifact(id: string): Artifact | undefined {
    return this.artifacts.get(id);
  }

  getAllArtifacts(): Artifact[] {
    return Array.from(this.artifacts.values());
  }
}
