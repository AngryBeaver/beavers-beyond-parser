import { NAMESPACE, SETTINGS } from '../definitions.js';

export class BeyondFetcher {
  static async fetchPage(url: string): Promise<string> {
    const token = game.settings.get(NAMESPACE, SETTINGS.COBALT_TOKEN) as string;
    if (!token) throw new Error('No cobalt-token in settings — paste it under Module Settings first.');

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'text/html,application/xhtml+xml',
        'X-Requested-With': 'XMLHttpRequest',
      },
      credentials: 'omit',
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error('D&D Beyond rejected the token (401/403). Re-copy cobalt-token from your browser.');
    }
    if (!response.ok) {
      throw new Error(`D&D Beyond returned ${response.status} for ${url}`);
    }

    return response.text();
  }
}
