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

export namespace main {
	
	export class BookFile {
	    id: string;
	    title: string;
	    name: string;
	    url: string;
	    size: number;
	    initialPage: number;
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
	        this.coverStatus = source["coverStatus"];
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
