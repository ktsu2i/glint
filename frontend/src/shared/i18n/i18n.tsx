import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createInstance, type i18n } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { getLanguageSettings, saveLanguageSettings, type LanguagePreference } from "../api/backend";
import { onLanguageChanged } from "../api/events";

export const en = {
  "app.technicalReader": "Technical reader",
  "app.library": "Library",
  "app.addPdf": "Add PDF",
  "app.choosingPdf": "Choosing…",
  "app.pageLabel": "Page {page}",
  "error.loadLibrary": "Could not load the library.",
  "error.searchLibrary": "Could not search the library.",
  "error.loadAppearance": "Could not load appearance settings.",
  "error.saveAppearance": "Could not save appearance settings.",
  "error.addPdf": "Could not add the PDF.",
  "error.openBook": "Could not open the book.",
  "error.removeBook": "Could not remove the book.",
  "error.renameBook": "Could not rename the book.",
  "error.relinkPdf": "Could not choose the PDF again.",
  "error.savePosition": "Could not save your reading position.",
  "error.loadBookmarks": "Could not load bookmarks.",
  "error.saveBookmark": "Could not update the bookmark.",
  "error.loadLanguage": "Could not load language settings.",
  "error.saveLanguage": "Could not save language settings.",
  "library.loading": "Loading your library…",
  "library.emptyTitle": "Add your first book.",
  "library.emptyDescription":
    "Add a searchable technical PDF to save its cover and reading position locally.",
  "library.choosePdf": "Choose PDF",
  "library.importedBooks": "Imported books",
  "library.neverOpened": "Not opened yet",
  "library.recentlyOpened": "Recently opened",
  "library.pagesUntil": "Through page {page}",
  "library.startReading": "Start reading",
  "library.pageProgress": "{current} / {total} pages",
  "library.openBook": "Open {title}",
  "library.missingFile": "File not found",
  "library.displayName": "Display name for {title}",
  "library.remove": "Remove",
  "library.opening": "Opening…",
  "library.continue": "Continue",
  "library.continueBook": "Continue {title}",
  "library.choosing": "Choosing…",
  "library.chooseAgain": "Choose again",
  "library.relinkBook": "Choose the file for {title} again",
  "library.bookMenu": "Actions for {title}",
  "library.rename": "Rename",
  "library.chooseFileAgain": "Choose File Again…",
  "library.removeFromLibrary": "Remove from Library",
  "librarySearch.title": "Search the library",
  "librarySearch.open": "Search the library (⌘F)",
  "librarySearch.close": "Close search",
  "librarySearch.formAria": "Library search form",
  "librarySearch.inputAria": "Search query",
  "librarySearch.placeholder": "Search titles and text",
  "librarySearch.inProgress": "Searching",
  "librarySearch.prompt": "Type a keyword to find books by title or search every prepared page.",
  "librarySearch.searchingFor": "Searching for “{query}”…",
  "librarySearch.noResults": "No books contain “{query}”.",
  "librarySearch.hitCount": "Matches in {count} books",
  "librarySearch.totalMatches": "{count} matches",
  "librarySearch.goTo": "Open {title} at page {page}",
  "librarySearch.titleMatches": "Titles",
  "librarySearch.textMatches": "Text",
  "settings.items": "Settings sections",
  "settings.appearance": "Appearance",
  "settings.appearanceDescription":
    "Change the brightness of Library and Reader while preserving the PDF page itself.",
  "settings.themeOptions": "Display theme",
  "settings.themeLight": "Light",
  "settings.themeLightDescription": "A bright reading desk",
  "settings.themeDark": "Dark",
  "settings.themeDarkDescription": "A low-light study",
  "settings.themeSystem": "System",
  "settings.themeSystemDescription": "Follow the OS setting",
  "settings.language": "Language",
  "settings.languageDescription": "Choose the language used throughout Glint.",
  "settings.languageOptions": "Interface language",
  "settings.english": "English",
  "settings.englishDescription": "Use Glint in English",
  "settings.japanese": "Japanese",
  "settings.japaneseDescription": "Use Glint in Japanese",
  "settings.languageSaving": "Saving language…",
  "reader.emptyKicker": "Reading desk",
  "reader.aria": "PDF reader",
  "reader.epubPlaceholderAria": "EPUB reader placeholder",
  "reader.epubPlaceholderKicker": "EPUB · coming next",
  "reader.epubPlaceholderTitle": "EPUB reading is coming in the next phase.",
  "reader.epubPlaceholderBody":
    "The book is imported and searchable from the library. The reflowable reader lands once foliate-js is wired up.",
  "reader.epubPlaceholderSpine": "Spine has {count} sections.",
  "reader.pageControls": "Page controls",
  "reader.emptyTitle": "Read between the book and the code.",
  "reader.emptyDescription":
    "Open a searchable technical PDF. Page text is attached to questions only when you choose.",
  "reader.backToLibrary": "Library",
  "reader.closePanel": "Close panel",
  "reader.closeToc": "Close table of contents",
  "reader.openToc": "Open table of contents",
  "reader.closeSearch": "Close search",
  "reader.openSearch": "Search this book",
  "reader.closeBookmarks": "Close bookmarks",
  "reader.openBookmarks": "Open bookmarks",
  "reader.bookmarks": "Bookmarks",
  "reader.loadingBookmarks": "Loading bookmarks…",
  "reader.noBookmarks": "Save a page to return to it later.",
  "reader.savePageBookmark": "Save page {page}",
  "reader.removePageBookmark": "Remove bookmark from page {page}",
  "reader.goToBookmark": "Go to bookmarked page {page}",
  "reader.sliderBookmark": "Go to page {page}, bookmarked",
  "reader.bookmarkPage": "Page {page}",
  "reader.bookmarkSaved": "Saved page",
  "reader.previousPage": "Previous page",
  "reader.pageNumber": "Page number",
  "reader.goToPage": "Go to page",
  "reader.pageSlider": "Page slider",
  "reader.pageOfTotal": "Page {current} of {total}",
  "reader.nextPage": "Next page",
  "reader.view": "View",
  "reader.layoutHeading": "Pages",
  "reader.layoutSingle": "Single page",
  "reader.layoutSpread": "Spread",
  "reader.bindingHeading": "Binding",
  "reader.bindingLtr": "Left binding",
  "reader.bindingRtl": "Right binding",
  "reader.bindingLtrNote": "Pages turn from left to right.",
  "reader.bindingRtlNote": "Pages turn from right to left.",
  "reader.zoomHeading": "Zoom",
  "reader.fitPage": "Fit page",
  "reader.zoomOut": "Zoom out",
  "reader.zoomIn": "Zoom in",
  "reader.startReadAloud": "Start read aloud",
  "reader.stopReadAloud": "Stop read aloud",
  "reader.readAloudUnsupported": "Read aloud is not supported in this environment.",
  "reader.toc": "Table of contents",
  "reader.noToc": "No table of contents was found.",
  "reader.loadingToc": "Loading table of contents…",
  "reader.textSearch": "Text search",
  "reader.searchPlaceholder": "Enter a keyword",
  "reader.searchingAction": "Searching",
  "reader.searchAction": "Search",
  "reader.searchPrompt": "Search for terms or code names in the book.",
  "reader.searchingFor": "Searching for “{query}”…",
  "reader.noResults": "“{query}” was not found.",
  "reader.resultsFound": "Found on {count} pages",
  "reader.goToResult": "Go to page {page}",
  "reader.matches": "{count} matches",
  "reader.untitled": "(Untitled)",
  "error.pdfTimeout": "PDF loading timed out. Restart the app and open it again.",
  "error.openPdf": "Could not open the PDF.",
  "error.canvas": "Could not initialize the canvas.",
  "error.renderPage": "Could not render the page.",
  "error.searchBook": "Could not search the book.",
  "error.fetchPdf": "Could not fetch the PDF file (HTTP {status}).",
  "error.invalidPdf": "The selected data is not a PDF. Restart the app and open it again.",
} as const;

