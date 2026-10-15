import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three.module.min.js';
import { DetailedCharacter } from '../character.js';

// Exercise the shipped mesh, skeleton and animation clips without a GPU.
// Only material images are omitted from this headless copy.
const source=readFileSync(new URL('../assets/character/runner.glb',import.meta.url));
assert.equal(source.readUInt32LE(0),0x46546c67);
const jsonLength=source.readUInt32LE(12),asset=JSON.parse(source.subarray(20,20+jsonLength));
assert.equal(asset.skins[0].joints.length,54);
assert.deepEqual(asset.animations.map(a=>a.name),['walk','run']);
assert.ok(asset.materials[0].normalTexture);
assert.ok(asset.materials[0].pbrMetallicRoughness.baseColorTexture);
asset.materials=[{pbrMetallicRoughness:{baseColorFactor:[.6,.6,.6,1]}}];
delete asset.images;delete asset.textures;delete asset.samplers;
let json=Buffer.from(JSON.stringify(asset));
json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
const binary=source.subarray(20+jsonLength),header=Buffer.alloc(20);
header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);
header.writeUInt32LE(20+json.length+binary.length,8);
header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);
globalThis.SUNSHORE_CHARACTER_DATA=Buffer.concat([header,json,binary]).toString('base64');
const parent=new THREE.Group();parent.position.set(-9,1.217,25);
const character=new DetailedCharacter(parent,{capabilities:{getMaxAnisotropy:()=>1}});
await character.load();delete globalThis.SUNSHORE_CHARACTER_DATA;
parent.updateMatrixWorld(true);
const bounds=new THREE.Box3().setFromObject(character.model,true),center=bounds.getCenter(new THREE.Vector3());
assert.ok(Math.abs(bounds.getSize(new THREE.Vector3()).y-1.86)<.01,'Model height must be independent of the player position.');
assert.ok(Math.hypot(center.x-parent.position.x,center.z-parent.position.z)<.1,`Character must stay centered on the player: center=${center.toArray()}, player=${parent.position.toArray()}, scale=${character.scale}.`);
parent.rotation.y=.6;parent.updateMatrixWorld(true);
const player={tool:'foot',speed:0,grounded:true};
const hip=()=>character.bones.Hips.getWorldPosition(new THREE.Vector3());
const feet=()=>['LeftFoot','RightFoot'].map(name=>character.bones[name].getWorldPosition(new THREE.Vector3()));
for(const tool of ['surfboard','jetski','surfboard','foot','exoskeleton']){
  player.tool=tool;character.setTool(tool);
  for(let i=0;i<120;i++)character.update(1/60,player,{},i/60);
  const before=hip(),beforeFeet=feet();
  for(let i=0;i<1800;i++)character.update(1/60,player,{},(i+120)/60);
  assert.ok(hip().distanceTo(before)<.002,`${tool}: hips must not sink over 30 seconds.`);
  feet().forEach((p,i)=>assert.ok(p.distanceTo(beforeFeet[i])<.01,`${tool}: tool poses must not accumulate.`));
  assert.ok(hip().y>parent.position.y+.5,`${tool}: torso must remain above the surface.`);
}
player.tool='foot';player.speed=8;
const samples=[];
for(let i=0;i<90;i++){character.update(1/60,player,{},i/60);samples.push(character.bones.LeftLeg.quaternion.clone());}
assert.ok(samples.some(q=>q.angleTo(samples[0])>.2),'Running clip must animate the legs.');
console.log('PASS: real 54-bone asset, centered model, 5 tool transitions, 30-second posture stability per tool, and running animation.');
