export interface RuntimeEnv {
  BACKEND_URL: string;
}

declare global {
  interface Window {
    __ENV__?: RuntimeEnv;
  }
}

export {};
