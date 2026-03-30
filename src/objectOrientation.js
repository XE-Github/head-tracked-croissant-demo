import * as THREE from 'three';

const WORLD_X = new THREE.Vector3(1, 0, 0);
const WORLD_Y = new THREE.Vector3(0, 1, 0);
const WORLD_Z = new THREE.Vector3(0, 0, 1);

const yawQuaternion = new THREE.Quaternion();
const pitchQuaternion = new THREE.Quaternion();
const rollQuaternion = new THREE.Quaternion();

export function applyWorldRotationDeltas(
  targetQuaternion,
  { yawDelta = 0, pitchDelta = 0, rollDelta = 0 } = {}
) {
  if (yawDelta) {
    targetQuaternion.premultiply(yawQuaternion.setFromAxisAngle(WORLD_Y, yawDelta));
  }

  if (pitchDelta) {
    targetQuaternion.premultiply(pitchQuaternion.setFromAxisAngle(WORLD_X, pitchDelta));
  }

  if (rollDelta) {
    targetQuaternion.premultiply(rollQuaternion.setFromAxisAngle(WORLD_Z, rollDelta));
  }

  return targetQuaternion.normalize();
}

export function composeObjectQuaternion(targetQuaternion, baseQuaternion, gestureQuaternion) {
  targetQuaternion.copy(gestureQuaternion).multiply(baseQuaternion);
  return targetQuaternion.normalize();
}
