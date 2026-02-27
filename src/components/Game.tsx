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
  const buildingsRef = useRef<THREE.Mesh[]>([]);
  const frameIdRef = useRef<number | null>(null);
  const clockRef = useRef(new THREE.Clock());

  // Input state
  const keysRef = useRef<{ [key: string]: boolean }>({});

  useEffect(() => {
    if (!containerRef.current) return;

    // --- Scene Setup ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111); // Night city
    scene.fog = new THREE.FogExp2(0x111111, 0.02);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      2000
    );
    camera.position.set(0, 5, 15);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = renderer.domElement;
    containerRef.current.appendChild(canvas);
    rendererRef.current = renderer;

    // --- Lighting ---
    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1);
    sunLight.position.set(50, 100, 50);
    sunLight.castShadow = true;
    sunLight.shadow.camera.left = -100;
    sunLight.shadow.camera.right = 100;
    sunLight.shadow.camera.top = 100;
    sunLight.shadow.camera.bottom = -100;
    scene.add(sunLight);

    // --- Ground ---
    const groundGeom = new THREE.PlaneGeometry(2000, 2000);
    const groundMat = new THREE.MeshStandardMaterial({ 
      color: 0x222222,
      roughness: 0.8,
      metalness: 0.2
    });
    const ground = new THREE.Mesh(groundGeom, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Road Grid
    const grid = new THREE.GridHelper(2000, 100, 0x00ffff, 0x444444);
    grid.position.y = 0.01;
    scene.add(grid);

    // --- Car ---
    const car = createCar();
    scene.add(car);
    carRef.current = car;

    // --- Environment (Buildings) ---
    createCity(scene);

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

  function createCar() {
    const group = new THREE.Group();
    const carBody = new THREE.Group(); // Sub-group for tilting
    group.add(carBody);

    // Body
    const bodyGeom = new THREE.BoxGeometry(2, 0.6, 4.5);
    const bodyMat = new THREE.MeshStandardMaterial({ 
      color: 0xcc0000, 
      metalness: 0.9, 
      roughness: 0.1,
      envMapIntensity: 1
    });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = 0.6;
    body.castShadow = true;
    carBody.add(body);

    // Cabin (Glassy)
    const cabinGeom = new THREE.BoxGeometry(1.7, 0.7, 2.2);
    const cabinMat = new THREE.MeshStandardMaterial({ 
      color: 0x111111, 
      metalness: 1, 
      roughness: 0,
      transparent: true,
      opacity: 0.9
    });
    const cabin = new THREE.Mesh(cabinGeom, cabinMat);
    cabin.position.set(0, 1.2, -0.1);
    cabin.castShadow = true;
    carBody.add(cabin);

    // Spoiler
    const spoilerPostGeom = new THREE.BoxGeometry(0.1, 0.4, 0.1);
    const spoilerPostL = new THREE.Mesh(spoilerPostGeom, bodyMat);
    spoilerPostL.position.set(-0.7, 1, -1.8);
    carBody.add(spoilerPostL);
    const spoilerPostR = spoilerPostL.clone();
    spoilerPostR.position.x = 0.7;
    carBody.add(spoilerPostR);

    const spoilerWingGeom = new THREE.BoxGeometry(2.2, 0.1, 0.6);
    const spoilerWing = new THREE.Mesh(spoilerWingGeom, bodyMat);
    spoilerWing.position.set(0, 1.2, -1.8);
    carBody.add(spoilerWing);

    // Wheels
    const wheelGeom = new THREE.CylinderGeometry(0.45, 0.45, 0.4, 24);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9 });
    const rimGeom = new THREE.CylinderGeometry(0.3, 0.3, 0.41, 12);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 1, roughness: 0.2 });

    const wheelPositions = [
      [-1.1, 0.45, 1.4], [1.1, 0.45, 1.4],
      [-1.1, 0.45, -1.4], [1.1, 0.45, -1.4]
    ];

    wheelPositions.forEach(pos => {
      const wheelGroup = new THREE.Group();
      const wheel = new THREE.Mesh(wheelGeom, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheelGroup.add(wheel);

      const rim = new THREE.Mesh(rimGeom, rimMat);
      rim.rotation.z = Math.PI / 2;
      wheelGroup.add(rim);

      wheelGroup.position.set(pos[0], pos[1], pos[2]);
      wheelGroup.castShadow = true;
      group.add(wheelGroup);
    });

    // Headlights (Emissive)
    const lightGeom = new THREE.BoxGeometry(0.5, 0.2, 0.1);
    const lightMat = new THREE.MeshStandardMaterial({ 
      color: 0xffffff, 
      emissive: 0xffffff, 
      emissiveIntensity: 2 
    });
    const lightL = new THREE.Mesh(lightGeom, lightMat);
    lightL.position.set(-0.65, 0.7, 2.2);
    carBody.add(lightL);

    const lightR = lightL.clone();
    lightR.position.x = 0.65;
    carBody.add(lightR);

    // Tail lights
    const tailLightMat = new THREE.MeshStandardMaterial({ 
      color: 0xff0000, 
      emissive: 0xff0000, 
      emissiveIntensity: 1 
    });
    const tailL = new THREE.Mesh(lightGeom, tailLightMat);
    tailL.position.set(-0.65, 0.7, -2.2);
    carBody.add(tailL);

    const tailR = tailL.clone();
    tailR.position.x = 0.65;
    carBody.add(tailR);

    return group;
  }

  function createCity(scene: THREE.Scene) {
    const buildingGeom = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 300; i++) {
      const h = 15 + Math.random() * 60;
      const w = 8 + Math.random() * 12;
      const d = 8 + Math.random() * 12;
      
      const hue = Math.random() * 0.1 + 0.6; // Blueish/Greyish
      const mat = new THREE.MeshStandardMaterial({ 
        color: new THREE.Color().setHSL(hue, 0.1, 0.15),
        roughness: 0.5,
        metalness: 0.5
      });
      
      const building = new THREE.Mesh(buildingGeom, mat);
      building.scale.set(w, h, d);
      building.position.set(
        (Math.random() - 0.5) * 600,
        h / 2,
        (Math.random() - 0.5) * 600
      );
      
      if (Math.abs(building.position.x) < 20 || Math.abs(building.position.z) < 20) {
        building.position.x += 40;
      }
      
      building.castShadow = true;
      building.receiveShadow = true;
      scene.add(building);
      buildingsRef.current.push(building);

      // Add windows (emissive dots)
      if (Math.random() > 0.3) {
        const windowGeom = new THREE.PlaneGeometry(0.5, 0.5);
        const windowMat = new THREE.MeshBasicMaterial({ color: 0xffffaa });
        for (let j = 0; j < 10; j++) {
          const win = new THREE.Mesh(windowGeom, windowMat);
          win.position.set(
            (Math.random() - 0.5) * w,
            Math.random() * h,
            d / 2 + 0.01
          );
          building.add(win);
        }
      }
    }

    // Street Lamps
    for (let i = 0; i < 50; i++) {
      const lampGroup = new THREE.Group();
      const poleGeom = new THREE.CylinderGeometry(0.1, 0.1, 8);
      const pole = new THREE.Mesh(poleGeom, new THREE.MeshStandardMaterial({ color: 0x333333 }));
      pole.position.y = 4;
      lampGroup.add(pole);

      const bulbGeom = new THREE.SphereGeometry(0.3);
      const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffccaa });
      const bulb = new THREE.Mesh(bulbGeom, bulbMat);
      bulb.position.set(0, 8, 1);
      lampGroup.add(bulb);

      const lampLight = new THREE.PointLight(0xffccaa, 10, 30);
      lampLight.position.set(0, 8, 1);
      lampGroup.add(lampLight);

      lampGroup.position.set(
        (Math.random() - 0.5) * 500,
        0,
        (Math.random() - 0.5) * 500
      );
      if (Math.abs(lampGroup.position.x) < 10) lampGroup.position.x += 15;
      scene.add(lampGroup);
    }
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

    // Camera follow - Dynamic
    const camDist = 15 + Math.abs(speed) * 5;
    const camHeight = 6 + Math.abs(speed) * 2;
    const camOffset = new THREE.Vector3(
      -Math.sin(rotation) * camDist,
      camHeight,
      -Math.cos(rotation) * camDist
    );
    cameraRef.current.position.lerp(carRef.current.position.clone().add(camOffset), 0.05);
    cameraRef.current.lookAt(carRef.current.position.clone().add(new THREE.Vector3(0, 1, 0)));
  }

  function checkCollisions() {
    if (!carRef.current) return;
    const carPos = carRef.current.position;
    
    for (const building of buildingsRef.current) {
      const bPos = building.position;
      const bScale = building.scale;
      
      const dx = Math.abs(carPos.x - bPos.x);
      const dz = Math.abs(carPos.z - bPos.z);
      
      if (dx < bScale.x / 2 + 1 && dz < bScale.z / 2 + 1) {
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
