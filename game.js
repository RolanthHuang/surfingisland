import * as THREE from './vendor/three.module.min.js';
import { DetailedCharacter } from './character.js';
import { LIMIT, ZONES, PALMS, OBSTACLES, TOOLS, terrainClass, recommendedTool, makeTerrainTracker, advanceTerrainTracker, clamp, smooth, seeded, terrainHeight, floorAt, isWater, currentAt, windAt, boundaryWeight, makePlayer, stepPlayer, comboKey } from './island.js';

const $ = id => document.getElementById(id);
const canvas = $('world');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (error) {
  $('loadingDetail').textContent = '此瀏覽器未能啟用 3D 繪圖，請開啟硬體加速後重新整理。';
  $('loading').querySelector('span').textContent = '小島需要 WebGL 2';
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, matchMedia('(pointer: coarse)').matches ? 1.35 : 1.65));
renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.03;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#c5e5df');
scene.fog = new THREE.Fog('#c5e5df', 90, 255);
const camera = new THREE.PerspectiveCamera(53, canvas.clientWidth / canvas.clientHeight, .12, 1100);
const skyColor = new THREE.Color('#c5e5df');
const hemisphere = new THREE.HemisphereLight('#ecf5ed', '#92a782', 2.1); scene.add(hemisphere);
const sun = new THREE.DirectionalLight('#fff0c8', 3.0);
sun.position.set(-38, 78, -42); scene.add(sun);
sun.castShadow = true;scene.add(sun.target);
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -75, right: 75, top: 67, bottom: -67, near: 1, far: 180 });
sun.shadow.normalBias = .045; sun.shadow.bias = -.00025;
const fillLight = new THREE.DirectionalLight('#ceefe5', .6); fillLight.position.set(45, 18, 35); scene.add(fillLight);
const rng = seeded(718);
const mat = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: .88, ...options });
const materials = {
  sand: mat('#e7c993'), wood: mat('#987151'), woodLight: mat('#c49c71'), rock: mat('#7d9892', { flatShading: true }),
  rockLight: mat('#a1b3a2', { flatShading: true }), white: mat('#fff7d9'), coral: mat('#d77956'), teal: mat('#4e8e7c'),
  dark: mat('#345854'), skin: mat('#daae83'), hair: mat('#3d453b'), leaf: mat('#5e9560', { side: THREE.DoubleSide, vertexColors: true }),
  gold: mat('#dab764'), rope: mat('#c1aa7f'), grass: mat('#8cae68'), skinShade: mat('#c89970')
};
function mesh(geo, material, x = 0, y = 0, z = 0, parent = scene, shadow = true) {
  const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m;
}
const boxGeo = new THREE.BoxGeometry(1, 1, 1), sphereGeo = new THREE.SphereGeometry(1, 12, 8), rockGeo = new THREE.IcosahedronGeometry(1, 1);
function box(w, h, d, material, x, y, z, parent = scene) { const b = mesh(boxGeo, material, x, y, z, parent); b.scale.set(w, h, d); return b; }
function sphere(r, material, x, y, z, parent = scene) { const s = mesh(sphereGeo, material, x, y, z, parent); s.scale.setScalar(r); return s; }
function lineBetween(a, b, radius, material, parent = scene) {
  const dir = new THREE.Vector3().subVectors(b, a), m = mesh(new THREE.CylinderGeometry(radius, radius, dir.length(), 6), material, 0, 0, 0, parent);
  m.position.copy(a).add(b).multiplyScalar(.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()); return m;
}
function textureFromCanvas(width, height, draw) {
  const c = document.createElement('canvas'); c.width = width; c.height = height; draw(c.getContext('2d'), c);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// A continuous terrain also provides the exact walkable shoreline used by the runner.
const terrainGeo = new THREE.PlaneGeometry(240, 210, 240, 210); terrainGeo.rotateX(-Math.PI / 2);
const vertices = terrainGeo.attributes.position, terrainColors = [];
const sandColor = new THREE.Color('#ead3a2'), wetColor = new THREE.Color('#b4cfb2'), grassColor = new THREE.Color('#9eb87a'), deepSand = new THREE.Color('#75b8a9');
const tmpColor = new THREE.Color();
for (let i = 0; i < vertices.count; i++) {
  const x = vertices.getX(i), z = vertices.getZ(i), h = terrainHeight(x, z); vertices.setY(i, h);
  tmpColor.copy(h < .12 ? deepSand : sandColor);
  if (h < .4 && h > -.8) tmpColor.lerp(wetColor, .45 * (1 - Math.abs(h) / .8));
  if (h > 1.5) tmpColor.lerp(grassColor, smooth((h - 1.5) / .9) * .83);
  tmpColor.multiplyScalar(.96 + rng() * .075); terrainColors.push(tmpColor.r, tmpColor.g, tmpColor.b);
}
terrainGeo.setAttribute('color', new THREE.Float32BufferAttribute(terrainColors, 3)); terrainGeo.computeVertexNormals();
const terrain = mesh(terrainGeo, mat('#ffffff', { vertexColors: true, roughness: 1 }), 0, 0, 0, scene, false);

const waterMaterial = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uTime: { value: 0 }, uStorm: { value: 0 }, uWind: { value: new THREE.Vector2(.7, -.7) }, uReverse: { value: 1 }, uSky: { value: skyColor.clone() } },
  vertexShader: `varying vec3 vWorld; uniform float uTime; uniform float uStorm;
  void main(){vec3 p=position; p.z+=sin(p.x*.12+uTime*1.3)*cos(p.y*.15-uTime*.7)*(.025+.045*uStorm); vec4 wp=modelMatrix*vec4(p,1.);vWorld=wp.xyz;gl_Position=projectionMatrix*viewMatrix*wp;}`,
  fragmentShader: `varying vec3 vWorld; uniform float uTime; uniform float uStorm; uniform vec2 uWind; uniform float uReverse; uniform vec3 uSky;
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float shoreline(vec2 p){vec2 q=vec2((p.x+4.)/49.,(p.y+1.)/36.);float a=atan(q.y,q.x);float r=length(q)*(1.+.045*sin(5.*a)+.025*cos(3.*a));float h=clamp((1.-r)*10.,-3.7,1.25);float l=length(vec2((p.x-10.)/17.,(p.y+3.)/12.));h=min(h,(l-1.)*7.);if(p.x>12.)h=min(h,(abs(p.y+3.)-5.5)*.58+max(0.,15.-p.x)*.18);return h;}
  void main(){vec2 p=vWorld.xz;float t=uTime;float depth=max(.0,-shoreline(p));float shallow=exp(-depth*.62);
  vec3 col=mix(vec3(.035,.39,.48),vec3(.23,.72,.62),shallow);
  float swell=sin(p.x*.34+p.y*.23-t*.8)+sin(p.x*.18-p.y*.39+t*.65); col+=swell*.012;
  vec2 flow=vec2(.9,-.25); if(p.x>44.)flow=vec2(.16,-.98);if(p.y< -33.)flow=vec2(-.96,.16);flow*=uReverse;
  float wave=sin(p.x*.57+p.y*.9-dot(flow,p)*.65+t*(1.+uStorm*.65));float w2=sin(p.x*.9-p.y*.44+t*.58);
  float lines=pow(max(0.,wave*w2),19.)*(.025+uStorm*.04);col+=vec3(.8,.95,.84)*lines;
  float foam=(1.-smoothstep(.12,1.0,depth))*smoothstep(.65,.96,sin(depth*12.-t*1.9+swell*.5))*.45;
  col=mix(col,vec3(.77,.92,.78),foam);
  vec2 glitter=floor(p*3.+vec2(t*.08,0.));float glint=step(.992,hash(glitter))*pow(max(0.,sin(t*2.5+hash(glitter)*60.)),9.);
  col+=glint*vec3(.7,.79,.58)*(.6+uStorm*.25);
  float camDist=distance(cameraPosition.xz,p);float haze=smoothstep(105.,340.,camDist);col=mix(col,uSky,haze*.9);
  gl_FragColor=vec4(col,mix(.96,.88,shallow));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  }`
});
const water = mesh(new THREE.PlaneGeometry(1400, 1400, 110, 110), waterMaterial, 0, .075, 0, scene, false); water.rotation.x = -Math.PI / 2; water.renderOrder = 2;

