const BASE_URL = "https://api.transport.nsw.gov.au/v1/tp";

/** GET a TfNSW Trip Planner endpoint and return the parsed JSON body. */
export async function tfnswGet(endpoint: string, params: Record<string, string>): Promise<unknown> {
  const apiKey = process.env.TFNSW_API_KEY;
  if (!apiKey) {
    throw new Error("TFNSW_API_KEY is not set");
  }

  const query = new URLSearchParams({
    outputFormat: "rapidJSON",
    coordOutputFormat: "EPSG:4326",
    ...params,
  });

  const res = await fetch(`${BASE_URL}/${endpoint}?${query}`, {
    headers: { Authorization: `apikey ${apiKey}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`TfNSW ${endpoint} failed with status ${res.status}`);
  }

  return res.json();
}
