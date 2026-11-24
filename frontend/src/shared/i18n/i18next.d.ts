import type { en } from "./i18n";

declare module "i18next" {
  type CustomTypeOptions = {
    defaultNS: "translation";
    keySeparator: false;
    resources: {
      translation: typeof en;
    };
  };
}
