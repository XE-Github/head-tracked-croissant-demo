import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { shortestAngleDelta } from './gestureMath.js';
import { applyWorldRotationDeltas, composeObjectQuaternion } from './objectOrientation.js';

const hostRoot = document.getElementById('project-root');
if (!hostRoot) {
  throw new Error('3D 项目挂载节点 #project-root 不存在。');
}
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.domElement.style.display = 'block';
renderer.domElement.style.width = '100%';
renderer.domElement.style.height = '100%';
hostRoot.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.environment = buildEnvironmentTexture();
scene.fog = new THREE.Fog(0x05070d, 9.5, 18.5);

const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
const baseCameraPosition = new THREE.Vector3(0, 0, 8.15);
const baseCameraTarget = new THREE.Vector3(0, 0, 0);
const baseCameraUp = new THREE.Vector3(0, 1, 0);

const keyLight = new THREE.DirectionalLight(0xffefde, 1.35);
keyLight.position.set(5.8, 7.5, 6);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 24;
keyLight.shadow.camera.left = -4;
keyLight.shadow.camera.right = 4;
keyLight.shadow.camera.top = 4;
keyLight.shadow.camera.bottom = -4;
scene.add(keyLight);

const fillLight = new THREE.HemisphereLight(0xd8efff, 0x362618, 0.5);
scene.add(fillLight);

const rimLight = new THREE.PointLight(0xffa75d, 6, 14, 2);
rimLight.position.set(-2.8, 1.8, -3.5);
scene.add(rimLight);

const ROOM_GRID_SIZE = 10;
const ROOM_BASE = {
  width: 5.8,
  height: 3.6,
  depth: 7.8,
};

const roomRig = new THREE.Group();
roomRig.position.set(0, 0.02, -0.85);
scene.add(roomRig);

const roomFloor = createRoomGrid(0x7cbcff, 0x20364f, 0.22);
const roomCeiling = createRoomGrid(0x7cbcff, 0x162538, 0.1);
const roomLeftWall = createRoomGrid(0x7cbcff, 0x20364f, 0.16);
const roomRightWall = createRoomGrid(0x7cbcff, 0x20364f, 0.16);
const roomBackWall = createRoomGrid(0xa7d4ff, 0x223952, 0.18);
const roomFrame = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
  new THREE.LineBasicMaterial({
    color: 0x93c5ff,
    transparent: true,
    opacity: 0.18,
  })
);

roomLeftWall.rotation.z = Math.PI / 2;
roomRightWall.rotation.z = Math.PI / 2;
roomBackWall.rotation.x = -Math.PI / 2;

roomRig.add(roomFloor, roomCeiling, roomLeftWall, roomRightWall, roomBackWall, roomFrame);

const baseCubeScale = 0.52;
const baseCubeRotation = new THREE.Euler(0.38, -0.62, 0.06);
const baseCubeQuaternion = new THREE.Quaternion().setFromEuler(baseCubeRotation);

const focalRig = new THREE.Group();
focalRig.position.y = 0.02;
scene.add(focalRig);

const cubeGroup = new THREE.Group();
cubeGroup.quaternion.copy(baseCubeQuaternion);
cubeGroup.scale.setScalar(baseCubeScale);
focalRig.add(cubeGroup);

const CUBIE_SIZE = 0.62;
const GAP = 0.03;
const STEP = CUBIE_SIZE + GAP;
const STICKER_INSET = CUBIE_SIZE * 0.82;
const STICKER_OFFSET = CUBIE_SIZE / 2 + 0.002;
const FACE_COLORS = {
  right: '#d22c2c',
  left: '#ef8b1e',
  top: '#f1f1ea',
  bottom: '#f1d649',
  front: '#2378d1',
  back: '#2f9f50',
};
const FACE_DEFS = [
  { name: 'right', axis: new THREE.Vector3(1, 0, 0), rotation: new THREE.Euler(0, Math.PI / 2, 0), test: (x) => x === 1 },
  { name: 'left', axis: new THREE.Vector3(-1, 0, 0), rotation: new THREE.Euler(0, -Math.PI / 2, 0), test: (x) => x === -1 },
  { name: 'top', axis: new THREE.Vector3(0, 1, 0), rotation: new THREE.Euler(-Math.PI / 2, 0, 0), test: (_, y) => y === 1 },
  { name: 'bottom', axis: new THREE.Vector3(0, -1, 0), rotation: new THREE.Euler(Math.PI / 2, 0, 0), test: (_, y) => y === -1 },
  { name: 'front', axis: new THREE.Vector3(0, 0, 1), rotation: new THREE.Euler(0, 0, 0), test: (_, __, z) => z === 1 },
  { name: 'back', axis: new THREE.Vector3(0, 0, -1), rotation: new THREE.Euler(0, Math.PI, 0), test: (_, __, z) => z === -1 },
];

const cubieMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x111111,
  roughness: 0.16,
  metalness: 0.04,
  clearcoat: 0.92,
  clearcoatRoughness: 0.2,
  sheen: 0.5,
  sheenRoughness: 0.58,
  envMapIntensity: 1.55,
});

