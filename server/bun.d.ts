declare namespace Bun {
  interface ServerWebSocket<T = unknown> {
    readonly data: T;
    send(message: string): unknown;
    close(code?: number, reason?: string): void;
  }

  interface Server<T = unknown> {
    readonly port: number;
    readonly hostname: string;
    upgrade(request: Request, options?: { readonly data: T }): boolean;
    stop(closeActiveConnections?: boolean): void;
  }

  interface ServeOptions<T = unknown> {
    readonly port?: number;
    readonly hostname?: string;
    readonly fetch: (request: Request, server: Server<T>) => Response | undefined | Promise<Response | undefined>;
    readonly websocket?: {
      readonly open?: (socket: ServerWebSocket<T>) => void;
      readonly message?: (socket: ServerWebSocket<T>, message: string | ArrayBuffer | Uint8Array) => void;
      readonly close?: (socket: ServerWebSocket<T>, code: number, reason: string) => void;
    };
  }

  function serve<T = unknown>(options: ServeOptions<T>): Server<T>;
  function file(path: string): Blob;

  const password: {
    hash(password: string, algorithm?: string | { readonly algorithm: string }): Promise<string>;
    verify(password: string, hash: string): Promise<boolean>;
  };
}

declare module "bun:sqlite" {
  export interface Statement<Row = unknown> {
    get(...params: readonly unknown[]): Row | null;
    all(...params: readonly unknown[]): Row[];
    run(...params: readonly unknown[]): void;
  }

  export class Database {
    constructor(filename?: string, options?: { readonly create?: boolean; readonly readwrite?: boolean; readonly readonly?: boolean });
    query<Row = unknown>(sql: string): Statement<Row>;
    run(sql: string, ...params: readonly unknown[]): void;
    exec(sql: string): void;
    close(): void;
  }
}
