import { expect, it } from 'vitest';
import { estimatedWinShares } from './battleTimeline';
import type { MatchSnapshot, BattleTimelinePoint } from '../match/battleDebrief';
it('normalizes all sides independently of chart visibility and confirms the final winner', () => {
 const first = { seconds: 0, armies: [{team:1,unitsSurviving:10,credits:1000,income:0},{team:2,unitsSurviving:10,credits:1000,income:0}] } as BattleTimelinePoint;
 const last = { seconds: 100, armies: [{team:1,unitsSurviving:12,credits:2000,income:5000},{team:2,unitsSurviving:2,credits:500,income:1000}] } as BattleTimelinePoint;
 const snapshot = {armies:[{team:1,side:1,eliminated:false},{team:2,side:2,eliminated:true}],timeline:[first,last]} as MatchSnapshot;
 expect(estimatedWinShares(snapshot, first).get(1)).toBe(50);
 expect(estimatedWinShares(snapshot, last).get(1)).toBe(100);
 expect(estimatedWinShares(snapshot, last).get(2)).toBe(0);
});
it('gives allies the same side estimate', () => {
 const point={seconds:0,armies:[{team:1,unitsSurviving:10,credits:0,income:0},{team:2,unitsSurviving:5,credits:0,income:0},{team:3,unitsSurviving:5,credits:0,income:0}]} as BattleTimelinePoint;
 const snapshot={armies:[{team:1,side:1,eliminated:false},{team:2,side:2,eliminated:false},{team:3,side:2,eliminated:false}],timeline:[point]} as MatchSnapshot;
 const shares=estimatedWinShares(snapshot,point);
 expect(shares.get(2)).toBe(shares.get(3));
 expect(shares.get(1)!+shares.get(2)!).toBeCloseTo(100);
});

it('respects one versus four allied opponents and free-for-all setups', () => {
 const point = {seconds:0,armies:Array.from({length:5},(_,i)=>({team:i+1,unitsSurviving:10,credits:1000,income:0}))} as BattleTimelinePoint;
 const snapshot = {armies:Array.from({length:5},(_,i)=>({team:i+1,side:i===0?1:2,eliminated:false})),timeline:[point]} as MatchSnapshot;
 const coalition = estimatedWinShares(snapshot,point);
 expect(coalition.get(1)).toBeCloseTo(20);
 for(let team=2;team<=5;team++) expect(coalition.get(team)).toBeCloseTo(80);
 snapshot.armies.forEach(a=>a.side=a.team);
 for(const chance of estimatedWinShares(snapshot,point).values()) expect(chance).toBeCloseTo(20);
});
