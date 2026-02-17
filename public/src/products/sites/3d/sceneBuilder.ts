/**
 * Scene Builder — Core 3D Generator
 *
 * Generates self-contained JS/CSS/HTML strings for static sites.
 * Follows the motionEngine.ts pattern: pure TypeScript module that outputs
 * JS/CSS strings injected into static HTML. Three.js loaded from CDN.
 */

import type { SceneSpec, CameraPresetId, LightingPresetId, MaterialPresetId, AnimationPresetId, AnimationConfig, EnvironmentEffectId } from './types';
import { CAMERA_PRESETS } from './cameraPresets';
import { LIGHTING_PRESETS } from './lightingPresets';
import { MATERIAL_PRESETS } from './materialPresets';
import { ANIMATION_PRESETS } from './animationPresets';

const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.159.0/build/three.min.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Generate a self-contained IIFE that loads Three.js from CDN and creates the scene.
 */
export function generateSceneJS(spec: SceneSpec): string {
  const camera = CAMERA_PRESETS[spec.camera];
  const lighting = LIGHTING_PRESETS[spec.lighting];
  const material = MATERIAL_PRESETS[spec.material];

  const animationConfigs: AnimationConfig[] = spec.animations
    .map(id => ANIMATION_PRESETS[id])
    .filter((c): c is AnimationConfig => !!c);

  return `(function() {
  'use strict';

  // ── Feature Detection ──
  var canvas = document.createElement('canvas');
  var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  if (!gl) {
    showFallback(); return;
  }

  // ── Reduced Motion Check ──
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Mobile Detection ──
  var isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  var mobileMode = '${spec.performance.mobileMode}';
  if (isMobile && mobileMode === 'disable') { showFallback(); return; }

  // ── Load Three.js from CDN ──
  var container = document.getElementById('scene-container');
  if (!container) return;

  var script = document.createElement('script');
  script.src = '${THREE_CDN}';
  script.onload = initScene;
  script.onerror = showFallback;
  document.head.appendChild(script);

  function showFallback() {
    var fb = document.querySelector('.scene-fallback');
    if (fb) fb.style.display = 'flex';
    var sc = document.getElementById('scene-container');
    if (sc) sc.classList.add('scene-no-webgl');
  }

  function initScene() {
    var THREE = window.THREE;
    if (!THREE) { showFallback(); return; }

    var width = container.clientWidth;
    var height = container.clientHeight || 400;

    // ── Scene ──
    var scene = new THREE.Scene();
${generateBackgroundCode(spec)}

    // ── Camera ──
${generateCameraCode(camera)}

    // ── Renderer ──
    var renderer = new THREE.WebGLRenderer({ antialias: !isMobile, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
    renderer.shadowMap.enabled = !isMobile;
    container.appendChild(renderer.domElement);

    // ── Lighting ──
${generateLightingCode(lighting)}

    // ── Geometry & Material ──
${generateMeshCode(spec, material)}

    // ── Environment Effects ──
${generateEnvironmentCode(spec.environment, spec.overrides?.particleCount)}

    // ── Animation State ──
    var clock = new THREE.Clock();
    var scrollProgress = 0;
    var mouseX = 0, mouseY = 0;
    var targetFPS = ${spec.performance.targetFPS};
    var frameInterval = 1000 / targetFPS;
    var lastFrameTime = 0;
    var isVisible = true;
    var animFrame = null;

${generateAnimationSetup(animationConfigs)}

    // ── Scroll Tracking ──
    window.addEventListener('scroll', function() {
      var rect = container.getBoundingClientRect();
      var viewH = window.innerHeight;
      scrollProgress = Math.max(0, Math.min(1, (viewH - rect.top) / (viewH + rect.height)));
    }, { passive: true });

    // ── Mouse Tracking ──
    container.addEventListener('mousemove', function(e) {
      var rect = container.getBoundingClientRect();
      mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    });
    container.addEventListener('mouseleave', function() { mouseX = 0; mouseY = 0; });

    // ── IntersectionObserver (pause when off-screen) ──
    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function(entries) {
        isVisible = entries[0].isIntersecting;
        if (isVisible && !animFrame) animate();
      }, { threshold: 0.1 });
      observer.observe(container);
    }

    // ── Animation Loop ──
    function animate(timestamp) {
      if (!isVisible) { animFrame = null; return; }
      animFrame = requestAnimationFrame(animate);

      if (timestamp - lastFrameTime < frameInterval) return;
      lastFrameTime = timestamp;

      var delta = clock.getDelta();
      var elapsed = clock.getElapsedTime();

      if (!reducedMotion) {
${generateAnimationLoop(animationConfigs, spec)}
      }

      renderer.render(scene, camera);
    }

    animate(0);

    // ── Resize Handler ──
    var resizeObserver = new ResizeObserver(function(entries) {
      var entry = entries[0];
      var w = entry.contentRect.width;
      var h = entry.contentRect.height || 400;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    // ── Cleanup ──
    window.addEventListener('beforeunload', function() {
      if (animFrame) cancelAnimationFrame(animFrame);
      resizeObserver.disconnect();
      renderer.dispose();
    });
  }
})();`;
}

