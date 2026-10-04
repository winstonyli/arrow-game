import { KIND } from '../core/world.ts';
import { ENEMY_TYPES } from '../game/enemies.ts';
import { drawWorldGrid } from './grid-lines.ts';
import { POOL, RING } from './fx.ts';
import { bladePos, BLADE_RADIUS, MAX_BLADES } from '../game/orbit.ts';
import { TRAIL_MAX } from './trail.ts';
import { drawGhost } from './ghost-marker.ts';

export const STRIDE = 9; // floats per instance: x, y, radius, palette index, fade, tail bend x, y, tail tip x, y
// fade: SOLID = entity (outline + shadow); (0, 1] = dot particle alpha; [-1, 0) = ring particle, alpha -fade.
const SOLID = 2;
const SHAKE_PAD = 12; // cull pad when fx can shake the view (max offset is 10 px); a tail can also reach this far into the view

// Palette index: enemy types 0..n-1, then these.
const P_ENEMY_PROJECTILE = ENEMY_TYPES.length;
const P_PROJECTILE = P_ENEMY_PROJECTILE + 1;
const P_PLAYER = P_PROJECTILE + 1;
const P_PLAYER_BLINK = P_PLAYER + 1;
const P_GEM = P_PLAYER_BLINK + 1;
const P_FLASH = P_GEM + 1;
const P_BLADE = P_FLASH + 1;
const COLORS = [...ENEMY_TYPES.map((t) => t.color), '#ff7b72', '#58a6ff', '#3fb950', '#3fb950', '#f2cc60', '#ffffff', '#c9d1d9'];
const ALPHAS = COLORS.map((_, i) => (i === P_PLAYER_BLINK ? 0.4 : 1));

const LAYERS = [KIND.GEM, KIND.ENEMY, KIND.ENEMY_PROJECTILE, KIND.PROJECTILE];
const bp = { x: 0, y: 0 };
const tv = { mx: 0, my: 0, ex: 0, ey: 0 };

function put(out, o, x, y, r, pal, fade, mx, my, ex, ey) {
  out[o] = x;
  out[o + 1] = y;
  out[o + 2] = r;
  out[o + 3] = pal;
  out[o + 4] = fade;
  out[o + 5] = mx;
  out[o + 6] = my;
  out[o + 7] = ex;
  out[o + 8] = ey;
}

// Layers, bottom to top (canvas.ts uses the same order): gems, enemies, enemy projectiles, player
// projectiles, fx particles, blades, player. The background and grid
// are on a canvas below; the HP bar, vignette and HUD text on one above. Within a layer instances draw in
// slot order. Entities carry their tail's bend and tip (see trail.ts); zero without fx.
// Fills `out` with one instance per live entity at least partly inside the view in that order and returns the count.
export function packInstances(world, player, game, out) {
  const { camera, view, fx } = game;
  const pad = fx ? SHAKE_PAD + TRAIL_MAX : 0;
  const x0 = camera.x - pad;
  const x1 = camera.x + view.w + pad;
  const y0 = camera.y - pad;
  const y1 = camera.y + view.h + pad;
  let n = 0;
  for (const layer of LAYERS) {
    for (let i = 0; i < world.high; i++) {
      const k = world.kind[i];
      if (k !== layer) continue;
      const x = world.x[i];
      const y = world.y[i];
      const r = world.radius[i];
      if (x + r < x0 || x - r > x1 || y + r < y0 || y - r > y1) continue;
      const pal =
        k === KIND.ENEMY
          ? fx && fx.flashing(i)
            ? P_FLASH
            : world.type[i]
          : k === KIND.PROJECTILE
            ? P_PROJECTILE
            : k === KIND.GEM
              ? P_GEM
              : P_ENEMY_PROJECTILE;
      tv.mx = tv.my = tv.ex = tv.ey = 0;
      if (fx) fx.tail(world, i, tv);
      put(out, n++ * STRIDE, x, y, r, pal, SOLID, tv.mx, tv.my, tv.ex, tv.ey);
    }
  }
  if (fx) {
    const p = fx.p;
    for (let k = 0; k < POOL; k++) {
      if (p.life[k] <= 0) continue;
      const a = Math.min(1, p.life[k] / p.max[k]);
      put(out, n++ * STRIDE, p.x[k], p.y[k], p.r[k], p.pal[k] < 0 ? P_GEM : p.pal[k], p.shape[k] === RING ? -a : a, 0, 0, 0, 0);
    }
  }
  for (let k = 0; k < player.stats.orbit; k++) {
    bladePos(player, game.time, k, bp);
    tv.mx = tv.my = tv.ex = tv.ey = 0;
    if (fx) fx.trackTail(1 + k, bp.x, bp.y, BLADE_RADIUS, tv);
    put(out, n++ * STRIDE, bp.x, bp.y, BLADE_RADIUS, P_BLADE, SOLID, tv.mx, tv.my, tv.ex, tv.ey);
  }
  tv.mx = tv.my = tv.ex = tv.ey = 0;
  if (fx) fx.trackTail(0, player.x, player.y, player.radius, tv);
  put(out, n++ * STRIDE, player.x, player.y, player.radius, player.invuln > 0 && Math.floor(game.time * 20) % 2 ? P_PLAYER_BLINK : P_PLAYER, SOLID, tv.mx, tv.my, tv.ex, tv.ey);
  return n;
}