// A soft sky, low cloud banks, and distant unplayable silhouettes establish scale.
const sky = mesh(new THREE.SphereGeometry(650, 24, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
  uniforms: { top: { value: new THREE.Color('#8fc9d4') }, horizon: { value: skyColor } },
  vertexShader: 'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: 'varying vec3 vP;uniform vec3 top;uniform vec3 horizon;void main(){float h=pow(max(0.,normalize(vP).y),.65);gl_FragColor=vec4(mix(horizon,top,h),1.);#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'
}), 0, 0, 0, scene, false);
// Shader preprocessor directives must start on their own line.
sky.material.fragmentShader = sky.material.fragmentShader.replace(';#include', ';\n#include');
const sunDisk = mesh(new THREE.SphereGeometry(11, 24, 16), new THREE.MeshBasicMaterial({ color: '#fff7d3', fog: false }), -155, 155, -235, scene, false);
const glowTex = textureFromCanvas(128, 128, ctx => { const g = ctx.createRadialGradient(64,64,4,64,64,64);g.addColorStop(0,'rgba(255,247,197,.6)');g.addColorStop(.25,'rgba(255,247,197,.18)');g.addColorStop(1,'rgba(255,247,197,0)');ctx.fillStyle=g;ctx.fillRect(0,0,128,128); });
const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, fog: false })); glow.position.copy(sunDisk.position); glow.scale.set(100, 100, 1);scene.add(glow);
const cloudMaterial = mat('#edf3dd', { roughness: 1, transparent: true, opacity: .86 });
const clouds = [];
for (let i = 0; i < 13; i++) {
  const group = new THREE.Group(), a = i / 13 * Math.PI * 2; group.position.set(Math.cos(a)*205, 38+rng()*22, Math.sin(a)*205);scene.add(group);
  for (let j=0;j<4;j++){const c=sphere(1,cloudMaterial,j*7-10,rng()*3,0,group);c.scale.set(9+rng()*5,3+rng()*3,5+rng()*4);c.castShadow=false;}
  clouds.push(group);
}
for (const [x,z,s] of [[-180,-190,1], [190,-185,.85], [-205,110,.7]]) {
  const m=mesh(new THREE.IcosahedronGeometry(1,1),mat('#79a7a0',{flatShading:true}),x,-2,z,scene,false);m.scale.set(45*s,21*s,28*s);
  const a=mesh(new THREE.IcosahedronGeometry(1,0),mat('#a1bfa5',{flatShading:true}),x+20*s,5*s,z+2*s,scene,false);a.scale.set(24*s,12*s,22*s);
}

// Shared palm fronds: one draw per crown, with a shaped central vein and tapered blades.
function frondGeometry() {
  const pos=[],col=[]; const c1=new THREE.Color('#568b54'),c2=new THREE.Color('#86a85e');
  function vert(v,c){pos.push(...v);col.push(c.r,c.g,c.b);}
  for(let leaf=0;leaf<9;leaf++){
    const a=leaf/9*Math.PI*2+.1*Math.sin(leaf*17),len=3.25+.6*Math.sin(leaf*5.2),ca=Math.cos(a),sa=Math.sin(a);
    const point=(t,s)=>{const r=t*len,w=Math.pow(Math.sin(t*Math.PI),.7)*.47;return [ca*r-sa*w*s,Math.sin(t*Math.PI)*.66-1.75*t*t-Math.abs(s)*.1,sa*r+ca*w*s];};
    for(let j=0;j<9;j++){let t=j/9,u=(j+1)/9;
      for(const side of [-1,1]){const shade=side<0?c1:c2;vert(point(t,0),c2);vert(point(u,side),shade);vert(point(t,side),shade);vert(point(t,0),c2);vert(point(u,0),c2);vert(point(u,side),shade);}
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.computeVertexNormals();return g;
}
const frondGeo=frondGeometry();
const barkTex=textureFromCanvas(64,256,ctx=>{ctx.fillStyle='#b69b73';ctx.fillRect(0,0,64,256);for(let y=0;y<256;y+=21){ctx.fillStyle='#8e795a';ctx.fillRect(0,y,64,3);ctx.fillStyle='#d3bb8b';ctx.fillRect(0,y+4,64,2);}});
barkTex.wrapS=THREE.RepeatWrapping;barkTex.wrapT=THREE.RepeatWrapping;barkTex.repeat.set(1,2);
const barkMaterial=mat('#e5d1ac',{map:barkTex});
const palmCrowns=[];
for(const p of PALMS){
  const y=terrainHeight(p.x,p.z),dx=Math.cos(p.angle)*p.lean,dz=Math.sin(p.angle)*p.lean;
  const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(0,0,0),new THREE.Vector3(dx*.15,p.h*.45,dz*.15),new THREE.Vector3(dx,p.h,dz)]);
  mesh(new THREE.TubeGeometry(curve,7,.22,6,false),barkMaterial,p.x,y,p.z);
  const crown=new THREE.Group();crown.position.set(p.x+dx,y+p.h,p.z+dz);crown.rotation.y=p.angle;scene.add(crown);
  const leaf=mesh(frondGeo,materials.leaf,0,0,0,crown);leaf.scale.setScalar(.82+p.h*.035);
  for(let j=0;j<3;j++){const a=j*2.1;sphere(.22,mat('#7e8550'),Math.cos(a)*.25,-.15,Math.sin(a)*.25,crown);}
  palmCrowns.push({group:crown,phase:p.angle});
}
// Low vegetation is instanced, so dense detail remains inexpensive.
const shrubMat=mat('#9caf71',{flatShading:true}), shrubs=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),shrubMat,75);
const dummy=new THREE.Object3D();
for(let i=0;i<75;i++){
  const a=rng()*Math.PI*2,r=rng()*15,x=-22+Math.cos(a)*r,z=-7+Math.sin(a)*r;
  dummy.position.set(x,terrainHeight(x,z)+.24,z);dummy.scale.set(.4+rng()*.7,.4+rng()*.5,.4+rng()*.7);dummy.rotation.set(0,rng()*6,0);dummy.updateMatrix();shrubs.setMatrixAt(i,dummy.matrix);
}
shrubs.castShadow=true;shrubs.receiveShadow=true;scene.add(shrubs);

// All visible rocks and low logs use the same geometry and footprints as collision.
for(const o of OBSTACLES){
  if(o.type==='palm')continue;
  if(o.type==='rock'){
    const r=mesh(rockGeo,o.h>2?materials.rock:materials.rockLight,o.x,o.base+o.h*.45,o.z);r.scale.set(o.r,o.h*.57,o.r*.9);r.rotation.set(.16,o.yaw,.1);
    if(o.r>1.8){const small=mesh(rockGeo,materials.rockLight,o.x+o.r*.65,o.base+.3,o.z+o.r*.45);small.scale.set(o.r*.42,.65,o.r*.43);}
  }else if(o.type==='log'){
    const group=new THREE.Group();group.position.set(o.x,o.base+o.h*.5,o.z);group.rotation.y=o.yaw;scene.add(group);
    const log=mesh(new THREE.CylinderGeometry(o.h*.44,o.h*.5,o.width,9),materials.wood,0,0,0,group);log.rotation.z=Math.PI/2;
    for(const sign of [-1,1]){const end=mesh(new THREE.CircleGeometry(o.h*.36,12),materials.woodLight,sign*(o.width/2+.003),0,0,group);end.rotation.y=sign*Math.PI/2;}
    const branch=lineBetween(new THREE.Vector3(-.6,.08,0),new THREE.Vector3(-.9,.22,-.9),.09,materials.wood,group);
  }else{
    const group=new THREE.Group();group.position.set(o.x,o.base+o.h/2,o.z);group.rotation.y=o.yaw;scene.add(group);
    box(o.width,o.h,o.depth,materials.woodLight,0,0,0,group);
    for(const x of [-.47,.47])box(.1,o.h+.03,o.depth+.03,materials.wood,x,0,0,group);
    for(const y of [-o.h*.39,o.h*.39])box(o.width+.03,.1,o.depth+.04,materials.wood,0,y,0,group);
  }
}

