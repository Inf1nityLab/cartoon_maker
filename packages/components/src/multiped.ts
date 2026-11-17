import { z } from 'zod';
import { defineComponent } from '@cartoon/engine';
import { Hex, Target, type Vec3 } from '@cartoon/schema';

const Params = z.object({
  legs: z.number().int().min(4).max(12).default(8),
  bodyHeight: z.number().min(0.3).max(5).default(1.35),
  upperLeg: z.number().min(0.2).max(6).default(1.75),
  lowerLeg: z.number().min(0.2).max(6).default(2.15),
  color: Hex.default('#ff5a1f'),
});

type Self = {
  pos: Vec3;
  heading: number; // градусы, 0 = +Z
  mode: 'idle' | 'goto' | 'path';
  goal: Vec3 | null;
  pathId: string | null;
  u: number;
  loop: boolean;
  want: number; // желаемая скорость
  speed: number; // текущая
  phase: number; // фаза шага, радианы
  look: Vec3 | 'camera' | null;
};

const turn = (cur: number, want: number, maxStep: number) => {
  const d = Math.max(-maxStep, Math.min(maxStep, ((want - cur + 540) % 360) - 180));
  return cur + d;
};
const bearing = (from: Vec3, to: Vec3) => (Math.atan2(to[0] - from[0], to[2] - from[2]) * 180) / Math.PI;

/** Многоногое существо. Пока без IK: походка двумя группами ног по фазе, вид рисует ноги по ней. */
export const Multiped = defineComponent<z.infer<typeof Params>, Self>({
  type: 'Multiped',
  version: 1,
  describe: 'Механическое многоногое существо (паук, краб). Ходит по рельефу, ноги шагают двумя группами.',
  params: Params,
  actions: {
    walkTo: z.object({ to: Target, speed: z.number().min(0).max(5).default(2) }),
    followPath: z.object({ path: z.string(), speed: z.number().min(0).max(5).default(2), loop: z.boolean().default(true) }),
    stop: z.object({}),
    lookAt: z.object({ target: z.union([Target, z.literal('camera')]).nullable() }),
  },
  create(ctx, _p, spawn) {
    const at = spawn!.at;
    return {
      pos: [at[0], ctx.heightAt(at[0], at[2]), at[2]], heading: spawn!.heading,
      mode: 'idle', goal: null, pathId: null, u: 0, loop: true, want: 0, speed: 0, phase: 0, look: null,
    };
  },
  onAction(s, name, a, ctx) {
    if (name === 'walkTo') { s.mode = 'goto'; s.goal = ctx.resolve(a.to); s.want = a.speed; s.look = null; }
    else if (name === 'followPath') {
      const path = ctx.path(a.path);
      // встаём на ближайшую точку пути
      let best = 0, bd = Infinity;
      for (let i = 0; i <= 200; i++) {
        const p = path.getPointAt(i / 200);
        const d = Math.hypot(p[0] - s.pos[0], p[2] - s.pos[2]);
        if (d < bd) { bd = d; best = i / 200; }
      }
      s.mode = 'path'; s.pathId = a.path; s.u = best; s.loop = a.loop; s.want = a.speed; s.look = null;
    }
    else if (name === 'stop') { s.mode = 'idle'; s.goal = null; s.want = 0; }
    else if (name === 'lookAt') s.look = a.target === null ? null : a.target === 'camera' ? 'camera' : ctx.resolve(a.target);
  },
  step(s, dt, ctx) {
    // плавный разгон и торможение
    const target = s.mode === 'idle' ? 0 : s.want;
    s.speed += Math.max(-3 * dt, Math.min(2 * dt, target - s.speed));
    if (s.mode === 'goto' && s.goal) {
      const dx = s.goal[0] - s.pos[0], dz = s.goal[2] - s.pos[2];
      const d = Math.hypot(dx, dz);
      const len = s.speed * dt;
      if (d <= Math.max(len, 0.05)) { s.pos[0] = s.goal[0]; s.pos[2] = s.goal[2]; s.mode = 'idle'; s.goal = null; }
      else {
        s.heading = turn(s.heading, bearing(s.pos, s.goal), 200 * dt);
        s.pos[0] += (dx / d) * len; s.pos[2] += (dz / d) * len;
      }
    } else if (s.mode === 'path' && s.pathId) {
      const path = ctx.path(s.pathId);
      s.u += (s.speed * dt) / path.length;
      if (!s.loop && s.u >= 1) { s.u = 1; s.mode = 'idle'; }
      const p = path.getPointAt(s.u), t = path.getTangentAt(s.u);
      s.pos[0] = p[0]; s.pos[2] = p[2];
      s.heading = turn(s.heading, (Math.atan2(t[0], t[2]) * 180) / Math.PI, 200 * dt);
    } else if (s.look) {
      const to = s.look === 'camera' ? ctx.camera.pos : s.look;
      s.heading = turn(s.heading, bearing(s.pos, to), 120 * dt);
    }
    s.pos[1] = ctx.heightAt(s.pos[0], s.pos[2]);
    s.phase += s.speed * dt * 2.4; // длина шага ~ скорость
  },
  state: (s) => {
    const moving = s.speed > 0.05;
    return {
      action: moving ? 'walking' : 'standing',
      speed: s.speed,
      phase: s.phase,
      legsInAir: moving ? 4 : 0,
    };
  },
  examples: ['spider.followPath({ path: "valleyLoop", speed: 2 })', 'spider.walkTo({ to: "lakeShore", speed: 1.5 })'],
});
