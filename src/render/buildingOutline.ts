import * as THREE from 'three';

export interface OutlineInstances {
  mesh: THREE.InstancedMesh;
  start: number;
  count: number;
}

/** A silhouette mask of just the selected building, followed by a soft rim.
 * The composite writes the sampled building depth so foreground objects still
 * occlude the glow. Shared city geometry is borrowed, never disposed here. */
export class BuildingOutline {
  visible = false;
  readonly shape = new THREE.Scene();
  private parts: Array<{ mesh: THREE.Mesh; source: THREE.Object3D | null }> = [];
  private maskMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, toneMapped: false });
  private lotGeometry = new THREE.BoxGeometry(1, 1, 1);
  private target = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    generateMipmaps: false, depthBuffer: true,
    depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
  });
  private maskCamera = new THREE.OrthographicCamera();
  private quadScene = new THREE.Scene();
  private quadCamera = new THREE.Camera();
  private quadGeometry = new THREE.PlaneGeometry(2, 2);
  private material = new THREE.ShaderMaterial({
    transparent: true, depthTest: true, depthWrite: false, toneMapped: false,
    uniforms: {
      mask: { value: this.target.texture }, maskDepth: { value: this.target.depthTexture },
      stepUv: { value: new THREE.Vector2() }, rect: { value: new THREE.Vector4() },
      glowColor: { value: new THREE.Color(0xffc65c) }, depthSlope: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      uniform vec4 rect;
      void main() {
        vUv = uv;
        gl_Position = vec4((rect.xy + uv * rect.zw) * 2.0 - 1.0, 0.0, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D mask;
      uniform sampler2D maskDepth;
      uniform vec2 stepUv;
      uniform vec3 glowColor;
      uniform float depthSlope;
      varying vec2 vUv;
      void main() {
        float centre = texture2D(mask, vUv).r;
        if (centre > 0.99) discard;
        float distanceToShape = 8.0;
        vec2 closest = vUv;
        // Eight CSS pixels at every zoom / display density. The interior stays clear.
        for (int y = -8; y <= 8; y++) for (int x = -8; x <= 8; x++) {
          vec2 offset = vec2(float(x), float(y));
          float d = length(offset);
          if (d >= distanceToShape) continue;
          vec2 sampleUv = vUv + offset * stepUv;
          if (texture2D(mask, sampleUv).r > 0.5) {
            distanceToShape = d;
            closest = sampleUv;
          }
        }
        float edge = 1.0 - smoothstep(0.8, 2.6, distanceToShape);
        float glow = exp(-distanceToShape * distanceToShape / 16.0);
        float alpha = (1.0 - centre) * min(1.0, edge * 0.72 + glow * 0.5);
        if (distanceToShape >= 8.0 || alpha < 0.012) discard;
        // Continue a horizontal surface's depth into its surrounding pixels.
        // Otherwise the pavement clips away the entire bottom half of the rim.
        gl_FragDepth = texture2D(maskDepth, closest).r + (vUv.y - closest.y) * depthSlope - 0.0000005;
        gl_FragColor = vec4(glowColor, alpha);
        #include <colorspace_fragment>
      }`,
  });
  private bounds = new THREE.Box3();
  private boxScratch = new THREE.Box3();
  private point = new THREE.Vector3();
  private size = new THREE.Vector2();
  private previousCamera = new THREE.Matrix4();
  private previousProjection = new THREE.Matrix4();
  private previousViewport = new THREE.Vector2();
  private maskDirty = true;
  private disposed = false;
  private region: { x: number; y: number; width: number; height: number } | null = null;

  constructor() {
    const quad = new THREE.Mesh(this.quadGeometry, this.material);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
    this.target.texture.name = 'selected-building-silhouette';
  }

  get partCount(): number { return this.parts.length; }

  clear(): void {
    this.shape.clear(); this.parts = []; this.bounds.makeEmpty();
    this.maskDirty = true; this.region = null;
  }

  setInstances(ranges: OutlineInstances[]): void {
    this.clear();
    for (const { mesh: source, start, count } of ranges) for (let i = start; i < start + count; i++) {
      const mesh = new THREE.Mesh(source.geometry, this.maskMaterial);
      mesh.matrixAutoUpdate = false;
      source.getMatrixAt(i, mesh.matrix);
      mesh.matrix.premultiply(source.matrixWorld);
      this.addPart(mesh, source);
    }
  }

  /** Empty plots still need a selectable location, with the same soft edge. */
  setLot(x: number, z: number, width: number, groundHeight: number): void {
    this.clear();
    const mesh = new THREE.Mesh(this.lotGeometry, this.maskMaterial);
    mesh.position.set(x, groundHeight + .02, z); mesh.scale.set(width, .04, width); mesh.updateMatrix();
    this.addPart(mesh, null);
  }

  private addPart(mesh: THREE.Mesh, source: THREE.Object3D | null): void {
    mesh.frustumCulled = false;
    this.shape.add(mesh); this.parts.push({ mesh, source });
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    this.bounds.union(this.boxScratch.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrix));
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.OrthographicCamera): void {
    if (!this.visible || !this.parts.length || this.disposed) return;
    for (const part of this.parts) {
      const visible = part.source?.visible ?? true;
      if (part.mesh.visible !== visible) { part.mesh.visible = visible; this.maskDirty = true; }
    }
    renderer.getDrawingBufferSize(this.size);
    camera.updateMatrixWorld();
    if (!camera.matrixWorld.equals(this.previousCamera) || !camera.projectionMatrix.equals(this.previousProjection) ||
        !this.size.equals(this.previousViewport)) this.maskDirty = true;
    if (this.maskDirty) this.updateRegion(camera, renderer.getPixelRatio());
    const region = this.region;
    if (!region) return;

    const beforeTarget = renderer.getRenderTarget(), beforeAutoClear = renderer.autoClear;
    const beforeColor = renderer.getClearColor(new THREE.Color()), beforeAlpha = renderer.getClearAlpha();
    const beforeScissor = renderer.getScissorTest(), beforeInfoReset = renderer.info.autoReset;
    try {
      renderer.info.autoReset = false;
      if (this.maskDirty) {
        if (this.target.width !== region.width || this.target.height !== region.height)
          this.target.setSize(region.width, region.height);
        this.maskCamera.copy(camera);
        this.maskCamera.setViewOffset(this.size.x, this.size.y, region.x, region.y, region.width, region.height);
        renderer.setRenderTarget(this.target);
        renderer.setScissorTest(false);
        renderer.setClearColor(0x000000, 0);
        renderer.autoClear = true;
        renderer.render(this.shape, this.maskCamera);
        this.previousCamera.copy(camera.matrixWorld); this.previousProjection.copy(camera.projectionMatrix);
        this.previousViewport.copy(this.size); this.maskDirty = false;
      }
      renderer.setRenderTarget(beforeTarget);
      renderer.setScissorTest(beforeScissor);
      renderer.autoClear = false;
      const basis = camera.matrixWorld.elements;
      const groundSlope = Math.hypot(basis[8], basis[10]) / Math.max(.01, Math.abs(basis[9]));
      this.material.uniforms.depthSlope.value = region.height * 2 / camera.projectionMatrix.elements[5] /
        this.size.y * groundSlope / (camera.far - camera.near);
      this.material.uniforms.stepUv.value.set(renderer.getPixelRatio() / region.width, renderer.getPixelRatio() / region.height);
      this.material.uniforms.rect.value.set(region.x / this.size.x, 1 - (region.y + region.height) / this.size.y,
        region.width / this.size.x, region.height / this.size.y);
      renderer.render(this.quadScene, this.quadCamera);
    } finally {
      renderer.setRenderTarget(beforeTarget);
      renderer.setScissorTest(beforeScissor);
      renderer.setClearColor(beforeColor, beforeAlpha);
      renderer.autoClear = beforeAutoClear;
      renderer.info.autoReset = beforeInfoReset;
    }
  }

  private updateRegion(camera: THREE.OrthographicCamera, pixelRatio: number): void {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (let i = 0; i < 8; i++) {
      this.point.set(i & 1 ? this.bounds.max.x : this.bounds.min.x,
        i & 2 ? this.bounds.max.y : this.bounds.min.y, i & 4 ? this.bounds.max.z : this.bounds.min.z).project(camera);
      const x = (this.point.x + 1) * .5 * this.size.x, y = (1 - this.point.y) * .5 * this.size.y;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    const pad = Math.ceil(10 * pixelRatio);
    left = Math.max(0, Math.floor(left - pad)); top = Math.max(0, Math.floor(top - pad));
    right = Math.min(this.size.x, Math.ceil(right + pad)); bottom = Math.min(this.size.y, Math.ceil(bottom + pad));
    this.region = right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.clear();
    this.target.dispose(); this.maskMaterial.dispose(); this.material.dispose();
    this.quadGeometry.dispose(); this.lotGeometry.dispose();
  }
}