// A compact beach station, a shade sail, and flags are landmarks instead of walls.
function umbrella(x,z,color){
  const y=terrainHeight(x,z);mesh(new THREE.CylinderGeometry(.045,.045,3.4,8),materials.woodLight,x,y+1.7,z);
  const g=new THREE.ConeGeometry(2.1,.85,10,1,true);const canopy=mesh(g,mat(color,{side:THREE.DoubleSide}),x,y+3.2,z);canopy.rotation.y=.2;
  const top=sphere(.08,materials.white,x,y+3.65,z);
  for(const xx of [-.8,.8]){const chair=box(.7,.1,1.7,materials.white,x+xx,y+.32,z+.7);chair.rotation.x=-.17;const towel=box(.55,.03,1,mat('#a0c4b5'),x+xx,y+.41,z+.6);towel.rotation.x=-.17;}
}
umbrella(-31,22,'#d79d70');umbrella(-34,18,'#c0c6a0');umbrella(-17,25,'#edd8a0');
const station=new THREE.Group();station.position.set(-29,terrainHeight(-29,-1),-1);scene.add(station);
for(const x of [-2,2])for(const z of [-1.7,1.7])box(.16,3.2,.16,materials.wood,x,1.6,z,station);
const stationRoof=mesh(new THREE.ConeGeometry(3.5,1.3,4),materials.woodLight,0,3.5,0,station);stationRoof.rotation.y=Math.PI/4;
box(4.2,.8,1.3,materials.white,0,1.2,0,station);box(4.3,.15,1.5,materials.woodLight,0,1.65,0,station);
box(1.1,.03,.8,materials.teal,-1,1.75,0,station);
const board=box(.65,2.7,.12,materials.coral,-2.5,1.4,1,station);board.rotation.z=.17;board.rotation.y=.4;
const board2=box(.7,2.5,.12,materials.white,-3.2,1.3,1.2,station);board2.rotation.z=.26;

const flags=[];
function flag(x,z,color,height=3.4){
  const y=floorAt(x,z);mesh(new THREE.CylinderGeometry(.035,.045,height,6),materials.white,x,y+height/2,z);
  const geom=new THREE.PlaneGeometry(1.1,.5,8,2);const m=mesh(geom,mat(color,{side:THREE.DoubleSide}),x+.55,y+height-.4,z);m.castShadow=false;flags.push({mesh:m,base:geom.attributes.position.array.slice(),phase:rng()*8});
}
flag(-2,24,'#d9a16a');flag(25,22,'#d77956');flag(-7,-25,'#efd27e');flag(33,-18,'#8eb6a2');
// Shade-sail fabric is anchored at three distinct heights.
const sailGroup=new THREE.Group();sailGroup.position.set(-3,terrainHeight(-3,-18),-18);scene.add(sailGroup);
const sailPoints=[[-4,4.8,-2],[4,4.1,-2],[0,5.2,4]];
for(const [x,y,z] of sailPoints)box(.1,y,.1,materials.woodLight,x,y/2,z,sailGroup);
const sailGeo=new THREE.BufferGeometry();sailGeo.setAttribute('position',new THREE.Float32BufferAttribute(sailPoints.flat(),3));sailGeo.computeVertexNormals();mesh(sailGeo,mat('#f5e6b5',{side:THREE.DoubleSide}),0,0,0,sailGroup);

function sign(x,z,title,sub){
  const y=floorAt(x,z),tex=textureFromCanvas(512,160,ctx=>{ctx.fillStyle='#eee5be';ctx.fillRect(0,0,512,160);ctx.strokeStyle='#c4b185';ctx.lineWidth=6;ctx.strokeRect(6,6,500,148);ctx.textAlign='center';ctx.fillStyle='#456052';ctx.font='500 39px "PingFang TC",sans-serif';ctx.fillText(title,256,70);ctx.font='18px "Avenir Next",sans-serif';ctx.letterSpacing='4px';ctx.fillText(sub,256,115);});
  const g=new THREE.Group();g.position.set(x,y,z);g.rotation.y=.12;scene.add(g);box(.08,1.6,.08,materials.wood,0,.8,0,g);
  mesh(new THREE.PlaneGeometry(2.5,.78),mat('#ffffff',{map:tex,side:THREE.DoubleSide}),0,1.45,.03,g);
}
sign(-4,23,'南岸沙灘','SOUTH BEACH');sign(4,11,'透光潟湖 →','THE LAGOON');sign(19,23,'漂流木徑','DRIFTWOOD TRAIL');sign(-6,-22,'北岸風廊','NORTH WIND');

// Non-solid shells and small sand details never block the route.
const shells=new THREE.InstancedMesh(new THREE.SphereGeometry(1,5,3),mat('#fff3d0'),105);
let shellIndex=0,tries=0;
while(shellIndex<105&&tries++<3000){const x=(rng()-.5)*100,z=(rng()-.5)*76,h=terrainHeight(x,z);if(h<.22||h>1.6)continue;dummy.position.set(x,h+.03,z);const s=.07+rng()*.08;dummy.scale.set(s,.035,s*.7);dummy.rotation.y=rng()*6;dummy.updateMatrix();shells.setMatrixAt(shellIndex++,dummy.matrix);}shells.count=shellIndex;scene.add(shells);
const starMaterial=mat('#cb9871');
for(const [x,z] of [[-13,30],[28,25],[-3,29],[-37,8]]){const y=floorAt(x,z)+.03;const star=new THREE.Group();star.position.set(x,y,z);scene.add(star);for(let j=0;j<5;j++){const a=j/5*Math.PI*2;const arm=mesh(new THREE.ConeGeometry(.07,.42,4),starMaterial,Math.sin(a)*.16,.015,Math.cos(a)*.16,star);arm.rotation.x=Math.PI/2;arm.rotation.z=a;}}

// A physical ring of small buoys makes the finite playable edge legible.
const buoyMaterial=mat('#f0d7a0');
const buoys=[];
for(let i=0;i<62;i++){const a=i/62*Math.PI*2,x=Math.cos(a)*LIMIT.x*.985,z=Math.sin(a)*LIMIT.z*.985;
  const b=sphere(.24,i%5===0?materials.coral:buoyMaterial,x,.23,z);b.scale.y=1.2;b.castShadow=false;buoys.push({mesh:b,phase:a});
  if(i%5===0){mesh(new THREE.CylinderGeometry(.025,.025,1.1,5),materials.woodLight,x,.8,z,scene,false);}
}
const boundaryPoints=[];for(let i=0;i<125;i++){const a=i/124*Math.PI*2;boundaryPoints.push(new THREE.Vector3(Math.cos(a)*LIMIT.x*.985,.14,Math.sin(a)*LIMIT.z*.985));}
const boundaryLine=new THREE.Line(new THREE.BufferGeometry().setFromPoints(boundaryPoints),new THREE.LineBasicMaterial({color:'#e4d7aa',transparent:true,opacity:.35}));scene.add(boundaryLine);

// Surface arrows are deliberately sparse; their motion reveals the local current.
const flowArrows=[];
for(const [x,z] of [[9,-3],[18,-3],[30,-3],[54,3],[58,-13],[59,-27],[-15,-42],[-34,-39],[-48,4],[-22,42],[7,42]]){
  const group=new THREE.Group();group.position.set(x,.12,z);scene.add(group);
  const points=[[-.8,0,.7],[0,0,-.2],[.8,0,.7]];
  const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p))),new THREE.LineBasicMaterial({color:'#dbf3d5',transparent:true,opacity:.33}));group.add(line);
  flowArrows.push({group,x,z,phase:rng()*10});
}

// A little moored sailboat adds a focal point beyond the lagoon.
const boat=new THREE.Group();boat.position.set(-51,.2,-23);boat.rotation.y=.6;scene.add(boat);
const hull=mesh(new THREE.SphereGeometry(1,12,6),materials.white,0,0,0,boat);hull.scale.set(1,.45,2.3);
box(1.1,.13,3.1,materials.woodLight,0,.22,0,boat);mesh(new THREE.CylinderGeometry(.04,.06,5,8),materials.wood,0,2.6,0,boat);
const boatSail=new THREE.BufferGeometry();boatSail.setAttribute('position',new THREE.Float32BufferAttribute([.06,.8,0,.06,4.9,0,.06,.8,2],3));boatSail.computeVertexNormals();mesh(boatSail,mat('#f6e4a7',{side:THREE.DoubleSide}),0,0,0,boat);

