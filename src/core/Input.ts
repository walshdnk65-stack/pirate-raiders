/** Keyboard + mouse input with per-frame "pressed" edges. */
export class Input {
  private keys = new Set<string>();
  private pressedKeys = new Set<string>();
  private releasedKeys = new Set<string>();
  private buttons = new Set<number>();
  private pressedButtons = new Set<number>();
  private releasedButtons = new Set<number>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  dragging = false;
  lastMouseMove = -999;
  enabled = true;
  /** called inside the mousedown handler (a user gesture, so pointer lock may be requested) */
  onCanvasDown: ((button: number) => void) | null = null;

  constructor(private canvas: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.pressedKeys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.releasedKeys.add(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
      this.dragging = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      if (e.button <= 2) {
        this.dragging = true;
        this.buttons.add(e.button);
        this.pressedButtons.add(e.button);
        if (e.button === 1) e.preventDefault();
        this.onCanvasDown?.(e.button);
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (this.buttons.delete(e.button)) this.releasedButtons.add(e.button);
      if (!this.buttons.size) this.dragging = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging && !this.pointerLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
      this.lastMouseMove = performance.now() / 1000;
    });
    document.addEventListener('pointerlockchange', () => {
      // buttons held when the lock was lost never send their mouseup to the page
      if (!this.pointerLocked) {
        for (const b of this.buttons) this.releasedButtons.add(b);
        this.buttons.clear();
        this.dragging = false;
      }
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        this.wheel += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
  }

  /** Dev/testing: simulate a key press or release. */
  simulate(code: string, isDown: boolean) {
    if (isDown) {
      if (!this.keys.has(code)) this.pressedKeys.add(code);
      this.keys.add(code);
    } else {
      this.keys.delete(code);
      this.releasedKeys.add(code);
    }
  }

  /** Dev/testing: simulate a mouse button. */
  simulateMouse(button: number, isDown: boolean) {
    if (isDown) {
      if (!this.buttons.has(button)) this.pressedButtons.add(button);
      this.buttons.add(button);
    } else if (this.buttons.delete(button)) this.releasedButtons.add(button);
  }

  down(...codes: string[]) {
    if (!this.enabled) return false;
    return codes.some((c) => this.keys.has(c));
  }
  pressed(...codes: string[]) {
    if (!this.enabled) return false;
    return codes.some((c) => this.pressedKeys.has(c));
  }
  released(...codes: string[]) {
    return codes.some((c) => this.releasedKeys.has(c));
  }
  /** 0 = left, 1 = middle, 2 = right */
  mouseDown(b: number) {
    return this.enabled && this.buttons.has(b);
  }
  mousePressed(b: number) {
    return this.enabled && this.pressedButtons.has(b);
  }
  mouseReleased(b: number) {
    return this.releasedButtons.has(b);
  }

  get pointerLocked() {
    return document.pointerLockElement === this.canvas;
  }
  /** Capture the mouse for free look (must be called from a user gesture). */
  lockPointer() {
    if (this.pointerLocked) return;
    try {
      const r = (this.canvas as HTMLCanvasElement).requestPointerLock?.() as unknown as Promise<void> | undefined;
      r?.catch?.(() => undefined);
    } catch {
      /* not allowed right now (e.g. just after Esc) */
    }
  }
  unlockPointer() {
    if (this.pointerLocked) document.exitPointerLock();
  }

  /** Call at the end of each frame. */
  endFrame() {
    this.pressedKeys.clear();
    this.releasedKeys.clear();
    this.pressedButtons.clear();
    this.releasedButtons.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  get forward() {
    return this.down('KeyW', 'ArrowUp');
  }
  get back() {
    return this.down('KeyS', 'ArrowDown');
  }
  get left() {
    return this.down('KeyA', 'ArrowLeft');
  }
  get right() {
    return this.down('KeyD', 'ArrowRight');
  }
  get boost() {
    return this.down('ShiftLeft', 'ShiftRight');
  }
}