const stickerGeometry = new RoundedBoxGeometry(STICKER_INSET, STICKER_INSET, 0.01, 4, 0.025);
const cubieGeometry = new RoundedBoxGeometry(CUBIE_SIZE, CUBIE_SIZE, CUBIE_SIZE, 4, 0.03);

for (let x = -1; x <= 1; x += 1) {
  for (let y = -1; y <= 1; y += 1) {
    for (let z = -1; z <= 1; z += 1) {
      const cubie = new THREE.Mesh(cubieGeometry, cubieMaterial);
      cubie.position.set(x * STEP, y * STEP, z * STEP);
      cubie.castShadow = x !== 0 || y !== 0 || z !== 0;
      cubie.receiveShadow = true;
      cubeGroup.add(cubie);

      for (const face of FACE_DEFS) {
        if (!face.test(x, y, z)) {
          continue;
        }

        const sticker = new THREE.Mesh(stickerGeometry, createStickerMaterial(FACE_COLORS[face.name]));
        sticker.position.copy(face.axis).multiplyScalar(STICKER_OFFSET);
        sticker.rotation.copy(face.rotation);
        cubie.add(sticker);
      }
    }
  }
}

const shadowDisc = new THREE.Mesh(
  new THREE.CircleGeometry(1.08, 64),
  new THREE.MeshBasicMaterial({ color: 0x02060d, transparent: true, opacity: 0.14 })
);
shadowDisc.rotation.x = -Math.PI / 2;
shadowDisc.position.set(0, -1.02, 0);
focalRig.add(shadowDisc);

const glowDisc = new THREE.Mesh(
  new THREE.CircleGeometry(0.84, 64),
  new THREE.MeshBasicMaterial({ color: 0x6dbbff, transparent: true, opacity: 0.07 })
);
glowDisc.rotation.x = -Math.PI / 2;
glowDisc.position.set(0, -1, 0);
focalRig.add(glowDisc);

const interactionAnchorWorld = new THREE.Vector3();
const interactionAnchorProjected = new THREE.Vector3();

const headTrackedView = {
  active: false,
  eye: new THREE.Vector3(0, 0, 0.8),
  depthGain: 1,
  perspectiveStrength: 1.3,
  screenWidth: 0.34,
  screenHeight: 0.19,
};

const roomState = {
  width: ROOM_BASE.width,
  height: ROOM_BASE.height,
  depth: ROOM_BASE.depth,
  targetDepth: ROOM_BASE.depth,
};

const objectInteraction = {
  rotation: new THREE.Quaternion(),
  targetRotation: new THREE.Quaternion(),
  appliedYaw: 0,
  appliedPitch: 0,
  appliedRoll: 0,
  scale: 1,
  targetYaw: 0,
  targetPitch: 0,
  targetRoll: 0,
  targetScale: 1,
};

const interactionAnchor = {
  x: 0.5,
  y: 0.5,
};

resizeRendererToHost();
renderer.setAnimationLoop(render);
window.addEventListener('resize', resizeRendererToHost);
applyRoomBoxLayout();

export const sceneReady = Promise.resolve(true);

export function setHeadTrackedView(data = {}) {
  headTrackedView.active = true;
  headTrackedView.eye.set(data.eye?.x ?? 0, data.eye?.y ?? 0, data.eye?.z ?? 0.8);
  headTrackedView.depthGain = data.depthGain ?? headTrackedView.depthGain;
  headTrackedView.perspectiveStrength = data.perspectiveStrength ?? headTrackedView.perspectiveStrength;
  headTrackedView.screenWidth = data.screen?.width ?? headTrackedView.screenWidth;
  headTrackedView.screenHeight = data.screen?.height ?? headTrackedView.screenHeight;
  roomState.targetDepth = ROOM_BASE.depth * clamp(headTrackedView.depthGain, 0.68, 1.72);
}

export function setObjectInteraction(data = {}) {
  objectInteraction.targetYaw = data.yaw ?? objectInteraction.targetYaw;
  objectInteraction.targetPitch = data.pitch ?? objectInteraction.targetPitch;
  objectInteraction.targetRoll = data.roll ?? objectInteraction.targetRoll;
  objectInteraction.targetScale = clamp(data.scale ?? objectInteraction.targetScale, 0.72, 1.85);
}

export function resetObjectInteraction() {
  objectInteraction.rotation.identity();
  objectInteraction.targetRotation.identity();
  objectInteraction.appliedYaw = 0;
  objectInteraction.appliedPitch = 0;
  objectInteraction.appliedRoll = 0;
  objectInteraction.scale = 1;
  objectInteraction.targetYaw = 0;
  objectInteraction.targetPitch = 0;
  objectInteraction.targetRoll = 0;
  objectInteraction.targetScale = 1;
}

export function getInteractionAnchor() {
  return {
    x: interactionAnchor.x,
    y: interactionAnchor.y,
  };
}

