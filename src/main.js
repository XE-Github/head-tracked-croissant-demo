import './style.css';
import {
  applyDualHandTransformStep,
  applySingleHandRotationStep,
  clamp,
  shortestAngleDelta,
} from './gestureMath.js';

const sceneShell = document.querySelector('#scene-shell');
const video = document.querySelector('#camera-feed');
const statusPill = document.querySelector('#status-pill');
const trackingState = document.querySelector('#tracking-state');
const gestureOverlay = document.querySelector('#gesture-overlay');
const gestureAnchor = document.querySelector('#gesture-anchor');
const gestureLink = document.querySelector('#gesture-link');
const gestureCursorLeft = document.querySelector('#gesture-cursor-left');
const gestureCursorRight = document.querySelector('#gesture-cursor-right');
const gestureStatus = document.querySelector('#gesture-status');
const gestureStatusTitle = document.querySelector('#gesture-status-title');
const gestureStatusDetail = document.querySelector('#gesture-status-detail');
const fullscreenButton = document.querySelector('#fullscreen-toggle');
const recenterButton = document.querySelector('#recenter-view');
const resetObjectButton = document.querySelector('#reset-object');

const controls = {
  trackingResponse: bindRange('tracking-response', (value) => value.toFixed(2)),
  trackingAhead: bindRange('tracking-ahead', (value) => value.toFixed(2)),
  headRange: bindRange('head-range', (value) => value.toFixed(2)),
  perspectiveStrength: bindRange('perspective-strength', (value) => value.toFixed(2)),
  roomDepth: bindRange('room-depth', (value) => value.toFixed(1)),
  framingZoom: bindRange('framing-zoom', (value) => value.toFixed(2)),
  gesturesEnabled: bindToggle('gesture-enabled'),
};

const pointer = {
  current: { x: 0, y: 0, z: 0.82 },
  target: { x: 0, y: 0, z: 0.82 },
  neutral: { x: 0, y: 0 },
};

const trackingInput = {
  initialized: false,
  raw: { x: 0, y: 0 },
};

const viewportState = {
  width: 1,
  height: 1,
  screenWidth: 0.34,
  screenHeight: 0.19,
};

const appState = {
  faceLandmarker: null,
  handLandmarker: null,
  lastVideoTime: -1,
  projectError: '',
  projectReady: false,
  trackingReady: false,
  handTrackingReady: false,
  cameraReady: false,
  cameraError: '',
  faceTrackingError: '',
  handTrackingError: '',
};

const gestureState = {
  mode: 'loading',
  handsVisible: 0,
  activeHandKey: '',
  rotateLastCenter: null,
  scaleLastDistance: 0,
  scaleLastAngle: 0,
  pinchByHand: new Map(),
  overlayHands: [],
  objectYaw: 0,
  objectPitch: 0,
  objectRoll: 0,
  objectScale: 1,
};

let sceneBridge = null;

window.__logicCubeHost = {
  onError(message) {
    appState.projectError = message ?? '请检查控制台。';
    statusPill.textContent = '项目启动失败';
    trackingState.textContent = `3D 项目报错：${appState.projectError}`;
  },
};

setupEvents();
resize();
await mountProject();
await initTracking();
updateGestureStatus();
requestAnimationFrame(tick);

function bindRange(id, formatter) {
  const input = document.getElementById(id);
  const output = document.getElementById(`${id}-value`);
  const state = { value: Number(input.value), input, output };

  const sync = () => {
    state.value = Number(input.value);
    output.value = formatter(state.value);
  };

  input.addEventListener('input', sync);
  sync();
  return state;
}

function bindToggle(id) {
  const input = document.getElementById(id);
  const state = { value: input.checked, input };

  const sync = () => {
    state.value = input.checked;
  };

  input.addEventListener('change', sync);
  sync();
  return state;
}

