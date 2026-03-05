export declare class ApiClient {
    private token;
    login(email: string, password: string): Promise<void>;
    get<T>(path: string): Promise<T>;
    post<T>(path: string, body: unknown): Promise<T>;
    put<T>(path: string, body: unknown): Promise<T>;
}
