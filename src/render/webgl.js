import { KIND } from '../core/world.js';
import { ENEMY_TYPES } from '../game/enemies.js';
import { drawWorldGrid } from './grid-lines.js';

export const STRIDE = 4; // floats per instance: x, y, radius, palette index

// Palette index: enemy types 0..n-1, then these.
const P_ENEMY_PROJECTILE = ENEMY_TYPES.length;
const P_PROJECTILE = P_ENEMY_PROJECTILE + 1;
const P_PLAYER = P_PROJECTILE + 1;
const P_PLAYER_BLINK = P_PLAYER + 1;
const COLORS = [...ENEMY_TYPES.map((t) => t.color), '#ff7b72', '#58a6ff', '#3fb950', '#3fb950'];
const ALPHAS = COLORS.map((_, i) => (i === P_PLAYER_BLINK ? 0.4 : 1));

// Fills `out` with one instance per live entity that is at least partly inside the view, plus the
// player (drawn last). Returns the count. Instances draw in slot order, so enemies and projectiles
// interleave (canvas.js layers them by kind).
export function packInstances(world, player, game, out) {
  const { camera, view } = game;
  const x0 = camera.x;
  const x1 = camera.x + view.w;
  const y0 = camera.y;
  const y1 = camera.y + view.h;
  let n = 0;
  for (let i = 0; i < world.high; i++) {
    const k = world.kind[i];
    if (k === KIND.NONE) continue;
    const x = world.x[i];
    const y = world.y[i];
    const r = world.radius[i];
    if (x + r < x0 || x - r > x1 || y + r < y0 || y - r > y1) continue;
    const o = n++ * STRIDE;
    out[o] = x;
    out[o + 1] = y;
    out[o + 2] = r;
    out[o + 3] = k === KIND.ENEMY ? world.type[i] : k === KIND.PROJECTILE ? P_PROJECTILE : P_ENEMY_PROJECTILE;
  }
  const o = n++ * STRIDE;
  out[o] = player.x;
  out[o + 1] = player.y;
  out[o + 2] = player.radius;
  out[o + 3] = player.invuln > 0 && Math.floor(game.time * 20) % 2 ? P_PLAYER_BLINK : P_PLAYER;
  return n;
}

const hex = (c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16) / 255);

const VERT = `#version 300 es
in vec4 aInst; // x, y, radius, palette index (world coordinates)
uniform vec2 uSize; // view size in px
uniform vec2 uCam; // view's top-left in world coordinates
flat out float vIdx;
flat out float vR;
out vec2 vOff;
void main() {
  vec2 corner = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 2.0 - 1.0;
  vOff = corner * (aInst.z + 1.0); // 1 px margin for anti-aliasing
  vec2 p = aInst.xy - uCam + vOff;
  gl_Position = vec4(p.x / uSize.x * 2.0 - 1.0, 1.0 - p.y / uSize.y * 2.0, 0.0, 1.0);
  vIdx = aInst.w;
  vR = aInst.z;
}`;

const FRAG = `#version 300 es
precision mediump float;
uniform vec4 uPalette[${COLORS.length}];
flat in float vIdx;
flat in float vR;
in vec2 vOff;
out vec4 outColor;
void main() {
  float a = clamp(vR + 0.5 - length(vOff), 0.0, 1.0);
  vec4 c = uPalette[int(vIdx + 0.5)];
  outColor = vec4(c.rgb * c.a * a, c.a * a); // premultiplied
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

// Same render(game, hud) contract as createCanvasRenderer. Throws if WebGL2 is unavailable.
// `hudCanvas` is a separate 2D canvas for the world grid, the player's HP bar and the HUD text.
export function createWebGLRenderer(canvas, hudCanvas, view) {
  canvas.width = hudCanvas.width = view.w;
  canvas.height = hudCanvas.height = view.h;
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) throw new Error('WebGL2 unavailable');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const adapter = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  gl.uniform2f(gl.getUniformLocation(prog, 'uSize'), view.w, view.h);
  const uCam = gl.getUniformLocation(prog, 'uCam');
  gl.uniform4fv(gl.getUniformLocation(prog, 'uPalette'), COLORS.flatMap((c, i) => [...hex(c), ALPHAS[i]]));

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  const loc = gl.getAttribLocation(prog, 'aInst');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, STRIDE, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(loc, 1);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.viewport(0, 0, view.w, view.h);
  gl.clearColor(0x16 / 255, 0x1b / 255, 0x22 / 255, 1);

  let data = null; // sized on first frame from the world's capacity
  const hud2d = hudCanvas.getContext('2d');

  function render(game, hud) {
    const { world, player, camera, bounds } = game;
    if (!data) {
      data = new Float32Array((world.capacity + 1) * STRIDE);
      gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
    }
    const n = packInstances(world, player, game, data);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * STRIDE);
    gl.uniform2f(uCam, camera.x, camera.y);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);

    hud2d.clearRect(0, 0, view.w, view.h);
    drawWorldGrid(hud2d, camera, view, bounds);
    const bw = 40;
    const bx = player.x - camera.x - bw / 2;
    const by = player.y - camera.y - player.radius - 10;
    hud2d.fillStyle = '#30363d';
    hud2d.fillRect(bx, by, bw, 4);
    hud2d.fillStyle = '#3fb950';
    hud2d.fillRect(bx, by, (bw * Math.max(0, player.hp)) / player.maxHp, 4);
    hud2d.fillStyle = '#c9d1d9';
    hud2d.font = '14px monospace';
    hud.forEach((line, k) => hud2d.fillText(line, 10, 20 + k * 18));
  }
  render.adapter = adapter;
  return render;
}
