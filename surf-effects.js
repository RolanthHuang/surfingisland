import * as THREE from './vendor/three.module.min.js';
import { swellAt } from './island.js?v=2.0.1';

export class SurfEffects {
  constructor(scene){
    this.history=[];this.clock=0;this.sprayClock=0;this.cursor=0;this.previousGrounded=true;
    this.count=100;this.particles=Array.from({length:180},()=>({life:0}));
    this.dummy=new THREE.Object3D();this.color=new THREE.Color();this.stats={wake:0,spray:0};
    this.ribbons=[-1,1].map(side=>{
      const geometry=new THREE.BufferGeometry(),position=new THREE.Float32BufferAttribute(new Float32Array(this.count*6),3);
      geometry.setAttribute('position',position);geometry.setAttribute('aFade',new THREE.Float32BufferAttribute(new Float32Array(this.count*2),1));
      geometry.setAttribute('aEdge',new THREE.Float32BufferAttribute(new Float32Array(this.count*2),1));
      const indices=[];for(let i=0;i<this.count-1;i++){const a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}geometry.setIndex(indices);
      const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,
        vertexShader:'attribute float aFade;attribute float aEdge;varying float vFade;varying float vEdge;varying vec3 vWorld;void main(){vFade=aFade;vEdge=aEdge;vec4 p=modelMatrix*vec4(position,1.);vWorld=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}',
        fragmentShader:`varying float vFade;varying float vEdge;varying vec3 vWorld;
        void main(){float grain=.72+.28*sin(vWorld.x*29.+sin(vWorld.z*21.));float edge=pow(max(0.,sin(vEdge*3.14159265)),.6);gl_FragColor=vec4(vec3(.89,1.,.97),vFade*edge*grain*.76);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`});
      const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.renderOrder=4;scene.add(mesh);return{side,mesh,geometry,position};
    });
    const pixels=new Uint8Array(32*32*4);for(let y=0;y<32;y++)for(let x=0;x<32;x++){const i=(y*32+x)*4,r=Math.hypot((x-15.5)/15.5,(y-15.5)/15.5);pixels[i]=pixels[i+1]=pixels[i+2]=255;pixels[i+3]=Math.round(Math.pow(Math.max(0,1-r),.6)*255);}
    const texture=new THREE.DataTexture(pixels,32,32);texture.needsUpdate=true;
    this.spray=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:texture,color:'#edfffa',transparent:true,opacity:.83,depthWrite:false,side:THREE.DoubleSide}),this.particles.length);
    this.spray.frustumCulled=false;this.spray.renderOrder=5;scene.add(this.spray);
  }
  clear(){this.history.length=0;for(const p of this.particles)p.life=0;}
  burst(player,amount=10){
    const yaw=player.facing,sin=Math.sin(yaw),cos=Math.cos(yaw),carve=player.carve||0;
    for(let i=0;i<amount;i++){
      const p=this.particles[this.cursor++%this.particles.length],side=Math.abs(carve)>.15?-Math.sign(carve):(i%2?1:-1);
      const power=1+Math.abs(carve)*1.8+(player.boosting?.6:0);
      Object.assign(p,{life:.45+Math.random()*.45,maxLife:.9,x:player.x+sin*.8+cos*side*.3,y:player.y+.19,z:player.z+cos*.8-sin*side*.3,
        vx:cos*side*(1.2+Math.random()*power*2)+sin*player.speed*.15,
        vz:-sin*side*(1.2+Math.random()*power*2)+cos*player.speed*.15,vy:1.3+Math.random()*power*1.35,size:.035+Math.random()*.065});
    }
  }
  update(dt,player,env,camera){
    const riding=player.water&&(player.tool==='surfboard'||player.tool==='jetski'),active=riding&&player.grounded&&player.speed>2;
    this.clock+=dt;this.sprayClock+=dt;
    if(active&&this.clock>.035){
      this.clock=0;const sin=Math.sin(player.facing),cos=Math.cos(player.facing);
      this.history.unshift({x:player.x+sin*.85,z:player.z+cos*.85,yaw:player.facing,time:env.time,power:Math.min(1,player.speed/12),carve:Math.abs(player.carve||0)});
      if(this.history.length>this.count)this.history.pop();
    }
    if(active&&this.sprayClock>.045){this.sprayClock=0;this.burst(player,2+Math.round(Math.abs(player.carve||0)*4)+(player.boosting?2:0));}
    if(riding&&!this.previousGrounded&&player.grounded)this.burst(player,50);
    this.previousGrounded=player.grounded;
    this.history=this.history.filter(p=>env.time-p.time<4.2);
    for(const ribbon of this.ribbons){
      const fades=ribbon.geometry.attributes.aFade,edges=ribbon.geometry.attributes.aEdge;
      for(let i=0;i<this.count;i++){
        const p=this.history[Math.min(i,this.history.length-1)],age=p?(env.time-p.time)/4.2:1;
        const width=.13+age*.75+(p?.carve||0)*.28,offset=ribbon.side*(.27+age*1.15),c=p?Math.cos(p.yaw):0,s=p?Math.sin(p.yaw):0;
        for(let edge=0;edge<2;edge++){
          const d=offset+(edge?1:-1)*width*.5,x=p?p.x+c*d:0,z=p?p.z-s*d:0;
          ribbon.position.setXYZ(i*2+edge,x,swellAt(x,z,env.time,env.weather).height+.035,z);
          fades.setX(i*2+edge,p&&i<this.history.length?Math.pow(1-age,1.5)*p.power:0);edges.setX(i*2+edge,edge);
        }
      }
      ribbon.position.needsUpdate=true;fades.needsUpdate=true;edges.needsUpdate=true;
    }
    let alive=0;
    for(let i=0;i<this.particles.length;i++){
      const p=this.particles[i];p.life=Math.max(0,p.life-dt);
      if(p.life>0){p.vy-=6*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;alive++;
        this.dummy.position.set(p.x,p.y,p.z);this.dummy.quaternion.copy(camera.quaternion);
        this.dummy.scale.setScalar(p.size*Math.min(1,p.life*5));
      }else this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();this.spray.setMatrixAt(i,this.dummy.matrix);
    }
    this.spray.instanceMatrix.needsUpdate=true;this.stats.wake=this.history.length;this.stats.spray=alive;
  }
}
