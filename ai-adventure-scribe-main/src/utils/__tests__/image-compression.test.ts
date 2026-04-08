/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { compressImage, convertToWebP } from '../image-compression';

describe('image-compression', () => {
  let mockCanvas: any;
  let mockCtx: any;
  let mockImage: any;
  let mockFileReader: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock Canvas
    mockCtx = {
      drawImage: vi.fn(),
    };
    mockCanvas = {
      getContext: vi.fn(() => mockCtx),
      toBlob: vi.fn((callback, type, quality) => {
        callback(new Blob(['mock-image-data'], { type }));
      }),
      width: 0,
      height: 0,
    };

    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag === 'canvas') return mockCanvas;
      return document.createElement(tag);
    });

    // Mock Image
    mockImage = {
      onload: null,
      onerror: null,
      _src: '',
      width: 100,
      height: 100,
    };

    // Define src property to trigger onload/onerror
    Object.defineProperty(mockImage, 'src', {
      get() { return this._src; },
      set(value) {
        this._src = value;
        if (this.shouldFail) {
          setTimeout(() => this.onerror?.(), 0);
        } else {
          setTimeout(() => this.onload?.(), 0);
        }
      }
    });

    vi.stubGlobal('Image', vi.fn(() => mockImage));

    // Mock FileReader
    mockFileReader = {
      readAsDataURL: vi.fn(function(this: any) {
        setTimeout(() => {
          if (this.shouldFail) {
            this.onerror?.();
          } else {
            this.onload?.({ target: { result: 'data:image/png;base64,mock' } });
          }
        }, 0);
      }),
      onload: null,
      onerror: null,
    };
    vi.stubGlobal('FileReader', vi.fn(() => mockFileReader));
  });

  describe('compressImage', () => {
    it('should compress an image and preserve aspect ratio (landscape)', async () => {
      const file = new File([''], 'test.png', { type: 'image/png' });
      mockImage.width = 2000;
      mockImage.height = 1000;

      const result = await compressImage(file, 1, 1000);

      expect(result).toBeInstanceOf(Blob);
      expect(mockCanvas.width).toBe(1000);
      expect(mockCanvas.height).toBe(500);
      expect(mockCtx.drawImage).toHaveBeenCalled();
    });

    it('should compress an image and preserve aspect ratio (portrait)', async () => {
      const file = new File([''], 'test.png', { type: 'image/png' });
      mockImage.width = 1000;
      mockImage.height = 2000;

      const result = await compressImage(file, 1, 1000);

      expect(result).toBeInstanceOf(Blob);
      expect(mockCanvas.width).toBe(500);
      expect(mockCanvas.height).toBe(1000);
    });

    it('should not resize if image is smaller than maxWidthOrHeight', async () => {
      const file = new File([''], 'test.png', { type: 'image/png' });
      mockImage.width = 500;
      mockImage.height = 400;

      await compressImage(file, 1, 1000);

      expect(mockCanvas.width).toBe(500);
      expect(mockCanvas.height).toBe(400);
    });

    it('should iterate quality if blob is too large', async () => {
      const file = new File([''], 'test.png', { type: 'image/png' });

      // Mock toBlob to return a large blob first, then a small one
      let callCount = 0;
      mockCanvas.toBlob = vi.fn((callback, type, quality) => {
        callCount++;
        if (callCount === 1) {
          // First call, return large blob (2MB > 1MB limit)
          callback(new Blob([new ArrayBuffer(2 * 1024 * 1024)], { type }));
        } else {
          // Subsequent call, return small blob
          callback(new Blob(['small'], { type }));
        }
      });

      await compressImage(file, 1, 1000);

      expect(mockCanvas.toBlob).toHaveBeenCalledTimes(2);
      // First quality is 0.9, second should be 0.8
      expect(mockCanvas.toBlob).toHaveBeenLastCalledWith(expect.any(Function), 'image/png', 0.8);
    });

    it('should reject if FileReader fails', async () => {
      const file = new File([''], 'test.png', { type: 'image/png' });

      // We need to set shouldFail on the instance that will be created
      const originalFileReader = globalThis.FileReader;
      vi.stubGlobal('FileReader', vi.fn(() => {
        const instance = new (originalFileReader as any)();
        instance.readAsDataURL = vi.fn(function(this: any) {
          setTimeout(() => this.onerror?.(), 0);
        });
        return instance;
      }));

      await expect(compressImage(file)).rejects.toThrow('Failed to read file');
    });

    it('should reject if Image fails to load', async () => {
      const file = new File([''], 'test.png', { type: 'image/png' });
      mockImage.shouldFail = true;

      await expect(compressImage(file)).rejects.toThrow('Failed to load image');
    });

    it('should reject if canvas context is missing', async () => {
      const file = new File([''], 'test.png', { type: 'image/png' });
      mockCanvas.getContext.mockReturnValue(null);

      await expect(compressImage(file)).rejects.toThrow('Failed to get canvas context');
    });

    it('should reject if toBlob returns null', async () => {
      const file = new File([''], 'test.png', { type: 'image/png' });
      mockCanvas.toBlob = vi.fn((callback) => callback(null));

      await expect(compressImage(file)).rejects.toThrow('Failed to compress image');
    });
  });

  describe('convertToWebP', () => {
    it('should convert an image to WebP and resize if necessary', async () => {
      const file = new File([''], 'test.png', { type: 'image/png' });
      mockImage.width = 2000;
      mockImage.height = 1000;

      const result = await convertToWebP(file, 0.85, 1000);

      expect(result).toBeInstanceOf(Blob);
      expect(mockCanvas.width).toBe(1000);
      expect(mockCanvas.height).toBe(500);
      expect(mockCanvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.85);
    });

    it('should reject if toBlob returns null during WebP conversion', async () => {
      const file = new File([''], 'test.png', { type: 'image/png' });
      mockCanvas.toBlob = vi.fn((callback) => callback(null));

      await expect(convertToWebP(file)).rejects.toThrow('Failed to convert to WebP');
    });

    it('should reject if FileReader fails during WebP conversion', async () => {
      const file = new File([''], 'test.png', { type: 'image/png' });

      const originalFileReader = globalThis.FileReader;
      vi.stubGlobal('FileReader', vi.fn(() => {
        const instance = new (originalFileReader as any)();
        instance.readAsDataURL = vi.fn(function(this: any) {
          setTimeout(() => this.onerror?.(), 0);
        });
        return instance;
      }));

      await expect(convertToWebP(file)).rejects.toThrow('Failed to read file');
    });

    it('should reject if Image fails to load during WebP conversion', async () => {
      const file = new File([''], 'test.png', { type: 'image/png' });
      mockImage.shouldFail = true;

      await expect(convertToWebP(file)).rejects.toThrow('Failed to load image');
    });

    it('should reject if canvas context is missing during WebP conversion', async () => {
      const file = new File([''], 'test.png', { type: 'image/png' });
      mockCanvas.getContext.mockReturnValue(null);

      await expect(convertToWebP(file)).rejects.toThrow('Failed to get canvas context');
    });

    it('should resize correctly when width < height (portrait)', async () => {
      const file = new File([''], 'test.png', { type: 'image/png' });
      mockImage.width = 1000;
      mockImage.height = 2000;

      await convertToWebP(file, 0.85, 1000);

      expect(mockCanvas.width).toBe(500);
      expect(mockCanvas.height).toBe(1000);
    });
  });
});
