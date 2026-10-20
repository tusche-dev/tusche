#version 100
precision highp float;

/* @resolution */
uniform vec2 u_resolution;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 p = floor(gl_FragCoord.xy);
  float n1 = hash(p);
  float n2 = hash(floor(p * 0.5) + 37.0);
  float n3 = hash(floor(p * 0.25) + 91.0);
  float v = n1 * 0.55 + n2 * 0.3 + n3 * 0.15;
  float g = 0.13 + v * 0.20;
  gl_FragColor = vec4(vec3(g), 1.0);
}
