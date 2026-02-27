import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Play, RotateCcw, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';

// --- Constants ---
const WORLD_SPEED = 0.6;
const AIRCRAFT_SPEED = 0.25;
const ROTATION_SPEED = 0.08;
const RING_SPAWN_INTERVAL = 1800; // ms
const OBSTACLE_SPAWN_INTERVAL = 1200; // ms
const MAX_X = 18;
const MAX_Y = 12;
const MIN_Y = -4;

interface GameState {
  score: number;
  isGameOver: boolean;
  isStarted: boolean;
  highScore: number;
}

export default function Game() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [gameState, setGameState] = useState<GameState>({
    score: 0,
    isGameOver: false,
    isStarted: false,
    highScore: parseInt(localStorage.getItem('skybound_highscore') || '0'),
  });

  // Refs for game logic state to avoid stale closures in the loop
  const gameRunningRef = useRef({
    isStarted: false,
    isGameOver: false,
    score: 0
  });

  // Refs for Three.js objects to avoid re-renders
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const aircraftRef = useRef<THREE.Group | null>(null);
  const ringsRef = useRef<THREE.Mesh[]>([]);
  const obstaclesRef = useRef<THREE.Mesh[]>([]);
  const cloudsRef = useRef<THREE.Group[]>([]);
  const trailsRef = useRef<THREE.Mesh[]>([]);
  const frameIdRef = useRef<number | null>(null);
  const clockRef = useRef(new THREE.Clock());

  // Input state
  const keysRef = useRef<{ [key: string]: boolean }>({});

  useEffect(() => {
    if (!containerRef.current) return;

    // --- Scene Setup ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x001a33); // Darker deep sky
    scene.fog = new THREE.FogExp2(0x001a33, 0.008);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 3, 12);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ReinhardToneMapping;
    renderer.toneMappingExposure = 1.2;
    const canvas = renderer.domElement;
    containerRef.current.appendChild(canvas);
    rendererRef.current = renderer;

    // --- Lighting ---
    const ambientLight = new THREE.AmbientLight(0x4040ff, 0.4);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    const pointLight = new THREE.PointLight(0x00ffff, 2, 50);
    pointLight.position.set(0, 5, 5);
    scene.add(pointLight);

    // --- Aircraft ---
    const aircraft = createAircraft();
    scene.add(aircraft);
    aircraftRef.current = aircraft;

    // --- Ground (Grid) ---
    const groundGeometry = new THREE.PlaneGeometry(2000, 2000, 100, 100);
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x00ffff,
      wireframe: true,
      transparent: true,
      opacity: 0.15,
      emissive: 0x004444,
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -15;
    scene.add(ground);

    // --- Resize Handler ---
    const handleResize = () => {
      if (!cameraRef.current || !rendererRef.current) return;
      cameraRef.current.aspect = window.innerWidth / window.innerHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    // --- Input Handlers ---
    const handleKeyDown = (e: KeyboardEvent) => (keysRef.current[e.code] = true);
    const handleKeyUp = (e: KeyboardEvent) => (keysRef.current[e.code] = false);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // --- Clouds ---
    const spawnCloud = () => {
      const group = new THREE.Group();
      const count = 5 + Math.floor(Math.random() * 5);
      for (let i = 0; i < count; i++) {
        const geom = new THREE.IcosahedronGeometry(2 + Math.random() * 3, 1);
        const mat = new THREE.MeshStandardMaterial({ 
          color: 0xffffff, 
          transparent: true, 
          opacity: 0.4,
          roughness: 0.8 
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(Math.random() * 10 - 5, Math.random() * 5 - 2.5, Math.random() * 10 - 5);
        group.add(mesh);
      }
      group.position.set((Math.random() - 0.5) * 150, (Math.random() - 0.5) * 60 + 20, -300);
      scene.add(group);
      cloudsRef.current.push(group);
    };

    // Initial clouds
    for (let i = 0; i < 20; i++) spawnCloud();

    // --- Game Loop ---
    let lastRingSpawn = 0;
    let lastObstacleSpawn = 0;

    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate);
      const delta = Math.min(clockRef.current.getDelta(), 0.1); // Cap delta to avoid huge jumps
      const time = clockRef.current.getElapsedTime();

      if (gameRunningRef.current.isStarted && !gameRunningRef.current.isGameOver) {
        // Handle Movement
        updateAircraft(delta);

        // Spawn Rings
        if (time * 1000 - lastRingSpawn > RING_SPAWN_INTERVAL) {
          spawnRing();
          lastRingSpawn = time * 1000;
        }

        // Spawn Obstacles
        if (time * 1000 - lastObstacleSpawn > OBSTACLE_SPAWN_INTERVAL) {
          spawnObstacle();
          lastObstacleSpawn = time * 1000;
        }

        // Update Objects
        updateRings(delta);
        updateObstacles(delta);
        updateTrails(delta);

        // Update Clouds
        cloudsRef.current.forEach((cloud) => {
          cloud.position.z += WORLD_SPEED * 80 * delta;
          if (cloud.position.z > 50) {
            cloud.position.z = -300;
            cloud.position.x = (Math.random() - 0.5) * 150;
          }
        });

        // Ground animation
        ground.position.z += WORLD_SPEED * 20 * delta;
        if (ground.position.z > 100) ground.position.z = 0;

        // Dynamic Camera FOV
        if (cameraRef.current) {
          const targetFOV = 70 + (Math.abs(aircraftRef.current?.rotation.z || 0) * 15);
          cameraRef.current.fov = THREE.MathUtils.lerp(cameraRef.current.fov, targetFOV, 0.1);
          cameraRef.current.updateProjectionMatrix();
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (frameIdRef.current) cancelAnimationFrame(frameIdRef.current);
      cloudsRef.current.forEach(c => scene.remove(c));
      cloudsRef.current = [];
      if (containerRef.current && canvas) {
        containerRef.current.removeChild(canvas);
      }
      renderer.dispose();
    };
  }, []); // Only run once on mount

  // --- Helper Functions ---

  function createAircraft() {
    const group = new THREE.Group();

    // Body - Sleeker
    const bodyGeom = new THREE.CylinderGeometry(0.4, 0.6, 4, 8);
    const bodyMat = new THREE.MeshStandardMaterial({ 
      color: 0x333333, 
      metalness: 0.8, 
      roughness: 0.2,
      emissive: 0x111111 
    });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.rotation.x = Math.PI / 2;
    group.add(body);

    // Wings - Angled
    const wingGeom = new THREE.BoxGeometry(5, 0.05, 1.5);
    const wingMat = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x004444 });
    const wings = new THREE.Mesh(wingGeom, wingMat);
    wings.position.set(0, 0, -0.2);
    group.add(wings);

    // Tail
    const tailGeom = new THREE.BoxGeometry(0.05, 1.2, 0.8);
    const tailMat = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x004444 });
    const tail = new THREE.Mesh(tailGeom, tailMat);
    tail.position.set(0, 0.6, -1.5);
    group.add(tail);

    // Cockpit - Glowing
    const cockpitGeom = new THREE.SphereGeometry(0.35, 16, 16);
    const cockpitMat = new THREE.MeshStandardMaterial({ 
      color: 0x00ffff, 
      emissive: 0x00ffff, 
      emissiveIntensity: 0.5,
      transparent: true, 
      opacity: 0.8 
    });
    const cockpit = new THREE.Mesh(cockpitGeom, cockpitMat);
    cockpit.position.set(0, 0.4, 0.8);
    cockpit.scale.set(1, 1, 2.5);
    group.add(cockpit);

    // Engines
    const engineGeom = new THREE.CylinderGeometry(0.3, 0.3, 1, 8);
    const engineMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const engineL = new THREE.Mesh(engineGeom, engineMat);
    engineL.rotation.x = Math.PI / 2;
    engineL.position.set(-1.2, -0.2, -1);
    group.add(engineL);

    const engineR = engineL.clone();
    engineR.position.x = 1.2;
    group.add(engineR);

    return group;
  }

  function updateAircraft(delta: number) {
    if (!aircraftRef.current) return;

    const speed = AIRCRAFT_SPEED * 60 * delta;
    
    let targetX = aircraftRef.current.position.x;
    let targetY = aircraftRef.current.position.y;
    let targetRotZ = 0;
    let targetRotX = 0;

    const isLeft = keysRef.current['ArrowLeft'] || keysRef.current['KeyA'];
    const isRight = keysRef.current['ArrowRight'] || keysRef.current['KeyD'];
    const isUp = keysRef.current['ArrowUp'] || keysRef.current['KeyW'];
    const isDown = keysRef.current['ArrowDown'] || keysRef.current['KeyS'];

    if (isLeft) {
      targetX -= speed;
      targetRotZ = 0.8;
    }
    if (isRight) {
      targetX += speed;
      targetRotZ = -0.8;
    }
    if (isUp) {
      targetY += speed;
      targetRotX = 0.3;
    }
    if (isDown) {
      targetY -= speed;
      targetRotX = -0.3;
    }

    // Constraints
    aircraftRef.current.position.x = THREE.MathUtils.lerp(aircraftRef.current.position.x, THREE.MathUtils.clamp(targetX, -MAX_X, MAX_X), 0.15);
    aircraftRef.current.position.y = THREE.MathUtils.lerp(aircraftRef.current.position.y, THREE.MathUtils.clamp(targetY, MIN_Y, MAX_Y), 0.15);

    // Smooth Rotation - More aggressive banking
    aircraftRef.current.rotation.z = THREE.MathUtils.lerp(aircraftRef.current.rotation.z, targetRotZ, 0.1);
    aircraftRef.current.rotation.x = THREE.MathUtils.lerp(aircraftRef.current.rotation.x, targetRotX, 0.1);
    aircraftRef.current.rotation.y = THREE.MathUtils.lerp(aircraftRef.current.rotation.y, -targetRotZ * 0.2, 0.1);

    // Camera follow - More dynamic
    if (cameraRef.current) {
      const camTargetX = aircraftRef.current.position.x * 0.6;
      const camTargetY = aircraftRef.current.position.y + 3;
      const camTargetZ = 12 + (Math.abs(targetRotZ) * 2); // Pull back on turns

      cameraRef.current.position.x = THREE.MathUtils.lerp(cameraRef.current.position.x, camTargetX, 0.08);
      cameraRef.current.position.y = THREE.MathUtils.lerp(cameraRef.current.position.y, camTargetY, 0.08);
      cameraRef.current.position.z = THREE.MathUtils.lerp(cameraRef.current.position.z, camTargetZ, 0.08);
      
      cameraRef.current.lookAt(
        aircraftRef.current.position.x * 0.8, 
        aircraftRef.current.position.y, 
        aircraftRef.current.position.z - 10
      );
    }

    // Spawn Trail
    if (Math.random() > 0.5) spawnTrail();
  }

  function spawnTrail() {
    if (!sceneRef.current || !aircraftRef.current) return;
    const geom = new THREE.SphereGeometry(0.1, 4, 4);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.6 });
    const trail = new THREE.Mesh(geom, mat);
    
    // Position at engines
    const offset = (Math.random() > 0.5 ? 1 : -1) * 1.2;
    trail.position.copy(aircraftRef.current.position);
    trail.position.x += offset;
    trail.position.y -= 0.2;
    trail.position.z -= 1;
    
    sceneRef.current.add(trail);
    trailsRef.current.push(trail);
  }

  function updateTrails(delta: number) {
    const speed = WORLD_SPEED * 100 * delta;
    for (let i = trailsRef.current.length - 1; i >= 0; i--) {
      const trail = trailsRef.current[i];
      trail.position.z += speed;
      trail.scale.multiplyScalar(0.95);
      if (trail.scale.x < 0.1) {
        sceneRef.current?.remove(trail);
        trailsRef.current.splice(i, 1);
      }
    }
  }

  function spawnRing() {
    if (!sceneRef.current) return;
    const geometry = new THREE.TorusGeometry(2.5, 0.15, 16, 48);
    const material = new THREE.MeshStandardMaterial({ 
      color: 0x00ffff, 
      emissive: 0x00ffff,
      emissiveIntensity: 1,
      metalness: 1,
      roughness: 0
    });
    const ring = new THREE.Mesh(geometry, material);

    ring.position.set(
      (Math.random() - 0.5) * 35,
      (Math.random() - 0.5) * 15 + 2,
      -150
    );
    sceneRef.current.add(ring);
    ringsRef.current.push(ring);
  }

  function spawnObstacle() {
    if (!sceneRef.current) return;
    const geometry = new THREE.OctahedronGeometry(2, 0);
    const material = new THREE.MeshStandardMaterial({ 
      color: 0xff0055, 
      emissive: 0x330011,
      metalness: 0.5,
      roughness: 0.5
    });
    const obstacle = new THREE.Mesh(geometry, material);

    obstacle.position.set(
      (Math.random() - 0.5) * 40,
      (Math.random() - 0.5) * 20 + 2,
      -150
    );
    obstacle.rotation.set(Math.random(), Math.random(), Math.random());
    sceneRef.current.add(obstacle);
    obstaclesRef.current.push(obstacle);
  }

  function updateRings(delta: number) {
    if (!aircraftRef.current) return;
    const speed = WORLD_SPEED * 120 * delta;

    for (let i = ringsRef.current.length - 1; i >= 0; i--) {
      const ring = ringsRef.current[i];
      ring.position.z += speed;
      ring.rotation.y += 0.05;

      // Collision Detection
      const dist = ring.position.distanceTo(aircraftRef.current.position);
      if (dist < 3) {
        gameRunningRef.current.score += 10;
        setGameState(prev => ({ ...prev, score: gameRunningRef.current.score }));
        sceneRef.current?.remove(ring);
        ringsRef.current.splice(i, 1);
        continue;
      }

      if (ring.position.z > 20) {
        sceneRef.current?.remove(ring);
        ringsRef.current.splice(i, 1);
      }
    }
  }

  function updateObstacles(delta: number) {
    if (!aircraftRef.current) return;
    const speed = WORLD_SPEED * 120 * delta;

    for (let i = obstaclesRef.current.length - 1; i >= 0; i--) {
      const obstacle = obstaclesRef.current[i];
      obstacle.position.z += speed;
      obstacle.rotation.x += 0.02;
      obstacle.rotation.y += 0.02;

      // Collision Detection
      const dist = obstacle.position.distanceTo(aircraftRef.current.position);
      if (dist < 2) {
        gameOver();
      }

      if (obstacle.position.z > 20) {
        sceneRef.current?.remove(obstacle);
        obstaclesRef.current.splice(i, 1);
      }
    }
  }

  function gameOver() {
    gameRunningRef.current.isGameOver = true;
    setGameState(prev => {
      const newHighScore = Math.max(gameRunningRef.current.score, prev.highScore);
      localStorage.setItem('skybound_highscore', newHighScore.toString());
      return { ...prev, isGameOver: true, highScore: newHighScore };
    });
  }

  const startGame = () => {
    // Reset state
    gameRunningRef.current = {
      isStarted: true,
      isGameOver: false,
      score: 0
    };
    setGameState(prev => ({ ...prev, score: 0, isGameOver: false, isStarted: true }));
    // Clear existing objects
    ringsRef.current.forEach(r => sceneRef.current?.remove(r));
    obstaclesRef.current.forEach(o => sceneRef.current?.remove(o));
    trailsRef.current.forEach(t => sceneRef.current?.remove(t));
    ringsRef.current = [];
    obstaclesRef.current = [];
    trailsRef.current = [];
    if (aircraftRef.current) {
      aircraftRef.current.position.set(0, 0, 0);
      aircraftRef.current.rotation.set(0, 0, 0);
    }
    clockRef.current.start();
  };

  // Mobile Controls
  const handleTouch = (dir: string, active: boolean) => {
    const keyMap: { [key: string]: string } = {
      up: 'ArrowUp',
      down: 'ArrowDown',
      left: 'ArrowLeft',
      right: 'ArrowRight'
    };
    keysRef.current[keyMap[dir]] = active;
  };

  return (
    <div className="relative w-full h-full font-sans text-white overflow-hidden">
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {/* UI Overlay */}
      <div className="absolute top-0 left-0 w-full p-6 flex justify-between items-start z-10 pointer-events-none">
        <div className="bg-black/40 backdrop-blur-md p-4 rounded-2xl border border-white/10">
          <p className="text-xs uppercase tracking-widest opacity-60 mb-1">Score</p>
          <p className="text-4xl font-bold tabular-nums">{gameState.score}</p>
        </div>
        <div className="bg-black/40 backdrop-blur-md p-4 rounded-2xl border border-white/10 text-right">
          <p className="text-xs uppercase tracking-widest opacity-60 mb-1 flex items-center justify-end gap-2">
            <Trophy size={12} /> High Score
          </p>
          <p className="text-2xl font-bold tabular-nums">{gameState.highScore}</p>
        </div>
      </div>

      {/* Start Screen */}
      <AnimatePresence>
        {!gameState.isStarted && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm"
          >
            <motion.h1
              initial={{ y: -50 }}
              animate={{ y: 0 }}
              className="text-7xl font-black italic tracking-tighter mb-2 text-transparent bg-clip-text bg-gradient-to-b from-white to-white/40"
            >
              SKYBOUND ACE
            </motion.h1>
            <p className="text-white/60 mb-12 tracking-widest uppercase text-sm">3D Flight Simulator</p>
            
            <button
              onClick={startGame}
              className="group relative flex items-center gap-4 bg-white text-black px-12 py-6 rounded-full font-bold text-xl transition-all hover:scale-105 active:scale-95"
            >
              <Play fill="currentColor" />
              START MISSION
              <div className="absolute -inset-1 bg-white/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>

            <div className="mt-12 grid grid-cols-2 gap-8 text-center text-white/40 text-xs uppercase tracking-widest">
              <div>
                <p className="mb-2">Movement</p>
                <p className="text-white">WASD / ARROWS</p>
              </div>
              <div>
                <p className="mb-2">Objective</p>
                <p className="text-white">COLLECT RINGS</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Game Over Screen */}
      <AnimatePresence>
        {gameState.isGameOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-red-950/80 backdrop-blur-md"
          >
            <h2 className="text-6xl font-black italic mb-2">MISSION FAILED</h2>
            <p className="text-white/60 mb-8 uppercase tracking-widest">Aircraft Destroyed</p>
            
            <div className="bg-black/40 p-8 rounded-3xl border border-white/10 mb-12 text-center min-w-[300px]">
              <p className="text-sm text-white/40 uppercase mb-2">Final Score</p>
              <p className="text-6xl font-bold mb-6">{gameState.score}</p>
              <div className="h-px bg-white/10 mb-6" />
              <p className="text-xs text-white/40 uppercase mb-1">Personal Best</p>
              <p className="text-2xl font-bold">{gameState.highScore}</p>
            </div>

            <button
              onClick={startGame}
              className="flex items-center gap-4 bg-white text-black px-12 py-6 rounded-full font-bold text-xl transition-all hover:scale-105 active:scale-95"
            >
              <RotateCcw />
              RETRY MISSION
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Controls */}
      {gameState.isStarted && !gameState.isGameOver && (
        <div className="absolute bottom-12 left-0 w-full px-8 flex justify-between items-end z-10 md:hidden">
          <div className="grid grid-cols-3 gap-2">
            <div />
            <ControlButton icon={<ArrowUp />} onTouch={(a) => handleTouch('up', a)} />
            <div />
            <ControlButton icon={<ArrowLeft />} onTouch={(a) => handleTouch('left', a)} />
            <ControlButton icon={<ArrowDown />} onTouch={(a) => handleTouch('down', a)} />
            <ControlButton icon={<ArrowRight />} onTouch={(a) => handleTouch('right', a)} />
          </div>
        </div>
      )}
    </div>
  );
}

function ControlButton({ icon, onTouch }: { icon: React.ReactNode, onTouch: (active: boolean) => void }) {
  return (
    <button
      className="w-16 h-16 bg-white/10 backdrop-blur-md rounded-2xl flex items-center justify-center active:bg-white/30 transition-colors pointer-events-auto"
      onMouseDown={() => onTouch(true)}
      onMouseUp={() => onTouch(false)}
      onMouseLeave={() => onTouch(false)}
      onTouchStart={(e) => { e.preventDefault(); onTouch(true); }}
      onTouchEnd={(e) => { e.preventDefault(); onTouch(false); }}
    >
      {icon}
    </button>
  );
}