// Runner with separate limbs and articulated knees, all modeled locally.
const avatar=new THREE.Group();scene.add(avatar);
const bodyPivot=new THREE.Group();avatar.add(bodyPivot);
const torso=mesh(new THREE.CylinderGeometry(.27,.22,.6,10),materials.coral,0,1.25,0,bodyPivot);torso.scale.z=.67;
const stripe=box(.4,.055,.025,materials.white,0,1.43,-.18,bodyPivot);
const neck=mesh(new THREE.CylinderGeometry(.09,.10,.13,8),materials.skin,0,1.6,0,bodyPivot);
const head=sphere(.24,materials.skin,0,1.85,0,bodyPivot);head.scale.multiply(new THREE.Vector3(1,1.12,.98));
const hair=sphere(.244,materials.hair,0,1.97,.03,bodyPivot);hair.scale.multiply(new THREE.Vector3(1,.8,.98));
const bun=sphere(.12,materials.hair,0,2.11,.16,bodyPivot);
const visor=mesh(new THREE.CylinderGeometry(.26,.26,.055,12),materials.teal,0,1.98,0,bodyPivot);
const brim=box(.33,.035,.18,materials.teal,0,1.98,-.23,bodyPivot);brim.rotation.x=.05;
for(const x of [-.085,.085])sphere(.019,materials.dark,x,1.85,-.226,bodyPivot);
const nose=sphere(.045,materials.skinShade,0,1.8,-.245,bodyPivot);nose.scale.multiply(new THREE.Vector3(.7,.6,1));
const shorts=mesh(new THREE.CylinderGeometry(.24,.28,.26,8),materials.teal,0,.91,0,bodyPivot);shorts.scale.z=.8;
const backpack=box(.32,.43,.14,materials.dark,0,1.31,.21,bodyPivot);const packStripe=box(.25,.07,.025,materials.gold,0,1.32,.295,bodyPivot);
const arms=[],legs=[];
for(const side of [-1,1]){
  const shoulder=new THREE.Group();shoulder.position.set(side*.32,1.49,0);bodyPivot.add(shoulder);
  sphere(.105,materials.skin,0,-.04,0,shoulder);
  const upper=mesh(new THREE.CapsuleGeometry(.075,.26,3,7),materials.skin,0,-.20,0,shoulder);
  const elbow=new THREE.Group();elbow.position.y=-.34;elbow.rotation.x=-.5;shoulder.add(elbow);
  mesh(new THREE.CapsuleGeometry(.066,.25,3,7),materials.skin,0,-.17,0,elbow);sphere(.072,materials.skin,0,-.34,0,elbow);arms.push({shoulder,elbow,side});
  const hip=new THREE.Group();hip.position.set(side*.14,.91,0);bodyPivot.add(hip);
  mesh(new THREE.CylinderGeometry(.095,.08,.37,8),materials.skin,0,-.2,0,hip);
  const shortsLeg=mesh(new THREE.CylinderGeometry(.13,.13,.16,8),materials.teal,0,-.065,0,hip);
  const knee=new THREE.Group();knee.position.y=-.39;hip.add(knee);
  sphere(.077,materials.skin,0,0,0,knee);mesh(new THREE.CylinderGeometry(.073,.055,.34,8),materials.skin,0,-.16,0,knee);
  mesh(new THREE.CylinderGeometry(.058,.058,.1,8),materials.white,0,-.31,0,knee);
  const shoe=box(.17,.12,.30,materials.white,0,-.37,-.055,knee);const sole=box(.18,.03,.31,materials.teal,0,-.43,-.055,knee);legs.push({hip,knee,side});
}
const contactShadow=mesh(new THREE.CircleGeometry(.55,24),new THREE.MeshBasicMaterial({color:'#466b5d',transparent:true,opacity:.18,depthWrite:false}),0,.01,0,scene,false);contactShadow.rotation.x=-Math.PI/2;contactShadow.renderOrder=3;

// Equipment has visible geometry as well as distinct movement rules.
const surfRig=new THREE.Group();avatar.add(surfRig);
const surfDeck=mesh(new THREE.SphereGeometry(1,18,10),materials.white,0,.11,0,surfRig);surfDeck.scale.set(.4,.085,1.4);
box(.14,.018,2.15,materials.teal,0,.195,0,surfRig);box(.15,.02,.35,materials.gold,0,.20,-.9,surfRig);
const surfFin=box(.025,.22,.24,materials.teal,0,-.03,.85,surfRig);
const jetRig=new THREE.Group();avatar.add(jetRig);
const jetHull=mesh(new THREE.SphereGeometry(1,16,8),materials.coral,0,.25,-.1,jetRig);jetHull.scale.set(.58,.26,1.38);
const jetDeck=mesh(new THREE.SphereGeometry(1,16,8),materials.white,0,.42,-.16,jetRig);jetDeck.scale.set(.49,.18,1.20);
box(.4,.17,.83,materials.dark,0,.63,.20,jetRig);
const jetHood=mesh(new THREE.SphereGeometry(1,12,7),materials.teal,0,.62,-.67,jetRig);jetHood.scale.set(.37,.25,.55);
lineBetween(new THREE.Vector3(0,.62,-.60),new THREE.Vector3(0,1.03,-.45),.045,materials.dark,jetRig);
lineBetween(new THREE.Vector3(-.34,1.03,-.45),new THREE.Vector3(.34,1.03,-.45),.045,materials.dark,jetRig);
const jetSkids=[];for(const side of [-1,1]){const skid=box(.12,.12,1.55,materials.gold,side*.46,.08,.12,jetRig);jetSkids.push(skid);}
const steel=mat('#b9ccbf',{metalness:.42,roughness:.4}),exoGlow=mat('#c4df9d',{emissive:'#80ac63',emissiveIntensity:.35});
const exoParts=[],exoBack=new THREE.Group();bodyPivot.add(exoBack);exoParts.push(exoBack);
box(.13,.78,.16,steel,0,1.25,.32,exoBack);box(.19,.25,.10,exoGlow,0,1.35,.43,exoBack);
for(const side of [-1,1]){box(.10,.6,.10,steel,side*.27,1.23,.17,exoBack);box(.18,.10,.37,steel,side*.28,1.49,0,exoBack);}
for(const leg of legs){
  const thigh=new THREE.Group();leg.hip.add(thigh);exoParts.push(thigh);box(.10,.37,.14,steel,leg.side*.11,-.18,.025,thigh);sphere(.10,exoGlow,leg.side*.11,-.37,.025,thigh);
  const shin=new THREE.Group();leg.knee.add(shin);exoParts.push(shin);box(.10,.29,.12,steel,leg.side*.10,-.18,.02,shin);box(.22,.055,.35,steel,0,-.45,-.055,shin);
}
function applyToolVisuals(){surfRig.visible=player.tool==='surfboard';jetRig.visible=player.tool==='jetski';for(const p of exoParts)p.visible=player.tool==='exoskeleton';detailedCharacter.setTool(player.tool);}
const detailedCharacter=new DetailedCharacter(avatar,renderer);
let characterSettled=false,classicCharacter=false;
detailedCharacter.load(progress=>{const label=$('loadingDetail');if(label)label.textContent=progress>0?`人物載入 ${Math.round(progress*100)}%`:'正在整理人物與衣料細節';}).then(()=>{characterSettled=true;bodyPivot.visible=classicCharacter;$('characterState').textContent='完整人物與材質已就緒';}).catch(error=>{characterSettled=true;classicCharacter=true;bodyPivot.visible=true;$('characterState').textContent='精緻人物未載入，暫用輕量版';console.error('Detailed character load failed:',error);});