function setupEvents() {
  window.addEventListener('resize', resize);

  fullscreenButton.addEventListener('click', async () => {
    if (!document.fullscreenElement) {
      await sceneShell.requestFullscreen();
      fullscreenButton.textContent = '退出全屏';
      resize();
      return;
    }

    await document.exitFullscreen();
    fullscreenButton.textContent = '进入全屏';
    resize();
  });

  document.addEventListener('fullscreenchange', () => {
    fullscreenButton.textContent = document.fullscreenElement ? '退出全屏' : '进入全屏';
    resize();
  });

  recenterButton.addEventListener('click', () => {
    pointer.neutral.x = pointer.current.x;
    pointer.neutral.y = pointer.current.y;
    trackingState.textContent = '已将当前观察位置设为中心。';
  });

  resetObjectButton.addEventListener('click', () => {
    resetObjectInteraction();
  });

  controls.gesturesEnabled.input.addEventListener('change', () => {
    clearGestureAnchors();
    gestureState.mode = controls.gesturesEnabled.value ? 'idle' : 'disabled';
    updateGestureStatus();
  });

  sceneShell.addEventListener('pointermove', (event) => {
    if (appState.trackingReady) {
      return;
    }

    const rect = sceneShell.getBoundingClientRect();
    pointer.target.x = ((event.clientX - rect.left) / rect.width - 0.5) * 0.22;
    pointer.target.y = (0.5 - (event.clientY - rect.top) / rect.height) * 0.12;
    pointer.target.z = 0.82;
  });
}

async function mountProject() {
  statusPill.textContent = '正在加载 3D 项目...';

  try {
    const importedScene = await promiseWithTimeout(
      import('./logicCubeScene.js'),
      '3D 项目模块加载超时，请检查场景资源或模块解析。',
      15000
    );
    sceneBridge = importedScene;
    await promiseWithTimeout(
      sceneBridge.sceneReady,
      '3D 项目渲染器初始化超时，请检查浏览器图形能力。',
      15000
    );

    appState.projectError = '';
    appState.projectReady = true;
    sceneBridge.resizeRendererToHost?.();
    sceneBridge.setObjectInteraction?.({
      yaw: gestureState.objectYaw,
      pitch: gestureState.objectPitch,
      roll: gestureState.objectRoll,
      scale: gestureState.objectScale,
    });
    updateProjectStatus();
  } catch (error) {
    appState.projectError = error?.message ?? '请检查控制台。';
    statusPill.textContent = '项目启动失败';
    trackingState.textContent = `3D 项目加载失败：${appState.projectError}`;
    console.error(error);
  }
}

function resize() {
  const rect = sceneShell.getBoundingClientRect();
  viewportState.width = Math.max(1, Math.floor(rect.width));
  viewportState.height = Math.max(1, Math.floor(rect.height));
  viewportState.screenWidth = 0.34 / controls.framingZoom.value;
  viewportState.screenHeight = viewportState.screenWidth / (viewportState.width / viewportState.height);
  sceneBridge?.resizeRendererToHost?.();
}

