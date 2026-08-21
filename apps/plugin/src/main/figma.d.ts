declare const __html__: string;

type PluginFetchOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  redirect?: 'follow' | 'error';
};

type PluginFetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

declare function fetch(url: string, options?: PluginFetchOptions): Promise<PluginFetchResponse>;
