import { collectTransferables } from '../inference/workerProtocol.js';

export class WorkerSession {
  constructor({ createWorker, onError = null } = {}) {
    if (typeof createWorker !== 'function') throw new TypeError('WorkerSession requires createWorker');
    this.createWorker = createWorker;
    this.onError = onError;
    this.worker = null;
    this.listeners = new Set();
  }

  start() {
    if (this.worker) return;
    const worker = this.createWorker();
    worker.onmessage = (event) => {
      for (const listener of this.listeners) listener(event.data || {});
    };
    worker.onerror = (event) => this.onError?.(event.message || 'Worker error', event);
    worker.onmessageerror = (event) => this.onError?.('Worker message could not be deserialized', event);
    this.worker = worker;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('WorkerSession listener must be a function');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(message, transfer = collectTransferables(message)) {
    if (!this.worker) throw new Error('WorkerSession has not started');
    this.worker.postMessage(message, transfer);
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
  }
}
