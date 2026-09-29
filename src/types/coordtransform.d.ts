declare module "coordtransform" {
  export function wgs84togcj02(longitude: number, latitude: number): [number, number];
  export function gcj02towgs84(longitude: number, latitude: number): [number, number];
}
