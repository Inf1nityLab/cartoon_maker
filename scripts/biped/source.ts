// Общее представление источника движений: скелет в позе покоя и мировые повороты суставов по кадрам.
export type SrcRig = {
  names: string[];
  parent: number[];
  /** положения суставов в позе покоя, м (мир) */
  restPos: Float64Array;
  /** повороты суставов в позе покоя (мир) */
  restQ: Float64Array;
};
export type SrcMotion = {
  rig: SrcRig;
  fps: number;
  frames: number;
  /** положение корня (таза) по кадрам, м (мир): frames·3 */
  hips: Float64Array;
  /** мировые повороты всех суставов по кадрам: frames·nj·4 */
  wq: Float64Array;
};
