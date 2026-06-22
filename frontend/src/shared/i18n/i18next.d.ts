import "i18next";
import type { en } from "./i18n";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    keySeparator: false;
    resources: {
      translation: typeof en;
    };
  }
}
