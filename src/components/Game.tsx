import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Play, RotateCcw, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Gauge, Users, Copy, Check, Smartphone } from 'lucide-react';
import Peer, { DataConnection } from 'peerjs';

// --- Constants ---
const CAR_ACCELERATION = 0.6;
const CAR_BRAKE = 1.2;
const CAR_FRICTION = 0.992;
const CAR_STEER_SPEED = 0.04;
const CAR_MAX_SPEED = 1.8;

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
  isMapFullscreen: boolean;
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
    isMapFullscreen: false,
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
  const raycasterRef = useRef(new THREE.Raycaster());
  const groundObjectsRef = useRef<THREE.Object3D[]>([]);
  const buildingsDataRef = useRef<{ pos: THREE.Vector3, scale: THREE.Vector3, color: THREE.Color, type: number }[]>([]);
  const treesDataRef = useRef<{ pos: THREE.Vector3, scale: number }[]>([]);
  const buildingsMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const treesMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const propsMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const trunkMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const barriersMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const windowsMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const cloudsMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const trafficLightsMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const busesRef = useRef<THREE.Group[]>([]);
  const propsDataRef = useRef<{ pos: THREE.Vector3, rotation: number }[]>([]);
  const barriersDataRef = useRef<{ pos: THREE.Vector3, rotation: number }[]>([]);
  const windowsDataRef = useRef<{ pos: THREE.Vector3, scale: THREE.Vector3 }[]>([]);
  const cloudsDataRef = useRef<{ pos: THREE.Vector3, scale: THREE.Vector3 }[]>([]);
  const trafficLightsDataRef = useRef<{ pos: THREE.Vector3, rotation: number }[]>([]);
  const remotePlayersRef = useRef<{ [id: string]: { mesh: THREE.Group, targetPos: THREE.Vector3, targetRot: number, lastUpdate: number } }>({});
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

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
    sunLight.position.set(100, 300, 100);
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

    // --- Terrain ---
    const terrainGeom = new THREE.PlaneGeometry(5000, 5000, 128, 128);
    const posAttr = terrainGeom.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      
      let h = 0;
      const dist = Math.sqrt(x * x + y * y);
      
      // River Bed (South-East)
      const riverX = 1500;
      if (Math.abs(x - riverX) < 100) {
        h = -15 + Math.cos((x - riverX) * 0.03) * 5;
      } else {
        // Hills outside city
        if (dist > 800) {
          h = Math.sin(x * 0.01) * Math.cos(y * 0.01) * 60 * ((dist - 800) / 1000);
        }
        
        // Mountain (North-West)
        if (x < -1200 && y < -1200) {
          const mDist = Math.sqrt((x + 2000) ** 2 + (y + 2000) ** 2);
          if (mDist < 800) {
            h += (800 - mDist) * 0.5;
          }
        }
      }
      
      posAttr.setZ(i, h);
    }
    terrainGeom.computeVertexNormals();
    const terrainMat = new THREE.MeshLambertMaterial({ color: 0x3d7a37 });
    const terrain = new THREE.Mesh(terrainGeom, terrainMat);
    terrain.rotation.x = -Math.PI / 2;
    scene.add(terrain);
    groundObjectsRef.current.push(terrain);

    // --- Water (River) ---
    const waterGeom = new THREE.PlaneGeometry(200, 5000);
    const waterMat = new THREE.MeshLambertMaterial({ color: 0x0077be, transparent: true, opacity: 0.6 });
    const water = new THREE.Mesh(waterGeom, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(1500, -5, 0);
    scene.add(water);

    // --- Bridge ---
    const bridgeGroup = new THREE.Group();
    const bridgeDeck = new THREE.Mesh(new THREE.BoxGeometry(200, 2, 40), new THREE.MeshLambertMaterial({ color: 0x555555 }));
    bridgeDeck.position.set(1500, 2, 0);
    bridgeGroup.add(bridgeDeck);
    groundObjectsRef.current.push(bridgeDeck);
    
    // Bridge Pillars
    const pillarGeom = new THREE.CylinderGeometry(2, 2, 20);
    const pillarMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    for (let i = 0; i < 2; i++) {
      const p = new THREE.Mesh(pillarGeom, pillarMat);
      p.position.set(1420 + i * 160, -8, 0);
      bridgeGroup.add(p);
    }
    scene.add(bridgeGroup);

    // --- Underground Tunnel ---
    const tunnelGroup = new THREE.Group();
    const tunnelCeiling = new THREE.Mesh(new THREE.BoxGeometry(40, 2, 200), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    tunnelCeiling.position.set(-1500, 10, -1500);
    tunnelGroup.add(tunnelCeiling);
    
    const tunnelWallL = new THREE.Mesh(new THREE.BoxGeometry(2, 10, 200), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    tunnelWallL.position.set(-1520, 5, -1500);
    tunnelGroup.add(tunnelWallL);
    
    const tunnelWallR = new THREE.Mesh(new THREE.BoxGeometry(2, 10, 200), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    tunnelWallR.position.set(-1480, 5, -1500);
    tunnelGroup.add(tunnelWallR);
    scene.add(tunnelGroup);

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
    let remoteData = remotePlayersRef.current[id];
    if (!remoteData) {
      const mesh = createCar();
      const body = mesh.children[0].children[0] as THREE.Mesh;
      (body.material as THREE.MeshStandardMaterial).color.setHex(0x00aaff);
      sceneRef.current.add(mesh);
      remoteData = {
        mesh,
        targetPos: new THREE.Vector3().copy(payload.pos),
        targetRot: payload.rotation,
        lastUpdate: Date.now()
      };
      remotePlayersRef.current[id] = remoteData;
    } else {
      remoteData.targetPos.copy(payload.pos);
      remoteData.targetRot = payload.rotation;
      remoteData.lastUpdate = Date.now();
    }
  }

  function removeRemotePlayer(id: string) {
    const remoteData = remotePlayersRef.current[id];
    if (remoteData && sceneRef.current) {
      sceneRef.current.remove(remoteData.mesh);
      delete remotePlayersRef.current[id];
    }
  }

  function createRoads(scene: THREE.Scene) {
    const roadMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    
    // Main Roads (Grid)
    for (let i = -10; i <= 10; i++) {
      // Horizontal
      if (i === 0) {
        // Elevate the road crossing the river
        const hRoad1 = new THREE.Mesh(new THREE.PlaneGeometry(1400, 20), roadMat);
        hRoad1.rotation.x = -Math.PI / 2;
        hRoad1.position.set(-700, 0.02, 0);
        scene.add(hRoad1);
        
        const hRoad2 = new THREE.Mesh(new THREE.PlaneGeometry(2400, 20), roadMat);
        hRoad2.rotation.x = -Math.PI / 2;
        hRoad2.position.set(2800, 0.02, 0);
        scene.add(hRoad2);
        
        // Road on bridge
        const bridgeRoad = new THREE.Mesh(new THREE.PlaneGeometry(200, 20), roadMat);
        bridgeRoad.rotation.x = -Math.PI / 2;
        bridgeRoad.position.set(1500, 3.1, 0); // Slightly above bridge deck
        scene.add(bridgeRoad);
      } else {
        const hRoad = new THREE.Mesh(new THREE.PlaneGeometry(4000, 20), roadMat);
        hRoad.rotation.x = -Math.PI / 2;
        hRoad.position.set(0, 0.02, i * 200);
        scene.add(hRoad);
        groundObjectsRef.current.push(hRoad);
      }
      
      // Vertical
      const vRoad = new THREE.Mesh(new THREE.PlaneGeometry(20, 4000), roadMat);
      vRoad.rotation.x = -Math.PI / 2;
      vRoad.position.set(i * 200, 0.02, 0);
      scene.add(vRoad);
      groundObjectsRef.current.push(vRoad);

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

    // Mountain Road
    const mountainRoad = new THREE.Mesh(new THREE.BoxGeometry(20, 2, 1000), roadMat);
    mountainRoad.position.set(-1800, 300, -1800);
    mountainRoad.rotation.y = Math.PI / 4;
    scene.add(mountainRoad);
    groundObjectsRef.current.push(mountainRoad);
    
    // Ramp to mountain road (simplified)
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(20, 2, 800), roadMat);
    ramp.position.set(-1400, 150, -1400);
    ramp.rotation.y = Math.PI / 4;
    ramp.rotation.x = Math.PI / 10;
    scene.add(ramp);
    groundObjectsRef.current.push(ramp);
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
    
    // Downtown (Skyscrapers & Offices)
    for (let i = 0; i < 80; i++) {
      const h = 80 + Math.random() * 150;
      const w = 25 + Math.random() * 15;
      const d = 25 + Math.random() * 15;
      const x = (Math.random() - 0.5) * 500;
      const z = (Math.random() - 0.5) * 500;
      addBuilding(x, z, w, h, d, 0.5 + Math.random() * 0.1, 0); 
    }

    // Government Offices (Large, formal)
    for (let i = 0; i < 15; i++) {
      const x = (Math.random() - 0.5) * 400;
      const z = (Math.random() - 0.5) * 400;
      addBuilding(x, z, 60, 40, 60, 0, 7); // Grey/Formal
    }

    // Residential (Houses)
    for (let i = 0; i < 300; i++) {
      const h = 8 + Math.random() * 12;
      const w = 12 + Math.random() * 8;
      const d = 12 + Math.random() * 8;
      const x = 600 + (Math.random() - 0.5) * 1000;
      const z = 600 + (Math.random() - 0.5) * 1000;
      addBuilding(x, z, w, h, d, 0.05 + Math.random() * 0.05, 1); 
    }

    // Commercial (Shops, Malls, Restaurants)
    for (let i = 0; i < 100; i++) {
      const h = 10 + Math.random() * 20;
      const w = 20 + Math.random() * 30;
      const d = 20 + Math.random() * 30;
      const x = -700 + (Math.random() - 0.5) * 800;
      const z = 400 + (Math.random() - 0.5) * 800;
      addBuilding(x, z, w, h, d, 0.15 + Math.random() * 0.1, 4); 
    }

    // Healthcare (Hospitals & Clinics)
    for (let i = 0; i < 10; i++) {
      const x = -800 + (Math.random() - 0.5) * 600;
      const z = -800 + (Math.random() - 0.5) * 600;
      const isClinic = Math.random() > 0.7;
      addBuilding(x, z, isClinic ? 40 : 100, isClinic ? 15 : 40, isClinic ? 40 : 80, 0, 5); 
    }

    // Education (Schools & Universities)
    for (let i = 0; i < 15; i++) {
      const x = 800 + (Math.random() - 0.5) * 600;
      const z = -800 + (Math.random() - 0.5) * 600;
      const isSchool = Math.random() > 0.5;
      addBuilding(x, z, isSchool ? 60 : 120, isSchool ? 15 : 30, isSchool ? 60 : 120, 0.6, 6); 
    }

    // Parking Lots
    for (let i = 0; i < 20; i++) {
      const x = (Math.random() - 0.5) * 2500;
      const z = (Math.random() - 0.5) * 2500;
      addBuilding(x, z, 80, 0.5, 100, 0, 3);
      
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

    // Traffic Lights at Intersections
    for (let i = -5; i <= 5; i++) {
      for (let j = -5; j <= 5; j++) {
        const tx = i * 200;
        const tz = j * 200;
        trafficLightsDataRef.current.push({ pos: new THREE.Vector3(tx + 12, 0, tz + 12), rotation: 0 });
        trafficLightsDataRef.current.push({ pos: new THREE.Vector3(tx - 12, 0, tz - 12), rotation: Math.PI });
      }
    }
  }

  function addBuilding(x: number, z: number, w: number, h: number, d: number, hue: number, type: number) {
    const gridX = Math.round(x / 200) * 200;
    const gridZ = Math.round(z / 200) * 200;
    if (Math.abs(x - gridX) < 30) x += 60 * (x > gridX ? 1 : -1);
    if (Math.abs(z - gridZ) < 30) z += 60 * (z > gridZ ? 1 : -1);
    
    let color = new THREE.Color().setHSL(hue, 0.4, 0.4);
    if (type === 5) color.setHex(0xffffff); // Hospital/Clinic
    if (type === 6) color.setHex(0xccaa88); // Education
    if (type === 4) color.setHex(0xffaa44); // Commercial
    if (type === 7) color.setHex(0x888899); // Government

    buildingsDataRef.current.push({
      pos: new THREE.Vector3(x, h / 2, z),
      scale: new THREE.Vector3(w, h, d),
      color: color,
      type: type
    });

    // Add windows to tall buildings
    if (h > 20) {
      const rows = Math.floor(h / 4);
      const cols = Math.floor(w / 4);
      for (let r = 0; r < rows; r++) {
        const wy = 2 + r * 4;
        windowsDataRef.current.push({
          pos: new THREE.Vector3(x, wy, z + d / 2 + 0.1),
          scale: new THREE.Vector3(w * 0.7, 1.5, 0.1)
        });
        windowsDataRef.current.push({
          pos: new THREE.Vector3(x, wy, z - d / 2 - 0.1),
          scale: new THREE.Vector3(w * 0.7, 1.5, 0.1)
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

    // Traffic Lights
    const poleGeom = new THREE.CylinderGeometry(0.3, 0.3, 10);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const trafficLightsMesh = new THREE.InstancedMesh(poleGeom, poleMat, trafficLightsDataRef.current.length * 2);
    
    const lightBoxGeom = new THREE.BoxGeometry(1, 3, 1);
    const lightBoxMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
    const lightBoxesMesh = new THREE.InstancedMesh(lightBoxGeom, lightBoxMat, trafficLightsDataRef.current.length);
    
    const redLightGeom = new THREE.SphereGeometry(0.3, 8, 8);
    const redLightMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const redLightsMesh = new THREE.InstancedMesh(redLightGeom, redLightMat, trafficLightsDataRef.current.length);

    const greenLightGeom = new THREE.SphereGeometry(0.3, 8, 8);
    const greenLightMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const greenLightsMesh = new THREE.InstancedMesh(greenLightGeom, greenLightMat, trafficLightsDataRef.current.length);

    trafficLightsDataRef.current.forEach((data, i) => {
      // Pole
      matrix.makeRotationY(data.rotation);
      matrix.setPosition(data.pos.x, 5, data.pos.z);
      trafficLightsMesh.setMatrixAt(i, matrix);

      // Light Box
      matrix.makeRotationY(data.rotation);
      matrix.setPosition(data.pos.x, 8, data.pos.z);
      lightBoxesMesh.setMatrixAt(i, matrix);

      // Red Light
      matrix.makeRotationY(data.rotation);
      matrix.setPosition(data.pos.x, 9, data.pos.z + 0.5);
      redLightsMesh.setMatrixAt(i, matrix);

      // Green Light
      matrix.makeRotationY(data.rotation);
      matrix.setPosition(data.pos.x, 7, data.pos.z + 0.5);
      greenLightsMesh.setMatrixAt(i, matrix);
    });
    scene.add(trafficLightsMesh);
    scene.add(lightBoxesMesh);
    scene.add(redLightsMesh);
    scene.add(greenLightsMesh);
    trafficLightsMeshRef.current = trafficLightsMesh;

    // Add some Buses (Public Transport)
    for (let i = 0; i < 15; i++) {
      const bus = new THREE.Group();
      const busBody = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 12), new THREE.MeshLambertMaterial({ color: 0xffcc00 }));
      busBody.position.y = 2.5;
      bus.add(busBody);
      // Windows for bus
      const busWin = new THREE.Mesh(new THREE.BoxGeometry(4.1, 1.5, 10), new THREE.MeshLambertMaterial({ color: 0x333333 }));
      busWin.position.y = 3;
      bus.add(busWin);
      
      bus.position.set((Math.random() - 0.5) * 2000, 0, (Math.random() - 0.5) * 2000);
      bus.userData = { 
        speed: 0.2 + Math.random() * 0.3, 
        dir: Math.random() > 0.5 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1) 
      };
      scene.add(bus);
      busesRef.current.push(bus);
    }
  }

  function updateCar(delta: number) {
    if (!carRef.current || !cameraRef.current) return;

    const keys = keysRef.current;
    let { speed, rotation } = gameRunningRef.current;

    // Acceleration & Braking
    let acceleration = 0;
    if (keys['ArrowUp'] || keys['KeyW']) {
      acceleration += CAR_ACCELERATION;
    }
    if (keys['ArrowDown'] || keys['KeyS']) {
      // If moving forward, brake harder. If stopped or reversing, accelerate backward.
      if (speed > 0.05) {
        acceleration -= CAR_BRAKE * 2;
      } else {
        acceleration -= CAR_ACCELERATION;
      }
    }

    if (acceleration !== 0) {
      speed += acceleration * delta;
    } else {
      // Frame-rate independent friction for smoother coasting
      speed *= Math.pow(CAR_FRICTION, delta * 60);
      if (Math.abs(speed) < 0.005) speed = 0;
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

    // Terrain Following (Height)
    raycasterRef.current.set(
      new THREE.Vector3(carRef.current.position.x, 1000, carRef.current.position.z),
      new THREE.Vector3(0, -1, 0)
    );
    const intersects = raycasterRef.current.intersectObjects(groundObjectsRef.current);
    if (intersects.length > 0) {
      const targetY = intersects[0].point.y;
      carRef.current.position.y = THREE.MathUtils.lerp(carRef.current.position.y, targetY, 0.2);
    }

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
    if (px > 400 && pz > 400) zone = 'Residential Area';
    else if (px < -400 && pz > 200) zone = 'Commercial District';
    else if (px < -400 && pz < -400) zone = 'Industrial District';
    else if (px > 400 && pz < -400) zone = 'University Campus';
    else if (Math.abs(px) > 1200 || Math.abs(pz) > 1200) zone = 'Outskirts';
    if (zone !== currentZone) setCurrentZone(zone);

    // Interpolate Remote Players
    Object.values(remotePlayersRef.current).forEach((remote: any) => {
      remote.mesh.position.lerp(remote.targetPos, 0.15);
      remote.mesh.rotation.y = THREE.MathUtils.lerp(remote.mesh.rotation.y, remote.targetRot, 0.15);
    });

    // Move Buses
    busesRef.current.forEach(bus => {
      bus.position.addScaledVector(bus.userData.dir, bus.userData.speed);
      if (Math.abs(bus.position.x) > 2500 || Math.abs(bus.position.z) > 2500) {
        bus.position.set((Math.random() - 0.5) * 2000, 0, (Math.random() - 0.5) * 2000);
      }
    });

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

    const size = gameState.isMapFullscreen ? 600 : 150;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, size, size);

    const carX = carRef.current.position.x;
    const carZ = carRef.current.position.z;
    const scale = gameState.isMapFullscreen ? 0.05 : 0.1; // More zoom out in fullscreen

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

    // Draw Remote Players
    Object.values(remotePlayersRef.current).forEach((remote: any) => {
      const rx = (remote.mesh.position.x - carX) * scale + size / 2;
      const rz = (remote.mesh.position.z - carZ) * scale + size / 2;
      if (rx > 0 && rx < size && rz > 0 && rz < size) {
        ctx.fillStyle = '#00aaff';
        ctx.beginPath();
        ctx.arc(rx, rz, 3, 0, Math.PI * 2);
        ctx.fill();
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
        // Bounce back instead of game over
        gameRunningRef.current.speed *= -0.5;
        // Push out slightly
        const pushX = (carPos.x - data.pos.x) > 0 ? 1 : -1;
        const pushZ = (carPos.z - data.pos.z) > 0 ? 1 : -1;
        carRef.current.position.x += pushX * 0.5;
        carRef.current.position.z += pushZ * 0.5;
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
      <div className="absolute top-0 left-0 w-full p-4 md:p-6 flex justify-between items-start z-10 pointer-events-none">
        <div className="flex flex-col gap-3 md:gap-4">
          <div className="bg-black/60 backdrop-blur-xl p-4 md:p-6 rounded-3xl border border-white/10 flex items-center gap-4 shadow-2xl">
            <div className="p-2 md:p-3 bg-white/10 rounded-2xl">
              <Gauge className="text-cyan-400" size={20} />
            </div>
            <div>
              <p className="text-[8px] md:text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold mb-1">Velocity</p>
              <div className="flex items-baseline gap-1">
                <p className="text-2xl md:text-4xl font-black tabular-nums tracking-tighter">{gameState.speed}</p>
                <p className="text-[10px] font-bold text-cyan-400">KM/H</p>
              </div>
            </div>
          </div>

          {/* Camera Toggle */}
          <div className="bg-black/60 backdrop-blur-xl p-1.5 rounded-2xl border border-white/10 flex gap-1.5 pointer-events-auto">
            {(['third', 'first', 'top'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => {
                  gameRunningRef.current.cameraMode = mode;
                  setGameState(prev => ({ ...prev, cameraMode: mode }));
                }}
                className={`px-3 md:px-4 py-1.5 md:py-2 rounded-xl text-[8px] md:text-[10px] font-bold uppercase tracking-widest transition-all ${
                  gameState.cameraMode === mode ? 'bg-cyan-400 text-black' : 'text-white/40 hover:text-white'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          {/* Zone Indicator */}
          <div className="bg-black/60 backdrop-blur-xl px-4 md:px-6 py-2 md:py-3 rounded-2xl border border-white/10 shadow-2xl">
            <p className="text-[7px] md:text-[8px] uppercase tracking-[0.3em] text-white/40 font-bold mb-1">Current Location</p>
            <p className="text-xs md:text-sm font-black tracking-widest text-cyan-400 uppercase">{currentZone}</p>
          </div>
        </div>
        
        <div className="flex flex-col items-end gap-3 md:gap-4">
          {/* Mini Map - Top Right for Mobile */}
          <div 
            className={`bg-black/60 backdrop-blur-xl p-1.5 rounded-2xl border border-white/10 overflow-hidden shadow-2xl pointer-events-auto transition-all duration-500 ${
              gameState.isMapFullscreen ? 'fixed inset-4 md:inset-20 z-[60] flex flex-col items-center justify-center' : ''
            }`}
          >
            <div className={`relative ${gameState.isMapFullscreen ? 'w-full h-full flex flex-col items-center justify-center' : ''}`}>
              <canvas 
                ref={mapCanvasRef} 
                width={gameState.isMapFullscreen ? 600 : 120} 
                height={gameState.isMapFullscreen ? 600 : 120} 
                className={`rounded-xl opacity-80 transition-all ${
                  gameState.isMapFullscreen ? 'w-auto h-[80vh] aspect-square' : 'md:w-[150px] md:h-[150px]'
                }`} 
              />
              <button
                onClick={() => setGameState(prev => ({ ...prev, isMapFullscreen: !prev.isMapFullscreen }))}
                className="absolute top-2 right-2 p-2 bg-black/40 hover:bg-cyan-400 hover:text-black rounded-lg transition-all"
              >
                {gameState.isMapFullscreen ? <RotateCcw size={16} /> : <Smartphone size={16} />}
              </button>
            </div>
            <p className="text-[7px] md:text-[8px] uppercase tracking-[0.3em] text-center mt-1.5 text-white/40 font-bold">
              {gameState.isMapFullscreen ? 'Full Navigation View' : 'Navigation'}
            </p>
          </div>

          <div className="bg-black/60 backdrop-blur-xl p-4 md:p-6 rounded-3xl border border-white/10 text-right shadow-2xl">
            <p className="text-[8px] md:text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold mb-1 flex items-center justify-end gap-2">
              <Trophy size={10} className="text-yellow-400" /> Record
            </p>
            <p className="text-xl md:text-2xl font-black tabular-nums tracking-tighter">{gameState.highScore}</p>
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
                onTouchStart={(e) => { e.preventDefault(); keysRef.current['ArrowLeft'] = true; }}
                onTouchEnd={(e) => { e.preventDefault(); keysRef.current['ArrowLeft'] = false; }}
                onPointerLeave={() => (keysRef.current['ArrowLeft'] = false)}
                className="w-24 h-24 bg-black/40 backdrop-blur-xl rounded-full border-2 border-white/20 flex items-center justify-center active:bg-cyan-500 active:scale-95 transition-all shadow-2xl touch-none"
              >
                <ArrowLeft size={40} className="text-white" />
              </button>
              <button
                onTouchStart={(e) => { e.preventDefault(); keysRef.current['ArrowRight'] = true; }}
                onTouchEnd={(e) => { e.preventDefault(); keysRef.current['ArrowRight'] = false; }}
                onPointerLeave={() => (keysRef.current['ArrowRight'] = false)}
                className="w-24 h-24 bg-black/40 backdrop-blur-xl rounded-full border-2 border-white/20 flex items-center justify-center active:bg-cyan-500 active:scale-95 transition-all shadow-2xl touch-none"
              >
                <ArrowRight size={40} className="text-white" />
              </button>
            </div>

            {/* Pedals */}
            <div className="flex gap-8 pointer-events-auto items-end">
              <button
                onTouchStart={(e) => { e.preventDefault(); keysRef.current['ArrowDown'] = true; }}
                onTouchEnd={(e) => { e.preventDefault(); keysRef.current['ArrowDown'] = false; }}
                onPointerLeave={() => (keysRef.current['ArrowDown'] = false)}
                className="w-24 h-24 bg-red-600/40 backdrop-blur-xl rounded-2xl border-2 border-red-500/30 flex flex-col items-center justify-center active:bg-red-600 active:scale-95 transition-all shadow-2xl touch-none"
              >
                <ArrowDown size={32} />
                <span className="text-[10px] font-black mt-1">BRAKE</span>
              </button>
              <button
                onTouchStart={(e) => { e.preventDefault(); keysRef.current['ArrowUp'] = true; }}
                onTouchEnd={(e) => { e.preventDefault(); keysRef.current['ArrowUp'] = false; }}
                onPointerLeave={() => (keysRef.current['ArrowUp'] = false)}
                className="w-28 h-44 bg-cyan-600/40 backdrop-blur-xl rounded-3xl border-2 border-cyan-500/30 flex flex-col items-center justify-center active:bg-cyan-500 active:scale-95 transition-all shadow-2xl touch-none"
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
