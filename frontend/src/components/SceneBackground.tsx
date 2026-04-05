import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

function Sparks() {
  const count = 120;
  const mesh = useRef<THREE.Points>(null);

  const { positions, sizes, speeds } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const sizes     = new Float32Array(count);
    const speeds    = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 20;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 10;
      sizes[i]             = Math.random() * 2.5 + 0.5;
      speeds[i]            = Math.random() * 0.004 + 0.001;
    }
    return { positions, sizes, speeds };
  }, []);

  useFrame(() => {
    if (!mesh.current) return;
    const pos = mesh.current.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      pos[i * 3 + 1] += speeds[i];
      if (pos[i * 3 + 1] > 10) {
        pos[i * 3 + 1] = -10;
        pos[i * 3]     = (Math.random() - 0.5) * 20;
      }
    }
    mesh.current.geometry.attributes.position.needsUpdate = true;
  });

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("size",     new THREE.BufferAttribute(sizes, 1));
    return g;
  }, [positions, sizes]);

  return (
    <points ref={mesh} geometry={geo}>
      <pointsMaterial
        size={0.06}
        color="#f97316"
        transparent
        opacity={0.35}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

function GlowOrb() {
  const mesh = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!mesh.current) return;
    const t = clock.getElapsedTime();
    mesh.current.position.y = Math.sin(t * 0.3) * 0.4;
    mesh.current.scale.setScalar(1 + Math.sin(t * 0.5) * 0.05);
  });

  return (
    <mesh ref={mesh} position={[3, -1, -4]}>
      <sphereGeometry args={[1.8, 32, 32]} />
      <meshStandardMaterial
        color="#f97316"
        emissive="#ea580c"
        emissiveIntensity={0.4}
        transparent
        opacity={0.08}
        roughness={1}
      />
    </mesh>
  );
}

export function SceneBackground() {
  return (
    <div className="fixed inset-0 -z-10">
      <Canvas
        camera={{ position: [0, 0, 8], fov: 60 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: "#111111" }}
      >
        <ambientLight intensity={0.2} />
        <pointLight position={[4, 4, 4]} intensity={1} color="#fbbf24" />
        <Sparks />
        <GlowOrb />
      </Canvas>
    </div>
  );
}