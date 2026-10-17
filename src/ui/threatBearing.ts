/** World north is -Z, independent of the camera heading. */
export function threatBearing(fromX: number, fromZ: number, toX: number, toZ: number): string {
  const dx=fromX-toX,dz=fromZ-toZ;
  if (Math.hypot(dx,dz)<1) return 'OVERHEAD';
  const directions=['NORTH','NORTHEAST','EAST','SOUTHEAST','SOUTH','SOUTHWEST','WEST','NORTHWEST'];
  const angle=Math.atan2(dx,-dz);
  return directions[(Math.round(angle/(Math.PI/4))+8)%8];
}
