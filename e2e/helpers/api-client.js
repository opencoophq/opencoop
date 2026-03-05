"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiClient = void 0;
const API_URL = process.env.API_URL || 'http://localhost:3001';
class ApiClient {
    constructor() {
        this.token = null;
    }
    async login(email, password) {
        const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });
        if (!res.ok)
            throw new Error(`Login failed: ${res.status}`);
        const data = (await res.json());
        this.token = data.access_token;
    }
    async get(path) {
        const res = await fetch(`${API_URL}${path}`, {
            headers: { Authorization: `Bearer ${this.token}` },
        });
        if (!res.ok)
            throw new Error(`GET ${path} failed: ${res.status}`);
        return res.json();
    }
    async post(path, body) {
        const res = await fetch(`${API_URL}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.token}`,
            },
            body: JSON.stringify(body),
        });
        if (!res.ok)
            throw new Error(`POST ${path} failed: ${res.status}`);
        return res.json();
    }
    async put(path, body) {
        const res = await fetch(`${API_URL}${path}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.token}`,
            },
            body: JSON.stringify(body),
        });
        if (!res.ok)
            throw new Error(`PUT ${path} failed: ${res.status}`);
        return res.json();
    }
}
exports.ApiClient = ApiClient;
