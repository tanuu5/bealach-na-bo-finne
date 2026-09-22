// Tiny synchronous event emitter shared by core and modules.
export function createEvents() {
  const map = new Map();

  function on(name, fn) {
    let set = map.get(name);
    if (!set) map.set(name, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  function once(name, fn) {
    const off = on(name, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  function emit(name, payload = {}) {
    const set = map.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[events] handler for "${name}" threw`, err);
      }
    }
  }

  return { on, once, emit };
}
