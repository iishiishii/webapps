/**
 * Install a worker message handler synchronously. Lazy services do not start
 * loading until the first message is dispatched.
 */
export function installWorkerRouter({
  scope = globalThis,
  handlers = {},
  handle = null,
  getServices = async () => ({}),
  onError = null,
} = {}) {
  if (!scope || typeof scope.postMessage !== 'function') throw new Error('installWorkerRouter requires a worker scope');
  if (!handle && (!handlers || typeof handlers !== 'object')) throw new Error('installWorkerRouter requires handlers or handle');

  let servicesPromise;
  const services = () => {
    servicesPromise ||= Promise.resolve().then(getServices);
    return servicesPromise;
  };

  scope.onmessage = async (event) => {
    const message = event?.data;
    try {
      if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
        throw new Error('Worker messages require a string type');
      }
      const loaded = await services();
      if (handle) {
        await handle(message, { event, services: loaded });
        return;
      }
      const handler = handlers[message.type];
      if (!handler) return;
      await handler(message.data, { event, message, services: loaded });
    } catch (error) {
      const message = error?.message || String(error);
      if (onError) onError(message, error);
      else scope.postMessage({ type: 'error', message });
    }
  };

  return Object.freeze({
    resetServices() { servicesPromise = undefined; },
  });
}
