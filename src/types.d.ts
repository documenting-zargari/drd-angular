// This file declares additional types for TypeScript

declare namespace NodeJS {
  interface ProcessEnv {
    API_URL: string;
    [key: string]: string | undefined;
  }
}

declare var process: {
  env: {
    API_URL: string;
    [key: string]: string | undefined;
  }
};