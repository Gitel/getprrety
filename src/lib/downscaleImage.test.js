import { fitWithin, downscaleDataUrl, GEMINI_MAX_EDGE } from './downscaleImage';

describe('fitWithin', () => {
  test('scales a landscape phone photo down to the max edge, keeping the ratio', () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  test('scales a portrait photo by its height', () => {
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  test('never upscales a photo that already fits', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1600, 900, 1600)).toEqual({ width: 1600, height: 900 });
  });

  test('tolerates a zero size (undecodable image)', () => {
    expect(fitWithin(0, 0, 1600)).toEqual({ width: 0, height: 0 });
  });

  test('the Gemini limit is the agreed 1600 px', () => {
    expect(GEMINI_MAX_EDGE).toBe(1600);
  });
});

describe('downscaleDataUrl', () => {
  test('outside a browser it returns the original, so the photo is still sent', async () => {
    const original = 'data:image/jpeg;base64,AAAA';
    await expect(downscaleDataUrl(original)).resolves.toBe(original);
  });

  describe('in a browser (fake Image + canvas)', () => {
    let canvas;
    let decodeFails;

    beforeEach(() => {
      decodeFails = false;
      canvas = {
        width: 0,
        height: 0,
        ctx: { fillRect: jest.fn(), drawImage: jest.fn(), fillStyle: null },
        getContext() { return this.ctx; },
        toDataURL: jest.fn(() => 'data:image/jpeg;base64,SMALL'),
      };
      global.document = { createElement: () => canvas };
      // Decodes "instantly" as a 4032x3024 phone photo, or fails when asked to.
      global.Image = class {
        set src(_value) {
          setTimeout(() => {
            if (decodeFails) { this.onerror(); return; }
            this.naturalWidth = 4032;
            this.naturalHeight = 3024;
            this.onload();
          }, 0);
        }
      };
    });

    afterEach(() => {
      delete global.document;
      delete global.Image;
    });

    test('draws at the fitted size and encodes JPEG at 85%', async () => {
      await expect(downscaleDataUrl('data:image/jpeg;base64,BIG')).resolves.toBe('data:image/jpeg;base64,SMALL');
      expect([canvas.width, canvas.height]).toEqual([1600, 1200]);
      expect(canvas.ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1200);
      expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.85);
    });

    test('an undecodable photo is sent as-is', async () => {
      decodeFails = true;
      await expect(downscaleDataUrl('data:image/heic;base64,XYZ')).resolves.toBe('data:image/heic;base64,XYZ');
    });
  });
});
