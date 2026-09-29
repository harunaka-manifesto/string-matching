async function pipe(bytes: Uint8Array, transform: GenericTransformStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(transform as TransformStream);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gzipText(text: string): Promise<Uint8Array> {
  return pipe(new TextEncoder().encode(text), new CompressionStream('gzip'));
}

export async function gunzipText(bytes: Uint8Array): Promise<string> {
  return new TextDecoder().decode(await pipe(bytes, new DecompressionStream('gzip')));
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