// Reusable rings and grains leave a trail without allocating objects each frame.
const particleCount=80,particles=Array.from({length:particleCount},()=>({life:0}));let particleCursor=0,particleTimer=0;
const ringMaterial=new THREE.MeshBasicMaterial({color:'#d2fff0',transparent:true,opacity:.32,depthWrite:false,side:THREE.DoubleSide});
const ringMesh=new THREE.InstancedMesh(new THREE.RingGeometry(.65,.82,18),ringMaterial,particleCount);ringMesh.renderOrder=4;scene.add(ringMesh);ringMesh.frustumCulled=false;
const dustMesh=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),new THREE.MeshBasicMaterial({color:'#f1dfba',transparent:true,opacity:.45,depthWrite:false}),particleCount);scene.add(dustMesh);dustMesh.frustumCulled=false;
function emitParticle(p){const v=particles[particleCursor++%particleCount];Object.assign(v,{life:1,water:p.water,x:p.x+(rng()-.5)*.5,y:p.water?.115:p.y+.05,z:p.z,angle:rng()*6,size:.25+rng()*.15});}
function updateParticles(dt){
  for(let i=0;i<particleCount;i++){const p=particles[i];p.life=Math.max(0,p.life-dt*(p.water?1.1:1.7));
    dummy.position.set(p.x||0,p.y||0,p.z||0);dummy.rotation.set(-Math.PI/2,0,0);
    const s=p.life>0&&p.water?(1-p.life)*1.3+.2:0;dummy.scale.setScalar(s*Math.min(1,p.life*4));dummy.updateMatrix();ringMesh.setMatrixAt(i,dummy.matrix);
    dummy.rotation.set(0,p.angle||0,0);dummy.position.y=(p.y||0)+(1-p.life)*.7;const d=p.life>0&&!p.water?p.size*p.life:0;dummy.scale.setScalar(d);dummy.updateMatrix();dustMesh.setMatrixAt(i,dummy.matrix);
  }ringMesh.instanceMatrix.needsUpdate=true;dustMesh.instanceMatrix.needsUpdate=true;
}

let player=makePlayer();player.facing=0;
const env={weather:'sunny',windAngle:Math.PI/4,reversed:false,time:0};
let weatherBlend=0,started=false,paused=false,overview=false,cameraYaw=.15,cameraPitch=.23,cameraDistance=6.8;
let inspecting=false,inspectDistance=4.6,savedCamera=null,lastShadowSpan=75;
let visibleYaw=0,walkTime=0,jumpQueued=false,sprintToggle=false,touchX=0,touchZ=0;
const keys=new Set(),discovered=new Set();let comboCandidate=null,comboDwell=0,toastTimer=0,hudTime=0,lastSurface=false;
const terrainTracker=makeTerrainTracker(terrainClass(player.x,player.z));
let currentInput={x:0,z:0,sprint:false,jump:false};
const speedHistory=Array(28).fill(0),hudLog=[];

function start(){if(started)return;started=true;$('intro').classList.add('dismissed');document.body.classList.add('playing');canvas.focus({preventScroll:true});}
function toast(text){$('toast').textContent=text;$('toast').classList.add('visible');toastTimer=3;}
function resetKeys(){keys.clear();touchX=0;touchZ=0;jumpQueued=false;sprintToggle=false;$('touchSprint').setAttribute('aria-pressed','false');$('joystickKnob').style.transform='';}
function teleport(zone){
  start();const p=ZONES[zone],tool=player.tool;player=makePlayer(zone);player.tool=tool;applyToolVisuals();player.facing=p.yaw;visibleYaw=p.yaw;cameraYaw=p.yaw;
  for(const p of particles)p.life=0;resetKeys();comboCandidate=null;comboDwell=0;
  document.querySelectorAll('[data-zone]').forEach(b=>b.classList.toggle('selected',b.dataset.zone===zone));
  toast(`已抵達 ${p.label} · 隨時轉向，比較風與水流`);canvas.focus({preventScroll:true});
}
function setWeather(weather){
  env.weather=weather;document.body.classList.toggle('wind-storm',weather==='windy');
  for(const id of ['sunny','windy']){$(id).classList.toggle('active',id===weather);$(id).setAttribute('aria-pressed',String(id===weather));}
  $('weatherNote').textContent=weather==='sunny'?'微風、平緩的浪，適合出發。':'強風與陣風，順逆風的差別更明顯。';
  toast(weather==='sunny'?'晴天 · 微風 1.8 m/s':'大風 · 約 12 m/s，試著順風與逆風跑');canvas.focus({preventScroll:true});
}
function selectCharacter(classic){
  classicCharacter=classic;detailedCharacter.setClassic(classic);bodyPivot.visible=classic||!detailedCharacter.ready;
  $('detailedCharacter').setAttribute('aria-pressed',String(!classic));$('classicCharacter').setAttribute('aria-pressed',String(classic));
  $('characterState').textContent=classic?'輕量角色 · 簡約模型':detailedCharacter.ready?'精緻角色 · 完整服裝與骨架':'人物正在載入';canvas.focus({preventScroll:true});
}
function toggleInspection(){
  if(paused)return;inspecting=!inspecting;document.body.classList.toggle('inspecting-character',inspecting);$('characterButton').setAttribute('aria-pressed',String(inspecting));resetKeys();
  if(inspecting){start();savedCamera={yaw:cameraYaw,pitch:cameraPitch,distance:cameraDistance};overview=false;$('overviewButton').setAttribute('aria-pressed','false');cameraYaw=visibleYaw+Math.PI;cameraPitch=.12;}
  else if(savedCamera){cameraYaw=savedCamera.yaw;cameraPitch=savedCamera.pitch;cameraDistance=savedCamera.distance;}
  $('characterControls').hidden=!inspecting;canvas.focus({preventScroll:true});
}
$('characterButton').onclick=toggleInspection;$('exitCharacter').onclick=toggleInspection;
$('detailedCharacter').onclick=()=>selectCharacter(false);$('classicCharacter').onclick=()=>selectCharacter(true);
$('faceView').onclick=()=>{inspectDistance=1.25;cameraPitch=.05;canvas.focus({preventScroll:true});};
$('bodyView').onclick=()=>{inspectDistance=4.6;cameraPitch=.12;canvas.focus({preventScroll:true});};
$('startButton').onclick=start;$('sunny').onclick=()=>setWeather('sunny');$('windy').onclick=()=>setWeather('windy');
$('windLeft').onclick=()=>{env.windAngle-=Math.PI/4;toast('風向已逆時針轉 45°');canvas.focus({preventScroll:true});};
$('windRight').onclick=()=>{env.windAngle+=Math.PI/4;toast('風向已順時針轉 45°');canvas.focus({preventScroll:true});};
$('reverseCurrent').onclick=()=>{env.reversed=!env.reversed;$('reverseCurrent').setAttribute('aria-pressed',String(env.reversed));toast(env.reversed?'全島水流已反轉':'已恢復原本的水流方向');canvas.focus({preventScroll:true});};
document.querySelectorAll('[data-zone]').forEach(b=>b.onclick=()=>teleport(b.dataset.zone));
$('environmentToggle').onclick=()=>{const closed=$('environment').classList.toggle('closed');$('environmentToggle').setAttribute('aria-expanded',String(!closed));};
if(innerWidth<=600){$('environment').classList.add('closed');$('environmentToggle').setAttribute('aria-expanded','false');}
$('overviewButton').onclick=()=>{if(inspecting)toggleInspection();overview=!overview;document.body.classList.toggle('overview',overview);$('overviewButton').setAttribute('aria-pressed',String(overview));$('overviewButton').innerHTML=overview?'回到第三人稱 <span>↙</span>':'俯瞰全島 <span>↗</span>';toast(overview?'俯瞰全島 · 移動仍可控制角色':'回到第三人稱視角');canvas.focus({preventScroll:true});};
function openDialog(id){paused=true;resetKeys();$(id).showModal();}
function closeDialog(id){$(id).close();paused=false;canvas.focus({preventScroll:true});}
function openEquipment(automatic=false){
  const terrain=terrainClass(player.x,player.z),recommended=recommendedTool(terrain,player.x,player.z);
  $('equipmentTitle').textContent=automatic?(terrain==='water'?'踏上水面，換個跑法？':terrain==='obstacle'?'前方有障礙，借點助力？':'回到沙灘，選個新節奏？'):'這一段路，想怎麼走？';
  $('equipmentContext').textContent=(terrain==='water'?'水面':terrain==='obstacle'?'障礙區':'沙灘')+' · 裝備會自動適應沙灘與水面，換地形也能繼續使用。';
  document.querySelectorAll('[data-tool]').forEach(b=>{b.classList.toggle('equipped',b.dataset.tool===player.tool);b.setAttribute('aria-pressed',String(b.dataset.tool===player.tool));const tag=b.querySelector('.recommend-tag');if(tag){tag.hidden=b.dataset.tool!==recommended;}});
  $('keepTool').textContent=`繼續使用${TOOLS[player.tool].name}`;
  terrainTracker.lastPrompt=env.time;openDialog('equipmentDialog');
}
function chooseTool(id){
  if(!TOOLS[id])return;player.tool=id;applyToolVisuals();closeDialog('equipmentDialog');start();
  toast(id==='foot'?'已切換徒步 · 隨時按 E 選擇工具':`已裝備${TOOLS[id].name} · 沙灘與水面都會自動增速`);
}
$('toolButton').onclick=()=>openEquipment();$('equipmentStatus').onclick=()=>openEquipment();$('keepTool').onclick=()=>closeDialog('equipmentDialog');
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>chooseTool(b.dataset.tool));
$('helpButton').onclick=()=>openDialog('helpDialog');$('discoveryButton').onclick=()=>{renderCombos();openDialog('discoveryDialog');};
$('pauseButton').onclick=()=>openDialog('pauseDialog');$('resumeButton').onclick=()=>closeDialog('pauseDialog');
$('resetButton').onclick=()=>{closeDialog('pauseDialog');teleport('beach');};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>closeDialog(b.dataset.close));
document.querySelectorAll('dialog').forEach(d=>{d.addEventListener('cancel',()=>{paused=false;resetKeys();});d.addEventListener('click',e=>{if(e.target!==d)return;const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog(d.id);});});
window.addEventListener('keydown',e=>{
  if(e.code==='Escape'&&inspecting&&!document.querySelector('dialog[open]')){e.preventDefault();toggleInspection();return;}
  if(e.code==='Escape'){if(!document.querySelector('dialog[open]')){e.preventDefault();openDialog('pauseDialog');}return;}
  if(paused)return;
  if(e.code==='KeyC'&&!e.repeat){e.preventDefault();toggleInspection();return;}
  if(e.code==='KeyE'&&!e.repeat){e.preventDefault();openEquipment();return;}
  if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight'].includes(e.code)){e.preventDefault();keys.add(e.code);start();}
  if(e.code==='Space'&&!e.repeat)jumpQueued=true;
  if(e.code==='KeyR'&&!e.repeat)teleport('beach');
});
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',resetKeys);
document.addEventListener('visibilitychange',()=>{resetKeys();});
let dragging=false,lastPointerX=0,lastPointerY=0;
canvas.addEventListener('pointerdown',e=>{if(paused)return;dragging=true;lastPointerX=e.clientX;lastPointerY=e.clientY;canvas.setPointerCapture(e.pointerId);canvas.focus({preventScroll:true});});
canvas.addEventListener('pointermove',e=>{if(!dragging||overview)return;cameraYaw-=(e.clientX-lastPointerX)*.0045;cameraPitch=clamp(cameraPitch+(e.clientY-lastPointerY)*.003,inspecting?-.2:.10,.94);lastPointerX=e.clientX;lastPointerY=e.clientY;});
canvas.addEventListener('pointerup',()=>dragging=false);canvas.addEventListener('pointercancel',()=>dragging=false);
canvas.addEventListener('wheel',e=>{e.preventDefault();if(inspecting)inspectDistance=clamp(inspectDistance+e.deltaY*.004,1.05,4.8);else cameraDistance=clamp(cameraDistance+e.deltaY*.008,3.2,22);},{passive:false});canvas.addEventListener('contextmenu',e=>e.preventDefault());
const joystick=$('joystick');let stickPointer=null;
function stickMove(e){if(stickPointer!==e.pointerId)return;const r=joystick.getBoundingClientRect(),dx=e.clientX-r.left-r.width/2,dy=e.clientY-r.top-r.height/2,max=r.width*.34,n=Math.max(1,Math.hypot(dx,dy)/max);touchX=dx/n/max;touchZ=dy/n/max;$('joystickKnob').style.transform=`translate(${dx/n}px,${dy/n}px)`;}
joystick.addEventListener('pointerdown',e=>{start();stickPointer=e.pointerId;joystick.setPointerCapture(e.pointerId);stickMove(e);});joystick.addEventListener('pointermove',stickMove);
function stickEnd(e){if(e.pointerId!==stickPointer)return;stickPointer=null;touchX=0;touchZ=0;$('joystickKnob').style.transform='';}
joystick.addEventListener('pointerup',stickEnd);joystick.addEventListener('pointercancel',stickEnd);
$('touchJump').onclick=()=>{start();jumpQueued=true;};$('touchSprint').onclick=()=>{start();sprintToggle=!sprintToggle;$('touchSprint').setAttribute('aria-pressed',String(sprintToggle));};

