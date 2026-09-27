import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let frames: FrameRequestCallback[];
let manager: typeof import('./scrollLock');
let mockWindow: { scrollY: number; pageYOffset: number; scrollTo: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  vi.resetModules();
  frames = [];
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.stubGlobal('document', {
    body: { style: { overflow: '', position: '', width: '', top: '', left: '', right: '' } },
    documentElement: { scrollTop: 0 },
  });
  mockWindow = { scrollY: 261, pageYOffset: 0, scrollTo: vi.fn() };
  vi.stubGlobal('window', mockWindow);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  manager = await import('./scrollLock');
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function flushFrames() {
  while (frames.length) frames.splice(0).forEach((callback) => callback(0));
}

describe('scroll lock lifecycle', () => {
  it('keeps the background locked until the last nested sheet closes', () => {
    manager.lockScroll('settings');
    manager.lockScroll('confirmation');
    manager.unlockScroll('confirmation');
    expect(manager.getScrollLockCount()).toBe(1);
    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.top).toBe('-261px');
    expect(window.scrollTo).not.toHaveBeenCalled();
    manager.unlockScroll('settings');
    flushFrames();
    expect(manager.getScrollLockCount()).toBe(0);
    expect(document.body.style.position).toBe('');
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 261, behavior: 'instant' });
  });

  it('preserves the position on same-frame reopen and cancels stale restores', () => {
    manager.lockScroll('first');
    manager.unlockScroll('first');
    // Simulate the browser still reporting the fixed body's temporary offset.
    mockWindow.scrollY = 0;
    manager.lockScroll('reopen');
    expect(document.body.style.top).toBe('-261px');
    vi.mocked(window.scrollTo).mockClear();
    flushFrames();
    expect(window.scrollTo).not.toHaveBeenCalled();
    manager.unlockScroll('reopen');
    flushFrames();
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 261, behavior: 'instant' });
  });

  it('restores pre-existing body styles when route cleanup resets locks', () => {
    document.body.style.overflow = 'clip';
    manager.lockScroll('route');
    manager.resetScrollLocks('route-change');
    flushFrames();
    expect(manager.getScrollLockCount()).toBe(0);
    expect(document.body.style.overflow).toBe('clip');
    expect(document.body.style.position).toBe('');
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 261, behavior: 'instant' });
  });
});
