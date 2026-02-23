export function encodeArrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const end = Math.min(bytes.length, offset + chunkSize);
    for (let index = offset; index < end; index += 1) {
      binary += String.fromCharCode(bytes[index] ?? 0);
    }
  }

  return btoa(binary);
}

export function decodeBase64ToArrayBuffer(encoded: string): ArrayBuffer | null {
  const normalized = encoded.trim();
  if (!normalized) {
    return null;
  }

  try {
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
  } catch {
    return null;
  }
}
