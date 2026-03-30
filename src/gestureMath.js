// Keep all gesture direction rules in one place so runtime code and tests stay aligned.
export const gestureGains = Object.freeze({
  singleYaw: Math.PI * 2.15,
  singlePitch: Math.PI * 1.78,
  dualRoll: 1.08,
});

export const gestureDeadZones = Object.freeze({
  rotate: 0.01,
  scale: 0.04,
  dualRotate: 0.035,
});

export const gestureDirections = Object.freeze({
  singleYaw: 1,
  singlePitch: 1,
  dualRoll: -1,
});

export const objectInteractionLimits = Object.freeze({
  minScale: 0.72,
  maxScale: 1.85,
});

export function applySingleHandRotationStep({ currentYaw, currentPitch, deltaX, deltaY }) {
  const adjustedX = applyGestureDeadZone(deltaX, gestureDeadZones.rotate);
  const adjustedY = applyGestureDeadZone(deltaY, gestureDeadZones.rotate);

  return {
    yaw: stabilizeAngle(currentYaw + adjustedX * gestureGains.singleYaw * gestureDirections.singleYaw),
    pitch: stabilizeAngle(currentPitch + adjustedY * gestureGains.singlePitch * gestureDirections.singlePitch),
  };
}

export function applyDualHandTransformStep({ currentScale, currentRoll, scaleRatioDelta, rotationDelta }) {
  const adjustedScaleDelta = applyGestureDeadZone(scaleRatioDelta - 1, gestureDeadZones.scale);
  const adjustedRotationDelta = applyGestureDeadZone(rotationDelta, gestureDeadZones.dualRotate);

  return {
    scale: clamp(
      currentScale * (1 + adjustedScaleDelta * 1.08),
      objectInteractionLimits.minScale,
      objectInteractionLimits.maxScale
    ),
    roll: stabilizeAngle(currentRoll + adjustedRotationDelta * gestureGains.dualRoll * gestureDirections.dualRoll),
  };
}

export function applyGestureDeadZone(delta, threshold) {
  const magnitude = Math.abs(delta);

  if (magnitude <= threshold) {
    return 0;
  }

  return Math.sign(delta) * (magnitude - threshold);
}

export function shortestAngleDelta(next, start) {
  let delta = next - start;

  while (delta > Math.PI) {
    delta -= Math.PI * 2;
  }

  while (delta < -Math.PI) {
    delta += Math.PI * 2;
  }

  return delta;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function stabilizeAngle(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const turn = Math.PI * 2;
  if (Math.abs(value) > turn * 6) {
    return value % turn;
  }

  return value;
}
