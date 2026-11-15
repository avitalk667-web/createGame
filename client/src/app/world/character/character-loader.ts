import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildCharacterClips } from './character-animation';
import { CHARACTER_CONFIG, characterModelUrl } from './character-config';
import { CharacterTemplate } from './character.types';

/** Bones the game animations need; a file without them is rejected (and the fallback avatar is used). */
export const REQUIRED_BONES = ['Hips', 'Spine', 'Head', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot', 'LeftArm', 'RightArm'];

export class CharacterLoadError extends Error {}

/**
 * Checks a loaded glTF scene and turns it into a template: one SkinnedMesh with a skeleton, the required bones,
 * a sane size, and the measurements needed to stand it on the floor at the game's height.
 */
export function makeCharacterTemplate(url: string, scene: THREE.Group, fileClips: THREE.AnimationClip[]): CharacterTemplate {
  const skinned: THREE.SkinnedMesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
  });
  if (!skinned.length) throw new CharacterLoadError(`${url}: no SkinnedMesh in the file`);
  const skeleton = skinned[0].skeleton;
  if (!skeleton?.bones.length) throw new CharacterLoadError(`${url}: the SkinnedMesh has no skeleton`);
  const boneNames = skeleton.bones.map((b) => b.name);
  const missing = REQUIRED_BONES.filter((b) => !boneNames.includes(b));
  if (missing.length) throw new CharacterLoadError(`${url}: missing bones ${missing.join(', ')}`);

  scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  for (const m of skinned) {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld));
  }
  const size = box.getSize(new THREE.Vector3());
  if (!(size.y > 0.01) || !Number.isFinite(size.y) || size.x > size.y * 2 || size.z > size.y * 2) {
    throw new CharacterLoadError(`${url}: unexpected size ${size.toArray().map((v) => v.toFixed(2)).join(' × ')} (lying down or empty?)`);
  }

  for (const m of skinned) {
    m.castShadow = true;
    m.receiveShadow = false;
    // the facial morphs of the prototype are approximate; never animate them
    if (m.morphTargetInfluences) m.morphTargetInfluences.fill(0);
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats as THREE.MeshStandardMaterial[]) {
      for (const tex of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap]) if (tex) tex.anisotropy = 4;
    }
  }

  const rest = new Map<string, { quaternion: THREE.Quaternion; position: THREE.Vector3 }>();
  for (const b of skeleton.bones) rest.set(b.name, { quaternion: b.quaternion.clone(), position: b.position.clone() });
  return {
    url,
    scene,
    scale: CHARACTER_CONFIG.targetHeight / size.y,
    groundOffset: -box.min.y,
    size,
    boneNames,
    fileClips,
    clips: buildCharacterClips(rest),
  };
}

/**
 * Loads each character file once per page and keeps it in memory: every player, every game and every round reuse
 * the same geometry and textures (each player still gets its own skeleton and mixer, see character-factory.ts).
 */
export class CharacterLoader {
  private cache = new Map<string, Promise<CharacterTemplate>>();
  private ready = new Map<string, CharacterTemplate>();
  private failed = new Set<string>();
  /** How many network loads were started (tests: proves the GLB is not fetched twice). */
  loadsStarted = 0;

  constructor(private loadGltf: (url: string) => Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> = (url) => new GLTFLoader().loadAsync(url)) {}

  load(url: string = CHARACTER_CONFIG.defaultModel): Promise<CharacterTemplate> {
    let p = this.cache.get(url);
    if (!p) {
      this.loadsStarted++;
      p = this.loadGltf(characterModelUrl(url))
        .then((gltf) => makeCharacterTemplate(url, gltf.scene, gltf.animations ?? []))
        .then((t) => {
          this.ready.set(url, t);
          return t;
        })
        .catch((err) => {
          this.failed.add(url);
          console.error(`[PORTAL X] player character "${url}" could not be loaded — using the previous avatar instead.`, err);
          throw err;
        });
      this.cache.set(url, p);
    }
    return p;
  }

  /** The template if it already finished loading (lets worlds build the figure without a frame of delay). */
  get(url: string = CHARACTER_CONFIG.defaultModel) {
    return this.ready.get(url);
  }

  hasFailed(url: string = CHARACTER_CONFIG.defaultModel) {
    return this.failed.has(url);
  }

  /** Frees the shared GPU resources (geometry, textures, materials). Live figures must be disposed first. */
  clear() {
    for (const t of this.ready.values()) {
      t.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats as THREE.MeshStandardMaterial[]) {
          for (const tex of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap, mat.aoMap]) tex?.dispose();
          mat.dispose();
        }
      });
    }
    this.cache.clear();
    this.ready.clear();
    this.failed.clear();
  }
}

/** The page-wide loader used by every game. */
export const characterLoader = new CharacterLoader();

/** Start downloading the player model early (world construction, join page) so it is ready when players appear. */
export function preloadPlayerCharacter() {
  characterLoader.load().catch(() => undefined);
}