async function initTracking() {
  if (!navigator.mediaDevices?.getUserMedia) {
    const error = new Error('当前环境不支持 getUserMedia，通常需要通过 localhost 或 https 打开。');
    appState.cameraError = formatTrackingError(error);
    appState.faceTrackingError = formatVisionBootstrapError(error);
    trackingState.textContent = `头部追踪初始化失败，当前为鼠标预览。${appState.faceTrackingError}`;
    updateProjectStatus();
    updateGestureStatus();
    return;
  }

  let FaceLandmarker;
  let HandLandmarker;
  let FilesetResolver;

  try {
    ({ FaceLandmarker, HandLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision'));
  } catch (error) {
    appState.faceTrackingError = formatVisionBootstrapError(error);
    appState.handTrackingError = '手势识别未能初始化，旧版头跟踪体验仍可继续使用。';
    trackingState.textContent = `头部追踪初始化失败，当前为鼠标预览。${appState.faceTrackingError}`;
    updateProjectStatus();
    updateGestureStatus();
    console.error(error);
    return;
  }

  try {
    const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
    const [faceResult, handResult] = await Promise.allSettled([
      promiseWithTimeout(
        FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/models/face_landmarker.task',
          },
          numFaces: 1,
          runningMode: 'VIDEO',
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
        }),
        '头部追踪模型初始化超时，请刷新页面后重试。',
        15000
      ),
      promiseWithTimeout(
        HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/models/hand_landmarker.task',
          },
          numHands: 2,
          runningMode: 'VIDEO',
          minHandDetectionConfidence: 0.45,
          minHandPresenceConfidence: 0.45,
          minTrackingConfidence: 0.45,
        }),
        '手势模型初始化超时，请刷新页面后重试。',
        15000
      ),
    ]);

    if (faceResult.status === 'fulfilled') {
      appState.faceLandmarker = faceResult.value;
      appState.faceTrackingError = '';
    } else {
      appState.faceTrackingError = '头部追踪初始化失败，已保留鼠标预览模式。';
      console.warn('Face tracking unavailable, falling back to pointer preview.', faceResult.reason);
    }

    if (handResult.status === 'fulfilled') {
      appState.handLandmarker = handResult.value;
      appState.handTrackingError = '';
    } else {
      appState.handTrackingError = formatHandTrackingError(handResult.reason);
      console.warn('Hand tracking unavailable, keeping the legacy interaction path.', handResult.reason);
    }
  } catch (error) {
    appState.faceTrackingError = formatVisionBootstrapError(error);
    appState.handTrackingError = '手势识别未能初始化，旧版头跟踪体验仍可继续使用。';
    trackingState.textContent = `头部追踪初始化失败，当前为鼠标预览。${appState.faceTrackingError}`;
    updateProjectStatus();
    updateGestureStatus();
    console.error(error);
    return;
  }

  try {
    const mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user',
      },
      audio: false,
    });

    video.srcObject = mediaStream;
    await video.play();

    appState.cameraReady = true;
    appState.cameraError = '';
    appState.trackingReady = Boolean(appState.faceLandmarker);
    appState.handTrackingReady = Boolean(appState.handLandmarker);

    if (appState.trackingReady) {
      trackingState.textContent = '正在追踪你的头部位置。';
    } else {
      trackingState.textContent = appState.faceTrackingError || '头部追踪初始化失败，当前为鼠标预览。';
    }

    updateProjectStatus();
    updateGestureStatus();
  } catch (error) {
    appState.cameraReady = false;
    appState.cameraError = formatTrackingError(error);
    appState.trackingReady = false;
    appState.handTrackingReady = false;
    trackingState.textContent = `摄像头不可用，已切换到鼠标预览模式。${appState.cameraError}`;
    updateProjectStatus();
    updateGestureStatus();

    if (isExpectedTrackingFallback(error)) {
      console.info('Camera unavailable, switched to pointer preview.', {
        name: error?.name ?? 'UnknownError',
        message: error?.message ?? '',
      });
    } else {
      console.error(error);
    }
  }
}

function tick() {
  processVisionFrame();
  updatePointerSmoothing();
  updateViewportChrome();

  if (appState.projectReady && sceneBridge?.setHeadTrackedView) {
    const relativeX = (pointer.current.x - pointer.neutral.x) * controls.headRange.value;
    const relativeY = (pointer.current.y - pointer.neutral.y) * controls.headRange.value;

    sceneBridge.setHeadTrackedView({
      eye: {
        x: relativeX,
        y: relativeY,
        z: pointer.current.z,
      },
      depthGain: controls.roomDepth.value / 10,
      perspectiveStrength: controls.perspectiveStrength.value,
      screen: {
        width: viewportState.screenWidth,
        height: viewportState.screenHeight,
      },
    });
  }

  if (appState.projectReady && sceneBridge?.setObjectInteraction) {
    sceneBridge.setObjectInteraction({
      yaw: gestureState.objectYaw,
      pitch: gestureState.objectPitch,
      roll: gestureState.objectRoll,
      scale: gestureState.objectScale,
    });
  }

  renderGestureOverlay();

  requestAnimationFrame(tick);
}

function processVisionFrame() {
  if (!appState.cameraReady || video.readyState < 2 || video.currentTime === appState.lastVideoTime) {
    return;
  }

  appState.lastVideoTime = video.currentTime;
  const timestamp = performance.now();

  if (appState.trackingReady && appState.faceLandmarker) {
    const faceResult = appState.faceLandmarker.detectForVideo(video, timestamp);
    syncFaceTracking(faceResult.faceLandmarks?.[0] ?? null);
  }

  if (controls.gesturesEnabled.value && appState.handTrackingReady && appState.handLandmarker) {
    const handResult = appState.handLandmarker.detectForVideo(video, timestamp);
    syncHandGestures(handResult);
  } else {
    syncHandGestures(null);
  }
}

