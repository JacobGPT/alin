/**
 * Scene3DPreview — Lazy-loaded 3D preview using React Three Fiber
 *
 * This is the ONLY place that uses @react-three/fiber in the ALIN dashboard.
 * It renders a live preview of a SceneSpec in the TBWO dashboard.
 * Already in the '3d-vendor' Vite chunk via dynamic import.
 */

import { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import type { SceneSpec } from '../../products/sites/3d/types';
import { CAMERA_PRESETS } from '../../products/sites/3d/cameraPresets';
import { MATERIAL_PRESETS } from '../../products/sites/3d/materialPresets';
import type { Mesh } from 'three';

interface Scene3DPreviewProps {
  sceneSpec: SceneSpec;
  height?: number;
}

function PreviewMesh({ spec }: { spec: SceneSpec }) {
  const meshRef = useRef<Mesh>(null);
  const mat = MATERIAL_PRESETS[spec.material];

  const hasRotateY = spec.animations.includes('rotate-y') || spec.animations.includes('rotate-orbit');
  const hasFloat = spec.animations.includes('float') || spec.animations.includes('float-bounce');
  const hasBreathe = spec.animations.includes('breathe');

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    if (hasRotateY) meshRef.current.rotation.y += 0.5 * delta;
    if (hasFloat) meshRef.current.position.y = Math.sin(state.clock.elapsedTime) * 0.3;
    if (hasBreathe) {
      const s = 1 + Math.sin(state.clock.elapsedTime * 0.8) * 0.05;
      meshRef.current.scale.setScalar(s);
    }
  });

  const geometry = useMemo(() => {
    switch (spec.asset.id) {
      case 'primitive-cube': return <boxGeometry args={[1, 1, 1]} />;
      case 'primitive-sphere': return <sphereGeometry args={[1, 32, 32]} />;
      case 'primitive-torus': return <torusGeometry args={[1, 0.4, 16, 48]} />;
      case 'primitive-torusknot':
      default: return <torusKnotGeometry args={[1, 0.3, 100, 16]} />;
    }
  }, [spec.asset.id]);

  const scale = spec.asset.scale ?? 1;
  const pos = spec.asset.position ?? [0, 0, 0];

  return (
    <mesh ref={meshRef} scale={scale} position={pos as [number, number, number]}>
      {geometry}
      <meshStandardMaterial
        color={mat.color}
        metalness={mat.metalness}
        roughness={mat.roughness}
        wireframe={mat.wireframe}
        transparent={mat.transparent}
        opacity={mat.opacity}
      />
    </mesh>
  );
}

export default function Scene3DPreview({ sceneSpec, height = 300 }: Scene3DPreviewProps) {
  const cam = CAMERA_PRESETS[sceneSpec.camera];

  return (
    <div style={{ height, width: '100%' }} className="rounded-xl overflow-hidden border border-border-primary bg-background-secondary">
      <Canvas
        camera={{
          position: cam.position,
          fov: cam.fov,
          near: cam.near,
          far: cam.far,
        }}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.4} />
          <directionalLight position={[5, 5, 5]} intensity={0.8} />
          <pointLight position={[-3, 2, -3]} intensity={0.3} />
          <PreviewMesh spec={sceneSpec} />
          {cam.controlsType === 'orbit' && (
            <OrbitControls
              enableDamping
              dampingFactor={cam.damping}
              autoRotate={cam.autoRotate}
              autoRotateSpeed={cam.autoRotateSpeed ?? 1}
              target={cam.target}
            />
          )}
          <Environment preset="studio" />
        </Suspense>
      </Canvas>
    </div>
  );
}
