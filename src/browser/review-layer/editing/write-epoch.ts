/*
 * read-when: Changing how Lahe's own page writes are kept from retriggering replay, or when replay loops or a repaint never gets its pass.
 */

export interface WriteEpoch {
  write<T>(reason: string, fn: () => T): T;
  isWriting(): boolean;
  epoch(): number;
  noteExternalMutation(): void;
  takePendingExternal(): boolean;
  onIdle(listener: () => void): () => void;
}

export function createEpoch(): WriteEpoch {
  let depth = 0;
  let current = 0;
  let pendingExternal = false;
  const idleListeners: Array<() => void> = [];

  function close(): void {
    if (depth > 0) depth -= 1;
    if (depth !== 0 || !pendingExternal) return;
    for (const listener of [...idleListeners]) listener();
  }

  return {
    write<T>(reason: string, fn: () => T): T {
      if (reason === "") {
        throw new TypeError("write-epoch.write: reason must be a non-empty string naming the caller");
      }
      depth += 1;
      try {
        return fn();
      } finally {
        current += 1;
        queueMicrotask(close);
      }
    },
    isWriting(): boolean {
      return depth > 0;
    },
    epoch(): number {
      return current;
    },
    noteExternalMutation(): void {
      pendingExternal = true;
    },
    takePendingExternal(): boolean {
      const was = pendingExternal;
      pendingExternal = false;
      return was;
    },
    onIdle(listener: () => void): () => void {
      idleListeners.push(listener);
      return () => {
        const at = idleListeners.indexOf(listener);
        if (at !== -1) idleListeners.splice(at, 1);
      };
    }
  };
}

const pageEpoch = createEpoch();

export function write<T>(reason: string, fn: () => T): T {
  return pageEpoch.write(reason, fn);
}

export function isWriting(): boolean {
  return pageEpoch.isWriting();
}

export function epoch(): number {
  return pageEpoch.epoch();
}

export function noteExternalMutation(): void {
  pageEpoch.noteExternalMutation();
}

export function takePendingExternal(): boolean {
  return pageEpoch.takePendingExternal();
}

export function onIdle(listener: () => void): () => void {
  return pageEpoch.onIdle(listener);
}