/**
 * Generate CSS for the 3D scene container, fallback, and reduced-motion.
 */
export function generateSceneCSS(spec: SceneSpec): string {
  return `.scene-container {
  position: relative;
  width: 100%;
  min-height: 400px;
  height: 60vh;
  overflow: hidden;
  background: ${spec.overrides?.backgroundColor ?? '#0a0a0a'};
}

.scene-container canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.scene-fallback {
  display: none;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, ${spec.overrides?.backgroundColor ?? '#0a0a0a'} 0%, ${spec.overrides?.accentColor ?? '#1a1a2e'} 100%);
  color: rgba(255,255,255,0.6);
  font-size: 1.125rem;
  text-align: center;
  padding: 2rem;
}

.scene-no-webgl .scene-fallback {
  display: flex;
}

.scene-no-webgl canvas {
  display: none;
}

/* Scene overlay text sits above the 3D canvas */
.scene-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 2;
  pointer-events: none;
}

.scene-overlay > * {
  pointer-events: auto;
}

@media (prefers-reduced-motion: reduce) {
  .scene-container canvas {
    animation: none !important;
    transition: none !important;
  }
}

@media (max-width: 768px) {
  .scene-container {
    min-height: 300px;
    height: 50vh;
  }
}`;
}

/**
 * Generate HTML container for the 3D scene.
 */
export function generateSceneHTML(spec: SceneSpec, containerId = 'scene-container'): string {
  return `<div id="${containerId}" class="scene-container" aria-label="3D interactive scene">
  <div class="scene-fallback">
    <p>Interactive 3D content — your browser does not support WebGL.</p>
  </div>
</div>`;
}

// ============================================================================
// CODE GENERATION HELPERS
// ============================================================================

function generateBackgroundCode(spec: SceneSpec): string {
  const bg = spec.overrides?.backgroundColor ?? '#0a0a0a';
  const hasGradientBg = spec.environment.includes('gradient-bg');
  if (hasGradientBg) {
    return `    scene.background = null; // transparent for CSS gradient`;
  }
  return `    scene.background = new THREE.Color('${bg}');`;
}

function generateCameraCode(camera: typeof CAMERA_PRESETS[CameraPresetId]): string {
  return `    var camera = new THREE.PerspectiveCamera(${camera.fov}, width / height, ${camera.near}, ${camera.far});
    camera.position.set(${camera.position.join(', ')});
    camera.lookAt(${camera.target.join(', ')});`;
}

function generateLightingCode(lighting: typeof LIGHTING_PRESETS[LightingPresetId]): string {
  const lines: string[] = [];

  lines.push(`    var ambientLight = new THREE.AmbientLight('${lighting.ambient.color}', ${lighting.ambient.intensity});`);
  lines.push(`    scene.add(ambientLight);`);

  lighting.directional.forEach((light, i) => {
    lines.push(`    var dirLight${i} = new THREE.DirectionalLight('${light.color}', ${light.intensity});`);
    if (light.position) {
      lines.push(`    dirLight${i}.position.set(${light.position.join(', ')});`);
    }
    if (light.castShadow) {
      lines.push(`    dirLight${i}.castShadow = true;`);
    }
    lines.push(`    scene.add(dirLight${i});`);
  });

  lighting.point.forEach((light, i) => {
    lines.push(`    var pointLight${i} = new THREE.PointLight('${light.color}', ${light.intensity});`);
    if (light.position) {
      lines.push(`    pointLight${i}.position.set(${light.position.join(', ')});`);
    }
    lines.push(`    scene.add(pointLight${i});`);
  });

  lighting.spot.forEach((light, i) => {
    lines.push(`    var spotLight${i} = new THREE.SpotLight('${light.color}', ${light.intensity});`);
    if (light.position) {
      lines.push(`    spotLight${i}.position.set(${light.position.join(', ')});`);
    }
    if (light.angle !== undefined) {
      lines.push(`    spotLight${i}.angle = ${light.angle};`);
    }
    if (light.penumbra !== undefined) {
      lines.push(`    spotLight${i}.penumbra = ${light.penumbra};`);
    }
    lines.push(`    scene.add(spotLight${i});`);
  });

  return lines.join('\n');
}

