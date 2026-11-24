// style prop で CSS custom property (`--foo`) を型安全に渡せるようにする。
// declaration merging のため interface を使う。
export {};

declare module "react" {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging には interface が必要。
  interface CSSProperties {
    [key: `--${string}`]: string | number | undefined;
  }
}
