/** A body readJson refuses: 413 when it's too large, 400 when it's missing or not JSON. */
export class JsonBodyError extends Error {
  constructor(readonly status: 400 | 413) {
    super(status === 413 ? "Request body too large" : "Request body is not valid JSON");
    this.name = "JsonBodyError";
  }
}

/** Parses the body as JSON, reading no more than maxBytes. */
export async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(req.headers.get("content-length"));
  if (declared > maxBytes) throw new JsonBodyError(413);
  if (!req.body) throw new JsonBodyError(400);

  // Content-Length may be missing or wrong, so count while reading.
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new JsonBodyError(413);
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();

  try {
    return JSON.parse(text);
  } catch {
    throw new JsonBodyError(400);
  }
}
