class MemCache {
  store = new Map<string, Response>();
  async match(req: Request | string) {
    const url = typeof req === "string" ? req : req.url;
    return this.store.get(url)?.clone() ?? undefined;
  }
  async put(req: Request | string, res: Response) {
    const url = typeof req === "string" ? req : req.url;
    this.store.set(url, res.clone());
  }
  async delete(req: Request | string) {
    const url = typeof req === "string" ? req : req.url;
    return this.store.delete(url);
  }
  async keys() {
    return [...this.store.keys()].map((u) => new Request(u));
  }
}

export function installMemCaches(): void {
  const caches = {
    _cache: new MemCache(),
    async open() {
      return this._cache;
    },
    async delete() {
      this._cache = new MemCache();
      return true;
    },
  };
  (globalThis as unknown as { caches: typeof caches }).caches = caches;
}
