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
	export class BookFile {
	    id: string;
	    title: string;
	    name: string;
	    url: string;
	    size: number;
	    initialPage: number;
	    indexedPageCount: number;
	    coverStatus: string;
	
	    static createFrom(source: any = {}) {
	        return new BookFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.name = source["name"];
	        this.url = source["url"];
	        this.size = source["size"];
	        this.initialPage = source["initialPage"];
	        this.indexedPageCount = source["indexedPageCount"];
	        this.coverStatus = source["coverStatus"];
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

}

export namespace llm {
	
	export class ChatRequest {
	    requestId: string;
	    question: string;
	    contextText: string;
	    bookName: string;
	    pageNumber: number;
	
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
	    }
	}

}

export namespace settings {
	
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
	export class LLMSettings {
	    provider: string;
	    model: string;
	    zdr: boolean;
	    hasApiKey: boolean;
	    configured: boolean;
	
	    static createFrom(source: any = {}) {
	        return new LLMSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.provider = source["provider"];
	        this.model = source["model"];
	        this.zdr = source["zdr"];
	        this.hasApiKey = source["hasApiKey"];
	        this.configured = source["configured"];
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
	export class SaveLLMSettingsRequest {
	    model: string;
	    apiKey: string;
	    zdr: boolean;
	    clearApiKey: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SaveLLMSettingsRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.model = source["model"];
	        this.apiKey = source["apiKey"];
	        this.zdr = source["zdr"];
	        this.clearApiKey = source["clearApiKey"];
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

}

