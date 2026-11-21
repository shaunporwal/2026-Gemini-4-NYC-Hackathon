/* Continuous planar crowd physics. Dependency-free, deterministic, no DOM/network.
 * Positions/radii are in cells; parameter values below are metres and seconds.
 * Personal space is soft; body discs and map boundaries are hard constraints.
 * This is a game-style demonstration model, not a calibrated crush injury model. */
(function (root) {
  'use strict';
  const BODY_RADIUS = .22, PERSONAL_GAP = .24, LOOKAHEAD = 3.5;
  const ACCELERATION = 3.0, SOLVER_ITERATIONS = 32, WAIT_PERSISTENCE = .3;
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  const noise = i => { let n=Math.imul(i+1,374761393);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296; };

  function create(sim) {
    const F = root.FireSim, scale = sim.cellSize, radius = BODY_RADIUS / scale;
    const bucketSize = Math.max(1,1.2/scale), people=sim.people;
    const epsilon = .0001/scale;
    let frame=0, hash=new Map();
    const indexAt = (x,y) => Math.floor(y)*sim.W+Math.floor(x);
    const inside = (x,y) => x>=0 && y>=0 && x<sim.W && y<sim.H;
    const solid = (x,y,hazard) => !inside(x,y) || sim.solid(indexAt(x,y)) || !!sim.furn[indexAt(x,y)]
      || (sim.walkable && !sim.walkable[indexAt(x,y)]) || (hazard && !!sim.fire[indexAt(x,y)]);
    function clear(x,y,r,hazard=false) {
      for(let cy=Math.floor(y-r);cy<=Math.floor(y+r);cy++)for(let cx=Math.floor(x-r);cx<=Math.floor(x+r);cx++) {
        if(!solid(cx,cy,hazard))continue;
        const dx=x-clamp(x,cx,cx+1),dy=y-clamp(y,cy,cy+1);
        if(dx*dx+dy*dy<r*r-epsilon*epsilon)return false;
      }
      return true;
    }
    function lineClear(ax,ay,bx,by,r,hazard=true) {
      const length=Math.hypot(bx-ax,by-ay),count=Math.max(1,Math.ceil(length/(.16/scale)));
      for(let k=1;k<=count;k++) if(!clear(ax+(bx-ax)*k/count,ay+(by-ay)*k/count,r,hazard))return false;
      return true;
    }
    // Clip along the actual travelled segment first: projection cannot teleport through a wall.
    function sweep(p,x,y) {
      const distance=Math.hypot(x-p.x,y-p.y),steps=Math.max(1,Math.ceil(distance/(p.radius*.4)));
      let px=p.x,py=p.y;
      for(let k=1;k<=steps;k++) {
        const tx=p.x+(x-p.x)*k/steps,ty=p.y+(y-p.y)*k/steps;
        if(clear(tx,ty,p.radius)) { px=tx;py=ty; }
        else {
          if(clear(tx,py,p.radius))px=tx;
          if(clear(px,ty,p.radius))py=ty;
          break;
        }
      }
      return {x:px,y:py};
    }
    function projectWall(p) {
      for(let pass=0;pass<3;pass++) {
        let hit=false;
        for(let y=Math.floor(p.y-p.radius);y<=Math.floor(p.y+p.radius);y++)for(let x=Math.floor(p.x-p.radius);x<=Math.floor(p.x+p.radius);x++) {
          if(!solid(x,y,false))continue;
          const nx=clamp(p.x,x,x+1),ny=clamp(p.y,y,y+1),dx=p.x-nx,dy=p.y-ny,d=Math.hypot(dx,dy);
          if(d>=p.radius-epsilon)continue;
          hit=true;
          if(d>1e-8) {const correction=p.radius-d+epsilon;p.x+=dx/d*correction;p.y+=dy/d*correction;}
          else {
            const gaps=[p.x-x,x+1-p.x,p.y-y,y+1-p.y],side=gaps.indexOf(Math.min(...gaps));
            if(side===0)p.x=x-p.radius-epsilon;else if(side===1)p.x=x+1+p.radius+epsilon;
            else if(side===2)p.y=y-p.radius-epsilon;else p.y=y+1+p.radius+epsilon;
          }
        }
        if(!hit)break;
      }
    }
    function buildHash() {
      hash=new Map();
      for(const p of people)if(p.state===F.ACTIVE || p.state===F.INJURED) {
        const key=Math.floor(p.x/bucketSize)+','+Math.floor(p.y/bucketSize);
        if(!hash.has(key))hash.set(key,[]);hash.get(key).push(p);
      }
    }
    function neighbors(p,range,fn) {
      const left=Math.floor((p.x-range)/bucketSize),right=Math.floor((p.x+range)/bucketSize);
      const top=Math.floor((p.y-range)/bucketSize),bottom=Math.floor((p.y+range)/bucketSize);
      for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++)for(const q of hash.get(x+','+y)||[])if(q!==p)fn(q);
    }
    // Determine the side of an exit from the modeled room, not the current travel direction.
    const exitPlanes=sim.openings.map((o,openingIndex)=>{
      if(o.kind!=='exit')return null;
      const r=o.ref,cx=r.x+r.w/2,cy=r.y+r.h/2;
      const candidates=r.w>r.h?[[0,1],[0,-1]]:r.h>r.w?[[1,0],[-1,0]]:[[1,0],[-1,0],[0,1],[0,-1]];
      let best=null;
      for(const [nx,ny] of candidates) {
        let approach=0,outside=0;
        const count=nx?r.h:r.w;
        for(let k=0;k<count;k++) {
          const ax=nx>0?r.x-1:nx<0?r.x+r.w:r.x+k,ay=ny>0?r.y-1:ny<0?r.y+r.h:r.y+k;
          const bx=nx>0?r.x+r.w:nx<0?r.x-1:r.x+k,by=ny>0?r.y+r.h:ny<0?r.y-1:r.y+k;
          if(!solid(ax,ay,false))approach++;
          if(!inside(bx,by)||!sim.covered[indexAt(bx,by)]||solid(bx,by,false))outside++;
        }
        const score=approach*4+outside;
        if(!best||score>best.score)best={openingIndex,cx,cy,nx,ny,score,ref:r};
      }
      return best;
    });
    people.forEach((p,id)=>{
      p.id=id;
      p.x=Number.isFinite(p.x)?p.x:p.i%sim.W+.5;p.y=Number.isFinite(p.y)?p.y:Math.floor(p.i/sim.W)+.5;
      p.prevX=p.x;p.prevY=p.y;p.vx=0;p.vy=0;p.radius=radius;
      p.preferredSpeed=(1.1+noise(id)*.35)/scale;
      p.density=0;p.contact=0;p.compression=0;p.queueOpening=-1;p.queueStreakSeconds=0;
      p._waitSeconds=0;p._waitOpening=-1;p._targetX=p.x;p._targetY=p.y;p._routeOpening=-1;
      p._bestDistance=Infinity;p._planTick=-1;p._desiredX=0;p._desiredY=0;
    });
    // Populate the prevention view without moving anyone or advancing the simulation.
    buildHash();
    for(const p of people)if(p.state===F.ACTIVE || p.state===F.INJURED) {
      let count=1;
      neighbors(p,1/scale,q=>{
        const d=Math.hypot(p.x-q.x,p.y-q.y),gap=d-p.radius-q.radius;
        if(d<1/scale)count++;
        if(gap<.02/scale)p.contact++;
        p.compression=Math.max(p.compression,clamp(1-gap/(PERSONAL_GAP/scale),0,1));
      });
      p.density=count/Math.PI;
    }

    function plan(p) {
      const dist=sim.distanceFor(p),limit=LOOKAHEAD/scale,routed=Number.isFinite(sim.distanceFor(p)[p.i]);
      let cell=p.i,tx=cell%sim.W+.5,ty=Math.floor(cell/sim.W)+.5;
      let opening=sim.tagOf[cell],bestX=tx,bestY=ty;
      if(sim.type[cell]===F.EXIT) {
        const plane=exitPlanes[sim.tagOf[cell]];
        if(plane) {p._targetX=plane.cx+plane.nx*.3;p._targetY=plane.cy+plane.ny*.3;p._routeOpening=plane.openingIndex;return;}
      }
      for(let step=0;step<Math.ceil(limit*2)+2;step++) {
        let next=-1,score=routed?dist[cell]:sim.smoke[cell]+sim.nearFire[cell];
        for(const edge of sim.adj[cell]) {
          if(!sim.canStep(edge))continue;
          const value=routed?dist[edge.j]:sim.smoke[edge.j]+sim.nearFire[edge.j];
          if(value<score-1e-6){score=value;next=edge.j;}
        }
        if(next<0)break;
        const x=next%sim.W+.5,y=Math.floor(next/sim.W)+.5;
        if(opening<0 && sim.tagOf[next]>=0)opening=sim.tagOf[next];
        if(Math.hypot(x-p.x,y-p.y)>limit)break;
        // Only smooth the already hazard-weighted route through visible, body-wide floor.
        if(!lineClear(p.x,p.y,x,y,p.radius,true))break;
        bestX=x;bestY=y;cell=next;
        if(sim.type[cell]===F.EXIT)break;
      }
      p._targetX=bestX;p._targetY=bestY;p._routeOpening=opening;
      p._planTick=sim.tick;
    }
    function step(dt) {
      frame++;
      const active=people.filter(p=>p.state===F.ACTIVE),now=sim.seconds;
      buildHash();
      for(const p of active) {
        p.prevX=p.x;p.prevY=p.y;p.contact=0;p.compression=0;
        p.i=indexAt(p.x,p.y);
        p._ready=now-(sim.alarmSeconds>=0?sim.alarmSeconds:sim.alarmTick*.5)>=p.delay*.5;
        if(frame%6===1||p._planTick!==sim.tick||Math.hypot(p._targetX-p.x,p._targetY-p.y)<.3/scale)plan(p);
        const dx=p._targetX-p.x,dy=p._targetY-p.y,length=Math.hypot(dx,dy);
        let speed=p._ready?p.preferredSpeed*(sim.smoke[p.i]>.4?.5:1)*(p.slow?.5:1):0;
        if(length<.03/scale)speed=0;
        p._desiredX=length>1e-8?dx/length*speed:0;p._desiredY=length>1e-8?dy/length*speed:0;
        let ax=(p._desiredX-p.vx)/.3,ay=(p._desiredY-p.vy)/.3;
        let spaceFactor=1;
        if(p._routeOpening>=0) {
          const r=sim.openings[p._routeOpening].ref;
          const distance=Math.hypot(p.x-clamp(p.x,r.x,r.x+r.w),p.y-clamp(p.y,r.y,r.y+r.h));
          // Give up preferred personal space at a bottleneck; body size stays fixed.
          if(distance<1.5/scale)spaceFactor=.2;
        }
        let count=1;
        neighbors(p,1/scale,q=>{
          const dx=p.x-q.x,dy=p.y-q.y,d=Math.hypot(dx,dy);
          if(d<1/scale)count++;
          if(!p._ready||d<1e-8)return;
          const body=p.radius+q.radius,gap=d-body;
          if(gap<PERSONAL_GAP/scale) {
            const push=(1-gap/(PERSONAL_GAP/scale))*1.3/scale*spaceFactor;
            ax+=dx/d*push;ay+=dy/d*push;
          }
          // Anticipate an encounter; moving agents yield to their right rather than oscillating.
          const ahead=-(dx*p._desiredX+dy*p._desiredY)/Math.max(speed,1e-8);
          const lateral=Math.abs(dx*p._desiredY-dy*p._desiredX)/Math.max(speed,1e-8);
          if(ahead>body*.5 && ahead<.85/scale && lateral<body*.9 && gap>0) {
            const closing=(p.vx-q.vx)*(-dx/d)+(p.vy-q.vy)*(-dy/d);
            if(closing>.1/scale) {ax+=p._desiredY/Math.max(speed,1e-8)*.9/scale;ay-=p._desiredX/Math.max(speed,1e-8)*.9/scale;}
          }
        });
        p.density=count/Math.PI;
        const acceleration=Math.hypot(ax,ay),cap=ACCELERATION/scale;
        if(acceleration>cap){ax*=cap/acceleration;ay*=cap/acceleration;}
        p._nextVX=p.vx+ax*dt;p._nextVY=p.vy+ay*dt;
        const v=Math.hypot(p._nextVX,p._nextVY),maxSpeed=p.preferredSpeed*1.12;
        if(v>maxSpeed){p._nextVX*=maxSpeed/v;p._nextVY*=maxSpeed/v;}
      }
      // Integrate from the same previous state for every person before resolving contacts.
      for(const p of active) {
        const point=sweep(p,p.x+p._nextVX*dt,p.y+p._nextVY*dt);
        p.x=point.x;p.y=point.y;
      }
      for(let iteration=0;iteration<SOLVER_ITERATIONS;iteration++) {
        buildHash();
        let largestOverlap=0;
        const order=iteration%2?active.slice().reverse():active;
        for(const p of order)neighbors(p,2*radius+.02/scale,q=>{
          if(q.state===F.ACTIVE && q.id<=p.id)return;
          let dx=q.x-p.x,dy=q.y-p.y,d=Math.hypot(dx,dy),minimum=p.radius+q.radius;
          if(d>=minimum)return;
          largestOverlap=Math.max(largestOverlap,minimum-d);
          if(d<1e-8){const angle=(p.id*1.7+q.id*.3)%6.283;dx=Math.cos(angle);dy=Math.sin(angle);d=1;}
          const fixed=q.state===F.INJURED;
          const shift=(minimum-Math.hypot(q.x-p.x,q.y-p.y)+epsilon)*(fixed?1:.5);
          const nx=dx/d,ny=dy/d;
          // Constrain each contact correction along its own segment. Restoring one
          // person only after solving the crowd would create overlap behind them.
          const a=sweep(p,p.x-nx*shift,p.y-ny*shift),b=fixed?{x:q.x,y:q.y}:sweep(q,q.x+nx*shift,q.y+ny*shift);
          p.x=a.x;p.y=a.y;q.x=b.x;q.y=b.y;
        });
        // Loose crowds finish quickly; a doorway jam gets the extra constraint passes.
        if(largestOverlap<.001/scale)break;
      }
      for(const p of active) {
        projectWall(p);
        if(!clear(p.x,p.y,p.radius)) {p.x=p.prevX;p.y=p.prevY;}
        p.vx=(p.x-p.prevX)/dt;p.vy=(p.y-p.prevY)/dt;
        p.i=indexAt(p.x,p.y);
        const distance=sim.distanceFor(p)[p.i];
        if(Number.isFinite(distance)&&distance<p._bestDistance-.5/scale){p._bestDistance=distance;sim.lastProgress=sim.tick;}
        for(const plane of exitPlanes) {
          if(!plane||sim.openings[plane.openingIndex].ref.locked)continue;
          const r=plane.ref;
          const within=plane.nx?p.y>=r.y+p.radius && p.y<=r.y+r.h-p.radius:p.x>=r.x+p.radius && p.x<=r.x+r.w-p.radius;
          if(!within)continue;
          const before=(p.prevX-plane.cx)*plane.nx+(p.prevY-plane.cy)*plane.ny;
          const after=(p.x-plane.cx)*plane.nx+(p.y-plane.cy)*plane.ny;
          if(before<=0 && after>0 && sim.tagOf[p.i]===plane.openingIndex) {
            sim.leave(p,sim.fire[p.i]?F.DOWN:F.OUT,plane.openingIndex);break;
          }
        }
      }
      buildHash();
      for(const q of sim.doorQueues)q.waiting=0;
      const blockers=new Map();
      for(const p of active) {
        if(p.state!==F.ACTIVE)continue;
        const preferred=Math.hypot(p._desiredX,p._desiredY);
        const forward=preferred>0?(p.vx*p._desiredX+p.vy*p._desiredY)/preferred:0;
        p._slow=p._ready && preferred>.1/scale && forward<preferred*.3;
        let blocker=null,best=Infinity;
        neighbors(p,2*radius+.3/scale,q=>{
          const dx=q.x-p.x,dy=q.y-p.y,d=Math.hypot(dx,dy),gap=d-p.radius-q.radius;
          if(gap<.02/scale)p.contact++;
          p.compression=Math.max(p.compression,clamp(1-gap/(PERSONAL_GAP/scale),0,1));
          const ahead=preferred?(dx*p._desiredX+dy*p._desiredY)/preferred:0;
          if(p._slow && gap<.3/scale && ahead>.03/scale && d<best && lineClear(p.x,p.y,q.x,q.y,.01/scale,false)) {blocker=q;best=d;}
        });
        blockers.set(p,blocker);
      }
      for(const p of active) {
        const previous=p.queueOpening;
        p.queueOpening=-1;
        let opening=-1,cursor=p;
        if(p.state===F.ACTIVE && p._slow) {
          const visited=new Set();
          for(let k=0;k<active.length&&cursor&&!visited.has(cursor);k++) {
            visited.add(cursor);
            const next=blockers.get(cursor),candidate=cursor._routeOpening;
            if(next && candidate>=0) {
              const r=sim.openings[candidate].ref;
              const dx=cursor.x-clamp(cursor.x,r.x,r.x+r.w),dy=cursor.y-clamp(cursor.y,r.y,r.y+r.h);
              if(Math.hypot(dx,dy)<1.25/scale){opening=candidate;break;}
            }
            cursor=next;
          }
        }
        if(opening>=0) {
          if(p._waitOpening===opening)p._waitSeconds+=dt;else {p._waitOpening=opening;p._waitSeconds=dt;}
          if(p._waitSeconds+1e-8>=WAIT_PERSISTENCE) {
            p.queueOpening=opening;p.queueStreakSeconds=previous===opening?p.queueStreakSeconds+dt:dt;
            const q=sim.doorQueues[opening];q.waiting++;q.people.add(p);q.waitSeconds+=dt;
            q.smokeSeconds+=Math.min(1,sim.smoke[p.i])*dt;q.maxWaitSeconds=Math.max(q.maxWaitSeconds,p.queueStreakSeconds);
          }
        } else {p._waitOpening=-1;p._waitSeconds=0;p.queueStreakSeconds=0;}
      }
      for(const q of sim.doorQueues)q.peak=Math.max(q.peak,q.waiting);
    }
    return {step,refresh(){for(const p of people)p._planTick=-1;},clear,lineClear,exitPlanes};
  }
  const api={create,parameters:{bodyRadius:BODY_RADIUS,personalGap:PERSONAL_GAP,lookahead:LOOKAHEAD,acceleration:ACCELERATION,solverIterations:SOLVER_ITERATIONS,queuePersistence:WAIT_PERSISTENCE}};
  root.ContinuousCrowd=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
