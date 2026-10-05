import { afterEach, beforeEach, vi } from 'vitest';

/** Provide the browser origin required by the SDK without any real provider connection. */
beforeEach(() => vi.stubGlobal('window', { location: { origin: 'https://example.invalid' } }));
afterEach(() => vi.unstubAllGlobals());
