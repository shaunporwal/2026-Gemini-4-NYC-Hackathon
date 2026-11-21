/* Procedural flame/smoke presentation. Only burning cells emit flame; smoke comes from sim.smoke.
 * Instancing keeps a whole-building fire to four draw calls. No simulation mutations or textures to fetch. */
(function () {
  'use strict';
  const T = window.THREE;
  const noise = `
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);
    }
  `;
  const vertex = `
    varying vec2 vUv; varying float vSeed; varying vec3 vTint;
    void main() {
      vUv=uv; vSeed=instanceMatrix[3].x*3.71+instanceMatrix[3].z*8.39;
      vTint=instanceColor;
      vec4 center=modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.);
      center.xy+=position.xy*vec2(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz));
      gl_Position=projectionMatrix*center;
    }
  `;
  const flameFragment = `
    uniform float uTime; varying vec2 vUv; varying float vSeed; varying vec3 vTint;
    ${noise}
    void main() {
      float y=vUv.y, t=uTime*2.8+vSeed;
      float curl=(noise(vec2(y*3.5-t*.35,t*.5))-.5)*.38*y;
      float x=abs(vUv.x-.5+curl);
      float turbulence=noise(vec2(vUv.x*6.+vSeed,y*7.-t*2.));
      float width=.47*pow(1.-y,.75)*( .8+.3*turbulence);
      float edge=1.-smoothstep(width*.45,width+.025,x);
      float tip=1.-smoothstep(.72,1.,y+.15*(1.-turbulence));
      float base=smoothstep(0.,.055,y);
      float alpha=edge*tip*base;
      if(alpha<.015) discard;
      float core=(1.-smoothstep(.02,width*.75,x))*(1.-smoothstep(.05,.65,y));
      vec3 color=mix(vec3(1.,.12,.015),vec3(1.,.64,.06),edge*.7);
      color=mix(color,vec3(1.,.96,.66),core);
      gl_FragColor=vec4(color,alpha*.92);
    }
  `;
  const smokeFragment = `
    uniform float uTime; varying vec2 vUv; varying float vSeed; varying vec3 vTint;
    ${noise}
    void main() {
      vec2 p=vUv*2.-1.; float r=length(p);
      float n=noise(vUv*4.+vec2(vSeed,uTime*-.15));
      float edge=1.-smoothstep(.3,.98,r+(n-.5)*.28);
      float alpha=edge*vTint.r*(.28+.17*n);
      if(alpha<.01) discard;
      gl_FragColor=vec4(mix(vec3(.21,.23,.22),vec3(.48,.49,.46),n),alpha);
    }
  `;
  function create(group, capacity) {
    const plane = new T.PlaneGeometry(1, 1), sparkShape = new T.SphereGeometry(.5, 5, 4);
    const time = { value: 0 };
    const material = fragmentShader => new T.ShaderMaterial({ vertexShader: vertex, fragmentShader,
      uniforms: { uTime: time }, transparent: true, depthWrite: false, side: T.DoubleSide, toneMapped: false });
    function mesh(geometry, mat, count) {
      const m = new T.InstancedMesh(geometry, mat, Math.max(1, count));
      m.setColorAt(0,new T.Color(1,1,1)); m.count=0; m.frustumCulled=false; group.add(m); return m;
    }
    const flame=mesh(plane,material(flameFragment),capacity*2), smoke=mesh(plane,material(smokeFragment),capacity);
    const sparks=mesh(sparkShape,new T.MeshBasicMaterial({color:0xffd07a,transparent:true,opacity:.8,depthWrite:false,toneMapped:false}),capacity);
    const textureCanvas=document.createElement('canvas'); textureCanvas.width=textureCanvas.height=64;
    const ctx=textureCanvas.getContext('2d'), gradient=ctx.createRadialGradient(32,32,0,32,32,32);
    gradient.addColorStop(0,'rgba(255,139,35,.55)'); gradient.addColorStop(.5,'rgba(255,83,10,.24)'); gradient.addColorStop(1,'rgba(255,70,0,0)');
    ctx.fillStyle=gradient; ctx.fillRect(0,0,64,64);
    const glowTexture=new T.CanvasTexture(textureCanvas);
    const glow=mesh(plane,new T.MeshBasicMaterial({map:glowTexture,transparent:true,depthWrite:false,side:T.DoubleSide,toneMapped:false}),capacity);
    glow.renderOrder=1; flame.renderOrder=2; smoke.renderOrder=3; sparks.renderOrder=4;
    const matrix=new T.Matrix4(), color=new T.Color(), rotation=new T.Quaternion(), position=new T.Vector3(), scale=new T.Vector3();
    const floorRotation=new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),-Math.PI/2);
    function put(m,k,x,y,z,w,h,d=1,tint=1,floor=false) {
      matrix.compose(position.set(x,y,z),floor?floorRotation:rotation,scale.set(w,h,d));
      m.setMatrixAt(k,matrix); m.setColorAt(k,color.setRGB(tint,tint,tint));
    }
    function done(m,count) {m.count=count;m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true;}
    function draw(sim,seconds,reduced) {
      time.value=reduced?0:seconds;
      let nf=0,ns=0,ng=0,ne=0;
      for(let i=0;i<sim.N;i++) {
        if(!sim.covered[i] || sim.type[i]===window.FireSim.WALL)continue;
        const x=i%sim.W+.5,z=Math.floor(i/sim.W)+.5,phase=(i*.61803398875)%1;
        if(sim.fire[i]) {
          const pulse=reduced?0:Math.sin(seconds*6+phase*15)*.12;
          const height=1.65+phase*.85+pulse;
          const flameX=x+Math.sin(i*17.13)*.18,flameZ=z+Math.cos(i*9.31)*.18;
          put(flame,nf++,flameX,height*.5+.08,flameZ,1.5,height);
          put(flame,nf++,x+.2*Math.sin(phase*20),.64,z+.18,.85,1.2);
          put(glow,ng++,x,.095,z,1.75,1.75,1,1,true);
          if(i%3===0) {
            const rise=reduced ? .5 :(seconds*.65+phase)%1;
            put(sparks,ne++,x+Math.sin(rise*8+phase*8)*.22,.4+rise*2.6,z+Math.cos(phase*9)*.2,.055,.12,.055);
          }
        }
        if(sim.smoke[i]>.05) {
          const density=Math.min(1,sim.smoke[i]);
          const lift=reduced?0:Math.sin(seconds*.7+phase*7)*.07;
          put(smoke,ns++,x,1.7+lift+phase*.4,z,1.55+phase*.25,1.1+density*.7,1,density);
        }
      }
      done(flame,nf);done(smoke,ns);done(glow,ng);done(sparks,ne);
    }
    // Mesh instances/materials are disposed by the renderer; these resources are private to this build.
    function dispose(){plane.dispose();sparkShape.dispose();glowTexture.dispose();}
    return {draw,dispose};
  }
  window.HazardVisual={create};
})();
