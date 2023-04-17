import axios from "axios";
import { ChatSessionDynamoDBTable } from "./ChatSessionDynamoDBTable";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export interface ChatMessage {
    role: "user" | "assistant";
    content: string;
    token?: number;
}

export interface ChatData {
    sessionId: string;
    created: number;
    lastUpdate?: number;
    totalTokens: number;
    messages: ChatMessage[];
}

export abstract class ChatSession {
    abstract putItem(sessionId: string, data: Omit<ChatData, 'sessionId'>): Promise<void>;
    abstract getItem(sessionId: string): Promise<ChatData | null>;
    abstract deleteItem(sessionId: string): Promise<void>;
}

export interface ChatSessionManagerOptions {
    session?: ChatSession;
}

export class ChatSessionManager {
    private session: ChatSession;

    constructor(options: ChatSessionManagerOptions) {
        if (options.session == null) {
            this.session = new ChatSessionDynamoDBTable({ table: "chat" });
        }
    }

    async getAnswer(sessionId: string, prompt: string, model: string = "gpt-3.5-turbo"): Promise<ChatMessage[]> {

        let history: ChatData | null = await this.session.getItem(sessionId);

        if (history == null) {
            history = { sessionId: sessionId, created: new Date().getTime(), messages: [], totalTokens: 0 };
        } else {
            history.lastUpdate = new Date().getTime();
        }

        let userMessage: ChatMessage = { role: "user", content: prompt };

        const apiUrl = 'https://api.openai.com/v1/chat/completions';
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
        };

        const messagesWithoutTokens = history.messages.map((msg) => ({ role: msg.role, content: msg.content }));

        const data = {
            model: model,
            messages: [...messagesWithoutTokens, userMessage],
            max_tokens: 50,
            n: 1,
            stop: null,
            temperature: 1.0,
        };

        try {
            const response = await axios.post(apiUrl, data, { headers });

            const content = response.data.choices[0].message.content;
            const promptTokens = response.data.usage.prompt_tokens;
            const completionTokens = response.data.usage.completion_tokens;
            const totalTokens = response.data.usage.total_tokens;

            let assistantMessage: ChatMessage = { role: "assistant", content: content, token: completionTokens };
            userMessage.token = promptTokens;
            history.messages.push(userMessage);
            history.messages.push(assistantMessage);
            history.totalTokens += totalTokens;

            await this.session.putItem(sessionId, history);
            return history.messages;
        } catch (error) {
            console.error('Error while fetching data from OpenAI API:', error);
            throw error;
        }
    }
}