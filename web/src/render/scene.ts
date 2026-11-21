import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CellType, type MapModel } from "../shared/types";
import { SPEC_BY_CODE } from "../map/cellTypes";

/** Shrink furniture slightly inside its cell so adjacent chairs/tables read as separate voxels. */
const INSET: Partial<Record<CellType, number>> = { [CellType.Chair]: 0.7, [CellType.Table]: 0.96 };
const FLOOR_T = 0.05; // floor tile thickness (m)
const PERSON = { bodyH: 1.2, bodyW: 0.35, headS: 0.28, color: 0xffd28a, headColor: 0xf2b880 };

/**
 * Voxel renderer for any map size. Driven entirely by the cell-type registry: one InstancedMesh
 * per cell type, plus instanced people (body + head) and camera markers/cones.
 * World: X = x*cellSize, Z = y*cellSize, Y up (metres).
 */
export class VoxelScene {
  readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
  readonly controls: OrbitControls;
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  private readonly tmp = new THREE.Matrix4();
  private readonly raycaster = new THREE.Raycaster();
  private readonly floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private bodies!: THREE.InstancedMesh;
  private flames: THREE.InstancedMesh;
  private haze: THREE.InstancedMesh;
  private heads!: THREE.InstancedMesh;

  constructor(private readonly container: HTMLElement, private readonly map: MapModel, maxPeople = 5000) {
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x0e1116);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(1, 2, 1.5);
    this.scene.add(sun);

    const s = map.cellSize;
    const cx = (map.width * s) / 2;
    const cz = (map.height * s) / 2;
    const span = Math.max(map.width, map.height) * s + 6; // +6 m keeps tiny maps from starting inside a wall
    this.camera.position.set(cx, span * 0.85, cz + span * 0.75);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(cx, 0, cz);
    this.controls.update();

    this.buildCells();
    this.buildPeople(Math.max(maxPeople, map.people.length));
    this.flames = this.instanced(0xff640e, map.cells.length, { emissive: 0xce3400 });
    this.haze = this.instanced(0xc4cbd0, map.cells.length, { transparent: true, opacity: 0.37, depthWrite: false });
    for (const mesh of [this.flames, this.haze, this.bodies, this.heads]) mesh.frustumCulled = false;
    this.flames.count = this.haze.count = 0;
    this.buildCameras();
    this.setPeople(map.people);

    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  /** Screen point → grid cell, or null if it misses the map. */
  pickCell(clientX: number, clientY: number): { x: number; y: number } | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.floorPlane, hit)) return null;
    const x = Math.floor(hit.x / this.map.cellSize);
    const y = Math.floor(hit.z / this.map.cellSize);
    return x >= 0 && y >= 0 && x < this.map.width && y < this.map.height ? { x, y } : null;
  }

  /** Place people at grid positions (cells, float). Call every frame once agents move. */
  setPeople(people: ReadonlyArray<{ x: number; y: number }>) {
    const s = this.map.cellSize;
    const n = Math.min(people.length, this.bodies.instanceMatrix.count);
    for (let k = 0; k < n; k++) {
      const wx = people[k].x * s;
      const wz = people[k].y * s;
      this.tmp.makeScale(PERSON.bodyW, PERSON.bodyH, PERSON.bodyW).setPosition(wx, FLOOR_T + PERSON.bodyH / 2, wz);
      this.bodies.setMatrixAt(k, this.tmp);
      this.tmp.makeScale(PERSON.headS, PERSON.headS, PERSON.headS).setPosition(wx, FLOOR_T + PERSON.bodyH + PERSON.headS / 2, wz);
      this.heads.setMatrixAt(k, this.tmp);
    }
    this.bodies.count = this.heads.count = n;
    this.bodies.instanceMatrix.needsUpdate = this.heads.instanceMatrix.needsUpdate = true;
  }

  setHazards(fire: Uint16Array, smoke: Float32Array) {
    const size = this.map.cellSize;
    this.flames.count = this.haze.count = 0;
    for (let i = 0; i < fire.length; i++) {
      if (!fire[i] && smoke[i] < 0.025) continue;
      const mesh = fire[i] ? this.flames : this.haze;
      const height = fire[i] ? 0.9 : 0.12 + 0.65 * smoke[i];
      const x = (i % this.map.width + 0.5) * size;
      const z = (Math.floor(i / this.map.width) + 0.5) * size;
      const base = SPEC_BY_CODE[this.map.cells[i]].height ?? 0;
      this.tmp.makeScale(size * 0.94, height, size * 0.94).setPosition(x, base + FLOOR_T + height / 2, z);
      mesh.setMatrixAt(mesh.count++, this.tmp);
    }
    this.flames.instanceMatrix.needsUpdate = this.haze.instanceMatrix.needsUpdate = true;
  }

  draw() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private instanced(color: number, count: number, opts: THREE.MeshLambertMaterialParameters = {}) {
    const mesh = new THREE.InstancedMesh(this.box, new THREE.MeshLambertMaterial({ color, ...opts }), Math.max(1, count));
    mesh.count = count;
    this.scene.add(mesh);
    return mesh;
  }

  private buildCells() {
    const { map } = this;
    const s = map.cellSize;
    const byCode = new Map<number, number[]>();
    const floorUnder: number[] = []; // floor tiles beneath furniture and floor-like cells
    for (let i = 0; i < map.cells.length; i++) {
      const code = map.cells[i];
      if (code === CellType.Void) continue;
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code)!.push(i);
      if (code === CellType.Table || code === CellType.Chair) floorUnder.push(i);
    }
    byCode.get(CellType.Floor)?.push(...floorUnder);

    for (const [code, list] of byCode) {
      const spec = SPEC_BY_CODE[code];
      const h = spec.height === null ? map.wallHeight : spec.height;
      const flat = h === 0;
      const height = flat ? FLOOR_T + (code === CellType.Floor ? 0 : 0.01) : h;
      const inset = INSET[code as CellType] ?? 1;
      const mesh = this.instanced(spec.color, list.length);
      list.forEach((i, k) => {
        const x = i % map.width;
        const y = (i - x) / map.width;
        const yBase = flat ? 0 : FLOOR_T;
        this.tmp.makeScale(s * inset, height, s * inset).setPosition((x + 0.5) * s, yBase + height / 2, (y + 0.5) * s);
        mesh.setMatrixAt(k, this.tmp);
      });
    }
  }

  private buildPeople(max: number) {
    this.bodies = this.instanced(PERSON.color, max);
    this.heads = this.instanced(PERSON.headColor, max);
  }

  private buildCameras() {
    const { map } = this;
    const s = map.cellSize;
    for (const cam of map.cameras) {
      const marker = new THREE.Mesh(this.box, new THREE.MeshLambertMaterial({ color: 0xffcc00 }));
      marker.scale.setScalar(s * 0.8);
      marker.position.set(cam.position.x * s, cam.position.z, cam.position.y * s);
      this.scene.add(marker);

      const cone = this.instanced(0xffcc00, cam.visibleCells.length, { transparent: true, opacity: 0.2, depthWrite: false });
      cam.visibleCells.forEach((i, k) => {
        const x = i % map.width;
        const y = (i - x) / map.width;
        this.tmp.makeScale(s, 0.01, s).setPosition((x + 0.5) * s, FLOOR_T + 0.02, (y + 0.5) * s);
        cone.setMatrixAt(k, this.tmp);
      });
    }
  }
}
