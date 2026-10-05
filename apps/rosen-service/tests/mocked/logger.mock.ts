import { DefaultLogger, DummyLogger } from '@rosen-bridge/abstract-logger';

// Bootstrap the actual service logger without configuring transports or writing logs.
DefaultLogger.init(new DummyLogger());
