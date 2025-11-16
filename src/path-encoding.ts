export function encodePatchToBase64(payload: {
  code: string;
  sr: number;
  classic: boolean;
}): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodePatchFromBase64(value: string): {
  code?: unknown;
  sr?: unknown;
  classic?: unknown;
} | null {
  try {
    let b64 = value.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      bytes[i] = bin.charCodeAt(i);
    }
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json) as {
      code?: unknown;
      sr?: unknown;
      classic?: unknown;
    };
    return parsed;
  } catch {
    return null;
  }
}