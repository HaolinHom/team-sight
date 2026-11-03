export class TapdError extends Error {
    status;
    httpStatus;
    businessStatus;
    code;
    constructor(message, status, httpStatus, businessStatus, code = 'TAPD_REQUEST_FAILED') {
        super(message);
        this.status = status;
        this.httpStatus = httpStatus;
        this.businessStatus = businessStatus;
        this.code = code;
        this.name = 'TapdError';
    }
}
/** Shared by every connection and adapter in a service instance. */
export class RequestQueue {
    concurrency;
    active = 0;
    waiting = [];
    constructor(concurrency = 3) {
        this.concurrency = concurrency;
    }
    async run(fn) {
        await new Promise(resolve => {
            const enter = () => { this.active++; resolve(); };
            if (this.active < this.concurrency)
                enter();
            else
                this.waiting.push(enter);
        });
        try {
            return await fn();
        }
        finally {
            this.active--;
            this.waiting.shift()?.();
        }
    }
}
