function abortError(message: string): DOMException {
  return new DOMException(message, 'AbortError')
}

/** Owns the cancellation signal for the currently relevant OME-Zarr read plan. */
export class ZarrReadSession {
  private controller = new AbortController()
  private readonly lifetimeController = new AbortController()
  private currentSignal: AbortSignal
  private readonly parent: AbortSignal | undefined

  constructor(parent?: AbortSignal) {
    this.parent = parent
    this.currentSignal = this.combineSignals()
  }

  get signal(): AbortSignal {
    return this.currentSignal
  }

  /** Survives plan renewal but aborts when the source itself is disposed. */
  get lifetimeSignal(): AbortSignal {
    return this.parent
      ? AbortSignal.any([this.parent, this.lifetimeController.signal])
      : this.lifetimeController.signal
  }

  /** Combine the active plan lifetime with one renderer brick's lifetime. */
  signalFor(request?: AbortSignal): AbortSignal {
    return request
      ? AbortSignal.any([this.currentSignal, request])
      : this.currentSignal
  }

  renew(): void {
    this.controller.abort(abortError('OME-Zarr read plan superseded'))
    this.controller = new AbortController()
    this.currentSignal = this.combineSignals()
  }

  abort(message = 'OME-Zarr read session disposed'): void {
    const reason = abortError(message)
    this.controller.abort(reason)
    this.lifetimeController.abort(reason)
  }

  private combineSignals(): AbortSignal {
    return this.parent
      ? AbortSignal.any([this.parent, this.controller.signal])
      : this.controller.signal
  }
}
