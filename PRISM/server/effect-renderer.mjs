// Pure color calculations shared by the browser preview and hardware renderer.
export const EFFECTS = ['static', 'rainbow', 'breathing', 'wave', 'gradient', 'sparkle', 'colorcycle', 'comet', 'chase', 'scanner', 'ripple', 'fire', 'aurora', 'stripes', 'rainbowbreathing', 'rainbowcomet', 'rainbowsparkle', 'heartbeat', 'strobe', 'lightning', 'twinkle', 'meteorshower', 'stack', 'pingpong', 'marquee', 'duel', 'police', 'gradientwave', 'pulse', 'embers'];

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
      case 'rainbowbreathing': {
        color = hsv(orientedPosition * density + travel * 0.25);
        intensity *= 0.02 + 0.98 * (0.5 - 0.5 * Math.cos(travel * TAU));
        break;
      }
      case 'rainbowcomet': {
        const tailLength = 0.06 + settings.scale / 100 * 0.4;
        let distance = fract(travel - orientedPosition);
        if (distance > 1 - 1e-10) distance = 0;
        const tail = clamp(1 - distance / tailLength, 0, 1);
        color = hsv(travel * 0.2 + distance * 2);
        intensity *= tail * tail;
        break;
      }
      case 'rainbowsparkle': {
        const tick = Math.floor(travel * 8), value = noise(index + tick * 83);
        color = hsv(noise(index * 19 + tick * 31));
        intensity *= value > 0.88 - settings.scale / 100 * 0.35 ? 1 : 0.015;
        break;
      }
      case 'heartbeat': {
        const cycle = fract(travel), first = Math.exp(-(((cycle - 0.18) / 0.055) ** 2)), second = 0.72 * Math.exp(-(((cycle - 0.36) / 0.075) ** 2));
        color = gradient(palette, position);
        intensity *= 0.015 + 0.985 * Math.min(1, first + second);
        break;
      }
      case 'strobe': {
        const duty = 0.05 + settings.scale / 100 * 0.35;
        color = palette[Math.floor(travel) % palette.length];
        intensity *= fract(travel) < duty ? 1 : 0;
        break;
      }
      case 'lightning': {
        const burst = Math.floor(travel), within = fract(travel);
        const enabled = noise(burst * 19 + 7) > 0.7 - settings.scale / 100 * 0.65;
        const flash = within < 0.05 || within >= 0.12 && within < 0.16 || within >= 0.24 && within < 0.26;
        color = palette[Math.floor(noise(burst * 29) * palette.length)];
        intensity *= enabled && flash ? 0.7 + 0.3 * noise(index + burst * 23) : 0.01;
        break;
      }
      case 'twinkle': {
        const offset = noise(index * 13 + 17), rate = 0.35 + noise(index * 29) * 0.65;
        const glow = 0.5 + 0.5 * Math.sin((travel * rate + offset) * TAU);
        color = palette[Math.floor(noise(index * 11 + 3) * palette.length)];
        intensity *= 0.01 + 0.99 * glow ** (2 + settings.scale / 100 * 6);
        break;
      }
      case 'meteorshower': {
        const tailLength = 0.04 + settings.scale / 100 * 0.3;
        let strongest = 0, meteorColor = palette[0];
        for (let meteor = 0; meteor < 3; meteor++) {
          const distance = fract(travel * (0.73 + meteor * 0.31) + meteor / 3 - orientedPosition);
          const trail = clamp(1 - distance / tailLength, 0, 1) ** 2;
          if (trail > strongest) { strongest = trail; meteorColor = cyclicGradient(palette, meteor / 3 + distance); }
        }
        color = meteorColor; intensity *= strongest;
        break;
      }
      case 'stack': {
        const blocks = 3 + Math.floor(settings.scale / 100 * 12);
        const step = Math.floor(travel) % (blocks + 1), progress = fract(travel);
        const boundary = 1 - step / blocks, head = progress * boundary;
        const stacked = step > 0 && orientedPosition >= boundary;
        const moving = step < blocks && Math.abs(orientedPosition - head) < 0.65 / blocks;
        color = palette[Math.max(0, Math.floor(orientedPosition * blocks)) % palette.length];
        intensity *= stacked || moving ? 1 : 0;
        break;
      }
      case 'pingpong': {
        const head = 1 - Math.abs(1 - 2 * fract(travel / 2)), width = 0.035 + settings.scale / 100 * 0.18;
        const a = Math.exp(-3 * ((orientedPosition - head) / width) ** 2), b = Math.exp(-3 * ((orientedPosition - (1 - head)) / width) ** 2);
        const total = a + b;
        color = total > 1e-12 ? palette[0].map((value, channel) => (value * a + palette[palette.length - 1][channel] * b) / total) : palette[0];
        intensity *= Math.min(1, total);
        break;
      }
      case 'marquee': {
        const cell = Math.floor(orientedPosition * (3 + settings.scale / 100 * 24) - travel * 3);
        const band = ((Math.floor(cell / 3) % palette.length) + palette.length) % palette.length;
        color = palette[band]; intensity *= ((cell % 3) + 3) % 3 === 0 ? 1 : 0;
        break;
      }
      case 'duel': {
        const tailLength = 0.06 + settings.scale / 100 * 0.3, head = fract(travel);
        const a = clamp(1 - fract(head - orientedPosition) / tailLength, 0, 1) ** 2;
        const b = clamp(1 - fract(head - (1 - orientedPosition)) / tailLength, 0, 1) ** 2;
        color = a >= b ? palette[0] : palette[palette.length - 1]; intensity *= Math.max(a, b);
        break;
      }
      case 'police': {
        const side = orientedPosition < 0.5 ? 0 : 1, active = Math.floor(travel * 2) % 2;
        color = palette[side % palette.length];
        intensity *= side === active && fract(travel * 8) < 0.5 ? 1 : 0;
        break;
      }
      case 'gradientwave': {
        color = cyclicGradient(palette, orientedPosition * density - travel * 0.35);
        break;
      }
      case 'pulse': {
        const pulse = Math.exp(-(((fract(travel) - 0.5) * 9) ** 2));
        color = cyclicGradient(palette, travel * 0.25);
        intensity *= 0.01 + 0.99 * pulse;
        break;
      }
      case 'embers': {
        const x = orientedPosition * (4 + settings.scale / 100 * 16);
        const heat = smoothNoise(x - travel * 0.15, travel * 0.3 + 23) ** 3;
        color = gradient(palette, heat); intensity *= 0.03 + 0.97 * heat;
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
