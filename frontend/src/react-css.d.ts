export {};

declare module "react" {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging には interface が必要。
  interface CSSProperties {
    [key: `--${string}`]: string | number | undefined;
  }
}