function syncFaceTracking(face) {
  if (!face) {
    trackingState.textContent = '头部暂未进入画面，保持当前视角。';
    return;
  }

  const leftEye = midpoint(face[33], face[133]);
  const rightEye = midpoint(face[362], face[263]);
  const eyesCenter = midpoint(leftEye, rightEye);

  // Track only lateral head movement so the object stays stable in size.
  const rawX = clamp((0.5 - eyesCenter.x) * 0.54, -0.24, 0.24);
  const rawY = clamp((0.5 - eyesCenter.y) * 0.34, -0.18, 0.18);

  if (!trackingInput.initialized) {
    trackingInput.initialized = true;
    trackingInput.raw.x = rawX;
    trackingInput.raw.y = rawY;
    pointer.target.x = rawX;
    pointer.target.y = rawY;
    pointer.target.z = 0.82;
    trackingState.textContent = `追踪中 x:${rawX.toFixed(2)} y:${rawY.toFixed(2)}`;
    return;
  }

  const motionX = rawX - trackingInput.raw.x;
  const motionY = rawY - trackingInput.raw.y;
  const motionMagnitude = Math.hypot(motionX, motionY);
  const ahead = motionMagnitude > 0.0025 ? controls.trackingAhead.value : 0;
  const predictedX = clamp(rawX + motionX * ahead, -0.28, 0.28);
  const predictedY = clamp(rawY + motionY * ahead, -0.22, 0.22);

  trackingInput.raw.x = rawX;
  trackingInput.raw.y = rawY;

  pointer.target.x = predictedX;
  pointer.target.y = predictedY;
  pointer.target.z = 0.82;
  trackingState.textContent = `追踪中 x:${predictedX.toFixed(2)} y:${predictedY.toFixed(2)}`;
}

function syncHandGestures(result) {
  if (!controls.gesturesEnabled.value) {
    clearGestureAnchors();
    gestureState.mode = 'disabled';
    gestureState.handsVisible = 0;
    updateGestureStatus();
    return;
  }

  if (!appState.cameraReady) {
    clearGestureAnchors();
    gestureState.mode = 'loading';
    gestureState.handsVisible = 0;
    updateGestureStatus();
    return;
  }

  if (!appState.handTrackingReady || !result) {
    clearGestureAnchors();
    gestureState.mode = 'unavailable';
    gestureState.handsVisible = 0;
    updateGestureStatus();
    return;
  }

  const pinchHands = extractPinchHands(result);
  gestureState.handsVisible = result.landmarks?.length ?? 0;
  gestureState.overlayHands = pinchHands;

  if (pinchHands.length >= 2) {
    handleDualHandScale(pinchHands.slice(0, 2));
  } else if (pinchHands.length === 1) {
    handleSingleHandRotate(pinchHands[0]);
  } else {
    clearGestureAnchors();
    gestureState.mode = 'idle';
  }

  updateGestureStatus();
}

function handleSingleHandRotate(hand) {
  if (gestureState.mode !== 'rotate' || gestureState.activeHandKey !== hand.key || !gestureState.rotateLastCenter) {
    gestureState.mode = 'rotate';
    gestureState.activeHandKey = hand.key;
    gestureState.rotateLastCenter = hand.center;
    gestureState.scaleLastDistance = 0;
    gestureState.scaleLastAngle = 0;
    return;
  }

  const deltaX = hand.center.x - gestureState.rotateLastCenter.x;
  const deltaY = hand.center.y - gestureState.rotateLastCenter.y;
  const nextRotation = applySingleHandRotationStep({
    currentYaw: gestureState.objectYaw,
    currentPitch: gestureState.objectPitch,
    deltaX,
    deltaY,
  });

  if (
    Math.abs(nextRotation.yaw - gestureState.objectYaw) > 0.00001 ||
    Math.abs(nextRotation.pitch - gestureState.objectPitch) > 0.00001
  ) {
    gestureState.objectYaw = nextRotation.yaw;
    gestureState.objectPitch = nextRotation.pitch;
    gestureState.rotateLastCenter = hand.center;
  }
}

