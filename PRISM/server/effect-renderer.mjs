// Pure color calculations shared by the browser preview and hardware renderer.
export const EFFECTS = ['static', 'rainbow', 'breathing', 'wave', 'gradient', 'sparkle', 'colorcycle', 'comet', 'chase', 'scanner', 'ripple', 'fire', 'aurora', 'stripes'];

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const fract = value => value - Math.floor(value);
const smooth = value => value * value * (3 - 2 * value);
const noise = seed => fract(Math.sin(seed * 12.9898 + 78.233) * 43758.5453);
const rgb = hex => [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16));

export function packColor(color, brightness = 1) {
  const [r, g, b] = color.map(value => clamp(Math.round(value * brightness), 0, 255));
  return (r | (g << 8) | (b << 16)) >>> 0;
}

function hsv(hue) {
  const h = fract(hue) * 6, x = 255 * (1 - Math.abs((h % 2) - 1));
  return [[255, x, 0], [x, 255, 0], [0, 255, x], [0, x, 255], [x, 0, 255], [255, 0, x]][Math.floor(h)];
}

function gradient(palette, position) {
  if (palette.length === 1) return palette[0];
  const scaled = clamp(position, 0, 1) * (palette.length - 1), low = Math.floor(scaled), high = Math.min(low + 1, palette.length - 1), blend = scaled - low;
  return palette[low].map((channel, index) => channel * (1 - blend) + palette[high][index] * blend);
}

function cyclicGradient(palette, position) {
  if (palette.length === 1) return palette[0];
  const scaled = fract(position) * palette.length, low = Math.floor(scaled), high = (low + 1) % palette.length;
  const blend = smooth(scaled - low);
  return palette[low].map((channel, index) => channel * (1 - blend) + palette[high][index] * blend);
}

function smoothNoise(x, time) {
  const cell = Math.floor(x), tick = Math.floor(time), sx = smooth(fract(x)), st = smooth(fract(time));
  const a = noise(cell * 17 + tick * 131), b = noise((cell + 1) * 17 + tick * 131);
  const c = noise(cell * 17 + (tick + 1) * 131), d = noise((cell + 1) * 17 + (tick + 1) * 131);
  return (a * (1 - sx) + b * sx) * (1 - st) + (c * (1 - sx) + d * sx) * st;
}

export function createEffectSampler(config, elapsedSeconds) {
  const settings = { effect: 'static', colors: ['#8b5cf6', '#06b6d4'], brightness: 80, speed: 50, scale: 40, direction: 'forward', ...config };
  const palette = settings.colors.map(rgb), brightness = settings.brightness / 100;
  const direction = settings.direction === 'reverse' ? -1 : 1;
  const phase = elapsedSeconds * (0.05 + settings.speed / 100 * 1.8) * direction;
  const travel = phase * direction;
  const density = 0.5 + settings.scale / 100 * 5.5;

  return (position, index = 0) => {
    let color = palette[0], intensity = brightness;
    const orientedPosition = direction === -1 ? 1 - position : position;
    switch (settings.effect) {
      // Preserve the original six calculations, including their rounding in packColor.
      case 'rainbow': color = hsv(position * density + phase); break;
      case 'breathing': intensity *= 0.06 + 0.94 * (0.5 - 0.5 * Math.cos(phase * TAU)); color = gradient(palette, position); break;
      case 'wave': color = gradient(palette, 0.5 + 0.5 * Math.sin((position * density - phase) * TAU)); intensity *= 0.18 + 0.82 * (0.5 + 0.5 * Math.cos((position * density - phase) * TAU)); break;
      case 'gradient': color = gradient(palette, settings.direction === 'reverse' ? 1 - position : position); break;
      case 'sparkle': {
        const step = Math.floor(Math.abs(phase) * 10), sparkle = noise(index + step * 83);
        color = palette[Math.floor(noise(index * 11 + step) * palette.length)]; intensity *= sparkle > 0.83 - settings.scale / 100 * 0.2 ? 1 : 0.03; break;
      }
      case 'colorcycle': color = cyclicGradient(palette, phase); break;
      case 'comet': {
        const tailLength = 0.05 + settings.scale / 100 * 0.4;
        let distance = fract(travel - orientedPosition);
        // Mirroring a position can introduce a tiny negative epsilon at the head.
        if (distance > 1 - 1e-10) distance = 0;
        const tail = clamp(1 - distance / tailLength, 0, 1);
        color = gradient(palette, clamp(distance / tailLength, 0, 1));
        intensity *= 0.015 + 0.985 * tail * tail;
        break;
      }
      case 'chase': {
        const offset = orientedPosition * density - travel, segment = Math.floor(offset), within = fract(offset);
        color = palette[((segment % palette.length) + palette.length) % palette.length];
        const pulse = within < 0.28 ? Math.sin(within / 0.28 * Math.PI) ** 2 : 0;
        intensity *= 0.02 + 0.98 * pulse;
        break;
      }
      case 'scanner': {
        const head = 1 - Math.abs(1 - 2 * fract(travel / 2));
        const width = 0.03 + settings.scale / 100 * 0.22;
        const distance = (orientedPosition - head) / width;
        color = cyclicGradient(palette, travel / 2);
        intensity *= 0.015 + 0.985 * Math.exp(-3 * distance * distance);
        break;
      }
      case 'ripple': {
        const radius = Math.abs(2 * position - 1), wave = (radius * density - phase) * TAU;
        color = gradient(palette, 0.5 + 0.5 * Math.sin(wave));
        intensity *= 0.06 + 0.94 * (0.5 + 0.5 * Math.cos(wave)) ** 3;
        break;
      }
      case 'fire': {
        const x = orientedPosition * (2 + settings.scale / 100 * 10);
        const heat = clamp(0.08 + 0.92 * (0.65 * smoothNoise(x - travel * 0.35, travel * 1.2) + 0.35 * smoothNoise(x * 2 + 37 - travel * 0.6, travel * 2.1 + 11)), 0, 1);
        color = gradient(palette, heat);
        intensity *= 0.18 + 0.82 * heat;
        break;
      }
      case 'aurora': {
        const x = orientedPosition * density;
        const band = 0.5 + 0.5 * (0.65 * Math.sin((x - travel * 0.35) * TAU) + 0.35 * Math.sin((x * 0.47 + travel * 0.21) * TAU));
        color = gradient(palette, band);
        intensity *= 0.15 + 0.85 * (0.5 + 0.5 * Math.cos((x * 0.5 - travel * 0.32) * TAU));
        break;
      }
      case 'stripes': {
        const band = Math.floor((orientedPosition * density - travel) * palette.length);
        color = palette[((band % palette.length) + palette.length) % palette.length];
        break;
      }
    }
    return { color, alpha: intensity };
  };
}

export function renderFrame(count, settings, elapsedSeconds) {
  const sample = createEffectSampler(settings, elapsedSeconds);
  return Array.from({ length: count }, (_, index) => {
    const { color, alpha } = sample(count < 2 ? 0 : index / (count - 1), index);
    return packColor(color, alpha);
  });
}
