import type { ImmersiveSceneGraph, ImmersiveSectionPlane, SceneAssetRef } from './types';
import type { SectionSpec } from '../../../types/tbwo';

const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.159.0/build/three.min.js';

/**
 * Build an ImmersiveSceneGraph from section specs.
 * Maps each section to a camera position in 3D space.
 */
export function buildImmersiveSceneGraph(sections: SectionSpec[]): ImmersiveSceneGraph {
  const sectionPlanes: ImmersiveSectionPlane[] = [];
  const scrollPerSection = 100; // vh units per section

  sections.forEach((section, i) => {
    // Distribute camera positions along a path
    const angle = (i / Math.max(sections.length - 1, 1)) * Math.PI;
    const radius = 8;

    sectionPlanes.push({
      sectionId: section.type + '-' + i,
      cameraPosition: [
        Math.sin(angle) * radius,
        2 + i * 0.5,
        Math.cos(angle) * radius,
      ],
      cameraTarget: [0, 0, 0],
      scrollStart: i / sections.length,
      scrollEnd: (i + 1) / sections.length,
      assets: section.scene?.sceneSpec?.asset ? [section.scene.sceneSpec.asset] : [],
    });
  });

  return {
    sections: sectionPlanes,
    scrollMapping: 'eased',
    totalScrollHeight: sections.length * scrollPerSection,
    domOverlayEnabled: true,
  };
}

/**
 * Generate the full-page immersive JS IIFE.
 */
export function generateImmersiveJS(graph: ImmersiveSceneGraph, assets: SceneAssetRef[]): string {
  return `(function() {
  'use strict';

  // ── Feature Detection ──
  var canvas = document.createElement('canvas');
  var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  if (!gl) { showFallback(); return; }

  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  if (isMobile) { showFallback(); return; } // Immersive mode disabled on mobile

  var wrapper = document.getElementById('immersive-wrapper');
  if (!wrapper) return;

  var script = document.createElement('script');
  script.src = '${THREE_CDN}';
  script.onload = initImmersive;
  script.onerror = showFallback;
  document.head.appendChild(script);

  function showFallback() {
    var fb = document.querySelector('.scene-fallback');
    if (fb) fb.style.display = 'flex';
    document.body.classList.add('immersive-fallback');
  }

  function initImmersive() {
    var THREE = window.THREE;
    if (!THREE) { showFallback(); return; }

    // ── Full Viewport Canvas ──
    var scene = new THREE.Scene();
    scene.background = new THREE.Color('#0a0a0a');
    scene.fog = new THREE.FogExp2('#0a0a0a', 0.02);

    var camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 2, 8);

    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    wrapper.insertBefore(renderer.domElement, wrapper.firstChild);

    // ── Lighting ──
    scene.add(new THREE.AmbientLight('#ffffff', 0.4));
    var dirLight = new THREE.DirectionalLight('#ffffff', 0.8);
    dirLight.position.set(5, 10, 5);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // ── Assets ──
    var meshes = [];
${generateAssetPlacement(assets)}

    // ── Section Camera Waypoints ──
    var waypoints = ${JSON.stringify(graph.sections.map(s => ({
      pos: s.cameraPosition,
      target: s.cameraTarget,
      scrollStart: s.scrollStart,
      scrollEnd: s.scrollEnd,
    })))};

    // ── Scroll Handler (rAF-throttled) ──
    var scrollProgress = 0;
    var ticking = false;

    // Set document height for scroll
    document.body.style.height = '${graph.totalScrollHeight}vh';

    window.addEventListener('scroll', function() {
      if (!ticking) {
        requestAnimationFrame(function() {
          var maxScroll = document.body.scrollHeight - window.innerHeight;
          scrollProgress = Math.max(0, Math.min(1, window.scrollY / maxScroll));
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });

    // ── Easing ──
    function easeInOutCubic(t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function lerp(a, b, t) { return a + (b - a) * t; }

    function lerpVec3(out, a, b, t) {
      out[0] = lerp(a[0], b[0], t);
      out[1] = lerp(a[1], b[1], t);
      out[2] = lerp(a[2], b[2], t);
    }

    // ── Animation Loop ──
    var animFrame = null;
    var tmpPos = [0, 0, 0];
    var tmpTarget = [0, 0, 0];

    function animate() {
      animFrame = requestAnimationFrame(animate);

      // Find current waypoint pair
      var wp0 = waypoints[0], wp1 = waypoints[waypoints.length - 1];
      for (var i = 0; i < waypoints.length - 1; i++) {
        if (scrollProgress >= waypoints[i].scrollStart && scrollProgress <= waypoints[i + 1].scrollEnd) {
          wp0 = waypoints[i];
          wp1 = waypoints[i + 1];
          break;
        }
      }

      // Interpolate camera
      var range = wp1.scrollEnd - wp0.scrollStart;
      var localT = range > 0 ? (scrollProgress - wp0.scrollStart) / range : 0;
      var easedT = ${graph.scrollMapping === 'eased' ? 'easeInOutCubic(localT)' : 'localT'};

      lerpVec3(tmpPos, wp0.pos, wp1.pos, easedT);
      lerpVec3(tmpTarget, wp0.target, wp1.target, easedT);

      camera.position.set(tmpPos[0], tmpPos[1], tmpPos[2]);
      camera.lookAt(tmpTarget[0], tmpTarget[1], tmpTarget[2]);

      if (!reducedMotion) {
        // Gentle asset rotation
        meshes.forEach(function(m) { m.rotation.y += 0.002; });
      }

      renderer.render(scene, camera);
    }
    animate();

    // ── Resize ──
    window.addEventListener('resize', function() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // ── Cleanup ──
    window.addEventListener('beforeunload', function() {
      if (animFrame) cancelAnimationFrame(animFrame);
      renderer.dispose();
    });
  }
})();`;
}

