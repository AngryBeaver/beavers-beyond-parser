// Stub — full implementation in T4.1 / T4.2

export const AiLookup = {
  isAvailable(): boolean {
    return false;
  },
  isEnabled(): boolean {
    return false;
  },
  isConfigured(): boolean {
    return false;
  },
  async semanticMatch(_parsedText: string, _descriptionText: string): Promise<boolean> {
    return false;
  },
  async patchMechanics(
    _data: Record<string, unknown>,
    _parsedText: string,
  ): Promise<Record<string, unknown> | null> {
    return null;
  },
};
