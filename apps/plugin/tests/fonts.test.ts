import { beforeEach, expect, it, vi } from 'vitest';
import { figmaFixture } from './figma-fixture';
import { loadTextFonts } from '../src/main/fonts';

let fixture: ReturnType<typeof figmaFixture>;
beforeEach(() => {
  fixture = figmaFixture();
  vi.stubGlobal('figma', fixture.figma);
});

const missingLayer = () => {
  const n = fixture.text('button_text', 'Lanjut');
  n.fontName = { family: 'GoPay Display', style: 'Bold' };
  n.fontSize = 16;
  n.hasMissingFont = true;
  fixture.missingFonts.add('GoPay Display');
  return n;
};

// Runs first: a font that loads once stays loaded for the session (`loadFont` caches it).
it('names the layer when Rupa Sans is not available either', async () => {
  const n = missingLayer();
  fixture.missingFonts.add('Rupa Sans');
  await expect(loadTextFonts(n)).rejects.toThrow('Missing font in “button_text”');
  expect(n.fontName).toEqual({ family: 'GoPay Display', style: 'Bold' });
});

it('previews only check that a missing font can be replaced', async () => {
  const n = missingLayer();
  await loadTextFonts(n, false);
  expect(n.fontName).toEqual({ family: 'GoPay Display', style: 'Bold' });
});

it('replaces a missing font with Rupa Sans Regular at the same size', async () => {
  const n = missingLayer();
  await loadTextFonts(n);
  expect(n.fontName).toEqual({ family: 'Rupa Sans', style: 'Regular' });
  expect(n.fontSize).toBe(16);
});