const names=['北','東北','東','東南','南','西南','西','西北'];
function directionName(angle){return names[((Math.round(angle/(Math.PI/4))%8)+8)%8];}
function signedEffect(id,value,active=true){const el=$(id);el.textContent=active?(value>=0?'+':'')+value.toFixed(1):'—';el.classList.toggle('positive',active&&value>.05);el.classList.toggle('negative',active&&value<-.05);}
function locationName(p){if(p.x>44)return '東側急流水道';if(p.z< -26)return '北岸風廊';if(p.water&&p.x>0&&p.x<36&&Math.abs(p.z+3)<15)return '透光潟湖';if(p.water)return '環島淺海';if(p.x>13&&p.z>7)return '漂流木障礙區';if(p.x< -16&&p.z<13)return '棕櫚綠洲';return '南岸沙灘';}
function updateHUD(){
  $('speed').textContent=player.speed.toFixed(1);$('speedBar').style.width=`${Math.min(100,player.speed/24*100)}%`;
  $('baseEffect').textContent=player.base.toFixed(1);signedEffect('windEffect',player.windEffect,currentInput.x!==0||currentInput.z!==0);signedEffect('currentEffect',player.currentEffect,player.water&&(currentInput.x!==0||currentInput.z!==0)&&player.grounded);
  const edge=boundaryWeight(player.x,player.z).q>.86;$('edgeNotice').hidden=!edge;
  $('runningState').textContent=edge?'邊界減速':!player.grounded?'躍起中':player.collision?'繞行 / 跳躍':player.speed<.2?'準備出發':currentInput.sprint?'衝刺中':'自在跑動';
  $('paceLabel').textContent=(player.water?'水面':'沙灘')+(currentInput.sprint?'衝刺':TOOLS[player.tool].verb);$('surfaceName').textContent=player.water?'水面':'沙灘';$('locationName').textContent=locationName(player);
  $('equipmentName').textContent=TOOLS[player.tool].name;$('equipmentBonus').textContent=player.tool==='foot'?'選擇工具 ↗':`基速 +${player.toolBonus.toFixed(1)} ↗`;$('baseLabel').textContent=player.tool==='foot'?'地形基速':'工具基速';
  $('toolButton').classList.toggle('tool-active',player.tool!=='foot');$('toolButton').setAttribute('aria-label',`選擇移動工具，目前${TOOLS[player.tool].name}`);
  const w=windAt(env.weather,env.windAngle,env.time),c=currentAt(player.x,player.z,env.reversed);
  $('windSpeed').textContent=w.strength.toFixed(1);$('windDirection').textContent=directionName(env.windAngle);$('windDial').querySelector('svg').style.transform=`rotate(${env.windAngle*180/Math.PI}deg)`;
  $('currentSpeed').textContent=c.strength.toFixed(1);$('currentName').textContent=player.water?c.name:'近岸水流';$('currentDial').querySelector('svg').style.transform=`rotate(${Math.atan2(c.x,-c.z)*180/Math.PI}deg)`;
  speedHistory.shift();speedHistory.push(player.speed);$('speedPath').setAttribute('d',speedHistory.map((s,i)=>`${i?'L':'M'}${(i/(speedHistory.length-1)*90).toFixed(1)} ${(33-Math.min(s/24,1)*29).toFixed(1)}`).join(''));
  if(lastSurface!==player.water&&started){toast(player.water?'踏上水面 · 水流現在會影響跑動速度':'回到沙灘 · 感受風的推力');lastSurface=player.water;}
  $('comboCount').textContent=discovered.size;
  canvas.dataset.diagnostics=JSON.stringify({version:'1.2.0',character:classicCharacter?'classic':'detailed',characterReady:detailedCharacter.ready,characterStats:detailedCharacter.stats,inspecting,x:+player.x.toFixed(3),z:+player.z.toFixed(3),y:+player.y.toFixed(3),speed:+player.speed.toFixed(2),grounded:player.grounded,collision:player.collision,surface:player.water?'water':'sand',terrain:terrainClass(player.x,player.z),tool:player.tool,base:player.base,weather:env.weather,reversed:env.reversed,combos:discovered.size,paused,overview,boundary:+boundaryWeight(player.x,player.z).q.toFixed(4),fps:Math.round(1000/frameMean),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles});
  drawMap();
}
const windRelations=[['with','順風'],['cross','側風'],['against','逆風']],currentRelations=[['with','順流'],['cross','側流'],['against','逆流']];
function renderCombos(){let html='';for(const weather of ['sunny','windy']){html+=`<h3 class="combo-weather">${weather==='sunny'?'☀ 晴天':'≋ 刮大風'}</h3><div class="combo-table"><span></span>${windRelations.map(r=>`<span class="combo-head">${r[1]}</span>`).join('')}`;
  for(const [surface,label,flow] of [['sand','沙灘',null],...currentRelations.map(([key,label])=>['water',label,key])]){html+=`<span class="row-label">${label}</span>`;for(const [wr,wl]of windRelations){const key=`${weather}:${surface}:${wr}${flow?':'+flow:''}`,found=discovered.has(key);html+=`<div class="combo-item ${found?'found':''}" aria-label="${surface==='sand'?'沙灘':'水面'} ${label} ${wl} ${found?'已體驗':'未體驗'}">${found?'●':'○'}</div>`;}}html+='</div>';
  }$('comboGrid').innerHTML=html;}

