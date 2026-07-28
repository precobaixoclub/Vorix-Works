export type ResultSuccess<T> = {
  ok: true;
  value: T;
};

export type ResultFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    recoverable: boolean;
  };
};

export type Result<T> = ResultSuccess<T> | ResultFailure;