function handleDualHandScale(hands) {
  const distanceBetweenHands = distance2D(hands[0].center, hands[1].center);
  const angleBetweenHands = computeHandPairAngle(hands);

  if (distanceBetweenHands <= 0.0001) {
    return;
  }

  if (gestureState.mode !== 'scale' || gestureState.scaleLastDistance <= 0) {
    gestureState.mode = 'scale';
    gestureState.activeHandKey = '';
    gestureState.rotateLastCenter = null;
    gestureState.scaleLastDistance = distanceBetweenHands;
    gestureState.scaleLastAngle = angleBetweenHands;
    return;
  }

  const scaleRatioDelta = distanceBetweenHands / gestureState.scaleLastDistance;

  if (!Number.isFinite(scaleRatioDelta)) {
    return;
  }

  const nextTransform = applyDualHandTransformStep({
    currentScale: gestureState.objectScale,
    currentRoll: gestureState.objectRoll,
    scaleRatioDelta,
    rotationDelta: shortestAngleDelta(angleBetweenHands, gestureState.scaleLastAngle),
  });

  if (Math.abs(nextTransform.scale - gestureState.objectScale) > 0.00001) {
    gestureState.objectScale = nextTransform.scale;
    gestureState.scaleLastDistance = distanceBetweenHands;
  }

  if (Math.abs(shortestAngleDelta(nextTransform.roll, gestureState.objectRoll)) > 0.00001) {
    gestureState.objectRoll = nextTransform.roll;
    gestureState.scaleLastAngle = angleBetweenHands;
  }
}

function extractPinchHands(result) {
  const hands = result.landmarks ?? [];
  const handednessList = result.handedness ?? result.handednesses ?? [];
  const visibleKeys = new Set();
  const pinchHands = [];

  for (let index = 0; index < hands.length; index += 1) {
    const landmarks = hands[index];

    if (!landmarks?.[0] || !landmarks?.[4] || !landmarks?.[5] || !landmarks?.[8] || !landmarks?.[9] || !landmarks?.[17]) {
      continue;
    }

    const label = getHandLabel(handednessList[index], index);
    const key = label;
    visibleKeys.add(key);

    const pinchRatio = computePinchRatio(landmarks);
    const wasPinched = gestureState.pinchByHand.get(key) ?? false;
    const isPinched = wasPinched ? pinchRatio < 0.46 : pinchRatio < 0.34;

    gestureState.pinchByHand.set(key, isPinched);

    if (!isPinched) {
      continue;
    }

    pinchHands.push({
      key,
      label,
      center: normalizeVideoPoint(midpoint2D(landmarks[4], landmarks[8])),
    });
  }

  for (const key of Array.from(gestureState.pinchByHand.keys())) {
    if (!visibleKeys.has(key)) {
      gestureState.pinchByHand.delete(key);
    }
  }

  return pinchHands.sort((a, b) => a.center.x - b.center.x);
}

function resetObjectInteraction() {
  gestureState.objectYaw = 0;
  gestureState.objectPitch = 0;
  gestureState.objectRoll = 0;
  gestureState.objectScale = 1;
  clearGestureAnchors();
  gestureState.mode = controls.gesturesEnabled.value ? 'idle' : 'disabled';
  sceneBridge?.resetObjectInteraction?.();
  updateGestureStatus();
}

function clearGestureAnchors() {
  gestureState.activeHandKey = '';
  gestureState.rotateLastCenter = null;
  gestureState.scaleLastDistance = 0;
  gestureState.scaleLastAngle = 0;
  gestureState.overlayHands = [];
}