export const ja: Record<keyof typeof en, string> = {
  "app.technicalReader": "Technical reader",
  "app.library": "本棚",
  "app.addPdf": "PDFを追加",
  "app.choosingPdf": "選択しています…",
  "app.pageLabel": "{page}ページ",
  "error.loadLibrary": "本棚を読み込めませんでした。",
  "error.searchLibrary": "本棚を検索できませんでした。",
  "error.loadAppearance": "表示設定を読み込めませんでした。",
  "error.saveAppearance": "表示設定を保存できませんでした。",
  "error.addPdf": "PDFを追加できませんでした。",
  "error.openBook": "本を開けませんでした。",
  "error.removeBook": "本を削除できませんでした。",
  "error.renameBook": "本の名前を変更できませんでした。",
  "error.relinkPdf": "PDFを再選択できませんでした。",
  "error.savePosition": "読書位置を保存できませんでした。",
  "error.loadBookmarks": "しおりを読み込めませんでした。",
  "error.saveBookmark": "しおりを更新できませんでした。",
  "error.loadLanguage": "言語設定を読み込めませんでした。",
  "error.saveLanguage": "言語設定を保存できませんでした。",
  "library.loading": "本棚を読み込んでいます…",
  "library.emptyTitle": "最初の一冊を、本棚へ。",
  "library.emptyDescription":
    "検索可能な技術書PDFを追加すると、表紙と読書位置をローカルに保存します。",
  "library.choosePdf": "PDFを選ぶ",
  "library.importedBooks": "import済みの本",
  "library.neverOpened": "まだ開いていません",
  "library.recentlyOpened": "最近開いた本",
  "library.pagesUntil": "{page}ページまで",
  "library.startReading": "読み始める",
  "library.pageProgress": "{current} / {total}ページ",
  "library.openBook": "{title}を開く",
  "library.missingFile": "ファイルが見つかりません",
  "library.displayName": "{title}の表示名",
  "library.remove": "削除",
  "library.opening": "開いています…",
  "library.continue": "続きを読む",
  "library.continueBook": "{title}の続きを読む",
  "library.choosing": "選択中…",
  "library.chooseAgain": "再選択",
  "library.relinkBook": "{title}のファイルを再選択",
  "library.bookMenu": "{title}の操作",
  "library.rename": "名前を変更",
  "library.chooseFileAgain": "ファイルを再選択…",
  "library.removeFromLibrary": "本棚から削除",
  "librarySearch.title": "本棚を検索",
  "librarySearch.open": "本棚を検索（⌘F）",
  "librarySearch.close": "検索を閉じる",
  "librarySearch.formAria": "本棚検索フォーム",
  "librarySearch.inputAria": "検索語",
  "librarySearch.placeholder": "タイトルと本文を検索",
  "librarySearch.inProgress": "検索中",
  "librarySearch.prompt":
    "キーワードを入力すると、タイトルで本を探したり、準備済みのページを横断検索したりできます。",
  "librarySearch.searchingFor": "「{query}」を検索しています…",
  "librarySearch.noResults": "「{query}」を含む本は見つかりませんでした。",
  "librarySearch.hitCount": "{count}冊で見つかりました",
  "librarySearch.totalMatches": "{count}件",
  "librarySearch.goTo": "{title}の{page}ページを開く",
  "librarySearch.titleMatches": "タイトル",
  "librarySearch.textMatches": "本文",
  "settings.items": "設定項目",
  "settings.appearance": "表示",
  "settings.appearanceDescription":
    "PDFの紙面は保ったまま、Library・Readerの明るさを切り替えます。",
  "settings.themeOptions": "表示テーマ",
  "settings.themeLight": "ライト",
  "settings.themeLightDescription": "明るい読書机",
  "settings.themeDark": "ダーク",
  "settings.themeDarkDescription": "光を抑えた書斎",
  "settings.themeSystem": "システム",
  "settings.themeSystemDescription": "OSの設定に合わせる",
  "settings.language": "言語",
  "settings.languageDescription": "Glint全体で使用する言語を選択します。",
  "settings.languageOptions": "表示言語",
  "settings.english": "English",
  "settings.englishDescription": "Glintを英語で表示",
  "settings.japanese": "日本語",
  "settings.japaneseDescription": "Glintを日本語で表示",
  "settings.languageSaving": "言語を保存しています…",
  "reader.emptyKicker": "Reading desk",
  "reader.aria": "PDFリーダー",
  "reader.epubPlaceholderAria": "EPUBリーダーのプレースホルダー",
  "reader.epubPlaceholderKicker": "EPUB · 近日対応",
  "reader.epubPlaceholderTitle": "EPUBのリーダーは次フェーズで実装します。",
  "reader.epubPlaceholderBody":
    "本棚への登録と検索は完了しています。foliate-jsを組み込んだreflowable readerが続いて公開予定です。",
  "reader.epubPlaceholderSpine": "spineは{count}章で構成されています。",
  "reader.pageControls": "ページ操作",
  "reader.emptyTitle": "本とコードのあいだを読む。",
  "reader.emptyDescription":
    "検索可能な技術書PDFを開いてください。ページ本文は、必要なときだけ質問に添付できます。",
  "reader.backToLibrary": "本棚",
  "reader.closePanel": "パネルを閉じる",
  "reader.closeToc": "目次を閉じる",
  "reader.openToc": "目次を開く",
  "reader.closeSearch": "検索を閉じる",
  "reader.openSearch": "本の中を検索",
  "reader.closeBookmarks": "しおりを閉じる",
  "reader.openBookmarks": "しおりを開く",
  "reader.bookmarks": "しおり",
  "reader.loadingBookmarks": "しおりを読み込んでいます…",
  "reader.noBookmarks": "後で戻りたいページにしおりを保存できます。",
  "reader.savePageBookmark": "{page}ページをしおりに保存",
  "reader.removePageBookmark": "{page}ページのしおりを削除",
  "reader.goToBookmark": "しおりの{page}ページへ移動",
  "reader.sliderBookmark": "しおり付きの{page}ページへ移動",
  "reader.bookmarkPage": "{page}ページ",
  "reader.bookmarkSaved": "保存済みページ",
  "reader.previousPage": "前のページ",
  "reader.pageNumber": "ページ番号",
  "reader.goToPage": "ページ番号を指定",
  "reader.pageSlider": "ページスライダー",
  "reader.pageOfTotal": "{total}ページ中{current}ページ",
  "reader.nextPage": "次のページ",
  "reader.view": "表示",
  "reader.layoutHeading": "ページ",
  "reader.layoutSingle": "1ページ",
  "reader.layoutSpread": "見開き",
  "reader.bindingHeading": "綴じ方向",
  "reader.bindingLtr": "左綴じ",
  "reader.bindingRtl": "右綴じ",
  "reader.bindingLtrNote": "左から右へ読みます。",
  "reader.bindingRtlNote": "右から左へ読みます。",
  "reader.zoomHeading": "ズーム",
  "reader.fitPage": "全体を表示",
  "reader.zoomOut": "縮小",
  "reader.zoomIn": "拡大",
  "reader.startReadAloud": "読み上げを開始",
  "reader.stopReadAloud": "読み上げを停止",
  "reader.readAloudUnsupported": "この環境では読み上げに対応していません。",
  "reader.toc": "目次",
  "reader.noToc": "目次データが見つかりませんでした。",
  "reader.loadingToc": "目次を読み込んでいます…",
  "reader.textSearch": "本文検索",
  "reader.searchPlaceholder": "キーワードを入力",
  "reader.searchingAction": "検索中",
  "reader.searchAction": "検索",
  "reader.searchPrompt": "本に書かれている用語やコード名を検索します。",
  "reader.searchingFor": "「{query}」を検索しています…",
  "reader.noResults": "「{query}」は見つかりませんでした。",
  "reader.resultsFound": "{count}ページで見つかりました",
  "reader.goToResult": "{page}ページへ移動",
  "reader.matches": "一致 {count}",
  "reader.untitled": "(無題)",
  "error.pdfTimeout":
    "PDFの読み込みがタイムアウトしました。アプリを再起動して、もう一度開いてください。",
  "error.openPdf": "PDFを開けませんでした。",
  "error.canvas": "Canvasを初期化できませんでした。",
  "error.renderPage": "ページを描画できませんでした。",
  "error.searchBook": "本の中を検索できませんでした。",
  "error.fetchPdf": "PDFファイルを取得できませんでした（HTTP {status}）。",
  "error.invalidPdf":
    "取得したデータがPDFではありません。アプリを再起動して、もう一度開いてください。",
};

