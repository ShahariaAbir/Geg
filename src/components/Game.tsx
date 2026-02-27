import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Play, RotateCcw, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Gauge } from 'lucide-react';

// --- Constants ---
const CAR_ACCELERATION = 0.5;
const CAR_BRAKE = 0.8;
const CAR_FRICTION = 0.98;
const CAR_STEER_SPEED = 0.04;
const CAR_MAX_SPEED = 1.5;

interface GameState {
  score: number;
  isGameOver: boolean;
  isStarted: boolean;
  highScore: number;
  speed: number;
}

export default function Game() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [gameState, setGameState] = useState<GameState>({
    score: 0,
    isGameOver: false,
    isStarted: false,
    highScore: parseInt(localStorage.getItem('urban_drive_highscore') || '0'),
    speed: 0,
  });

  // Refs for game logic state
  const gameRunningRef = useRef({
    isStarted: false,
    isGameOver: false,
    score: 0,
    speed: 0,
    velocity: new THREE.Vector3(),
    rotation: 0,
  });

  // Refs for Three.js objects
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const carRef = useRef<THREE.Group | null>(null);
  const buildingsDataRef = useRef<{ pos: THREE.Vector3, scale: THREE.Vector3, color: THREE.Color, type: number }[]>([]);
  const treesDataRef = useRef<{ pos: THREE.Vector3, scale: number }[]>([]);
  const buildingsMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const treesMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const trunkMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const frameIdRef = useRef<number | null>(null);
  const clockRef = useRef(new THREE.Clock());
  const [isLoaded, setIsLoaded] = useState(false);

  // Input state
  const keysRef = useRef<{ [key: string]: boolean }>({});

  useEffect(() => {
    if (!containerRef.current) return;

    // --- Scene Setup ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb); // Sky blue
    scene.fog = new THREE.FogExp2(0x87ceeb, 0.002);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      60, // Lower FOV for better sense of scale
      window.innerWidth / window.innerHeight,
      0.1,
      3000
    );
    camera.position.set(0, 10, 30);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ 
      antialias: true, 
      powerPreference: "high-performance",
      precision: "mediump" // Lower precision for performance
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.2)); // Even lower for stability
    renderer.shadowMap.enabled = false; // DISABLE SHADOWS FOR PERFORMANCE
    const canvas = renderer.domElement;
    containerRef.current.appendChild(canvas);
    rendererRef.current = renderer;

    // --- Lighting ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8); // Brighter ambient
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
    sunLight.position.set(100, 200, 100);
    scene.add(sunLight);

    // --- Ground ---
    const groundGeom = new THREE.PlaneGeometry(4000, 4000);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x2d5a27 }); // Grass green
    const ground = new THREE.Mesh(groundGeom, groundMat);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // Roads
    createRoads(scene);

    // --- Car ---
    const car = createCar();
    scene.add(car);
    carRef.current = car;

    // --- Environment (Buildings) ---
    generateCityData();
    createCity(scene);
    setIsLoaded(true);

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

    // --- Game Loop ---
    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate);
      const delta = Math.min(clockRef.current.getDelta(), 0.1);

      if (gameRunningRef.current.isStarted && !gameRunningRef.current.isGameOver) {
        updateCar(delta);
        checkCollisions();
      }

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (frameIdRef.current) cancelAnimationFrame(frameIdRef.current);
      if (containerRef.current && canvas) {
        containerRef.current.removeChild(canvas);
      }
      renderer.dispose();
    };
  }, []);

  // --- Helper Functions ---

  function createRoads(scene: THREE.Scene) {
    const roadMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    
    // Main Roads (Grid)
    for (let i = -10; i <= 10; i++) {
      // Horizontal
      const hRoad = new THREE.Mesh(new THREE.PlaneGeometry(4000, 20), roadMat);
      hRoad.rotation.x = -Math.PI / 2;
      hRoad.position.set(0, 0.02, i * 200);
      scene.add(hRoad);
      
      // Vertical
      const vRoad = new THREE.Mesh(new THREE.PlaneGeometry(20, 4000), roadMat);
      vRoad.rotation.x = -Math.PI / 2;
      vRoad.position.set(i * 200, 0.02, 0);
      scene.add(vRoad);

      // Road Lines
      const hLine = new THREE.Mesh(new THREE.PlaneGeometry(4000, 0.5), lineMat);
      hLine.rotation.x = -Math.PI / 2;
      hLine.position.set(0, 0.03, i * 200);
      scene.add(hLine);

      const vLine = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 4000), lineMat);
      vLine.rotation.x = -Math.PI / 2;
      vLine.position.set(i * 200, 0.03, 0);
      scene.add(vLine);
    }
  }

  function createCar() {
    const group = new THREE.Group();
    const carBody = new THREE.Group();
    group.add(carBody);

    // Body
    const bodyGeom = new THREE.BoxGeometry(2, 0.6, 4.5);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xcc0000, metalness: 0.8, roughness: 0.2 });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = 0.6;
    body.castShadow = true;
    carBody.add(body);

    // Cabin
    const cabinGeom = new THREE.BoxGeometry(1.7, 0.7, 2.2);
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0x111111, transparent: true, opacity: 0.8 });
    const cabin = new THREE.Mesh(cabinGeom, cabinMat);
    cabin.position.set(0, 1.2, -0.1);
    carBody.add(cabin);

    // Side Mirrors
    const mirrorGeom = new THREE.BoxGeometry(0.4, 0.2, 0.2);
    const mirrorL = new THREE.Mesh(mirrorGeom, bodyMat);
    mirrorL.position.set(-1.1, 1, 0.8);
    carBody.add(mirrorL);
    const mirrorR = mirrorL.clone();
    mirrorR.position.x = 1.1;
    carBody.add(mirrorR);

    // Exhausts
    const exhaustGeom = new THREE.CylinderGeometry(0.15, 0.15, 0.5, 8);
    const exhaustMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 1 });
    const exhaustL = new THREE.Mesh(exhaustGeom, exhaustMat);
    exhaustL.rotation.x = Math.PI / 2;
    exhaustL.position.set(-0.6, 0.4, -2.3);
    carBody.add(exhaustL);
    const exhaustR = exhaustL.clone();
    exhaustR.position.x = 0.6;
    carBody.add(exhaustR);

    // Wheels
    const wheelGeom = new THREE.CylinderGeometry(0.45, 0.45, 0.4, 24);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const wheelPositions = [[-1.1, 0.45, 1.4], [1.1, 0.45, 1.4], [-1.1, 0.45, -1.4], [1.1, 0.45, -1.4]];

    wheelPositions.forEach(pos => {
      const wheel = new THREE.Mesh(wheelGeom, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(pos[0], pos[1], pos[2]);
      group.add(wheel);
    });

    return group;
  }

  function generateCityData() {
    if (buildingsDataRef.current.length > 0) return;
    
    // Buildings
    for (let i = 0; i < 300; i++) {
      const h = 20 + Math.random() * 100;
      const w = 15 + Math.random() * 20;
      const d = 15 + Math.random() * 20;
      
      const hue = Math.random();
      const color = new THREE.Color().setHSL(hue, 0.4, 0.4);
      
      let x = (Math.random() - 0.5) * 2000;
      let z = (Math.random() - 0.5) * 2000;
      
      // Avoid roads
      const gridX = Math.round(x / 200) * 200;
      const gridZ = Math.round(z / 200) * 200;
      if (Math.abs(x - gridX) < 25) x += 50 * (x > gridX ? 1 : -1);
      if (Math.abs(z - gridZ) < 25) z += 50 * (z > gridZ ? 1 : -1);
      
      buildingsDataRef.current.push({
        pos: new THREE.Vector3(x, h / 2, z),
        scale: new THREE.Vector3(w, h, d),
        color: color,
        type: Math.floor(Math.random() * 3)
      });
    }

    // Trees
    for (let i = 0; i < 500; i++) {
      let x = (Math.random() - 0.5) * 2000;
      let z = (Math.random() - 0.5) * 2000;
      
      // Place near roads but not on them
      const gridX = Math.round(x / 200) * 200;
      const gridZ = Math.round(z / 200) * 200;
      const onHRoad = Math.abs(z - gridZ) < 15;
      const onVRoad = Math.abs(x - gridX) < 15;
      
      if (onHRoad || onVRoad) {
        if (onHRoad) z += 12 * (z > gridZ ? 1 : -1);
        if (onVRoad) x += 12 * (x > gridX ? 1 : -1);
        
        treesDataRef.current.push({
          pos: new THREE.Vector3(x, 0, z),
          scale: 0.5 + Math.random() * 1
        });
      }
    }
  }

  function createCity(scene: THREE.Scene) {
    const matrix = new THREE.Matrix4();
    
    // Buildings
    const buildingGeom = new THREE.BoxGeometry(1, 1, 1);
    const buildingMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const buildingsMesh = new THREE.InstancedMesh(buildingGeom, buildingMat, buildingsDataRef.current.length);
    buildingsDataRef.current.forEach((data, i) => {
      matrix.makeScale(data.scale.x, data.scale.y, data.scale.z);
      matrix.setPosition(data.pos);
      buildingsMesh.setMatrixAt(i, matrix);
      buildingsMesh.setColorAt(i, data.color);
    });
    scene.add(buildingsMesh);
    buildingsMeshRef.current = buildingsMesh;

    // Trees (Foliage)
    const treeGeom = new THREE.ConeGeometry(2, 4, 8);
    const treeMat = new THREE.MeshLambertMaterial({ color: 0x2d4c1e });
    const treesMesh = new THREE.InstancedMesh(treeGeom, treeMat, treesDataRef.current.length);
    
    // Trees (Trunks)
    const trunkGeom = new THREE.CylinderGeometry(0.2, 0.2, 2);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4b3621 });
    const trunksMesh = new THREE.InstancedMesh(trunkGeom, trunkMat, treesDataRef.current.length);

    treesDataRef.current.forEach((data, i) => {
      // Trunk
      matrix.makeScale(data.scale, data.scale, data.scale);
      matrix.setPosition(data.pos.x, 1 * data.scale, data.pos.z);
      trunksMesh.setMatrixAt(i, matrix);
      
      // Foliage
      matrix.makeScale(data.scale, data.scale, data.scale);
      matrix.setPosition(data.pos.x, 3 * data.scale, data.pos.z);
      treesMesh.setMatrixAt(i, matrix);
    });
    
    scene.add(trunksMesh);
    scene.add(treesMesh);
    treesMeshRef.current = treesMesh;
  }

  function updateCar(delta: number) {
    if (!carRef.current || !cameraRef.current) return;

    const keys = keysRef.current;
    let { speed, rotation } = gameRunningRef.current;

    // Acceleration
    if (keys['ArrowUp'] || keys['KeyW']) {
      speed += CAR_ACCELERATION * delta;
    } else if (keys['ArrowDown'] || keys['KeyS']) {
      speed -= CAR_BRAKE * delta;
    } else {
      speed *= CAR_FRICTION;
    }

    // Steering
    let steerAmount = 0;
    if (Math.abs(speed) > 0.01) {
      const steerDir = speed > 0 ? 1 : -1;
      if (keys['ArrowLeft'] || keys['KeyA']) {
        steerAmount = CAR_STEER_SPEED;
        rotation += steerAmount * steerDir;
      }
      if (keys['ArrowRight'] || keys['KeyD']) {
        steerAmount = -CAR_STEER_SPEED;
        rotation += steerAmount * steerDir;
      }
    }

    speed = THREE.MathUtils.clamp(speed, -CAR_MAX_SPEED / 2, CAR_MAX_SPEED);
    
    // Update position
    carRef.current.position.x += Math.sin(rotation) * speed;
    carRef.current.position.z += Math.cos(rotation) * speed;
    carRef.current.rotation.y = rotation;

    // Suspension Tilt (Visual only)
    const carBody = carRef.current.children[0] as THREE.Group;
    if (carBody) {
      // Tilt based on steering and acceleration
      carBody.rotation.z = THREE.MathUtils.lerp(carBody.rotation.z, steerAmount * speed * 0.5, 0.1);
      carBody.rotation.x = THREE.MathUtils.lerp(carBody.rotation.x, (speed - gameRunningRef.current.speed) * 0.5, 0.1);
    }

    gameRunningRef.current.speed = speed;
    gameRunningRef.current.rotation = rotation;
    setGameState(prev => ({ ...prev, speed: Math.abs(Math.round(speed * 100)) }));

    // Camera follow - Smooth Third Person
    const camDist = THREE.MathUtils.clamp(15 + Math.abs(speed) * 10, 15, 35); // Capped distance
    const camHeight = THREE.MathUtils.clamp(6 + Math.abs(speed) * 5, 6, 15); // Capped height
    
    // Calculate target position behind the car
    const targetCamPos = new THREE.Vector3(
      carRef.current.position.x - Math.sin(rotation) * camDist,
      carRef.current.position.y + camHeight,
      carRef.current.position.z - Math.cos(rotation) * camDist
    );
    
    // Smoothly move camera
    cameraRef.current.position.lerp(targetCamPos, 0.1); // Slightly faster lerp for responsiveness
    
    // Dynamic FOV based on speed
    const targetFOV = 60 + Math.abs(speed) * 15;
    cameraRef.current.fov = THREE.MathUtils.lerp(cameraRef.current.fov, targetFOV, 0.1);
    cameraRef.current.updateProjectionMatrix();
    
    // Look slightly ahead of the car
    const lookAheadDist = 15;
    const lookAtPos = new THREE.Vector3(
      carRef.current.position.x + Math.sin(rotation) * lookAheadDist,
      carRef.current.position.y + 2,
      carRef.current.position.z + Math.cos(rotation) * lookAheadDist
    );
    cameraRef.current.lookAt(lookAtPos);
  }

  function checkCollisions() {
    if (!carRef.current) return;
    const carPos = carRef.current.position;
    
    for (const data of buildingsDataRef.current) {
      const dx = Math.abs(carPos.x - data.pos.x);
      const dz = Math.abs(carPos.z - data.pos.z);
      
      if (dx < data.scale.x / 2 + 1 && dz < data.scale.z / 2 + 1) {
        gameOver();
        break;
      }
    }
  }

  function gameOver() {
    gameRunningRef.current.isGameOver = true;
    gameRunningRef.current.isStarted = false;
    setGameState(prev => {
      const newHighScore = Math.max(prev.score, prev.highScore);
      localStorage.setItem('urban_drive_highscore', newHighScore.toString());
      return { ...prev, isGameOver: true, highScore: newHighScore };
    });
  }

  const startGame = () => {
    gameRunningRef.current = {
      isStarted: true,
      isGameOver: false,
      score: 0,
      speed: 0,
      velocity: new THREE.Vector3(),
      rotation: 0,
    };
    if (carRef.current) {
      carRef.current.position.set(0, 0, 0);
      carRef.current.rotation.set(0, 0, 0);
    }
    setGameState(prev => ({ ...prev, score: 0, isGameOver: false, isStarted: true, speed: 0 }));
    clockRef.current.start();
  };

  return (
    <div className="relative w-full h-full font-sans text-white overflow-hidden bg-black">
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {/* HUD */}
      <div className="absolute top-0 left-0 w-full p-6 flex justify-between items-start z-10 pointer-events-none">
        <div className="bg-black/60 backdrop-blur-xl p-6 rounded-3xl border border-white/10 flex items-center gap-4 shadow-2xl">
          <div className="p-3 bg-white/10 rounded-2xl">
            <Gauge className="text-cyan-400" size={24} />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold mb-1">Velocity</p>
            <div className="flex items-baseline gap-1">
              <p className="text-4xl font-black tabular-nums tracking-tighter">{gameState.speed}</p>
              <p className="text-xs font-bold text-cyan-400">KM/H</p>
            </div>
          </div>
        </div>
        
        <div className="bg-black/60 backdrop-blur-xl p-6 rounded-3xl border border-white/10 text-right shadow-2xl">
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold mb-1 flex items-center justify-end gap-2">
            <Trophy size={12} className="text-yellow-400" /> Record
          </p>
          <p className="text-2xl font-black tabular-nums tracking-tighter">{gameState.highScore}</p>
        </div>
      </div>

      {/* Loading Screen */}
      <AnimatePresence>
        {!isLoaded && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black"
          >
            <div className="w-64 h-1 bg-white/10 rounded-full overflow-hidden mb-4">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: "100%" }}
                transition={{ duration: 2 }}
                className="h-full bg-cyan-400"
              />
            </div>
            <p className="text-[10px] uppercase tracking-[0.5em] text-white/40 font-bold">Initializing City Assets</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Start Screen */}
      <AnimatePresence>
        {!gameState.isStarted && !gameState.isGameOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-center"
            >
              <h1 className="text-8xl font-black italic tracking-tighter mb-2 text-transparent bg-clip-text bg-gradient-to-b from-white to-white/20">
                URBAN DRIVE
              </h1>
              <p className="text-cyan-400 tracking-[0.5em] uppercase text-xs font-bold mb-16">Realistic City Simulator</p>
              
              <button
                onClick={startGame}
                className="group relative px-16 py-8 bg-white text-black rounded-full font-black text-2xl transition-all hover:scale-105 active:scale-95 shadow-[0_0_50px_rgba(255,255,255,0.3)]"
              >
                <div className="flex items-center gap-4">
                  <Play fill="currentColor" size={24} />
                  IGNITION
                </div>
                <div className="absolute -inset-2 bg-white/20 blur-2xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>

              <div className="mt-20 flex gap-12 justify-center text-[10px] font-bold tracking-[0.2em] text-white/30 uppercase">
                <div className="flex flex-col gap-2">
                  <span className="text-white/60">Drive</span>
                  <span>WASD / ARROWS</span>
                </div>
                <div className="w-px h-8 bg-white/10" />
                <div className="flex flex-col gap-2">
                  <span className="text-white/60">Objective</span>
                  <span>EXPLORE & SURVIVE</span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Game Over Screen */}
      <AnimatePresence>
        {gameState.isGameOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-red-950/90 backdrop-blur-2xl"
          >
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="text-center"
            >
              <h2 className="text-7xl font-black italic mb-4 tracking-tighter">CRITICAL IMPACT</h2>
              <p className="text-white/40 mb-12 uppercase tracking-[0.3em] text-sm font-bold">Vehicle Integrity Compromised</p>
              
              <div className="bg-black/60 p-12 rounded-[3rem] border border-white/10 mb-12 shadow-2xl min-w-[400px]">
                <p className="text-[10px] text-white/40 uppercase font-black tracking-widest mb-2">Session High Speed</p>
                <p className="text-8xl font-black mb-8 tracking-tighter">{gameState.speed}<span className="text-2xl text-cyan-400 ml-2">KM/H</span></p>
                <div className="h-px bg-white/10 mb-8" />
                <div className="flex justify-between items-center px-4">
                  <span className="text-[10px] text-white/40 uppercase font-black tracking-widest">All-Time Record</span>
                  <span className="text-2xl font-black tracking-tighter">{gameState.highScore}</span>
                </div>
              </div>

              <button
                onClick={startGame}
                className="flex items-center gap-4 bg-white text-black px-16 py-8 rounded-full font-black text-2xl transition-all hover:scale-105 active:scale-95 shadow-[0_0_50px_rgba(255,255,255,0.2)]"
              >
                <RotateCcw size={24} strokeWidth={3} />
                REDEPLOY
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Vignette Effect */}
      <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_150px_rgba(0,0,0,0.8)] z-0" />
    </div>
  );
}