function renderGestureOverlay() {
  if (!gestureOverlay) {
    return;
  }

  const activeMode = appState.projectReady && ['rotate', 'scale'].includes(gestureState.mode) ? gestureState.mode : 'idle';
  gestureOverlay.dataset.mode = activeMode;

  if (activeMode === 'idle') {
    return;
  }

  const anchor = sceneBridge?.getInteractionAnchor?.();
  if (!anchor) {
    gestureOverlay.dataset.mode = 'idle';
    return;
  }

  positionOverlayNode(gestureAnchor, anchor);

  if (activeMode === 'rotate') {
    const hand = gestureState.overlayHands[0];

    if (!hand) {
      gestureOverlay.dataset.mode = 'idle';
      return;
    }

    positionOverlayNode(gestureCursorLeft, hand.center);
    drawOverlayLine(anchor, hand.center);
    return;
  }

  const [leftHand, rightHand] = gestureState.overlayHands;
  if (!leftHand || !rightHand) {
    gestureOverlay.dataset.mode = 'idle';
    return;
  }

  positionOverlayNode(gestureCursorLeft, leftHand.center);
  positionOverlayNode(gestureCursorRight, rightHand.center);
  drawOverlayLine(leftHand.center, rightHand.center);
}

function positionOverlayNode(node, point) {
  const x = clamp(point.x, 0.02, 0.98) * viewportState.width;
  const y = clamp(point.y, 0.02, 0.98) * viewportState.height;
  node.style.left = `${x.toFixed(1)}px`;
  node.style.top = `${y.toFixed(1)}px`;
}

function drawOverlayLine(start, end) {
  const startPoint = {
    x: clamp(start.x, 0.02, 0.98) * viewportState.width,
    y: clamp(start.y, 0.02, 0.98) * viewportState.height,
  };
  const endPoint = {
    x: clamp(end.x, 0.02, 0.98) * viewportState.width,
    y: clamp(end.y, 0.02, 0.98) * viewportState.height,
  };
  const deltaX = endPoint.x - startPoint.x;
  const deltaY = endPoint.y - startPoint.y;
  const length = Math.max(0, Math.hypot(deltaX, deltaY));
  const angle = Math.atan2(deltaY, deltaX);

  gestureLink.style.left = `${startPoint.x.toFixed(1)}px`;
  gestureLink.style.top = `${startPoint.y.toFixed(1)}px`;
  gestureLink.style.width = `${length.toFixed(1)}px`;
  gestureLink.style.transform = `translateY(-50%) rotate(${angle}rad)`;
}

function normalizeVideoPoint(point) {
  return {
    x: 1 - point.x,
    y: point.y,
  };
}

function computeHandPairAngle(hands) {
  return Math.atan2(hands[1].center.y - hands[0].center.y, hands[1].center.x - hands[0].center.x);
}

function updatePointerSmoothing() {
  const deltaX = pointer.target.x - pointer.current.x;
  const deltaY = pointer.target.y - pointer.current.y;
  const deltaZ = pointer.target.z - pointer.current.z;
  const motionMagnitude = Math.hypot(deltaX, deltaY, deltaZ);
  const response = clamp(
    controls.trackingResponse.value + motionMagnitude * 0.95,
    controls.trackingResponse.value,
    0.52
  );

  pointer.current.x = lerp(pointer.current.x, pointer.target.x, response);
  pointer.current.y = lerp(pointer.current.y, pointer.target.y, response);
  pointer.current.z = lerp(pointer.current.z, pointer.target.z, response);
}

function updateViewportChrome() {
  const relativeX = (pointer.current.x - pointer.neutral.x) * 120;
  const relativeY = (pointer.current.y - pointer.neutral.y) * 120;
  sceneShell.style.setProperty('--look-x', `${relativeX.toFixed(2)}px`);
  sceneShell.style.setProperty('--look-y', `${relativeY.toFixed(2)}px`);
}

function updateProjectStatus() {
  if (appState.projectError) {
    statusPill.textContent = '项目启动失败';
    return;
  }

  if (!appState.projectReady) {
    statusPill.textContent = '正在加载 3D 项目...';
    return;
  }

  statusPill.textContent = appState.trackingReady ? '固定物体视窗已就绪，头跟踪已开启' : '固定物体视窗已就绪，当前为鼠标预览';
}

