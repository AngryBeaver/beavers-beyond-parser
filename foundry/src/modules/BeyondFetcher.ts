import { NAMESPACE, SETTINGS } from '../definitions.js';

export class BeyondFetcher {
  static async fetchPage(url: string): Promise<string> {
    const proxyUrl = (game.settings.get(NAMESPACE, SETTINGS.PROXY_URL) ?? '').replace(/\/$/, '');
    if (!proxyUrl) {
      throw new Error(
        'Proxy URL not set. Start the Docker container and set the URL in Module Settings.',
      );
    }

    const response = await fetch(`${proxyUrl}/fetch?url=${encodeURIComponent(url)}`);
    if (!response.ok) {
      let msg = `Proxy returned ${response.status}`;
      try {
        const body = (await response.json()) as { error?: string };
        if (body.error) msg = body.error;
      } catch {}
      throw new Error(msg);
    }
    return response.text();
  }
}
