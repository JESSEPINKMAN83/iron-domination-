import { CAMPAIGN_BRIEFING_AUDIO, CAMPAIGN_SHIELD_AUDIO, CAMPAIGN_SCRIPT, campaignTargetsAlive, campaignShieldOnline, type CampaignState } from './firstLight';
import type { EconomyState } from '../sim/economy';
import type { GameSim } from '../sim/world';
import './story.css';
import { draggableCard } from './draggableCard';

export class CampaignHud {
  private readonly root=document.createElement('aside');
  private readonly transmission=document.createElement('aside');
  private readonly audio=new Audio();
  private readonly startGate=document.createElement('section');
  private briefingPending=false;
  private stopped=false;
  private readonly dragCleanup:Array<()=>void>=[];
  private transmissionDragCleanup?:()=>void;
  get awaitingBriefingStart():boolean {return this.briefingPending;}
  private readonly phase=document.createElement('small');
  private readonly tasks:HTMLLIElement[]=[];
  private readonly buildHint=document.createElement('p');
  private readonly placementHint=document.createElement('aside');
  private defenseCueReached=false;
  get defensePromptActive():boolean {return this.defenseCueReached||this.state.phase==='attack';}
  private lastPhase='';private shieldAnnounced=false;
  constructor(private readonly sim:GameSim,private readonly state:CampaignState,private readonly economy:EconomyState,focus:(site:number)=>void,private readonly defense:()=>void) {
    this.root.className='campaign-hud';this.root.setAttribute('aria-label','Story mission objectives');
    const title=document.createElement('h2');title.textContent='Operation First Light';this.root.append(this.phase,title);
    const list=document.createElement('ul');
    for(let i=0;i<4;i++){const li=document.createElement('li');this.tasks.push(li);list.append(li);}this.root.append(list);
    this.buildHint.className='campaign-build-hint';this.buildHint.setAttribute('role','status');this.root.append(this.buildHint);
    this.placementHint.className='campaign-placement-hint';this.placementHint.setAttribute('role','status');this.placementHint.hidden=true;document.body.append(this.placementHint);
    for(const [label,index] of [['Base',-1],['Search Alpha',0],['Search Bravo',1]] as const){const b=document.createElement('button');b.textContent=label;if(index>=0)b.dataset.search='true';b.onclick=()=>focus(index);this.root.append(b);}
    const defenseButton=document.createElement('button');defenseButton.textContent='Build Iron Dome →';defenseButton.dataset.defensePrompt='true';defenseButton.onclick=()=>this.defense();this.root.append(defenseButton);
    this.transmission.className='campaign-transmission';this.transmission.setAttribute('aria-label','Campaign radio transmission');
    for(const node of [this.root,this.transmission])for(const event of ['pointerdown','pointerup','click','wheel'])node.addEventListener(event,e=>e.stopPropagation());
    document.body.append(this.root,this.transmission);
    this.dragCleanup.push(draggableCard(this.root,title));
    this.audio.volume=.55;
    this.audio.preload='auto';
    this.briefingPending=this.state.phase==='quiet';
    this.startGate.className='campaign-start-gate';this.startGate.hidden=true;
    this.startGate.setAttribute('role','dialog');this.startGate.setAttribute('aria-modal','true');this.startGate.setAttribute('aria-label','Begin Operation First Light');
    this.startGate.innerHTML='<div><small>ISRAEL CAMPAIGN · CHAPTER 01</small><h2>Operation First Light</h2><p>Your base is ready. Begin the mission to hear Yael’s briefing.</p><button type="button">Begin mission →</button></div>';
    for(const event of ['pointerdown','pointerup','click','keydown','keyup','wheel'])this.startGate.addEventListener(event,e=>e.stopPropagation());
    this.startGate.querySelector('button')!.onclick=()=>{this.startGate.hidden=true;this.startVoice();};
    document.body.append(this.startGate);
    // Cue follows the supplied recording, including replay and delayed playback.
    this.audio.addEventListener('timeupdate',()=>{if(this.audio.src.endsWith(CAMPAIGN_BRIEFING_AUDIO)&&this.audio.currentTime>=12){this.defenseCueReached=true;this.update();}});
    this.audio.addEventListener('ended',()=>{const s=this.transmission.querySelector('[data-audio-state]');if(s)s.textContent='TRANSMISSION COMPLETE · SUBTITLES AVAILABLE';});
    this.audio.addEventListener('error',()=>{const s=this.transmission.querySelector('[data-audio-state]');if(s)s.textContent='SUBTITLES · AUDIO UNAVAILABLE';});
    this.update();
  }
  private startVoice():void {
    const status=()=>this.transmission.querySelector('[data-audio-state]');
    const setStatus=(text:string)=>{const node=status();if(node)node.textContent=text;};
    this.audio.currentTime=0;
    setStatus('TRANSMISSION LIVE');
    void this.audio.play().then(()=>{
      if(this.stopped){this.audio.pause();return;}
      this.briefingPending=false;this.startGate.hidden=true;
    }).catch((error:unknown)=>{
      if(this.stopped)return;
      if(error instanceof DOMException&&error.name==='NotAllowedError'&&this.briefingPending){
        // A fresh direct link has no user gesture. Keep the mission clock at dawn
        // until this explicit click starts audio, rather than silently losing the briefing.
        this.startGate.hidden=false;
        this.startGate.querySelector('button')!.focus();
        setStatus('READY TO BEGIN · VOICE AND SUBTITLES');
      }else{
        this.briefingPending=false;
        setStatus('SUBTITLES · AUDIO UNAVAILABLE');
      }
    });
  }
  private transmit(key:keyof typeof CAMPAIGN_SCRIPT):void {
    const script=CAMPAIGN_SCRIPT[key];const hasVoice=key!=='victory';this.transmission.hidden=false;this.transmissionDragCleanup?.();this.transmission.replaceChildren();
    const header=document.createElement('header'),title=document.createElement('strong'),close=document.createElement('button');title.textContent=`YAEL · ${script.title}`;close.textContent='×';close.setAttribute('aria-label','Dismiss transmission and stop narration');close.onclick=()=>{this.audio.pause();this.transmission.hidden=true;};const portrait=document.createElement('img');portrait.src='/assets/audio/campaign/yael-portrait.png';portrait.alt='Lieutenant Yael';portrait.className='campaign-yael-portrait';portrait.draggable=false;
    header.append(portrait,title,close);this.transmissionDragCleanup=draggableCard(this.transmission,header);
    const text=document.createElement('p');text.textContent=script.text;
    const footer=document.createElement('footer'),replay=document.createElement('button'),mute=document.createElement('button'),status=document.createElement('span');status.dataset.audioState='';replay.textContent='Replay voice';mute.textContent=this.audio.muted?'Unmute voice':'Mute voice';
    const play=()=>this.startVoice();
    replay.hidden=!hasVoice;mute.hidden=!hasVoice;
    replay.onclick=play;mute.onclick=()=>{this.audio.muted=!this.audio.muted;mute.textContent=this.audio.muted?'Unmute voice':'Mute voice';};footer.append(replay,mute,status);this.transmission.append(header,text,footer);
    if (hasVoice) {
      const source=key==='shield'?CAMPAIGN_SHIELD_AUDIO:CAMPAIGN_BRIEFING_AUDIO;
      if (!this.audio.src.endsWith(source)) this.audio.src=source;
      // The first strike can arrive during the briefing; keep the supplied recording playing.
      if (key==='quiet'||key==='shield') play();
      else status.textContent=this.audio.ended?'BRIEFING COMPLETE · REPLAY AVAILABLE':this.audio.paused?'REPLAY BRIEFING AVAILABLE':'TRANSMISSION LIVE';
    } else status.textContent='FIELD UPDATE · TEXT ONLY';
  }
  update():void {
    const alive=campaignTargetsAlive(this.sim,this.state),shield=campaignShieldOnline(this.sim,this.economy);
    this.phase.textContent=this.state.phase==='quiet'?'CHAPTER 01 · DAWN WATCH':this.state.phase==='attack'?'CHAPTER 01 · CODE RED':this.state.phase==='victory'?'MISSION COMPLETE':'MISSION FAILED';
    for(const button of Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-search]')))button.disabled=this.state.phase==='quiet';
    const dome=Array.from(this.sim.world.entities).find(e=>!e.destroyed&&e.team?.id===this.economy.team&&e.building?.kind==='aa-tower');
    const guiding=this.defensePromptActive&&this.state.phase!=='victory'&&this.state.phase!=='defeat'&&!shield;
    const placing=this.economy.selectedStructure==='aa-tower';
    const ready=this.economy.readyDefenseStructure==='aa-tower';
    const building=this.economy.defenseStructureLine?.kind==='aa-tower';
    const hint=dome?'Iron Dome placed. Keep it powered to activate protection.':placing?'Click clear ground inside your base to place Iron Dome. Green footprint = valid location.':ready?'Iron Dome is ready. Click its highlighted card, then choose a place on the ground.':building?'Iron Dome is preparing. When ready, click its card and place it on clear ground.':'Click the highlighted Iron Dome card in Defense to begin building your missile shield.';
    this.buildHint.hidden=!guiding;
    if(this.buildHint.textContent!==hint)this.buildHint.textContent=hint;
    this.placementHint.hidden=!guiding||!placing;
    if(placing)this.placementHint.textContent='PLACE IRON DOME · Click green ground in your base · Right-click to cancel';
    this.root.querySelector<HTMLButtonElement>('[data-defense-prompt]')!.hidden=!guiding||!!dome;
    const texts=this.state.phase==='quiet'?['◇ Protect Command HQ','◇ Review your base and production lines','◇ No hostile launches detected','◇ Stand by for field command']:[`${this.state.phase==='defeat'?'×':'◇'} Protect Command HQ`,`${shield?'✓':'○'} Build and power an Iron Dome battery`,...this.state.targetIds.map((id,i)=>`${alive.some(e=>e.id===id)?'○':'✓'} Destroy launch cell ${i?'Bravo':'Alpha'}`)];
    texts.forEach((text,i)=>{if(this.tasks[i].textContent!==text)this.tasks[i].textContent=text;this.tasks[i].dataset.done=String(i===1?shield:i>1?!alive.some(e=>e.id===this.state.targetIds[i-2]):this.state.phase==='victory');});
    if(this.lastPhase!==this.state.phase){this.lastPhase=this.state.phase;if(this.state.phase!=='defeat')this.transmit(this.state.phase==='attack'?'attack':this.state.phase==='victory'?'victory':'quiet');}
    if(shield&&!this.shieldAnnounced&&this.state.phase==='attack'&&(this.audio.ended||this.audio.paused)){this.shieldAnnounced=true;this.transmit('shield');}
  }
  stop():void {this.stopped=true;for(const cleanup of this.dragCleanup)cleanup();this.transmissionDragCleanup?.();this.startGate.remove();this.audio.pause();this.root.remove();this.transmission.remove();this.placementHint.remove();}
}
