declare module 'jsmediatags' {
  interface Tags {
    title?: string;
    artist?: string;
    album?: string;
    year?: string;
    genre?: string;
    picture?: {
      format: string;
      data: Uint8Array;
    };
  }

  interface TagData {
    tags: Tags;
  }

  interface Callbacks {
    onSuccess: (tag: TagData) => void;
    onError: (error: Error) => void;
  }

  function read(file: File, callbacks: Callbacks): void;
  
  export default {
    read
  };
} 