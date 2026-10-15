import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';

// The original CC0 character, materials and two locomotion clips are kept together.
// See assets/character/LICENSE.txt and provenance.json for source and AI disclosure.
export class DetailedCharacter {
  constructor(parent, renderer) {
    this.parent=parent;this.renderer=renderer;this.root=new THREE.Group();parent.add(this.root);
    this.ready=false;this.tool='foot';this.bones={};this.actions={};this.weights={idle:1,walk:0,run:0};
    this.stats={triangles:0,bones:0,textures:0,animations:[],state:'loading'};
    this.tmpA=new THREE.Vector3();this.tmpB=new THREE.Vector3();this.tmpC=new THREE.Vector3();
    this.armor=new THREE.Group();parent.add(this.armor);this.armor.visible=false;this.armorSegments=[];this.kneeCaps=[];
    const metal=new THREE.MeshStandardMaterial({color:'#b5c7bf',metalness:.58,roughness:.32});
    const accent=new THREE.MeshStandardMaterial({color:'#bed997',emissive:'#6e9d50',emissiveIntensity:.3,roughness:.6});
    for(const side of ['Left','Right']){
      for(const pair of [[side+'UpLeg',side+'Leg'],[side+'Leg',side+'Foot'],['Spine','Spine02']]){
        const rod=new THREE.Mesh(new THREE.CylinderGeometry(.025,.032,1,9),metal);rod.castShadow=true;this.armor.add(rod);this.armorSegments.push({mesh:rod,a:pair[0],b:pair[1],offset:side==='Left'?-.10:.10});
      }
      const cap=new THREE.Mesh(new THREE.SphereGeometry(.075,12,8),accent);this.armor.add(cap);this.kneeCaps.push({mesh:cap,bone:side+'Leg',offset:side==='Left'?-.1:.1});
    }
  }
  async load(progress) {
    const loader=new GLTFLoader();
    const data=globalThis.SUNSHORE_CHARACTER_DATA;
    const gltf=data?await loader.parseAsync(Uint8Array.from(atob(data),c=>c.charCodeAt(0)).buffer,''):await loader.loadAsync('./assets/character/runner.glb',e=>progress?.(e.total?e.loaded/e.total:0));
    // Normalize in model space before attaching to the moving player.
    this.model=gltf.scene;
    const textureIds=new Set();
    this.model.traverse(o=>{
      if(o.isBone)this.bones[o.name]=o;
      if(!o.isMesh)return;
      o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false;
      this.stats.triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;
      for(const material of Array.isArray(o.material)?o.material:[o.material]){
        material.side=THREE.FrontSide;material.metalness=.08;material.roughness=.96;
        for(const slot of ['map','normalMap','metalnessMap','roughnessMap'])if(material[slot]){material[slot].anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());textureIds.add(material[slot].uuid);}
      }
    });
    this.stats.bones=Object.keys(this.bones).length;this.stats.textures=textureIds.size;
    // Remove horizontal root motion: gameplay physics owns the character's location.
    const clips=gltf.animations.map(original=>{const c=original.clone();for(const t of c.tracks){if(!/Hips\.position$/.test(t.name))continue;const x=t.values[0],z=t.values[2];for(let i=0;i<t.values.length;i+=3){t.values[i]=x;t.values[i+2]=z;}}return c;});
    this.mixer=new THREE.AnimationMixer(this.model);
    const walk=clips.find(c=>/walk/i.test(c.name)),run=clips.find(c=>/run/i.test(c.name));
    if(!walk||!run)throw new Error('Character requires both walking and running clips.');
    const sample=this.mixer.clipAction(walk);sample.play();
    const sums={};for(const [name,b]of Object.entries(this.bones))sums[name]={p:new THREE.Vector3(),q:new THREE.Vector4(),ref:null};
    for(let n=0;n<12;n++){
      this.mixer.setTime(walk.duration*n/12);
      for(const [name,b]of Object.entries(this.bones)){const s=sums[name];s.p.add(b.position);if(!s.ref)s.ref=b.quaternion.clone();const sign=s.ref.dot(b.quaternion)<0?-1:1;s.q.x+=b.quaternion.x*sign;s.q.y+=b.quaternion.y*sign;s.q.z+=b.quaternion.z*sign;s.q.w+=b.quaternion.w*sign;}
    }
    this.mixer.stopAllAction();this.idlePose={};const idleTracks=[];
    for(const [name,b]of Object.entries(this.bones)){
      const sum=sums[name],p=sum.p.multiplyScalar(1/12),q=new THREE.Quaternion(sum.q.x,sum.q.y,sum.q.z,sum.q.w).normalize();
      b.position.copy(p);b.quaternion.copy(q);this.idlePose[name]={p:p.clone(),q:q.clone()};
      const breath=q.clone();if(name==='Spine02')breath.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.009));
      idleTracks.push(new THREE.VectorKeyframeTrack(name+'.position',[0,1.5,3],[...p.toArray(),...p.toArray(),...p.toArray()]));
      idleTracks.push(new THREE.QuaternionKeyframeTrack(name+'.quaternion',[0,1.5,3],[...q.toArray(),...breath.toArray(),...q.toArray()]));
    }
    const idle=new THREE.AnimationClip('idle',3,idleTracks);
    this.actions.idle=this.mixer.clipAction(idle);this.actions.walk=this.mixer.clipAction(walk);this.actions.run=this.mixer.clipAction(run);
    for(const a of Object.values(this.actions))a.play();
    this.actions.walk.weight=0;this.actions.run.weight=0;this.actions.idle.weight=1;this.mixer.update(0);
    this.model.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(this.model,true),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
    this.scale=1.86/size.y;this.model.scale.multiplyScalar(this.scale);this.model.position.set(-center.x*this.scale,-bounds.min.y*this.scale,-center.z*this.scale);this.root.add(this.model);this.root.rotation.y=Math.PI;
    this.root.updateMatrixWorld(true);this.jointScale=this.bones.Hips.getWorldScale(new THREE.Vector3()).y;
    this.animationPose=Object.values(this.bones).map(bone=>({bone,p:bone.position.clone(),q:bone.quaternion.clone()}));
    this.stats.animations=['idle','walk','run'];this.stats.state='ready';this.ready=true;this.root.visible=true;
    return this.stats;
  }
  setTool(tool){this.tool=tool;this.armor.visible=this.ready&&tool==='exoskeleton';}
  target(x,y,z){return this.parent.localToWorld(new THREE.Vector3(x,y,z));}
  aim(bone,child,target){
    const p=bone.getWorldPosition(new THREE.Vector3()),c=child.getWorldPosition(new THREE.Vector3()),a=c.sub(p).normalize(),b=target.clone().sub(p).normalize();
    if(a.lengthSq()<.5||b.lengthSq()<.5)return;
    const turn=new THREE.Quaternion().setFromUnitVectors(a,b),world=bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(turn),parent=bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    bone.quaternion.copy(parent.multiply(world));bone.updateMatrixWorld(true);
  }
  limb(upperName,lowerName,endName,target,pole){
    const upper=this.bones[upperName],lower=this.bones[lowerName],end=this.bones[endName];if(!upper||!lower||!end)return;
    const s=upper.getWorldPosition(new THREE.Vector3()),m=lower.getWorldPosition(new THREE.Vector3()),e=end.getWorldPosition(new THREE.Vector3()),l1=s.distanceTo(m),l2=m.distanceTo(e),dir=target.clone().sub(s),d=THREE.MathUtils.clamp(dir.length(),Math.abs(l1-l2)+.001,l1+l2-.001);dir.normalize();
    const a=(l1*l1-l2*l2+d*d)/(2*d),h=Math.sqrt(Math.max(0,l1*l1-a*a)),bend=pole.clone().sub(s);bend.addScaledVector(dir,-bend.dot(dir)).normalize();
    const elbow=s.clone().addScaledVector(dir,a).addScaledVector(bend,h);this.aim(upper,lower,elbow);this.aim(lower,end,target);
  }
  update(dt,player,input,time){
    if(!this.ready)return;
    // AnimationMixer skips writing unchanged tracks. Restore the last animated pose
    // before applying tool IK again so crouching never accumulates frame by frame.
    for(const pose of this.animationPose){pose.bone.position.copy(pose.p);pose.bone.quaternion.copy(pose.q);}
    const glide=player.tool==='surfboard'||player.tool==='jetski',motion=glide||!player.grounded?0:THREE.MathUtils.smoothstep(player.speed,.12,1.4),run=THREE.MathUtils.smoothstep(player.speed,3.0,7.0)*motion;
    const targets={idle:1-motion,walk:motion-run,run};
    for(const key of Object.keys(this.weights)){this.weights[key]+=(targets[key]-this.weights[key])*(1-Math.exp(-dt*9));this.actions[key].setEffectiveWeight(this.weights[key]);}
    this.actions.walk.setEffectiveTimeScale(THREE.MathUtils.clamp(player.speed/2.4,.7,2));this.actions.run.setEffectiveTimeScale(THREE.MathUtils.clamp(player.speed/6.5,.7,1.85));
    this.mixer.update(dt);for(const pose of this.animationPose){pose.p.copy(pose.bone.position);pose.q.copy(pose.bone.quaternion);}this.root.position.y=0;this.root.rotation.y=Math.PI;
    if(player.tool==='surfboard'){
      const pump=player.pump||0,carve=player.carve||0,crouch=.38+pump*.13+Math.abs(carve)*.06;
      this.root.rotation.y=Math.PI+1.02;this.root.position.y=.21;
      this.bones.Hips.position.y-=crouch/this.jointScale;
      this.bones.Spine02.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(.12+pump*.12,-.28,carve*.10)));
      this.bones.Head.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-.62));
      this.root.updateMatrixWorld(true);
      this.limb('LeftUpLeg','LeftLeg','LeftFoot',this.target(-.07,.30,-.47),this.target(-.58,.56,-.37));
      this.limb('RightUpLeg','RightLeg','RightFoot',this.target(.08,.30,.43),this.target(-.45,.55,.5));
      this.limb('LeftArm','LeftForeArm','LeftHand',this.target(-.58-carve*.12,1.04-pump*.12,-.48),this.target(-.8,1.15,-.12));
      this.limb('RightArm','RightForeArm','RightHand',this.target(.53-carve*.12,.98-pump*.12,.43),this.target(.78,1.2,.22));
      this.stats.pose=Math.abs(carve)>.2?'carving':pump>.2?'tucked':'surf-stance';
    }else if(player.tool==='jetski'){
      this.bones.Hips.position.y-=.19/this.jointScale;this.root.position.y=.10;this.root.updateMatrixWorld(true);
      for(const [side,sign]of [['Left',-1],['Right',1]]){
        this.limb(side+'UpLeg',side+'Leg',side+'Foot',this.target(sign*.28,.36,.20),this.target(sign*.38,.65,-.65));
        this.limb(side+'Arm',side+'ForeArm',side+'Hand',this.target(sign*.34,1.03,-.45),this.target(sign*.55,1.08,.30));
      }
      this.stats.pose='seated';
    }else if(!player.grounded){
      this.root.updateMatrixWorld(true);
      for(const [side,sign]of [['Left',-1],['Right',1]])this.limb(side+'UpLeg',side+'Leg',side+'Foot',this.target(sign*.18,.30,sign*.17),this.target(sign*.25,.7,-.6));
    }else this.stats.pose=player.speed>3?'running':'standing';
    this.root.updateMatrixWorld(true);
    if(this.armor.visible){
      for(const item of this.armorSegments){const a=this.parent.worldToLocal(this.bones[item.a].getWorldPosition(new THREE.Vector3())),b=this.parent.worldToLocal(this.bones[item.b].getWorldPosition(new THREE.Vector3()));a.x+=item.offset;b.x+=item.offset;const d=b.clone().sub(a);item.mesh.position.copy(a).add(b).multiplyScalar(.5);item.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.clone().normalize());item.mesh.scale.y=d.length();}
      for(const item of this.kneeCaps){item.mesh.position.copy(this.parent.worldToLocal(this.bones[item.bone].getWorldPosition(new THREE.Vector3())));item.mesh.position.x+=item.offset;}
    }
  }
}