// Draw the exact height field once. Only arrows, currents and the player redraw.
const mapCanvas=$('minimap'),mapCtx=mapCanvas.getContext('2d'),mapBase=document.createElement('canvas');mapBase.width=500;mapBase.height=340;const baseCtx=mapBase.getContext('2d');
const mapScale=2.48,mapX=x=>250+x*mapScale,mapZ=z=>170+z*mapScale;
const mapData=baseCtx.createImageData(500,340);
for(let z=0;z<340;z++)for(let x=0;x<500;x++){const xx=(x-250)/mapScale,zz=(z-170)/mapScale,h=terrainHeight(xx,zz),q=Math.hypot(xx/LIMIT.x,zz/LIMIT.z);let c=q>1?[222,235,216]:h<.12?[184,216,201]:h>1.8?[169,187,133]:h<.5?[218,214,168]:[230,213,165];const i=(z*500+x)*4;mapData.data.set([...c,255],i);}
baseCtx.putImageData(mapData,0,0);baseCtx.strokeStyle='#93b69b';baseCtx.lineWidth=1;baseCtx.setLineDash([3,5]);baseCtx.beginPath();baseCtx.ellipse(250,170,LIMIT.x*mapScale*.985,LIMIT.z*mapScale*.985,0,0,Math.PI*2);baseCtx.stroke();baseCtx.setLineDash([]);
for(const p of PALMS){baseCtx.fillStyle='#88a677';baseCtx.beginPath();baseCtx.arc(mapX(p.x),mapZ(p.z),3.8,0,Math.PI*2);baseCtx.fill();}
for(const o of OBSTACLES){if(o.type==='palm')continue;baseCtx.fillStyle=o.type==='rock'?'#9aa79a':'#bc9b6b';baseCtx.beginPath();baseCtx.ellipse(mapX(o.x),mapZ(o.z),(o.r||o.width/2)*mapScale,(o.r||o.depth/2)*mapScale,o.yaw,0,Math.PI*2);baseCtx.fill();}
baseCtx.font='17px "PingFang TC",sans-serif';baseCtx.fillStyle='#7c966e';baseCtx.textAlign='center';baseCtx.fillText('棕櫚綠洲',mapX(-23),mapZ(-6));baseCtx.font='14px "PingFang TC",sans-serif';baseCtx.fillStyle='#729b8b';baseCtx.fillText('潟湖',mapX(10),mapZ(-3)+5);baseCtx.fillText('急流',mapX(57),mapZ(-15));
function drawMap(){const ctx=mapCtx;ctx.clearRect(0,0,500,340);ctx.drawImage(mapBase,0,0);
  for(const v of flowArrows){const c=currentAt(v.x,v.z,env.reversed);ctx.save();ctx.translate(mapX(v.x),mapZ(v.z));ctx.rotate(Math.atan2(c.x,-c.z));ctx.strokeStyle='#79a58d';ctx.lineWidth=1.1;ctx.beginPath();ctx.moveTo(0,7);ctx.lineTo(0,-7);ctx.moveTo(-3,-3);ctx.lineTo(0,-7);ctx.lineTo(3,-3);ctx.stroke();ctx.restore();}
  ctx.save();ctx.translate(mapX(player.x),mapZ(player.z));ctx.fillStyle='#fbf9da';ctx.beginPath();ctx.arc(0,0,10,0,Math.PI*2);ctx.fill();ctx.rotate(-visibleYaw);ctx.fillStyle='#315c50';ctx.beginPath();ctx.moveTo(0,-10);ctx.lineTo(6,7);ctx.lineTo(0,4);ctx.lineTo(-6,7);ctx.closePath();ctx.fill();ctx.restore();
}

