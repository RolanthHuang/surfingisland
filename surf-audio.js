// Locally synthesized surf: no recordings, requests, or microphone permission.
export class SurfAudio {
  constructor(){this.enabled=true;this.ready=false;}
  start(){
    if(this.ready){this.context.resume();return;}
    const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Audio)return;
    try{
      this.context=new Audio();const buffer=this.context.createBuffer(1,this.context.sampleRate*3,this.context.sampleRate),data=buffer.getChannelData(0);
      let brown=0;for(let i=0;i<data.length;i++){brown=(brown+(Math.random()*2-1)*.025)/1.025;data[i]=brown*5+(Math.random()*2-1)*.09;}
      const source=this.context.createBufferSource();source.buffer=buffer;source.loop=true;
      this.filter=this.context.createBiquadFilter();this.filter.type='lowpass';this.filter.frequency.value=600;
      this.gain=this.context.createGain();this.gain.gain.value=0;this.pan=this.context.createStereoPanner();
      source.connect(this.filter).connect(this.gain).connect(this.pan).connect(this.context.destination);source.start();
      this.context.resume();this.ready=true;
    }catch{this.ready=false;}
  }
  update(player,time,paused){
    if(!this.ready)return;const t=this.context.currentTime,active=this.enabled&&!paused;
    const ride=player.water&&player.tool==='surfboard',speed=Math.min(1,player.speed/20),carve=Math.abs(player.carve||0);
    const level=active?(.025+Math.sin(time*.45)**2*.012+(ride?.10*speed+.07*carve+(player.landing||0)*.16:0))*(player.grounded?1:.38):0;
    this.gain.gain.setTargetAtTime(level,t,.09);this.filter.frequency.setTargetAtTime(500+speed*1500+carve*1300,t,.12);this.pan.pan.setTargetAtTime((player.carve||0)*.4,t,.12);
  }
}