export type TranslationKey = keyof typeof en;

type LanguageSettingsValue = {
  language: LanguagePreference;
  loading: boolean;
  error: string;
  changeLanguage: (language: LanguagePreference) => Promise<void>;
};

export const resources = {
  en: { translation: en },
  ja: { translation: ja },
} as const;

function createI18n(language: LanguagePreference) {
  const instance = createInstance();
  void instance.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: "en",
    supportedLngs: ["en", "ja"],
    defaultNS: "translation",
    keySeparator: false,
    initAsync: false,
    interpolation: {
      escapeValue: false,
      prefix: "{",
      suffix: "}",
    },
    react: { useSuspense: false },
  });
  return instance;
}

const LanguageSettingsContext = createContext<LanguageSettingsValue>({
  language: "en",
  loading: false,
  error: "",
  changeLanguage: async () => {},
});

export function I18nProvider({
  children,
  initialLanguage,
}: {
  children: ReactNode;
  initialLanguage?: LanguagePreference;
}) {
  const [i18n] = useState<i18n>(() => createI18n(initialLanguage ?? "en"));
  const [language, setLanguage] = useState<LanguagePreference>(initialLanguage ?? "en");
  const [loading, setLoading] = useState(initialLanguage === undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    if (initialLanguage !== undefined) return;
    let active = true;
    const load = async () => {
      try {
        const settings = await getLanguageSettings();
        if (!active) return;
        await i18n.changeLanguage(settings.language);
        if (!active) return;
        setLanguage(settings.language);
        setError("");
      } catch (reason) {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : i18n.t("error.loadLanguage"));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [i18n, initialLanguage]);

  // Follow a language saved in another window, such as the settings window.
  useEffect(() => {
    if (initialLanguage !== undefined) return;
    return onLanguageChanged((next) => {
      void i18n.changeLanguage(next);
      setLanguage(next);
      setError("");
    });
  }, [i18n, initialLanguage]);

  const changeLanguage = useCallback(
    async (next: LanguagePreference) => {
      if (next === language) return;
      const previous = language;
      setError("");
      try {
        await i18n.changeLanguage(next);
        setLanguage(next);
        const saved = await saveLanguageSettings(next);
        await i18n.changeLanguage(saved.language);
        setLanguage(saved.language);
      } catch (reason) {
        await i18n.changeLanguage(previous);
        setLanguage(previous);
        const message =
          reason instanceof Error
            ? reason.message
            : i18n.t("error.saveLanguage", { lng: previous });
        setError(message);
        throw new Error(message, { cause: reason });
      }
    },
    [i18n, language],
  );

  const value = useMemo<LanguageSettingsValue>(
    () => ({
      language,
      loading,
      error,
      changeLanguage,
    }),
    [changeLanguage, error, language, loading],
  );

  return (
    <I18nextProvider i18n={i18n}>
      <LanguageSettingsContext.Provider value={value}>{children}</LanguageSettingsContext.Provider>
    </I18nextProvider>
  );
}

export function useLanguageSettings() {
  return useContext(LanguageSettingsContext);
}
