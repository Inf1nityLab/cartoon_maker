// Материалы робота: узловые (TSL). Глаз — один шейдер на диске: радужка, шестигранный зрачок и два века,
// всё от униформ. Вектора движения для TAA считает конвейер кадра сам (velocity по матрицам объектов),
// поэтому своих выходов motion у материалов нет — кроме аддитивных (стекло, луч, ореол): те не должны
// затирать движение того, что видно сквозь них.
import * as THREE from 'three/webgpu';
import {
  mrt, uniform, vec3, vec4, float, uv, length, smoothstep, mix, abs, max, dot, sin, pow, atan, Fn, clamp, vec2,
  normalView, positionViewDirection, positionWorld,
} from 'three/tsl';

export type Look = {
  plastic: THREE.Material; rubber: THREE.Material; metal: THREE.Material; glow: THREE.Material; eye: THREE.Material;
  cup: THREE.Material; dome: THREE.Material; beam: THREE.Material; halo: THREE.Material; shine: THREE.Material; blob: THREE.Material;
  /** Униформы, которые вид выставляет каждый кадр. */
  u: { open: { value: number }; wide: { value: number }; glow: { value: number }; scan: { value: number }; ground: { value: number }; t: { value: number } };
  dispose(): void;
};

/** Цвет огней в утверждённом облике (линейные значения): от него считается оттенок радужки. */
const TEAL_REF = new THREE.Color('#59fff3');

