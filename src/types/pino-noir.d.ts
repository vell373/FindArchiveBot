declare module 'pino-noir' {
  function pinoNoir(
    paths: string[],
    options?: {
      censor?: string;
      remove?: boolean;
    }
  ): Record<string, unknown>;
  
  export = pinoNoir;
}
