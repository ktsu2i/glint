export namespace app {
	
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
	    nextSegment: number;
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
	        this.nextSegment = source["nextSegment"];
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
	export class BookSearchResult {
	    pageNumber: number;
	    location: string;
	    headingPath: string;
	    excerpt: string;
	    matchCount: number;
	
	    static createFrom(source: any = {}) {
	        return new BookSearchResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pageNumber = source["pageNumber"];
	        this.location = source["location"];
	        this.headingPath = source["headingPath"];
	        this.excerpt = source["excerpt"];
	        this.matchCount = source["matchCount"];
	    }
	}
	export class BookSegmentInput {
	    ordinal: number;
	    location: string;
	    headingPath: string;
	    text: string;
	
	    static createFrom(source: any = {}) {
	        return new BookSegmentInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ordinal = source["ordinal"];
	        this.location = source["location"];
	        this.headingPath = source["headingPath"];
	        this.text = source["text"];
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
	export class IndexTarget {
	    id: string;
	    url: string;
	    nextSegment: number;
	    total: number;
	
	    static createFrom(source: any = {}) {
	        return new IndexTarget(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.url = source["url"];
	        this.nextSegment = source["nextSegment"];
	        this.total = source["total"];
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

}