export function createLook(p: { bodyColor: string; lightColor: string }): Look {
  const u = { open: uniform(1), wide: uniform(0), glow: uniform(1), scan: uniform(0), ground: uniform(0), t: uniform(0) };
  const body = new THREE.Color(p.bodyColor), light = new THREE.Color(p.lightColor);
  const TEAL = vec3(light.r, light.g, light.b);
  // радужка в утверждённом облике рассчитана на TEAL_REF; для другого цвета огней — те же градиенты, умноженные на отношение цветов
  const tint = vec3(light.r / Math.max(TEAL_REF.r, 1e-3), light.g / Math.max(TEAL_REF.g, 1e-3), light.b / Math.max(TEAL_REF.b, 1e-3));

  const plastic = new THREE.MeshStandardNodeMaterial({ color: body, roughness: 0.34, metalness: 0 });
  plastic.emissiveNode = vec3(body.r, body.g, body.b).mul(0.045); // подсветка: в тени леса белый пластик уходил в серый
  const rubber = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0.06, 0.065, 0.07), roughness: 0.82, metalness: 0 });
  const metal = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0.2, 0.21, 0.23), roughness: 0.38, metalness: 0.55 });
  const glow = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0.02, 0.08, 0.08), roughness: 0.4 });
  const cup = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0.03, 0.033, 0.036), roughness: 0.9, side: THREE.DoubleSide });
  glow.emissiveNode = TEAL.mul(u.glow.mul(1.7));

  // ---- глаз: p от -1 до 1 по диску линзы
  const eyeFn = Fn(() => {
    const p = uv().sub(0.5).mul(2);
    const r = length(p);
    const ang = atan(p.y, p.x);
    const hex = max(abs(p.x), max(abs(dot(p, vec2(0.5, 0.866))), abs(dot(p, vec2(-0.5, 0.866)))));
    const pupil = mix(float(0.2), float(0.45), u.wide);
    const inPupil = smoothstep(pupil.add(0.035), pupil.sub(0.01), hex);
    const irisOut = float(0.8);
    const ring = smoothstep(irisOut, irisOut.sub(0.07), r);
    const radial = clamp(r.sub(pupil).div(irisOut.sub(pupil)), 0, 1);
    const streak = sin(ang.mul(34).add(radial.mul(2.5))).mul(0.2).add(0.8);
    const iris = mix(vec3(0.6, 1.0, 0.95), vec3(0.0, 0.42, 0.58), pow(radial, 0.7)).mul(tint).mul(streak);
    const limbus = smoothstep(0.045, 0.0, abs(r.sub(0.82)));
    const emis = iris.mul(ring).mul(float(1).sub(inPupil)).mul(1.5).add(vec3(0.4, 1, 0.95).mul(tint).mul(limbus).mul(0.9));
    // веки: два изогнутых края, смыкаются сверху и снизу
    const o = clamp(u.open, 0, 1);
    const curve = p.x.mul(p.x).mul(0.26);
    const top = mix(float(0.015), float(1.12), o).sub(curve);
    const bot = mix(float(0.015), float(0.95), o).sub(curve.mul(0.5)).negate();
    const lid = max(smoothstep(top.sub(0.025), top.add(0.015), p.y), smoothstep(bot.add(0.025), bot.sub(0.015), p.y));
    const rim = smoothstep(0.07, 0.0, abs(p.y.sub(top))).add(smoothstep(0.07, 0.0, abs(p.y.sub(bot)))).mul(0.8);
    const lit = emis.mul(float(1).sub(lid)).add(TEAL.mul(rim).mul(0.55)).mul(u.glow);
    return vec4(lit, lid);
  });
  const eye = new THREE.MeshStandardNodeMaterial({ roughness: 0.14, metalness: 0 });
  eye.colorNode = mix(vec3(0.012, 0.03, 0.035), vec3(0.05, 0.055, 0.062), eyeFn().w);
  eye.emissiveNode = eyeFn().xyz;

  // ---- стекло, луч, ореолы: аддитивные, без освещения и тумана; вектор движения им обнуляем
  // Выход motion у них нулевой, как в песочнице: пер-выходное смешивание берётся из MRT рендерера (конвейера кадра), а не
  // материала, поэтому «не трогать» буфер движения у прозрачного меша нельзя; нулевой вектор лучше, чем вектор самого стекла.
  const noMotion = (): ReturnType<typeof mrt> => mrt({ motion: vec4(0, 0, 0, 0) });
  const add = (m: THREE.MeshBasicNodeMaterial): THREE.MeshBasicNodeMaterial => {
    m.transparent = true; m.depthWrite = false; m.fog = false; m.blending = THREE.AdditiveBlending; m.side = THREE.DoubleSide;
    (m as unknown as { mrtNode: unknown }).mrtNode = noMotion();
    return m;
  };
  const fres = (pw: number) => pow(float(1).sub(abs(normalView.dot(positionViewDirection))), pw);
  const dome = add(new THREE.MeshBasicNodeMaterial());
  dome.colorNode = vec3(0.55, 0.75, 0.95).mul(fres(2.6)).mul(0.55).add(vec3(0.5, 0.6, 0.7).mul(0.03));
  const shine = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(1.6, 1.6, 1.6), fog: false });
  const halo = add(new THREE.MeshBasicNodeMaterial());
  halo.colorNode = TEAL.mul(pow(abs(normalView.dot(positionViewDirection)), 1.6)).mul(0.5).mul(u.glow);
  const beam = add(new THREE.MeshBasicNodeMaterial());
  {
    const v = uv().y; // верх цилиндра — узкий конец у глаза, v = 1
    const along = pow(v, 2.2).mul(smoothstep(1.0, 0.92, v)); // гаснет к дальнему концу и у самого края глаза
    const edge = pow(abs(normalView.dot(positionViewDirection)), 1.3);
    const bands = sin(v.mul(46).sub(u.t.mul(7))).mul(0.25).add(0.75); // бегущие полосы от времени сцены, не от часов
    // у земли луч гаснет: там, где конус касался земли, пятна нет
    beam.colorNode = TEAL.mul(along).mul(edge).mul(bands).mul(u.scan).mul(0.6).mul(smoothstep(u.ground, u.ground.add(0.05), positionWorld.y));
  }
  // пятно под колёсами: тень солнца на таком расстоянии грубее следа колёс
  const blob = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  blob.colorNode = vec3(0.01, 0.01, 0.008);
  blob.opacityNode = float(1).sub(smoothstep(0.1, 1, length(uv().sub(0.5).mul(2)))).pow(1.3).mul(0.7);
  blob.polygonOffset = true; blob.polygonOffsetFactor = blob.polygonOffsetUnits = -2;

  const all = [plastic, rubber, metal, glow, eye, cup, dome, beam, halo, shine, blob];
  return { plastic, rubber, metal, glow, eye, cup, dome, beam, halo, shine, blob, u: u as unknown as Look['u'], dispose() { for (const m of all) m.dispose(); } };
}
