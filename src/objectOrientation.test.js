import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';

import { applyWorldRotationDeltas, composeObjectQuaternion } from './objectOrientation.js';

function quaternionDot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
}

test('roll delta stays on world Z even after yaw and pitch are applied', () => {
  const baseQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.38, -0.62, 0.06));
  const gestureQ1 = applyWorldRotationDeltas(new THREE.Quaternion(), {
    yawDelta: 1.2,
    pitchDelta: -1.05,
    rollDelta: 0.15,
  });
  const gestureQ2 = gestureQ1.clone();
  applyWorldRotationDeltas(gestureQ2, { rollDelta: 0.5 });
  const q1 = composeObjectQuaternion(new THREE.Quaternion(), baseQuaternion, gestureQ1);
  const q2 = composeObjectQuaternion(new THREE.Quaternion(), baseQuaternion, gestureQ2);

  const delta = q2.clone().multiply(q1.clone().invert()).normalize();
  const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.5);

  assert.ok(Math.abs(quaternionDot(delta, expected)) > 0.999999);
});

test('pitch delta stays on world X even after yaw and roll are applied', () => {
  const baseQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.38, -0.62, 0.06));
  const gestureQ1 = applyWorldRotationDeltas(new THREE.Quaternion(), {
    yawDelta: 1.1,
    pitchDelta: 0.25,
    rollDelta: -1.35,
  });
  const gestureQ2 = gestureQ1.clone();
  applyWorldRotationDeltas(gestureQ2, { pitchDelta: 0.42 });
  const q1 = composeObjectQuaternion(new THREE.Quaternion(), baseQuaternion, gestureQ1);
  const q2 = composeObjectQuaternion(new THREE.Quaternion(), baseQuaternion, gestureQ2);

  const delta = q2.clone().multiply(q1.clone().invert()).normalize();
  const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.42);

  assert.ok(Math.abs(quaternionDot(delta, expected)) > 0.999999);
});
