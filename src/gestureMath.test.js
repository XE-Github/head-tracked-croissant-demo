import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyDualHandTransformStep,
  applySingleHandRotationStep,
  gestureDirections,
  shortestAngleDelta,
} from './gestureMath.js';

test('single-hand horizontal drag to the right increases yaw', () => {
  const result = applySingleHandRotationStep({
    currentYaw: 0,
    currentPitch: 0,
    deltaX: 0.1,
    deltaY: 0,
  });

  assert.equal(gestureDirections.singleYaw, 1);
  assert.ok(result.yaw > 0);
});

test('single-hand upward drag lowers pitch per user-validated direction', () => {
  const result = applySingleHandRotationStep({
    currentYaw: 0,
    currentPitch: 0,
    deltaX: 0,
    deltaY: -0.1,
  });

  assert.equal(gestureDirections.singlePitch, 1);
  assert.ok(result.pitch < 0);
});

test('single-hand downward drag raises pitch per user-validated direction', () => {
  const result = applySingleHandRotationStep({
    currentYaw: 0,
    currentPitch: 0,
    deltaX: 0,
    deltaY: 0.1,
  });

  assert.ok(result.pitch > 0);
});

test('dual-hand counterclockwise twist decreases roll per user-validated direction', () => {
  const result = applyDualHandTransformStep({
    currentScale: 1,
    currentRoll: 0,
    scaleRatioDelta: 1,
    rotationDelta: 0.22,
  });

  assert.equal(gestureDirections.dualRoll, -1);
  assert.ok(result.roll < 0);
});

test('single-hand repeated drags can continue rotating past the old pitch cap', () => {
  let pitch = 0;

  for (let index = 0; index < 12; index += 1) {
    pitch = applySingleHandRotationStep({
      currentYaw: 0,
      currentPitch: pitch,
      deltaX: 0,
      deltaY: 0.12,
    }).pitch;
  }

  assert.ok(Math.abs(pitch) > 1.14);
});

test('dual-hand repeated twists keep accumulating roll instead of stopping at one face', () => {
  let roll = 0;

  for (let index = 0; index < 16; index += 1) {
    roll = applyDualHandTransformStep({
      currentScale: 1,
      currentRoll: roll,
      scaleRatioDelta: 1,
      rotationDelta: 0.18,
    }).roll;
  }

  assert.ok(Math.abs(roll) > 2);
});

test('shortestAngleDelta keeps wrap-around twists continuous', () => {
  const delta = shortestAngleDelta(-Math.PI + 0.12, Math.PI - 0.08);

  assert.ok(delta > 0);
  assert.ok(delta < 0.3);
});
