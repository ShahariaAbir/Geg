import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Play, RotateCcw, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Gauge, Users, Copy, Check, Smartphone } from 'lucide-react';
import Peer, { DataConnection } from 'peerjs';

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
  cameraMode: 'third' | 'first' | 'top';
  multiplayer: {
    peerId: string;
    targetPeerId: string;
    isConnected: boolean;
    isHost: boolean;
    status: 'idle' | 'connecting' | 'connected' | 'error';
  };
  isPortrait: boolean;
}

export default function Game() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapCanvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>({
    score: 0,
    isGameOver: false,
    isStarted: false,
    highScore: parseInt(localStorage.getItem('urban_drive_highscore') || '0'),
    speed: 0,
    cameraMode: 'third',
    multiplayer: {
      peerId: '',
      targetPeerId: '',
      isConnected: false,
      isHost: false,
      status: 'idle',
    },
    isPortrait: false,
  });
  const [currentZone, setCurrentZone] = useState('Downtown');

  // Refs for game logic state
  const gameRunningRef = useRef({
    isStarted: false,
    isGameOver: false,
    score: 0,
    speed: 0,
    velocity: new THREE.Vector3(),
    rotation: 0,
    cameraMode: 'third' as 'third' | 'first' | 'top',
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
  const propsMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const trunkMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const barriersMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const windowsMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const cloudsMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const propsDataRef = useRef<{ pos: THREE.Vector3, rotation: number }[]>([]);
  const barriersDataRef = useRef<{ pos: THREE.Vector3, rotation: number }[]>([]);
  const windowsDataRef = useRef<{ pos: THREE.Vector3, scale: THREE.Vector3 }[]>([]);
  const cloudsDataRef = useRef<{ pos: THREE.Vector3, scale: THREE.Vector3 }[]>([]);
  const remotePlayersRef = useRef<{ [id: string]: THREE.Group }>({});
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const frameIdRef = useRef<number | null>(null);
  const clockRef = useRef(new THREE.Clock());
  const [isLoaded, setIsLoaded] = useState(false);

  // Input state
  const keysRef = useRef<{ [key: string]: boolean }>({});
  const isMobileRef = useRef(false);

  useEffect(() => {
    isMobileRef.current = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    const checkOrientation = () => {
      setGameState(prev => ({ ...prev, isPortrait: window.innerHeight > window.innerWidth }));
    };
    window.addEventListener('resize', checkOrientation);
    checkOrientation();

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

    // Initialize Peer
    const peer = new Peer();
    peerRef.current = peer;
    peer.on('open', (id) => {
      setGameState(prev => ({ ...prev, multiplayer: { ...prev.multiplayer, peerId: id } }));
    });

    peer.on('connection', (conn) => {
      connRef.current = conn;
      setupConnection(conn);
      setGameState(prev => ({ 
        ...prev, 
        multiplayer: { ...prev.multiplayer, isConnected: true, isHost: true, status: 'connected' } 
      }));
    });

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
      window.removeEventListener('resize', checkOrientation);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (peerRef.current) peerRef.current.destroy();
      if (frameIdRef.current) cancelAnimationFrame(frameIdRef.current);
      if (containerRef.current && canvas) {
        containerRef.current.removeChild(canvas);
      }
      renderer.dispose();
    };
  }, []);

  // --- Helper Functions ---

  function setupConnection(conn: DataConnection) {
    conn.on('data', (data: any) => {
      if (data.type === 'update') {
        updateRemotePlayer(conn.peer, data.payload);
      }
    });
    conn.on('close', () => {
      removeRemotePlayer(conn.peer);
      setGameState(prev => ({ ...prev, multiplayer: { ...prev.multiplayer, isConnected: false, status: 'idle' } }));
    });
  }

  function updateRemotePlayer(id: string, payload: any) {
    if (!sceneRef.current) return;
    let remoteCar = remotePlayersRef.current[id];
    if (!remoteCar) {
      remoteCar = createCar();
      // Change color for remote car
      const body = remoteCar.children[0].children[0] as THREE.Mesh;
      (body.material as THREE.MeshStandardMaterial).color.setHex(0x0000cc);
      sceneRef.current.add(remoteCar);
      remotePlayersRef.current[id] = remoteCar;
    }
    remoteCar.position.set(payload.pos.x, payload.pos.y, payload.pos.z);
    remoteCar.rotation.y = payload.rotation;
    
    // Update wheels rotation if needed
    const speed = payload.speed;
    remoteCar.children.forEach((child, idx) => {
      if (child instanceof THREE.Mesh && idx > 0) { // Wheels
        child.rotation.x += speed * 0.5;
      }
    });
  }

  function removeRemotePlayer(id: string) {
    const remoteCar = remotePlayersRef.current[id];
    if (remoteCar && sceneRef.current) {
      sceneRef.current.remove(remoteCar);
      delete remotePlayersRef.current[id];
    }
  }

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

    // Headlights
    const lightGeom = new THREE.BoxGeometry(0.5, 0.2, 0.1);
    const headLightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2 });
    const lightL = new THREE.Mesh(lightGeom, headLightMat);
    lightL.position.set(-0.65, 0.7, 2.2);
    carBody.add(lightL);
    const lightR = lightL.clone();
    lightR.position.x = 0.65;
    carBody.add(lightR);

    // Tail Lights
    const tailLightMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 2 });
    const tailL = new THREE.Mesh(lightGeom, tailLightMat);
    tailL.position.set(-0.65, 0.7, -2.2);
    carBody.add(tailL);
    const tailR = tailL.clone();
    tailR.position.x = 0.65;
    carBody.add(tailR);

    return group;
  }

  function generateCityData() {
    if (buildingsDataRef.current.length > 0) return;
    
    // Downtown (Center)
    for (let i = 0; i < 150; i++) {
      const h = 60 + Math.random() * 120;
      const w = 20 + Math.random() * 15;
      const d = 20 + Math.random() * 15;
      const x = (Math.random() - 0.5) * 600;
      const z = (Math.random() - 0.5) * 600;
      addBuilding(x, z, w, h, d, Math.random(), 0);
    }

    // Residential (North-East)
    for (let i = 0; i < 200; i++) {
      const h = 10 + Math.random() * 15;
      const w = 15 + Math.random() * 10;
      const d = 15 + Math.random() * 10;
      const x = 500 + (Math.random() - 0.5) * 800;
      const z = 500 + (Math.random() - 0.5) * 800;
      addBuilding(x, z, w, h, d, 0.1 + Math.random() * 0.1, 1);
    }

    // Industrial (South-West)
    for (let i = 0; i < 100; i++) {
      const h = 15 + Math.random() * 20;
      const w = 40 + Math.random() * 30;
      const d = 40 + Math.random() * 30;
      const x = -600 + (Math.random() - 0.5) * 800;
      const z = -600 + (Math.random() - 0.5) * 800;
      addBuilding(x, z, w, h, d, 0.6, 2);
    }

    // Parking Lots
    for (let i = 0; i < 15; i++) {
      const x = (Math.random() - 0.5) * 2000;
      const z = (Math.random() - 0.5) * 2000;
      addBuilding(x, z, 80, 0.5, 100, 0, 3);
      
      // Add some barriers around parking lots
      for (let j = 0; j < 4; j++) {
        barriersDataRef.current.push({
          pos: new THREE.Vector3(x + (j % 2 ? 40 : -40), 1, z + (j < 2 ? 50 : -50)),
          rotation: j < 2 ? 0 : Math.PI / 2
        });
      }
    }

    // Trees
    for (let i = 0; i < 800; i++) {
      let x = (Math.random() - 0.5) * 3000;
      let z = (Math.random() - 0.5) * 3000;
      const gridX = Math.round(x / 200) * 200;
      const gridZ = Math.round(z / 200) * 200;
      if (Math.abs(z - gridZ) < 15 || Math.abs(x - gridX) < 15) {
        if (Math.abs(z - gridZ) < 15) z += 12 * (z > gridZ ? 1 : -1);
        if (Math.abs(x - gridX) < 15) x += 12 * (x > gridX ? 1 : -1);
        treesDataRef.current.push({ pos: new THREE.Vector3(x, 0, z), scale: 0.5 + Math.random() * 1 });

        // Add a bench near some trees
        if (Math.random() > 0.7) {
          propsDataRef.current.push({
            pos: new THREE.Vector3(x + 3, 0.4, z),
            rotation: Math.random() * Math.PI
          });
        }
      }
    }

    // Clouds
    for (let i = 0; i < 50; i++) {
      cloudsDataRef.current.push({
        pos: new THREE.Vector3((Math.random() - 0.5) * 3000, 200 + Math.random() * 100, (Math.random() - 0.5) * 3000),
        scale: new THREE.Vector3(100 + Math.random() * 200, 20 + Math.random() * 40, 100 + Math.random() * 200)
      });
    }
  }

  function addBuilding(x: number, z: number, w: number, h: number, d: number, hue: number, type: number) {
    const gridX = Math.round(x / 200) * 200;
    const gridZ = Math.round(z / 200) * 200;
    if (Math.abs(x - gridX) < 30) x += 60 * (x > gridX ? 1 : -1);
    if (Math.abs(z - gridZ) < 30) z += 60 * (z > gridZ ? 1 : -1);
    
    buildingsDataRef.current.push({
      pos: new THREE.Vector3(x, h / 2, z),
      scale: new THREE.Vector3(w, h, d),
      color: new THREE.Color().setHSL(hue, 0.4, 0.4),
      type: type
    });

    // Add windows to tall buildings
    if (h > 40) {
      for (let j = 0; j < 10; j++) {
        const wh = h * 0.8;
        const wy = h * 0.1 + (j / 10) * wh;
        windowsDataRef.current.push({
          pos: new THREE.Vector3(x, wy, z + d / 2 + 0.1),
          scale: new THREE.Vector3(w * 0.8, 0.5, 0.1)
        });
        windowsDataRef.current.push({
          pos: new THREE.Vector3(x, wy, z - d / 2 - 0.1),
          scale: new THREE.Vector3(w * 0.8, 0.5, 0.1)
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

    // Props (Benches)
    const benchGeom = new THREE.BoxGeometry(3, 0.5, 1);
    const benchMat = new THREE.MeshLambertMaterial({ color: 0x664422 });
    const propsMesh = new THREE.InstancedMesh(benchGeom, benchMat, propsDataRef.current.length);
    propsDataRef.current.forEach((data, i) => {
      matrix.makeRotationY(data.rotation);
      matrix.setPosition(data.pos);
      propsMesh.setMatrixAt(i, matrix);
    });
    scene.add(propsMesh);
    propsMeshRef.current = propsMesh;

    // Barriers
    const barrierGeom = new THREE.BoxGeometry(10, 2, 0.5);
    const barrierMat = new THREE.MeshLambertMaterial({ color: 0xffaa00 });
    const barriersMesh = new THREE.InstancedMesh(barrierGeom, barrierMat, barriersDataRef.current.length);
    barriersDataRef.current.forEach((data, i) => {
      matrix.makeRotationY(data.rotation);
      matrix.setPosition(data.pos);
      barriersMesh.setMatrixAt(i, matrix);
    });
    scene.add(barriersMesh);
    barriersMeshRef.current = barriersMesh;

    // Windows (Glow effect)
    const windowGeom = new THREE.BoxGeometry(1, 1, 1);
    const windowMat = new THREE.MeshBasicMaterial({ color: 0xffffaa });
    const windowsMesh = new THREE.InstancedMesh(windowGeom, windowMat, windowsDataRef.current.length);
    windowsDataRef.current.forEach((data, i) => {
      matrix.makeScale(data.scale.x, data.scale.y, data.scale.z);
      matrix.setPosition(data.pos);
      windowsMesh.setMatrixAt(i, matrix);
    });
    scene.add(windowsMesh);
    windowsMeshRef.current = windowsMesh;

    // Clouds
    const cloudGeom = new THREE.SphereGeometry(1, 16, 16);
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
    const cloudsMesh = new THREE.InstancedMesh(cloudGeom, cloudMat, cloudsDataRef.current.length);
    cloudsDataRef.current.forEach((data, i) => {
      matrix.makeScale(data.scale.x, data.scale.y, data.scale.z);
      matrix.setPosition(data.pos);
      cloudsMesh.setMatrixAt(i, matrix);
    });
    scene.add(cloudsMesh);
    cloudsMeshRef.current = cloudsMesh;
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

    // Update Zone
    const px = carRef.current.position.x;
    const pz = carRef.current.position.z;
    let zone = 'Downtown';
    if (px > 300 && pz > 300) zone = 'Residential';
    else if (px < -300 && pz < -300) zone = 'Industrial District';
    else if (Math.abs(px) > 800 || Math.abs(pz) > 800) zone = 'Outskirts';
    if (zone !== currentZone) setCurrentZone(zone);

    // Camera follow
    let targetCamPos = new THREE.Vector3();
    let lookAtPos = new THREE.Vector3();

    if (gameRunningRef.current.cameraMode === 'third') {
      const camDist = 20; // Fixed distance
      const camHeight = 8; // Fixed height
      targetCamPos.set(
        carRef.current.position.x - Math.sin(rotation) * camDist,
        carRef.current.position.y + camHeight,
        carRef.current.position.z - Math.cos(rotation) * camDist
      );
      lookAtPos.set(
        carRef.current.position.x + Math.sin(rotation) * 10,
        carRef.current.position.y + 1,
        carRef.current.position.z + Math.cos(rotation) * 10
      );
    } else if (gameRunningRef.current.cameraMode === 'first') {
      // Positioned inside the cabin
      targetCamPos.set(
        carRef.current.position.x + Math.sin(rotation) * 0.4,
        carRef.current.position.y + 1.3,
        carRef.current.position.z + Math.cos(rotation) * 0.4
      );
      lookAtPos.set(
        carRef.current.position.x + Math.sin(rotation) * 20,
        carRef.current.position.y + 1.2,
        carRef.current.position.z + Math.cos(rotation) * 20
      );
    } else { // Top Down
      targetCamPos.set(carRef.current.position.x, 60, carRef.current.position.z);
      lookAtPos.copy(carRef.current.position);
    }
    
    // Smoothly move camera
    const lerpFactor = gameRunningRef.current.cameraMode === 'first' ? 1.0 : 0.1; // Instant in first person
    cameraRef.current.position.lerp(targetCamPos, lerpFactor);
    
    // Dynamic FOV (Subtle)
    const targetFOV = gameRunningRef.current.cameraMode === 'first' ? 85 : 60 + Math.abs(speed) * 10;
    cameraRef.current.fov = THREE.MathUtils.lerp(cameraRef.current.fov, targetFOV, 0.1);
    cameraRef.current.updateProjectionMatrix();
    cameraRef.current.lookAt(lookAtPos);

    updateMiniMap();

    // Send data to peer
    if (connRef.current && connRef.current.open) {
      connRef.current.send({
        type: 'update',
        payload: {
          pos: carRef.current.position,
          rotation: rotation,
          speed: speed
        }
      });
    }
  }

  function updateMiniMap() {
    if (!mapCanvasRef.current || !carRef.current) return;
    const ctx = mapCanvasRef.current.getContext('2d');
    if (!ctx) return;

    const size = 150;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, size, size);

    const carX = carRef.current.position.x;
    const carZ = carRef.current.position.z;
    const scale = 0.1;

    // Draw Roads
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    for (let i = -10; i <= 10; i++) {
      const rx = (i * 200 - carX) * scale + size / 2;
      const rz = (i * 200 - carZ) * scale + size / 2;
      ctx.beginPath(); ctx.moveTo(rx, 0); ctx.lineTo(rx, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, rz); ctx.lineTo(size, rz); ctx.stroke();
    }

    // Draw Buildings
    buildingsDataRef.current.forEach(b => {
      const bx = (b.pos.x - carX) * scale + size / 2;
      const bz = (b.pos.z - carZ) * scale + size / 2;
      if (bx > 0 && bx < size && bz > 0 && bz < size) {
        ctx.fillStyle = b.type === 3 ? '#555' : '#888';
        ctx.fillRect(bx - 2, bz - 2, 4, 4);
      }
    });

    // Draw Car
    ctx.fillStyle = '#ff0000';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  function checkCollisions() {
    if (!carRef.current) return;
    const carPos = carRef.current.position;
    
    for (const data of buildingsDataRef.current) {
      // Ignore flat parking lots (type 3 or height < 1)
      if (data.type === 3 || data.scale.y < 1) continue;

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

  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    });
  }, []);

  const installApp = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

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

  const connectToPeer = () => {
    if (!peerRef.current || !gameState.multiplayer.targetPeerId) return;
    setGameState(prev => ({ ...prev, multiplayer: { ...prev.multiplayer, status: 'connecting' } }));
    const conn = peerRef.current.connect(gameState.multiplayer.targetPeerId);
    connRef.current = conn;
    conn.on('open', () => {
      setupConnection(conn);
      setGameState(prev => ({ 
        ...prev, 
        multiplayer: { ...prev.multiplayer, isConnected: true, isHost: false, status: 'connected' } 
      }));
    });
    conn.on('error', () => {
      setGameState(prev => ({ ...prev, multiplayer: { ...prev.multiplayer, status: 'error' } }));
    });
  };

  return (
    <div className="relative w-full h-full font-sans text-white overflow-hidden bg-black">
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {/* Landscape Warning */}
      <AnimatePresence>
        {gameState.isPortrait && isMobileRef.current && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[100] bg-black flex flex-col items-center justify-center p-10 text-center"
          >
            <Smartphone size={64} className="text-cyan-400 mb-6 animate-bounce" />
            <h2 className="text-3xl font-black mb-4">LANDSCAPE MODE REQUIRED</h2>
            <p className="text-white/60">Please rotate your device for the best driving experience.</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HUD */}
      <div className="absolute top-0 left-0 w-full p-6 flex justify-between items-start z-10 pointer-events-none">
        <div className="flex flex-col gap-4">
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

          {/* Camera Toggle */}
          <div className="bg-black/60 backdrop-blur-xl p-2 rounded-2xl border border-white/10 flex gap-2 pointer-events-auto">
            {(['third', 'first', 'top'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => {
                  gameRunningRef.current.cameraMode = mode;
                  setGameState(prev => ({ ...prev, cameraMode: mode }));
                }}
                className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${
                  gameState.cameraMode === mode ? 'bg-cyan-400 text-black' : 'text-white/40 hover:text-white'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          {/* Zone Indicator */}
          <div className="bg-black/60 backdrop-blur-xl px-6 py-3 rounded-2xl border border-white/10 shadow-2xl">
            <p className="text-[8px] uppercase tracking-[0.3em] text-white/40 font-bold mb-1">Current Location</p>
            <p className="text-sm font-black tracking-widest text-cyan-400 uppercase">{currentZone}</p>
          </div>
        </div>
        
        <div className="flex flex-col items-end gap-4">
          <div className="bg-black/60 backdrop-blur-xl p-6 rounded-3xl border border-white/10 text-right shadow-2xl">
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold mb-1 flex items-center justify-end gap-2">
              <Trophy size={12} className="text-yellow-400" /> Record
            </p>
            <p className="text-2xl font-black tabular-nums tracking-tighter">{gameState.highScore}</p>
          </div>

          {/* Mini Map */}
          <div className="bg-black/60 backdrop-blur-xl p-2 rounded-2xl border border-white/10 overflow-hidden shadow-2xl">
            <canvas ref={mapCanvasRef} width={150} height={150} className="rounded-xl opacity-80" />
            <p className="text-[8px] uppercase tracking-[0.3em] text-center mt-2 text-white/40 font-bold">Navigation System</p>
          </div>
        </div>
      </div>

      {/* Mobile Controls */}
      {gameState.isStarted && !gameState.isGameOver && (
        <div className="absolute inset-0 pointer-events-none z-20 flex flex-col justify-end p-10">
          <div className="flex justify-between items-end w-full max-w-5xl mx-auto">
            {/* Steering */}
            <div className="flex gap-6 pointer-events-auto">
              <button
                onTouchStart={() => (keysRef.current['ArrowLeft'] = true)}
                onTouchEnd={() => (keysRef.current['ArrowLeft'] = false)}
                className="w-24 h-24 bg-black/40 backdrop-blur-xl rounded-full border-2 border-white/20 flex items-center justify-center active:bg-cyan-500 active:scale-95 transition-all shadow-2xl"
              >
                <ArrowLeft size={40} className="text-white" />
              </button>
              <button
                onTouchStart={() => (keysRef.current['ArrowRight'] = true)}
                onTouchEnd={() => (keysRef.current['ArrowRight'] = false)}
                className="w-24 h-24 bg-black/40 backdrop-blur-xl rounded-full border-2 border-white/20 flex items-center justify-center active:bg-cyan-500 active:scale-95 transition-all shadow-2xl"
              >
                <ArrowRight size={40} className="text-white" />
              </button>
            </div>

            {/* Pedals */}
            <div className="flex gap-8 pointer-events-auto items-end">
              <button
                onTouchStart={() => (keysRef.current['ArrowDown'] = true)}
                onTouchEnd={() => (keysRef.current['ArrowDown'] = false)}
                className="w-24 h-24 bg-red-600/40 backdrop-blur-xl rounded-2xl border-2 border-red-500/30 flex flex-col items-center justify-center active:bg-red-600 active:scale-95 transition-all shadow-2xl"
              >
                <ArrowDown size={32} />
                <span className="text-[10px] font-black mt-1">BRAKE</span>
              </button>
              <button
                onTouchStart={() => (keysRef.current['ArrowUp'] = true)}
                onTouchEnd={() => (keysRef.current['ArrowUp'] = false)}
                className="w-28 h-44 bg-cyan-600/40 backdrop-blur-xl rounded-3xl border-2 border-cyan-500/30 flex flex-col items-center justify-center active:bg-cyan-500 active:scale-95 transition-all shadow-2xl"
              >
                <ArrowUp size={48} />
                <span className="text-xs font-black mt-2">GAS</span>
              </button>
            </div>
          </div>
        </div>
      )}

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
              className="text-center flex flex-col items-center"
            >
              <img 
                src="https://ciuufyblgorvzqtdzevx.supabase.co/storage/v1/object/public/images/0.008808135582519805-IMG_20260209_170808.jpg" 
                alt="Urban Drive Logo" 
                className="w-32 h-32 rounded-3xl mb-6 shadow-2xl border-2 border-white/20 object-cover"
                referrerPolicy="no-referrer"
              />
              <h1 className="text-8xl font-black italic tracking-tighter mb-2 text-transparent bg-clip-text bg-gradient-to-b from-white to-white/20">
                URBAN DRIVE
              </h1>
              <p className="text-cyan-400 tracking-[0.5em] uppercase text-xs font-bold mb-8">Realistic City Simulator</p>
              
              <div className="flex flex-col items-center gap-6 mb-12">
                <button
                  onClick={startGame}
                  className="group relative px-16 py-6 bg-white text-black rounded-full font-black text-2xl transition-all hover:scale-105 active:scale-95 shadow-[0_0_50px_rgba(255,255,255,0.3)]"
                >
                  <div className="flex items-center gap-4">
                    <Play fill="currentColor" size={24} />
                    IGNITION
                  </div>
                  <div className="absolute -inset-2 bg-white/20 blur-2xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>

                {/* Multiplayer Controls */}
                <div className="bg-black/40 backdrop-blur-xl p-6 rounded-[2rem] border border-white/10 w-full max-w-md">
                  <div className="flex items-center gap-3 mb-4 text-cyan-400">
                    <Users size={20} />
                    <span className="text-xs font-black uppercase tracking-widest">Multiplayer Lobby</span>
                  </div>
                  
                  {gameState.multiplayer.peerId ? (
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5">
                        <div className="text-left">
                          <p className="text-[8px] uppercase text-white/40 font-bold mb-1">Your Room Code</p>
                          <p className="text-sm font-mono font-bold text-white tracking-wider">{gameState.multiplayer.peerId}</p>
                        </div>
                        <button 
                          onClick={() => {
                            navigator.clipboard.writeText(gameState.multiplayer.peerId);
                          }}
                          className="p-2 hover:bg-white/10 rounded-lg transition-colors text-cyan-400"
                        >
                          <Copy size={16} />
                        </button>
                      </div>

                      <div className="h-px bg-white/10" />

                      <div className="flex gap-2">
                        <input 
                          type="text"
                          placeholder="Enter Friend's Code"
                          value={gameState.multiplayer.targetPeerId}
                          onChange={(e) => setGameState(prev => ({ ...prev, multiplayer: { ...prev.multiplayer, targetPeerId: e.target.value } }))}
                          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm font-bold focus:outline-none focus:border-cyan-400 transition-colors"
                        />
                        <button
                          onClick={connectToPeer}
                          disabled={gameState.multiplayer.status === 'connecting' || gameState.multiplayer.isConnected}
                          className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                            gameState.multiplayer.isConnected 
                              ? 'bg-green-500 text-white' 
                              : 'bg-cyan-400 text-black hover:scale-105 active:scale-95'
                          }`}
                        >
                          {gameState.multiplayer.status === 'connecting' ? '...' : gameState.multiplayer.isConnected ? 'Connected' : 'Join'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-white/40 font-bold italic">Initializing P2P Network...</p>
                  )}
                </div>
              </div>

              {deferredPrompt && (
                <button
                  onClick={installApp}
                  className="mb-8 px-8 py-3 bg-cyan-400/20 border border-cyan-400/40 text-cyan-400 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] hover:bg-cyan-400 hover:text-black transition-all pointer-events-auto"
                >
                  Install Urban Drive App
                </button>
              )}

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