const cameraTarget=new THREE.Vector3(),desiredCamera=new THREE.Vector3(),lookTarget=new THREE.Vector3();let cameraReady=false;
function updateCamera(dt){
  if(inspecting){const compact=canvas.clientWidth<700,focus=inspectDistance<2?1.57:compact?.45:.75,distance=inspectDistance*(compact&&inspectDistance>=2?1.22:1);desiredCamera.set(player.x+Math.sin(cameraYaw)*distance,player.y+focus+Math.sin(cameraPitch)*distance,player.z+Math.cos(cameraYaw)*distance);lookTarget.set(player.x,player.y+focus,player.z);}
  else if(overview){desiredCamera.set(0,133,74);lookTarget.set(0,0,-3);}
  else{
    const sin=Math.sin(cameraYaw),cos=Math.cos(cameraYaw),distance=cameraDistance+Math.min(player.speed,14)*.055;
    desiredCamera.set(player.x+sin*distance,player.y+2.2+Math.sin(cameraPitch)*distance,player.z+cos*distance);
    desiredCamera.y=Math.max(desiredCamera.y,floorAt(desiredCamera.x,desiredCamera.z)+1.2);
    lookTarget.set(player.x-sin*.8,player.y+1.10,player.z-cos*.8);
    // Shorten the camera arm before it enters a tall solid rock.
    const ray=new THREE.Vector3().subVectors(desiredCamera,lookTarget),len=ray.length();ray.normalize();let safe=len;
    for(const o of OBSTACLES){if(o.type!=='rock')continue;const center=new THREE.Vector3(o.x,o.base+o.h*.5,o.z);const along=new THREE.Vector3().subVectors(center,lookTarget).dot(ray);if(along<.8||along>safe)continue;const closest=lookTarget.clone().addScaledVector(ray,along);const r=o.r+.4;if(closest.distanceTo(center)<r&&closest.y<o.top+.4)safe=Math.max(1.7,along-r);}
    if(safe<len)desiredCamera.copy(lookTarget).addScaledVector(ray,safe);
  }
  const blend=1-Math.exp(-dt*(overview?3.2:6));if(!cameraReady){camera.position.copy(desiredCamera);cameraTarget.copy(lookTarget);cameraReady=true;}else{camera.position.lerp(desiredCamera,blend);cameraTarget.lerp(lookTarget,blend);}camera.lookAt(cameraTarget);const fov=inspecting?36:53;if(Math.abs(camera.fov-fov)>.01){camera.fov+=(fov-camera.fov)*blend;camera.updateProjectionMatrix();}
}
function animateAvatar(dt){
  const moving=Math.min(1,player.speed/3),air=!player.grounded;
  walkTime+=dt*(player.speed>1?player.speed*1.7:2);const stride=Math.sin(walkTime);
  let diff=player.facing-visibleYaw;diff=Math.atan2(Math.sin(diff),Math.cos(diff));visibleYaw+=diff*(1-Math.exp(-dt*13));
  avatar.position.set(player.x,player.y,player.z);avatar.rotation.y=visibleYaw;
  bodyPivot.position.y=air?0:Math.abs(Math.sin(walkTime))*moving*.065;bodyPivot.rotation.x=air?-.1:-moving*.075;
  for(const arm of arms){const phase=arm.side;arm.shoulder.rotation.x=air?-1.0:stride*.65*moving*phase;arm.shoulder.rotation.z=-arm.side*(.07+(air?.18:0));arm.elbow.rotation.x=-.55-(currentInput.sprint?.3:0);}
  for(const leg of legs){const s=stride*leg.side;leg.hip.rotation.x=air?(leg.side<0?-.7:.5):s*.75*moving;leg.knee.rotation.x=air?.8:Math.max(0,-s)*1.12*moving;}
  if(player.tool==='surfboard'){
    bodyPivot.position.y=.16+(air?0:Math.sin(env.time*2)*.02);bodyPivot.rotation.x=-.09;
    for(const leg of legs){leg.hip.rotation.x=-.2;leg.knee.rotation.x=.35;}
    for(const arm of arms){arm.shoulder.rotation.x=.15;arm.shoulder.rotation.z=-arm.side*(.28+moving*.13);arm.elbow.rotation.x=-.35;}
  }else if(player.tool==='jetski'){
    bodyPivot.position.y=.10;bodyPivot.rotation.x=-.16;
    for(const leg of legs){leg.hip.rotation.x=-.8;leg.knee.rotation.x=1.4;}
    for(const arm of arms){arm.shoulder.rotation.x=.95;arm.shoulder.rotation.z=-arm.side*.08;arm.elbow.rotation.x=-.6;}
    for(const skid of jetSkids)skid.visible=!player.water;
  }
  detailedCharacter.update(dt,player,currentInput,env.time);
  contactShadow.position.set(player.x,Math.max(.105,terrainHeight(player.x,player.z)+.025),player.z);contactShadow.scale.setScalar(1+Math.max(0,player.y-floorAt(player.x,player.z))*.25);contactShadow.material.opacity=player.water?.12:.17;
  particleTimer+=dt;if(player.speed>1.4&&player.grounded&&particleTimer>.105){emitParticle(player);particleTimer=0;}updateParticles(dt);
}
let lastTime=performance.now(),frameCount=0,frameMean=16,qualityTime=0;
function frame(now){
  requestAnimationFrame(frame);const rawDt=(now-lastTime)/1000;lastTime=now;if(document.hidden)return;const dt=Math.min(.05,rawDt||.016);
  if(!paused){
    env.time+=dt;
    let sx=touchX+(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0),sz=touchZ+(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-(keys.has('KeyW')||keys.has('ArrowUp')?1:0);
    if(inspecting){sx=0;sz=0;}
    const mag=Math.hypot(sx,sz);if(mag>1){sx/=mag;sz/=mag;}
    const yaw=overview?0:cameraYaw,co=Math.cos(yaw),si=Math.sin(yaw);
    currentInput={x:sx*co+sz*si,z:-sx*si+sz*co,sprint:sprintToggle||keys.has('ShiftLeft')||keys.has('ShiftRight'),jump:jumpQueued};
    const steps=Math.ceil(dt/(1/120)),step=dt/steps;
    for(let i=0;i<steps;i++){stepPlayer(player,currentInput,env,step);currentInput.jump=false;}jumpQueued=false;
    const combo=comboKey(player,currentInput,env);if(combo===comboCandidate)comboDwell+=dt;else{comboCandidate=combo;comboDwell=0;}
    if(combo&&comboDwell>.5&&!discovered.has(combo)){discovered.add(combo);if(discovered.size===1||discovered.size%4===0)toast(`新的跑法已記下 · ${discovered.size} / 24 種環境組合`);}
    weatherBlend+=(Number(env.weather==='windy')-weatherBlend)*(1-Math.exp(-dt*1.4));
    const targetSky=env.weather==='windy'?new THREE.Color('#b0cfd0'):new THREE.Color('#c5e5df');skyColor.lerp(targetSky,dt*.7);scene.background.copy(skyColor);scene.fog.color.copy(skyColor);waterMaterial.uniforms.uSky.value.copy(skyColor);
    sun.intensity=3-weatherBlend*.8;hemisphere.intensity=2.1-weatherBlend*.12;
    waterMaterial.uniforms.uTime.value=env.time;waterMaterial.uniforms.uStorm.value=weatherBlend;waterMaterial.uniforms.uWind.value.set(Math.sin(env.windAngle),-Math.cos(env.windAngle));waterMaterial.uniforms.uReverse.value=env.reversed?-1:1;
    const wind=windAt(env.weather,env.windAngle,env.time);
    for(const p of palmCrowns){const sway=(.007+weatherBlend*.065)*Math.sin(env.time*(.9+weatherBlend*.7)+p.phase);p.group.rotation.x=sway*Math.cos(env.windAngle);p.group.rotation.z=sway*Math.sin(env.windAngle);}
    for(const f of flags){const a=f.mesh.geometry.attributes.position;for(let i=0;i<a.count;i++){const x=f.base[i*3];a.setZ(i,Math.sin(x*7+env.time*(4+weatherBlend*7)+f.phase)*(.035+weatherBlend*.17)*(x+.55));}a.needsUpdate=true;f.mesh.rotation.y=Math.atan2(-wind.z,wind.x);}
    for(const c of clouds){c.position.x+=Math.sin(env.windAngle)*dt*(.12+weatherBlend*.7);c.position.z-=Math.cos(env.windAngle)*dt*(.12+weatherBlend*.7);if(c.position.x>280)c.position.x=-280;if(c.position.x< -280)c.position.x=280;if(c.position.z>280)c.position.z=-280;if(c.position.z< -280)c.position.z=280;}
    for(const b of buoys)b.mesh.position.y=.25+Math.sin(env.time*1.5+b.phase*6)*(.05+weatherBlend*.06);
    for(const a of flowArrows){const c=currentAt(a.x,a.z,env.reversed),shift=((env.time*c.strength*.28+a.phase)%3)-1.5;a.group.position.set(a.x+c.x*shift,.13,a.z+c.z*shift);a.group.rotation.y=-Math.atan2(c.x,-c.z);a.group.children[0].material.opacity=.16+Math.sin(env.time*1.5+a.phase)*.08;}
    boat.position.y=.25+Math.sin(env.time*.9)*.09;boat.rotation.z=Math.sin(env.time*.8)*(.025+weatherBlend*.025);
    animateAvatar(dt);
    if(toastTimer>0){toastTimer-=dt;if(toastTimer<=0)$('toast').classList.remove('visible');}
    const transition=advanceTerrainTracker(terrainTracker,terrainClass(player.x,player.z),dt,env.time,$('terrainPrompts').checked,started&&!inspecting&&player.grounded&&!document.querySelector('dialog[open]'));
    if(transition)openEquipment(true);
  }
  updateCamera(dt);hudTime+=dt;if(hudTime>.1){updateHUD();hudTime=0;}
  const span=inspecting?5.5:32;if(span!==lastShadowSpan){Object.assign(sun.shadow.camera,{left:-span,right:span,top:span,bottom:-span});sun.shadow.camera.updateProjectionMatrix();lastShadowSpan=span;}sun.shadow.normalBias=inspecting?.003:.014;sun.target.position.set(player.x,player.y+.8,player.z);sun.position.set(player.x-38,player.y+78,player.z-42);
  renderer.render(scene,camera);
  frameMean=frameMean*.97+Math.min(rawDt*1000,100)*.03;qualityTime+=dt;if(qualityTime>7&&frameMean>31&&renderer.getPixelRatio()>1){renderer.setPixelRatio(1);renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);qualityTime=0;}
  frameCount++;if(frameCount>=3&&characterSettled&&$('loading')&&!$('loading').classList.contains('loaded')){$('loading').classList.add('loaded');setTimeout(()=>$('loading')?.remove(),800);}
}
window.addEventListener('resize',()=>{camera.aspect=canvas.clientWidth/canvas.clientHeight;camera.updateProjectionMatrix();renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);});
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();paused=true;toast('3D 畫面暫停，請重新整理以回到小島。');});
applyToolVisuals();animateAvatar(0);updateHUD();updateCamera(.1);requestAnimationFrame(frame);

// Read-only diagnostics for meaningful verification. No test action is enabled on the Site.
window.sunshore=Object.freeze({
  snapshot:()=>({position:{x:player.x,y:player.y,z:player.z},speed:player.speed,surface:player.water?'water':'sand',grounded:player.grounded,collision:player.collision,weather:env.weather,windAngle:env.windAngle,reversed:env.reversed,boundary:boundaryWeight(player.x,player.z),combos:discovered.size,paused,overview,render:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,pixelRatio:renderer.getPixelRatio()},fpsEstimate:Math.round(1000/frameMean)}),
  version:'1.2.0'
});
