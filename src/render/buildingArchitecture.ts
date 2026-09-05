import {
  Group, Mesh, MeshStandardMaterial, SRGBColorSpace, CanvasTexture, LatheGeometry, Vector2, DoubleSide,
  type Material, type Object3D,
} from 'three';
import {
  buildingBoxGeometry, buildingCylinderGeometry, buildingPlaneGeometry, buildingTorusGeometry,
  isSharedBuildingResource, markSharedBuilding, sharedBuildingGeometry, sharedBuildingMaterial,
  shouldCastBuildingShadow, shouldCastCylindricalShadow,
} from './buildingGeometry';

const designationCache = new Map<string, CanvasTexture>();

/** Architectural finish lives in the existing damage tree, so armor and equipment
 * are wounded and collapse with their supporting facade, rather than floating. */
export function addBuildingArchitecture(
  root: Group, kind: string, w: number, d: number, h: number, accent: Material,
  register: (object: Object3D, fragility: number) => Object3D,
): void {
  const armor = sharedBuildingMaterial('arch-armor', () => new MeshStandardMaterial({ color: 0x87949a, metalness: 0.45, roughness: 0.46 }));
  const trim = sharedBuildingMaterial('arch-trim', () => new MeshStandardMaterial({ color: 0xc1c9c7, metalness: 0.58, roughness: 0.35 }));
  const dark = sharedBuildingMaterial('arch-dark', () => new MeshStandardMaterial({ color: 0x182730, metalness: 0.35, roughness: 0.66 }));
  const warm = sharedBuildingMaterial('arch-warm', () => new MeshStandardMaterial({ color: 0xc49b55, metalness: 0.5, roughness: 0.46 }));
  const light = sharedBuildingMaterial('arch-light', () => new MeshStandardMaterial({ color: 0xc1e8f4, emissive: 0x8cd4ed, emissiveIntensity: 0.8 }));
  const tower = ['guard-tower', 'aa-tower', 'missile-defense', 'skylance-ciws'].includes(kind);
  const box = (name: string, sx: number, sy: number, sz: number, x: number, y: number, z: number, mat: Material, fragility = 7) => {
    const mesh = new Mesh(buildingBoxGeometry(sx, sy, sz), mat);
    mesh.name = name; mesh.position.set(x, y, z);
    mesh.castShadow = shouldCastBuildingShadow(sx, sy, sz); mesh.receiveShadow = true;
    register(mesh, fragility); return mesh;
  };
  const tube = (name: string, radius: number, length: number, x: number, y: number, z: number, mat: Material) => {
    const mesh = new Mesh(buildingCylinderGeometry(radius, radius, length), mat);
    mesh.name = name; mesh.position.set(x, y, z);
    mesh.castShadow = shouldCastCylindricalShadow(radius, length); mesh.receiveShadow = true;
    register(mesh, 5); return mesh;
  };
  const ring = (name: string, radius: number, thickness: number, x: number, y: number, z: number, mat: Material) => {
    const mesh = new Mesh(buildingTorusGeometry(radius, thickness), mat);
    mesh.name = name; mesh.position.set(x, y, z); mesh.rotation.x = Math.PI / 2;
    mesh.castShadow = shouldCastCylindricalShadow(radius, thickness * 2); register(mesh, 5); return mesh;
  };
  const rail = (name: string, length: number, x: number, y: number, z: number, alongZ = false) => {
    const group = new Group(); group.name = name; group.position.set(x, y, z);
    for (const dy of [0.35, 0.9]) {
      const beam = new Mesh(buildingBoxGeometry(alongZ ? 0.075 : length, 0.075, alongZ ? length : 0.075), warm);
      beam.position.y = dy; group.add(beam);
    }
    for (let i = 0; i < 5; i++) {
      const post = new Mesh(buildingBoxGeometry(0.075, 0.95, 0.075), trim);
      post.position.set(alongZ ? 0 : (i / 4 - 0.5) * length, 0.46, alongZ ? (i / 4 - 0.5) * length : 0);
      group.add(post);
    }
    register(group, 4);
  };

  // Continuous visual foundation with recessed footing and four armored corners.
  // Each corner is independently destructible.
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    const px = x * w * 0.465, pz = z * d * 0.465;
    box('armor-corner-foot', w * 0.105, 0.72, d * 0.105, px, 0.52, pz, trim, 9);
    const pillarH = tower ? h * 0.2 : kind === 'wall' ? h * 0.9 : h * 0.54;
    box('chamfered-corner-armor', w * 0.075, pillarH, d * 0.075, px, pillarH / 2 + 0.72, pz, armor, 8);
    box('corner-identity-inlay', w * 0.078, 0.18, d * 0.078, px, pillarH + 0.54, pz, accent, 6);
  }
  if (!tower && kind !== 'wall') {
    // Back and side service facades give buildings a finished appearance at every camera angle.
    for (const side of [-1, 1]) {
      box('facade-belt', 0.25, 0.2, d * 0.86, side * w * 0.505, h * 0.51, 0, trim);
      for (const z of [-0.28, 0, 0.28]) {
        const panel = box('service-armor-cassette', 0.35, h * 0.3, d * 0.21, side * w * 0.507, h * 0.28, z * d, armor);
        panel.rotation.z = side * -0.055;
        box('service-panel-inlay', 0.37, 0.09, d * 0.14, side * w * 0.513, h * 0.35, z * d, dark, 5);
      }
      box('rear-heat-exchanger', w * 0.21, h * 0.35, 0.4, side * w * 0.26, h * 0.3, -d * 0.515, dark);
      for (let i = 0; i < 4; i++) box('exchanger-louver', w * 0.18, 0.12, 0.48, side * w * 0.26, h * 0.19 + i * 0.28, -d * 0.52, trim, 5);
    }
  }

  if (kind === 'command-yard') {
    // Overhanging CIC crown, wraparound dark glazing and communications radome.
    const dish = root.getObjectByName('command-dish');
    if (dish instanceof Mesh) {
      if (!isSharedBuildingResource(dish.geometry)) dish.geometry.dispose();
      dish.geometry = reflectorGeometry(w * 0.085);
      const reflector = sharedBuildingMaterial('arch-reflector', () => {
        const material = trim.clone(); material.side = DoubleSide; return markSharedBuilding(material);
      });
      dish.material = reflector;
      dish.rotation.set(-0.7, -0.3, 0);
      const feed = new Mesh(buildingCylinderGeometry(0.07, 0.07, w * 0.085), warm);
      feed.rotation.x = Math.PI / 2; feed.position.z = w * 0.05; dish.add(feed);
    }
    box('cic-floating-crown', w * 0.39, 0.55, d * 0.37, -w * 0.18, h * 1.73, -d * 0.12, trim, 5);
    box('cic-side-glazing', 0.2, h * 0.18, d * 0.25, -w * 0.344, h * 1.49, -d * 0.12, dark, 4);
    box('command-entry-visor', w * 0.66, 0.38, d * 0.13, 0, h * 0.8, d * 0.48, trim);
    box('command-entry-light', w * 0.54, 0.09, 0.14, 0, h * 0.76, d * 0.546, light, 4);
    // Recessed plant deck breaks up the broad HQ roof with functional machinery.
    box('cic-mechanical-deck', w * 0.2, 0.24, d * 0.42, w * 0.24, h + 0.15, -d * 0.06, dark, 6);
    for (const z of [-0.2, -0.06, 0.08]) {
      tube('cic-cooling-fan-shroud', w * 0.058, 0.3, w * 0.24, h + 0.42, z * d, armor);
      ring('cic-cooling-fan-rim', w * 0.052, 0.07, w * 0.24, h + 0.59, z * d, trim);
      for (const angle of [0, Math.PI / 3, Math.PI * 2 / 3]) {
        const vane = box('cic-cooling-fan-blade', w * 0.085, 0.08, 0.2, w * 0.24, h + 0.59, z * d, dark, 4);
        vane.rotation.y = angle;
      }
    }
    box('cic-roof-access-hatch', w * 0.15, 0.28, d * 0.16, -w * 0.18, h + 0.2, d * 0.22, armor, 6);
    box('cic-hatch-inset', w * 0.12, 0.08, d * 0.13, -w * 0.18, h + 0.38, d * 0.22, dark, 5);
    for (const side of [-1, 1]) rail('command-roof-safety-rail', d * 0.54, side * w * 0.38, h + 0.1, 0, true);
  } else if (kind === 'power-plant') {
    // Containment rings, heavy cooling ribs and insulated outgoing busbars.
    for (const x of [-w * 0.26, w * 0.22]) {
      ring('cooling-tower-service-ring', w * 0.205, 0.14, x, h * 2.16, -d * 0.18, trim);
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        const rib = box('cooling-tower-rib', 0.16, h * 0.61, 0.22, x + Math.cos(a) * w * 0.177, h * 1.93, -d * 0.18 + Math.sin(a) * w * 0.177, armor, 5);
        rib.rotation.y = -a;
      }
    }
    for (const z of [-0.22, 0, 0.22]) tube('generator-busbar', 0.16, w * 0.5, w * 0.12, h + 0.58, z * d, warm).rotation.z = Math.PI / 2;
  } else if (kind === 'refinery') {
    rail('refinery-catwalk-rail', w * 0.46, 0, h * 1.42, -d * 0.16);
    for (let i = 0; i < 4; i++) ring('distillation-flange', w * 0.105, 0.12, w * 0.08, h * 1.18 + i * h * 0.24, -d * 0.28, trim);
    for (const z of [-d * 0.24, d * 0.12]) {
      for (const dx of [-0.08, 0.08]) {
        const band = ring('pressure-vessel-strap', w * 0.114, 0.12, w * (0.28 + dx), h + 0.9, z, warm);
        band.rotation.set(0, Math.PI / 2, 0);
      }
    }
  } else if (kind === 'barracks') {
    for (const side of [-1, 1]) for (const z of [-0.24, -0.08, 0.08, 0.24]) {
      const rib = box('barracks-standing-roof-seam', w * 0.45, 0.12, 0.16, side * w * 0.22, h * 1.29, z * d, trim, 5);
      rib.rotation.z = side * 0.14;
    }
    box('barracks-entry-blast-frame', w * 0.31, 0.42, d * 0.2, -w * 0.26, h * 0.82, d * 0.54, armor);
    box('barracks-entry-downlight', w * 0.19, 0.08, 0.12, -w * 0.26, h * 0.77, d * 0.635, light, 4);
  } else if (kind === 'factory') {
    for (const x of [-0.34, 0.2]) {
      box('factory-high-bay-exoskeleton', w * 0.04, h * 0.65, d * 0.58, x * w, h * 1.3, -d * 0.02, trim, 7);
    }
    rail('factory-maintenance-rail', d * 0.68, w * 0.34, h + 0.2, -d * 0.01, true);
    box('factory-loading-visor', w * 0.76, 0.42, d * 0.09, -w * 0.06, h * 0.83, d * 0.51, armor);
    box('factory-bay-light', w * 0.57, 0.11, 0.15, -w * 0.06, h * 0.785, d * 0.55, light, 4);
  } else if (kind === 'helipad') {
    for (const side of [-1, 1]) {
      box('flight-deck-edge', w * 0.96, 0.3, 0.28, 0, h + 0.28, side * d * 0.48, trim);
      for (const x of [-0.32, -0.16, 0, 0.16, 0.32]) box('approach-light', 0.55, 0.1, 0.24, x * w, h + 0.49, side * d * 0.456, light, 4);
    }
    rail('flight-control-safety-rail', d * 0.62, -w * 0.475, h + 0.42, -d * 0.02, true);
  } else if (kind === 'intelligence-center') {
    // Replace the flat half-ring dish with a deep parabolic reflector and feed support.
    const radar = root.getObjectByName('intelligence-radar');
    const dish = root.getObjectByName('intelligence-dish');
    if (radar && dish instanceof Mesh) {
      if (!isSharedBuildingResource(dish.geometry)) dish.geometry.dispose();
      dish.geometry = reflectorGeometry(w * 0.31);
      const reflector = sharedBuildingMaterial('arch-reflector', () => {
        const material = trim.clone(); material.side = DoubleSide; return markSharedBuilding(material);
      });
      dish.material = reflector;
      const rim = new Mesh(buildingTorusGeometry(w * 0.31, 0.12, 5, 16), armor);
      rim.position.z = w * 0.31 * 0.31 / 0.8; dish.add(rim);
    }
    for (const x of [-0.3, 0.3]) box('intel-server-spine', w * 0.12, 0.8, d * 0.62, x * w, h + 0.72, 0, armor, 6);
    rail('intel-service-rail', w * 0.76, 0, h + 0.32, -d * 0.42);
  } else if (kind === 'strategic-silo') {
    for (const x of [-0.38, 0.38]) {
      box('silo-blast-revetment', w * 0.07, h * 0.53, d * 0.76, x * w, h * 1.29, -d * 0.02, armor, 8);
      box('silo-revetment-cap', w * 0.085, 0.16, d * 0.78, x * w, h * 1.56, -d * 0.02, trim, 6);
    }
    rail('silo-crew-rail', w * 0.6, 0, h + 0.44, -d * 0.44);
  } else if (tower) {
    // Structural shaft cladding exposes the stepped defense silhouette.
    for (const side of [-1, 1]) {
      const strut = box('defense-sloped-buttress', w * 0.095, h * 0.53, d * 0.1, side * w * 0.23, h * 0.45, -d * 0.16, trim, 7);
      strut.rotation.z = side * -0.14;
      box('defense-shaft-inlay', 0.16, h * 0.31, 0.2, side * w * 0.212, h * 0.46, d * 0.217, accent, 5);
      box('defense-deck-fascia', w * 0.62, 0.35, 0.28, 0, h * 0.72, side * d * 0.3, armor, 7);
    }
    ring('defense-bearing-race', w * 0.25, 0.13, 0, h + 0.22, 0, trim);
  } else if (kind === 'wall') {
    for (const side of [-1, 1]) {
      box('wall-blast-belt', w * 0.92, 0.28, 0.26, 0, h * 0.5, side * d * 0.52, trim, 8);
      box('wall-faction-band', w * 0.56, 0.2, 0.28, 0, h * 0.86, side * d * 0.52, accent, 6);
    }
  }

  // One purposeful, readable designation and hazard strip per structure.
  const codes: Record<string, string> = {
    'command-yard': 'CIC / 01', 'power-plant': 'PWR / 02', refinery: 'ORE / 03', barracks: 'INF / 04',
    factory: 'FAB / 05', helipad: 'AIR / 06', 'intelligence-center': 'INT / 07', 'strategic-silo': 'STR / 08',
    wall: 'BLAST / 09', 'guard-tower': 'FRT / 10', 'aa-tower': 'AA / 11', 'missile-defense': 'SAM / 12', 'skylance-ciws': 'CIWS / 13',
  };
  const texture = designationTexture(kind, codes[kind] ?? 'BASE');
  const placard = new Mesh(buildingPlaneGeometry(w * 0.3, w * 0.075), sharedBuildingMaterial(`arch-sign-${kind}`, () => new MeshStandardMaterial({ map: texture, roughness: 0.65 })));
  placard.name = 'building-designation'; placard.position.set(0, tower ? h * 0.12 : h * 0.2, d * 0.542 + 0.18);
  register(placard, 5);
}

function designationTexture(kind: string, code: string): CanvasTexture {
  const cached = designationCache.get(kind);
  if (cached) return cached;
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#15252e'; ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#d6dfdb'; ctx.font = 'bold 54px monospace'; ctx.fillText(code, 20, 72);
  ctx.fillStyle = '#c8a052';
  for (let x = 0; x < 512; x += 34) { ctx.beginPath(); ctx.moveTo(x, 102); ctx.lineTo(x + 18, 102); ctx.lineTo(x + 6, 126); ctx.lineTo(x - 12, 126); ctx.fill(); }
  const texture = markSharedBuilding(new CanvasTexture(canvas)); texture.colorSpace = SRGBColorSpace;
  designationCache.set(kind, texture);
  return texture;
}

function reflectorGeometry(radius: number): LatheGeometry {
  return sharedBuildingGeometry(`reflector:${radius}`, () => {
    const points = Array.from({ length: 9 }, (_, i) => {
      const r = radius * i / 8;
      return new Vector2(r, r * r / (radius * 2.58));
    });
    const geometry = new LatheGeometry(points, 16);
    geometry.rotateX(Math.PI / 2);
    return geometry;
  }) as LatheGeometry;
}
