declare namespace foundry {
  namespace utils {
    function randomID(length?: number): string;
  }
  namespace applications {
    namespace api {
      class ApplicationV2<TContext = object> {
        element: HTMLElement;
        render(options?: { force?: boolean; parts?: string[] }): Promise<this>;
        close(options?: object): Promise<this>;
        _configureRenderOptions(options: { parts?: string[]; [key: string]: unknown }): void;
        _replaceContent(result: HTMLElement, content: HTMLElement, options: object): void;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function HandlebarsApplicationMixin(Base: typeof ApplicationV2): typeof ApplicationV2;
    }
  }
}

interface BeaversBeyondGame extends foundry.Game {
  'beavers-beyond-parser': unknown;
}

declare const game: BeaversBeyondGame;

interface SettingConfig {
  'beavers-beyond-parser.proxyUrl': string;
}