function updateGestureStatus() {
  let mode = 'idle';
  let title = '手势待命';
  let detail = '拇指与食指捏合可选中，单手旋转，双手缩放并扭转。';

  if (!controls.gesturesEnabled.value) {
    mode = 'disabled';
    title = '手势操控已关闭';
    detail = '打开手势操控开关后，可继续单手旋转和双手缩放/扭转。';
  } else if (!appState.cameraReady) {
    if (appState.cameraError) {
      mode = 'unavailable';
      title = '手势不可用';
      detail = `摄像头尚未可用。${appState.cameraError.trim()}`;
    } else {
      mode = 'loading';
      title = '手势等待摄像头';
      detail = '摄像头就绪后，将自动启用手势识别。';
    }
  } else if (!appState.handTrackingReady) {
    mode = 'unavailable';
    title = '手势不可用';
    detail = appState.handTrackingError || '手势识别初始化失败，但旧版头跟踪仍可继续使用。';
  } else if (gestureState.mode === 'rotate') {
    mode = 'rotate';
    title = '单手已选中';
    detail = '保持捏合并移动手的位置，可对中心方块做 360 度旋转。';
  } else if (gestureState.mode === 'scale') {
    mode = 'scale';
    title = '双手已选中';
    detail = '保持双手捏合并拉开、靠近或扭转，可对中心方块缩放并旋转。';
  } else if (gestureState.handsVisible > 0) {
    mode = 'idle';
    title = '未选中';
    detail = '检测到手部，拇指与食指捏合后即可开始操作。';
  }

  gestureStatus.dataset.mode = mode;
  gestureStatusTitle.textContent = title;
  gestureStatusDetail.textContent = detail;
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) * 0.5,
    y: (a.y + b.y) * 0.5,
    z: (a.z + b.z) * 0.5,
  };
}

function midpoint2D(a, b) {
  return {
    x: (a.x + b.x) * 0.5,
    y: (a.y + b.y) * 0.5,
  };
}

function getHandLabel(handednessEntry, index) {
  const label = handednessEntry?.[0]?.displayName ?? handednessEntry?.[0]?.categoryName;
  return label || `Hand ${index + 1}`;
}

function computePinchRatio(landmarks) {
  const pinchDistance = distance2D(landmarks[4], landmarks[8]);
  const palmWidth = distance2D(landmarks[5], landmarks[17]);
  const palmHeight = distance2D(landmarks[0], landmarks[9]);
  const handSize = Math.max(palmWidth, palmHeight, 0.0001);
  return pinchDistance / handSize;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function distance2D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function lerp(current, target, amount) {
  return current + (target - current) * amount;
}


function promiseWithTimeout(promise, message, delay) {
  return Promise.race([promise, timeoutReject(message, delay)]);
}

function timeoutReject(message, delay) {
  return new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error(message)), delay);
  });
}

function isExpectedTrackingFallback(error) {
  if (!error) {
    return false;
  }

  return ['NotAllowedError', 'NotFoundError'].includes(error.name);
}

function formatTrackingError(error) {
  if (!error) {
    return '';
  }

  const message = error.message || '';
  if (message.includes('localhost') || message.includes('https')) {
    return ' 请通过 `npm run dev` 启动后，在 localhost 页面中打开。';
  }
  if (error.name === 'NotAllowedError') {
    return ' 请检查浏览器是否拒绝了摄像头权限。';
  }
  if (error.name === 'NotFoundError') {
    return ' 没有检测到可用摄像头设备。';
  }
  return ' 请查看控制台错误信息。';
}

function formatVisionBootstrapError(error) {
  const message = error?.message || '';

  if (message.includes('localhost') || message.includes('https')) {
    return ' 请通过 `npm run dev` 启动后，在 localhost 页面中打开。';
  }

  return ' 请刷新页面后重试，或查看控制台了解详情。';
}

function formatHandTrackingError(error) {
  if (!error) {
    return '手势识别初始化失败，但旧版头跟踪仍可继续使用。';
  }

  const message = error.message || '';
  if (message.includes('hand_landmarker.task')) {
    return '手势模型加载失败，但旧版头跟踪仍可继续使用。';
  }
  if (message.includes('超时')) {
    return '手势模型初始化超时，但旧版头跟踪仍可继续使用。';
  }
  return '手势识别初始化失败，但旧版头跟踪仍可继续使用。';
}
