export interface WikipediaSummary {
  readonly title: string;
  readonly extract: string;
  readonly thumbnail?: { readonly source: string; readonly width: number; readonly height: number };
}

export async function fetchWikipediaSummary(slug: string, signal?: AbortSignal): Promise<WikipediaSummary | null> {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug)}`;
    const init: RequestInit = signal ? { signal } : {};
    const res = await fetch(url, init);
    if (!res.ok) return null;
    return res.json() as Promise<WikipediaSummary>;
  } catch {
    return null;
  }
}
