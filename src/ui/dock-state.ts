/**
 * Dock state tracker — persists "minimized" and "closed" state for surfaces
 * rendered with `placement: 'dock'`. dddk doesn't ship the dock widget itself
 * (hosts implement their own UI); this tracker provides the persistence layer
 * so user state survives reloads.
 *
 * Usage in a host renderer:
 *
 *   const dock = createDockState({ id: 'task_progress' });
 *   dock.onChange(({ minimized, closed }) => updateUI({ minimized, closed }));
 *
 *   minimizeBtn.onclick = () => dock.minimize();
 *   closeBtn.onclick    = () => dock.close();
 *   restoreBtn.onclick  = () => dock.restore();
 */

export type DockStateValue = {
  minimized: boolean;
  closed: boolean;
};

export interface DockState {
  id: string;
  read(): DockStateValue;
  minimize(): void;
  restore(): void;
  close(): void;
  reopen(): void;
  onChange(handler: (value: DockStateValue) => void): () => void;
}

export interface DockStateOpts {
  id: string;
  /** Where to persist state. Defaults to localStorage. Set to 'memory' to skip persistence. */
  storage?: 'localstorage' | 'memory';
}

const STORAGE_PREFIX = 'dddk:dock:';

export function createDockState(opts: DockStateOpts): DockState {
  const { id } = opts;
  const useStorage = (opts.storage ?? 'localstorage') === 'localstorage' && typeof localStorage !== 'undefined';
  const storageKey = STORAGE_PREFIX + id;
  const listeners = new Set<(v: DockStateValue) => void>();

  let value: DockStateValue = { minimized: false, closed: false };
  if (useStorage) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) value = JSON.parse(raw);
    } catch {
      /* ignore */
    }
  }

  function emit(): void {
    if (useStorage) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(value));
      } catch {
        /* quota / private mode — ignore */
      }
    }
    listeners.forEach((fn) => fn({ ...value }));
  }

  return {
    id,
    read: () => ({ ...value }),
    minimize() {
      value = { minimized: true, closed: false };
      emit();
    },
    restore() {
      value = { minimized: false, closed: false };
      emit();
    },
    close() {
      value = { minimized: false, closed: true };
      emit();
    },
    reopen() {
      value = { minimized: false, closed: false };
      emit();
    },
    onChange(handler) {
      listeners.add(handler);
      handler({ ...value });
      return () => listeners.delete(handler);
    },
  };
}
