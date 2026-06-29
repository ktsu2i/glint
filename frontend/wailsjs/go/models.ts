export namespace books {
	
	export class BookBookmark {
	    pageNumber: number;
	    createdAt: string;
	
	    static createFrom(source: any = {}) {
	        return new BookBookmark(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pageNumber = source["pageNumber"];
	        this.createdAt = source["createdAt"];
	    }
	}
	export class SpineItem {
	    index: number;
	    id: string;
	    href: string;
	    mediaType: string;
	    title: string;
	
	    static createFrom(source: any = {}) {
	        return new SpineItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.index = source["index"];
	        this.id = source["id"];
	        this.href = source["href"];
	        this.mediaType = source["mediaType"];
	        this.title = source["title"];
	    }
	}
	export class BookFile {
	    id: string;
	    title: string;
	    name: string;
	    url: string;
	    format: string;
	    size: number;
	    initialPage: number;
	    indexedPageCount: number;
	    coverStatus: string;
	    spineItems?: SpineItem[];
	
	    static createFrom(source: any = {}) {
	        return new BookFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.name = source["name"];
	        this.url = source["url"];
	        this.format = source["format"];
	        this.size = source["size"];
	        this.initialPage = source["initialPage"];
	        this.indexedPageCount = source["indexedPageCount"];
	        this.coverStatus = source["coverStatus"];
	        this.spineItems = this.convertValues(source["spineItems"], SpineItem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class BookPageInput {
	    pageNumber: number;
	    text: string;
	    width: number;
	    height: number;
	
	    static createFrom(source: any = {}) {
	        return new BookPageInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pageNumber = source["pageNumber"];
	        this.text = source["text"];
	        this.width = source["width"];
	        this.height = source["height"];
	    }
	}
	export class BookSearchResult {
	    pageNumber: number;
	    excerpt: string;
	    matchCount: number;
	
	    static createFrom(source: any = {}) {
	        return new BookSearchResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pageNumber = source["pageNumber"];
	        this.excerpt = source["excerpt"];
	        this.matchCount = source["matchCount"];
	    }
	}
	export class BookSummary {
	    id: string;
	    title: string;
	    fileName: string;
	    format: string;
	    size: number;
	    pageCount: number;
	    lastPage: number;
	    importedAt: string;
	    lastOpenedAt: string;
	    coverUrl: string;
	    coverStatus: string;
	    available: boolean;
	
	    static createFrom(source: any = {}) {
	        return new BookSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.fileName = source["fileName"];
	        this.format = source["format"];
	        this.size = source["size"];
	        this.pageCount = source["pageCount"];
	        this.lastPage = source["lastPage"];
	        this.importedAt = source["importedAt"];
	        this.lastOpenedAt = source["lastOpenedAt"];
	        this.coverUrl = source["coverUrl"];
	        this.coverStatus = source["coverStatus"];
	        this.available = source["available"];
	    }
	}
	export class LibrarySearchHit {
	    book: BookSummary;
	    totalMatches: number;
	    pages: BookSearchResult[];
	
	    static createFrom(source: any = {}) {
	        return new LibrarySearchHit(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.book = this.convertValues(source["book"], BookSummary);
	        this.totalMatches = source["totalMatches"];
	        this.pages = this.convertValues(source["pages"], BookSearchResult);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace llm {
	
	export class ContextBudget {
	    promptRunes: number;
	    answerTokens: number;
	    retrievalShare: number;
	    source: string;
	    limit: number;
	
	    static createFrom(source: any = {}) {
	        return new ContextBudget(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.promptRunes = source["promptRunes"];
	        this.answerTokens = source["answerTokens"];
	        this.retrievalShare = source["retrievalShare"];
	        this.source = source["source"];
	        this.limit = source["limit"];
	    }
	}
	export class ChatRequest {
	    requestId: string;
	    question: string;
	    contextText: string;
	    bookName: string;
	    pageNumber: number;
	    budgetUsed?: ContextBudget;
	
	    static createFrom(source: any = {}) {
	        return new ChatRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.requestId = source["requestId"];
	        this.question = source["question"];
	        this.contextText = source["contextText"];
	        this.bookName = source["bookName"];
	        this.pageNumber = source["pageNumber"];
	        this.budgetUsed = this.convertValues(source["budgetUsed"], ContextBudget);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class ModelDescriptor {
	    id: string;
	    displayName?: string;
	    contextWindow?: number;
	    maxOutputTokens?: number;
	    supportsTools?: boolean;
	    supportsImages?: boolean;
	    source?: string;
	    notes?: string;
	
	    static createFrom(source: any = {}) {
	        return new ModelDescriptor(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.displayName = source["displayName"];
	        this.contextWindow = source["contextWindow"];
	        this.maxOutputTokens = source["maxOutputTokens"];
	        this.supportsTools = source["supportsTools"];
	        this.supportsImages = source["supportsImages"];
	        this.source = source["source"];
	        this.notes = source["notes"];
	    }
	}
	export class ProviderCapabilities {
	    streaming: boolean;
	    tools: boolean;
	    images: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ProviderCapabilities(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.streaming = source["streaming"];
	        this.tools = source["tools"];
	        this.images = source["images"];
	    }
	}
	export class ProviderOption {
	    key: string;
	    label: string;
	    type: string;
	    required: boolean;
	    default?: any;
	    helpText?: string;
	
	    static createFrom(source: any = {}) {
	        return new ProviderOption(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.label = source["label"];
	        this.type = source["type"];
	        this.required = source["required"];
	        this.default = source["default"];
	        this.helpText = source["helpText"];
	    }
	}
	export class ProviderDescriptor {
	    id: string;
	    displayName: string;
	    authKind: string;
	    defaultBaseUrl?: string;
	    optionSchema: ProviderOption[];
	    capabilities: ProviderCapabilities;
	    notes?: string;
	
	    static createFrom(source: any = {}) {
	        return new ProviderDescriptor(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.displayName = source["displayName"];
	        this.authKind = source["authKind"];
	        this.defaultBaseUrl = source["defaultBaseUrl"];
	        this.optionSchema = this.convertValues(source["optionSchema"], ProviderOption);
	        this.capabilities = this.convertValues(source["capabilities"], ProviderCapabilities);
	        this.notes = source["notes"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace settings {
	
	export class ActiveModelRef {
	    providerId: string;
	    modelId: string;
	
	    static createFrom(source: any = {}) {
	        return new ActiveModelRef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.providerId = source["providerId"];
	        this.modelId = source["modelId"];
	    }
	}
	export class AppearanceSettings {
	    theme: string;
	
	    static createFrom(source: any = {}) {
	        return new AppearanceSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.theme = source["theme"];
	    }
	}
	export class ProviderSettings {
	    providerId: string;
	    displayLabel?: string;
	    model: string;
	    models?: string[];
	    options?: Record<string, any>;
	    hasApiKey: boolean;
	    configured: boolean;
	    isActive: boolean;
	    credentialSource: string;
	
	    static createFrom(source: any = {}) {
	        return new ProviderSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.providerId = source["providerId"];
	        this.displayLabel = source["displayLabel"];
	        this.model = source["model"];
	        this.models = source["models"];
	        this.options = source["options"];
	        this.hasApiKey = source["hasApiKey"];
	        this.configured = source["configured"];
	        this.isActive = source["isActive"];
	        this.credentialSource = source["credentialSource"];
	    }
	}
	export class LLMConfig {
	    activeProviderId: string;
	    activeModelRef?: ActiveModelRef;
	    providers: ProviderSettings[];
	    catalog: llm.ProviderDescriptor[];
	    recentProviderIds: string[];
	    recentModels: ActiveModelRef[];
	
	    static createFrom(source: any = {}) {
	        return new LLMConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.activeProviderId = source["activeProviderId"];
	        this.activeModelRef = this.convertValues(source["activeModelRef"], ActiveModelRef);
	        this.providers = this.convertValues(source["providers"], ProviderSettings);
	        this.catalog = this.convertValues(source["catalog"], llm.ProviderDescriptor);
	        this.recentProviderIds = source["recentProviderIds"];
	        this.recentModels = this.convertValues(source["recentModels"], ActiveModelRef);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class LanguageSettings {
	    language: string;
	
	    static createFrom(source: any = {}) {
	        return new LanguageSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.language = source["language"];
	    }
	}
	export class ModelListingResult {
	    providerId: string;
	    models: llm.ModelDescriptor[];
	    source: string;
	    // Go type: time
	    fetchedAt?: any;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new ModelListingResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.providerId = source["providerId"];
	        this.models = this.convertValues(source["models"], llm.ModelDescriptor);
	        this.source = source["source"];
	        this.fetchedAt = this.convertValues(source["fetchedAt"], null);
	        this.error = source["error"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class SaveAppearanceSettingsRequest {
	    theme: string;
	
	    static createFrom(source: any = {}) {
	        return new SaveAppearanceSettingsRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.theme = source["theme"];
	    }
	}
	export class SaveLanguageSettingsRequest {
	    language: string;
	
	    static createFrom(source: any = {}) {
	        return new SaveLanguageSettingsRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.language = source["language"];
	    }
	}
	export class TestProviderConnectionResult {
	    providerId: string;
	    ok: boolean;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new TestProviderConnectionResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.providerId = source["providerId"];
	        this.ok = source["ok"];
	        this.error = source["error"];
	    }
	}
	export class UpsertProviderRequest {
	    providerId: string;
	    displayLabel?: string;
	    options?: Record<string, any>;
	    apiKey?: string;
	    clearApiKey?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new UpsertProviderRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.providerId = source["providerId"];
	        this.displayLabel = source["displayLabel"];
	        this.options = source["options"];
	        this.apiKey = source["apiKey"];
	        this.clearApiKey = source["clearApiKey"];
	    }
	}

}