/**
 * Generate CSS for immersive mode.
 */
export function generateImmersiveCSS(): string {
  return `#immersive-wrapper {
  position: fixed;
  inset: 0;
  z-index: 0;
}

#immersive-wrapper canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.immersive-dom-overlay {
  position: relative;
  z-index: 1;
  pointer-events: none;
}

.immersive-dom-overlay > * {
  pointer-events: auto;
}

.immersive-section {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4rem 2rem;
}

.scene-fallback {
  display: none;
  position: fixed;
  inset: 0;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%);
  color: rgba(255,255,255,0.6);
  font-size: 1.125rem;
  text-align: center;
  z-index: 10;
}

.immersive-fallback .scene-fallback {
  display: flex;
}

.immersive-fallback #immersive-wrapper canvas {
  display: none;
}

@media (prefers-reduced-motion: reduce) {
  #immersive-wrapper canvas {
    animation: none !important;
  }
}

@media (max-width: 768px) {
  .immersive-section {
    min-height: auto;
    padding: 2rem 1rem;
  }
}`;
}

function generateAssetPlacement(assets: SceneAssetRef[]): string {
  if (assets.length === 0) {
    // Default abstract geometry
    return `    var defaultGeo = new THREE.TorusKnotGeometry(1.5, 0.4, 100, 16);
    var defaultMat = new THREE.MeshStandardMaterial({ color: '#6366f1', metalness: 0.3, roughness: 0.4 });
    var defaultMesh = new THREE.Mesh(defaultGeo, defaultMat);
    scene.add(defaultMesh);
    meshes.push(defaultMesh);`;
  }

  const lines: string[] = [];
  assets.forEach((asset, i) => {
    const pos = asset.position ?? [0, 0, 0];
    const scale = asset.scale ?? 1;
    const PRIMITIVE_GEO: Record<string, string> = {
      'primitive-cube': 'new THREE.BoxGeometry(1, 1, 1)',
      'primitive-sphere': 'new THREE.SphereGeometry(1, 32, 32)',
      'primitive-torus': 'new THREE.TorusGeometry(1, 0.4, 16, 48)',
      'primitive-torusknot': 'new THREE.TorusKnotGeometry(1, 0.3, 100, 16)',
    };
    const geo = PRIMITIVE_GEO[asset.id] ?? 'new THREE.SphereGeometry(1, 32, 32)';
    lines.push(`    var asset${i}Geo = ${geo};`);
    lines.push(`    var asset${i}Mat = new THREE.MeshStandardMaterial({ color: '#6366f1', metalness: 0.3, roughness: 0.4 });`);
    lines.push(`    var asset${i} = new THREE.Mesh(asset${i}Geo, asset${i}Mat);`);
    lines.push(`    asset${i}.position.set(${pos.join(', ')});`);
    lines.push(`    asset${i}.scale.setScalar(${scale});`);
    lines.push(`    scene.add(asset${i});`);
    lines.push(`    meshes.push(asset${i});`);
  });
  return lines.join('\n');
}
