import { expect,it } from 'vitest';
import { baseLayoutPreference } from './baseLayout';
it('separates rear power from forward defense and production flanks',()=>{
 expect(baseLayoutPreference('power-plant','balanced','hard').angle).not.toBe(baseLayoutPreference('factory','balanced','hard').angle);
 expect(baseLayoutPreference('guard-tower','balanced','hard').angle).toBe(0);
});
it('gives advanced armies more clearance and personality-specific deployment depth',()=>{
 expect(baseLayoutPreference('factory','balanced','extra-hard').gap).toBeGreaterThan(baseLayoutPreference('factory','balanced','easy').gap);
 expect(baseLayoutPreference('guard-tower','turtle','hard').radius).toBeGreaterThan(baseLayoutPreference('guard-tower','rusher','hard').radius);
});
