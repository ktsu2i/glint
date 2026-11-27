import type { en } from "./locales/en";

declare module "i18next" {
  type CustomTypeOptions = {
    defaultNS: "translation";
    keySeparator: false;
    resources: {
      translation: typeof en;
    };
  };
}
