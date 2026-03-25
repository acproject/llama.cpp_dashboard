export type RespValue =
  | string
  | number
  | null
  | RespValue[]
  | Buffer;

export interface MiniMemoryClientOptions {
  host?: string;
  port?: number;
  password?: string | null;
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
  returnBuffers?: boolean;
}

export interface CallOptions {
  timeoutMs?: number;
}

export interface GraphNeighborsX2Options {
  edgeMetaKeys?: string[];
  fromMetaKeys?: string[];
  toMetaKeys?: string[];
}

export interface EvidenceSearchFOptions {
  tag?: string[];
  meta?: Record<string, string | number | boolean | null>;
  keyPrefix?: string;
  graphFrom?: string;
  graphRel?: string;
  graphDepth?: number;
}

export declare class MiniMemoryClient {
  constructor(options?: MiniMemoryClientOptions);

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  call(args: Array<string | number | boolean | null | undefined>, options?: CallOptions): Promise<RespValue>;

  ping(): Promise<string>;

  set(key: string, value: string | number | boolean): Promise<string>;
  get(key: string): Promise<string | Buffer | null>;
  del(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;

  select(index: number | string): Promise<string>;
  pexpire(key: string, ttlMs: number | string): Promise<number>;
  pttl(key: string): Promise<number | string | null>;

  scan(pattern: string, count?: number): Promise<Array<string | Buffer>>;
  keys(pattern: string): Promise<Array<string | Buffer>>;
  flushdb(): Promise<string>;
  flushall(): Promise<string>;

  metaset(subject: string, field: string, value: string): Promise<string>;
  metaget(subject: string, field: string): Promise<string | Buffer | null>;
  tagadd(subject: string, ...tags: string[]): Promise<string>;
  hotset(subject: string, flag: string | number | boolean): Promise<string>;

  objset(key: string, mime: string, data: string | Buffer): Promise<string>;
  objget(key: string): Promise<string | Buffer | null>;

  graphAddEdge(from: string, rel: string, to: string): Promise<string>;
  graphDelEdge(from: string, rel: string, to: string): Promise<string>;
  graphHasEdge(from: string, rel: string, to: string): Promise<number | string>;
  graphEdgePropSet(from: string, rel: string, to: string, field: string, value: string): Promise<string>;
  graphEdgePropGet(from: string, rel: string, to: string, field?: string): Promise<RespValue>;
  graphNeighborsX2(node: string, rel?: string, limit?: number, options?: GraphNeighborsX2Options): Promise<RespValue>;

  evidenceSearchF(
    topk: number,
    metric: string,
    dim: number,
    queryVector: Array<number | string>,
    options?: EvidenceSearchFOptions
  ): Promise<RespValue>;

  embed(mode: string, text: string): Promise<RespValue>;
  embedSet(key: string, mode: string, text: string): Promise<RespValue>;
}

export declare function createClient(options?: MiniMemoryClientOptions): MiniMemoryClient;
export declare function encodeRespCommand(args: Array<string | number | boolean | null | undefined>): Buffer;

