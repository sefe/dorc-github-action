import { TokenConfig } from './auth';
export interface DeployRequest {
    Project: string;
    Environment: string;
    BuildUrl: string;
    BuildText: string;
    BuildNum: string;
    Pinned: boolean;
    Components: string[];
}
export interface RequestStatus {
    Id: number;
    Status: string;
}
export interface ComponentResult {
    ComponentName: string;
    Status: string;
    Log: string;
}
export declare class DorcClient {
    private baseUrl;
    private tokenConfig;
    private tokenState;
    constructor(baseUrl: string, tokenConfig: TokenConfig);
    private ensureToken;
    private request;
    createRequest(req: DeployRequest): Promise<RequestStatus>;
    getRequestStatus(requestId: number): Promise<RequestStatus>;
    getResultStatuses(requestId: number): Promise<ComponentResult[]>;
    pollUntilComplete(requestId: number, pollIntervalSeconds: number): Promise<string>;
    logComponentResults(requestId: number): Promise<void>;
    isSuccessStatus(status: string): boolean;
}