function generateMeshCode(spec: SceneSpec, material: typeof MATERIAL_PRESETS[MaterialPresetId]): string {
  const lines: string[] = [];
  const asset = spec.asset;
  const scale = asset.scale ?? 1;
  const pos = asset.position ?? [0, 0, 0];
  const rot = asset.rotation ?? [0, 0, 0];

  // Material
  lines.push(`    var mat = new THREE.${material.type}({`);
  lines.push(`      color: '${material.color}',`);
  if (material.type !== 'MeshBasicMaterial') {
    lines.push(`      metalness: ${material.metalness},`);
    lines.push(`      roughness: ${material.roughness},`);
  }
  if (material.transparent) {
    lines.push(`      transparent: true,`);
    lines.push(`      opacity: ${material.opacity},`);
  }
  if (material.wireframe) {
    lines.push(`      wireframe: true,`);
  }
  lines.push(`    });`);

  // Geometry — primitives are inline, builtins would load GLB
  if (asset.type === 'primitive') {
    const geoMap: Record<string, string> = {
      'primitive-cube': 'new THREE.BoxGeometry(1, 1, 1)',
      'primitive-sphere': 'new THREE.SphereGeometry(1, 32, 32)',
      'primitive-torus': 'new THREE.TorusGeometry(1, 0.4, 16, 48)',
      'primitive-torusknot': 'new THREE.TorusKnotGeometry(1, 0.3, 100, 16)',
    };
    const geo = geoMap[asset.id] ?? 'new THREE.SphereGeometry(1, 32, 32)';
    lines.push(`    var geo = ${geo};`);
    lines.push(`    var mesh = new THREE.Mesh(geo, mat);`);
  } else {
    // Builtin/uploaded — create placeholder, load GLB async
    lines.push(`    var mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 32), mat);`);
    // GLB loading would go here for production
  }

  lines.push(`    mesh.scale.setScalar(${scale});`);
  lines.push(`    mesh.position.set(${pos.join(', ')});`);
  lines.push(`    mesh.rotation.set(${rot.join(', ')});`);
  lines.push(`    scene.add(mesh);`);

  return lines.join('\n');
}

function generateEnvironmentCode(effects: EnvironmentEffectId[], particleCount?: number): string {
  const lines: string[] = [];
  const count = particleCount ?? 500;

  for (const effect of effects) {
    switch (effect) {
      case 'particles-float':
        lines.push(generateParticles(count, 'float'));
        break;
      case 'particles-rain':
        lines.push(generateParticles(count, 'rain'));
        break;
      case 'particles-sparkle':
        lines.push(generateParticles(count, 'sparkle'));
        break;
      case 'fog-depth':
        lines.push(`    scene.fog = new THREE.FogExp2('#0a0a0a', 0.05);`);
        break;
      case 'light-rays':
        // Simplified light ray via spotlight
        lines.push(`    var rayLight = new THREE.SpotLight('#ffffff', 0.5, 20, Math.PI / 6, 0.5);`);
        lines.push(`    rayLight.position.set(0, 10, 0);`);
        lines.push(`    scene.add(rayLight);`);
        break;
      case 'gradient-bg':
        // Handled in background code
        break;
    }
  }

  return lines.join('\n');
}

function generateParticles(count: number, style: 'float' | 'rain' | 'sparkle'): string {
  const speedY = style === 'rain' ? -0.5 : style === 'sparkle' ? 0.1 : 0.05;
  const spread = style === 'rain' ? 10 : 8;
  const size = style === 'sparkle' ? 0.03 : 0.02;

  return `    var particleGeo = new THREE.BufferGeometry();
    var particleCount = ${count};
    var particlePositions = new Float32Array(particleCount * 3);
    for (var i = 0; i < particleCount * 3; i += 3) {
      particlePositions[i] = (Math.random() - 0.5) * ${spread};
      particlePositions[i + 1] = (Math.random() - 0.5) * ${spread};
      particlePositions[i + 2] = (Math.random() - 0.5) * ${spread};
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    var particleMat = new THREE.PointsMaterial({ color: '#ffffff', size: ${size}, transparent: true, opacity: 0.6 });
    var particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);
    var particleSpeedY = ${speedY};`;
}