export function resizeRendererToHost() {
  const width = Math.max(hostRoot.clientWidth, 1);
  const height = Math.max(hostRoot.clientHeight, 1);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function render() {
  applyHeadTrackedView();
  renderer.render(scene, camera);
}

function applyHeadTrackedView() {
  applyObjectInteraction();
  applyRoomBoxLayout();
  focalRig.position.set(0, 0.02, 0);

  const eyeX = clamp(headTrackedView.eye.x, -0.36, 0.36);
  const eyeY = clamp(headTrackedView.eye.y, -0.24, 0.24);
  const perspectiveStrength = clamp(headTrackedView.perspectiveStrength, 0.6, 2.4);
  const cameraOffsetX = eyeX * (3.25 + perspectiveStrength * 1.25);
  const cameraOffsetY = eyeY * (2.05 + perspectiveStrength * 0.85);

  // Keep the cube fixed in the world and move only the viewer's position.
  camera.position.set(
    baseCameraPosition.x + cameraOffsetX,
    baseCameraPosition.y + cameraOffsetY,
    baseCameraPosition.z
  );
  camera.up.copy(baseCameraUp);
  camera.lookAt(baseCameraTarget);
  camera.fov = 34;
  camera.aspect = Math.max(hostRoot.clientWidth, 1) / Math.max(hostRoot.clientHeight, 1);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  updateInteractionAnchor();
}

function applyObjectInteraction() {
  const yawDelta = shortestAngleDelta(objectInteraction.targetYaw, objectInteraction.appliedYaw);
  const pitchDelta = shortestAngleDelta(objectInteraction.targetPitch, objectInteraction.appliedPitch);
  const rollDelta = shortestAngleDelta(objectInteraction.targetRoll, objectInteraction.appliedRoll);

  if (Math.abs(yawDelta) > 0.00001 || Math.abs(pitchDelta) > 0.00001 || Math.abs(rollDelta) > 0.00001) {
    applyWorldRotationDeltas(objectInteraction.targetRotation, {
      yawDelta,
      pitchDelta,
      rollDelta,
    });
    objectInteraction.appliedYaw = objectInteraction.targetYaw;
    objectInteraction.appliedPitch = objectInteraction.targetPitch;
    objectInteraction.appliedRoll = objectInteraction.targetRoll;
  }

  objectInteraction.rotation.slerp(objectInteraction.targetRotation, 0.18);
  objectInteraction.scale = lerp(objectInteraction.scale, objectInteraction.targetScale, 0.16);

  composeObjectQuaternion(cubeGroup.quaternion, baseCubeQuaternion, objectInteraction.rotation);
  cubeGroup.scale.setScalar(baseCubeScale * objectInteraction.scale);
  shadowDisc.scale.setScalar(objectInteraction.scale);
  glowDisc.scale.setScalar(Math.max(0.82, objectInteraction.scale * 0.94));
}

function updateInteractionAnchor() {
  interactionAnchorWorld.set(0, 0, 0);
  focalRig.localToWorld(interactionAnchorWorld);
  interactionAnchorProjected.copy(interactionAnchorWorld).project(camera);
  interactionAnchor.x = interactionAnchorProjected.x * 0.5 + 0.5;
  interactionAnchor.y = interactionAnchorProjected.y * -0.5 + 0.5;
}

function applyRoomBoxLayout() {
  roomState.depth = lerp(roomState.depth, roomState.targetDepth, 0.12);

  const width = roomState.width;
  const height = roomState.height;
  const depth = roomState.depth;

  roomFloor.scale.set(width / ROOM_GRID_SIZE, 1, depth / ROOM_GRID_SIZE);
  roomFloor.position.set(0, -height / 2, 0);

  roomCeiling.scale.set(width / ROOM_GRID_SIZE, 1, depth / ROOM_GRID_SIZE);
  roomCeiling.position.set(0, height / 2, 0);

  roomLeftWall.scale.set(height / ROOM_GRID_SIZE, 1, depth / ROOM_GRID_SIZE);
  roomLeftWall.position.set(-width / 2, 0, 0);

  roomRightWall.scale.set(height / ROOM_GRID_SIZE, 1, depth / ROOM_GRID_SIZE);
  roomRightWall.position.set(width / 2, 0, 0);

  roomBackWall.scale.set(width / ROOM_GRID_SIZE, 1, height / ROOM_GRID_SIZE);
  roomBackWall.position.set(0, 0, -depth / 2);

  roomFrame.scale.set(width, height, depth);
}

function createStickerMaterial(color) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.16,
    metalness: 0.04,
    clearcoat: 0.9,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.25,
    sheen: 0.07,
    sheenRoughness: 0.38,
  });
}

function createRoomGrid(color1, color2, opacity) {
  const grid = new THREE.GridHelper(ROOM_GRID_SIZE, 12, color1, color2);
  const materials = Array.isArray(grid.material) ? grid.material : [grid.material];

  for (const material of materials) {
    material.transparent = true;
    material.opacity = opacity;
    material.depthWrite = false;
  }

  return grid;
}

function buildEnvironmentTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#9ac0e2');
  gradient.addColorStop(0.5, '#d7d8d1');
  gradient.addColorStop(1, '#35546a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function lerp(current, target, amount) {
  return current + (target - current) * amount;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