const hex = (c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16) / 255);

const VERT = `#version 300 es
in vec4 aInst; // x, y, radius, palette index (world coordinates)
in float aFade;
in vec4 aTail; // offsets from the centre to the tail's bend (xy) and tip (zw) along the mover's path (zero for most instances)
uniform vec2 uSize; // view size in px
uniform vec2 uCam; // view's top-left in world coordinates
flat out float vIdx;
flat out float vR;
flat out float vFade;
flat out vec4 vTail;
out vec2 vOff;
void main() {
  vec2 corner = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 2.0 - 1.0;
  vOff = corner * (aInst.z + 4.0); // margin for anti-aliasing and the shadow offset
  // Grow the quad on the tail side so it covers the body and the whole tail.
  vec2 hi = max(max(aTail.xy, aTail.zw), 0.0);
  vec2 lo = min(min(aTail.xy, aTail.zw), 0.0);
  vOff.x += corner.x > 0.0 ? hi.x : lo.x;
  vOff.y += corner.y > 0.0 ? hi.y : lo.y;
  vec2 p = aInst.xy - uCam + vOff;
  gl_Position = vec4(p.x / uSize.x * 2.0 - 1.0, 1.0 - p.y / uSize.y * 2.0, 0.0, 1.0);
  vIdx = aInst.w;
  vR = aInst.z;
  vFade = aFade;
  vTail = aTail;
}`;

