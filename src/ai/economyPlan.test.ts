import { expect, it } from 'vitest';
import type { Entity } from '../sim/components';
import { needsForwardRefinery } from './economyPlan';
const refinery = (x:number) => ({transform:{x,z:0,rot:0}} as Entity);
const ore = (x:number,remaining=1000) => ({x,z:0,radius:20,remaining,capacity:1000});
it('continues resource expansion after the normal refinery quota when ore is distant',()=>{
 expect(needsForwardRefinery([refinery(0),refinery(30),refinery(60)],[ore(500)],8)).toBe(true);
 expect(needsForwardRefinery([refinery(0),refinery(420)],[ore(500)],8)).toBe(false);
});
it('moves away from depleted fields but does not expand without useful ore',()=>{
 expect(needsForwardRefinery([refinery(0)],[ore(20,10),ore(500)],8)).toBe(true);
 expect(needsForwardRefinery([refinery(0)],[ore(20,0)],8)).toBe(false);
});
it('bounds expansion count and lets the opening build create the first refinery',()=>{
 expect(needsForwardRefinery([], [ore(500)],8)).toBe(false);
 expect(needsForwardRefinery(Array.from({length:8},()=>refinery(0)),[ore(500)],8)).toBe(false);
});
