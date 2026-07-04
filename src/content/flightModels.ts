export type FlightModelId = 'gunship' | 'jet' | 'drone';

export interface FlightModel {
  maxSpeed: number;
  maxReverse: number;
  maxStrafe: number;
  tiltAccel: number;
  strafeAccel: number;
  dragK: number;
  maxTiltPitch: number;
  maxTiltRoll: number;
  attitudeLag: number;
  yawRateHover: number;
  yawRateAtSpeed: number;
  weathervane: number;
  climbRate: number;
  climbAccel: number;
  hoverDamp: number;
  groundEffect: number;
  gimbalHalfAngle: number;
  mouseFollowRate: number;
}

export const FLIGHT_MODELS: Record<FlightModelId, FlightModel> = {
  gunship: {
    maxSpeed: 46,
    maxReverse: 12,
    maxStrafe: 16,
    tiltAccel: 15,
    strafeAccel: 10,
    dragK: 15 / (46 * 46),
    maxTiltPitch: 0.34,
    maxTiltRoll: 0.42,
    attitudeLag: 6,
    yawRateHover: 2.6,
    yawRateAtSpeed: 1.3,
    weathervane: 0.35,
    climbRate: 14,
    climbAccel: 22,
    hoverDamp: 0.6,
    groundEffect: 0.5,
    gimbalHalfAngle: 0.44,
    mouseFollowRate: 2.2,
  },
  drone: {
    maxSpeed: 32,
    maxReverse: 10,
    maxStrafe: 20,
    tiltAccel: 18,
    strafeAccel: 16,
    dragK: 18 / (32 * 32),
    maxTiltPitch: 0.26,
    maxTiltRoll: 0.36,
    attitudeLag: 12,
    yawRateHover: 3.4,
    yawRateAtSpeed: 2.2,
    weathervane: 0.2,
    climbRate: 16,
    climbAccel: 32,
    hoverDamp: 1.1,
    groundEffect: 0.55,
    gimbalHalfAngle: 0.58,
    mouseFollowRate: 2.8,
  },
  jet: {
    maxSpeed: 92,
    maxReverse: 0,
    maxStrafe: 3,
    tiltAccel: 24,
    strafeAccel: 3,
    dragK: 24 / (92 * 92),
    maxTiltPitch: 0.24,
    maxTiltRoll: 0.8,
    attitudeLag: 4.8,
    yawRateHover: 0.9,
    yawRateAtSpeed: 0.55,
    weathervane: 0.8,
    climbRate: 18,
    climbAccel: 14,
    hoverDamp: 0.05,
    groundEffect: 0.4,
    gimbalHalfAngle: 0.18,
    mouseFollowRate: 1.0,
  },
};
