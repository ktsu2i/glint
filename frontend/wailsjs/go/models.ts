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
	    name: string;
	    url: string;
	    size: number;
	
	    static createFrom(source: any = {}) {
	        return new BookFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.url = source["url"];
	        this.size = source["size"];
	    }
	}

}

