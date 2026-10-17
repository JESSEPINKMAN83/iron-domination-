import { nationForTeam } from '../content/nations';
const modeled:Record<string,string>={'scout-tank':'jackal',tank:'m17','siege-tank':'mauler',infantry:'rifle',sniper:'sniper',grenadier:'grenadier','rocket-infantry':'rocket',wasp:'wasp',vulture:'vulture','command-yard':'command-yard','aa-tower':'aa-tower','missile-defense':'missile-defense','skylance-ciws':'skylance-ciws','strategic-silo':'strategic-silo','intelligence-center':'intelligence-center'};
export function codeRedIconPath(kind:string,team?:number):string {
  const asset=modeled[kind];
  if(asset)return `/assets/ui/code-red/${nationForTeam(team)?.doctrine==='missile-command'?2:1}-${asset}.webp`;
  return `/assets/ui/command-icons/${kind}.png`;
}
