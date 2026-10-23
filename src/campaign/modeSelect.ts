import './story.css';
export function showSinglePlayerModes():Promise<'story'|'skirmish'|'back'> {
  return new Promise(resolve=>{
    const landing=document.getElementById('iron-landing');if(landing)landing.inert=true;
    const root=document.createElement('section');root.className='story-select';root.setAttribute('aria-label','Choose single-player mode');
    root.innerHTML=`<div class="story-select__shell"><button class="story-back" type="button">← Back</button><p class="story-eyebrow">SINGLE PLAYER</p><h1>Choose your operation</h1><p class="story-lead">A story to follow. Or a battlefield to make your own.</p><div class="story-modes"><button data-mode="story" type="button"><span class="story-card-art"></span><small>ISRAEL CAMPAIGN · CHAPTER 01</small><h2>Story mode</h2><p>Operation First Light. A quiet morning becomes a fight to protect your base. Build your missile shield, find two guarded launch cells, and end the attacks.</p><strong>Begin the story →</strong></button><button data-mode="skirmish" type="button"><span class="story-card-art story-card-art--skirmish"></span><small>YOUR RULES · YOUR STRATEGY</small><h2>Skirmish</h2><p>Choose the battlefield, armies and difficulty. Build from the ground up and fight until only your side remains.</p><strong>Set up a battle →</strong></button></div><p class="story-note">Story mode currently begins with Israel. Includes spoken transmissions, subtitles and mission objectives.</p></div>`;
    const finish=(mode:'story'|'skirmish'|'back')=>{root.remove();if(landing)landing.inert=false;resolve(mode);};
    root.querySelector<HTMLButtonElement>('.story-back')!.onclick=()=>finish('back');
    for(const mode of ['story','skirmish'] as const)root.querySelector<HTMLButtonElement>(`[data-mode="${mode}"]`)!.onclick=()=>finish(mode);
    document.body.append(root);root.querySelector<HTMLButtonElement>('[data-mode="story"]')!.focus();
  });
}