const TAIL_STEPS = 6; // capsules the tail's curve is split into
const FRAG = `#version 300 es
#define TAIL_STEPS ${TAIL_STEPS}
precision highp float; // the tail's dot products reach ~7000
uniform vec4 uPalette[${COLORS.length}];
flat in float vIdx;
flat in float vR;
flat in float vFade;
flat in vec4 vTail;
in vec2 vOff;
out vec4 outColor;
void main() {
  float len = length(vOff);
  vec4 c = uPalette[int(vIdx + 0.5)];
  if (vFade > 1.5) { // solid entity: darker outline, soft shadow underneath
    float a = clamp(vR + 0.5 - len, 0.0, 1.0);
    float edge = smoothstep(vR - 2.0, vR - 0.5, len);
    vec3 rgb = mix(c.rgb, c.rgb * 0.55, edge);
    float ca = c.a * a;
    float sa = clamp(vR + 0.5 - length(vOff - vec2(2.0, 3.0)), 0.0, 1.0) * 0.35;
    // Tail: a quadratic curve centre -> tip passing through the bend, walked in TAIL_STEPS short capsules; width
    // and alpha taper continuously along it. Over the shadow, under the body.
    vec2 tip = vTail.zw;
    float ta = 0.0;
    if (dot(tip, tip) > 0.25) {
      vec2 ctrl = 2.0 * vTail.xy - 0.5 * tip; // B(t) = 2(1-t)t ctrl + t^2 tip, so B(0.5) = bend
      vec2 a = vec2(0.0);
      for (int k = 0; k < TAIL_STEPS; k++) {
        float t1 = float(k + 1) / float(TAIL_STEPS);
        vec2 b = 2.0 * (1.0 - t1) * t1 * ctrl + t1 * t1 * tip;
        vec2 ab = b - a;
        float l2 = dot(ab, ab);
        if (l2 > 1e-6) {
          float h = clamp(dot(vOff - a, ab) / l2, 0.0, 1.0);
          float s = (float(k) + h) / float(TAIL_STEPS);
          float tr = vR * 0.85 * (1.0 - s);
          ta = max(ta, clamp(tr + 0.5 - length(vOff - a - ab * h), 0.0, 1.0) * 0.4 * (1.0 - s));
        }
        a = b;
      }
    }
    vec4 under = vec4(c.rgb * c.a * ta, c.a * ta) + (1.0 - ta) * vec4(0.0, 0.0, 0.0, sa);
    outColor = vec4(rgb * ca, ca) + (1.0 - ca) * under; // premultiplied; the shadow is black
  } else if (vFade < 0.0) { // expanding ring
    float a = clamp(1.5 - abs(len - (vR - 1.0)), 0.0, 1.0) * -vFade;
    outColor = vec4(c.rgb * c.a * a, c.a * a);
  } else { // dot
    float a = clamp(vR + 0.5 - len, 0.0, 1.0) * vFade;
    outColor = vec4(c.rgb * c.a * a, c.a * a);
  }
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

// Same render(game, hud) contract as createCanvasRenderer. Throws if WebGL2 is unavailable.
// `bgCanvas` (below) holds the background and world grid; `hudCanvas` (above) holds the player's HP bar,
// the damage vignette and the HUD text, so the grid never draws over entities.
export function createWebGLRenderer(canvas, hudCanvas, bgCanvas, view) {
  canvas.width = hudCanvas.width = bgCanvas.width = view.w;
  canvas.height = hudCanvas.height = bgCanvas.height = view.h;
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: true }); // transparent: the background and grid sit on bgCanvas below
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
  const locInst = gl.getAttribLocation(prog, 'aInst');
  gl.enableVertexAttribArray(locInst);
  gl.vertexAttribPointer(locInst, 4, gl.FLOAT, false, STRIDE * 4, 0);
  gl.vertexAttribDivisor(locInst, 1);
  const locFade = gl.getAttribLocation(prog, 'aFade');
  gl.enableVertexAttribArray(locFade);
  gl.vertexAttribPointer(locFade, 1, gl.FLOAT, false, STRIDE * 4, 16);
  gl.vertexAttribDivisor(locFade, 1);
  const locTail = gl.getAttribLocation(prog, 'aTail');
  gl.enableVertexAttribArray(locTail);
  gl.vertexAttribPointer(locTail, 4, gl.FLOAT, false, STRIDE * 4, 20);
  gl.vertexAttribDivisor(locTail, 1);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.viewport(0, 0, view.w, view.h);
  gl.clearColor(0, 0, 0, 0);
  const bg2d = bgCanvas.getContext('2d');

  let data = null; // sized on first frame from the world's capacity
  const hud2d = hudCanvas.getContext('2d');
  const vignette = hud2d.createRadialGradient(view.w / 2, view.h / 2, view.h * 0.35, view.w / 2, view.h / 2, Math.hypot(view.w, view.h) / 2);
  vignette.addColorStop(0, 'rgba(248,81,73,0)');
  vignette.addColorStop(1, 'rgba(248,81,73,0.85)');
  const cam = { x: 0, y: 0 }; // the camera plus the current shake offset

  function render(game, hud) {
    const { world, player, camera, bounds, fx } = game;
    if (!data) {
      data = new Float32Array((world.capacity + 1 + POOL + MAX_BLADES) * STRIDE);
      gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
    }
    cam.x = camera.x + (fx ? fx.sx : 0);
    cam.y = camera.y + (fx ? fx.sy : 0);
    const n = packInstances(world, player, game, data);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * STRIDE);
    gl.uniform2f(uCam, cam.x, cam.y);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);

    bg2d.fillStyle = '#161b22';
    bg2d.fillRect(0, 0, view.w, view.h);
    drawWorldGrid(bg2d, cam, view, bounds);

    hud2d.clearRect(0, 0, view.w, view.h);
    const bw = 40;
    const bx = player.x - cam.x - bw / 2;
    const by = player.y - cam.y - player.radius - 10;
    hud2d.fillStyle = '#30363d';
    hud2d.fillRect(bx, by, bw, 4);
    hud2d.fillStyle = '#3fb950';
    hud2d.fillRect(bx, by, (bw * Math.max(0, player.hp)) / player.maxHp, 4);
    drawGhost(hud2d, game, cam.x, cam.y);
    const v = fx ? fx.vignette(player) : 0;
    if (v > 0.01) {
      hud2d.globalAlpha = Math.min(1, v);
      hud2d.fillStyle = vignette;
      hud2d.fillRect(0, 0, view.w, view.h);
      hud2d.globalAlpha = 1;
    }
    hud2d.fillStyle = '#c9d1d9';
    hud2d.font = '14px monospace';
    hud2d.textAlign = 'center';
    hud.forEach((line, k) => hud2d.fillText(line, view.w / 2, view.h - 8 - (hud.length - 1 - k) * 18));
    hud2d.textAlign = 'left';
  }
  render.adapter = adapter;
  return render;
}
