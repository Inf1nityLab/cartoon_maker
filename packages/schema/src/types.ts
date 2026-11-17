import { z } from 'zod';

export const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = [number, number, number];
/** string = id места (places) или сущности */
export const Target = z.union([z.string(), Vec3]);
export type Target = string | Vec3;

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'цвет — hex-строка #rrggbb');
export { Hex };

// ===== Сохраняется в базу. Никаких типов Three.js. =====
export const ComponentInstanceSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  version: z.number().int().min(1),
  params: z.record(z.string(), z.unknown()),
});
export type ComponentInstance = z.infer<typeof ComponentInstanceSchema>;

export const EntitySchema = ComponentInstanceSchema.extend({
  spawn: z.object({ at: Target, heading: z.number() }),
});
export type Entity = z.infer<typeof EntitySchema>;

export const TimelineEventSchema = z.object({
  id: z.string().min(1),
  t: z.number().min(0),
  target: z.string().min(1), // 'world' | 'camera' | id сущности
  action: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
});
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

export const AssetRefSchema = z.object({
  id: z.string(),
  kind: z.enum(['gltf', 'vrm', 'texture', 'audio']),
  hash: z.string(), // адрес по содержимому (R2: assets/<hash>)
  license: z.string(),
  sourceUrl: z.string().optional(),
});
export type AssetRef = z.infer<typeof AssetRefSchema>;

export const KeyframeTrackSchema = z.object({
  target: z.string(),
  property: z.string(),
  keys: z.array(z.object({ t: z.number(), v: z.unknown(), ease: z.string().optional() })),
});
export type KeyframeTrack = z.infer<typeof KeyframeTrackSchema>;

export const SceneDocSchema = z.object({
  schema: z.literal('scene@1'),
  id: z.string().min(1),
  title: z.string(),
  settings: z.object({
    fps: z.union([z.literal(30), z.literal(60)]),
    duration: z.number().positive(),
    seed: z.number().int(),
    aspect: z.enum(['16:9', '9:16', '1:1']),
  }),
  world: z.array(ComponentInstanceSchema),
  entities: z.record(z.string(), EntitySchema),
  places: z.record(z.string(), Vec3),
  paths: z.record(z.string(), z.object({ points: z.array(Vec3).min(2), closed: z.boolean() })),
  camera: z.object({ shots: z.record(z.string(), ComponentInstanceSchema) }),
  timeline: z.array(TimelineEventSchema),
  tracks: z.array(KeyframeTrackSchema).optional(),
  assets: z.array(AssetRefSchema),
});
export type SceneDoc = z.infer<typeof SceneDocSchema>;

// ===== Фильм (раздел 9). Формат данных; логика — в engine/film.ts. =====
export const CharacterRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  family: z.string(),
  params: z.record(z.string(), z.unknown()),
  description: z.string(),
});
export type CharacterRef = z.infer<typeof CharacterRefSchema>;

export const FilmSceneSchema = z.object({
  id: z.string(),
  sceneDocId: z.string(),
  title: z.string(),
  summary: z.string(),
  link: z.enum(['continue', 'cut']),
  transition: z.object({ kind: z.enum(['cut', 'fade', 'dissolve']), duration: z.number().min(0) }),
});
export type FilmScene = z.infer<typeof FilmSceneSchema>;

export const ClipSchema = z.object({
  id: z.string(),
  start: z.number().min(0), // время ФИЛЬМА, секунды
  end: z.number().min(0),
  data: z.record(z.string(), z.unknown()),
});
export type Clip = z.infer<typeof ClipSchema>;

export const TrackSchema = z.object({
  id: z.string(),
  kind: z.enum(['music', 'light', 'sfx', 'voice', 'subtitles', 'ai-notes']),
  clips: z.array(ClipSchema),
});
export type Track = z.infer<typeof TrackSchema>;

export const FilmDocSchema = z.object({
  schema: z.literal('film@1'),
  id: z.string().min(1),
  title: z.string(),
  bible: z.object({
    logline: z.string(),
    characters: z.array(CharacterRefSchema),
    world: z.string(),
    style: z.string(),
  }),
  acts: z.array(z.object({ id: z.string(), title: z.string(), summary: z.string(), sceneIds: z.array(z.string()) })),
  scenes: z.array(FilmSceneSchema),
  tracks: z.array(TrackSchema),
});
export type FilmDoc = z.infer<typeof FilmDocSchema>;

// ===== Вычисляется движком для любого t. То, что «видит» ИИ. Не хранится как источник правды. =====
export type EntityState = {
  type: string;
  pos: Vec3;
  heading: number;
  action: string; // 'walking' | 'standing' | 'running' …
  speed: number;
  [k: string]: unknown;
};
/** Глубина резкости камеры: расстояние фокуса (м, вдоль взгляда), полуширина зоны резкости (м), сила — макс. радиус нерезкости в пикселях кадра 720p. */
export type CameraDof = { focus: number; range: number; strength: number };
export type WorldState = {
  t: number;
  sun: { elevation: number; azimuth: number };
  camera: { shot: string; pos: Vec3; target: Vec3; fov: number; dof?: CameraDof };
  inFrame: string[]; // id сущностей и мест в кадре
  entities: Record<string, EntityState>;
};