function generateAnimationSetup(_animations: AnimationConfig[]): string {
  // No additional setup needed — state vars already declared
  return '';
}

function generateAnimationLoop(
  animations: AnimationConfig[],
  spec: SceneSpec
): string {
  const lines: string[] = [];
  const speed = spec.overrides?.animationSpeed ?? 1;

  for (const anim of animations) {
    if (!anim) continue;

    switch (anim.type) {
      case 'continuous':
        if (anim.property === 'rotation.y' || (anim.property === 'rotation' && anim.axis === 'y')) {
          lines.push(`        mesh.rotation.y += ${anim.speed * speed} * delta;`);
        } else if (anim.property === 'rotation.x' || (anim.property === 'rotation' && anim.axis === 'x')) {
          lines.push(`        mesh.rotation.x += ${anim.speed * speed} * delta;`);
        } else if (anim.property === 'rotation' && !anim.axis) {
          lines.push(`        mesh.rotation.y += ${anim.speed * 0.7 * speed} * delta;`);
          lines.push(`        mesh.rotation.x += ${anim.speed * 0.3 * speed} * delta;`);
        } else if (anim.property === 'position.y' || anim.property.includes('float')) {
          const range = anim.range;
          lines.push(`        mesh.position.y = ${(range[0] + range[1]) / 2} + Math.sin(elapsed * ${anim.speed * speed}) * ${(range[1] - range[0]) / 2};`);
        } else if (anim.property === 'scale') {
          const range = anim.range;
          const mid = (range[0] + range[1]) / 2;
          const amp = (range[1] - range[0]) / 2;
          lines.push(`        var breatheScale = ${mid} + Math.sin(elapsed * ${anim.speed * speed}) * ${amp};`);
          lines.push(`        mesh.scale.setScalar(breatheScale);`);
        }
        break;

      case 'scroll':
        if (anim.property.includes('rotation')) {
          lines.push(`        mesh.rotation.y = scrollProgress * Math.PI * 2 * ${speed};`);
        } else if (anim.property.includes('zoom') || anim.property.includes('scale')) {
          lines.push(`        var scrollScale = 0.5 + scrollProgress * 0.5 * ${speed};`);
          lines.push(`        mesh.scale.setScalar(scrollScale);`);
        } else if (anim.property.includes('parallax') || anim.property.includes('position')) {
          lines.push(`        mesh.position.y = (scrollProgress - 0.5) * 2 * ${speed};`);
        }
        break;

      case 'interaction':
        if (anim.interactionEvent === 'hover') {
          if (anim.property.includes('tilt') || anim.property.includes('rotation')) {
            lines.push(`        mesh.rotation.x += (mouseY * ${anim.speed} - mesh.rotation.x) * 0.05;`);
            lines.push(`        mesh.rotation.y += (mouseX * ${anim.speed} - mesh.rotation.y) * 0.05;`);
          } else if (anim.property.includes('lift') || anim.property.includes('position')) {
            lines.push(`        mesh.position.y += (mouseY * ${anim.speed} - mesh.position.y) * 0.05;`);
          }
        }
        break;
    }
  }

  // Particle animations
  if (spec.environment.some(e => e.startsWith('particles-'))) {
    lines.push(`        if (typeof particles !== 'undefined') {`);
    lines.push(`          particles.rotation.y += 0.001 * ${speed};`);
    if (spec.environment.includes('particles-rain')) {
      lines.push(`          var pPos = particles.geometry.attributes.position.array;`);
      lines.push(`          for (var pi = 1; pi < pPos.length; pi += 3) {`);
      lines.push(`            pPos[pi] += particleSpeedY * delta;`);
      lines.push(`            if (pPos[pi] < -4) pPos[pi] = 4;`);
      lines.push(`          }`);
      lines.push(`          particles.geometry.attributes.position.needsUpdate = true;`);
    } else if (spec.environment.includes('particles-sparkle')) {
      lines.push(`          particleMat.opacity = 0.3 + Math.sin(elapsed * 2) * 0.3;`);
    }
    lines.push(`        }`);
  }

  return lines.map(l => l).join('\n');
}
